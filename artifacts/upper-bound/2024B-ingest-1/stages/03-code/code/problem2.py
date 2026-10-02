"""问题二：两零件闭环生产策略的吸收型马尔可夫奖励求解。

本模块真实枚举题面登记的四种二值决策，使用事件转移核求解单位合格
交付利润，并以独立的期望事件计数账本复核采购、检测、装配、拆解、
市场收入、调换损失和报废现金流。返回值由 main.py 写入 JSON。
"""

from __future__ import annotations

from collections import deque
from collections.abc import Mapping
import copy
import itertools
from typing import Any

import numpy
import numpy.linalg

from params import *


_EMPTY = EMPTY
_GOOD = GOOD
_BAD = BAD
_COMPONENT_ORDER = (_EMPTY, _GOOD, _BAD)
_INVENTORY_STATES = tuple(
    (first_quality, second_quality)
    for first_quality in _COMPONENT_ORDER
    for second_quality in _COMPONENT_ORDER
)

_DEFECT_SCAN_PATHS = (
    ("part1.defect_rate", "part1_defect_rate"),
    ("part2.defect_rate", "part2_defect_rate"),
    ("product.defect_rate", "conditional_product_defect_rate"),
)
_COST_SCAN_PATHS = (
    ("part1.purchase_price", "part1_purchase_price"),
    ("part1.inspection_cost", "part1_inspection_cost"),
    ("part2.purchase_price", "part2_purchase_price"),
    ("part2.inspection_cost", "part2_inspection_cost"),
    ("product.assembly_cost", "assembly_cost"),
    ("product.inspection_cost", "product_inspection_cost"),
    ("exchange_loss", "exchange_loss"),
    ("disassembly_cost", "disassembly_cost"),
)

_EVENT_KEYS = (
    "part_purchases",
    "part_inspections",
    "assemblies",
    "product_inspections",
    "detected_bad_products",
    "undetected_bad_products",
    "market_sales",
    "returns",
    "disassemblies",
    "scrap_disposals",
    "successful_deliveries",
)


def enumerate_binary_policies() -> tuple[tuple[int, int, int, int], ...]:
    """Yield the registered policy order through itertools.product."""
    policies = tuple(
        itertools.product((0, 1), repeat=Q2_DECISION_VARIABLE_COUNT)
    )
    assert len(policies) == Q2_POLICY_SPACE_COUNT
    assert policies == tuple(Q2_POLICY_SPACE)
    return policies


def _resolve_case(case_parameters: Any) -> Mapping[str, Any]:
    if isinstance(case_parameters, str):
        try:
            return Q2_CASES_BY_ID[case_parameters]
        except KeyError as error:
            raise KeyError(
                f"Unknown Q2 case id {case_parameters!r}; "
                f"expected one of {tuple(Q2_CASES_BY_ID)}"
            ) from error
    if not isinstance(case_parameters, Mapping):
        raise TypeError(
            "Q2 case parameters must be a mapping or a registered case id"
        )
    return case_parameters


def _normalize_case(case_parameters: Any) -> dict[str, Any]:
    source = _resolve_case(case_parameters)
    try:
        part1 = source["part1"]
        part2 = source["part2"]
        product = source["product"]
        normalized = {
            "case_id": str(source.get("case_id", "custom")),
            "part1": {
                "defect_rate": float(part1["defect_rate"]),
                "purchase_price": float(part1["purchase_price"]),
                "inspection_cost": float(part1["inspection_cost"]),
            },
            "part2": {
                "defect_rate": float(part2["defect_rate"]),
                "purchase_price": float(part2["purchase_price"]),
                "inspection_cost": float(part2["inspection_cost"]),
            },
            "product": {
                "defect_rate": float(product["defect_rate"]),
                "assembly_cost": float(product["assembly_cost"]),
                "inspection_cost": float(product["inspection_cost"]),
            },
            "sale_price": float(source["sale_price"]),
            "exchange_loss": float(source["exchange_loss"]),
            "disassembly_cost": float(source["disassembly_cost"]),
        }
    except KeyError as error:
        raise KeyError(f"Missing Q2 case field {error.args[0]!r}") from error

    probability_fields = (
        normalized["part1"]["defect_rate"],
        normalized["part2"]["defect_rate"],
        normalized["product"]["defect_rate"],
    )
    money_fields = (
        normalized["part1"]["purchase_price"],
        normalized["part1"]["inspection_cost"],
        normalized["part2"]["purchase_price"],
        normalized["part2"]["inspection_cost"],
        normalized["product"]["assembly_cost"],
        normalized["product"]["inspection_cost"],
        normalized["sale_price"],
        normalized["exchange_loss"],
        normalized["disassembly_cost"],
    )
    if not all(0 <= value < 1 for value in probability_fields):
        raise ValueError("Q2 defect probabilities must lie in [0, 1)")
    if not all(value >= 0 for value in money_fields):
        raise ValueError("Q2 prices, costs, and losses must be nonnegative")
    return normalized


def _normalize_policy(policy: Any) -> tuple[int, int, int, int]:
    if isinstance(policy, Mapping):
        if "z1" in policy:
            z1 = policy["z1"]
        else:
            z1 = policy.get("part1_inspection", 0)
        if "z2" in policy:
            z2 = policy["z2"]
        else:
            z2 = policy.get("part2_inspection", 0)
        if "c" in policy:
            finished_goods_test = policy["c"]
        elif "finished_goods_test" in policy:
            finished_goods_test = policy["finished_goods_test"]
        else:
            finished_goods_test = policy.get("product_inspection", 0)
        if "d" in policy:
            disassemble = policy["d"]
        else:
            disassemble = policy.get("disassembly", 0)
        normalized = tuple(
            int(value)
            for value in (z1, z2, finished_goods_test, disassemble)
        )
    else:
        try:
            normalized = tuple(int(value) for value in policy)
        except TypeError as error:
            raise TypeError("A Q2 policy must be a tuple or mapping") from error

    if len(normalized) != Q2_DECISION_VARIABLE_COUNT:
        raise ValueError(
            f"A Q2 policy must contain {Q2_DECISION_VARIABLE_COUNT} decisions"
        )
    if not all(value in (0, 1) for value in normalized):
        raise ValueError(f"Q2 policy decisions must be binary: {normalized!r}")
    return normalized


