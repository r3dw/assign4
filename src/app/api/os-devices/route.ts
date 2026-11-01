import type { OsDevice, OsDevices } from "@/lib/osDevices";
import { createPublicClient } from "@/lib/supabase";

/**
 * GET /api/os-devices?family=iOS&major=26
 * The devices that can run one major version of an OS, with the first and last release of
 * that version each one supports. Public data; cached for an hour like /api/versions.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const family = params.get("family") ?? "";
  const majorText = params.get("major") ?? "";
  const major = /^\d+$/.test(majorText) ? Number(majorText) : NaN;
  if (!family || !Number.isInteger(major)) {
    return Response.json({ error: "family and major are required" }, { status: 400 });
  }

  const db = createPublicClient();
  const found = await db
    .from("os_major_versions")
    .select("id, codename, os_families!inner(name)")
    .eq("major", major)
    .eq("os_families.name", family)
    .maybeSingle();
  if (found.error) return Response.json({ error: found.error.message }, { status: 502 });
  if (!found.data) return Response.json({ error: "unknown OS version" }, { status: 404 });

  const support = await db
    .from("device_os_support")
    .select("first_version, last_version, devices!inner(name, category)")
    .eq("major_version_id", found.data.id)
    .limit(2000);
  if (support.error) return Response.json({ error: support.error.message }, { status: 502 });

  const devices: OsDevice[] = (support.data as unknown as {
    first_version: string;
    last_version: string;
    devices: { name: string; category: string };
  }[])
    .map((r) => ({ name: r.devices.name, category: r.devices.category, first: r.first_version, last: r.last_version }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const body: OsDevices = { family, major, codename: found.data.codename, devices };
  return Response.json(body, {
    headers: { "Cache-Control": "s-maxage=3600, stale-while-revalidate=86400" },
  });
}
