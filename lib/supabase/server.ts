import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  assertSupabaseConfig,
  supabasePublishableKey,
  supabaseUrl,
} from "./config";

export async function createClient() {
  assertSupabaseConfig();
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server Components cannot always mutate cookies; middleware refreshes sessions.
        }
      },
    },
  });
}
