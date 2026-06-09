"""
Demo 2: self-contained MD simulation + MDAnalysis analysis.

Build a small box of TIP3P-style water + Na+/Cl- ions, run a short
velocity-Verlet MD with a manual LJ potential (no external calculator),
write frames to an XTC trajectory via MDAnalysis, then analyze the
trajectory (PE drift, O-O RDF, MSD).
"""
import os, json, warnings
import numpy as np
warnings.filterwarnings("ignore")

OUT_DIR = r"M:\agents-for madao\ChemAgent\demo_outputs"
os.makedirs(OUT_DIR, exist_ok=True)

# ---------- 1. Build the box (32 H2O + 2 Na+ + 2 Cl-) ----------
cell = 12.0
rng = np.random.default_rng(7)
positions, symbols = [], []
n_side = 4
spacing = cell / n_side
for ix in range(n_side):
    for iy in range(n_side):
        for iz in range(n_side):
            base = np.array([(ix + 0.5) * spacing,
                             (iy + 0.5) * spacing,
                             (iz + 0.5) * spacing])
            jitter = rng.normal(scale=0.4, size=3)
            o_pos = base + jitter
            d = 0.9572
            h1 = o_pos + np.array([d, 0.0, 0.0])
            h2 = o_pos + np.array([d * np.cos(np.deg2rad(104.52)),
                                    d * np.sin(np.deg2rad(104.52)), 0.0])
            positions.extend([o_pos, h1, h2])
            symbols.extend(["O", "H", "H"])
ion_pos = rng.uniform(0, cell, size=(4, 3))
positions.extend(ion_pos)
symbols.extend(["Na", "Na", "Cl", "Cl"])
n_wat = 32
positions = np.array(positions)
n_atoms = len(positions)
print(f"Built box: {n_atoms} atoms ({n_wat} waters + 4 ions)")

# ---------- 2. Define pair types and LJ parameters ----------
# Epsilons in eV, sigmas in Angstrom
PARAMS = {
    ("O", "O"):   (0.155 / 96.485, 3.16),
    ("Na", "Na"): (0.001,          2.0),
    ("Cl", "Cl"): (0.001,          3.5),
    ("O", "Na"):  (0.05  / 96.485, 2.6),
    ("O", "Cl"):  (0.05  / 96.485, 3.3),
    ("Na", "Cl"): (0.001,          2.7),
    ("H", "H"):   (0.0,            0.0),
    ("O", "H"):   (0.0,            0.0),
    ("Na", "H"):  (0.0,            0.0),
    ("Cl", "H"):  (0.0,            0.0),
}
RCUT2 = 8.0 ** 2  # cutoff 8 A

def lj_forces(pos, sym, box):
    """Return (PE eV, forces eV/A) with minimum-image convention."""
    n = len(pos)
    pe = 0.0
    f = np.zeros_like(pos)
    box_inv = 1.0 / box
    for i in range(n):
        si = sym[i]
        for j in range(i + 1, n):
            if PARAMS.get((si, sym[j]), (0.0, 0.0))[0] == 0.0:
                continue
            d = pos[i] - pos[j]
            d -= box * np.rint(d * box_inv)  # minimum image
            r2 = d @ d
            if r2 >= RCUT2 or r2 == 0.0:
                continue
            eps, sigma = PARAMS[(si, sym[j])]
            sr2 = (sigma * sigma) / r2
            sr6 = sr2 * sr2 * sr2
            sr12 = sr6 * sr6
            pe += 4.0 * eps * (sr12 - sr6)
            fij = 24.0 * eps * (2.0 * sr12 - sr6) * d / r2
            f[i] += fij
            f[j] -= fij
    return pe, f

# ---------- 3. Initialize velocities ----------
# Per-atom mass (amu): O=15.999, H=1.008, Na=22.990, Cl=35.453
MASS = {"O": 15.999, "H": 1.008, "Na": 22.990, "Cl": 35.453}
kB = 8.617333262e-5  # eV/K
T = 300.0
masses = np.array([MASS[s] for s in symbols])
v = np.zeros_like(positions)
for sym in set(symbols):
    m = MASS[sym]
    sigma = np.sqrt(kB * T / m)
    mask = np.array([s == sym for s in symbols])
    v[mask] = rng.normal(scale=sigma, size=(mask.sum(), 3))
# Project out COM motion
v -= (v * masses[:, None]).sum(axis=0) / masses.sum()
# Convert amu*A/fs -> A/fs; actually ASE units:  v already in A/(sqrt(amu)*fs)?
# We use plain classical MD with dt in fs and positions in A; mass-weighted
# forces where F is in eV/A. Integration with m*amua = F:  m (in amu) * a (A/fs^2)
# = F (eV/A)  => multiply F by (1 amu) factor handled via the 1/m factor.
print(f"Initial KE check: 0.5*sum(m*v^2) = {0.5 * np.sum(masses[:,None] * v**2):.3f} eV")

