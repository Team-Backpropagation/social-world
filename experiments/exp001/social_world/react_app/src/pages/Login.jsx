import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// SW-01 로그인 화면 — DB_연결_단계별_실행가이드.md 7-4절
export default function Login() {
  const navigate = useNavigate()
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
      return
    }

    // REVIEW FIX: 익명 로그인은 OAuth 리디렉션이 없으므로 직접 분기 화면으로 보낸다.
    // 기존에는 로그인에 성공해도 /login에 머물 수 있었다.
    navigate('/auth/callback', { replace: true })
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
          닉네임과 거주 지역·연령대·성별을 사용하며, 선택지 대화의 원문 대신
          선택에 붙은 신호와 심각도 수치를 저장합니다. 개인 실험용 테스트 환경에서만 사용하세요.
        </p>
      </div>
    </div>
  )
}
