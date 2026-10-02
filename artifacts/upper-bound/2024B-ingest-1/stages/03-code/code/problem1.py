"""问题一：精确二项整数枚举、OC 曲线与有限 SPRT 对照。"""

from __future__ import annotations

import json
import math
from fractions import Fraction
from pathlib import Path
from typing import Any

import scipy.stats

import params


def _validate_probability(name: str, value: float) -> None:
    if not math.isfinite(value) or not 0.0 <= value <= 1.0:
        raise ValueError(f"{name} must be a finite probability in [0, 1]")


def _exact_cdf(n: int, k: int, p: float) -> float:
    """用 scipy 的二项分布精确求和接口计算 P(X <= k)。"""

    _validate_probability("p", p)
    if n < 1:
        raise ValueError("n must be positive")
    if k < 0:
        return 0.0
    if k >= n:
        return 1.0
    return float(scipy.stats.binom.cdf(k, n, p))


def _exact_sf(n: int, k: int, p: float) -> float:
    """计算 P(X > k)；不使用整数与浮点直接相乘，避免大组合数溢出。"""

    _validate_probability("p", p)
    if n < 1:
        raise ValueError("n must be positive")
    if k < 0:
        return 1.0
    if k >= n:
        return 0.0
    return float(scipy.stats.binom.sf(k, n, p))


def _fraction_binomial_tail(n: int, k: int, p: float) -> Fraction:
    """以有理数逐项执行 exact_integer_enumeration。"""

    if n < 1:
        raise ValueError("n must be positive")
    probability = Fraction(str(float(p)))
    complement = Fraction(1, 1) - probability
    if k <= 0:
        return Fraction(1, 1)
    if k > n:
        return Fraction(0, 1)
    return sum(
        (
            math.comb(n, x)
            * probability**x
            * complement ** (n - x)
            for x in range(k, n + 1)
        ),
        Fraction(0, 1),
    )


def _fraction_binomial_cdf(n: int, k: int, p: float) -> Fraction:
    if k < 0:
        return Fraction(0, 1)
    if k >= n:
        return Fraction(1, 1)
    return Fraction(1, 1) - _fraction_binomial_tail(n, k + 1, p)


def _find_rejection_scheme(
    p0: float,
    p_alt: float,
    alpha: float,
    beta: float,
) -> dict[str, Any]:
    """从小到大枚举 n 和 r，执行双侧精确尾概率约束。"""

    _validate_probability("p0", p0)
    _validate_probability("p_alt", p_alt)
    _validate_probability("alpha", alpha)
    _validate_probability("beta", beta)
    if p_alt <= p0:
        raise ValueError("p_alt must be greater than p0")
    if not 0.0 < alpha < 1.0 or not 0.0 < beta < 1.0:
        raise ValueError("alpha and beta must lie strictly inside (0, 1)")

    required_power = 1.0 - beta
    for n in range(params.Q1_N_SEARCH_START, params.Q1_MAX_EXACT_SAMPLE_SIZE + 1):
        for r in range(n + 1):
            reject_tail_p0 = _exact_sf(n, r - 1, p0)
            reject_probability_p_alt = _exact_sf(n, r - 1, p_alt)
            alpha_pass = reject_tail_p0 <= alpha + params.Q1_NUMERIC_TOL
            power_pass = (
                reject_probability_p_alt
                >= required_power - params.Q1_NUMERIC_TOL
            )
            if alpha_pass and power_pass:
                feasible_r = [
                    candidate
                    for candidate in range(n + 1)
                    if _exact_sf(n, candidate - 1, p0)
                    <= alpha + params.Q1_NUMERIC_TOL
                    and _exact_sf(n, candidate - 1, p_alt)
                    >= required_power - params.Q1_NUMERIC_TOL
                ]
                return {
                    "found": True,
                    "n": n,
                    "r": r,
                    "p0": p0,
                    "p_alt": p_alt,
                    "alpha": alpha,
                    "beta": beta,
                    "required_power": required_power,
                    "reject_tail_p0": reject_tail_p0,
                    "reject_probability_p_alt": reject_probability_p_alt,
                    "feasible_r_count_at_selected_n": len(feasible_r),
                    "minimum_feasible_r_at_selected_n": min(feasible_r),
                    "maximum_feasible_r_at_selected_n": max(feasible_r),
                    "search_lower_bound": params.Q1_N_SEARCH_START,
                    "search_upper_bound": params.Q1_MAX_EXACT_SAMPLE_SIZE,
                    "search_exhausted": False,
                    "tie_break": params.Q1_REJECT_TIE_BREAK,
                    "alpha_constraint_pass": alpha_pass,
                    "power_constraint_pass": power_pass,
                }

    return {
        "found": False,
        "n": None,
        "r": None,
        "p0": p0,
        "p_alt": p_alt,
        "alpha": alpha,
        "beta": beta,
        "required_power": required_power,
        "reject_tail_p0": None,
        "reject_probability_p_alt": None,
        "search_lower_bound": params.Q1_N_SEARCH_START,
        "search_upper_bound": params.Q1_MAX_EXACT_SAMPLE_SIZE,
        "search_exhausted": True,
        "tie_break": params.Q1_REJECT_TIE_BREAK,
        "alpha_constraint_pass": False,
        "power_constraint_pass": False,
    }


