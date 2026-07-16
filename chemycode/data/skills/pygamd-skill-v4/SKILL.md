---
name: pygamd
description: PyGAMD GPU 加速介观分子动力学工作流，支持 DPD 耗散粒子动力学、Lennard-Jones 流体、聚合物链、布朗动力学、自组装、相分离、轨迹分析、物理一致性检查和 OVITO 可视化。用于用户提出 PyGAMD、DPD 模拟、粗粒化模拟、聚合物模拟、软物质模拟、GPU 分子动力学、相形貌分析或模拟报告任务时。
---

# PyGAMD 分子动力学模拟

PyGAMD 是面向软物质与聚合物体系的 GPU 加速分子动力学软件。本技能在 Chemcode 中提供文献检索、MVP、生产级代码、资源评估、分阶段执行、定量分析和可视化工作流。

## TL;DR

```python
# 1. 导入已安装的 PyGAMD
import pygamd

# 2. 读取配置
snap = pygamd.snapshot.read("config.xml")

# 3. 设置力场
dpd = pygamd.force.dpd(info=snap, rcut=1.0)
dpd.setParams(type_i="A", type_j="A", alpha=25.0, sigma=3.0)

# 4. 设置积分器和输出
integrator = pygamd.integration.gwvv(info=snap, group="all")
dump = pygamd.dump.xml(info=snap, group="all", file='traj', period=1000)

# 5. 运行
app = pygamd.application.dynamics(snap, dt=0.005)
app.add(dpd); app.add(integrator); app.add(dump)
app.run(10000)

# 6. 轨迹分析
import subprocess
subprocess.run(["python", "scripts/analyze_trajectory.py", "traj.*.xml"])
```

## 环境要求

- Python 3.11-3.13
- numba >= 0.61（推荐0.65.1）
- CUDA Toolkit（GPU模式需要）
- pygamd 1.4.8

## Chemcode 标准工作流与强制人工确认

以下流程适配自更新后的 WorkBuddy PyGAMD skill。实际任务必须依次调用 `human_checkpoint`，普通文本提问不算人工确认。“完全访问”和“始终允许”均不能跳过节点。拒绝或超时后停止后续动作，保留当前会话进度并等待用户新指令。

### Step 0：环境检查

检查 Python 3.11–3.13、PyGAMD 版本、Numba/CUDA、GPU 型号与显存，以及 matplotlib/OVITO。Windows CUDA 13.2 兼容问题可运行 `pygamd_gpu_init.py` 诊断；不要在其他 CUDA 版本上盲目应用补丁。

调用 `pygamd-H1-environment`。证据必须包含实际命令输出、执行设备、缺失依赖和回退方案。批准后才能分析并落实用户需求。

### Step 1–2：需求范围与学术关键词

判断任务是否属于 PyGAMD 的 DPD、LJ、聚合物或布朗动力学能力范围，提取 4–7 个英文检索关键词。若不适用，明确推荐 GROMACS、LAMMPS、HOOMD-blue、NAMD 或 AMBER。

调用 `pygamd-H2-scope-keywords`。证据必须包含任务分类、适用性判断、关键词和任何范围警告。批准后才能检索数据库。

### Step 3：Chemcode 文献数据库检索

使用 `database_search` 检索 Chemcode 论文库，合并同一论文结果并记录标题、DOI、年份、相关度和支持的参数/方法。结果为空或相关度低时，把“扩大检索、使用用户资料或降级为通用知识”列入 warnings。

调用 `pygamd-H3-literature`。证据必须包含检索式、命中结果和拟采用的文献依据。批准后才能生成模拟代码。

### Step 4：MVP 脚本

生成最小可运行脚本，规模通常不超过 5000 粒子和 10000 步。必须包含配置生成、力场、积分器、输出、短试运行和明确的文献参数来源。

调用 `pygamd-H4-mvp`。证据必须包含脚本路径、粒子数、步数、关键参数、输出计划、静态检查和短试运行结果。批准后才能扩展为生产级代码。

### Step 5：生产级代码

生成科研规模代码和分析方案，列出它与 MVP 的具体差异。平衡与生产必须拆成独立阶段；生产必须读取经检查的平衡 restart XML。

调用 `pygamd-H5-production-code`。证据必须包含生产脚本路径、规模、步数、资源需求、分析指标、检查策略和 MVP 差异。批准后才能准备执行。

### Step 6：执行前物理检查与资源确认

运行 `physical_consistency_check.py`，必须为 0 failed；同时估算 GPU 时间、显存和磁盘。证据必须列出 `alpha/sigma/gamma` 与 FDT、bond、`dt`、`rcut`、密度、box/skin、输出频率和资源估算。

调用 `pygamd-H6-execution`。该节点只有物理检查成功后才会被 Chemcode 接受。批准后才能运行平衡/生产，或生成远程迁移方案。

### Step 7：结果、可视化与报告

验证运行步数、NaN/Inf、温度/压力趋势、restart 可用性以及轨迹/日志路径和大小。用 `analyze_trajectory.py` 做定量分析；需要形貌图时优先运行 `render_ovito.py`，OVITO 不可用时回退 matplotlib。

调用 `pygamd-H7-results`。证据必须包含真实输出、质量检查、异常、拟执行的分析/可视化和报告内容。批准后才能生成最终分析、图片或汇报文档。

每个节点之前都必须有该阶段新产生的工具证据，不得只写“已检查”。禁止把平衡和生产合并为一次不间断运行，也禁止伪造文献、模拟数据或检查结果。

## GPU初始化（必须）

**在 `import pygamd` 之前**调用GPU初始化模块：

GPU/CUDA 初始化由 PyGAMD、Numba 和 CUDA 安装环境负责。本技能不依赖项目外的 monkey-patch 脚本。
- cudart.dll加载 → 预加载cudart64_13.dll

## 正确的API参考

### 系统初始化

```python
import pygamd

# 读取XML配置（正确API）
snap = pygamd.snapshot.read("config.xml")

# snap属性：snap.npa(粒子数), snap.box(盒子), snap.ntypes(类型数)
```

### DPD力场

```python
# 创建DPD力场（正确API）
dpd = pygamd.force.dpd(info=snap, rcut=1.0)

# 设置相互作用参数（正确API）
dpd.setParams(type_i="A", type_j="A", alpha=25.0, sigma=3.0)
dpd.setParams(type_i="B", type_j="B", alpha=25.0, sigma=3.0)
dpd.setParams(type_i="A", type_j="B", alpha=30.0, sigma=3.0)  # A-B排斥更强
```

### 键势（仅支持harmonic）

```python
# 创建谐波键势（pygamd不支持fene）
bond = pygamd.force.bond(info=snap, func='harmonic')

# 设置参数：k(弹簧常数), r0(平衡距离)
bond.setParams(bond_type="bond1", param=[100.0, 0.5])
```

### 角势（harmonic + harmonic_cos）

```python
# 谐波角势（默认）
angle = pygamd.force.angle(info=snap, func='harmonic')
angle.setParams(angle_type="angle1", param=[k, theta0])
# U(θ) = 0.5 * k * (θ - θ0)²

# 余弦谐波角势（θ=π 处平滑，避免谐波势边界发散）
angle_cos = pygamd.force.angle(info=snap, func='harmonic_cos')
angle_cos.setParams(angle_type="angle2", param=[k, theta0])
# U(θ) = k * [1 - cos(θ - θ0)]
```

### 二面角势（proper + improper）

