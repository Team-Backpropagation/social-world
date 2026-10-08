# -*- coding: utf-8 -*-
"""
① 수집 — 실제 청년 데이터 로더 (data_preprocessing/clean/youth_master_daily.csv)

합성 데이터 생성기(synth_macro.py)를 대신해 팀 전처리 산출물을 파이프라인 입력 형식으로 바꾼다.
입력 파일 설명: 프로젝트 문서 `청년마스터_컬럼설명.md`

변환 규칙
- 코호트: region × sex × age_group = 8개 (강남·춘천 × 남·여 × 20대·30대)
- 카드 일별 지표: `cnt_ex_fixed` (고정지출 4종 제외 건수) — 컬럼설명 문서의 "규모 지표 권장".
  금액이 아니라 건수를 쓰는 이유는 데이터_분석근거_정리.md 8절(금액은 세금에 지배됨)
- 통신 월별 지표: `flow_pop_monthly` — 일별 행에 복제돼 있으므로 월별 1행으로 되돌린다.
  `region_*_monthly` 컬럼은 연령·성별 축이 없어 코호트 신호로 쓰지 않는다(생태학적 오류 방지)
- split: 파일에 이미 있는 값과 파이프라인이 계산하는 값이 일치하는지 검사만 한다
"""
import pandas as pd

REGION_CODE = {"서울 강남구": ("11680", "강남구"), "강원 춘천시": ("51110", "춘천시")}
SEX_CODE = {"남성": "M", "여성": "F"}
REQUIRED = ["region", "date", "sex", "age_group", "split", "cnt_ex_fixed", "flow_pop_monthly", "STD_YM"]


def load_youth_master(path):
    df = pd.read_csv(path, encoding="utf-8-sig", dtype={"STD_YM": str})
    missing = [c for c in REQUIRED if c not in df.columns]
    if missing:
        raise ValueError(f"youth_master_daily.csv에 필요한 컬럼이 없습니다: {missing}")
    unknown = set(df["region"]) - set(REGION_CODE)
    if unknown:
        raise ValueError(f"알 수 없는 지역 값: {unknown}")

    df["sgg_code"] = df["region"].map(lambda r: REGION_CODE[r][0])
    df["region_name"] = df["region"].map(lambda r: REGION_CODE[r][1])
    df["gender"] = df["sex"].map(SEX_CODE)
    df["cohort_id"] = df["sgg_code"] + "-" + df["gender"] + "-" + df["age_group"]

    cohorts = (df[["cohort_id", "sgg_code", "region_name", "gender", "age_group"]]
               .drop_duplicates().sort_values("cohort_id").to_dict("records"))
    persona_table = [{**c, "archetype": "unknown", "micro_eligible": True} for c in cohorts]

    card_df = df[["sgg_code", "region_name", "gender", "age_group", "cohort_id", "date", "cnt_ex_fixed", "split"]] \
        .rename(columns={"date": "ta_ymd", "cnt_ex_fixed": "use_cnt", "split": "split_source"})

    flow_df = (df.groupby(["sgg_code", "region_name", "gender", "age_group", "cohort_id", "STD_YM"], as_index=False)
                 ["flow_pop_monthly"].first())
    flow_df["std_ym"] = flow_df["STD_YM"].str[:4] + "-" + flow_df["STD_YM"].str[4:]
    flow_df = flow_df.rename(columns={"flow_pop_monthly": "flow_pop"}).drop(columns="STD_YM")

    return persona_table, flow_df, card_df
