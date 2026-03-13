/**
 * Cron service
 */

import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../utils/logger";
import {
  CronJob,
  CronJobState,
  CronPayload,
  CronSchedule,
  CronStore,
} from "./types";

function nowMs(): number {
  return Date.now();
}

function computeNextRun(schedule: CronSchedule, nowMs: number): number | null {
  if (schedule.kind === "at") {
    return schedule.atMs && schedule.atMs > nowMs ? schedule.atMs : null;
  }

  if (schedule.kind === "every") {
    if (!schedule.everyMs || schedule.everyMs <= 0) return null;
    return nowMs + schedule.everyMs;
  }

  if (schedule.kind === "cron" && schedule.expr) {
    try {
      // Use the cron package for parsing
      const { CronTime } = require("cron");
      const ct = new CronTime(schedule.expr, schedule.tz ?? "UTC");
      const next = ct.sendAt();
      return next.toMillis ? next.toMillis() : next.getTime();
    } catch {
      return null;
    }
  }

  return null;
}

type JobCallback = (job: CronJob) => Promise<string | null>;

export class CronService {
  storePath: string;
  onJob: JobCallback | null;
  private _store: CronStore | null = null;
  private _timerHandle: ReturnType<typeof setTimeout> | null = null;
  private _running = false;

  constructor(storePath: string, onJob?: JobCallback | null) {
    this.storePath = storePath;
    this.onJob = onJob ?? null;
  }

