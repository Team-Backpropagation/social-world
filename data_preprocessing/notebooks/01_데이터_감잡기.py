# %% [markdown]
# # 데이터 감 잡기 — 직접 만져보는 탐색 노트북
#
# 목적: 남이 만든 분석 결과를 읽는 게 아니라, **직접 그려보고 값을 바꿔보면서**
# 이 데이터가 어떻게 생겼는지 몸으로 익히는 것.
#
# 사용법
# - VS Code에서 열면 `# %%` 단위로 셀 실행이 됩니다. 주피터에서도 됩니다.
# - 그냥 `python 01_데이터_감잡기.py` 로 돌리면 차트가 `figs/` 에 저장됩니다.
# - 콘솔에 찍히는 블록마다 **[그림] 파일명**이 함께 나옵니다. 그 파일을 열고
#   같이 보세요. 해석 방법은 `차트_읽는법.md` 에 그림별로 정리돼 있습니다.
#
# 전제: `data_preprocessing/clean/` 에 산출물 10개. 없으면 `python run_pipeline.py` 먼저.

# %%
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

# ---- 한글 폰트 설정 ----
# 주의: plt.rcParams["font.family"] = "없는폰트" 는 예외를 던지지 않고 조용히 통과한다.
# 그래서 try/except 로는 폴백이 안 되고, 설치된 폰트 목록을 직접 확인해야 한다.
from matplotlib import font_manager

_installed = {f.name for f in font_manager.fontManager.ttflist}
for _font in ["Malgun Gothic", "AppleGothic", "NanumGothic",
              "NanumBarunGothic", "Noto Sans CJK KR", "Noto Sans KR"]:
    if _font in _installed:
        plt.rcParams["font.family"] = _font
        print(f"한글 폰트: {_font}")
        break
else:
    print("경고: 한글 폰트를 찾지 못했습니다. 차트 라벨이 □□□ 로 보일 수 있습니다.")
    print("  윈도우라면 보통 'Malgun Gothic'이 있습니다. 맥은 'AppleGothic',")
    print("  리눅스는 'sudo apt install fonts-nanum' 후 다시 실행하세요.")
plt.rcParams["axes.unicode_minus"] = False
plt.rcParams["figure.figsize"] = (13, 5)

CLEAN = Path(__file__).resolve().parents[1] / "clean"
FIGS = Path(__file__).resolve().parent / "figs"
FIGS.mkdir(exist_ok=True)

# 2025년 추석: 10월 6일(월). 연휴가 10/3(개천절)~10/9(한글날) 구간에 몰려 있다.
CHUSEOK = ("2025-10-03", "2025-10-09")
WEEKDAY_KR = ["월", "화", "수", "목", "금", "토", "일"]


def block(fig_name, title, *lines):
    """콘솔 출력과 이미지 파일을 1:1로 묶어주는 헬퍼."""
    print()
    print("=" * 66)
    print(f" [그림] {fig_name}")
    print(f" {title}")
    print("=" * 66)
    for line in lines:
        print(line)


card = pd.read_csv(CLEAN / "card_cohort_daily.csv", encoding="utf-8-sig", parse_dates=["date"])
flow = pd.read_csv(CLEAN / "flow_cohort_monthly.csv", encoding="utf-8-sig")
ind = pd.read_csv(CLEAN / "card_industry_daily.csv", encoding="utf-8-sig", parse_dates=["date"])

print(f"\n카드 코호트 {card.shape} | 통신 코호트 {flow.shape} | 업종 {ind.shape}")
print("고를 수 있는 값 —")
print(f"  지역: {list(card.MCT_SGG_CD.unique())}")
print(f"  성별: {list(card.SEX_CCD.unique())}")
print(f"  연령: {sorted(card.AGE_CCD.unique())}")
print(f"  거주: {list(card.resident.unique())}")


# %% [markdown]
# ## 연습 1 — 코호트 하나를 시간축에 그려보기  → figs/01_일별건수.png

# %%
REGION, SEX, AGE = "서울 강남구", "여성", "20 대"   # ← 바꿔보세요

