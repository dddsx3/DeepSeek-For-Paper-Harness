# -*- coding: utf-8 -*-
"""阶段 3 的题面事实、建模设计常数和可复算参数。

本文件只保存输入参数与结构常量，不保存任何阶段 3 自算结果。
问题一中的备择幅度和第二类错误是建模设计常数，不是题面直接事实；
问题三的两种拓扑和问题四的样本均明确保留情景/条件分析标识。
"""

from __future__ import annotations

import math
from itertools import product


class _AliasRecord(dict):
    """同时支持字典键和属性访问的轻量参数记录。"""

    def __init__(self, data=None, *, aliases=None, **kwargs):
        super().__init__(data or {}, **kwargs)
        object.__setattr__(self, "_aliases", dict(aliases or {}))

    def _canonical_key(self, key):
        if dict.__contains__(self, key):
            return key
        aliases = object.__getattribute__(self, "_aliases")
        return aliases.get(key, key)

    def __getitem__(self, key):
        return dict.__getitem__(self, self._canonical_key(key))

    def get(self, key, default=None):
        try:
            return self[key]
        except KeyError:
            return default

    def __getattr__(self, name):
        try:
            return self[name]
        except KeyError as exc:
            raise AttributeError(name) from exc


# ---------------------------------------------------------------------------
# Problem 1 parameters
# ---------------------------------------------------------------------------

P0 = 0.10
ALPHA_REJECT = 0.05
ACCEPT_CONFIDENCE = 0.90

# A-010: registered operational design constants, not题面直接给定值。
Q1_ALTERNATIVE_DELTA = 0.05
Q1_TYPE_II_ERROR = 0.10

Q1_DELTA_GRID = (0.02, 0.05, 0.10)
Q1_BETA_GRID = (0.05, 0.10, 0.20)
Q1_TYPE_II_ERROR_GRID = Q1_BETA_GRID
Q1_NUMERIC_TOL = 1e-12

# Computational search controls.  They are kept here so the problem
# modules contain no unregistered literals.
Q1_N_MAX = 10000
Q1_MAX_N = Q1_N_MAX
Q1_SEARCH_MAX_N = Q1_N_MAX
Q1_SPRT_MAX_N = Q1_N_MAX
Q1_SPRT_N_LIMIT = Q1_N_MAX

# A sufficiently fine deterministic grid for the OC output and plot data.
Q1_OC_GRID_POINT_COUNT = 101
Q1_OC_GRID_DENOMINATOR = 100
Q1_OC_GRID = tuple(
    index / Q1_OC_GRID_DENOMINATOR
    for index in range(Q1_OC_GRID_POINT_COUNT)
)
Q1_OC_GRID_SIZE = Q1_OC_GRID_POINT_COUNT

Q1_SPRT_LOWER_BOUNDARY = math.log(
    (1 - Q1_TYPE_II_ERROR) / ALPHA_REJECT
)
Q1_SPRT_UPPER_BOUNDARY = math.log(
    1 / (1 - Q1_TYPE_II_ERROR)
)
Q1_SPRT_A = Q1_SPRT_LOWER_BOUNDARY
Q1_SPRT_B = Q1_SPRT_UPPER_BOUNDARY
Q1_SPRT_TRUNCATION_RULE = "finite_conservative_boundary_rule"
Q1_TIE_BREAK_RULE = "lexicographic_smallest_n_then_threshold"
Q1_CASE95_MODE = "operational_power_constrained"
Q1_CASE95_DESIGN_BASIS = "p0_plus_registered_delta_and_beta"


# ---------------------------------------------------------------------------
# Problem 2 common scales and policies
# ---------------------------------------------------------------------------

Q2_POLICY_VARIABLE_COUNT = 4
Q2_POLICY_SPACE_SIZE = 2 ** Q2_POLICY_VARIABLE_COUNT
Q2_EFFECTIVE_STRATEGY_COUNT = 16
Q2_POLICY_ORDER = ("Z1", "Z2", "C", "D")
Q2_POLICY_SPACE = tuple(
    product((0, 1), repeat=Q2_POLICY_VARIABLE_COUNT)
)
Q2_STRATEGIES = Q2_POLICY_SPACE

Q2_STATE_VALUES = ("empty", "good", "bad")
Q2_STATE_SPACE_SIZE = 9
Q2_INVENTORY_STATE_LIMIT = Q2_STATE_SPACE_SIZE
Q2_PARAMETER_COUNT = 3
Q2_COST_FLOOR = 0.0
Q2_PROBABILITY_FLOOR = 0.0
Q2_PROBABILITY_CEILING = 1.0
Q2_VALUE_TOLERANCE = 1e-10
Q2_CASHFLOW_TOLERANCE = 1e-6
Q2_TIE_BREAK_RULE = "maximum_profit_then_lexicographic_policy"

