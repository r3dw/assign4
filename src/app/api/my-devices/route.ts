import { auth } from "@clerk/nextjs/server";
import {
  MAX_SAVED_DEVICES,
  isUuid,
  parseDeviceId,
  parseNickname,
  type MyDevice,
} from "@/lib/myDevices";
import { createUserClient } from "@/lib/supabase";

// A signed-in user's saved devices. Every request acts as that user (Clerk's token goes to
// Supabase), so row-level security keeps each person to their own rows; the checks here
// are for a clear error message and sensible limits, not for access control.

const noStore = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: noStore });

async function signedIn() {
  const { userId } = await auth();
  return userId;
}

/** GET: the saved devices, oldest first, with each one's oldest and newest OS. */
export async function GET() {
  if (!(await signedIn())) return json({ error: "Sign in to see your devices" }, 401);

  const { data, error } = await createUserClient().from("my_devices").select("*").order("created_at");
  if (error) return json({ error: "Could not load your devices" }, 502);

  const devices = data as MyDevice[];
  return json({ devices, limit: MAX_SAVED_DEVICES });
}

/** POST { deviceId, nickname? }: save a device. */
export async function POST(request: Request) {
  if (!(await signedIn())) return json({ error: "Sign in to save devices" }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "The request was not valid JSON" }, 400);
  }
  const { deviceId: rawId, nickname: rawNickname } = (body ?? {}) as Record<string, unknown>;
  const deviceId = parseDeviceId(rawId);
  if (deviceId === null) return json({ error: "Choose a device" }, 400);
  const nickname = parseNickname(rawNickname);
  if (nickname === undefined) return json({ error: "The nickname must be 60 characters or fewer, with no control characters" }, 400);

  const db = createUserClient();
  const { count, error: countError } = await db.from("user_devices").select("id", { count: "exact", head: true });
  if (countError) return json({ error: "Could not save the device" }, 502);
  if ((count ?? 0) >= MAX_SAVED_DEVICES) {
    return json({ error: `You can save up to ${MAX_SAVED_DEVICES} devices. Remove one to add another.` }, 409);
  }

  const { data, error } = await db.from("user_devices").insert({ device_id: deviceId, nickname }).select("id").single();
  if (error) {
    // 23503: the device id does not exist.
    return error.code === "23503"
      ? json({ error: "That device is not in the list" }, 404)
      : json({ error: "Could not save the device" }, 502);
  }
  return json({ id: data.id }, 201);
}

/** DELETE ?id=<uuid>: remove one of the user's saved devices. */
export async function DELETE(request: Request) {
  if (!(await signedIn())) return json({ error: "Sign in to manage your devices" }, 401);

  const id = new URL(request.url).searchParams.get("id");
  if (!isUuid(id)) return json({ error: "Missing or invalid id" }, 400);

  const { data, error } = await createUserClient().from("user_devices").delete().eq("id", id).select("id");
  if (error) return json({ error: "Could not remove the device" }, 502);
  if (data.length === 0) return json({ error: "Device not found" }, 404);
  return json({ ok: true });
}
