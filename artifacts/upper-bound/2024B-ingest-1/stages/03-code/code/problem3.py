from __future__ import annotations

import itertools
import math
from collections import Counter, deque
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Any

import networkx as nx

import params
from params import *  # noqa: F401,F403


@dataclass(frozen=True)
class NetworkNode:
    """One node in a general assembly DAG.

    A part has ``node_type='part'`` and supplies ``purchase_cost``.  An
    assembly operation has ``node_type='assembly'`` and supplies
    ``assembly_cost``.  A disassembly decision is meaningful only for an
    assembly node.
    """

    node_id: str
    parents: tuple[str, ...]
    p: float
    purchase_cost: float
    assembly_cost: float
    inspection_cost: float
    disassembly_cost: float
    node_type: str = "assembly"


@dataclass(frozen=True)
class NetworkModel:
    graph: nx.DiGraph
    nodes: Mapping[str, NetworkNode]
    order: tuple[str, ...]
    root: str
    market_price: float
    exchange_loss: float


Q3NetworkNode = NetworkNode
Q3NetworkModel = NetworkModel

_COST_KEYS = ("purchase", "inspection", "assembly", "disassembly")
_PART_ALIASES = {
    "零配件": "part",
    "零件": "part",
    "part": "part",
}
_SEMI_ALIASES = {
    "半成品": "semi",
    "半成品1": "semi1",
    "半成品2": "semi2",
    "半成品3": "semi3",
    "semi": "semi",
}
_ROOT_ALIASES = {
    "成品": "product",
    "最终成品": "product",
    "final": "product",
    "root": "product",
}


def _canonical_id(raw_id: Any) -> str:
    if isinstance(raw_id, int):
        return f"part{raw_id}"
    text = str(raw_id).strip()
    if text in _ROOT_ALIASES:
        return _ROOT_ALIASES[text]
    if text in _SEMI_ALIASES:
        return _SEMI_ALIASES[text]
    if text in _PART_ALIASES:
        return _PART_ALIASES[text]
    if text.isdigit():
        return f"part{text}"
    return text


def _zero_components() -> dict[str, float]:
    return {key: 0.0 for key in _COST_KEYS}


def _merge_components(*groups: Mapping[str, float]) -> dict[str, float]:
    result = _zero_components()
    for group in groups:
        for key in _COST_KEYS:
            result[key] += float(group[key])
    return result


def _scale_components(
    group: Mapping[str, float], factor: float
) -> dict[str, float]:
    return {key: float(group[key]) * factor for key in _COST_KEYS}


def _mapping_value(
    values: Mapping[str, Any], names: Sequence[str], default: Any = None
) -> Any:
    for name in names:
        if name in values:
            return values[name]
    if default is not None:
        return default
    raise KeyError("缺少字段：" + ", ".join(names))


def _scenario_node_specs() -> dict[str, NetworkNode]:
    specifications: dict[str, NetworkNode] = {}
    for part in params.Q3_PARTS:
        node_id = f"part{part.number}"
        specifications[node_id] = NetworkNode(
            node_id=node_id,
            parents=(),
            p=float(part.p),
            purchase_cost=float(part.price),
            assembly_cost=0.0,
            inspection_cost=float(part.test),
            disassembly_cost=0.0,
            node_type="part",
        )
    for semi in params.Q3_SEMIS:
        node_id = f"semi{semi.number}"
        specifications[node_id] = NetworkNode(
            node_id=node_id,
            parents=(),
            p=float(semi.p),
            purchase_cost=0.0,
            assembly_cost=float(semi.assembly_cost),
            inspection_cost=float(semi.test),
            disassembly_cost=float(semi.disassembly_cost),
            node_type="assembly",
        )
    product = params.Q3_PRODUCT_NODE
    specifications["product"] = NetworkNode(
        node_id="product",
        parents=(),
        p=float(product.p),
        purchase_cost=0.0,
        assembly_cost=float(product.assembly_cost),
        inspection_cost=float(product.test),
        disassembly_cost=float(product.disassembly_cost),
        node_type="assembly",
    )
    return specifications


def _normalise_parent_map(
    parent_map: Mapping[Any, Sequence[Any]] | None,
    specifications: Mapping[str, NetworkNode],
) -> dict[str, tuple[str, ...]]:
    if parent_map is None:
        inferred: dict[str, list[str]] = {
            node_id: [] for node_id in specifications
        }
        for node_id, node in specifications.items():
            inferred[node_id].extend(node.parents)
        parent_map = inferred

    result: dict[str, tuple[str, ...]] = {}
    for raw_child, raw_parents in parent_map.items():
        child = _canonical_id(raw_child)
        if child not in specifications:
            raise KeyError(f"边表子节点未在参数表中：{child}")
        parents: list[str] = []
        for raw_parent in raw_parents:
            parent = _canonical_id(raw_parent)
            if parent not in specifications:
                raise KeyError(f"边表父节点未在参数表中：{parent}")
            if parent == child:
                raise ValueError(f"节点不能以自身为父节点：{child}")
            if parent not in parents:
                parents.append(parent)
        result[child] = tuple(parents)
    missing = set(specifications) - set(result)
    if missing:
        raise KeyError("边表缺少节点：" + ", ".join(sorted(missing)))
    return result


def _coerce_node(
    node_id: str,
    raw_node: Any,
    default_parents: tuple[str, ...],
) -> NetworkNode:
    if isinstance(raw_node, NetworkNode):
        if raw_node.node_id != node_id:
            raise ValueError(f"节点键与 node_id 不一致：{node_id}")
        return raw_node

    if isinstance(raw_node, Mapping):
        values = dict(raw_node)
    elif hasattr(raw_node, "__dict__"):
        values = dict(vars(raw_node))
    else:
        raise TypeError(f"无法读取节点参数：{node_id}")

    raw_parents = values.get("parents", default_parents)
    parents = tuple(dict.fromkeys(_canonical_id(item) for item in raw_parents))
    p = float(_mapping_value(values, ("p", "defect_rate", "product_defect")))
    purchase_cost = float(
        _mapping_value(
            values,
            ("purchase_cost", "price", "purchase_price", "a"),
            0.0,
        )
    )
    assembly_cost = float(
        _mapping_value(
            values,
            ("assembly_cost", "assembly", "kf"),
            0.0,
        )
    )
    inspection_cost = float(
        _mapping_value(
            values,
            ("inspection_cost", "test", "test_cost", "t", "tf"),
            0.0,
        )
    )
    disassembly_cost = float(
        _mapping_value(
            values,
            ("disassembly_cost", "disassembly", "gdis"),
            0.0,
        )
    )
    node_type = str(
        _mapping_value(
            values,
            ("node_type", "kind"),
            "part" if not parents and purchase_cost > 0.0 else "assembly",
        )
    ).lower()
    if node_type not in {"part", "assembly"}:
        raise ValueError(f"未知节点类型：{node_type}")

    return NetworkNode(
        node_id=node_id,
        parents=parents,
        p=p,
        purchase_cost=purchase_cost,
        assembly_cost=assembly_cost,
        inspection_cost=inspection_cost,
        disassembly_cost=disassembly_cost,
        node_type=node_type,
    )


