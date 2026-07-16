#!/usr/bin/env python3
"""Staged PyGAMD 1.4.8 DPD example.

Run prepare, equilibration, and production as separate commands so the Agent
can stop at every mandatory human checkpoint.
"""

import argparse

import numpy as np

np.random.seed(42)

try:
    import pygamd
except ImportError as exc:
    raise SystemExit(
        "PyGAMD is not installed. Install it in the active Python environment "
        "and verify that `import pygamd` succeeds."
    ) from exc


def create_ab_copolymer_xml(
    nchains=50,
    nbeads=100,
    fA=0.5,
    rho=3.0,
    output_file="config.xml",
):
    """Create a reproducible AB diblock-copolymer XML configuration."""
    n_particles = nchains * nbeads
    box_length = (n_particles / rho) ** (1.0 / 3.0)
    n_a = int(nbeads * fA)

    positions, velocities, types, bonds = [], [], [], []
    atom_id = 0
    for _ in range(nchains):
        previous = np.random.uniform(-box_length / 2, box_length / 2, 3)
        for bead_index in range(nbeads):
            if bead_index == 0:
                position = previous
            else:
                position = previous + 0.5 * np.random.randn(3)
                position = np.where(
                    position > box_length / 2, position - box_length, position
                )
                position = np.where(
                    position < -box_length / 2, position + box_length, position
                )
            positions.append(position)
            velocities.append(np.random.randn(3) * 0.1)
            types.append("A" if bead_index < n_a else "B")
            if bead_index > 0:
                bonds.append(("bond1", atom_id - 1, atom_id))
            previous = position
            atom_id += 1

    with open(output_file, "w", encoding="utf-8") as handle:
        handle.write('<galamost_xml version="1.3">\n')
        handle.write(
            f'<configuration time_step="0" natoms="{n_particles}">\n'
        )
        handle.write(
            f'<box lx="{box_length}" ly="{box_length}" lz="{box_length}"/>\n'
        )
        handle.write("<position>\n")
        for position in positions:
            handle.write(
                f"{position[0]:.6f} {position[1]:.6f} {position[2]:.6f}\n"
            )
        handle.write("</position>\n<velocity>\n")
        for velocity in velocities:
            handle.write(
                f"{velocity[0]:.6f} {velocity[1]:.6f} {velocity[2]:.6f}\n"
            )
        handle.write("</velocity>\n<type>\n")
        for particle_type in types:
            handle.write(f"{particle_type}\n")
        handle.write("</type>\n<bond>\n")
        for bond_type, first, second in bonds:
            handle.write(f"{bond_type} {first} {second}\n")
        handle.write("</bond>\n</configuration>\n</galamost_xml>\n")

    print(
        f"Initial configuration created: {output_file} "
        f"(N={n_particles}, L={box_length:.4f}, rho={rho})"
    )


def run_dpd_phase(config_file, steps, output_prefix, dt=0.005):
    """Run exactly one approved equilibration or production phase."""
    snapshot = pygamd.snapshot.read(config_file)
    print(
        f"System: npa={snapshot.npa}, "
        f"ntypes={getattr(snapshot, 'ntypes', '?')}, box={snapshot.box}"
    )

    dpd = pygamd.force.dpd(info=snapshot, rcut=1.0)
    dpd.setParams(type_i="A", type_j="A", alpha=25.0, sigma=3.0)
    dpd.setParams(type_i="B", type_j="B", alpha=25.0, sigma=3.0)
    dpd.setParams(type_i="A", type_j="B", alpha=30.0, sigma=3.0)

    bond = pygamd.force.bond(info=snapshot, func="harmonic")
    bond.setParams(bond_type="bond1", param=[100.0, 0.5])

    integrator = pygamd.integration.gwvv(info=snapshot, group="all")
    trajectory = pygamd.dump.xml(
        info=snapshot,
        group="all",
        file=output_prefix,
        period=1000,
    )
    thermo = pygamd.dump.data(
        info=snapshot,
        group="all",
        file=f"{output_prefix}.log",
        period=100,
    )

    application = pygamd.application.dynamics(snapshot, dt=dt)
    application.add(dpd)
    application.add(bond)
    application.add(integrator)
    application.add(trajectory)
    application.add(thermo)

    print(
        f"Running approved phase: steps={steps}, dt={dt}, "
        f"output={output_prefix}.*.xml"
    )
    application.run(steps)
    print(
        f"Phase complete: trajectory={output_prefix}.*.xml, "
        f"thermo={output_prefix}.log"
    )


def main():
    parser = argparse.ArgumentParser(
        description="Staged PyGAMD demo with mandatory checkpoints between phases."
    )
    parser.add_argument(
        "--phase",
        required=True,
        choices=["prepare", "equilibration", "production"],
    )
    parser.add_argument("--config", default="config.xml")
    parser.add_argument("--steps", type=int)
    parser.add_argument("--output-prefix")
    parser.add_argument("--dt", type=float, default=0.005)
    args = parser.parse_args()

    if args.phase == "prepare":
        create_ab_copolymer_xml(output_file=args.config)
        return
    if args.phase == "production" and args.config == "config.xml":
        parser.error(
            "production requires --config pointing to the H4-approved "
            "equilibration restart XML"
        )

    steps = args.steps or (5000 if args.phase == "equilibration" else 20000)
    output_prefix = args.output_prefix or args.phase
    run_dpd_phase(
        args.config,
        steps=steps,
        output_prefix=output_prefix,
        dt=args.dt,
    )


if __name__ == "__main__":
    main()
