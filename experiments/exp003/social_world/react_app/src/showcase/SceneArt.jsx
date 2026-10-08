import { floorKind, iso, LOCATIONS, MAP_SIZE, NPCS } from './world'

const FLOOR = {
  grass: ['#acc895', '#a3bf8d', '#b5cc9b'],
  path: ['#e7d7b6', '#eadcbe', '#e1d1af'],
  plaza: ['#dcc8a8', '#e4d3b5', '#d7c2a3'],
  park: ['#95bc86', '#9ec38c', '#8eb47f'],
}

function pointString(points) {
  return points.map(([x, y]) => `${x},${y}`).join(' ')
}

function FloorTile({ c, r }) {
  const { x, y } = iso(c, r)
  const kind = floorKind(c, r)
  const fill = FLOOR[kind][(c * 7 + r * 11) % 3]
  return (
    <g>
      <polygon points={pointString([[x, y - 16], [x + 32, y], [x, y + 16], [x - 32, y]])} fill={fill} stroke="rgba(78,95,71,.17)" strokeWidth="1" />
      {kind === 'grass' && (c * 17 + r * 7) % 13 === 0 && (
        <g fill="#f8efce" opacity=".8"><circle cx={x - 3} cy={y - 2} r="2" /><circle cx={x + 3} cy={y + 1} r="2" /><circle cx={x} cy={y + 4} r="2" /><circle cx={x} cy={y + 1} r="1.5" fill="#e3a773" /></g>
      )}
      {kind === 'plaza' && (c + r) % 4 === 0 && <path d={`M${x - 11} ${y + 3}l7 3m10-12 5 2`} fill="none" stroke="#c4ad8e" strokeWidth="1.2" opacity=".7" />}
    </g>
  )
}

