/**
 * Snapshot backend factory
 */

import { HostSnapshotBackend } from "./base";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawnSync } from "child_process";
import logger from "../../../utils/logger";

const SNAPSHOT_BASE = path.join(os.homedir(), ".seclaw", "snapshots");
const SNAPSHOT_META_FILE = "meta.json";

interface SnapshotMeta {
  backend: "apfs" | "btrfs";
  dirs: string[];
  createdAt: string;
}

function makeSnapshotId(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function commandExists(cmd: string): boolean {
  const result = spawnSync("which", [cmd], { encoding: "utf-8" });
  return result.status === 0;
}

function normalizeDirs(dirs: string[]): string[] {
  const resolved = dirs.map((dir) => path.resolve(dir));
  return Array.from(new Set(resolved));
}

function markerDir(snapId: string): string {
  return path.join(SNAPSHOT_BASE, snapId);
}

function markerMetaPath(snapId: string): string {
  return path.join(markerDir(snapId), SNAPSHOT_META_FILE);
}

function writeMarkerMeta(snapId: string, meta: SnapshotMeta): void {
  const dir = markerDir(snapId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(markerMetaPath(snapId), JSON.stringify(meta, null, 2), "utf-8");
}

function readMarkerMeta(snapId: string): SnapshotMeta | null {
  const filePath = markerMetaPath(snapId);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as SnapshotMeta;
  } catch (e) {
    logger.warn(`Failed to parse snapshot marker meta for '${snapId}': ${e}`);
    return null;
  }
}

function removeMarker(snapId: string): void {
  const dir = markerDir(snapId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

class RsyncBackend extends HostSnapshotBackend {
  private snapshotBase: string;

  constructor() {
    super();
    this.snapshotBase = SNAPSHOT_BASE;
  }

  isAvailable(): boolean {
    return commandExists("rsync");
  }

  takeSnapshot(dirs: string[]): string | null {
    const snapId = makeSnapshotId();
    const snapDir = path.join(this.snapshotBase, snapId);
    fs.mkdirSync(snapDir, { recursive: true });

    for (const dir of normalizeDirs(dirs)) {
      const dest = path.join(snapDir, path.basename(dir));
      const result = spawnSync("rsync", ["-a", "--delete", `${dir}/`, `${dest}/`], {
        encoding: "utf-8",
      });
      if (result.status !== 0) {
        logger.warn(`rsync snapshot failed for ${dir}: ${result.stderr}`);
        return null;
      }
    }
    logger.info(`Rsync snapshot created: ${snapId}`);
    return snapId;
  }

  restoreSnapshot(snapId: string, dirs: string[]): boolean {
    const snapDir = path.join(this.snapshotBase, snapId);
    if (!fs.existsSync(snapDir)) return false;

    for (const dir of normalizeDirs(dirs)) {
      const src = path.join(snapDir, path.basename(dir));
      if (!fs.existsSync(src)) continue;
      const result = spawnSync("rsync", ["-a", "--delete", `${src}/`, `${dir}/`], {
        encoding: "utf-8",
      });
      if (result.status !== 0) {
        logger.warn(`rsync restore failed for ${dir}: ${result.stderr}`);
        return false;
      }
    }
    return true;
  }

  deleteSnapshot(snapId: string): boolean {
    const snapDir = path.join(this.snapshotBase, snapId);
    if (fs.existsSync(snapDir)) {
      fs.rmSync(snapDir, { recursive: true, force: true });
      return true;
    }
    return false;
  }
}

class ApfsBackend extends HostSnapshotBackend {
  private snapshotBase: string;

  constructor() {
    super();
    this.snapshotBase = SNAPSHOT_BASE;
  }

  isAvailable(): boolean {
    if (process.platform !== "darwin") return false;
    if (!commandExists("tmutil") || !commandExists("rsync")) return false;
    if (!fs.existsSync("/sbin/mount_apfs")) return false;
    return this.fileSystemType(os.homedir()) === "apfs";
  }

  takeSnapshot(dirs: string[]): string | null {
    const watchedDirs = normalizeDirs(dirs);
    for (const dir of watchedDirs) {
      if (this.fileSystemType(dir) !== "apfs") {
        logger.warn(`APFS snapshot requires APFS filesystem: ${dir}`);
        return null;
      }
    }

    const result = spawnSync("tmutil", ["localsnapshot"], {
      encoding: "utf-8",
      timeout: 30000,
    });
    if (result.status !== 0) {
      logger.warn(`tmutil localsnapshot failed: ${result.stderr}`);
      return null;
    }

    const snapId = this.parseSnapshotId(`${result.stdout}\n${result.stderr}`);
    if (!snapId) {
      logger.warn(`Failed to parse APFS snapshot id from tmutil output: ${result.stdout}`);
      return null;
    }

    writeMarkerMeta(snapId, {
      backend: "apfs",
      dirs: watchedDirs,
      createdAt: new Date().toISOString(),
    });

    logger.info(`APFS snapshot created: ${snapId}`);
    return snapId;
  }

  restoreSnapshot(snapId: string, dirs: string[]): boolean {
    const watchedDirs = normalizeDirs(dirs);
    if (watchedDirs.length === 0) return false;

    const snapshotName = `com.apple.TimeMachine.${snapId}.local`;
    let ok = true;

    for (const dir of watchedDirs) {
      const vol = this.volumeInfo(dir);
      if (!vol) {
        logger.warn(`APFS restore failed: cannot resolve volume info for ${dir}`);
        ok = false;
        continue;
      }

      const mountRoot = fs.mkdtempSync(path.join(os.tmpdir(), "seclaw_apfs_"));
      let mounted = false;

      try {
        mounted = this.mountSnapshot(snapshotName, vol.device, mountRoot);
        if (!mounted) {
          ok = false;
          continue;
        }

        const relativePath = path.relative(vol.mountPoint, dir);
        if (relativePath.startsWith("..")) {
          logger.warn(`APFS restore failed: path '${dir}' is outside mount '${vol.mountPoint}'`);
          ok = false;
          continue;
        }

        const snapshotDir = relativePath === "" ? mountRoot : path.join(mountRoot, relativePath);
        if (!fs.existsSync(snapshotDir)) {
          logger.warn(`APFS restore failed: '${snapshotDir}' not found in mounted snapshot`);
          ok = false;
          continue;
        }

        fs.mkdirSync(dir, { recursive: true });
        const rsyncResult = spawnSync("rsync", ["-a", "--delete", `${snapshotDir}/`, `${dir}/`], {
          encoding: "utf-8",
          timeout: 120000,
        });
        if (rsyncResult.status !== 0) {
          logger.warn(`APFS restore rsync failed for ${dir}: ${rsyncResult.stderr}`);
          ok = false;
        }
      } finally {
        if (mounted) this.unmountSnapshot(mountRoot);
        fs.rmSync(mountRoot, { recursive: true, force: true });
      }
    }

    return ok;
  }

  deleteSnapshot(snapId: string): boolean {
    const result = spawnSync("tmutil", ["deletelocalsnapshots", snapId], {
      encoding: "utf-8",
      timeout: 30000,
    });

    if (result.status !== 0) {
      logger.warn(`tmutil deletelocalsnapshots failed for '${snapId}': ${result.stderr}`);
      removeMarker(snapId);
      return false;
    }

    removeMarker(snapId);
    return true;
  }

  private parseSnapshotId(output: string): string | null {
    const match = output.match(/\d{4}-\d{2}-\d{2}-\d{6}/);
    return match ? match[0] : null;
  }

  private fileSystemType(targetPath: string): string | null {
    const result = spawnSync("stat", ["-f", "%T", targetPath], { encoding: "utf-8" });
    if (result.status !== 0) return null;
    return result.stdout.trim().toLowerCase();
  }

  private volumeInfo(targetPath: string): { device: string; mountPoint: string } | null {
    const result = spawnSync("df", ["-P", targetPath], { encoding: "utf-8" });
    if (result.status !== 0) return null;

    const lines = result.stdout.trim().split(/\r?\n/);
    if (lines.length < 2) return null;

    const cols = lines[1].trim().split(/\s+/);
    if (cols.length < 6) return null;

    const device = cols[0];
    const mountPoint = cols[cols.length - 1];
    return { device, mountPoint };
  }

  private mountSnapshot(snapshotName: string, device: string, mountPoint: string): boolean {
    const args = ["-s", snapshotName, "-o", "ro", device, mountPoint];
    const direct = spawnSync("/sbin/mount_apfs", args, { encoding: "utf-8", timeout: 30000 });
    if (direct.status === 0) return true;

    const sudo = spawnSync("sudo", ["-n", "/sbin/mount_apfs", ...args], {
      encoding: "utf-8",
      timeout: 30000,
    });
    if (sudo.status === 0) return true;

    logger.warn(
      `APFS mount failed (${snapshotName} on ${device}): ${String(direct.stderr || "").trim()} ${String(
        sudo.stderr || ""
      ).trim()}`
    );
    return false;
  }

  private unmountSnapshot(mountPoint: string): void {
    const umount = spawnSync("umount", [mountPoint], { encoding: "utf-8", timeout: 30000 });
    if (umount.status === 0) return;

    spawnSync("diskutil", ["unmount", "force", mountPoint], {
      encoding: "utf-8",
      timeout: 30000,
    });
  }
}

class BtrfsBackend extends HostSnapshotBackend {
  private snapshotBase: string;

  constructor() {
    super();
    this.snapshotBase = SNAPSHOT_BASE;
  }

  isAvailable(): boolean {
    if (process.platform !== "linux") return false;
    if (!commandExists("btrfs") || !commandExists("rsync")) return false;
    return this.fileSystemType(os.homedir()) === "btrfs";
  }

  takeSnapshot(dirs: string[]): string | null {
    const watchedDirs = normalizeDirs(dirs);
    const snapId = makeSnapshotId();
    let ok = true;

    for (const dir of watchedDirs) {
      if (this.fileSystemType(dir) !== "btrfs") {
        logger.warn(`btrfs snapshot requires btrfs filesystem: ${dir}`);
        ok = false;
        continue;
      }

      const snapDir = this.snapshotPath(dir, snapId);
      fs.mkdirSync(path.dirname(snapDir), { recursive: true });

      const result = spawnSync("btrfs", ["subvolume", "snapshot", "-r", dir, snapDir], {
        encoding: "utf-8",
        timeout: 60000,
      });
      if (result.status !== 0) {
        logger.warn(`btrfs snapshot failed for ${dir}: ${result.stderr}`);
        ok = false;
      }
    }

    if (!ok) {
      this.deleteSnapshot(snapId, watchedDirs);
      return null;
    }

    writeMarkerMeta(snapId, {
      backend: "btrfs",
      dirs: watchedDirs,
      createdAt: new Date().toISOString(),
    });

    logger.info(`Btrfs snapshot created: ${snapId}`);
    return snapId;
  }

  restoreSnapshot(snapId: string, dirs: string[]): boolean {
    const watchedDirs = normalizeDirs(dirs);
    if (watchedDirs.length === 0) return false;

    let ok = true;
    for (const dir of watchedDirs) {
      const snapDir = this.snapshotPath(dir, snapId);
      if (!fs.existsSync(snapDir)) {
        logger.warn(`btrfs snapshot path not found for restore: ${snapDir}`);
        ok = false;
        continue;
      }

      fs.mkdirSync(dir, { recursive: true });
      const result = spawnSync("rsync", ["-a", "--delete", `${snapDir}/`, `${dir}/`], {
        encoding: "utf-8",
        timeout: 120000,
      });
      if (result.status !== 0) {
        logger.warn(`btrfs restore failed for ${dir}: ${result.stderr}`);
        ok = false;
      }
    }

    return ok;
  }

  deleteSnapshot(snapId: string, dirs?: string[]): boolean {
    const watchedDirs =
      dirs && dirs.length > 0
        ? normalizeDirs(dirs)
        : normalizeDirs(readMarkerMeta(snapId)?.dirs ?? []);

    if (watchedDirs.length === 0) {
      removeMarker(snapId);
      return false;
    }

    let ok = true;
    for (const dir of watchedDirs) {
      const snapDir = this.snapshotPath(dir, snapId);
      if (!fs.existsSync(snapDir)) continue;

      const result = spawnSync("btrfs", ["subvolume", "delete", snapDir], {
        encoding: "utf-8",
        timeout: 30000,
      });
      if (result.status !== 0) {
        logger.warn(`btrfs snapshot delete failed for ${snapDir}: ${result.stderr}`);
        ok = false;
        continue;
      }

      this.cleanupSnapshotTree(dir, snapId);
    }

    removeMarker(snapId);
    return ok;
  }

  private fileSystemType(targetPath: string): string | null {
    const result = spawnSync("stat", ["-f", "-c", "%T", targetPath], { encoding: "utf-8" });
    if (result.status !== 0) return null;
    return result.stdout.trim().toLowerCase();
  }

  private snapshotPath(liveDir: string, snapId: string): string {
    const resolved = path.resolve(liveDir);
    const name = path.basename(resolved) || "_root";
    return path.join(path.dirname(resolved), ".seclaw_snaps", snapId, name);
  }

  private cleanupSnapshotTree(liveDir: string, snapId: string): void {
    const resolved = path.resolve(liveDir);
    const snapIdDir = path.join(path.dirname(resolved), ".seclaw_snaps", snapId);
    const snapshotRoot = path.join(path.dirname(resolved), ".seclaw_snaps");

    try {
      if (fs.existsSync(snapIdDir) && fs.readdirSync(snapIdDir).length === 0) {
        fs.rmdirSync(snapIdDir);
      }
    } catch {
      // ignore cleanup failure
    }

    try {
      if (fs.existsSync(snapshotRoot) && fs.readdirSync(snapshotRoot).length === 0) {
        fs.rmdirSync(snapshotRoot);
      }
    } catch {
      // ignore cleanup failure
    }
  }
}

export function getBackend(): HostSnapshotBackend | null {
  if (process.platform === "darwin") {
    const apfs = new ApfsBackend();
    if (apfs.isAvailable()) return apfs;
    logger.warn("APFS backend unavailable; falling back to rsync backend");
  } else if (process.platform === "linux") {
    const btrfs = new BtrfsBackend();
    if (btrfs.isAvailable()) return btrfs;
    logger.warn("Btrfs backend unavailable; falling back to rsync backend");
  }

  const rsync = new RsyncBackend();
  return rsync.isAvailable() ? rsync : null;
}

export { HostSnapshotBackend };
