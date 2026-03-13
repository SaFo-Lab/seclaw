/**
 * Host snapshot backend base
 */

export abstract class HostSnapshotBackend {
  abstract isAvailable(): boolean;
  abstract takeSnapshot(dirs: string[]): string | null;
  abstract restoreSnapshot(snapId: string, dirs: string[]): boolean;
  abstract deleteSnapshot(snapId: string, dirs?: string[]): boolean;
}
