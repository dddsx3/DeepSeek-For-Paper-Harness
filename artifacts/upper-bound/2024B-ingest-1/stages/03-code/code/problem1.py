"""问题一：精确二项抽样方案、灵敏度网格与有限 SPRT 对照。"""

from __future__ import annotations

import itertools
import math
from typing import Any

import scipy.stats
from params import *


def _validate_probability(name: str, value: float) -> None:
    if not 0 <= value <= 1:
        raise ValueError(f"{name} must lie in [0, 1], got {value!r}")


def _validate_error_rate(name: str, value: float) -> None:
    _validate_probability(name, value)
    if not 0 < value < 1:
        raise ValueError(f"{name} must be strictly between zero and one")


def exact_integer_enumeration(n: int, p: float) -> list[float]:
    """返回二项分布全部整数计数点的精确 PMF。"""
    if n < 1:
        raise ValueError("sample size must be a positive integer")
    _validate_probability("defect probability", p)
    masses = scipy.stats.binom.pmf(range(n + 1), n, p)
    return [float(mass) for mass in masses]


def _single_binomial_pmf(n: int, x: int, p: float) -> float:
    if x < 0 or x > n:
        return 0.0
    return float(math.comb(n, x) * p**x * (1.0 - p) ** (n - x))


def _independent_integer_sum(
    n: int,
    threshold: int,
    p: float,
    *,
    upper_tail: bool,
) -> float:
    """用有限整数求和独立复算 scipy.stats.binom 的尾部概率。"""
    _validate_probability("defect probability", p)
    if upper_tail:
        if threshold <= 0:
            return 1.0
        if threshold > n:
            return 0.0
        start, stop = threshold, n + 1
    else:
        if threshold < 0:
            return 0.0
        if threshold >= n:
            return 1.0
        start, stop = 0, threshold + 1
    return math.fsum(
        _single_binomial_pmf(n, x, p) for x in range(start, stop)
    )


def _cdf_table(n: int, p: float) -> list[float]:
    return list(itertools.accumulate(exact_integer_enumeration(n, p)))


def _survival_table(n: int, p: float) -> list[float]:
    masses = exact_integer_enumeration(n, p)
    return list(itertools.accumulate(reversed(masses)))[::-1]


def _find_rejection_scheme(
    alternative_delta: float,
    type_ii_error: float,
) -> dict[str, Any]:
    """在备 Alternatives 功效约束下枚举首个可行整数方案。"""
    if alternative_delta <= 0:
        raise ValueError("alternative delta must be positive")
    alternative_rate = Q1_P0 + alternative_delta
    _validate_probability("alternative rate", alternative_rate)
    _validate_error_rate("type-II error", type_ii_error)
    if not Q1_P0 < alternative_rate <= 1:
        raise ValueError("alternative rate must exceed the nominal rate")

    evaluated = 0
    for n in itertools.count(1):
        nominal_tail = _survival_table(n, Q1_P0)
        alternative_tail = _survival_table(n, alternative_rate)
        for r in range(1, n + 1):
            evaluated += 1
            nominal_reject = nominal_tail[r]
            alternative_reject = alternative_tail[r]
            if (
                nominal_reject <= Q1_REJECT_ALPHA + Q1_EXACT_ENUMERATION_TOL
                and alternative_reject
                >= 1 - type_ii_error - Q1_EXACT_ENUMERATION_TOL
            ):
                exact_nominal = _independent_integer_sum(
                    n, r, Q1_P0, upper_tail=True
                )
                exact_alternative = _independent_integer_sum(
                    n, r, alternative_rate, upper_tail=True
                )
                scipy_nominal = float(
                    scipy.stats.binom.sf(r - 1, n, Q1_P0)
                )
                scipy_alternative = float(
                    scipy.stats.binom.sf(r - 1, n, alternative_rate)
                )
                return {
                    "n": n,
                    "r": r,
                    "alternative_delta": alternative_delta,
                    "alternative_rate": alternative_rate,
                    "type_ii_error": type_ii_error,
                    "reject_tail": exact_nominal,
                    "reject_tail_at_alternative": exact_alternative,
                    "power_at_alternative": exact_alternative,
                    "type_i_error": exact_nominal,
                    "type_ii_error_realized": 1 - exact_alternative,
                    "first_type_error_margin": Q1_REJECT_ALPHA - exact_nominal,
                    "power_shortfall": max(
                        0.0, 1 - type_ii_error - exact_alternative
                    ),
                    "candidate_schemes_evaluated": evaluated,
                    "scipy_nominal_reject_tail": scipy_nominal,
                    "scipy_alternative_reject_tail": scipy_alternative,
                    "independent_sum_max_abs_diff": max(
                        abs(exact_nominal - scipy_nominal),
                        abs(exact_alternative - scipy_alternative),
                    ),
                    "decision_rule": "reject if X >= r; otherwise accept",
                    "tie_break": "smallest n, then smallest feasible r",
                    "minimum_scope": "registered_delta_and_type_II_error_power_constraint",
                }
        raise RuntimeError(
            "the registered rejection constraints did not yield a finite scheme"
        )


