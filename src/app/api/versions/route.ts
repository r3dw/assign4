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

export async function GET() {
  const slugs = Object.keys(EOL_FAMILIES);
  const [eolResults, rssResult] = await Promise.all([
    Promise.allSettled(slugs.map(async (slug) => parseEol(await (await get(EOL_URL(slug))).json()))),
    Promise.allSettled([get(RSS_URL).then((r) => r.text())]).then((r) => r[0]),
  ]);

  const sources: Record<string, string> = {};

  const eol: Record<string, Record<string, Cycle>> = {};
  const eolErrors: string[] = [];
  eolResults.forEach((r, i) => {
    if (r.status === "fulfilled" && Object.keys(r.value).length > 0) {
      eol[EOL_FAMILIES[slugs[i]]] = r.value;
    } else {
      eolErrors.push(`${slugs[i]}: ${r.status === "rejected" ? errName(r.reason) : "no data"}`);
    }
  });
  sources[SRC_EOL] = eolErrors.length === 0
    ? "ok"
    : (Object.keys(eol).length ? "partial: " : "error: ") + eolErrors.join(", ");

  let items: ReleaseItem[] = [];
  if (rssResult.status === "fulfilled") {
    try {
      items = parseRss(rssResult.value);
      sources[SRC_RSS] = items.length ? "ok" : "error: no releases found";
    } catch (e) {
      sources[SRC_RSS] = `error: ${errName(e)}`;
    }
  } else {
    sources[SRC_RSS] = `error: ${errName(rssResult.reason)}`;
  }

  const payload: Payload = {
    generated: new Date().toISOString().replace(/\.\d+Z$/, "+00:00"),
    supported_count: SUPPORTED_COUNT,
    sources,
    families: merge(eol, items),
  };

  return Response.json(payload, {
    status: payload.families.length ? 200 : 502,
    headers: { "Cache-Control": cacheControl(payload) },
  });
}
