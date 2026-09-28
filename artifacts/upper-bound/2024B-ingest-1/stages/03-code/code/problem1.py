"""问题一：精确二项抽样方案、灵敏度扫描与有限 SPRT 对照。"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import numpy as np
from scipy.stats import binom

import params
from params import *


OUTPUT_FILE = "problem1_outputs.json"


def _normalised_name(value: str) -> str:
    return "".join(character for character in value if character.isalnum()).casefold()


def _parameter_registry() -> dict[str, Any]:
    registry: dict[str, Any] = {}

    for name in dir(params):
        if name.startswith("__"):
            continue
        value = getattr(params, name)
        if isinstance(value, (int, float, str, bool, list, tuple, np.ndarray)):
            registry[_normalised_name(name)] = value

    for container_name in (
        "MODEL_CONSTANTS",
        "model_constants",
        "PARAMETERS",
        "parameters",
        "MODEL_REGISTRY",
        "model_registry",
    ):
        if not hasattr(params, container_name):
            continue
        container = getattr(params, container_name)
        if isinstance(container, dict):
            for name, value in container.items():
                registry[_normalised_name(str(name))] = value
        elif isinstance(container, (list, tuple)):
            for item in container:
                if isinstance(item, dict) and "name" in item and "value" in item:
                    registry[_normalised_name(str(item["name"]))] = item["value"]
    return registry


def _parameter(*names: str) -> Any:
    registry = _parameter_registry()
    for name in names:
        key = _normalised_name(name)
        if key in registry and registry[key] is not None:
            return registry[key]
    raise ValueError(f"params 中缺少问题一常量：{', '.join(names)}")


def _optional_parameter(*names: str) -> Any:
    registry = _parameter_registry()
    for name in names:
        key = _normalised_name(name)
        if key in registry and registry[key] is not None:
            return registry[key]
    return None


def _probability_grid(value: Any, name: str) -> np.ndarray:
    grid = np.asarray(value, dtype=float).reshape(-1)
    if grid.size == 0:
        raise ValueError(f"{name} 不得为空")
    if not np.all(np.isfinite(grid)):
        raise ValueError(f"{name} 含非有限值")
    return grid


def exact_integer_enumeration(n: int, p: float) -> tuple[np.ndarray, np.ndarray]:
    """枚举 X=0,...,n 的精确二项概率，并返回前缀与后缀概率。"""
    counts = np.arange(n + 1, dtype=int)
    masses = np.asarray(binom.pmf(counts, n, p), dtype=float)
    lower = np.cumsum(masses)
    upper = np.cumsum(masses[::-1])[::-1]
    return lower, upper


def exact_binomial_tail(n: int, threshold: int, p: float) -> float:
    """返回 P(X>=threshold)，内部仍逐个整数计数求和。"""
    lower, upper = exact_integer_enumeration(n, p)
    if threshold <= 0:
        return float(upper[0])
    if threshold > n:
        return 0.0
    return float(upper[threshold])


def _minimum_rejection_plan(
    p0: float,
    p_alt: float,
    alpha: float,
    beta: float,
    tolerance: float,
    search_limit: int | None,
) -> dict[str, Any]:
    """按 (n,r) 字典序寻找满足两类精确尾概率约束的最小方案。"""
    n = 1
    one = 1.0
    while search_limit is None or n <= search_limit:
        lower_p0, upper_p0 = exact_integer_enumeration(n, p0)
        lower_alt, upper_alt = exact_integer_enumeration(n, p_alt)
        feasible = np.flatnonzero(
            (upper_p0 <= alpha + tolerance)
            & (upper_alt >= one - beta - tolerance)
        )
        if feasible.size:
            r = int(feasible[0])
            reject_tail = exact_binomial_tail(n, r, p0)
            power = exact_binomial_tail(n, r, p_alt)
            return {
                "n": int(n),
                "r": r,
                "p0": float(p0),
                "p_alt": float(p_alt),
                "alpha": float(alpha),
                "beta": float(beta),
                "reject_tail_p0": float(reject_tail),
                "power_p_alt": float(power),
                "type1_slack": float(alpha - reject_tail),
                "power_slack": float(power - (one - beta)),
                "feasible": True,
                "tie_break": "lexicographic_smallest_n_then_r",
            }
        n += 1
    raise RuntimeError("问题一拒收方案在登记搜索上限内不可行")


def _minimum_acceptance_plan(
    p0: float,
    confidence: float,
    tolerance: float,
    search_limit: int | None,
) -> dict[str, Any]:
    """按最小 n 搜索，并在同一 n 下选择最大的可行接收临界值。"""
    n = 1
    while search_limit is None or n <= search_limit:
        lower, _ = exact_integer_enumeration(n, p0)
        feasible = np.flatnonzero(lower >= confidence - tolerance)
        if feasible.size:
            c = int(feasible[-1])
            accept_probability = float(lower[c])
            return {
                "n": int(n),
                "c": c,
                "p0": float(p0),
                "confidence": float(confidence),
                "accept_probability_p0": accept_probability,
                "confidence_slack": float(accept_probability - confidence),
                "feasible": True,
                "tie_break": "minimum_n_then_largest_c",
            }
        n += 1
    raise RuntimeError("问题一接收方案在登记搜索上限内不可行")


def _log_likelihood_ratio(n: int, x: int, p0: float, p_alt: float) -> float:
    one = 1.0
    return float(
        x * math.log(p_alt / p0)
        + (n - x) * math.log((one - p_alt) / (one - p0))
    )


def likelihood_ratio_random_walk(
    p0: float,
    p_alt: float,
    accept_boundary: float,
    reject_boundary: float,
    maximum_n: int,
) -> dict[str, Any]:
    """用精确整数随机游走计算有限 SPRT 的停止概率和期望检测数。"""
    if maximum_n < 1:
        raise ValueError("有限 SPRT 的截断上限必须是正整数")
    if not accept_boundary < 0.0 < reject_boundary:
        raise ValueError("SPRT 边界必须满足 a<0<b")

    good_log_ratio = math.log((1.0 - p_alt) / (1.0 - p0))
    bad_log_ratio = math.log(p_alt / p0)
    midpoint = (accept_boundary + reject_boundary) / 2.0

    live = np.zeros(maximum_n + 1, dtype=float)
    live[0] = 1.0
    accepted_probability = 0.0
    rejected_probability = 0.0
    survival_probability = 1.0
    expected_n = 0.0
    cap_metrics: list[dict[str, Any]] = []

    for sample_n in range(1, maximum_n + 1):
        expected_n += survival_probability
        next_live = np.zeros(sample_n + 1, dtype=float)

        for previous_x in range(sample_n):
            previous_probability = float(live[previous_x])
            if previous_probability == 0.0:
                continue

            for is_bad in (False, True):
                x = previous_x + int(is_bad)
                transition_probability = (
                    p_alt if is_bad else 1.0 - p_alt
                )
                path_probability = previous_probability * transition_probability
                log_ratio = (
                    previous_x * good_log_ratio
                    + sample_n
                    - previous_x
                ) * good_log_ratio + previous_x * (bad_log_ratio - good_log_ratio)

                if log_ratio <= accept_boundary:
                    accepted_probability += path_probability
                elif log_ratio >= reject_boundary:
                    rejected_probability += path_probability
                else:
                    next_live[x] += path_probability

        live = next_live
        survival_probability = float(np.sum(live))

        terminal_accept = 0.0
        terminal_reject = 0.0
        for x in range(sample_n + 1):
            mass = float(live[x])
            if mass == 0.0:
                continue
            log_ratio = (
                sample_n * good_log_ratio
                + x * (bad_log_ratio - good_log_ratio)
            )
            if log_ratio <= midpoint:
                terminal_accept += mass
            else:
                terminal_reject += mass

        finite_accept_probability = accepted_probability + terminal_accept
        finite_reject_probability = rejected_probability + terminal_reject
        cap_metrics.append(
            {
                "n": int(sample_n),
                "expected_n": float(expected_n),
                "accept_probability": float(finite_accept_probability),
                "reject_probability": float(finite_reject_probability),
                "truncation_probability": float(survival_probability),
                "terminal_accept_probability": float(terminal_accept),
                "terminal_reject_probability": float(terminal_reject),
                "probability_sum_error": float(
                    abs(
                        finite_accept_probability
                        + finite_reject_probability
                        - 1.0
                    )
                ),
            }
        )

    boundary_path: list[dict[str, Any]] = []
    for sample_n in range(maximum_n + 1):
        log_ratios = np.asarray(
            [
                _log_likelihood_ratio(sample_n, x, p0, p_alt)
                for x in range(sample_n + 1)
            ],
            dtype=float,
        )
        accepted = np.flatnonzero(log_ratios <= accept_boundary)
        rejected = np.flatnonzero(log_ratios >= reject_boundary)
        boundary_path.append(
            {
                "n": int(sample_n),
                "log_lr_min": float(log_ratios[0]),
                "log_lr_max": float(log_ratios[-1]),
                "accept_max_defects": (
                    int(accepted[-1]) if accepted.size else None
                ),
                "reject_min_defects": (
                    int(rejected[0]) if rejected.size else None
                ),
            }
        )

    return {
        "cap_metrics": cap_metrics,
        "boundary_path": boundary_path,
    }


def _sprt_cap_is_feasible(
    row: dict[str, Any], alpha: float, beta: float, fixed_n: int, tolerance: float
) -> bool:
    one = 1.0
    return bool(
        row["reject_probability"] <= alpha + tolerance
        and row["accept_probability"] <= beta + tolerance
        and row["expected_n"] <= fixed_n + tolerance
    )


def _select_sprt(
    p0: float,
    p_alt: float,
    alpha: float,
    beta: float,
    fixed_n: int,
    accept_boundary: float,
    reject_boundary: float,
    tolerance: float,
    registered_maximum: int | None,
) -> dict[str, Any]:
    search_maximum = fixed_n if registered_maximum is None else int(registered_maximum)
    if search_maximum < fixed_n:
        raise ValueError("有限 SPRT 截断上限不得小于固定方案样本量")

    while True:
        under_p0 = likelihood_ratio_random_walk(
            p0, p_alt, accept_boundary, reject_boundary, search_maximum
        )
        under_alt = likelihood_ratio_random_walk(
            p0, p_alt, accept_boundary, reject_boundary, search_maximum
        )
        combined: list[dict[str, Any]] = []
        selected_row: dict[str, Any] | None = None

        for row_p0, row_alt in zip(
            under_p0["cap_metrics"], under_alt["cap_metrics"], strict=True
        ):
            combined_row = {
                **row_p0,
                "accept_probability_p0": float(row_p0["accept_probability"]),
                "reject_probability_p0": float(row_p0["reject_probability"]),
                "expected_n_p0": float(row_p0["expected_n"]),
                "accept_probability_palt": float(row_alt["accept_probability"]),
                "reject_probability_palt": float(row_alt["reject_probability"]),
                "expected_n_palt": float(row_alt["expected_n"]),
            }
            combined_row["constraint_pass"] = _sprt_cap_is_feasible(
                combined_row, alpha, beta, fixed_n, tolerance
            )
            combined.append(combined_row)
            if selected_row is None and combined_row["constraint_pass"]:
                selected_row = combined_row

        if selected_row is not None:
            selected_cap = int(selected_row["n"])
            return {
                "selected": True,
                "selected_method": "finite_sprt",
                "fixed_n": int(fixed_n),
                "cap": selected_cap,
                "accept_boundary": float(accept_boundary),
                "reject_boundary": float(reject_boundary),
                "truncation_rule": "nearest_boundary_accept_on_tie",
                "expected_n_p0": float(selected_row["expected_n_p0"]),
                "expected_n_palt": float(selected_row["expected_n_palt"]),
                "reject_probability_p0": float(
                    selected_row["reject_probability_p0"]
                ),
                "accept_probability_p0": float(selected_row["accept_probability_p0"]),
                "accept_probability_palt": float(
                    selected_row["accept_probability_palt"]
                ),
                "reject_probability_palt": float(
                    selected_row["reject_probability_palt"]
                ),
                "truncation_probability_p0": float(
                    selected_row["truncation_probability"]
                ),
                "truncation_probability_palt": float(
                    under_alt["cap_metrics"][selected_cap - 1][
                        "truncation_probability"
                    ]
                ),
                "constraint_pass": True,
                "cap_metrics": combined,
                "boundary_path": under_p0["boundary_path"][: selected_cap + 1],
            }

        if registered_maximum is not None:
            fallback = combined[fixed_n - 1]
            return {
                "selected": False,
                "selected_method": "fixed",
                "fixed_n": int(fixed_n),
                "cap": int(fixed_n),
                "accept_boundary": float(accept_boundary),
                "reject_boundary": float(reject_boundary),
                "truncation_rule": "nearest_boundary_accept_on_tie",
                "expected_n_p0": float(fallback["expected_n_p0"]),
                "expected_n_palt": float(fallback["expected_n_palt"]),
                "reject_probability_p0": float(
                    fallback["reject_probability_p0"]
                ),
                "accept_probability_p0": float(
                    fallback["accept_probability_p0"]
                ),
                "accept_probability_palt": float(
                    fallback["accept_probability_palt"]
                ),
                "reject_probability_palt": float(
                    fallback["reject_probability_palt"]
                ),
                "truncation_probability_p0": float(
                    fallback["truncation_probability"]
                ),
                "truncation_probability_palt": float(
                    under_alt["cap_metrics"][fixed_n - 1][
                        "truncation_probability"
                    ]
                ),
                "constraint_pass": False,
                "cap_metrics": combined,
                "boundary_path": under_p0["boundary_path"][: fixed_n + 1],
            }

        search_maximum *= 2


def _sensitivity_analysis(
    p0: float,
    alpha: float,
    delta_grid: np.ndarray,
    beta_grid: np.ndarray,
    tolerance: float,
    search_limit: int | None,
) -> dict[str, Any]:
    n_matrix = np.full(
        (delta_grid.size, beta_grid.size), -1, dtype=int
    )
    r_matrix = np.full(
        (delta_grid.size, beta_grid.size), -1, dtype=int
    )
    tail_matrix = np.full(
        (delta_grid.size, beta_grid.size), np.nan, dtype=float
    )
    power_matrix = np.full(
        (delta_grid.size, beta_grid.size), np.nan, dtype=float
    )
    records: list[dict[str, Any]] = []

    for delta_index, delta in enumerate(delta_grid):
        p_alt = float(p0 + delta)
        if p_alt > 1.0:
            raise ValueError("问题一备择率超过概率上界")
        for beta_index, beta in enumerate(beta_grid):
            plan = _minimum_rejection_plan(
                p0, p_alt, alpha, float(beta), tolerance, search_limit
            )
            n_matrix[delta_index, beta_index] = plan["n"]
            r_matrix[delta_index, beta_index] = plan["r"]
            tail_matrix[delta_index, beta_index] = plan["reject_tail_p0"]
            power_matrix[delta_index, beta_index] = plan["power_p_alt"]
            records.append(
                {
                    "delta": float(delta),
                    "beta": float(beta),
                    "p_alt": p_alt,
                    **plan,
                }
            )

    return {
        "delta_grid": delta_grid.tolist(),
        "beta_grid": beta_grid.tolist(),
        "n_matrix": n_matrix.tolist(),
        "r_matrix": r_matrix.tolist(),
        "reject_tail_matrix": tail_matrix.tolist(),
        "power_matrix": power_matrix.tolist(),
        "records": records,
    }


def _sample_size_scan(
    p0: float,
    p_alt: float,
    alpha: float,
    beta: float,
    maximum_n: int,
    tolerance: float,
) -> dict[str, Any]:
    n_values: list[int] = []
    thresholds: list[int | None] = []
    type1_errors: list[float] = []
    powers: list[float] = []
    feasible: list[bool] = []

    for n in range(1, maximum_n + 1):
        _, upper_p0 = exact_integer_enumeration(n, p0)
        _, upper_alt = exact_integer_enumeration(n, p_alt)
        candidates = np.flatnonzero(
            (upper_p0 <= alpha + tolerance)
            & (upper_alt >= 1.0 - beta - tolerance)
        )
        n_values.append(int(n))
        if candidates.size:
            r = int(candidates[0])
            thresholds.append(r)
            type1_errors.append(float(upper_p0[r]))
            powers.append(float(upper_alt[r]))
            feasible.append(True)
        else:
            thresholds.append(None)
            type1_errors.append(float(np.min(upper_p0)))
            powers.append(float(np.max(upper_alt)))
            feasible.append(False)

    return {
        "n": n_values,
        "selected_r": thresholds,
        "minimum_type1_error": type1_errors,
        "maximum_power_at_type1_boundary": powers,
        "both_constraints_feasible": feasible,
    }


def _confidence_scan(
    p0: float,
    alpha: float,
    baseline_delta: float,
    registered_beta_grid: np.ndarray,
    delta_grid_size: int,
    tolerance: float,
    search_limit: int | None,
    optional_confidence_grid: Any,
) -> dict[str, Any]:
    if optional_confidence_grid is not None:
        confidence_grid = _probability_grid(
            optional_confidence_grid, "Q1_CONFIDENCE_GRID"
        )
        beta_values = 1.0 - confidence_grid
        source = "registered_confidence_grid"
    else:
        beta_minimum = float(np.min(registered_beta_grid))
        beta_maximum = float(np.max(registered_beta_grid))
        point_count = delta_grid_size * registered_beta_grid.size
        beta_values = np.linspace(beta_minimum, beta_maximum, point_count)
        source = "derived_between_registered_beta_endpoints"

    records: list[dict[str, Any]] = []
    for beta in beta_values:
        beta_value = float(beta)
        confidence = float(1.0 - beta_value)
        if not 0.0 < beta_value < 1.0 or not 0.0 < confidence < 1.0:
            continue
        plan = _minimum_rejection_plan(
            p0,
            float(p0 + baseline_delta),
            alpha,
            beta_value,
            tolerance,
            search_limit,
        )
        records.append(
            {
                "confidence": confidence,
                "beta": beta_value,
                "n": plan["n"],
                "r": plan["r"],
                "power": plan["power_p_alt"],
                "reject_tail_p0": plan["reject_tail_p0"],
            }
        )

    return {
        "grid_source": source,
        "confidence": [record["confidence"] for record in records],
        "beta": [record["beta"] for record in records],
        "n": [record["n"] for record in records],
        "r": [record["r"] for record in records],
        "power": [record["power"] for record in records],
        "records": records,
    }


def _to_builtin(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _to_builtin(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_to_builtin(item) for item in value]
    if isinstance(value, np.ndarray):
        return _to_builtin(value.tolist())
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        return float(value)
    if isinstance(value, np.bool_):
        return bool(value)
    return value


def _write_json(payload: dict[str, Any], output_path: str) -> None:
    destination = Path(output_path)
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(
            _to_builtin(payload),
            stream,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
            allow_nan=False,
        )
        stream.write("\n")
    temporary.replace(destination)


def solve_problem1(output_path: str = OUTPUT_FILE) -> dict[str, Any]:
    p0 = float(
        _parameter(
            "Q1_NOMINAL_DEFECT_RATE",
            "Q1_NOMINAL_RATE",
            "Q1_NOMINAL",
            "Q1_P0",
            "P0",
            "Q1标称次品率",
            "标称次品率",
        )
    )
    alpha = float(
        _parameter(
            "Q1_REJECT_ALPHA",
            "Q1_ALPHA_REJECT",
            "Q1_REJECT_TYPE_I_ERROR",
            "Q1第一类错误上限",
            "Q1拒收第一类错误上限",
        )
    )
    accept_confidence = float(
        _parameter(
            "Q1_ACCEPT_CONFIDENCE",
            "Q1_RECEIVE_CONFIDENCE",
            "Q1_CONF_ACCEPT",
            "Q1接收置信水平",
        )
    )
    baseline_delta = float(
        _parameter(
            "Q1_ALTERNATIVE_DELTA",
            "Q1_DELTA",
            "Q1_POWER_DELTA",
            "Q1可识别超标幅度",
        )
    )
    baseline_beta = float(
        _parameter(
            "Q1_TYPE_II_ERROR",
            "Q1_BETA",
            "Q1_SECOND_TYPE_ERROR",
            "Q1第二类错误上限",
        )
    )
    delta_grid = _probability_grid(
        _parameter(
            "Q1_DELTA_GRID",
            "Q1_ALTERNATIVE_DELTA_GRID",
            "Q1超标幅度灵敏度网格",
        ),
        "Q1_DELTA_GRID",
    )
    beta_grid = _probability_grid(
        _parameter(
            "Q1_BETA_GRID",
            "Q1_TYPE_II_ERROR_GRID",
            "Q1第二类错误灵敏度网格",
        ),
        "Q1_BETA_GRID",
    )
    tolerance = float(
        _parameter(
            "Q1_NUMERIC_TOL",
            "Q1_EXACT_TOLERANCE",
            "Q1精确枚举数值容差",
        )
    )
    search_limit_value = _optional_parameter(
        "Q1_SEARCH_LIMIT",
        "Q1_N_MAX",
        "Q1_SAMPLE_SIZE_LIMIT",
        "Q1枚举搜索上限",
    )
    search_limit = (
        None if search_limit_value is None else int(search_limit_value)
    )

    if not 0.0 < p0 < 1.0:
        raise ValueError("问题一标称次品率必须位于开区间")
    if not 0.0 < alpha < 1.0 or not 0.0 < accept_confidence < 1.0:
        raise ValueError("问题一置信参数必须位于开区间")
    if not 0.0 < baseline_delta < 1.0:
        raise ValueError("问题一可识别超标幅度必须位于开区间")
    if p0 + baseline_delta > 1.0:
        raise ValueError("问题一基准备择率超过概率上界")
    if not 0.0 < baseline_beta < 1.0:
        raise ValueError("问题一第二类错误上限必须位于开区间")
    if not np.all((delta_grid > 0.0) & (delta_grid < 1.0)):
        raise ValueError("问题一超标幅度网格越界")
    if not np.all((beta_grid > 0.0) & (beta_grid < 1.0)):
        raise ValueError("问题一第二类错误网格越界")

    case95 = _minimum_rejection_plan(
        p0,
        p0 + baseline_delta,
        alpha,
        baseline_beta,
        tolerance,
        search_limit,
    )
    case90 = _minimum_acceptance_plan(
        p0,
        accept_confidence,
        tolerance,
        search_limit,
    )

    sprt_accept_boundary_value = _optional_parameter(
        "Q1_SPRT_A", "Q1_SPRT_ACCEPT_BOUNDARY", "Q1接受边界"
    )
    sprt_reject_boundary_value = _optional_parameter(
        "Q1_SPRT_B", "Q1_SPRT_REJECT_BOUNDARY", "Q1拒收边界"
    )
    accept_boundary = (
        math.log(baseline_beta / (1.0 - alpha))
        if sprt_accept_boundary_value is None
        else float(sprt_accept_boundary_value)
    )
    reject_boundary = (
        math.log((1.0 - baseline_beta) / alpha)
        if sprt_reject_boundary_value is None
        else float(sprt_reject_boundary_value)
    )
    sprt_maximum_value = _optional_parameter(
        "Q1_SPRT_MAX_N",
        "Q1_SPRT_N_MAX",
        "Q1_SPRT_TRUNCATION_LIMIT",
        "Q1序贯截断上限",
    )
    sprt = _select_sprt(
        p0,
        p0 + baseline_delta,
        alpha,
        baseline_beta,
        case95["n"],
        accept_boundary,
        reject_boundary,
        tolerance,
        None if sprt_maximum_value is None else int(sprt_maximum_value),
    )

    sensitivity = _sensitivity_analysis(
        p0,
        alpha,
        delta_grid,
        beta_grid,
        tolerance,
        search_limit,
    )
    scan = _sample_size_scan(
        p0,
        p0 + baseline_delta,
        alpha,
        baseline_beta,
        case95["n"],
        tolerance,
    )
    confidence_scan = _confidence_scan(
        p0,
        alpha,
        baseline_delta,
        beta_grid,
        delta_grid.size,
        tolerance,
        search_limit,
        _optional_parameter(
            "Q1_CONFIDENCE_GRID",
            "Q1_REJECT_CONFIDENCE_GRID",
            "Q1拒收置信度扫描网格",
        ),
    )

    oc_point_count = delta_grid.size * beta_grid.size + 1
    oc_rates = np.linspace(0.0, 1.0, oc_point_count)
    case95_accept = []
    case95_reject = []
    case90_accept = []
    for rate in oc_rates:
        _, upper = exact_integer_enumeration(case95["n"], float(rate))
        lower, _ = exact_integer_enumeration(case90["n"], float(rate))
        rejection_probability = float(upper[case95["r"]])
        case95_reject.append(rejection_probability)
        case95_accept.append(float(1.0 - rejection_probability))
        case90_accept.append(float(lower[case90["c"]]))

    exact_tail_check = abs(
        case95["reject_tail_p0"]
        - float(binom.sf(case95["r"] - 1, case95["n"], p0))
    )
    exact_power_check = abs(
        case95["power_p_alt"]
        - float(binom.sf(case95["r"] - 1, case95["n"], p0 + baseline_delta))
    )
    exact_acceptance_check = abs(
        case90["accept_probability_p0"]
        - float(binom.cdf(case90["c"], case90["n"], p0))
    )

    checks = {
        "case95_type1_constraint": bool(
            case95["reject_tail_p0"] <= alpha + tolerance
        ),
        "case95_power_constraint": bool(
            case95["power_p_alt"] >= 1.0 - baseline_beta - tolerance
        ),
        "case90_acceptance_constraint": bool(
            case90["accept_probability_p0"]
            >= accept_confidence - tolerance
        ),
        "case95_exact_tail_crosscheck": bool(
            exact_tail_check <= tolerance
        ),
        "case95_exact_power_crosscheck": bool(
            exact_power_check <= tolerance
        ),
        "case90_exact_acceptance_crosscheck": bool(
            exact_acceptance_check <= tolerance
        ),
        "case95_rejection_monotone_in_rate": bool(
            np.all(np.diff(case95_reject) >= -tolerance)
        ),
        "case95_acceptance_monotone_in_rate": bool(
            np.all(np.diff(case95_accept) <= tolerance)
        ),
        "case90_acceptance_monotone_in_rate": bool(
            np.all(np.diff(case90_accept) <= tolerance)
        ),
        "sensitivity_complete": bool(
            np.all(np.asarray(sensitivity["n_matrix"]) >= 0)
            and np.all(np.asarray(sensitivity["r_matrix"]) >= 0)
        ),
        "sensitivity_power_constraints": bool(
            all(record["power_slack"] >= -tolerance for record in sensitivity["records"])
        ),
        "sprt_probability_rows_normalised": bool(
            all(
                row["probability_sum_error"] <= tolerance
                for row in sprt["cap_metrics"]
            )
        ),
        "sprt_selected_under_same_constraints": bool(sprt["constraint_pass"]),
        "sprt_expected_not_above_fixed": bool(
            sprt["expected_n_p0"] <= case95["n"] + tolerance
            and sprt["expected_n_palt"] <= case95["n"] + tolerance
        ),
        "oc_curve_has_plot_grid": bool(len(oc_rates) > 1),
        "sample_size_scan_complete": bool(len(scan["n"]) == case95["n"]),
        "confidence_scan_has_plot_grid": bool(
            len(confidence_scan["confidence"]) > 1
        ),
    }
    checks["all_passed"] = bool(all(checks.values()))

    result = {
        "problem_id": "Q1",
        "data_class": "computed",
        "registered_design_constants": {
            "p0": p0,
            "reject_alpha": alpha,
            "accept_confidence": accept_confidence,
            "alternative_delta": baseline_delta,
            "type_ii_error": baseline_beta,
            "numeric_tolerance": tolerance,
        },
        "case95": case95,
        "case90": case90,
        "fixed_scheme": {
            "n": case95["n"],
            "expected_n_p0": case95["n"],
            "expected_n_palt": case95["n"],
            "reject_probability_p0": case95["reject_tail_p0"],
            "power_p_alt": case95["power_p_alt"],
        },
        "sprt": sprt,
        "selection_comparison": {
            "selected_method": sprt["selected_method"],
            "fixed_n": case95["n"],
            "sprt_cap": sprt["cap"],
            "sprt_expected_n_p0": sprt["expected_n_p0"],
            "sprt_expected_n_palt": sprt["expected_n_palt"],
            "expected_n_reduction_p0": float(
                case95["n"] - sprt["expected_n_p0"]
            ),
            "expected_n_reduction_palt": float(
                case95["n"] - sprt["expected_n_palt"]
            ),
        },
        "oc_curve": {
            "rate": oc_rates.tolist(),
            "case95_accept_probability": case95_accept,
            "case95_reject_probability": case95_reject,
            "case90_accept_probability": case90_accept,
        },
        "two_cases_sample_size": {
            "case": ["case90", "case95"],
            "confidence_or_alpha": [accept_confidence, alpha],
            "n": [case90["n"], case95["n"]],
            "threshold": [case90["c"], case95["r"]],
        },
        "sensitivity": sensitivity,
        "sample_size_scan": scan,
        "sample_size_vs_confidence": confidence_scan,
        "cross_checks": {
            "case95_exact_tail_difference": float(exact_tail_check),
            "case95_exact_power_difference": float(exact_power_check),
            "case90_exact_acceptance_difference": float(
                exact_acceptance_check
            ),
        },
        "validation": checks,
    }

    payload = {"problem1": result}
    _write_json(payload, output_path)
    if not checks["all_passed"]:
        failed = [name for name, passed in checks.items() if not passed]
        raise RuntimeError("问题一验收失败：" + ", ".join(failed))
    return result


def run_problem1(output_path: str = OUTPUT_FILE) -> dict[str, Any]:
    return solve_problem1(output_path=output_path)


run = run_problem1
solve = solve_problem1


def main() -> None:
    solve_problem1()


if __name__ == "__main__":
    main()