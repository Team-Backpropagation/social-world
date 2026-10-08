import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Presentation, PresentationFile } from '@oai/artifact-tool';

const workspaceDir = process.env.WORKSPACE_DIR;
const SKILL_DIR = process.env.SKILL_DIR;
const TMP_DIR = process.env.TMP_DIR;
const FINAL_PPTX = process.env.FINAL_PPTX;
const RUNTIME_PYTHON = process.env.RUNTIME_PYTHON;
for (const [name, value] of Object.entries({ workspaceDir, SKILL_DIR, TMP_DIR, FINAL_PPTX, RUNTIME_PYTHON })) {
  if (!value || !path.isAbsolute(value)) throw new Error(`${name} must be absolute`);
}

const { resolvePresentationFont, finalizePresentation } = await import(
  pathToFileURL(path.join(SKILL_DIR, 'container_tools/artifact_tool_utils.mjs')).href
);
const font = resolvePresentationFont({ fontFamily: 'Malgun Gothic' });
const imageBytes = new Uint8Array(await fs.readFile(path.join(workspaceDir, '..', 'reference.png')));
const presentation = Presentation.create({ slideSize: { width: 1280, height: 720 } });
const slideList = [];
const navy = '#152E49';
const cream = '#F7EDE8';
const white = '#FFF9F4';
const coral = '#F2AF9B';
const ink = '#19354C';
const muted = '#41566A';

function addText(slide, text, left, top, width, height, size, color, bold = false) {
  const shape = slide.shapes.add({
    geometry: 'textbox',
    position: { left, top, width, height },
    fill: 'none',
    line: { fill: 'none', width: 0 },
  });
  shape.text = text;
  shape.text.style = { typeface: font, fontSize: size, bold, color, autoFit: 'none' };
  return shape;
}

function addReference(slide, position) {
  slide.images.add({
    blob: imageBytes,
    contentType: 'image/png',
    alt: '사용자가 제공한 함께, 더 가까이 EXP-004 인터페이스 이미지',
    fit: 'contain',
    position,
  });
}

function mask(slide, left, top, width, height, color) {
  slide.shapes.add({
    geometry: 'rect',
    position: { left, top, width, height },
    fill: color,
    line: { fill: 'none', width: 0 },
  });
}

function note(slide, text) {
  slide.speakerNotes.textFrame.setText(`출처: 사용자 제공 EXP-004 참고 이미지(reference.png), 2026-09-29. ${text}`);
}

// 1. Cover
{
  const slide = presentation.slides.add();
  slideList.push(slide);
  slide.background.fill = navy;
  addText(slide, '함께,\n더 가까이', 62, 158, 390, 170, 65, white, true);
  addText(slide, '작은 행동을 시작하는\n동네 탐험 경험', 66, 375, 365, 95, 28, white);
  addText(slide, 'EXP-004  개인 디자인 시안', 66, 613, 360, 40, 21, coral, true);
  addReference(slide, { left: 482, top: 85, width: 735, height: 490 });
  note(slide, '이 장은 시안 전체 구도를 보여 준다. 팀 채택 여부는 미확정이다.');
}

// 2. Village overview
{
  const slide = presentation.slides.add();
  slideList.push(slide);
  slide.background.fill = cream;
  addText(slide, '동네 공간', 59, 43, 580, 72, 52, ink, true);
  addText(slide, '지도에서 장소를 고르고 다음 행동으로 이동합니다.', 61, 116, 1080, 52, 27, muted);
  addReference(slide, { left: 59, top: 179, width: 1162, height: 775 });
  mask(slide, 0, 618, 1280, 102, cream);
  addText(slide, '내 방, 공원, 상담센터 등 8개 장소와 미니맵을 한 화면에 배치했습니다.',
    61, 642, 1110, 42, 23, ink);
  note(slide, '이미지 상단을 화면 설명을 위해 확대했다. 장소 버튼은 실제 EXP-004 HTML에서 동작한다.');
}