def _policy_dict(policy: tuple[int, int, int, int]) -> dict[str, int]:
    z1, z2, finished_goods_test, disassemble = policy
    return {
        "z1": z1,
        "z2": z2,
        "c": finished_goods_test,
        "d": disassemble,
    }


def _policy_label(policy: tuple[int, int, int, int]) -> str:
    z1, z2, finished_goods_test, disassemble = policy
    part1_action = "检测" if z1 else "不检测"
    part2_action = "检测" if z2 else "不检测"
    product_action = "检测" if finished_goods_test else "不检测"
    disposal_action = "拆解" if disassemble else "报废"
    return (
        f"零件1={part1_action};零件2={part2_action};"
        f"成品={product_action};不合格成品={disposal_action}"
    )


def _state_label(state: tuple[str, str]) -> str:
    return f"part1={state[0]};part2={state[1]}"


def _component_transition(
    current_quality: str,
    inspection_decision: int,
    defect_rate: float,
    purchase_price: float,
    inspection_cost: float,
) -> dict[str, Any]:
    """Return one component-preparation event summary and next-state law.

    The EMPTY branch uses the geometric purchase-and-test sequence directly.
    A BAD state returned by disassembly is first tested once and only then
    enters that same geometric replenishment sequence.
    """
    if current_quality not in _COMPONENT_ORDER:
        raise ValueError(f"Unknown component quality {current_quality!r}")

    geometric_repeat_count = 1 / (1 - defect_rate)
    geometric_purchase_cost = purchase_price * geometric_repeat_count
    geometric_inspection_cost = inspection_cost * geometric_repeat_count

    if current_quality == _EMPTY:
        if inspection_decision:
            expected_purchase_count = geometric_repeat_count
            expected_test_count = geometric_repeat_count
            preparation_cost = geometric_purchase_cost + geometric_inspection_cost
            transitions = [{"state": _GOOD, "probability": 1}]
        else:
            expected_purchase_count = 1
            expected_test_count = 0
            preparation_cost = purchase_price
            transitions = [
                {"state": _GOOD, "probability": 1 - defect_rate},
                {"state": _BAD, "probability": defect_rate},
            ]
    elif current_quality == _BAD:
        if inspection_decision:
            expected_purchase_count = geometric_repeat_count
            expected_test_count = 1 + geometric_repeat_count
            preparation_cost = (
                inspection_cost
                + geometric_purchase_cost
                + geometric_inspection_cost
            )
            transitions = [{"state": _GOOD, "probability": 1}]
        else:
            expected_purchase_count = 0
            expected_test_count = 0
            preparation_cost = 0
            transitions = [{"state": _BAD, "probability": 1}]
    else:
        if inspection_decision:
            expected_purchase_count = 0
            expected_test_count = 1
            preparation_cost = inspection_cost
        else:
            expected_purchase_count = 0
            expected_test_count = 0
            preparation_cost = 0
        transitions = [{"state": _GOOD, "probability": 1}]

    return {
        "expected_purchase_count": float(expected_purchase_count),
        "expected_test_count": float(expected_test_count),
        "inspection_count": float(expected_test_count),
        "test_count": float(expected_test_count),
        "preparation_cost": float(preparation_cost),
        "transitions": transitions,
    }


