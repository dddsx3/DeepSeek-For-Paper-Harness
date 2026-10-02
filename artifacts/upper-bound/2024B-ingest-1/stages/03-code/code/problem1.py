"""Exact binomial sampling designs for Problem 1.

The module distinguishes the nominal-tail-only diagnostic from the operational
fixed-sample design that also uses the registered alternative rate and Type II
error.  It uses exact integer-support binomial probabilities and a finite
likelihood-ratio random walk; no normal approximation or unbounded procedure is
used.
"""

from __future__ import annotations

import math
from functools import lru_cache
from typing import Any

import scipy.stats

import params


__all__ = [
    "binomial_cdf",
    "binomial_upper_tail",
    "solve",
]


def _checked_probability(value: float, name: str) -> float:
    probability = float(value)
    if not math.isfinite(probability) or probability < 0.0 or probability > 1.0:
        raise ValueError(f"{name} must be finite and belong to [0, 1]")
    return probability


def _binomial_pmf(x: int, n: int, probability: float) -> float:
    if x < 0 or x > n:
        return 0.0
    return float(scipy.stats.binom.pmf(x, n, probability))


@lru_cache(maxsize=None)
def binomial_cdf(n: int, k: int, probability: float) -> float:
    """Return P(X <= k) by exact integer-support enumeration."""
    if n < 1:
        raise ValueError("Binomial sample size must be positive")
    probability = _checked_probability(probability, "binomial probability")
    if k < 0:
        return 0.0
    if k >= n:
        return 1.0
    terms = (_binomial_pmf(x, n, probability) for x in range(k + 1))
    return math.fsum(terms)


@lru_cache(maxsize=None)
def binomial_upper_tail(n: int, threshold: int, probability: float) -> float:
    """Return P(X >= threshold) by exact integer-support enumeration."""
    if n < 1:
        raise ValueError("Binomial sample size must be positive")
    probability = _checked_probability(probability, "binomial probability")
    if threshold <= 0:
        return 1.0
    if threshold > n:
        return 0.0
    terms = (_binomial_pmf(x, n, probability) for x in range(threshold, n + 1))
    return math.fsum(terms)


def _log_ratio(numerator: float, denominator: float) -> float:
    if numerator == 0.0 and denominator > 0.0:
        return -math.inf
    if denominator == 0.0 and numerator > 0.0:
        return math.inf
    if numerator == 0.0 and denominator == 0.0:
        raise ValueError("A likelihood ratio cannot have zero numerator and denominator")
    return math.log(numerator / denominator)


def log_likelihood_ratio(
    defects: int,
    observations: int,
    null_rate: float,
    alternative_rate: float,
) -> float:
    """Log likelihood ratio for a Bernoulli/binomial random walk state."""
    if defects < 0 or observations < 0 or defects > observations:
        raise ValueError("Invalid likelihood-ratio lattice state")
    null_rate = _checked_probability(null_rate, "null rate")
    alternative_rate = _checked_probability(
        alternative_rate, "alternative rate"
    )
    good_defect_likelihood = _log_ratio(alternative_rate, null_rate)
    good_likelihood = _log_ratio(
        1.0 - alternative_rate,
        1.0 - null_rate,
    )
    return defects * good_defect_likelihood + (
        observations - defects
    ) * good_likelihood


