import type { ReactNode } from 'react';
import { Card, Group, Stack, Title } from '@mantine/core';
import type { Icon } from '@tabler/icons-react';
import { ICON } from './tokens';

/**
 * Section heading under a page title. Semantically an h3 (the page title is the h2, so heading
 * levels never skip), visually h4-sized. An optional icon sits at ICON.heading in the accent color.
 */
export function SectionTitle({
  icon: IconCmp,
  actions,
  children,
}: {
  icon?: Icon;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const title = (
    <Title order={3} size="h4">
      {IconCmp ? (
        <Group gap="xs" component="span" wrap="nowrap">
          <IconCmp size={ICON.heading} color="var(--mantine-primary-color-filled)" aria-hidden />
          {children}
        </Group>
      ) : (
        children
      )}
    </Title>
  );
  if (!actions) return title;
  return (
    <Group justify="space-between" align="center" wrap="nowrap">
      {title}
      <Group gap="xs">{actions}</Group>
    </Group>
  );
}

/** A titled card — the standard container for a self-contained block of a page (Settings groups, panels). */
export function Section({
  title,
  icon,
  actions,
  children,
}: {
  title: ReactNode;
  icon?: Icon;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card padding="lg">
      <Stack>
        <SectionTitle icon={icon} actions={actions}>
          {title}
        </SectionTitle>
        {children}
      </Stack>
    </Card>
  );
}
