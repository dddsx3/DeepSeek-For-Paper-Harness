"""问题一：精确二项抽样方案与有限 SPRT 对照。"""

from __future__ import annotations

import math
from collections.abc import Iterable, Sequence

import scipy.stats

import params


_ONE = 1.0


def _normalise(name: str) -> str:
    return "".join(character for character in name.casefold() if character.isalnum())


def _unwrap(value):
    if isinstance(value, dict) and "value" in value:
        return value["value"]
    return value


def _parameter(
    candidates: Sequence[str],
    *,
    include: Iterable[str] = (),
    exclude: Iterable[str] = (),
):
    """从阶段参数注册表读取常量，不在求解脚本中声明业务数值。"""
    wanted = {_normalise(candidate) for candidate in candidates}
    include_words = tuple(_normalise(word) for word in include)
    exclude_words = tuple(_normalise(word) for word in exclude)
    found = {}

    def visit(value):
        if isinstance(value, dict):
            if "name" in value and "value" in value:
                found.setdefault(_normalise(str(value["name"])), value["value"])
            for key, child in value.items():
                found.setdefault(_normalise(str(key)), child)
                visit(child)
        elif isinstance(value, (list, tuple)):
            for child in value:
                visit(child)

    for value in vars(params).values():
        visit(_unwrap(value))

    for candidate in wanted:
        if candidate in found:
            return _unwrap(found[candidate])

    for name, value in found.items():
        if not any(word in name for word in include_words):
            continue
        if any(word in name for word in exclude_words):
            continue
        unwrapped = _unwrap(value)
        if isinstance(unwrapped, (int, float)) or isinstance(unwrapped, (list, tuple)):
            return unwrapped

    joined = ", ".join(candidates)
    raise AttributeError(f"params 中缺少问题一常量：{joined}")


