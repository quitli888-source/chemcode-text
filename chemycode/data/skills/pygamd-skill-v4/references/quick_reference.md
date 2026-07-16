# PyGAMD 快速参考指南

## 基本命令

### 系统初始化

```python
import pygamd

# 读取配置文件（正确API）
snap = pygamd.snapshot.read("config.xml")
```

### 力场定义

#### DPD力场

```python
# 创建DPD力场（正确API）
dpd = pygamd.force.dpd(info=snap, rcut=1.0)

# 设置相互作用参数（正确API）
dpd.setParams(type_i="A", type_j="A", alpha=25.0, sigma=3.0)      # A-A
dpd.setParams(type_i="B", type_j="B", alpha=25.0, sigma=3.0)      # B-B
dpd.setParams(type_i="A", type_j="B", alpha=30.0, sigma=3.0)      # A-B
```

**参数说明**：
- `rcut`: 截断距离（DPD单位，通常为1.0）
- `alpha`: 保守力系数（排斥强度）
- `sigma`: 耗散力系数（能量耗散）

#### Lennard-Jones力场

```python
# 创建LJ力场（正确API）
lj = pygamd.force.slj(info=snap, rcut=2.5)

# 设置参数（slj setParams 签名: type_i, type_j, [epsilon, sigma, alpha] 或 [epsilon, sigma, alpha, rcut]）
lj.setParams("A", "A", [1.0, 1.0, 1.0])
lj.setParams("A", "B", [0.5, 1.0, 1.0])
```

**参数说明**：
- `epsilon`: 能量参数（势阱深度）
- `sigma`: 长度参数（粒子直径）

#### 键合力场

```python
# 谐波键势（pygamd只支持harmonic，不支持fene）
bond = pygamd.force.bond(info=snap, func='harmonic')
bond.setParams(bond_type="bond1", param=[100.0, 0.5])  # [k, r0]
```

### 积分器

#### DPD专用积分器（GWVV）

```python
# GWVV积分器（DPD推荐，正确API）
integrator = pygamd.integration.gwvv(info=snap, group="all")
```

### 模拟应用

```python
# 创建模拟应用（正确API）
app = pygamd.application.dynamics(snap, dt=0.005)

# 添加力场和积分器（正确API，不加方括号）
app.add(dpd)
app.add(bond)
app.add(integrator)

# 运行模拟
app.run(10000)              # 运行10,000步
```

### 数据输出

#### 轨迹输出

```python
# XML轨迹输出（正确API）
dump = pygamd.dump.xml(info=snap, group="all", file='trajectory', period=1000)
app.add(dump)
```

#### 分析输出

**重要说明**：pygamd 1.4.8 **没有** `analysis` 子模块。`pygamd` 包只导出：
`application, chare, force, integration, plist, snapshot, tinker, dump`。

RDF / MSD / Rg / Sq 等结构与动力学分析需要：
1. **dump 输出 XML 轨迹** → 用第三方工具分析
2. **推荐工具**：
   - **OVITO** (C++/Python): `pip install ovito` — 可视化 + RDF + MSD + CNA
   - **MDAnalysis** (Python): `pip install MDAnalysis` — 通用分析
   - **gmx_MMPBSA** / 自写 NumPy 脚本 — 简单 RDF/MSD 计算

```python
# 正确做法：dump XML 轨迹，再用 OVITO 分析
dump = pygamd.dump.xml(info=snap, group="all", file='trajectory', period=1000)
app.add(dump)
app.run(100000)

# 之后用 OVITO 读 trajectory.*.xml 计算 RDF
# from ovito.io import import_file
# from ovito.modifiers import CoordinationNumberModifier
# pipeline = import_file('trajectory.0.xml')
# pipeline.modifiers.append(CoordinationNumberModifier(cutoff=1.0, partial=True))
```

## 常用参数

### DPD参数

| 参数 | 值 | 说明 |
|------|-----|------|
| cutoff | 1.0 | 截断距离（DPD单位） |
| A (相同组分) | 25.0 | 保守力系数 |
| A (不同组分) | 30.0-35.0 | 排斥更强，决定相分离 |
| gamma | 4.5 | 耗散力系数 |
| dt | 0.005 | 时间步长 |
| T | 1.0 | 温度（DPD单位） |
| rho | 3.0 | 数密度 |

### 键势参数（仅支持harmonic）

| 参数 | 值 | 说明 |
|------|-----|------|
| k | 100.0 | 弹簧常数 |
| r0 | 0.5 | 平衡距离 |

注意：pygamd不支持FENE键势，只能用harmonic。

### 温度控制

pygamd使用DPD内禀热浴（通过DPD耗散力自动控温），无需额外恒温器。
GWVV积分器已内置温度控制。

## 常见任务

### 1. AB两嵌段共聚物模拟