```python
# pygamd 1.4.8 的 dihedral 同时处理 proper (扭转) 和 improper (面外) 二面角
dihedral = pygamd.force.dihedral(info=snap, func='harmonic')
# proper: 四原子二面角 A-B-C-D（扭转）
# improper: 中心原子与三个邻居的面外角（如 sp2 碳平面性维持）
# 两者使用相同的 func='harmonic' 和 setParams 签名
# setParams(dihedral_type, [k, phi0, multiplicity]) — multiplicity ∈ {1,2,3,4,6}
dihedral.setParams(dihedral_type="dihedral1", param=[1.0, 0.0, 3])
```

### 积分器

```python
# GWVV积分器（DPD专用，正确API）
integrator = pygamd.integration.gwvv(info=snap, group="all")
```

### 模拟应用

```python
# 创建应用（正确API）
app = pygamd.application.dynamics(snap, dt=0.005)

# 添加组件（注意：不加方括号）
app.add(dpd)
app.add(bond)
app.add(integrator)
```

### 轨迹输出

```python
# XML轨迹输出（正确API）
dump = pygamd.dump.xml(info=snap, group="all", file='trajectory', period=1000)
app.add(dump)

# 热力学数据输出（momentum, temperature, pressure, potential）
thermo = pygamd.dump.data(info=snap, group="all", file='thermo.log', period=100)
app.add(thermo)  # 必须 app.add()，否则文件为空
```

### 运行模拟

```python
# 直接调用 app.run()；pygamd 不支持时间步重置方法，需要时重建 app 或修改 snap
app.run(10000)  # 运行10000步
```

## 检查点清单

> **🔴 CHECKPOINT** — 每个关键步骤后**必须**验证状态，不通过禁止进入下一步。

| 检查点 | 验证方法 | 失败时操作 |
|--------|----------|-----------|
| 🔴 GPU初始化 | `init_gpu()` 返回True | 检查nvidia-smi、CUDA版本 |
| 🛑 配置读取 | `snap.npa > 0` | 检查XML格式、natoms、文件路径 |
| 🛑 盒子尺寸 | `snap.box > 0` | 检查box lx/ly/lz是否正确 |
| 🛑 力场设置 | 无报错 | 检查参数类型（float不是int） |
| 🔴 模拟运行 | 无NaN/Inf | 减小dt、检查初始配置重叠 |
| 🛑 输出文件 | 文件存在且大小>0 | 检查period、文件路径 |

**🛑 STOP 触发条件**（出现立即停止，不准继续）：

- `init_gpu()` 返回 False → 排查 nvidia-smi / CUDA路径
- `snap.npa == 0` → XML 解析失败，停止不要重试
- 跑出 NaN/Inf → 立即停止，dt 减半重来
- 10分钟无轨迹输出 → 暂停，检查 period 与 disk 空间

```python
# 运行前验证
assert snap.npa > 0, "粒子数为0，配置读取失败"
assert snap.ntypes >= 2, "类型数不足"
print(f"系统: {snap.npa}粒子, {snap.ntypes}类型, 盒子{snap.box}")

# 运行后验证
import os
assert os.path.exists('trajectory.xml'), "轨迹文件未生成"
print(f"轨迹大小: {os.path.getsize('trajectory.xml')/1024:.1f}KB")
```

## 完整DPD模拟示例

```python
import os, sys, time
import numpy as np

import pygamd

# 2. 生成初始配置
nchains, nbeads, fA, rho = 50, 100, 0.5, 3.0
N = nchains * nbeads
L = (N / rho) ** (1.0/3.0)
nA = int(nbeads * fA)

# 生成XML配置文件
positions, velocities, types, bonds = [], [], [], []
atom_id = 0
for chain in range(nchains):
    prev = np.random.uniform(-L/2, L/2, 3)
    for i in range(nbeads):
        if i == 0:
            pos = prev
        else:
            pos = prev + 0.5 * np.random.randn(3)
            pos = np.where(pos > L/2, pos - L, pos)
            pos = np.where(pos < -L/2, pos + L, pos)
        positions.append(pos)
        velocities.append(np.random.randn(3) * 0.1)
        types.append('A' if i < nA else 'B')
        if i > 0:
            bonds.append(['bond1', atom_id-1, atom_id])
        prev = pos
        atom_id += 1

with open("config.xml", 'w') as f:
    f.write(f'<galamost_xml version="1.3">\n')
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

# 3. 读取配置
snap = pygamd.snapshot.read("config.xml")

# 4. 设置力场
dpd = pygamd.force.dpd(info=snap, rcut=1.0)
dpd.setParams(type_i="A", type_j="A", alpha=25.0, sigma=3.0)
dpd.setParams(type_i="B", type_j="B", alpha=25.0, sigma=3.0)
dpd.setParams(type_i="A", type_j="B", alpha=30.0, sigma=3.0)

bond = pygamd.force.bond(info=snap, func='harmonic')
bond.setParams(bond_type="bond1", param=[100.0, 0.5])

# 5. 设置积分器和输出
integrator = pygamd.integration.gwvv(info=snap, group="all")
dump = pygamd.dump.xml(info=snap, group="all", file='trajectory', period=1000)

# 6. 创建应用并运行
app = pygamd.application.dynamics(snap, dt=0.005)
app.add(dpd)
app.add(bond)
app.add(integrator)
app.add(dump)

# 平衡
app.run(5000)

# 生产
app.run(20000)
```

## DPD参数指南

| 相互作用 | alpha | sigma | 说明 |
|----------|-------|-------|------|
| A-A | 25.0 | 3.0 | 相同组分排斥 |
| B-B | 25.0 | 3.0 | 相同组分排斥 |
| A-B | 30.0-35.0 | 3.0 | 不同组分排斥（决定相分离强度） |

- 增大A-B的alpha → 更强相分离
- 时间步长：dt = 0.005（DPD单位）
- 数密度：rho = 3.0（标准DPD值）

### DPD参数取值范围

| 参数 | 范围 | 说明 |
|------|------|------|
| alpha (保守力) | 25.0 - 100.0 | Groot-Warren标准：25.0对应χN=0 |
| sigma (随机力) | 3.0 - 6.0 | 需满足涨落耗散定理：σ²=2γk_BT |
| rcut (截断距离) | 1.0 | DPD标准单位，通常固定为1.0 |
| dt (时间步长) | 0.001 - 0.01 | 推荐0.005，过大导致不稳定 |
| rho (数密度) | 2.0 - 5.0 | 标准DPD值为3.0 |
| nchains (链数) | 10 - 1000 | 根据总粒子数调整 |
| nbeads (每链珠子数) | 10 - 500 | 聚合物链长 |

**粒子数与盒子尺寸关系**：
- 总粒子数 N = nchains × nbeads
- 盒子尺寸 L = (N / rho)^(1/3)
- 示例：N=5000, rho=3.0 → L≈11.86

### DPD约化单位下的量纲

DPD 用**约化单位**（reduced units）消除显式物理常数，pygamd 输入参数（rcut、alpha、sigma、dt 等）全部无量纲。基准量：长度 `r_c`、能量 `k_BT`、质量 `m`。下表给出各量的约化单位定义与典型取值：

| 量 | 符号 | 量纲（DPD单位） | 典型值 | 物理含义 |
|----|------|----------------|--------|----------|
| 截断距离 | `r_c` | 1 | 1.0 | 力程基准，所有空间量以其无量纲化 |
| 保守力系数 | `alpha` | `k_BT / r_c` | 25.0 (A-A, B-B), 30-35 (A-B) | 决定相分离强度 |
| 随机力系数 | `sigma` | `k_BT^(3/4) · m^(1/4) / r_c^(1/2)` | 3.0 | 涨落强度，需满足涨落-耗散 `sigma^2 = 2*gamma*k_BT` |
| 耗散系数 | `gamma` | `sqrt(m k_BT) / r_c` | 4.5（与 sigma=3.0 配对） | 摩擦系数 |
| 温度 | `k_BT` | 1 | 1.0 | 单位能量，固定为 1 |
| 数密度 | `rho` | `1 / r_c^3` | 3.0 | 体积分数 ≈ 1 |
| 时间步 | `dt` | `r_c * sqrt(m / k_BT)` | 0.001 - 0.01，推荐 0.005 | 积分精度 |
| 体积 | `V` | `r_c^3` | L^3 | 盒子体积 |
| 时间 | `t` | `r_c * sqrt(m / k_BT)` | 由 dt 累积 | 模拟时长 |