def _load_parameters() -> dict:
    p0 = float(
        _parameter(
            (
                "Q1_NOMINAL_DEFECT_RATE",
                "Q1_NOMINAL_RATE",
                "Q1_NOMINAL",
                "Q1_P0",
                "P0",
                "Q1标称次品率",
                "标称次品率",
            ),
            include=("q1", "nominal", "p0"),
            exclude=("grid", "sensitivity", "sensitivitygrid"),
        )
    )
    alpha = float(
        _parameter(
            (
                "Q1_REJECT_TYPE_I_ERROR",
                "Q1_REJECT_ALPHA",
                "Q1_ALPHA_REJECT",
                "Q1_REJECT_SIGNIFICANCE",
                "Q1_TYPE_I_ERROR",
                "Q1拒收第一类错误上限",
                "拒收第一类错误上限",
            ),
            include=("q1", "reject", "alpha", "error"),
            exclude=("grid", "sensitivity", "confidence"),
        )
    )
    confidence = float(
        _parameter(
            (
                "Q1_ACCEPT_CONFIDENCE",
                "Q1_RECEIVE_CONFIDENCE",
                "Q1_CONFIDENCE_ACCEPT",
                "Q1_ACCEPT_LEVEL",
                "Q1接收置信水平",
                "接收置信水平",
            ),
            include=("q1", "accept", "confidence", "level"),
            exclude=("grid", "sensitivity", "alpha", "error"),
        )
    )
    delta = float(
        _parameter(
            (
                "Q1_ALTERNATIVE_DELTA",
                "Q1_DELTA_DESIGN",
                "Q1_DESIGN_DELTA",
                "Q1_EXCESS_MARGIN",
                "Q1_DELTA",
                "Q1可识别超标幅度",
                "可识别超标幅度",
            ),
            include=("q1", "delta", "margin"),
            exclude=("grid", "sensitivity"),
        )
    )
    beta = float(
        _parameter(
            (
                "Q1_TYPE_II_ERROR",
                "Q1_SECOND_ERROR",
                "Q1_BETA_DESIGN",
                "Q1_BETA",
                "Q1第二类错误上限",
                "第二类错误上限",
            ),
            include=("q1", "beta", "error"),
            exclude=("grid", "sensitivity"),
        )
    )
    delta_grid = tuple(
        float(value)
        for value in _parameter(
            (
                "Q1_DELTA_GRID",
                "Q1_ALTERNATIVE_DELTA_GRID",
                "Q1_EXCESS_MARGIN_GRID",
                "Q1_DELTA_SENSITIVITY_GRID",
                "Q1超标幅度灵敏度网格",
                "超标幅度灵敏度网格",
            ),
            include=("q1", "delta", "margin", "grid"),
            exclude=("beta",),
        )
    )
    beta_grid = tuple(
        float(value)
        for value in _parameter(
            (
                "Q1_BETA_GRID",
                "Q1_TYPE_II_ERROR_GRID",
                "Q1_SECOND_ERROR_GRID",
                "Q1_BETA_SENSITIVITY_GRID",
                "Q1第二类错误灵敏度网格",
                "第二类错误灵敏度网格",
            ),
            include=("q1", "beta", "error", "grid"),
            exclude=("delta", "margin"),
        )
    )
    tolerance = float(
        _parameter(
            (
                "Q1_NUMERIC_TOL",
                "Q1_NUMERIC_TOLERANCE",
                "Q1_EXACT_ENUMERATION_TOL",
                "Q1_EXACT_ENUMERATION_TOLERANCE",
                "Q1精确枚举数值容差",
                "精确枚举数值容差",
            ),
            include=("q1", "tol"),
            exclude=("grid", "sensitivity"),
        )
    )

    p_alt = p0 + delta
    if not 0.0 < p0 < p_alt < _ONE:
        raise ValueError("问题一必须满足 0 < p0 < p_alt < 1")
    if not 0.0 < alpha < _ONE:
        raise ValueError("拒收第一类错误上限不在概率域内")
    if not 0.0 < confidence < _ONE:
        raise ValueError("接收置信水平不在概率域内")
    if not 0.0 < beta < _ONE:
        raise ValueError("第二类错误上限不在概率域内")
    if tolerance <= 0.0:
        raise ValueError("精确枚举数值容差必须为正")
    if not delta_grid or not beta_grid:
        raise ValueError("问题一灵敏度网格不得为空")
    if any(value <= 0.0 or p0 + value >= _ONE for value in delta_grid):
        raise ValueError("超标幅度灵敏度网格越界")
    if any(value <= 0.0 or value >= _ONE for value in beta_grid):
        raise ValueError("第二类错误灵敏度网格越界")

    return {
        "p0": p0,
        "alpha": alpha,
        "confidence": confidence,
        "delta": delta,
        "beta": beta,
        "p_alt": p_alt,
        "delta_grid": delta_grid,
        "beta_grid": beta_grid,
        "tolerance": tolerance,
    }


def _exact_integer_binomial_cdf(n: int, k: int, p: float) -> float:
    """有限整数枚举二项累积概率，不使用连续近似。"""
    if n < 1:
        raise ValueError("二项样本量必须为正整数")
    if k < 0:
        return 0.0
    if k >= n:
        return _ONE
    if p == 0.0:
        return _ONE
    if p == _ONE:
        return 0.0

    failure_probability = _ONE - p
    odds = p / failure_probability
    mass = failure_probability**n
    terms = [mass]
    for defect_count in range(k):
        mass *= (n - defect_count) / (defect_count + 1) * odds
        terms.append(mass)
    return math.fsum(terms)


def _checked_binomial_cdf(
    n: int, k: int, p: float, tolerance: float
) -> tuple[float, float]:
    exact = _exact_integer_binomial_cdf(n, k, p)
    reference = float(scipy.stats.binom.cdf(k, n, p))
    difference = abs(exact - reference)
    if difference > tolerance:
        raise RuntimeError("二项累积概率的有限枚举值与 scipy.stats.binom 不一致")
    return exact, difference


