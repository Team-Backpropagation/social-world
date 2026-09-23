import { Routes, Route, Navigate } from 'react-router-dom'
import { isSupabaseConfigured } from './lib/supabase'
import SetupNotice from './components/SetupNotice'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import AuthCallback from './pages/AuthCallback'
import Onboarding from './pages/Onboarding'
import Plaza from './pages/Plaza'
import MissionRoom from './pages/MissionRoom'
import ClubRoom from './pages/ClubRoom'

export default function App() {
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
            <Plaza />
          </ProtectedRoute>
        }
      />
      <Route
        path="/mission-room"
        element={
          <ProtectedRoute>
            <MissionRoom />
          </ProtectedRoute>
        }
      />
      <Route
        path="/club-room"
        element={
          <ProtectedRoute>
            <ClubRoom />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/plaza" replace />} />
    </Routes>
  )
}
