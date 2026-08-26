let lastPasteAt = 0;
const PASTE_COOLDOWN_MS = 600;

/** Renderer-side pre-filter matching upstream's double-click paste guard. */
export function tryPaste(action: () => void): void {
  const now = Date.now();
  if (now - lastPasteAt < PASTE_COOLDOWN_MS) return;
  lastPasteAt = now;
  action();
}