def _find_rejection_scheme(
    p0: float = params.Q1_NOMINAL_RATE,
    alpha: float = params.Q1_REJECT_ALPHA,
    *,
    p_alt: float | None = None,
    minimum_power: float | None = None,
    numeric_tol: float = params.Q1_NUMERIC_TOL,
) -> dict[str, Any]:
    """Find the lexicographically first feasible integer rejection scheme.

    With ``minimum_power=None`` the search uses only the nominal upper-tail
    constraint and is explicitly a diagnostic.  Supplying both ``p_alt`` and
    ``minimum_power`` activates the registered operational power constraint.
    """
    p0 = _checked_probability(p0, "nominal rate")
    alpha = _checked_probability(alpha, "Type I error")
    if p0 >= 1.0:
        raise ValueError("A finite rejection design requires a nominal rate below one")
    if p_alt is not None:
        p_alt = _checked_probability(p_alt, "alternative rate")
        if p_alt <= p0:
            raise ValueError("The operational alternative must exceed the nominal rate")
    if minimum_power is not None:
        minimum_power = _checked_probability(
            minimum_power, "minimum operational power"
        )
        if p_alt is None:
            raise ValueError("Operational power requires an alternative rate")
    if minimum_power is None and p_alt is None:
        search_basis = "nominal_tail_constraint_only"
    else:
        search_basis = "registered_operational_power_design"

    n = 1
    while True:
        for rejection_threshold in range(1, n + 1):
            reject_tail_at_p0 = binomial_upper_tail(
                n, rejection_threshold, p0
            )
            if reject_tail_at_p0 > alpha:
                continue

            power_at_p_alt = None
            if p_alt is not None:
                power_at_p_alt = 1.0 - binomial_upper_tail(
                    n, rejection_threshold, p_alt
                )
            if (
                minimum_power is not None
                and power_at_p_alt + numeric_tol < minimum_power
            ):
                continue

            alpha_violation = max(0.0, reject_tail_at_p0 - alpha)
            power_violation = 0.0
            if minimum_power is not None:
                power_violation = max(
                    0.0,
                    minimum_power - float(power_at_p_alt),
                )
            return {
                "n": n,
                "r": rejection_threshold,
                "decision_rule": "reject when X >= r",
                "p0": p0,
                "alpha": alpha,
                "p_alt": p_alt,
                "minimum_power": minimum_power,
                "reject_tail_at_p0": reject_tail_at_p0,
                "reject_tail_at_p_alt": (
                    None
                    if p_alt is None
                    else binomial_upper_tail(n, rejection_threshold, p_alt)
                ),
                "power_at_p_alt": power_at_p_alt,
                "search_basis": search_basis,
                "search_used_alternative_rate": minimum_power is not None,
                "search_used_type_ii_error": minimum_power is not None,
                "tie_break": "lexicographically smallest (n, r)",
                "alpha_constraint_violation": alpha_violation,
                "power_constraint_violation": power_violation,
                "constraints_pass": max(alpha_violation, power_violation)
                <= numeric_tol,
            }
        n += 1


def _find_acceptance_scheme(
    p0: float = params.Q1_NOMINAL_RATE,
    acceptance_confidence: float = params.Q1_ACCEPT_CONFIDENCE,
    numeric_tol: float = params.Q1_NUMERIC_TOL,
) -> dict[str, Any]:
    """Find the minimum n and, at that n, the largest feasible integer c."""
    p0 = _checked_probability(p0, "nominal rate")
    acceptance_confidence = _checked_probability(
        acceptance_confidence, "acceptance confidence"
    )
    n = 1
    while True:
        for acceptance_threshold in range(n, -1, -1):
            acceptance_probability = binomial_cdf(
                n, acceptance_threshold, p0
            )
            if acceptance_probability + numeric_tol < acceptance_confidence:
                continue
            return {
                "n": n,
                "c": acceptance_threshold,
                "decision_rule": "accept when X <= c",
                "p0": p0,
                "acceptance_confidence": acceptance_confidence,
                "minimum_acceptance_probability": acceptance_confidence,
                "acceptance_probability_at_p0": acceptance_probability,
                "search_basis": "registered_nominal_cdf_constraint",
                "tie_break": (
                    "minimum n, then lexicographically largest c"
                ),
                "acceptance_constraint_violation": max(
                    0.0,
                    acceptance_confidence - acceptance_probability,
                ),
                "constraints_pass": max(
                    0.0,
                    acceptance_confidence - acceptance_probability,
                )
                <= numeric_tol,
            }
        n += 1


