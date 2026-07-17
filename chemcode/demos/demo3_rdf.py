"""
Demo 3: Compute the Radial Distribution Function g(r) of a simple cubic crystal.

This demonstrates trajectory / configuration analysis using pure NumPy
(no external chemistry library needed) — showing the algorithmic core of
RDF computation that we also use in pygamd-skill-v4's analyze_trajectory.py.
"""
import numpy as np
import matplotlib.pyplot as plt

rng = np.random.default_rng(0)

# --- Build a simple cubic lattice (FCC would be more realistic, but SC is illustrative) ---
a = 1.0                       # lattice constant (Å)
nx = ny = nz = 6              # 6x6x6 = 216 atoms
xs, ys, zs = np.meshgrid(
    np.arange(nx) * a,
    np.arange(ny) * a,
    np.arange(nz) * a,
    indexing='ij'
)
positions = np.stack([xs.ravel(), ys.ravel(), zs.ravel()], axis=1)

# Small thermal noise (simulating a finite-T MD snapshot)
positions += rng.normal(0, 0.05, positions.shape)

n_atoms  = len(positions)
box_l    = nx * a
rho      = n_atoms / box_l**3
r_max    = box_l / 2  # max distance for RDF = half box
n_bins   = 200
dr       = r_max / n_bins
r_edges  = np.linspace(0, r_max, n_bins + 1)
r_mids   = 0.5 * (r_edges[:-1] + r_edges[1:])

# --- Compute pair distances under PBC ---
# Build neighbor cells (simple cubic → 27 cells including self)
shifts = np.array([(i, j, k) for i in (-1, 0, 1)
                              for j in (-1, 0, 1)
                              for k in (-1, 0, 1)]) * box_l

# For each atom, count neighbors in each radial bin
hist = np.zeros(n_bins, dtype=np.int64)
# To avoid O(N^2) blowup we use cell lists
nc = 3                              # we keep it small & explicit
cell_size = box_l / nc
positions_wrapped = positions % box_l
head = -np.ones(nc**3, dtype=np.int64)
linked_list = -np.ones(n_atoms, dtype=np.int64)

def cell_id(pos):
    ix, iy, iz = (pos // cell_size).astype(int) % nc
    return (ix * nc + iy) * nc + iz

# Build cell list
for i, p in enumerate(positions_wrapped):
    c = cell_id(p)
    linked_list[i] = head[c]
    head[c] = i

# Compute g(r)
for i in range(n_atoms):
    ci = cell_id(positions_wrapped[i])
    ix_c, iy_c, iz_c = (positions_wrapped[i] // cell_size).astype(int)
    # Loop over 27 neighboring cells
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                jx, jy, jz = (ix_c + dx) % nc, (iy_c + dy) % nc, (iz_c + dz) % nc
                cj = (jx * nc + jy) * nc + jz
                j = head[cj]
                while j != -1:
                    if j > i:  # avoid double counting
                        d = positions[j] - positions[i]
                        d -= np.round(d / box_l) * box_l  # minimum image
                        r = np.linalg.norm(d)
                        if 0 < r < r_max:
                            bin_idx = int(r // dr)
                            if bin_idx < n_bins:
                                hist[bin_idx] += 2  # count both i->j and j->i
                    j = linked_list[j]

# --- Normalize ---
# Ideal-gas shell volume
shell_vol  = 4 * np.pi * r_mids**2 * dr
g_r        = hist / (n_atoms * rho * shell_vol)

# --- Plot ---
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))

# Full RDF
ax1.plot(r_mids, g_r, 'b-', linewidth=1.2)
ax1.axhline(1.0, color='gray', linestyle='--', alpha=0.6, label='ideal gas')
ax1.set_xlabel('r (Å)', fontsize=12)
ax1.set_ylabel('g(r)', fontsize=12)
ax1.set_title(f'Radial Distribution Function\n'
              f'{n_atoms} atoms, simple cubic, T≈low', fontsize=13, fontweight='bold')
ax1.set_xlim(0, r_max)
ax1.set_ylim(0, max(g_r[5:]) * 1.1)
ax1.legend()
ax1.grid(alpha=0.3)

# Zoom on first peak
ax2.plot(r_mids, g_r, 'r-', linewidth=1.2)
ax2.axvline(1.0, color='black', linestyle=':', alpha=0.6, label='nearest neighbor (a=1.0 Å)')
ax2.axvline(np.sqrt(2), color='purple', linestyle=':', alpha=0.6, label='2nd neighbor (a√2)')
ax2.axvline(np.sqrt(3), color='green', linestyle=':', alpha=0.6, label='3rd neighbor (a√3)')
ax2.set_xlabel('r (Å)', fontsize=12)
ax2.set_ylabel('g(r)', fontsize=12)
ax2.set_title('First-Shell Peaks\n(SC lattice structure factors)', fontsize=13, fontweight='bold')
ax2.set_xlim(0, 3.5)
ax2.legend()
ax2.grid(alpha=0.3)

plt.tight_layout()
plt.savefig('rdf_analysis.png', dpi=150, bbox_inches='tight')
plt.close()

# Report
peak1_r = r_mids[np.argmax(g_r[:30])]
peak1_g = g_r.max()
print("✅ Generated: rdf_analysis.png")
print(f"   System: Simple cubic, {n_atoms} atoms, a = {a} Å")
print(f"   Number density: ρ = {rho:.4f} atoms/Å³")
print(f"   First peak: r = {peak1_r:.2f} Å, g(r) = {peak1_g:.2f}")
print(f"   (Expect strong peak at r = 1.0 Å = a for SC lattice)")
print()
print("   How this connects to the pygamd-skill-v4:")
print("   • The same algorithm is in analyze_trajectory.py of the skill")
print("   • Production RDF: O(N) with cell lists + PBC minimum image")
print("   • Used to identify phases, validate simulations, compute structure factor S(k)")
