import type { CatalogDevice } from "@/lib/myDevices";
import { createPublicClient } from "@/lib/supabase";

/**
 * GET /api/devices
 * Every device in the dropdown: id, name, category, product type, and release date.
 * Public data, cached for an hour.
 */
export async function GET() {
  const { data, error } = await createPublicClient()
    .from("devices")
    .select("id, name, category, device_type, released")
    .order("name")
    .limit(2000);
  if (error) return Response.json({ error: "Could not load the device list" }, { status: 502 });

  const devices: CatalogDevice[] = data.map((d) => ({
    id: d.id,
    name: d.name,
    category: d.category,
    device_type: d.device_type,
    released: d.released,
  }));
  return Response.json(
    { devices },
    { headers: { "Cache-Control": "s-maxage=3600, stale-while-revalidate=86400" } },
  );
}
