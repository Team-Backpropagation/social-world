# social_world/app — 소셜 월드 데모 원본 (나눠진 파일)

`socialworld-demo.html`(배포용 한 파일)을 만드는 원본이다. **데모를 고칠 때는 이 폴더를 고치고 `bundle.py`로 다시 만든다.**
`../socialworld-demo.html`을 직접 고치면 다음 번 bundle 때 사라진다.

2026-10-02: 원래 데모(한 파일)를 나누고, UI 담당 팀원이 PR #13(`social-world-ui-v2`)에서 만든 휴대폰·지도·설정·코코 알림·효과음을 얹었다.

## 1. 파일

| 파일 | 하는 일 | 출처 |
|---|---|---|
| `index.html` | 화면 뼈대(HUD·휴대폰 버튼·알림 자리)와 스크립트 순서 | 원래 데모 + PR #13 |
| `world.css` | 로그인·설문·대화창·3D HUD 스타일 | 원래 데모 `<style>` 그대로 |
| `ui.css` | 휴대폰·지도·설정·알림 스타일 | PR #13 (`.primary/.secondary`만 `#overlay` 안으로 좁힘) |
| `world-engine.js` | 3D 마을·이동·미니맵 (전역 `getEngine()`/`ENGINE`) | 원래 데모 엔진 + PR #13 추가 기능(키 바꾸기·화질 선택·입력 정지·지도 바탕·NPC 위치·북쪽 고정·강아지 동행) |
| `sounds.js` | 효과음 등록·재생 `Sound.play('이름')` | PR #13 |
| `assets/notification.mp3` | 코코 알림·미션 완료 효과음 | PR #13 |
| `assets/universfield-bubble-pop-293342.mp3` | 낚시 입질 시작 효과음 | 첨부 MP3 |
| `fishing-data.js` | 지역별 물 영역·아이템·확률·물고기 크기·분리수거 분류 | 낚시 데모에서 병합 |
| `inventory.js` | 사용자별 개별 아이템 저장·장착·묶음 표시·분리수거 | 낚시 데모에서 병합 |
| `fishing.js` | 인벤토리 화면·낚시 상태·입질 효과음·중단 처리 | 최신 main에 연결 |
| `ui.js` | 나의 휴대폰·전체 지도·설정·코코 알림 (`window.WorldUI`) | PR #13을 앱에 붙게 다시 정리 |
| `app.js` | 로그인·설문·튜토리얼·투어·NPC 대화·미션방·동아리방, DB | 원래 데모 앱 로직 그대로 + 연결부 |
| `bundle.py` | 위 파일 + `../coco/coco.js` + `../chief/chief.js`를 한 파일로 → `../socialworld-demo.html` | PR #13 bundle.py 기반 |
| `tests/fishing_test.cjs` | 낚시·인벤토리·안내 종료·계정별 저장·기존 UI 연결 검증 | 낚시 수정본 |
| `tests/ui_test.py` | 휴대폰·지도·설정·알림 흐름 40항목 × 데스크톱·모바일 | 새로 |

스크립트 순서: three(CDN) → `world-engine.js` → `../coco/coco.js` → `../chief/chief.js` → `sounds.js` → `fishing-data.js` → `inventory.js` → `fishing.js` → `ui.js` → `app.js`.

2026-10-06 `(7)` 기준 낚시 병합: I로 인벤토리 → 기본 낚싯대 장착 → 물가에서 상호작용 → 찌가 흔들리며 잠기면 상호작용. 인벤토리는 사용자 ID별로 현재 브라우저에 저장하며, 새 DB 테이블은 추가하지 않았다. 자세한 파일 분석·설정·확률은 `FISHING-GUIDE.md`.

## 2. 만들기·확인

```bash
python social_world/app/bundle.py                 # → social_world/socialworld-demo.html
python social_world/app/tests/ui_test.py          # 휴대폰·지도·설정·알림
node social_world/app/tests/fishing_test.cjs      # 낚시·인벤토리
python social_world/coco/tests/demo_test.py       # 코코 연결
python social_world/chief/tests/demo_test.py      # 마을이장 연결
```

테스트는 Playwright(크로미움)로 돌고 팀 DB 대신 가짜 supabase를 쓴다. three.js CDN이 막힌 곳이면 `SW_THREE_PATH=경로/three.min.js`.

개발 중에 나눠진 채로 보려면 `social_world` 폴더에서 `python -m http.server 8000` → `http://localhost:8000/app/`.

