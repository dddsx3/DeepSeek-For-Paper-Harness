from __future__ import annotations

import inspect
import itertools
import json
import math
from collections import Counter
from pathlib import Path

import numpy as np
from scipy import stats

from params import *

import problem2 as _problem2
import problem3 as _problem3


DEFAULT_RESULT_FILE = "problem4_results.json"
_Q2_STRATEGIES = tuple(
    itertools.product((0, 1), repeat=len(Q2_DECISION_NAMES))
)


def _jsonable(value):
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def _write_json(payload, output_path):
    path = Path(output_path)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(_jsonable(payload), ensure_ascii=False, indent=2, allow_nan=False),
        encoding="utf-8",
    )
    temporary.replace(path)


def _find_number_by_keys(value, keys):
    if isinstance(value, dict):
        for key in keys:
            item = value.get(key)
            if isinstance(item, (int, float, np.number)) and not isinstance(item, bool):
                result = float(item)
                if math.isfinite(result):
                    return result
        for key in ("result", "bellman", "renewal", "event", "evaluation", "closed_form"):
            if key in value:
                found = _find_number_by_keys(value[key], keys)
                if found is not None:
                    return found
    if isinstance(value, (list, tuple)):
        for item in value:
            found = _find_number_by_keys(item, keys)
            if found is not None:
                return found
    return None


class ClopperPearsonBoundary:
    """Two-sided exact binomial interval with explicit endpoint branches."""

    def __init__(self, alpha):
        self.alpha = validate_probability(alpha, "CP marginal error")
        _require_condition(self.alpha > 0.0, "CP marginal error must be positive")
        self.tail_probability = self.alpha / 2.0
        self._expected_cache = {}
        self._design_cache = {}

    def interval(self, n, x):
        if isinstance(n, bool) or int(n) != n or n <= 0:
            raise ValueError("CP sample size must be a positive integer")
        if isinstance(x, bool) or int(x) != x or x < 0 or x > n:
            raise ValueError("CP defective count must be an integer in [0,n]")
        n = int(n)
        x = int(x)
        if x == 0:
            lower = 0.0
            upper = (1.0 - self.tail_probability) ** (1.0 / n)
        elif x == n:
            lower = self.tail_probability ** (1.0 / n)
            upper = 1.0
        else:
            lower = float(
                stats.beta.ppf(self.tail_probability, x, n - x + 1)
            )
            upper = float(
                stats.beta.ppf(1.0 - self.tail_probability, x + 1, n - x)
            )
        _require_condition(
            0.0 <= lower <= upper <= 1.0,
            "CP interval left the probability domain",
        )
        return float(lower), float(upper)

    def expected_width(self, n, scenario_rate):
        n = int(n)
        scenario_rate = validate_probability(scenario_rate, "CP design rate")
        cache_key = (n, scenario_rate, self.alpha)
        if cache_key in self._expected_cache:
            return self._expected_cache[cache_key]
        counts = np.arange(n + 1)
        probabilities = stats.binom.pmf(counts, n, scenario_rate)
        widths = np.empty(n + 1, dtype=float)
        for x in counts:
            lower, upper = self.interval(n, int(x))
            widths[int(x)] = upper - lower
        expected = float(np.dot(probabilities, widths))
        _require_condition(expected >= 0.0, "CP expected width is negative")
        self._expected_cache[cache_key] = expected
        return expected

    def minimum_design(self, scenario_rate, target_halfwidth):
        scenario_rate = validate_probability(scenario_rate, "CP design rate")
        target_halfwidth = validate_probability(
            target_halfwidth, "CP target half-width"
        )
        cache_key = (scenario_rate, target_halfwidth)
        if cache_key in self._design_cache:
            return dict(self._design_cache[cache_key])
        minimum_n = None
        next_n = None
        for n in range(1, INTEGER_SEARCH_CAP + 1):
            width = self.expected_width(n, scenario_rate)
            if width <= target_halfwidth + PROBABILITY_ABS_TOL:
                minimum_n = n
                break
        _require_condition(
            minimum_n is not None,
            "no CP sample size satisfies the registered precision target",
        )
        minimum_width = self.expected_width(minimum_n, scenario_rate)
        for n in range(minimum_n + 1, INTEGER_SEARCH_CAP + 1):
            width = self.expected_width(n, scenario_rate)
            if width <= target_halfwidth + PROBABILITY_ABS_TOL:
                next_n = n
                break
        _require_condition(next_n is not None, "the next feasible CP design is missing")
        next_width = self.expected_width(next_n, scenario_rate)
        _require_condition(
            next_width <= minimum_width + PROBABILITY_ABS_TOL,
            "the next feasible CP design is wider than the minimum design",
        )
        design = {
            "n": int(minimum_n),
            "expected_width": float(minimum_width),
            "next_feasible_n": int(next_n),
            "next_feasible_expected_width": float(next_width),
        }
        self._design_cache[cache_key] = dict(design)
        return design

    def width_curve(self, minimum_n, point_count):
        return [
            {
                "n": int(minimum_n + offset),
                "expected_width": self.expected_width(
                    minimum_n + offset, point_count / minimum_n
                ),
            }
            for offset in range(Q3_TOTAL_NODE_COUNT_CONDITIONAL)
        ]


class BonferroniJointRegion:
    """Cartesian CP region whose reported coverage is only a lower bound."""

    def __init__(self, joint_confidence, node_count):
        self.joint_confidence = validate_probability(
            joint_confidence, "joint confidence"
        )
        if isinstance(node_count, bool) or int(node_count) != node_count or node_count <= 0:
            raise ValueError("Bonferroni node count must be a positive integer")
        self.node_count = int(node_count)
        self.alpha_node = self.joint_confidence / self.node_count
        self.coverage_lower_bound = 1.0 - self.node_count * self.alpha_node
        _require_condition(
            abs(self.alpha_node - self.joint_confidence / self.node_count)
            <= PROBABILITY_ABS_TOL,
            "Bonferroni marginal error is inconsistent",
        )
        _require_condition(
            self.coverage_lower_bound
            >= self.joint_confidence - PROBABILITY_ABS_TOL,
            "Bonferroni coverage lower bound is inconsistent",
        )

    @classmethod
    def from_intervals(cls, joint_confidence, intervals):
        instance = cls(joint_confidence, len(intervals))
        instance.intervals = tuple((float(lo), float(hi)) for lo, hi in intervals)
        for lower, upper in instance.intervals:
            _require_condition(
                0.0 <= lower <= upper <= 1.0,
                "Bonferroni interval left the probability domain",
            )
        instance.upper_rates = tuple(upper for _, upper in instance.intervals)
        return instance


