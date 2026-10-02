"""阶段 3 编程实现的统一参数表。

数值仅来自题面事实表与阶段 2 登记的模型常数。所有金额均为元/件，
概率均为无量纲比率。问题一备择幅度、问题三推断拓扑和问题四情景样本
均保留其建模边界，不得在下游脚本中改写为题面事实。
"""

from __future__ import annotations

import itertools as _itertools
from typing import Any as _Any


class _AliasMapping(dict):
    """A JSON-serializable mapping with read/write aliases for stable APIs."""

    def __init__(
        self,
        values: _Any = None,
        aliases: _Any = None,
    ) -> None:
        super().__init__()
        object.__setattr__(self, "_aliases", dict(aliases or {}))
        if values:
            for key, value in dict(values).items():
                dict.__setitem__(self, key, value)

    def _path(self, key: _Any) -> tuple[_Any, ...]:
        if dict.__contains__(self, key):
            return (key,)
        target = self.__dict__.get("_aliases", {}).get(key)
        if target is None:
            return (key,)
        if isinstance(target, str):
            return (target,)
        return tuple(target)

    def __getitem__(self, key: _Any) -> _Any:
        value = self
        for part in self._path(key):
            if isinstance(value, dict):
                value = dict.__getitem__(value, part)
            else:
                value = value[part]
        return value

    def __setitem__(self, key: _Any, value: _Any) -> None:
        path = self._path(key)
        if len(path) == 1:
            dict.__setitem__(self, path[0], value)
            return
        target = self
        for part in path[:-1]:
            target = dict.__getitem__(target, part) if isinstance(target, dict) else target[part]
        if isinstance(target, dict):
            dict.__setitem__(target, path[-1], value)
        else:
            target[path[-1]] = value

    def __contains__(self, key: _Any) -> bool:
        try:
            self[key]
        except (KeyError, IndexError, TypeError):
            return False
        return True

    def get(self, key: _Any, default: _Any = None) -> _Any:
        try:
            return self[key]
        except (KeyError, IndexError, TypeError):
            return default

    def __getattr__(self, key: str) -> _Any:
        try:
            return self[key]
        except (KeyError, IndexError, TypeError) as error:
            raise AttributeError(key) from error

    def copy(self) -> _AliasMapping:
        return _AliasMapping(dict(self), self.__dict__.get("_aliases", {}))


class _CaseCollection(list):
    """List of Q2 cases that also supports case-id and ``items()`` access."""

    def __init__(self, cases: _Any) -> None:
        super().__init__(cases)

    def _position(self, key: _Any) -> _Any:
        if isinstance(key, str):
            normalized = key.strip().lower().replace(" ", "")
            for position, case in enumerate(self):
                case_id = str(case["case_id"]).lower()
                if normalized in {
                    case_id,
                    f"case{case_id[-1]}",
                    f"情况{case_id[-1]}",
                    f"table1case{case_id[-1]}",
                }:
                    return position
        return key

    def __getitem__(self, key: _Any) -> _Any:
        return list.__getitem__(self, self._position(key))

    def get(self, key: _Any, default: _Any = None) -> _Any:
        try:
            return self[key]
        except (KeyError, IndexError, TypeError):
            return default

    def items(self) -> list[tuple[str, _Any]]:
        return [(str(case["case_id"]), case) for case in self]

    def keys(self) -> list[str]:
        return [str(case["case_id"]) for case in self]

    def values(self) -> list[_Any]:
        return list(self)


# ---------------------------------------------------------------------------
# Problem 1: exact binomial inspection and finite SPRT comparison
# ---------------------------------------------------------------------------

Q1_NOMINAL_DEFECT_RATE = 0.10
Q1_REJECT_CONFIDENCE_LEVEL = 0.95
Q1_ACCEPT_CONFIDENCE_LEVEL = 0.90
Q1_REJECT_FIRST_TYPE_ERROR_LIMIT = 0.05
Q1_ACCEPT_TYPE_II_ERROR_LIMIT = 0.10
Q1_ALTERNATIVE_DELTA = 0.05
Q1_TYPE_II_ERROR = 0.10
Q1_DELTA_GRID = (0.02, 0.05, 0.10)
Q1_TYPE_II_ERROR_GRID = (0.05, 0.10, 0.20)
Q1_EXACT_ENUMERATION_TOL = 1e-12
Q1_ALTERNATIVE_DELTA_IS_DESIGN_CONSTANT = True
Q1_ALTERNATIVE_RATE_BASIS = "p0 + Q1_ALTERNATIVE_DELTA"

Q1_BASE_ALTERNATIVE_DEFECT_RATE = (
    Q1_NOMINAL_DEFECT_RATE + Q1_ALTERNATIVE_DELTA
)

