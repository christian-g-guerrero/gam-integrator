import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ActionIcon, Button, Group, Menu, Text } from '@mantine/core';
import {
  IconArrowsExchange,
  IconCopy,
  IconDots,
  IconDownload,
  IconFolderSymlink,
  IconMailSearch,
  IconShare,
} from '@tabler/icons-react';
import { DriveFile, endpoints, routes } from '../api';
import { plural } from '../lib/format';
import { useUsers } from '../lib/useUsers';
import { FileBrowser } from '../components/FileBrowser';
import { TransferModal } from '../components/TransferModal';
import { AclModal } from '../components/AclModal';
import { CopyMoveModal } from '../components/CopyMoveModal';
import { AccentCard, ACTION_COLORS, Hint, ICON, Page } from '../ui';

/** A single user's Drive: browse, select, transfer, share, copy/move. */
export function Drive() {
  const { email = '' } = useParams();
  // name lookup is cosmetic; page still works with the raw email, so the
  // hook's `error` is intentionally ignored here (no ErrorAlert).
  const { data: users } = useUsers();
  const name = useMemo(() => users?.find((u) => u.email === email)?.name ?? null, [users, email]);
  const [transferItems, setTransferItems] = useState<DriveFile[] | null>(null);
  const [aclFile, setAclFile] = useState<DriveFile | null>(null);
  const [copyMove, setCopyMove] = useState<{ files: DriveFile[]; mode: 'copy' | 'move' } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [allFiles, setAllFiles] = useState<DriveFile[]>([]);

  const reload = () => {
    setReloadKey((k) => k + 1);
    setSelection(new Set());
  };
  const selectedFiles = allFiles.filter((f) => selection.has(f.id));

  return (
    <Page
      title={`${name || email}'s Drive`}
      backTo="/users"
      backLabel="Drive audit"
      actions={
        <>
          <Button
            component={Link}
            to={routes.mailbox(email)}
            leftSection={<IconMailSearch size={ICON.xs} aria-hidden />}
            variant="subtle"
            size="xs"
          >
            View mailbox
          </Button>
          <Button
            component="a"
            href={endpoints.userFilesExport(email)}
            leftSection={<IconDownload size={ICON.xs} aria-hidden />}
            variant="light"
            color={ACTION_COLORS.export}
            size="xs"
          >
            Download CSV
          </Button>
        </>
      }
    >
      {selection.size > 0 && (
        <AccentCard padding="xs">
          <Group gap="sm">
            <Text size="sm" fw={600}>
              {plural(selection.size, 'item')} selected
            </Text>
            <Button
              size="xs"
              variant="light"
              color={ACTION_COLORS.transfer}
              leftSection={<IconArrowsExchange size={ICON.xs} aria-hidden />}
              onClick={() => setTransferItems(selectedFiles)}
            >
              Transfer ownership…
            </Button>
            <Button
              size="xs"
              variant="light"
              leftSection={<IconFolderSymlink size={ICON.xs} aria-hidden />}
              onClick={() => setCopyMove({ files: selectedFiles, mode: 'move' })}
            >
              Move to folder…
            </Button>
            <Button size="xs" variant="subtle" color="gray" onClick={() => setSelection(new Set())}>
              Clear
            </Button>
          </Group>
        </AccentCard>
      )}

      <FileBrowser
        owner={email}
        reloadKey={reloadKey}
        selection={selection}
        onSelectionChange={setSelection}
        onFilesLoaded={setAllFiles}
        renderActions={(f) => (
          <Menu keepMounted>
            <Menu.Target>
              <ActionIcon variant="subtle" aria-label={`Actions for ${f.name}`}>
                <IconDots size={ICON.md} aria-hidden />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<IconArrowsExchange size={ICON.md} aria-hidden />}
                onClick={() => setTransferItems([f])}
              >
                Transfer ownership…
              </Menu.Item>
              <Menu.Item leftSection={<IconShare size={ICON.md} aria-hidden />} onClick={() => setAclFile(f)}>
                Manage sharing…
              </Menu.Item>
              <Menu.Item
                leftSection={<IconCopy size={ICON.md} aria-hidden />}
                onClick={() => setCopyMove({ files: [f], mode: 'copy' })}
              >
                Copy…
              </Menu.Item>
              <Menu.Item
                leftSection={<IconFolderSymlink size={ICON.md} aria-hidden />}
                onClick={() => setCopyMove({ files: [f], mode: 'move' })}
              >
                Move to folder…
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )}
      />
      <Hint>
        Tip: use the checkboxes to select several items, then transfer or move them in one go. Click a folder name to
        open it; transferring a folder includes everything inside it.
      </Hint>

      <TransferModal
        target={transferItems && { owner: email, items: transferItems }}
        onClose={() => setTransferItems(null)}
        onDone={reload}
      />
      <AclModal target={aclFile && { owner: email, file: aclFile }} onClose={() => setAclFile(null)} />
      <CopyMoveModal
        target={copyMove && { owner: email, ...copyMove }}
        onClose={() => setCopyMove(null)}
        onDone={reload}
      />
    </Page>
  );
}