def _find_acceptance_scheme(
    p0: float,
    confidence: float,
) -> dict[str, Any]:
    """枚举非空拒收区间的接收方案，并在同一 n 下选择最大的 c。

    c=n 会使接收区覆盖全部样本并使拒收区为空，不是可执行的两分判定，
    因而精确搜索使用 0 <= c < n；该有效性约束显式写入结果。
    """

    _validate_probability("p0", p0)
    _validate_probability("confidence", confidence)
    if not 0.0 < confidence < 1.0:
        raise ValueError("confidence must lie strictly inside (0, 1)")

    for n in range(params.Q1_N_SEARCH_START, params.Q1_MAX_EXACT_SAMPLE_SIZE + 1):
        for c in range(n - 1, -1, -1):
            accept_probability = _exact_cdf(n, c, p0)
            if accept_probability >= confidence - params.Q1_NUMERIC_TOL:
                return {
                    "found": True,
                    "n": n,
                    "c": c,
                    "p0": p0,
                    "confidence": confidence,
                    "alpha": 1.0 - confidence,
                    "accept_probability_p0": accept_probability,
                    "reject_tail_p0": 1.0 - accept_probability,
                    "nonempty_rejection_region": c < n,
                    "accept_all_candidate_excluded": True,
                    "search_lower_bound": params.Q1_N_SEARCH_START,
                    "search_upper_bound": params.Q1_MAX_EXACT_SAMPLE_SIZE,
                    "search_exhausted": False,
                    "tie_break": params.Q1_ACCEPT_TIE_BREAK,
                    "confidence_constraint_pass": (
                        accept_probability
                        >= confidence - params.Q1_NUMERIC_TOL
                    ),
                }

    return {
        "found": False,
        "n": None,
        "c": None,
        "p0": p0,
        "confidence": confidence,
        "alpha": 1.0 - confidence,
        "accept_probability_p0": None,
        "reject_tail_p0": None,
        "nonempty_rejection_region": None,
        "accept_all_candidate_excluded": True,
        "search_lower_bound": params.Q1_N_SEARCH_START,
        "search_upper_bound": params.Q1_MAX_EXACT_SAMPLE_SIZE,
        "search_exhausted": True,
        "tie_break": params.Q1_ACCEPT_TIE_BREAK,
        "confidence_constraint_pass": False,
    }


def _log_likelihood_ratio(n: int, x: int, p0: float, p_alt: float) -> float:
    return (
        x * math.log(p_alt / p0)
        + (n - x) * math.log((1.0 - p_alt) / (1.0 - p0))
    )


