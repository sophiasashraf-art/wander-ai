'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../../lib/supabase/client'

export default function UpdatePasswordPage() {
  const router = useRouter()
  const [checkingSession, setCheckingSession] = useState(true)
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace('/login')
      setCheckingSession(false)
    })
  }, [router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!password) return
    setStatus('working')
    setError('')
    const supabase = createClient()
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) {
      setStatus('error')
      setError(updateError.message)
      return
    }
    setStatus('done')
  }

  if (checkingSession) return null

  return (
    <div className="min-h-full flex items-center justify-center px-5 py-16">
      <div className="w-full max-w-sm">
        <h1 className="text-[2.25rem] leading-none font-semibold tracking-tight text-[#0A0A0A] mb-2.5 text-center">
          mapture<span className="text-[#3D5AFE]">.</span>
        </h1>
        <p className="text-[#6B6B6B] text-sm mb-10 text-center">Set a new password.</p>

        <div className="bg-white border border-[#E5E5E5] rounded-lg p-6">
          {status === 'done' ? (
            <div className="text-center py-2">
              <p className="text-sm text-[#0A0A0A] mb-4">Password updated.</p>
              <button onClick={() => router.push('/')} className="btn-primary text-sm py-2.5 px-5 rounded-lg">
                Continue
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="New password"
                required
                minLength={6}
                autoComplete="new-password"
                className="w-full bg-[#FAFAFA] border border-[#E5E5E5] rounded-md px-3 py-2.5 outline-none text-sm text-[#0A0A0A] placeholder:text-[#A3A3A3] focus:border-[#3D5AFE] transition-colors"
              />
              <button
                type="submit"
                disabled={status === 'working' || !password}
                className="w-full btn-primary text-sm py-2.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {status === 'working' ? 'Saving…' : 'Save password'}
              </button>
              {status === 'error' && <p className="text-xs text-[#D14343] text-center">{error}</p>}
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
