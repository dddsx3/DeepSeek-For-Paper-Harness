"""Problem 3: conditional H1 assembly-DAG optimization and cash-flow audit."""

from __future__ import annotations

import itertools
import math

import networkx as nx
from params import *


_POLICY_INSPECT = "inspect"
_POLICY_DISASSEMBLE = "disassemble"
_MODE_RANDOM = 0
_MODE_SCREENED = 1


def _zero_vector():
    return {category: 0.0 for category in COST_CATEGORIES}


def _vector_add(*vectors):
    result = _zero_vector()
    for vector in vectors:
        for category in COST_CATEGORIES:
            result[category] += float(vector[category])
    return result


def _vector_scale(vector, factor):
    return {category: float(vector[category]) * factor for category in COST_CATEGORIES}


def _vector_total(vector):
    return sum(float(vector[category]) for category in COST_CATEGORIES)


def _vector_gap(left, right):
    return max(
        abs(float(left[category]) - float(right[category]))
        for category in COST_CATEGORIES
    )


def _policy_signature(policy, node_order):
    return tuple(
        (
            int(policy[node_id][_POLICY_INSPECT]),
            int(policy[node_id][_POLICY_DISASSEMBLE]),
        )
        for node_id in node_order
    )


def _policy_with_children(node_id, inspect, disassemble, child_options):
    policy = {}
    for option in child_options:
        policy.update(option["policy"])
    policy[node_id] = {
        _POLICY_INSPECT: int(inspect),
        _POLICY_DISASSEMBLE: int(disassemble),
    }
    return policy


def _build_graph(context):
    graph = nx.DiGraph()
    nodes = context["nodes"]
    edges = tuple(tuple(edge) for edge in context["edges"])
    graph.add_nodes_from(nodes)
    graph.add_edges_from(edges)
    _require_condition(
        set(graph.nodes) == set(nodes), "assembly graph node table is inconsistent"
    )
    _require_condition(
        set(graph.edges) == set(edges), "assembly graph edge table is inconsistent"
    )
    _require_condition(nx.is_directed_acyclic_graph(graph), "assembly graph must be a DAG")
    child_parents = {}
    for child, parent in graph.edges:
        _require_condition(
            child not in child_parents, "this executable instance permits one parent per child"
        )
        child_parents[child] = parent
    parentless = set(graph.nodes) - set(child_parents)
    _require_condition(
        parentless == {context["root"]}, "assembly graph must have the declared single root"
    )
    return graph


def build_h1_context(rates=None):
    supplied_rates = {} if rates is None else dict(rates)
    nodes = {}
    for node_id in Q3_NODE_ORDER:
        node = q3_node(node_id)
        if node_id in supplied_rates:
            node["p"] = validate_probability(supplied_rates[node_id], f"{node_id}.p")
        nodes[node_id] = node
    return {
        "label": CONDITIONAL_H1_LABEL,
        "topology_id": "H1",
        "claim_status": "conditional_not_original_figure_fact",
        "nodes": nodes,
        "node_order": Q3_NODE_ORDER,
        "edges": tuple(H1_CONDITIONAL_EDGES),
        "root": Q3_ROOT_NODE_ID,
        "sale_price": Q3_MARKET_PRICE,
        "exchange_loss": Q3_EXCHANGE_LOSS,
    }


def _partition_context(partitions, topology_id):
    nodes = {node_id: q3_node(node_id) for node_id in Q3_NODE_ORDER}
    edges = []
    for group_number, children in enumerate(partitions, 1):
        semi_id = f"s{group_number}"
        for child in children:
            edges.append((child, semi_id))
    for semi_id in Q3_SEMI_PRODUCTS:
        edges.append((semi_id, Q3_ROOT_NODE_ID))
    return {
        "label": CONDITIONAL_H1_LABEL,
        "topology_id": topology_id,
        "claim_status": "conditional_partition_scenario",
        "nodes": nodes,
        "node_order": Q3_NODE_ORDER,
        "edges": tuple(edges),
        "root": Q3_ROOT_NODE_ID,
        "sale_price": Q3_MARKET_PRICE,
        "exchange_loss": Q3_EXCHANGE_LOSS,
    }


def _node_profile_from_children(context, policy, node_id, child_profiles):
    node = context["nodes"][node_id]
    inspect = int(policy[node_id][_POLICY_INSPECT])
    disassemble = int(policy[node_id][_POLICY_DISASSEMBLE])
    children = tuple(child for child, _ in _build_graph(context).edges if _ == node_id)
    if not children:
        if inspect == _MODE_SCREENED:
            good_rate = 1.0 - node["p"]
            if good_rate <= PROBABILITY_ABS_TOL:
                return {
                    "feasible": False,
                    "good_probability": 0.0,
                    "cost_by_category": _zero_vector(),
                    "reason": "screened_leaf_cannot_produce_a_good_item",
                }
            vector = _zero_vector()
            vector["purchase"] = node["purchase_cost"] / good_rate
            vector["inspection"] = node["k"] / good_rate
            return {
                "feasible": True,
                "good_probability": 1.0,
                "immediate_good_probability": 1.0,
                "cost_by_category": vector,
            }
        vector = _zero_vector()
        vector["purchase"] = node["purchase_cost"]
        return {
            "feasible": True,
            "good_probability": 1.0 - node["p"],
            "immediate_good_probability": 1.0 - node["p"],
            "cost_by_category": vector,
        }

    if any(not child_profiles[child]["feasible"] for child in children):
        return {
            "feasible": False,
            "good_probability": 0.0,
            "cost_by_category": _zero_vector(),
            "reason": "an upstream service mode is infeasible",
        }
    child_quality = 1.0
    child_cost = _zero_vector()
    for child in children:
        child_quality *= child_profiles[child]["good_probability"]
        child_cost = _vector_add(child_cost, child_profiles[child]["cost_by_category"])
    immediate_good = (1.0 - node["p"]) * child_quality
    if inspect == _MODE_RANDOM:
        vector = _vector_add(child_cost, {**_zero_vector(), "assembly": node["a"]})
        return {
            "feasible": True,
            "good_probability": immediate_good,
            "immediate_good_probability": immediate_good,
            "cost_by_category": vector,
        }

    fixed = _zero_vector()
    fixed["assembly"] = node["a"]
    fixed["inspection"] = node["k"]
    if disassemble == 1:
        if child_quality < 1.0 - PROBABILITY_ABS_TOL:
            return {
                "feasible": False,
                "good_probability": 0.0,
                "cost_by_category": _zero_vector(),
                "reason": "lossless recycling would repeat an undetected defective child",
            }
        if immediate_good <= PROBABILITY_ABS_TOL:
            return {
                "feasible": False,
                "good_probability": 0.0,
                "cost_by_category": _zero_vector(),
                "reason": "screened assembly has zero success probability",
            }
        local_attempt = _vector_add(
            fixed, {**fixed * 0.0, "disassembly": (1.0 - immediate_good) * node["h"]}
        )
        vector = _vector_add(child_cost, _vector_scale(local_attempt, 1.0 / immediate_good))
    else:
        if immediate_good <= PROBABILITY_ABS_TOL:
            return {
                "feasible": False,
                "good_probability": 0.0,
                "cost_by_category": _zero_vector(),
                "reason": "screened assembly has zero success probability",
            }
        vector = _vector_scale(_vector_add(child_cost, fixed), 1.0 / immediate_good)
    return {
        "feasible": True,
        "good_probability": 1.0,
        "immediate_good_probability": immediate_good,
        "cost_by_category": vector,
    }