# Rates used by the six rows of Table 1.
Q2_RATE_05 = 0.05
Q2_RATE_10 = P0
Q2_RATE_20 = 0.20

Q2_CASE1_ID = 1
Q2_CASE2_ID = 2
Q2_CASE3_ID = 3
Q2_CASE4_ID = 4
Q2_CASE5_ID = 5
Q2_CASE6_ID = 6


def _make_q2_case(
    case_id,
    p1,
    p2,
    pf,
    a1,
    t1,
    a2,
    t2,
    kf,
    tf,
    market_price,
    exchange_loss,
    disassembly_cost,
):
    return _AliasRecord(
        {
            "case_id": case_id,
            "p1": p1,
            "p2": p2,
            "pf": pf,
            "a1": a1,
            "t1": t1,
            "a2": a2,
            "t2": t2,
            "kf": kf,
            "tf": tf,
            "market_price": market_price,
            "exchange_loss": exchange_loss,
            "disassembly_cost": disassembly_cost,
        },
        aliases={
            "case": "case_id",
            "case_no": "case_id",
            "id": "case_id",
            "index": "case_id",
            "part1_rate": "p1",
            "part2_rate": "p2",
            "product_rate": "pf",
            "part1_defect": "p1",
            "part2_defect": "p2",
            "product_defect": "pf",
            "p_part1": "p1",
            "p_part2": "p2",
            "p_product": "pf",
            "a_1": "a1",
            "a_2": "a2",
            "t_1": "t1",
            "t_2": "t2",
            "part1_price": "a1",
            "part2_price": "a2",
            "part1_purchase_price": "a1",
            "part2_purchase_price": "a2",
            "part1_test": "t1",
            "part2_test": "t2",
            "part1_inspection_cost": "t1",
            "part2_inspection_cost": "t2",
            "purchase1": "a1",
            "purchase2": "a2",
            "inspection1": "t1",
            "inspection2": "t2",
            "assembly": "kf",
            "product_assembly": "kf",
            "k_f": "kf",
            "product_test": "tf",
            "t_f": "tf",
            "price": "market_price",
            "sale_price": "market_price",
            "r_market": "market_price",
            "loss": "exchange_loss",
            "exchange": "exchange_loss",
            "L_exchange": "exchange_loss",
            "disassembly": "disassembly_cost",
            "g_dis": "disassembly_cost",
        },
    )


Q2_CASE1 = _make_q2_case(
    Q2_CASE1_ID,
    Q2_RATE_10,
    Q2_RATE_10,
    Q2_RATE_10,
    4,
    2,
    18,
    3,
    6,
    3,
    56,
    6,
    5,
)
Q2_CASE2 = _make_q2_case(
    Q2_CASE2_ID,
    Q2_RATE_20,
    Q2_RATE_20,
    Q2_RATE_20,
    4,
    2,
    18,
    3,
    6,
    3,
    56,
    6,
    5,
)
Q2_CASE3 = _make_q2_case(
    Q2_CASE3_ID,
    Q2_RATE_10,
    Q2_RATE_10,
    Q2_RATE_10,
    4,
    2,
    18,
    3,
    6,
    3,
    56,
    30,
    5,
)
Q2_CASE4 = _make_q2_case(
    Q2_CASE4_ID,
    Q2_RATE_20,
    Q2_RATE_20,
    Q2_RATE_20,
    4,
    1,
    18,
    1,
    6,
    2,
    56,
    30,
    5,
)
Q2_CASE5 = _make_q2_case(
    Q2_CASE5_ID,
    Q2_RATE_10,
    Q2_RATE_20,
    Q2_RATE_10,
    4,
    8,
    18,
    1,
    6,
    2,
    56,
    10,
    5,
)
Q2_CASE6 = _make_q2_case(
    Q2_CASE6_ID,
    Q2_RATE_05,
    Q2_RATE_05,
    Q2_RATE_05,
    4,
    2,
    18,
    3,
    6,
    3,
    56,
    10,
    40,
)

Q2_CASES = (
    Q2_CASE1,
    Q2_CASE2,
    Q2_CASE3,
    Q2_CASE4,
    Q2_CASE5,
    Q2_CASE6,
)
Q2_CASE_IDS = tuple(case["case_id"] for case in Q2_CASES)
Q2_CASE_BY_ID = {case["case_id"]: case for case in Q2_CASES}
Q2_CASE_TABLE = {
    f"case_{case['case_id']}": case for case in Q2_CASES
}
Q2_CASE_FACT_IDS = (
    "F-T1-C1",
    "F-T1-C2",
    "F-T1-C3",
    "F-T1-C4",
    "F-T1-C5",
    "F-T1-C6",
)