def _finite_sprt_for_rate(
    p: float,
    p0: float,
    p_alt: float,
    lower_acceptance_boundary: float,
    upper_rejection_boundary: float,
    max_steps: int,
    terminal_threshold: int,
) -> dict[str, Any]:
    """逐状态递推有限 likelihood_ratio_random_walk 的全部路径质量。"""

    if not 0.0 < p < 1.0:
        raise ValueError("finite SPRT path probabilities require 0 < p < 1")
    if max_steps < 1:
        raise ValueError("max_steps must be positive")
    if lower_acceptance_boundary >= upper_rejection_boundary:
        raise ValueError("SPRT boundaries are not ordered")

    active: dict[tuple[int, int], float] = {(0, 0): 1.0}
    survival_before_draw: list[float] = []
    accept_probability = 0.0
    reject_probability = 0.0
    truncated_probability = 0.0
    early_accept_probability = 0.0
    early_reject_probability = 0.0

    for drawn in range(1, max_steps + 1):
        survival_mass = sum(active.values())
        survival_before_draw.append(survival_mass)
        next_active: dict[tuple[int, int], float] = {}

        for (n_seen, x_seen), state_probability in active.items():
            transitions = (
                (n_seen + 1, x_seen, 1.0 - p),
                (n_seen + 1, x_seen + 1, p),
            )
            for n_next, x_next, transition_probability in transitions:
                path_mass = state_probability * transition_probability
                if path_mass == 0.0:
                    continue
                log_lr = _log_likelihood_ratio(n_next, x_next, p0, p_alt)

                if log_lr <= lower_acceptance_boundary:
                    accept_probability += path_mass
                    early_accept_probability += path_mass
                elif log_lr >= upper_rejection_boundary:
                    reject_probability += path_mass
                    early_reject_probability += path_mass
                elif drawn == max_steps:
                    truncated_probability += path_mass
                    if x_next >= terminal_threshold:
                        reject_probability += path_mass
                    else:
                        accept_probability += path_mass
                else:
                    state = (n_next, x_next)
                    next_active[state] = next_active.get(state, 0.0) + path_mass

        active = next_active
        if not active:
            break

    if active:
        raise RuntimeError("finite SPRT did not terminate all active paths")

    expected_n = sum(survival_before_draw)
    terminal_probability = accept_probability + reject_probability
    return {
        "rate": p,
        "expected_n": expected_n,
        "accept_probability": accept_probability,
        "reject_probability": reject_probability,
        "reject_tail": reject_probability,
        "early_accept_probability": early_accept_probability,
        "early_reject_probability": early_reject_probability,
        "truncated_probability": truncated_probability,
        "terminal_probability_sum": terminal_probability,
        "normalization_error": abs(terminal_probability - 1.0),
        "max_steps": max_steps,
        "terminal_reject_threshold": terminal_threshold,
    }