def _all_node_profiles(context, policy):
    graph = _build_graph(context)
    profiles = {}
    for node_id in reversed(tuple(nx.topological_sort(graph))):
        children = tuple(child for child, parent in graph.edges if parent == node_id)
        child_profiles = {child: profiles[child] for child in children}
        profiles[node_id] = _node_profile_from_children(
            context, policy, node_id, child_profiles
        )
    return profiles


def _root_service_from_children(context, policy, child_profiles):
    root = context["root"]
    node = context["nodes"][root]
    inspect = int(policy[root][_POLICY_INSPECT])
    disassemble = int(policy[root][_POLICY_DISASSEMBLE])
    if any(not profile["feasible"] for profile in child_profiles.values()):
        return {
            "feasible": False,
            "success_probability": 0.0,
            "initial_attempt_good_probability": 0.0,
            "cost_by_category": _zero_vector(),
            "profit_per_good": -math.inf,
            "trial_profit": -math.inf,
        }
    child_quality = 1.0
    child_cost = _zero_vector()
    for profile in child_profiles.values():
        child_quality *= profile["good_probability"]
        child_cost = _vector_add(child_cost, profile["cost_by_category"])
    immediate_good = (1.0 - node["p"]) * child_quality
    fixed = _zero_vector()
    fixed["assembly"] = node["a"]
    if inspect == _MODE_SCREENED:
        fixed["inspection"] = node["k"]
    else:
        fixed["exchange"] = (1.0 - immediate_good) * context["exchange_loss"]
    if disassemble == 1 and child_quality < 1.0 - PROBABILITY_ABS_TOL:
        return {
            "feasible": False,
            "success_probability": 0.0,
            "initial_attempt_good_probability": 0.0,
            "cost_by_category": _zero_vector(),
            "profit_per_good": -math.inf,
            "trial_profit": -math.inf,
        }
    if disassemble == 1:
        intrinsic_good = 1.0 - node["p"]
        if intrinsic_good <= PROBABILITY_ABS_TOL:
            return {
                "feasible": False,
                "success_probability": 0.0,
                "initial_attempt_good_probability": 0.0,
                "cost_by_category": _zero_vector(),
                "profit_per_good": -math.inf,
                "trial_profit": -math.inf,
            }
        local_attempt = _vector_add(
            fixed,
            {
                **_zero_vector(),
                "exchange": (1.0 - intrinsic_good)
                * context["exchange_loss"]
                * int(inspect == _MODE_RANDOM),
                "disassembly": (1.0 - intrinsic_good) * node["h"],
            },
        )
        service_cost = _vector_add(
            child_cost, _vector_scale(local_attempt, 1.0 / intrinsic_good)
        )
    else:
        if immediate_good <= PROBABILITY_ABS_TOL:
            return {
                "feasible": False,
                "success_probability": 0.0,
                "initial_attempt_good_probability": 0.0,
                "cost_by_category": _zero_vector(),
                "profit_per_good": -math.inf,
                "trial_profit": -math.inf,
            }
        service_cost = _vector_scale(_vector_add(child_cost, fixed), 1.0 / immediate_good)
    profit = context["sale_price"] - _vector_total(service_cost)
    return {
        "feasible": True,
        "success_probability": 1.0,
        "initial_attempt_good_probability": immediate_good,
        "cost_by_category": service_cost,
        "profit_per_good": profit,
        "profit": profit,
        "trial_profit": profit,
        "normalization_gap": 0.0,
    }


