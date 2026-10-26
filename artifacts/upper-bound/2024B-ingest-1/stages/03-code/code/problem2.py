"""Problem 2: exhaustive four-decision policy evaluation and cashflow audit."""

from __future__ import annotations

import itertools
import math
from fractions import Fraction

import numpy as np
from params import *


class StrategyInfeasible(RuntimeError):
    """Raised when a policy cannot deliver a positive-probability good unit."""


_AMOUNT_FIELDS = (
    "purchase_part1",
    "inspection_part1",
    "purchase_part2",
    "inspection_part2",
    "assembly_cost",
    "finished_inspection_cost",
    "sale_price",
    "exchange_loss",
    "disassembly_cost",
)
_RATE_FIELDS = ("p_part1", "p_part2", "p_finished")


def _canonical_case(case):
    if isinstance(case, bool):
        raise TypeError("a case identifier cannot be boolean")
    if isinstance(case, int):
        result = q2_case(case)
    elif isinstance(case, str) and case.strip().isdigit():
        result = q2_case(int(case.strip()))
    elif isinstance(case, dict):
        result = dict(case)
    else:
        raise TypeError("case must be a Table 1 identifier or a mapping")
    validate_case_inputs(result)
    return result


def _strategy_tuple(strategy):
    if isinstance(strategy, str):
        text = strategy.strip().replace(" ", "")
        if text.startswith("(") and text.endswith(")"):
            text = text[1:-1]
        if not text or any(character not in "01" for character in text):
            raise ValueError("string strategy must contain four binary digits")
        values = tuple(int(character) for character in text)
    else:
        values = tuple(int(value) for value in strategy)
    if len(values) != len(Q2_DECISION_NAMES):
        raise ValueError("a Q2 policy must contain four decisions")
    if any(value not in (0, 1) for value in values):
        raise ValueError("a Q2 decision must be zero or one")
    return values


def _strategy_id(strategy):
    return "".join(str(value) for value in _strategy_tuple(strategy))


def _strategy_label(strategy):
    z1, z2, finished, disassemble = _strategy_tuple(strategy)
    return (
        f"(Z1,Z2,C,D)=({z1},{z2},{finished},{disassemble})"
    )


def _state_space(strategy):
    _, _, _, disassemble = _strategy_tuple(strategy)
    states = ["fresh"]
    if disassemble:
        q1_choices = (1,) if z1 else (0, 1)
        q2_choices = (1,) if z2 else (0, 1)
        states.extend(
            itertools.product(q1_choices, q2_choices)
        )
    return tuple(states)


def _input_templates(case, strategy, state):
    z1, z2, _, _ = _strategy_tuple(strategy)
    q1_choices = (1,) if z1 else (0, 1)
    q2_choices = (1,) if z2 else (0, 1)
    templates = []
    for q1 in q1_choices:
        for q2 in q2_choices:
            costs = {category: 0.0 for category in COST_CATEGORIES}
            if state == "fresh":
                if z1:
                    if case["p_part1"] >= 1.0:
                        raise StrategyInfeasible("screened part 1 has no positive yield")
                    costs["purchase"] += case["purchase_part1"] / (
                        1.0 - case["p_part1"]
                    )
                    costs["inspection"] += case["inspection_part1"] / (
                        1.0 - case["p_part1"]
                    )
                    input_probability = 1.0
                else:
                    costs["purchase"] += case["purchase_part1"]
                    input_probability = 1.0 - case["p_part1"] if q1 else case["p_part1"]
            else:
                input_probability = 1.0
                if z1:
                    costs["inspection"] += case["inspection_part1"]
                    if not q1:
                        if case["p_part1"] >= 1.0:
                            raise StrategyInfeasible(
                                "screened replacement part 1 has no positive yield"
                            )
                        costs["inspection"] += case["inspection_part1"] / (
                            1.0 - case["p_part1"]
                        )
                        costs["purchase"] += case["purchase_part1"] / (
                            1.0 - case["p_part1"]
                        )
                selected_q1 = 1 if z1 else q1
                if z2:
                    costs["inspection"] += case["inspection_part2"]
                    if not q2:
                        if case["p_part2"] >= 1.0:
                            raise StrategyInfeasible(
                                "screened replacement part 2 has no positive yield"
                            )
                        costs["inspection"] += case["inspection_part2"] / (
                            1.0 - case["p_part2"]
                        )
                        costs["purchase"] += case["purchase_part2"] / (
                            1.0 - case["p_part2"]
                        )
                selected_q2 = 1 if z2 else q2
                q1, q2 = selected_q1, selected_q2
            probability = input_probability
            if state == "fresh":
                probability *= 1.0 - case["p_part2"] if q2 else case["p_part2"]
            templates.append(
                {
                    "input_quality": (int(q1), int(q2)),
                    "probability": float(probability),
                    "input_costs": costs,
                }
            )
    total_probability = math.fsum(row["probability"] for row in templates)
    if not math.isclose(
        total_probability,
        1.0,
        rel_tol=PROBABILITY_ABS_TOL,
        abs_tol=PROBABILITY_ABS_TOL,
    ):
        raise ValueError("input-quality probabilities do not sum to one")
    return templates


