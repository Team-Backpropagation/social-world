#!/usr/bin/env python3
"""
전처리 파이프라인 실행 스크립트
====================================
사회적 고립 AI 에이전트 — 통신·카드 데이터 정제 및 코호트 집계 (Phase 2 산출물 v0)

사용법
------
    python run_pipeline.py                # 전체 실행
    python run_pipeline.py --only flow    # 통신 데이터만
    python run_pipeline.py --only card    # 카드 데이터만
    python run_pipeline.py --only youth   # 청년 병합·탐지만 (clean/ 이 이미 있을 때)
    python run_pipeline.py --no-strict    # 검증 불일치가 있어도 끝까지 진행
    python run_pipeline.py --baseline-end 2025-09-30   # 분할 기준일 변경
    python run_pipeline.py --clean-dir D:/temp/clean    # 출력 폴더 변경

산출물 (clean/ 폴더)
-------------------
    flow_age.csv                 통신 성연령 (격자×월)      595,915행
    flow_time.csv                통신 시간대 (격자×월)      570,475행
    flow_wkdy.csv                통신 요일   (격자×월)      720,165행
    flow_cohort_monthly.csv      통신 코호트 (지역×월×성별×연령)  144행
    card_cohort_daily.csv        카드 코호트 (지역×일×성별×연령×거주여부) 16,728행
                                 split 컬럼: baseline 113일 / event 18일 / eval 53일
    card_industry_daily.csv      카드 업종별 (지역×일×업종×성별×연령9)    371,734행
    card_industry_monthly.csv    카드 업종별 월집계                        16,311행
    flow_*_region_month.csv      지역×월 배경지표 (3개, 이후 분석 편의용)
    youth_master_daily.csv       청년 통합 마스터 (지역×일×성별×연령2)      1,472행
    youth_signals_daily.csv      청년 이탈 신호·분류                        1,472행

실행 시간·메모리 (실측, RAM 4GB 환경)
----------------------------------
    전체 약 100초 (파일 캐시가 데워져 있으면 30초대까지 줄어든다), 최대 메모리 약 700MB
    통신 3종을 동시에 메모리에 올리지 않도록 순차 처리한다.
    clean/ 폴더 산출물은 약 265MB (flow_*.csv 3개가 대부분).
"""
from __future__ import annotations

import argparse
import os
import sys
import time


def _setup_stdout() -> None:
    """윈도우 cmd(cp949)에서 한글 출력이 깨지거나 예외가 나는 것을 방지."""
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="통신·카드 데이터 전처리 파이프라인",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--only", choices=["flow", "card", "youth", "all"], default="all",
                   help="일부만 실행 (기본: all). youth = 청년 병합·탐지만 다시 실행")
    p.add_argument("--baseline-end", default=None,
                   help="baseline/eval 경계일 (기본: config.BASELINE_END). "
                        "이벤트 구간은 config.EVENT_PERIODS 로 별도 관리")
    p.add_argument("--detect-mode", choices=["prospective", "retrospective"], default="prospective",
                   help="청년 이탈 탐지 급성 기준선: prospective=지난 29일(기본, 운영) / "
                        "retrospective=앞뒤 29일(사후 분석, 그날 이후 자료를 씀)")
    p.add_argument("--clean-dir", default=None,
                   help="출력 폴더 (기본: <프로젝트>/clean)")
    p.add_argument("--data-dir", default=None,
                   help="원본 데이터 폴더 (기본: <프로젝트>/DATA)")
    p.add_argument("--no-strict", action="store_true",
                   help="검증 불일치가 있어도 종료 코드 0으로 끝냄")
    p.add_argument("--no-save", action="store_true",
                   help="파일을 저장하지 않고 검증만 수행")
    p.add_argument("--check", action="store_true",
                   help="DATA 폴더에 필요한 파일이 다 있는지만 점검하고 종료")
    return p.parse_args()