def _sprt_random_walk(
    probability: float,
    horizon: int,
    accept_boundary: float,
    reject_boundary: float,
    p0: float,
    p_alt: float,
) -> dict[str, Any]:
    """Evaluate an exact finite likelihood_ratio_random_walk by state recursion."""
    probability = _checked_probability(probability, "walk probability")
    if horizon < 1:
        raise ValueError("The finite SPRT horizon must be positive")
    if not reject_boundary < accept_boundary:
        raise ValueError("SPRT boundaries must satisfy reject < accept")

    states: dict[tuple[int, int], float] = {(0, 0): 1.0}
    decision_probabilities = {"accept": 0.0, "reject": 0.0}
    survival_probabilities: list[float] = []
    expected_samples = 0.0

    for observations in range(horizon + 1):
        next_states: dict[tuple[int, int], float] = {}
        continuing_mass = 0.0
        for (state_observations, defects), mass in states.items():
            log_lr = log_likelihood_ratio(
                defects,
                state_observations,
                p0,
                p_alt,
            )
            if log_lr <= accept_boundary:
                decision_probabilities["accept"] += mass
                continue
            if log_lr >= reject_boundary:
                decision_probabilities["reject"] += mass
                continue
            if state_observations >= horizon:
                forced_decision = (
                    "accept" if log_lr >= 0.0 else "reject"
                )
                decision_probabilities[forced_decision] += mass
                continue

            continuing_mass += mass
            expected_samples += mass
            next_states[(state_observations + 1, defects + 1)] = (
                next_states.get((state_observations + 1, defects + 1), 0.0)
                + mass * probability
            )
            next_states[(state_observations + 1, defects)] = (
                next_states.get((state_observations + 1, defects), 0.0)
                + mass * (1.0 - probability)
            )

        if observations < horizon:
            survival_probabilities.append(continuing_mass)
        states = next_states

    sample_size_pmf: list[float] = []
    if len(survival_probabilities) == horizon:
        sample_size_pmf.append(survival_probabilities[0])
        sample_size_pmf.extend(
            survival_probabilities[index - 1] - survival_probabilities[index]
            for index in range(1, horizon)
        )
        sample_size_pmf.append(survival_probabilities[-1])
    else:
        sample_size_pmf = [1.0 - math.fsum(decision_probabilities.values())]

    expected_from_pmf = math.fsum(
        (index + 1) * probability_mass
        for index, probability_mass in enumerate(sample_size_pmf)
    )
    probability_sum = math.fsum(decision_probabilities.values())
    return {
        "probability": probability,
        "expected_samples": expected_samples,
        "expected_samples_from_pmf": expected_from_pmf,
        "expected_sample_identity_error": abs(
            expected_samples - expected_from_pmf
        ),
        "accept_probability": decision_probabilities["accept"],
        "reject_probability": decision_probabilities["reject"],
        "decision_probability_sum": probability_sum,
        "decision_probability_sum_error": abs(probability_sum - 1.0),
        "sample_size_pmf": sample_size_pmf,
        "survival_probability": survival_probabilities,
    }


def _sprt_boundary_trace(
    horizon: int,
    accept_boundary: float,
    reject_boundary: float,
    p0: float,
    p_alt: float,
) -> list[dict[str, Any]]:
    """Return the exact integer continuation band at every observation count."""
    trace: list[dict[str, Any]] = []
    for observations in range(horizon + 1):
        continuing_states = [
            defects
            for defects in range(observations + 1)
            if reject_boundary
            < log_likelihood_ratio(
                defects,
                observations,
                p0,
                p_alt,
            )
            < accept_boundary
        ]
        trace.append(
            {
                "n": observations,
                "lower_continue_x": (
                    continuing_states[0] if continuing_states else None
                ),
                "upper_continue_x": (
                    continuing_states[-1] if continuing_states else None
                ),
                "interior_state_count": len(continuing_states),
            }
        )
    return trace


def _probability_anchors(parameter_source: Any) -> list[float]:
    """Build deterministic OC anchors solely from registered Q1 values."""
    p0 = parameter_source.Q1_NOMINAL_RATE
    anchors = {0.0, 1.0, p0}
    for delta in parameter_source.Q1_DELTA_GRID:
        candidates = {p0 + delta, p0 - delta}
        for beta in parameter_source.Q1_BETA_GRID:
            candidates.add(p0 + delta * beta)
            candidates.add(p0 - delta * beta)
        for candidate in candidates:
            if 0.0 <= candidate <= 1.0:
                anchors.add(float(candidate))
    return sorted(anchors)


