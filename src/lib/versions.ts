// Pure parsing and merging logic for the Apple OS version data. Ported from
// assign3's api/versions.py. No network access here, so it is easy to test.
//
// Sources in this version: endoflife.date (per-major latest release) and the
// Apple Developer RSS feed (newest releases plus beta/RC builds). The scraped
// Apple support pages and the AppleDB macOS stream are not ported; the
// database import job will cover pre-releases later.

export const SRC_EOL = "endoflife.date";
export const SRC_RSS = "Apple Developer RSS";

// Number of newest major versions treated as "supported".
export const SUPPORTED_COUNT = 3;
// Cap on major versions returned per OS, to keep the payload small.
const MAX_CYCLES = 8;

// Display name for each OS family, keyed by endoflife.date slug.
export const EOL_FAMILIES: Record<string, string> = {
  ios: "iOS",
  ipados: "iPadOS",
  macos: "macOS",
  watchos: "watchOS",
  tvos: "tvOS",
  visionos: "visionOS",
};

// Display order in the output.
export const FAMILY_ORDER = [
  "iOS",
  "iPadOS",
  "macOS",
  "watchOS",
  "tvOS",
  "visionOS",
  "HomePod Software",
] as const;

export type Family = (typeof FAMILY_ORDER)[number];

export interface Cycle {
  cycle: string;
  version: string;
  date: string;
  source: string;
  supported?: boolean;
  beta?: Beta | null;
}

export interface Beta {
  version: string;
  label: string;
  build: string;
  date: string;
  source: string;
}

export interface FamilyResult {
  name: string;
  cycles: Cycle[];
  beta: Beta | null;
}

export interface ReleaseItem {
  os: Family;
  version: string;
  pre: "beta" | "RC" | null;
  preN: string | null;
  build: string;
  date: string;
  source: string;
}

const VERSION_RE = /^\d+(?:\.\d+)*$/;
const RSS_TITLE_RE = new RegExp(
  "^(?<os>iOS|iPadOS|macOS|watchOS|tvOS|visionOS|HomePod Software)\\s+" +
    "(?:[A-Za-z]+(?:\\s[A-Za-z]+)?\\s+)?" + // optional marketing name, e.g. "Sequoia"
    "(?<version>\\d+(?:\\.\\d+)*)" +
    "(?:\\s+(?<pre>beta|RC|release candidate)(?:\\s+(?<preN>\\d+))?)?" +
    "(?:\\s*\\((?<build>[^)]+)\\))?",
  "i",
);

/** Convert a version string like "26.6.1" to numbers for comparison. */
export function verTuple(v: string): number[] {
  return v.split(".").map((x) => parseInt(x, 10));
}

/** Compare two version strings; negative if a < b. Missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const x = verTuple(a);
  const y = verTuple(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function makeCycle(cycle: string, version: string, date: string, source: string): Cycle {
  return { cycle, version, date, source };
}

// --- endoflife.date ---------------------------------------------------------

interface EolEntry {
  cycle?: unknown;
  latest?: unknown;
  latestReleaseDate?: unknown;
}

/** Convert endoflife.date entries into {major: cycle} for one OS. */
export function parseEol(entries: EolEntry[]): Record<string, Cycle> {
  const cycles: Record<string, Cycle> = {};
  for (const e of entries) {
    const cycle = String(e.cycle ?? "");
    const version = e.latest ? String(e.latest) : "";
    if (!/^\d+$/.test(cycle) || !VERSION_RE.test(version)) continue;
    cycles[cycle] = makeCycle(cycle, version, String(e.latestReleaseDate ?? ""), SRC_EOL);
  }
  return cycles;
}

// --- Apple Developer RSS ----------------------------------------------------

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function tagText(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? decodeEntities(m[1]).trim() : "";
}

/** Parse OS releases from the feed. Only <title> and <pubDate> are read, because
 * the HTML inside <content:encoded> is not always well-formed. */
