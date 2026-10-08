export const MAP_SIZE = 24

export function iso(c, r) {
  return { x: 800 + (c - r) * 32, y: 94 + (c + r) * 16 }
}

export const LOCATIONS = [
  { id: 'park', name: '공원', caption: '벚꽃길 산책 미션', icon: '🌳', c: 9, r: 19, kind: 'park' },
  { id: 'cafe', name: '카페', caption: '동네 만남 안내', icon: '☕', c: 4, r: 10, color: '#F3DFC0', roof: '#B56C5A' },
  { id: 'support', name: '주민센터', caption: '지역 지원 정보', icon: '🏛', c: 8, r: 4, color: '#F6E9D3', roof: '#3F8C86' },
  { id: 'counsel', name: '상담센터', caption: '대화 공간 안내', icon: '♡', c: 13, r: 5, color: '#e6b7ab', roof: '#916d91' },
  { id: 'job', name: '취업지원센터', caption: '취업·교육 정보', icon: '▣', c: 18, r: 7, color: '#a8c5bb', roof: '#597e8e' },
  { id: 'convenience', name: '편의점', caption: '일상 속 작은 쉼', icon: '▤', c: 16, r: 12, color: '#cad7df', roof: '#557f9a' },
  { id: 'home', name: '나의 집', caption: '내 방과 가구 꾸미기', icon: '⌂', c: 19, r: 15, color: '#F6E9D3', roof: '#D9774F' },
  { id: 'volunteer', name: '봉사활동 센터', caption: '지역 활동 안내', icon: '✿', c: 23, r: 13, color: '#dfc9b7', roof: '#ac7b67' },
]

export const NPCS = [
  { id: 'neighbor', name: '동네 주민', c: 10, r: 15, shirt: '#bd755f', hair: '#684d3d' },
  { id: 'gardener', name: '공원지기', c: 7, r: 17, shirt: '#639576', hair: '#60493b' },
  { id: 'barista', name: '카페 주인', c: 5, r: 12, shirt: '#b89764', hair: '#3d3545' },
  { id: 'guide', name: '마을 안내자', c: 10, r: 8, shirt: '#7592bb', hair: '#56434a' },
  { id: 'visitor', name: '방문객', c: 16, r: 12, shirt: '#a879a6', hair: '#51403f' },
  { id: 'walker', name: '산책하는 주민', c: 10, r: 19, shirt: '#658e9d', hair: '#564238' },
]

export const OBSTACLES = [
  ...LOCATIONS.filter(({ kind }) => kind !== 'park').map(({ c, r, id }) => ({ c, r, radius: id === 'home' ? 1.55 : 1.75 })),
  { c: 12, r: 12, radius: 1.65 },
  { c: 6, r: 19, radius: 0.65 },
]

export function canStand(c, r) {
  if (c < 0.8 || r < 0.8 || c > MAP_SIZE - 1.8 || r > MAP_SIZE - 1.8) return false
  return OBSTACLES.every((obstacle) => Math.hypot(c - obstacle.c, r - obstacle.r) > obstacle.radius + 0.33)
}

export function inPark(c, r) {
  return c >= 7.4 && c <= 10.5 && r >= 18.1 && r <= 21.5
}

export function floorKind(c, r) {
  if (c <= 10 && r >= 16) return 'park'
  if (Math.abs(c - 12) + Math.abs(r - 12) <= 5) return 'plaza'
  if (c >= 10 && c <= 13) return 'path'
  if (r >= 10 && r <= 13) return 'path'
  if (c >= 15 && c <= 19 && r >= 13 && r <= 17) return 'path'
  return 'grass'
}