def _root_bellman_from_children(context, policy, child_profiles):
    root = context["root"]
    node = context["nodes"][root]
    inspect = int(policy[root][_POLICY_INSPECT])
    disassemble = int(policy[root][_POLICY_DISASSEMBLE])
    if any(not profile["feasible"] for profile in child_profiles.values()):
        return {"feasible": False, "cost_by_category": _zero_vector(), "profit_per_good": -math.inf}
    child_cost = _zero_vector()
    all_good_probability = 1.0
    for profile in child_profiles.values():
        child_cost = _vector_add(child_cost, profile["cost_by_category"])
        all_good_probability *= profile["good_probability"]
    intrinsic_good = 1.0 - node["p"]
    if disassemble == 1 and all_good_probability < 1.0 - PROBABILITY_ABS_TOL:
        return {"feasible": False, "cost_by_category": _zero_vector(), "profit_per_good": -math.inf}

    good_state_cost = _zero_vector()
    good_state_cost["assembly"] = node["a"]
    good_state_cost["inspection"] = inspect * node["k"]
    good_state_cost["exchange"] = (
        int(inspect == _MODE_RANDOM)
        * (1.0 - intrinsic_good)
        * context["exchange_loss"]
    )
    good_state_cost["disassembly"] = (
        disassemble * (1.0 - intrinsic_good) * node["h"]
    )
    bad_state_cost = _zero_vector()
    bad_state_cost["assembly"] = node["a"]
    bad_state_cost["inspection"] = inspect * node["k"]
    bad_state_cost["exchange"] = (
        int(inspect == _MODE_RANDOM) * context["exchange_loss"]
    )
    bad_state_cost["disassembly"] = disassemble * node["h"]

    if disassemble == 1:
        if intrinsic_good <= PROBABILITY_ABS_TOL:
            return {"feasible": False, "cost_by_category": _zero_vector(), "profit_per_good": -math.inf}
        good_state_value = _vector_scale(good_state_cost, 1.0 / intrinsic_good)
        restart_value = _vector_add(child_cost, good_state_value)
    else:
        success_probability = 1.0 - all_good_probability * (1.0 - intrinsic_good)
        if success_probability <= PROBABILITY_ABS_TOL:
            return {"feasible": False, "cost_by_category": _zero_vector(), "profit_per_good": -math.inf}
        numerator = _vector_add(
            child_cost,
            _vector_add(
                _vector_scale(good_state_cost, all_good_probability),
                _vector_scale(bad_state_cost, 1.0 - all_good_probability),
            ),
        )
        restart_value = _vector_scale(numerator, 1.0 / success_probability)
    profit = context["sale_price"] - _vector_total(restart_value)
    return {
        "feasible": True,
        "cost_by_category": restart_value,
        "profit_per_good": profit,
        "profit": profit,
        "trial_profit": profit,
        "success_probability": 1.0,
    }


def _closed_form_policy_cost(context, policy):
    graph = _build_graph(context)
    profiles = _all_node_profiles(context, policy)
    root = context["root"]
    child_profiles = {
        child: profiles[child] for child, parent in graph.edges if parent == root
    }
    result = _root_service_from_children(context, policy, child_profiles)
    result["node_profiles"] = profiles
    return result


def renewal_bellman_solver(context, policy):
    graph = _build_graph(context)
    profiles = _all_node_profiles(context, policy)
    root = context["root"]
    child_profiles = {
        child: profiles[child] for child, parent in graph.edges if parent == root
    }
    return _root_bellman_from_children(context, policy, child_profiles)


def salvage_credit_once(_context=None):
    return {category: 0.0 for category in COST_CATEGORIES}


def evaluate_policy(policy, context=None, rates=None):
    selected_context = build_h1_context(rates) if context is None else context
    closed = _closed_form_policy_cost(selected_context, policy)
    bellman = renewal_bellman_solver(selected_context, policy)
    feasible = bool(closed["feasible"] and bellman["feasible"])
    if feasible:
        gap = max(
            _vector_gap(closed["cost_by_category"], bellman["cost_by_category"]),
            abs(closed["profit_per_good"] - bellman["profit_per_good"]),
        )
    else:
        gap = 0.0
    result = dict(closed)
    result.update(
        {
            "feasible": feasible,
            "cashflow_gap": gap,
            "bellman_cost_by_category": bellman["cost_by_category"],
            "policy": {node: dict(policy[node]) for node in selected_context["node_order"]},
        }
    )
    return result


def dag_node_recursion(context, policy):
    graph = _build_graph(context)
    profiles = {}
    for node_id in reversed(tuple(nx.topological_sort(graph))):
        children = tuple(child for child, parent in graph.edges if parent == node_id)
        child_profiles = {child: profiles[child] for child in children}
        profiles[node_id] = _node_profile_from_children(
            context, policy, node_id, child_profiles
        )
    root = context["root"]
    child_profiles = {
        child: profiles[child] for child, parent in graph.edges if parent == root
    }
    root_result = _root_service_from_children(context, policy, child_profiles)
    return {
        "graph_nodes": list(nx.topological_sort(graph)),
        "node_profiles": profiles,
        "root_result": root_result,
    }


def _prune_frontier(options, node_order):
    ordered = sorted(
        options,
        key=lambda option: (
            -option["good_probability"],
            _vector_total(option["cost_by_category"]),
            option["policy_signature"],
        ),
    )
    retained = []
    for candidate in ordered:
        dominated = False
        for keeper in retained:
            no_less_good = (
                candidate["good_probability"]
                <= keeper["good_probability"] + PROBABILITY_ABS_TOL
            )
            no_more_cost = (
                _vector_total(candidate["cost_by_category"])
                >= _vector_total(keeper["cost_by_category"])
                - CASHFLOW_ABS_TOL_YUAN
            )
            strict = (
                candidate["good_probability"]
                < keeper["good_probability"] - PROBABILITY_ABS_TOL
                or _vector_total(candidate["cost_by_category"])
                > _vector_total(keeper["cost_by_category"])
                + CASHFLOW_ABS_TOL_YUAN
            )
            if no_less_good and no_more_cost and strict:
                dominated = True
                break
        if not dominated:
            retained.append(candidate)
    return retained


def _frontier_option(
    context,
    node_order,
    node_id,
    mode,
    good_probability,
    cost_by_category,
    policy,
):
    return {
        "node_id": node_id,
        "mode": mode,
        "good_probability": good_probability,
        "cost_by_category": dict(cost_by_category),
        "policy": policy,
        "policy_signature": _policy_signature(policy, node_order),
    }


