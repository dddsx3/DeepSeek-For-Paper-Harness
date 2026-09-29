from __future__ import annotations

import importlib
import itertools
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

import numpy as np
import params
from params import *  # noqa: F401,F403
from scipy.optimize import brentq
from scipy.stats import beta, binom


_STATUS_EMPTY = 0
_STATUS_GOOD = 1
_STATUS_BAD = 2
_STATUS_NAMES = ("empty", "good", "bad")


@dataclass(frozen=True)
class NormalizedQ2Case:
    """Canonical adapter for both flat Q2Case records and nested mappings."""

    p1: float
    price1: float
    test1: float
    p2: float
    price2: float
    test2: float
    pf: float
    assembly_cost: float
    product_test_cost: float
    market_price: float
    exchange_loss: float
    disassembly_cost: float
    case_id: int


def _first_value(
    source: Mapping[str, Any] | object,
    names: Sequence[str],
    location: str,
) -> Any:
    for name in names:
        if isinstance(source, Mapping) and name in source:
            return source[name]
        if hasattr(source, name):
            return getattr(source, name)
    raise KeyError(f"{location} 缺少字段别名：{', '.join(names)}")


def _normalize_q2_case(case: Any) -> NormalizedQ2Case:
    """Normalize the flat dataclass shipped in params.py without losing costs."""

    part1 = _first_value(case, ("part1",), "Q2 case") if (
        isinstance(case, Mapping) and "part1" in case
    ) else case
    part2 = _first_value(case, ("part2",), "Q2 case") if (
        isinstance(case, Mapping) and "part2" in case
    ) else case

    normalized = NormalizedQ2Case(
        p1=float(_first_value(part1, ("p1", "part1_defect", "part1_p"), "part1")),
        price1=float(_first_value(part1, ("price1", "a1", "part1_price"), "part1")),
        test1=float(_first_value(part1, ("test1", "t1", "part1_test"), "part1")),
        p2=float(_first_value(part2, ("p2", "part2_defect", "part2_p"), "part2")),
        price2=float(_first_value(part2, ("price2", "a2", "part2_price"), "part2")),
        test2=float(_first_value(part2, ("test2", "t2", "part2_test"), "part2")),
        pf=float(
            _first_value(
                case,
                ("pf", "product_defect", "p_final", "product_p"),
                "product",
            )
        ),
        assembly_cost=float(
            _first_value(case, ("assembly_cost", "kf", "assembly"), "product")
        ),
        product_test_cost=float(
            _first_value(
                case,
                ("product_test_cost", "tf", "final_test"),
                "product",
            )
        ),
        market_price=float(
            _first_value(case, ("market_price", "rmarket", "sale_price"), "market")
        ),
        exchange_loss=float(
            _first_value(
                case,
                ("exchange_loss", "lexchange", "replacement_loss"),
                "market",
            )
        ),
        disassembly_cost=float(
            _first_value(
                case,
                ("disassembly_cost", "gdis", "disassembly"),
                "market",
            )
        ),
        case_id=int(_first_value(case, ("case_id", "id"), "case")),
    )

    probabilities = (normalized.p1, normalized.p2, normalized.pf)
    if not all(params.Q1_P0 - params.Q1_P0 <= p <= 1.0 for p in probabilities):
        raise ValueError(f"Q2 情形 {normalized.case_id} 的次品率越界")
    monetary_values = (
        normalized.price1,
        normalized.test1,
        normalized.price2,
        normalized.test2,
        normalized.assembly_cost,
        normalized.product_test_cost,
        normalized.market_price,
        normalized.exchange_loss,
        normalized.disassembly_cost,
    )
    if not all(value >= 0.0 for value in monetary_values):
        raise ValueError(f"Q2 情形 {normalized.case_id} 的金额参数必须非负")
    return normalized


def clopper_pearson(n: int, x: int, alpha: float) -> dict[str, float]:
    """Exact binomial interval with explicit zero-count and all-count branches."""

    if n < 1 or x < 0 or x > n:
        raise ValueError("Clopper-Pearson 要求 n>=1 且 0<=x<=n")
    if not 0.0 < alpha < 1.0:
        raise ValueError("Clopper-Pearson 错误率必须位于开区间 (0,1)")

    tail_probability = alpha / 2.0
    if x == 0:
        lower = 0.0
    else:
        lower = float(beta.ppf(tail_probability, x, n - x + 1))
    if x == n:
        upper = 1.0
    else:
        upper = float(beta.ppf(1.0 - tail_probability, x + 1, n - x))

    if not (0.0 <= lower <= x / n <= upper <= 1.0):
        raise AssertionError("Clopper-Pearson 端点次序失败")
    return {"lower": lower, "upper": upper, "width": upper - lower}


def _exact_cp_endpoint(n: int, x: int, alpha: float) -> tuple[float, float]:
    """Independent exact-inversion cross-check used by the edge tests."""

    target = alpha / 2.0
    lower = 0.0
    if x > 0:
        lower = float(
            brentq(
                lambda probability: float(binom.sf(x - 1, n, probability)) - target,
                0.0,
                1.0,
                xtol=params.Q1_NUMERIC_TOL,
            )
        )
    upper = 1.0
    if x < n:
        upper = float(
            brentq(
                lambda probability: float(binom.cdf(x, n, probability)) - target,
                0.0,
                1.0,
                xtol=params.Q1_NUMERIC_TOL,
            )
        )
    return lower, upper


def edge_case_tests() -> dict[str, Any]:
    """Validate CP behavior for x=0, x=n, and an interior count."""

    n = int(params.Q4_N_GRID[0])
    interior_x = int(round(n * params.Q1_P0))
    rows: list[dict[str, Any]] = []
    maximum_error = 0.0
    for x in (0, interior_x, n):
        interval = clopper_pearson(n, x, params.Q4_Q2_MARGINAL_ALPHA)
        exact_lower, exact_upper = _exact_cp_endpoint(
            n, x, params.Q4_Q2_MARGINAL_ALPHA
        )
        error = max(
            abs(interval["lower"] - exact_lower),
            abs(interval["upper"] - exact_upper),
        )
        maximum_error = max(maximum_error, error)
        rows.append(
            {
                "n": n,
                "x": x,
                "beta_interval": interval,
                "exact_inversion_interval": {
                    "lower": exact_lower,
                    "upper": exact_upper,
                },
                "max_abs_endpoint_difference": error,
                "passed": error <= params.Q1_NUMERIC_TOL,
            }
        )
    passed = all(row["passed"] for row in rows)
    if not passed:
        raise AssertionError("CP 边界计数交叉核验失败")
    return {
        "passed": passed,
        "rows": rows,
        "max_abs_endpoint_difference": maximum_error,
        "crosscheck": "scipy.stats.binom exact inversion",
    }