Q2_DEFAULT_CASE = Q2_CASE1
Q2_DEFAULT_MARKET_PRICE = Q2_CASE1["market_price"]
Q2_DEFAULT_EXCHANGE_LOSS = Q2_CASE1["exchange_loss"]
Q2_DEFAULT_DISASSEMBLY_COST = Q2_CASE1["disassembly_cost"]
Q2_PART_COUNT = 2
Q2_ROOT_NODE_ID = "product"


# ---------------------------------------------------------------------------
# Problem 3 network and Table 2 parameters
# ---------------------------------------------------------------------------

Q3_PART_NODE_IDS = (1, 2, 3, 4, 5, 6, 7, 8)
Q3_SEMI_NODE_IDS = ("semi1", "semi2", "semi3")
Q3_ROOT_NODE_ID = "product"
Q3_SEMI_RATE = P0
Q3_PRODUCT_RATE = P0


def _make_node(
    node_id,
    defect_rate,
    purchase_price=None,
    inspection_cost=None,
    assembly_cost=None,
    disassembly_cost=None,
    extra_aliases=None,
):
    data = {
        "node_id": node_id,
        "defect_rate": defect_rate,
    }
    if purchase_price is not None:
        data["purchase_price"] = purchase_price
    if inspection_cost is not None:
        data["inspection_cost"] = inspection_cost
    if assembly_cost is not None:
        data["assembly_cost"] = assembly_cost
    if disassembly_cost is not None:
        data["disassembly_cost"] = disassembly_cost

    aliases = {
        "id": "node_id",
        "number": "node_id",
        "index": "node_id",
        "p": "defect_rate",
        "rate": "defect_rate",
        "defect": "defect_rate",
        "price": "purchase_price",
        "cost": "purchase_price",
        "purchase": "purchase_price",
        "test": "inspection_cost",
        "test_cost": "inspection_cost",
        "inspection": "inspection_cost",
        "assembly": "assembly_cost",
        "disassembly": "disassembly_cost",
        "g_dis": "disassembly_cost",
    }
    if extra_aliases:
        aliases.update(extra_aliases)
    return _AliasRecord(data, aliases=aliases)


Q3_PART_NODES = (
    _make_node(1, P0, 2, 1),
    _make_node(2, P0, 8, 1),
    _make_node(3, P0, 12, 2),
    _make_node(4, P0, 2, 1),
    _make_node(5, P0, 8, 1),
    _make_node(6, P0, 12, 2),
    _make_node(7, P0, 8, 1),
    _make_node(8, P0, 12, 2),
)

Q3_SEMI_NODES = (
    _make_node("semi1", Q3_SEMI_RATE, None, 4, 8, 6),
    _make_node("semi2", Q3_SEMI_RATE, None, 4, 8, 6),
    _make_node("semi3", Q3_SEMI_RATE, None, 4, 8, 6),
)

Q3_PRODUCT_DATA = _make_node(
    Q3_ROOT_NODE_ID,
    Q3_PRODUCT_RATE,
    None,
    6,
    8,
    10,
    extra_aliases={
        "market_price": "market_price",
        "sale_price": "market_price",
        "r_market": "market_price",
        "price": "market_price",
        "loss": "exchange_loss",
        "exchange": "exchange_loss",
        "L_exchange": "exchange_loss",
    },
)
Q3_PRODUCT_DATA["market_price"] = 200
Q3_PRODUCT_DATA["exchange_loss"] = 40

Q3_PART_DATA = {
    node["node_id"]: node for node in Q3_PART_NODES
}
Q3_SEMI_DATA = {
    node["node_id"]: node for node in Q3_SEMI_NODES
}
Q3_NODE_DATA = {}
Q3_NODE_DATA.update(Q3_PART_DATA)
Q3_NODE_DATA.update(Q3_SEMI_DATA)
Q3_NODE_DATA[Q3_ROOT_NODE_ID] = Q3_PRODUCT_DATA