one = (card[(card.MCT_SGG_CD == REGION) & (card.SEX_CCD == SEX) & (card.AGE_CCD == AGE)]
       .groupby("date", as_index=False)[["amount", "cnt"]].sum())

fig, ax = plt.subplots()
ax.plot(one["date"], one["cnt"], lw=1)
ax.axvspan(pd.Timestamp(CHUSEOK[0]), pd.Timestamp(CHUSEOK[1]), alpha=0.2, color="orange")
ax.set_title(f"{REGION} {SEX} {AGE} — 일별 결제 건수 (주황=추석 연휴)")
ax.set_ylabel("건수")
fig.tight_layout(); fig.savefig(FIGS / "01_일별건수.png", dpi=110); plt.show()

dow = one.assign(요일=one["date"].dt.dayofweek).groupby("요일")["cnt"].mean()
hol = one[one["date"].between(*CHUSEOK)]["cnt"].mean()
nor = one[~one["date"].between(*CHUSEOK)]["cnt"].mean()

block("01_일별건수.png", f"{REGION} {SEX} {AGE} — 일별 결제 건수",
      f"  일평균 {one['cnt'].mean():,.0f}건   최대 {one['cnt'].max():,.0f}건"
      f"({one.loc[one['cnt'].idxmax(),'date'].date()})"
      f"   최소 {one['cnt'].min():,.0f}건({one.loc[one['cnt'].idxmin(),'date'].date()})",
      "",
      "  요일별 평균 —  " + "  ".join(
          f"{WEEKDAY_KR[i]} {v/dow.mean()*100:.0f}%" for i, v in dow.items()),
      f"     (전체 평균을 100%로 놓은 상대값. 그림의 톱니 모양이 이 차이입니다)",
      "",
      f"  추석 연휴 평균 {hol:,.0f}건  vs  평소 {nor:,.0f}건  →  {(hol/nor-1)*100:+.1f}%",
      "",
      "  그림에서 확인: ① 톱니 주기가 7일인가  ② 주황 구간에서 선이 오르나 내리나")
print("  직접 바꿔볼 것: REGION/SEX/AGE 를 '강원 춘천시','남성','70 대' 로")


# %% [markdown]
# ## 연습 2 — 규모가 다른 두 코호트 비교  → figs/02_정규화비교.png

# %%
A = ("서울 강남구", "여성", "70 대")
B = ("강원 춘천시", "여성", "70 대")   # ← 같은 연령, 다른 지역

def series(reg, sex, age):
    return (card[(card.MCT_SGG_CD == reg) & (card.SEX_CCD == sex) & (card.AGE_CCD == age)]
            .groupby("date", as_index=False)["cnt"].sum())

sa, sb = series(*A), series(*B)

fig, axes = plt.subplots(1, 2, figsize=(14, 4.5))
axes[0].plot(sa["date"], sa["cnt"], lw=1, label=f"{A[0]} {A[2]}")
axes[0].plot(sb["date"], sb["cnt"], lw=1, label=f"{B[0]} {B[2]}")
axes[0].set_title("① 원본 건수 — 작은 쪽이 안 보인다"); axes[0].legend(fontsize=8)
for s, lab in [(sa, A), (sb, B)]:
    axes[1].plot(s["date"], s["cnt"] / s["cnt"].mean(), lw=1, label=f"{lab[0]} {lab[2]}")
axes[1].axhline(1.0, color="gray", ls="--", lw=0.8)
axes[1].set_title("② 각자 평균으로 나눔 — 이제 패턴이 비교된다"); axes[1].legend(fontsize=8)
fig.tight_layout(); fig.savefig(FIGS / "02_정규화비교.png", dpi=110); plt.show()

merged = sa.merge(sb, on="date", suffixes=("_A", "_B"))
corr = np.corrcoef(merged["cnt_A"] / sa["cnt"].mean(), merged["cnt_B"] / sb["cnt"].mean())[0, 1]

block("02_정규화비교.png", f"{A[0]} {A[2]}  vs  {B[0]} {B[2]}",
      f"  A 일평균 {sa['cnt'].mean():,.0f}건 / B 일평균 {sb['cnt'].mean():,.0f}건"
      f"  →  규모 차이 {sa['cnt'].mean()/sb['cnt'].mean():.1f}배",
      f"  정규화 후 두 코호트 리듬의 상관계수: {corr:+.3f}",
      "",
      "  그림에서 확인: 왼쪽(①)에서 작은 쪽이 바닥에 깔려 안 보이는 것,",
      "                 오른쪽(②)에서 같은 축으로 비교되는 것")
