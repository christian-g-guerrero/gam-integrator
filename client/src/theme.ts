import { Badge, Card, Checkbox, createTheme, Menu, Modal, Tooltip } from '@mantine/core';

/**
 * App-wide design system. Component defaults live here so pages never repeat
 * presentation props; page-level building blocks live in `src/ui/`.
 *
 * Theming model (the "dynamically-linked tokens" approach): components never
 * hardcode a palette color — they consume Mantine's semantic CSS variables
 * (`--mantine-primary-color-*`), which *repoint* when `primaryColor` changes.
 * So switching the accent is a value swap behind one attribute, not a rebuild.
 * The runtime state that drives it lives in `src/ui/ThemeProvider.tsx`; this
 * file only defines the accent registry and how to build a theme from a choice.
 *
 * Shared spacing, sizing and icon tokens live in src/ui/tokens.ts.
 */

/**
 * Selectable accent colors — each is a Mantine palette name, so its full 0–9
 * shade scale already exists as CSS variables. Adding a theme is one row here.
 * Swatches render `var(--mantine-color-<value>-6)`; labels are user-facing.
 */
export const ACCENTS = [
  { value: 'blue', label: 'Blue' },
  { value: 'indigo', label: 'Indigo' },
  { value: 'violet', label: 'Violet' },
  { value: 'grape', label: 'Grape' },
  { value: 'teal', label: 'Teal' },
  { value: 'cyan', label: 'Cyan' },
  { value: 'green', label: 'Green' },
  { value: 'orange', label: 'Orange' },
] as const;

/** A valid accent choice — the `value` of one of the ACCENTS entries. */
export type AccentColor = (typeof ACCENTS)[number]['value'];

/** Default brand accent, used before the user has picked one. */
export const DEFAULT_ACCENT: AccentColor = 'blue';

/** localStorage key for the persisted accent (color scheme is persisted by Mantine). */
export const ACCENT_STORAGE_KEY = 'gam-accent-color';

/**
 * Skins — the *second* theme axis. Where an accent repoints one token
 * (primaryColor), a skin is a coordinated bundle: typography + corner radius
 * (set here on the Mantine theme) plus a scoped stylesheet for the chrome a
 * theme object can't express — bevels, platinum surfaces, classic scrollbars
 * (see src/skins/<id>.css, keyed by `data-skin` on <html>). Adding a skin is a
 * row here + a stylesheet + a `buildTheme` branch. Where a skin needs different
 * *markup* (not just paint), it says so with a trait on its row — components
 * read traits via `useAppearance().skinTraits`, never the skin id.
 *
 * `classic` = Mac OS Platinum (beveled grey). `pastel-retro` = warm ivory
 * paper — self-hosted IBM Plex, hard offset shadows, a multi-segment storage ring. Every
 * skin follows the light/dark/auto scheme: each stylesheet carries a light and
 * a dark token block (Classic's dark is "Graphite", Pastel Retro's "Night").
 * The accent axis stays live for filled buttons, selection, and the storage ring.
 */
export const SKINS = [
  { value: 'modern', label: 'Modern', quietVariant: 'light', segmentedRing: false },
  { value: 'classic', label: 'Classic', quietVariant: 'light', segmentedRing: false },
  // Mantine's "light" reads as ghosted/disabled on warm paper, so quiet actions
  // use the raised-ivory "default" button; the storage ring is a
  // multi-segment donut, one pastel arc per top user.
  { value: 'pastel-retro', label: 'Pastel Retro', quietVariant: 'default', segmentedRing: true },
] as const satisfies readonly SkinDef[];

/**
 * One SKINS row. Traits beyond `label` describe what a skin needs from the
 * markup, so components branch on a trait — never on a skin id.
 */
export interface SkinDef {
  value: string;
  label: string;
  /** Button variant for quiet header actions (RefreshButton). */
  quietVariant: 'light' | 'default';
  /** Dashboard storage ring: one arc per top contributor instead of a single used-vs-free arc. */
  segmentedRing: boolean;
}

/** A valid skin choice — the `value` of one of the SKINS entries. */
export type SkinId = (typeof SKINS)[number]['value'];

/** Default skin — the clean Mantine look. */
export const DEFAULT_SKIN: SkinId = 'modern';

/** localStorage key for the persisted skin. */
export const SKIN_STORAGE_KEY = 'gam-skin';

