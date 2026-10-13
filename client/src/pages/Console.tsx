import { useState } from 'react';
import { Alert, Button, Code, Group, Text, TextInput } from '@mantine/core';
import { IconAlertTriangle, IconPlayerPlay, IconTerminal2 } from '@tabler/icons-react';
import { ApiError, post } from '../api';
import { Term } from '../components/Term';
import { ConfirmModal, ICON, notifyError, Page } from '../ui';

/** Guarded "run any gam command" panel. */
export function Console() {
  const [command, setCommand] = useState('gam info domain');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  // Tracks whether the spawned PTY process is still alive server-side — `running`
  // only covers the /api/console/run request itself, which returns as soon as a
  // session id is issued, not when the process exits.
  const [processRunning, setProcessRunning] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);

  async function run(cmd: string, confirmed = false) {
    setRunning(true);
    try {
      const { sessionId: sid } = await post<{ sessionId: string }>('/api/console/run', { command: cmd, confirmed });
      setSessionId(sid);
      setProcessRunning(true);
      setHistory((h) => [cmd, ...h.filter((c) => c !== cmd)].slice(0, 10));
      setPendingConfirm(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setPendingConfirm(cmd);
      } else {
        notifyError('Could not run command', e);
      }
    } finally {
      setRunning(false);
    }
  }

  return (
    <Page title="Command console" width="focused">
      <Alert color="blue" icon={<IconTerminal2 size={ICON.md} aria-hidden />}>
        Run any GAM command here — same syntax as the terminal, e.g.{' '}
        <Code>gam user someone@yourdomain.com show filelist</Code>. Only <Code>gam</Code> commands are accepted, and
        destructive ones (delete, wipe, trash…) ask for confirmation first.
      </Alert>
      <Group align="flex-end" gap="xs">
        <TextInput
          label="GAM command"
          value={command}
          onChange={(e) => setCommand(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !running && !processRunning) void run(command);
          }}
          flex={1}
          ff="monospace"
        />
        <Button
          leftSection={<IconPlayerPlay size={ICON.md} aria-hidden />}
          loading={running}
          disabled={processRunning}
          onClick={() => void run(command)}
        >
          {processRunning ? 'Running…' : 'Run'}
        </Button>
      </Group>
      {history.length > 1 && (
        <Group gap="xs">
          <Text size="xs" c="dimmed">
            Recent:
          </Text>
          {history.slice(0, 5).map((c) => (
            <Button key={c} size="compact-xs" variant="light" color="gray" onClick={() => setCommand(c)}>
              <Text size="xs" ff="monospace" truncate maw={260}>
                {c}
              </Text>
            </Button>
          ))}
        </Group>
      )}
      {sessionId && <Term sessionId={sessionId} height={420} onExit={() => setProcessRunning(false)} />}

      <ConfirmModal
        opened={pendingConfirm !== null}
        onClose={() => setPendingConfirm(null)}
        onConfirm={() => {
          if (pendingConfirm) void run(pendingConfirm, true);
        }}
        title="Run destructive command?"
        confirmLabel="Run command"
        loading={running}
      >
        <Alert color="red" icon={<IconAlertTriangle size={ICON.md} aria-hidden />}>
          This command looks destructive and may permanently change or remove data.
        </Alert>
        <Code block>{pendingConfirm}</Code>
      </ConfirmModal>
    </Page>
  );
}