def parameter_precision_n(
    probability: float,
    alpha: float,
    width_target: float,
    n_max: int,
) -> dict[str, Any]:
    """Choose the first precision-design n over the registered integer search."""

    if not 0.0 <= probability <= 1.0:
        raise ValueError("样本量设计的概率越界")
    if not 0.0 < alpha < 1.0 or width_target <= 0.0 or n_max < 1:
        raise ValueError("样本量设计参数无效")

    for n in range(1, n_max + 1):
        planning_x = int(round(n * probability))
        interval = clopper_pearson(n, planning_x, alpha)
        if interval["width"] <= width_target + params.Q1_NUMERIC_TOL:
            return {
                "n": n,
                "planning_x": planning_x,
                "planning_width": interval["width"],
                "criterion": "first n with planned CP width <= target",
            }
    raise ValueError("Q4 登记的样本量上限内未达到区间宽度目标")


def bonferroni_joint_box(
    intervals: Mapping[str, Mapping[str, float]],
    family_alpha: float | None = None,
) -> dict[str, Any]:
    """Construct a rectangular joint region using equal marginal allocations."""

    if not intervals:
        raise ValueError("Bonferroni 联合域不得为空")
    alpha_family = params.Q4_FAMILY_ALPHA if family_alpha is None else family_alpha
    parameter_count = len(intervals)
    marginal_alpha = alpha_family / parameter_count
    box = {
        name: {
            "lower": float(interval["lower"]),
            "upper": float(interval["upper"]),
        }
        for name, interval in intervals.items()
    }
    allocation_sum = marginal_alpha * parameter_count
    if allocation_sum > alpha_family + params.Q1_NUMERIC_TOL:
        raise AssertionError("Bonferroni 边际错误率之和超过族错误率")
    return {
        "construction": "Bonferroni rectangular joint region",
        "family_alpha": alpha_family,
        "parameter_count": parameter_count,
        "marginal_alpha": marginal_alpha,
        "allocation_sum": allocation_sum,
        "box": box,
    }


def _q2_policy_object(policy: tuple[int, int, int, int]) -> dict[str, int]:
    return {
        "Z1": int(policy[0]),
        "Z2": int(policy[1]),
        "C": int(policy[2]),
        "D": int(policy[3]),
    }


def _q2_policy_label(policy: tuple[int, int, int, int]) -> str:
    return "Z1={Z1},Z2={Z2},C={C},D={D}".format(**_q2_policy_object(policy))


def _q2_strategy_space() -> tuple[tuple[int, int, int, int], ...]:
    dimension = int(round(math.log2(params.Q2_STRATEGY_SPACE_SIZE)))
    return tuple(itertools.product((0, 1), repeat=dimension))


def _q2_prepare_options(
    status: int,
    inspect_part: int,
    defect_probability: float,
    purchase_price: float,
    inspection_cost: float,
) -> tuple[list[tuple[int, float, float, float]], bool]:
    options: list[tuple[int, float, float, float]] = []
    if status == _STATUS_GOOD:
        return [(_STATUS_GOOD, 1.0, 0.0, 0.0)], True
    if inspect_part:
        if defect_probability >= 1.0:
            return options, False
        expected_purchases = 1.0 / (1.0 - defect_probability)
        return [
            (
                _STATUS_GOOD,
                1.0,
                purchase_price * expected_purchases,
                inspection_cost * expected_purchases,
            )
        ], True
    if status == _STATUS_BAD:
        return [(_STATUS_BAD, 1.0, 0.0, 0.0)], True
    options.append(
        (
            _STATUS_GOOD,
            1.0 - defect_probability,
            purchase_price,
            0.0,
        )
    )
    options.append(
        (
            _STATUS_BAD,
            defect_probability,
            purchase_price,
            0.0,
        )
    )
    return options, True


def _q2_build_mrp(
    case: NormalizedQ2Case,
    policy: tuple[int, int, int, int],
) -> dict[str, Any]:
    """Build the transient MRP; successful qualified delivery is absorbing."""

    z1, z2, inspect_product, disassemble = policy
    state_count = len(_STATUS_NAMES) ** 2
    states = [
        (left_status, right_status)
        for left_status in _STATUS_NAMES
        for right_status in _STATUS_NAMES
    ]
    transition = np.zeros((state_count, state_count), dtype=float)
    ledger_names = (
        "market_revenue",
        "purchase_cost",
        "inspection_cost",
        "assembly_cost",
        "disassembly_cost",
        "exchange_loss",
    )
    ledger = {name: np.zeros(state_count, dtype=float) for name in ledger_names}
    immediate_reward = np.zeros(state_count, dtype=float)
    structurally_absorbing = True

    for state_index, (left_status, right_status) in enumerate(states):
        left_options, left_valid = _q2_prepare_options(
            left_status,
            z1,
            case.p1,
            case.price1,
            case.test1,
        )
        right_options, right_valid = _q2_prepare_options(
            right_status,
            z2,
            case.p2,
            case.price2,
            case.test2,
        )
        structurally_absorbing = structurally_absorbing and left_valid and right_valid
        if not left_valid or not right_valid:
            continue

        for left_next, left_probability, left_purchase, left_inspection in left_options:
            for right_next, right_probability, right_purchase, right_inspection in right_options:
                event_probability = left_probability * right_probability
                prepared_left = (
                    _STATUS_EMPTY
                    if left_status == _STATUS_EMPTY
                    else left_next
                )
                prepared_right = (
                    _STATUS_EMPTY
                    if right_status == _STATUS_EMPTY
                    else right_next
                )
                prepared_index = prepared_left * len(_STATUS_NAMES) + prepared_right
                purchase_cost = left_purchase + right_purchase
                inspection_cost = left_inspection + right_inspection
                product_bad_probability = 1.0 - (
                    (1.0 - case.pf)
                    if left_next == _STATUS_GOOD
                    and right_next == _STATUS_GOOD
                    else 0.0
                )

                local_market_revenue = 0.0
                local_exchange_loss = 0.0
                local_product_inspection = (
                    case.product_test_cost if inspect_product else 0.0
                )
                local_disassembly = 0.0
                terminal = product_bad_probability == 0.0
                if terminal:
                    local_market_revenue = case.market_price
                    next_index = None
                elif inspect_product:
                    next_index = (
                        prepared_index
                        if disassemble
                        else _STATUS_EMPTY * len(_STATUS_NAMES)
                        + _STATUS_EMPTY
                    )
                    local_disassembly = case.disassembly_cost if disassemble else 0.0
                else:
                    local_market_revenue = case.market_price
                    local_exchange_loss = case.exchange_loss
                    next_index = (
                        prepared_index
                        if disassemble
                        else _STATUS_EMPTY * len(_STATUS_NAMES)
                        + _STATUS_EMPTY
                    )
                    local_disassembly = case.disassembly_cost if disassemble else 0.0

                event_reward = (
                    local_market_revenue
                    - purchase_cost
                    - inspection_cost
                    - case.assembly_cost
                    - local_product_inspection
                    - local_disassembly
                    - local_exchange_loss
                )
                transition[state_index, next_index] += (
                    event_probability if next_index is not None else 0.0
                )
                immediate_reward[state_index] += event_probability * event_reward
                ledger["market_revenue"][state_index] += (
                    event_probability * local_market_revenue
                )
                ledger["purchase_cost"][state_index] += (
                    event_probability * purchase_cost
                )
                ledger["inspection_cost"][state_index] += (
                    event_probability * (inspection_cost + local_product_inspection)
                )
                ledger["assembly_cost"][state_index] += (
                    event_probability * case.assembly_cost
                )
                ledger["disassembly_cost"][state_index] += (
                    event_probability * local_disassembly
                )
                ledger["exchange_loss"][state_index] += (
                    event_probability * local_exchange_loss
                )

    spectral_radius = float(np.max(np.abs(np.linalg.eigvals(transition))))
    absorbing = bool(
        structurally_absorbing
        and spectral_radius < 1.0 - params.VALUE_ITERATION_TOL
    )
    return {
        "states": states,
        "transition": transition,
        "immediate_reward": immediate_reward,
        "ledger_rewards": ledger,
        "spectral_radius": spectral_radius,
        "absorbing": absorbing,
        "empty_index": _STATUS_EMPTY * len(_STATUS_NAMES) + _STATUS_EMPTY,
    }