print("  직접 바꿔볼 것: A와 B를 같은 지역의 '20 대' vs '70 대' 로")


# %% [markdown]
# ## 연습 3 — 추석 연휴에 무엇이 변하는가  → figs/03_추석변화.png

# %%
REG = "강원 춘천시"   # ← '서울 강남구' 로도 해보세요
MIN_CNT = 50          # 하루 평균 이 건수 미만 업종은 노이즈로 보고 제외

ind["연휴"] = ind["date"].between(*CHUSEOK)
sub_h = ind[(ind.MCT_SGG_CD == REG) & ind["연휴"]]
sub_b = ind[(ind.MCT_SGG_CD == REG) & (ind["date"] < CHUSEOK[0])]

h = sub_h.groupby("MCT_RY_CD")["cnt"].sum() / sub_h["date"].nunique()
b = sub_b.groupby("MCT_RY_CD")["cnt"].sum() / sub_b["date"].nunique()
chg = ((h / b - 1) * 100).dropna()
chg = chg[b[chg.index] > MIN_CNT]

fig, ax = plt.subplots(figsize=(13, 5))
top = pd.concat([chg.nlargest(10), chg.nsmallest(10)]).sort_values()
ax.barh(top.index, top.values, color=["tab:red" if v < 0 else "tab:blue" for v in top.values])
ax.axvline(0, color="k", lw=0.8)
ax.set_title(f"{REG} — 추석 연휴 하루평균 결제건수, 평소 대비 변화율(%)")
fig.tight_layout(); fig.savefig(FIGS / "03_추석변화.png", dpi=110); plt.show()

tot = (sub_h["cnt"].sum() / sub_h["date"].nunique()) / (sub_b["cnt"].sum() / sub_b["date"].nunique()) - 1
block("03_추석변화.png", f"{REG} — 추석 연휴(10/3~10/9) vs 평소",
      f"  전체 결제건수: {tot*100:+.1f}%   (업종 {len(chg)}종 비교, 하루 {MIN_CNT}건 이상만)",
      "",
      "  늘어난 곳 (그림의 파란 막대)",
      *[f"    {k:22s} {v:+7.1f}%" for k, v in chg.nlargest(5).items()],
      "",
      "  줄어든 곳 (그림의 빨간 막대)",
      *[f"    {k:22s} {v:+7.1f}%" for k, v in chg.nsmallest(5).items()],
      "",
      "  그림에서 확인: 늘고 준 업종이 상식과 맞는가. 맞다면 이 데이터는",
      "                 사회적 이벤트를 포착한다는 증거입니다.")
print("  직접 바꿔볼 것: REG 를 '서울 강남구' 로 바꿔 두 지역 비교")


# %% [markdown]
# ## 연습 4 — 업종 구성이 정말 고정적인가  → figs/04_업종구성.png

# %%
REGION, SEX, AGE = "강원 춘천시", "여성", "70 대"   # ← 바꿔보세요

sel = ind[(ind.MCT_SGG_CD == REGION) & (ind.SEX_CCD == SEX) & (ind.AGE_CCD == AGE)].copy()
sel["월"] = sel["date"].dt.strftime("%m월")
piv = sel.pivot_table(index="MCT_RY_CD", columns="월", values="cnt", aggfunc="sum").fillna(0)
share = piv / piv.sum() * 100
top10 = share.loc[share.mean(axis=1).nlargest(10).index]

fig, ax = plt.subplots(figsize=(12, 5))
top10.T.plot(kind="bar", stacked=True, ax=ax, width=0.7, colormap="tab20")
ax.set_title(f"{REGION} {SEX} {AGE} — 월별 상위 10업종 건수 비중(%)")
ax.legend(bbox_to_anchor=(1.01, 1), fontsize=8); ax.set_ylabel("비중(%)")
fig.tight_layout(); fig.savefig(FIGS / "04_업종구성.png", dpi=110); plt.show()