def _checked_binomial_sf(
    n: int, k: int, p: float, tolerance: float
) -> tuple[float, float]:
    if k <= 0:
        exact = _ONE
        reference = _ONE
    elif k > n:
        exact = 0.0
        reference = 0.0
    else:
        exact = _ONE - _exact_integer_binomial_cdf(n, k - 1, p)
        reference = float(scipy.stats.binom.sf(k - 1, n, p))
    difference = abs(exact - reference)
    if difference > tolerance:
        raise RuntimeError("二项上尾概率的有限枚举值与 scipy.stats.binom 不一致")
    return exact, difference


def find_minimum_rejection_plan(
    p0: float | None = None,
    alpha: float | None = None,
    beta: float | None = None,
    p_alt: float | None = None,
    tolerance: float | None = None,
) -> dict:
    """逐个 n 穷举全部 r，返回首个同时满足两类错误约束的方案。"""
    if p0 is None or alpha is None or beta is None or tolerance is None:
        registered = _load_parameters()
        p0 = registered["p0"] if p0 is None else p0
        alpha = registered["alpha"] if alpha is None else alpha
        beta = registered["beta"] if beta is None else beta
        p_alt = registered["p_alt"] if p_alt is None else p_alt
        tolerance = registered["tolerance"] if tolerance is None else tolerance

    p_alt = p0 + (p_alt - p0)
    required_power = _ONE - beta
    n = 1
    while True:
        candidates = []
        alpha_feasible_thresholds = []
        for rejection_threshold in range(1, n + 1):
            reject_tail_p0, tail_difference_p0 = _checked_binomial_sf(
                n, rejection_threshold, p0, tolerance
            )
            reject_tail_p_alt, tail_difference_p_alt = _checked_binomial_sf(
                n, rejection_threshold, p_alt, tolerance
            )
            if reject_tail_p0 > alpha + tolerance:
                continue
            alpha_feasible_thresholds.append(rejection_threshold)
            if reject_tail_p_alt + tolerance < required_power:
                continue
            candidates.append(
                {
                    "n": n,
                    "r": rejection_threshold,
                    "reject_tail_p0": reject_tail_p0,
                    "power_p_alt": reject_tail_p_alt,
                    "type2_error_p_alt": _ONE - reject_tail_p_alt,
                    "exact_enum_max_diff": max(
                        tail_difference_p0, tail_difference_p_alt
                    ),
                }
            )

        if candidates:
            selected = min(candidates, key=lambda item: (item["r"], item["n"]))
            selected["all_alpha_feasible_r_at_n"] = alpha_feasible_thresholds
            selected["all_fully_feasible_r_at_n"] = [
                item["r"] for item in candidates
            ]
            selected["tie_break"] = "minimum_n_then_minimum_r"
            selected["exhaustive_threshold_enumeration"] = True
            return selected
        n += 1


def find_minimum_acceptance_plan(
    p0: float | None = None,
    confidence: float | None = None,
    beta: float | None = None,
    p_alt: float | None = None,
    tolerance: float | None = None,
) -> dict:
    """求非退化接收方案；拒绝域必须非空且对高率备择满足功效。"""
    if p0 is None or confidence is None or beta is None or tolerance is None:
        registered = _load_parameters()
        p0 = registered["p0"] if p0 is None else p0
        confidence = (
            registered["confidence"] if confidence is None else confidence
        )
        beta = registered["beta"] if beta is None else beta
        p_alt = registered["p_alt"] if p_alt is None else p_alt
        tolerance = registered["tolerance"] if tolerance is None else tolerance

    p_alt = p0 + (p_alt - p0)
    required_rejection_power = _ONE - beta
    n = 1
    while True:
        candidates = []
        confidence_feasible_thresholds = []
        for acceptance_threshold in range(n):
            accept_probability_p0, acceptance_difference_p0 = _checked_binomial_cdf(
                n, acceptance_threshold, p0, tolerance
            )
            false_accept_p_alt, false_acceptance_difference = _checked_binomial_sf(
                n, acceptance_threshold + 1, p_alt, tolerance
            )
            rejection_power_p_alt = _ONE - false_accept_p_alt
            if accept_probability_p0 + tolerance < confidence:
                continue
            confidence_feasible_thresholds.append(acceptance_threshold)
            if rejection_power_p_alt + tolerance < required_rejection_power:
                continue
            candidates.append(
                {
                    "n": n,
                    "c": acceptance_threshold,
                    "accept_probability_p0": accept_probability_p0,
                    "false_accept_probability_p_alt": false_accept_p_alt,
                    "rejection_power_p_alt": rejection_power_p_alt,
                    "exact_enum_max_diff": max(
                        acceptance_difference_p0,
                        false_acceptance_difference,
                    ),
                }
            )

        if candidates:
            selected = max(candidates, key=lambda item: (item["c"], -item["n"]))
            selected["all_confidence_feasible_c_at_n"] = (
                confidence_feasible_thresholds
            )
            selected["all_fully_feasible_c_at_n"] = [
                item["c"] for item in candidates
            ]
            selected["tie_break"] = "minimum_n_then_maximum_c"
            selected["exhaustive_threshold_enumeration"] = True
            selected["nondegenerate_rejection_region"] = selected["c"] < selected["n"]
            selected["identification_alternative_p_alt"] = p_alt
            selected["required_rejection_power_p_alt"] = required_rejection_power
            if not selected["nondegenerate_rejection_region"]:
                raise RuntimeError("接收方案退化为空拒绝域")
            return selected
        n += 1


