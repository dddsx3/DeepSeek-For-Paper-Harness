# -*- coding: utf-8 -*-
"""问题 1：检测次数尽可能少的抽样检测方案。

方法：单侧二项检验的两点设计（p_nom 与 p_alt = p_nom + Δ）+ 整数样本量最小化搜索。

两种情形的判定方向完全不同，分别实现：
  情形(1) “在 95% 信度下认定次品率超过标称值则拒收”
         —— 控制拒收侧第一类错误：P(X >= c+1 | p_nom) <= α1，且在 p_alt 处功效 >= 1-β。
  情形(2) “在 90% 信度下认定次品率不超过标称值则接收”
         —— 控制接收侧置信水平：只有当 p 的单侧 90% 上置信界 <= p_nom 时才接收，
            等价于 P(X <= c | p_nom) <= α2（= 1 - 信度），且在 p_alt 处误收概率 <= β。

反向约束 P(X <= c | p_nom) >= 1-α2 是“供应方风险口径”，与题面语义相反，
仅作为具名对照保留，不进入主答案。
"""

from constants import MODEL_CONSTANTS, Q1_P_NOMINAL, IMPLEMENTATION_PARAMS
from numeric import binom_cdf_table


def _search_two_point(p_nom, p_alt, n_max, alpha, beta, mode, tol=1e-12):
    """返回 (n, c, 第一尾概率, 第二尾概率) 或 None。"""
    for n in range(1, n_max + 1):
        cdf_nom = binom_cdf_table(n, p_nom)
        cdf_alt = binom_cdf_table(n, p_alt)
        if mode == "reject":
            # 拒收判据 X >= c+1：控 P(拒收|p_nom) <= alpha，且 P(拒收|p_alt) >= 1-beta
            for c in range(0, n):
                pn = 1.0 - cdf_nom[c]
                pa = 1.0 - cdf_alt[c]
                if pn <= alpha + tol and pa >= 1.0 - beta - tol:
                    return n, c, pn, pa
        elif mode == "accept_ci":
            # 接收判据 X <= c：控 P(接收|p_nom) <= alpha（单侧上置信界口径）
            # 且 P(接收|p_alt) <= beta
            for c in range(0, n + 1):
                pn = cdf_nom[c]
                pa = cdf_alt[c]
                if pn <= alpha + tol and pa <= beta + tol:
                    return n, c, pn, pa
    return None


def _search_accept_supplier_risk(p_nom, alpha, n_max, tol=1e-12):
    """对照口径：只控 P(X <= c | p_nom) >= 1-alpha（供应方风险），不施加功效约束。"""
    for n in range(1, n_max + 1):
        cdf = binom_cdf_table(n, p_nom)
        for c in range(0, n + 1):
            if cdf[c] >= 1.0 - alpha - tol:
                return n, c, cdf[c]
    return None


def one_sided_upper_bound(n, c, conf):
    """p 的单侧 conf 上置信界：解 P(X <= c | p) = 1 - conf。"""
    target = 1.0 - conf
    lo, hi = 0.0, 1.0
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        cdf = binom_cdf_table(n, mid)
        if cdf[c] > target:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


