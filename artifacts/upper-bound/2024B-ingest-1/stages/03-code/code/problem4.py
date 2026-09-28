from __future__ import annotations

import itertools
import json
import math
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import scipy.stats as scipy_stats

import params as _params
from params import *


_MISSING = object()
_STATE_EMPTY = 0
_STATE_GOOD = 1
_STATE_BAD = -1
_Q2_POLICIES = tuple(itertools.product((0, 1), repeat=4))


def _required_param(module: Any, *names: str) -> Any:
    for name in names:
        if hasattr(module, name):
            value = getattr(module, name)
            if value is not None:
                return value
    joined = ", ".join(names)
    raise AttributeError(f"params 中缺少必需登记项: {joined}")


def _optional_param(module: Any, *names: str) -> Any:
    for name in names:
        if hasattr(module, name):
            return getattr(module, name)
    return None


def _field(value: Any, names: tuple[str, ...], default: Any = _MISSING) -> Any:
    if isinstance(value, Mapping):
        for name in names:
            if name in value:
                return value[name]
    for name in names:
        if hasattr(value, name):
            return getattr(value, name)
    if default is not _MISSING:
        return default
    raise AttributeError(f"对象缺少字段: {', '.join(names)}")


def _float_field(value: Any, names: tuple[str, ...], default: Any = _MISSING) -> float:
    return float(_field(value, names, default))


def _iter_case_items(raw_cases: Any) -> list[tuple[Any, Any]]:
    if isinstance(raw_cases, Mapping):
        return list(raw_cases.items())
    return list(enumerate(raw_cases))


def _part_object(raw: Any, index: int, prefix: str) -> Any:
    parts = _field(raw, ("parts", "零配件", "part_inputs"), None)
    if parts is not None and not isinstance(parts, Mapping):
        return parts[index]
    return raw


def _normalize_q2_case(raw: Any, key: Any, index: int) -> dict[str, Any]:
    part1 = _part_object(raw, 0, "part1")
    part2 = _part_object(raw, 1, "part2")
    product = _field(raw, ("product", "final_product", "成品", "final"), raw)

    case_id = str(_field(raw, ("id", "case", "case_id", "情形"), f"case_{index}"))
    if key is not None and not isinstance(key, int):
        case_id = str(key)

    normalized = {
        "id": case_id,
        "p1": _float_field(
            part1,
            (
                "p1",
                "defect_rate",
                "defect_probability",
                "part1_defect_rate",
                "part1_p",
                "零配件1次品率",
            ),
        ),
        "p2": _float_field(
            part2,
            (
                "p2",
                "defect_rate",
                "defect_probability",
                "part2_defect_rate",
                "part2_p",
                "零配件2次品率",
            ),
        ),
        "pf": _float_field(
            product,
            (
                "pf",
                "p_final",
                "product_defect_rate",
                "final_defect_rate",
                "defect_rate",
                "成品次品率",
            ),
        ),
        "a1": _float_field(
            part1,
            (
                "a1",
                "purchase_price",
                "purchase_cost",
                "price",
                "part1_purchase_price",
                "零配件1购买单价",
            ),
        ),
        "t1": _float_field(
            part1,
            (
                "t1",
                "inspection_cost",
                "test_cost",
                "part1_inspection_cost",
                "零配件1检测成本",
            ),
        ),
        "a2": _float_field(
            part2,
            (
                "a2",
                "purchase_price",
                "purchase_cost",
                "price",
                "part2_purchase_price",
                "零配件2购买单价",
            ),
        ),
        "t2": _float_field(
            part2,
            (
                "t2",
                "inspection_cost",
                "test_cost",
                "part2_inspection_cost",
                "零配件2检测成本",
            ),
        ),
        "kf": _float_field(
            product,
            (
                "kf",
                "assembly_cost",
                "product_assembly_cost",
                "final_assembly_cost",
                "成品装配成本",
            ),
        ),
        "tf": _float_field(
            product,
            (
                "tf",
                "inspection_cost",
                "product_inspection_cost",
                "final_inspection_cost",
                "成品检测成本",
            ),
        ),
        "market": _float_field(
            raw,
            (
                "market",
                "market_price",
                "sale_price",
                "r_market",
                "市场售价",
            ),
        ),
        "exchange": _float_field(
            raw,
            (
                "exchange",
                "exchange_loss",
                "L_exchange",
                "调换损失",
            ),
        ),
        "disassembly": _float_field(
            raw,
            (
                "disassembly",
                "disassembly_cost",
                "g_dis",
                "拆解费用",
            ),
        ),
    }

    for name in ("p1", "p2", "pf"):
        if not 0 <= normalized[name] <= 1:
            raise ValueError(f"{case_id}: {name} 不在概率域内")
    for name in ("a1", "t1", "a2", "t2", "kf", "tf", "exchange", "disassembly"):
        if normalized[name] < 0:
            raise ValueError(f"{case_id}: {name} 为负成本")
    return normalized


def normalize_q2_cases(module: Any) -> list[dict[str, Any]]:
    raw_cases = _required_param(
        module,
        "Q2_CASES",
        "TABLE1_CASES",
        "PROBLEM2_CASES",
        "Q2_TABLE1_CASES",
        "问题二表1情形",
    )
    return [
        _normalize_q2_case(raw, key, index)
        for index, (key, raw) in enumerate(_iter_case_items(raw_cases))
    ]


def _q2_policy_payload(policy: tuple[int, int, int, int]) -> dict[str, Any]:
    z1, z2, inspect_final, disassemble = (int(value) for value in policy)
    return {
        "Z1": z1,
        "Z2": z2,
        "C": inspect_final,
        "D": disassemble,
        "vector": [z1, z2, inspect_final, disassemble],
        "label": f"Z1={z1},Z2={z2},C={inspect_final},D={disassemble}",
    }


def _q2_rates(params: Mapping[str, Any]) -> tuple[float, float, float]:
    return float(params["p1"]), float(params["p2"]), float(params["pf"])


def _q2_good_probability(
    params: Mapping[str, Any], policy: tuple[int, int, int, int]
) -> float:
    p1, p2, pf = _q2_rates(params)
    q1 = 1 if policy[0] else 1 - p1
    q2 = 1 if policy[1] else 1 - p2
    return q1 * q2 * (1 - pf)


def _q2_d1_feasible(
    params: Mapping[str, Any], policy: tuple[int, int, int, int]
) -> tuple[bool, str]:
    p1, p2, pf = _q2_rates(params)
    screened1 = bool(policy[0]) or p1 == 0
    screened2 = bool(policy[1]) or p2 == 0
    screen_possible1 = (not policy[0]) or p1 < 1
    screen_possible2 = (not policy[1]) or p2 < 1
    if not (screened1 and screened2 and screen_possible1 and screen_possible2 and pf < 1):
        return (
            False,
            "D=1 会把未受检且可能不合格的零件原样回流，固定策略下存在非吸收闭环",
        )
    return True, "D=1 回流件均可被后续固定规则消除"


def _q2_build_mrp(
    params: Mapping[str, Any], policy: tuple[int, int, int, int]
) -> dict[str, Any]:
    p1, p2, pf = _q2_rates(params)
    states = [
        (left, right)
        for left in (_STATE_EMPTY, _STATE_GOOD, _STATE_BAD)
        for right in (_STATE_EMPTY, _STATE_GOOD, _STATE_BAD)
    ]
    state_index = {state: index for index, state in enumerate(states)}
    transitions: list[dict[tuple[int, int], float]] = [dict() for _ in states]
    rewards = [np.zeros(len(states), dtype=float) for _ in states]

    def add(index: int, next_state: tuple[int, int], probability: float, reward: float) -> None:
        if probability == 0:
            return
        transitions[index][next_state] = transitions[index].get(next_state, 0) + probability
        rewards[index][state_index[next_state]] += probability * reward

    for index, state in enumerate(states):
        left, right = state

        if left == _STATE_EMPTY:
            if policy[0]:
                good_probability = 1 - p1
                if good_probability > 0:
                    expected_cost = (params["a1"] + params["t1"]) / good_probability
                    add(index, (_STATE_GOOD, right), 1, -expected_cost)
            else:
                add(index, (_STATE_GOOD, right), 1 - p1, -params["a1"])
                add(index, (_STATE_BAD, right), p1, -params["a1"])
            continue

        if left == _STATE_BAD and policy[0]:
            add(index, (_STATE_EMPTY, right), 1, -params["t1"])
            continue

        if right == _STATE_EMPTY:
            if policy[1]:
                good_probability = 1 - p2
                if good_probability > 0:
                    expected_cost = (params["a2"] + params["t2"]) / good_probability
                    add(index, (left, _STATE_GOOD), 1, -expected_cost)
            else:
                add(index, (left, _STATE_GOOD), 1 - p2, -params["a2"])
                add(index, (left, _STATE_BAD), p2, -params["a2"])
            continue

        if right == _STATE_BAD and policy[1]:
            add(index, (left, _STATE_EMPTY), 1, -params["t2"])
            continue

        assembly_reward = -params["kf"]
        if policy[2]:
            assembly_reward -= params["tf"]

        defective_probability = pf if left == _STATE_GOOD and right == _STATE_GOOD else 1
        if defective_probability == 0:
            add(index, state, 1, assembly_reward + params["market"])
            continue

        failure_reward = assembly_reward
        if not policy[2]:
            failure_reward += params["market"] - params["exchange"]

        if policy[3]:
            add(
                index,
                state,
                defective_probability,
                failure_reward - params["disassembly"],
            )
        else:
            add(
                index,
                (_STATE_EMPTY, _STATE_EMPTY),
                defective_probability,
                failure_reward,
            )

        good_probability = 1 - defective_probability
        if good_probability > 0:
            add(index, state, good_probability, assembly_reward + params["market"])

    transition_matrix = np.zeros((len(states), len(states)), dtype=float)
    reward_matrix = np.zeros(len(states), dtype=float)
    for index, mapping in enumerate(transitions):
        for next_state, probability in mapping.items():
            transition_matrix[index, state_index[next_state]] = probability
        reward_matrix[index] = rewards[index]

    return {
        "states": states,
        "state_index": state_index,
        "P": transition_matrix,
        "r": reward_matrix,
        "start": state_index[(_STATE_EMPTY, _STATE_EMPTY)],
    }


