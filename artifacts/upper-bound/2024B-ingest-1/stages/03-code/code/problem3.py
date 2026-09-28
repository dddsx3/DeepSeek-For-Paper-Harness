from __future__ import annotations

import itertools
import json
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any, Callable

import networkx as nx
import numpy as np

import params


COST_KEYS = (
    "purchase",
    "inspection",
    "assembly",
    "disassembly",
    "exchange_loss",
)
EVENT_KEYS = (
    "purchase_events",
    "inspection_events",
    "assembly_events",
    "disassembly_events",
    "market_events",
    "exchange_events",
    "part_launches",
    "semi_launches",
    "root_launches",
)
VALUE_KEYS = COST_KEYS + ("market_revenue",) + EVENT_KEYS
COST_INDEX = {name: index for index, name in enumerate(VALUE_KEYS)}
EVENT_INDEX = {name: index for index, name in enumerate(VALUE_KEYS)}


def _param(*names: str) -> Any:
    for name in names:
        if hasattr(params, name):
            return getattr(params, name)
    joined = ", ".join(names)
    raise KeyError(f"params.py 缺少登记参数：{joined}")


def _as_rate(value: Any) -> float:
    if isinstance(value, str):
        text = value.strip()
        if text.endswith("%"):
            base = float(_param("PERCENT_BASE", "PERCENTAGE_BASE", "HUNDRED"))
            return float(text[:-1]) / base
        return float(text)
    rate = float(value)
    if not math.isfinite(rate) or rate < 0 or rate > 1:
        raise ValueError(f"次品率必须位于 [0,1]，实际为 {rate}")
    return rate


def _record_value(record: Any, names: Sequence[str], tuple_index: int | None = None) -> Any:
    if isinstance(record, Mapping):
        for name in names:
            if name in record:
                return record[name]
    if hasattr(record, "keys"):
        for name in names:
            try:
                if name in record:
                    return record[name]
            except TypeError:
                pass
    if isinstance(record, Sequence) and not isinstance(record, (str, bytes)) and tuple_index is not None:
        return record[tuple_index]
    for name in names:
        if hasattr(record, name):
            return getattr(record, name)
    raise KeyError(f"记录中找不到字段 {names}")


def _records_from_raw(raw: Any, container_names: Sequence[str]) -> list[Any]:
    if isinstance(raw, Sequence) and not isinstance(raw, (str, bytes)):
        return list(raw)
    if not isinstance(raw, Mapping):
        raise TypeError("参数表必须是记录序列或映射")
    field_names = {
        "defect_rate",
        "defect",
        "p",
        "次品率",
        "purchase_cost",
        "price",
        "购买单价",
        "inspection_cost",
        "检测成本",
        "assembly_cost",
        "装配成本",
        "disassembly_cost",
        "拆解费用",
    }
    if field_names.intersection(raw.keys()):
        return [raw]
    for container in container_names:
        if container in raw and isinstance(raw[container], Sequence):
            return list(raw[container])
    records: list[Any] = []
    for key, value in raw.items():
        if isinstance(value, Mapping):
            item = dict(value)
            item.setdefault("id", key)
            records.append(item)
    if not records:
        raise KeyError(f"无法从参数表识别记录：{container_names}")
    return records


def _canonical_id(value: Any) -> Any:
    if isinstance(value, (int, np.integer)):
        return int(value)
    text = str(value).strip()
    if text.isdecimal():
        return int(text)
    lowered = text.lower()
    if "半成品" in text:
        digits = "".join(character for character in text if character.isdecimal())
        return f"semi_{digits}" if digits else text
    if "成品" in text or lowered in {"product", "final", "finished", "root"}:
        return "product"
    if "零配件" in text:
        digits = "".join(character for character in text if character.isdecimal())
        return int(digits) if digits else text
    return text


def _numeric_tail(value: Any) -> int | None:
    canonical = _canonical_id(value)
    if isinstance(canonical, int):
        return canonical
    digits = "".join(character for character in str(canonical) if character.isdecimal())
    return int(digits) if digits else None


def _same_series_id(left: Any, right: Any) -> bool:
    if _canonical_id(left) == _canonical_id(right):
        return True
    left_tail = _numeric_tail(left)
    right_tail = _numeric_tail(right)
    return left_tail is not None and left_tail == right_tail


def _part_table() -> list[Any]:
    try:
        raw = _param(
            "Q3_PART_DATA",
            "Q3_PARTS",
            "TABLE2_PARTS",
            "TABLE2_PART_DATA",
            "Q3_PART_ROWS",
        )
        return _records_from_raw(raw, ("parts", "part_data", "零配件", "records"))
    except KeyError:
        rates = _param("Q3_PART_DEFECT_RATES", "TABLE2_PART_DEFECT_RATES")
        prices = _param("Q3_PART_PURCHASE_COSTS", "TABLE2_PART_PURCHASE_COSTS")
        inspections = _param("Q3_PART_INSPECTION_COSTS", "TABLE2_PART_INSPECTION_COSTS")
        length = min(len(rates), len(prices), len(inspections))
        return [
            {
                "id": index,
                "defect_rate": rates[index],
                "purchase_cost": prices[index],
                "inspection_cost": inspections[index],
            }
            for index in range(length)
        ]


def _semi_table() -> list[Any]:
    try:
        raw = _param(
            "Q3_SEMI_DATA",
            "Q3_SEMIS",
            "TABLE2_SEMIS",
            "TABLE2_SEMI_DATA",
            "Q3_SEMI_ROWS",
        )
        return _records_from_raw(raw, ("semis", "semi_data", "半成品", "records"))
    except KeyError:
        rates = _param("Q3_SEMI_DEFECT_RATES", "TABLE2_SEMI_DEFECT_RATES")
        assemblies = _param("Q3_SEMI_ASSEMBLY_COSTS", "TABLE2_SEMI_ASSEMBLY_COSTS")
        inspections = _param("Q3_SEMI_INSPECTION_COSTS", "TABLE2_SEMI_INSPECTION_COSTS")
        disassemblies = _param("Q3_SEMI_DISASSEMBLY_COSTS", "TABLE2_SEMI_DISASSEMBLY_COSTS")
        length = min(len(rates), len(assemblies), len(inspections), len(disassemblies))
        return [
            {
                "id": index + 1,
                "defect_rate": rates[index],
                "assembly_cost": assemblies[index],
                "inspection_cost": inspections[index],
                "disassembly_cost": disassemblies[index],
            }
            for index in range(length)
        ]


def _product_record() -> Any:
    raw = _param("Q3_PRODUCT_DATA", "Q3_PRODUCT", "TABLE2_PRODUCT", "TABLE2_PRODUCT_DATA")
    if isinstance(raw, Mapping) and "product" in raw:
        return raw["product"]
    return raw