Q3_PARTS = Q3_PART_NODES
Q3_SEMIS = Q3_SEMI_NODES
Q3_PART_COSTS = {
    node["node_id"]: _AliasRecord(
        {
            "purchase_price": node["purchase_price"],
            "inspection_cost": node["inspection_cost"],
        },
        aliases={
            "price": "purchase_price",
            "test": "inspection_cost",
            "test_cost": "inspection_cost",
        },
    )
    for node in Q3_PART_NODES
}
Q3_SEMI_COSTS = {
    node["node_id"]: _AliasRecord(
        {
            "assembly_cost": node["assembly_cost"],
            "inspection_cost": node["inspection_cost"],
            "disassembly_cost": node["disassembly_cost"],
        },
        aliases={
            "assembly": "assembly_cost",
            "test": "inspection_cost",
            "test_cost": "inspection_cost",
            "disassembly": "disassembly_cost",
            "g_dis": "disassembly_cost",
        },
    )
    for node in Q3_SEMI_NODES
}
Q3_PRODUCT_COSTS = Q3_PRODUCT_DATA
Q3_ROOT_COSTS = Q3_PRODUCT_COSTS

Q3_PART_DEFECT_RATES = tuple(
    node["defect_rate"] for node in Q3_PART_NODES
)
Q3_PART_PURCHASE_PRICES = tuple(
    node["purchase_price"] for node in Q3_PART_NODES
)
Q3_PART_INSPECTION_COSTS = tuple(
    node["inspection_cost"] for node in Q3_PART_NODES
)
Q3_PART_TRIPLES = tuple(
    (
        node["node_id"],
        node["defect_rate"],
        node["purchase_price"],
        node["inspection_cost"],
    )
    for node in Q3_PART_NODES
)

Q3_PART_ROWS = tuple(
    _AliasRecord(
        {
            "id": node["node_id"],
            "p": node["defect_rate"],
            "cost": node["purchase_price"],
            "test": node["inspection_cost"],
        },
        aliases={
            "node_id": "id",
            "defect_rate": "p",
            "purchase_price": "cost",
            "inspection_cost": "test",
        },
    )
    for node in Q3_PART_NODES
)
Q3_SEMI_ROWS = tuple(
    _AliasRecord(
        {
            "id": node["node_id"],
            "p": node["defect_rate"],
            "assembly": node["assembly_cost"],
            "test": node["inspection_cost"],
            "disassembly": node["disassembly_cost"],
        },
        aliases={
            "node_id": "id",
            "defect_rate": "p",
            "assembly_cost": "assembly",
            "inspection_cost": "test",
            "disassembly_cost": "disassembly",
        },
    )
    for node in Q3_SEMI_NODES
)
Q3_PRODUCT_ROW = _AliasRecord(
    {
        "id": Q3_ROOT_NODE_ID,
        "p": Q3_PRODUCT_RATE,
        "assembly": Q3_PRODUCT_DATA["assembly_cost"],
        "test": Q3_PRODUCT_DATA["inspection_cost"],
        "disassembly": Q3_PRODUCT_DATA["disassembly_cost"],
        "price": Q3_PRODUCT_DATA["market_price"],
        "exchange_loss": Q3_PRODUCT_DATA["exchange_loss"],
    },
    aliases={
        "node_id": "id",
        "defect_rate": "p",
        "assembly_cost": "assembly",
        "inspection_cost": "test",
        "disassembly_cost": "disassembly",
        "market_price": "price",
        "r_market": "price",
        "L_exchange": "exchange_loss",
    },
)

Q3_TOPOLOGY_ALIASES = {
    "半成品1": "semi1",
    "半成品2": "semi2",
    "半成品3": "semi3",
    "成品": "product",
    "S1": "semi1",
    "S2": "semi2",
    "S3": "semi3",
    "P": "product",
    "ROOT": "product",
}

Q3_PRIMARY_TOPOLOGY = _AliasRecord(
    {
        "semi1": [1, 2, 3],
        "semi2": [4, 5, 6],
        "semi3": [7, 8],
        "product": ["semi1", "semi2", "semi3"],
    },
    aliases=Q3_TOPOLOGY_ALIASES,
)
Q3_ALTERNATIVE_TOPOLOGY = _AliasRecord(
    {
        "semi1": [1, 2],
        "semi2": [3, 4],
        "semi3": [5, 6, 7, 8],
        "product": ["semi1", "semi2", "semi3"],
    },
    aliases=Q3_TOPOLOGY_ALIASES,
)
Q3_PRIMARY_TOPOLOGY_CN = {
    "半成品1": [1, 2, 3],
    "半成品2": [4, 5, 6],
    "半成品3": [7, 8],
    "成品": ["半成品1", "半成品2", "半成品3"],
}
Q3_ALTERNATIVE_TOPOLOGY_CN = {
    "半成品1": [1, 2],
    "半成品2": [3, 4],
    "半成品3": [5, 6, 7, 8],
    "成品": ["半成品1", "半成品2", "半成品3"],
}


def _topology_edges(topology):
    return tuple(
        (parent, child)
        for child in topology
        for parent in topology[child]
    )


