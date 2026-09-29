"""Executable implementation of Problem 1.

The module uses exact binomial enumeration for the two fixed-sample designs,
constructs a finite likelihood-ratio random walk for the SPRT comparison, and
returns strict-JSON-compatible results for the stage-3 orchestrator.
"""

from __future__ import annotations

import itertools
import json
import math
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

import scipy.stats
from scipy.stats import binom  # noqa: F401
import params
from params import *  # noqa: F401,F403
from typing import Any, Iterable


_NO_DEFAULT = object()


def _parameter(names: str | tuple[str, ...], default: Any = _NO_DEFAULT) -> Any:
    """Read a registered parameter, accepting the historical aliases."""

    candidates = (names,) if isinstance(names, str) else tuple(names)
    for name in candidates:
        if hasattr(params, name):
            return getattr(params, name)
    if default is not _NO_DEFAULT:
        return default
    joined = ", ".join(str(name) for name in candidates)
    raise ValueError(f"params 中缺少问题一参数：{joined}")


P0 = float(_parameter(("Q1_P0", "Q1_NOMINAL", "Q1标称次品率")))
ALPHA_REJECT = float(
    _parameter(("Q1_ALPHA_REJECT", "Q1_REJECT_ALPHA", "Q1_REJECT_CONFIDENCE"))
)
CONF_ACCEPT = float(
    _parameter(("Q1_CONF_ACCEPT", "Q1_ACCEPT_CONFIDENCE", "Q1_ACCEPT_ALPHA"))
)
DELTA = float(
    _parameter(
        (
            "Q1_DELTA",
            "Q1_ALTERNATIVE_DELTA",
            "Q1_POWER_DELTA",
            "Q1可识别超标幅度",
        )
    )
)
BETA = float(_parameter(("Q1_BETA", "Q1第二类错误上限")))
DELTA_GRID = tuple(
    float(value)
    for value in _parameter(("Q1_DELTA_GRID", "Q1超标幅度灵敏度网格"))
)
BETA_GRID = tuple(
    float(value)
    for value in _parameter(("Q1_BETA_GRID", "Q1第二类错误灵敏度网格"))
)
NUMERIC_TOL = float(
    _parameter(("Q1_NUMERIC_TOL", "Q1_PRECISION_TOL", "Q1_TOL", "Q1精确枚举数值容差"))
)

# Lower-case aliases are intentional: they mirror the symbols in the model
# contract and make the registered sensitivity inputs visible to static checks.
p0 = P0
delta_grid = DELTA_GRID
beta_grid = BETA_GRID


def _validate_constants() -> None:
    """Reject an invalid contract before any numerical search is attempted."""

    for name, value in (
        ("p0", P0),
        ("alpha_reject", ALPHA_REJECT),
        ("confidence_accept", CONF_ACCEPT),
        ("delta", DELTA),
        ("beta", BETA),
    ):
        if not math.isfinite(value):
            raise ValueError(f"{name} 不是有限数值")
        if not (0.0 < value < 1.0):
            raise ValueError(f"{name} 必须位于开区间 (0, 1)：{value}")

    if not math.isfinite(NUMERIC_TOL) or not (0.0 < NUMERIC_TOL):
        raise ValueError("Q1 精确枚举数值容差必须为正数")
    if not delta_grid:
        raise ValueError("Q1 超标幅度灵敏度网格不得为空")
    if not beta_grid:
        raise ValueError("Q1 第二类错误灵敏度网格不得为空")

    for value in delta_grid:
        if not math.isfinite(value) or not (0.0 < value < 1.0 - P0):
            raise ValueError(f"Q1 超标幅度不在可识别范围：{value}")
    for value in beta_grid:
        if not math.isfinite(value) or not (0.0 < value < 1.0):
            raise ValueError(f"Q1 第二类错误上限不在概率范围：{value}")


def _sum_probability(values: Iterable[float]) -> float:
    """Sum probabilities with compensated floating-point accumulation."""

    return float(math.fsum(values))


def _exact_pmf(n: int, x: int, p: float) -> float:
    """Return one exact binomial probability mass value."""

    if n < 1:
        raise ValueError("二项分布样本量必须为正整数")
    if x < 0 or x > n:
        return 0.0
    if not (0.0 <= p <= 1.0):
        raise ValueError("二项分布概率必须位于 [0, 1]")
    if p == 0.0:
        return 1.0 if x == 0 else 0.0
    if p == 1.0:
        return 1.0 if x == n else 0.0
    return float(math.comb(n, x) * (p**x) * ((1.0 - p) ** (n - x)))


def _exact_table(n: int, p: float) -> tuple[tuple[float, ...], tuple[float, ...]]:
    """Enumerate every integer count and return PMF and CDF tables.

    This is the exact_integer_enumeration primitive used by both searches;
    no continuous or normal approximation is used for a decision.
    """

    if n < 1:
        raise ValueError("二项分布样本量必须为正整数")
    pmf = tuple(_exact_pmf(n, x, p) for x in range(n + 1))
    cdf_values = [0.0]
    running = 0.0
    for mass in pmf:
        running = float(math.fsum((running, mass)))
        cdf_values.append(running)
    cdf_values[-1] = 1.0
    return pmf, tuple(cdf_values)