def _build_sprt(
    case95: dict[str, Any],
    alpha: float,
    beta: float,
) -> dict[str, Any]:
    p0 = float(case95["p0"])
    p_alt = float(case95["p_alt"])
    fixed_n = int(case95["n"])
    fixed_r = int(case95["r"])
    max_steps = max(
        params.Q1_N_SEARCH_START,
        int(fixed_n * params.Q1_SPRT_MAX_STEPS_FACTOR),
    )
    lower_acceptance_boundary = math.log(beta / (1.0 - alpha))
    upper_rejection_boundary = math.log((1.0 - beta) / alpha)
    required_power = 1.0 - beta

    candidate_summaries: list[dict[str, Any]] = []
    candidate_pairs: list[
        tuple[dict[str, Any], dict[str, Any], int]
    ] = []

    for threshold_offset in (0, -1, 1):
        terminal_threshold = fixed_r + threshold_offset
        at_p0 = _finite_sprt_for_rate(
            p0,
            p0,
            p_alt,
            lower_acceptance_boundary,
            upper_rejection_boundary,
            max_steps,
            terminal_threshold,
        )
        at_p_alt = _finite_sprt_for_rate(
            p_alt,
            p0,
            p_alt,
            lower_acceptance_boundary,
            upper_rejection_boundary,
            max_steps,
            terminal_threshold,
        )
        p0_constraint_pass = (
            at_p0["reject_tail"] <= alpha + params.Q1_NUMERIC_TOL
        )
        power_constraint_pass = (
            at_p_alt["reject_tail"]
            >= required_power - params.Q1_NUMERIC_TOL
        )
        summary = {
            "terminal_threshold_offset": threshold_offset,
            "terminal_reject_threshold": terminal_threshold,
            "expected_n_p0": at_p0["expected_n"],
            "expected_n_palt": at_p_alt["expected_n"],
            "reject_tail_p0": at_p0["reject_tail"],
            "reject_probability_palt": at_p_alt["reject_tail"],
            "p0_normalization_error": at_p0["normalization_error"],
            "palt_normalization_error": at_p_alt["normalization_error"],
            "p0_alpha_constraint_pass": p0_constraint_pass,
            "palt_power_constraint_pass": power_constraint_pass,
            "exact_constraints_pass": (
                p0_constraint_pass and power_constraint_pass
            ),
        }
        candidate_summaries.append(summary)
        candidate_pairs.append((at_p0, at_p_alt, threshold_offset))

    eligible = [
        item
        for item in candidate_pairs
        if (
            item[0]["reject_tail"] <= alpha + params.Q1_NUMERIC_TOL
            and item[1]["reject_tail"]
            >= required_power - params.Q1_NUMERIC_TOL
        )
    ]
    if eligible:
        at_p0, at_p_alt, selected_offset = min(
            eligible,
            key=lambda item: (
                item[0]["expected_n"] + item[1]["expected_n"],
                abs(item[2]),
            ),
        )
        constraints_pass = True
    else:
        at_p0, at_p_alt, selected_offset = candidate_pairs[0]
        constraints_pass = False

    expected_not_greater = (
        at_p0["expected_n"] <= fixed_n + params.Q1_NUMERIC_TOL
        and at_p_alt["expected_n"] <= fixed_n + params.Q1_NUMERIC_TOL
    )
    selected = constraints_pass and expected_not_greater
    if selected:
        selection_reason = (
            "finite SPRT passed both exact tail constraints and did not "
            "increase expected samples at either registered rate"
        )
    elif not constraints_pass:
        selection_reason = (
            "finite SPRT was retained as a rejected comparison because one or "
            "both exact tail constraints failed"
        )
    else:
        selection_reason = (
            "finite SPRT was retained as a rejected comparison because its "
            "expected sample count exceeded the fixed plan"
        )

    return {
        "enabled": params.Q1_SPRT_ENABLED,
        "method": params.Q1_SPRT_METHOD,
        "hypothesis_null_rate": p0,
        "hypothesis_alternative_rate": p_alt,
        "alpha": alpha,
        "beta": beta,
        "required_power": required_power,
        "a_sprt_lower_acceptance_boundary": lower_acceptance_boundary,
        "b_sprt_upper_rejection_boundary": upper_rejection_boundary,
        "max_steps": max_steps,
        "truncation_rule": params.Q1_SPRT_TRUNCATION_RULE,
        "fixed_plan_expected_n": fixed_n,
        "fixed_terminal_threshold": fixed_r,
        "selected_terminal_threshold_offset": selected_offset,
        "expected_n_p0": at_p0["expected_n"],
        "expected_n_palt": at_p_alt["expected_n"],
        "expected_n": at_p0["expected_n"],
        "accept_probability_p0": at_p0["accept_probability"],
        "reject_tail_p0": at_p0["reject_tail"],
        "accept_probability_palt": at_p_alt["accept_probability"],
        "reject_probability_palt": at_p_alt["reject_tail"],
        "early_accept_probability_p0": at_p0["early_accept_probability"],
        "early_reject_probability_p0": at_p0["early_reject_probability"],
        "truncated_probability_p0": at_p0["truncated_probability"],
        "terminal_probability_sum_p0": at_p0["terminal_probability_sum"],
        "terminal_probability_sum_palt": at_p_alt["terminal_probability_sum"],
        "normalization_error_p0": at_p0["normalization_error"],
        "normalization_error_palt": at_p_alt["normalization_error"],
        "exact_constraints_pass": constraints_pass,
        "expected_samples_not_greater_than_fixed": expected_not_greater,
        "selected": selected,
        "selection_rule": params.Q1_SPRT_SELECTION_RULE,
        "selection_reason": selection_reason,
        "terminal_threshold_calibration_candidates": candidate_summaries,
    }