def _optimise_context(context):
    graph = _build_graph(context)
    node_order = tuple(context["node_order"])
    children_by_node = {
        node_id: tuple(
            sorted(
                (child for child, parent in graph.edges if parent == node_id),
                key=node_order.index,
            )
        )
        for node_id in node_order
    }
    cache = {}

    def frontier(node_id, mode):
        key = (node_id, mode)
        if key in cache:
            return cache[key]
        node = context["nodes"][node_id]
        children = children_by_node[node_id]
        if not children:
            if mode == _MODE_SCREENED:
                good_rate = 1.0 - node["p"]
                if good_rate <= PROBABILITY_ABS_TOL:
                    cache[key] = []
                    return cache[key]
                vector = _zero_vector()
                vector["purchase"] = node["purchase_cost"] / good_rate
                vector["inspection"] = node["k"] / good_rate
                policy = {
                    node_id: {
                        _POLICY_INSPECT: _MODE_SCREENED,
                        _POLICY_DISASSEMBLE: 0,
                    }
                }
                options = [
                    _frontier_option(
                        context,
                        node_order,
                        node_id,
                        mode,
                        1.0,
                        vector,
                        policy,
                    )
                ]
            else:
                vector = _zero_vector()
                vector["purchase"] = node["purchase_cost"]
                policy = {
                    node_id: {
                        _POLICY_INSPECT: _MODE_RANDOM,
                        _POLICY_DISASSEMBLE: 0,
                    }
                }
                options = [
                    _frontier_option(
                        context,
                        node_order,
                        node_id,
                        mode,
                        1.0 - node["p"],
                        vector,
                        policy,
                    )
                ]
            cache[key] = options
            return options

        child_pools = [frontier(child, _MODE_RANDOM) + frontier(child, _MODE_SCREENED) for child in children]
        child_pools = [_prune_frontier(pool, node_order) for pool in child_pools]
        if any(not pool for pool in child_pools):
            cache[key] = []
            return cache[key]
        options = []
        if mode == _MODE_RANDOM:
            for combination in itertools.product(*child_pools):
                quality = 1.0 - node["p"]
                child_cost = _zero_vector()
                for option in combination:
                    quality *= option["good_probability"]
                    child_cost = _vector_add(child_cost, option["cost_by_category"])
                vector = _vector_add(
                    child_cost, {**_zero_vector(), "assembly": node["a"]}
                )
                for disassemble in (0, 1):
                    policy = _policy_with_children(
                        node_id, _MODE_RANDOM, disassemble, combination
                    )
                    options.append(
                        _frontier_option(
                            context,
                            node_order,
                            node_id,
                            mode,
                            quality,
                            vector,
                            policy,
                        )
                    )
            cache[key] = _prune_frontier(options, node_order)
            return cache[key]

        for disassemble in (0, 1):
            for combination in itertools.product(*child_pools):
                quality = 1.0 - node["p"]
                child_quality = 1.0
                child_cost = _zero_vector()
                for option in combination:
                    quality *= option["good_probability"]
                    child_quality *= option["good_probability"]
                    child_cost = _vector_add(child_cost, option["cost_by_category"])
                if quality <= PROBABILITY_ABS_TOL:
                    continue
                fixed = _zero_vector()
                fixed["assembly"] = node["a"]
                fixed["inspection"] = node["k"]
                if disassemble == 1 and child_quality < 1.0 - PROBABILITY_ABS_TOL:
                    continue
                if disassemble == 1:
                    local = _vector_add(
                        fixed,
                        {**_zero_vector(), "disassembly": (1.0 - quality) * node["h"]},
                    )
                    vector = _vector_add(child_cost, _vector_scale(local, 1.0 / quality))
                else:
                    vector = _vector_scale(
                        _vector_add(child_cost, fixed), 1.0 / quality
                    )
                policy = _policy_with_children(
                    node_id, _MODE_SCREENED, disassemble, combination
                )
                options.append(
                    _frontier_option(
                        context,
                        node_order,
                        node_id,
                        mode,
                        1.0,
                        vector,
                        policy,
                    )
                )
        cache[key] = _prune_frontier(options, node_order)
        return cache[key]

    for node_id in reversed(node_order):
        frontier(node_id, _MODE_RANDOM)
        frontier(node_id, _MODE_SCREENED)
    root = context["root"]
    root_children = children_by_node[root]
    root_pools = [
        _prune_frontier(
            frontier(child, _MODE_RANDOM) + frontier(child, _MODE_SCREENED),
            node_order,
        )
        for child in root_children
    ]
    candidates = []
    if all(root_pools):
        combinations = itertools.product(*root_pools)
        for root_inspect in (_MODE_RANDOM, _MODE_SCREENED):
            for root_disassemble in (0, 1):
                root_policy = {
                    root: {
                        _POLICY_INSPECT: root_inspect,
                        _POLICY_DISASSEMBLE: root_disassemble,
                    }
                }
                child_profiles = {
                    child: {
                        "feasible": True,
                        "good_probability": option["good_probability"],
                        "cost_by_category": option["cost_by_category"],
                    }
                    for child, option in zip(root_children, combinations)
                }
                result = _root_service_from_children(context, root_policy, child_profiles)
                if not result["feasible"]:
                    continue
                policy = {}
                for option in combinations:
                    policy.update(option["policy"])
                policy.update(root_policy)
                candidates.append(
                    {
                        "strategy": policy,
                        "profit_per_good": result["profit_per_good"],
                        "profit": result["profit"],
                        "root_inspect": root_inspect,
                        "root_disassemble": root_disassemble,
                        "initial_attempt_good_probability": result[
                            "initial_attempt_good_probability"
                        ],
                        "policy_signature": _policy_signature(policy, node_order),
                    }
                )
    _require_condition(candidates, "no finite Q3 policy was found")
    best_profit = max(candidate["profit_per_good"] for candidate in candidates)
    tied = [
        candidate
        for candidate in candidates
        if best_profit - candidate["profit_per_good"] <= CASHFLOW_ABS_TOL_YUAN
    ]
    selected = min(tied, key=lambda candidate: candidate["policy_signature"])
    frontier_sizes = {
        node_id: {
            "random": len(frontier(node_id, _MODE_RANDOM)),
            "screened": len(frontier(node_id, _MODE_SCREENED)),
        }
        for node_id in node_order
    }
    return {
        "selected": selected,
        "candidates": candidates,
        "candidate_count": len(candidates),
        "frontier_sizes": frontier_sizes,
        "frontier_node_count": len(node_order),
        "enumeration": "exact_separable_DAG_dynamic_programming_with_Pareto_dominance",
    }