def _find_statement_only_rejection_scheme() -> dict[str, Any]:
    """只使用题面拒收置信条件，不附加备择功效条件。"""
    evaluated = 0
    for n in itertools.count(1):
        nominal_tail = _survival_table(n, Q1_P0)
        for r in range(1, n + 1):
            evaluated += 1
            reject_tail = nominal_tail[r]
            if reject_tail <= Q1_REJECT_ALPHA + Q1_EXACT_ENUMERATION_TOL:
                exact_tail = _independent_integer_sum(
                    n, r, Q1_P0, upper_tail=True
                )
                scipy_tail = float(scipy.stats.binom.sf(r - 1, n, Q1_P0))
                return {
                    "n": n,
                    "r": r,
                    "reject_tail": exact_tail,
                    "confidence_level": Q1_REJECT_CONFIDENCE,
                    "type_i_error": exact_tail,
                    "candidate_schemes_evaluated": evaluated,
                    "scipy_reject_tail": scipy_tail,
                    "independent_sum_abs_diff": abs(exact_tail - scipy_tail),
                    "decision_rule": "reject if X >= r; otherwise accept",
                    "tie_break": "smallest n, then smallest feasible r",
                    "minimum_scope": "statement_confidence_condition_only",
                    "has_alternative_power_constraint": False,
                }
        raise RuntimeError("the statement-only rejection search did not converge")


def _find_acceptance_scheme() -> dict[str, Any]:
    """按登记规则选择首个 n 下置信约束可行的最大整数 c。"""
    evaluated = 0
    for n in itertools.count(1):
        nominal_cdf = _cdf_table(n, Q1_P0)
        feasible = [
            c
            for c in range(n + 1)
            if nominal_cdf[c]
            >= Q1_ACCEPT_CONFIDENCE - Q1_EXACT_ENUMERATION_TOL
        ]
        if feasible:
            c = max(feasible)
            smallest_feasible_c = min(feasible)
            exact_accept = _independent_integer_sum(
                n, c, Q1_P0, upper_tail=False
            )
            alternative_accept = _independent_integer_sum(
                n, c, Q1_P0 + Q1_ALTERNATIVE_DELTA, upper_tail=False
            )
            scipy_accept = float(scipy.stats.binom.cdf(c, n, Q1_P0))
            return {
                "n": n,
                "c": c,
                "smallest_feasible_c_at_same_n": smallest_feasible_c,
                "accept_tail": exact_accept,
                "accept_probability_at_p0": exact_accept,
                "type_ii_error_at_p0": 1 - exact_accept,
                "accept_probability_at_registered_alternative": alternative_accept,
                "type_ii_error_at_registered_alternative": 1 - alternative_accept,
                "confidence_level": Q1_ACCEPT_CONFIDENCE,
                "candidate_thresholds_evaluated": evaluated + len(feasible),
                "scipy_accept_probability": scipy_accept,
                "independent_sum_abs_diff": abs(exact_accept - scipy_accept),
                "decision_rule": "accept if X <= c; otherwise reject",
                "tie_break": "smallest n, then largest feasible c",
                "minimum_scope": "statement_acceptance_confidence_condition_only",
                "registered_rule_is_vacuous_at_returned_c": c == n,
            }
        evaluated += n + 1
    raise RuntimeError("the acceptance search did not converge")