def _brute_force_rejection_unit_test(
    p0: float, alpha: float, beta: float, p_alt: float, tolerance: float, upper_n: int
) -> dict:
    feasible = []
    for n in range(1, upper_n + 1):
        for rejection_threshold in range(1, n + 1):
            reject_tail_p0, _ = _checked_binomial_sf(
                n, rejection_threshold, p0, tolerance
            )
            reject_tail_p_alt, _ = _checked_binomial_sf(
                n, rejection_threshold, p_alt, tolerance
            )
            if (
                reject_tail_p0 <= alpha + tolerance
                and reject_tail_p_alt + tolerance >= _ONE - beta
            ):
                feasible.append(
                    {
                        "n": n,
                        "r": rejection_threshold,
                        "reject_tail_p0": reject_tail_p0,
                        "power_p_alt": reject_tail_p_alt,
                        "type2_error_p_alt": _ONE - reject_tail_p_alt,
                        "exact_enum_max_diff": 0.0,
                    }
                )
    if not feasible:
        raise AssertionError("拒收方案暴力枚举没有找到候选")
    return min(feasible, key=lambda item: (item["n"], item["r"]))


def _brute_force_acceptance_unit_test(
    p0: float,
    confidence: float,
    beta: float,
    p_alt: float,
    tolerance: float,
    upper_n: int,
) -> dict:
    feasible = []
    for n in range(1, upper_n + 1):
        for acceptance_threshold in range(n):
            accept_probability_p0, _ = _checked_binomial_cdf(
                n, acceptance_threshold, p0, tolerance
            )
            false_accept_p_alt, _ = _checked_binomial_sf(
                n, acceptance_threshold + 1, p_alt, tolerance
            )
            rejection_power_p_alt = _ONE - false_accept_p_alt
            if (
                accept_probability_p0 + tolerance >= confidence
                and rejection_power_p_alt + tolerance >= _ONE - beta
            ):
                feasible.append(
                    {
                        "n": n,
                        "c": acceptance_threshold,
                        "accept_probability_p0": accept_probability_p0,
                        "false_accept_probability_p_alt": false_accept_p_alt,
                        "rejection_power_p_alt": rejection_power_p_alt,
                        "exact_enum_max_diff": 0.0,
                    }
                )
    if not feasible:
        raise AssertionError("接收方案暴力枚举没有找到候选")
    return min(feasible, key=lambda item: (item["n"], -item["c"]))


