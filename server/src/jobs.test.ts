import { describe, expect, it } from 'vitest';
import { createJob, finishJob, listJobs, trimFinishedJobs } from './jobs.js';

describe('trimFinishedJobs', () => {
  it('keeps the newest finished jobs and never drops a running one', () => {
    const running = createJob('test', 'still running', null);
    const done = Array.from({ length: 5 }, (_, i) => {
      const j = createJob('test', `done ${i}`, null);
      j.createdAt = 1000 + i;
      finishJob(j, 'succeeded');
      return j;
    });
    expect(trimFinishedJobs(2)).toBe(3);
    const left = listJobs().map((j) => j.id);
    expect(left).toContain(running.id);
    expect(left).toEqual(expect.arrayContaining([done[4].id, done[3].id]));
    expect(left).not.toContain(done[0].id);
  });
});
