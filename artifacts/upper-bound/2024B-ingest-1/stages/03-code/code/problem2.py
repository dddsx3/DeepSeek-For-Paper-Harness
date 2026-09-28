from __future__ import annotations

import itertools
import json
import math
from collections import Counter
from dataclasses import asdict, dataclass, is_dataclass, replace
from inspect import getsource
from pathlib import Path
from typing import Any, Mapping

import numpy
import params


_QUALITIES = ("empty", "good", "bad")
_STATES = tuple(itertools.product(_QUALITIES, repeat=2))
_MISSING = object()
_ZERO = 0.0
_ONE = 1.0


@dataclass(frozen=True)
class Case:
    case_id: str
    p1: float
    p2: float
    pf: float
    a1: float
    a2: float
    t1: float
    t2: float
    kf: float
    tf: float
    sale_price: float
    exchange_loss: float
    disassembly_cost: float


@dataclass(frozen=True)
class Policy:
    z1: int
    z2: int
    c: int
    d: int

    @classmethod
    def from_vector(cls, vector: tuple[int, ...] | list[int]) -> "Policy":
        if len(vector) != len(_STATES[0]) + len(_STATES[0]):
            raise ValueError("策略向量必须逐项对应 Z1、Z2、C、D")
        values = tuple(_as_bit(value) for value in vector)
        return cls(*values)

    @classmethod
    def from_mapping(cls, mapping: Mapping[str, Any]) -> "Policy":
        data = _as_mapping(mapping)
        fields = (
            _lookup(data, ("z1", "inspect_part1", "part1_inspection", "检测零配件1")),
            _lookup(data, ("z2", "inspect_part2", "part2_inspection", "检测零配件2")),
            _lookup(data, ("c", "inspect_product", "product_inspection", "检测成品")),
            _lookup(data, ("d", "disassemble", "disassembly", "拆解不合格成品")),
        )
        if any(value is _MISSING for value in fields):
            raise KeyError("策略映射缺少 Z1、Z2、C 或 D")
        return cls(*(_as_bit(value) for value in fields))

    @property
    def vector(self) -> list[int]:
        return [self.z1, self.z2, self.c, self.d]

    @property
    def inspect_part1(self) -> int:
        return self.z1

    @property
    def inspect_part2(self) -> int:
        return self.z2

    @property
    def inspect_product(self) -> int:
        return self.c

    @property
    def disassemble(self) -> int:
        return self.d

    def __iter__(self):
        return iter(self.vector)


def _parameter_optional(*names: str) -> Any:
    for name in names:
        if hasattr(params, name):
            return getattr(params, name)
    return None


def _parameter(*names: str) -> Any:
    value = _parameter_optional(*names)
    if value is None:
        raise KeyError(f"params.py 缺少登记常数：{names}")
    return value


def _as_mapping(value: Any) -> Mapping[str, Any]:
    if isinstance(value, Mapping):
        return value
    if is_dataclass(value) and not isinstance(value, type):
        return asdict(value)
    if hasattr(value, "__dict__"):
        return dict(vars(value))
    raise TypeError(f"无法把 {type(value)!r} 解释为字段映射")


def _lookup(container: Any, names: tuple[str, ...]) -> Any:
    if container is None:
        return _MISSING
    if isinstance(container, Mapping):
        for name in names:
            if name in container:
                return container[name]
    for name in names:
        try:
            return getattr(container, name)
        except (AttributeError, TypeError):
            pass
    return _MISSING


def _as_float(value: Any) -> float:
    if isinstance(value, str):
        token = value.strip()
        if token.endswith("%"):
            divisor = _parameter("PERCENT_BASE", "PERCENTAGE_BASE")
            return float(token[:-1]) / float(divisor)
        return float(token)
    return float(value)


def _field_number(
    container: Mapping[str, Any],
    direct_names: tuple[str, ...],
    nested: Any,
    nested_names: tuple[str, ...],
) -> float:
    value = _lookup(container, direct_names)
    if value is _MISSING:
        value = _lookup(nested, nested_names)
    if isinstance(value, Mapping) or (
        value is not _MISSING
        and not isinstance(value, (str, int, float))
        and hasattr(value, "__dict__")
    ):
        value = _lookup(value, nested_names)
    if value is _MISSING:
        raise KeyError(f"无法找到字段 {direct_names}")
    return _as_float(value)


