/** Gmail's built-in labels, in the order the Browse sidebar lists them. */
export const SYSTEM_ORDER = ['INBOX', 'SENT', 'DRAFT', 'STARRED', 'IMPORTANT', 'SPAM', 'TRASH'];

/** Every system label name (incl. ones the sidebar hides) — GAM reports these in upper case. */
const SYSTEM_LABELS = new Set([...SYSTEM_ORDER, 'UNREAD', 'CHAT']);

/**
 * Display name for a Gmail label: system labels are title-cased ("INBOX" → "Inbox"); user-created
 * labels are shown exactly as the user named them ("Clients/ACME" stays as-is). Pass `system` when the
 * label's type is known (the labels API reports it); otherwise it is inferred from the name.
 */
export function labelName(name: string, system = SYSTEM_LABELS.has(name)): string {
  return system ? name.charAt(0) + name.slice(1).toLowerCase() : name;
}
