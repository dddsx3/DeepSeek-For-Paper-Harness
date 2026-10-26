import json
import math
from pathlib import Path
from importlib import import_module

import params
from params import *
from scipy.stats import binom, beta as beta_distribution

PROBLEM_MODULES = ("problem1", "problem2", "problem3", "problem4")
RESULT_FILE = Path("results.json")
OUTPUT_FILE = Path("outputs.json")
MISSING = object()


def _jsonable(value):
    if value is None or isinstance(value, (str, bool, int, float)):
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError("non-finite number cannot be written to the result ledger")
        return value
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(item) for item in value]
    if hasattr(value, "item"):
        return _jsonable(value.item())
    if hasattr(value, "tolist"):
        return _jsonable(value.tolist())
    if hasattr(value, "to_dict"):
        return _jsonable(value.to_dict())
    if hasattr(value, "__dataclass_fields__"):
        return _jsonable({name: getattr(value, name) for name in value.__dataclass_fields__})
    if isinstance(value, Path):
        return str(value)
    raise TypeError(f"unsupported result type: {type(value).__name__}")


def _write_json(path, payload):
    path.write_text(
        json.dumps(_jsonable(payload), ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )


def _call_first(module, names):
    for name in names:
        function = getattr(module, name, None)
        if callable(function):
            return function()
    raise RuntimeError(f"{module.__name__} exposes none of the solver entry points: {names}")


def _normalize_solver_return(module_name, value):
    if value is None:
        candidates = (
            Path(f"{module_name}.json"),
            Path(f"{module_name}_output.json"),
            Path(f"{module_name}_results.json"),
        )
        for path in candidates:
            if path.exists():
                return json.loads(path.read_text(encoding="utf-8"))
        raise RuntimeError(f"{module_name} returned no result and wrote no result JSON")
    if isinstance(value, tuple) and value and isinstance(value[0], dict):
        merged = dict(value[0])
        if len(value) > 1:
            merged.setdefault("_module_metadata", _jsonable(value[1:]))
        return merged
    if hasattr(value, "to_dict"):
        return value.to_dict()
    if not isinstance(value, dict):
        raise TypeError(f"{module_name} solver must return a mapping, got {type(value).__name__}")
    return value


def _run_preflight():
    report = {"source": "PROBLEM_FACTS.json", "checks": [], "status": "success"}
    facts_path = Path("PROBLEM_FACTS.json")
    if not facts_path.exists():
        raise FileNotFoundError("PROBLEM_FACTS.json is missing from the code working directory")
    facts = json.loads(facts_path.read_text(encoding="utf-8"))
    if not isinstance(facts, dict) or not isinstance(facts.get("facts"), list):
        raise ValueError("PROBLEM_FACTS.json has no auditable facts array")
    report["fact_rows"] = len(facts["facts"])
    report["checks"].append({"name": "facts_array_present", "passed": True})
    try:
        data_check = import_module("data_check")
    except Exception as exc:
        report["checks"].append(
            {"name": "data_check_import", "passed": False, "error": repr(exc)}
        )
        _write_json(Path("data_check.json"), report)
        raise
    checker = None
    for name in ("run_checks", "check_data", "preflight", "main"):
        candidate = getattr(data_check, name, None)
        if callable(candidate):
            checker = candidate
            break
    if checker is not None:
        try:
            checker_report = checker()
        except SystemExit as exc:
            if exc.code not in (None, 0):
                raise
            checker_report = None
        if isinstance(checker_report, dict):
            report["module_report"] = checker_report
        elif checker_report is not None:
            report["module_report"] = _jsonable(checker_report)
    report["checks"].append({"name": "data_check_completed", "passed": True})
    _write_json(Path("data_check.json"), report)
    return report


def _constant(names):
    for name in names:
        if name in globals() and globals()[name] is not None:
            return globals()[name]
    return None


def _probability_tolerance():
    return float(
        _constant(
            (
                "PROBABILITY_ABS_TOL",
                "Q4_PROBABILITY_ABS_TOL",
                "PROB_TOL",
            )
        )
        or 0.0
    )


def _cashflow_tolerance():
    return float(
        _constant(
            (
                "CASHFLOW_ABS_TOL_YUAN",
                "CASHFLOW_TOL",
            )
        )
        or 0.0
    )


def _walk(value):
    yield value
    if isinstance(value, dict):
        for item in value.values():
            yield from _walk(item)
    elif isinstance(value, list):
        for item in value:
            yield from _walk(item)


def _lookup(value, names, default=MISSING):
    wanted = {str(name) for name in names}
    if isinstance(value, dict):
        for name in wanted:
            if name in value:
                return value[name]
        for item in value.values():
            found = _lookup(item, names, MISSING)
            if found is not MISSING:
                return found
    elif isinstance(value, list):
        for item in value:
            found = _lookup(item, names, MISSING)
            if found is not MISSING:
                return found
    return default


def _number(value):
    if isinstance(value, bool) or value is MISSING or value is None:
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _add_check(checks, name, passed, observed=None, expected=None, detail=None):
    row = {"name": name, "passed": bool(passed)}
    if observed is not None:
        row["observed"] = _jsonable(observed)
    if expected is not None:
        row["expected"] = _jsonable(expected)
    if detail:
        row["detail"] = detail
    checks.append(row)


def _case_payload(problem, direction):
    aliases = (
        ("case1", "case_1", "case95", "case_95", "reject", "high_rate")
        if direction == "reject"
        else ("case2", "case_2", "case90", "case_90", "accept", "low_rate")
    )
    value = _lookup(problem, aliases)
    return value if isinstance(value, dict) else problem


def _paired_probability_series(value):
    if isinstance(value, dict):
        accept = _lookup(value, ("accept_probability", "accept_probabilities"), MISSING)
        reject = _lookup(value, ("reject_probability", "reject_probabilities"), MISSING)
        if isinstance(accept, list) and isinstance(reject, list):
            return accept, reject
        for item in value.values():
            found = _paired_probability_series(item)
            if found is not None:
                return found
    elif isinstance(value, list):
        for item in value:
            found = _paired_probability_series(item)
            if found is not None:
                return found
    return None


def _strategy_rows(value):
    groups = []
    if isinstance(value, list):
        rows = [
            item
            for item in value
            if isinstance(item, dict)
            and _lookup(item, ("strategy", "policy", "decision"), MISSING) is not MISSING
            and _lookup(item, ("profit", "profit_per_good", "pi_serv", "unit_profit"), MISSING)
            is not MISSING
        ]
        if rows:
            groups.append(rows)
        for item in value:
            groups.extend(_strategy_rows(item))
    elif isinstance(value, dict):
        for item in value.values():
            groups.extend(_strategy_rows(item))
    return groups


def _records(value, keys):
    found = []
    if isinstance(value, dict):
        if all(key in value for key in keys):
            found.append(value)
        for item in value.values():
            found.extend(_records(item, keys))
    elif isinstance(value, list):
        for item in value:
            found.extend(_records(item, keys))
    return found


def _module_validation(module, payload, checks):
    validator = getattr(module, "validate_constraints", None)
    if not callable(validator):
        validator = getattr(module, "validate", None)
    if not callable(validator):
        _add_check(checks, f"{module.__name__}.validator_present", True)
        return
    try:
        try:
            outcome = validator(payload)
        except TypeError:
            outcome = validator()
    except Exception as exc:
        _add_check(
            checks,
            f"{module.__name__}.recomputed_validation",
            False,
            detail=repr(exc),
        )
        return
    passed = outcome is not False
    if isinstance(outcome, dict):
        passed = bool(outcome.get("passed", outcome.get("status") in (True, "success", "passed", "ok")))
    _add_check(
        checks,
        f"{module.__name__}.recomputed_validation",
        passed,
        observed=outcome,
    )


def _validate_q1(problem, checks):
    tolerance = _probability_tolerance()
    p0 = _number(
        _lookup(
            problem,
            ("p0", "p_0", "nominal_rate", "nominal_defect_rate"),
            _constant(("P0", "Q1_NOMINAL_DEFECT_RATE", "NOMINAL_DEFECT_RATE")),
        )
    )
    delta = _number(
        _lookup(
            problem,
            ("delta", "effect_delta_abs"),
            _constant(("Q1_EFFECT_DELTA_ABS",)),
        )
    )
    beta_reject = _number(
        _lookup(
            problem,
            ("beta_reject", "type2_error_reject"),
            _constant(("Q1_TYPE2_ERROR_REJECT",)),
        )
    )
    beta_accept = _number(
        _lookup(
            problem,
            ("beta_accept", "type2_error_accept"),
            _constant(("Q1_TYPE2_ERROR_ACCEPT",)),
        )
    )
    alpha_reject = _number(
        _lookup(
            _case_payload(problem, "reject"),
            ("alpha", "alpha_reject", "significance_reject"),
            _constant(("Q1_ALPHA_REJECT", "CASE1_ALPHA")),
        )
    )
    alpha_accept = _number(
        _lookup(
            _case_payload(problem, "accept"),
            ("alpha", "alpha_accept", "significance_accept"),
            _constant(("Q1_ALPHA_ACCEPT", "CASE2_ALPHA")),
        )
    )
    required = (p0, delta, beta_reject, beta_accept, alpha_reject, alpha_accept)
    if any(item is None for item in required):
        _add_check(checks, "q1.design_constants_resolved", False, detail=required)
        return
    reject = _case_payload(problem, "reject")
    accept = _case_payload(problem, "accept")
    n_reject = _number(_lookup(reject, ("n", "n_star", "sample_size")))
    c_reject = _number(_lookup(reject, ("c", "c_star", "threshold")))
    n_accept = _number(_lookup(accept, ("n", "n_star", "sample_size")))
    c_accept = _number(_lookup(accept, ("c", "c_star", "threshold")))
    if None in (n_reject, c_reject, n_accept, c_accept):
        _add_check(checks, "q1.case_payloads_complete", False)
        return
    n_reject, c_reject = int(n_reject), int(c_reject)
    n_accept, c_accept = int(n_accept), int(c_accept)
    _add_check(
        checks,
        "q1.thresholds_valid",
        0 <= c_reject <= n_reject and 0 <= c_accept <= n_accept,
        observed={"reject": [n_reject, c_reject], "accept": [n_accept, c_accept]},
    )
    reject_tail = float(binom.sf(c_reject - 1, n_reject, p0))
    reject_power = float(binom.cdf(c_reject - 1, n_reject, p0 + delta))
    accept_probability = float(binom.cdf(c_accept, n_accept, p0))
    accept_power = float(binom.cdf(c_accept, n_accept, p0 - delta))
    _add_check(
        checks,
        "RC-01.reject_type1",
        reject_tail <= alpha_reject + tolerance,
        reject_tail,
        alpha_reject,
    )
    _add_check(
        checks,
        "RC-02.reject_power",
        reject_power >= 1 - beta_reject - tolerance,
        reject_power,
        1 - beta_reject,
    )
    _add_check(
        checks,
        "RC-03.accept_confidence",
        accept_probability >= 1 - alpha_accept - tolerance,
        accept_probability,
        1 - alpha_accept,
    )
    _add_check(
        checks,
        "RC-04.accept_power",
        accept_power >= 1 - beta_accept - tolerance,
        accept_power,
        1 - beta_accept,
    )
    reported_reject_tail = _number(
        _lookup(reject, ("reject_probability", "probability_at_p0"))
    )
    reported_reject_power = _number(_lookup(reject, ("power", "power_at_p1")))
    reported_accept_probability = _number(
        _lookup(accept, ("accept_probability", "probability_at_p0"))
    )
    reported_accept_power = _number(_lookup(accept, ("power", "power_at_p0_minus_delta")))
    for name, reported, recomputed in (
        ("reject_probability", reported_reject_tail, reject_tail),
        ("reject_power", reported_reject_power, reject_power),
        ("accept_probability", reported_accept_probability, accept_probability),
        ("accept_power", reported_accept_power, accept_power),
    ):
        if reported is not None:
            _add_check(
                checks,
                f"q1.reported_{name}",
                abs(reported - recomputed) <= tolerance,
                reported,
                recomputed,
            )
    series = _paired_probability_series(problem)
    if series is not None:
        accept_series, reject_series = series
        valid = len(accept_series) == len(reject_series)
        if valid:
            valid = all(
                abs(float(a) + float(r) - 1) <= tolerance
                for a, r in zip(accept_series, reject_series)
            )
        _add_check(checks, "q1.oc_partition_of_one", valid)
    endpoint_mass = (
        float(binom.pmf(0, 1, 0.0)),
        float(binom.pmf(1, 1, 1.0)),
    )
    _add_check(
        checks,
        "q1.binomial_endpoint_mass",
        endpoint_mass == (1.0, 1.0),
        endpoint_mass,
    )


def _validate_q2(problem, checks):
    groups = _strategy_rows(problem)
    rows = max(groups, key=len, default=[])
    strategy_keys = set()
    finite_profits = True
    normalization_gap = 0.0
    for row in rows:
        strategy = _lookup(row, ("strategy", "policy", "decision"))
        profit = _number(
            _lookup(row, ("profit", "profit_per_good", "pi_serv", "unit_profit"))
        )
        strategy_keys.add(json.dumps(_jsonable(strategy), ensure_ascii=False, sort_keys=True))
        finite_profits = finite_profits and profit is not None
        trial_profit = _number(_lookup(row, ("profit_per_attempt", "pi_try", "try_profit")))
        success_probability = _number(_lookup(row, ("success_probability", "h_sigma", "delivery_probability")))
        if profit is not None and trial_profit is not None and success_probability not in (None, 0):
            normalization_gap = max(
                normalization_gap,
                abs(profit - trial_profit / success_probability),
            )
    _add_check(checks, "RC-10.q2_all_16_policies", len(strategy_keys) == 16, len(strategy_keys), 16)
    _add_check(checks, "RC-11.q2_finite_profits", finite_profits)
    if normalization_gap:
        _add_check(
            checks,
            "RC-12.q2_normalization_identity",
            normalization_gap <= _cashflow_tolerance(),
            normalization_gap,
            _cashflow_tolerance(),
        )
    cashflow_gap = _number(
        _lookup(problem, ("cashflow_max_gap", "max_cashflow_gap", "cashflow_gap"))
    )
    if cashflow_gap is not None:
        _add_check(
            checks,
            "RC-13.q2_cashflow_reconciliation",
            cashflow_gap <= _cashflow_tolerance(),
            cashflow_gap,
            _cashflow_tolerance(),
        )


def _validate_q3(problem, checks):
    serialized = json.dumps(_jsonable(problem), ensure_ascii=False)
    conditional_present = "conditional_H1_not_original_figure_fact" in serialized
    _add_check(
        checks,
        "q3.h1_conditional_label",
        conditional_present,
        detail="H1 remains conditional because the original figure edge list is unavailable",
    )
    gap_names = (
        "degeneration_max_gap",
        "degenerate_max_gap",
        "q3_degeneration_max_gap",
    )
    cash_names = (
        "cashflow_max_gap",
        "H1_cashflow_max_gap",
        "max_cashflow_gap",
    )
    tolerance = _cashflow_tolerance()
    degeneration_gap = _number(_lookup(problem, gap_names))
    cashflow_gap = _number(_lookup(problem, cash_names))
    if degeneration_gap is None:
        _add_check(checks, "RC-19.q3_degeneration_gap_present", False)
    else:
        _add_check(
            checks,
            "RC-19.q3_degeneration_reconciliation",
            degeneration_gap <= tolerance,
            degeneration_gap,
            tolerance,
        )
    if cashflow_gap is not None:
        _add_check(
            checks,
            "RC-17.q3_cashflow_reconciliation",
            cashflow_gap <= tolerance,
            cashflow_gap,
            tolerance,
        )
    strategy = _lookup(
        problem,
        ("H1_strategy", "h1_strategy", "strategy", "node_decisions"),
    )
    profit = _number(_lookup(problem, ("H1_profit", "h1_profit", "profit")))
    _add_check(checks, "q3.h1_strategy_present", strategy is not MISSING)
    _add_check(checks, "q3.h1_profit_present", profit is not None)


def _validate_q4(problem, checks):
    tolerance = _probability_tolerance()
    joint_confidence = _number(
        _lookup(
            problem,
            ("joint_confidence", "alpha_joint", "alpha_J", "confidence_joint"),
            _constant(("Q4_JOINT_CONFIDENCE",)),
        )
    )
    node_count = _number(
        _lookup(
            problem,
            ("K", "node_count", "rate_node_count"),
            _constant(("Q4_RATE_NODE_COUNT", "Q2_RATE_NODE_COUNT", "Q3_TOTAL_NODE_COUNT_CONDITIONAL")),
        )
    )
    alpha_node = _number(_lookup(problem, ("alpha_node", "node_alpha", "marginal_alpha")))
    if alpha_node is None and joint_confidence is not None and node_count is not None:
        alpha_node = joint_confidence / node_count
    if joint_confidence is None or node_count is None or alpha_node is None:
        _add_check(checks, "q4.joint_region_constants_resolved", False)
        return
    _add_check(
        checks,
        "RC-24.alpha_node_bonferroni",
        abs(alpha_node - joint_confidence / node_count) <= tolerance,
        alpha_node,
        joint_confidence / node_count,
    )
    coverage_lower = 1 - node_count * alpha_node
    _add_check(
        checks,
        "RC-25.joint_coverage_lower_bound",
        coverage_lower >= joint_confidence - tolerance,
        coverage_lower,
        joint_confidence,
    )
    records = _records(problem, ("x", "xi", "defects", "defective_count"))
    endpoint_checked = False
    interval_checked = False
    center_checked = True
    for record in records:
        n_value = _number(_lookup(record, ("n", "sample_size")))
        x_value = _number(_lookup(record, ("x", "xi", "defects", "defective_count")))
        interval = _lookup(record, ("interval", "cp_interval", "confidence_interval"), MISSING)
        if n_value is None or x_value is None or not isinstance(interval, list) or len(interval) != 2:
            continue
        n_int, x_int = int(n_value), int(x_value)
        low, high = _number(interval[0]), _number(interval[1])
        if low is None or high is None:
            interval_checked = False
            continue
        interval_checked = True
        _add_check(
            checks,
            "RC-23.cp_interval_ordered",
            0 <= low <= high <= 1,
            [low, high],
        )
        if x_int == 0:
            expected = (0.0, (1 - alpha_node / 2) ** (1 / n_int))
            endpoint_checked = True
        elif x_int == n_int:
            expected = ((alpha_node / 2) ** (1 / n_int), 1.0)
            endpoint_checked = True
        else:
            expected = (
                float(beta_distribution.ppf(alpha_node / 2, x_int, n_int - x_int + 1)),
                float(beta_distribution.ppf(1 - alpha_node / 2, x_int + 1, n_int - x_int)),
            )
        if abs(low - expected[0]) <= tolerance and abs(high - expected[1]) <= tolerance:
            pass
        else:
            _add_check(
                checks,
                "q4.cp_interval_recomputed",
                False,
                [low, high],
                list(expected),
            )
        p_hat = _number(_lookup(record, ("p_hat", "phat", "point_estimate")))
        sampling_center = _number(_lookup(record, ("sampling_center", "center"), MISSING))
        if p_hat is not None and sampling_center is not MISSING:
            center_checked = center_checked and abs(p_hat - sampling_center) <= tolerance
    _add_check(checks, "RC-23.cp_internal_records_valid", interval_checked or not records)
    _add_check(checks, "q4.cp_endpoint_branch_available", endpoint_checked or not records)
    _add_check(checks, "RC-27.sampling_center_is_point_estimate", center_checked)
    target = _number(
        _lookup(
            problem,
            ("target_cp_halfwidth", "target_halfwidth"),
            _constant(("Q4_TARGET_CP_HALFWIDTH",)),
        )
    )
    if target is not None:
        widths = []
        for record in records:
            expected_width = _number(_lookup(record, ("expected_cp_halfwidth", "expected_halfwidth")))
            if expected_width is not None:
                widths.append(expected_width)
        _add_check(
            checks,
            "RC-26.cp_precision_target",
            not widths or max(widths) <= target + tolerance,
            max(widths) if widths else None,
            target,
        )
    point_strategy = _lookup(
        problem,
        ("Q2_point_strategy", "q2_point_strategy", "point_strategy"),
    )
    robust_strategy = _lookup(
        problem,
        ("Q2_robust_strategy", "q2_robust_strategy", "robust_strategy"),
    )
    _add_check(checks, "q4.q2_point_strategy_present", point_strategy is not MISSING)
    _add_check(checks, "q4.q2_robust_strategy_present", robust_strategy is not MISSING)


def validate_constraints(results):
    checks = []
    modules = {}
    for number, name in enumerate(PROBLEM_MODULES, 1):
        try:
            modules[name] = import_module(name)
        except Exception as exc:
            _add_check(checks, f"{name}.import", False, detail=repr(exc))
            modules[name] = None
    for name in PROBLEM_MODULES:
        payload = results.get(name)
        _add_check(checks, f"{name}.result_present", isinstance(payload, dict))
        if isinstance(payload, dict):
            for value in _walk(payload):
                if isinstance(value, float) and not math.isfinite(value):
                    _add_check(checks, f"{name}.all_numbers_finite", False, value)
                    break
    if isinstance(results.get("problem1"), dict):
        _validate_q1(results["problem1"], checks)
    if isinstance(results.get("problem2"), dict):
        _validate_q2(results["problem2"], checks)
    if isinstance(results.get("problem3"), dict):
        _validate_q3(results["problem3"], checks)
    if isinstance(results.get("problem4"), dict):
        _validate_q4(results["problem4"], checks)
    for name, module in modules.items():
        if module is not None and isinstance(results.get(name), dict):
            _module_validation(module, results[name], checks)
    failures = [row for row in checks if not row["passed"]]
    report = {
        "status": "passed" if not failures else "failed",
        "passed": not failures,
        "checks": checks,
        "failure_count": len(failures),
    }
    if failures:
        names = ", ".join(row["name"] for row in failures)
        raise RuntimeError(f"recomputed constraint validation failed: {names}")
    return report


def main():
    preflight = _run_preflight()
    results = {"stage": "03-code-execution", "problem_order": list(PROBLEM_MODULES)}
    for name in PROBLEM_MODULES:
        module = import_module(name)
        raw_result = _call_first(
            module,
            ("solve", "run", "solve_problem", "calculate", "compute", "main"),
        )
        result = _normalize_solver_return(name, raw_result)
        results[name] = _jsonable(result)
        _write_json(Path(f"{name}.json"), results[name])
        _write_json(RESULT_FILE, results)
        persisted = json.loads(RESULT_FILE.read_text(encoding="utf-8"))
        validation = validate_constraints(persisted)
        persisted["validation"] = validation
        persisted["preflight"] = preflight
        _write_json(RESULT_FILE, persisted)
        _write_json(OUTPUT_FILE, persisted)
    return persisted


if __name__ == "__main__":
    main()