def _parse_case(raw: Any, index: int) -> Case:
    data = _as_mapping(raw)
    part1 = _lookup(data, ("part1", "part_1", "part1_data", "part_1_data", "零配件1", "零配件 1"))
    part2 = _lookup(data, ("part2", "part_2", "part2_data", "part_2_data", "零配件2", "零配件 2"))
    product = _lookup(data, ("product", "finished_product", "成品", "final_product"))

    case_id_value = _lookup(data, ("case_id", "id", "scenario_id", "情形", "情况"))
    case_id = str(case_id_value) if case_id_value is not _MISSING else f"case_{index + 1}"

    return Case(
        case_id=case_id,
        p1=_field_number(
            data,
            ("p1", "part1_defect", "part1_defect_rate", "part_1_defect_rate", "part1_rate", "零配件1次品率"),
            part1,
            ("p", "defect_rate", "rate", "次品率"),
        ),
        p2=_field_number(
            data,
            ("p2", "part2_defect", "part2_defect_rate", "part_2_defect_rate", "part2_rate", "零配件2次品率"),
            part2,
            ("p", "defect_rate", "rate", "次品率"),
        ),
        pf=_field_number(
            data,
            ("pf", "product_defect", "product_defect_rate", "assembly_defect_rate", "成品次品率"),
            product,
            ("p", "defect_rate", "rate", "次品率"),
        ),
        a1=_field_number(
            data,
            ("a1", "part1_price", "part1_purchase_price", "purchase_price1", "零配件1购买单价"),
            part1,
            ("price", "purchase_price", "a", "购买单价"),
        ),
        a2=_field_number(
            data,
            ("a2", "part2_price", "part2_purchase_price", "purchase_price2", "零配件2购买单价"),
            part2,
            ("price", "purchase_price", "a", "购买单价"),
        ),
        t1=_field_number(
            data,
            ("t1", "part1_test_cost", "part1_inspection_cost", "inspection_cost1", "零配件1检测成本"),
            part1,
            ("test_cost", "inspection_cost", "t", "检测成本"),
        ),
        t2=_field_number(
            data,
            ("t2", "part2_test_cost", "part2_inspection_cost", "inspection_cost2", "零配件2检测成本"),
            part2,
            ("test_cost", "inspection_cost", "t", "检测成本"),
        ),
        kf=_field_number(
            data,
            ("kf", "assembly_cost", "product_assembly_cost", "装配成本"),
            product,
            ("assembly_cost", "k", "装配成本"),
        ),
        tf=_field_number(
            data,
            ("tf", "product_test_cost", "product_inspection_cost", "成品检测成本"),
            product,
            ("test_cost", "inspection_cost", "t", "检测成本"),
        ),
        sale_price=_field_number(
            data,
            ("sale_price", "market_price", "r_market", "revenue", "市场售价"),
            data,
            ("market_price", "price", "市场售价"),
        ),
        exchange_loss=_field_number(
            data,
            ("exchange_loss", "replacement_loss", "L_exchange", "调换损失"),
            data,
            ("exchange_loss", "replacement_loss", "调换损失"),
        ),
        disassembly_cost=_field_number(
            data,
            ("disassembly_cost", "g_dis", "disassembly_fee", "拆解费用"),
            data,
            ("disassembly_cost", "disassembly_fee", "拆解费用"),
        ),
    )


def _looks_like_case(value: Any) -> bool:
    try:
        data = _as_mapping(value)
    except TypeError:
        return False
    return _lookup(
        data,
        (
            "p1",
            "part1_defect",
            "part1_defect_rate",
            "part_1_defect_rate",
            "零配件1次品率",
        ),
    ) is not _MISSING


def load_cases() -> tuple[Case, ...]:
    raw_cases = _parameter_optional(
        "Q2_CASES",
        "TABLE1_CASES",
        "TABLE_1_CASES",
        "CASES_Q2",
        "Q2_TABLE1_CASES",
    )
    if raw_cases is None:
        candidates: list[tuple[str, Any]] = []
        for name in dir(params):
            if name.startswith("Q2_CASE_") or name.startswith("TABLE1_CASE_"):
                value = getattr(params, name)
                if _looks_like_case(value):
                    candidates.append((name, value))
        candidates.sort(key=lambda item: item[0])
        raw_cases = [value for _, value in candidates]
    elif isinstance(raw_cases, Mapping) and not _looks_like_case(raw_cases):
        entries = [
            (str(key), value)
            for key, value in raw_cases.items()
            if _looks_like_case(value)
        ]
        entries.sort(key=lambda item: item[0])
        raw_cases = [value for _, value in entries]
    elif _looks_like_case(raw_cases):
        raw_cases = [raw_cases]

    if not isinstance(raw_cases, (list, tuple)) or not raw_cases:
        raise ValueError("Q2_CASES 必须是非空有序案例集合")
    return tuple(_parse_case(raw, index) for index, raw in enumerate(raw_cases))


def _as_bit(value: Any) -> int:
    if isinstance(value, str):
        token = value.strip().lower()
        if token in {"1", "true", "yes", "是", "检测", "拆解"}:
            return 1
        if token in {"0", "false", "no", "否", "不检测", "报废"}:
            return 0
    result = int(value)
    if result not in (_ZERO, _ONE):
        raise ValueError(f"二值决策越界：{value}")
    return result


def enumerate_policies() -> tuple[Policy, ...]:
    return tuple(Policy(*vector) for vector in itertools.product((0, 1), repeat=4))


def _validate_case(case: Case) -> None:
    for name in ("p1", "p2", "pf"):
        value = getattr(case, name)
        if not _ZERO <= value <= _ONE:
            raise ValueError(f"{case.case_id}.{name} 不在概率域内")
    for name in (
        "a1",
        "a2",
        "t1",
        "t2",
        "kf",
        "tf",
        "sale_price",
        "exchange_loss",
        "disassembly_cost",
    ):
        if getattr(case, name) < _ZERO:
            raise ValueError(f"{case.case_id}.{name} 为负数")


def _cashflow_tolerance() -> float:
    return float(
        _parameter(
            "Q2_CASHFLOW_ABS_TOL",
            "CASHFLOW_ABS_TOL",
            "现金流核验绝对容差",
        )
    )


def _value_tolerance() -> float:
    return float(
        _parameter(
            "Q2_VALUE_TOL",
            "VALUE_ITERATION_TOL",
            "价值迭代收敛容差",
        )
    )


def _scrap_recovery_value() -> float:
    value = _parameter_optional("SCRAP_RECOVERY_VALUE", "报废回收价值")
    return _ZERO if value is None else float(value)


def _close(left: float, right: float, tolerance: float | None = None) -> bool:
    tol = _value_tolerance() if tolerance is None else tolerance
    return math.isclose(left, right, rel_tol=_ZERO, abs_tol=tol)


def _part_event(
    inspect: int,
    defect_rate: float,
    purchase_price: float,
    inspection_cost: float,
) -> tuple[tuple[str, float, float, float], ...]:
    if inspect:
        reward = -(purchase_price + inspection_cost)
        return (
            ("good", _ONE - defect_rate, reward, _ONE),
            ("empty", defect_rate, reward, _ONE),
        )
    reward = -purchase_price
    return (
        ("good", _ONE - defect_rate, reward, _ZERO),
        ("bad", defect_rate, reward, _ZERO),
    )


