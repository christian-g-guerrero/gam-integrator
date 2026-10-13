/**
 * The one modal prop contract. `target` is what the dialog acts
 * on — `null` means closed, and the dialog remounts on every open, so its state starts
 * fresh without reset effects. `onClose` only closes; `onDone` fires after a successful
 * change so the opener can reload.
 */
export interface ModalProps<T> {
  target: T | null;
  onClose: () => void;
  onDone?: () => void;
}
