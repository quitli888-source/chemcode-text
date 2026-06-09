"""
Demo 1: RDKit small-molecule chemistry
- Build caffeine from SMILES
- Generate 3D conformer with ETKDG + MMFF94 minimization
- Compute physicochemical descriptors
- Save 3D SDF, 2D depiction PNG, descriptor JSON
- Print a human-readable summary
"""
import json
import os
from rdkit import Chem, RDLogger
from rdkit.Chem import AllChem, Descriptors, Draw, rdMolDescriptors

RDLogger.DisableLog("rdApp.*")  # quiet RDKit chatter

OUT_DIR = r"M:\agents-for madao\ChemAgent\demo_outputs"
os.makedirs(OUT_DIR, exist_ok=True)

# --- 1. Build molecule from SMILES ---
smi = "CN1C=NC2=C1C(=O)N(C(=O)N2C)C"  # caffeine
mol = Chem.MolFromSmiles(smi)
assert mol is not None, "Failed to parse SMILES"
mol = Chem.AddHs(mol)

# --- 2. Generate 3D conformer ---
params = AllChem.ETKDGv3()
params.randomSeed = 42
AllChem.EmbedMolecule(mol, params)
AllChem.MMFFOptimizeMolecule(mol, maxIters=500)

# --- 3. Compute descriptors ---
desc = {
    "name": "caffeine",
    "smiles": smi,
    "formula": rdMolDescriptors.CalcMolFormula(mol),
    "exact_mass": round(Descriptors.ExactMolWt(mol), 4),
    "mw": round(Descriptors.MolWt(mol), 4),
    "logP": round(Descriptors.MolLogP(mol), 4),
    "TPSA": round(Descriptors.TPSA(mol), 2),
    "HBA": Descriptors.NumHAcceptors(mol),
    "HBD": Descriptors.NumHDonors(mol),
    "rot_bonds": Descriptors.NumRotatableBonds(mol),
    "rings": rdMolDescriptors.CalcNumRings(mol),
    "aromatic_rings": rdMolDescriptors.CalcNumAromaticRings(mol),
    "heavy_atoms": mol.GetNumHeavyAtoms(),
    "fraction_sp3": round(rdMolDescriptors.CalcFractionCSP3(mol), 4),
}

# --- 4. Save outputs ---
sdf_path = os.path.join(OUT_DIR, "caffeine_3d.sdf")
writer = Chem.SDWriter(sdf_path)
writer.write(mol)
writer.close()

# 2D depiction (re-strip Hs for clarity)
mol2d = Chem.MolFromSmiles(smi)
png_path = os.path.join(OUT_DIR, "caffeine_2d.png")
Draw.MolToFile(mol2d, png_path, size=(500, 500))

json_path = os.path.join(OUT_DIR, "caffeine_descriptors.json")
with open(json_path, "w") as f:
    json.dump(desc, f, indent=2)

# --- 5. Report ---
print("=" * 60)
print("CAFFEINE — RDKit small-molecule demo")
print("=" * 60)
for k, v in desc.items():
    print(f"  {k:>15s}: {v}")
print("-" * 60)
print(f"  3D SDF        : {sdf_path}")
print(f"  2D PNG        : {png_path}")
print(f"  Descriptors   : {json_path}")
print("=" * 60)
