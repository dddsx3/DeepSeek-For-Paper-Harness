"""问题 2：四元 0-1 决策 (Z1, Z2, C, D) 上的期望利润最大化（MS-Q2）。

本模块只做两件事：把模型真跑出来、把要用到的量写成 JSON 可序列化的字典。
不写结果说明、不做图表声明、不产生任何图像字节。

闭式（DECLARATION.json 的 MS-Q2 / EQ-Q2-*，逐字对齐）：
    Q_i   = 1 - (1 - Z_i) p_i                                   EQ-Q2-YIELD
    q     = (1 - p_0) Q_1 Q_2                                   EQ-Q2-YIELD
    K_f   = A + Σ_i [ Z_i (a_i + c_i) / (1 - p_i) + (1 - Z_i) a_i ]   EQ-KF
    K_r   = A + Σ_i Z_i c_i                                     EQ-KR
    κ     = K_f - K_r                                           EQ-KAPPA
    g     = q / (1 - D (1 - q))                                 EQ-Q2-RECUR
    R     = [ K_r + C c_0 + (1 - q)(D t + (1 - C) l) ] / (1 - D (1 - q))
    U     = [ K_f + C c_0 + (1 - q)(D t + (1 - C) l + D R) ] / g      EQ-COST-Q2
    Π     = s - U                                               EQ-PROFIT-Q2

口径纪律：
  * 题面给定值一律从 params（展开自 PROBLEM_FACTS.json）读取，本模块不转录任何常数；
  * 模型常数（容差 / 灵敏度扰动幅度 / 等高线格点数）按 DECLARATION.json 的
    model_constants 键名从 params 读取，读不到时用与该登记值一致的兜底；
  * 回收件"免采购"的收益只落在 K_r 与 κ 里，利润式中不再按退回件数抵扣采购价；
  * 调换损失项严格写成 (1-q)(1-C) l，检测成品时整项为零。
"""

import itertools

import params
from params import TABLE1  # 题面表 1 六种情况，展开自 PROBLEM_FACTS.json


# ---------------------------------------------------------------------------
# 模型常数读取（键名对应 DECLARATION.json 的 model_constants 段）
# ---------------------------------------------------------------------------
def _const(*names, default=None):
    """按候选键名从 params 取模型常数；取不到时回落到登记值。"""
    for nm in names:
        if hasattr(params, nm):
            return getattr(params, nm)
    return default


TOL = _const("TOL", "TOLERANCE", "NUM_TOL", default=1e-9)          # 数值容差
SENS_PCT = _const("SENS_PCT", "SENSITIVITY_PCT", "SENS_AMP",
                  default=20.0)                                    # 灵敏度扰动幅度（%）
GRID_N = _const("GRID_N", "CONTOUR_GRID_N", default=41)            # 等高线格点数/轴
N_SENS = _const("N_SENS", "SENS_POINTS", default=11)               # 灵敏度扫描点数

BREAKDOWN_KEYS = ("purchase", "inspection", "assembly", "disassembly", "exchange")


# ---------------------------------------------------------------------------
# 表 1 记录规范化
# ---------------------------------------------------------------------------
def unpack(case):
    """把表 1 的一条记录规范化成内部字段名（不做任何数值派生）。"""

    def pick(*keys):
        for k in keys:
            if isinstance(case, dict) and k in case and case[k] is not None:
                return float(case[k])
        raise KeyError("表 1 记录缺少字段：" + " / ".join(keys))

    return {
        "p1": pick("p1", "p_1", "part1_defect"),
        "p2": pick("p2", "p_2", "part2_defect"),
        "p0": pick("p0", "p_0", "product_defect"),
        "a1": pick("a1", "a_1", "part1_price"),
        "a2": pick("a2", "a_2", "part2_price"),
        "c1": pick("c1", "c_1", "part1_inspect"),
        "c2": pick("c2", "c_2", "part2_inspect"),
        "c0": pick("c0", "c_0", "product_inspect"),
        "A": pick("A", "assembly_cost", "assemble"),
        "s": pick("s", "price", "market_price"),
        "l": pick("l", "exchange_loss", "swap_loss"),
        "t": pick("t", "disassemble_cost", "teardown"),
    }