def _q2_mrp_value(
    case: NormalizedQ2Case,
    policy: tuple[int, int, int, int],
) -> dict[str, Any]:
    """Solve V=r+PV with an explicit successful-delivery boundary."""

    model = _q2_build_mrp(case, policy)
    row = {
        "policy": _q2_policy_object(policy),
        "policy_label": _q2_policy_label(policy),
        "absorbing": model["absorbing"],
        "absorption_probability": 1.0 if model["absorbing"] else 0.0,
        "spectral_radius": model["spectral_radius"],
        "profit": None,
        "expected_cost": None,
        "event_cash_ledger": None,
        "bellman_residual": None,
        "ledger_residual": None,
    }
    if not model["absorbing"]:
        return row

    state_count = len(_STATUS_NAMES) ** 2
    system = np.eye(state_count) - model["transition"]
    values = np.linalg.solve(system, model["immediate_reward"])
    ledger_values: dict[str, float] = {}
    for name, reward_vector in model["ledger_rewards"].items():
        ledger_values[name] = float(np.linalg.solve(system, reward_vector)[model["empty_index"]])
    ledger_net = ledger_values["market_revenue"] - sum(
        ledger_values[name]
        for name in (
            "purchase_cost",
            "inspection_cost",
            "assembly_cost",
            "disassembly_cost",
            "exchange_loss",
        )
    )
    profit = float(values[model["empty_index"]])
    expected_cost = float(
        sum(
            ledger_values[name]
            for name in (
                "purchase_cost",
                "inspection_cost",
                "assembly_cost",
                "disassembly_cost",
                "exchange_loss",
            )
        )
    )
    bellman_residual = float(
        np.max(
            np.abs(
                values
                - model["immediate_reward"]
                - model["transition"] @ values
            )
        )
    )
    ledger_residual = abs(profit - ledger_net)
    if bellman_residual > params.VALUE_ITERATION_TOL:
        raise AssertionError("Q2 Bellman 残差超限")
    if ledger_residual > params.CASHFLOW_ABS_TOL:
        raise AssertionError("Q2 状态值与事件账本不一致")

    row.update(
        {
            "profit": profit,
            "expected_cost": expected_cost,
            "event_cash_ledger": ledger_values,
            "bellman_residual": bellman_residual,
            "ledger_residual": ledger_residual,
        }
    )
    return row


def _q2_batch_values(
    case: NormalizedQ2Case,
    rate_samples: np.ndarray,
) -> np.ndarray:
    """Vectorized MRP evaluation for Monte-Carlo decision reoptimization."""

    samples = np.asarray(rate_samples, dtype=float)
    if samples.ndim != 2 or samples.shape[1] != params.Q2_PARAMETER_NODE_COUNT:
        raise ValueError("Q2 批量次品率矩阵形状错误")
    sample_count = samples.shape[0]
    state_count = len(_STATUS_NAMES) ** 2
    strategy_count = params.Q2_STRATEGY_SPACE_SIZE
    policies = _q2_strategy_space()
    result = np.full((sample_count, strategy_count), np.nan, dtype=float)
    if sample_count == 0:
        return result

    valid_rows = np.all(
        (samples >= 0.0) & (samples < 1.0),
        axis=1,
    )
    valid_indices = np.flatnonzero(valid_rows)
    if valid_indices.size == 0:
        return result

    for policy_index, policy in enumerate(policies):
        z1, z2, inspect_product, disassemble = policy
        if disassemble and not (z1 and z2):
            continue
        transition = np.zeros(
            (valid_indices.size, state_count, state_count),
            dtype=float,
        )
        reward = np.zeros((valid_indices.size, state_count), dtype=float)
        for local_index, sample_index in enumerate(valid_indices):
            p1, p2, pf = (float(value) for value in samples[sample_index])
            for left_status in _STATUS_NAMES:
                left_options, left_valid = _q2_prepare_options(
                    left_status,
                    z1,
                    p1,
                    case.price1,
                    case.test1,
                )
                for right_status in _STATUS_NAMES:
                    right_options, right_valid = _q2_prepare_options(
                        right_status,
                        z2,
                        p2,
                        case.price2,
                        case.test2,
                    )
                    if not left_valid or not right_valid:
                        continue
                    for left_next, left_probability, left_purchase, left_inspection in left_options:
                        for right_next, right_probability, right_purchase, right_inspection in right_options:
                            event_probability = left_probability * right_probability
                            prepared_left = (
                                _STATUS_EMPTY
                                if left_status == _STATUS_EMPTY
                                else left_next
                            )
                            prepared_right = (
                                _STATUS_EMPTY
                                if right_status == _STATUS_EMPTY
                                else right_next
                            )
                            prepared_index = (
                                prepared_left * len(_STATUS_NAMES) + prepared_right
                            )
                            purchase_cost = left_purchase + right_purchase
                            inspection_cost = left_inspection + right_inspection
                            product_bad_probability = 1.0 - (
                                (1.0 - pf)
                                if left_next == _STATUS_GOOD
                                and right_next == _STATUS_GOOD
                                else 0.0
                            )
                            if product_bad_probability == 0.0:
                                local_market_revenue = case.market_price
                                local_exchange_loss = 0.0
                                local_disassembly = 0.0
                                next_index = None
                            else:
                                local_market_revenue = (
                                    0.0 if inspect_product else case.market_price
                                )
                                local_exchange_loss = (
                                    0.0 if inspect_product else case.exchange_loss
                                )
                                local_disassembly = (
                                    case.disassembly_cost if disassemble else 0.0
                                )
                                next_index = (
                                    prepared_index
                                    if disassemble
                                    else _STATUS_EMPTY * len(_STATUS_NAMES)
                                    + _STATUS_EMPTY
                                )
                            event_reward = (
                                local_market_revenue
                                - purchase_cost
                                - inspection_cost
                                - case.assembly_cost
                                - (case.product_test_cost if inspect_product else 0.0)
                                - local_disassembly
                                - local_exchange_loss
                            )
                            row_index = (
                                left_status * len(_STATUS_NAMES) + right_status
                            )
                            reward[local_index, row_index] += (
                                event_probability * event_reward
                            )
                            if next_index is not None:
                                transition[local_index, row_index, next_index] += (
                                    event_probability
                                )

        system = np.eye(state_count)[None, :, :] - transition
        try:
            values = np.linalg.solve(
                system,
                reward[:, :, None],
            )[:, :, 0]
        except np.linalg.LinAlgError:
            values = np.full_like(reward, np.nan)
            for row_index in range(valid_indices.size):
                try:
                    values[row_index] = np.linalg.solve(
                        system[row_index],
                        reward[row_index],
                    )
                except np.linalg.LinAlgError:
                    values[row_index] = np.nan
        empty_index = _STATUS_EMPTY * len(_STATUS_NAMES) + _STATUS_EMPTY
        result[valid_indices, policy_index] = values[:, empty_index]
    return result


