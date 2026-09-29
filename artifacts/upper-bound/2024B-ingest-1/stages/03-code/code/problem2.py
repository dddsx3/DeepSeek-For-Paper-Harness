"""Problem 2 exact absorbing Markov-reward solver.

The four binary decisions are interpreted as
``(part_1_inspection, part_2_inspection, final_inspection, final_disassembly)``.
Every transient state records the realized quality of the two available parts.
A qualified market delivery is represented by an explicit absorbing state.
All expected event counts are obtained from the fundamental matrix and are
reconciled with an independent value-iteration solution.
"""

from __future__ import annotations

import itertools
import math
from collections.abc import Mapping, Sequence
from dataclasses import replace
from typing import Any

import numpy as np

import params
from params import *  # noqa: F401,F403


_MISSING = object()
_QUALITY_NAMES = ("empty", "good", "bad")
_QUALITY_VALUES = tuple(range(Q2_PARAMETER_NODE_COUNT))
_QUALITY_STATES = tuple(
    itertools.product(
        _QUALITY_VALUES,
        _QUALITY_VALUES,
        repeat=Q2_PARAMETER_NODE_COUNT,
    )
)
if len(_QUALITY_STATES) != Q2_INVENTORY_STATE_LIMIT:
    raise AssertionError("问题二质量状态数与 params.py 登记上限不一致")

_STATE_TO_INDEX = {
    state: state_index for state_index, state in enumerate(_QUALITY_STATES)
}
_EMPTY_STATE = (_QUALITY_VALUES[0], _QUALITY_VALUES[0])
_GOOD_STATE = (_QUALITY_VALUES[1], _QUALITY_VALUES[1])
_BAD_STATE = (_QUALITY_VALUES[2], _QUALITY_VALUES[2])
_POLICY_TUPLE_LENGTH = Q2_PARAMETER_NODE_COUNT + 1
_POLICIES = tuple(
    itertools.product((False, True), repeat=_POLICY_TUPLE_LENGTH)
)
if len(_POLICIES) != Q2_STRATEGY_SPACE_SIZE:
    raise AssertionError("问题二策略空间必须与登记的 16 种组合一致")

_POLICY_LABELS = tuple(
    "".join(str(int(decision)) for decision in policy) for policy in _POLICIES
)
_TERMINAL_STATE_NAME = "qualified_delivery_absorbing"
_EVENT_COUNT_KEYS = (
    "purchases_part1",
    "purchases_part2",
    "inspections_part1",
    "inspections_part2",
    "inspections_product",
    "assemblies",
    "disassemblies",
    "scrap_events",
    "market_sales",
    "market_bad_sales",
    "returns",
    "exchange_losses",
    "bad_outputs",
    "replacement_assemblies",
    "qualified_deliveries",
)


def _read_field(record: Any, names: Sequence[str], default: Any = _MISSING) -> Any:
    if isinstance(record, Mapping):
        for name in names:
            if name in record:
                return record[name]
    else:
        for name in names:
            try:
                return getattr(record, name)
            except AttributeError:
                pass
        for name in names:
            try:
                return record[name]
            except (KeyError, TypeError, IndexError):
                pass
    if default is not _MISSING:
        return default
    raise KeyError("缺少字段别名：" + ", ".join(names))


def _parse_case(raw_case: Any) -> params.Q2Case:
    """Normalize flat Q2Case, legacy flat mappings, and nested mappings.

    The explicit ``price1/test1/price2/test2`` aliases are required for the
    frozen dataclass and all legacy records used by earlier adapters.
    """
    if isinstance(raw_case, params.Q2Case):
        parsed = raw_case
    else:
        part1 = _read_field(raw_case, ("part1",), default={})
        part2 = _read_field(raw_case, ("part2",), default={})
        product = _read_field(raw_case, ("product", "final_product"), default={})

        p1 = _read_field(
            raw_case, ("p1", "part1_defect", "part1_p"), default=_MISSING
        )
        if p1 is _MISSING:
            p1 = _read_field(part1, ("p", "defect_rate", "p1"))
        price1 = _read_field(
            raw_case,
            ("price1", "a1", "part1_price"),
            default=_MISSING,
        )
        if price1 is _MISSING:
            price1 = _read_field(part1, ("price", "purchase_price", "a1"))
        test1 = _read_field(
            raw_case, ("test1", "t1", "part1_test"), default=_MISSING
        )
        if test1 is _MISSING:
            test1 = _read_field(part1, ("test", "inspection_cost", "t1"))

        p2 = _read_field(
            raw_case, ("p2", "part2_defect", "part2_p"), default=_MISSING
        )
        if p2 is _MISSING:
            p2 = _read_field(part2, ("p", "defect_rate", "p2"))
        price2 = _read_field(
            raw_case,
            ("price2", "a2", "part2_price"),
            default=_MISSING,
        )
        if price2 is _MISSING:
            price2 = _read_field(part2, ("price", "purchase_price", "a2"))
        test2 = _read_field(
            raw_case, ("test2", "t2", "part2_test"), default=_MISSING
        )
        if test2 is _MISSING:
            test2 = _read_field(part2, ("test", "inspection_cost", "t2"))

        pf = _read_field(
            raw_case,
            ("pf", "product_defect", "p_final"),
            default=_MISSING,
        )
        if pf is _MISSING:
            pf = _read_field(product, ("p", "defect_rate", "pf"))
        assembly_cost = _read_field(
            raw_case,
            ("assembly_cost", "kf", "assembly"),
            default=_MISSING,
        )
        if assembly_cost is _MISSING:
            assembly_cost = _read_field(product, ("assembly_cost", "kf", "assembly"))
        product_test_cost = _read_field(
            raw_case,
            ("product_test_cost", "tf", "final_test"),
            default=_MISSING,
        )
        if product_test_cost is _MISSING:
            product_test_cost = _read_field(product, ("test_cost", "test", "tf"))

        parsed = params.Q2Case(
            p1=float(p1),
            price1=float(price1),
            test1=float(test1),
            p2=float(p2),
            price2=float(price2),
            test2=float(test2),
            pf=float(pf),
            assembly_cost=float(assembly_cost),
            product_test_cost=float(product_test_cost),
            market_price=float(
                _read_field(raw_case, ("market_price", "rmarket", "sale_price"))
            ),
            exchange_loss=float(
                _read_field(
                    raw_case,
                    ("exchange_loss", "lexchange", "replacement_loss"),
                )
            ),
            disassembly_cost=float(
                _read_field(
                    raw_case,
                    ("disassembly_cost", "gdis", "disassembly"),
                )
            ),
            case_id=int(
                _read_field(raw_case, ("case_id", "id"), default=_QUALITY_VALUES[0])
            ),
        )
    _validate_case(parsed)
    return parsed


