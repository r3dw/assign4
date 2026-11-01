import "server-only";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL!;

/**
 * Supabase client for public, read-only reference data (OS versions, devices). It uses
 * the anon key and no user token, so it behaves the same for everyone and its results
 * can be cached.
 */
export function createPublicClient() {
  return createClient(url(), process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Supabase client acting as the signed-in user. Clerk's session token is sent with
 * each request, so row-level security sees the user's Clerk id and only returns
 * their own rows. For signed-out visitors it acts as an anonymous user, which can
 * read the public reference tables only.
 */
export function createUserClient() {
  return createClient(url(), process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    accessToken: async () => (await auth()).getToken(),
  });
}

/**
 * Supabase client with the service-role key. It bypasses row-level security, so it is
 * only for trusted server code such as the import job. Never import this into a
 * client component or return its data without checking who is asking.
 */
export function createAdminClient() {
  return createClient(url(), process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