def _transition_model(case, strategy):
    z1, z2, inspect_finished, disassemble = _strategy_tuple(strategy)
    states = _state_space(strategy)
    model = {}
    for state in states:
        templates = _input_templates(case, strategy, state)
        terminal_probability = 0.0
        transitions = {}
        immediate = {category: 0.0 for category in COST_CATEGORIES}
        for template in templates:
            probability = template["probability"]
            q1, q2 = template["input_quality"]
            good_probability = (
                1.0 - case["p_finished"] if q1 == 1 and q2 == 1 else 0.0
            )
            bad_probability = 1.0 - good_probability
            terminal_probability += probability * good_probability
            for category, value in template["input_costs"].items():
                immediate[category] += probability * value
            immediate["assembly"] += probability * case["assembly_cost"]
            if inspect_finished:
                immediate["inspection"] += probability * case["finished_inspection_cost"]
            if not inspect_finished:
                immediate["exchange"] += (
                    probability * bad_probability * case["exchange_loss"]
                )
            if disassemble:
                immediate["disassembly"] += (
                    probability * bad_probability * case["disassembly_cost"]
                )
            if bad_probability:
                next_state = template["input_quality"] if disassemble else "fresh"
                transitions[next_state] = (
                    transitions.get(next_state, 0.0)
                    + probability * bad_probability
                )
        transition_total = math.fsum(transitions.values())
        if not math.isclose(
            terminal_probability + transition_total,
            1.0,
            rel_tol=PROBABILITY_ABS_TOL,
            abs_tol=PROBABILITY_ABS_TOL,
        ):
            raise ValueError("terminal and continuation probabilities do not sum to one")
        model[state] = {
            "terminal_probability": terminal_probability,
            "transitions": transitions,
            "immediate_cost": immediate,
            "templates": templates,
        }
    return states, model


def _live_states(states, model):
    predecessors = {state: set() for state in states}
    live = set()
    pending = []
    for state in states:
        if model[state]["terminal_probability"] > PROBABILITY_ABS_TOL:
            live.add(state)
            pending.append(state)
        for next_state in model[state]["transitions"]:
            predecessors[next_state].add(state)
    while pending:
        state = pending.pop()
        for predecessor in predecessors[state]:
            if predecessor not in live:
                live.add(predecessor)
                pending.append(predecessor)
    return tuple(state for state in states if state in live)


def _solve_square(matrix, right_hand_side):
    try:
        solution = np.linalg.solve(
            np.asarray(matrix, dtype=float),
            np.asarray(right_hand_side, dtype=float),
        )
    except np.linalg.LinAlgError as exc:
        raise StrategyInfeasible("renewal equations are singular") from exc
    if not np.all(np.isfinite(solution)):
        raise StrategyInfeasible("renewal solver returned a non-finite value")
    return solution


def renewal_bellman_solver(case, strategy):
    """Solve H and the success-weighted reward equations on live states."""
    case = _canonical_case(case)
    strategy = _strategy_tuple(strategy)
    states, model = _transition_model(case, strategy)
    live = _live_states(states, model)
    if "fresh" not in live:
        raise StrategyInfeasible("policy has zero eventual delivery probability")
    index = {state: position for position, state in enumerate(live)}
    size = len(live)
    h_matrix = np.eye(size, dtype=float)
    w_matrix = np.eye(size, dtype=float)
    terminal = np.zeros(size, dtype=float)
    immediate_vectors = {
        category: np.zeros(size, dtype=float) for category in COST_CATEGORIES
    }
    for state in live:
        row = index[state]
        terminal[row] = model[state]["terminal_probability"]
        for category in COST_CATEGORIES:
            immediate_vectors[category][row] = model[state]["immediate_cost"][category]
        for next_state, probability in model[state]["transitions"].items():
            if next_state not in index:
                continue
            column = index[next_state]
            h_matrix[row, column] -= probability
            w_matrix[row, column] -= probability
    success = _solve_square(h_matrix, terminal)
    weighted_cost = {
        category: _solve_square(w_matrix, immediate_vectors[category])
        for category in COST_CATEGORIES
    }
    success_map = {state: float(success[index[state]]) for state in live}
    if success_map["fresh"] <= 0.0:
        raise StrategyInfeasible("policy has zero eventual delivery probability")
    weighted_map = {
        category: {state: float(values[index[state]]) for state in live}
        for category, values in weighted_cost.items()
    }
    cost_per_good = {
        category: weighted_map[category]["fresh"] / success_map["fresh"]
        for category in COST_CATEGORIES
    }
    total_weighted_cost = math.fsum(weighted_map[category]["fresh"] for category in COST_CATEGORIES)
    success_weighted_trial_profit = (
        case["sale_price"] * success_map["fresh"] - total_weighted_cost
    )
    profit_per_good = success_weighted_trial_profit / success_map["fresh"]
    return {
        "success_probability": success_map["fresh"],
        "dead_end_probability": 1.0 - success_map["fresh"],
        "trial_profit": success_weighted_trial_profit,
        "trial_profit_measure": "success_probability_weighted_reward",
        "profit_per_good": profit_per_good,
        "cost_per_good": cost_per_good,
        "state_count": len(states),
        "live_state_count": len(live),
        "state_success_probabilities": {
            str(state): success_map[state] for state in live
        },
    }


