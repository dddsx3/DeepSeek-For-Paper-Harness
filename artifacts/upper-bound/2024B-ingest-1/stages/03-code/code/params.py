"""Canonical facts and registered modelling constants for Stage 3.

All numerical values in this module come from ``PROBLEM_FACTS.json`` or the
registered ``model_constants`` in ``DECLARATION.json``.  Solver modules should
import their parameters from this file instead of embedding numerical inputs.

Q2 case dictionaries use the symbols from the modelling report:
``p1, p2, pf`` are defect probabilities; ``a1, a2, t1, t2`` are part purchase
and inspection costs; ``kf, tf`` are assembly and final-inspection costs; and
``r_market, L_exchange, g_dis`` are selling price, exchange loss and
 disassembly cost.

Q3 node dictionaries use ``p`` for the conditional defect probability,
``a`` for purchase cost, ``t`` for inspection cost, ``k`` for assembly cost and
``g`` for disassembly cost.  A ``None`` cost means that the event does not occur
at that node.
"""

from __future__ import annotations


# ---------------------------------------------------------------------------
# Problem 1: exact binomial designs
# ---------------------------------------------------------------------------

Q1_NOMINAL_RATE = 0.10
Q1_REJECT_CONFIDENCE = 0.95
Q1_ACCEPT_CONFIDENCE = 0.90
Q1_ALTERNATIVE_DELTA = 0.05
Q1_TYPE_II_ERROR = 0.10
Q1_DELTA_GRID = (0.02, 0.05, 0.10)
Q1_BETA_GRID = (0.05, 0.10, 0.20)
Q1_NUMERIC_TOL = 1e-12

Q1_REJECT_ALPHA = 1.0 - Q1_REJECT_CONFIDENCE
Q1_ACCEPT_ALPHA = 1.0 - Q1_ACCEPT_CONFIDENCE
Q1_ALTERNATIVE_RATE = Q1_NOMINAL_RATE + Q1_ALTERNATIVE_DELTA
Q1_OPERATIONAL_ALTERNATIVE_RATE = Q1_ALTERNATIVE_RATE

Q1_CASE95_REPORTED_BASIS = "registered_operational_power_design"
Q1_CASE95_NOMINAL_ONLY_BASIS = "nominal_tail_constraint_only"
Q1_CASE95_OPERATIONAL_CONSTRAINTS = {
    "basis": Q1_CASE95_REPORTED_BASIS,
    "p0": Q1_NOMINAL_RATE,
    "alpha": Q1_REJECT_ALPHA,
    "delta": Q1_ALTERNATIVE_DELTA,
    "p_alt": Q1_ALTERNATIVE_RATE,
    "beta": Q1_TYPE_II_ERROR,
    "minimum_power": 1.0 - Q1_TYPE_II_ERROR,
}
Q1_CASE95_NOMINAL_ONLY_CONSTRAINTS = {
    "basis": Q1_CASE95_NOMINAL_ONLY_BASIS,
    "p0": Q1_NOMINAL_RATE,
    "alpha": Q1_REJECT_ALPHA,
}
Q1_CASE90_CONSTRAINTS = {
    "p0": Q1_NOMINAL_RATE,
    "acceptance_confidence": Q1_ACCEPT_CONFIDENCE,
    "minimum_acceptance_probability": Q1_ACCEPT_CONFIDENCE,
}
Q1_METHOD = "exact_binomial_integer_enumeration"
Q1_SPRT_METHOD = "finite_likelihood_ratio_random_walk"
Q1_SPRT_ALLOWED = True
Q1_UNBOUNDED_SPRT_ALLOWED = False