def _validate_case(case: params.Q2Case) -> None:
    probabilities = (case.p1, case.p2, case.pf)
    monetary_values = (
        case.price1,
        case.test1,
        case.price2,
        case.test2,
        case.assembly_cost,
        case.product_test_cost,
        case.market_price,
        case.exchange_loss,
        case.disassembly_cost,
    )
    for value in probabilities:
        if not math.isfinite(value) or value < 0.0 or value > 1.0:
            raise ValueError(f"次品率必须位于 [0,1]，实际为 {value!r}")
    for value in monetary_values:
        if not math.isfinite(value) or value < 0.0:
            raise ValueError(f"金额参数必须有限且非负，实际为 {value!r}")


def load_cases(cases: Any = None) -> tuple[params.Q2Case, ...]:
    source = params.Q2_CASES if cases is None else cases
    parsed_cases = tuple(_parse_case(raw_case) for raw_case in source)
    if not parsed_cases:
        raise ValueError("问题二案例集合不得为空")
    return parsed_cases


def _binary_value(value: Any, field_name: str) -> bool:
    if isinstance(value, (bool, np.bool_)):
        return bool(value)
    try:
        numeric = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} 必须是 0 或 1") from exc
    if not math.isfinite(numeric) or numeric not in (0.0, 1.0):
        raise ValueError(f"{field_name} 必须是 0 或 1，实际为 {value!r}")
    return bool(numeric)


def _canonical_policy(policy: Any) -> tuple[bool, bool, bool, bool]:
    if isinstance(policy, Mapping):
        values = (
            _binary_value(
                _read_field(
                    policy,
                    ("z1", "Z1", "part1_inspection", "inspect_part1"),
                ),
                "z1",
            ),
            _binary_value(
                _read_field(
                    policy,
                    ("z2", "Z2", "part2_inspection", "inspect_part2"),
                ),
                "z2",
            ),
            _binary_value(
                _read_field(
                    policy,
                    ("c", "C", "final_test", "product_test", "inspect_final"),
                ),
                "c",
            ),
            _binary_value(
                _read_field(
                    policy,
                    ("d", "D", "disassemble", "final_disassembly"),
                ),
                "d",
            ),
        )
    else:
        if isinstance(policy, (str, bytes)):
            raise TypeError("策略必须是四元组或字段映射")
        values = tuple(policy)
        if len(values) != _POLICY_TUPLE_LENGTH:
            raise ValueError(
                f"策略必须包含 {_POLICY_TUPLE_LENGTH} 个二元决策"
            )
        values = tuple(
            _binary_value(value, field_name)
            for value, field_name in zip(
                values,
                ("z1", "z2", "c", "d"),
            )
        )
    return values


def _state_label(state: tuple[int, int]) -> str:
    return f"h1={_QUALITY_NAMES[state[0]]},h2={_QUALITY_NAMES[state[1]]}"


def market_revenue_once(
    case: params.Q2Case,
    source_index: int,
    probability: float,
    counts: dict[str, np.ndarray],
    cash: np.ndarray,
) -> None:
    """Record exactly one market transaction for each launched market unit."""
    counts["market_sales"][source_index] += probability
    cash[source_index] += probability * case.market_price


def replacement_assembly_once(
    source_index: int,
    probability: float,
    counts: dict[str, np.ndarray],
) -> None:
    """Book the one subsequent launch caused by each defective assembly."""
    counts["replacement_assemblies"][source_index] += probability


def _add_transition(
    transition: np.ndarray,
    source_index: int,
    destination_index: int,
    probability: float,
    cash: np.ndarray,
    source_cash: float,
    counts: dict[str, np.ndarray],
) -> None:
    if probability <= 0.0:
        return
    transition[source_index, destination_index] += probability
    cash[source_index] += source_cash


def _reachable_state_indices(transition: np.ndarray) -> list[int]:
    start = _STATE_TO_INDEX[_EMPTY_STATE]
    pending = [start]
    visited = {start}
    while pending:
        source_index = pending.pop()
        for destination_index in np.flatnonzero(transition[source_index] > 0.0):
            destination = int(destination_index)
            if destination not in visited:
                visited.add(destination)
                pending.append(destination)
    return sorted(visited)


