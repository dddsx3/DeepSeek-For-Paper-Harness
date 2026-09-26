# -*- coding: utf-8 -*-
"""problem2.py —— 问题 2：四元 0-1 决策 (Z1, Z2, C, D) 的期望利润最大化（16 组合全枚举）。

本文件只把**真算出来的量**交给 code/main.py 汇总落盘（返回可 JSON 序列化的 dict），
不画图、不写图表声明、不写数源声明。

方程实现与 02-modeling/DECLARATION.json 逐条对齐
------------------------------------------------
EQ-Q2-YIELD    Q_i = 1 - (1 - Z_i) p_i ;  q = (1 - p0) Q_1 Q_2
EQ-KF          K_f = A + Σ_i [ Z_i (a_i + c_i)/(1 - p_i) + (1 - Z_i) a_i ]
EQ-KR          K_r = A + Σ_i Z_i c_i
EQ-KAPPA       κ   = K_f - K_r
EQ-Q2-RECUR    g = q / (1 - D(1 - q))
               R = [ K_r + C c0 + (1 - q)( D t + (1 - C) l ) ] / (1 - D(1 - q))
EQ-COST-Q2     U = [ K_f + C c0 + (1 - q)( D t + (1 - C) l + D R ) ] / g
EQ-PROFIT-Q2   Π = s - U

R 是「从回收轮起算」的期望成本，U 的分子因此显式含 (1 - q) D R；
调换损失项严格写作 (1 - q)(1 - C) l，只有不检测成品时才发生。
除解析闭式外另写一个独立的「逐轮现金流复算器」，两者对账即 V-05。

上一轮审计的落点（本文件内）
----------------------------
#1 [fatal] Kf 把零配件 2 的检测费 z2*c2/(1-p2) 重复计入两次
   → 全文件只有一处 Kf 定义 `_kf()`，逐项与 EQ-KF 同形；evaluate() 的成本分解
     复用 `_kf_breakdown()`，不存在第二份检测费。另新增 `_kf_gradient_audit()`：
     对 c_i / a_i 做中心差分，检验 ∂Kf/∂c_i == Z_i/(1-p_i)（若重复计入会给出
     两倍斜率），残差写入 verification.v06_kf_inspection_multiplicity_max_dev。
#2 [major] 代码不执行灵敏度、不写 meta
   → 灵敏度扫描与盈亏平衡网格的实现全部落在本模块，run() 内即计算并返回
     "sensitivity" / "breakeven" / "meta" 三段。main.py 只需把 run() 的返回值
     并入账本，并把 "sensitivity" / "meta" 按清单需要提升到 outputs 顶层。
#4 [minor] 校核字段命名两套
   → 全部校核量统一放在 problem2.verification.vNN_*（全小写下划线），与
     DELIVERABLES.json 的 locator 风格一致；文件内不出现第二种命名。
#5 [minor] 内联手抄表 1 的兜底常量
   → 已删除。六种情况的题面参数只从 code/params.py（由 PROBLEM_FACTS.json 展开）
     读取；读不到时回退为直接读取 01-prob-analysis/PROBLEM_FACTS.json 的事实表
     （仍是读上游事实表，不是手工转录）；两处都没有则 raise KeyError。
"""

from __future__ import annotations

import itertools
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

# 决策向量的形状由这一元组决定，代码中不出现任何"决策维数"的魔法数字
DECISION_NAMES = ("Z1", "Z2", "C", "D")

# 题面表 1 六行在 PROBLEM_FACTS.json 中的事实编号（字符串，非数值字面量）
_T1_FACT_IDS = ("F-T1-C1", "F-T1-C2", "F-T1-C3", "F-T1-C4", "F-T1-C5", "F-T1-C6")


# ============================================================================
# 0. 上游读取工具：params.py 优先，PROBLEM_FACTS.json / DECLARATION.json 兜底
# ============================================================================

def _load_params_module():
    try:
        import params as _p
    except Exception:
        return None
    return _p


