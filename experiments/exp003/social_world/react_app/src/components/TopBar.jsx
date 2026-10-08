import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function TopBar({ profile, title, preview = false }) {
  const navigate = useNavigate()

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  return (
    <header className="topbar">
      <div className="topbar-title">
        <span className="topbar-emoji">🌱</span>
        <span>{title}</span>
      </div>
      <div className="topbar-right">
        {profile && <span className="topbar-nick">{profile.nickname}님</span>}
        {preview ? (
          <span className="topbar-nick">저장 없는 미리보기</span>
        ) : (
          <button className="btn-ghost" onClick={handleLogout}>로그아웃</button>
        )}
      </div>
    </header>
  )
}
