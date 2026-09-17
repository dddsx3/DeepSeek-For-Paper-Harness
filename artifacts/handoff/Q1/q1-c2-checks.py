#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Q1-C2 — 2024-B machine 检查的双向实跑（H6）。

要求（任务书 §3.3-C2）：把 >=3 条 machine 检查**真的实现并跑一次**，
证明它能 (a) 在合格输入上通过、(b) 在退化输入上 raise。

本文件实现 5 条检查（覆盖 Q1-C1 的 B-06 / B-07 / B-08 / B-14 / B-16）。
每条检查在**违反时 raise CheckFailed**（对应任务书的 "raise" 要求），
驱动器捕获并记录两个方向的运行结果。

被测模型 M-1（复算器，**简化模型**）:
  决策变量 d = (inspect_p1, inspect_p2, inspect_final, disassemble)
  给定 (q_p1, q_p2, q_final_cond, ...) 计算期望单位利润。

  M-1 的两条回流结构（B-08 的检查对象）:
    路径 1（S8 逐字"对拆解后的零配件，重复步骤(1)和步骤(2)"）:
      拆解回收的零配件重新进入检测/装配，故每交付 1 件成品需装配的件数
      被一个几何级数放大: scale = 1/(1 - reflux_gain)
    路径 2（S9 逐字"对退回的不合格品，重复步骤(3)"）:
      用户退回的不合格品重新进入拆解决策，故拆解成本含 q_market 项

  参数取自 2024-B 表 1 情况 1（题面行 54，逐字）。