def _event_reward(counts: Mapping[str, float], case: Case) -> float:
    return (
        case.sale_price * counts.get("market_total", _ZERO)
        - case.a1 * counts.get("purchase1", _ZERO)
        - case.a2 * counts.get("purchase2", _ZERO)
        - case.t1 * counts.get("part_inspection1", _ZERO)
        - case.t2 * counts.get("part_inspection2", _ZERO)
        - case.kf * counts.get("assembly", _ZERO)
        - case.tf * counts.get("product_inspection", _ZERO)
        - case.disassembly_cost * counts.get("disassembly", _ZERO)
        - case.exchange_loss * counts.get("returns", _ZERO)
        + _scrap_recovery_value() * counts.get("scrap_events", _ZERO)
    )


def _build_transitions(
    case: Case, policy: Policy
) -> tuple[list[list[dict[str, Any]]], list[float], list[float]]:
    _validate_case(case)
    transitions: list[list[dict[str, Any]]] = [[] for _ in _STATES]
    rewards = [_ZERO for _ in _STATES]
    terminal_probabilities = [_ZERO for _ in _STATES]

    for state_index, state in enumerate(_STATES):
        if state[0] == "empty":
            part_index = 0
        elif state[1] == "empty":
            part_index = 1
        else:
            good_probability = _ONE - case.pf if state == ("good", "good") else _ZERO
            failure_probability = _ONE - good_probability
            for is_good, probability in (
                (_ONE, good_probability),
                (_ZERO, failure_probability),
            ):
                if probability <= _ZERO:
                    continue
                event = Counter({"assembly": _ONE})
                if policy.c:
                    event["product_inspection"] = _ONE
                if is_good:
                    event["market_good"] = _ONE
                    event["market_total"] = _ONE
                    target = None
                    terminal_probabilities[state_index] += probability
                else:
                    if not policy.c:
                        event["market_defective"] = _ONE
                        event["market_total"] = _ONE
                        event["returns"] = _ONE
                        event["replacement_assembly"] = _ONE
                    if policy.d:
                        event["disassembly"] = _ONE
                        target = state
                    else:
                        event["scrap_events"] = _ONE
                        target = ("empty", "empty")
                reward = _event_reward(event, case)
                rewards[state_index] += probability * reward
                transitions[state_index].append(
                    {
                        "probability": probability,
                        "target": target,
                        "reward": reward,
                        "event": dict(event),
                    }
                )
            coverage = sum(branch["probability"] for branch in transitions[state_index])
            coverage += terminal_probabilities[state_index]
            if not _close(coverage, _ONE, _cashflow_tolerance()):
                raise ArithmeticError(f"{case.case_id} 的完整根处置分支概率未闭合")
            continue

        inspect = policy.z1 if part_index == 0 else policy.z2
        purchase_price = case.a1 if part_index == 0 else case.a2
        inspection_cost = case.t1 if part_index == 0 else case.t2
        purchase_key = f"purchase{part_index + 1}"
        inspection_key = f"part_inspection{part_index + 1}"
        part_events = _part_event(inspect, (case.p1, case.p2)[part_index], purchase_price, inspection_cost)

        for quality, probability, reward, inspection_events in part_events:
            if probability <= _ZERO:
                continue
            if part_index == 0:
                target = (quality, state[1])
            else:
                target = (state[0], quality)
            event = Counter({purchase_key: _ONE})
            if inspection_events:
                event[inspection_key] = inspection_events
            transitions[state_index].append(
                {
                    "probability": probability,
                    "target": target,
                    "reward": reward,
                    "event": dict(event),
                }
            )
            rewards[state_index] += probability * reward

    return transitions, rewards, terminal_probabilities


def _reachable_state_indices(
    transitions: list[list[dict[str, Any]]], start: int = 0
) -> list[int]:
    seen = {start}
    pending = [start]
    while pending:
        current = pending.pop()
        for branch in transitions[current]:
            target = branch["target"]
            if target is None:
                continue
            target_index = _STATES.index(target)
            if target_index not in seen:
                seen.add(target_index)
                pending.append(target_index)
    return sorted(seen)


def _financial_ledger(counts: Mapping[str, float], case: Case) -> dict[str, Any]:
    purchase_cost = case.a1 * counts.get("purchase1", _ZERO) + case.a2 * counts.get("purchase2", _ZERO)
    part_inspection_cost = (
        case.t1 * counts.get("part_inspection1", _ZERO)
        + case.t2 * counts.get("part_inspection2", _ZERO)
    )
    assembly_cost = case.kf * counts.get("assembly", _ZERO)
    product_inspection_cost = case.tf * counts.get("product_inspection", _ZERO)
    disassembly_cost = case.disassembly_cost * counts.get("disassembly", _ZERO)
    exchange_cost = case.exchange_loss * counts.get("returns", _ZERO)
    scrap_recovery = _scrap_recovery_value() * counts.get("scrap_events", _ZERO)
    market_revenue = case.sale_price * counts.get("market_total", _ZERO)
    total_explicit_cost = (
        purchase_cost
        + part_inspection_cost
        + assembly_cost
        + product_inspection_cost
        + disassembly_cost
        + exchange_cost
        - scrap_recovery
    )
    return {
        "purchase_cost": purchase_cost,
        "part_inspection_cost": part_inspection_cost,
        "assembly_cost": assembly_cost,
        "product_inspection_cost": product_inspection_cost,
        "disassembly_cost": disassembly_cost,
        "exchange_loss_cost": exchange_cost,
        "scrap_recovery": scrap_recovery,
        "total_explicit_cost": total_explicit_cost,
        "market_revenue": market_revenue,
        "net_profit": market_revenue - total_explicit_cost,
    }