  private _loadStore(): CronStore {
    if (this._store) return this._store;

    if (fs.existsSync(this.storePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.storePath, "utf8")) as Record<string, unknown>;
        const jobs: CronJob[] = (
          (data["jobs"] as Record<string, unknown>[]) ?? []
        ).map((j) => ({
          id: j["id"] as string,
          name: j["name"] as string,
          enabled: (j["enabled"] as boolean) ?? true,
          schedule: {
            kind: ((j["schedule"] as Record<string, unknown>)?.["kind"] ?? "every") as "at" | "every" | "cron",
            atMs: ((j["schedule"] as Record<string, unknown>)?.["atMs"] as number) ?? null,
            everyMs: ((j["schedule"] as Record<string, unknown>)?.["everyMs"] as number) ?? null,
            expr: ((j["schedule"] as Record<string, unknown>)?.["expr"] as string) ?? null,
            tz: ((j["schedule"] as Record<string, unknown>)?.["tz"] as string) ?? null,
          },
          payload: {
            kind: (((j["payload"] as Record<string, unknown>)?.["kind"] as string) ?? "agent_turn") as "system_event" | "agent_turn",
            message: ((j["payload"] as Record<string, unknown>)?.["message"] as string) ?? "",
            deliver: ((j["payload"] as Record<string, unknown>)?.["deliver"] as boolean) ?? false,
            channel: ((j["payload"] as Record<string, unknown>)?.["channel"] as string) ?? null,
            to: ((j["payload"] as Record<string, unknown>)?.["to"] as string) ?? null,
          },
          state: {
            nextRunAtMs: ((j["state"] as Record<string, unknown>)?.["nextRunAtMs"] as number) ?? null,
            lastRunAtMs: ((j["state"] as Record<string, unknown>)?.["lastRunAtMs"] as number) ?? null,
            lastStatus: ((j["state"] as Record<string, unknown>)?.["lastStatus"] as string) ?? null,
            lastError: ((j["state"] as Record<string, unknown>)?.["lastError"] as string) ?? null,
          } as CronJobState,
          createdAtMs: (j["createdAtMs"] as number) ?? 0,
          updatedAtMs: (j["updatedAtMs"] as number) ?? 0,
          deleteAfterRun: (j["deleteAfterRun"] as boolean) ?? false,
        }));
        this._store = { version: (data["version"] as number) ?? 1, jobs };
      } catch (e) {
        logger.warn({ err: e }, "Failed to load cron store");
        this._store = { version: 1, jobs: [] };
      }
    } else {
      this._store = { version: 1, jobs: [] };
    }

    return this._store;
  }

  private _saveStore(): void {
    if (!this._store) return;
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });

    const data = {
      version: this._store.version,
      jobs: this._store.jobs.map((j) => ({
        id: j.id,
        name: j.name,
        enabled: j.enabled,
        schedule: {
          kind: j.schedule.kind,
          atMs: j.schedule.atMs ?? null,
          everyMs: j.schedule.everyMs ?? null,
          expr: j.schedule.expr ?? null,
          tz: j.schedule.tz ?? null,
        },
        payload: {
          kind: j.payload.kind,
          message: j.payload.message,
          deliver: j.payload.deliver,
          channel: j.payload.channel ?? null,
          to: j.payload.to ?? null,
        },
        state: {
          nextRunAtMs: j.state.nextRunAtMs ?? null,
          lastRunAtMs: j.state.lastRunAtMs ?? null,
          lastStatus: j.state.lastStatus ?? null,
          lastError: j.state.lastError ?? null,
        },
        createdAtMs: j.createdAtMs,
        updatedAtMs: j.updatedAtMs,
        deleteAfterRun: j.deleteAfterRun,
      })),
    };

    fs.writeFileSync(this.storePath, JSON.stringify(data, null, 2));
  }

  async start(): Promise<void> {
    this._running = true;
    this._loadStore();
    this._recomputeNextRuns();
    this._saveStore();
    this._armTimer();
    const count = this._store?.jobs.length ?? 0;
    logger.info(`Cron service started with ${count} jobs`);
  }

  stop(): void {
    this._running = false;
    if (this._timerHandle) {
      clearTimeout(this._timerHandle);
      this._timerHandle = null;
    }
  }

  private _recomputeNextRuns(): void {
    if (!this._store) return;
    const now = nowMs();
    for (const job of this._store.jobs) {
      if (job.enabled) {
        job.state.nextRunAtMs = computeNextRun(job.schedule, now);
      }
    }
  }

  private _getNextWakeMs(): number | null {
    if (!this._store) return null;
    const times = this._store.jobs
      .filter((j) => j.enabled && j.state.nextRunAtMs)
      .map((j) => j.state.nextRunAtMs as number);
    return times.length > 0 ? Math.min(...times) : null;
  }

  private _armTimer(): void {
    if (this._timerHandle) {
      clearTimeout(this._timerHandle);
      this._timerHandle = null;
    }

    const nextWake = this._getNextWakeMs();
    if (!nextWake || !this._running) return;

    const delayMs = Math.max(0, nextWake - nowMs());
    this._timerHandle = setTimeout(() => {
      if (this._running) {
        this._onTimer().catch((e) =>
          logger.error({ err: e }, "Cron timer error")
        );
      }
    }, delayMs);
  }

  private async _onTimer(): Promise<void> {
    if (!this._store) return;

    const now = nowMs();
    const dueJobs = this._store.jobs.filter(
      (j) => j.enabled && j.state.nextRunAtMs != null && now >= j.state.nextRunAtMs!
    );

    for (const job of dueJobs) {
      await this._executeJob(job);
    }

    this._saveStore();
    this._armTimer();
  }

  private async _executeJob(job: CronJob): Promise<void> {
    const startMs = nowMs();
    logger.info({ jobId: job.id, jobName: job.name }, "Cron: executing job");

    try {
      if (this.onJob) {
        await this.onJob(job);
      }
      job.state.lastStatus = "ok";
      job.state.lastError = null;
      logger.info({ jobId: job.id }, "Cron: job completed");
    } catch (e) {
      job.state.lastStatus = "error";
      job.state.lastError = String(e);
      logger.error({ err: e, jobId: job.id }, "Cron: job failed");
    }

    job.state.lastRunAtMs = startMs;
    job.updatedAtMs = nowMs();

    if (job.schedule.kind === "at") {
      if (job.deleteAfterRun) {
        this._store!.jobs = this._store!.jobs.filter((j) => j.id !== job.id);
      } else {
        job.enabled = false;
        job.state.nextRunAtMs = null;
      }
    } else {
      job.state.nextRunAtMs = computeNextRun(job.schedule, nowMs());
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  listJobs(includeDisabled = false): CronJob[] {
    const store = this._loadStore();
    const jobs = includeDisabled ? store.jobs : store.jobs.filter((j) => j.enabled);
    return jobs.sort(
      (a, b) => (a.state.nextRunAtMs ?? Infinity) - (b.state.nextRunAtMs ?? Infinity)
    );
  }

  addJob(opts: {
    name: string;
    schedule: CronSchedule;
    message: string;
    deliver?: boolean;
    channel?: string | null;
    to?: string | null;
    deleteAfterRun?: boolean;
  }): CronJob {
    const store = this._loadStore();
    const now = nowMs();

    const job: CronJob = {
      id: uuidv4().slice(0, 8),
      name: opts.name,
      enabled: true,
      schedule: opts.schedule,
      payload: {
        kind: "agent_turn",
        message: opts.message,
        deliver: opts.deliver ?? false,
        channel: opts.channel ?? null,
        to: opts.to ?? null,
      },
      state: {
        nextRunAtMs: computeNextRun(opts.schedule, now),
      },
      createdAtMs: now,
      updatedAtMs: now,
      deleteAfterRun: opts.deleteAfterRun ?? false,
    };

    store.jobs.push(job);
    this._saveStore();
    this._armTimer();
    logger.info({ jobId: job.id, jobName: opts.name }, "Cron: added job");
    return job;
  }

  removeJob(jobId: string): boolean {
    const store = this._loadStore();
    const before = store.jobs.length;
    store.jobs = store.jobs.filter((j) => j.id !== jobId);
    const removed = store.jobs.length < before;

    if (removed) {
      this._saveStore();
      this._armTimer();
      logger.info({ jobId }, "Cron: removed job");
    }

    return removed;
  }

  enableJob(jobId: string, enabled = true): CronJob | null {
    const store = this._loadStore();
    const job = store.jobs.find((j) => j.id === jobId);
    if (!job) return null;

    job.enabled = enabled;
    job.updatedAtMs = nowMs();
    job.state.nextRunAtMs = enabled
      ? computeNextRun(job.schedule, nowMs())
      : null;
    this._saveStore();
    this._armTimer();
    return job;
  }

  async runJob(jobId: string, force = false): Promise<boolean> {
    const store = this._loadStore();
    const job = store.jobs.find((j) => j.id === jobId);
    if (!job) return false;
    if (!force && !job.enabled) return false;

    await this._executeJob(job);
    this._saveStore();
    this._armTimer();
    return true;
  }

  status(): Record<string, unknown> {
    const store = this._loadStore();
    return {
      enabled: this._running,
      jobs: store.jobs.length,
      nextWakeAtMs: this._getNextWakeMs(),
    };
  }
}