def _build_sprt_boundary_curve(
    p0: float,
    p_alt: float,
    lower_acceptance_boundary: float,
    upper_rejection_boundary: float,
    max_steps: int,
) -> dict[str, Any]:
    sample_steps = {0, max_steps}
    sample_steps.update(
        sample
        for sample in params.Q1_SAMPLE_SIZE_SCAN_GRID
        if sample <= max_steps
    )
    ordered_steps = sorted(sample_steps)
    n_grid: list[int] = []
    accept_boundary_x: list[int | None] = []
    reject_boundary_x: list[int | None] = []
    continue_lower_x: list[int | None] = []
    continue_upper_x: list[int | None] = []

    for n in ordered_steps:
        accepted = [
            x
            for x in range(n + 1)
            if _log_likelihood_ratio(n, x, p0, p_alt)
            <= lower_acceptance_boundary
        ]
        rejected = [
            x
            for x in range(n + 1)
            if _log_likelihood_ratio(n, x, p0, p_alt)
            >= upper_rejection_boundary
        ]
        accept_max = max(accepted) if accepted else None
        reject_min = min(rejected) if rejected else None
        n_grid.append(n)
        accept_boundary_x.append(accept_max)
        reject_boundary_x.append(reject_min)
        continue_lower_x.append(
            reject_min + 1 if reject_min is not None else 0
        )
        continue_upper_x.append(
            accept_max - 1
            if accept_max is not None and accept_max > 0
            else None
        )

    return {
        "n_grid": n_grid,
        "accept_max_defect_count": accept_boundary_x,
        "reject_min_defect_count": reject_boundary_x,
        "continue_min_defect_count": continue_lower_x,
        "continue_max_defect_count": continue_upper_x,
        "a_sprt_lower_acceptance_boundary": lower_acceptance_boundary,
        "b_sprt_upper_rejection_boundary": upper_rejection_boundary,
        "finite_max_steps": max_steps,
        "decision_rule": (
            "accept when log_lr <= a_sprt; reject when log_lr >= b_sprt; "
            "otherwise continue until the registered finite truncation"
        ),
    }


def _build_confidence_curve(
    p0: float,
    p_alt: float,
    beta: float,
) -> dict[str, Any]:
    confidence_grid = list(params.Q1_CONFIDENCE_GRID)
    reject_n: list[int | None] = []
    reject_r: list[int | None] = []
    reject_tail: list[float | None] = []
    reject_power: list[float | None] = []
    accept_n: list[int | None] = []
    accept_c: list[int | None] = []
    accept_probability: list[float | None] = []

    for confidence in confidence_grid:
        rejection = _find_rejection_scheme(
            p0=p0,
            p_alt=p_alt,
            alpha=1.0 - confidence,
            beta=beta,
        )
        acceptance = _find_acceptance_scheme(
            p0=p0,
            confidence=confidence,
        )
        reject_n.append(rejection["n"])
        reject_r.append(rejection["r"])
        reject_tail.append(rejection["reject_tail_p0"])
        reject_power.append(rejection["reject_probability_p_alt"])
        accept_n.append(acceptance["n"])
        accept_c.append(acceptance["c"])
        accept_probability.append(acceptance["accept_probability_p0"])

    monotone = True
    previous_n: int | None = None
    for n in reject_n:
        if n is None:
            continue
        if previous_n is not None and n < previous_n:
            monotone = False
            break
        previous_n = n

    return {
        "confidence_grid": confidence_grid,
        "rejection_alpha_grid": [1.0 - value for value in confidence_grid],
        "rejection_n": reject_n,
        "rejection_r": reject_r,
        "rejection_tail_at_p0": reject_tail,
        "rejection_power_at_palt": reject_power,
        "acceptance_n_nontrivial_plan": accept_n,
        "acceptance_c_nontrivial_plan": accept_c,
        "acceptance_probability_at_p0": accept_probability,
        "rejection_n_monotone_non_decreasing": monotone,
        "search_method": params.Q1_METHOD,
    }


