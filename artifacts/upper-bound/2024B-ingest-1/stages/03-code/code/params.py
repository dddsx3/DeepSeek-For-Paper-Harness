"""Validated parameters shared by all executable problem solvers."""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

SOURCE_FACTS_FILE_NAME = "PROBLEM_FACTS.json"
PARAMETER_SOURCE = "PROBLEM_FACTS.json plus registered stage-02 model constants"


def _facts_path() -> Path:
    cwd_path = Path(SOURCE_FACTS_FILE_NAME)
    if cwd_path.exists():
        return cwd_path
    adjacent_path = Path(__file__).resolve().with_name(SOURCE_FACTS_FILE_NAME)
    if adjacent_path.exists():
        return adjacent_path
    raise FileNotFoundError(
        f"{SOURCE_FACTS_FILE_NAME} must be beside params.py or in the working directory"
    )


def _load_facts() -> tuple[dict, list[dict], str]:
    path = _facts_path()
    raw = path.read_bytes()
    document = json.loads(raw.decode("utf-8"))
    if not isinstance(document, dict) or not isinstance(document.get("facts"), list):
        raise ValueError("PROBLEM_FACTS.json has no auditable facts array")
    records = document["facts"]
    if not all(isinstance(row, dict) and isinstance(row.get("id"), str) for row in records):
        raise ValueError("every PROBLEM_FACTS row must be a mapping with a string id")
    index = {row["id"]: row for row in records}
    if len(index) != len(records):
        raise ValueError("PROBLEM_FACTS contains duplicate fact ids")
    return document, records, hashlib.sha256(raw).hexdigest()


_FACTS_DOCUMENT, FACT_RECORDS, PROBLEM_FACTS_SHA256 = _load_facts()
_FACT_INDEX = {row["id"]: row for row in FACT_RECORDS}


def _require_condition(condition, message):
    if not bool(condition):
        raise ValueError(message)
    return None


def fact_record(fact_id):
    try:
        return _FACT_INDEX[fact_id]
    except KeyError as exc:
        raise KeyError(f"required source fact is missing: {fact_id}") from exc


def fact_value(fact_id):
    return fact_record(fact_id)["value"]


def _as_rate(value):
    if isinstance(value, bool):
        raise TypeError("a boolean is not a defect rate")
    if isinstance(value, (int, float)):
        result = float(value)
    elif isinstance(value, str) and value.strip().endswith("%"):
        result = float(value.strip()[:-1]) / 100.0
    else:
        raise TypeError(f"unsupported percentage value: {value!r}")
    return _validated_rate(result, fact="percentage")


def _as_amount(value):
    if isinstance(value, bool):
        raise TypeError("a boolean is not a monetary amount")
    result = float(value)
    _require_condition(math.isfinite(result), "monetary amount must be finite")
    _require_condition(result >= 0.0, "monetary amount must be nonnegative")
    return result


def _validated_rate(value, fact="parameter"):
    result = float(value)
    _require_condition(math.isfinite(result), f"{fact} must be finite")
    _require_condition(0.0 <= result <= 1.0, f"{fact} must lie in [0,1]")
    return result


def validate_probability(value, name="probability"):
    return _validated_rate(value, fact=name)


def validate_nonnegative(value, name="amount"):
    result = float(value)
    _require_condition(math.isfinite(result), f"{name} must be finite")
    _require_condition(result >= 0.0, f"{name} must be nonnegative")
    return result


# ---------------------------------------------------------------------------
# Problem 1: source facts and explicitly registered conditional design choices.
# ---------------------------------------------------------------------------

Q1_NOMINAL_DEFECT_RATE = _as_rate(fact_value("F-NOMINAL"))
Q1_REJECT_CONFIDENCE = _as_rate(fact_value("F-CONF-REJECT"))
Q1_ACCEPT_CONFIDENCE = _as_rate(fact_value("F-CONF-ACCEPT"))
Q1_ALPHA_REJECT = 1.0 - Q1_REJECT_CONFIDENCE
Q1_ALPHA_ACCEPT = 1.0 - Q1_ACCEPT_CONFIDENCE