def solve():
    mc = MODEL_CONSTANTS
    p_nom = Q1_P_NOMINAL
    delta = mc["Q1可识别超标幅度Δ"]
    p_alt = p_nom + delta
    alpha1 = mc["Q1情形1显著性水平α1"]
    alpha2 = mc["Q1情形2显著性水平α2"]
    beta = mc["Q1功效约束β"]
    n_max = int(mc["Q1样本量搜索上界"])
    grid = int(mc["盈亏平衡等高线格点数"])
    norm_thr = mc["正态近似适用下界"]
    unit_cost = IMPLEMENTATION_PARAMS["q1_unit_inspection_cost"]
    tol = mc["数值容差"]

    conf1 = 1.0 - alpha1
    conf2 = 1.0 - alpha2

    r1 = _search_two_point(p_nom, p_alt, n_max, alpha1, beta, "reject")
    r2 = _search_two_point(p_nom, p_alt, n_max, alpha2, beta, "accept_ci")
    r2b = _search_accept_supplier_risk(p_nom, alpha2, n_max)

    n1, c1, rej_at_nom, power_at_alt = r1
    n2, c2, acc_nom, acc_alt = r2
    n2b, c2b, acc_nom_b = r2b

    ub1 = one_sided_upper_bound(n1, c1, conf1)
    ub2 = one_sided_upper_bound(n2, c2, conf2)
    ub2b = one_sided_upper_bound(n2b, c2b, conf2)

    # OC 曲线（情形 1 的接收概率 L(p) = P(X <= c1 | p)）
    oc = []
    for i in range(grid):
        p = 0.40 * i / float(grid - 1)
        cdf = binom_cdf_table(n1, p)
        oc.append({"p": p, "L": cdf[c1]})

    # 正态近似适用性标记（仅作诊断，不进入判定）
    norm_flag = {
        "threshold": norm_thr,
        "case1_n_times_p_nom": n1 * p_nom,
        "case1_n_times_one_minus_p_nom": n1 * (1.0 - p_nom),
        "case1_normal_approx_ok": bool(n1 * p_nom >= norm_thr and n1 * (1.0 - p_nom) >= norm_thr),
    }

    # 样本量—信度关系（含登记的对照置信水平）
    ssc = []
    for conf in sorted({conf1, conf2, mc["灵敏度扫描置信水平对照值"]}):
        a = 1.0 - conf
        rr1 = _search_two_point(p_nom, p_alt, n_max, a, beta, "reject")
        rr2 = _search_two_point(p_nom, p_alt, n_max, a, beta, "accept_ci")
        ssc.append({
            "confidence": conf,
            "n_case1_reject": rr1[0] if rr1 else None,
            "c_case1_reject": rr1[1] if rr1 else None,
            "n_case2_accept": rr2[0] if rr2 else None,
            "c_case2_accept": rr2[1] if rr2 else None,
        })

    return {
        "method": "单侧二项检验两点设计 + 整数样本量最小化搜索",
        "p_nom": p_nom,
        "p_alt": p_alt,
        "delta": delta,
        "n_max": n_max,
        "case1_reject": {
            "reading": "在 1-alpha1 信度下认定 p > p_nom 才拒收；控制 P(X>=c+1|p_nom)<=alpha1，且 p_alt 处功效>=1-beta",
            "n_star": n1,
            "c_star": c1,
            "reject_prob_at_p_nom": rej_at_nom,
            "reject_prob_at_p_alt": power_at_alt,
            "alpha": alpha1,
            "power_floor": 1.0 - beta,
            "one_sided_upper_conf_bound_at_c_star": ub1,
            "constraint_ok": bool(rej_at_nom <= alpha1 + tol and power_at_alt >= 1.0 - beta - tol),
        },
        "case2_accept": {
            "reading": "在 1-alpha2 信度下认定 p <= p_nom 才接收；单侧上置信界<=p_nom 等价于 P(X<=c|p_nom)<=alpha2，且 p_alt 处误收<=beta",
            "n_star": n2,
            "c_star": c2,
            "accept_prob_at_p_nom": acc_nom,
            "accept_prob_at_p_alt": acc_alt,
            "alpha": alpha2,
            "one_sided_upper_conf_bound_at_c_star": ub2,
            "constraint_ok": bool(acc_nom <= alpha2 + tol and acc_alt <= beta + tol),
        },
        "case2_accept_supplier_risk_reading": {
            "reading": "具名对照（供应方风险口径）：仅控 P(X<=c|p_nom)>=1-alpha2，不施加功效约束；该口径退化为极小样本，与题面“以信度认定不超过标称值”的语义相反，不作为主答案",
            "n_star": n2b,
            "c_star": c2b,
            "accept_prob_at_p_nom": acc_nom_b,
            "one_sided_upper_conf_bound_at_c_star": ub2b,
            "bound_exceeds_nominal": bool(ub2b > p_nom),
        },
        "sampling_cost": {
            "bearer": "企业",
            "unit_cost_basis": unit_cost,
            "case1_cost": n1 * unit_cost,
            "case2_cost": n2 * unit_cost,
            "note": "题面未给单件检测费金额，按每件单价归一化；因费用线性可缩放，比较结论与单价无关",
        },
        "oc_curve": {"n": n1, "c": c1, "points": oc},
        "sample_size_vs_confidence": ssc,
        "normal_approx": norm_flag,
    }