def market_revenue_once(ledger: Mapping[str, Any], case: Case) -> bool:
    expected = case.sale_price * ledger["event_counts"].get("market_total", _ZERO)
    return math.isclose(
        float(ledger["market_revenue"]),
        expected,
        rel_tol=_ZERO,
        abs_tol=_cashflow_tolerance(),
    )


def replacement_assembly_once(ledger: Mapping[str, Any]) -> bool:
    counts = ledger["event_counts"]
    returns = counts.get("returns", _ZERO)
    replacements = counts.get("replacement_assembly", _ZERO)
    assemblies = counts.get("assembly", _ZERO)
    return (
        math.isclose(returns, replacements, rel_tol=_ZERO, abs_tol=_cashflow_tolerance())
        and replacements <= assemblies + _cashflow_tolerance()
    )


def event_cash_ledger(case: Case, policy: Policy) -> dict[str, Any]:
    _validate_case(case)
    inspect1 = bool(policy.z1)
    inspect2 = bool(policy.z2)
    inspect_product = bool(policy.c)
    disassemble = bool(policy.d)

    if (inspect1 and case.p1 >= _ONE) or (inspect2 and case.p2 >= _ONE):
        absorbing = False
    else:
        good_pair_probability = (
            (_ONE if inspect1 else _ONE - case.p1)
            * (_ONE if inspect2 else _ONE - case.p2)
        )
        if disassemble:
            absorbing = good_pair_probability == _ONE and case.pf < _ONE
        else:
            absorbing = good_pair_probability * (_ONE - case.pf) > _ZERO

    if not absorbing:
        return {
            "absorbing": False,
            "absorption_probability": _ZERO,
            "profit": None,
            "total_explicit_cost": None,
            "market_revenue": None,
            "event_counts": {},
            "financial_breakdown": {},
            "market_revenue_once": True,
            "replacement_assembly_once": True,
            "passed": False,
            "exclusion_reason": "策略在允许的零配件质量状态下不能以概率一到达合格交付",
        }

    if disassemble:
        attempts = _ONE / (_ONE - case.pf)
        preparation_multiplier = _ONE
    else:
        good_pair_probability = (
            (_ONE if inspect1 else _ONE - case.p1)
            * (_ONE if inspect2 else _ONE - case.p2)
        )
        attempts = _ONE / (good_pair_probability * (_ONE - case.pf))
        preparation_multiplier = attempts

    if inspect1:
        part1_trials = _ONE / (_ONE - case.p1)
        part1_inspections = part1_trials
    else:
        part1_trials = _ONE
        part1_inspections = _ZERO
    if inspect2:
        part2_trials = _ONE / (_ONE - case.p2)
        part2_inspections = part2_trials
    else:
        part2_trials = _ONE
        part2_inspections = _ZERO

    failed_attempts = attempts - _ONE
    if inspect_product:
        market_good = _ONE
        market_defective = _ZERO
        market_total = _ONE
    else:
        market_good = _ONE
        market_defective = failed_attempts
        market_total = attempts

    counts = {
        "purchase1": part1_trials * preparation_multiplier,
        "purchase2": part2_trials * preparation_multiplier,
        "part_inspection1": part1_inspections * preparation_multiplier,
        "part_inspection2": part2_inspections * preparation_multiplier,
        "assembly": attempts,
        "product_inspection": attempts if inspect_product else _ZERO,
        "market_good": market_good,
        "market_defective": market_defective,
        "market_total": market_total,
        "returns": market_defective,
        "replacement_assembly": market_defective,
        "disassembly": failed_attempts if disassemble else _ZERO,
        "scrap_events": failed_attempts if not disassemble else _ZERO,
    }
    financial = _financial_ledger(counts, case)
    ledger = {
        "absorbing": True,
        "absorption_probability": _ONE,
        "profit": financial["net_profit"],
        "total_explicit_cost": financial["total_explicit_cost"],
        "market_revenue": financial["market_revenue"],
        "event_counts": counts,
        "financial_breakdown": financial,
    }
    revenue_ok = market_revenue_once(ledger, case)
    replacement_ok = replacement_assembly_once(ledger)
    ledger["market_revenue_once"] = revenue_ok
    ledger["replacement_assembly_once"] = replacement_ok
    ledger["passed"] = revenue_ok and replacement_ok
    return ledger


def _matrix_event_ledger(
    case: Case,
    transitions: list[list[dict[str, Any]]],
    reachable: list[int],
    visits: numpy.ndarray,
) -> dict[str, Any]:
    counts: Counter[str] = Counter()
    for local_index, global_index in enumerate(reachable):
        expected_source_visits = float(visits[local_index])
        for branch in transitions[global_index]:
            exposure = expected_source_visits * float(branch["probability"])
            for event_name, event_count in branch["event"].items():
                counts[event_name] += exposure * float(event_count)
    counts["market_total"] = counts["market_good"] + counts["market_defective"]
    normalized = {key: float(value) for key, value in counts.items()}
    financial = _financial_ledger(normalized, case)
    ledger = {
        "event_counts": normalized,
        "financial_breakdown": financial,
        "profit": financial["net_profit"],
        "total_explicit_cost": financial["total_explicit_cost"],
        "market_revenue": financial["market_revenue"],
    }
    ledger["market_revenue_once"] = market_revenue_once(ledger, case)
    ledger["replacement_assembly_once"] = replacement_assembly_once(ledger)
    return ledger


def _maximum_event_difference(left: Mapping[str, float], right: Mapping[str, float]) -> float:
    names = set(left) | set(right)
    if not names:
        return _ZERO
    return max(abs(float(left.get(name, _ZERO)) - float(right.get(name, _ZERO))) for name in names)