Q1_P0 = Q1_NOMINAL_DEFECT_RATE
Q1_NOMINAL_RATE = Q1_NOMINAL_DEFECT_RATE
Q1_NOMINAL_DEFECT_RATE = Q1_NOMINAL_DEFECT_RATE
NOMINAL_DEFECT_RATE = Q1_NOMINAL_DEFECT_RATE
NOMINAL_RATE = Q1_NOMINAL_DEFECT_RATE
P0 = Q1_NOMINAL_DEFECT_RATE
F_NOMINAL = Q1_NOMINAL_DEFECT_RATE

Q1_REJECT_CONFIDENCE = Q1_REJECT_CONFIDENCE_LEVEL
Q1_CONFIDENCE_REJECT = Q1_REJECT_CONFIDENCE_LEVEL
Q1_REJECT_ALPHA = Q1_REJECT_FIRST_TYPE_ERROR_LIMIT
Q1_ALPHA_REJECT = Q1_REJECT_FIRST_TYPE_ERROR_LIMIT
Q1_ALPHA = Q1_REJECT_FIRST_TYPE_ERROR_LIMIT
REJECT_CONFIDENCE = Q1_REJECT_CONFIDENCE_LEVEL
REJECT_ALPHA = Q1_REJECT_FIRST_TYPE_ERROR_LIMIT
ALPHA_REJECT = Q1_REJECT_FIRST_TYPE_ERROR_LIMIT
F_CONF_REJECT = Q1_REJECT_CONFIDENCE_LEVEL

Q1_ACCEPT_CONFIDENCE = Q1_ACCEPT_CONFIDENCE_LEVEL
Q1_CONFIDENCE_ACCEPT = Q1_ACCEPT_CONFIDENCE_LEVEL
Q1_ACCEPT_ALPHA = Q1_ACCEPT_TYPE_II_ERROR_LIMIT
Q1_ALPHA_ACCEPT = Q1_ACCEPT_TYPE_II_ERROR_LIMIT
ACCEPT_CONFIDENCE = Q1_ACCEPT_CONFIDENCE_LEVEL
ACCEPT_ALPHA = Q1_ACCEPT_TYPE_II_ERROR_LIMIT
ALPHA_ACCEPT = Q1_ACCEPT_TYPE_II_ERROR_LIMIT
F_CONF_ACCEPT = Q1_ACCEPT_CONFIDENCE_LEVEL

Q1_DELTA = Q1_ALTERNATIVE_DELTA
Q1_ALT_DELTA = Q1_ALTERNATIVE_DELTA
Q1_ALTERNATIVE_RATE_DELTA = Q1_ALTERNATIVE_DELTA
ALTERNATIVE_DELTA = Q1_ALTERNATIVE_DELTA
Q1_BETA = Q1_TYPE_II_ERROR
Q1_TYPE_II_ERROR_LIMIT = Q1_TYPE_II_ERROR
TYPE_II_ERROR = Q1_TYPE_II_ERROR
BETA = Q1_TYPE_II_ERROR
P_ALT_BASE = Q1_BASE_ALTERNATIVE_DEFECT_RATE
Q1_ALTERNATIVE_DEFECT_RATE_BASE = Q1_BASE_ALTERNATIVE_DEFECT_RATE

Q1_ALTERNATIVE_DELTA_GRID = Q1_DELTA_GRID
Q1_SENSITIVITY_DELTAS = Q1_DELTA_GRID
Q1_SENSITIVITY_BETAS = Q1_TYPE_II_ERROR_GRID
Q1_BETA_GRID = Q1_TYPE_II_ERROR_GRID
DELTA_GRID = Q1_DELTA_GRID
BETA_GRID = Q1_TYPE_II_ERROR_GRID
Q1_NUMERIC_TOL = Q1_EXACT_ENUMERATION_TOL
Q1_EXACT_TOL = Q1_EXACT_ENUMERATION_TOL

F_NOMINAL_TEXT = "10%"
F_CONF_REJECT_TEXT = "95%"
F_CONF_ACCEPT_TEXT = "90%"


# ---------------------------------------------------------------------------
# Shared tolerances, Q2 policy space, and state labels
# ---------------------------------------------------------------------------

CASHFLOW_ABS_TOL = 1e-6
VALUE_ITERATION_TOL = 1e-10
VALUE_ITERATION_MAX_ITERATIONS = 100000
SCRAP_SALVAGE_VALUE = 0