class MonteCarloPolicyStability:
    """Fixed-budget resampling centered on observed synthetic point estimates."""

    def __init__(self, generator, repetitions=Q4_MONTE_CARLO_REPETITIONS):
        self.generator = generator
        self.repetitions = int(repetitions)
        _require_condition(self.repetitions > 0, "Monte Carlo budget must be positive")

    def draw(self, sample_sizes, centers):
        centers = tuple(float(value) for value in centers)
        _require_condition(
            len(sample_sizes) == len(centers),
            "Monte Carlo sample sizes and centers have different lengths",
        )
        for center in centers:
            validate_probability(center, "Monte Carlo sampling center")
        return self.generator.binomial(tuple(sample_sizes), centers).astype(int)

    @staticmethod
    def summarize(records, reference_signature):
        total = len(records)
        flips = sum(bool(record["point_flip"]) for record in records)
        robust_flips = sum(bool(record["robust_flip"]) for record in records)
        convergence = []
        cumulative_point = 0
        cumulative_robust = 0
        for record in records:
            cumulative_point += int(bool(record["point_flip"]))
            cumulative_robust += int(bool(record["robust_flip"]))
            convergence.append(
                {
                    "repetition": record["repetition"],
                    "cumulative_point_flip_rate": cumulative_point / record["repetition"],
                    "cumulative_robust_flip_rate": (
                        cumulative_robust / record["repetition"]
                    ),
                }
            )
        point_counts = Counter(record["point_strategy"] for record in records)
        robust_counts = Counter(record["robust_strategy"] for record in records)
        return {
            "repetitions": total,
            "reference_point_strategy": reference_signature,
            "point_flip_count": int(flips),
            "point_flip_rate": float(flips / total),
            "robust_flip_count": int(robust_flips),
            "robust_flip_rate": float(robust_flips / total),
            "point_strategy_frequencies": dict(sorted(point_counts.items())),
            "robust_strategy_frequencies": dict(sorted(robust_counts.items())),
            "convergence": convergence,
        }


def _q2_rate_vector(rates):
    return tuple(
        validate_probability(rates[node_id], f"Q2 rate {node_id}")
        for node_id in Q2_RATE_NODE_IDS
    )


def _q2_strategy_label(strategy):
    return tuple(int(flag) for flag in strategy)


def _q2_fast_profit(case, strategy):
    z1, z2, inspect_finished, disassemble = _q2_strategy_label(strategy)
    q1 = 1.0 - case["p_part1"]
    q2 = 1.0 - case["p_part2"]
    if (z1 and q1 <= 0.0) or (z2 and q2 <= 0.0):
        return None
    screened_preparation = 0.0
    conditional_preparation = 0.0
    for inspect, quality, purchase, inspection in (
        (z1, q1, case["purchase_part1"], case["inspection_part1"]),
        (z2, q2, case["purchase_part2"], case["inspection_part2"]),
    ):
        if inspect:
            screened_preparation += (purchase + inspection) / quality
        conditional_preparation += purchase / quality
    assembly_good = 1.0 - case["p_finished"]
    attempt_good = assembly_good
    if not z1:
        attempt_good *= q1
    if not z2:
        attempt_good *= q2
    if attempt_good <= 0.0:
        return None
    if disassemble:
        preparation = screened_preparation + sum(
            inspection / quality
            for inspect, quality, inspection in (
                (z1, q1, case["inspection_part1"]),
                (z2, q2, case["inspection_part2"]),
            )
            if inspect
        )
        for inspect, quality, purchase in (
            (z1, q1, case["purchase_part1"]),
            (z2, q2, case["purchase_part2"]),
        ):
            if not inspect:
                preparation += purchase / quality
        cycle_cost = case["assembly_cost"] + case["disassembly_cost"]
        if inspect_finished:
            cycle_cost += case["finished_inspection_cost"]
        else:
            cycle_cost += case["exchange_loss"]
        cost = preparation + cycle_cost / assembly_good
    else:
        attempt_cost = case["assembly_cost"] + conditional_preparation
        if inspect_finished:
            attempt_cost += case["finished_inspection_cost"]
        else:
            attempt_cost += (1.0 - attempt_good) * case["exchange_loss"]
        cost = attempt_cost / attempt_good
    return float(case["sale_price"] - cost)


def _q2_existing_profit(case, strategy):
    function = _problem2.evaluate_strategy
    signature = inspect.signature(function)
    names = tuple(signature.parameters)
    strategy_first = bool(names) and any(
        "strategy" in name.lower() or "policy" in name.lower() for name in names[0]
    )
    strategy_variants = (tuple(strategy), strategy_mapping(strategy))
    attempts = []
    if strategy_first:
        for policy in strategy_variants:
            attempts.append((policy, case))
    else:
        for policy in strategy_variants:
            attempts.append((case, policy))
    if strategy_first:
        for policy in strategy_variants:
            attempts.append((case, policy))
    else:
        for policy in strategy_variants:
            attempts.append((policy, case))
    last_error = None
    for arguments in attempts:
        try:
            raw = function(*arguments)
        except Exception as exc:
            last_error = exc
            continue
        profit = _find_number_by_keys(
            raw,
            ("profit_per_good", "profit_serv", "unit_profit", "profit"),
        )
        if profit is not None:
            return float(profit)
    if last_error is not None:
        raise last_error
    raise ValueError("problem2 evaluator returned no auditable unit profit")


