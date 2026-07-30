import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from './lib/supabase'

type AuthContextValue = {
  session: Session | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setLoading(false)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const value = useMemo(() => ({
    session,
    loading,
    signOut: async () => {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    },
  }), [loading, session])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// oxlint-disable-next-line react/only-export-components
export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}

export function AuthPanel({ onCancel }: { onCancel: () => void }) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const sendCode = async () => {
    setError('')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('请输入有效邮箱')
      return
    }
    setBusy(true)
    const { error: authError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    })
    setBusy(false)
    if (authError) {
      setError(authError.message)
      return
    }
    setCodeSent(true)
    setNotice('验证码已发送，请检查邮箱。')
  }

  const verifyCode = async () => {
    setError('')
    setBusy(true)
    const { error: authError } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'email',
    })
    setBusy(false)
    if (authError) setError(authError.message)
  }

  return (
    <div className="auth-backdrop">
      <section className="auth-card">
        <span className="brand-mark">W</span>
        <h2>登录胜率数据台</h2>
        <p>登录后即可将对局记录安全同步到云端。</p>
        {!isSupabaseConfigured && <div className="auth-error">尚未配置 Supabase，请先创建 .env.local。</div>}
        <label className="field"><span>邮箱</span><input type="email" value={email} disabled={codeSent} onChange={(event) => setEmail(event.target.value)} /></label>
        {codeSent && <label className="field"><span>邮箱验证码</span><input autoFocus value={code} onChange={(event) => setCode(event.target.value.replace(/\s/g, ''))} /></label>}
        {notice && <div className="auth-notice">{notice}</div>}
        {error && <div className="auth-error">{error}</div>}
        <button className="button primary auth-submit" disabled={busy || !isSupabaseConfigured} onClick={() => void (codeSent ? verifyCode() : sendCode())}>
          {busy ? '处理中…' : codeSent ? '验证并登录' : '发送验证码'}
        </button>
        {codeSent && <button className="button secondary" onClick={() => { setCodeSent(false); setCode(''); setNotice('') }}>修改邮箱</button>}
        <button className="local-link" onClick={onCancel}>继续使用本地模式</button>
      </section>
    </div>
  )
}
