import { useCallback, useEffect, useRef, useState } from 'react'
import { mockAgentResponse } from './agentAdapter'
import { canStand, inPark, LOCATIONS } from './world'
import { PlazaScene, RoomScene } from './SceneArt'
import { JourneyCards, MiniMap, Modal, PlaceButton, PlaceMarkers, ProgressFlow, useStageSize } from './ShowcaseUI'
import './showcase-v2.css'

const STORAGE_KEY = 'ieum-showcase-exp003-v1'
const START = { scene: 'room', mission: 'idle', evening: false, player: { c: 14, r: 15 }, choice: null, explored: false, rewardSeen: false }

function loadDemo() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null')
    if (!saved || !['room', 'plaza'].includes(saved.scene) || !['idle', 'active', 'done'].includes(saved.mission)) return START
    return { scene: saved.scene, mission: saved.mission, evening: Boolean(saved.evening), player: saved.player && Number.isFinite(saved.player.c) && Number.isFinite(saved.player.r) ? saved.player : START.player, choice: typeof saved.choice === 'string' ? saved.choice : null, explored: Boolean(saved.explored || saved.scene === 'plaza'), rewardSeen: Boolean(saved.rewardSeen) }
  } catch { return START }
}

export default function ShowcaseV2() {
  const [demo, setDemo] = useState(loadDemo)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogResult, setDialogResult] = useState(null)
  const [rewardOpen, setRewardOpen] = useState(false)
  const [selectedPlace, setSelectedPlace] = useState(null)
  const [miniOpen, setMiniOpen] = useState(() => !window.matchMedia('(max-width: 800px)').matches)
  const [direction, setDirection] = useState('down')
  const [step, setStep] = useState(0)
  const [toast, setToast] = useState('')
  const stageRef = useRef(null)
  const stageSize = useStageSize(stageRef)

  useEffect(() => { try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(demo)) } catch { /* file previews can restrict storage */ } }, [demo])
  useEffect(() => { if (!toast) return undefined; const timeout = window.setTimeout(() => setToast(''), 4500); return () => window.clearTimeout(timeout) }, [toast])
  useEffect(() => {
    if (demo.scene !== 'plaza' || demo.mission !== 'active' || !inPark(demo.player.c, demo.player.r)) return
    setDemo((current) => ({ ...current, mission: 'done' }))
    setRewardOpen(true)
    setToast('오늘의 작은 목표를 완료했어요!')
  }, [demo.scene, demo.mission, demo.player.c, demo.player.r])

  const move = useCallback((key) => {
    const moves = { ArrowUp: [-.6, -.6, 'up'], w: [-.6, -.6, 'up'], ArrowDown: [.6, .6, 'down'], s: [.6, .6, 'down'], ArrowLeft: [-.6, .6, 'left'], a: [-.6, .6, 'left'], ArrowRight: [.6, -.6, 'right'], d: [.6, -.6, 'right'] }
    const moveBy = moves[key]
    if (!moveBy) return
    setDirection(moveBy[2]); setStep((value) => value + 1)
    setDemo((current) => {
      if (current.scene !== 'plaza') return current
      const c = Math.round((current.player.c + moveBy[0]) * 10) / 10
      const r = Math.round((current.player.r + moveBy[1]) * 10) / 10
      return canStand(c, r) ? { ...current, player: { c, r } } : current
    })
  }, [])
  useEffect(() => {
    const onKey = (event) => {
      if (demo.scene !== 'plaza' || dialogOpen || rewardOpen || selectedPlace) return
      if (event.target instanceof HTMLElement && ['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd'].includes(key)) { event.preventDefault(); move(key) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [demo.scene, dialogOpen, rewardOpen, selectedPlace, move])

  const closeDialogue = useCallback(() => setDialogOpen(false), [])
  const closeReward = useCallback(() => setRewardOpen(false), [])
  const closePlace = useCallback(() => setSelectedPlace(null), [])
  const startDialogue = () => { setSelectedPlace(null); setDialogResult(null); setDialogOpen(true) }
  const choose = (choice) => {
    const result = mockAgentResponse(choice)
    setDialogResult(result)
    setDemo((current) => ({ ...current, choice, mission: result.mission && current.mission !== 'done' ? 'active' : current.mission }))
  }
  const goPlaza = () => { setDemo((current) => ({ ...current, scene: 'plaza', explored: true })); setDialogOpen(false); setSelectedPlace(null); setToast('동네에 도착했어요. 벚꽃 공원을 찾아가요.') }
  const goRoom = () => { setDemo((current) => ({ ...current, scene: 'room', rewardSeen: current.rewardSeen || current.mission === 'done' })); setSelectedPlace(null); setRewardOpen(false); setToast(demo.mission === 'done' ? '새 화분이 놓인 내 방을 확인해 보세요.' : '내 방에 돌아왔어요.') }
  const reset = () => { setDemo(START); setDialogOpen(false); setDialogResult(null); setRewardOpen(false); setSelectedPlace(null); setToast('처음부터 다시 시작해요.') }
  const onPlace = (place) => { if (place.id === 'home') { goRoom(); return }; setSelectedPlace(place) }
  const selectCard = (index) => {
    if (index === 0) goRoom()
    else if (index === 1) startDialogue()
    else if (index === 2) goPlaza()
    else if (index === 3) { if (demo.mission === 'idle') startDialogue(); else onPlace(LOCATIONS[0]) }
    else if (demo.mission === 'done') goRoom()
    else setToast('공원 산책을 마치면 내 방에 작은 화분이 생겨요.')
  }
  const approachPark = () => { setSelectedPlace(null); setDemo((current) => ({ ...current, scene: 'plaza', explored: true, player: { c: 11, r: 17 } })); setToast('공원 입구에 왔어요. ← 버튼을 두 번 눌러 산책을 마쳐요.') }
  const missionText = demo.mission === 'done' ? '오늘의 산책 완료' : demo.mission === 'active' ? '공원까지 산책하기' : '루미와 작은 목표 고르기'

  return <div className={`sv-app ${demo.evening ? 'evening' : ''}`}>
    <header className="sv-header"><div className="sv-brand"><span className="sv-brand-mark">✳</span><div><strong>이음 마을</strong><small>작은 발걸음이 새로운 연결이 되는 곳</small></div></div><div className="sv-header-actions"><span className="sv-version">PERSONAL SHOWCASE · v0.2</span><button type="button" onClick={() => setDemo((current) => ({ ...current, evening: !current.evening }))} aria-label={demo.evening ? '낮으로 변경' : '저녁으로 변경'}>{demo.evening ? '☾ 저녁' : '☀ 낮'}</button><button type="button" onClick={reset}>처음부터</button></div></header>
    <main><section className="sv-stage" aria-label="이음 마을 장면"><div className="sv-art" ref={stageRef}><PlazaScene player={demo.player} direction={direction} step={step} evening={demo.evening} /><div className="sv-shade" aria-hidden="true" /><div className="sv-heading"><span>나의 속도로 만나는 작은 동네</span><h1>함께, 더 가까이 <b>✿</b></h1><p>작은 발걸음이 새로운 연결이 되는<br />나만의 동네 이야기.</p></div><MiniMap player={demo.player} selectedPlace={selectedPlace} scene={demo.scene} open={miniOpen} onToggle={() => setMiniOpen((value) => !value)} /><PlaceMarkers size={stageSize} onPlace={onPlace} />
      <div className="sv-state"><span>{demo.scene === 'room' ? '01 · MY ROOM' : '02 · TOWN WALK'}</span><strong>{demo.scene === 'room' ? '내 방에서 시작해요' : missionText}</strong><p>{demo.scene === 'room' ? '루미와 이야기하거나 문을 열고 동네로 나가 보세요.' : demo.mission === 'active' ? '공원에 도착하면 작은 화분을 받아요.' : demo.mission === 'done' ? '산책을 마쳤어요. 내 방의 변화를 확인해 보세요.' : '루미에게 오늘 하고 싶은 일을 골라 보세요.'}</p><div>{demo.scene === 'room' ? <><button type="button" onClick={startDialogue}>루미와 대화</button><button type="button" onClick={goPlaza}>동네로 나가기 ↗</button></> : <><button type="button" onClick={demo.mission === 'idle' ? startDialogue : () => onPlace(LOCATIONS[0])}>{demo.mission === 'idle' ? '목표 고르기' : '공원 안내'}</button><button type="button" onClick={goRoom}>내 방으로 ↗</button></>}</div></div>
      {demo.scene === 'room' ? <div className="sv-room-inset"><div><RoomScene evening={demo.evening} reward={demo.mission === 'done'} onDoor={goPlaza} /></div><span>{demo.mission === 'done' ? '새 화분이 놓인 나의 공간' : '루미와 함께하는 나의 공간'}</span></div> : <div className="sv-move"><span>이동 · 방향키 / WASD 또는 버튼</span><div><button type="button" aria-label="위로 이동" onClick={() => move('ArrowUp')}>↑</button><button type="button" aria-label="왼쪽으로 이동" onClick={() => move('ArrowLeft')}>←</button><button type="button" aria-label="아래로 이동" onClick={() => move('ArrowDown')}>↓</button><button type="button" aria-label="오른쪽으로 이동" onClick={() => move('ArrowRight')}>→</button></div></div>}
    </div><div className="sv-stage-bottom"><span>✦ &nbsp;{demo.scene === 'room' ? '현재 위치: 내 방' : `현재 위치: 동네 (${Math.round(demo.player.c)}, ${Math.round(demo.player.r)})`}</span><span>오늘의 목표 · {missionText}</span><span>선택지 대화와 장소 정보는 시연용입니다</span></div></section>
    <section className="sv-mobile-places" aria-labelledby="sv-places-title"><div><h2 id="sv-places-title">동네 장소</h2><span>장소를 눌러 안내를 확인해요</span></div><div>{LOCATIONS.map((place) => <PlaceButton key={place.id} place={place} onClick={onPlace} />)}</div></section>
    <JourneyCards demo={demo} onSelect={selectCard} /><ProgressFlow demo={demo} /></main>
    {toast && <div className="sv-toast" role="status">{toast}</div>}
    {dialogOpen && <Modal titleId="sv-lumi-title" onClose={closeDialogue}><button className="sv-close" type="button" aria-label="대화 닫기" onClick={closeDialogue}>×</button><span className="sv-eyebrow">LUMI · 선택지형 목업 대화</span><h2 id="sv-lumi-title">루미와 이야기</h2><div className="sv-bubble">{dialogResult ? dialogResult.message : '오늘 하루는 어땠어요? 하고 싶은 일이 있다면 편하게 골라 주세요.'}</div>{dialogResult ? <div className="sv-dialog-actions"><button type="button" onClick={() => setDialogResult(null)}>다른 이야기하기</button><button type="button" onClick={dialogResult.mission ? goPlaza : closeDialogue}>{dialogResult.mission ? '동네로 나가기 ↗' : '내 속도로 계속하기'}</button></div> : <div className="sv-options"><button type="button" onClick={() => choose('rest')}>지금은 조금 쉬고 싶어요 <span>↗</span></button><button type="button" onClick={() => choose('walk')}>밖에 조금 나가볼까 해요 <span>↗</span></button><button type="button" onClick={() => choose('talk')}>누군가와 이야기하고 싶어요 <span>↗</span></button></div>}<p className="sv-disclaimer">실시간 상담 또는 AI API 연결이 아닌 시연용 응답입니다.</p></Modal>}
    {rewardOpen && <Modal titleId="sv-reward-title" onClose={closeReward} className="sv-reward-dialog"><span className="sv-reward-icon">🪴</span><span className="sv-eyebrow">LITTLE STEPS, BIG CHANGES</span><h2 id="sv-reward-title">오늘의 작은 목표 완료!</h2><p>벚꽃 공원에 도착했어요. 작은 화분을 획득했습니다.<br />내 방에서 달라진 공간을 확인해 보세요.</p><button type="button" className="sv-dialog-primary" onClick={goRoom}>내 방에서 보상 보기 ↗</button><button type="button" className="sv-dialog-link" onClick={closeReward}>동네 더 둘러보기</button></Modal>}
    {selectedPlace && <Modal titleId="sv-place-title" onClose={closePlace}><button className="sv-close" type="button" aria-label="장소 안내 닫기" onClick={closePlace}>×</button><span className="sv-eyebrow">IEUM TOWN · PLACE GUIDE</span><h2 id="sv-place-title">{selectedPlace.icon} {selectedPlace.name}</h2><p className="sv-place-copy">{selectedPlace.caption}</p><div className="sv-coming-soon">{selectedPlace.id === 'park' ? demo.mission === 'idle' ? '공원 산책을 하려면 먼저 루미와 작은 목표를 골라 주세요.' : demo.mission === 'active' ? '공원 입구로 이동한 뒤 방향 버튼으로 걸어가 보세요.' : '공원 산책을 마쳤어요. 내 방의 화분을 확인해 보세요.' : '장소 소개를 보여주는 시연입니다. 실제 서비스나 신청 기능은 연결되지 않았습니다.'}</div><button type="button" className="sv-dialog-primary" onClick={selectedPlace.id === 'park' ? demo.mission === 'idle' ? startDialogue : demo.mission === 'active' ? approachPark : goRoom : closePlace}>{selectedPlace.id === 'park' ? demo.mission === 'idle' ? '루미와 목표 고르기' : demo.mission === 'active' ? '공원 입구로 이동' : '내 방에서 보상 보기' : '동네로 돌아가기'}</button></Modal>}
  </div>
}
