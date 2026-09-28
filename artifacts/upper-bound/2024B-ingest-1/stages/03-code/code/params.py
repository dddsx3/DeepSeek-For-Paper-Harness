"""阶段 3 代码统一参数层。

本文件只展开阶段 1 事实表与阶段 2 登记常数，不生成结果、不绘图。
问题一和问题四的备择率、边际错误率等派生量均由登记常数计算。
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from math import log
from typing import Dict, Iterable, Mapping, Tuple


# ---------------------------------------------------------------------------
# 问题一：精确二项检验与有限 SPRT
# ---------------------------------------------------------------------------

Q1_NOMINAL_DEFECT_RATE = 0.10
Q1_NOMINAL_RATE = Q1_NOMINAL_DEFECT_RATE
Q1_NOMINAL = Q1_NOMINAL_DEFECT_RATE
Q1_P0 = Q1_NOMINAL_DEFECT_RATE
P0 = Q1_NOMINAL_DEFECT_RATE

Q1_REJECT_FIRST_TYPE_ERROR = 0.05
Q1_REJECT_ALPHA = Q1_REJECT_FIRST_TYPE_ERROR
Q1_REJECT_SIGNIFICANCE = Q1_REJECT_FIRST_TYPE_ERROR
ALPHA_REJECT = Q1_REJECT_FIRST_TYPE_ERROR

Q1_ACCEPT_CONFIDENCE = 0.90
Q1_ACCEPT_LEVEL = Q1_ACCEPT_CONFIDENCE
Q1_ACCEPT_ALPHA = 1.0 - Q1_ACCEPT_CONFIDENCE
CONF_ACCEPT = Q1_ACCEPT_CONFIDENCE

Q1_ALTERNATIVE_GAP = 0.05
Q1_DESIGN_DELTA = Q1_ALTERNATIVE_GAP
Q1_ALTERNATIVE_RATE = Q1_NOMINAL_DEFECT_RATE + Q1_ALTERNATIVE_GAP
Q1_P_ALT = Q1_ALTERNATIVE_RATE

Q1_SECOND_ERROR = 0.10
Q1_SECOND_ERROR_BOUND = Q1_SECOND_ERROR
Q1_BETA = Q1_SECOND_ERROR
Q1_POWER_REQUIREMENT = 1.0 - Q1_SECOND_ERROR

Q1_DELTA_GRID = (0.02, 0.05, 0.10)
Q1_BETA_GRID = (0.05, 0.10, 0.20)
Q1_NUMERIC_TOL = 1e-12

Q1_SPRT_H1_ODDS = (1.0 - Q1_SECOND_ERROR) / Q1_REJECT_ALPHA
Q1_SPRT_H0_ODDS = Q1_SECOND_ERROR / (1.0 - Q1_REJECT_ALPHA)
Q1_SPRT_ACCEPT_BOUNDARY = log(Q1_SPRT_H1_ODDS)
Q1_SPRT_REJECT_BOUNDARY = log(Q1_SPRT_H0_ODDS)
Q1_SPRT_LOWER_BOUNDARY = Q1_SPRT_ACCEPT_BOUNDARY
Q1_SPRT_UPPER_BOUNDARY = Q1_SPRT_REJECT_BOUNDARY
Q1_SPRT_BOUNDARY_MODE = "wald_log_likelihood_ratio"
Q1_SPRT_TRUNCATION_MODE = "fixed_sample_threshold_at_truncation"
Q1_SAMPLE_SEARCH_LIMIT = None


# ---------------------------------------------------------------------------
# 问题二：两零件闭环现金流参数
# ---------------------------------------------------------------------------

Q2_STRATEGY_SPACE_SIZE = 16
Q2_MAX_STOCK_STATES = 9
Q2_CASHFLOW_ABS_TOL = 1e-6
Q2_VALUE_ITERATION_TOL = 1e-10
Q2_VALUE_ITERATION_MAX = 100000
Q2_SCRAP_RECOVERY_VALUE = 0.0
Q2_SENSITIVITY_GRID = (-0.20, -0.10, 0.0, 0.10, 0.20)
Q2_DECISION_ORDER = ("z1", "z2", "product_inspection", "disassembly")
Q2_DECISION_LABELS_ZH = ("零配件1检测", "零配件2检测", "成品检测", "不合格成品拆解")


@dataclass(frozen=True)
class Q2Case:
    """表 1 单种情形的扁平参数模式。"""

    case_id: int
    case_name: str
    p1: float
    price1: float
    test1: float
    p2: float
    price2: float
    test2: float
    pf: float
    assembly_cost: float
    test_product: float
    sale_price: float
    exchange_loss: float
    disassembly_cost: float

    @property
    def id(self) -> int:
        return self.case_id

    @property
    def name(self) -> str:
        return self.case_name

    @property
    def case_label(self) -> str:
        return f"情况{self.case_id}"

    @property
    def a1(self) -> float:
        return self.price1

    @property
    def t1(self) -> float:
        return self.test1

    @property
    def a2(self) -> float:
        return self.price2

    @property
    def t2(self) -> float:
        return self.test2

    @property
    def product_test_cost(self) -> float:
        return self.test_product

    @property
    def product_inspection_cost(self) -> float:
        return self.test_product

    @property
    def assembly(self) -> float:
        return self.assembly_cost

    @property
    def market_price(self) -> float:
        return self.sale_price

    @property
    def sale(self) -> float:
        return self.sale_price

    @property
    def r_market(self) -> float:
        return self.sale_price

    @property
    def replacement_loss(self) -> float:
        return self.exchange_loss

    @property
    def L_exchange(self) -> float:
        return self.exchange_loss

    @property
    def disassembly(self) -> float:
        return self.disassembly_cost

    @property
    def g_dis(self) -> float:
        return self.disassembly_cost

    @property
    def part1(self) -> Dict[str, float]:
        return {
            "defect_rate": self.p1,
            "purchase_price": self.price1,
            "inspection_cost": self.test1,
        }

    @property
    def part2(self) -> Dict[str, float]:
        return {
            "defect_rate": self.p2,
            "purchase_price": self.price2,
            "inspection_cost": self.test2,
        }

    @property
    def product(self) -> Dict[str, float]:
        return {
            "defect_rate": self.pf,
            "assembly_cost": self.assembly_cost,
            "inspection_cost": self.test_product,
        }

    def as_dict(self) -> Dict[str, object]:
        return asdict(self)


Q2_CASES: Tuple[Q2Case, ...] = (
    Q2Case(
        case_id=1,
        case_name="表1情况1",
        p1=0.10,
        price1=4.0,
        test1=2.0,
        p2=0.10,
        price2=18.0,
        test2=3.0,
        pf=0.10,
        assembly_cost=6.0,
        test_product=3.0,
        sale_price=56.0,
        exchange_loss=6.0,
        disassembly_cost=5.0,
    ),
    Q2Case(
        case_id=2,
        case_name="表1情况2",
        p1=0.20,
        price1=4.0,
        test1=2.0,
        p2=0.20,
        price2=18.0,
        test2=3.0,
        pf=0.20,
        assembly_cost=6.0,
        test_product=3.0,
        sale_price=56.0,
        exchange_loss=6.0,
        disassembly_cost=5.0,
    ),
    Q2Case(
        case_id=3,
        case_name="表1情况3",
        p1=0.10,
        price1=4.0,
        test1=2.0,
        p2=0.10,
        price2=18.0,
        test2=3.0,
        pf=0.10,
        assembly_cost=6.0,
        test_product=3.0,
        sale_price=56.0,
        exchange_loss=30.0,
        disassembly_cost=5.0,
    ),
    Q2Case(
        case_id=4,
        case_name="表1情况4",
        p1=0.20,
        price1=4.0,
        test1=1.0,
        p2=0.20,
        price2=18.0,
        test2=1.0,
        pf=0.20,
        assembly_cost=6.0,
        test_product=2.0,
        sale_price=56.0,
        exchange_loss=30.0,
        disassembly_cost=5.0,
    ),
    Q2Case(
        case_id=5,
        case_name="表1情况5",
        p1=0.10,
        price1=4.0,
        test1=8.0,
        p2=0.20,
        price2=18.0,
        test2=1.0,
        pf=0.10,
        assembly_cost=6.0,
        test_product=2.0,
        sale_price=56.0,
        exchange_loss=10.0,
        disassembly_cost=5.0,
    ),
    Q2Case(
        case_id=6,
        case_name="表1情况6",
        p1=0.05,
        price1=4.0,
        test1=2.0,
        p2=0.05,
        price2=18.0,
        test2=3.0,
        pf=0.05,
        assembly_cost=6.0,
        test_product=3.0,
        sale_price=56.0,
        exchange_loss=10.0,
        disassembly_cost=40.0,
    ),
)

Q2_CASE_BY_ID: Mapping[int, Q2Case] = {
    case.case_id: case for case in Q2_CASES
}


def q2_scenario_rates(case: Q2Case) -> Dict[str, float]:
    """返回仅用于问题四情景抽样中心的三个率，不作为点估计。"""

    return {
        "part1": case.p1,
        "part2": case.p2,
        "product": case.pf,
    }


# ---------------------------------------------------------------------------
# 问题三：一般 DAG 接口与 2 工序、8 零配件条件情景
# ---------------------------------------------------------------------------

Q3_MAX_REACHABLE_STATES = 531441
Q3_PRIMARY_EFFECTIVE_STRATEGY_COUNT = 65536
Q3_CASHFLOW_ABS_TOL = Q2_CASHFLOW_ABS_TOL
Q3_VALUE_ITERATION_TOL = Q2_VALUE_ITERATION_TOL
Q3_VALUE_ITERATION_MAX = Q2_VALUE_ITERATION_MAX
Q3_SENSITIVITY_GRID = Q2_SENSITIVITY_GRID
Q3_PARAMETER_COUNT = 12
Q3_ROOT_NODE_ID = "F"
Q3_ROOT_NAME = "成品"


@dataclass(frozen=True)
class Q3Part:
    part_id: int
    name: str
    defect_rate: float
    purchase_price: float
    inspection_cost: float

    @property
    def node_id(self) -> str:
        return f"P{self.part_id}"

    @property
    def a(self) -> float:
        return self.purchase_price

    @property
    def t(self) -> float:
        return self.inspection_cost


@dataclass(frozen=True)
class Q3ProcessNode:
    node_id: str
    name: str
    defect_rate: float
    assembly_cost: float
    inspection_cost: float
    disassembly_cost: float
    is_root: bool = False

    @property
    def a(self) -> float:
        return self.assembly_cost

    @property
    def t(self) -> float:
        return self.inspection_cost

    @property
    def g(self) -> float:
        return self.disassembly_cost


Q3_PARTS: Tuple[Q3Part, ...] = (
    Q3Part(1, "零配件1", 0.10, 2.0, 1.0),
    Q3Part(2, "零配件2", 0.10, 8.0, 1.0),
    Q3Part(3, "零配件3", 0.10, 12.0, 2.0),
    Q3Part(4, "零配件4", 0.10, 2.0, 1.0),
    Q3Part(5, "零配件5", 0.10, 8.0, 1.0),
    Q3Part(6, "零配件6", 0.10, 12.0, 2.0),
    Q3Part(7, "零配件7", 0.10, 8.0, 1.0),
    Q3Part(8, "零配件8", 0.10, 12.0, 2.0),
)

Q3_SEMI_NODES: Tuple[Q3ProcessNode, ...] = (
    Q3ProcessNode("S1", "半成品1", 0.10, 8.0, 4.0, 6.0),
    Q3ProcessNode("S2", "半成品2", 0.10, 8.0, 4.0, 6.0),
    Q3ProcessNode("S3", "半成品3", 0.10, 8.0, 4.0, 6.0),
)

Q3_PRODUCT_NODE = Q3ProcessNode(
    node_id="F",
    name="成品",
    defect_rate=0.10,
    assembly_cost=8.0,
    inspection_cost=6.0,
    disassembly_cost=10.0,
    is_root=True,
)

Q3_PRODUCT = Q3_PRODUCT_NODE
Q3_MARKET_PRICE = 200.0
Q3_EXCHANGE_LOSS = 40.0
Q3_R_MARKET = Q3_MARKET_PRICE
Q3_L_EXCHANGE = Q3_EXCHANGE_LOSS

Q3_PRIMARY_TOPOLOGY = {
    "半成品1": (1, 2, 3),
    "半成品2": (4, 5, 6),
    "半成品3": (7, 8),
    "成品": ("半成品1", "半成品2", "半成品3"),
}

Q3_ALTERNATIVE_TOPOLOGY = {
    "半成品1": (1, 2),
    "半成品2": (3, 4),
    "半成品3": (5, 6, 7, 8),
    "成品": ("半成品1", "半成品2", "半成品3"),
}

Q3_PRIMARY_PARENT_MAP: Mapping[str, Tuple[str, ...]] = {
    "S1": ("P1", "P2", "P3"),
    "S2": ("P4", "P5", "P6"),
    "S3": ("P7", "P8"),
    "F": ("S1", "S2", "S3"),
}

Q3_ALTERNATIVE_PARENT_MAP: Mapping[str, Tuple[str, ...]] = {
    "S1": ("P1", "P2"),
    "S2": ("P3", "P4"),
    "S3": ("P5", "P6", "P7", "P8"),
    "F": ("S1", "S2", "S3"),
}


def _parent_map_to_edge_list(
    parent_map: Mapping[str, Iterable[str]],
) -> Tuple[Tuple[str, str], ...]:
    """把 child -> parents 边表转换为 networkx 可用的 parent -> child 边表。"""

    return tuple(
        (parent, child)
        for child, parents in parent_map.items()
        for parent in parents
    )


Q3_PRIMARY_EDGE_LIST = _parent_map_to_edge_list(Q3_PRIMARY_PARENT_MAP)
Q3_ALTERNATIVE_EDGE_LIST = _parent_map_to_edge_list(Q3_ALTERNATIVE_PARENT_MAP)
Q3_PRIMARY_SCENARIO_EDGE_LIST = Q3_PRIMARY_EDGE_LIST
Q3_ALTERNATIVE_SCENARIO_EDGE_LIST = Q3_ALTERNATIVE_EDGE_LIST
Q3_SCENARIO_EDGE_LIST = Q3_PRIMARY_EDGE_LIST
Q3_CONDITIONAL_EDGE_LIST = Q3_PRIMARY_EDGE_LIST
Q3_DEFAULT_PARENT_MAP = Q3_PRIMARY_PARENT_MAP
Q3_SCENARIO_PARENT_MAPS = {
    "primary": Q3_PRIMARY_PARENT_MAP,
    "alternative": Q3_ALTERNATIVE_PARENT_MAP,
}

# 图 1 原件未进入阶段 1 事实表，故不得把条件边表冒充正式边表。
Q3_OFFICIAL_EDGE_LIST = None
Q3_OFFICIAL_PARENT_MAP = None
Q3_HAS_OFFICIAL_TOPOLOGY = False
Q3_TOPOLOGY_STATUS = "missing_source_figure_conditional_scenarios_only"
Q3_PRIMARY_SCENARIO_STATUS = "inferred_3_3_2_grouping_not_verified_figure"
Q3_ALTERNATIVE_SCENARIO_STATUS = "registered_2_2_4_topology_perturbation"

Q3_PART_BY_ID: Mapping[int, Q3Part] = {
    part.part_id: part for part in Q3_PARTS
}
Q3_PART_BY_NODE_ID: Mapping[str, Q3Part] = {
    part.node_id: part for part in Q3_PARTS
}
Q3_SEMI_BY_NODE_ID: Mapping[str, Q3ProcessNode] = {
    node.node_id: node for node in Q3_SEMI_NODES
}
Q3_PROCESS_NODES: Tuple[Q3ProcessNode, ...] = Q3_SEMI_NODES + (Q3_PRODUCT_NODE,)
Q3_NODE_IDS: Tuple[str, ...] = tuple(part.node_id for part in Q3_PARTS) + tuple(
    node.node_id for node in Q3_PROCESS_NODES
)
Q3_PARAMETER_NODE_IDS: Tuple[str, ...] = Q3_NODE_IDS
Q3_PARAMETER_COUNT = len(Q3_PARAMETER_NODE_IDS)

# 兼容常见的数据访问命名；它们仍是同一组事实参数。
Q3_PART_SPECS = Q3_PARTS
Q3_PART_DATA = Q3_PARTS
Q3_SEMI_DATA = Q3_SEMI_NODES
Q3_PRODUCT_DATA = Q3_PRODUCT_NODE
Q3_NODES_BY_ID: Mapping[str, object] = {
    **{part.node_id: part for part in Q3_PARTS},
    **{node.node_id: node for node in Q3_PROCESS_NODES},
}


# ---------------------------------------------------------------------------
# 问题四：情景抽样、CP 区间、Bonferroni 联合域与重优化
# ---------------------------------------------------------------------------

Q4_JOINT_CONFIDENCE_LEVEL = 0.95
Q4_FAMILY_ALPHA = 0.05
Q4_Q2_PARAMETER_COUNT = 3
Q4_Q3_PARAMETER_COUNT = 12
Q4_Q2_ALPHA_MARGINAL = Q4_FAMILY_ALPHA / Q4_Q2_PARAMETER_COUNT
Q4_Q3_ALPHA_MARGINAL = Q4_FAMILY_ALPHA / Q4_Q3_PARAMETER_COUNT
Q4_WIDTH_TARGET = 0.10
Q4_N_MAX = 1000
Q4_N_GRID = (50, 100, 200, 400, 800)
Q4_MC_REPEATS = 10000
Q4_RANDOM_SEED = 202409
Q4_JEFFREYS_ALPHA = 0.5
Q4_JEFFREYS_BETA = 0.5
Q4_DECISION_CONSISTENCY_THRESHOLD = 0.90
Q4_NUMERIC_TOL = Q1_NUMERIC_TOL
Q4_CASHFLOW_ABS_TOL = Q2_CASHFLOW_ABS_TOL

# 上游没有真实企业批次观测；以下空映射是显式数据缺口，不是零样本。
Q4_ACTUAL_SAMPLES_AVAILABLE = False
Q4_ACTUAL_SAMPLES: Mapping[str, Tuple[int, int]] = {}
Q4_OBSERVED_SAMPLES = Q4_ACTUAL_SAMPLES
Q4_SCENARIO_ONLY = not Q4_ACTUAL_SAMPLES_AVAILABLE
Q4_SCENARIO_GENERATION_ONLY = Q4_SCENARIO_ONLY
Q4_SAMPLE_SOURCE_STATUS = "scenario_only_no_observed_n_x"
Q4_SAMPLE_SIZE_CRITERION = "minimum_n_meeting_scenario_cp_width_target"
Q4_INTERVAL_METHOD = "clopper_pearson_exact_binomial"
Q4_JOINT_CONSTRUCTION = "bonferroni_rectangle"
Q4_RESAMPLING_DISTRIBUTION = "jeffreys_posterior_beta"
Q4_POINT_ESTIMATE_SOURCE = "scenario_binomial_counts_only"
Q4_ROBUST_POLICY_SOURCE = "worst_case_over_bonferroni_box"

Q3_SCENARIO_RATES: Mapping[str, float] = {
    **{part.node_id: part.defect_rate for part in Q3_PARTS},
    **{node.node_id: node.defect_rate for node in Q3_PROCESS_NODES},
}
Q4_Q3_SCENARIO_RATES = Q3_SCENARIO_RATES
Q4_Q3_RATE_VECTOR: Tuple[float, ...] = tuple(
    Q3_SCENARIO_RATES[node_id] for node_id in Q3_PARAMETER_NODE_IDS
)


def q4_node_label(node_id: str) -> str:
    """把规范化节点编号转换为论文可读标签。"""

    if node_id in Q3_PART_BY_NODE_ID:
        return Q3_PART_BY_NODE_ID[node_id].name
    if node_id in Q3_SEMI_BY_NODE_ID:
        return Q3_SEMI_BY_NODE_ID[node_id].name
    if node_id == Q3_ROOT_NODE_ID:
        return Q3_PRODUCT_NODE.name
    return node_id


# ---------------------------------------------------------------------------
# 跨问题统一容差与数据边界
# ---------------------------------------------------------------------------

CASHFLOW_ABS_TOL = Q2_CASHFLOW_ABS_TOL
VALUE_ITERATION_TOL = Q2_VALUE_ITERATION_TOL
VALUE_ITERATION_MAX = Q2_VALUE_ITERATION_MAX
NUMERIC_TOL = Q1_NUMERIC_TOL
ACTUAL_ASSEMBLY_FIGURE_AVAILABLE = False
ACTUAL_Q4_SAMPLES_AVAILABLE = Q4_ACTUAL_SAMPLES_AVAILABLE
SCENARIO_ANALYSIS_REQUIRED = True
RENDERING_ENABLED = False
RESULT_SOURCE_DECLARATION_ENABLED = False