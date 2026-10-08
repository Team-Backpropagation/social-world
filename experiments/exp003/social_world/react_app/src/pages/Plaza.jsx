import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TopBar from '../components/TopBar'
import NpcDialogModal from '../components/NpcDialogModal'
import PixelCharacter from '../components/PixelCharacter'
import { NPCS } from '../lib/npcScripts'
import { useProfile } from '../lib/useProfile'
import { supabase } from '../lib/supabase'

// SW-03 광장 — "동물의 숲" 스타일 2D 탑다운 마을 맵
// 내부 좌표계는 900x560 기준 %로 관리해 화면 크기에 상관없이 비율이 유지된다.
const NPC_POS = {
  policy: { px: 27, py: 30 },
  job: { px: 50, py: 22 },
  psych: { px: 71, py: 34 },
}

const BUILDINGS = [
  {
    id: 'mission-room',
    label: '미션방',
    emoji: '📮',
    px: 15,
    py: 66,
    route: '/mission-room',
  },
  {
    id: 'club-room',
    label: '동아리방',
    emoji: '🎪',
    px: 82,
    py: 66,
    route: '/club-room',
  },
]

const DECORATIONS = [
  { emoji: '🌳', px: 6, py: 12 },
  { emoji: '🌳', px: 93, py: 14 },
  { emoji: '🌳', px: 6, py: 80 },
  { emoji: '🌳', px: 94, py: 82 },
  { emoji: '🌼', px: 38, py: 55 },
  { emoji: '🌼', px: 60, py: 60 },
  { emoji: '⛲', px: 50, py: 46 },
]

const STEP_X = 3
const STEP_Y = 4.6
const BOUNDS = { minX: 6, maxX: 94, minY: 16, maxY: 88 }
const NEAR_X = 7
const NEAR_Y = 10