def _find_record(records: Sequence[Any], node_id: Any, tuple_id_index: int | None = None) -> Any:
    for record in records:
        try:
            record_id = _record_value(record, ("id", "编号", "number", "name"), tuple_id_index)
        except KeyError:
            continue
        if _same_series_id(record_id, node_id):
            return record
    raise KeyError(f"参数表中找不到节点 {node_id!r}")


@dataclass
class Network:
    name: str
    nodes: tuple[Any, ...]
    part_ids: tuple[Any, ...]
    semi_ids: tuple[Any, ...]
    root_id: Any
    parents: dict[Any, tuple[Any, ...]]
    children: dict[Any, tuple[Any, ...]]
    defect_rate: dict[Any, float]
    purchase_cost: dict[Any, float]
    assembly_cost: dict[Any, float]
    inspection_cost: dict[Any, float]
    disassembly_cost: dict[Any, float]
    market_price: float
    exchange_loss: float
    is_official_instance: bool = False
    graph: nx.DiGraph = field(repr=False, compare=False)

    def decision_bit_order(self) -> tuple[str, ...]:
        labels = [f"part:{node}:inspect" for node in self.part_ids]
        labels.extend(f"semi:{node}:inspect" for node in self.semi_ids)
        labels.extend(f"semi:{node}:disassemble" for node in self.semi_ids)
        labels.extend(("root:inspect", "root:disassemble"))
        return tuple(labels)

    def expected_policy_size(self) -> int:
        return 1 << len(self.decision_bit_order())

    def edges(self) -> list[list[Any]]:
        return [[parent, node] for node in self.nodes for parent in self.parents[node]]

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "nodes": list(self.nodes),
            "parts": list(self.part_ids),
            "semis": list(self.semi_ids),
            "root": self.root_id,
            "edges": self.edges(),
            "defect_rate": {str(key): value for key, value in self.defect_rate.items()},
            "purchase_cost": {str(key): value for key, value in self.purchase_cost.items()},
            "assembly_cost": {str(key): value for key, value in self.assembly_cost.items()},
            "inspection_cost": {str(key): value for key, value in self.inspection_cost.items()},
            "disassembly_cost": {str(key): value for key, value in self.disassembly_cost.items()},
            "market_price": self.market_price,
            "exchange_loss": self.exchange_loss,
            "official_instance": self.is_official_instance,
        }


def _normalise_topology(topology: Mapping[Any, Any]) -> tuple[dict[Any, tuple[Any, ...]], Any]:
    normalised: dict[Any, tuple[Any, ...]] = {}
    root_candidates: list[Any] = []
    for raw_node, raw_parents in topology.items():
        node = _canonical_id(raw_node)
        parents = raw_parents if isinstance(raw_parents, Sequence) and not isinstance(raw_parents, (str, bytes)) else (raw_parents,)
        normalised[node] = tuple(_canonical_id(parent) for parent in parents)
        text = str(raw_node).lower()
        if "半成品" not in text and ("成品" in text or text in {"product", "final", "finished", "root"}):
            root_candidates.append(node)
    if len(root_candidates) != 1:
        raise ValueError("边表必须且只能包含一个成品根节点")
    return normalised, root_candidates[0]


def build_network(
    topology: str | Mapping[Any, Any] = "conditional_primary",
    defect_rates: Mapping[Any, float] | Sequence[float] | None = None,
) -> Network:
    if isinstance(topology, str):
        if "altern" in topology.lower() or "替代" in topology:
            raw_topology = _param("Q3_ALTERNATIVE_TOPOLOGY", "ALTERNATIVE_TOPOLOGY")
            name = "conditional_alternative"
        else:
            raw_topology = _param("Q3_PRIMARY_TOPOLOGY", "PRIMARY_TOPOLOGY")
            name = "conditional_registered_scenario"
    else:
        raw_topology = topology
        name = "conditional_supplied_scenario"
    parent_map, root_id = _normalise_topology(raw_topology)
    non_root = [node for node in parent_map if node != root_id]
    part_ids = tuple(node for node in non_root if isinstance(node, int))
    semi_ids = tuple(node for node in non_root if isinstance(node, str) and node.startswith("semi_"))
    if set(non_root) != set(part_ids) | set(semi_ids):
        raise ValueError("当前层实现只接受零配件层与半成品层的两级 DAG")
    if not semi_ids:
        raise ValueError("登记实例应至少包含一个半成品节点")
    part_records = _part_table()
    semi_records = _semi_table()
    product_record = _product_record()

    defect: dict[Any, float] = {}
    purchase: dict[Any, float] = {}
    assembly: dict[Any, float] = {}
    inspection: dict[Any, float] = {}
    disassembly: dict[Any, float] = {}

    for part_id in part_ids:
        record = _find_record(part_records, part_id, 0)
        defect[part_id] = _as_rate(_record_value(record, ("defect_rate", "defect", "p", "次品率"), 1))
        purchase[part_id] = float(_record_value(record, ("purchase_cost", "price", "购买单价"), 2))
        inspection[part_id] = float(_record_value(record, ("inspection_cost", "检测成本"), 1 + 2))
        assembly[part_id] = 0.0
        disassembly[part_id] = 0.0

    for semi_id in semi_ids:
        record = _find_record(semi_records, semi_id, 0)
        defect[semi_id] = _as_rate(_record_value(record, ("defect_rate", "defect", "p", "次品率"), 1))
        assembly[semi_id] = float(_record_value(record, ("assembly_cost", "装配成本"), 2))
        inspection[semi_id] = float(_record_value(record, ("inspection_cost", "检测成本"), 1 + 2))
        disassembly[semi_id] = float(_record_value(record, ("disassembly_cost", "拆解费用"), 2 + 2))
        purchase[semi_id] = 0.0

    defect[root_id] = _as_rate(
        _record_value(product_record, ("defect_rate", "defect", "p", "次品率"), 0)
    )
    assembly[root_id] = float(_record_value(product_record, ("assembly_cost", "装配成本"), 1))
    inspection[root_id] = float(_record_value(product_record, ("inspection_cost", "检测成本"), 2))
    disassembly[root_id] = float(_record_value(product_record, ("disassembly_cost", "拆解费用"), 2 + 2))
    purchase[root_id] = 0.0

    graph = nx.DiGraph()
    graph.add_nodes_from(part_ids)
    graph.add_nodes_from(semi_ids)
    graph.add_node(root_id)
    for node, parents in parent_map.items():
        for parent in parents:
            graph.add_edge(parent, node)
    if not nx.is_directed_acyclic_graph(graph):
        raise ValueError("装配网络必须是有向无环图")
    topological = tuple(nx.topological_sort(graph))
    children = {node: tuple(child for child in topological if node in parent_map[child]) for node in topological}
    parents = {node: parent_map[node] for node in topological}
    for semi_id in semi_ids:
        if not children[semi_id] or not all(child in part_ids for child in children[semi_id]):
            raise ValueError("半成品节点必须且只能接收零配件")
    if not parents[root_id] or not all(parent in semi_ids for parent in parents[root_id]):
        raise ValueError("成品根节点必须且只能接收半成品")

    network = Network(
        name=name,
        nodes=topological,
        part_ids=part_ids,
        semi_ids=semi_ids,
        root_id=root_id,
        parents=parents,
        children=children,
        defect_rate=defect,
        purchase_cost=purchase,
        assembly_cost=assembly,
        inspection_cost=inspection,
        disassembly_cost=disassembly,
        market_price=float(_param("Q3_MARKET_PRICE", "TABLE2_MARKET_PRICE", "MARKET_PRICE_Q3")),
        exchange_loss=float(_param("Q3_EXCHANGE_LOSS", "TABLE2_EXCHANGE_LOSS", "EXCHANGE_LOSS_Q3")),
        is_official_instance=False,
        graph=graph,
    )
    return network_with_rates(network, defect_rates) if defect_rates is not None else network