def absorbing_markov_reward(case: Case, policy: Policy) -> dict[str, Any]:
    transitions, rewards, terminal_probabilities = _build_transitions(case, policy)
    reachable = _reachable_state_indices(transitions)
    renewal = event_cash_ledger(case, policy)

    size = len(reachable)
    matrix = numpy.zeros((size, size), dtype=float)
    reward_vector = numpy.zeros(size, dtype=float)
    terminal_vector = numpy.zeros(size, dtype=float)
    for local_index, global_index in enumerate(reachable):
        reward_vector[local_index] = rewards[global_index]
        terminal_vector[local_index] = terminal_probabilities[global_index]
        for branch in transitions[global_index]:
            target = branch["target"]
            if target is not None:
                matrix[local_index, reachable.index(_STATES.index(target))] += float(branch["probability"])

    spectral_radius = _ZERO
    try:
        spectral_radius = float(numpy.max(numpy.abs(numpy.linalg.eigvals(matrix))))
    except numpy.linalg.LinAlgError:
        spectral_radius = math.inf

    if not renewal["absorbing"]:
        return {
            "case_id": case.case_id,
            "policy": _policy_summary(policy),
            "absorbing": False,
            "eligible": False,
            "absorption_probability": _ZERO,
            "profit": None,
            "expected_cost": None,
            "bellman_value": None,
            "bellman_residual": None,
            "cashflow_abs_difference": None,
            "max_event_count_difference": None,
            "q_spectral_radius": spectral_radius,
            "state_universe_count": len(_STATES),
            "reachable_state_count": size,
            "reachable_states": [_state_label(_STATES[index]) for index in reachable],
            "matrix_shape": [size, size],
            "event_counts": {},
            "financial_breakdown": {},
            "event_cash_ledger": renewal,
            "market_revenue_once": True,
            "replacement_assembly_once": True,
            "passed": False,
        }

    system = numpy.eye(size, dtype=float) - matrix
    try:
        values = numpy.linalg.solve(system, reward_vector)
        visits = numpy.linalg.solve(system.T, numpy.eye(size, dtype=float)[0])
    except numpy.linalg.LinAlgError:
        return {
            "case_id": case.case_id,
            "policy": _policy_summary(policy),
            "absorbing": False,
            "eligible": False,
            "absorption_probability": _ZERO,
            "profit": None,
            "expected_cost": None,
            "bellman_value": None,
            "bellman_residual": None,
            "cashflow_abs_difference": None,
            "max_event_count_difference": None,
            "q_spectral_radius": spectral_radius,
            "state_universe_count": len(_STATES),
            "reachable_state_count": size,
            "reachable_states": [_state_label(_STATES[index]) for index in reachable],
            "matrix_shape": [size, size],
            "event_counts": {},
            "financial_breakdown": {},
            "event_cash_ledger": renewal,
            "market_revenue_once": True,
            "replacement_assembly_once": True,
            "passed": False,
        }

    residual = system @ values - reward_vector
    bellman_residual = float(numpy.max(numpy.abs(residual)))
    matrix_ledger = _matrix_event_ledger(case, transitions, reachable, visits)
    terminal_delivery_probability = float(visits @ terminal_vector)
    cashflow_difference = abs(float(values[0]) - float(renewal["profit"]))
    event_difference = _maximum_event_difference(
        renewal["event_counts"], matrix_ledger["event_counts"]
    )
    passed = (
        bellman_residual <= _value_tolerance()
        and cashflow_difference <= _cashflow_tolerance()
        and event_difference <= _cashflow_tolerance()
        and _close(terminal_delivery_probability, _ONE)
        and spectral_radius < _ONE + _value_tolerance()
        and bool(matrix_ledger["market_revenue_once"])
        and bool(matrix_ledger["replacement_assembly_once"])
    )

    return {
        "case_id": case.case_id,
        "policy": _policy_summary(policy),
        "absorbing": True,
        "eligible": True,
        "absorption_probability": terminal_delivery_probability,
        "profit": float(values[0]),
        "expected_cost": float(matrix_ledger["total_explicit_cost"]),
        "bellman_value": float(values[0]),
        "bellman_residual": bellman_residual,
        "cashflow_abs_difference": cashflow_difference,
        "max_event_count_difference": event_difference,
        "q_spectral_radius": spectral_radius,
        "state_universe_count": len(_STATES),
        "reachable_state_count": size,
        "reachable_states": [_state_label(_STATES[index]) for index in reachable],
        "matrix_shape": [size, size],
        "event_counts": matrix_ledger["event_counts"],
        "financial_breakdown": matrix_ledger["financial_breakdown"],
        "event_cash_ledger": renewal,
        "market_revenue_once": bool(matrix_ledger["market_revenue_once"]),
        "replacement_assembly_once": bool(matrix_ledger["replacement_assembly_once"]),
        "passed": bool(passed),
    }


def policy_profit_analytic(case: Case, policy: Policy) -> float | None:
    ledger = event_cash_ledger(case, policy)
    profit = ledger.get("profit")
    return None if profit is None else float(profit)


def evaluate_policy(case: Case, policy: Policy) -> float | None:
    return policy_profit_analytic(case, policy)


def _best_policy(case: Case) -> tuple[Policy, float]:
    best_policy: Policy | None = None
    best_profit = -math.inf
    tolerance = _cashflow_tolerance()
    for policy in enumerate_policies():
        profit = policy_profit_analytic(case, policy)
        if profit is None:
            continue
        if best_policy is None or profit > best_profit + tolerance:
            best_policy = policy
            best_profit = profit
    if best_policy is None:
        raise RuntimeError(f"{case.case_id} 没有吸收策略")
    return best_policy, float(best_profit)


