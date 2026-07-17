#!/usr/bin/env python3
"""Diagnose and optionally initialize PyGAMD on Windows CUDA 13.2.

This compatibility helper is intentionally opt-in. It does not install
dependencies and refuses unsupported CUDA layouts instead of silently applying
private Numba patches to an unknown environment.
"""

from __future__ import annotations

import argparse
import ctypes
import os
from pathlib import Path


def _load_existing(path: Path) -> None:
    if path.exists():
        ctypes.CDLL(str(path))


def init_gpu(cuda_base: str | Path) -> bool:
    """Initialize the known CUDA 13.2/Numba compatibility environment."""
    base = Path(cuda_base).expanduser().resolve()
    required = {
        "cudart": base / "bin" / "x64" / "cudart64_13.dll",
        "nvvm": base / "nvvm" / "bin" / "x64" / "nvvm.dll",
        "libdevice": base / "nvvm" / "libdevice" / "libdevice.10.bc",
    }
    missing = [name for name, path in required.items() if not path.exists()]
    if missing:
        print(f"GPU initialization refused: missing {', '.join(missing)} under {base}")
        return False

    os.environ["PATH"] = os.pathsep.join(
        [str(base / "bin"), str(base / "bin" / "x64"), str(base / "nvvm" / "bin" / "x64"), os.environ.get("PATH", "")]
    )
    os.environ["CUDA_HOME"] = str(base)
    os.environ["CUDA_PATH"] = str(base)
    os.environ["NUMBAPRO_LIBDEVICE"] = str(required["libdevice"])
    os.environ["NUMBAPRO_NVVM"] = str(required["nvvm"])

    _load_existing(required["cudart"])
    _load_existing(required["nvvm"])
    _load_existing(base / "bin" / "x64" / "nvrtc64_130_0.dll")

    try:
        from numba.cuda.cudadrv import nvvm
        from numba import cuda
    except Exception as exc:
        print(f"GPU initialization failed while importing Numba CUDA: {exc}")
        return False

    if hasattr(nvvm, "CTK_SUPPORTED"):
        nvvm.CTK_SUPPORTED[(13, 2)] = ((5, 0), (12, 0))

    original_supported_ccs = nvvm.get_supported_ccs

    def supported_ccs():
        try:
            values = tuple(original_supported_ccs() or ())
            return tuple(sorted(set(values + ((12, 0),))))
        except Exception:
            return ((5, 0), (6, 0), (7, 0), (7, 5), (8, 0), (8, 6), (8, 9), (9, 0), (12, 0))

    nvvm.get_supported_ccs = supported_ccs
    nvvm.open_libdevice = lambda: required["libdevice"].read_bytes()
    if hasattr(nvvm, "get_libdevice"):
        nvvm.get_libdevice = lambda: str(required["libdevice"])

    try:
        available = bool(cuda.is_available())
        if available:
            name = cuda.gpus[0].name
            if isinstance(name, bytes):
                name = name.decode(errors="replace")
            print(f"GPU initialization succeeded: {name}")
        else:
            print("GPU initialization completed, but Numba reports CUDA unavailable.")
        return available
    except Exception as exc:
        print(f"GPU verification failed: {exc}")
        return False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--cuda-base",
        default=os.environ.get(
            "CUDA_PATH",
            r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v13.2",
        ),
    )
    args = parser.parse_args()
    return 0 if init_gpu(args.cuda_base) else 1


if __name__ == "__main__":
    raise SystemExit(main())
