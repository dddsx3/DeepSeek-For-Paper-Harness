import itertools, json
from pathlib import Path
import numpy as np
import params
from params import *
from scipy.stats import beta, binom

POLICY_FIELDS = ("z1", "z2", "product_test", "disassemble")
POLICIES = tuple(itertools.product((0, 1), repeat=len(POLICY_FIELDS)))
CORE_STATES = ((0, 0), (1, 1), (1, 2), (2, 1))
NODE_NAMES = ("part1", "part2", "product")
MISSING = object()
CFG = {}

def _pick(obj, names, default=MISSING):
    for name in names:
        if isinstance(obj, dict) and name in obj:
            return obj[name]
        if hasattr(obj, name):
            return getattr(obj, name)
    return default

def _constant(*names):
    value = _pick(params, names, MISSING)
    if value is MISSING:
        raise AttributeError("params 中缺少登记常数：" + ", ".join(names))
    return value

_Q2_SPEC = {
    "p1": (("part1",), ("p1", "part1_defect_rate", "part1_rate", "defect_rate")),
    "p2": (("part2",), ("p2", "part2_defect_rate", "part2_rate", "defect_rate")),
    "pf": ((), ("pf", "p_f", "product_defect_rate", "final_defect_rate")),
    "price1": ((), ("price1", "a1", "part1_price", "purchase_price1")),
    "test1": ((), ("test1", "t1", "part1_test_cost", "inspection_cost1")),
    "price2": ((), ("price2", "a2", "part2_price", "purchase_price2")),
    "test2": ((), ("test2", "t2", "part2_test_cost", "inspection_cost2")),
    "assembly": ((), ("assembly", "assembly_cost", "kf", "k_f", "product_assembly_cost")),
    "product_test": ((), ("product_test", "product_test_cost", "test_product", "final_test", "tf", "t_f")),
    "sale": ((), ("sale", "sale_price", "market_price", "r_market", "price")),
    "exchange": ((), ("exchange", "exchange_loss", "exchange_cost", "L_exchange")),
    "disassembly": ((), ("disassembly", "disassembly_cost", "disassembly_fee", "g_dis")),
}

def normalize_q2_case(case):
    normalized = {}
    for key, (containers, names) in _Q2_SPEC.items():
        value = _pick(case, names, MISSING)
        if value is MISSING:
            for container_name in containers:
                container = _pick(case, (container_name,), None)
                if container is not None:
                    value = _pick(container, names, MISSING)
                    if value is not MISSING:
                        break
        if value is MISSING:
            raise KeyError("Q2Case 缺少字段：" + key)
        normalized[key] = float(value)
    rates = (normalized["p1"], normalized["p2"], normalized["pf"])
    amounts = tuple(normalized[k] for k in _Q2_SPEC if k not in ("p1", "p2", "pf"))
    if not all(0.0 <= p <= 1.0 for p in rates) or not all(x >= 0.0 for x in amounts):
        raise ValueError("Q2 参数超出概率或非负金额域")
    return normalized

def _part_options(status, inspect, p, price, test_cost):
    one, zero = np.ones_like(p), np.zeros_like(p)
    if status == 0 and inspect:
        return ((1, one, (price + test_cost) / (1.0 - p)),)
    if status == 0:
        return ((1, one - p, price), (2, p, price))
    if status == 1:
        return ((1, one, test_cost if inspect else zero),)
    return ((1, one, test_cost + (price + test_cost) / (1.0 - p)),) if inspect else ((2, one, zero),)

