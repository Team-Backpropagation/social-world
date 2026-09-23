import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TopBar from '../components/TopBar'
import { supabase } from '../lib/supabase'
import { useProfile } from '../lib/useProfile'

// SW-06 미션방 — missions / mission_progress 테이블 연동
export default function MissionRoom() {
  const navigate = useNavigate()
  const { session, profile } = useProfile()
  const [missions, setMissions] = useState([])
  const [progress, setProgress] = useState({}) // mission_id -> row
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)

  async function load() {
    if (!session) return
    setLoading(true)

    const [{ data: missionRows, error: missionErr }, { data: progressRows, error: progressErr }] =
      await Promise.all([
        supabase.from('missions').select('*').eq('is_active', true).order('id'),
        supabase.from('mission_progress').select('*').eq('user_id', session.user.id),
      ])

    if (!missionErr) setMissions(missionRows ?? [])
    if (!progressErr) {
      const map = {}
      for (const row of progressRows ?? []) map[row.mission_id] = row
      setProgress(map)
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  async function joinMission(missionId) {
    setBusyId(missionId)
    const { error } = await supabase.from('mission_progress').insert({
      user_id: session.user.id,
      mission_id: missionId,
      status: 'in_progress',
    })
    if (error) alert('참여에 실패했습니다.')
    else await load()
    setBusyId(null)
  }

  async function completeMission(missionId) {
    setBusyId(missionId)
    const { error } = await supabase
      .from('mission_progress')
      .update({ status: 'done', completed_at: new Date().toISOString() })
      .eq('user_id', session.user.id)
      .eq('mission_id', missionId)
    if (error) alert('완료 처리에 실패했습니다.')
    else await load()
    setBusyId(null)
  }

  return (
    <div className="screen-with-topbar">
      <TopBar profile={profile} title="미션방" />
      <div className="room-wrap">
        <button className="btn-ghost back-btn" onClick={() => navigate('/plaza')}>
          ← 광장으로
        </button>

        <p className="room-desc">
          꾸준히 사회 활동을 이어갈 수 있도록 작은 미션들을 준비했어요. 완료하면
          포인트를 받을 수 있어요.
        </p>

        {loading ? (
          <p>불러오는 중…</p>
        ) : missions.length === 0 ? (
          <p>등록된 미션이 없어요. Supabase에 시드 데이터를 넣어보세요 (database/01_socialworld_base.sql).</p>
        ) : (
          <ul className="mission-list">
            {missions.map((m) => {
              const p = progress[m.id]
              const status = p?.status
              return (
                <li key={m.id} className="mission-item pixel-panel">
                  <div className="mission-item-main">
                    <div className="mission-title">
                      {m.title}
                      <span className="mission-reward">+{m.reward_point}P</span>
                    </div>
                    {m.description && (
                      <p className="mission-desc">{m.description}</p>
                    )}
                  </div>
                  <div className="mission-actions">
                    {status === 'done' ? (
                      <span className="badge badge-done">완료됨 ✅</span>
                    ) : status === 'in_progress' ? (
                      <button
                        className="btn btn-primary"
                        disabled={busyId === m.id}
                        onClick={() => completeMission(m.id)}
                      >
                        완료하기
                      </button>
                    ) : (
                      <button
                        className="btn btn-option"
                        disabled={busyId === m.id}
                        onClick={() => joinMission(m.id)}
                      >
                        참여하기
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