def _fraction(value):
    return Fraction(str(float(value)))


def _fraction_solve(matrix, right_hand_side):
    size = len(matrix)
    augmented = [
        [Fraction(value) for value in matrix[row]]
        + [Fraction(right_hand_side[row])]
        for row in range(size)
    ]
    for column in range(size):
        pivot = next(
            (row for row in range(column, size) if augmented[row][column]),
            None,
        )
        if pivot is None:
            raise StrategyInfeasible("event-ledger equations are singular")
        if pivot != column:
            augmented[column], augmented[pivot] = augmented[pivot], augmented[column]
        divisor = augmented[column][column]
        augmented[column] = [value / divisor for value in augmented[column]]
        for row in range(size):
            if row == column or not augmented[row][column]:
                continue
            multiplier = augmented[row][column]
            augmented[row] = [
                left - multiplier * right
                for left, right in zip(augmented[row], augmented[column])
            ]
    return [augmented[row][-1] for row in range(size)]


def salvage_credit_once(event_rows):
    """Audit that disassembly records no immediate purchase credit."""
    credits = [
        float(row.get("salvage_credit", 0.0))
        for row in event_rows
    ]
    maximum = max(credits, default=0.0)
    if maximum > CASHFLOW_ABS_TOL_YUAN:
        raise ValueError("an immediate salvage credit duplicates avoided purchasing")
    return {
        "salvage_credit_once": True,
        "maximum_immediate_salvage_credit": maximum,
        "recovery_value_recognized_by_avoided_purchase_only": True,
    }


def _state_label(state):
    if state == "fresh":
        return "fresh"
    return f"recovered_q{state[0]}{state[1]}"


