# social-world-main (7) + fishing-guide-fixed 병합 기록

병합 날짜: 2026-10-06

기준 프로젝트는 `social-world-main (7).zip`이며, `social-world-main-fishing-guide-fixed.zip`의 낚시·인벤토리 기능을 `social_world/app/README.md` 구조에 맞춰 병합했다. 원본 ZIP은 수정하지 않았다.

## 병합 방식

낚시 수정본은 `(6)` 기반이므로 앱 전체를 덮어쓰지 않았다. `(7)`의 소스에 낚시 변경만 반영하고 `social_world/app/bundle.py`로 배포용 `social_world/socialworld-demo.html`을 재생성했다.

- `(7)`의 맑은 하늘, 해·구름, 안개·광원·후처리 설정을 유지했다.
- 마을 범위, 길찾기 격자, 지도 좌표 변환, 건물·NPC·실내 위치와 기존 나무·풀 난수 순서를 유지했다.
- `app/README.md` 5장의 최신 맵·장소 추가 가이드는 원문 그대로 보존했다.
- 코코·이장 소스와 기존 테스트, DB·데이터 전처리·risk_agent·React 앱·컨셉 자료 등 앱 외 기존 파일을 유지했다. 배포용 HTML만 병합된 앱 소스에서 다시 생성했다.

## 변경 파일

| 파일 (`social_world/app/` 기준) | 반영 내용 |
|---|---|
| `app.js` | 기존 tick에 낚시 갱신 연결, 물가 상호작용 대상·입력 차단·순간이동 취소 연결 |
| `world-engine.js` | 낚싯대·찌·낚싯줄·물결, 낚시 중 이동 차단, 캐릭터 외형 변경 시 낚싯대 재연결 |
| `ui.js` | 사용자 ID별 낚시 기능 생성·해제, 인벤토리 키·설정 마이그레이션, 패널·튜토리얼·알림 연결 |
| `ui.css` | 인벤토리·낚시 안내 스타일 추가; 추가 부분의 줄바꿈·들여쓰기 정리 |
| `sounds.js` | `fishingBite` 입질 효과음 등록 |
| `index.html` | `fishing-data.js → inventory.js → fishing.js → ui.js → app.js` 순서 연결 |
| `README.md` | 최신 맵 가이드 보존, 낚시 파일·스크립트 순서·저장·검증·병합 설명 추가 |

## 추가 파일

| 파일 (`social_world/app/` 기준) | 역할 |
|---|---|
| `fishing-data.js` | 물 영역·지역별 아이템·확률·물고기 크기·분리수거 분류 |
| `inventory.js` | 개별 아이템 저장·장착·묶음 표시·분리수거 |
| `fishing.js` | 인벤토리 화면·낚시 상태·안내 진행·중단 처리 |
| `assets/universfield-bubble-pop-293342.mp3` | 원본 입질 효과음 |
| `FISHING-GUIDE.md` | `(7)` 기준 사용·구조·확률·검증 안내 |
| `tests/fishing_test.cjs` | 데스크톱·모바일 모듈 및 데스크톱 번들의 낚시 통합 검증 |
| `tests/FISHING-VALIDATION.txt` | 이번 병합본에서 실제 실행한 낚시 테스트 결과 |
| `tests/REGRESSION-VALIDATION.txt` | 기존 UI·코코·이장 테스트 실행 결과 |

프로젝트 루트에는 이 병합 기록 `MERGE-NOTES.md`를 추가했다.

## 포함된 낚시 안내 수정

- 물고기 상세 화면의 `N번째 물고기` 표시는 제거하고 개별 크기·획득 장소·날짜는 유지했다.
- 분수대에 접근할 때 안내·낚시 시작 힌트는 숨기고 상호작용으로 낚시하는 기능은 유지했다.
- 아이템 획득 3회 후 안내를 자동 종료한다. 취소·놓친 입질은 횟수에 포함하지 않는다.
- `안내 끄기`로 진행 중 낚시를 유지하면서 안내만 종료할 수 있다.
- 인벤토리와 안내 상태는 사용자 ID별로 현재 브라우저에 저장한다. 새 DB 테이블이나 기기 간 동기화는 추가하지 않았다.

## 실행

ZIP을 풀고 `social-world-main` 폴더에서 실행한다.

```bash
python social_world/app/bundle.py
python -m http.server 8000 --directory social_world
```

브라우저에서 `http://localhost:8000/app/` 또는 `http://localhost:8000/socialworld-demo.html`을 연다. 로그인·DB 연결은 기존 앱 방식이다.

인벤토리 `I` → 기본 낚싯대 장착 → 강·공원 연못·호수 물가 → 상호작용 `E` → 찌가 잠기면 다시 `E`. 키는 휴대폰 설정에서 변경할 수 있다.

## 검증

| 검증 | 결과 |
|---|---|
| 낚시 통합 (`tests/fishing_test.cjs`) | 135개 항목 통과 |
| 기존 UI | 80개 항목 통과 |
| 코코 | 34개 항목 통과 |
| 마을이장 | 42개 항목 통과 |
| JavaScript 소스 | 앱·낚시 테스트 소스 8개 문법 검사 통과 |
| 생성된 HTML | 인라인 스크립트 9개 문법 검사 통과 |
| 번들 일치 | `bundle.py`가 생성하는 내용과 배포용 HTML 일치 |
| 효과음 | 번들에 포함된 3개 효과음 등록의 MP3 바이트가 소스와 일치 |
| 원본 보존 | 앱 외 기존 파일, 기존 테스트, 최신 맵 가이드 보존 확인 |

브라우저 검증 총 **291개 항목 통과**. Supabase는 테스트용 가짜 클라이언트로 대체했다.

낚시 테스트는 제공된 테스트의 `__SW_LITE` 모드에서 PC(1280×820)·모바일(390×800) 모듈 실행과 PC 번들 실행을 확인했다. 기존 UI·코코·마을이장 Python 테스트는 원본을 변경하지 않고 PC·모바일에서 실행했다. 이 컴퓨터의 설치된 Chrome을 선택하는 작업용 실행 래퍼만 사용했으며, 앱에는 포함하지 않았다. CDN 대신 앱과 같은 버전의 로컬 three.js 0.149.0을 사용했다.

이번 실행의 원문 결과는 `social_world/app/tests/FISHING-VALIDATION.txt`와 `social_world/app/tests/REGRESSION-VALIDATION.txt`에 있다. 낚시 수정본에 있던 이전 검증 로그는 복사하지 않고 이번 실행 결과로 기록했다.

## 전달 파일 구성

기존 파일 수정 8개, 새 파일 9개. 전체 프로젝트 구조를 유지하며 테스트용 다운로드·실행 래퍼·임시 캡처·Python 캐시는 제외했다.

낚시 테스트는 `SW_THREE_PATH` 없이도 앱의 CDN으로 실행할 수 있게 정리했다. 오프라인 검증에서는 이 환경 변수를 지정하며, 설치된 Chrome은 `SW_CHROME_PATH`로 선택할 수 있다.
