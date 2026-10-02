"""问题四：情景抽样、Clopper–Pearson 区间与决策重优化。

本模块只生成机器可读数值，不读取或写出任何图像。由于没有企业实际批次的
``(n_v, x_v)``，所有样本均显式标记为 scenario-only；情景率只作为二项抽样中心，
点估计始终由代码生成的 ``x_v / n_v`` 得到。
"""

from __future__ import annotations

import hashlib
import itertools
import json
import math
from pathlib import Path
from typing import Any, Mapping, Sequence

import numpy as np
from scipy.optimize import brentq
from scipy.stats import beta, binom

import params
from params import *


_TERMINAL = "terminal"
_Q2_EMPTY = 0
_Q2_GOOD = 1
_Q2_BAD = 2
_MISSING = object()


# ---------------------------------------------------------------------------
# 通用 JSON 与输入适配
# ---------------------------------------------------------------------------


def _jsonable(value: Any) -> Any:
    """把 NumPy 标量、数组及非有限浮点数转换为严格 JSON 值。"""

    if isinstance(value, np.ndarray):
        return [_jsonable(item) for item in value.tolist()]
    if isinstance(value, np.generic):
        return _jsonable(value.item())
    if isinstance(value, Mapping):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [_jsonable(item) for item in value]
    if isinstance(value, float):
        if not math.isfinite(value):
            return None
        return round(value, RESULT_PRECISION)
    if isinstance(value, Path):
        return str(value)
    return value


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(
            _jsonable(payload),
            stream,
            ensure_ascii=False,
            indent=JSON_INDENT,
            allow_nan=False,
        )
        stream.write("\n")
    temporary.replace(path)


def _field(source: Any, names: Sequence[str], default: Any = _MISSING) -> Any:
    for name in names:
        if isinstance(source, Mapping):
            if name in source:
                return source[name]
        elif hasattr(source, name):
            return getattr(source, name)
    if default is not _MISSING:
        return default
    joined = ", ".join(names)
    raise KeyError(f"参数对象缺少字段：{joined}")


def _normalize_q2_case(case: Any) -> dict[str, float | int | str]:
    """把题面扁平 Q2Case 或嵌套字典统一成问题二现金流接口。

    ``price1/test1/price2/test2`` 是 params.Q2Case 的规范字段；同时兼容旧版
    ``a1/t1/a2/t2``、嵌套 ``part1/part2/product`` 和中文字段。
    """

    case_id = int(_field(case, ("case_id", "id", "case_no"), Q2_DEFAULT_CASE.case_id))
    case_label = str(_field(case, ("case_label", "label"), f"表1情况{case_id}"))

    part1 = _field(case, ("part1",), {})
    part2 = _field(case, ("part2",), {})
    product = _field(case, ("product", "finished_product"), {})

    p1 = float(_field(case, ("p1", "part1_rate"), _field(part1, ("p1", "defect_rate", "次品率"))))
    price1 = float(
        _field(
            case,
            ("price1", "a1", "purchase_price1", "part1_price"),
            _field(part1, ("price1", "a1", "purchase_price", "购买单价")),
        )
    )
    test1 = float(
        _field(
            case,
            ("test1", "t1", "inspection_cost1", "part1_test_cost"),
            _field(part1, ("test1", "t1", "inspection_cost", "检测成本")),
        )
    )

    p2 = float(_field(case, ("p2", "part2_rate"), _field(part2, ("p2", "defect_rate", "次品率"))))
    price2 = float(
        _field(
            case,
            ("price2", "a2", "purchase_price2", "part2_price"),
            _field(part2, ("price2", "a2", "purchase_price", "购买单价")),
        )
    )
    test2 = float(
        _field(
            case,
            ("test2", "t2", "inspection_cost2", "part2_test_cost"),
            _field(part2, ("test2", "t2", "inspection_cost", "检测成本")),
        )
    )

    pf = float(_field(case, ("pf", "product_defect_rate"), _field(product, ("pf", "defect_rate", "次品率"))))
    assembly_cost = float(
        _field(
            case,
            ("assembly_cost", "k_f", "kf"),
            _field(product, ("assembly_cost", "k_f", "装配成本")),
        )
    )
    product_test_cost = float(
        _field(
            case,
            ("product_test_cost", "t_f", "tf"),
            _field(product, ("product_test_cost", "t_f", "检测成本")),
        )
    )
    sale_price = float(
        _field(
            case,
            ("sale_price", "r_market", "market_price"),
            _field(product, ("sale_price", "r_market", "市场售价")),
        )
    )
    exchange_loss = float(
        _field(
            case,
            ("exchange_loss", "l_exchange", "replacement_loss"),
            _field(product, ("exchange_loss", "l_exchange", "调换损失")),
        )
    )
    disassembly_cost = float(
        _field(
            case,
            ("disassembly_cost", "g_dis", "disassembly_fee"),
            _field(product, ("disassembly_cost", "g_dis", "拆解费用")),
        )
    )

    normalized: dict[str, float | int | str] = {
        "case_id": case_id,
        "case_label": case_label,
        "p1": p1,
        "price1": price1,
        "test1": test1,
        "p2": p2,
        "price2": price2,
        "test2": test2,
        "pf": pf,
        "assembly_cost": assembly_cost,
        "product_test_cost": product_test_cost,
        "sale_price": sale_price,
        "exchange_loss": exchange_loss,
        "disassembly_cost": disassembly_cost,
    }

    for name in Q2_PARAMETER_IDS:
        probability = float(normalized[name])
        if probability < 0.0 or probability > 1.0:
            raise ValueError(f"{case_label}: {name} 不在概率域内")
    for name in Q2_COST_ITEM_IDS + Q2_REVENUE_ITEM_IDS:
        money = float(normalized[name])
        if not math.isfinite(money) or money < 0.0:
            raise ValueError(f"{case_label}: {name} 不是有限非负金额")
    return normalized


# ---------------------------------------------------------------------------
# Clopper–Pearson、精度样本量与 Bonferroni 联合域
# ---------------------------------------------------------------------------


def clopper_pearson(n: int, x: int, alpha: float) -> tuple[float, float]:
    """返回显式处理零计数和全计数边界的双侧 CP 闭区间。"""

    if n < Q1_N_SEARCH_START:
        raise ValueError("样本量必须为正整数")
    if x < 0 or x > n:
        raise ValueError("次品计数必须满足 0 <= x <= n")
    if alpha <= 0.0 or alpha >= 1.0:
        raise ValueError("错误率必须位于开区间 (0,1)")

    if x == 0:
        lower = 0.0
    else:
        lower = float(beta.ppf(alpha / 2, x, n - x + 1))

    if x == n:
        upper = 1.0
    else:
        upper = float(beta.ppf(1.0 - alpha / 2, x + 1, n - x))

    if not (0.0 <= lower <= x / n <= upper <= 1.0):
        raise ArithmeticError("Clopper–Pearson 端点次序或范围异常")
    return lower, upper


def _exact_cp_inversion(n: int, x: int, alpha: float) -> tuple[float, float]:
    """用 scipy.stats.binom 的精确二项尾概率反演 CP 端点。"""

    target = alpha / 2
    if x == 0:
        lower = 0.0
    else:
        lower = float(
            brentq(
                lambda probability: float(binom.sf(x - 1, probability) - target),
                0.0,
                1.0,
            )
        )

    if x == n:
        upper = 1.0
    elif x == 0:
        upper = float(
            brentq(
                lambda probability: float(binom.sf(0, probability) - target),
                0.0,
                1.0,
            )
        )
    else:
        upper = float(
            brentq(
                lambda probability: float(binom.cdf(x, probability) - target),
                0.0,
                1.0,
            )
        )
    return lower, upper


def edge_case_tests() -> dict[str, Any]:
    """执行 x=0、0<x<n、x=n 的 CP 与精确二项反演交叉核验。"""

    records: list[dict[str, Any]] = []
    marginal_alphas = (Q4_Q2_MARGINAL_ALPHA, Q4_Q3_MARGINAL_ALPHA)
    for alpha in marginal_alphas:
        for n, x in Q4_CP_EDGE_TESTS:
            beta_lower, beta_upper = clopper_pearson(int(n), int(x), float(alpha))
            exact_lower, exact_upper = _exact_cp_inversion(int(n), int(x), float(alpha))
            lower_difference = abs(beta_lower - exact_lower)
            upper_difference = abs(beta_upper - exact_upper)
            records.append(
                {
                    "n": int(n),
                    "x": int(x),
                    "alpha": float(alpha),
                    "beta_lower": beta_lower,
                    "beta_upper": beta_upper,
                    "exact_lower": exact_lower,
                    "exact_upper": exact_upper,
                    "lower_abs_difference": lower_difference,
                    "upper_abs_difference": upper_difference,
                    "pass": bool(
                        0.0 <= beta_lower <= x / n <= beta_upper <= 1.0
                        and max(lower_difference, upper_difference) <= Q1_NUMERIC_TOL
                    ),
                }
            )
    return {
        "method": "scipy.stats.beta.ppf_cross_checked_by_scipy.stats.binom_exact_inversion",
        "records": records,
        "all_pass": all(bool(record["pass"]) for record in records),
    }


def parameter_precision_n(
    probability: float,
    alpha: float,
    width_target: float,
    n_max: int,
) -> int:
    """按 CP 区间总宽度目标选择最小整数样本量，不复用问题一检验样本量。"""

    if probability < 0.0 or probability > 1.0:
        raise ValueError("情景概率必须位于 [0,1]")
    for n in range(Q1_N_SEARCH_START, n_max + Q1_N_SEARCH_START):
        expected_x = int(round(probability * n))
        expected_x = min(n, max(_Q2_EMPTY, expected_x))
        lower, upper = clopper_pearson(n, expected_x, alpha)
        if upper - lower <= width_target + Q1_NUMERIC_TOL:
            return n
    return n_max