def _stable_topological_order(
    graph: nx.DiGraph, insertion_order: Sequence[str]
) -> tuple[str, ...]:
    placed: set[str] = set()
    result: list[str] = []
    rank = {node_id: index for index, node_id in enumerate(insertion_order)}
    while len(result) < len(graph.nodes):
        progressed = False
        for node_id in insertion_order:
            if node_id in placed:
                continue
            if set(graph.predecessors(node_id)).issubset(placed):
                result.append(node_id)
                placed.add(node_id)
                progressed = True
        if not progressed:
            raise ValueError("网络含环，无法形成装配事件顺序")
    return tuple(result)


def build_model(
    parent_map: Mapping[Any, Sequence[Any]] | None = None,
    node_specs: Mapping[str, Any] | Sequence[NetworkNode] | None = None,
    *,
    root: Any = "product",
    market_price: float | None = None,
    exchange_loss: float | None = None,
) -> NetworkModel:
    """Build a validated finite DAG for an arbitrary number of stages.

    The engine does not assume a two-level product.  ``parent_map`` and the
    normalized topological order are the only structural restrictions.
    """

    if node_specs is None:
        raw_specs: dict[str, Any] = _scenario_node_specs()
    elif isinstance(node_specs, Mapping):
        raw_specs = {str(key): value for key, value in node_specs.items()}
    else:
        raw_specs = {item.node_id: item for item in node_specs}

    raw_specs = {_canonical_id(key): value for key, value in raw_specs.items()}
    inferred_parents = _normalise_parent_map(parent_map, raw_specs)
    specifications = {
        node_id: _coerce_node(
            node_id,
            raw_node,
            inferred_parents.get(node_id, ()),
        )
        for node_id, raw_node in raw_specs.items()
    }
    normalized_parents = _normalise_parent_map(
        inferred_parents,
        specifications,
    )

    graph = nx.DiGraph()
    graph.add_nodes_from(specifications)
    for child, parents in normalized_parents.items():
        for parent in parents:
            graph.add_edge(parent, child)
    if not nx.is_directed_acyclic_graph(graph):
        raise ValueError("装配网络必须是有向无环图")

    insertion_order = tuple(specifications)
    order = _stable_topological_order(graph, insertion_order)
    canonical_root = _canonical_id(root)
    if canonical_root not in graph:
        raise KeyError(f"根节点不存在：{canonical_root}")
    ancestors = nx.ancestors(graph, canonical_root)
    disconnected = set(graph.nodes) - ancestors - {canonical_root}
    if disconnected:
        raise ValueError(
            "存在不属于根节点祖先集的节点：" + ", ".join(sorted(disconnected))
        )

    for node in specifications.values():
        if not math.isfinite(node.p) or not 0.0 <= node.p <= 1.0:
            raise ValueError(f"次品率越界：{node.node_id}={node.p}")
        for field in (
            node.purchase_cost,
            node.assembly_cost,
            node.inspection_cost,
            node.disassembly_cost,
        ):
            if not math.isfinite(field) or field < 0.0:
                raise ValueError(f"成本越界：{node.node_id}")

    resolved_market_price = float(
        params.Q3_MARKET_PRICE
        if market_price is None
        else market_price
    )
    resolved_exchange_loss = float(
        params.Q3_EXCHANGE_LOSS
        if exchange_loss is None
        else exchange_loss
    )
    if resolved_market_price < 0.0 or resolved_exchange_loss < 0.0:
        raise ValueError("市场售价和调换损失必须为非负有限数")

    return NetworkModel(
        graph=graph,
        nodes=specifications,
        order=order,
        root=canonical_root,
        market_price=resolved_market_price,
        exchange_loss=resolved_exchange_loss,
    )


def build_network(
    parent_map: Mapping[Any, Sequence[Any]] | None = None,
    node_specs: Mapping[str, Any] | Sequence[NetworkNode] | None = None,
) -> nx.DiGraph:
    """Compatibility wrapper returning the underlying networkx DAG."""

    return build_model(parent_map, node_specs).graph


def topology_perturbation(
    primary_parent_map: Mapping[Any, Sequence[Any]] | None = None,
    alternative_parent_map: Mapping[Any, Sequence[Any]] | None = None,
) -> tuple[NetworkModel, NetworkModel]:
    """Return two independently validated topology models."""

    if primary_parent_map is None:
        primary_parent_map = params.Q3_PRIMARY_EDGE_LIST
    if alternative_parent_map is None:
        alternative_parent_map = params.Q3_ALTERNATIVE_EDGE_LIST
    return (
        build_model(primary_parent_map),
        build_model(alternative_parent_map),
    )


def _decision_slots(model: NetworkModel) -> tuple[tuple[str, str], ...]:
    slots: list[tuple[str, str]] = []
    for node_id in model.order:
        slots.append((node_id, "inspect"))
        if model.nodes[node_id].node_type != "part":
            slots.append((node_id, "disassemble"))
    return tuple(slots)


def decode_policy(model: NetworkModel, code: int) -> dict[str, dict[str, bool]]:
    policy_code = int(code)
    slot_count = len(_decision_slots(model))
    if policy_code < 0 or policy_code >= (1 << slot_count):
        raise ValueError(f"策略编码越界：{policy_code}")
    inspect: dict[str, bool] = {}
    disassemble: dict[str, bool] = {}
    for slot_index, (node_id, decision) in enumerate(_decision_slots(model)):
        enabled = bool(policy_code & (1 << slot_index))
        if decision == "inspect":
            inspect[node_id] = enabled
        else:
            disassemble[node_id] = enabled
    return {"inspect": inspect, "disassemble": disassemble}