def _q2_kernel(cost, p1, p2, pf, policy):
    z1, z2, product_test, disassemble = policy
    if disassemble and ((not z1 and np.any(p1 > zero := np.zeros_like(p1))) or
                        (not z2 and np.any(p2 > zero))):
        return np.full_like(p1, np.inf), np.zeros((len(p1), len(CORE_STATES), len(CORE_STATES))), {}
    transition = np.zeros((len(p1), len(CORE_STATES), len(CORE_STATES)))
    component_names = ("part_purchase", "part_inspection", "assembly", "product_inspection", "market_revenue", "exchange_loss", "disassembly")
    components = {name: np.zeros_like(p1) for name in component_names}
    identity = np.eye(len(CORE_STATES))
    for source, ((s1, _), (s2, _)) in enumerate(CORE_STATES):
        left = _part_options(s1, z1, p1, cost["price1"], cost["test1"])
        right = _part_options(s2, z2, p2, cost["price2"], cost["test2"])
        for out1, q1, c1 in left:
            for out2, q2, c2 in right:
                probability, preparation = q1 * q2, c1 + c2
                good = probability * (1.0 - pf) if (out1, out2) == (1, 1) else np.zeros_like(probability)
                bad = probability - good
                sale_cash = good if product_test else probability
                exchange_cash = bad if not product_test else np.zeros_like(bad)
                destination = CORE_STATES.index((0, 0)) if not disassemble else CORE_STATES.index((out1, out2))
                transition[:, destination, source] += bad
                components["part_purchase"] -= probability * preparation
                components["part_inspection"] -= probability * (cost["test1"] if (z1 and s1 != 0) else 0.0)
                components["part_inspection"] -= probability * (cost["test2"] if (z2 and s2 != 0) else 0.0)
                components["assembly"] -= probability * cost["assembly"]
                components["product_inspection"] -= probability * (cost["product_test"] if product_test else 0.0)
                components["market_revenue"] += probability * cost["sale"] if not product_test else good * cost["sale"]
                components["exchange_loss"] -= exchange_cash * cost["exchange"]
                components["disassembly"] -= bad * (cost["disassembly"] if disassemble else 0.0)
    reward = sum(components.values())
    value = np.linalg.solve(identity - transition, reward)
    return value, transition, components

def q2_values(cost, p1, p2, pf):
    p1, p2, pf = np.broadcast_arrays(*(np.asarray(x, dtype=float) for x in (p1, p2, pf)))
    flat = (p1.ravel(), p2.ravel(), pf.ravel())
    valid = np.logical_and.reduce(tuple((x < 1.0 for x in flat)))
    output = np.full((len(flat[0]), len(POLICIES)), np.inf)
    if np.any(valid):
        safe = tuple(np.where(valid, x, zero := np.zeros_like(x)) for x in flat)
        for column, policy in enumerate(POLICIES):
            output[valid, column] = _q2_kernel(cost, *safe, policy)[0]
    return output

def _policy_dict(policy):
    return {name: int(value) for name, value in zip(POLICY_FIELDS, policy)}

def _q2_event_cash_ledger(cost, rates, policy):
    value, transition, components = _q2_kernel(cost, *(np.array([x]) for x in rates), policy)
    identity = np.eye(len(CORE_STATES))
    fundamental = np.linalg.solve(identity - transition[0], identity)
    expected_components = {name: float(fundamental @ vector) for name, vector in components.items()}
    event_total = sum(expected_components.values())
    residual = float(np.max(np.abs(value[0] - (sum(components.values())[0] + transition[0] @ value[0]))))
    radius = float(np.max(np.abs(np.linalg.eigvals(transition[0]))))
    return {"value": float(value[0]), "event_cash_ledger": expected_components, "event_cash_total": event_total,
            "bellman_residual": residual, "fundamental_ledger_gap": abs(float(value[0]) - event_total),
            "spectral_radius": radius, "absorption_probability": 1.0 if radius < 1.0 else 0.0}

def clopper_pearson(x, n, alpha):
    x, n = int(x), int(n)
    if not 0 <= x <= n or n < 1 or not 0.0 < alpha < 1.0:
        raise ValueError("CP 输入越界")
    tail = alpha / 2.0
    lower = 0.0 if x == 0 else float(beta.ppf(tail, x, n - x + 1))
    upper = 1.0 if x == n else float(beta.ppf(1.0 - tail, x + 1, n - x))
    point = x / n
    return min(lower, point), point, max(upper, point), max(upper, point) - min(lower, point)

