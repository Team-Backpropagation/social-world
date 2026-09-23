import { useState } from 'react'
import { supabase } from '../lib/supabase'

// SW-01 로그인 화면 — DB_연결_단계별_실행가이드.md 7-4절
export default function Login() {
  const [loading, setLoading] = useState(false)

  async function signInWithKakao() {
    setLoading(true)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'kakao',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) {
      alert('로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.')
      setLoading(false)
    }
  }

  async function signInAsGuest() {
    setLoading(true)
    const { error } = await supabase.auth.signInAnonymously()
    if (error) {
      alert(
        '게스트 로그인을 사용하려면 Supabase 대시보드 → Authentication → ' +
          'Sign In / Providers에서 "Anonymous Sign-Ins"를 켜야 합니다.'
      )
      setLoading(false)
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card pixel-panel">
        <div className="login-logo">🌱</div>
        <h1>소셜 월드</h1>
        <p className="login-sub">함께 있으면, 덜 외로워요.</p>

        <button className="btn btn-kakao" onClick={signInWithKakao} disabled={loading}>
          카카오로 시작하기
        </button>
        <button className="btn btn-guest" onClick={signInAsGuest} disabled={loading}>
          게스트로 둘러보기 (데모)
        </button>

        <p className="terms">
          계속하면 이용약관과 개인정보처리방침에 동의하게 됩니다. 소셜 월드는
          닉네임과 거주 지역·연령대·성별만 수집하며, 대화 원문은 본인만 열람할
          수 있습니다.
        </p>
      </div>
    </div>
  )
}