def _normalise_policy(
    model: NetworkModel,
    policy: int | Mapping[str, Any] | Sequence[Any],
) -> tuple[dict[str, bool], dict[str, bool], int]:
    slots = _decision_slots(model)
    if isinstance(policy, int):
        decoded = decode_policy(model, policy)
        return (
            decoded["inspect"],
            decoded["disassemble"],
            int(policy),
        )

    if isinstance(policy, Mapping):
        inspect_raw = policy.get("inspect", {})
        disassemble_raw = policy.get("disassemble", {})
        inspect = (
            {str(key): bool(value) for key, value in inspect_raw.items()}
            if isinstance(inspect_raw, Mapping)
            else {}
        )
        disassemble = (
            {str(key): bool(value) for key, value in disassemble_raw.items()}
            if isinstance(disassemble_raw, Mapping)
            else {}
        )
        for node_id in model.order:
            if node_id not in inspect and node_id in policy:
                inspect[node_id] = bool(policy[node_id])
        normalized_inspect = {
            node_id: bool(inspect.get(node_id, False))
            for node_id in model.order
        }
        normalized_disassemble = {
            node_id: bool(disassemble.get(node_id, False))
            for node_id in model.order
            if model.nodes[node_id].node_type != "part"
        }
    else:
        values = list(policy)
        if len(values) != len(slots):
            raise ValueError("策略向量长度与决策槽数量不一致")
        normalized_inspect = {}
        normalized_disassemble = {}
        for value, (node_id, decision) in zip(values, slots):
            enabled = bool(value)
            if decision == "inspect":
                normalized_inspect[node_id] = enabled
            else:
                normalized_disassemble[node_id] = enabled

    policy_code = 0
    for slot_index, (node_id, decision) in enumerate(slots):
        value = (
            normalized_inspect[node_id]
            if decision == "inspect"
            else normalized_disassemble[node_id]
        )
        policy_code |= int(value) << slot_index
    return normalized_inspect, normalized_disassemble, policy_code


def _policy_code(
    model: NetworkModel,
    inspect: Mapping[str, bool],
    disassemble: Mapping[str, bool],
) -> int:
    code = 0
    for slot_index, (node_id, decision) in enumerate(_decision_slots(model)):
        value = (
            inspect.get(node_id, False)
            if decision == "inspect"
            else disassemble.get(node_id, False)
        )
        code |= int(value) << slot_index
    return code


def _full_policy(
    inspect: Mapping[str, bool], disassemble: Mapping[str, bool]
) -> dict[str, Any]:
    return {
        "inspect": {key: bool(value) for key, value in inspect.items()},
        "disassemble": {
            key: bool(value) for key, value in disassemble.items()
        },
    }


def _normalise_rates(
    model: NetworkModel, rates: Mapping[str, Any] | Sequence[float] | None
) -> dict[str, float]:
    if rates is None:
        result = {node_id: float(node.p) for node_id, node in model.nodes.items()}
    elif isinstance(rates, Mapping):
        result = {}
        for node_id in model.order:
            if node_id in rates:
                result[node_id] = float(rates[node_id])
                continue
            aliases = {
                "part1": ("p1", "part1_p"),
                "part2": ("p2", "part2_p"),
                "semi1": ("semi1_p",),
                "semi2": ("semi2_p",),
                "semi3": ("semi3_p",),
                "product": ("pf", "product_p", "p_final"),
            }.get(node_id, ())
            for alias in aliases:
                if alias in rates:
                    result[node_id] = float(rates[alias])
                    break
            else:
                raise KeyError(f"次品率向量缺少节点：{node_id}")
    else:
        values = list(rates)
        if len(values) != len(model.order):
            raise ValueError("次品率向量长度与网络节点数不一致")
        result = {
            node_id: float(value)
            for node_id, value in zip(model.order, values)
        }
    for node_id, p in result.items():
        if not math.isfinite(p) or not 0.0 <= p <= 1.0:
            raise ValueError(f"次品率越界：{node_id}={p}")
    return result


def reachable_state_enumeration(
    graph: nx.DiGraph, state_limit: int | None = None
) -> tuple[frozenset[str], ...]:
    """Enumerate reachable assembly activation states for a finite DAG.

    An activated node means that its launch event has occurred.  Parents must
    be activated before a child, so this is a sparse, event-level subset of
    the full inventory-and-quality state space.
    """

    limit = params.Q3_REACHABLE_STATE_LIMIT if state_limit is None else int(state_limit)
    initial = frozenset()
    queue: deque[frozenset[str]] = deque((initial,))
    visited: set[frozenset[str]] = {initial}
    while queue:
        state = queue.popleft()
        for node_id in graph.nodes:
            if node_id in state:
                continue
            if set(graph.predecessors(node_id)).issubset(state):
                next_state = frozenset((*state, node_id))
                if next_state not in visited:
                    if len(visited) >= limit:
                        raise RuntimeError(
                            f"可达激活状态超过登记上限：{limit}"
                        )
                    visited.add(next_state)
                    queue.append(next_state)
    return tuple(
        sorted(visited, key=lambda item: (len(item), tuple(sorted(item))))
    )


def event_markov_reward(
    model: NetworkModel,
    policy: int | Mapping[str, Any] | Sequence[Any],
    rates: Mapping[str, Any] | Sequence[float] | None = None,
) -> dict[str, Any]:
    """Solve the regenerative event reward equations for one static policy.

    Failed inspected operations that are disassembled retain certified parent
    instances.  A failed operation that is scrapped regenerates the complete
    launch.  These are the two absorbing-regeneration cases.  A latent bad
    parent returned to an uninspected path is detected as non-absorbing rather
    than assigned a spurious finite value.
    """

    return evaluate_policy(model, policy, rates=rates)