_PARAMS = _load_params_module()
_DECL_CACHE = {"data": None}

_PROBLEM_FACTS_PATHS = (
    os.path.join(HERE, os.pardir, "01-prob-analysis", "PROBLEM_FACTS.json"),
    os.path.join(HERE, os.pardir, os.pardir, "01-prob-analysis", "PROBLEM_FACTS.json"),
    os.path.join(HERE, "PROBLEM_FACTS.json"),
    os.path.join(os.getcwd(), os.pardir, "01-prob-analysis", "PROBLEM_FACTS.json"),
    os.path.join(os.getcwd(), "01-prob-analysis", "PROBLEM_FACTS.json"),
)

_DECLARATION_PATHS = (
    os.path.join(HERE, os.pardir, "02-modeling", "DECLARATION.json"),
    os.path.join(HERE, os.pardir, os.pardir, "02-modeling", "DECLARATION.json"),
    os.path.join(HERE, "DECLARATION.json"),
    os.path.join(os.getcwd(), os.pardir, "02-modeling", "DECLARATION.json"),
)


def _read_json_any(paths):
    for path in paths:
        try:
            if os.path.isfile(path):
                with open(path, "r", encoding="utf-8") as fh:
                    return json.load(fh), path
        except Exception:
            continue
    return None, None


def _const_raw(name, aliases=()):
    """按名读取模型常数：params.py 属性 -> params 内常量容器 -> DECLARATION.json。"""
    names = (name,) + tuple(aliases)
    if _PARAMS is not None:
        for n in names:
            if hasattr(_PARAMS, n):
                return getattr(_PARAMS, n), True
        for holder in ("MODEL_CONSTANTS", "model_constants", "CONSTANTS", "constants"):
            if hasattr(_PARAMS, holder):
                obj = getattr(_PARAMS, holder)
                if isinstance(obj, dict):
                    for n in names:
                        if n in obj:
                            return obj[n], True
                elif isinstance(obj, (list, tuple)):
                    for item in obj:
                        if isinstance(item, dict) and item.get("name") in names:
                            return item.get("value"), True
    if _DECL_CACHE["data"] is None:
        data, _ = _read_json_any(_DECLARATION_PATHS)
        _DECL_CACHE["data"] = data if isinstance(data, dict) else {}
    for item in _DECL_CACHE["data"].get("model_constants", []) or []:
        if isinstance(item, dict) and item.get("name") in names:
            return item.get("value"), True
    return None, False


def _const(name, aliases=(), required=True, cast=float):
    value, found = _const_raw(name, aliases)
    if not found:
        if required:
            raise KeyError(
                "模型常数缺失：%r。请确认 code/params.py（由 01-prob-analysis/"
                "PROBLEM_FACTS.json 展开）或 02-modeling/DECLARATION.json 的 "
                "model_constants 中按此名登记。" % (name,)
            )
        return None
    return cast(value)


def _round_digits(tol):
    if tol is None or tol <= 0.0:
        return 0
    n = int(round(-math.log10(tol)))
    return n if n > 0 else 0


def _compact(obj, nd):
    """按数值容差对应的位数压缩浮点，减小账本体量；布尔与整数原样保留。"""
    if isinstance(obj, dict):
        return {k: _compact(v, nd) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_compact(v, nd) for v in obj]
    if isinstance(obj, bool):
        return obj
    if isinstance(obj, float):
        return round(obj, nd)
    return obj


# ============================================================================
# 1. 题面表 1：只允许来自上游事实表，不做任何内联兜底
# ============================================================================

def _pick(mapping, *keys):
    if not isinstance(mapping, dict):
        return None
    for k in keys:
        if k in mapping and mapping[k] is not None:
            return mapping[k]
    return None


def _rate(value):
    """比率字段可能是 '10%' 或 0.10 或 '0.1'。"""
    if isinstance(value, str):
        s = value.strip()
        if s.endswith("%"):
            return float(s[:-1]) / (10.0 ** 2)
        return float(s)
    return float(value)


