import itertools
import math
from collections.abc import Mapping
from copy import deepcopy
from dataclasses import asdict, is_dataclass

import numpy as np
import numpy.linalg
import params
from params import *


_MISSING = object()
_PART_STATES = ("empty", "good", "bad")
_POLICY_TAIL_NAMES = ("final_inspect", "disassemble")
_TERMINAL_LABEL = "qualified_delivery_absorbing"

_COST_FIELDS = (
    "price1",
    "test1",
    "price2",
    "test2",
    "assembly_cost",
    "product_test_cost",
    "sale_price",
    "exchange_loss",
    "disassembly_cost",
)
_RATE_FIELDS = ("p1", "p2", "pf")
_PARAMETER_FIELDS = _RATE_FIELDS + _COST_FIELDS
_COST_CATEGORIES = (
    "part_purchase_cost",
    "part_inspection_cost",
    "assembly_cost",
    "product_inspection_cost",
    "disassembly_cost",
    "exchange_loss",
)
_COUNT_CATEGORIES = (
    "part_purchase_count",
    "part_inspection_count",
    "assembly_count",
    "product_inspection_count",
    "internal_rejection_count",
    "market_count",
    "return_count",
    "disassembly_count",
    "replacement_assembly_count",
    "terminal_delivery_count",
)

_PART_SPECS = (
    {
        "name": "part1",
        "rate": ("p1", "part1_defect_rate", "part1_rate", "part1_p", "part1_probability", "零配件1次品率"),
        "price": ("price1", "part1_price", "part1_purchase_price", "purchase_price1", "a1", "a_1", "零配件1购买单价"),
        "test": ("test1", "part1_test", "part1_test_cost", "part1_inspection_cost", "t1", "t_1", "零配件1检测成本"),
        "containers": ("part1", "part_1", "component1", "零配件1"),
        "inner_rate": ("defect_rate", "rate", "p", "probability", "次品率"),
        "inner_price": ("purchase_price", "price", "cost", "购买单价"),
        "inner_test": ("inspection_cost", "test_cost", "test", "检测成本"),
    },
    {
        "name": "part2",
        "rate": ("p2", "part2_defect_rate", "part2_rate", "part2_p", "part2_probability", "零配件2次品率"),
        "price": ("price2", "part2_price", "part2_purchase_price", "purchase_price2", "a2", "a_2", "零配件2购买单价"),
        "test": ("test2", "part2_test", "part2_test_cost", "part2_inspection_cost", "t2", "t_2", "零配件2检测成本"),
        "containers": ("part2", "part_2", "component2", "零配件2"),
        "inner_rate": ("defect_rate", "rate", "p", "probability", "次品率"),
        "inner_price": ("purchase_price", "price", "cost", "购买单价"),
        "inner_test": ("inspection_cost", "test_cost", "test", "检测成本"),
    },
)


def _normalise_name(value):
    return "".join(character for character in str(value).lower() if character.isalnum())


def _parameter_containers():
    containers = [vars(params)]
    for container_name in (
        "MODEL_CONSTANTS",
        "MODEL_CONSTANT_VALUES",
        "CONSTANTS",
        "PARAMETERS",
    ):
        container = getattr(params, container_name, None)
        if isinstance(container, Mapping):
            containers.append(container)
    return containers


def _semantic_parameter(groups):
    candidates = []
    for container in _parameter_containers():
        for name, value in container.items():
            if str(name).startswith("__"):
                continue
            normalised = _normalise_name(name)
            if all(any(_normalise_name(token) in normalised for token in group) for group in groups):
                candidates.append((len(normalised), str(name), value))
    if not candidates:
        return None
    candidates.sort(key=lambda item: (item[0], item[1]))
    return candidates[0][2]


def _parameter(*names):
    containers = _parameter_containers()
    for requested in names:
        for container in containers:
            if requested in container:
                return container[requested]
    raise AttributeError("params 中缺少登记常量：" + ", ".join(names))


def _model_settings():
    cashflow_tolerance = _parameter(
        "Q2_CASHFLOW_ABS_TOL",
        "CASHFLOW_ABS_TOL",
        "CASHFLOW_ABSOLUTE_TOLERANCE",
        "cashflow_abs_tol",
    )
    value_tolerance = _parameter(
        "Q2_VALUE_ITERATION_TOL",
        "VALUE_ITERATION_TOL",
        "VALUE_ITERATION_TOLERANCE",
        "value_iteration_tol",
    )
    maximum_steps = _parameter(
        "Q2_VALUE_ITERATION_MAX_STEPS",
        "Q2_VALUE_ITERATION_MAX",
        "VALUE_ITERATION_MAX_STEPS",
        "VALUE_ITERATION_MAX_ITERATIONS",
        "value_iteration_max_iterations",
    )
    if value_tolerance is None:
        value_tolerance = _semantic_parameter((("value_iteration", "iteration"), ("tol", "tolerance")))
    if maximum_steps is None:
        maximum_steps = _semantic_parameter((("value_iteration", "iteration"), ("max",)))
    if value_tolerance is None or maximum_steps is None:
        raise AttributeError("params 中缺少问题二价值迭代登记常数")
    numeric_tolerance = _parameter(
        "Q2_NUMERIC_TOL",
        "Q1_NUMERIC_TOL",
        "Q1_EXACT_ENUMERATION_TOL",
        "NUMERIC_TOL",
        "numeric_tol",
    )
    if numeric_tolerance is None:
        numeric_tolerance = _semantic_parameter((("numeric",), ("tol", "tolerance")))
    if numeric_tolerance is None:
        numeric_tolerance = cashflow_tolerance
    return {
        "cashflow_abs_tol": float(cashflow_tolerance),
        "value_iteration_tol": float(value_tolerance),
        "value_iteration_max_steps": int(maximum_steps),
        "numeric_tol": float(numeric_tolerance),
    }


