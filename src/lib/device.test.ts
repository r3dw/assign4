// Ported from assign3's tests/device.test.js. Run with: npm test
import assert from "node:assert";
import test from "node:test";
import { compare, detect, evaluate as evalOrNull, pretty } from "./device.ts";

// Most tests expect a message; the ones that expect null call evalOrNull directly.
const evaluate = (...args: Parameters<typeof evalOrNull>) => evalOrNull(...args)!;

const cyc = (cycle: string, version: string, supported = true) => ({ cycle, version, supported });
const families = [
  {
    name: "macOS",
    cycles: [cyc("27", "27.0.1"), cyc("26", "26.7.1"), cyc("15", "15.8.1"), cyc("14", "14.8.9", false)],
    beta: { version: "27.2", label: "beta 4", build: "26B5112a", date: "2026-10-13" },
  },
  { name: "iOS", cycles: [cyc("27", "27.0.1")], beta: null },
];
const mac = (version: string) => evaluate({ family: "macOS", version }, families);

test("compare treats missing parts as zero and compares numerically", () => {
  assert.strictEqual(compare("27.2", "27.2.0"), 0);
  assert.strictEqual(compare("26.10", "26.9"), 1);
  assert.strictEqual(compare("15.8", "15.8.1"), -1);
});

test("pretty trims trailing zero parts but keeps major.minor", () => {
  assert.strictEqual(pretty("27.2.0"), "27.2");
  assert.strictEqual(pretty("27.0.0"), "27.0");
  assert.strictEqual(pretty("26.7.1"), "26.7.1");
});

test("latest release is up to date", () => {
  const r = mac("27.0.1");
  assert.strictEqual(r.kind, "ok");
  assert.match(r.message, /^Your device is up to date\./);
});

test("behind within the newest line warns", () => {
  const r = mac("27.0.0");
  assert.strictEqual(r.kind, "warn");
  assert.match(r.message, /needs an update/);
  assert.match(r.message, /27\.0\.1/);
});

test("behind in an older supported line warns and mentions the newest", () => {
  const r = mac("26.5.0");
  assert.strictEqual(r.kind, "warn");
  assert.match(r.message, /26\.7\.1/);
  assert.match(r.message, /27\.0\.1 is the newest/);
});

test("latest of an older supported line is ok with a note about the newer version", () => {
  const r = mac("26.7.1");
  assert.strictEqual(r.kind, "ok");
  assert.match(r.message, /27\.0\.1/);
});

test("latest of an unsupported line warns", () => {
  assert.strictEqual(mac("14.8.9").kind, "warn");
});

test("a major version we don't list warns", () => {
  assert.strictEqual(mac("10.15.7").kind, "warn");
});