Q3_PRIMARY_EDGES = _topology_edges(Q3_PRIMARY_TOPOLOGY)
Q3_ALTERNATIVE_EDGES = _topology_edges(Q3_ALTERNATIVE_TOPOLOGY)
Q3_PARAMETER_NODE_IDS = (
    tuple(node["node_id"] for node in Q3_PART_NODES)
    + Q3_SEMI_NODE_IDS
    + (Q3_ROOT_NODE_ID,)
)
Q3_PARAMETER_COUNT = len(Q3_PARAMETER_NODE_IDS)
Q3_INSPECTION_DECISION_NODES = Q3_PARAMETER_NODE_IDS
Q3_DISASSEMBLY_DECISION_NODES = Q3_SEMI_NODE_IDS + (Q3_ROOT_NODE_ID,)
Q3_INSPECTION_VARIABLE_COUNT = len(Q3_INSPECTION_DECISION_NODES)
Q3_DISASSEMBLY_VARIABLE_COUNT = len(Q3_DISASSEMBLY_DECISION_NODES)
Q3_DECISION_VARIABLE_COUNT = (
    Q3_INSPECTION_VARIABLE_COUNT + Q3_DISASSEMBLY_VARIABLE_COUNT
)
Q3_EFFECTIVE_STRATEGY_COUNT = 65536
Q3_POLICY_SPACE = tuple(
    product((0, 1), repeat=Q3_DECISION_VARIABLE_COUNT)
)
Q3_STRATEGIES = Q3_POLICY_SPACE
Q3_POLICY_ORDER = tuple(
    [f"inspect:{node}" for node in Q3_INSPECTION_DECISION_NODES]
    + [f"disassemble:{node}" for node in Q3_DISASSEMBLY_DECISION_NODES]
)
Q3_STATE_SPACE_LIMIT = 531441
Q3_STATE_SPACE_SIZE = Q3_STATE_SPACE_LIMIT
Q3_ROOT_UNIT_COST_DEFINITION = "U_v_equals_C_v_over_Q_v"
Q3_ROOT_FAILURE_POLICY = "all_bad_outcomes_enter_disposition"
Q3_TOPOLOGY_STATUS = "conditional_primary_inferred_from_table2"
Q3_FORMAL_INSTANCE_STATUS = Q3_TOPOLOGY_STATUS
Q3_FORMAL_INSTANCE_TOPOLOGY = Q3_PRIMARY_TOPOLOGY
Q3_OFFICIAL_TOPOLOGY = Q3_PRIMARY_TOPOLOGY
Q3_GRAPH_FACT_STATUS = "figure_1_source_edge_table_not_supplied"


# ---------------------------------------------------------------------------
# Problem 4 precision, interval, and resampling parameters
# ---------------------------------------------------------------------------

Q4_FAMILY_ALPHA = 0.05
Q4_CONFIDENCE_LEVEL = 0.95
Q4_WIDTH_TARGET = 0.10
Q4_N_MAX = 1000
Q4_SAMPLE_SIZE_GRID = (50, 100, 200, 400, 800)
Q4_MC_REPEATS = 10000
Q4_RANDOM_SEED = 202409
Q4_PRIOR_ALPHA = 0.5
Q4_PRIOR_BETA = 0.5
Q4_CONSISTENCY_THRESHOLD = 0.90
Q4_PARAMETER_COUNT_Q2 = Q2_PARAMETER_COUNT
Q4_PARAMETER_COUNT_Q3 = Q3_PARAMETER_COUNT
Q4_ALPHA_Q2 = Q4_FAMILY_ALPHA / Q4_PARAMETER_COUNT_Q2
Q4_ALPHA_Q3 = Q4_FAMILY_ALPHA / Q4_PARAMETER_COUNT_Q3
Q4_ALPHA_Q2_REGISTERED = 0.0166666666666667
Q4_ALPHA_Q3_REGISTERED = 0.00416666666666667
Q4_CP_METHOD = "clopper_pearson_exact"
Q4_CP_EDGE_CASES = (
    (1, 0),
    (1, 1),
    (10, 0),
    (10, 10),
    (20, 7),
)
Q4_Q2_RATE_KEYS = ("p1", "p2", "pf")
Q4_Q3_RATE_KEYS = Q3_PARAMETER_NODE_IDS
Q4_Q2_RATE_MATRIX = tuple(
    (case["p1"], case["p2"], case["pf"])
    for case in Q2_CASES
)
Q4_Q3_RATE_VECTOR = tuple(
    Q3_NODE_DATA[node]["defect_rate"]
    for node in Q3_PARAMETER_NODE_IDS
)
Q4_SAMPLE_SOURCE = "synthetic_scenario_only"
Q4_OBSERVED_SAMPLE_STATUS = "no_actual_n_x_supplied"
Q4_DECISION_REOPTIMIZATION = "required_for_every_resample"
Q4_PROFIT_UNIT = "元/合格交付"


