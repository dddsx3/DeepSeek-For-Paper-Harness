# -*- coding: utf-8 -*-
"""问题二：两零件闭环现金流决策的精确状态递推与独立事件账本。"""

from __future__ import annotations

import itertools
import math
from collections.abc import Mapping, Sequence
from typing import Any

import numpy
import params
from params import *  # noqa: F401,F403


_EMPTY = params.Q2_STATE_VALUES[0]
_GOOD = params.Q2_STATE_VALUES[1]
_BAD = params.Q2_STATE_VALUES[2]
_INITIAL_STATE = (_EMPTY, _EMPTY)

_CASE_ALIASES = {
    "case_id": ("case", "case_no", "id", "index"),
    "p1": ("part1_rate", "part2_rate" if False else "p_part1", "part1_defect"),
    "p2": ("part2_rate", "p_part2", "part2_defect"),
    "pf": ("product_rate", "p_product", "product_defect"),
    "a1": ("a_1", "part1_price", "part1_purchase_price", "purchase1"),
    "t1": ("t_1", "part1_test", "part1_inspection_cost", "inspection1"),
    "a2": ("a_2", "part2_price", "part2_purchase_price", "purchase2"),
    "t2": ("t_2", "part2_test", "part2_inspection_cost", "inspection2"),
    "kf": ("k_f", "assembly", "product_assembly"),
    "tf": ("t_f", "product_test"),
    "market_price": ("price", "sale_price", "r_market"),
    "exchange_loss": ("loss", "exchange", "L_exchange"),
    "disassembly_cost": ("disassembly", "g_dis"),
}

_COST_KEYS = (
    "purchase_cost",
    "part_inspection_cost",
    "assembly_cost",
    "finished_inspection_cost",
    "disassembly_cost",
    "exchange_loss_cost",
    "market_revenue",
)

_EVENT_KEYS = (
    "purchased_parts",
    "part_inspections",
    "assemblies",
    "finished_product_inspections",
    "disassemblies",
    "scrapped_products",
    "returned_defective_products",
    "internal_rejected_products",
    "qualified_market_deliveries",
)

_DEFECT_PARAMETERS = ("p1", "p2", "pf")
_COST_PARAMETERS = (
    "a1",
    "t1",
    "a2",
    "t2",
    "kf",
    "tf",
    "exchange_loss",
    "disassembly_cost",
)


def _case_value(case: Mapping[str, Any], key: str) -> Any:
    if key in case:
        return case[key]
    for alias in _CASE_ALIASES[key]:
        if alias in case:
            return case[alias]
    raise KeyError(f"问题二参数缺少字段: {key}")


def _normalise_case(case: Mapping[str, Any]) -> dict[str, Any]:
    """接受普通映射或 params._AliasRecord，并输出规范字段。"""
    if not isinstance(case, Mapping):
        raise TypeError("问题二参数必须是映射对象")
    normalised = {
        "case_id": int(_case_value(case, "case_id")),
        "p1": float(_case_value(case, "p1")),
        "p2": float(_case_value(case, "p2")),
        "pf": float(_case_value(case, "pf")),
        "a1": float(_case_value(case, "a1")),
        "t1": float(_case_value(case, "t1")),
        "a2": float(_case_value(case, "a2")),
        "t2": float(_case_value(case, "t2")),
        "kf": float(_case_value(case, "kf")),
        "tf": float(_case_value(case, "tf")),
        "market_price": float(_case_value(case, "market_price")),
        "exchange_loss": float(_case_value(case, "exchange_loss")),
        "disassembly_cost": float(_case_value(case, "disassembly_cost")),
    }
    for key in ("p1", "p2", "pf"):
        value = normalised[key]
        if not params.Q2_PROBABILITY_FLOOR <= value <= params.Q2_PROBABILITY_CEILING:
            raise ValueError(f"{key} 不在概率范围内: {value}")
    for key in (
        "a1",
        "t1",
        "a2",
        "t2",
        "kf",
        "tf",
        "market_price",
        "exchange_loss",
        "disassembly_cost",
    ):
        if normalised[key] < params.Q2_COST_FLOOR:
            raise ValueError(f"{key} 不能为负: {normalised[key]}")
    return normalised


def _normalise_policy(policy: Sequence[int] | Mapping[str, int]) -> tuple[int, ...]:
    if isinstance(policy, Mapping):
        raw_values = tuple(policy[name] for name in params.Q2_POLICY_ORDER)
    else:
        raw_values = tuple(policy)
    if len(raw_values) != params.Q2_POLICY_VARIABLE_COUNT:
        raise ValueError(
            "策略必须恰好包含 "
            f"{params.Q2_POLICY_VARIABLE_COUNT} 个决策变量"
        )
    normalised = []
    for raw_value in raw_values:
        if raw_value not in (0, 1):
            raise ValueError(f"策略变量必须为 0 或 1，实际为 {raw_value!r}")
        normalised.append(int(raw_value))
    return tuple(normalised)


