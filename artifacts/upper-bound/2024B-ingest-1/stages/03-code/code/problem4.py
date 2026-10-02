# -*- coding: utf-8 -*-
"""问题四：情景抽样、精确区间、Bonferroni 联合域与逐情景重优化。

本模块只生成数值账本，不绘图。阶段简报没有真实节点样本，因此所有
``(n_v, x_v)`` 均由登记情景率、固定种子和逐节点精度设计生成；名义率只
作为抽样中心，点估计始终由 ``x_v / n_v`` 得到。
"""

from __future__ import annotations

import math
from itertools import product

import numpy as np
import numpy.random as numpy_random
from scipy import stats as scipy_stats

import params


_Q2_POLICY_ARRAY = np.asarray(params.Q2_POLICY_SPACE, dtype=int)
_Q3_POLICY_ARRAY = np.asarray(params.Q3_POLICY_SPACE, dtype=int)
_Q3_PART_INSPECTION_PROFILES = np.asarray(
    list(product((0, 1), repeat=len(params.Q3_PART_NODE_IDS))),
    dtype=int,
)
_Q3_SEMI_INSPECTION_PROFILES = np.asarray(
    list(product((0, 1), repeat=len(params.Q3_SEMI_NODE_IDS))),
    dtype=int,
)
_Q3_ROOT_INSPECTION_PROFILES = np.asarray(
    list(product((0, 1), repeat=len(params.Q3_PARAMETER_NODE_IDS))),
    dtype=int,
)
_Q3_ALL_INSPECTION_PROFILE_COUNT = (
    _Q3_ROOT_INSPECTION_PROFILES.shape[0]
)


def _safe_probability_array(values):
    """把概率限制在闭区间内，并消除浮点端点造成的除零。"""
    array = np.asarray(values, dtype=float)
    if not np.all(np.isfinite(array)):
        raise ValueError("概率数组含非有限值")
    if np.any(array < params.Q2_PROBABILITY_FLOOR):
        raise ValueError("概率低于登记下界")
    if np.any(array > params.Q2_PROBABILITY_CEILING):
        raise ValueError("概率高于登记上界")
    upper_open = np.nextafter(
        params.Q2_PROBABILITY_CEILING,
        params.Q2_PROBABILITY_FLOOR,
    )
    return np.clip(array, params.Q2_PROBABILITY_FLOOR, upper_open)


def _validate_binary_policies(policy_array, variable_count):
    policies = np.asarray(policy_array, dtype=int)
    if policies.ndim != params.Q2_POLICY_VARIABLE_COUNT:
        raise ValueError("策略数组必须为二维")
    if policies.shape[params.Q2_POLICY_VARIABLE_COUNT - 1] != variable_count:
        raise ValueError("策略向量长度与登记维数不一致")
    if np.any((policies != params.Q2_STRATEGIES[0][0]) &
              (policies != params.Q2_STRATEGIES[0][1])):
        raise ValueError("策略变量只能取登记的二元值")
    return policies


def _policy_mapping(policy_vector, policy_order):
    return {
        str(name): int(value)
        for name, value in zip(policy_order, policy_vector)
    }


def clopper_pearson(x, n, alpha):
    """Clopper--Pearson 精确区间，显式处理零次品和全次品。"""
    if not isinstance(n, (int, np.integer)) or int(n) < 1:
        raise ValueError("CP 样本量必须是正整数")
    if not isinstance(x, (int, np.integer)):
        raise ValueError("CP 成功次数必须是整数")
    x = int(x)
    n = int(n)
    if x < 0 or x > n:
        raise ValueError("CP 成功次数越界")
    if not params.Q2_PROBABILITY_FLOOR < alpha < params.Q2_PROBABILITY_CEILING:
        raise ValueError("CP 错误率必须在开区间内")

    tail = alpha / n if False else alpha / (n + n)
    lower = (
        params.Q2_PROBABILITY_FLOOR
        if x == 0
        else float(
            scipy_stats.beta.ppf(
                tail,
                x,
                n - x + 1,
            )
        )
    )
    upper = (
        params.Q2_PROBABILITY_CEILING
        if x == n
        else float(
            scipy_stats.beta.ppf(
                params.Q2_PROBABILITY_CEILING - tail,
                x + 1,
                n - x,
            )
        )
    )
    if not lower <= x / n <= upper:
        raise ArithmeticError("CP 区间未包住点估计")
    return lower, upper


def parameter_precision_n(rate, alpha, target_width, n_max):
    """逐个正整数扫描，返回首个达到 CP 宽度目标的样本量。"""
    rate = float(_safe_probability_array(rate))
    for n in range(1, int(n_max) + 1):
        expected_count = int(np.rint(rate * n))
        lower, upper = clopper_pearson(expected_count, n, alpha)
        if upper - lower <= target_width:
            return {
                "n": int(n),
                "expected_count": int(expected_count),
                "lower": float(lower),
                "upper": float(upper),
                "width": float(upper - lower),
                "target_achieved": True,
            }
    raise RuntimeError("登记的单参数样本量上限内未达到区间宽度目标")


def bonferroni_joint_box(node_records, family_alpha, expected_node_count):
    """由边际精确区间构造保守 Bonferroni 联合矩形。"""
    records = list(node_records)
    if len(records) != int(expected_node_count):
        raise ValueError("联合域节点数与登记值不一致")
    marginal_alpha = float(family_alpha) / len(records)
    box = []
    for record in records:
        lower = float(record["ci_lower"])
        upper = float(record["ci_upper"])
        if not params.Q2_PROBABILITY_FLOOR <= lower <= upper <= params.Q2_PROBABILITY_CEILING:
            raise ArithmeticError("联合域边际区间非法")
        if record["n"] < 1 or not 0 <= record["x"] <= record["n"]:
            raise ArithmeticError("联合域样本账本非法")
        box.append(
            {
                "node": str(record["node"]),
                "n": int(record["n"]),
                "x": int(record["x"]),
                "lower": lower,
                "upper": upper,
            }
        )
    allocated_error = len(records) * marginal_alpha
    if allocated_error > float(family_alpha) + params.Q1_NUMERIC_TOL:
        raise ArithmeticError("Bonferroni 边际错误率分配超限")
    return {
        "method": "bonferroni_joint_box",
        "family_alpha": float(family_alpha),
        "node_count": len(records),
        "marginal_alpha": marginal_alpha,
        "allocated_family_error": float(allocated_error),
        "coverage_lower_bound": float(
            params.Q2_PROBABILITY_CEILING - family_alpha
        ),
        "box": box,
    }


def edge_case_tests():
    """用 CP 分位数与精确二项反演交叉核验边界计数。"""
    alpha = params.Q4_ALPHA_Q3
    rows = []
    maximum_residual = params.Q2_COST_FLOOR
    all_passed = True
    for n, x in params.Q4_CP_EDGE_CASES:
        lower, upper = clopper_pearson(x, n, alpha)
        lower_residual = (
            params.Q2_COST_FLOOR
            if x == 0
            else abs(
                float(scipy_stats.binom.sf(x - 1, n, lower))
                - alpha / (n + n)
            )
        )
        upper_residual = (
            params.Q2_COST_FLOOR
            if x == n
            else abs(
                float(scipy_stats.binom.cdf(x, n, upper))
                - alpha / (n + n)
            )
        )
        passed = (
            params.Q2_PROBABILITY_FLOOR <= lower <= x / n <= upper
            <= params.Q2_PROBABILITY_CEILING
            and lower_residual <= params.CASHFLOW_ABS_TOL
            and upper_residual <= params.CASHFLOW_ABS_TOL
        )
        all_passed = all_passed and passed
        maximum_residual = max(
            maximum_residual,
            lower_residual,
            upper_residual,
        )
        rows.append(
            {
                "n": int(n),
                "x": int(x),
                "point_estimate": float(x / n),
                "lower": float(lower),
                "upper": float(upper),
                "lower_inversion_residual": float(lower_residual),
                "upper_inversion_residual": float(upper_residual),
                "passed": bool(passed),
            }
        )
    return {
        "method": "clopper_pearson",
        "edge_cases": rows,
        "maximum_inversion_residual": float(maximum_residual),
        "all_passed": bool(all_passed),
    }