Q1_EFFECT_DELTA_ABS = 0.05
Q1_TYPE2_ERROR_REJECT = 0.10
Q1_TYPE2_ERROR_ACCEPT = 0.10
INTEGER_SEARCH_CAP = 10000
Q1_SPRT_P_GRID_STEP = 0.01
Q1_SENSITIVITY_DELTA_LOW = 0.01
Q1_SENSITIVITY_DELTA_HIGH = 0.10
Q1_SENSITIVITY_BETA_LOW = 0.05
Q1_SENSITIVITY_BETA_HIGH = 0.20
PROBABILITY_ABS_TOL = 1e-12

Q1_REJECT_ALTERNATIVE_RATE = validate_probability(
    Q1_NOMINAL_DEFECT_RATE + Q1_EFFECT_DELTA_ABS, "Q1 reject alternative"
)
Q1_ACCEPT_ALTERNATIVE_RATE = validate_probability(
    Q1_NOMINAL_DEFECT_RATE - Q1_EFFECT_DELTA_ABS, "Q1 accept alternative"
)

Q1_DELTA_GRID = tuple(
    step / 100.0
    for step in range(
        round(Q1_SENSITIVITY_DELTA_LOW * 100.0),
        round(Q1_SENSITIVITY_DELTA_HIGH * 100.0) + 1,
        round(Q1_SPRT_P_GRID_STEP * 100.0),
    )
)
Q1_BETA_GRID = (
    Q1_SENSITIVITY_BETA_LOW,
    0.10,
    0.15,
    Q1_SENSITIVITY_BETA_HIGH,
)

# Compatibility aliases used by the four solver modules.
P0 = Q1_NOMINAL_DEFECT_RATE
NOMINAL_DEFECT_RATE = Q1_NOMINAL_DEFECT_RATE
CASE1_ALPHA = Q1_ALPHA_REJECT
CASE2_ALPHA = Q1_ALPHA_ACCEPT
CASE1_ALT_RATE = Q1_REJECT_ALTERNATIVE_RATE
CASE2_ALT_RATE = Q1_ACCEPT_ALTERNATIVE_RATE
CASE1_BETA = Q1_TYPE2_ERROR_REJECT
CASE2_BETA = Q1_TYPE2_ERROR_ACCEPT
CASE95_ALPHA = Q1_ALPHA_REJECT
CASE90_ALPHA = Q1_ALPHA_ACCEPT
Q1_REJECT_BETA = Q1_TYPE2_ERROR_REJECT
Q1_ACCEPT_BETA = Q1_TYPE2_ERROR_ACCEPT
Q1_SPRT_P_GRID_MIN = Q1_SENSITIVITY_DELTA_LOW
Q1_SPRT_P_GRID_MAX = Q1_SENSITIVITY_DELTA_HIGH


# ---------------------------------------------------------------------------
# Problem 2: the six Table 1 cases, parsed without interpolation or rounding.
# ---------------------------------------------------------------------------

def _build_q2_case(case_number):
    fact_id = f"F-T1-C{case_number}"
    raw = fact_value(fact_id)
    part1 = raw["零配件1"]
    part2 = raw["零配件2"]
    finished = raw["成品"]
    case = {
        "case_id": case_number,
        "fact_id": fact_id,
        "p_part1": _as_rate(part1["次品率"]),
        "purchase_part1": _as_amount(part1["购买单价"]),
        "inspection_part1": _as_amount(part1["检测成本"]),
        "p_part2": _as_rate(part2["次品率"]),
        "purchase_part2": _as_amount(part2["购买单价"]),
        "inspection_part2": _as_amount(part2["检测成本"]),
        "p_finished": _as_rate(finished["次品率"]),
        "assembly_cost": _as_amount(finished["装配成本"]),
        "finished_inspection_cost": _as_amount(finished["检测成本"]),
        "sale_price": _as_amount(raw["市场售价"]),
        "exchange_loss": _as_amount(raw["调换损失"]),
        "disassembly_cost": _as_amount(raw["拆解费用"]),
    }
    # Short aliases preserve the notation used in the modeling report.
    case.update(
        {
            "p1": case["p_part1"],
            "b1": case["purchase_part1"],
            "g1": case["inspection_part1"],
            "p2": case["p_part2"],
            "b2": case["purchase_part2"],
            "g2": case["inspection_part2"],
            "r": case["p_finished"],
            "a": case["assembly_cost"],
            "k": case["finished_inspection_cost"],
            "S": case["sale_price"],
            "L": case["exchange_loss"],
            "h": case["disassembly_cost"],
        }
    )
    return case