test("same version as the latest beta: info, and never claims to be up to date", () => {
  const r = mac("27.2.0"); // a Mac running a 27.2 beta
  assert.strictEqual(r.kind, "info");
  assert.match(r.message, /same version as the latest pre-release \(macOS 27\.2 beta 4, build 26B5112a\)/);
  assert.match(r.message, /can't tell which build is installed/);
  assert.match(r.message, /build 26B5112a\./);
  assert.doesNotMatch(r.message, /up to date/);
});

test("behind the latest beta: warning that names the latest beta", () => {
  const r = mac("27.1.0"); // ahead of public 27.0.1, behind beta 27.2
  assert.strictEqual(r.kind, "warn");
  assert.match(r.message, /needs an update/);
  assert.match(r.message, /latest pre-release is macOS 27\.2 beta 4/);
});

test("ahead of the latest beta is info", () => {
  const r = mac("27.3.0");
  assert.strictEqual(r.kind, "info");
  assert.match(r.message, /newer than the latest beta we know of/);
});

test("a beta of a newer major than the device's is an info note, not a warning", () => {
  const withMajorBeta = [{ ...families[0], beta: { version: "28.0", label: "beta 2", build: "27A1", date: "" } }];
  const r = evaluate({ family: "macOS", version: "27.5" }, withMajorBeta); // a 27.x pre-release
  assert.strictEqual(r.kind, "info");
  assert.match(r.message, /beta of the next major version is also available: macOS 28\.0 beta 2/);
});

test("a device on a newer major than any release is compared with that major's beta", () => {
  const withMajorBeta = [{ ...families[0], beta: { version: "28.0", label: "beta 2", build: "27A1", date: "" } }];
  const same = evaluate({ family: "macOS", version: "28.0" }, withMajorBeta);
  assert.strictEqual(same.kind, "info");
  assert.match(same.message, /same version as the latest pre-release \(macOS 28\.0 beta 2/);
  assert.strictEqual(evaluate({ family: "macOS", version: "28.1" }, withMajorBeta).kind, "info");
});

test("pre-release with no beta data: info that says there is nothing to compare", () => {
  const r = evaluate({ family: "iOS", version: "27.2" }, families); // iOS fixture has beta: null
  assert.strictEqual(r.kind, "info");
  assert.match(r.message, /no current beta information/);
});

test("a major newer than any known, with no beta, is info", () => {
  assert.strictEqual(evaluate({ family: "iOS", version: "28.0" }, families).kind, "info");
});

test("unknown version shows nothing rather than guessing", () => {
  assert.strictEqual(evalOrNull({ family: "macOS", version: null }, families), null);
  assert.strictEqual(evalOrNull({ family: "iOS", version: null }, families), null);
});

test("non-Apple or undetected device shows nothing", () => {
  assert.strictEqual(evalOrNull({ family: null, version: null }, families), null);
  assert.strictEqual(evalOrNull(null, families), null);
});

test("missing family data returns null", () => {
  assert.strictEqual(evalOrNull({ family: "iOS", version: "27.0.1" }, []), null);
});

test("detect: Chromium on Mac uses Client Hints, not the frozen user agent", async () => {
  const nav = {
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/155.0.0.0 Safari/537.36",
    maxTouchPoints: 0,
    userAgentData: { platform: "macOS", getHighEntropyValues: async () => ({ platformVersion: "27.2.0" }) },
  };
  assert.deepStrictEqual(await detect(nav), { family: "macOS", version: "27.2.0" });
});

test("detect: Safari on Mac has no version", async () => {
  const nav = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15", maxTouchPoints: 0 };
  assert.deepStrictEqual(await detect(nav), { family: "macOS", version: null });
});

test("detect: iPhone and iPad versions are not trusted", async () => {
  const phone = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15", maxTouchPoints: 5 };
  assert.deepStrictEqual(await detect(phone), { family: "iOS", version: null });
  const padDesktop = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", maxTouchPoints: 5 };
  assert.deepStrictEqual(await detect(padDesktop), { family: "iPadOS", version: null });
});

test("detect: other platforms", async () => {
  const win = { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/155", maxTouchPoints: 0 };
  assert.deepStrictEqual(await detect(win), { family: null, version: null });
});

test("detect: failing Client Hints falls back to unknown version", async () => {
  const nav = {
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/155",
    maxTouchPoints: 0,
    userAgentData: { platform: "macOS", getHighEntropyValues: async () => { throw new Error("blocked"); } },
  };
  assert.deepStrictEqual(await detect(nav), { family: "macOS", version: null });
});

// --- A device is compared with its own version's pre-release -------------------------------
const withLineBetas = [{
  name: "macOS",
  cycles: [
    { cycle: "27", version: "27.0.1", supported: true, beta: { version: "27.2", label: "RC", build: "26B118", date: "2026-10-19" } },
    { cycle: "26", version: "26.7.1", supported: true, beta: { version: "26.7.2", label: "RC 3", build: "25G330", date: "2026-10-19" } },
    { cycle: "15", version: "15.8.1", supported: true, beta: { version: "15.8.2", label: "RC 3", build: "24H230", date: "2026-10-19" } },
  ],
  beta: { version: "27.2", label: "RC", build: "26B118", date: "2026-10-19" },
}];
const macLine = (version: string) => evaluate({ family: "macOS", version }, withLineBetas);

test("an older line's pre-release is used, not the newest major's", () => {
  const r = macLine("26.7.2"); // a Mac on the macOS 26.7.2 RC
  assert.strictEqual(r.kind, "info");
  assert.match(r.message, /same version as the latest pre-release \(macOS 26\.7\.2 RC 3, build 25G330\)/);
  assert.doesNotMatch(r.message, /27\.2/);
});

test("behind an older line's pre-release is a warning that names it", () => {
  // 26.7.1 is public, so anything between it and 26.7.2 is an earlier pre-release of 26.7.2.
  const r = macLine("26.7.1.5");
  assert.strictEqual(r.kind, "warn");
  assert.match(r.message, /latest pre-release is macOS 26\.7\.2 RC 3, build 25G330/);
});

test("the Sequoia line works the same way", () => {
  assert.match(macLine("15.8.2").message, /macOS 15\.8\.2 RC 3, build 24H230/);
});

test("a version without its own pre-release falls back to the newest overall", () => {
  const noOwn = [{ ...withLineBetas[0], cycles: withLineBetas[0].cycles.map((c) => ({ ...c, beta: null })) }];
  const r = evaluate({ family: "macOS", version: "26.7.5" }, noOwn); // ahead of 26.7.1, no 26.x pre-release
  assert.strictEqual(r.kind, "info");
  assert.match(r.message, /beta of the next major version is also available: macOS 27\.2 RC/);
});