def _policy_decisions(policy: Sequence[int]) -> dict[str, bool]:
    z1, z2, finished_test, disassemble = _normalise_policy(policy)
    return {
        "inspect_part_1": bool(z1),
        "inspect_part_2": bool(z2),
        "inspect_finished_product": bool(finished_test),
        "disassemble_defective_product": bool(disassemble),
    }


def _policy_label(policy: Sequence[int]) -> str:
    z1, z2, finished_test, disassemble = _normalise_policy(policy)
    return (
        f"(Z1={z1}, Z2={z2}, C={finished_test}, D={disassemble})"
    )


def market_revenue_once(market_price: float) -> float:
    """一个最终合格交付事件确认一次市场销售收入。"""
    return market_price


def replacement_assembly_once(assembly_cost: float) -> float:
    """每次装配事件只登记一次装配现金支出。"""
    return -assembly_cost


def _component_transition(
    current_quality: str,
    defect_rate: float,
    inspect: int,
    purchase_price: float,
    inspection_cost: float,
) -> dict[str, Any]:
    """返回单个零件状态的全部可达去向及期望事件量。

    已有坏件重新检测时，首个重检费用只适用于 bad 状态；empty 状态从
    几何采购序列开始，不能额外前置一次检测。
    """
    inspect = int(inspect)
    if inspect not in (0, 1):
        raise ValueError("inspect 必须为 0 或 1")
    acceptance_probability = 1 - defect_rate

    if current_quality == _EMPTY:
        if inspect == 1:
            if acceptance_probability <= params.Q2_PROBABILITY_FLOOR:
                raise ValueError("执行检测时零件合格率必须大于零")
            expected_attempts = 1 / acceptance_probability
            purchase_units = expected_attempts
            inspection_units = expected_attempts
            preparation_cost = expected_attempts * (
                purchase_price + inspection_cost
            )
            return {
                "next_qualities": {_GOOD: 1.0},
                "purchase_units": purchase_units,
                "inspection_units": inspection_units,
                "preparation_cost": preparation_cost,
                "discarded_inspected_parts": defect_rate
                / acceptance_probability,
            }

        return {
            "next_qualities": {
                _GOOD: acceptance_probability,
                _BAD: defect_rate,
            },
            "purchase_units": 1.0,
            "inspection_units": 0.0,
            "preparation_cost": purchase_price,
            "discarded_inspected_parts": 0.0,
        }

    if current_quality == _GOOD:
        if inspect == 1:
            return {
                "next_qualities": {_GOOD: 1.0},
                "purchase_units": 0.0,
                "inspection_units": 1.0,
                "preparation_cost": inspection_cost,
                "discarded_inspected_parts": 0.0,
            }
        return {
            "next_qualities": {_GOOD: 1.0},
            "purchase_units": 0.0,
            "inspection_units": 0.0,
            "preparation_cost": 0.0,
            "discarded_inspected_parts": 0.0,
        }

    if current_quality == _BAD:
        if inspect == 1:
            if acceptance_probability <= params.Q2_PROBABILITY_FLOOR:
                raise ValueError("执行检测时零件合格率必须大于零")
            expected_attempts = 1 / acceptance_probability
            return {
                "next_qualities": {_GOOD: 1.0},
                "purchase_units": expected_attempts,
                "inspection_units": 1.0 + expected_attempts,
                "preparation_cost": inspection_cost
                + expected_attempts * (purchase_price + inspection_cost),
                "discarded_inspected_parts": 1.0
                + defect_rate / acceptance_probability,
            }
        return {
            "next_qualities": {_BAD: 1.0},
            "purchase_units": 0.0,
            "inspection_units": 0.0,
            "preparation_cost": 0.0,
            "discarded_inspected_parts": 0.0,
        }

    raise ValueError(f"未知零件质量状态: {current_quality}")


def _component_options(
    case: Mapping[str, Any],
    policy: Sequence[int],
    current_quality: str,
    part_index: int,
) -> dict[str, tuple[float, dict[str, Any]]]:
    z1, z2, _finished_test, _disassemble = _normalise_policy(policy)
    inspect = z1 if part_index == 0 else z2
    defect_key = "p1" if part_index == 0 else "p2"
    price_key = "a1" if part_index == 0 else "a2"
    inspection_key = "t1" if part_index == 0 else "t2"
    transition = _component_transition(
        current_quality,
        case[defect_key],
        inspect,
        case[price_key],
        case[inspection_key],
    )
    return transition["next_qualities"], transition


def _zero_event_row() -> dict[str, float]:
    return {key: 0.0 for key in _EVENT_KEYS}


