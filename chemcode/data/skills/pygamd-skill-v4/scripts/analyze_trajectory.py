#!/usr/bin/env python3
"""Analyze PyGAMD XML trajectories and write RDF/MSD/Rg data and plots."""

from __future__ import annotations

import argparse
import glob
import math
import xml.etree.ElementTree as ET
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np


def _text_rows(node: ET.Element | None, dtype=float) -> np.ndarray:
    if node is None or not (node.text or "").strip():
        return np.empty((0,))
    rows = [line.split() for line in (node.text or "").splitlines() if line.strip()]
    return np.asarray(rows, dtype=dtype)


def load_xml_frame(filename: str) -> dict[str, np.ndarray]:
    root = ET.parse(filename).getroot()
    config = root.find(".//configuration")
    if config is None:
        raise ValueError(f"{filename}: missing <configuration>")
    box_node = config.find("box")
    if box_node is None:
        raise ValueError(f"{filename}: missing <box>")
    box = np.asarray([float(box_node.attrib[k]) for k in ("lx", "ly", "lz")])
    positions = _text_rows(config.find("position"), float)
    if positions.ndim != 2 or positions.shape[1] != 3:
        raise ValueError(f"{filename}: invalid <position> data")
    type_node = config.find("type")
    types = np.asarray(
        [line.strip() for line in (type_node.text or "").splitlines() if line.strip()]
        if type_node is not None else ["A"] * len(positions),
        dtype=str,
    )
    image = _text_rows(config.find("image"), int)
    if image.shape == positions.shape:
        positions = positions + image * box
    return {"box": box, "positions": positions, "types": types}


def _minimum_image(delta: np.ndarray, box: np.ndarray) -> np.ndarray:
    return delta - box * np.round(delta / box)


