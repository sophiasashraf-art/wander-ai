'use client'

import { useState } from 'react'
import { createClient } from '../../lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState('')

  async function handleEmailSignIn(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setStatus('sending')
    setError('')
    const supabase = createClient()
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })
    if (signInError) {
      setStatus('error')
      setError(signInError.message)
      return
    }
    setStatus('sent')
  }

  async function handleAppleSignIn() {
    const supabase = createClient()
    const { error: appleError } = await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (appleError) {
      setStatus('error')
      setError(appleError.message)
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center px-5 py-16">
      <div className="w-full max-w-sm">
        <h1 className="text-[2.25rem] leading-none font-semibold tracking-tight text-[#0A0A0A] mb-2.5 text-center">
          mapture<span className="text-[#3D5AFE]">.</span>
        </h1>
        <p className="text-[#6B6B6B] text-sm mb-10 text-center">Sign in to plan your trips.</p>

        <div className="bg-white border border-[#E5E5E5] rounded-lg p-6">
          <button
            onClick={handleAppleSignIn}
            className="w-full flex items-center justify-center gap-2 bg-[#0A0A0A] text-white text-sm font-medium py-2.5 rounded-lg hover:bg-[#1A1A1A] transition-colors mb-4"
          >
            Sign in with Apple
          </button>

          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-[#E5E5E5]" />
            <span className="text-xs text-[#A3A3A3]">or</span>
            <div className="flex-1 h-px bg-[#E5E5E5]" />
          </div>

          {status === 'sent' ? (
            <p className="text-sm text-[#0A0A0A] text-center py-2">
              Check <strong>{email}</strong> for a sign-in link.
            </p>
          ) : (
            <form onSubmit={handleEmailSignIn} className="space-y-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full bg-[#FAFAFA] border border-[#E5E5E5] rounded-md px-3 py-2.5 outline-none text-sm text-[#0A0A0A] placeholder:text-[#A3A3A3] focus:border-[#3D5AFE] transition-colors"
              />
              <button
                type="submit"
                disabled={status === 'sending' || !email.trim()}
                className="w-full btn-primary text-sm py-2.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {status === 'sending' ? 'Sending link…' : 'Continue with email'}
              </button>
            </form>
          )}

          {status === 'error' && (
            <p className="text-xs text-[#D14343] mt-3 text-center">{error}</p>
          )}
        </div>
      </div>
    </div>
  )
}