def network_with_rates(
    network: Network,
    rates: Mapping[Any, float] | Sequence[float] | None,
) -> Network:
    if rates is None:
        return network
    updated = dict(network.defect_rate)
    if isinstance(rates, Mapping):
        for key, value in rates.items():
            canonical = _canonical_id(key)
            if canonical not in updated:
                raise KeyError(f"未知缺陷率节点 {key!r}")
            updated[canonical] = _as_rate(value)
    else:
        if len(rates) != len(network.nodes):
            raise ValueError("缺陷率序列长度与拓扑节点数不一致")
        updated = {node: _as_rate(value) for node, value in zip(network.nodes, rates)}
    return replace(network, defect_rate=updated)


@dataclass(frozen=True)
class Policy:
    inspect_parts: tuple[bool, ...]
    inspect_semis: tuple[bool, ...]
    disassemble_semis: tuple[bool, ...]
    inspect_root: bool
    disassemble_root: bool

    @classmethod
    def from_vector(cls, network: Network, vector: Sequence[bool]) -> "Policy":
        expected = len(network.part_ids) + 2 * len(network.semi_ids) + 2
        if len(vector) != expected:
            raise ValueError(f"策略维度错误：应为 {expected}，实际为 {len(vector)}")
        part_end = len(network.part_ids)
        semi_end = part_end + len(network.semi_ids)
        disassembly_end = semi_end + len(network.semi_ids)
        return cls(
            inspect_parts=tuple(bool(value) for value in vector[:part_end]),
            inspect_semis=tuple(bool(value) for value in vector[part_end:semi_end]),
            disassemble_semis=tuple(bool(value) for value in vector[semi_end:disassembly_end]),
            inspect_root=bool(vector[disassembly_end]),
            disassemble_root=bool(vector[disassembly_end + 1]),
        )

    @classmethod
    def from_mapping(cls, network: Network, mapping: Mapping[str, Any]) -> "Policy":
        generated = cls._generated_mapping_keys(network)
        if all(key in mapping for key in generated):
            return cls.from_vector(network, [mapping[key] for key in generated])
        legacy = ("Z1", "Z2", "C", "D")
        if len(network.part_ids) == 1 + 1 and all(key in mapping for key in legacy):
            return cls(
                inspect_parts=(bool(mapping["Z1"]), bool(mapping["Z2"])),
                inspect_semis=(),
                disassemble_semis=(),
                inspect_root=bool(mapping["C"]),
                disassemble_root=bool(mapping["D"]),
            )
        raise KeyError("策略映射不完整")

    @staticmethod
    def _generated_mapping_keys(network: Network) -> tuple[str, ...]:
        return network.decision_bit_order()

    def to_vector(self, network: Network) -> tuple[bool, ...]:
        return (
            tuple(self.inspect_parts)
            + tuple(self.inspect_semis)
            + tuple(self.disassemble_semis)
            + (self.inspect_root, self.disassemble_root)
        )

    def to_mapping(self, network: Network) -> dict[str, bool]:
        return {
            key: bool(value)
            for key, value in zip(network.decision_bit_order(), self.to_vector(network))
        }

    def to_legacy_tuple(self) -> tuple[bool, bool, bool, bool]:
        if len(self.inspect_parts) != 1 + 1:
            raise ValueError("旧式四元组只适用于两零件退化网络")
        return (
            self.inspect_parts[0],
            self.inspect_parts[1],
            self.inspect_root,
            self.disassemble_root,
        )


@dataclass(frozen=True)
class _Item:
    node: Any
    good: bool
    children: tuple["_Item", ...] = ()


def _zero_value() -> np.ndarray:
    return np.zeros(len(VALUE_KEYS), dtype=float)


def _add_to(target: np.ndarray, key: str, amount: float) -> None:
    target[COST_INDEX[key] if key in COST_INDEX else EVENT_INDEX[key]] += amount


def output_rate(expected_launches_to_one_good: float) -> float:
    if expected_launches_to_one_good <= 0:
        raise ValueError("期望投产次数必须为正")
    return 1.0 / expected_launches_to_one_good


def launch_cost_rate(total_cost_to_one_good: float, expected_launches_to_one_good: float) -> float:
    if expected_launches_to_one_good <= 0:
        raise ValueError("期望投产次数必须为正")
    return total_cost_to_one_good / expected_launches_to_one_good


def U_equals_C_over_Q(q_value: float, c_value: float, u_value: float) -> float:
    return abs(u_value - c_value / q_value)


def reachable_state_enumeration(
    initial_state: Any,
    transition_builder: Callable[[Any], Sequence[tuple[float, Any, np.ndarray]]],
) -> tuple[list[Any], dict[Any, list[tuple[float, Any, np.ndarray]]]]:
    queue: list[Any] = [initial_state]
    transitions: dict[Any, list[tuple[float, Any, np.ndarray]]] = {}
    seen = {initial_state}
    while queue:
        state = queue.pop(0)
        state_transitions = list(transition_builder(state))
        transitions[state] = state_transitions
        for _, next_state, _ in state_transitions:
            if next_state is not None and next_state not in seen:
                seen.add(next_state)
                queue.append(next_state)
    return list(transitions), transitions