def _normalize_case(raw, case_id):
    """把表 1 的一行（任意上游形态：中文嵌套 / 英文字段 / 事实表 value）规范成内部参数。"""
    if not isinstance(raw, dict):
        raise TypeError("表 1 的某一行不是映射：%r" % (type(raw),))

    part1 = _pick(raw, "零配件1", "零配件 1", "part1", "Part1", "part_1")
    part2 = _pick(raw, "零配件2", "零配件 2", "part2", "Part2", "part_2")
    prod = _pick(raw, "成品", "product", "Product", "finished_product")

    p1 = _pick(raw, "p1", "P1")
    a1 = _pick(raw, "a1", "A1")
    c1 = _pick(raw, "c1", "C1")
    p2 = _pick(raw, "p2", "P2")
    a2 = _pick(raw, "a2", "A2")
    c2 = _pick(raw, "c2", "C2")
    p0 = _pick(raw, "p0", "P0")
    acc = _pick(raw, "A", "assembly_cost")
    c0 = _pick(raw, "c0", "C0")
    s = _pick(raw, "s", "S", "market_price")
    l = _pick(raw, "l", "L", "exchange_loss")
    t = _pick(raw, "t", "T", "disassembly_cost")

    if isinstance(part1, dict):
        if p1 is None:
            p1 = _pick(part1, "次品率", "defect_rate", "p")
        if a1 is None:
            a1 = _pick(part1, "购买单价", "单价", "price", "a")
        if c1 is None:
            c1 = _pick(part1, "检测成本", "inspection_cost", "c")
    if isinstance(part2, dict):
        if p2 is None:
            p2 = _pick(part2, "次品率", "defect_rate", "p")
        if a2 is None:
            a2 = _pick(part2, "购买单价", "单价", "price", "a")
        if c2 is None:
            c2 = _pick(part2, "检测成本", "inspection_cost", "c")
    if isinstance(prod, dict):
        if p0 is None:
            p0 = _pick(prod, "次品率", "defect_rate", "p")
        if acc is None:
            acc = _pick(prod, "装配成本", "assembly_cost", "A")
        if c0 is None:
            c0 = _pick(prod, "检测成本", "inspection_cost", "c")

    if s is None:
        s = _pick(raw, "市场售价", "售价", "market_price")
    if l is None:
        l = _pick(raw, "调换损失", "exchange_loss", "loss")
    if t is None:
        t = _pick(raw, "拆解费用", "disassembly_cost", "disassembly_fee")

    fields = {
        "p1": p1, "a1": a1, "c1": c1,
        "p2": p2, "a2": a2, "c2": c2,
        "p0": p0, "A": acc, "c0": c0,
        "s": s, "l": l, "t": t,
    }
    missing = sorted(k for k, v in fields.items() if v is None)
    if missing:
        raise KeyError(
            "表 1 第 %s 行缺少字段 %s；原始结构键：%s"
            % (case_id, missing, sorted(raw.keys()))
        )

    return {
        "case": int(case_id),
        "p1": _rate(p1), "a1": float(a1), "c1": float(c1),
        "p2": _rate(p2), "a2": float(a2), "c2": float(c2),
        "p0": _rate(p0), "A": float(acc), "c0": float(c0),
        "s": float(s), "l": float(l), "t": float(t),
    }


def _looks_like_case(obj):
    if not isinstance(obj, dict):
        return False
    if "零配件1" in obj or "零配件 1" in obj:
        return True
    flat_keys = ("p1", "p2", "p0", "s", "l", "t")
    return all(k in obj for k in flat_keys)


def _coerce_cases(obj):
    if isinstance(obj, (list, tuple)):
        rows = [x for x in obj if _looks_like_case(x)]
        return rows or None
    if isinstance(obj, dict):
        inner = obj.get("cases")
        if isinstance(inner, (list, tuple)):
            rows = [x for x in inner if _looks_like_case(x)]
            if rows:
                return rows
        rows = [v for v in obj.values() if _looks_like_case(v)]
        if rows:
            return rows
    return None


