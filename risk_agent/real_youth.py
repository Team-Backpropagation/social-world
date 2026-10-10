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
- 지역 기준: `region_cnt_ex_fixed_all`(지역×날짜 전 연령 합계)을 region_ref로 돌려준다. 판정기가 이 합계에서
  자기 몫을 빼 '나를 뺀 지역 나머지'로 지역 공통 변화를 잰다. 옛 파일(이 컬럼 없음)이면 None과 함께 안내를 출력
- 사회활동 신호(2026-10-10 J5): `cnt_social`(외식·문화·운동 건수) → card_df.social_cnt,
  `region_cnt_social_all`(지역 전 연령 합계) → region_ref.region_social_cnt. 둘 중 하나라도 없으면 이 신호만 빈칸
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

    has_social = {"cnt_social", "region_cnt_social_all"} <= set(df.columns)
    card_cols = ["sgg_code", "region_name", "gender", "age_group", "cohort_id", "date", "cnt_ex_fixed", "split"]
    card_df = df[card_cols + (["cnt_social"] if has_social else [])] \
        .rename(columns={"date": "ta_ymd", "cnt_ex_fixed": "use_cnt", "split": "split_source", "cnt_social": "social_cnt"})

    flow_df = (df.groupby(["sgg_code", "region_name", "gender", "age_group", "cohort_id", "STD_YM"], as_index=False)
                 ["flow_pop_monthly"].first())
    flow_df["std_ym"] = flow_df["STD_YM"].str[:4] + "-" + flow_df["STD_YM"].str[4:]
    flow_df = flow_df.rename(columns={"flow_pop_monthly": "flow_pop"}).drop(columns="STD_YM")

    region_ref = None
    if "region_cnt_ex_fixed_all" in df.columns:
        ref_cols = ["region_cnt_ex_fixed_all"] + (["region_cnt_social_all"] if has_social else [])
        region_ref = (df.groupby(["sgg_code", "date"], as_index=False)[ref_cols].first()
                        .rename(columns={"date": "ta_ymd", "region_cnt_ex_fixed_all": "region_cnt",
                                         "region_cnt_social_all": "region_social_cnt"}))
    else:
        print("[안내] youth_master_daily.csv에 region_cnt_ex_fixed_all이 없습니다(옛 파일). 지역 공통 변화를 청년 4개 집단으로만 "
              "재게 되어 춘천처럼 20대·30대가 반대로 움직이면 판정이 틀어집니다.\n"
              "       data_preprocessing 폴더에서 `python run_pipeline.py --only youth`로 마스터를 다시 만드세요.")
    if not has_social:
        print("[안내] youth_master_daily.csv에 cnt_social·region_cnt_social_all이 없습니다(10/10 이전 파일). "
              "사회활동(외식·문화·운동) 신호는 빈칸으로 두고 나머지로 판정합니다.\n"
              "       data_preprocessing 폴더에서 `python run_pipeline.py --only youth`로 마스터를 다시 만드세요.")
    return persona_table, flow_df, card_df, region_ref