def _q2_mrp_value(
    params: Mapping[str, Any], policy: tuple[int, int, int, int]
) -> dict[str, Any]:
    good_probability = _q2_good_probability(params, policy)
    if good_probability <= 0:
        raise ValueError("固定策略不存在正概率的最终合格交付")

    d1_feasible, absorption_reason = _q2_d1_feasible(params, policy)
    if policy[3] and not d1_feasible:
        raise ValueError(absorption_reason)

    mrp = _q2_build_mrp(params, policy)
    identity = np.eye(len(mrp["states"]), dtype=float)
    system = identity - mrp["P"]
    value = np.linalg.solve(system, mrp["r"])
    fundamental = np.linalg.inv(system)
    event_ledger_value = float(fundamental[mrp["start"]] @ mrp["r"])
    residual = system @ value - mrp["r"]

    reachable = {mrp["start"]}
    frontier = {mrp["start"]}
    while frontier:
        following: set[int] = set()
        for index in frontier:
            for next_index in np.flatnonzero(mrp["P"][index] > 0):
                next_index_int = int(next_index)
                if next_index_int not in reachable:
                    reachable.add(next_index_int)
                    following.add(next_index_int)
        frontier = following

    return {
        "value": float(value[mrp["start"]]),
        "event_ledger_value": event_ledger_value,
        "ledger_gap": abs(float(value[mrp["start"]]) - event_ledger_value),
        "bellman_residual": float(np.max(np.abs(residual))),
        "absorption_probability": float(fundamental[mrp["start"]].sum()),
        "reachable_state_count": len(reachable),
        "d1_absorption_reason": absorption_reason,
    }


def _q2_formula_value(
    params: Mapping[str, Any], policy: tuple[int, int, int, int]
) -> dict[str, Any]:
    p1, p2, pf = _q2_rates(params)
    q1 = 1 - p1
    q2 = 1 - p2
    qf = 1 - pf

    if policy[0] and q1 <= 0:
        return {"feasible": False, "profit": -np.inf, "reason": "零配件1检测永不得到合格件"}
    if policy[1] and q2 <= 0:
        return {"feasible": False, "profit": -np.inf, "reason": "零配件2检测永不得到合格件"}

    part1_cost = (params["a1"] + params["t1"]) / q1 if policy[0] else params["a1"]
    part2_cost = (params["a2"] + params["t2"]) / q2 if policy[1] else params["a2"]
    preparation_cost = part1_cost + part2_cost
    prepared_good_probability = (1 if policy[0] else q1) * (1 if policy[1] else q2)
    root_good_probability = prepared_good_probability * qf
    root_launch_cost = params["kf"] + (params["tf"] if policy[2] else 0)

    if root_good_probability <= 0:
        return {"feasible": False, "profit": -np.inf, "reason": "最终合格交付概率为零"}

    d0_profit = (
        params["market"]
        - preparation_cost
        - root_launch_cost
        - (0 if policy[2] else (1 - root_good_probability) * params["exchange"])
    ) / root_good_probability

    d1_feasible, reason = _q2_d1_feasible(params, policy)
    if d1_feasible:
        d1_profit = (
            params["market"] / qf
            - preparation_cost
            - (
                params["kf"]
                + (params["tf"] if policy[2] else 0)
                + (1 - qf)
                * (params["disassembly"] + (0 if policy[2] else params["exchange"]))
            )
            / qf
        )
    else:
        d1_profit = -np.inf

    if d1_feasible and d1_profit > d0_profit:
        selected = 1
        profit = d1_profit
    else:
        selected = 0
        profit = d0_profit

    return {
        "feasible": True,
        "profit": float(profit),
        "selected_policy": (int(policy[0]), int(policy[1]), int(policy[2]), selected),
        "Q_root": float(root_good_probability),
        "C_first_launch": float(preparation_cost + root_launch_cost),
        "U_root": float((preparation_cost + root_launch_cost) / root_good_probability),
        "d0_profit": float(d0_profit),
        "d1_profit": None if not np.isfinite(d1_profit) else float(d1_profit),
        "d1_feasible": d1_feasible,
        "d1_reason": reason,
    }


def enumerate_q2(
    params: Mapping[str, Any], tolerance: float
) -> dict[str, Any]:
    table: list[dict[str, Any]] = []
    finite: list[tuple[float, tuple[int, int, int, int], dict[str, Any]]] = []

    for policy in _Q2_POLICIES:
        formula = _q2_formula_value(params, policy)
        row: dict[str, Any] = {
            "policy": _q2_policy_payload(policy),
            "feasible": bool(formula["feasible"]),
            "reason": formula.get("reason"),
        }
        if formula["feasible"]:
            mrp = _q2_mrp_value(params, policy)
            row.update(
                {
                    "profit": mrp["value"],
                    "formula_profit": formula["profit"],
                    "formula_bellman_gap": abs(mrp["value"] - formula["profit"]),
                    "event_ledger_value": mrp["event_ledger_value"],
                    "event_cash_ledger_gap": mrp["ledger_gap"],
                    "bellman_residual": mrp["bellman_residual"],
                    "absorption_probability": mrp["absorption_probability"],
                    "reachable_state_count": mrp["reachable_state_count"],
                }
            )
            finite.append((mrp["value"], policy, mrp))
        else:
            row.update(
                {
                    "profit": None,
                    "formula_profit": None,
                    "formula_bellman_gap": None,
                    "event_ledger_value": None,
                    "event_cash_ledger_gap": None,
                    "bellman_residual": None,
                    "absorption_probability": None,
                    "reachable_state_count": None,
                }
            )
        table.append(row)

    if not finite:
        raise RuntimeError("参数下不存在有限利润且可吸收的策略")
    best_profit = max(item[0] for item in finite)
    selected_profit, selected_policy, selected_mrp = next(
        item for item in finite if abs(item[0] - best_profit) <= tolerance
    )
    selected_formula = _q2_formula_value(params, selected_policy)

    return {
        "policy": _q2_policy_payload(selected_policy),
        "profit": selected_profit,
        "selected_policy_vector": [int(value) for value in selected_policy],
        "policy_table": table,
        "finite_policy_count": len(finite),
        "excluded_nonabsorbing_policy_count": len(_Q2_POLICIES) - len(finite),
        "bellman_residual": selected_mrp["bellman_residual"],
        "event_cash_ledger_gap": selected_mrp["ledger_gap"],
        "absorption_probability": selected_mrp["absorption_probability"],
        "reachable_state_count": selected_mrp["reachable_state_count"],
        "Q_root": selected_formula["Q_root"],
        "C_first_launch": selected_formula["C_first_launch"],
        "U_root": selected_formula["U_root"],
    }


