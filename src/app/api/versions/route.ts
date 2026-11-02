import { loadFromDatabase, SRC_DB } from "@/lib/dbSource";
import {
  EOL_FAMILIES,
  SRC_EOL,
  SRC_RSS,
  SUPPORTED_COUNT,
  cacheControl,
  merge,
  parseEol,
  parseRss,
  type Cycle,
  type Payload,
  type ReleaseItem,
} from "@/lib/versions";

const TIMEOUT_MS = 8000;
const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; apple-version-checker/2.0)" };
const EOL_URL = (slug: string) => `https://endoflife.date/api/${slug}.json`;
const RSS_URL = "https://developer.apple.com/news/releases/rss/releases.rss";

async function get(url: string): Promise<Response> {
  const res = await fetch(url, {
    headers: HEADERS,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

function errName(e: unknown): string {
  return e instanceof Error ? e.name : "Error";
}

/** Apple's developer feed: the newest releases and betas, hours ahead of the daily import. */
async function loadRss(sources: Record<string, string>): Promise<ReleaseItem[]> {
  try {
    const items = parseRss(await (await get(RSS_URL)).text());
    sources[SRC_RSS] = items.length ? "ok" : "error: no releases found";
    return items;
  } catch (e) {
    sources[SRC_RSS] = `error: ${errName(e)}`;
    return [];
  }
}

/** The pre-database path: endoflife.date read live. Used only if the database cannot be read. */
async function loadLiveEol(sources: Record<string, string>): Promise<Record<string, Record<string, Cycle>>> {
  const slugs = Object.keys(EOL_FAMILIES);
  const results = await Promise.allSettled(slugs.map(async (slug) => parseEol(await (await get(EOL_URL(slug))).json())));
  const eol: Record<string, Record<string, Cycle>> = {};
  const errors: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled" && Object.keys(r.value).length > 0) {
      eol[EOL_FAMILIES[slugs[i]]] = r.value;
    } else {
      errors.push(`${slugs[i]}: ${r.status === "rejected" ? errName(r.reason) : "no data"}`);
    }
  });
  sources[SRC_EOL] =
    errors.length === 0 ? "ok" : (Object.keys(eol).length ? "partial: " : "error: ") + errors.join(", ");
  return eol;
}

/**
 * GET /api/versions
 * Versions come from the database that the daily import fills, with Apple's RSS feed read
 * live on top so a brand-new release shows up before the next import. If the database
 * cannot be read, endoflife.date is read live instead. `?source=live` forces that path.
 */
export async function GET(request: Request) {
  const forceLive = new URL(request.url).searchParams.get("source") === "live";
  const sources: Record<string, string> = {};

  const rssPromise = loadRss(sources);
  let eol: Record<string, Record<string, Cycle>> | null = null;
  let dbItems: ReleaseItem[] = [];

  if (!forceLive) {
    try {
      const db = await loadFromDatabase();
      eol = db.eol;
      dbItems = db.items;
      sources[SRC_DB] = "ok";
    } catch (e) {
      sources[SRC_DB] = `error: ${e instanceof Error ? e.message : "failed"}`;
    }
  }
  if (!eol) eol = await loadLiveEol(sources);
  const rssItems = await rssPromise;

  const payload: Payload = {
    generated: new Date().toISOString().replace(/\.\d+Z$/, "+00:00"),
    supported_count: SUPPORTED_COUNT,
    sources,
    // Apple's own feed first: on a tie with the database, its entry wins.
    families: merge(eol, [...rssItems, ...dbItems]),
  };

  return Response.json(payload, {
    status: payload.families.length ? 200 : 502,
    headers: { "Cache-Control": cacheControl(payload) },
  });
}