def _sensitivity_factors():
    factors = _parameter(
        "Q2_SENSITIVITY_FACTORS",
        "RELATIVE_SENSITIVITY_GRID",
        "SENSITIVITY_GRID",
        "relative_sensitivity_grid",
    )
    if factors is None:
        factors = _semantic_parameter((("sensitivity", "relative"), ("grid", "factor", "value")))
    if factors is None:
        raise AttributeError("params 中缺少相对灵敏度扫描网格")
    result = tuple(float(value) for value in factors)
    if not result:
        raise ValueError("相对灵敏度扫描网格不能为空")
    return result


def _as_mapping(raw):
    if isinstance(raw, Mapping):
        return raw
    if is_dataclass(raw):
        return asdict(raw)
    if hasattr(raw, "__dict__"):
        return vars(raw)
    return {}


def _read_raw(source, name):
    if isinstance(source, Mapping):
        return source.get(name, _MISSING)
    return getattr(source, name, _MISSING)


def _numeric(value):
    if isinstance(value, str):
        text = value.strip()
        if text.endswith("%"):
            divisor = _parameter(
                "PERCENT_BASE",
                "PERCENTAGE_BASE",
                "PERCENT_TO_RATIO",
                "Q2_PERCENT_BASE",
            )
            return float(text[:-1]) / float(divisor)
        converted = float(text)
    else:
        converted = float(value)
    if not math.isfinite(converted):
        raise ValueError("参数必须为有限实数")
    return converted


def _numeric_field(raw, aliases, containers, inner_aliases):
    mapping = _as_mapping(raw)
    for alias in aliases:
        value = _read_raw(mapping, alias)
        if value is not _MISSING:
            return _numeric(value)
    for container_name in containers:
        child = _read_raw(mapping, container_name)
        if child is _MISSING:
            continue
        child_mapping = _as_mapping(child)
        for alias in inner_aliases:
            value = _read_raw(child_mapping, alias)
            if value is not _MISSING:
                return _numeric(value)
    raise KeyError("案例参数缺失；已尝试字段：" + ", ".join(aliases))


def _case_identifier(raw, index):
    mapping = _as_mapping(raw)
    for alias in ("case_id", "caseid", "id", "case_number", "name", "case"):
        value = _read_raw(mapping, alias)
        if value is not _MISSING and value is not None:
            return str(value)
    return "case_{}".format(index + 1)


def _is_normalised_case(case):
    return isinstance(case, Mapping) and all(field in case for field in _PARAMETER_FIELDS)


def normalize_case(raw, index=0):
    if _is_normalised_case(raw):
        return dict(raw)
    mapping = _as_mapping(raw)
    normalised = {"case_id": _case_identifier(raw, index)}
    for spec in _PART_SPECS:
        rate = _numeric_field(raw, spec["rate"], spec["containers"], spec["inner_rate"])
        price = _numeric_field(raw, spec["price"], spec["containers"], spec["inner_price"])
        test = _numeric_field(raw, spec["test"], spec["containers"], spec["inner_test"])
        normalised[spec["name"] + "_defect_rate"] = rate
        normalised["p" + spec["name"][-1]] = rate
        normalised[spec["name"] + "_purchase_price"] = price
        normalised["price" + spec["name"][-1]] = price
        normalised[spec["name"] + "_inspection_cost"] = test
        normalised["test" + spec["name"][-1]] = test
        normalised[spec["name"]] = {
            "defect_rate": rate,
            "purchase_price": price,
            "inspection_cost": test,
        }
    normalised["pf"] = _numeric_field(
        raw,
        ("pf", "product_defect_rate", "assembly_defect_rate", "final_defect_rate", "成品次品率"),
        ("product", "final_product", "finished_product", "assembly", "成品"),
        ("defect_rate", "rate", "p", "probability", "次品率"),
    )
    normalised["assembly_cost"] = _numeric_field(
        raw,
        ("assembly_cost", "product_assembly_cost", "final_assembly_cost", "kf", "k_f", "成品装配成本"),
        ("product", "final_product", "finished_product", "assembly", "成品"),
        ("assembly_cost", "cost", "装配成本"),
    )
    normalised["product_test_cost"] = _numeric_field(
        raw,
        (
            "product_test_cost",
            "final_test_cost",
            "product_inspection_cost",
            "tf",
            "t_f",
            "成品检测成本",
        ),
        ("product", "final_product", "finished_product", "assembly", "成品"),
        ("test_cost", "inspection_cost", "test", "检测成本"),
    )
    normalised["sale_price"] = _numeric_field(
        raw,
        ("sale_price", "market_price", "market_sale_price", "revenue", "r_market", "市场售价"),
        ("product", "final_product", "market", "成品"),
        ("sale_price", "market_price", "price", "市场售价"),
    )
    normalised["exchange_loss"] = _numeric_field(
        raw,
        ("exchange_loss", "replacement_loss", "return_loss", "L_exchange", "调换损失"),
        ("exchange", "return", "调换"),
        ("loss", "exchange_loss", "调换损失"),
    )
    normalised["disassembly_cost"] = _numeric_field(
        raw,
        ("disassembly_cost", "dismantle_cost", "disassembly_fee", "g_dis", "拆解费用"),
        ("disassembly", "dismantle", "拆解"),
        ("cost", "fee", "disassembly_cost", "拆解费用"),
    )
    normalised["a1"] = normalised["price1"]
    normalised["t1"] = normalised["test1"]
    normalised["a2"] = normalised["price2"]
    normalised["t2"] = normalised["test2"]
    normalised["k_f"] = normalised["assembly_cost"]
    normalised["t_f"] = normalised["product_test_cost"]
    normalised["r_market"] = normalised["sale_price"]
    normalised["L_exchange"] = normalised["exchange_loss"]
    normalised["g_dis"] = normalised["disassembly_cost"]
    return normalised


