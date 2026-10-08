#!/usr/bin/env python3
"""EXP-001 한 명령 실행기.

python3 experiment.py check : 환경과 DB 설정 여부만 점검
python3 experiment.py setup : 분석/웹 패키지 준비
python3 experiment.py risk  : 가상 집단 48사례의 위험 패턴 시험
python3 experiment.py aggregate : 기존 청년 집계 CSV를 ZIP에서 읽기만 하며 입력 점검
python3 experiment.py web   : 의존성 준비 후 웹 실행
python3 experiment.py all   : 위험 시험 후 웹 실행
python3 experiment.py verify-db : 테스트 프로젝트에 가상 사용자 2명을 만들어 RLS 확인

실제 Supabase 스키마 적용과 키 입력은 테스트 프로젝트에서만 수동으로 한다.
이 스크립트는 비밀값을 출력하거나 운영 DB를 자동 변경하지 않는다.
"""
import argparse
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
APP = ROOT / "social_world" / "react_app"
RISK = ROOT / "risk_agent" / "experiment_eval.py"
AGGREGATE = ROOT / "risk_agent" / "read_only_aggregate.py"
BUNDLED_PY = Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"
BUNDLED_NODE_DIR = Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
VENV_PY = ROOT / ".venv" / "bin" / "python3"


def python_for_risk():
    # 일반 Python에 분석 패키지가 없으면 Codex의 번들 Python을 확인한다.
    if VENV_PY.exists():
        check = subprocess.run([str(VENV_PY), "-c", "import pandas,numpy"], capture_output=True)
        if check.returncode == 0:
            return str(VENV_PY)
    if all(importlib.util.find_spec(name) for name in ("pandas", "numpy")):
        return sys.executable
    if BUNDLED_PY.exists():
        check = subprocess.run([str(BUNDLED_PY), "-c", "import pandas,numpy"], capture_output=True)
        if check.returncode == 0:
            return str(BUNDLED_PY)
    return None


def node_env():
    env = os.environ.copy()
    if (BUNDLED_NODE_DIR / "node").exists():
        env["PATH"] = f"{BUNDLED_NODE_DIR}:{env.get('PATH', '')}"
    return env


def env_configured():
    # 비밀값 자체는 읽어서 화면에 표시하지 않는다. 필요한 이름과 비어 있지 않은지만 확인한다.
    path = APP / ".env"
    if not path.exists():
        return False
    names = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            if value.strip() and not value.strip().startswith("your_"):
                names.add(key.strip())
    return {"VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"}.issubset(names)


def check():
    py = python_for_risk()
    npm = shutil.which("npm")
    print(f"분리된 실험 위치: {ROOT}")
    print(f"위험 분석용 Python: {py or '없음 (pandas/numpy 설치 필요)'}")
    print(f"웹용 npm: {npm or '없음'}")
    print(f"웹 패키지: {'준비됨' if (APP / 'node_modules').exists() else '미설치 (web 실행 시 npm ci 시도)'}")
    print(f"테스트 Supabase 키: {'입력됨' if env_configured() else '미입력 — /preview 미리보기만 가능'}")
    print(f"DB SQL: {'준비됨' if (ROOT / 'database/01_socialworld_base.sql').exists() and (ROOT / 'database/02_loop_schema.sql').exists() else '누락'}")
    print("DB 연결·RLS 통과 여부는 이 점검만으로 확인되지 않습니다.")
    return py, npm


def risk(smoke=False):
    py = python_for_risk()
    if not py:
        raise SystemExit("pandas/numpy가 없습니다. README의 Python 설치 단계를 확인해 주세요.")
    cmd = [py, str(RISK)]
    if smoke:
        cmd.append("--smoke")
    subprocess.run(cmd, cwd=ROOT, check=True)


def aggregate():
    py = python_for_risk()
    if not py:
        raise SystemExit("pandas/numpy가 없습니다. README의 Python 설치 단계를 확인해 주세요.")
    subprocess.run([py, str(AGGREGATE)], cwd=ROOT, check=True)


def setup():
    if not python_for_risk():
        print("분석 패키지가 없어 실험 폴더에만 .venv를 만듭니다.", flush=True)
        subprocess.run([sys.executable, "-m", "venv", str(ROOT / ".venv")], check=True)
        subprocess.run([str(ROOT / ".venv/bin/pip"), "install", "-r", str(ROOT / "requirements.txt")], check=True)
    npm = shutil.which("npm")
    if not npm:
        raise SystemExit("npm을 찾지 못했습니다. Node.js를 설치해 주세요.")
    if not (APP / "node_modules").exists():
        subprocess.run([npm, "ci"], cwd=APP, env=node_env(), check=True)
    check()


def web():
    npm = shutil.which("npm")
    if not npm:
        raise SystemExit("npm을 찾지 못했습니다. Node.js를 설치해 주세요.")
    env = node_env()
    if not (APP / "node_modules").exists():
        print("웹 패키지 최초 설치: npm ci", flush=True)
        subprocess.run([npm, "ci"], cwd=APP, env=env, check=True)
    print("화면 미리보기: http://localhost:5173/preview", flush=True)
    print("Supabase 연결 후 전체 흐름: http://localhost:5173/", flush=True)
    subprocess.run([npm, "run", "dev", "--", "--host", "127.0.0.1"], cwd=APP, env=env, check=True)


def verify_db():
    if not (APP / ".env").exists():
        raise SystemExit("테스트 DB .env가 없습니다. README의 격리 Supabase 설정 단계를 먼저 진행해 주세요.")
    if "EXP_ALLOW_DB_WRITES=isolated-test-project" not in (APP / ".env").read_text(encoding="utf-8"):
        raise SystemExit("격리 테스트 프로젝트 확인 문구(EXP_ALLOW_DB_WRITES)가 .env에 없습니다.")
    npm = shutil.which("npm")
    if not npm:
        raise SystemExit("npm을 찾지 못했습니다. Node.js를 설치해 주세요.")
    if not (APP / "node_modules").exists():
        subprocess.run([npm, "ci"], cwd=APP, env=node_env(), check=True)
    node = shutil.which("node", path=node_env()["PATH"])
    subprocess.run([node, str(APP / "scripts/verify-test-db.mjs")], cwd=APP, env=node_env(), check=True)


def main():
    parser = argparse.ArgumentParser(description="EXP-001 개인 실험 실행기")
    parser.add_argument("command", choices=["check", "setup", "risk", "aggregate", "web", "all", "verify-db"])
    parser.add_argument("--smoke", action="store_true", help="risk/all에서 데이터 1회만 빠르게 시험")
    args = parser.parse_args()
    if args.command == "check":
        check()
    elif args.command == "setup":
        setup()
    elif args.command == "risk":
        risk(args.smoke)
    elif args.command == "aggregate":
        aggregate()
    elif args.command == "web":
        web()
    elif args.command == "verify-db":
        verify_db()
    else:
        check()
        risk(args.smoke)
        aggregate()
        web()


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        raise SystemExit(f"실행 단계가 종료 코드 {error.returncode}로 실패했습니다. 바로 위 오류를 확인해 주세요.") from None
