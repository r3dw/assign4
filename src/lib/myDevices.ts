// Types and helpers for a signed-in user's saved devices. Used by the API routes and the page.

/** A row of the my_devices view: one saved device with its oldest and newest OS. */
export interface MyDevice {
  id: string;
  nickname: string | null;
  created_at: string;
  device_id: number;
  name: string;
  category: string;
  min_os_family: string | null;
  min_os_version: string | null;
  max_os_family: string | null;
  max_os_version: string | null;
  /** False when the newest OS the device can run is no longer updated by Apple. */
  max_os_is_supported: boolean | null;
}

/** An entry in the device dropdown. */
export interface CatalogDevice {
  id: number;
  name: string;
  category: string;
  /** AppleDB's product type, e.g. "MacBook Air" or "iPad Pro". */
  device_type: string | null;
  released: string | null;
}

/** Cap per account, so a signed-in user cannot fill the free-tier database. */
export const MAX_SAVED_DEVICES = 50;
export const MAX_NICKNAME_LENGTH = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID_RE.test(value);

/** A positive whole number, or null. Accepts numbers and digit strings. */
export function parseDeviceId(value: unknown): number | null {
  const n = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** A trimmed nickname, null for none, or undefined if it is not usable. */
export function parseNickname(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length === 0) return null;
  // Control characters have no place in a nickname.
  if (text.length > MAX_NICKNAME_LENGTH || /[\u0000-\u001f\u007f]/.test(text)) return undefined;
  return text;
}

const osLabel = (family: string | null, version: string | null) =>
  family && version ? `${family === "HomePod Software" ? "HomePod" : family} ${version}` : "unknown";

/** "iOS 11.0" and "iOS 16.7.16" as readable text. */
export function osRange(d: Pick<MyDevice, "min_os_family" | "min_os_version" | "max_os_family" | "max_os_version">) {
  return {
    oldest: osLabel(d.min_os_family, d.min_os_version),
    newest: osLabel(d.max_os_family, d.max_os_version),
  };
}

// --- The device dropdown ----------------------------------------------------------------

/** Categories in the order people think of them. Unknown ones sort last. */
const CATEGORY_ORDER = ["iPhone", "iPad", "iPod touch", "Mac", "Apple Watch", "Apple TV", "HomePod", "Apple Vision"];
const categoryRank = (c: string) => (CATEGORY_ORDER.indexOf(c) === -1 ? CATEGORY_ORDER.length : CATEGORY_ORDER.indexOf(c));

/** Product types within a category, most familiar first. Unlisted types follow, alphabetically. */
const TYPE_ORDER: Record<string, string[]> = {
  Mac: ["MacBook Pro", "MacBook Air", "MacBook", "MacBook Neo", "iMac", "Mac mini", "Mac Studio", "Mac Pro",
    "Xserve", "PowerMac", "PowerBook", "iBook", "eMac"],
  iPad: ["iPad Pro", "iPad Air", "iPad", "iPad mini"],
};
const typeRank = (category: string, type: string) => {
  const i = (TYPE_ORDER[category] ?? []).indexOf(type);
  return i === -1 ? 999 : i;
};

/** The categories that have devices, with counts, for the first dropdown. */
export function catalogCategories(devices: CatalogDevice[]): { category: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const d of devices) counts.set(d.category, (counts.get(d.category) ?? 0) + 1);
  return [...counts]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => categoryRank(a.category) - categoryRank(b.category) || a.category.localeCompare(b.category));
}

/**
 * The devices of one category for the second dropdown: sub-grouped by product type
 * (iMac, MacBook Air, ...) and newest first within each group, so recent devices need no
 * scrolling. A category with a single type comes back as one unlabelled group.
 */
export function devicesByType(
  devices: CatalogDevice[],
  category: string,
): { label: string | null; devices: CatalogDevice[] }[] {
  const byType = new Map<string, CatalogDevice[]>();
  for (const d of devices.filter((x) => x.category === category)) {
    const type = d.device_type ?? category;
    byType.set(type, [...(byType.get(type) ?? []), d]);
  }
  const newestFirst = (a: CatalogDevice, b: CatalogDevice) =>
    (b.released ?? "").localeCompare(a.released ?? "") || a.name.localeCompare(b.name, undefined, { numeric: true });
  const groups = [...byType]
    .map(([type, list]) => ({ label: type, devices: [...list].sort(newestFirst) }))
    .sort((a, b) => typeRank(category, a.label) - typeRank(category, b.label) || a.label.localeCompare(b.label));
  return groups.length === 1 ? [{ label: null, devices: groups[0].devices }] : groups;
}