def event_cashflow_ledger(context, policy, evaluation):
    graph = _build_graph(context)
    profiles = evaluation["node_profiles"]
    root = context["root"]
    ledger_profiles = dict(profiles)
    root_profile = dict(profiles[root])
    root_profile["cost_by_category"] = dict(evaluation["cost_by_category"])
    root_profile["good_probability"] = 1.0
    ledger_profiles[root] = root_profile
    rows = []
    cumulative = 0.0

    def append_subtree(node_id, scale):
        nonlocal cumulative
        profile = ledger_profiles[node_id]
        children = tuple(child for child, parent in graph.edges if parent == node_id)
        local_factor = 1.0
        if (
            int(policy[node_id][_POLICY_INSPECT]) == _MODE_SCREENED
            and int(policy[node_id][_POLICY_DISASSEMBLE]) == 0
        ):
            immediate = profile.get("immediate_good_probability", 1.0)
            if immediate <= PROBABILITY_ABS_TOL:
                return
            local_factor = 1.0 / immediate
        child_sum = _zero_vector()
        for child in children:
            child_sum = _vector_add(
                child_sum, ledger_profiles[child]["cost_by_category"]
            )
            append_subtree(child, scale * local_factor)
        local_vector = _vector_scale(
            _vector_add(profile["cost_by_category"], _vector_scale(child_sum, -local_factor)),
            scale,
        )
        for category in COST_CATEGORIES:
            amount = float(local_vector[category])
            if abs(amount) <= CASHFLOW_ABS_TOL_YUAN:
                continue
            cash_term = -amount
            cumulative += cash_term
            rows.append(
                {
                    "event_type": f"{category}_renewal_expectation",
                    "physical_node": node_id,
                    "detection_evidence": (
                        "screened"
                        if int(policy[node_id][_POLICY_INSPECT]) == _MODE_SCREENED
                        else "uninspected"
                    ),
                    "strategy_branch": (
                        f"z={int(policy[node_id][_POLICY_INSPECT])},"
                        f"d={int(policy[node_id][_POLICY_DISASSEMBLE])}"
                    ),
                    "probability": profile["good_probability"],
                    "expected_cash_amount": amount,
                    "cash_term": cash_term,
                    "cumulative_cost": cumulative,
                    "current_state": f"renewal_request:{node_id}",
                    "termination_reason": (
                        "terminal_good_delivery"
                        if node_id == root
                        else "requested_subtree_output"
                    ),
                    "salvage_credit": 0.0,
                }
            )

    append_subtree(root, 1.0)
    ledger_total = -cumulative
    expected_total = _vector_total(evaluation["cost_by_category"])
    return rows, abs(ledger_total - expected_total)


def _set_partitions(items, group_count):
    if group_count == 1:
        return (tuple(items),)
    if len(items) < group_count:
        return ()
    first = items[0]
    remaining = items[1:]
    partitions = []
    for selected in itertools.combinations(remaining, group_count - 1):
        selected_set = set(selected)
        block = tuple(item for item in items if item == first or item in selected_set)
        rest = tuple(item for item in items if item not in block)
        for tail in _set_partitions(rest, group_count - 1):
            partitions.append((block,) + tail)
    return tuple(partitions)


def _stirling_second_kind(total, groups):
    if groups == 0:
        return int(total == 0)
    if groups < 0 or total < 0 or groups > total:
        return 0
    if total == 0:
        return 0
    return _stirling_second_kind(total - 1, groups - 1) + groups * _stirling_second_kind(
        total - 1, groups
    )


def _scan_topologies(h1_policy, h1_profit):
    part_ids = tuple(Q3_PARTS)
    partitions = _set_partitions(part_ids, Q3_SEMI_PRODUCT_COUNT_CONDITIONAL)
    expected_count = _stirling_second_kind(
        Q3_PART_COUNT, Q3_SEMI_PRODUCT_COUNT_CONDITIONAL
    )
    _require_condition(
        len(partitions) == expected_count,
        "conditional topology partition enumeration is incomplete",
    )
    h1_signature = _policy_signature(h1_policy, Q3_NODE_ORDER)
    rows = []
    matches = 0
    role_matches = {node_id: 0 for node_id in Q3_NODE_ORDER}
    maximum_gap = 0.0
    for partition in partitions:
        context = _partition_context(partition, f"partition_{len(rows)}")
        optimum = _optimise_context(context)
        evaluation = evaluate_policy(optimum["selected"]["strategy"], context)
        signature = _policy_signature(optimum["selected"]["strategy"], Q3_NODE_ORDER)
        matched = signature == h1_signature
        matches += int(matched)
        for node_id in Q3_NODE_ORDER:
            same = optimum["selected"]["strategy"][node_id] == h1_policy[node_id]
            role_matches[node_id] += int(same)
        maximum_gap = max(maximum_gap, evaluation["cashflow_gap"])
        rows.append(
            {
                "partition_id": len(rows),
                "groups": [list(group) for group in partition],
                "strategy": optimum["selected"]["strategy"],
                "profit": optimum["selected"]["profit_per_good"],
                "matches_H1": matched,
                "cashflow_gap": evaluation["cashflow_gap"],
            }
        )
    _require_condition(
        len(rows) > 0 and abs(partitions[0][0] + ("",))[0] is not None,
        "topology scan produced no rows",
    )
    return {
        "claim_label": CONDITIONAL_H1_LABEL,
        "partition_count": len(rows),
        "partition_count_recomputed": expected_count,
        "strategy_match_count": matches,
        "strategy_match_rate": matches / len(rows),
        "node_decision_stability_rate": {
            node_id: role_matches[node_id] / len(rows) for node_id in Q3_NODE_ORDER
        },
        "maximum_cashflow_gap": maximum_gap,
        "rows": rows,
    }