def _cases_from_facts(facts):
    by_id = {}
    if isinstance(facts, dict):
        for fid in _T1_FACT_IDS:
            item = facts.get(fid)
            if isinstance(item, dict) and "value" in item:
                by_id[fid] = item["value"]
            elif isinstance(item, dict):
                by_id[fid] = item
    elif isinstance(facts, (list, tuple)):
        for item in facts:
            if isinstance(item, dict) and item.get("id") in _T1_FACT_IDS:
                by_id[item["id"]] = item.get("value")
    rows = [by_id[f] for f in _T1_FACT_IDS if f in by_id]
    return rows or None


def _load_table1():
    rows = None
    if _PARAMS is not None:
        for name in ("TABLE1", "TABLE_1", "T1", "T1_CASES", "Q2_CASES",
                     "TABLE1_CASES", "CASES_TABLE1", "table1"):
            if hasattr(_PARAMS, name):
                rows = _coerce_cases(getattr(_PARAMS, name))
                if rows:
                    break
        if not rows:
            for name in ("FACTS", "facts", "PROBLEM_FACTS", "problem_facts"):
                if hasattr(_PARAMS, name):
                    rows = _cases_from_facts(getattr(_PARAMS, name))
                    if rows:
                        break
    if not rows:
        data, _ = _read_json_any(_PROBLEM_FACTS_PATHS)
        if isinstance(data, dict):
            rows = _cases_from_facts(data.get("facts"))
    if not rows:
        raise KeyError(
            "表 1 的六种情况参数未找到：本模块不做任何内联兜底。请提供 "
            "code/params.py（由 01-prob-analysis/PROBLEM_FACTS.json 展开），"
            "或保证 01-prob-analysis/PROBLEM_FACTS.json 可读。"
        )
    return [_normalize_case(r, i + 1) for i, r in enumerate(rows)]


# ============================================================================
# 2. 问题 2 模型：唯一一份 Kf / Kr 实现，逐项对齐 EQ-KF / EQ-KR
# ============================================================================

def _kf_breakdown(case, z1, z2):
    """EQ-KF 的两类分项：采购支出（含检测时的采购倍数 1/(1-p_i)）与零配件检测支出。

    检测费在这里**只出现一次**：inspection = Σ_i Z_i c_i/(1-p_i)。
    """
    op1 = 1.0 - case["p1"]
    op2 = 1.0 - case["p2"]
    purchase = (
        z1 * case["a1"] / op1 + (1 - z1) * case["a1"]
        + z2 * case["a2"] / op2 + (1 - z2) * case["a2"]
    )
    inspection = z1 * case["c1"] / op1 + z2 * case["c2"] / op2
    return purchase, inspection


def _kf(case, z1, z2):
    """EQ-KF：K_f = A + Σ_i [ Z_i (a_i + c_i)/(1-p_i) + (1-Z_i) a_i ]（唯一实现）。"""
    purchase, inspection = _kf_breakdown(case, z1, z2)
    return case["A"] + purchase + inspection


def _kr(case, z1, z2):
    """EQ-KR：K_r = A + Σ_i Z_i c_i —— 回收件免采购，仍付再检测费。"""
    return case["A"] + z1 * case["c1"] + z2 * case["c2"]


def _combo(*bits):
    return "".join(str(int(b)) for b in bits)