Q2_POLICY_SPACE_COUNT = 16
Q2_DECISION_VARIABLE_COUNT = Q2_POLICY_SPACE_COUNT.bit_length() - 1
Q2_INSPECTION_DECISION_COUNT = Q2_DECISION_VARIABLE_COUNT
Q2_PARAMETER_NODE_COUNT = 3
Q2_INVENTORY_STATE_COUNT = 9

Q2_CASHFLOW_ABS_TOL = CASHFLOW_ABS_TOL
EVENT_CASHFLOW_ABS_TOL = CASHFLOW_ABS_TOL
Q2_VALUE_ITERATION_TOL = VALUE_ITERATION_TOL
Q2_VALUE_ITERATION_MAX_ITERATIONS = VALUE_ITERATION_MAX_ITERATIONS
VALUE_ITERATION_MAX_STEPS = VALUE_ITERATION_MAX_ITERATIONS
SCRAP_RECOVERY_VALUE = SCRAP_SALVAGE_VALUE

EMPTY = "empty"
GOOD = "good"
BAD = "bad"
Q2_EMPTY = EMPTY
Q2_GOOD = GOOD
Q2_BAD = BAD
Q2_STATES = (EMPTY, GOOD, BAD)
Q2_COMPONENT_STATES = (EMPTY, GOOD, BAD)

Q2_POLICY_SPACE = tuple(
    (z1, z2, finished_goods_test, disassemble)
    for z1 in (0, 1)
    for z2 in (0, 1)
    for finished_goods_test in (0, 1)
    for disassemble in (0, 1)
)
Q2_POLICIES = Q2_POLICY_SPACE


# ---------------------------------------------------------------------------
# Problem 2: the six factual Table 1 cases
# ---------------------------------------------------------------------------

_NODE_ALIASES = {
    "id": ("node_id",),
    "number": ("node_id",),
    "编号": ("node_id",),
    "p": ("defect_rate",),
    "defect_probability": ("defect_rate",),
    "次品率": ("defect_rate",),
    "a": ("purchase_price",),
    "price": ("purchase_price",),
    "unit_price": ("purchase_price",),
    "购买单价": ("purchase_price",),
    "t": ("inspection_cost",),
    "test_cost": ("inspection_cost",),
    "检测成本": ("inspection_cost",),
    "k": ("assembly_cost",),
    "装配成本": ("assembly_cost",),
    "g": ("disassembly_cost",),
    "拆解费用": ("disassembly_cost",),
}

_CASE_ALIASES = {
    "component1": ("part1",),
    "component_1": ("part1",),
    "part_1": ("part1",),
    "零配件1": ("part1",),
    "component2": ("part2",),
    "component_2": ("part2",),
    "part_2": ("part2",),
    "零配件2": ("part2",),
    "final_product": ("product",),
    "finished_product": ("product",),
    "成品": ("product",),
    "p1": ("part1", "defect_rate"),
    "a1": ("part1", "purchase_price"),
    "t1": ("part1", "inspection_cost"),
    "p2": ("part2", "defect_rate"),
    "a2": ("part2", "purchase_price"),
    "t2": ("part2", "inspection_cost"),
    "pf": ("product", "defect_rate"),
    "p_f": ("product", "defect_rate"),
    "product_defect_rate": ("product", "defect_rate"),
    "kf": ("product", "assembly_cost"),
    "k_f": ("product", "assembly_cost"),
    "tf": ("product", "inspection_cost"),
    "t_f": ("product", "inspection_cost"),
    "r_market": ("sale_price",),
    "market_price": ("sale_price",),
    "selling_price": ("sale_price",),
    "revenue": ("sale_price",),
    "市场售价": ("sale_price",),
    "L_exchange": ("exchange_loss",),
    "exchange_loss_cost": ("exchange_loss",),
    "调换损失": ("exchange_loss",),
    "g_dis": ("disassembly_cost",),
    "disassembly_fee": ("disassembly_cost",),
    "拆解费用": ("disassembly_cost",),
}


def _q2_part(
    node_id: int,
    defect_rate: float,
    purchase_price: float,
    inspection_cost: float,
) -> _AliasMapping:
    return _AliasMapping(
        {
            "node_id": node_id,
            "kind": "part",
            "defect_rate": defect_rate,
            "purchase_price": purchase_price,
            "inspection_cost": inspection_cost,
        },
        aliases=_NODE_ALIASES,
    )


def _q2_product(
    defect_rate: float,
    assembly_cost: float,
    inspection_cost: float,
) -> _AliasMapping:
    return _AliasMapping(
        {
            "kind": "product",
            "defect_rate": defect_rate,
            "assembly_cost": assembly_cost,
            "inspection_cost": inspection_cost,
        },
        aliases=_NODE_ALIASES,
    )


