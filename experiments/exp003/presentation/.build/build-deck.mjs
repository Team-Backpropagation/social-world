import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { Presentation, PresentationFile } from '@oai/artifact-tool'

const workspaceDir = process.env.WORKSPACE_DIR
const SKILL_DIR = process.env.SKILL_DIR
const TMP_DIR = process.env.TMP_DIR
const FINAL_PPTX = process.env.FINAL_PPTX
const RUNTIME_PYTHON = process.env.RUNTIME_PYTHON
for (const [name, value] of Object.entries({ workspaceDir, SKILL_DIR, TMP_DIR, FINAL_PPTX, RUNTIME_PYTHON })) {
  if (!value || !path.isAbsolute(value)) throw new Error(`${name} must be absolute`)
}
const { resolvePresentationFont, finalizePresentation } = await import(
  pathToFileURL(path.join(SKILL_DIR, 'container_tools/artifact_tool_utils.mjs')).href
)
const font = resolvePresentationFont({ fontFamily: 'Malgun Gothic' })
const C = { cream: '#F5EFE5', paper: '#FFF9EF', navy: '#18394B', teal: '#397D71', light: '#D9E9DB', ink: '#203D49', muted: '#506A71', blossom: '#DD9F9D' }
const presentation = Presentation.create({ slideSize: { width: 1280, height: 720 } })
const slides = []
const screenshot = (name) => path.join(TMP_DIR, name)

function txt(slide, value, x, y, w, h, size, color = C.ink, bold = false) {
  const shape = slide.shapes.add({ geometry: 'textbox', position: { left: x, top: y, width: w, height: h }, fill: 'none', line: { fill: 'none', width: 0 } })
  shape.text = value
  shape.text.style = { typeface: font, fontSize: size, bold, color, autoFit: 'none' }
  return shape
}
async function pic(slide, filename, box, alt) {
  slide.images.add({ blob: new Uint8Array(await fs.readFile(screenshot(filename))), contentType: 'image/png', fit: 'contain', position: box, alt })
}
async function crop(from, to, left, top, width, height) {
  await sharp(screenshot(from)).extract({ left, top, width, height }).png().toFile(screenshot(to))
}
function slide(bg = C.cream) {
  const s = presentation.slides.add()
  s.background.fill = bg
  slides.push(s)
  return s
}
function note(s, body) {
  s.speakerNotes.textFrame.setText(`출처: 2026-09-30 http://127.0.0.1:5173/ 에서 직접 캡처한 EXP-003 개인 시제품 UI. ${body}`)
}
function header(s, title, section, page) {
  txt(s, section, 62, 33, 740, 31, 18, C.teal, true)
  txt(s, title, 62, 72, 1150, 70, 46, C.ink, true)
  txt(s, `EXP-003  /  ${page.toString().padStart(2, '0')}`, 1060, 36, 170, 28, 16, C.muted)
}
await fs.mkdir(TMP_DIR, { recursive: true })
await fs.mkdir(path.dirname(FINAL_PPTX), { recursive: true })
await crop('ui-dialog.png', 'dialog-crop.png', 555, 288, 490, 425)
await crop('ui-park.png', 'park-crop.png', 555, 355, 490, 290)
await crop('ui-reward.png', 'reward-crop.png', 555, 314, 490, 372)
await crop('ui-room-reward.png', 'room-reward-crop.png', 1304, 414, 254, 145)
await crop('ui-home.png', 'journey-crop.png', 10, 660, 1575, 267)
await crop('ui-home.png', 'minimap-crop.png', 1378, 82, 200, 210)