def optimal_policy(case: Case) -> dict[str, Any]:
    policy, profit = _best_policy(case)
    full = absorbing_markov_reward(case, policy)
    if not full["passed"]:
        raise ArithmeticError(f"{case.case_id} 最优策略未通过现金流核验")
    return full


def _policy_summary(policy: Policy) -> dict[str, Any]:
    return {
        "z1": policy.z1,
        "z2": policy.z2,
        "c": policy.c,
        "d": policy.d,
        "vector": policy.vector,
        "label": (
            f"Z1={policy.z1}, Z2={policy.z2}, "
            f"C={policy.c}, D={policy.d}"
        ),
    }


def _state_label(state: tuple[str, str]) -> str:
    return f"{state[0]}/{state[1]}"


def _all_policy_rows(case: Case) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for policy in enumerate_policies():
        result = absorbing_markov_reward(case, policy)
        rows.append(
            {
                "policy_vector": policy.vector,
                "policy": _policy_summary(policy),
                "absorbing": result["absorbing"],
                "eligible": result["eligible"],
                "profit": result["profit"],
                "expected_cost": result["expected_cost"],
                "absorption_probability": result["absorption_probability"],
                "bellman_residual": result["bellman_residual"],
                "cashflow_abs_difference": result["cashflow_abs_difference"],
                "max_event_count_difference": result["max_event_count_difference"],
                "passed": result["passed"],
            }
        )
    return rows


def solve_case(case: Case) -> dict[str, Any]:
    all_policies = _all_policy_rows(case)
    selected = optimal_policy(case)
    ordered = sorted(
        (row for row in all_policies if row["profit"] is not None),
        key=lambda row: (-float(row["profit"]), row["policy_vector"]),
    )
    return {
        "case_id": case.case_id,
        "inputs": asdict(case),
        "policy": selected["policy"],
        "policy_vector": selected["policy"]["vector"],
        "profit": selected["profit"],
        "expected_cost": selected["expected_cost"],
        "absorption_probability": selected["absorption_probability"],
        "decision_basis": "在全部吸收型固定策略中按单位合格交付期望利润取字典序最大值，并由状态方程与逐事件账本双算核验。",
        "optimal_cost_breakdown": selected["financial_breakdown"],
        "optimal_event_counts": selected["event_counts"],
        "bellman_residual": selected["bellman_residual"],
        "cashflow_abs_difference": selected["cashflow_abs_difference"],
        "strategy_ranking": ordered,
        "all_policies": all_policies,
    }


def _dense_relative_factors() -> list[float]:
    base = sorted(
        float(value)
        for value in _parameter(
            "RELATIVE_SENSITIVITY_GRID",
            "Q2_SENSITIVITY_GRID",
            "相对灵敏度扫描网格",
        )
    )
    if len(base) < 2:
        raise ValueError("相对灵敏度网格至少需要两个端点")
    midpoint_count = len(base) - 1
    midpoints = [
        (base[index] + base[index + 1]) / _ONE
        for index in range(midpoint_count)
    ]
    return sorted(set(base + midpoints))


def _clip_probability(value: float) -> float:
    return min(_ONE, max(_ZERO, value))


def _quick_solution(case: Case) -> tuple[Policy, float]:
    return _best_policy(case)


def _defect_sensitivity(cases: tuple[Case, ...], factors: list[float]) -> dict[str, Any]:
    series: list[dict[str, Any]] = []
    for case in cases:
        baseline_policy, baseline_profit = _quick_solution(case)
        for parameter in ("p1", "p2", "pf"):
            nominal = getattr(case, parameter)
            for factor in factors:
                perturbed = replace(
                    case,
                    **{parameter: _clip_probability(nominal * (_ONE + factor))},
                )
                point_policy, point_profit = _quick_solution(perturbed)
                fixed_profit = policy_profit_analytic(perturbed, baseline_policy)
                series.append(
                    {
                        "case_id": case.case_id,
                        "parameter": parameter,
                        "factor": factor,
                        "nominal_value": nominal,
                        "perturbed_value": getattr(perturbed, parameter),
                        "point_profit": point_profit,
                        "point_policy_vector": point_policy.vector,
                        "baseline_policy_profit": fixed_profit,
                    }
                )
    return {
        "factor_grid": factors,
        "series": series,
    }


def _cost_sensitivity(cases: tuple[Case, ...], factors: list[float]) -> dict[str, Any]:
    cost_fields = (
        "a1",
        "a2",
        "t1",
        "t2",
        "kf",
        "tf",
        "exchange_loss",
        "disassembly_cost",
    )
    series: list[dict[str, Any]] = []
    for case in cases:
        baseline_policy, baseline_profit = _quick_solution(case)
        for parameter in cost_fields:
            nominal = getattr(case, parameter)
            for factor in factors:
                perturbed = replace(
                    case,
                    **{parameter: max(_ZERO, nominal * (_ONE + factor))},
                )
                point_policy, point_profit = _quick_solution(perturbed)
                fixed_profit = policy_profit_analytic(perturbed, baseline_policy)
                series.append(
                    {
                        "case_id": case.case_id,
                        "parameter": parameter,
                        "factor": factor,
                        "nominal_value": nominal,
                        "perturbed_value": getattr(perturbed, parameter),
                        "point_profit": point_profit,
                        "point_policy_vector": point_policy.vector,
                        "baseline_policy_profit": fixed_profit,
                        "baseline_optimum_profit": baseline_profit,
                    }
                )
    return {
        "factor_grid": factors,
        "cost_fields": list(cost_fields),
        "series": series,
    }


def _uniform_grid(lower: float, upper: float, count: int) -> list[float]:
    if count < 2:
        raise ValueError("边界网格至少需要两个点")
    span = upper - lower
    denominator = count - 1
    return [lower + span * index / denominator for index in range(count)]