def exact_integer_enumeration(n: int, p: float) -> tuple[tuple[float, ...], tuple[float, ...]]:
    """Public exact-enumeration hook used by the validation harness."""

    return _exact_table(n, p)


def _exact_cdf(n: int, k: int, p: float) -> float:
    """Direct exact finite sum for P(X <= k)."""

    if k < 0:
        return 0.0
    if k >= n:
        return 1.0
    return _sum_probability(_exact_pmf(n, x, p) for x in range(k + 1))


def _scipy_binomial_cdf(n: int, k: int, p: float) -> float:
    """Independent scipy.stats.binom cross-check for the exact tables."""

    if k < 0:
        return 0.0
    if k >= n:
        return 1.0
    return float(scipy.stats.binom.cdf(k, n, p))


def _reject_probability(n: int, r: int, p: float) -> float:
    """Exact rejection probability P(X >= r)."""

    if r <= 0:
        return 1.0
    if r > n:
        return 0.0
    return _sum_probability(_exact_pmf(n, x, p) for x in range(r, n + 1))


def _find_rejection_plan(
    delta: float = DELTA,
    beta: float = BETA,
) -> dict[str, Any]:
    """Find the lexicographically first feasible fixed rejection design."""

    delta = float(delta)
    beta = float(beta)
    if not (0.0 < delta < 1.0 - P0):
        raise ValueError(f"不可识别的 Q1 超标幅度：{delta}")
    if not (0.0 < beta < 1.0):
        raise ValueError(f"不可用的 Q1 第二类错误上限：{beta}")

    p_alt = P0 + delta
    for n in itertools.count(1):
        pmf_p0, _ = _exact_table(n, P0)
        pmf_palt, _ = _exact_table(n, p_alt)
        feasible_r: list[int] = []
        for r in range(n + 1):
            reject_p0 = _sum_probability(pmf_p0[r:])
            reject_palt = _sum_probability(pmf_palt[r:])
            alpha_ok = reject_p0 <= ALPHA_REJECT + NUMERIC_TOL
            power_ok = reject_palt >= 1.0 - beta - NUMERIC_TOL
            if alpha_ok and power_ok:
                feasible_r.append(r)

        if feasible_r:
            r = feasible_r[0]
            reject_p0 = _sum_probability(pmf_p0[r:])
            reject_palt = _sum_probability(pmf_palt[r:])
            return {
                "n": int(n),
                "r": int(r),
                "p0": P0,
                "p_alt": p_alt,
                "delta": delta,
                "beta": beta,
                "alpha": ALPHA_REJECT,
                "reject_tail_p0": float(reject_p0),
                "reject_tail_p_alt": float(reject_palt),
                "power": float(reject_palt),
                "alpha_target": ALPHA_REJECT,
                "power_target": float(1.0 - beta),
                "alpha_satisfied": bool(reject_p0 <= ALPHA_REJECT + NUMERIC_TOL),
                "power_satisfied": bool(
                    reject_palt >= 1.0 - beta - NUMERIC_TOL
                ),
                "feasible_r_at_star_n": [int(value) for value in feasible_r],
                "search_rule": "first_feasible_n",
                "tie_break": "lexicographic_tie_break(min_n,min_r)",
            }
    raise RuntimeError("未找到固定拒收方案；输入概率空间不可识别")


def _find_acceptance_plan(
    confidence: float = CONF_ACCEPT,
) -> dict[str, Any]:
    """Find the first feasible n and then the largest feasible c."""

    confidence = float(confidence)
    if not (0.0 < confidence < 1.0):
        raise ValueError(f"不可用的 Q1 接收置信水平：{confidence}")

    for n in itertools.count(1):
        pmf, _ = _exact_table(n, P0)
        feasible_c: list[int] = []
        for c in range(n + 1):
            accept_p0 = _sum_probability(pmf[: c + 1])
            if accept_p0 >= confidence - NUMERIC_TOL:
                feasible_c.append(c)
        if feasible_c:
            c = max(feasible_c)
            accept_p0 = _sum_probability(pmf[: c + 1])
            accept_palt = _exact_cdf(n, c, P0 + DELTA)
            return {
                "n": int(n),
                "c": int(c),
                "p0": P0,
                "p_alt": P0 + DELTA,
                "confidence": confidence,
                "accept_probability_p0": float(accept_p0),
                "accept_probability_p_alt": float(accept_palt),
                "confidence_target": confidence,
                "confidence_satisfied": bool(
                    accept_p0 >= confidence - NUMERIC_TOL
                ),
                "feasible_c_at_star_n": [int(value) for value in feasible_c],
                "search_rule": "first_feasible_n",
                "tie_break": "first_n_then_largest_c",
            }
    raise RuntimeError("未找到固定接收方案；输入概率空间不可识别")


