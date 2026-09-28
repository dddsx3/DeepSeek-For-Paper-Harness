"""阶段 03 的冻结参数注册表。

本文件只展开题面事实表与阶段 2 登记的模型常数，不在模块导入时求解问题。
金额单位均为元/件，概率与比率均无量纲。所有下游脚本应从本模块取参数，
不得在求解器中另写题面数值。
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Dict, Tuple


OUTPUT_JSON_FILENAME = "outputs.json"

# ---------------------------------------------------------------------------
# 问题一：精确二项检验与有限 SPRT
# ---------------------------------------------------------------------------

Q1_P0 = 0.10
Q1_REJECT_ALPHA = 0.05
Q1_ACCEPT_CONFIDENCE = 0.90
Q1_ACCEPT_ALPHA = 1.0 - Q1_ACCEPT_CONFIDENCE

# A-010 登记的设计风险参数；它们不是题面直接给定的事实。
Q1_DELTA = 0.05
Q1_BETA = 0.10
Q1_P_ALT = Q1_P0 + Q1_DELTA
Q1_REJECT_POWER = 1.0 - Q1_BETA

Q1_DELTA_GRID = (0.02, 0.05, 0.10)
Q1_BETA_GRID = (0.05, 0.10, 0.20)
Q1_P_ALT_GRID = tuple(Q1_P0 + delta for delta in Q1_DELTA_GRID)

Q1_NUMERIC_TOL = 1e-12

# 接收方案必须保留非空拒收域，避免 c=n 的恒接收退化方案。
Q1_ACCEPT_REQUIRE_C_LT_N = True
Q1_REJECT_REQUIRE_R_GE_1 = True

# 搜索顺序属于确定性实现规则：n 优先；拒收阈值从小到大；
# 接收阈值在满足 c<n 的候选中从大到小。
Q1_SEARCH_ORDER = "min_n_then_lexicographic_threshold"
Q1_REJECT_R_ORDER = "ascending"
Q1_ACCEPT_C_ORDER = "descending_with_c_lt_n"

Q1_SPRT_TRUNCATION_RULE = "truncate_at_fixed_plan_n"
Q1_SPRT_REQUIRE_EXACT_TAIL_RECHECK = True

# 常用别名，保留清晰含义的同时方便逐问模块调用。
Q1_NOMINAL_DEFECT_RATE = Q1_P0
Q1_ALPHA_REJECT = Q1_REJECT_ALPHA
Q1_CONFIDENCE_ACCEPT = Q1_ACCEPT_CONFIDENCE
Q1_ALTERNATIVE_DEFECT_RATE = Q1_P_ALT
Q1_SECOND_TYPE_ERROR = Q1_BETA


# ---------------------------------------------------------------------------
# 问题二：两零件闭环决策
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Q2Case:
    """表 1 的一行完整参数。"""

    case_id: int
    fact_id: str
    p1: float
    price1: float
    test1: float
    p2: float
    price2: float
    test2: float
    pf: float
    assembly_cost: float
    product_test_cost: float
    market_price: float
    exchange_loss: float
    disassembly_cost: float


Q2_CASES = (
    Q2Case(
        case_id=1,
        fact_id="F-T1-C1",
        p1=0.10,
        price1=4,
        test1=2,
        p2=0.10,
        price2=18,
        test2=3,
        pf=0.10,
        assembly_cost=6,
        product_test_cost=3,
        market_price=56,
        exchange_loss=6,
        disassembly_cost=5,
    ),
    Q2Case(
        case_id=2,
        fact_id="F-T1-C2",
        p1=0.20,
        price1=4,
        test1=2,
        p2=0.20,
        price2=18,
        test2=3,
        pf=0.20,
        assembly_cost=6,
        product_test_cost=3,
        market_price=56,
        exchange_loss=6,
        disassembly_cost=5,
    ),
    Q2Case(
        case_id=3,
        fact_id="F-T1-C3",
        p1=0.10,
        price1=4,
        test1=2,
        p2=0.10,
        price2=18,
        test2=3,
        pf=0.10,
        assembly_cost=6,
        product_test_cost=3,
        market_price=56,
        exchange_loss=30,
        disassembly_cost=5,
    ),
    Q2Case(
        case_id=4,
        fact_id="F-T1-C4",
        p1=0.20,
        price1=4,
        test1=1,
        p2=0.20,
        price2=18,
        test2=1,
        pf=0.20,
        assembly_cost=6,
        product_test_cost=2,
        market_price=56,
        exchange_loss=30,
        disassembly_cost=5,
    ),
    Q2Case(
        case_id=5,
        fact_id="F-T1-C5",
        p1=0.10,
        price1=4,
        test1=8,
        p2=0.20,
        price2=18,
        test2=1,
        pf=0.10,
        assembly_cost=6,
        product_test_cost=2,
        market_price=56,
        exchange_loss=10,
        disassembly_cost=5,
    ),
    Q2Case(
        case_id=6,
        fact_id="F-T1-C6",
        p1=0.05,
        price1=4,
        test1=2,
        p2=0.05,
        price2=18,
        test2=3,
        pf=0.05,
        assembly_cost=6,
        product_test_cost=3,
        market_price=56,
        exchange_loss=10,
        disassembly_cost=40,
    ),
)

Q2_CASES_BY_ID: Dict[int, Q2Case] = {
    case.case_id: case for case in Q2_CASES
}
Q2_CASES_BY_FACT_ID: Dict[str, Q2Case] = {
    case.fact_id: case for case in Q2_CASES
}
Q2_CASES_AS_DICTS: Tuple[dict, ...] = tuple(
    asdict(case) for case in Q2_CASES
)

Q2_CASE_COUNT = len(Q2_CASES)
Q2_PARAMETER_COUNT = 3
Q2_POLICY_SPACE_SIZE = 16
Q2_INVENTORY_STATE_LIMIT = 9
Q2_PART_STATES = ("empty", "good", "bad")
Q2_POLICY_FIELDS = ("Z1", "Z2", "C", "D")

SCRAP_RECOVERY_VALUE = 0.0
CASHFLOW_ABS_TOL = 1e-6
VALUE_ITERATION_TOL = 1e-10
VALUE_ITERATION_MAX_ITER = 100000

Q2_REQUIRE_ABSORPTION_PROBABILITY_ONE = True
Q2_MARKET_REVENUE_ONCE = True
Q2_REPLACEMENT_ASSEMBLY_ONCE = True
Q2_EXCHANGE_LOSS_EXCLUDES_REPLACEMENT_COST = True
Q2_SCRAP_RECOVERY_ZERO = True
Q2_RECOVERED_PART_STATE_PRESERVED = True


# ---------------------------------------------------------------------------
# 问题三：表 2 节点参数与条件拓扑
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Q3Part:
    node_id: str
    number: int
    fact_id: str
    defect_rate: float
    purchase_price: float
    inspection_cost: float


@dataclass(frozen=True)
class Q3AssemblyNode:
    node_id: str
    number: int
    fact_id: str
    conditional_defect_rate: float
    assembly_cost: float
    inspection_cost: float
    disassembly_cost: float


@dataclass(frozen=True)
class Q3Product:
    node_id: str
    fact_id: str
    conditional_defect_rate: float
    assembly_cost: float
    inspection_cost: float
    disassembly_cost: float
    market_price: float
    exchange_loss: float


Q3_PARTS = (
    Q3Part("零配件1", 1, "F-T2-PART-1", 0.10, 2, 1),
    Q3Part("零配件2", 2, "F-T2-PART-2", 0.10, 8, 1),
    Q3Part("零配件3", 3, "F-T2-PART-3", 0.10, 12, 2),
    Q3Part("零配件4", 4, "F-T2-PART-4", 0.10, 2, 1),
    Q3Part("零配件5", 5, "F-T2-PART-5", 0.10, 8, 1),
    Q3Part("零配件6", 6, "F-T2-PART-6", 0.10, 12, 2),
    Q3Part("零配件7", 7, "F-T2-PART-7", 0.10, 8, 1),
    Q3Part("零配件8", 8, "F-T2-PART-8", 0.10, 12, 2),
)

Q3_SEMIS = (
    Q3AssemblyNode(
        "半成品1", 1, "F-T2-SEMI", 0.10, 8, 4, 6
    ),
    Q3AssemblyNode(
        "半成品2", 2, "F-T2-SEMI", 0.10, 8, 4, 6
    ),
    Q3AssemblyNode(
        "半成品3", 3, "F-T2-SEMI", 0.10, 8, 4, 6
    ),
)

Q3_PRODUCT = Q3Product(
    node_id="成品",
    fact_id="F-T2-PRODUCT/F-T2-PRICE",
    conditional_defect_rate=0.10,
    assembly_cost=8,
    inspection_cost=6,
    disassembly_cost=10,
    market_price=200,
    exchange_loss=40,
)

# 题面事实只确认二道工序、八个零配件，没有给出可校验的父子边集。
# 因此不存在可用于最终题图答案的正式拓扑；不得把下列情景命名为 primary。
Q3_GRAPH_FACT_ID = "F-FIG1"
Q3_OFFICIAL_EDGE_LIST = None
Q3_OFFICIAL_TOPOLOGY = None
Q3_GRAPH_AVAILABLE = False
Q3_OFFICIAL_RESULT_STATUS = "BLOCKED_MISSING_ORIGINAL_EDGE_LIST"
Q3_REQUIRE_OFFICIAL_EDGE_LIST_FOR_FINAL_ANSWER = True
Q3_ALLOW_CONDITIONAL_SCENARIOS = True
Q3_CONDITIONAL_RESULT_STATUS = "SCENARIO_ONLY_NOT_FIG1_INSTANCE"
Q3_GRAPH_BLOCK_REASON = (
    "题面可见事实未给出图1的父节点边集；3/3/2与2/2/4仅为条件情景"
)

# 条件情景一：阶段 2 根据表 2 行分组登记的推断边表。
Q3_SCENARIO_TOPOLOGY_332 = {
    "scenario_id": "inferred_3_3_2",
    "official_fig1_topology": False,
    "semi_parents": {
        "半成品1": ("零配件1", "零配件2", "零配件3"),
        "半成品2": ("零配件4", "零配件5", "零配件6"),
        "半成品3": ("零配件7", "零配件8"),
    },
    "product_parents": ("半成品1", "半成品2", "半成品3"),
}

# 条件情景二：父节点输入数不同，用于结构扰动对照。
Q3_SCENARIO_TOPOLOGY_224 = {
    "scenario_id": "alternative_2_2_4",
    "official_fig1_topology": False,
    "semi_parents": {
        "半成品1": ("零配件1", "零配件2"),
        "半成品2": ("零配件3", "零配件4"),
        "半成品3": ("零配件5", "零配件6", "零配件7", "零配件8"),
    },
    "product_parents": ("半成品1", "半成品2", "半成品3"),
}

Q3_SCENARIO_TOPOLOGIES = (
    Q3_SCENARIO_TOPOLOGY_332,
    Q3_SCENARIO_TOPOLOGY_224,
)
Q3_SCENARIO_TOPOLOGY_BY_ID = {
    topology["scenario_id"]: topology
    for topology in Q3_SCENARIO_TOPOLOGIES
}

# 每个零配件只有一个检测决策；每个半成品和根节点各有检测、拆解两个决策。
Q3_POLICY_VARIABLE_COUNT = (
    len(Q3_PARTS) + 2 * len(Q3_SEMIS) + 2
)
Q3_PARAMETER_COUNT = (
    len(Q3_PARTS) + len(Q3_SEMIS) + 1
)
Q3_SCENARIO_POLICY_COUNT = 65536
Q3_REACHABLE_INVENTORY_STATE_LIMIT = 531441

Q3_ROOT_ALL_FAILURE_PATHS_REQUIRED = True
Q3_ROOT_UNDETECTED_RETURN_REQUIRED = True
Q3_ROOT_DISASSEMBLY_RECOVERY_REQUIRED = True
Q3_U_MUST_EQUAL_C_OVER_Q = True
Q3_Q_ZERO_MEANS_INFEASIBLE = True
Q3_PARENT_USES_LAUNCH_COST_NOT_UNIT_COST = True
Q3_TOPOLOGY_GAP_REQUIRE_BLOCKING_STATUS = True


def expected_q3_policy_length(semi_count: int) -> int:
    """返回给定半成品数量下的完整策略向量长度。"""

    return len(Q3_PARTS) + 2 * semi_count + 2


def get_q3_scenario_topology(scenario_id: str) -> dict:
    """只按条件情景标识取边表，不允许回退为所谓正式主拓扑。"""

    try:
        return Q3_SCENARIO_TOPOLOGY_BY_ID[scenario_id]
    except KeyError as exc:
        raise KeyError(
            f"未登记的 Q3 条件情景：{scenario_id}"
        ) from exc


def get_q3_official_topology() -> None:
    """正式边表缺失时显式阻断，禁止以条件情景替代。"""

    if Q3_OFFICIAL_EDGE_LIST is None:
        raise ValueError(Q3_GRAPH_BLOCK_REASON)
    return Q3_OFFICIAL_EDGE_LIST


def q3_parameter_centers() -> Dict[str, float]:
    """返回表 2 条件次品率情景中心；它们不是 Q4 的抽样点估计。"""

    centers = {part.node_id: part.defect_rate for part in Q3_PARTS}
    centers.update(
        {semi.node_id: semi.conditional_defect_rate for semi in Q3_SEMIS}
    )
    centers[Q3_PRODUCT.node_id] = Q3_PRODUCT.conditional_defect_rate
    return centers


# ---------------------------------------------------------------------------
# 问题四：情景观测、精确区间与决策重解
# ---------------------------------------------------------------------------

Q4_JOINT_CONFIDENCE = 0.95
Q4_FAMILY_ALPHA = 0.05
Q4_WIDTH_TARGET = 0.10
Q4_N_MAX = 1000
Q4_N_SCAN_GRID = (50, 100, 200, 400, 800)
Q4_MC_REPETITIONS = 10000
Q4_RNG_SEED = 202409
Q4_JEFFREYS_ALPHA = 0.5
Q4_JEFFREYS_BETA = 0.5
Q4_DECISION_CONSISTENCY_THRESHOLD = 0.90

Q4_Q2_MARGINAL_ALPHA = Q4_FAMILY_ALPHA / Q2_PARAMETER_COUNT
Q4_Q3_MARGINAL_ALPHA = Q4_FAMILY_ALPHA / Q3_PARAMETER_COUNT

# 兼容阶段 2 中按问题命名的登记名称。
Q4_BONFERRONI_ALPHA_Q2 = Q4_Q2_MARGINAL_ALPHA
Q4_BONFERRONI_ALPHA_Q3 = Q4_Q3_MARGINAL_ALPHA
Q4_WIDTH_SCAN_GRID = Q4_N_SCAN_GRID
Q4_SAMPLE_SIZE_MAX = Q4_N_MAX
Q4_REPETITIONS = Q4_MC_REPETITIONS
Q4_SEED = Q4_RNG_SEED

Q4_ACTUAL_SAMPLES_AVAILABLE = False
Q4_OBSERVATION_STATUS = "AUDITABLE_SCENARIO_ONLY_NO_REAL_NV_XV"
Q4_SCENARIO_CENTER_IS_NOT_POINT_ESTIMATE = True
Q4_POINT_ESTIMATE_SOURCE = "generated_scenario_x_over_n"
Q4_REOPTIMIZATION_SOURCE = "Jeffreys_posterior_draws_conditioned_on_scenario_x"
Q4_REQUIRE_STORE_NV_XV = True
Q4_REQUIRE_REOPTIMIZATION_EACH_DRAW = True
Q4_WIDTH_METHOD = "expected_clopper_pearson_width_at_scenario_rate"
Q4_CP_BOUNDARY_X_ZERO = True
Q4_CP_BOUNDARY_X_EQUAL_N = True
Q4_BONFERRONI_BOX_REQUIRED = True
Q4_Q3_MODE = "CONDITIONAL_TOPOLOGY_SCENARIOS_ONLY"

# ---------------------------------------------------------------------------
# 公共灵敏度与验收参数
# ---------------------------------------------------------------------------

RELATIVE_SENSITIVITY_GRID = (-0.20, -0.10, 0.0, 0.10, 0.20)
CASHFLOW_BELLMAN_RESIDUAL_TOL = VALUE_ITERATION_TOL
Q1_EXACT_ENUMERATION_REQUIRED = True
Q3_DEGENERATION_POLICY_COUNT = Q2_POLICY_SPACE_SIZE
Q3_DEGENERATION_MAX_TOL = CASHFLOW_ABS_TOL
Q4_CP_ENDPOINT_TOL = Q1_NUMERIC_TOL


def validate_parameter_registry() -> bool:
    """在求解前阻断越界参数、内部不一致和缺失的正式图证据。"""

    probabilities = (
        Q1_P0,
        Q1_REJECT_ALPHA,
        Q1_ACCEPT_CONFIDENCE,
        Q1_P_ALT,
        Q1_BETA,
    )
    if any(not 0.0 <= value <= 1.0 for value in probabilities):
        raise ValueError("Q1 参数超出概率域")

    for case in Q2_CASES:
        case_probabilities = (case.p1, case.p2, case.pf)
        if any(not 0.0 <= value <= 1.0 for value in case_probabilities):
            raise ValueError(f"{case.fact_id} 的概率超出概率域")
        case_amounts = (
            case.price1,
            case.test1,
            case.price2,
            case.test2,
            case.assembly_cost,
            case.product_test_cost,
            case.market_price,
            case.exchange_loss,
            case.disassembly_cost,
        )
        if any(value < 0.0 for value in case_amounts):
            raise ValueError(f"{case.fact_id} 含负金额")

    q3_probabilities = tuple(
        [part.defect_rate for part in Q3_PARTS]
        + [semi.conditional_defect_rate for semi in Q3_SEMIS]
        + [Q3_PRODUCT.conditional_defect_rate]
    )
    if any(not 0.0 <= value <= 1.0 for value in q3_probabilities):
        raise ValueError("Q3 参数超出概率域")

    if expected_q3_policy_length(len(Q3_SEMIS)) != Q3_POLICY_VARIABLE_COUNT:
        raise ValueError("Q3 策略向量长度与节点结构不一致")
    if (1 << Q3_POLICY_VARIABLE_COUNT) != Q3_SCENARIO_POLICY_COUNT:
        raise ValueError("Q3 条件情景策略数与登记常数不一致")
    if Q3_PARAMETER_COUNT != len(q3_probabilities):
        raise ValueError("Q3 参数节点数不一致")
    if 3 ** Q3_PARAMETER_COUNT != Q3_REACHABLE_INVENTORY_STATE_LIMIT:
        raise ValueError("Q3 可达库存状态上限与登记常数不一致")

    if Q4_Q2_MARGINAL_ALPHA * Q2_PARAMETER_COUNT > Q4_FAMILY_ALPHA:
        raise ValueError("Q4-Q2 Bonferroni 边际错误率分配超限")
    if Q4_Q3_MARGINAL_ALPHA * Q3_PARAMETER_COUNT > Q4_FAMILY_ALPHA:
        raise ValueError("Q4-Q3 Bonferroni 边际错误率分配超限")

    if Q3_GRAPH_AVAILABLE and Q3_OFFICIAL_EDGE_LIST is None:
        raise ValueError("声明图可用但没有正式边表")
    if not Q3_GRAPH_AVAILABLE and Q3_OFFICIAL_EDGE_LIST is not None:
        raise ValueError("正式边表状态与图缺口标记不一致")

    return True


validate_parameter_registry()