# Common aliases used by solver modules.
P0 = Q1_NOMINAL_RATE
ALPHA_REJECT = Q1_REJECT_ALPHA
ALPHA_ACCEPT = Q1_ACCEPT_ALPHA
CONF_ACCEPT = Q1_ACCEPT_CONFIDENCE
Q1_P0 = Q1_NOMINAL_RATE
Q1_P_ALT = Q1_ALTERNATIVE_RATE
Q1_DELTA = Q1_ALTERNATIVE_DELTA
Q1_BETA = Q1_TYPE_II_ERROR
Q1_SENSITIVITY_DELTA_GRID = Q1_DELTA_GRID
Q1_SENSITIVITY_BETA_GRID = Q1_BETA_GRID
Q1_EXACT_ENUMERATION_TOL = Q1_NUMERIC_TOL


# ---------------------------------------------------------------------------
# Problem 2: Table 1 and decision-space constants
# ---------------------------------------------------------------------------

Q2_STRATEGY_SPACE_SIZE = 16
Q2_INVENTORY_STATE_LIMIT = 9
CASHFLOW_ABS_TOL = 1e-6
VALUE_ITERATION_TOL = 1e-10
VALUE_ITERATION_MAX_ITERATIONS = 100000
SCRAP_SALVAGE_VALUE = 0

Q2_PART_STATES = ("empty", "good", "bad")
Q2_POLICY_SPACE = tuple(
    (z1, z2, final_test, disassemble)
    for z1 in range(2)
    for z2 in range(2)
    for final_test in range(2)
    for disassemble in range(2)
)

Q2_CASES = (
    {
        "case_id": 1,
        "p1": 0.10,
        "a1": 4,
        "t1": 2,
        "p2": 0.10,
        "a2": 18,
        "t2": 3,
        "pf": 0.10,
        "kf": 6,
        "tf": 3,
        "r_market": 56,
        "L_exchange": 6,
        "g_dis": 5,
    },
    {
        "case_id": 2,
        "p1": 0.20,
        "a1": 4,
        "t1": 2,
        "p2": 0.20,
        "a2": 18,
        "t2": 3,
        "pf": 0.20,
        "kf": 6,
        "tf": 3,
        "r_market": 56,
        "L_exchange": 6,
        "g_dis": 5,
    },
    {
        "case_id": 3,
        "p1": 0.10,
        "a1": 4,
        "t1": 2,
        "p2": 0.10,
        "a2": 18,
        "t2": 3,
        "pf": 0.10,
        "kf": 6,
        "tf": 3,
        "r_market": 56,
        "L_exchange": 30,
        "g_dis": 5,
    },
    {
        "case_id": 4,
        "p1": 0.20,
        "a1": 4,
        "t1": 1,
        "p2": 0.20,
        "a2": 18,
        "t2": 1,
        "pf": 0.20,
        "kf": 6,
        "tf": 2,
        "r_market": 56,
        "L_exchange": 30,
        "g_dis": 5,
    },
    {
        "case_id": 5,
        "p1": 0.10,
        "a1": 4,
        "t1": 8,
        "p2": 0.20,
        "a2": 18,
        "t2": 1,
        "pf": 0.10,
        "kf": 6,
        "tf": 2,
        "r_market": 56,
        "L_exchange": 10,
        "g_dis": 5,
    },
    {
        "case_id": 6,
        "p1": 0.05,
        "a1": 4,
        "t1": 2,
        "p2": 0.05,
        "a2": 18,
        "t2": 3,
        "pf": 0.05,
        "kf": 6,
        "tf": 3,
        "r_market": 56,
        "L_exchange": 10,
        "g_dis": 40,
    },
)

Q2_CASE1 = Q2_CASES[0]
Q2_CASE2 = Q2_CASES[1]
Q2_CASE3 = Q2_CASES[2]
Q2_CASE4 = Q2_CASES[3]
Q2_CASE5 = Q2_CASES[4]
Q2_CASE6 = Q2_CASES[5]
Q2_TABLE1_CASES = Q2_CASES
Q2_CASE_PARAMS = Q2_CASES
Q2_POLICY_COUNT = Q2_STRATEGY_SPACE_SIZE
Q2_STATE_LIMIT = Q2_INVENTORY_STATE_LIMIT
Q2_CASHFLOW_ABS_TOL = CASHFLOW_ABS_TOL
Q2_VALUE_TOL = VALUE_ITERATION_TOL
Q2_VALUE_MAX_ITERATIONS = VALUE_ITERATION_MAX_ITERATIONS
REQUIRE_ABSORPTION = True
REJECT_ZERO_OUTPUT_STRATEGIES = True
MARKET_REVENUE_ONCE_PER_DELIVERY = True
REPLACEMENT_PRODUCTION_COSTS_ARE_ADDITIONAL = True