def _build_delta_beta_sensitivity(p0: float) -> dict[str, Any]:
    records: list[dict[str, Any]] = []
    monotone_by_beta: dict[str, bool] = {}

    for beta in params.Q1_BETA_GRID:
        previous_n: int | None = None
        monotone = True
        for delta in params.Q1_DELTA_GRID:
            p_alt = p0 + delta
            if p_alt > 1.0:
                records.append(
                    {
                        "delta": delta,
                        "beta": beta,
                        "p_alt": p_alt,
                        "found": False,
                        "n": None,
                        "r": None,
                        "reject_tail_p0": None,
                        "reject_probability_palt": None,
                        "reason": "alternative rate is outside the probability domain",
                    }
                )
                continue
            scheme = _find_rejection_scheme(
                p0=p0,
                p_alt=p_alt,
                alpha=params.Q1_REJECT_ALPHA,
                beta=beta,
            )
            record = {
                "delta": delta,
                "beta": beta,
                "p_alt": p_alt,
                "found": scheme["found"],
                "n": scheme["n"],
                "r": scheme["r"],
                "reject_tail_p0": scheme["reject_tail_p0"],
                "reject_probability_palt": scheme[
                    "reject_probability_palt"
                ],
                "alpha_constraint_pass": scheme["alpha_constraint_pass"],
                "power_constraint_pass": scheme["power_constraint_pass"],
            }
            records.append(record)
            if scheme["n"] is not None:
                if previous_n is not None and scheme["n"] < previous_n:
                    monotone = False
                previous_n = scheme["n"]
        monotone_by_beta[str(beta)] = monotone

    return {
        "records": records,
        "delta_grid": list(params.Q1_DELTA_GRID),
        "beta_grid": list(params.Q1_BETA_GRID),
        "n_monotone_in_delta_by_beta": monotone_by_beta,
    }


def _build_oc_curve(
    case95: dict[str, Any],
    case90: dict[str, Any],
    p0: float,
) -> dict[str, Any]:
    base_grid = list(params.Q1_SAMPLE_SIZE_SCAN_GRID)
    divisor = len(base_grid) - 1
    if divisor < 1:
        raise ValueError("the registered scan grid must contain at least two points")
    p_values = sorted(
        {index / divisor for index in range(len(base_grid))}
        | {p0, float(case95["p_alt"])}
    )
    reject_threshold = int(case95["r"]) - 1
    accept_threshold = int(case90["c"])
    case95_acceptance: list[float] = []
    case95_rejection: list[float] = []
    case90_acceptance: list[float] = []

    for p_value in p_values:
        case95_acceptance.append(
            _exact_cdf(int(case95["n"]), reject_threshold, p_value)
        )
        case95_rejection.append(
            _exact_sf(int(case95["n"]), reject_threshold, p_value)
        )
        case90_acceptance.append(
            _exact_cdf(int(case90["n"]), accept_threshold, p_value)
        )

    def nonincreasing(values: list[float]) -> bool:
        return all(
            values[index + 1]
            <= values[index] + params.Q1_NUMERIC_TOL
            for index in range(len(values) - 1)
        )

    def nondecreasing(values: list[float]) -> bool:
        return all(
            values[index + 1]
            >= values[index] - params.Q1_NUMERIC_TOL
            for index in range(len(values) - 1)
        )

    return {
        "p_grid": p_values,
        "case95_acceptance_probability": case95_acceptance,
        "case95_rejection_probability": case95_rejection,
        "case90_acceptance_probability": case90_acceptance,
        "nominal_rate": p0,
        "alternative_rate": float(case95["p_alt"]),
        "case95_n": int(case95["n"]),
        "case95_r": int(case95["r"]),
        "case90_n": int(case90["n"]),
        "case90_c": int(case90["c"]),
        "case95_acceptance_monotone_nonincreasing": nonincreasing(
            case95_acceptance
        ),
        "case90_acceptance_monotone_nonincreasing": nonincreasing(
            case90_acceptance
        ),
        "case95_rejection_monotone_nondecreasing": nondecreasing(
            case95_rejection
        ),
    }


def _resolve_output_path(output_path: str | Path | None) -> Path:
    if output_path is None:
        return params.CODE_DIR / params.PROBLEM1_RESULT_FILE
    candidate = Path(output_path)
    if candidate.exists() and candidate.is_dir():
        return candidate / params.PROBLEM1_RESULT_FILE
    if not candidate.suffix:
        return candidate / params.PROBLEM1_RESULT_FILE
    return candidate


