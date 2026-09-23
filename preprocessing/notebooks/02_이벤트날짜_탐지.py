# %% [markdown]
# # 이벤트 날짜 탐지 — baseline에서 제외할 날을 데이터로 찾기
#
# 목적: "평범한 날"의 기준을 만들기 위해, 유난한 날을 데이터에서 골라낸다.
#
# ## 방법 (2026-09-21 개선판)
#
# 1. **고정지출 제외** — 보험·세금공과금·통신요금 등 자동결제 업종을 먼저 뺀다.
#    안 빼면 보험료 결제일인 25일·15일이 이벤트로 오탐된다(강남 25일 보험 4.80배).
# 2. **요일 효과 제거** — 요일별 중앙값 배율로 나눈다. 안 하면 일요일 26개가 다 잡힌다.
# 3. **추세 제거** — 29일 이동 중앙값 대비 이탈률만 본다. 평균을 쓰면 창 안의 명절이
#    기준선을 휘게 만든다.
# 4. **이상치 판정(MAD)** — 표준편차를 쓰면 큰 이벤트가 스스로 기준을 부풀려 자기를
#    숨긴다(마스킹). 중앙값 기반 MAD는 극단값에 흔들리지 않는다.
# 5. **지역 간 격차 병용** — 공휴일은 '총량 감소'가 아니라 '지역 간 이동'으로 나타나
#    춘천↑ 강남↓ 로 상쇄된다. 단일 지역 z만 보면 공휴일 절반을 놓친다.
#
# ## 이벤트 성격 분류 규칙
#
# 부호만으로 판정하면 추석을 놓친다. 추석은 양쪽 다 감소하지만(춘천 -8.6, 강남 -19.0)
# **감소 폭의 차이가 크다**(격차 10.4). 그래서 격차를 우선 기준으로 쓴다.
#
# | 조건 | 해석 |
# |---|---|
# | 격차가 상위 5% + 양쪽 모두 최소한 움직임(\|z\|≥0.5) | **이동성 이벤트** — 지역 간 재배치(명절·공휴일) |
# | 양쪽 동시 탐지 + 격차는 작음 | **전국 공통 요인** — 기상 등 외부 충격 |
# | 한쪽만 움직임 | **지역 사정 또는 노이즈** |
#
# 검증: 2025년 하반기 공휴일 8개가 잡히는지 대조한다(아는 정답으로 채점).

# %%
from pathlib import Path

import numpy as np
import pandas as pd

CLEAN = Path(__file__).resolve().parents[1] / "clean"
WD = ["월", "화", "수", "목", "금", "토", "일"]
TH = 3.5          # 단일 지역 z 임계값
GAP_Q = 0.95      # 지역 간 격차 임계 분위수

# 자동결제·고정지출 업종 — 사회적 활동과 무관하므로 탐지 전에 제외
FIXED = ["세금공과금", "보험", "통신요금(이동,시내전화)", "학교등록금", "결제대행(PG)"]

# 2025년 하반기 공휴일 (검증용 정답지)
HOL = {
    "2025-08-15": "광복절", "2025-10-03": "개천절", "2025-10-05": "추석연휴",
    "2025-10-06": "추석", "2025-10-07": "추석연휴", "2025-10-08": "대체공휴일",
    "2025-10-09": "한글날", "2025-12-25": "성탄절",
}

ind = pd.read_csv(CLEAN / "card_industry_daily.csv", encoding="utf-8-sig", parse_dates=["date"])
print(f"원본 {len(ind):,}행 / 업종 {ind['MCT_RY_CD'].nunique()}종")