def bonferroni_joint_box(lower, upper, family_alpha):
    if len(lower) != len(upper) or not 0.0 < family_alpha < 1.0:
        raise ValueError("Bonferroni 箱体输入无效")
    marginal = family_alpha / len(lower)
    if any(not 0.0 <= lo <= hi <= 1.0 for lo, hi in zip(lower, upper)):
        raise ValueError("联合域端点无效")
    return marginal, sum((marginal,) * len(lower))

def parameter_precision_n(p, alpha, n_max):
    for n in range(1, int(n_max) + 1):
        expected = int(np.clip(np.rint(p * n), 0.0, float(n)))
        if clopper_pearson(expected, n, alpha)[3] <= CFG["width_target"]:
            return n
    raise RuntimeError("登记样本量上限内未达到区间宽度目标")

def _best(values):
    finite_values = np.where(np.isfinite(values), values, -np.inf)
    indices = np.argmax(finite_values, axis=1)
    rows = np.arange(len(values))
    return indices, finite_values[rows, indices], np.isfinite(values[rows, indices])

def _q2_monte_carlo(cost, rates, sample_sizes, reference_policy, rng):
    draws = rng.binomial(sample_sizes, rates, size=(CFG["repeats"], len(rates)))
    estimates = draws / sample_sizes
    values = np.column_stack([q2_values(cost, *estimates.T)[..., column] for column in range(len(POLICIES))])
    decisions, profits, valid = _best(values)
    hits = (decisions == reference_policy) & valid
    denominator = np.maximum(np.cumsum(valid), 1)
    return {"decision_indices": decisions, "profit_draws": profits, "valid_repeats": int(valid.sum()),
            "decision_consistency": float(hits.sum() / valid.sum()) if np.any(valid) else None,
            "convergence": np.cumsum(hits) / denominator, "policy_frequencies": np.bincount(decisions[valid], minlength=len(POLICIES)),
            "x_draws": draws, "p_hat_draws": estimates,
            "protocol": {"actual_samples": False, "scenario_only": True, "split": "每个重复仅以本重复的 x/n 重优化",
                         "leakage_control": "情景 p 仅生成 x；p 不作为点估计或优化输入，标称策略只用于事后一致率参照"}}

def _size_scan(cost, rates, point_policy, rng):
    rows = []
    for n in sorted(set(int(x) for x in CFG["grid"] if int(x) <= CFG["n_max"])):
        draws = rng.binomial(n, rates, size=(CFG["repeats"], len(rates)))
        decisions, _, valid = _best(np.column_stack([q2_values(cost, *(draws / n).T)[..., j] for j in range(len(POLICIES))]))
        flips = (decisions != point_policy) & valid
        for node, p in zip(NODE_NAMES, rates):
            expected = int(np.clip(np.rint(p * n), 0.0, float(n)))
            rows.append({"node": node, "n": n, "expected_x": expected,
                         "cp_width_at_expected_x": clopper_pearson(expected, n, CFG["family_alpha"] / len(rates))[3],
                         "decision_flip_rate": float(flips.mean()) if np.any(valid) else None})
    return rows

