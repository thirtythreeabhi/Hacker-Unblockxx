import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertSupabaseConfig,
  supabasePublishableKey,
  supabaseUrl,
} from "./config";

let browserClient: SupabaseClient | undefined;

export function createClient() {
  if (browserClient) return browserClient;
  assertSupabaseConfig();
  browserClient = createBrowserClient(supabaseUrl, supabasePublishableKey);
  return browserClient;
}