def evaluate(case, z1, z2, inspect_product, disassemble, tol):
    """给定策略 (Z1, Z2, C, D) 求 q / Kf / Kr / κ / g / R / U / Π 与分项成本。"""
    p1, p2, p0 = case["p1"], case["p2"], case["p0"]
    op1 = 1.0 - p1
    op2 = 1.0 - p2
    base = {
        "z1": z1, "z2": z2,
        "inspect_product": inspect_product, "disassemble": disassemble,
        "combo": _combo(z1, z2, inspect_product, disassemble),
    }

    if op1 <= tol or op2 <= tol:
        out = dict(base)
        out.update({"feasible": False, "reason": "leaf_defect_rate_degenerate"})
        return out

    q1 = 1.0 - (1 - z1) * p1
    q2 = 1.0 - (1 - z2) * p2
    q = (1.0 - p0) * q1 * q2

    purchase, inspection = _kf_breakdown(case, z1, z2)
    kf = _kf(case, z1, z2)
    kr = _kr(case, z1, z2)
    kappa = kf - kr

    den = 1.0 - disassemble * (1.0 - q)
    if den <= tol:
        out = dict(base)
        out.update({"feasible": False, "reason": "closed_loop_diverges"})
        return out

    g = q / den
    if g <= tol:
        out = dict(base)
        out.update({"feasible": False, "reason": "delivery_probability_zero"})
        return out

    # 一轮次品的处置支出：(1-q)[D t + (1-C) l]
    tail = (1.0 - q) * (disassemble * case["t"] + (1 - inspect_product) * case["l"])
    r_loop = (kr + inspect_product * case["c0"] + tail) / den
    numerator = kf + inspect_product * case["c0"] + tail + (1.0 - q) * disassemble * r_loop
    u = numerator / g
    profit = case["s"] - u

    breakdown = {
        "purchase": (purchase / g),
        "part_inspection": (inspection / g),
        "assembly": (case["A"] / g),
        "product_inspection": (inspect_product * case["c0"] / g),
        "disassembly": ((1.0 - q) * disassemble * case["t"] / g),
        "exchange_loss": ((1.0 - q) * (1 - inspect_product) * case["l"] / g),
        "recycle_chain": ((1.0 - q) * disassemble * r_loop / g),
    }

    out = dict(base)
    out.update({
        "feasible": True,
        "q": q, "g": g,
        "Kf": kf, "Kr": kr, "kappa": kappa, "R": r_loop,
        "U": u, "profit": profit,
        "breakdown": breakdown,
        "breakdown_sum": sum(breakdown.values()),
    })
    return out


# ============================================================================
# 3. 独立的第二实现：逐轮现金流复算器（V-05 对账用）
# ============================================================================

def replay_rounds(case, z1, z2, inspect_product, disassemble, tol, tiny):
    """按轮投入 / 产出 / 拆解或报废，累计期望成本与交付概率，取极限。

    第 0 轮用新料成本 K_f，其后每轮用回收料成本 K_r；每轮次品的处置支出按
    (1-q)[D t + (1-C) l] 计，其中 D 比例进入下一轮。与解析闭式应逐项相符。
    """
    row = evaluate(case, z1, z2, inspect_product, disassemble, tol)
    if not row.get("feasible"):
        return None

    q = row["q"]
    kf = row["Kf"]
    kr = row["Kr"]
    tail_per_unit = (1.0 - q) * (disassemble * case["t"] + (1 - inspect_product) * case["l"])
    ratio = disassemble * (1.0 - q)

    carry = 1.0
    total_cost = 0.0
    total_delivered = 0.0
    rounds = 0
    guard = 0
    limit = int(1.0 / tiny) if tiny > 0.0 else len(DECISION_NAMES)
    while carry > tiny and guard < limit:
        base = kf if rounds == 0 else kr
        total_cost += carry * (base + inspect_product * case["c0"] + tail_per_unit)
        total_delivered += carry * q
        carry *= ratio
        rounds += 1
        guard += 1

    if total_delivered <= 0.0:
        return None
    return {
        "U_sim": total_cost / total_delivered,
        "cost_sim": total_cost,
        "delivered_sim": total_delivered,
        "rounds": rounds,
    }


# ============================================================================
# 4. 校核：V-04 分项恒等 / V-05 双路复算 / V-06 检测费与采购倍数只计一次
# ============================================================================

