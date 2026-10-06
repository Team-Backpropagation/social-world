# 최신 main에 병합한 인벤토리·낚시

기준은 `social-world-main (7).zip`의 `social_world/app/`입니다. `social-world-main-fishing-guide-fixed.zip`에서 낚시 관련 소스 변경만 병합했습니다. `(7)`의 맑은 하늘·해·구름·빛·후처리와 맵 가이드는 그대로 보존했고, 배포용 HTML은 병합된 소스로 새로 생성했습니다.

## 실행 및 적용

병합 ZIP에는 `(7)` 기준 전체 프로젝트가 들어 있습니다. 압축을 풀고 `social-world-main` 폴더에서 아래 명령을 실행합니다. 기존 프로젝트에 적용할 때는 `MERGE-NOTES.md`의 변경 파일 목록을 기준으로 반영합니다.

```bash
python social_world/app/bundle.py
```

실행 파일은 `social_world/socialworld-demo.html`입니다. 이번 ZIP에는 재생성한 파일도 들어 있습니다. 원래 main과 동일하게 로그인과 Supabase 연결을 사용합니다. CDN과 DB 연결을 위해 인터넷이 필요합니다.

I → 기본 낚싯대 장착 → 물가로 이동 → E로 던지기 → 찌가 흔들리며 잠기면 E로 낚아채기. 상호작용·인벤토리 키는 휴대폰 설정에서 바꿀 수 있습니다. 모바일에는 인벤토리 버튼과 기존 상호작용 버튼을 연결했습니다.

## 낚시 안내 수정 (2026-10-06)

- 물고기 상세 목록에서 `N번째 물고기` 표시를 제거했습니다. 개별 크기·획득 장소·날짜는 유지합니다.
- 낚싯대를 들고 분수대에 접근해도 안내창이나 낚시 시작 힌트를 표시하지 않습니다. E키를 직접 누르면 분수대 낚시는 계속 가능합니다.
- 낚시로 아이템을 3번 획득하면 안내창을 자동 종료합니다. 물고기·동전·쓰레기 획득을 모두 포함하고, 취소·놓친 입질은 세지 않습니다.
- 안내창 오른쪽 위의 `안내 끄기`로 언제든 안내를 종료할 수 있습니다. 진행 중인 낚시는 계속됩니다.
- 안내 횟수와 끄기 상태는 사용자별로 인벤토리 저장 키 뒤에 `:guide`를 붙여 저장합니다. 새로고침 후에도 유지되며, 다른 사용자의 안내에는 영향을 주지 않습니다.
- 안내 종료 후에도 낚시 동작·상호작용 버튼·찌 흔들림과 입질 효과음은 유지됩니다.

## main 구조 분석과 병합 위치

| 파일 | 역할 및 연결 |
|---|---|
| `app.js` | 기존 로그인·온보딩·루미 투어·NPC 대화·DB 기능. 엔진의 tick·target·action을 WorldUI의 낚시 API에도 전달합니다. 기존 투어 tick을 계속 실행합니다. |
| `ui.js` | 휴대폰·지도·설정, 공통 overlay와 키 처리. 사용자 ID에 맞는 낚시 기능 생성·해제, I 키와 튜토리얼 중 열기 제한을 추가했습니다. |
| `ui.css` | 기존 UI 스타일에 인벤토리·낚시 상태 스타일을 추가했습니다. |
| `world-engine.js` | 최신 main의 3D 마을·캐릭터·동행 펫·이동·지도를 사용합니다. 낚싯대·원형 찌·줄·물결, 입질 흔들림과 낚시 중 이동 차단을 추가했습니다. 캐릭터 외형 변경 시 낚싯대를 새 캐릭터에 다시 붙입니다. |
| `fishing-data.js` | 물 영역, 지역별 획득 목록·확률, 물고기 크기 범위, 분리수거 분류, 낚시 시간 설정. |
| `inventory.js` | 개별 아이템 저장·종류별 묶음·장착·분리수거. 물고기마다 ID·크기·장소·획득 시간을 보관합니다. |
| `fishing.js` | 인벤토리 화면과 낚시 상태 처리. `대기 → 입질` 전환에서 효과음을 한 번 호출합니다. |
| `sounds.js` | 기존 효과음 등록·재생 함수. `fishingBite`에 첨부 MP3를 등록했습니다. |
| `assets/universfield-bubble-pop-293342.mp3` | 첨부한 입질 효과음 원본. 이름과 바이트를 그대로 포함했습니다. |
| `index.html` | fishing-data → inventory → fishing → ui → app 순으로 로컬 스크립트를 불러옵니다. |
| `bundle.py` | 최신 main의 번들 방식을 그대로 사용합니다. 새 JS와 입질 MP3도 최종 HTML 안에 포함합니다. |

