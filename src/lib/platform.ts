// Host OS conventions, so labels and shortcuts read naturally on Windows and macOS.

export const isMac = navigator.userAgent.includes("Mac");

/** Display name of the shortcut modifier key. */
export const modKey = isMac ? "⌘" : "Ctrl";

export const revealLabelKey = isMac ? "export.revealMac" : "export.revealWindows";

/** True for the platform shortcut modifier (⌘ on macOS, Ctrl elsewhere). */
export function hasModKey(event: KeyboardEvent): boolean {
  return isMac ? event.metaKey : event.ctrlKey;
}
