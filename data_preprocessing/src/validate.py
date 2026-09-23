"""
검증 리포트 모듈
====================================
"이 숫자가 나와야 정상"을 코드로 박아두는 곳.
각 단계가 기대값과 일치하는지 기록하고, 마지막에 한 번에 요약해 보여준다.

strict=True 로 실행하면 불일치가 하나라도 있을 때 예외를 던져 파이프라인을 멈춘다.
(권장: 처음 돌릴 때는 strict=True 로 돌려서 환경이 정상인지 확인)
"""
from __future__ import annotations


class Report:
    """검증 결과 수집기."""

    def __init__(self) -> None:
        self.rows: list[dict] = []

    def expect(self, label: str, actual, expected, tol: float | None = None) -> bool:
        """
        actual 이 expected 와 같은지 기록한다.

        tol 을 주면 부동소수 비교를 허용 오차 내에서 수행한다(합계 검증용).
        """
        if tol is not None:
            ok = abs(float(actual) - float(expected)) <= tol
        else:
            ok = actual == expected
        self.rows.append({"label": label, "actual": actual, "expected": expected, "ok": ok})
        mark = "OK  " if ok else "다름"
        print(f"    [{mark}] {label}: {_fmt(actual)}" + ("" if ok else f" (기대값 {_fmt(expected)})"))
        return ok

    def note(self, label: str, value) -> None:
        """기대값 없이 기록만 하는 항목 (보고서에 적어야 하는 수치 등)."""
        self.rows.append({"label": label, "actual": value, "expected": None, "ok": None})
        print(f"    [기록] {label}: {_fmt(value)}")

    # ------------------------------------------------------------ 결과
    @property
    def failures(self) -> list[dict]:
        return [r for r in self.rows if r["ok"] is False]

    @property
    def checked(self) -> int:
        return len([r for r in self.rows if r["ok"] is not None])

    def summary(self) -> str:
        n_fail = len(self.failures)
        lines = [
            "=" * 62,
            f" 검증 요약: {self.checked - n_fail}/{self.checked} 항목 일치",
        ]
        if n_fail:
            lines.append("-" * 62)
            lines.append(" 불일치 항목 (아래 항목은 팀에 공유하고 원인을 찾을 것):")
            for r in self.failures:
                lines.append(f"  - {r['label']}: 실제 {_fmt(r['actual'])} / 기대 {_fmt(r['expected'])}")
        else:
            lines.append(" 모든 검증 항목이 기대값과 일치합니다.")
        lines.append("=" * 62)
        return "\n".join(lines)

    def raise_if_failed(self) -> None:
        if self.failures:
            labels = ", ".join(r["label"] for r in self.failures)
            raise AssertionError(f"검증 실패 {len(self.failures)}건: {labels}")


def _fmt(v) -> str:
    if isinstance(v, bool) or v is None:
        return str(v)
    if isinstance(v, int):
        return f"{v:,}"
    if isinstance(v, float):
        return f"{v:,.2f}"
    return str(v)
