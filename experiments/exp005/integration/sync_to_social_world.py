"""사용자가 지정한 프로젝트의 experiments/exp005에만 시제품을 복사합니다."""
import argparse
import hashlib
import shutil
from datetime import datetime
from pathlib import Path

SOURCE = Path(__file__).resolve().parent.parent
EXCLUDED = {"node_modules", ".npm-cache", ".venv", "venv", "__pycache__", ".pytest_cache", "backups", "runtime"}


def eligible(file):
    relative = file.relative_to(SOURCE)
    return not any(part in EXCLUDED for part in relative.parts) and file.suffix not in {".pyc", ".tsbuildinfo"} and (not file.name.startswith(".env") or file.name == ".env.example")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("project", type=Path)
    args = parser.parse_args()
    project = args.project.resolve()
    if not (project / "social_world/app/index.html").is_file():
        raise SystemExit("지정 폴더에서 3D 마을 원본을 찾지 못했습니다.")
    target = (project / "experiments/exp005").resolve()
    if not target.is_relative_to(project) or target == SOURCE:
        raise SystemExit("복사 대상 경로가 올바르지 않습니다.")
    backup = target / "integration/backups" / datetime.now().strftime("%Y%m%d-%H%M%S")
    copied = saved = 0
    for file in sorted(SOURCE.rglob("*")):
        if not file.is_file() or not eligible(file):
            continue
        relative = file.relative_to(SOURCE)
        destination = target / relative
        if destination.is_file():
            if hashlib.sha256(file.read_bytes()).digest() == hashlib.sha256(destination.read_bytes()).digest():
                continue
            original = backup / relative
            original.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(destination, original)
            saved += 1
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(file, destination)
        copied += 1
    print(f"EXP-005 only: {copied} files copied; {saved} existing files preserved in backup.")
    if saved:
        print(f"Backup: {backup}")
