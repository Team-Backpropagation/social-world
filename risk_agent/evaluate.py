# -*- coding: utf-8 -*-
"""
판단 검증 — 시나리오(scenarios.py)를 여러 seed로 돌려 혼동행렬을 낸다.

validate.py가 "기본 합성 데이터 1벌에서 심은 원형을 찾는가"만 본다면, 이 파일은
  - 찾아야 할 것을 찾았나(재현율)
  - 괜찮은 집단에 경고하지 않았나(특이도)
  - 경고 중 진짜는 얼마인가(정밀도)
를 시나리오·seed별로 함께 본다. 실제 고립 정답이 없으므로 이 숫자는 "심은 패턴에 대한 판정기 성질"이지
실제 고립 판별 정확도가 아니다.

실행:
  python3 evaluate.py                    # 평가용 seed(101~120), 전체 시나리오
  python3 evaluate.py --seeds tune       # 임계값 조정용 seed(1~10)
  python3 evaluate.py --scenarios S0_all_normal S1_default --out result.csv
"""
import argparse
import sys

import pandas as pd

import config as C
import pipeline as P
import scenarios as S


USE_SOCIAL = True   # --no-social: 사회활동 신호를 빼고 돌려 J5 전후를 비교한다


def judge_scenario(s, as_of=None):
    """시나리오 데이터 한 벌을 판정기에 넣고 코호트별 결과를 돌려준다."""
    card = s["card"] if USE_SOCIAL else s["card"].drop(columns="social_cnt", errors="ignore")
    return P.judge(s["persona_table"], s["flow"], card, s["psych"], as_of=as_of, region_ref=s.get("region_ref"))


def confusion(judged, labels):
    """확인권장(check)을 '경고'로 본다. 변화관찰(watch)은 따로 센다."""
    j = judged[["cohort_id", "status"]].copy()
    j["truth"] = j["cohort_id"].map(labels).fillna("normal") != "normal"
    j["alert"] = j["status"] == "check"
    tp = int((j.truth & j.alert).sum())
    fn = int((j.truth & ~j.alert).sum())
    fp = int((~j.truth & j.alert).sum())
    tn = int((~j.truth & ~j.alert).sum())
    return {"tp": tp, "fn": fn, "fp": fp, "tn": tn,
            "watch_on_normal": int((~j.truth & (j["status"] == "watch")).sum()),
            "watch_on_planted": int((j.truth & (j["status"] == "watch")).sum()),
            "hold": int((j["status"] == "hold").sum())}


def run(scenarios, seeds, verbose=False):
    rows = []
    for name in scenarios:
        for seed in seeds:
            s = S.scenario(name, seed)
            judged = judge_scenario(s)
            r = confusion(judged, s["labels"])
            rows.append({"scenario": name, "seed": seed, **r})
            if verbose:
                print(name, seed, r, file=sys.stderr)
    return pd.DataFrame(rows)


def summarize(df):
    g = df.groupby("scenario", sort=False).sum(numeric_only=True).drop(columns="seed")
    n = df.groupby("scenario", sort=False).size()
    out = pd.DataFrame({
        "runs": n,
        "planted": (g.tp + g.fn) // n,
        "recall": g.tp / (g.tp + g.fn).where(lambda x: x > 0),
        "specificity": g.tn / (g.tn + g.fp),
        "precision": g.tp / (g.tp + g.fp).where(lambda x: x > 0),
        "alerts_per_run": (g.tp + g.fp) / n,
        "false_alerts_per_run": g.fp / n,
        "watch_on_normal_per_run": g.watch_on_normal / n,
        "hold_per_run": g.hold / n,
    })
    return out


def timeline(seeds, scenario="S1_default"):
    """순차 평가 — 매주 말일(as_of)마다 그날까지의 자료로만 판정해, 확인권장이 언제 처음 뜨는지 본다."""
    from datetime import timedelta
    days, d = [], C.EVAL_START + timedelta(days=13)
    while d <= C.PERIOD_END:
        days.append(d)
        d += timedelta(days=7)
    if days[-1] != C.PERIOD_END:
        days.append(C.PERIOD_END)
    rows = []
    for seed in seeds:
        s = S.scenario(scenario, seed)
        for as_of in days:
            r = confusion(judge_scenario(s, as_of=as_of), s["labels"])
            rows.append({"as_of": as_of.isoformat(), "seed": seed, **r})
    df = pd.DataFrame(rows)
    g = df.groupby("as_of").sum(numeric_only=True)
    return pd.DataFrame({"recall": g.tp / (g.tp + g.fn), "false_alerts_per_run": g.fp / len(seeds),
                         "watch_on_planted_per_run": g.watch_on_planted / len(seeds)})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", choices=["eval", "tune"], default="eval")
    ap.add_argument("--scenarios", nargs="*", default=S.ALL_SCENARIOS)
    ap.add_argument("--out", help="seed별 원자료 CSV 저장 경로")
    ap.add_argument("--timeline", action="store_true", help="S1을 매주 그날까지의 자료로만 판정(순차 평가)")
    ap.add_argument("--no-social", action="store_true", help="사회활동(외식·문화·운동) 신호 없이 판정(J5 전후 비교용)")
    ap.add_argument("-v", action="store_true")
    args = ap.parse_args()
    global USE_SOCIAL
    USE_SOCIAL = not args.no_social
    seeds = S.EVAL_SEEDS if args.seeds == "eval" else S.TUNE_SEEDS
    if args.timeline:
        print(f"=== 순차 평가 S1_default ({args.seeds} seed {len(seeds)}개) — 그날까지의 자료만 사용 ===")
        print(timeline(seeds).round(3).to_string())
        return
    df = run(args.scenarios, seeds, verbose=args.v)
    if args.out:
        df.to_csv(args.out, index=False)
    pd.set_option("display.width", 200)
    print(f"=== 판단 검증 ({args.seeds} seed {len(seeds)}개, 모델 {C.MODEL_VERSION}"
          f"{', 사회활동 신호 끔' if args.no_social else ''}) ===")
    print(summarize(df).round(3).to_string())


if __name__ == "__main__":
    main()
