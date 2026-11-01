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
        if (!categoryOf(d.type)) continue;
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

  return { majors, releases, devices, support, unknownDeviceKeys: [...unknown].sort() };
}
