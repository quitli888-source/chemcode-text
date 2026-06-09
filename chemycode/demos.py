# -*- coding: utf-8 -*-
"""
ChemAgent — RDKit demo menu
[1] SMILES -> 3D conformer (ETKDG + MMFF94)
[2] Descriptors + Morgan/ECFP4 + MACCS Tanimoto similarity
[3] Conformer ensemble search (embed N, MMFF94-min each, RMS-prune, align to best)

Run:  python -X utf8 demos.py            (interactive menu)
      python -X utf8 demos.py --all      (run all three)
      python -X utf8 demos.py --demo 2   (run a single demo)
"""
import argparse
import json
import os
import sys
from collections import OrderedDict

from rdkit import Chem, RDLogger
from rdkit.Chem import (
    AllChem,
    Descriptors,
    Draw,
    MACCSkeys,
    rdFingerprintGenerator,
    rdMolDescriptors,
    rdMolTransforms,
    rdMolAlign,
)

RDLogger.DisableLog("rdApp.*")

OUT_DIR = r"M:\agents-for madao\ChemAgent\demo_outputs"
os.makedirs(OUT_DIR, exist_ok=True)


# ----------------------------------------------------------------------------
# Demo 1 — SMILES -> 3D
# ----------------------------------------------------------------------------
def demo_smiles_to_3d(smi: str = "CN1C=NC2=C1C(=O)N(C(=O)N2C)C") -> dict:
    """Build a 3D conformer from a SMILES string, save SDF + 2D PNG."""
    print("=" * 64)
    print("[1] SMILES -> 3D")
    print("=" * 64)

    mol = Chem.MolFromSmiles(smi)
    assert mol is not None, f"Failed to parse SMILES: {smi}"
    mol_h = Chem.AddHs(mol)

    params = AllChem.ETKDGv3()
    params.randomSeed = 42
    rc = AllChem.EmbedMolecule(mol_h, params)
    if rc != 0:
        raise RuntimeError(f"EmbedMolecule failed (rc={rc})")
    rc = AllChem.MMFFOptimizeMolecule(mol_h, maxIters=500)
    if rc == 0:
        opt = "converged"
    elif rc == 1:
        opt = "not converged (maxIters)"
    else:
        opt = f"failed (rc={rc})"

    # Save 3D SDF
    sdf_path = os.path.join(OUT_DIR, "demo1_smiles_to_3d.sdf")
    w = Chem.SDWriter(sdf_path)
    w.write(mol_h)
    w.close()

    # Save 2D depiction
    png_path = os.path.join(OUT_DIR, "demo1_smiles_to_3d.png")
    Draw.MolToFile(mol, png_path, size=(500, 500))

    conf = mol_h.GetConformer()
    coords = conf.GetPositions()
    summary = OrderedDict([
        ("smiles", smi),
        ("n_atoms_heavy", mol.GetNumHeavyAtoms()),
        ("n_atoms_with_h", mol_h.GetNumAtoms()),
        ("embedding", "ETKDGv3"),
        ("optimization", "MMFF94/" + opt),
        ("n_conformers", mol_h.GetNumConformers()),
        ("sdf", sdf_path),
        ("png", png_path),
    ])
    for k, v in summary.items():
        print(f"  {k:>15s}: {v}")
    return summary


# ----------------------------------------------------------------------------
# Demo 2 — Descriptors + Fingerprints
# ----------------------------------------------------------------------------
def _desc_dict(mol) -> dict:
    return OrderedDict([
        ("formula", rdMolDescriptors.CalcMolFormula(mol)),
        ("mw", round(Descriptors.MolWt(mol), 4)),
        ("exact_mass", round(Descriptors.ExactMolWt(mol), 4)),
        ("logP", round(Descriptors.MolLogP(mol), 4)),
        ("TPSA", round(Descriptors.TPSA(mol), 2)),
        ("HBA", Descriptors.NumHAcceptors(mol)),
        ("HBD", Descriptors.NumHDonors(mol)),
        ("rot_bonds", Descriptors.NumRotatableBonds(mol)),
        ("rings", rdMolDescriptors.CalcNumRings(mol)),
        ("aromatic_rings", rdMolDescriptors.CalcNumAromaticRings(mol)),
        ("heavy_atoms", mol.GetNumHeavyAtoms()),
        ("fraction_sp3", round(rdMolDescriptors.CalcFractionCSP3(mol), 4)),
    ])


