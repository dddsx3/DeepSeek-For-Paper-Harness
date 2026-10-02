# -*- coding: utf-8 -*-
"""问题一：精确二项整数枚举、OC 曲线与有限 SPRT 对照。"""

from __future__ import annotations

import math
from collections.abc import Iterable, Sequence

import params
from params import *  # noqa: F401,F403
from scipy.stats import binom


def _validate_probability(probability: float, name: str) -> float:
    value = float(probability)
    if not math.isfinite(value) or value < 0 or value > 1:
        raise ValueError(f"{name} 必须位于概率域内")
    return value


def _validate_counts(n: int, threshold: int) -> None:
    if n < 1:
        raise ValueError("样本量必须为正整数")
    if threshold < -1 or threshold > n:
        raise ValueError("二项计数阈值越界")


def exact_integer_enumeration(
    n: int,
    cutoff: int,
    probability: float,
    tail: str,
) -> float:
    """逐个整数计数求和，作为 scipy.stats.binom 尾概率的独立复核。"""
    _validate_counts(n, cutoff)
    probability = _validate_probability(probability, "binomial_probability")
    probabilities = (
        float(binom.pmf(count, n, probability))
        for count in range(n + 1)
    )
    if tail == "upper":
        selected = probabilities
    elif tail == "lower":
        selected = (
            float(binom.pmf(count, n, probability))
            for count in range(cutoff + 1)
        )
    else:
        raise ValueError(f"未知尾概率类型: {tail}")
    return math.fsum(selected)


def _upper_tail(n: int, threshold: int, probability: float) -> float:
    """P(X >= threshold)，threshold 为零时表示从零开始求和。"""
    _validate_counts(n, threshold)
    probability = _validate_probability(probability, "tail_probability")
    return float(binom.sf(threshold - 1, n, probability))


def _lower_tail(n: int, threshold: int, probability: float) -> float:
    """P(X <= threshold)。"""
    _validate_counts(n, threshold)
    probability = _validate_probability(probability, "tail_probability")
    return float(binom.cdf(threshold, n, probability))


def _is_nondecreasing(values: Sequence[float], tolerance: float) -> bool:
    return all(
        current + tolerance >= previous
        for previous, current in zip(values, values[1:])
    )


def _is_nonincreasing(values: Sequence[float], tolerance: float) -> bool:
    return all(
        current <= previous + tolerance
        for previous, current in zip(values, values[1:])
    )


def _find_rejection_scheme(
    delta: float,
    beta: float,
    *,
    require_power: bool,
) -> dict[str, object]:
    """按样本量、阈值作字典序搜索最小拒收方案。

    ``require_power=False`` 只使用题面拒收置信约束；``True`` 再加入
    登记的备择率幅度与第二类错误上限。后者是条件运营方案，不冒充
    仅由题面两个事实唯一决定的样本量。
    """
    p0 = _validate_probability(P0, "p0")
    delta = _validate_probability(delta, "delta")
    beta = _validate_probability(beta, "beta")
    if not require_power and delta < 0:
        raise ValueError("超标幅度不能为负")

    p_alt = p0 + delta
    if p_alt > 1:
        raise ValueError("备择率超出概率域")
    power_floor = 1 - beta

    for n in range(1, Q1_N_MAX + 1):
        for r in range(n + 1):
            reject_tail = _upper_tail(n, r, p0)
            if reject_tail > ALPHA_REJECT + Q1_NUMERIC_TOL:
                continue

            power_at_alt = _upper_tail(n, r, p_alt)
            if require_power and power_at_alt < power_floor - Q1_NUMERIC_TOL:
                continue

            return {
                "n": n,
                "r": r,
                "decision_rule": "X>=r 时拒收，否则接收",
                "p0": p0,
                "p_alt": p_alt if require_power else None,
                "beta": beta if require_power else None,
                "rejection_probability_at_p0": reject_tail,
                "power_at_p_alt": power_at_alt if require_power else None,
                "alpha_margin": ALPHA_REJECT - reject_tail,
                "power_margin": (
                    power_at_alt - power_floor if require_power else None
                ),
                "tested_n_count": n,
                "tested_threshold_count_at_selected_n": r + 1,
                "tie_break_rule": Q1_TIE_BREAK_RULE,
                "search_upper_bound": Q1_N_MAX,
            }

    raise RuntimeError(
        "拒收方案搜索达到登记上界仍未找到可行整数方案"
    )