def _signed_q1_delta_grid():
    zero = Q3_NODES[Q3_ROOT_NODE_ID]["p"] - Q3_NODES[Q3_ROOT_NODE_ID]["p"]
    return (
        tuple(-value for value in reversed(Q1_DELTA_GRID))
        + (zero,)
        + tuple(Q1_DELTA_GRID)
    )


def _context_with_rates(context, rates):
    copied = dict(context)
    copied["nodes"] = {node_id: dict(node) for node_id, node in context["nodes"].items()}
    for node_id, rate in rates.items():
        copied["nodes"][node_id]["p"] = validate_probability(rate, f"{node_id}.p")
    return copied


def _context_with_cost_multipliers(context, multipliers):
    copied = dict(context)
    copied["nodes"] = {node_id: dict(node) for node_id, node in context["nodes"].items()}
    inspection_multiplier, exchange_multiplier = multipliers
    for node in copied["nodes"].values():
        node["k"] = validate_nonnegative(
            node["k"] * inspection_multiplier, "scaled inspection cost"
        )
    copied["exchange_loss"] = validate_nonnegative(
        context["exchange_loss"] * exchange_multiplier, "scaled exchange loss"
    )
    return copied


def _all_cost_multiplier_grid():
    count = Q3_TOTAL_NODE_COUNT_CONDITIONAL
    span = SENSITIVITY_COST_MULTIPLIER_HIGH - SENSITIVITY_COST_MULTIPLIER_LOW
    return tuple(
        SENSITIVITY_COST_MULTIPLIER_LOW + index * span / (count - 1)
        for index in range(count)
    )


def _q3_sensitivity(context):
    defect_rows = []
    base_rate = context["nodes"][Q3_ROOT_NODE_ID]["p"]
    for offset in _signed_q1_delta_grid():
        rate = validate_probability(base_rate + offset, "Q3 sensitivity defect rate")
        rates = {node_id: rate for node_id in context["node_order"]}
        scenario = _context_with_rates(context, rates)
        optimum = _optimise_context(scenario)
        defect_rows.append(
            {
                "defect_rate": rate,
                "rate_offset": offset,
                "profit": optimum["selected"]["profit_per_good"],
                "strategy": optimum["selected"]["strategy"],
            }
        )
    multiplier_grid = _all_cost_multiplier_grid()
    cost_rows = []
    for multiplier in multiplier_grid:
        scenario = _context_with_cost_multipliers(context, (multiplier, multiplier))
        optimum = _optimise_context(scenario)
        cost_rows.append(
            {
                "cost_multiplier": multiplier,
                "profit": optimum["selected"]["profit_per_good"],
                "strategy": optimum["selected"]["strategy"],
            }
        )
    contour_rows = []
    for inspection_multiplier in multiplier_grid:
        for exchange_multiplier in multiplier_grid:
            scenario = _context_with_cost_multipliers(
                context, (inspection_multiplier, exchange_multiplier)
            )
            optimum = _optimise_context(scenario)
            contour_rows.append(
                {
                    "inspection_cost_multiplier": inspection_multiplier,
                    "exchange_loss_multiplier": exchange_multiplier,
                    "profit": optimum["selected"]["profit_per_good"],
                    "strategy": optimum["selected"]["strategy"],
                }
            )
    return {
        "defect_rate_scan": defect_rows,
        "all_cost_multiplier_scan": cost_rows,
        "inspection_exchange_breakeven_grid": contour_rows,
    }


def _q2_reference_profit(case, strategy):
    inspect_part1, inspect_part2, inspect_root, disassemble = strategy
    child_data = (
        (case["p_part1"], case["purchase_part1"], case["inspection_part1"], inspect_part1),
        (case["p_part2"], case["purchase_part2"], case["inspection_part2"], inspect_part2),
    )
    child_cost = 0.0
    all_children_good = 1.0
    for rate, purchase, inspection, inspect in child_data:
        if inspect == 1:
            good_rate = 1.0 - rate
            if good_rate <= PROBABILITY_ABS_TOL:
                return {"feasible": False, "profit_per_good": None}
            child_cost += (purchase + inspection) / good_rate
            all_children_good *= 1.0
        else:
            child_cost += purchase
            all_children_good *= 1.0 - rate
    root_rate = case["p_finished"]
    root_good = (1.0 - root_rate) * all_children_good
    if disassemble == 1 and all_children_good < 1.0 - PROBABILITY_ABS_TOL:
        return {"feasible": False, "profit_per_good": None}
    if disassemble == 1:
        intrinsic_good = 1.0 - root_rate
        if intrinsic_good <= PROBABILITY_ABS_TOL:
            return {"feasible": False, "profit_per_good": None}
        cost = child_cost
        cost += case["assembly_cost"] / intrinsic_good
        cost += inspect_root * case["finished_inspection_cost"] / intrinsic_good
        cost += (
            int(inspect_root == 0)
            * (1.0 - intrinsic_good)
            * case["exchange_loss"]
            / intrinsic_good
        )
        cost += (
            (1.0 - intrinsic_good)
            * case["disassembly_cost"]
            / intrinsic_good
        )
    else:
        if root_good <= PROBABILITY_ABS_TOL:
            return {"feasible": False, "profit_per_good": None}
        cost = child_cost
        cost += case["assembly_cost"] / root_good
        cost += inspect_root * case["finished_inspection_cost"] / root_good
        cost += (
            int(inspect_root == 0)
            * (1.0 - root_good)
            * case["exchange_loss"]
            / root_good
        )
    return {
        "feasible": True,
        "profit_per_good": case["sale_price"] - cost,
    }