// 1. Interface overview
{
  const s = slide(C.navy)
  txt(s, '이음 마을', 62, 52, 570, 90, 62, C.paper, true)
  txt(s, '내 방에서 시작해 동네를 걷는\n작은 행동 시연', 66, 147, 560, 100, 31, C.paper)
  await pic(s, 'ui-home-stage.png', { left: 56, top: 273, width: 1168, height: 430 }, '이음 마을 시작 화면의 아이소메트릭 마을과 내 방 상태')
  note(s, '첫 화면의 장소 표식, 상태 카드, 미니맵, 방 미리보기를 보여 준다. 팀 공식안은 아니다.')
}
// 2. Wayfinding details
{
  const s = slide()
  header(s, '마을 탐색 화면', '장소와 길 찾기', 2)
  await pic(s, 'ui-town-stage.png', { left: 62, top: 167, width: 1156, height: 424 }, '장소 표식과 미니맵이 있는 마을 탐색 화면')
  txt(s, '8개 장소 표식', 67, 610, 312, 37, 28, C.ink, true)
  txt(s, '현재 위치와 목표', 430, 610, 365, 37, 28, C.ink, true)
  txt(s, '방향키와 WASD 이동', 844, 610, 380, 37, 28, C.ink, true)
  txt(s, '공원 안내부터 이동 조작까지 한 화면에서 이어집니다.', 67, 659, 1135, 36, 21, C.muted)
  note(s, '장소 표식은 설명 팝업으로 연결된다. 이동은 키보드 및 화면 버튼을 사용한다.')
}
// 3. Dialogue
{
  const s = slide(C.paper)
  header(s, '루미의 선택지 대화', '작은 목표 고르기', 3)
  await pic(s, 'dialog-crop.png', { left: 69, top: 169, width: 558, height: 484 }, '세 가지 선택지를 제공하는 루미 대화창')
  txt(s, '상태를 묻는 첫 문장', 697, 215, 485, 49, 30, C.ink, true)
  txt(s, '사용자는 쉬기, 산책하기,\n이야기하기 중 하나를 고릅니다.', 698, 282, 492, 115, 26, C.ink)
  txt(s, '산책 선택 뒤 공원 목표가 열리고\n동네 탐색으로 이어집니다.', 698, 439, 492, 115, 26, C.ink)
  txt(s, '고정 응답을 보여 주는 시연용 대화입니다.', 698, 617, 493, 36, 19, C.muted)
  note(s, '현재 시제품은 고정 선택지와 목업 응답을 사용하며 실제 상담 또는 AI API를 연결하지 않는다.')
}
// 4. Mission flow
{
  const s = slide()
  header(s, '공원 산책 미션', '동네 이동과 목표 상태', 4)
  txt(s, '루미와 산책 목표를 고릅니다.', 69, 210, 565, 76, 29, C.ink)
  txt(s, '공원 표식을 눌러 입구로 이동합니다.', 69, 314, 565, 76, 29, C.ink)
  txt(s, '방향 버튼으로 공원까지 걸어갑니다.', 69, 418, 565, 76, 29, C.ink)
  await pic(s, 'park-crop.png', { left: 676, top: 186, width: 538, height: 389 }, '공원 입구 이동을 안내하는 장소 팝업')
  txt(s, '위치와 오늘의 목표가 화면 하단에 계속 표시됩니다.', 69, 621, 1110, 55, 22, C.muted)
  note(s, '시제품 흐름에서는 공원 입구에서 왼쪽 이동 버튼을 두 번 누르면 완료 상태가 된다.')
}
// 5. Reward
{
  const s = slide(C.paper)
  header(s, '보상과 방의 변화', '목표 완료 피드백', 5)
  await pic(s, 'reward-crop.png', { left: 66, top: 172, width: 540, height: 410 }, '산책 완료와 화분 보상을 안내하는 화면')
  await pic(s, 'room-reward-crop.png', { left: 655, top: 201, width: 538, height: 331 }, '화분 보상 후의 내 방 미리보기')
  txt(s, '완료 안내', 83, 606, 455, 43, 29, C.ink, true)
  txt(s, '내 방에 놓인 화분', 681, 606, 493, 43, 29, C.ink, true)
  txt(s, '보상 상태는 브라우저에 저장되어 다시 방문해도 확인할 수 있습니다.', 66, 665, 1115, 29, 20, C.muted)
  note(s, '화분은 시제품의 시각적 보상이며 실제 서비스의 보상이 아니다.')
}
// 6. End-to-end UI and demo scope
{
  const s = slide()
  header(s, '다섯 장면의 흐름', '발표 시연 순서', 6)
  await pic(s, 'journey-crop.png', { left: 60, top: 167, width: 1160, height: 197 }, '내 방, 루미 대화, 동네 탐험, 미션, 보상 카드')
  txt(s, '내 방에서 루미와 대화', 64, 406, 1030, 48, 31, C.ink, true)
  txt(s, '산책을 선택하고 공원에 도착하면 화분 보상을 확인합니다.', 64, 465, 1130, 78, 27, C.ink)
  txt(s, '현재 시연: 장소 소개, 고정 선택지 대화, 공원 산책, 방의 화분 변화', 64, 585, 1130, 34, 21, C.muted)
  txt(s, '실제 AI 상담, 기관 신청, 위험 판정, 서버 저장은 연결되지 않았습니다.', 64, 632, 1130, 34, 21, C.muted)
  note(s, '개인 디자인 실험의 시연 범위다. 여정 카드는 직접 화면 이동을 지원한다.')
}

for (let i = 0; i < slides.length; i++) {
  const png = await presentation.export({ slide: slides[i], format: 'png', scale: 1 })
  await fs.writeFile(path.join(TMP_DIR, `slide-${i + 1}.png`), new Uint8Array(await png.arrayBuffer()))
}
const candidatePath = path.join(TMP_DIR, 'candidate.pptx')
await (await PresentationFile.exportPptx(presentation)).save(candidatePath)
const result = await finalizePresentation({
  workspaceDir, candidatePath, finalPath: FINAL_PPTX, pythonExecutable: RUNTIME_PYTHON,
  integrityValidatorPath: path.join(SKILL_DIR, 'container_tools/inspect_presentation_package_integrity.py'),
  layoutValidatorPath: path.join(SKILL_DIR, 'container_tools/inspect_presentation_layout_geometry.py'),
  layoutArgs: ['--expected-slide-size-emu', '12192000,6858000', '--validate-heading-fit'],
  explicitTotalSlideCount: 6, requiredNativeTableOwnerSlides: [], requiredNativeChartOwnerSlides: [],
  fontPolicy: { basis: 'design', families: [font] }, verifyArtifactToolImport: true,
  receiptPath: path.join(TMP_DIR, `${path.basename(FINAL_PPTX)}.validation.json`),
})
console.log(JSON.stringify({ finalPath: FINAL_PPTX, result }))