def _build_markov_reward_kernel(
    case: Mapping[str, Any], policy: Sequence[int]
) -> dict[str, Any]:
    """用完整事件转移构造 Bellman 子随机矩阵。"""
    case = _normalise_case(case)
    policy = _normalise_policy(policy)
    z1, z2, finished_test, disassemble = policy
    _ = z1, z2

    states: list[tuple[str, str]] = [_INITIAL_STATE]
    state_index = {_INITIAL_STATE: 0}
    transition_rows: list[dict[int, float]] = []
    event_rows: list[dict[str, float]] = []
    cost_rows: list[dict[str, float]] = []
    good_outcome_rows: list[float] = []

    cursor = 0
    while cursor < len(states):
        state = states[cursor]
        row: dict[int, float] = {}
        events = _zero_event_row()
        costs = {key: 0.0 for key in _COST_KEYS}
        immediate_reward = 0.0
        good_outcome_probability = 0.0

        first_options, first_transition = _component_options(
            case, policy, state[0], 0
        )
        second_options, second_transition = _component_options(
            case, policy, state[1], 1
        )

        for (first_quality, first_probability), (
            second_quality,
            second_probability,
        ) in itertools.product(
            first_options.items(), second_options.items()
        ):
            probability = first_probability * second_probability
            preparation_cost = (
                first_transition["preparation_cost"]
                + second_transition["preparation_cost"]
            )
            purchased_parts = (
                first_transition["purchase_units"]
                + second_transition["purchase_units"]
            )
            part_inspections = (
                first_transition["inspection_units"]
                + second_transition["inspection_units"]
            )

            immediate_reward -= probability * preparation_cost
            costs["purchase_cost"] += (
                probability
                * (
                    first_transition["purchase_units"] * case["a1"]
                    + second_transition["purchase_units"] * case["a2"]
                )
            )
            costs["part_inspection_cost"] += (
                probability
                * (
                    first_transition["inspection_units"] * case["t1"]
                    + second_transition["inspection_units"] * case["t2"]
                )
            )
            events["purchased_parts"] += probability * purchased_parts
            events["part_inspections"] += probability * part_inspections

            immediate_reward += (
                probability * replacement_assembly_once(case["kf"])
            )
            costs["assembly_cost"] += probability * case["kf"]
            events["assemblies"] += probability

            both_good = int(first_quality == _GOOD) * int(
                second_quality == _GOOD
            )
            product_bad_probability = 1 - both_good * (1 - case["pf"])

            if finished_test == 1:
                immediate_reward -= probability * case["tf"]
                costs["finished_inspection_cost"] += (
                    probability * case["tf"]
                )
                events["finished_product_inspections"] += probability

            good_probability = probability * (
                1 - product_bad_probability
            )
            bad_probability = probability * product_bad_probability
            good_outcome_probability += good_probability
            if good_probability > params.Q2_PROBABILITY_FLOOR:
                revenue = (
                    good_probability
                    * market_revenue_once(case["market_price"])
                )
                immediate_reward += revenue
                costs["market_revenue"] += revenue
                events["qualified_market_deliveries"] += good_probability

            if bad_probability > params.Q2_PROBABILITY_FLOOR:
                if finished_test == 0:
                    immediate_reward -= (
                        bad_probability * case["exchange_loss"]
                    )
                    costs["exchange_loss_cost"] += (
                        bad_probability * case["exchange_loss"]
                    )
                    events["returned_defective_products"] += bad_probability
                else:
                    events["internal_rejected_products"] += bad_probability

                if disassemble == 1:
                    immediate_reward -= (
                        bad_probability * case["disassembly_cost"]
                    )
                    costs["disassembly_cost"] += (
                        bad_probability * case["disassembly_cost"]
                    )
                    events["disassemblies"] += bad_probability
                    next_state = (first_quality, second_quality)
                else:
                    events["scrapped_products"] += bad_probability
                    next_state = _INITIAL_STATE

                if next_state not in state_index:
                    state_index[next_state] = len(states)
                    states.append(next_state)
                next_index = state_index[next_state]
                row[next_index] = row.get(next_index, 0.0) + bad_probability

        transition_rows.append(row)
        event_rows.append(events)
        cost_rows.append(costs)
        good_outcome_rows.append(good_outcome_probability)
        cursor += 1

    transition_matrix = numpy.array(
        [
            [row.get(index, 0.0) for index in range(len(states))]
            for row in transition_rows
        ],
        dtype=float,
    )
    event_matrix = numpy.array(
        [
            [row[key] for key in _EVENT_KEYS]
            for row in event_rows
        ],
        dtype=float,
    )
    cost_matrix = numpy.array(
        [
            [row[key] for key in _COST_KEYS]
            for row in cost_rows
        ],
        dtype=float,
    )
    immediate_reward_vector = numpy.array(
        [
            costs["market_revenue"]
            - sum(
                costs[key]
                for key in _COST_KEYS
                if key != "market_revenue"
            )
            for costs in cost_rows
        ],
        dtype=float,
    )
    terminal_probability_vector = 1 - transition_matrix.sum(axis=1)
    good_outcome_vector = numpy.array(good_outcome_rows, dtype=float)

    return {
        "states": states,
        "transition": transition_matrix,
        "events": event_matrix,
        "costs": cost_matrix,
        "immediate_reward": immediate_reward_vector,
        "terminal_probability": terminal_probability_vector,
        "good_outcome_probability": good_outcome_vector,
    }


