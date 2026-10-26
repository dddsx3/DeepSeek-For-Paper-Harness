"""Problem 1 executable: exact fixed-size designs and bounded SPRT comparison."""

from __future__ import annotations

import math
from itertools import product

import numpy as np
from scipy.stats import binom

from params import *


_DIRECT_EPS = PROBABILITY_ABS_TOL


def _ensure(condition, message):
    if not bool(condition):
        raise ValueError(message)


def _validate_case_direction(direction):
    _ensure(
        direction in {"reject_high", "accept_low"},
        "fixed design direction must be reject_high or accept_low",
    )


def _direct_binom_cdf(x, n, probability):
    """Stable exact CDF, including both probability endpoints."""
    threshold = int(x)
    sample_size = int(n)
    rate = validate_probability(probability, "direct binomial probability")
    _ensure(sample_size >= 0, "binomial sample size must be nonnegative")
    _ensure(-1 <= threshold <= sample_size, "binomial CDF threshold is out of range")
    _ensure(float(threshold) == float(x), "binomial CDF threshold must be integral")
    if threshold < 0:
        return 0.0
    if rate == 0.0:
        return 1.0
    if rate == 1.0:
        return 1.0 if threshold >= sample_size else 0.0

    upper = min(threshold, sample_size)
    total = 0.0
    for count in range(upper + 1):
        total += (
            math.comb(sample_size, count)
            * rate**count
            * (1.0 - rate) ** (sample_size - count)
        )
    return min(1.0, max(0.0, total))


def _direct_binom_upper(x, n, probability):
    """Stable exact upper tail P(X > x), including p=0 and p=1."""
    threshold = int(x)
    sample_size = int(n)
    if threshold < 0:
        return 1.0
    if threshold >= sample_size:
        return 0.0
    return 1.0 - _direct_binom_cdf(threshold, sample_size, probability)


def exact_integer_enumeration(
    direction,
    alpha,
    beta,
    nominal_rate,
    alternative_rate,
    search_cap=INTEGER_SEARCH_CAP,
):
    """Find the minimum integer n and deterministic integer threshold c."""
    _validate_case_direction(direction)
    alpha_value = validate_probability(alpha, "Q1 alpha")
    beta_value = validate_probability(beta, "Q1 beta")
    p0 = validate_probability(nominal_rate, "Q1 nominal rate")
    p1 = validate_probability(alternative_rate, "Q1 alternative rate")
    cap = int(search_cap)
    _ensure(cap >= 1, "Q1 integer search cap must be positive")
    _ensure(alpha_value > 0.0 and beta_value > 0.0, "Q1 error rates must be positive")

    for sample_size in range(1, cap + 1):
        thresholds = np.arange(sample_size + 1, dtype=int)
        if direction == "reject_high":
            cdf_values = np.empty(sample_size + 1, dtype=float)
            cdf_values[0] = 0.0
            cdf_values[1:] = binom.cdf(np.arange(sample_size), sample_size, p0)
            alternative_cdf = np.empty(sample_size + 1, dtype=float)
            alternative_cdf[0] = 0.0
            alternative_cdf[1:] = binom.cdf(np.arange(sample_size), sample_size, p1)
            reject_tail = 1.0 - cdf_values
            reject_power = alternative_cdf
            feasible = (
                (reject_tail <= alpha_value + _DIRECT_EPS)
                & (reject_power >= 1.0 - beta_value - _DIRECT_EPS)
            )
        else:
            cdf_values = binom.cdf(thresholds, sample_size, p0)
            alternative_cdf = binom.cdf(thresholds, sample_size, p1)
            feasible = (
                (cdf_values >= 1.0 - alpha_value - _DIRECT_EPS)
                & (alternative_cdf >= 1.0 - beta_value - _DIRECT_EPS)
            )

        feasible_indices = np.flatnonzero(feasible)
        if feasible_indices.size == 0:
            continue
        threshold = (
            int(feasible_indices[0])
            if direction == "reject_high"
            else int(feasible_indices[-1])
        )
        if direction == "reject_high":
            relevant_probability = float(1.0 - binom.cdf(threshold - 1, sample_size, p0))
            complementary_probability = float(binom.cdf(threshold - 1, sample_size, p0))
            power = float(binom.cdf(threshold - 1, sample_size, p1))
        else:
            relevant_probability = float(binom.cdf(threshold, sample_size, p0))
            complementary_probability = float(1.0 - binom.cdf(threshold, sample_size, p0))
            power = float(binom.cdf(threshold, sample_size, p1))
        return {
            "n": sample_size,
            "c": threshold,
            "direction": direction,
            "decision_rule": (
                f"reject the lot iff X >= {threshold}"
                if direction == "reject_high"
                else f"accept the lot iff X <= {threshold}"
            ),
            "relevant_probability": relevant_probability,
            "complementary_probability": complementary_probability,
            "power": power,
            "constraints": {
                "alpha": alpha_value,
                "beta": beta_value,
                "nominal_rate": p0,
                "alternative_rate": p1,
                "search_cap": cap,
            },
        }

    return {
        "feasible": False,
        "n": None,
        "c": None,
        "direction": direction,
        "search_cap": cap,
        "reason": "no integer threshold is feasible within the registered search cap",
    }