// 3. User journey
{
  const slide = presentation.slides.add();
  slideList.push(slide);
  slide.background.fill = cream;
  addReference(slide, { left: 51, top: -261, width: 1178, height: 785 });
  mask(slide, 0, 0, 1280, 191, cream);
  mask(slide, 0, 438, 1280, 282, cream);
  addText(slide, '다섯 장면의 사용자 여정', 59, 43, 1130, 72, 50, ink, true);
  addText(slide, '내 방에서 시작해 공원 미션을 마친 뒤 보상을 확인합니다.', 61, 115, 1110, 52, 27, muted);
  const stages = [
    ['01', '내 방'], ['02', '루미 대화'], ['03', '동네 탐험'],
    ['04', '공원 미션'], ['05', '화분 보상'],
  ];
  stages.forEach(([number, label], i) => {
    const x = 65 + i * 236;
    addText(slide, number, x, 488, 140, 37, 22, '#A96758', true);
    addText(slide, label, x, 531, 213, 56, 30, ink, true);
  });
  addText(slide, '시연에서는 루미의 고정 선택지를 고르고 공원 정리 활동을 다섯 번 완료합니다.',
    61, 638, 1130, 40, 22, muted);
  note(slide, '방, 대화, 탐험, 공원 미션, 화분 보상은 EXP-004에서 클릭 흐름으로 시연된다.');
}

// 4. Implemented demo scope
{
  const slide = presentation.slides.add();
  slideList.push(slide);
  slide.background.fill = navy;
  addReference(slide, { left: -728, top: -583, width: 1933, height: 1288 });
  mask(slide, 0, 0, 794, 720, navy);
  mask(slide, 794, 0, 486, 162, navy);
  mask(slide, 794, 572, 486, 148, navy);
  mask(slide, 1204, 162, 76, 410, navy);
  addText(slide, '현재 시연 범위', 59, 48, 700, 70, 51, white, true);
  addText(slide, '장소', 62, 166, 610, 43, 29, coral, true);
  addText(slide, '표식을 누르면 각 장소의 설명을 볼 수 있습니다.', 62, 210, 650, 55, 24, white);
  addText(slide, '대화', 62, 290, 610, 43, 29, coral, true);
  addText(slide, '루미의 고정 선택지로 작은 목표를 정합니다.', 62, 334, 650, 55, 24, white);
  addText(slide, '미션과 보상', 62, 414, 610, 43, 29, coral, true);
  addText(slide, '공원 정리 5회 뒤 화분 보상 안내가 나타납니다.', 62, 458, 650, 55, 24, white);
  addText(slide, '실제 AI 상담, 기관 신청, 지역 데이터 연동은 포함되지 않습니다.',
    62, 630, 1120, 45, 20, '#D4E0E6');
  note(slide, '개인 디자인 실험 범위다. 실제 서비스 연결, 위험 판정, 서버 저장은 없다.');
}

await fs.mkdir(TMP_DIR, { recursive: true });
await fs.mkdir(path.dirname(FINAL_PPTX), { recursive: true });
for (let i = 0; i < slideList.length; i++) {
  const slide = slideList[i];
  const preview = await presentation.export({ slide, format: 'png', scale: 1 });
  await fs.writeFile(path.join(TMP_DIR, `slide-${i + 1}.png`), new Uint8Array(await preview.arrayBuffer()));
}

const candidatePath = path.join(TMP_DIR, 'candidate.pptx');
await (await PresentationFile.exportPptx(presentation)).save(candidatePath);
const result = await finalizePresentation({
  workspaceDir,
  candidatePath,
  finalPath: FINAL_PPTX,
  pythonExecutable: RUNTIME_PYTHON,
  integrityValidatorPath: path.join(SKILL_DIR, 'container_tools/inspect_presentation_package_integrity.py'),
  layoutValidatorPath: path.join(SKILL_DIR, 'container_tools/inspect_presentation_layout_geometry.py'),
  layoutArgs: ['--expected-slide-size-emu', '12192000,6858000', '--validate-heading-fit'],
  explicitTotalSlideCount: 4,
  requiredNativeTableOwnerSlides: [],
  requiredNativeChartOwnerSlides: [],
  fontPolicy: { basis: 'design', families: [font] },
  verifyArtifactToolImport: true,
  receiptPath: path.join(TMP_DIR, `${path.basename(FINAL_PPTX)}.validation.json`),
});
console.log(JSON.stringify({ finalPath: FINAL_PPTX, result }));