function Tree({ x, y, blossom = false, size = 1 }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${size})`}>
      <ellipse cy="4" rx="28" ry="11" fill="#416b5a" opacity=".16" />
      <path d="M-7 2 L-5 -62 L5 -69 L9 2Z" fill="#825b44" />
      <path d="M0 -48l-24-21 M1-40l24-22" stroke="#825b44" strokeWidth="8" strokeLinecap="round" />
      <g fill={blossom ? '#D9877A' : '#4E7A3A'}>
        <circle cx="-24" cy="-77" r="23" /><circle cx="3" cy="-91" r="28" /><circle cx="26" cy="-70" r="23" /><circle cx="-3" cy="-62" r="26" />
      </g>
      <g fill={blossom ? '#F0AE9A' : '#78A64E'} opacity=".9"><circle cx="-20" cy="-83" r="15" /><circle cx="11" cy="-95" r="18" /><circle cx="28" cy="-73" r="15" /><circle cx="-5" cy="-63" r="14" /></g>
      <g fill={blossom ? '#FBD9C8' : '#B5D27A'} opacity=".9"><circle cx="-18" cy="-90" r="8" /><circle cx="13" cy="-102" r="9" /><circle cx="31" cy="-75" r="8" /><circle cx="-7" cy="-67" r="8" /></g>
      {blossom && <g fill="#fff1ec"><circle cx="-31" cy="-68" r="3" /><circle cx="-1" cy="-102" r="3" /><circle cx="25" cy="-84" r="3" /></g>}
    </g>
  )
}

function Bush({ x, y, flower = false }) {
  return <g transform={`translate(${x} ${y})`} aria-hidden="true"><ellipse cy="3" rx="26" ry="9" fill="#3c6e4c" opacity=".16" /><circle cx="-13" cy="-12" r="14" fill="#557F3D" /><circle cy="-18" r="17" fill="#83B055" /><circle cx="16" cy="-10" r="13" fill="#BFD886" />{flower && <g fill="#F4A6A0"><circle cx="-11" cy="-23" r="4" /><circle cx="7" cy="-17" r="4" /><circle cx="19" cy="-18" r="3" /></g>}</g>
}

function Building({ place }) {
  const { x, y } = iso(place.c, place.r)
  const w = place.id === 'support' ? 178 : place.id === 'home' ? 144 : 160
  const h = place.id === 'support' ? 118 : place.id === 'job' ? 110 : 94
  const d = 35
  return (
    <g aria-hidden="true">
      <ellipse cx={x} cy={y + 12} rx={w * .65} ry="31" fill="#3b5960" opacity=".16" />
      <polygon points={pointString([[x - w / 2, y - h], [x, y - h + d], [x, y + d], [x - w / 2, y]])} fill={place.color} stroke="#6d6869" strokeWidth="2" />
      <polygon points={pointString([[x, y - h + d], [x + w / 2, y - h], [x + w / 2, y], [x, y + d]])} fill={place.color} stroke="#6d6869" strokeWidth="2" style={{ filter: 'brightness(.87)' }} />
      <polygon points={pointString([[x, y - h - d], [x + w / 2, y - h], [x, y - h + d], [x - w / 2, y - h]])} fill={place.roof} stroke="#514e5c" strokeWidth="3" />
      <path d={`M${x - w / 2} ${y - h}L${x} ${y - h + d}L${x + w / 2} ${y - h}`} fill="none" stroke="#fff2d2" strokeWidth="4" opacity=".55" />
      <polygon points={pointString([[x - w * .37, y - h * .48], [x - w * .17, y - h * .48 + 9], [x - w * .17, y - h * .48 + 32], [x - w * .37, y - h * .48 + 23]])} fill="#ffedc7" stroke="#735f64" strokeWidth="2" />
      <polygon points={pointString([[x + w * .17, y - h * .48 + 8], [x + w * .38, y - h * .48], [x + w * .38, y - h * .48 + 23], [x + w * .17, y - h * .48 + 31]])} fill="#ffe6aa" stroke="#735f64" strokeWidth="2" />
      <polygon points={pointString([[x + 12, y - 38], [x + 35, y - 47], [x + 35, y + 8], [x + 12, y + 16]])} fill="#4d5b65" stroke="#69515a" strokeWidth="2" />
      <circle cx={x + 29} cy={y - 16} r="2" fill="#f5d89d" />
      <polygon points={pointString([[x - w / 2 - 4, y - h * .38], [x, y - h * .38 + d + 2], [x + w / 2 + 4, y - h * .38]])} fill="#fff0d7" opacity=".93" />
      <path d={`M${x - w / 2 - 4} ${y - h * .38}L${x} ${y - h * .38 + d + 2}L${x + w / 2 + 4} ${y - h * .38}`} fill="none" stroke={place.roof} strokeWidth="7" />
      {place.id === 'cafe' && <g>
        <path d={`M${x - w / 2 - 3} ${y - h * .38 + 3}L${x - 2} ${y - h * .38 + d + 4}`} stroke="#B56C5A" strokeWidth="15" strokeDasharray="15 12" />
        <path d={`M${x - w / 2 - 3} ${y - h * .38 + 3}L${x - 2} ${y - h * .38 + d + 4}`} stroke="#FBF3E4" strokeWidth="4" opacity=".9" />
        <ellipse cx={x - 101} cy={y + 23} rx="34" ry="12" fill="#3d5760" opacity=".2" />
        <path d={`M${x - 101} ${y + 19}v-31`} stroke="#68564e" strokeWidth="5" /><ellipse cx={x - 101} cy={y - 13} rx="31" ry="11" fill="#FFFDF7" stroke="#8a7367" strokeWidth="3" />
        <path d={`M${x - 110} ${y - 13}v-8h14v8m-14-5h14`} stroke="#B56C5A" strokeWidth="3" fill="none" />
      </g>}
      {place.id === 'support' && <g>
        <path d={`M${x + 44} ${y - h * .56}v${h * .55}m19-${h * .65}v${h * .53}`} fill="none" stroke="#FFFDF5" strokeWidth="7" />
        <path d={`M${x + 37} ${y - h * .58}l34-17m-34 ${h * .59}l34-16`} stroke="#DCCDB2" strokeWidth="5" />
      </g>}
      {place.id === 'counsel' && <g transform={`translate(${x - 38} ${y - h * .69})`}><path d="M0 7C-13-8-30 7 0 26 30 7 13-8 0 7Z" fill="#f9d5d2" stroke="#8d667d" strokeWidth="3" /></g>}
      {place.id === 'job' && <g transform={`translate(${x - 39} ${y - h * .7})`}><rect x="-17" y="-3" width="37" height="25" rx="4" fill="#f5e5c9" stroke="#425b69" strokeWidth="3" /><path d="M-8-3v-7h19v7M-17 8h37" fill="none" stroke="#425b69" strokeWidth="3" /></g>}
      {place.id === 'convenience' && <g><path d={`M${x - w / 2 - 2} ${y - h * .38 + 4}L${x - 1} ${y - h * .38 + d + 6}`} stroke="#4f8d9d" strokeWidth="16" strokeDasharray="13 10" /><path d={`M${x - w / 2 - 2} ${y - h * .38 + 4}L${x - 1} ${y - h * .38 + d + 6}`} stroke="#fff5e0" strokeWidth="4" /><rect x={x - 51} y={y - h - 8} width="37" height="22" rx="4" fill="#f7f1df" stroke="#557f9a" strokeWidth="3" /><path d={`M${x - 45} ${y - h + 3}h24`} stroke="#557f9a" strokeWidth="4" /></g>}
      {place.id === 'home' && <g><path d={`M${x - 10} ${y - h - 46}l10-10 10 10v15h-20z`} fill="#C98B5B" stroke="#724f4d" strokeWidth="2" /><ellipse cx={x - 73} cy={y + 12} rx="27" ry="10" fill="#78975d" /><circle cx={x - 79} cy={y + 6} r="5" fill="#F4A6A0" /><circle cx={x - 64} cy={y + 8} r="4" fill="#F6D06A" /></g>}
      {place.id === 'volunteer' && <g transform={`translate(${x - 36} ${y - h * .72})`}><circle r="18" fill="#fff6e8" stroke="#956f6e" strokeWidth="3" /><g fill="#e9a7a6"><circle cx="0" cy="-8" r="5" /><circle cx="8" cy="0" r="5" /><circle cx="0" cy="8" r="5" /><circle cx="-8" cy="0" r="5" /></g><circle r="4" fill="#e7bd68" /></g>}
    </g>
  )
}

function Fountain({ x, y }) {
  return (
    <g className="fountain">
      <ellipse cx={x} cy={y + 12} rx="86" ry="42" fill="#486a6c" opacity=".25" />
      <ellipse cx={x} cy={y + 6} rx="81" ry="39" fill="#eee5cb" stroke="#8b948a" strokeWidth="6" />
      <ellipse cx={x} cy={y + 4} rx="68" ry="29" fill="#74b2b9" stroke="#4c8d9d" strokeWidth="3" />
      <ellipse className="fountain-ripple ripple-a" cx={x} cy={y + 3} rx="26" ry="9" fill="none" stroke="#dbfcf4" strokeWidth="3" />
      <ellipse className="fountain-ripple ripple-b" cx={x} cy={y + 3} rx="43" ry="17" fill="none" stroke="#c3eaf0" strokeWidth="2" />
      <path d={`M${x} ${y + 1}v-63m-35 68Q${x - 24} ${y - 58} ${x} ${y - 36}m35 43Q${x + 24} ${y - 59} ${x} ${y - 37}`} fill="none" stroke="#d7f7f5" strokeWidth="6" strokeLinecap="round" className="fountain-water" />
      <ellipse cx={x} cy={y - 62} rx="8" ry="5" fill="#e8ffff" />
    </g>
  )
}

function Bench({ x, y }) {
  return <g transform={`translate(${x} ${y})`}><ellipse cy="4" rx="36" ry="11" fill="#537059" opacity=".2" /><polygon points="-30,-24 9,-8 25,-16 -14,-32" fill="#9f704f" stroke="#694d43" strokeWidth="2" /><polygon points="-28,-15 10,1 25,-7 -14,-23" fill="#b98a60" stroke="#694d43" strokeWidth="2" /><path d="M-18-8v18M14-5v16" stroke="#4d6064" strokeWidth="5" /></g>
}

function Streetlight({ x, y }) {
  return <g transform={`translate(${x} ${y})`}><ellipse cy="2" rx="15" ry="5" fill="#455c5c" opacity=".2" /><path d="M0 0V-77q0-13 16-13" fill="none" stroke="#536e6c" strokeWidth="6" /><path d="M9-93h20l-4 20H13z" fill="#ead19b" stroke="#536e6c" strokeWidth="3" /><circle cx="19" cy="-80" r="7" fill="#fff5c9" opacity=".8" /></g>
}

function Flowerbed({ x, y }) {
  return <g transform={`translate(${x} ${y})`}><ellipse cy="1" rx="33" ry="12" fill="#68896c" opacity=".2" /><polygon points="-32,-2 3,-17 34,-3 0,12" fill="#ae8766" stroke="#7a795e" strokeWidth="3" /><polygon points="-25,-4 3,-15 27,-4 0,7" fill="#547d57" />{[[-15,-4],[-2,-8],[13,-4],[-7,2],[10,2]].map(([cx,cy], i) => <g key={i}><circle cx={cx} cy={cy} r="5" fill={i % 2 ? '#f3c6c8' : '#f7e4ab'} /><circle cx={cx} cy={cy} r="2" fill="#dd9f6c" /></g>)}</g>
}

function VillageProps({ x, y, type }) {
  if (type === 'cat') return <g transform={`translate(${x} ${y})`}><ellipse cx="4" cy="0" rx="21" ry="8" fill="#497468" opacity=".18" /><path d="M-13-12Q-19-32-12-36L-4-28Q4-32 13-26L20-35Q27-25 19-12Z" fill="#c78b6d" stroke="#806452" strokeWidth="3" /><ellipse cx="3" cy="-9" rx="21" ry="13" fill="#ca8f70" /><path d="M22-11q18-6 13-25" fill="none" stroke="#a87560" strokeWidth="6" strokeLinecap="round" /><circle cx="-7" cy="-17" r="2" fill="#413d42" /><circle cx="10" cy="-17" r="2" fill="#413d42" /><path d="M-1-10q4 3 7 0" fill="none" stroke="#80544c" strokeWidth="2" /></g>
  if (type === 'bike') return <g transform={`translate(${x} ${y})`} stroke="#4d6a72" strokeWidth="4" fill="none"><ellipse cx="-20" cy="-3" rx="14" ry="9" /><ellipse cx="28" cy="-1" rx="14" ry="9" /><path d="M-20-3l20-22 28 24H-20l18-28h18m-24 0h20m16 28 2-34 13-3" /><path d="M-6-30h-13" stroke="#a9685d" strokeWidth="5" /></g>
  return <g transform={`translate(${x} ${y})`}><path d="M0 5v-62" stroke="#795d49" strokeWidth="8" /><rect x="-43" y="-83" width="86" height="43" rx="5" fill="#fff6e3" stroke="#7f765e" strokeWidth="4" /><text y="-55" textAnchor="middle" fontSize="15" fontWeight="800" fill="#456f66">마을 안내</text><path d="M-23-25h49" stroke="#6a9279" strokeWidth="5" /></g>
}

export function CharacterArt({ x, y, direction = 'down', step = 0, shirt = '#538a81', hair = '#3b3540', scale = 1, scarf = false }) {
  const back = direction === 'up'
  const side = direction === 'left' || direction === 'right'
  const offset = [0, 3, 1, -3][step % 4]
  const armSwing = [0, -2, 1, 2][step % 4]
  return (
    <g transform={`translate(${x - 32 * scale} ${y - 91 * scale}) scale(${scale})`} className="character-art">
      <ellipse cx="32" cy="91" rx="23" ry="7" fill="#314e4d" opacity=".2" />
      <rect x="18" y="66" width="12" height="23" rx="3" fill="#364f65" /><rect x="35" y="66" width="12" height="23" rx="3" fill="#364f65" />
      <rect x="17" y={83 + offset} width="15" height="7" rx="2" fill="#473e44" /><rect x="34" y={83 - offset} width="15" height="7" rx="2" fill="#473e44" />
      <rect x="11" y="47" width="42" height="26" rx="8" fill="#324f56" /><rect x="14" y="48" width="36" height="23" rx="6" fill={shirt} />
      <rect x="7" y={51 + armSwing} width="8" height="19" rx="4" fill="#e5ae88" /><rect x="49" y={51 - armSwing} width="8" height="19" rx="4" fill="#e5ae88" />
      {scarf && <path d="M21 48h22l-5 7-8-2-6 9-4-3 5-10z" fill="#d86f62" />}
      <rect x="9" y="7" width="46" height="47" rx="18" fill={hair} /><rect x="14" y="18" width="36" height="34" rx="16" fill={back ? hair : '#efc39c'} />
      <path d="M12 26Q12 8 32 7Q53 7 53 27L46 23Q33 20 25 24L15 34Z" fill={hair} />
      {!back && <g fill="#352f3d">{side ? <circle cx={direction === 'left' ? 22 : 41} cy="38" r="2.4" /> : <><circle cx="24" cy="38" r="2.5" /><circle cx="40" cy="38" r="2.5" /></>}</g>}
      {!back && !side && <path d="M29 45q3 3 6 0" fill="none" stroke="#ad6f68" strokeWidth="2" strokeLinecap="round" />}
      <circle cx="18" cy="37" r="3" fill="#e7a891" opacity=".7" /><circle cx="46" cy="37" r="3" fill="#e7a891" opacity=".7" />
    </g>
  )
}

export function LumiArt({ x, y, scale = 1 }) {
  return (
    <g className="lumi-floating" transform={`translate(${x - 26 * scale} ${y - 74 * scale}) scale(${scale})`}>
      <ellipse cx="26" cy="78" rx="22" ry="7" fill="#5c7492" opacity=".2" />
      <path d="M10 33Q0 37 5 52L13 50M42 33Q53 38 47 52L39 50" fill="#e8f3e7" stroke="#918bb3" strokeWidth="3" />
      <path d="M12 51Q12 34 26 32Q40 34 40 51L37 63Q26 72 15 62Z" fill="#eee9f2" stroke="#8779a7" strokeWidth="3" />
      <circle cx="26" cy="27" r="24" fill="#faf5ed" stroke="#897dae" strokeWidth="3" />
      <path d="M12 14Q24 2 39 13" fill="none" stroke="#b9a5c6" strokeWidth="4" strokeLinecap="round" />
      <circle cx="18" cy="29" r="3" fill="#3d4c62" /><circle cx="34" cy="29" r="3" fill="#3d4c62" />
      <path d="M23 36q3 4 6 0" fill="none" stroke="#bb7e86" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="12" cy="34" r="4" fill="#f4c0bc" opacity=".65" /><circle cx="40" cy="34" r="4" fill="#f4c0bc" opacity=".65" />
      <path d="M26 48c-5-7-13 0 0 9 13-9 5-16 0-9z" fill="#ce7b89" />
      <g transform="translate(40 8)"><circle r="7" fill="#fff3dd" /><circle cx="-5" cy="-2" r="3" fill="#e3a9bd" /><circle cx="4" cy="-4" r="3" fill="#e3a9bd" /><circle cx="4" cy="4" r="3" fill="#e3a9bd" /><circle cx="-4" cy="4" r="3" fill="#e3a9bd" /><circle r="2.6" fill="#e7bd68" /></g>
    </g>
  )
}

export function PlazaScene({ player, direction, step, evening }) {
  const playerPoint = iso(player.c, player.r)
  const items = []
  const add = (id, c, r, element, layer = 0) => items.push({ id, y: iso(c, r).y + layer, element })

  LOCATIONS.filter((place) => place.kind !== 'park').forEach((place) => add(place.id, place.c, place.r, <Building place={place} />))
  ;[[3, 6, true], [5, 15, true], [9, 20, true], [1, 16, false], [14, 2, true], [17, 19, false], [21, 10, true], [3, 20, false], [16, 22, true], [20, 3, false]].forEach(([c, r, blossom], i) => {
    const p = iso(c, r); add(`tree-${i}`, c, r, <Tree x={p.x} y={p.y} blossom={blossom} size={i % 3 === 0 ? .9 : 1} />)
  })
  ;[[2, 13, true], [6, 6, false], [19, 20, true], [11, 3, false], [7, 22, true]].forEach(([c, r, flower], i) => { const p = iso(c, r); add(`bush-${i}`, c, r, <Bush x={p.x} y={p.y} flower={flower} />) })
  ;[[8, 15], [14, 11], [11, 17]].forEach(([c, r], i) => { const p = iso(c, r); add(`bench-${i}`, c, r, <Bench x={p.x} y={p.y} />) })
  ;[[9, 9], [15, 10], [7, 14], [17, 18]].forEach(([c, r], i) => { const p = iso(c, r); add(`lamp-${i}`, c, r, <Streetlight x={p.x} y={p.y} />) })
  ;[[8, 20], [10, 6], [15, 18], [5, 17]].forEach(([c, r], i) => { const p = iso(c, r); add(`flowers-${i}`, c, r, <Flowerbed x={p.x} y={p.y} />) })
  ;[[6, 14, 'bike'], [5, 19, 'cat'], [13, 18, 'board']].forEach(([c, r, type], i) => { const p = iso(c, r); add(`prop-${i}`, c, r, <VillageProps x={p.x} y={p.y} type={type} />) })
  add('fountain', 12, 12, <Fountain {...iso(12, 12)} />)
  NPCS.forEach((npc) => { const p = iso(npc.c, npc.r); add(npc.id, npc.c, npc.r, <g><CharacterArt x={p.x} y={p.y} shirt={npc.shirt} hair={npc.hair} scale={.72} /><text x={p.x} y={p.y + 24} textAnchor="middle" fontSize="13" fontWeight="700" fill="#345055">{npc.name}</text></g>, 1) })
  add('player', player.c, player.r, <CharacterArt x={playerPoint.x} y={playerPoint.y} direction={direction} step={step} scarf />, 5)
  add('lumi', player.c + .65, player.r - .35, <LumiArt x={playerPoint.x + 62} y={playerPoint.y - 27} scale={.83} />, 6)

  const tiles = []
  for (let sum = 0; sum <= (MAP_SIZE - 1) * 2; sum++) {
    for (let c = 0; c < MAP_SIZE; c++) {
      const r = sum - c
      if (r >= 0 && r < MAP_SIZE) tiles.push(<FloorTile key={`${c}-${r}`} c={c} r={r} />)
    }
  }
  return (
    <svg className={`showcase-scene-svg ${evening ? 'is-evening' : ''}`} viewBox="0 0 1600 920" preserveAspectRatio="xMidYMid slice" role="img" aria-label="봄날의 이음 마을. 중앙 분수, 벚꽃 공원, 강과 다리, 카페, 편의점과 여러 마을 건물이 보입니다.">
      <defs>
        <linearGradient id="worldSky" x2="0" y2="1"><stop stopColor={evening ? '#7187a7' : '#bdd9df'} /><stop offset="1" stopColor={evening ? '#dcac98' : '#f5e3c8'} /></linearGradient>
        <linearGradient id="water" x2="0" y2="1"><stop stopColor="#9ad6d4" /><stop offset="1" stopColor="#548fa9" /></linearGradient>
      </defs>
      <rect width="1600" height="920" fill="url(#worldSky)" />
      <path d="M0 290Q210 170 410 236T800 196T1220 208T1600 180V500H0Z" fill={evening ? '#779391' : '#abc6a5'} opacity=".65" />
      <path d="M0 410Q240 290 560 345T1120 312T1600 342V850H0Z" fill={evening ? '#759990' : '#b9cfa9'} />
      <rect y="780" width="1600" height="140" fill={evening ? '#759990' : '#b9cfa9'} />
      <path d="M0 220Q170 170 325 220T650 213" fill="none" stroke="#82bac4" strokeWidth="33" opacity=".55" />
      <g className="world-floor">{tiles}</g>
      <path d="M-35 406Q76 447 150 506T282 563" fill="none" stroke="#5e8e9d" strokeWidth="52" opacity=".9" />
      <path d="M-35 406Q76 447 150 506T282 563" fill="none" stroke="#a8d7d6" strokeWidth="41" />
      <path d="M279 562q62-32 129 13q41 22 82 0" fill="none" stroke="#618e99" strokeWidth="23" opacity=".8" />
      <path d="M280 562q62-32 129 13q41 22 82 0" fill="none" stroke="#a6d8d5" strokeWidth="16" />
      <g fill="#C9BBA0" stroke="#9e9b84" strokeWidth="2" aria-hidden="true"><ellipse cx="130" cy="491" rx="10" ry="5" /><ellipse cx="212" cy="552" rx="12" ry="6" /><ellipse cx="292" cy="539" rx="10" ry="5" /><ellipse cx="456" cy="592" rx="10" ry="5" /></g>
      <g aria-hidden="true"><path d="M352 530l70 64" stroke="#506b71" strokeWidth="29" strokeLinecap="round" /><path d="M352 530l70 64" stroke="#c8a27b" strokeWidth="22" strokeLinecap="round" /><path d="M346 523l83 76M360 524l83 76" stroke="#eee0ba" strokeWidth="4" /><path d="M351 527l-18-22m90 91 18 22" stroke="#6c6256" strokeWidth="7" strokeLinecap="round" /></g>
      <g transform="translate(1270 677)" aria-hidden="true"><ellipse cx="0" cy="27" rx="75" ry="17" fill="#456b72" opacity=".2" /><rect x="-70" y="-17" width="139" height="45" rx="9" fill="#f5e7c5" stroke="#526c78" strokeWidth="4" /><rect x="-60" y="-9" width="94" height="19" rx="3" fill="#9bc7cf" /><path d="M-30-9v19m35-19v19" stroke="#526c78" strokeWidth="4" /><rect x="38" y="-8" width="23" height="17" fill="#9bc7cf" /><circle cx="-44" cy="29" r="11" fill="#425365" /><circle cx="45" cy="29" r="11" fill="#425365" /></g>
      <g className="petals" opacity=".9"><circle className="petal petal-one" cx="338" cy="226" r="5" /><circle className="petal petal-two" cx="1220" cy="153" r="4" /><circle className="petal petal-three" cx="621" cy="91" r="5" /><circle className="petal petal-four" cx="994" cy="294" r="4" /></g>
      {items.sort((a, b) => a.y - b.y).map((item) => <g key={item.id}>{item.element}</g>)}
    </svg>
  )
}

export function RoomScene({ evening, reward, onDoor }) {
  const wallLeft = evening ? '#97a5b2' : '#e7d3bb'
  const wallRight = evening ? '#a8a7b4' : '#f2dfc3'
  return (
    <svg className={`showcase-scene-svg room-scene-svg ${evening ? 'is-evening' : ''}`} viewBox="0 0 1100 720" preserveAspectRatio="xMidYMid meet" role="img" aria-label={`따뜻한 아이소메트릭 내 방. ${reward ? '산책 보상 화분이 놓여 있습니다.' : '산책 보상 전의 방입니다.'}`}>
      <defs><linearGradient id="roomBg" x2="0" y2="1"><stop stopColor={evening ? '#748eac' : '#c7dfe1'} /><stop offset="1" stopColor={evening ? '#c3a6a5' : '#f7e6ce'} /></linearGradient></defs>
      <rect width="1100" height="720" fill="url(#roomBg)" />
      <circle cx="898" cy="116" r="82" fill={evening ? '#f1d6a7' : '#fff4cf'} opacity=".65" />
      <path d="M0 417Q190 278 353 364T710 328T1100 340V720H0Z" fill={evening ? '#80988e' : '#b6d1ac'} opacity=".65" />
      <ellipse cx="555" cy="629" rx="401" ry="76" fill="#4b6063" opacity=".15" />
      <polygon points="160,500 550,315 940,500 550,685" fill="#bf986f" stroke="#706664" strokeWidth="5" />
      <polygon points="160,500 550,315 550,91 160,276" fill={wallLeft} stroke="#746e70" strokeWidth="5" />
      <polygon points="550,315 940,500 940,276 550,91" fill={wallRight} stroke="#746e70" strokeWidth="5" />
      <path d="M160 470L550 285L940 470" fill="none" stroke="#fff0d0" strokeWidth="7" opacity=".55" />
      <path d="M223 530L611 345M312 575L700 389M404 617L793 433M496 659L885 477" fill="none" stroke="#a77b59" strokeWidth="2" opacity=".5" />
      <path d="M232 465L624 650M315 424L706 609M399 386L791 570M483 346L875 529" fill="none" stroke="#a77b59" strokeWidth="2" opacity=".5" />
      <polygon points="244,286 376,224 376,344 244,407" fill="#f8efe0" stroke="#907779" strokeWidth="5" />
      <polygon points="259,294 361,246 361,333 259,381" fill={evening ? '#6c83a0' : '#95cddd'} stroke="#b3a9a3" strokeWidth="3" />
      <path d="M275 354q24-37 48-19t38-16" fill="none" stroke="#7eaa83" strokeWidth="16" /><path d="M310 272l0 91" stroke="#fff2d9" strokeWidth="5" />
      <path d="M244 345l132-62" stroke="#fff2d9" strokeWidth="5" /><path d="M235 277q9 69-7 111" fill="none" stroke="#ecbab1" strokeWidth="15" /><path d="M383 222q-8 69 4 112" fill="none" stroke="#ecbab1" strokeWidth="15" />
      <polygon points="637,203 722,244 722,344 637,303" fill="#f4eddb" stroke="#7b686f" strokeWidth="4" /><path d="M653 224l53 26v72l-53-27z" fill="#89adb2" /><circle cx="690" cy="285" r="4" fill="#f4dec0" />
      <g onClick={onDoor} role="button" tabIndex="0" className="room-door" aria-label="문을 통해 동네로 나가기" onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onDoor() } }}><polygon points="801,262 878,299 878,462 801,426" fill="#8d705f" stroke="#5d575a" strokeWidth="6" /><polygon points="814,285 866,309 866,440 814,415" fill="#a97c61" /><circle cx="852" cy="381" r="5" fill="#f2db9f" /><rect x="775" y="235" width="126" height="37" rx="11" fill="#fffaf0" stroke="#5e656c" strokeWidth="3" /><text x="838" y="260" fontSize="17" textAnchor="middle" fontWeight="800" fill="#365159">동네로 나가기</text></g>
      <ellipse cx="546" cy="503" rx="165" ry="74" fill="#e7b9aa" stroke="#c09083" strokeWidth="5" /><ellipse cx="546" cy="503" rx="133" ry="54" fill="#f5d4ba" stroke="#d6a59a" strokeWidth="3" />
      <g><polygon points="243,432 385,365 486,411 343,480" fill="#806a62" stroke="#62575a" strokeWidth="5" /><polygon points="244,406 384,340 484,385 344,451" fill="#f8efda" stroke="#897c77" strokeWidth="5" /><polygon points="245,403 302,376 400,421 344,449" fill="#fbf7e8" /><polygon points="305,373 386,338 482,383 400,419" fill="#d5e5d5" /><path d="M265 403l37-18 39 18-37 18z" fill="#f5d9d2" /></g>
      <g><polygon points="632,419 735,368 815,403 711,457" fill="#ad805d" stroke="#6d5d55" strokeWidth="5" /><path d="M649 426v45m146-62v48m-82 0v48" stroke="#76573f" strokeWidth="9" /><polygon points="666,365 716,342 756,360 706,384" fill="#586f78" stroke="#47535e" strokeWidth="4" /><polygon points="671,366 714,346 746,360 704,379" fill={evening ? '#f3ba8f' : '#a9d1d3'} /><path d="M702 380v12m-23 7h47" stroke="#4c5861" strokeWidth="5" /><ellipse cx="778" cy="410" rx="12" ry="7" fill="#e9d69b" /></g>
      <g><polygon points="663,519 708,497 743,513 697,535" fill="#698894" stroke="#4b626b" strokeWidth="4" /><path d="M674 526v29m57-29v29" stroke="#526971" strokeWidth="8" /><path d="M680 498l0-34 28 13v23" fill="none" stroke="#607f88" strokeWidth="11" /></g>
      <g><polygon points="595,251 659,281 659,336 595,305" fill="#fff5e4" stroke="#9c817c" strokeWidth="4" /><path d="M603 290l22-26 26 40" fill="none" stroke="#92b6a4" strokeWidth="9" /><circle cx="635" cy="279" r="7" fill="#f0c8aa" /></g>
      <g><path d="M205 447l6-47" stroke="#71554c" strokeWidth="7" /><circle cx="211" cy="393" r="17" fill="#79a57c" /><circle cx="196" cy="402" r="12" fill="#85af84" /><polygon points="190,448 232,448 225,474 196,474" fill="#b87b61" stroke="#765c54" strokeWidth="3" /></g>
      {reward && <g className="reward-plant"><ellipse cx="803" cy="552" rx="47" ry="19" fill="#f6d99b" opacity=".72" /><ellipse cx="803" cy="551" rx="36" ry="12" fill="#6b6b61" opacity=".19" /><path d="M779 510h48l-7 42h-34z" fill="#c97659" stroke="#855a53" strokeWidth="4" /><path d="M803 513v-56m0 35q-28-24-29-45m29 33q29-24 29-49" fill="none" stroke="#568668" strokeWidth="8" strokeLinecap="round" /><ellipse cx="773" cy="444" rx="21" ry="9" transform="rotate(36 773 444)" fill="#7bac77" /><ellipse cx="832" cy="428" rx="22" ry="10" transform="rotate(-35 832 428)" fill="#7bac77" /><ellipse cx="792" cy="460" rx="17" ry="8" transform="rotate(-50 792 460)" fill="#9fbe80" /><rect x="762" y="373" width="83" height="32" rx="10" fill="#fff7df" stroke="#759577" strokeWidth="3" /><text x="803" y="394" textAnchor="middle" fontSize="16" fontWeight="900" fill="#4d8260">NEW ✦</text></g>}
      <CharacterArt x={516} y={585} scarf scale={1.12} /><LumiArt x={623} y={506} scale={1.18} />
      <g className="room-sparkle"><path d="M735 442v18m-9-9h18" stroke="#fff4d4" strokeWidth="5" strokeLinecap="round" /></g>
    </svg>
  )
}