# ---------------------------------------------------------------------------
# Problem 3: Table 2, registered primary topology and alternative topology
# ---------------------------------------------------------------------------

Q3_PART_SPECS = (
    {"node": "part1", "part_id": 1, "p": 0.10, "a": 2, "t": 1},
    {"node": "part2", "part_id": 2, "p": 0.10, "a": 8, "t": 1},
    {"node": "part3", "part_id": 3, "p": 0.10, "a": 12, "t": 2},
    {"node": "part4", "part_id": 4, "p": 0.10, "a": 2, "t": 1},
    {"node": "part5", "part_id": 5, "p": 0.10, "a": 8, "t": 1},
    {"node": "part6", "part_id": 6, "p": 0.10, "a": 12, "t": 2},
    {"node": "part7", "part_id": 7, "p": 0.10, "a": 8, "t": 1},
    {"node": "part8", "part_id": 8, "p": 0.10, "a": 12, "t": 2},
)

Q3_SEMI_SPECS = (
    {"node": "semi1", "semi_id": 1, "p": 0.10, "k": 8, "t": 4, "g": 6},
    {"node": "semi2", "semi_id": 2, "p": 0.10, "k": 8, "t": 4, "g": 6},
    {"node": "semi3", "semi_id": 3, "p": 0.10, "k": 8, "t": 4, "g": 6},
)

Q3_PRODUCT_SPEC = {
    "node": "product",
    "p": 0.10,
    "k": 8,
    "t": 6,
    "g": 10,
    "r_market": 200,
    "L_exchange": 40,
}

Q3_NODE_SPECS = {
    spec["node"]: spec
    for spec in Q3_PART_SPECS + Q3_SEMI_SPECS + (Q3_PRODUCT_SPEC,)
}

Q3_PART_PARAMS = Q3_PART_SPECS
Q3_SEMI_PARAMS = Q3_SEMI_SPECS
Q3_PRODUCT_PARAMS = Q3_PRODUCT_SPEC
Q3_TABLE2_PARTS = Q3_PART_SPECS
Q3_TABLE2_SEMI = Q3_SEMI_SPECS
Q3_TABLE2_PRODUCT = Q3_PRODUCT_SPEC
Q3_PARTS = Q3_PART_SPECS
Q3_SEMIFINISHED_PRODUCTS = Q3_SEMI_SPECS
Q3_ROOT_NODE = "product"
Q3_INSPECTABLE_NODES = tuple(Q3_NODE_SPECS)
Q3_REWORK_NODES = tuple(
    node for node, spec in Q3_NODE_SPECS.items() if spec.get("g") is not None
)
Q3_PARAMETER_NODES = Q3_INSPECTABLE_NODES
Q3_EFFECTIVE_STRATEGY_COUNT = 65536
Q3_REACHABLE_STATE_LIMIT = 531441

Q3_PRIMARY_TOPOLOGY_BY_ID = {
    "semi1": (1, 2, 3),
    "semi2": (4, 5, 6),
    "semi3": (7, 8),
    "product": ("semi1", "semi2", "semi3"),
}

Q3_ALTERNATIVE_TOPOLOGY_BY_ID = {
    "semi1": (1, 2),
    "semi2": (3, 4),
    "semi3": (5, 6, 7, 8),
    "product": ("semi1", "semi2", "semi3"),
}


def _named_parents(topology_by_id):
    """Convert numeric part identifiers to stable graph node names."""
    return {
        child: tuple(
            f"part{parent}" if isinstance(parent, int) else parent
            for parent in parents
        )
        for child, parents in topology_by_id.items()
    }