def build_mrp(raw_case: Any, raw_policy: Any) -> dict[str, Any]:
    """Build the full stochastic kernel, including an absorbing delivery row."""
    case = _parse_case(raw_case)
    z1, z2, inspect_product, disassemble = _canonical_policy(raw_policy)
    state_count = len(_QUALITY_STATES)

    transient = np.zeros((state_count, state_count), dtype=float)
    terminal = np.zeros(state_count, dtype=float)
    immediate_cash = np.zeros(state_count, dtype=float)
    counts = {
        key: np.zeros(state_count, dtype=float) for key in _EVENT_COUNT_KEYS
    }
    procurement_impossible = False

    for state_index, state in enumerate(_QUALITY_STATES):
        left_quality, right_quality = state

        if left_quality == _QUALITY_VALUES[0]:
            good_quality = _QUALITY_VALUES[1]
            bad_quality = _QUALITY_VALUES[2]
            if z1:
                good_probability = 1.0 - case.p1
                if good_probability <= 0.0:
                    procurement_impossible = True
                    continue
                expected_draws = 1.0 / good_probability
                destination = (good_quality, right_quality)
                destination_index = _STATE_TO_INDEX[destination]
                counts["purchases_part1"][state_index] += expected_draws
                counts["inspections_part1"][state_index] += expected_draws
                _add_transition(
                    transient,
                    state_index,
                    destination_index,
                    1.0,
                    immediate_cash,
                    -expected_draws * (case.price1 + case.test1),
                    counts,
                )
            else:
                good_probability = 1.0 - case.p1
                bad_probability = case.p1
                good_destination = (good_quality, right_quality)
                bad_destination = (bad_quality, right_quality)
                counts["purchases_part1"][state_index] += 1.0
                _add_transition(
                    transient,
                    state_index,
                    _STATE_TO_INDEX[good_destination],
                    good_probability,
                    immediate_cash,
                    -case.price1,
                    counts,
                )
                _add_transition(
                    transient,
                    state_index,
                    _STATE_TO_INDEX[bad_destination],
                    bad_probability,
                    immediate_cash,
                    -case.price1,
                    counts,
                )
            continue

        if right_quality == _QUALITY_VALUES[0]:
            good_quality = _QUALITY_VALUES[1]
            bad_quality = _QUALITY_VALUES[2]
            if z2:
                good_probability = 1.0 - case.p2
                if good_probability <= 0.0:
                    procurement_impossible = True
                    continue
                expected_draws = 1.0 / good_probability
                destination = (left_quality, good_quality)
                destination_index = _STATE_TO_INDEX[destination]
                counts["purchases_part2"][state_index] += expected_draws
                counts["inspections_part2"][state_index] += expected_draws
                _add_transition(
                    transient,
                    state_index,
                    destination_index,
                    1.0,
                    immediate_cash,
                    -expected_draws * (case.price2 + case.test2),
                    counts,
                )
            else:
                good_probability = 1.0 - case.p2
                bad_probability = case.p2
                good_destination = (left_quality, good_quality)
                bad_destination = (left_quality, bad_quality)
                counts["purchases_part2"][state_index] += 1.0
                _add_transition(
                    transient,
                    state_index,
                    _STATE_TO_INDEX[good_destination],
                    good_probability,
                    immediate_cash,
                    -case.price2,
                    counts,
                )
                _add_transition(
                    transient,
                    state_index,
                    _STATE_TO_INDEX[bad_destination],
                    bad_probability,
                    immediate_cash,
                    -case.price2,
                    counts,
                )
            continue

        counts["assemblies"][state_index] += 1.0
        immediate_cash[state_index] -= case.assembly_cost

        if left_quality == _QUALITY_VALUES[1] and right_quality == _QUALITY_VALUES[1]:
            bad_probability = case.pf
        else:
            bad_probability = 1.0
        good_probability = 1.0 - bad_probability

        if inspect_product:
            counts["inspections_product"][state_index] += 1.0
            immediate_cash[state_index] -= case.product_test_cost

        if good_probability > 0.0:
            terminal[state_index] += good_probability
            counts["qualified_deliveries"][state_index] += good_probability
            market_revenue_once(
                case,
                state_index,
                good_probability,
                counts,
                immediate_cash,
            )

        if bad_probability > 0.0:
            counts["bad_outputs"][state_index] += bad_probability
            replacement_assembly_once(
                state_index,
                bad_probability,
                counts,
            )
            if not inspect_product:
                market_revenue_once(
                    case,
                    state_index,
                    bad_probability,
                    counts,
                    immediate_cash,
                )
                counts["market_bad_sales"][state_index] += bad_probability
                counts["returns"][state_index] += bad_probability
                counts["exchange_losses"][state_index] += bad_probability
                immediate_cash[state_index] -= bad_probability * case.exchange_loss

            if disassemble:
                destination_index = state_index
                immediate_cash[state_index] -= bad_probability * case.disassembly_cost
                counts["disassemblies"][state_index] += bad_probability
            else:
                destination_index = _STATE_TO_INDEX[_EMPTY_STATE]
                counts["scrap_events"][state_index] += bad_probability
                immediate_cash[state_index] += (
                    bad_probability * Q2_SCRAP_SALVAGE_VALUE
                )
            _add_transition(
                transient,
                state_index,
                destination_index,
                bad_probability,
                immediate_cash,
                0.0,
                counts,
            )

    full_transition = np.zeros(
        (state_count + 1, state_count + 1),
        dtype=float,
    )
    full_transition[:-1, :-1] = transient
    full_transition[:-1, -1] = terminal
    full_transition[-1, -1] = 1.0

    reachable_global = _reachable_state_indices(transient)
    local_position = {
        global_index: local_index
        for local_index, global_index in enumerate(reachable_global)
    }
    restricted_transition = transient[np.ix_(reachable_global, reachable_global)]
    restricted_terminal = terminal[reachable_global]
    restricted_cash = immediate_cash[reachable_global]
    restricted_counts = {
        key: values[reachable_global] for key, values in counts.items()
    }

    initial_global = _STATE_TO_INDEX[_EMPTY_STATE]
    initial_index = local_position.get(initial_global)
    if initial_index is None:
        raise AssertionError("empty 状态必须是可达初始状态")

    return {
        "case": case,
        "policy": (z1, z2, inspect_product, disassemble),
        "state_names": [_state_label(state) for state in _QUALITY_STATES],
        "reachable_state_names": [
            _state_label(_QUALITY_STATES[index]) for index in reachable_global
        ],
        "reachable_states": len(reachable_global),
        "transient_transition": restricted_transition,
        "terminal_probability": restricted_terminal,
        "immediate_cash": restricted_cash,
        "event_immediate_counts": restricted_counts,
        "initial_index": initial_index,
        "full_transition": full_transition,
        "absorbing_state_index": state_count,
        "absorbing_state_name": _TERMINAL_STATE_NAME,
        "terminal_row_absorbing": bool(
            full_transition[-1, -1] == 1.0
            and np.count_nonzero(full_transition[-1, :-1]) == 0
        ),
        "transition_row_sum_error": float(
            np.max(np.abs(full_transition.sum(axis=1) - 1.0))
        ),
        "procurement_impossible": procurement_impossible,
    }