def _verify_q2_engine(cases):
    maximum_gap = 0.0
    comparable = 0
    for case in cases:
        for strategy in _Q2_STRATEGIES:
            fast = _q2_fast_profit(case, strategy)
            reference = _q2_existing_profit(case, strategy)
            if fast is None or reference is None:
                _require_condition(
                    fast is None and reference is None,
                    "Q2 infeasible-policy classification differs between engines",
                )
                continue
            gap = abs(fast - reference)
            maximum_gap = max(maximum_gap, gap)
            comparable += 1
            _require_condition(
                gap <= CASHFLOW_ABS_TOL_YUAN,
                "Q4 fast cashflow engine differs from problem2 event ledger",
            )
    _require_condition(comparable > 0, "Q2 engine comparison had no finite policies")
    return maximum_gap


def _q2_profit_table(case, use_reference_engine):
    table = {}
    for strategy in _Q2_STRATEGIES:
        profit = (
            _q2_existing_profit(case, strategy)
            if use_reference_engine
            else _q2_fast_profit(case, strategy)
        )
        table[_q2_strategy_label(strategy)] = profit
    return table


def _select_q2_strategy(profit_table):
    finite = {
        strategy: float(profit)
        for strategy, profit in profit_table.items()
        if profit is not None and math.isfinite(float(profit))
    }
    _require_condition(bool(finite), "Q2 has no finite policy")
    best_profit = max(finite.values())
    tolerance = CASHFLOW_ABS_TOL_YUAN
    tied = sorted(
        strategy for strategy, profit in finite.items()
        if best_profit - profit <= tolerance
    )
    return tied[0], best_profit, tied


def _q2_case_with_vector(base_case, rate_vector):
    case = q2_case(base_case["case_id"])
    case["p_part1"] = float(rate_vector[0])
    case["p_part2"] = float(rate_vector[1])
    case["p_finished"] = float(rate_vector[2])
    case["p1"] = case["p_part1"]
    case["p2"] = case["p_part2"]
    case["r"] = case["p_finished"]
    validate_case_inputs(case)
    return case


def _q2_interval_records(cp, sample_sizes, counts):
    intervals = []
    for node_id, n, x in zip(Q2_RATE_NODE_IDS, sample_sizes, counts):
        lower, upper = cp.interval(n, x)
        intervals.append((node_id, lower, upper))
    return intervals


def _q2_upper_monotonicity(case, lower_rates, upper_rates):
    lower_case = _q2_case_with_vector(case, lower_rates)
    upper_case = _q2_case_with_vector(case, upper_rates)
    maximum_violation = 0.0
    for strategy in _Q2_STRATEGIES:
        lower_profit = _q2_fast_profit(lower_case, strategy)
        upper_profit = _q2_fast_profit(upper_case, strategy)
        if lower_profit is not None and upper_profit is not None:
            maximum_violation = max(
                maximum_violation, upper_profit - lower_profit
            )
    _require_condition(
        maximum_violation <= CASHFLOW_ABS_TOL_YUAN,
        "Q2 fixed-policy profit is not monotone in defect rates",
    )
    return maximum_violation


def _q3_rate_map(rate_vector):
    _require_condition(
        len(rate_vector) == Q3_RATE_NODE_COUNT,
        "H1 rate vector has the wrong length",
    )
    return {
        node_id: validate_probability(rate, f"H1 rate {node_id}")
        for node_id, rate in zip(Q3_RATE_NODE_IDS, rate_vector)
    }


def _q3_call(function, context, rates=None):
    signature = inspect.signature(function)
    keyword = {}
    positional = []
    for name, parameter in signature.parameters.items():
        lowered = name.lower()
        if "context" in lowered:
            value = context
        elif "rate" in lowered:
            value = rates
        elif "node_order" in lowered:
            value = Q3_NODE_ORDER
        elif "cache" in lowered:
            value = {}
        elif parameter.default is inspect.Parameter.empty:
            raise TypeError(f"unsupported required q3 argument: {name}")
        else:
            continue
        if parameter.kind is inspect.Parameter.KEYWORD_ONLY:
            keyword[name] = value
        else:
            positional.append(value)
    return function(*positional, **keyword)


def _q3_policy_from_mapping(value):
    if not isinstance(value, dict) or set(value) != set(Q3_NODE_ORDER):
        return None
    policy = {}
    inspection_keys = ("inspect", "inspection", "is_inspected", "z", "test")
    disassembly_keys = ("disassemble", "disassembly", "is_disassembled", "d")
    for node_id in Q3_NODE_ORDER:
        decision = value[node_id]
        if isinstance(decision, dict):
            inspect = next(
                (decision[key] for key in inspection_keys if key in decision), None
            )
            disassemble = next(
                (decision[key] for key in disassembly_keys if key in decision), None
            )
        elif isinstance(decision, (list, tuple)) and len(decision) == len(Q2_DECISION_NAMES[:2]):
            inspect, disassemble = decision
        else:
            return None
        if inspect not in (0, 1, False, True) or disassemble not in (
            0, 1, False, True
        ):
            return None
        policy[node_id] = {
            "inspect": bool(inspect),
            "disassemble": bool(disassemble),
        }
    return policy


def _q3_policy_from_sequence(value):
    if not isinstance(value, (list, tuple)):
        return None
    if (
        len(value) == Q3_TOTAL_NODE_COUNT_CONDITIONAL
        and all(
            isinstance(item, (list, tuple))
            and len(item) == len(Q2_DECISION_NAMES[:2])
            and all(flag in (0, 1, False, True) for flag in item)
            for item in value
        )
    ):
        return {
            node_id: {"inspect": bool(value[index][0]), "disassemble": bool(value[index][1])}
            for index, node_id in enumerate(Q3_NODE_ORDER)
        }
    if (
        len(value) == Q3_DECISION_SPACE_SIZE
        and all(flag in (0, 1, False, True) for flag in value)
    ):
        return {
            node_id: {
                "inspect": bool(value[index * 2]),
                "disassemble": bool(value[index * 2 + 1]),
            }
            for index, node_id in enumerate(Q3_NODE_ORDER)
        }
    return None