Q2_CASE1 = _AliasMapping(
    {
        "case_id": "case1",
        "part1": _q2_part(1, 0.10, 4, 2),
        "part2": _q2_part(2, 0.10, 18, 3),
        "product": _q2_product(0.10, 6, 3),
        "sale_price": 56,
        "exchange_loss": 6,
        "disassembly_cost": 5,
    },
    aliases=_CASE_ALIASES,
)

Q2_CASE2 = _AliasMapping(
    {
        "case_id": "case2",
        "part1": _q2_part(1, 0.20, 4, 2),
        "part2": _q2_part(2, 0.20, 18, 3),
        "product": _q2_product(0.20, 6, 3),
        "sale_price": 56,
        "exchange_loss": 6,
        "disassembly_cost": 5,
    },
    aliases=_CASE_ALIASES,
)

Q2_CASE3 = _AliasMapping(
    {
        "case_id": "case3",
        "part1": _q2_part(1, 0.10, 4, 2),
        "part2": _q2_part(2, 0.10, 18, 3),
        "product": _q2_product(0.10, 6, 3),
        "sale_price": 56,
        "exchange_loss": 30,
        "disassembly_cost": 5,
    },
    aliases=_CASE_ALIASES,
)

Q2_CASE4 = _AliasMapping(
    {
        "case_id": "case4",
        "part1": _q2_part(1, 0.20, 4, 1),
        "part2": _q2_part(2, 0.20, 18, 1),
        "product": _q2_product(0.20, 6, 2),
        "sale_price": 56,
        "exchange_loss": 30,
        "disassembly_cost": 5,
    },
    aliases=_CASE_ALIASES,
)

Q2_CASE5 = _AliasMapping(
    {
        "case_id": "case5",
        "part1": _q2_part(1, 0.10, 4, 8),
        "part2": _q2_part(2, 0.20, 18, 1),
        "product": _q2_product(0.10, 6, 2),
        "sale_price": 56,
        "exchange_loss": 10,
        "disassembly_cost": 5,
    },
    aliases=_CASE_ALIASES,
)

Q2_CASE6 = _AliasMapping(
    {
        "case_id": "case6",
        "part1": _q2_part(1, 0.05, 4, 2),
        "part2": _q2_part(2, 0.05, 18, 3),
        "product": _q2_product(0.05, 6, 3),
        "sale_price": 56,
        "exchange_loss": 10,
        "disassembly_cost": 40,
    },
    aliases=_CASE_ALIASES,
)

Q2_CASES = _CaseCollection(
    [Q2_CASE1, Q2_CASE2, Q2_CASE3, Q2_CASE4, Q2_CASE5, Q2_CASE6]
)
Q2_CASES_BY_ID = {str(case["case_id"]): case for case in Q2_CASES}
Q2_CASE_PARAMETERS = Q2_CASES
Q2_TABLE1_CASES = Q2_CASES
TABLE1_CASES = Q2_CASES
CASE_PARAMETERS = Q2_CASES
CASES = Q2_CASES

Q2_PART_DEFECT_RATES = tuple((case["p1"], case["p2"]) for case in Q2_CASES)
Q2_PART_PURCHASE_PRICES = tuple((case["a1"], case["a2"]) for case in Q2_CASES)
Q2_PART_INSPECTION_COSTS = tuple((case["t1"], case["t2"]) for case in Q2_CASES)
Q2_PRODUCT_DEFECT_RATES = tuple(case["pf"] for case in Q2_CASES)
Q2_PRODUCT_ASSEMBLY_COSTS = tuple(case["kf"] for case in Q2_CASES)
Q2_PRODUCT_INSPECTION_COSTS = tuple(case["tf"] for case in Q2_CASES)
Q2_MARKET_PRICES = tuple(case["sale_price"] for case in Q2_CASES)
Q2_EXCHANGE_LOSSES = tuple(case["exchange_loss"] for case in Q2_CASES)
Q2_DISASSEMBLY_COSTS = tuple(case["disassembly_cost"] for case in Q2_CASES)

DEFECT_RATES = Q2_PART_DEFECT_RATES
PART_PURCHASE_PRICES = Q2_PART_PURCHASE_PRICES
PART_INSPECTION_COSTS = Q2_PART_INSPECTION_COSTS
PRODUCT_DEFECT_RATES = Q2_PRODUCT_DEFECT_RATES
PRODUCT_ASSEMBLY_COSTS = Q2_PRODUCT_ASSEMBLY_COSTS
PRODUCT_INSPECTION_COSTS = Q2_PRODUCT_INSPECTION_COSTS
MARKET_PRICES = Q2_MARKET_PRICES
EXCHANGE_LOSSES = Q2_EXCHANGE_LOSSES
DISASSEMBLY_COSTS = Q2_DISASSEMBLY_COSTS