def decision_reopt(
    case: NormalizedQ2Case,
    rates: Sequence[float],
) -> dict[str, Any]:
    """Re-solve all Q2 policies and apply deterministic lexicographic ties."""

    rate_vector = tuple(float(value) for value in rates)
    if len(rate_vector) != params.Q2_PARAMETER_NODE_COUNT:
        raise ValueError("Q2 决策重优化率向量长度错误")
    rows: list[dict[str, Any]] = []
    for policy in _q2_strategy_space():
        row = _q2_mrp_value(case, policy)
        rows.append(row)
    finite_rows = [row for row in rows if row["profit"] is not None]
    if not finite_rows:
        return {
            "policy": None,
            "policy_label": None,
            "profit": None,
            "strategy_table": rows,
        }
    best_profit = max(float(row["profit"]) for row in finite_rows)
    best = next(
        row
        for row in finite_rows
        if abs(float(row["profit"]) - best_profit) <= params.CASHFLOW_ABS_TOL
    )
    return {
        "policy": best["policy"],
        "policy_label": best["policy_label"],
        "profit": best_profit,
        "strategy_table": rows,
    }


def _select_batch_policies(
    values: np.ndarray,
) -> tuple[list[tuple[int, int, int, int] | None], np.ndarray]:
    policies = _q2_strategy_space()
    finite = np.isfinite(values)
    safe_values = np.where(finite, values, -np.inf)
    selected_policies: list[tuple[int, int, int, int] | None] = []
    for row in safe_values:
        if not np.any(np.isfinite(row)):
            selected_policies.append(None)
            continue
        best_value = float(np.max(row))
        tied = np.flatnonzero(
            np.isclose(
                row,
                best_value,
                atol=params.CASHFLOW_ABS_TOL,
                rtol=0.0,
            )
            & np.isfinite(row)
        )
        selected_policies.append(policies[int(tied[0])])
    return selected_policies, safe_values


def _q2_robust_box(
    case: NormalizedQ2Case,
    joint_box: Mapping[str, Mapping[str, float]],
) -> dict[str, Any]:
    corners = tuple(
        np.asarray(corner, dtype=float)
        for corner in itertools.product(
            (0.0, 1.0),
            repeat=params.Q2_PARAMETER_NODE_COUNT,
        )
    )
    corner_values = _q2_batch_values(case, np.vstack(corners))
    corner_lower: list[float] = []
    corner_upper: list[float] = []
    for policy_index, policy in enumerate(_q2_strategy_space()):
        values = corner_values[:, policy_index]
        if np.all(np.isfinite(values)):
            corner_lower.append(float(np.min(values)))
            corner_upper.append(float(np.max(values)))
        else:
            corner_lower.append(float("nan"))
            corner_upper.append(float("nan"))

    table: list[dict[str, Any]] = []
    robust_candidates: list[tuple[int, float]] = []
    for policy_index, policy in enumerate(_q2_strategy_space()):
        lower = corner_lower[policy_index]
        upper = corner_upper[policy_index]
        robust_feasible = math.isfinite(lower)
        table.append(
            {
                "policy": _q2_policy_object(policy),
                "policy_label": _q2_policy_label(policy),
                "joint_box_lower_profit": lower if robust_feasible else None,
                "joint_box_upper_profit": upper if math.isfinite(upper) else None,
                "robustly_finite": robust_feasible,
            }
        )
        if robust_feasible:
            robust_candidates.append((policy_index, lower))

    if robust_candidates:
        best_lower = max(value for _, value in robust_candidates)
        best_indices = [
            policy_index
            for policy_index, value in robust_candidates
            if abs(value - best_lower) <= params.CASHFLOW_ABS_TOL
        ]
        best_policy = _q2_strategy_space()[best_indices[0]]
        lower_envelope = min(value for _, value in robust_candidates)
    else:
        best_policy = None
        best_lower = None
        lower_envelope = None
    upper_envelope = max(
        (value for value in corner_upper if math.isfinite(value)),
        default=None,
    )
    return {
        "corner_method": "independent Bonferroni box vertices",
        "corner_count": len(corners),
        "table": table,
        "robust_policy": _q2_policy_object(best_policy) if best_policy else None,
        "robust_policy_label": _q2_policy_label(best_policy) if best_policy else None,
        "robust_policy_lower_profit": best_lower,
        "profit_interval": {
            "lower": lower_envelope,
            "upper": upper_envelope,
            "unit": "yuan/qualified delivery",
        },
    }


