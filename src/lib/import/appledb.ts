// Turns AppleDB build records into what the database stores. Pure functions and a small
// aggregator, with no network or database access, so they can be tested offline.
//
// AppleDB lists every OS build with a `deviceMap` (the devices that build runs on). For each
// OS family and major version we keep: the release builds, recent beta/RC builds, and, for
// every device, the first and last release it can run.
import { compareVersions, type ReleaseItem } from "../versions.ts";

export const DB_FAMILIES = [
  "iOS",
  "iPadOS",
  "macOS",
  "watchOS",
  "tvOS",
  "visionOS",
  "HomePod Software",
] as const;
export type DbFamily = (typeof DB_FAMILIES)[number];

/** AppleDB files to read, by the OS family they contain. The iOS file also holds iPadOS. */
export const APPLEDB_SOURCES: { url: string; label: string }[] = [
  { url: "https://api.appledb.dev/ios/iOS/main.json.gz", label: "iOS and iPadOS" },
  { url: "https://api.appledb.dev/ios/macOS/main.json.gz", label: "macOS" },
  { url: "https://api.appledb.dev/ios/watchOS/main.json.gz", label: "watchOS" },
  { url: "https://api.appledb.dev/ios/tvOS/main.json.gz", label: "tvOS" },
  { url: "https://api.appledb.dev/ios/visionOS/main.json.gz", label: "visionOS" },
  { url: "https://api.appledb.dev/ios/HomePod%20Software/main.json.gz", label: "HomePod Software" },
];
export const APPLEDB_DEVICES_URL = "https://api.appledb.dev/device/main.json";

// Older products used other names for the same OS line.
const FAMILY_BY_OSSTR: Record<string, DbFamily> = {
  iOS: "iOS",
  "iPhone OS": "iOS",
  "iPhone Software": "iOS",
  iPadOS: "iPadOS",
  macOS: "macOS",
  "OS X": "macOS",
  "Mac OS X": "macOS",
  watchOS: "watchOS",
  tvOS: "tvOS",
  "Apple TV Software": "tvOS",
  visionOS: "visionOS",
  "HomePod Software": "HomePod Software",
};

/** How many of the newest major versions per family keep their individual releases. */
export const RELEASE_MAJORS = 8;
/** Apple supports roughly the three newest major versions of each OS. */
export const SUPPORTED_MAJORS = 3;

export type ReleaseKind = "release" | "beta" | "rc";

export interface ReleaseRecord {
  version: string;
  build: string;
  kind: ReleaseKind;
  preN: number | null;
  released: string | null;
  source: string;
}

export interface Range {
  first: string;
  last: string;
}

export interface MajorAgg {
  family: DbFamily;
  major: number;
  released: string | null; // earliest release date of a final build
  hasRelease: boolean; // at least one final (non-beta) build exists
  releases: Map<string, ReleaseRecord>;
  support: Map<string, Range>; // device key -> range, from final builds
  preSupport: Map<string, Range>; // same, from beta/RC builds (used if no final build exists yet)
}

const LEADING_VERSION = /^\d+(?:\.\d+)*/;
const PRE_RE = /^(\d+(?:\.\d+)*)\s+(beta|RC)(?:\s+(\d+))?$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isoDate(v: unknown): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && ISO_DATE.test(s) ? s : null;
}

function widen(map: Map<string, Range>, key: string, version: string) {
  const r = map.get(key);
  if (!r) map.set(key, { first: version, last: version });
  else {
    if (compareVersions(version, r.first) < 0) r.first = version;
    if (compareVersions(version, r.last) > 0) r.last = version;
  }
}

export class Aggregator {
  private majors = new Map<string, MajorAgg>();
  /** Counts of builds seen, for the log. */
  stats = { builds: 0, skipped: 0 };

  private major(family: DbFamily, major: number): MajorAgg {
    const key = `${family}|${major}`;
    let m = this.majors.get(key);
    if (!m) {
      m = {
        family,
        major,
        released: null,
        hasRelease: false,
        releases: new Map(),
        support: new Map(),
        preSupport: new Map(),
      };
      this.majors.set(key, m);
    }
    return m;
  }

  private note(m: MajorAgg, rec: ReleaseRecord) {
    const key = `${rec.kind}|${rec.version}|${rec.build}|${rec.preN}`;
    if (!m.releases.has(key)) m.releases.set(key, rec); // first writer wins: add Apple's feed first
    if (rec.kind === "release") {
      m.hasRelease = true;
      if (rec.released && (!m.released || rec.released < m.released)) m.released = rec.released;
    }
  }