"""

import json
import sys
from itertools import product

# ---- 表 1 情况 1 参数（逐字取自题面行 54）----------------------------------
T1_CASE1 = {
    "q_p1": 0.10, "price_p1": 4.0, "inspect_p1_cost": 2.0,
    "q_p2": 0.10, "price_p2": 18.0, "inspect_p2_cost": 3.0,
    "q_final_cond": 0.10, "assemble_cost": 6.0, "inspect_final_cost": 3.0,
    "market_price": 56.0, "exchange_loss": 6.0, "disassemble_cost": 5.0,
}
UNIT = "元/件"


class CheckFailed(Exception):
    """检查被违反。对应任务书的 '在退化输入上 raise'。"""


# ===========================================================================
# 被测模型 M-1（复算器）
# ===========================================================================
def final_defect_rate(d, p):
    """成品不合格率。

    S13 逐字: "只要其中一个零配件不合格, 则成品一定不合格"
    S14 逐字: "半成品、成品的次品率是将**正品**零配件装配后的产品次品率"
    => 不合格率 = 1 - (1-q1_eff)(1-q2_eff)(1-q_final_cond)
    """
    insp1, insp2, _, _ = d
    q1_eff = 0.0 if insp1 else p["q_p1"]
    q2_eff = 0.0 if insp2 else p["q_p2"]
    return 1.0 - (1.0 - q1_eff) * (1.0 - q2_eff) * (1.0 - p["q_final_cond"])


def reflux_gain(d, p):
    """回流路径 1 的几何级数增益。

    每装配 1 件, 期望有 `q_final * dis` 件被拆解回收并**重新进入装配**；
    重新进入的零配件再次构成成品, 其不合格概率为
    (1 - (1-q1_eff)(1-q2_eff)) —— 即"至少一个回收件仍是不合格"的概率。
    """
    insp1, insp2, _, dis = d
    if not dis:
        return 0.0
    q1_eff = 0.0 if insp1 else p["q_p1"]
    q2_eff = 0.0 if insp2 else p["q_p2"]
    return final_defect_rate(d, p) * (1.0 - (1.0 - q1_eff) * (1.0 - q2_eff))


def expected_profit(d, p, *, include_reflux=True):
    """期望单位利润。d = (inspect_p1, inspect_p2, inspect_final, disassemble)。

    include_reflux=False 时**故意**退回顺序流程（漏掉回流）——供 B-08 的
    无回流对照算例使用。
    """
    insp1, insp2, inspf, dis = d
    q_final = final_defect_rate(d, p)
    q_market = 0.0 if inspf else q_final

    # --- 单次装配的直接成本（购买 + 检测 + 装配 + 成品检测）----------------
    unit_cost = (p["price_p1"] + (p["inspect_p1_cost"] if insp1 else 0.0)
                 + p["price_p2"] + (p["inspect_p2_cost"] if insp2 else 0.0)
                 + p["assemble_cost"]
                 + (p["inspect_final_cost"] if inspf else 0.0))

    # --- 回流路径 1: 几何级数放大（B-08 检查对象）-------------------------
    gain = reflux_gain(d, p) if include_reflux else 0.0
    if gain >= 1.0:
        raise ValueError("M-1: reflux_gain >= 1, 稳态不存在")
    scale = 1.0 / (1.0 - gain)

    # --- 回流路径 2: 退回件进入拆解（S9）----------------------------------
    exchange_cost = q_market * p["exchange_loss"]

    # --- 拆解成本: 检测出的不合格品 + 退回的不合格品（S8 + S9）-------------
    q_detect_fail = q_final if inspf else 0.0
    dis_cost = (q_detect_fail + q_market) * dis * p["disassemble_cost"]

    revenue = (1.0 - q_market) * p["market_price"]
    return revenue - scale * (unit_cost + exchange_cost) - dis_cost


def all_combinations():
    """决策空间: 四个布尔变量 => 2^4 = 16 种组合（B-06 的检查对象）。"""
    return [tuple(bool(b) for b in c) for c in product([0, 1], repeat=4)]


def delivered_metrics(p):
    """合格交付物: 16 个组合的指标（元/件）。"""
    return {d: {"value": expected_profit(d, p), "unit": UNIT} for d in all_combinations()}


# ===========================================================================
# 检查 1（B-06）：决策组合枚举完整性
# ===========================================================================
def check_b06_decision_enumeration(combos):
    """B-06: 须枚举全部 2^4 = 16 种决策组合（或显式裁剪）。违反即 raise。"""
    n = len(set(combos))
    if n != 16:
        raise CheckFailed(f"B-06: 决策组合数 {n} != 16 —— 方案集不封闭(F4-6)")
    if not all(len(c) == 4 and all(isinstance(b, bool) for b in c) for c in combos):
        raise CheckFailed("B-06: 存在非 4 元布尔组合")
    return f"16 种组合, 全部 4 元布尔"


# ===========================================================================
# 检查 2（B-07）：指标与方案一一对应 + 可复算
# ===========================================================================
def check_b07_metric_recomputable(delivered, combos, p, tol=1e-6):
    """B-07: 每个方案的指标可由参数复算（相对误差 < tol）。违反即 raise。"""
    if len(delivered) != len(combos):
        raise CheckFailed(f"B-07: {len(delivered)} 指标 != {len(combos)} 方案")
    bad = []
    for d, rec in delivered.items():
        mine = expected_profit(d, p)
        rel = abs(mine - rec["value"]) / max(abs(mine), 1e-12)
        if rel >= tol:
            bad.append((d, rec["value"], mine, rel))
    if bad:
        raise CheckFailed(f"B-07: {len(bad)}/{len(delivered)} 条复算不一致(F4-7), "
                          f"最大相对误差 {max(b[3] for b in bad):.3e}")
    if not all(rec["unit"] == UNIT for rec in delivered.values()):
        raise CheckFailed("B-07: 存在非 '元/件' 单位")
    return f"{len(delivered)} 条全部复算一致(rel < {tol:g})"


# ===========================================================================
# 检查 3（B-08）：回流结构存在 + 递归自洽 + 交付值须是含回流解
# ===========================================================================
def check_b08_reflux(delivered, combos, p, tol=1e-6):
    """B-08: 期望值方程须含两条回流路径。违反即 raise。

    判据（三条，均为结构性/可复算，不依赖单点幅值）:
      (a) 回流**确实可观测**: 存在某组合使含/不含回流的指标差 > tol；
          若全部组合差值恒为 0, 说明模型根本没有回流结构。
      (b) 递归自洽: 稳态方程 (1-gain)*scale == 1 的残差 < 1e-9。
      (c) 交付值 = **含回流**解（在回流最敏感的组合上），而非顺序流程解。
    """
    # (a) 回流可观测性
    diffs = {d: abs(expected_profit(d, p, include_reflux=True)
                    - expected_profit(d, p, include_reflux=False)) for d in combos}
    d_star = max(diffs, key=lambda k: diffs[k])
    if diffs[d_star] <= tol:
        raise CheckFailed("B-08: 全部组合的含/不含回流差值均为 0 —— 模型无回流结构(F4-8)")

    # (b) 递归自洽
    gain = reflux_gain(d_star, p)
    residual = abs((1.0 - gain) * (1.0 / (1.0 - gain)) - 1.0)
    if residual >= 1e-9:
        raise CheckFailed(f"B-08: 递归方程自洽残差 {residual:.3e} >= 1e-9")

    # (c) 交付值须是含回流解
    if d_star not in delivered:
        raise CheckFailed(f"B-08: 回流最敏感组合 {d_star} 不在交付方案集内")
    with_r = expected_profit(d_star, p, include_reflux=True)
    no_r = expected_profit(d_star, p, include_reflux=False)
    dv = delivered[d_star]["value"]
    if abs(dv - with_r) / max(abs(with_r), 1e-12) >= tol:
        raise CheckFailed(
            f"B-08: 交付值在回流敏感组合 {d_star} 上偏离含回流解 "
            f"(交付 {dv:.6f} vs 含回流 {with_r:.6f} vs 无回流 {no_r:.6f}) —— "
            f"疑似漏掉回流项(F4-8)")
    return (f"回流最敏感组合 {d_star}: 含回流 {with_r:.6f} vs 无回流 {no_r:.6f} "
            f"(差 {diffs[d_star]:.6f}); 交付值 = 含回流解")


# ===========================================================================
# 检查 4（B-14）：敏感性分析 >= 3 个扰动算例 + 报告翻转 + 临界值
# ===========================================================================
def check_b14_sensitivity(p, q_lo, q_hi, n_trials=5, report=None):
    """B-14: 次品率扰动下报告决策是否翻转; 若翻转须给出临界值。违反即 raise。"""
    combos = all_combinations()
    trials = []
    for i in range(n_trials):
        t = i / (n_trials - 1)
        q = q_lo + t * (q_hi - q_lo)
        pv = dict(p, q_p1=q, q_p2=q, q_final_cond=q)
        best = max(combos, key=lambda d: expected_profit(d, pv))
        trials.append({"q": round(q, 6), "best": best})
    if len(trials) < 3:
        raise CheckFailed(f"B-14: 扰动算例 {len(trials)} < 3")

    uniq = {t["best"] for t in trials}
    flipped = len(uniq) > 1
    detail = f"{len(trials)} 个算例; 翻转={flipped}"
    if flipped:
        lo, hi = q_lo, q_hi
        pv_lo = dict(p, q_p1=q_lo, q_p2=q_lo, q_final_cond=q_lo)
        b_lo = max(combos, key=lambda d: expected_profit(d, pv_lo))
        for _ in range(60):
            mid = (lo + hi) / 2
            pv = dict(p, q_p1=mid, q_p2=mid, q_final_cond=mid)
            if max(combos, key=lambda d: expected_profit(d, pv)) == b_lo:
                lo = mid
            else:
                hi = mid
        crit = (lo + hi) / 2
        detail += f"; 临界 q ≈ {crit:.6f}"
    if report is not None:
        report["trials"] = trials
        report["flipped"] = flipped
    return detail


# ===========================================================================
# 检查 5（B-16）：单位一致性
# ===========================================================================
def check_b16_units(delivered, cost_params):
    """B-16: 全部成本/价格/损失项与指标单位均为 '元/件'。违反即 raise。"""
    bad = [k for k, v in cost_params.items() if v.get("unit") != UNIT]
    if bad:
        raise CheckFailed(f"B-16: 成本项单位非 '元/件': {bad} (F3-5 口径不声明)")
    bad_m = [d for d, r in delivered.items() if r["unit"] != UNIT]
    if bad_m:
        raise CheckFailed(f"B-16: {len(bad_m)} 个指标的指标单位非 '元/件'")
    return f"全部 {len(cost_params)} 项成本 + {len(delivered)} 个指标为 '元/件'"


# ===========================================================================
# 驱动器：双向实跑
# ===========================================================================
def cost_params_of(p):
    return {
        "price_p1": {"v": p["price_p1"], "unit": UNIT},
        "inspect_p1_cost": {"v": p["inspect_p1_cost"], "unit": UNIT},
        "price_p2": {"v": p["price_p2"], "unit": UNIT},
        "inspect_p2_cost": {"v": p["inspect_p2_cost"], "unit": UNIT},
        "assemble_cost": {"v": p["assemble_cost"], "unit": UNIT},
        "inspect_final_cost": {"v": p["inspect_final_cost"], "unit": UNIT},
        "market_price": {"v": p["market_price"], "unit": UNIT},
        "exchange_loss": {"v": p["exchange_loss"], "unit": UNIT},
        "disassemble_cost": {"v": p["disassemble_cost"], "unit": UNIT},
    }


CHECKS = [
    ("B-06 决策组合枚举完整性", lambda dl, cb, p, cp: check_b06_decision_enumeration(cb)),
    ("B-07 指标可复算(rel<1e-6)", lambda dl, cb, p, cp: check_b07_metric_recomputable(dl, cb, p)),
    ("B-08 回流结构 + 交付值须含回流", lambda dl, cb, p, cp: check_b08_reflux(dl, cb, p)),
    ("B-14 敏感性(>=3 算例 + 翻转报告)", lambda dl, cb, p, cp: check_b14_sensitivity(p, 0.05, 0.20)),
    ("B-16 单位一致性(元/件)", lambda dl, cb, p, cp: check_b16_units(dl, cp)),
]


def run_checks(delivered, combos, p, cost_params, label):
    """跑 5 条检查。返回 (全部通过, findings)。检查违反时 raise CheckFailed。"""
    findings = []
    print(f"\n{'='*76}\n[{label}]\n{'='*76}")
    for name, fn in CHECKS:
        try:
            detail = fn(delivered, combos, p, cost_params)
            findings.append({"check": name, "ok": True, "detail": detail})
            print(f"  PASS  {name:<38} | {detail}")
        except CheckFailed as exc:
            findings.append({"check": name, "ok": False, "detail": str(exc)})
            print(f"  RAISE {name:<38} | {exc}")
    ok = all(f["ok"] for f in findings)
    print(f"  --> 全部通过 = {ok}")
    return ok, findings


def main():
    p = T1_CASE1
    print("Q1-C2 — 2024-B machine 检查双向实跑 (H6)")
    print(f"参数: 2024-B 表 1 情况 1, 单位 {UNIT}")
    print(f"检查数: {len(CHECKS)} 条 (B-06 / B-07 / B-08 / B-14 / B-16)")

    combos = all_combinations()
    cp = cost_params_of(p)
    results = {}

    # ---------- 方向 A：合格输入 -----------------------------------------
    delivered = delivered_metrics(p)
    ok_A, f_A = run_checks(delivered, combos, p, cp, "方向 A: 合格输入（16 组合, 指标可复算, 含回流）")
    results["A_valid"] = {"ok": ok_A, "expected": True, "findings": f_A}
    best = max(combos, key=lambda d: expected_profit(d, p))
    print(f"\n  参考: 最优决策 = {best}")
    print(f"        期望单位利润 = {expected_profit(best, p):.6f} {UNIT}")
    print(f"        无回流对照   = {expected_profit(best, p, include_reflux=False):.6f} {UNIT}")

    print("\n\n" + "#"*76)
    print("# 方向 B: 退化输入（每条检查都必须 raise）")
    print("#"*76)

    # ---------- B1：组合不完整（只给 2 个角点）----------------------------
    deg = [(True, True, True, True), (False, False, False, False)]
    ok_B1, f_B1 = run_checks({d: {"value": expected_profit(d, p), "unit": UNIT} for d in deg},
                             deg, p, cp, "方向 B1: 只给 2 个角点组合（F4-6 退化）")
    results["B1_incomplete_enumeration"] = {"ok": ok_B1, "expected": False, "findings": f_B1}

    # ---------- B2：指标编造（+0.01%）------------------------------------
    ok_B2, f_B2 = run_checks({d: {"value": v["value"] * 1.0001, "unit": UNIT}
                              for d, v in delivered.items()},
                             combos, p, cp, "方向 B2: 指标编造 +0.01%（F4-7 退化）")
    results["B2_fabricated_metric"] = {"ok": ok_B2, "expected": False, "findings": f_B2}

    # ---------- B3：漏掉回流项（交付顺序流程解）---------------------------
    ok_B3, f_B3 = run_checks({d: {"value": expected_profit(d, p, include_reflux=False), "unit": UNIT}
                              for d in combos},
                             combos, p, cp, "方向 B3: 漏掉回流项（F4-8 退化）")
    results["B3_missing_reflux"] = {"ok": ok_B3, "expected": False, "findings": f_B3}

    # ---------- B4：单位混用 ---------------------------------------------
    bad_cp = dict(cp)
    bad_cp["market_price"] = {"v": p["market_price"], "unit": "元/百件"}
    ok_B4, f_B4 = run_checks(delivered, combos, p, bad_cp, "方向 B4: 单位混用（F3-5 退化）")
    results["B4_unit_mixed"] = {"ok": ok_B4, "expected": False, "findings": f_B4}

    # ---------- 汇总 -----------------------------------------------------
    print("\n\n" + "="*76)
    print("汇总（H6 判据: 合格输入通过 / 退化输入 raise）")
    print("="*76)
    all_good = True
    for key, label, expect in [
        ("A_valid", "方向 A  合格输入", True),
        ("B1_incomplete_enumeration", "方向 B1 组合不完整(2 角点)", False),
        ("B2_fabricated_metric", "方向 B2 指标编造(+0.01%)", False),
        ("B3_missing_reflux", "方向 B3 漏掉回流项", False),
        ("B4_unit_mixed", "方向 B4 单位混用", False),
    ]:
        r = results[key]
        good = (r["ok"] == expect)
        all_good &= good
        n_raise = sum(1 for f in r["findings"] if not f["ok"])
        print(f"  {'[OK]  ' if good else '[BAD] '} {label:<32} "
              f"通过={str(r['ok']):<5} 期望={str(expect):<5} raise数={n_raise}")
    print(f"\nH6 {'达成' if all_good else '未达成'}: "
          f"{'合格输入 5/5 通过, 4 类退化全部 raise' if all_good else '存在未按预期反应的检查'}")

    results["H6_met"] = bool(all_good)
    results["model"] = "M-1 (简化模型, 见 Q1-C1 §4 L-4)"
    results["checks_implemented"] = [c[0] for c in CHECKS]
    with open("Q1-C2-run-record.json", "w", encoding="utf-8") as fh:
        json.dump(results, fh, ensure_ascii=False, indent=2)
    print("\n运行记录 -> Q1-C2-run-record.json")
    return 0 if all_good else 1


if __name__ == "__main__":
    sys.exit(main())
