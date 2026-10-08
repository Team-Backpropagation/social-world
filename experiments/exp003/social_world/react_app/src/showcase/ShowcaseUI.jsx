import { useEffect, useRef, useState } from 'react'
import { iso, LOCATIONS } from './world'

const CARDS = [
  ['내 방(시작)', '루미와 만나는 나만의 공간', '⌂', 'room'],
  ['AI 상담 Agent', '선택지형 루미 대화 시연', '✿', 'lumi'],
  ['동네 탐험', '발걸음을 옮겨 마을 둘러보기', '◈', 'explore'],
  ['미션 진행', '벚꽃 공원까지 천천히 산책', '✦', 'mission'],
  ['보상 및 성장', '내 방에 작은 화분 놓기', '🪴', 'reward'],
]
const FLOW = ['내 방에서 시작', 'AI와 대화', '작은 미션 수행', '동네 탐험', '지역 활동 참여', '보상 획득', '더 넓은 세계로']

export function useStageSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [ref])
  return size
}

export function Modal({ titleId, children, onClose, className = '' }) {
  const ref = useRef(null)
  useEffect(() => {
    const previous = document.activeElement
    const focusable = () => [...ref.current.querySelectorAll('button:not([disabled]), a[href]')]
    focusable()[0]?.focus()
    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (!items.length) return
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1).focus() }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); previous?.focus?.() }
  }, [onClose])
  return <div className="sv-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section ref={ref} className={`sv-dialog ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>{children}</section></div>
}

export function PlaceButton({ place, onClick, style }) {
  return <button type="button" className="sv-place" style={style} onClick={() => onClick(place)} aria-label={`${place.name}, ${place.caption}`}><span className="sv-place-icon" aria-hidden="true">{place.icon}</span><span><strong>{place.name}</strong><small>{place.caption}</small></span></button>
}

export function PlaceMarkers({ size, onPlace }) {
  const scale = Math.max(size.width / 1600, size.height / 920)
  const offsetX = (size.width - 1600 * scale) / 2
  const offsetY = (size.height - 920 * scale) / 2
  return <div className="sv-markers" aria-label="동네 장소">{LOCATIONS.map((place) => {
    const point = iso(place.c, place.r)
    return <PlaceButton key={place.id} place={place} onClick={onPlace} style={{ left: offsetX + point.x * scale, top: offsetY + (point.y - 50) * scale }} />
  })}</div>
}

export function MiniMap({ player, selectedPlace, scene, open, onToggle }) {
  const dot = (c, r) => ({ x: 50 + (c - r) * 1.67, y: 12 + (c + r) * 1.48 })
  const current = dot(player.c, player.r)
  return <section className={`sv-minimap ${open ? 'open' : ''}`} aria-label="동네 미니맵"><button type="button" className="sv-minimap-title" onClick={onToggle} aria-expanded={open}><span>⌾ &nbsp;미니맵</span><span>{open ? '접기 −' : '열기 +'}</span></button><div className="sv-minimap-body"><svg viewBox="0 0 100 100" role="img" aria-label={`현재 위치: ${scene === 'room' ? '나의 집' : `동네 ${Math.round(player.c)}, ${Math.round(player.r)}`}. ${selectedPlace ? `선택 장소: ${selectedPlace.name}` : ''}`}><rect x="1" y="1" width="98" height="98" rx="9" fill="#c9deb5" /><path d="M4 17Q29 12 39 25T96 21M4 75Q35 68 52 78T96 72" fill="none" stroke="#7aafbd" strokeWidth="11" /><path d="M20 42L82 61M65 15L34 88" fill="none" stroke="#f4dfb4" strokeWidth="9" />{LOCATIONS.map((place) => { const p = dot(place.c, place.r); return <circle key={place.id} cx={p.x} cy={p.y} r={selectedPlace?.id === place.id ? 4.4 : 2.8} fill={place.id === 'park' ? '#598e69' : '#fff8e5'} stroke="#2e5363" strokeWidth="1.2" /> })}{scene === 'plaza' && <g><circle cx={current.x} cy={current.y} r="6" fill="#e47d72" stroke="#fff" strokeWidth="2.5" /><circle cx={current.x} cy={current.y} r="1.8" fill="#fff" /></g>}</svg><span className="sv-minimap-legend">● {scene === 'room' ? '나의 집' : '현재 위치'}{selectedPlace ? ` · ◇ ${selectedPlace.name}` : ''}</span></div></section>
}