export function parseRss(xml: string): ReleaseItem[] {
  const items: ReleaseItem[] = [];
  for (const m of xml.matchAll(/<item\b[\s\S]*?<\/item>/g)) {
    const block = m[0];
    const t = tagText(block, "title").match(RSS_TITLE_RE);
    if (!t?.groups) continue;
    const parsed = new Date(tagText(block, "pubDate"));
    const date = isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
    const pre = (t.groups.pre ?? "").toLowerCase();
    const os = FAMILY_ORDER.find((f) => f.toLowerCase() === t.groups!.os.toLowerCase());
    if (!os) continue;
    items.push({
      os,
      version: t.groups.version,
      pre: pre ? (pre === "rc" || pre === "release candidate" ? "RC" : "beta") : null,
      preN: t.groups.preN ?? null,
      build: t.groups.build ?? "",
      date,
      source: SRC_RSS,
    });
  }
  return items;
}

// --- Merging ----------------------------------------------------------------

/** Newest beta/RC for a family that is ahead of the released version in its
 * major cycle, or null. With `major` set, only that major version's
 * pre-releases are considered. On equal keys the earlier item wins. */
export function pickBeta(
  family: string,
  items: ReleaseItem[],
  cycles: Record<string, Cycle>,
  major?: string,
): Beta | null {
  let best: { key: [number[], number, number]; it: ReleaseItem } | null = null;
  for (const it of items) {
    if (it.os !== family || !it.pre) continue;
    const itMajor = it.version.split(".")[0];
    if (major !== undefined && itMajor !== major) continue;
    const released = cycles[itMajor];
    if (released && compareVersions(it.version, released.version) <= 0) continue; // already superseded
    const key: [number[], number, number] = [
      verTuple(it.version),
      it.pre === "RC" ? 1 : 0,
      parseInt(it.preN ?? "0", 10),
    ];
    if (best === null || compareKeys(key, best.key) > 0) best = { key, it };
  }
  if (!best) return null;
  const it = best.it;
  return {
    version: it.version,
    label: it.pre + (it.preN ? ` ${it.preN}` : ""),
    build: it.build,
    date: it.date,
    source: it.source,
  };
}

function compareKeys(a: [number[], number, number], b: [number[], number, number]): number {
  return compareVersions(a[0].join("."), b[0].join(".")) || a[1] - b[1] || a[2] - b[2];
}

/** Combine all sources into the final list of OS families.
 *
 * eol:   {family: {major: cycle}} from endoflife.date (may be partial)
 * items: parsed release and pre-release items from the RSS feed (may be empty)
 *
 * Each supported cycle gets its own `beta` (its newest pre-release, or null);
 * the family-level `beta` is the newest pre-release overall. */
export function merge(
  eol: Record<string, Record<string, Cycle>>,
  items: ReleaseItem[],
): FamilyResult[] {
  const families: FamilyResult[] = [];
  for (const name of FAMILY_ORDER) {
    // Copy so the overlay below never mutates the caller's data.
    const cycles: Record<string, Cycle> = {};
    for (const [k, c] of Object.entries(eol[name] ?? {})) cycles[k] = { ...c };

    // Overlay final releases from RSS when they are newer.
    for (const it of items) {
      if (it.os !== name || it.pre) continue;
      const major = it.version.split(".")[0];
      const current = cycles[major];
      if (!current || compareVersions(it.version, current.version) > 0) {
        cycles[major] = makeCycle(major, it.version, it.date, SRC_RSS);
      }
    }

    const all = Object.values(cycles);
    if (all.length === 0) continue;

    const ordered = all.sort((a, b) => parseInt(b.cycle, 10) - parseInt(a.cycle, 10)).slice(0, MAX_CYCLES);
    ordered.forEach((c, i) => {
      c.supported = i < SUPPORTED_COUNT;
      c.beta = c.supported ? pickBeta(name, items, cycles, c.cycle) : null;
    });

    families.push({ name, cycles: ordered, beta: pickBeta(name, items, cycles) });
  }
  return families;
}

export interface Payload {
  generated: string;
  supported_count: number;
  sources: Record<string, string>;
  families: FamilyResult[];
}

/** Cache a complete response for an hour. If any source failed, cache only briefly so
 * the missing data comes back soon. Responses with no data are never cached. */
export function cacheControl(payload: Payload): string {
  if (payload.families.length === 0) return "no-store";
  if (Object.values(payload.sources).some((s) => s !== "ok")) {
    return "s-maxage=300, stale-while-revalidate=3600";
  }
  return "s-maxage=3600, stale-while-revalidate=86400";
}