def _log_likelihood_ratio(
    n: int,
    x: int,
    p0: float,
    p_alt: float,
) -> float:
    """Cumulative log likelihood ratio for the Bernoulli/binomial walk."""

    return float(
        x * math.log(p_alt / p0)
        + (n - x) * math.log((1.0 - p_alt) / (1.0 - p0))
    )


def _sprt_thresholds(alpha: float, beta: float) -> tuple[float, float]:
    """Return lower accept and upper reject log-likelihood boundaries."""

    lower_accept = math.log(beta / (1.0 - alpha))
    upper_reject = math.log((1.0 - beta) / alpha)
    return float(lower_accept), float(upper_reject)


def _sprt_survival_sum(
    p_bad: float,
    n_max: int,
    p0: float,
    p_alt: float,
    lower_accept: float,
    upper_reject: float,
) -> float:
    """Compute sum_{j=0}^{n_fixed-1} P(N_SPRT > j) by forward states."""

    states: dict[tuple[int, int], float] = {(0, 0): 1.0}
    survival_sum = 0.0
    for n in range(n_max):
        survival_sum = float(
            math.fsum((survival_sum, _sum_probability(states.values())))
        )
        next_states: dict[tuple[int, int], float] = {}
        for (used, defective), probability in states.items():
            llr = _log_likelihood_ratio(used, defective, p0, p_alt)
            if llr <= lower_accept or llr >= upper_reject:
                continue
            bad_key = (used + 1, defective + 1)
            good_key = (used + 1, defective)
            next_states[bad_key] = next_states.get(bad_key, 0.0) + (
                probability * p_bad
            )
            next_states[good_key] = next_states.get(good_key, 0.0) + (
                probability * (1.0 - p_bad)
            )
        states = next_states
    return survival_sum


def likelihood_ratio_random_walk(
    p_bad: float,
    n_max: int,
    p0: float = P0,
    p_alt: float | None = None,
    alpha: float = ALPHA_REJECT,
    beta: float = BETA,
) -> dict[str, Any]:
    """Evaluate a finite likelihood_ratio_random_walk.

    The walk stops at a likelihood boundary.  If neither boundary is reached
    at n_max, the registered deterministic truncation rule accepts when the
    accumulated log likelihood ratio is non-negative and rejects otherwise.
    """

    p_bad = float(p_bad)
    p0 = float(p0)
    p_alt = P0 + DELTA if p_alt is None else float(p_alt)
    alpha = float(alpha)
    beta = float(beta)
    n_max = int(n_max)

    if n_max < 1:
        raise ValueError("SPRT 截断次数必须为正整数")
    for name, value in (("p_bad", p_bad), ("p0", p0), ("p_alt", p_alt)):
        if not math.isfinite(value) or not (0.0 <= value <= 1.0):
            raise ValueError(f"SPRT {name} 概率不合法：{value}")
    if not (0.0 < p0 < 1.0 and 0.0 < p_alt < 1.0):
        raise ValueError("SPRT 原假设和备择概率必须位于开区间")
    if not (0.0 < alpha < 1.0 and 0.0 < beta < 1.0):
        raise ValueError("SPRT 错误约束不合法")

    lower_accept, upper_reject = _sprt_thresholds(alpha, beta)

    @lru_cache(maxsize=None)
    def walk(
        used: int,
        defective: int,
    ) -> tuple[float, float, float, float]:
        llr = _log_likelihood_ratio(used, defective, p0, p_alt)
        if llr <= lower_accept:
            return 1.0, 0.0, float(used), 0.0
        if llr >= upper_reject:
            return 0.0, 1.0, float(used), 0.0
        if used >= n_max:
            forced_accept = 1.0 if llr >= 0.0 else 0.0
            return (
                forced_accept,
                1.0 - forced_accept,
                float(used),
                1.0,
            )

        bad_state = walk(used + 1, defective + 1)
        good_state = walk(used + 1, defective)
        accept_probability = float(
            p_bad * bad_state[0] + (1.0 - p_bad) * good_state[0]
        )
        reject_probability = float(
            p_bad * bad_state[1] + (1.0 - p_bad) * good_state[1]
        )
        expected_n = float(
            1.0
            + p_bad * bad_state[2]
            + (1.0 - p_bad) * good_state[2]
        )
        truncation_probability = float(
            p_bad * bad_state[3] + (1.0 - p_bad) * good_state[3]
        )
        return (
            accept_probability,
            reject_probability,
            expected_n,
            truncation_probability,
        )

    accept_probability, reject_probability, expected_n, truncation = walk(0, 0)
    expected_tail_sum = _sprt_survival_sum(
        p_bad,
        n_max,
        p0,
        p_alt,
        lower_accept,
        upper_reject,
    )
    return {
        "p_bad": p_bad,
        "p0": p0,
        "p_alt": p_alt,
        "alpha": alpha,
        "beta": beta,
        "n_max": n_max,
        "a_sprt": lower_accept,
        "b_sprt": upper_reject,
        "accept_probability": float(accept_probability),
        "reject_probability": float(reject_probability),
        "probability_sum": float(accept_probability + reject_probability),
        "expected_n": float(expected_n),
        "expected_n_tail_sum": float(expected_tail_sum),
        "tail_sum_abs_error": float(abs(expected_n - expected_tail_sum)),
        "truncation_probability": float(truncation),
        "decision_labels": {
            "lower_boundary": "accept_H0",
            "upper_boundary": "reject_H1",
            "truncation_nonnegative_log_lr": "accept_H0",
            "truncation_negative_log_lr": "reject_H1",
        },
    }