function ScenePreview({ art, demo }) {
  const person = <g><circle cx="142" cy="67" r="10" fill="#efbf9e" stroke="#4e5560" strokeWidth="2" /><path d="M132 63q1-15 12-13 10 1 10 13l-8-5-12 7" fill="#3b3b4b" /><path d="M132 80q10-8 20 0v20h-20z" fill="#548c86" stroke="#425963" strokeWidth="2" /></g>
  const tree = (x, y) => <g key={`${x}-${y}`}><path d={`M${x} ${y}v-42`} stroke="#755e4d" strokeWidth="8" /><circle cx={x - 12} cy={y - 43} r="16" fill="#eab8c7" /><circle cx={x + 8} cy={y - 52} r="19" fill="#f2cfda" /><circle cx={x + 19} cy={y - 36} r="14" fill="#e9b2c2" /></g>
  return <svg className="sv-preview-scene" viewBox="0 0 280 110" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    {art === 'room' && <><rect width="280" height="110" fill="#e9cfad" /><path d="M0 70L148 10l132 58-133 64Z" fill="#bd9472" stroke="#5b5d61" strokeWidth="3" /><path d="M0 70V0h150v10Z" fill="#e8d8c2" /><path d="M150 10V0h130v68Z" fill="#f4dec1" /><polygon points="36,62 101,34 149,55 83,82" fill="#f7ecdb" stroke="#82736e" strokeWidth="3" /><polygon points="40,59 80,41 123,59 83,77" fill="#dbe7db" /><polygon points="178,58 226,36 257,50 209,73" fill="#987455" stroke="#6e625b" strokeWidth="3" /><path d="M186 70v23m60-34v26" stroke="#765a48" strokeWidth="6" />{person}<circle cx="165" cy="53" r="14" fill="#fcf3e8" stroke="#8b84a8" strokeWidth="3" /><circle cx="160" cy="53" r="2" fill="#47526b" /><circle cx="170" cy="53" r="2" fill="#47526b" /></>}
    {art === 'lumi' && <><rect width="280" height="110" fill="#bea6b2" /><path d="M0 90L125 35l155 55v20H0Z" fill="#9e867f" /><circle cx="66" cy="56" r="31" fill="#faf4e8" stroke="#817aab" strokeWidth="4" /><circle cx="56" cy="56" r="3" fill="#536176" /><circle cx="76" cy="56" r="3" fill="#536176" /><path d="M61 68q5 5 10 0" fill="none" stroke="#cf8991" strokeWidth="3" /><rect x="111" y="23" width="151" height="58" rx="9" fill="#fffdf5" stroke="#455567" strokeWidth="3" /><text x="123" y="45" fill="#394e5a" fontSize="12" fontWeight="800">오늘은 어땠어요?</text><rect x="122" y="55" width="112" height="7" rx="3" fill="#c8dcd8" /><rect x="122" y="67" width="82" height="5" rx="3" fill="#e8d8cd" /></>}
    {art === 'explore' && <><rect width="280" height="110" fill="#b6d4be" /><polygon points="-10,76 115,24 298,87 171,147" fill="#decba8" stroke="#6a9278" strokeWidth="2" /><path d="M5 79l116-50M61 101l116-50M141 35l115 47" stroke="#c2ac8c" strokeWidth="2" />{tree(54,86)}{tree(228,84)}{person}<path d="M170 38q12-12 24 0" fill="none" stroke="#557f71" strokeWidth="4" strokeDasharray="5 4" /></>}
    {art === 'mission' && <><rect width="280" height="110" fill="#a6c9ad" /><path d="M0 80Q108 44 280 75v35H0Z" fill="#d4bf9d" />{tree(58,78)}<ellipse cx="208" cy="70" rx="42" ry="20" fill="#79b4bb" stroke="#f4e6d5" strokeWidth="7" /><path d="M208 65v-28m-15 31q15-23 15-15m15 15q-15-23-15-15" fill="none" stroke="#e4faf3" strokeWidth="4" />{person}<rect x="9" y="7" width="149" height="24" rx="5" fill="#1f4552" opacity=".92" /><rect x="20" y="17" width="126" height="6" rx="3" fill="#7ab88a" /><rect x="20" y="17" width={demo.mission === 'done' ? '126' : demo.mission === 'active' ? '63' : '5'} height="6" rx="3" fill="#d9f2bb" /></>}
    {art === 'reward' && <><rect width="280" height="110" fill="#efd2b8" /><polygon points="0,73 67,40 139,72 70,108" fill="#b88e6b" stroke="#716465" strokeWidth="2" /><polygon points="141,73 207,40 280,72 210,108" fill="#b88e6b" stroke="#716465" strokeWidth="2" /><path d="M139 10v100" stroke="#fff4e5" strokeWidth="5" strokeDasharray="5 5" /><rect x="46" y="42" width="41" height="26" rx="4" fill="#f5ecdc" /><rect x="183" y="42" width="41" height="26" rx="4" fill="#f5ecdc" /><path d="M230 53l8 12 7-12" fill="none" stroke="#658e69" strokeWidth="4" /><path d="M238 63v16" stroke="#5b8d62" strokeWidth="4" /><path d="M226 72h24l-3 17h-18z" fill="#c88465" stroke="#845b54" strokeWidth="2" /><path d="M103 62l28 0" stroke="#f4f3d1" strokeWidth="5" /><path d="M121 54l10 8-10 8" fill="none" stroke="#f4f3d1" strokeWidth="5" /></>}
  </svg>
}

