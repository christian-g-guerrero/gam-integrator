import { useState } from 'react';
import { Alert, Badge, Button, Checkbox, Group, Modal, ScrollArea, Stack, Table, Text, TextInput } from '@mantine/core';
import { useNavigate } from 'react-router-dom';
import { IconAlertTriangle, IconArrowsExchange, IconFile, IconFolder, IconInfoCircle } from '@tabler/icons-react';
import { DriveFile, post } from '../api';
import { plural } from '../lib/format';
import { ACTION_COLORS, DISABLED_OPACITY, ICON, type ModalProps, notifyError, notifySuccess, TEXT } from '../ui';
import { FolderSelect } from './FolderSelect';
import { UserSelect } from './UserSelect';

interface Preview {
  count: number;
  files: { id: string; name: string; mimeType: string; isFolder: boolean; owner: string }[];
  owners: { email: string; count: number }[];
  deep: boolean;
  scannedUsers: number;
  scanErrors: string[];
}

interface TransferTarget {
  /** Current owner the transfer starts from (the server payload calls this sourceUser). */
  owner: string;
  /** One or more files/folders to transfer. */
  items: DriveFile[];
}

/** Ownership-transfer flow: new-owner picker → dry-run preview (optionally deep) → confirm → job. */
export function TransferModal({ target, onClose, onDone }: ModalProps<TransferTarget>) {
  if (!target || target.items.length === 0) return null;
  return <TransferDialog sourceUser={target.owner} items={target.items} onClose={onClose} onDone={onDone} />;
}