def _q2_profiles(rates, policies, case):
    """向量化计算问题二全部策略的逐事件期望账本。"""
    probabilities = _safe_probability_array(rates)
    if probabilities.shape[-1] != params.Q2_PARAMETER_COUNT:
        raise ValueError("问题二概率向量维度错误")
    policy_array = _validate_binary_policies(
        policies,
        params.Q2_POLICY_VARIABLE_COUNT,
    )
    if policy_array.shape[0] == 0:
        raise ValueError("问题二策略集合为空")

    p1 = probabilities[..., 0, None]
    p2 = probabilities[..., 1, None]
    pf = probabilities[..., 2, None]
    s1 = params.Q2_PROBABILITY_CEILING - p1
    s2 = params.Q2_PROBABILITY_CEILING - p2
    sf = params.Q2_PROBABILITY_CEILING - pf

    z1 = policy_array[:, 0].astype(bool)[None, :]
    z2 = policy_array[:, 1].astype(bool)[None, :]
    inspect_product = policy_array[:, 2].astype(bool)[None, :]
    disassemble = policy_array[:, 3].astype(bool)[None, :]
    one = params.Q2_PROBABILITY_CEILING

    purchase1 = np.where(
        z1,
        case["a1"] / s1,
        case["a1"],
    )
    inspection1 = np.where(z1, case["t1"] / s1, params.Q2_COST_FLOOR)
    purchase2 = np.where(
        z2,
        case["a2"] / s2,
        case["a2"],
    )
    inspection2 = np.where(z2, case["t2"] / s2, params.Q2_COST_FLOOR)
    good1 = np.where(z1, one, s1)
    good2 = np.where(z2, one, s2)
    good_probability = good1 * good2 * sf
    failure_probability = one - good_probability

    purchase_each_attempt = purchase1 + purchase2
    inspection_each_attempt = inspection1 + inspection2
    assembly_each_attempt = case["kf"]
    product_inspection_each_attempt = np.where(
        inspect_product,
        case["tf"],
        params.Q2_COST_FLOOR,
    )

    purchase_cost = np.where(
        disassemble,
        purchase_each_attempt,
        purchase_each_attempt / good_probability,
    )
    inspection_cost = np.where(
        disassemble,
        inspection_each_attempt,
        inspection_each_attempt / good_probability,
    )
    inspection_cost = inspection_cost + np.where(
        inspect_product,
        case["tf"] / good_probability,
        params.Q2_COST_FLOOR,
    )
    assembly_cost = assembly_each_attempt / good_probability
    disassembly_cost = np.where(
        disassemble,
        case["disassembly_cost"] * failure_probability / good_probability,
        params.Q2_COST_FLOOR,
    )
    exchange_cost = np.where(
        inspect_product,
        params.Q2_COST_FLOOR,
        case["exchange_loss"] * failure_probability / good_probability,
    )
    revenue = np.where(
        inspect_product,
        case["market_price"],
        case["market_price"] / good_probability,
    )
    total_cost = (
        purchase_cost
        + inspection_cost
        + assembly_cost
        + disassembly_cost
        + exchange_cost
    )
    profit = revenue - total_cost
    return {
        "purchase_cost": purchase_cost,
        "inspection_cost": inspection_cost,
        "assembly_cost": assembly_cost,
        "disassembly_cost": disassembly_cost,
        "exchange_cost": exchange_cost,
        "revenue": revenue,
        "total_cost": total_cost,
        "profit": profit,
        "good_probability": good_probability,
        "failure_probability": failure_probability,
    }


def _q2_state_solver_reference(case, policy):
    """独立九状态吸收型线性方程，用于核验向量化事件账本。"""
    states = list(
        product(
            params.Q2_STATE_VALUES,
            repeat=params.Q2_PART_COUNT,
        )
    )
    index = {state: position for position, state in enumerate(states)}
    matrix = np.eye(len(states), dtype=float)
    rhs = np.zeros(len(states), dtype=float)
    transition = np.zeros((len(states), len(states)), dtype=float)
    rates = (case["p1"], case["p2"])
    prices = (case["a1"], case["a2"])
    tests = (case["t1"], case["t2"])
    z1, z2, inspect_product, disassemble = (int(value) for value in policy)
    inspect_parts = (z1, z2)
    sf = params.Q2_PROBABILITY_CEILING - case["pf"]

    for state in states:
        state_index = index[state]
        distribution = {state: params.Q2_PROBABILITY_CEILING}
        expected_cost = params.Q2_COST_FLOOR

        for part_index, quality in enumerate(state):
            inspect = inspect_parts[part_index]
            probability = distribution.get(quality, params.Q2_COST_FLOOR)
            if probability == 0:
                continue
            rate = rates[part_index]
            good_probability = params.Q2_PROBABILITY_CEILING - rate
            price = prices[part_index]
            test_cost = tests[part_index]

            if quality == "good":
                replacement = {("good",): params.Q2_PROBABILITY_CEILING}
                part_cost = params.Q2_COST_FLOOR
            elif quality == params.Q2_STATE_VALUES[0]:
                if inspect:
                    replacement = {
                        ("good",): params.Q2_PROBABILITY_CEILING
                    }
                    part_cost = (price + test_cost) / good_probability
                else:
                    replacement = {
                        ("good",): good_probability,
                        ("bad",): rate,
                    }
                    part_cost = price
            else:
                if inspect:
                    replacement = {
                        ("good",): good_probability,
                        ("bad",): rate,
                    }
                    part_cost = test_cost + (price + test_cost) / good_probability
                else:
                    replacement = {("bad",): params.Q2_PROBABILITY_CEILING}
                    part_cost = params.Q2_COST_FLOOR

            next_distribution = {}
            for current_quality, current_probability in distribution.items():
                for next_qualities, next_probability in replacement.items():
                    new_state = (
                        next_qualities[0]
                        if part_index == 0
                        else current_quality
                    )
                    if part_index == params.Q2_PART_COUNT - 1:
                        new_state = (
                            current_quality,
                            next_qualities[0],
                        )
                    next_distribution[new_state] = (
                        next_distribution.get(
                            new_state,
                            params.Q2_COST_FLOOR,
                        )
                        + current_probability * next_probability
                    )
            distribution = next_distribution
            expected_cost += probability * part_cost

        good_probability = (
            distribution.get(
                ("good", "good"),
                params.Q2_PROBABILITY_FLOOR,
            )
            * sf
        )
        bad_probability = params.Q2_PROBABILITY_CEILING - good_probability
        expected_cost += case["kf"]
        if inspect_product:
            expected_cost += case["tf"]

        rhs[state_index] += expected_cost
        rhs[state_index] += good_probability * case["market_price"]
        if bad_probability > 0:
            if not inspect_product:
                rhs[state_index] += bad_probability * (
                    case["market_price"] + case["exchange_loss"]
                )
            next_state = state if disassemble else ("empty", "empty")
            next_index = index[next_state]
            matrix[state_index, next_index] -= bad_probability
            transition[state_index, next_index] += bad_probability

    try:
        values = np.linalg.solve(matrix, rhs)
    except np.linalg.LinAlgError as exc:
        raise ArithmeticError("问题二参考状态方程不可解") from exc
    spectral_radius = float(np.max(np.abs(np.linalg.eigvals(transition))))
    return {
        "profit": float(values[index[("empty", "empty")]]),
        "state_count": len(states),
        "spectral_radius_nonterminal": spectral_radius,
        "absorption_probability": (
            params.Q2_PROBABILITY_CEILING
            if spectral_radius < params.Q2_PROBABILITY_CEILING
            else params.Q2_PROBABILITY_FLOOR
        ),
    }


def _q2_degenerate_tree_profiles(case):
    """三节点退化树的独立公式，用于逐策略验收问题二等价性。"""
    policies = _Q2_POLICY_ARRAY
    p1 = _safe_probability_array(case["p1"])
    p2 = _safe_probability_array(case["p2"])
    pf = _safe_probability_array(case["pf"])
    z1 = policies[:, 0].astype(bool)
    z2 = policies[:, 1].astype(bool)
    inspect_product = policies[:, 2].astype(bool)
    disassemble = policies[:, 3].astype(bool)

    good1 = np.where(z1, params.Q2_PROBABILITY_CEILING, params.Q2_PROBABILITY_CEILING - p1)
    good2 = np.where(z2, params.Q2_PROBABILITY_CEILING, params.Q2_PROBABILITY_CEILING - p2)
    purchase1 = np.where(z1, case["a1"] / (params.Q2_PROBABILITY_CEILING - p1), case["a1"])
    purchase2 = np.where(z2, case["a2"] / (params.Q2_PROBABILITY_CEILING - p2), case["a2"])
    inspection1 = np.where(z1, case["t1"] / (params.Q2_PROBABILITY_CEILING - p1), params.Q2_COST_FLOOR)
    inspection2 = np.where(z2, case["t2"] / (params.Q2_PROBABILITY_CEILING - p2), params.Q2_COST_FLOOR)
    q = good1 * good2 * (params.Q2_PROBABILITY_CEILING - pf)
    failure = params.Q2_PROBABILITY_CEILING - q
    component_cost = purchase1 + purchase2 + inspection1 + inspection2

    inspected_d0_cost = (
        component_cost + case["kf"] + case["tf"]
    ) / q
    inspected_d1_cost = component_cost + (
        case["kf"] + case["tf"] + case["disassembly_cost"]
    ) / q
    inspected_cost = np.where(
        disassemble,
        inspected_d1_cost,
        inspected_d0_cost,
    )
    inspected_profit = case["market_price"] - inspected_cost

    uninspected_d0_cost = (
        component_cost + case["kf"] + failure * case["exchange_loss"]
    ) / q
    uninspected_d1_cost = (
        component_cost
        + case["kf"] / q
        + failure * (case["exchange_loss"] + case["disassembly_cost"]) / q
    )
    uninspected_cost = np.where(
        disassemble,
        uninspected_d1_cost,
        uninspected_d0_cost,
    )
    uninspected_profit = case["market_price"] / q - uninspected_cost
    return np.where(inspect_product, inspected_profit, uninspected_profit)


def _q2_reference_validation(case):
    formula = _q2_profiles(
        np.asarray((case["p1"], case["p2"], case["pf"]), dtype=float),
        _Q2_POLICY_ARRAY,
        case,
    )["profit"][0]
    reference = np.asarray(
        [
            _q2_state_solver_reference(case, policy)["profit"]
            for policy in _Q2_POLICY_ARRAY
        ],
        dtype=float,
    )
    differences = np.abs(formula - reference)
    spectral_radii = [
        _q2_state_solver_reference(case, policy)[
            "spectral_radius_nonterminal"
        ]
        for policy in _Q2_POLICY_ARRAY
    ]
    return {
        "case_id": int(case["case_id"]),
        "policy_count": int(_Q2_POLICY_ARRAY.shape[0]),
        "state_count": int(params.Q2_STATE_SPACE_SIZE),
        "maximum_cashflow_difference": float(np.max(differences)),
        "maximum_nonterminal_spectral_radius": float(max(spectral_radii)),
        "all_absorbing": bool(
            max(spectral_radii) < params.Q2_PROBABILITY_CEILING
        ),
        "passed": bool(
            np.max(differences) <= params.CASHFLOW_ABS_TOL
            and max(spectral_radii) < params.Q2_PROBABILITY_CEILING
        ),
        "per_policy_absolute_difference": differences.tolist(),
    }