# ---------------------------------------------------------------------------
# Cross-problem tolerances and provenance
# ---------------------------------------------------------------------------

CASHFLOW_ABS_TOL = 1e-6
VALUE_ITERATION_TOL = 1e-10
VALUE_ITERATION_MAX = 100000

MODEL_CONSTANTS = {
    "Q1标称次品率": P0,
    "Q1拒收第一类错误上限": ALPHA_REJECT,
    "Q1接收置信水平": ACCEPT_CONFIDENCE,
    "Q1可识别超标幅度": Q1_ALTERNATIVE_DELTA,
    "Q1第二类错误上限": Q1_TYPE_II_ERROR,
    "Q1超标幅度灵敏度网格": list(Q1_DELTA_GRID),
    "Q1第二类错误灵敏度网格": list(Q1_BETA_GRID),
    "Q1精确枚举数值容差": Q1_NUMERIC_TOL,
    "Q2策略空间规模": Q2_POLICY_SPACE_SIZE,
    "Q2库存状态上限": Q2_INVENTORY_STATE_LIMIT,
    "现金流核验绝对容差": CASHFLOW_ABS_TOL,
    "价值迭代收敛容差": VALUE_ITERATION_TOL,
    "价值迭代最大轮数": VALUE_ITERATION_MAX,
    "Q3主情景拓扑": Q3_PRIMARY_TOPOLOGY_CN,
    "Q3替代拓扑": Q3_ALTERNATIVE_TOPOLOGY_CN,
    "Q3主情景有效策略数": Q3_EFFECTIVE_STRATEGY_COUNT,
    "Q3可达库存状态上限": Q3_STATE_SPACE_LIMIT,
    "Q4联合置信水平": Q4_CONFIDENCE_LEVEL,
    "Q4联合族错误率": Q4_FAMILY_ALPHA,
    "Q2参数节点数": Q2_PARAMETER_COUNT,
    "Q3参数节点数": Q3_PARAMETER_COUNT,
    "Q4-Q2 Bonferroni边际错误率": Q4_ALPHA_Q2,
    "Q4-Q3 Bonferroni边际错误率": Q4_ALPHA_Q3,
    "Q4区间总宽度目标": Q4_WIDTH_TARGET,
    "Q4单参数样本量上限": Q4_N_MAX,
    "Q4样本量扫描网格": list(Q4_SAMPLE_SIZE_GRID),
    "Q4情景蒙特卡洛重复次数": Q4_MC_REPEATS,
    "Q4随机种子": Q4_RANDOM_SEED,
    "Q4 Jeffreys先验α": Q4_PRIOR_ALPHA,
    "Q4 Jeffreys先验β": Q4_PRIOR_BETA,
    "Q4决策一致率门槛": Q4_CONSISTENCY_THRESHOLD,
}

FACT_VALUES = {
    "F-NOMINAL": P0,
    "F-CONF-REJECT": 1 - ALPHA_REJECT,
    "F-CONF-ACCEPT": ACCEPT_CONFIDENCE,
}

PARAMETER_PROVENANCE = {
    "P0": "F-NOMINAL",
    "ALPHA_REJECT": "F-CONF-REJECT",
    "ACCEPT_CONFIDENCE": "F-CONF-ACCEPT",
    "Q1_ALTERNATIVE_DELTA": "A-010",
    "Q1_TYPE_II_ERROR": "A-010",
    "Q2_CASES": "F-T1-C1:F-T1-C6",
    "Q3_PART_NODES": "F-T2-PART-1:F-T2-PART-8",
    "Q3_SEMI_NODES": "F-T2-SEMI",
    "Q3_PRODUCT_DATA": "F-T2-PRODUCT and F-T2-PRICE",
    "Q3_PRIMARY_TOPOLOGY": "table-2 grouping scenario; F-FIG1 is incomplete",
    "Q3_ALTERNATIVE_TOPOLOGY": "registered topology perturbation",
    "Q4_SAMPLE_SIZE_GRID": "model precision design grid",
    "Q4_MC_REPEATS": "registered scenario Monte Carlo repetitions",
    "Q4_RANDOM_SEED": "registered reproducibility seed",
}


# ---------------------------------------------------------------------------
# Compatibility aliases used by the per-problem modules
# ---------------------------------------------------------------------------