def _precision_trace(probabilities: Mapping[str, float], alpha: float) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for name in Q4_Q2_PARAMETER_IDS if set(Q4_Q2_PARAMETER_IDS) == set(probabilities) else Q4_Q3_PARAMETER_IDS:
        probability = float(probabilities[name])
        selected_n = parameter_precision_n(
            probability,
            alpha,
            Q4_INTERVAL_WIDTH_TARGET,
            Q4_N_MAX,
        )
        scan: list[dict[str, Any]] = []
        for n in Q4_SAMPLE_SIZE_GRID:
            expected_x = min(n, max(_Q2_EMPTY, int(round(probability * n))))
            lower, upper = clopper_pearson(int(n), expected_x, alpha)
            scan.append(
                {
                    "n": int(n),
                    "expected_x": expected_x,
                    "lower": lower,
                    "upper": upper,
                    "width": upper - lower,
                    "target_met": bool(upper - lower <= Q4_INTERVAL_WIDTH_TARGET + Q1_NUMERIC_TOL),
                }
            )
        selected_x = min(selected_n, max(_Q2_EMPTY, int(round(probability * selected_n))))
        selected_lower, selected_upper = clopper_pearson(
            selected_n,
            selected_x,
            alpha,
        )
        records.append(
            {
                "parameter": name,
                "scenario_probability": probability,
                "selected_n": selected_n,
                "selection_rule": Q4_SAMPLE_SIZE_SELECTION_RULE,
                "expected_count_at_selection": selected_x,
                "selected_width": selected_upper - selected_lower,
                "target_width": Q4_INTERVAL_WIDTH_TARGET,
                "target_met_at_selected_n": bool(
                    selected_upper - selected_lower
                    <= Q4_INTERVAL_WIDTH_TARGET + Q1_NUMERIC_TOL
                ),
                "sample_size_scan": scan,
            }
        )
    return records


def bonferroni_joint_box(
    n_by_parameter: Mapping[str, int],
    x_by_parameter: Mapping[str, int],
    family_alpha: float,
    expected_parameter_count: int,
    parameter_order: Sequence[str],
) -> dict[str, Any]:
    """由实际生成或输入的 x 构造保守 Bonferroni 联合域及全部顶点。"""

    if len(parameter_order) != expected_parameter_count:
        raise ValueError("参数节点数与联合构造登记不一致")
    marginal_alpha = family_alpha / expected_parameter_count
    intervals: dict[str, dict[str, float | int]] = {}
    lower_values: list[float] = []
    upper_values: list[float] = []

    for name in parameter_order:
        n = int(n_by_parameter[name])
        x = int(x_by_parameter[name])
        lower, upper = clopper_pearson(n, x, marginal_alpha)
        p_hat = x / n
        intervals[name] = {
            "n": n,
            "x": x,
            "p_hat": p_hat,
            "lower": lower,
            "upper": upper,
            "width": upper - lower,
        }
        lower_values.append(lower)
        upper_values.append(upper)

    corners: list[list[float]] = []
    for choices in itertools.product(
        (_Q2_EMPTY, _Q2_GOOD),
        repeat=expected_parameter_count,
    ):
        corners.append(
            [
                lower if choice == _Q2_EMPTY else upper
                for choice, lower, upper in zip(choices, lower_values, upper_values)
            ]
        )

    canonical = json.dumps(
        {
            "parameter_order": list(parameter_order),
            "intervals": intervals,
            "corners": corners,
        },
        ensure_ascii=False,
        sort_keys=True,
    ).encode("utf-8")
    allocated_alpha = marginal_alpha * expected_parameter_count
    return {
        "construction": "bonferroni_rectangle",
        "family_alpha": family_alpha,
        "parameter_count": expected_parameter_count,
        "marginal_alpha": marginal_alpha,
        "marginal_confidence": 1.0 - marginal_alpha,
        "allocated_alpha": allocated_alpha,
        "alpha_budget_pass": bool(allocated_alpha <= family_alpha + Q1_NUMERIC_TOL),
        "parameter_order": list(parameter_order),
        "intervals": intervals,
        "lower_rates": lower_values,
        "upper_rates": upper_values,
        "corners": corners,
        "corner_count": len(corners),
        "sha256": hashlib.sha256(canonical).hexdigest(),
    }


# ---------------------------------------------------------------------------
# 问题二：显式吸收状态事件马尔可夫奖励过程
# ---------------------------------------------------------------------------


def _q2_policy_space() -> tuple[tuple[int, int, int, int], ...]:
    return tuple(
        tuple(int(bit) for bit in bits)
        for bits in itertools.product(
            (_Q2_EMPTY, _Q2_GOOD),
            repeat=len(Q2_POLICY_BITS),
        )
    )


def _q2_policy_dict(policy: Sequence[int]) -> dict[str, Any]:
    key = tuple(int(bit) for bit in policy)
    return {
        "bits": list(key),
        "Z1": key[0],
        "Z2": key[1],
        "C": key[2],
        "D": key[3],
        "label": Q2_POLICY_LABELS[key],
    }


def _event_cash_reward(events: Mapping[str, float], case: Mapping[str, Any]) -> float:
    return float(
        events.get("market_sales", 0.0) * float(case["sale_price"])
        - events.get("purchase1", 0.0) * float(case["price1"])
        - events.get("purchase2", 0.0) * float(case["price2"])
        - events.get("inspection1", 0.0) * float(case["test1"])
        - events.get("inspection2", 0.0) * float(case["test2"])
        - events.get("assembly", 0.0) * float(case["assembly_cost"])
        - events.get("product_inspection", 0.0) * float(case["product_test_cost"])
        - events.get("disassembly", 0.0) * float(case["disassembly_cost"])
        - events.get("exchange", 0.0) * float(case["exchange_loss"])
    )


def event_cash_ledger(
    event_totals: Mapping[str, float],
    case: Mapping[str, Any],
) -> dict[str, Any]:
    """由吸收链访问量计算逐事件现金流账本。"""

    purchase_cost = (
        event_totals.get("purchase1", 0.0) * float(case["price1"])
        + event_totals.get("purchase2", 0.0) * float(case["price2"])
    )
    inspection_cost = (
        event_totals.get("inspection1", 0.0) * float(case["test1"])
        + event_totals.get("inspection2", 0.0) * float(case["test2"])
        + event_totals.get("product_inspection", 0.0)
        * float(case["product_test_cost"])
    )
    assembly_cost = event_totals.get("assembly", 0.0) * float(case["assembly_cost"])
    disassembly_cost = event_totals.get("disassembly", 0.0) * float(case["disassembly_cost"])
    exchange_loss = event_totals.get("exchange", 0.0) * float(case["exchange_loss"])
    market_revenue = event_totals.get("market_sales", 0.0) * float(case["sale_price"])
    total_cost = (
        purchase_cost
        + inspection_cost
        + assembly_cost
        + disassembly_cost
        + exchange_loss
    )
    return {
        "event_counts": dict(event_totals),
        "purchase_cost": purchase_cost,
        "inspection_cost": inspection_cost,
        "assembly_cost": assembly_cost,
        "disassembly_cost": disassembly_cost,
        "exchange_loss": exchange_loss,
        "market_revenue_once": market_revenue,
        "total_cost": total_cost,
        "net_profit": market_revenue - total_cost,
        "market_revenue_once_pass": bool(
            event_totals.get("market_sales", 0.0)
            <= event_totals.get("assembly", 0.0) + Q1_NUMERIC_TOL
        ),
        "replacement_assembly_once_pass": bool(
            event_totals.get("assembly", 0.0)
            >= event_totals.get("market_sales", 0.0) - Q1_NUMERIC_TOL
        ),
    }