Q2_CASES = tuple(_build_q2_case(case_number) for case_number in range(1, 7))
Q2_CASES_BY_ID = {case["case_id"]: case for case in Q2_CASES}
TABLE1_CASES = Q2_CASES
Q2_RATE_NODE_IDS = ("part1", "part2", "finished")
Q2_RATE_NODE_COUNT = 3
Q2_DECISION_NAMES = (
    "inspect_part1",
    "inspect_part2",
    "inspect_finished",
    "disassemble_defective_finished",
)
Q2_POLICY_LABELS = ("Z1", "Z2", "C", "D")
Q2_EFFECTIVE_STRATEGY_COUNT = 16

COST_CATEGORIES = (
    "purchase",
    "inspection",
    "assembly",
    "disassembly",
    "exchange",
)
EVENT_CATEGORIES = COST_CATEGORIES + ("revenue",)

CASHFLOW_ABS_TOL_YUAN = 1e-6
SENSITIVITY_DEFECT_OFFSET_ABS = 0.05
SENSITIVITY_COST_MULTIPLIER_LOW = 0.5
SENSITIVITY_COST_MULTIPLIER_MIDLOW = 0.75
SENSITIVITY_COST_MULTIPLIER_BASE = 1.0
SENSITIVITY_COST_MULTIPLIER_MIDHIGH = 1.25
SENSITIVITY_COST_MULTIPLIER_HIGH = 1.5
SENSITIVITY_COST_MULTIPLIERS = (
    SENSITIVITY_COST_MULTIPLIER_LOW,
    SENSITIVITY_COST_MULTIPLIER_MIDLOW,
    SENSITIVITY_COST_MULTIPLIER_BASE,
    SENSITIVITY_COST_MULTIPLIER_MIDHIGH,
    SENSITIVITY_COST_MULTIPLIER_HIGH,
)
SENSITIVITY_DEFECT_RATES = (
    -SENSITIVITY_DEFECT_OFFSET_ABS,
    0.0,
    SENSITIVITY_DEFECT_OFFSET_ABS,
)

Q2_COST_MULTIPLIER_GRID = SENSITIVITY_COST_MULTIPLIERS


def q2_case(case_id):
    try:
        return dict(Q2_CASES_BY_ID[int(case_id)])
    except (KeyError, TypeError, ValueError) as exc:
        raise KeyError(f"unknown Table 1 case: {case_id!r}") from exc


def q2_case_with_rates(case_id, **rate_overrides):
    """Return a validated shallow copy with explicitly supplied rate overrides."""
    case = q2_case(case_id)
    aliases = {
        "p_part1": "p_part1",
        "p_part2": "p_part2",
        "p_finished": "p_finished",
        "r": "p_finished",
    }
    for supplied, value in rate_overrides.items():
        _require_condition(supplied in aliases, f"unknown rate field: {supplied}")
        case[aliases[supplied]] = validate_probability(value, supplied)
    if "r" in case:
        case["r"] = case["p_finished"]
    return case


def strategy_mapping(strategy):
    values = tuple(int(flag) for flag in strategy)
    _require_condition(
        len(values) == len(Q2_DECISION_NAMES) and all(flag in (0, 1) for flag in values),
        "Q2 strategy must contain four binary decisions",
    )
    return dict(zip(Q2_DECISION_NAMES, values))


# ---------------------------------------------------------------------------
# Problem 3: explicit Table 2 nodes and the conditional H1 topology.
# ---------------------------------------------------------------------------