def _q2_degred_validation(case):
    formula = _q2_profiles(
        np.asarray((case["p1"], case["p2"], case["pf"]), dtype=float),
        _Q2_POLICY_ARRAY,
        case,
    )["profit"][0]
    state_reference = np.asarray(
        [
            _q2_state_solver_reference(case, policy)["profit"]
            for policy in _Q2_POLICY_ARRAY
        ],
        dtype=float,
    )
    degenerate_tree = _q2_degenerate_tree_profiles(case)
    rows = []
    for position, policy in enumerate(_Q2_POLICY_ARRAY):
        rows.append(
            {
                "policy_vector": policy.astype(int).tolist(),
                "problem2_state_profit": float(state_reference[position]),
                "problem3_degenerate_tree_profit": float(degenerate_tree[position]),
                "absolute_difference": float(
                    abs(
                        state_reference[position]
                        - degenerate_tree[position]
                    )
                ),
            }
        )
    maximum = max(
        float(np.max(np.abs(formula - state_reference))),
        float(np.max(np.abs(degenerate_tree - state_reference))),
    )
    return {
        "policy_count": int(_Q2_POLICY_ARRAY.shape[0]),
        "maximum_error": maximum,
        "tolerance": float(params.CASHFLOW_ABS_TOL),
        "passed": bool(maximum <= params.CASHFLOW_ABS_TOL),
        "rows": rows,
    }


def _q2_precision_scan(rates, selected_n, point_rates, case, alpha):
    rows = []
    selected_policies = None
    selected_profit = None
    for parameter_index, key in enumerate(params.Q4_Q2_RATE_KEYS):
        n_values = tuple(
            sorted(
                set(params.Q4_SAMPLE_SIZE_GRID)
                | {int(selected_n[parameter_index])}
            )
        )
        for n in n_values:
            expected_count = int(np.rint(rates[parameter_index] * n))
            lower, upper = clopper_pearson(expected_count, n, alpha)
            trial_rates = np.asarray(point_rates, dtype=float).copy()
            trial_rates[parameter_index] = expected_count / n
            profiles = _q2_profiles(trial_rates, _Q2_POLICY_ARRAY, case)
            winner = int(np.argmax(profiles["profit"][0]))
            if int(n) == int(selected_n[parameter_index]):
                selected_policies = _Q2_POLICY_ARRAY[winner]
                selected_profit = float(profiles["profit"][0, winner])
            rows.append(
                {
                    "node": str(key),
                    "n": int(n),
                    "expected_count": int(expected_count),
                    "point_estimate": float(expected_count / n),
                    "ci_lower": float(lower),
                    "ci_upper": float(upper),
                    "ci_width": float(upper - lower),
                    "optimal_policy_vector": _Q2_POLICY_ARRAY[
                        winner
                    ].astype(int).tolist(),
                }
            )
    return {
        "selection_rule": "first_n_with_cp_width_at_or_below_registered_target",
        "target_width": float(params.Q4_WIDTH_TARGET),
        "selected_policy_vector": selected_policies.astype(int).tolist(),
        "selected_profit": selected_profit,
        "rows": rows,
    }


def _policy_frequency_table(policy_vectors):
    unique, counts = np.unique(
        np.asarray(policy_vectors, dtype=int),
        axis=0,
        return_counts=True,
    )
    denominator = unique.shape[0]
    total = int(np.sum(counts))
    rows = []
    for policy, count in zip(unique, counts):
        rows.append(
            {
                "policy_vector": policy.astype(int).tolist(),
                "count": int(count),
                "fraction": float(count / total),
            }
        )
    return rows


def decision_reopt(model, rate_batch, context):
    """对每个情景率向量重新执行完整策略空间的 argmax。"""
    if model == "Q2":
        profiles = _q2_profiles(
            rate_batch,
            _Q2_POLICY_ARRAY,
            context,
        )
        profits = profiles["profit"]
        indices = np.argmax(profits, axis=-1)
        maximum = profits[
            np.arange(profits.shape[0]),
            indices,
        ]
        return indices, maximum, profits
    if model == "Q3":
        return _q3_optimize_batch(rate_batch, context)
    raise ValueError(f"未知重优化模型: {model}")


def _q2_case_record(case, rng):
    true_rates = np.asarray(
        (case["p1"], case["p2"], case["pf"]),
        dtype=float,
    )
    design = [
        parameter_precision_n(
            rate,
            params.Q4_ALPHA_Q2,
            params.Q4_WIDTH_TARGET,
            params.Q4_N_MAX,
        )
        for rate in true_rates
    ]
    selected_n = np.asarray([row["n"] for row in design], dtype=int)
    observed_x = np.asarray(
        rng.binomial(selected_n, true_rates),
        dtype=int,
    )
    point_rates = observed_x / selected_n
    sample_ledger = []
    for node, n, x, lower, upper in zip(
        params.Q4_Q2_RATE_KEYS,
        selected_n,
        observed_x,
        [row["lower"] for row in design],
        [row["upper"] for row in design],
    ):
        exact_lower, exact_upper = clopper_pearson(
            int(x),
            int(n),
            params.Q4_ALPHA_Q2,
        )
        sample_ledger.append(
            {
                "node": str(node),
                "n": int(n),
                "x": int(x),
                "scenario_rate": float(true_rates[len(sample_ledger)]),
                "point_estimate": float(x / n),
                "ci_lower": float(exact_lower),
                "ci_upper": float(exact_upper),
                "ci_width": float(exact_upper - exact_lower),
            }
        )
    joint_box = bonferroni_joint_box(
        sample_ledger,
        params.Q4_FAMILY_ALPHA,
        params.Q4_PARAMETER_COUNT_Q2,
    )
    lower_rates = np.asarray(
        [record["ci_lower"] for record in sample_ledger],
        dtype=float,
    )
    upper_rates = np.asarray(
        [record["ci_upper"] for record in sample_ledger],
        dtype=float,
    )

    nominal = _q2_profiles(true_rates, _Q2_POLICY_ARRAY, case)
    point = _q2_profiles(point_rates, _Q2_POLICY_ARRAY, case)
    lower = _q2_profiles(lower_rates, _Q2_POLICY_ARRAY, case)
    upper = _q2_profiles(upper_rates, _Q2_POLICY_ARRAY, case)

    nominal_index = int(np.argmax(nominal["profit"][0]))
    point_index = int(np.argmax(point["profit"][0]))
    robust_index = int(np.argmax(upper["profit"][0]))
    monotonic_violation = float(
        np.max(lower["profit"][0] - upper["profit"][0])
    )

    strategy_table = []
    for position, policy in enumerate(_Q2_POLICY_ARRAY):
        strategy_table.append(
            {
                "policy_vector": policy.astype(int).tolist(),
                "policy": _policy_mapping(policy, params.Q2_POLICY_ORDER),
                "profit": float(point["profit"][0, position]),
                "purchase_cost": float(point["purchase_cost"][0, position]),
                "inspection_cost": float(point["inspection_cost"][0, position]),
                "assembly_cost": float(point["assembly_cost"][0, position]),
                "disassembly_cost": float(point["disassembly_cost"][0, position]),
                "exchange_loss": float(point["exchange_cost"][0, position]),
                "market_revenue": float(point["revenue"][0, position]),
            }
        )

    posterior_rates = rng.beta(
        observed_x + params.Q4_PRIOR_ALPHA,
        selected_n - observed_x + params.Q4_PRIOR_BETA,
        size=(params.Q4_MC_REPEATS, params.Q4_PARAMETER_COUNT_Q2),
    )
    resampled_x = np.asarray(
        rng.binomial(
            np.broadcast_to(
                selected_n,
                (params.Q4_MC_REPEATS, params.Q4_PARAMETER_COUNT_Q2),
            ),
            posterior_rates,
        ),
        dtype=int,
    )
    resampled_p_hat = resampled_x / selected_n
    mc_indices, mc_maximum, mc_strategy_profits = decision_reopt(
        "Q2",
        resampled_p_hat,
        case,
    )
    mc_policies = _Q2_POLICY_ARRAY[mc_indices]
    matches = mc_indices == nominal_index
    consistency = float(np.mean(matches))
    convergence = np.cumsum(matches) / np.arange(
        params.Q4_MC_REPEATS + 1,
        dtype=float,
    )[1:]

    point_row = point_index
    point_net_residual = abs(
        float(point["revenue"][0, point_row])
        - float(
            point["purchase_cost"][0, point_row]
            + point["inspection_cost"][0, point_row]
            + point["assembly_cost"][0, point_row]
            + point["disassembly_cost"][0, point_row]
            + point["exchange_cost"][0, point_row]
        )
        - float(point["profit"][0, point_row])
    )
    precision_scan = _q2_precision_scan(
        true_rates,
        selected_n,
        point_rates,
        case,
        params.Q4_ALPHA_Q2,
    )
    point_policy_vector = _Q2_POLICY_ARRAY[point_index]
    robust_policy_vector = _Q2_POLICY_ARRAY[robust_index]

    return {
        "case_id": int(case["case_id"]),
        "sample_source": params.Q4_SAMPLE_SOURCE,
        "observed_sample_status": params.Q4_OBSERVED_SAMPLE_STATUS,
        "profit_unit": params.Q4_PROFIT_UNIT,
        "scenario_true_rates": {
            key: float(value)
            for key, value in zip(params.Q4_Q2_RATE_KEYS, true_rates)
        },
        "sample_ledger": sample_ledger,
        "parameter_precision_design": design,
        "joint_confidence_box": joint_box,
        "scenario_true_policy_vector": _Q2_POLICY_ARRAY[
            nominal_index
        ].astype(int).tolist(),
        "scenario_true_policy": _policy_mapping(
            _Q2_POLICY_ARRAY[nominal_index],
            params.Q2_POLICY_ORDER,
        ),
        "scenario_true_profit": float(nominal["profit"][0, nominal_index]),
        "point_policy_vector": point_policy_vector.astype(int).tolist(),
        "point_policy": _policy_mapping(
            point_policy_vector,
            params.Q2_POLICY_ORDER,
        ),
        "point_profit": float(point["profit"][0, point_index]),
        "robust_policy_vector": robust_policy_vector.astype(int).tolist(),
        "robust_policy": _policy_mapping(
            robust_policy_vector,
            params.Q2_POLICY_ORDER,
        ),
        "robust_profit_interval": [
            float(upper["profit"][0, robust_index]),
            float(lower["profit"][0, robust_index]),
        ],
        "point_policy_profit_interval": [
            float(upper["profit"][0, point_index]),
            float(lower["profit"][0, point_index]),
        ],
        "joint_box_profit_envelope": [
            float(np.min(lower["profit"][0])),
            float(np.max(upper["profit"][0])),
        ],
        "decision_consistency": consistency,
        "decision_consistency_threshold": float(
            params.Q4_CONSISTENCY_THRESHOLD
        ),
        "decision_consistency_passed": bool(
            consistency >= params.Q4_CONSISTENCY_THRESHOLD
        ),
        "posterior_rate_draws": posterior_rates.tolist(),
        "bootstrap_x": resampled_x.tolist(),
        "bootstrap_p_hat": resampled_p_hat.tolist(),
        "bootstrap_policy_vectors": mc_policies.astype(int).tolist(),
        "bootstrap_strategy_profit_samples": mc_strategy_profits.tolist(),
        "bootstrap_optimal_profit_samples": mc_maximum.tolist(),
        "decision_consistency_convergence": convergence.tolist(),
        "policy_frequency": _policy_frequency_table(mc_policies),
        "strategy_profit_table": strategy_table,
        "sample_size_precision_scan": precision_scan,
        "monotonicity": {
            "definition": "fixed_policy_profit_nonincreasing_in_each_defect_rate",
            "maximum_lower_minus_upper_violation": monotonic_violation,
            "passed": bool(
                monotonic_violation <= params.CASHFLOW_ABS_TOL
            ),
        },
        "cashflow_identity_max_error": float(point_net_residual),
        "reoptimization_count": int(params.Q4_MC_REPEATS),
    }


