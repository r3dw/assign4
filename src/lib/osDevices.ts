// Shape of the /api/os-devices response, shared by the route and the dialog.

export interface OsDevice {
  name: string;
  category: string;
  /** First and last release of this major version that runs on the device, e.g. "16.0" and "16.7.16". */
  first: string;
  last: string;
}

export interface OsDevices {
  family: string;
  major: number;
  codename: string | null;
  devices: OsDevice[];
}

/** Order device categories as a person would list them. Unknown ones sort last. */
const CATEGORY_ORDER = ["iPhone", "iPad", "iPod touch", "Mac", "Apple Watch", "Apple TV", "HomePod", "Apple Vision"];

export function categoryRank(category: string): number {
  const i = CATEGORY_ORDER.indexOf(category);
  return i === -1 ? CATEGORY_ORDER.length : i;
}

/** Group devices by category, in display order. Devices keep their incoming order within a group. */
export function groupByCategory(devices: OsDevice[]): { category: string; devices: OsDevice[] }[] {
  const groups = new Map<string, OsDevice[]>();
  for (const d of devices) groups.set(d.category, [...(groups.get(d.category) ?? []), d]);
  return [...groups]
    .map(([category, list]) => ({ category, devices: list }))
    .sort((a, b) => categoryRank(a.category) - categoryRank(b.category) || a.category.localeCompare(b.category));
}
