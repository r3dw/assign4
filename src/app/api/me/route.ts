import { auth } from "@clerk/nextjs/server";
import { createUserClient } from "@/lib/supabase";

/**
 * Connection check for Clerk and Supabase: who is signed in, and can the database see
 * them? A signed-in user gets `deviceRows` (their own saved devices, 0 at first).
 * A signed-out visitor gets signedIn: false. Never returns tokens or keys.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ signedIn: false });

  // A plain select (not a head/count request) so a failure comes back with its reason.
  const { data, error, status } = await createUserClient().from("user_devices").select("id").limit(100);

  return Response.json(
    {
      signedIn: true,
      userId,
      supabase: error ? "error" : "ok",
      status,
      ...(error && { code: error.code, message: error.message, details: error.details, hint: error.hint }),
      deviceRows: error ? null : data.length,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