def _likelihood_ratio_random_walk(
    p: float,
    p0: float,
    p_alt: float,
    lower_log_boundary: float,
    upper_log_boundary: float,
    max_n: int,
) -> dict:
    """同步展开有限似然比随机游走并精确累计停止概率。"""
    good_log_increment = math.log((_ONE - p_alt) / (_ONE - p0))
    defect_log_increment = math.log(p_alt / p0)
    survival = {(0, 0): _ONE}
    survival_curve = []
    decisions = {
        "accept_h0": 0.0,
        "reject_h1": 0.0,
        "accept_h0_at_cap": 0.0,
        "reject_h1_at_cap": 0.0,
    }
    expected_n = 0.0

    for draw_index in range(max_n):
        probability_not_stopped = math.fsum(survival.values())
        survival_curve.append(
            {
                "j": draw_index,
                "P_N_gt_j": probability_not_stopped,
            }
        )
        expected_n += probability_not_stopped
        next_survival = {}
        for (used, defect_count), state_probability in survival.items():
            branches = (
                (defect_count, _ONE - p),
                (defect_count + 1, p),
            )
            for next_defect_count, observation_probability in branches:
                event_probability = state_probability * observation_probability
                log_likelihood_ratio = (
                    next_defect_count * defect_log_increment
                    + (used + 1 - next_defect_count) * good_log_increment
                )
                if log_likelihood_ratio <= lower_log_boundary:
                    decisions["accept_h0"] += event_probability
                elif log_likelihood_ratio >= upper_log_boundary:
                    decisions["reject_h1"] += event_probability
                else:
                    key = (used + 1, next_defect_count)
                    next_survival[key] = (
                        next_survival.get(key, 0.0) + event_probability
                    )
        survival = next_survival

    for (used, defect_count), state_probability in survival.items():
        log_likelihood_ratio = (
            defect_count * defect_log_increment
            + (used - defect_count) * good_log_increment
        )
        if log_likelihood_ratio < 0.0:
            decisions["accept_h0_at_cap"] += state_probability
        else:
            decisions["reject_h1_at_cap"] += state_probability

    probability_mass = math.fsum(decisions.values())
    return {
        "expected_n": expected_n,
        "accept_h0": decisions["accept_h0"],
        "reject_h1": decisions["reject_h1"],
        "accept_h0_at_cap": decisions["accept_h0_at_cap"],
        "reject_h1_at_cap": decisions["reject_h1_at_cap"],
        "truncated_probability": (
            decisions["accept_h0_at_cap"] + decisions["reject_h1_at_cap"]
        ),
        "decision_mass_error": abs(probability_mass - _ONE),
        "survival_curve": survival_curve,
    }