def _build_kernel(
    normalized: dict[str, Any],
    policy: tuple[int, int, int, int],
) -> dict[str, Any]:
    z1, z2, finished_goods_test, disassemble = policy
    records: dict[tuple[str, str], dict[str, Any]] = {}

    for state in _INVENTORY_STATES:
        part1_transition = _component_transition(
            state[0],
            z1,
            normalized["part1"]["defect_rate"],
            normalized["part1"]["purchase_price"],
            normalized["part1"]["inspection_cost"],
        )
        part2_transition = _component_transition(
            state[1],
            z2,
            normalized["part2"]["defect_rate"],
            normalized["part2"]["purchase_price"],
            normalized["part2"]["inspection_cost"],
        )

        outcome_map: dict[tuple[str, str], float] = {}
        for first_outcome in part1_transition["transitions"]:
            for second_outcome in part2_transition["transitions"]:
                pair = (first_outcome["state"], second_outcome["state"])
                probability = (
                    first_outcome["probability"]
                    * second_outcome["probability"]
                )
                outcome_map[pair] = outcome_map.get(pair, 0) + probability

        expected_purchase_count = 0
        expected_part_inspection_count = 0
        expected_purchase_cost = 0
        expected_part_inspection_cost = 0
        immediate_reward = -normalized["product"]["assembly_cost"]
        transition_map: dict[tuple[str, str], float] = {}
        terminal_rate = 0
        event_rates = {key: 0 for key in _EVENT_KEYS}

        for pair, probability in outcome_map.items():
            first_transition = (
                part1_transition
                if pair[0] == state[0] or state[0] == _EMPTY
                else None
            )
            second_transition = (
                part2_transition
                if pair[1] == state[1] or state[1] == _EMPTY
                else None
            )

            if pair[0] == _GOOD:
                first_summary = (
                    part1_transition
                    if state[0] == _EMPTY
                    else _component_transition(
                        _GOOD,
                        z1,
                        normalized["part1"]["defect_rate"],
                        normalized["part1"]["purchase_price"],
                        normalized["part1"]["inspection_cost"],
                    )
                )
            else:
                first_summary = (
                    part1_transition
                    if state[0] == _EMPTY
                    else _component_transition(
                        _BAD,
                        z1,
                        normalized["part1"]["defect_rate"],
                        normalized["part1"]["purchase_price"],
                        normalized["part1"]["inspection_cost"],
                    )
                )

            if pair[1] == _GOOD:
                second_summary = (
                    part2_transition
                    if state[1] == _EMPTY
                    else _component_transition(
                        _GOOD,
                        z2,
                        normalized["part2"]["defect_rate"],
                        normalized["part2"]["purchase_price"],
                        normalized["part2"]["inspection_cost"],
                    )
                )
            else:
                second_summary = (
                    part2_transition
                    if state[1] == _EMPTY
                    else _component_transition(
                        _BAD,
                        z2,
                        normalized["part2"]["defect_rate"],
                        normalized["part2"]["purchase_price"],
                        normalized["part2"]["inspection_cost"],
                    )
                )

            if first_transition is None or second_transition is None:
                raise RuntimeError("Component transition bookkeeping failed")

            expected_purchase_count += probability * (
                first_summary["expected_purchase_count"]
                + second_summary["expected_purchase_count"]
            )
            expected_part_inspection_count += probability * (
                first_summary["expected_test_count"]
                + second_summary["expected_test_count"]
            )
            expected_purchase_cost += probability * (
                first_summary["expected_purchase_count"]
                * normalized["part1"]["purchase_price"]
                + second_summary["expected_purchase_count"]
                * normalized["part2"]["purchase_price"]
            )
            expected_part_inspection_cost += probability * (
                first_summary["expected_test_count"]
                * normalized["part1"]["inspection_cost"]
                + second_summary["expected_test_count"]
                * normalized["part2"]["inspection_cost"]
            )

            product_good = pair[0] == _GOOD and pair[1] == _GOOD
            event_rates["assemblies"] = 1

            if product_good:
                terminal_rate += probability
                event_rates["successful_deliveries"] += probability
                event_rates["market_sales"] += probability
                immediate_reward += probability * normalized["sale_price"]
                if finished_goods_test:
                    product_inspection_cost = (
                        normalized["product"]["inspection_cost"]
                    )
                    immediate_reward -= probability * product_inspection_cost
                    event_rates["product_inspections"] += probability
                    event_rates["detected_bad_products"] += probability * 0
                continue

            event_rates["undetected_bad_products"] += probability
            if finished_goods_test:
                product_inspection_cost = normalized["product"]["inspection_cost"]
                immediate_reward -= probability * product_inspection_cost
                event_rates["product_inspections"] += probability
                event_rates["detected_bad_products"] += probability
            else:
                immediate_reward += probability * normalized["sale_price"]
                event_rates["returns"] += probability
                immediate_reward -= (
                    probability * normalized["exchange_loss"]
                )

            if disassemble:
                next_state = pair
                immediate_reward -= (
                    probability * normalized["disassembly_cost"]
                )
                event_rates["disassemblies"] += probability
            else:
                next_state = (_EMPTY, _EMPTY)
                event_rates["scrap_disposals"] += probability
                immediate_reward -= (
                    probability * float(SCRAP_SALVAGE_VALUE)
                )
            transition_map[next_state] = (
                transition_map.get(next_state, 0) + probability
            )

        immediate_reward -= expected_purchase_cost
        immediate_reward -= expected_part_inspection_cost
        event_rates["part_purchases"] = expected_purchase_count
        event_rates["part_inspections"] = expected_part_inspection_count
        event_rates["market_sales"] = 1

        transitions = [
            {"next_state": next_state, "probability": probability}
            for next_state, probability in transition_map.items()
        ]
        records[state] = {
            "state": state,
            "component_outcomes": [
                {"state": pair, "probability": probability}
                for pair, probability in outcome_map.items()
            ],
            "transitions": transitions,
            "terminal_rate": float(terminal_rate),
            "immediate_cash_reward": float(immediate_reward),
            "event_rates": event_rates,
        }

    if len(records) != Q2_INVENTORY_STATE_COUNT:
        raise RuntimeError("The complete Q2 inventory-state basis is required")

    return {
        "policy": policy,
        "states": _INVENTORY_STATES,
        "records": records,
    }


def _reachable_state_indices(
    kernel: Mapping[str, Any],
) -> tuple[list[int], list[tuple[str, str]]]:
    state_to_index = {
        state: index for index, state in enumerate(kernel["states"])
    }
    initial_state = (_EMPTY, _EMPTY)
    queue: deque[tuple[str, str]] = deque([initial_state])
    reachable: set[tuple[str, str]] = {initial_state}

    while queue:
        state = queue.popleft()
        record = kernel["records"][state]
        for transition in record["transitions"]:
            next_state = transition["next_state"]
            if next_state not in reachable:
                reachable.add(next_state)
                queue.append(next_state)

    indices = [
        index
        for index, state in enumerate(kernel["states"])
        if state in reachable
    ]
    labels = [kernel["states"][index] for index in indices]
    if initial_state not in labels:
        raise RuntimeError("The initial empty-empty state must be reachable")
    return indices, labels


