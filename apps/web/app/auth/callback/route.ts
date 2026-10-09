import { NextResponse } from 'next/server'
import { createClient } from '../../../lib/supabase/server'

// Completes both the email magic-link and the Apple OAuth sign-in — both
// redirect here with a `code` to exchange for a session.
export async function GET(req: Request) {
  const { searchParams, origin } = new URL(req.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`)
}