def _normalize_q2_case(raw, index=0):
    return normalize_case(raw, index=index)


def load_cases(required_count=None):
    raw_cases = _parameter("Q2_CASES")
    if isinstance(raw_cases, Mapping):
        materialised = []
        for case_id, raw_case in raw_cases.items():
            if _as_mapping(raw_case):
                copied = dict(_as_mapping(raw_case))
                copied.setdefault("case_id", case_id)
                materialised.append(copied)
            else:
                materialised.append(raw_case)
    else:
        materialised = list(raw_cases)
    cases = [normalize_case(raw, index=index) for index, raw in enumerate(materialised)]
    if required_count is not None and len(cases) != int(required_count):
        raise ValueError("问题二案例数与登记数量不一致")
    return cases


def _validate_case(case):
    for field in _RATE_FIELDS:
        value = case[field]
        if value < 0 or value > 1:
            raise ValueError(field + " 必须位于概率区间")
    for field in _COST_FIELDS:
        if case[field] < 0:
            raise ValueError(field + " 必须为非负金额")


def _policy_space(part_count):
    policy_size = part_count + len(_POLICY_TAIL_NAMES)
    binary_values = getattr(params, "Q2_POLICY_SPACE", None)
    if binary_values is None:
        binary_values = (False, True)
    elif isinstance(binary_values, int):
        expected_count = 2 ** policy_size
        if int(binary_values) != expected_count:
            raise ValueError("Q2_POLICY_SPACE 与二值决策规模不一致")
        binary_values = (False, True)
    policies = [tuple(bool(value) for value in policy) for policy in itertools.product(binary_values, repeat=policy_size)]
    policies.sort()
    declared_size = getattr(params, "Q2_POLICY_SPACE_SIZE", None)
    if declared_size is not None and len(policies) != int(declared_size):
        raise ValueError("实际枚举策略数与 Q2 策略空间规模不一致")
    return policies


def _normalise_policy(policy, part_count):
    flags = tuple(bool(value) for value in policy)
    expected_size = part_count + len(_POLICY_TAIL_NAMES)
    if len(flags) != expected_size:
        raise ValueError("策略向量长度与问题二状态维数不一致")
    for raw_value, flag in zip(policy, flags):
        if int(raw_value) != int(flag):
            raise ValueError("策略变量只能取两个二值状态")
    return flags


def _policy_record(policy, part_count):
    flags = _normalise_policy(policy, part_count)
    record = {
        "tuple": list(flags),
        "id": "".join(format(int(flag), "01b") for flag in flags),
    }
    for index, flag in enumerate(flags[:part_count]):
        record["z{}".format(index + 1)] = flag
        record["part{}_inspect".format(index + 1)] = flag
    record["C"] = flags[part_count]
    record["final_inspect"] = flags[part_count]
    record["D"] = flags[part_count + 1]
    record["disassemble"] = flags[part_count + 1]
    return record


def _zero_cash():
    return {category: 0.0 for category in _CASH_CATEGORIES}


def _zero_cash_with_revenue():
    cash = _zero_cash()
    cash["market_revenue"] = 0.0
    return cash


def _zero_counts():
    return {category: 0.0 for category in _COUNT_CATEGORIES}


def market_revenue_once(sale_price):
    return {"market_revenue": sale_price}


def replacement_assembly_once(assembly_cost):
    return {"assembly_cost": -assembly_cost}


def _add_event(events, target, probability, cash, counts):
    if probability <= 0:
        return
    event = {
        "target": target,
        "probability": float(probability),
        "cash": dict(cash),
        "counts": dict(counts),
    }
    events.append(event)


