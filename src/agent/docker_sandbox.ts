/**
 * Docker sandbox
 */

import { execSync, spawnSync } from "child_process";
import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { v4 as uuidv4 } from "uuid";
import logger from "../utils/logger";

export interface DockerSandboxOptions {
  image?: string;
  containerName?: string;
  workspaceHost?: string;
  workspaceContainer?: string;
  workspaceReadOnly?: boolean;
  extraMounts?: string[];
  extraEnv?: Record<string, string>;
  memoryLimit?: string;
  network?: string;
  snapshotEnabled?: boolean;
  snapshotMax?: number;
}

export class DockerSandbox {
  image: string;
  containerName: string;
  workspaceHost?: string;
  workspaceContainer: string;
  workspaceReadOnly: boolean;
  extraMounts: string[];
  extraEnv: Record<string, string>;
  memoryLimit?: string;
  network: string;
  snapshotEnabled: boolean;
  snapshotMax: number;

  private containerId: string | null = null;

  constructor(opts: DockerSandboxOptions = {}) {
    this.image = opts.image ?? "ubuntu:22.04";
    this.containerName = opts.containerName ?? `seclaw-${uuidv4().replace(/-/g, "").slice(0, 8)}`;
    this.workspaceHost = opts.workspaceHost;
    this.workspaceContainer = opts.workspaceContainer ?? "/workspace";
    this.workspaceReadOnly = opts.workspaceReadOnly ?? true;
    this.extraMounts = opts.extraMounts ?? [];
    this.extraEnv = opts.extraEnv ?? {};
    this.memoryLimit = opts.memoryLimit;
    this.network = opts.network ?? "bridge";
    this.snapshotEnabled = opts.snapshotEnabled ?? true;
    this.snapshotMax = opts.snapshotMax ?? 10;
  }

  get isRunning(): boolean {
    return this.containerId !== null;
  }

  start(): void {
    const inspect = spawnSync(
      "docker",
      ["inspect", "--format", "{{.State.Status}}", this.containerName],
      { encoding: "utf-8" }
    );

    if (inspect.status === 0) {
      const status = inspect.stdout.trim();
      if (status === "running") {
        const idRes = spawnSync(
          "docker",
          ["inspect", "--format", "{{.Id}}", this.containerName],
          { encoding: "utf-8" }
        );
        this.containerId = idRes.stdout.trim();
        logger.info(`Docker sandbox reused (already running): ${this.containerName} (${this.containerId.slice(0, 12)})`);
        return;
      } else {
        const restart = spawnSync("docker", ["start", this.containerName], { encoding: "utf-8" });
        if (restart.status === 0) {
          const idRes = spawnSync(
            "docker",
            ["inspect", "--format", "{{.Id}}", this.containerName],
            { encoding: "utf-8" }
          );
          this.containerId = idRes.stdout.trim();
          logger.info(`Docker sandbox restarted: ${this.containerName} (${this.containerId.slice(0, 12)})`);
          return;
        }
        spawnSync("docker", ["rm", "-f", this.containerName], { encoding: "utf-8" });
      }
    }

    const cmd: string[] = ["run", "-d", "--name", this.containerName, "--network", this.network];

    if (this.workspaceHost) {
      const resolved = path.resolve(this.workspaceHost);
      const mode = this.workspaceReadOnly ? "ro" : "rw";
      cmd.push("-v", `${resolved}:${this.workspaceContainer}:${mode}`);
    }
    for (const mount of this.extraMounts) cmd.push("-v", mount);
    for (const [k, v] of Object.entries(this.extraEnv)) cmd.push("-e", `${k}=${v}`);
    if (this.memoryLimit) cmd.push("-m", this.memoryLimit);
    cmd.push(this.image, "sleep", "infinity");

    const result = spawnSync("docker", cmd, { encoding: "utf-8" });
    if (result.status !== 0) {
      throw new Error(`Failed to start Docker sandbox '${this.containerName}': ${result.stderr?.trim()}`);
    }
    this.containerId = result.stdout.trim();
    logger.info(`Docker sandbox created: ${this.containerName} (${this.containerId.slice(0, 12)})`);
  }

  stop(): void {
    if (!this.containerId) return;
    spawnSync("docker", ["stop", this.containerName], { encoding: "utf-8" });
    logger.info(`Docker sandbox stopped (preserved): ${this.containerName}`);
    this.containerId = null;
  }