def _looks_like_q3_policy(value):
    return _q3_policy_from_mapping(value) is not None or _q3_policy_from_sequence(value) is not None


def _extract_q3_policy(value, visited=None):
    direct = _q3_policy_from_mapping(value)
    if direct is not None:
        return direct
    direct = _q3_policy_from_sequence(value)
    if direct is not None:
        return direct
    if visited is None:
        visited = set()
    marker = id(value)
    if marker in visited:
        return None
    visited.add(marker)
    if isinstance(value, dict):
        priority = (
            "selected_policy",
            "policy",
            "node_decisions",
            "decisions",
            "selected",
            "strategy",
            "result",
            "evaluation",
        )
        for key in priority:
            if key in value:
                found = _extract_q3_policy(value[key], visited)
                if found is not None:
                    return found
        for item in value.values():
            found = _extract_q3_policy(item, visited)
            if found is not None:
                return found
    elif isinstance(value, (list, tuple)):
        for item in value:
            found = _extract_q3_policy(item, visited)
            if found is not None:
                return found
    return None


def _q3_existing_profit(policy, context):
    function = _problem3.evaluate_policy
    signature = inspect.signature(function)
    names = tuple(signature.parameters)
    policy_first = bool(names) and any(
        "policy" in name.lower() or "decision" in name.lower() for name in names[0]
    )
    attempts = []
    if policy_first:
        attempts.extend(((policy, context), (context, policy)))
    else:
        attempts.extend(((context, policy), (policy, context)))
    last_error = None
    for arguments in attempts:
        try:
            raw = function(*arguments)
        except Exception as exc:
            last_error = exc
            continue
        profit = _find_number_by_keys(
            raw,
            ("profit_per_good", "unit_profit", "best_profit", "profit"),
        )
        if profit is not None:
            return float(profit)
    if last_error is not None:
        raise last_error
    raise ValueError("problem3 evaluator returned no auditable unit profit")


def _q3_optimise(rate_vector):
    rates = _q3_rate_map(rate_vector)
    context = _problem3.build_h1_context(rates)
    candidates = (
        getattr(_problem3, "_optimise_context", None),
        getattr(_problem3, "solve_case_policy", None),
    )
    last_error = None
    for function in candidates:
        if function is None:
            continue
        try:
            raw = _q3_call(function, context, rates)
            policy = _extract_q3_policy(raw)
            if policy is None:
                continue
            profit = _find_number_by_keys(
                raw,
                ("profit_per_good", "unit_profit", "best_profit", "profit"),
            )
            if profit is None:
                profit = _q3_existing_profit(policy, context)
            return policy, float(profit)
        except Exception as exc:
            last_error = exc
    if last_error is not None:
        raise last_error
    raise ValueError("problem3 optimizer returned no complete node policy")