  /** Add one item from Apple's developer RSS feed. */
  addRss(item: ReleaseItem) {
    const major = parseInt(item.version.split(".")[0], 10);
    if (!Number.isFinite(major)) return;
    const kind: ReleaseKind = item.pre === "RC" ? "rc" : item.pre === "beta" ? "beta" : "release";
    this.note(this.major(item.os, major), {
      version: item.version,
      build: item.build,
      kind,
      preN: item.preN ? parseInt(item.preN, 10) : null,
      released: item.date || null,
      source: "apple-rss",
    });
  }

  /**
   * Add the latest release of a major version as reported by endoflife.date. AppleDB
   * sometimes lacks the newest point release or its date; the page shows the highest version
   * it has from either source.
   */
  addLatest(family: DbFamily, version: string, date: string | null) {
    const major = parseInt(version.split(".")[0], 10);
    if (!Number.isFinite(major) || !LEADING_VERSION.test(version)) return;
    this.note(this.major(family, major), {
      version,
      build: "",
      kind: "release",
      preN: null,
      released: date,
      source: "endoflife.date",
    });
  }

  /** Add one build record from an AppleDB file. Unrecognised records are skipped. */
  addBuild(raw: unknown) {
    const b = raw as {
      osStr?: unknown;
      version?: unknown;
      build?: unknown;
      released?: unknown;
      beta?: unknown;
      rc?: unknown;
      deviceMap?: unknown;
    };
    const family = typeof b?.osStr === "string" ? FAMILY_BY_OSSTR[b.osStr] : undefined;
    const versionText = typeof b?.version === "string" ? b.version.trim() : "";
    if (!family || !versionText) {
      this.stats.skipped++;
      return;
    }
    this.stats.builds++;
    const isPre = b.beta === true || b.rc === true;
    const leading = LEADING_VERSION.exec(versionText)?.[0];
    if (!leading) {
      this.stats.skipped++;
      return;
    }
    const m = this.major(family, parseInt(leading.split(".")[0], 10));
    const devices = Array.isArray(b.deviceMap) ? (b.deviceMap as unknown[]).filter((d) => typeof d === "string") : [];
    for (const d of devices as string[]) widen(isPre ? m.preSupport : m.support, d, leading);

    const build = typeof b.build === "string" ? b.build : "";
    const released = isoDate(b.released);
    if (!isPre) {
      this.note(m, { version: leading, build, kind: "release", preN: null, released, source: "appledb" });
      return;
    }
    // Only names like "27.2 beta 4" or "26.7.2 RC 3" become pre-release rows; builds such as
    // "27.2 beta 4 SDK" or "26.3 (a)" still count towards device support above.
    const p = PRE_RE.exec(versionText);
    if (p) {
      this.note(m, {
        version: p[1],
        build,
        kind: p[2].toLowerCase() === "rc" ? "rc" : "beta",
        preN: p[3] ? parseInt(p[3], 10) : null,
        released,
        source: "appledb",
      });
    }
  }

  all(): MajorAgg[] {
    return [...this.majors.values()];
  }
}

// --- Devices ----------------------------------------------------------------

export interface DeviceRecord {
  key: string;
  name: string;
  type?: string;
  identifier?: string[];
  model?: string[];
  soc?: string;
  released?: unknown;
  discontinued?: unknown;
}

/** AppleDB also lists prototypes, e.g. "Unreleased iPad Pro". Nobody owns those. */
const NOT_A_PRODUCT = /^(unreleased|prototype)\b/i;

/** Group AppleDB's many product types into the categories shown in the device dropdown. */
export function categoryOf(type: string | undefined): string | null {
  if (!type) return null;
  if (type === "iPhone") return "iPhone";
  if (type === "iPod touch") return "iPod touch";
  if (type.startsWith("iPad")) return "iPad";
  if (/^(Mac|iMac|PowerMac|PowerBook|iBook|eMac|Xserve)/.test(type)) return "Mac";
  if (type === "Apple Watch") return "Apple Watch";
  if (type === "Apple TV") return "Apple TV";
  if (type === "HomePod") return "HomePod";
  if (type === "Headset") return "Apple Vision";
  return null;
}

export interface DeviceRow {
  appledb_key: string;
  name: string;
  category: string;
  device_type: string | null;
  identifiers: string[];
  model_numbers: string[];
  soc: string | null;
  released: string | null;
  discontinued: string | null;
}