def evaluate_policy(
    model: NetworkModel,
    policy: int | Mapping[str, Any] | Sequence[Any],
    *,
    rates: Mapping[str, Any] | Sequence[float] | None = None,
) -> dict[str, Any]:
    inspect, disassemble, policy_code = _normalise_policy(model, policy)
    rate_vector = _normalise_rates(model, rates)
    tolerance = float(params.CASHFLOW_ABS_TOL)

    raw_good: dict[str, float] = {}
    certified: dict[str, bool] = {}
    launch_components: dict[str, dict[str, float]] = {}
    certified_components: dict[str, dict[str, float] | None] = {}
    launch_cash: dict[str, float] = {}
    certified_cost: dict[str, float] = {}
    node_metrics: dict[str, dict[str, Any]] = {}
    invalid_reason: str | None = None

    for node_id in model.order:
        node = model.nodes[node_id]
        p = rate_vector[node_id]
        own_inspection = node.inspection_cost if inspect[node_id] else 0.0
        own_operation = (
            node.purchase_cost
            if node.node_type == "part"
            else node.assembly_cost
        )

        launch = _zero_components()
        if node.node_type == "part":
            launch["purchase"] = node.purchase_cost
        else:
            launch["assembly"] = node.assembly_cost
        launch["inspection"] = own_inspection
        for parent in node.parents:
            launch = _merge_components(launch, launch_components[parent])

        parent_good_probability = 1.0
        for parent in node.parents:
            parent_good_probability *= raw_good[parent]
        q = parent_good_probability * (1.0 - p)
        raw_good[node_id] = q

        node_is_certified = False
        node_certified_components: dict[str, float] | None = None
        node_certified_cost = math.inf

        if inspect[node_id]:
            if node.node_type == "part":
                node_is_certified = q > tolerance
                if node_is_certified:
                    node_certified_components = _scale_components(launch, 1.0 / q)
                    node_certified_cost = sum(node_certified_components.values())
            elif q <= tolerance:
                if invalid_reason is None:
                    invalid_reason = f"node_{node_id}_has_zero_success_probability"
            elif disassemble[node_id]:
                if any(not certified[parent] for parent in node.parents):
                    if invalid_reason is None:
                        invalid_reason = (
                            f"node_{node_id}_disassembly_returns_latent_bad_parent"
                        )
                else:
                    parent_components = _merge_components(
                        *(
                            certified_components[parent]
                            for parent in node.parents
                        )
                    )
                    node_certified_components = _merge_components(parent_components)
                    node_certified_components["assembly"] = (
                        node.assembly_cost / q
                    )
                    node_certified_components["inspection"] = (
                        node.inspection_cost / q
                    )
                    node_certified_components["disassembly"] = (
                        node.disassembly_cost * (1.0 - q) / q
                    )
                    node_is_certified = True
                    node_certified_cost = sum(
                        node_certified_components.values()
                    )
            else:
                node_certified_components = _scale_components(launch, 1.0 / q)
                node_is_certified = True
                node_certified_cost = sum(node_certified_components.values())
        elif q >= 1.0 - tolerance:
            node_is_certified = True
            node_certified_components = dict(launch)
            node_certified_cost = sum(launch.values())

        if (
            inspect[node_id]
            and node.node_type != "part"
            and disassemble[node_id]
        ):
            launch["disassembly"] = node.disassembly_cost * (1.0 - q)

        launch_components[node_id] = launch
        certified_components[node_id] = node_certified_components
        certified[node_id] = node_is_certified
        launch_cash[node_id] = sum(launch.values())
        certified_cost[node_id] = node_certified_cost
        unit_cost = launch_cash[node_id] / q if q > tolerance else None
        node_metrics[node_id] = {
            "p": p,
            "node_type": node.node_type,
            "parents": list(node.parents),
            "inspect": bool(inspect[node_id]),
            "disassemble": bool(
                disassemble.get(node_id, False)
                if node.node_type != "part"
                else False
            ),
            "output_rate_Q": q,
            "launch_cost_rate_C": launch_cash[node_id],
            "unit_cost_U": unit_cost,
            "U_equals_C_over_Q": (
                abs(unit_cost - launch_cash[node_id] / q)
                <= tolerance
                if unit_cost is not None
                else None
            ),
            "unit_cost_status": "finite" if unit_cost is not None else "infinite_excluded",
            "certified_output_probability": 1.0 if node_is_certified else 0.0,
            "expected_cost_per_certified_good": (
                node_certified_cost if math.isfinite(node_certified_cost) else None
            ),
            "launch_event_components": launch,
        }

    root = model.root
    root_q = raw_good[root]
    root_node = model.nodes[root]
    if not inspect[root] and disassemble.get(root, False):
        if any(not certified[parent] for parent in root_node.parents):
            if invalid_reason is None:
                invalid_reason = "root_disassembly_returns_latent_bad_parent"
    if root_q <= tolerance and invalid_reason is None:
        invalid_reason = "root_has_zero_qualified_delivery_probability"

    valid = invalid_reason is None
    final_components: dict[str, float] | None = None
    expected_exchange = 0.0
    profit: float | None = None
    cashflow_residual: float | None = None
    bellman_residual: float | None = None

    if valid:
        if inspect[root]:
            final_components = certified_components[root]
            if final_components is None:
                raise AssertionError("有效根策略缺少认证合格事件分量")
        elif disassemble.get(root, False):
            parent_components = _merge_components(
                *(
                    certified_components[parent]
                    for parent in root_node.parents
                )
            )
            final_components = _merge_components(parent_components)
            final_components["assembly"] = root_node.assembly_cost / root_q
            final_components["disassembly"] = (
                root_node.disassembly_cost * (1.0 - root_q) / root_q
            )
        else:
            final_components = _scale_components(
                launch_components[root],
                1.0 / root_q,
            )
        expected_exchange = model.exchange_loss * (1.0 - root_q) / root_q
        production_cost = sum(final_components.values())
        profit = model.market_price - production_cost - expected_exchange
        ledger_identity = (
            model.market_price
            - production_cost
            - expected_exchange
        )
        cashflow_residual = abs(profit - ledger_identity)
        bellman_residual = cashflow_residual

    root_launch_cash = launch_cash[root]
    root_unit_cost = (
        root_launch_cash / root_q if root_q > tolerance else None
    )
    return {
        "policy_code": policy_code,
        "valid": valid,
        "absorption_probability": 1.0 if valid else 0.0,
        "invalid_reason": invalid_reason,
        "profit": profit,
        "bellman_residual": bellman_residual,
        "cashflow_residual": cashflow_residual,
        "root": {
            "node": root,
            "qualified_output_rate_Q": root_q,
            "launch_cost_rate_C": root_launch_cash,
            "unit_cost_U": root_unit_cost,
            "expected_root_launches_per_good_delivery": (
                1.0 / root_q if root_q > tolerance else None
            ),
            "profit_per_qualified_delivery": profit,
        },
        "event_ledger": {
            "market_revenue": model.market_price if valid else None,
            "purchase": final_components["purchase"] if final_components else None,
            "inspection": final_components["inspection"] if final_components else None,
            "assembly": final_components["assembly"] if final_components else None,
            "disassembly": final_components["disassembly"] if final_components else None,
            "exchange_loss": expected_exchange if valid else None,
            "net_profit": profit,
            "cashflow_identity_gap": cashflow_residual,
        },
        "nodes": node_metrics,
    }