```python
# 系统参数
nchains = 100
nbeads = 100
fA = 0.5
rho = 3.0
T = 1.0

# 力场设置（正确API）
dpd = pygamd.force.dpd(info=snap, rcut=1.0)
dpd.setParams(type_i="A", type_j="A", alpha=25.0, sigma=3.0)
dpd.setParams(type_i="B", type_j="B", alpha=25.0, sigma=3.0)
dpd.setParams(type_i="A", type_j="B", alpha=30.0, sigma=3.0)

# 积分器（正确API）
integrator = pygamd.integration.gwvv(info=snap, group="all")

# 运行（正确API）
app = pygamd.application.dynamics(snap, dt=0.005)
app.add(dpd)
app.add(integrator)
app.run(100000)
```

### 2. 均聚物熔体

```python
# 系统参数
nchains = 200
nbeads = 50
rho = 3.0

# 力场设置（正确API）
dpd = pygamd.force.dpd(info=snap, rcut=1.0)
dpd.setParams(type_i="A", type_j="A", alpha=25.0, sigma=3.0)

# 键势（正确API，只支持harmonic）
bond = pygamd.force.bond(info=snap, func='harmonic')
bond.setParams(bond_type="bond1", param=[100.0, 0.5])

# 运行（正确API）
app = pygamd.application.dynamics(snap, dt=0.005)
app.add(dpd)
app.add(bond)
app.add(integrator)
app.run(50000)
```

### 3. 两相系统

```python
# 创建两相系统
# 相1：A粒子
# 相2：B粒子

# 力场设置（正确API）
dpd = pygamd.force.dpd(info=snap, rcut=1.0)
dpd.setParams(type_i="A", type_j="A", alpha=25.0, sigma=3.0)
dpd.setParams(type_i="B", type_j="B", alpha=25.0, sigma=3.0)
dpd.setParams(type_i="A", type_j="B", alpha=40.0, sigma=3.0)  # 强排斥

# 运行平衡（正确API）
app = pygamd.application.dynamics(snap, dt=0.005)
app.add(dpd)
app.add(integrator)
app.run(50000)
```

## 数据分析

### 计算扩散系数

```python
# 从MSD计算扩散系数
def calculate_diffusion_coefficient(time, msd):
    # 选择线性区域
    n = len(time)
    start = n // 2
    
    # 线性拟合
    coeffs = np.polyfit(time[start:], msd[start:], 1)
    slope = coeffs[0]
    
    # 扩散系数
    D = slope / 6.0
    return D
```

### 分析相分离

```python
# 从RDF分析相分离
def analyze_phase_separation(r_AA, g_AA, r_BB, g_BB, r_AB, g_AB):
    # 找到第一个峰
    def find_first_peak(r, g_r):
        for i in range(1, len(g_r)-1):
            if g_r[i] > g_r[i-1] and g_r[i] > g_r[i+1]:
                return r[i], g_r[i]
        return None, None
    
    r_peak_AA, g_peak_AA = find_first_peak(r_AA, g_AA)
    r_peak_BB, g_peak_BB = find_first_peak(r_BB, g_BB)
    r_peak_AB, g_peak_AB = find_first_peak(r_AB, g_AB)
    
    # 计算相分离强度
    phase_separation_index = (g_peak_AA + g_peak_BB) / (2 * g_peak_AB)
    return phase_separation_index
```

## 故障排除

### 1. 内存不足

```python
# 减少粒子数量
nchains = 50  # 减少链数量

# 使用更频繁的输出（正确API）
dump = pygamd.dump.xml(info=snap, group="all", file='trajectory', period=5000)
app.add(dump)
```

### 2. 模拟不稳定

```python
# 减小时间步长（正确API）
app = pygamd.application.dynamics(snap, dt=0.002)

# 检查初始配置
# 确保没有重叠粒子
```

### 3. 相分离不明显

```python
# 增大A-B排斥系数（正确API）
dpd.setParams(type_i="A", type_j="B", alpha=35.0, sigma=3.0)

# 增加模拟步数
app.run(500000)

# 降低温度（如果适用）
T = 0.5
```

### 4. 链交叉问题

```python
# 软排斥势：pygamd 1.4.8 不支持 srp 类, 改用 slj 近似排斥项
# 或自实现势函数: U(r) = A*(1 - r/rcut)^2 for r < rcut
# 详见 SKILL.md "非键相互作用" 段
# 替代: lj = pygamd.force.slj(info=snap, rcut=1.0); app.add(lj)
```

## 性能优化

### 1. 使用GPU

```python
import pygamd
# GPU 可用性由 PyGAMD 安装及 CUDA 环境决定
```

### 2. 性能优化

```python
# 减少输出频率（正确API）
dump = pygamd.dump.xml(info=snap, group="all", file='trajectory', period=10000)
app.add(dump)
```

## 参考资源

- **官方文档**: https://pygamd-v1.readthedocs.io/
- **GitHub仓库**: https://github.com/PyGAMD/PyGAMD
- **本地脚本**: `scripts/example_dpd_simulation.py`、`scripts/analyze_trajectory.py`、`scripts/physical_consistency_check.py`