def event_markov_reward(
    initial_state: Any,
    transition_builder: Callable[[Any], Sequence[tuple[float, Any, np.ndarray]]],
) -> dict[str, Any]:
    states, transitions = reachable_state_enumeration(initial_state, transition_builder)
    if not states:
        raise ValueError("事件马尔可夫链没有可达状态")
    state_index = {state: index for index, state in enumerate(states)}
    dimension = len(states)
    system = np.eye(dimension, dtype=float)
    rewards = np.zeros((dimension, len(VALUE_KEYS)), dtype=float)
    for state in states:
        row = state_index[state]
        for probability, next_state, immediate in transitions[state]:
            if probability <= 0:
                continue
            rewards[row] += probability * immediate
            if next_state is not None:
                system[row, state_index[next_state]] -= probability
    try:
        values = np.linalg.solve(system, rewards)
    except np.linalg.LinAlgError as error:
        raise RuntimeError("事件收益链不可吸收，固定策略期望值不存在") from error
    residual = system @ values - rewards
    absorption_rhs = np.ones(dimension, dtype=float)
    absorption = np.linalg.solve(system, absorption_rhs)
    tolerance = float(_param("VALUE_ITERATION_TOL", "VALUE_ITERATION_TOLERANCE"))
    cash_tolerance = float(_param("CASHFLOW_ABS_TOL", "CASHFLOW_ABS_ERROR", "CASHFLOW_TOL"))
    bellman_residual = float(np.max(np.abs(residual)))
    absorption_error = float(np.max(np.abs(absorption - absorption_rhs)))
    if bellman_residual > cash_tolerance + tolerance:
        raise RuntimeError(f"Bellman 残差超容差：{bellman_residual}")
    if absorption_error > cash_tolerance + tolerance:
        raise RuntimeError(f"吸收概率偏离一：{absorption_error}")
    return {
        "states": states,
        "transitions": transitions,
        "values": values,
        "value_by_state": {state: values[state_index[state]] for state in states},
        "bellman_residual": bellman_residual,
        "absorption_probability_error": absorption_error,
        "state_count": dimension,
    }


class _LocalSemiModel:
    def __init__(
        self,
        network: Network,
        semi_id: Any,
        inspect_parts: tuple[bool, ...],
        inspect_semi: bool,
        disassemble_semi: bool,
    ) -> None:
        self.network = network
        self.semi_id = semi_id
        self.part_ids = tuple(network.children[semi_id])
        self.inspect_parts = inspect_parts
        self.inspect_semi = inspect_semi
        self.disassemble_semi = disassemble_semi
        self.initial_state = (tuple(None for _ in self.part_ids), None)

    def _part_branches(self, index: int) -> list[tuple[_Item, float, np.ndarray]]:
        part_id = self.part_ids[index]
        rate = self.network.defect_rate[part_id]
        good_probability = 1.0 - rate
        if good_probability <= 0:
            raise ValueError(f"零件 {part_id} 的合格率必须为正")
        immediate = _zero_value()
        if self.inspect_parts[index]:
            factor = 1.0 / good_probability
            purchase = self.network.purchase_cost[part_id]
            inspection = self.network.inspection_cost[part_id]
            _add_to(immediate, "purchase", purchase * factor)
            _add_to(immediate, "inspection", inspection * factor)
            _add_to(immediate, "purchase_events", factor)
            _add_to(immediate, "inspection_events", factor)
            _add_to(immediate, "part_launches", factor)
            return [(_Item(part_id, True, ()), 1.0, immediate)]
        purchase = self.network.purchase_cost[part_id]
        _add_to(immediate, "purchase", purchase)
        _add_to(immediate, "purchase_events", 1.0)
        _add_to(immediate, "part_launches", 1.0)
        return [
            (_Item(part_id, True, ()), good_probability, immediate.copy()),
            (_Item(part_id, False, ()), rate, immediate.copy()),
        ]

    def _launch_outcomes(
        self,
        children: tuple[_Item, ...],
        include_inspection: bool,
    ) -> list[tuple[float, _Item, np.ndarray]]:
        immediate = _zero_value()
        assembly = self.network.assembly_cost[self.semi_id]
        _add_to(immediate, "assembly", assembly)
        _add_to(immediate, "assembly_events", 1.0)
        _add_to(immediate, "semi_launches", 1.0)
        if include_inspection:
            inspection = self.network.inspection_cost[self.semi_id]
            _add_to(immediate, "inspection", inspection)
            _add_to(immediate, "inspection_events", 1.0)
        all_good = all(child.good for child in children)
        own_rate = self.network.defect_rate[self.semi_id]
        if all_good:
            good_item = _Item(self.semi_id, True, children)
            bad_item = _Item(self.semi_id, False, children)
            return [
                (1.0 - own_rate, good_item, immediate.copy()),
                (own_rate, bad_item, immediate.copy()),
            ]
        return [(1.0, _Item(self.semi_id, False, children), immediate)]

    def fresh_outcomes(self) -> list[tuple[float, _Item, np.ndarray]]:
        partial: list[tuple[tuple[_Item, ...], float, np.ndarray]] = [((), 1.0, _zero_value())]
        for index in range(len(self.part_ids)):
            expanded: list[tuple[tuple[_Item, ...], float, np.ndarray]] = []
            branches = self._part_branches(index)
            for children, probability, value in partial:
                for item, branch_probability, branch_value in branches:
                    expanded.append(
                        (
                            children + (item,),
                            probability * branch_probability,
                            value + branch_value,
                        )
                    )
            partial = expanded
        outcomes: list[tuple[float, _Item, np.ndarray]] = []
        for children, _, value in partial:
            outcomes.extend(self._launch_outcomes(children, False))
        return outcomes

    def _after_bad_output(self, children: tuple[_Item, ...]) -> Any:
        if self.disassemble_semi:
            return (children, None)
        return (tuple(None for _ in children), None)

    def transition_builder(
        self,
        state: Any,
    ) -> list[tuple[float, Any, np.ndarray]]:
        parts, held_item = state
        if held_item is not None:
            if held_item.good:
                return []
            immediate = _zero_value()
            if self.disassemble_semi:
                fee = self.network.disassembly_cost[self.semi_id]
                _add_to(immediate, "disassembly", fee)
                _add_to(immediate, "disassembly_events", 1.0)
            return [(1.0, self._after_bad_output(held_item.children), immediate)]

        for index, item in enumerate(parts):
            if item is None:
                transitions: list[tuple[float, Any, np.ndarray]] = []
                for branch_item, probability, immediate in self._part_branches(index):
                    next_parts = parts[:index] + (branch_item,) + parts[index + 1 :]
                    transitions.append((probability, (next_parts, None), immediate))
                return transitions

        children = tuple(parts)
        transitions = []
        for probability, output_item, immediate in self._launch_outcomes(children, self.inspect_semi):
            if self.inspect_semi and output_item.good:
                next_state = None
            elif self.inspect_semi:
                next_state = self._after_bad_output(children)
            else:
                next_state = (tuple(None for _ in children), output_item)
            transitions.append((probability, next_state, immediate))
        return transitions

    def solve(self) -> dict[str, Any]:
        return event_markov_reward(self.initial_state, self.transition_builder)


@dataclass
class _PreparedUnit:
    inspect: bool
    prep_values: np.ndarray
    good_probability: float
    repair_values: np.ndarray
    q_value: float
    c_value: float
    u_value: float
    identity_error: float
    state_count: int
    bellman_residual: float
    absorption_probability_error: float


def _metric_from_values(values: np.ndarray, launch_key: str) -> dict[str, float | int]:
    total_cost = float(sum(values[COST_INDEX[key]] for key in COST_KEYS))
    launches = float(values[EVENT_INDEX[launch_key]])
    q_value = output_rate(launches)
    c_value = launch_cost_rate(total_cost, launches)
    u_value = total_cost
    return {
        "Q_v": q_value,
        "C_v": c_value,
        "U_v": u_value,
        "unit_identity_error": U_equals_C_over_Q(q_value, c_value, u_value),
        "expected_launches_to_one_good": launches,
        "expected_total_cost_to_one_good": total_cost,
    }


