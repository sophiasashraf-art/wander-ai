import { NextResponse } from 'next/server'
import { type EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '../../../lib/supabase/server'

// Email magic links verify differently from OAuth: Supabase's email template
// links here with a token_hash (not a `code`), which verifyOtp() exchanges
// for a session server-side. OAuth (Apple) uses /auth/callback + a `code`
// instead — that's a separate flow, see exchangeCodeForSession there.
export async function GET(req: Request) {
  const { searchParams, origin } = new URL(req.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const next = searchParams.get('next') ?? '/'

  if (token_hash && type) {
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({ type, token_hash })
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`)
}