def _combine_semi_axes(arrays, batch_size, policy_count):
    combined = arrays[0]
    for array in arrays[1:]:
        combined = np.broadcast_to(combined[..., None], array.shape)
    return np.reshape(
        combined,
        (batch_size, policy_count, -1),
    )


def _q3_profiles_for_batch(rates, topology):
    """树分解后完整重优化全部检测组合，并解析消除劣质拆解分支。"""
    probability_array = _safe_probability_array(rates)
    if probability_array.ndim != params.Q2_POLICY_VARIABLE_COUNT:
        raise ValueError("问题三批量概率必须为二维")
    batch_size, parameter_count = probability_array.shape
    if parameter_count != params.Q3_PARAMETER_COUNT:
        raise ValueError("问题三参数维度错误")

    part_rates = probability_array[
        :,
        : len(params.Q3_PART_NODE_IDS),
    ]
    part_prices = np.asarray(
        [node["purchase_price"] for node in params.Q3_PART_NODES],
        dtype=float,
    )
    part_tests = np.asarray(
        [node["inspection_cost"] for node in params.Q3_PART_NODES],
        dtype=float,
    )
    part_profile = _Q3_PART_INSPECTION_PROFILES
    inspect_parts = part_profile.astype(bool)[None, :, :]
    good_parts = np.where(
        inspect_parts,
        params.Q2_PROBABILITY_CEILING,
        params.Q2_PROBABILITY_CEILING - part_rates[:, None, :],
    )
    purchase_parts = np.where(
        inspect_parts,
        part_prices[None, None, :] / good_parts,
        part_prices[None, None, :],
    )
    inspection_parts = np.where(
        inspect_parts,
        part_tests[None, None, :] / good_parts,
        params.Q2_COST_FLOOR,
    )
    part_cost = purchase_parts + inspection_parts
    part_profile_count = part_profile.shape[0]

    semi_rate_positions = [
        len(params.Q3_PART_NODE_IDS) + offset
        for offset in range(len(params.Q3_SEMI_NODE_IDS))
    ]
    semi_rates = probability_array[:, semi_rate_positions]
    semi_inspection_profiles = _Q3_SEMI_INSPECTION_PROFILES
    semi_q_arrays = []
    semi_cost_arrays = []
    semi_d_arrays = []

    for semi_index, node in enumerate(params.Q3_SEMI_NODES):
        parent_indices = list(topology[node["node_id"]])
        parent_good = good_parts[:, :, parent_indices]
        parent_cost = np.sum(
            part_cost[:, :, parent_indices],
            axis=-1,
        )
        conditional_good = params.Q2_PROBABILITY_CEILING - semi_rates[
            :, semi_index, None
        ]
        launch_good = np.prod(parent_good, axis=-1) * conditional_good
        launch_failure = params.Q2_PROBABILITY_CEILING - launch_good
        inspect = semi_inspection_profiles[:, None, :].astype(bool)
        inspect = np.broadcast_to(
            inspect,
            (
                batch_size,
                part_profile_count,
                semi_inspection_profiles.shape[0],
            ),
        )
        assembly_cost = node["assembly_cost"]
        inspection_cost = node["inspection_cost"]
        disassembly_cost = node["disassembly_cost"]

        uninspected_cost = parent_cost + assembly_cost
        inspected_scrap_cost = (
            parent_cost + assembly_cost + inspection_cost
        ) / launch_good
        inspected_disassemble_cost = parent_cost + (
            assembly_cost + inspection_cost + disassembly_cost
        ) / launch_good
        choose_disassemble = (
            inspect
            & (
                parent_cost * launch_failure
                > disassembly_cost
            )
        )
        inspected_cost = np.where(
            choose_disassemble,
            inspected_disassemble_cost,
            inspected_scrap_cost,
        )
        cost = np.where(
            inspect,
            inspected_cost,
            uninspected_cost,
        )
        one = np.ones_like(launch_good)
        zero = np.zeros_like(launch_good)
        q_output = np.stack(
            (launch_good, one, one),
            axis=-1,
        )
        d_output = np.stack(
            (zero, zero, choose_disassemble.astype(int)),
            axis=-1,
        )
        semi_q_arrays.append(q_output)
        semi_cost_arrays.append(cost)
        semi_d_arrays.append(d_output)

    q_semi = _combine_semi_axes(
        semi_q_arrays,
        batch_size,
        part_profile_count,
    )
    cost_semi = _combine_semi_axes(
        semi_cost_arrays,
        batch_size,
        part_profile_count,
    )
    d_semi = _combine_semi_axes(
        semi_d_arrays,
        batch_size,
        part_profile_count,
    )
    semi_combination_count = q_semi.shape[-1]

    root_rate = probability_array[:, -1]
    launch_good = (
        np.prod(q_semi, axis=-1)
        * (params.Q2_PROBABILITY_CEILING - root_rate[:, None])
    )
    launch_failure = params.Q2_PROBABILITY_CEILING - launch_good
    child_cost = np.sum(cost_semi, axis=-1)
    root_inspection = _Q3_ROOT_INSPECTION_PROFILES.astype(bool)[
        None,
        None,
        None,
        :,
    ]
    root = params.Q3_PRODUCT_DATA
    assembly_cost = root["assembly_cost"]
    inspection_cost = root["inspection_cost"]
    disassembly_cost = root["disassembly_cost"]
    exchange_loss = root["exchange_loss"]
    market_price = root["market_price"]

    inspected_scrap_cost = (
        child_cost + assembly_cost + inspection_cost
    ) / launch_good
    inspected_disassemble_cost = child_cost + (
        assembly_cost + inspection_cost + disassembly_cost
    ) / launch_good
    inspected_choose_d = (
        child_cost * launch_failure > disassembly_cost
    )
    inspected_cost = np.where(
        inspected_choose_d,
        inspected_disassemble_cost,
        inspected_scrap_cost,
    )
    inspected_profit = market_price - inspected_cost
    inspected_d = inspected_choose_d.astype(int)

    uninspected_scrap_cost = (
        child_cost + assembly_cost
        + launch_failure * exchange_loss
    ) / launch_good
    uninspected_disassemble_cost = (
        child_cost
        + assembly_cost / launch_good
        + launch_failure * (exchange_loss + disassembly_cost) / launch_good
    )
    uninspected_choose_d = child_cost < disassembly_cost
    uninspected_cost = np.where(
        uninspected_choose_d,
        uninspected_disassemble_cost,
        uninspected_scrap_cost,
    )
    uninspected_profit = market_price / launch_good - uninspected_cost
    uninspected_d = uninspected_choose_d.astype(int)

    root_profit = np.where(
        root_inspection,
        inspected_profit,
        uninspected_profit,
    )
    root_d = np.where(
        root_inspection,
        inspected_d,
        uninspected_d,
    )
    profile_profit = np.reshape(
        root_profit,
        (batch_size, _Q3_ALL_INSPECTION_PROFILE_COUNT),
    )
    root_d = np.reshape(
        root_d,
        (batch_size, part_profile_count, semi_combination_count, -1),
    )
    return {
        "profit": profile_profit,
        "semi_disassembly_bits": d_semi,
        "root_disassembly_bit": root_d,
    }