class _NetworkSolver:
    def __init__(self, network: Network) -> None:
        self.network = network
        self._part_cache: dict[bool, _PreparedUnit] = {}
        self._semi_cache: dict[tuple[tuple[bool, ...], bool, bool], _PreparedUnit] = {}
        self._model_cache: dict[tuple[tuple[bool, ...], bool, bool], dict[str, Any]] = {}

    def prepare_part(self, part_id: Any, inspect: bool) -> _PreparedUnit:
        cache_key = bool(inspect)
        if cache_key in self._part_cache:
            return self._part_cache[cache_key]
        rate = self.network.defect_rate[part_id]
        good_probability = 1.0 - rate
        if good_probability <= 0:
            raise ValueError(f"零件 {part_id} 的合格率必须为正")
        factor = 1.0 / good_probability
        to_good = _zero_value()
        purchase = self.network.purchase_cost[part_id]
        inspection = self.network.inspection_cost[part_id]
        _add_to(to_good, "purchase", purchase * factor)
        _add_to(to_good, "part_launches", factor)
        _add_to(to_good, "purchase_events", factor)
        if inspect:
            _add_to(to_good, "inspection", inspection * factor)
            _add_to(to_good, "inspection_events", factor)
        if inspect:
            prep = to_good.copy()
            good_probability = 1.0
            repair = _zero_value()
        else:
            prep = _zero_value()
            _add_to(prep, "purchase", purchase)
            _add_to(prep, "purchase_events", 1.0)
            _add_to(prep, "part_launches", 1.0)
            repair = to_good
        metrics = _metric_from_values(to_good, "part_launches")
        unit = _PreparedUnit(
            inspect=inspect,
            prep_values=prep,
            good_probability=good_probability,
            repair_values=repair,
            q_value=float(metrics["Q_v"]),
            c_value=float(metrics["C_v"]),
            u_value=float(metrics["U_v"]),
            identity_error=float(metrics["unit_identity_error"]),
            state_count=0,
            bellman_residual=0.0,
            absorption_probability_error=0.0,
        )
        self._part_cache[cache_key] = unit
        return unit

    def prepare_semi(
        self,
        semi_id: Any,
        inspect_parts: tuple[bool, ...],
        inspect_semi: bool,
        disassemble_semi: bool,
    ) -> _PreparedUnit:
        key = (tuple(inspect_parts), bool(inspect_semi), bool(disassemble_semi))
        if key in self._semi_cache:
            return self._semi_cache[key]
        model = _LocalSemiModel(
            self.network,
            semi_id,
            tuple(inspect_parts),
            bool(inspect_semi),
            bool(disassemble_semi),
        )
        solution = model.solve()
        empty_values = solution["value_by_state"][model.initial_state]
        metrics = _metric_from_values(empty_values, "semi_launches")
        repair = _zero_value()
        if inspect_semi:
            prep = empty_values.copy()
            good_probability = 1.0
        else:
            outcomes = model.fresh_outcomes()
            probability_sum = sum(probability for probability, _, _ in outcomes)
            if probability_sum <= 0:
                raise RuntimeError("半成品首轮事件概率之和必须为正")
            prep = _zero_value()
            for probability, item, immediate in outcomes:
                probability /= probability_sum
                prep += probability * immediate
                if item.good:
                    good_probability += 0.0
                else:
                    state = (tuple(None for _ in model.part_ids), item)
                    if state not in solution["value_by_state"]:
                        raise RuntimeError("半成品失败状态未进入可达事件链")
                    repair += probability * solution["value_by_state"][state]
        unit = _PreparedUnit(
            inspect=bool(inspect_semi),
            prep_values=prep,
            good_probability=good_probability,
            repair_values=repair,
            q_value=float(metrics["Q_v"]),
            c_value=float(metrics["C_v"]),
            u_value=float(metrics["U_v"]),
            identity_error=float(metrics["unit_identity_error"]),
            state_count=int(solution["state_count"]),
            bellman_residual=float(solution["bellman_residual"]),
            absorption_probability_error=float(solution["absorption_probability_error"]),
        )
        self._semi_cache[key] = unit
        self._model_cache[key] = solution
        return unit

    def child_unit(self, child_id: Any, inspect: bool) -> _PreparedUnit:
        if child_id in self.network.part_ids:
            return self.prepare_part(child_id, inspect)
        local_key = self._local_semi_key(child_id, inspect, bool(self.network.disassembly_cost[child_id] >= 0))
        del local_key
        raise RuntimeError("内部错误：半成品策略未完整传入")

    def _local_semi_key(
        self,
        semi_id: Any,
        inspect_semi: bool,
        disassemble_semi: bool,
    ) -> tuple[tuple[bool, ...], bool, bool]:
        part_decisions = tuple(
            self.network.graph.nodes[node].get("inspect", False)
            for node in self.network.children[semi_id]
        )
        return part_decisions, inspect_semi, disassemble_semi

    def prepared_child_from_policy(self, child_id: Any, policy: Policy) -> _PreparedUnit:
        if child_id in self.network.part_ids:
            part_index = self.network.part_ids.index(child_id)
            return self.prepare_part(child_id, policy.inspect_parts[part_index])
        semi_index = self.network.semi_ids.index(child_id)
        part_decisions = tuple(
            policy.inspect_parts[self.network.part_ids.index(part_id)]
            for part_id in self.network.children[child_id]
        )
        return self.prepare_semi(
            child_id,
            part_decisions,
            policy.inspect_semis[semi_index],
            policy.disassemble_semis[semi_index],
        )

    def evaluate(self, policy: Policy) -> dict[str, Any]:
        child_units = [
            self.prepared_child_from_policy(child_id, policy)
            for child_id in self.network.parents[self.network.root_id]
        ]
        prep_values = _zero_value()
        for child in child_units:
            prep_values += child.prep_values
        initial_good_probability = math.prod(child.good_probability for child in child_units)
        root_good_probability = 1.0 - self.network.defect_rate[self.network.root_id]
        if root_good_probability <= 0:
            raise ValueError("成品一次投产合格率必须为正")
        success_probability = initial_good_probability * root_good_probability
        if success_probability <= 0:
            raise ValueError("策略在有限时间内生产合格成品的概率必须为正")
        initial_repair_values = _zero_value()
        for child in child_units:
            initial_repair_values += child.repair_values
        assembly = self.network.assembly_cost[self.network.root_id]
        inspection = self.network.inspection_cost[self.network.root_id]
        disassembly = self.network.disassembly_cost[self.network.root_id]
        price = self.network.market_price
        exchange_loss = self.network.exchange_loss
        values = _zero_value()

        if not policy.disassemble_root:
            values += prep_values / success_probability
            _add_to(values, "assembly", assembly / success_probability)
            _add_to(values, "assembly_events", 1.0 / success_probability)
            _add_to(values, "root_launches", 1.0 / success_probability)
            if policy.inspect_root:
                _add_to(values, "inspection", inspection / success_probability)
                _add_to(values, "inspection_events", 1.0 / success_probability)
                _add_to(values, "market_revenue", price)
                _add_to(values, "market_events", 1.0)
            else:
                _add_to(values, "market_revenue", price / success_probability)
                _add_to(values, "market_events", 1.0 / success_probability)
                _add_to(values, "exchange_loss", exchange_loss * (1.0 - success_probability) / success_probability)
                _add_to(values, "exchange_events", (1.0 - success_probability) / success_probability)
        else:
            values += prep_values
            values += initial_repair_values * (1.0 - success_probability)
            _add_to(values, "assembly", assembly)
            _add_to(values, "assembly_events", 1.0)
            _add_to(values, "root_launches", 1.0)
            if policy.inspect_root:
                _add_to(values, "inspection", inspection)
                _add_to(values, "inspection_events", 1.0)
                _add_to(values, "market_revenue", price * success_probability)
                _add_to(values, "market_events", success_probability)
            else:
                _add_to(values, "market_revenue", price)
                _add_to(values, "market_events", 1.0)
                _add_to(values, "exchange_loss", exchange_loss * (1.0 - success_probability))
                _add_to(values, "exchange_events", 1.0 - success_probability)
            _add_to(values, "disassembly", disassembly * (1.0 - success_probability))
            _add_to(values, "disassembly_events", 1.0 - success_probability)
            retry_probability = 1.0 / root_good_probability
            _add_to(values, "assembly", assembly * retry_probability)
            _add_to(values, "assembly_events", retry_probability)
            _add_to(values, "root_launches", retry_probability)
            if policy.inspect_root:
                _add_to(values, "inspection", inspection * retry_probability)
                _add_to(values, "inspection_events", retry_probability)
                _add_to(values, "market_revenue", price)
                _add_to(values, "market_events", 1.0)
            else:
                _add_to(values, "market_revenue", price * retry_probability)
                _add_to(values, "market_events", retry_probability)
                expected_retry_failures = (
                    (1.0 - success_probability)
                    * self.network.defect_rate[self.network.root_id]
                    * retry_probability
                )
                _add_to(values, "exchange_loss", exchange_loss * expected_retry_failures)
                _add_to(values, "exchange_events", expected_retry_failures)
            expected_retry_disassembly = (
                (1.0 - success_probability)
                * self.network.defect_rate[self.network.root_id]
                * retry_probability
            )
            _add_to(values, "disassembly", disassembly * expected_retry_disassembly)
            _add_to(values, "disassembly_events", expected_retry_disassembly)

        total_cost = float(sum(values[COST_INDEX[key]] for key in COST_KEYS))
        revenue = float(values[COST_INDEX["market_revenue"]])
        profit = revenue - total_cost
        root_launches = float(values[EVENT_INDEX["root_launches"]])
        root_q = output_rate(root_launches)
        root_c = launch_cost_rate(total_cost, root_launches)
        root_u = total_cost
        node_metrics: dict[str, Any] = {}
        identity_errors: list[float] = []
        state_counts: list[int] = []
        residuals: list[float] = []
        absorption_errors: list[float] = []
        for child_id, child in zip(self.network.parents[self.network.root_id], child_units):
            node_metrics[str(child_id)] = {
                "kind": "part" if child_id in self.network.part_ids else "semi",
                "Q_v": child.q_value,
                "C_v": child.c_value,
                "U_v": child.u_value,
                "unit_identity_error": child.identity_error,
                "expected_launches_to_one_good": (
                    child.u_value / child.c_value if child.c_value else math.inf
                ),
                "event_state_count": child.state_count,
                "bellman_max_residual": child.bellman_residual,
                "absorption_probability_error": child.absorption_probability_error,
            }
            identity_errors.append(child.identity_error)
            state_counts.append(child.state_count)
            residuals.append(child.bellman_residual)
            absorption_errors.append(child.absorption_probability_error)
        node_metrics[str(self.network.root_id)] = {
            "kind": "product",
            "Q_v": root_q,
            "C_v": root_c,
            "U_v": root_u,
            "unit_identity_error": U_equals_C_over_Q(root_q, root_c, root_u),
            "expected_launches_to_one_good": root_launches,
            "event_state_count": 0,
            "bellman_max_residual": 0.0,
            "absorption_probability_error": 0.0,
        }
        identity_errors.append(U_equals_C_over_Q(root_q, root_c, root_u))
        return {
            "policy": policy.to_mapping(self.network),
            "policy_vector": [int(value) for value in policy.to_vector(self.network)],
            "profit_per_good_delivery": profit,
            "expected_total_cost_per_good_delivery": total_cost,
            "expected_market_revenue_per_good_delivery": revenue,
            "cost_components": {key: float(values[COST_INDEX[key]]) for key in COST_KEYS},
            "event_counts": {key: float(values[EVENT_INDEX[key]]) for key in EVENT_KEYS},
            "node_rates_costs_and_U": node_metrics,
            "state_count": int(sum(state_counts)),
            "bellman_max_residual": max(residuals, default=0.0),
            "absorption_probability_error": max(absorption_errors, default=0.0),
            "unit_identity_max_error": max(identity_errors, default=0.0),
            "absorbing": True,
        }

    def evaluate_vector(self, vector: Sequence[bool]) -> dict[str, Any]:
        return self.evaluate(Policy.from_vector(self.network, vector))