def policy_value(
    model: NetworkModel,
    policy: int | Mapping[str, Any] | Sequence[Any],
    rates: Mapping[str, Any] | Sequence[float] | None = None,
) -> float | None:
    return evaluate_policy(model, policy, rates=rates)["profit"]


def output_rate(evaluation: Mapping[str, Any], node_id: str) -> float:
    return float(evaluation["nodes"][node_id]["output_rate_Q"])


def launch_cost_rate(evaluation: Mapping[str, Any], node_id: str) -> float:
    return float(evaluation["nodes"][node_id]["launch_cost_rate_C"])


def unit_cost(evaluation: Mapping[str, Any], node_id: str) -> float | None:
    return evaluation["nodes"][node_id]["unit_cost_U"]


def U_equals_C_over_Q(evaluation: Mapping[str, Any], node_id: str) -> bool:
    q = output_rate(evaluation, node_id)
    c = launch_cost_rate(evaluation, node_id)
    u = unit_cost(evaluation, node_id)
    if u is None:
        return False
    return abs(u - c / q) <= float(params.CASHFLOW_ABS_TOL)


def _enumerate_strategies(
    model: NetworkModel,
    rates: Mapping[str, Any] | Sequence[float] | None = None,
) -> dict[str, Any]:
    slots = _decision_slots(model)
    strategy_count = 1 << len(slots)
    rows: list[dict[str, Any]] = []
    reason_counts: Counter[str] = Counter()
    best_code: int | None = None
    best_profit = -math.inf
    tolerance = float(params.CASHFLOW_ABS_TOL)

    for bits in itertools.product((False, True), repeat=len(slots)):
        inspect: dict[str, bool] = {}
        disassemble: dict[str, bool] = {}
        for bit, (node_id, decision) in zip(bits, slots):
            if decision == "inspect":
                inspect[node_id] = bit
            else:
                disassemble[node_id] = bit
        code = _policy_code(model, inspect, disassemble)
        evaluation = evaluate_policy(
            model,
            {"inspect": inspect, "disassemble": disassemble},
            rates=rates,
        )
        if not evaluation["valid"]:
            reason_counts[str(evaluation["invalid_reason"])] += 1
        profit = evaluation["profit"]
        if profit is not None:
            if profit > best_profit + tolerance:
                best_profit = profit
                best_code = code
            elif abs(profit - best_profit) <= tolerance and (
                best_code is None or code < best_code
            ):
                best_profit = profit
                best_code = code
        rows.append(
            {
                "code": code,
                "valid": evaluation["valid"],
                "absorption_probability": evaluation["absorption_probability"],
                "profit": profit,
                "root_output_rate_Q": evaluation["root"]["qualified_output_rate_Q"],
                "root_launch_cost_C": evaluation["root"]["launch_cost_rate_C"],
                "root_unit_cost_U": evaluation["root"]["unit_cost_U"],
                "inspection_count": sum(inspect.values()),
                "disassembly_count": sum(disassemble.values()),
            }
        )

    if best_code is None:
        raise RuntimeError("策略空间中没有有限吸收策略")
    rows.sort(key=lambda row: int(row["code"]))
    best_policy = decode_policy(model, best_code)
    best_evaluation = evaluate_policy(model, best_policy, rates=rates)
    valid_rows = [row for row in rows if row["valid"]]
    top_count = min(
        int(params.Q2_STRATEGY_SPACE_SIZE),
        len(valid_rows),
    )
    top_rows = sorted(
        valid_rows,
        key=lambda row: (-float(row["profit"]), int(row["code"])),
    )[:top_count]
    top_strategies = []
    for row in top_rows:
        item = dict(row)
        item["policy"] = decode_policy(model, int(row["code"]))
        top_strategies.append(item)

    return {
        "strategy_count": strategy_count,
        "valid_strategy_count": len(valid_rows),
        "nonabsorbing_strategy_count": len(rows) - len(valid_rows),
        "best_code": best_code,
        "best_profit": best_profit,
        "best_policy": best_policy,
        "best_evaluation": best_evaluation,
        "top_strategies": top_strategies,
        "invalid_reason_counts": dict(sorted(reason_counts.items())),
        "strategy_table": {
            "layout": "compact_columns",
            "codes": [int(row["code"]) for row in rows],
            "profit": [row["profit"] for row in rows],
            "valid": [bool(row["valid"]) for row in rows],
            "absorption_probability": [
                float(row["absorption_probability"]) for row in rows
            ],
            "root_output_rate_Q": [
                float(row["root_output_rate_Q"]) for row in rows
            ],
            "root_launch_cost_C": [
                float(row["root_launch_cost_C"]) for row in rows
            ],
            "root_unit_cost_U": [row["root_unit_cost_U"] for row in rows],
            "inspection_count": [int(row["inspection_count"]) for row in rows],
            "disassembly_count": [int(row["disassembly_count"]) for row in rows],
        },
    }


def optimize_policy(
    model: NetworkModel,
    rates: Mapping[str, Any] | Sequence[float] | None = None,
) -> dict[str, Any]:
    return _enumerate_strategies(model, rates=rates)


def solve_network(
    parent_map: Mapping[Any, Sequence[Any]] | None = None,
    node_specs: Mapping[str, Any] | Sequence[NetworkNode] | None = None,
    *,
    rates: Mapping[str, Any] | Sequence[float] | None = None,
    policy: int | Mapping[str, Any] | Sequence[Any] | None = None,
) -> dict[str, Any]:
    model = build_model(parent_map, node_specs)
    if policy is None:
        return _enumerate_strategies(model, rates=rates)
    return evaluate_policy(model, policy, rates=rates)


def _refined_relative_grid() -> list[float]:
    registered = [float(value) for value in params.RELATIVE_SENSITIVITY_GRID]
    if len(registered) <= 1:
        return registered
    target_count = 2 * len(registered) - 1
    low = min(registered)
    high = max(registered)
    step = (high - low) / (target_count - 1)
    return [low + index * step for index in range(target_count)]


