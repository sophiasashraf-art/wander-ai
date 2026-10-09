import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Server client — for Route Handlers and Server Components. Reads the
// caller's session from cookies so queries run AS that user, which is what
// makes Row Level Security actually apply (the old bare anon-key client had
// no session at all, so RLS would reject everything once enabled).
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {
            // Called from a Server Component, which can't set cookies —
            // fine as long as middleware.ts is refreshing the session.
          }
        },
      },
    },
  )
}
