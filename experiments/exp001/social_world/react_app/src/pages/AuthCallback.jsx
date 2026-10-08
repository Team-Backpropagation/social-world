import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// DB_연결_단계별_실행가이드.md 7-5절 — 로그인 후 온보딩 여부에 따라 분기
export default function AuthCallback() {
  const navigate = useNavigate()

  useEffect(() => {
    async function route() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return navigate('/login', { replace: true })

      const { data: profile } = await supabase
        .from('profiles')
        .select('onboarded_at')
        .eq('id', session.user.id)
        .maybeSingle()

      if (profile?.onboarded_at) navigate('/plaza', { replace: true })
      else navigate('/onboarding', { replace: true })
    }
    route()
  }, [navigate])

  return (
    <div className="center-screen">
      <p>로그인 중입니다…</p>
    </div>
  )
}
