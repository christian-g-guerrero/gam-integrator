import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { dataDir } from './gam/detect.js';
import type { StreamHandle } from './gam/runner.js';

export interface JobLogLine {
  ts: number;
  stream: 'stdout' | 'stderr' | 'info';
  line: string;
}

export interface Job {
  id: string;
  kind: string;
  title: string;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  createdAt: number;
  finishedAt: number | null;
  progress: { done: number; total: number | null };
  log: JobLogLine[];
  handle: StreamHandle | null;
  listeners: Set<(ev: JobEvent) => void>;
  /** Downloadable result file (e.g. a mailbox export CSV). */
  artifact: { path: string; filename: string } | null;
}

export type JobEvent =
  | { type: 'log'; line: JobLogLine }
  | { type: 'progress'; done: number; total: number | null }
  | { type: 'status'; status: Job['status'] };

const jobs = new Map<string, Job>();
export const LOG_DIR = path.join(dataDir(), 'job-logs');
/** Finished jobs kept in memory (the Jobs page + downloads); older ones are dropped. */
const MAX_FINISHED_JOBS = 200;

/** Drop the oldest finished jobs beyond MAX_FINISHED_JOBS. Running jobs are never dropped. */
export function trimFinishedJobs(max = MAX_FINISHED_JOBS): number {
  const finished = [...jobs.values()].filter((j) => j.status !== 'running').sort((a, b) => b.createdAt - a.createdAt);
  const drop = finished.slice(max);
  for (const j of drop) jobs.delete(j.id);
  return drop.length;
}

/** Ids of every job still in memory — their logs and export artifacts are still reachable from the UI. */
export function liveJobIds(): Set<string> {
  return new Set(jobs.keys());
}

export function createJob(kind: string, title: string, total: number | null): Job {
  const job: Job = {
    id: randomUUID(),
    kind,
    title,
    status: 'running',
    createdAt: Date.now(),
    finishedAt: null,
    progress: { done: 0, total },
    log: [],
    handle: null,
    listeners: new Set(),
    artifact: null,
  };
  jobs.set(job.id, job);
  trimFinishedJobs();
  return job;
}

export function jobLog(job: Job, stream: JobLogLine['stream'], line: string): void {
  const entry: JobLogLine = { ts: Date.now(), stream, line };
  job.log.push(entry);
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(path.join(LOG_DIR, `${job.id}.log`), `${new Date(entry.ts).toISOString()} [${stream}] ${line}\n`);
  } catch {
    /* log persistence is best-effort */
  }
  emit(job, { type: 'log', line: entry });
}

export function jobProgress(job: Job, done: number): void {
  job.progress.done = done;
  emit(job, { type: 'progress', done, total: job.progress.total });
}

export function finishJob(job: Job, status: Exclude<Job['status'], 'running'>): void {
  if (job.status !== 'running') return;
  job.status = status;
  job.finishedAt = Date.now();
  emit(job, { type: 'status', status });
}

export function cancelJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job || job.status !== 'running') return false;
  job.handle?.cancel();
  jobLog(job, 'info', 'Cancellation requested…');
  return true;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function listJobs(): Job[] {
  return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
}

function emit(job: Job, ev: JobEvent): void {
  for (const l of job.listeners) l(ev);
}

/** Serializable view (without handle/listeners) for the API. */
export function jobView(job: Job, includeLog = false) {
  return {
    id: job.id,
    kind: job.kind,
    title: job.title,
    status: job.status,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
    progress: job.progress,
    artifact: job.artifact ? { filename: job.artifact.filename } : null,
    ...(includeLog ? { log: job.log } : { logLines: job.log.length }),
  };
}
