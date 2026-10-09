import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// Service-role client — bypasses RLS entirely. Only for server-side code that
// has no end-user session to act under but has independently verified who
// it's acting on behalf of (e.g. the iOS Shortcut share-target, which
// authenticates via a per-user share_token instead of a browser session).
// NEVER import this into client-side code or any route that trusts a bare
// header without first resolving a specific user_id from it.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}