def demo_descriptors_and_fingerprints() -> dict:
    print("=" * 64)
    print("[2] Descriptors + Morgan/ECFP4 + MACCS Tanimoto")
    print("=" * 64)

    pairs = [
        ("caffeine", "CN1C=NC2=C1C(=O)N(C(=O)N2C)C"),
        ("paracetamol", "CC(=O)Nc1ccc(O)cc1"),
        ("ibuprofen", "CC(C)Cc1ccc(C(C)C(=O)O)cc1"),
        ("aspirin", "CC(=O)Oc1ccccc1C(=O)O"),
    ]
    mols = [(name, Chem.MolFromSmiles(smi)) for name, smi in pairs]
    for name, m in mols:
        assert m is not None, f"bad SMILES for {name}"
    mols = [(name, Chem.AddHs(m)) for name, m in mols]
    for _, m in mols:
        AllChem.EmbedMolecule(m, AllChem.ETKDGv3())
        AllChem.MMFFOptimizeMolecule(m)

    # Descriptors
    descs = {name: _desc_dict(m) for name, m in mols}

    # Fingerprints
    mfpgen = rdFingerprintGenerator.GetMorganGenerator(radius=2, fpSize=2048)
    morgan_fps = {name: mfpgen.GetFingerprint(m) for name, m in mols}
    maccs_fps = {name: MACCSkeys.GenMACCSKeys(m) for name, m in mols}

    def _tanimoto_matrix(fps):
        names = list(fps.keys())
        n = len(names)
        mat = [[0.0] * n for _ in range(n)]
        for i in range(n):
            for j in range(n):
                mat[i][j] = round(DataStructs.TanimotoSimilarity(fps[names[i]], fps[names[j]]), 4)
        return names, mat

    from rdkit import DataStructs
    m_names, m_mat = _tanimoto_matrix(morgan_fps)
    k_names, k_mat = _tanimoto_matrix(maccs_fps)

    out = {
        "descriptors": descs,
        "morgan_tanimoto": {"names": m_names, "matrix": m_mat},
        "maccs_tanimoto":  {"names": k_names, "matrix": k_mat},
    }
    json_path = os.path.join(OUT_DIR, "demo2_descriptors_fp.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)

    # Pretty print
    print("  --- Descriptors (selected) ---")
    for name in [n for n, _ in mols]:
        d = descs[name]
        print(f"  {name:>12s}  MW={d['mw']:7.3f}  logP={d['logP']:+5.2f}  "
              f"TPSA={d['TPSA']:5.1f}  HBD={d['HBD']}  HBA={d['HBA']}  rotB={d['rot_bonds']}")
    print("\n  --- Morgan/ECFP4 Tanimoto ---")
    print("             " + "  ".join(f"{n[:8]:>8s}" for n in m_names))
    for i, n in enumerate(m_names):
        print(f"  {n[:10]:>10s}  " + "  ".join(f"{v:8.4f}" for v in m_mat[i]))
    print(f"\n  JSON -> {json_path}")
    return out


# ----------------------------------------------------------------------------
# Demo 3 — Conformer ensemble search
# ----------------------------------------------------------------------------
def demo_conformer_search(
    smi: str = "CN1C=NC2=C1C(=O)N(C(=O)N2C)C",
    n_confs: int = 50,
    rms_thresh: float = 0.5,
) -> dict:
    """
    1. Embed n_confs conformers with ETKDGv3
    2. MMFF94-minimize each
    3. Pick lowest-energy conformer as reference
    4. RMS-prune to a diverse ensemble below rms_thresh
    5. Align all pruned conformers to the reference
    """
    from rdkit import DataStructs
    print("=" * 64)
    print(f"[3] Conformer ensemble search  (n={n_confs}, RMS<{rms_thresh})")
    print("=" * 64)

    mol = Chem.MolFromSmiles(smi)
    assert mol is not None, f"Failed to parse SMILES: {smi}"
    mol = Chem.AddHs(mol)

    params = AllChem.ETKDGv3()
    params.randomSeed = 42
    params.numThreads = 0
    cids = AllChem.EmbedMultipleConfs(mol, numConfs=n_confs, params=params)
    if len(cids) == 0:
        raise RuntimeError("EmbedMultipleConfs produced zero conformers")

    # MMFF-min each
    results = AllChem.MMFFOptimizeMoleculeConfs(mol, maxIters=500)
    # results is list of (converged, energy) per cid

    energies = {cid: res[1] for cid, res in zip(cids, results)}
    ref_cid = min(energies, key=energies.get)

    # RMS-prune
    keep = [ref_cid]
    for cid in cids:
        if cid == ref_cid:
            continue
        rms_min = min(
            rdMolAlign.GetBestRMS(mol, mol, prbId=cid, refId=k)
            for k in keep
        )
        if rms_min >= rms_thresh:
            keep.append(cid)

    # Align keep -> ref (no sym — caffeine is small + achiral-friendly; for chiral inputs use GetO3AForProbes)
    for cid in keep:
        if cid == ref_cid:
            continue
        rdMolAlign.AlignMol(mol, refId=ref_cid, prbCid=cid)

    # Save ensemble
    sdf_path = os.path.join(OUT_DIR, "demo3_conformers.sdf")
    w = Chem.SDWriter(sdf_path)
    for cid in keep:
        w.write(mol, confId=cid)
    w.close()

    # Re-compute RMSD matrix for kept conformers (post-alignment)
    n = len(keep)
    rms_mat = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            if i == j:
                continue
            rms_mat[i][j] = round(
                rdMolAlign.GetBestRMS(mol, mol, prbId=keep[j], refId=keep[i]), 4
            )

    summary = OrderedDict([
        ("smiles", smi),
        ("n_embedded", len(cids)),
        ("ref_cid", int(ref_cid)),
        ("ref_energy_kcal", round(energies[ref_cid], 3)),
        ("n_kept", len(keep)),
        ("rms_thresh_A", rms_thresh),
        ("sdf", sdf_path),
        ("rmsd_matrix_ids", [int(c) for c in keep]),
        ("rmsd_matrix", rms_mat),
    ])

    print(f"  embedded          : {len(cids)}")
    print(f"  reference cid     : {ref_cid}  (E = {energies[ref_cid]:.3f} kcal/mol)")
    print(f"  pruned ensemble   : {len(keep)} conformers (RMS >= {rms_thresh} A)")
    print(f"  sdf               : {sdf_path}")
    print(f"  post-align RMSD matrix (i=row=probe, j=ref):")
    print("    " + "  ".join(f"{c:6d}" for c in keep))
    for i, row in enumerate(rms_mat):
        print(f"  {keep[i]:3d}  " + "  ".join(f"{v:6.3f}" for v in row))
    return summary


# ----------------------------------------------------------------------------
# Menu
# ----------------------------------------------------------------------------
def _run(idx: int) -> None:
    if idx == 1:
        demo_smiles_to_3d()
    elif idx == 2:
        demo_descriptors_and_fingerprints()
    elif idx == 3:
        demo_conformer_search()
    else:
        print(f"Unknown demo: {idx}")


def main() -> int:
    ap = argparse.ArgumentParser(description="RDKit demo menu")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--demo", type=int, choices=[1, 2, 3], help="run a single demo")
    g.add_argument("--all", action="store_true", help="run all demos sequentially")
    args = ap.parse_args()

    if args.demo is not None:
        _run(args.demo)
        return 0
    if args.all:
        for i in (1, 2, 3):
            _run(i)
            print()
        return 0

    # Interactive
    print("RDKit demos:")
    print("  [1] SMILES -> 3D")
    print("  [2] Descriptors + Morgan/ECFP4 + MACCS Tanimoto")
    print("  [3] Conformer ensemble search (embed / min / RMS-prune / align)")
    while True:
        try:
            raw = input("Select demo [1-3] (q=quit): ").strip().lower()
        except EOFError:
            return 0
        if raw in ("q", "quit", "exit"):
            return 0
        if raw in ("1", "2", "3"):
            _run(int(raw))
            print()
        else:
            print("Please enter 1, 2, 3, or q.")


if __name__ == "__main__":
    sys.exit(main())