def _build_registered_probability_grid() -> list[float]:
    """由登记的 Delta 与 beta 网格构造可复算的 OC 概率网格。"""
    values = {0.0, Q1_P0}
    for delta in Q1_DELTA_GRID:
        for beta in Q1_TYPE_II_ERROR_GRID:
            scales = (
                beta / Q1_TYPE_II_ERROR,
                Q1_TYPE_II_ERROR / beta,
            )
            for scale in scales:
                for candidate in (
                    Q1_P0 + delta * scale,
                    Q1_P0 - delta * scale,
                ):
                    if 0 <= candidate <= 1:
                        values.add(candidate)
    return sorted(values)


def _oc_curve(
    rejection_scheme: dict[str, Any],
    acceptance_scheme: dict[str, Any],
) -> dict[str, Any]:
    probabilities = _build_registered_probability_grid()
    rows: list[dict[str, float]] = []
    for p in probabilities:
        masses = exact_integer_enumeration(rejection_scheme["n"], p)
        reject_cdf = list(itertools.accumulate(masses))
        case95_accept = reject_cdf[rejection_scheme["r"] - 1]
        case95_reject = math.fsum(masses[rejection_scheme["r"] :])
        masses_acceptance = exact_integer_enumeration(acceptance_scheme["n"], p)
        case90_cdf = list(itertools.accumulate(masses_acceptance))
        case90_accept = case90_cdf[acceptance_scheme["c"]]
        rows.append(
            {
                "p": p,
                "case95_accept_probability": case95_accept,
                "case95_reject_probability": case95_reject,
                "case90_accept_probability": case90_accept,
            }
        )

    reject_increases = []
    accept_decreases = []
    for previous, current in zip(rows, rows[1:]):
        reject_increases.append(
            current["case95_reject_probability"]
            - previous["case95_reject_probability"]
        )
        accept_decreases.append(
            previous["case95_accept_probability"]
            - current["case95_accept_probability"]
        )
    reject_max_violation = max([0.0, *reject_increases])
    accept_max_violation = max([0.0, *accept_decreases])
    return {
        "p": probabilities,
        "case95_accept_prob": [
            row["case95_accept_probability"] for row in rows
        ],
        "case95_reject_prob": [
            row["case95_reject_probability"] for row in rows
        ],
        "case90_accept_prob": [
            row["case90_accept_probability"] for row in rows
        ],
        "rows": rows,
        "grid_point_count": len(rows),
        "grid_construction": "crossed registered delta and type-II-error grids",
        "reject_probability_monotone_nondecreasing": (
            reject_max_violation <= Q1_EXACT_ENUMERATION_TOL
        ),
        "accept_probability_monotone_nonincreasing": (
            accept_max_violation <= Q1_EXACT_ENUMERATION_TOL
        ),
        "reject_monotonicity_max_violation": reject_max_violation,
        "accept_monotonicity_max_violation": accept_max_violation,
    }


def _sensitivity_grid() -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    for delta in Q1_DELTA_GRID:
        for beta in Q1_TYPE_II_ERROR_GRID:
            scheme = _find_rejection_scheme(delta, beta)
            rows.append(
                {
                    "delta": delta,
                    "type_ii_error": beta,
                    "alternative_rate": scheme["alternative_rate"],
                    "n": scheme["n"],
                    "r": scheme["r"],
                    "reject_tail_at_p0": scheme["reject_tail"],
                    "reject_tail_at_alternative": (
                        scheme["reject_tail_at_alternative"]
                    ),
                    "power_at_alternative": scheme["power_at_alternative"],
                    "constraint_residual": max(
                        0.0,
                        scheme["reject_tail"] - Q1_REJECT_ALPHA,
                        1 - beta - scheme["power_at_alternative"],
                    ),
                }
            )

    delta_checks = []
    for beta in sorted(set(Q1_TYPE_II_ERROR_GRID)):
        selected = [row for row in rows if row["type_ii_error"] == beta]
        selected.sort(key=lambda row: row["delta"])
        violations = sum(
            current["n"] < previous["n"]
            for previous, current in zip(selected, selected[1:])
        )
        delta_checks.append(
            {
                "type_ii_error": beta,
                "passes": violations == 0,
                "monotonicity_violation_count": violations,
            }
        )

    beta_checks = []
    for delta in sorted(set(Q1_DELTA_GRID)):
        selected = [row for row in rows if row["delta"] == delta]
        selected.sort(key=lambda row: row["type_ii_error"])
        violations = sum(
            current["n"] > previous["n"]
            for previous, current in zip(selected, selected[1:])
        )
        beta_checks.append(
            {
                "delta": delta,
                "passes": violations == 0,
                "monotonicity_violation_count": violations,
            }
        )

    return {
        "rows": rows,
        "delta_grid": list(Q1_DELTA_GRID),
        "type_ii_error_grid": list(Q1_TYPE_II_ERROR_GRID),
        "row_count": len(rows),
        "sample_size_non_decreasing_with_delta": all(
            item["passes"] for item in delta_checks
        ),
        "sample_size_non_increasing_with_type_ii_error": all(
            item["passes"] for item in beta_checks
        ),
        "delta_checks": delta_checks,
        "type_ii_error_checks": beta_checks,
    }