export default function Plaza({ preview = false }) {
  const navigate = useNavigate()
  const { profile: savedProfile } = useProfile()
  const profile = preview ? null : savedProfile
  const [pos, setPos] = useState({ px: 49, py: 58 })
  const [direction, setDirection] = useState('down')
  const [step, setStep] = useState(0)
  const [activeNpc, setActiveNpc] = useState(null)
  const [toast, setToast] = useState(null)
  const [feedback, setFeedback] = useState(null)

  useEffect(() => {
    if (preview || !profile?.onboarded_at) return

    // REVIEW FIX: RLS가 현재 사용자의 코호트 행만 반환한다.
    // 시민 화면에는 위험 점수·등급이 아니라 추천 NPC만 사용한다.
    supabase
      .from('cohort_feedback')
      .select('npc_emphasis, priority_missions, updated_at')
      .maybeSingle()
      .then(({ data }) => setFeedback(data ?? null))
  }, [preview, profile?.onboarded_at])

  const targets = useMemo(
    () => [
      ...NPCS.map((npc) => ({
        type: 'npc',
        id: npc.id,
        label: npc.name,
        ...NPC_POS[npc.id],
      })),
      ...BUILDINGS.map((b) => ({ type: 'building', ...b })),
    ],
    []
  )

  const nearTarget = useMemo(
    () =>
      targets.find(
        (t) => Math.abs(t.px - pos.px) < NEAR_X && Math.abs(t.py - pos.py) < NEAR_Y
      ),
    [targets, pos]
  )

  const move = useCallback((dx, dy) => {
    // EXP-001: 움직이는 방향과 두 프레임의 걸음 상태를 함께 바꾼다.
    setDirection(dy < 0 ? 'up' : dy > 0 ? 'down' : dx < 0 ? 'left' : 'right')
    setStep((old) => old + 1)
    setPos((prev) => ({
      px: Math.min(BOUNDS.maxX, Math.max(BOUNDS.minX, prev.px + dx)),
      py: Math.min(BOUNDS.maxY, Math.max(BOUNDS.minY, prev.py + dy)),
    }))
  }, [])

  const interact = useCallback(
    (target) => {
      const t = target ?? nearTarget
      if (!t) return
      if (t.type === 'npc') {
        setActiveNpc(NPCS.find((n) => n.id === t.id))
      } else if (t.type === 'building') {
        if (preview) {
          setToast('미리보기에서는 건물 저장 기능을 사용하지 않아요. 실제 연결은 테스트 Supabase에서 확인해 주세요.')
        } else {
          navigate(t.route)
        }
      }
    },
    [nearTarget, navigate, preview]
  )

  useEffect(() => {
    function onKeyDown(e) {
      if (activeNpc) return
      // 버튼에 초점이 있을 때 Enter가 버튼 클릭과 광장 상호작용을 중복 실행하지 않게 한다.
      if (['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName)) return
      switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          move(0, -STEP_Y)
          break
        case 'ArrowDown':
        case 's':
        case 'S':
          move(0, STEP_Y)
          break
        case 'ArrowLeft':
        case 'a':
        case 'A':
          move(-STEP_X, 0)
          break
        case 'ArrowRight':
        case 'd':
        case 'D':
          move(STEP_X, 0)
          break
        case 'Enter':
        case ' ':
          e.preventDefault()
          interact()
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [move, interact, activeNpc])

  useEffect(() => {
    if (nearTarget) {
      setToast(
        nearTarget.type === 'npc'
          ? `${nearTarget.label} — Enter로 대화하기`
          : `${nearTarget.label} — Enter로 들어가기`
      )
    } else {
      setToast(null)
    }
  }, [nearTarget])

  return (
    <div className="screen-with-topbar">
      <TopBar profile={profile} title="광장" preview={preview} />

      <div className="plaza-wrap">
        <div className="plaza-map">
          {DECORATIONS.map((d, i) => (
            <span
              key={i}
              className="plaza-deco"
              style={{ left: `${d.px}%`, top: `${d.py}%` }}
            >
              {d.emoji}
            </span>
          ))}

          {BUILDINGS.map((b) => (
            <button
              key={b.id}
              className="plaza-sprite plaza-building"
              style={{ left: `${b.px}%`, top: `${b.py}%` }}
              onClick={() => interact({ type: 'building', ...b })}
            >
              <span className="plaza-sprite-icon">{b.emoji}</span>
              <span className="plaza-sprite-label">{b.label}</span>
            </button>
          ))}

          {NPCS.map((npc) => (
            <button
              key={npc.id}
              className="plaza-sprite plaza-npc"
              style={{
                left: `${NPC_POS[npc.id].px}%`,
                top: `${NPC_POS[npc.id].py}%`,
              }}
              onClick={() =>
                interact({ type: 'npc', id: npc.id, label: npc.name, ...NPC_POS[npc.id] })
              }
            >
              <PixelCharacter kind={npc.id} />
              <span className="plaza-sprite-label">{npc.name}</span>
              {feedback?.npc_emphasis === npc.id && (
                <span className="badge badge-done">추천</span>
              )}
            </button>
          ))}

          <div
            className="plaza-player"
            style={{ left: `${pos.px}%`, top: `${pos.py}%` }}
          >
            <PixelCharacter kind="player" direction={direction} step={step} />
            <span className="plaza-player-shadow" />
            {toast && <span className="plaza-toast">{toast}</span>}
          </div>
        </div>

        <p className="plaza-hint">
          캐릭터를 누르거나 아래 바로가기로 시작하세요. 이동: 방향키 / WASD · 상호작용: Enter
        </p>

        {/* EXP-001: 이동 조작 없이 전문 NPC를 고를 수 있다. 추천은 순서를 강제하지 않는다. */}
        <div className="plaza-shortcuts" aria-label="바로가기">
          {NPCS.map((npc) => (
            <button key={npc.id} className="btn btn-option" onClick={() => setActiveNpc(npc)}>
              {npc.name}와 대화
            </button>
          ))}
          {!preview && (
            <button className="btn btn-option" onClick={() => navigate('/mission-room')}>
              미션 보기
            </button>
          )}
        </div>

        <div className="dpad" aria-label="캐릭터 이동">
          <button aria-label="위로 이동" onClick={() => move(0, -STEP_Y)}>▲</button>
          <div className="dpad-row">
            <button aria-label="왼쪽으로 이동" onClick={() => move(-STEP_X, 0)}>◀</button>
            <button aria-label="주변과 상호작용" className="dpad-interact" onClick={() => interact()}>
              ●
            </button>
            <button aria-label="오른쪽으로 이동" onClick={() => move(STEP_X, 0)}>▶</button>
          </div>
          <button aria-label="아래로 이동" onClick={() => move(0, STEP_Y)}>▼</button>
        </div>
      </div>

      {activeNpc && (
        <NpcDialogModal npc={activeNpc} preview={preview} onClose={() => setActiveNpc(null)} />
      )}
      {feedback?.npc_emphasis && (
        <p className="terms plaza-feedback">
          지금은 {NPCS.find((npc) => npc.id === feedback.npc_emphasis)?.name ?? '추천 공간'}부터 둘러보는 것을 추천해요.
        </p>
      )}
    </div>
  )
}
