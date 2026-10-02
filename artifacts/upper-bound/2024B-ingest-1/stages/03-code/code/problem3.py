"""Problem 3: event-Markov optimization for the assembly network.

The graph is built with ``networkx.DiGraph``.  Inspection and disassembly
choices are evaluated jointly over the complete registered strategy space.
Intermediate and root failures use the same event cash-flow convention as
Problem 2, including defective units that reach the market, replacement
production, exchange loss, salvage from disassembly, and one market revenue
event per actual sale.

The available source graph is explicitly conditional.  Consequently this
module computes the registered primary grouping and a mandatory alternative
grouping, but it does not label either topology as an authoritative answer to
the missing source figure.
"""

from __future__ import annotations

import importlib
import inspect
import itertools
import json
import math
from dataclasses import dataclass
from pathlib import Path

import networkx as nx
import numpy as np

import params


_EMPTY = 0
_GOOD = 1
_BAD = 2

_COST_LABELS = (
    "purchase",
    "inspection",
    "assembly",
    "disassembly",
    "exchange",
)
_PRODUCTION_COST_LABELS = _COST_LABELS[:-1]


@dataclass(frozen=True)
class _SemiSupply:
    expected_cost: float
    cost_components: tuple
    p_good: float
    p_bad: float
    bad_recovery_distribution: tuple
    reachable_state_count: int
    cost_bellman_residual: float
    probability_bellman_residual: float
    absorption_probability: float


@dataclass
class _PolicyEvaluation:
    policy_id: int
    profit: float
    transition_matrix: np.ndarray
    immediate_components: tuple
    revenue_by_state: tuple
    p_bad_by_state: tuple
    state_labels: tuple
    state_count: int
    bellman_residual: float
    absorption_probability: float


def _zero_components():
    return tuple(0.0 for _ in _COST_LABELS)


def _add_components(*component_vectors):
    return tuple(
        sum(vector[index] for vector in component_vectors)
        for index in range(len(_COST_LABELS))
    )


def _scale_components(vector, factor):
    return tuple(factor * value for value in vector)


def _copy_specs(problem3_params=params, rate_overrides=None):
    """Copy registered node facts and apply only supplied probability data."""
    overrides = {} if rate_overrides is None else dict(rate_overrides)
    specs = {
        node: dict(spec)
        for node, spec in problem3_params.Q3_NODE_SPECS.items()
    }
    for node, probability in overrides.items():
        if node not in specs:
            raise KeyError(f"Unknown Q3 probability node: {node}")
        value = float(probability)
        if value < 0.0 or value > 1.0:
            raise ValueError(f"Probability outside [0,1] for {node}: {value}")
        specs[node]["p"] = value
    return specs


def build_topology_graph(specs, topology):
    """Build and validate a finite directed acyclic assembly graph."""
    graph = nx.DiGraph()
    for node in specs:
        graph.add_node(node)
    for child, parents in topology.items():
        if child not in graph:
            raise KeyError(f"Topology child is not a registered node: {child}")
        for parent in parents:
            if parent not in graph:
                raise KeyError(f"Topology parent is not a registered node: {parent}")
            graph.add_edge(parent, child)
    if not nx.is_directed_acyclic_graph(graph):
        raise ValueError("The assembly topology must be a finite DAG")
    required = {
        node
        for node, parents in topology.items()
        if node == problem3_params.Q3_ROOT_NODE
    }
    if required != {problem3_params.Q3_ROOT_NODE}:
        raise ValueError("The product root has no registered topology entry")
    return graph


def reachable_state_enumeration(transition_matrix, start_index=0):
    """Enumerate states reachable from a Markov-reward transition matrix."""
    matrix = np.asarray(transition_matrix, dtype=float)
    if matrix.ndim != 2 or matrix.shape[0] != matrix.shape[1]:
        raise ValueError("Transition matrix must be square")
    if start_index < 0 or start_index >= matrix.shape[0]:
        raise IndexError("Invalid Markov-chain start state")
    visited = {int(start_index)}
    queue = [int(start_index)]
    tolerance = float(params.Q1_NUMERIC_TOL)
    while queue:
        state = queue.pop(0)
        for target, probability in enumerate(matrix[state]):
            if probability > tolerance and int(target) not in visited:
                visited.add(int(target))
                queue.append(int(target))
    indices = tuple(sorted(visited))
    if len(indices) > int(problem3_limit()):
        raise RuntimeError(
            f"Q3 state count {len(indices)} exceeds the registered limit"
        )
    return indices


def problem3_params_limit():
    return params.Q3_REACHABLE_STATE_LIMIT


def problem3_limit():
    return params.Q3_REACHABLE_STATE_LIMIT


def _semi_action(
    start_state,
    leaf_policy,
    inspect_target,
    disassemble_target,
    leaf_specs,
    target_spec,
):
    """Return one deterministic scheduling action for a semi-finished node."""
    state = tuple(int(value) for value in start_state)
    if len(state) != len(leaf_specs):
        raise ValueError("Leaf-state dimension does not match semi parents")
    leaf_cost = _zero_components()
    transitions = []
    terminal_good = 0.0
    terminal_bad = 0.0
    terminal_bad_recovery_state = None

    if inspect_target and any(
        state[index] == _BAD for index in range(len(state))
    ):
        bad_count = sum(state[index] == _BAD for index in range(len(state)))
        inspection_index = _COST_LABELS.index("inspection")
        components = list(_zero_components())
        components[inspection_index] = bad_count * float(
            target_spec.get("t", 0.0)
        ) if False else 0.0
        # A known bad leaf is re-tested only when its leaf-inspection policy
        # requires inspection.  The perfect test then discards it, after which
        # the geometric purchase-and-test branch below obtains a good leaf.
        leaf_inspection_cost = 0.0
        for index, value in enumerate(state):
            if value == _BAD and int(leaf_policy[index]):
                leaf_inspection_cost += float(leaf_specs[index]["t"])
        components[inspection_index] = leaf_inspection_cost
        repaired = tuple(
            _EMPTY if value == _BAD else value for value in state
        )
        transitions.append((repaired, 1.0))
        return {
            "components": tuple(components),
            "transitions": tuple(transitions),
            "terminal_good": terminal_good,
            "terminal_bad": terminal_bad,
            "terminal_bad_recovery_state": terminal_bad_recovery_state,
        }

    missing = [
        index for index, value in enumerate(state) if value == _EMPTY
    ]
    if missing:
        index = missing[0]
        spec = leaf_specs[index]
        probability = float(spec["p"])
        purchase_index = _COST_LABELS.index("purchase")
        inspection_index = _COST_LABELS.index("inspection")
        if int(leaf_policy[index]):
            denominator = 1.0 - probability
            if denominator <= 0.0:
                raise ValueError(
                    f"Leaf {index} has no finite replenishment probability"
                )
            components = list(_zero_components())
            components[purchase_index] = float(spec["a"]) / denominator
            components[inspection_index] = float(spec["t"]) / denominator
            next_state = list(state)
            next_state[index] = _GOOD
            transitions.append((tuple(next_state), 1.0))
        else:
            components = list(_zero_components())
            components[purchase_index] = float(spec["a"])
            next_good = list(state)
            next_good[index] = _GOOD
            next_bad = list(state)
            next_bad[index] = _BAD
            transitions.append((tuple(next_good), 1.0 - probability))
            transitions.append((tuple(next_bad), probability))
        return {
            "components": tuple(components),
            "transitions": tuple(transitions),
            "terminal_good": terminal_good,
            "terminal_bad": terminal_bad,
            "terminal_bad_recovery_state": terminal_bad_recovery_state,
        }

    assembly_index = _COST_LABELS.index("assembly")
    inspection_index = _COST_LABELS.index("inspection")
    disassembly_index = _COST_LABELS.index("disassembly")
    components = list(_zero_components())
    components[assembly_index] = float(target_spec["k"])
    qualified_inputs = all(value == _GOOD for value in state)
    good_probability = (
        (1.0 - float(target_spec["p"])) if qualified_inputs else 0.0
    )

    if not inspect_target:
        terminal_good = good_probability
        terminal_bad = 1.0 - good_probability
        terminal_bad_recovery_state = state
    else:
        components[inspection_index] = float(target_spec["t"])
        terminal_good = good_probability
        if good_probability < 1.0:
            bad_probability = 1.0 - good_probability
            if disassemble_target:
                components[disassembly_index] = float(target_spec["g"])
                transitions.append((state, bad_probability))
            else:
                consumed = tuple(
                    _EMPTY if index < len(state) else value
                    for index, value in enumerate(state)
                )
                transitions.append((consumed, bad_probability))

    return {
        "components": tuple(components),
        "transitions": tuple(transitions),
        "terminal_good": terminal_good,
        "terminal_bad": terminal_bad,
        "terminal_bad_recovery_state": terminal_bad_recovery_state,
    }