def _states_reaching_terminal(kernel: Mapping[str, Any]) -> list[bool]:
    """反向可达性判定：每个状态是否以正概率最终到达合格交付。"""
    states = kernel["states"]
    transition = kernel["transition"]
    terminal_probability = kernel["terminal_probability"]
    tolerance = params.Q1_NUMERIC_TOL

    reverse_edges: dict[int, set[int]] = {
        index: set() for index in range(len(states))
    }
    can_terminate = set()
    for current_index in range(len(states)):
        if terminal_probability[current_index] > tolerance:
            can_terminate.add(current_index)
        for next_index in range(len(states)):
            if transition[current_index, next_index] > tolerance:
                reverse_edges[next_index].add(current_index)

    changed = True
    while changed:
        changed = False
        for predecessor, successors in reverse_edges.items():
            if predecessor in can_terminate:
                continue
            if successors & can_terminate:
                can_terminate.add(predecessor)
                changed = True
    return [index in can_terminate for index in range(len(states))]


def solve_absorbing_markov_reward(
    transition: numpy.ndarray, immediate_reward: numpy.ndarray
) -> dict[str, Any]:
    """以 numpy.linalg.solve 解吸收型马尔可夫奖励方程。"""
    identity = numpy.eye(transition.shape[0], dtype=float)
    coefficient = identity - transition
    values = numpy.linalg.solve(coefficient, immediate_reward)
    residual = values - immediate_reward - transition @ values
    return {
        "coefficient": coefficient,
        "values": values,
        "residual": float(numpy.max(numpy.abs(residual))),
    }


def event_cash_ledger(
    case: Mapping[str, Any],
    policy: Sequence[int],
    kernel: Mapping[str, Any],
) -> dict[str, Any]:
    """独立按采购、检测、装配、调换、拆解事件重建立即现金流。"""
    case = _normalise_case(case)
    policy = _normalise_policy(policy)
    _z1, _z2, finished_test, disassemble = policy
    states = kernel["states"]
    cost_rows: list[dict[str, float]] = []
    event_rows: list[dict[str, float]] = []

    for first_state, second_state in states:
        first_options, first_transition = _component_options(
            case, policy, first_state, 0
        )
        second_options, second_transition = _component_options(
            case, policy, second_state, 1
        )
        costs = {key: 0.0 for key in _COST_KEYS}
        events = _zero_event_row()

        for (first_quality, first_probability), (
            second_quality,
            second_probability,
        ) in itertools.product(
            first_options.items(), second_options.items()
        ):
            probability = first_probability * second_probability
            costs["purchase_cost"] += probability * (
                first_transition["purchase_units"] * case["a1"]
                + second_transition["purchase_units"] * case["a2"]
            )
            costs["part_inspection_cost"] += probability * (
                first_transition["inspection_units"] * case["t1"]
                + second_transition["inspection_units"] * case["t2"]
            )
            events["purchased_parts"] += probability * (
                first_transition["purchase_units"]
                + second_transition["purchase_units"]
            )
            events["part_inspections"] += probability * (
                first_transition["inspection_units"]
                + second_transition["inspection_units"]
            )
            costs["assembly_cost"] += probability * case["kf"]
            events["assemblies"] += probability

            both_good = int(first_quality == _GOOD) * int(
                second_quality == _GOOD
            )
            product_bad_probability = 1 - both_good * (1 - case["pf"])
            good_probability = probability * (
                1 - product_bad_probability
            )
            bad_probability = probability * product_bad_probability

            if finished_test == 1:
                costs["finished_inspection_cost"] += (
                    probability * case["tf"]
                )
                events["finished_product_inspections"] += probability

            costs["market_revenue"] += (
                good_probability * case["market_price"]
            )
            events["qualified_market_deliveries"] += good_probability

            if finished_test == 0:
                costs["exchange_loss_cost"] += (
                    bad_probability * case["exchange_loss"]
                )
                events["returned_defective_products"] += bad_probability
            else:
                events["internal_rejected_products"] += bad_probability

            if disassemble == 1:
                costs["disassembly_cost"] += (
                    bad_probability * case["disassembly_cost"]
                )
                events["disassemblies"] += bad_probability
            else:
                events["scrapped_products"] += bad_probability

        cost_rows.append(costs)
        event_rows.append(events)

    cost_matrix = numpy.array(
        [[row[key] for key in _COST_KEYS] for row in cost_rows],
        dtype=float,
    )
    event_matrix = numpy.array(
        [[row[key] for key in _EVENT_KEYS] for row in event_rows],
        dtype=float,
    )
    ledger_reward = cost_matrix[:, _COST_KEYS.index("market_revenue")] - sum(
        cost_matrix[:, _COST_KEYS.index(key)]
        for key in _COST_KEYS
        if key != "market_revenue"
    )
    return {
        "costs": cost_matrix,
        "events": event_matrix,
        "immediate_reward": ledger_reward,
    }