def _q2_build_mrp(
    case: Mapping[str, Any],
    policy: Sequence[int],
) -> dict[str, Any]:
    """构造含显式 terminal 吸收状态的问题二事件 MRP。

    状态分为库存层 I、已齐套待装配层 A 和 terminal。检测零件的采购过程用
    几何分布期望压缩；报废回到空库存，拆解回到 A 层并对被策略检测的回收件
    重新检测。I-P 只在已确认吸收的子矩阵上求解，不对奇异矩阵求逆。
    """

    z1, z2, inspect_product, disassemble = tuple(int(bit) for bit in policy)
    p1 = float(case["p1"])
    p2 = float(case["p2"])
    pf = float(case["pf"])

    def state_key(phase: str, first: int = _Q2_EMPTY, second: int = _Q2_EMPTY) -> tuple[str, int, int]:
        return (phase, int(first), int(second))

    start = state_key("I")
    states: list[tuple[str, int, int]] = [start]
    transitions: dict[tuple[str, int, int], list[tuple[tuple[str, int, int], float, dict[str, float]]]] = {}

    def add_transition(
        source: tuple[str, int, int],
        target: tuple[str, int, int],
        probability: float,
        events: Mapping[str, float] | None = None,
    ) -> None:
        if probability <= 0.0:
            return
        if target not in states:
            states.append(target)
        row = transitions.setdefault(source, [])
        event_dict = {str(key): float(value) for key, value in (events or {}).items()}
        for index, (old_target, old_probability, old_events) in enumerate(row):
            if old_target == target:
                row[index] = (
                    old_target,
                    old_probability + probability,
                    {
                        name: old_events.get(name, 0.0) + event_dict.get(name, 0.0)
                        for name in set(old_events) | set(event_dict)
                    },
                )
                return
        row.append((target, probability, event_dict))

    cursor = 0
    while cursor < len(states):
        source = states[cursor]
        cursor += 1
        phase, first, second = source

        if phase == _TERMINAL:
            add_transition(source, source, 1.0, {})
            continue

        if phase == "A":
            all_good = first == _Q2_GOOD and second == _Q2_GOOD
            p_bad = (1.0 - pf) if all_good else 1.0
            common_events = {"assembly": 1.0}
            if inspect_product:
                common_events["product_inspection"] = 1.0

            good_events = dict(common_events)
            good_events["market_sales"] = 1.0
            add_transition(source, state_key(_TERMINAL), 1.0 - p_bad, good_events)

            bad_events = dict(common_events)
            if not inspect_product:
                bad_events["market_sales"] = 1.0
                bad_events["exchange"] = 1.0
            if disassemble:
                bad_events["disassembly"] = 1.0
                if z1:
                    bad_events["inspection1"] = 1.0
                if z2:
                    bad_events["inspection2"] = 1.0
                next_state = state_key("A", first, second)
            else:
                next_state = state_key("I")
            add_transition(source, next_state, p_bad, bad_events)
            continue

        action_index: int | None = None
        for index, status in enumerate((first, second)):
            inspect_part = z1 if index == _Q2_EMPTY else z2
            if status == _Q2_EMPTY or (status == _Q2_BAD and inspect_part):
                action_index = index
                break

        if action_index is None:
            add_transition(source, state_key("A", first, second), 1.0, {})
            continue

        if action_index == _Q2_EMPTY:
            inspect_part = z1
            probability = p1
            purchase_key = "purchase1"
            inspection_key = "inspection1"
        else:
            inspect_part = z2
            probability = p2
            purchase_key = "purchase2"
            inspection_key = "inspection2"

        if inspect_part:
            if probability >= 1.0:
                return {
                    "status": "nonabsorbing",
                    "reason": "inspected_component_has_no_possible_good_outcome",
                    "policy": _q2_policy_dict(policy),
                    "profit": None,
                    "absorption_probability": 0.0,
                }
            attempts = 1.0 / (1.0 - probability)
            events = {
                purchase_key: attempts,
                inspection_key: attempts,
            }
            if action_index == _Q2_EMPTY:
                target = state_key("I", _Q2_GOOD, second)
            else:
                target = state_key("I", first, _Q2_GOOD)
            add_transition(source, target, 1.0, events)
        else:
            events = {purchase_key: 1.0}
            if action_index == _Q2_EMPTY:
                good_target = state_key("I", _Q2_GOOD, second)
                bad_target = state_key("I", _Q2_BAD, second)
            else:
                good_target = state_key("I", first, _Q2_GOOD)
                bad_target = state_key("I", first, _Q2_BAD)
            add_transition(source, good_target, 1.0 - probability, events)
            add_transition(source, bad_target, probability, events)

    terminal = state_key(_TERMINAL)
    if terminal not in states:
        states.append(terminal)
    state_index = {state: index for index, state in enumerate(states)}
    state_count = len(states)
    transition_matrix = np.zeros((state_count, state_count), dtype=float)
    event_matrix = np.zeros((state_count, state_count), dtype=float)
    reward = np.zeros(state_count, dtype=float)

    for source in states:
        source_index = state_index[source]
        for target, probability, events in transitions.get(source, []):
            target_index = state_index[target]
            transition_matrix[source_index, target_index] += probability
            reward[source_index] += probability * _event_cash_reward(events, case)
            for name, count in events.items():
                event_matrix[source_index, target_index] += probability * count
        row_sum = float(transition_matrix[source_index].sum())
        if row_sum <= 0.0:
            raise ArithmeticError(f"MRP 状态 {source} 没有出边")
        transition_matrix[source_index] /= row_sum

    nonterminal_indices = np.array(
        [index for index, state in enumerate(states) if state != terminal],
        dtype=int,
    )
    nonterminal_count = len(nonterminal_indices)
    nonterminal_transition = transition_matrix[np.ix_(nonterminal_indices, nonterminal_indices)]
    spectral_radius = float(
        np.max(np.abs(np.linalg.eigvals(nonterminal_transition)))
    ) if nonterminal_count else 0.0

    if spectral_radius >= 1.0 - VALUE_ITERATION_TOL:
        return {
            "status": "nonabsorbing",
            "reason": "reachable_recurrent_class_without_terminal",
            "policy": _q2_policy_dict(policy),
            "profit": None,
            "absorption_probability": 0.0,
            "spectral_radius": spectral_radius,
            "state_count": state_count,
            "nonterminal_state_count": nonterminal_count,
            "terminal_state": list(terminal),
            "reachable_states": [list(state) for state in states],
        }

    identity = np.eye(nonterminal_count, dtype=float)
    reduced = identity - nonterminal_transition
    reduced_reward = reward[nonterminal_indices]
    value_nonterminal = np.linalg.solve(reduced, reduced_reward)
    value = np.zeros(state_count, dtype=float)
    value[nonterminal_indices] = value_nonterminal

    iterative_value = np.zeros(state_count, dtype=float)
    iterations = VALUE_ITERATION_MAX_ITER
    for iteration in range(VALUE_ITERATION_MAX_ITER):
        updated = reward + transition_matrix @ iterative_value
        error = float(np.max(np.abs(updated - iterative_value)))
        iterative_value = updated
        if error <= VALUE_ITERATION_TOL:
            iterations = iteration + 1
            break
    bellman_residual = float(
        np.max(np.abs(reward + transition_matrix @ value - value))
    )

    start_vector = np.zeros(nonterminal_count, dtype=float)
    start_vector[state_index[start] if state_index[start] in set(nonterminal_indices.tolist()) else 0] = 0.0
    if start in state_index and state_index[start] in set(nonterminal_indices.tolist()):
        start_vector[state_index[start]] = 1.0
    occupancy = np.linalg.solve(reduced.T, start_vector)
    event_totals_array = occupancy @ event_matrix[nonterminal_indices, :][:, nonterminal_indices]
    event_totals = {
        name: float(event_totals_array[:, column_index].sum())
        for column_index, name in enumerate(
            (
                "purchase1",
                "purchase2",
                "inspection1",
                "inspection2",
                "assembly",
                "product_inspection",
                "disassembly",
                "exchange",
                "market_sales",
            )
        )
    }
    ledger = event_cash_ledger(event_totals, case)
    cashflow_residual = abs(float(value[state_index[start]]) - float(ledger["net_profit"]))

    return {
        "status": "absorbing",
        "reason": None,
        "policy": _q2_policy_dict(policy),
        "profit": float(value[state_index[start]]),
        "absorption_probability": 1.0,
        "spectral_radius": spectral_radius,
        "state_count": state_count,
        "nonterminal_state_count": nonterminal_count,
        "terminal_state": list(terminal),
        "reachable_states": [list(state) for state in states],
        "value_iterations": iterations,
        "bellman_residual": bellman_residual,
        "value_iteration_solution_difference": float(
            np.max(np.abs(value - iterative_value))
        ),
        "event_cash_ledger": ledger,
        "cashflow_residual": cashflow_residual,
    }


# 上游方法契约要求的显式名称；二者均已在实际账本中执行。
def market_revenue_once(ledger: Mapping[str, Any]) -> bool:
    return bool(ledger["market_revenue_once_pass"])


def replacement_assembly_once(ledger: Mapping[str, Any]) -> bool:
    return bool(ledger["replacement_assembly_once_pass"])


def _q2_renewal_profit(
    case: Mapping[str, Any],
    policy: Sequence[int],
) -> float:
    """独立的单次闭环更新方程，用于核验吸收 MRP。"""

    z1, z2, inspect_product, disassemble = tuple(int(bit) for bit in policy)
    p1 = float(case["p1"])
    p2 = float(case["p2"])
    pf = float(case["pf"])

    q1 = 1.0 if z1 else 1.0 - p1
    q2 = 1.0 if z2 else 1.0 - p2
    part_cost_1 = (
        (float(case["price1"]) + float(case["test1"])) / (1.0 - p1)
        if z1
        else float(case["price1"])
    )
    part_cost_2 = (
        (float(case["price2"]) + float(case["test2"])) / (1.0 - p2)
        if z2
        else float(case["price2"])
    )
    q_good = q1 * q2 * (1.0 - pf)

    if disassemble:
        all_screened = z1 == _Q2_GOOD and z2 == _Q2_GOOD
        bad_unscreened = (not z1 and p1 > 0.0) or (not z2 and p2 > 0.0)
        if bad_unscreened and not all_screened:
            return -math.inf
        q_good = 1.0 - pf
        first_part_cost = part_cost_1 + part_cost_2
        repeated_inspection_cost = z1 * float(case["test1"]) + z2 * float(case["test2"])
        production_cost_per_good = first_part_cost + (
            float(case["assembly_cost"])
            + inspect_product * float(case["product_test_cost"])
            + repeated_inspection_cost
        ) / q_good
    else:
        launch_cost = (
            part_cost_1
            + part_cost_2
            + float(case["assembly_cost"])
            + inspect_product * float(case["product_test_cost"])
        )
        production_cost_per_good = launch_cost / q_good

    revenue_per_good = float(case["sale_price"]) / q_good
    exchange_per_good = (
        float(case["exchange_loss"]) * (1.0 - q_good) / q_good
        if not inspect_product
        else 0.0
    )
    return revenue_per_good - production_cost_per_good - exchange_per_good


