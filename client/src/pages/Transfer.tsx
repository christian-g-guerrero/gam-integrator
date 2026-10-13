import { useState } from 'react';
import { Alert, Badge, Box, Button, Card, Divider, Group, Text, TextInput } from '@mantine/core';
import { IconArrowsExchange, IconFile, IconFolder, IconLink, IconSearch } from '@tabler/icons-react';
import { DriveFile, post } from '../api';
import { plural } from '../lib/format';
import { FileBrowser } from '../components/FileBrowser';
import { TransferModal } from '../components/TransferModal';
import { UserSelect } from '../components/UserSelect';
import { ACTION_COLORS, Hint, ICON, notifyError, Page, Section } from '../ui';

/** Both cards (and the divider between them) share one column width. */
const CARD_WIDTH = 640;

/** Pull a Drive file/folder id out of a pasted link (or accept a bare id). */
function parseDriveId(input: string): string | null {
  const s = input.trim();
  const patterns = [
    /\/folders\/([A-Za-z0-9_-]+)/,
    /\/file\/d\/([A-Za-z0-9_-]+)/,
    /\/d\/([A-Za-z0-9_-]+)/,
    /[?&]id=([A-Za-z0-9_-]+)/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return m[1];
  }
  return /^[A-Za-z0-9_-]{5,}$/.test(s) ? s : null;
}

/** Standalone transfer flows: paste a link (owner found automatically) or browse a user's Drive. */
export function Transfer() {
  const [source, setSource] = useState<string | null>(null);
  const [transfer, setTransfer] = useState<{ owner: string; items: DriveFile[] } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [link, setLink] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [located, setLocated] = useState<{ file: DriveFile; scannedUsers: number } | null>(null);

  async function locate() {
    const id = parseDriveId(link);
    if (!id) {
      setLinkError('Could not find a Drive file id in that link.');
      return;
    }
    setLocating(true);
    setLocated(null);
    try {
      const res = await post<{ file: DriveFile; scannedUsers: number }>('/api/transfer/locate', { fileId: id });
      setLocated(res);
    } catch (e) {
      notifyError('Could not locate file', e);
    } finally {
      setLocating(false);
    }
  }

  return (
    <Page title="Transfer ownership">
      <Box maw={CARD_WIDTH}>
        <Section title="Paste a Google Drive link" icon={IconLink}>
          <Text size="sm" c="dimmed">
            The current owner is found automatically.
          </Text>
          <Group align="flex-start" gap="xs">
            <TextInput
              aria-label="Google Drive link or file id"
              placeholder="https://drive.google.com/drive/folders/…  (or a file id)"
              value={link}
              error={linkError}
              onChange={(e) => {
                setLink(e.currentTarget.value);
                setLinkError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && link && !locating) void locate();
              }}
              flex={1}
            />
            <Button
              leftSection={<IconSearch size={ICON.md} aria-hidden />}
              loading={locating}
              disabled={!link}
              onClick={locate}
            >
              Find file
            </Button>
          </Group>
          {locating && (
            <Hint>Scanning every user's Drive in the domain — this can take a little while the first time…</Hint>
          )}
          {located && (
            <Alert
              color="green"
              icon={located.file.isFolder ? <IconFolder size={ICON.md} /> : <IconFile size={ICON.md} />}
              title={located.file.name}
            >
              <Group gap="xs" mb="xs">
                <Badge variant="light" tt="none" size="sm">
                  Owned by {located.file.owner}
                </Badge>
                <Badge variant="light" color="gray">
                  Checked {plural(located.scannedUsers, 'user')}
                </Badge>
              </Group>
              <Button
                size="xs"
                color={ACTION_COLORS.transfer}
                leftSection={<IconArrowsExchange size={ICON.xs} aria-hidden />}
                onClick={() => setTransfer({ owner: located.file.owner, items: [located.file] })}
              >
                Transfer ownership…
              </Button>
            </Alert>
          )}
        </Section>
      </Box>

      <Divider label="or browse a user's Drive" maw={CARD_WIDTH} />

      <Card maw={CARD_WIDTH}>
        <UserSelect label="Browse a user's Drive" value={source} onChange={setSource} />
      </Card>

      {source && (
        <FileBrowser
          owner={source}
          reloadKey={reloadKey}
          renderActions={(f) => (
            <Button
              size="xs"
              variant="light"
              color={ACTION_COLORS.transfer}
              leftSection={<IconArrowsExchange size={ICON.xs} aria-hidden />}
              onClick={() => setTransfer({ owner: source, items: [f] })}
            >
              Transfer ownership…
            </Button>
          )}
        />
      )}
      {!source && !located && (
        <Hint maw={CARD_WIDTH}>
          Tip: the pasted link can point to <b>anyone's</b> file or folder — a deep scan figures out who owns it, so you
          don't need to know beforehand.
        </Hint>
      )}

      <TransferModal target={transfer} onClose={() => setTransfer(null)} onDone={() => setReloadKey((k) => k + 1)} />
    </Page>
  );
}