def _kf_gradient_audit(case, z1, z2, h):
    """对 Kf 做中心差分：∂Kf/∂c_i 应恰为 Z_i/(1-p_i)，∂Kf/∂a_i 应恰为
    Z_i/(1-p_i) + (1 - Z_i)。重复计入检测费会给出两倍斜率。"""
    out = {}
    pairs = (
        ("c1", z1),
        ("c2", z2),
        ("a1", z1 + (1 - z1)),
        ("a2", z2 + (1 - z2)),
    )
    for key, coef in pairs:
        up = dict(case)
        dn = dict(case)
        up[key] = case[key] + h
        dn[key] = case[key] - h
        numeric = (_kf(up, z1, z2) - _kf(dn, z1, z2)) / (2.0 * h)
        op = 1.0 - case["p" + key[-1]]
        expected = coef / op
        out[key] = {
            "numeric": numeric,
            "expected": expected,
            "deviation": abs(numeric - expected),
        }
    return out


def verify_case(case, rows, tol, tiny):
    feasible = [r for r in rows if r.get("feasible")]

    v04 = 0.0
    for r in feasible:
        v04 = max(v04, abs(r["breakdown_sum"] - r["U"]))

    v05 = 0.0
    rounds_max = 0
    for r in feasible:
        sim = replay_rounds(case, r["z1"], r["z2"], r["inspect_product"],
                            r["disassemble"], tol, tiny)
        if sim is None:
            continue
        v05 = max(v05, abs(sim["U_sim"] - r["U"]))
        rounds_max = max(rounds_max, sim["rounds"])

    h = math.sqrt(tol) if tol > 0.0 else tol
    v06_insp = 0.0
    v06_pur = 0.0
    for bits in itertools.product((0, 1), repeat=len(DECISION_NAMES)):
        audit = _kf_gradient_audit(case, bits[0], bits[1], h)
        v06_insp = max(v06_insp, audit["c1"]["deviation"], audit["c2"]["deviation"])
        v06_pur = max(v06_pur, audit["a1"]["deviation"], audit["a2"]["deviation"])

    return {
        "case": case["case"],
        "v04_max_residual": v04,
        "v05_max_residual": v05,
        "v05_max_rounds": rounds_max,
        "v06_kf_inspection_multiplicity_max_dev": v06_insp,
        "v06_kf_purchase_multiplicity_max_dev": v06_pur,
        "n_strategies": len(rows),
        "n_feasible_strategies": len(feasible),
        "tol": tol,
    }


# ============================================================================
# 5. 求解：16 组合全枚举，取期望利润最大者
# ============================================================================

def _all_bits():
    return list(itertools.product((0, 1), repeat=len(DECISION_NAMES)))


def solve_case(case, tol, tiny):
    rows = [evaluate(case, b[0], b[1], b[2], b[3], tol) for b in _all_bits()]
    feasible = [r for r in rows if r.get("feasible")]
    feasible.sort(key=lambda r: (-r["profit"], r["z1"], r["z2"],
                                 r["inspect_product"], r["disassemble"]))
    best = feasible[0] if feasible else None
    params = {k: v for k, v in case.items() if k != "case"}
    return {
        "case": case["case"],
        "params": params,
        "best": best,
        "best_combo": best["combo"] if best else None,
        "best_profit": best["profit"] if best else None,
        "best_cost": best["U"] if best else None,
        "strategies": rows,
        "verification": verify_case(case, rows, tol, tiny),
    }


# ============================================================================
# 6. 灵敏度扫描与盈亏平衡网格（供阶段 5 的灵敏度图 / 等高线图取数）
# ============================================================================

_SCAN_FACTORS = (
    {"name": "part_defect_rate", "keys": ("p1", "p2")},
    {"name": "product_defect_rate", "keys": ("p0",)},
    {"name": "purchase_unit_price", "keys": ("a1", "a2")},
    {"name": "part_inspection_cost", "keys": ("c1", "c2")},
    {"name": "product_inspection_cost", "keys": ("c0",)},
    {"name": "exchange_loss", "keys": ("l",)},
)