def _boundary_summary(
    max_n: int,
    p0: float,
    alternative_rate: float,
    lower_log_likelihood_ratio: float,
    upper_log_likelihood_ratio: float,
) -> list[dict[str, Any]]:
    good_step = math.log((1 - alternative_rate) / (1 - p0))
    bad_step = math.log(alternative_rate / p0)
    rows: list[dict[str, Any]] = []
    for sample in range(max_n + 1):
        accepted = []
        rejected = []
        continuing = []
        for defects in range(sample + 1):
            log_ratio = (
                defects * bad_step + (sample - defects) * good_step
            )
            if log_ratio <= lower_log_likelihood_ratio:
                accepted.append(defects)
            elif log_ratio >= upper_log_likelihood_ratio:
                rejected.append(defects)
            elif sample == max_n:
                if log_ratio >= 0:
                    rejected.append(defects)
                else:
                    accepted.append(defects)
            else:
                continuing.append(defects)
        rows.append(
            {
                "sample": sample,
                "accept_min_defects": min(accepted) if accepted else None,
                "accept_max_defects": max(accepted) if accepted else None,
                "continue_min_defects": (
                    min(continuing) if continuing else None
                ),
                "continue_max_defects": (
                    max(continuing) if continuing else None
                ),
                "reject_min_defects": min(rejected) if rejected else None,
                "reject_max_defects": max(rejected) if rejected else None,
            }
        )
    return rows