def _build_transitions(case, policy, state):
    part_count = len(_PART_SPECS)
    flags = _normalise_policy(policy, part_count)
    transitions = []
    for index, status in enumerate(state):
        if status != "empty":
            continue
        rate = case[_RATE_FIELDS[index]]
        price = case["price{}".format(index + 1)]
        inspection_cost = case["test{}".format(index + 1)]
        good_state = list(state)
        good_state[index] = "good"
        bad_state = list(state)
        bad_state[index] = "bad"
        if flags[index]:
            purchase_count = 1 / (1 - rate)
            cash = _zero_cash_with_revenue()
            cash["part_purchase_cost"] = -purchase_count * price
            cash["part_inspection_cost"] = -purchase_count * inspection_cost
            counts = _zero_counts()
            counts["part_purchase_count"] = purchase_count
            counts["part_inspection_count"] = purchase_count
            _add_event(transitions, tuple(good_state), 1, cash, counts)
        else:
            base_cash = _zero_cash_with_revenue()
            base_cash["part_purchase_cost"] = -price
            base_counts = _zero_counts()
            base_counts["part_purchase_count"] = 1
            good_probability = 1 - rate
            _add_event(transitions, tuple(good_state), good_probability, base_cash, base_counts)
            _add_event(transitions, tuple(bad_state), rate, base_cash, base_counts)
        break
    else:
        all_good = all(status == "good" for status in state)
        good_probability = 1 - case["pf"] if all_good else 0
        bad_probability = 1 - good_probability
        final_inspect = flags[part_count]
        disassemble = flags[part_count + 1]
        failure_target = state if disassemble else tuple("empty" for _ in state)
        assembly_cash = _zero_cash_with_revenue()
        assembly_cash.update(replacement_assembly_once(case["assembly_cost"]))
        assembly_counts = _zero_counts()
        assembly_counts["assembly_count"] = 1
        if final_inspect:
            inspected_cash = dict(assembly_cash)
            inspected_cash["product_inspection_cost"] = -case["product_test_cost"]
            inspected_counts = dict(assembly_counts)
            inspected_counts["product_inspection_count"] = 1
            good_cash = dict(inspected_cash)
            good_cash.update(market_revenue_once(case["sale_price"]))
            good_counts = dict(inspected_counts)
            good_counts["market_count"] = 1
            good_counts["terminal_delivery_count"] = 1
            _add_event(transitions, None, good_probability, good_cash, good_counts)
            bad_cash = dict(inspected_cash)
            bad_counts = dict(inspected_counts)
            bad_counts["internal_rejection_count"] = 1
            bad_counts["replacement_assembly_count"] = 1
            if disassemble:
                bad_cash["disassembly_cost"] = -case["disassembly_cost"]
                bad_counts["disassembly_count"] = 1
            _add_event(transitions, failure_target, bad_probability, bad_cash, bad_counts)
        else:
            sold_cash = dict(assembly_cash)
            sold_cash.update(market_revenue_once(case["sale_price"]))
            sold_counts = dict(assembly_counts)
            sold_counts["market_count"] = 1
            good_cash = dict(sold_cash)
            good_counts = dict(sold_counts)
            good_counts["terminal_delivery_count"] = 1
            _add_event(transitions, None, good_probability, good_cash, good_counts)
            bad_cash = dict(sold_cash)
            bad_cash["exchange_loss"] = -case["exchange_loss"]
            bad_counts = dict(sold_counts)
            bad_counts["return_count"] = 1
            bad_counts["replacement_assembly_count"] = 1
            if disassemble:
                bad_cash["disassembly_cost"] = -case["disassembly_cost"]
                bad_counts["disassembly_count"] = 1
            _add_event(transitions, failure_target, bad_probability, bad_cash, bad_counts)
    return transitions


def _state_label(state):
    return "|".join(state)


def _reachable_transient_states(all_states, all_transitions, start):
    reachable = []
    seen = set()
    pending = [start]
    while pending:
        state = pending.pop(0)
        if state in seen:
            continue
        seen.add(state)
        reachable.append(state)
        for event in all_transitions.get(state, []):
            target = event["target"]
            if target is not None and target not in seen:
                pending.append(target)
    return reachable


def _value_iteration(transient_matrix, rewards, settings):
    values = np.zeros(len(rewards), dtype=float)
    converged = False
    completed_iterations = 0
    for iteration in range(settings["value_iteration_max_steps"]):
        updated = rewards + transient_matrix @ values
        change = float(np.max(np.abs(updated - values)))
        values = updated
        completed_iterations = iteration + 1
        if change <= settings["value_iteration_tol"]:
            converged = True
            break
    if not converged:
        raise RuntimeError("问题二价值迭代未在登记轮数内收敛")
    return values, completed_iterations


def event_cash_ledger(visits, immediate_cash):
    cash_totals = {}
    for category in immediate_cash[0]:
        cash_totals[category] = float(np.dot(visits, np.asarray([row[category] for row in immediate_cash], dtype=float)))
    expected_counts = {}
    for category in _COUNT_CATEGORIES:
        expected_counts[category] = cash_totals[category]
    cost_breakdown = {category: cash_totals[category] for category in _COST_CATEGORIES}
    total_cost = float(sum(cost_breakdown.values()))
    market_revenue = cash_totals["market_revenue"]
    net_cash = market_revenue - total_cost
    return {
        "expected_counts": expected_counts,
        "market_revenue": market_revenue,
        "cost_breakdown": cost_breakdown,
        "total_cost": total_cost,
        "net_cash": net_cash,
    }