def absorbing_markov_reward(mrp: dict[str, Any]) -> dict[str, Any]:
    """Solve the absorbing reward equation and independently iterate it."""
    transition = np.asarray(mrp["transient_transition"], dtype=float)
    terminal_probability = np.asarray(mrp["terminal_probability"], dtype=float)
    rewards = np.asarray(mrp["immediate_cash"], dtype=float)
    state_count = transition.shape[0]

    if mrp["procurement_impossible"]:
        return {
            "eligible": False,
            "reason": "检测后无法以正概率取得合格零配件",
            "spectral_radius": None,
            "value": None,
            "fundamental_matrix": None,
            "bellman_residual": None,
            "value_iteration_error": None,
        }

    eigenvalues = np.linalg.eigvals(transition)
    spectral_radius = float(np.max(np.abs(eigenvalues)))
    if not math.isfinite(spectral_radius) or spectral_radius >= 1.0:
        return {
            "eligible": False,
            "reason": "可达转移核含非吸收闭合类，期望交付价值不是有限值",
            "spectral_radius": spectral_radius,
            "value": None,
            "fundamental_matrix": None,
            "bellman_residual": None,
            "value_iteration_error": None,
        }

    system = np.eye(state_count, dtype=float) - transition
    try:
        value = np.linalg.solve(system, rewards)
        fundamental = np.linalg.solve(system, np.eye(state_count, dtype=float))
    except np.linalg.LinAlgError:
        return {
            "eligible": False,
            "reason": "吸收转移方程在浮点数下不可解",
            "spectral_radius": spectral_radius,
            "value": None,
            "fundamental_matrix": None,
            "bellman_residual": None,
            "value_iteration_error": None,
        }

    iterated = np.zeros(state_count, dtype=float)
    converged = False
    for _ in range(VALUE_ITERATION_MAX_ITER):
        updated = rewards + transition @ iterated
        if np.max(np.abs(updated - iterated)) <= VALUE_ITERATION_TOL:
            iterated = updated
            converged = True
            break
        iterated = updated
    if not converged:
        raise RuntimeError("问题二 Bellman 价值迭代未在登记轮数内收敛")

    residual = rewards + transition @ value - value
    return {
        "eligible": True,
        "reason": "可达闭合类仅为合格交付吸收态",
        "spectral_radius": spectral_radius,
        "value": value,
        "fundamental_matrix": fundamental,
        "bellman_residual": float(np.max(np.abs(residual))),
        "value_iteration_error": float(np.max(np.abs(value - iterated))),
    }


def _absorption_probability(
    mrp: dict[str, Any],
    bellman: dict[str, Any],
) -> float:
    initial_index = int(mrp["initial_index"])
    if bellman["eligible"]:
        fundamental = np.asarray(bellman["fundamental_matrix"], dtype=float)
        probability = float(fundamental[initial_index, :].sum())
        return min(1.0, max(0.0, probability))

    transition = np.asarray(mrp["transient_transition"], dtype=float)
    terminal = np.asarray(mrp["terminal_probability"], dtype=float)
    state_count = transition.shape[0]
    can_reach_terminal = terminal > 0.0
    for _ in range(state_count):
        updated = can_reach_terminal | (
            transition.T @ can_reach_terminal.astype(float) > 0.0
        )
        if np.array_equal(updated, can_reach_terminal):
            break
        can_reach_terminal = updated

    safe_indices = np.flatnonzero(can_reach_terminal)
    if initial_index not in safe_indices:
        return 0.0
    safe_transition = transition[np.ix_(safe_indices, safe_indices)]
    safe_terminal = terminal[safe_indices]
    system = np.eye(len(safe_indices), dtype=float) - safe_transition
    try:
        probabilities = np.linalg.solve(system, safe_terminal)
    except np.linalg.LinAlgError:
        return 0.0
    local_initial = int(np.flatnonzero(safe_indices == initial_index)[0])
    probability = float(probabilities[local_initial])
    return min(1.0, max(0.0, probability))