def _q2_batch(
    rates: np.ndarray, costs: Mapping[str, Any], tolerance: float
) -> dict[str, Any]:
    rates = np.asarray(rates, dtype=float)
    if rates.ndim != 2 or rates.shape[1] != len(_Q2_POLICIES[0]):
        raise ValueError("Q2 批量次品率矩阵形状错误")
    batch_size = rates.shape[0]
    profits = np.full((batch_size, len(_Q2_POLICIES)), -np.inf, dtype=float)
    vectors = np.zeros((batch_size, len(_Q2_POLICIES[0])), dtype=int)

    p1 = rates[:, 0]
    p2 = rates[:, 1]
    pf = rates[:, 2]
    q1 = 1 - p1
    q2 = 1 - p2
    qf = 1 - pf

    with np.errstate(divide="ignore", invalid="ignore", over="ignore"):
        for column, policy in enumerate(_Q2_POLICIES):
            inspect1 = bool(policy[0])
            inspect2 = bool(policy[1])
            inspect_final = bool(policy[2])

            part1_cost = (
                (costs["a1"] + costs["t1"]) / q1 if inspect1 else costs["a1"]
            )
            part2_cost = (
                (costs["a2"] + costs["t2"]) / q2 if inspect2 else costs["a2"]
            )
            preparation_cost = part1_cost + part2_cost
            prepared_good = (1 if inspect1 else q1) * (1 if inspect2 else q2)
            root_good = prepared_good * qf
            root_launch_cost = costs["kf"] + (costs["tf"] if inspect_final else 0)

            d0 = (
                costs["market"]
                - preparation_cost
                - root_launch_cost
                - (0 if inspect_final else (1 - root_good) * costs["exchange"])
            ) / root_good

            screened1 = inspect1 | (p1 == 0)
            screened2 = inspect2 | (p2 == 0)
            screen_possible1 = (~inspect1) | (p1 < 1)
            screen_possible2 = (~inspect2) | (p2 < 1)
            d1_feasible = screened1 & screened2 & screen_possible1 & screen_possible2 & (qf > 0)
            d1 = (
                costs["market"] / qf
                - preparation_cost
                - (
                    costs["kf"]
                    + (costs["tf"] if inspect_final else 0)
                    + (1 - qf)
                    * (costs["disassembly"] + (0 if inspect_final else costs["exchange"]))
                )
                / qf
            )

            choose_d1 = d1_feasible & (d1 < d0 - tolerance)
            selected_d = choose_d1.astype(int)
            selected_profit = np.where(choose_d1, d1, d0)
            feasible = (root_good > 0) | d1_feasible
            selected_profit = np.where(feasible, selected_profit, -np.inf)

            profits[:, column] = selected_profit
            vectors[:, column, 0] = int(policy[0])
            vectors[:, column, 1] = int(policy[1])
            vectors[:, column, 2] = int(policy[2])
            vectors[:, column, 3] = selected_d

    best_columns = np.argmax(profits, axis=1)
    row_indices = np.arange(batch_size)
    best_profits = profits[row_indices, best_columns]
    best_vectors = vectors[row_indices, best_columns]
    return {"profits": profits, "vectors": vectors, "best_profit": best_profits, "best_vectors": best_vectors}


def clopper_pearson(x: int, n: int, alpha: float) -> tuple[float, float]:
    if n < 1 or x < 0 or x > n:
        raise ValueError("Clopper–Pearson 输入计数越界")
    if not 0 < alpha < 1:
        raise ValueError("Clopper–Pearson 错误率越界")
    lower = 0.0 if x == 0 else float(scipy_stats.beta.ppf(alpha / 2, x, n - x + 1))
    upper = 1.0 if x == n else float(scipy_stats.beta.ppf(1 - alpha / 2, x + 1, n - x))
    return lower, upper


def parameter_precision_n(
    probability: float, alpha: float, width_target: float, n_max: int
) -> dict[str, Any]:
    if not 0 <= probability <= 1:
        raise ValueError("精度设计的概率越界")
    n_max = int(n_max)
    chosen = n_max
    target_met = False
    chosen_width = None
    for n in range(1, n_max + 1):
        modal_x = min(n, max(0, int((n + 1) * probability)))
        lower, upper = clopper_pearson(modal_x, n, alpha)
        width = upper - lower
        if width <= width_target:
            chosen = n
            chosen_width = width
            target_met = True
            break
    if chosen_width is None:
        lower, upper = clopper_pearson(
            min(chosen, max(0, int((chosen + 1) * probability))), chosen, alpha
        )
        chosen_width = upper - lower
    return {
        "n": chosen,
        "modal_count": min(chosen, max(0, int((chosen + 1) * probability))),
        "width": float(chosen_width),
        "target": float(width_target),
        "target_met": target_met,
    }


def bonferroni_joint_box(
    intervals: list[tuple[float, float]], family_alpha: float
) -> dict[str, Any]:
    parameter_count = len(intervals)
    marginal_alpha = family_alpha / parameter_count
    box: dict[str, list[float]] = {}
    for index, (lower, upper) in enumerate(intervals):
        if not 0 <= lower <= upper <= 1:
            raise ValueError("Bonferroni 区间端点次序错误")
        box[f"node_{index}"] = [float(lower), float(upper)]
    return {
        "parameter_count": parameter_count,
        "family_alpha": float(family_alpha),
        "marginal_alpha": float(marginal_alpha),
        "coverage_lower_bound": float(1 - marginal_alpha),
        "box": box,
    }


def _cp_exact_edge_tests(n: int, alpha: float, tolerance: float) -> dict[str, Any]:
    if n < 1:
        raise ValueError("CP 边界测试样本量无效")
    counts = [0]
    interior = n // 2
    if 0 < interior < n:
        counts.append(interior)
    counts.append(n)
    tests: list[dict[str, Any]] = []
    for x in counts:
        lower, upper = clopper_pearson(x, n, alpha)
        lower_cdf_residual = None
        upper_cdf_residual = None
        if x > 0:
            lower_cdf_residual = abs(float(scipy_stats.binom.cdf(x - 1, n, lower)) - alpha / 2)
        if x < n:
            upper_cdf_residual = abs(float(scipy_stats.binom.cdf(x, n, upper)) - alpha / 2)
        passed = (
            0 <= lower <= x / n <= upper <= 1
            and (lower_cdf_residual is None or lower_cdf_residual <= tolerance)
            and (upper_cdf_residual is None or upper_cdf_residual <= tolerance)
        )
        tests.append(
            {
                "x": x,
                "n": n,
                "p_hat": x / n,
                "lower": lower,
                "upper": upper,
                "lower_exact_cdf_residual": lower_cdf_residual,
                "upper_exact_cdf_residual": upper_cdf_residual,
                "passed": bool(passed),
            }
        )
    return {
        "tests": tests,
        "zero_count_branch_passed": tests[0]["lower"] == 0,
        "all_count_branch_passed": tests[-1]["upper"] == 1,
        "interior_count_branch_present": any(
            test["x"] not in (0, test["n"]) for test in tests
        ),
        "all_passed": all(test["passed"] for test in tests),
    }


def _q2_generate_samples(
    case: Mapping[str, Any],
    case_index: int,
    replicates: int,
    family_alpha: float,
    width_target: float,
    n_max: int,
    seed: int,
) -> dict[str, Any]:
    scenario = np.asarray([case["p1"], case["p2"], case["pf"]], dtype=float)
    parameter_count = len(scenario)
    marginal_alpha = family_alpha / parameter_count
    precision = [
        parameter_precision_n(float(probability), marginal_alpha, width_target, n_max)
        for probability in scenario
    ]
    sample_sizes = [item["n"] for item in precision]
    baseline_x: list[int] = []
    baseline_intervals: list[tuple[float, float]] = []
    replicate_x = np.zeros((replicates, parameter_count), dtype=int)
    replicate_probability_hat = np.zeros((replicates, parameter_count), dtype=float)

    for node_index, (probability, n) in enumerate(zip(scenario, sample_sizes)):
        sequence = np.random.SeedSequence([int(seed), int(case_index), int(node_index)])
        baseline_stream, replicate_stream = sequence.spawn(len(itertools.product((False,), repeat=2)))
        x = int(scipy_stats.binom.rvs(int(n), float(probability), random_state=np.random.default_rng(baseline_stream)))
        baseline_x.append(x)
        baseline_intervals.append(clopper_pearson(x, int(n), marginal_alpha))
        draws = scipy_stats.binom.rvs(
            int(n), float(probability), size=replicates, random_state=np.random.default_rng(replicate_stream)
        )
        replicate_x[:, node_index] = np.asarray(draws, dtype=int)
        replicate_probability_hat[:, node_index] = replicate_x[:, node_index] / n

    baseline_probability_hat = np.asarray(baseline_x, dtype=float) / np.asarray(sample_sizes, dtype=float)
    return {
        "scenario": scenario,
        "sample_sizes": sample_sizes,
        "precision": precision,
        "baseline_x": baseline_x,
        "baseline_probability_hat": baseline_probability_hat,
        "baseline_intervals": baseline_intervals,
        "replicate_x": replicate_x,
        "replicate_probability_hat": replicate_probability_hat,
        "marginal_alpha": marginal_alpha,
    }