F_T1_C1 = Q2_CASE1
F_T1_C2 = Q2_CASE2
F_T1_C3 = Q2_CASE3
F_T1_C4 = Q2_CASE4
F_T1_C5 = Q2_CASE5
F_T1_C6 = Q2_CASE6


# ---------------------------------------------------------------------------
# Problem 3: Table 2 parameters and inferred topology scenarios
# ---------------------------------------------------------------------------

Q3_PARAMETER_NODE_COUNT = 12
Q3_MAIN_SCENARIO_STRATEGY_COUNT = 65536
Q3_REACHABLE_STATE_LIMIT = 531441
Q3_INSPECTION_DECISION_COUNT = Q3_PARAMETER_NODE_COUNT
Q3_TOTAL_DECISION_COUNT = Q3_MAIN_SCENARIO_STRATEGY_COUNT.bit_length() - 1
Q3_DISPOSAL_DECISION_COUNT = (
    Q3_TOTAL_DECISION_COUNT - Q3_INSPECTION_DECISION_COUNT
)
Q3_POLICY_SPACE_COUNT = Q3_MAIN_SCENARIO_STRATEGY_COUNT
Q3_EFFECTIVE_STRATEGY_COUNT = Q3_MAIN_SCENARIO_STRATEGY_COUNT
Q3_MAX_REACHABLE_STATES = Q3_REACHABLE_STATE_LIMIT
Q3_OFFICIAL_TOPOLOGY_AVAILABLE = False
Q3_PRIMARY_TOPOLOGY_IS_INFERRED = True


def _q3_part(
    node_id: int,
    defect_rate: float,
    purchase_price: float,
    inspection_cost: float,
) -> _AliasMapping:
    return _AliasMapping(
        {
            "node_id": node_id,
            "kind": "part",
            "defect_rate": defect_rate,
            "purchase_price": purchase_price,
            "inspection_cost": inspection_cost,
        },
        aliases=_NODE_ALIASES,
    )


def _q3_assembly_node(
    kind: str,
    node_id: int,
    defect_rate: float,
    assembly_cost: float,
    inspection_cost: float,
    disassembly_cost: float,
) -> _AliasMapping:
    return _AliasMapping(
        {
            "node_id": node_id,
            "kind": kind,
            "defect_rate": defect_rate,
            "assembly_cost": assembly_cost,
            "inspection_cost": inspection_cost,
            "disassembly_cost": disassembly_cost,
        },
        aliases=_NODE_ALIASES,
    )


Q3_PART1 = _q3_part(1, 0.10, 2, 1)
Q3_PART2 = _q3_part(2, 0.10, 8, 1)
Q3_PART3 = _q3_part(3, 0.10, 12, 2)
Q3_PART4 = _q3_part(4, 0.10, 2, 1)
Q3_PART5 = _q3_part(5, 0.10, 8, 1)
Q3_PART6 = _q3_part(6, 0.10, 12, 2)
Q3_PART7 = _q3_part(7, 0.10, 8, 1)
Q3_PART8 = _q3_part(8, 0.10, 12, 2)

Q3_SEMI1 = _q3_assembly_node("semi", 1, 0.10, 8, 4, 6)
Q3_SEMI2 = _q3_assembly_node("semi", 2, 0.10, 8, 4, 6)
Q3_SEMI3 = _q3_assembly_node("semi", 3, 0.10, 8, 4, 6)
Q3_PRODUCT_NODE = _q3_assembly_node("product", 1, 0.10, 8, 6, 10)

Q3_PARTS = [Q3_PART1, Q3_PART2, Q3_PART3, Q3_PART4, Q3_PART5, Q3_PART6, Q3_PART7, Q3_PART8]
Q3_SEMIS = [Q3_SEMI1, Q3_SEMI2, Q3_SEMI3]
Q3_SEMI_PRODUCTS = Q3_SEMIS
Q3_PRODUCT = Q3_PRODUCT_NODE
Q3_PRODUCT_PARAMETERS = Q3_PRODUCT_NODE
Q3_PART_PARAMETERS = Q3_PARTS
Q3_SEMI_PARAMETERS = Q3_SEMIS
Q3_PARAMETER_NODES = tuple(Q3_PARTS + Q3_SEMIS + [Q3_PRODUCT_NODE])
Q3_NODES = Q3_PARAMETER_NODES
Q3_NODE_SEQUENCE = Q3_PARAMETER_NODES