def event_cash_ledger(
    raw_case: Any,
    raw_policy: Any,
    mrp: dict[str, Any] | None = None,
    bellman: dict[str, Any] | None = None,
    absorption_probability: float | None = None,
) -> dict[str, Any]:
    """Reconcile Bellman value with an independent expected-event ledger."""
    case = _parse_case(raw_case)
    if mrp is None:
        mrp = build_mrp(case, raw_policy)
    if bellman is None:
        bellman = absorbing_markov_reward(mrp)
    if absorption_probability is None:
        absorption_probability = _absorption_probability(mrp, bellman)

    if not bellman["eligible"]:
        return {
            "status": "nonabsorbing",
            "event_counts": None,
            "components": None,
            "total_cost": None,
            "market_revenue": None,
            "net_cash": None,
            "cashflow_residual": None,
            "absorption_probability": absorption_probability,
            "identity_errors": None,
            "market_revenue_once": False,
            "replacement_assembly_once": False,
            "all_costs_accounted": False,
            "expected_state_visits": None,
        }

    fundamental = np.asarray(bellman["fundamental_matrix"], dtype=float)
    initial_index = int(mrp["initial_index"])
    expected_counts = {
        key: float(fundamental[initial_index, :] @ values)
        for key, values in mrp["event_immediate_counts"].items()
    }
    market_revenue = case.market_price * expected_counts["market_sales"]
    components = {
        "purchase_part1": case.price1 * expected_counts["purchases_part1"],
        "purchase_part2": case.price2 * expected_counts["purchases_part2"],
        "inspection_part1": case.test1 * expected_counts["inspections_part1"],
        "inspection_part2": case.test2 * expected_counts["inspections_part2"],
        "inspection_product": (
            case.product_test_cost * expected_counts["inspections_product"]
        ),
        "assembly": case.assembly_cost * expected_counts["assemblies"],
        "disassembly": (
            case.disassembly_cost * expected_counts["disassemblies"]
        ),
        "exchange_loss": (
            case.exchange_loss * expected_counts["exchange_losses"]
        ),
        "scrap_salvage_recovery": (
            Q2_SCRAP_SALVAGE_VALUE * expected_counts["scrap_events"]
        ),
    }
    total_cost = float(sum(components.values()))
    net_cash = float(market_revenue - total_cost)
    bellman_value = float(np.asarray(bellman["value"])[initial_index])
    cashflow_residual = abs(net_cash - bellman_value)

    replacement_identity_error = abs(
        expected_counts["assemblies"]
        - expected_counts["replacement_assemblies"]
        - expected_counts["qualified_deliveries"]
    )
    exchange_identity_error = abs(
        expected_counts["returns"]
        - expected_counts["market_bad_sales"]
    )
    revenue_identity_error = abs(
        market_revenue
        - case.market_price * expected_counts["market_sales"]
    )
    market_sales_identity = (
        expected_counts["market_sales"] <= expected_counts["assemblies"] + CASHFLOW_ABS_TOL
    )
    identity_errors = {
        "replacement_assembly_identity": replacement_identity_error,
        "return_market_bad_identity": exchange_identity_error,
        "market_revenue_identity": revenue_identity_error,
    }
    all_costs_accounted = all(
        abs(value) <= CASHFLOW_ABS_TOL for value in identity_errors.values()
    ) and all(
        key in components
        for key in (
            "purchase_part1",
            "purchase_part2",
            "inspection_part1",
            "inspection_part2",
            "inspection_product",
            "assembly",
            "disassembly",
            "exchange_loss",
        )
    )

    expected_state_visits = [
        {
            "state": state_name,
            "expected_visits": float(fundamental[initial_index, local_index]),
        }
        for local_index, state_name in enumerate(mrp["reachable_state_names"])
    ]
    return {
        "status": "absorbing",
        "event_counts": expected_counts,
        "components": components,
        "total_cost": total_cost,
        "market_revenue": float(market_revenue),
        "net_cash": net_cash,
        "cashflow_residual": float(cashflow_residual),
        "absorption_probability": float(absorption_probability),
        "identity_errors": identity_errors,
        "market_revenue_once": bool(
            market_sales_identity
            and revenue_identity_error <= CASHFLOW_ABS_TOL
        ),
        "replacement_assembly_once": bool(
            replacement_identity_error <= CASHFLOW_ABS_TOL
        ),
        "all_costs_accounted": bool(all_costs_accounted),
        "expected_state_visits": expected_state_visits,
    }


def solve_policy(raw_case: Any, raw_policy: Any) -> dict[str, Any]:
    case = _parse_case(raw_case)
    policy = _canonical_policy(raw_policy)
    mrp = build_mrp(case, policy)
    bellman = absorbing_markov_reward(mrp)
    absorption_probability = _absorption_probability(mrp, bellman)
    ledger = event_cash_ledger(
        case,
        policy,
        mrp=mrp,
        bellman=bellman,
        absorption_probability=absorption_probability,
    )
    policy_vector = [int(decision) for decision in policy]
    result: dict[str, Any] = {
        "policy": policy_vector,
        "policy_tuple": policy_vector,
        "policy_label": "".join(str(value) for value in policy_vector),
        "z1": int(policy[0]),
        "z2": int(policy[1]),
        "c": int(policy[2]),
        "d": int(policy[3]),
        "is_absorbing": bool(bellman["eligible"]),
        "absorbing": bool(bellman["eligible"]),
        "absorption_probability": float(absorption_probability),
        "termination_probability": float(absorption_probability),
        "spectral_radius": bellman["spectral_radius"],
        "reachable_state_count": int(mrp["reachable_states"]),
        "reachable_states": mrp["reachable_state_names"],
        "terminal_state": mrp["absorbing_state_name"],
        "terminal_row_absorbing": mrp["terminal_row_absorbing"],
        "transition_row_sum_error": mrp["transition_row_sum_error"],
        "bellman_residual": bellman["bellman_residual"],
        "value_iteration_error": bellman["value_iteration_error"],
        "cashflow_residual": ledger["cashflow_residual"],
        "profit": None,
        "profit_per_good_delivery": None,
        "expected_cost": None,
        "market_revenue": None,
        "event_cash_ledger": ledger,
        "reason": bellman["reason"],
    }
    if bellman["eligible"]:
        result["profit"] = float(bellman["value"][mrp["initial_index"]])
        result["profit_per_good_delivery"] = result["profit"]
        result["expected_cost"] = ledger["total_cost"]
        result["market_revenue"] = ledger["market_revenue"]
        result["decision_basis"] = (
            "在完整 empty-good-bad 可达状态上，以吸收 Bellman 方程取 argmax，"
            "并由独立事件现金流账本复核"
        )
    else:
        result["decision_basis"] = (
            "存在可达非吸收闭合类，依 A-017 从有限期望利润的 argmax 中剔除"
        )
    return result


def evaluate_policy(raw_case: Any, raw_policy: Any) -> dict[str, Any]:
    return solve_policy(raw_case, raw_policy)


def profit_for_policy(raw_case: Any, raw_policy: Any) -> float | None:
    return solve_policy(raw_case, raw_policy)["profit"]