def _build_sprt_comparison(
    rejection_plan: dict,
    p0: float,
    p_alt: float,
    alpha: float,
    beta: float,
    tolerance: float,
) -> dict:
    lower_log_boundary = math.log(beta / (_ONE - alpha))
    upper_log_boundary = math.log((_ONE - beta) / alpha)
    max_n = rejection_plan["n"]

    at_p0 = _likelihood_ratio_random_walk(
        p0,
        p0,
        p_alt,
        lower_log_boundary,
        upper_log_boundary,
        max_n,
    )
    at_p_alt = _likelihood_ratio_random_walk(
        p_alt,
        p0,
        p_alt,
        lower_log_boundary,
        lower_log_boundary + (upper_log_boundary - lower_log_boundary),
        max_n,
    )

    type_i_error = at_p0["reject_h1"] + at_p0["reject_h1_at_cap"]
    type_ii_error = at_p_alt["accept_h0"] + at_p_alt["accept_h0_at_cap"]
    exact_constraints_pass = (
        type_i_error <= alpha + tolerance
        and type_ii_error <= beta + tolerance
    )
    expected_n_comparison_pass = (
        at_p0["expected_n"] <= max_n + tolerance
        and at_p_alt["expected_n"] <= max_n + tolerance
    )
    selected_sprt = exact_constraints_pass and expected_n_comparison_pass

    boundary = []
    good_log_increment = math.log((_ONE - p_alt) / (_ONE - p0))
    defect_log_increment = math.log(p_alt / p0)
    for sample_count in range(max_n + 1):
        log_likelihood_ratio = (
            sample_count * good_log_increment
            + sample_count * defect_log_increment
        )
        boundary.append(
            {
                "sample_count": sample_count,
                "log_likelihood_ratio": log_likelihood_ratio,
                "lower_log_boundary": lower_log_boundary,
                "upper_log_boundary": upper_log_boundary,
            }
        )

    return {
        "fixed_n": max_n,
        "truncation_n": max_n,
        "lower_log_boundary": lower_log_boundary,
        "upper_log_boundary": upper_log_boundary,
        "lower_likelihood_ratio_boundary": math.exp(lower_log_boundary),
        "upper_likelihood_ratio_boundary": math.exp(upper_log_boundary),
        "cap_decision": "compare log likelihood ratio with zero",
        "expected_n_p0": at_p0["expected_n"],
        "expected_n_p_alt": at_p_alt["expected_n"],
        "type_i_error_p0": type_i_error,
        "type_ii_error_p_alt": type_ii_error,
        "truncated_probability_p0": at_p0["truncated_probability"],
        "truncated_probability_p_alt": at_p_alt["truncated_probability"],
        "exact_constraints_pass": exact_constraints_pass,
        "expected_n_comparison_pass": expected_n_comparison_pass,
        "selected": selected_sprt,
        "selection": "SPRT" if selected_sprt else "fixed",
        "survival_curve_p0": at_p0["survival_curve"],
        "survival_curve_p_alt": at_p_alt["survival_curve"],
        "boundary": boundary,
        "decision_mass_error_p0": at_p0["decision_mass_error"],
        "decision_mass_error_p_alt": at_p_alt["decision_mass_error"],
    }


def _build_oc_curve(rejection_plan: dict, acceptance_plan: dict) -> dict:
    n = rejection_plan["n"]
    probabilities = []
    rejection_acceptance_probability = []
    acceptance_probability = []
    for index in range(n + 1):
        p = index / n
        probabilities.append(p)
        rejection_acceptance_probability.append(
            _exact_integer_binomial_cdf(n, rejection_plan["r"] - 1, p)
        )
        acceptance_probability.append(
            _exact_integer_binomial_cdf(n, acceptance_plan["c"], p)
        )
    return {
        "p": probabilities,
        "case95_non_rejection_probability": rejection_acceptance_probability,
        "case90_acceptance_probability": acceptance_probability,
    }


def _build_sample_size_confidence_curve(
    rejection_plan: dict,
    p0: float,
    p_alt: float,
    beta: float,
    tolerance: float,
) -> list[dict]:
    candidates = []
    required_power = _ONE - beta
    for n in range(1, rejection_plan["n"] + 1):
        for rejection_threshold in range(1, n + 1):
            achieved_alpha, _ = _checked_binomial_sf(
                n, rejection_threshold, p0, tolerance
            )
            achieved_power, _ = _checked_binomial_sf(
                n, rejection_threshold, p_alt, tolerance
            )
            if achieved_power + tolerance >= required_power:
                candidates.append(
                    {
                        "n": n,
                        "r": rejection_threshold,
                        "alpha": achieved_alpha,
                        "confidence": _ONE - achieved_alpha,
                        "power_p_alt": achieved_power,
                    }
                )

    candidates.sort(
        key=lambda item: (
            item["alpha"],
            item["n"],
            item["r"],
        )
    )
    best_n = math.inf
    best_r = None
    curve = []
    for candidate in candidates:
        if candidate["n"] < best_n or (
            candidate["n"] == best_n
            and (best_r is None or candidate["r"] < best_r)
        ):
            best_n = candidate["n"]
            best_r = candidate["r"]
        curve.append(
            {
                "alpha": candidate["alpha"],
                "confidence": candidate["confidence"],
                "minimum_n_at_or_below_alpha": best_n,
                "corresponding_r": best_r,
                "power_p_alt": candidate["power_p_alt"],
            }
        )
    return curve