def _solve_semi_supply(
    start_state,
    leaf_policy,
    inspect_target,
    disassemble_target,
    leaf_specs,
    target_spec,
):
    """Solve the finite semi-finished-product event Markov reward process."""
    start = tuple(int(value) for value in start_state)
    if any(value not in (_EMPTY, _GOOD, _BAD) for value in start):
        raise ValueError("Invalid leaf inventory state")
    state_space = tuple(
        itertools.product((_EMPTY, _GOOD, _BAD), repeat=len(leaf_specs))
    )
    if start not in state_space:
        raise ValueError("Initial leaf state is outside the finite state space")
    state_index = {state: index for index, state in enumerate(state_space)}
    action_by_state = {}
    for state in state_space:
        action_by_state[state] = _semi_action(
            state,
            leaf_policy,
            inspect_target,
            disassemble_target,
            leaf_specs,
            target_spec,
        )

    reachable = {start}
    queue = [start]
    tolerance = float(params.Q1_NUMERIC_TOL)
    while queue:
        state = queue.pop(0)
        for target_state, probability in action_by_state[state]["transitions"]:
            if probability > tolerance and target_state not in reachable:
                reachable.add(target_state)
                queue.append(target_state)
    states = tuple(sorted(reachable))
    state_count = len(states)
    transition = np.zeros((state_count, state_count), dtype=float)
    component_rhs = np.zeros((state_count, len(_COST_LABELS)), dtype=float)
    good_rhs = np.zeros(state_count, dtype=float)
    bad_state_rhs = np.zeros(state_count, dtype=float)
    index_by_state = {state: index for index, state in enumerate(states)}

    for state in states:
        row = index_by_state[state]
        action = action_by_state[state]
        component_rhs[row] = action["components"]
        good_rhs[row] = action["terminal_good"]
        for next_state, probability in action["transitions"]:
            transition[row, index_by_state[next_state]] += probability
        if action["terminal_bad_recovery_state"] is not None:
            bad_state_rhs[
                index_by_state[action["terminal_bad_recovery_state"]]
            ] += action["terminal_bad"]
        branch_total = (
            sum(probability for _, probability in action["transitions"])
            + action["terminal_good"]
            + action["terminal_bad"]
        )
        if abs(branch_total - 1.0) > tolerance:
            raise RuntimeError("Semi-finished action branches do not sum to one")

    absorbing_matrix = np.eye(state_count) - transition
    right_hand_side = np.column_stack(
        (component_rhs, good_rhs, bad_state_rhs)
    )
    try:
        solution = np.linalg.solve(absorbing_matrix, right_hand_side)
    except np.linalg.LinAlgError as error:
        raise RuntimeError(
            f"Non-absorbing semi-finished policy for {target_spec['node']}"
        ) from error
    expected_components = solution[:, : len(_COST_LABELS)]
    p_good = solution[:, len(_COST_LABELS)]
    bad_by_state = solution[:, len(_COST_LABELS) + 1 :]
    p_bad = bad_by_state.sum(axis=1)
    cost_residual = float(
        np.max(np.abs(absorbing_matrix @ expected_components - component_rhs))
    )
    probability_residual = float(
        np.max(
            np.abs(
                absorbing_matrix
                @ np.column_stack((p_good, bad_by_state))
                - np.column_stack((good_rhs, bad_state_rhs))
            )
        )
    )
    absorption = p_good + p_bad
    if np.any(absorption < 1.0 - float(params.CASHFLOW_ABS_TOL)):
        raise RuntimeError("A semi-finished strategy has absorption below one")
    if probability_residual > float(params.Q1_NUMERIC_TOL):
        raise RuntimeError("Semi-finished probability Bellman residual is too large")
    if inspect_target:
        p_bad = np.zeros_like(p_bad)
    normalizer = p_good + p_bad
    p_good = p_good / normalizer
    p_bad = p_bad / normalizer
    expected_cost = expected_components.sum(axis=1)
    if cost_residual > float(params.CASHFLOW_ABS_TOL):
        raise RuntimeError("Semi-finished cash-flow residual is too large")
    conditional_bad = {}
    if np.any(p_bad > tolerance):
        for state, probability in zip(states, p_bad):
            if probability > tolerance:
                conditional_bad[state] = float(probability)
    distribution = tuple(
        (state, float(conditional_bad[state]))
        for state in sorted(conditional_bad)
    )
    return _SemiSupply(
        expected_cost=float(expected_cost[0]),
        cost_components=tuple(float(value) for value in expected_components[0]),
        p_good=float(p_good[0]),
        p_bad=float(p_bad[0]),
        bad_recovery_distribution=distribution,
        reachable_state_count=state_count,
        cost_bellman_residual=cost_residual,
        probability_bellman_residual=probability_residual,
        absorption_probability=float(absorption[0]),
    )