def _registered_consistency(parameter_source: Any) -> dict[str, bool]:
    tolerance = parameter_source.Q1_NUMERIC_TOL
    operational = parameter_source.Q1_CASE95_OPERATIONAL_CONSTRAINTS
    diagnostic = parameter_source.Q1_CASE95_NOMINAL_ONLY_CONSTRAINTS
    acceptance = parameter_source.Q1_CASE90_CONSTRAINTS
    checks = {
        "operational_p0": abs(
            operational["p0"] - parameter_source.Q1_NOMINAL_RATE
        )
        <= tolerance,
        "operational_alpha": abs(
            operational["alpha"] - parameter_source.Q1_REJECT_ALPHA
        )
        <= tolerance,
        "operational_delta": abs(
            operational["delta"] - parameter_source.Q1_ALTERNATIVE_DELTA
        )
        <= tolerance,
        "operational_beta": abs(
            operational["beta"] - parameter_source.Q1_TYPE_II_ERROR
        )
        <= tolerance,
        "operational_p_alt": abs(
            operational["p_alt"] - parameter_source.Q1_ALTERNATIVE_RATE
        )
        <= tolerance,
        "diagnostic_p0": abs(
            diagnostic["p0"] - parameter_source.Q1_NOMINAL_RATE
        )
        <= tolerance,
        "diagnostic_alpha": abs(
            diagnostic["alpha"] - parameter_source.Q1_REJECT_ALPHA
        )
        <= tolerance,
        "acceptance_p0": abs(
            acceptance["p0"] - parameter_source.Q1_NOMINAL_RATE
        )
        <= tolerance,
        "acceptance_confidence": abs(
            acceptance["acceptance_confidence"]
            - parameter_source.Q1_ACCEPT_CONFIDENCE
        )
        <= tolerance,
    }
    if not all(checks.values()):
        raise RuntimeError("Registered Problem 1 constraints are internally inconsistent")
    return checks


