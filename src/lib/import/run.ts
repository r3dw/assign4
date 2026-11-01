// The import job: reads AppleDB, endoflife.date and Apple's RSS feed, builds a plan
// (see appledb.ts), and writes it to Supabase. Run by the daily cron route and by
// `npm run import`. Safe to run repeatedly: every write is an upsert.
import type { SupabaseClient } from "@supabase/supabase-js";
import { EOL_FAMILIES, parseRss } from "../versions.ts";
import {
  APPLEDB_DEVICES_URL,
  APPLEDB_SOURCES,
  Aggregator,
  DB_FAMILIES,
  buildPlan,
  isoDate,
  type DbFamily,
  type DeviceRecord,
  type EolInfo,
  type Plan,
} from "./appledb.ts";
import { fetchJsonArray } from "./jsonStream.ts";

type Log = (message: string) => void;

const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; apple-version-checker/2.0)" };
const RSS_URL = "https://developer.apple.com/news/releases/rss/releases.rss";

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(60_000), cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

/** endoflife.date: codename, release date and end-of-support date per major version. */
async function fetchEol(log: Log): Promise<Partial<Record<DbFamily, Record<number, EolInfo>>>> {
  const out: Partial<Record<DbFamily, Record<number, EolInfo>>> = {};
  for (const [slug, family] of Object.entries(EOL_FAMILIES)) {
    try {
      const entries = (await getJson(`https://endoflife.date/api/${slug}.json`)) as Record<string, unknown>[];
      const byMajor: Record<number, EolInfo> = {};
      for (const e of entries) {
        const cycle = String(e.cycle ?? "");
        if (!/^\d+$/.test(cycle)) continue; // skips old "10.15"-style cycles
        byMajor[Number(cycle)] = {
          released: isoDate(e.releaseDate),
          endOfSupport: isoDate(e.eol),
          codename: typeof e.codename === "string" ? e.codename : null,
        };
      }
      out[family as DbFamily] = byMajor;
    } catch (err) {
      log(`endoflife.date ${slug}: skipped (${err instanceof Error ? err.message : err})`);
    }
  }
  return out;
}

/** Download everything and work out what the database should contain. Writes nothing. */
export async function collectPlan(log: Log): Promise<Plan> {
  const agg = new Aggregator();

  // Apple's own feed first: on a tie with AppleDB its entry is kept.
  try {
    const res = await fetch(RSS_URL, { headers: HEADERS, signal: AbortSignal.timeout(30_000), cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = parseRss(await res.text());
    items.forEach((i) => agg.addRss(i));
    log(`Apple RSS: ${items.length} releases`);
  } catch (err) {
    log(`Apple RSS: skipped (${err instanceof Error ? err.message : err})`);
  }

  const devices = (await getJson(APPLEDB_DEVICES_URL)) as DeviceRecord[];
  log(`AppleDB devices: ${devices.length} products`);

  for (const src of APPLEDB_SOURCES) {
    const t = Date.now();
    const before = agg.stats.builds;
    for await (const build of fetchJsonArray(src.url)) agg.addBuild(build);
    log(`AppleDB ${src.label}: ${agg.stats.builds - before} builds in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  }

  const eol = await fetchEol(log);
  const plan = buildPlan(agg.all(), devices, eol);
  log(
    `Plan: ${plan.majors.length} major versions, ${plan.releases.length} releases, ` +
      `${plan.devices.length} devices, ${plan.support.length} device-support rows`,
  );
  if (plan.unknownDeviceKeys.length) log(`Builds mention ${plan.unknownDeviceKeys.length} device keys not in the device list`);
  return plan;
}

const BATCH = 500;

async function upsertAll<T extends object>(
  db: SupabaseClient,
  table: string,
  rows: T[],
  onConflict: string,
  select?: string,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const q = db.from(table).upsert(rows.slice(i, i + BATCH), { onConflict });
    const { data, error } = select ? await q.select(select) : await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    if (data) out.push(...(data as unknown as Record<string, unknown>[]));
  }
  return out;
}

/** Write a plan to the database. */
export async function writePlan(db: SupabaseClient, plan: Plan, log: Log): Promise<void> {
  const fam = await upsertAll(db, "os_families", DB_FAMILIES.map((name) => ({ name })), "name", "id,name");
  const familyId = new Map(fam.map((f) => [f.name as string, f.id as number]));

  const majorRows = plan.majors.map(({ family, ...m }) => ({ family_id: familyId.get(family)!, ...m }));
  const majors = await upsertAll(db, "os_major_versions", majorRows, "family_id,major", "id,family_id,major");
  const majorId = new Map(majors.map((m) => [`${m.family_id}|${m.major}`, m.id as number]));
  const idOf = (family: DbFamily, major: number) => majorId.get(`${familyId.get(family)}|${major}`)!;
  log(`Wrote ${majors.length} major versions`);

  const devs = await upsertAll(db, "devices", plan.devices, "appledb_key", "id,appledb_key");
  const deviceId = new Map(devs.map((d) => [d.appledb_key as string, d.id as number]));
  log(`Wrote ${devs.length} devices`);

  const releaseRows = plan.releases.map((r) => ({
    major_version_id: idOf(r.family, r.major),
    version: r.version,
    build: r.build,
    kind: r.kind,
    pre_release_number: r.preN,
    released: r.released,
    source: r.source,
  }));
  await upsertAll(db, "os_releases", releaseRows, "major_version_id,version,build,kind,pre_release_number");
  log(`Wrote ${releaseRows.length} releases`);

  const supportRows = plan.support.map((s) => ({
    device_id: deviceId.get(s.deviceKey)!,
    major_version_id: idOf(s.family, s.major),
    first_version: s.first,
    last_version: s.last,
  }));
  await upsertAll(db, "device_os_support", supportRows, "device_id,major_version_id");
  log(`Wrote ${supportRows.length} device-support rows`);
}

export async function runImport(db: SupabaseClient, log: Log): Promise<Plan> {
  const plan = await collectPlan(log);
  await writePlan(db, plan, log);
  return plan;
}