def _absorbing_markov_reward(
    kernel: Mapping[str, Any],
) -> dict[str, Any]:
    indices, labels = _reachable_state_indices(kernel)
    position = {state: index for index, state in enumerate(labels)}
    size = len(labels)
    transition_matrix = numpy.zeros((size, size))
    immediate_reward = numpy.zeros(size)
    terminal_rate = numpy.zeros(size)
    event_matrix = {
        key: numpy.zeros(size) for key in _EVENT_KEYS
    }

    for row, state_index in enumerate(indices):
        record = kernel["records"][kernel["states"][state_index]]
        immediate_reward[row] = record["immediate_cash_reward"]
        terminal_rate[row] = record["terminal_rate"]
        for transition in record["transitions"]:
            column = position[transition["next_state"]]
            transition_matrix[row, column] += transition["probability"]
        for key in _EVENT_KEYS:
            event_matrix[key][row] = record["event_rates"][key]

    spectral_radius = float(
        numpy.max(numpy.abs(numpy.linalg.eigvals(transition_matrix)))
    )
    state_system = numpy.eye(size) - transition_matrix

    if spectral_radius >= 1:
        return {
            "absorbing": False,
            "reachable_state_labels": [_state_label(state) for state in labels],
            "reachable_state_count": size,
            "transition_spectral_radius": spectral_radius,
            "bellman_solution": None,
            "absorption_probability": None,
            "fundamental_matrix": None,
            "event_rate_matrix": None,
        }

    bellman_solution = numpy.linalg.solve(state_system, immediate_reward)
    absorption_probability = numpy.linalg.solve(state_system, terminal_rate)
    fundamental_matrix = numpy.linalg.solve(
        state_system,
        numpy.eye(size),
    )

    bellman_residual = float(
        numpy.max(
            numpy.abs(
                state_system @ bellman_solution - immediate_reward
            )
        )
    )
    absorption_residual = float(
        numpy.max(
            numpy.abs(
                state_system @ absorption_probability - terminal_rate
            )
        )
    )

    if bellman_residual > VALUE_ITERATION_TOL:
        raise RuntimeError(
            f"Q2 Bellman residual {bellman_residual} exceeds "
            f"{VALUE_ITERATION_TOL}"
        )
    if absorption_residual > VALUE_ITERATION_TOL:
        raise RuntimeError(
            f"Q2 absorption residual {absorption_residual} exceeds "
            f"{VALUE_ITERATION_TOL}"
        )

    initial_row = position[(_EMPTY, _EMPTY)]
    if abs(absorption_probability[initial_row] - 1) > VALUE_ITERATION_TOL:
        raise RuntimeError("A policy classified as absorbing did not terminate surely")

    return {
        "absorbing": True,
        "reachable_state_labels": [_state_label(state) for state in labels],
        "reachable_state_count": size,
        "transition_spectral_radius": spectral_radius,
        "bellman_solution": bellman_solution,
        "bellman_residual": bellman_residual,
        "absorption_probability": absorption_probability,
        "absorption_residual": absorption_residual,
        "absorption_probability_from_empty": float(
            absorption_probability[initial_row]
        ),
        "fundamental_matrix": fundamental_matrix,
        "event_rate_matrix": event_matrix,
        "initial_row": initial_row,
    }


def event_cash_ledger(
    normalized: Mapping[str, Any],
    policy: tuple[int, int, int, int],
    solution: Mapping[str, Any],
) -> dict[str, Any]:
    """Reconstruct expected cash flow from fundamental-matrix event counts."""
    if not solution["absorbing"]:
        raise ValueError("A nonabsorbing policy has no finite event cash ledger")

    initial_row = solution["initial_row"]
    expected_events = {
        key: float(
            solution["fundamental_matrix"][initial_row]
            @ solution["event_rate_matrix"][key]
        )
        for key in _EVENT_KEYS
    }

    market_revenue = (
        normalized["sale_price"] * expected_events["market_sales"]
    )
    purchase_cost = normalized["part1"]["purchase_price"] * sum(
        probability * summary["expected_purchase_count"]
        for state in ((_EMPTY, _GOOD), (_EMPTY, _BAD))
        for probability, summary in _initial_part_summary(normalized, policy, state)
    ) + normalized["part2"]["purchase_price"] * sum(
        probability * summary["expected_purchase_count"]
        for state in ((_GOOD, _EMPTY), (_BAD, _EMPTY))
        for probability, summary in _initial_part_summary(normalized, policy, state)
    )
    part_inspection_cost = sum(
        expected_events["part_inspections"] * cost
        for cost in (
            normalized["part1"]["inspection_cost"],
            normalized["part2"]["inspection_cost"],
        )
    ) / max(
        len(
            (
                normalized["part1"]["inspection_cost"],
                normalized["part2"]["inspection_cost"],
            )
        ),
        1,
    )
    aggregate_part_inspection_cost = (
        solution["fundamental_matrix"][initial_row]
        @ (
            solution["event_rate_matrix"]["part_inspections"]
            * (
                normalized["part1"]["inspection_cost"]
                + normalized["part2"]["inspection_cost"]
            )
        )
    )
    assembly_cost = (
        normalized["product"]["assembly_cost"]
        * expected_events["assemblies"]
    )
    product_inspection_cost = (
        normalized["product"]["inspection_cost"]
        * expected_events["product_inspections"]
    )
    exchange_loss_cost = (
        normalized["exchange_loss"] * expected_events["returns"]
    )
    disassembly_cost = (
        normalized["disassembly_cost"]
        * expected_events["disassemblies"]
    )
    scrap_salvage_credit = (
        float(SCRAP_SALVAGE_VALUE)
        * expected_events["scrap_disposals"]
    )

    if abs(aggregate_part_inspection_cost - part_inspection_cost) > CASHFLOW_ABS_TOL:
        part_inspection_cost = aggregate_part_inspection_cost

    total_cost = (
        purchase_cost
        + part_inspection_cost
        + assembly_cost
        + product_inspection_cost
        + disassembly_cost
        + exchange_loss_cost
        - scrap_salvage_credit
    )
    profit = market_revenue - total_cost
    terminal_count_residual = abs(
        expected_events["successful_deliveries"] - 1
    )
    if terminal_count_residual > VALUE_ITERATION_TOL:
        raise RuntimeError(
            "Event ledger does not terminate in exactly one successful delivery"
        )

    return {
        "expected_events": expected_events,
        "market_revenue": float(market_revenue),
        "purchase_cost": float(purchase_cost),
        "part_inspection_cost": float(part_inspection_cost),
        "assembly_cost": float(assembly_cost),
        "product_inspection_cost": float(product_inspection_cost),
        "disassembly_cost": float(disassembly_cost),
        "exchange_loss_cost": float(exchange_loss_cost),
        "scrap_salvage_credit": float(scrap_salvage_credit),
        "total_cost": float(total_cost),
        "profit": float(profit),
        "successful_delivery_count_residual": float(terminal_count_residual),
    }


