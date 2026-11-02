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

interface EolData {
  info: Partial<Record<DbFamily, Record<number, EolInfo>>>;
  /** The newest release of each major version, as endoflife.date reports it. */
  latest: { family: DbFamily; version: string; date: string | null }[];
}

/** endoflife.date: codename, release date, end-of-support date and latest release per major version. */
async function fetchEol(log: Log): Promise<EolData> {
  const out: EolData["info"] = {};
  const latest: EolData["latest"] = [];
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
        if (typeof e.latest === "string") {
          latest.push({ family: family as DbFamily, version: e.latest, date: isoDate(e.latestReleaseDate) });
        }
      }
      out[family as DbFamily] = byMajor;
    } catch (err) {
      log(`endoflife.date ${slug}: skipped (${err instanceof Error ? err.message : err})`);
    }
  }
  return { info: out, latest };
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
  for (const l of eol.latest) agg.addLatest(l.family, l.version, l.date);
  const plan = buildPlan(agg.all(), devices, eol.info);
  log(
    `Plan: ${plan.majors.length} major versions, ${plan.releases.length} releases, ` +
      `${plan.devices.length} devices, ${plan.support.length} device-support rows`,
  );
  if (plan.unknownDeviceKeys.length) log(`Builds mention ${plan.unknownDeviceKeys.length} device keys not in the device list`);
  log(`Hardware variants: ${plan.mergedVariants} folded into one entry, ${plan.unmergedVariants} left apart (support differs)`);
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

  await removeStale(db, plan, supportRows, new Set(deviceId.values()), log);
}

/** Read every row of a table, a page at a time (Supabase returns at most 1000 per request). */
async function selectAll<T>(db: SupabaseClient, table: string, columns: string, order: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).order(order).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as unknown as T[]));
    if (!data || data.length < 1000) return out;
  }
}

/**
 * Upserts never remove anything, so rows the plan no longer contains (a device that was
 * merged into another, or an OS version AppleDB dropped) are deleted here. A device that a
 * user has saved is never deleted; it is reported instead.
 */
async function removeStale(
  db: SupabaseClient,
  plan: Plan,
  supportRows: { device_id: number; major_version_id: number }[],
  plannedDeviceIds: Set<number>,
  log: Log,
): Promise<void> {
  const wanted = new Set(supportRows.map((r) => `${r.device_id}|${r.major_version_id}`));
  const existing = await selectAll<{ device_id: number; major_version_id: number }>(
    db, "device_os_support", "device_id, major_version_id", "device_id",
  );
  // Support rows of devices that are going away are removed with the device (cascade), so only
  // rows of devices that stay need deleting one by one.
  const staleSupport = existing.filter(
    (r) => plannedDeviceIds.has(r.device_id) && !wanted.has(`${r.device_id}|${r.major_version_id}`),
  );
  for (const r of staleSupport) {
    const { error } = await db.from("device_os_support").delete().eq("device_id", r.device_id).eq("major_version_id", r.major_version_id);
    if (error) throw new Error(`device_os_support: ${error.message}`);
  }
  if (staleSupport.length) log(`Removed ${staleSupport.length} outdated device-support rows`);

  const keep = new Set(plan.devices.map((d) => d.appledb_key));
  const devices = await selectAll<{ id: number; appledb_key: string }>(db, "devices", "id, appledb_key", "id");
  const saved = new Set((await selectAll<{ device_id: number }>(db, "user_devices", "device_id", "id")).map((r) => r.device_id));
  const stale = devices.filter((d) => !keep.has(d.appledb_key));
  const deletable = stale.filter((d) => !saved.has(d.id)).map((d) => d.id);
  for (let i = 0; i < deletable.length; i += 200) {
    const { error } = await db.from("devices").delete().in("id", deletable.slice(i, i + 200));
    if (error) throw new Error(`devices: ${error.message}`);
  }
  if (deletable.length) log(`Removed ${deletable.length} devices that are no longer listed`);
  if (stale.length > deletable.length) {
    log(`Kept ${stale.length - deletable.length} outdated devices because users have saved them`);
  }
}

export async function runImport(db: SupabaseClient, log: Log): Promise<Plan> {
  const plan = await collectPlan(log);
  await writePlan(db, plan, log);
  return plan;
}