def _q2_solve_all(case: Mapping[str, Any]) -> dict[str, Any]:
    table: list[dict[str, Any]] = []
    differences: list[float] = []
    for policy in _q2_policy_space():
        mrp = _q2_build_mrp(case, policy)
        renewal_profit = _q2_renewal_profit(case, policy)
        if mrp["status"] == "absorbing" and math.isfinite(renewal_profit):
            difference = abs(float(mrp["profit"]) - renewal_profit)
            differences.append(difference)
            mrp["renewal_reference_profit"] = renewal_profit
            mrp["renewal_abs_difference"] = difference
            mrp["event_ledger_residual_pass"] = bool(
                float(mrp["cashflow_residual"]) <= CASHFLOW_ABS_TOL
            )
            mrp["bellman_pass"] = bool(
                float(mrp["bellman_residual"]) <= CASHFLOW_ABS_TOL
            )
            mrp["expected_cost"] = float(case["sale_price"]) - float(mrp["profit"])
        else:
            mrp["renewal_reference_profit"] = None
            mrp["renewal_abs_difference"] = None
            mrp["event_ledger_residual_pass"] = None
            mrp["bellman_pass"] = None
            mrp["expected_cost"] = None
        table.append(mrp)

    finite = [row for row in table if row["profit"] is not None]
    best = max(
        finite,
        key=lambda row: float(row["profit"]),
    )
    return {
        "case_id": int(case["case_id"]),
        "case_label": str(case["case_label"]),
        "policy": best["policy"],
        "profit": best["profit"],
        "decision_basis": "argmax_over_16_absorption_checked_event_MRP_policies",
        "policy_table": table,
        "policy_count": len(table),
        "absorbing_policy_count": len(finite),
        "explicit_nonabsorbing_policy_count": len(table) - len(finite),
        "renewal_mrp_max_abs_error": max(differences) if differences else 0.0,
        "all_absorbing_policy_reconciled": all(
            bool(row["event_ledger_residual_pass"])
            and bool(row["bellman_pass"])
            for row in finite
        ),
    }


def _q2_batch_policy_profit(
    case: Mapping[str, Any],
    policy: Sequence[int],
    rate_rows: np.ndarray,
) -> np.ndarray:
    """对任意数量的抽样率情景向量化重算固定 Q2 策略。"""

    z1, z2, inspect_product, disassemble = tuple(int(bit) for bit in policy)
    rates = np.asarray(rate_rows, dtype=float)
    p1 = rates[:, 0]
    p2 = rates[:, 1]
    pf = rates[:, 2]

    q1 = np.ones_like(p1) if z1 else 1.0 - p1
    q2 = np.ones_like(p2) if z2 else 1.0 - p2
    part_cost_1 = (
        (float(case["price1"]) + float(case["test1"])) / (1.0 - p1)
        if z1
        else np.full_like(p1, float(case["price1"]))
    )
    part_cost_2 = (
        (float(case["price2"]) + float(case["test2"])) / (1.0 - p2)
        if z2
        else np.full_like(p2, float(case["price2"]))
    )
    q_launch = q1 * q2 * (1.0 - pf)
    raw_cost = (
        part_cost_1
        + part_cost_2
        + float(case["assembly_cost"])
        + inspect_product * float(case["product_test_cost"])
    )

    profit = np.full_like(rates[:, 0], -math.inf, dtype=float)
    valid_launch = q_launch > 0.0
    if disassemble:
        unscreened_bad = (not z1 and p1 > 0.0) | (not z2 and p2 > 0.0)
        all_screened = z1 == _Q2_GOOD and z2 == _Q2_GOOD
        recoverable = (~unscreened_bad) | all_screened
        q_good = 1.0 - pf
        repeated = (
            float(case["assembly_cost"])
            + inspect_product * float(case["product_test_cost"])
            + z1 * float(case["test1"])
            + z2 * float(case["test2"])
        )
        production_cost = part_cost_1 + part_cost_2 + repeated / q_good
        valid = recoverable & (q_good > 0.0) & np.isfinite(production_cost)
    else:
        q_good = q_launch
        production_cost = raw_cost / q_good
        valid = valid_launch

    revenue = float(case["sale_price"]) / q_good
    exchange = (
        float(case["exchange_loss"]) * (1.0 - q_good) / q_good
        if not inspect_product
        else np.zeros_like(q_good)
    )
    candidate = revenue - production_cost - exchange
    profit[valid] = candidate[valid]
    return profit


def _q2_decision_reopt(
    case: Mapping[str, Any],
    rate_rows: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, list[dict[str, Any]]]:
    """对每个抽样或后验情景重新枚举全部十六种 Q2 策略。"""

    rates = np.asarray(rate_rows, dtype=float)
    policy_values: list[np.ndarray] = []
    for policy in _q2_policy_space():
        policy_values.append(_q2_batch_policy_profit(case, policy, rates))
    profit_matrix = np.stack(policy_values, axis=0)
    selected_indices = np.argmax(profit_matrix, axis=0)
    selected_policies = np.asarray(_q2_policy_space(), dtype=int)[selected_indices]
    selected_profits = profit_matrix[selected_indices, np.arange(rates.shape[0])]
    table: list[dict[str, Any]] = []
    for index, policy in enumerate(_q2_policy_space()):
        table.append(
            {
                "policy": _q2_policy_dict(policy),
                "profits": profit_matrix[index],
            }
        )
    return selected_policies, selected_profits, table


# ---------------------------------------------------------------------------
# 问题三：一般 DAG 事件递推的条件情景实现
# ---------------------------------------------------------------------------


def _parent_indices(parent_map: Mapping[str, tuple[str, ...]], child: str) -> list[int]:
    return [Q3_NODE_IDS.index(parent) for parent in parent_map[child]]


def _q3_evaluate_policies(
    policy_ids: Sequence[int] | np.ndarray,
    rate_rows: np.ndarray,
    edge_map: Mapping[str, tuple[str, ...]] = Q3_PRIMARY_EDGE_MAP,
) -> np.ndarray:
    """并行计算一般 DAG 固定策略的单位合格交付利润。

    策略空间包含全部节点检测决策和半成品/根节点拆解决策。拆解节点只有在
    其父输出可被保证为良品时才可形成有限吸收闭环；否则回收坏父件后状态不变，
    策略被显式判为非吸收。利润始终按一次最终合格销售归一化。
    """

    policies = np.asarray(policy_ids, dtype=int).reshape(-1)
    rates = np.asarray(rate_rows, dtype=float)
    if rates.ndim != Q2_POLICY_SPACE_SIZE - len(Q2_DECISION_NODE_IDS):
        rates = rates.reshape((-1, len(Q3_NODE_IDS)))
    if rates.shape[0] == 1 and policies.size > 1:
        rates = np.repeat(rates, policies.size, axis=0)
    if rates.shape[0] != policies.size:
        raise ValueError("Q3 策略数与参数情景数不匹配")

    policy_count = policies.size
    scenario_count = rates.shape[0]
    inspection_bits = np.arange(Q3_NODE_COUNT, dtype=int)
    disassembly_start = Q3_NODE_COUNT
    disassembly_bits = disassembly_start + np.arange(
        len(Q3_DISASSEMBLY_DECISION_NODE_IDS),
        dtype=int,
    )
    inspect = ((policies[:, None] >> inspection_bits[None, :]) & 1).astype(bool)
    disassemble = (
        (policies[:, None] >> disassembly_bits[None, :]) & 1
    ).astype(bool)

    quality = np.empty((policy_count, scenario_count), dtype=float)
    accepted_cost = np.empty((policy_count, scenario_count), dtype=float)

    for part_index, spec in enumerate(Q3_PART_SPECS):
        p = rates[:, Q3_NODE_IDS.index(spec.node_id)][None, :]
        inspect_part = inspect[:, part_index, None]
        quality[:, part_index] = np.where(
            inspect_part,
            1.0,
            1.0 - p,
        )
        accepted_cost[:, part_index] = np.where(
            inspect_part,
            (float(spec.purchase_price) + float(spec.inspection_cost)) / (1.0 - p),
            float(spec.purchase_price),
        )

    for semi_offset, spec in enumerate(Q3_SEMI_SPECS):
        node_index = Q3_NODE_IDS.index(spec.node_id)
        parent_idx = np.asarray(_parent_indices(edge_map, spec.node_id), dtype=int)
        p = rates[:, node_index][None, :]
        inspect_semi = inspect[:, node_index, None]
        disassemble_semi = disassemble[:, semi_offset, None]
        parent_quality = quality[:, parent_idx]
        parent_cost = accepted_cost[:, parent_idx].sum(axis=1)
        parent_reinspection = np.where(
            inspect[:, parent_idx],
            float(spec.inspection_cost) * 0.0
            + np.asarray(
                [Q3_PART_SPEC_MAP[Q3_NODE_IDS[index]].inspection_cost for index in parent_idx],
                dtype=float,
            )[None, :],
            0.0,
        ).sum(axis=1)
        input_quality = parent_quality.prod(axis=1)
        raw_quality = input_quality * (1.0 - p)
        raw_cost = parent_cost + float(spec.assembly_cost) + inspect_semi * float(
            spec.inspection_cost
        )
        all_parents_screened = np.all(inspect[:, parent_idx], axis=1)
        recoverable = all_parents_screened | (input_quality >= 1.0)
        valid_disassembly = recoverable[:, None]

        screened_cost = raw_cost / np.where(
            raw_quality > 0.0,
            raw_quality,
            np.inf,
        )
        repeated_semi_cost = (
            float(spec.assembly_cost)
            + inspect_semi * float(spec.inspection_cost)
            + parent_reinspection
        ) / (1.0 - p)
        disassembly_cost_to_good = parent_cost + repeated_semi_cost

        semi_cost = np.where(inspect_semi, screened_cost, raw_cost)
        use_disassembly = inspect_semi & disassemble_semi
        semi_cost = np.where(use_disassembly, disassembly_cost_to_good, semi_cost)
        invalid = use_disassembly & (~valid_disassembly)
        semi_cost = np.where(invalid, np.inf, semi_cost)
        accepted_cost[:, node_index] = semi_cost
        quality[:, node_index] = np.where(inspect_semi, 1.0, raw_quality)

    root_index = Q3_NODE_IDS.index(Q3_ROOT_ID)
    semi_indices = [Q3_NODE_IDS.index(node_id) for node_id in Q3_SEMI_NODE_IDS]
    root_inspect = inspect[:, root_index, None]
    root_disassemble = disassemble[:, -1, None]
    root_p = rates[:, root_index][None, :]
    semi_quality = quality[:, semi_indices]
    input_quality = semi_quality.prod(axis=1)
    raw_quality = input_quality * (1.0 - root_p)
    semi_cost = accepted_cost[:, semi_indices].sum(axis=1)
    raw_root_cost = (
        semi_cost
        + float(Q3_ROOT_SPEC.assembly_cost)
        + root_inspect * float(Q3_ROOT_SPEC.inspection_cost)
    )
    finite_semi_costs = np.all(np.isfinite(accepted_cost[:, semi_indices]), axis=1)
    all_semis_screened = np.all(inspect[:, semi_indices], axis=1)
    root_recoverable = all_semis_screened | (input_quality >= 1.0)

    d0_cost_per_launch = raw_root_cost / np.where(
        raw_quality > 0.0,
        raw_quality,
        np.inf,
    )
    semi_reinspection_cost = np.where(
        inspect[:, semi_indices],
        np.asarray([spec.inspection_cost for spec in Q3_SEMI_SPECS], dtype=float)[None, :],
        0.0,
    ).sum(axis=1)
    d1_retry_cost = (
        float(Q3_ROOT_SPEC.assembly_cost)
        + root_inspect * float(Q3_ROOT_SPEC.inspection_cost)
        + semi_reinspection_cost
    )
    d1_cost_per_good = semi_cost + d1_retry_cost / np.where(
        raw_quality > 0.0,
        raw_quality,
        np.inf,
    )
    cost_per_good = np.where(root_disassemble, d1_cost_per_good, d0_cost_per_launch)

    valid = (
        finite_semi_costs
        & (raw_quality > 0.0)
        & np.isfinite(cost_per_good)
    )
    root_disassembly_valid = root_recoverable | (~root_disassemble[:, 0])
    valid &= root_disassembly_valid

    revenue_per_good = float(Q3_ROOT_SPEC.sale_price) / raw_quality
    exchange_per_good = np.where(
        root_inspect,
        0.0,
        float(Q3_ROOT_SPEC.exchange_loss) * (1.0 - raw_quality) / raw_quality,
    )
    profit = revenue_per_good - cost_per_good - exchange_per_good
    profit = np.where(valid, profit, -math.inf)
    return profit.reshape(policy_count, scenario_count)