ent = {}
for col in piv.columns:
    p = piv[col] / piv[col].sum(); p = p[p > 0]
    ent[col] = float(-(p * np.log(p)).sum())
swing = (top10.max(axis=1) - top10.min(axis=1)).nlargest(3)

block("04_업종구성.png", f"{REGION} {SEX} {AGE} — 월별 업종 구성",
      "  월별 엔트로피 —  " + "  ".join(f"{k} {v:.2f}" for k, v in ent.items()),
      f"     6개월 변동폭 {max(ent.values())-min(ent.values()):.3f}"
      f"   (값 자체가 {min(ent.values()):.1f}~{max(ent.values()):.1f} 수준이므로 매우 작음)",
      "",
      "  비중이 가장 많이 흔들린 업종 3개",
      *[f"    {k:22s} 최대-최소 {v:.1f}%p" for k, v in swing.items()],
      "",
      "  그림에서 확인: 색 띠 두께가 6개월간 거의 그대로인가.",
      "                 그렇다면 월 단위 업종 지표로는 변화를 못 잡습니다.")
print("  직접 바꿔볼 것: AGE 를 '20 대' 로 바꿔 청년/고령 구성 차이 보기")


# %% [markdown]
# ## 연습 5 — 통신은 왜 배경지표인가  → figs/05_통신vs카드.png

# %%
fig, axes = plt.subplots(1, 2, figsize=(14, 4.5))
f = flow[flow.region == "춘천시"]
for (sex, age), g in f.groupby(["sex", "age_group"]):
    axes[0].plot(g["STD_YM"].astype(str), g["flow_pop"] / g["flow_pop"].mean(),
                 marker="o", lw=1, alpha=0.6)
axes[0].set_title("통신 유동인구 — 6개 점, 자기평균 대비"); axes[0].set_ylim(0.8, 1.2)
c = card[card.MCT_SGG_CD == "강원 춘천시"].groupby("date", as_index=False)["cnt"].sum()
axes[1].plot(c["date"], c["cnt"] / c["cnt"].mean(), lw=1)
axes[1].set_title("카드 결제건수 — 184일, 자기평균 대비"); axes[1].set_ylim(0.8, 1.2)
for a in axes:
    a.axhline(1.0, color="gray", ls="--", lw=0.8)
fig.tight_layout(); fig.savefig(FIGS / "05_통신vs카드.png", dpi=110); plt.show()

cv_flow = (f.groupby(["sex", "age_group"])["flow_pop"]
             .agg(lambda s: s.std() / s.mean() * 100).mean())
cv_card = c["cnt"].std() / c["cnt"].mean() * 100

block("05_통신vs카드.png", "춘천시 — 통신 유동인구 vs 카드 결제건수",
      f"  변동계수(표준편차/평균)",
      f"    통신 유동인구 {cv_flow:5.1f}%   (코호트 12개 평균, 월별 6개 시점)",
      f"    카드 결제건수 {cv_card:5.1f}%   (일별 184개 시점)",
      f"    → 카드가 약 {cv_card/cv_flow:.1f}배 더 움직입니다",
      "",
      "  그림에서 확인: 두 패널의 y축 범위가 같습니다(0.8~1.2).",
      "                 왼쪽은 거의 평평, 오른쪽은 출렁입니다.",
      "                 그래서 '통신=평상시 배경, 카드=변화 신호' 로 역할을 나눴습니다.")


# %% [markdown]
# ## 마무리 — 아래 질문에 자기 말로 답할 수 있으면 감이 잡힌 것
#
# 1. 이 데이터에서 가장 크게 움직이는 건 무엇인가? (요일? 계절? 명절?)
# 2. 코호트끼리 비교할 때 반드시 해야 하는 변환은?
# 3. 통신 데이터로 할 수 있는 것과 할 수 없는 것은?
# 4. 추석 연휴에 소비는 어떻게 달라지는가? 지역마다 다른가?
# 5. "고립 위험 신호"로 쓸 만한 후보를 3개 꼽으면?
#
# 5번 답이 곧 우리 팀의 가설입니다. 해석 방법은 `차트_읽는법.md` 참고.