def solve(parameter_source=params) -> dict[str, Any]:
    """Run all Problem 1 exact designs and return the JSON-ready ledger."""
    p = parameter_source
    tolerance = p.Q1_NUMERIC_TOL
    registered_checks = _registered_consistency(p)

    operational_constraints = p.Q1_CASE95_OPERATIONAL_CONSTRAINTS
    operational = _find_rejection_scheme(
        operational_constraints["p0"],
        operational_constraints["alpha"],
        p_alt=operational_constraints["p_alt"],
        minimum_power=operational_constraints["minimum_power"],
        numeric_tol=tolerance,
    )
    operational.update(
        {
            "unit": "tests",
            "answer_scope": (
                "conditional minimum under the registered alternative rate "
                "and Type II error design"
            ),
            "is_operational_recommendation": True,
        }
    )

    nominal_constraints = p.Q1_CASE95_NOMINAL_ONLY_CONSTRAINTS
    nominal_only = _find_rejection_scheme(
        nominal_constraints["p0"],
        nominal_constraints["alpha"],
        p_alt=operational_constraints["p_alt"],
        minimum_power=None,
        numeric_tol=tolerance,
    )
    nominal_only.update(
        {
            "unit": "tests",
            "answer_scope": (
                "diagnostic minimum using only the nominal upper-tail condition"
            ),
            "is_operational_recommendation": False,
            "identification_warning": (
                "the nominal-tail condition alone does not impose a minimum "
                "power at the registered alternative rate"
            ),
        }
    )

    acceptance_constraints = p.Q1_CASE90_CONSTRAINTS
    acceptance = _find_acceptance_scheme(
        acceptance_constraints["p0"],
        acceptance_constraints["acceptance_confidence"],
        numeric_tol=tolerance,
    )
    acceptance.update(
        {
            "unit": "tests",
            "answer_scope": "minimum under the registered nominal CDF constraint",
        }
    )

    alpha = float(operational["alpha"])
    beta = float(p.Q1_TYPE_II_ERROR)
    p0 = float(operational["p0"])
    p_alt = float(operational["p_alt"])
    fixed_n = int(operational["n"])
    accept_boundary = math.log((1.0 - beta) / alpha)
    reject_boundary = math.log(beta / (1.0 - alpha))

    walk_at_p0 = _sprt_random_walk(
        p0,
        fixed_n,
        accept_boundary,
        reject_boundary,
        p0,
        p_alt,
    )
    walk_at_p_alt = _sprt_random_walk(
        p_alt,
        fixed_n,
        accept_boundary,
        reject_boundary,
        p0,
        p_alt,
    )

    sprt_alpha_violation = max(
        0.0,
        float(walk_at_p0["reject_probability"]) - alpha,
    )
    sprt_power_violation = max(
        0.0,
        float(operational["minimum_power"])
        - (1.0 - float(walk_at_p_alt["reject_probability"])),
    )
    sprt_constraints_pass = max(
        sprt_alpha_violation,
        sprt_power_violation,
    ) <= tolerance
    sprt_expected_not_worse = (
        float(walk_at_p0["expected_samples"]) <= fixed_n + tolerance
        and float(walk_at_p_alt["expected_samples"]) <= fixed_n + tolerance
    )
    sprt_selected = sprt_constraints_pass and sprt_expected_not_worse

    finite_sprt = {
        "method": p.Q1_SPRT_METHOD,
        "method_signature": "finite_likelihood_ratio_random_walk",
        "finite_horizon": True,
        "horizon_n": fixed_n,
        "p0": p0,
        "p_alt": p_alt,
        "alpha": alpha,
        "beta": beta,
        "accept_log_likelihood_boundary": accept_boundary,
        "reject_log_likelihood_boundary": reject_boundary,
        "truncation_rule": (
            "at the horizon accept when log LR is nonnegative, otherwise reject"
        ),
        "expected_n_at_p0": walk_at_p0["expected_samples"],
        "expected_n_at_p_alt": walk_at_p_alt["expected_samples"],
        "reject_probability_at_p0": walk_at_p0["reject_probability"],
        "reject_probability_at_p_alt": walk_at_p_alt["reject_probability"],
        "power_at_p_alt": 1.0 - walk_at_p_alt["reject_probability"],
        "alpha_constraint_violation": sprt_alpha_violation,
        "power_constraint_violation": sprt_power_violation,
        "exact_tail_constraints_pass": sprt_constraints_pass,
        "expected_samples_not_worse_than_fixed": sprt_expected_not_worse,
        "selected": sprt_selected,
        "walk_at_p0": walk_at_p0,
        "walk_at_p_alt": walk_at_p_alt,
        "boundary_trace": _sprt_boundary_trace(
            fixed_n,
            accept_boundary,
            reject_boundary,
            p0,
            p_alt,
        ),
    }

    selection_reasons: list[str] = []
    if not sprt_constraints_pass:
        selection_reasons.append("finite truncation failed an exact tail constraint")
    if not sprt_expected_not_worse:
        selection_reasons.append("finite SPRT did not improve both expected sample sizes")
    if not selection_reasons:
        selection_reasons.append("finite SPRT passed the registered comparison rule")

    selection = {
        "selected_method": "finite_sprt" if sprt_selected else "fixed_sample",
        "fixed_sample_n": fixed_n,
        "selected_expected_n_at_p0": (
            float(walk_at_p0["expected_samples"])
            if sprt_selected
            else fixed_n
        ),
        "selected_expected_n_at_p_alt": (
            float(walk_at_p_alt["expected_samples"])
            if sprt_selected
            else fixed_n
        ),
        "comparison_rule": (
            "select finite SPRT only if exact tail constraints pass and "
            "both expected sample sizes are no larger"
        ),
        "reason_codes": selection_reasons,
    }

    sensitivity_rows: list[dict[str, Any]] = []
    for delta in p.Q1_DELTA_GRID:
        for type_ii_error in p.Q1_BETA_GRID:
            alternative_rate = p0 + delta
            scheme = _find_rejection_scheme(
                p0,
                alpha,
                p_alt=alternative_rate,
                minimum_power=1.0 - type_ii_error,
                numeric_tol=tolerance,
            )
            sensitivity_rows.append(
                {
                    "registered_delta": delta,
                    "registered_type_ii_error": type_ii_error,
                    "target_power": 1.0 - type_ii_error,
                    "p_alt": alternative_rate,
                    "n": scheme["n"],
                    "r": scheme["r"],
                    "reject_tail_at_p0": scheme["reject_tail_at_p0"],
                    "power_at_p_alt": scheme["power_at_p_alt"],
                    "constraints_pass": scheme["constraints_pass"],
                }
            )

    base_sensitivity = next(
        row
        for row in sensitivity_rows
        if row["registered_delta"] == p.Q1_ALTERNATIVE_DELTA
        and row["registered_type_ii_error"] == p.Q1_TYPE_II_ERROR
    )
    for row in sensitivity_rows:
        row["n_difference_from_operational_design"] = (
            int(row["n"]) - fixed_n
        )

    oc_rows: list[dict[str, Any]] = []
    for probability in _probability_anchors(p):
        oc_rows.append(
            {
                "p": probability,
                "case95_operational_power_reject_probability": (
                    binomial_upper_tail(
                        operational["n"],
                        operational["r"],
                        probability,
                    )
                ),
                "case95_operational_power_accept_probability": (
                    binomial_cdf(
                        operational["n"],
                        int(operational["r"]) - 1,
                        probability,
                    )
                ),
                "case95_nominal_only_diagnostic_reject_probability": (
                    binomial_upper_tail(
                        nominal_only["n"],
                        nominal_only["r"],
                        probability,
                    )
                ),
                "case95_nominal_only_diagnostic_accept_probability": (
                    binomial_cdf(
                        nominal_only["n"],
                        int(nominal_only["r"]) - 1,
                        probability,
                    )
                ),
                "case90_receive_accept_probability": binomial_cdf(
                    acceptance["n"],
                    acceptance["c"],
                    probability,
                ),
            }
        )

    reject_probabilities = [
        float(row["case95_operational_power_reject_probability"])
        for row in oc_rows
    ]
    operational_accept_probabilities = [
        float(row["case95_operational_power_accept_probability"])
        for row in oc_rows
    ]
    receive_accept_probabilities = [
        float(row["case90_receive_accept_probability"])
        for row in oc_rows
    ]
    rejection_monotonicity_violation = max(
        (
            max(0.0, later - earlier)
            for earlier, later in zip(
                reject_probabilities,
                reject_probabilities[1:],
            )
        ),
        default=0.0,
    )
    operational_acceptance_monotonicity_violation = max(
        (
            max(0.0, earlier - later)
            for earlier, later in zip(
                operational_accept_probabilities,
                operational_accept_probabilities[1:],
            )
        ),
        default=0.0,
    )
    receive_monotonicity_violation = max(
        (
            max(0.0, earlier - later)
            for earlier, later in zip(
                receive_accept_probabilities,
                receive_accept_probabilities[1:],
            )
        ),
        default=0.0,
    )

    cdf_crosscheck_error = max(
        abs(
            binomial_cdf(operational["n"], operational["r"], p0)
            - float(scipy.stats.binom.cdf(operational["r"], operational["n"], p0))
        ),
        abs(
            binomial_cdf(acceptance["n"], acceptance["c"], p0)
            - float(scipy.stats.binom.cdf(acceptance["c"], acceptance["n"], p0))
        ),
    )
    tail_crosscheck_error = abs(
        float(operational["reject_tail_at_p0"])
        - float(
            scipy.stats.binom.sf(
                int(operational["r"]) - 1,
                int(operational["n"]),
                p0,
            )
        )
    )
    sensitivity_constraint_failures = sum(
        not bool(row["constraints_pass"]) for row in sensitivity_rows
    )
    sprt_probability_conservation_error = max(
        float(walk_at_p0["decision_probability_sum_error"]),
        float(walk_at_p_alt["decision_probability_sum_error"]),
    )
    sprt_expected_identity_error = max(
        float(walk_at_p0["expected_sample_identity_error"]),
        float(walk_at_p_alt["expected_sample_identity_error"]),
    )

    validation_checks = {
        "registered_constraints_consistent": all(registered_checks.values()),
        "operational_case95_constraints_pass": bool(
            operational["constraints_pass"]
        ),
        "nominal_only_diagnostic_constraint_pass": bool(
            nominal_only["constraints_pass"]
        ),
        "case90_constraint_pass": bool(acceptance["constraints_pass"]),
        "sensitivity_constraints_all_pass": sensitivity_constraint_failures == 0,
        "rejection_probability_monotone_in_p": (
            rejection_monotonicity_violation <= tolerance
        ),
        "operational_acceptance_monotone_in_p": (
            operational_acceptance_monotonicity_violation <= tolerance
        ),
        "case90_acceptance_monotone_in_p": (
            receive_monotonicity_violation <= tolerance
        ),
        "exact_cdf_crosscheck_pass": cdf_crosscheck_error <= tolerance,
        "exact_tail_crosscheck_pass": tail_crosscheck_error <= tolerance,
        "finite_sprt_probability_conservation_pass": (
            sprt_probability_conservation_error <= tolerance
        ),
        "finite_sprt_expected_identity_pass": (
            sprt_expected_identity_error <= tolerance
        ),
        "finite_sprt_boundaries_finite": (
            math.isfinite(accept_boundary) and math.isfinite(reject_boundary)
        ),
    }
    all_validation_checks_pass = all(validation_checks.values())
    if not all_validation_checks_pass:
        raise RuntimeError("Problem 1 structural validation failed")

    validation = {
        "checks": validation_checks,
        "all_passed": all_validation_checks_pass,
        "numeric_tolerance": tolerance,
        "registered_constraint_checks": registered_checks,
        "rejection_monotonicity_max_violation": (
            rejection_monotonicity_violation
        ),
        "operational_acceptance_monotonicity_max_violation": (
            operational_acceptance_monotonicity_violation
        ),
        "case90_acceptance_monotonicity_max_violation": (
            receive_monotonicity_violation
        ),
        "cdf_crosscheck_max_error": cdf_crosscheck_error,
        "tail_crosscheck_max_error": tail_crosscheck_error,
        "sensitivity_constraint_failure_count": (
            sensitivity_constraint_failures
        ),
        "sprt_probability_conservation_max_error": (
            sprt_probability_conservation_error
        ),
        "sprt_expected_identity_max_error": sprt_expected_identity_error,
    }

    return {
        "problem": "Q1",
        "method": {
            "fixed_sample": p.Q1_METHOD,
            "fixed_sample_signature": "exact_integer_enumeration",
            "probability_kernel": "scipy.stats.binom.pmf over integer support",
            "finite_sprt": p.Q1_SPRT_METHOD,
            "finite_sprt_signature": "finite_likelihood_ratio_random_walk",
            "normal_approximation_used": False,
            "tie_break": "lexicographic integer enumeration",
        },
        "parameter_provenance": {
            "nominal_rate_fact_id": "F-NOMINAL",
            "reject_confidence_fact_id": "F-CONF-REJECT",
            "accept_confidence_fact_id": "F-CONF-ACCEPT",
            "operational_design_basis": (
                operational_constraints["basis"]
            ),
            "nominal_only_diagnostic_basis": nominal_constraints["basis"],
            "operational_constraints": operational_constraints,
            "nominal_only_constraints": nominal_constraints,
            "acceptance_constraints": acceptance_constraints,
        },
        "case95_operational_power": operational,
        "case95_nominal_only_diagnostic": nominal_only,
        "case90": acceptance,
        "fixed_sample_comparison": {
            "scheme_basis": "case95_operational_power",
            "n": fixed_n,
            "expected_n_at_p0": fixed_n,
            "expected_n_at_p_alt": fixed_n,
            "maximum_tests": fixed_n,
        },
        "finite_sprt_comparison": finite_sprt,
        "scheme_selection": selection,
        "oc_curve": {
            "anchor_construction": (
                "registered nominal rate, delta grid, beta grid, "
                "and probability endpoints"
            ),
            "rows": oc_rows,
        },
        "sensitivity": {
            "design_parameters_vary": ["registered_delta", "registered_type_ii_error"],
            "rows": sensitivity_rows,
            "operational_base_row": base_sensitivity,
        },
        "sample_size_vs_confidence": {
            "x_axis_meaning": "target power equals one minus Type II error",
            "rows": [
                {
                    "registered_delta": row["registered_delta"],
                    "target_power": row["target_power"],
                    "minimum_n": row["n"],
                    "r": row["r"],
                }
                for row in sensitivity_rows
            ],
        },
        "two_case_sample_size": {
            "rows": [
                {
                    "case": "case95_operational_power",
                    "n": operational["n"],
                    "threshold": operational["r"],
                },
                {
                    "case": "case95_nominal_only_diagnostic",
                    "n": nominal_only["n"],
                    "threshold": nominal_only["r"],
                },
                {
                    "case": "case90",
                    "n": acceptance["n"],
                    "threshold": acceptance["c"],
                },
            ]
        },
        "validation": validation,
    }