def _sensitivity_rows(
    model: NetworkModel,
    policy_code: int,
) -> list[dict[str, Any]]:
    policy = decode_policy(model, policy_code)
    base_evaluation = evaluate_policy(model, policy)
    if not base_evaluation["valid"]:
        raise RuntimeError("灵敏度基准策略不是吸收策略")
    grid = _refined_relative_grid()
    families: dict[str, list[dict[str, Any]]] = {
        "defect_rates": [],
        "inspection_costs": [],
        "assembly_costs": [],
        "purchase_costs": [],
        "exchange_loss": [],
        "disassembly_costs": [],
    }

    for relative_change in grid:
        factor = 1.0 + relative_change
        rates = {
            node_id: min(1.0, max(0.0, node.p * factor))
            for node_id, node in model.nodes.items()
        }
        evaluation = evaluate_policy(model, policy, rates=rates)
        families["defect_rates"].append(
            {
                "relative_change": relative_change,
                "factor": factor,
                "profit": evaluation["profit"],
                "valid": evaluation["valid"],
            }
        )

        cost_variants = {
            "inspection_costs": {
                "inspection_cost": node.inspection_cost * factor
                for node in model.nodes.values()
            },
            "assembly_costs": {
                "assembly_cost": node.assembly_cost * factor
                for node in model.nodes.values()
            },
            "purchase_costs": {
                "purchase_cost": node.purchase_cost * factor
                for node in model.nodes.values()
            },
            "disassembly_costs": {
                "disassembly_cost": node.disassembly_cost * factor
                for node in model.nodes.values()
            },
        }
        for family, changes in cost_variants.items():
            variant_nodes = {
                node_id: replace(node, **changes)
                for node_id, node in model.nodes.items()
            }
            variant = replace(model, nodes=variant_nodes)
            evaluation = evaluate_policy(variant, policy)
            families[family].append(
                {
                    "relative_change": relative_change,
                    "factor": factor,
                    "profit": evaluation["profit"],
                    "valid": evaluation["valid"],
                }
            )

        variant = replace(
            model,
            exchange_loss=model.exchange_loss * factor,
        )
        evaluation = evaluate_policy(variant, policy)
        families["exchange_loss"].append(
            {
                "relative_change": relative_change,
                "factor": factor,
                "profit": evaluation["profit"],
                "valid": evaluation["valid"],
            }
        )

    return [
        {
            "family": family,
            "evaluation_mode": "fixed_policy_profit",
            "policy_code": policy_code,
            "points": points,
        }
        for family, points in families.items()
    ]


def _layer_numbers(model: NetworkModel) -> dict[str, int]:
    layers: dict[str, int] = {}
    for node_id in model.order:
        node = model.nodes[node_id]
        if node.node_type == "part":
            layers[node_id] = 0
        else:
            parent_layers = [layers[parent] for parent in node.parents]
            layers[node_id] = (
                max(parent_layers) + 1 if parent_layers else 0
            )
    return layers


def _solve_scenario_topology(
    edge_list: Mapping[Any, Sequence[Any]],
    topology_name: str,
) -> dict[str, Any]:
    model = build_model(edge_list)
    states = reachable_state_enumeration(
        model.graph,
        state_limit=params.Q3_REACHABLE_STATE_LIMIT,
    )
    strategy_solution = _enumerate_strategies(model)
    registered_count = int(params.Q3_EFFECTIVE_STRATEGY_COUNT)
    if strategy_solution["strategy_count"] != registered_count:
        raise AssertionError(
            "问题三策略空间与登记规模不一致："
            f"{strategy_solution['strategy_count']} != {registered_count}"
        )
    best_evaluation = strategy_solution["best_evaluation"]
    layers = _layer_numbers(model)
    sensitivity = _sensitivity_rows(
        model,
        int(strategy_solution["best_code"]),
    )
    u_identity_max_error = max(
        abs(
            float(metric["unit_cost_U"])
            - float(metric["launch_cost_rate_C"])
            / float(metric["output_rate_Q"])
        )
        for metric in best_evaluation["nodes"].values()
        if metric["unit_cost_U"] is not None
    )

    return {
        "topology_name": topology_name,
        "status": "scenario_only",
        "official_graph": False,
        "edge_list": {
            str(key): [str(item) for item in value]
            for key, value in edge_list.items()
        },
        "normalized_edges": [
            {"parent": parent, "child": child}
            for parent, child in model.graph.edges
        ],
        "node_count": len(model.order),
        "parameter_node_count": int(params.Q3_PARAMETER_NODE_COUNT),
        "layer_count": max(layers.values()) + 1,
        "node_layers": layers,
        "node_parameter_table": [
            {
                "node_id": node_id,
                **{
                    key: value
                    for key, value in vars(model.nodes[node_id]).items()
                    if key != "parents"
                },
                "parents": list(model.nodes[node_id].parents),
            }
            for node_id in model.order
        ],
        "dag_is_acyclic": nx.is_directed_acyclic_graph(model.graph),
        "all_nodes_are_root_ancestors": True,
        "general_dag_engine_supported": True,
        "reachable_activation_state_count": len(states),
        "reachable_state_limit": int(params.Q3_REACHABLE_STATE_LIMIT),
        "within_reachable_state_limit": len(states)
        <= int(params.Q3_REACHABLE_STATE_LIMIT),
        "decision_slot_codebook": [
            {
                "slot_index": slot_index,
                "node_id": node_id,
                "decision": decision,
            }
            for slot_index, (node_id, decision) in enumerate(
                _decision_slots(model)
            )
        ],
        "strategy_count": strategy_solution["strategy_count"],
        "valid_strategy_count": strategy_solution["valid_strategy_count"],
        "nonabsorbing_strategy_count": strategy_solution[
            "nonabsorbing_strategy_count"
        ],
        "invalid_reason_counts": strategy_solution[
            "invalid_reason_counts"
        ],
        "strategy_table": strategy_solution["strategy_table"],
        "top_strategies": strategy_solution["top_strategies"],
        "best_policy_code": strategy_solution["best_code"],
        "best_policy": strategy_solution["best_policy"],
        "best_policy_profit": strategy_solution["best_profit"],
        "best_policy_absorption_probability": 1.0,
        "best_node_metrics": best_evaluation["nodes"],
        "best_event_ledger": best_evaluation["event_ledger"],
        "bellman_residual": best_evaluation["bellman_residual"],
        "cashflow_residual": best_evaluation["cashflow_residual"],
        "U_equals_C_over_Q_max_error": u_identity_max_error,
        "sensitivity": sensitivity,
        "decision_basis": (
            "在全部节点检测与拆解组合中排除无有限吸收价值的策略，"
            "按完整事件现金流最大化单位合格交付利润；"
            "节点单位成本逐项由同一事件轨迹的C_v/Q_v计算。"
        ),
    }