Q3_PART_NODE_IDS = tuple(node["node_id"] for node in Q3_PARTS)
Q3_SEMI_NODE_IDS = tuple(node["node_id"] for node in Q3_SEMIS)
Q3_PARAMETER_NODE_IDS = Q3_PART_NODE_IDS + Q3_SEMI_NODE_IDS + (Q3_PRODUCT_NODE["node_id"],)

Q3_PART_DEFECT_RATES = tuple(node["defect_rate"] for node in Q3_PARTS)
Q3_PART_PURCHASE_PRICES = tuple(node["purchase_price"] for node in Q3_PARTS)
Q3_PART_INSPECTION_COSTS = tuple(node["inspection_cost"] for node in Q3_PARTS)
Q3_SEMI_DEFECT_RATES = tuple(node["defect_rate"] for node in Q3_SEMIS)
Q3_SEMI_ASSEMBLY_COSTS = tuple(node["assembly_cost"] for node in Q3_SEMIS)
Q3_SEMI_INSPECTION_COSTS = tuple(node["inspection_cost"] for node in Q3_SEMIS)
Q3_SEMI_DISASSEMBLY_COSTS = tuple(node["disassembly_cost"] for node in Q3_SEMIS)
Q3_ROOT_DEFECT_RATE = Q3_PRODUCT_NODE["defect_rate"]
Q3_ROOT_ASSEMBLY_COST = Q3_PRODUCT_NODE["assembly_cost"]
Q3_ROOT_INSPECTION_COST = Q3_PRODUCT_NODE["inspection_cost"]
Q3_ROOT_DISASSEMBLY_COST = Q3_PRODUCT_NODE["disassembly_cost"]
Q3_MARKET_PRICE = 200
Q3_SALE_PRICE = Q3_MARKET_PRICE
Q3_EXCHANGE_LOSS = 40

_TOPOLOGY_ALIASES = {
    "semi1": ("半成品1",),
    "semi_1": ("半成品1",),
    "semi2": ("半成品2",),
    "semi_2": ("半成品2",),
    "semi3": ("半成品3",),
    "semi_3": ("半成品3",),
    "product": ("成品",),
    "root": ("成品",),
    "finished_product": ("成品",),
}

Q3_PRIMARY_TOPOLOGY = _AliasMapping(
    {
        "半成品1": [1, 2, 3],
        "半成品2": [4, 5, 6],
        "半成品3": [7, 8],
        "成品": ["半成品1", "半成品2", "半成品3"],
    },
    aliases=_TOPOLOGY_ALIASES,
)

Q3_ALTERNATIVE_TOPOLOGY = _AliasMapping(
    {
        "半成品1": [1, 2],
        "半成品2": [3, 4],
        "半成品3": [5, 6, 7, 8],
        "成品": ["半成品1", "半成品2", "半成品3"],
    },
    aliases=_TOPOLOGY_ALIASES,
)

Q3_MAIN_TOPOLOGY = Q3_PRIMARY_TOPOLOGY
Q3_PRIMARY_TOPOLOGY_MAP = Q3_PRIMARY_TOPOLOGY
Q3_ALTERNATIVE_TOPOLOGY_MAP = Q3_ALTERNATIVE_TOPOLOGY
Q3_TOPOLOGIES = {
    "primary": Q3_PRIMARY_TOPOLOGY,
    "alternative": Q3_ALTERNATIVE_TOPOLOGY,
}

Q3_PRIMARY_PARENT_GROUPS = {
    "semi1": [1, 2, 3],
    "semi2": [4, 5, 6],
    "semi3": [7, 8],
    "product": ["semi1", "semi2", "semi3"],
}
Q3_ALTERNATIVE_PARENT_GROUPS = {
    "semi1": [1, 2],
    "semi2": [3, 4],
    "semi3": [5, 6, 7, 8],
    "product": ["semi1", "semi2", "semi3"],
}
Q3_PRIMARY_PARENTS = {
    "part1": (),
    "part2": (),
    "part3": (),
    "part4": (),
    "part5": (),
    "part6": (),
    "part7": (),
    "part8": (),
    "semi1": ("part1", "part2", "part3"),
    "semi2": ("part4", "part5", "part6"),
    "semi3": ("part7", "part8"),
    "product": ("semi1", "semi2", "semi3"),
}
Q3_ALTERNATIVE_PARENTS = {
    "part1": (),
    "part2": (),
    "part3": (),
    "part4": (),
    "part5": (),
    "part6": (),
    "part7": (),
    "part8": (),
    "semi1": ("part1", "part2"),
    "semi2": ("part3", "part4"),
    "semi3": ("part5", "part6", "part7", "part8"),
    "product": ("semi1", "semi2", "semi3"),
}
Q3_PRIMARY_PARENT_MAP = Q3_PRIMARY_PARENTS
Q3_ALTERNATIVE_PARENT_MAP = Q3_ALTERNATIVE_PARENTS


