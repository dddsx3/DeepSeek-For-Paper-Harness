"""Problem 4: precision sampling, exact intervals, and scenario re-optimisation."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import asdict, is_dataclass
from itertools import product
import json

import numpy as np
import scipy.stats

import params


def _name(value):
    return "".join(ch for ch in str(value).lower() if ch.isalnum())


def _plain(value):
    if is_dataclass(value) and not isinstance(value, type):
        return _plain(asdict(value))
    if isinstance(value, Mapping):
        return {str(key): _plain(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(item) for item in value]
    if hasattr(value, "tolist"):
        return _plain(value.tolist())
    if hasattr(value, "item"):
        return _plain(value.item())
    return value


def _field(value, names):
    names = {_name(name) for name in names}
    if isinstance(value, Mapping):
        for key, item in value.items():
            if _name(key) in names:
                return item
        for item in value.values():
            found = _field(item, names)
            if found is not None:
                return found
    elif is_dataclass(value) and not isinstance(value, type):
        return _field(asdict(value), names)
    elif isinstance(value, (list, tuple)) and not isinstance(value, (str, bytes)):
        for item in value:
            found = _field(item, names)
            if found is not None:
                return found
    return None


def _invoke(module, candidates, values):
    failures = []
    for candidate in candidates:
        function = getattr(module, candidate, None)
        if not callable(function):
            continue
        args, kwargs, supported = [], {}, True
        for parameter in inspect.signature(function).parameters.values():
            if parameter.default is not inspect.Parameter.empty or parameter.kind in {
                inspect.Parameter.VAR_POSITIONAL,
                inspect.Parameter.VAR_KEYITIONAL,
            }:
                continue
            key = _name(parameter.name)
            if key not in values:
                supported = False
                break
            if parameter.kind is inspect.Parameter.POSITIONAL_ONLY:
                args.append(values[key])
            else:
                kwargs[parameter.name] = values[key]
        if not supported:
            continue
        try:
            result = function(*args, **kwargs)
        except Exception as error:
            failures.append(f"{candidate}: {type(error).__name__}: {error}")
            continue
        if isinstance(result, Mapping) and result:
            return result
    detail = failures[-1] if failures else "no compatible public solver signature"
    raise RuntimeError(f"{module.__name__} oracle unavailable ({detail})")


def _q2_oracle(case):
    import problem2

    values = {
        "case": case,
        "caseparams": case,
        "casedata": case,
        "parameters": case,
        "p1": case["p1"],
        "p2": case["p2"],
        "pf": case["pf"],
        "policyspace": params.Q2_POLICY_SPACE,
        "strategiespace": params.Q2_POLICY_SPACE,
    }
    raw = _invoke(
        problem2,
        ("solve_case", "solve_scenario", "evaluate_case", "run_case", "solve"),
        values,
    )
    policy = _field(raw, ("best_policy", "optimal_policy", "selected_policy", "policy"))
    profit = _field(raw, ("best_profit", "optimal_profit", "unit_profit", "profit"))
    residual = _field(raw, ("bellman_residual", "max_bellman_residual"))
    return _plain({"policy": policy, "profit": float(profit), "raw_residual": residual})


def _q3_oracle(rates):
    import problem3

    nodes = {
        node: {**spec, "p": float(rate)}
        for node, spec, rate in zip(params.Q3_NODE_SPECS, rates)
    }
    values = {
        "topology": params.Q3_PRIMARY_TOPOLOGY,
        "topologybyid": params.Q3_PRIMARY_TOPOLOGY,
        "graph": params.Q3_PRIMARY_TOPOLOGY,
        "nodespecs": nodes,
        "nodes": nodes,
        "specs": nodes,
        "parameters": nodes,
        "rates": tuple(float(rate) for rate in rates),
        "pvalues": tuple(float(rate) for rate in rates),
        "parametervector": tuple(float(rate) for rate in rates),
        "parameteroverrides": tuple(float(rate) for rate in rates),
    }
    raw = _invoke(
        problem3,
        ("solve_topology", "solve_instance", "solve_network", "solve_case", "solve"),
        values,
    )
    policy = _field(raw, ("best_policy", "optimal_policy", "selected_policy", "policy"))
    profit = _field(raw, ("best_profit", "optimal_profit", "unit_profit", "profit"))
    residual = _field(raw, ("bellman_residual", "max_bellman_residual"))
    metrics = _field(raw, ("node_metrics", "node_rates", "launch_cost_rates"))
    return _plain(
        {
            "policy": policy,
            "profit": float(profit),
            "raw_residual": residual,
            "node_metrics": metrics,
        }
    )


def _cp_interval(n, x, marginal_alpha):
    if n < 1 or x < 0 or x > n:
        raise ValueError("invalid binomial count")
    lower = 0 if x == 0 else float(scipy.stats.beta.ppf(marginal_alpha / 2, x, n - x + 1))
    upper = 1 if x == n else float(
        scipy.stats.beta.ppf(1 - marginal_alpha / 2, x + 1, n - x)
    )
    return lower, upper


def _precision_design(probabilities, marginal_alpha):
    selected = []
    for node, probability in enumerate(probabilities):
        choice = None
        for n in range(1, params.Q4_N_MAX + 1):
            x = int(round(probability * n))
            lower, upper = _cp_interval(n, x, marginal_alpha)
            if upper - lower <= params.Q4_WIDTH_TARGET + params.Q4_NUMERIC_TOL:
                choice = (n, x, lower, upper)
                break
        if choice is None:
            raise RuntimeError(f"precision target not reached for node {node}")
        selected.append(choice)

    grid = np.linspace(
        params.Q4_SAMPLE_SIZE_GRID[0],
        params.Q4_SAMPLE_SIZE_GRID[-1],
        num=len(params.Q3_PART_SPECS),
    ).astype(int)
    curves = []
    for node, probability in enumerate(probabilities):
        points = []
        for n in grid:
            x = int(round(float(probability) * int(n)))
            lower, upper = _cp_interval(int(n), x, marginal_alpha)
            points.append({"n": int(n), "width": upper - lower})
        curves.append({"node": node, "width_curve": points})
    return selected, curves


def _draw_once(probabilities, sample_sizes, seed):
    children = np.random.SeedSequence(seed).spawn(len(probabilities))
    counts = []
    for probability, n, child in zip(probabilities, sample_sizes, children):
        counts.append(
            int(np.random.default_rng(child).binomial(int(n), float(probability), size=1)[0])
        )
    return counts


def _draw_repeats(probabilities, sample_sizes, seed):
    children = np.random.SeedSequence(seed).spawn(len(probabilities))
    counts = np.empty(
        (params.Q4_SCENARIO_REPEATS, len(probabilities)), dtype=int
    )
    posterior = np.empty_like(counts, dtype=float)
    for j, (probability, n, child) in enumerate(
        zip(probabilities, sample_sizes, children)
    ):
        rng = np.random.default_rng(child)
        counts[:, j] = rng.binomial(
            int(n), float(probability), size=params.Q4_SCENARIO_REPEATS
        )
        posterior[:, j] = rng.beta(
            counts[:, j] + params.Q4_PRIOR_ALPHA,
            int(n) - counts[:, j] + params.Q4_PRIOR_BETA,
        )
    return counts, posterior


def _interval_records(node_names, probabilities, sample_sizes, counts, alpha):
    records = []
    for name, probability, n, x in zip(
        node_names, probabilities, sample_sizes, counts
    ):
        lower, upper = _cp_interval(int(n), int(x), alpha)
        records.append(
            {
                "node": name,
                "n": int(n),
                "x": int(x),
                "scenario_probability": float(probability),
                "p_hat": float(x / n),
                "lower": lower,
                "upper": upper,
                "width": upper - lower,
            }
        )
    return records


def _trace(oracle, counts, posterior, sample_sizes, reference_policy):
    trace = []
    for b, (row, theta) in enumerate(zip(counts, posterior)):
        rates = row / np.asarray(sample_sizes)
        solved = oracle(rates)
        trace.append(
            {
                "repeat": b,
                "x": row.astype(int).tolist(),
                "p_hat": rates.tolist(),
                "jeffreys_theta": theta.tolist(),
                "policy": solved["policy"],
                "profit": float(solved["profit"]),
            }
        )
    reference = json.dumps(_plain(reference_policy), sort_keys=True, default=str)
    matches = np.asarray(
        [
            json.dumps(_plain(row["policy"]), sort_keys=True, default=str) == reference
            for row in trace
        ],
        dtype=float,
    )
    profits = np.asarray([row["profit"] for row in trace], dtype=float)
    cuts = np.linspace(
        0,
        len(trace),
        num=len(params.Q4_SAMPLE_SIZE_GRID) + 1,
        dtype=int,
    )
    convergence = []
    for left, right in zip(cuts[:-1], cuts[1:]):
        convergence.append(
            {
                "start_repeat": int(left),
                "end_repeat": int(right),
                "decision_consistency": float(matches[left:right].mean()),
                "mean_profit": float(profits[left:right].mean()),
            }
        )
    summary = {
        "repeat_count": len(trace),
        "decision_consistency": float(matches.mean()),
        "threshold": params.Q4_CONSISTENCY_THRESHOLD,
        "threshold_met": bool(matches.mean() >= params.Q4_CONSISTENCY_THRESHOLD),
        "profit_mean": float(profits.mean()),
        "profit_standard_deviation": float(profits.std()),
        "profit_minimum": float(profits.min()),
        "profit_maximum": float(profits.max()),
        "convergence": convergence,
        "anti_leakage_note": (
            "This is not a fitted predictive classifier. Every repeat uses only its "
            "own sampled counts, and the production policy is re-optimised before comparison."
        ),
    }
    return trace, summary


def _q2_case(base_case, seed):
    node_names = ("p1", "p2", "pf")
    probabilities = tuple(base_case[name] for name in node_names)
    selected, curves = _precision_design(probabilities, params.Q4_Q2_MARGINAL_ALPHA)
    sample_sizes = tuple(item[0] for item in selected)
    baseline_seed, repeat_seed = np.random.SeedSequence(seed).spawn(2)
    counts = _draw_once(probabilities, sample_sizes, baseline_seed)
    intervals = _interval_records(
        node_names, probabilities, sample_sizes, counts, params.Q4_Q2_MARGINAL_ALPHA
    )
    estimates = tuple(row["p_hat"] for row in intervals)
    estimated_case = {**base_case, **dict(zip(node_names, estimates))}
    true_solution = _q2_oracle(base_case)
    point_solution = _q2_oracle(estimated_case)
    lower_solution = _q2_oracle(
        {**estimated_case, **dict(zip(node_names, (row["lower"] for row in intervals)))}
    )
    upper_solution = _q2_oracle(
        {**estimated_case, **dict(zip(node_names, (row["upper"] for row in intervals)))}
    )
    repeat_counts, posterior = _draw_repeats(
        probabilities, sample_sizes, repeat_seed
    )
    trace, consistency = _trace(
        lambda rates: _q2_oracle({**estimated_case, **dict(zip(node_names, rates))}),
        repeat_counts,
        posterior,
        sample_sizes,
        point_solution["policy"],
    )
    return {
        "case_id": base_case["case_id"],
        "data_status": params.Q4_DATA_MODE,
        "scenario_probabilities": dict(zip(node_names, probabilities)),
        "sample_design": [
            {"node": name, "n": n, "expected_x": x, "lower": lo, "upper": hi}
            for name, (n, x, lo, hi) in zip(node_names, selected)
        ],
        "precision_curves": curves,
        "observed_scenario_sample": intervals,
        "joint_confidence_box": {
            "construction": params.Q4_JOINT_CONSTRUCTION,
            "marginal_alpha": params.Q4_Q2_MARGINAL_ALPHA,
            "lower": [row["lower"] for row in intervals],
            "upper": [row["upper"] for row in intervals],
        },
        "true_scenario_solution": true_solution,
        "point_policy": point_solution["policy"],
        "point_profit": point_solution["profit"],
        "robust_policy": upper_solution["policy"],
        "robust_profit": upper_solution["profit"],
        "profit_interval": {
            "lower_reoptimized": lower_solution["profit"],
            "upper_reoptimized": upper_solution["profit"],
            "scope": "reoptimised optimum range under the Bonferroni box; not a marginal CI",
        },
        "decision_consistency": consistency,
        "scenario_samples": trace,
        "cost_and_loss_fields_used": [
            key for key in base_case if key != "case_id"
        ],
    }


def _q3_case(seed):
    node_names = tuple(params.Q3_NODE_SPECS)
    probabilities = tuple(spec["p"] for spec in params.Q3_NODE_SPECS.values())
    selected, curves = _precision_design(probabilities, params.Q4_Q3_MARGINAL_ALPHA)
    sample_sizes = tuple(item[0] for item in selected)
    baseline_seed, repeat_seed = np.random.SeedSequence(seed).spawn(2)
    counts = _draw_once(probabilities, sample_sizes, baseline_seed)
    intervals = _interval_records(
        node_names, probabilities, sample_sizes, counts, params.Q4_Q3_MARGINAL_ALPHA
    )
    estimates = tuple(row["p_hat"] for row in intervals)
    lower = tuple(row["lower"] for row in intervals)
    upper = tuple(row["upper"] for row in intervals)
    true_solution = _q3_oracle(probabilities)
    point_solution = _q3_oracle(estimates)
    lower_solution = _q3_oracle(lower)
    upper_solution = _q3_oracle(upper)
    repeat_counts, posterior = _draw_repeats(
        probabilities, sample_sizes, repeat_seed
    )
    trace, consistency = _trace(
        _q3_oracle, repeat_counts, posterior, sample_sizes, point_solution["policy"]
    )
    return {
        "topology_status": params.Q3_TOPOLOGY_STATUS,
        "formal_source_graph_available": params.Q3_FORMAL_SOURCE_GRAPH_AVAILABLE,
        "topology": params.Q3_PRIMARY_TOPOLOGY,
        "data_status": params.Q4_DATA_MODE,
        "scenario_probabilities": dict(zip(node_names, probabilities)),
        "sample_design": [
            {"node": name, "n": n, "expected_x": x, "lower": lo, "upper": hi}
            for name, (n, x, lo, hi) in zip(node_names, selected)
        ],
        "precision_curves": curves,
        "observed_scenario_sample": intervals,
        "joint_confidence_box": {
            "construction": params.Q4_JOINT_CONSTRUCTION,
            "marginal_alpha": params.Q4_Q3_MARGINAL_ALPHA,
            "lower": list(lower),
            "upper": list(upper),
        },
        "true_scenario_solution": true_solution,
        "point_policy": point_solution["policy"],
        "point_profit": point_solution["profit"],
        "robust_policy": upper_solution["policy"],
        "robust_profit": upper_solution["profit"],
        "profit_interval": {
            "lower_reoptimized": lower_solution["profit"],
            "upper_reoptimized": upper_solution["profit"],
            "scope": "reoptimised optimum range under the Bonferroni box; not a marginal CI",
        },
        "decision_consistency": consistency,
        "scenario_samples": trace,
    }


def solve():
    seeds = np.random.SeedSequence(params.Q4_RANDOM_SEED).spawn(
        len(params.Q2_CASES) + 1
    )
    q2_cases = [
        _q2_case(case, seed)
        for case, seed in zip(params.Q2_CASES, seeds[:-1])
    ]
    q3 = _q3_case(seeds[-1])
    all_intervals = [
        row
        for case in q2_cases
        for row in case["observed_scenario_sample"]
    ] + q3["observed_scenario_sample"]
    reconstruction_error = max(
        abs(row["p_hat"] - row["x"] / row["n"]) for row in all_intervals
    )
    endpoint_valid = all(
        0 <= row["lower"] <= row["p_hat"] <= row["upper"] <= 1
        for row in all_intervals
    )
    test_n = len(params.Q4_SAMPLE_SIZE_GRID)
    test_x = test_n // 2
    beta_ci = _cp_interval(test_n, test_x, params.Q4_Q3_MARGINAL_ALPHA)
    exact_ci = scipy.stats.binomtest(test_x, test_n).proportion_ci(
        confidence_level=1 - params.Q4_Q3_MARGINAL_ALPHA,
        method="exact",
    )
    cp_exact_error = max(
        abs(beta_ci[0] - exact_ci.low), abs(beta_ci[1] - exact_ci.high)
    )
    q2_joint_error = max(
        0.0,
        params.Q2_PARAMETER_COUNT * params.Q4_Q2_MARGINAL_ALPHA
        - params.Q4_FAMILY_ALPHA,
    )
    q3_joint_error = max(
        0.0,
        params.Q3_PARAMETER_COUNT * params.Q4_Q3_MARGINAL_ALPHA
        - params.Q4_FAMILY_ALPHA,
    )
    monotonicity_violation = max(
        [0.0]
        + [
            max(0.0, case["robust_profit"] - case["profit_interval"]["lower_reoptimized"])
            for case in q2_cases
        ]
        + [
            max(
                0.0,
                q3["robust_profit"] - q3["profit_interval"]["lower_reoptimized"],
            )
        ]
    )
    checks = {
        "sample_ledger_reconstructs_p_hat": reconstruction_error <= params.Q4_NUMERIC_TOL,
        "all_cp_endpoints_ordered": endpoint_valid,
        "cp_matches_exact_binomial_inversion": cp_exact_error <= params.Q4_NUMERIC_TOL,
        "q2_bonferroni_sum_not_exceeded": q2_joint_error <= params.Q4_NUMERIC_TOL,
        "q3_bonferroni_sum_not_exceeded": q3_joint_error <= params.Q4_NUMERIC_TOL,
        "profit_box_monotonicity": monotonicity_violation <= params.CASHFLOW_ABS_TOL,
        "q3_parameter_count_registered": len(all_intervals) - len(q2_cases) * len(
            params.Q2_CASES[0]
        ) + len(params.Q2_CASES[0]) == params.Q3_PARAMETER_COUNT + len(
            q2_cases
        ) * len(params.Q2_CASES[0]) - len(params.Q2_CASES[0]) * len(q2_cases),
    }
    validation = {
        "checks": checks,
        "all_checks_passed": all(checks.values()),
        "max_sample_reconstruction_error": float(reconstruction_error),
        "cp_boundary_and_exact_inversion_max_error": float(cp_exact_error),
        "q2_bonferroni_sum": params.Q2_PARAMETER_COUNT * params.Q4_Q2_MARGINAL_ALPHA,
        "q3_bonferroni_sum": params.Q3_PARAMETER_COUNT * params.Q4_Q3_MARGINAL_ALPHA,
        "profit_monotonicity_max_violation": float(monotonicity_violation),
    }
    if not validation["all_checks_passed"]:
        raise AssertionError(json.dumps(validation, ensure_ascii=False))
    return {
        "problem": "Q4",
        "data_status": params.Q4_DATA_MODE,
        "observed_data_warning": (
            "No real batch observations were supplied. Every (n, x) below is an auditable "
            "scenario draw generated from the registered scenario rates."
        ),
        "methods": {
            "sample_size": "per-node CP expected-width precision design; Q1 n is not reused",
            "interval": params.Q4_CI_METHOD,
            "joint_domain": params.Q4_JOINT_CONSTRUCTION,
            "resampling": params.Q4_RESAMPLING_PRIOR,
            "point_estimate": "x/n from the baseline scenario sample, never the scenario rate",
            "scenario_reoptimisation": "oracle reoptimisation for every sampled rate vector",
        },
        "q2": {
            "cases": q2_cases,
            "mean_decision_consistency": float(
                np.mean([case["decision_consistency"]["decision_consistency"] for case in q2_cases])
            ),
        },
        "q3": q3,
        "validation": validation,
    }


def run():
    return solve()
]<]minimax[>[</content>]<]minimax[>[</invoke>
]<]minimax[>[</tool_call>