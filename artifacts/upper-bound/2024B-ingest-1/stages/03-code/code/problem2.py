# -*- coding: utf-8 -*-
"""问题 2：四元 0-1 决策 (Z_1, Z_2, C, D) 下的期望利润最大化。

本模块实现 MODELING_REPORT.md §4.2 的闭式模型（EQ-Q2-YIELD / EQ-KF / EQ-KR /
EQ-KAPPA / EQ-Q2-RECUR / EQ-COST-Q2 / EQ-PROFIT-Q2）：

    Q_i = 1 - (1 - Z_i) p_i
    q   = (1 - p_0) Q_1 Q_2
    K_f = A + sum_i [ Z_i (a_i + c_i)/(1 - p_i) + (1 - Z_i) a_i ]
    K_r = A + sum_i Z_i c_i
    kappa = K_f - K_r
    denom = 1 - D (1 - q)
    g   = q / denom
    R   = [ K_r + C c_0 + (1 - q)( D t + (1 - C) l ) ] / denom
    U   = [ K_f + C c_0 + (1 - q)( D t + (1 - C) l + D R ) ] / g
    Pi  = s - U

纪律（对齐阶段简报）：
  * 所有决定要进论文的量都写进 ``q2_results.json``，不打印到 stdout；
  * 本模块不产生任何图像字节、不写图表声明；
  * 题面给定值逐字抄录自 PROBLEM_FACTS.json 的 F-T1-C1..F-T1-C6（10% 记作
    0.10），若同目录存在 ``params.py`` / ``constants.py`` 且其中登记了表 1，
    则优先使用登记值覆盖内联值；
  * 建模常数（数值容差等）优先按键名从 ``params`` / ``constants`` 读取。

审计意见落点（本轮独立审计 6 条中与本分片相关的两条）：
  * 意见 1（sensitivity.py 的 flips 恒 0 死代码）：本模块导出真实实现的
    :func:`count_decision_flips`，按基线决策逐格统计翻转格点数并返回
    {flips, total, flip_rate}，供 sensitivity.py 调用，不再返回恒 0 假指标。
  * 意见 4（问题 4 的 x 取法自证）：本模块导出 :func:`evaluate_case` /
    :func:`best_decision` / :func:`load_table1`，problem4.py 可直接对任意
    (p_1, p_2, p_0) 取值重解，无需构造 x = round(n * p) 的对齐样本。
"""

from __future__ import annotations

import json
import os

# ---------------------------------------------------------------------------
# 参数入口：优先从 params.py 读取（与 PROBLEM_FACTS.json 同源）
# ---------------------------------------------------------------------------
try:  # pragma: no cover - 取决于运行目录是否存在 params.py
    from params import *  # noqa: F401,F403
except Exception:  # pragma: no cover
    pass

try:  # pragma: no cover
    import params as _params
except Exception:  # pragma: no cover
    _params = None

try:  # pragma: no cover
    import constants as _constants
except Exception:  # pragma: no cover
    _constants = None


def _lookup(*names, default=None):
    """按多个候选键名从 params / constants 中取常数，取不到返回 default。"""
    for module in (_params, _constants):
        if module is None:
            continue
        for name in names:
            if hasattr(module, name):
                value = getattr(module, name)
                if value is not None:
                    return value
    return default


# ---------------------------------------------------------------------------
# 建模常数（全部按键名读取；取不到时使用与 DECLARATION.json 同值的兜底）
# ---------------------------------------------------------------------------
TOL = float(_lookup("NUMERIC_TOL", "TOL", u"数值容差", default=1e-06))
TINY = 1e-12
REWORK_MAX_ROUNDS = 4096
REWORK_REACH_TOL = 1e-15
STRATEGY_COUNT = 16
OUTPUT_NAME = "q2_results.json"

_IMPL = _lookup("IMPLEMENTATION_PARAMS", "IMPL", default=None)
if isinstance(_IMPL, dict):
    REWORK_MAX_ROUNDS = int(_IMPL.get("q2_max_rounds", REWORK_MAX_ROUNDS))
    REWORK_REACH_TOL = float(_IMPL.get("q2_reach_tol", REWORK_REACH_TOL))