def _oc_probability_grid(n, c, direction, probabilities):
    _validate_case_direction(direction)
    sample_size = int(n)
    threshold = int(c)
    _ensure(sample_size >= 1, "OC sample size must be positive")
    _ensure(0 <= threshold <= sample_size, "OC threshold is out of range")

    p_values = []
    accept_probabilities = []
    reject_probabilities = []
    points = []
    for probability in probabilities:
        rate = validate_probability(probability, "OC grid probability")
        if direction == "reject_high":
            accept_probability = float(binom.cdf(threshold - 1, sample_size, rate))
            reject_probability = 1.0 - accept_probability
        else:
            accept_probability = float(binom.cdf(threshold, sample_size, rate))
            reject_probability = 1.0 - accept_probability
        direct_accept = (
            _direct_binom_cdf(threshold - 1, sample_size, rate)
            if direction == "reject_high"
            else _direct_binom_cdf(threshold, sample_size, rate)
        )
        direct_reject = _direct_binom_upper(
            threshold - 1 if direction == "reject_high" else threshold,
            sample_size,
            rate,
        )
        maximum_probability_gap = max(
            abs(accept_probability - direct_accept),
            abs(reject_probability - direct_reject),
        )
        p_values.append(rate)
        accept_probabilities.append(accept_probability)
        reject_probabilities.append(reject_probability)
        points.append(
            {
                "p": rate,
                "accept_probability": accept_probability,
                "reject_probability": reject_probability,
                "probability_sum": accept_probability + reject_probability,
                "direct_probability_gap": maximum_probability_gap,
            }
        )
    return {
        "p": p_values,
        "accept_probability": accept_probabilities,
        "reject_probability": reject_probabilities,
        "points": points,
        "decision_rule": (
            f"accept iff X <= {threshold - 1}; reject iff X >= {threshold}"
            if direction == "reject_high"
            else f"accept iff X <= {threshold}; reject iff X >= {threshold + 1}"
        ),
    }


def _probability_grid(n, c, direction, probabilities=None):
    """Construct a complete, nonoverlapping OC probability series."""
    if probabilities is None:
        upper_rate = Q1_NOMINAL_DEFECT_RATE + Q1_EFFECT_DELTA_ABS
        interval_steps = int(math.ceil(upper_rate / Q1_SPRT_P_GRID_STEP))
        probabilities = [
            min(1.0, index * Q1_SPRT_P_GRID_STEP)
            for index in range(interval_steps + 1)
        ]
        if abs(probabilities[-1] - upper_rate) > PROBABILITY_ABS_TOL:
            probabilities.append(upper_rate)
    return _oc_probability_grid(n, c, direction, probabilities)


def _fixed_case_payload(
    case_name,
    direction,
    alpha,
    beta,
    alternative_rate,
    conditional_design=True,
):
    design = exact_integer_enumeration(
        direction=direction,
        alpha=alpha,
        beta=beta,
        nominal_rate=Q1_NOMINAL_DEFECT_RATE,
        alternative_rate=alternative_rate,
    )
    if not design.get("feasible", True):
        return design
    oc_curve = _probability_grid(design["n"], design["c"], direction)
    maximum_direct_gap = max(
        float(point["direct_probability_gap"]) for point in oc_curve["points"]
    )
    payload = {
        "case_name": case_name,
        "conditional_design": bool(conditional_design),
        **design,
        "oc_curve": oc_curve["points"],
        "probability_series": {
            "p": oc_curve["p"],
            "accept_probability": oc_curve["accept_probability"],
            "reject_probability": oc_curve["reject_probability"],
        },
        "direct_probability_max_gap": maximum_direct_gap,
        "status": "success",
    }
    if direction == "reject_high":
        payload.update(
            {
                "reject_probability": design["relevant_probability"],
                "reject_tail": design["relevant_probability"],
                "reject_power": design["power"],
                "power": design["power"],
                "accept_probability": design["complementary_probability"],
            }
        )
    else:
        payload.update(
            {
                "accept_probability": design["relevant_probability"],
                "accept_power": design["power"],
                "power": design["power"],
                "reject_probability": design["complementary_probability"],
            }
        )
    return payload