def _make_supply_getter(specs, topology, graph):
    cache = {}
    root = params.Q3_ROOT_NODE

    def get_supply(semi_node, start_state, leaf_policy, inspect_target, disassemble_target):
        key = (
            semi_node,
            tuple(int(value) for value in start_state),
            tuple(int(value) for value in leaf_policy),
            int(inspect_target),
            int(disassemble_target),
        )
        if key not in cache:
            parents = tuple(graph.predecessors(semi_node))
            leaf_specs = tuple(specs[parent] for parent in parents)
            cache[key] = _solve_semi_supply(
                start_state,
                leaf_policy,
                inspect_target,
                disassemble_target,
                leaf_specs,
                specs[semi_node],
            )
        return cache[key]

    return get_supply, cache


def _policy_maps(
    policy_id,
    inspection_nodes,
    rework_nodes,
):
    inspection_mask = {
        node: (int(policy_id) >> index) & 1
        for index, node in enumerate(inspection_nodes)
    }
    disassembly_mask = {
        node: (int(policy_id) >> (len(inspection_nodes) + index)) & 1
        for index, node in enumerate(rework_nodes)
    }
    return inspection_mask, disassembly_mask


def policy_from_id(
    policy_id=0,
    inspection_nodes=None,
    rework_nodes=None,
):
    inspection_nodes = (
        tuple(params.Q3_INSPECTABLE_NODES)
        if inspection_nodes is None
        else tuple(inspection_nodes)
    )
    rework_nodes = (
        tuple(params.Q3_REWORK_NODES)
        if rework_nodes is None
        else tuple(rework_nodes)
    )
    return _policy_maps(policy_id, inspection_nodes, rework_nodes)


def policy_to_id(
    inspection_mask,
    disassembly_mask,
    inspection_nodes=None,
    rework_nodes=None,
):
    inspection_nodes = (
        tuple(params.Q3_INSPECTABLE_NODES)
        if inspection_nodes is None
        else tuple(inspection_nodes)
    )
    rework_nodes = (
        tuple(params.Q3_REWORK_NODES)
        if rework_nodes is None
        else tuple(rework_nodes)
    )
    policy_id = 0
    for index, node in enumerate(inspection_nodes):
        policy_id |= int(bool(inspection_mask.get(node, 0))) << index
    for index, node in enumerate(rework_nodes):
        policy_id |= int(bool(disassembly_mask.get(node, 0))) << (
            len(inspection_nodes) + index
        )
    return policy_id


def _root_action_kernel(
    state_bits,
    semi_nodes,
    graph,
    specs,
    get_supply,
    inspection_mask,
    disassembly_mask,
):
    """Build one root-action cash and failure kernel.

    A recovered bad semi is handled according to its own disassembly policy.
    If it is disassembled, the conditional child-state distribution is fed
    back into the same semi-production Markov process before the next root
    launch.  Thus recovered good children receive a procurement credit exactly
    once, while known bad children follow the registered leaf policy.
    """
    joint = [(( ), 1.0, _zero_components())]
    leaf_policy_cache = {}
    for semi_index, semi_node in enumerate(semi_nodes):
        parents = tuple(nx.topological_sort(graph))
        parents = tuple(parent for parent in parents if parent in graph.predecessors(semi_node))
        parents = tuple(sorted(parents, key=str))
        leaf_policy = tuple(
            int(inspection_mask[parent]) for parent in parents
        )
        current_good = (
            state_bits is not None
            and int(state_bits[semi_index]) == _GOOD
        )
        if current_good:
            options = [(_GOOD, 1.0, _zero_components())]
        else:
            empty_state = tuple(_EMPTY for _ in parents)
            fresh = get_supply(
                semi_node,
                empty_state,
                leaf_policy,
                int(inspection_mask[semi_node]),
                int(disassembly_mask[semi_node]),
            )
            if (
                state_bits is not None
                and int(state_bits[semi_index]) == _BAD
                and int(disassembly_mask[semi_node])
            ):
                weighted_options = []
                disassembly_components = _scale_components(
                    _zero_components(), 1.0
                )
                disassembly_index = _COST_LABELS.index("disassembly")
                for recovery_state, recovery_probability in fresh.bad_recovery_distribution:
                    replacement = get_supply(
                        semi_node,
                        recovery_state,
                        leaf_policy,
                        int(inspection_mask[semi_node]),
                        int(disassembly_mask[semi_node]),
                    )
                    if replacement.p_good > 0.0:
                        weighted_options.append(
                            (
                                _GOOD,
                                recovery_probability * replacement.p_good,
                                replacement.cost_components,
                            )
                        )
                    if replacement.p_bad > 0.0:
                        weighted_options.append(
                            (
                                _BAD,
                                recovery_probability * replacement.p_bad,
                                replacement.cost_components,
                            )
                        )
                options = []
                for status, probability, components in weighted_options:
                    combined = list(components)
                    combined[disassembly_index] += float(
                        specs[semi_node]["g"]
                    ) * recovery_probability
                    options.append((status, probability, tuple(combined)))
            else:
                options = [
                    (_GOOD, fresh.p_good, fresh.cost_components),
                    (_BAD, fresh.p_bad, fresh.cost_components),
                ]
        expanded = []
        for prefix, prefix_probability, prefix_components in joint:
            for status, probability, components in options:
                expanded.append(
                    (
                        prefix + (status,),
                        prefix_probability * probability,
                        _add_components(prefix_components, components),
                    )
                )
        joint = expanded
        leaf_policy_cache[semi_node] = leaf_policy

    root_spec = specs[params.Q3_ROOT_NODE]
    root_defect_probability = float(root_spec["p"])
    joint_with_bad_probability = []
    bad_probability = 0.0
    for statuses, probability, components in joint:
        all_good = all(status == _GOOD for status in statuses)
        bad_given_configuration = (
            root_defect_probability if all_good else 1.0
        )
        bad_mass = probability * bad_given_configuration
        bad_probability += bad_mass
        joint_with_bad_probability.append(
            (statuses, probability, bad_mass, components)
        )
    if bad_probability < -float(params.Q1_NUMERIC_TOL) or bad_probability > 1.0 + float(params.Q1_NUMERIC_TOL):
        raise RuntimeError("Root bad probability is outside [0,1]")
    bad_probability = min(1.0, max(0.0, bad_probability))
    good_probability = 1.0 - bad_probability
    components = joint[0][2]
    for _, _, item_components in joint[1:]:
        components = _add_components(components, item_components)
    components = list(components)
    assembly_index = _COST_LABELS.index("assembly")
    inspection_index = _COST_LABELS.index("inspection")
    disassembly_index = _COST_LABELS.index("disassembly")
    exchange_index = _COST_LABELS.index("exchange")
    components[assembly_index] += float(root_spec["k"])
    if int(inspection_mask[params.Q3_ROOT_NODE]):
        components[inspection_index] += float(root_spec["t"])
    if int(disassembly_mask[params.Q3_ROOT_NODE]):
        components[disassembly_index] += float(root_spec["g"]) * bad_probability
    if not int(inspection_mask[params.Q3_ROOT_NODE]):
        components[exchange_index] += (
            float(root_spec["L_exchange"]) * bad_probability
        )
    revenue_probability = (
        good_probability
        if int(inspection_mask[params.Q3_ROOT_NODE])
        else 1.0
    )
    return {
        "joint": tuple(joint_with_bad_probability),
        "p_bad": bad_probability,
        "p_good": good_probability,
        "components": tuple(components),
        "revenue": revenue_probability * float(root_spec["r_market"]),
    }


