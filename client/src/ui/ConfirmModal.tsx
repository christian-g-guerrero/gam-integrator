import type { ReactNode } from 'react';
import { Button, Group, Modal, Stack } from '@mantine/core';

interface ConfirmModalProps {
  opened: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** Plain-string question or action, e.g. "Cancel this job?". */
  title: string;
  /** Verb + object, e.g. "Delete 3 exports" — never a bare "OK" or "Delete". */
  confirmLabel: string;
  /** Red for destructive or irreversible actions (the default), the accent otherwise. */
  destructive?: boolean;
  loading?: boolean;
  children: ReactNode;
}

/** The one confirmation dialog: body copy, then Cancel (default) on the left and the action on the right. */
export function ConfirmModal({
  opened,
  onClose,
  onConfirm,
  title,
  confirmLabel,
  destructive = true,
  loading,
  children,
}: ConfirmModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={title}>
      <Stack>
        {children}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button color={destructive ? 'red' : undefined} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