def solve_network(
    network: Network,
    include_strategy_table: bool = True,
) -> dict[str, Any]:
    solver = _NetworkSolver(network)
    bit_order = network.decision_bit_order()
    bits_list: list[tuple[bool, ...]] = list(itertools.product((False, True), repeat=len(bit_order)))
    if len(bits_list) != network.expected_policy_size():
        raise RuntimeError("策略枚举规模与维度不一致")
    evaluated = [solver.evaluate_vector(vector) for vector in bits_list]
    profits = np.asarray([result["profit_per_good_delivery"] for result in evaluated], dtype=float)
    costs = np.asarray([result["expected_total_cost_per_good_delivery"] for result in evaluated], dtype=float)
    best_index = int(np.argmax(profits))
    best = evaluated[best_index]
    policy_ties = np.flatnonzero(np.isclose(profits, profits[best_index], rtol=0.0, atol=float(_param("CASHFLOW_ABS_TOL"))))
    result = {
        "topology": network.to_dict(),
        "policy_bit_order": list(bit_order),
        "policy_space_size": len(bits_list),
        "tie_break": "lexicographic_false_before_true",
        "best_policy": best["policy"],
        "best_policy_vector": best["policy_vector"],
        "best_profit_per_good_delivery": best["profit_per_good_delivery"],
        "best_evaluation": best,
        "strategy_tie_count": int(len(policy_ties)),
        "state_count_best_policy": best["state_count"],
        "bellman_max_residual": best["bellman_max_residual"],
        "absorption_probability_error": best["absorption_probability_error"],
        "unit_identity_max_error": best["unit_identity_max_error"],
        "validation_passed": bool(
            best["absorbing"]
            and best["bellman_max_residual"]
            <= float(_param("CASHFLOW_ABS_TOL")) + float(_param("VALUE_ITERATION_TOL"))
            and best["unit_identity_max_error"]
            <= float(_param("CASHFLOW_ABS_TOL")) + float(_param("VALUE_ITERATION_TOL"))
        ),
    }
    if include_strategy_table:
        result["all_strategy_table"] = {
            "bit_order": list(bit_order),
            "bits": ["".join("1" if value else "0" for value in vector) for vector in bits_list],
            "profit_per_good_delivery": [float(value) for value in profits],
            "expected_total_cost_per_good_delivery": [float(value) for value in costs],
        }
    return result