코코·이장 스크립트는 원래 `../coco/coco.js`, `../chief/chief.js` 경로를 그대로 사용합니다. 낚시를 추가하기 위해 미션·동아리 예시 데이터를 덮어쓰지 않았으며, main의 실제 DB 연결을 유지했습니다.

저장소의 `database/`, `data_preprocessing/`, `risk_agent/`, `docs/`, React 프로토타입과 컨셉아트 키트는 변경하지 않았습니다.

## 지역별 획득

| 지역 | 일반 | 낮은 확률 | 쓰레기 |
|---|---|---|---|
| 강 | 피라미 70% | 메기 20% | 빈 페트병·종이상자 합계 10% |
| 공원 연못 | 각시붕어 70% | 미꾸라지 20% | 유리병·종이상자 합계 10% |
| 호수 | 붕어 70% | 잉어 20% | 빈 음료 캔·빈 페트병 합계 10% |
| 분수대 | 닥터피쉬 55% | 작은 동전 30% | 병뚜껑·젖은 쪽지 합계 15% |

동전은 수집품이며 화폐 수치로 환산하지 않습니다. 분수대는 지도에 낚시 표시를 추가하지 않았습니다. 쓰레기는 인벤토리에서 분류에 맞는 수거함을 골라 처리합니다. 잘못된 수거함을 고르면 아이템이 유지됩니다.

## 저장과 중단 조건

인벤토리는 `social-world-inventory-v1:<로그인한 사용자 ID>`로 **현재 브라우저**에 저장합니다. 닉네임이 같아도 사용자 ID가 다르면 서로 다른 인벤토리입니다. 새 사용자는 기본 낚싯대 한 개를 받습니다. 이 버전은 인벤토리용 DB 테이블이나 기기 간 동기화를 추가하지 않았습니다.

휴대폰·지도·인벤토리·NPC 대화가 열리거나, 순간이동·실내 진입·로그아웃·창 전환이 발생하면 진행 중인 낚시를 취소합니다. 투어와 방 튜토리얼 중에는 인벤토리를 열 수 없습니다. 낚시하는 동안 자동 코코 알림은 잠시 미뤄집니다.

## 효과음 확장

```js
// sounds.js: 이름과 파일 등록
Sound.register('fishingBite', 'assets/universfield-bubble-pop-293342.mp3');

// fishing.js: 입질 시작 순간에만 호출
Sound.play('fishingBite');
```

다른 효과음도 `assets/`에 두고 이름으로 등록한 뒤 필요한 이벤트에서 호출하면 됩니다. 알림 문구 표시와 효과음 재생은 분리되어 있습니다. 휴대폰 효과음 끄기는 입질 소리에도 적용됩니다.

## 검증

`tests/fishing_test.cjs`는 Node와 Playwright로 실행하며, Supabase를 가짜 클라이언트로 대체합니다. 실제 팀 DB에 쓰지 않습니다. PC·모바일의 모듈 실행과 PC 번들 실행에서 입질 MP3 재생·중복 방지, 개별 크기, 계정별 저장, 패널 및 순간이동 시 취소, 기존 미션·동아리·NPC 흐름을 확인합니다.

기존 `tests/ui_test.py`, 코코·이장 테스트는 그대로 보존했습니다. Python 테스트에는 Python `playwright` 패키지와 Chromium이, 낚시 테스트에는 Node `playwright` 패키지와 Chromium이 필요합니다.

```bash
python social_world/app/bundle.py
python social_world/app/tests/ui_test.py
python social_world/coco/tests/demo_test.py
python social_world/chief/tests/demo_test.py
node social_world/app/tests/fishing_test.cjs
```

낚시 테스트는 `SW_CHROME_PATH`로 설치된 Chrome 실행 파일을 선택할 수 있습니다. 기본값은 Playwright Chromium입니다. `SW_THREE_PATH`를 지정하면 앱과 같은 버전의 로컬 `three.min.js`로 CDN을 대체합니다. Node Playwright가 별도 경로에 있으면 `SW_PLAYWRIGHT_PATH`를 지정합니다. 이번 병합에서 실제 실행한 결과는 `tests/FISHING-VALIDATION.txt`와 프로젝트 루트 `MERGE-NOTES.md`에 있습니다.