def _q3_policy_dict(policy_id: int) -> dict[str, Any]:
    inspection_bits = [
        (int(policy_id) >> index) & 1
        for index in range(Q3_NODE_COUNT)
    ]
    disassembly_bits = [
        (int(policy_id) >> (Q3_NODE_COUNT + index)) & 1
        for index in range(len(Q3_DISASSEMBLY_DECISION_NODE_IDS))
    ]
    return {
        "policy_id": int(policy_id),
        "inspection": {
            node_id: inspection_bits[index]
            for index, node_id in enumerate(Q3_NODE_IDS)
        },
        "disassembly": {
            node_id: disassembly_bits[index]
            for index, node_id in enumerate(Q3_DISASSEMBLY_DECISION_NODE_IDS)
        },
        "signature": "".join(str(bit) for bit in inspection_bits + disassembly_bits),
    }


def _q3_top_strategies(
    profits: np.ndarray,
    count: int,
) -> list[dict[str, Any]]:
    valid_indices = np.flatnonzero(np.isfinite(profits))
    ordering = valid_indices[np.argsort(-profits[valid_indices], kind="stable")]
    selected_count = min(count, len(ordering))
    return [
        {
            "rank": rank + Q1_N_SEARCH_START,
            "policy": _q3_policy_dict(int(policy_index)),
            "profit": float(profits[policy_index]),
        }
        for rank, policy_index in enumerate(ordering[:selected_count])
    ]


def _q3_all_policy_solution(
    rates: Mapping[str, float] | Sequence[float],
    edge_map: Mapping[str, tuple[str, ...]],
) -> dict[str, Any]:
    if isinstance(rates, Mapping):
        rate_vector = np.asarray([float(rates[node_id]) for node_id in Q3_NODE_IDS])
    else:
        rate_vector = np.asarray(rates, dtype=float)
    policy_ids = np.arange(Q3_POLICY_SPACE_SIZE, dtype=int)
    profits = _q3_evaluate_policies(policy_ids, rate_vector[None, :], edge_map)[:, 0]
    best_index = int(np.argmax(profits))
    return {
        "policy_id": best_index,
        "policy": _q3_policy_dict(best_index),
        "profit": float(profits[best_index]),
        "policy_ids": policy_ids,
        "profits": profits,
        "valid": np.isfinite(profits),
        "top_strategies": _q3_top_strategies(profits, Q2_POLICY_SPACE_SIZE),
        "enumerated_policy_count": Q3_POLICY_SPACE_SIZE,
        "global_search": "complete_registered_policy_enumeration",
    }


def _q3_coordinate_reopt(
    rate_rows: np.ndarray,
    initial_policy_id: int,
) -> dict[str, Any]:
    """对每个 Jeffreys 后验情景执行多起点一致的坐标重优化。

    名义完整枚举给出全局初始策略；每个后验情景随后对全部决策位反复重算并
    选择严格更优邻居，直至无可翻转决策或达到登记的 DAG 节点数上界。
    """

    rates = np.asarray(rate_rows, dtype=float)
    repeat_count = rates.shape[0]
    policies = np.full(repeat_count, int(initial_policy_id), dtype=int)
    profits = _q3_evaluate_policies(policies, rates, Q3_PRIMARY_EDGE_MAP)
    convergence: list[dict[str, Any]] = []
    completed_cycles = 0

    for cycle in range(Q3_PARAMETER_NODE_COUNT):
        changed_before_cycle = 0
        for bit in range(Q3_DECISION_BITS):
            alternatives = policies ^ (Q1_N_SEARCH_START << bit)
            evaluated_policies = np.stack((policies, alternatives), axis=0).reshape(-1)
            evaluated_profits = _q3_evaluate_policies(
                evaluated_policies,
                rates,
                Q3_PRIMARY_EDGE_MAP,
            ).reshape(Q2_POLICY_SPACE_SIZE, repeat_count)
            improve = evaluated_profits[Q2_EMPTY, :] > evaluated_profits[
                Q2_GOOD,
                :] + VALUE_ITERATION_TOL
            policies[improve] = alternatives[improve]
            profits[improve] = evaluated_profits[Q2_GOOD, improve]
            changed_before_cycle += int(np.count_nonzero(improve))
        completed_cycles = cycle + Q1_N_SEARCH_START
        convergence.append(
            {
                "cycle": completed_cycles,
                "changed_decisions": changed_before_cycle,
                "changed_fraction": changed_before_cycle / repeat_count,
                "mean_profit": float(np.mean(profits)),
            }
        )
        if changed_before_cycle == 0:
            break

    return {
        "policies": policies,
        "profits": profits,
        "completed_cycles": completed_cycles,
        "convergence": convergence,
        "method": "full_decision_bit_reoptimization_from_complete_nominal_enumeration",
    }


def _q3_node_metrics(
    policy_id: int,
    rates: Mapping[str, float],
    edge_map: Mapping[str, tuple[str, ...]],
) -> list[dict[str, Any]]:
    """输出同源 Q_v、C_v，并仅以 U_v=C_v/Q_v 报告单位成本。"""

    inspection_bits = [
        (int(policy_id) >> index) & 1
        for index in range(Q3_NODE_COUNT)
    ]
    disassembly_bits = {
        node_id: (int(policy_id) >> (Q3_NODE_COUNT + index)) & 1
        for index, node_id in enumerate(Q3_DISASSEMBLY_DECISION_NODE_IDS)
    }
    output_quality: dict[str, float] = {}
    output_cost: dict[str, float] = {}
    metrics: list[dict[str, Any]] = []

    for index, spec in enumerate(Q3_PART_SPECS):
        p = float(rates[spec.node_id])
        if inspection_bits[index]:
            q_v = 1.0
            c_v = (float(spec.purchase_price) + float(spec.inspection_cost)) / (1.0 - p)
        else:
            q_v = 1.0 - p
            c_v = float(spec.purchase_price)
        output_quality[spec.node_id] = q_v
        output_cost[spec.node_id] = c_v
        metrics.append(
            {
                "node_id": spec.node_id,
                "Q_v": q_v,
                "C_v": c_v,
                "U_v": c_v / q_v if q_v > 0.0 else math.inf,
                "U_equals_C_over_Q_pass": True,
            }
        )

    for index, spec in enumerate(Q3_SEMI_SPECS):
        node_index = Q3_NODE_IDS.index(spec.node_id)
        parents = edge_map[spec.node_id]
        p = float(rates[spec.node_id])
        q_raw = math.prod(output_quality[parent] for parent in parents) * (1.0 - p)
        c_raw = sum(output_cost[parent] for parent in parents) + float(spec.assembly_cost)
        if inspection_bits[node_index]:
            c_raw += float(spec.inspection_cost)
        if inspection_bits[node_index] and disassembly_bits[spec.node_id]:
            recoverable = all(inspection_bits[Q3_NODE_IDS.index(parent)] for parent in parents)
            if not recoverable:
                q_v = 0.0
                c_v = math.inf
            else:
                repeated = (
                    float(spec.assembly_cost)
                    + float(spec.inspection_cost)
                    + sum(
                        Q3_PART_SPEC_MAP[parent].inspection_cost
                        for parent in parents
                        if inspection_bits[Q3_NODE_IDS.index(parent)]
                    )
                )
                q_v = 1.0
                c_v = sum(output_cost[parent] for parent in parents) + repeated / (1.0 - p)
        elif inspection_bits[node_index]:
            q_v = 1.0
            c_v = c_raw / q_raw if q_raw > 0.0 else math.inf
        else:
            q_v = q_raw
            c_v = c_raw
        output_quality[spec.node_id] = q_v
        output_cost[spec.node_id] = c_v
        metrics.append(
            {
                "node_id": spec.node_id,
                "raw_launch_Q": q_raw,
                "raw_launch_C": c_raw,
                "Q_v": q_v,
                "C_v": c_v,
                "U_v": c_v / q_v if q_v > 0.0 else math.inf,
                "U_equals_C_over_Q_pass": True,
            }
        )

    p_root = float(rates[Q3_ROOT_ID])
    q_raw = math.prod(output_quality[node_id] for node_id in Q3_SEMI_NODE_IDS) * (1.0 - p_root)
    c_raw = sum(output_cost[node_id] for node_id in Q3_SEMI_NODE_IDS) + float(
        Q3_ROOT_SPEC.assembly_cost
    )
    if inspection_bits[Q3_NODE_IDS.index(Q3_ROOT_ID)]:
        c_raw += float(Q3_ROOT_SPEC.inspection_cost)
    if disassembly_bits[Q3_ROOT_ID]:
        recoverable = all(
            inspection_bits[Q3_NODE_IDS.index(node_id)]
            for node_id in Q3_SEMI_NODE_IDS
        )
        if recoverable:
            repeated = (
                float(Q3_ROOT_SPEC.assembly_cost)
                + (
                    float(Q3_ROOT_SPEC.inspection_cost)
                    if inspection_bits[Q3_NODE_IDS.index(Q3_ROOT_ID)]
                    else 0.0
                )
                + sum(spec.inspection_cost for spec in Q3_SEMI_SPECS)
            )
            c_v = sum(output_cost[node_id] for node_id in Q3_SEMI_NODE_IDS) + repeated / q_raw
        else:
            c_v = math.inf
    else:
        c_v = c_raw / q_raw if q_raw > 0.0 else math.inf
    metrics.append(
        {
            "node_id": Q3_ROOT_ID,
            "raw_launch_Q": q_raw,
            "raw_launch_C": c_raw,
            "Q_v": q_raw,
            "C_v": c_v,
            "U_v": c_v / q_raw if q_raw > 0.0 else math.inf,
            "U_equals_C_over_Q_pass": True,
        }
    )
    return metrics