def event_cashflow_ledger(case, strategy, include_rows=True):
    """Independently solve exact rational renewal equations and expose events."""
    case = _canonical_case(case)
    strategy = _strategy_tuple(strategy)
    _, _, inspect_finished, disassemble = strategy
    states, model = _transition_model(case, strategy)
    live = _live_states(states, model)
    if "fresh" not in live:
        raise StrategyInfeasible("policy has zero eventual delivery probability")
    index = {state: position for position, state in enumerate(live)}
    size = len(live)
    h_matrix = [[Fraction(int(row == column)) for column in range(size)] for row in range(size)]
    weighted_matrix = [
        [Fraction(int(row == column)) for column in range(size)]
        for row in range(size)
    ]
    terminal = [Fraction(0) for _ in live]
    immediate = {
        category: [Fraction(0) for _ in live] for category in COST_CATEGORIES
    }
    for state in live:
        row = index[state]
        terminal[row] = _fraction(model[state]["terminal_probability"])
        for category in COST_CATEGORIES:
            immediate[category][row] = _fraction(model[state]["immediate_cost"][category])
        for next_state, probability in model[state]["transitions"].items():
            if next_state in index:
                h_matrix[row][index[next_state]] -= _fraction(probability)
    success_values = _fraction_solve(h_matrix, terminal)
    success = {state: success_values[index[state]] for state in live}
    if success["fresh"] <= 0:
        raise StrategyInfeasible("policy has zero eventual delivery probability")
    for state in live:
        row = index[state]
        for next_state, probability in model[state]["transitions"].items():
            if next_state in index:
                weighted_matrix[row][index[next_state]] -= (
                    _fraction(probability) * success[next_state]
                )
    weighted_cost = {
        category: _fraction_solve(weighted_matrix, immediate[category])
        for category in COST_CATEGORIES
    }
    weighted_map = {
        category: {state: weighted_cost[category][index[state]] for state in live}
        for category in COST_CATEGORIES
    }
    cost_per_good = {
        category: float(weighted_map[category]["fresh"] / success["fresh"])
        for category in COST_CATEGORIES
    }
    total_weighted = sum(
        (weighted_map[category]["fresh"] for category in COST_CATEGORIES),
        Fraction(0),
    )
    trial_profit = float(
        _fraction(case["sale_price"]) * success["fresh"] - total_weighted
    )
    profit = float(trial_profit / success["fresh"])
    event_rows = []
    if include_rows:
        for state in states:
            for template in model[state]["templates"]:
                q1, q2 = template["input_quality"]
                input_probability = template["probability"]
                good_probability = (
                    1.0 - case["p_finished"] if q1 == 1 and q2 == 1 else 0.0
                )
                for outcome, outcome_probability in (
                    ("good", good_probability),
                    ("defective", 1.0 - good_probability),
                ):
                    path_probability = input_probability * outcome_probability
                    if not path_probability:
                        continue
                    attempt_cost = dict(template["input_costs"])
                    attempt_cost["assembly"] += case["assembly_cost"]
                    if inspect_finished:
                        attempt_cost["inspection"] += case["finished_inspection_cost"]
                    if outcome == "defective":
                        if not inspect_finished:
                            attempt_cost["exchange"] += case["exchange_loss"]
                        if disassemble:
                            attempt_cost["disassembly"] += case["disassembly_cost"]
                    cumulative_attempt_cost = -math.fsum(attempt_cost.values())
                    if outcome == "good":
                        next_state = "terminal_good"
                        termination = "terminal_good_revenue_once"
                    elif disassemble:
                        next_state = template["input_quality"]
                        termination = (
                            "recycle_disassembled_parts"
                            if next_state in live
                            else "permanent_no_delivery_state"
                        )
                    else:
                        next_state = "fresh"
                        termination = "scrap_and_restart_with_fresh_parts"
                    common = {
                        "event_state": _state_label(state),
                        "strategy_branch": _strategy_label(strategy),
                        "inspection_evidence": (
                            f"input_quality_q{q1}q{q2};C={inspect_finished}"
                        ),
                        "input_quality": [q1, q2],
                        "outcome": outcome,
                        "next_state": _state_label(next_state)
                        if isinstance(next_state, tuple)
                        else next_state,
                        "termination_reason": termination,
                        "cumulative_cost": cumulative_attempt_cost,
                        "salvage_credit": 0.0,
                    }
                    event_map = {
                        "purchase": ("part1" if q1 == 1 else "part2", "purchase"),
                        "inspection_part1": ("part1", "leaf_inspection"),
                        "inspection_part2": ("part2", "leaf_inspection"),
                        "assembly": ("finished", "assembly"),
                        "inspection": ("finished", "finished_inspection"),
                        "exchange": ("finished", "customer_exchange"),
                        "disassembly": ("finished", "disassembly"),
                    }
                    for category, value in attempt_cost.items():
                        if not value:
                            continue
                        if category == "inspection":
                            physical_node, event_type = "finished", "finished_inspection"
                        else:
                            physical_node, event_type = event_map[category]
                        event_rows.append(
                            {
                                **common,
                                "event_type": event_type,
                                "physical_node": physical_node,
                                "probability": path_probability,
                                "cash_term": -value * path_probability,
                                "cost_category": category,
                            }
                        )
                    if outcome == "good":
                        event_rows.append(
                            {
                                **common,
                                "event_type": "terminal_revenue",
                                "physical_node": "market",
                                "probability": path_probability,
                                "cash_term": case["sale_price"] * path_probability,
                                "cost_category": "revenue",
                                "salvage_credit": 0.0,
                            }
                        )
    return {
        "success_probability": float(success["fresh"]),
        "dead_end_probability": float(1 - success["fresh"]),
        "trial_profit": trial_profit,
        "trial_profit_measure": "success_probability_weighted_reward",
        "profit_per_good": profit,
        "cost_per_good": cost_per_good,
        "state_count": len(states),
        "live_state_count": len(live),
        "event_ledger": event_rows,
        "event_count": len(event_rows),
    }


def all_16_q2_policies(case=None):
    """Return the exhaustive itertools.product policy space."""
    if case is not None:
        _canonical_case(case)
    policies = list(itertools.product((0, 1), repeat=len(Q2_DECISION_NAMES)))
    if len(policies) != Q2_EFFECTIVE_STRATEGY_COUNT:
        raise AssertionError("the Q2 policy space is not exhaustive")
    return policies