export function toDeviceRow(d: DeviceRecord, category: string): DeviceRow {
  return {
    appledb_key: d.key,
    name: d.name,
    category,
    device_type: d.type ?? null,
    identifiers: Array.isArray(d.identifier) ? d.identifier : [],
    model_numbers: Array.isArray(d.model) ? d.model : [],
    soc: typeof d.soc === "string" ? d.soc : null,
    released: isoDate(d.released),
    discontinued: isoDate(d.discontinued),
  };
}

// --- Merging hardware variants ------------------------------------------------------
// AppleDB lists a product once per model: "iPhone 8 (CDMA)" and "iPhone 8 (GSM)", an iPad
// as "Wi-Fi" and "Wi-Fi + Cellular", a watch per case size. They run exactly the same
// software, so people picking their device should see one entry.

/** A device name without connectivity, carrier, region and case-size tags. */
export function baseName(name: string, category: string): string {
  let n = name;
  for (;;) {
    const before = n;
    n = n
      // Trailing tags: carrier or region ("(CDMA)", "(VZ)"), storage ("(1TB)", "(1 or 2 TB)"), "(TD-LTE)".
      .replace(/\s+\((?:CDMA|GSM|China Mainland|VZ|MM)\)\s*$/i, "")
      .replace(/\s*\(\s*\d+(?:\s*or\s*\d+)?\s*(?:GB|TB)\s*\)\s*$/i, "")
      .replace(/\s+\(TD[- ]LTE\)\s*$/i, "")
      // Connectivity anywhere in the name: "iPad Pro 11-inch Wi-Fi + Cellular (M5)" -> "iPad Pro 11-inch (M5)".
      .replace(/\s+Wi-?Fi(?:\s*\+\s*(?:Cellular|Ethernet|3G|4G))?(?=\s|\(|$)/gi, "");
    if (n === before) break;
  }
  if (category === "Apple Watch") {
    n = n
      .replace(/,?\s*GPS(?:\s*\+\s*Cellular)?/gi, "")
      .replace(/,?\s*\d+\s*mm/gi, "")
      .replace(/\s*\([\s,]*\)/g, ""); // parentheses left empty by the removals
  }
  return n.replace(/\s+/g, " ").trim();
}

/**
 * Collapse variants of one product into a single device. Variants merge only when they share
 * a base name and category AND the same newest supported major version of each OS (so a
 * merged entry never hides a real difference in how far the hardware goes). Point-release
 * differences between variants (9.3.5 vs 9.3.6) are noise: the merged entry takes the widest
 * range. A group whose newest versions differ is left exactly as AppleDB lists it.
 */
export function mergeVariants(
  devices: DeviceRow[],
  support: Plan["support"],
): { devices: DeviceRow[]; support: Plan["support"]; merged: number; kept: number } {
  const byDevice = new Map<string, Plan["support"]>();
  for (const s of support) byDevice.set(s.deviceKey, [...(byDevice.get(s.deviceKey) ?? []), s]);

  // "iOS|16;iPadOS|18": the newest major supported in each OS family.
  const top = (key: string) => {
    const newest = new Map<string, number>();
    for (const s of byDevice.get(key) ?? []) newest.set(s.family, Math.max(newest.get(s.family) ?? -1, s.major));
    return [...newest].map(([f, m]) => `${f}|${m}`).sort().join(";");
  };

  const groups = new Map<string, DeviceRow[]>();
  for (const d of devices) {
    const key = `${d.category}|${baseName(d.name, d.category)}`;
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }

  const out: DeviceRow[] = [];
  const outSupport: Plan["support"] = [];
  const keptApart = new Set<string>();
  let merged = 0;
  let kept = 0;
  for (const members of groups.values()) {
    const sameTop = members.every((m) => top(m.appledb_key) === top(members[0].appledb_key));
    if (members.length === 1 || !sameTop) {
      if (members.length > 1) kept += members.length;
      out.push(...members);
      members.forEach((m) => keptApart.add(m.appledb_key));
      continue;
    }
    const sorted = [...members].sort((a, b) => a.appledb_key.localeCompare(b.appledb_key));
    const first = sorted[0]; // the lowest key is the stable identity of the merged device
    const dates = (f: "released" | "discontinued") => sorted.map((m) => m[f]).filter((x): x is string => !!x).sort();
    out.push({
      ...first,
      name: baseName(first.name, first.category),
      identifiers: [...new Set(sorted.flatMap((m) => [m.appledb_key, ...m.identifiers]))].sort(),
      model_numbers: [...new Set(sorted.flatMap((m) => m.model_numbers))].sort(),
      released: dates("released")[0] ?? null,
      discontinued: dates("discontinued").at(-1) ?? null,
    });
    merged += sorted.length - 1;

    // One support row per OS version, spanning every variant's range.
    const rows = new Map<string, Plan["support"][number]>();
    for (const m of sorted) {
      for (const s of byDevice.get(m.appledb_key) ?? []) {
        const k = `${s.family}|${s.major}`;
        const r = rows.get(k);
        if (!r) rows.set(k, { ...s, deviceKey: first.appledb_key });
        else {
          if (compareVersions(s.first, r.first) < 0) r.first = s.first;
          if (compareVersions(s.last, r.last) > 0) r.last = s.last;
        }
      }
    }
    outSupport.push(...rows.values());
  }
  for (const s of support) if (keptApart.has(s.deviceKey)) outSupport.push(s);

  out.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  return { devices: out, support: outSupport, merged, kept };
}

// --- The plan: everything to write, keyed by natural keys ---------------------------

export interface EolInfo {
  released?: string | null;
  endOfSupport?: string | null;
  codename?: string | null;
}

export interface Plan {
  majors: {
    family: DbFamily;
    major: number;
    codename: string | null;
    released: string | null;
    end_of_support: string | null;
    is_supported: boolean;
  }[];
  releases: (ReleaseRecord & { family: DbFamily; major: number })[];
  devices: DeviceRow[];
  support: { deviceKey: string; family: DbFamily; major: number; first: string; last: string }[];
  /** Device keys that builds mention but the device list does not know, for the log. */
  unknownDeviceKeys: string[];
  /** Hardware variants folded into another device, and variants left apart because their support differs. */
  mergedVariants: number;
  unmergedVariants: number;
}

export function buildPlan(
  majorsAgg: MajorAgg[],
  deviceList: DeviceRecord[],
  eol: Partial<Record<DbFamily, Record<number, EolInfo>>>,
): Plan {
  const byKey = new Map(deviceList.map((d) => [d.key, d]));

  // Rank majors per family: newest first, to pick supported ones and which keep releases.
  const byFamily = new Map<DbFamily, MajorAgg[]>();
  for (const m of majorsAgg) byFamily.set(m.family, [...(byFamily.get(m.family) ?? []), m]);
  for (const list of byFamily.values()) list.sort((a, b) => b.major - a.major);

  const majors: Plan["majors"] = [];
  const releases: Plan["releases"] = [];
  const support: Plan["support"] = [];
  const usedDevices = new Set<string>();
  const unknown = new Set<string>();

  for (const [family, list] of byFamily) {
    const supportedSet = new Set(list.filter((m) => m.hasRelease).slice(0, SUPPORTED_MAJORS).map((m) => m.major));
    list.forEach((m, rank) => {
      const e = eol[family]?.[m.major];
      majors.push({
        family,
        major: m.major,
        codename: e?.codename ?? null,
        released: e?.released ?? m.released,
        end_of_support: e?.endOfSupport ?? null,
        is_supported: supportedSet.has(m.major),
      });
      if (rank < RELEASE_MAJORS) {
        for (const r of m.releases.values()) releases.push({ ...r, family, major: m.major });
      }
      // Devices a major version runs on: from final builds, or from betas if it has none yet.
      const range = m.hasRelease ? m.support : m.preSupport;
      for (const [key, r] of range) {
        const d = byKey.get(key);
        if (!d) {
          unknown.add(key);
          continue;
        }
        if (!categoryOf(d.type) || NOT_A_PRODUCT.test(d.name)) continue;
        usedDevices.add(key);
        support.push({ deviceKey: key, family, major: m.major, first: r.first, last: r.last });
      }
    });
  }

  const devices: DeviceRow[] = [];
  for (const key of usedDevices) {
    const d = byKey.get(key)!;
    devices.push(toDeviceRow(d, categoryOf(d.type)!));
  }
  devices.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

  const m = mergeVariants(devices, support);
  return {
    majors,
    releases,
    devices: m.devices,
    support: m.support,
    unknownDeviceKeys: [...unknown].sort(),
    mergedVariants: m.merged,
    unmergedVariants: m.kept,
  };
}