def likelihood_ratio_random_walk(
    max_n: int,
    p0: float,
    alternative_rate: float,
    alpha: float,
    beta: float,
) -> dict[str, Any]:
    """计算有限截断似然比随机游走及两种真实率下的精确决策概率。"""
    if max_n < 1:
        raise ValueError("SPRT truncation must be positive")
    _validate_probability("null rate", p0)
    _validate_probability("alternative rate", alternative_rate)
    _validate_error_rate("type-I error allocation", alpha)
    _validate_error_rate("type-II error allocation", beta)
    if not p0 < alternative_rate <= 1:
        raise ValueError("alternative rate must exceed null rate")

    lower_boundary = math.log(beta / (1 - alpha))
    upper_boundary = math.log((1 - beta) / alpha)
    good_step = math.log((1 - alternative_rate) / (1 - p0))
    bad_step = math.log(alternative_rate / p0)

    def evaluate_rate(rate: float) -> dict[str, Any]:
        states = {(0, 0): 1.0}
        survival_curve: list[float] = []
        decision_probability = {
            "accept": 0.0,
            "reject": 0.0,
            "truncated_accept": 0.0,
            "truncated_reject": 0.0,
        }
        for sample in range(max_n):
            survival_curve.append(math.fsum(states.values()))
            next_states: dict[tuple[int, int], float] = {}
            for (defects, current_n), mass in states.items():
                if current_n != sample:
                    raise RuntimeError("SPRT state layer is inconsistent")
                good_mass = mass * (1 - rate)
                bad_mass = mass * rate
                next_states[(defects, sample + 1)] = (
                    next_states.get((defects, sample + 1), 0.0)
                    + good_mass
                )
                next_states[(defects + 1, sample + 1)] = (
                    next_states.get((defects + 1, sample + 1), 0.0)
                    + bad_mass
                )
            states = next_states
            for (defects, current_n), mass in states.items():
                log_ratio = (
                    defects * bad_step
                    + (current_n - defects) * good_step
                )
                if log_ratio <= lower_boundary:
                    decision_probability["accept"] += mass
                elif log_ratio >= upper_boundary:
                    decision_probability["reject"] += mass
                elif current_n == max_n:
                    if log_ratio >= 0:
                        decision_probability["truncated_reject"] += mass
                    else:
                        decision_probability["truncated_accept"] += mass
        if states:
            raise RuntimeError("finite SPRT failed to resolve all states")
        probability_sum = math.fsum(decision_probability.values())
        return {
            "rate": rate,
            "expected_n": math.fsum(survival_curve),
            "survival_curve": survival_curve,
            "decision_probability": decision_probability,
            "reject_probability": (
                decision_probability["reject"]
                + decision_probability["truncated_reject"]
            ),
            "accept_probability": (
                decision_probability["accept"]
                + decision_probability["truncated_accept"]
            ),
            "probability_normalization_error": abs(probability_sum - 1),
        }

    nominal = evaluate_rate(p0)
    alternative = evaluate_rate(alternative_rate)
    boundaries = _boundary_summary(
        max_n,
        p0,
        alternative_rate,
        lower_boundary,
        upper_boundary,
    )
    return {
        "truncation_n": max_n,
        "lower_log_likelihood_ratio": lower_boundary,
        "upper_log_likelihood_ratio": upper_boundary,
        "boundary_rule": "accept below lower boundary; reject above upper boundary",
        "truncation_rule": "at truncation reject when likelihood ratio is at least one",
        "boundary_rows": boundaries,
        "nominal": nominal,
        "alternative": alternative,
        "expected_n": nominal["expected_n"],
        "expected_n_at_nominal": nominal["expected_n"],
        "expected_n_at_alternative": alternative["expected_n"],
        "type_i_error": nominal["reject_probability"],
        "power_at_alternative": alternative["reject_probability"],
        "type_ii_error": alternative["accept_probability"],
        "probability_normalization_max_error": max(
            nominal["probability_normalization_error"],
            alternative["probability_normalization_error"],
        ),
    }


