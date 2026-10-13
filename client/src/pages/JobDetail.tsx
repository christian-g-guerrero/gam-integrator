import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Code, Group, Paper, Progress, ScrollArea, Text, Tooltip } from '@mantine/core';
import { IconDownload, IconPlayerStop } from '@tabler/icons-react';
import { api, endpoints, JobSummary, post } from '../api';
import { fmtTime } from '../lib/format';
import {
  ACTION_COLORS,
  ConfirmModal,
  ErrorAlert,
  ICON,
  LoadingState,
  notifyError,
  notifySuccess,
  Page,
  StatusBadge,
} from '../ui';

/** Statuses that mean the job is done running — no more events will follow. */
const TERMINAL_STATUSES = new Set<JobSummary['status']>(['succeeded', 'failed', 'cancelled']);

export function JobDetail() {
  const { id = '' } = useParams();
  const [job, setJob] = useState<JobSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<{ ts: number; stream: string; line: string }[]>([]);
  const [connectionLost, setConnectionLost] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false; // unmounted before the fetch resolved (or since) — genuine teardown only
    let done = false; // job reached a terminal status — stream deliberately closed, not an error
    api<JobSummary>(endpoints.job(id)).then(
      (j) => {
        if (closed) return;
        setJob(j);
        setLog(j.log ?? []);
        if (TERMINAL_STATUSES.has(j.status)) return; // already done — no need to open the stream
        es = new EventSource(endpoints.jobEvents(id));
        es.onmessage = (e) => {
          setConnectionLost(false);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped SSE frame, checked field by field below
          let ev: any;
          try {
            ev = JSON.parse(e.data);
          } catch {
            return; // drop malformed frames
          }
          if (ev.type === 'snapshot') {
            setJob(ev.job);
            setLog(ev.job.log ?? []);
          } else if (ev.type === 'log') {
            setLog((l) => [...l, ev.line]);
          } else if (ev.type === 'progress') {
            setJob((j) => (j ? { ...j, progress: { done: ev.done, total: ev.total } } : j));
          } else if (ev.type === 'status') {
            setJob((j) => (j ? { ...j, status: ev.status } : j));
            if (TERMINAL_STATUSES.has(ev.status)) {
              // completion may attach a downloadable artifact/finishedAt — pick those up,
              // keeping everything else (esp. the log we've been accumulating) as-is.
              api<JobSummary>(endpoints.job(id)).then(
                (fresh) => {
                  if (closed) return;
                  setJob((prev) =>
                    prev
                      ? { ...prev, artifact: fresh.artifact, status: fresh.status, finishedAt: fresh.finishedAt }
                      : fresh,
                  );
                },
                (e: Error) => {
                  if (!closed) setError(e.message);
                },
              );
              done = true;
              es?.close();
            }
          }
        };
        es.onerror = () => {
          if (!closed && !done) setConnectionLost(true);
        };
      },
      (e: Error) => {
        if (!closed) setError(e.message);
      },
    );
    return () => {
      closed = true;
      es?.close();
    };
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log.length]);

  const cancelJob = async () => {
    setCancelling(true);
    try {
      await post(endpoints.jobCancel(id), {});
      notifySuccess('Job cancelled.');
      setConfirmCancel(false);
    } catch (e) {
      notifyError('Could not cancel job', e);
    } finally {
      setCancelling(false);
    }
  };

  if (error) {
    return (
      <Page title="Job" width="focused" backTo="/jobs" backLabel="Jobs">
        <ErrorAlert title="Could not load this job">{error}</ErrorAlert>
      </Page>
    );
  }
  if (!job) {
    return (
      <Page title="Job" width="focused" backTo="/jobs" backLabel="Jobs">
        <LoadingState label="Loading job…" />
      </Page>
    );
  }

  const pct = job.progress.total ? (100 * job.progress.done) / job.progress.total : null;

  return (
    <Page
      title={job.title}
      width="focused"
      backTo="/jobs"
      backLabel="Jobs"
      actions={<StatusBadge status={job.status} size="lg" />}
    >
      {pct !== null && (
        <Group gap="sm">
          <Progress
            value={pct}
            size="xl"
            striped={job.status === 'running'}
            animated={job.status === 'running'}
            aria-label={`${job.progress.done} of ${job.progress.total}`}
            flex={1}
          />
          <Text size="sm" c="dimmed" className="gam-num">
            {job.progress.done}/{job.progress.total}
          </Text>
        </Group>
      )}
      <Group>
        {job.status === 'running' && (
          <Button
            color="red"
            variant="light"
            leftSection={<IconPlayerStop size={ICON.md} aria-hidden />}
            onClick={() => setConfirmCancel(true)}
          >
            Cancel job
          </Button>
        )}
        {job.artifact && job.status !== 'running' && (
          // The filename (mailbox-<email>-<stamp>.zip) is too long for a button on a phone — it's in the
          // tooltip; the label keeps the one fact that changes what you got: a partial export.
          <Tooltip label={job.artifact.filename}>
            <Button
              component="a"
              href={endpoints.jobDownload(id)}
              color={ACTION_COLORS.export}
              leftSection={<IconDownload size={ICON.md} aria-hidden />}
            >
              {job.artifact.filename.includes('-PARTIAL') ? 'Download partial export' : 'Download export'}
            </Button>
          </Tooltip>
        )}
        <Button
          component="a"
          href={endpoints.jobResults(id)}
          variant="light"
          color={ACTION_COLORS.export}
          leftSection={<IconDownload size={ICON.md} aria-hidden />}
        >
          Download log CSV
        </Button>
      </Group>
      {connectionLost && (
        <Text size="sm" c="dimmed">
          Connection lost — retrying…
        </Text>
      )}
      <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
        <ScrollArea.Autosize mah={460}>
          <Code block fz="xs" ff="monospace" style={{ whiteSpace: 'pre-wrap' }}>
            {log.map((l) => `${fmtTime(l.ts)} ${l.stream === 'stderr' ? '⚠ ' : ''}${l.line}`).join('\n') ||
              'Waiting for output…'}
          </Code>
          <div ref={bottomRef} />
        </ScrollArea.Autosize>
      </Paper>
      <ConfirmModal
        opened={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => void cancelJob()}
        title="Cancel this job?"
        confirmLabel="Cancel job"
        loading={cancelling}
      >
        <Text size="sm">Its running GAM commands are stopped. Work it already finished is not undone.</Text>
      </ConfirmModal>
    </Page>
  );
}
