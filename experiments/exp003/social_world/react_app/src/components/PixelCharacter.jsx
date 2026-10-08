// EXP-001: 한 프레임을 32×32 논리 픽셀로 그린다. 화면 크기는 CSS에서 조절한다.
// PNG 11장을 따로 관리하는 대신 팔레트와 방향/걸음만 바꾸므로 첫 실험의 수정 비용이 낮다.
const PALETTES = {
  player: { shirt: '#db6258', shade: '#a83f40', hair: '#392b31', skin: '#f2bc91', pants: '#354d78' },
  policy: { shirt: '#5387d1', shade: '#315b9b', hair: '#44332d', skin: '#edbb91', pants: '#273f70' },
  job: { shirt: '#60a768', shade: '#367547', hair: '#292a36', skin: '#dda47d', pants: '#34465d' },
  psych: { shirt: '#a47bc2', shade: '#745293', hair: '#744c40', skin: '#f1c69f', pants: '#46506b' },
}

const INK = '#253143'
const LIGHT = '#fff0ca'

export default function PixelCharacter({ kind = 'player', direction = 'down', step = 0 }) {
  const palette = PALETTES[kind] ?? PALETTES.player
  const side = direction === 'left' || direction === 'right'
  const back = direction === 'up'
  const walking = step % 2 === 1

  // rect 좌표는 정수만 사용한다. SVG가 확대돼도 픽셀 모서리가 흐려지지 않도록 crispEdges를 적용한다.
  const rect = (x, y, width, height, fill) => (
    <rect x={x} y={y} width={width} height={height} fill={fill} />
  )

  return (
    <svg className="pixel-character" viewBox="0 0 32 32" shapeRendering="crispEdges" aria-hidden="true">
      {/* 발·그림자를 먼저 그려 몸 뒤에 배치한다. 걸음 프레임은 다리 위치만 교대한다. */}
      {rect(8, 29, 17, 2, '#536253')}
      {rect(walking ? 9 : 11, 25, 6, 5, INK)}
      {rect(walking ? 18 : 17, 25, 6, 5, INK)}
      {rect(walking ? 10 : 12, 25, 4, 4, palette.pants)}
      {rect(walking ? 19 : 18, 25, 4, 4, palette.pants)}

      {/* 팔과 몸통은 모든 역할이 같은 규격이다. 색만 달라져도 NPC를 빠르게 구별할 수 있다. */}
      {rect(6, 16, 20, 9, INK)}
      {rect(7, 17, 4, 7, palette.skin)}
      {rect(21, 17, 4, 7, palette.skin)}
      {rect(10, 15, 12, 11, INK)}
      {rect(11, 16, 10, 9, palette.shirt)}
      {rect(11, 23, 10, 2, palette.shade)}
      {kind === 'job' && rect(15, 17, 2, 6, LIGHT)}
      {kind === 'policy' && rect(23, 18, 3, 5, LIGHT)}
      {kind === 'psych' && rect(12, 17, 8, 2, LIGHT)}

      {/* 머리와 눈: 뒷모습에는 얼굴을 그리지 않고, 옆모습은 한쪽 눈만 보인다. */}
      {rect(9, 3, 14, 13, INK)}
      {rect(10, 4, 12, 11, palette.hair)}
      {!back && rect(11, 7, 10, 8, palette.skin)}
      {!back && rect(11, 7, 10, 2, palette.hair)}
      {!back && !side && rect(13, 11, 2, 2, INK)}
      {!back && !side && rect(18, 11, 2, 2, INK)}
      {direction === 'left' && rect(12, 11, 2, 2, INK)}
      {direction === 'right' && rect(19, 11, 2, 2, INK)}
      {kind === 'psych' && rect(10, 4, 12, 2, '#bd8d68')}
    </svg>
  )
}