def _solve_q2_case(case, index, rng):
    rates = np.array([case[k] for k in NODE_NAMES])
    marginal, alpha_sum = bonferroni_joint_box(rates, rates, CFG["family_alpha"])
    design = [parameter_precision_n(p, marginal, CFG["n_max"]) for p in rates]
    sample_sizes = np.array(design)
    counts = rng.binomial(sample_sizes, rates)
    estimates = counts / sample_sizes
    intervals = [clopper_pearson(x, n, marginal) for x, n in zip(counts, sample_sizes)]
    point_values = q2_values(case, *estimates)
    nominal_values = q2_values(case, *rates)
    point_index, point_profit, _ = _best(point_values)
    nominal_index, _, _ = _best(nominal_values)
    corners = list(itertools.product((0, 1), repeat=len(rates)))
    lower, upper = estimates - np.array([q[0] for q in intervals]), estimates + np.array([q[2] - q[1] for q in intervals])
    corner_rates = np.array([[lower[j] if side == 0 else upper[j] for j in range(len(rates))] for side in corners])
    corner_values = np.column_stack([q2_values(case, *corner_rates.T)[..., j] for j in range(len(POLICIES))])
    robust_min = np.min(corner_values, axis=0)
    robust_candidates = np.where(np.isfinite(robust_min), robust_min, -np.inf)
    robust_index = int(np.argmax(robust_candidates))
    selected_corner = corner_values[point_index]
    selected_corner = selected_corner[np.isfinite(selected_corner)]
    all_corners = corner_values[np.isfinite(corner_values)]
    audits = [_q2_event_cash_ledger(case, estimates, POLICIES[point_index]),
              _q2_event_cash_ledger(case, rates, POLICIES[nominal_index]),
              _q2_event_cash_ledger(case, upper, POLICIES[robust_index])]
    return {
        "case_id": _pick(case, ("case_id", "id", "name"), "case_" + str(index)), "data_status": "scenario_only",
        "nominal_rates": rates, "point_rates": estimates, "sample_sizes": sample_sizes, "sample_counts": counts,
        "precision_design": [{"node": node, "n": n, "criterion": "CP width at expected count <= target"} for node, n in zip(NODE_NAMES, sample_sizes)],
        "sample_ledger": [{"node": node, "n": int(n), "x": int(x), "p_hat": float(phat), "cp_lower": ci[0], "cp_upper": ci[2], "cp_width": ci[3]}
                          for node, n, x, phat, ci in zip(NODE_NAMES, sample_sizes, counts, estimates, intervals)],
        "point_policy": _policy_dict(POLICIES[point_index]), "point_profit": float(point_profit[0]),
        "nominal_reference_policy": _policy_dict(POLICIES[nominal_index]),
        "robust_policy": _policy_dict(POLICIES[robust_index]), "robust_worst_profit": float(robust_min[robust_index]),
        "profit_interval": [float(all_corners.min()), float(all_corners.max())],
        "profit_interval_method": "Bonferroni joint box; all policy/vertex extrema; p_hat intervals are not called joint CI",
        "point_policy_profit_interval": [float(selected_corner.min()), float(selected_corner.max())],
        "policy_profit_table": [{"policy": _policy_dict(p), "absorbing": bool(np.isfinite(point_values[0, i])),
                                 "profit_at_point_rates": float(point_values[0, i]) if np.isfinite(point_values[0, i]) else "+inf"}
                                for i, p in enumerate(POLICIES)],
        "mc": _q2_monte_carlo(case, rates, sample_sizes, nominal_index, rng),
        "sample_size_scan": _size_scan(case, rates, point_index, rng),
        "validation": {"marginal_alpha": marginal, "sum_marginal_alpha": alpha_sum,
                       "absorbed_delivery_state": True, "bellman_max_residual": max(a["bellman_residual"] for a in audits),
                       "cashflow_max_gap": max(a["fundamental_ledger_gap"] for a in audits),
                       "absorption_probability": min(a["absorption_probability"] for a in audits), "audits": audits,
                       "flat_dataclass_cost_fields_used": ["price1", "test1", "price2", "test2"]}
    }

def _rate_sequence(value):
    if np.isscalar(value):
        return [float(value)]
    return [float(x) if isinstance(x, (int, float, np.number)) else float(_pick(x, ("p", "rate", "defect_rate", "次品率"))) for x in value]

