#!/usr/bin/env python3
"""Check and optionally install the dependencies required by the PyGAMD workflow."""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import subprocess
import sys
from typing import Any


REQUIRED_PACKAGES = {
    "pygamd": "pygamd",
    "numba": "numba",
    "numpy": "numpy",
    "matplotlib": "matplotlib",
    "ovito": "ovito",
}


def package_version(package: str) -> str | None:
    try:
        return importlib.metadata.version(package)
    except importlib.metadata.PackageNotFoundError:
        return None


def install(packages: list[str]) -> None:
    if not packages:
        return
    subprocess.check_call([sys.executable, "-m", "pip", "install", *packages])


def verify() -> dict[str, Any]:
    packages: dict[str, dict[str, Any]] = {}
    for package, module in REQUIRED_PACKAGES.items():
        version = package_version(package)
        record: dict[str, Any] = {
            "installed": version is not None,
            "version": version,
            "importable": False,
        }
        if version is not None:
            result = subprocess.run(
                [sys.executable, "-c", f"import {module}"],
                capture_output=True,
                text=True,
                check=False,
            )
            if result.returncode == 0:
                record["importable"] = True
            else:
                record["error"] = (result.stderr or result.stdout).strip()
        packages[package] = record

    cuda_result = subprocess.run(
        [
            sys.executable,
            "-c",
            "from numba import cuda; raise SystemExit(0 if cuda.is_available() else 2)",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    cuda_available = cuda_result.returncode == 0
    cuda_error = None if cuda_available else (cuda_result.stderr or cuda_result.stdout).strip()

    return {
        "python": sys.version,
        "python_supported": (3, 11) <= sys.version_info[:2] <= (3, 13),
        "packages": packages,
        "cuda_available": cuda_available,
        "cuda_error": cuda_error,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--install-missing",
        action="store_true",
        help="Install missing required packages into the active Python environment.",
    )
    parser.add_argument("--json", action="store_true", help="Print the report as JSON.")
    args = parser.parse_args()

    missing = [package for package in REQUIRED_PACKAGES if package_version(package) is None]
    if missing and args.install_missing:
        print(f"Installing missing required packages: {', '.join(missing)}", flush=True)
        install(missing)

    report = verify()
    remaining = [
        name
        for name, state in report["packages"].items()
        if not state["installed"] or not state["importable"]
    ]
    report["missing_or_broken"] = remaining
    report["overall_status"] = (
        "PASS"
        if report["python_supported"] and report["cuda_available"] and not remaining
        else "FAIL"
    )

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(f"Python supported: {report['python_supported']}")
        for name, state in report["packages"].items():
            print(
                f"{name}: installed={state['installed']} "
                f"importable={state['importable']} version={state['version']}"
            )
            if state.get("error"):
                print(f"  error: {state['error']}")
        print(f"CUDA available: {report['cuda_available']}")
        if report["cuda_error"]:
            print(f"CUDA error: {report['cuda_error']}")
        print(f"Overall status: {report['overall_status']}")

    return 0 if report["overall_status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
