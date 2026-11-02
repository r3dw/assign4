// Offline tests for the import code. Run with: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gzipSync } from "node:zlib";
import {
  Aggregator,
  RELEASE_MAJORS,
  buildPlan,
  categoryOf,
  isoDate,
  type DeviceRecord,
} from "./appledb.ts";
import { decodeText, jsonArrayObjects, maybeGunzip } from "./jsonStream.ts";

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

async function* chunked(data: Uint8Array, size: number): AsyncGenerator<Uint8Array> {
  for (let i = 0; i < data.length; i += size) yield data.slice(i, i + size);
}

const ROWS = [
  { osStr: "macOS", version: "26.7.2 RC 3", note: "café {not an object} \"quoted\" \\ back", deviceMap: ["a", "b"] },
  { osStr: "iOS", version: "27.2", nested: { deep: [1, { x: "}" }] }, emoji: "📱" },
  { osStr: "tvOS", version: "18.6" },
];

describe("streaming JSON array reader", () => {
  const bytes = new TextEncoder().encode(JSON.stringify(ROWS));
  const parse = (data: Uint8Array, size: number) =>
    collect(jsonArrayObjects(decodeText(maybeGunzip(chunked(data, size)))));

  it("yields the same objects whatever the chunk size", async () => {
    // Sizes 1 and 7 split objects, escapes, and multi-byte characters across chunks.
    for (const size of [1, 7, 37, 1_000_000]) assert.deepEqual(await parse(bytes, size), ROWS, `size ${size}`);
  });

  it("reads gzip and plain JSON alike", async () => {
    const gz = new Uint8Array(gzipSync(bytes));
    for (const size of [1, 5, 64]) assert.deepEqual(await parse(gz, size), ROWS, `gzip size ${size}`);
  });

  it("throws on input that is not a complete array of objects", async () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    await assert.rejects(parse(enc("{}"), 4));
    await assert.rejects(parse(enc(""), 4));
    await assert.rejects(parse(enc("[1, 2]"), 4));
    await assert.rejects(parse(bytes.slice(0, bytes.length - 20), 16)); // truncated
  });

  it("accepts an empty array", async () => {
    assert.deepEqual(await parse(new TextEncoder().encode("[]"), 1), []);
  });
});

describe("aggregator", () => {
  const build = (o: object) => ({ osStr: "iOS", beta: false, rc: false, ...o });

  it("tracks the first and last release per device and major version", () => {
    const a = new Aggregator();
    a.addBuild(build({ version: "16.0", build: "20A1", released: "2022-09-12", deviceMap: ["iPhone10,1", "iPhone14,2"] }));
    a.addBuild(build({ version: "16.7.16", build: "20H1", released: "2025-01-01", deviceMap: ["iPhone10,1"] }));
    a.addBuild(build({ version: "16.1", build: "20B1", released: "2022-10-24", deviceMap: ["iPhone10,1"] }));
    const m = a.all().find((x) => x.family === "iOS" && x.major === 16)!;
    assert.deepEqual(m.support.get("iPhone10,1"), { first: "16.0", last: "16.7.16" });
    assert.deepEqual(m.support.get("iPhone14,2"), { first: "16.0", last: "16.0" });
    assert.equal(m.released, "2022-09-12");
    assert.equal(m.hasRelease, true);
  });

  it("maps old OS names and ignores unknown software", () => {
    const a = new Aggregator();
    a.addBuild({ osStr: "iPhone OS", version: "3.1.3", build: "7E18", released: "2010-02-02", deviceMap: ["iPhone1,1"] });
    a.addBuild({ osStr: "Mac OS X", version: "10.6.8", build: "10K549", released: "2011-06-23", deviceMap: ["MacBook1,1"] });
    a.addBuild({ osStr: "Safari", version: "18.0", build: "x", deviceMap: [] });
    a.addBuild({ version: "1.0" });
    assert.deepEqual(a.all().map((m) => `${m.family} ${m.major}`).sort(), ["iOS 3", "macOS 10"]);
    assert.equal(a.stats.skipped, 2);
  });

  it("keeps pre-releases whose names parse, and counts all of them for device support", () => {
    const a = new Aggregator();
    const pre = (version: string, extra = {}) =>
      a.addBuild(build({ version, build: version, released: "2026-10-01", beta: true, deviceMap: ["iPhone19,4"], ...extra }));
    pre("28.0 beta 2");
    pre("28.0 RC", { beta: false, rc: true });
    pre("28.0 beta 2 SDK"); // no pre-release row
    pre("28.0 (a)"); // no pre-release row
    const m = a.all().find((x) => x.major === 28)!;
    const rows = [...m.releases.values()].map((r) => `${r.kind}:${r.preN}`).sort();
    assert.deepEqual(rows, ["beta:2", "rc:null"]);
    assert.equal(m.hasRelease, false);
    assert.deepEqual(m.preSupport.get("iPhone19,4"), { first: "28.0", last: "28.0" });
    assert.equal(m.support.size, 0);
  });

  it("adds endoflife.date's latest release when AppleDB lacks it or its date", () => {
    const a = new Aggregator();
    a.addBuild(build({ version: "17.7.3", build: "21H1", released: "", deviceMap: ["iPhone10,1"] }));
    a.addLatest("iOS", "17.7.7", "2025-05-13");
    a.addLatest("iOS", "not a version", null); // ignored
    const m = a.all().find((x) => x.major === 17)!;
    const rows = [...m.releases.values()].map((r) => `${r.version}:${r.released}:${r.source}`).sort();
    assert.deepEqual(rows, ["17.7.3:null:appledb", "17.7.7:2025-05-13:endoflife.date"]);
    assert.equal(m.released, "2025-05-13"); // the dated record sets the major version's release date
  });

  it("keeps the first record when the same release arrives twice (Apple's feed first)", () => {
    const a = new Aggregator();
    a.addRss({ os: "iOS", version: "27.2", pre: null, preN: null, build: "24K1", date: "2026-10-26", source: "Apple Developer RSS" });
    a.addBuild(build({ version: "27.2", build: "24K1", released: "2026-10-27", deviceMap: [] }));
    const m = a.all().find((x) => x.major === 27)!;
    assert.equal(m.releases.size, 1);
    assert.equal([...m.releases.values()][0].source, "apple-rss");
  });
});