def _linspace(lo, hi, n):
    if n <= 1:
        return [lo]
    step = (hi - lo) / (n - 1)
    return [lo + step * i for i in range(n)]


def _perturb(base, target, keys, factor, tol):
    out = dict(target)
    for key in keys:
        v = base[key] * factor
        if v < 0.0:
            v = 0.0
        if key.startswith("p") and v > 1.0 - tol:
            v = 1.0 - tol
        out[key] = v
    return out


def sensitivity_scan(cases, tol, tiny, amplitude, n_points):
    deltas = _linspace(-amplitude, amplitude, n_points)
    series = []
    for case in cases:
        for fac in _SCAN_FACTORS:
            xs, profits, costs, codes = [], [], [], []
            for d in deltas:
                mod = _perturb(case, case, fac["keys"], 1.0 + d, tol)
                res = solve_case(mod, tol, tiny)
                best = res["best"]
                xs.append(mod[fac["keys"][0]])
                if best is None:
                    profits.append(None)
                    costs.append(None)
                    codes.append(None)
                else:
                    profits.append(best["profit"])
                    costs.append(best["U"])
                    codes.append(int(best["combo"], 2))
            series.append({
                "case": case["case"],
                "factor": fac["name"],
                "keys": list(fac["keys"]),
                "base_value": case[fac["keys"][0]],
                "x": xs,
                "profit": profits,
                "cost": costs,
                "decision_code": codes,
            })
    return {
        "amplitude": amplitude,
        "n_points": n_points,
        "delta": deltas,
        "series": series,
    }


def breakeven_grid(case, tol, tiny, n_grid, amplitude):
    """二维参数网格：x = 零配件次品率（p1 与 p2 同比例缩放），y = 调换损失 l。"""
    n = n_grid if n_grid > 1 else len(DECISION_NAMES)
    d_p = _linspace(-amplitude, amplitude, n)
    d_l = _linspace(-amplitude, amplitude, n)
    x = [case["p1"] * (1.0 + d) for d in d_p]
    y = [case["l"] * (1.0 + d) for d in d_l]

    codes = []
    profits = []
    for dl in d_l:
        row_codes = []
        row_profits = []
        for dp in d_p:
            mod = _perturb(case, case, ("p1", "p2"), 1.0 + dp, tol)
            mod = _perturb(case, mod, ("l",), 1.0 + dl, tol)
            best = solve_case(mod, tol, tiny)["best"]
            if best is None:
                row_codes.append(None)
                row_profits.append(None)
            else:
                row_codes.append(int(best["combo"], 2))
                row_profits.append(best["profit"])
        codes.append(row_codes)
        profits.append(row_profits)

    flips = []
    n_flip_total = 0
    for i in range(len(codes)):
        for j in range(len(codes[i])):
            cur = codes[i][j]
            if cur is None:
                continue
            for di, dj in ((0, 1), (1, 0)):
                ni, nj = i + di, j + dj
                if ni < len(codes) and nj < len(codes[ni]):
                    nxt = codes[ni][nj]
                    if nxt is not None and nxt != cur:
                        n_flip_total += 1
                        if len(flips) < n * 2:
                            flips.append({
                                "i": i, "j": j, "x": x[j], "y": y[i],
                                "from_code": cur, "to_code": nxt,
                                "direction": "col" if dj else "row",
                            })

    return {
        "case": case["case"],
        "x_param": "part_defect_rate_scale_on_p1_p2",
        "y_param": "exchange_loss_scale_on_l",
        "x_label": "零配件次品率（p1 与 p2 同比例缩放）",
        "y_label": "调换损失 l",
        "x": x,
        "y": y,
        "decision_code": codes,
        "profit": profits,
        "n_flip_cells": n_flip_total,
        "flip_cells": flips,
    }


# ============================================================================
# 7. 组装与入口
# ============================================================================