def _q2_box_corners(intervals: list[tuple[float, float]]) -> list[np.ndarray]:
    endpoints = [interval for interval in intervals]
    return [
        np.asarray(choice, dtype=float)
        for choice in itertools.product(*endpoints)
    ]


def _q2_stability_scan(
    case: Mapping[str, Any],
    case_index: int,
    sample: Mapping[str, Any],
    n_grid: list[int],
    seed: int,
    tolerance: float,
) -> list[dict[str, Any]]:
    scenario = np.asarray(sample["scenario"], dtype=float)
    marginal_alpha = float(sample["marginal_alpha"])
    width_target = float(sample["precision"][0]["target"])
    costs = case
    scenario_solution = enumerate_q2(costs, tolerance)
    scenario_vector = np.asarray(scenario_solution["selected_policy_vector"], dtype=int)
    curve: list[dict[str, Any]] = []

    for node_index, probability in enumerate(scenario):
        grid_values = sorted({int(value) for value in n_grid} | {int(sample["sample_sizes"][node_index])})
        for n in grid_values:
            sequence = np.random.SeedSequence(
                [int(seed), int(case_index), int(node_index), int(n)]
            )
            stream, _ = sequence.spawn(len(itertools.product((False,), repeat=2)))
            draws = scipy_stats.binom.rvs(
                int(n),
                float(probability),
                size=len(sample["replicate_x"]),
                random_state=np.random.default_rng(stream),
            )
            probability_hat = np.asarray(draws, dtype=float) / n
            widths = []
            for x in draws:
                lower, upper = clopper_pearson(int(x), int(n), marginal_alpha)
                widths.append(upper - lower)
            rates = np.tile(scenario, (len(probability_hat), 1))
            rates[:, node_index] = probability_hat
            solved = _q2_batch(rates, costs, tolerance)
            matches = np.all(solved["best_vectors"] == scenario_vector, axis=1)
            curve.append(
                {
                    "node_index": node_index,
                    "scenario_probability": float(probability),
                    "n": int(n),
                    "mean_interval_width": float(np.mean(widths)),
                    "interval_width_standard_deviation": float(np.std(widths)),
                    "decision_consistency_to_scenario": float(np.mean(matches)),
                    "policy_flip_rate_to_scenario": float(1 - np.mean(matches)),
                    "point_policy_consistency": None,
                    "leakage_statement": (
                        "名义概率仅用于固定情景抽样；每次决策只读取 x/n；"
                        "基准样本与重抽样流由不同 SeedSequence 子流产生，未用评估流调参。"
                    ),
                }
            )
    return curve


def _analyze_q2_case(
    case: Mapping[str, Any],
    case_index: int,
    constants: Mapping[str, Any],
    tolerance: float,
) -> dict[str, Any]:
    sample = _q2_generate_samples(
        case,
        case_index,
        constants["replicates"],
        constants["family_alpha"],
        constants["width_target"],
        constants["n_max"],
        constants["seed"],
    )

    point_solution = enumerate_q2(
        {**case, "p1": sample["baseline_probability_hat"][0], "p2": sample["baseline_probability_hat"][1], "pf": sample["baseline_probability_hat"][2]},
        tolerance,
    )
    scenario_solution = enumerate_q2(case, tolerance)

    lower_rates = np.asarray([interval[0] for interval in sample["baseline_intervals"]], dtype=float)
    upper_rates = np.asarray([interval[1] for interval in sample["baseline_intervals"]], dtype=float)
    lower_solution = enumerate_q2(
        {**case, "p1": lower_rates[0], "p2": lower_rates[1], "pf": lower_rates[2]},
        tolerance,
    )
    upper_solution = enumerate_q2(
        {**case, "p1": upper_rates[0], "p2": upper_rates[1], "pf": upper_rates[2]},
        tolerance,
    )

    point_batch = _q2_batch(sample["baseline_probability_hat"][None, :], case, tolerance)
    upper_batch = _q2_batch(upper_rates[None, :], case, tolerance)
    if not np.allclose(point_batch["best_profit"], point_solution["profit"], atol=tolerance, rtol=0):
        raise RuntimeError(f"{case['id']}: Q2 点估计 Bellman 与批量公式不一致")
    if not np.allclose(upper_batch["best_profit"], upper_solution["profit"], atol=tolerance, rtol=0):
        raise RuntimeError(f"{case['id']}: Q2 稳健端点 Bellman 与批量公式不一致")

    corner_solutions: list[dict[str, Any]] = []
    fixed_point_values: list[float] = []
    optimal_corner_profits: list[float] = []
    point_policy = tuple(point_solution["selected_policy_vector"])
    for corner in _q2_box_corners(sample["baseline_intervals"]):
        corner_params = {**case, "p1": float(corner[0]), "p2": float(corner[1]), "pf": float(corner[2])}
        solution = enumerate_q2(corner_params, tolerance)
        fixed_value = _q2_formula_value(corner_params, point_policy)
        if not fixed_value["feasible"]:
            raise RuntimeError(f"{case['id']}: 点策略在联合域角点失去吸收性")
        fixed_point_values.append(float(fixed_value["profit"]))
        optimal_corner_profits.append(float(solution["profit"]))
        corner_solutions.append(
            {
                "rates": [float(value) for value in corner],
                "reoptimized_policy": solution["policy"],
                "reoptimized_profit": solution["profit"],
                "point_policy_profit": fixed_value["profit"],
            }
        )

    if abs(min(optimal_corner_profits) - upper_solution["profit"]) > tolerance:
        raise RuntimeError(f"{case['id']}: Q2 联合域最坏利润不在上端点")
    if abs(max(optimal_corner_profits) - lower_solution["profit"]) > tolerance:
        raise RuntimeError(f"{case['id']}: Q2 联合域最好利润不在下端点")

    monte_carlo = _q2_batch(sample["replicate_probability_hat"], case, tolerance)
    reference_vector = np.asarray(scenario_solution["selected_policy_vector"], dtype=int)
    matches_scenario = np.all(monte_carlo["best_vectors"] == reference_vector, axis=1)
    ranks = np.arange(1, len(matches_scenario) + 1)
    cumulative_consistency = np.cumsum(matches_scenario) / ranks

    leakage_statement = (
        "无监督学习或参数调优；情景概率只进入二项抽样发生器，点估计只由保存的 x_v/n_v 形成。"
        "基准观测与重抽样观测使用独立随机子流，策略在每次重抽样时重新 argmax。"
    )

    sample_ledger = []
    node_names = ["part_1", "part_2", "final_product"]
    for node_index, name in enumerate(node_names):
        lower, upper = sample["baseline_intervals"][node_index]
        sample_ledger.append(
            {
                "node": name,
                "n": int(sample["sample_sizes"][node_index]),
                "x": int(sample["baseline_x"][node_index]),
                "scenario_probability": float(sample["scenario"][node_index]),
                "p_hat": float(sample["baseline_probability_hat"][node_index]),
                "lower": lower,
                "upper": upper,
                "width": upper - lower,
                "n_selection_rule": "min n on precision grid with modal-count CP width <= target",
                "q1_sample_size_reused": False,
            }
        )

    edge_n = max(int(value) for value in sample["sample_sizes"])
    cp_edges = _cp_exact_edge_tests(edge_n, sample["marginal_alpha"], constants["q1_tolerance"])

    return {
        "case_id": case["id"],
        "point_policy": point_solution["policy"],
        "point_profit": point_solution["profit"],
        "scenario_reference_policy": scenario_solution["policy"],
        "scenario_reference_profit": scenario_solution["profit"],
        "robust_policy": upper_solution["policy"],
        "robust_profit_lower_bound": upper_solution["profit"],
        "profit_interval": [min(optimal_corner_profits), max(optimal_corner_profits)],
        "point_policy_fixed_box_interval": [min(fixed_point_values), max(fixed_point_values)],
        "joint_box": bonferroni_joint_box(sample["baseline_intervals"], constants["family_alpha"]),
        "sample_ledger": sample_ledger,
        "corner_audit": corner_solutions,
        "cp_edge_tests": cp_edges,
        "monte_carlo": {
            "replicates": int(constants["replicates"]),
            "random_seed": int(constants["seed"]),
            "x": sample["replicate_x"].tolist(),
            "p_hat": sample["replicate_probability_hat"].tolist(),
            "profit": monte_carlo["best_profit"].tolist(),
            "policy_vectors": monte_carlo["best_vectors"].tolist(),
            "matches_scenario_reference": matches_scenario.astype(int).tolist(),
            "cumulative_consistency": cumulative_consistency.tolist(),
        },
        "decision_consistency": float(np.mean(matches_scenario)),
        "policy_flip_rate": float(1 - np.mean(matches_scenario)),
        "classification_leakage_control": leakage_statement,
        "sample_size_stability": _q2_stability_scan(
            case,
            case_index,
            sample,
            constants["n_grid"],
            constants["seed"],
            tolerance,
        ),
        "selected_strategy_audit": {
            "bellman_residual": point_solution["bellman_residual"],
            "event_cash_ledger_gap": point_solution["event_cash_ledger_gap"],
            "absorption_probability": point_solution["absorption_probability"],
            "reachable_state_count": point_solution["reachable_state_count"],
        },
    }


