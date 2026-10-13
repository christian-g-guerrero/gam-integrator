/**
 * Design-system building blocks. Pages compose these instead of hand-rolling headers, loaders,
 * state displays, confirmations, and toasts.
 */
export { Page } from './Page';
export { Section, SectionTitle } from './Section';
export { EmptyRow, EmptyState, ErrorAlert, LoadingState } from './states';
export { AccentCard, Hint, NoValue, RefreshButton, Stat, StatusBadge, UserStatusBadge } from './bits';
export { NumTd } from './table';
export { ConfirmModal } from './ConfirmModal';
export type { ModalProps } from './modal';
export { notifyError, notifyInfo, notifySuccess, notifyWarning } from './notify';
export { ACCENT_BG, ACTION_COLORS, DISABLED_OPACITY, ICON, TEXT } from './tokens';
export { AppThemeProvider, useAppearance } from './ThemeProvider';