Q3_PARTS = {}
for _part_number in range(1, 9):
    _fact_id = f"F-T2-PART-{_part_number}"
    _raw_part = fact_value(_fact_id)
    _node_id = f"part{_part_number}"
    Q3_PARTS[_node_id] = {
        "node_id": _node_id,
        "node_type": "part",
        "fact_id": _fact_id,
        "p": _as_rate(_raw_part["次品率"]),
        "a": 0.0,
        "k": _as_amount(_raw_part["检测成本"]),
        "h": 0.0,
        "purchase_cost": _as_amount(_raw_part["购买单价"]),
        "rate_key": "p",
    }

Q3_SEMI_PRODUCTS = {}
for _semi_number, _raw_semi in enumerate(fact_value("F-T2-SEMI"), 1):
    _node_id = f"s{_semi_number}"
    Q3_SEMI_PRODUCTS[_node_id] = {
        "node_id": _node_id,
        "node_type": "semi_product",
        "fact_id": "F-T2-SEMI",
        "p": _as_rate(_raw_semi["次品率"]),
        "a": _as_amount(_raw_semi["装配成本"]),
        "k": _as_amount(_raw_semi["检测成本"]),
        "h": _as_amount(_raw_semi["拆解费用"]),
        "purchase_cost": 0.0,
        "rate_key": "p",
    }

_q3_root_fact = fact_value("F-T2-PRODUCT")
_q3_price_fact = fact_value("F-T2-PRICE")
Q3_FINISHED_PRODUCT = {
    "node_id": "finished",
    "node_type": "finished_product",
    "fact_id": "F-T2-PRODUCT",
    "p": _as_rate(_q3_root_fact["次品率"]),
    "a": _as_amount(_q3_root_fact["装配成本"]),
    "k": _as_amount(_q3_root_fact["检测成本"]),
    "h": _as_amount(_q3_root_fact["拆解费用"]),
    "purchase_cost": 0.0,
    "rate_key": "p",
}

Q3_NODES = {
    **Q3_PARTS,
    **Q3_SEMI_PRODUCTS,
    "finished": Q3_FINISHED_PRODUCT,
}
Q3_NODE_ORDER = (
    tuple(f"part{node_number}" for node_number in range(1, 9))
    + tuple(f"s{semi_number}" for semi_number in range(1, 4))
    + ("finished",)
)
Q3_RATE_NODE_IDS = Q3_NODE_ORDER
Q3_PART_COUNT = 8
Q3_SEMI_PRODUCT_COUNT_CONDITIONAL = 3
Q3_FINISHED_PRODUCT_COUNT_CONDITIONAL = 1
Q3_TOTAL_NODE_COUNT_CONDITIONAL = 12
Q3_RATE_NODE_COUNT = Q3_TOTAL_NODE_COUNT_CONDITIONAL
Q3_ROOT_NODE_ID = "finished"
Q3_MARKET_PRICE = _as_amount(_q3_price_fact["市场售价"])
Q3_SALE_PRICE = Q3_MARKET_PRICE
Q3_EXCHANGE_LOSS = _as_amount(_q3_price_fact["调换损失"])

CONDITIONAL_H1_LABEL = "conditional_H1_not_original_figure_fact"
H1_TOPOLOGY_LABEL = CONDITIONAL_H1_LABEL
H1_CLAIM_LABEL = CONDITIONAL_H1_LABEL
Q3_H1_LABEL = CONDITIONAL_H1_LABEL

H1_SEMI_PRODUCTS = (
    {"node_id": "s1", "children": ("part1", "part2", "part3")},
    {"node_id": "s2", "children": ("part4", "part5", "part6")},
    {"node_id": "s3", "children": ("part7", "part8")},
)
H1_FINISHED_PRODUCT = {
    "node_id": "finished",
    "children": ("s1", "s2", "s3"),
}
H1_CONDITIONAL_TOPOLOGY = {
    "label": CONDITIONAL_H1_LABEL,
    "parts": Q3_PART_COUNT,
    "semi_products": H1_SEMI_PRODUCTS,
    "finished_product": H1_FINISHED_PRODUCT,
    "claim_status": "conditional_not_original_figure_fact",
}
H1_TOPOLOGY = H1_CONDITIONAL_TOPOLOGY

