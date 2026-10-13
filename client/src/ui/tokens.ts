import type { JobSummary } from '../api';

/**
 * Semantic action colors, used consistently across pages:
 * - transfer    → ownership moves between users (destructive-ish, needs attention)
 * - consolidate → ownership sweeps to one user acting on others' behalf
 * - export      → downloads / long-running export jobs
 */
export const ACTION_COLORS = {
  transfer: 'orange',
  consolidate: 'grape',
  export: 'teal',
} as const;

/** Job status → badge color (render via <StatusBadge>). */
export const STATUS_COLORS: Record<JobSummary['status'], string> = {
  running: 'blue',
  succeeded: 'green',
  failed: 'red',
  cancelled: 'gray',
};

/**
 * Icon size scale. brand = the header logo; nav = sidebar rail; heading = section titles
 * (<Section>/<SectionTitle>); md = default (buttons, inputs, alerts, table rows, menu items);
 * xs = compact contexts (size="xs" buttons, sort chevrons, back links).
 */
export const ICON = { brand: 26, nav: 18, heading: 18, md: 16, xs: 14 } as const;

/**
 * Semantic text colors for values that carry meaning (storage over a threshold, free space, errors).
 * Each resolves to a CSS variable every skin defines at AA contrast (App.css defaults + skins/*.css),
 * so pages never pick a numbered shade. Pass as `c={TEXT.warning}`.
 */
export const TEXT = {
  success: 'var(--gam-text-success)',
  warning: 'var(--gam-text-warning)',
  danger: 'var(--gam-text-danger)',
} as const;

/** Opacity for rows/options that are shown but not selectable (e.g. the current owner). */
export const DISABLED_OPACITY = 0.45;

/**
 * Accent surface for selected rows / info panels. `--gam-surface-accent` (App.css)
 * defaults to the semantic primary alias, so it follows the chosen accent and the
 * color scheme; a skin repoints the variable (it's applied inline, so a stylesheet
 * `background` rule would lose).
 */
export const ACCENT_BG = 'var(--gam-surface-accent)';