def _find_acceptance_scheme() -> dict[str, object]:
    """搜索题面接收置信约束下的最小样本量，并取最大可行阈值。"""
    p0 = _validate_probability(P0, "p0")
    for n in range(1, Q1_N_MAX + 1):
        for c in range(n, -1, -1):
            acceptance_probability = _lower_tail(n, c, p0)
            if acceptance_probability + Q1_NUMERIC_TOL < ACCEPT_CONFIDENCE:
                continue
            return {
                "n": n,
                "c": c,
                "decision_rule": "X<=c 时接收，否则拒收",
                "p0": p0,
                "required_confidence": ACCEPT_CONFIDENCE,
                "acceptance_probability_at_p0": acceptance_probability,
                "confidence_margin": (
                    acceptance_probability - ACCEPT_CONFIDENCE
                ),
                "decision_is_nontrivial": c < n,
                "tested_n_count": n,
                "tested_threshold_count_at_selected_n": c + 1,
                "tie_break_rule": "minimum_n_then_largest_feasible_c",
                "search_upper_bound": Q1_N_MAX,
            }

    raise RuntimeError(
        "接收方案搜索达到登记上界仍未找到可行整数方案"
    )


def _verify_rejection_minimality(
    selected: dict[str, object],
    delta: float,
    beta: float,
    *,
    require_power: bool,
) -> dict[str, object]:
    n_star = int(selected["n"])
    r_star = int(selected["r"])
    p_alt = P0 + delta
    smaller_feasible_n = []

    for n in range(1, n_star):
        for r in range(n + 1):
            reject_tail = _upper_tail(n, r, P0)
            if reject_tail > ALPHA_REJECT + Q1_NUMERIC_TOL:
                continue
            if require_power:
                power = _upper_tail(n, r, p_alt)
                if power < 1 - beta - Q1_NUMERIC_TOL:
                    continue
            smaller_feasible_n.append(n)
            break

    selected_tail = _upper_tail(n_star, r_star, P0)
    feasible_at_selected = (
        selected_tail <= ALPHA_REJECT + Q1_NUMERIC_TOL
    )
    if require_power:
        feasible_at_selected = feasible_at_selected and (
            _upper_tail(n_star, r_star, p_alt)
            >= 1 - beta - Q1_NUMERIC_TOL
        )

    return {
        "smaller_feasible_n_count": len(smaller_feasible_n),
        "smaller_feasible_n": smaller_feasible_n,
        "selected_scheme_feasible": feasible_at_selected,
        "minimality_passed": not smaller_feasible_n and feasible_at_selected,
    }


def _verify_acceptance_minimality(
    selected: dict[str, object],
) -> dict[str, object]:
    n_star = int(selected["n"])
    c_star = int(selected["c"])
    smaller_feasible_n = []

    for n in range(1, n_star):
        feasible = any(
            _lower_tail(n, c, P0)
            >= ACCEPT_CONFIDENCE - Q1_NUMERIC_TOL
            for c in range(n + 1)
        )
        if feasible:
            smaller_feasible_n.append(n)

    selected_feasible = (
        _lower_tail(n_star, c_star, P0)
        >= ACCEPT_CONFIDENCE - Q1_NUMERIC_TOL
    )
    return {
        "smaller_feasible_n_count": len(smaller_feasible_n),
        "smaller_feasible_n": smaller_feasible_n,
        "selected_scheme_feasible": selected_feasible,
        "minimality_passed": (
            not smaller_feasible_n and selected_feasible
        ),
    }