Q3_PRIMARY_TOPOLOGY = _named_parents(Q3_PRIMARY_TOPOLOGY_BY_ID)
Q3_ALTERNATIVE_TOPOLOGY = _named_parents(Q3_ALTERNATIVE_TOPOLOGY_BY_ID)

Q3_PRIMARY_DECLARED_TOPOLOGY = {
    "半成品1": (1, 2, 3),
    "半成品2": (4, 5, 6),
    "半成品3": (7, 8),
    "成品": ("半成品1", "半成品2", "半成品3"),
}
Q3_ALTERNATIVE_DECLARED_TOPOLOGY = {
    "半成品1": (1, 2),
    "半成品2": (3, 4),
    "半成品3": (5, 6, 7, 8),
    "成品": ("半成品1", "半成品2", "半成品3"),
}

Q3_PRIMARY_EDGES = tuple(
    (parent, child)
    for child, parents in Q3_PRIMARY_TOPOLOGY.items()
    for parent in parents
)
Q3_ALTERNATIVE_EDGES = tuple(
    (parent, child)
    for child, parents in Q3_ALTERNATIVE_TOPOLOGY.items()
    for parent in parents
)
Q3_TOPOLOGIES = {
    "primary_conditional": Q3_PRIMARY_TOPOLOGY,
    "alternative_conditional": Q3_ALTERNATIVE_TOPOLOGY,
}
Q3_TOPOLOGY_STATUS = "conditional_primary_inferred_from_table2_grouping"
Q3_FORMAL_SOURCE_GRAPH_AVAILABLE = False
Q3_UNIT_COST_DEFINITION = "U_v_equals_C_v_divided_by_Q_v"
Q3_PARENT_TRANSITION_COST_DEFINITION = "event_launch_cash_cost"


# ---------------------------------------------------------------------------
# Problem 4: precision design, exact intervals and scenario re-solution
# ---------------------------------------------------------------------------

Q4_JOINT_CONFIDENCE_LEVEL = 0.95
Q4_FAMILY_ALPHA = 0.05
Q2_PARAMETER_COUNT = 3
Q3_PARAMETER_COUNT = 12
Q4_Q2_MARGINAL_ALPHA = 0.0166666666666667
Q4_Q3_MARGINAL_ALPHA = 0.00416666666666667
Q4_WIDTH_TARGET = 0.10
Q4_N_MAX = 1000
Q4_SAMPLE_SIZE_GRID = (50, 100, 200, 400, 800)
Q4_SCENARIO_REPEATS = 10000
Q4_RANDOM_SEED = 202409
Q4_PRIOR_ALPHA = 0.5
Q4_PRIOR_BETA = 0.5
Q4_CONSISTENCY_THRESHOLD = 0.90
Q4_NUMERIC_TOL = Q1_NUMERIC_TOL

Q4_JOINT_CONFIDENCE = Q4_JOINT_CONFIDENCE_LEVEL
Q4_ALPHA_FAMILY = Q4_FAMILY_ALPHA
Q4_MARGINAL_ALPHA_Q2 = Q4_Q2_MARGINAL_ALPHA
Q4_MARGINAL_ALPHA_Q3 = Q4_Q3_MARGINAL_ALPHA
Q4_INTERVAL_WIDTH_TARGET = Q4_WIDTH_TARGET
Q4_SINGLE_PARAMETER_N_MAX = Q4_N_MAX
Q4_SAMPLE_N_GRID = Q4_SAMPLE_SIZE_GRID
Q4_SCENARIO_REPEAT_COUNT = Q4_SCENARIO_REPEATS
Q4_SCENARIO_SEED = Q4_RANDOM_SEED
Q4_JEFFREYS_ALPHA = Q4_PRIOR_ALPHA
Q4_JEFFREYS_BETA = Q4_PRIOR_BETA
Q4_DECISION_CONSISTENCY_THRESHOLD = Q4_CONSISTENCY_THRESHOLD
Q4_CI_METHOD = "clopper_pearson_exact"
Q4_JOINT_CONSTRUCTION = "bonferroni_rectangle"
Q4_RESAMPLING_PRIOR = "jeffreys"
Q4_DATA_MODE = "auditable_scenario_not_observed"
Q4_ALLOW_TRUE_RATE_AS_POINT_ESTIMATE = False
Q4_SAVE_NODE_SAMPLE_COUNTS = True
Q4_REOPTIMIZE_EACH_SCENARIO = True
Q4_REPORT_BOUNDARY_COUNT_TESTS = True