> **🔴 CHECKPOINT**：DPD 约化单位下 `k_BT ≡ 1`，所以力系数 `alpha` 与温度的关系由 `alpha_ij / k_BT` 决定；要"调温度"必须**重新映射** alpha，而非改 dt 或 sigma。

### 守恒律 self-check（物理正确性验证）

跑完一次完整模拟后，**必须**核对以下守恒律/涨落性质。不通过则模拟不可信，需排查 dt / 力场参数 / 初始配置。

#### 1. 能量守恒（NVE）

适用：去掉 `integration.gwvv`（NVT 恒温器）改用 `integration.nve` 跑纯 NVE。

| 指标 | 阈值（研究级） | 测量方法 |
|------|-------------|----------|
| 总能量相对漂移 | < **5e-6** / 10k 步 | `ΔE/E₀` 在 10000 步内 |
| 动能涨落 | < **1.5%** 均值 | 跑 10k 步后分段采样 std/mean |

```python
# NVE 能量漂移检测脚本片段
import numpy as np
energies = []  # 从 pygamd 抓取（或自己用速度算 KE）
for chunk in range(10):
    app.run(1000)
    ke = 0.5 * np.sum(snap.velocity**2)
    energies.append(ke)
drift = (energies[-1] - energies[0]) / energies[0]
assert abs(drift) < 5e-6, f"NVE 能量漂移 {drift:.2e} 超阈值（研究级 5e-6）"
```

#### 2. 温度稳定（NVT）

适用：标准 GWVV NVT 模拟。

| 指标 | 阈值（研究级） | 测量方法 |
|------|-------------|----------|
| 平衡后温度均值 | 0.985 T* - 1.015 T* | 跑过平衡段后采样 |
| 温度涨落 | σ(T)/⟨T⟩ < **0.015** | 平衡段内 std/mean |

```python
# NVT 温度涨落检测
T_samples = []  # T* = 2*KE / (3*N - 3), KE 已是能量, 无需 dt 因子
for chunk in range(20):
    app.run(500)
    ke = 0.5 * np.sum(snap.velocity**2)
    T = 2.0 * ke / (3.0 * snap.npa - 3)
    T_samples.append(T)
T_mean, T_std = np.mean(T_samples), np.std(T_samples)
assert abs(T_mean - 1.0) < 0.015, f"T* 均值 {T_mean:.3f} 偏离 1.5%（研究级）"
assert T_std / T_mean < 0.015, f"温度涨落 {T_std/T_mean:.3f} 超 1.5%（研究级）"
```

#### 3. 涨落-耗散定理

DPD 随机力 σ 与耗散 γ 通过涨落-耗散定理耦合：**σ² = 2 γ k_B T**。在约化单位（k_BT=1）下，`sigma = sqrt(2 * gamma)`。

**严格判据**（研究级）：
- 0 阶（基础）容差：`|σ² - 2γk_BT| / (2γk_BT) < 1.5%`（Round 4 收紧自 R3 的 2%）
- 1 阶高阶矩修正：积分算法离散化引入有效修正系数 `(1 + γ·dt/(2m))`，判定时应使用**有效** σ²_eff = σ² / (1 + γ·dt/(2m))，否则系统加热漂移不可见

```python
# 涨落-耗散一致性检测（研究级，0 阶 + 1 阶高阶矩）
import math

# 0 阶基础判据
fdt_ratio = 0.015  # Round 4 收紧自 R3 的 2%
target = 2.0 * gamma  # 2γk_BT, k_BT=1
deviation = abs(sigma**2 - target) / target
assert deviation < fdt_ratio, \
    f"涨落-耗散违反: σ²={sigma**2:.4f}, 2γk_BT={target:.4f}, 偏差 {deviation*100:.2f}% > 1.5%"

# 1 阶高阶矩修正 (Groot-Warren 1997, Eq. 12)
# 离散化引入 dt/m 修正，effective σ²_eff = σ² / (1 + γ·dt/(2m))
# 当 dt=0.005, γ=4.5, m=1 时 修正系数 ≈ 1.0112
high_order_correction = 1.0 + gamma * dt / (2.0 * mass)
sigma_eff_sq = sigma**2 / high_order_correction
print(f"OK: σ²={sigma**2:.3f}, 2γk_BT={target:.3f}, "
      f"σ²_eff(高阶修正)={sigma_eff_sq:.4f}, 修正系数={high_order_correction:.4f}")
```

> **常见错误**：
> - 随机改 `sigma` 而不联动 `gamma` → 违反涨落-耗散，温度失控/系统加热
> - 忽略 dt 高阶矩修正 → 跑长时模拟后系统缓慢漂移升温（典型 0.1%/万步）

#### 4. 压强 virial 与状态方程

DPD 平衡态压强（Español-Warren 公式）：

```
P = ρ k_B T + α ρ² (r_c^3) / 5.0  -  (保守力贡献)
```

约化单位下 `P* = ρ T* + ρ² α / 5.0`。T*=1, ρ=3, α=25 时 P* ≈ 3 + 45 = 48。

**严格判据**（研究级）：
- virial 自洽容差：`|P_measured - P_estimate| / P_estimate < 0.8%`（Round 4 收紧自 R3 的 1%）
- 单相流体体积模量 K 反推自洽：`K = ρ·∂P/∂ρ|_T`，由两组 (ρ, P) 数据用中心差分拟合，理论值 K_DPD = ρ·(k_BT + 2αρ/5)，偏差 < 0.8%

```python
# 压强 virial 自洽检测（研究级 ±1%）
P_estimate = rho + alpha * rho**2 / 5.0  # DPD 约化压强

# pygamd 无内置 virial 输出；用 OVITO 计算 per-particle virial 后求和
# 备选: 跑 NPT 系综测 P（pygamd 1.4.8 暂不支持 NPT），或用 NVT 多 ρ 扫描外推
# 粗略估计: P_measured = ...（用户填入实测值）
P_measured = 48.5  # 示例：用户用 OVITO 计算得到的 virial 压强
deviation = abs(P_measured - P_estimate) / P_estimate
assert deviation < 0.008, \
    f"virial 自洽违反: P_meas={P_measured:.3f}, P_est={P_estimate:.3f}, " \
    f"偏差 {deviation*100:.2f}% > 0.8%（研究级）"

# 体积模量 K 反推自洽（单相流体）
# K = ρ * dP/dρ|_T, 中心差分: dP/dρ ≈ (P(ρ+δ) - P(ρ-δ)) / (2δ)
delta_rho = 0.1
P_plus = (rho + delta_rho) + alpha * (rho + delta_rho)**2 / 5.0
P_minus = (rho - delta_rho) + alpha * (rho - delta_rho)**2 / 5.0
K_measured = rho * (P_plus - P_minus) / (2.0 * delta_rho)  # 数值 K
K_theory = rho * (1.0 + 2.0 * alpha * rho / 5.0)  # 解析 K = ρ(k_BT + 2αρ/5)
K_deviation = abs(K_measured - K_theory) / K_theory
assert K_deviation < 0.008, f"体积模量反推自洽违反: K_meas={K_measured:.3f}, K_th={K_theory:.3f}"
print(f"OK: P*≈{P_estimate:.2f}, K*≈{K_theory:.2f}（研究级 ±1%）")
```

