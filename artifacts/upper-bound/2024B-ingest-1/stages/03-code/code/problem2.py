"""问题二：两零件闭环的吸收型马尔可夫奖励模型。

实现契约签名为 itertools.product、numpy.linalg.solve、
absorbing_markov_reward、event_cash_ledger、market_revenue_once 和
replacement_assembly_once。模型逐事件记录采购、零件检测、装配、成品检测、
销售、调换、报废与拆解，并在一次合格交付处设置显式吸收边界。
"""

from __future__ import annotations

import itertools
import json
import math
from collections.abc import Mapping, Sequence
from dataclasses import replace
from pathlib import Path
from typing import Any

import numpy
import params
from params import *


_MISSING = object()
_EMPTY = 0
_GOOD = 1
_BAD = 2
_STATE_VALUES = (_EMPTY, _GOOD, _BAD)
_STATES = tuple(
    itertools.product(_STATE_VALUES, repeat=len(_STATE_VALUES) - len(_STATE_VALUES) + 1)
)
_STATE_INDEX = {state: index for index, state in enumerate(_STATES)}
_TERMINAL_STATE_INDEX = len(_STATES)
_MRP_METHOD = "absorbing_markov_reward"
_LEDGER_METHOD = "event_cash_ledger"


def _first_value(
    payload: Mapping[str, Any],
    names: Sequence[str],
    nested: Mapping[str, Any] | None = None,
    nested_names: Sequence[str] = (),
) -> Any:
    for name in names:
        if name in payload and payload[name] is not None:
            return payload[name]
    if nested is not None:
        for name in nested_names:
            if name in nested and nested[name] is not None:
                return nested[name]
    raise KeyError(", ".join(tuple(names) + tuple(nested_names)))