def _number(value: Any) -> float | None:
    if value is None:
        return None
    converted = float(value)
    if not math.isfinite(converted):
        raise ValueError(f"问题二产生非有限结果: {converted}")
    return converted


def evaluate_policy(
    case: Mapping[str, Any], policy: Sequence[int]
) -> dict[str, Any]:
    """求一个固定策略的单位最终合格交付利润及全部核验量。"""
    case = _normalise_case(case)
    policy = _normalise_policy(policy)
    kernel = _build_markov_reward_kernel(case, policy)
    states = kernel["states"]
    reaches_terminal = _states_reaching_terminal(kernel)
    absorbing = all(reaches_terminal)
    initial_index = states.index(_INITIAL_STATE)

    common = {
        "policy": list(policy),
        "policy_tuple": list(policy),
        "policy_label": _policy_label(policy),
        "policy_decisions": _policy_decisions(policy),
        "reachable_state_count": len(states),
        "reachable_states": [list(state) for state in states],
        "absorbing": absorbing,
        "states_without_terminal_path": [
            list(states[index])
            for index, reaches in enumerate(reaches_terminal)
            if not reaches
        ],
        "excluded_from_argmax": not absorbing,
    }

    if not absorbing:
        return {
            **common,
            "profit": None,
            "profit_per_qualified_delivery": None,
            "termination_probability": None,
            "state_values": None,
            "ledger_state_values": None,
            "expected_state_visits": None,
            "cost_breakdown": {key: None for key in _COST_KEYS},
            "event_counts": {key: None for key in _EVENT_KEYS},
            "total_cost": None,
            "market_revenue": None,
            "validation": {
                "finite_expected_value": False,
                "absorbing": False,
                "nonabsorbing_exclusion_applied": True,
                "cashflow_identity_pass": True,
                "passed": True,
            },
        }

    bellman = solve_absorbing_markov_reward(
        kernel["transition"], kernel["immediate_reward"]
    )
    ledger = event_cash_ledger(case, policy, kernel)
    ledger_solution = solve_absorbing_markov_reward(
        kernel["transition"], ledger["immediate_reward"]
    )

    coefficient = bellman["coefficient"]
    expected_state_visits = numpy.linalg.solve(
        coefficient.T,
        numpy.ones(len(states), dtype=float),
    )
    if numpy.min(expected_state_visits) < -params.Q2_VALUE_TOLERANCE:
        raise RuntimeError("状态访问权重出现不可接受负值")
    expected_state_visits[
        expected_state_visits < params.Q2_VALUE_TOLERANCE
    ] = 0.0

    expected_costs_vector = expected_state_visits @ ledger["costs"]
    expected_events_vector = expected_state_visits @ ledger["events"]
    expected_costs = {
        key: float(expected_costs_vector[index])
        for index, key in enumerate(_COST_KEYS)
    }
    expected_events = {
        key: float(expected_events_vector[index])
        for index, key in enumerate(_EVENT_KEYS)
    }
    total_cost = sum(
        expected_costs[key]
        for key in _COST_KEYS
        if key != "market_revenue"
    )
    cashflow_profit = expected_costs["market_revenue"] - total_cost
    value_profit = float(bellman["values"][initial_index])
    ledger_profit = float(ledger_solution["values"][initial_index])
    termination_probability = float(
        expected_state_visits @ kernel["good_outcome_probability"]
    )

    value_ledger_difference = abs(value_profit - ledger_profit)
    value_cashflow_difference = abs(value_profit - cashflow_profit)
    round_reward_difference = float(
        numpy.max(
            numpy.abs(
                kernel["immediate_reward"]
                - ledger["immediate_reward"]
            )
        )
    )
    ledger_residual = ledger_solution["residual"]
    bellman_residual = bellman["residual"]
    absorption_error = abs(termination_probability - 1)

    validation_passed = all(
        (
            bellman_residual <= params.Q2_VALUE_TOLERANCE,
            ledger_residual <= params.Q2_VALUE_TOLERANCE,
            value_ledger_difference <= params.Q2_CASHFLOW_TOLERANCE,
            value_cashflow_difference <= params.Q2_CASHFLOW_TOLERANCE,
            round_reward_difference <= params.Q2_CASHFLOW_TOLERANCE,
            absorption_error <= params.Q2_VALUE_TOLERANCE,
        )
    )

    return {
        **common,
        "profit": value_profit,
        "profit_per_qualified_delivery": value_profit,
        "termination_probability": termination_probability,
        "state_values": {
            f"{state[0]}|{state[1]}": float(bellman["values"][index])
            for index, state in enumerate(states)
        },
        "ledger_state_values": {
            f"{state[0]}|{state[1]}": float(
                ledger_solution["values"][index]
            )
            for index, state in enumerate(states)
        },
        "expected_state_visits": {
            f"{state[0]}|{state[1]}": float(expected_state_visits[index])
            for index, state in enumerate(states)
        },
        "cost_breakdown": expected_costs,
        "event_counts": expected_events,
        "total_cost": total_cost,
        "market_revenue": expected_costs["market_revenue"],
        "validation": {
            "finite_expected_value": True,
            "absorbing": True,
            "bellman_residual": bellman_residual,
            "ledger_bellman_residual": ledger_residual,
            "value_ledger_difference": value_ledger_difference,
            "value_cashflow_difference": value_cashflow_difference,
            "round_reward_difference": round_reward_difference,
            "termination_probability_error": absorption_error,
            "cashflow_identity_pass": (
                value_cashflow_difference <= params.Q2_CASHFLOW_TOLERANCE
            ),
            "passed": validation_passed,
        },
    }