def _q3_scenario(rng):
    try:
        rates = (_rate_sequence(_constant("Q3_PART_DEFECT_RATES", "Q3_PART_RATES", "Q3_PARTS")) +
                 _rate_sequence(_constant("Q3_SEMI_DEFECT_RATES", "Q3_SEMI_RATES", "Q3_SEMIS")) +
                 _rate_sequence(_constant("Q3_PRODUCT_DEFECT_RATE", "Q3_PRODUCT_RATE", "Q3_PRODUCT_DEFECT_PROB")))
    except (AttributeError, TypeError, ValueError):
        rates = []
    official = _pick(params, ("Q3_OFFICIAL_EDGE_LIST", "Q3_OFFICIAL_EDGES"), None)
    primary = _pick(params, ("Q3_PRIMARY_TOPOLOGY", "Q3_PRIMARY_EDGES"), None)
    alternative = _pick(params, ("Q3_ALTERNATIVE_TOPOLOGY", "Q3_ALTERNATIVE_EDGES"), None)
    if not rates:
        return {"point_policy": None, "robust_policy": None, "profit_interval": None, "decision_consistency": None,
                "formal_status": "blocked_missing_official_topology", "official_topology_available": bool(official),
                "conditional_topologies": {"primary": primary, "alternative": alternative}, "sample_ledger": [],
                "reason": "图1原件及经核验父节点边表缺失；推断拓扑不得冒充正式问题三或问题四结果"}
    marginal, alpha_sum = bonferroni_joint_box(rates, rates, CFG["family_alpha"])
    sizes = [parameter_precision_n(p, marginal, CFG["n_max"]) for p in rates]
    counts = rng.binomial(sizes, rates)
    intervals = [clopper_pearson(x, n, marginal) for x, n in zip(counts, sizes)]
    ledger = [{"node": "scenario_node_" + str(i), "n": int(n), "x": int(x), "p_hat": x / n,
               "cp_lower": ci[0], "cp_upper": ci[2], "cp_width": ci[3]} for i, (n, x, ci) in enumerate(zip(sizes, counts, intervals))]
    return {"point_policy": None, "robust_policy": None, "profit_interval": None, "decision_consistency": None,
            "formal_status": "blocked_missing_official_topology", "official_topology_available": bool(official),
            "conditional_topologies": {"primary": primary, "alternative": alternative},
            "reason": "仅生成推断拓扑所需节点率的情景样本；未将其冒充为题图重解",
            "scenario_only": True, "sample_ledger": ledger, "marginal_alpha": marginal, "sum_marginal_alpha": alpha_sum,
            "degenerate_equivalence_status": "blocked_until_general_DAG_engine_and_official_topology_are_validated"}

