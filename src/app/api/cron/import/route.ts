import { runImport } from "@/lib/import/run";
import { createAdminClient } from "@/lib/supabase";

// Reading about 80 MB from AppleDB takes a few seconds, but allow plenty of headroom.
export const maxDuration = 300;

/**
 * Daily import (see vercel.json). Vercel Cron calls this with
 * `Authorization: Bearer <CRON_SECRET>`; anyone else is refused, since the job writes
 * with the service-role key and downloads a lot of data.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ ok: false, error: "CRON_SECRET is not set" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const log: string[] = [];
  const note = (message: string) => {
    console.log(`[import] ${message}`);
    log.push(message);
  };
  try {
    await runImport(createAdminClient(), note);
    return Response.json({ ok: true, log });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    note(`failed: ${error}`);
    return Response.json({ ok: false, error, log }, { status: 500 });
  }
}