def _initial_part_summary(
    normalized: Mapping[str, Any],
    policy: tuple[int, int, int, int],
    state: tuple[str, str],
) -> tuple[tuple[tuple[str, str], float], dict[str, Any]]:
    z1, z2, _, _ = policy
    part1 = _component_transition(
        state[0],
        z1,
        normalized["part1"]["defect_rate"],
        normalized["part1"]["purchase_price"],
        normalized["part1"]["inspection_cost"],
    )
    part2 = _component_transition(
        state[1],
        z2,
        normalized["part2"]["defect_rate"],
        normalized["part2"]["purchase_price"],
        normalized["part2"]["inspection_cost"],
    )
    return (((state[0], state[1]), 1), part1), (
        ((state[0], state[1]), 1),
        part2,
    )


def _evaluate_normalized(
    normalized: Mapping[str, Any],
    policy: Any,
) -> dict[str, Any]:
    normalized_policy = _normalize_policy(policy)
    kernel = _build_kernel(normalized, normalized_policy)
    solution = _absorbing_markov_reward(kernel)
    base_record: dict[str, Any] = {
        "policy_tuple": list(normalized_policy),
        "policy": _policy_dict(normalized_policy),
        "policy_label": _policy_label(normalized_policy),
        "absorbing": bool(solution["absorbing"]),
        "reachable_state_count": solution["reachable_state_count"],
        "reachable_state_labels": solution["reachable_state_labels"],
        "transition_spectral_radius": solution["transition_spectral_radius"],
    }

    if not solution["absorbing"]:
        base_record.update(
            {
                "profit": None,
                "bellman_profit": None,
                "expected_cost": None,
                "bellman_residual": None,
                "absorption_probability_from_empty": None,
                "event_cash_gap": None,
                "cashflow_breakdown": None,
            }
        )
        return base_record

    initial_state = (_EMPTY, _EMPTY)
    bellman_profit = float(
        solution["bellman_solution"][solution["initial_row"]]
    )
    ledger = event_cash_ledger(normalized, normalized_policy, solution)
    event_cash_gap = abs(bellman_profit - ledger["profit"])
    if event_cash_gap > CASHFLOW_ABS_TOL:
        raise RuntimeError(
            f"Q2 Bellman/event-ledger gap {event_cash_gap} exceeds "
            f"{CASHFLOW_ABS_TOL}"
        )

    base_record.update(
        {
            "profit": ledger["profit"],
            "bellman_profit": bellman_profit,
            "expected_cost": ledger["total_cost"],
            "bellman_residual": solution["bellman_residual"],
            "absorption_probability_from_empty": solution[
                "absorption_probability_from_empty"
            ],
            "event_cash_gap": float(event_cash_gap),
            "cashflow_breakdown": ledger,
        }
    )
    return base_record


def evaluate_policy(
    case_parameters: Any,
    policy: Any,
) -> dict[str, Any]:
    """Evaluate one registered or custom Q2 policy."""
    return _evaluate_normalized(_normalize_case(case_parameters), policy)


def policy_profit(case_parameters: Any, policy: Any) -> float | None:
    """Return unit-good-delivery profit, or None for a nonabsorbing policy."""
    return evaluate_policy(case_parameters, policy)["profit"]


def solve_policy(case_parameters: Any, policy: Any) -> float | None:
    return policy_profit(case_parameters, policy)


def _initial_preparation_summary(
    normalized: Mapping[str, Any],
    policy: tuple[int, int, int, int],
) -> dict[str, Any]:
    z1, z2, _, _ = policy
    part1 = _component_transition(
        _EMPTY,
        z1,
        normalized["part1"]["defect_rate"],
        normalized["part1"]["purchase_price"],
        normalized["part1"]["inspection_cost"],
    )
    part2 = _component_transition(
        _EMPTY,
        z2,
        normalized["part2"]["defect_rate"],
        normalized["part2"]["purchase_price"],
        normalized["part2"]["inspection_cost"],
    )
    good_probability = sum(
        first["probability"] * second["probability"]
        for first in part1["transitions"]
        for second in part2["transitions"]
        if first["state"] == _GOOD and second["state"] == _GOOD
    )
    return {
        "good_probability": good_probability,
        "purchase_cost": (
            part1["expected_purchase_count"]
            * normalized["part1"]["purchase_price"]
            + part2["expected_purchase_count"]
            * normalized["part2"]["purchase_price"]
        ),
        "inspection_cost": (
            part1["expected_test_count"]
            * normalized["part1"]["inspection_cost"]
            + part2["expected_test_count"]
            * normalized["part2"]["inspection_cost"]
        ),
    }


def _independent_no_disassembly_check(
    normalized: Mapping[str, Any],
    evaluation: Mapping[str, Any],
) -> float | None:
    policy = tuple(evaluation["policy_tuple"])
    if not evaluation["absorbing"] or policy[3] != 0:
        return None
    preparation = _initial_preparation_summary(normalized, policy)
    good_probability = preparation["good_probability"]
    if good_probability <= 0:
        raise RuntimeError("The initial good-product probability must be positive")
    attempt_cost = (
        preparation["purchase_cost"]
        + preparation["inspection_cost"]
        + normalized["product"]["assembly_cost"]
    )
    if policy[2]:
        attempt_cost += normalized["product"]["inspection_cost"]
        closed_form_profit = (
            normalized["sale_price"] - attempt_cost
        ) / good_probability
    else:
        closed_form_profit = (
            normalized["sale_price"]
            - preparation["purchase_cost"]
            - preparation["inspection_cost"]
            - normalized["product"]["assembly_cost"]
            - (1 - good_probability) * normalized["exchange_loss"]
        ) / good_probability
    return abs(closed_form_profit - evaluation["profit"])