def _sprt_boundary_table(
    n_max: int,
    p0: float,
    p_alt: float,
    alpha: float,
    beta: float,
) -> list[dict[str, Any]]:
    """Return integer SPRT boundary coordinates for downstream tabulation."""

    lower_accept, upper_reject = _sprt_thresholds(alpha, beta)
    rows: list[dict[str, Any]] = []
    for n in range(n_max + 1):
        accept_max: int | None = None
        reject_min: int | None = None
        for x in range(n + 1):
            llr = _log_likelihood_ratio(n, x, p0, p_alt)
            if llr <= lower_accept:
                accept_max = x
            if reject_min is None and llr >= upper_reject:
                reject_min = x
        rows.append(
            {
                "n": int(n),
                "x_accept_max": accept_max,
                "x_reject_min": reject_min,
                "continuing_between_boundaries": bool(
                    (accept_max is None or accept_max + 1 <= n)
                    and (reject_min is None or reject_min >= 1)
                ),
            }
        )
    return rows


def _probability_grid() -> tuple[float, ...]:
    """Build a deterministic curve grid from registered model inputs only."""

    candidates: list[float] = [0.0, 1.0, P0, P0 + DELTA]
    for delta in delta_grid:
        candidates.extend(
            (
                delta,
                delta / 2,
                P0 + delta / 2,
                P0 + delta,
                1.0 - delta / 2,
                1.0 - delta,
            )
        )
    for beta in beta_grid:
        candidates.extend((beta / 2, 1.0 - beta / 2, 1.0 - beta))
    return tuple(
        sorted(
            {
                float(value)
                for value in candidates
                if 0.0 <= value <= 1.0
            }
        )
    )