def _json_ready(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _json_ready(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_ready(item) for item in value]
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, int):
        return int(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("non-finite values are forbidden in result JSON")
        return float(value)
    return value


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(
        _json_ready(payload),
        ensure_ascii=False,
        indent=params.JSON_INDENT,
        allow_nan=False,
    )
    temporary = path.with_suffix(".tmp")
    temporary.write_text(text + "\n", encoding="utf-8")
    temporary.replace(path)


def run_problem1(
    output_path: str | Path | None = None,
) -> dict[str, Any]:
    """执行问题一全部计算并同步写入 problem1_results.json。"""

    p0 = params.Q1_NOMINAL_DEFECT_RATE
    p_alt = params.Q1_ALTERNATIVE_DEFECT_RATE
    alpha = params.Q1_REJECT_ALPHA
    beta = params.Q1_TYPE_II_ERROR

    case95 = _find_rejection_scheme(
        p0=p0,
        p_alt=p_alt,
        alpha=alpha,
        beta=beta,
    )
    if not case95["found"]:
        raise RuntimeError("the registered Q1 rejection scheme was not found")

    case90 = _find_acceptance_scheme(
        p0=p0,
        confidence=params.Q1_ACCEPT_CONFIDENCE,
    )
    if not case90["found"]:
        raise RuntimeError("the registered Q1 acceptance scheme was not found")

    exact_reject_tail_p0 = _fraction_binomial_tail(
        int(case95["n"]), int(case95["r"]) - 1, p0
    )
    exact_reject_probability_p_alt = _fraction_binomial_tail(
        int(case95["n"]), int(case95["r"]) - 1, p_alt
    )
    exact_accept_probability_p0 = _fraction_binomial_cdf(
        int(case90["n"]), int(case90["c"]), p0
    )
    exact_reject_tail_p0_value = float(exact_reject_tail_p0)
    exact_reject_probability_p_alt_value = float(
        exact_reject_probability_p_alt
    )
    exact_accept_probability_p0_value = float(
        exact_accept_probability_p0
    )

    reference_error_p0 = abs(
        float(case95["reject_tail_p0"]) - exact_reject_tail_p0_value
    )
    reference_error_palt = abs(
        float(case95["reject_probability_p_alt"])
        - exact_reject_probability_p_alt_value
    )
    acceptance_reference_error = abs(
        float(case90["accept_probability_p0"])
        - exact_accept_probability_p0_value
    )

    case95.update(
        {
            "case_label": "95%拒收情形",
            "decision_rule": "reject if X >= r",
            "unit_n": params.UNIT_SAMPLE,
            "unit_threshold": params.UNIT_COUNT,
            "exact_rational_reject_tail_p0": exact_reject_tail_p0_value,
            "exact_rational_reject_probability_palt": (
                exact_reject_probability_p_alt_value
            ),
            "scipy_vs_exact_integer_error_p0": reference_error_p0,
            "scipy_vs_exact_integer_error_palt": reference_error_palt,
            "alpha_margin": alpha - exact_reject_tail_p0_value,
            "power_margin": (
                exact_reject_probability_p_alt_value - (1.0 - beta)
            ),
        }
    )
    case90.update(
        {
            "case_label": "90%接收情形",
            "decision_rule": "accept if X <= c; reject otherwise",
            "unit_n": params.UNIT_SAMPLE,
            "unit_threshold": params.UNIT_COUNT,
            "exact_rational_accept_probability_p0": (
                exact_accept_probability_p0_value
            ),
            "scipy_vs_exact_integer_error": acceptance_reference_error,
            "confidence_margin": (
                exact_accept_probability_p0_value
                - params.Q1_ACCEPT_CONFIDENCE
            ),
        }
    )

    sprt = _build_sprt(case95, alpha, beta)
    sprt_boundary = _build_sprt_boundary_curve(
        p0=p0,
        p_alt=p_alt,
        lower_acceptance_boundary=sprt[
            "a_sprt_lower_acceptance_boundary"
        ],
        upper_rejection_boundary=sprt[
            "b_sprt_upper_rejection_boundary"
        ],
        max_steps=int(sprt["max_steps"]),
    )
    confidence_curve = _build_confidence_curve(
        p0=p0,
        p_alt=p_alt,
        beta=beta,
    )
    sensitivity = _build_delta_beta_sensitivity(p0)
    oc_curve = _build_oc_curve(case95, case90, p0)

    exact_case95_alpha_pass = (
        exact_reject_tail_p0_value <= alpha + params.Q1_NUMERIC_TOL
    )
    exact_case95_power_pass = (
        exact_reject_probability_p_alt_value
        >= 1.0 - beta - params.Q1_NUMERIC_TOL
    )
    exact_case90_pass = (
        exact_accept_probability_p0_value
        >= params.Q1_ACCEPT_CONFIDENCE - params.Q1_NUMERIC_TOL
    )
    max_reference_error = max(
        reference_error_p0,
        reference_error_palt,
        acceptance_reference_error,
    )
    reference_tolerance_pass = (
        max_reference_error <= params.Q1_NUMERIC_TOL
    )
    sprt_normalization_pass = (
        max(
            float(sprt["normalization_error_p0"]),
            float(sprt["normalization_error_palt"]),
        )
        <= params.Q1_NUMERIC_TOL
    )

    result: dict[str, Any] = {
        "schema": "problem1_exact_binomial_and_finite_sprt",
        "method": params.Q1_METHOD,
        "sprt_method": params.Q1_SPRT_METHOD,
        "inputs": {
            "p0": p0,
            "reject_confidence": params.Q1_REJECT_CONFIDENCE,
            "reject_alpha": alpha,
            "accept_confidence": params.Q1_ACCEPT_CONFIDENCE,
            "accept_alpha": params.Q1_ACCEPT_ALPHA,
            "design_delta": params.Q1_ALTERNATIVE_DELTA,
            "design_beta": beta,
            "p_alt": p_alt,
            "numeric_tolerance": params.Q1_NUMERIC_TOL,
            "fixed_tie_break": params.Q1_FIXED_TIE_BREAK,
            "fact_ids": list(params.Q1_FACT_IDS),
            "risk_design_source": "A-010",
        },
        "case95": case95,
        "case90": case90,
        "sprt": sprt,
        "oc_curve": oc_curve,
        "sample_size_vs_confidence": confidence_curve,
        "two_case_sample_size": {
            "case_labels": ["95%拒收情形", "90%接收情形"],
            "sample_size": [int(case95["n"]), int(case90["n"])],
            "critical_count": [int(case95["r"]), int(case90["c"])],
            "tail_probability_at_p0": [
                float(case95["reject_tail_p0"]),
                float(case90["accept_probability_p0"]),
            ],
        },
        "sensitivity_delta_beta": sensitivity,
        "sprt_boundary": sprt_boundary,
        "validation": {
            "exact_case95_alpha_constraint_pass": exact_case95_alpha_pass,
            "exact_case95_power_constraint_pass": exact_case95_power_pass,
            "exact_case90_confidence_constraint_pass": exact_case90_pass,
            "reference_tolerance": params.Q1_NUMERIC_TOL,
            "maximum_scipy_vs_exact_integer_error": max_reference_error,
            "reference_tolerance_pass": reference_tolerance_pass,
            "oc_monotonicity_pass": bool(
                oc_curve["case95_acceptance_monotone_nonincreasing"]
                and oc_curve["case90_acceptance_monotone_nonincreasing"]
                and oc_curve[
                    "case95_rejection_monotone_nondecreasing"
                ]
            ),
            "sprt_terminal_probability_normalization_pass": (
                sprt_normalization_pass
            ),
            "sprt_exact_constraints_pass": sprt[
                "exact_constraints_pass"
            ],
            "sprt_selected": sprt["selected"],
            "fixed_plan_validation_pass": bool(
                exact_case95_alpha_pass
                and exact_case95_power_pass
                and exact_case90_pass
                and reference_tolerance_pass
            ),
            "all_required_results_computed": True,
        },
        "result_anchors": {
            "R-Q1-case95-n": int(case95["n"]),
            "R-Q1-case95-r": int(case95["r"]),
            "R-Q1-case95-reject-tail": float(
                case95["reject_tail_p0"]
            ),
            "R-Q1-case90-n": int(case90["n"]),
            "R-Q1-case90-c": int(case90["c"]),
            "R-Q1-case90-accept-tail": float(
                case90["accept_probability_p0"]
            ),
            "R-Q1-sprt-expected-n": float(sprt["expected_n_p0"]),
            "R-Q1-sprt-selected": bool(sprt["selected"]),
        },
    }

    destination = _resolve_output_path(output_path)
    _write_json(destination, result)
    return result


def solve_problem1(
    output_path: str | Path | None = None,
) -> dict[str, Any]:
    return run_problem1(output_path=output_path)


def main() -> dict[str, Any]:
    return run_problem1()


solve = solve_problem1
run = run_problem1
generate_results = run_problem1


if __name__ == "__main__":
    main()