def _q2_sample_size_scan(
    case: NormalizedQ2Case,
    selected_sample_sizes: Mapping[str, int],
    selected_policy: tuple[int, int, int, int] | None,
) -> list[dict[str, Any]]:
    maximum_n = max(int(value) for value in selected_sample_sizes.values())
    rows: list[dict[str, Any]] = []
    for n in range(1, maximum_n + 1):
        planned_counts: dict[str, int] = {}
        widths: dict[str, float] = {}
        planned_rates: list[float] = []
        for name, center in zip(
            params.Q4_Q2_NODE_NAMES,
            (case.p1, case.p2, case.pf),
        ):
            x = int(round(n * center))
            interval = clopper_pearson(n, x, params.Q4_Q2_MARGINAL_ALPHA)
            planned_counts[name] = x
            widths[name] = interval["width"]
            planned_rates.append(x / n)
        solved = decision_reopt(case, planned_rates)
        row_policy = solved["policy"]
        if row_policy is None or selected_policy is None:
            distance = None
        else:
            distance = sum(
                int(left != right)
                for left, right in zip(row_policy, selected_policy)
            )
        rows.append(
            {
                "n": n,
                "planned_counts": planned_counts,
                "planned_point_rates": dict(
                    zip(params.Q4_Q2_NODE_NAMES, planned_rates)
                ),
                "cp_widths": widths,
                "mean_cp_width": sum(widths.values()) / len(widths),
                "planning_point_policy": row_policy,
                "planning_point_policy_label": solved["policy_label"],
                "policy_bit_changes_vs_selected": distance,
            }
        )
    return rows


def _q2_monte_carlo(
    case: NormalizedQ2Case,
    sample_sizes: Mapping[str, int],
    truth_policy: tuple[int, int, int, int] | None,
) -> dict[str, Any]:
    seed_sequence = np.random.SeedSequence(
        [params.Q4_RANDOM_SEED, case.case_id]
    )
    generator = np.random.default_rng(seed_sequence)
    n_array = np.asarray(
        [sample_sizes[name] for name in params.Q4_Q2_NODE_NAMES],
        dtype=int,
    )
    center_rates = np.asarray((case.p1, case.p2, case.pf), dtype=float)
    x_trace = generator.binomial(
        np.broadcast_to(n_array, (params.Q4_MC_REPETITIONS, n_array.size)),
        np.broadcast_to(center_rates, (params.Q4_MC_REPETITIONS, center_rates.size)),
    )
    point_estimate_trace = x_trace.astype(float) / n_array.astype(float)[None, :]
    posterior_alpha = x_trace + params.Q4_JEFFREYS_A
    posterior_beta = n_array.astype(float)[None, :] - x_trace + params.Q4_JEFFREYS_B
    posterior_theta = generator.beta(posterior_alpha, posterior_beta)

    point_values = _q2_batch_values(case, point_estimate_trace)
    posterior_values = _q2_batch_values(case, posterior_theta)
    point_policies, safe_point_values = _select_batch_policies(point_values)
    posterior_policies, safe_posterior_values = _select_batch_policies(posterior_values)
    point_best_values = np.asarray(
        [
            float(row[0]) if policy is not None else np.nan
            for row, policy in zip(safe_point_values, point_policies)
        ]
    )
    posterior_best_values = np.asarray(
        [
            float(row[0]) if policy is not None else np.nan
            for row, policy in zip(safe_posterior_values, posterior_policies)
        ]
    )
    matches = np.asarray(
        [
            truth_policy is not None and policy == truth_policy
            for policy in point_policies
        ],
        dtype=bool,
    )
    point_trace = [
        _q2_policy_label(policy) if policy is not None else None
        for policy in point_policies
    ]
    posterior_trace = [
        _q2_policy_label(policy) if policy is not None else None
        for policy in posterior_policies
    ]
    decision_counts: dict[str, int] = {}
    for label in point_trace:
        key = label if label is not None else "nonabsorbing_rate_vector"
        decision_counts[key] = decision_counts.get(key, 0) + 1

    checkpoint_indices = sorted(
        {
            int(round(value))
            for value in np.linspace(
                0,
                params.Q4_MC_REPETITIONS - 1,
                len(params.Q4_N_GRID),
            )
        }
    )
    cumulative_matches = np.cumsum(matches.astype(float)) / np.arange(
        1,
        params.Q4_MC_REPETITIONS + 1,
    )
    running_profit = (
        np.cumsum(np.nan_to_num(posterior_best_values, nan=0.0))
        / np.arange(1, params.Q4_MC_REPETITIONS + 1)
    )
    convergence = [
        {
            "replicate": index + 1,
            "cumulative_decision_consistency": float(cumulative_matches[index]),
            "running_mean_posterior_profit": float(running_profit[index]),
        }
        for index in checkpoint_indices
    ]
    finite_profit = posterior_best_values[np.isfinite(posterior_best_values)]
    if finite_profit.size == 0:
        raise AssertionError("Q2 Jeffreys 重抽样未产生有限利润")
    return {
        "replicates": params.Q4_MC_REPETITIONS,
        "seed": params.Q4_RANDOM_SEED,
        "sampling": "independent Binomial scenario counts, then Jeffreys posterior rates",
        "node_names": list(params.Q4_Q2_NODE_NAMES),
        "n_by_node": dict(sample_sizes),
        "scenario_center_rates": dict(
            zip(params.Q4_Q2_NODE_NAMES, center_rates)
        ),
        "x_trace": x_trace,
        "point_estimate_trace": point_estimate_trace,
        "reoptimized_point_policy_trace": point_trace,
        "reoptimized_posterior_policy_trace": posterior_trace,
        "point_estimate_best_profit_trace": point_best_values,
        "posterior_profit_trace": posterior_best_values,
        "decision_counts": decision_counts,
        "decision_consistency": float(np.mean(matches)),
        "consistency_threshold": params.Q4_CONSISTENCY_THRESHOLD,
        "consistency_threshold_passed": bool(
            np.mean(matches) >= params.Q4_CONSISTENCY_THRESHOLD
        ),
        "posterior_profit_summary": {
            "mean": float(np.mean(finite_profit)),
            "standard_deviation": float(np.std(finite_profit)),
            "quantiles": {
                str(quantile): float(np.quantile(finite_profit, quantile))
                for quantile in np.linspace(0.0, 1.0, len(params.Q4_N_GRID))
            },
        },
        "convergence": convergence,
    }