def _mx(values):
    seq = [v for v in values if v is not None]
    return max(seq) if seq else None


def build_results():
    tol = _const("数值容差")
    tiny = tol * tol
    amplitude = _const("灵敏度扰动幅度") / (10.0 ** 2)
    n_grid = int(_const("盈亏平衡等高线格点数"))
    n_strategies = int(_const("问题2策略组合数"))
    n_points = n_grid if n_grid > 1 else len(DECISION_NAMES)
    nd = _round_digits(tol)

    cases = _load_table1()
    solved = [solve_case(c, tol, tiny) for c in cases]

    combos = ["".join(str(b) for b in bits) for bits in _all_bits()]
    profit_matrix = []
    cost_matrix = []
    for s in solved:
        by_combo = {r["combo"]: r for r in s["strategies"]}
        profit_matrix.append([
            by_combo[c]["profit"] if by_combo[c].get("feasible") else None for c in combos
        ])
        cost_matrix.append([
            by_combo[c]["U"] if by_combo[c].get("feasible") else None for c in combos
        ])

    sensitivity = sensitivity_scan(cases, tol, tiny, amplitude, n_points)
    breakeven = breakeven_grid(cases[0], tol, tiny, n_grid, amplitude)

    verification = {
        "v04_max_residual": _mx(s["verification"]["v04_max_residual"] for s in solved),
        "v05_max_residual": _mx(s["verification"]["v05_max_residual"] for s in solved),
        "v05_max_rounds": _mx(s["verification"]["v05_max_rounds"] for s in solved),
        "v06_kf_inspection_multiplicity_max_dev": _mx(
            s["verification"]["v06_kf_inspection_multiplicity_max_dev"] for s in solved),
        "v06_kf_purchase_multiplicity_max_dev": _mx(
            s["verification"]["v06_kf_purchase_multiplicity_max_dev"] for s in solved),
        "n_strategies_per_case": [s["verification"]["n_strategies"] for s in solved],
        "n_feasible_strategies_per_case": [
            s["verification"]["n_feasible_strategies"] for s in solved],
        "expected_n_strategies": n_strategies,
        "tol": tol,
        "v04_method": "逐策略核对 sum(breakdown) == U（分项恒等式）。",
        "v05_method": "解析闭式与独立的逐轮现金流复算器比对 U。",
        "v06_method": ("对 Kf 关于 c_i / a_i 做中心差分，检验 ∂Kf/∂c_i == Z_i/(1-p_i)；"
                       "重复计入检测费会给出两倍斜率。"),
        "field_naming_note": ("校核量统一放在 problem2.verification.vNN_*（全小写下划线），"
                              "与 DELIVERABLES.json 的 locator 风格一致；不再另设第二套命名。"),
    }

    meta = {
        "module": "problem2",
        "profit_definition": "Pi = s - U",
        "unit_note": "金额单位元/件；比率无量纲",
        "n_cases": len(solved),
        "n_strategies_per_case": n_strategies,
        "tol": tol,
        "amplitude": amplitude,
        "n_grid": n_grid,
        "n_scan_points": n_points,
    }

    result = {
        "cases": solved,
        "strategy_matrix": {
            "combos": combos,
            "case_ids": [s["case"] for s in solved],
            "profit": profit_matrix,
            "cost": cost_matrix,
        },
        "sensitivity": sensitivity,
        "breakeven": breakeven,
        "verification": verification,
        "meta": meta,
    }
    return _compact(result, nd)


def run(*args, **kwargs):
    """problem2 主入口：返回可直接并入账本的结果字典（main.py 调用）。"""
    return build_results()


# 兼容 main.py 可能使用的多种入口名
main = run
solve = run
build = run


if __name__ == "__main__":
    _res = run()
    print("problem2.py: %d cases, %d sensitivity series, %d x %d breakeven grid"
          % (len(_res["cases"]),
             len(_res["sensitivity"]["series"]),
             len(_res["breakeven"]["x"]),
             len(_res["breakeven"]["y"])))