# %%
def robust_z(df):
    """요일·추세를 제거하고 MAD 기반 robust z-score를 계산한다."""
    d = df.sort_values("date").reset_index(drop=True).copy()
    d["요일"] = d["date"].dt.dayofweek

    # 요일 배율 (중앙값 기반 — 명절이 섞여도 배율이 끌려가지 않음)
    factor = d.groupby("요일")["cnt"].median() / d["cnt"].median()
    adj = d["cnt"] / d["요일"].map(factor)

    # 29일 이동 중앙값을 기준선으로
    base = adj.rolling(29, center=True, min_periods=7).median()
    r = adj / base - 1

    # MAD 기반 robust z
    mad = (r - r.median()).abs().median()
    d["이탈률"] = r
    d["z"] = (r - r.median()) / (1.4826 * mad)
    return d, factor, mad


def build(df, label):
    daily = df.groupby(["MCT_SGG_CD", "date"], as_index=False)["cnt"].sum()
    out = {}
    for reg, g in daily.groupby("MCT_SGG_CD"):
        d, factor, mad = robust_z(g)
        out[reg] = d.set_index("date")
        if label:
            print(f"  [{reg}] 요일배율 " + " ".join(f"{WD[i]}{v:.2f}" for i, v in factor.items())
                  + f" | MAD {mad*100:.2f}% → z={TH} 는 약 {TH*1.4826*mad*100:.1f}% 이탈")
    return out


print("\n[방식 A] 전체 업종 (개선 전)")
ZA = build(ind, True)
print("\n[방식 B] 고정지출 제외 (채택)")
ZB = build(ind[~ind.MCT_RY_CD.isin(FIXED)], True)


# %% [markdown]
# ## 개선 효과 — 고정지출 제외가 오탐을 없앤다

# %%
print(f"{'방식':16s}{'춘천':>6s}{'강남':>6s}{'공휴일':>8s}{'25·15일 오탐':>14s}")
for name, Z in [("A 전체", ZA), ("B 고정지출 제외", ZB)]:
    cnt, hol, pay = [], set(), 0
    for reg, d in Z.items():
        ev = d[d["z"].abs() > TH]
        cnt.append(len(ev))
        hol |= {x.strftime("%Y-%m-%d") for x in ev.index if x.strftime("%Y-%m-%d") in HOL}
        pay += sum(1 for x in ev.index if x.day in (15, 25) and x.strftime("%Y-%m-%d") not in HOL)
    print(f"{name:16s}{cnt[0]:>6d}{cnt[1]:>6d}{len(hol):>6d}/8{pay:>14d}")
print("\n  → 25·15일 오탐은 보험료 자동결제일 효과였다(강남 25일 보험 4.80배).")


# %% [markdown]
# ## 검증 — 공휴일 8개가 잡히는가 (방식 B)

# %%
regs = sorted(ZB)
a, b = ZB[regs[0]]["z"], ZB[regs[1]]["z"]     # 춘천, 강남
gap = (a - b).abs()
gap_th = gap.quantile(GAP_Q)

print(f"{'공휴일':12s}{'날짜':12s}{'춘천z':>8s}{'강남z':>8s}{'격차':>7s}   단일  격차")
n_single = n_gap = 0
for key, name in HOL.items():
    dt = pd.Timestamp(key)
    s = abs(a[dt]) > TH or abs(b[dt]) > TH
    g = gap[dt] > gap_th
    n_single += s; n_gap += g
    print(f"{name:12s}{key:12s}{a[dt]:>8.1f}{b[dt]:>8.1f}{gap[dt]:>7.1f}   "
          f"{'O' if s else '-':4s}  {'O' if g else '-'}")
print(f"\n  단일 지역 z 기준 {n_single}/8 탐지  /  지역 간 격차 기준 {n_gap}/8 탐지")
print(f"  격차 임계값(상위 {(1-GAP_Q)*100:.0f}%) = {gap_th:.1f}  (전체 격차 중앙값 {gap.median():.1f})")
print("  → 공휴일은 춘천↑ 강남↓ 로 상쇄되므로 격차 지표가 필요하다.")


# %% [markdown]
# ## 탐지 결과 — 부호 조합으로 분류