def _decision_rate_grid(alternative_rate):
    start = validate_probability(alternative_rate, "SPRT grid endpoint")
    span = abs(Q1_NOMINAL_DEFECT_RATE - start)
    interval_count = max(1, int(round(span / Q1_SPRT_P_GRID_STEP)))
    return [
        start
        + (Q1_NOMINAL_DEFECT_RATE - start) * index / interval_count
        for index in range(interval_count + 1)
    ]


def _boundary_sequence(
    direction,
    alpha,
    beta,
    alternative_rate,
    sample_cap,
    left_shift=0,
    right_shift=0,
):
    """Integer likelihood-ratio boundaries used by the bounded SPRT DP."""
    _validate_case_direction(direction)
    p0 = Q1_NOMINAL_DEFECT_RATE
    p1 = validate_probability(alternative_rate, "SPRT alternative rate")
    _ensure(p0 not in {0.0, 1.0}, "SPRT nominal rate must be strictly interior")
    _ensure(p1 not in {0.0, 1.0}, "SPRT alternative rate must be strictly interior")
    _ensure(p0 != p1, "SPRT alternative must differ from nominal")
    upper_boundary = math.log((1.0 - beta) / alpha)
    lower_boundary = math.log(beta / (1.0 - alpha))
    log_likelihood_slope = math.log(p1 / p0) - math.log((1.0 - p1) / (1.0 - p0))
    increasing = p1 > p0

    reject_max = []
    accept_min = []
    accept_max = []
    reject_min = []
    for sample_count in range(sample_cap + 1):
        if increasing:
            root_lower = lower_boundary / log_likelihood_slope
            root_upper = upper_boundary / log_likelihood_slope
            reject_threshold = int(math.floor(root_lower)) - int(left_shift)
            accept_threshold = int(math.ceil(root_upper)) + int(right_shift)
            reject_threshold = max(-1, min(sample_count, reject_threshold))
            accept_threshold = min(sample_count + 1, max(-1, accept_threshold))
            _ensure(
                reject_threshold < accept_threshold,
                "invalid overlapping SPRT reject/accept thresholds",
            )
            reject_max.append(reject_threshold)
            accept_min.append(accept_threshold)
            accept_max.append(reject_threshold)
            reject_min.append(accept_threshold)
        else:
            root_upper = upper_boundary / log_likelihood_slope
            root_lower = lower_boundary / log_likelihood_slope
            accept_threshold = int(math.floor(root_upper)) + int(right_shift)
            reject_threshold = int(math.ceil(root_lower)) + int(left_shift)
            accept_threshold = max(-1, min(sample_count, accept_threshold))
            reject_threshold = min(sample_count + 1, max(-1, reject_threshold))
            _ensure(
                accept_threshold < reject_threshold,
                "invalid overlapping SPRT accept/reject thresholds",
            )
            accept_max.append(accept_threshold)
            reject_min.append(reject_threshold)
            reject_max.append(accept_threshold)
            accept_min.append(reject_threshold)
    return {
        "direction": direction,
        "sample_cap": sample_cap,
        "reject_max": tuple(reject_max),
        "accept_min": tuple(accept_min),
        "accept_max": tuple(accept_max),
        "reject_min": tuple(reject_min),
        "left_shift": int(left_shift),
        "right_shift": int(right_shift),
    }


def _fixed_boundary_sequence(direction, n, c):
    cap = int(n)
    threshold = int(c)
    if direction == "reject_high":
        reject_max = tuple(min(threshold - 1, sample_count) for sample_count in range(cap + 1))
        accept_min = tuple(min(threshold, sample_count + 1) for sample_count in range(cap + 1))
        accept_max = reject_max
        reject_min = accept_min
    else:
        accept_max = tuple(min(threshold, sample_count) for sample_count in range(cap + 1))
        reject_min = tuple(
            min(threshold + 1, sample_count + 1) for sample_count in range(cap + 1)
        )
        reject_max = accept_max
        accept_min = reject_min
    return {
        "direction": direction,
        "sample_cap": cap,
        "reject_max": reject_max,
        "accept_min": accept_min,
        "accept_max": accept_max,
        "reject_min": reject_min,
        "left_shift": 0,
        "right_shift": 0,
    }


def _terminal_label(sample_count, defect_count, direction, boundaries, cap):
    if direction == "reject_high":
        reject_threshold = boundaries["reject_max"][sample_count]
        accept_threshold = boundaries["accept_min"][sample_count]
        if defect_count <= reject_threshold:
            return "accept"
        if defect_count >= accept_threshold:
            return "reject"
    else:
        accept_threshold = boundaries["accept_max"][sample_count]
        reject_threshold = boundaries["reject_min"][sample_count]
        if defect_count <= accept_threshold:
            return "accept"
        if defect_count >= reject_threshold:
            return "reject"
    return None