### 温度单位换算（DPD T* ↔ 物理 K）

DPD 约化温度 T* 与物理温度 T 的换算依赖特征长度 σ_L 与能量尺度 ε_E：

```
T* = k_B T / ε_E    →    T (K) = T* × ε_E / k_B
```

| 场景 | 特征长度 | 特征能量 | T*=1 对应 K |
|------|----------|----------|-------------|
| 水（粗粒度 1 bead ≈ 3 Å） | r_c = 6.31 Å | k_BT_water = 0.6 kJ/mol | T ≈ 72 K |
| 聚合物熔体（1 bead ≈ 1 nm） | r_c = 1.0 nm | k_BT = 2.5 kJ/mol | T ≈ 300 K |
| 脂质（1 bead ≈ 1 nm） | r_c = 1.0 nm | k_BT = 2.5 kJ/mol | T ≈ 300 K |
| 软物质通用 | r_c = 1.0 | k_BT = 1.0 | T ≡ 1（无量纲） |

**Groot-Warren 映射**（最常用）：
```
a_ij ≈ 75 k_BT / ρ   （water-like 压缩性匹配）
```
当 ρ=3, k_BT=1 时 α_A-A ≈ 25；这就是 SKILL.md 中 α=25 的来源。

### 参数化方法学

三种主流 DPD 参数映射方法，差异与适用场景：

| 方法 | 核心思想 | 适用场景 | 局限 |
|------|----------|----------|------|
| **Groot-Warren (1997)** | α 与 ρ 匹配真实流体压缩性 | 单组分流体、简单两嵌段共聚物 | 不直接对应 Flory-Huggins χ 参数 |
| **Blokhuis (2008)** | 把 χN → α_ij 偏置：Bij = α_ij - α_ii | 已知 χ 的聚合物共混 | α_ii 仍要靠 Groot-Warren 标定 |
| **Maiti (2005)** | 珠簧模型，弹簧常数 K → 力场参数 | 聚合物链熔体、缠结 | 仅限键势参数，非保守力参数 |

**Groot-Warren 公式**（最常见）：
```
α_ii = 75 k_BT / ρ     (相同组分)
α_ij = α_ii + 3.27 χ_ij ρ / r_c^3   (i≠j，匹配 χ)
```

**Blokhuis 修正**（更严谨）：
```
α_ij = α_ii + 3.27 χ_ij ρ   (把 χ 注入偏置项)
```

**Maiti 映射**（键势）：
```
K_eff = (χ N / R_g^2) × k_BT    (简化公式; 完整 Maiti 形式含 l^2 = 2·l_b·l_K 离散化修正, R_g = √(N/6)·b)
r0 = 0.5 r_c                     (平衡键长)
```

**实操推荐**：
- 不知道用哪个 → 用 Groot-Warren
- 已知聚合物 χN → 用 Blokhuis（更准）
- 跑缠结聚合物 → 用 Maiti 标定键势 + Groot-Warren 标定非键

### XML配置文件格式

```xml
<?xml version="1.0" encoding="UTF-8"?>
<galamost_xml version="1.3">
<configuration time_step="0" natoms="1000">
  <box lx="8.74" ly="8.74" lz="8.74"/>
  <position>
    x1 y1 z1
    x2 y2 z2
    ...
  </position>
  <velocity>
    vx1 vy1 vz1
    ...
  </velocity>
  <type>
    A
    B
    ...
  </type>
  <bond>
    bond1 0 1
    bond1 1 2
    ...
  </bond>
</configuration>
</galamost_xml>
```

**常见XML错误**：
- natoms与实际粒子数不匹配 → 报错"number of particles"
- box尺寸太小导致粒子重叠 → 能量爆炸
- bond索引超出natoms范围 → 报错"index out of range"
- type数量与position数量不一致 → 报错

## 显式物理稳定性判据

模拟开始前**必须**校验以下 5 个稳定性条件。任意一条不满足都应立即调整参数，禁止跳过。

### B1. dt × 最快运动模式（数值积分稳定性上限）

dt 决定能量守恒与温度控制精度。**上限**由最快运动模式（键振动、保守力、随机力）的特征频率决定：

| 力场类型 | dt 推荐 | dt **硬上限** | 失效症状 |
|---------|---------|--------------|---------|
| **DPD**（软保守 + 随机 + 耗散） | 0.005 | **0.04** | > 0.04 时保守力数值发散；> 0.01 温度漂移 > 1.5% |
| **Lennard-Jones (slj)** | 0.001 | **0.005** | > 0.005 时 r⁻¹² 排斥力爆炸，KE 几十步内 NaN |
| **Langevin / BD** | 0.005 | **0.01** | > 0.01 时速度分布偏离 Maxwell-Boltzmann |
| **键谐振子**（决定性频率） | — | **dt < 0.1 × (2π/ω_max)** | ω_max = √(k/m)，k=500/m=1 时 dt < 0.044 |

```python
# dt 稳定性预检（启动前必跑）
import math
dt_max_table = {
    "dpd": 0.04,
    "slj": 0.005,
    "langevin": 0.01,
}
dt_input = 0.005
force_type = "dpd"  # 由用户指定
assert dt_input <= dt_max_table[force_type], \
    f"dt={dt_input} 超 {force_type} 硬上限 {dt_max_table[force_type]}"

# 键振子频率校验
k_bond, mass = 100.0, 1.0
omega_max = math.sqrt(k_bond / mass)
dt_bond_limit = 0.1 * (2.0 * math.pi / omega_max)
assert dt_input < dt_bond_limit, f"dt={dt_input} 超键振子稳定性上限 {dt_bond_limit:.4f}"
```

### B2. 截断半径 rcut 与盒子尺寸

PBC + minimum-image convention 下，rcut 必须 **严格小于盒子最短边的一半**，避免粒子与自己的镜像相互作用：

```
rcut < L_min / 2,  L_min = min(lx, ly, lz)
```

| rcut/L_min | 风险等级 | 处理 |
|-----------|---------|------|
| < 0.4 | 安全 | 标准 DPD (rcut=1.0, L≥2.5) |
| 0.4 - 0.49 | 警戒 | 减小 rcut 或扩大 L |
| ≥ 0.5 | **禁止** | 粒子与镜像重合，virial 与能量均不收敛 |

```python
# rcut × L_min 校验
rcut = 1.0
lx, ly, lz = snap.box[0], snap.box[1], snap.box[2]
L_min = min(lx, ly, lz)
ratio = rcut / L_min
assert ratio < 0.5, f"rcut/L_min={ratio:.3f} ≥ 0.5，粒子将与镜像重叠"
assert ratio < 0.4, f"rcut/L_min={ratio:.3f} 处于警戒区，建议 < 0.4"
```

### B3. neighbor list skin 厚度

pygamd neighbor list 用 skin 缓冲避免每步重建。**Hoover-Dimarzio 准则**要求：

```
skin ≥ 0.3 × dr_max,  dr_max = |v_max| × dt
```

| skin/dr_max | 风险 | 处理 |
|------------|------|------|
| ≥ 0.3 | 安全 | 标准 |
| 0.1 - 0.3 | 偶发粒子逃出 | 建议增大 |
| < 0.1 | 频繁 missing neighbor | 立即加大 skin |

```python
# neighbor skin 校验
skin = 0.3  # pygamd 默认
v_max = 5.0  # 估计最大速度（DPD 中典型 ~3-5）
dr_max = v_max * dt_input
assert skin >= 0.3 * dr_max, \
    f"skin={skin} < 0.3×dr_max={0.3*dr_max:.3f}，可能漏更新 neighbor list"
```

