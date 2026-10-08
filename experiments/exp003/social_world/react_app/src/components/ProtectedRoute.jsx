import { Navigate } from 'react-router-dom'
import { useSession } from '../lib/useSession'

export default function ProtectedRoute({ children }) {
  const session = useSession()

  if (session === undefined) {
    return (
      <div className="center-screen">
        <p>불러오는 중…</p>
      </div>
    )
  }
  if (session === null) {
    return <Navigate to="/login" replace />
  }
  return children
}
