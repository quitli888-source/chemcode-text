#!/usr/bin/env python3
"""
PyGAMD DPD 模拟示例脚本（pygamd 1.4.8）
AB 两嵌段共聚物自组装完整工作流。

API、参数表、黑名单 → 参考 SKILL.md
"""
import numpy as np

# 固定随机种子（在任何 np.random 调用之前），保证初始配置可复现
np.random.seed(42)


# ---------------------------------------------------------------------------
# 1. 导入 PyGAMD
# ---------------------------------------------------------------------------
try:
    import pygamd
except ImportError as exc:
    raise SystemExit(
        "PyGAMD 未安装。请先按 README 安装 PyGAMD，并确认当前 Python 环境可 import pygamd。"
    ) from exc


# ---------------------------------------------------------------------------
# 2. 生成初始 XML 配置（AB 两嵌段共聚物，nchains=50, nbeads=100, fA=0.5）
# ---------------------------------------------------------------------------
def create_ab_copolymer_xml(nchains=50, nbeads=100, fA=0.5, rho=3.0, output_file="config.xml"):
    """生成 AB 两嵌段共聚物初始 XML 配置。"""
    N = nchains * nbeads
    L = (N / rho) ** (1.0 / 3.0)
    nA = int(nbeads * fA)

    positions, velocities, types, bonds = [], [], [], []
    atom_id = 0
    for _ in range(nchains):
        prev = np.random.uniform(-L / 2, L / 2, 3)
        for i in range(nbeads):
            if i == 0:
                pos = prev
            else:
                pos = prev + 0.5 * np.random.randn(3)
                pos = np.where(pos > L / 2, pos - L, pos)
                pos = np.where(pos < -L / 2, pos + L, pos)
            positions.append(pos)
            velocities.append(np.random.randn(3) * 0.1)
            types.append('A' if i < nA else 'B')
            if i > 0:
                bonds.append(['bond1', atom_id - 1, atom_id])
            prev = pos
            atom_id += 1

    with open(output_file, 'w') as f:
        f.write('<galamost_xml version="1.3">\n')
        f.write(f'<configuration time_step="0" natoms="{N}">\n')
        f.write(f'<box lx="{L}" ly="{L}" lz="{L}"/>\n')
        f.write('<position>\n')
        for p in positions:
            f.write(f'{p[0]:.6f} {p[1]:.6f} {p[2]:.6f}\n')
        f.write('</position>\n<velocity>\n')
        for v in velocities:
            f.write(f'{v[0]:.6f} {v[1]:.6f} {v[2]:.6f}\n')
        f.write('</velocity>\n<type>\n')
        for t in types:
            f.write(f'{t}\n')
        f.write('</type>\n<bond>\n')
        for b in bonds:
            f.write(f'{b[0]} {b[1]} {b[2]}\n')
        f.write('</bond>\n</configuration>\n</galamost_xml>\n')

    print(f"初始配置已生成: {output_file} (N={N}, L={L:.2f})")
    return output_file


# ---------------------------------------------------------------------------
# 3. 运行 DPD 模拟
# ---------------------------------------------------------------------------
def run_dpd_simulation(config_file, n_equil=5000, n_prod=20000, dt=0.005):
    """运行 AB 共聚物 DPD 自组装模拟。"""
    # 读取快照
    snap = pygamd.snapshot.read(config_file)
    print(f"系统: {snap.npa} 粒子, 类型={getattr(snap, 'ntypes', '?')}, 盒子={snap.box}")

    # DPD 力场（A-A / B-B 同组分排斥 alpha=25，A-B 异组分 alpha=30 触发相分离）
    dpd = pygamd.force.dpd(info=snap, rcut=1.0)
    dpd.setParams(type_i="A", type_j="A", alpha=25.0, sigma=3.0)
    dpd.setParams(type_i="B", type_j="B", alpha=25.0, sigma=3.0)
    dpd.setParams(type_i="A", type_j="B", alpha=30.0, sigma=3.0)

    # Harmonic 键势（pygamd 不支持 fene）
    bond = pygamd.force.bond(info=snap, func='harmonic')
    bond.setParams(bond_type="bond1", param=[100.0, 0.5])

    # GWVV 积分器（DPD 专用）
    integrator = pygamd.integration.gwvv(info=snap, group="all")

    # XML 轨迹输出
    dump = pygamd.dump.xml(info=snap, group="all", file='trajectory', period=1000)

    # 应用：app.add() 不加方括号，逐个 add
    app = pygamd.application.dynamics(snap, dt=dt)
    app.add(dpd)
    app.add(bond)
    app.add(integrator)
    app.add(dump)

    # 平衡
    print(f"开始平衡: {n_equil} 步")
    app.run(n_equil)
    print("平衡完成")

    # 生产
    print(f"开始生产: {n_prod} 步")
    app.run(n_prod)
    print("生产完成")
    print(f"输出: trajectory.*.xml")


def main():
    # 随机种子已固定在模块顶部（保证 create_ab_copolymer_xml 的可复现性）
    config = create_ab_copolymer_xml(nchains=50, nbeads=100, fA=0.5, rho=3.0)
    run_dpd_simulation(config, n_equil=5000, n_prod=20000, dt=0.005)


if __name__ == "__main__":
    main()