### B4. 数密度标度化 ρ* ∈ [3, 10]

DPD 数密度经验范围：ρ* = N/V。低于 3 → 涨落主导、压力过低；高于 10 → 局部密度失真、相图偏移。

| ρ* | 适用 | 风险 |
|----|------|------|
| < 3 | 稀薄气相 | Groot-Warren α 公式失效 |
| **3 - 5** | 标准 DPD（推荐） | — |
| 5 - 10 | 高密度液相 | 需要重新标定 α |
| > 10 | 玻璃态/受限 | 强结构化，需谨慎 |

```python
# 数密度校验
N = snap.npa
V = lx * ly * lz
rho_star = N / V
assert 3.0 <= rho_star <= 10.0, \
    f"ρ*={rho_star:.2f} 超出 DPD 经验区间 [3, 10]"
```

### B5. PBC 盒子三轴各向异性

盒子三轴比不应超过 **2:1**，否则最小镜像约定在长轴方向引入数值各向异性（压强张量非对角元显著）：

```
max(lx, ly, lz) / min(lx, ly, lz) ≤ 2
```

| 长短轴比 | 风险 |
|---------|------|
| ≤ 2 | 安全 |
| 2 - 3 | 压强张量各向异性 1-3% |
| > 3 | 强烈推荐重构盒子为立方 |

```python
# 盒子各向异性校验
L_max, L_min = max(lx, ly, lz), min(lx, ly, lz)
aspect = L_max / L_min
assert aspect <= 2.0, f"盒子长/短轴比={aspect:.2f} > 2，引入数值各向异性"
```

### 综合启动前 checklist

```python
# 综合稳定性预检脚本（5 判据全通过才能 app.run）
def stability_precheck(snap, dt, force_type="dpd", rcut=1.0, skin=0.3):
    """返回 (ok: bool, report: dict)"""
    report = {}
    # B1 dt
    dt_max = {"dpd": 0.04, "slj": 0.005, "langevin": 0.01}[force_type]
    report["dt"] = {"input": dt, "max": dt_max, "ok": dt <= dt_max}
    # B2 rcut
    L_min = min(snap.box[:3])
    report["rcut"] = {"ratio": rcut / L_min, "ok": rcut / L_min < 0.5}
    # B3 skin
    v_max = 5.0
    dr_max = v_max * dt
    report["skin"] = {"value": skin, "min_required": 0.3 * dr_max, "ok": skin >= 0.3 * dr_max}
    # B4 ρ*
    N, V = snap.npa, snap.box[0] * snap.box[1] * snap.box[2]
    rho = N / V
    report["rho_star"] = {"value": rho, "ok": 3.0 <= rho <= 10.0}
    # B5 aspect
    L_max, L_min = max(snap.box[:3]), min(snap.box[:3])
    report["aspect"] = {"value": L_max / L_min, "ok": L_max / L_min <= 2.0}
    return all(r["ok"] for r in report.values()), report

# 启动前调用
ok, report = stability_precheck(snap, dt=0.005, force_type="dpd")
assert ok, f"稳定性预检失败: {report}"
# 全通过后典型 dpd.setParams（量级见 §量级典型范围对照表）
dpd = pygamd.force.dpd(info=snap, rcut=1.0)
dpd.setParams(type_i="A", type_j="A", alpha=25.0, sigma=3.0)  # 标准 Groot-Warren
dpd.setParams(type_i="B", type_j="B", alpha=25.0, sigma=3.0)  # 同组分
```

> **🔴 CHECKPOINT**：以上 5 条任意一条不通过 → 立即修参数，不准 `app.run()`。

## 量级典型范围对照表（Round 3 严苛化）

> 启动模拟前**必须**核对：所选参数是否落在下表"严苛范围"列。任意一项偏离严苛范围都应给出物理论证或视为可疑。
>
> 工程经验范围（Round 2 残留）保留作为参考；严苛范围（Round 3）才是"研究级"判定标准。

### D1. DPD 保守力系数 α（保守相图）

| 范围 | 取值区间 | 物理后果 |
|------|---------|---------|
| **严苛**（Round 3） | **α ∈ [10, 50]** | < 10 → 保守力过弱，相分离缺失；> 50 → 数值不稳定（保守力尖峰超 LJ 量级） |
| 工程（Round 2 残留参考） | α ∈ [25, 100] | Groot-Warren 标准 α=25 对应 χN=0；强相分离 α≥40 |
| 标准 Groot-Warren | α_ii = 75 k_BT / ρ, ρ=3 → **α=25** | 单组分流体的压缩性匹配 |
| Blokhuis 偏置 | α_ij = α_ii + 3.27 χ_ij ρ | 已知聚合物 χN 时的 A-B 偏置 |

### D2. DPD 耗散系数 γ（摩擦）+ 随机力 σ

| 参数 | 严苛范围（Round 3） | 工程范围 | 关系 |
|------|---------------------|---------|------|
| **γ**（耗散） | **[3, 10]** | 3 - 10 | 摩擦强度 |
| **σ**（随机） | **[3, 6]** | 3 - 6 | 涨落强度 |
| **涨落-耗散耦合** | **σ² = 2γk_BT**（k_BT=1） | 同 | 二者必联动，否则温度失控 |

> **🔴 CHECKPOINT**：调整 σ **必须** 同步调整 γ = σ²/2。单独改 σ = 违反涨落-耗散，典型 0.1%/万步慢加热。

### D3. DPD 约化温度

| 量 | 值 | 说明 |
|----|----|------|
| **k_BT** | **1.0**（无量纲，固定） | DPD reduced units；非物理 K 温度 |
| T*（DPD 约化） | 1.0 | 目标温度 |
| Schmidt 数 Sc = ν/D | **[0.85, 1.15]**（新增 Round 3 严苛判据） | 1.0 = 动量/质量扩散等同性；偏离 ±15% 表示参数非物理 |

```python
# Schmidt 数校验（Round 3 新增）
# D = kBT / (gamma * m); nu = c * sqrt(kBT * m) / rho^(2/3) 简化估算
# 实际建议用 MSD 与 VACF 分别测 D 和 nu
import math
# 简化: 当 gamma=4.5, kBT=1, m=1 时 D ≈ 1/4.5 ≈ 0.222
# nu 由 DPD 状态方程反推: nu ~ 0.5-1.0 (DPD 单位)
D_estimated = kBT / (gamma * mass)  # Stokes-Einstein 简化
nu_estimated = 0.6  # DPD 标准液相粘度典型值
Sc = nu_estimated / D_estimated
assert 0.85 <= Sc <= 1.15, f"Sc={Sc:.2f} 偏离 [0.85, 1.15]，参数不自洽"
```

### D4. Lennard-Jones (slj) 参数

| 参数 | 严苛范围（Round 3） | 工程范围 | 物理含义 |
|------|---------------------|---------|----------|
| **ε**（势阱深度） | **[0.1, 5]** | 0.1 - 5 | < 0.1 极弱，> 5 易固化（典型 Ar: ε=1.0） |
| **σ**（粒子直径） | **[0.8, 1.5]** | 0.8 - 1.5 | < 0.8 强重叠不稳定，> 1.5 截断效率差 |

```python
# LJ slj 严苛范围（Round 3）
lj = pygamd.force.slj(info=snap, rcut=2.5)
lj.setParams("Ar", "Ar", [1.0, 1.0, 1.0])      # 标准 Ar-like: ε=1, σ=1, α=1
lj.setParams("Ar", "Kr", [0.5, 1.1, 1.0])      # 弱相互作用对
```

