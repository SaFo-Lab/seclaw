/**
 * Docker snapshot manager
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawn, spawnSync } from "child_process";
import logger from "../../../utils/logger";
import type { HostSnapshotBackend } from "./base";

const MAX_SNAPSHOTS = 10;

interface SnapshotEntry {
  tag: string;
  imageId?: string;
  timestamp: string;
  label?: string;
  restoreCmd?: string[];
  restore_cmd?: string[];
  hostSnapId?: string;
  host_snap_id?: string;
  hostDirs?: string[];
  host_dirs?: string[];
}

interface AsyncCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  signal: NodeJS.Signals | null;
}

export class DockerSnapshotManager {
  private containerName: string;
  private workspace: string;
  private imagePrefix: string;
  private maxSnapshots: number;
  private hostBackend?: HostSnapshotBackend | null;
  private hostDirs: string[];
  private manifestDir: string;
  private manifestPath: string;
  private legacyManifestPath: string;

  constructor(opts: {
    containerName: string;
    workspace: string;
    imagePrefix?: string;
    maxSnapshots?: number;
    hostBackend?: HostSnapshotBackend | null;
    hostDirs?: string[];
  }) {
    this.containerName = opts.containerName;
    this.workspace = opts.workspace;
    this.imagePrefix = opts.imagePrefix ?? "snapshot";
    this.maxSnapshots = opts.maxSnapshots ?? MAX_SNAPSHOTS;
    this.hostBackend = opts.hostBackend;
    this.hostDirs = opts.hostDirs ?? [];
    this.manifestDir = path.join(os.homedir(), ".seclaw", "snapshots");
    this.manifestPath = path.join(this.manifestDir, "docker_snapshots.json");
    this.legacyManifestPath = path.join(path.dirname(this.workspace), "snapshots", "docker_snapshots.json");
  }

  private _runCommandAsync(command: string, args: string[], timeoutMs = 0): Promise<AsyncCommandResult> {
    return new Promise<AsyncCommandResult>((resolve) => {
      let settled = false;
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let timer: NodeJS.Timeout | null = null;

      const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });

      const finish = (result: AsyncCommandResult): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(result);
      };

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true;
          try {
            child.kill("SIGTERM");
          } catch {
            // ignore
          }
          const killTimer = setTimeout(() => {
            if (child.killed) return;
            try {
              child.kill("SIGKILL");
            } catch {
              // ignore
            }
          }, 1000);
          killTimer.unref();
        }, timeoutMs);
        timer.unref();
      }

      child.stdout?.on("data", (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      child.on("error", (err: Error) => {
        const nextErr = stderr ? `${stderr}\n${String(err)}` : String(err);
        finish({ status: null, stdout, stderr: nextErr, timedOut, signal: null });
      });

      child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
        finish({ status: code, stdout, stderr, timedOut, signal });
      });
    });
  }

  private _appendSnapshotEntry(opts: {
    tag: string;
    imageId: string;
    timestamp: string;
    label?: string;
    runCmd?: string[];
    hostSnapId?: string;
  }): void {
    const manifest = this._loadManifest();
    manifest.push({
      tag: opts.tag,
      imageId: opts.imageId,
      timestamp: opts.timestamp,
      label: opts.label,
      restoreCmd: opts.runCmd,
      restore_cmd: opts.runCmd,
      hostSnapId: opts.hostSnapId,
      host_snap_id: opts.hostSnapId,
      hostDirs: this.hostDirs,
      host_dirs: this.hostDirs,
    });
    this._prune(manifest);
    this._saveManifest(manifest);
  }

  takeSnapshot(label = "", runCmdFactory?: (tag: string) => string[]): string | null {
    const now = new Date();
    const pad = (value: number): string => String(value).padStart(2, "0");
    const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const tag = `${this.imagePrefix}:snap_${ts}`;

    logger.info(`Taking Docker snapshot: docker commit ${this.containerName} ${tag}`);
    const result = spawnSync("docker", ["commit", this.containerName, tag], {
      encoding: "utf-8",
      timeout: 60000,
    });

    if (result.status !== 0) {
      logger.error(`docker commit failed (exit ${result.status}): ${result.stderr?.trim()}`);
      return null;
    }

    const imageId = result.stdout.trim();
    logger.info(`Snapshot created: ${tag} (${imageId.slice(0, 12) || "unknown"})`);

    const runCmd = runCmdFactory ? runCmdFactory(tag) : undefined;

    let hostSnapId: string | undefined;
    if (this.hostBackend && this.hostDirs.length > 0) {
      try {
        hostSnapId = this.hostBackend.takeSnapshot(this.hostDirs) ?? undefined;
        if (hostSnapId) logger.info(`Host snapshot created: ${hostSnapId}`);
        else logger.warn("Host snapshot failed; docker snapshot still saved");
      } catch (e) {
        logger.warn(`Host snapshot raised an exception: ${e}`);
      }
    }

    this._appendSnapshotEntry({
      tag,
      imageId,
      timestamp: ts,
      label,
      runCmd,
      hostSnapId,
    });
    return tag;
  }

  async takeSnapshotAsync(label = "", runCmdFactory?: (tag: string) => string[]): Promise<string | null> {
    const now = new Date();
    const pad = (value: number): string => String(value).padStart(2, "0");
    const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const tag = `${this.imagePrefix}:snap_${ts}`;

    logger.info(`Taking Docker snapshot: docker commit ${this.containerName} ${tag}`);
    const result = await this._runCommandAsync("docker", ["commit", this.containerName, tag], 60000);

    if (result.status !== 0) {
      const reason = result.timedOut ? "timeout" : `exit ${result.status}`;
      logger.error(`docker commit failed (${reason}): ${result.stderr?.trim()}`);
      return null;
    }

    const imageId = result.stdout.trim();
    logger.info(`Snapshot created: ${tag} (${imageId.slice(0, 12) || "unknown"})`);

    const runCmd = runCmdFactory ? runCmdFactory(tag) : undefined;

    let hostSnapId: string | undefined;
    if (this.hostBackend && this.hostDirs.length > 0) {
      try {
        hostSnapId = this.hostBackend.takeSnapshot(this.hostDirs) ?? undefined;
        if (hostSnapId) logger.info(`Host snapshot created: ${hostSnapId}`);
        else logger.warn("Host snapshot failed; docker snapshot still saved");
      } catch (e) {
        logger.warn(`Host snapshot raised an exception: ${e}`);
      }
    }

    this._appendSnapshotEntry({
      tag,
      imageId,
      timestamp: ts,
      label,
      runCmd,
      hostSnapId,
    });
    return tag;
  }

  restoreSnapshot(tag: string, restoreCmdFactory?: (tag: string) => string[]): void {
    const manifest = this._loadManifest();
    const normalizedTag = tag.trim();
    let entry = manifest.find((e) => e.tag === normalizedTag);
    if (!entry && !normalizedTag.endsWith(".")) {
      entry = manifest.find((e) => e.tag === `${normalizedTag}.`);
    }
    if (!entry) throw new Error(`Snapshot '${normalizedTag}' not found in manifest`);

    const restoreCmd = this._getRestoreCmd(entry) ?? restoreCmdFactory?.(entry.tag);
    if (!restoreCmd) {
      throw new Error(
        `Snapshot '${entry.tag}' has no restore_cmd stored. Snapshots taken before this fix must be restored manually.`
      );
    }

    if (!this._getRestoreCmd(entry)) {
      entry.restoreCmd = restoreCmd;
      entry.restore_cmd = restoreCmd;
      this._saveManifest(manifest);
    }

    let containerName = "seclaw";
    const nameIdx = restoreCmd.indexOf("--name");
    if (nameIdx >= 0 && restoreCmd[nameIdx + 1]) {
      containerName = restoreCmd[nameIdx + 1];
    }

    logger.info(`Restoring snapshot: stopping and removing container '${containerName}'`);
    spawnSync("docker", ["stop", containerName], { encoding: "utf-8" });
    spawnSync("docker", ["rm", "-f", containerName], { encoding: "utf-8" });

    const hostSnapId = this._getHostSnapId(entry);
    const hostDirs = this._getHostDirs(entry);
    if (this.hostBackend && hostSnapId && hostDirs?.length) {
      const currentManifest = this._loadManifest();
      const ok = this.hostBackend.restoreSnapshot(hostSnapId, hostDirs);
      if (ok) logger.info(`Host snapshot '${hostSnapId}' restored`);
      else logger.warn(`Host snapshot '${hostSnapId}' restore failed`);
      this._saveManifest(currentManifest);
    }

    logger.info(`Restoring snapshot: running ${entry.tag}`);
    const result = spawnSync(restoreCmd[0], restoreCmd.slice(1), { encoding: "utf-8" });
    if (result.status !== 0) throw new Error(`Failed to restore snapshot '${entry.tag}': ${result.stderr?.trim()}`);
    logger.info(`Snapshot '${entry.tag}' restored successfully as container '${containerName}'`);
  }

  listSnapshots(): SnapshotEntry[] {
    return [...this._loadManifest()].reverse();
  }

  getManifestPath(): string {
    return this.manifestPath;
  }

  deleteSnapshot(tag: string): boolean {
    const manifest = this._loadManifest();
    const entry = manifest.find((e) => e.tag === tag);
    if (!entry) return false;

    if (entry.tag) {
      spawnSync("docker", ["rmi", entry.tag], { encoding: "utf-8", timeout: 30000 });
      logger.info(`Deleted docker image: ${entry.tag}`);
    }

    const hostSnapId = this._getHostSnapId(entry);
    const hostDirs = this._getHostDirs(entry);
    if (this.hostBackend && hostSnapId) {
      this.hostBackend.deleteSnapshot(hostSnapId, hostDirs);
      logger.info(`Deleted host snapshot: ${hostSnapId}`);
    }

    this._saveManifest(manifest.filter((e) => e.tag !== tag));
    return true;
  }

  private _loadManifest(): SnapshotEntry[] {
    const primary = this._readManifest(this.manifestPath);
    const legacy = this._readManifest(this.legacyManifestPath);

    if (primary.length === 0 && legacy.length > 0) {
      this._saveManifest(legacy);
      logger.info(`Migrated snapshot manifest to ${this.manifestPath}`);
      return legacy;
    }

    if (primary.length > 0 && legacy.length > 0) {
      const mergedByTag = new Map<string, SnapshotEntry>();
      for (const item of legacy) mergedByTag.set(item.tag, item);
      for (const item of primary) mergedByTag.set(item.tag, item);
      const merged = Array.from(mergedByTag.values());
      if (merged.length !== primary.length) {
        this._saveManifest(merged);
        logger.info(`Merged legacy snapshot entries into ${this.manifestPath}`);
      }
      return merged;
    }

    return primary;
  }

  private _readManifest(manifestPath: string): SnapshotEntry[] {
    if (!fs.existsSync(manifestPath)) return [];
    try {
      return JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as SnapshotEntry[];
    } catch (e) {
      logger.warn(`Failed to load snapshot manifest ${manifestPath}: ${e}`);
      return [];
    }
  }

  private _saveManifest(manifest: SnapshotEntry[]): void {
    try {
      fs.mkdirSync(this.manifestDir, { recursive: true });
      fs.writeFileSync(this.manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
    } catch (e) {
      logger.warn(`Failed to save snapshot manifest: ${e}`);
    }
  }

  private _prune(manifest: SnapshotEntry[]): void {
    while (manifest.length > this.maxSnapshots) {
      const oldest = manifest.shift()!;
      if (oldest.tag) {
        try {
          spawnSync("docker", ["rmi", oldest.tag], { encoding: "utf-8", timeout: 30000 });
        } catch (e) {
          logger.warn(`Failed to remove old snapshot image ${oldest.tag}: ${e}`);
        }
      }
      const hostSnapId = this._getHostSnapId(oldest);
      const hostDirs = this._getHostDirs(oldest);
      if (this.hostBackend && hostSnapId) {
        this.hostBackend.deleteSnapshot(hostSnapId, hostDirs);
      }
    }
  }

  private _getRestoreCmd(entry: SnapshotEntry): string[] | undefined {
    return entry.restoreCmd ?? entry.restore_cmd;
  }

  private _getHostSnapId(entry: SnapshotEntry): string | undefined {
    return entry.hostSnapId ?? entry.host_snap_id;
  }

  private _getHostDirs(entry: SnapshotEntry): string[] | undefined {
    return entry.hostDirs ?? entry.host_dirs;
  }
}
