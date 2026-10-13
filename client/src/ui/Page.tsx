import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Anchor, Group, Stack, Text, Title } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { ICON } from './tokens';

/** data = tables and browsers; focused = wizards, consoles, detail views. */
const PAGE_WIDTHS = { data: 1080, focused: 920 } as const;

interface PageProps {
  title: ReactNode;
  /** Dimmed intro line under the title. */
  subtitle?: ReactNode;
  /** Right-aligned header controls (refresh, exports, …). */
  actions?: ReactNode;
  /** Renders a back link above the title. */
  backTo?: string;
  backLabel?: string;
  width?: keyof typeof PAGE_WIDTHS;
  children: ReactNode;
}

/** Standard page scaffold: optional back link, title row with actions, optional subtitle. */
export function Page({ title, subtitle, actions, backTo, backLabel, width = 'data', children }: PageProps) {
  return (
    <Stack maw={PAGE_WIDTHS[width]}>
      {backTo && (
        <Anchor component={Link} to={backTo} size="sm">
          <Group gap={4}>
            <IconArrowLeft size={ICON.xs} /> {backLabel ?? 'Back'}
          </Group>
        </Anchor>
      )}
      <Stack gap={4}>
        <Group justify="space-between" align="flex-start">
          <Title order={2} className="gam-page-title">
            {title}
          </Title>
          {actions && <Group gap="xs">{actions}</Group>}
        </Group>
        {subtitle && <Text c="dimmed">{subtitle}</Text>}
      </Stack>
      {children}
    </Stack>
  );
}
