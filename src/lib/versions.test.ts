// Offline tests for versions.ts, ported from assign3's tests/test_versions.py
// (the scraper and AppleDB tests do not apply yet). Run with: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SRC_EOL,
  SRC_RSS,
  cacheControl,
  merge,
  parseEol,
  parseRss,
  pickBeta,
  type Cycle,
  type Payload,
  type ReleaseItem,
} from "./versions.ts";

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
<item><title>Xcode 27.1 (27A9275)</title><pubDate>Thu, 15 Oct 2026 13:00:00 PDT</pubDate></item>
<item><title>iOS 27.2 beta 4 (24B5110a)</title><pubDate>Tue, 13 Oct 2026 10:00:00 PDT</pubDate></item>
<item><title>iOS 27.2 beta 3 (24B5100a)</title><pubDate>Tue, 06 Oct 2026 10:00:00 PDT</pubDate></item>
<item><title>iOS 27.0.1 (24A446)</title><pubDate>Mon, 28 Sep 2026 10:00:00 PDT</pubDate></item>
<item><title>macOS 26.7.2 (25X1)</title><pubDate>Mon, 12 Oct 2026 10:00:00 PDT</pubDate></item>
<item><title>iOS 26.8 RC (23Z1)</title><pubDate>Mon, 12 Oct 2026 10:00:00 PDT</pubDate></item>
<item><title>iOS 27.0 beta 1 (24A100)</title><pubDate>Mon, 01 Jun 2026 10:00:00 PDT</pubDate></item>
</channel></rss>`;

function eol(...rows: [string, string, string][]) {
  return parseEol(rows.map(([cycle, latest, latestReleaseDate]) => ({ cycle, latest, latestReleaseDate })));
}

describe("parseRss", () => {
  it("ignores non-OS items and flags pre-releases", () => {
    const items = parseRss(RSS);
    assert.equal(items.length, 6); // Xcode skipped
    const b4 = items[0];
    assert.deepEqual(
      [b4.os, b4.version, b4.pre, b4.preN, b4.build, b4.date],
      ["iOS", "27.2", "beta", "4", "24B5110a", "2026-10-13"],
    );
    assert.equal(items.find((i) => i.version === "26.8")!.pre, "RC");
    assert.equal(items.find((i) => i.version === "27.0.1")!.pre, null);
  });

  it("accepts marketing names", () => {
    const xml = `<rss version="2.0"><channel>
      <item><title>macOS Sequoia 15.7 beta 2 (24G5070a)</title><pubDate>Mon, 06 Oct 2026 10:00:00 PDT</pubDate></item>
      <item><title>macOS Golden Gate 27.2 RC (26B118)</title><pubDate>Mon, 19 Oct 2026 10:00:00 PDT</pubDate></item>
      <item><title><![CDATA[iOS 27.2 beta 4 (24B5110a)]]></title><pubDate>Tue, 13 Oct 2026 10:00:00 PDT</pubDate></item>
      <item><title>Xcode 27.1 (27A9275)</title><pubDate>Thu, 15 Oct 2026 13:00:00 PDT</pubDate></item>
      </channel></rss>`;
    const got = parseRss(xml).map((i) => [i.os, i.version, i.pre, i.preN ?? "-", i.build].join("|")).sort();
    assert.deepEqual(got, [
      "iOS|27.2|beta|4|24B5110a",
      "macOS|15.7|beta|2|24G5070a",
      "macOS|27.2|RC|-|26B118",
    ]);
  });
});

describe("merge", () => {
  const items = parseRss(RSS);

  it("picks the newest beta and drops stale ones", () => {
    const cycles = eol(["27", "27.0.1", "2026-09-28"], ["26", "26.7.1", "2026-09-28"]);
    const beta = pickBeta("iOS", items, cycles)!;
    assert.deepEqual([beta.version, beta.label], ["27.2", "beta 4"]); // 27.0 beta 1 is stale
  });

  it("highest version wins across cycles", () => {
    const beta = pickBeta("iOS", items, eol(["26", "26.7.1", "2026-09-28"]))!;
    assert.deepEqual([beta.version, beta.label], ["27.2", "beta 4"]);
  });

  it("reports an RC when it is the newest", () => {
    const only = items.filter((i) => i.version === "26.8");
    const beta = pickBeta("iOS", only, eol(["26", "26.7.1", "2026-09-28"]))!;
    assert.deepEqual([beta.version, beta.label], ["26.8", "RC"]);
  });

  it("overlays newer RSS releases on older endoflife.date data", () => {
    const data = { macOS: eol(["26", "26.7.1", "2026-09-28"], ["15", "15.8.1", "2026-09-28"]) };
    const mac = merge(data, items).find((f) => f.name === "macOS")!;
    const c26 = mac.cycles.find((c) => c.cycle === "26")!;
    assert.deepEqual([c26.version, c26.source], ["26.7.2", SRC_RSS]);
  });

  it("marks the three newest as supported", () => {
    const data = { iOS: eol(["27", "27.0", ""], ["26", "26.0", ""], ["18", "18.0", ""], ["17", "17.0", ""]) };
    const flags = merge(data, [])[0].cycles.map((c) => [c.cycle, c.supported]);
    assert.deepEqual(flags, [["27", true], ["26", true], ["18", true], ["17", false]]);
  });

  it("sorts numerically, not lexically", () => {
    const data = { iOS: eol(["9", "9.3", ""], ["18", "18.0", ""], ["10", "10.3", ""]) };
    assert.deepEqual(merge(data, [])[0].cycles.map((c) => c.cycle), ["18", "10", "9"]);
  });

  it("returns no families when there is no data", () => {
    assert.deepEqual(merge({}, []), []);
  });

  it("does not mutate its input", () => {
    const data = { iOS: eol(["27", "27.0", ""]) };
    merge(data, []);
    assert.equal(data.iOS["27"].supported, undefined);
  });
});

describe("per-version pre-releases", () => {
  const EOL = () => ({
    macOS: {
      "27": { cycle: "27", version: "27.0.1", date: "2026-09-28", source: SRC_EOL },
      "26": { cycle: "26", version: "26.7.1", date: "2026-09-28", source: SRC_EOL },
      "15": { cycle: "15", version: "15.8.1", date: "2026-09-28", source: SRC_EOL },
      "14": { cycle: "14", version: "14.8.9", date: "2026-08-06", source: SRC_EOL },
    } as Record<string, Cycle>,
  });
  const mac = (items: ReleaseItem[]) => merge(EOL(), items).find((f) => f.name === "macOS")!;
  const pre = (
    version: string,
    kind: "beta" | "RC",
    preN: string | null,
    build: string,
    source = "AppleDB",
  ): ReleaseItem => ({ os: "macOS", version, pre: kind, preN, build, date: "2026-10-19", source });
  const byCycle = (m: ReturnType<typeof mac>, c: string) => m.cycles.find((x) => x.cycle === c)!;

  it("gives each supported version its own pre-release", () => {
    const m = mac([pre("27.2", "RC", null, "26B118", SRC_RSS), pre("26.7.2", "RC", "3", "25G330"), pre("15.8.2", "RC", "3", "24H230")]);
    assert.deepEqual([byCycle(m, "27").beta!.version, byCycle(m, "27").beta!.label], ["27.2", "RC"]);
    assert.deepEqual([byCycle(m, "26").beta!.version, byCycle(m, "26").beta!.label, byCycle(m, "26").beta!.build], ["26.7.2", "RC 3", "25G330"]);
    assert.deepEqual([byCycle(m, "15").beta!.version, byCycle(m, "15").beta!.label], ["15.8.2", "RC 3"]);
  });

  it("family-level pre-release is the newest overall", () => {
    const m = mac([pre("27.2", "RC", null, "26B118", SRC_RSS), pre("26.7.2", "RC", "3", "25G330")]);
    assert.deepEqual([m.beta!.version, m.beta!.label], ["27.2", "RC"]);
  });

  it("newest of several pre-releases wins per version", () => {
    const m = mac([
      pre("26.7.2", "RC", null, "25G320"), pre("26.7.2", "RC", "3", "25G330"),
      pre("26.7.2", "RC", "2", "25G325"), pre("26.7.2", "beta", "5", "25G299"),
    ]);
    const b = byCycle(m, "26").beta!;
    assert.deepEqual([b.label, b.build], ["RC 3", "25G330"]);
  });

  it("drops a pre-release already superseded by a release", () => {
    assert.equal(byCycle(mac([pre("26.7.1", "RC", "2", "25G313")]), "26").beta, null);
  });

  it("gives unsupported versions no pre-release", () => {
    const c14 = byCycle(mac([pre("14.8.10", "beta", "1", "23J1")]), "14");
    assert.equal(c14.supported, false);
    assert.equal(c14.beta, null);
  });

  it("Apple's feed wins a tie", () => {
    const m = mac([pre("27.2", "RC", null, "26B118", SRC_RSS), pre("27.2", "RC", null, "26B118", "AppleDB")]);
    assert.equal(m.beta!.source, SRC_RSS);
  });

  it("has no pre-releases when there are none", () => {
    const m = mac([]);
    assert.equal(m.beta, null);
    assert.ok(m.cycles.every((c) => c.beta === null));
  });
});

describe("cacheControl", () => {
  const payload = (families: unknown[], sources: Record<string, string>) =>
    ({ families, sources }) as unknown as Payload;

  it("follows the caching policy", () => {
    assert.equal(cacheControl(payload([{}], { a: "ok", b: "ok" })), "s-maxage=3600, stale-while-revalidate=86400");
    assert.ok(cacheControl(payload([{}], { a: "ok", b: "error: TimeoutError" })).startsWith("s-maxage=300"));
    assert.ok(cacheControl(payload([{}], { a: "partial: ios: Error" })).startsWith("s-maxage=300"));
    assert.equal(cacheControl(payload([], { a: "error: x" })), "no-store");
  });
});