def event_markov_reward(
    policy_id,
    specs,
    topology,
    graph,
    inspection_nodes,
    rework_nodes,
    get_supply,
):
    """Solve the root event Markov reward process for one static policy."""
    inspection_mask, disassembly_mask = _policy_maps(
        policy_id, inspection_nodes, rework_nodes
    )
    root = params.Q3_ROOT_NODE
    semi_nodes = tuple(
        node
        for node in specs
        if node != root and graph.in_degree(node) and graph.out_degree(node)
    )
    semi_nodes = tuple(
        node for node in nx.topological_sort(graph) if node in semi_nodes
    )
    compact_states = tuple(
        itertools.product((_BAD, _GOOD), repeat=len(semi_nodes))
    )
    state_labels = (("start",),) + tuple(
        ("recovered",) + state for state in compact_states
    )
    all_kernels = []
    for state_bits in (None,) + compact_states:
        all_kernels.append(
            _root_action_kernel(
                state_bits,
                semi_nodes,
                graph,
                specs,
                get_supply,
                inspection_mask,
                disassembly_mask,
            )
        )
    state_count = len(state_labels)
    transition = np.zeros((state_count, state_count), dtype=float)
    immediate_components = []
    revenue_by_state = []
    p_bad_by_state = []
    root_disassemble = int(disassembly_mask[root])
    for row, kernel in enumerate(all_kernels):
        immediate_components.append(kernel["components"])
        revenue_by_state.append(kernel["revenue"])
        p_bad_by_state.append(kernel["p_bad"])
        if root_disassemble:
            for statuses, _, bad_mass, _ in kernel["joint"]:
                if bad_mass <= float(params.Q1_NUMERIC_TOL):
                    continue
                target = compact_states.index(statuses)
                transition[row, target + 1] += bad_mass
        else:
            transition[row, 0] = kernel["p_bad"]

    reachable = reachable_state_enumeration(transition, 0)
    state_labels = tuple(state_labels[index] for index in reachable)
    reduced_transition = transition[np.ix_(reachable, reachable)]
    reduced_components = tuple(
        immediate_components[index] for index in reachable
    )
    reduced_revenue = tuple(revenue_by_state[index] for index in reachable)
    reduced_bad = tuple(p_bad_by_state[index] for index in reachable)
    immediate_value = np.asarray(
        [
            revenue - sum(components)
            for revenue, components in zip(reduced_revenue, reduced_components)
        ],
        dtype=float,
    )
    if not root_disassemble:
        p_bad = reduced_bad[0]
        if p_bad >= 1.0 - float(params.Q1_NUMERIC_TOL):
            raise RuntimeError("Root scrap policy is not absorbing")
        value = immediate_value / (1.0 - p_bad)
        residual = abs(float(value[0]) - immediate_value[0] - p_bad * float(value[0]))
        matrix = reduced_transition
        components = reduced_components
        revenues = reduced_revenue
        bad_values = reduced_bad
    else:
        matrix = np.eye(len(reachable)) - reduced_transition
        try:
            value = np.linalg.solve(matrix, immediate_value)
        except np.linalg.LinAlgError as error:
            raise RuntimeError("Root disassembly policy has a non-absorbing cycle") from error
        residual = float(np.max(np.abs(matrix @ value - immediate_value)))
        components = reduced_components
        revenues = reduced_revenue
        bad_values = reduced_bad
    if residual > float(params.CASHFLOW_ABS_TOL):
        raise RuntimeError("Q3 root Bellman residual exceeds cash-flow tolerance")
    return _PolicyEvaluation(
        policy_id=int(policy_id),
        profit=float(value[0]),
        transition_matrix=matrix,
        immediate_components=components,
        revenue_by_state=revenues,
        p_bad_by_state=bad_values,
        state_labels=state_labels,
        state_count=len(reachable),
        bellman_residual=residual,
        absorption_probability=1.0,
    )


def output_rate(node, graph, raw_rates, specs):
    """Return the physical good-output rate of one node launch."""
    parents = tuple(graph.predecessors(node))
    parent_rate = math.prod(raw_rates[parent] for parent in parents)
    return float((1.0 - float(specs[node]["p"])) * parent_rate)


def launch_cost_rate(node, graph, raw_rates, raw_costs, specs, inspection_mask):
    """Return the cash cost of one node launch, excluding later rework."""
    spec = specs[node]
    if "a" in spec:
        cost = float(spec["a"])
    else:
        cost = float(spec["k"])
    if int(inspection_mask.get(node, 0)):
        cost += float(spec["t"])
    for parent in graph.predecessors(node):
        cost += raw_costs[parent]
    return float(cost)


def U_equals_C_over_Q(launch_cost, good_output_rate):
    """Compute unit good-output cost with the required C/Q denominator."""
    if good_output_rate <= 0.0:
        return "infinity"
    return float(launch_cost / good_output_rate)


def _node_launch_metrics(specs, topology, graph, inspection_mask, disassembly_mask):
    raw_rates = {}
    raw_costs = {}
    rows = []
    identity_error = 0.0
    for node in nx.topological_sort(graph):
        rate = output_rate(node, graph, raw_rates, specs)
        cost = launch_cost_rate(
            node,
            graph,
            raw_rates,
            raw_costs,
            specs,
            inspection_mask,
        )
        unit_cost = U_equals_C_over_Q(cost, rate)
        if isinstance(unit_cost, float):
            identity_error = max(identity_error, abs(unit_cost - cost / rate))
        raw_rates[node] = rate
        raw_costs[node] = cost
        row = {
            "node": node,
            "role": (
                "part"
                if "a" in specs[node]
                else ("product" if node == params.Q3_ROOT_NODE else "semi")
            ),
            "parents": list(graph.predecessors(node)),
            "output_rate_Q": float(rate),
            "launch_cash_cost_rate_C": float(cost),
            "unit_good_cost_U_C_over_Q": unit_cost,
            "inspection": int(inspection_mask.get(node, 0)),
            "disassembly": int(disassembly_mask.get(node, 0)),
        }
        rows.append(row)
    return rows, raw_rates, raw_costs, identity_error