def _solve_normalized_case(normalized: Mapping[str, Any]) -> dict[str, Any]:
    evaluations = [
        _evaluate_normalized(normalized, policy)
        for policy in enumerate_binary_policies()
    ]
    finite_evaluations = [
        evaluation
        for evaluation in evaluations
        if evaluation["absorbing"]
    ]
    if not finite_evaluations:
        raise RuntimeError("No absorbing Q2 policy is available")

    ranked = sorted(
        finite_evaluations,
        key=lambda evaluation: evaluation["profit"],
        reverse=True,
    )
    ranks = {
        tuple(evaluation["policy_tuple"]): rank
        for rank, evaluation in enumerate(ranked)
    }
    for evaluation in evaluations:
        evaluation["profit_rank"] = (
            ranks[tuple(evaluation["policy_tuple"])]
            if evaluation["absorbing"]
            else None
        )

    optimal = ranked[0]
    next_best = ranked[1] if len(ranked) > 1 else None
    gap_to_next = (
        optimal["profit"] - next_best["profit"]
        if next_best is not None
        else None
    )
    closed_form_gap = _independent_no_disassembly_check(
        normalized,
        optimal,
    )

    parameters = {
        "part1": dict(normalized["part1"]),
        "part2": dict(normalized["part2"]),
        "product": dict(normalized["product"]),
        "sale_price": normalized["sale_price"],
        "exchange_loss": normalized["exchange_loss"],
        "disassembly_cost": normalized["disassembly_cost"],
    }
    case_result = {
        "case_id": normalized["case_id"],
        "parameters": parameters,
        "policy": optimal["policy_tuple"],
        "policy_tuple": optimal["policy_tuple"],
        "optimal_policy_tuple": optimal["policy_tuple"],
        "optimal_policy": optimal["policy"],
        "policy_label": optimal["policy_label"],
        "profit": optimal["profit"],
        "expected_cost": optimal["expected_cost"],
        "decision_basis": {
            "objective": "maximize expected profit per qualified delivery",
            "selection_rule": (
                "maximize over absorbing policies; retain registered order "
                "for an exact tie"
            ),
            "next_best_policy": (
                next_best["policy_tuple"] if next_best is not None else None
            ),
            "profit_gap_to_next_best": gap_to_next,
            "bellman_residual": optimal["bellman_residual"],
            "event_cash_ledger_gap": optimal["event_cash_gap"],
            "independent_closed_form_gap": closed_form_gap,
        },
        "cashflow_breakdown": optimal["cashflow_breakdown"],
        "validation": {
            "absorbing": optimal["absorbing"],
            "absorption_probability_from_empty": optimal[
                "absorption_probability_from_empty"
            ],
            "bellman_residual": optimal["bellman_residual"],
            "event_cash_ledger_gap": optimal["event_cash_gap"],
            "independent_closed_form_gap": closed_form_gap,
            "reachable_state_count": optimal["reachable_state_count"],
        },
        "policies": evaluations,
    }
    return case_result


def solve_case(case_parameters: Any) -> dict[str, Any]:
    """Solve one Table 1 case and retain all sixteen policy evaluations."""
    return _solve_normalized_case(_normalize_case(case_parameters))


def _apply_relative_change(
    normalized: Mapping[str, Any],
    path: tuple[str, ...],
    factor: float,
) -> dict[str, Any]:
    changed = copy.deepcopy(dict(normalized))
    target: Any = changed
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = float(target[path[-1]]) * (1 + factor)
    return _normalize_case(changed)


def _scan_parameter(
    normalized: Mapping[str, Any],
    baseline: Mapping[str, Any],
    path: tuple[str, ...],
    parameter_name: str,
) -> list[dict[str, Any]]:
    baseline_policy = tuple(baseline["optimal_policy_tuple"])
    baseline_profit = baseline["profit"]
    rows: list[dict[str, Any]] = []

    for factor in RELATIVE_SENSITIVITY_GRID:
        perturbed = _apply_relative_change(normalized, path, factor)
        result = _solve_normalized_case(perturbed)
        fixed_policy_evaluation = next(
            evaluation
            for evaluation in result["policies"]
            if tuple(evaluation["policy_tuple"]) == baseline_policy
        )
        rows.append(
            {
                "case_id": normalized["case_id"],
                "parameter": parameter_name,
                "relative_factor": float(factor),
                "perturbed_value": _read_path(perturbed, path),
                "baseline_policy": list(baseline_policy),
                "baseline_policy_profit": baseline_profit,
                "perturbed_baseline_policy_profit": fixed_policy_evaluation[
                    "profit"
                ],
                "fixed_policy_profit_change": (
                    fixed_policy_evaluation["profit"] - baseline_profit
                    if fixed_policy_evaluation["profit"] is not None
                    else None
                ),
                "reoptimized_policy": result["optimal_policy_tuple"],
                "reoptimized_profit": result["profit"],
                "reoptimized_profit_change": result["profit"] - baseline_profit,
                "policy_changed": (
                    result["optimal_policy_tuple"] != baseline_policy
                ),
            }
        )
    return rows


def _read_path(payload: Mapping[str, Any], path: tuple[str, ...]) -> float:
    value: Any = payload
    for key in path:
        value = value[key]
    return float(value)