def run() -> dict[str, Any]:
    """运行问题一全部数值计算并返回机器可读结果。"""
    _validate_probability("nominal defect rate", Q1_P0)
    _validate_error_rate("rejection type-I error", Q1_REJECT_ALPHA)
    _validate_error_rate("acceptance type-II error limit", Q1_ACCEPT_ALPHA)
    if not Q1_P0 + Q1_ALTERNATIVE_DELTA <= 1:
        raise ValueError("registered alternative rate exceeds one")

    operational_rejection = _find_rejection_scheme(
        Q1_ALTERNATIVE_DELTA,
        Q1_TYPE_II_ERROR,
    )
    statement_only_rejection = _find_statement_only_rejection_scheme()
    operational_rejection["case_id"] = "case95_registered_power_constrained"
    operational_rejection["statement_only_minimum"] = statement_only_rejection
    operational_rejection["design_constants_are_not_problem_facts"] = bool(
        Q1_ALTERNATIVE_DELTA_IS_DESIGN_CONSTANT
    )
    operational_rejection["alternative_rate_basis"] = Q1_ALTERNATIVE_RATE_BASIS

    acceptance = _find_acceptance_scheme()
    acceptance["case_id"] = "case90_statement_confidence_condition"

    oc_curve = _oc_curve(operational_rejection, acceptance)
    sensitivity = _sensitivity_grid()
    sprt = likelihood_ratio_random_walk(
        operational_rejection["n"],
        Q1_P0,
        operational_rejection["alternative_rate"],
        Q1_REJECT_ALPHA,
        Q1_TYPE_II_ERROR,
    )

    sprt_constraint_residual = max(
        0.0,
        sprt["type_i_error"] - Q1_REJECT_ALPHA,
        1 - Q1_TYPE_II_ERROR - sprt["power_at_alternative"],
    )
    sprt_resource_residual = max(
        0.0,
        sprt["expected_n_at_nominal"] - sprt["truncation_n"],
        sprt["expected_n_at_alternative"] - sprt["truncation_n"],
    )
    sprt["constraint_residual"] = sprt_constraint_residual
    sprt["resource_residual"] = sprt_resource_residual
    sprt["exact_tail_constraints_pass"] = (
        sprt_constraint_residual <= Q1_EXACT_ENUMERATION_TOL
    )
    sprt["both_expected_n_no_larger_than_fixed"] = (
        sprt_resource_residual <= Q1_EXACT_ENUMERATION_TOL
    )
    sprt["selected"] = bool(
        sprt["exact_tail_constraints_pass"]
        and sprt["both_expected_n_no_larger_than_fixed"]
    )
    sprt["selected_method"] = (
        "finite_sprt" if sprt["selected"] else "fixed_sample"
    )
    sprt["fixed_sample_expected_n"] = float(sprt["truncation_n"])

    case95_residual = max(
        0.0,
        operational_rejection["reject_tail"] - Q1_REJECT_ALPHA,
        1
        - Q1_TYPE_II_ERROR
        - operational_rejection["power_at_alternative"],
    )
    case90_residual = max(
        0.0,
        Q1_ACCEPT_CONFIDENCE - acceptance["accept_tail"],
    )
    nominal_mass_error = abs(
        math.fsum(
            exact_integer_enumeration(
                operational_rejection["n"],
                Q1_P0,
            )
        )
        - 1
    )
    alternative_mass_error = abs(
        math.fsum(
            exact_integer_enumeration(
                operational_rejection["n"],
                operational_rejection["alternative_rate"],
            )
        )
        - 1
    )

    checks = {
        "case95_exact_constraints_pass": (
            case95_residual <= Q1_EXACT_ENUMERATION_TOL
        ),
        "case90_exact_constraint_pass": (
            case90_residual <= Q1_EXACT_ENUMERATION_TOL
        ),
        "case95_independent_sum_crosscheck_pass": (
            operational_rejection["independent_sum_max_abs_diff"]
            <= Q1_EXACT_ENUMERATION_TOL
        ),
        "statement_only_sum_crosscheck_pass": (
            statement_only_rejection["independent_sum_abs_diff"]
            <= Q1_EXACT_ENUMERATION_TOL
        ),
        "acceptance_sum_crosscheck_pass": (
            acceptance["independent_sum_abs_diff"]
            <= Q1_EXACT_ENUMERATION_TOL
        ),
        "binomial_mass_normalization_pass": (
            max(nominal_mass_error, alternative_mass_error)
            <= Q1_EXACT_ENUMERATION_TOL
        ),
        "oc_monotonicity_pass": bool(
            oc_curve["reject_probability_monotone_nondecreasing"]
            and oc_curve["accept_probability_monotone_nonincreasing"]
        ),
        "sensitivity_monotonicity_pass": bool(
            sensitivity["sample_size_non_decreasing_with_delta"]
            and sensitivity[
                "sample_size_non_increasing_with_type_ii_error"
            ]
        ),
        "sprt_probability_normalization_pass": (
            sprt["probability_normalization_max_error"]
            <= Q1_EXACT_ENUMERATION_TOL
        ),
    }
    failed_checks = [name for name, passed in checks.items() if not passed]

    return {
        "question": "Q1",
        "method": {
            "distribution": "binomial",
            "primary_probability_engine": "scipy.stats.binom",
            "independent_integer_engine": "exact_integer_enumeration",
            "sequential_engine": "likelihood_ratio_random_walk",
            "search": "ascending integer n with integer critical-value enumeration",
            "search_upper_bound_assumed": False,
            "sequential_scheme_is_finite": True,
        },
        "case95": operational_rejection,
        "case90": acceptance,
        "oc_curve": oc_curve,
        "sensitivity": sensitivity,
        "sprt": sprt,
        "validation": {
            "numeric_tolerance": Q1_EXACT_ENUMERATION_TOL,
            "case95_constraint_residual": case95_residual,
            "case90_constraint_residual": case90_residual,
            "nominal_mass_normalization_error": nominal_mass_error,
            "alternative_mass_normalization_error": alternative_mass_error,
            "checks": checks,
            "failed_checks": failed_checks,
            "all_required_checks_passed": not failed_checks,
        },
        "claim_boundary": (
            "case95 is the minimum only under the separately registered "
            "alternative-rate and type-II-error design constants; case90 "
            "follows the statement-only acceptance-confidence rule."
        ),
    }


if __name__ == "__main__":
    run()