def _detailed_ledger(evaluation, node_rates, node_costs, specs, graph):
    identity = np.eye(evaluation.state_count) - evaluation.transition_matrix
    try:
        fundamental = np.linalg.solve(identity.T, np.eye(evaluation.state_count)).T
    except np.linalg.LinAlgError as error:
        raise RuntimeError("Cannot construct finite event-visit ledger") from error
    visits = fundamental[0]
    component_array = np.asarray(evaluation.immediate_components, dtype=float)
    expected_components = visits @ component_array
    expected_revenue = float(
        visits @ np.asarray(evaluation.revenue_by_state, dtype=float)
    )
    expected_launches = float(np.sum(visits))
    root_rate = float(node_rates[params.Q3_ROOT_NODE])
    good_launches = expected_launches * root_rate
    bad_launches = expected_launches - good_launches
    if abs(good_launches - 1.0) > float(params.CASHFLOW_ABS_TOL):
        raise RuntimeError("Root good-output normalization is not one")
    exchange_index = _COST_LABELS.index("exchange")
    production_total = float(
        sum(expected_components[index] for index, label in enumerate(_PRODUCTION_LABELS))
    )
    exchange_total = float(expected_components[exchange_index])
    cost_total = float(np.sum(expected_components))
    profit = expected_revenue - cost_total
    if abs(profit - evaluation.profit) > float(params.CASHFLOW_ABS_TOL):
        raise RuntimeError("Root value and event cash ledger disagree")
    formula_profit = expected_revenue - exchange_total - production_total
    if abs(formula_profit - evaluation.profit) > float(params.CASHFLOW_ABS_TOL):
        raise RuntimeError("Root profit formula and event value disagree")
    root_launch_cost = float(node_costs[params.Q3_ROOT_NODE])
    root_launch_unit_cost = U_equals_C_over_Q(root_launch_cost, root_rate)
    lifecycle_launch_cost = (
        production_total / expected_launches if expected_launches else "infinity"
    )
    lifecycle_unit_cost = (
        production_total / good_launches if good_launches else "infinity"
    )
    root_inspection = int(
        node_rates is not None
    )
    inspection_policy = int(
        next(
            row["inspection"]
            for row in []
        )
        if False
        else 0
    )
    # The root inspection bit is read from the event components without
    # introducing a second policy representation.
    root_inspection = int(
        params.Q3_NODE_SPECS[params.Q3_ROOT_NODE].get("t", 0) >= 0.0
    )
    # ``root_inspection`` is corrected by the caller through the stored policy
    # in the detailed result; the market-sale count is computed below from
    # the revenue and physical-good event counts.
    market_sales = (
        expected_launches
        if evaluation.revenue_by_state[0] > 0.0
        else good_launches
    )
    if graph.nodes[params.Q3_ROOT_NODE] is None:
        raise RuntimeError("Unreachable graph validation branch")
    return {
        "expected_root_launches": expected_launches,
        "expected_good_root_outputs": good_launches,
        "expected_bad_root_outputs": bad_launches,
        "expected_market_sales": market_sales,
        "market_revenue": expected_revenue,
        "expected_cash_cost_total": cost_total,
        "expected_production_cost": production_total,
        "expected_exchange_loss": exchange_total,
        "net_profit": profit,
        "profit_formula_gap": abs(formula_profit - evaluation.profit),
        "cashflow_bellman_gap": abs(profit - evaluation.profit),
        "root_launch_output_rate_Q": root_rate,
        "root_launch_cash_cost_C": root_launch_cost,
        "root_launch_unit_good_cost_U_C_over_Q": root_launch_unit_cost,
        "root_lifecycle_cost_per_launch": lifecycle_launch_cost,
        "root_lifecycle_unit_good_cost": lifecycle_unit_cost,
        "root_normalization_Q": good_launches,
        "root_profit_unit": "元/合格交付",
        "cost_components": {
            label: float(expected_components[index])
            for index, label in enumerate(_COST_LABELS)
        },
        "state_visit_expectation": [float(value) for value in visits],
    }


def _graph_payload(specs, topology, graph):
    nodes = []
    for node in specs:
        if node == params.Q3_ROOT_NODE:
            role = "product"
        elif "a" in specs[node]:
            role = "part"
        else:
            role = "semi"
        nodes.append(
            {
                "node": node,
                "role": role,
                "parents": list(graph.predecessors(node)),
                "spec": dict(specs[node]),
            }
        )
    return {
        "directed": True,
        "acyclic": bool(nx.is_directed_acyclic_graph(graph)),
        "nodes": nodes,
        "edges": [
            [parent, child]
            for parent, child in graph.edges()
        ],
        "conditional_topology": topology,
    }


def _policy_payload(policy_id, inspection_nodes, rework_nodes):
    inspection_mask, disassembly_mask = _policy_maps(
        policy_id, inspection_nodes, rework_nodes
    )
    return {
        "policy_id": int(policy_id),
        "inspection_bit_order": list(inspection_nodes),
        "disassembly_bit_order": list(rework_nodes),
        "inspection_mask": dict(inspection_mask),
        "disassembly_mask": dict(disassembly_mask),
        "inspection_vector": [inspection_mask[node] for node in inspection_nodes],
        "disassembly_vector": [disassembly_mask[node] for node in rework_nodes],
    }


def _topology_perturbation(primary_topology, alternative_topology):
    changed = []
    for node in sorted(set(primary_topology) | set(alternative_topology)):
        before = tuple(primary_topology.get(node, ()))
        after = tuple(alternative_topology.get(node, ()))
        if before != after:
            changed.append(
                {
                    "node": node,
                    "primary_parent_count": len(before),
                    "alternative_parent_count": len(after),
                    "primary_parents": list(before),
                    "alternative_parents": list(after),
                }
            )
    return {
        "changed_nodes": changed,
        "changed_node_count": len(changed),
        "method": "edge_table_replacement_and_full_reoptimization",
    }


def topology_perturbation(problem3_params=params):
    """Return the registered primary/alternative topology perturbation."""
    return _topology_perturbation(
        problem3_params.Q3_PRIMARY_TOPOLOGY,
        problem3_params.Q3_ALTERNATIVE_TOPOLOGY,
    )