def _invalid_policy_result(policy, case, all_states, reason, settings, spectral_radius=None):
    part_count = len(_PART_SPECS)
    return {
        "policy": _policy_record(policy, part_count),
        "policy_tuple": list(_normalise_policy(policy, part_count)),
        "feasible": False,
        "profit": None,
        "expected_cost": None,
        "inventory_state_space_size": len(all_states),
        "reachable_state_count": None,
        "terminal_state_count": 1,
        "spectral_radius": None if spectral_radius is None else float(spectral_radius),
        "absorption_probability": None,
        "nonabsorption_reason": reason,
        "event_ledger": None,
        "cost_breakdown": None,
        "state_values": {},
        "checks": {"finite_completion": False},
        "all_checks_passed": False,
        "model_constants": settings,
        "case_parameters": {field: case[field] for field in _PARAMETER_FIELDS},
    }


def evaluate_policy(case_like, policy, full_validation=True):
    case = case_like if _is_normalised_case(case_like) else normalize_case(case_like)
    _validate_case(case)
    part_count = len(_PART_SPECS)
    flags = _normalise_policy(policy, part_count)
    settings = _model_settings()
    impossible_inspections = []
    for index, inspect in enumerate(flags[:part_count]):
        if inspect and case[_RATE_FIELDS[index]] >= 1:
            impossible_inspections.append("part{}".format(index + 1))
    all_states = list(itertools.product(_PART_STATES, repeat=part_count))
    if impossible_inspections:
        return _invalid_policy_result(
            flags,
            case,
            all_states,
            "检测后无法取得合格件：" + ",".join(impossible_inspections),
            settings,
        )
    all_transitions = {
        state: _build_transitions(case, flags, state)
        for state in all_states
    }
    start = tuple("empty" for _ in state_names(all_states))
    reachable_states = _reachable_transient_states(all_states, all_transitions, start)
    state_index = {state: index for index, state in enumerate(reachable_states)}
    state_count = len(reachable_states)
    transient_matrix = np.zeros((state_count, state_count), dtype=float)
    terminal_mass = np.zeros(state_count, dtype=float)
    event_mass = np.zeros(state_count, dtype=float)
    immediate_cash = []
    immediate_counts = []
    for state in reachable_states:
        row = state_index[state]
        cash_row = _zero_cash_with_revenue()
        count_row = _zero_counts()
        for event in all_transitions[state]:
            probability = event["probability"]
            event_mass[row] += probability
            target = event["target"]
            if target is None:
                terminal_mass[row] += probability
            else:
                transient_matrix[row, state_index[target]] += probability
            for category, amount in event["cash"].items():
                cash_row[category] += probability * amount
            for category, amount in event["counts"].items():
                count_row[category] += probability * amount
        immediate_cash.append(cash_row)
        immediate_counts.append(count_row)
    probability_balance_error = float(np.max(np.abs(event_mass - 1)))
    spectral_radius = float(np.max(np.abs(np.linalg.eigvals(transient_matrix))))
    if spectral_radius >= 1 - settings["numeric_tol"]:
        return _invalid_policy_result(
            flags,
            case,
            all_states,
            "可达瞬态子图含闭合类，单位最终合格交付期望不有限",
            settings,
            spectral_radius=spectral_radius,
        )
    identity = np.eye(state_count, dtype=float)
    system = identity - transient_matrix
    rewards = np.asarray(
        [
            row["market_revenue"] - sum(row[category] for category in _COST_CATEGORIES)
            for row in immediate_cash
        ],
        dtype=float,
    )
    try:
        state_values = numpy.linalg.solve(system, rewards)
    except numpy.linalg.LinAlgError as exc:
        raise RuntimeError("问题二吸收型奖励方程不可解") from exc
    start_basis = np.zeros(state_count, dtype=float)
    start_basis[state_index[start]] = 1
    expected_visits = numpy.linalg.solve(system, start_basis)
    visits = np.asarray(
        [
            np.dot(expected_visits, np.asarray([row[category] for row in immediate_counts], dtype=float))
            for category in _COUNT_CATEGORIES
        ],
        dtype=float,
    )
    ledger = event_cash_ledger(visits, immediate_cash)
    expected_counts = ledger["expected_counts"]
    absorption_probability = float(np.sum(expected_visits))
    bellman_residual = float(
        np.max(np.abs(state_values - rewards - transient_matrix @ state_values))
    )
    event_cash_residual = float(state_values[state_index[start]] - ledger["net_cash"])
    replacement_identity = float(
        expected_counts["assembly_count"]
        - expected_counts["terminal_delivery_count"]
        - expected_counts["replacement_assembly_count"]
    )
    market_identity = float(
        expected_counts["market_count"]
        - expected_counts["terminal_delivery_count"]
        - expected_counts["return_count"]
    )
    inspection_identity = float(
        expected_counts["assembly_count"]
        - expected_counts["market_count"]
        - expected_counts["internal_rejection_count"]
    )
    terminal_delivery_error = abs(expected_counts["terminal_delivery_count"] - 1)
    checks = {
        "probability_balance": probability_balance_error <= settings["numeric_tol"],
        "transient_spectral_radius": spectral_radius < 1 - settings["numeric_tol"],
        "bellman_residual": bellman_residual <= settings["value_iteration_tol"],
        "event_cash_residual": event_cash_residual <= settings["cashflow_abs_tol"],
        "absorption_probability": abs(absorption_probability - 1) <= settings["value_iteration_tol"],
        "terminal_delivery_count": terminal_delivery_error <= settings["value_iteration_tol"],
        "replacement_assembly_identity": abs(replacement_identity) <= settings["cashflow_abs_tol"],
        "market_delivery_identity": abs(market_identity) <= settings["cashflow_abs_tol"],
        "inspection_market_identity": abs(inspection_identity) <= settings["cashflow_abs_tol"],
    }
    iteration_values = None
    iteration_count = None
    iteration_gap = None
    if full_validation:
        iteration_values, iteration_count = _value_iteration(transient_matrix, rewards, settings)
        iteration_gap = abs(float(iteration_values[state_index[start]]) - float(state_values[state_index[start]]))
        checks["value_iteration_reference"] = iteration_gap <= settings["value_iteration_tol"]
    if not all(checks.values()):
        failed = [name for name, passed in checks.items() if not passed]
        raise RuntimeError("问题二策略核验失败：" + ",".join(failed))
    return {
        "policy": _policy_record(flags, part_count),
        "policy_tuple": list(flags),
        "feasible": True,
        "profit": float(state_values[state_index[start]]),
        "expected_cost": ledger["total_cost"],
        "inventory_state_space_size": len(all_states),
        "reachable_state_count": state_count,
        "terminal_state_count": 1,
        "reachable_state_labels": [_state_label(state) for state in reachable_states],
        "terminal_state_label": _TERMINAL_LABEL,
        "spectral_radius": spectral_radius,
        "absorption_probability": absorption_probability,
        "root_output_rate": expected_counts["terminal_delivery_count"],
        "event_ledger": ledger,
        "cost_breakdown": ledger["cost_breakdown"],
        "state_values": {
            _state_label(state): float(state_values[state_index[state]])
            for state in reachable_states
        },
        "bellman_residual": bellman_residual,
        "event_cash_residual": event_cash_residual,
        "value_iteration_profit": None if iteration_values is None else float(iteration_values[state_index[start]]),
        "value_iteration_iterations": iteration_count,
        "value_iteration_gap": iteration_gap,
        "identity_gaps": {
            "replacement_assembly": replacement_identity,
            "market_delivery": market_identity,
            "inspection_market": inspection_identity,
        },
        "probability_balance_error": probability_balance_error,
        "checks": checks,
        "all_checks_passed": True,
        "full_validation": bool(full_validation),
        "model_constants": settings,
        "case_parameters": {field: case[field] for field in _PARAMETER_FIELDS},
    }