def evaluate_policy(
    network: Network,
    policy: Policy | Sequence[bool] | Mapping[str, Any],
) -> dict[str, Any]:
    solver = _NetworkSolver(network)
    if isinstance(policy, Policy):
        selected = policy
    elif isinstance(policy, Mapping):
        selected = Policy.from_mapping(network, policy)
    else:
        selected = Policy.from_vector(network, policy)
    return solver.evaluate(selected)


def optimize_network(
    network: Network,
    defect_rates: Mapping[Any, float] | Sequence[float] | None = None,
) -> dict[str, Any]:
    target = network_with_rates(network, defect_rates) if defect_rates is not None else network
    solution = solve_network(target, include_strategy_table=False)
    return {
        "best_policy": solution["best_policy"],
        "best_policy_vector": solution["best_policy_vector"],
        "best_profit_per_good_delivery": solution["best_profit_per_good_delivery"],
        "node_rates_costs_and_U": solution["best_evaluation"]["node_rates_costs_and_U"],
        "validation_passed": solution["validation_passed"],
    }


def solve_best_for_rates(
    topology: str = "conditional_primary",
    defect_rates: Mapping[Any, float] | Sequence[float] | None = None,
) -> dict[str, Any]:
    return optimize_network(build_network(topology), defect_rates)


def _case_record(case: Any, *names: str) -> Any:
    if not isinstance(case, Mapping):
        raise TypeError("问题二情形必须是映射")
    for name in names:
        if name in case:
            return case[name]
    raise KeyError(f"问题二情形缺少字段 {names}")


def _two_part_case() -> tuple[Any, str]:
    cases = _param("Q2_CASES", "CASES_Q2", "TABLE1_CASES")
    if isinstance(cases, Mapping):
        first_key = next(iter(cases))
        return cases[first_key], str(first_key)
    if not cases:
        raise ValueError("问题二情形表为空")
    return cases[0], "registered_case"


def _build_two_part_network(case: Any, name: str) -> Network:
    part1 = _case_record(case, "零配件1", "part1", "part_1")
    part2 = _case_record(case, "零配件2", "part2", "part_2")
    product = _case_record(case, "成品", "product", "final")
    p1 = _as_rate(_record_value(part1, ("defect_rate", "defect", "p", "次品率"), 0))
    p2 = _as_rate(_record_value(part2, ("defect_rate", "defect", "p", "次品率"), 0))
    pf = _as_rate(_record_value(product, ("defect_rate", "defect", "p", "次品率"), 0))
    part_ids = (1, 2)
    root_id = "product"
    nodes = (*part_ids, root_id)
    parents = {1: (), 2: (), root_id: part_ids}
    children = {1: (root_id,), 2: (root_id,), root_id: ()}
    graph = nx.DiGraph()
    graph.add_nodes_from(nodes)
    graph.add_edges_from(((1, root_id), (2, root_id)))
    return Network(
        name=name,
        nodes=nodes,
        part_ids=part_ids,
        semi_ids=(),
        root_id=root_id,
        parents=parents,
        children=children,
        defect_rate={1: p1, 2: p2, root_id: pf},
        purchase_cost={
            1: float(_record_value(part1, ("purchase_cost", "price", "购买单价"), 1)),
            2: float(_record_value(part2, ("purchase_cost", "price", "购买单价"), 1)),
            root_id: 0.0,
        },
        assembly_cost={
            1: 0.0,
            2: 0.0,
            root_id: float(_record_value(product, ("assembly_cost", "装配成本"), 1)),
        },
        inspection_cost={
            1: float(_record_value(part1, ("inspection_cost", "检测成本"), 2)),
            2: float(_record_value(part2, ("inspection_cost", "检测成本"), 2)),
            root_id: float(_record_value(product, ("inspection_cost", "检测成本"), 2)),
        },
        disassembly_cost={
            1: 0.0,
            2: 0.0,
            root_id: float(_record_value(product, ("disassembly_cost", "拆解费用"), 2 + 2)),
        },
        market_price=float(_record_value(case, ("市场售价", "market_price", "sale_price", "price"))),
        exchange_loss=float(_record_value(case, ("调换损失", "exchange_loss", "replacement_loss"))),
        is_official_instance=False,
        graph=graph,
    )


def _independent_two_part_profit(network: Network, policy: Policy) -> float:
    inspect1, inspect2, inspect_root, disassemble_root = policy.to_legacy_tuple()
    child_good: list[float] = []
    prep_cost = 0.0
    repair_cost = 0.0
    for part_id, inspect in zip(network.part_ids, (inspect1, inspect2)):
        rate = network.defect_rate[part_id]
        good = 1.0 - rate
        if good <= 0:
            raise ValueError("退化参考解要求零件次品率小于一")
        purchase = network.purchase_cost[part_id]
        inspection_cost = network.inspection_cost[part_id]
        if inspect:
            child_good.append(1.0)
            prep_cost += (purchase + inspection_cost) / good
        else:
            child_good.append(good)
            prep_cost += purchase
            repair_cost += purchase / good
    root_good = 1.0 - network.defect_rate[network.root_id]
    success = child_good[0] * child_good[1] * root_good
    root_assembly = network.assembly_cost[network.root_id]
    root_inspection = network.inspection_cost[network.root_id]
    root_disassembly = network.disassembly_cost[network.root_id]
    if not disassemble_root:
        total_cost = (prep_cost + root_assembly + (root_inspection if inspect_root else 0.0)) / success
        market_revenue = network.market_price if inspect_root else network.market_price / success
        exchange = 0.0 if inspect_root else network.exchange_loss * (1.0 - success) / success
    else:
        first_round_cost = prep_cost + root_assembly + (root_inspection if inspect_root else 0.0)
        retry_count = (1.0 - success) / root_good
        retry_cost = retry_count * (
            root_assembly
            + (root_inspection if inspect_root else 0.0)
            + root_disassembly * network.defect_rate[network.root_id]
        )
        total_cost = first_round_cost + (1.0 - success) * repair_cost + retry_cost
        if inspect_root:
            market_revenue = network.market_price
        else:
            market_revenue = network.market_price * (1.0 + retry_count)
        exchange = 0.0 if inspect_root else network.exchange_loss * (1.0 - success) / root_good
    return market_revenue - total_cost - exchange