NOMINAL_RATE = P0
P_NOMINAL = P0
Q1_P0 = P0
Q1_NOMINAL_RATE = P0
ALPHA = ALPHA_REJECT
ALPHA_95 = ALPHA_REJECT
Q1_ALPHA_95 = ALPHA_REJECT
REJECT_ALPHA = ALPHA_REJECT
Q1_REJECT_ALPHA = ALPHA_REJECT
Q1_REJECT_ERROR = ALPHA_REJECT
REJECT_CONFIDENCE = 1 - ALPHA_REJECT
Q1_REJECT_CONFIDENCE = 1 - ALPHA_REJECT
CONF = ACCEPT_CONFIDENCE
CONF_ACCEPT = ACCEPT_CONFIDENCE
ACCEPT_CONF = ACCEPT_CONFIDENCE
Q1_ACCEPT_CONF = ACCEPT_CONFIDENCE
Q1_ACCEPT_ALPHA = 1 - ACCEPT_CONFIDENCE
P_ALT = P0 + Q1_ALTERNATIVE_DELTA
Q1_P_ALT = P_ALT
ALTERNATIVE_DELTA = Q1_ALTERNATIVE_DELTA
Q1_DELTA = Q1_ALTERNATIVE_DELTA
DELTA = Q1_ALTERNATIVE_DELTA
BETA = Q1_TYPE_II_ERROR
Q1_BETA = Q1_TYPE_II_ERROR
TYPE_II_ERROR = Q1_TYPE_II_ERROR
Q1_DELTA_GRID = Q1_DELTA_GRID
Q1_BETA_GRID = Q1_BETA_GRID
DELTA_GRID = Q1_DELTA_GRID
BETA_GRID = Q1_BETA_GRID
TOL = Q1_NUMERIC_TOL
Q1_TOL = Q1_NUMERIC_TOL
Q1_NUMERIC_TOLERANCE = Q1_NUMERIC_TOL
Q1_SPRT_LOWER = Q1_SPRT_LOWER_BOUNDARY
Q1_SPRT_UPPER = Q1_SPRT_UPPER_BOUNDARY

CASES = Q2_CASES
CASE_DATA = Q2_CASES
CASE_PARAMS = Q2_CASES
TABLE1_CASES = Q2_CASES
Q2_TABLE1_CASES = Q2_CASES
Q2_TABLE_CASES = Q2_CASES
Q2_DATA = Q2_CASES
Q2_CASE_TABLE = Q2_CASE_TABLE
CASE1 = Q2_CASE1
CASE2 = Q2_CASE2
CASE3 = Q2_CASE3
CASE4 = Q2_CASE4
CASE5 = Q2_CASE5
CASE6 = Q2_CASE6
Q2_POLICIES = Q2_POLICY_SPACE
Q2_STRATEGY_SPACE = Q2_POLICY_SPACE
Q2_POLICY_SPACE_SIZE = Q2_POLICY_SPACE_SIZE
Q2_STRATEGY_COUNT = Q2_POLICY_SPACE_SIZE
Q2_EFFECTIVE_STRATEGIES = Q2_EFFECTIVE_STRATEGY_COUNT
Q2_STATE_SPACE = Q2_STATE_SPACE_SIZE

PARTS = Q3_PARTS
PART_DATA = Q3_PART_NODES
PART_BY_ID = Q3_PART_DATA
SEMIS = Q3_SEMIS
SEMI_DATA = Q3_SEMI_NODES
SEMI_BY_ID = Q3_SEMI_DATA
PRODUCT = Q3_PRODUCT_DATA
PRODUCT_DATA = Q3_PRODUCT_DATA
NODES = Q3_NODE_DATA
NODE_DATA = Q3_NODE_DATA
PART_COSTS = Q3_PART_COSTS
SEMI_COSTS = Q3_SEMI_COSTS
PRODUCT_COSTS = Q3_PRODUCT_COSTS
ROOT_COSTS = Q3_PRODUCT_COSTS
PART_ROWS = Q3_PART_ROWS
SEMI_ROWS = Q3_SEMI_ROWS
PRODUCT_ROW = Q3_PRODUCT_ROW
PRIMARY_TOPOLOGY = Q3_PRIMARY_TOPOLOGY
ALTERNATIVE_TOPOLOGY = Q3_ALTERNATIVE_TOPOLOGY
ALT_TOPOLOGY = Q3_ALTERNATIVE_TOPOLOGY
Q3_MAIN_TOPOLOGY = Q3_PRIMARY_TOPOLOGY
Q3_ALT_TOPOLOGY = Q3_ALTERNATIVE_TOPOLOGY
PRIMARY_EDGES = Q3_PRIMARY_EDGES
ALTERNATIVE_EDGES = Q3_ALTERNATIVE_EDGES
Q3_POLICIES = Q3_POLICY_SPACE
Q3_STRATEGY_SPACE = Q3_POLICY_SPACE
Q3_STRATEGY_COUNT = Q3_EFFECTIVE_STRATEGY_COUNT
Q3_STATE_SPACE = Q3_STATE_SPACE_LIMIT
Q3_ROOT = Q3_ROOT_NODE_ID
Q3_ROOT_PARAMS = Q3_PRODUCT_DATA
Q3_NETWORK_NODES = Q3_NODE_DATA

