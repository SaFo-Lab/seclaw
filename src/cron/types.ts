/**
 * Cron types
 */

export type ScheduleKind = "at" | "every" | "cron";
export type PayloadKind = "system_event" | "agent_turn";
export type JobStatus = "ok" | "error" | "skipped";

export interface CronSchedule {
  kind: ScheduleKind;
  /** For "at": timestamp in ms */
  atMs?: number | null;
  /** For "every": interval in ms */
  everyMs?: number | null;
  /** For "cron": cron expression */
  expr?: string | null;
  /** Timezone for cron expressions */
  tz?: string | null;
}

export interface CronPayload {
  kind: PayloadKind;
  message: string;
  deliver: boolean;
  channel?: string | null;
  to?: string | null;
}

export interface CronJobState {
  nextRunAtMs?: number | null;
  lastRunAtMs?: number | null;
  lastStatus?: JobStatus | null;
  lastError?: string | null;
}

export interface CronJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: CronSchedule;
  payload: CronPayload;
  state: CronJobState;
  createdAtMs: number;
  updatedAtMs: number;
  deleteAfterRun: boolean;
}

export interface CronStore {
  version: number;
  jobs: CronJob[];
}