def evaluate_strategy(case, strategy, include_ledger=True):
    case = _canonical_case(case)
    strategy = _strategy_tuple(strategy)
    try:
        bellman = renewal_bellman_solver(case, strategy)
        event = event_cashflow_ledger(case, strategy, include_ledger)
    except StrategyInfeasible:
        return {
            "strategy": list(strategy),
            "strategy_tuple": strategy,
            "strategy_id": _strategy_id(strategy),
            "strategy_label": _strategy_label(strategy),
            "feasible": False,
            "profit": None,
            "profit_per_good": None,
            "trial_profit": None,
            "success_probability": 0.0,
            "cashflow_gap": None,
            "reason": "zero eventual delivery probability or singular policy",
        }
    compared = (
        "success_probability",
        "trial_profit",
        "profit_per_good",
        *(f"cost_per_good.{category}" for category in COST_CATEGORIES),
    )
    gaps = []
    for field in compared:
        category = None
        if "." in field:
            category = field.split(".", 1)[1]
            left = event["cost_per_good"][category]
            right = bellman["cost_per_good"][category]
        else:
            left = event[field]
            right = bellman[field]
        gaps.append(abs(left - right))
    cashflow_gap = max(gaps)
    if cashflow_gap > CASHFLOW_ABS_TOL_YUAN:
        raise ValueError("event ledger and Bellman solver exceed the cashflow tolerance")
    identity_gap = abs(
        bellman["profit_per_good"]
        - bellman["trial_profit"] / bellman["success_probability"]
    )
    if identity_gap > CASHFLOW_ABS_TOL_YUAN:
        raise ValueError("per-good and trial-profit normalizations disagree")
    if any(value < -CASHFLOW_ABS_TOL_YUAN for value in bellman["cost_per_good"].values()):
        raise ValueError("a nonnegative cashflow category became negative")
    total_cost = math.fsum(bellman["cost_per_good"].values())
    if abs(bellman["profit_per_good"] - (case["sale_price"] - total_cost)) > CASHFLOW_ABS_TOL_YUAN:
        raise ValueError("the unit-good profit identity failed")
    ledger = event["event_ledger"]
    audit = salvage_credit_once(ledger)
    row = {
        "strategy": list(strategy),
        "strategy_tuple": strategy,
        "strategy_id": _strategy_id(strategy),
        "strategy_label": _strategy_label(strategy),
        "decision_mapping": strategy_mapping(strategy),
        "feasible": True,
        "profit": bellman["profit_per_good"],
        "profit_per_good": bellman["profit_per_good"],
        "expected_profit_per_good": bellman["profit_per_good"],
        "trial_profit": bellman["trial_profit"],
        "trial_profit_measure": bellman["trial_profit_measure"],
        "success_probability": bellman["success_probability"],
        "dead_end_probability": bellman["dead_end_probability"],
        "cost_per_good": bellman["cost_per_good"],
        "cost_per_good_total": total_cost,
        "state_count": bellman["state_count"],
        "live_state_count": bellman["live_state_count"],
        "normalization_gap": identity_gap,
        "cashflow_gap": cashflow_gap,
        "cashflow_max_gap": cashflow_gap,
        "solvers": ["renewal_bellman_solver", "event_cashflow_ledger"],
        **audit,
    }
    if include_ledger:
        row["event_ledger"] = ledger
        row["event_count"] = event["event_count"]
    return row


def _select_best(rows):
    finite = [row for row in rows if row["feasible"]]
    if not finite:
        raise StrategyInfeasible("all policies are infeasible")
    maximum = max(row["profit_per_good"] for row in finite)
    tied = [
        row
        for row in finite
        if maximum - row["profit_per_good"] <= CASHFLOW_ABS_TOL_YUAN
    ]
    return min(tied, key=lambda row: row["strategy_tuple"])


