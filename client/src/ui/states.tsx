import type { ReactNode } from 'react';
import { Alert, Loader, Stack, Table, Text } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { Hint } from './bits';
import { ICON } from './tokens';

/** Centered loader with an optional line saying what's loading. */
export function LoadingState({ label }: { label?: string }) {
  return (
    <Stack align="center" gap="xs" py="xl">
      <Loader />
      {label && (
        <Text size="sm" c="dimmed">
          {label}
        </Text>
      )}
    </Stack>
  );
}

/** Load-failure alert — action failures use toasts, load failures use this inline. */
export function ErrorAlert({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Alert color="red" icon={<IconAlertCircle size={ICON.md} />} title={title}>
      {children}
    </Alert>
  );
}

/** Standalone empty state (outside tables). */
export function EmptyState({ message, hint }: { message: ReactNode; hint?: ReactNode }) {
  return (
    <Stack align="center" gap={4} py="lg">
      <Text c="dimmed">{message}</Text>
      {hint && <Hint>{hint}</Hint>}
    </Stack>
  );
}

/**
 * Empty state as a table row spanning all columns. Inside a TableFrame the message is pinned to the
 * visible width (`.gam-table-empty`), so headers wider than a phone don't push it off-screen.
 */
export function EmptyRow({ colSpan, message }: { colSpan: number; message: ReactNode }) {
  return (
    <Table.Tr>
      <Table.Td colSpan={colSpan} p={0}>
        <Text className="gam-table-empty" c="dimmed" ta="center" py="md" px="sm">
          {message}
        </Text>
      </Table.Td>
    </Table.Tr>
  );
}