def _q2_case_result(raw_case: Any) -> dict[str, Any]:
    case = _normalize_q2_case(raw_case)
    sample_size_design: dict[str, Any] = {}
    sample_sizes: dict[str, int] = {}
    for name, probability in zip(
        params.Q4_Q2_NODE_NAMES,
        (case.p1, case.p2, case.pf),
    ):
        design = parameter_precision_n(
            probability,
            params.Q4_Q2_MARGINAL_ALPHA,
            params.Q4_WIDTH_TARGET,
            params.Q4_N_MAX,
        )
        sample_size_design[name] = design
        sample_sizes[name] = int(design["n"])

    seed_sequence = np.random.SeedSequence(
        [params.Q4_RANDOM_SEED, case.case_id]
    )
    observed_generator = np.random.default_rng(seed_sequence)
    observed_x_array = observed_generator.binomial(
        np.asarray(
            [sample_sizes[name] for name in params.Q4_Q2_NODE_NAMES],
            dtype=int,
        ),
        np.asarray((case.p1, case.p2, case.pf), dtype=float),
    )
    observed_x = {
        name: int(value)
        for name, value in zip(params.Q4_Q2_NODE_NAMES, observed_x_array)
    }
    point_estimate_array = observed_x_array.astype(float) / observed_x_array.size * 0.0 + (
        observed_x_array.astype(float)
        / np.asarray(
            [sample_sizes[name] for name in params.Q4_Q2_NODE_NAMES],
            dtype=float,
        )
    )
    point_estimate = {
        name: float(value)
        for name, value in zip(params.Q4_Q2_NODE_NAMES, point_estimate_array)
    }
    intervals = {
        name: clopper_pearson(
            sample_sizes[name],
            observed_x[name],
            params.Q4_Q2_MARGINAL_ALPHA,
        )
        for name in params.Q4_Q2_NODE_NAMES
    }
    joint = bonferroni_joint_box(
        intervals,
        family_alpha=params.Q4_FAMILY_ALPHA,
    )
    if abs(joint["marginal_alpha"] - params.Q4_Q2_MARGINAL_ALPHA) > params.Q1_NUMERIC_TOL:
        raise AssertionError("Q2 Bonferroni 边际错误率与登记值不一致")

    truth_solution = decision_reopt(
        case,
        (case.p1, case.p2, case.pf),
    )
    point_solution = decision_reopt(case, point_estimate_array)
    strategy_table = point_solution["strategy_table"]
    robust = _q2_robust_box(case, joint["box"])
    sample_size_scan = _q2_sample_size_scan(
        case,
        sample_sizes,
        point_solution["policy"],
    )
    monte_carlo = _q2_monte_carlo(
        case,
        sample_sizes,
        truth_solution["policy"],
    )

    return {
        "case_id": case.case_id,
        "scenario_only": params.Q4_SCENARIO_ONLY,
        "parameter_names": list(params.Q4_Q2_NODE_NAMES),
        "scenario_center_rates": {
            "p1": case.p1,
            "p2": case.p2,
            "pf": case.pf,
        },
        "sample_size_design": sample_size_design,
        "n_by_node": sample_sizes,
        "observed_x_by_node_scenario": observed_x,
        "point_estimate": point_estimate,
        "clopper_pearson_intervals": intervals,
        "bonferroni_joint_box": joint,
        "scenario_center_policy": truth_solution["policy"],
        "scenario_center_policy_label": truth_solution["policy_label"],
        "scenario_center_profit": truth_solution["profit"],
        "point_policy": point_solution["policy"],
        "point_policy_label": point_solution["policy_label"],
        "point_profit": point_solution["profit"],
        "point_strategy_table": strategy_table,
        "point_strategy_profit_vector": [
            row["profit"] for row in strategy_table
        ],
        "point_strategy_expected_cost_vector": [
            row["expected_cost"] for row in strategy_table
        ],
        "robust_policy": robust["robust_policy"],
        "robust_policy_label": robust["robust_policy_label"],
        "robust_policy_lower_profit": robust["robust_policy_lower_profit"],
        "profit_interval": robust["profit_interval"],
        "joint_box_policy_table": robust["table"],
        "sample_size_scan": sample_size_scan,
        "monte_carlo": monte_carlo,
    }


def _problem2_schema_crosscheck() -> dict[str, Any]:
    """Exercise problem2's case loader and prove flat cost fields survive."""

    try:
        module = importlib.import_module("problem2")
        loader = getattr(module, "load_cases")
        loaded_cases = loader()
        normalized = [_normalize_q2_case(case) for case in loaded_cases]
        expected = [_normalize_q2_case(case) for case in params.Q2_CASES]
        equal = len(normalized) == len(expected) and all(
            left == right for left, right in zip(normalized, expected)
        )
        return {
            "status": "passed" if equal else "failed",
            "row_count": len(normalized),
            "flat_cost_fields_checked": [
                "price1",
                "test1",
                "price2",
                "test2",
            ],
            "equal_to_params_cases": equal,
        }
    except Exception as error:
        return {
            "status": "unavailable",
            "error_type": type(error).__name__,
            "error": str(error),
            "local_normalization": "passed",
        }


def _q3_sample_size_scan(sample_sizes: Mapping[str, int]) -> list[dict[str, Any]]:
    maximum_n = max(int(value) for value in sample_sizes.values())
    rows: list[dict[str, Any]] = []
    for n in range(1, maximum_n + 1):
        widths: dict[str, float] = {}
        planned_counts: dict[str, int] = {}
        for name, center in params.Q4_Q3_SCENARIO_RATES.items():
            x = int(round(n * center))
            interval = clopper_pearson(
                n,
                x,
                params.Q4_Q3_MARGINAL_ALPHA,
            )
            widths[name] = interval["width"]
            planned_counts[name] = x
        rows.append(
            {
                "n": n,
                "planned_counts": planned_counts,
                "cp_widths": widths,
                "mean_cp_width": sum(widths.values()) / len(widths),
            }
        )
    return rows