describe("plan", () => {
  const devices: DeviceRecord[] = [
    { key: "iPhone10,1", name: "iPhone 8", type: "iPhone", released: ["2017-09-22", "2018-01-01"] },
    { key: "iPhone19,4", name: "iPhone Duo", type: "iPhone", released: "not a date" },
    { key: "Accessory", name: "Some Case", type: "Cases" },
  ];

  function agg() {
    const a = new Aggregator();
    const rel = (major: number, ver: string, map: string[]) =>
      a.addBuild({ osStr: "iOS", version: ver, build: `b${ver}`, released: "2025-01-01", beta: false, rc: false, deviceMap: map });
    rel(15, "15.8", ["iPhone10,1"]);
    rel(16, "16.7", ["iPhone10,1"]);
    rel(17, "17.0", ["iPhone10,1"]);
    rel(18, "18.0", ["iPhone19,4", "Accessory", "Unlisted9,9"]);
    a.addBuild({ osStr: "iOS", version: "19.0 beta 1", build: "x1", released: "2026-06-01", beta: true, rc: false, deviceMap: ["iPhone19,4"] });
    return a;
  }

  it("marks the three newest released majors as supported; a beta-only major is not", () => {
    const plan = buildPlan(agg().all(), devices, {});
    const supported = plan.majors.filter((m) => m.is_supported).map((m) => m.major).sort();
    assert.deepEqual(supported, [16, 17, 18]);
    assert.equal(plan.majors.find((m) => m.major === 19)!.is_supported, false);
  });

  it("takes devices for a beta-only major from its betas", () => {
    const plan = buildPlan(agg().all(), devices, {});
    assert.ok(plan.support.some((s) => s.major === 19 && s.deviceKey === "iPhone19,4"));
  });

  it("imports only known, categorised devices that have support rows", () => {
    const plan = buildPlan(agg().all(), devices, {});
    assert.deepEqual(plan.devices.map((d) => d.appledb_key).sort(), ["iPhone10,1", "iPhone19,4"]);
    assert.deepEqual(plan.unknownDeviceKeys, ["Unlisted9,9"]);
    assert.equal(plan.devices.find((d) => d.appledb_key === "iPhone10,1")!.released, "2017-09-22");
    assert.equal(plan.devices.find((d) => d.appledb_key === "iPhone19,4")!.released, null);
  });

  it("applies endoflife.date details to a major version", () => {
    const plan = buildPlan(agg().all(), devices, {
      iOS: { 18: { released: "2024-09-16", endOfSupport: "2027-09-01", codename: "Test" } },
    });
    const m = plan.majors.find((x) => x.major === 18)!;
    assert.deepEqual([m.released, m.end_of_support, m.codename], ["2024-09-16", "2027-09-01", "Test"]);
  });

  it(`keeps individual releases only for the ${RELEASE_MAJORS} newest majors`, () => {
    const a = new Aggregator();
    for (let major = 1; major <= 12; major++) {
      a.addBuild({ osStr: "iOS", version: `${major}.0`, build: `b${major}`, released: "2020-01-01", deviceMap: ["iPhone10,1"] });
    }
    const plan = buildPlan(a.all(), devices, {});
    assert.equal(plan.majors.length, 12); // every major is kept for device compatibility
    assert.deepEqual([...new Set(plan.releases.map((r) => r.major))].sort((x, y) => x - y), [5, 6, 7, 8, 9, 10, 11, 12]);
  });
});

describe("helpers", () => {
  it("groups product types into dropdown categories", () => {
    assert.equal(categoryOf("iPad Pro"), "iPad");
    assert.equal(categoryOf("MacBook Air"), "Mac");
    assert.equal(categoryOf("Mac mini"), "Mac");
    assert.equal(categoryOf("Apple Watch"), "Apple Watch");
    assert.equal(categoryOf("Headset"), "Apple Vision");
    assert.equal(categoryOf("Cases"), null);
    assert.equal(categoryOf(undefined), null);
  });

  it("accepts only full ISO dates", () => {
    assert.equal(isoDate("2026-10-26"), "2026-10-26");
    assert.equal(isoDate(["2021-09-24", "2022-03-18"]), "2021-09-24");
    assert.equal(isoDate("2026-10"), null);
    assert.equal(isoDate(false), null);
    assert.equal(isoDate(undefined), null);
  });
});