## 3. 휴대폰 UI가 하는 일 (`ui.js`)

| 기능 | 동작 | DB |
|---|---|---|
| 나의 휴대폰 (오른쪽 아래 버튼) | 홈·동아리·미션·연락처·설정 | — |
| 동아리 | 동아리 목록·멤버 수·가입. "동아리센터로 가기"로 개설 화면 | `clubs`, `club_members` insert |
| 미션 | 미션 목록(환류 추천 미션이 위·추천 표시)·시작·완료, 완료 효과음 | `missions`, `mission_progress` insert/update |
| 주민 연락처 | 루미·정책·취업은 그 NPC 앞으로 이동해 대화, 코코·이장은 바로 대화창 | 앱 대화창이 저장(원문 없음) |
| 전체 지도 (`M`) | 장소를 누르면 입구 앞으로 이동. 내 방에서 누르면 밖으로 나감 | — |
| 설정 | 미니맵 방향(북쪽 고정/회전)·화질·시점 초기화·효과음·키 바꾸기·로그아웃 | 이 브라우저 localStorage(설정 키) |
| 인벤토리 (`I`)·낚시 | 기본 낚싯대 장착·지역별 낚시·개별 크기 유지·분리수거 | 사용자 ID별 localStorage |
| 코코 알림 | 마을에 들어오고 6.5초 뒤 로그인당 1번, 고정 문구. 누르면 코코 대화창 | — |

- 투어 중이거나 내 방 튜토리얼 중에는 휴대폰·인벤토리 버튼을 숨기고 지도·인벤토리 키도 막는다(튜토리얼 흐름 보호).
- 대화창(NPC·코코·이장)이 떠 있으면 지도 키를 무시하고, 휴대폰·지도·인벤토리가 떠 있으면 캐릭터가 움직이지 않는다. 낚시 중에도 이동은 막지만 상호작용 키는 유지한다.
- 화질·로그아웃 버튼은 HUD에서 빼고 휴대폰 → 설정으로 옮겼다. 시점 초기화(↺) 버튼은 HUD에 그대로 있다.
- **대화 내용·알림 내용은 어디에도 저장하지 않는다.** localStorage `sw_ui_settings_v1`에는 `north·quality·bindings·muted`만. 낚시 아이템·안내 진행은 사용자 ID별 별도 키에 저장한다.
- 코코 알림을 끄려면 `ui.js` 위쪽 `COCO_NOTICE.enabled = false`.

PR #13 시연본과 달라진 점: 예시 데이터(동아리 3개·미션 3개·추천 3개) → 실제 DB, NPC 채팅 화면(입력 막힘) → 앱의 대화창,
"알림 시연" 버튼 → 마을 입장 후 자동 1회, 시연용 미션 자동 완료(공원 도착 등) → 없음.

## 4. 앱과 이어지는 곳

`app.js`가 `WorldUI.init(host)`로 넘기는 것: `sb`, `userId`, `nickname`, `feedback`, `npcs`, `busy`(대화창 열림), `openNpc`, `teleport`, `openMissionRoom`, `openClubRoom`, `logout`, `toast`, `onKeysChanged`.
`app.js`가 부르는 것: `attach(engine)`(3D 시작 때), `sync({inVillage, tour, roomBusy})`(HUD 갱신 때), `isOpen()`(입력 막기), `keyLabel(action)`(HUD 키 표시), `reset()`(로그아웃).

낚시 연결: `tick()`(상태 갱신), `target()`(물가 상호작용 대상), `interactFishing()`(던지기·낚아채기), `isFishing()`(이동 차단), `cancelFishing()`(순간이동·중단). `attach()`는 로그인한 사용자 ID가 바뀌면 기존 낚시 기능을 해제하고 새 인벤토리를 연결한다.

## 5. 맵·장소 추가 가이드 (2026-10-06)

고치는 곳은 이 폴더(`app/`)뿐이다. 고친 뒤 `python social_world/app/bundle.py`로 `../socialworld-demo.html`을 다시 만든다.

### 5-1. 작업별로 고칠 파일

