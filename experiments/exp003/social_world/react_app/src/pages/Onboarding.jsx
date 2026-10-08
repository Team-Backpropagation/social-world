import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, SGG_CODES, AGE_GROUPS } from '../lib/supabase'

// SW-02 온보딩 — DB_연결_단계별_실행가이드.md 7-6절
// sgg_code·age_group·gender 세 칸이 위험 탐지 에이전트의 코호트 키가 되므로
// 건너뛸 수 없게 막아 둔다 (DB_테이블_정의서.md 4-4절).
export default function Onboarding() {
  const navigate = useNavigate()
  const [nickname, setNickname] = useState('')
  const [sggCode, setSggCode] = useState(SGG_CODES[0].code)
  const [ageGroup, setAgeGroup] = useState('20대')
  const [gender, setGender] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!nickname.trim()) {
      alert('닉네임을 입력해 주세요.')
      return
    }
    setSaving(true)

    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('profiles').upsert({
      id: user.id,
      nickname: nickname.trim(),
      sgg_code: sggCode,
      age_group: ageGroup,
      gender: gender || null,
      onboarded_at: new Date().toISOString(),
    })

    setSaving(false)
    if (error) {
      alert('저장에 실패했습니다. 잠시 후 다시 시도해 주세요.')
      return
    }
    navigate('/plaza', { replace: true })
  }

  return (
    <div className="center-screen">
      <form className="pixel-panel onboarding-card" onSubmit={handleSubmit}>
        <h1>처음이시네요! 👋</h1>
        <p className="login-sub">
          거주 지역 정보는 지역 단위 위험도 산출에 꼭 필요해서 온보딩에서
          한 번만 여쭤봐요.
        </p>

        <label>
          닉네임
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="소셜 월드에서 쓸 이름"
            maxLength={20}
          />
        </label>

        <label>
          거주 시군구
          <select value={sggCode} onChange={(e) => setSggCode(e.target.value)}>
            {SGG_CODES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          연령대
          <select value={ageGroup} onChange={(e) => setAgeGroup(e.target.value)}>
            {AGE_GROUPS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>

        <label>
          성별 (선택)
          <select value={gender} onChange={(e) => setGender(e.target.value)}>
            <option value="">응답하지 않음</option>
            <option value="F">여성</option>
            <option value="M">남성</option>
          </select>
        </label>

        {/* REVIEW FIX: 민감정보 응답을 강제하지 않되, 미응답 시 코호트 개인화가 제한됨을 명확히 고지한다. */}
        <p className="terms">
          성별에 응답하지 않아도 이용할 수 있지만, 현재 시연 데이터는 성별별 코호트만 있어
          개인화 추천이 표시되지 않을 수 있습니다.
        </p>

        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? '저장 중…' : '광장으로 입장하기'}
        </button>
      </form>
    </div>
  )
}