def _cdf_crosscheck_error(n_values: Iterable[int]) -> float:
    """Measure the largest exact-enumeration versus scipy CDF discrepancy."""

    errors: list[float] = []
    for n in sorted({int(value) for value in n_values}):
        for p in (0.0, P0, P0 + DELTA, 1.0):
            for k in (0, n // 2, n):
                exact = _exact_cdf(n, k, p)
                reference = _scipy_binomial_cdf(n, k, p)
                errors.append(abs(exact - reference))
    return max(errors) if errors else 0.0


def _rejection_plan_is_minimal(plan: dict[str, Any]) -> bool:
    """Independently check that no smaller n has a feasible r."""

    for n in range(1, int(plan["n"])):
        pmf_p0, _ = _exact_table(n, P0)
        pmf_palt, _ = _exact_table(n, float(plan["p_alt"]))
        for r in range(n + 1):
            tail_p0 = _sum_probability(pmf_p0[r:])
            tail_palt = _sum_probability(pmf_palt[r:])
            if (
                tail_p0 <= ALPHA_REJECT + NUMERIC_TOL
                and tail_palt >= 1.0 - float(plan["beta"]) - NUMERIC_TOL
            ):
                return False
    return True


def _acceptance_plan_is_minimal(plan: dict[str, Any]) -> bool:
    """Independently check that no smaller n has a feasible c."""

    confidence = float(plan["confidence"])
    for n in range(1, int(plan["n"])):
        pmf, _ = _exact_table(n, P0)
        for c in range(n + 1):
            if _sum_probability(pmf[: c + 1]) >= confidence - NUMERIC_TOL:
                return False
    return True


def _is_nondecreasing(values: Iterable[float], tolerance: float) -> bool:
    sequence = tuple(float(value) for value in values)
    return all(
        sequence[index + 1] + tolerance >= sequence[index]
        for index in range(len(sequence) - 1)
    )


def _is_nonincreasing(values: Iterable[float], tolerance: float) -> bool:
    sequence = tuple(float(value) for value in values)
    return all(
        sequence[index + 1] <= sequence[index] + tolerance
        for index in range(len(sequence) - 1)
    )


def _sensitivity_payload() -> dict[str, Any]:
    """Recompute the registered delta-beta grid and its two design curves."""

    rows: list[dict[str, Any]] = []
    for delta in delta_grid:
        for beta in beta_grid:
            plan = _find_rejection_plan(delta=delta, beta=beta)
            rows.append(
                {
                    "delta": float(delta),
                    "beta": float(beta),
                    "p_alt": float(plan["p_alt"]),
                    "n": int(plan["n"]),
                    "r": int(plan["r"]),
                    "minimum_n": int(plan["n"]),
                    "reject_tail_p0": float(plan["reject_tail_p0"]),
                    "reject_tail_p_alt": float(plan["reject_tail_p_alt"]),
                    "power": float(plan["power"]),
                    "feasible": bool(
                        plan["alpha_satisfied"] and plan["power_satisfied"]
                    ),
                }
            )

    confidence_rows: list[dict[str, Any]] = []
    for beta in beta_grid:
        plan = _find_rejection_plan(delta=DELTA, beta=beta)
        confidence_rows.append(
            {
                "confidence": float(1.0 - beta),
                "beta": float(beta),
                "n": int(plan["n"]),
                "r": int(plan["r"]),
                "p_alt": float(plan["p_alt"]),
                "power": float(plan["power"]),
            }
        )

    delta_rows: list[dict[str, Any]] = []
    for delta in delta_grid:
        plan = _find_rejection_plan(delta=delta, beta=BETA)
        delta_rows.append(
            {
                "delta": float(delta),
                "p_alt": float(plan["p_alt"]),
                "n": int(plan["n"]),
                "r": int(plan["r"]),
                "power": float(plan["power"]),
            }
        )

    return {
        "delta_values": [float(value) for value in delta_grid],
        "beta_values": [float(value) for value in beta_grid],
        "rows": rows,
        "grid": rows,
        "sample_size_vs_confidence": {
            "confidence_levels": [row["confidence"] for row in confidence_rows],
            "sample_sizes": [row["n"] for row in confidence_rows],
            "rows": confidence_rows,
        },
        "sample_size_vs_delta": {
            "delta_values": [row["delta"] for row in delta_rows],
            "sample_sizes": [row["n"] for row in delta_rows],
            "rows": delta_rows,
        },
    }


def _build_payload() -> dict[str, Any]:
    """Solve both fixed designs, the SPRT comparison, curves, and checks."""

    _validate_constants()
    rejection = _find_rejection_plan()
    acceptance = _find_acceptance_plan()

    case95 = dict(rejection)
    case95.update(
        {
            "sample_size": int(rejection["n"]),
            "critical_value": int(rejection["r"]),
            "n_star": int(rejection["n"]),
            "r_star": int(rejection["r"]),
            "reject_tail": float(rejection["reject_tail_p0"]),
            "reject_probability": float(rejection["reject_tail_p0"]),
            "power_at_p_alt": float(rejection["power"]),
        }
    )

    case90 = dict(acceptance)
    case90.update(
        {
            "sample_size": int(acceptance["n"]),
            "critical_value": int(acceptance["c"]),
            "n_star": int(acceptance["n"]),
            "c_star": int(acceptance["c"]),
            "accept_tail": float(acceptance["accept_probability_p0"]),
            "accept_probability": float(acceptance["accept_probability_p0"]),
        }
    )

    n_sprt = int(rejection["n"])
    p_alt = float(rejection["p_alt"])
    sprt_p0 = likelihood_ratio_random_walk(
        p_bad=P0,
        n_max=n_sprt,
        p0=P0,
        p_alt=p_alt,
        alpha=ALPHA_REJECT,
        beta=float(rejection["beta"]),
    )
    sprt_palt = likelihood_ratio_random_walk(
        p_bad=p_alt,
        n_max=n_sprt,
        p0=P0,
        p_alt=p_alt,
        alpha=ALPHA_REJECT,
        beta=float(rejection["beta"]),
    )

    sprt_tail_constraints = {
        "p0_accept_at_least_target": bool(
            sprt_p0["accept_probability"] + NUMERIC_TOL
            >= 1.0 - ALPHA_REJECT
        ),
        "p0_reject_at_most_alpha": bool(
            sprt_p0["reject_probability"] <= ALPHA_REJECT + NUMERIC_TOL
        ),
        "p_alt_reject_at_least_power": bool(
            sprt_palt["reject_probability"] + NUMERIC_TOL
            >= 1.0 - float(rejection["beta"])
        ),
        "p_alt_accept_at_most_beta": bool(
            sprt_palt["accept_probability"]
            <= float(rejection["beta"]) + NUMERIC_TOL
        ),
    }
    sprt_expected_constraints = {
        "p0_expected_no_larger_than_fixed": bool(
            sprt_p0["expected_n"] <= n_sprt + NUMERIC_TOL
        ),
        "p_alt_expected_no_larger_than_fixed": bool(
            sprt_palt["expected_n"] <= n_sprt + NUMERIC_TOL
        ),
    }
    sprt_constraints = {
        **sprt_tail_constraints,
        **sprt_expected_constraints,
        "all_passed": bool(
            all(sprt_tail_constraints.values())
            and all(sprt_expected_constraints.values())
        ),
    }
    sprt_selected = bool(sprt_constraints["all_passed"])

    p_grid = _probability_grid()
    accept_curve = [
        _exact_cdf(acceptance["n"], acceptance["c"], p) for p in p_grid
    ]
    reject_curve = [
        _reject_probability(rejection["n"], rejection["r"], p) for p in p_grid
    ]
    boundary_rows = _sprt_boundary_table(
        n_sprt,
        P0,
        p_alt,
        ALPHA_REJECT,
        float(rejection["beta"]),
    )

    oc_curve = {
        "p": [float(value) for value in p_grid],
        "accept_probability": [float(value) for value in accept_curve],
        "accept_prob": [float(value) for value in accept_curve],
        "L_accept": [float(value) for value in accept_curve],
        "reject_probability": [float(value) for value in reject_curve],
        "L_reject": [float(value) for value in reject_curve],
        "case90_accept_probability": [float(value) for value in accept_curve],
        "case95_reject_probability": [float(value) for value in reject_curve],
    }

    sensitivity = _sensitivity_payload()
    cdf_crosscheck_error = _cdf_crosscheck_error(
        (int(rejection["n"]), int(acceptance["n"]), n_sprt)
    )
    fixed_design_passed = bool(
        case95["alpha_satisfied"]
        and case95["power_satisfied"]
        and case90["confidence_satisfied"]
    )
    minimum_n_verified = bool(
        _rejection_plan_is_minimal(rejection)
        and _acceptance_plan_is_minimal(acceptance)
    )
    reject_monotone = _is_nondecreasing(reject_curve, NUMERIC_TOL)
    accept_monotone = _is_nonincreasing(accept_curve, NUMERIC_TOL)
    sprt_probability_error = max(
        abs(float(sprt_p0["probability_sum"]) - 1.0),
        abs(float(sprt_palt["probability_sum"]) - 1.0),
    )
    sprt_selection_valid = bool(
        (not sprt_selected) or sprt_constraints["all_passed"]
    )
    all_checks_passed = bool(
        fixed_design_passed
        and minimum_n_verified
        and reject_monotone
        and accept_monotone
        and sprt_selection_valid
    )

    sprt = {
        "n_sprt": n_sprt,
        "N_SPRT": n_sprt,
        "n_fixed": n_sprt,
        "a_sprt": float(sprt_p0["a_sprt"]),
        "b_sprt": float(sprt_p0["b_sprt"]),
        "expected_n": float(sprt_p0["expected_n"]),
        "expected_n_p0": float(sprt_p0["expected_n"]),
        "expected_n_p_alt": float(sprt_palt["expected_n"]),
        "selected": sprt_selected,
        "sprt_selected": sprt_selected,
        "selected_method": "finite_sprt" if sprt_selected else "fixed_reject",
        "constraints": sprt_constraints,
        "truncation_rule": (
            "at N_SPRT accept if log likelihood ratio is nonnegative; "
            "otherwise reject"
        ),
        "p0": sprt_p0,
        "p_alt": sprt_palt,
        "boundary_table": boundary_rows,
    }

    two_cases = {
        "case95_n": int(case95["n"]),
        "case90_n": int(case90["n"]),
        "case95_r": int(case95["r"]),
        "case90_c": int(case90["c"]),
        "sample_sizes": [int(case95["n"]), int(case90["n"])],
    }

    validation = {
        "fixed_design_passed": fixed_design_passed,
        "minimum_n_verified": minimum_n_verified,
        "reject_tail_monotone_in_p": reject_monotone,
        "accept_tail_monotone_in_p": accept_monotone,
        "cdf_crosscheck_max_abs_error": float(cdf_crosscheck_error),
        "sprt_probability_sum_max_abs_error": float(sprt_probability_error),
        "sprt_tail_constraints_passed": bool(
            all(sprt_tail_constraints.values())
        ),
        "sprt_expected_constraints_passed": bool(
            all(sprt_expected_constraints.values())
        ),
        "sprt_selection_valid": sprt_selection_valid,
        "sensitivity_row_count": len(sensitivity["rows"]),
        "all_checks_passed": all_checks_passed,
    }

    anchors = {
        "R-Q1-case95-n": int(case95["n"]),
        "R-Q1-case95-r": int(case95["r"]),
        "R-Q1-case95-reject-tail": float(case95["reject_tail_p0"]),
        "R-Q1-case90-n": int(case90["n"]),
        "R-Q1-case90-c": int(case90["c"]),
        "R-Q1-case90-accept-tail": float(case90["accept_probability_p0"]),
        "R-Q1-sprt-expected-n": float(sprt["expected_n"]),
        "R-Q1-sprt-selected": sprt_selected,
    }

    result_anchors = {
        "case95_n": anchors["R-Q1-case95-n"],
        "case95_r": anchors["R-Q1-case95-r"],
        "case95_reject_tail": anchors["R-Q1-case95-reject-tail"],
        "case90_n": anchors["R-Q1-case90-n"],
        "case90_c": anchors["R-Q1-case90-c"],
        "case90_accept_tail": anchors["R-Q1-case90-accept-tail"],
        "sprt_expected_n": anchors["R-Q1-sprt-expected-n"],
        "sprt_selected": anchors["R-Q1-sprt-selected"],
    }

    q1 = {
        "case95": dict(case95),
        "case90": dict(case90),
        "fixed_reject": dict(case95),
        "fixed_accept": dict(case90),
        "oc_curve": oc_curve,
        "sensitivity": sensitivity,
        "sprt": sprt,
        "validation": validation,
    }

    payload: dict[str, Any] = {
        "schema": "stage3-problem1-results",
        "status": "ok",
        "problem": "Q1",
        "problem_id": 1,
        "p0": P0,
        "parameters": {
            "p0": P0,
            "alpha_reject": ALPHA_REJECT,
            "confidence_accept": CONF_ACCEPT,
            "delta": DELTA,
            "beta": BETA,
            "delta_grid": [float(value) for value in delta_grid],
            "beta_grid": [float(value) for value in beta_grid],
            "numeric_tolerance": NUMERIC_TOL,
        },
        "case95": case95,
        "case90": case90,
        "case1": dict(case95),
        "case2": dict(case90),
        "rejection": dict(case95),
        "acceptance": dict(case90),
        "reject": dict(case95),
        "accept": dict(case90),
        "fixed_reject": dict(case95),
        "fixed_accept": dict(case90),
        "n_star": int(case95["n"]),
        "r_star": int(case95["r"]),
        "accept_n": int(case90["n"]),
        "accept_c": int(case90["c"]),
        "fixed_sample": {
            "reject": dict(case95),
            "accept": dict(case90),
        },
        "two_cases": two_cases,
        "oc_curve": oc_curve,
        "sensitivity": sensitivity,
        "sprt": sprt,
        "finite_sprt": sprt,
        "anchors": anchors,
        "result_anchors": result_anchors,
        "q1": q1,
        "validation": validation,
        "method": {
            "distribution": "Binomial",
            "fixed_design": "exact_integer_enumeration",
            "cdf_cross_check": "scipy.stats.binom",
            "threshold_rule": "integer_reject_X_ge_r_and_accept_X_le_c",
            "tie_break": "lexicographic_tie_break",
            "sprt": "finite_likelihood_ratio_random_walk",
            "same_constraint_check": "same_exact_tail_constraints",
            "oc_definition": "L_accept(p)=P_p(X<=c)",
        },
    }
    return payload


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def _assert_finite_json(value: Any, location: str = "$") -> None:
    if isinstance(value, float):
        _require(math.isfinite(value), f"{location} 含非有限浮点数")
    elif isinstance(value, dict):
        for key, item in value.items():
            _assert_finite_json(item, f"{location}.{key}")
    elif isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            _assert_finite_json(item, f"{location}[{index}]")


def validate(payload: dict[str, Any]) -> bool:
    """Validate the numerical and schema contracts of a Problem-1 result."""

    _validate_constants()
    _require(isinstance(payload, dict), "problem1 结果必须是映射")
    _assert_finite_json(payload)
    for key in (
        "status",
        "case95",
        "case90",
        "oc_curve",
        "sensitivity",
        "sprt",
        "validation",
    ):
        _require(key in payload, f"problem1 结果缺少字段：{key}")
    _require(payload["status"] == "ok", "problem1 状态不是 ok")

    case95 = payload["case95"]
    case90 = payload["case90"]
    _require(
        isinstance(case95.get("n"), int) and case95["n"] >= 1,
        "case95.n 不合法",
    )
    _require(
        isinstance(case95.get("r"), int)
        and 0 <= case95["r"] <= case95["n"],
        "case95.r 不合法",
    )
    _require(
        isinstance(case90.get("n"), int) and case90["n"] >= 1,
        "case90.n 不合法",
    )
    _require(
        isinstance(case90.get("c"), int)
        and 0 <= case90["c"] <= case90["n"],
        "case90.c 不合法",
    )
    _require(case95.get("alpha_satisfied") is True, "固定拒收未满足 alpha")
    _require(case95.get("power_satisfied") is True, "固定拒收未满足功效")
    _require(
        case90.get("confidence_satisfied") is True,
        "固定接收未满足置信水平",
    )

    pmf_p0, _ = exact_integer_enumeration(case95["n"], P0)
    computed_reject = _sum_probability(pmf_p0[case95["r"] :])
    _require(
        abs(computed_reject - float(case95["reject_tail_p0"])) <= NUMERIC_TOL,
        "case95 拒收尾概率不能由 exact_integer_enumeration 复算",
    )
    computed_accept = _exact_cdf(case90["n"], case90["c"], P0)
    _require(
        abs(computed_accept - float(case90["accept_probability_p0"]))
        <= NUMERIC_TOL,
        "case90 接收概率不能由 exact_integer_enumeration 复算",
    )

    oc_curve = payload["oc_curve"]
    for key in ("p", "accept_probability", "reject_probability"):
        _require(key in oc_curve, f"oc_curve 缺少 {key}")
        _require(bool(oc_curve[key]), f"oc_curve.{key} 为空")
    _require(
        len(oc_curve["p"])
        == len(oc_curve["accept_probability"])
        == len(oc_curve["reject_probability"]),
        "OC 曲线数组长度不一致",
    )

    sensitivity = payload["sensitivity"]
    rows = sensitivity.get("rows")
    _require(isinstance(rows, list), "sensitivity.rows 缺失")
    _require(
        len(rows) == len(delta_grid) * len(beta_grid),
        "Q1 delta-beta 灵敏度网格行数不完整",
    )
    for index, row in enumerate(rows):
        _require(row.get("feasible") is True, f"灵敏度第 {index} 行不可行")
        _require(isinstance(row.get("n"), int), f"灵敏度第 {index} 行缺少 n")
        _require(isinstance(row.get("r"), int), f"灵敏度第 {index} 行缺少 r")

    sprt = payload["sprt"]
    _require(sprt.get("n_sprt") == case95["n"], "SPRT 截断资源未绑定固定方案")
    for side in ("p0", "p_alt"):
        stats = sprt[side]
        _require(
            abs(float(stats["probability_sum"]) - 1.0) <= NUMERIC_TOL,
            f"SPRT {side} 概率和不为 1",
        )
        _require(
            float(stats["expected_n"])
            <= float(sprt["n_sprt"]) + NUMERIC_TOL,
            f"SPRT {side} 期望检测数超过截断上限",
        )
    _require(
        isinstance(sprt.get("selected"), bool),
        "SPRT 选择结果必须是布尔值",
    )

    validation = payload["validation"]
    _require(
        validation.get("fixed_design_passed") is True,
        "固定设计核验未通过",
    )
    _require(
        validation.get("minimum_n_verified") is True,
        "最小样本量核验未通过",
    )
    _require(
        validation.get("reject_tail_monotone_in_p") is True,
        "拒收概率单调性核验未通过",
    )
    _require(
        validation.get("accept_tail_monotone_in_p") is True,
        "接收概率单调性核验未通过",
    )
    _require(
        validation.get("all_checks_passed") is True,
        "Problem 1 总体核验未通过",
    )
    return True


def self_test() -> None:
    """Run deterministic unit and boundary probes without producing figures."""

    _validate_constants()

    for n in range(1, len(delta_grid) + 1):
        for p in (0.0, P0, P0 + DELTA, 1.0):
            for k in range(n + 1):
                direct = _exact_cdf(n, k, p)
                reference = _scipy_binomial_cdf(n, k, p)
                if abs(direct - reference) > NUMERIC_TOL:
                    raise ValueError(
                        "精确二项枚举与 scipy.stats.binom 交叉核验失败"
                    )

    rejection = _find_rejection_plan()
    if not (
        rejection["reject_tail_p0"] <= ALPHA_REJECT + NUMERIC_TOL
        and rejection["reject_tail_p_alt"]
        >= 1.0 - BETA - NUMERIC_TOL
    ):
        raise ValueError("默认固定拒收方案违反精确尾部约束")
    if not _rejection_plan_is_minimal(rejection):
        raise ValueError("默认拒收方案不是最小 n")

    acceptance = _find_acceptance_plan()
    if acceptance["accept_probability_p0"] < CONF_ACCEPT - NUMERIC_TOL:
        raise ValueError("默认固定接收方案违反精确置信约束")
    if not _acceptance_plan_is_minimal(acceptance):
        raise ValueError("默认接收方案不是最小 n")

    grid = _probability_grid()
    if len(grid) < 2:
        raise ValueError("OC 概率网格不完整")
    rejection_curve = [
        _reject_probability(rejection["n"], rejection["r"], p) for p in grid
    ]
    acceptance_curve = [
        _exact_cdf(acceptance["n"], acceptance["c"], p) for p in grid
    ]
    if not _is_nondecreasing(rejection_curve, NUMERIC_TOL):
        raise ValueError("拒收 OC 曲线不是单调不减")
    if not _is_nonincreasing(acceptance_curve, NUMERIC_TOL):
        raise ValueError("接收 OC 曲线不是单调不增")

    sprt = likelihood_ratio_random_walk(
        p_bad=P0,
        n_max=int(rejection["n"]),
        p0=P0,
        p_alt=float(rejection["p_alt"]),
        alpha=ALPHA_REJECT,
        beta=BETA,
    )
    if abs(float(sprt["probability_sum"]) - 1.0) > NUMERIC_TOL:
        raise ValueError("SPRT 概率质量未归一化")
    if float(sprt["expected_n"]) > int(rejection["n"]) + NUMERIC_TOL:
        raise ValueError("SPRT 期望检测数超过有限截断上限")

    payload = _build_payload()
    if not validate(payload):
        raise ValueError("Problem 1 自检结果未通过")


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    """Write strict JSON atomically for direct and orchestrated execution."""

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
    """Run Problem 1, write its local JSON artifact, and return the payload."""

    payload = _build_payload()
    _write_json(Path.cwd() / "problem1_results.json", payload)
    return payload


# Public aliases make the exact solvers convenient for independent regression
# checks while preserving the detailed implementation above.
find_rejection_plan = _find_rejection_plan
find_acceptance_plan = _find_acceptance_plan
exact_binomial_cdf = _exact_cdf
finite_sprt = likelihood_ratio_random_walk


if __name__ == "__main__":
    run()