function TransferDialog({
  sourceUser,
  items,
  onClose,
  onDone,
}: { sourceUser: string; items: DriveFile[] } & Omit<ModalProps<TransferTarget>, 'target'>) {
  const [newOwner, setNewOwner] = useState<string | null>(null);
  const [recursive, setRecursive] = useState(true);
  const [claimAll, setClaimAll] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [destFolder, setDestFolder] = useState<string | null>(null);
  const navigate = useNavigate();

  const isBulk = items.length > 1;
  const hasFolder = items.some((f) => f.isFolder);
  const label = isBulk ? plural(items.length, 'item') : items[0].name;
  // Recursive only matters when folders are involved; bulk selections always recurse.
  const effRecursive = hasFolder && (isBulk || recursive);
  const consolidate = newOwner === sourceUser;
  const confirmWord = isBulk ? 'TRANSFER' : items[0].name;
  const needsTypedConfirm = hasFolder && effRecursive;

  const sourceCount = preview?.owners.find((o) => o.email === sourceUser)?.count ?? 0;
  const newOwnerCount = preview?.owners.find((o) => o.email === newOwner)?.count ?? 0;
  const otherOwners = preview?.owners.filter((o) => o.email !== sourceUser) ?? [];
  const othersCount = otherOwners.reduce((s, o) => s + o.count, 0);
  const affectedCount = !preview
    ? undefined
    : effRecursive
      ? consolidate || claimAll || preview.deep
        ? preview.count - newOwnerCount
        : sourceCount
      : items.filter((f) => f.owner !== newOwner).length;

  async function loadPreview(deep = false) {
    setBusy(true);
    try {
      const p = await post<Preview>('/api/transfer/preview', {
        sourceUser,
        fileIds: items.map((f) => f.id),
        deep,
      });
      setPreview(p);
      // default to consolidating when the selection contains other people's files
      setClaimAll(p.owners.some((o) => o.email !== sourceUser));
    } catch (e) {
      notifyError(deep ? 'Could not run deep scan' : 'Could not preview transfer', e);
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    setBusy(true);
    try {
      const { jobId } = await post<{ jobId: string }>('/api/transfer/start', {
        sourceUser,
        targetUser: newOwner,
        fileIds: items.map((f) => f.id),
        recursive: effRecursive,
        claimAll,
        deep: preview?.deep ?? false,
        targetFolderId: destFolder,
        label,
      });
      notifySuccess('Follow progress on the job page.', 'Transfer started');
      onDone?.();
      onClose();
      void navigate(`/jobs/${jobId}`);
    } catch (e) {
      notifyError('Could not start transfer', e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal opened onClose={onClose} title={`Transfer ownership — ${label}`} size="lg">
      <Stack gap="sm">
        <Group gap="xs">
          <Text size="sm">Current owner</Text>
          <Badge variant="light" tt="none" size="sm">
            {sourceUser}
          </Badge>
        </Group>
        <UserSelect
          label="New owner"
          leftSection={<IconArrowsExchange size={ICON.md} aria-hidden />}
          optionLabel={(u) =>
            u.email === sourceUser ? `${u.name} <${u.email}> — same user (consolidate)` : `${u.name} <${u.email}>`
          }
          value={newOwner}
          onChange={(v) => {
            setNewOwner(v);
            // Destination folders live in the NEW owner's Drive.
            setDestFolder(null);
          }}
        />

        {newOwner && (
          <FolderSelect
            key={newOwner}
            owner={newOwner}
            exclude={items.map((f) => f.id)}
            label={`After the transfer, move the selected ${isBulk ? 'items' : 'item'} into a folder in ${newOwner}'s Drive (optional)`}
            rootLabel={`My Drive (root of ${newOwner})`}
            placeholder="Leave where they are"
            clearable
            value={destFolder}
            onChange={setDestFolder}
          />
        )}

        {isBulk && (
          <Text size="sm" c="dimmed">
            {plural(items.length, 'selected item')}
            {hasFolder && ' — folders transfer with everything inside them'}
          </Text>
        )}
        {!isBulk && hasFolder && (
          <Checkbox
            checked={recursive}
            onChange={(e) => setRecursive(e.currentTarget.checked)}
            label="Recursive — transfer this folder and everything inside it"
          />
        )}

        {!preview && (
          <Button variant="light" onClick={() => loadPreview(false)} loading={busy}>
            Preview affected files (dry run)
          </Button>
        )}

        {preview && !preview.deep && hasFolder && (
          <Alert color="blue" icon={<IconInfoCircle size={ICON.md} />} title="Seeing fewer items than you expect?">
            <Stack gap="xs" align="flex-start">
              <Text size="sm">
                A quick preview only finds items <b>{sourceUser}</b> can see. Files owned by colleagues that were never
                shared with them are invisible here. A deep scan checks <b>every user's Drive</b> in the domain.
              </Text>
              <Button variant="light" size="xs" loading={busy} onClick={() => loadPreview(true)}>
                Run deep scan
              </Button>
            </Stack>
          </Alert>
        )}
        {preview?.deep && (
          <Group gap="xs">
            <Badge color="gray" variant="light">
              Deep scan — checked {plural(preview.scannedUsers, 'user')}
            </Badge>
            {preview.scanErrors.length > 0 && (
              <Text size="xs" c={TEXT.warning}>
                Could not read {plural(preview.scanErrors.length, 'user')}.
              </Text>
            )}
          </Group>
        )}

        {preview && (
          <>
            <Alert
              color={effRecursive ? 'orange' : 'blue'}
              icon={<IconAlertTriangle size={ICON.md} />}
              title={`${plural(affectedCount ?? 0, 'item')} will change owner`}
            >
              Ownership moves to the new owner; the previous owner keeps edit access (Google Drive behavior).
              {consolidate &&
                newOwnerCount > 0 &&
                ` The ${plural(newOwnerCount, 'item')} already owned by ${newOwner} will be skipped.`}
            </Alert>
            {consolidate && (
              <Alert
                color={ACTION_COLORS.consolidate}
                icon={<IconArrowsExchange size={ICON.md} />}
                title="Consolidate ownership"
              >
                Every selected item not yet owned by <b>{newOwner}</b> will be transferred to them, acting on each
                current owner's behalf.
              </Alert>
            )}
            {!consolidate && effRecursive && othersCount > 0 && !preview.deep && (
              <Alert
                color="orange"
                icon={<IconAlertTriangle size={ICON.md} />}
                title={`This selection contains files owned by ${plural(otherOwners.length, 'other person', 'other people')}`}
              >
                <Stack gap="xs">
                  <Text size="sm">{preview.owners.map((o) => `${o.email}: ${o.count}`).join(' · ')}</Text>
                  <Checkbox
                    checked={claimAll}
                    onChange={(e) => setClaimAll(e.currentTarget.checked)}
                    label={`Also transfer the ${plural(othersCount, 'item')} owned by other users (acts on each owner's behalf)`}
                  />
                </Stack>
              </Alert>
            )}
            {!consolidate && preview.deep && othersCount > 0 && (
              <Alert color="orange" icon={<IconAlertTriangle size={ICON.md} />} title="Owners in this selection">
                <Text size="sm">{preview.owners.map((o) => `${o.email}: ${o.count}`).join(' · ')}</Text>
              </Alert>
            )}
            {effRecursive && (
              <ScrollArea.Autosize mah={220}>
                <Table withTableBorder>
                  <Table.Tbody>
                    {preview.files.map((f) => {
                      const skipped = consolidate
                        ? f.owner === newOwner
                        : f.owner === newOwner || (!claimAll && !preview.deep && f.owner !== sourceUser);
                      const showOwner = consolidate ? f.owner !== newOwner : f.owner !== sourceUser;
                      return (
                        <Table.Tr key={f.id} opacity={skipped ? DISABLED_OPACITY : 1}>
                          <Table.Td>
                            <Group gap="xs" wrap="nowrap">
                              {f.isFolder ? (
                                <IconFolder size={ICON.md} color="var(--icon-folder)" aria-hidden />
                              ) : (
                                <IconFile size={ICON.md} color="var(--icon-file)" aria-hidden />
                              )}
                              <Text span size="sm">
                                {f.name}
                              </Text>
                              {showOwner && (
                                <Text span size="xs" c={TEXT.warning}>
                                  — owned by {f.owner}
                                  {skipped ? ' (will be skipped)' : ''}
                                </Text>
                              )}
                              {skipped && !showOwner && (
                                <Text span size="xs" c="dimmed">
                                  — already owned (skipped)
                                </Text>
                              )}
                            </Group>
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </ScrollArea.Autosize>
            )}
            {needsTypedConfirm && (
              <TextInput
                label={
                  isBulk
                    ? `Type “TRANSFER” to confirm moving ownership of ${items.length} items (folders included recursively)`
                    : `Type the folder name (“${confirmWord}”) to confirm the recursive transfer`
                }
                value={confirmText}
                onChange={(e) => setConfirmText(e.currentTarget.value)}
              />
            )}
          </>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            color={consolidate ? ACTION_COLORS.consolidate : ACTION_COLORS.transfer}
            loading={busy}
            disabled={
              !preview || !newOwner || affectedCount === 0 || (needsTypedConfirm && confirmText !== confirmWord)
            }
            onClick={start}
          >
            {consolidate ? 'Consolidate ownership' : 'Transfer ownership'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
