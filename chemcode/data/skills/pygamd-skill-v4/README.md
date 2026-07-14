# PyGAMD Skill

PyGAMD分子动力学模拟技能包，特别适合软物质和聚合物DPD模拟。

## 功能特性

- **完整的DPD模拟工作流程**：从初始配置到数据分析
- **双计算后端支持**：Numba（CPU）和CUDA（GPU）
- **丰富的力场支持**：DPD、LJ、FENE键势等
- **强大的数据分析工具**：RDF、MSD、回转半径等
- **详细的示例代码**：可直接运行的完整示例

## 目录结构

```
pygamd/
├── SKILL.md                    # 主要技能文档
├── README.md                   # 本文件
├── scripts/                    # 示例脚本
│   ├── example_dpd_simulation.py   # DPD模拟示例
│   └── analyze_trajectory.py       # 轨迹分析示例
├── references/                 # 参考文档
│   └── quick_reference.md         # 快速参考指南
└── assets/                     # 资源文件
```

## 快速开始

### 1. 安装PyGAMD

```bash
# 从源码安装
git clone https://github.com/PyGAMD/PyGAMD.git
cd PyGAMD
pip install .
```

### 2. 运行示例

```bash
# 运行DPD模拟示例
python scripts/example_dpd_simulation.py

# 分析轨迹
python scripts/analyze_trajectory.py
```

### 3. 查看文档

- **SKILL.md** - 完整的使用指南
- **references/quick_reference.md** - 快速参考

## 使用场景

> **⚠️ 本节代码已对齐到 SKILL.md 正确 API**（pygamd 1.4.8）。完整工作流与黑名单见 SKILL.md。

### 1. AB两嵌段共聚物自组装

```python
# 1. GPU 初始化（必须在 import pygamd 之前）
from pygamd_gpu_init import init_gpu; init_gpu()
import pygamd

# 2. 读取配置
snap = pygamd.snapshot.read("initial_config.xml")

# 3. 设置 DPD 力场
dpd = pygamd.force.dpd(info=snap, rcut=1.0)
dpd.setParams(type_i="A", type_j="A", alpha=25.0, sigma=4.5)
dpd.setParams(type_i="B", type_j="B", alpha=25.0, sigma=4.5)
dpd.setParams(type_i="A", type_j="B", alpha=30.0, sigma=4.5)

# 4. 积分器 + 输出 + 应用（注意：app.add 不加方括号）
integrator = pygamd.integration.gwvv(info=snap, group="all")
dump = pygamd.dump.xml(info=snap, group="all", file='trajectory', period=1000)
app = pygamd.application.dynamics(snap, dt=0.005)
app.add(dpd)
app.add(integrator)
app.add(dump)
app.run(100000)
```

### 2. 均聚物熔体模拟

```python
# 添加 harmonic 键势（pygamd 不支持 fene）
bond = pygamd.force.bond(info=snap, func='harmonic')
bond.setParams(bond_type="bond1", param=[100.0, 0.5])  # [k, r0]
app.add(bond)
```

### 3. 两相系统研究

```python
# 设置强排斥相互作用
dpd.setParams(type_i="A", type_j="B", alpha=40.0, sigma=4.5)  # 强排斥
```

## 分析工具

> **⚠️ pygamd 1.4.8 不提供 `analysis` 子模块**。`__init__.py` 仅导出 `application / chare / force / integration / plist / snapshot / tinker / dump`。
> 请使用外部工具：
>
> - **OVITO**（`pip install ovito`）：RDF / MSD / Rg / CNA / 配位数
> - **MDAnalysis**（`pip install MDAnalysis`）：通用轨迹分析
> - **smart_visualize.py**（本 skill 自带）：OVITO 智能可视化脚本
>
> 完整可视化与轨迹分析示例见 `scripts/analyze_trajectory.py` 和 `scripts/smart_visualize.py`。

## 参数调优指南

> **物理正确性**：详细量纲、守恒律 self-check、温度换算与参数化方法学见 [SKILL.md](SKILL.md)。
>
> - [DPD 约化单位下的量纲](SKILL.md#dpd约化单位下的量纲) — rcut/alpha/sigma/gamma/kT/rho/dt 的量纲与典型值
> - [守恒律 self-check](SKILL.md#守恒律-self-check物理正确性验证) — NVE 能量漂移 < 1e-4/10k 步、NVT 温度涨落 < 5%、涨落-耗散 σ²=2γk_BT、压强 virial
> - [温度单位换算 (DPD T* ↔ 物理 K)](SKILL.md#温度单位换算dpd-t-↔-物理-k) — 特征长度/能量依赖的 T 换算
> - [参数化方法学](SKILL.md#参数化方法学) — Groot-Warren / Blokhuis / Maiti 三种映射的差异与适用场景
>
> **R3 严苛物理（新增）**：
> - [显式物理稳定性判据](SKILL.md#显式物理稳定性判据) — dt 上限 / rcut / skin / ρ* / 各向异性比值的硬阈值
> - [量级典型范围对照表](SKILL.md#量级典型范围对照表round-3-严苛化) — DPD α/γ/σ、bond/angle/dihedral、ρ*、dt 的"错就是错"基线
> - [异常检测与告警](SKILL.md#异常检测与告警round-3-严苛化) — T>2% / NaN / ρ drift / dt 4 级告警与终止条件

### DPD相互作用参数

| 相互作用 | 保守力系数 A | 耗散系数 γ | 说明 |
|----------|-------------|-----------|------|
| A-A      | 25.0        | 4.5       | 相同组分排斥 |
| B-B      | 25.0        | 4.5       | 相同组分排斥 |
| A-B      | 30.0-35.0   | 4.5       | 不同组分排斥（更强） |

### 时间步长选择

- **DPD模拟**：dt = 0.005 - 0.01（DPD单位）
- **标准MD**：dt = 0.001 - 0.002（取决于力场）

### 温度控制

- **DPD温度**：T = 1.0（约化单位）
- **恒温器时间常数**：tau = 0.5 - 1.0

## 常见问题

### 1. 内存不足

- 减少粒子数量
- 使用更频繁的输出
- 使用GPU加速

### 2. 模拟不稳定

- 减小时间步长
- 增加能量最小化步骤
- 检查初始配置

### 3. 相分离不明显

- 增大A-B排斥系数
- 增加模拟步数
- 降低温度

## 参考文献

1. Groot, R. D., & Warren, P. B. (1997). Dissipative particle dynamics: Bridging the gap between atomistic and mesoscopic simulation. *The Journal of Chemical Physics*, 107(11), 4423-4435.

2. PyGAMD官方文档: https://pygamd-v1.readthedocs.io/

3. PyGAMD GitHub: https://github.com/PyGAMD/PyGAMD

## 相关工具

- **LAMMPS** - 通用分子动力学软件
- **HOOMD-blue** - GPU加速分子动力学
- **OpenMM** - 生物分子模拟
- **MDAnalysis** - 轨迹分析工具

## 许可证

本技能包基于MIT许可证开源。

## 联系方式

如有问题或建议，请通过GitHub Issues反馈。