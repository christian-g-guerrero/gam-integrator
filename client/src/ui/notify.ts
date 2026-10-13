import type { ReactNode } from 'react';
import { notifications } from '@mantine/notifications';

/**
 * Toast helpers — the only way pages raise toasts, so color and wording stay uniform.
 * Toasts are for the outcome of an *action*; a failed *load* renders an inline <ErrorAlert> instead.
 */

/** Action succeeded. `message` is a full sentence; add a `title` only for long-running jobs ("Export started"). */
export function notifySuccess(message: ReactNode, title?: string) {
  notifications.show({ color: 'green', title, message });
}

/** Action partly succeeded — say what didn't. */
export function notifyWarning(message: ReactNode, title?: string) {
  notifications.show({ color: 'orange', title, message });
}

/** Neutral result that isn't a success or failure ("Nothing to delete."). */
export function notifyInfo(message: ReactNode) {
  notifications.show({ message });
}

/** Action failed. `title` is "Could not <verb> <object>"; the message is the error itself. */
export function notifyError(title: string, err: unknown) {
  notifications.show({ color: 'red', title, message: err instanceof Error ? err.message : String(err) });
}