def _canonical_q3_node_name(name: _Any) -> str:
    if isinstance(name, int):
        return f"part{name}"
    mapping = {
        "半成品1": "semi1",
        "半成品2": "semi2",
        "半成品3": "semi3",
        "成品": "product",
    }
    return mapping.get(str(name), str(name))


def _topology_edges(topology: _Any) -> tuple[tuple[str, str], ...]:
    edges: list[tuple[str, str]] = []
    for target, sources in topology.items():
        for source in sources:
            edges.append(
                (
                    _canonical_q3_node_name(source),
                    _canonical_q3_node_name(target),
                )
            )
    return tuple(edges)


Q3_PRIMARY_EDGES = _topology_edges(Q3_PRIMARY_TOPOLOGY)
Q3_ALTERNATIVE_EDGES = _topology_edges(Q3_ALTERNATIVE_TOPOLOGY)
Q3_PRIMARY_REVERSE_EDGES: dict[str, list[str]] = {}
for _source, _target in Q3_PRIMARY_EDGES:
    Q3_PRIMARY_REVERSE_EDGES.setdefault(_source, []).append(_target)
Q3_ALTERNATIVE_REVERSE_EDGES: dict[str, list[str]] = {}
for _source, _target in Q3_ALTERNATIVE_EDGES:
    Q3_ALTERNATIVE_REVERSE_EDGES.setdefault(_source, []).append(_target)

Q3_POLICY_BIT_ORDER = (
    "part1_inspection",
    "part2_inspection",
    "part3_inspection",
    "part4_inspection",
    "part5_inspection",
    "part6_inspection",
    "part7_inspection",
    "part8_inspection",
    "semi1_inspection",
    "semi2_inspection",
    "semi3_inspection",
    "product_inspection",
    "semi1_disassembly",
    "semi2_disassembly",
    "semi3_disassembly",
    "product_disassembly",
)


def q3_policy_space() -> _Any:
    """Yield all registered Q3 binary policies without storing them eagerly."""
    return _itertools.product((0, 1), repeat=Q3_TOTAL_DECISION_COUNT)


F_T2_PART_1 = Q3_PART1
F_T2_PART_2 = Q3_PART2
F_T2_PART_3 = Q3_PART3
F_T2_PART_4 = Q3_PART4
F_T2_PART_5 = Q3_PART5
F_T2_PART_6 = Q3_PART6
F_T2_PART_7 = Q3_PART7
F_T2_PART_8 = Q3_PART8
F_T2_PART1 = Q3_PART1
F_T2_PART2 = Q3_PART2
F_T2_PART3 = Q3_PART3
F_T2_PART4 = Q3_PART4
F_T2_PART5 = Q3_PART5
F_T2_PART6 = Q3_PART6
F_T2_PART7 = Q3_PART7
F_T2_PART8 = Q3_PART8
F_T2_SEMI = Q3_SEMIS
F_T2_SEMI_1 = Q3_SEMI1
F_T2_SEMI_2 = Q3_SEMI2
F_T2_SEMI_3 = Q3_SEMI3
F_T2_PRODUCT = Q3_PRODUCT_NODE
F_T2_PRICE = {
    "sale_price": Q3_MARKET_PRICE,
    "exchange_loss": Q3_EXCHANGE_LOSS,
}
F_FIG1 = {
    "process_count": 2,
    "part_count": 8,
    "official_topology_available": Q3_OFFICIAL_TOPOLOGY_AVAILABLE,
}


# ---------------------------------------------------------------------------
# Problem 4: CP intervals, Bonferroni construction, and scenario resampling
# ---------------------------------------------------------------------------

Q4_FAMILY_CONFIDENCE_LEVEL = 0.95
Q4_FAMILY_ERROR_RATE = 0.05
Q4_WIDTH_TARGET = 0.10
Q4_SINGLE_PARAMETER_N_MAX = 1000
Q4_SAMPLE_SIZE_GRID = (50, 100, 200, 400, 800)
Q4_SCENARIO_REPETITIONS = 10000
Q4_RANDOM_SEED = 202409
Q4_JEFFREYS_PRIOR_ALPHA = 0.50
Q4_JEFFREYS_PRIOR_BETA = 0.50
Q4_DECISION_CONSISTENCY_THRESHOLD = 0.90
RELATIVE_SENSITIVITY_GRID = (-0.20, -0.10, 0.00, 0.10, 0.20)
Q4_ACTUAL_SAMPLES_AVAILABLE = False
Q4_SCENARIO_ONLY = True
Q4_RESULTS_ARE_SCENARIO_ANALYSIS = True

