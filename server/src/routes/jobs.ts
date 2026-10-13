import { Router } from 'express';
import { cancelJob, getJob, listJobs, jobView } from '../jobs.js';
import { h } from '../util.js';

export const jobsRouter = Router();

jobsRouter.get(
  '/',
  h((_req, res) => {
    res.json(listJobs().map((j) => jobView(j)));
  }),
);

jobsRouter.get(
  '/:id',
  h((req, res) => {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(jobView(job, true));
  }),
);

/** Live job updates via Server-Sent Events. */
jobsRouter.get(
  '/:id/events',
  h((req, res) => {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const send = (ev: unknown) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
    send({ type: 'snapshot', job: jobView(job, true) });
    const listener = (ev: unknown) => send(ev);
    job.listeners.add(listener);
    req.on('close', () => job.listeners.delete(listener));
  }),
);

jobsRouter.post(
  '/:id/cancel',
  h((req, res) => {
    res.json({ cancelled: cancelJob(req.params.id) });
  }),
);

/** Download a job's result file (e.g. mailbox export). */
jobsRouter.get(
  '/:id/download',
  h((req, res) => {
    const job = getJob(req.params.id);
    if (!job?.artifact) return res.status(404).json({ error: 'This job has no downloadable result.' });
    // Exports live under ~/.gam-integrator/; Express 5 refuses paths through a dot-directory unless allowed.
    res.download(job.artifact.path, job.artifact.filename, { dotfiles: 'allow' });
  }),
);

jobsRouter.get(
  '/:id/results.csv',
  h((req, res) => {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const csv = [
      'timestamp,stream,line',
      ...job.log.map((l) => `${new Date(l.ts).toISOString()},${l.stream},${esc(l.line)}`),
    ].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="job-${job.id}.csv"`);
    res.send(csv);
  }),
);