def main() -> int:
    _setup_stdout()
    args = parse_args()

    # config 를 import 하기 전에 환경변수로 경로를 주입해야 한다.
    if args.data_dir:
        os.environ["SS_DATA_DIR"] = args.data_dir
    if args.clean_dir:
        os.environ["SS_CLEAN_DIR"] = args.clean_dir

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from src import clean_card, clean_flow, cohort, config, detect_youth, merge_youth, split
    from src.validate import Report

    from src import loaders

    started = time.time()
    save = not args.no_save
    report = Report()

    # ---------------------------------------------------------- DATA 점검
    # 코드만 받아서 처음 실행하는 경우 가장 흔한 실패 원인이 DATA 누락이다.
    found, missing = loaders.check_data_files()
    if missing or args.check:
        print("=" * 62)
        print(" DATA 폴더 점검")
        print("=" * 62)
        print(f" 위치   : {config.DATA_DIR}")
        print(f" 필요   : {len(found) + len(missing)}개 / 확인됨: {len(found)}개")
        if missing:
            print(f" 누락   : {len(missing)}개")
            for name in missing:
                print(f"   - {name}")
            print()
            print(" 대회 사이트에서 받은 원본 파일을 위 경로에 넣어주세요.")
            print(" 폴더가 다른 곳에 있다면: python run_pipeline.py --data-dir <경로>")
            return 2
        print(" 필요한 파일이 모두 있습니다.")
        if args.check:
            return 0
        print()

    print("=" * 62)
    print(" 사회적 고립 AI 에이전트 — 데이터 전처리 파이프라인")
    print("=" * 62)
    print(f" 원본 폴더 : {config.DATA_DIR}")
    print(f" 출력 폴더 : {config.CLEAN_DIR}{'' if save else '  (저장 안 함)'}")
    print(f" 분할 기준 : {args.baseline_end or config.BASELINE_END}")
    print("=" * 62)

    # ---------------------------------------------------------- 통신
    if args.only in ("flow", "all"):
        print("\n[1단계] 통신(유동인구) 데이터 정제")
        print("        ※ 12월 시간대·요일 파일의 완전중복 행을 제거합니다(최우선 처리)")

        age_wide = None
        for name in ("age", "time", "wkdy"):
            summary, wide = clean_flow.clean_flow_table(name, save=save, report=report)
            if name == "age":
                age_wide = wide
            print(f"    → {name}: {summary['merged_rows']:,} → {summary['filtered_rows']:,}행 "
                  f"(경계격자 {summary['excluded_rows']:,}행 제외, {summary['excluded_pct']:.3f}%)")
            report.note(f"[{name}] 보고서 기재용 제외 행 수", summary["excluded_rows"])

        print("\n[2단계] 통신 코호트 변환 (집계 먼저 → melt 나중)")
        flow_cohort = cohort.build_flow_cohort(age_wide, report=report)
        if save:
            config.CLEAN_DIR.mkdir(parents=True, exist_ok=True)
            out = config.CLEAN_DIR / "flow_cohort_monthly.csv"
            flow_cohort.to_csv(out, index=False, encoding=config.OUT_ENCODING)
            print(f"    저장: {out.name} ({len(flow_cohort):,}행)")

    # ---------------------------------------------------------- 카드
    if args.only in ("card", "all"):
        print("\n[3단계] 카드 결제 데이터 정제")
        card, card_summary = clean_card.clean_card(report=report)
        print(f"    → 거주여부: {card_summary['resident_counts']}")
        print("    ※ 위 숫자는 '행 수'입니다. 거주자 비중은 금액·건수 기준으로 계산하세요.")

        print("\n[4단계] 카드 코호트 집계")
        card_cohort = cohort.build_card_cohort(card, report=report)

        print("\n[5단계] 카드 업종별 집계 (업종 다양성·업종 비중 지표용)")
        industry_daily = cohort.build_card_industry_cohort(card, report=report)
        industry_monthly = cohort.aggregate_industry_monthly(industry_daily, report=report)
        industry_daily = split.add_split_label(industry_daily, baseline_end=args.baseline_end)
        if save:
            config.CLEAN_DIR.mkdir(parents=True, exist_ok=True)
            for name, frame in (("card_industry_daily", industry_daily),
                                ("card_industry_monthly", industry_monthly)):
                out = config.CLEAN_DIR / f"{name}.csv"
                frame.to_csv(out, index=False, encoding=config.OUT_ENCODING)
                print(f"    저장: {out.name} ({len(frame):,}행)")
        del industry_daily, industry_monthly, card  # 180만 행 원본 반환

        print("\n[6단계] 분할기준 적용 (baseline / event / eval 이름표)")
        split.assert_no_random_split(False)
        card_cohort = split.add_split_label(card_cohort, baseline_end=args.baseline_end)
        summary = split.summarize_split(card_cohort, report=report)
        print(summary.to_string())

        if save:
            config.CLEAN_DIR.mkdir(parents=True, exist_ok=True)
            out = config.CLEAN_DIR / "card_cohort_daily.csv"
            card_cohort.to_csv(out, index=False, encoding=config.OUT_ENCODING)
            print(f"    저장: {out.name} ({len(card_cohort):,}행)")

    # ---------------------------------------------------------- 청년
    if args.only in ("youth", "all"):
        print("\n[7단계] 청년(20~30대) 통합 마스터 생성")
        youth = merge_youth.build_youth_master(report=report, baseline_end=args.baseline_end)
        print(f"    → {len(youth):,}행 · 코호트 8개 × {youth['date'].nunique()}일")
        if save:
            out = merge_youth.save(youth)
            print(f"    저장: {out.name}")

        print("\n[8단계] 요일인자 제거 및 이탈 탐지")
        sig = detect_youth.build_signals(youth, mode=args.detect_mode)
        sig = detect_youth.classify(detect_youth.classify(sig, "sustain"), "acute")
        cls = sig["class_sustain"]
        rate = (
            sig[~cls.isin(["정상", detect_youth.HOLD])].groupby("split").size()
            / sig.groupby("split").size() * 100
        ).round(1).to_dict()
        print(f"    → 기준선: {args.detect_mode} (급성 = "
              f"{'지난 29일' if args.detect_mode == 'prospective' else '앞뒤 29일, 사후 분석'})")
        print(f"    → 이상 탐지율(지속 기준): {rate}")
        print(f"    → 위축후보: {int(cls.eq('위축후보').sum())}건 "
              f"(임계 {detect_youth.Z_THRESHOLD}, 지난 {detect_youth.PERSIST_WINDOW}일 중 "
              f"{detect_youth.PERSIST_MIN}일 이상 지속) · 단기위축 {int(cls.eq('단기위축').sum())}건 · "
              f"판단보류 {int(cls.eq(detect_youth.HOLD).sum())}건")
        print(f"    → 감소 종류(지속 기준): {cls[~cls.isin(['정상'])].value_counts().to_dict()}")
        if save:
            out = detect_youth.save(sig)
            print(f"    저장: {out.name}")

    # ---------------------------------------------------------- 결과
    elapsed = time.time() - started
    print()
    print(report.summary())
    print(f" 소요 시간: {elapsed:.1f}초")

    if report.failures:
        print("\n 검증에 불일치가 있습니다. 원본 파일이 교체되었거나 코드가 수정된 것일 수 있으니")
        print(" 임의로 넘기지 말고 팀에 공유하세요. (config.EXPECTED 에 기대값이 정리되어 있습니다)")
        if not args.no_strict:
            return 1
    elif args.only == "all" and save:
        print("\n 청년 마스터·탐지 신호까지 생성 완료. clean/ 폴더를 확인하세요.")
    else:
        print("\n 요청한 단계가 정상 완료되었습니다.")
    return 0