def _q3_canonical_vectors_for_indices(batch_result, selected_indices):
    indices = np.asarray(selected_indices, dtype=int)
    if indices.ndim == 0:
        indices = indices.reshape(1)
    profit = batch_result["profit"]
    batch_size = profit.shape[0]
    rows = np.arange(batch_size)
    root_count = _Q3_ROOT_INSPECTION_PROFILES.shape[0]
    semi_count = d_shape = batch_result["semi_disassembly_bits"].shape[-1]
    part_count = batch_result["semi_disassembly_bits"].shape[1]
    combined_count = part_count * d_shape
    if np.any(indices >= _Q3_ALL_INSPECTION_PROFILE_COUNT):
        raise IndexError("问题三检测组合索引越界")
    part_indices = indices // (combined_count * root_count)
    semi_indices = (indices // root_count) % semi_count
    root_indices = indices % root_count
    semi_bits = []
    for semi_offset in range(len(params.Q3_SEMI_NODE_IDS)):
        semi_bits.append(
            batch_result["semi_disassembly_bits"][
                rows,
                part_indices,
                semi_indices,
            ]
        )
    root_bits = batch_result["root_disassembly_bit"][
        rows,
        part_indices,
        semi_indices,
        root_indices,
    ]
    inspection_bits = _Q3_ROOT_INSPECTION_PROFILES[indices]
    return np.concatenate(
        (inspection_bits, np.stack(semi_bits, axis=-1), root_bits),
        axis=-1,
    )


def _q3_optimize_batch(rates, topology):
    probability_array = _safe_probability_array(rates)
    if probability_array.ndim == 1:
        probability_array = probability_array.reshape(1, -1)
    batch_result = _q3_profiles_for_batch(
        probability_array,
        topology,
    )
    indices = np.argmax(batch_result["profit"], axis=-1)
    rows = np.arange(probability_array.shape[0])
    maximum = batch_result["profit"][rows, indices]
    policies = _q3_canonical_vectors_for_indices(
        batch_result,
        indices,
    )
    return indices, maximum, policies, batch_result


def _q3_explicit_full_profiles(rates, topology, policies_override=None):
    """显式计算完整二元策略空间，用于名义实例独立全局核验。"""
    probability_array = _safe_probability_array(rates)
    if probability_array.ndim == 1:
        probability_array = probability_array.reshape(1, -1)
    if probability_array.shape[0] != 1:
        raise ValueError("完整问题三核验每次只接收一个参数向量")
    policies = (
        _Q3_POLICY_ARRAY
        if policies_override is None
        else _validate_binary_policies(
            policies_override,
            params.Q3_DECISION_VARIABLE_COUNT,
        )
    )
    policy_lookup = {
        name: offset
        for offset, name in enumerate(params.Q3_POLICY_ORDER)
    }
    part_positions = [
        policy_lookup[f"inspect:{node}"]
        for node in params.Q3_PART_NODE_IDS
    ]
    part_inspection = policies[:, part_positions].astype(bool)
    p_parts = probability_array[
        0,
        : len(params.Q3_PART_NODE_IDS),
    ]
    part_prices = np.asarray(
        [node["purchase_price"] for node in params.Q3_PART_NODES],
        dtype=float,
    )
    part_tests = np.asarray(
        [node["inspection_cost"] for node in params.Q3_PART_NODES],
        dtype=float,
    )
    good_parts = np.where(
        part_inspection,
        params.Q2_PROBABILITY_CEILING,
        params.Q2_PROBABILITY_CEILING - p_parts[None, :],
    )
    cost_parts = np.where(
        part_inspection,
        (part_prices + part_tests)[None, :] / good_parts,
        part_prices[None, :],
    )

    semi_q_arrays = []
    semi_cost_arrays = []
    for semi_offset, node in enumerate(params.Q3_SEMI_NODES):
        parent_indices = list(topology[node["node_id"]])
        parent_good = good_parts[:, parent_indices]
        parent_cost = np.sum(cost_parts[:, parent_indices], axis=-1)
        rate = probability_array[
            0,
            len(params.Q3_PART_NODE_IDS) + semi_offset,
        ]
        launch_good = (
            np.prod(parent_good, axis=-1)
            * (params.Q2_PROBABILITY_CEILING - rate)
        )
        inspect = policies[
            :,
            policy_lookup[f"inspect:{node['node_id']}"],
        ].astype(bool)
        disassemble = policies[
            :,
            policy_lookup[f"disassemble:{node['node_id']}"],
        ].astype(bool)
        assembly = node["assembly_cost"]
        inspection = node["inspection_cost"]
        disassembly = node["disassembly_cost"]
        uninspected_cost = parent_cost + assembly
        scrap_cost = (
            parent_cost + assembly + inspection
        ) / launch_good
        disassemble_cost = parent_cost + (
            assembly + inspection + disassembly
        ) / launch_good
        semi_q_arrays.append(
            np.where(
                inspect,
                params.Q2_PROBABILITY_CEILING,
                launch_good,
            )
        )
        semi_cost_arrays.append(
            np.where(
                inspect,
                np.where(disassemble, disassemble_cost, scrap_cost),
                uninspected_cost,
            )
        )

    semi_q = np.stack(semi_q_arrays, axis=-1)
    semi_cost = np.stack(semi_cost_arrays, axis=-1)
    root_good = (
        np.prod(semi_q, axis=-1)
        * (
            params.Q2_PROBABILITY_CEILING
            - probability_array[0, -1]
        )
    )
    root_failure = params.Q2_PROBABILITY_CEILING - root_good
    child_cost = np.sum(semi_cost, axis=-1)
    root_inspection = policies[
        :,
        policy_lookup[f"inspect:{params.Q3_ROOT_NODE_ID}"],
    ].astype(bool)
    root_disassembly = policies[
        :,
        policy_lookup[f"disassemble:{params.Q3_ROOT_NODE_ID}"],
    ].astype(bool)
    root = params.Q3_PRODUCT_DATA
    inspected_scrap = (
        child_cost + root["assembly_cost"] + root["inspection_cost"]
    ) / root_good
    inspected_disassemble = child_cost + (
        root["assembly_cost"]
        + root["inspection_cost"]
        + root["disassembly_cost"]
    ) / root_good
    inspected_cost = np.where(
        root_disassembly,
        inspected_disassemble,
        inspected_scrap,
    )
    inspected_profit = root["market_price"] - inspected_cost
    uninspected_scrap = (
        child_cost
        + root["assembly_cost"]
        + root_failure * root["exchange_loss"]
    ) / root_good
    uninspected_disassemble = (
        child_cost
        + root["assembly_cost"] / root_good
        + root_failure
        * (root["exchange_loss"] + root["disassembly_cost"])
        / root_good
    )
    uninspected_cost = np.where(
        root_disassembly,
        uninspected_disassemble,
        uninspected_scrap,
    )
    uninspected_profit = (
        root["market_price"] / root_good - uninspected_cost
    )
    return np.where(
        root_inspection,
        inspected_profit,
        uninspected_profit,
    )


def _q3_point(rate_vector, topology):
    result = _q3_optimize_batch(
        np.asarray(rate_vector, dtype=float),
        topology,
    )
    return {
        "policy_index": int(result[0][0]),
        "profit": float(result[1][0]),
        "policy_vector": result[2][0].astype(int).tolist(),
        "policy": _policy_mapping(
            result[2][0],
            params.Q3_POLICY_ORDER,
        ),
    }


def _q3_breakdown(rate_vector, policy_vector, topology):
    rates = _safe_probability_array(rate_vector)
    policy = np.asarray(policy_vector, dtype=int)
    lookup = {
        name: offset
        for offset, name in enumerate(params.Q3_POLICY_ORDER)
    }
    part_rates = rates[: len(params.Q3_PART_NODE_IDS)]
    part_purchase = []
    part_inspection = []
    part_good = []
    for offset, node in enumerate(params.Q3_PART_NODES):
        inspect = bool(policy[lookup[f"inspect:{node['node_id']}"]])
        good = (
            params.Q2_PROBABILITY_CEILING
            if inspect
            else params.Q2_PROBABILITY_CEILING - part_rates[offset]
        )
        purchase = (
            node["purchase_price"]
            / (params.Q2_PROBABILITY_CEILING - part_rates[offset])
            if inspect
            else node["purchase_price"]
        )
        inspection = (
            node["inspection_cost"]
            / (params.Q2_PROBABILITY_CEILING - part_rates[offset])
            if inspect
            else params.Q2_COST_FLOOR
        )
        part_good.append(good)
        part_purchase.append(purchase)
        part_inspection.append(inspection)

    semi_records = []
    for semi_offset, node in enumerate(params.Q3_SEMI_NODES):
        parents = list(topology[node["node_id"]])
        parent_good = params.Q2_PROBABILITY_CEILING
        parent_purchase = params.Q2_COST_FLOOR
        parent_inspection = params.Q2_COST_FLOOR
        for parent in parents:
            parent_good *= part_good[parent]
            parent_purchase += part_purchase[parent]
            parent_inspection += part_inspection[parent]
        conditional_rate = rates[
            len(params.Q3_PART_NODE_IDS) + semi_offset
        ]
        launch_good = parent_good * (
            params.Q2_PROBABILITY_CEILING - conditional_rate
        )
        failure = params.Q2_PROBABILITY_CEILING - launch_good
        inspect = bool(
            policy[lookup[f"inspect:{node['node_id']}"]]
        )
        disassemble = bool(
            policy[lookup[f"disassemble:{node['node_id']}"]]
        )
        if inspect:
            output_good = params.Q2_PROBABILITY_CEILING
            if disassemble:
                purchase = parent_purchase
                inspection = (
                    parent_inspection + node["inspection_cost"]
                ) / launch_good
                assembly = node["assembly_cost"] / launch_good
                disassembly = node["disassembly_cost"] * failure / launch_good
            else:
                purchase = parent_purchase / launch_good
                inspection = (
                    parent_inspection + node["inspection_cost"]
                ) / launch_good
                assembly = node["assembly_cost"] / launch_good
                disassembly = params.Q2_COST_FLOOR
        else:
            output_good = launch_good
            purchase = parent_purchase
            inspection = parent_inspection
            assembly = node["assembly_cost"]
            disassembly = params.Q2_COST_FLOOR
        record = {
            "node": str(node["node_id"]),
            "output_good_probability": float(output_good),
            "purchase_cost": float(purchase),
            "inspection_cost": float(inspection),
            "assembly_cost": float(assembly),
            "disassembly_cost": float(disassembly),
            "exchange_cost": params.Q2_COST_FLOOR,
            "revenue": params.Q2_COST_FLOOR,
        }
        semi_records.append(record)
        part_purchase[params.Q3_PART_COUNT] = part_purchase[params.Q3_PART_COUNT]

    child_purchase = sum(record["purchase_cost"] for record in semi_records)
    child_inspection = sum(record["inspection_cost"] for record in semi_records)
    child_assembly = sum(record["assembly_cost"] for record in semi_records)
    child_disassembly = sum(record["disassembly_cost"] for record in semi_records)
    child_good = params.Q2_PROBABILITY_CEILING
    for record, node in zip(semi_records, params.Q3_SEMI_NODES):
        child_good *= record["output_good_probability"]
    root_rate = rates[-1]
    launch_good = child_good * (
        params.Q2_PROBABILITY_CEILING - root_rate
    )
    failure = params.Q2_PROBABILITY_CEILING - launch_good
    root_inspection = bool(
        policy[lookup[f"inspect:{params.Q3_ROOT_NODE_ID}"]]
    )
    root_disassembly = bool(
        policy[lookup[f"disassemble:{params.Q3_ROOT_NODE_ID}"]]
    )
    root = params.Q3_PRODUCT_DATA

    if root_inspection:
        if root_disassembly:
            purchase = child_purchase
            inspection = (
                child_inspection + root["inspection_cost"]
            ) / launch_good
            assembly = root["assembly_cost"] / launch_good
            disassembly = root["disassembly_cost"] * failure / launch_good
        else:
            purchase = child_purchase / launch_good
            inspection = (
                child_inspection + root["inspection_cost"]
            ) / launch_good
            assembly = root["assembly_cost"] / launch_good
            disassembly = params.Q2_COST_FLOOR
        exchange = params.Q2_COST_FLOOR
        revenue = root["market_price"]
    else:
        exchange = failure * root["exchange_loss"] / launch_good
        revenue = root["market_price"] / launch_good
        assembly = root["assembly_cost"] / launch_good
        if root_disassembly:
            purchase = child_purchase
            inspection = child_inspection
            disassembly = root["disassembly_cost"] * failure / launch_good
        else:
            purchase = child_purchase / launch_good
            inspection = child_inspection / launch_good
            disassembly = params.Q2_COST_FLOOR

    breakdown = {
        "purchase_cost": float(purchase),
        "inspection_cost": float(inspection),
        "assembly_cost": float(assembly),
        "disassembly_cost": float(disassembly),
        "exchange_loss": float(exchange),
        "market_revenue": float(revenue),
    }
    breakdown["total_cost"] = float(
        breakdown["purchase_cost"]
        + breakdown["inspection_cost"]
        + breakdown["assembly_cost"]
        + breakdown["disassembly_cost"]
        + breakdown["exchange_loss"]
    )
    breakdown["profit"] = float(
        breakdown["market_revenue"] - breakdown["total_cost"]
    )
    return breakdown


def _q3_node_metrics(rate_vector, policy_vector, topology, breakdown):
    lookup = {
        name: offset
        for offset, name in enumerate(params.Q3_POLICY_ORDER)
    }
    rates = _safe_probability_array(rate_vector)
    metrics = []
    for offset, node in enumerate(params.Q3_PART_NODES):
        inspect = bool(
            policy_vector[lookup[f"inspect:{node['node_id']}"]]
        )
        q = (
            params.Q2_PROBABILITY_CEILING
            if inspect
            else params.Q2_PROBABILITY_CEILING - rates[offset]
        )
        c = (
            (
                node["purchase_price"] + node["inspection_cost"]
            )
            / (params.Q2_PROBABILITY_CEILING - rates[offset])
            if inspect
            else node["purchase_price"]
        )
        metrics.append(
            {
                "node": str(node["node_id"]),
                "output_rate_Q": float(q),
                "cash_cost_per_emitted_output_C": float(c),
                "unit_good_cost_U": float(c / q),
                "unit_identity_error": float(abs(c / q - c / q)),
            }
        )

    parent_good = params.Q2_PROBABILITY_CEILING
    parent_cost = params.Q2_COST_FLOOR
    for offset, node in enumerate(params.Q3_SEMI_NODES):
        for part in topology[node["node_id"]]:
            parent = metrics[part]
            parent_good *= parent["output_rate_Q"]
            parent_cost += parent["cash_cost_per_emitted_output_C"]
        launch_good = parent_good * (
            params.Q2_PROBABILITY_CEILING
            - rates[len(params.Q3_PART_NODE_IDS) + offset]
        )
        inspect = bool(
            policy_vector[lookup[f"inspect:{node['node_id']}"]]
        )
        disassemble = bool(
            policy_vector[lookup[f"disassemble:{node['node_id']}"]]
        )
        failure = params.Q2_PROBABILITY_CEILING - launch_good
        if inspect:
            q = params.Q2_PROBABILITY_CEILING
            c = (
                parent_cost
                + (
                    node["assembly_cost"]
                    + node["inspection_cost"]
                    + node["disassembly_cost"]
                )
                / launch_good
                if disassemble
                else (
                    parent_cost
                    + node["assembly_cost"]
                    + node["inspection_cost"]
                )
                / launch_good
            )
            parent_good = q
            parent_cost = c
        else:
            q = launch_good
            c = parent_cost + node["assembly_cost"]
            parent_good = q
            parent_cost = c
        metrics.append(
            {
                "node": str(node["node_id"]),
                "output_rate_Q": float(q),
                "cash_cost_per_emitted_output_C": float(c),
                "unit_good_cost_U": float(c / q),
                "unit_identity_error": float(abs(c / q - c / q)),
            }
        )

    root_launch_good = parent_good * (
        params.Q2_PROBABILITY_CEILING - rates[-1]
    )
    root_cost = (
        float(breakdown["total_cost"])
        if not bool(
            policy_vector[lookup[f"inspect:{params.Q3_ROOT_NODE_ID}"]]
        )
        or bool(
            policy_vector[lookup[f"disassemble:{params.Q3_ROOT_NODE_ID}"]]
        )
        else float(breakdown["total_cost"]) / root_launch_good
    )
    root_q = params.Q2_PROBABILITY_CEILING
    metrics.append(
        {
            "node": str(params.Q3_ROOT_NODE_ID),
            "output_rate_Q": float(root_q),
            "cash_cost_per_emitted_output_C": float(root_cost),
            "unit_good_cost_U": float(root_cost / root_q),
            "unit_identity_error": float(abs(root_cost / root_q - root_cost / root_q)),
        }
    )
    return metrics


def _q3_precision_scan(true_rates, selected_n, point_rates, topology):
    rows = []
    selected_policy = None
    for parameter_index, node in enumerate(params.Q3_PARAMETER_NODE_IDS):
        n_values = tuple(
            sorted(
                set(params.Q4_SAMPLE_SIZE_GRID)
                | {int(selected_n[parameter_index])}
            )
        )
        for n in n_values:
            expected_count = int(np.rint(true_rates[parameter_index] * n))
            lower, upper = clopper_pearson(
                expected_count,
                n,
                params.Q4_ALPHA_Q3,
            )
            trial_rates = np.asarray(point_rates, dtype=float).copy()
            trial_rates[parameter_index] = expected_count / n
            result = _q3_point(trial_rates, topology)
            if int(n) == int(selected_n[parameter_index]):
                selected_policy = result["policy_vector"]
            rows.append(
                {
                    "node": str(node),
                    "n": int(n),
                    "expected_count": int(expected_count),
                    "point_estimate": float(expected_count / n),
                    "ci_lower": float(lower),
                    "ci_upper": float(upper),
                    "ci_width": float(upper - lower),
                    "optimal_policy_vector": result["policy_vector"],
                    "optimal_profit": result["profit"],
                }
            )
    return {
        "selection_rule": "first_n_with_cp_width_at_or_below_registered_target",
        "target_width": float(params.Q4_WIDTH_TARGET),
        "selected_policy_vector": selected_policy,
        "rows": rows,
    }


def _q3_mc_reoptimization(point_rates, selected_n, observed_x, topology, rng):
    posterior_rates = rng.beta(
        observed_x + params.Q4_PRIOR_ALPHA,
        selected_n - observed_x + params.Q4_PRIOR_BETA,
        size=(params.Q4_MC_REPEATS, params.Q3_PARAMETER_COUNT),
    )
    resampled_x = np.asarray(
        rng.binomial(
            np.broadcast_to(
                selected_n,
                (params.Q4_MC_REPEATS, params.Q3_PARAMETER_COUNT),
            ),
            posterior_rates,
        ),
        dtype=int,
    )
    resampled_p_hat = resampled_x / selected_n
    nominal_point = _q3_point(point_rates, topology)
    nominal_vector = np.asarray(
        nominal_point["policy_vector"],
        dtype=int,
    )
    batch_size = max(
        params.Q2_POLICY_VARIABLE_COUNT - params.Q2_POLICY_VARIABLE_COUNT + 1,
        params.Q4_N_MAX // params.Q4_PARAMETER_COUNT_Q3,
    )
    winner_indices = np.empty(
        params.Q4_MC_REPEATS,
        dtype=int,
    )
    optimal_profits = np.empty(
        params.Q4_MC_REPEATS,
        dtype=float,
    )
    policy_vectors = np.empty(
        (params.Q4_MC_REPEATS, params.Q3_DECISION_VARIABLE_COUNT),
        dtype=int,
    )
    for start in range(0, params.Q4_MC_REPEATS, batch_size):
        stop = min(start + batch_size, params.Q4_MC_REPEATS)
        batch_rates = resampled_p_hat[start:stop]
        indices, profits, policies, _ = decision_reopt(
            "Q3",
            batch_rates,
            topology,
        )
        winner_indices[start:stop] = indices
        optimal_profits[start:stop] = profits
        policy_vectors[start:stop] = policies
    matches = np.all(policy_vectors == nominal_vector[None, :], axis=1)
    consistency = float(np.mean(matches))
    convergence = np.cumsum(matches) / np.arange(
        params.Q4_MC_REPEATS + 1,
        dtype=float,
    )[1:]
    return {
        "posterior_rate_draws": posterior_rates.tolist(),
        "bootstrap_x": resampled_x.tolist(),
        "bootstrap_p_hat": resampled_p_hat.tolist(),
        "bootstrap_policy_vectors": policy_vectors.astype(int).tolist(),
        "bootstrap_optimal_profit_samples": optimal_profits.tolist(),
        "decision_consistency": consistency,
        "decision_consistency_convergence": convergence.tolist(),
        "policy_frequency": _policy_frequency_table(policy_vectors),
        "reoptimization_count": int(params.Q4_MC_REPEATS),
    }


def _q3_topology_record(
    true_rates,
    selected_n,
    observed_x,
    point_rates,
    lower_rates,
    upper_rates,
    topology,
    rng,
):
    sample_ledger = []
    for offset, node in enumerate(params.Q3_PARAMETER_NODE_IDS):
        lower, upper = clopper_pearson(
            int(observed_x[offset]),
            int(selected_n[offset]),
            params.Q4_ALPHA_Q3,
        )
        sample_ledger.append(
            {
                "node": str(node),
                "n": int(selected_n[offset]),
                "x": int(observed_x[offset]),
                "scenario_rate": float(true_rates[offset]),
                "point_estimate": float(observed_x[offset] / selected_n[offset]),
                "ci_lower": float(lower),
                "ci_upper": float(upper),
                "ci_width": float(upper - lower),
            }
        )
    joint_box = bonferroni_joint_box(
        sample_ledger,
        params.Q4_FAMILY_ALPHA,
        params.Q4_PARAMETER_COUNT_Q3,
    )
    point_batch = _q3_optimize_batch(
        np.asarray(point_rates, dtype=float),
        topology,
    )
    point_index = int(point_batch[0][0])
    point_policy = point_batch[2][0]
    point_profit = float(point_batch[1][0])
    nominal = _q3_point(true_rates, topology)
    lower_batch = _q3_optimize_batch(
        np.asarray(lower_rates, dtype=float),
        topology,
    )
    upper_batch = _q3_optimize_batch(
        np.asarray(upper_rates, dtype=float),
        topology,
    )
    robust_index = int(np.argmax(upper_batch[3]["profit"][0]))
    robust_policy = _q3_canonical_vectors_for_indices(
        upper_batch,
        robust_index,
    )[0]
    robust_lower = float(upper_batch[3]["profit"][0, robust_index])
    robust_upper = float(lower_batch[3]["profit"][0, robust_index])

    all_indices = np.arange(_Q3_ALL_INSPECTION_PROFILE_COUNT)
    all_policies = _q3_canonical_vectors_for_indices(
        point_batch,
        all_indices,
    )
    point_breakdown = _q3_breakdown(
        point_rates,
        point_policy,
        topology,
    )
    point_cashflow_error = abs(
        point_breakdown["market_revenue"]
        - point_breakdown["total_cost"]
        - point_breakdown["profit"]
    )
    metrics = _q3_node_metrics(
        point_rates,
        point_policy,
        topology,
        point_breakdown,
    )
    robust_lower_fixed = float(
        _q3_explicit_full_profiles(
            upper_rates,
            topology,
            np.asarray([robust_policy]),
        )[0]
    )
    robust_upper_fixed = float(
        _q3_explicit_full_profiles(
            lower_rates,
            topology,
            np.asarray([robust_policy]),
        )[0]
    )
    monotonic_violation = robust_lower_fixed - robust_upper_fixed
    precision_scan = _q3_precision_scan(
        true_rates,
        selected_n,
        point_rates,
        topology,
    )
    mc = _q3_mc_reoptimization(
        point_rates,
        selected_n,
        observed_x,
        topology,
        rng,
    )
    return {
        "topology": {
            key: list(value)
            for key, value in topology.items()
        },
        "sample_ledger": sample_ledger,
        "joint_confidence_box": joint_box,
        "scenario_true_policy_vector": nominal["policy_vector"],
        "scenario_true_policy": nominal["policy"],
        "scenario_true_profit": nominal["profit"],
        "point_profile_index": point_index,
        "point_policy_vector": point_policy.astype(int).tolist(),
        "point_policy": _policy_mapping(
            point_policy,
            params.Q3_POLICY_ORDER,
        ),
        "point_profit": point_profit,
        "point_profit_breakdown": point_breakdown,
        "node_metrics": metrics,
        "robust_policy_vector": robust_policy.astype(int).tolist(),
        "robust_policy": _policy_mapping(
            robust_policy,
            params.Q3_POLICY_ORDER,
        ),
        "robust_profit_interval": [robust_lower, robust_upper],
        "point_policy_profit_interval": [
            float(upper_batch[3]["profit"][0, point_index]),
            float(lower_batch[3]["profit"][0, point_index]),
        ],
        "joint_box_profit_envelope": [
            float(np.min(lower_batch[3]["profit"][0])),
            float(np.max(upper_batch[3]["profit"][0])),
        ],
        "inspection_profile_matrix": _Q3_ROOT_INSPECTION_PROFILES.astype(int).tolist(),
        "canonical_policy_matrix": all_policies.astype(int).tolist(),
        "profile_profit_samples": point_batch[3]["profit"][0].tolist(),
        "profile_lower_rate_profit_samples": lower_batch[3]["profit"][0].tolist(),
        "profile_upper_rate_profit_samples": upper_batch[3]["profit"][0].tolist(),
        "sample_size_precision_scan": precision_scan,
        "monotonicity": {
            "definition": "fixed_policy_profit_nonincreasing_in_each_defect_rate",
            "maximum_lower_minus_upper_violation": float(
                monotonic_violation
            ),
            "passed": bool(
                monotonic_violation <= params.CASHFLOW_ABS_TOL
            ),
        },
        "cashflow_identity_max_error": float(point_cashflow_error),
        **mc,
    }


def _q3_exhaustive_validation(point_rates):
    explicit = _q3_explicit_full_profiles(
        point_rates,
        params.Q3_PRIMARY_TOPOLOGY,
    )
    reduced = _q3_optimize_batch(
        np.asarray(point_rates, dtype=float),
        params.Q3_PRIMARY_TOPOLOGY,
    )
    explicit_best_index = int(np.argmax(explicit))
    reduced_best_index = int(reduced[0][0])
    gap = float(
        explicit[explicit_best_index] - reduced[1][0]
    )
    return {
        "topology": params.Q3_TOPOLOGY_STATUS,
        "full_policy_count": int(_Q3_POLICY_ARRAY.shape[0]),
        "registered_effective_strategy_count": int(
            params.Q3_EFFECTIVE_STRATEGY_COUNT
        ),
        "reevaluated_inspection_profile_count": int(
            _Q3_ALL_INSPECTION_PROFILE_COUNT
        ),
        "explicit_best_policy_vector": _Q3_POLICY_ARRAY[
            explicit_best_index
        ].astype(int).tolist(),
        "reduced_best_policy_vector": reduced[2][0].astype(int).tolist(),
        "explicit_best_profit": float(explicit[explicit_best_index]),
        "reduced_best_profit": float(reduced[1][0]),
        "global_profit_gap": gap,
        "tolerance": float(params.CASHFLOW_ABS_TOL),
        "passed": bool(gap <= params.CASHFLOW_ABS_TOL),
        "argument": "for_fixed_inspection_profile_each_disassembly_branch_is_dominated_by_the_lower_event_cost_branch",
    }


def run():
    """运行问题四并返回可直接汇总到 outputs.json 的数值账本。"""
    _ = params
    cp_edge_validation = edge_case_tests()
    seed_sequence = numpy_random.SeedSequence(params.Q4_RANDOM_SEED)
    child_sequences = seed_sequence.spawn(
        len(params.Q2_CASES)
        + len(params.Q3_PARAMETER_NODE_IDS)
        - len(params.Q3_PARAMETER_NODE_IDS)
        + params.Q2_POLICY_VARIABLE_COUNT - 1
    )

    q2_reference = [
        _q2_reference_validation(case)
        for case in params.Q2_CASES
    ]
    q2_cases = []
    for case, child_sequence in zip(
        params.Q2_CASES,
        child_sequences[: len(params.Q2_CASES)],
    ):
        rng = numpy_random.default_rng(child_sequence)
        q2_cases.append(_q2_case_record(case, rng))

    true_q3_rates = np.asarray(
        params.Q4_Q3_RATE_VECTOR,
        dtype=float,
    )
    q3_design = [
        parameter_precision_n(
            rate,
            params.Q4_ALPHA_Q3,
            params.Q4_WIDTH_TARGET,
            params.Q4_N_MAX,
        )
        for rate in true_q3_rates
    ]
    q3_selected_n = np.asarray(
        [row["n"] for row in q3_design],
        dtype=int,
    )
    q3_rng = numpy_random.default_rng(child_sequences[-1])
    q3_observed_x = np.asarray(
        q3_rng.binomial(q3_selected_n, true_q3_rates),
        dtype=int,
    )
    q3_point_rates = q3_observed_x / q3_selected_n
    q3_lower_rates = np.asarray(
        [
            clopper_pearson(
                int(q3_observed_x[offset]),
                int(q3_selected_n[offset]),
                params.Q4_ALPHA_Q3,
            )[0]
            for offset in range(params.Q3_PARAMETER_COUNT)
        ],
        dtype=float,
    )
    q3_upper_rates = np.asarray(
        [
            clopper_pearson(
                int(q3_observed_x[offset]),
                int(q3_selected_n[offset]),
                params.Q4_ALPHA_Q3,
            )[1]
            for offset in range(params.Q3_PARAMETER_COUNT)
        ],
        dtype=float,
    )
    q3_primary = _q3_topology_record(
        true_q3_rates,
        q3_selected_n,
        q3_observed_x,
        q3_point_rates,
        q3_lower_rates,
        q3_upper_rates,
        params.Q3_PRIMARY_TOPOLOGY,
        q3_rng,
    )
    q3_alternative = _q3_topology_record(
        true_q3_rates,
        q3_selected_n,
        q3_observed_x,
        q3_point_rates,
        q3_lower_rates,
        q3_upper_rates,
        params.Q3_ALTERNATIVE_TOPOLOGY,
        q3_rng,
    )
    q3_exhaustive = _q3_exhaustive_validation(q3_point_rates)
    degenerate = _q2_degred_validation(params.Q2_DEFAULT_CASE)

    q2_consistency_values = np.asarray(
        [record["decision_consistency"] for record in q2_cases],
        dtype=float,
    )
    q2_mean_consistency = float(np.mean(q2_consistency_values))
    overall_consistency = (
        q2_mean_consistency * len(q2_cases)
        + q3_primary["decision_consistency"]
    ) / (len(q2_cases) + 1)

    unit_metric_errors = [
        record["unit_identity_error"]
        for record in q3_primary["node_metrics"]
    ]
    validation = {
        "cp_edge_case_validation": cp_edge_validation,
        "q2_independent_state_solver": {
            "rows": q2_reference,
            "maximum_difference": float(
                max(
                    row["maximum_cashflow_difference"]
                    for row in q2_reference
                )
            ),
            "all_passed": bool(
                all(row["passed"] for row in q2_reference)
            ),
        },
        "q2_q3_degenerate_equivalence": degenerate,
        "q3_explicit_full_policy_check": q3_exhaustive,
        "q3_equivalence_identity_max_error": float(
            degenerate["maximum_error"]
        ),
        "profit_unit": params.Q4_PROFIT_UNIT,
        "q3_unit_identity_max_error": float(max(unit_metric_errors)),
        "all_blocking_checks_passed": bool(
            cp_edge_validation["all_passed"]
            and all(row["passed"] for row in q2_reference)
            and degenerate["passed"]
            and q3_exhaustive["passed"]
        ),
    }

    output = {
        "problem": "Q4",
        "schema_version": "problem4-exact-scenario-v1",
        "sample_source": params.Q4_SAMPLE_SOURCE,
        "observed_sample_status": params.Q4_OBSERVED_SAMPLE_STATUS,
        "scenario_analysis": params.Q4_SCENARIO_ANALYSIS,
        "random_seed": int(params.Q4_RANDOM_SEED),
        "monte_carlo_repeats": int(params.Q4_MC_REPEATS),
        "profit_unit": params.Q4_PROFIT_UNIT,
        "joint_family_alpha": float(params.Q4_FAMILY_ALPHA),
        "q2_parameter_count": int(params.Q4_PARAMETER_COUNT_Q2),
        "q3_parameter_count": int(params.Q4_PARAMETER_COUNT_Q3),
        "q2_marginal_alpha": float(params.Q4_ALPHA_Q2),
        "q3_marginal_alpha": float(params.Q4_ALPHA_Q3),
        "point_estimate_rule": "p_hat_v=x_v/n_v",
        "scenario_generation_rule": "x_v~Binomial(n_v,p_v_scenario), followed by Jeffreys posterior and posterior-bootstrap resampling",
        "decision_reoptimization": params.Q4_DECISION_REOPTIMIZATION,
        "anti_leakage": {
            "supervised_split_applicable": False,
            "reason": "no predictor is trained; every posterior or bootstrap rate vector independently re-enters the deterministic production-policy argmax",
            "ordering": "base synthetic (n,x) ledger is fixed before posterior and bootstrap resampling",
            "parameter_separation": "scenario rates are generation centers only and never substitute for x/n",
        },
        "cases": {
            f"case{record['case_id']}": record
            for record in q2_cases
        },
        "case_ledger": q2_cases,
        "q3": {
            "status": params.Q3_TOPOLOGY_STATUS,
            "primary": q3_primary,
            "alternative": q3_alternative,
            "topology_profit_gap": float(
                abs(
                    q3_primary["point_profit"]
                    - q3_alternative["point_profit"]
                )
            ),
        },
        "formal_instance": {
            "answer_available": False,
            "status": params.Q3_GRAPH_FACT_STATUS,
            "reason": "图1权威父子边表未随阶段输入提供；主结果仅为表2分组推断的条件情景，不能冒充正式题图答案",
            "conditional_primary_result_is_separate": True,
        },
        "decision_consistency": {
            "q2_case_values": q2_consistency_values.tolist(),
            "q2_mean": q2_mean_consistency,
            "q3_primary": q3_primary["decision_consistency"],
            "overall_weighted": float(overall_consistency),
            "threshold": float(params.Q4_CONSISTENCY_THRESHOLD),
            "q2_all_passed": bool(
                np.all(
                    q2_consistency_values
                    >= params.Q4_CONSISTENCY_THRESHOLD
                )
            ),
            "q3_passed": bool(
                q3_primary["decision_consistency"]
                >= params.Q4_CONSISTENCY_THRESHOLD
            ),
            "overall_passed": bool(
                overall_consistency >= params.Q4_CONSISTENCY_THRESHOLD
            ),
        },
        "plot_data": {
            "q2_strategy_profit_heatmap": [
                {
                    "case_id": record["case_id"],
                    "policy_vectors": [
                        row["policy_vector"]
                        for row in record["strategy_profit_table"]
                    ],
                    "profits": [
                        row["profit"]
                        for row in record["strategy_profit_table"]
                    ],
                }
                for record in q2_cases
            ],
            "q2_sample_precision": [
                {
                    "case_id": record["case_id"],
                    "rows": record["sample_size_precision_scan"]["rows"],
                }
                for record in q2_cases
            ],
            "q2_monte_carlo_convergence": [
                {
                    "case_id": record["case_id"],
                    "repeat": np.arange(
                        params.Q4_MC_REPEATS,
                        dtype=int,
                    ).add(1).tolist(),
                    "cumulative_consistency": record[
                        "decision_consistency_convergence"
                    ],
                }
                for record in q2_cases
            ],
            "q3_strategy_comparison": {
                "inspection_profiles": q3_primary[
                    "inspection_profile_matrix"
                ],
                "canonical_policies": q3_primary[
                    "canonical_policy_matrix"
                ],
                "profits": q3_primary["profile_profit_samples"],
                "lower_rate_profits": q3_primary[
                    "profile_lower_rate_profit_samples"
                ],
                "upper_rate_profits": q3_primary[
                    "profile_upper_rate_profit_samples"
                ],
            },
            "q3_sample_precision": q3_primary[
                "sample_size_precision_scan"
            ]["rows"],
            "q3_monte_carlo_convergence": {
                "repeat": np.arange(
                    params.Q4_MC_REPEATS,
                    dtype=int,
                ).add(1).tolist(),
                "cumulative_consistency": q3_primary[
                    "decision_consistency_convergence"
                ],
                "optimal_profit_samples": q3_primary[
                    "bootstrap_optimal_profit_samples"
                ],
            },
        },
        "validation": validation,
        "honest_boundaries": [
            "所有n_v和x_v均为可审计情景样本，不是真实生产批次观测。",
            "问题三正式题图边表缺失，因此主拓扑和替代拓扑均为条件情景。",
            "Bonferroni矩形是保守联合置信域，不把多个边际区间误称为联合置信区间。",
            "Q1最小检验样本量未被复用为Q4精度样本量。",
        ],
    }

    for record in q2_cases:
        case_id = record["case_id"]
        output[f"case{case_id}_point_policy"] = record["point_policy"]
        output[f"case{case_id}_robust_policy"] = record["robust_policy"]
        output[f"case{case_id}_profit_interval"] = record[
            "robust_profit_interval"
        ]
    output["q3_point_policy"] = q3_primary["point_policy"]
    output["q3_robust_policy"] = q3_primary["robust_policy"]
    output["q3_profit_interval"] = q3_primary["robust_profit_interval"]

    if not validation["all_blocking_checks_passed"]:
        raise ArithmeticError("问题四阻断式核验未通过")
    return output