# ---------- 4. Velocity-Verlet integrator ----------
def step(pos, vel, dt):
    # half-kick
    pe, f = lj_forces(pos, symbols, cell)
    accel = f / masses[:, None]
    vel += 0.5 * accel * dt
    pos += vel * dt
    # re-wrap into box
    pos -= cell * np.floor(pos / cell)
    pe, f = lj_forces(pos, symbols, cell)
    accel = f / masses[:, None]
    vel += 0.5 * accel * dt
    return pos, vel, pe, f

# ---------- 5. Topology + XTC writers ----------
import MDAnalysis as mda
from MDAnalysis.coordinates.XTC import XTCWriter
from ase.io import write as ase_write

# Build ASE Atoms just to write a PDB for topology
from ase import Atoms as ASEAtoms
ase_atoms = ASEAtoms(symbols=symbols, positions=positions,
                     cell=[cell]*3, pbc=True)
pdb_tmp  = os.path.join(OUT_DIR, "_tmp.pdb")
ase_write(pdb_tmp, ase_atoms, format="proteindatabank")

PDB_PATH = os.path.join(OUT_DIR, "tinybox.pdb")
XTC_PATH = os.path.join(OUT_DIR, "tinybox.xtc")
u0 = mda.Universe(pdb_tmp, guess_bonds=False)
u0.atoms.write(PDB_PATH)
print(f"PDB topology → {PDB_PATH}")

u = mda.Universe(PDB_PATH)
u.atoms.positions = positions
u.dimensions = [cell, cell, cell, 90, 90, 90]
xtc = XTCWriter(XTC_PATH, n_atoms=u.atoms.n_atoms, overwrite=True)
xtc.write(u.atoms)

# ---------- 6. Run MD ----------
dt = 0.5  # fs
n_steps = 200
energies, frames_written = [], 0
for step_i in range(n_steps):
    positions, v, pe, _ = step(positions, v, dt)
    energies.append(pe)
    if step_i % 10 == 0:
        u.atoms.positions = positions
        u.dimensions = [cell, cell, cell, 90, 90, 90]
        xtc.write(u.atoms)
        frames_written += 1
xtc.close()
print(f"MD finished: {n_steps} steps, {frames_written} frames → {XTC_PATH}")

# ---------- 7. Analysis ----------
u = mda.Universe(PDB_PATH, XTC_PATH)
print(f"Reloaded: {len(u.atoms)} atoms, {len(u.trajectory)} frames")

from MDAnalysis.analysis import rdf, msd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

ow = u.select_atoms("name O")
o_rdf = rdf.InterRDF(ow, ow, nbins=60, range=(0.0, 8.0)).run()
o_msd = msd.EinsteinMSD(ow, msd_type="xyz", fft=False).run()

# ---------- 8. Plot + JSON ----------
fig, axes = plt.subplots(1, 3, figsize=(15, 4))
axes[0].plot(energies, lw=1.0)
axes[0].set_xlabel("Step"); axes[0].set_ylabel("PE (eV)")
axes[0].set_title("Potential energy")

axes[1].plot(o_rdf.results.bins, o_rdf.results.rdf, lw=1.2, color="tab:green")
axes[1].set_xlabel("r (Å)"); axes[1].set_ylabel("g(r)")
axes[1].set_title("O–O RDF"); axes[1].axhline(1, color="k", ls=":", lw=0.6)

axes[2].plot(o_msd.results.delta_t_values, o_msd.results.timeseries, lw=1.0, color="tab:purple")
axes[2].set_xlabel("t (ps)"); axes[2].set_ylabel("MSD (Å²)")
axes[2].set_title("Oxygen MSD")
fig.tight_layout()
fig_path = os.path.join(OUT_DIR, "mda_analysis.png")
fig.savefig(fig_path, dpi=130)
plt.close(fig)

summary = {
    "system": "32 H2O + 2 Na+ + 2 Cl- in 12 A cube (self-built)",
    "n_atoms": int(len(u.atoms)),
    "n_frames": int(len(u.trajectory)),
    "n_oxygens": int(ow.n_atoms),
    "avg_PE_eV": round(float(np.mean(energies)), 4),
    "PE_drift_eV": round(float(energies[-1] - energies[0]), 4),
    "rdf_first_peak_r": round(float(o_rdf.results.bins[np.argmax(o_rdf.results.rdf)]), 2),
    "rdf_first_peak_g": round(float(o_rdf.results.rdf.max()), 3),
    "msd_final_A2":    round(float(o_msd.results.timeseries[-1]), 3),
}
json_path = os.path.join(OUT_DIR, "mda_analysis.json")
with open(json_path, "w") as f:
    json.dump(summary, f, indent=2)

print("=" * 60)
print("MDAnalysis trajectory demo")
print("=" * 60)
for k, v in summary.items():
    print(f"  {k:>20s}: {v}")
print("-" * 60)
print(f"  Plot  : {fig_path}")
print(f"  JSON  : {json_path}")
print(f"  XTC   : {XTC_PATH}")
print(f"  PDB   : {PDB_PATH}")
print("=" * 60)