def _breakeven_surface(cases: tuple[Case, ...], factors: list[float]) -> dict[str, Any]:
    maximum_factor = max(factors)
    pf_upper = max(case.pf for case in cases) * (_ONE + maximum_factor)
    loss_upper = max(case.exchange_loss for case in cases) * (_ONE + maximum_factor)
    pf_grid = _uniform_grid(_ZERO, pf_upper, len(factors))
    loss_grid = _uniform_grid(_ZERO, loss_upper, len(factors))
    surfaces: list[dict[str, Any]] = []

    for case in cases:
        rows: list[dict[str, Any]] = []
        policy_matrix: list[list[list[int] | None]] = []
        profit_matrix: list[list[float | None]] = []
        for pf_value in pf_grid:
            policy_row: list[list[int] | None] = []
            profit_row: list[float | None] = []
            for loss_value in loss_grid:
                perturbed = replace(case, pf=pf_value, exchange_loss=loss_value)
                policy, profit = _quick_solution(perturbed)
                vector: list[int] | None = policy.vector
                policy_row.append(vector)
                profit_row.append(profit)
                rows.append(
                    {
                        "pf": pf_value,
                        "exchange_loss": loss_value,
                        "policy_vector": vector,
                        "profit": profit,
                    }
                )
            policy_matrix.append(policy_row)
            profit_matrix.append(profit_row)

        flip_points: list[dict[str, Any]] = []
        for y_index, y_value in enumerate(pf_grid):
            for x_index, x_value in enumerate(loss_grid):
                current = policy_matrix[y_index][x_index]
                neighbors: list[list[int] | None] = []
                if x_index + 1 < len(loss_grid):
                    neighbors.append(policy_matrix[y_index][x_index + 1])
                if y_index + 1 < len(pf_grid):
                    neighbors.append(policy_matrix[y_index + 1][x_index])
                if any(current != neighbor for neighbor in neighbors):
                    if x_index + 1 < len(loss_grid):
                        flip_points.append(
                            {
                                "pf": y_value,
                                "exchange_loss_midpoint": (x_value + loss_grid[x_index + 1]) / _ONE,
                                "left_policy": current,
                                "right_policy": policy_matrix[y_index][x_index + 1],
                            }
                        )
                    if y_index + 1 < len(pf_grid):
                        flip_points.append(
                            {
                                "pf_midpoint": (y_value + pf_grid[y_index + 1]) / _ONE,
                                "exchange_loss": x_value,
                                "lower_policy": current,
                                "upper_policy": policy_matrix[y_index + 1][x_index],
                            }
                        )

        surfaces.append(
            {
                "case_id": case.case_id,
                "pf_grid": pf_grid,
                "exchange_loss_grid": loss_grid,
                "decision_matrix": policy_matrix,
                "profit_matrix": profit_matrix,
                "decision_flip_points": flip_points,
                "records": rows,
            }
        )

    return {
        "x_parameter": "exchange_loss",
        "y_parameter": "pf",
        "surfaces": surfaces,
    }


def _part_boundary_validation() -> dict[str, Any]:
    records: list[dict[str, Any]] = []
    for inspect in (_ZERO, _ONE):
        for rate in (_ZERO, _ONE):
            events = _part_event(inspect, rate, _ZERO, _ZERO)
            probability_sum = sum(probability for _, probability, _, _ in events)
            good_probability = sum(
                probability for quality, probability, _, _ in events if quality == "good"
            )
            passed = _close(probability_sum, _ONE) and _close(
                good_probability, _ONE - rate
            )
            records.append(
                {
                    "inspect": inspect,
                    "defect_rate": rate,
                    "probability_sum": probability_sum,
                    "good_probability": good_probability,
                    "passed": passed,
                }
            )
    return {
        "records": records,
        "passed": all(record["passed"] for record in records),
    }


def _monotonic_validation(
    case_results: list[dict[str, Any]], factors: list[float]
) -> dict[str, Any]:
    fields = (
        "a1",
        "a2",
        "t1",
        "t2",
        "kf",
        "tf",
        "exchange_loss",
        "disassembly_cost",
    )
    largest_factor = max(factors)
    records: list[dict[str, Any]] = []
    for result in case_results:
        case = _parse_case(result["inputs"], 0)
        policy = Policy.from_vector(result["policy_vector"])
        baseline_profit = policy_profit_analytic(case, policy)
        for field in fields:
            nominal = getattr(case, field)
            increased_value = max(_ZERO, nominal * (_ONE + largest_factor))
            perturbed = replace(case, **{field: increased_value})
            perturbed_profit = policy_profit_analytic(perturbed, policy)
            passed = (
                baseline_profit is not None
                and perturbed_profit is not None
                and perturbed_profit <= baseline_profit + _cashflow_tolerance()
            )
            records.append(
                {
                    "case_id": case.case_id,
                    "parameter": field,
                    "fixed_policy_vector": policy.vector,
                    "baseline_profit": baseline_profit,
                    "increased_cost": increased_value,
                    "fixed_policy_profit": perturbed_profit,
                    "passed": passed,
                }
            )
    return {
        "direction": "fixed_policy_profit_non_increasing",
        "records": records,
        "passed": all(record["passed"] for record in records),
    }


def _cost_usage_validation() -> dict[str, Any]:
    source = getsource(_event_reward)
    fields = (
        "a1",
        "a2",
        "t1",
        "t2",
        "kf",
        "tf",
        "sale_price",
        "exchange_loss",
        "disassembly_cost",
        "scrap_recovery_value",
    )
    usage = {field: field in source for field in fields}
    return {"usage": usage, "passed": all(usage.values())}


