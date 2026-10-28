// Date helpers and card-layout rules shared by the page components.
// Ported from assign3's public/app.js.
import type { FamilyResult, Cycle, Beta, Payload } from "./versions";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

export function formatDate(iso: string): string {
  const m = ISO_DATE.exec(iso || "");
  if (!m) return iso || "Date not available";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
  );
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

/** "?now=YYYY-MM-DD" overrides the clock so the "New" badge can be previewed. */
export function previewDate(search: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(new URLSearchParams(search).get("now") || "");
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : null;
}

/** Release dates have no time of day, so "new" means released today or yesterday (UTC). */
export function newness(iso: string, now: number): "today" | "yesterday" | null {
  const m = ISO_DATE.exec(iso || "");
  if (!m) return null;
  const days = Math.floor((now - Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) / 86400000);
  return days === 0 ? "today" : days === 1 ? "yesterday" : null;
}

export function osName(name: string): string {
  return name === "HomePod Software" ? "HomePod" : name;
}

export function betaKey(family: string, b: Beta): string {
  return `${family} beta ${b.version} ${b.label}`;
}

export function cycleKey(family: string, version: string): string {
  return `${family} ${version}`;
}

/** The headline shows the newest version's own pre-release, or a pre-release of a major
 * version that has no public release yet. Older lines show theirs under their own row. */
export function headBeta(family: FamilyResult, latest: Cycle): Beta | null {
  return (
    latest.beta ||
    (family.beta && Number(family.beta.version.split(".")[0]) > Number(latest.cycle) ? family.beta : null)
  );
}

export function visibleCycles(family: FamilyResult, older: boolean): Cycle[] {
  return family.cycles.filter((c) => older || c.supported);
}

/** Every badge-eligible item on screen, in display order: [key, release date]. */
export function badgeEntries(data: Payload, older: boolean, showBeta: boolean): [string, string][] {
  const out: [string, string][] = [];
  for (const f of data.families) {
    const [latest, ...others] = visibleCycles(f, older);
    if (!latest) continue;
    out.push([cycleKey(f.name, latest.version), latest.date]);
    const hb = headBeta(f, latest);
    if (showBeta && hb) out.push([betaKey(f.name, hb), hb.date]);
    for (const c of others) {
      out.push([cycleKey(f.name, c.version), c.date]);
      if (showBeta && c.beta) out.push([betaKey(f.name, c.beta), c.beta.date]);
    }
  }
  return out;
}
