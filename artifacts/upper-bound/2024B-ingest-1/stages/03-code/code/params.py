"""阶段 3 参数契约：题面事实、模型常数与情景边界。

本模块只保存上游事实表和建模登记值，不读取或生成图像。所有概率均为无量纲小数，金额单位均为元/件。
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# 文件与运行契约
# ---------------------------------------------------------------------------

SCRIPT_PATH = Path(__file__).resolve()
CODE_DIR = SCRIPT_PATH.parent
STAGE_DIR = CODE_DIR.parent
PROJECT_ROOT = STAGE_DIR.parents[1]

PROBLEM_FACTS_PATH = PROJECT_ROOT / "01-prob-analysis" / "PROBLEM_FACTS.json"
DECLARATION_PATH = PROJECT_ROOT / "02-modeling" / "DECLARATION.json"
MODELING_REPORT_PATH = PROJECT_ROOT / "02-modeling" / "MODELING_REPORT.md"

CODE_OUTPUT_FILE = "outputs.json"
CODE_SUMMARY_FILE = "run_summary.json"
PROBLEM1_RESULT_FILE = "problem1_results.json"
PROBLEM2_RESULT_FILE = "problem2_results.json"
PROBLEM3_RESULT_FILE = "problem3_results.json"
PROBLEM4_RESULT_FILE = "problem4_results.json"
Q4_SAMPLE_TRACE_FILE = "q4_scenario_samples.json"
Q4_POSTERIOR_TRACE_FILE = "q4_jeffreys_draws.json"

RESULT_PRECISION = 12
JSON_INDENT = 2


# ---------------------------------------------------------------------------
# 通用数值契约
# ---------------------------------------------------------------------------

Q1_NUMERIC_TOL = 1e-12
VALUE_ITERATION_TOL = 1e-10
VALUE_ITERATION_MAX_ITER = 100000
CASHFLOW_ABS_TOL = 1e-6
DEGENERATION_ABS_TOL = CASHFLOW_ABS_TOL
ROOT_NORMALIZATION_ABS_TOL = CASHFLOW_ABS_TOL

UNIT_PROFIT = "元/合格交付"
UNIT_MONEY = "元/件"
UNIT_RATE = "1"
UNIT_COUNT = "件"
UNIT_SAMPLE = "次"


# ---------------------------------------------------------------------------
# 问题 1：精确二项检验与有限 SPRT
# ---------------------------------------------------------------------------

Q1_NOMINAL_DEFECT_RATE = 0.10
Q1_REJECT_CONFIDENCE = 0.95
Q1_REJECT_ALPHA = 0.05
Q1_ACCEPT_CONFIDENCE = 0.90
Q1_ACCEPT_ALPHA = 0.10

# A-010：以下是建模设计常数，不冒充题面直接给定事实。
Q1_ALTERNATIVE_DELTA = 0.05
Q1_TYPE_II_ERROR = 0.10
Q1_ALTERNATIVE_DEFECT_RATE = Q1_NOMINAL_DEFECT_RATE + Q1_ALTERNATIVE_DELTA

Q1_DELTA_GRID = (0.02, 0.05, 0.10)
Q1_BETA_GRID = (0.05, 0.10, 0.20)
Q1_ALTERNATIVE_RATE_GRID = tuple(
    Q1_NOMINAL_DEFECT_RATE + delta for delta in Q1_DELTA_GRID
)

# 用于样本量—置信度序列；实际结论仍逐点执行精确二项枚举。
Q1_CONFIDENCE_GRID = (0.50, 0.60, 0.70, 0.80, 0.85, 0.90, 0.95, 0.975, 0.99)
Q1_REJECT_ALPHA_GRID = tuple(1.0 - confidence for confidence in Q1_CONFIDENCE_GRID)

# 资源保护只用于阻止无界循环；首个可行整数解仍由精确枚举产生。
Q1_MAX_EXACT_SAMPLE_SIZE = 10000
Q1_N_SEARCH_START = 1
Q1_SAMPLE_SIZE_SCAN_GRID = (25, 50, 75, 100, 125, 150, 175, 200, 250, 300, 400, 500)

Q1_SPRT_ENABLED = True
Q1_SPRT_MAX_STEPS_FACTOR = 1
Q1_SPRT_TRUNCATION_RULE = "accept_if_lower_boundary_else_reject"
Q1_SPRT_SELECTION_RULE = (
    "exact_constraints_and_expected_samples_not_greater_than_fixed_at_p0_and_palt"
)
Q1_FIXED_TIE_BREAK = "smallest_n_then_smallest_threshold"
Q1_REJECT_TIE_BREAK = "smallest_n_then_smallest_r"
Q1_ACCEPT_TIE_BREAK = "smallest_n_then_largest_c"
Q1_METHOD = "exact_binomial_enumeration"
Q1_SPRT_METHOD = "finite_likelihood_ratio_random_walk"

# 常用别名，兼容逐问模块。
P0 = Q1_NOMINAL_DEFECT_RATE
ALPHA_REJECT = Q1_REJECT_ALPHA
ALPHA_ACCEPT = Q1_ACCEPT_ALPHA
DELTA_GRID = Q1_DELTA_GRID
BETA_GRID = Q1_BETA_GRID
Q1_P0 = Q1_NOMINAL_DEFECT_RATE
Q1_P_ALT = Q1_ALTERNATIVE_DEFECT_RATE
Q1_NUMERIC_TOLERANCE = Q1_NUMERIC_TOL


# ---------------------------------------------------------------------------
# 问题 2：两零件、16 种静态策略
# ---------------------------------------------------------------------------

Q2_POLICY_BITS = ("Z1", "Z2", "C", "D")
Q2_POLICY_SPACE_SIZE = 16
Q2_INVENTORY_STATE_LIMIT = 9
Q2_PARAMETER_NODE_COUNT = 3
Q2_SENSITIVITY_FACTORS = (-0.20, -0.10, 0.0, 0.10, 0.20)
Q2_PLOT_FACTORS = (-0.40, -0.30, -0.20, -0.10, 0.0, 0.10, 0.20, 0.30, 0.40)
Q2_BREAKEVEN_FACTORS = Q2_PLOT_FACTORS
Q2_SCRAP_SALVAGE = 0.0

Q2_POLICY_LABELS = {
    (0, 0, 0, 0): "不检测零件、不检测成品、报废",
    (0, 0, 0, 1): "不检测零件、不检测成品、拆解",
    (0, 0, 1, 0): "不检测零件、检测成品、报废",
    (0, 0, 1, 1): "不检测零件、检测成品、拆解",
    (0, 1, 0, 0): "仅检测零件2、不检测成品、报废",
    (0, 1, 0, 1): "仅检测零件2、不检测成品、拆解",
    (0, 1, 1, 0): "仅检测零件2、检测成品、报废",
    (0, 1, 1, 1): "仅检测零件2、检测成品、拆解",
    (1, 0, 0, 0): "仅检测零件1、不检测成品、报废",
    (1, 0, 0, 1): "仅检测零件1、不检测成品、拆解",
    (1, 0, 1, 0): "仅检测零件1、检测成品、报废",
    (1, 0, 1, 1): "仅检测零件1、检测成品、拆解",
    (1, 1, 0, 0): "检测两零件、不检测成品、报废",
    (1, 1, 0, 1): "检测两零件、不检测成品、拆解",
    (1, 1, 1, 0): "检测两零件和成品、报废",
    (1, 1, 1, 1): "检测两零件和成品、拆解",
}


@dataclass(frozen=True)
class Q2Case:
    """表 1 扁平参数行。

    ``price*`` 和 ``test*`` 是零配件购买单价、检测成本的规范字段名。
    ``a*``、``t*``、``k_f`` 等只作为只读兼容别名，不复制计费。
    """

    case_id: int
    case_label: str
    p1: float
    price1: float
    test1: float
    p2: float
    price2: float
    test2: float
    pf: float
    assembly_cost: float
    product_test_cost: float
    sale_price: float
    exchange_loss: float
    disassembly_cost: float

    @property
    def id(self) -> int:
        return self.case_id

    @property
    def case_no(self) -> int:
        return self.case_id

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
    def k_f(self) -> float:
        return self.assembly_cost

    @property
    def kf(self) -> float:
        return self.assembly_cost

    @property
    def t_f(self) -> float:
        return self.product_test_cost

    @property
    def tf(self) -> float:
        return self.product_test_cost

    @property
    def r_market(self) -> float:
        return self.sale_price

    @property
    def l_exchange(self) -> float:
        return self.exchange_loss

    @property
    def g_dis(self) -> float:
        return self.disassembly_cost

    @property
    def part1(self) -> dict[str, float]:
        return {
            "p1": self.p1,
            "defect_rate": self.p1,
            "price1": self.price1,
            "test1": self.test1,
        }

    @property
    def part2(self) -> dict[str, float]:
        return {
            "p2": self.p2,
            "defect_rate": self.p2,
            "price2": self.price2,
            "test2": self.test2,
        }

    @property
    def product(self) -> dict[str, float]:
        return {
            "pf": self.pf,
            "defect_rate": self.pf,
            "assembly_cost": self.assembly_cost,
            "product_test_cost": self.product_test_cost,
            "sale_price": self.sale_price,
            "exchange_loss": self.exchange_loss,
            "disassembly_cost": self.disassembly_cost,
        }

    def to_dict(self) -> dict[str, Any]:
        return {
            "case_id": self.case_id,
            "case_label": self.case_label,
            "p1": self.p1,
            "price1": self.price1,
            "test1": self.test1,
            "p2": self.p2,
            "price2": self.price2,
            "test2": self.test2,
            "pf": self.pf,
            "assembly_cost": self.assembly_cost,
            "product_test_cost": self.product_test_cost,
            "sale_price": self.sale_price,
            "exchange_loss": self.exchange_loss,
            "disassembly_cost": self.disassembly_cost,
        }


Q2_CASES = (
    Q2Case(
        case_id=1,
        case_label="表1情况1",
        p1=0.10,
        price1=4.0,
        test1=2.0,
        p2=0.10,
        price2=18.0,
        test2=3.0,
        pf=0.10,
        assembly_cost=6.0,
        product_test_cost=3.0,
        sale_price=56.0,
        exchange_loss=6.0,
        disassembly_cost=5.0,
    ),
    Q2Case(
        case_id=2,
        case_label="表1情况2",
        p1=0.20,
        price1=4.0,
        test1=2.0,
        p2=0.20,
        price2=18.0,
        test2=3.0,
        pf=0.20,
        assembly_cost=6.0,
        product_test_cost=3.0,
        sale_price=56.0,
        exchange_loss=6.0,
        disassembly_cost=5.0,
    ),
    Q2Case(
        case_id=3,
        case_label="表1情况3",
        p1=0.10,
        price1=4.0,
        test1=2.0,
        p2=0.10,
        price2=18.0,
        test2=3.0,
        pf=0.10,
        assembly_cost=6.0,
        product_test_cost=3.0,
        sale_price=56.0,
        exchange_loss=30.0,
        disassembly_cost=5.0,
    ),
    Q2Case(
        case_id=4,
        case_label="表1情况4",
        p1=0.20,
        price1=4.0,
        test1=1.0,
        p2=0.20,
        price2=18.0,
        test2=1.0,
        pf=0.20,
        assembly_cost=6.0,
        product_test_cost=2.0,
        sale_price=56.0,
        exchange_loss=30.0,
        disassembly_cost=5.0,
    ),
    Q2Case(
        case_id=5,
        case_label="表1情况5",
        p1=0.10,
        price1=4.0,
        test1=8.0,
        p2=0.20,
        price2=18.0,
        test2=1.0,
        pf=0.10,
        assembly_cost=6.0,
        product_test_cost=2.0,
        sale_price=56.0,
        exchange_loss=10.0,
        disassembly_cost=5.0,
    ),
    Q2Case(
        case_id=6,
        case_label="表1情况6",
        p1=0.05,
        price1=4.0,
        test1=2.0,
        p2=0.05,
        price2=18.0,
        test2=3.0,
        pf=0.05,
        assembly_cost=6.0,
        product_test_cost=3.0,
        sale_price=56.0,
        exchange_loss=10.0,
        disassembly_cost=40.0,
    ),
)

Q2_CASES_BY_ID = {case.case_id: case for case in Q2_CASES}
Q2_CASE_TABLE = Q2_CASES
Q2_ALL_CASES = Q2_CASES
Q2_DEFAULT_CASE = Q2_CASES[0]
Q2_BASE_PARAMETERS = Q2_DEFAULT_CASE
Q2_CASE_COUNT = len(Q2_CASES)
Q2_PARAMETER_IDS = ("p1", "p2", "pf")
Q2_COST_ITEM_IDS = (
    "price1",
    "test1",
    "price2",
    "test2",
    "assembly_cost",
    "product_test_cost",
    "disassembly_cost",
    "exchange_loss",
)
Q2_REVENUE_ITEM_IDS = ("sale_price",)
Q2_REQUIRED_COST_ITEM_IDS = Q2_COST_ITEM_IDS
Q2_COST_TOLERANCE = CASHFLOW_ABS_TOL
Q2_BELLMAN_TOLERANCE = VALUE_ITERATION_TOL
Q2_METHOD = "absorbing_markov_reward_with_event_cash_ledger"


# ---------------------------------------------------------------------------
# 问题 3：一般 DAG 节点定义与图 1 条件拓扑
# ---------------------------------------------------------------------------

Q3_PROCESS_COUNT = 2
Q3_PART_COUNT = 8
Q3_SEMIFINISHED_COUNT = 3
Q3_ROOT_COUNT = 1
Q3_NODE_COUNT = 12
Q3_PARAMETER_NODE_COUNT = 12
Q3_LAYER_COUNTS = (8, 3, 1)
Q3_REACHABLE_STATE_LIMIT = 531441

Q3_PART1_ID = "part_1"
Q3_PART2_ID = "part_2"
Q3_SEMI1_ID = "semi_1"
Q3_SEMI2_ID = "semi_2"
Q3_SEMI3_ID = "semi_3"
Q3_ROOT_ID = "product"
Q3_PRODUCT_ID = Q3_ROOT_ID

Q3_PART_NODE_IDS = tuple(f"part_{index}" for index in range(1, 9))
Q3_SEMI_NODE_IDS = (Q3_SEMI1_ID, Q3_SEMI2_ID, Q3_SEMI3_ID)
Q3_ROOT_NODE_IDS = (Q3_ROOT_ID,)
Q3_NODE_IDS = Q3_PART_NODE_IDS + Q3_SEMI_NODE_IDS + Q3_ROOT_NODE_IDS

Q3_INSPECTION_DECISION_NODE_IDS = Q3_NODE_IDS
Q3_DISASSEMBLY_DECISION_NODE_IDS = Q3_SEMI_NODE_IDS + Q3_ROOT_NODE_IDS
Q3_DECISION_NODE_IDS = Q3_INSPECTION_DECISION_NODE_IDS
Q3_DECISION_BITS = len(Q3_INSPECTION_DECISION_NODE_IDS) + len(
    Q3_DISASSEMBLY_DECISION_NODE_IDS
)
Q3_POLICY_SPACE_SIZE = 2**Q3_DECISION_BITS
Q3_EFFECTIVE_POLICY_COUNT = 65536


@dataclass(frozen=True)
class Q3PartSpec:
    number: int
    node_id: str
    label: str
    defect_rate: float
    purchase_price: float
    inspection_cost: float
    layer: str = "part"
    parent_ids: tuple[str, ...] = ()
    assembly_cost: float = 0.0
    disassembly_cost: float = 0.0
    can_inspect: bool = True
    can_disassemble: bool = False
    is_root: bool = False

    @property
    def p(self) -> float:
        return self.defect_rate

    @property
    def price(self) -> float:
        return self.purchase_price

    @property
    def test_cost(self) -> float:
        return self.inspection_cost

    def to_dict(self) -> dict[str, Any]:
        return {
            "number": self.number,
            "node_id": self.node_id,
            "label": self.label,
            "layer": self.layer,
            "defect_rate": self.defect_rate,
            "purchase_price": self.purchase_price,
            "inspection_cost": self.inspection_cost,
            "assembly_cost": self.assembly_cost,
            "disassembly_cost": self.disassembly_cost,
            "parent_ids": list(self.parent_ids),
            "can_inspect": self.can_inspect,
            "can_disassemble": self.can_disassemble,
            "is_root": self.is_root,
        }


@dataclass(frozen=True)
class Q3AssemblySpec:
    number: int
    node_id: str
    label: str
    defect_rate: float
    assembly_cost: float
    inspection_cost: float
    disassembly_cost: float
    layer: str = "semifinished"
    parent_ids: tuple[str, ...] = ()
    purchase_price: float = 0.0
    can_inspect: bool = True
    can_disassemble: bool = True
    is_root: bool = False

    @property
    def p(self) -> float:
        return self.defect_rate

    @property
    def k_f(self) -> float:
        return self.assembly_cost

    @property
    def t_f(self) -> float:
        return self.inspection_cost

    @property
    def g_dis(self) -> float:
        return self.disassembly_cost

    def with_parents(self, parent_ids: tuple[str, ...]) -> "Q3AssemblySpec":
        return Q3AssemblySpec(
            number=self.number,
            node_id=self.node_id,
            label=self.label,
            defect_rate=self.defect_rate,
            assembly_cost=self.assembly_cost,
            inspection_cost=self.inspection_cost,
            disassembly_cost=self.disassembly_cost,
            layer=self.layer,
            parent_ids=parent_ids,
            purchase_price=self.purchase_price,
            can_inspect=self.can_inspect,
            can_disassemble=self.can_disassemble,
            is_root=self.is_root,
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "number": self.number,
            "node_id": self.node_id,
            "label": self.label,
            "layer": self.layer,
            "defect_rate": self.defect_rate,
            "purchase_price": self.purchase_price,
            "assembly_cost": self.assembly_cost,
            "inspection_cost": self.inspection_cost,
            "disassembly_cost": self.disassembly_cost,
            "parent_ids": list(self.parent_ids),
            "can_inspect": self.can_inspect,
            "can_disassemble": self.can_disassemble,
            "is_root": self.is_root,
        }


@dataclass(frozen=True)
class Q3RootSpec:
    node_id: str
    label: str
    defect_rate: float
    assembly_cost: float
    inspection_cost: float
    disassembly_cost: float
    sale_price: float
    exchange_loss: float
    layer: str = "root"
    parent_ids: tuple[str, ...] = ()
    purchase_price: float = 0.0
    can_inspect: bool = True
    can_disassemble: bool = True
    is_root: bool = True

    @property
    def p(self) -> float:
        return self.defect_rate

    @property
    def pf(self) -> float:
        return self.defect_rate

    @property
    def k_f(self) -> float:
        return self.assembly_cost

    @property
    def t_f(self) -> float:
        return self.inspection_cost

    @property
    def g_dis(self) -> float:
        return self.disassembly_cost

    @property
    def r_market(self) -> float:
        return self.sale_price

    @property
    def l_exchange(self) -> float:
        return self.exchange_loss

    def with_parents(self, parent_ids: tuple[str, ...]) -> "Q3RootSpec":
        return Q3RootSpec(
            node_id=self.node_id,
            label=self.label,
            defect_rate=self.defect_rate,
            assembly_cost=self.assembly_cost,
            inspection_cost=self.inspection_cost,
            disassembly_cost=self.disassembly_cost,
            sale_price=self.sale_price,
            exchange_loss=self.exchange_loss,
            layer=self.layer,
            parent_ids=parent_ids,
            purchase_price=self.purchase_price,
            can_inspect=self.can_inspect,
            can_disassemble=self.can_disassemble,
            is_root=self.is_root,
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "number": None,
            "node_id": self.node_id,
            "label": self.label,
            "layer": self.layer,
            "defect_rate": self.defect_rate,
            "purchase_price": self.purchase_price,
            "assembly_cost": self.assembly_cost,
            "inspection_cost": self.inspection_cost,
            "disassembly_cost": self.disassembly_cost,
            "sale_price": self.sale_price,
            "exchange_loss": self.exchange_loss,
            "parent_ids": list(self.parent_ids),
            "can_inspect": self.can_inspect,
            "can_disassemble": self.can_disassemble,
            "is_root": self.is_root,
        }


Q3_PART_SPECS = (
    Q3PartSpec(1, "part_1", "零配件1", 0.10, 2.0, 1.0),
    Q3PartSpec(2, "part_2", "零配件2", 0.10, 8.0, 1.0),
    Q3PartSpec(3, "part_3", "零配件3", 0.10, 12.0, 2.0),
    Q3PartSpec(4, "part_4", "零配件4", 0.10, 2.0, 1.0),
    Q3PartSpec(5, "part_5", "零配件5", 0.10, 8.0, 1.0),
    Q3PartSpec(6, "part_6", "零配件6", 0.10, 12.0, 2.0),
    Q3PartSpec(7, "part_7", "零配件7", 0.10, 8.0, 1.0),
    Q3PartSpec(8, "part_8", "零配件8", 0.10, 12.0, 2.0),
)

Q3_SEMI_SPECS = (
    Q3AssemblySpec(1, "semi_1", "半成品1", 0.10, 8.0, 4.0, 6.0),
    Q3AssemblySpec(2, "semi_2", "半成品2", 0.10, 8.0, 4.0, 6.0),
    Q3AssemblySpec(3, "semi_3", "半成品3", 0.10, 8.0, 4.0, 6.0),
)

Q3_ROOT_SPEC = Q3RootSpec(
    node_id=Q3_ROOT_ID,
    label="成品",
    defect_rate=0.10,
    assembly_cost=8.0,
    inspection_cost=6.0,
    disassembly_cost=10.0,
    sale_price=200.0,
    exchange_loss=40.0,
)

Q3_PRODUCT_SPEC = Q3_ROOT_SPEC
Q3_PARTS = Q3_PART_SPECS
Q3_SEMIS = Q3_SEMI_SPECS
Q3_PART_SPEC_MAP = {spec.node_id: spec for spec in Q3_PART_SPECS}
Q3_SEMI_SPEC_MAP = {spec.node_id: spec for spec in Q3_SEMI_SPECS}
Q3_ROOT_SPEC_MAP = {Q3_ROOT_SPEC.node_id: Q3_ROOT_SPEC}
Q3_PART_DATA = {spec.number: spec.to_dict() for spec in Q3_PART_SPECS}
Q3_SEMI_DATA = {spec.number: spec.to_dict() for spec in Q3_SEMI_SPECS}
Q3_PRODUCT_DATA = Q3_ROOT_SPEC.to_dict()
Q3_PART_ROWS = tuple(spec.to_dict() for spec in Q3_PART_SPECS)
Q3_SEMI_ROWS = tuple(spec.to_dict() for spec in Q3_SEMI_SPECS)

# F-T2-PRICE 的显式别名。
Q3_PRODUCT_DEFECT_RATE = 0.10
Q3_PRODUCT_ASSEMBLY_COST = 8.0
Q3_PRODUCT_INSPECTION_COST = 6.0
Q3_PRODUCT_DISASSEMBLY_COST = 10.0
Q3_SALE_PRICE = 200.0
Q3_EXCHANGE_LOSS = 40.0
Q3_SEMI_DEFECT_RATE = 0.10
Q3_PART_DEFECT_RATE = 0.10

# 图 1 原件未提供。None 是证据边界，不得用推断边表冒充正式图证。
Q3_FIG1_AVAILABLE = False
Q3_OFFICIAL_EDGE_LIST = None
Q3_OFFICIAL_TOPOLOGY = None
Q3_OFFICIAL_SOURCE_HASH = None
Q3_CAN_SOLVE_OFFICIAL_INSTANCE = False
Q3_SCENARIO_ONLY = True
Q3_TOPOLOGY_PROVENANCE = "inferred_from_table2_grouping"

# 边元组统一为 (parent_id, child_id)。
Q3_PRIMARY_EDGE_MAP = {
    "semi_1": ("part_1", "part_2", "part_3"),
    "semi_2": ("part_4", "part_5", "part_6"),
    "semi_3": ("part_7", "part_8"),
    "product": ("semi_1", "semi_2", "semi_3"),
}

Q3_ALTERNATIVE_EDGE_MAP = {
    "semi_1": ("part_1", "part_2"),
    "semi_2": ("part_3", "part_4"),
    "semi_3": ("part_5", "part_6", "part_7", "part_8"),
    "product": ("semi_1", "semi_2", "semi_3"),
}

Q3_PRIMARY_EDGE_LIST = (
    ("part_1", "semi_1"),
    ("part_2", "semi_1"),
    ("part_3", "semi_1"),
    ("part_4", "semi_2"),
    ("part_5", "semi_2"),
    ("part_6", "semi_2"),
    ("part_7", "semi_3"),
    ("part_8", "semi_3"),
    ("semi_1", "product"),
    ("semi_2", "product"),
    ("semi_3", "product"),
)

Q3_ALTERNATIVE_EDGE_LIST = (
    ("part_1", "semi_1"),
    ("part_2", "semi_1"),
    ("part_3", "semi_2"),
    ("part_4", "semi_2"),
    ("part_5", "semi_3"),
    ("part_6", "semi_3"),
    ("part_7", "semi_3"),
    ("part_8", "semi_3"),
    ("semi_1", "product"),
    ("semi_2", "product"),
    ("semi_3", "product"),
)

Q3_PRIMARY_CHILD_PARENT_LIST = tuple(
    (child, parent)
    for child, parents in Q3_PRIMARY_EDGE_MAP.items()
    for parent in parents
)
Q3_ALTERNATIVE_CHILD_PARENT_LIST = tuple(
    (child, parent)
    for child, parents in Q3_ALTERNATIVE_EDGE_MAP.items()
    for parent in parents
)

Q3_PRIMARY_TOPOLOGY = {
    "半成品1": [1, 2, 3],
    "半成品2": [4, 5, 6],
    "半成品3": [7, 8],
    "成品": ["半成品1", "半成品2", "半成品3"],
}
Q3_ALTERNATIVE_TOPOLOGY = {
    "半成品1": [1, 2],
    "半成品2": [3, 4],
    "半成品3": [5, 6, 7, 8],
    "成品": ["半成品1", "半成品2", "半成品3"],
}
Q3_SCENARIO_TOPOLOGY = Q3_PRIMARY_TOPOLOGY
Q3_SCENARIO_EDGE_MAP = Q3_PRIMARY_EDGE_MAP
Q3_SCENARIO_EDGE_LIST = Q3_PRIMARY_EDGE_LIST
Q3_MAIN_EDGE_MAP = Q3_PRIMARY_EDGE_MAP
Q3_MAIN_EDGE_LIST = Q3_PRIMARY_EDGE_LIST
Q3_SCENARIO_TOPOLOGIES = {
    "primary": {
        "edge_map": Q3_PRIMARY_EDGE_MAP,
        "edge_list": Q3_PRIMARY_EDGE_LIST,
        "topology": Q3_PRIMARY_TOPOLOGY,
        "conditional": True,
    },
    "alternative": {
        "edge_map": Q3_ALTERNATIVE_EDGE_MAP,
        "edge_list": Q3_ALTERNATIVE_EDGE_LIST,
        "topology": Q3_ALTERNATIVE_TOPOLOGY,
        "conditional": True,
    },
}

Q3_GENERAL_DAG_REQUIRED = True
Q3_GENERAL_ROOT_REQUIRED = True
Q3_COST_UNIT_RULE = "U_v_equals_C_v_divided_by_Q_v"
Q3_ROOT_FAILURE_FLOW_REQUIRED = True
Q3_METHOD = "general_dag_event_markov_reward"
Q3_SENSITIVITY_FACTORS = Q2_SENSITIVITY_FACTORS
Q3_PLOT_FACTORS = Q2_PLOT_FACTORS
Q3_DEGENERATION_POLICY_COUNT = 16


@dataclass(frozen=True)
class Q3NodeSpec:
    node_id: str
    label: str
    layer: str
    defect_rate: float
    purchase_price: float
    assembly_cost: float
    inspection_cost: float
    disassembly_cost: float
    parent_ids: tuple[str, ...]
    can_inspect: bool
    can_disassemble: bool
    is_root: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "node_id": self.node_id,
            "label": self.label,
            "layer": self.layer,
            "defect_rate": self.defect_rate,
            "purchase_price": self.purchase_price,
            "assembly_cost": self.assembly_cost,
            "inspection_cost": self.inspection_cost,
            "disassembly_cost": self.disassembly_cost,
            "parent_ids": list(self.parent_ids),
            "can_inspect": self.can_inspect,
            "can_disassemble": self.can_disassemble,
            "is_root": self.is_root,
        }


def build_q3_node_specs(
    parent_map: dict[str, tuple[str, ...]] | None = None,
) -> tuple[Q3NodeSpec, ...]:
    """把题面节点事实与条件边表合并为统一节点规格。"""

    if parent_map is None:
        parent_map = Q3_PRIMARY_EDGE_MAP

    nodes: list[Q3NodeSpec] = []
    for part in Q3_PART_SPECS:
        nodes.append(
            Q3NodeSpec(
                node_id=part.node_id,
                label=part.label,
                layer=part.layer,
                defect_rate=part.defect_rate,
                purchase_price=part.purchase_price,
                assembly_cost=part.assembly_cost,
                inspection_cost=part.inspection_cost,
                disassembly_cost=part.disassembly_cost,
                parent_ids=part.parent_ids,
                can_inspect=part.can_inspect,
                can_disassemble=part.can_disassemble,
                is_root=part.is_root,
            )
        )

    for semi in Q3_SEMI_SPECS:
        nodes.append(
            Q3NodeSpec(
                node_id=semi.node_id,
                label=semi.label,
                layer=semi.layer,
                defect_rate=semi.defect_rate,
                purchase_price=semi.purchase_price,
                assembly_cost=semi.assembly_cost,
                inspection_cost=semi.inspection_cost,
                disassembly_cost=semi.disassembly_cost,
                parent_ids=tuple(parent_map.get(semi.node_id, semi.parent_ids)),
                can_inspect=semi.can_inspect,
                can_disassemble=semi.can_disassemble,
                is_root=semi.is_root,
            )
        )

    nodes.append(
        Q3NodeSpec(
            node_id=Q3_ROOT_SPEC.node_id,
            label=Q3_ROOT_SPEC.label,
            layer=Q3_ROOT_SPEC.layer,
            defect_rate=Q3_ROOT_SPEC.defect_rate,
            purchase_price=Q3_ROOT_SPEC.purchase_price,
            assembly_cost=Q3_ROOT_SPEC.assembly_cost,
            inspection_cost=Q3_ROOT_SPEC.inspection_cost,
            disassembly_cost=Q3_ROOT_SPEC.disassembly_cost,
            parent_ids=tuple(parent_map.get(Q3_ROOT_SPEC.node_id, ())),
            can_inspect=Q3_ROOT_SPEC.can_inspect,
            can_disassemble=Q3_ROOT_SPEC.can_disassemble,
            is_root=Q3_ROOT_SPEC.is_root,
        )
    )
    return tuple(nodes)


Q3_PRIMARY_NODE_SPECS = build_q3_node_specs(Q3_PRIMARY_EDGE_MAP)
Q3_ALTERNATIVE_NODE_SPECS = build_q3_node_specs(Q3_ALTERNATIVE_EDGE_MAP)
Q3_NODE_SPECS = Q3_PRIMARY_NODE_SPECS
Q3_NODE_SPEC_MAP = {node.node_id: node for node in Q3_PRIMARY_NODE_SPECS}


# ---------------------------------------------------------------------------
# 问题 4：情景抽样、CP 区间、Bonferroni 域与重抽样
# ---------------------------------------------------------------------------

Q4_ACTUAL_SAMPLES_AVAILABLE = False
Q4_SCENARIO_ONLY = True
Q4_ACTUAL_SAMPLE_PATH = None
Q4_ACTUAL_SAMPLES: tuple[Any, ...] = ()
Q4_SAMPLE_SOURCE_LABEL = "scenario-only"
Q4_SAMPLE_SOURCE_NOTE = "无真实(n_v,x_v)，仅按登记情景率生成可审计二项样本"

Q4_FAMILY_CONFIDENCE = 0.95
Q4_FAMILY_ALPHA = 0.05
Q4_INTERVAL_WIDTH_TARGET = 0.10
Q4_N_MAX = 1000
Q4_SAMPLE_SIZE_GRID = (50, 100, 200, 400, 800)
Q4_N_SCANNING_GRID = Q4_SAMPLE_SIZE_GRID
Q4_SAMPLE_SIZE_SELECTION_RULE = "minimum_integer_n_meeting_cp_width_target"
Q4_MC_REPEATS = 10000
Q4_RANDOM_SEED = 202409
Q4_JEFFREYS_PRIOR_ALPHA = 0.5
Q4_JEFFREYS_PRIOR_BETA = 0.5
Q4_DECISION_CONSISTENCY_THRESHOLD = 0.90
Q4_POSTERIOR_DRAWS = Q4_MC_REPEATS

Q4_Q2_PARAMETER_COUNT = 3
Q4_Q3_PARAMETER_COUNT = 12
Q4_Q2_MARGINAL_ALPHA = 0.0166666666666667
Q4_Q3_MARGINAL_ALPHA = 0.00416666666666667
Q4_Q2_BONFERRONI_ALPHA = Q4_FAMILY_ALPHA / Q4_Q2_PARAMETER_COUNT
Q4_Q3_BONFERRONI_ALPHA = Q4_FAMILY_ALPHA / Q4_Q3_PARAMETER_COUNT
Q4_MARGINAL_ALPHA_Q2 = Q4_Q2_MARGINAL_ALPHA
Q4_MARGINAL_ALPHA_Q3 = Q4_Q3_MARGINAL_ALPHA
Q4_Q2_PARAMETER_IDS = Q2_PARAMETER_IDS
Q4_Q3_PARAMETER_IDS = Q3_NODE_IDS
Q4_CONFIDENCE_GRID = (0.50, 0.60, 0.70, 0.80, 0.85, 0.90, 0.95, 0.975, 0.99)
Q4_FAMILY_ALPHA_GRID = tuple(
    1.0 - confidence for confidence in Q4_CONFIDENCE_GRID
)
Q4_POSTERIOR_FAMILY = "Jeffreys"
Q4_RANDOM_GENERATOR = "numpy.random.Generator(PCG64)"
Q4_SAMPLE_GENERATOR = "numpy.random.Generator.binomial"
Q4_METHOD = "clopper_pearson_bonferroni_decision_reoptimization"
Q4_ROBUST_MODE = "minimum_over_bonferroni_box"
Q4_CONSISTENCY_REFERENCE = "scenario_nominal_reoptimized_policy"
Q4_CP_EDGE_TESTS = ((1, 0), (20, 7), (20, 20))
Q4_PROFIT_SCAN_FACTORS = Q2_PLOT_FACTORS


def q2_case_rate_map(case: Q2Case) -> dict[str, float]:
    return {"p1": case.p1, "p2": case.p2, "pf": case.pf}


Q4_Q2_NOMINAL_RATES = {
    case.case_id: q2_case_rate_map(case) for case in Q2_CASES
}
Q4_Q3_NOMINAL_RATES_PRIMARY = {
    node.node_id: node.defect_rate for node in Q3_PRIMARY_NODE_SPECS
}
Q4_Q3_NOMINAL_RATES_ALTERNATIVE = {
    node.node_id: node.defect_rate for node in Q3_ALTERNATIVE_NODE_SPECS
}
Q4_Q3_NOMINAL_RATES = Q4_Q3_NOMINAL_RATES_PRIMARY
Q4_Q2_CASES = Q2_CASES
Q4_Q3_SCENARIO = "primary"


# ---------------------------------------------------------------------------
# 上游事实锚点与题面缺失项
# ---------------------------------------------------------------------------

Q1_FACT_IDS = (
    "F-NOMINAL",
    "F-CONF-REJECT",
    "F-CONF-ACCEPT",
    "F-MECH-INSPECT-COST",
)
Q2_FACT_IDS = (
    "F-MECH-SYSTEM",
    "F-MECH-QUALIFIED",
    "F-MECH-DISASSEMBLE",
    "F-MECH-EXCHANGE",
    "F-APPENDIX-DEFECT-DEF",
    "F-APPENDIX-EXCHANGE-LOSS",
    "F-APPENDIX-UNIT",
    *(f"F-T1-C{index}" for index in range(1, 7)),
)
Q3_FACT_IDS = (
    "F-FIG1",
    "F-T2-SEMI",
    "F-T2-PRODUCT",
    "F-T2-PRICE",
    *(f"F-T2-PART-{index}" for index in range(1, 9)),
)
Q4_FACT_IDS = Q2_FACT_IDS + Q3_FACT_IDS

FACT_IDS = Q1_FACT_IDS + Q2_FACT_IDS + Q3_FACT_IDS
MISSING_EVIDENCE_IDS = ("DG-Q3-TOPOLOGY", "DG-Q4-SAMPLES")
SCENARIO_ONLY_ANCHORS = ("F-FIG1", "DG-Q3-TOPOLOGY", "DG-Q4-SAMPLES")