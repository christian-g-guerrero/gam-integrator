import { forwardRef, type ReactNode } from 'react';
import {
  Badge,
  Button,
  Card,
  Stack,
  Text,
  type BadgeProps,
  type ButtonProps,
  type CardProps,
  type TextProps,
} from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';
import type { JobSummary } from '../api';
import { ACCENT_BG, ICON, STATUS_COLORS } from './tokens';
import { useAppearance } from './ThemeProvider';

/** Footnote / caption text under tables and controls. */
export function Hint({ children, ...props }: TextProps & { children: ReactNode }) {
  return (
    <Text size="xs" c="dimmed" {...props}>
      {children}
    </Text>
  );
}

/** Labelled headline figure (Dashboard's pool totals): small caps label over a large value. */
export function Stat({ label, value, c }: { label: string; value: ReactNode; c?: string }) {
  return (
    <Stack gap={4}>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text size="lg" fw={700} c={c}>
        {value}
      </Text>
    </Stack>
  );
}

/** Placeholder for a missing or not-yet-known value in a table cell or stat. */
export function NoValue() {
  return (
    <Text span size="sm" c="dimmed">
      —
    </Text>
  );
}

/** Workspace user account state — the one Active/Suspended pill every user table shows. */
export function UserStatusBadge({ suspended, ...props }: BadgeProps & { suspended: boolean }) {
  return (
    <Badge color={suspended ? 'red' : 'green'} variant="light" {...props}>
      {suspended ? 'Suspended' : 'Active'}
    </Badge>
  );
}

/** Job status pill, colored via STATUS_COLORS. */
export function StatusBadge({ status, ...props }: BadgeProps & { status: JobSummary['status'] }) {
  return (
    <Badge color={STATUS_COLORS[status]} variant="light" {...props}>
      {status}
    </Badge>
  );
}

/** Standard header refresh control: quiet xs button (the skin's `quietVariant`) with the refresh icon. */
export const RefreshButton = forwardRef<
  HTMLButtonElement,
  ButtonProps & { onClick?: () => void; children?: ReactNode }
>(function RefreshButton({ children = 'Refresh', ...props }, ref) {
  const { skinTraits } = useAppearance();
  return (
    <Button
      ref={ref}
      variant={skinTraits.quietVariant}
      size="xs"
      leftSection={<IconRefresh size={ICON.xs} />}
      {...props}
    >
      {children}
    </Button>
  );
});

/**
 * Accent-tinted info panel (selection bars, "links detected" callouts). Tagged
 * `data-surface="accent"` so a skin restyles it from CSS without sniffing inline styles.
 */
export function AccentCard({ children, ...props }: CardProps & { children: ReactNode }) {
  return (
    <Card bg={ACCENT_BG} data-surface="accent" {...props}>
      {children}
    </Card>
  );
}