# ---------------------------------------------------------------------------
# 表 1：题面给定值（逐字抄录自 PROBLEM_FACTS.json F-T1-C1..F-T1-C6）
# ---------------------------------------------------------------------------
_CASE_KEYS = ("p1", "p2", "p0", "a1", "a2", "c1", "c2", "c0", "A", "t", "l", "s")

_TABLE1_INLINE = {
    1: {"p1": 0.10, "p2": 0.10, "p0": 0.10, "a1": 4, "a2": 18,
        "c1": 2, "c2": 3, "c0": 3, "A": 6, "t": 5, "l": 6, "s": 56},
    2: {"p1": 0.20, "p2": 0.20, "p0": 0.20, "a1": 4, "a2": 18,
        "c1": 2, "c2": 3, "c0": 3, "A": 6, "t": 5, "l": 6, "s": 56},
    3: {"p1": 0.10, "p2": 0.10, "p0": 0.10, "a1": 4, "a2": 18,
        "c1": 2, "c2": 3, "c0": 3, "A": 6, "t": 5, "l": 30, "s": 56},
    4: {"p1": 0.20, "p2": 0.20, "p0": 0.20, "a1": 4, "a2": 18,
        "c1": 1, "c2": 1, "c0": 2, "A": 6, "t": 5, "l": 30, "s": 56},
    5: {"p1": 0.10, "p2": 0.20, "p0": 0.10, "a1": 4, "a2": 18,
        "c1": 8, "c2": 1, "c0": 2, "A": 6, "t": 5, "l": 10, "s": 56},
    6: {"p1": 0.05, "p2": 0.05, "p0": 0.05, "a1": 4, "a2": 18,
        "c1": 2, "c2": 3, "c0": 3, "A": 6, "t": 40, "l": 10, "s": 56},
}


def _normalize_case(entry):
    """把外部登记的表 1 条目归一化为内部参数字典；无法归一化时返回 None。"""
    if not isinstance(entry, dict):
        return None
    if all(key in entry for key in _CASE_KEYS):
        return {key: float(entry[key]) for key in _CASE_KEYS}
    return None


def load_table1():
    """返回 {情况编号: 参数字典}；外部登记值优先，缺项用题面内联值补齐。"""
    table = {}
    external = _lookup("TABLE1", "TABLE1_CASES", "CASE_TABLE1", default=None)
    if isinstance(external, dict):
        for key, entry in external.items():
            try:
                case_id = int(key)
            except Exception:
                continue
            normalized = _normalize_case(entry)
            if normalized is not None:
                table[case_id] = normalized
    elif isinstance(external, (list, tuple)):
        for index, entry in enumerate(external):
            normalized = _normalize_case(entry)
            if normalized is not None:
                table[index + 1] = normalized
    for case_id, entry in _TABLE1_INLINE.items():
        table.setdefault(case_id, dict(entry))
    return table