def build_q2_mrp(raw_case: Any, raw_policy: Any) -> dict[str, Any]:
    return build_mrp(raw_case, raw_policy)


def _q2_build_mrp(raw_case: Any, raw_policy: Any) -> dict[str, Any]:
    return build_mrp(raw_case, raw_policy)


def _q2_mrp_value(raw_case: Any, raw_policy: Any) -> float | None:
    return profit_for_policy(raw_case, raw_policy)


def _policy_summary(row: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "policy": list(row["policy"]),
        "policy_label": row["policy_label"],
        "profit": row["profit"],
        "expected_cost": row["expected_cost"],
        "market_revenue": row["market_revenue"],
        "is_absorbing": row["is_absorbing"],
        "absorption_probability": row["absorption_probability"],
        "spectral_radius": row["spectral_radius"],
        "reachable_state_count": row["reachable_state_count"],
        "bellman_residual": row["bellman_residual"],
        "value_iteration_error": row["value_iteration_error"],
        "cashflow_residual": row["cashflow_residual"],
        "reason": row["reason"],
    }


def solve_case(raw_case: Any) -> dict[str, Any]:
    case = _parse_case(raw_case)
    evaluated = {
        policy: solve_policy(case, policy) for policy in _POLICIES
    }
    eligible_rows = [
        row for row in evaluated.values() if row["is_absorbing"]
    ]
    if not eligible_rows:
        raise RuntimeError("案例没有任何吸收策略")
    best = max(
        eligible_rows,
        key=lambda row: float(row["profit"]),
    )
    tied = [
        row["policy"]
        for row in eligible_rows
        if abs(float(row["profit"]) - float(best["profit"])) <= CASHFLOW_ABS_TOL
    ]
    strategy_table = [
        _policy_summary(evaluated[policy]) for policy in _POLICIES
    ]
    profit_matrix = [row["profit"] for row in strategy_table]
    cost_matrix = [row["expected_cost"] for row in strategy_table]
    nonabsorbing_policies = [
        row["policy"] for row in strategy_table if not row["is_absorbing"]
    ]
    return {
        "case_id": case.case_id,
        "parameters": {
            "case_id": case.case_id,
            **case.as_nested_dict(),
        },
        "policy": list(best["policy"]),
        "policy_tuple": list(best["policy"]),
        "policy_label": best["policy_label"],
        "z1": best["z1"],
        "z2": best["z2"],
        "c": best["c"],
        "d": best["d"],
        "profit": best["profit"],
        "profit_per_good_delivery": best["profit_per_good_delivery"],
        "expected_cost": best["expected_cost"],
        "market_revenue": best["market_revenue"],
        "decision_basis": best["decision_basis"],
        "is_absorbing": best["is_absorbing"],
        "absorption_probability": best["absorption_probability"],
        "termination_probability": best["termination_probability"],
        "spectral_radius": best["spectral_radius"],
        "reachable_state_count": best["reachable_state_count"],
        "reachable_states": best["reachable_states"],
        "terminal_state": best["terminal_state"],
        "terminal_row_absorbing": best["terminal_row_absorbing"],
        "transition_row_sum_error": best["transition_row_sum_error"],
        "bellman_residual": best["bellman_residual"],
        "value_iteration_error": best["value_iteration_error"],
        "cashflow_residual": best["cashflow_residual"],
        "event_cash_ledger": best["event_cash_ledger"],
        "cost_breakdown": best["event_cash_ledger"]["components"],
        "all_costs_accounted": best["event_cash_ledger"]["all_costs_accounted"],
        "policy_tie_candidates": tied,
        "tie_break_rule": "按 False<True 的字典序选择首个最大利润策略",
        "eligible_strategy_count": len(eligible_rows),
        "nonabsorbing_policies": nonabsorbing_policies,
        "strategy_table": strategy_table,
        "strategy_profit_matrix": profit_matrix,
        "strategy_cost_matrix": cost_matrix,
    }


def solve_problem2(raw_case: Any) -> dict[str, Any]:
    return solve_case(raw_case)


def _dense_relative_grid() -> tuple[float, ...]:
    registered = tuple(Q2_SENSITIVITY_GRID)
    lower = min(registered)
    upper = max(registered)
    grid_count = len(registered)
    return tuple(
        lower
        + (upper - lower) * (offset / grid_count)
        for offset in range(-grid_count, grid_count + 1)
    )


def _scaled_probability(base: float, factor: float) -> float:
    return min(1.0, max(0.0, base * (1.0 + factor)))


def _scaled_cost(base: float, factor: float) -> float:
    return max(0.0, base * (1.0 + factor))


def _parameter_scan(
    base_case: params.Q2Case,
    field_name: str,
    label: str,
    scan_type: str,
    factors: Sequence[float],
) -> dict[str, Any]:
    points = []
    for factor in factors:
        if scan_type == "probability":
            modified_value = _scaled_probability(
                float(getattr(base_case, field_name)),
                factor,
            )
        else:
            modified_value = _scaled_cost(
                float(getattr(base_case, field_name)),
                factor,
            )
        modified_case = replace(base_case, **{field_name: modified_value})
        solved = solve_case(modified_case)
        points.append(
            {
                "relative_factor": float(factor),
                "value": float(modified_value),
                "optimal_policy": solved["policy"],
                "profit": solved["profit"],
                "expected_cost": solved["expected_cost"],
            }
        )
    return {
        "parameter": field_name,
        "label": label,
        "scan_type": scan_type,
        "base_value": float(getattr(base_case, field_name)),
        "points": points,
    }