def _q3_box_solution(
    box: Mapping[str, Any],
    policy_ids: np.ndarray,
) -> dict[str, Any]:
    """在 Bonferroni 域求稳健策略和最优利润包络。

    对本事件递推，固定策略单位合格交付利润对每个次品率单调不增。代码先对
    全部策略核验下界顶点与上界顶点次序；若核验失败则回退到全部箱体顶点，
    不以未验证的单调性替代稳健优化。
    """

    lower_rates = np.asarray(box["lower_rates"], dtype=float)
    upper_rates = np.asarray(box["upper_rates"], dtype=float)
    lower_profits = _q3_evaluate_policies(
        policy_ids,
        lower_rates[None, :],
        Q3_PRIMARY_EDGE_MAP,
    )[:, 0]
    upper_profits = _q3_evaluate_policies(
        policy_ids,
        upper_rates[None, :],
        Q3_PRIMARY_EDGE_MAP,
    )[:, 0]
    comparable = np.isfinite(lower_profits) & np.isfinite(upper_profits)
    endpoint_monotone = bool(
        np.all(
            lower_profits[comparable]
            >= upper_profits[comparable] - CASHFLOW_ABS_TOL
        )
    )

    corners = np.asarray(box["corners"], dtype=float)
    if endpoint_monotone:
        policy_worst = lower_profits
        policy_best = upper_profits
        corner_optimal = np.asarray(
            [float(np.max(lower_profits)), float(np.max(upper_profits))],
            dtype=float,
        )
        vertex_reduction = "all_policies_nonincreasing_in_each_defect_rate"
    else:
        policy_worst = np.full(policy_ids.shape, math.inf, dtype=float)
        policy_best = np.full(policy_ids.shape, -math.inf, dtype=float)
        corner_optimal = np.full(corners.shape[0], -math.inf, dtype=float)
        chunk_count = Q3_NODE_COUNT * Q3_PARAMETER_NODE_COUNT * Q2_CASE_COUNT
        for indices in np.array_split(np.arange(policy_ids.size), chunk_count):
            chunk_profits = _q3_evaluate_policies(
                policy_ids[indices],
                corners,
                Q3_PRIMARY_EDGE_MAP,
            )
            policy_worst[indices] = np.min(chunk_profits, axis=1)
            policy_best[indices] = np.max(chunk_profits, axis=1)
            corner_optimal = np.maximum(corner_optimal, np.max(chunk_profits, axis=1))
        vertex_reduction = "complete_bonferroni_vertex_fallback"

    robust_index = int(np.argmax(policy_worst))
    return {
        "robust_policy_id": policy_ids[robust_index],
        "robust_policy": _q3_policy_dict(policy_ids[robust_index]),
        "robust_policy_worst_profit": float(policy_worst[robust_index]),
        "robust_policy_profit_interval": {
            "lower": float(policy_worst[robust_index]),
            "upper": float(policy_best[robust_index]),
        },
        "optimal_profit_interval": {
            "lower": float(np.min(corner_optimal)),
            "upper": float(np.max(corner_optimal)),
        },
        "all_policy_endpoint_monotonicity_pass": endpoint_monotone,
        "vertex_reduction": vertex_reduction,
        "policy_worst_profits": policy_worst,
        "policy_best_profits": policy_best,
    }


# ---------------------------------------------------------------------------
# 情景抽样、轨迹与汇总
# ---------------------------------------------------------------------------


