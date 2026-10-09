'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../lib/supabase/client'
import MapBackground from '../components/MapBackground'

type Mode = 'signin' | 'signup'
type Status = 'idle' | 'working' | 'error' | 'confirm-email' | 'reset-sent'

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password) return
    setStatus('working')
    setError('')
    const supabase = createClient()

    if (mode === 'signin') {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (signInError) {
        setStatus('error')
        setError(signInError.message)
        return
      }
      router.push('/')
      return
    }

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    })
    if (signUpError) {
      setStatus('error')
      setError(signUpError.message)
      return
    }
    if (data.session) {
      router.push('/')
      return
    }
    setStatus('confirm-email')
  }

  async function handleForgotPassword() {
    if (!email.trim()) {
      setStatus('error')
      setError('Enter your email above first, then click "Forgot password?"')
      return
    }
    setStatus('working')
    setError('')
    const supabase = createClient()
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/update-password`,
    })
    if (resetError) {
      setStatus('error')
      setError(resetError.message)
      return
    }
    setStatus('reset-sent')
  }

  function handleContinueAsGuest() {
    sessionStorage.setItem('mapture_guest', '1')
    router.push('/')
  }

  return (
    <div className="relative min-h-full flex items-center justify-center px-5 py-16 overflow-hidden">
      <MapBackground />
      <div className="relative w-full max-w-sm">
        <h1 className="text-[2.25rem] leading-none font-semibold tracking-tight text-[#0A0A0A] mb-2.5 text-center">
          mapture<span className="text-[#3D5AFE]">.</span>
        </h1>
        <p className="text-[#6B6B6B] text-sm mb-10 text-center">
          {mode === 'signin' ? 'Sign in to plan your trips.' : 'Create an account to save your trips.'}
        </p>

        <div className="bg-white border border-[#E5E5E5] rounded-lg p-6 shadow-[0_8px_24px_rgba(0,0,0,0.07)]">
          {status === 'confirm-email' ? (
            <p className="text-sm text-[#0A0A0A] text-center py-2">
              Check <strong>{email}</strong> for a confirmation link, then come back and sign in.
            </p>
          ) : status === 'reset-sent' ? (
            <p className="text-sm text-[#0A0A0A] text-center py-2">
              Check <strong>{email}</strong> for a link to set a new password.
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
                className="w-full bg-[#FAFAFA] border border-[#E5E5E5] rounded-md px-3 py-2.5 outline-none text-sm text-[#0A0A0A] placeholder:text-[#A3A3A3] focus:border-[#3D5AFE] transition-colors"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                required
                minLength={6}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                className="w-full bg-[#FAFAFA] border border-[#E5E5E5] rounded-md px-3 py-2.5 outline-none text-sm text-[#0A0A0A] placeholder:text-[#A3A3A3] focus:border-[#3D5AFE] transition-colors"
              />
              <button
                type="submit"
                disabled={status === 'working' || !email.trim() || !password}
                className="w-full btn-primary text-sm py-2.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {status === 'working' ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
              </button>
              {mode === 'signin' && (
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  className="w-full text-xs text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors text-center"
                >
                  Forgot password?
                </button>
              )}
            </form>
          )}

          {status === 'error' && (
            <p className="text-xs text-[#D14343] mt-3 text-center">{error}</p>
          )}

          {(status === 'idle' || status === 'working' || status === 'error') && (
            <p className="text-xs text-[#A3A3A3] text-center mt-4">
              {mode === 'signin' ? (
                <>New here?{' '}
                  <button type="button" onClick={() => { setMode('signup'); setStatus('idle'); setError('') }} className="text-[#3D5AFE] hover:text-[#2E45D6] font-medium transition-colors">
                    Create an account
                  </button>
                </>
              ) : (
                <>Already have an account?{' '}
                  <button type="button" onClick={() => { setMode('signin'); setStatus('idle'); setError('') }} className="text-[#3D5AFE] hover:text-[#2E45D6] font-medium transition-colors">
                    Sign in
                  </button>
                </>
              )}
            </p>
          )}

          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-[#E5E5E5]" />
            <span className="text-xs text-[#A3A3A3]">or</span>
            <div className="flex-1 h-px bg-[#E5E5E5]" />
          </div>

          <button
            onClick={handleContinueAsGuest}
            className="w-full text-sm text-[#6B6B6B] hover:text-[#0A0A0A] py-1.5 transition-colors"
          >
            Continue as guest
          </button>
          <p className="text-xs text-[#A3A3A3] text-center mt-1.5">You can look around and build a trip — it just won't be saved.</p>
        </div>
      </div>
    </div>
  )
}