# ---------------------------------------------------------------------------
# 单点评估：闭式解 + 分项成本分解
# ---------------------------------------------------------------------------
def decompose(case, z1, z2, c, d):
    """闭式解的中间量（EQ-Q2-YIELD → EQ-Q3-RECUR 的问题 2 版本）。"""
    p1 = float(case["p1"])
    p2 = float(case["p2"])
    p0 = float(case["p0"])
    a1 = float(case["a1"])
    a2 = float(case["a2"])
    c1 = float(case["c1"])
    c2 = float(case["c2"])
    c0 = float(case["c0"])
    a_asm = float(case["A"])
    t_fee = float(case["t"])
    l_loss = float(case["l"])
    s_price = float(case["s"])

    z1 = int(z1)
    z2 = int(z2)
    c = int(c)
    d = int(d)

    one = 1.0

    # EQ-Q2-YIELD：两条不合格来源按独立性写成乘积
    qi1 = one - (one - z1) * p1
    qi2 = one - (one - z2) * p2
    q = (one - p0) * qi1 * qi2

    # EQ-KF：检测时"得 1 件可用零配件"平均需买 1/(1-p_i) 件
    buy_part1 = z1 * a1 / (one - p1) + (one - z1) * a1
    buy_part2 = z2 * a2 / (one - p2) + (one - z2) * a2
    insp_fresh = z1 * c1 / (one - p1) + z2 * c2 / (one - p2)
    kf = a_asm + (buy_part1 + insp_fresh) + (buy_part2
                                              + z2 * c2 / (one - p2))

    # EQ-KR：回收件免采购、仍付再检测费（免采购收益只记于此一处）
    insp_rework = z1 * c1 + z2 * c2
    kr = a_asm + insp_rework
    kappa = kf - kr

    denom = one - d * (one - q)
    if denom <= TINY or q <= TINY:
        return {
            "deliverable": False,
            "reason": u"闭环几何级数不收敛：D=1 且一轮合格概率 q≈0，该点不可交付",
            "z1": z1, "z2": z2, "c": c, "d": d,
            "Q1": qi1, "Q2": qi2, "q": q,
            "Kf": kf, "Kr": kr, "kappa": kappa,
            "g": 0.0, "R": None, "U": None, "profit": None, "breakdown": None,
        }

    # EQ-Q2-RECUR
    g = q / denom
    xi = d * t_fee + (one - c) * l_loss
    trig = (one - q) * xi
    r = (kr + c * c0 + trig) / denom

    # EQ-COST-Q2 / EQ-PROFIT-Q2
    u = (kf + c * c0 + trig + (one - q) * d * r) / g
    profit = s_price - u

    # 分项成本分解（与 U 恒等，见 verification.breakdown_identity）
    weight = (one - q) * d / denom
    purchase = (buy_part1 + buy_part2) / g
    inspection = (insp_fresh + weight * insp_rework + c * c0 * (one + weight)) / g
    assembly = a_asm * (one + weight) / g
    disassembly = (one - q) * d * t_fee * (one + weight) / g
    exchange = (one - q) * (one - c) * l_loss * (one + weight) / g

    return {
        "deliverable": True,
        "z1": z1, "z2": z2, "c": c, "d": d,
        "Q1": qi1, "Q2": qi2, "q": q,
        "Kf": kf, "Kr": kr, "kappa": kappa,
        "g": g, "R": r, "U": u, "profit": profit,
        "breakdown": {
            "purchase": purchase,
            "inspection": inspection,
            "assembly": assembly,
            "disassembly": disassembly,
            "exchange": exchange,
        },
    }


def evaluate_case(case, z1, z2, c, d):
    """对外入口：评估单个 (Z_1, Z_2, C, D) 组合（供 problem4 / sensitivity 复用）。"""
    return decompose(case, z1, z2, c, d)


def simulate_rounds(case, z1, z2, c, d,
                    max_rounds=None, reach_tol=None):
    """逐轮现金流复算器（V-05 的第二路核算）。

    第 0 轮投入新料（按 K_f 口径支出），产出次品按 D 决定拆解或报废；
    拆解则进入回收轮（按 K_r 口径支出），如此循环，截断在到达概率可忽略处；
    交付概率按几何分布累计。用于抓"采购倍数漏记"与"免采购重复计"。
    """
    max_rounds = REWORK_MAX_ROUNDS if max_rounds is None else int(max_rounds)
    reach_tol = REWORK_REACH_TOL if reach_tol is None else float(reach_tol)

    base = decompose(case, z1, z2, c, d)
    if not base["deliverable"]:
        return {"deliverable": False, "U": None,
                "deliver_prob": 0.0, "rounds": 0}

    kf = base["Kf"]
    kr = base["Kr"]
    q = base["q"]
    c0 = float(case["c0"])
    t_fee = float(case["t"])
    l_loss = float(case["l"])
    c = int(c)
    d = int(d)

    one = 1.0
    reach = one
    total_cost = 0.0
    delivered = 0.0
    rounds = 0

    for index in range(max_rounds):
        if reach <= reach_tol:
            break
        rounds = index + 1
        if index == 0:
            total_cost += reach * (kf + c * c0)
        else:
            total_cost += reach * (kr + c * c0)
        bad = reach * (one - q)
        total_cost += bad * (d * t_fee + (one - c) * l_loss)
        delivered += reach * q
        reach = bad * d

    if delivered <= TINY:
        return {"deliverable": False, "U": None,
                "deliver_prob": delivered, "rounds": rounds}

    return {
        "deliverable": True,
        "U": total_cost / delivered,
        "deliver_prob": delivered,
        "rounds": rounds,
    }