def _friendly_main() -> int:
    """예상 가능한 오류는 트레이스백 대신 한 줄 안내로 보여준다."""
    try:
        return main()
    except FileNotFoundError as e:
        print("\n[오류] 파일을 찾을 수 없습니다.\n" + str(e))
        print("\n  확인할 것:")
        print("  1) 이 스크립트를 프로젝트 폴더(SSTeamProject)에서 실행했는지")
        print("  2) DATA 폴더에 원본 파일이 있는지")
        print("  3) 경로가 다르면 --data-dir 옵션으로 지정")
        return 2
    except UnicodeDecodeError:
        print("\n[오류] 한글 인코딩 문제로 파일을 읽지 못했습니다.")
        print("  카드 파일은 CP949, 통신 파일은 UTF-8(BOM)입니다.")
        print("  src/config.py 의 CARD_ENCODING / FLOW_ENCODING 을 확인하세요.")
        return 2
    except MemoryError:
        print("\n[오류] 메모리가 부족합니다.")
        print("  --only flow / --only card 로 나눠 실행하거나,")
        print("  다른 프로그램을 종료한 뒤 다시 시도하세요.")
        return 2
    except ValueError as e:
        print("\n[오류] 데이터 내용이 예상과 다릅니다.\n" + str(e))
        return 2


if __name__ == "__main__":
    raise SystemExit(_friendly_main())