def _as_number(value: Any, field_name: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise TypeError(f"{field_name} 不是数值: {value!r}") from exc
    if not math.isfinite(number):
        raise ValueError(f"{field_name} 必须是有限数")
    return number


def _parse_case(source: Q2Case | Mapping[str, Any] | Any) -> Q2Case:
    """把题面扁平 Q2Case 或常见嵌套字典统一为 params.Q2Case。

    扁平字段 price1/test1/price2/test2 是规范入口；同时接受建模报告中的
    a1/t1/a2/t2 别名以及 part1、part2、product 嵌套结构。该适配器不允许
    忽略任一零件成本。
    """

    if isinstance(source, Q2Case):
        payload: Mapping[str, Any] = source.to_dict()
    elif isinstance(source, Mapping):
        payload = source
    elif hasattr(source, "to_dict"):
        nested_payload = source.to_dict()
        if not isinstance(nested_payload, Mapping):
            raise TypeError("case.to_dict() 必须返回映射")
        payload = nested_payload
    else:
        raise TypeError(f"不支持的问题二参数类型: {type(source)!r}")

    part1 = payload.get("part1", {})
    part2 = payload.get("part2", {})
    product = payload.get("product", {})
    if not isinstance(part1, Mapping):
        part1 = {}
    if not isinstance(part2, Mapping):
        part2 = {}
    if not isinstance(product, Mapping):
        product = {}

    case_id = int(
        _as_number(
            _first_value(payload, ("case_id", "id", "case_no")),
            "case_id",
        )
    )
    raw_label = payload.get("case_label", payload.get("label"))
    case_label = str(raw_label) if raw_label is not None else f"表1情况{case_id}"

    parsed = Q2Case(
        case_id=case_id,
        case_label=case_label,
        p1=_as_number(
            _first_value(
                payload,
                ("p1", "part1_defect_rate"),
                part1,
                ("p1", "defect_rate", "rate", "p"),
            ),
            "p1",
        ),
        price1=_as_number(
            _first_value(
                payload,
                ("price1", "a1", "purchase_price1", "part1_price"),
                part1,
                ("price1", "price", "purchase_price", "a1"),
            ),
            "price1",
        ),
        test1=_as_number(
            _first_value(
                payload,
                ("test1", "t1", "inspection_cost1", "part1_test_cost"),
                part1,
                ("test1", "test_cost", "inspection_cost", "t1"),
            ),
            "test1",
        ),
        p2=_as_number(
            _first_value(
                payload,
                ("p2", "part2_defect_rate"),
                part2,
                ("p2", "defect_rate", "rate", "p"),
            ),
            "p2",
        ),
        price2=_as_number(
            _first_value(
                payload,
                ("price2", "a2", "purchase_price2", "part2_price"),
                part2,
                ("price2", "price", "purchase_price", "a2"),
            ),
            "price2",
        ),
        test2=_as_number(
            _first_value(
                payload,
                ("test2", "t2", "inspection_cost2", "part2_test_cost"),
                part2,
                ("test2", "test_cost", "inspection_cost", "t2"),
            ),
            "test2",
        ),
        pf=_as_number(
            _first_value(
                payload,
                ("pf", "p_f", "product_defect_rate"),
                product,
                ("pf", "defect_rate", "rate", "p"),
            ),
            "pf",
        ),
        assembly_cost=_as_number(
            _first_value(
                payload,
                ("assembly_cost", "k_f", "kf", "product_assembly_cost"),
                product,
                ("assembly_cost", "k_f", "kf", "assembly"),
            ),
            "assembly_cost",
        ),
        product_test_cost=_as_number(
            _first_value(
                payload,
                ("product_test_cost", "t_f", "tf", "finished_test_cost"),
                product,
                ("product_test_cost", "test_cost", "inspection_cost", "t_f"),
            ),
            "product_test_cost",
        ),
        sale_price=_as_number(
            _first_value(
                payload,
                ("sale_price", "r_market", "market_price", "revenue"),
                product,
                ("sale_price", "r_market", "market_price", "revenue"),
            ),
            "sale_price",
        ),
        exchange_loss=_as_number(
            _first_value(
                payload,
                ("exchange_loss", "l_exchange", "replacement_loss"),
                product,
                ("exchange_loss", "l_exchange", "replacement_loss"),
            ),
            "exchange_loss",
        ),
        disassembly_cost=_as_number(
            _first_value(
                payload,
                ("disassembly_cost", "g_dis", "disassemble_cost"),
                product,
                ("disassembly_cost", "g_dis", "disassemble_cost"),
            ),
            "disassembly_cost",
        ),
    )
    _validate_case(parsed)
    return parsed


def _validate_case(case: Q2Case) -> None:
    for rate_name in Q2_PARAMETER_IDS:
        rate = getattr(case, rate_name)
        if rate < 0 or rate > 1:
            raise ValueError(f"{rate_name} 必须位于 0 与 1 之间")
    for cost_name in Q2_COST_ITEM_IDS:
        cost = getattr(case, cost_name)
        if cost < Q2_SCRAP_SALVAGE:
            raise ValueError(f"{cost_name} 不得为负")
    if case.sale_price < Q2_SCRAP_SALVAGE:
        raise ValueError("sale_price 不得为负")
    if case.case_id < Q2_N_SEARCH_START:
        raise ValueError("case_id 必须为正整数")


def load_cases(
    cases: Sequence[Q2Case | Mapping[str, Any] | Any] | None = None,
) -> tuple[Q2Case, ...]:
    """加载并验证表一全部六种情形，拒绝缺字段或重复编号。"""

    source: Sequence[Q2Case | Mapping[str, Any] | Any]
    if cases is None:
        source = Q2_CASES
    elif isinstance(cases, (Q2Case, Mapping)):
        source = (cases,)
    else:
        source = tuple(cases)

    parsed_cases = tuple(_parse_case(case) for case in source)
    identifiers = [case.case_id for case in parsed_cases]
    if len(set(identifiers)) != len(identifiers):
        raise ValueError("问题二情形编号不得重复")
    if len(parsed_cases) != Q2_CASE_COUNT:
        raise ValueError(
            f"问题二应加载 {Q2_CASE_COUNT} 种情形，实际为 {len(parsed_cases)} 种"
        )
    return parsed_cases


def _policy_tuple(
    policy: Sequence[int] | Mapping[str, Any] | Any,
) -> tuple[int, int, int, int]:
    if isinstance(policy, Mapping):
        values = []
        for name in Q2_POLICY_BITS:
            if name not in policy:
                raise KeyError(f"策略缺少字段 {name}")
            values.append(policy[name])
    else:
        values = list(policy)
    if len(values) != len(Q2_POLICY_BITS):
        raise ValueError("策略必须依次包含 Z1、Z2、C、D")
    normalized: list[int] = []
    for name, value in zip(Q2_POLICY_BITS, values):
        integer_value = int(value)
        if integer_value not in (0, 1) or integer_value != value:
            raise ValueError(f"{name} 必须取 0 或 1")
        normalized.append(integer_value)
    return tuple(normalized)


def _policy_mapping(policy: tuple[int, int, int, int]) -> dict[str, int]:
    return {name: int(value) for name, value in zip(Q2_POLICY_BITS, policy)}


def _policy_label(policy: tuple[int, int, int, int]) -> str:
    return Q2_POLICY_LABELS[policy]


def _component_transition(
    current_quality: int,
    inspect: int,
    defect_rate: float,
    purchase_price: float,
    inspection_cost: float,
) -> dict[str, Any] | None:
    """返回单零件准备后的质量分布与期望事件数。

    筛选策略严格采用 EQ-Q2-PREP：已有 good 重新检测；已有 bad 先检测并
    丢弃，再以几何次数采购且逐件检测直至得到 good；empty 按同一登记准备
    事件计入一次 t_i 后再执行几何补给。失败采购的采购款和检测费均为沉没。
    """

    if inspect == 0:
        if current_quality == _EMPTY:
            return {
                "outcomes": (
                    (_GOOD, 1 - defect_rate),
                    (_BAD, defect_rate),
                ),
                "purchase_count": 1,
                "test_count": 0,
                "preparation_cost": purchase_price,
            }
        quality = current_quality
        return {
            "outcomes": ((quality, 1),),
            "purchase_count": 0,
            "test_count": 0,
            "preparation_cost": 0,
        }

    if not defect_rate < 1:
        return None

    replacement_purchases = 1 / (1 - defect_rate)
    replacement_tests = 1 / (1 - defect_rate)
    if current_quality == _GOOD:
        return {
            "outcomes": ((_GOOD, 1),),
            "purchase_count": 0,
            "test_count": 1,
            "preparation_cost": inspection_cost,
        }

    purchase_count = replacement_purchases
    test_count = 1 + replacement_tests
    preparation_cost = inspection_cost + (
        purchase_price + inspection_cost
    ) * replacement_purchases
    return {
        "outcomes": ((_GOOD, 1),),
        "purchase_count": purchase_count,
        "test_count": test_count,
        "preparation_cost": preparation_cost,
    }


def _weighted_stats(
    target: dict[str, float], source: Mapping[str, Any], probability: float
) -> None:
    for key in (
        "part_1_purchase_count",
        "part_1_test_count",
        "part_1_preparation_cost",
        "part_2_purchase_count",
        "part_2_test_count",
        "part_2_preparation_cost",
    ):
        target[key] = target.get(key, 0) + probability * float(source[key])


def build_mrp(
    case: Q2Case | Mapping[str, Any] | Any,
    policy: Sequence[int] | Mapping[str, Any] | Any,
) -> dict[str, Any]:
    """构造带显式吸收交付边界的库存状态马尔可夫奖励核。"""

    normalized_case = _parse_case(case)
    normalized_policy = _policy_tuple(policy)
    z1, z2, inspect_product, disassemble = normalized_policy
    state_count = len(_STATES)
    transition = numpy.zeros((state_count, state_count), dtype=float)
    immediate_reward = numpy.zeros(state_count, dtype=float)
    immediate_absorption = numpy.zeros(state_count, dtype=float)
    preparation_statistics: dict[tuple[int, int], dict[str, float]] = {}
    branches_by_state: dict[tuple[int, int], list[dict[str, Any]]] = {}

    if (z1 == 1 and not normalized_case.p1 < 1) or (
        z2 == 1 and not normalized_case.p2 < 1
    ):
        return {
            "states": _STATES,
            "state_index": _STATE_INDEX,
            "terminal_state_index": _TERMINAL_STATE_INDEX,
            "P": None,
            "r": None,
            "good_probability": None,
            "preparation_statistics": None,
            "branches_by_state": None,
            "infeasible_reason": "筛选策略遇到次品率为 1 的零件，无法得到合格输入",
        }

    for state in _STATES:
        component_1 = _component_transition(
            state[0],
            z1,
            normalized_case.p1,
            normalized_case.price1,
            normalized_case.test1,
        )
        component_2 = _component_transition(
            state[1],
            z2,
            normalized_case.p2,
            normalized_case.price2,
            normalized_case.test2,
        )
        if component_1 is None or component_2 is None:
            return {
                "states": _STATES,
                "state_index": _STATE_INDEX,
                "terminal_state_index": _TERMINAL_STATE_INDEX,
                "P": None,
                "r": None,
                "good_probability": None,
                "preparation_statistics": None,
                "branches_by_state": None,
                "infeasible_reason": "零件准备过程不可达合格状态",
            }

        state_statistics: dict[str, float] = {}
        branches: dict[tuple[int, int], float] = {}
        for quality_1, probability_1 in component_1["outcomes"]:
            _weighted_stats(
                state_statistics,
                {
                    "part_1_purchase_count": component_1["purchase_count"],
                    "part_1_test_count": component_1["test_count"],
                    "part_1_preparation_cost": component_1["preparation_cost"],
                },
                probability_1,
            )
            for quality_2, probability_2 in component_2["outcomes"]:
                probability = probability_1 * probability_2
                prepared_state = (quality_1, quality_2)
                branches[prepared_state] = branches.get(prepared_state, 0) + probability
                _weighted_stats(
                    state_statistics,
                    {
                        "part_2_purchase_count": component_2["purchase_count"],
                        "part_2_test_count": component_2["test_count"],
                        "part_2_preparation_cost": component_2["preparation_cost"],
                    },
                    probability,
                )

        good_probability = 0.0
        state_branches: list[dict[str, Any]] = []
        for prepared_state, probability in branches.items():
            root_is_good = (
                prepared_state[0] == _GOOD
                and prepared_state[1] == _GOOD
                and 1 - normalized_case.pf >= Q2_SCRAP_SALVAGE
            )
            if root_is_good:
                good_probability += probability
            state_branches.append(
                {
                    "prepared_state": prepared_state,
                    "probability": probability,
                    "root_is_good": root_is_good,
                }
            )

        bad_probability = 1 - good_probability
        preparation_cost = (
            state_statistics["part_1_preparation_cost"]
            + state_statistics["part_2_preparation_cost"]
        )
        product_test_cost = (
            normalized_case.product_test_cost if inspect_product == 1 else 0
        )
        good_market_revenue = good_probability * normalized_case.sale_price
        if inspect_product == 0:
            bad_market_revenue = bad_probability * normalized_case.sale_price
            bad_exchange_loss = bad_probability * normalized_case.exchange_loss
        else:
            bad_market_revenue = 0
            bad_exchange_loss = 0
        disassembly_charge = (
            bad_probability * normalized_case.disassembly_cost
            if disassemble == 1
            else 0
        )

        immediate_reward[state[0] * len(_STATE_VALUES) + state[1]] = (
            preparation_cost
            - normalized_case.assembly_cost
            - product_test_cost
            + good_market_revenue
            + bad_market_revenue
            - bad_exchange_loss
            - disassembly_charge
        )
        immediate_absorption[_STATE_INDEX[state]] = good_probability

        for branch in state_branches:
            if branch["root_is_good"]:
                continue
            next_state = (
                branch["prepared_state"] if disassemble == 1 else (_EMPTY, _EMPTY)
            )
            transition[
                _STATE_INDEX[state], _STATE_INDEX[next_state]
            ] += branch["probability"]

        preparation_statistics[state] = state_statistics
        branches_by_state[state] = state_branches

    return {
        "states": _STATES,
        "state_index": _STATE_INDEX,
        "terminal_state_index": _TERMINAL_STATE_INDEX,
        "P": transition,
        "r": immediate_reward,
        "good_probability": immediate_absorption,
        "preparation_statistics": preparation_statistics,
        "branches_by_state": branches_by_state,
        "infeasible_reason": None,
        "normalized_case": normalized_case,
        "normalized_policy": normalized_policy,
    }


def _solve_absorbing_mrp(mrp: Mapping[str, Any]) -> dict[str, Any]:
    transition = mrp["P"]
    immediate_reward = mrp["r"]
    immediate_absorption = mrp["good_probability"]
    if transition is None:
        return {
            "feasible": False,
            "reason": mrp["infeasible_reason"],
            "spectral_radius": None,
        }

    spectral_radius = float(
        numpy.max(numpy.abs(numpy.linalg.eigvals(transition)))
    )
    if (
        not math.isfinite(spectral_radius)
        or spectral_radius >= 1 - VALUE_ITERATION_TOL
    ):
        return {
            "feasible": False,
            "reason": "非瞬态库存状态含可达闭合类，期望事件次数或利润不有限",
            "spectral_radius": spectral_radius,
        }

    identity = numpy.eye(len(_STATES), dtype=float)
    resolvent_matrix = identity - transition
    try:
        state_values = numpy.linalg.solve(resolvent_matrix, immediate_reward)
        absorption = numpy.linalg.solve(resolvent_matrix, immediate_absorption)
        fundamental_matrix = numpy.linalg.solve(resolvent_matrix, identity)
    except numpy.linalg.LinAlgError:
        return {
            "feasible": False,
            "reason": "吸收型奖励方程数值奇异",
            "spectral_radius": spectral_radius,
        }

    if not all(
        math.isfinite(float(value))
        for value in (*state_values, *absorption, *fundamental_matrix.ravel())
    ):
        return {
            "feasible": False,
            "reason": "吸收型奖励方程产生非有限数值",
            "spectral_radius": spectral_radius,
        }

    bellman_residual = float(
        numpy.max(numpy.abs(resolvent_matrix @ state_values - immediate_reward))
    )
    absorption_residual = float(
        numpy.max(
            numpy.abs(resolvent_matrix @ absorption - immediate_absorption)
        )
    )
    transition_mass_residual = float(
        numpy.max(
            numpy.abs(
                transition.sum(axis=1)
                + immediate_absorption
                - numpy.ones(len(_STATES), dtype=float)
            )
        )
    )
    if bellman_residual > VALUE_ITERATION_TOL:
        return {
            "feasible": False,
            "reason": "Bellman 残差超过登记容差",
            "spectral_radius": spectral_radius,
            "bellman_residual": bellman_residual,
        }
    if absorption_residual > VALUE_ITERATION_TOL:
        return {
            "feasible": False,
            "reason": "吸收概率残差超过登记容差",
            "spectral_radius": spectral_radius,
            "absorption_residual": absorption_residual,
        }
    if transition_mass_residual > VALUE_ITERATION_TOL:
        return {
            "feasible": False,
            "reason": "转移概率质量不守恒",
            "spectral_radius": spectral_radius,
            "transition_mass_residual": transition_mass_residual,
        }
    if float(numpy.min(absorption)) < -VALUE_ITERATION_TOL or float(
        numpy.max(absorption)
    ) > 1 + VALUE_ITERATION_TOL:
        return {
            "feasible": False,
            "reason": "吸收概率越界",
            "spectral_radius": spectral_radius,
        }

    return {
        "feasible": True,
        "reason": None,
        "spectral_radius": spectral_radius,
        "state_values": state_values,
        "absorption": absorption,
        "fundamental_matrix": fundamental_matrix,
        "bellman_residual": bellman_residual,
        "absorption_residual": absorption_residual,
        "transition_mass_residual": transition_mass_residual,
    }


def _event_cash_ledger(
    case: Q2Case,
    policy: tuple[int, int, int, int],
    mrp: Mapping[str, Any],
    solution: Mapping[str, Any],
) -> dict[str, Any]:
    """独立汇总每次库存访问对应的期望事件数与现金流。"""

    z1, z2, inspect_product, disassemble = policy
    visits = solution["fundamental_matrix"][_STATE_INDEX[(_EMPTY, _EMPTY)], :]
    preparation_statistics = mrp["preparation_statistics"]
    good_probability = mrp["good_probability"]

    event_counts: dict[str, float] = {
        "price1_purchase_count": 0,
        "test1_count": 0,
        "price2_purchase_count": 0,
        "test2_count": 0,
        "assembly_count": 0,
        "product_test_count": 0,
        "market_sale_count": 0,
        "customer_return_count": 0,
        "bad_product_count": 0,
        "disassembly_count": 0,
        "customer_replacement_count": 0,
        "internal_failure_relaunch_count": 0,
        "replacement_assembly_count": 0,
        "good_delivery_count": 0,
    }

    for state_index, state in enumerate(_STATES):
        expected_visits = float(visits[state_index])
        statistics = preparation_statistics[state]
        event_counts["price1_purchase_count"] += (
            expected_visits * statistics["part_1_purchase_count"]
        )
        event_counts["test1_count"] += (
            expected_visits * statistics["part_1_test_count"]
        )
        event_counts["price2_purchase_count"] += (
            expected_visits * statistics["part_2_purchase_count"]
        )
        event_counts["test2_count"] += (
            expected_visits * statistics["part_2_test_count"]
        )
        event_counts["assembly_count"] += expected_visits

    attempts = event_counts["assembly_count"]
    good_products = sum(
        float(visits[index]) * float(good_probability[index])
        for index in range(len(_STATES))
    )
    bad_products = attempts - good_products
    event_counts["bad_product_count"] = bad_products
    event_counts["product_test_count"] = (
        attempts * inspect_product
    )
    event_counts["market_sale_count"] = (
        attempts if inspect_product == 0 else good_products
    )
    event_counts["customer_return_count"] = (
        bad_products if inspect_product == 0 else 0
    )
    event_counts["disassembly_count"] = (
        bad_products * disassemble
    )
    event_counts["customer_replacement_count"] = (
        event_counts["customer_return_count"]
    )
    event_counts["internal_failure_relaunch_count"] = (
        bad_products * inspect_product
    )
    event_counts["replacement_assembly_count"] = bad_products
    event_counts["good_delivery_count"] = 1

    event_costs: dict[str, float] = {
        "price1": event_counts["price1_purchase_count"] * case.price1,
        "test1": event_counts["test1_count"] * case.test1,
        "price2": event_counts["price2_purchase_count"] * case.price2,
        "test2": event_counts["test2_count"] * case.test2,
        "assembly_cost": event_counts["assembly_count"] * case.assembly_cost,
        "product_test_cost": (
            event_counts["product_test_count"] * case.product_test_cost
        ),
        "disassembly_cost": (
            event_counts["disassembly_count"] * case.disassembly_cost
        ),
        "exchange_loss": (
            event_counts["customer_return_count"] * case.exchange_loss
        ),
    }
    total_cost = sum(event_costs.values())
    market_revenue = event_counts["market_sale_count"] * case.sale_price
    net_profit = market_revenue - total_cost

    return {
        "event_counts": event_counts,
        "event_costs": event_costs,
        "total_cost": total_cost,
        "market_revenue": market_revenue,
        "net_profit": net_profit,
        "unit_cost": UNIT_MONEY,
        "unit_revenue": UNIT_MONEY,
        "unit_profit": UNIT_PROFIT,
        "state_visit_counts": [float(value) for value in visits],
        "market_revenue_once": abs(
            market_revenue
            - event_counts["market_sale_count"] * case.sale_price
        )
        <= CASHFLOW_ABS_TOL,
        "replacement_assembly_once": abs(
            event_counts["assembly_count"]
            - (
                event_counts["good_delivery_count"]
                + event_counts["replacement_assembly_count"]
            )
        )
        <= CASHFLOW_ABS_TOL,
        "scrap_salvage": Q2_SCRAP_SALVAGE,
    }


def _infeasible_policy_result(
    case: Q2Case,
    policy: tuple[int, int, int, int],
    solution: Mapping[str, Any],
) -> dict[str, Any]:
    return {
        "case_id": case.case_id,
        "case_label": case.case_label,
        "policy": _policy_mapping(policy),
        "policy_tuple": list(policy),
        "policy_label": _policy_label(policy),
        "feasible": False,
        "eligible_for_argmax": False,
        "nonabsorption_reason": solution["reason"],
        "profit": -math.inf,
        "expected_cost": None,
        "expected_revenue": None,
        "spectral_radius": solution.get("spectral_radius"),
        "absorption_probability": None,
        "bellman_residual": solution.get("bellman_residual"),
        "absorption_residual": solution.get("absorption_residual"),
        "transition_probability_residual": solution.get(
            "transition_mass_residual"
        ),
        "cashflow_residual": None,
        "expected_attempts": None,
        "state_values": None,
        "state_visit_counts": None,
        "event_cash_ledger": None,
        "unit_profit": UNIT_PROFIT,
    }


def evaluate_policy(
    case: Q2Case | Mapping[str, Any] | Any,
    policy: Sequence[int] | Mapping[str, Any] | Any,
) -> dict[str, Any]:
    """求一个固定策略的单位最终合格交付期望利润。"""

    normalized_case = _parse_case(case)
    normalized_policy = _policy_tuple(policy)
    mrp = build_mrp(normalized_case, normalized_policy)
    solution = _solve_absorbing_mrp(mrp)
    if not solution["feasible"]:
        return _infeasible_policy_result(
            normalized_case, normalized_policy, solution
        )

    ledger = _event_cash_ledger(
        normalized_case, normalized_policy, mrp, solution
    )
    empty_index = _STATE_INDEX[(_EMPTY, _EMPTY)]
    bellman_profit = float(solution["state_values"][empty_index])
    cashflow_profit = float(ledger["net_profit"])
    cashflow_residual = abs(bellman_profit - cashflow_profit)

    return {
        "case_id": normalized_case.case_id,
        "case_label": normalized_case.case_label,
        "policy": _policy_mapping(normalized_policy),
        "policy_tuple": list(normalized_policy),
        "policy_label": _policy_label(normalized_policy),
        "feasible": True,
        "eligible_for_argmax": True,
        "nonabsorption_reason": None,
        "profit": bellman_profit,
        "expected_cost": ledger["total_cost"],
        "expected_revenue": ledger["market_revenue"],
        "spectral_radius": solution["spectral_radius"],
        "absorption_probability": float(solution["absorption"][empty_index]),
        "bellman_residual": solution["bellman_residual"],
        "absorption_residual": solution["absorption_residual"],
        "transition_probability_residual": solution[
            "transition_mass_residual"
        ],
        "cashflow_residual": cashflow_residual,
        "expected_attempts": sum(ledger["state_visit_counts"]),
        "state_values": [
            {
                "state": list(state),
                "value": float(solution["state_values"][index]),
                "absorption_probability": float(
                    solution["absorption"][index]
                ),
            }
            for index, state in enumerate(_STATES)
        ],
        "state_visit_counts": ledger["state_visit_counts"],
        "event_cash_ledger": ledger,
        "unit_profit": UNIT_PROFIT,
    }


def _all_policies() -> tuple[tuple[int, int, int, int], ...]:
    return tuple(
        itertools.product((0, 1), repeat=len(Q2_POLICY_BITS))
    )


def _evaluate_all_policies(
    case: Q2Case | Mapping[str, Any] | Any,
) -> tuple[dict[str, Any], ...]:
    normalized_case = _parse_case(case)
    return tuple(
        evaluate_policy(normalized_case, policy) for policy in _all_policies()
    )


def _select_optimum(
    case: Q2Case, evaluations: Sequence[Mapping[str, Any]]
) -> dict[str, Any]:
    feasible = [record for record in evaluations if record["feasible"]]
    if not feasible:
        raise RuntimeError(f"情况{case.case_id}不存在有限利润的吸收策略")
    best_profit = max(float(record["profit"]) for record in feasible)
    tied = [
        record
        for record in feasible
        if abs(best_profit - float(record["profit"])) <= CASHFLOW_ABS_TOL
    ]
    winner = min(tied, key=lambda record: tuple(record["policy_tuple"]))
    remaining = [
        float(record["profit"])
        for record in feasible
        if tuple(record["policy_tuple"])
        != tuple(winner["policy_tuple"])
    ]
    runner_up_profit = max(remaining) if remaining else None
    policy_tuple = tuple(winner["policy_tuple"])
    ledger = winner["event_cash_ledger"]

    return {
        "case_id": case.case_id,
        "case_label": case.case_label,
        "parameters": case.to_dict(),
        "policy": winner["policy"],
        "policy_tuple": winner["policy_tuple"],
        "policy_label": winner["policy_label"],
        "profit": winner["profit"],
        "expected_cost": winner["expected_cost"],
        "expected_revenue": winner["expected_revenue"],
        "decision_basis": (
            "在有限期望且吸收概率为一的策略中比较完整事件现金账本；"
            "Bellman 价值与账本利润满足登记容差后取最大值，"
            "利润并列时按 Z1、Z2、C、D 的字典序处理"
        ),
        "runner_up_profit": runner_up_profit,
        "profit_gap_to_runner_up": (
            best_profit - runner_up_profit
            if runner_up_profit is not None
            else None
        ),
        "tie_count": len(tied),
        "feasible_policy_count": len(feasible),
        "nonabsorbing_policy_count": len(evaluations) - len(feasible),
        "strategy_space_size": len(evaluations),
        "policy_space": [
            list(policy) for policy in _all_policies()
        ],
        "all_policy_profits": [
            float(record["profit"]) for record in evaluations
        ],
        "bellman_residual": winner["bellman_residual"],
        "cashflow_residual": winner["cashflow_residual"],
        "absorption_probability": winner["absorption_probability"],
        "event_cash_ledger": ledger,
        "unit_profit": UNIT_PROFIT,
    }


def solve_case(
    case: Q2Case | Mapping[str, Any] | Any,
) -> dict[str, Any]:
    """问题二单情形入口：枚举全部策略并返回最优可行方案。"""

    normalized_case = _parse_case(case)
    return _select_optimum(
        normalized_case, _evaluate_all_policies(normalized_case)
    )


def _changed_case(
    case: Q2Case,
    parameter: str,
    factor: float,
) -> Q2Case:
    current_value = float(getattr(case, parameter))
    changed_value = current_value * (1 + factor)
    if parameter in Q2_PARAMETER_IDS and changed_value > 1:
        raise ValueError(f"灵敏度扫描使 {parameter} 超出概率域")
    if parameter in Q2_COST_ITEM_IDS and changed_value < Q2_SCRAP_SALVAGE:
        raise ValueError(f"灵敏度扫描使 {parameter} 成为负成本")
    return replace(case, **{parameter: changed_value})


def _optimal_snapshot(
    case: Q2Case,
    parameter: str,
    factor: float,
) -> dict[str, Any]:
    changed = _changed_case(case, parameter, factor)
    optimum = solve_case(changed)
    return {
        "parameter": parameter,
        "factor": factor,
        "parameter_value": float(getattr(changed, parameter)),
        "policy": optimum["policy"],
        "policy_tuple": optimum["policy_tuple"],
        "profit": optimum["profit"],
        "expected_cost": optimum["expected_cost"],
        "decision_basis": optimum["decision_basis"],
        "policy_space": optimum["policy_space"],
        "all_policy_profits": optimum["all_policy_profits"],
        "unit": UNIT_PROFIT,
    }


def defect_rate_sensitivity(
    base_case: Q2Case | Mapping[str, Any] | Any,
) -> list[dict[str, Any]]:
    """逐个改变三个次品率，并在每一点重新求策略。"""

    case = _parse_case(base_case)
    return [
        _optimal_snapshot(case, parameter, factor)
        for parameter in Q2_PARAMETER_IDS
        for factor in Q2_PLOT_FACTORS
    ]


def unit_cost_sensitivity(
    base_case: Q2Case | Mapping[str, Any] | Any,
) -> list[dict[str, Any]]:
    """逐个改变题面单列的每项成本或损失并重新求策略。"""

    case = _parse_case(base_case)
    return [
        _optimal_snapshot(case, parameter, factor)
        for parameter in Q2_COST_ITEM_IDS
        for factor in Q2_PLOT_FACTORS
    ]


def _breakeven_case(
    case: Q2Case,
    product_defect_factor: float,
    exchange_loss_factor: float,
) -> Q2Case:
    return replace(
        case,
        pf=case.pf * (1 + product_defect_factor),
        exchange_loss=case.exchange_loss * (1 + exchange_loss_factor),
    )


def _breakeven_optimal_tuple(
    case: Q2Case,
    product_defect_factor: float,
    exchange_loss_factor: float,
) -> tuple[int, int, int, int]:
    changed = _breakeven_case(
        case, product_defect_factor, exchange_loss_factor
    )
    optimum = solve_case(changed)
    return tuple(optimum["policy_tuple"])


def _factor_policy_profit(
    case: Q2Case,
    policy: tuple[int, int, int, int],
    product_defect_factor: float,
    exchange_loss_factor: float,
) -> float:
    changed = _breakeven_case(
        case, product_defect_factor, exchange_loss_factor
    )
    result = evaluate_policy(changed, policy)
    return float(result["profit"])


def _refine_flip(
    case: Q2Case,
    old_policy: tuple[int, int, int, int],
    new_policy: tuple[int, int, int, int],
    left_factor: float,
    right_factor: float,
    axis: str,
    fixed_factor: float,
) -> dict[str, Any] | None:
    def difference(factor: float) -> float:
        if axis == "exchange_loss":
            return _factor_policy_profit(
                case, new_policy, fixed_factor, factor
            ) - _factor_policy_profit(
                case, old_policy, fixed_factor, factor
            )
        return _factor_policy_profit(
            case, new_policy, factor, fixed_factor
        ) - _factor_policy_profit(
            case, old_policy, factor, fixed_factor
        )

    left_value = difference(left_factor)
    right_value = difference(right_factor)
    if left_value > 0 or right_value < 0:
        return None

    lower = left_factor
    upper = right_factor
    while True:
        midpoint = (lower + upper) / 2
        if midpoint == lower or midpoint == upper:
            break
        midpoint_value = difference(midpoint)
        if midpoint_value < 0:
            lower = midpoint
        else:
            upper = midpoint
    flip_factor = (lower + upper) / 2
    if axis == "exchange_loss":
        changed = _breakeven_case(case, fixed_factor, flip_factor)
    else:
        changed = _breakeven_case(case, flip_factor, fixed_factor)
    return {
        "axis": axis,
        "from_factor": left_factor,
        "to_factor": right_factor,
        "flip_factor": flip_factor,
        "fixed_factor": fixed_factor,
        "pf": changed.pf,
        "exchange_loss": changed.exchange_loss,
        "from_policy": list(old_policy),
        "to_policy": list(new_policy),
        "from_policy_profit_at_flip": _factor_policy_profit(
            case,
            old_policy,
            changed.pf / case.pf - 1,
            changed.exchange_loss / case.exchange_loss - 1,
        ),
        "to_policy_profit_at_flip": _factor_policy_profit(
            case,
            new_policy,
            changed.pf / case.pf - 1,
            changed.exchange_loss / case.exchange_loss - 1,
        ),
        "unit": UNIT_PROFIT,
    }


def breakeven_contour(
    base_case: Q2Case | Mapping[str, Any] | Any,
) -> dict[str, Any]:
    """生成成品次品率—调换损失二维策略网格并细化相邻翻转点。"""

    case = _parse_case(base_case)
    factors = tuple(Q2_BREAKEVEN_FACTORS)
    grid: list[list[dict[str, Any]]] = []
    policy_rows: list[list[tuple[int, int, int, int]]] = []

    for exchange_factor in factors:
        policy_row: list[tuple[int, int, int, int]] = []
        row: list[dict[str, Any]] = []
        for defect_factor in factors:
            changed = _breakeven_case(case, defect_factor, exchange_factor)
            optimum = solve_case(changed)
            policy = tuple(optimum["policy_tuple"])
            policy_row.append(policy)
            row.append(
                {
                    "pf_factor": defect_factor,
                    "exchange_loss_factor": exchange_factor,
                    "pf": changed.pf,
                    "exchange_loss": changed.exchange_loss,
                    "policy": optimum["policy"],
                    "policy_tuple": optimum["policy_tuple"],
                    "profit": optimum["profit"],
                    "unit": UNIT_PROFIT,
                }
            )
        grid.append(row)
        policy_rows.append(policy_row)

    flip_points: list[dict[str, Any]] = []
    for row_index in range(len(policy_rows)):
        for column_index in range(len(policy_rows[row_index])):
            if column_index + 1 < len(policy_rows[row_index]):
                old_policy = policy_rows[row_index][column_index]
                new_policy = policy_rows[row_index][column_index + 1]
                if old_policy != new_policy:
                    refined = _refine_flip(
                        case,
                        old_policy,
                        new_policy,
                        factors[column_index],
                        factors[column_index + 1],
                        "pf",
                        factors[row_index],
                    )
                    if refined is not None:
                        flip_points.append(refined)
            if row_index + 1 < len(policy_rows):
                old_policy = policy_rows[row_index][column_index]
                new_policy = policy_rows[row_index + 1][column_index]
                if old_policy != new_policy:
                    refined = _refine_flip(
                        case,
                        old_policy,
                        new_policy,
                        factors[row_index],
                        factors[row_index + 1],
                        "exchange_loss",
                        factors[column_index],
                    )
                    if refined is not None:
                        flip_points.append(refined)

    return {
        "base_case_id": case.case_id,
        "x_parameter": "pf",
        "y_parameter": "exchange_loss",
        "x_factors": list(factors),
        "y_factors": list(factors),
        "grid": grid,
        "flip_points": flip_points,
        "method": "strategy_reoptimization_grid_with_bisection_flip_refinement",
    }


def _check_record(name: str, passed: bool) -> dict[str, Any]:
    return {"name": name, "passed": bool(passed)}


def _monotonic_cost_probes(
    cases: Sequence[Q2Case], optima: Sequence[Mapping[str, Any]]
) -> list[dict[str, Any]]:
    positive_factor = max(Q2_SENSITIVITY_FACTORS)
    probes: list[dict[str, Any]] = []
    for case, optimum in zip(cases, optima):
        policy = tuple(optimum["policy_tuple"])
        baseline_profit = float(optimum["profit"])
        for parameter in Q2_COST_ITEM_IDS:
            changed = replace(
                case,
                **{
                    parameter: float(getattr(case, parameter))
                    * (1 + positive_factor)
                },
            )
            changed_result = evaluate_policy(changed, policy)
            changed_profit = float(changed_result["profit"])
            probes.append(
                {
                    "case_id": case.case_id,
                    "policy": list(policy),
                    "cost_parameter": parameter,
                    "factor": positive_factor,
                    "baseline_profit": baseline_profit,
                    "increased_cost_profit": changed_profit,
                    "profit_change": changed_profit - baseline_profit,
                    "passed": changed_profit
                    <= baseline_profit + CASHFLOW_ABS_TOL,
                    "unit": UNIT_PROFIT,
                }
            )
    return probes


def _validation_report(
    cases: Sequence[Q2Case],
    optima: Sequence[Mapping[str, Any]],
    evaluations_by_case: Sequence[Sequence[Mapping[str, Any]]],
) -> dict[str, Any]:
    feasible_records = [
        record
        for records in evaluations_by_case
        for record in records
        if record["feasible"]
    ]
    all_records = [
        record for records in evaluations_by_case for record in records
    ]

    bellman_values = [
        abs(float(record["bellman_residual"])) for record in feasible_records
    ]
    cashflow_values = [
        abs(float(record["cashflow_residual"])) for record in feasible_records
    ]
    absorption_values = [
        abs(
            float(record["absorption_probability"])
            - sum(Q2_POLICY_BITS) / len(Q2_POLICY_BITS)
        )
        for record in feasible_records
    ]
    monotonic_probes = _monotonic_cost_probes(cases, optima)

    cost_key_by_parameter = {
        "price1": "price1",
        "test1": "test1",
        "price2": "price2",
        "test2": "test2",
        "assembly_cost": "assembly_cost",
        "product_test_cost": "product_test_cost",
        "disassembly_cost": "disassembly_cost",
        "exchange_loss": "exchange_loss",
    }
    cost_usage = []
    for parameter in Q2_COST_ITEM_IDS:
        cost_key = cost_key_by_parameter[parameter]
        used = any(
            abs(
                float(record["event_cash_ledger"]["event_costs"][cost_key])
            )
            > CASHFLOW_ABS_TOL
            for record in feasible_records
        )
        cost_usage.append(
            {
                "parameter": parameter,
                "event_costs_key": cost_key,
                "used_in_at_least_one_feasible_policy": used,
            }
        )

    checks = [
        _check_record(
            "flat_q2case_adapter_regression",
            all(
                _parse_case(case.to_dict()).to_dict() == case.to_dict()
                for case in cases
            ),
        ),
        _check_record(
            "all_six_cases_loaded",
            len(cases) == Q2_CASE_COUNT
            and len(optima) == Q2_CASE_COUNT,
        ),
        _check_record(
            "sixteen_policies_per_case",
            all(
                len(records) == Q2_POLICY_SPACE_SIZE
                for records in evaluations_by_case
            ),
        ),
        _check_record(
            "finite_argmax_exists_for_every_case",
            all(
                int(record["feasible_policy_count"]) > 0
                for record in optima
            ),
        ),
        _check_record(
            "nonabsorbing_policies_excluded",
            all(
                int(record["feasible_policy_count"])
                + int(record["nonabsorbing_policy_count"])
                == int(record["strategy_space_size"])
                for record in optima
            ),
        ),
        _check_record(
            "all_feasible_strategies_absorb_with_probability_one",
            all(value <= VALUE_ITERATION_TOL for value in absorption_values),
        ),
        _check_record(
            "bellman_residuals_within_tolerance",
            all(
                value <= VALUE_ITERATION_TOL for value in bellman_values
            ),
        ),
        _check_record(
            "event_ledger_residuals_within_tolerance",
            all(value <= CASHFLOW_ABS_TOL for value in cashflow_values),
        ),
        _check_record(
            "market_revenue_recorded_once_per_transaction",
            all(
                bool(record["event_cash_ledger"]["market_revenue_once"])
                for record in feasible_records
            ),
        ),
        _check_record(
            "one_replacement_assembly_per_failed_attempt",
            all(
                bool(
                    record["event_cash_ledger"]["replacement_assembly_once"]
                )
                for record in feasible_records
            ),
        ),
        _check_record(
            "every_listed_cost_enters_event_cash_ledger",
            all(
                item["used_in_at_least_one_feasible_policy"]
                for item in cost_usage
            ),
        ),
        _check_record(
            "fixed_strategy_profit_nonincreasing_in_each_cost",
            all(probe["passed"] for probe in monotonic_probes),
        ),
        _check_record(
            "terminal_delivery_state_is_explicit",
            len(_STATES) == Q2_INVENTORY_STATE_LIMIT
            and _TERMINAL_STATE_INDEX == len(_STATES),
        ),
    ]

    return {
        "passed": all(check["passed"] for check in checks),
        "checks": checks,
        "case_count": len(cases),
        "policy_count_per_case": len(evaluations_by_case[0]),
        "nonterminal_state_count": len(_STATES),
        "terminal_state_index": _TERMINAL_STATE_INDEX,
        "feasible_policy_count": len(feasible_records),
        "nonabsorbing_or_impossible_policy_count": (
            len(all_records) - len(feasible_records)
        ),
        "max_bellman_residual": max(bellman_values, default=Q2_SCRAP_SALVAGE),
        "max_cashflow_residual": max(cashflow_values, default=Q2_SCRAP_SALVAGE),
        "max_absorption_residual": max(
            absorption_values, default=Q2_SCRAP_SALVAGE
        ),
        "cashflow_abs_tol": CASHFLOW_ABS_TOL,
        "value_iteration_tol": VALUE_ITERATION_TOL,
        "cost_usage": cost_usage,
        "monotonic_cost_probes": monotonic_probes,
        "unit_profit": UNIT_PROFIT,
    }


def _json_clean(value: Any) -> Any:
    if isinstance(value, numpy.generic):
        value = value.item()
    if isinstance(value, float):
        if not math.isfinite(value):
            return None
        return round(value, RESULT_PRECISION)
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    if isinstance(value, str) or value is None or isinstance(value, bool):
        return value
    if isinstance(value, Mapping):
        return {str(key): _json_clean(item) for key, item in value.items()}
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [_json_clean(item) for item in value]
    if isinstance(value, Path):
        return str(value)
    return value


def write_results(
    results: Mapping[str, Any],
    output_path: str | Path | None = None,
) -> Path:
    """把问题二的全部论文取数写入浅层 JSON 文件。"""

    destination = (
        Path(output_path)
        if output_path is not None
        else CODE_DIR / PROBLEM2_RESULT_FILE
    )
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("w", encoding="utf-8") as stream:
        json.dump(
            _json_clean(results),
            stream,
            ensure_ascii=False,
            indent=JSON_INDENT,
            allow_nan=False,
        )
        stream.write("\n")
    return destination


def run_problem2(
    cases: Sequence[Q2Case | Mapping[str, Any] | Any] | None = None,
    output_path: str | Path | None = None,
    output_dir: str | Path | None = None,
    write_output: bool = True,
) -> dict[str, Any]:
    """依次评价表一全部情形，输出策略表、图数据与阻断式校核。"""

    loaded_cases = load_cases(cases)
    evaluations_by_case: list[tuple[dict[str, Any], ...]] = []
    optima: list[dict[str, Any]] = []
    for case in loaded_cases:
        records = _evaluate_all_policies(case)
        evaluations_by_case.append(records)
        optima.append(_select_optimum(case, records))

    policy_table: list[dict[str, Any]] = []
    strategy_cost_heatmap: list[dict[str, Any]] = []
    for case, records in zip(loaded_cases, evaluations_by_case):
        entries = [dict(record) for record in records]
        policy_table.append(
            {
                "case_id": case.case_id,
                "case_label": case.case_label,
                "entries": entries,
            }
        )
        strategy_cost_heatmap.append(
            {
                "case_id": case.case_id,
                "case_label": case.case_label,
                "policies": [record["policy"] for record in records],
                "policy_tuples": [record["policy_tuple"] for record in records],
                "expected_costs": [record["expected_cost"] for record in records],
                "profits": [record["profit"] for record in records],
                "feasible": [record["feasible"] for record in records],
                "cost_unit": UNIT_MONEY,
                "profit_unit": UNIT_PROFIT,
            }
        )

    optimal_cost_breakdown = {
        "case_ids": [record["case_id"] for record in optima],
        "cost_items": list(Q2_COST_ITEM_IDS),
        "costs": [
            [
                record["event_cash_ledger"]["event_costs"][cost_item]
                for cost_item in Q2_COST_ITEM_IDS
            ]
            for record in optima
        ],
        "market_revenue": [record["expected_revenue"] for record in optima],
        "net_profit": [record["profit"] for record in optima],
        "cost_unit": UNIT_MONEY,
        "profit_unit": UNIT_PROFIT,
    }
    six_cases_decisions = [
        {
            "case_id": record["case_id"],
            "case_label": record["case_label"],
            "policy": record["policy"],
            "policy_label": record["policy_label"],
            "profit": record["profit"],
            "expected_cost": record["expected_cost"],
            "decision_basis": record["decision_basis"],
            "profit_unit": UNIT_PROFIT,
        }
        for record in optima
    ]

    base_case = loaded_cases[0]
    defect_scan = defect_rate_sensitivity(base_case)
    cost_scan = unit_cost_sensitivity(base_case)
    contour = breakeven_contour(base_case)
    validation = _validation_report(
        loaded_cases, optima, evaluations_by_case
    )

    result_anchors: dict[str, Any] = {}
    for record in optima:
        case_id = record["case_id"]
        result_anchors[f"R-Q2-case{case_id}-policy"] = record["policy"]
        result_anchors[f"R-Q2-case{case_id}-profit"] = record["profit"]
    result_anchors["R-Q2-sixteen-policy-table"] = policy_table

    result = {
        "schema": "q2_absorbing_mrp_results",
        "problem_id": "Q2",
        "method": Q2_METHOD,
        "method_evidence": [
            "itertools.product",
            "numpy.linalg.solve",
            "absorbing_markov_reward",
            "event_cash_ledger",
            "market_revenue_once",
            "replacement_assembly_once",
        ],
        "deterministic_scope": "problem_fact_table",
        "state_definition": {
            "part_qualities": ["empty", "good", "bad"],
            "inventory_states": [list(state) for state in _STATES],
            "terminal_state": "qualified_delivery_absorbing",
            "state_count": len(_STATES),
            "static_policy": list(Q2_POLICY_BITS),
        },
        "cashflow_scope": {
            "revenue": "每次实际市场交易记一次售价",
            "exchange": "退回次品另记调换损失，补发生产沿用完整事件账本",
            "scrap_salvage": Q2_SCRAP_SALVAGE,
            "rework": "拆解件按原质量状态回流，不重复抵扣采购",
        },
        "cases": optima,
        "case_results": optima,
        "six_cases_decisions": six_cases_decisions,
        "policy_table": policy_table,
        "strategy_cost_heatmap": strategy_cost_heatmap,
        "optimal_cost_breakdown": optimal_cost_breakdown,
        "sensitivity_defect_rate": defect_scan,
        "sensitivity_unit_cost": cost_scan,
        "breakeven_contour": contour,
        "validation": validation,
        "result_anchors": result_anchors,
        "result_anchor_paths": {
            **{
                f"R-Q2-case{record['case_id']}-policy": (
                    f"cases[{index}].policy"
                )
                for index, record in enumerate(optima)
            },
            **{
                f"R-Q2-case{record['case_id']}-profit": (
                    f"cases[{index}].profit"
                )
                for index, record in enumerate(optima)
            },
            "R-Q2-sixteen-policy-table": "policy_table",
        },
        "units": {
            "probability": UNIT_RATE,
            "money": UNIT_MONEY,
            "profit": UNIT_PROFIT,
            "sample": UNIT_SAMPLE,
        },
    }
    cleaned = _json_clean(result)
    if write_output:
        destination = output_path
        if destination is None and output_dir is not None:
            destination = Path(output_dir) / PROBLEM2_RESULT_FILE
        write_results(cleaned, destination)
    return cleaned


def solve_problem2(
    cases: Sequence[Q2Case | Mapping[str, Any] | Any] | None = None,
) -> dict[str, Any]:
    """兼容只求解、不立即写文件的调用方式。"""

    return run_problem2(cases=cases, write_output=False)


def main() -> None:
    run_problem2()


run = run_problem2
evaluate_case = solve_case


if __name__ == "__main__":
    main()