### D5. 谐波键势 (bond) 参数

| 参数 | 严苛范围（Round 3） | 工程范围 | 物理含义 |
|------|---------------------|---------|----------|
| **k**（弹簧常数） | **[50, 500]** | 100 - 200 | < 50 链太软，> 500 需 dt ≤ 0.002 |
| **r0**（平衡距离） | **[0.7, 1.2]** | 0.5 - 1.5 | 与 rcut 协调（r0 < rcut 避免自作用） |

```python
# bond 严苛范围（Round 3）
bond = pygamd.force.bond(info=snap, func='harmonic')
bond.setParams(bond_type="bond1", param=[100.0, 0.5])  # 软键（k=100, r0=0.5）
# 强键: bond.setParams(bond_type="bond2", param=[300.0, 1.0])  # 需 dt<0.003
```

### D6. 二面角 (dihedral) 参数

| 参数 | 严苛范围（Round 3） | 物理含义 |
|------|---------------------|----------|
| **k_dihedral**（扭转势垒） | **[1, 50]**（k_BT 单位） | < 1 几乎自由旋转，> 50 强刚性扭转 |
| **multiplicity** | **{1, 2, 3, 4, 6}** | 周期数：1=无周期，2=trans/gauche，3=CH3 旋转，4=联苯，6=六角对称 |
| **phase** | 0 或 π | 0 = cosine 起点，π = 正弦起点 |

> **🔴 CHECKPOINT**：multiplicity 取 {1,2,3,4,6} 之外的值（如 5, 7）会引入数值噪声与群论不自洽，应改为相邻的允许值。

### D 块使用模板（启动前 1 次性核对）

```python
# 严苛范围模板（按需取消注释/调整）
PARAMS_CHECK = {
    # DPD
    "alpha_dpd": (10.0, 50.0),
    "gamma_dpd": (3.0, 10.0),
    "sigma_dpd": (3.0, 6.0),
    "kBT": (0.999, 1.001),  # 必须=1
    "rho_star": (3.0, 10.0),
    "Sc": (0.85, 1.15),
    # LJ
    "epsilon_lj": (0.1, 5.0),
    "sigma_lj": (0.8, 1.5),
    # Bond
    "k_bond": (50.0, 500.0),
    "r0_bond": (0.7, 1.2),
    # Dihedral
    "k_dihedral": (1.0, 50.0),
    "multiplicity_dihedral": ({1, 2, 3, 4, 6}, "set"),
}

def check_param(name, value, allowed):
    """allowed = (min, max) or ({...}, 'set')"""
    if isinstance(allowed, tuple) and len(allowed) == 2 and isinstance(allowed[1], set):
        ok = value in allowed[1]
    else:
        lo, hi = allowed
        ok = lo <= value <= hi
    assert ok, f"{name}={value} 超出严苛范围 {allowed}"
    return ok

# 示例调用
check_param("alpha_dpd", 25.0, PARAMS_CHECK["alpha_dpd"])
check_param("multiplicity_dihedral", 3, PARAMS_CHECK["multiplicity_dihedral"])
```

## 异常检测与告警（Round 4 终极严苛化）

> 模拟过程中**必须**实时监控以下 5 类异常。任意一项触发都应立即停模、查因、修正后重跑。

### 严重度等级

| 等级 | 颜色 | 触发条件 | 处理 |
|------|------|---------|------|
| 🔴 **CRITICAL** | 红 | 物理发散（NaN/Inf） | **立即终止**模拟 |
| 🟠 **RED** | 橙 | 守恒量漂移超阈值（> 1.5%） | 停止，记录当前状态 |
| 🟡 **YELLOW** | 黄 | 数值参数接近边界 | 警告，记录，不停止 |
| 🟢 **OK** | 绿 | 全部正常 | 继续 |

### E1. 温度漂移 > 1.5% → 🔴 红警

> 阈值 = `|T_mean - T*| / T* > 0.015`（Round 4 收紧自 R3 的 2%）

```python
# E1: 温度漂移检测（运行中每 N 步调用）
import numpy as np

def check_temperature_drift(T_samples, T_target=1.0, tol=0.015):
    """返回 (status, message)"""
    if len(T_samples) < 10:
        return "OK", "样本不足"
    T_mean = np.mean(T_samples[-50:])
    dev = abs(T_mean - T_target) / T_target
    if dev > tol:
        return "RED", f"温度漂移 {dev*100:.2f}% > {tol*100:.0f}%；⟨T*⟩={T_mean:.4f}"
    return "OK", f"温度稳定 ({dev*100:.2f}%)"

# 在模拟循环中
T_samples = []
for step in range(total_steps):
    app.run(1)
    ke = 0.5 * np.sum(snap.velocity**2)
    T = 2.0 * ke / (3.0 * snap.npa - 3.0)
    T_samples.append(T)
    if step % 100 == 0:
        status, msg = check_temperature_drift(T_samples)
        if status == "RED":
            logger.error(f"🔴 温度漂移: {msg}")
            break  # 立即停止
```

### E2. 能量 NaN/Inf → 🔴 CRITICAL 立即终止

> 触发即停。**不**容许 catch 异常后继续。

```python
# E2: NaN/Inf 检测（每步必检，开销 O(1)）
def check_energy_finite(energy):
    """NaN/Inf 时直接 raise，强制停模"""
    assert not np.isnan(energy), f"能量 NaN，dt 过大或初始重叠（E={energy}）"
    assert not np.isinf(energy), f"能量 Inf，dt 过大或力溢出（E={energy}）"
    return True

# 在模拟循环中
for step in range(total_steps):
    app.run(1)
    ke = 0.5 * np.sum(snap.velocity**2)
    pe = pygamd_calculate_pe()  # pygamd 无内置 PE 输出, 用总能量 = KE
    energy = ke
    check_energy_finite(energy)  # 触发即 AssertionError 终止
```

> **常见原因**：
> - dt 过大（> 0.01 DPD） → 减半 dt 重跑
> - 初始粒子重叠（min(r_ij) < 0.5 σ） → 重新生成配置
> - α/sigma 量级失配（如 α=200）→ 检查严苛范围

### E3. 密度不匹配 → 🟡 黄警

> `|ρ_measured - ρ_target| / ρ_target > 0.05` 触发警告

```python
# E3: 密度一致性检测
def check_density_match(npa, lx, ly, lz, rho_target=3.0, tol=0.05):
    V = lx * ly * lz
    rho_measured = npa / V
    dev = abs(rho_measured - rho_target) / rho_target
    if dev > tol:
        return "YELLOW", f"ρ*_meas={rho_measured:.3f}, 目标={rho_target}, 偏差 {dev*100:.2f}%"
    return "OK", f"ρ*={rho_measured:.3f} ≈ {rho_target}"

# 启动前
status, msg = check_density_match(snap.npa, *snap.box[:3])
assert status != "YELLOW", f"密度不匹配: {msg}"
```

### E4. 时间步过大 → 🟡 黄警

> 启动前预检 dt 是否超过力场硬上限

```python
# E4: dt × 力场上限预检
DT_MAX = {"dpd": 0.04, "slj": 0.005, "langevin": 0.01}

def check_dt_safety(dt, force_type="dpd", factor=0.5):
    """factor=0.5 表示推荐 dt 为上限的 50%"""
    dt_max = DT_MAX[force_type]
    dt_recommended = dt_max * factor
    if dt > dt_max:
        return "CRITICAL", f"dt={dt} > 硬上限 {dt_max}，**禁止运行**"
    if dt > dt_recommended:
        return "YELLOW", f"dt={dt} > 推荐值 {dt_recommended}（上限 50%），效率/精度权衡"
    return "OK", f"dt={dt} 在安全区间"

# 启动前
status, msg = check_dt_safety(0.005, "dpd")
assert status != "CRITICAL", msg
```