  destroy(): void {
    spawnSync("docker", ["rm", "-f", this.containerName], { encoding: "utf-8" });
    logger.info(`Docker sandbox destroyed: ${this.containerName}`);
    this.containerId = null;
  }

  buildRunCmd(imageOverride?: string): string[] {
    const image = imageOverride ?? this.image;
    const cmd = ["docker", "run", "-d", "--name", this.containerName, "--network", this.network];
    if (this.workspaceHost) {
      const resolved = path.resolve(this.workspaceHost);
      const mode = this.workspaceReadOnly ? "ro" : "rw";
      cmd.push("-v", `${resolved}:${this.workspaceContainer}:${mode}`);
    }
    for (const mount of this.extraMounts) cmd.push("-v", mount);
    for (const [k, v] of Object.entries(this.extraEnv)) cmd.push("-e", `${k}=${v}`);
    if (this.memoryLimit) cmd.push("-m", this.memoryLimit);
    cmd.push(image, "sleep", "infinity");
    return cmd;
  }

  async exec(
    command: string,
    workingDir?: string,
    timeout = 60
  ): Promise<[string, string, number]> {
    if (!this.containerId) throw new Error("Docker sandbox is not running");

    const wdContainer = workingDir ? this.hostToContainer(workingDir) : this.workspaceContainer;
    const dockerCmd = ["docker", "exec", "-w", wdContainer, this.containerName, "sh", "-c", command];

    return new Promise((resolve) => {
      const child = spawn(dockerCmd[0], dockerCmd.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf-8")));
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf-8")));

      const timer = setTimeout(() => {
        child.kill();
        resolve(["", `Command timed out after ${timeout}s`, 1]);
      }, timeout * 1000);

      child.on("close", (code) => {
        clearTimeout(timer);
        resolve([stdout, stderr, code ?? 0]);
      });
    });
  }

  async execWithStdin(
    command: string,
    stdinData: Buffer,
    workingDir?: string,
    timeout = 60
  ): Promise<[string, string, number]> {
    if (!this.containerId) throw new Error("Docker sandbox is not running");

    const wdContainer = workingDir ? this.hostToContainer(workingDir) : this.workspaceContainer;
    const dockerCmd = ["docker", "exec", "-i", "-w", wdContainer, this.containerName, "sh", "-c", command];

    return new Promise((resolve) => {
      const child = spawn(dockerCmd[0], dockerCmd.slice(1), { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf-8")));
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf-8")));

      const timer = setTimeout(() => {
        child.kill();
        resolve(["", `Command timed out after ${timeout}s`, 1]);
      }, timeout * 1000);

      child.on("close", (code) => {
        clearTimeout(timer);
        resolve([stdout, stderr, code ?? 0]);
      });

      child.stdin.write(stdinData);
      child.stdin.end();
    });
  }

  hostToContainer(hostPath: string): string {
    let resolved: string;
    try {
      resolved = path.resolve(hostPath.replace(/^~/, process.env["HOME"] ?? "~"));
    } catch {
      return hostPath;
    }

    if (this.workspaceHost) {
      const hostWs = path.resolve(this.workspaceHost);
      if (resolved === hostWs) return this.workspaceContainer;
      if (resolved.startsWith(hostWs + path.sep) || resolved.startsWith(hostWs + "/")) {
        return this.workspaceContainer + resolved.slice(hostWs.length);
      }
    }

    for (const mount of this.extraMounts) {
      const parts = mount.split(":");
      if (parts.length < 2) continue;
      let mntHost: string;
      try {
        mntHost = path.resolve(parts[0].replace(/^~/, process.env["HOME"] ?? "~"));
      } catch {
        continue;
      }
      const mntContainer = parts[1];
      if (resolved === mntHost) return mntContainer;
      if (resolved.startsWith(mntHost + "/")) return mntContainer + resolved.slice(mntHost.length);
    }
    return hostPath;
  }

  containerToHost(containerPath: string): string {
    if (!this.workspaceHost) return containerPath;
    const wc = this.workspaceContainer;
    const hostWs = path.resolve(this.workspaceHost);
    if (containerPath === wc) return hostWs;
    if (containerPath.startsWith(wc + "/")) return hostWs + containerPath.slice(wc.length);
    return containerPath;
  }
}