def _run_self_checks(
    parameters: dict,
    rejection_plan: dict,
    acceptance_plan: dict,
    sprt: dict,
) -> dict:
    brute_rejection = _brute_force_rejection_unit_test(
        parameters["p0"],
        parameters["alpha"],
        parameters["beta"],
        parameters["p_alt"],
        parameters["tolerance"],
        rejection_plan["n"],
    )
    brute_acceptance = _brute_force_acceptance_unit_test(
        parameters["p0"],
        parameters["confidence"],
        parameters["beta"],
        parameters["p_alt"],
        parameters["tolerance"],
        acceptance_plan["n"],
    )
    if (
        brute_rejection["n"] != rejection_plan["n"]
        or brute_rejection["r"] != rejection_plan["r"]
    ):
        raise AssertionError("拒收方案与逐项暴力枚举不一致")
    if (
        brute_acceptance["n"] != acceptance_plan["n"]
        or brute_acceptance["c"] != acceptance_plan["c"]
    ):
        raise AssertionError("接收方案与逐项暴力枚举不一致")

    tolerance = parameters["tolerance"]
    checks = {
        "rejection_threshold_in_bounds": 1
        <= rejection_plan["r"]
        <= rejection_plan["n"],
        "rejection_type_i_constraint": rejection_plan["reject_tail_p0"]
        <= parameters["alpha"] + tolerance,
        "rejection_power_constraint": rejection_plan["power_p_alt"] + tolerance
        >= _ONE - parameters["beta"],
        "rejection_probability_monotone_in_p": rejection_plan["power_p_alt"]
        + tolerance
        >= rejection_plan["reject_tail_p0"],
        "acceptance_threshold_in_bounds": 0
        <= acceptance_plan["c"]
        < acceptance_plan["n"],
        "acceptance_confidence_constraint": acceptance_plan[
            "accept_probability_p0"
        ]
        + tolerance
        >= parameters["confidence"],
        "acceptance_nonempty_rejection_power_constraint": acceptance_plan[
            "rejection_power_p_alt"
        ]
        + tolerance
        >= _ONE - parameters["beta"],
        "acceptance_probability_monotone_decreasing": acceptance_plan[
            "accept_probability_p0"
        ]
        + tolerance
        >= acceptance_plan["false_accept_probability_p_alt"],
        "sprt_probability_mass_p0": sprt["decision_mass_error_p0"]
        <= tolerance,
        "sprt_probability_mass_p_alt": sprt["decision_mass_error_p_alt"]
        <= tolerance,
        "exhaustive_rejection_threshold_search": rejection_plan[
            "exhaustive_threshold_enumeration"
        ],
        "exhaustive_acceptance_threshold_search": acceptance_plan[
            "exhaustive_threshold_enumeration"
        ],
    }
    if not all(checks.values()):
        failed = [name for name, passed in checks.items() if not passed]
        raise RuntimeError(f"问题一自检失败：{failed}")

    identity_max_diff = max(
        rejection_plan["exact_enum_max_diff"],
        acceptance_plan["exact_enum_max_diff"],
    )
    return {
        "checks": checks,
        "identity_max_diff": identity_max_diff,
        "brute_force_rejection_pass": True,
        "brute_force_acceptance_pass": True,
        "all_pass": True,
    }


