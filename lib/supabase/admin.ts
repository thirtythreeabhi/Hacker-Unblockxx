import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "./config";

export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey)
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required for server-side AI artifact writes.",
    );
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