@dataclass(frozen=True)
class Policy:
    network: Any
    vector: tuple[int, ...]

    @property
    def expected_length(self) -> int:
        return len(self.network["parts"]) + len(self.network["semis"]) * len(itertools.product((0,), repeat=2)) + len(itertools.product((0,), repeat=2))

    @classmethod
    def from_vector(cls, network: Any, vector: tuple[int, ...]) -> "Policy":
        expected = len(network["parts"]) + len(network["semis"]) * len(itertools.product((0,), repeat=2)) + len(itertools.product((0,), repeat=2))
        if len(vector) != expected:
            raise ValueError(f"Q3 策略维度错误: expected={expected}, actual={len(vector)}")
        return cls(network=network, vector=tuple(int(value) for value in vector))

    @classmethod
    def from_mapping(cls, network: Any, mapping: Mapping[str, Any]) -> "Policy":
        vector: list[int] = []
        part_values = mapping["parts"]
        if isinstance(part_values, Mapping):
            for part in network["parts"]:
                vector.append(int(part_values[part["id"]]))
        else:
            vector.extend(int(value) for value in part_values)

        semi_values = mapping["semis"]
        if isinstance(semi_values, Mapping):
            for semi in network["semis"]:
                decision = semi_values[semi["id"]]
                vector.extend((int(decision["inspect"]), int(decision["disassemble"])))
        else:
            for decision in semi_values:
                vector.extend((int(decision["inspect"]), int(decision["disassemble"])))

        root = mapping["root"]
        vector.extend((int(root["inspect"]), int(root["disassemble"])))
        return cls.from_vector(network, tuple(vector))

    def to_mapping(self) -> dict[str, Any]:
        part_count = len(self.network["parts"])
        semi_count = len(self.network["semis"])
        cursor = 0
        parts = {
            part["id"]: self.vector[cursor + index]
            for index, part in enumerate(self.network["parts"])
        }
        cursor += part_count
        semis: dict[str, Any] = {}
        for semi in self.network["semis"]:
            semis[semi["id"]] = {
                "inspect": self.vector[cursor],
                "disassemble": self.vector[cursor + 1],
            }
            cursor += len(itertools.product((0,), repeat=2))
        root = {"inspect": self.vector[cursor], "disassemble": self.vector[cursor + 1]}
        return {"parts": parts, "semis": semis, "root": root}


def _policy_adapter_self_test() -> dict[str, Any]:
    network = {
        "parts": [{"id": "p_left"}, {"id": "p_right"}],
        "semis": [{"id": "semi", "parents": [0, 1]}],
    }
    vector = (0, 1, 0, 1, 1, 0)
    policy = Policy.from_vector(network, vector)
    restored = Policy.from_mapping(network, policy.to_mapping())
    return {
        "expected_length": policy.expected_length,
        "vector_length": len(policy.vector),
        "mapping_round_trip": restored.vector == policy.vector,
        "passed": policy.expected_length == len(policy.vector) and restored.vector == policy.vector,
    }


def _q2_as_q3_network(case: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "parts": [
            {"id": "part_1", "p": case["p1"], "purchase": case["a1"], "inspection": case["t1"]},
            {"id": "part_2", "p": case["p2"], "purchase": case["a2"], "inspection": case["t2"]},
        ],
        "semis": [],
        "root": {
            "id": "final_product",
            "p": case["pf"],
            "assembly": case["kf"],
            "inspection": case["tf"],
            "disassembly": case["disassembly"],
            "parents": [0, 1],
        },
        "market": case["market"],
        "exchange": case["exchange"],
    }


def _q3_vector_value(
    network: Mapping[str, Any], probabilities: np.ndarray, vector: tuple[int, ...]
) -> dict[str, Any]:
    part_count = len(network["parts"])
    semi_count = len(network["semis"])
    expected = part_count + semi_count * len(itertools.product((0,), repeat=2)) + len(itertools.product((0,), repeat=2))
    if len(vector) != expected:
        raise ValueError("Q3 策略维度与网络不一致")

    part_costs: list[np.ndarray | float] = []
    part_good: list[np.ndarray | float] = []
    feasible = True
    for index, part in enumerate(network["parts"]):
        probability = float(probabilities[index])
        inspect = bool(vector[index])
        good = np.ones_like(probabilities, dtype=float) if inspect else 1 - probability
        if inspect:
            if probability >= 1:
                feasible = False
                cost = np.full_like(probabilities, np.inf, dtype=float)
            else:
                cost = (part["purchase"] + part["inspection"]) / (1 - probability)
        else:
            cost = np.asarray(part["purchase"] + 0 * probabilities, dtype=float)
        part_costs.append(cost)
        part_good.append(good)

    cursor = part_count
    semi_costs: list[np.ndarray | float] = []
    semi_good: list[np.ndarray | float] = []
    semi_guaranteed: list[np.ndarray | bool] = []
    for semi in network["semis"]:
        inspect = bool(vector[cursor])
        disassemble = bool(vector[cursor + 1])
        cursor += len(itertools.product((0,), repeat=2))
        conditional_good = 1 - float(probabilities[part_count + len(semi_costs)])
        preparation = np.zeros_like(probabilities, dtype=float)
        parent_good = np.ones_like(probabilities, dtype=float)
        for parent in semi["parents"]:
            preparation = preparation + part_costs[parent]
            parent_good = parent_good * part_good[parent]
        output_good = parent_good * conditional_good
        if inspect:
            if np.any(output_good <= 0):
                feasible = False
            d0 = (preparation + semi["assembly"] + semi["inspection"]) / output_good
            safe_d1 = np.all(parent_good >= 1, axis=0) & (conditional_good > 0)
            d1 = preparation + (
                semi["assembly"]
                + semi["inspection"]
                + (1 - conditional_good) * semi["disassembly"]
            ) / conditional_good
            if disassemble:
                feasible = feasible and bool(np.all(safe_d1))
                cost = np.where(safe_d1, d1, np.inf)
            else:
                cost = d0
            supplied_good = np.ones_like(probabilities, dtype=bool)
        else:
            cost = preparation + semi["assembly"]
            supplied_good = output_good >= 1
        semi_costs.append(cost)
        semi_good.append(supplied_good)
        semi_guaranteed.append(supplied_good)

    inspect_root = bool(vector[cursor])
    disassemble_root = bool(vector[cursor + 1])
    root_conditional_good = 1 - float(probabilities[-1])
    preparation_root = np.zeros_like(probabilities, dtype=float)
    input_good = np.ones_like(probabilities, dtype=float)
    guaranteed_inputs = np.ones_like(probabilities, dtype=bool)
    for index, root_parent in enumerate(network["root"]["parents"]):
        preparation_root = preparation_root + semi_costs[root_parent]
        input_good = input_good * semi_good[root_parent]
        guaranteed_inputs = guaranteed_inputs & semi_guaranteed[root_parent]
    output_good = input_good * root_conditional_good
    root_launch_cost = network["root"]["assembly"] + (
        network["root"]["inspection"] if inspect_root else 0
    )

    d0 = (
        network["market"]
        - preparation_root
        - root_launch_cost
        - (0 if inspect_root else (1 - output_good) * network["exchange"])
    ) / output_good
    safe_d1 = guaranteed_inputs & (root_conditional_good > 0)
    d1 = network["market"] / root_conditional_good - preparation_root - (
        network["root"]["assembly"]
        + (network["root"]["inspection"] if inspect_root else 0)
        + (1 - root_conditional_good)
        * (network["root"]["disassembly"] + (0 if inspect_root else network["exchange"]))
    ) / root_conditional_good

    if disassemble_root:
        feasible = feasible and bool(np.all(safe_d1))
        profit = np.where(safe_d1, d1, -np.inf)
    else:
        profit = d0
    profit = np.where(feasible & (output_good > 0), profit, -np.inf)
    return {
        "profit": profit,
        "feasible": feasible,
        "Q_root": output_good,
        "C_first_launch": preparation_root + root_launch_cost,
        "U_root": (preparation_root + root_launch_cost) / output_good,
    }