def run() -> dict:
    parameters = _load_parameters()
    rejection_plan = find_minimum_rejection_plan(
        p0=parameters["p0"],
        alpha=parameters["alpha"],
        beta=parameters["beta"],
        p_alt=parameters["p_alt"],
        tolerance=parameters["tolerance"],
    )
    acceptance_plan = find_minimum_acceptance_plan(
        p0=parameters["p0"],
        confidence=parameters["confidence"],
        beta=parameters["beta"],
        p_alt=parameters["p_alt"],
        tolerance=parameters["tolerance"],
    )
    sprt = _build_sprt_comparison(
        rejection_plan,
        parameters["p0"],
        parameters["p_alt"],
        parameters["alpha"],
        parameters["beta"],
        parameters["tolerance"],
    )
    validation = _run_self_checks(
        parameters,
        rejection_plan,
        acceptance_plan,
        sprt,
    )

    sensitivity = []
    for delta in parameters["delta_grid"]:
        for beta in parameters["beta_grid"]:
            item = find_minimum_rejection_plan(
                p0=parameters["p0"],
                alpha=parameters["alpha"],
                beta=beta,
                p_alt=parameters["p0"] + delta,
                tolerance=parameters["tolerance"],
            )
            sensitivity.append(
                {
                    "delta": delta,
                    "beta": beta,
                    "p_alt": parameters["p0"] + delta,
                    "n": item["n"],
                    "r": item["r"],
                    "reject_tail_p0": item["reject_tail_p0"],
                    "power_p_alt": item["power_p_alt"],
                    "type2_error_p_alt": item["type2_error_p_alt"],
                }
            )

    return {
        "case95": {
            "n": rejection_plan["n"],
            "r": rejection_plan["r"],
            "confidence": _ONE - parameters["alpha"],
            "type_i_error_limit": parameters["alpha"],
            "type_ii_error_limit": parameters["beta"],
            "alternative_rate": parameters["p_alt"],
            "reject_tail": rejection_plan["reject_tail_p0"],
            "power_p_alt": rejection_plan["power_p_alt"],
            "type2_error_p_alt": rejection_plan["type2_error_p_alt"],
            "all_alpha_feasible_r_at_n": rejection_plan[
                "all_alpha_feasible_r_at_n"
            ],
            "all_fully_feasible_r_at_n": rejection_plan[
                "all_fully_feasible_r_at_n"
            ],
            "tie_break": rejection_plan["tie_break"],
            "exhaustive_threshold_enumeration": True,
        },
        "case90": {
            "n": acceptance_plan["n"],
            "c": acceptance_plan["c"],
            "confidence": parameters["confidence"],
            "type_ii_error_limit": parameters["beta"],
            "identification_alternative_p_alt": parameters["p_alt"],
            "accept_probability": acceptance_plan["accept_probability_p0"],
            "false_accept_probability_p_alt": acceptance_plan[
                "false_accept_probability_p_alt"
            ],
            "rejection_power_p_alt": acceptance_plan["rejection_power_p_alt"],
            "nondegenerate_rejection_region": acceptance_plan[
                "nondegenerate_rejection_region"
            ],
            "all_confidence_feasible_c_at_n": acceptance_plan[
                "all_confidence_feasible_c_at_n"
            ],
            "all_fully_feasible_c_at_n": acceptance_plan[
                "all_fully_feasible_c_at_n"
            ],
            "tie_break": acceptance_plan["tie_break"],
            "exhaustive_threshold_enumeration": True,
        },
        "sprt": sprt,
        "oc_curve": _build_oc_curve(rejection_plan, acceptance_plan),
        "sample_size_vs_confidence": _build_sample_size_confidence_curve(
            rejection_plan,
            parameters["p0"],
            parameters["p_alt"],
            parameters["beta"],
            parameters["tolerance"],
        ),
        "two_cases_sample_size": [
            {
                "case": "case95",
                "n": rejection_plan["n"],
            },
            {
                "case": "case90",
                "n": acceptance_plan["n"],
            },
        ],
        "sensitivity": {
            "delta_grid": list(parameters["delta_grid"]),
            "beta_grid": list(parameters["beta_grid"]),
            "records": sensitivity,
        },
        "validation": validation,
        "design_inputs": {
            "p0": parameters["p0"],
            "reject_alpha": parameters["alpha"],
            "accept_confidence": parameters["confidence"],
            "delta": parameters["delta"],
            "p_alt": parameters["p_alt"],
            "beta": parameters["beta"],
            "numeric_tolerance": parameters["tolerance"],
        },
        "implementation": {
            "fixed_sampling": "exact_integer_enumeration",
            "probability_reference": "scipy.stats.binom",
            "sequential_sampling": "likelihood_ratio_random_walk",
            "acceptance_design": "nondegenerate_high_rate_alternative_with_power",
        },
    }


def solve() -> dict:
    return run()


def solve_problem1() -> dict:
    return run()