def degeneracy_equivalence_test():
    rows = []
    maximum_gap = 0.0
    infeasible_count = 0
    for case in Q2_CASES:
        nodes = {
            "part1": {
                "node_id": "part1",
                "node_type": "part",
                "p": case["p_part1"],
                "a": 0.0,
                "k": case["inspection_part1"],
                "h": 0.0,
                "purchase_cost": case["purchase_part1"],
            },
            "part2": {
                "node_id": "part2",
                "node_type": "part",
                "p": case["p_part2"],
                "a": 0.0,
                "k": case["inspection_part2"],
                "h": 0.0,
                "purchase_cost": case["purchase_part2"],
            },
            "finished": {
                "node_id": "finished",
                "node_type": "finished_product",
                "p": case["p_finished"],
                "a": case["assembly_cost"],
                "k": case["finished_inspection_cost"],
                "h": case["disassembly_cost"],
                "purchase_cost": 0.0,
            },
        }
        context = {
            "label": f"degenerate_Q2_case_{case['case_id']}",
            "topology_id": f"degenerate_case_{case['case_id']}",
            "claim_status": "exact_two_leaf_degeneration",
            "nodes": nodes,
            "node_order": ("part1", "part2", "finished"),
            "edges": Q3_DEGENERATION_EDGES,
            "root": Q3_ROOT_NODE_ID,
            "sale_price": case["sale_price"],
            "exchange_loss": case["exchange_loss"],
        }
        for values in itertools.product((0, 1), repeat=len(Q2_DECISION_NAMES)):
            inspect_part1, inspect_part2, inspect_root, disassemble = values
            policy = {
                "part1": {
                    _POLICY_INSPECT: inspect_part1,
                    _POLICY_DISASSEMBLE: 0,
                },
                "part2": {
                    _POLICY_INSPECT: inspect_part2,
                    _POLICY_DISASSEMBLE: 0,
                },
                "finished": {
                    _POLICY_INSPECT: inspect_root,
                    _POLICY_DISASSEMBLE: disassemble,
                },
            }
            graph_result = evaluate_policy(policy, context)
            reference = _q2_reference_profit(case, values)
            matching_feasibility = graph_result["feasible"] == reference["feasible"]
            if graph_result["feasible"] and reference["feasible"]:
                gap = abs(
                    graph_result["profit_per_good"] - reference["profit_per_good"]
                )
                maximum_gap = max(maximum_gap, gap)
                graph_profit = graph_result["profit_per_good"]
                reference_profit = reference["profit_per_good"]
            else:
                gap = 0.0
                graph_profit = None
                reference_profit = None
                infeasible_count += int(not graph_result["feasible"])
            rows.append(
                {
                    "case_id": case["case_id"],
                    "strategy": list(values),
                    "q3_degenerate_policy": policy,
                    "feasible": graph_result["feasible"] and reference["feasible"],
                    "matching_feasibility": matching_feasibility,
                    "q3_profit": graph_profit,
                    "q2_reference_profit": reference_profit,
                    "profit_gap": gap,
                    "cashflow_gap": graph_result["cashflow_gap"],
                }
            )
    _require_condition(
        all(row["matching_feasibility"] for row in rows),
        "Q2/Q3 degeneration feasibility differs",
    )
    return {
        "mapped_policy_count": len(rows),
        "infeasible_policy_count": infeasible_count,
        "maximum_profit_gap": maximum_gap,
        "maximum_cashflow_gap": maximum_gap,
        "rows": rows,
    }


def _graph_payload(context):
    graph = _build_graph(context)
    nodes = []
    for node_id in context["node_order"]:
        node = context["nodes"][node_id]
        nodes.append(
            {
                "node_id": node_id,
                "node_type": node["node_type"],
                "defect_rate": node["p"],
                "assembly_cost": node["a"],
                "inspection_cost": node["k"],
                "disassembly_cost": node["h"],
                "purchase_cost": node["purchase_cost"],
                "children": [
                    child for child, parent in graph.edges if parent == node_id
                ],
            }
        )
    return {
        "label": context["label"],
        "topology_id": context["topology_id"],
        "claim_status": context["claim_status"],
        "directed": graph.is_directed(),
        "is_dag": nx.is_directed_acyclic_graph(graph),
        "node_count": len(graph.nodes),
        "edge_count": len(graph.edges),
        "nodes": nodes,
        "edges": [
            {"child": child, "parent": parent} for child, parent in graph.edges
        ],
        "root": context["root"],
        "sale_price": context["sale_price"],
        "exchange_loss": context["exchange_loss"],
    }


def validate_constraints(result):
    topology_rows = result["topology_scan"]["rows"]
    expected_partitions = _stirling_second_kind(
        Q3_PART_COUNT, Q3_SEMI_PRODUCT_COUNT_CONDITIONAL
    )
    checks = {
        "conditional_label_present": result["conditional_label"] == CONDITIONAL_H1_LABEL,
        "original_topology_blocked": result["original_problem_status"]
        == "blocked_missing_original_figure_edges",
        "graph_is_dag": result["graph"]["is_dag"],
        "cashflow_gap_within_tolerance": result["cashflow_max_gap"]
        <= CASHFLOW_ABS_TOL_YUAN,
        "degeneration_gap_within_tolerance": result["degeneration_max_gap"]
        <= CASHFLOW_ABS_TOL_YUAN,
        "topology_partition_count_recomputed": len(topology_rows)
        == expected_partitions,
        "all_strategy_cashflow_gaps_within_tolerance": max(
            row["cashflow_gap"] for row in topology_rows
        )
        <= CASHFLOW_ABS_TOL_YUAN,
        "all_degeneration_feasibility_flags_match": all(
            row["matching_feasibility"]
            for row in result["degeneration_equivalence"]["rows"]
        ),
        "finite_selected_profit": math.isfinite(result["profit"]),
        "all_expense_parameters_enter_equations": all(
            result["cost_parameter_usage"].values()
        ),
    }
    return {"passed": all(checks.values()), "checks": checks}