RELATIVE_SENSITIVITY_GRID = (-0.20, -0.10, 0.0, 0.10, 0.20)


# ---------------------------------------------------------------------------
# Shared modelling assumptions and validation switches
# ---------------------------------------------------------------------------

DETECTION_IS_LOSSLESS = True
DETECTION_IS_PERFECT = True
DISASSEMBLY_PRESERVES_PART_QUALITY = True
DEFECT_SOURCES_ARE_INDEPENDENT = True
INSTANT_REWORK_ONLY = True
STATIC_POLICIES = True
SCRAP_HAS_NO_SALVAGE = True
RECOVERED_PARTS_ARE_TRACEABLE = True
MARKET_RETURN_REQUIRES_EXCHANGE = True
UNIT_IS_YUAN_PER_QUALIFIED_DELIVERY = True


# ---------------------------------------------------------------------------
# Expanded problem-fact interface
# ---------------------------------------------------------------------------

PROBLEM_FACTS = {
    "F-NOMINAL": Q1_NOMINAL_RATE,
    "F-CONF-REJECT": Q1_REJECT_CONFIDENCE,
    "F-CONF-ACCEPT": Q1_ACCEPT_CONFIDENCE,
    "F-T1-C1": Q2_CASES[0],
    "F-T1-C2": Q2_CASES[1],
    "F-T1-C3": Q2_CASES[2],
    "F-T1-C4": Q2_CASES[3],
    "F-T1-C5": Q2_CASES[4],
    "F-T1-C6": Q2_CASES[5],
    "F-T2-PART-1": Q3_PART_SPECS[0],
    "F-T2-PART-2": Q3_PART_SPECS[1],
    "F-T2-PART-3": Q3_PART_SPECS[2],
    "F-T2-PART-4": Q3_PART_SPECS[3],
    "F-T2-PART-5": Q3_PART_SPECS[4],
    "F-T2-PART-6": Q3_PART_SPECS[5],
    "F-T2-PART-7": Q3_PART_SPECS[6],
    "F-T2-PART-8": Q3_PART_SPECS[7],
    "F-T2-SEMI": Q3_SEMI_SPECS,
    "F-T2-PRODUCT": {
        "defect_rate": Q3_PRODUCT_SPEC["p"],
        "assembly_cost": Q3_PRODUCT_SPEC["k"],
        "inspection_cost": Q3_PRODUCT_SPEC["t"],
        "disassembly_cost": Q3_PRODUCT_SPEC["g"],
    },
    "F-T2-PRICE": {
        "market_price": Q3_PRODUCT_SPEC["r_market"],
        "exchange_loss": Q3_PRODUCT_SPEC["L_exchange"],
    },
    "F-FIG1": {
        "process_count": 2,
        "part_count": 8,
    },
    "F-MECH-SYSTEM": "two_parts_assemble_into_one_product",
    "F-MECH-QUALIFIED": "qualified_inputs_still_have_conditional_product_defect",
    "F-MECH-DISASSEMBLE": "lossless_quality_preserving_but_costly",
    "F-MECH-EXCHANGE": "mandatory_exchange_for_returned_defective_product",
    "F-MECH-INSPECT-COST": "enterprise_bears_inspection_cost",
    "F-APPENDIX-DEFECT-DEF": "conditional_rate_given_qualified_inputs",
    "F-APPENDIX-EXCHANGE-LOSS": "loss_excludes_replacement_production_cost",
    "F-APPENDIX-UNIT": "yuan_per_item",
}