def bounded_sprt_dp(boundaries, fixed_threshold, probability):
    """Exact forward-state DP for a finite integer-boundary SPRT."""
    direction = boundaries["direction"]
    cap = int(boundaries["sample_cap"])
    threshold = int(fixed_threshold)
    rate = validate_probability(probability, "bounded SPRT probability")
    _ensure(1 <= cap <= INTEGER_SEARCH_CAP, "SPRT cap is outside the registered range")

    active = {(0, 0): 1.0}
    terminal_probability = {"accept": 0.0, "reject": 0.0}
    expected_samples = 0.0
    truncated_probability = 0.0
    for sample_count in range(1, cap + 1):
        expected_samples += sum(active.values())
        next_active = {}
        for (_, defect_count), state_probability in active.items():
            for increment in (0, 1):
                next_count = defect_count + increment
                transition_probability = float(
                    binom.pmf(increment, sample_count - 1, rate)
                )
                mass = state_probability * transition_probability
                label = _terminal_label(
                    sample_count,
                    next_count,
                    direction,
                    boundaries,
                    cap,
                )
                if label is None and sample_count == cap:
                    if direction == "reject_high":
                        label = "reject" if next_count >= threshold else "accept"
                    else:
                        label = "accept" if next_count <= threshold else "reject"
                    truncated_probability += mass
                if label is not None:
                    terminal_probability[label] += mass
                else:
                    next_active[(sample_count, next_count)] = (
                        next_active.get((sample_count, next_count), 0.0) + mass
                    )
        active = next_active
        if not active:
            break

    total_probability = terminal_probability["accept"] + terminal_probability["reject"]
    _ensure(
        abs(total_probability - 1.0) <= 10.0 * PROBABILITY_ABS_TOL,
        "bounded SPRT terminal probabilities do not sum to one",
    )
    return {
        "p": rate,
        "accept_probability": terminal_probability["accept"],
        "reject_probability": terminal_probability["reject"],
        "terminal_probability_sum": total_probability,
        "expected_samples": expected_samples,
        "truncation_rate": truncated_probability,
        "sample_cap": cap,
    }


def expected_sample_size_comparison(metrics):
    expected_values = [float(metric["expected_samples"]) for metric in metrics]
    return {
        "minimum_expected_samples": min(expected_values),
        "worst_expected_samples": max(expected_values),
        "mean_expected_samples": sum(expected_values) / len(expected_values),
        "grid_point_count": len(expected_values),
    }


def _offset_pairs(limit):
    yield 0, 0
    for radius in range(1, int(limit) + 1):
        yield radius, 0
        yield -radius, 0
        yield 0, radius
        yield 0, -radius
        yield radius, radius
        yield radius, -radius
        yield -radius, radius
        yield -radius, -radius