# %%
def blocks(dates):
    out, cur = [], [dates[0]]
    for p, n in zip(dates, dates[1:]):
        (cur.append(n) if (n - p).days == 1 else (out.append(cur), cur.clear(), cur.append(n)))
    out.append(cur)
    return out


MIN_MOVE = 0.5   # 이동성으로 보려면 양쪽 모두 최소 이만큼은 움직여야 한다


def classify(dt):
    """이벤트 성격을 분류한다. 격차를 우선 기준으로 쓴다."""
    za, zb = a[dt], b[dt]
    hit_a, hit_b = abs(za) > TH, abs(zb) > TH
    if gap[dt] > gap_th and min(abs(za), abs(zb)) >= MIN_MOVE:
        return "이동성 이벤트"      # 지역 간 재배치 — 부호가 같아도 정도 차이가 크면 이동
    if hit_a and hit_b:
        return "전국 공통 요인"      # 양쪽이 같은 크기로 함께 움직임
    return "지역 사정/노이즈"


cand = sorted(set(gap[gap > gap_th].index)
              | set(ZB[regs[0]][ZB[regs[0]]["z"].abs() > TH].index)
              | set(ZB[regs[1]][ZB[regs[1]]["z"].abs() > TH].index))

groups = {"이동성 이벤트": [], "전국 공통 요인": [], "지역 사정/노이즈": []}
for dt in cand:
    groups[classify(dt)].append(dt)

for kind, dates in groups.items():
    print(f"\n■ {kind} ({len(dates)}일)")
    for dt in dates:
        key = dt.strftime("%Y-%m-%d")
        print(f"  {key}({WD[dt.dayofweek]})  춘천 {a[dt]:+5.1f} / 강남 {b[dt]:+6.1f}"
              f"  격차 {gap[dt]:5.1f}   {HOL.get(key,'')}")

miss = [k for k in HOL if pd.Timestamp(k) not in groups["이동성 이벤트"]]
print(f"\n  공휴일 8개 중 이동성으로 분류된 것: {8-len(miss)}개"
      + (f" (미분류: {', '.join(HOL[k] for k in miss)})" if miss else ""))


# %% [markdown]
# ## 임계값 민감도 — 3.5가 적절한가

# %%
print(f"{'임계값':>7s}" + "".join(f"{r.split()[-1]:>9s}" for r in regs))
for th in [2.5, 3.0, 3.5, 4.0, 5.0]:
    print(f"{th:>7.1f}" + "".join(f"{(ZB[r]['z'].abs()>th).sum():>9d}" for r in regs))
print("\n  임계값을 낮추면 baseline이 줄어든다. 3.5는 관행값이며 팀 확정 필요.")


# %% [markdown]
# ## 결론 — baseline 설계에 반영할 것
#
# 1. **공휴일 목록은 달력에서 직접 가져온다.** 탐지는 절반을 놓치지만 공휴일은 이미
#    확정된 사실이다. 추론할 필요가 없는 것을 추론하지 않는다.
# 2. **탐지는 달력에 없는 이벤트를 찾는 보조 수단으로만 쓴다.**
#    (연휴 직후 반동, 연말, 전국적 외부 요인 등)
# 3. **분류는 부호가 아니라 격차 기준으로 한다.** 추석처럼 양쪽이 함께 감소하되
#    감소 폭이 크게 다른 경우를 부호만으로는 잡을 수 없다.
# 4. **25일·15일처럼 매달 반복되는 패턴은 이벤트가 아니라 고정 효과**다.
#    제외 대상이 아니라 요일처럼 보정할 대상으로 분류한다.
# 5. baseline은 2분할이 아니라 **3분할**(baseline / event / eval)로 바꾼다.
#    event 구간은 버리는 게 아니라 **반응도 측정 대상**이다(H-A 가설의 재료).
#
# 미해결: 춘천 수요일 반복 감소(08-06, 08-13, 09-17) 원인 / 07-16~17 전국 동시 감소 원인
