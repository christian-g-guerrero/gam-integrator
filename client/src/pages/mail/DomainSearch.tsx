import { useState } from 'react';
import { Badge, Button, Group, Stack, Text, TextInput } from '@mantine/core';
import { IconWorldSearch } from '@tabler/icons-react';
import { MailMessage, post } from '../../api';
import { plural } from '../../lib/format';
import { Hint, ICON, notifyError, TEXT } from '../../ui';
import { MessageTable } from './MessageTable';

/** Run one Gmail query against every mailbox in the domain. */
export function DomainSearch({ onOpen }: { onOpen: (user: string, id: string) => void }) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ results: MailMessage[]; scannedUsers: number; errors: string[] } | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      setResult(await post('/api/mail/search', { q: query, maxPerUser: 20 }));
    } catch (e) {
      notifyError('Could not search mailboxes', e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack gap="sm">
      <Group align="flex-end" gap="xs" maw={720}>
        <TextInput
          label="Search every mailbox (Gmail syntax)"
          placeholder="from:vendor.com subject:invoice after:2026/01/01"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && query && !busy && run()}
          flex={1}
          miw={240}
        />
        <Button
          leftSection={<IconWorldSearch size={ICON.md} aria-hidden />}
          loading={busy}
          disabled={!query}
          onClick={run}
        >
          Search domain
        </Button>
      </Group>
      {busy && <Hint>Searching every mailbox in the domain — this takes a little while…</Hint>}
      {result && (
        <>
          <Group gap="xs">
            <Badge variant="light" color="gray">
              {plural(result.results.length, 'message')} · {plural(result.scannedUsers, 'mailbox', 'mailboxes')} checked
            </Badge>
            {result.errors.length > 0 && (
              <Text size="xs" c={TEXT.warning}>
                {plural(result.errors.length, 'mailbox', 'mailboxes')} could not be read.
              </Text>
            )}
          </Group>
          <MessageTable rows={result.results} showUser onOpen={onOpen} />
        </>
      )}
    </Stack>
  );
}
