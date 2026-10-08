import { useCallback, useEffect, useState } from 'react'
import { mockAgentResponse } from './agentAdapter'
import { canStand, inPark } from './world'
import { PlazaScene, RoomScene } from './SceneArt'
import './showcase.css'

const STORAGE_KEY = 'ieum-showcase-exp003-v1'
const START = { scene: 'room', mission: 'idle', evening: false, player: { c: 14, r: 15 }, choice: null }

function loadDemo() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null')
    if (!saved || !['room', 'plaza'].includes(saved.scene) || !['idle', 'active', 'done'].includes(saved.mission)) return START
    return {
      scene: saved.scene,
      mission: saved.mission,
      evening: Boolean(saved.evening),
      player: saved.player && Number.isFinite(saved.player.c) && Number.isFinite(saved.player.r) ? saved.player : START.player,
      choice: typeof saved.choice === 'string' ? saved.choice : null,
    }
  } catch {
    return START
  }
}

function useMobileScene() {
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 720px)').matches)
  useEffect(() => {
    const query = window.matchMedia('(max-width: 720px)')
    const update = () => setMobile(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return mobile
}

function Icon({ name }) {
  const paths = {
    home: <><path d="m3 10 9-7 9 7v10H3z" /><path d="M9 20v-7h6v7" /></>,
    leaf: <><path d="M20 4C9 4 4 8 4 15a5 5 0 0 0 5 5c7 0 11-5 11-16Z" /><path d="M4 20c3-5 7-8 12-10" /></>,
    map: <><path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2z" /><path d="M9 3v16M15 5v16" /></>,
    gift: <><rect x="3" y="10" width="18" height="11" rx="1" /><path d="M2 7h20v4H2zM12 7v14M12 7c-7 0-7-6-3-6 2 0 3 2 3 6Zm0 0c7 0 7-6 3-6-2 0-3 2-3 6Z" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2" /></>,
    moon: <path d="M20 17A8 8 0 0 1 7 4a8 8 0 1 0 13 13Z" />,
    chat: <path d="M4 4h16v12H9l-5 4z" />,
    arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
  }
  return <svg className="showcase-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

export default function Showcase() {
  const [demo, setDemo] = useState(loadDemo)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogResult, setDialogResult] = useState(null)
  const [rewardOpen, setRewardOpen] = useState(false)
  const [selectedPlace, setSelectedPlace] = useState(null)
  const [direction, setDirection] = useState('down')
  const [step, setStep] = useState(0)
  const [toast, setToast] = useState('')
  const mobile = useMobileScene()

  useEffect(() => { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(demo)) }, [demo])
  useEffect(() => {
    if (!toast) return undefined
    const timeout = window.setTimeout(() => setToast(''), 4800)
    return () => window.clearTimeout(timeout)
  }, [toast])

  useEffect(() => {
    if (demo.scene !== 'plaza' || demo.mission !== 'active' || !inPark(demo.player.c, demo.player.r)) return
    setDemo((current) => ({ ...current, mission: 'done' }))
    setRewardOpen(true)
    setToast('오늘의 작은 목표를 완료했어요!')
  }, [demo.scene, demo.mission, demo.player.c, demo.player.r])

  const move = useCallback((key) => {
    const moves = {
      ArrowUp: [-.6, -.6, 'up'], w: [-.6, -.6, 'up'],
      ArrowDown: [.6, .6, 'down'], s: [.6, .6, 'down'],
      ArrowLeft: [-.6, .6, 'left'], a: [-.6, .6, 'left'],
      ArrowRight: [.6, -.6, 'right'], d: [.6, -.6, 'right'],
    }
    const moveBy = moves[key]
    if (!moveBy) return
    setDirection(moveBy[2])
    setStep((value) => value + 1)
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
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd'].includes(key)) {
        event.preventDefault()
        move(key)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [demo.scene, dialogOpen, rewardOpen, selectedPlace, move])

  const startDialogue = () => { setDialogResult(null); setDialogOpen(true) }
  const choose = (choice) => {
    const result = mockAgentResponse(choice)
    setDialogResult(result)
    setDemo((current) => ({ ...current, choice, mission: result.mission ? (current.mission === 'done' ? 'done' : 'active') : current.mission }))
  }
  const goPlaza = () => {
    setDemo((current) => ({ ...current, scene: 'plaza', player: { c: 14, r: 15 } }))
    setDialogOpen(false); setSelectedPlace(null); setToast('동네에 도착했어요. 왼쪽의 벚꽃 공원을 찾아가요.')
  }
  const goRoom = () => {
    setDemo((current) => ({ ...current, scene: 'room' }))
    setSelectedPlace(null); setRewardOpen(false)
    setToast(demo.mission === 'done' ? '루미: 오늘 작은 변화를 만들었네요.' : '내 방에 돌아왔어요.')
  }
  const reset = () => {
    setDemo(START); setDialogOpen(false); setDialogResult(null); setRewardOpen(false); setSelectedPlace(null); setToast('처음부터 다시 시작해요.')
  }
  const onPlace = (place) => {
    if (place.id === 'home') { goRoom(); return }
    setSelectedPlace(place)
  }

  const missionText = demo.mission === 'done' ? '오늘의 작은 목표 완료' : demo.mission === 'active' ? '공원까지 산책하기' : '루미와 이야기해 보세요'
  const sceneName = demo.scene === 'room' ? '내 방' : '커뮤니티 광장'

  return (
    <div className={`showcase-app ${demo.evening ? 'evening' : ''}`}>
      <header className="showcase-header">
        <div className="showcase-brand"><span className="showcase-brand-mark">✳</span><div><strong>이음 마을</strong><small>작은 발걸음이 새로운 연결이 되는 곳</small></div></div>
        <div className="showcase-header-actions"><span className="showcase-version">SHOWCASE MVP <b>0.1</b></span><button className="showcase-icon-button" onClick={() => setDemo((current) => ({ ...current, evening: !current.evening }))} aria-label={demo.evening ? '낮으로 변경' : '저녁으로 변경'} title={demo.evening ? '낮으로 변경' : '저녁으로 변경'}><Icon name={demo.evening ? 'moon' : 'sun'} /><span>{demo.evening ? '저녁' : '낮'}</span></button><button className="showcase-text-button" onClick={reset}>처음부터</button></div>
      </header>

      <main className="showcase-main">
        <section className="showcase-stage" aria-label={sceneName}>
          <div className="showcase-stage-bar"><span><Icon name={demo.scene === 'room' ? 'home' : 'map'} /> {sceneName}</span><span className="stage-chapter">{demo.scene === 'room' ? '01 · 나의 공간' : '02 · 동네에서의 첫걸음'}</span></div>
          <div className="showcase-art">{demo.scene === 'room' ? <RoomScene evening={demo.evening} reward={demo.mission === 'done'} onDoor={goPlaza} /> : <PlazaScene player={demo.player} direction={direction} step={step} evening={demo.evening} missionActive={demo.mission === 'active'} onPlace={onPlace} mobile={mobile} />}</div>
          <div className="showcase-stage-bottom"><span className="stage-caption">{demo.scene === 'room' ? '따뜻한 하루의 시작, 내 방에서 루미를 만나보세요.' : '방향키 / WASD로 이동 · 건물을 누르면 장소 안내'}</span><span className="stage-live"><i /> LIVE PREVIEW</span></div>
        </section>

        <aside className="showcase-sidebar">
          <section className="side-card welcome-card"><span className="eyebrow">WELCOME TO IEUM</span><h1>함께, 더 가까이 <span>✿</span></h1><p>작은 선택 하나에서 시작되는<br />나만의 동네 이야기</p><div className="welcome-lines"><span>오늘의 걸음</span><strong>{demo.mission === 'done' ? '작은 변화 완료' : demo.mission === 'active' ? '공원을 향해 걷는 중' : '나의 속도로 시작'}</strong></div></section>

          <section className="side-card mission-card"><div className="side-card-heading"><span className="side-icon mission-icon"><Icon name="leaf" /></span><div><small>오늘의 작은 목표</small><h2>{missionText}</h2></div></div><p>{demo.mission === 'idle' ? '마음이 내킬 때 루미에게 오늘 하고 싶은 일을 알려주세요.' : demo.mission === 'active' ? '동네의 벚꽃 공원 영역에 도착하면 완료됩니다.' : '공원에 다녀왔어요. 내 방에 새로운 화분이 놓였습니다.'}</p><div className="mission-progress"><div className={demo.mission === 'idle' ? '' : 'filled'} /><div className={demo.mission === 'done' ? 'filled' : ''} /><div className={demo.mission === 'done' ? 'filled' : ''} /></div><div className="mission-reward-row"><span><Icon name="gift" /> 보상</span><strong>{demo.mission === 'done' ? '작은 화분 획득' : '작은 화분'}</strong></div></section>

          <section className="side-card lumi-card"><div className="lumi-card-heading"><div className="lumi-avatar">✿</div><div><small>AI COMPANION</small><h2>루미 <span>함께하는 동반자</span></h2></div></div><p>“{demo.mission === 'done' ? '오늘 작은 변화를 만들었네요. 멋진 걸음이었어요.' : demo.mission === 'active' ? '천천히 걸어도 괜찮아요. 공원에서 만나요.' : '오늘 하루는 어땠어요? 함께 작은 목표부터 시작해볼까요?'}”</p><button className="showcase-primary" onClick={startDialogue}><Icon name="chat" /> 루미와 이야기하기 <Icon name="arrow" /></button></section>

          <section className="side-actions">{demo.scene === 'room' ? <button className="showcase-secondary" onClick={goPlaza}>문을 열고 동네로 나가기 <Icon name="arrow" /></button> : <><div className="move-controls" aria-label="캐릭터 이동"><button aria-label="위로 이동" onClick={() => move('ArrowUp')}>↑</button><div><button aria-label="왼쪽으로 이동" onClick={() => move('ArrowLeft')}>←</button><button aria-label="아래로 이동" onClick={() => move('ArrowDown')}>↓</button><button aria-label="오른쪽으로 이동" onClick={() => move('ArrowRight')}>→</button></div></div><button className="showcase-secondary" onClick={goRoom}>내 방으로 돌아가기 <Icon name="home" /></button></>}</section>
        </aside>
      </main>

      <div className="showcase-journey" aria-label="시연 흐름"><span className="journey-label">MY LITTLE JOURNEY</span><div className={demo.scene === 'room' ? 'journey-step current' : 'journey-step done'}>01 <b>내 방</b></div><span className="journey-arrow">→</span><div className={demo.mission === 'idle' ? 'journey-step' : 'journey-step done'}>02 <b>루미와 대화</b></div><span className="journey-arrow">→</span><div className={demo.mission === 'active' ? 'journey-step current' : demo.mission === 'done' ? 'journey-step done' : 'journey-step'}>03 <b>공원 산책</b></div><span className="journey-arrow">→</span><div className={demo.mission === 'done' ? 'journey-step done' : 'journey-step'}>04 <b>방의 변화</b></div></div>

      {toast && <div className="showcase-toast" role="status">{toast}</div>}

      {dialogOpen && <div className="showcase-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialogOpen(false) }}><section className="showcase-dialog" role="dialog" aria-modal="true" aria-labelledby="lumi-dialog-title"><button className="modal-close" aria-label="대화 닫기" onClick={() => setDialogOpen(false)}>×</button><div className="dialog-top"><div className="lumi-avatar large">✿</div><div><span className="eyebrow">AI COMPANION</span><h2 id="lumi-dialog-title">루미와 이야기</h2></div></div><div className="dialog-bubble">{dialogResult ? dialogResult.message : '오늘 하루는 어땠어요? 하고 싶은 일이 있다면 편하게 골라 주세요.'}</div>{dialogResult ? <div className="dialog-actions"><button className="showcase-secondary" onClick={() => setDialogResult(null)}>다른 이야기하기</button>{dialogResult.mission ? <button className="showcase-primary" onClick={goPlaza}>동네로 나가기 <Icon name="arrow" /></button> : <button className="showcase-primary" onClick={() => setDialogOpen(false)}>내 속도로 계속하기</button>}</div> : <div className="dialog-options"><button onClick={() => choose('rest')}>지금은 조금 쉬고 싶어요 <span>↗</span></button><button onClick={() => choose('walk')}>밖에 조금 나가볼까 해요 <span>↗</span></button><button onClick={() => choose('talk')}>누군가와 이야기하고 싶어요 <span>↗</span></button></div>}<p className="dialog-disclaimer">선택지형 시연 대화입니다. 응답은 저장하거나 분석하지 않습니다.</p></section></div>}

      {rewardOpen && <div className="showcase-modal-backdrop"><section className="showcase-dialog reward-dialog" role="dialog" aria-modal="true" aria-labelledby="reward-title"><div className="reward-illustration">✿<span>🪴</span></div><span className="eyebrow">LITTLE STEPS, BIG CHANGES</span><h2 id="reward-title">오늘의 작은 목표 완료!</h2><p>공원에 도착했어요. 작은 화분을 획득했습니다.<br />내 방에서 달라진 공간을 확인해 보세요.</p><button className="showcase-primary" onClick={goRoom}>내 방에서 보상 보기 <Icon name="arrow" /></button><button className="showcase-text-button" onClick={() => setRewardOpen(false)}>광장 더 둘러보기</button></section></div>}

      {selectedPlace && <div className="showcase-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedPlace(null) }}><section className="showcase-dialog place-dialog" role="dialog" aria-modal="true" aria-labelledby="place-title"><button className="modal-close" aria-label="장소 안내 닫기" onClick={() => setSelectedPlace(null)}>×</button><span className="eyebrow">NEIGHBORHOOD PLACE</span><h2 id="place-title">{selectedPlace.name}</h2><p>{selectedPlace.caption}</p><div className="coming-soon">{selectedPlace.id === 'park' ? '공원 영역까지 직접 걸어가 보세요.' : '이 장소의 자세한 기능은 다음 시연에서 만날 수 있어요.'}</div><button className="showcase-primary" onClick={() => setSelectedPlace(null)}>광장으로 돌아가기</button></section></div>}
    </div>
  )
}