def _calibrate_bounded_sprt(
    direction,
    alpha,
    beta,
    alternative_rate,
    fixed_n,
    fixed_c,
):
    _validate_case_direction(direction)
    cap = int(fixed_n)
    rate_grid = _decision_rate_grid(alternative_rate)
    search_margin = max(1, math.isqrt(len(Q1_DELTA_GRID)))
    candidates = [(0, "fixed_boundary_control")]
    candidates.extend(
        (index, "wald_integer_boundary")
        for index, pair in enumerate(_offset_pairs(search_margin), 1)
    )

    best = None
    feasible_count = 0
    for candidate_index, (left_shift, right_shift) in candidates:
        try:
            if candidate_index == 0:
                boundaries = _fixed_boundary_sequence(direction, cap, fixed_c)
            else:
                boundaries = _boundary_sequence(
                    direction,
                    alpha,
                    beta,
                    alternative_rate,
                    cap,
                    left_shift,
                    right_shift,
                )
        except ValueError:
            continue
        nominal_metric = bounded_sprt_dp(boundaries, fixed_c, Q1_NOMINAL_DEFECT_RATE)
        alternative_metric = bounded_sprt_dp(boundaries, fixed_c, alternative_rate)
        if direction == "reject_high":
            feasible = (
                nominal_metric["reject_probability"] <= alpha + PROBABILITY_ABS_TOL
                and alternative_metric["reject_probability"]
                >= 1.0 - beta - PROBABILITY_ABS_TOL
            )
        else:
            feasible = (
                nominal_metric["accept_probability"]
                >= 1.0 - alpha - PROBABILITY_ABS_TOL
                and alternative_metric["accept_probability"]
                >= 1.0 - beta - PROBABILITY_ABS_TOL
            )
        if not feasible:
            continue
        feasible_count += 1
        grid_metrics = [
            bounded_sprt_dp(boundaries, fixed_c, probability)
            for probability in rate_grid
        ]
        comparison = expected_sample_size_comparison(grid_metrics)
        truncation_max = max(float(metric["truncation_rate"]) for metric in grid_metrics)
        selection_key = (
            float(comparison["worst_expected_samples"]),
            truncation_max,
            float(nominal_metric["expected_samples"]),
            float(alternative_metric["expected_samples"]),
            int(left_shift),
            int(right_shift),
            int(candidate_index),
        )
        record = {
            "feasible": True,
            "sample_cap": cap,
            "registered_search_cap": INTEGER_SEARCH_CAP,
            "boundaries": {
                "reject_max": list(boundaries["reject_max"]),
                "accept_min": list(boundaries["accept_min"]),
                "accept_max": list(boundaries["accept_max"]),
                "reject_min": list(boundaries["reject_min"]),
            },
            "fallback_fixed_threshold": int(fixed_c),
            "nominal": nominal_metric,
            "alternative": alternative_metric,
            "grid": grid_metrics,
            "expected_sample_comparison": comparison,
            "truncation_rate": {
                "nominal": nominal_metric["truncation_rate"],
                "alternative": alternative_metric["truncation_rate"],
                "maximum_on_grid": truncation_max,
            },
            "selection_key": list(selection_key),
        }
        if best is None or selection_key < best["selection_key"]:
            best = record

    if best is None:
        raise RuntimeError("no feasible bounded SPRT candidate was found")
    best["calibration"] = {
        "integer_boundary_candidates": len(candidates),
        "feasible_candidates": feasible_count,
        "comparison": "minimize worst expected samples over the exact probability grid",
    }
    if direction == "reject_high":
        best["constraints"] = {
            "nominal_reject_probability": best["nominal"]["reject_probability"],
            "nominal_reject_upper_bound": alpha,
            "alternative_reject_probability": best["alternative"]["reject_probability"],
            "alternative_reject_lower_bound": 1.0 - beta,
            "passed": (
                best["nominal"]["reject_probability"] <= alpha + PROBABILITY_ABS_TOL
                and best["alternative"]["reject_probability"]
                >= 1.0 - beta - PROBABILITY_ABS_TOL
            ),
        }
    else:
        best["constraints"] = {
            "nominal_accept_probability": best["nominal"]["accept_probability"],
            "nominal_accept_lower_bound": 1.0 - alpha,
            "alternative_accept_probability": best["alternative"]["accept_probability"],
            "alternative_accept_lower_bound": 1.0 - beta,
            "passed": (
                best["nominal"]["accept_probability"]
                >= 1.0 - alpha - PROBABILITY_ABS_TOL
                and best["alternative"]["accept_probability"]
                >= 1.0 - beta - PROBABILITY_ABS_TOL
            ),
        }
    return best


def _sensitivity_design(delta, beta):
    reject = exact_integer_enumeration(
        "reject_high",
        Q1_ALPHA_REJECT,
        beta,
        Q1_NOMINAL_DEFECT_RATE,
        Q1_NOMINAL_DEFECT_RATE + delta,
    )
    accept = exact_integer_enumeration(
        "accept_low",
        Q1_ALPHA_ACCEPT,
        beta,
        Q1_NOMINAL_DEFECT_RATE,
        Q1_NOMINAL_DEFECT_RATE - delta,
    )
    return {
        "delta": delta,
        "beta": beta,
        "case95": {
            "feasible": reject.get("feasible", True),
            "n": reject.get("n"),
            "c": reject.get("c"),
            "reject_probability": reject.get("relevant_probability"),
            "power": reject.get("power"),
        },
        "case90": {
            "feasible": accept.get("feasible", True),
            "n": accept.get("n"),
            "c": accept.get("c"),
            "accept_probability": accept.get("relevant_probability"),
            "power": accept.get("power"),
        },
    }


def _q1_sensitivity_grid():
    records = [
        _sensitivity_design(delta, beta)
        for delta, beta in product(Q1_DELTA_GRID, Q1_BETA_GRID)
    ]
    by_delta = {}
    for delta in Q1_DELTA_GRID:
        by_delta[delta] = [
            record["case95"]["n"]
            for record in records
            if abs(record["delta"] - delta) <= PROBABILITY_ABS_TOL
        ]
    by_beta = {}
    for beta in Q1_BETA_GRID:
        by_beta[beta] = [
            record["case95"]["n"]
            for record in records
            if abs(record["beta"] - beta) <= PROBABILITY_ABS_TOL
        ]
    return {
        "records": records,
        "delta_grid": list(Q1_DELTA_GRID),
        "beta_grid": list(Q1_BETA_GRID),
        "case95_sample_size_by_delta": by_delta,
        "case95_sample_size_by_beta": by_beta,
        "claim_label": "conditional_design_sensitivity",
    }