# ---------------------------------------------------------------------------
# 解析闭式
# ---------------------------------------------------------------------------
def evaluate(p, Z1, Z2, C, D):
    """给定参数与决策组合，返回闭式解的各中间量与 U / Π。

    q 或几何级数分母趋近 0 时返回 None（该组合不可交付），不返回 inf。
    """
    Q1 = 1.0 - (1 - Z1) * p["p1"]
    Q2 = 1.0 - (1 - Z2) * p["p2"]
    q = (1.0 - p["p0"]) * Q1 * Q2

    denom = 1.0 - D * (1.0 - q)
    if q <= TOL or denom <= TOL:
        return None

    # 采购倍数：检测并丢弃不合格零配件后，得 1 件可用件平均需买 1/(1-p_i) 件
    buy_new = (Z1 * p["a1"] / (1.0 - p["p1"]) + (1 - Z1) * p["a1"]
               + Z2 * p["a2"] / (1.0 - p["p2"]) + (1 - Z2) * p["a2"])
    insp_new = (Z1 * p["c1"] / (1.0 - p["p1"])
                + Z2 * p["c2"] / (1.0 - p["p2"]))
    insp_rec = Z1 * p["c1"] + Z2 * p["c2"]

    K_f = p["A"] + buy_new + insp_new          # EQ-KF
    K_r = p["A"] + insp_rec                    # EQ-KR（免采购只记于此）
    kappa = K_f - K_r                          # EQ-KAPPA

    disp = D * p["t"] + (1 - C) * p["l"]       # 每件次品的处置触发支出
    g = q / denom                              # EQ-Q2-RECUR
    R = (K_r + C * p["c0"] + (1.0 - q) * disp) / denom
    U = (K_f + C * p["c0"] + (1.0 - q) * (disp + D * R)) / g   # EQ-COST-Q2
    profit = p["s"] - U                        # EQ-PROFIT-Q2

    return {
        "Q1": Q1, "Q2": Q2, "q": q,
        "K_f": K_f, "K_r": K_r, "kappa": kappa,
        "g": g, "R": R, "U": U, "profit": profit,
    }


# ---------------------------------------------------------------------------
# 逐轮现金流复算（核验 V-05 / V-06 用）
# ---------------------------------------------------------------------------
def simulate(p, Z1, Z2, C, D, max_iter=20000):
    """逐轮展开：按轮投入、按轮产出、按 D 决定拆解或报废，取极限。

    返回 (U_sim, breakdown)：
      * U_sim     —— 每件合格成品的期望总成本（逐轮累计 / 累计交付量）
      * breakdown —— 采购 / 检测 / 装配 / 拆解 / 调换损失 五项，已按每件交付折算
    两路（解析闭式 vs 逐轮复算）的残差用于抓"采购倍数漏记"与"免采购重复计"。
    """
    Q1 = 1.0 - (1 - Z1) * p["p1"]
    Q2 = 1.0 - (1 - Z2) * p["p2"]
    q = (1.0 - p["p0"]) * Q1 * Q2
    if q <= TOL:
        return None, None

    buy_new = (Z1 * p["a1"] / (1.0 - p["p1"]) + (1 - Z1) * p["a1"]
               + Z2 * p["a2"] / (1.0 - p["p2"]) + (1 - Z2) * p["a2"])
    insp_new = (Z1 * p["c1"] / (1.0 - p["p1"])
                + Z2 * p["c2"] / (1.0 - p["p2"]))
    insp_rec = Z1 * p["c1"] + Z2 * p["c2"]

    acc = {k: 0.0 for k in BREAKDOWN_KEYS}
    mass = 1.0        # 本轮投入的"单位"量（首轮为新料，其后为回收料）
    delivered = 0.0   # 累计交付的合格成品量
    first = True
    it = 0

    while mass > TOL and it < max_iter:
        defective = mass * (1.0 - q)

        acc["assembly"] += mass * p["A"]
        if first:
            acc["purchase"] += mass * buy_new
            acc["inspection"] += mass * insp_new
        else:
            acc["inspection"] += mass * insp_rec
        acc["inspection"] += mass * C * p["c0"]

        if C == 0:
            acc["exchange"] += defective * p["l"]      # 未检成品：次品流向市场须调换
        if D == 1:
            acc["disassembly"] += defective * p["t"]   # 拆解费

        delivered += mass * q
        mass = defective if D == 1 else 0.0
        first = False
        it += 1

    if delivered <= TOL:
        return None, None

    breakdown = {k: v / delivered for k, v in acc.items()}
    return sum(breakdown.values()), breakdown