def state_names(states):
    if not states:
        return ()
    return states[0]


def absorbing_markov_reward(case_like, policy, full_validation=True):
    return evaluate_policy(case_like, policy, full_validation=full_validation)


def solve_case(case_like, index=0, full_validation=True):
    case = case_like if _is_normalised_case(case_like) else normalize_case(case_like, index=index)
    part_count = len(_PART_SPECS)
    policies = _policy_space(part_count)
    policy_rows = [
        absorbing_markov_reward(case, policy, full_validation=full_validation)
        for policy in policies
    ]
    feasible_rows = [row for row in policy_rows if row["feasible"]]
    if not feasible_rows:
        raise RuntimeError("问题二案例没有任何具有有限完成期望的策略")
    settings = _model_settings()
    best = feasible_rows[0]
    for row in feasible_rows[1:]:
        if row["profit"] > best["profit"] + settings["numeric_tol"]:
            best = row
    finite_bellman = [
        row["bellman_residual"]
        for row in feasible_rows
        if row.get("bellman_residual") is not None
    ]
    finite_cash = [
        row["event_cash_residual"]
        for row in feasible_rows
        if row.get("event_cash_residual") is not None
    ]
    validation = {
        "enumerated_policy_count": len(policy_rows),
        "finite_policy_count": len(feasible_rows),
        "nonabsorbing_policy_count": len(policy_rows) - len(feasible_rows),
        "maximum_bellman_residual": max(finite_bellman) if finite_bellman else None,
        "maximum_event_cash_residual": max(finite_cash) if finite_cash else None,
        "all_finite_policy_checks_passed": all(row["all_checks_passed"] for row in feasible_rows),
        "terminal_state_explicit": True,
    }
    return {
        "case_index": index,
        "case_id": case["case_id"],
        "parameters": {field: case[field] for field in _PARAMETER_FIELDS},
        "policy": best["policy"],
        "profit": best["profit"],
        "optimal_policy": best["policy"],
        "optimal_profit": best["profit"],
        "profit_unit": "元/合格交付",
        "decision_basis": "完整吸收型事件马尔可夫奖励方程的精确解在全策略空间中最大；并列按策略元组字典序选择",
        "event_ledger": best["event_ledger"],
        "cost_breakdown": best["cost_breakdown"],
        "state_count": best["reachable_state_count"],
        "absorption_probability": best["absorption_probability"],
        "bellman_residual": best["bellman_residual"],
        "event_cash_residual": best["event_cash_residual"],
        "policy_table": policy_rows,
        "validation": validation,
    }