def _classify_log_likelihood_ratio(
    log_ratio: float,
    observed_count: int,
    truncation_n: int,
    acceptance_boundary: float,
    rejection_boundary: float,
    truncation_threshold: float,
) -> str:
    if log_ratio <= acceptance_boundary + Q1_NUMERIC_TOL:
        return "accept_boundary"
    if log_ratio >= rejection_boundary - Q1_NUMERIC_TOL:
        return "reject_boundary"
    if observed_count == truncation_n:
        if log_ratio >= truncation_threshold - Q1_NUMERIC_TOL:
            return "truncated_reject"
        return "truncated_accept"
    return "continue"


def likelihood_ratio_random_walk(
    truncation_n: int,
    probability: float,
    p0: float,
    p_alt: float,
    beta: float,
) -> dict[str, object]:
    """以精确伯努利路径质量递推有限似然比随机游走。"""
    if truncation_n < 1:
        raise ValueError("SPRT 截断样本量必须为正整数")
    probability = _validate_probability(probability, "walk_probability")
    p0 = _validate_probability(p0, "walk_null_rate")
    p_alt = _validate_probability(p_alt, "walk_alternative_rate")
    beta = _validate_probability(beta, "walk_type_ii_error")
    if p_alt <= p0:
        raise ValueError("SPRT 备择率必须高于原假设率")

    defect_log_increment = math.log(p_alt / p0)
    good_log_increment = math.log((1 - p_alt) / (1 - p0))
    acceptance_boundary = math.log(beta / (1 - ALPHA_REJECT))
    rejection_boundary = math.log((1 - beta) / ALPHA_REJECT)
    truncation_threshold = math.log(1 / (1 - beta))

    continuation: dict[tuple[int, int], float] = {(0, 0): 1.0}
    survival_probabilities: list[float] = []
    accepted_by_boundary: list[float] = []
    rejected_by_boundary: list[float] = []
    accepted_by_truncation: list[float] = []
    rejected_by_truncation: list[float] = []
    survival_after_draw: list[float] = []

    for observed_count in range(truncation_n):
        survival_probabilities.append(math.fsum(continuation.values()))
        next_continuation: dict[tuple[int, int], float] = {}
        accept_boundary_mass = 0.0
        reject_boundary_mass = 0.0
        accept_truncation_mass = 0.0
        reject_truncation_mass = 0.0

        for (seen, defect_count), _ in continuation.items():
            next_seen = seen + 1
            if defect_count < seen:
                next_defect_count = defect_count + 1
            else:
                next_defect_count = defect_count

            log_ratio = (
                next_defect_count * defect_log_increment
                + (next_seen - next_defect_count) * good_log_increment
            )
            path_probability = float(
                binom.pmf(next_defect_count, next_seen, probability)
            )
            region = _classify_log_likelihood_ratio(
                log_ratio,
                next_seen,
                truncation_n,
                acceptance_boundary,
                rejection_boundary,
                truncation_threshold,
            )

            if region == "accept_boundary":
                accept_boundary_mass += path_probability
            elif region == "reject_boundary":
                reject_boundary_mass += path_probability
            elif region == "truncated_accept":
                accept_truncation_mass += path_probability
            elif region == "truncated_reject":
                reject_truncation_mass += path_probability
            else:
                next_continuation[(next_seen, next_defect_count)] = (
                    path_probability
                )

        continuation = next_continuation
        accepted_by_boundary.append(accept_boundary_mass)
        rejected_by_boundary.append(reject_boundary_mass)
        accepted_by_truncation.append(accept_truncation_mass)
        rejected_by_truncation.append(reject_truncation_mass)
        survival_after_draw.append(math.fsum(continuation.values()))

    if continuation:
        raise RuntimeError("有限 SPRT 在登记截断点后仍有未分类路径")

    accepted_at_boundary = math.fsum(accepted_by_boundary)
    rejected_at_boundary = math.fsum(rejected_by_boundary)
    accepted_at_truncation = math.fsum(accepted_by_truncation)
    rejected_at_truncation = math.fsum(rejected_by_truncation)
    accept_probability = (
        accepted_at_boundary + accepted_at_truncation
    )
    reject_probability = (
        rejected_at_boundary + rejected_at_truncation
    )
    expected_samples = math.fsum(survival_probabilities)

    return {
        "probability": probability,
        "truncation_n": truncation_n,
        "expected_samples": expected_samples,
        "acceptance_probability": accept_probability,
        "rejection_probability": reject_probability,
        "type_ii_error": accept_probability,
        "power": reject_probability,
        "terminal_probability_sum": accept_probability + reject_probability,
        "acceptance_boundary": acceptance_boundary,
        "rejection_boundary": rejection_boundary,
        "truncation_threshold": truncation_threshold,
        "defect_log_increment": defect_log_increment,
        "good_log_increment": good_log_increment,
        "accepted_at_boundary_probability": accepted_at_boundary,
        "rejected_at_boundary_probability": rejected_at_boundary,
        "accepted_at_truncation_probability": accepted_at_truncation,
        "rejected_at_truncation_probability": rejected_at_truncation,
        "survival_before_draw": survival_probabilities,
        "survival_after_draw": survival_after_draw,
        "acceptance_cdf_after_draw": [
            math.fsum(accepted_by_boundary[: draw + 1])
            + math.fsum(accepted_by_truncation[: draw + 1])
            for draw in range(truncation_n)
        ],
        "rejection_cdf_after_draw": [
            math.fsum(rejected_by_boundary[: draw + 1])
            + math.fsum(rejected_by_truncation[: draw + 1])
            for draw in range(truncation_n)
        ],
    }


