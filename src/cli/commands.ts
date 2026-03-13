/**
 * CLI commands for seclaw
 *
 * Uses commander for CLI parsing.
 */

import { Command } from "commander";
import * as readline from "readline";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import {
  loadConfig,
  getDataDir,
  getConfigPath,
  getProvider,
  getApiBase,
  getProviderName,
} from "../config/loader";
import { ConfigSchema, getWorkspacePath } from "../config/schema";
import { LiteLLMProvider } from "../providers/litellm_provider";
import { MessageBus } from "../bus/queue";
import { AgentLoop } from "../agent/loop";
import { SessionManager } from "../session/manager";
import { ChannelManager } from "../channels/manager";
import { CronService } from "../cron/service";
import { HeartbeatService } from "../heartbeat/service";
import { makeOutboundMessage } from "../bus/events";

const VERSION = "0.1.0";
const LOGO = "🤖";

const EXIT_COMMANDS = new Set(["exit", "quit", "/exit", "/quit", ":q"]);

// ─────────────────────────────────────────────
// Helper: create LLM provider from config
// ─────────────────────────────────────────────
function makeProvider(config: ReturnType<typeof loadConfig>): LiteLLMProvider {
  const p = getProvider(config);
  const model = config.agents.defaults.model;
  if (!p?.apiKey && !model.startsWith("bedrock/")) {
    console.error("Error: No API key configured.");
    console.error("Set one in ~/.seclaw/config.json under providers section");
    process.exit(1);
  }
  return new LiteLLMProvider({
    apiKey: p?.apiKey,
    apiBase: getApiBase(config),
    defaultModel: model,
    extraHeaders: p?.extraHeaders ?? undefined,
    providerName: getProviderName(config),
  });
}

// ─────────────────────────────────────────────
// Interactive readline helper
// ─────────────────────────────────────────────
function readLineAsync(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer);
    });
  });
}

function elapsedMs(startNs: bigint): number {
  return Number(process.hrtime.bigint() - startNs) / 1_000_000;
}

// ─────────────────────────────────────────────
// Workspace template creation
// ─────────────────────────────────────────────
function findTemplateRoot(): string | null {
  const candidates = [
    path.resolve(__dirname, "../../templates"),
    path.resolve(process.cwd(), "templates"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }

  return null;
}

function copyTemplates(templateRoot: string, workspacePath: string): void {
  const copyDir = (sourceDir: string, relativeDir = ""): void => {
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });

    for (const entry of entries) {
      const relativePath = path.join(relativeDir, entry.name);
      const sourcePath = path.join(sourceDir, entry.name);
      const targetPath = path.join(workspacePath, relativePath);

      if (entry.isDirectory()) {
        fs.mkdirSync(targetPath, { recursive: true });
        copyDir(sourcePath, relativePath);
        continue;
      }

      if (!entry.isFile() || fs.existsSync(targetPath)) continue;

      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(sourcePath, targetPath);
      console.log(`  Created ${relativePath.split(path.sep).join("/")}`);
    }
  };

  copyDir(templateRoot);
}

function createWorkspaceTemplates(workspacePath: string): void {
  const templateRoot = findTemplateRoot();
  if (templateRoot) {
    copyTemplates(templateRoot, workspacePath);
  } else {
    console.warn("Warning: templates directory not found; skipping template file creation.");
  }

  const skillsDir = path.join(workspacePath, "skills");
  fs.mkdirSync(skillsDir, { recursive: true });
}

// ─────────────────────────────────────────────
// Snapshot helpers (reads snapshot dir)
// ─────────────────────────────────────────────
function listSnapshotIds(): string[] {
  const dir = path.join(os.homedir(), ".seclaw", "snapshots");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => fs.statSync(path.join(dir, f)).isDirectory())
    .sort()
    .reverse();
}