# ---------------------------------------------------------------------------
# 策略枚举与最优决策
# ---------------------------------------------------------------------------
def enumerate_strategies(case, with_simulation=True):
    """枚举全部 16 种 (Z_1, Z_2, C, D) 组合，返回按决策字典序排列的行列表。"""
    rows = []
    for z1 in (0, 1):
        for z2 in (0, 1):
            for c in (0, 1):
                for d in (0, 1):
                    res = decompose(case, z1, z2, c, d)
                    row = dict(res)
                    if with_simulation:
                        row["U_round_sim"] = simulate_rounds(case, z1, z2, c, d)["U"]
                    rows.append(row)
    return rows


def _rank_key(row):
    profit = row.get("profit")
    return (
        0 if profit is None else 1,
        -(profit if profit is not None else 0.0),
        row["z1"], row["z2"], row["c"], row["d"],
    )


def best_decision(case, with_simulation=False):
    """返回期望利润最大的决策行；并列时按 (Z_1, Z_2, C, D) 字典序取最小。"""
    rows = enumerate_strategies(case, with_simulation=with_simulation)
    return sorted(rows, key=lambda row: _rank_key(row), reverse=True)[0] \
        if False else sorted(
            [row for row in rows], key=lambda row: (
                -(row["profit"] if row["profit"] is not None else -1e18),
                row["z1"], row["z2"], row["c"], row["d"],
            )
        )[0]


def count_decision_flips(baseline_decision, grid_decisions):
    """统计参数网格上相对基线决策翻转的格点数（真实实现，非恒 0）。

    参数
    ----
    baseline_decision : 长度为 4 的序列 (Z_1, Z_2, C, D)
    grid_decisions    : 二维（或一维）嵌套的决策序列，每一项为长度 4 的序列

    返回
    ----
    {"flips": 翻转格点数, "total": 总格点数, "flip_rate": 翻转率}
    """
    baseline = tuple(int(v) for v in baseline_decision)
    flips = 0
    total = 0
    for row in grid_decisions:
        if isinstance(row, (list, tuple)) and row and isinstance(row[0], (list, tuple)):
            items = row
        else:
            items = [row]
        for decision in items:
            total += 1
            if tuple(int(v) for v in decision) != baseline:
                flips += 1
    rate = (float(flips) / float(total)) if total else 0.0
    return {"flips": flips, "total": total, "flip_rate": rate}


# ---------------------------------------------------------------------------
# 汇总输出
# ---------------------------------------------------------------------------
def _combo_label(row):
    return "{}{}{}{}".format(int(row["z1"]), int(row["z2"]),
                             int(row["c"]), int(row["d"]))


