import { Routes, Route, Navigate } from 'react-router-dom'
import { isSupabaseConfigured } from './lib/supabase'
import SetupNotice from './components/SetupNotice'
import ProtectedRoute from './components/ProtectedRoute'
import OnboardedRoute from './components/OnboardedRoute'
import Login from './pages/Login'
import AuthCallback from './pages/AuthCallback'
import Onboarding from './pages/Onboarding'
import Plaza from './pages/Plaza'
import MissionRoom from './pages/MissionRoom'
import ClubRoom from './pages/ClubRoom'
import Showcase from './showcase/ShowcaseV2'

export default function App() {
  // EXP-003 is a self-contained, no-key showcase. The copied EXP-001 routes
  // remain available for comparison, but the demo starts in My Room.
  if (window.location.protocol === 'file:' || window.location.pathname === '/' || window.location.pathname === '/showcase') {
    return <Showcase />
  }
  // EXP-001: DB 키가 없어도 픽셀 캐릭터와 선택지 대화를 확인할 수 있다.
  // 이 경로는 저장·보상·위기 알림의 통합 완료를 뜻하지 않는다.
  if (window.location.pathname === '/preview') {
    return <Plaza preview />
  }
  if (!isSupabaseConfigured) {
    return <SetupNotice />
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route
        path="/onboarding"
        element={
          <ProtectedRoute>
            <Onboarding />
          </ProtectedRoute>
        }
      />
      <Route
        path="/plaza"
        element={
          <ProtectedRoute>
            <OnboardedRoute>
              <Plaza />
            </OnboardedRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/mission-room"
        element={
          <ProtectedRoute>
            <OnboardedRoute>
              <MissionRoom />
            </OnboardedRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/club-room"
        element={
          <ProtectedRoute>
            <OnboardedRoute>
              <ClubRoom />
            </OnboardedRoute>
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/plaza" replace />} />
    </Routes>
  )
}