// ─────────────────────────────────────────────
// Build CLI
// ─────────────────────────────────────────────
export function buildCLI(): Command {
  const program = new Command("seclaw")
    .description(`${LOGO} seclaw - Personal AI Assistant`)
    .version(VERSION, "-v, --version");

  // ──────────── onboard ────────────
  program
    .command("onboard")
    .description("Initialize seclaw configuration and workspace")
    .option("-f, --force", "Overwrite existing configuration", false)
    .action((opts: { force?: boolean }) => {
      const configPath = getConfigPath();
      if (fs.existsSync(configPath) && !opts.force) {
        console.log(`Config already exists at ${configPath}`);
        console.log("Use --force to overwrite it.");
        return;
      }
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      const defaultConfig = ConfigSchema.parse({});
      defaultConfig.agents.defaults.model = "";
      defaultConfig.security.dockerSandbox.enabled = true;
      defaultConfig.security.dockerSandbox.snapshotMax = 5;
      defaultConfig.security.dockerSandbox.snapshotMinIntervalSeconds = 1200;
      defaultConfig.security.prohibitedCommands = ["rm -rf", "sudo"];
      fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
      console.log(`${opts.force ? "\u2713 Overwrote" : "\u2713 Created"} config at ${configPath}`);

      const config = loadConfig();
      const workspacePath = getWorkspacePath(config);
      fs.mkdirSync(workspacePath, { recursive: true });
      createWorkspaceTemplates(workspacePath);
      console.log(`\u2713 Created workspace at ${workspacePath}`);
      console.log(`\n${LOGO} seclaw is ready!`);
      console.log("\nNext steps:");
      console.log("  1. Add your API key to ~/.seclaw/config.json");
      console.log('  2. Chat: seclaw agent -m "Hello!"');
    });

  // ──────────── gateway ────────────
  program
    .command("gateway")
    .description("Start the seclaw gateway (all channels + agent)")
    .option("-p, --port <number>", "Gateway port", "18790")
    .option("--verbose", "Verbose output", false)
    .option("--startup-metrics", "Print startup timing metrics", false)
    .action(async (opts: { port: string; verbose?: boolean; startupMetrics?: boolean }) => {
      const startupMetricsEnabled = Boolean(
        opts.startupMetrics || opts.verbose || process.env["SECLAW_STARTUP_METRICS"] === "1"
      );
      const startupNs = process.hrtime.bigint();
      const startupMarks: Array<{ phase: string; gatewayMs: number; processMs: number }> = [];
      const markStartup = (phase: string): void => {
        if (!startupMetricsEnabled) return;
        const gatewayMs = elapsedMs(startupNs);
        const processMs = process.uptime() * 1000;
        startupMarks.push({ phase, gatewayMs, processMs });
        console.log(
          `[startup] phase=${phase} gateway_ms=${gatewayMs.toFixed(1)} process_ms=${processMs.toFixed(1)}`
        );
      };

      markStartup("gateway_action_enter");
      const config = loadConfig();
      markStartup("config_loaded");
      const workspacePath = getWorkspacePath(config);
      const bus = new MessageBus();
      const provider = makeProvider(config);
      const sessionManager = new SessionManager(workspacePath);
      markStartup("core_services_initialized");

      // Docker sandbox (optional)
      let dockerSandbox: import("../agent/docker_sandbox").DockerSandbox | undefined;
      const sandboxCfg = config.security.dockerSandbox;
      if (sandboxCfg?.enabled) {
        try {
          const { DockerSandbox } = await import("../agent/docker_sandbox");
          dockerSandbox = new DockerSandbox({
            image: sandboxCfg.image,
            containerName: sandboxCfg.containerName,
            workspaceHost: workspacePath,
            workspaceContainer: sandboxCfg.workspaceContainer,
            workspaceReadOnly: sandboxCfg.workspaceReadOnly,
            extraMounts: sandboxCfg.extraMounts,
            extraEnv: sandboxCfg.extraEnv,
            memoryLimit: sandboxCfg.memoryLimit ?? undefined,
            network: sandboxCfg.network,
            snapshotEnabled: sandboxCfg.snapshotEnabled,
            snapshotMax: sandboxCfg.snapshotMax,
          });
          await dockerSandbox.start();
          markStartup("docker_sandbox_started");
          console.log(
            `\u2713 Docker sandbox started: ${sandboxCfg.containerName} (${sandboxCfg.image})`
          );
        } catch (e) {
          console.error(`Error starting Docker sandbox: ${e}`);
          dockerSandbox = undefined;
          markStartup("docker_sandbox_failed");
        }
      } else {
        markStartup("docker_sandbox_skipped");
      }

      // Cron service
      const cronStorePath = path.join(getDataDir(), "cron", "jobs.json");
      const cron = new CronService(cronStorePath);

      // Agent loop
      const agent = new AgentLoop({
        bus,
        provider,
        workspace: workspacePath,
        model: config.agents.defaults.model,
        maxIterations: config.agents.defaults.maxToolIterations,
        braveApiKey: config.tools.web?.search?.apiKey || undefined,
        execConfig: config.tools.exec,
        cronService: cron,
        restrictToWorkspace: config.tools.restrictToWorkspace,
        sessionManager,
        dockerSandbox,
        securityConfig: config.security,
      });
      markStartup("agent_initialized");

      // Wire cron callback
      cron.onJob = async (job) => {
        const response = await agent.processDirect(
          job.payload.message,
          `cron:${job.id}`,
          job.payload.channel ?? "cli",
          job.payload.to ?? "direct"
        );
        if (job.payload.deliver && job.payload.to) {
          await bus.publishOutbound(
            makeOutboundMessage({
              channel: job.payload.channel ?? "cli",
              chatId: job.payload.to,
              content: response ?? "",
            })
          );
        }
        return response ?? null;
      };

      // Heartbeat
      const heartbeat = new HeartbeatService({
        workspace: workspacePath,
        onHeartbeat: (prompt: string) => agent.processDirect(prompt, "heartbeat"),
        intervalSeconds: 30 * 60,
        enabled: true,
      });

      // Channel manager
      const channels = new ChannelManager(config, bus, sessionManager);
      markStartup("channels_initialized");
      if (channels.enabledChannels.length > 0) {
        console.log(`\u2713 Channels: ${channels.enabledChannels.join(", ")}`);
      } else {
        console.warn("Warning: No channels enabled");
      }

      const cronStatus = cron.status() as Record<string, unknown>;
      const jobCount = typeof cronStatus["jobs"] === "number" ? cronStatus["jobs"] : 0;
      if (jobCount > 0) console.log(`\u2713 Cron: ${jobCount} scheduled jobs`);
      console.log("\u2713 Heartbeat: every 30m");
      console.log(`${LOGO} seclaw gateway running on port ${opts.port}`);

      const shutdown = () => {
        console.log("\nShutting down...");
        heartbeat.stop();
        cron.stop();
        agent.stop();
        channels.stopAll().then(() => {
          if (dockerSandbox) dockerSandbox!.stop();
          process.exit(0);
        });
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      const agentRunPromise = agent.run();
      markStartup("agent_run_invoked");

      const startupTasks = [
        cron.start().then(() => markStartup("cron_started")),
        heartbeat.start().then(() => markStartup("heartbeat_started")),
        channels.startAll().then(() => markStartup("channels_started")),
        agent.waitUntilReady(120000).then(() => markStartup("agent_ready")),
      ];

      try {
        await Promise.all(startupTasks);
      } catch (e) {
        if (startupMetricsEnabled) {
          const gatewayMs = Math.round(elapsedMs(startupNs));
          const processMs = Math.round(process.uptime() * 1000);
          console.error(
            `[startup] result=failed gateway_ms=${gatewayMs} process_ms=${processMs} error=${String(e)}`
          );
        }
        throw e;
      }

      if (startupMetricsEnabled) {
        const gatewayMs = Math.round(elapsedMs(startupNs));
        const processMs = Math.round(process.uptime() * 1000);
        const phaseSummary = startupMarks
          .map((m) => `${m.phase}:${m.gatewayMs.toFixed(1)}ms`)
          .join(", ");
        console.log(`[startup] result=ready gateway_ms=${gatewayMs} process_ms=${processMs}`);
        console.log(`[startup] phases=${phaseSummary}`);
      }

      await agentRunPromise;
    });

  // ──────────── agent ────────────
  program
    .command("agent")
    .description("Interact with the agent directly")
    .option("-m, --message <text>", "Message to send to the agent")
    .option("-s, --session <id>", "Session ID", "cli:default")
    .option("--no-markdown", "Disable markdown rendering")
    .option("--logs", "Show runtime logs", false)
    .action(async (opts) => {
      const config = loadConfig();
      const workspacePath = getWorkspacePath(config);
      const bus = new MessageBus();
      const provider = makeProvider(config);

      const agentLoop = new AgentLoop({
        bus,
        provider,
        workspace: workspacePath,
        braveApiKey: config.tools.web?.search?.apiKey || undefined,
        execConfig: config.tools.exec,
        restrictToWorkspace: config.tools.restrictToWorkspace,
        securityConfig: config.security,
      });

      if (opts.message) {
        const response = await agentLoop.processDirect(opts.message, opts.session);
        console.log(`\n${LOGO} seclaw`);
        console.log(response ?? "");
      } else {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
          terminal: true,
        });

        console.log(`${LOGO} Interactive mode (type 'exit' or Ctrl+C to quit)\n`);

        const cleanup = () => {
          rl.close();
          process.exit(0);
        };
        process.on("SIGINT", cleanup);

        // eslint-disable-next-line no-constant-condition
        while (true) {
          let userInput: string;
          try {
            userInput = await readLineAsync(rl, "You: ");
          } catch {
            break;
          }

          const command = userInput.trim();
          if (!command) continue;
          if (EXIT_COMMANDS.has(command.toLowerCase())) {
            console.log("\nGoodbye!");
            rl.close();
            break;
          }

          process.stdout.write("(thinking...) ");
          const response = await agentLoop.processDirect(userInput, opts.session);
          process.stdout.write("\r                 \r");
          console.log(`\n${LOGO} seclaw`);
          console.log(response ?? "");
          console.log();
        }
      }
    });

  // ──────────── channels sub-command ────────────
  const channelsCmd = program.command("channels").description("Manage channels");

  channelsCmd
    .command("status")
    .description("Show channel status")
    .action(() => {
      const config = loadConfig();
      const ch = config.channels;
      const rows: [string, string, string][] = [
        ["whatsapp", ch.whatsapp?.enabled ? "\u2713" : "\u2717", ch.whatsapp?.bridgeUrl ?? "-"],
        ["telegram", ch.telegram?.enabled ? "\u2713" : "\u2717", ch.telegram?.token ? "configured" : "-"],
        ["discord", ch.discord?.enabled ? "\u2713" : "\u2717", ch.discord?.token ? "configured" : "-"],
        ["slack", ch.slack?.enabled ? "\u2713" : "\u2717", ch.slack?.appToken ? "socket-mode" : "-"],
        ["feishu", ch.feishu?.enabled ? "\u2713" : "\u2717", ch.feishu?.appId ? "configured" : "-"],
        ["dingtalk", ch.dingtalk?.enabled ? "\u2713" : "\u2717", ch.dingtalk?.clientId ? "configured" : "-"],
        ["mochat", ch.mochat?.enabled ? "\u2713" : "\u2717", ch.mochat?.baseUrl ?? "-"],
        ["qq", ch.qq?.enabled ? "\u2713" : "\u2717", ch.qq?.appId ? "configured" : "-"],
        ["email", ch.email?.enabled ? "\u2713" : "\u2717", ch.email?.imapHost ?? "-"],
      ];
      console.log("\nChannel Status:");
      console.log("Channel       Enabled  Config");
      console.log("\u2500".repeat(50));
      for (const [name, enabled, cfg] of rows) {
        console.log(`${name.padEnd(14)}${enabled.padEnd(9)}${cfg}`);
      }
      console.log();
    });

  channelsCmd
    .command("login")
    .description("Link WhatsApp device via QR code (starts bridge)")
    .action(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { spawnSync } = require("child_process") as typeof import("child_process");
      const bridgeDir = path.join(os.homedir(), ".seclaw", "bridge");
      if (!fs.existsSync(bridgeDir)) {
        console.error("Bridge not found. Please build the bridge first.");
        process.exit(1);
      }
      spawnSync("npm", ["start"], { cwd: bridgeDir, stdio: "inherit" });
    });

  // ──────────── cron sub-command ────────────
  const cronCmd = program.command("cron").description("Manage scheduled tasks");

  cronCmd
    .command("list")
    .description("List scheduled jobs")
    .option("-a, --all", "Include disabled jobs", false)
    .action((opts: { all: boolean }) => {
      const storePath = path.join(getDataDir(), "cron", "jobs.json");
      const cron = new CronService(storePath);
      const jobs = cron.listJobs(opts.all);
      if (jobs.length === 0) {
        console.log("No scheduled jobs.");
        return;
      }
      console.log("\nScheduled Jobs:");
      console.log("ID".padEnd(10) + "Schedule".padEnd(30) + "Status".padEnd(10) + "Message");
      console.log("\u2500".repeat(70));
      for (const job of jobs) {
        const status = job.enabled ? "enabled" : "disabled";
        const schedStr = job.schedule.expr
          ? `cron:${job.schedule.expr}`
          : job.schedule.everyMs
          ? `every:${job.schedule.everyMs}ms`
          : job.schedule.atMs
          ? `at:${new Date(job.schedule.atMs).toISOString()}`
          : "unknown";
        console.log(
          job.id.slice(0, 9).padEnd(10) +
            schedStr.padEnd(30) +
            status.padEnd(10) +
            (job.payload.message ?? "")
        );
      }
    });

  cronCmd
    .command("remove <id>")
    .description("Remove a scheduled job")
    .action((id: string) => {
      const storePath = path.join(getDataDir(), "cron", "jobs.json");
      const cron = new CronService(storePath);
      const removed = cron.removeJob(id);
      console.log(removed ? `Removed job: ${id}` : `Job not found: ${id}`);
    });

  // ──────────── snapshot sub-command ────────────
  const snapshotCmd = program.command("snapshot").description("Manage workspace snapshots");

  snapshotCmd
    .command("list")
    .description("List snapshots")
    .action(() => {
      const ids = listSnapshotIds();
      if (ids.length === 0) {
        console.log("No snapshots.");
        return;
      }
      for (const id of ids) console.log(`  ${id}`);
    });

  snapshotCmd
    .command("take [label]")
    .description("Take a snapshot of the workspace")
    .action(async (_label?: string) => {
      const { getBackend } = await import(
        "../agent/security/snapshot_and_rollback/index"
      );
      const config = loadConfig();
      const workspacePath = getWorkspacePath(config);
      const backend = getBackend();
      if (!backend) {
        console.error("No snapshot backend available on this platform");
        return;
      }
      const tag = backend.takeSnapshot([workspacePath]);
      console.log(tag ? `\u2713 Snapshot created: ${tag}` : "Snapshot failed");
    });

  snapshotCmd
    .command("restore <tag>")
    .description("Restore a snapshot by tag")
    .action(async (tag: string) => {
      const { getBackend } = await import(
        "../agent/security/snapshot_and_rollback/index"
      );
      const config = loadConfig();
      const workspacePath = getWorkspacePath(config);
      const backend = getBackend();
      if (!backend) {
        console.error("No snapshot backend available");
        return;
      }
      const ok = backend.restoreSnapshot(tag, [workspacePath]);
      console.log(ok ? `\u2713 Restored snapshot: ${tag}` : `Failed to restore: ${tag}`);
    });

  return program;
}