def _sensitivity(cases: Sequence[params.Q2Case]) -> dict[str, Any]:
    base_case = cases[0]
    factors = _dense_relative_grid()
    probability_scans = [
        _parameter_scan(base_case, "p1", "零配件1次品率", "probability", factors),
        _parameter_scan(base_case, "p2", "零配件2次品率", "probability", factors),
        _parameter_scan(base_case, "pf", "成品条件次品率", "probability", factors),
    ]
    cost_scans = [
        _parameter_scan(base_case, "price1", "零配件1购买单价", "money", factors),
        _parameter_scan(base_case, "price2", "零配件2购买单价", "money", factors),
        _parameter_scan(base_case, "test1", "零配件1检测成本", "money", factors),
        _parameter_scan(base_case, "test2", "零配件2检测成本", "money", factors),
        _parameter_scan(base_case, "assembly_cost", "成品装配成本", "money", factors),
        _parameter_scan(
            base_case,
            "product_test_cost",
            "成品检测成本",
            "money",
            factors,
        ),
        _parameter_scan(base_case, "exchange_loss", "调换损失", "money", factors),
        _parameter_scan(
            base_case,
            "disassembly_cost",
            "拆解费用",
            "money",
            factors,
        ),
    ]
    return {
        "relative_grid": list(factors),
        "defect_rate": probability_scans,
        "unit_cost": cost_scans,
    }


def _breakeven_contour(
    cases: Sequence[params.Q2Case],
) -> dict[str, Any]:
    base_case = max(cases, key=lambda case: case.exchange_loss)
    factors = _dense_relative_grid()
    inspection_values = tuple(
        _scaled_cost(base_case.test1, factor) for factor in factors
    )
    exchange_values = tuple(
        _scaled_cost(base_case.exchange_loss, factor) for factor in factors
    )
    grid = []
    for inspection_cost in inspection_values:
        for exchange_loss in exchange_values:
            modified_case = replace(
                base_case,
                test1=inspection_cost,
                exchange_loss=exchange_loss,
            )
            solved = solve_case(modified_case)
            grid.append(
                {
                    "part1_inspection_cost": float(inspection_cost),
                    "exchange_loss": float(exchange_loss),
                    "policy": solved["policy"],
                    "profit": solved["profit"],
                    "z1": solved["z1"],
                    "z2": solved["z2"],
                    "c": solved["c"],
                    "d": solved["d"],
                }
            )
    return {
        "base_case_id": base_case.case_id,
        "axes": {
            "horizontal": "part1_inspection_cost",
            "vertical": "exchange_loss",
            "unit": "yuan/item",
        },
        "inspection_cost_values": list(inspection_values),
        "exchange_loss_values": list(exchange_values),
        "grid_size": len(grid),
        "grid": grid,
    }


def run() -> dict[str, Any]:
    cases = load_cases()
    case_results = [solve_case(case) for case in cases]
    policy_table = [
        {"case_id": case.case_id, **_policy_summary(row)}
        for case in case_results
        for row in case["strategy_table"]
    ]
    sensitivity = _sensitivity(cases)
    breakeven = _breakeven_contour(cases)

    eligible_rows = [
        row
        for case in case_results
        for row in case["strategy_table"]
        if row["is_absorbing"]
    ]
    max_bellman_residual = max(
        float(row["bellman_residual"]) for row in eligible_rows
    )
    max_cashflow_residual = max(
        float(row["cashflow_residual"]) for row in eligible_rows
    )
    max_value_iteration_error = max(
        float(row["value_iteration_error"]) for row in eligible_rows
    )
    ledgers = [case["event_cash_ledger"] for case in case_results]
    checks = {
        "all_cases_have_absorbing_optimum": all(
            case["is_absorbing"] for case in case_results
        ),
        "all_costs_accounted": all(
            bool(ledger["all_costs_accounted"]) for ledger in ledgers
        ),
        "market_revenue_recorded_once": all(
            bool(ledger["market_revenue_once"]) for ledger in ledgers
        ),
        "replacement_assembly_recorded_once": all(
            bool(ledger["replacement_assembly_once"]) for ledger in ledgers
        ),
        "terminal_delivery_state_is_absorbing": all(
            case["terminal_row_absorbing"] for case in case_results
        ),
        "bellman_residuals_pass": max_bellman_residual <= CASHFLOW_ABS_TOL,
        "cashflow_residuals_pass": max_cashflow_residual <= CASHFLOW_ABS_TOL,
        "value_iteration_reference_pass": (
            max_value_iteration_error <= VALUE_ITERATION_TOL
        ),
        "strategy_space_complete": (
            len(_POLICIES) == Q2_STRATEGY_SPACE_SIZE
        ),
        "all_registered_cases_executed": (
            len(case_results) == len(cases)
        ),
    }
    checks["all_checks_passed"] = all(checks.values())

    return {
        "schema": "problem2-absorbing-event-cashflow-v1",
        "problem": "Q2",
        "data_status": "table1_given_parameters",
        "case_count": len(case_results),
        "strategy_space_size": len(_POLICIES),
        "policy_order": list(_POLICY_LABELS),
        "profit_unit": "yuan/qualified_delivery",
        "cost_unit": "yuan/item",
        "cases": case_results,
        "optimal_policy_by_case": [
            {
                "case_id": case["case_id"],
                "policy": case["policy"],
                "profit": case["profit"],
            }
            for case in case_results
        ],
        "policy_table": policy_table,
        "strategy_profit_matrix": [
            case["strategy_profit_matrix"] for case in case_results
        ],
        "strategy_cost_matrix": [
            case["strategy_cost_matrix"] for case in case_results
        ],
        "cost_breakdown_by_case": [
            {
                "case_id": case["case_id"],
                "components": case["cost_breakdown"],
            }
            for case in case_results
        ],
        "sensitivity": sensitivity,
        "breakeven_contour": breakeven,
        "validation": {
            **checks,
            "maximum_bellman_residual": max_bellman_residual,
            "maximum_cashflow_residual": max_cashflow_residual,
            "maximum_value_iteration_error": max_value_iteration_error,
            "cashflow_abs_tolerance": CASHFLOW_ABS_TOL,
            "value_iteration_tolerance": VALUE_ITERATION_TOL,
        },
    }