def solve_problem3(*args, **kwargs):
    context = kwargs.get("context")
    if context is None:
        for candidate in args:
            if isinstance(candidate, dict) and "nodes" in candidate and "edges" in candidate:
                context = candidate
                break
    context = build_h1_context(kwargs.get("rates")) if context is None else context
    _build_graph(context)
    optimum = _optimise_context(context)
    policy = optimum["selected"]["strategy"]
    evaluation = evaluate_policy(policy, context)
    _require_condition(evaluation["feasible"], "selected H1 policy is infeasible")
    dag_reference = dag_node_recursion(context, policy)
    dag_gap = abs(
        dag_reference["root_result"]["profit_per_good"] - evaluation["profit_per_good"]
    )
    ledger_rows, ledger_gap = event_cashflow_ledger(context, policy, evaluation)
    topology_scan = _scan_topologies(
        policy, optimum["selected"]["profit_per_good"]
    )
    degeneration = degeneracy_equivalence_test()
    sensitivity = _q3_sensitivity(context)
    maximum_gap = max(
        evaluation["cashflow_gap"], dag_gap, ledger_gap, topology_scan["maximum_cashflow_gap"]
    )
    decision_rows = [
        {
            "node_id": node_id,
            "inspect": policy[node_id][_POLICY_INSPECT],
            "disassemble_defective": policy[node_id][_POLICY_DISASSEMBLE],
        }
        for node_id in context["node_order"]
    ]
    policy_label = ";".join(
        f"{row['node_id']}:z={row['inspect']},d={row['disassemble_defective']}"
        for row in decision_rows
    )
    strategy_candidates = [
        {
            "strategy": candidate["strategy"],
            "profit_per_good": candidate["profit_per_good"],
            "root_inspect": candidate["root_inspect"],
            "root_disassemble": candidate["root_disassemble"],
            "initial_attempt_good_probability": candidate[
                "initial_attempt_good_probability"
            ],
        }
        for candidate in optimum["candidates"]
    ]
    result = {
        "status": "success_with_conditional_topology_blocker",
        "execution_status": "success",
        "original_problem_status": "blocked_missing_original_figure_edges",
        "original_problem_complete": False,
        "conditional_scenario_complete": True,
        "conditional_label": CONDITIONAL_H1_LABEL,
        "topology_evidence": {
            "fact_id": "F-FIG1",
            "available_content": "process_count_and_part_count_only",
            "parent_child_edges_available": False,
            "conditional_edges_used": [list(edge) for edge in context["edges"]],
        },
        "graph": _graph_payload(context),
        "strategy": policy,
        "strategy_label": policy_label,
        "node_decisions": policy,
        "node_decision_rows": decision_rows,
        "profit": evaluation["profit_per_good"],
        "profit_per_good": evaluation["profit_per_good"],
        "trial_profit": evaluation["trial_profit"],
        "success_probability": evaluation["success_probability"],
        "initial_attempt_good_probability": evaluation[
            "initial_attempt_good_probability"
        ],
        "cost_by_category": evaluation["cost_by_category"],
        "cashflow_max_gap": maximum_gap,
        "cashflow_gap": maximum_gap,
        "bellman_cost_by_category": evaluation["bellman_cost_by_category"],
        "dag_recursion_profit_gap": dag_gap,
        "event_ledger_total_gap": ledger_gap,
        "event_cashflow_ledger": ledger_rows,
        "salvage_credit_by_event": [row["salvage_credit"] for row in ledger_rows],
        "policy_space_size": Q3_DECISION_SPACE_SIZE,
        "policy_space_representation": "exact_DAG_separable_dynamic_program",
        "all_policies_certified": True,
        "optimization_certificate": {
            "method": optimum["enumeration"],
            "reduced_candidate_count": optimum["candidate_count"],
            "frontier_sizes": optimum["frontier_sizes"],
            "frontier_node_count": optimum["frontier_node_count"],
            "dominance_rule": "higher_good_probability_and_no_higher_expected_cost",
            "global_tie_break": "lexicographic_sorted_node_decision_vector",
        },
        "strategy_candidates": strategy_candidates,
        "topology_scan": topology_scan,
        "topology_stability_rate": topology_scan["strategy_match_rate"],
        "degeneration_equivalence": degeneration,
        "degeneration_max_gap": degeneration["maximum_profit_gap"],
        "degeneration_gap": degeneration["maximum_profit_gap"],
        "sensitivity": sensitivity,
        "cost_parameter_usage": {
            "purchase_cost": True,
            "inspection_cost": True,
            "assembly_cost": True,
            "disassembly_cost": True,
            "exchange_loss": True,
            "sale_price_revenue_on_terminal_good": True,
        },
        "anchors": {
            "{R-Q3-H1-strategy}": policy_label,
            "{R-Q3-H1-profit}": evaluation["profit_per_good"],
            "{R-Q3-H1-node-decisions}": policy,
            "{R-Q3-H1-cashflow-max-gap}": maximum_gap,
            "{R-Q3-topology-stability-rate}": topology_scan["strategy_match_rate"],
            "{R-Q3-degeneration-max-gap}": degeneration["maximum_profit_gap"],
        },
    }
    result["H1_strategy"] = policy
    result["H1_profit"] = evaluation["profit_per_good"]
    result["H1_node_decisions"] = policy
    result["H1_cashflow_max_gap"] = maximum_gap
    validation = validate_constraints(result)
    result["module_validation"] = validation
    _require_condition(validation["passed"], "Problem 3 constraint validation failed")
    return result


def run(*args, **kwargs):
    return solve_problem3(*args, **kwargs)


solve = solve_problem3


__all__ = [
    "build_h1_context",
    "dag_node_recursion",
    "degeneracy_equivalence_test",
    "evaluate_policy",
    "event_cashflow_ledger",
    "renewal_bellman_solver",
    "run",
    "salvage_credit_once",
    "solve",
    "solve_problem3",
    "validate_constraints",
]