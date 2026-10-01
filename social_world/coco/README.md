# 코코 v1 — 활동 추천 NPC

동아리센터 앞에서 관심사·동네·오늘 기준으로 활동 3개를 추천한다. LLM과 자유 입력 없이 규칙으로만 동작한다.
설계: `docs/planning/소셜월드_게임흐름_NPC_설계.md` 3-4·6절.

## 파일

| 파일 | 하는 일 |
|---|---|
| `database/04_coco.sql` | 동아리 관심사 태그, 활동 목록(`activity_catalog`) + 시연용 시드 10개, `my_quest_stage()`, `recommend_activities()` |
| `social_world/coco/coco.js` | 대화창과 추천 카드. 프레임워크 없이 `Coco.open({...})`로 연다 |
| `social_world/coco/coco-preview.html` | DB 없이 화면만 확인하는 미리보기(가짜 supabase) |
| `database/tests/run_coco.sh` | 04를 로컬 PostgreSQL에서 검증(20항목 — 수요 로그 칸 이름 포함) |
| `social_world/coco/tests/ui_test.py` | 미리보기로 화면 흐름 검증(데스크톱·모바일 38항목, Playwright) |
| `social_world/coco/tests/demo_test.py` | 3D 데모에 붙인 코코 검증 — 배치·E키·추천·수요 로그·동아리센터 이동(데스크톱·모바일 36항목, 가짜 supabase) |

## 적용 순서

1. 팀 Supabase에 `03_world_update.sql`이 적용됐는지 확인한다. `profiles.interests`, `missions.stage`가 03에서 생긴다
2. SQL Editor에서 `04_coco.sql` 실행(여러 번 실행해도 안전)
3. 데모는 이미 연결돼 있다(2026-10-01). 03·04 적용 전에는 코코가 "지금은 목록을 못 불러왔어"로 안내만 한다

### 데모에 붙인 방식 (`socialworld-demo.html`)

| 위치 | 내용 |
|---|---|
| `<script src="coco/coco.js">` | 본문 스크립트 바로 앞. **파일 연결 방식** — 개발 중엔 코코 코드가 `coco.js` 한 곳에만 있다. 배포 때 한 파일로 합치는 스크립트는 에이전트 구현이 끝난 뒤 만든다 |
| `NPCS` 끝 `{ id:"coco", noSignal:true, external:true }` | 이름표·HUD("코코 — 대화하기 (E)")용. 대본 트리 없음 |
| 3D `places.coco` · `NPC_LOOK.coco` | 동아리센터 문 왼쪽(문과 4.2 떨어져 E키 대상이 겹치지 않음). 초록 모자 + 빨간 공 |
| `openNpc("coco")` → `openCoco()` | `Coco.open({ sb, onOpenClub, onClose })`. 이미 열려 있으면 다시 열지 않음 |
| `onOpenClub` | 코코 창을 닫고 기존 `loadClubRoom()`으로 동아리센터 화면 이동 |
| `worldBlocked()` | `.coco-backdrop`이 떠 있는 동안 걷기·E키를 막음 |

코코 대화는 `npc_sessions`(위험 신호)에 남지 않는다. 수요 신호만 `npc_demand_logs`에 남는다.

## 점수 규칙

| 항목 | 점수 |
|---|---|
| 관심사 | 겹치는 태그 1개당 3점(최대 6) |
| 퀘스트 단계 | 지금 단계 3 / 한 단계 위 2 / 지난 단계 1 / 두 단계 이상 위 0 |
| 오늘(오늘 모드만) | 오늘 열림 3 / 상시 1 |

거르기: 이미 가입한 동아리, 다른 지역 오프라인 활동. "우리 동네" 모드는 내 지역 오프라인만, "오늘" 모드는 다른 요일 활동을 뺀다.

## 확인이 필요한 것

- ~~수요 기록 칸 이름~~ → 10/1 수정: 03의 칸은 `item_id`라 `item_key`로 넣던 것을 고쳤다. `run_coco.sh`가 03 정의로 직접 넣어 보고 확인한다. 기록이 실패해도 화면은 멈추지 않고 콘솔에 경고만 남긴다
- **수요 로그 category**: 지금은 `club`/`activity`(카드 종류). 03 주석은 관심사 태그(운동·독서…)를 예로 든다. 관심사별 수요를 보고 싶으면 `recommend_activities()`가 태그를 함께 돌려주게 바꿔야 한다(반환 칸이 바뀌므로 함수 drop 후 재생성)
- **시연용 활동 10개는 가상 항목**이다(`source='demo'`, 신청 링크 없음). 실제 공고로 바꿀 때 `source='official'`, `apply_url`, `source_note`를 채운다
- **동아리 태그**: 기존 동아리는 `category`로 한 번 채웠다(체육→운동, 공연→음악 등). 매핑되지 않은 동아리는 관심사 점수가 0이다. 동아리 개설 화면에 관심사 선택을 넣으면 좋다
- **이장 이벤트 연동은 아직 없다.** 마을이장 v1을 만들 때 `world_events_public`의 칸을 확인하고 추천 후보에 넣는다
- 퀘스트 단계 규칙("완료한 가장 높은 단계 + 1")은 임시 규칙이다

## 테스트 실행

```bash
bash database/tests/run_coco.sh                    # PostgreSQL 15+ 필요
python social_world/coco/tests/ui_test.py          # 미리보기
python social_world/coco/tests/demo_test.py        # 3D 데모 (WebGL 소프트웨어 렌더링이라 1~3분)
# three.js CDN에 못 붙는 환경: SW_THREE_PATH=경로/three.min.js python social_world/coco/tests/demo_test.py
```
