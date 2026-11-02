import "server-only";
import { createPublicClient } from "./supabase";
import { FAMILY_ORDER, compareVersions, type Cycle, type Family, type ReleaseItem } from "./versions";

export const SRC_DB = "Imported data (AppleDB, endoflife.date)";

/** How many of the newest major versions per OS to read. The importer keeps releases for 8. */
const MAJORS_PER_FAMILY = 12;
const PAGE = 1000; // Supabase returns at most 1000 rows per request

interface Page<T> {
  data: T[] | null;
  error: { message: string } | null;
}

async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<Page<T>>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

const isFamily = (name: string): name is Family => (FAMILY_ORDER as readonly string[]).includes(name);

/**
 * Read the imported data: the latest release of each major version (shaped like
 * endoflife.date entries, so merge() can use them) and every beta/RC (shaped like
 * Apple RSS items). Throws if the database is unreachable or empty, so the caller can
 * fall back to the live sources.
 */
export async function loadFromDatabase(): Promise<{
  eol: Record<string, Record<string, Cycle>>;
  items: ReleaseItem[];
}> {
  const db = createPublicClient();

  const majorsRes = await db.from("os_major_versions").select("id, major, os_families!inner(name)");
  if (majorsRes.error) throw new Error(majorsRes.error.message);
  const majors = (majorsRes.data as unknown as { id: number; major: number; os_families: { name: string } }[])
    .filter((m) => isFamily(m.os_families.name));
  if (majors.length === 0) throw new Error("no imported data yet");

  // Only the newest few major versions of each OS matter to this page.
  const chosen = new Map<number, { family: Family; major: number }>();
  for (const family of FAMILY_ORDER) {
    majors
      .filter((m) => m.os_families.name === family)
      .sort((a, b) => b.major - a.major)
      .slice(0, MAJORS_PER_FAMILY)
      .forEach((m) => chosen.set(m.id, { family, major: m.major }));
  }
  const ids = [...chosen.keys()];

  const rows = await fetchAll<{
    major_version_id: number;
    version: string;
    build: string;
    kind: "release" | "beta" | "rc";
    pre_release_number: number | null;
    released: string | null;
  }>((from, to) =>
    db
      .from("os_releases")
      .select("major_version_id, version, build, kind, pre_release_number, released")
      .in("major_version_id", ids)
      .order("id")
      .range(from, to),
  );

  const eol: Record<string, Record<string, Cycle>> = {};
  const items: ReleaseItem[] = [];
  for (const r of rows) {
    const m = chosen.get(r.major_version_id);
    if (!m) continue;
    if (r.kind === "release") {
      const byMajor = (eol[m.family] ??= {});
      const key = String(m.major);
      const current = byMajor[key];
      const cmp = current ? compareVersions(r.version, current.version) : 1;
      // The highest version wins; between two records of the same version, prefer one with a date.
      if (cmp > 0 || (cmp === 0 && current && !current.date && r.released)) {
        byMajor[key] = { cycle: key, version: r.version, date: r.released ?? "", source: SRC_DB };
      }
    } else {
      items.push({
        os: m.family,
        version: r.version,
        pre: r.kind === "rc" ? "RC" : "beta",
        preN: r.pre_release_number === null ? null : String(r.pre_release_number),
        build: r.build,
        date: r.released ?? "",
        source: SRC_DB,
      });
    }
  }
  if (Object.keys(eol).length === 0) throw new Error("no releases in the database");
  return { eol, items };
}
