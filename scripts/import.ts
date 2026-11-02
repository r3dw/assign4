// Run the import by hand.
//   npm run import:dry   download and summarise, write nothing (needs no keys)
//   npm run import       write to Supabase (needs .env.local with the Supabase keys)
import { createClient } from "@supabase/supabase-js";
import { collectPlan, runImport } from "../src/lib/import/run.ts";
import type { Plan } from "../src/lib/import/appledb.ts";

const log = (m: string) => console.log(`[import] ${m}`);

function summarise(plan: Plan) {
  console.log("\nSupported major versions:");
  for (const family of [...new Set(plan.majors.map((m) => m.family))]) {
    const sup = plan.majors.filter((m) => m.family === family && m.is_supported).sort((a, b) => b.major - a.major);
    console.log(`  ${family}: ${sup.map((m) => `${m.major}${m.codename ? ` (${m.codename})` : ""}`).join(", ") || "none"}`);
  }

  const cats: Record<string, number> = {};
  plan.devices.forEach((d) => (cats[d.category] = (cats[d.category] ?? 0) + 1));
  console.log("\nDevices by category:", cats);

  const kinds: Record<string, number> = {};
  plan.releases.forEach((r) => (kinds[r.kind] = (kinds[r.kind] ?? 0) + 1));
  console.log("Releases by kind:", kinds);

  console.log("\nSpot checks (first..last release per family):");
  // Hardware identifiers of devices whose last supported OS is well known.
  const keys = ["iPhone9,1", "iPhone10,1", "iPhone11,8", "iPhone12,1", "iPhone19,4", "iPad6,11", "iPad6,7",
    "Macmini8,1", "MacBookPro11,4", "MacBookAir10,1", "Watch4,1", "AudioAccessory5,1"];
  for (const key of keys) {
    const d = plan.devices.find((x) => x.appledb_key === key);
    if (!d) {
      console.log(`  ${key}: not found`);
      continue;
    }
    const rows = plan.support.filter((s) => s.deviceKey === d.appledb_key);
    const byFamily = new Map<string, typeof rows>();
    rows.forEach((r) => byFamily.set(r.family, [...(byFamily.get(r.family) ?? []), r]));
    const parts = [...byFamily].map(([f, rs]) => {
      rs.sort((a, b) => a.major - b.major);
      return `${f} ${rs[0].first}..${rs[rs.length - 1].last}`;
    });
    console.log(`  ${d.name} [${d.appledb_key}]: ${parts.join("; ")}`);
  }
}

const dry = process.argv.includes("--dry-run");
const started = Date.now();

if (dry) {
  const plan = await collectPlan(log);
  summarise(plan);
  console.log("\nDry run: nothing was written.");
} else {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Run with: npm run import");
    process.exit(1);
  }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  await runImport(db, log);
}
console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