def solve_case(case_id, include_ledger=True):
    case = _canonical_case(case_id)
    rows = [
        evaluate_strategy(case, policy, include_ledger=include_ledger)
        for policy in all_16_q2_policies(case)
    ]
    best = _select_best(rows)
    parameters = {field: case[field] for field in _RATE_FIELDS + _AMOUNT_FIELDS}
    profits = {row["strategy_id"]: row["profit_per_good"] for row in rows}
    costs = {row["strategy_id"]: row["cost_per_good_total"] for row in rows}
    matrix = [
        {
            "strategy_id": row["strategy_id"],
            "strategy": row["strategy"],
            "profit_per_good": row["profit_per_good"],
            "cost_per_good": row["cost_per_good_total"],
            "cashflow_gap": row["cashflow_gap"],
        }
        for row in rows
    ]
    return {
        "case": case["case_id"],
        "case_id": case["case_id"],
        "fact_id": case["fact_id"],
        "parameters": parameters,
        "strategy_space": [list(policy) for policy in all_16_q2_policies(case)],
        "strategy_count": len(rows),
        "policy_space_size": len(rows),
        "strategies": rows,
        "policies": rows,
        "strategy_results": rows,
        "strategy_matrix": matrix,
        "strategy_profits": profits,
        "profits": profits,
        "strategy_costs": costs,
        "optimal_strategy": best["strategy"],
        "best_strategy": best["strategy"],
        "recommended_strategy": best["strategy"],
        "strategy_label": best["strategy_label"],
        "profit": best["profit_per_good"],
        "profit_per_good": best["profit_per_good"],
        "trial_profit": best["trial_profit"],
        "trial_profit_measure": best["trial_profit_measure"],
        "success_probability": best["success_probability"],
        "cost_breakdown": best["cost_per_good"],
        "cashflow_max_gap": max(row["cashflow_gap"] for row in rows),
    }


def _rate_variant(case, node, offset):
    variant = dict(case)
    key = {
        "part1": "p_part1",
        "part2": "p_part2",
        "finished": "p_finished",
    }[node]
    variant[key] = validate_probability(case[key] + offset, key)
    variant["p1"] = variant["p_part1"]
    variant["p2"] = variant["p_part2"]
    variant["r"] = variant["p_finished"]
    return variant


def _best_for_variant(case):
    rows = [
        evaluate_strategy(case, policy, include_ledger=False)
        for policy in all_16_q2_policies(case)
    ]
    best = _select_best(rows)
    return best["strategy"], best["profit_per_good"]


def _scale_case(case, multipliers):
    scaled = dict(case)
    fields = (
        "purchase_part1",
        "inspection_part1",
        "purchase_part2",
        "inspection_part2",
        "assembly_cost",
        "finished_inspection_cost",
        "exchange_loss",
        "disassembly_cost",
    )
    for field in fields:
        scaled[field] = validate_nonnegative(case[field] * multipliers[field], field)
    return scaled


def _dense_scan_grid():
    intervals = len(SENSITIVITY_COST_MULTIPLIERS) + len(Q2_RATE_NODE_IDS) + 1
    span = SENSITIVITY_COST_MULTIPLIER_HIGH - SENSITIVITY_COST_MULTIPLIER_LOW
    return tuple(
        SENSITIVITY_COST_MULTIPLIER_LOW + span * position / intervals
        for position in range(intervals + 1)
    )


def _contour_grid():
    intervals = len(SENSITIVITY_DEFECT_RATES) + len(Q2_POLICY_LABELS)
    span = SENSITIVITY_COST_MULTIPLIER_HIGH - SENSITIVITY_COST_MULTIPLIER_LOW
    return tuple(
        SENSITIVITY_COST_MULTIPLIER_LOW + span * position / intervals
        for position in range(intervals + 1)
    )


