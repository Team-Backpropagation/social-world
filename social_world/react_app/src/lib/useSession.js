import { useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from './supabase'

// DB_연결_단계별_실행가이드.md 7-7절 — 세션 변화 구독
export function useSession() {
  const [session, setSession] = useState(undefined) // undefined = 로딩 중, null = 비로그인

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setSession(null)
      return
    }

    supabase.auth.getSession().then(({ data }) => setSession(data.session))

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, newSession) => setSession(newSession)
    )
    return () => subscription.unsubscribe()
  }, [])

  return session
}