H1_CHILD_TO_PARENT = {}
H1_CHILDREN_BY_PARENT = {}
for _semi in H1_SEMI_PRODUCTS:
    H1_CHILDREN_BY_PARENT[_semi["node_id"]] = tuple(_semi["children"])
    for _child in _semi["children"]:
        _require_condition(_child not in H1_CHILD_TO_PARENT, "H1 child has multiple parents")
        H1_CHILD_TO_PARENT[_child] = _semi["node_id"]
H1_CHILDREN_BY_PARENT[H1_FINISHED_PRODUCT["node_id"]] = tuple(
    H1_FINISHED_PRODUCT["children"]
)
for _child in H1_FINISHED_PRODUCT["children"]:
    H1_CHILD_TO_PARENT[_child] = H1_FINISHED_PRODUCT["node_id"]

# networkx.DiGraph consumes directed child -> parent edges.
H1_CONDITIONAL_EDGES = tuple(
    (child, parent) for child, parent in sorted(H1_CHILD_TO_PARENT.items())
)
H1_EDGES = H1_CONDITIONAL_EDGES
H1_PARENT_EDGES = H1_CONDITIONAL_EDGES
Q3_H1_EDGES = H1_CONDITIONAL_EDGES

Q3_DECISION_SPACE_SIZE = 2 ** (2 * Q3_TOTAL_NODE_COUNT_CONDITIONAL)
Q3_DEGENERATION_EDGES = (("part1", "finished"), ("part2", "finished"))


def h1_parent_of(child):
    try:
        return H1_CHILD_TO_PARENT[str(child)]
    except KeyError as exc:
        raise KeyError(f"node is not an H1 child: {child!r}") from exc


def q3_node(node_id):
    try:
        return dict(Q3_NODES[str(node_id)])
    except KeyError as exc:
        raise KeyError(f"unknown Q3 node: {node_id!r}") from exc


def q3_node_with_rate(node_id, rate):
    node = q3_node(node_id)
    node["p"] = validate_probability(rate, f"{node_id}.p")
    return node


# ---------------------------------------------------------------------------
# Problem 4: registered synthetic-scenario design and exact interval settings.
# ---------------------------------------------------------------------------

Q4_JOINT_CONFIDENCE = 0.95
Q4_TARGET_CP_HALFWIDTH = 0.05
Q4_MONTE_CARLO_REPETITIONS = 10000
RANDOM_SEED = 202409
random_seed = RANDOM_SEED
Q4_SYNTHETIC_SCENARIO = True
Q4_EXACT_INTERVAL = True

Q4_ALPHA_NODE_Q2 = Q4_JOINT_CONFIDENCE / Q2_RATE_NODE_COUNT
Q4_ALPHA_NODE_H1 = Q4_JOINT_CONFIDENCE / Q3_TOTAL_NODE_COUNT_CONDITIONAL
Q4_ALPHA_NODE = Q4_ALPHA_NODE_H1
Q4_H1_ALPHA_NODE = Q4_ALPHA_NODE_H1
Q4_Q2_ALPHA_NODE = Q4_ALPHA_NODE_Q2
Q4_NODE_ALPHA = Q4_ALPHA_NODE_H1
Q4_RATE_NODE_COUNT = Q3_TOTAL_NODE_COUNT_CONDITIONAL

# Bonferroni is conservative and, with alpha_node=alpha_joint/K, has
# lower bound exactly alpha_joint.  It must not be confused with 1-alpha_joint.
Q4_JOINT_COVERAGE_LOWER_BOUND = Q4_JOINT_CONFIDENCE
Q4_H1_JOINT_COVERAGE_LOWER_BOUND = Q4_JOINT_CONFIDENCE
Q4_Q2_JOINT_COVERAGE_LOWER_BOUND = Q4_JOINT_CONFIDENCE

_require_condition(
    abs(Q4_ALPHA_NODE_Q2 - Q4_JOINT_CONFIDENCE / Q2_RATE_NODE_COUNT)
    <= PROBABILITY_ABS_TOL,
    "Q2 Bonferroni marginal error rate is inconsistent",
)
_require_condition(
    abs(Q4_ALPHA_NODE_H1 - Q4_JOINT_CONFIDENCE / Q3_TOTAL_NODE_COUNT_CONDITIONAL)
    <= PROBABILITY_ABS_TOL,
    "H1 Bonferroni marginal error rate is inconsistent",
)
_require_condition(
    Q4_JOINT_COVERAGE_LOWER_BOUND
    >= Q4_JOINT_CONFIDENCE - PROBABILITY_ABS_TOL,
    "Bonferroni joint coverage lower bound is inconsistent",
)


