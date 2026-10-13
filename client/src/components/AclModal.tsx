import { useCallback, useEffect, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
  VisuallyHidden,
} from '@mantine/core';
import { IconTrash, IconUserPlus } from '@tabler/icons-react';
import { Acl, api, del, DriveFile, endpoints, patch, post } from '../api';
import { TableFrame } from './ResizableTable';
import {
  ConfirmModal,
  EmptyRow,
  ErrorAlert,
  ICON,
  LoadingState,
  type ModalProps,
  notifyError,
  notifySuccess,
} from '../ui';

const ROLE_OPTIONS = [
  { value: 'reader', label: 'Viewer' },
  { value: 'commenter', label: 'Commenter' },
  { value: 'writer', label: 'Editor' },
];

/** API role → the label the role picker shows ("writer" → "Editor"). */
const roleLabel = (role: string) => ROLE_OPTIONS.find((o) => o.value === role)?.label ?? role;

interface AclTarget {
  owner: string;
  file: DriveFile;
}

/** View and edit who a file is shared with. */
export function AclModal({ target, onClose, onDone }: ModalProps<AclTarget>) {
  if (!target) return null;
  return <AclDialog owner={target.owner} file={target.file} onClose={onClose} onDone={onDone} />;
}

function AclDialog({ owner, file, onClose, onDone }: AclTarget & Omit<ModalProps<AclTarget>, 'target'>) {
  const [acls, setAcls] = useState<Acl[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [shareWith, setShareWith] = useState('');
  const [role, setRole] = useState<string>('reader');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const base = endpoints.fileAcls(owner, file.id);

  const load = useCallback(() => {
    setAcls(null);
    setLoadError(null);
    api<Acl[]>(base).then(setAcls, (e: Error) => setLoadError(e.message));
  }, [base]);

  useEffect(load, [load]);

  const mutate = async (fn: () => Promise<unknown>, okMsg: string): Promise<boolean> => {
    setBusy(true);
    try {
      await fn();
      notifySuccess(okMsg);
      load();
      onDone?.();
      return true;
    } catch (e) {
      notifyError('Could not change sharing', e);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const confirmRemove = async () => {
    if (!removing) return;
    const who = removing;
    await mutate(() => del(endpoints.fileAcls(owner, file.id, who)), `Removed ${who}'s access.`);
    setRemoving(null);
  };

  return (
    <Modal opened onClose={onClose} title={`Sharing — ${file.name}`} size="lg">
      <Stack gap="sm">
        {loadError ? (
          <ErrorAlert title="Could not load sharing">{loadError}</ErrorAlert>
        ) : !acls ? (
          <LoadingState label="Loading sharing…" />
        ) : (
          // Scrolls sideways inside the modal on a narrow phone instead of overflowing it.
          <TableFrame>
            <Table miw={420}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Who</Table.Th>
                  <Table.Th>Role</Table.Th>
                  <Table.Th>
                    <VisuallyHidden>Actions</VisuallyHidden>
                  </Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {acls.map((a) => {
                  const who = a.email || a.domain || a.type;
                  return (
                    <Table.Tr key={a.permissionId || a.email}>
                      <Table.Td>
                        <Text size="sm">{who}</Text>
                      </Table.Td>
                      <Table.Td>
                        {a.role === 'owner' ? (
                          <Badge color="gray" variant="light">
                            Owner
                          </Badge>
                        ) : (
                          <Select
                            aria-label={`Role for ${who}`}
                            data={ROLE_OPTIONS}
                            value={a.role}
                            disabled={busy}
                            onChange={(v) =>
                              v &&
                              v !== a.role &&
                              mutate(() => patch(base, { who: a.email, role: v }), `Changed ${who} to ${roleLabel(v)}.`)
                            }
                            w={150}
                          />
                        )}
                      </Table.Td>
                      <Table.Td>
                        {a.role !== 'owner' && a.email && (
                          <Tooltip label="Remove access">
                            <ActionIcon
                              color="red"
                              variant="light"
                              disabled={busy}
                              aria-label={`Remove access for ${a.email}`}
                              onClick={() => setRemoving(a.email)}
                            >
                              <IconTrash size={ICON.md} aria-hidden />
                            </ActionIcon>
                          </Tooltip>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
                {acls.length === 0 && <EmptyRow colSpan={3} message="No sharing entries found." />}
              </Table.Tbody>
            </Table>
          </TableFrame>
        )}

        <Group align="flex-end" gap="xs">
          <TextInput
            label="Share with"
            placeholder="person@yourdomain.com"
            value={shareWith}
            onChange={(e) => setShareWith(e.currentTarget.value)}
            // 200px basis: on a phone the field wraps onto its own line instead of shrinking to nothing.
            flex="1 1 200px"
          />
          <Select data={ROLE_OPTIONS} value={role} onChange={(v) => v && setRole(v)} w={140} label="Role" />
          <Button
            variant="light"
            leftSection={<IconUserPlus size={ICON.md} aria-hidden />}
            loading={busy}
            disabled={!shareWith.includes('@')}
            onClick={async () => {
              if (
                await mutate(() => post(base, { shareWith, role }), `Shared with ${shareWith} as ${roleLabel(role)}.`)
              )
                setShareWith('');
            }}
          >
            Add
          </Button>
        </Group>

        <Group justify="flex-end">
          <Button onClick={onClose}>Done</Button>
        </Group>
      </Stack>

      <ConfirmModal
        opened={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => void confirmRemove()}
        title="Remove access?"
        confirmLabel="Remove access"
        loading={busy}
      >
        <Text size="sm">
          <b>{removing}</b> loses their direct access to “{file.name}”.
        </Text>
      </ConfirmModal>
    </Modal>
  );
}