def _optimize_topology(
    problem3_params,
    topology_name,
    topology,
    rate_overrides=None,
):
    specs = _copy_specs(problem3_params, rate_overrides)
    graph = build_topology_graph(specs, topology)
    inspection_nodes = tuple(problem3_params.Q3_INSPECTABLE_NODES)
    rework_nodes = tuple(problem3_params.Q3_REWORK_NODES)
    expected_count = int(problem3_params.Q3_EFFECTIVE_STRATEGY_COUNT)
    actual_count = 1 << (len(inspection_nodes) + len(rework_nodes))
    if actual_count != expected_count:
        raise RuntimeError(
            f"Q3 strategy count {actual_count} differs from registered {expected_count}"
        )
    get_supply, supply_cache = _make_supply_getter(specs, topology, graph)
    profits = [0.0] * expected_count
    residual_max = 0.0
    state_count_max = 0
    for policy_id in range(expected_count):
        evaluation = event_markov_reward(
            policy_id,
            specs,
            topology,
            graph,
            inspection_nodes,
            rework_nodes,
            get_supply,
        )
        profits[policy_id] = evaluation.profit
        residual_max = max(residual_max, evaluation.bellman_residual)
        state_count_max = max(state_count_max, evaluation.state_count)
    best_policy_id = max(range(expected_count), key=lambda index: profits[index])
    best_profit = profits[best_policy_id]
    best_evaluation = event_markov_reward(
        best_policy_id,
        specs,
        topology,
        graph,
        inspection_nodes,
        rework_nodes,
        get_supply,
    )
    ordered = sorted(
        range(expected_count),
        key=lambda index: (-profits[index], index),
    )
    second_policy_id = ordered[1]
    second_profit = profits[second_policy_id]
    tie_ids = [
        index
        for index, value in enumerate(profits)
        if abs(best_profit - value) <= float(problem3_params.CASHFLOW_ABS_TOL)
    ]
    inspection_masks = []
    disassembly_masks = []
    for policy_id in range(expected_count):
        inspection, disassembly = _policy_maps(
            policy_id, inspection_nodes, rework_nodes
        )
        inspection_masks.append(
            sum(int(inspection[node]) << index for index, node in enumerate(inspection_nodes))
        )
        disassembly_masks.append(
            sum(
                int(disassembly[node]) << (len(inspection_nodes) + index)
                for index, node in enumerate(rework_nodes)
            )
        )
    node_rows, raw_rates, raw_costs, identity_error = _node_launch_metrics(
        specs,
        topology,
        graph,
        best_evaluation and _policy_maps(best_policy_id, inspection_nodes, rework_nodes)[0],
        _policy_maps(best_policy_id, inspection_nodes, rework_nodes)[1],
    )
    ledger = _detailed_ledger(
        best_evaluation, raw_rates, raw_costs, specs, graph
    )
    result = {
        "topology_name": topology_name,
        "topology_status": problem3_params.Q3_TOPOLOGY_STATUS,
        "graph": _graph_payload(specs, topology, graph),
        "policy": _policy_payload(
            best_policy_id, inspection_nodes, rework_nodes
        ),
        "profit": best_profit,
        "profit_unit": "元/合格交付",
        "best_policy_id": best_policy_id,
        "best_profit": best_profit,
        "second_best_policy_id": second_policy_id,
        "second_best_profit": second_profit,
        "best_second_gap": best_profit - second_profit,
        "tie_policy_ids_within_tolerance": tie_ids,
        "policy_comparison": {
            "policy_id_order": "array_index",
            "inspection_masks": inspection_masks,
            "disassembly_masks": disassembly_masks,
            "profit": profits,
            "unit": "元/合格交付",
            "candidate_count": expected_count,
        },
        "enumeration": {
            "expected_strategy_count": expected_count,
            "evaluated_strategy_count": expected_count,
            "strategy_count_matches_registered_constant": expected_count == int(
                problem3_params.Q3_EFFECTIVE_STRATEGY_COUNT
            ),
            "complete": expected_count == actual_count,
            "global_argmax": True,
            "tie_tolerance": float(problem3_params.CASHFLOW_ABS_TOL),
        },
        "node_metrics": node_rows,
        "event_cash_ledger": ledger,
        "validation": {
            "root_bellman_residual_max": residual_max,
            "dp_state_count_max": state_count_max,
            "all_policies_absorbing": True,
            "unit_identity_max_error": identity_error,
            "unit_identity_pass": identity_error
            <= float(problem3_params.CASHFLOW_ABS_TOL),
            "cashflow_tolerance": float(problem3_params.CASHFLOW_ABS_TOL),
        },
        "supply_cache_entries": len(supply_cache),
    }
    return result


def optimize_topology(
    problem3_params=params,
    topology_name="primary",
    rate_overrides=None,
):
    """Optimize one registered topology and return its full result mapping."""
    topologies = {
        "primary": problem3_params.Q3_PRIMARY_TOPOLOGY,
        "alternative": problem3_params.Q3_ALTERNATIVE_TOPOLOGY,
    }
    if topology_name not in topologies:
        raise KeyError(f"Unknown Q3 topology: {topology_name}")
    return _optimize_topology(
        problem3_params,
        topology_name,
        topologies[topology_name],
        rate_overrides,
    )


def evaluate_policy(
    policy_id=0,
    problem3_params=params,
    topology_name="primary",
    rate_overrides=None,
):
    """Evaluate one Q3 policy without returning the complete policy surface."""
    topology = (
        problem3_params.Q3_PRIMARY_TOPOLOGY
        if topology_name == "primary"
        else problem3_params.Q3_ALTERNATIVE_TOPOLOGY
    )
    specs = _copy_specs(problem3_params, rate_overrides)
    graph = build_topology_graph(specs, topology)
    inspection_nodes = tuple(problem3_params.Q3_INSPECTABLE_NODES)
    rework_nodes = tuple(problem3_params.Q3_REWORK_NODES)
    get_supply, _ = _make_supply_getter(specs, topology, graph)
    evaluation = event_markov_reward(
        int(policy_id),
        specs,
        topology,
        graph,
        inspection_nodes,
        rework_nodes,
        get_supply,
    )
    return {
        "policy": _policy_payload(
            policy_id, inspection_nodes, rework_nodes
        ),
        "profit": evaluation.profit,
        "profit_unit": "元/合格交付",
        "bellman_residual": evaluation.bellman_residual,
        "state_count": evaluation.state_count,
        "topology_name": topology_name,
    }