def _validate_results(
    cases: tuple[Case, ...], case_results: list[dict[str, Any]], factors: list[float]
) -> dict[str, Any]:
    all_rows = [row for result in case_results for row in result["all_policies"]]
    absorbing_rows = [row for row in all_rows if row["absorbing"]]
    bellman_residuals = [
        float(row["bellman_residual"])
        for row in absorbing_rows
        if row["bellman_residual"] is not None
    ]
    cashflow_differences = [
        float(row["cashflow_abs_difference"])
        for row in absorbing_rows
        if row["cashflow_abs_difference"] is not None
    ]
    event_differences = [
        float(row["max_event_count_difference"])
        for row in absorbing_rows
        if row["max_event_count_difference"] is not None
    ]

    expected_strategy_count = _parameter_optional(
        "Q2_POLICY_SPACE_SIZE", "Q2_STRATEGY_COUNT", "Q2策略空间规模"
    )
    expected_case_count = _parameter_optional("Q2_CASE_COUNT")
    state_upper_bound = _parameter_optional(
        "Q2_STATE_LIMIT", "Q2_INVENTORY_STATE_LIMIT", "Q2库存状态上限"
    )
    strategy_count_ok = expected_strategy_count is None or len(enumerate_policies()) == int(
        expected_strategy_count
    )
    case_count_ok = expected_case_count is None or len(cases) == int(expected_case_count)
    state_bound_ok = state_upper_bound is None or len(_STATES) <= int(state_upper_bound)
    eligible_rows_ok = all(
        (row["absorbing"] and row["profit"] is not None)
        or (not row["absorbing"] and row["profit"] is None)
        for row in all_rows
    )
    absorbing_equations_ok = all(bool(row["passed"]) for row in absorbing_rows)
    finite_profit_ok = all(
        numpy.isfinite(float(row["profit"]))
        for row in absorbing_rows
    )
    part_boundary = _part_boundary_validation()
    monotonic = _monotonic_validation(case_results, factors)
    cost_usage = _cost_usage_validation()

    checks = {
        "strategy_count": strategy_count_ok,
        "case_count": case_count_ok,
        "state_bound": state_bound_ok,
        "eligible_row_partition": eligible_rows_ok,
        "absorbing_bellman_and_ledger": absorbing_equations_ok,
        "finite_profits": finite_profit_ok,
        "part_probability_boundaries": part_boundary["passed"],
        "cost_monotonicity": monotonic["passed"],
        "all_cost_items_used": cost_usage["passed"],
    }
    return {
        "checks": checks,
        "overall_passed": all(checks.values()),
        "case_count": len(cases),
        "enumerated_strategy_count": len(enumerate_policies()),
        "state_universe_count": len(_STATES),
        "absorbing_strategy_evaluation_count": len(absorbing_rows),
        "excluded_nonabsorbing_strategy_count": len(all_rows) - len(absorbing_rows),
        "max_bellman_residual": max(bellman_residuals, default=_ZERO),
        "max_cashflow_abs_difference": max(cashflow_differences, default=_ZERO),
        "max_event_count_difference": max(event_differences, default=_ZERO),
        "part_boundary_validation": part_boundary,
        "monotonic_validation": monotonic,
        "cost_usage_validation": cost_usage,
    }


def _strategy_cost_matrix(case_results: list[dict[str, Any]]) -> dict[str, Any]:
    policies = enumerate_policies()
    return {
        "case_ids": [result["case_id"] for result in case_results],
        "policy_vectors": [policy.vector for policy in policies],
        "profit": [
            [result["all_policies"][index]["profit"] for index in range(len(policies))]
            for result in case_results
        ],
        "expected_cost": [
            [result["all_policies"][index]["expected_cost"] for index in range(len(policies))]
            for result in case_results
        ],
        "absorbing": [
            [result["all_policies"][index]["absorbing"] for index in range(len(policies))]
            for result in case_results
        ],
    }


def run(output_path: str | Path | None = "problem2_outputs.json") -> dict[str, Any]:
    cases = load_cases()
    case_results = [solve_case(case) for case in cases]
    factors = _dense_relative_factors()
    sensitivity = {
        "factor_grid": factors,
        "defect_rate": _defect_sensitivity(cases, factors),
        "unit_cost": _cost_sensitivity(cases, factors),
        "breakeven_surface": _breakeven_surface(cases, factors),
    }
    validation = _validate_results(cases, case_results, factors)
    payload = {
        "problem2": {
            "method": "absorbing_markov_reward",
            "ledger_method": "event_cash_ledger",
            "tie_break": "利润在登记容差内并列时取字典序最小策略向量",
            "case_count": len(cases),
            "cases": case_results,
            "six_case_summary": [
                {
                    "case_id": result["case_id"],
                    "policy_vector": result["policy_vector"],
                    "profit": result["profit"],
                    "expected_cost": result["expected_cost"],
                    "decision_basis": result["decision_basis"],
                }
                for result in case_results
            ],
            "strategy_cost_matrix": _strategy_cost_matrix(case_results),
            "optimal_cost_breakdown": [
                {
                    "case_id": result["case_id"],
                    "policy_vector": result["policy_vector"],
                    **result["optimal_cost_breakdown"],
                }
                for result in case_results
            ],
            "sensitivity": sensitivity,
            "validation": validation,
        }
    }

    if output_path is not None:
        path = Path(output_path)
        path.write_text(
            json.dumps(
                payload,
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
                allow_nan=False,
            ),
            encoding="utf-8",
        )
    if not validation["overall_passed"]:
        raise ArithmeticError("问题二存在未通过的阻断式核验")
    return payload


def write_output(payload: Mapping[str, Any], path: str | Path) -> None:
    Path(path).write_text(
        json.dumps(
            payload,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
            allow_nan=False,
        ),
        encoding="utf-8",
    )


if __name__ == "__main__":
    run()