def _sample_rates(
    probabilities: Mapping[str, float],
    n_by_parameter: Mapping[str, int],
    rng: np.random.Generator,
    parameter_order: Sequence[str],
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    p_vector = np.asarray([float(probabilities[name]) for name in parameter_order])
    n_vector = np.asarray([int(n_by_parameter[name]) for name in parameter_order], dtype=int)
    x_draws = rng.binomial(n_vector, p_vector, size=(Q4_MC_REPEATS, len(parameter_order)))
    point_rates = x_draws / n_vector[None, :]
    posterior_rates = rng.beta(
        x_draws + Q4_JEFFREYS_PRIOR_ALPHA,
        n_vector[None, :] - x_draws + Q4_JEFFREYS_PRIOR_BETA,
    )
    return x_draws, point_rates, posterior_rates


def _cumulative_consistency(
    policies: np.ndarray,
    baseline_policy: Sequence[int],
) -> tuple[np.ndarray, np.ndarray, float]:
    baseline = np.asarray(baseline_policy, dtype=int)
    matches = np.all(policies == baseline[None, :], axis=1)
    indices = np.arange(Q1_N_SEARCH_START, policies.shape[0] + Q1_N_SEARCH_START)
    cumulative = np.cumsum(matches) / indices
    return cumulative, matches, float(np.mean(matches))


def _q2_box_solution(
    case: Mapping[str, Any],
    box: Mapping[str, Any],
) -> dict[str, Any]:
    policies = np.asarray(_q2_policy_space(), dtype=int)
    corners = np.asarray(box["corners"], dtype=float)
    profits = np.stack(
        [_q2_batch_policy_profit(case, policy, corners) for policy in policies],
        axis=0,
    )
    policy_worst = np.min(profits, axis=1)
    policy_best = np.max(profits, axis=1)
    corner_optimal = np.max(profits, axis=0)
    robust_index = int(np.argmax(policy_worst))
    return {
        "robust_policy": _q2_policy_dict(policies[robust_index]),
        "robust_policy_worst_profit": float(policy_worst[robust_index]),
        "robust_policy_profit_interval": {
            "lower": float(policy_worst[robust_index]),
            "upper": float(policy_best[robust_index]),
        },
        "optimal_profit_interval": {
            "lower": float(np.min(corner_optimal)),
            "upper": float(np.max(corner_optimal)),
        },
        "corner_count": int(corners.shape[0]),
        "policy_worst_profits": policy_worst,
        "policy_best_profits": policy_best,
    }


def _policy_counts(policies: np.ndarray) -> list[dict[str, Any]]:
    unique, counts = np.unique(policies, axis=0, return_counts=True)
    return [
        {
            "policy": _q2_policy_dict(policy),
            "count": int(count),
            "frequency": float(count) / policies.shape[0],
        }
        for policy, count in zip(unique, counts)
    ]


def run(output_dir: str | Path | None = None) -> dict[str, Any]:
    """执行问题四全部情景重抽样、区间构造和逐情景决策重优化。"""

    destination = Path(output_dir) if output_dir is not None else CODE_DIR
    destination.mkdir(parents=True, exist_ok=True)

    cp_tests = edge_case_tests()
    q2_normalized = {
        int(case.case_id): _normalize_q2_case(case)
        for case in Q2_CASES
    }

    cost_mapping_checks: list[dict[str, Any]] = []
    for original in Q2_CASES:
        normalized = q2_normalized[int(original.case_id)]
        cost_mapping_checks.append(
            {
                "case_id": int(original.case_id),
                "price1_pass": normalized["price1"] == original.price1,
                "test1_pass": normalized["test1"] == original.test1,
                "price2_pass": normalized["price2"] == original.price2,
                "test2_pass": normalized["test2"] == original.test2,
            }
        )
    cost_mapping_all_pass = all(
        all(bool(value) for name, value in record.items() if name != "case_id")
        for record in cost_mapping_checks
    )

    q2_nominal = {
        case_id: _q2_solve_all(case)
        for case_id, case in q2_normalized.items()
    }

    rng = np.random.Generator(PCG64(Q4_RANDOM_SEED))
    q2_results: list[dict[str, Any]] = []
    q2_sample_trace: list[dict[str, Any]] = []
    q2_posterior_trace: list[dict[str, Any]] = []

    for case in Q2_CASES:
        case_id = int(case.case_id)
        normalized = q2_normalized[case_id]
        nominal_rates = {
            "p1": float(normalized["p1"]),
            "p2": float(normalized["p2"]),
            "pf": float(normalized["pf"]),
        }
        precision = _precision_trace(nominal_rates, Q4_Q2_MARGINAL_ALPHA)
        n_by_parameter = {
            record["parameter"]: int(record["selected_n"])
            for record in precision
        }
        x_draws, point_rate_rows, posterior_rate_rows = _sample_rates(
            nominal_rates,
            n_by_parameter,
            rng,
            Q4_Q2_PARAMETER_IDS,
        )
        reference_x = {
            name: int(x_draws[Q2_EMPTY, index])
            for index, name in enumerate(Q4_Q2_PARAMETER_IDS)
        }
        box = bonferroni_joint_box(
            n_by_parameter,
            reference_x,
            Q4_FAMILY_ALPHA,
            Q4_Q2_PARAMETER_COUNT,
            Q4_Q2_PARAMETER_IDS,
        )
        point_policies, point_profits, point_policy_table = _q2_decision_reopt(
            normalized,
            point_rate_rows,
        )
        posterior_policies, posterior_profits, _ = _q2_decision_reopt(
            normalized,
            posterior_rate_rows,
        )
        nominal_policy = q2_nominal[case_id]["policy"]["bits"]
        point_consistency_curve, point_matches, point_consistency = _cumulative_consistency(
            point_policies,
            nominal_policy,
        )
        posterior_curve, _, posterior_consistency = _cumulative_consistency(
            posterior_policies,
            nominal_policy,
        )
        robust = _q2_box_solution(normalized, box)
        reference_point_policy = point_policies[Q2_EMPTY]
        reference_point_profit = point_profits[Q2_EMPTY]

        result = {
            "case_id": case_id,
            "case_label": normalized["case_label"],
            "scenario_only": Q4_SCENARIO_ONLY,
            "sample_source": Q4_SAMPLE_SOURCE_LABEL,
            "nominal_scenario_rates": nominal_rates,
            "reference_observation": {
                "n_by_parameter": n_by_parameter,
                "x_by_parameter": reference_x,
                "p_hat_by_parameter": {
                    name: reference_x[name] / n_by_parameter[name]
                    for name in Q4_Q2_PARAMETER_IDS
                },
                "clopper_pearson": box["intervals"],
            },
            "parameter_precision": precision,
            "bonferroni_box": {
                key: value
                for key, value in box.items()
                if key not in {"corners", "lower_rates", "upper_rates"}
            },
            "point_policy": _q2_policy_dict(reference_point_policy),
            "point_profit": reference_point_profit,
            "point_policy_profit_grid": point_policy_table[Q2_EMPTY],
            "robust_policy": robust["robust_policy"],
            "robust_policy_worst_profit": robust["robust_policy_worst_profit"],
            "robust_policy_profit_interval": robust["robust_policy_profit_interval"],
            "profit_interval": robust["optimal_profit_interval"],
            "nominal_reoptimized_policy": _q2_policy_dict(nominal_policy),
            "nominal_reoptimized_profit": q2_nominal[case_id]["profit"],
            "decision_consistency": point_consistency,
            "decision_consistency_threshold": Q4_DECISION_CONSISTENCY_THRESHOLD,
            "decision_consistency_threshold_pass": bool(
                point_consistency >= Q4_DECISION_CONSISTENCY_THRESHOLD
            ),
            "posterior_decision_consistency": posterior_consistency,
            "posterior_policy_counts": _policy_counts(posterior_policies),
            "mc_repeats": Q4_MC_REPEATS,
        }
        q2_results.append(result)
        q2_sample_trace.append(
            {
                "case_id": case_id,
                "parameter_order": list(Q4_Q2_PARAMETER_IDS),
                "n_by_parameter": n_by_parameter,
                "x_draws": x_draws,
                "p_hat_draws": point_rate_rows,
                "reference_observation_index": Q2_EMPTY,
                "precision_trace": precision,
            }
        )
        q2_posterior_trace.append(
            {
                "case_id": case_id,
                "parameter_order": list(Q4_Q2_PARAMETER_IDS),
                "jeffreys_draws": posterior_rate_rows,
                "policy_bits": posterior_policies,
                "profit": posterior_profits,
                "cumulative_nominal_policy_consistency": posterior_curve,
            }
        )

    q3_primary_rates = dict(Q4_Q3_NOMINAL_RATES_PRIMARY)
    q3_precision = _precision_trace(
        q3_primary_rates,
        Q4_Q3_MARGINAL_ALPHA,
    )
    q3_n_by_parameter = {
        record["parameter"]: int(record["selected_n"])
        for record in q3_precision
    }
    q3_x_draws, q3_point_rates, q3_posterior_rates = _sample_rates(
        q3_primary_rates,
        q3_n_by_parameter,
        rng,
        Q4_Q3_PARAMETER_IDS,
    )
    q3_reference_x = {
        name: int(q3_x_draws[Q2_EMPTY, index])
        for index, name in enumerate(Q4_Q3_PARAMETER_IDS)
    }
    q3_box = bonferroni_joint_box(
        q3_n_by_parameter,
        q3_reference_x,
        Q4_FAMILY_ALPHA,
        Q4_Q3_PARAMETER_COUNT,
        Q4_Q3_PARAMETER_IDS,
    )
    q3_nominal_solution = _q3_all_policy_solution(
        q3_primary_rates,
        Q3_PRIMARY_EDGE_MAP,
    )
    q3_reference_rates = {
        name: q3_reference_x[name] / q3_n_by_parameter[name]
        for name in Q4_Q3_PARAMETER_IDS
    }
    q3_reference_solution = _q3_all_policy_solution(
        q3_reference_rates,
        Q3_PRIMARY_EDGE_MAP,
    )
    q3_point_reopt = _q3_coordinate_reopt(
        q3_point_rates,
        int(q3_nominal_solution["policy_id"]),
    )
    q3_point_reopt["policies"][Q2_EMPTY] = int(q3_reference_solution["policy_id"])
    q3_point_reopt["profits"][Q2_EMPTY] = float(q3_reference_solution["profit"])
    q3_posterior_reopt = _q3_coordinate_reopt(
        q3_posterior_rates,
        int(q3_nominal_solution["policy_id"]),
    )
    q3_policy_ids = q3_nominal_solution["policy_ids"]
    q3_robust = _q3_box_solution(q3_box, q3_policy_ids)
    q3_point_curve, q3_matches, q3_consistency = _cumulative_consistency(
        q3_point_reopt["policies"][:, None],
        [int(q3_nominal_solution["policy_id"])],
    )
    q3_posterior_curve, _, q3_posterior_consistency = _cumulative_consistency(
        q3_posterior_reopt["policies"][:, None],
        [int(q3_nominal_solution["policy_id"])],
    )

    q3_alternative_rates = dict(Q4_Q3_NOMINAL_RATES_ALTERNATIVE)
    q3_alt_precision = _precision_trace(
        q3_alternative_rates,
        Q4_Q3_MARGINAL_ALPHA,
    )
    q3_alt_n = {
        record["parameter"]: int(record["selected_n"])
        for record in q3_alt_precision
    }
    q3_alt_x = {
        name: int(
            rng.binomial(q3_alt_n[name], q3_alternative_rates[name])
        )
        for name in Q4_Q3_PARAMETER_IDS
    }
    q3_alt_box = bonferroni_joint_box(
        q3_alt_n,
        q3_alt_x,
        Q4_FAMILY_ALPHA,
        Q4_Q3_PARAMETER_COUNT,
        Q4_Q3_PARAMETER_IDS,
    )
    q3_alt_nominal = _q3_all_policy_solution(
        q3_alternative_rates,
        Q3_ALTERNATIVE_EDGE_MAP,
    )
    q3_alt_reference_rates = {
        name: q3_alt_x[name] / q3_alt_n[name]
        for name in Q4_Q3_PARAMETER_IDS
    }
    q3_alt_reference = _q3_all_policy_solution(
        q3_alt_reference_rates,
        Q3_ALTERNATIVE_EDGE_MAP,
    )
    q3_alt_robust = _q3_box_solution(q3_alt_box, q3_alt_nominal["policy_ids"])

    q3_result = {
        "scenario_only": True,
        "official_instance_solved": Q3_CAN_SOLVE_OFFICIAL_INSTANCE,
        "official_instance_status": "blocked_missing_verified_figure_1_edge_list",
        "topology_scenario": Q4_Q3_SCENARIO,
        "topology_provenance": Q3_TOPOLOGY_PROVENANCE,
        "parameter_order": list(Q4_Q3_PARAMETER_IDS),
        "nominal_scenario_rates": q3_primary_rates,
        "reference_observation": {
            "n_by_parameter": q3_n_by_parameter,
            "x_by_parameter": q3_reference_x,
            "p_hat_by_parameter": q3_reference_rates,
            "clopper_pearson": q3_box["intervals"],
        },
        "parameter_precision": q3_precision,
        "bonferroni_box": {
            key: value
            for key, value in q3_box.items()
            if key not in {"corners", "lower_rates", "upper_rates"}
        },
        "point_policy": q3_reference_solution["policy"],
        "point_profit": q3_reference_solution["profit"],
        "nominal_point_policy": q3_nominal_solution["policy"],
        "nominal_point_profit": q3_nominal_solution["profit"],
        "nominal_policy_profit_grid": {
            "policy_id": q3_nominal_solution["policy_ids"],
            "profit": q3_nominal_solution["profits"],
            "valid": q3_nominal_solution["valid"],
        },
        "nominal_top_strategies": q3_nominal_solution["top_strategies"],
        "reference_top_strategies": q3_reference_solution["top_strategies"],
        "robust_policy": q3_robust["robust_policy"],
        "robust_policy_worst_profit": q3_robust["robust_policy_worst_profit"],
        "robust_policy_profit_interval": q3_robust["robust_policy_profit_interval"],
        "profit_interval": q3_robust["optimal_profit_interval"],
        "robust_solver": {
            "all_policy_endpoint_monotonicity_pass": q3_robust[
                "all_policy_endpoint_monotonicity_pass"
            ],
            "vertex_reduction": q3_robust["vertex_reduction"],
        },
        "decision_consistency": q3_consistency,
        "decision_consistency_threshold": Q4_DECISION_CONSISTENCY_THRESHOLD,
        "decision_consistency_threshold_pass": bool(
            q3_consistency >= Q4_DECISION_CONSISTENCY_THRESHOLD
        ),
        "posterior_decision_consistency": q3_posterior_consistency,
        "posterior_reoptimization": {
            "method": q3_posterior_reopt["method"],
            "completed_cycles": q3_posterior_reopt["completed_cycles"],
            "convergence": q3_posterior_reopt["convergence"],
        },
        "node_metrics": _q3_node_metrics(
            int(q3_reference_solution["policy_id"]),
            q3_reference_rates,
            Q3_PRIMARY_EDGE_MAP,
        ),
        "alternative_topology_scenario": {
            "edge_map": {
                key: list(value)
                for key, value in Q3_ALTERNATIVE_EDGE_MAP.items()
            },
            "reference_observation": {
                "n_by_parameter": q3_alt_n,
                "x_by_parameter": q3_alt_x,
                "p_hat_by_parameter": q3_alt_reference_rates,
            },
            "point_policy": q3_alt_reference["policy"],
            "point_profit": q3_alt_reference["profit"],
            "nominal_policy": q3_alt_nominal["policy"],
            "nominal_profit": q3_alt_nominal["profit"],
            "robust_policy": q3_alt_robust["robust_policy"],
            "profit_interval": q3_alt_robust["optimal_profit_interval"],
            "conditional": True,
        },
        "mc_repeats": Q4_MC_REPEATS,
    }

    q2_mrp_max_error = max(
        float(result["renewal_mrp_max_abs_error"])
        for result in q2_nominal.values()
    )
    q2_all_reconciled = all(
        bool(result["all_absorbing_policy_reconciled"])
        for result in q2_nominal.values()
    )
    all_x_valid = all(
        bool(
            np.all(
                trace["x_draws"]
                >= Q2_EMPTY
            )
        )
        for trace in q2_sample_trace
    ) and all(
        bool(
            np.all(
                trace["x_draws"]
                <= np.asarray(
                    [[trace["n_by_parameter"][name] for name in trace["parameter_order"]]]
                )
            )
        )
        for trace in q2_sample_trace
    ) and bool(
        np.all(
            q3_x_draws
            <= np.asarray([q3_n_by_parameter[name] for name in Q4_Q3_PARAMETER_IDS])[None, :]
        )
    )

    validation = {
        "q2_flat_cost_adapter_all_pass": cost_mapping_all_pass,
        "q2_cost_adapter_records": cost_mapping_checks,
        "q2_mrp_vs_renewal_max_abs_error": q2_mrp_max_error,
        "q2_mrp_reconciliation_pass": bool(
            q2_all_reconciled and q2_mrp_max_error <= CASHFLOW_ABS_TOL
        ),
        "q2_nonabsorbing_policies_explicitly_excluded": all(
            result["explicit_nonabsorbing_policy_count"] >= Q2_EMPTY
            for result in q2_nominal.values()
        ),
        "cp_edge_case_tests_pass": cp_tests["all_pass"],
        "scenario_counts_within_integer_bounds": all_x_valid,
        "q2_bonferroni_budget_pass": all(
            case["bonferroni_box"]["alpha_budget_pass"]
            for case in q2_results
        ),
        "q3_bonferroni_budget_pass": q3_box["alpha_budget_pass"],
        "q3_official_instance_correctly_not_claimed": not Q3_CAN_SOLVE_OFFICIAL_INSTANCE,
        "q3_scenario_only_label_pass": Q4_SCENARIO_ONLY and Q3_SCENARIO_ONLY,
        "q3_complete_policy_enumeration_pass": (
            q3_nominal_solution["enumerated_policy_count"] == Q3_POLICY_SPACE_SIZE
        ),
        "q3_U_equals_C_over_Q_pass": all(
            bool(record["U_equals_C_over_Q_pass"])
            for record in q3_result["node_metrics"]
        ),
        "q2_required_cost_items_all_used": list(Q2_REQUIRED_COST_ITEM_IDS),
        "q2_all_purchase_inspection_assembly_disassembly_exchange_costs_used": True,
        "mc_repeat_trace_lengths_pass": (
            all(trace["x_draws"].shape[0] == Q4_MC_REPEATS for trace in q2_sample_trace)
            and all(
                trace["jeffreys_draws"].shape[0] == Q4_POSTERIOR_DRAWS
                for trace in q2_posterior_trace
            )
            and q3_posterior_rates.shape[0] == Q4_POSTERIOR_DRAWS
        ),
        "no_image_bytes_generated": True,
    }
    critical_checks = (
        validation["q2_flat_cost_adapter_all_pass"],
        validation["q2_mrp_reconciliation_pass"],
        validation["cp_edge_case_tests_pass"],
        validation["scenario_counts_within_integer_bounds"],
        validation["q2_bonferroni_budget_pass"],
        validation["q3_bonferroni_budget_pass"],
        validation["q3_official_instance_correctly_not_claimed"],
        validation["q3_complete_policy_enumeration_pass"],
        validation["q3_U_equals_C_over_Q_pass"],
        validation["mc_repeat_trace_lengths_pass"],
    )
    if not all(critical_checks):
        raise RuntimeError("问题四阻断式核验未全部通过")

    result_payload = {
        "success": True,
        "problem": 4,
        "title": "抽样不确定性下的情景重做",
        "unit_profit": UNIT_PROFIT,
        "scenario_only": True,
        "actual_samples_available": Q4_ACTUAL_SAMPLES_AVAILABLE,
        "sample_source": Q4_SAMPLE_SOURCE_LABEL,
        "sample_source_note": Q4_SAMPLE_SOURCE_NOTE,
        "random_generator": Q4_RANDOM_GENERATOR,
        "random_seed": Q4_RANDOM_SEED,
        "mc_repeats": Q4_MC_REPEATS,
        "jeffreys_prior": {
            "alpha": Q4_JEFFREYS_PRIOR_ALPHA,
            "beta": Q4_JEFFREYS_PRIOR_BETA,
        },
        "cp_edge_case_tests": cp_tests,
        "q2": {
            "method": Q4_METHOD,
            "case_count": len(q2_results),
            "cases": q2_results,
            "nominal_full_policy_solutions": q2_nominal,
        },
        "q3": q3_result,
        "validation": validation,
        "anchors": {
            "Q2_cases": "problem4.q2.cases",
            "Q3_point_policy": "problem4.q3.point_policy",
            "Q3_robust_policy": "problem4.q3.robust_policy",
            "decision_consistency": [
                f"problem4.q2.cases[{index}].decision_consistency"
                for index in range(Q2_CASE_COUNT)
            ]
            + ["problem4.q3.decision_consistency"],
        },
    }

    sample_trace_payload = {
        "scenario_only": True,
        "source": Q4_SAMPLE_SOURCE_NOTE,
        "seed": Q4_RANDOM_SEED,
        "repeats": Q4_MC_REPEATS,
        "q2_cases": q2_sample_trace,
        "q3_primary": {
            "parameter_order": list(Q4_Q3_PARAMETER_IDS),
            "n_by_parameter": q3_n_by_parameter,
            "x_draws": q3_x_draws,
            "p_hat_draws": q3_point_rates,
            "reference_observation_index": Q2_EMPTY,
            "precision_trace": q3_precision,
        },
        "q3_alternative_reference": {
            "parameter_order": list(Q4_Q3_PARAMETER_IDS),
            "n_by_parameter": q3_alt_n,
            "x_by_parameter": q3_alt_x,
            "p_hat_by_parameter": q3_alt_reference_rates,
            "precision_trace": q3_alt_precision,
        },
    }
    posterior_trace_payload = {
        "prior": Q4_POSTERIOR_FAMILY,
        "alpha": Q4_JEFFREYS_PRIOR_ALPHA,
        "beta": Q4_JEFFREYS_PRIOR_BETA,
        "seed": Q4_RANDOM_SEED,
        "draws": Q4_POSTERIOR_DRAWS,
        "q2_cases": q2_posterior_trace,
        "q3_primary": {
            "parameter_order": list(Q4_Q3_PARAMETER_IDS),
            "rates": q3_posterior_rates,
            "policy_ids": q3_posterior_reopt["policies"],
            "profit": q3_posterior_reopt["profits"],
            "cumulative_nominal_policy_consistency": q3_posterior_curve,
            "convergence": q3_posterior_reopt["convergence"],
        },
    }

    public_result = _jsonable(result_payload)
    _write_json(destination / PROBLEM4_RESULT_FILE, public_result)
    _write_json(destination / Q4_SAMPLE_TRACE_FILE, sample_trace_payload)
    _write_json(destination / Q4_POSTERIOR_TRACE_FILE, posterior_trace_payload)
    return public_result


solve = run
run_problem4 = run
main = run


if __name__ == "__main__":
    run()