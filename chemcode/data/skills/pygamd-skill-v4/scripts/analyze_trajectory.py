#!/usr/bin/env python3
"""
PyGAMD轨迹分析脚本
分析DPD模拟结果
"""

import numpy as np
import matplotlib.pyplot as plt
import sys
import os

def load_rdf_data(filename):
    """
    加载RDF数据
    """
    try:
        data = np.loadtxt(filename, skiprows=1)
        r = data[:, 0]
        g_r = data[:, 1]
        return r, g_r
    except Exception as e:
        print(f"加载RDF数据失败: {e}")
        return None, None

def load_msd_data(filename):
    """
    加载MSD数据（time, msd 两列）
    """
    try:
        data = np.loadtxt(filename, skiprows=1)
        time = data[:, 0]
        msd = data[:, 1]
        return time, msd
    except Exception as e:
        print(f"加载MSD数据失败: {e}")
        return None, None

def load_rg_data(filename):
    """
    加载回转半径数据
    """
    try:
        data = np.loadtxt(filename, skiprows=1)
        time = data[:, 0]
        rg = data[:, 1]
        return time, rg
    except Exception as e:
        print(f"加载回转半径数据失败: {e}")
        return None, None

def calculate_diffusion_coefficient(time, msd):
    """
    计算扩散系数
    D = lim(t→∞) MSD(t) / (6t)
    """
    # 选择线性区域（后半部分）
    n = len(time)
    start = n // 2
    
    # 线性拟合
    coeffs = np.polyfit(time[start:], msd[start:], 1)
    slope = coeffs[0]
    
    # 扩散系数
    D = slope / 6.0
    
    return D, slope

def plot_rdf(r_AA, g_AA, r_BB, g_BB, r_AB, g_AB, output_file="rdf_plot.png"):
    """
    绘制RDF图
    """
    plt.figure(figsize=(10, 6))
    
    plt.plot(r_AA, g_AA, 'b-', linewidth=2, label='A-A')
    plt.plot(r_BB, g_BB, 'r-', linewidth=2, label='B-B')
    plt.plot(r_AB, g_AB, 'g-', linewidth=2, label='A-B')
    
    plt.xlabel('r (DPD单位)', fontsize=12)
    plt.ylabel('g(r)', fontsize=12)
    plt.title('径向分布函数 (RDF)', fontsize=14)
    plt.legend(fontsize=12)
    plt.grid(True, alpha=0.3)
    plt.xlim(0, 2.0)
    
    plt.tight_layout()
    plt.savefig(output_file, dpi=300, bbox_inches='tight')
    print(f"RDF图已保存到: {output_file}")
    
    return plt.gcf()

def plot_msd(time, msd_all, msd_A, msd_B, output_file="msd_plot.png"):
    """
    绘制MSD图
    """
    plt.figure(figsize=(10, 6))
    
    plt.plot(time, msd_all, 'b-', linewidth=2, label='所有粒子')
    plt.plot(time, msd_A, 'r--', linewidth=2, label='A粒子')
    plt.plot(time, msd_B, 'g-.', linewidth=2, label='B粒子')
    
    # 计算扩散系数
    D_all, _ = calculate_diffusion_coefficient(time, msd_all)
    D_A, _ = calculate_diffusion_coefficient(time, msd_A)
    D_B, _ = calculate_diffusion_coefficient(time, msd_B)
    
    plt.xlabel('时间 (DPD单位)', fontsize=12)
    plt.ylabel('MSD (DPD单位²)', fontsize=12)
    plt.title(f'均方位移 (MSD)\nD_all={D_all:.4f}, D_A={D_A:.4f}, D_B={D_B:.4f}', fontsize=14)
    plt.legend(fontsize=12)
    plt.grid(True, alpha=0.3)
    
    plt.tight_layout()
    plt.savefig(output_file, dpi=300, bbox_inches='tight')
    print(f"MSD图已保存到: {output_file}")
    
    return plt.gcf()

def plot_rg(time, rg, output_file="rg_plot.png"):
    """
    绘制回转半径图
    """
    plt.figure(figsize=(10, 6))
    
    plt.plot(time, rg, 'b-', linewidth=2)
    
    # 计算平均值
    avg_rg = np.mean(rg)
    std_rg = np.std(rg)
    
    plt.axhline(avg_rg, color='r', linestyle='--', 
                label=f'平均值: {avg_rg:.3f} ± {std_rg:.3f}')
    
    plt.xlabel('时间 (DPD单位)', fontsize=12)
    plt.ylabel('回转半径 (DPD单位)', fontsize=12)
    plt.title('回转半径随时间变化', fontsize=14)
    plt.legend(fontsize=12)
    plt.grid(True, alpha=0.3)
    
    plt.tight_layout()
    plt.savefig(output_file, dpi=300, bbox_inches='tight')
    print(f"回转半径图已保存到: {output_file}")
    
    return plt.gcf()