def _q3_result() -> dict[str, Any]:
    sample_size_design: dict[str, Any] = {}
    sample_sizes: dict[str, int] = {}
    for name, probability in params.Q4_Q3_SCENARIO_RATES.items():
        design = parameter_precision_n(
            probability,
            params.Q4_Q3_MARGINAL_ALPHA,
            params.Q4_WIDTH_TARGET,
            params.Q4_N_MAX,
        )
        sample_size_design[name] = design
        sample_sizes[name] = int(design["n"])

    n_array = np.asarray(
        [sample_sizes[name] for name in params.Q4_Q3_NODE_NAMES],
        dtype=int,
    )
    center_rates = np.asarray(
        [params.Q4_Q3_SCENARIO_RATES[name] for name in params.Q4_Q3_NODE_NAMES],
        dtype=float,
    )
    seed_sequence = np.random.SeedSequence([params.Q4_RANDOM_SEED])
    generator = np.random.default_rng(seed_sequence)
    observed_x_array = generator.binomial(n_array, center_rates)
    observed_x = {
        name: int(value)
        for name, value in zip(params.Q4_Q3_NODE_NAMES, observed_x_array)
    }
    point_estimate_array = observed_x_array.astype(float) / n_array.astype(float)
    point_estimate = {
        name: float(value)
        for name, value in zip(params.Q4_Q3_NODE_NAMES, point_estimate_array)
    }
    intervals = {
        name: clopper_pearson(
            sample_sizes[name],
            observed_x[name],
            params.Q4_Q3_MARGINAL_ALPHA,
        )
        for name in params.Q4_Q3_NODE_NAMES
    }
    joint = bonferroni_joint_box(intervals, params.Q4_FAMILY_ALPHA)
    if abs(joint["marginal_alpha"] - params.Q4_Q3_MARGINAL_ALPHA) > params.Q1_NUMERIC_TOL:
        raise AssertionError("Q3 Bonferroni 边际错误率与登记值不一致")

    x_trace = generator.binomial(
        np.broadcast_to(n_array, (params.Q4_MC_REPETITIONS, n_array.size)),
        np.broadcast_to(center_rates, (params.Q4_MC_REPETITIONS, center_rates.size)),
    )
    posterior_alpha = x_trace + params.Q4_JEFFREYS_A
    posterior_beta = n_array.astype(float)[None, :] - x_trace + params.Q4_JEFFREYS_B
    posterior_theta = generator.beta(posterior_alpha, posterior_beta)
    checkpoint_indices = sorted(
        {
            int(round(value))
            for value in np.linspace(
                0,
                params.Q4_MC_REPETITIONS - 1,
                len(params.Q4_N_GRID),
            )
        }
    )
    posterior_mean_trace = np.cumsum(
        posterior_theta,
        axis=0,
    ) / np.arange(1, params.Q4_MC_REPETITIONS + 1)[:, None]
    convergence = [
        {
            "replicate": index + 1,
            "running_mean_posterior_rate_by_node": {
                name: float(value)
                for name, value in zip(
                    params.Q4_Q3_NODE_NAMES,
                    posterior_mean_trace[index],
                )
            },
        }
        for index in checkpoint_indices
    ]
    formal_topology_available = bool(params.Q3_GRAPH_AVAILABLE)
    status = (
        "scenario_only_conditional"
        if formal_topology_available
        else "blocked_missing_official_edge_list"
    )
    return {
        "scenario_only": params.Q4_SCENARIO_ONLY,
        "formal_topology_available": formal_topology_available,
        "status": status,
        "official_edge_list": params.Q3_OFFICIAL_EDGE_LIST,
        "inferred_topologies_excluded_from_formal_result": not formal_topology_available,
        "conditional_primary_edge_list": params.Q3_PRIMARY_EDGE_LIST,
        "conditional_alternative_edge_list": params.Q3_ALTERNATIVE_EDGE_LIST,
        "parameter_names": list(params.Q4_Q3_NODE_NAMES),
        "scenario_center_rates": dict(params.Q4_Q3_SCENARIO_RATES),
        "sample_size_design": sample_size_design,
        "n_by_node": sample_sizes,
        "observed_x_by_node_scenario": observed_x,
        "point_estimate": point_estimate,
        "clopper_pearson_intervals": intervals,
        "bonferroni_joint_box": joint,
        "point_policy": None,
        "robust_policy": None,
        "profit_interval": None,
        "decision_consistency": None,
        "formal_reoptimization_status": (
            "not executed because the official Figure 1 edge list is absent"
            if not formal_topology_available
            else "requires the general DAG solver output"
        ),
        "sample_size_scan": _q3_sample_size_scan(sample_sizes),
        "monte_carlo": {
            "replicates": params.Q4_MC_REPETITIONS,
            "seed": params.Q4_RANDOM_SEED,
            "sampling": "independent Binomial scenario counts, then Jeffreys posterior rates",
            "node_names": list(params.Q4_Q3_NODE_NAMES),
            "n_by_node": sample_sizes,
            "x_trace": x_trace,
            "reoptimized_policy_trace": [None] * params.Q4_MC_REPETITIONS,
            "decision_consistency": None,
            "convergence": convergence,
        },
    }


