import {
  ColorSwatch,
  Group,
  Input,
  SegmentedControl,
  Stack,
  Tooltip,
  useMantineColorScheme,
  type MantineColorScheme,
} from '@mantine/core';
import { IconCheck, IconDeviceFloppy, IconPalette, IconPlugConnected } from '@tabler/icons-react';
import { SetupStatus } from '../api';
import { type SkinId } from '../theme';
import { ICON, Page, Section, useAppearance } from '../ui';
import { LocalData } from '../components/LocalData';
import { SetupWizard } from './SetupWizard';

const SCHEME_OPTIONS: { label: string; value: MantineColorScheme }[] = [
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
  { label: 'Auto', value: 'auto' },
];

/**
 * Appearance controls — the theme axes. Color scheme (light/dark/auto) is owned
 * by Mantine and persisted for us; skin and accent are owned by
 * <AppThemeProvider>. All three drive CSS variables (and, for the skin, a
 * `data-skin` stylesheet), so a click repaints the whole app with no reload.
 */
function Appearance() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const { accent, setAccent, accents, skin, setSkin, skins } = useAppearance();

  return (
    <Stack gap="lg">
      <Input.Wrapper
        labelElement="div"
        label="Theme"
        description="“Modern” is the clean default; “Classic” gives the app a Mac OS Platinum look; “Pastel Retro” is a warm-ivory, pastel-Google desktop-utility look (IBM Plex type, hard offset shadows, a multi-segment storage ring)."
      >
        <SegmentedControl
          mt="xs"
          aria-label="Theme"
          value={skin}
          onChange={(value) => setSkin(value as SkinId)}
          data={skins.map((s) => ({ label: s.label, value: s.value }))}
        />
      </Input.Wrapper>

      <Input.Wrapper
        labelElement="div"
        label="Color scheme"
        description="“Auto” follows your operating system’s light/dark setting."
      >
        <SegmentedControl
          mt="xs"
          aria-label="Color scheme"
          value={colorScheme}
          onChange={(value) => setColorScheme(value as MantineColorScheme)}
          data={SCHEME_OPTIONS}
        />
      </Input.Wrapper>

      <Input.Wrapper
        labelElement="div"
        label="Accent color"
        description="Tints buttons, links, and highlights across the app."
      >
        <Group gap="sm" mt="xs" role="group" aria-label="Accent color">
          {accents.map((a) => {
            const selected = a.value === accent;
            return (
              <Tooltip key={a.value} label={a.label}>
                <ColorSwatch
                  component="button"
                  type="button"
                  color={`var(--mantine-color-${a.value}-6)`}
                  onClick={() => setAccent(a.value)}
                  aria-label={`${a.label} accent`}
                  aria-pressed={selected}
                  size={30}
                  style={{
                    // A bare <button> keeps the default arrow cursor; Mantine's cursorType only covers inputs.
                    cursor: 'pointer',
                    color: 'var(--mantine-color-white)',
                    outline: selected ? '2px solid var(--mantine-color-default-color)' : 'none',
                    outlineOffset: 2,
                  }}
                >
                  {selected && <IconCheck size={ICON.md} aria-hidden />}
                </ColorSwatch>
              </Tooltip>
            );
          })}
        </Group>
      </Input.Wrapper>
    </Stack>
  );
}

/**
 * Settings page: personalize the app (Appearance), manage what it keeps on disk
 * (Local data), and configure GAM (the setup wizard). Each is a titled <Section>. Reached from the "Settings" nav item.
 */
export function Settings({ status, onStatusChange }: { status: SetupStatus | null; onStatusChange: () => void }) {
  return (
    <Page title="Settings" width="focused" subtitle="Personalize the app and configure its connection to GAM.">
      <Section title="Appearance" icon={IconPalette}>
        <Appearance />
      </Section>
      <Section title="Local data" icon={IconDeviceFloppy}>
        <LocalData />
      </Section>
      <Section title="GAM setup" icon={IconPlugConnected}>
        <SetupWizard status={status} onStatusChange={onStatusChange} />
      </Section>
    </Page>
  );
}
