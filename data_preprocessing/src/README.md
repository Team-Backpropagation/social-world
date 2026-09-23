# src/ — 전처리 모듈

사용법·설치·DATA 준비·모듈 설명은 상위 폴더의 **[../README.md](../README.md)** 에 정리되어 있습니다.

각 모듈의 역할은 파일 맨 위 독스트링을 보세요.

| 파일 | 역할 |
|---|---|
| `config.py` | 경로·상수·검증 기대값 (수정은 주로 여기) |
| `loaders.py` | 원본 읽기 전용 + DATA 파일 점검 |
| `clean_flow.py` | 통신(유동인구) 정제 |
| `clean_card.py` | 카드 결제 정제 |
| `cohort.py` | 코호트 집계 |
| `split.py` | baseline / eval 분할 라벨 |
| `validate.py` | 검증 리포트 |
