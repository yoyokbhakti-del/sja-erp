import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// Tanpa generated types agar fleksibel. Untuk type-safety penuh jalankan:
//   npx supabase gen types typescript --project-id <id> > lib/database.types.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, "public", any>;
let client: Client | undefined;

export function supabaseBrowser(): Client {
  if (!client) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    ) as Client;
  }
  return client;
}
