# 버스·이음 시장 1차 구현

2026-10-06. 바탕화면의 현재 social-world-main을 기준으로 작업했다.

요청 범위: 기존 마을에 버스 정류장과 왕복 이동 연출 추가, 별도 시장에 은행·옷가게 배치, 건물에 입장해서 이용 화면 보기. 사용자가 선택한 1차 범위에 맞춰 입출금·구매·가챠·거래·멀티플레이는 구현하지 않았다.

## 확인하는 방법

기존 방식으로 로그인한 뒤 지도 M → 시장행 버스 → 정류장 앞 상호작용 E.

버스가 도착하고 캐릭터가 올라탄다. 버스 출발 뒤 검은 화면으로 전환되고, 시장 정류장에 도착해 캐릭터가 내려온다. 시장에서 같은 방법으로 버스를 부르면 마을로 돌아간다. 상호작용 키는 기존 휴대폰 설정을 따른다.

시장 지도 M에서 이음 은행·오늘의 옷장 앞으로 이동할 수 있다. 문 앞에서 E로 들어가고, 안내 창구·진열대에 다가가 다시 E를 눌러 이용 화면을 연다. Esc 또는 계속 둘러보기로 닫고 실내 출구에서 E로 나간다.

## 구현과 보존

- market-world.js: 별도 시장·실내·버스 모델, 7단계 이동 연출, 별도 충돌·지도.
- market.js/market.css: 버스 진행 안내와 화면 전환, 키보드로 닫고 이동할 수 있는 은행·옷가게 이용 화면.
- world-engine.js: 기존 월드와 시장의 장면 표시 전환, 실내 시점·이동 범위, 정류장 상호작용과 버스 갱신 연결.
- app.js: market/market-bank/market-clothing 분기, 버스 상태에 따른 입력 차단, 미션·동아리 화면의 시장 귀환.
- ui.js: 기존 마을 지도에 정류장 추가, 별도 시장 지도와 실내 현재 위치 표시.
- index.html: 새 로컬 소스·스타일 연결. socialworld-demo.html은 bundle.py로 재생성.
- 기존 건물·NPC·내 방 좌표·하늘·낚시 저장 키·DB·risk_agent·코코·이장 원본은 유지한다.
- 새 도로·승강장 안의 풀과 작은 꽃만 정리한다. 기존 난수 순서는 바꾸지 않는다.

참고 문서는 검토 중인 기획 자료로 사용했고, 문서에 있는 미확정 경제·거래 규칙을 구현 명세로 취급하지 않았다. 참고 영상은 [Pokemon Heart Gold Train Scene](https://www.youtube.com/watch?v=sC7i7vfTjeE). 영상 자산을 가져오지 않고 기존 데모와 어울리는 버스·장면을 직접 구성했다.

## 검증

| 검증 | 결과 |
|---|---|
| 버스·시장·은행·옷가게 | 124개 항목 통과 |
| 기존 낚시 | 135개 항목 통과 |
| 기존 휴대폰·지도·설정 | 80개 항목 통과 |
| 코코 연결 | 34개 항목 통과 |
| 마을이장 연결 | 42개 항목 통과 |
| 소스·생성된 HTML | JavaScript 문법 검사, 인라인 스크립트 11개, bundle.py 결과 일치 확인 |
| 효과음·원본 보존 | MP3 바이트와 앱 외 기존 파일 보존 확인 |

브라우저 검증 총 **415개 항목 통과**. Supabase는 가짜 클라이언트로 대체했고 실제 DB에는 쓰지 않았다.

새 시장 테스트는 PC·모바일의 나눠진 소스 실행과 생성된 HTML 실행, 모바일의 동작 줄이기 설정을 확인했다. 시장·낚시 Node 테스트는 제공된 경량 모드로, 기존 UI·코코·이장 Python 테스트는 기본 장면에서 실행했다. 테스트 환경은 설치된 Chrome과 로컬 three.js 0.149.0이다.

기존 UI 테스트의 지도 장소 수는 정류장 추가에 맞춰 12→13으로 갱신했다. 낚시 테스트는 찌가 잠길 때까지 실제 상태를 기다리도록 고정 대기를 보완했다. 게임의 낚시 시간·확률은 수정하지 않았다.

원문 검증 결과: tests/MARKET-VALIDATION.txt, tests/FISHING-VALIDATION.txt, tests/REGRESSION-VALIDATION.txt.

## 파일 적용

수정 10개, 추가 6개. 기존 파일은 덮어쓰기 전에 별도 백업 ZIP으로 보관한다.

수정 파일:

- social_world/app/app.js
- social_world/app/FISHING-GUIDE.md
- social_world/app/index.html
- social_world/app/README.md
- social_world/app/tests/fishing_test.cjs
- social_world/app/tests/REGRESSION-VALIDATION.txt
- social_world/app/tests/ui_test.py
- social_world/app/ui.js
- social_world/app/world-engine.js
- social_world/socialworld-demo.html

추가 파일:

- social_world/app/MARKET-NOTES.md
- social_world/app/market-world.js
- social_world/app/market.css
- social_world/app/market.js
- social_world/app/tests/MARKET-VALIDATION.txt
- social_world/app/tests/market_test.cjs