def _q2_degenerate_equivalence(
    case: Mapping[str, Any], tolerance: float
) -> dict[str, Any]:
    q2_solution = enumerate_q2(case, tolerance)
    network = _q2_as_q3_network(case)
    rates = np.asarray([case["p1"], case["p2"], case["pf"]], dtype=float)
    gaps: list[float] = []
    compared = 0
    for policy in _Q2_POLICIES:
        formula = _q2_formula_value(case, policy)
        if not formula["feasible"]:
            continue
        compared += 1
        q3_value = _q3_vector_value(network, rates, policy)["profit"]
        gaps.append(abs(float(q3_value) - formula["profit"]))
    max_error = max(gaps)
    sample_solution = q2_solution
    c_root = sample_solution["C_first_launch"]
    q_root = sample_solution["Q_root"]
    u_root = c_root / q_root
    return {
        "case_id": case["id"],
        "compared_policy_count": compared,
        "max_profit_gap": max_error,
        "within_tolerance": max_error <= tolerance,
        "Q_root": q_root,
        "C_root": c_root,
        "U_root": u_root,
        "U_equals_C_over_Q_gap": abs(u_root - sample_solution["U_root"]),
        "U_times_Q_used_as_parent_cost": False,
    }


def _q3_normalize_verified_network(module: Any, topology: Any) -> dict[str, Any]:
    if not isinstance(topology, Mapping):
        raise ValueError("经验证拓扑必须是父节点边表")
    raw_parts = _required_param(module, "Q3_PARTS", "TABLE2_PARTS", "PROBLEM3_PARTS")
    raw_semis = _required_param(module, "Q3_SEMIS", "TABLE2_SEMIS", "PROBLEM3_SEMIS")
    raw_product = _required_param(module, "Q3_PRODUCT", "TABLE2_PRODUCT", "PROBLEM3_PRODUCT")
    market = _float_field(
        _required_param(module, "Q3_MARKET_PRICE", "Q3_PRICE", "TABLE2_PRICE"),
        ("market_price", "market", "市场售价", "price"),
    )
    exchange = _float_field(
        _required_param(module, "Q3_EXCHANGE_LOSS", "Q3_PRICE", "TABLE2_PRICE"),
        ("exchange_loss", "exchange", "调换损失", "loss"),
    )

    parts = []
    for index, raw in enumerate(raw_parts):
        parts.append(
            {
                "id": str(_field(raw, ("id", "编号"), index)),
                "p": _float_field(raw, ("p", "defect_rate", "次品率")),
                "purchase": _float_field(raw, ("purchase", "purchase_price", "购买单价")),
                "inspection": _float_field(raw, ("inspection", "inspection_cost", "检测成本")),
            }
        )

    semis = []
    for index, raw in enumerate(raw_semis):
        semis.append(
            {
                "id": str(_field(raw, ("id", "编号"), index)),
                "p": _float_field(raw, ("p", "defect_rate", "次品率")),
                "assembly": _float_field(raw, ("assembly", "assembly_cost", "装配成本")),
                "inspection": _float_field(raw, ("inspection", "inspection_cost", "检测成本")),
                "disassembly": _float_field(raw, ("disassembly", "disassembly_cost", "拆解费用")),
                "parents": [],
            }
        )

    part_lookup = {part["id"]: index for index, part in enumerate(parts)}
    part_lookup.update({str(index + 1): index for index, part in enumerate(parts)})
    semi_lookup = {semi["id"]: index for index, semi in enumerate(semis)}
    semi_lookup.update({str(index + 1): index for index, semi in enumerate(semis)})

    def resolve(reference: Any) -> int:
        if isinstance(reference, int):
            return reference
        text = str(reference).strip()
        if text in part_lookup:
            return part_lookup[text]
        if text in semi_lookup:
            return semi_lookup[text]
        lowered = text.lower().replace(" ", "")
        if lowered in part_lookup:
            return part_lookup[lowered]
        if lowered in semi_lookup:
            return semi_lookup[lowered]
        if "半成品" in text or lowered.startswith("semi"):
            suffix = "".join(character for character in text if character.isdigit())
            if suffix:
                return int(suffix) - 1
        if text.isdigit():
            return int(text) - 1
        raise ValueError(f"无法解析经验证拓扑父节点: {reference}")

    assigned = set()
    for node, parents in topology.items():
        node_text = str(node)
        if "成品" in node_text or node_text.lower().startswith("root") or node_text.lower().startswith("final"):
            continue
        matches = [index for index, semi in enumerate(semis) if semi["id"] == node_text]
        if not matches:
            suffix = "".join(character for character in node_text if character.isdigit())
            if suffix:
                matches = [int(suffix) - 1]
        if not matches:
            raise ValueError(f"拓扑节点未登记参数: {node}")
        semi_index = matches[0]
        semis[semi_index]["parents"] = [resolve(parent) for parent in parents]
        assigned.add(semi_index)
    if assigned != set(range(len(semis))):
        raise ValueError("经验证拓扑未覆盖全部半成品")

    product = {
        "id": "final_product",
        "p": _float_field(raw_product, ("p", "defect_rate", "次品率")),
        "assembly": _float_field(raw_product, ("assembly", "assembly_cost", "装配成本")),
        "inspection": _float_field(raw_product, ("inspection", "inspection_cost", "检测成本")),
        "disassembly": _float_field(raw_product, ("disassembly", "disassembly_cost", "拆解费用")),
        "parents": list(range(len(semis))),
    }
    return {"parts": parts, "semis": semis, "root": product, "market": market, "exchange": exchange}


def _q3_enumerate_full(
    network: Mapping[str, Any], probabilities: np.ndarray, tolerance: float
) -> dict[str, Any]:
    length = len(network["parts"]) + len(network["semis"]) * len(itertools.product((0,), repeat=2)) + len(itertools.product((0,), repeat=2))
    values: list[float] = []
    policies: list[tuple[int, ...]] = []
    for vector in itertools.product((0, 1), repeat=length):
        result = _q3_vector_value(network, probabilities, vector)
        value = float(np.asarray(result["profit"]).reshape(-1)[0])
        values.append(value)
        policies.append(vector)
    value_array = np.asarray(values, dtype=float)
    best = np.max(value_array)
    best_index = int(np.flatnonzero(np.abs(value_array - best) <= tolerance)[0])
    return {
        "policy": list(policies[best_index]),
        "profit": float(value_array[best_index]),
        "searched_policy_count": len(policies),
        "all_policy_profits": value_array.tolist(),
    }


def _bit(mask: int, index: int) -> int:
    return int(bool(mask & (1 << index)))