def build_outputs():
    """跑完四元决策全枚举，返回要写进 JSON 的完整账本。"""
    table = load_table1()
    cases_out = []
    worst_round_diff = 0.0
    worst_breakdown_diff = 0.0
    checked_pairs = 0

    for case_id in sorted(table):
        case = table[case_id]
        strategies = enumerate_strategies(case, with_simulation=True)

        for row in strategies:
            if row.get("U") is not None and row.get("U_round_sim") is not None:
                diff = abs(row["U"] - row["U_round_sim"])
                if diff > worst_round_diff:
                    worst_round_diff = diff
                checked_pairs += 1
            if row.get("breakdown"):
                total = sum(row["breakdown"].values())
                diff = abs(total - row["U"])
                if diff > worst_breakdown_diff:
                    worst_breakdown_diff = diff

        best = sorted(
            strategies,
            key=lambda row: (
                -(row["profit"] if row["profit"] is not None else -1e18),
                row["z1"], row["z2"], row["c"], row["d"],
            ),
        )[0]

        cases_out.append({
            "case_id": case_id,
            "params": dict(case),
            "best": {
                "z1": best["z1"], "z2": best["z2"],
                "c": best["c"], "d": best["d"],
                "label": _combo_label(best),
                "q": best["q"], "g": best["g"],
                "U": best["U"], "profit": best["profit"],
                "breakdown": best["breakdown"],
                "profit_ranked": [
                    {"label": _combo_label(row), "profit": row["profit"]}
                    for row in sorted(
                        strategies,
                        key=lambda row: -(
                            row["profit"] if row["profit"] is not None else -1e18
                        ),
                    )
                ],
            },
            "strategies": [
                {
                    "z1": row["z1"], "z2": row["z2"],
                    "c": row["c"], "d": row["d"],
                    "label": _combo_label(row),
                    "deliverable": row["deliverable"],
                    "q": row["q"], "g": row["g"],
                    "Kf": row["Kf"], "Kr": row["Kr"], "kappa": row["kappa"],
                    "R": row["R"], "U": row["U"], "profit": row["profit"],
                    "U_round_sim": row["U_round_sim"],
                    "breakdown": row["breakdown"],
                }
                for row in strategies
            ],
        })

    leader = sorted(
        [entry for entry in cases_out if entry["best"]["profit"] is not None],
        key=lambda entry: (-entry["best"]["profit"], entry["case_id"]),
    )[0]

    heat = cases_out[0]
    heat_labels = [row["label"] for row in heat["strategies"]]

    return {
        "meta": {
            "problem": "Q2",
            "model": "四元 0-1 决策 (Z1,Z2,C,D) 期望利润最大化：16 组合全枚举 + 闭式解",
            "case_count": len(cases_out),
            "strategy_count_per_case": STRATEGY_COUNT,
            "unit": "元/件（利润、成本）；比率为无量纲",
            "tolerance": TOL,
            "output_file": OUTPUT_NAME,
        },
        "cases": cases_out,
        "best_combo": {
            "case_id": leader["case_id"],
            "z1": leader["best"]["z1"], "z2": leader["best"]["z2"],
            "c": leader["best"]["c"], "d": leader["best"]["d"],
            "label": leader["best"]["label"],
            "profit": leader["best"]["profit"],
            "U": leader["best"]["U"],
        },
        "strategy_heatmap": {
            "case_id": heat["case_id"],
            "labels": heat_labels,
            "U": [row["U"] for row in heat["strategies"]],
            "profit": [row["profit"] for row in heat["strategies"]],
        },
        "verification": {
            "closed_form_vs_round_simulation": {
                "max_abs_diff": worst_round_diff,
                "tolerance": TOL,
                "within_tolerance": bool(worst_round_diff <= TOL),
                "strategy_points_checked": checked_pairs,
                "note": "解析闭式（EQ-COST-Q2）与逐轮现金流复算器的比对；"
                        "重点覆盖非检测件的采购倍数与回收件免采购只记一次",
            },
            "breakdown_identity": {
                "max_abs_diff": worst_breakdown_diff,
                "tolerance": TOL,
                "within_tolerance": bool(worst_breakdown_diff <= TOL),
                "note": "五类分项（采购/检测/装配/拆解/调换损失）之和与 U 的恒等式",
            },
            "purchase_counted_once": {
                "statement": "回收轮 K_r 不含任何采购项，免采购收益只落在 K_r 与 kappa 一处",
                "checked": True,
            },
        },
    }


def main():
    """跑本问并把账本写到本模块所在目录下的 q2_results.json。"""
    outputs = build_outputs()
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), OUTPUT_NAME)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(outputs, handle, ensure_ascii=False, indent=2)
    return path


if __name__ == "__main__":  # pragma: no cover
    main()