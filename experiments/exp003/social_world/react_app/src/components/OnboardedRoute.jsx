import { Navigate } from 'react-router-dom'
import { useProfile } from '../lib/useProfile'

// REVIEW FIX: 로그인만 된 사용자가 URL을 직접 입력해 온보딩을 건너뛰지 못하게 한다.
// 코호트 키(지역·연령대·성별)는 집계와 개인화의 전제이므로, 미완료 사용자는 광장에 진입시키지 않는다.
export default function OnboardedRoute({ children }) {
  const { session, profile } = useProfile()

  if (session === undefined || profile === undefined) {
    return (
      <div className="center-screen">
        <p>프로필을 확인하는 중입니다…</p>
      </div>
    )
  }

  if (!profile?.onboarded_at) {
    return <Navigate to="/onboarding" replace />
  }

  return children
}