export function JourneyCards({ demo, onSelect }) {
  const status = [true, Boolean(demo.choice), demo.explored, demo.mission !== 'idle', demo.mission === 'done']
  const actions = ['내 방 보기', '대화 시작', '동네 가기', demo.mission === 'idle' ? '목표 선택' : '미션 보기', demo.mission === 'done' ? '보상 보기' : '보상 안내']
  return <section className="sv-journey" aria-labelledby="sv-journey-title"><div className="sv-section-heading"><div><span className="sv-eyebrow">FIVE SCENES · ONE SMALL STEP</span><h2 id="sv-journey-title">나의 작은 여정</h2></div><span>카드를 눌러 각 장면으로 이동해 보세요</span></div><div className="sv-cards">{CARDS.map(([title, caption, , art], index) => <button type="button" key={title} className={`sv-card ${status[index] ? 'unlocked' : ''}`} onClick={() => onSelect(index)}><span className="sv-card-title"><b>{index + 1}. {title}</b><span>{status[index] ? '●' : '○'}</span></span><span className={`sv-preview sv-preview-${art}`} aria-hidden="true"><ScenePreview art={art} demo={demo} /><span className="sv-preview-chip">{['MY ROOM', 'LUMI · MOCK', 'IEUM TOWN', demo.mission === 'done' ? 'MISSION CLEAR' : 'PARK WALK', demo.mission === 'done' ? 'NEW PLANT' : 'REWARD'][index]}</span></span><span className="sv-card-copy">{caption}</span><span className="sv-card-action">{actions[index]} <span>↗</span></span></button>)}</div></section>
}

export function ProgressFlow({ demo }) {
  const complete = [Boolean(demo.choice || demo.explored), Boolean(demo.choice), demo.mission !== 'idle', demo.explored, demo.mission === 'done', demo.mission === 'done', false]
  const current = complete.findIndex((value) => !value)
  return <nav className="sv-flow" aria-label="시연 진행 단계"><span className="sv-flow-avatar" aria-hidden="true">✿</span><div className="sv-flow-items">{FLOW.map((name, index) => <div key={name} className={`sv-flow-step ${complete[index] ? 'done' : index === current && index < 6 ? 'current' : 'future'}`} aria-current={index === current && index < 6 ? 'step' : undefined}><span className="sv-flow-number">{complete[index] ? '✓' : String(index + 1).padStart(2, '0')}</span><span>{name}</span>{index === 6 && <small>추후 시연</small>}</div>)}</div></nav>
}