def _q3_core_batch_one(
    network: Mapping[str, Any],
    rates: np.ndarray,
    part_mask: int,
    semi_mask: int,
    inspect_root: int,
    tolerance: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    part_count = len(network["parts"])
    semi_count = len(network["semis"])
    part_costs: list[np.ndarray] = []
    part_good: list[np.ndarray] = []
    feasible = np.ones(len(rates), dtype=bool)

    for index, part in enumerate(network["parts"]):
        inspect = _bit(part_mask, index)
        probability = rates[:, index]
        good = np.ones(len(rates), dtype=float) if inspect else 1 - probability
        if inspect:
            with np.errstate(divide="ignore", invalid="ignore"):
                cost = (part["purchase"] + part["inspection"]) / (1 - probability)
            feasible &= probability < 1
        else:
            cost = np.full(len(rates), part["purchase"], dtype=float)
        part_costs.append(cost)
        part_good.append(good)

    semi_costs: list[np.ndarray] = []
    semi_guaranteed: list[np.ndarray] = []
    semi_d: list[np.ndarray] = []
    for semi_index, semi in enumerate(network["semis"]):
        inspect = _bit(semi_mask, semi_index)
        preparation = np.zeros(len(rates), dtype=float)
        parent_good = np.ones(len(rates), dtype=float)
        for parent in semi["parents"]:
            preparation += part_costs[parent]
            parent_good *= part_good[parent]
        conditional_good = 1 - rates[:, part_count + semi_index]
        output_good = parent_good * conditional_good
        if inspect:
            with np.errstate(divide="ignore", invalid="ignore"):
                d0_cost = (preparation + semi["assembly"] + semi["inspection"]) / output_good
                d1_cost = preparation + (
                    semi["assembly"]
                    + semi["inspection"]
                    + (1 - conditional_good) * semi["disassembly"]
                ) / conditional_good
            safe_d1 = np.all(parent_good >= 1, axis=0) & (conditional_good > 0)
            choose_d1 = safe_d1 & (d1_cost < d0_cost - tolerance)
            cost = np.where(choose_d1, d1_cost, d0_cost)
            feasible &= output_good > 0
            guaranteed = np.ones(len(rates), dtype=bool)
            selected_d = choose_d1.astype(int)
        else:
            cost = preparation + semi["assembly"]
            guaranteed = output_good >= 1
            selected_d = np.zeros(len(rates), dtype=int)
        semi_costs.append(cost)
        semi_guaranteed.append(guaranteed)
        semi_d.append(selected_d)

    preparation_root = np.zeros(len(rates), dtype=float)
    guaranteed_inputs = np.ones(len(rates), dtype=bool)
    input_good = np.ones(len(rates), dtype=float)
    for parent in network["root"]["parents"]:
        preparation_root += semi_costs[parent]
        guaranteed_inputs &= semi_guaranteed[parent]
        input_good *= np.where(semi_guaranteed[parent], 1, input_good)
    conditional_good = 1 - rates[:, -1]
    output_good = input_good * conditional_good
    root_launch_cost = network["root"]["assembly"] + (
        network["root"]["inspection"] if inspect_root else 0
    )
    with np.errstate(divide="ignore", invalid="ignore"):
        d0_profit = (
            network["market"]
            - preparation_root
            - root_launch_cost
            - (0 if inspect_root else (1 - output_good) * network["exchange"])
        ) / output_good
        d1_profit = network["market"] / conditional_good - preparation_root - (
            network["root"]["assembly"]
            + (network["root"]["inspection"] if inspect_root else 0)
            + (1 - conditional_good)
            * (network["root"]["disassembly"] + (0 if inspect_root else network["exchange"]))
        ) / conditional_good
    safe_root_d1 = guaranteed_inputs & (conditional_good > 0)
    choose_root_d1 = safe_root_d1 & (d1_profit > d0_profit + tolerance)
    profit = np.where(choose_root_d1, d1_profit, d0_profit)
    feasible &= output_good > 0
    profit = np.where(feasible, profit, -np.inf)
    root_d = choose_root_d1.astype(int)
    return profit, semi_d, root_d


def _q3_core_batch(
    network: Mapping[str, Any], rates: np.ndarray, tolerance: float
) -> dict[str, Any]:
    part_count = len(network["parts"])
    semi_count = len(network["semis"])
    best_profit = np.full(len(rates), -np.inf, dtype=float)
    best_part_mask = np.zeros(len(rates), dtype=int)
    best_semi_mask = np.zeros(len(rates), dtype=int)
    best_root_inspect = np.zeros(len(rates), dtype=int)
    best_semi_d = np.zeros((len(rates), semi_count), dtype=int)
    best_root_d = np.zeros(len(rates), dtype=int)
    length = part_count + semi_count * len(itertools.product((0,), repeat=2)) + len(itertools.product((0,), repeat=2))

    for part_mask, semi_mask, root_inspect in itertools.product(
        range(1 << part_count), range(1 << semi_count), (0, 1)
    ):
        profit, semi_d, root_d = _q3_core_batch_one(
            network, rates, part_mask, semi_mask, root_inspect, tolerance
        )
        improve = profit > best_profit + tolerance
        if not np.any(improve):
            continue
        best_profit[improve] = profit[improve]
        best_part_mask[improve] = part_mask
        best_semi_mask[improve] = semi_mask
        best_root_inspect[improve] = root_inspect
        for semi_index in range(semi_count):
            best_semi_d[improve, semi_index] = semi_d[semi_index][improve]
        best_root_d[improve] = root_d[improve]

    vectors = np.zeros((len(rates), length), dtype=int)
    for row in range(len(rates)):
        vector: list[int] = []
        for part_index in range(part_count):
            vector.append(_bit(int(best_part_mask[row]), part_index))
        for semi_index in range(semi_count):
            vector.append(_bit(int(best_semi_mask[row]), semi_index))
            vector.append(int(best_semi_d[row, semi_index]))
        vector.append(int(best_root_inspect[row]))
        vector.append(int(best_root_d[row]))
        vectors[row] = vector
    return {
        "profits": best_profit,
        "vectors": vectors,
        "inspected_core_policy_count": (1 << part_count) * (1 << semi_count) * len(itertools.product((0,), repeat=2)),
        "dominance_reduction": "semi disassembly is locally dominated after inspection-core selection; root disassembly remains enumerated",
    }


def _analyze_verified_q3(
    module: Any,
    topology: Any,
    constants: Mapping[str, Any],
    tolerance: float,
) -> dict[str, Any]:
    network = _q3_normalize_verified_network(module, topology)
    probabilities = np.asarray(
        [node["p"] for node in network["parts"]]
        + [node["p"] for node in network["semis"]]
        + [network["root"]["p"]],
        dtype=float,
    )
    parameter_count = len(probabilities)
    marginal_alpha = constants["family_alpha"] / parameter_count
    precision = [
        parameter_precision_n(float(value), marginal_alpha, constants["width_target"], constants["n_max"])
        for value in probabilities
    ]
    sample_sizes = [entry["n"] for entry in precision]
    sequence = np.random.SeedSequence([int(constants["seed"]), len(network["parts"])])
    baseline_stream, replicate_stream = sequence.spawn(len(itertools.product((False,), repeat=2)))
    baseline_rng = np.random.default_rng(baseline_stream)
    replicate_rng = np.random.default_rng(replicate_stream)
    baseline_x = [
        int(scipy_stats.binom.rvs(n, p, random_state=baseline_rng))
        for n, p in zip(sample_sizes, probabilities)
    ]
    replicate_x = np.column_stack(
        [
            scipy_stats.binom.rvs(n, p, size=constants["replicates"], random_state=replicate_rng)
            for n, p in zip(sample_sizes, probabilities)
        ]
    )
    baseline_hat = np.asarray(baseline_x, dtype=float) / np.asarray(sample_sizes, dtype=float)
    replicate_hat = replicate_x / np.asarray(sample_sizes, dtype=float)
    intervals = [
        clopper_pearson(x, n, marginal_alpha)
        for x, n in zip(baseline_x, sample_sizes)
    ]
    point_full = _q3_enumerate_full(network, baseline_hat, tolerance)
    reference_full = _q3_enumerate_full(network, probabilities, tolerance)
    lower = np.asarray([interval[0] for interval in intervals], dtype=float)
    upper = np.asarray([interval[1] for interval in intervals], dtype=float)
    lower_core = _q3_core_batch(network, lower[None, :], tolerance)
    upper_core = _q3_core_batch(network, upper[None, :], tolerance)
    point_core = _q3_core_batch(network, baseline_hat[None, :], tolerance)
    if abs(point_core["profits"][0] - point_full["profit"]) > tolerance:
        raise RuntimeError("Q3 支配约简结果与完整策略枚举不一致")
    monte_carlo = _q3_core_batch(network, replicate_hat, tolerance)
    reference_vector = np.asarray(reference_full["policy"], dtype=int)
    matches = np.all(monte_carlo["vectors"] == reference_vector, axis=1)
    return {
        "status": "conditional_scenario_without_observed_batch",
        "topology_source": "Q3_VERIFIED_TOPOLOGY only",
        "point_policy": point_full["policy"],
        "point_profit": point_full["profit"],
        "scenario_reference_policy": reference_full["policy"],
        "scenario_reference_profit": reference_full["profit"],
        "robust_policy": upper_core["vectors"][0].tolist(),
        "robust_profit_lower_bound": upper_core["profits"][0],
        "profit_interval": [upper_core["profits"][0], lower_core["profits"][0]],
        "sample_ledger": [
            {
                "node": f"node_{index}",
                "n": int(sample_sizes[index]),
                "x": int(baseline_x[index]),
                "scenario_probability": float(probabilities[index]),
                "p_hat": float(baseline_hat[index]),
                "lower": intervals[index][0],
                "upper": intervals[index][1],
            }
            for index in range(parameter_count)
        ],
        "monte_carlo": {
            "x": replicate_x.tolist(),
            "p_hat": replicate_hat.tolist(),
            "profit": monte_carlo["profits"].tolist(),
            "policy_vectors": monte_carlo["vectors"].tolist(),
            "matches_scenario_reference": matches.astype(int).tolist(),
        },
        "decision_consistency": float(np.mean(matches)),
        "full_policy_search": {
            "searched_policy_count": point_full["searched_policy_count"],
            "dominance_reduced_candidate_count": monte_carlo["inspected_core_policy_count"],
            "max_full_vs_reduced_gap": abs(point_core["profits"][0] - point_full["profit"]),
        },
        "classification_leakage_control": (
            "Only verified edge data and saved scenario x values enter point estimates; "
            "scenario probabilities are used only by the generator and reference-policy audit."
        ),
    }


def run_problem4(
    params_module: Any = None,
    output_path: str = "problem4_results.json",
    write_output: bool = True,
) -> dict[str, Any]:
    module = _params if params_module is None else params_module
    constants = {
        "family_alpha": float(
            _required_param(module, "Q4_FAMILY_ALPHA", "Q4_JOINT_FAMILY_ALPHA", "Q4_FAMILY_ERROR")
        ),
        "width_target": float(_required_param(module, "Q4_WIDTH_TARGET", "Q4_INTERVAL_WIDTH_TARGET")),
        "n_max": int(_required_param(module, "Q4_N_MAX", "Q4_SINGLE_PARAMETER_N_MAX")),
        "replicates": int(_required_param(module, "Q4_REPLICATES", "Q4_MC_REPLICATES", "Q4_SCENARIO_REPLICATES")),
        "seed": int(_required_param(module, "Q4_SEED", "Q4_RANDOM_SEED")),
        "n_grid": [
            int(value)
            for value in _required_param(module, "Q4_N_GRID", "Q4_SAMPLE_SIZE_GRID")
        ],
    }
    tolerance = float(
        _required_param(module, "CASHFLOW_ABS_TOL", "Q2_CASHFLOW_ABS_TOL", "VALUE_CASHFLOW_TOL")
    )
    constants["q1_tolerance"] = float(
        _required_param(module, "Q1_NUMERIC_TOL", "Q1_EXACT_ENUM_TOL", "Q1_TOL")
    )
    cases = normalize_q2_cases(module)
    expected_case_count = _optional_param(module, "Q2_CASE_COUNT", "TABLE1_CASE_COUNT")
    if expected_case_count is not None and len(cases) != int(expected_case_count):
        raise ValueError("Q2 情形数与参数登记不一致")

    marginal_alpha_q2 = constants["family_alpha"] / len(cases[0]["p1"] * ())
    declared_q2_alpha = _optional_param(module, "Q4_Q2_ALPHA", "Q4_Q2_BONFERRONI_ALPHA")
    if declared_q2_alpha is not None and abs(float(declared_q2_alpha) - marginal_alpha_q2) > constants["q1_tolerance"]:
        raise ValueError("Q2 Bonferroni 边际错误率与登记值不一致")

    q2_results: list[dict[str, Any]] = []
    q2_baseline_tables: list[dict[str, Any]] = []
    formula_gaps: list[float] = []
    ledger_gaps: list[float] = []
    bellman_residuals: list[float] = []
    absorption_probabilities: list[float] = []
    degenerate_checks: list[dict[str, Any]] = []

    for case_index, case in enumerate(cases):
        result = _analyze_q2_case(case, case_index, constants, tolerance)
        q2_results.append(result)
        baseline = enumerate_q2(case, tolerance)
        q2_baseline_tables.append(
            {
                "case_id": case["id"],
                "selected_policy": baseline["policy"],
                "selected_profit": baseline["profit"],
                "policy_table": baseline["policy_table"],
            }
        )
        for row in baseline["policy_table"]:
            if row["feasible"]:
                formula_gaps.append(row["formula_bellman_gap"])
                ledger_gaps.append(row["event_cash_ledger_gap"])
                bellman_residuals.append(row["bellman_residual"])
                absorption_probabilities.append(row["absorption_probability"])
        degenerate_checks.append(_q2_degenerate_equivalence(case, tolerance))

    adapter_check = _policy_adapter_self_test()
    verified_topology = _optional_param(
        module,
        "Q3_VERIFIED_TOPOLOGY",
        "Q3_VERIFIED_EDGE_LIST",
        "F_FIG1_VERIFIED_TOPOLOGY",
    )
    if verified_topology is None:
        q3_result = {
            "status": "blocked_missing_verified_figure1_edge_list",
            "official_outputs_available": False,
            "point_policy": None,
            "point_profit": None,
            "robust_policy": None,
            "profit_interval": None,
            "decision_consistency": None,
            "blocking_reason": (
                "题面事实仅确认工序数和零配件数，没有可校验父节点边集；"
                "登记的推断拓扑未被用于冒充正式问题三答案。"
            ),
            "required_to_unblock": [
                "图1原件或带来源校验的唯一父节点边表",
                "若继续情景分析，显式授权的情景 (n_v,x_v) 生成口径",
            ],
            "conditional_inference_executed_as_official_solution": False,
        }
    else:
        q3_result = _analyze_verified_q3(module, verified_topology, constants, tolerance)
        q3_result["official_outputs_available"] = False
        q3_result["conditional_inference_executed_as_official_solution"] = False

    max_formula_gap = max(formula_gaps)
    max_ledger_gap = max(ledger_gaps)
    max_bellman_residual = max(bellman_residuals)
    min_absorption = min(absorption_probabilities)
    max_degenerate_gap = max(entry["max_profit_gap"] for entry in degenerate_checks)
    cp_all_passed = all(result["cp_edge_tests"]["all_passed"] for result in q2_results)
    sample_rule_passed = all(
        all(not node["q1_sample_size_reused"] for node in result["sample_ledger"])
        for result in q2_results
    )

    checks = {
        "q2_formula_matches_bellman": max_formula_gap <= tolerance,
        "q2_bellman_matches_event_ledger": max_ledger_gap <= tolerance,
        "q2_bellman_residual": max_bellman_residual <= constants["q1_tolerance"],
        "q2_selected_strategies_absorbing": min_absorption >= 1 - tolerance,
        "q2_q3_degenerate_equivalence": max_degenerate_gap <= tolerance,
        "q2_cp_edge_and_exact_tests": cp_all_passed,
        "q2_precision_sample_design_independent_of_q1": sample_rule_passed,
        "q2_bonferroni_allocation": marginal_alpha_q2 * len(cases[0]["p1"] * ()) <= constants["family_alpha"] + constants["q1_tolerance"],
        "q3_policy_adapter_round_trip": adapter_check["passed"],
        "q3_missing_topology_is_blocked_not_inferred": verified_topology is None or q3_result["status"] == "conditional_scenario_without_observed_batch",
    }
    all_checks_pass = all(bool(value) for value in checks.values())

    payload = {
        "stage": "03-code",
        "problem": 4,
        "data_status": "scenario_only_no_observed_q4_batches",
        "model_constants_used": constants,
        "bonferroni": {
            "family_alpha": constants["family_alpha"],
            "q2_parameter_count": len(cases[0]["p1"] * ()),
            "q2_marginal_alpha": marginal_alpha_q2,
            "q3_parameter_count": _optional_param(module, "Q3_PARAMETER_COUNT", "Q4_Q3_PARAMETER_COUNT"),
        },
        "problem2": {
            "case_count": len(q2_results),
            "cases": q2_results,
            "baseline_policy_tables": q2_baseline_tables,
        },
        "problem3": q3_result,
        "validation": {
            "checks": checks,
            "all_checks_pass": all_checks_pass,
            "q2_formula_bellman_max_gap": max_formula_gap,
            "q2_event_ledger_max_gap": max_ledger_gap,
            "q2_bellman_max_residual": max_bellman_residual,
            "q2_min_absorption_probability": min_absorption,
            "q2_q3_degenerate_max_error": max_degenerate_gap,
            "q2_q3_degenerate_checks": degenerate_checks,
            "q3_policy_adapter_check": adapter_check,
        },
        "audit_dispositions": {
            "F-001_F-002": "问题一由 problem1.py 重跑；本模块不缓存或复用旧样本量。",
            "F-003": "不检测零件使用 P(good)=1-p、 P(bad)=p；边界与 Bellman 公式双算。",
            "F-004_F-009": "没有真实 Q4 批次时保存情景 (n,x)；没有经验证图1边表时问题三正式输出保持阻断。",
            "F-005": "Q3 Policy 向量长度按零件数加每个半成品两个决策再加根节点两个决策计算。",
            "F-006_F-007": "Q3 根节点无检测市场、调换、报废和拆解分支均进入单位合格利润公式；退化网络逐策略核验。",
            "F-008_F-009": "CP 显式处理零计数和全计数，并与精确二项定义交叉核验。",
            "F-010_F-011": "采用 Bonferroni 联合域，逐节点精度设计并输出样本量稳定性曲线。",
            "F-012": "全部结果同步写入 JSON；关键容差、吸收概率、退化差值、样本计数和通过标志均入账。",
        },
    }

    if not all_checks_pass:
        failed = [name for name, passed in checks.items() if not passed]
        raise RuntimeError("问题四关键验收失败: " + ", ".join(failed))

    if write_output:
        serialized = json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False)
        Path(output_path).write_text(serialized, encoding="utf-8")
    return payload


def solve_problem4(
    params_module: Any = None,
    output_path: str = "problem4_results.json",
    write_output: bool = True,
) -> dict[str, Any]:
    return run_problem4(params_module, output_path, write_output)


def solve(
    params_module: Any = None,
    output_path: str = "problem4_results.json",
    write_output: bool = True,
) -> dict[str, Any]:
    return run_problem4(params_module, output_path, write_output)


def run(
    params_module: Any = None,
    output_path: str = "problem4_results.json",
    write_output: bool = True,
) -> dict[str, Any]:
    return run_problem4(params_module, output_path, write_output)


if __name__ == "__main__":
    run_problem4()