Q4_ALPHA = Q4_FAMILY_ALPHA
Q4_ALPHA_FAMILY = Q4_FAMILY_ALPHA
Q4_FAMILY_ERROR = Q4_FAMILY_ALPHA
Q4_CONFIDENCE = Q4_CONFIDENCE_LEVEL
Q4_WIDTH = Q4_WIDTH_TARGET
Q4_CI_WIDTH_TARGET = Q4_WIDTH_TARGET
Q4_NMAX = Q4_N_MAX
Q4_N_GRID = Q4_SAMPLE_SIZE_GRID
Q4_SAMPLE_GRID = Q4_SAMPLE_SIZE_GRID
Q4_MC_REPS = Q4_MC_REPEATS
Q4_REPETITIONS = Q4_MC_REPEATS
Q4_REPS = Q4_MC_REPEATS
Q4_SEED = Q4_RANDOM_SEED
RANDOM_SEED = Q4_RANDOM_SEED
Q4_BONFERRONI_ALPHA_Q2 = Q4_ALPHA_Q2
Q4_BONFERRONI_ALPHA_Q3 = Q4_ALPHA_Q3
Q4_ALPHA_MARGINAL_Q2 = Q4_ALPHA_Q2
Q4_ALPHA_MARGINAL_Q3 = Q4_ALPHA_Q3
Q4_CP_ALPHA_Q2 = Q4_ALPHA_Q2
Q4_CP_ALPHA_Q3 = Q4_ALPHA_Q3
Q4_CP_CONFIDENCE_Q2 = 1 - Q4_ALPHA_Q2
Q4_CP_CONFIDENCE_Q3 = 1 - Q4_ALPHA_Q3
Q4_CONSISTENCY_THRESHOLD = Q4_CONSISTENCY_THRESHOLD
Q4_DECISION_THRESHOLD = Q4_CONSISTENCY_THRESHOLD
Q4_PRIOR_A = Q4_PRIOR_ALPHA
Q4_PRIOR_B = Q4_PRIOR_BETA
Q4_SCENARIO_REPEATS = Q4_MC_REPEATS
Q4_SCENARIO_SEED = Q4_RANDOM_SEED
Q4_SAMPLE_LABEL = Q4_SAMPLE_SOURCE

# Lower-case aliases are retained for modules using function-style names.
cashflow_abs_tol = CASHFLOW_ABS_TOL
value_iteration_tol = VALUE_ITERATION_TOL
value_iteration_max = VALUE_ITERATION_MAX
q1_numeric_tol = Q1_NUMERIC_TOL
q4_family_alpha = Q4_FAMILY_ALPHA
q4_width_target = Q4_WIDTH_TARGET
q4_n_max = Q4_N_MAX
q4_mc_repeats = Q4_MC_REPEATS
q4_seed = Q4_RANDOM_SEED
nominal_defect_rate = P0
alpha_reject = ALPHA_REJECT
accept_confidence = ACCEPT_CONFIDENCE
alternative_delta = Q1_ALTERNATIVE_DELTA
type_ii_error = Q1_TYPE_II_ERROR
q4_prior_alpha = Q4_PRIOR_ALPHA
q4_prior_beta = Q4_PRIOR_BETA

Q2_COST_TOLERANCE = Q2_CASHFLOW_TOLERANCE
Q2_VALUE_TOLERANCE = Q2_VALUE_TOLERANCE
Q3_CASHFLOW_TOLERANCE = CASHFLOW_ABS_TOL
Q3_VALUE_TOLERANCE = VALUE_ITERATION_TOL
Q4_CASHFLOW_TOLERANCE = CASHFLOW_ABS_TOL
Q4_VALUE_TOLERANCE = VALUE_ITERATION_TOL
Q1_SPRT_BOUNDARY_LOW = Q1_SPRT_LOWER_BOUNDARY
Q1_SPRT_BOUNDARY_HIGH = Q1_SPRT_UPPER_BOUNDARY
Q3_ROOT_FAILURE_INCLUDED = True
Q4_ACTUAL_SAMPLES_AVAILABLE = False
Q3_GRAPH_CONDITIONAL = True
Q4_SCENARIO_ANALYSIS = True