# ---------------------------------------------------------------------------
# Cross-problem validation helpers.
# ---------------------------------------------------------------------------

def validate_case_inputs(case):
    for key in ("p_part1", "p_part2", "p_finished"):
        validate_probability(case[key], key)
    for key in (
        "purchase_part1",
        "inspection_part1",
        "purchase_part2",
        "inspection_part2",
        "assembly_cost",
        "finished_inspection_cost",
        "sale_price",
        "exchange_loss",
        "disassembly_cost",
    ):
        validate_nonnegative(case[key], key)
    return case


def validate_q3_node_parameters():
    for node_id in Q3_NODE_ORDER:
        node = Q3_NODES[node_id]
        validate_probability(node["p"], f"{node_id}.p")
        for key in ("a", "k", "h", "purchase_cost"):
            validate_nonnegative(node[key], f"{node_id}.{key}")
    _require_condition(
        len(Q3_NODE_ORDER) == Q3_TOTAL_NODE_COUNT_CONDITIONAL,
        "Q3 node count is inconsistent",
    )
    _require_condition(
        set(Q3_PARTS).issubset(H1_CHILD_TO_PARENT),
        "H1 does not assign exactly one parent to every part",
    )
    _require_condition(
        set(H1_CHILDREN_BY_PARENT["finished"]) == set(Q3_SEMI_PRODUCTS),
        "H1 finished-product children are inconsistent",
    )


for _q2_case in Q2_CASES:
    validate_case_inputs(_q2_case)
validate_q3_node_parameters()

REGISTERED_MODEL_CONSTANTS = {
    "q1_effect_delta_abs": Q1_EFFECT_DELTA_ABS,
    "q1_type2_error_reject": Q1_TYPE2_ERROR_REJECT,
    "q1_type2_error_accept": Q1_TYPE2_ERROR_ACCEPT,
    "integer_search_cap": INTEGER_SEARCH_CAP,
    "q1_sprt_p_grid_step": Q1_SPRT_P_GRID_STEP,
    "q1_sensitivity_delta_low": Q1_SENSITIVITY_DELTA_LOW,
    "q1_sensitivity_delta_high": Q1_SENSITIVITY_DELTA_HIGH,
    "q1_sensitivity_beta_low": Q1_SENSITIVITY_BETA_LOW,
    "q1_sensitivity_beta_high": Q1_SENSITIVITY_BETA_HIGH,
    "q2_rate_node_count": Q2_RATE_NODE_COUNT,
    "q3_total_node_count_conditional": Q3_TOTAL_NODE_COUNT_CONDITIONAL,
    "q4_joint_confidence": Q4_JOINT_CONFIDENCE,
    "q4_target_cp_halfwidth": Q4_TARGET_CP_HALFWIDTH,
    "q4_monte_carlo_repetitions": Q4_MONTE_CARLO_REPETITIONS,
    "random_seed": RANDOM_SEED,
    "probability_abs_tol": PROBABILITY_ABS_TOL,
    "cashflow_abs_tol_yuan": CASHFLOW_ABS_TOL_YUAN,
    "sensitivity_defect_offset_abs": SENSITIVITY_DEFECT_OFFSET_ABS,
    "sensitivity_cost_multiplier_low": SENSITIVITY_COST_MULTIPLIER_LOW,
    "sensitivity_cost_multiplier_midlow": SENSITIVITY_COST_MULTIPLIER_MIDLOW,
    "sensitivity_cost_multiplier_base": SENSITIVITY_COST_MULTIPLIER_BASE,
    "sensitivity_cost_multiplier_midhigh": SENSITIVITY_COST_MULTIPLIER_MIDHIGH,
    "sensitivity_cost_multiplier_high": SENSITIVITY_COST_MULTIPLIER_HIGH,
}