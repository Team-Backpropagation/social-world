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
  const [priorityMissionTitles, setPriorityMissionTitles] = useState([])

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

  useEffect(() => {
    if (!profile?.onboarded_at) return

    // REVIEW FIX: 위험도는 공개하지 않고 코호트 맞춤 미션 제목만 받는다.
    supabase
      .from('cohort_feedback')
      .select('priority_missions')
      .maybeSingle()
      .then(({ data }) => setPriorityMissionTitles(data?.priority_missions ?? []))
  }, [profile?.onboarded_at])

  const orderedMissions = [...missions].sort((a, b) => {
    const aRank = priorityMissionTitles.indexOf(a.title)
    const bRank = priorityMissionTitles.indexOf(b.title)
    return (aRank === -1 ? Number.MAX_SAFE_INTEGER : aRank) - (bRank === -1 ? Number.MAX_SAFE_INTEGER : bRank)
  })

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
          작은 활동을 직접 선택해 보세요. 이 실험의 완료 버튼은 본인이 했다고 표시하는 기능이며,
          화면의 포인트는 가상 보상 예시입니다. 실제 지급이나 활동 확인은 진행되지 않습니다.
        </p>

        {loading ? (
          <p>불러오는 중…</p>
        ) : missions.length === 0 ? (
          <p>등록된 미션이 없어요. Supabase에 시드 데이터를 넣어보세요 (database/01_socialworld_base.sql).</p>
        ) : (
          <ul className="mission-list">
            {orderedMissions.map((m) => {
              const p = progress[m.id]
              const status = p?.status
              return (
                <li key={m.id} className="mission-item pixel-panel">
                  <div className="mission-item-main">
                    <div className="mission-title">
                      {m.title}
                      {priorityMissionTitles.includes(m.title) && <span className="badge badge-done">추천</span>}
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
                        완료했다고 표시
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