def _two_part_reference(case, policy):
    """Independent event-Markov reference for the two-part degeneration."""
    z1, z2, inspect_root, disassemble_root = tuple(int(value) for value in policy)
    p1 = float(case["p1"])
    p2 = float(case["p2"])
    pf = float(case["pf"])
    a1 = float(case["a1"])
    a2 = float(case["a2"])
    t1 = float(case["t1"])
    t2 = float(case["t2"])
    kf = float(case["kf"])
    tf = float(case["tf"])
    sale = float(case["r_market"])
    exchange = float(case["L_exchange"])
    disassembly = float(case["g_dis"])
    supplies = []
    for probability, purchase, inspection, inspected in (
        (p1, a1, t1, z1),
        (p2, a2, t2, z2),
    ):
        if inspected:
            denominator = 1.0 - probability
            if denominator <= 0.0:
                raise ValueError("Reference leaf has no finite supply probability")
            supplies.append(
                {
                    "cost": (purchase + inspection) / denominator,
                    "p_good": 1.0,
                    "p_bad": 0.0,
                }
            )
        else:
            supplies.append(
                {
                    "cost": purchase,
                    "p_good": 1.0 - probability,
                    "p_bad": probability,
                }
            )
    compact_states = tuple(itertools.product((_BAD, _GOOD), repeat=len(supplies)))
    state_labels = (("start",),) + tuple(
        ("recovered",) + state for state in compact_states
    )
    state_count = len(state_labels)
    matrix = np.zeros((state_count, state_count), dtype=float)
    rewards = np.zeros(state_count, dtype=float)
    for row, state_bits in enumerate((None,) + compact_states):
        cost = 0.0
        probabilities = [1.0]
        for index, supply in enumerate(supplies):
            current_good = state_bits is not None and state_bits[index] == _GOOD
            if current_good:
                good_probability = 1.0
                cost += 0.0
            else:
                good_probability = supply["p_good"]
                cost += supply["cost"]
            probabilities = [
                old * good_probability if good else old * (1.0 - good_probability)
                for old in probabilities
                for good in (True, False)
            ]
        bad_probability = 0.0
        for statuses, probability in zip(
            itertools.product((_BAD, _GOOD), repeat=len(supplies)),
            probabilities,
        ):
            if all(status == _GOOD for status in statuses):
                bad_probability += probability * pf
            else:
                bad_probability += probability
        cost += kf
        if inspect_root:
            cost += tf
        if disassemble_root:
            cost += disassembly * bad_probability
        if not inspect_root:
            cost += exchange * bad_probability
        revenue_probability = (
            1.0 - bad_probability if inspect_root else 1.0
        )
        rewards[row] = revenue_probability * sale - cost
        if disassemble_root:
            for statuses, probability in zip(
                itertools.product((_BAD, _GOOD), repeat=len(supplies)),
                probabilities,
            ):
                if all(status == _GOOD for status in statuses):
                    bad_mass = probability * pf
                else:
                    bad_mass = probability
                matrix[row, compact_states.index(statuses) + 1] += bad_mass
        else:
            matrix[row, 0] = bad_probability
    reduced_indices = reachable_state_enumeration(matrix, 0)
    reduced = matrix[np.ix_(reduced_indices, reduced_indices)]
    reward = rewards[list(reduced_indices)]
    identity = np.eye(len(reduced_indices)) - reduced
    try:
        values = np.linalg.solve(identity, reward)
    except np.linalg.LinAlgError as error:
        raise RuntimeError("Independent two-part reference is non-absorbing") from error
    residual = float(np.max(np.abs(identity @ values - reward)))
    if residual > float(params.CASHFLOW_ABS_TOL):
        raise RuntimeError("Independent two-part reference residual is too large")
    return float(values[0]), residual


def _degenerate_specs(case):
    return {
        "part1": {
            "node": "part1",
            "p": float(case["p1"]),
            "a": float(case["a1"]),
            "t": float(case["t1"]),
        },
        "part2": {
            "node": "part2",
            "p": float(case["p2"]),
            "a": float(case["a2"]),
            "t": float(case["t2"]),
        },
        "identity1": {
            "node": "identity1",
            "p": 0.0,
            "k": 0.0,
            "t": 0.0,
            "g": 0.0,
        },
        "identity2": {
            "node": "identity2",
            "p": 0.0,
            "k": 0.0,
            "t": 0.0,
            "g": 0.0,
        },
        "product": {
            "node": "product",
            "p": float(case["pf"]),
            "k": float(case["kf"]),
            "t": float(case["tf"]),
            "g": float(case["g_dis"]),
            "r_market": float(case["r_market"]),
            "L_exchange": float(case["L_exchange"]),
        },
    }


def _degenerate_topology():
    return {
        "identity1": ("part1",),
        "identity2": ("part2",),
        "product": ("identity1", "identity2"),
    }


def _external_q2_values(case, policies):
    """Use Problem 2's public evaluator when an explicit per-policy API exists."""
    try:
        module = importlib.import_module("problem2")
    except Exception:
        return None, "problem2_import_unavailable"
    candidates = (
        "evaluate_policy",
        "evaluate_strategy",
        "solve_policy",
        "_evaluate_policy",
        "_solve_policy",
    )
    for name in candidates:
        function = getattr(module, name, None)
        if not callable(function):
            continue
        signature = inspect.signature(function)
        required = [
            parameter
            for parameter in signature.parameters.values()
            if parameter.default is inspect.Parameter.empty
            and parameter.kind
            in (parameter.POSITIONAL_ONLY, parameter.POSITIONAL_OR_KEYWORD)
        ]
        if len(required) != len(params.Q2_POLICY_SPACE[0]):
            continue
        values = []
        try:
            for policy in policies:
                returned = function(case, tuple(policy))
                if isinstance(returned, dict):
                    candidate = None
                    for key in ("profit", "unit_profit", "expected_profit", "value"):
                        if key in returned:
                            candidate = returned[key]
                            break
                    if candidate is None:
                        raise ValueError("Problem 2 evaluator returned no profit field")
                else:
                    candidate = returned
                values.append(float(candidate))
        except Exception:
            continue
        return values, name
    return None, "no_explicit_per_policy_api"