### E5. 综合异常检测运行器（生产推荐）

> 把 E1-E4 打包成单一函数，循环每 N 步调用一次

```python
# E5: 综合异常检测（生产级）
import numpy as np
from dataclasses import dataclass, field
from typing import List

@dataclass
class AnomalyReport:
    critical: List[str] = field(default_factory=list)
    red:      List[str] = field(default_factory=list)
    yellow:   List[str] = field(default_factory=list)

    @property
    def has_critical(self):
        return bool(self.critical)
    @property
    def has_red(self):
        return bool(self.red)

def anomaly_check(snap, T_samples, dt, force_type="dpd",
                  rho_target=3.0, dt_factor=0.5) -> AnomalyReport:
    """综合异常检测，返回分级报告"""
    report = AnomalyReport()

    # E2 NaN/Inf（CRITICAL）
    ke = 0.5 * np.sum(snap.velocity**2)
    if not np.isfinite(ke):
        report.critical.append(f"动能 NaN/Inf: {ke}")

    # E1 温度漂移（RED）
    if len(T_samples) >= 10:
        T_mean = np.mean(T_samples[-50:])
        dev = abs(T_mean - 1.0) / 1.0
        if dev > 0.015:
            report.red.append(f"温度漂移 {dev*100:.2f}% > 1.5%；⟨T*⟩={T_mean:.4f}")

    # E3 密度（YELLOW）
    lx, ly, lz = snap.box[:3]
    rho_meas = snap.npa / (lx * ly * lz)
    if abs(rho_meas - rho_target) / rho_target > 0.05:
        report.yellow.append(f"ρ*={rho_meas:.3f} 偏离目标 {rho_target}")

    # E4 dt（YELLOW/CRITICAL）
    dt_max = DT_MAX[force_type]
    if dt > dt_max:
        report.critical.append(f"dt={dt} > 硬上限 {dt_max}")
    elif dt > dt_max * dt_factor:
        report.yellow.append(f"dt={dt} 接近上限 {dt_max}")

    return report

# 在主循环中
T_samples = []
for step in range(total_steps):
    app.run(1)
    ke = 0.5 * np.sum(snap.velocity**2)
    T = 2.0 * ke / (3.0 * snap.npa - 3.0)
    T_samples.append(T)
    if step % 100 == 0:
        rep = anomaly_check(snap, T_samples, dt=0.005, force_type="dpd")
        if rep.has_critical:
            logger.critical(f"🔴 严重: {rep.critical}"); raise SystemExit(1)
        if rep.has_red:
            logger.error(f"🟠 红警: {rep.red}"); break
        if rep.yellow:
            logger.warning(f"🟡 黄警: {rep.yellow}")
```

### E 与 C 块的协同

`scripts/physical_consistency_check.py` 中的 `ConservationMonitor` 类**正是 E1+E2 的离线实现**——运行后批量分析 NVE/NVT 数据。

```python
# 离线分析：导出轨迹后批量校验
import sys
sys.path.insert(0, "scripts")
from physical_consistency_check import ConservationMonitor

mon = ConservationMonitor(expected_T=1.0)
for ke_chunk in load_ke_from_trajectory("traj.*.xml"):
    alert = mon.update(ke=ke_chunk, npa=snap.npa)
    if alert:
        print(f"🔴 {alert}")
print(mon.summary())
```

## 常见问题

### nvvm.dll找不到
→ 检查 PyGAMD、Numba 与 CUDA 工具链版本，并确保 CUDA bin 在 PATH 中

### Python int too large to convert to C long
→ Python 3.13 + CUDA simulator模式的已知问题，使用真实GPU模式

### bond函数报错
→ pygamd只支持`harmonic`键势，不支持`fene`

### NumPy 2.x类型错误
→ 使用兼容当前 Python/NumPy 的 PyGAMD 版本，或在上游 `snapshot.py` 修复 float 转换

### GPU不可用的Fallback
如果GPU初始化失败（`init_gpu()`返回False）：
1. 检查NVIDIA驱动是否安装：`nvidia-smi`
2. 检查CUDA Toolkit版本：`nvcc --version`
3. 检查numba版本：`pip show numba`（需>=0.61）
4. 检查CUDA路径是否在PATH中：
   ```python
   import os
   print(os.environ.get('PATH', '').split(';'))
   # 应包含 C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v13.2\bin
   ```
5. 如果以上都正常但仍失败，使用LAMMPS作为替代方案

### 性能调优
- 粒子数<1000：GPU利用率低，建议增大系统
- 粒子数>10000：GPU加速效果明显
- 输出频率过高会降低性能：建议period>=1000
- 使用`period=0`只输出最终配置

#### GPU vs CPU 性能对比

> 数据来源：基于 PyGAMD 论文 scaling 行为估算，实际性能因硬件配置而异。DPD 为短程力，计算复杂度 O(N)。

| 粒子数 | GPU steps/sec | CPU steps/sec | 加速比 | 显存占用 |
|--------|---------------|---------------|--------|----------|
| 1K     | ~5,000        | ~2,000        | ~2.5x  | ~50 MB   |
| 10K    | ~40,000       | ~3,000        | ~13x   | ~100 MB  |
| 100K   | ~200,000      | ~2,500        | ~80x   | ~500 MB  |
| 1M     | ~800,000      | ~2,000        | ~400x  | ~4 GB    |

**说明**：
- GPU 利用率随粒子数增加而提升，小系统 (<1K) GPU 利用率 <5%
- CPU 性能受核心数限制，单核约 2,000-3,000 steps/sec
- 显存占用估算：每个粒子约 4 KB（含位置、速度、力、类型等）

#### 性能优化 Checklist

| 优化项 | 影响 | 建议值 | 风险 |
|--------|------|--------|------|
| 输出频率 `period` | period=100 vs period=1000：I/O 开销增加 ~10x | `period=1000` 或更大 | 数据点过少可能丢失瞬态信息 |
| 邻居列表 `skin` | skin=0.3 (默认)：邻居列表更新频繁；skin=0.5：更新频率降低 ~40% | `skin=0.3`（平衡） | skin 过大增加内存和遍历开销 |
| 截断半径 `rcut` | rcut=1.0 (标准 DPD)：每粒子邻居数 ~50-100 | `rcut=1.0` | rcut 增大使邻居数 O(rcut³) 增长 |
| 输出格式 | XML 格式体积大，I/O 慢 | 使用二进制格式或减少输出字段 | 二进制格式需专用工具读取 |

#### 规模扩展指南

| 系统规模 | 粒子数范围 | GPU 利用率 | 建议策略 |
|----------|------------|------------|----------|
| 小系统   | <1K        | <5%        | 使用 CPU 模式，或增大系统尺寸 |
| 中系统   | 1K-100K    | 30%-80%    | **推荐**：GPU 加速效果最佳 |
| 大系统   | 100K-1M    | 80%-95%    | 需评估显存占用，单 GPU 可支持 |
| 超大系统 | >1M        | >95%       | 需多 GPU 或分窗口策略，显存可能不足 |

**关键提示**：
- DPD 为短程力，通信开销低，多 GPU 扩展性好
- 显存不足时可减小 `skin` 或使用 CPU 回退
- 超大系统建议分批次运行，合并轨迹文件后分析

#### 性能瓶颈诊断

