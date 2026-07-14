"""
Demo 1: Visualize a water molecule (H2O) in 3D
This shows basic molecular structure handling and matplotlib 3D plotting.
"""
import numpy as np
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d import Axes3D

# H2O geometry (from experiment)
# O at origin, H-O-H angle = 104.5 degrees, O-H bond length = 0.958 Angstrom
o_pos = np.array([0.0, 0.0, 0.0])
h1_pos = np.array([0.958, 0.0, 0.0])
angle = np.deg2rad(104.5)
h2_pos = np.array([0.958 * np.cos(angle), 0.958 * np.sin(angle), 0.0])

# Atom properties
atoms = [
    {'name': 'O',  'pos': o_pos,  'color': 'red',    'size': 600, 'label': 'O'},
    {'name': 'H1', 'pos': h1_pos, 'color': 'white',   'size': 300, 'label': 'H'},
    {'name': 'H2', 'pos': h2_pos, 'color': 'white',   'size': 300, 'label': 'H'},
]

# Compute geometric properties
bond_length = np.linalg.norm(h1_pos - o_pos)
angle_deg = np.degrees(np.arccos(np.dot(h1_pos - o_pos, h2_pos - o_pos) /
                                  (np.linalg.norm(h1_pos - o_pos) *
                                   np.linalg.norm(h2_pos - o_pos))))

# Plot
fig = plt.figure(figsize=(10, 8))
ax = fig.add_subplot(111, projection='3d')

# Draw atoms
for atom in atoms:
    ax.scatter(*atom['pos'], c=atom['color'], s=atom['size'],
               edgecolors='black', linewidths=1.5, alpha=0.9)
    ax.text(*atom['pos'] * 1.15, atom['label'], fontsize=14, ha='center',
            fontweight='bold')

# Draw bonds
for a, b in [(0, 1), (0, 2)]:
    p1, p2 = atoms[a]['pos'], atoms[b]['pos']
    mid = (p1 + p2) / 2
    ax.plot([p1[0], p2[0]], [p1[1], p2[1]], [p1[2], p2[2]],
            'k-', linewidth=2.5)

# Cosmetics
ax.set_xlabel('X (Å)', fontsize=11)
ax.set_ylabel('Y (Å)', fontsize=11)
ax.set_zlabel('Z (Å)', fontsize=11)
ax.set_title(f'Water Molecule (H₂O) - 3D Structure\n'
             f'O-H bond: {bond_length:.3f} Å  |  H-O-H angle: {angle_deg:.1f}°',
             fontsize=13, fontweight='bold')
ax.set_box_aspect([1, 1, 0.5])
ax.view_init(elev=20, azim=30)

# Save
out = 'water_molecule_3d.png'
plt.tight_layout()
plt.savefig(out, dpi=150, bbox_inches='tight')
plt.close()

print(f"✅ Saved: {out}")
print(f"   O-H bond length : {bond_length:.4f} Å")
print(f"   H-O-H angle     : {angle_deg:.2f}°")
print(f"   Molecular mass  : 18.015 g/mol")
print(f"   Geometry        : C₂v (bent)")
