import { useState } from 'react';
import { Button, Group, Modal, Progress, Stack, TextInput } from '@mantine/core';
import { DriveFile, endpoints, post } from '../api';
import { plural } from '../lib/format';
import { type ModalProps, notifyError, notifySuccess, notifyWarning } from '../ui';
import { FolderSelect } from './FolderSelect';

interface CopyMoveTarget {
  owner: string;
  /** One file for copy; one or many for move. */
  files: DriveFile[];
  mode: 'copy' | 'move';
}

/** Copy a file (optionally renamed) or move one/many items to another folder in the same Drive. */
export function CopyMoveModal({ target, onClose, onDone }: ModalProps<CopyMoveTarget>) {
  if (!target || target.files.length === 0) return null;
  return <CopyMoveDialog {...target} onClose={onClose} onDone={onDone} />;
}

function CopyMoveDialog({
  owner,
  files,
  mode,
  onClose,
  onDone,
}: CopyMoveTarget & Omit<ModalProps<CopyMoveTarget>, 'target'>) {
  const [destFolder, setDestFolder] = useState<string | null>(null);
  const [newName, setNewName] = useState(mode === 'copy' && files.length === 1 ? `Copy of ${files[0].name}` : '');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const single = files.length === 1 ? files[0] : null;

  const title =
    mode === 'copy'
      ? `Copy — ${single?.name}`
      : files.length === 1
        ? `Move — ${files[0].name}`
        : `Move — ${plural(files.length, 'item')}`;

  async function run() {
    setBusy(true);
    try {
      if (mode === 'copy' && single) {
        await post(endpoints.fileCopy(owner, single.id), {
          newName: newName || undefined,
          targetParentId: destFolder && destFolder !== 'root' ? destFolder : undefined,
        });
        notifySuccess(`Copied “${single.name}”.`);
      } else {
        let ok = 0;
        const failed: string[] = [];
        for (const f of files) {
          try {
            await post(endpoints.fileMove(owner, f.id), {
              targetParentId: destFolder ?? 'root',
            });
            ok += 1;
          } catch (e) {
            failed.push(`${f.name}: ${(e as Error).message}`);
          }
          setProgress(ok + failed.length);
        }
        const failures = failed.slice(0, 3).join('; ') + (failed.length > 3 ? '; …' : '');
        if (!failed.length) notifySuccess(`Moved ${plural(ok, 'item')}.`);
        else if (ok === 0) notifyError(files.length === 1 ? 'Could not move item' : 'Could not move items', failures);
        else
          notifyWarning(
            `Could not move ${plural(failed.length, 'item')}: ${failures}`,
            `Moved ${ok} of ${plural(files.length, 'item')}`,
          );
      }
      onDone?.();
      onClose();
    } catch (e) {
      notifyError(mode === 'copy' ? `Could not copy “${single?.name}”` : 'Could not move items', e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal opened onClose={onClose} title={title}>
      <Stack gap="sm">
        {mode === 'copy' && (
          <TextInput label="Name of the copy" value={newName} onChange={(e) => setNewName(e.currentTarget.value)} />
        )}
        <FolderSelect
          owner={owner}
          exclude={files.map((f) => f.id)}
          label={mode === 'copy' ? 'Destination folder (optional)' : 'Destination folder'}
          value={destFolder}
          onChange={setDestFolder}
        />
        {busy && files.length > 1 && (
          <Progress
            value={(100 * progress) / files.length}
            size="lg"
            striped
            animated
            aria-label={`Moving ${plural(files.length, 'item')}`}
          />
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={mode === 'move' && !destFolder} onClick={run}>
            {mode === 'copy' ? 'Copy' : files.length === 1 ? 'Move' : `Move ${plural(files.length, 'item')}`}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