def _perturbed_case(case, field, factor):
    changed = deepcopy(case)
    if field in _RATE_FIELDS:
        changed[field] = max(0, min(1, changed[field] * (1 + factor)))
    else:
        if factor < -1:
            raise ValueError("成本相对扰动不能低于完全清除以下界")
        changed[field] = changed[field] * (1 + factor)
    return changed


def _compact_optimum(case):
    result = solve_case(case, full_validation=False)
    return {
        "case_id": result["case_id"],
        "policy_id": result["policy"]["id"],
        "policy_tuple": result["policy"]["tuple"],
        "profit": result["profit"],
        "profit_unit": result["profit_unit"],
    }


def _sensitivity_outputs(cases, base_result):
    factors = _sensitivity_factors()
    base_case = normalize_case(cases[0])
    base_policy = base_result["policy"]["tuple"]
    defect_series = []
    for field in _RATE_FIELDS:
        rows = []
        for factor in factors:
            scenario = _perturbed_case(base_case, field, factor)
            optimum = _compact_optimum(scenario)
            rows.append(
                {
                    "parameter": field,
                    "relative_factor": factor,
                    "parameter_value": scenario[field],
                    "policy_id": optimum["policy_id"],
                    "policy_tuple": optimum["policy_tuple"],
                    "profit": optimum["profit"],
                }
            )
        defect_series.append(
            {
                "parameter": field,
                "relative_factors": list(factors),
                "parameter_values": [row["parameter_value"] for row in rows],
                "profits": [row["profit"] for row in rows],
                "rows": rows,
            }
        )
    cost_series = []
    for field in _COST_FIELDS:
        rows = []
        for factor in factors:
            scenario = _perturbed_case(base_case, field, factor)
            optimum = _compact_optimum(scenario)
            rows.append(
                {
                    "parameter": field,
                    "relative_factor": factor,
                    "parameter_value": scenario[field],
                    "policy_id": optimum["policy_id"],
                    "policy_tuple": optimum["policy_tuple"],
                    "profit": optimum["profit"],
                }
            )
        cost_series.append(
            {
                "parameter": field,
                "relative_factors": list(factors),
                "parameter_values": [row["parameter_value"] for row in rows],
                "profits": [row["profit"] for row in rows],
                "rows": rows,
            }
        )
    contour_rows = []
    for exchange_factor in factors:
        for disassembly_factor in factors:
            scenario = _perturbed_case(base_case, "exchange_loss", exchange_factor)
            scenario = _perturbed_case(scenario, "disassembly_cost", disassembly_factor)
            optimum = _compact_optimum(scenario)
            policy_tuple = optimum["policy_tuple"]
            contour_rows.append(
                {
                    "exchange_loss": scenario["exchange_loss"],
                    "disassembly_cost": scenario["disassembly_cost"],
                    "exchange_relative_factor": exchange_factor,
                    "disassembly_relative_factor": disassembly_factor,
                    "policy_id": optimum["policy_id"],
                    "policy_tuple": policy_tuple,
                    "decision_changed_from_base": policy_tuple != base_policy,
                    "profit": optimum["profit"],
                }
            )
    return {
        "base_case_id": base_result["case_id"],
        "registered_relative_factors": list(factors),
        "defect_rate_sensitivity": defect_series,
        "cost_sensitivity": cost_series,
        "breakeven_contour": {
            "rows": contour_rows,
            "flip_points": [row for row in contour_rows if row["decision_changed_from_base"]],
        },
    }


def _fixed_policy_cost_monotonicity(case_result):
    case = normalize_case(case_result["parameters"])
    case["case_id"] = case_result["case_id"]
    factors = _sensitivity_factors()
    positive_factors = [factor for factor in factors if factor > 0]
    if not positive_factors:
        raise ValueError("灵敏度网格必须含正扰动")
    factor = max(positive_factors)
    settings = _model_settings()
    violations = []
    for baseline in case_result["policy_table"]:
        if not baseline["feasible"]:
            continue
        for field in _COST_FIELDS:
            perturbed = _perturbed_case(case, field, factor)
            result = absorbing_markov_reward(perturbed, baseline["policy_tuple"], full_validation=False)
            difference = result["profit"] - baseline["profit"]
            violations.append(
                {
                    "policy_id": baseline["policy"]["id"],
                    "parameter": field,
                    "relative_factor": factor,
                    "profit_difference": difference,
                    "violation": max(0, difference),
                }
            )
    maximum_violation = max((row["violation"] for row in violations), default=0.0)
    return {
        "positive_relative_factor": factor,
        "checked_policy_parameter_pairs": len(violations),
        "maximum_profit_increase": maximum_violation,
        "monotone_nonincreasing_profit": maximum_violation <= settings["cashflow_abs_tol"],
    }


