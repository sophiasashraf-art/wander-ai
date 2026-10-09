import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

// Service-role client — bypasses RLS entirely. Only for server-side code that
// has no end-user session to act under but has independently verified who
// it's acting on behalf of (e.g. the iOS Shortcut share-target, which
// authenticates via a per-user share_token instead of a browser session).
// NEVER import this into client-side code or any route that trusts a bare
// header without first resolving a specific user_id from it.
//
// realtime.transport: supabase-js always constructs a RealtimeClient inside
// createClient(), even though this admin client never calls .channel() —
// and that constructor throws synchronously if there's no native WebSocket
// (Node < 22 only). Whatever Node version actually runs this (confirmed via
// a Netlify function's own invoke log: still < 22 even after two attempts to
// configure the platform's Node version, both via netlify.toml NODE_VERSION
// and the dashboard's AWS_LAMBDA_JS_RUNTIME — neither took effect), passing
// the `ws` package directly sidesteps the whole problem at its actual source
// instead of depending on platform configuration we don't have full control
// over confirming.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: { transport: WebSocket as any },
    },
  )
}
