/*
 * Works out whether the visitor's own device is up to date.
 *
 * Everything runs in the browser; nothing about the device is sent anywhere.
 *
 * Browsers hide the OS version on purpose, so detection is limited:
 *   - Chrome / Edge on a Mac expose the real macOS version (Client Hints).
 *   - Safari and Firefox freeze or omit it, so the version stays unknown.
 *   - iPhone / iPad user agents carry an OS version that Safari may freeze,
 *     so it is not trusted: reporting a stale version would produce false
 *     "needs an update" warnings.
 * When the version is unknown, evaluate() returns null and the page shows
 * nothing, rather than guessing or displaying a "can't tell" message.
 * (A native app can read the OS version directly and do this properly.)
 *
 * Ported from assign3's public/device.js.
 */
import type { Beta } from "./versions";

/** The parts of a beta that the messages use. */
type DeviceBeta = Pick<Beta, "version" | "label" | "build">;

export interface DeviceInfo {
  family: string | null;
  version: string | null;
}

export interface DeviceResult {
  kind: "ok" | "warn" | "info";
  message: string;
}

/** The parts of a family that evaluate() reads (a subset of FamilyResult). */
export interface DeviceFamily {
  name: string;
  cycles: { cycle: string; version: string; supported?: boolean; beta?: DeviceBeta | null }[];
  beta?: DeviceBeta | null;
}

interface NavLike {
  userAgent?: string;
  maxTouchPoints?: number;
  userAgentData?: {
    platform: string;
    getHighEntropyValues(hints: string[]): Promise<{ platformVersion?: string }>;
  };
}

function parse(v: string): number[] {
  return String(v)
    .split(".")
    .map((n) => Number(n) || 0);
}

/** Numeric comparison that treats missing parts as zero ("27.2" equals "27.2.0"). */
export function compare(a: string, b: string): -1 | 0 | 1 {
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** "27.2.0" -> "27.2"; keeps at least major.minor. */
export function pretty(v: string): string {
  const p = String(v).split(".");
  while (p.length > 2 && p[p.length - 1] === "0") p.pop();
  return p.join(".");
}

/** Best-effort detection. Resolves to { family, version }; either may be null. */
export async function detect(nav: NavLike): Promise<DeviceInfo> {
  const ua = nav.userAgent || "";
  if (/iPhone|iPod/.test(ua)) return { family: "iOS", version: null };
  // iPads in desktop mode identify as Macs, but have a touch screen.
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1)) {
    return { family: "iPadOS", version: null };
  }
  const uad = nav.userAgentData;
  if (uad && uad.platform === "macOS") {
    try {
      const { platformVersion } = await uad.getHighEntropyValues(["platformVersion"]);
      if (/^\d+(\.\d+)*$/.test(platformVersion || "")) {
        return { family: "macOS", version: platformVersion! };
      }
    } catch {
      /* fall through to unknown */
    }
    return { family: "macOS", version: null };
  }
  if (/Macintosh/.test(ua)) return { family: "macOS", version: null };
  return { family: null, version: null };
}

/**
 * The device is ahead of the newest public release, so it must be on a pre-release.
 * Compare it with the newest beta for the same OS (may be null).
 *
 * Browsers report only the version number (27.2), not the build, so every beta of
 * 27.2 looks the same. We can tell if the device is behind or ahead of the latest
 * beta's version, but when it matches we cannot tell which beta number it has.
 */
function prerelease(name: string, mine: string, version: string, beta: DeviceBeta | null | undefined): DeviceResult {
  if (!beta) {
    return {
      kind: "info",
      message:
        `Your device is running ${name} ${mine}, which is newer than the latest public release. ` +
        `It may be a beta, but there is no current beta information to compare it with.`,
    };
  }
  const latest = `${name} ${pretty(beta.version)} ${beta.label}`;
  const build = beta.build ? `, build ${beta.build}` : "";
  const cmp = compare(version, beta.version);
  // A beta of a newer major version is an opt-in move, not an overdue update.
  if (cmp < 0 && parse(version)[0] < parse(beta.version)[0]) {
    return {
      kind: "info",
      message:
        `Your device is running a pre-release of ${name} ${mine}. A beta of the next major version is ` +
        `also available: ${latest}${build}.`,
    };
  }
  if (cmp < 0) {
    return {
      kind: "warn",
      message:
        `Warning: your device needs an update. It's running a pre-release of ${name} ${mine}, ` +
        `but the latest pre-release is ${latest}${build}.`,
    };
  }
  if (cmp === 0) {
    return {
      kind: "info",
      message:
        `Your device is running ${name} ${mine}, the same version as the latest pre-release (${latest}${build}). ` +
        `Your browser can't tell which build is installed, so check Software Update to confirm ` +
        (beta.build ? `you are on build ${beta.build}.` : `you have the latest.`),
    };
  }
  return {
    kind: "info",
    message:
      `Your device is running ${name} ${mine}, which is newer than the latest beta we know of ` +
      `(${latest}). It may be a newer pre-release.`,
  };
}

/**
 * Decide what to tell the visitor. Returns null when there is nothing
 * reliable to say (unknown device or version).
 */
export function evaluate(
  device: DeviceInfo | null,
  families: DeviceFamily[],
): DeviceResult | null {
  if (!device || !device.family || !device.version) return null;
  const name = device.family;

  const family = families.find((f) => f.name === name);
  if (!family || !family.cycles.length) return null;

  const cycles = family.cycles;
  const newest = cycles[0];
  const mine = pretty(device.version);
  const major = String(parse(device.version)[0]);
  const idx = cycles.findIndex((c) => c.cycle === major);

  if (idx === -1) {
    if (Number(major) > Number(newest.cycle)) return prerelease(name, mine, device.version, family.beta);
    return {
      kind: "warn",
      message:
        `Warning: your device needs an update. ${name} ${major} is no longer supported; ` +
        `the latest is ${name} ${newest.version}.`,
    };
  }

  const line = cycles[idx];
  const cmp = compare(device.version, line.version);

  // Compare with this version's own pre-release (e.g. macOS 26.7.2 RC 3 for a Mac on macOS 26),
  // falling back to the newest pre-release overall.
  if (cmp > 0) return prerelease(name, mine, device.version, line.beta || family.beta);
  if (cmp < 0) {
    const overall = idx > 0 ? ` ${name} ${newest.version} is the newest version overall.` : "";
    return {
      kind: "warn",
      message:
        `Warning: your device needs an update. It's running ${name} ${mine}, but the latest ` +
        `version for that release line is ${line.version}.${overall}`,
    };
  }
  // On the latest build of its release line.
  if (idx === 0) {
    return { kind: "ok", message: `Your device is up to date. It's running ${name} ${mine}, the latest release.` };
  }
  if (line.supported) {
    return {
      kind: "ok",
      message:
        `Your device is up to date for its release line (${name} ${mine}). ` +
        `A newer version, ${name} ${newest.version}, is also available if your device supports it.`,
    };
  }
  return {
    kind: "warn",
    message:
      `Warning: your device needs an update. ${name} ${major} no longer receives updates; ` +
      `the latest version is ${name} ${newest.version}.`,
  };
}