# ---------------------------------------------------------------------------
# 最优决策求解
# ---------------------------------------------------------------------------
def _opt(p):
    """在 16 种 (Z1,Z2,C,D) 组合上全枚举，返回期望利润最大的组合。"""
    best = None
    for Z1, Z2, C, D in itertools.product((0, 1), repeat=4):
        ev = evaluate(p, Z1, Z2, C, D)
        if ev is None:
            continue
        if best is None or ev["profit"] > best["profit"]:
            best = {"Z1": Z1, "Z2": Z2, "C": C, "D": D,
                    "U": ev["U"], "profit": ev["profit"]}
    return best


def _rescale(p, mapping):
    """按 mapping 指定的倍率缩放参数（不改原字典）。"""
    out = dict(p)
    for key, factor in mapping.items():
        out[key] = out[key] * factor
    return out


def _rescale_defect(p, mapping):
    """缩放次品率，并封顶在 (0,1) 开区间内。"""
    out = dict(p)
    for key, factor in mapping.items():
        out[key] = min(out[key] * factor, 1.0 - TOL)
    return out


def _factors(n):
    lo = 1.0 - SENS_PCT / 100.0
    hi = 1.0 + SENS_PCT / 100.0
    if n <= 1:
        return [1.0]
    return [lo + (hi - lo) * i / (n - 1) for i in range(n)]


# ---------------------------------------------------------------------------
# 灵敏度扫描（供 fig_q2_sensitivity_defect_rate / fig_q2_sensitivity_unit_cost）
# ---------------------------------------------------------------------------
def sensitivity_defect(p, n=N_SENS):
    """零配件次品率与成品次品率分别扰动下的期望利润曲线。"""
    fs = _factors(n)
    part_profit, prod_profit = [], []
    part_dec, prod_dec = [], []
    for f in fs:
        a = _opt(_rescale_defect(p, {"p1": f, "p2": f}))
        b = _opt(_rescale_defect(p, {"p0": f}))
        part_profit.append(a["profit"])
        prod_profit.append(b["profit"])
        part_dec.append([a["Z1"], a["Z2"], a["C"], a["D"]])
        prod_dec.append([b["Z1"], b["Z2"], b["C"], b["D"]])
    return {
        "factors": fs,
        "part_defect_profit": part_profit,
        "product_defect_profit": prod_profit,
        "part_defect_decision": part_dec,
        "product_defect_decision": prod_dec,
    }


def sensitivity_cost(p, n=N_SENS):
    """购买单价、检测成本、调换损失分别扰动下的期望利润曲线。"""
    fs = _factors(n)
    price, inspect, exchange = [], [], []
    price_dec, inspect_dec, exchange_dec = [], [], []
    for f in fs:
        a = _opt(_rescale(p, {"a1": f, "a2": f}))
        b = _opt(_rescale(p, {"c1": f, "c2": f, "c0": f}))
        c = _opt(_rescale(p, {"l": f}))
        price.append(a["profit"])
        inspect.append(b["profit"])
        exchange.append(c["profit"])
        price_dec.append([a["Z1"], a["Z2"], a["C"], a["D"]])
        inspect_dec.append([b["Z1"], b["Z2"], b["C"], b["D"]])
        exchange_dec.append([c["Z1"], c["Z2"], c["C"], c["D"]])
    return {
        "factors": fs,
        "price_profit": price,
        "inspection_profit": inspect,
        "exchange_profit": exchange,
        "price_decision": price_dec,
        "inspection_decision": inspect_dec,
        "exchange_decision": exchange_dec,
    }


