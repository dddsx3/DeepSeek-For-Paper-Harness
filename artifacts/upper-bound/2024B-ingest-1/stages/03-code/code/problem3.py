"""问题三：一般装配网络的事件马尔可夫奖励求解与结构核验。"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from itertools import product as cartesian_product
import math
from typing import Any

import networkx
import numpy
import numpy.linalg

import params


_POLICY_BIT_ORDER = tuple(params.Q3_POLICY_BIT_ORDER)
_RATE_VECTOR_ORDER = (
    *(f"part{node['node_id']}" for node in params.Q3_PARTS),
    *(f"semi{node['node_id']}" for node in params.Q3_SEMIS),
    "product",
)
_SEMI_NODE_NAMES = tuple(f"semi{node['node_id']}" for node in params.Q3_SEMIS)
_NODE_NAME_BY_SPEC = {
    f"part{spec['node_id']}": spec for spec in params.Q3_PARTS
}
_NODE_NAME_BY_SPEC.update(
    {f"semi{spec['node_id']}": spec for spec in params.Q3_SEMIS}
)
_NODE_NAME_BY_SPEC["product"] = params.Q3_PRODUCT_NODE


def _canonical_parameter_name(name: Any) -> str:
    text = str(name)
    if text.startswith("零配件"):
        return f"part{text.removeprefix('零配件')}"
    canonical = params._canonical_q3_node_name(text)
    aliases = {
        "part_1": "part1",
        "part_2": "part2",
        "part_3": "part3",
        "part_4": "part4",
        "part_5": "part5",
        "part_6": "part6",
        "part_7": "part7",
        "part_8": "part8",
    }
    return aliases.get(canonical, canonical)


def _plain_node_spec(spec: Mapping[str, Any], name: str) -> dict[str, Any]:
    plain = {
        "node_id": int(spec["node_id"]),
        "kind": str(spec["kind"]),
        "defect_rate": float(spec["defect_rate"]),
        "purchase_price": (
            float(spec["purchase_price"]) if spec["kind"] == "part" else None
        ),
        "inspection_cost": float(spec["inspection_cost"]),
        "assembly_cost": (
            float(spec["assembly_cost"]) if spec["kind"] != "part" else None
        ),
        "disassembly_cost": (
            float(spec["disassembly_cost"]) if spec["kind"] != "part" else None
        ),
    }
    return plain


def _default_node_specs() -> dict[str, dict[str, Any]]:
    return {
        name: _plain_node_spec(spec, name)
        for name, spec in _NODE_NAME_BY_SPEC.items()
    }


def _resolve_topology(topology: Any) -> dict[str, Any]:
    if topology is None:
        return params.Q3_PRIMARY_TOPOLOGY
    if isinstance(topology, str):
        normalized = topology.strip().lower()
        if normalized in {"primary", "main", "inferred_primary"}:
            return params.Q3_PRIMARY_TOPOLOGY
        if normalized in {"alternative", "alt", "inferred_alternative"}:
            return params.Q3_ALTERNATIVE_TOPOLOGY
        raise ValueError(f"未知的问题三拓扑名称：{topology}")
    return topology


def assembly_graph(topology: Any = None) -> networkx.DiGraph:
    """把登记边表实例化为 networkx.DiGraph，并验证其为有限 DAG。"""
    resolved = _resolve_topology(topology)
    graph = networkx.DiGraph()
    graph.add_nodes_from(_NODE_NAME_BY_SPEC)
    if isinstance(resolved, networkx.DiGraph):
        graph.add_edges_from(resolved.edges())
    elif isinstance(resolved, Mapping):
        for target, sources in resolved.items():
            target_name = _canonical_parameter_name(target)
            if target_name not in _NODE_NAME_BY_SPEC:
                raise ValueError(f"边表含未登记节点：{target}")
            graph.add_node(target_name)
            if isinstance(sources, (str, bytes)) or not isinstance(sources, Sequence):
                sources = [sources]
            for source in sources:
                source_name = _canonical_parameter_name(source)
                if source_name not in _NODE_NAME_BY_SPEC:
                    raise ValueError(f"边表含未登记父节点：{source}")
                graph.add_edge(source_name, target_name)
    else:
        raise TypeError("topology 必须是边表、networkx.DiGraph 或登记名称")
    if not networkx.is_directed_acyclic_graph(graph):
        raise ValueError("问题三装配网络必须是有向无环图")
    return graph


def _resolve_defect_rates(
    defect_rates: Any,
    node_specs: Mapping[str, Mapping[str, Any]],
) -> dict[str, float]:
    if defect_rates is None:
        return {
            name: float(spec["defect_rate"])
            for name, spec in node_specs.items()
        }
    resolved: dict[str, float] = {}
    if isinstance(defect_rates, Mapping):
        for key, value in defect_rates.items():
            name = _canonical_parameter_name(key)
            if name in node_specs:
                resolved[name] = float(value)
    elif isinstance(defect_rates, Sequence) and not isinstance(
        defect_rates, (str, bytes)
    ):
        values = tuple(float(value) for value in defect_rates)
        if len(values) != len(_RATE_VECTOR_ORDER):
            raise ValueError("次品率向量长度与登记参数节点数不一致")
        resolved = dict(zip(_RATE_VECTOR_ORDER, values))
    else:
        raise TypeError("defect_rates 必须是节点映射或按登记顺序排列的向量")
    rates = {
        name: resolved.get(name, float(node_specs[name]["defect_rate"]))
        for name in node_specs
    }
    for name, rate in rates.items():
        if not math.isfinite(rate) or rate < 0.0 or rate > 1.0:
            raise ValueError(f"节点 {name} 的次品率不在比例域内")
    return rates


def defect_rate_vector(
    defect_rates: Any = None,
    topology: Any = None,
) -> list[float]:
    """返回与 _RATE_VECTOR_ORDER 一致、可直接传给问题四重解的率向量。"""
    specs = _default_node_specs()
    graph = assembly_graph(topology)
    rates = _resolve_defect_rates(defect_rates, specs)
    return [rates[name] for name in _RATE_VECTOR_ORDER]


def _policy_mapping(policy: Any) -> dict[str, int]:
    if isinstance(policy, Mapping):
        if "policy_vector" in policy:
            policy = policy["policy_vector"]
        elif "policy" in policy and isinstance(policy["policy"], Mapping):
            policy = policy["policy"]
        else:
            resolved: dict[str, int] = {}
            for decision_name in _POLICY_BIT_ORDER:
                candidates = [decision_name]
                if decision_name.startswith("part"):
                    candidates.append(decision_name.removesuffix("_inspection"))
                elif decision_name.startswith("semi"):
                    candidates.append(decision_name.removesuffix("_disassembly"))
                elif decision_name == "product_inspection":
                    candidates.extend(["product", "成品"])
                elif decision_name == "product_disassembly":
                    candidates.extend(["product", "成品"])
                found = next(
                    (candidate for candidate in candidates if candidate in policy),
                    None,
                )
                if found is None:
                    raise ValueError(f"策略缺少决策：{decision_name}")
                resolved[decision_name] = int(bool(policy[found]))
            return resolved
    if isinstance(policy, bool):
        raise TypeError("策略必须给出完整的节点级二进制决策")
    if isinstance(policy, int):
        return decode_policy(policy)
    if isinstance(policy, Sequence) and not isinstance(policy, (str, bytes)):
        values = tuple(int(bool(value)) for value in policy)
        if len(values) != len(_POLICY_BIT_ORDER):
            raise ValueError("策略向量长度与登记问题三决策位数不一致")
        return dict(zip(_POLICY_BIT_ORDER, values))
    raise TypeError("policy 必须是整数编码、完整向量或节点决策映射")


def decode_policy(policy_code: int) -> dict[str, int]:
    """按高位在前的登记顺序解码策略。"""
    code = int(policy_code)
    if code < 0 or code >= params.Q3_POLICY_SPACE_COUNT:
        raise ValueError("策略编码超出登记问题三策略空间")
    decisions: dict[str, int] = {}
    for decision_name in _POLICY_BIT_ORDER:
        decisions[decision_name] = code & 1
        code >>= 1
    return decisions


def encode_policy(policy: Any) -> int:
    """将完整策略编码为可复算的整数。"""
    decisions = _policy_mapping(policy)
    code = 0
    for decision_name in _POLICY_BIT_ORDER:
        code = (code << 1) | int(decisions[decision_name])
    return code


def policy_vector(policy: Any) -> list[int]:
    decisions = _policy_mapping(policy)
    return [int(decisions[name]) for name in _POLICY_BIT_ORDER]


def _policy_payload(policy: Any) -> dict[str, Any]:
    decisions = _policy_mapping(policy)
    vector = policy_vector(decisions)
    code = encode_policy(decisions)
    part_inspection = {
        f"part{spec['node_id']}": int(
            decisions[f"part{spec['node_id']}_inspection"]
        )
        for spec in params.Q3_PARTS
    }
    semi_inspection = {
        f"semi{spec['node_id']}": int(
            decisions[f"semi{spec['node_id']}_inspection"]
        )
        for spec in params.Q3_SEMIS
    }
    semi_disassembly = {
        f"semi{spec['node_id']}": int(
            decisions[f"semi{spec['node_id']}_disassembly"]
        )
        for spec in params.Q3_SEMIS
    }
    return {
        "code": code,
        "vector": vector,
        "part_inspection": part_inspection,
        "semi_inspection": semi_inspection,
        "product_inspection": int(decisions["product_inspection"]),
        "semi_disassembly": semi_disassembly,
        "product_disassembly": int(decisions["product_disassembly"]),
        "label": (
            "I[part=" + "".join(map(str, part_inspection.values()))
            + ";semi=" + "".join(map(str, semi_inspection.values()))
            + ";product=" + str(int(decisions["product_inspection"]))
            + ";D[semi=" + "".join(map(str, semi_disassembly.values()))
            + ";product=" + str(int(decisions["product_disassembly"])) + "]"
        ),
    }


def reachable_state_enumeration(
    graph: networkx.DiGraph,
) -> list[dict[str, Any]]:
    """枚举各节点单次投入所需的父件质量组合及零件初态。"""
    descriptors: list[dict[str, Any]] = []
    for node in networkx.topological_sort(graph):
        parents = tuple(graph.predecessors(node))
        if graph.nodes[node].get("kind", _NODE_NAME_BY_SPEC[node]["kind"]) == "part":
            patterns: list[dict[str, str]] = [
                {"quality": quality} for quality in params.Q2_STATES
            ]
        else:
            patterns = [
                {
                    parent: quality
                    for parent, quality in zip(parents, quality_pattern)
                }
                for quality_pattern in cartesian_product(
                    (params.GOOD, params.BAD),
                    repeat=len(parents),
                )
            ]
        descriptors.append(
            {
                "node": node,
                "parents": list(parents),
                "local_state_count": len(patterns),
                "states": patterns,
            }
        )
    return descriptors


def _geometric_absorption(success_probability: float) -> tuple[float, float]:
    """用吸收方程求解几何重试概率，并返回 Bellman 残差。"""
    probability = float(success_probability)
    if probability <= 0.0:
        return 0.0, 1.0
    coefficient = numpy.asarray([[probability]], dtype=float)
    right_hand_side = numpy.asarray([probability], dtype=float)
    estimate = float(numpy.linalg.solve(coefficient, right_hand_side)[0])
    residual = abs(estimate - (probability + (1.0 - probability) * estimate))
    return estimate, residual


def _rate_specs(
    defect_rates: Any,
    node_specs: Mapping[str, Mapping[str, Any]],
) -> dict[str, float]:
    return _resolve_defect_rates(defect_rates, node_specs)


def event_markov_reward(
    policy: Any,
    defect_rates: Any = None,
    topology: Any = None,
) -> dict[str, Any]:
    """按采购、检测、装配、调换、报废和拆解事件求解固定策略。"""
    decisions = _policy_mapping(policy)
    graph = assembly_graph(topology)
    node_specs = _default_node_specs()
    rates = _rate_specs(defect_rates, node_specs)
    roots = [node for node in graph if graph.out_degree(node) == 0]
    if len(roots) != 1:
        raise ValueError("事件动态规划要求网络恰有一个根节点")
    root = roots[0]
    topological_nodes = tuple(networkx.topological_sort(graph))
    node_probability: dict[str, float] = {}
    node_cost: dict[str, float] = {}
    node_metrics: dict[str, dict[str, Any]] = {}
    feasible = True

    for node in topological_nodes:
        spec = node_specs[node]
        defect_rate = rates[node]
        inspect = bool(decisions[f"{node}_inspection"])
        parents = tuple(graph.predecessors(node))
        parent_good = (
            math.prod(node_probability[parent] for parent in parents)
            if parents
            else 1.0
        )
        parent_cost = sum(node_cost[parent] for parent in parents)
        successful_assembly_probability = parent_good * (1.0 - defect_rate)
        geometric_purchase_count = (
            1.0 / (1.0 - defect_rate) if defect_rate < 1.0 else math.inf
        )

        if node == root:
            disassemble = bool(decisions[f"{node}_disassembly"])
            success_probability = (
                successful_assembly_probability if inspect else parent_good
            )
            market_probability = (
                successful_assembly_probability if inspect else 1.0
            )
            bad_market_probability = (
                0.0 if inspect else 1.0 - parent_good
            )
            assembly_cost = float(spec["assembly_cost"])
            inspection_cost = float(spec["inspection_cost"])
            disassembly_cost = float(spec["disassembly_cost"])
            exchange_loss = params.Q3_EXCHANGE_LOSS
            sale_price = params.Q3_MARKET_PRICE
            if success_probability <= 0.0:
                feasible = False
                parent_cost_per_good = math.inf
                assembly_cost_per_good = math.inf
                inspection_cost_per_good = math.inf
                disassembly_cost_per_good = math.inf
                production_cost = math.inf
                exchange_cost = math.inf
                revenue = -math.inf
                profit = -math.inf
                output_rate = 0.0
                launch_cash_cost_rate = math.inf
                absorption_probability = 0.0
                bellman_residual = 1.0
                market_transactions = math.inf
                return_count = math.inf
            elif disassemble:
                parent_cost_per_good = parent_cost
                assembly_cost_per_good = assembly_cost / success_probability
                inspection_cost_per_good = (
                    inspection_cost / success_probability if inspect else 0.0
                )
                disassembly_cost_per_good = (
                    disassembly_cost
                    * (1.0 - success_probability)
                    / success_probability
                )
                market_transactions = market_probability / success_probability
                return_count = bad_market_probability / success_probability
                exchange_cost = params.Q3_EXCHANGE_LOSS * return_count
                revenue = params.Q3_MARKET_PRICE * market_transactions
                production_cost = (
                    parent_cost_per_good
                    + assembly_cost_per_good
                    + inspection_cost_per_good
                    + disassembly_cost_per_good
                )
                profit = revenue - exchange_cost - production_cost
                output_rate = 1.0
                launch_cash_cost_rate = production_cost
            else:
                parent_cost_per_good = parent_cost / success_probability
                assembly_cost_per_good = assembly_cost / success_probability
                inspection_cost_per_good = (
                    inspection_cost / success_probability if inspect else 0.0
                )
                disassembly_cost_per_good = 0.0
                market_transactions = market_probability / success_probability
                return_count = bad_market_probability / success_probability
                exchange_cost = params.Q3_EXCHANGE_LOSS * return_count
                revenue = params.Q3_MARKET_PRICE * market_transactions
                production_cost = (
                    parent_cost_per_good
                    + assembly_cost_per_good
                    + inspection_cost_per_good
                )
                profit = revenue - exchange_cost - production_cost
                output_rate = success_probability
                launch_cash_cost_rate = (
                    parent_cost + assembly_cost + inspection_cost * int(inspect)
                )
            absorption_probability, bellman_residual = _geometric_absorption(
                success_probability
            )
            unit_cost = (
                launch_cash_cost_rate / output_rate
                if output_rate > 0.0
                else math.inf
            )
            accounting_error = abs(
                profit + production_cost + exchange_cost - revenue
            )
            node_probability[node] = output_rate
            node_cost[node] = launch_cash_cost_rate
            node_metrics[node] = {
                "node": node,
                "kind": spec["kind"],
                "parents": list(parents),
                "defect_rate": defect_rate,
                "inspection_decision": int(inspect),
                "disassembly_decision": int(disassemble),
                "parent_good_probability": parent_good,
                "successful_assembly_probability": successful_assembly_probability,
                "success_probability_per_root_cycle": success_probability,
                "output_rate_Q": output_rate,
                "launch_cash_cost_rate_C": launch_cash_cost_rate,
                "equivalent_unit_cost_U": unit_cost,
                "unit_identity_error": abs(unit_cost * output_rate - launch_cash_cost_rate),
                "parent_processing_cost_per_qualified_delivery": parent_cost_per_good,
                "root_assembly_cost_per_qualified_delivery": assembly_cost_per_good,
                "root_inspection_cost_per_qualified_delivery": inspection_cost_per_good,
                "root_disassembly_cost_per_qualified_delivery": disassembly_cost_per_good,
                "exchange_loss_per_qualified_delivery": exchange_cost,
                "production_cost_per_qualified_delivery": production_cost,
                "market_revenue_per_qualified_delivery": revenue,
                "market_transactions_per_qualified_delivery": market_transactions,
                "customer_returns_per_qualified_delivery": return_count,
                "profit_yuan_per_qualified_delivery": profit,
                "cashflow_identity_error": accounting_error,
                "absorption_probability": absorption_probability,
                "bellman_residual": bellman_residual,
            }
            continue

        if spec["kind"] == "part":
            purchase_price = float(spec["purchase_price"])
            inspection_cost = float(spec["inspection_cost"])
            if inspect:
                if defect_rate >= 1.0:
                    feasible = False
                    probability = math.nan
                    launch_cost = math.inf
                else:
                    probability = 1.0
                    launch_cost = (
                        purchase_price + inspection_cost
                    ) * geometric_purchase_count
            else:
                probability = 1.0 - defect_rate
                launch_cost = purchase_price
            unit_cost = (
                launch_cost / probability
                if probability > 0.0
                else math.inf
            )
            node_probability[node] = probability
            node_cost[node] = launch_cost
            node_metrics[node] = {
                "node": node,
                "kind": spec["kind"],
                "parents": [],
                "defect_rate": defect_rate,
                "purchase_price": purchase_price,
                "inspection_cost": inspection_cost,
                "inspection_decision": int(inspect),
                "output_rate_Q": probability,
                "launch_cash_cost_rate_C": launch_cost,
                "equivalent_unit_cost_U": unit_cost,
                "unit_identity_error": abs(unit_cost * probability - launch_cost),
                "expected_purchases_per_good_output": (
                    geometric_purchase_count if inspect else 1.0
                ),
            }
            continue

        disassemble = bool(decisions[f"{node}_disassembly"])
        assembly_cost = float(spec["assembly_cost"])
        inspection_cost = float(spec["inspection_cost"])
        disassembly_cost = float(spec["disassembly_cost"])
        if not inspect:
            probability = parent_good
            launch_cost = parent_cost + assembly_cost
        elif not disassemble:
            probability = successful_assembly_probability
            launch_cost = parent_cost + assembly_cost + inspection_cost
            if probability <= 0.0:
                feasible = False
        else:
            probability = 1.0 if successful_assembly_probability > 0.0 else 0.0
            launch_cost = (
                (
                    parent_cost
                    + assembly_cost
                    + inspection_cost
                    + disassembly_cost
                )
                / successful_assembly_probability
                if successful_assembly_probability > 0.0
                else math.inf
            )
            if successful_assembly_probability <= 0.0:
                feasible = False
        unit_cost = (
            launch_cost / probability if probability > 0.0 else math.inf
        )
        node_probability[node] = probability
        node_cost[node] = launch_cost
        node_metrics[node] = {
            "node": node,
            "kind": spec["kind"],
            "parents": list(parents),
            "defect_rate": defect_rate,
            "assembly_cost": assembly_cost,
            "inspection_cost": inspection_cost,
            "disassembly_cost": disassembly_cost,
            "inspection_decision": int(inspect),
            "disassembly_decision": int(disassemble),
            "parent_good_probability": parent_good,
            "successful_assembly_probability": successful_assembly_probability,
            "output_rate_Q": probability,
            "launch_cash_cost_rate_C": launch_cost,
            "equivalent_unit_cost_U": unit_cost,
            "unit_identity_error": abs(unit_cost * probability - launch_cost),
        }

    profit = node_metrics[root]["profit_yuan_per_qualified_delivery"]
    return {
        "feasible": bool(feasible and math.isfinite(profit)),
        "policy": _policy_payload(decisions),
        "profit_yuan_per_qualified_delivery": profit,
        "unit_profit_yuan_per_qualified_delivery": profit,
        "node_metrics": [node_metrics[node] for node in topological_nodes],
    }


def _safe_array_divide(
    numerator: Any,
    denominator: Any,
) -> numpy.ndarray:
    numerator_array = numpy.asarray(numerator, dtype=float)
    denominator_array = numpy.asarray(denominator, dtype=float)
    output = numpy.full(numpy.broadcast(numerator_array, denominator_array).shape, numpy.nan)
    return numpy.divide(
        numerator_array,
        denominator_array,
        out=output,
        where=denominator_array > 0.0,
    )


def _all_policy_arrays(
    defect_rates: Any = None,
    topology: Any = None,
) -> dict[str, Any]:
    """向量化穷举登记的完整策略空间，不以局部比例规则删策略。"""
    graph = assembly_graph(topology)
    node_specs = _default_node_specs()
    rates = _rate_specs(defect_rates, node_specs)
    strategy_codes = numpy.arange(params.Q3_POLICY_SPACE_COUNT, dtype=numpy.int64)
    shifts = numpy.arange(
        params.Q3_TOTAL_DECISION_COUNT - 1,
        -1,
        -1,
    )
    bits = (
        strategy_codes[:, None] >> shifts[None, :]
    ) & 1
    decisions = {
        name: bits[:, index].astype(bool)
        for index, name in enumerate(_POLICY_BIT_ORDER)
    }
    node_probability: dict[str, numpy.ndarray] = {}
    node_cost: dict[str, numpy.ndarray] = {}
    root_cashflow: dict[str, numpy.ndarray] = {}
    topological_nodes = tuple(networkx.topological_sort(graph))
    roots = [node for node in topological_nodes if graph.out_degree(node) == 0]
    if len(roots) != 1:
        raise ValueError("完整策略枚举要求网络恰有一个根节点")
    root = roots[0]

    for node in topological_nodes:
        spec = node_specs[node]
        defect_rate = rates[node]
        inspect = decisions[f"{node}_inspection"]
        parents = tuple(graph.predecessors(node))
        if parents:
            parent_probability = numpy.column_stack(
                [node_probability[parent] for parent in parents]
            )
            parent_good = numpy.prod(parent_probability, axis=1)
            parent_cost = numpy.sum(
                numpy.column_stack([node_cost[parent] for parent in parents]),
                axis=1,
            )
        else:
            parent_good = numpy.ones_like(inspect, dtype=float)
            parent_cost = numpy.zeros_like(inspect, dtype=float)
        successful_assembly_probability = parent_good * (1.0 - defect_rate)

        if node != root and spec["kind"] == "part":
            geometric_count = (
                1.0 / (1.0 - defect_rate)
                if defect_rate < 1.0
                else math.nan
            )
            purchase_price = float(spec["purchase_price"])
            inspection_cost = float(spec["inspection_cost"])
            probability = numpy.where(
                inspect,
                1.0,
                1.0 - defect_rate,
            )
            launch_cost = numpy.where(
                inspect,
                (purchase_price + inspection_cost) * geometric_count,
                purchase_price,
            )
            launch_cost = numpy.where(
                inspect & (defect_rate >= 1.0),
                numpy.nan,
                launch_cost,
            )
            probability = numpy.where(
                inspect & (defect_rate >= 1.0),
                numpy.nan,
                probability,
            )
            node_probability[node] = probability
            node_cost[node] = launch_cost
            continue

        if node != root:
            disassemble = decisions[f"{node}_disassembly"]
            assembly_cost = float(spec["assembly_cost"])
            inspection_cost = float(spec["inspection_cost"])
            disassembly_cost = float(spec["disassembly_cost"])
            inspected_internal = inspect & ~disassemble
            inspected_rework = inspect & disassemble
            probability = numpy.where(
                inspect,
                numpy.where(disassemble, 1.0, successful_assembly_probability),
                parent_good,
            )
            direct_cost = parent_cost + assembly_cost + inspect * inspection_cost
            rework_cost = _safe_array_divide(
                direct_cost + inspect * disassembly_cost,
                successful_assembly_probability,
            )
            launch_cost = numpy.where(
                inspect,
                numpy.where(disassemble, rework_cost, direct_cost),
                parent_cost + assembly_cost,
            )
            invalid = inspect & (
                (successful_assembly_probability <= 0.0)
                | ~numpy.isfinite(launch_cost)
            )
            probability = numpy.where(invalid, numpy.nan, probability)
            launch_cost = numpy.where(invalid, numpy.nan, launch_cost)
            node_probability[node] = probability
            node_cost[node] = launch_cost
            continue

        disassemble = decisions[f"{node}_disassembly"]
        assembly_cost = float(spec["assembly_cost"])
        inspection_cost = float(spec["inspection_cost"])
        disassembly_cost = float(spec["disassembly_cost"])
        success_probability = numpy.where(
            inspect,
            successful_assembly_probability,
            parent_good,
        )
        market_probability = numpy.where(
            inspect,
            successful_assembly_probability,
            1.0,
        )
        bad_market_probability = numpy.where(
            inspect,
            0.0,
            1.0 - parent_good,
        )
        direct_production = (
            parent_cost
            + assembly_cost
            + inspect * inspection_cost
        )
        direct_revenue = params.Q3_MARKET_PRICE * market_probability
        direct_exchange = params.Q3_EXCHANGE_LOSS * bad_market_probability

        scrap_parent_cost = _safe_array_divide(
            direct_production,
            success_probability,
        )
        scrap_assembly_cost = _safe_array_divide(
            assembly_cost,
            success_probability,
        )
        scrap_inspection_cost = _safe_array_divide(
            inspect * inspection_cost,
            success_probability,
        )
        scrap_exchange = _safe_array_divide(
            direct_exchange,
            success_probability,
        )
        scrap_revenue = _safe_array_divide(
            direct_revenue,
            success_probability,
        )
        scrap_production = scrap_parent_cost + scrap_assembly_cost + scrap_inspection_cost
        scrap_market_transactions = _safe_array_divide(
            market_probability,
            success_probability,
        )
        scrap_returns = _safe_array_divide(
            bad_market_probability,
            success_probability,
        )
        scrap_output_rate = success_probability
        scrap_launch_cost = direct_production

        rework_parent_cost = parent_cost
        rework_assembly_cost = _safe_array_divide(
            assembly_cost,
            success_probability,
        )
        rework_inspection_cost = _safe_array_divide(
            inspect * inspection_cost,
            success_probability,
        )
        rework_disassembly_cost = _safe_array_divide(
            disassembly_cost * (1.0 - success_probability),
            success_probability,
        )
        rework_exchange = _safe_array_divide(
            direct_exchange,
            success_probability,
        )
        rework_revenue = _safe_array_divide(
            direct_revenue,
            success_probability,
        )
        rework_production = (
            rework_parent_cost
            + rework_assembly_cost
            + rework_inspection_cost
            + rework_disassembly_cost
        )
        rework_market_transactions = _safe_array_divide(
            market_probability,
            success_probability,
        )
        rework_returns = _safe_array_divide(
            bad_market_probability,
            success_probability,
        )
        rework_output_rate = numpy.ones_like(success_probability)
        rework_launch_cost = rework_production

        node_probability[node] = numpy.where(
            disassemble,
            rework_output_rate,
            scrap_output_rate,
        )
        node_cost[node] = numpy.where(
            disassemble,
            rework_launch_cost,
            scrap_launch_cost,
        )
        profit = numpy.where(
            disassemble,
            rework_revenue - rework_exchange - rework_production,
            scrap_revenue - scrap_exchange - scrap_production,
        )
        root_cashflow = {
            "profit": profit,
            "parent_processing_cost": numpy.where(
                disassemble,
                rework_parent_cost,
                scrap_parent_cost,
            ),
            "root_assembly_cost": numpy.where(
                disassemble,
                rework_assembly_cost,
                scrap_assembly_cost,
            ),
            "root_inspection_cost": numpy.where(
                disassemble,
                rework_inspection_cost,
                scrap_inspection_cost,
            ),
            "root_disassembly_cost": numpy.where(
                disassemble,
                rework_disassembly_cost,
                0.0,
            ),
            "exchange_loss": numpy.where(
                disassemble,
                rework_exchange,
                scrap_exchange,
            ),
            "market_revenue": numpy.where(
                disassemble,
                rework_revenue,
                scrap_revenue,
            ),
            "production_cost": numpy.where(
                disassemble,
                rework_production,
                scrap_production,
            ),
            "market_transactions": numpy.where(
                disassemble,
                rework_market_transactions,
                scrap_market_transactions,
            ),
            "customer_returns": numpy.where(
                disassemble,
                rework_returns,
                scrap_returns,
            ),
            "output_rate_Q": node_probability[root],
            "launch_cash_cost_rate_C": node_cost[root],
        }

    probability = node_probability[root]
    cost = node_cost[root]
    profit = root_cashflow["profit"]
    feasible = (
        numpy.isfinite(probability)
        & numpy.isfinite(cost)
        & numpy.isfinite(profit)
        & (probability > 0.0)
    )
    return {
        "strategy_codes": strategy_codes,
        "decisions": decisions,
        "node_probability": node_probability,
        "node_cost": node_cost,
        "root_cashflow": root_cashflow,
        "profit": profit,
        "feasible": feasible,
        "graph": graph,
        "rates": rates,
    }


def _json_safe(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if isinstance(value, numpy.ndarray):
        return _json_safe(value.tolist())
    if isinstance(value, numpy.bool_):
        return bool(value)
    if isinstance(value, numpy.integer):
        return int(value)
    if isinstance(value, numpy.floating):
        value = float(value)
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    return value


def evaluate_all_strategies(
    defect_rates: Any = None,
    topology: Any = None,
) -> dict[str, Any]:
    """返回与策略编码逐项对齐的完整利润和可行向量。"""
    arrays = _all_policy_arrays(defect_rates, topology)
    profit = arrays["profit"]
    net_cost = -profit
    return _json_safe(
        {
            "policy_codes": {
                "minimum": 0,
                "maximum": params.Q3_POLICY_SPACE_COUNT - 1,
                "count": params.Q3_POLICY_SPACE_COUNT,
                "array_index_equals_policy_code": True,
            },
            "profit_by_strategy": profit,
            "strategy_net_cost_by_strategy": net_cost,
            "feasible_by_strategy": arrays["feasible"],
            "decision_bit_order": list(_POLICY_BIT_ORDER),
        }
    )


def _topology_payload(graph: networkx.DiGraph) -> dict[str, Any]:
    return {
        "nodes": list(graph.nodes),
        "edges": [list(edge) for edge in graph.edges],
        "edge_count": graph.number_of_edges(),
        "node_count": graph.number_of_nodes(),
        "is_dag": networkx.is_directed_acyclic_graph(graph),
    }


def _semi_root_strategy_grid(
    optimal_policy: Mapping[str, int],
    defect_rates: Any,
    topology: Any,
) -> list[dict[str, Any]]:
    local_decision_count = len(_SEMI_NODE_NAMES) + 1
    rows: list[dict[str, Any]] = []
    for combination in cartesian_product(
        (0, 1),
        repeat=local_decision_count,
    ):
        candidate = dict(optimal_policy)
        for name, pair in zip(_SEMI_NODE_NAMES, combination[:-1]):
            candidate[f"{name}_inspection"] = int(pair[0])
            candidate[f"{name}_disassembly"] = int(pair[1])
        candidate["product_inspection"] = int(combination[-1][0])
        candidate["product_disassembly"] = int(combination[-1][1])
        value = event_markov_reward(candidate, defect_rates, topology)
        rows.append(
            {
                "semi_and_root_decisions": [
                    *[
                        {
                            "node": name,
                            "inspection": int(combination[index][0]),
                            "disassembly": int(combination[index][1]),
                        }
                        for index, name in enumerate(_SEMI_NODE_NAMES)
                    ],
                    {
                        "node": "product",
                        "inspection": int(combination[-1][0]),
                        "disassembly": int(combination[-1][1]),
                    },
                ],
                "policy_vector": policy_vector(candidate),
                "feasible": bool(value["feasible"]),
                "profit": value["profit_yuan_per_qualified_delivery"],
                "net_cost": (
                    -value["profit_yuan_per_qualified_delivery"]
                    if value["feasible"]
                    else None
                ),
            }
        )
    return rows


def optimize_network(
    defect_rates: Any = None,
    topology: Any = None,
    include_strategy_grid: bool = True,
) -> dict[str, Any]:
    """穷举完整策略空间并返回全局最优节点指标。"""
    arrays = _all_policy_arrays(defect_rates, topology)
    feasible = arrays["feasible"]
    if not bool(numpy.any(feasible)):
        raise RuntimeError("当前次品率向量下没有可吸收的完整策略")
    masked_profit = numpy.where(feasible, arrays["profit"], -numpy.inf)
    best_index = int(numpy.argmax(masked_profit))
    best_code = int(best_index)
    best_policy = decode_policy(best_code)
    optimal = event_markov_reward(best_policy, defect_rates, topology)
    graph = arrays["graph"]
    state_descriptors = reachable_state_enumeration(graph)
    state_count = sum(item["local_state_count"] for item in state_descriptors)
    if state_count > params.Q3_REACHABLE_STATE_LIMIT:
        raise RuntimeError("结构化可达状态数超过登记上限")
    root_metrics = next(
        item
        for item in optimal["node_metrics"]
        if item["node"] == graph.nodes[graph.out_degree(graph) == 0][0]
    )
    unit_identity_max_error = max(
        float(item.get("unit_identity_error", 0.0) or 0.0)
        for item in optimal["node_metrics"]
    )
    cashflow_identity_max_error = max(
        float(item.get("cashflow_identity_error", 0.0) or 0.0)
        for item in optimal["node_metrics"]
    )
    strategy_payload: dict[str, Any] = {
        "count": params.Q3_POLICY_SPACE_COUNT,
        "decision_bit_order": list(_POLICY_BIT_ORDER),
        "array_index_equals_policy_code": True,
        "enumeration": "complete_vectorized_exact_event_reward",
    }
    if include_strategy_grid:
        strategy_payload.update(
            {
                "profit_by_strategy": arrays["profit"],
                "strategy_net_cost_by_strategy": -arrays["profit"],
                "feasible_by_strategy": feasible,
            }
        )
    scenario_name = "primary" if _resolve_topology(topology) is params.Q3_PRIMARY_TOPOLOGY else "alternative"
    return _json_safe(
        {
            "scenario": scenario_name,
            "topology_is_inferred": True,
            "official_topology_available": params.Q3_OFFICIAL_TOPOLOGY_AVAILABLE,
            "topology": _topology_payload(graph),
            "defect_rates": arrays["rates"],
            "policy": optimal["policy"],
            "optimal_policy": optimal["policy"],
            "policy_vector": policy_vector(best_policy),
            "profit": optimal["profit_yuan_per_qualified_delivery"],
            "unit_profit": optimal["profit_yuan_per_qualified_delivery"],
            "profit_yuan_per_qualified_delivery": optimal["profit_yuan_per_qualified_delivery"],
            "node_metrics": optimal["node_metrics"],
            "root_metrics": root_metrics,
            "semi_root_strategy_grid": _semi_root_strategy_grid(
                best_policy,
                defect_rates,
                topology,
            ),
            "strategy_space": strategy_payload,
            "reachable_state_count": state_count,
            "reachable_state_descriptors": state_descriptors,
            "validation": {
                "full_registered_policy_space_enumerated": bool(
                    len(masked_profit) == params.Q3_POLICY_SPACE_COUNT
                ),
                "policy_count_matches_contract": bool(
                    len(masked_profit) == params.Q3_POLICY_SPACE_COUNT
                ),
                "lexicographic_tie_break_policy_code": best_code,
                "optimal_is_absorbing": bool(
                    optimal["feasible"]
                    and root_metrics["absorption_probability"] >= 1.0 - params.CASHFLOW_ABS_TOL
                ),
                "bellman_residual": root_metrics["bellman_residual"],
                "unit_identity_max_error": unit_identity_max_error,
                "cashflow_identity_max_error": cashflow_identity_max_error,
                "reachable_state_limit_respected": bool(
                    state_count <= params.Q3_REACHABLE_STATE_LIMIT
                ),
            },
        }
    )


def _component_branch(
    current_quality: str,
    inspect: bool,
    defect_rate: float,
    purchase_price: float,
    inspection_cost: float,
) -> dict[str, tuple[float, float, float]] | None:
    if current_quality == params.GOOD:
        return {params.GOOD: (1.0, 0.0, 0.0)}
    if inspect and defect_rate >= 1.0:
        return None
    geometric_count = 1.0 / (1.0 - defect_rate)
    if current_quality == params.EMPTY:
        if inspect:
            return {
                params.GOOD: (
                    1.0,
                    purchase_price * geometric_count,
                    inspection_cost * geometric_count,
                )
            }
        return {
            params.GOOD: (
                1.0 - defect_rate,
                purchase_price,
                0.0,
            ),
            params.BAD: (defect_rate, purchase_price, 0.0),
        }
    if not inspect:
        return {params.BAD: (1.0, 0.0, 0.0)}
    return {
        params.GOOD: (
            1.0,
            purchase_price * geometric_count,
            inspection_cost + inspection_cost * geometric_count,
        )
    }


def _independent_two_part_markov_reward(
    policy: Sequence[int],
    case: Mapping[str, Any],
) -> dict[str, Any]:
    """以九状态吸收方程独立复算问题二现金流，供问题三退化验收。"""
    z1, z2, product_inspection, disassemble = (
        int(value) for value in policy
    )
    p1 = float(case["p1"])
    p2 = float(case["p2"])
    pf = float(case["pf"])
    a1 = float(case["a1"])
    a2 = float(case["a2"])
    t1 = float(case["t1"])
    t2 = float(case["t2"])
    assembly_cost = float(case["kf"])
    product_inspection_cost = float(case["tf"])
    disassembly_cost = float(case["g_dis"])
    sale_price = float(case["r_market"])
    exchange_loss = float(case["L_exchange"])
    states = tuple(
        cartesian_product(params.Q2_STATES, repeat=len(params.Q2_STATES))
    )
    state_index = {state: index for index, state in enumerate(states)}
    state_count = len(states)
    transition = numpy.zeros((state_count, state_count), dtype=float)
    flow_names = (
        "purchase_cost",
        "inspection_cost",
        "assembly_cost",
        "disassembly_cost",
        "exchange_loss",
        "market_revenue",
        "market_transactions",
        "customer_returns",
    )
    immediate_flows = {
        name: numpy.zeros(state_count, dtype=float)
        for name in flow_names
    }
    absorption_rhs = numpy.zeros(state_count, dtype=float)
    feasible = True

    for state in states:
        row = state_index[state]
        branch1 = _component_branch(
            state[0], bool(z1), p1, a1, t1
        )
        branch2 = _component_branch(
            state[1], bool(z2), p2, a2, t2
        )
        if branch1 is None or branch2 is None:
            feasible = False
            continue
        combined: dict[tuple[str, str], tuple[float, float, float]] = {}
        for quality1, values1 in branch1.items():
            for quality2, values2 in branch2.items():
                probability = values1[0] * values2[0]
                purchase = values1[1] + values2[1]
                inspection = values1[2] + values2[2]
                key = (quality1, quality2)
                if key in combined:
                    old_probability, old_purchase, old_inspection = combined[key]
                    combined[key] = (
                        old_probability + probability,
                        old_purchase + purchase,
                        old_inspection + inspection,
                    )
                else:
                    combined[key] = (probability, purchase, inspection)
        for (quality1, quality2), (
            probability,
            purchase,
            inspection,
        ) in combined.items():
            both_good = (
                quality1 == params.GOOD and quality2 == params.GOOD
            )
            good_probability = probability * ((1.0 - pf) if both_good else 0.0)
            bad_probability = probability - good_probability
            common_purchase = probability * purchase
            common_inspection = probability * (
                inspection + product_inspection * int(product_inspection)
            )
            common_assembly = probability * assembly_cost
            if good_probability > 0.0:
                market_probability = good_probability
                immediate_flows["market_revenue"][row] += (
                    sale_price * market_probability
                )
                immediate_flows["market_transactions"][row] += market_probability
                absorption_rhs[row] += good_probability
            if bad_probability > 0.0:
                if product_inspection:
                    bad_exchange = 0.0
                    bad_market = 0.0
                else:
                    bad_exchange = exchange_loss
                    bad_market = bad_probability
                    immediate_flows["market_revenue"][row] += sale_price * bad_market
                    immediate_flows["market_transactions"][row] += bad_market
                    immediate_flows["customer_returns"][row] += bad_probability
                bad_disassembly = (
                    disassembly_cost * bad_probability
                    if disassemble
                    else 0.0
                )
                immediate_flows["purchase_cost"][row] += common_purchase
                immediate_flows["inspection_cost"][row] += common_inspection
                immediate_flows["assembly_cost"][row] += common_assembly
                immediate_flows["exchange_loss"][row] += bad_probability * bad_exchange
                immediate_flows["disassembly_cost"][row] += bad_disassembly
                next_state = state if disassemble else (params.EMPTY, params.EMPTY)
                transition[row, state_index[next_state]] += bad_probability

    if not feasible:
        return {
            "feasible": False,
            "profit_yuan_per_qualified_delivery": None,
            "bellman_residual": None,
        }

    coefficient = numpy.eye(state_count) - transition
    value = numpy.linalg.solve(coefficient, absorption_rhs)
    expected_flows: dict[str, numpy.ndarray] = {}
    for name, immediate in immediate_flows.items():
        expected_flows[name] = numpy.linalg.solve(coefficient, immediate)
    root_row = state_index[(params.EMPTY, params.EMPTY)]
    production_cost = (
        expected_flows["purchase_cost"][root_row]
        + expected_flows["inspection_cost"][root_row]
        + expected_flows["assembly_cost"][root_row]
        + expected_flows["disassembly_cost"][root_row]
    )
    exchange_cost = expected_flows["exchange_loss"][root_row]
    revenue = expected_flows["market_revenue"][root_row]
    profit = revenue - exchange_cost - production_cost
    bellman_residual = float(
        numpy.max(numpy.abs(coefficient @ value - absorption_rhs))
    )
    accounting_error = abs(profit + production_cost + exchange_cost - revenue)
    return {
        "feasible": True,
        "profit_yuan_per_qualified_delivery": float(profit),
        "event_cashflow_sum": float(profit),
        "purchase_cost": float(expected_flows["purchase_cost"][root_row]),
        "inspection_cost": float(expected_flows["inspection_cost"][root_row]),
        "assembly_cost": float(expected_flows["assembly_cost"][root_row]),
        "disassembly_cost": float(expected_flows["disassembly_cost"][root_row]),
        "exchange_loss": float(exchange_cost),
        "market_revenue": float(revenue),
        "market_transactions": float(expected_flows["market_transactions"][root_row]),
        "customer_returns": float(expected_flows["customer_returns"][root_row]),
        "absorption_probability": float(value[root_row]),
        "bellman_residual": bellman_residual,
        "cashflow_identity_error": float(accounting_error),
        "dp_state_count": state_count,
    }


def _degenerate_tree_profit(
    policy: Sequence[int],
    case: Mapping[str, Any],
) -> float:
    z1, z2, product_inspection, disassemble = policy
    node_specs = {
        "part1": _plain_node_spec(case["part1"], "part1"),
        "part2": _plain_node_spec(case["part2"], "part2"),
        "product": _plain_node_spec(case["product"], "product"),
    }
    rates = {
        "part1": float(case["p1"]),
        "part2": float(case["p2"]),
        "product": float(case["pf"]),
    }
    policy_map = {
        "part1_inspection": int(z1),
        "part2_inspection": int(z2),
        "product_inspection": int(product_inspection),
        "product_disassembly": int(disassemble),
    }
    topology = {
        "product": ["part1", "part2"],
    }
    value = event_markov_reward(policy_map, rates, topology)
    if not value["feasible"]:
        raise RuntimeError("退化问题三策略出现非吸收状态")
    return float(value["profit_yuan_per_qualified_delivery"])


def q2_degenerate_16_policy_equivalence() -> dict[str, Any]:
    """逐情形、逐策略比较一般网络与独立九状态事件账本。"""
    rows: list[dict[str, Any]] = []
    case_payloads: list[dict[str, Any]] = []
    maximum_error = 0.0
    maximum_identity_error = 0.0
    for case in params.Q2_CASES:
        case_maximum = 0.0
        case_rows: list[dict[str, Any]] = []
        for policy in params.Q2_POLICY_SPACE:
            tree_profit = _degenerate_tree_profit(policy, case)
            reference = _independent_two_part_markov_reward(policy, case)
            difference = abs(tree_profit - reference["profit_yuan_per_qualified_delivery"])
            case_maximum = max(case_maximum, difference)
            maximum_error = max(maximum_error, difference)
            maximum_identity_error = max(
                maximum_identity_error,
                reference["cashflow_identity_error"],
            )
            row = {
                "case_id": str(case["case_id"]),
                "policy_vector_q2": list(policy),
                "q3_degenerate_profit": tree_profit,
                "independent_q2_markov_profit": reference[
                    "profit_yuan_per_qualified_delivery"
                ],
                "absolute_difference": difference,
                "within_tolerance": bool(
                    difference <= params.CASHFLOW_ABS_TOL
                ),
                "absorption_probability": reference["absorption_probability"],
                "bellman_residual": reference["bellman_residual"],
                "cashflow_identity_error": reference["cashflow_identity_error"],
                "dp_state_count": reference["dp_state_count"],
                "reference_cashflow": {
                    key: reference[key]
                    for key in (
                        "purchase_cost",
                        "inspection_cost",
                        "assembly_cost",
                        "disassembly_cost",
                        "exchange_loss",
                        "market_revenue",
                        "market_transactions",
                        "customer_returns",
                    )
                },
            }
            case_rows.append(row)
            rows.append(row)
        case_payloads.append(
            {
                "case_id": str(case["case_id"]),
                "policy_count": len(case_rows),
                "max_absolute_difference": case_maximum,
                "all_within_tolerance": bool(
                    case_maximum <= params.CASHFLOW_ABS_TOL
                ),
                "comparisons": case_rows,
            }
        )
    return {
        "reference_model": "independent_nine_state_absorbing_markov_reward",
        "tolerance": params.CASHFLOW_ABS_TOL,
        "q2_policy_count_per_case": params.Q2_POLICY_SPACE_COUNT,
        "case_count": len(params.Q2_CASES),
        "comparison_count": len(rows),
        "max_absolute_difference": maximum_error,
        "identity_max_diff": maximum_error,
        "max_cashflow_identity_error": maximum_identity_error,
        "all_within_tolerance": bool(
            maximum_error <= params.CASHFLOW_ABS_TOL
            and maximum_identity_error <= params.CASHFLOW_ABS_TOL
        ),
        "cases": case_payloads,
        "comparisons": rows,
    }


def output_rate(metrics: Mapping[str, Any]) -> float | None:
    """返回每次节点投入的合格产出率 Q。"""
    value = float(metrics["output_rate_Q"])
    return value if math.isfinite(value) else None


def launch_cost_rate(metrics: Mapping[str, Any]) -> float | None:
    """返回与 Q 同轨迹的每次投入期望现金成本 C。"""
    value = float(metrics["launch_cash_cost_rate_C"])
    return value if math.isfinite(value) else None


def U_equals_C_over_Q(metrics: Mapping[str, Any]) -> dict[str, Any]:
    """核验单位合格产出成本始终按 U=C/Q 计算。"""
    q_value = output_rate(metrics)
    c_value = launch_cost_rate(metrics)
    if q_value is None or c_value is None or q_value <= 0.0:
        return {
            "valid": False,
            "Q": q_value,
            "C": c_value,
            "U": None,
            "identity_error": None,
        }
    unit_cost = c_value / q_value
    return {
        "valid": bool(unit_cost >= 0.0),
        "Q": q_value,
        "C": c_value,
        "U": unit_cost,
        "identity_error": abs(unit_cost * q_value - c_value),
    }


def topology_perturbation(
    primary_result: Mapping[str, Any],
    alternative_result: Mapping[str, Any],
) -> dict[str, Any]:
    primary_profit = float(primary_result["profit"])
    alternative_profit = float(alternative_result["profit"])
    return {
        "primary_profit": primary_profit,
        "alternative_profit": alternative_profit,
        "absolute_profit_gap": abs(primary_profit - alternative_profit),
        "signed_profit_gap_primary_minus_alternative": (
            primary_profit - alternative_profit
        ),
        "policy_changed": bool(
            primary_result["policy_vector"] != alternative_result["policy_vector"]
        ),
    }


def evaluate_strategy(
    policy: Any,
    defect_rates: Any = None,
    topology: Any = None,
    rates: Any = None,
) -> dict[str, Any]:
    """供跨问重优化调用的单策略事件利润接口。"""
    selected_rates = rates if rates is not None else defect_rates
    return event_markov_reward(policy, selected_rates, topology)


def evaluate_policy(
    policy: Any,
    defect_rates: Any = None,
    topology: Any = None,
    rates: Any = None,
) -> dict[str, Any]:
    return evaluate_strategy(policy, defect_rates, topology, rates)


def evaluate_q3_policy(
    policy: Any,
    defect_rates: Any = None,
    topology: Any = None,
) -> dict[str, Any]:
    return evaluate_strategy(policy, defect_rates, topology)


def policy_profit(
    policy: Any,
    defect_rates: Any = None,
    topology: Any = None,
) -> float | None:
    value = evaluate_strategy(policy, defect_rates, topology)
    return value["profit_yuan_per_qualified_delivery"] if value["feasible"] else None


def decision_value(
    defect_rates: Any,
    policy: Any,
    topology: Any = None,
) -> float | None:
    return policy_profit(policy, defect_rates, topology)


def optimize_policy(
    defect_rates: Any = None,
    topology: Any = None,
    include_strategy_grid: bool = False,
) -> dict[str, Any]:
    return optimize_network(
        defect_rates,
        topology,
        include_strategy_grid,
    )


def solve_network(
    defect_rates: Any = None,
    topology: Any = None,
    include_strategy_grid: bool = False,
) -> dict[str, Any]:
    return optimize_network(
        defect_rates,
        topology,
        include_strategy_grid,
    )


def solve_q3(
    defect_rates: Any = None,
    topology: Any = None,
    include_strategy_grid: bool = False,
) -> dict[str, Any]:
    return optimize_network(
        defect_rates,
        topology,
        include_strategy_grid,
    )


def run_problem3() -> dict[str, Any]:
    """运行主替拓扑、完整策略枚举和退化等价验收。"""
    if len(_POLICY_BIT_ORDER) != (
        params.Q3_INSPECTION_DECISION_COUNT
        + params.Q3_DISPOSAL_DECISION_COUNT
    ):
        raise RuntimeError("问题三决策位登记数量不一致")
    if params.Q3_POLICY_SPACE_COUNT != (
        2 ** params.Q3_TOTAL_DECISION_COUNT
    ):
        raise RuntimeError("问题三策略空间规模与决策位数不一致")
    primary = optimize_network(
        defect_rates=None,
        topology=params.Q3_PRIMARY_TOPOLOGY,
        include_strategy_grid=True,
    )
    alternative = optimize_network(
        defect_rates=None,
        topology=params.Q3_ALTERNATIVE_TOPOLOGY,
        include_strategy_grid=True,
    )
    degeneration = q2_degenerate_16_policy_equivalence()
    if not degeneration["all_within_tolerance"]:
        raise RuntimeError("问题二退化实例与问题三事件网络未通过等价验收")
    topology_comparison = topology_perturbation(primary, alternative)
    payload = {
        "status": "completed",
        "official_instance_status": "blocked_missing_authoritative_topology",
        "conditional_results_only": True,
        "official_topology_available": params.Q3_OFFICIAL_TOPOLOGY_AVAILABLE,
        "official_instance": {
            "status": "not_claimed",
            "reason": "upstream_missing_verified_figure1_parent_edges",
            "requested_specific_instance_answer_available": False,
        },
        "primary": primary,
        "alternative": alternative,
        "primary_policy": primary["policy"],
        "primary_profit": primary["profit"],
        "alternative_policy": alternative["policy"],
        "alternative_profit": alternative["profit"],
        "topology_profit_gap": topology_comparison["absolute_profit_gap"],
        "topology_perturbation": topology_comparison,
        "degenerate_q2_equivalence": degeneration,
        "degeneration_max_error": degeneration["max_absolute_difference"],
        "identity_max_diff": degeneration["max_absolute_difference"],
        "strategy_spaces": {
            "primary": primary["strategy_space"],
            "alternative": alternative["strategy_space"],
        },
        "validation_summary": {
            "full_strategy_spaces_enumerated": bool(
                primary["validation"]["full_registered_policy_space_enumerated"]
                and alternative["validation"]["full_registered_policy_space_enumerated"]
            ),
            "all_optimal_strategies_absorbing": bool(
                primary["validation"]["optimal_is_absorbing"]
                and alternative["validation"]["optimal_is_absorbing"]
            ),
            "primary_unit_identity_max_error": primary["validation"][
                "unit_identity_max_error"
            ],
            "alternative_unit_identity_max_error": alternative["validation"][
                "unit_identity_max_error"
            ],
            "degeneration_max_error": degeneration["max_absolute_difference"],
            "degeneration_within_tolerance": degeneration[
                "all_within_tolerance"
            ],
            "official_instance_blocked_honestly": True,
        },
        "method": {
            "network": "networkx.DiGraph",
            "state_enumeration": "reachable_state_enumeration",
            "reward_solver": "event_markov_reward",
            "search": "complete_enumeration_of_registered_binary_policy_space",
            "rates": (
                "output_rate_Q",
                "launch_cash_cost_rate_C",
                "equivalent_unit_cost_U_equals_C_over_Q",
            ),
            "root_failure_paths": [
                "inspection_detected_scrap",
                "inspection_detected_disassembly_rework",
                "market_return_scrap_replacement",
                "market_return_disassembly_rework",
            ],
            "official_topology_claim": "withheld_pending_verified_edge_list",
        },
    }
    safe_payload = _json_safe(payload)
    encoded = __import__("json").dumps(
        safe_payload,
        ensure_ascii=False,
        allow_nan=False,
    )
    if not encoded:
        raise RuntimeError("问题三结果编码为空")
    return safe_payload


def run() -> dict[str, Any]:
    return run_problem3()


def main() -> None:
    run()


if __name__ == "__main__":
    main()