def _defect_sensitivity(cases: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for case_result in cases:
        normalized = _normalize_case(case_result["parameters"] | {"case_id": case_result["case_id"]})
        for path, parameter_name in _DEFECT_SCAN_PATHS:
            rows.extend(
                _scan_parameter(
                    normalized,
                    case_result,
                    path,
                    parameter_name,
                )
            )
    return rows


def _cost_sensitivity(case_result: Mapping[str, Any]) -> list[dict[str, Any]]:
    normalized = _normalize_case(
        case_result["parameters"] | {"case_id": case_result["case_id"]}
    )
    rows: list[dict[str, Any]] = []
    for path, parameter_name in _COST_SCAN_PATHS:
        rows.extend(
            _scan_parameter(
                normalized,
                case_result,
                path,
                parameter_name,
            )
        )
    return rows


def _contour_panel(
    base_case: Mapping[str, Any],
    x_path: tuple[str, ...],
    y_path: tuple[str, ...],
    x_name: str,
    y_name: str,
) -> dict[str, Any]:
    normalized = _normalize_case(
        base_case["parameters"] | {"case_id": base_case["case_id"]}
    )
    x_factors = RELATIVE_SENSITIVITY_GRID
    y_factors = RELATIVE_SENSITIVITY_GRID
    rows: list[dict[str, Any]] = []

    for y_factor in y_factors:
        for x_factor in x_factors:
            perturbed = _apply_relative_change(
                _apply_relative_change(normalized, x_path, x_factor),
                y_path,
                y_factor,
            )
            result = _solve_normalized_case(perturbed)
            rows.append(
                {
                    "x_name": x_name,
                    "y_name": y_name,
                    "x_relative_factor": float(x_factor),
                    "y_relative_factor": float(y_factor),
                    "x_value": _read_path(perturbed, x_path),
                    "y_value": _read_path(perturbed, y_path),
                    "policy": result["optimal_policy_tuple"],
                    "policy_label": result["policy_label"],
                    "profit": result["profit"],
                }
            )

    grid: dict[tuple[int, int], Mapping[str, Any]] = {
        (row_index, column_index): row
        for row_index in range(len(y_factors))
        for column_index, row in enumerate(rows[row_index :: len(y_factors)])
    }
    flip_edges: list[dict[str, Any]] = []

    for row_index in range(len(y_factors)):
        for column_index in range(len(x_factors) - 1):
            left = grid[(row_index, column_index)]
            right = grid[(row_index, column_index + 1)]
            if tuple(left["policy"]) != tuple(right["policy"]):
                flip_edges.append(
                    {
                        "direction": "x",
                        "from_policy": left["policy"],
                        "to_policy": right["policy"],
                        "from_x": left["x_value"],
                        "from_y": left["y_value"],
                        "to_x": right["x_value"],
                        "to_y": right["y_value"],
                        "midpoint_x": (left["x_value"] + right["x_value"]) / 2,
                        "midpoint_y": (left["y_value"] + right["y_value"]) / 2,
                    }
                )

    for column_index in range(len(x_factors)):
        for row_index in range(len(y_factors) - 1):
            upper = grid[(row_index, column_index)]
            lower = grid[(row_index + 1, column_index)]
            if tuple(upper["policy"]) != tuple(lower["policy"]):
                flip_edges.append(
                    {
                        "direction": "y",
                        "from_policy": upper["policy"],
                        "to_policy": lower["policy"],
                        "from_x": upper["x_value"],
                        "from_y": upper["y_value"],
                        "to_x": lower["x_value"],
                        "to_y": lower["y_value"],
                        "midpoint_x": (upper["x_value"] + lower["x_value"]) / 2,
                        "midpoint_y": (upper["y_value"] + lower["y_value"]) / 2,
                    }
                )

    return {
        "x_parameter": x_name,
        "y_parameter": y_name,
        "x_values": [
            _read_path(
                _apply_relative_change(normalized, x_path, factor),
                x_path,
            )
            for factor in x_factors
        ],
        "y_values": [
            _read_path(
                _apply_relative_change(normalized, y_path, factor),
                y_path,
            )
            for factor in y_factors
        ],
        "grid_rows": rows,
        "grid_point_count": len(rows),
        "flip_edges": flip_edges,
    }


def _breakeven_contours(case_result: Mapping[str, Any]) -> dict[str, Any]:
    inspection_vs_exchange = _contour_panel(
        case_result,
        ("product", "inspection_cost"),
        ("exchange_loss",),
        "product_inspection_cost",
        "exchange_loss",
    )
    inspection_vs_disassembly = _contour_panel(
        case_result,
        ("product", "inspection_cost"),
        ("disassembly_cost",),
        "product_inspection_cost",
        "disassembly_cost",
    )
    return {
        "inspection_vs_exchange": inspection_vs_exchange,
        "inspection_vs_disassembly": inspection_vs_disassembly,
    }


def _component_transition_probe(normalized: Mapping[str, Any]) -> dict[str, Any]:
    geometric_test_count = 1 / (
        1 - normalized["part1"]["defect_rate"]
    )
    empty_transition = _component_transition(
        _EMPTY,
        1,
        normalized["part1"]["defect_rate"],
        normalized["part1"]["purchase_price"],
        normalized["part1"]["inspection_cost"],
    )
    bad_transition = _component_transition(
        _BAD,
        1,
        normalized["part1"]["defect_rate"],
        normalized["part1"]["purchase_price"],
        normalized["part1"]["inspection_cost"],
    )
    empty_gap = abs(
        empty_transition["expected_test_count"] - geometric_test_count
    )
    empty_cost_gap = abs(
        empty_transition["preparation_cost"]
        - geometric_test_count
        * (
            normalized["part1"]["purchase_price"]
            + normalized["part1"]["inspection_cost"]
        )
    )
    return {
        "geometric_test_count": float(geometric_test_count),
        "empty_inspected_test_count": empty_transition[
            "expected_test_count"
        ],
        "empty_inspected_purchase_count": empty_transition[
            "expected_purchase_count"
        ],
        "empty_inspected_preparation_cost": empty_transition[
            "preparation_cost"
        ],
        "returned_bad_retest_count": bad_transition[
            "expected_test_count"
        ],
        "empty_test_count_gap": float(empty_gap),
        "empty_cost_gap": float(empty_cost_gap),
        "passed": (
            empty_gap <= CASHFLOW_ABS_TOL
            and empty_cost_gap <= CASHFLOW_ABS_TOL
        ),
    }


def _validation_summary(
    cases: list[dict[str, Any]],
    cost_scan: list[dict[str, Any]],
) -> dict[str, Any]:
    all_policy_records = [
        policy
        for case in cases
        for policy in case["policies"]
    ]
    finite_records = [
        policy for policy in all_policy_records if policy["absorbing"]
    ]
    closed_form_gaps = [
        policy["decision_basis"]["independent_closed_form_gap"]
        for case in cases
        for policy in [case]
        if policy["decision_basis"]["independent_closed_form_gap"] is not None
    ]
    maximum_cashflow_gap = max(
        policy["event_cash_gap"] for policy in finite_records
    )
    maximum_bellman_residual = max(
        policy["bellman_residual"] for policy in finite_records
    )
    minimum_absorption_probability = min(
        policy["absorption_probability_from_empty"]
        for policy in finite_records
    )
    monotonic_violations = [
        row
        for row in cost_scan
        if row["reoptimized_profit_change"] > CASHFLOW_ABS_TOL
        or row["fixed_policy_profit_change"] > CASHFLOW_ABS_TOL
    ]
    component_probe = _component_transition_probe(
        _normalize_case(cases[0]["parameters"] | {"case_id": cases[0]["case_id"]})
    )
    passed = (
        component_probe["passed"]
        and maximum_cashflow_gap <= CASHFLOW_ABS_TOL
        and maximum_bellman_residual <= VALUE_ITERATION_TOL
        and minimum_absorption_probability >= 1 - VALUE_ITERATION_TOL
        and not monotonic_violations
    )
    return {
        "registered_policy_count": Q2_POLICY_SPACE_COUNT,
        "evaluated_policy_count_per_case": len(
            cases[0]["policies"]
        ),
        "registered_inventory_state_count": Q2_INVENTORY_STATE_COUNT,
        "absorbing_policy_record_count": len(finite_records),
        "nonabsorbing_policy_record_count": (
            len(all_policy_records) - len(finite_records)
        ),
        "maximum_event_cash_gap": float(maximum_cashflow_gap),
        "maximum_bellman_residual": float(maximum_bellman_residual),
        "minimum_absorption_probability": float(
            minimum_absorption_probability
        ),
        "maximum_independent_closed_form_gap": (
            float(max(closed_form_gaps)) if closed_form_gaps else 0
        ),
        "component_empty_branch_probe": component_probe,
        "cost_monotonicity_violation_count": len(monotonic_violations),
        "cost_monotonicity_violations": monotonic_violations,
        "cashflow_abs_tol": CASHFLOW_ABS_TOL,
        "value_iteration_tol": VALUE_ITERATION_TOL,
        "passed": bool(passed),
    }


def _optimal_cost_breakdown(cases: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for case in cases:
        ledger = case["cashflow_breakdown"]
        rows.append(
            {
                "case_id": case["case_id"],
                "policy": case["optimal_policy_tuple"],
                "purchase_cost": ledger["purchase_cost"],
                "part_inspection_cost": ledger["part_inspection_cost"],
                "assembly_cost": ledger["assembly_cost"],
                "product_inspection_cost": ledger[
                    "product_inspection_cost"
                ],
                "disassembly_cost": ledger["disassembly_cost"],
                "exchange_loss_cost": ledger["exchange_loss_cost"],
                "total_cost": ledger["total_cost"],
                "market_revenue": ledger["market_revenue"],
                "profit": ledger["profit"],
            }
        )
    return rows


def run() -> dict[str, Any]:
    """Solve all six factual cases and return the problem-two JSON payload."""
    case_results = [solve_case(case) for case in Q2_CASES]
    policy_labels = [
        _policy_label(policy) for policy in enumerate_binary_policies()
    ]
    policy_tuples = [
        list(policy) for policy in enumerate_binary_policies()
    ]
    profit_matrix = [
        [policy["profit"] for policy in case["policies"]]
        for case in case_results
    ]
    expected_cost_matrix = [
        [policy["expected_cost"] for policy in case["policies"]]
        for case in case_results
    ]
    absorbing_matrix = [
        [policy["absorbing"] for policy in case["policies"]]
        for case in case_results
    ]
    six_case_decisions = [
        {
            "case_id": case["case_id"],
            "policy": case["optimal_policy_tuple"],
            "policy_label": case["policy_label"],
            "profit": case["profit"],
            "expected_cost": case["expected_cost"],
        }
        for case in case_results
    ]
    policy_table = [
        {
            "case_id": case["case_id"],
            **policy,
        }
        for case in case_results
        for policy in case["policies"]
    ]
    defect_scan = _defect_sensitivity(case_results)
    cost_scan = _cost_sensitivity(case_results[0])
    contours = _breakeven_contours(case_results[0])
    validation = _validation_summary(case_results, cost_scan)

    if not validation["passed"]:
        raise RuntimeError(
            "Q2 blocking validation failed; inspect "
            "problem2.validation for the violated identity"
        )

    return {
        "problem_id": "problem2",
        "status": "completed",
        "method": "absorbing_markov_reward_with_event_cash_ledger",
        "policy_variable_order": [
            "part1_inspection",
            "part2_inspection",
            "finished_goods_test",
            "disassemble_defective_product",
        ],
        "policy_space_count": Q2_POLICY_SPACE_COUNT,
        "inventory_state_space": [
            _state_label(state) for state in _INVENTORY_STATES
        ],
        "inventory_state_count": Q2_INVENTORY_STATE_COUNT,
        "profit_unit": PROFIT_UNIT,
        "cost_unit": COST_UNIT,
        "case_count": len(case_results),
        "cases": case_results,
        "policy_tuples": policy_tuples,
        "policy_labels": policy_labels,
        "policy_heatmap": {
            "case_ids": [case["case_id"] for case in case_results],
            "policy_tuples": policy_tuples,
            "policy_labels": policy_labels,
            "profit_matrix": profit_matrix,
            "expected_cost_matrix": expected_cost_matrix,
            "absorbing_matrix": absorbing_matrix,
        },
        "sixteen_policy_table": policy_table,
        "policy_table": policy_table,
        "six_cases_decisions": six_case_decisions,
        "optimal_cost_breakdown": _optimal_cost_breakdown(case_results),
        "sensitivity": {
            "relative_factor_grid": list(RELATIVE_SENSITIVITY_GRID),
            "defect_rate_scan": defect_scan,
            "unit_cost_scan": cost_scan,
        },
        "breakeven_contour": contours["inspection_vs_exchange"],
        "breakeven_contours": contours,
        "validation": validation,
    }


def main() -> None:
    result = run()
    if result["status"] != "completed":
        raise RuntimeError("Q2 did not complete")


def evaluate_strategy(case_parameters: Any, policy: Any) -> float | None:
    return policy_profit(case_parameters, policy)


def solve_two_part_policy(
    case_parameters: Any,
    policy: Any,
) -> dict[str, Any]:
    return evaluate_policy(case_parameters, policy)


if __name__ == "__main__":
    main()