def calculate_rdf(
    positions: np.ndarray,
    types: np.ndarray,
    box: np.ndarray,
    type_a: str,
    type_b: str,
    bins: int = 150,
    r_max: float | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    r_max = r_max or float(np.min(box) / 2.0)
    edges = np.linspace(0.0, r_max, bins + 1)
    counts = np.zeros(bins, dtype=float)
    ia = np.flatnonzero(types == type_a)
    ib = np.flatnonzero(types == type_b)
    same = type_a == type_b

    for n, i in enumerate(ia):
        candidates = ia[n + 1 :] if same else ib
        if len(candidates) == 0:
            continue
        distances = np.linalg.norm(_minimum_image(positions[candidates] - positions[i], box), axis=1)
        counts += np.histogram(distances, bins=edges)[0]

    shell_volume = 4.0 * math.pi / 3.0 * (edges[1:] ** 3 - edges[:-1] ** 3)
    volume = float(np.prod(box))
    pair_count = len(ia) * (len(ia) - 1) / 2 if same else len(ia) * len(ib)
    expected = pair_count * shell_volume / volume
    rdf = np.divide(counts, expected, out=np.zeros_like(counts), where=expected > 0)
    return 0.5 * (edges[:-1] + edges[1:]), rdf


def calculate_msd(frames: list[dict[str, np.ndarray]]) -> tuple[np.ndarray, np.ndarray]:
    initial = frames[0]["positions"]
    values = []
    for frame in frames:
        if len(frame["positions"]) != len(initial):
            raise ValueError("trajectory particle count changes between frames")
        delta = frame["positions"] - initial
        # If image flags were absent, use the nearest periodic displacement.
        delta = _minimum_image(delta, frame["box"])
        values.append(float(np.mean(np.sum(delta * delta, axis=1))))
    return np.arange(len(values), dtype=float), np.asarray(values)


def calculate_rg(frames: list[dict[str, np.ndarray]]) -> tuple[np.ndarray, np.ndarray]:
    values = []
    for frame in frames:
        positions = frame["positions"]
        center = np.mean(positions, axis=0)
        values.append(float(np.sqrt(np.mean(np.sum((positions - center) ** 2, axis=1)))))
    return np.arange(len(values), dtype=float), np.asarray(values)


def find_first_peak(r: np.ndarray, values: np.ndarray) -> tuple[float, float] | None:
    for i in range(1, len(values) - 1):
        if values[i] > values[i - 1] and values[i] > values[i + 1]:
            return float(r[i]), float(values[i])
    return None


def analyze_phase_separation(
    r_aa: np.ndarray,
    g_aa: np.ndarray,
    r_bb: np.ndarray,
    g_bb: np.ndarray,
    r_ab: np.ndarray,
    g_ab: np.ndarray,
) -> float | None:
    peaks = {
        "A-A": find_first_peak(r_aa, g_aa),
        "B-B": find_first_peak(r_bb, g_bb),
        "A-B": find_first_peak(r_ab, g_ab),
    }
    print("\n相分离分析:")
    for label, peak in peaks.items():
        if peak is None:
            print(f"  {label} RDF: 未识别到局部峰")
        else:
            print(f"  {label} RDF 第一峰: r={peak[0]:.3f}, g(r)={peak[1]:.3f}")
    if any(peak is None for peak in peaks.values()) or peaks["A-B"][1] <= 0:
        print("  结论: 数据不足，无法计算相分离指数")
        return None
    index = (peaks["A-A"][1] + peaks["B-B"][1]) / (2.0 * peaks["A-B"][1])
    print(f"  相分离指数: {index:.3f}")
    return index


def save_series(path: str, x: np.ndarray, y: np.ndarray, header: str) -> None:
    np.savetxt(path, np.column_stack([x, y]), header=header, comments="")


def plot_series(path: str, x: np.ndarray, series: list[tuple[str, np.ndarray]], xlabel: str, ylabel: str) -> None:
    plt.figure(figsize=(9, 5.5))
    for label, y in series:
        plt.plot(x, y, label=label)
    plt.xlabel(xlabel)
    plt.ylabel(ylabel)
    if len(series) > 1:
        plt.legend()
    plt.grid(alpha=0.25)
    plt.tight_layout()
    plt.savefig(path, dpi=200)
    plt.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("trajectory", nargs="?", default="trajectory.*.xml", help="XML file or glob")
    parser.add_argument("--bins", type=int, default=150)
    args = parser.parse_args()

    files = sorted(glob.glob(args.trajectory))
    if not files and Path(args.trajectory).is_file():
        files = [args.trajectory]
    if not files:
        parser.error(f"no trajectory files matched: {args.trajectory}")

    frames = [load_xml_frame(name) for name in files]
    last = frames[-1]
    available = list(dict.fromkeys(last["types"].tolist()))
    if len(available) < 2:
        raise ValueError(f"RDF phase analysis requires at least two particle types; found {available}")
    type_a, type_b = available[:2]

    r_aa, g_aa = calculate_rdf(last["positions"], last["types"], last["box"], type_a, type_a, args.bins)
    r_bb, g_bb = calculate_rdf(last["positions"], last["types"], last["box"], type_b, type_b, args.bins)
    r_ab, g_ab = calculate_rdf(last["positions"], last["types"], last["box"], type_a, type_b, args.bins)
    time, msd = calculate_msd(frames)
    _, rg = calculate_rg(frames)

    save_series("rdf_AA.dat", r_aa, g_aa, "r g_r")
    save_series("rdf_BB.dat", r_bb, g_bb, "r g_r")
    save_series("rdf_AB.dat", r_ab, g_ab, "r g_r")
    save_series("msd_all.dat", time, msd, "frame msd")
    save_series("rg.dat", time, rg, "frame rg")
    plot_series("rdf_plot.png", r_aa, [("A-A", g_aa), ("B-B", g_bb), ("A-B", g_ab)], "r", "g(r)")
    plot_series("msd_plot.png", time, [("all", msd)], "frame", "MSD")
    plot_series("rg_plot.png", time, [("all", rg)], "frame", "Rg")
    analyze_phase_separation(r_aa, g_aa, r_bb, g_bb, r_ab, g_ab)
    print(f"\n已分析 {len(files)} 个轨迹帧，输出 RDF/MSD/Rg 数据与图像。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
