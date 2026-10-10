# -*- coding: utf-8 -*-
"""
탐지 한계(MDE: Minimum Detectable Effect) — "이 집단의 결제가 몇 % 줄어야, 몇 주 이어져야 확인권장이 뜨는가"

실제 자료에 인위적인 감소를 한 집단씩 넣어 보고, 판정기(pipeline.judge)가 처음 '확인권장'을 내는
감소 폭을 집단·지속 기간별로 찾는다. 다른 집단은 건드리지 않으므로 지역 공통 변화 차감은 그대로 작동한다.

이 표가 있으면 "개인을 못 잡는다"는 약점을 "집단 결제가 ○% 이상 ○주 이어지면 감지"라는 사양으로 쓸 수 있다.
(집단 결제 ○% 감소 ≈ 집단 안 ○%가 활동을 완전히 멈춘 것과 같은 크기)

실행:
  python3 mde.py --youth ../data_preprocessing/clean/youth_master_daily.csv   # 실제 청년 데이터(로컬)
  python3 mde.py                                                            # 합성 데이터 시연(청년 8개)
결과: 표 출력 + --out CSV
"""
import argparse
from datetime import timedelta

import pandas as pd

import config as C
import pipeline as P

DROPS = [0.03, 0.05, 0.08, 0.10, 0.15, 0.20, 0.30]       # 감소 폭
DURATIONS = {"3주": 21, "5주": 35, "eval 전체": None}     # eval 끝에서부터 거꾸로 이어진 기간


TARGETS = {
    # all: 전체 결제가 줄고 사회활동도 같은 비율로 줄어듦(구성은 그대로)
    # social: 외식·문화·운동만 줄고 줄어든 만큼 다른 소비로 옮겨 감(전체 결제는 그대로) — 2026-10-10 J5
    "all": {"use_cnt": "region_cnt", "social_cnt": "region_social_cnt"},
    "social": {"social_cnt": "region_social_cnt"},
}


def _mask(card, cohort_id, days):
    end = C.EVAL_END
    start = C.EVAL_START if days is None else end - timedelta(days=days - 1)
    d = pd.to_datetime(card["ta_ymd"]).dt.date
    return (card["cohort_id"] == cohort_id) & (d >= start) & (d <= end)


def _inject(card, cohort_id, drop, days, target="all"):
    c = card.copy()
    m = _mask(c, cohort_id, days)
    for col in TARGETS[target]:
        if col in c.columns:
            c.loc[m, col] = (c.loc[m, col] * (1 - drop)).round().astype("int64")
    return c


def _inject_ref(region_ref, card, cohort_id, drop, days, target="all"):
    """지역 전체 합계에도 같은 감소분을 반영한다(그 집단도 지역 합계의 일부이므로)."""
    if region_ref is None:
        return None
    after = _inject(card, cohort_id, drop, days, target)
    m = card["cohort_id"] == cohort_id
    r = region_ref.copy()
    r["ta_ymd"] = r["ta_ymd"].astype(str).str[:10]
    for col, ref_col in TARGETS[target].items():
        if col not in card.columns or ref_col not in r.columns:
            continue
        delta = card.loc[m, ["sgg_code", "ta_ymd"]].assign(
            ta_ymd=lambda x: x["ta_ymd"].astype(str).str[:10],
            delta=after.loc[m, col].to_numpy() - card.loc[m, col].to_numpy())
        r = r.merge(delta, on=["sgg_code", "ta_ymd"], how="left")
        r[ref_col] = r[ref_col] + r["delta"].fillna(0)
        r = r.drop(columns="delta")
    return r


def run(persona_table, flow, card, psych, region_ref=None, target="all"):
    if target == "social" and "social_cnt" not in card.columns:
        raise ValueError("사회활동 건수(social_cnt)가 없는 자료입니다 — 청년 마스터를 10/10 이후 버전으로 다시 만드세요")
    empty = psych.iloc[0:0] if psych is not None else pd.DataFrame()
    base = P.judge(persona_table, flow, card, empty, region_ref=region_ref).set_index("cohort_id")["status"]
    rows = []
    for p in persona_table:
        cid = p["cohort_id"]
        row = {"cohort_id": cid, "기본 상태": C.STATUS_LABELS[base[cid]]}
        if base[cid] in ("check", "hold"):      # 이미 확인권장이거나 판단할 수 없으면 감소를 넣어 볼 의미가 없다
            row.update({f"{label} 지속": "—" for label in DURATIONS})
            rows.append(row)
            continue
        for label, days in DURATIONS.items():
            found = None
            for drop in DROPS:
                j = P.judge(persona_table, flow, _inject(card, cid, drop, days, target), empty,
                            region_ref=_inject_ref(region_ref, card, cid, drop, days, target)).set_index("cohort_id")
                if j.loc[cid, "status"] == "check":
                    found = drop
                    break
            row[f"{label} 지속"] = f"{found:.0%}" if found is not None else f">{DROPS[-1]:.0%}"
        rows.append(row)
    return pd.DataFrame(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--youth", help="youth_master_daily.csv 경로(생략하면 합성 청년 8개로 시연)")
    ap.add_argument("--out", help="결과 CSV 경로")
    ap.add_argument("--target", choices=list(TARGETS), default="all",
                    help="all=전체 결제 감소(기본) / social=외식·문화·운동만 감소하고 전체 결제는 그대로")
    args = ap.parse_args()
    if args.youth:
        from real_youth import load_youth_master
        persona_table, flow, card, region_ref = load_youth_master(args.youth)
        card = card.drop(columns="split_source")
        src = f"실제 청년 데이터({args.youth})"
    else:
        import scenarios as S
        s = S.scenario("S0_all_normal", 101)
        keep = {"20대", "30대"}
        persona_table = [p for p in s["persona_table"] if p["age_group"] in keep]
        ids = {p["cohort_id"] for p in persona_table}
        flow, card = s["flow"][s["flow"].cohort_id.isin(ids)], s["card"][s["card"].cohort_id.isin(ids)]
        region_ref = (s["card"].groupby(["sgg_code", "ta_ymd"], as_index=False)[["use_cnt", "social_cnt"]].sum()
                        .rename(columns={"use_cnt": "region_cnt", "social_cnt": "region_social_cnt"}))  # 전 연령 24개 합계
        src = "합성 청년 8개(시연, 지역 기준 = 합성 전 연령)"
    res = run(persona_table, flow, card, None, region_ref, args.target)
    what = "결제 감소 폭" if args.target == "all" else "외식·문화·운동 결제 감소 폭(전체 결제는 그대로)"
    print(f"=== 탐지 한계: 확인권장이 처음 뜨는 {what} — {src} ===")
    print("(감소는 eval 마지막 날부터 거꾸로 이어지게 넣음. 대화 신호 없이 카드·통신만으로 판정)")
    print(res.to_string(index=False))
    if args.out:
        res.to_csv(args.out, index=False, encoding="utf-8-sig")


if __name__ == "__main__":
    main()