def _sprt_boundary_grid(
    truncation_n: int,
    p0: float,
    p_alt: float,
    beta: float,
) -> dict[str, object]:
    defect_log_increment = math.log(p_alt / p0)
    good_log_increment = math.log((1 - p_alt) / (1 - p0))
    acceptance_boundary = math.log(beta / (1 - ALPHA_REJECT))
    rejection_boundary = math.log((1 - beta) / ALPHA_REJECT)
    truncation_threshold = math.log(1 / (1 - beta))

    sample_counts: list[int] = []
    defect_counts: list[int] = []
    log_ratios: list[float] = []
    regions: list[str] = []

    for observed_count in range(truncation_n + 1):
        for defect_count in range(observed_count + 1):
            log_ratio = (
                defect_count * defect_log_increment
                + (observed_count - defect_count) * good_log_increment
            )
            sample_counts.append(observed_count)
            defect_counts.append(defect_count)
            log_ratios.append(log_ratio)
            regions.append(
                _classify_log_likelihood_ratio(
                    log_ratio,
                    observed_count,
                    truncation_n,
                    acceptance_boundary,
                    rejection_boundary,
                    truncation_threshold,
                )
            )

    return {
        "sample_count": sample_counts,
        "defect_count": defect_counts,
        "log_likelihood_ratio": log_ratios,
        "region": regions,
        "acceptance_boundary": acceptance_boundary,
        "rejection_boundary": rejection_boundary,
        "truncation_threshold": truncation_threshold,
    }


def _summarize_sprt_design(
    design: dict[str, object],
    fixed_n: int,
) -> dict[str, object]:
    truncation_n = int(design["n"])
    p_alt = float(design["p_alt"])
    beta = float(design["beta"])
    null_walk = likelihood_ratio_random_walk(
        truncation_n, P0, P0, p_alt, beta
    )
    alternative_walk = likelihood_ratio_random_walk(
        truncation_n, p_alt, P0, p_alt, beta
    )

    alpha_constraint_passed = (
        null_walk["rejection_probability"]
        <= ALPHA_REJECT + Q1_NUMERIC_TOL
    )
    power_constraint_passed = (
        alternative_walk["rejection_probability"]
        >= 1 - beta - Q1_NUMERIC_TOL
    )
    expected_null_passed = (
        null_walk["expected_samples"]
        <= fixed_n + Q1_NUMERIC_TOL
    )
    expected_alternative_passed = (
        alternative_walk["expected_samples"]
        <= fixed_n + Q1_NUMERIC_TOL
    )
    admissible = (
        alpha_constraint_passed
        and power_constraint_passed
        and expected_null_passed
        and expected_alternative_passed
    )

    return {
        "delta": design["delta"],
        "beta": beta,
        "p_alt": p_alt,
        "fixed_n": fixed_n,
        "truncation_n": truncation_n,
        "expected_n_at_p0": null_walk["expected_samples"],
        "expected_n_at_p_alt": alternative_walk["expected_samples"],
        "rejection_probability_at_p0": null_walk[
            "rejection_probability"
        ],
        "type_ii_error_at_p_alt": alternative_walk[
            "acceptance_probability"
        ],
        "power_at_p_alt": alternative_walk["rejection_probability"],
        "alpha_constraint_passed": alpha_constraint_passed,
        "power_constraint_passed": power_constraint_passed,
        "expected_n_at_p0_constraint_passed": expected_null_passed,
        "expected_n_at_p_alt_constraint_passed": (
            expected_alternative_passed
        ),
        "admissible": admissible,
        "probability_closure_residual_at_p0": abs(
            null_walk["terminal_probability_sum"] - 1
        ),
        "probability_closure_residual_at_p_alt": abs(
            alternative_walk["terminal_probability_sum"] - 1
        ),
    }