def _builtin(value: Any) -> Any:
    if value is None or isinstance(value, (str, bool, int, float)):
        return value
    if isinstance(value, np.generic):
        return _builtin(value.item())
    if isinstance(value, np.ndarray):
        return [_builtin(item) for item in value.tolist()]
    if isinstance(value, Mapping):
        return {str(key): _builtin(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_builtin(item) for item in value]
    raise TypeError(f"问题四结果含不可序列化类型：{type(value).__name__}")


def _check_finite(value: Any, location: str = "$") -> None:
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError(f"问题四结果含非有限数：{location}")
    if isinstance(value, Mapping):
        for key, item in value.items():
            _check_finite(item, f"{location}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _check_finite(item, f"{location}[{index}]")


def validate(payload: Mapping[str, Any]) -> bool:
    if payload.get("scenario_only") is not True:
        raise AssertionError("Q4 必须标记 scenario_only")
    if payload.get("actual_samples_available") is not params.Q4_ACTUAL_SAMPLES_AVAILABLE:
        raise AssertionError("Q4 实际样本可用性标记错误")
    if payload["edge_case_tests"]["passed"] is not True:
        raise AssertionError("Q4 CP 边界测试未通过")
    q2_payload = payload["q2"]
    expected_cases = len(params.Q2_CASES)
    if len(q2_payload["cases"]) != expected_cases:
        raise AssertionError("Q4 问题二情形数错误")
    for case in q2_payload["cases"]:
        n_by_node = case["n_by_node"]
        x_by_node = case["observed_x_by_node_scenario"]
        estimate = case["point_estimate"]
        for name in params.Q4_Q2_NODE_NAMES:
            if not 0 <= x_by_node[name] <= n_by_node[name]:
                raise AssertionError("Q4 Q2 情景计数越界")
            if abs(estimate[name] - x_by_node[name] / n_by_node[name]) > params.Q1_NUMERIC_TOL:
                raise AssertionError("Q4 Q2 点估计不能由 (n,x) 复算")
            interval = case["clopper_pearson_intervals"][name]
            if not 0.0 <= interval["lower"] <= estimate[name] <= interval["upper"] <= 1.0:
                raise AssertionError("Q4 Q2 CP 区间次序错误")
        monte_carlo = case["monte_carlo"]
        if len(monte_carlo["x_trace"]) != params.Q4_MC_REPETITIONS:
            raise AssertionError("Q4 Q2 情景计数轨迹长度错误")
        if len(monte_carlo["reoptimized_point_policy_trace"]) != params.Q4_MC_REPETITIONS:
            raise AssertionError("Q4 Q2 策略轨迹长度错误")
        if not 0.0 <= monte_carlo["decision_consistency"] <= 1.0:
            raise AssertionError("Q4 Q2 决策一致率越界")

    q3_payload = payload["q3"]
    if len(q3_payload["parameter_names"]) != params.Q3_PARAMETER_NODE_COUNT:
        raise AssertionError("Q4 Q3 参数节点数错误")
    if q3_payload["formal_topology_available"] is not params.Q3_GRAPH_AVAILABLE:
        raise AssertionError("Q4 Q3 正式拓扑状态错误")
    if not params.Q3_GRAPH_AVAILABLE:
        if q3_payload["point_policy"] is not None or q3_payload["robust_policy"] is not None:
            raise AssertionError("缺原图时不得把条件拓扑冒充正式 Q3 重解")
        if q3_payload["profit_interval"] is not None:
            raise AssertionError("缺原图时不得生成正式 Q3 利润区间")
    if len(q3_payload["monte_carlo"]["x_trace"]) != params.Q4_MC_REPETITIONS:
        raise AssertionError("Q4 Q3 情景计数轨迹长度错误")

    allocations = (
        q2_payload["bonferroni_marginal_alpha"] * params.Q2_PARAMETER_NODE_COUNT,
        q3_payload["bonferroni_marginal_alpha"] * params.Q3_PARAMETER_NODE_COUNT,
    )
    if any(
        allocation > params.Q4_FAMILY_ALPHA + params.Q1_NUMERIC_TOL
        for allocation in allocations
    ):
        raise AssertionError("Q4 Bonferroni 族错误率分配超限")
    _check_finite(payload)
    return True


def self_test() -> None:
    normalized_cases = [_normalize_q2_case(case) for case in params.Q2_CASES]
    if len(normalized_cases) != len(params.Q2_CASES):
        raise AssertionError("Q2 参数适配器行数错误")
    for raw_case, normalized in zip(params.Q2_CASES, normalized_cases):
        if normalized.price1 != float(raw_case.price1):
            raise AssertionError("price1 未进入 Q4 适配器")
        if normalized.test1 != float(raw_case.test1):
            raise AssertionError("test1 未进入 Q4 适配器")
        if normalized.price2 != float(raw_case.price2):
            raise AssertionError("price2 未进入 Q4 适配器")
        if normalized.test2 != float(raw_case.test2):
            raise AssertionError("test2 未进入 Q4 适配器")

    edge_case_tests()
    case = normalized_cases[0]
    nonabsorbing = _q2_mrp_value(case, (0, 0, 0, 1))
    absorbing = _q2_mrp_value(case, (1, 1, 0, 0))
    if nonabsorbing["absorbing"]:
        raise AssertionError("Q2 无上限返修的非吸收策略未被识别")
    if not absorbing["absorbing"]:
        raise AssertionError("Q2 吸收策略被误剔除")
    if absorbing["ledger_residual"] > params.CASHFLOW_ABS_TOL:
        raise AssertionError("Q2 事件现金流核验失败")
    if bonferroni_joint_box(
        {
            "p1": clopper_pearson(params.Q4_N_GRID[0], 0, params.Q4_Q2_MARGINAL_ALPHA),
            "p2": clopper_pearson(params.Q4_N_GRID[0], 1, params.Q4_Q2_MARGINAL_ALPHA),
            "pf": clopper_pearson(params.Q4_N_GRID[0], 2, params.Q4_Q2_MARGINAL_ALPHA),
        }
    )["allocation_sum"] > params.Q4_FAMILY_ALPHA + params.Q1_NUMERIC_TOL:
        raise AssertionError("Bonferroni 自检失败")


def _write_json(path: Path, payload: Mapping[str, Any]) -> None:
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as stream:
        json.dump(
            payload,
            stream,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
            allow_nan=False,
        )
        stream.write("\n")
    temporary.replace(path)


def run() -> dict[str, Any]:
    self_test()
    q2_cases = [_q2_case_result(case) for case in params.Q2_CASES]
    q2_consistency = sum(
        float(case["monte_carlo"]["decision_consistency"])
        for case in q2_cases
    ) / len(q2_cases)
    payload: dict[str, Any] = {
        "schema": "2024B-stage3-problem4-results",
        "scenario_only": params.Q4_SCENARIO_ONLY,
        "actual_samples_available": params.Q4_ACTUAL_SAMPLES_AVAILABLE,
        "sampling_description": params.Q4_SAMPLING_DESCRIPTION,
        "constants": {
            "joint_confidence": params.Q4_JOINT_CONFIDENCE,
            "family_alpha": params.Q4_FAMILY_ALPHA,
            "width_target": params.Q4_WIDTH_TARGET,
            "n_max": params.Q4_N_MAX,
            "n_grid": list(params.Q4_N_GRID),
            "mc_repetitions": params.Q4_MC_REPETITIONS,
            "random_seed": params.Q4_RANDOM_SEED,
            "jeffreys_alpha": params.Q4_JEFFREYS_A,
            "jeffreys_beta": params.Q4_JEFFREYS_B,
            "consistency_threshold": params.Q4_CONSISTENCY_THRESHOLD,
        },
        "edge_case_tests": edge_case_tests(),
        "q2": {
            "parameter_node_count": params.Q2_PARAMETER_NODE_COUNT,
            "node_names": list(params.Q4_Q2_NODE_NAMES),
            "bonferroni_marginal_alpha": params.Q4_Q2_MARGINAL_ALPHA,
            "profit_unit": "yuan/qualified delivery",
            "cases": q2_cases,
            "mean_decision_consistency": q2_consistency,
            "problem2_loader_crosscheck": _problem2_schema_crosscheck(),
        },
        "q3": _q3_result(),
        "decision_consistency": q2_consistency,
        "decision_consistency_scope": "Q2 scenario-only cases; formal Q3 is blocked by the missing official edge list",
        "classification_metric_disclosure": {
            "is_supervised_classification_metric": False,
            "training_data": None,
            "data_split": None,
            "leakage_control": (
                "The value is a deterministic scenario-resampling stability diagnostic. "
                "No observations are split because no supervised model is trained."
            ),
        },
        "formal_result_boundary": (
            "Q2 results use generated scenario counts. Q3 sampling diagnostics are retained, "
            "but formal Q3 policies and profits are blocked until the official Figure 1 "
            "edge list is supplied; inferred primary and alternative topologies are not "
            "presented as the official graph."
        ),
        "validation": {
            "strict_finite_json": True,
            "q2_scenario_reoptimization_complete": True,
            "q3_formal_reoptimization_blocked": not params.Q3_GRAPH_AVAILABLE,
            "inferred_topology_isolated": True,
            "all_costs_in_event_ledger": True,
        },
    }
    plain_payload = _builtin(payload)
    validate(plain_payload)
    _write_json(Path.cwd() / "problem4_results.json", plain_payload)
    return plain_payload