def _policy_signature(policy):
    return json.dumps(policy, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _q3_interval_records(cp, sample_sizes, counts):
    records = []
    for node_id, n, x in zip(Q3_RATE_NODE_IDS, sample_sizes, counts):
        lower, upper = cp.interval(n, x)
        records.append(
            {
                "node_id": node_id,
                "n": int(n),
                "x": int(x),
                "interval": [float(lower), float(upper)],
            }
        )
    return records


def _initial_design_rows(cp_q2, cp_q3, cases, rng):
    q2_designs = []
    q3_designs = []
    for case in cases:
        scenario_vector = (
            case["p_part1"],
            case["p_part2"],
            case["p_finished"],
        )
        for node_id, scenario_rate in zip(Q2_RATE_NODE_IDS, scenario_vector):
            design = cp_q2.minimum_design(
                scenario_rate, Q4_TARGET_CP_HALFWIDTH
            )
            x = int(rng.binomial(design["n"], scenario_rate))
            p_hat = x / design["n"]
            interval = cp_q2.interval(design["n"], x)
            curve = [
                {
                    "n": int(design["n"] + offset),
                    "expected_width": cp_q2.expected_width(
                        design["n"] + offset, p_hat
                    ),
                }
                for offset in range(Q3_TOTAL_NODE_COUNT_CONDITIONAL)
            ]
            q2_designs.append(
                {
                    "system": "q2",
                    "case_id": case["case_id"],
                    "node_id": node_id,
                    "scenario_rate": float(scenario_rate),
                    "n": design["n"],
                    "x": x,
                    "p_hat": p_hat,
                    "sampling_center": p_hat,
                    "interval": list(interval),
                    "expected_width": design["expected_width"],
                    "target_halfwidth": Q4_TARGET_CP_HALFWIDTH,
                    "next_feasible_n": design["next_feasible_n"],
                    "next_feasible_expected_width": design[
                        "next_feasible_expected_width"
                    ],
                    "neighbor_widths": {
                        "minimum_n": design["n"],
                        "minimum_expected_width": design["expected_width"],
                        "next_n": design["next_feasible_n"],
                        "next_expected_width": design[
                            "next_feasible_expected_width"
                        ],
                    },
                    "width_curve": curve,
                }
            )
    for node_id in Q3_RATE_NODE_IDS:
        scenario_rate = _problem3.q3_node(node_id)["p"]
        design = cp_q3.minimum_design(scenario_rate, Q4_TARGET_CP_HALFWIDTH)
        x = int(rng.binomial(design["n"], scenario_rate))
        p_hat = x / design["n"]
        interval = cp_q3.interval(design["n"], x)
        curve = [
            {
                "n": int(design["n"] + offset),
                "expected_width": cp_q3.expected_width(
                    design["n"] + offset, p_hat
                ),
            }
            for offset in range(Q3_TOTAL_NODE_COUNT_CONDITIONAL)
        ]
        q3_designs.append(
            {
                "system": "q3_h1_conditional",
                "topology_label": CONDITIONAL_H1_LABEL,
                "node_id": node_id,
                "scenario_rate": float(scenario_rate),
                "n": design["n"],
                "x": x,
                "p_hat": p_hat,
                "sampling_center": p_hat,
                "interval": list(interval),
                "expected_width": design["expected_width"],
                "target_halfwidth": Q4_TARGET_CP_HALFWIDTH,
                "next_feasible_n": design["next_feasible_n"],
                "next_feasible_expected_width": design[
                    "next_feasible_expected_width"
                ],
                "neighbor_widths": {
                    "minimum_n": design["n"],
                    "minimum_expected_width": design["expected_width"],
                    "next_n": design["next_feasible_n"],
                    "next_expected_width": design[
                        "next_feasible_expected_width"
                    ],
                },
                "width_curve": curve,
            }
        )
    return q2_designs, q3_designs


def _scenario_design_sensitivity(cp_q2, cp_q3, q2_designs, q3_designs):
    rows = []
    for design in q2_designs + q3_designs:
        cp = cp_q2 if design["system"] == "q2" else cp_q3
        base_rate = design["scenario_rate"]
        for shift in SENSITIVITY_DEFECT_RATES:
            scenario_rate = min(1.0, max(0.0, base_rate + shift))
            sensitivity_design = cp.minimum_design(
                scenario_rate, Q4_TARGET_CP_HALFWIDTH
            )
            nominal_x = int(round(scenario_rate * sensitivity_design["n"]))
            interval = cp.interval(sensitivity_design["n"], nominal_x)
            rows.append(
                {
                    "system": design["system"],
                    "case_id": design.get("case_id"),
                    "node_id": design["node_id"],
                    "topology_label": design.get("topology_label"),
                    "scenario_rate_shift": shift,
                    "scenario_rate_for_design": scenario_rate,
                    "n": sensitivity_design["n"],
                    "expected_width_at_design_rate": sensitivity_design[
                        "expected_width"
                    ],
                    "nominal_count": nominal_x,
                    "nominal_count_interval": list(interval),
                    "label": "conditional_sample_design_sensitivity_not_observed_data",
                }
            )
    return rows


def _q2_monte_carlo(cases, q2_designs, cp_q2, rng, use_reference_engine):
    design_index = {
        (row["case_id"], row["node_id"]): row for row in q2_designs
    }
    sampler = MonteCarloPolicyStability(rng)
    outputs = []
    for case in cases:
        designs = [
            design_index[(case["case_id"], node_id)]
            for node_id in Q2_RATE_NODE_IDS
        ]
        sample_sizes = tuple(row["n"] for row in designs)
        initial_counts = tuple(row["x"] for row in designs)
        initial_centers = tuple(row["p_hat"] for row in designs)
        initial_intervals = _q2_interval_records(
            cp_q2, sample_sizes, initial_counts
        )
        initial_rates = tuple(interval[2] for interval in initial_intervals)
        lower_rates = tuple(interval[1] for interval in initial_intervals)
        point_table = _q2_profit_table(
            _q2_case_with_vector(case, initial_centers), use_reference_engine
        )
        robust_table = _q2_profit_table(
            _q2_case_with_vector(case, initial_rates), use_reference_engine
        )
        point_strategy, point_profit, point_ties = _select_q2_strategy(point_table)
        robust_strategy, robust_profit, robust_ties = _select_q2_strategy(robust_table)
        monotonicity_gap = _q2_upper_monotonicity(case, lower_rates, initial_rates)
        records = []
        point_reference = _policy_signature(point_strategy)
        robust_reference = _policy_signature(robust_strategy)
        for repetition in range(1, Q4_MONTE_CARLO_REPETITIONS + 1):
            counts = tuple(int(value) for value in sampler.draw(sample_sizes, initial_centers))
            p_hat = tuple(x / n for x, n in zip(counts, sample_sizes))
            interval_rows = _q2_interval_records(cp_q2, sample_sizes, counts)
            upper_rates = tuple(row[2] for row in interval_rows)
            sample_point = _select_q2_strategy(
                _q2_profit_table(
                    _q2_case_with_vector(case, p_hat), use_reference_engine
                )
            )
            sample_robust = _select_q2_strategy(
                _q2_profit_table(
                    _q2_case_with_vector(case, upper_rates), use_reference_engine
                )
            )
            records.append(
                {
                    "repetition": repetition,
                    "counts": list(counts),
                    "p_hat": list(p_hat),
                    "sampling_center": list(initial_centers),
                    "cp_intervals": [
                        {"node_id": node_id, "interval": list(interval)}
                        for node_id, _, interval in zip(
                            Q2_RATE_NODE_IDS,
                            sample_sizes,
                            interval_rows,
                        )
                    ],
                    "point_strategy": _policy_signature(sample_point[0]),
                    "robust_strategy": _policy_signature(sample_robust[0]),
                    "point_profit": sample_point[1],
                    "robust_worst_profit": sample_robust[1],
                    "point_flip": _policy_signature(sample_point[0]) != point_reference,
                    "robust_flip": (
                        _policy_signature(sample_robust[0]) != robust_reference
                    ),
                }
            )
        stability = sampler.summarize(records, point_reference)
        outputs.append(
            {
                "case_id": case["case_id"],
                "synthetic_scenario": True,
                "initial_counts": {
                    node_id: int(x)
                    for node_id, x in zip(Q2_RATE_NODE_IDS, initial_counts)
                },
                "initial_point_estimates": {
                    node_id: float(rate)
                    for node_id, rate in zip(Q2_RATE_NODE_IDS, initial_centers)
                },
                "initial_cp_intervals": [
                    {"node_id": node_id, "interval": list(interval)}
                    for node_id, _, interval in zip(
                        Q2_RATE_NODE_IDS, sample_sizes, initial_intervals
                    )
                ],
                "point_strategy": list(point_strategy),
                "point_profit": point_profit,
                "point_tied_strategies": [list(item) for item in point_ties],
                "robust_strategy": list(robust_strategy),
                "robust_worst_profit": robust_profit,
                "robust_tied_strategies": [list(item) for item in robust_ties],
                "monotonicity_upper_endpoint_max_violation_yuan": monotonicity_gap,
                "flip_rate": stability["point_flip_rate"],
                "robust_flip_rate": stability["robust_flip_rate"],
                "stability": stability,
                "records": records,
                "all_strategies": [
                    {
                        "strategy": list(strategy),
                        "profit_per_good": profit,
                        "feasible": profit is not None,
                    }
                    for strategy, profit in sorted(point_table.items())
                ],
            }
        )
    return outputs


def _q3_monotonicity_probe(policy, point_rates, context_builder=_problem3.build_h1_context):
    maximum_violation = 0.0
    for index, node_id in enumerate(Q3_RATE_NODE_IDS):
        lower_vector = list(point_rates)
        upper_vector = list(point_rates)
        lower_vector[index] = max(
            0.0, point_rates[index] - SENSITIVITY_DEFECT_OFFSET_ABS
        )
        upper_vector[index] = min(
            1.0, point_rates[index] + SENSITIVITY_DEFECT_OFFSET_ABS
        )
        lower_context = _q3_call(context_builder, _q3_rate_map(lower_vector))
        upper_context = _q3_call(context_builder, _q3_rate_map(upper_vector))
        lower_profit = _q3_existing_profit(policy, lower_context)
        upper_profit = _q3_existing_profit(policy, upper_context)
        maximum_violation = max(
            maximum_violation, upper_profit - lower_profit
        )
    _require_condition(
        maximum_violation <= CASHFLOW_ABS_TOL_YUAN,
        "H1 fixed-policy profit is not monotone in a defect rate",
    )
    return maximum_violation


def _q3_monte_carlo(q3_designs, cp_q3, rng):
    sampler = MonteCarloPolicyStability(rng)
    sample_sizes = tuple(row["n"] for row in q3_designs)
    initial_counts = tuple(row["x"] for row in q3_designs)
    initial_centers = tuple(row["p_hat"] for row in q3_designs)
    initial_intervals = _q3_interval_records(cp_q3, sample_sizes, initial_counts)
    point_rates = tuple(row[2] for row in initial_intervals)
    upper_rates = tuple(row[2] for row in initial_intervals)
    point_policy, point_profit = _q3_optimise(point_rates)
    robust_policy, robust_profit = _q3_optimise(upper_rates)
    point_reference = _policy_signature(point_policy)
    robust_reference = _policy_signature(robust_policy)
    registry = {
        point_reference: "P1",
        robust_reference: "P2" if robust_reference != point_reference else "P1",
    }
    if robust_reference not in registry:
        registry[robust_reference] = "P2"

    def register(policy):
        signature = _policy_signature(policy)
        if signature not in registry:
            registry[signature] = "P" + str(len(registry) + 1)
        return registry[signature], signature

    point_id, point_reference = register(point_policy)
    robust_id, robust_reference = register(robust_policy)
    monotonicity_gap = _q3_monotonicity_probe(point_policy, point_rates)
    records = []
    optimizer_cache = {}
    for repetition in range(1, Q4_MONTE_CARLO_REPETITIONS + 1):
        counts = tuple(
            int(value) for value in sampler.draw(sample_sizes, initial_centers)
        )
        p_hat = tuple(x / n for x, n in zip(counts, sample_sizes))
        interval_rows = _q3_interval_records(cp_q3, sample_sizes, counts)
        sampled_upper = tuple(row["interval"][1] for row in interval_rows)
        point_key = tuple(p_hat)
        upper_key = tuple(sampled_upper)
        if point_key not in optimizer_cache:
            optimizer_cache[point_key] = _q3_optimise(point_key)
        if upper_key not in optimizer_cache:
            optimizer_cache[upper_key] = _q3_optimise(upper_key)
        sample_point_policy, sample_point_profit = optimizer_cache[point_key]
        sample_robust_policy, sample_robust_profit = optimizer_cache[upper_key]
        point_sample_id, point_sample_signature = register(sample_point_policy)
        robust_sample_id, robust_sample_signature = register(sample_robust_policy)
        records.append(
            {
                "repetition": repetition,
                "counts": list(counts),
                "p_hat": list(p_hat),
                "sampling_center": list(initial_centers),
                "cp_intervals": interval_rows,
                "point_strategy": point_sample_id,
                "robust_strategy": robust_sample_id,
                "point_profit": sample_point_profit,
                "robust_worst_profit": sample_robust_profit,
                "point_flip": point_sample_signature != point_reference,
                "robust_flip": robust_sample_signature != robust_reference,
            }
        )
    stability = sampler.summarize(records, point_id)
    return {
        "topology_label": CONDITIONAL_H1_LABEL,
        "claim_status": "conditional_not_original_figure_fact",
        "synthetic_scenario": True,
        "initial_counts": {
            row["node_id"]: int(row["x"]) for row in q3_designs
        },
        "initial_point_estimates": {
            row["node_id"]: float(row["p_hat"]) for row in q3_designs
        },
        "initial_cp_intervals": initial_intervals,
        "point_strategy_id": point_id,
        "point_strategy": point_policy,
        "point_profit": point_profit,
        "robust_strategy_id": robust_id,
        "robust_strategy": robust_policy,
        "robust_worst_profit": robust_profit,
        "flip_rate": stability["point_flip_rate"],
        "robust_flip_rate": stability["robust_flip_rate"],
        "monotonicity_upper_endpoint_max_violation_yuan": monotonicity_gap,
        "strategy_registry": [
            {"strategy_id": strategy_id, "node_decisions": json.loads(signature)}
            for signature, strategy_id in registry.items()
        ],
        "stability": stability,
        "records": records,
        "optimizer_cache_size": len(optimizer_cache),
    }


def _cp_endpoint_checks(cp, sample_size):
    endpoint_rows = []
    passed = True
    for x in (0, sample_size):
        interval = cp.interval(sample_size, x)
        expected_lower = 0.0 if x == 0 else cp.tail_probability ** (1.0 / sample_size)
        expected_upper = (
            (1.0 - cp.tail_probability) ** (1.0 / sample_size)
            if x != sample_size
            else 1.0
        )
        lower_tail = (
            0.0
            if x == 0
            else float(stats.binom.cdf(x - 1, sample_size, interval[0]))
        )
        upper_tail = (
            0.0
            if x == sample_size
            else float(stats.binom.sf(x, sample_size, interval[1]))
        )
        row_passed = (
            abs(interval[0] - expected_lower) <= PROBABILITY_ABS_TOL
            and abs(interval[1] - expected_upper) <= PROBABILITY_ABS_TOL
            and (x == 0 or abs(lower_tail - cp.tail_probability) <= PROBABILITY_ABS_TOL)
            and (
                x == sample_size
                or abs(upper_tail - cp.tail_probability) <= PROBABILITY_ABS_TOL
            )
        )
        passed = passed and row_passed
        endpoint_rows.append(
            {
                "x": int(x),
                "n": int(sample_size),
                "interval": list(interval),
                "expected_interval": [expected_lower, expected_upper],
                "lower_exclusion_tail": lower_tail,
                "upper_exclusion_tail": upper_tail,
                "passed": row_passed,
            }
        )
    interior_x = sample_size // 2
    interior = cp.interval(sample_size, interior_x)
    interior_passed = (
        0.0 <= interior[0] <= interior[1] <= 1.0
        and interior[0] <= interior_x / sample_size <= interior[1]
    )
    return {
        "passed": bool(passed and interior_passed),
        "tail_probability": cp.tail_probability,
        "endpoints": endpoint_rows,
        "interior": {
            "x": int(interior_x),
            "interval": list(interior),
            "passed": bool(interior_passed),
        },
    }


def validate_problem4(payload, tolerance=PROBABILITY_ABS_TOL):
    tolerance = float(tolerance)
    checks = []

    def add(name, passed, observed=None, required=None):
        checks.append(
            {
                "name": name,
                "passed": bool(passed),
                "observed": observed,
                "required": required,
            }
        )

    add(
        "synthetic_scenario_label",
        payload.get("claim_status") == "synthetic_scenario_only",
        payload.get("claim_status"),
        "synthetic_scenario_only",
    )
    add(
        "conditional_h1_label",
        payload.get("q3", {}).get("topology_label") == CONDITIONAL_H1_LABEL,
        payload.get("q3", {}).get("topology_label"),
        CONDITIONAL_H1_LABEL,
    )
    add(
        "joint_confidence",
        abs(payload.get("joint_confidence", -1.0) - Q4_JOINT_CONFIDENCE)
        <= tolerance,
        payload.get("joint_confidence"),
        Q4_JOINT_CONFIDENCE,
    )
    add(
        "node_count",
        payload.get("node_count") == Q3_TOTAL_NODE_COUNT_CONDITIONAL,
        payload.get("node_count"),
        Q3_TOTAL_NODE_COUNT_CONDITIONAL,
    )
    add(
        "alpha_node",
        abs(payload.get("alpha_node", -1.0) - Q4_ALPHA_NODE_H1) <= tolerance,
        payload.get("alpha_node"),
        Q4_ALPHA_NODE_H1,
    )
    add(
        "coverage_lower_bound",
        payload.get("coverage_lower", -1.0)
        >= Q4_JOINT_COVERAGE_LOWER_BOUND - tolerance,
        payload.get("coverage_lower"),
        Q4_JOINT_COVERAGE_LOWER_BOUND,
    )
    add(
        "endpoint_checks",
        bool(payload.get("endpoint_checks", {}).get("passed")),
        payload.get("endpoint_checks"),
        True,
    )
    add(
        "interval_checks",
        bool(payload.get("interval_checks", {}).get("passed")),
        payload.get("interval_checks"),
        True,
    )
    add(
        "sampling_center_checks",
        bool(payload.get("sampling_center_checks", {}).get("passed")),
        payload.get("sampling_center_checks"),
        True,
    )
    node_rows = payload.get("nodes", [])
    add(
        "q3_node_rows",
        len(node_rows) == Q3_TOTAL_NODE_COUNT_CONDITIONAL,
        len(node_rows),
        Q3_TOTAL_NODE_COUNT_CONDITIONAL,
    )
    add(
        "point_strategy_present",
        payload.get("point_strategy") is not None,
        payload.get("point_strategy"),
        "non-null",
    )
    add(
        "robust_strategy_present",
        payload.get("robust_strategy") is not None,
        payload.get("robust_strategy"),
        "non-null",
    )
    design_rows = payload.get("cp_minimum_sample_results", [])
    widths_valid = all(
        row.get("expected_width", math.inf)
        <= row.get("target_halfwidth", -math.inf) + tolerance
        and row.get("next_feasible_expected_width", math.inf)
        <= row.get("expected_width", -math.inf) + tolerance
        for row in design_rows
    )
    add(
        "cp_minimum_and_neighbor_widths",
        widths_valid,
        widths_valid,
        True,
    )
    center_valid = all(
        abs(row["p_hat"] - row["x"] / row["n"]) <= tolerance
        and row["sampling_center"] == row["p_hat"]
        for row in design_rows
    )
    add(
        "all_point_estimates_are_sample_ratios",
        center_valid,
        center_valid,
        True,
    )
    q2_cases = payload.get("q2", {}).get("cases", [])
    q2_complete = len(q2_cases) == len(Q2_CASES) and all(
        len(case.get("all_strategies", [])) == Q2_EFFECTIVE_STRATEGY_COUNT
        for case in q2_cases
    )
    add("all_q2_policies", q2_complete, q2_complete, True)
    repeated_budget = all(
        case.get("stability", {}).get("repetitions")
        == Q4_MONTE_CARLO_REPETITIONS
        for case in q2_cases
    ) and payload.get("q3", {}).get("stability", {}).get(
        "repetitions"
    ) == Q4_MONTE_CARLO_REPETITIONS
    add("fixed_monte_carlo_budget", repeated_budget, repeated_budget, True)
    failures = [row["name"] for row in checks if not row["passed"]]
    return {
        "passed": not failures,
        "failures": failures,
        "checks": checks,
    }


def solve_problem4(output_path=DEFAULT_RESULT_FILE):
    cp_q2 = ClopperPearsonBoundary(Q4_ALPHA_NODE_Q2)
    cp_q3 = ClopperPearsonBoundary(Q4_ALPHA_NODE_H1)
    q2_joint = BonferroniJointRegion(Q4_JOINT_CONFIDENCE, Q2_RATE_NODE_COUNT)
    q3_joint = BonferroniJointRegion(
        Q4_JOINT_CONFIDENCE, Q3_TOTAL_NODE_COUNT_CONDITIONAL
    )
    engine_gap = _verify_q2_engine(Q2_CASES)
    use_reference_engine = False
    rng = np.random.default_rng(RANDOM_SEED)
    q2_designs, q3_designs = _initial_design_rows(
        cp_q2, cp_q3, Q2_CASES, rng
    )
    scenario_sensitivity = _scenario_design_sensitivity(
        cp_q2, cp_q3, q2_designs, q3_designs
    )
    q2_monte_carlo = _q2_monte_carlo(
        Q2_CASES, q2_designs, cp_q2, rng, use_reference_engine
    )
    q3_monte_carlo = _q3_monte_carlo(q3_designs, cp_q3, rng)
    endpoint_checks = _cp_endpoint_checks(
        cp_q3, q3_designs[0]["n"]
    )
    interval_valid = all(
        0.0 <= row["interval"][0] <= row["interval"][1] <= 1.0
        for row in q3_designs
    )
    centers_valid = all(
        row["sampling_center"] == row["p_hat"]
        and row["p_hat"] == row["x"] / row["n"]
        for row in q2_designs + q3_designs
    )
    representative_q2 = q2_monte_carlo[0]
    overall_q2_flips = sum(
        case["stability"]["point_flip_count"] for case in q2_monte_carlo
    )
    overall_q2_trials = sum(
        case["stability"]["repetitions"] for case in q2_monte_carlo
    )
    payload = {
        "status": "ok",
        "claim_status": "synthetic_scenario_only",
        "data_status": "no_observed_samples_supplied",
        "q3_problem_status": "conditional_only_missing_original_figure_topology",
        "joint_confidence": Q4_JOINT_CONFIDENCE,
        "node_count": Q3_TOTAL_NODE_COUNT_CONDITIONAL,
        "alpha_node": Q4_ALPHA_NODE_H1,
        "coverage_lower": Q4_JOINT_COVERAGE_LOWER_BOUND,
        "coverage_semantics": "Bonferroni lower bound, not observed coverage",
        "target_halfwidth": Q4_TARGET_CP_HALFWIDTH,
        "endpoint_checks": endpoint_checks,
        "interval_checks": {
            "passed": bool(interval_valid),
            "checked_row_count": len(q2_designs) + len(q3_designs),
        },
        "sampling_center_checks": {
            "passed": bool(centers_valid),
            "rule": "repetitions use xi_v/n_v, never the scenario rate",
            "checked_initial_row_count": len(q2_designs) + len(q3_designs),
        },
        "nodes": q3_designs,
        "point_strategy": representative_q2["point_strategy"],
        "robust_strategy": representative_q2["robust_strategy"],
        "flip_rate": (
            overall_q2_flips / overall_q2_trials
            if overall_q2_trials
            else None
        ),
        "cp_minimum_sample_results": q2_designs + q3_designs,
        "sample_size_results": q2_designs + q3_designs,
        "sample_size_sensitivity": scenario_sensitivity,
        "q2": {
            "synthetic_scenario": True,
            "joint_confidence": q2_joint.joint_confidence,
            "node_count": q2_joint.node_count,
            "alpha_node": q2_joint.alpha_node,
            "coverage_lower": q2_joint.coverage_lower_bound,
            "cases": q2_monte_carlo,
            "overall_point_flip_rate": (
                overall_q2_flips / overall_q2_trials
                if overall_q2_trials
                else None
            ),
            "cashflow_engine_crosscheck_max_gap_yuan": engine_gap,
            "reuses_problem2_cashflow_contract": True,
        },
        "q3": {
            **q3_monte_carlo,
            "joint_confidence": q3_joint.joint_confidence,
            "node_count": q3_joint.node_count,
            "alpha_node": q3_joint.alpha_node,
            "coverage_lower": q3_joint.coverage_lower_bound,
            "topology": H1_CONDITIONAL_TOPOLOGY,
            "edges": [list(edge) for edge in H1_CONDITIONAL_EDGES],
            "nodes": [
                {
                    "node_id": node_id,
                    **q3_node(node_id),
                }
                for node_id in Q3_NODE_ORDER
            ],
            "reuses_problem3_cashflow_contract": True,
        },
        "sampling_design_note": (
            "Scenario rates generate one initial sample only; all reported point "
            "estimates and repeated-sampling centers are sample ratios."
        ),
        "robust_optimization_note": (
            "Fixed-policy defect-rate monotonicity was checked; the CP upper "
            "endpoints therefore determine each Bonferroni worst case."
        ),
    }
    validation = validate_problem4(payload)
    payload["validation"] = validation
    _require_condition(
        validation["passed"],
        "problem4 final-result constraint validation failed: "
        + ", ".join(validation["failures"]),
    )
    if output_path is not None:
        _write_json(payload, output_path)
    return payload


def solve(output_path=DEFAULT_RESULT_FILE):
    return solve_problem4(output_path=output_path)


def run(output_path=DEFAULT_RESULT_FILE):
    return solve_problem4(output_path=output_path)


def audit(payload=None):
    if payload is None:
        path = Path(DEFAULT_RESULT_FILE)
        payload = json.loads(path.read_text(encoding="utf-8"))
    return validate_problem4(payload)


def validate_constraints(payload, tolerance=PROBABILITY_ABS_TOL):
    return validate_problem4(payload, tolerance=tolerance)


__all__ = [
    "ClopperPearsonBoundary",
    "BonferroniJointRegion",
    "MonteCarloPolicyStability",
    "solve_problem4",
    "solve",
    "run",
    "audit",
    "validate_problem4",
    "validate_constraints",
]