def _sample_size_confidence_scan():
    alpha_index_limit = max(
        1,
        int(round(Q1_SENSITIVITY_DELTA_HIGH / Q1_SPRT_P_GRID_STEP)),
    )
    records = []
    for alpha_index in range(1, alpha_index_limit + 1):
        alpha = alpha_index * Q1_SPRT_P_GRID_STEP
        reject = exact_integer_enumeration(
            "reject_high",
            alpha,
            Q1_TYPE2_ERROR_REJECT,
            Q1_NOMINAL_DEFECT_RATE,
            Q1_REJECT_ALTERNATIVE_RATE,
        )
        accept = exact_integer_enumeration(
            "accept_low",
            alpha,
            Q1_TYPE2_ERROR_ACCEPT,
            Q1_NOMINAL_DEFECT_RATE,
            Q1_ACCEPT_ALTERNATIVE_RATE,
        )
        records.append(
            {
                "alpha": alpha,
                "confidence": 1.0 - alpha,
                "case95_reject_design": {
                    "feasible": reject.get("feasible", True),
                    "n": reject.get("n"),
                    "c": reject.get("c"),
                },
                "case90_accept_design": {
                    "feasible": accept.get("feasible", True),
                    "n": accept.get("n"),
                    "c": accept.get("c"),
                },
            }
        )
    records.extend(
        [
            {
                "alpha": Q1_ALPHA_REJECT,
                "confidence": Q1_REJECT_CONFIDENCE,
                "case95_reject_design": {"label": "registered_fixed_case"},
            },
            {
                "alpha": Q1_ALPHA_ACCEPT,
                "confidence": Q1_ACCEPT_CONFIDENCE,
                "case90_accept_design": {"label": "registered_fixed_case"},
            },
        ]
    )
    return {
        "records": records,
        "alpha_grid_step": Q1_SPRT_P_GRID_STEP,
        "conditional_design": True,
    }


def _select_scheme(fixed_case, sprt_case):
    fixed_expected = fixed_case["n"]
    sequential_improves = (
        sprt_case["expected_sample_comparison"]["worst_expected_samples"]
        < fixed_expected - PROBABILITY_ABS_TOL
    )
    return "bounded_sprt" if sequential_improves else "fixed_size"


def _build_result():
    case95 = _fixed_case_payload(
        "case95_reject_high",
        "reject_high",
        Q1_ALPHA_REJECT,
        Q1_TYPE2_ERROR_REJECT,
        Q1_REJECT_ALTERNATIVE_RATE,
    )
    case90 = _fixed_case_payload(
        "case90_accept_low",
        "accept_low",
        Q1_ALPHA_ACCEPT,
        Q1_TYPE2_ERROR_ACCEPT,
        Q1_ACCEPT_ALTERNATIVE_RATE,
    )
    _ensure(case95.get("n") is not None, "case95 fixed design is infeasible")
    _ensure(case90.get("n") is not None, "case90 fixed design is infeasible")

    sprt95 = _calibrate_bounded_sprt(
        "reject_high",
        Q1_ALPHA_REJECT,
        Q1_TYPE2_ERROR_REJECT,
        Q1_REJECT_ALTERNATIVE_RATE,
        case95["n"],
        case95["c"],
    )
    sprt90 = _calibrate_bounded_sprt(
        "accept_low",
        Q1_ALPHA_ACCEPT,
        Q1_TYPE2_ERROR_ACCEPT,
        Q1_ACCEPT_ALTERNATIVE_RATE,
        case90["n"],
        case90["c"],
    )
    selected95 = _select_scheme(case95, sprt95)
    selected90 = _select_scheme(case90, sprt90)
    if selected95 == selected90:
        overall_selection = selected95
    else:
        overall_selection = "case_dependent"

    fixed_cases = [case95, case90]
    oc_curves = {
        "case95": case95["probability_series"],
        "case90": case90["probability_series"],
    }
    result = {
        "status": "success",
        "problem": 1,
        "method": "exact_integer_enumeration_then_bounded_sprt_dp",
        "claim_label": "conditional_design_due_to_registered_delta_and_beta",
        "parameters": {
            "p0": Q1_NOMINAL_DEFECT_RATE,
            "delta": Q1_EFFECT_DELTA_ABS,
            "beta_reject": Q1_TYPE2_ERROR_REJECT,
            "beta_accept": Q1_TYPE2_ERROR_ACCEPT,
            "alpha_reject": Q1_ALPHA_REJECT,
            "alpha_accept": Q1_ALPHA_ACCEPT,
            "case95_reject_confidence": Q1_REJECT_CONFIDENCE,
            "case90_accept_confidence": Q1_ACCEPT_CONFIDENCE,
            "case95_alternative_rate": Q1_REJECT_ALTERNATIVE_RATE,
            "case90_alternative_rate": Q1_ACCEPT_ALTERNATIVE_RATE,
            "integer_search_cap": INTEGER_SEARCH_CAP,
            "probability_abs_tol": PROBABILITY_ABS_TOL,
        },
        "p0": Q1_NOMINAL_DEFECT_RATE,
        "delta": Q1_EFFECT_DELTA_ABS,
        "beta_reject": Q1_TYPE2_ERROR_REJECT,
        "beta_accept": Q1_TYPE2_ERROR_ACCEPT,
        "alpha_reject": Q1_ALPHA_REJECT,
        "alpha_accept": Q1_ALPHA_ACCEPT,
        "case95": case95,
        "case90": case90,
        "case1": case95,
        "case2": case90,
        "case_reject": case95,
        "case_accept": case90,
        "fixed_cases": fixed_cases,
        "fixed_design": {"case95": case95, "case90": case90},
        "n_reject": case95["n"],
        "c_reject": case95["c"],
        "n_accept": case90["n"],
        "c_accept": case90["c"],
        "reject_tail": case95["reject_probability"],
        "reject_power": case95["reject_power"],
        "accept_probability": case90["accept_probability"],
        "accept_power": case90["accept_power"],
        "oc_curve": oc_curves,
        "oc_curves": oc_curves,
        "sensitivity": _q1_sensitivity_grid(),
        "sensitivity_grid": _q1_sensitivity_grid(),
        "sample_size_vs_confidence": _sample_size_confidence_scan(),
        "bounded_sprt": {
            "case95": sprt95,
            "case90": sprt90,
            "method": "bounded_sprt_dp",
            "finite_sample_cap_required": True,
        },
        "sprt_case95": sprt95,
        "sprt_case90": sprt90,
        "selected_scheme": {
            "case95": selected95,
            "case90": selected90,
            "overall": overall_selection,
        },
        "sprt_expected_samples": {
            "case95_worst_grid": sprt95["expected_sample_comparison"][
                "worst_expected_samples"
            ],
            "case90_worst_grid": sprt90["expected_sample_comparison"][
                "worst_expected_samples"
            ],
        },
    }
    return result