# ---------------------------------------------------------------------------
# 盈亏平衡等高线（供 fig_q2_breakeven_contour）
# ---------------------------------------------------------------------------
def breakeven(p, n=GRID_N):
    """二维参数网格上的最优利润与最优决策，并抽出决策翻转点坐标。

    横轴：检测成本 (c1, c2, c0) 的同步倍率；纵轴：调换损失 l 的倍率。
    """
    fs = _factors(n)
    profit_grid, decision_grid = [], []
    for fy in fs:
        prow, drow = [], []
        for fx in fs:
            pp = _rescale(p, {"c1": fx, "c2": fx, "c0": fx})
            pp = _rescale(pp, {"l": fy})
            b = _opt(pp)
            prow.append(b["profit"])
            drow.append("%d%d%d%d" % (b["Z1"], b["Z2"], b["C"], b["D"]))
        profit_grid.append(prow)
        decision_grid.append(drow)

    flips, seen = [], set()
    for j in range(n):
        for i in range(n):
            cur = decision_grid[j][i]
            for dj, di in ((0, 1), (1, 0)):
                nj, ni = j + dj, i + di
                if nj >= n or ni >= n:
                    continue
                nxt = decision_grid[nj][ni]
                if nxt == cur:
                    continue
                key = (cur, nxt, i, j)
                if key in seen:
                    continue
                seen.add(key)
                flips.append({"x": fs[i], "y": fs[j],
                              "decision_a": cur, "decision_b": nxt})

    return {
        "x_factors": fs,
        "y_factors": fs,
        "profit_grid": profit_grid,
        "decision_grid": decision_grid,
        "flip_points": flips,
    }


# ---------------------------------------------------------------------------
# 编排入口
# ---------------------------------------------------------------------------
def run():
    """跑完问题 2 的全部内容，返回可 JSON 序列化的账本片段。"""
    cases_out = []
    residuals = []
    overall = None
    sensitivity_base = None

    for idx, raw in enumerate(TABLE1, start=1):
        p = unpack(raw)
        if sensitivity_base is None:
            sensitivity_base = p

        rows = []
        best_row = None
        best_eval = None
        best_break = None

        for Z1, Z2, C, D in itertools.product((0, 1), repeat=4):
            ev = evaluate(p, Z1, Z2, C, D)
            if ev is None:
                continue
            U_sim, break_sim = simulate(p, Z1, Z2, C, D)
            if U_sim is not None:
                residuals.append(abs(U_sim - ev["U"]))

            row = {
                "Z1": Z1, "Z2": Z2, "C": C, "D": D,
                "U": ev["U"], "profit": ev["profit"],
            }
            rows.append(row)

            if best_row is None or row["profit"] > best_row["profit"]:
                best_row = row
                best_eval = ev
                best_break = break_sim

        cases_out.append({
            "case_id": idx,
            "best": {
                "Z1": best_row["Z1"], "Z2": best_row["Z2"],
                "C": best_row["C"], "D": best_row["D"],
                "U": best_row["U"], "profit": best_row["profit"],
            },
            "best_diagnostics": {
                "Q1": best_eval["Q1"], "Q2": best_eval["Q2"], "q": best_eval["q"],
                "K_f": best_eval["K_f"], "K_r": best_eval["K_r"],
                "kappa": best_eval["kappa"], "g": best_eval["g"],
                "R": best_eval["R"],
            },
            "cost_breakdown": best_break,
            "strategies": rows,          # 16 种组合的完整矩阵（热力图数据源）
        })

        if overall is None or best_row["profit"] > overall["profit"]:
            overall = {
                "case_id": idx,
                "Z1": best_row["Z1"], "Z2": best_row["Z2"],
                "C": best_row["C"], "D": best_row["D"],
                "U": best_row["U"], "profit": best_row["profit"],
            }

    # 解析闭式 vs 逐轮复算的最大残差（96 个策略组合）
    max_residual = max(residuals) if residuals else None

    def _case_profit(c):
        return c["best"]["profit"]

    return {
        "cases": cases_out,
        "best_overall": overall,
        "n_strategies_per_case": len(cases_out[0]["strategies"]) if cases_out else 0,
        "n_strategies_evaluated": sum(len(c["strategies"]) for c in cases_out),
        "case_profits": [c["best"]["profit"] for c in cases_out],
        "max_residual": max_residual,
        "sensitivity_defect": sensitivity_defect(sensitivity_base),
        "sensitivity_cost": sensitivity_cost(sensitivity_base),
        "breakeven": breakeven(sensitivity_base),
    }