def _extract_reference_profit(value: Any) -> float:
    if isinstance(value, Mapping):
        for key in (
            "profit_per_good_delivery",
            "expected_profit",
            "unit_profit",
            "profit",
            "value",
        ):
            if key in value:
                return float(value[key])
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes)) and value:
        return float(value[0])
    return float(value)


def _load_q2_reference() -> tuple[Callable[..., Any] | None, str]:
    try:
        import problem2
    except ImportError:
        return None, "independent_closed_form_reference"
    for name in (
        "evaluate_policy",
        "evaluate_strategy",
        "profit_for_policy",
        "solve_policy",
        "policy_value",
    ):
        candidate = getattr(problem2, name, None)
        if callable(candidate):
            return candidate, f"problem2.{name}"
    return None, "independent_closed_form_reference"


def _call_external_reference(
    evaluator: Callable[..., Any],
    case: Any,
    policy: Policy,
) -> float:
    legacy = policy.to_legacy_tuple()
    attempts = (
        lambda: evaluator(case, legacy),
        lambda: evaluator(case, {"Z1": legacy[0], "Z2": legacy[1], "C": legacy[2], "D": legacy[3]}),
        lambda: evaluator(legacy, case),
    )
    last_error: Exception | None = None
    for attempt in attempts:
        try:
            return _extract_reference_profit(attempt())
        except Exception as error:
            last_error = error
    if last_error is not None:
        raise last_error
    raise RuntimeError("外部问题二参考评价器没有返回结果")


def q2_degenerate_16_policy_equivalence(
    reference_evaluator: Callable[..., Any] | None = None,
    case: Any | None = None,
) -> dict[str, Any]:
    source_name = "caller_supplied_reference"
    if case is None:
        case, case_name = _two_part_case()
    else:
        case_name = "caller_supplied_case"
    network = _build_two_part_network(case, f"q2_degenerate_{case_name}")
    if reference_evaluator is None:
        reference_evaluator, source_name = _load_q2_reference()
    solver = _NetworkSolver(network)
    rows: list[dict[str, Any]] = []
    errors: list[float] = []
    dimension = len(network.decision_bit_order())
    for vector in itertools.product((False, True), repeat=dimension):
        policy = Policy.from_vector(network, vector)
        q3_value = float(solver.evaluate(policy)["profit_per_good_delivery"])
        if reference_evaluator is None:
            reference_value = _independent_two_part_profit(network, policy)
        else:
            reference_value = _call_external_reference(reference_evaluator, case, policy)
        error = abs(q3_value - reference_value)
        errors.append(error)
        rows.append(
            {
                "bits": [int(value) for value in vector],
                "legacy_policy": {
                    "Z1": bool(vector[0]),
                    "Z2": bool(vector[1]),
                    "C": bool(vector[dimension - 1 - 1]),
                    "D": bool(vector[dimension - 1]),
                },
                "q3_event_profit": q3_value,
                "reference_profit": reference_value,
                "absolute_error": error,
            }
        )
    tolerance = float(_param("CASHFLOW_ABS_TOL"))
    maximum = max(errors, default=0.0)
    return {
        "network": network.to_dict(),
        "policy_count": len(rows),
        "reference_source": source_name,
        "maximum_absolute_error": maximum,
        "cashflow_abs_tol": tolerance,
        "all_policies_within_tolerance": bool(maximum <= tolerance),
        "rows": rows,
    }


def topology_perturbation(
    rates: Mapping[Any, float] | Sequence[float] | None = None,
    include_strategy_table: bool = True,
) -> dict[str, Any]:
    primary = solve_network(build_network("conditional_primary", rates), include_strategy_table)
    alternative = solve_network(build_network("conditional_alternative", rates), include_strategy_table)
    gap = abs(
        float(primary["best_profit_per_good_delivery"])
        - float(alternative["best_profit_per_good_delivery"])
    )
    return {
        "registered_scenario_a": primary,
        "registered_scenario_b": alternative,
        "topology_profit_gap": gap,
        "policy_changed": primary["best_policy_vector"] != alternative["best_policy_vector"],
    }


def _jsonable(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    if isinstance(value, np.ndarray):
        return [_jsonable(item) for item in value.tolist()]
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        value = float(value)
    if isinstance(value, float) and math.isinf(value):
        return "Infinity" if value > 0 else "-Infinity"
    return value


def run(output_dir: str | Path | None = None) -> dict[str, Any]:
    primary_network = build_network("conditional_primary")
    alternative_network = build_network("conditional_alternative")
    primary = solve_network(primary_network, include_strategy_table=True)
    alternative = solve_network(alternative_network, include_strategy_table=True)
    topology_gap = abs(
        float(primary["best_profit_per_good_delivery"])
        - float(alternative["best_profit_per_good_delivery"])
    )
    degenerate = q2_degenerate_16_policy_equivalence()
    maximum_error = float(degenerate["maximum_absolute_error"])
    tolerance = float(_param("CASHFLOW_ABS_TOL"))
    result = {
        "stage": "03-code",
        "problem": "Q3",
        "method": "networkx.DiGraph + reachable_state_enumeration + event_markov_reward",
        "official_instance_status": "BLOCKED_MISSING_FIG1_EDGE_LIST",
        "official_instance_policy": None,
        "official_instance_profit": None,
        "official_instance_note": "图1原件及可校验边表未提供，以下结果仅为登记的条件拓扑情景，不得称为题图唯一答案。",
        "conditional_scenarios": {
            "registered_primary_scenario": primary,
            "registered_alternative_scenario": alternative,
        },
        "topology_perturbation": {
            "profit_gap": topology_gap,
            "policy_changed": primary["best_policy_vector"] != alternative["best_policy_vector"],
        },
        "q2_degenerate_16_policy_equivalence": degenerate,
        "validation": {
            "conditional_primary_passed": primary["validation_passed"],
            "conditional_alternative_passed": alternative["validation_passed"],
            "degeneration_max_error": maximum_error,
            "degeneration_tolerance": tolerance,
            "degeneration_passed": maximum_error <= tolerance,
            "all_executable_checks_passed": bool(
                primary["validation_passed"]
                and alternative["validation_passed"]
                and maximum_error <= tolerance
            ),
        },
    }
    serialisable = _jsonable(result)
    if output_dir is not None:
        directory = Path(output_dir)
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "problem3_outputs.json").write_text(
            json.dumps(serialisable, ensure_ascii=False, indent=2, allow_nan=False),
            encoding="utf-8",
        )
    return serialisable


def solve() -> dict[str, Any]:
    return run()


def main() -> None:
    run(Path.cwd())


if __name__ == "__main__":
    main()