def _q2_degenerate_model(case: Any) -> NetworkModel:
    specifications = {
        "part1": NetworkNode(
            node_id="part1",
            parents=(),
            p=float(case.p1),
            purchase_cost=float(case.price1),
            assembly_cost=0.0,
            inspection_cost=float(case.test1),
            disassembly_cost=0.0,
            node_type="part",
        ),
        "part2": NetworkNode(
            node_id="part2",
            parents=(),
            p=float(case.p2),
            purchase_cost=float(case.price2),
            assembly_cost=0.0,
            inspection_cost=float(case.test2),
            disassembly_cost=0.0,
            node_type="part",
        ),
        "product": NetworkNode(
            node_id="product",
            parents=("part1", "part2"),
            p=float(case.pf),
            purchase_cost=0.0,
            assembly_cost=float(case.assembly_cost),
            inspection_cost=float(case.product_test_cost),
            disassembly_cost=float(case.disassembly_cost),
            node_type="assembly",
        ),
    }
    return build_model(
        {"product": ("part1", "part2")},
        specifications,
        root="product",
        market_price=float(case.market_price),
        exchange_loss=float(case.exchange_loss),
    )


def _q2_closed_form_reference(
    case: Any,
    z1: bool,
    z2: bool,
    inspect_root: bool,
    disassemble_root: bool,
) -> dict[str, Any]:
    p1 = float(case.p1)
    p2 = float(case.p2)
    pf = float(case.pf)
    if z1:
        cost1 = (float(case.price1) + float(case.test1)) / (1.0 - p1)
    else:
        cost1 = float(case.price1)
    if z2:
        cost2 = (float(case.price2) + float(case.test2)) / (1.0 - p2)
    else:
        cost2 = float(case.price2)
    good1 = 1.0 if z1 else 1.0 - p1
    good2 = 1.0 if z2 else 1.0 - p2
    q = good1 * good2 * (1.0 - pf)
    certified_inputs = (z1 or p1 == 0.0) and (z2 or p2 == 0.0)
    valid = q > float(params.CASHFLOW_ABS_TOL)
    if disassemble_root and not certified_inputs:
        valid = False

    profit: float | None = None
    production_cost: float | None = None
    exchange = 0.0
    if valid:
        if inspect_root and disassemble_root:
            production_cost = (
                cost1
                + cost2
                + (float(case.assembly_cost) + float(case.product_test_cost))
                / (1.0 - pf)
                + float(case.disassembly_cost) * pf / (1.0 - pf)
            )
        elif inspect_root:
            production_cost = (
                cost1
                + cost2
                + float(case.assembly_cost)
                + float(case.product_test_cost)
            ) / q
        elif disassemble_root:
            production_cost = (
                cost1
                + cost2
                + float(case.assembly_cost) / (1.0 - pf)
                + float(case.disassembly_cost) * pf / (1.0 - pf)
            )
            exchange = float(case.exchange_loss) * pf / (1.0 - pf)
        else:
            production_cost = (
                cost1 + cost2 + float(case.assembly_cost)
            ) / q
            exchange = float(case.exchange_loss) * (1.0 - q) / q
        profit = float(case.market_price) - production_cost - exchange

    return {
        "valid": valid,
        "profit": profit,
        "production_cost": production_cost,
        "exchange_loss": exchange,
    }


def q2_degenerate_16_policy_equivalence() -> dict[str, Any]:
    """Compare all Table 1 policies with independent closed-form cash flows."""

    case = params.Q2_CASES[0]
    model = _q2_degenerate_model(case)
    tolerance = float(params.CASHFLOW_ABS_TOL)
    policy_rows: list[dict[str, Any]] = []
    max_difference = 0.0
    max_cashflow_gap = 0.0
    max_bellman_residual = 0.0
    validity_mismatches = 0

    for code in range(int(params.Q2_STRATEGY_SPACE_SIZE)):
        policy = decode_policy(model, code)
        z1 = bool(policy["inspect"]["part1"])
        z2 = bool(policy["inspect"]["part2"])
        inspect_root = bool(policy["inspect"]["product"])
        disassemble_root = bool(policy["disassemble"]["product"])
        general_evaluation = evaluate_policy(model, policy)
        reference = _q2_closed_form_reference(
            case,
            z1,
            z2,
            inspect_root,
            disassemble_root,
        )
        valid_match = general_evaluation["valid"] == reference["valid"]
        if not valid_match:
            validity_mismatches += 1
        if general_evaluation["profit"] is not None and reference["profit"] is not None:
            difference = abs(
                float(general_evaluation["profit"])
                - float(reference["profit"])
            )
            max_difference = max(max_difference, difference)
            max_cashflow_gap = max(
                max_cashflow_gap,
                float(general_evaluation["cashflow_residual"] or 0.0),
            )
            max_bellman_residual = max(
                max_bellman_residual,
                float(general_evaluation["bellman_residual"] or 0.0),
            )
        else:
            difference = 0.0
        policy_rows.append(
            {
                "q2_policy": [int(z1), int(z2), int(inspect_root), int(disassemble_root)],
                "q2_profit": reference["profit"],
                "q3_degenerate_profit": general_evaluation["profit"],
                "absolute_difference": difference,
                "valid": reference["valid"],
                "validity_match": valid_match,
            }
        )

    passed = (
        max_difference <= tolerance
        and max_cashflow_gap <= tolerance
        and max_bellman_residual <= tolerance
        and validity_mismatches == 0
    )
    return {
        "passed": passed,
        "policy_count": len(policy_rows),
        "parameter_node_count": int(params.Q2_PARAMETER_NODE_COUNT),
        "cashflow_abs_tol": tolerance,
        "identity_max_diff": max_difference,
        "q2_q3_max_profit_difference": max_difference,
        "cashflow_max_gap": max_cashflow_gap,
        "bellman_max_residual": max_bellman_residual,
        "validity_mismatch_count": validity_mismatches,
        "independent_reference": "closed_form_regenerative_cashflow",
        "policy_rows": policy_rows,
    }


def _general_chain_self_test() -> None:
    base = _scenario_node_specs()
    node_names = list(params.Q4_Q3_NODE_NAMES)
    edge_list = {
        child: [parent]
        for parent, child in zip(node_names, node_names[1:])
    }
    chain_nodes: dict[str, NetworkNode] = {}
    for index, node_id in enumerate(node_names):
        parent = () if index == 0 else (node_names[index - 1],)
        source = base[node_id]
        if parent:
            source = replace(
                source,
                parents=parent,
                node_type="assembly",
                purchase_cost=0.0,
            )
        chain_nodes[node_id] = source
    model = build_model(edge_list, chain_nodes)
    if not nx.is_directed_acyclic_graph(model.graph):
        raise AssertionError("一般多工序DAG自检失败")
    if len(model.order) != len(node_names):
        raise AssertionError("一般多工序DAG节点顺序不完整")
    policy = {
        "inspect": {node_id: True for node_id in model.order},
        "disassemble": {
            node_id: True
            for node_id, node in model.nodes.items()
            if node.node_type != "part"
        },
    }
    evaluation = evaluate_policy(model, policy)
    if not evaluation["valid"]:
        raise AssertionError("一般多工序DAG吸收策略自检失败")
    if evaluation["cashflow_residual"] is None or (
        evaluation["cashflow_residual"] > float(params.CASHFLOW_ABS_TOL)
    ):
        raise AssertionError("一般多工序DAG现金流恒等式自检失败")