/**
 * Classic Mac system-font stack. Lucida Grande (the macOS system typeface,
 * 2000–2013) leads: it's unmistakably Mac yet crisp and highly legible at UI
 * sizes — the readable choice over the rougher bitmap-era Geneva/Chicago, which
 * stay as fallbacks. Ships on macOS, so no font file is embedded.
 */
const CLASSIC_FONT = "'Lucida Grande', 'Geneva', 'Helvetica Neue', Helvetica, Arial, sans-serif";

/**
 * Pastel Retro type pairing. IBM Plex
 * is now self-hosted offline via @fontsource (imported in main.tsx), so these
 * stacks render in the real typeface — a clean sans for body, and a monospace
 * for the headings/metrics that give the retro-desktop-software character. The
 * system faces remain as fallbacks if the font files ever fail to load.
 */
const RETRO_BODY_FONT = "'IBM Plex Sans', 'Avenir Next', 'Segoe UI', Helvetica, Arial, sans-serif";
const RETRO_MONO_FONT = "'IBM Plex Mono', ui-monospace, 'SFMono-Regular', 'SF Mono', Menlo, Consolas, monospace";

/** Component defaults — presentation shared by every page, independent of accent. */
const components = {
  // One hover delay everywhere — tooltips explain, they shouldn't flicker on drive-by hovers.
  Tooltip: Tooltip.extend({ defaultProps: { openDelay: 300 } }),
  // Action menus anchor bottom-end and skip the open transition (snappier on data tables).
  Menu: Menu.extend({ defaultProps: { position: 'bottom-end', withArrow: true, transitionProps: { duration: 0 } } }),
  // Every modal title is a heading — pass plain strings as `title`.
  Modal: Modal.extend({ styles: { title: { fontWeight: 600 } } }),
  Card: Card.extend({ defaultProps: { withBorder: true } }),
  // Mantine 9 defaults Checkbox to radius "sm"; through v8 it followed the theme radius (square in Classic).
  Checkbox: Checkbox.extend({ vars: () => ({ root: { '--checkbox-radius': 'var(--mantine-radius-default)' } }) }),
  // Badge labels ellipsize, which gives them a ~0 min-content width — an auto-layout table then squeezes
  // them first ("SUSPE…", "F."). Badges here are short enums, so never let them shrink below their text.
  // Light (soft) badges take a per-hue hairline edge from the skin: `--gam-edge-<hue>`, else the skin's
  // `--gam-edge-default`, else Mantine's transparent border — so skins that define neither are unchanged.
  Badge: Badge.extend({
    styles: { root: { minWidth: 'max-content' } },
    vars: (theme, { color, variant }) => ({
      root:
        variant === 'light'
          ? {
              '--badge-bd': `1px solid var(--gam-edge-${color ?? theme.primaryColor}, var(--gam-edge-default, transparent))`,
            }
          : {},
    }),
  }),
};

/**
 * Build the Mantine theme for a chosen accent + skin. `primaryColor` is the
 * single semantic alias every brand surface reads through; changing it repoints
 * all `--mantine-primary-color-*` variables at once. The skin layers on
 * typography and corner radius; its chrome (bevels, surfaces) lives in CSS.
 * Cheap — safe to call on every change.
 */
export function buildTheme(accent: AccentColor = DEFAULT_ACCENT, skin: SkinId = DEFAULT_SKIN) {
  const base = {
    primaryColor: accent,
    defaultRadius: 'md' as const,
    cursorType: 'pointer' as const,
    // Mantine 9 raised `medium` to 600; field/menu/table labels were designed at 500 (and Lucida Grande in
    // Classic has no 500, so 600 renders full bold). Buttons stay 600 via skins/base.css.
    fontWeights: { medium: '500' },
    components,
  };
  if (skin === 'classic') {
    return createTheme({
      ...base,
      defaultRadius: 0,
      fontFamily: CLASSIC_FONT,
      headings: { fontFamily: CLASSIC_FONT, fontWeight: '700' },
    });
  }
  if (skin === 'pastel-retro') {
    return createTheme({
      ...base,
      // Two radii only: 6px controls, 8px panels. 'sm' is the control
      // default; src/skins/pastel-retro.css remaps --mantine-radius-sm→6px and
      // steps cards/modals/tables up to 8px (--radius-lg).
      defaultRadius: 'sm',
      fontFamily: RETRO_BODY_FONT,
      fontFamilyMonospace: RETRO_MONO_FONT,
      // Mono display type for titles + tabular metrics is the skin's signature.
      headings: { fontFamily: RETRO_MONO_FONT, fontWeight: '700' },
    });
  }
  return createTheme(base);
}
