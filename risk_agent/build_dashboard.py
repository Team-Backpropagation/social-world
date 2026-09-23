# -*- coding: utf-8 -*-
"""브리핑용 관리자 대시보드(단일 HTML) 생성 — 산출물 폴더를 인라인 JSON으로 박아 넣는다.
외부 API 호출이 없으므로 claude.ai Artifact(CSP 제약)에서도 그대로 동작한다.
실행: python3 build_dashboard.py            (합성 결과, outputs/)
      python3 build_dashboard.py outputs_youth (실제 청년 결과)
"""
import sys
import json
import os
import pandas as pd

import config as C
import pipeline as P
HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    OUT = os.path.join(HERE, sys.argv[1]) if len(sys.argv) > 1 else os.path.join(HERE, "outputs")
    with open(os.path.join(OUT, "dashboard_data.json"), encoding="utf-8") as f:
        source = json.load(f).get("source", "페르소나 기반 합성 데이터")
    scores = pd.read_csv(os.path.join(OUT, "risk_scores.csv"), dtype={"sgg_code": str})
    factors = pd.read_csv(os.path.join(OUT, "risk_factors.csv"))
    recs = pd.read_csv(os.path.join(OUT, "resource_recommendations.csv"))
    acts = pd.read_csv(os.path.join(OUT, "action_suggestions.csv"))
    pri = pd.read_csv(os.path.join(OUT, "priority_targets.csv"))
    with open(os.path.join(OUT, "npc_feedback.json"), encoding="utf-8") as f:
        feedback = json.load(f)

    # 카드 일별 시계열(요일보정값) — 코호트 상세 차트용
    card_raw = pd.read_csv(os.path.join(OUT, "card_cohort_daily.csv"), dtype={"sgg_code": str})
    card = P.detect_card_anomalies(P.add_date_split_label(card_raw.drop(columns=["split"], errors="ignore")))
    series = {}
    for cid, g in card.groupby("cohort_id"):
        g = g.sort_values("ta_ymd")
        base_mean = g.loc[g["split"] == "baseline", "dow_corrected"].mean()
        series[cid] = [round(v / base_mean * 100, 1) for v in g["dow_corrected"]]  # baseline 평균=100 지수
    dates = [str(d) for d in sorted(card["ta_ymd"].unique())]

    def _load_json(name, default):
        p = os.path.join(OUT, name)
        if not os.path.exists(p):
            return default
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    micro = _load_json("micro_detail.json", {})       # 코호트별 이번 달 대화 현황 (Supabase 모드)
    escalations = _load_json("escalations.json", [])  # 최근 30일 위기 발화 (지역·시각만)

    cohorts = []
    m = scores.merge(factors, on="cohort_id")
    for _, r in m.iterrows():
        cid = r["cohort_id"]
        cohorts.append({
            "id": cid, "sgg": r["sgg_code"], "region": r["region_name"], "gender": r["gender"],
            "age": r["age_group"], "score": round(r["score"], 1), "level": int(r["risk_level"]),
            "z": {k: (None if pd.isna(r[k]) else round(float(r[k]), 2))
                  for k in ["baseline_z", "trigger_z", "event_response", "micro_signal"]},
            "sessions": None if pd.isna(r["avg_session_count"]) else round(float(r["avg_session_count"]), 1),
            "excess": json.loads(r["factor_breakdown"]),
            "cause": r["archetype_guess"],
            "dominant": None if pd.isna(r["dominant_factor"]) else r["dominant_factor"],
            "resources": recs.loc[recs["cohort_id"] == cid, ["resource_name", "provider", "category"]].to_dict("records"),
            "action": (acts.loc[acts["cohort_id"] == cid, "action_text"].iloc[0]
                       if (acts["cohort_id"] == cid).any() else None),
            "feedback": feedback.get(cid),
            "micro": micro.get(cid),
            "series": series[cid],
        })

    data = {
        "model_version": C.MODEL_VERSION,
        "source": source,
        "period": [str(C.PERIOD_START), str(C.PERIOD_END)],
        "dates": dates,
        "events": [{"name": e["name"], "start": str(e["start"]), "end": str(e["end"])} for e in C.EVENT_PERIODS],
        "eval": [str(C.EVAL_START), str(C.EVAL_END)],
        "priority": pri["cohort_id"].tolist(),
        "cohorts": cohorts,
        "escalations": escalations,
        "k_min": C.K_ANONYMITY_MIN,
        "region_names": C.REGION_NAMES,
        "weights": {"with_micro": C.WEIGHTS_WITH_MICRO, "macro_only": C.WEIGHTS_MACRO_ONLY},
    }
    tpl = open(os.path.join(HERE, "dashboard_template.html"), encoding="utf-8").read()
    assert "/*__DATA__*/null" in tpl, "dashboard_template.html의 데이터 자리표시자가 없습니다"
    html = tpl.replace("/*__DATA__*/null", json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    path = os.path.join(OUT, "dashboard.html")
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"dashboard.html 생성 ({len(html)/1024:.0f} KB)")


if __name__ == "__main__":
    main()
