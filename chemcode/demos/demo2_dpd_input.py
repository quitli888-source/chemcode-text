"""
Demo 2: Generate a DPD input configuration for AB diblock copolymer melt.

This creates:
  - 2000 particles, 50/50 AB diblock, 10 chains of length 20
  - Box size 10x10x10 in DPD reduced units
  - Groot-Warren parameters
"""
import numpy as np

# --- System parameters ---
n_chains      = 200          # number of chains
chain_length  = 20           # beads per chain
n_particles   = n_chains * chain_length
box_size      = 10.0         # reduced units
n_A_per_chain = chain_length // 2  # 10 A + 10 B
kBT           = 1.0          # reduced units

# --- Set up RNG for reproducibility ---
rng = np.random.default_rng(42)

# --- Place chains in the box (random walks) ---
positions = []
bonds     = []  # (i, j, type)
chain_id_of_particle = []
bond_type_for_chain  = []

particle_idx = 0
for c in range(n_chains):
    # Random start point
    start = rng.uniform(0, box_size, size=3)
    chain_beads = [start]
    for b in range(1, chain_length):
        # Random step
        step = rng.normal(0, 0.3, size=3)
        new_pos = chain_beads[-1] + step
        # Wrap into box
        new_pos = new_pos % box_size
        chain_beads.append(new_pos)
    chain_beads = np.array(chain_beads)

    # Record bonds (consecutive beads along the chain)
    for k in range(chain_length - 1):
        bonds.append((particle_idx + k, particle_idx + k + 1, 1))  # type 1 = harmonic

    positions.extend(chain_beads)
    chain_id_of_particle.extend([c] * chain_length)
    bond_type_for_chain.append('diblock_AB')
    particle_idx += chain_length

positions = np.array(positions)
chain_id  = np.array(chain_id_of_particle)

# Assign particle types: 0=A, 1=B
# For a symmetric diblock: first n_A_per_chain beads are A, rest are B
bead_in_chain = np.tile(np.arange(chain_length), n_chains)
type_id = np.where(bead_in_chain < n_A_per_chain, 0, 1)

# --- Write LAMMPS-style data file (readable by many MD engines incl. PyGAMD) ---
out = 'diblock_dpd.data'
with open(out, 'w') as f:
    f.write('DPD AB Diblock Copolymer Melt\n\n')
    f.write(f'{n_particles} atoms\n')
    f.write(f'{len(bonds)} bonds\n\n')
    f.write('2 atom types\n1 bond types\n\n')
    f.write(f'0.0 {box_size} xlo xhi\n')
    f.write(f'0.0 {box_size} ylo yhi\n')
    f.write(f'0.0 {box_size} zlo zhi\n\n')
    f.write('Masses\n\n')
    f.write('1 1.0\n2 1.0\n\n')
    f.write('Atoms # full\n\n')
    for i in range(n_particles):
        # atom-id mol-id atom-type charge x y z
        f.write(f'{i+1} {chain_id[i]+1} {type_id[i]+1} 0.0 '
                f'{positions[i,0]:.6f} {positions[i,1]:.6f} {positions[i,2]:.6f}\n')
    f.write('\nBonds\n\n')
    for b_id, (i, j, t) in enumerate(bonds):
        f.write(f'{b_id+1} {t} {i+1} {j+1}\n')

# --- Write a PyGAMD-style run script ---
# API aligned with pygamd-skill-v4/SKILL.md (pygamd 1.4.8 correct API)
script_out = 'demo_dpd_run.py'
with open(script_out, 'w') as f:
    f.write('''
import pygamd
import numpy as np

# --- Initialize ---
snap = pygamd.snapshot.read("diblock_dpd.data")
snap.resize_box(box_l=10.0)

# --- DPD force field (Groot-Warren) ---
# A-A: a=25, A-B: a=35, B-B: a=25
dpd = pygamd.force.dpd(info=snap, rcut=1.0)
dpd.setParams(type_i="A", type_j="A", alpha=25.0, sigma=4.5)
dpd.setParams(type_i="A", type_j="B", alpha=35.0, sigma=4.5)
dpd.setParams(type_i="B", type_j="B", alpha=25.0, sigma=4.5)

# --- Harmonic bonds for chains ---
bond = pygamd.force.bond(info=snap, func='harmonic')
bond.setParams(bond_type="bond1", param=[4.0, 1.0])   # k=4, r0=1 (in DPD units)

# --- Integrator (GWVV, DPD-specific) ---
integrator = pygamd.integration.gwvv(info=snap, group="all")

# --- Trajectory output (XML format) ---
dump = pygamd.dump.xml(info=snap, group="all", file='traj', period=1000)

# --- Application ---
app = pygamd.application.dynamics(snap, dt=0.005)
app.add(dpd)
app.add(bond)
app.add(integrator)
app.add(dump)

# --- Run ---
app.run(10000)
print("Done. Trajectory -> traj.*.xml")
''')

# --- Report ---
print(f"✅ Generated DPD input files")
print(f"   ├─ System: AB diblock copolymer")
print(f"   ├─ {n_chains} chains × {chain_length} beads = {n_particles} particles")
print(f"   ├─ Box: {box_size}³ (DPD reduced units)")
print(f"   ├─ Number density ρ* = {n_particles / box_size**3:.2f}")
print(f"   ├─ Particle types: 0=A (n={np.sum(type_id==0)}), 1=B (n={np.sum(type_id==1)})")
print(f"   ├─ Bonds: {len(bonds)} (harmonic, k=4.0, r0=1.0)")
print(f"   └─ Files: {out}, {script_out}")
print()
print("   DPD parameters (Groot-Warren):")
print("   ├─ a_AA = 25.0  (repulsion within A blocks)")
print("   ├─ a_AB = 35.0  (stronger repulsion between A & B → microphase separation)")
print("   └─ a_BB = 25.0  (repulsion within B blocks)")
print()
print("   This setup is classic for studying self-assembly into")
print("   lamellar / gyroid / cylindrical phases.")