def run() -> dict[str, object]:
    """执行问题一全部精确计算并返回可序列化结果账本。"""
    _ = params
    p0 = _validate_probability(P0, "P0")
    delta = _validate_probability(
        Q1_ALTERNATIVE_DELTA,
        "Q1_ALTERNATIVE_DELTA",
    )
    beta = _validate_probability(
        Q1_TYPE_II_ERROR,
        "Q1_TYPE_II_ERROR",
    )
    if delta <= 0:
        raise ValueError("登记备择幅度必须为正")
    if p0 + delta > 1:
        raise ValueError("登记备择率超出概率域")
    if not 0 < beta < 1:
        raise ValueError("登记第二类错误必须位于概率域内部")
    if ALPHA_REJECT <= 0 or ALPHA_REJECT >= 1:
        raise ValueError("拒收第一类错误越界")
    if ACCEPT_CONFIDENCE <= 0 or ACCEPT_CONFIDENCE >= 1:
        raise ValueError("接收置信水平越界")

    confidence_only = _find_rejection_scheme(
        delta,
        beta,
        require_power=False,
    )
    operational = _find_rejection_scheme(
        delta,
        beta,
        require_power=True,
    )
    acceptance = _find_acceptance_scheme()

    confidence_only_verification = _verify_rejection_minimality(
        confidence_only,
        delta,
        beta,
        require_power=False,
    )
    operational_verification = _verify_rejection_minimality(
        operational,
        delta,
        beta,
        require_power=True,
    )
    acceptance_verification = _verify_acceptance_minimality(acceptance)

    delta_grid = Q1_DELTA_GRID
    beta_grid = Q1_BETA_GRID
    sensitivity_designs: list[dict[str, object]] = []

    for delta_value in delta_grid:
        for beta_value in beta_grid:
            design = _find_rejection_scheme(
                delta_value,
                beta_value,
                require_power=True,
            )
            row = {
                "delta": delta_value,
                "beta": beta_value,
                "p_alt": design["p_alt"],
                "n": design["n"],
                "r": design["r"],
                "rejection_probability_at_p0": design[
                    "rejection_probability_at_p0"
                ],
                "power_at_p_alt": design["power_at_p_alt"],
                "alpha_margin": design["alpha_margin"],
                "power_margin": design["power_margin"],
                "registered_baseline": (
                    abs(delta_value - delta) <= Q1_NUMERIC_TOL
                    and abs(beta_value - beta) <= Q1_NUMERIC_TOL
                ),
            }
            sensitivity_designs.append(design)
            sensitivity_rows = locals().get("sensitivity_rows", [])
            sensitivity_rows.append(row)

    delta_monotonicity = []
    for delta_value in delta_grid:
        selected_rows = [
            row
            for row in sensitivity_rows
            if abs(row["delta"] - delta_value) <= Q1_NUMERIC_TOL
        ]
        selected_rows.sort(key=lambda row: row["beta"])
        delta_monotonicity.append(
            {
                "delta": delta_value,
                "n_in_beta_order": [
                    row["n"] for row in selected_rows
                ],
                "beta_in_order": [
                    row["beta"] for row in selected_rows
                ],
                "n_nonincreasing_as_beta_rises": (
                    _is_nonincreasing(
                        [row["n"] for row in selected_rows],
                        Q1_NUMERIC_TOL,
                    )
                ),
            }
        )

    beta_monotonicity = []
    for beta_value in beta_grid:
        selected_rows = [
            row
            for row in sensitivity_rows
            if abs(row["beta"] - beta_value) <= Q1_NUMERIC_TOL
        ]
        selected_rows.sort(key=lambda row: row["delta"])
        beta_monotonicity.append(
            {
                "beta": beta_value,
                "n_in_delta_order": [
                    row["n"] for row in selected_rows
                ],
                "delta_in_order": [
                    row["delta"] for row in selected_rows
                ],
                "n_nondecreasing_as_delta_rises": (
                    _is_nondecreasing(
                        [row["n"] for row in selected_rows],
                        Q1_NUMERIC_TOL,
                    )
                ),
            }
        )

    oc_probabilities = []
    oc_confidence_only_rejection = []
    oc_operational_rejection = []
    oc_case90_acceptance = []
    for probability in Q1_OC_GRID:
        oc_probabilities.append(probability)
        oc_confidence_only_rejection.append(
            _upper_tail(
                int(confidence_only["n"]),
                int(confidence_only["r"]),
                probability,
            )
        )
        oc_operational_rejection.append(
            _upper_tail(
                int(operational["n"]),
                int(operational["r"]),
                probability,
            )
        )
        oc_case90_acceptance.append(
            _lower_tail(
                int(acceptance["n"]),
                int(acceptance["c"]),
                probability,
            )
        )

    fixed_n = int(operational["n"])
    sprt_null = likelihood_ratio_random_walk(
        fixed_n,
        p0,
        p0,
        float(operational["p_alt"]),
        beta,
    )
    sprt_alternative = likelihood_ratio_random_walk(
        fixed_n,
        float(operational["p_alt"]),
        p0,
        float(operational["p_alt"]),
        beta,
    )

    sprt_alpha_constraint = (
        sprt_null["rejection_probability"]
        <= ALPHA_REJECT + Q1_NUMERIC_TOL
    )
    sprt_power_constraint = (
        sprt_alternative["rejection_probability"]
        >= 1 - beta - Q1_NUMERIC_TOL
    )
    sprt_expected_null_constraint = (
        sprt_null["expected_samples"] <= fixed_n + Q1_NUMERIC_TOL
    )
    sprt_expected_alternative_constraint = (
        sprt_alternative["expected_samples"]
        <= fixed_n + Q1_NUMERIC_TOL
    )
    sprt_selected = (
        sprt_alpha_constraint
        and sprt_power_constraint
        and sprt_expected_null_constraint
        and sprt_expected_alternative_constraint
    )

    expected_rejection_boundary_residual = abs(
        sprt_null["rejection_boundary"] - Q1_SPRT_A
    )
    expected_truncation_threshold_residual = abs(
        sprt_null["truncation_threshold"] - Q1_SPRT_B
    )

    sprt_by_design = []
    for design in sensitivity_designs:
        sprt_by_design.append(
            _summarize_sprt_design(design, fixed_n)
        )

    boundary_grid = _sprt_boundary_grid(
        fixed_n,
        p0,
        float(operational["p_alt"]),
        beta,
    )

    direct_confidence_only_tail = exact_integer_enumeration(
        int(confidence_only["n"]),
        int(confidence_only["r"]),
        p0,
        "upper",
    )
    direct_operational_tail_at_p0 = exact_integer_enumeration(
        fixed_n,
        int(operational["r"]),
        p0,
        "upper",
    )
    direct_operational_tail_at_p_alt = exact_integer_enumeration(
        fixed_n,
        int(operational["r"]),
        float(operational["p_alt"]),
        "upper",
    )
    direct_acceptance_tail = exact_integer_enumeration(
        int(acceptance["n"]),
        int(acceptance["c"]),
        p0,
        "lower",
    )

    exact_residuals = {
        "confidence_only_case95": abs(
            direct_confidence_only_tail
            - confidence_only["rejection_probability_at_p0"]
        ),
        "operational_case95_at_p0": abs(
            direct_operational_tail_at_p0
            - operational["rejection_probability_at_p0"]
        ),
        "operational_case95_at_p_alt": abs(
            direct_operational_tail_at_p_alt
            - operational["power_at_p_alt"]
        ),
        "case90": abs(
            direct_acceptance_tail
            - acceptance["acceptance_probability_at_p0"]
        ),
    }
    exact_residuals_passed = all(
        residual <= Q1_NUMERIC_TOL
        for residual in exact_residuals.values()
    )

    oc_monotonicity = {
        "confidence_only_rejection_nondecreasing": _is_nondecreasing(
            oc_confidence_only_rejection,
            Q1_NUMERIC_TOL,
        ),
        "operational_rejection_nondecreasing": _is_nondecreasing(
            oc_operational_rejection,
            Q1_NUMERIC_TOL,
        ),
        "case90_acceptance_nonincreasing": _is_nonincreasing(
            oc_case90_acceptance,
            Q1_NUMERIC_TOL,
        ),
        "probe_probability_count": len(oc_probabilities),
    }

    sprt_probability_closure_passed = all(
        summary["probability_closure_residual_at_p0"]
        <= Q1_NUMERIC_TOL
        and summary["probability_closure_residual_at_p_alt"]
        <= Q1_NUMERIC_TOL
        for summary in sprt_by_design
    )
    fixed_scheme_checks_passed = (
        confidence_only_verification["minimality_passed"]
        and operational_verification["minimality_passed"]
        and acceptance_verification["minimality_passed"]
        and exact_residuals_passed
        and all(oc_monotonicity.values())
        and all(
            item["n_nonincreasing_as_beta_rises"]
            for item in delta_monotonicity
        )
        and all(
            item["n_nondecreasing_as_delta_rises"]
            for item in beta_monotonicity
        )
        and sprt_probability_closure_passed
        and expected_rejection_boundary_residual
        <= Q1_NUMERIC_TOL
        and expected_truncation_threshold_residual
        <= Q1_NUMERIC_TOL
    )

    case95 = dict(operational)
    case95.update(
        {
            "interpretation": (
                "仅以题面拒收置信要求并另加登记备择率与第二类错误的"
                "条件运营最小方案"
            ),
            "mode": Q1_CASE95_MODE,
            "design_basis": Q1_CASE95_DESIGN_BASIS,
            "confidence_only_n": confidence_only["n"],
            "confidence_only_r": confidence_only["r"],
            "confidence_only_reject_tail": confidence_only[
                "rejection_probability_at_p0"
            ],
            "confidence_only_status": (
                "separately_reported_because_power_constraints_are_not_in_"
                "the_problem_facts"
            ),
        }
    )

    return {
        "problem": "problem1",
        "method": {
            "fixed_sampling": "exact_integer_enumeration",
            "tail_probability_backend": "scipy.stats.binom",
            "integer_threshold_search": True,
            "normal_approximation_used": False,
            "tie_break_rule": Q1_TIE_BREAK_RULE,
            "operational_power_constraint_is_conditional": True,
        },
        "parameters": {
            "p0": p0,
            "alpha_reject": ALPHA_REJECT,
            "accept_confidence": ACCEPT_CONFIDENCE,
            "registered_delta": delta,
            "registered_beta": beta,
            "registered_p_alt": float(operational["p_alt"]),
            "numeric_tolerance": Q1_NUMERIC_TOL,
            "search_upper_bound": Q1_N_MAX,
            "provenance_note": (
                "备择幅度与第二类错误是建模设计常数，不是题面直接事实"
            ),
        },
        "case95_confidence_only": {
            **confidence_only,
            "interpretation": (
                "只使用题面拒收置信约束的最小整数方案"
            ),
            "design_basis": "problem_fact_confidence_only",
        },
        "operational_case95": operational,
        "case95": case95,
        "case90": {
            **acceptance,
            "accept_tail": acceptance["acceptance_probability_at_p0"],
            "interpretation": "题面接收置信约束下的最小整数方案",
        },
        "sensitivity": {
            "delta_grid": list(delta_grid),
            "beta_grid": list(beta_grid),
            "rows": sensitivity_rows,
            "delta_monotonicity": delta_monotonicity,
            "beta_monotonicity": beta_monotonicity,
        },
        "sensitivity_grid": sensitivity_rows,
        "oc_curve": {
            "probability": oc_probabilities,
            "confidence_only_case95_rejection_probability": (
                oc_confidence_only_rejection
            ),
            "operational_case95_rejection_probability": (
                oc_operational_rejection
            ),
            "case90_acceptance_probability": oc_case90_acceptance,
            "operational_case95_reject_indicator": [
                probability >= P0
                for probability in oc_probabilities
            ],
            "case90_receive_indicator": [
                probability <= P0
                for probability in oc_probabilities
            ],
        },
        "sprt": {
            "method": "likelihood_ratio_random_walk",
            "finite": True,
            "orientation": "log_likelihood_ratio_p_alt_over_p0",
            "n_truncate": fixed_n,
            "expected_n_at_p0": sprt_null["expected_samples"],
            "expected_n_at_p_alt": sprt_alternative["expected_samples"],
            "expected_n": sprt_alternative["expected_samples"],
            "rejection_probability_at_p0": sprt_null[
                "rejection_probability"
            ],
            "type_ii_error_at_p_alt": sprt_alternative[
                "acceptance_probability"
            ],
            "power_at_p_alt": sprt_alternative["rejection_probability"],
            "acceptance_boundary": sprt_null["acceptance_boundary"],
            "rejection_boundary": sprt_null["rejection_boundary"],
            "truncation_threshold": sprt_null["truncation_threshold"],
            "truncation_rule": Q1_SPRT_TRUNCATION_RULE,
            "alpha_constraint_passed": sprt_alpha_constraint,
            "power_constraint_passed": sprt_power_constraint,
            "expected_n_at_p0_constraint_passed": (
                sprt_expected_null_constraint
            ),
            "expected_n_at_p_alt_constraint_passed": (
                sprt_expected_alternative_constraint
            ),
            "selected": sprt_selected,
            "selection_rule": (
                "exact_error_constraints_and_both_expected_counts_pass"
            ),
            "stop_probability_at_p0": {
                "acceptance_cdf_after_draw": sprt_null[
                    "acceptance_cdf_after_draw"
                ],
                "rejection_cdf_after_draw": sprt_null[
                    "rejection_cdf_after_draw"
                ],
                "survival_after_draw": sprt_null[
                    "survival_after_draw"
                ],
            },
            "stop_probability_at_p_alt": {
                "acceptance_cdf_after_draw": sprt_alternative[
                    "acceptance_cdf_after_draw"
                ],
                "rejection_cdf_after_draw": sprt_alternative[
                    "rejection_cdf_after_draw"
                ],
                "survival_after_draw": sprt_alternative[
                    "survival_after_draw"
                ],
            },
            "boundary_grid": boundary_grid,
            "by_delta_beta_design": sprt_by_design,
            "registered_boundary_alias_residuals": {
                "rejection_boundary": expected_rejection_boundary_residual,
                "truncation_threshold": expected_truncation_threshold_residual,
            },
        },
        "validation": {
            "confidence_only_minimality": (
                confidence_only_verification
            ),
            "operational_case95_minimality": operational_verification,
            "case90_minimality": acceptance_verification,
            "exact_enumeration_residuals": exact_residuals,
            "exact_enumeration_residuals_passed": (
                exact_residuals_passed
            ),
            "oc_monotonicity": oc_monotonicity,
            "sprt_probability_closure_passed": (
                sprt_probability_closure_passed
            ),
            "fixed_scheme_checks_passed": fixed_scheme_checks_passed,
            "sprt_admissible_for_replacement": sprt_selected,
            "all_required_fixed_checks_passed": (
                fixed_scheme_checks_passed
            ),
        },
    }