def analyze_phase_separation(r_AA, g_AA, r_BB, g_BB, r_AB, g_AB):
    """
    分析相分离程度
    """
    # 计算第一个峰的位置和高度
    def find_first_peak(r, g_r):
        # 找到第一个峰
        for i in range(1, len(g_r)-1):
            if g_r[i] > g_r[i-1] and g_r[i] > g_r[i+1]:
                return r[i], g_r[i]
        return None, None
    
    r_peak_AA, g_peak_AA = find_first_peak(r_AA, g_AA)
    r_peak_BB, g_peak_BB = find_first_peak(r_BB, g_BB)
    r_peak_AB, g_peak_AB = find_first_peak(r_AB, g_AB)
    
    print("\n相分离分析:")
    print(f"  A-A RDF第一个峰: r={r_peak_AA:.3f}, g(r)={g_peak_AA:.3f}")
    print(f"  B-B RDF第一个峰: r={r_peak_BB:.3f}, g(r)={g_peak_BB:.3f}")
    print(f"  A-B RDF第一个峰: r={r_peak_AB:.3f}, g(r)={g_peak_AB:.3f}")
    
    # 计算相分离指标
    if g_peak_AA and g_peak_BB and g_peak_AB:
        # 相分离强度指标
        phase_separation_index = (g_peak_AA + g_peak_BB) / (2 * g_peak_AB)
        print(f"  相分离强度指标: {phase_separation_index:.3f}")
        
        if phase_separation_index > 1.5:
            print("  结论: 强相分离")
        elif phase_separation_index > 1.1:
            print("  结论: 中等相分离")
        else:
            print("  结论: 弱相分离或均相混合")
    
    return phase_separation_index

def main():
    """主函数"""
    print("="*60)
    print("PyGAMD轨迹分析")
    print("="*60)
    
    # 检查文件是否存在
    files_to_check = [
        'rdf_AA.dat', 'rdf_BB.dat', 'rdf_AB.dat',
        'msd_all.dat', 'msd_A.dat', 'msd_B.dat',
        'rg.dat'
    ]
    for f in files_to_check:
        if not os.path.exists(f):
            print(f"警告: 文件 {f} 不存在")

    # 加载数据
    print("\n1. 加载数据...")

    # RDF数据（A-A, B-B, A-B 分别存储）
    r_AA, g_AA = load_rdf_data('rdf_AA.dat')
    r_BB, g_BB = load_rdf_data('rdf_BB.dat')
    r_AB, g_AB = load_rdf_data('rdf_AB.dat')

    # MSD数据（全体/A类/B类 分别存储）
    time_msd, msd_all = load_msd_data('msd_all.dat')
    _, msd_A = load_msd_data('msd_A.dat')
    _, msd_B = load_msd_data('msd_B.dat')

    # 回转半径数据
    time_rg, rg = load_rg_data('rg.dat')
    
    # 分析和绘图
    print("\n2. 分析数据...")
    
    # 绘制RDF
    if r_AA is not None:
        plot_rdf(r_AA, g_AA, r_BB, g_BB, r_AB, g_AB)
        analyze_phase_separation(r_AA, g_AA, r_BB, g_BB, r_AB, g_AB)
    
    # 绘制MSD
    if time_msd is not None:
        plot_msd(time_msd, msd_all, msd_A, msd_B)
        
        # 计算扩散系数
        D, _ = calculate_diffusion_coefficient(time_msd, msd_all)
        print(f"\n扩散系数:")
        print(f"  D = {D:.6f} (DPD单位)")
    
    # 绘制回转半径
    if time_rg is not None:
        plot_rg(time_rg, rg)
        
        # 统计信息
        avg_rg = np.mean(rg)
        std_rg = np.std(rg)
        print(f"\n回转半径:")
        print(f"  平均值: {avg_rg:.3f} ± {std_rg:.3f} (DPD单位)")
    
    print("\n分析完成！")
    print("输出文件:")
    print("  - rdf_plot.png: 径向分布函数图")
    print("  - msd_plot.png: 均方位移图")
    print("  - rg_plot.png: 回转半径图")

if __name__ == "__main__":
    main()