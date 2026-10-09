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


def _inject(card, cohort_id, drop, days):
    c = card.copy()
    end = C.EVAL_END
    start = C.EVAL_START if days is None else end - timedelta(days=days - 1)
    d = pd.to_datetime(c["ta_ymd"]).dt.date
    m = (c["cohort_id"] == cohort_id) & (d >= start) & (d <= end)
    c.loc[m, "use_cnt"] = (c.loc[m, "use_cnt"] * (1 - drop)).round().astype("int64")
    return c


def _inject_ref(region_ref, card, cohort_id, drop, days):
    """지역 전체 합계에도 같은 감소분을 반영한다(그 집단도 지역 합계의 일부이므로)."""
    if region_ref is None:
        return None
    before = card[card["cohort_id"] == cohort_id][["sgg_code", "ta_ymd", "use_cnt"]]
    after = _inject(card, cohort_id, drop, days)
    after = after[after["cohort_id"] == cohort_id][["ta_ymd", "use_cnt"]]
    delta = before.assign(delta=after["use_cnt"].to_numpy() - before["use_cnt"].to_numpy())
    r = region_ref.copy()
    r["ta_ymd"] = r["ta_ymd"].astype(str).str[:10]
    delta["ta_ymd"] = delta["ta_ymd"].astype(str).str[:10]
    r = r.merge(delta[["sgg_code", "ta_ymd", "delta"]], on=["sgg_code", "ta_ymd"], how="left")
    r["region_cnt"] = r["region_cnt"] + r["delta"].fillna(0)
    return r.drop(columns="delta")


def run(persona_table, flow, card, psych, region_ref=None):
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
                j = P.judge(persona_table, flow, _inject(card, cid, drop, days), empty,
                            region_ref=_inject_ref(region_ref, card, cid, drop, days)).set_index("cohort_id")
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
        region_ref = (s["card"].groupby(["sgg_code", "ta_ymd"], as_index=False)["use_cnt"].sum()
                        .rename(columns={"use_cnt": "region_cnt"}))       # 전 연령 24개 합계
        src = "합성 청년 8개(시연, 지역 기준 = 합성 전 연령)"
    res = run(persona_table, flow, card, None, region_ref)
    print(f"=== 탐지 한계: 확인권장이 처음 뜨는 결제 감소 폭 — {src} ===")
    print("(감소는 eval 마지막 날부터 거꾸로 이어지게 넣음. 대화 신호 없이 카드·통신만으로 판정)")
    print(res.to_string(index=False))
    if args.out:
        res.to_csv(args.out, index=False, encoding="utf-8-sig")


if __name__ == "__main__":
    main()
