# 후보: Claude — Kenny1 (Cartoon + Kenney 에셋)

`claude_cartoon` 후보의 사본에 `social_world/kenney_asset`의 Kenney 에셋(**CC0 1.0**, www.kenney.nl)을 얹은 버전이에요.
원본 데모와 Cartoon 후보는 그대로예요.

| 파일 | 설명 |
|---|---|
| `socialworld-demo_kenny1.html` | **데모 사본**: 로그인·튜토리얼·투어·대화 전체에 적용 (약 4.4MB — 에셋을 파일 안에 담아서 이 파일 하나로 열림) |
| `concept_claude_kenny1.html` | 키트 후보: 9장면 비교·캡처용 |
| `Claude_Kenny1_<장면>.png` ×9, `Claude_Kenny1_9장면.png` | 기본 각도 캡처 |

## 킷별 적용
| 킷 | 적용 | 쓴 모델 |
|---|---|---|
| modular-buildings | 강 건너 **배경 마을**(걸어갈 수 없는 곳) | building-sample-house-a/b/c, building-sample-tower-a |
| city-kit-suburban | 배경 마을 집, **동·서 가장자리 이웃집 4채** + 낮은 울타리, 강가 나무 줄, 지원센터 앞 화분 | building-type-a/c/f/k/o, tree-large/small, fence-low, planter |
| cube-pets | 카페 고양이, 공원 토끼, 텃밭 병아리 2, 내 집 강아지 — **제자리 애니메이션** | animal-cat/bunny/chick/dog |
| mini-characters | 말 걸 수 없는 **배경 주민 3명** (제자리 애니메이션) | character-female-b/d, character-male-c |
| food-kit | 카페 야외 테이블(커피·컵케이크·크루아상), **공원 소풍 돗자리**(샌드위치·사과·수박·빵) | cup-coffee, cupcake, croissant, sandwich, apple, watermelon, loaf-round |
| holiday-kit | 공원·내 집 가는 길 **등불 4개**, 공원 바위 | lantern, rocks-large/medium |
| furniture-kit | **내 방** 뒷벽 소파·플로어 스탠드·화분, 책상 위 라디오·책 | loungeSofa, lampRoundFloor, pottedPlant, radio, books |
| 3d-road-tiles | 쓰지 않음 — 차도용 타일이라 보행자 마을 길과 맞지 않음 | |
| coaster-kit | 쓰지 않음 — 롤러코스터라 마을 규모·분위기와 맞지 않음 | |

- 모델은 킷 색상표를 그대로 읽은 뒤 **툰 셰이딩 + 외곽선**을 입혀 Cartoon 톤에 맞춤
- 모델은 원래 동선(길·문·투어 경로)을 피한 자리에 두고, 걸어 다니는 영역 밖이거나 작은 소품 위주
- 주인공·NPC(루미·하루·이장 등) 캐릭터는 그대로. Kenney 캐릭터는 배경 주민에만 사용

## 2차: 기능 건물도 Kenney 에셋으로 교체
건물 크기 제약은 풀었고, **문 앞 위치(places)·간판·투어 동선은 그대로** 두어 기능은 똑같이 동작해요.
메인 기능 건물마다 한눈에 구분되는 표식을 하나씩 붙였어요.

| 건물 | 조합 | 알아보기 쉬운 표식 |
|---|---|---|
| **지원센터** | modular `building-sample-tower-b`(가운데, 마을에서 가장 높음) + 양옆 `building-sample-house-a` 날개, 민트 | 기존 **기둥 현관·박공**, 현관 위 **'지원센터' 간판**, 높은 **깃대**, 넓은 기단 |
| **미션방** | suburban `building-type-s`, 코랄 지붕 | 앞마당에 **지붕 달린 '단계별 퀘스트' 게시판**(깃발 포함) |
| **동아리센터** | modular `building-sample-house-c`, 라일락 지붕 | 앞마당 **삼각 깃발 줄**(여러 색), 굴뚝 연기 |
| **카페** | suburban `building-type-g`(단층), 핑크 지붕 | 줄무늬 **차양 + '카페' 간판**, 야외 테이블 |
| **내 집** | suburban `building-type-t`, 하늘색 지붕 | 문 앞 꽃밭, '내 집' 표지판 |
| 게임방 | 기존 줄무늬 천막 유지 | 천막 자체가 가장 눈에 띄어서 그대로 둠 |

### 색 맞추기
Kenney 색상표를 **카툰 데모 팔레트로 다시 칠했어요**.
- suburban: 초록 지붕 → 건물별 색(민트·코랄·라일락·핑크·하늘·오렌지), 흰 벽 → 크림
- modular: 짙은 회색 지붕 → 건물별 색, 황토 벽 → 옅은 파스텔(민트·라일락·피치·하늘), 초록 차양 → 포인트색
- 나무·화분: Kenney 청록 → 카툰 초록
- 배경 마을·이웃집도 같은 팔레트에서 골라 번갈아 칠함

## 확인
데모 사본으로 전체 자동 테스트(튜토리얼 → 8곳 도보 투어 → 이장 인사 → 루미 대화 → 자유 시점 → 모바일) 통과, 콘솔 오류 없음.
파일이 커서 처음 열 때 몇 초 더 걸려요.

## v3 변경 (2026-10-01)
- **캐릭터**: Kenney 사람형 캐릭터(mini-characters)는 분위기와 안 맞아서 뺐어요 → 플레이어·루미·NPC·주민은 카툰 캐릭터 그대로. 동네 강아지만 Kenney cube-pets.
- **지원센터**: 타워 양옆 작은 집 2채 삭제, 받침도 타워 폭에 맞춤. 깃대는 타워 앞 오른쪽 모서리 바로 옆으로 옮김.
- **색**: 바랜 파스텔 → 선명하지만 눈 편한 카툰 팔레트(ACES 톤매핑 대신 색상 유지형 하이라이트 압축). Kenney 벽은 지붕색이 살짝 도는 밝은 색.
- **형태**: 공·원기둥·원판(광장·분수·연못·호수·풀 둔덕·꽃·구름·해 등) → 모서리 둥근 네모. 게임방은 줄무늬 사각뿔 지붕 파빌리온.
- **외곽선**: 모서리 법선을 합쳐 끊김 없이, 모델 크기·카메라 거리 보정으로 굵기 고르게, 바람에 흔들리는 잎과도 맞게.
- **원본 데모와 같이**: 좌측 상단 원형 미니맵, 넓어진 마을(호수·숲길·들판·꽃 언덕).
- 자동 기능 테스트 25항목 통과.