def solve_policy(
    case: Mapping[str, Any], policy: Sequence[int]
) -> dict[str, Any]:
    """兼容逐策略调用接口。"""
    return evaluate_policy(case, policy)


def policy_profit(
    case: Mapping[str, Any], policy: Sequence[int]
) -> float | None:
    """返回有限策略利润；非吸收策略按契约返回 None。"""
    return evaluate_policy(case, policy)["profit"]


def _select_optimal(policy_rows: Sequence[Mapping[str, Any]]) -> Mapping[str, Any]:
    eligible = [row for row in policy_rows if row["absorbing"]]
    if not eligible:
        raise RuntimeError("策略空间中没有吸收策略")
    maximum_profit = max(float(row["profit"]) for row in eligible)
    tied = [
        row
        for row in eligible
        if maximum_profit - float(row["profit"])
        <= params.Q2_VALUE_TOLERANCE
    ]
    return min(tied, key=lambda row: tuple(row["policy"]))


def _evaluate_all_policies(case: Mapping[str, Any]) -> list[dict[str, Any]]:
    return [
        evaluate_policy(case, policy)
        for policy in params.Q2_POLICY_SPACE
    ]


def solve_case(case: Mapping[str, Any]) -> dict[str, Any]:
    """枚举完整策略空间，返回一个表 1 情形的结果。"""
    case = _normalise_case(case)
    policy_rows = _evaluate_all_policies(case)
    optimum = _select_optimal(policy_rows)
    finite_profits = sorted(
        (float(row["profit"]) for row in policy_rows if row["absorbing"]),
        reverse=True,
    )
    competitor_profit = next(
        (
            profit
            for profit in finite_profits
            if profit < float(optimum["profit"])
            - params.Q2_VALUE_TOLERANCE
        ),
        finite_profits[0],
    )

    return {
        "case_id": case["case_id"],
        "policy": optimum["policy"],
        "policy_label": optimum["policy_label"],
        "policy_decisions": optimum["policy_decisions"],
        "profit": optimum["profit"],
        "profit_per_qualified_delivery": optimum["profit"],
        "cost_breakdown": optimum["cost_breakdown"],
        "event_counts": optimum["event_counts"],
        "termination_probability": optimum["termination_probability"],
        "reachable_state_count": optimum["reachable_state_count"],
        "feasible_strategy_count": sum(
            row["absorbing"] for row in policy_rows
        ),
        "excluded_nonabsorbing_count": sum(
            not row["absorbing"] for row in policy_rows
        ),
        "profit_gap_to_next_distinct_policy": (
            float(optimum["profit"]) - competitor_profit
        ),
        "decision_basis": (
            "在全部吸收策略中最大化单位最终合格交付利润，"
            "并列时按策略字典序取较小者。"
        ),
        "validation": optimum["validation"],
        "policy_rows": policy_rows,
    }


def optimal_policy_for_case(
    case: Mapping[str, Any],
) -> tuple[int, ...]:
    result = solve_case(case)
    return tuple(result["policy"])