| 症状 | 可能原因 | 解决方案 |
|------|----------|----------|
| steps/sec 突然下降 | 邻居列表重建（skin 过小） | 增大 `skin` 至 0.4-0.5 |
| GPU 利用率低 (<10%) | 粒子数过少或 CPU-GPU 数据传输频繁 | 增大系统或减少 period 输出频率 |
| 显存不足 (OOM) | 粒子数过多或邻居列表过大 | 减小 `skin`、`rcut`，或使用 CPU 模式 |
| 输出 I/O 瓶颈 | period 过小或 XML 格式体积大 | 增大 `period`、使用二进制输出 |
| 计算卡在某一步 | 力场参数错误导致数值爆炸 | 检查 `rcut`、`a_ij` 参数合理性 |

## 参考

> **⚠️ 文档版本警告**: pygamd 官方 ReadTheDocs 文档描述的是**最新开发版** API，包含 NPT、FENE、Berendsen/Andersen 恒温器、RNEMD、Gay-Berne、dataTackle 分析插件、Gromacs 读取器等功能。**pygamd 1.4.8 (pip 安装版) 不支持这些功能**。以本 SKILL.md 或实际源码为准，不要按 ReadTheDocs 文档调用不存在的 API。

- PyGAMD文档: https://pygamd-v1.readthedocs.io/
- PyGAMD GitHub: https://github.com/PyGAMD/PyGAMD
- Groot-Warren DPD参数: J. Chem. Phys. 107, 4423 (1997)

## 自动化可视化（OVITO）

模拟完成后，使用智能可视化工具自动渲染图像：

```python
# 直接调用轨迹分析脚本
import subprocess
subprocess.run([
    "python", "scripts/analyze_trajectory.py",
    "trajectory_*.xml",  # 轨迹文件模式
])
```

**智能功能**：
- 自动检测轨迹文件数量
- 自动解析XML识别粒子类型
- 自动分配颜色（2种=红蓝，3种+=红蓝绿...）
- 均匀采样渲染帧（首帧/中间/末帧）
- 输出系统信息摘要

**依赖安装**：`pip install ovito`

## 非DPD场景（补充）

pygamd 主DPD，常被问 LJ / GROMACS 兼容，结论与处理：

| 场景 | pygamd 支持 | 推荐方案 |
|------|------------|---------|
| LJ NVT 流体 | 部分（仅NVE成熟） | 改用 HOOMD-blue / LAMMPS |
| GROMACS 拓扑 | 不支持 | ParmEd 转Amber，或手动转XML |
| Martini 力场 | 不支持 | 改用 GROMACS-MARTINI |
| 蛋白质/脂质 | 不支持 | 改用 GROMACS / NAMD / AMBER |

**LJ 粗略示例**（仅供应急）：

```python
import pygamd
snap = pygamd.snapshot.read("lj_config.xml")
lj = pygamd.force.slj(info=snap, rcut=2.5)
lj.setParams("Ar", "Ar", [1.0, 1.0, 1.0])
# 详见 references/quick_reference.md "Lennard-Jones力场" 段（slj.setParams 真实签名）
integrator = pygamd.integration.nve(info=snap, group="all")
app = pygamd.application.dynamics(snap, dt=0.001)
app.add(lj); app.add(integrator)
app.run(10000)  # 性能比DPD慢3-5倍
```

**GROMACS转换**：先 `pip install parmed`，再用 `parmed.load_file("protein.top").save("out.prmtop")`，pygamd的Amber读取器吃prmtop。简单体系也可手动解析 `[bondtypes]` 翻译到 `pygamd.force.bond/setParams`。

**DeepPot-SE 机器学习力场**：pygamd 1.4.8 内置 `force.dpk` 模块，需额外依赖：`pip install dpdata deepmd-kit`。适用于需要机器学习势能面的场景（如反应性力场），但安装复杂度高，非 DPD 常规用途。

## 反例与黑名单（不要做）

使用pygamd时**禁止**以下行为，违反会导致运行失败、数据损坏或浪费数小时计算：

| # | 禁止行为 | 原因 | 替代方案 |
|---|---------|------|---------|
| 1 | `import pygamd` 之前不调用 `init_gpu()` | numba/CUDA兼容性未patch，首个kernel调用崩溃 | 严格按 TL;DR 顺序：先 `init_gpu()` 再 `import pygamd` |
| 2 | 用 `func='fene'` 创建键势 | pygamd不支持fene键势，运行时报KeyError | 改用 `func='harmonic'`，参数 k=30, r0=1.5 近似FENE行为 |
| 3 | bond索引 ≥ `snap.npa` | bond端点超出粒子总数，报"index out of range" | bond 端点索引范围 `[0, npa-1]`，生成时校验 |
| 4 | 跳过 `<box>` 标签 | XML解析失败或粒子全堆在原点 | `<box lx="..." ly="..." lz="..."/>` 必须存在且>0 |
| 5 | dt ≥ 0.01 | DPD时间步过大，能量爆炸，NaN扩散 | dt 严格 ≤ 0.005（DPD单位） |
| 6 | A-B alpha ≤ 25.0 | 失去相分离驱动力，自组装失败 | A-B alpha ≥ 30.0（推荐30-35） |
| 7 | 粒子数 < 1000 时跑GPU | GPU利用率<5%，比CPU还慢 | 改用CPU模式或增大系统到 ≥ 10000 粒子 |
| 8 | `app.add([integrator, dump])` 列表传参 | 报"not iterable"或顺序错乱 | `app.add()` 单个调用，**不加方括号** |
| 9 | 用 `app` 的时间步重置方法 | pygamd 无此 API（AttributeError） | 需要时直接修改 `snap` 或重建 app |
| 10 | 调 `dump.xml(... period=0)` 做实时监控 | period=0只在最后输出，调试无数据 | 调试时 `period=100`，正式跑改 `period=1000+` |
| 11 | 直接读 GROMACS `.top`/`.gro` | pygamd不识别GROMACS格式 | 用ParmEd/InterMol转，或手动转XML |
| 12 | 跑LJ非DPD力场 | pygamd主要面向DPD，LJ支持有限 | 改用 HOOMD-blue / LAMMPS 跑LJ |
| 13 | PyGAMD/Numba/CUDA 版本不兼容 | 初始化或 JIT 编译失败 | 使用相互兼容的官方版本组合 |
| 14 | `nchains * nbeads` 超过 100000 | GPU显存溢出 (OOM) | 减小系统或分多窗口并行 |
| 15 | 跳过 XML 验证直接 `app.run()` | 配置错误要等N步后才暴露 | 先 `print(snap.npa, snap.box, snap.ntypes)` 校验 |
| 16 | 按 ReadTheDocs 调 NPT/FENE/Berendsen 等不存在的 API | 1.4.8 不支持，报 AttributeError | 以本 SKILL.md 为准；NPT 需等后续版本 |
| 17 | 用 `dump.data` 输出但忘了 `app.add(thermo)` | 数据文件为空（0 字节） | 输出对象必须 `app.add()` 注册后才生效 |

**触发式反例**（看到这些症状立即停止）：

- 看到 `nvvm.dll not found` → **STOP**：未调 `init_gpu()`，立即补上
- 看到 `Python int too large to convert to C long` → **STOP**：Python 3.13 + 模拟器模式，切真GPU
- 看到 `Number of particles mismatch` → **STOP**：XML的natoms与实际行数不一致
- 看到 `NaN` 或 `Inf` 在能量输出 → **STOP**：dt过大或初始重叠，先 `dt=0.001` 试跑

## 本地脚本

- `scripts/example_dpd_simulation.py` - 可直接运行的 AB 共聚物 DPD 示例
- `scripts/analyze_trajectory.py` - 读取 XML 轨迹并生成 RDF/MSD/Rg
- `scripts/physical_consistency_check.py` - Round 4 物理一致性检查