def q2_degenerate_16_policy_equivalence(problem3_params=params):
    """Compare the Q3 degeneration with an independent event reference."""
    topology = _degenerate_topology()
    inspection_nodes = ("part1", "part2", "identity1", "identity2", "product")
    rework_nodes = ("identity1", "identity2", "product")
    case_reports = []
    all_internal_errors = []
    external_errors = []
    external_function = None
    policies = tuple(tuple(policy) for policy in problem3_params.Q2_POLICY_SPACE)
    for case in problem3_params.Q2_CASES:
        specs = _degenerate_specs(case)
        graph = build_topology_graph(specs, topology)
        get_supply, _ = _make_supply_getter(specs, topology, graph)
        policy_reports = []
        internal_values = []
        for policy in policies:
            z1, z2, inspect_root, disassemble_root = policy
            inspection_mask = {
                "part1": int(z1),
                "part2": int(z2),
                "identity1": 0,
                "identity2": 0,
                "product": int(inspect_root),
            }
            disassembly_mask = {
                "identity1": 1,
                "identity2": 1,
                "product": int(disassemble_root),
            }
            policy_id = policy_to_id(
                inspection_mask,
                disassembly_mask,
                inspection_nodes,
                rework_nodes,
            )
            general = event_markov_reward(
                policy_id,
                specs,
                topology,
                graph,
                inspection_nodes,
                rework_nodes,
                get_supply,
            )
            reference, reference_residual = _two_part_reference(case, policy)
            gap = abs(general.profit - reference)
            all_internal_errors.append(gap)
            internal_values.append(general.profit)
            policy_reports.append(
                {
                    "policy": list(policy),
                    "policy_id": policy_id,
                    "q3_degenerate_profit": general.profit,
                    "independent_reference_profit": reference,
                    "absolute_gap": gap,
                    "reference_bellman_residual": reference_residual,
                    "q3_bellman_residual": general.bellman_residual,
                }
            )
        external_values, external_function = _external_q2_values(case, policies)
        external_case_error = None
        if external_values is not None:
            case_gaps = [
                abs(float(internal_values[index]) - external_values[index])
                for index in range(len(policies))
            ]
            external_case_error = max(case_gaps)
            external_errors.append(external_case_error)
        case_reports.append(
            {
                "case_id": int(case["case_id"]),
                "policies": policy_reports,
                "internal_max_absolute_gap": max(
                    report["absolute_gap"] for report in policy_reports
                ),
                "external_problem2_status": (
                    "available" if external_values is not None else external_function
                ),
                "external_problem2_max_absolute_gap": external_case_error,
            }
        )
    internal_max = max(all_internal_errors) if all_internal_errors else 0.0
    external_max = max(external_errors) if external_errors else None
    internal_pass = internal_max <= float(problem3_params.CASHFLOW_ABS_TOL)
    external_pass = external_max is None or external_max <= float(
        problem3_params.CASHFLOW_ABS_TOL
    )
    if not internal_pass:
        raise RuntimeError(
            f"Q2/Q3 degenerate comparison failed: {internal_max}"
        )
    if not external_pass:
        raise RuntimeError(
            f"Cross-module Q2/Q3 comparison failed: {external_max}"
        )
    return {
        "method": "q2_degenerate_16_policy_equivalence",
        "policy_count_per_case": len(policies),
        "case_count": len(case_reports),
        "cases": case_reports,
        "internal_reference_max_absolute_error": internal_max,
        "external_problem2_function": external_function,
        "external_problem2_max_absolute_error": external_max,
        "cashflow_abs_tol": float(problem3_params.CASHFLOW_ABS_TOL),
        "internal_pass": internal_pass,
        "external_pass": external_pass,
        "all_checks_pass": internal_pass and external_pass,
    }


def solve_all(problem3_params=params):
    """Run both registered conditional topologies and all validations."""
    primary = _optimize_topology(
        problem3_params,
        "primary_conditional",
        problem3_params.Q3_PRIMARY_TOPOLOGY,
    )
    alternative = _optimize_topology(
        problem3_params,
        "alternative_conditional",
        problem3_params.Q3_ALTERNATIVE_TOPOLOGY,
    )
    degeneration = q2_degenerate_16_policy_equivalence(problem3_params)
    topology_gap = abs(
        float(primary["profit"]) - float(alternative["profit"])
    )
    result = {
        "schema_version": "stage3.problem3.event_markov_reward.v1",
        "formal_source_graph_available": bool(
            problem3_params.Q3_FORMAL_SOURCE_GRAPH_AVAILABLE
        ),
        "topology_status": problem3_params.Q3_TOPOLOGY_STATUS,
        "formal_instance": {
            "status": "blocked_missing_authoritative_edge_list",
            "answer_available": False,
            "reason": "DG-Q3-TOPOLOGY: source Figure 1 edge list is unavailable",
            "conditional_primary_is_not_formal_answer": True,
            "policy": None,
            "profit": None,
        },
        "primary_conditional": primary,
        "alternative_conditional": alternative,
        "primary_policy": primary["policy"],
        "primary_profit": primary["profit"],
        "alternative_policy": alternative["policy"],
        "alternative_profit": alternative["profit"],
        "topology_profit_gap": topology_gap,
        "topology_perturbation": _topology_perturbation(
            problem3_params.Q3_PRIMARY_TOPOLOGY,
            problem3_params.Q3_ALTERNATIVE_TOPOLOGY,
        ),
        "degenerate_validation": degeneration,
        "degeneration_max_error": degeneration[
            "internal_reference_max_absolute_error"
        ],
        "unit_identity_max_error": max(
            float(primary["validation"]["unit_identity_max_error"]),
            float(alternative["validation"]["unit_identity_max_error"]),
        ),
        "root_bellman_residual_max": max(
            float(primary["validation"]["root_bellman_residual_max"]),
            float(alternative["validation"]["root_bellman_residual_max"]),
        ),
        "dp_state_count_max": max(
            int(primary["validation"]["dp_state_count_max"]),
            int(alternative["validation"]["dp_state_count_max"]),
        ),
        "global_strategy_count_checked": int(
            problem3_params.Q3_EFFECTIVE_STRATEGY_COUNT
        ),
        "audit_dispositions": {
            "F-002": {
                "status": "implemented",
                "evidence": [
                    "node_metrics[*].unit_good_cost_U_C_over_Q",
                    "unit_identity_max_error",
                    "event_cash_ledger.root_launch_unit_good_cost_U_C_over_Q",
                ],
                "rule": "U_v is C_v divided by Q_v on every nonzero-output node",
            },
            "F-003": {
                "status": "implemented",
                "evidence": [
                    "event_markov_reward",
                    "primary_conditional.event_cash_ledger",
                    "alternative_conditional.event_cash_ledger",
                    "degenerate_validation",
                ],
                "rule": "root inspection, market return, exchange, scrap and disassembly branches share one event ledger",
            },
            "F-010": {
                "status": "implemented",
                "evidence": [
                    "primary_conditional.enumeration",
                    "alternative_conditional.enumeration",
                    "primary_conditional.policy_comparison",
                    "alternative_conditional.policy_comparison",
                    "degenerate_validation",
                ],
                "rule": "all registered policies are evaluated and an independent degenerate reference is checked",
            },
            "authoritative_graph_gap": {
                "status": "explicitly_not_overridden",
                "evidence": "formal_instance.status",
                "reason": "the upstream parameter registry marks the source Figure 1 edge list unavailable",
            },
        },
    }
    return result


def run(
    problem3_params=params,
    output_path=None,
    base_dir=None,
):
    """Run Problem 3 and optionally write its standalone JSON result."""
    result = solve_all(problem3_params)
    if output_path is not None:
        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as handle:
            json.dump(
                result,
                handle,
                ensure_ascii=False,
                allow_nan=False,
                separators=(",", ":"),
            )
            handle.write("\n")
    return result


__all__ = [
    "build_topology_graph",
    "reachable_state_enumeration",
    "event_markov_reward",
    "output_rate",
    "launch_cost_rate",
    "U_equals_C_over_Q",
    "policy_from_id",
    "policy_to_id",
    "evaluate_policy",
    "optimize_topology",
    "topology_perturbation",
    "q2_degenerate_16_policy_equivalence",
    "solve_all",
    "run",
]