// The two views of the page. Pure helpers, so the keyboard and link behaviour can be tested.

export type TabId = "versions" | "devices";

export const TAB_ORDER: TabId[] = ["versions", "devices"];

/** A link ending in #my-devices opens the My devices tab directly. */
export function tabFromHash(hash: string): TabId | null {
  return hash === "#my-devices" ? "devices" : null;
}

/** The address to show for a tab: a hash for My devices, the plain page for the default. */
export function hashForTab(tab: TabId): string {
  return tab === "devices" ? "#my-devices" : "";
}

/**
 * The tab a key moves to, following the standard tabs pattern: arrows move one tab (and wrap
 * around), Home and End jump to the ends. Returns null for any other key.
 */
export function nextTabForKey(key: string, current: TabId): TabId | null {
  const i = TAB_ORDER.indexOf(current);
  const n = TAB_ORDER.length;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return TAB_ORDER[(i + 1) % n];
    case "ArrowLeft":
    case "ArrowUp":
      return TAB_ORDER[(i - 1 + n) % n];
    case "Home":
      return TAB_ORDER[0];
    case "End":
      return TAB_ORDER[n - 1];
    default:
      return null;
  }
}
