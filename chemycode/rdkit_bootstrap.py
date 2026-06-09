"""
RDKit Bootstrap for Python 3.14
==============================
RDKit 2026.3.3 (from rdkit-pypi) ships its hash-named native DLLs in
``rdkit.libs`` (a PEP 491 'in-extension' directory).  On Python 3.14, the
dynamic loader does NOT automatically add that directory to the search path,
which leads to::

    ImportError: DLL load failed while importing rdmolfiles

This module adds ``rdkit.libs`` to the OS DLL search path *before* RDKit is
imported, then re-exports everything from :mod:`rdkit` for convenience.

Usage::

    import rdkit_bootstrap  # noqa: F401  (must come BEFORE `from rdkit import ...`)
    from rdkit import Chem
    from rdkit.Chem import Draw, AllChem, Descriptors
"""

from __future__ import annotations

import os
import sys
import ctypes

_RDKIT_LIBS_ADDED = False


def _add_rdkit_libs_to_path() -> str | None:
    """Prepend ``rdkit.libs`` (and ``rdkit``) to the OS DLL search path."""
    global _RDKIT_LIBS_ADDED
    if _RDKIT_LIBS_ADDED:
        return None

    try:
        import rdkit  # noqa: F401
    except ImportError:
        return None

    rdkit_dir = os.path.dirname(rdkit.__file__)
    libs_dir = os.path.join(rdkit_dir, ".libs")
    if not os.path.isdir(libs_dir):
        libs_dir = os.path.join(os.path.dirname(rdkit_dir), "rdkit.libs")

    if not os.path.isdir(libs_dir):
        return None

    if hasattr(os, "add_dll_directory"):
        try:
            os.add_dll_directory(libs_dir)
        except OSError:
            pass
    if hasattr(ctypes.windll, "kernel32"):
        # Fallback: prepend to PATH so the search hits ``rdkit.libs`` first
        os.environ["PATH"] = libs_dir + os.pathsep + os.environ.get("PATH", "")

    _RDKIT_LIBS_ADDED = libs_dir
    return libs_dir


_PATH = _add_rdkit_libs_to_path()
if _PATH:
    sys.stderr.write(f"[rdkit_bootstrap] Added DLL search path: {_PATH}\n")