def _cross_validation(case_results):
    case_checks = []
    for case_result in case_results:
        case_checks.append(
            {
                "case_id": case_result["case_id"],
                "finite_policy_cost_monotonicity": _fixed_policy_cost_monotonicity(case_result),
            }
        )
    policy_count = len(case_results[0]["policy_table"])
    nonabsorbing_count = sum(
        not row["feasible"]
        for case_result in case_results
        for row in case_result["policy_table"]
    )
    return {
        "case_count": len(case_results),
        "strategy_space_size": policy_count,
        "all_cases_have_finite_optimum": all(
            math.isfinite(row["optimal_profit"])
            for row in case_results
        ),
        "all_optimal_policy_checks_passed": all(
            row["validation"]["all_finite_policy_checks_passed"]
            for row in case_results
        ),
        "nonabsorbing_strategy_occurrences": nonabsorbing_count,
        "explicit_qualified_delivery_absorbing_state": True,
        "fixed_policy_cost_monotonicity": case_checks,
        "required_parameter_roles": {
            "p1": "零配件一次品状态概率",
            "p2": "零配件二次品状态概率",
            "pf": "正品输入后的装配条件次品概率",
            "price1": "零配件一采购事件成本",
            "test1": "零配件一逐件检测成本",
            "price2": "零配件二采购事件成本",
            "test2": "零配件二逐件检测成本",
            "assembly_cost": "每次装配及补发装配成本",
            "product_test_cost": "每次成品检测成本",
            "sale_price": "每次实际市场交易收入",
            "exchange_loss": "每个退回次品的附加调换损失",
            "disassembly_cost": "每个失败成品拆解事件成本",
        },
        "unused_required_parameters": [],
        "all_checks_passed": all(
            row["finite_policy_cost_monotonicity"]["monotone_nonincreasing_profit"]
            for row in case_checks
        )
        and all(row["validation"]["all_finite_policy_checks_passed"] for row in case_results),
    }


def _cross_case_arrays(case_results):
    case_ids = [row["case_id"] for row in case_results]
    policy_ids = [row["policy"]["id"] for row in case_results[0]["policy_table"]]
    profits = [
        [policy["profit"] for policy in row["policy_table"]]
        for row in case_results
    ]
    expected_costs = [
        [policy["expected_cost"] for policy in row["policy_table"]]
        for row in case_results
    ]
    policy_matrix = [
        [policy["policy"]["tuple"] for policy in row["policy_table"]]
        for row in case_results
    ]
    return {
        "case_ids": case_ids,
        "policy_ids": policy_ids,
        "profits": profits,
        "expected_costs": expected_costs,
        "policy_matrix": policy_matrix,
        "profit_unit": "元/合格交付",
        "expected_cost_unit": "元/合格交付",
    }


def solve():
    cases = load_cases()
    if not cases:
        raise RuntimeError("Q2_CASES 为空")
    case_results = [
        solve_case(case, index=index, full_validation=True)
        for index, case in enumerate(cases)
    ]
    identifiers = [row["case_id"] for row in case_results]
    if len(set(identifiers)) != len(identifiers):
        raise RuntimeError("问题二案例标识不唯一")
    validation = _cross_validation(case_results)
    if not validation["all_checks_passed"]:
        raise RuntimeError("问题二跨案例阻断式核验未通过")
    heatmap = _cross_case_arrays(case_results)
    decisions = [
        {
            "case_id": row["case_id"],
            "policy": row["policy"],
            "profit": row["profit"],
            "profit_unit": row["profit_unit"],
            "decision_basis": row["decision_basis"],
        }
        for row in case_results
    ]
    optimal_breakdown = [
        {
            "case_id": row["case_id"],
            "policy_id": row["policy"]["id"],
            "cost_breakdown": row["cost_breakdown"],
            "market_revenue": row["event_ledger"]["market_revenue"],
            "net_profit": row["profit"],
            "cost_unit": "元/合格交付",
        }
        for row in case_results
    ]
    return {
        "problem": "Q2",
        "method": "absorbing_markov_reward_with_explicit_qualified_delivery_state",
        "implementation_signatures": [
            "itertools.product",
            "numpy.linalg.solve",
            "absorbing_markov_reward",
            "event_cash_ledger",
            "market_revenue_once",
            "replacement_assembly_once",
        ],
        "policy_definition": {
            "order": ["Z1", "Z2", "C", "D"],
            "domain": "每个分量为二值状态",
            "tie_break": "策略元组字典序",
            "profit_unit": "元/合格交付",
        },
        "model_constants": _model_settings(),
        "cases": case_results,
        "six_case_decisions": decisions,
        "strategy_cost_heatmap": heatmap,
        "optimal_cost_breakdown": optimal_breakdown,
        "sensitivity": _sensitivity_outputs(cases, case_results[0]),
        "validation": validation,
        "data_boundary": "问题二输入为题面表一的给定案例；问题四才使用抽样率情景",
    }


def run():
    return solve()


def run_problem2():
    return solve()


def build_results():
    return {"problem2": solve()}


__all__ = [
    "normalize_case",
    "_normalize_q2_case",
    "load_cases",
    "market_revenue_once",
    "replacement_assembly_once",
    "event_cash_ledger",
    "evaluate_policy",
    "absorbing_markov_reward",
    "solve_case",
    "solve",
    "run",
    "run_problem2",
    "build_results",
]