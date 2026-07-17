#!/usr/bin/env python3
"""Render PyGAMD/GALAMOST XML trajectories with OVITO."""

from __future__ import annotations

import argparse
import glob
import math
from pathlib import Path
import xml.etree.ElementTree as ET

import numpy as np


def read_galamost_xml(filename: str | Path):
    config = ET.parse(filename).getroot().find(".//configuration")
    if config is None:
        raise ValueError("missing <configuration>")
    box_node = config.find("box")
    position_node = config.find("position")
    type_node = config.find("type")
    if box_node is None or position_node is None or not (position_node.text or "").strip():
        raise ValueError("trajectory frame is missing box or position data")

    box = np.asarray([float(box_node.attrib[key]) for key in ("lx", "ly", "lz")])
    positions = np.asarray(
        [line.split() for line in (position_node.text or "").splitlines() if line.strip()],
        dtype=float,
    )
    types = (
        [line.strip() for line in (type_node.text or "").splitlines() if line.strip()]
        if type_node is not None
        else ["A"] * len(positions)
    )
    natoms = int(config.attrib.get("natoms", len(positions)))
    if len(positions) != natoms or len(types) != natoms:
        raise ValueError(
            f"particle count mismatch: natoms={natoms}, positions={len(positions)}, types={len(types)}"
        )
    return positions, types, box, natoms


def build_data(positions, types, box):
    try:
        from ovito.data import DataCollection, ParticleType
    except ImportError as exc:
        raise RuntimeError("OVITO is not installed; run `pip install ovito` or use matplotlib.") from exc

    unique_types = sorted(set(types))
    type_map = {name: index + 1 for index, name in enumerate(unique_types)}
    palette = [
        (0.16, 0.42, 0.90),
        (0.90, 0.22, 0.22),
        (0.20, 0.70, 0.35),
        (0.80, 0.55, 0.10),
    ]
    data = DataCollection()
    data.create_cell(
        [[box[0], 0, 0, 0], [0, box[1], 0, 0], [0, 0, box[2], 0]],
        (True, True, True),
    )
    particles = data.create_particles()
    particles.create_property("Position", data=positions.astype(np.float64))
    particle_types = particles.create_property(
        "Particle Type",
        data=np.asarray([type_map[name] for name in types], dtype=np.int32),
    )
    for index, name in enumerate(unique_types):
        particle_types.types.append(
            ParticleType(id=index + 1, name=name, color=palette[index % len(palette)])
        )
    particles.vis.radius = 0.40
    return data, unique_types, palette


def setup_camera(viewport, length):
    from ovito.vis import Viewport

    direction = np.asarray((1.0, 0.9, 0.7), dtype=float)
    direction /= np.linalg.norm(direction)
    viewport.type = Viewport.Type.PERSPECTIVE
    viewport.camera_pos = (-direction * length * 2.6).tolist()
    viewport.camera_dir = direction.tolist()
    viewport.fov = math.radians(32)


def render_spheres(data, output, width, height):
    from ovito.pipeline import Pipeline, StaticSource
    from ovito.vis import TachyonRenderer, Viewport

    pipeline = Pipeline(source=StaticSource(data=data))
    viewport = Viewport()
    setup_camera(viewport, max(data.cell[0, 0], data.cell[1, 1], data.cell[2, 2]))
    pipeline.add_to_scene()
    try:
        viewport.render_image(
            size=(width, height),
            filename=str(output),
            renderer=TachyonRenderer(),
            background=(1.0, 1.0, 1.0),
        )
    finally:
        pipeline.remove_from_scene()


def render_surface(data, unique_types, palette, output, width, height):
    from ovito.modifiers import ConstructSurfaceModifier, SelectTypeModifier
    from ovito.pipeline import Pipeline, StaticSource
    from ovito.vis import OpenGLRenderer, Viewport

    pipeline = Pipeline(source=StaticSource(data=data))
    pipeline.source.data.particles.vis.enabled = False
    for index, name in enumerate(unique_types):
        pipeline.modifiers.append(SelectTypeModifier(property="Particle Type", types={name}))
        modifier = ConstructSurfaceModifier(
            method=ConstructSurfaceModifier.Method.AlphaShape,
            radius=1.3,
            only_selected=True,
            select_surface_particles=False,
        )
        modifier.vis.surface_color = palette[index % len(palette)]
        modifier.vis.surface_transparency = 0.25
        modifier.vis.smooth_shading = True
        pipeline.modifiers.append(modifier)

    viewport = Viewport()
    setup_camera(viewport, max(data.cell[0, 0], data.cell[1, 1], data.cell[2, 2]))
    pipeline.add_to_scene()
    try:
        viewport.render_image(
            size=(width, height),
            filename=str(output),
            renderer=OpenGLRenderer(),
            background=(1.0, 1.0, 1.0),
        )
    finally:
        pipeline.remove_from_scene()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--xml")
    parser.add_argument("--indir", default="prod")
    parser.add_argument("--outdir", default="analysis")
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--height", type=int, default=1440)
    parser.add_argument("--no-surface", action="store_true")
    args = parser.parse_args()

    output_dir = Path(args.outdir)
    output_dir.mkdir(parents=True, exist_ok=True)
    if args.xml:
        frames = [args.xml]
    else:
        frames = []
        for pattern in ("trajectory.*.xml", "production.*.xml", "equilibration.*.xml"):
            frames.extend(glob.glob(str(Path(args.indir) / pattern)))
        frames = sorted(set(frames))
    if not frames or not frames[-1]:
        print("No trajectory, production, or equilibration XML frame found.")
        return 1

    positions, types, box, natoms = read_galamost_xml(frames[-1])
    print(f"Reading {frames[-1]}: N={natoms}, box={box.tolist()}, types={sorted(set(types))}")
    data, unique_types, palette = build_data(positions, types, box)
    sphere_path = output_dir / "snapshot_ovito.png"
    render_spheres(data, sphere_path, args.width, args.height)
    print(f"Sphere render: {sphere_path}")

    if not args.no_surface:
        try:
            surface_path = output_dir / "snapshot_ovito_surface.png"
            surface_data, surface_types, surface_palette = build_data(positions, types, box)
            render_surface(
                surface_data,
                surface_types,
                surface_palette,
                surface_path,
                args.width,
                args.height,
            )
            print(f"Surface render: {surface_path}")
        except Exception as exc:
            print(f"Surface render skipped: {type(exc).__name__}: {exc}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