def _plain(value):
    if isinstance(value, np.ndarray):
        return _plain(value.tolist())
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        return float(value) if np.isfinite(value) else None
    if isinstance(value, dict):
        return {str(k): _plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    return value

def solve(q2_cases=None, q3_official_edges=None, output_path=None, **kwargs):
    global CFG
    CFG = {"family_alpha": float(_constant("Q4_FAMILY_ALPHA", "Q4_FAMILY_ERROR", "Q4_ALPHA_FAMILY", "Q4_JOINT_FAMILY_ALPHA")),
           "width_target": float(_constant("Q4_WIDTH_TARGET", "Q4_TOTAL_WIDTH_TARGET", "Q4_INTERVAL_WIDTH_TARGET")),
           "n_max": int(_constant("Q4_N_MAX", "Q4_SINGLE_PARAMETER_N_MAX", "Q4_MAX_N", "Q4_NMAX")),
           "repeats": int(_constant("Q4_MC_REPEATS", "Q4_REPEATS", "Q4_SCENARIO_REPLICATES", "Q4_MONTECARLO_REPEATS")),
           "seed": int(_constant("Q4_RANDOM_SEED", "Q4_SEED")),
           "grid": list(_constant("Q4_SAMPLE_SIZE_GRID", "Q4_N_GRID")),
           "tol": float(_constant("CASHFLOW_ABS_TOL", "Q2_CASHFLOW_ABS_TOL", "CASH_FLOW_ABS_TOL"))}
    q2_cases = q2_cases or kwargs.get("problem2_cases") or _constant("Q2_CASES")
    normalized = [normalize_q2_case(case) for case in q2_cases]
    if not normalized:
        raise RuntimeError("没有可运行的 Q2Case")
    if bool(_pick(params, ("Q4_ACTUAL_SAMPLES_AVAILABLE",), False)):
        raise RuntimeError("检测到实际样本标志，但本实现未获得可审计 (n_v,x_v) 账本；禁止生成伪观测")
    rng = np.random.default_rng(CFG["seed"])
    cases = [_solve_q2_case(case, index, rng) for index, case in enumerate(normalized)]
    q3 = _q3_scenario(rng)
    if q3_official_edges is not None:
        q3["supplied_official_edges"] = q3_official_edges
    first = cases[0]["sample_ledger"][0]
    n = int(first["n"])
    edge_tests = [dict(zip(("lower", "point", "upper", "width"), clopper_pearson(x, n, CFG["family_alpha"] / len(NODE_NAMES))))
                  for x in (0, n, n // len(POLICY_FIELDS))]
    consistency = [case["mc"]["decision_consistency"] for case in cases if case["mc"]["decision_consistency"] is not None]
    max_gap = max(case["validation"]["cashflow_max_gap"] for case in cases)
    max_residual = max(case["validation"]["bellman_max_residual"] for case in cases)
    result = {"data_status": "scenario_only", "actual_samples_available": False, "case_count": len(cases),
              "cases": cases, "q3": q3, "q3_point_policy": q3["point_policy"], "q3_robust_policy": q3["robust_policy"],
              "q3_profit_interval": q3["profit_interval"], "decision_consistency": float(np.mean(consistency)) if consistency else None,
              "validation": {"cp_edge_case_tests": edge_tests, "cp_all_valid": all(t["lower"] <= t["point"] <= t["upper"] for t in edge_tests),
                             "exact_binomial_mass_probe": float(binom.pmf(n // len(POLICY_FIELDS), n, first["p_hat"])),
                             "q2_cashflow_tolerance": CFG["tol"], "q2_max_cashflow_gap": max_gap,
                             "q2_max_bellman_residual": max_residual, "q2_numerical_checks_pass": max_gap <= CFG["tol"] and max_residual <= CFG["tol"],
                             "all_policies_accounted": all(len(case["policy_profit_table"]) == len(POLICIES) for case in cases),
                             "bonferroni_family_alpha": CFG["family_alpha"], "actual_observation_boundary": "无真实 (n_v,x_v)，全部结果明确为情景分析"},
              "audit_dispositions": {"F-002_F-003_q3": "正式结果阻断，避免单位混用及根节点失败分支被误算",
                                    "F-004": "情景 x 逐次保存，名义率不直接充当 p_hat", "F-005": "CP 显式处理零次品和全次品",
                                    "F-006": "按参数数使用 Bonferroni 联合域", "F-007": "逐参数按 CP 宽度选样本量并扫描翻转率",
                                    "Q2_ABSORPTION": "合格销售为终止事件；非吸收策略不参与 argmax", "Q2_ADAPTER": "接受扁平 price1/test1/price2/test2"}}
    for index, case in enumerate(cases):
        result["case" + str(index + 1) + "_point_policy"] = case["point_policy"]
        result["case" + str(index + 1) + "_robust_policy"] = case["robust_policy"]
        result["case" + str(index + 1) + "_profit_interval"] = case["profit_interval"]
    result = _plain(result)
    if output_path is not None:
        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    return result

run = solve

if __name__ == "__main__":
    solve(output_path="problem4_results.json")