def run() -> dict[str, Any]:
    """Run both registered scenario topologies and the degeneration audit."""

    primary = _solve_scenario_topology(
        params.Q3_PRIMARY_EDGE_LIST,
        "primary_inferred_3_3_2",
    )
    alternative = _solve_scenario_topology(
        params.Q3_ALTERNATIVE_EDGE_LIST,
        "alternative_inferred_2_2_4",
    )
    degeneration = q2_degenerate_16_policy_equivalence()
    _general_chain_self_test()
    topology_gap = abs(
        float(primary["best_policy_profit"])
        - float(alternative["best_policy_profit"])
    )
    return {
        "schema": "problem3-general-assembly-network-results-v2",
        "problem": 3,
        "official_problem_solved": False,
        "official_graph_available": bool(params.Q3_GRAPH_AVAILABLE),
        "scenario_only": bool(params.Q3_SCENARIO_ONLY),
        "data_gap": {
            "id": "DG-Q3-TOPOLOGY",
            "missing": "Figure 1 original and verifiable parent-edge list",
            "handling": "primary and alternative inferred topologies are isolated scenario results",
        },
        "general_dag_engine": {
            "arbitrary_stage_count_supported": True,
            "arbitrary_node_count_supported": True,
            "general_chain_self_test_passed": True,
            "topology_perturbation_executed": True,
        },
        "primary": primary,
        "alternative": alternative,
        "topology_profit_gap": topology_gap,
        "R-Q3-primary-policy": primary["best_policy"],
        "R-Q3-primary-profit": primary["best_policy_profit"],
        "R-Q3-alternative-policy": alternative["best_policy"],
        "R-Q3-alternative-profit": alternative["best_policy_profit"],
        "R-Q3-topology-profit-gap": topology_gap,
        "degeneration_check": degeneration,
        "degeneration_max_error": degeneration["identity_max_diff"],
        "R-Q3-degeneration-max-error": degeneration["identity_max_diff"],
        "official_claim_boundary": (
            "No numerical result is labelled as the verified Figure 1 solution; "
            "both numerical topologies are explicitly scenario-only."
        ),
    }


def validate(payload: Mapping[str, Any]) -> bool:
    if payload.get("schema") != "problem3-general-assembly-network-results-v2":
        raise AssertionError("问题三结果schema不匹配")
    if payload.get("official_problem_solved") is not False:
        raise AssertionError("缺失原图时不得把情景结果标成正式题图答案")
    if payload.get("scenario_only") is not True:
        raise AssertionError("问题三结果缺少scenario_only标识")
    if payload.get("official_graph_available") is not bool(
        params.Q3_GRAPH_AVAILABLE
    ):
        raise AssertionError("问题三原图状态与params不一致")

    for name in ("primary", "alternative"):
        topology = payload.get(name)
        if not isinstance(topology, Mapping):
            raise AssertionError(f"问题三缺少{name}拓扑结果")
        if topology.get("official_graph") is not False:
            raise AssertionError(f"{name}被错误标记为正式原图")
        if int(topology.get("strategy_count", -1)) != int(
            params.Q3_EFFECTIVE_STRATEGY_COUNT
        ):
            raise AssertionError(f"{name}策略空间规模错误")
        table = topology.get("strategy_table")
        if not isinstance(table, Mapping):
            raise AssertionError(f"{name}缺少完整策略数组")
        column_lengths = {
            len(table.get(column, []))
            for column in (
                "codes",
                "profit",
                "valid",
                "absorption_probability",
                "root_output_rate_Q",
                "root_launch_cost_C",
                "root_unit_cost_U",
            )
        }
        if column_lengths != {int(params.Q3_EFFECTIVE_STRATEGY_COUNT)}:
            raise AssertionError(f"{name}策略比较数组长度不一致")
        if topology.get("best_policy_absorption_probability") != 1.0:
            raise AssertionError(f"{name}最优策略不是吸收策略")
        for metric in topology.get("best_node_metrics", {}).values():
            q = float(metric["output_rate_Q"])
            c = float(metric["launch_cost_rate_C"])
            u = metric["unit_cost_U"]
            if u is None:
                if q > 0.0:
                    raise AssertionError("正产出率节点的单位成本不应为空")
            elif abs(float(u) - c / q) > float(params.CASHFLOW_ABS_TOL):
                raise AssertionError("U_v=C_v/Q_v核验失败")

    degeneration = payload.get("degeneration_check")
    if not isinstance(degeneration, Mapping) or degeneration.get("passed") is not True:
        raise AssertionError("问题二退化网络逐策略等价检查未通过")
    if int(degeneration.get("policy_count", -1)) != int(
        params.Q2_STRATEGY_SPACE_SIZE
    ):
        raise AssertionError("退化核验未覆盖全部问题二策略")
    return True


def self_test() -> None:
    model = build_model(params.Q3_PRIMARY_EDGE_LIST)
    if not nx.is_directed_acyclic_graph(model.graph):
        raise AssertionError("主情景拓扑不是DAG")
    states = reachable_state_enumeration(
        model.graph,
        state_limit=params.Q3_REACHABLE_STATE_LIMIT,
    )
    if not states or len(states) > int(params.Q3_REACHABLE_STATE_LIMIT):
        raise AssertionError("主情景可达状态枚举失败")
    if (1 << len(_decision_slots(model))) != int(
        params.Q3_EFFECTIVE_STRATEGY_COUNT
    ):
        raise AssertionError("主情景策略编码规模失败")
    degeneration = q2_degenerate_16_policy_equivalence()
    if degeneration["passed"] is not True:
        raise AssertionError("Q2退化等价回归失败")
    if float(degeneration["identity_max_diff"]) > float(
        params.CASHFLOW_ABS_TOL
    ):
        raise AssertionError("Q2退化利润差超过容差")
    _general_chain_self_test()


if __name__ == "__main__":
    raise SystemExit(
        "problem3.run() is orchestrated by main.py; direct execution writes no artifact"
    )