| 하고 싶은 것 | 파일 | 위치 |
|---|---|---|
| 길·호수·나무·소품 추가 | `world-engine.js` | `build()` 안. 길은 `PATHS`, 산책로 구역은 "넓어진 마을" 블록 |
| 새 건물·장소 추가 | `world-engine.js` | `build()` 안에 모양 + `places.○○`(서는 자리) + `colliders`(못 지나가는 곳) + `doors.push(...)`(E키로 들어가는 문) |
| 그 장소에 들어갔을 때 동작 | `app.js` | 문 동작 분기(`id === "club"` 근처), 준비 중 안내 문구 목록(`cafe: "☕ 카페 안은…"`) |
| 루미 투어에 장소 추가 | `app.js` | 투어 장소 목록(`cafe: { label:"카페", go:… }` 근처) |
| NPC 추가 | `world-engine.js` + `app.js` | 엔진 `NPC_LOOK`(모습·위치), 앱 `NPCS`(이름·대사) |
| 미니맵 표시 | `world-engine.js` | `MAP_BUILD`(건물 네모), `MAP_AREA`(구역 이름), `NPC_DOT`(NPC 점 색) |
| 전체 지도(M) 장소 버튼 | `ui.js` | `MAP_POINTS`(이름표 위치), 엔진 `places()`에 없는 장소는 `EXTRA_SPOTS` |
| 휴대폰·설정·알림 화면 | `ui.js`, `ui.css` | |
| 로그인·대화창·HUD 스타일 | `world.css` | |
| 하늘·빛·날씨 | `world-engine.js` | `build()` 앞 "하늘·빛"과 해·구름 블록, 후처리 `finalMat` |

### 5-2. 맵을 넓힐 때 함께 맞출 값

하나라도 빠지면 못 걷거나 지도가 어긋난다.

| 값 | 파일 | 하는 일 |
|---|---|---|
| `VB` | `world-engine.js` | 걸을 수 있는 범위 |
| `buildGrid()`의 `x0, z0, nx, nz` | `world-engine.js` | 자동 길찾기 격자 — `VB`를 덮어야 한다 |
| 땅 크기 `G` | `world-engine.js` | 땅이 덮는 범위 |
| `MAP_B` | `world-engine.js` | 미니맵·전체 지도 그림 범위 |
| `mapPct`(`+58, /116, +34, /92`) | `ui.js` | 전체 지도 위치 계산 — **`MAP_B`와 숫자가 같아야 한다** |
| `RX, RZ` | `world-engine.js` | 내 방 실내 위치 — 넓힌 맵과 겹치지 않게 멀리 |

### 5-3. 주의할 점

- **나무·풀 위치는 난수(`rnd()`) 순서로 정해진다.** `build()` 앞부분에 `rnd()`를 쓰는 코드를 새로 넣으면 뒤쪽 나무·풀 위치가 전부 바뀐다. 새 장식은 따로 난수를 만들어 쓴다(예: 해·구름 블록의 `const rnd = (() => { let q = 7177; … })()`).
- **기존 건물·NPC 좌표는 옮기지 않는 게 좋다.** 튜토리얼 동선, 루미 투어, 코코·이장 위치와 연결돼 있다. 옮겼다면 아래 테스트로 투어·코코·이장이 제자리에 서는지 확인한다.
- `MAP_POINTS`의 x,z는 지도 위 이름표 위치이고, 실제로 서는 자리는 엔진 `places()`(없으면 `EXTRA_SPOTS`)다.

### 5-4. 확인 순서

```bash
python social_world/app/bundle.py
python social_world/app/tests/ui_test.py      # 휴대폰·지도·설정 80항목
python social_world/coco/tests/demo_test.py
python social_world/chief/tests/demo_test.py
```

bundle 없이 바로 보려면 `social_world` 폴더에서 `python -m http.server` → `http://localhost:8000/app/`.


## 6. 낚시 수정본 병합 (2026-10-06)

- 기준: `social-world-main (7).zip`. 낚시 기능: `social-world-main-fishing-guide-fixed.zip`.
- `(7)`의 맑은 하늘·해·구름·빛·후처리, 맵 범위, 나무·풀 난수 순서, 건물·NPC 좌표와 위 맵 가이드를 유지했다.
- 낚시 모듈·인벤토리·입질 효과음과 앱/엔진/UI 연결만 반영하고, `bundle.py`로 배포용 HTML을 재생성했다.
- 분수대 접근 안내 숨김, 아이템 3회 획득 후 안내 자동 종료, `안내 끄기`, 계정별 안내 상태 유지, 물고기 순번 표시 제거를 포함한다.
- 낚시 위치·확률·저장 방식·검증 실행 환경은 `FISHING-GUIDE.md`, 이번 병합 파일 목록과 검증 결과는 프로젝트 루트 `MERGE-NOTES.md`를 참고한다.
