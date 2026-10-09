import { createBrowserClient } from '@supabase/ssr'

// Browser client — for Client Components. Session lives in cookies (not
// localStorage) so the server client below can read the same session.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