PROBLEM_FACT_IDS = frozenset(PROBLEM_FACTS)


# ---------------------------------------------------------------------------
# Registered model-constant registry
# ---------------------------------------------------------------------------

MODEL_CONSTANTS = {
    "Q1标称次品率": Q1_NOMINAL_RATE,
    "Q1拒收第一类错误上限": Q1_REJECT_ALPHA,
    "Q1接收置信水平": Q1_ACCEPT_CONFIDENCE,
    "Q1可识别超标幅度": Q1_ALTERNATIVE_DELTA,
    "Q1第二类错误上限": Q1_TYPE_II_ERROR,
    "Q1超标幅度灵敏度网格": Q1_DELTA_GRID,
    "Q1第二类错误灵敏度网格": Q1_BETA_GRID,
    "Q1精确枚举数值容差": Q1_NUMERIC_TOL,
    "报废回收价值": SCRAP_SALVAGE_VALUE,
    "Q2策略空间规模": Q2_STRATEGY_SPACE_SIZE,
    "Q2库存状态上限": Q2_INVENTORY_STATE_LIMIT,
    "现金流核验绝对容差": CASHFLOW_ABS_TOL,
    "价值迭代收敛容差": VALUE_ITERATION_TOL,
    "价值迭代最大轮数": VALUE_ITERATION_MAX_ITERATIONS,
    "Q3主情景拓扑": Q3_PRIMARY_DECLARED_TOPOLOGY,
    "Q3替代拓扑": Q3_ALTERNATIVE_DECLARED_TOPOLOGY,
    "Q3主情景有效策略数": Q3_EFFECTIVE_STRATEGY_COUNT,
    "Q3可达库存状态上限": Q3_REACHABLE_STATE_LIMIT,
    "Q4联合置信水平": Q4_JOINT_CONFIDENCE_LEVEL,
    "Q4联合族错误率": Q4_FAMILY_ALPHA,
    "Q2参数节点数": Q2_PARAMETER_COUNT,
    "Q3参数节点数": Q3_PARAMETER_COUNT,
    "Q4-Q2 Bonferroni边际错误率": Q4_Q2_MARGINAL_ALPHA,
    "Q4-Q3 Bonferroni边际错误率": Q4_Q3_MARGINAL_ALPHA,
    "Q4区间总宽度目标": Q4_WIDTH_TARGET,
    "Q4单参数样本量上限": Q4_N_MAX,
    "Q4样本量扫描网格": Q4_SAMPLE_SIZE_GRID,
    "Q4情景蒙特卡洛重复次数": Q4_SCENARIO_REPEATS,
    "Q4随机种子": Q4_RANDOM_SEED,
    "Q4 Jeffreys先验α": Q4_PRIOR_ALPHA,
    "Q4 Jeffreys先验β": Q4_PRIOR_BETA,
    "Q4决策一致率门槛": Q4_CONSISTENCY_THRESHOLD,
    "相对灵敏度扫描网格": RELATIVE_SENSITIVITY_GRID,
}

assert len(Q2_CASES) == Q2_STRATEGY_SPACE_SIZE
assert len(Q2_POLICY_SPACE) == Q2_STRATEGY_SPACE_SIZE
assert len(Q3_PART_SPECS) + len(Q3_SEMI_SPECS) + 1 == Q3_PARAMETER_COUNT
assert Q2_PARAMETER_COUNT == len(Q2_CASES[0]) - len(
    {"case_id", "r_market", "L_exchange", "g_dis"}
) - len({"kf", "tf"})
assert Q3_EFFECTIVE_STRATEGY_COUNT == Q2_EFFECTIVE_STRATEGY_COUNT
assert Q3_TOPOLOGY_STATUS == "conditional_primary_inferred_from_table2_grouping"