def _add_check(checks, name, condition, observed, expected=None):
    passed = bool(condition)
    row = {"name": name, "passed": passed, "observed": observed}
    if expected is not None:
        row["expected"] = expected
    checks[name] = row
    return passed


def validate_constraints(results):
    """Recompute every final Q1 constraint instead of trusting solver flags."""
    payload = results.get("problem1", results) if isinstance(results, dict) else {}
    checks = {}
    case95 = payload.get("case95", {})
    case90 = payload.get("case90", {})
    recomputed95 = exact_integer_enumeration(
        "reject_high",
        Q1_ALPHA_REJECT,
        Q1_TYPE2_ERROR_REJECT,
        Q1_NOMINAL_DEFECT_RATE,
        Q1_REJECT_ALTERNATIVE_RATE,
    )
    recomputed90 = exact_integer_enumeration(
        "accept_low",
        Q1_ALPHA_ACCEPT,
        Q1_TYPE2_ERROR_ACCEPT,
        Q1_NOMINAL_DEFECT_RATE,
        Q1_ACCEPT_ALTERNATIVE_RATE,
    )

    _add_check(
        checks,
        "case95_minimum_integer_design",
        case95.get("n") == recomputed95.get("n")
        and case95.get("c") == recomputed95.get("c"),
        {"n": case95.get("n"), "c": case95.get("c")},
        {"n": recomputed95.get("n"), "c": recomputed95.get("c")},
    )
    _add_check(
        checks,
        "case90_minimum_integer_design",
        case90.get("n") == recomputed90.get("n")
        and case90.get("c") == recomputed90.get("c"),
        {"n": case90.get("n"), "c": case90.get("c")},
        {"n": recomputed90.get("n"), "c": recomputed90.get("c")},
    )

    reject_tail = float(binom.sf(case95["c"] - 1, case95["n"], Q1_NOMINAL_DEFECT_RATE))
    reject_power = float(binom.cdf(case95["c"] - 1, case95["n"], Q1_REJECT_ALTERNATIVE_RATE))
    accept_probability = float(binom.cdf(case90["c"], case90["n"], Q1_NOMINAL_DEFECT_RATE))
    accept_power = float(binom.cdf(case90["c"], case90["n"], Q1_ACCEPT_ALTERNATIVE_RATE))
    _add_check(
        checks,
        "case95_nominal_reject_tail",
        abs(reject_tail - float(case95["reject_probability"])) <= PROBABILITY_ABS_TOL
        and reject_tail <= Q1_ALPHA_REJECT + PROBABILITY_ABS_TOL,
        reject_tail,
        f"reported={case95['reject_probability']}, upper_bound={Q1_ALPHA_REJECT}",
    )
    _add_check(
        checks,
        "case95_alternative_power",
        abs(reject_power - float(case95["reject_power"])) <= PROBABILITY_ABS_TOL
        and reject_power >= 1.0 - Q1_TYPE2_ERROR_REJECT - PROBABILITY_ABS_TOL,
        reject_power,
        f"reported={case95['reject_power']}, lower_bound={1.0-Q1_TYPE2_ERROR_REJECT}",
    )
    _add_check(
        checks,
        "case90_nominal_accept_probability",
        abs(accept_probability - float(case90["accept_probability"]))
        <= PROBABILITY_ABS_TOL
        and accept_probability >= 1.0 - Q1_ALPHA_ACCEPT - PROBABILITY_ABS_TOL,
        accept_probability,
        f"reported={case90['accept_probability']}, lower_bound={1.0-Q1_ALPHA_ACCEPT}",
    )
    _add_check(
        checks,
        "case90_alternative_power",
        abs(accept_power - float(case90["accept_power"])) <= PROBABILITY_ABS_TOL
        and accept_power >= 1.0 - Q1_TYPE2_ERROR_ACCEPT - PROBABILITY_ABS_TOL,
        accept_power,
        f"reported={case90['accept_power']}, lower_bound={1.0-Q1_TYPE2_ERROR_ACCEPT}",
    )

    endpoint_expected = (
        _direct_binom_cdf(-1, 2, 0.0),
        _direct_binom_cdf(2, 2, 1.0),
        _direct_binom_upper(-1, 2, 0.0),
        _direct_binom_upper(2, 2, 1.0),
    )
    _add_check(
        checks,
        "direct_binomial_endpoint_mass",
        endpoint_expected == (0.0, 1.0, 1.0, 0.0),
        list(endpoint_expected),
        [0.0, 1.0, 1.0, 0.0],
    )

    oc_passed = True
    maximum_pair_gap = 0.0
    for case, direction in ((case95, "reject_high"), (case90, "accept_low")):
        series = _probability_grid(case["n"], case["c"], direction)
        for row in series["points"]:
            pair_gap = abs(
                float(row["accept_probability"]) + float(row["reject_probability"]) - 1.0
            )
            maximum_pair_gap = max(maximum_pair_gap, pair_gap)
            expected_accept = (
                _direct_binom_cdf(case["c"] - 1, case["n"], row["p"])
                if direction == "reject_high"
                else _direct_binom_cdf(case["c"], case["n"], row["p"])
            )
            oc_passed = oc_passed and pair_gap <= PROBABILITY_ABS_TOL
            oc_passed = oc_passed and abs(expected_accept - row["accept_probability"]) <= PROBABILITY_ABS_TOL
    _add_check(
        checks,
        "oc_probabilities_are_disjoint_and_exact",
        oc_passed,
        {"maximum_pair_sum_gap": maximum_pair_gap},
    )

    sprt = payload.get("bounded_sprt", {})
    _add_check(
        checks,
        "bounded_sprt_case95_constraints",
        bool(sprt.get("case95", {}).get("constraints", {}).get("passed", False)),
        sprt.get("case95", {}).get("constraints", {}),
    )
    _add_check(
        checks,
        "bounded_sprt_case90_constraints",
        bool(sprt.get("case90", {}).get("constraints", {}).get("passed", False)),
        sprt.get("case90", {}).get("constraints", {}),
    )
    _add_check(
        checks,
        "probability_and_data_series_present",
        len(payload.get("sensitivity", {}).get("records", []))
        >= len(Q1_DELTA_GRID) * len(Q1_BETA_GRID)
        and len(payload.get("sample_size_vs_confidence", {}).get("records", []))
        >= len(Q1_DELTA_GRID),
        {
            "sensitivity_records": len(payload.get("sensitivity", {}).get("records", [])),
            "confidence_records": len(
                payload.get("sample_size_vs_confidence", {}).get("records", [])
            ),
        },
    )
    failures = sorted(name for name, row in checks.items() if not row["passed"])
    return {
        "all_passed": not failures,
        "checks": checks,
        "failures": failures,
        "constraint_source": "independently_recomputed_from_final_problem1_payload",
    }


def solve():
    result = _build_result()
    audit = validate_constraints(result)
    result["validation"] = audit
    result["constraints_ok"] = audit["all_passed"]
    _ensure(audit["all_passed"], f"Q1 constraint validation failed: {audit['failures']}")
    return result


def run():
    return solve()


def solve_problem1():
    return solve()


__all__ = [
    "exact_integer_enumeration",
    "bounded_sprt_dp",
    "expected_sample_size_comparison",
    "validate_constraints",
    "solve",
    "run",
    "solve_problem1",
]