"""
physical_consistency_check.py - PyGAMD 物理一致性自检工具 (Round 3 严苛化)

针对 pygamd 模拟输入做 4 维物理一致性检查：
  1. 量级范围（DPD α/γ/sigma、LJ ε/σ、Bond k/r0）
  2. 量纲与单位（DPD reduced units vs SI 单位、dt 量级）
  3. 守恒律/涨落-耗散/virial 自洽（运行后 frame-by-frame 监控）
  4. 稳定性预检（dt 上限、rcut < L/2、skin、ρ*、盒子各向异性）

**重要约束**：
  - 本脚本**不** `import pygamd`，仅做输入参数物理一致性分析
  - 阈值基于 pygamd 1.4.8 经验（Round 3 严苛收紧自 Round 2）
  - 通过 `python physical_consistency_check.py` 或 `python -m` 运行
  - 输出 Markdown 报告，便于纳入 CI 流水线

作者: pygamd-physics-developer (Round 3 严苛强化)
许可: 与 SKILL.md 同源
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import dataclass, field, asdict
from typing import Any


# ---------------------------------------------------------------------------
# 严苛化阈值常量（Round 3 研究级，所有百分比按绝对值计）
# ---------------------------------------------------------------------------

# DPD 参数典型范围
DPD_ALPHA_MIN, DPD_ALPHA_MAX = 10.0, 50.0
DPD_SIGMA_MIN, DPD_SIGMA_MAX = 3.0, 6.0
DPD_GAMMA_MIN, DPD_GAMMA_MAX = 3.0, 10.0
DPD_KBT = 1.0  # reduced units
DPD_RHO_MIN, DPD_RHO_MAX = 3.0, 10.0

# LJ 参数典型范围
LJ_EPSILON_MIN, LJ_EPSILON_MAX = 0.1, 5.0
LJ_SIGMA_MIN, LJ_SIGMA_MAX = 0.8, 1.5

# 键势 (harmonic) 参数典型范围
BOND_K_MIN, BOND_K_MAX = 50.0, 500.0
BOND_R0_MIN, BOND_R0_MAX = 0.7, 1.2

# 角度/二面角参数典型范围
DIHEDRAL_K_MIN, DIHEDRAL_K_MAX = 1.0, 50.0
DIHEDRAL_MULT_VALID = {1, 2, 3, 4, 6}

# dt 硬上限 (各力场)
DT_MAX_TABLE = {
    "dpd": 0.04,
    "slj": 0.005,
    "langevin": 0.01,
}

# 守恒律与涨落判据（研究级）
NVE_DRIFT_TOL = 5e-6  # 10k 步内 ΔE/E0 (Round 4)
NVT_TEMP_DEV_TOL = 0.015  # |T_mean - T*|/T*
NVT_TEMP_FLUC_TOL = 0.015  # σ(T)/<T>
FDT_TOL = 0.015  # |σ² - 2γkBT| / (2γkBT)
VIRIAL_TOL = 0.008  # |P_meas - P_est|/P_est

# 物理稳定性
RCUT_LMIN_RATIO_MAX = 0.5
RCUT_LMIN_SAFE = 0.4
SKIN_DRMAX_RATIO_MIN = 0.3
BOX_ASPECT_MAX = 2.0

# 高阶矩修正系数
HOOVER_DIMARZIO_FACTOR = 0.3


# ---------------------------------------------------------------------------
# 数据结构
# ---------------------------------------------------------------------------

@dataclass
class CheckResult:
    """单个检查项的结果"""
    name: str
    ok: bool
    severity: str  # "ok" | "warn" | "error"
    message: str
    actual: Any = None
    expected: Any = None


@dataclass
class ConsistencyReport:
    """完整物理一致性报告"""
    passed: int = 0
    warned: int = 0
    failed: int = 0
    results: list[CheckResult] = field(default_factory=list)

    def add(self, r: CheckResult) -> None:
        self.results.append(r)
        if r.ok:
            self.passed += 1
        elif r.severity == "warn":
            self.warned += 1
        else:
            self.failed += 1

    @property
    def all_ok(self) -> bool:
        return self.failed == 0

    def to_dict(self) -> dict:
        return {
            "passed": self.passed,
            "warned": self.warned,
            "failed": self.failed,
            "all_ok": self.all_ok,
            "results": [asdict(r) for r in self.results],
        }

    def to_markdown(self) -> str:
        lines = [
            "# PyGAMD 物理一致性自检报告 (Round 3 研究级)",
            "",
            f"- ✅ 通过: **{self.passed}**",
            f"- ⚠️  警告: **{self.warned}**",
            f"- ❌ 失败: **{self.failed}**",
            f"- **总判定**: {'✅ 全部通过' if self.all_ok else '❌ 存在失败项'}",
            "",
            "| 检查项 | 严重度 | 状态 | 实际值 | 期望值 | 说明 |",
            "|--------|--------|------|--------|--------|------|",
        ]
        for r in self.results:
            status = "✅" if r.ok else ("⚠️" if r.severity == "warn" else "❌")
            actual = json.dumps(r.actual, ensure_ascii=False) if r.actual is not None else "-"
            expected = json.dumps(r.expected, ensure_ascii=False) if r.expected is not None else "-"
            lines.append(f"| {r.name} | {r.severity} | {status} | {actual} | {expected} | {r.message} |")
        return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# 1. 量级范围检查
# ---------------------------------------------------------------------------

def check_dpd_magnitude(alpha: float, sigma: float, gamma: float,
                        dt: float, kBT: float = DPD_KBT) -> list[CheckResult]:
    """DPD 参数是否在经验量级范围"""
    results: list[CheckResult] = []

    # alpha
    if DPD_ALPHA_MIN <= alpha <= DPD_ALPHA_MAX:
        results.append(CheckResult(
            name="DPD.alpha 量级",
            ok=True, severity="ok",
            message=f"α={alpha} ∈ [{DPD_ALPHA_MIN}, {DPD_ALPHA_MAX}]（Groot-Warren 经验）",
            actual=alpha, expected=[DPD_ALPHA_MIN, DPD_ALPHA_MAX],
        ))
    elif alpha < DPD_ALPHA_MIN:
        results.append(CheckResult(
            name="DPD.alpha 量级",
            ok=False, severity="error",
            message=f"α={alpha} < {DPD_ALPHA_MIN}：保守力过弱，相分离可能缺失",
            actual=alpha, expected=[DPD_ALPHA_MIN, DPD_ALPHA_MAX],
        ))
    else:
        results.append(CheckResult(
            name="DPD.alpha 量级",
            ok=False, severity="error",
            message=f"α={alpha} > {DPD_ALPHA_MAX}：保守力过强，数值不稳定",
            actual=alpha, expected=[DPD_ALPHA_MIN, DPD_ALPHA_MAX],
        ))

    # sigma
    if DPD_SIGMA_MIN <= sigma <= DPD_SIGMA_MAX:
        results.append(CheckResult(
            name="DPD.sigma 量级",
            ok=True, severity="ok",
            message=f"σ={sigma} ∈ [{DPD_SIGMA_MIN}, {DPD_SIGMA_MAX}]",
            actual=sigma, expected=[DPD_SIGMA_MIN, DPD_SIGMA_MAX],
        ))
    else:
        results.append(CheckResult(
            name="DPD.sigma 量级",
            ok=False, severity="warn",
            message=f"σ={sigma} 超出 [{DPD_SIGMA_MIN}, {DPD_SIGMA_MAX}]；"
                    f"涨落-耗散关系需重新校准",
            actual=sigma, expected=[DPD_SIGMA_MIN, DPD_SIGMA_MAX],
        ))

    # gamma
    if DPD_GAMMA_MIN <= gamma <= DPD_GAMMA_MAX:
        results.append(CheckResult(
            name="DPD.gamma 量级",
            ok=True, severity="ok",
            message=f"γ={gamma} ∈ [{DPD_GAMMA_MIN}, {DPD_GAMMA_MAX}]",
            actual=gamma, expected=[DPD_GAMMA_MIN, DPD_GAMMA_MAX],
        ))
    else:
        results.append(CheckResult(
            name="DPD.gamma 量级",
            ok=False, severity="warn",
            message=f"γ={gamma} 超出典型范围；摩擦/扩散比例需重新标定",
            actual=gamma, expected=[DPD_GAMMA_MIN, DPD_GAMMA_MAX],
        ))

    return results


def check_lj_magnitude(epsilon: float, sigma: float) -> list[CheckResult]:
    """LJ 参数是否在经验量级范围"""
    results: list[CheckResult] = []
    if LJ_EPSILON_MIN <= epsilon <= LJ_EPSILON_MAX:
        results.append(CheckResult(
            name="LJ.epsilon 量级",
            ok=True, severity="ok",
            message=f"ε={epsilon} ∈ [{LJ_EPSILON_MIN}, {LJ_EPSILON_MAX}]",
            actual=epsilon, expected=[LJ_EPSILON_MIN, LJ_EPSILON_MAX],
        ))
    else:
        results.append(CheckResult(
            name="LJ.epsilon 量级",
            ok=False, severity="warn",
            message=f"ε={epsilon} 超出经验范围",
            actual=epsilon, expected=[LJ_EPSILON_MIN, LJ_EPSILON_MAX],
        ))
    if LJ_SIGMA_MIN <= sigma <= LJ_SIGMA_MAX:
        results.append(CheckResult(
            name="LJ.sigma 量级",
            ok=True, severity="ok",
            message=f"σ_LJ={sigma} ∈ [{LJ_SIGMA_MIN}, {LJ_SIGMA_MAX}]",
            actual=sigma, expected=[LJ_SIGMA_MIN, LJ_SIGMA_MAX],
        ))
    else:
        results.append(CheckResult(
            name="LJ.sigma 量级",
            ok=False, severity="warn",
            message=f"σ_LJ={sigma} 超出经验范围",
            actual=sigma, expected=[LJ_SIGMA_MIN, LJ_SIGMA_MAX],
        ))
    return results


def check_bond_magnitude(k: float, r0: float) -> list[CheckResult]:
    """谐波键势参数是否在经验量级范围"""
    results: list[CheckResult] = []
    if BOND_K_MIN <= k <= BOND_K_MAX:
        results.append(CheckResult(
            name="Bond.k 量级",
            ok=True, severity="ok",
            message=f"k={k} ∈ [{BOND_K_MIN}, {BOND_K_MAX}]",
            actual=k, expected=[BOND_K_MIN, BOND_K_MAX],
        ))
    else:
        results.append(CheckResult(
            name="Bond.k 量级",
            ok=False, severity="warn",
            message=f"k={k} 超出经验范围；k<{BOND_K_MIN} 链太软，k>{BOND_K_MAX} 需 dt<0.01",
            actual=k, expected=[BOND_K_MIN, BOND_K_MAX],
        ))
    if BOND_R0_MIN <= r0 <= BOND_R0_MAX:
        results.append(CheckResult(
            name="Bond.r0 量级",
            ok=True, severity="ok",
            message=f"r0={r0} ∈ [{BOND_R0_MIN}, {BOND_R0_MAX}]",
            actual=r0, expected=[BOND_R0_MIN, BOND_R0_MAX],
        ))
    else:
        results.append(CheckResult(
            name="Bond.r0 量级",
            ok=False, severity="warn",
            message=f"r0={r0} 超出经验范围；可能与 rcut 冲突",
            actual=r0, expected=[BOND_R0_MIN, BOND_R0_MAX],
        ))
    return results


# ---------------------------------------------------------------------------
# 2. 单位系统 & dt 稳定性
# ---------------------------------------------------------------------------

def check_unit_system_mismatch(force_type: str, dt: float, kBT: float,
                               rcut: float) -> list[CheckResult]:
    """DPD reduced units vs SI 单位检测"""
    results: list[CheckResult] = []

    # kBT 单位假设
    if force_type == "dpd":
        if abs(kBT - 1.0) > 1e-6:
            results.append(CheckResult(
                name="单位. kBT",
                ok=False, severity="warn",
                message=f"DPD reduced units 下 kBT 应 = 1.0；当前 kBT={kBT}，"
                        f"若需物理 K 单位请先做 Groot-Warren 映射",
                actual=kBT, expected=1.0,
            ))
        else:
            results.append(CheckResult(
                name="单位. kBT",
                ok=True, severity="ok",
                message="DPD reduced units 一致 (kBT=1)",
                actual=kBT, expected=1.0,
            ))

    # dt 硬上限
    dt_max = DT_MAX_TABLE.get(force_type)
    if dt_max is None:
        results.append(CheckResult(
            name="dt 硬上限",
            ok=False, severity="error",
            message=f"未知力场类型 {force_type!r}，请用 {list(DT_MAX_TABLE.keys())}",
            actual=force_type, expected=list(DT_MAX_TABLE.keys()),
        ))
    elif dt > dt_max:
        results.append(CheckResult(
            name="dt 硬上限",
            ok=False, severity="error",
            message=f"dt={dt} > {force_type} 硬上限 {dt_max}；数值发散风险",
            actual=dt, expected=dt_max,
        ))
    else:
        results.append(CheckResult(
            name="dt 硬上限",
            ok=True, severity="ok",
            message=f"dt={dt} ≤ {force_type} 上限 {dt_max}",
            actual=dt, expected=dt_max,
        ))

    return results


# ---------------------------------------------------------------------------
# 3. 守恒律 / 涨落-耗散 / virial 自洽（运行后 frame-by-frame 监控）
# ---------------------------------------------------------------------------

def check_nve_drift(energies: list[float], n_steps_per_chunk: int = 1000) -> CheckResult:
    """NVE 能量漂移检测（研究级 1e-5/10k 步）"""
    if len(energies) < 2:
        return CheckResult(
            name="NVE.energy_drift",
            ok=False, severity="error",
            message="能量序列长度 < 2，无法计算漂移",
        )
    drift = abs(energies[-1] - energies[0]) / max(abs(energies[0]), 1e-12)
    n_steps = (len(energies) - 1) * n_steps_per_chunk
    # 归一化到 10k 步
    drift_normalized = drift * (10000 / n_steps) if n_steps > 0 else drift
    return CheckResult(
        name="NVE.energy_drift",
        ok=drift_normalized < NVE_DRIFT_TOL,
        severity="ok" if drift_normalized < NVE_DRIFT_TOL else "error",
        message=f"10k 步归一化漂移 {drift_normalized:.2e} (阈值 {NVE_DRIFT_TOL:.0e})",
        actual=drift_normalized, expected=NVE_DRIFT_TOL,
    )


def check_nvt_temperature(T_samples: list[float], T_target: float = 1.0) -> list[CheckResult]:
    """NVT 温度均值与涨落检测（研究级 2%）"""
    if not T_samples:
        return [CheckResult(
            name="NVT.temperature", ok=False, severity="error",
            message="温度序列为空",
        )]
    n = len(T_samples)
    T_mean = sum(T_samples) / n
    T_var = sum((T - T_mean) ** 2 for T in T_samples) / max(n - 1, 1)
    T_std = math.sqrt(T_var)
    dev = abs(T_mean - T_target) / T_target
    fluc = T_std / T_mean if T_mean > 0 else float("inf")
    return [
        CheckResult(
            name="NVT.T_mean",
            ok=dev < NVT_TEMP_DEV_TOL,
            severity="ok" if dev < NVT_TEMP_DEV_TOL else "error",
            message=f"⟨T*⟩={T_mean:.4f}, 偏离 {dev*100:.2f}% (阈值 {NVT_TEMP_DEV_TOL*100:.1f}%)",
            actual=dev, expected=NVT_TEMP_DEV_TOL,
        ),
        CheckResult(
            name="NVT.T_fluctuation",
            ok=fluc < NVT_TEMP_FLUC_TOL,
            severity="ok" if fluc < NVT_TEMP_FLUC_TOL else "error",
            message=f"σ(T)/⟨T⟩={fluc:.4f} (阈值 {NVT_TEMP_FLUC_TOL})",
            actual=fluc, expected=NVT_TEMP_FLUC_TOL,
        ),
    ]


def check_fluctuation_dissipation(sigma: float, gamma: float, dt: float = 0.0,
                                   mass: float = 1.0,
                                   kBT: float = DPD_KBT) -> list[CheckResult]:
    """涨落-耗散 σ²=2γkBT 一致性 + 1 阶高阶矩修正"""
    target = 2.0 * gamma * kBT
    deviation = abs(sigma**2 - target) / max(target, 1e-12)
    base_result = CheckResult(
        name="FDT.sigma_gamma_0阶",
        ok=deviation < FDT_TOL,
        severity="ok" if deviation < FDT_TOL else "error",
        message=f"σ²={sigma**2:.4f}, 2γkBT={target:.4f}, 偏差 {deviation*100:.2f}% (阈值 {FDT_TOL*100:.1f}%)",
        actual=deviation, expected=FDT_TOL,
    )
    results = [base_result]

    # 1 阶高阶矩修正
    if dt > 0:
        high_order = 1.0 + gamma * dt / (2.0 * mass)
        sigma_eff_sq = sigma**2 / high_order
        dev_eff = abs(sigma_eff_sq - target) / max(target, 1e-12)
        results.append(CheckResult(
            name="FDT.sigma_gamma_高阶修正",
            ok=dev_eff < FDT_TOL,
            severity="ok" if dev_eff < FDT_TOL else "warn",
            message=f"σ²_eff={sigma_eff_sq:.4f} (修正系数 {high_order:.4f}), 偏差 {dev_eff*100:.2f}%",
            actual=dev_eff, expected=FDT_TOL,
        ))
    return results


def check_virial_consistency(P_measured: float, P_estimate: float) -> CheckResult:
    """virial 自洽 ±1%（研究级）"""
    dev = abs(P_measured - P_estimate) / max(abs(P_estimate), 1e-12)
    return CheckResult(
        name="Virial.P_consistency",
        ok=dev < VIRIAL_TOL,
        severity="ok" if dev < VIRIAL_TOL else "error",
        message=f"P_meas={P_measured:.4f}, P_est={P_estimate:.4f}, 偏差 {dev*100:.2f}% (阈值 {VIRIAL_TOL*100:.1f}%)",
        actual=dev, expected=VIRIAL_TOL,
    )


# ---------------------------------------------------------------------------
# 4. 物理稳定性预检（启动前）
# ---------------------------------------------------------------------------

def check_box_rcut(rcut: float, lx: float, ly: float, lz: float) -> CheckResult:
    """rcut < L_min/2 判据"""
    L_min = min(lx, ly, lz)
    ratio = rcut / max(L_min, 1e-12)
    if ratio >= 0.5:
        return CheckResult(
            name="Stability.rcut",
            ok=False, severity="error",
            message=f"rcut/L_min={ratio:.3f} ≥ 0.5，粒子与镜像重叠！",
            actual=ratio, expected=RCUT_LMIN_RATIO_MAX,
        )
    if ratio >= RCUT_LMIN_SAFE:
        return CheckResult(
            name="Stability.rcut",
            ok=True, severity="warn",
            message=f"rcut/L_min={ratio:.3f} 处于警戒区 [0.4, 0.5)",
            actual=ratio, expected=RCUT_LMIN_SAFE,
        )
    return CheckResult(
        name="Stability.rcut",
        ok=True, severity="ok",
        message=f"rcut/L_min={ratio:.3f} < 0.4，安全",
        actual=ratio, expected=RCUT_LMIN_SAFE,
    )


def check_skin(skin: float, dt: float, v_max: float = 5.0) -> CheckResult:
    """neighbor skin ≥ 0.3 × dr_max"""
    dr_max = v_max * dt
    min_skin = HOOVER_DIMARZIO_FACTOR * dr_max
    if skin < min_skin:
        return CheckResult(
            name="Stability.skin",
            ok=False, severity="warn",
            message=f"skin={skin} < 0.3·dr_max={min_skin:.3f}，可能漏更新 neighbor",
            actual=skin, expected=min_skin,
        )
    return CheckResult(
        name="Stability.skin",
        ok=True, severity="ok",
        message=f"skin={skin} ≥ 0.3·dr_max={min_skin:.3f}",
        actual=skin, expected=min_skin,
    )


def check_density(npa: int, lx: float, ly: float, lz: float) -> CheckResult:
    """ρ* ∈ [3, 10]"""
    V = lx * ly * lz
    rho = npa / V
    if not (DPD_RHO_MIN <= rho <= DPD_RHO_MAX):
        return CheckResult(
            name="Stability.rho_star",
            ok=False, severity="warn",
            message=f"ρ*={rho:.3f} 超出 DPD 经验区间 [{DPD_RHO_MIN}, {DPD_RHO_MAX}]",
            actual=rho, expected=[DPD_RHO_MIN, DPD_RHO_MAX],
        )
    return CheckResult(
        name="Stability.rho_star",
        ok=True, severity="ok",
        message=f"ρ*={rho:.3f} ∈ [{DPD_RHO_MIN}, {DPD_RHO_MAX}]",
        actual=rho, expected=[DPD_RHO_MIN, DPD_RHO_MAX],
    )


def check_box_aspect(lx: float, ly: float, lz: float) -> CheckResult:
    """盒子长/短轴比 ≤ 2"""
    L_max, L_min = max(lx, ly, lz), min(lx, ly, lz)
    aspect = L_max / max(L_min, 1e-12)
    if aspect > BOX_ASPECT_MAX:
        return CheckResult(
            name="Stability.box_aspect",
            ok=False, severity="warn",
            message=f"长/短轴比={aspect:.2f} > {BOX_ASPECT_MAX}，数值各向异性",
            actual=aspect, expected=BOX_ASPECT_MAX,
        )
    return CheckResult(
        name="Stability.box_aspect",
        ok=True, severity="ok",
        message=f"长/短轴比={aspect:.2f} ≤ {BOX_ASPECT_MAX}",
        actual=aspect, expected=BOX_ASPECT_MAX,
    )


# ---------------------------------------------------------------------------
# 守恒律 frame-by-frame 监控钩子
# ---------------------------------------------------------------------------

class ConservationMonitor:
    """运行中守恒律实时监控器

    用法（在模拟循环内每 N 步调用一次）：
        mon = ConservationMonitor(expected_T=1.0)
        for step in range(total_steps):
            app.run(1)
            if step % 100 == 0:
                ke = 0.5 * sum(snap.velocity**2)
                alert = mon.update(ke=ke, npa=snap.npa)
                if alert:
                    logger.error(f"守恒律警告: {alert}")
    """

    def __init__(self, expected_T: float = 1.0, nvt_tol: float = NVT_TEMP_DEV_TOL):
        self.expected_T = expected_T
        self.nvt_tol = nvt_tol
        self.initial_E: float | None = None
        self.T_samples: list[float] = []
        self.alerts: list[str] = []

    def update(self, ke: float, npa: int) -> str | None:
        """更新一帧，返回警告信息或 None"""
        T = 2.0 * ke / max(3.0 * npa - 3.0, 1.0)
        self.T_samples.append(T)

        if self.initial_E is None:
            self.initial_E = ke

        # NaN/Inf 检测
        if not math.isfinite(ke) or not math.isfinite(T):
            msg = f"能量/T 非有限值（NaN/Inf），ke={ke}，立即终止"
            self.alerts.append(msg)
            return msg

        # 温度漂移检测（需要 ≥ 10 个采样）
        if len(self.T_samples) >= 10:
            recent = self.T_samples[-50:]
            T_mean = sum(recent) / len(recent)
            dev = abs(T_mean - self.expected_T) / self.expected_T
            if dev > self.nvt_tol:
                msg = (f"NVT 温度漂移 {dev*100:.2f}% > {self.nvt_tol*100:.1f}%；"
                       f"⟨T*⟩={T_mean:.4f}, T*={self.expected_T}")
                self.alerts.append(msg)
                return msg
        return None

    def summary(self) -> dict:
        if not self.T_samples:
            return {"samples": 0}
        n = len(self.T_samples)
        T_mean = sum(self.T_samples) / n
        T_var = sum((T - T_mean) ** 2 for T in self.T_samples) / max(n - 1, 1)
        return {
            "samples": n,
            "T_mean": T_mean,
            "T_std": math.sqrt(T_var),
            "T_deviation": abs(T_mean - self.expected_T) / self.expected_T,
            "alerts": list(self.alerts),
        }


# ---------------------------------------------------------------------------
# 聚合入口
# ---------------------------------------------------------------------------

def run_full_check(
    *,
    # 几何
    lx: float, ly: float, lz: float, npa: int, rcut: float = 1.0,
    # 力场
    force_type: str = "dpd",
    alpha: float = 25.0, sigma: float = 3.0, gamma: float = 4.5,
    kBT: float = DPD_KBT,
    epsilon: float | None = None, sigma_lj: float | None = None,
    bond_k: float | None = None, bond_r0: float | None = None,
    # 积分
    dt: float = 0.005, mass: float = 1.0, skin: float = 0.3, v_max: float = 5.0,
    # 后验（可选）
    energies: list[float] | None = None,
    T_samples: list[float] | None = None,
    P_measured: float | None = None,
) -> ConsistencyReport:
    """运行完整 4 维物理一致性检查，返回聚合报告"""
    report = ConsistencyReport()

    # 1. 量级
    if force_type == "dpd":
        for r in check_dpd_magnitude(alpha, sigma, gamma, dt, kBT):
            report.add(r)
    if epsilon is not None and sigma_lj is not None:
        for r in check_lj_magnitude(epsilon, sigma_lj):
            report.add(r)
    if bond_k is not None and bond_r0 is not None:
        for r in check_bond_magnitude(bond_k, bond_r0):
            report.add(r)

    # 2. 单位与 dt
    for r in check_unit_system_mismatch(force_type, dt, kBT, rcut):
        report.add(r)

    # 3. 守恒律 / FDT / virial
    if energies is not None:
        report.add(check_nve_drift(energies))
    if T_samples is not None:
        for r in check_nvt_temperature(T_samples):
            report.add(r)
    if force_type == "dpd":
        for r in check_fluctuation_dissipation(sigma, gamma, dt, mass, kBT):
            report.add(r)
    if P_measured is not None and force_type == "dpd":
        P_estimate = npa / (lx * ly * lz) + alpha * (npa / (lx * ly * lz)) ** 2 / 5.0
        report.add(check_virial_consistency(P_measured, P_estimate))

    # 4. 稳定性
    report.add(check_box_rcut(rcut, lx, ly, lz))
    report.add(check_skin(skin, dt, v_max))
    report.add(check_density(npa, lx, ly, lz))
    report.add(check_box_aspect(lx, ly, lz))

    return report


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _demo_report() -> ConsistencyReport:
    """生成一个标准 DPD 体系的示例报告"""
    L = 11.86
    return run_full_check(
        lx=L, ly=L, lz=L,
        npa=5000, rcut=1.0,
        force_type="dpd",
        alpha=25.0, sigma=3.0, gamma=4.5,
        kBT=1.0,
        dt=0.005, mass=1.0, skin=0.3, v_max=5.0,
        energies=[100.0, 100.0001, 100.0002, 99.9999, 100.0001],
        T_samples=[1.0, 1.005, 0.998, 1.002, 0.999, 1.001, 1.003, 0.997, 1.0, 1.001],
        P_measured=47.9,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="PyGAMD 物理一致性自检 (Round 3 研究级)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="示例:\n"
               "  python physical_consistency_check.py            # 标准 DPD 演示\n"
               "  python physical_consistency_check.py --json     # 输出 JSON\n",
    )
    parser.add_argument("--json", action="store_true", help="输出 JSON 格式")
    parser.add_argument("--demo", action="store_true", help="运行标准 DPD 演示 (默认)")
    args = parser.parse_args(argv)

    report = _demo_report()

    # Windows 下 stdout 可能是 GBK，强制 UTF-8
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

    if args.json:
        print(json.dumps(report.to_dict(), ensure_ascii=False, indent=2))
    else:
        print(report.to_markdown())

    return 0 if report.all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