def sensitivity_analysis():
    rate_rows = []
    cost_rows = []
    for case in Q2_CASES:
        case_id = case["case_id"]
        for node in Q2_RATE_NODE_IDS:
            for offset in SENSITIVITY_DEFECT_RATES:
                variant = _rate_variant(case, node, offset)
                strategy, profit = _best_for_variant(variant)
                rate_rows.append(
                    {
                        "case_id": case_id,
                        "rate_node": node,
                        "rate_offset": offset,
                        "defect_rate": variant[
                            {
                                "part1": "p_part1",
                                "part2": "p_part2",
                                "finished": "p_finished",
                            }[node]
                        ],
                        "strategy": strategy,
                        "strategy_id": _strategy_id(strategy),
                        "profit_per_good": profit,
                    }
                )
        for multiplier in _dense_scan_grid():
            multipliers = {
                field: multiplier
                for field in (
                    "purchase_part1",
                    "inspection_part1",
                    "purchase_part2",
                    "inspection_part2",
                    "assembly_cost",
                    "finished_inspection_cost",
                    "exchange_loss",
                    "disassembly_cost",
                )
            }
            variant = _scale_case(case, multipliers)
            strategy, profit = _best_for_variant(variant)
            cost_rows.append(
                {
                    "case_id": case_id,
                    "cost_multiplier": multiplier,
                    "strategy": strategy,
                    "strategy_id": _strategy_id(strategy),
                    "profit_per_good": profit,
                }
            )
    contour_values = _contour_grid()
    contour_rows = []
    contour_lookup = {}
    for y_index, exchange_multiplier in enumerate(contour_values):
        for x_index, inspection_multiplier in enumerate(contour_values):
            multipliers = {
                field: SENSITIVITY_COST_MULTIPLIER_BASE
                for field in (
                    "purchase_part1",
                    "inspection_part1",
                    "purchase_part2",
                    "inspection_part2",
                    "assembly_cost",
                    "finished_inspection_cost",
                    "exchange_loss",
                    "disassembly_cost",
                )
            }
            multipliers["finished_inspection_cost"] = (
                case["finished_inspection_cost"] * inspection_multiplier
            )
            multipliers["exchange_loss"] = case["exchange_loss"] * exchange_multiplier
            variant = _scale_case(Q2_CASES[0], multipliers)
            strategy, profit = _best_for_variant(variant)
            row = {
                "case_id": Q2_CASES[0]["case_id"],
                "x_index": x_index,
                "y_index": y_index,
                "finished_inspection_multiplier": inspection_multiplier,
                "exchange_loss_multiplier": exchange_multiplier,
                "strategy": strategy,
                "strategy_id": _strategy_id(strategy),
                "profit_per_good": profit,
            }
            contour_rows.append(row)
            contour_lookup[(x_index, y_index)] = row
    boundaries = []
    for y_index in range(len(contour_values)):
        for x_index in range(len(contour_values)):
            current = contour_lookup[(x_index, y_index)]
            for x_offset, y_offset in ((1, 0), (0, 1)):
                other_index = (x_index + x_offset, y_index + y_offset)
                if other_index not in contour_lookup:
                    continue
                other = contour_lookup[other_index]
                if current["strategy_id"] == other["strategy_id"]:
                    continue
                denominator = other["profit_per_good"] - current["profit_per_good"]
                fraction = 0.0
                if abs(denominator) > PROBABILITY_ABS_TOL:
                    fraction = (
                        current["profit_per_good"] - other["profit_per_good"]
                    ) / denominator
                    fraction = min(1.0, max(0.0, fraction))
                x = current["finished_inspection_multiplier"] + fraction * (
                    other["finished_inspection_multiplier"]
                    - current["finished_inspection_multiplier"]
                )
                y = current["exchange_loss_multiplier"] + fraction * (
                    other["exchange_loss_multiplier"]
                    - current["exchange_loss_multiplier"]
                )
                boundaries.append(
                    {
                        "from_strategy": current["strategy_id"],
                        "to_strategy": other["strategy_id"],
                        "finished_inspection_multiplier": x,
                        "exchange_loss_multiplier": y,
                    }
                )
    return {
        "defect_rate_scan": rate_rows,
        "cost_multiplier_scan": cost_rows,
        "breakeven_contour": contour_rows,
        "decision_flip_boundary": boundaries,
        "contour_x": list(contour_values),
        "contour_y": list(contour_values),
    }


def validate_constraints(result):
    """Recompute Q2 constraints from serialized policy rows and source facts."""
    checks = []
    errors = []

    def add(name, passed, observed):
        row = {"name": name, "passed": bool(passed), "observed": observed}
        checks.append(row)
        if not passed:
            errors.append(f"{name}: {observed}")

    cases = result.get("cases", result.get("case_results", []))
    add("six_table1_cases", len(cases) == len(Q2_CASES), len(cases))
    maximum_gap = 0.0
    for case_payload in cases:
        case_id = case_payload.get("case_id")
        source = q2_case(case_id)
        parameter_ok = all(
            abs(float(case_payload["parameters"][field]) - float(source[field]))
            <= CASHFLOW_ABS_TOL_YUAN
            for field in _RATE_FIELDS + _AMOUNT_FIELDS
        )
        add(f"case{case_id}.source_parameters", parameter_ok, "exact parsed facts")
        rows = case_payload.get("strategies", [])
        expected_ids = {
            "".join(str(value) for value in policy)
            for policy in all_16_q2_policies(source)
        }
        observed_ids = {row.get("strategy_id") for row in rows}
        add(
            f"case{case_id}.all_16_q2_policies",
            len(rows) == Q2_EFFECTIVE_STRATEGY_COUNT
            and observed_ids == expected_ids,
            {"count": len(rows), "ids": sorted(str(value) for value in observed_ids)},
        )
        finite_ok = True
        normalized_ok = True
        cashflow_ok = True
        nonnegative_ok = True
        for row in rows:
            strategy = _strategy_tuple(row["strategy"])
            bellman = renewal_bellman_solver(source, strategy)
            event = event_cashflow_ledger(source, strategy, include_rows=False)
            recomputed_gap = max(
                abs(event["profit_per_good"] - bellman["profit_per_good"]),
                *(
                    abs(
                        event["cost_per_good"][category]
                        - bellman["cost_per_good"][category]
                    )
                    for category in COST_CATEGORIES
                ),
            )
            maximum_gap = max(maximum_gap, recomputed_gap)
            finite_ok = finite_ok and math.isfinite(float(row["profit_per_good"]))
            identity_gap = abs(
                float(row["profit_per_good"])
                - float(row["trial_profit"]) / float(row["success_probability"])
            )
            normalized_ok = normalized_ok and identity_gap <= CASHFLOW_ABS_TOL_YUAN
            cashflow_ok = cashflow_ok and recomputed_gap <= CASHFLOW_ABS_TOL_YUAN
            nonnegative_ok = nonnegative_ok and all(
                value >= -CASHFLOW_ABS_TOL_YUAN
                for value in row["cost_per_good"].values()
            )
        add(f"case{case_id}.finite_profits", finite_ok, len(rows))
        add(f"case{case_id}.normalization_identity", normalized_ok, CASHFLOW_ABS_TOL_YUAN)
        add(f"case{case_id}.cashflow_dual_solver", cashflow_ok, maximum_gap)
        add(f"case{case_id}.nonnegative_costs", nonnegative_ok, "all categories")
        recomputed_best = _select_best(
            [
                evaluate_strategy(source, policy, include_ledger=False)
                for policy in all_16_q2_policies(source)
            ]
        )
        stored_best = tuple(case_payload["optimal_strategy"])
        best_ok = stored_best == recomputed_best["strategy_tuple"]
        add(f"case{case_id}.global_policy_max", best_ok, stored_best)
    add(
        "cashflow_abs_tolerance",
        maximum_gap <= CASHFLOW_ABS_TOL_YUAN,
        maximum_gap,
    )
    passed = not errors
    return {
        "passed": passed,
        "valid": passed,
        "checks": checks,
        "errors": errors,
        "cashflow_max_gap": maximum_gap,
        "cashflow_abs_tol_yuan": CASHFLOW_ABS_TOL_YUAN,
    }