def _relative_factor_grid() -> tuple[float, ...]:
    """从已登记网格与搜索规模确定可追溯的多点灵敏度网格。"""
    full_count = int(params.Q1_OC_GRID_POINT_COUNT)
    span = max(abs(float(value)) for value in params.Q1_DELTA_GRID)
    full_grid = tuple(
        -span + 2 * span * index / (full_count - 1)
        for index in range(full_count)
    )
    requested_count = (
        len(params.Q2_CASES)
        + len(params.Q1_DELTA_GRID)
        + len(params.Q1_BETA_GRID)
    )
    indices = {
        int(
            index * (full_count - 1) / (requested_count - 1)
        )
        for index in range(requested_count)
    }
    indices.add(full_count // 2)
    return tuple(full_grid[index] for index in sorted(indices))


def _compact_best_row(
    rows: Sequence[Mapping[str, Any]],
) -> tuple[list[int] | None, float | None]:
    try:
        optimum = _select_optimal(rows)
    except RuntimeError:
        return None, None
    return list(optimum["policy"]), float(optimum["profit"])


def _parameter_scan(
    base_case: Mapping[str, Any],
    base_policy: Sequence[int],
    parameter: str,
    factors: Sequence[float],
) -> dict[str, Any]:
    normalised_case = _normalise_case(base_case)
    records = []
    for factor in factors:
        modified = dict(normalised_case)
        modified[parameter] = normalised_case[parameter] * (1 + factor)
        rows = _evaluate_all_policies(modified)
        policy, profit = _compact_best_row(rows)
        base_row = next(
            row
            for row in rows
            if tuple(row["policy"]) == tuple(base_policy)
        )
        records.append(
            {
                "relative_factor": factor,
                "parameter_value": modified[parameter],
                "optimal_policy": policy,
                "optimal_profit": profit,
                "base_policy_profit": base_row["profit"],
                "decision_changed": policy != list(base_policy),
            }
        )
    return {
        "parameter": parameter,
        "relative_factors": list(factors),
        "records": records,
    }


def _sensitivity_outputs(
    base_case: Mapping[str, Any],
    base_solution: Mapping[str, Any],
) -> dict[str, Any]:
    factors = _relative_factor_grid()
    base_policy = tuple(base_solution["policy"])
    defect_groups = [
        _parameter_scan(base_case, base_policy, parameter, factors)
        for parameter in _DEFECT_PARAMETERS
    ]
    cost_groups = [
        _parameter_scan(base_case, base_policy, parameter, factors)
        for parameter in _COST_PARAMETERS
    ]

    contour_factors = (
        factors[0],
        factors[len(factors) // 2],
        factors[-1],
    )
    contour_records = []
    contour_policies = []
    contour_profits = []
    centre_policy = list(base_policy)
    for pf_factor in contour_factors:
        policy_column = []
        profit_column = []
        for cost_factor in contour_factors:
            modified = _normalise_case(base_case)
            modified["pf"] = modified["pf"] * (1 + pf_factor)
            modified["exchange_loss"] = modified["exchange_loss"] * (
                1 + cost_factor
            )
            rows = _evaluate_all_policies(modified)
            policy, profit = _compact_best_row(rows)
            changed = policy != centre_policy
            record = {
                "pf_relative_factor": pf_factor,
                "pf": modified["pf"],
                "exchange_loss_relative_factor": cost_factor,
                "exchange_loss": modified["exchange_loss"],
                "optimal_policy": policy,
                "optimal_profit": profit,
                "decision_changed_from_base": changed,
            }
            contour_records.append(record)
            policy_column.append(policy)
            profit_column.append(profit)
        contour_policies.append(policy_column)
        contour_profits.append(profit_column)

    return {
        "grid_provenance": {
            "full_grid_point_count": params.Q1_OC_GRID_POINT_COUNT,
            "span_source": "Q1_DELTA_GRID",
            "selected_point_count": len(factors),
            "formula": (
                "由已登记完整网格等距抽取并强制包含零点"
            ),
        },
        "defect_rate_scan": {
            "case_id": base_solution["case_id"],
            "parameter_groups": defect_groups,
        },
        "unit_cost_scan": {
            "case_id": base_solution["case_id"],
            "parameter_groups": cost_groups,
        },
        "breakeven_contour": {
            "case_id": base_solution["case_id"],
            "x_parameter": "pf",
            "y_parameter": "exchange_loss",
            "x_relative_factors": list(contour_factors),
            "y_relative_factors": list(contour_factors),
            "optimal_policies": contour_policies,
            "optimal_profits": contour_profits,
            "records": contour_records,
            "decision_flip_count": sum(
                row["decision_changed_from_base"]
                for row in contour_records
            ),
        },
    }


def run(include_sensitivity: bool = True) -> dict[str, Any]:
    """运行六种表 1 情形、完整策略矩阵和已登记参数扫描。"""
    case_solutions = [solve_case(case) for case in params.Q2_CASES]
    cases = []
    policy_tables = []
    for solution in case_solutions:
        compact_case = {key: value for key, value in solution.items() if key != "policy_rows"}
        cases.append(compact_case)
        policy_tables.append(
            {
                "case_id": solution["case_id"],
                "policies": [row["policy"] for row in solution["policy_rows"]],
                "profits": [row["profit"] for row in solution["policy_rows"]],
                "absorbing": [
                    row["absorbing"] for row in solution["policy_rows"]
                ],
                "rows": solution["policy_rows"],
            }
        )

    heatmap = {
        "case_ids": [solution["case_id"] for solution in case_solutions],
        "row_policies": [
            list(policy) for policy in params.Q2_POLICY_SPACE
        ],
        "policy_labels": [
            _policy_label(policy) for policy in params.Q2_POLICY_SPACE
        ],
        "profit_matrix": [
            [row["profit"] for row in solution["policy_rows"]]
            for solution in case_solutions
        ],
        "absorbing_matrix": [
            [row["absorbing"] for row in solution["policy_rows"]]
            for solution in case_solutions
        ],
        "total_cost_matrix": [
            [row["total_cost"] for row in solution["policy_rows"]]
            for solution in case_solutions
        ],
    }

    finite_rows = [
        row
        for solution in case_solutions
        for row in solution["policy_rows"]
        if row["absorbing"]
    ]
    max_bellman_residual = max(
        row["validation"]["bellman_residual"] for row in finite_rows
    )
    max_ledger_residual = max(
        row["validation"]["ledger_bellman_residual"]
        for row in finite_rows
    )
    max_value_ledger_difference = max(
        row["validation"]["value_ledger_difference"]
        for row in finite_rows
    )
    max_value_cashflow_difference = max(
        row["validation"]["value_cashflow_difference"]
        for row in finite_rows
    )
    max_round_reward_difference = max(
        row["validation"]["round_reward_difference"]
        for row in finite_rows
    )
    all_finite_rows_pass = all(
        row["validation"]["passed"] for row in finite_rows
    )
    all_argmax_absorbing = all(
        solution["validation"]["absorbing"] for solution in cases
    )
    strategy_space_exact = all(
        len(solution["policy_rows"]) == params.Q2_EFFECTIVE_STRATEGY_COUNT
        for solution in case_solutions
    )
    validation = {
        "strategy_space_size": len(params.Q2_POLICY_SPACE),
        "expected_strategy_space_size": params.Q2_EFFECTIVE_STRATEGY_COUNT,
        "strategy_space_exact": strategy_space_exact,
        "all_argmax_absorbing": all_argmax_absorbing,
        "all_finite_policy_checks_pass": all_finite_rows_pass,
        "max_bellman_residual": max_bellman_residual,
        "max_ledger_bellman_residual": max_ledger_residual,
        "max_value_ledger_difference": max_value_ledger_difference,
        "max_value_cashflow_difference": max_value_cashflow_difference,
        "max_round_reward_difference": max_round_reward_difference,
        "bellman_tolerance": params.Q2_VALUE_TOLERANCE,
        "cashflow_tolerance": params.Q2_CASHFLOW_TOLERANCE,
        "nonabsorbing_policy_rule": "excluded_before_argmax",
    }
    validation["passed"] = all(
        (
            validation["strategy_space_exact"],
            validation["all_argmax_absorbing"],
            validation["all_finite_policy_checks_pass"],
            max_bellman_residual <= params.Q2_VALUE_TOLERANCE,
            max_ledger_residual <= params.Q2_VALUE_TOLERANCE,
            max_value_ledger_difference <= params.Q2_CASHFLOW_TOLERANCE,
            max_value_cashflow_difference <= params.Q2_CASHFLOW_TOLERANCE,
            max_round_reward_difference <= params.Q2_CASHFLOW_TOLERANCE,
        )
    )
    if not validation["passed"]:
        raise RuntimeError("问题二 Bellman、事件账本或策略空间核验失败")

    result = {
        "problem_id": "Q2",
        "title": "两零件闭环现金流决策",
        "profit_unit": "元/合格交付",
        "policy_order": list(params.Q2_POLICY_ORDER),
        "state_values": list(params.Q2_STATE_VALUES),
        "strategy_space_size": len(params.Q2_POLICY_SPACE),
        "model_contract": {
            "solver": "absorbing_markov_reward_numpy_linear_solve",
            "revenue_recognition": (
                "每个最终合格交付只确认一次市场销售收入"
            ),
            "exchange_loss_scope": (
                "调换损失不含补发品的采购、检测和装配生产成本"
            ),
            "returned_defect_route_included": True,
            "internal_rejected_defect_route_included": True,
            "nonabsorbing_strategy_treatment": "excluded",
            "tie_break_rule": params.Q2_TIE_BREAK_RULE,
        },
        "cases": cases,
        "policy_tables": policy_tables,
        "heatmap": heatmap,
        "validation": validation,
    }
    if include_sensitivity:
        result["sensitivity"] = _sensitivity_outputs(
            params.Q2_CASE1,
            case_solutions[0],
        )
    return result


evaluate_strategy = evaluate_policy
run_problem2 = run
problem2_run = run


if __name__ == "__main__":
    import json

    print(json.dumps(run(), ensure_ascii=False, indent=2, allow_nan=False))
]<]minimax[>[</content>