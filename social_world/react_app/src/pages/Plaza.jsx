import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TopBar from '../components/TopBar'
import NpcDialogModal from '../components/NpcDialogModal'
import { NPCS } from '../lib/npcScripts'
import { useProfile } from '../lib/useProfile'

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

export default function Plaza() {
  const navigate = useNavigate()
  const { profile } = useProfile()
  const [pos, setPos] = useState({ px: 49, py: 58 })
  const [activeNpc, setActiveNpc] = useState(null)
  const [toast, setToast] = useState(null)

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
        navigate(t.route)
      }
    },
    [nearTarget, navigate]
  )

  useEffect(() => {
    function onKeyDown(e) {
      if (activeNpc) return
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
      <TopBar profile={profile} title="광장" />

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
              <span
                className="plaza-sprite-icon plaza-npc-icon"
                style={{ background: npc.color }}
              >
                {npc.emoji}
              </span>
              <span className="plaza-sprite-label">{npc.name}</span>
            </button>
          ))}

          <div
            className="plaza-player"
            style={{ left: `${pos.px}%`, top: `${pos.py}%` }}
          >
            <span className="plaza-player-icon">🧑</span>
            <span className="plaza-player-shadow" />
            {toast && <span className="plaza-toast">{toast}</span>}
          </div>
        </div>

        <p className="plaza-hint">
          이동: 방향키 / WASD &nbsp;·&nbsp; 상호작용: Enter 또는 스페이스바
          &nbsp;·&nbsp; 캐릭터·건물을 클릭해도 됩니다
        </p>

        <div className="dpad" aria-hidden="true">
          <button onClick={() => move(0, -STEP_Y)}>▲</button>
          <div className="dpad-row">
            <button onClick={() => move(-STEP_X, 0)}>◀</button>
            <button className="dpad-interact" onClick={() => interact()}>
              ●
            </button>
            <button onClick={() => move(STEP_X, 0)}>▶</button>
          </div>
          <button onClick={() => move(0, STEP_Y)}>▼</button>
        </div>
      </div>

      {activeNpc && (
        <NpcDialogModal npc={activeNpc} onClose={() => setActiveNpc(null)} />
      )}
    </div>
  )
}