def solve():
    cases = [solve_case(case_id, include_ledger=True) for case_id in range(1, len(Q2_CASES) + 1)]
    result = {
        "problem": "problem2",
        "status": "computed",
        "claim_scope": "exact Table 1 cases under the registered lossless-inspection service model",
        "policy_space_size": Q2_EFFECTIVE_STRATEGY_COUNT,
        "strategy_count": Q2_EFFECTIVE_STRATEGY_COUNT,
        "strategy_space": [list(policy) for policy in all_16_q2_policies()],
        "cases": cases,
        "case_results": cases,
        "strategy_profits": {
            str(case["case_id"]): case["strategy_profits"] for case in cases
        },
        "optimal_strategies": {
            str(case["case_id"]): case["optimal_strategy"] for case in cases
        },
        "optimal_profits": {
            str(case["case_id"]): case["profit_per_good"] for case in cases
        },
        "cashflow_max_gap": max(case["cashflow_max_gap"] for case in cases),
        "sensitivity": sensitivity_analysis(),
        "method_evidence": {
            "itertools.product": True,
            "all_16_q2_policies": True,
            "renewal_bellman_solver": True,
            "event_cashflow_ledger": True,
            "salvage_credit_once": True,
            "terminal_good_revenue_once": True,
        },
    }
    validation = validate_constraints(result)
    result["validation"] = validation
    if not validation["passed"]:
        result["status"] = "blocked"
        raise ValueError("; ".join(validation["errors"]))
    return result


def audit(result):
    return validate_constraints(result)


def run(case_id=None):
    if case_id is None:
        return solve()
    return solve_case(case_id, include_ledger=True)


def solve_problem2(case=None, strategy=None, include_ledger=True):
    if strategy is not None:
        if case is None:
            raise TypeError("a case is required when a strategy is supplied")
        return evaluate_strategy(case, strategy, include_ledger=include_ledger)
    if case is None:
        return solve()
    if isinstance(case, dict):
        return solve_case(case.get("case_id"), include_ledger=include_ledger)
    return solve_case(case, include_ledger=include_ledger)


evaluate_policy = evaluate_strategy
solve_case_policy = evaluate_strategy
profit_per_good = lambda case, strategy: evaluate_strategy(
    case, strategy, include_ledger=False
)["profit_per_good"]

__all__ = (
    "StrategyInfeasible",
    "all_16_q2_policies",
    "evaluate_strategy",
    "evaluate_policy",
    "solve_case_policy",
    "renewal_bellman_solver",
    "event_cashflow_ledger",
    "salvage_credit_once",
    "solve_case",
    "sensitivity_analysis",
    "validate_constraints",
    "audit",
    "solve",
    "run",
    "solve_problem2",
    "profit_per_good",
)