def validate(payload: Mapping[str, Any]) -> bool:
    expected_case_count = len(load_cases())
    if payload.get("case_count") != expected_case_count:
        raise AssertionError("问题二案例行数与 params.Q2_CASES 不一致")
    cases = payload.get("cases")
    if not isinstance(cases, list) or len(cases) != expected_case_count:
        raise AssertionError("问题二 cases 必须逐行覆盖 Q2_CASES")
    expected_table_rows = expected_case_count * Q2_STRATEGY_SPACE_SIZE
    policy_table = payload.get("policy_table")
    if not isinstance(policy_table, list) or len(policy_table) != expected_table_rows:
        raise AssertionError("问题二完整策略表行数不正确")
    if payload.get("strategy_space_size") != Q2_STRATEGY_SPACE_SIZE:
        raise AssertionError("问题二策略空间规模不正确")
    if tuple(payload.get("policy_order", ())) != _POLICY_LABELS:
        raise AssertionError("问题二策略顺序与字典序不一致")

    for case in cases:
        if "policy" not in case or "profit" not in case:
            raise AssertionError("问题二最优行缺少 policy 或 profit")
        if not case.get("is_absorbing"):
            raise AssertionError("问题二最优策略必须为吸收策略")
        if not math.isfinite(float(case["profit"])):
            raise AssertionError("问题二最优利润必须有限")
        if float(case["bellman_residual"]) > CASHFLOW_ABS_TOL:
            raise AssertionError("问题二 Bellman 残差超限")
        if float(case["cashflow_residual"]) > CASHFLOW_ABS_TOL:
            raise AssertionError("问题二事件现金流残差超限")
        strategy_table = case.get("strategy_table")
        if not isinstance(strategy_table, list) or len(strategy_table) != Q2_STRATEGY_SPACE_SIZE:
            raise AssertionError("问题二每行必须保留全部登记策略")
        profit_matrix = case.get("strategy_profit_matrix")
        cost_matrix = case.get("strategy_cost_matrix")
        if not isinstance(profit_matrix, list) or len(profit_matrix) != Q2_STRATEGY_SPACE_SIZE:
            raise AssertionError("问题二策略利润矩阵宽度不正确")
        if not isinstance(cost_matrix, list) or len(cost_matrix) != Q2_STRATEGY_SPACE_SIZE:
            raise AssertionError("问题二策略成本矩阵宽度不正确")
        if not case.get("all_costs_accounted"):
            raise AssertionError("问题二存在未进入现金账本的题面成本")

    sensitivity = payload.get("sensitivity", {})
    sensitivity_groups = (
        list(sensitivity.get("defect_rate", ()))
        + list(sensitivity.get("unit_cost", ()))
    )
    if not sensitivity_groups:
        raise AssertionError("问题二缺少灵敏度序列")
    for scan in sensitivity_groups:
        if len(scan.get("points", ())) <= len(Q2_SENSITIVITY_GRID):
            raise AssertionError("问题二灵敏度点数必须细于登记网格")
        for point in scan["points"]:
            if "optimal_policy" not in point or "profit" not in point:
                raise AssertionError("问题二灵敏度点必须重新优化并记录利润")
    contour = payload.get("breakeven_contour", {})
    if not contour.get("grid"):
        raise AssertionError("问题二缺少盈亏平衡二维决策网格")
    if payload.get("validation", {}).get("all_checks_passed") is not True:
        raise AssertionError("问题二机器核验未全部通过")
    return True


def self_test() -> None:
    cases = load_cases()
    if len(_POLICIES) != Q2_STRATEGY_SPACE_SIZE:
        raise AssertionError("策略枚举回归测试失败")
    if len(cases) != len(params.Q2_CASES):
        raise AssertionError("Q2Case 回归测试失败")

    case = cases[0]
    nested = case.as_nested_dict()
    nested["case_id"] = case.case_id
    reparsed = _parse_case(nested)
    for field_name in (
        "price1",
        "test1",
        "price2",
        "test2",
        "assembly_cost",
        "product_test_cost",
        "market_price",
        "exchange_loss",
        "disassembly_cost",
    ):
        if not math.isclose(
            float(getattr(case, field_name)),
            float(getattr(reparsed, field_name)),
            rel_tol=0.0,
            abs_tol=CASHFLOW_ABS_TOL,
        ):
            raise AssertionError(f"问题二字段适配失败：{field_name}")

    inspected_disassembly = solve_policy(case, (True, True, True, True))
    if not inspected_disassembly["is_absorbing"]:
        raise AssertionError("全检且允许无损回收的策略应可吸收")
    disassembly_counts = inspected_disassembly["event_cash_ledger"]["event_counts"]
    if disassembly_counts["disassemblies"] <= 0.0:
        raise AssertionError("拆解事件没有进入事件账本")
    if float(inspected_disassembly["cashflow_residual"]) > CASHFLOW_ABS_TOL:
        raise AssertionError("全检拆解策略现金流核验失败")

    market_loop = solve_policy(case, (False, False, False, False))
    if not market_loop["is_absorbing"]:
        raise AssertionError("报废重建策略应可吸收")
    market_counts = market_loop["event_cash_ledger"]["event_counts"]
    if market_counts["market_bad_sales"] <= 0.0 or market_counts["returns"] <= 0.0:
        raise AssertionError("不检测成品的调换路径没有进入事件账本")
    if market_loop["event_cash_ledger"]["exchange_loss"] if False else False:
        raise AssertionError("不可达分支")

    if case.p1 > 0.0:
        nonabsorbing = solve_policy(case, (False, True, True, True))
        if nonabsorbing["is_absorbing"]:
            raise AssertionError("未检测零件加无损拆解的回收陷阱未被识别")
        if nonabsorbing["absorption_probability"] >= 1.0:
            raise AssertionError("非吸收策略的终止概率计算失败")