Q4_Q2_MARGINAL_ERROR_RATE = Q4_FAMILY_ERROR_RATE / Q2_PARAMETER_NODE_COUNT
Q4_Q3_MARGINAL_ERROR_RATE = Q4_FAMILY_ERROR_RATE / Q3_PARAMETER_NODE_COUNT

Q4_CONFIDENCE_LEVEL = Q4_FAMILY_CONFIDENCE_LEVEL
Q4_FAMILY_ALPHA = Q4_FAMILY_ERROR_RATE
Q4_JOINT_CONFIDENCE_LEVEL = Q4_FAMILY_CONFIDENCE_LEVEL
Q4_JOINT_FAMILY_ALPHA = Q4_FAMILY_ERROR_RATE
Q4_INTERVAL_WIDTH_TARGET = Q4_WIDTH_TARGET
Q4_CP_WIDTH_TARGET = Q4_WIDTH_TARGET
Q4_N_MAX = Q4_SINGLE_PARAMETER_N_MAX
Q4_PARAMETER_N_MAX = Q4_SINGLE_PARAMETER_N_MAX
Q4_N_GRID = Q4_SAMPLE_SIZE_GRID
Q4_SAMPLE_GRID = Q4_SAMPLE_SIZE_GRID
Q4_MC_REPETITIONS = Q4_SCENARIO_REPETITIONS
Q4_REPETITIONS = Q4_SCENARIO_REPETITIONS
Q4_SEED = Q4_RANDOM_SEED
Q4_PRIOR_ALPHA = Q4_JEFFREYS_PRIOR_ALPHA
Q4_PRIOR_BETA = Q4_JEFFREYS_PRIOR_BETA
Q4_CONSISTENCY_THRESHOLD = Q4_DECISION_CONSISTENCY_THRESHOLD
Q4_ACTUAL_DATA_AVAILABLE = Q4_ACTUAL_SAMPLES_AVAILABLE
Q4_SCENARIO_MODE = Q4_SCENARIO_ONLY

Q4_Q2_ALPHA = Q4_Q2_MARGINAL_ERROR_RATE
Q4_Q3_ALPHA = Q4_Q3_MARGINAL_ERROR_RATE
Q4_MARGINAL_ALPHA_Q2 = Q4_Q2_MARGINAL_ERROR_RATE
Q4_MARGINAL_ALPHA_Q3 = Q4_Q3_MARGINAL_ERROR_RATE
Q4_ALPHA_PER_PARAMETER_Q2 = Q4_Q2_MARGINAL_ERROR_RATE
Q4_ALPHA_PER_PARAMETER_Q3 = Q4_Q3_MARGINAL_ERROR_RATE
Q4_BONFERRONI_ALPHA_Q2 = Q4_Q2_MARGINAL_ERROR_RATE
Q4_BONFERRONI_ALPHA_Q3 = Q4_Q3_MARGINAL_ERROR_RATE

SENSITIVITY_GRID = RELATIVE_SENSITIVITY_GRID


# ---------------------------------------------------------------------------
# Fact aliases and cross-question units
# ---------------------------------------------------------------------------

F_MECH_SYSTEM = "two_parts_assemble_one_product"
F_MECH_QUALIFIED = "conditional_product_defect_remains"
F_MECH_DISASSEMBLE = "lossless_disassembly_with_fee"
F_MECH_EXCHANGE = "unconditional_replacement_of_returned_product"
F_MECH_INSPECT_COST = "enterprise_bears_inspection_cost"
F_APPENDIX_DEFECT_DEF = "conditional_rate_after_qualified_inputs"
F_APPENDIX_EXCHANGE_LOSS = "loss_excludes_replacement_production_cost"
F_APPENDIX_UNIT = "yuan_per_item"

RATIO_UNIT = "1"
MONEY_UNIT = "元/件"
COST_UNIT = "元/件"
PRICE_UNIT = "元/件"
LOSS_UNIT = "元/件"
PROFIT_UNIT = "元/合格交付"
COUNT_UNIT = "件"
SAMPLE_SIZE_UNIT = "次"
ITERATION_UNIT = "轮"
RANDOM_SEED_UNIT = ""

PARAMETER_PROVENANCE = {
    "problem1": "PROBLEM_FACTS + registered design-risk constants",
    "problem2": "PROBLEM_FACTS Table 1",
    "problem3": "PROBLEM_FACTS Table 2 + inferred topology scenarios",
    "problem4": "registered scenario-sampling and confidence constants",
}
]<]minimax[>[</content>