import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TopBar from '../components/TopBar'
import { supabase } from '../lib/supabase'
import { useProfile } from '../lib/useProfile'

const CATEGORIES = ['문화', '공연', '체육', '스터디', '기타']

// SW-07 동아리방 — clubs / club_members 테이블 연동
export default function ClubRoom() {
  const navigate = useNavigate()
  const { session, profile } = useProfile()
  const [clubs, setClubs] = useState([])
  const [myClubIds, setMyClubIds] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', category: CATEGORIES[0], description: '' })
  const [creating, setCreating] = useState(false)

  async function load() {
    if (!session) return
    setLoading(true)

    const [{ data: clubRows, error: clubErr }, { data: memberRows, error: memberErr }] =
      await Promise.all([
        supabase
          .from('clubs')
          .select('*, member_count:club_members(count)')
          .order('created_at', { ascending: false }),
        supabase.from('club_members').select('club_id').eq('user_id', session.user.id),
      ])

    if (!clubErr) setClubs(clubRows ?? [])
    if (!memberErr) setMyClubIds(new Set((memberRows ?? []).map((r) => r.club_id)))
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  async function joinClub(clubId) {
    setBusyId(clubId)
    const { error } = await supabase
      .from('club_members')
      .insert({ club_id: clubId, user_id: session.user.id })
    if (error) alert('가입에 실패했습니다.')
    else await load()
    setBusyId(null)
  }

  async function createClub(e) {
    e.preventDefault()
    if (!form.name.trim()) {
      alert('동아리 이름을 입력해 주세요.')
      return
    }
    setCreating(true)
    const { data, error } = await supabase
      .from('clubs')
      .insert({
        name: form.name.trim(),
        category: form.category,
        description: form.description.trim() || null,
        owner_id: session.user.id,
      })
      .select()
      .single()

    if (error || !data) {
      alert('동아리 개설에 실패했습니다.')
      setCreating(false)
      return
    }

    // 개설자는 자동으로 첫 멤버가 된다
    await supabase.from('club_members').insert({ club_id: data.id, user_id: session.user.id })

    setCreating(false)
    setShowForm(false)
    setForm({ name: '', category: CATEGORIES[0], description: '' })
    await load()
  }

  return (
    <div className="screen-with-topbar">
      <TopBar profile={profile} title="동아리방" />
      <div className="room-wrap">
        <button className="btn-ghost back-btn" onClick={() => navigate('/plaza')}>
          ← 광장으로
        </button>

        <div className="room-header-row">
          <p className="room-desc">
            관심사가 비슷한 사람들과 문화·공연·체육 활동을 함께 해보세요.
          </p>
          <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? '닫기' : '+ 동아리 개설'}
          </button>
        </div>

        {showForm && (
          <form className="pixel-panel club-form" onSubmit={createClub}>
            <label>
              동아리 이름
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                maxLength={30}
                placeholder="예: 퇴근 후 러닝 크루"
              />
            </label>
            <label>
              카테고리
              <select
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label>
              소개
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                maxLength={200}
                rows={3}
                placeholder="어떤 모임인지 짧게 소개해 주세요"
              />
            </label>
            <button className="btn btn-primary" type="submit" disabled={creating}>
              {creating ? '개설 중…' : '개설하기'}
            </button>
          </form>
        )}

        {loading ? (
          <p>불러오는 중…</p>
        ) : clubs.length === 0 ? (
          <p>아직 개설된 동아리가 없어요. 첫 동아리를 만들어 보세요!</p>
        ) : (
          <ul className="club-list">
            {clubs.map((c) => {
              const joined = myClubIds.has(c.id)
              const memberCount = c.member_count?.[0]?.count ?? 0
              return (
                <li key={c.id} className="club-item pixel-panel">
                  <div className="club-item-main">
                    <div className="mission-title">
                      {c.name}
                      <span className="club-category">{c.category}</span>
                    </div>
                    {c.description && <p className="mission-desc">{c.description}</p>}
                    <p className="club-member-count">멤버 {memberCount}명</p>
                  </div>
                  <div className="mission-actions">
                    {joined ? (
                      <span className="badge badge-done">가입됨 ✅</span>
                    ) : (
                      <button
                        className="btn btn-option"
                        disabled={busyId === c.id}
                        onClick={() => joinClub(c.id)}
                      >
                        가입하기
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
