"""问题四：抽样区间、Bonferroni 联合域与可复现情景重解。"""

from __future__ import annotations

from collections.abc import Mapping
from itertools import product
from typing import Any

import numpy as np
import scipy.stats

import params
from params import *


_Q2_STATE_PAIRS = tuple(
    product(Q2_STATES, repeat=Q2_DECISION_VARIABLE_COUNT)
)
_Q2_STATE_INDEX = {
    state_pair: state_index
    for state_index, state_pair in enumerate(_Q2_STATE_PAIRS)
}
_Q2_EMPTY_STATE_INDEX = _Q2_STATE_INDEX[(Q2_EMPTY, Q2_EMPTY)]
_Q2_COMPONENT_DECISION_COUNT = Q2_PARAMETER_NODE_COUNT - 1
_Q2_PARAMETER_NAMES = ("part1", "part2", "product")
_Q3_BATCH_SIZE = (
    Q3_REACHABLE_STATE_LIMIT
    // (Q4_SINGLE_PARAMETER_N_MAX * Q3_PARAMETER_NODE_COUNT)
)
_Q2_BATCH_SIZE = (
    Q3_REACHABLE_STATE_LIMIT
    // (Q4_SINGLE_PARAMETER_N_MAX * Q2_PARAMETER_NODE_COUNT)
)
_Q3_POLICY_MATRIX: np.ndarray | None = None


def _json_safe(value: Any) -> Any:
    """将科学计算容器递归转换成严格 JSON 值。"""
    if value is None or isinstance(value, (str, bool)):
        return value
    if isinstance(value, (int, np.integer)):
        return int(value)
    if isinstance(value, (float, np.floating)):
        numeric = float(value)
        return numeric if np.isfinite(numeric) else None
    if isinstance(value, np.ndarray):
        return _json_safe(value.tolist())
    if isinstance(value, Mapping):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    return value


def _q2_policy_matrix() -> np.ndarray:
    return np.asarray(Q2_POLICY_SPACE, dtype=np.int8)


def _q3_policy_matrix() -> np.ndarray:
    global _Q3_POLICY_MATRIX
    if _Q3_POLICY_MATRIX is None:
        _Q3_POLICY_MATRIX = np.asarray(
            list(q3_policy_space()),
            dtype=np.int8,
        )
    return _Q3_POLICY_MATRIX


def _q2_policy_record(policy: np.ndarray | list[int]) -> dict[str, int]:
    values = [int(item) for item in policy]
    return {
        "Z1": values[0],
        "Z2": values[1],
        "C": values[2],
        "D": values[3],
    }


def _q3_policy_record(policy: np.ndarray | list[int]) -> dict[str, int]:
    return {
        name: int(value)
        for name, value in zip(Q3_POLICY_BIT_ORDER, policy)
    }


def _q3_node_label(node: Mapping[str, Any]) -> str:
    kind = str(node["kind"])
    node_id = int(node["node_id"])
    if kind == "part":
        return f"part{node_id}"
    if kind == "semi":
        return f"semi{node_id}"
    return "product"


def clopper_pearson(
    defect_count: int,
    sample_size: int,
    marginal_alpha: float,
) -> tuple[float, float]:
    """Clopper–Pearson 精确区间，显式处理零计数和全计数。"""
    count = int(defect_count)
    size = int(sample_size)
    alpha = float(marginal_alpha)
    if size < 1:
        raise ValueError("sample_size 必须为正整数")
    if count < 0 or count > size:
        raise ValueError("defect_count 必须位于零到 sample_size")
    if alpha <= 0 or alpha >= 1:
        raise ValueError("marginal_alpha 必须位于零到一之间")

    lower = (
        0.0
        if count == 0
        else float(
            scipy.stats.beta.ppf(
                alpha / 2,
                count,
                size - count + 1,
            )
        )
    )
    upper = (
        1.0
        if count == size
        else float(
            scipy.stats.beta.ppf(
                1 - alpha / 2,
                count + 1,
                size - count,
            )
        )
    )
    if not (
        0 <= lower <= count / size <= upper <= 1
    ):
        raise ArithmeticError("Clopper–Pearson 端点次序异常")
    return lower, upper


def parameter_precision_n(
    scenario_defect_rate: float,
    marginal_alpha: float,
    n_max: int = Q4_SINGLE_PARAMETER_N_MAX,
    width_target: float = Q4_WIDTH_TARGET,
) -> int:
    """按登记中心率逐个整数扫描，返回首个达到宽度目标的样本量。"""
    scan = _parameter_precision_scan(
        scenario_defect_rate,
        marginal_alpha,
        n_max,
        width_target,
    )
    selected_n = scan["selected_n"]
    if selected_n is None:
        raise RuntimeError("登记样本量上限内未达到区间宽度目标")
    return int(selected_n)


def _parameter_precision_scan(
    scenario_defect_rate: float,
    marginal_alpha: float,
    n_max: int,
    width_target: float,
) -> dict[str, Any]:
    if scenario_defect_rate < 0 or scenario_defect_rate > 1:
        raise ValueError("scenario_defect_rate 必须位于零到一之间")
    if n_max < 1:
        raise ValueError("n_max 必须为正整数")

    trace: list[dict[str, Any]] = []
    selected_n: int | None = None
    for sample_size in range(1, int(n_max) + 1):
        planning_count = int(round(scenario_defect_rate * sample_size))
        lower, upper = clopper_pearson(
            planning_count,
            sample_size,
            marginal_alpha,
        )
        width = upper - lower
        trace.append(
            {
                "n": sample_size,
                "planning_count": planning_count,
                "lower": lower,
                "upper": upper,
                "width": width,
            }
        )
        if selected_n is None and width <= width_target:
            selected_n = sample_size

    grid_trace = [
        row
        for row in trace
        if int(row["n"]) in tuple(int(item) for item in Q4_SAMPLE_SIZE_GRID)
    ]
    return {
        "selected_n": selected_n,
        "scenario_defect_rate": float(scenario_defect_rate),
        "marginal_alpha": float(marginal_alpha),
        "width_target": float(width_target),
        "planning_count_rule": "round(scenario_rate*n)",
        "grid_trace": grid_trace,
        "full_scan": trace,
    }


def bonferroni_joint_box(
    intervals: Mapping[str, tuple[float, float]],
    marginal_alpha: float,
    family_error_rate: float,
) -> dict[str, Any]:
    """由逐参数 CP 区间构造保守 Bonferroni 联合矩形。"""
    parameter_count = len(intervals)
    box: dict[str, list[float]] = {}
    for name, endpoints in intervals.items():
        lower, upper = endpoints
        if not (0 <= lower <= upper <= 1):
            raise ValueError("联合域输入区间不合法")
        box[str(name)] = [float(lower), float(upper)]

    allocated_error = parameter_count * marginal_alpha
    if allocated_error > family_error_rate + Q1_EXACT_ENUMERATION_TOL:
        raise ArithmeticError("Bonferroni 边际错误率分配超出族错误率")

    return {
        "construction": "Bonferroni rectangular joint box",
        "parameter_count": parameter_count,
        "marginal_error_rate": float(marginal_alpha),
        "allocated_family_error_rate": float(allocated_error),
        "family_error_rate_limit": float(family_error_rate),
        "joint_confidence_lower_bound": float(
            1 - family_error_rate
        ),
        "independent_marginal_product_for_contrast": float(
            (1 - marginal_alpha) ** parameter_count
        ),
        "box": box,
    }


def _inverse_binomial_lower(
    count: int,
    sample_size: int,
    target_tail: float,
) -> float:
    lower = 0.0
    upper = 1.0
    for _ in range(VALUE_ITERATION_MAX_ITERATIONS):
        midpoint = (lower + upper) / 2
        tail_probability = float(
            scipy.stats.binom.sf(
                count - 1,
                sample_size,
                midpoint,
            )
        )
        if abs(tail_probability - target_tail) <= Q1_EXACT_ENUMERATION_TOL:
            return midpoint
        if tail_probability > target_tail:
            lower = midpoint
        else:
            upper = midpoint
    return (lower + upper) / 2


def _inverse_binomial_upper(
    count: int,
    sample_size: int,
    target_cdf: float,
) -> float:
    lower = 0.0
    upper = 1.0
    for _ in range(VALUE_ITERATION_MAX_ITERATIONS):
        midpoint = (lower + upper) / 2
        lower_tail_probability = float(
            scipy.stats.binom.cdf(
                count,
                sample_size,
                midpoint,
            )
        )
        if abs(lower_tail_probability - target_cdf) <= Q1_EXACT_ENUMERATION_TOL:
            return midpoint
        if lower_tail_probability < target_cdf:
            lower = midpoint
        else:
            upper = midpoint
    return (lower + upper) / 2


def edge_case_tests(
    representative_n: int,
    marginal_alpha: float,
    prefix: str,
) -> dict[str, Any]:
    """核验 x=0、x=n 和内部计数，并与精确二项反演交叉验证。"""
    size = int(representative_n)
    if size < 2:
        raise ValueError("端点交叉核验需要至少两个观测")
    records: list[dict[str, Any]] = []
    for suffix, count in (
        ("x_zero", 0),
        ("x_all", size),
        ("x_internal", size // 2),
    ):
        lower, upper = clopper_pearson(count, size, marginal_alpha)
        target = marginal_alpha / 2
        if count == 0:
            inverse_lower = 0.0
        else:
            inverse_lower = _inverse_binomial_lower(
                count,
                size,
                target,
            )
        if count == size:
            inverse_upper = 1.0
        else:
            inverse_upper = _inverse_binomial_upper(
                count,
                size,
                target,
            )
        lower_error = abs(lower - inverse_lower)
        upper_error = abs(upper - inverse_upper)
        passed = bool(
            0 <= lower <= count / size <= upper <= 1
            and lower_error <= Q1_EXACT_ENUMERATION_TOL
            and upper_error <= Q1_EXACT_ENUMERATION_TOL
            and (count != size or count == 0 or upper == 1)
        )
        records.append(
            {
                "test_id": f"{prefix}_{suffix}",
                "x": int(count),
                "n": size,
                "lower": lower,
                "upper": upper,
                "exact_inverse_lower": inverse_lower,
                "exact_inverse_upper": inverse_upper,
                "lower_absolute_error": lower_error,
                "upper_absolute_error": upper_error,
                "passed": passed,
            }
        )
    return {
        "records": records,
        "max_absolute_error": max(
            max(
                float(row["lower_absolute_error"]),
                float(row["upper_absolute_error"]),
            )
            for row in records
        ),
        "passed": all(bool(row["passed"]) for row in records),
    }


def _component_distribution(
    current_quality: np.ndarray,
    defect_rate: np.ndarray,
    purchase_price: float,
    inspection_cost: float,
    inspect_component: bool,
) -> tuple[np.ndarray, np.ndarray]:
    """返回检测策略下当前质量状态的一次准备分布和期望费用。"""
    good_index = Q2_STATES.index(Q2_GOOD)
    bad_index = Q2_STATES.index(Q2_BAD)
    empty_index = Q2_STATES.index(Q2_EMPTY)

    can_purchase_good = defect_rate < 1
    safe_success_probability = np.where(
        can_purchase_good,
        1 - defect_rate,
        1,
    )
    geometric_preparation = (
        purchase_price + inspection_cost
    ) / safe_success_probability
    geometric_preparation = np.where(
        can_purchase_good,
        geometric_preparation,
        np.inf,
    )

    if inspect_component:
        good_probability = np.where(
            current_quality == good_index,
            1.0,
            can_purchase_good.astype(float),
        )
        expected_cost = np.where(
            current_quality == good_index,
            inspection_cost,
            np.where(
                current_quality == empty_index,
                geometric_preparation,
                inspection_cost + geometric_preparation,
            ),
        )
    else:
        good_probability = (
            current_quality == good_index
        ).astype(float)
        bad_probability = (
            current_quality == bad_index
        ).astype(float)
        empty_rows = current_quality == empty_index
        good_probability = np.where(
            empty_rows,
            1 - defect_rate,
            good_probability,
        )
        bad_probability = np.where(
            empty_rows,
            defect_rate,
            bad_probability,
        )
        expected_cost = np.where(
            empty_rows,
            purchase_price,
            0.0,
        )

    probabilities = np.zeros(
        (*current_quality.shape, len(Q2_STATES)),
        dtype=float,
    )
    probabilities[:, :, good_index] = good_probability
    probabilities[:, :, bad_index] = bad_probability
    return probabilities, expected_cost


def _evaluate_q2_policies(
    rates: np.ndarray,
    case: Mapping[str, Any],
    policies: np.ndarray | None = None,
) -> dict[str, np.ndarray]:
    """向量化求解全部两零件策略，并显式剔除非吸收策略。"""
    rate_matrix = np.asarray(rates, dtype=float)
    if rate_matrix.ndim == 1:
        rate_matrix = rate_matrix.reshape(1, -1)
    if rate_matrix.shape[1] != Q2_PARAMETER_NODE_COUNT:
        raise ValueError("问题二概率向量维度异常")
    if np.any(rate_matrix < 0) or np.any(rate_matrix > 1):
        raise ValueError("问题二概率必须位于零到一之间")

    policy_matrix = (
        _q2_policy_matrix()
        if policies is None
        else np.asarray(policies, dtype=np.int8)
    )
    if policy_matrix.ndim != 2 or policy_matrix.shape[1] != Q2_DECISION_VARIABLE_COUNT:
        raise ValueError("问题二策略矩阵维度异常")

    strategy_count = policy_matrix.shape[0]
    batch_size = rate_matrix.shape[0]
    state_count = len(_Q2_STATE_PAIRS)
    good_index = Q2_STATES.index(Q2_GOOD)

    transition = np.zeros(
        (strategy_count, batch_size, state_count, state_count),
        dtype=float,
    )
    reward = np.zeros(
        (strategy_count, batch_size, state_count),
        dtype=float,
    )
    valid = np.ones((strategy_count, batch_size), dtype=bool)
    success_from_empty = np.zeros((strategy_count, batch_size), dtype=float)

    prices = (
        float(case["a1"]),
        float(case["a2"]),
    )
    inspection_costs = (
        float(case["t1"]),
        float(case["t2"]),
    )
    assembly_cost = float(case["kf"])
    product_inspection_cost = float(case["tf"])
    product_defect_rate = rate_matrix[:, Q2_PARAMETER_NODE_COUNT - 1][None, :]
    sale_price = float(case["sale_price"])
    exchange_loss = float(case["exchange_loss"])
    disassembly_cost = float(case["disassembly_cost"])

    for strategy_index, policy in enumerate(policy_matrix):
        inspect_parts = bool(policy[0]), bool(policy[1])
        inspect_product = bool(policy[2])
        disassemble = bool(policy[3])

        joint = np.zeros(
            (
                state_count,
                batch_size,
                len(Q2_STATES),
                len(Q2_STATES),
            ),
            dtype=float,
        )
        preparation_cost = np.zeros(
            (state_count, batch_size),
            dtype=float,
        )
        for state_index, (first_quality, second_quality) in enumerate(
            _Q2_STATE_PAIRS
        ):
            joint[
                state_index,
                :,
                Q2_STATES.index(first_quality),
                Q2_STATES.index(second_quality),
            ] = 1

        for component_position in range(_Q2_COMPONENT_DECISION_COUNT):
            next_joint = np.zeros_like(joint)
            for previous_quality in range(len(Q2_STATES)):
                if component_position == 0:
                    weights = joint[:, :, previous_quality, :]
                    component_probabilities, component_cost = (
                        _component_distribution(
                            weights,
                            rate_matrix[:, component_position][None, :],
                            prices[component_position],
                            inspection_costs[component_position],
                            inspect_parts[component_position],
                        )
                    )
                    for resulting_quality in range(len(Q2_STATES)):
                        next_joint[:, :, resulting_quality, :] += (
                            weights
                            * component_probabilities[:, :, resulting_quality]
                        )
                else:
                    weights = joint[:, :, :, previous_quality]
                    component_probabilities, component_cost = (
                        _component_distribution(
                            weights,
                            rate_matrix[:, component_position][None, :],
                            prices[component_position],
                            inspection_costs[component_position],
                            inspect_parts[component_position],
                        )
                    )
                    for resulting_quality in range(len(Q2_STATES)):
                        next_joint[:, :, :, resulting_quality] += (
                            weights
                            * component_probabilities[:, :, resulting_quality]
                        )
                preparation_cost += np.sum(
                    weights * component_cost,
                    axis=0,
                )
            joint = next_joint

        nonabsorbing_disassembly = np.zeros(batch_size, dtype=bool)
        for component_position in range(_Q2_COMPONENT_DECISION_COUNT):
            nonabsorbing_disassembly |= (
                (not inspect_parts[component_position])
                & (
                    rate_matrix[:, component_position]
                    > 0
                )
            )
        if disassemble:
            valid[strategy_index] &= ~nonabsorbing_disassembly

        for state_index in range(state_count):
            for first_quality in range(len(Q2_STATES)):
                for second_quality in range(len(Q2_STATES)):
                    mass = joint[
                        state_index,
                        :,
                        first_quality,
                        second_quality,
                    ]
                    both_good = bool(
                        first_quality == good_index
                        and second_quality == good_index
                    )
                    product_good_probability = np.where(
                        both_good,
                        1 - product_defect_rate[0],
                        0.0,
                    )
                    product_bad_probability = (
                        1 - product_good_probability
                    )
                    attempt_cost = (
                        preparation_cost[state_index]
                        + assembly_cost
                    )
                    if inspect_product:
                        attempt_cost = attempt_cost + product_inspection_cost

                    immediate_reward = mass * (
                        attempt_cost
                        + sale_price * product_good_probability
                    )
                    if not inspect_product:
                        immediate_reward -= (
                            mass
                            * product_bad_probability
                            * exchange_loss
                        )
                    if disassemble:
                        immediate_reward -= (
                            mass
                            * product_bad_probability
                            * disassembly_cost
                        )
                    reward[strategy_index, :, state_index] += immediate_reward

                    failed_mass = mass * product_bad_probability
                    transition[
                        strategy_index,
                        :,
                        state_index,
                        _Q2_EMPTY_STATE_INDEX,
                    ] += failed_mass
                    if disassemble:
                        transition[
                            strategy_index,
                            :,
                            state_index,
                            state_index,
                        ] += failed_mass

                success_from_empty[strategy_index] += 0
        success_from_empty[strategy_index] = np.sum(
            joint[
                _Q2_EMPTY_STATE_INDEX,
                :,
                good_index,
                good_index,
            ]
            * np.where(
                True,
                1 - product_defect_rate[0],
                0.0,
            )
        )
        valid[strategy_index] &= success_from_empty[strategy_index] > 0

    values = np.full(
        (strategy_count, batch_size),
        np.inf,
        dtype=float,
    )
    bellman_residual = np.full(
        (strategy_count, batch_size),
        np.inf,
        dtype=float,
    )
    absorption_probability = np.zeros(
        (strategy_count, batch_size),
        dtype=float,
    )

    for strategy_index in range(strategy_count):
        valid_indices = np.flatnonzero(valid[strategy_index])
        if valid_indices.size == 0:
            continue
        system = (
            np.eye(state_count)[None, :, :]
            - transition[strategy_index, valid_indices]
        )
        right_hand_side = reward[strategy_index, valid_indices]
        try:
            solved = np.linalg.solve(system, right_hand_side)
        except np.linalg.LinAlgError:
            for batch_index in valid_indices:
                try:
                    solved_item = np.linalg.solve(
                        np.eye(state_count)
                        - transition[strategy_index, batch_index],
                        reward[strategy_index, batch_index],
                    )
                except np.linalg.LinAlgError:
                    valid[strategy_index, batch_index] = False
                    continue
                values[strategy_index, batch_index] = solved_item[
                    _Q2_EMPTY_STATE_INDEX
                ]
                residual = solved_item - (
                    reward[strategy_index, batch_index]
                    + transition[strategy_index, batch_index]
                    @ solved_item
                )
                bellman_residual[
                    strategy_index,
                    batch_index,
                ] = float(np.max(np.abs(residual)))
                absorption_probability[
                    strategy_index,
                    batch_index,
                ] = 1.0
            continue

        values[strategy_index, valid_indices] = solved[
            :, _Q2_EMPTY_STATE_INDEX
        ]
        residual = solved - (
            right_hand_side
            + np.einsum(
                "bij,bj->bi",
                transition[strategy_index, valid_indices],
                solved,
            )
        )
        bellman_residual[strategy_index, valid_indices] = np.max(
            np.abs(residual),
            axis=1,
        )
        absorption_probability[strategy_index, valid_indices] = 1.0

    values[~valid] = np.inf
    bellman_residual[~valid] = np.inf
    return {
        "profits": values,
        "bellman_residual": bellman_residual,
        "absorption_probability": absorption_probability,
        "valid": valid,
    }


def _q3_parent_groups(
    topology_groups: Mapping[str, Any],
) -> dict[str, list[int]]:
    return {
        "semi1": [int(item) for item in topology_groups["semi1"]],
        "semi2": [int(item) for item in topology_groups["semi2"]],
        "semi3": [int(item) for item in topology_groups["semi3"]],
        "product": ["semi1", "semi2", "semi3"],
    }


def _evaluate_q3_policies(
    rates: np.ndarray,
    policies: np.ndarray | None = None,
    topology_groups: Mapping[str, Any] | None = None,
) -> dict[str, np.ndarray]:
    """在完整策略空间上向量化重算树状装配网络。"""
    rate_matrix = np.asarray(rates, dtype=float)
    if rate_matrix.ndim == 1:
        rate_matrix = rate_matrix.reshape(1, -1)
    if rate_matrix.shape[1] != Q3_PARAMETER_NODE_COUNT:
        raise ValueError("问题三概率向量维度异常")
    if np.any(rate_matrix < 0) or np.any(rate_matrix > 1):
        raise ValueError("问题三概率必须位于零到一之间")

    policy_matrix = (
        _q3_policy_matrix()
        if policies is None
        else np.asarray(policies, dtype=np.int8)
    )
    if policy_matrix.ndim != 2 or policy_matrix.shape[1] != Q3_TOTAL_DECISION_COUNT:
        raise ValueError("问题三策略矩阵维度异常")

    groups = _q3_parent_groups(
        Q3_PRIMARY_PARENT_GROUPS
        if topology_groups is None
        else topology_groups
    )
    strategy_count = policy_matrix.shape[0]
    batch_size = rate_matrix.shape[0]
    node_data: dict[str, dict[str, np.ndarray]] = {}

    for node_index, node in enumerate(Q3_PARTS):
        inspection = policy_matrix[:, node_index, None].astype(bool)
        defect_rate = rate_matrix[:, node_index][None, :]
        success_probability = 1 - defect_rate
        safe_success = np.where(
            success_probability > 0,
            success_probability,
            1,
        )
        inspected_cost = (
            float(node["purchase_price"])
            + float(node["inspection_cost"])
        ) / safe_success
        inspected_cost = np.where(
            inspection,
            inspected_cost,
            float(node["purchase_price"]),
        )
        inspected_cost = np.where(
            inspection & (success_probability <= 0),
            np.inf,
            inspected_cost,
        )
        good_probability = np.where(
            inspection,
            1.0,
            success_probability,
        )
        finite = np.isfinite(inspected_cost) & (
            (~inspection) | (success_probability > 0)
        )
        label = _q3_node_label(node)
        node_data[label] = {
            "cost": inspected_cost,
            "good_probability": good_probability,
            "finite": finite,
            "inspection": inspection,
        }

    for semi_index, node in enumerate(Q3_SEMIS):
        label = f"semi{semi_index + 1}"
        inspection = policy_matrix[
            :,
            Q3_INSPECTION_DECISION_COUNT
            - Q3_DISPOSAL_DECISION_COUNT
            + semi_index,
            None,
        ].astype(bool)
        disassembly = policy_matrix[
            :,
            Q3_INSPECTION_DECISION_COUNT + semi_index,
            None,
        ].astype(bool)
        child_labels = [f"part{item}" for item in groups[label]]
        child_cost = np.zeros(
            (strategy_count, batch_size),
            dtype=float,
        )
        child_good = np.ones(
            (strategy_count, batch_size),
            dtype=float,
        )
        child_finite = np.ones(
            (strategy_count, batch_size),
            dtype=bool,
        )
        reactivation_cost = np.zeros(
            (strategy_count, batch_size),
            dtype=float,
        )
        children_guaranteed_good = np.ones(
            (strategy_count, batch_size),
            dtype=bool,
        )
        for child_label in child_labels:
            child = node_data[child_label]
            child_cost += child["cost"]
            child_good *= child["good_probability"]
            child_finite &= child["finite"]
            children_guaranteed_good &= (
                child["good_probability"] >= 1
            )
            reactivation_cost += (
                child["inspection"]
                * float(
                    Q3_PART_PARAMETERS[
                        int(child_label.removeprefix("part")) - 1
                    ]["inspection_cost"]
                )
            )

        defect_rate = rate_matrix[
            :,
            len(Q3_PARTS) + semi_index,
        ][None, :]
        intrinsic_bad_probability = 1 - defect_rate
        raw_good_probability = child_good * (
            1 - defect_rate
        )
        raw_launch_cost = (
            child_cost
            + float(node["assembly_cost"])
        )
        inspected_attempt_cost = (
            raw_launch_cost
            + float(node["inspection_cost"])
        )
        geometric_cost = np.divide(
            inspected_attempt_cost,
            raw_good_probability,
            out=np.full_like(inspected_attempt_cost, np.inf),
            where=raw_good_probability > 0,
        )
        safe_intrinsic_bad = np.where(
            intrinsic_bad_probability > 0,
            intrinsic_bad_probability,
            1,
        )
        salvage_cost = (
            inspected_attempt_cost
            + intrinsic_bad_probability
            * (
                float(node["disassembly_cost"])
                + reactivation_cost
            )
        ) / safe_intrinsic_bad
        salvage_cost = np.where(
            intrinsic_bad_probability > 0,
            salvage_cost,
            np.inf,
        )
        selected_inspected_cost = np.where(
            disassembly & children_guaranteed_good,
            salvage_cost,
            geometric_cost,
        )
        selected_cost = np.where(
            inspection,
            selected_inspected_cost,
            raw_launch_cost,
        )
        selected_good_probability = np.where(
            inspection,
            1.0,
            raw_good_probability,
        )
        can_finish_if_inspected = np.where(
            disassembly,
            children_guaranteed_good
            & (intrinsic_bad_probability > 0),
            raw_good_probability > 0,
        )
        finite = child_finite & np.where(
            inspection,
            can_finish_if_inspected,
            raw_good_probability > 0,
        ) & np.isfinite(selected_cost)
        node_data[label] = {
            "cost": selected_cost,
            "good_probability": selected_good_probability,
            "finite": finite,
            "inspection": inspection,
        }
        for child_label in child_labels:
            node_data.pop(child_label, None)

    root = node_data["product"]
    root_inspection = root["inspection"]
    root_disassembly = policy_matrix[:, Q3_TOTAL_DECISION_COUNT - 1, None].astype(bool)
    child_labels = ["semi1", "semi2", "semi3"]
    child_cost = np.zeros(
        (strategy_count, batch_size),
        dtype=float,
    )
    child_good = np.ones(
        (strategy_count, batch_size),
        dtype=float,
    )
    child_finite = np.ones(
        (strategy_count, batch_size),
        dtype=bool,
    )
    children_guaranteed_good = np.ones(
        (strategy_count, batch_size),
        dtype=bool,
    )
    reactivation_cost = np.zeros(
        (strategy_count, batch_size),
        dtype=float,
    )
    for child_label in child_labels:
        child = node_data[child_label]
        child_cost += child["cost"]
        child_good *= child["good_probability"]
        child_finite &= child["finite"]
        children_guaranteed_good &= (
            child["good_probability"] >= 1
        )
        child_node = Q3_SEMI_PARAMETERS[
            int(child_label.removeprefix("semi")) - 1
        ]
        reactivation_cost += (
            child["inspection"]
            * float(child_node["inspection_cost"])
        )

    root_defect_rate = rate_matrix[:, Q3_PARAMETER_NODE_COUNT - 1][None, :]
    root_raw_good = child_good * (1 - root_defect_rate)
    root_launch_cost = child_cost + float(Q3_ROOT_ASSEMBLY_COST)
    root_bad_probability = 1 - root_raw_good
    safe_root_good = np.where(
        root_raw_good > 0,
        root_raw_good,
        1,
    )
    root_bad_to_good_ratio = root_bad_probability / safe_root_good

    no_test_scrap_cost = root_launch_cost / safe_root_good
    no_test_disassembly_cost = (
        child_cost
        + float(Q3_ROOT_ASSEMBLY_COST)
        + root_bad_to_good_ratio
        * (
            float(Q3_ROOT_ASSEMBLY_COST)
            + float(Q3_ROOT_DISASSEMBLY_COST)
            + reactivation_cost
        )
    )
    no_test_disassembly_cost = np.where(
        root_raw_good > 0,
        no_test_disassembly_cost,
        np.inf,
    )

    root_finite = (
        child_finite
        & (~root_disassembly | children_guaranteed_good)
        & (root_raw_good > 0)
        & np.isfinite(root["cost"])
    )
    profits = np.full(
        (strategy_count, batch_size),
        np.inf,
        dtype=float,
    )

    tested_profit = float(Q3_MARKET_PRICE) - root["cost"]
    tested_mask = root_inspection
    profits[tested_mask] = tested_profit[tested_mask]
    root_finite[tested_mask] &= np.isfinite(tested_profit)[tested_mask]

    untested_mask = ~root_inspection
    no_test_cost = np.where(
        root_disassembly,
        no_test_disassembly_cost,
        no_test_scrap_cost,
    )
    untested_profit = (
        float(Q3_MARKET_PRICE)
        - no_test_cost
        - root_bad_to_good_ratio * float(Q3_EXCHANGE_LOSS)
    )
    profits[untested_mask] = untested_profit[untested_mask]
    root_finite[untested_mask] &= np.isfinite(
        untested_profit
    )[untested_mask]
    profits[~root_finite] = np.inf

    return {
        "profits": profits,
        "valid": root_finite,
        "root_output_rate": np.where(
            root_inspection,
            1.0,
            root_raw_good,
        ),
        "root_launch_cost_rate": np.where(
            root_inspection,
            root["cost"],
            root_launch_cost,
        ),
        "state_count": np.full(
            (strategy_count, batch_size),
            Q3_REACHABLE_STATE_LIMIT,
            dtype=np.int64,
        ),
    }


def _q3_single_policy_metrics(
    rates: np.ndarray,
    policy: np.ndarray,
    topology_groups: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """独立标量复算所选策略的 Q、C 与 U=C/Q 节点指标。"""
    rate_vector = np.asarray(rates, dtype=float).reshape(-1)
    policy_vector = np.asarray(policy, dtype=np.int8).reshape(-1)
    groups = _q3_parent_groups(
        Q3_PRIMARY_PARENT_GROUPS
        if topology_groups is None
        else topology_groups
    )
    metrics: dict[str, dict[str, float | bool]] = {}

    for node_index, node in enumerate(Q3_PARTS):
        inspected = bool(policy_vector[node_index])
        success_probability = 1 - float(rate_vector[node_index])
        if inspected and success_probability <= 0:
            cost = np.inf
        elif inspected:
            cost = (
                float(node["purchase_price"])
                + float(node["inspection_cost"])
            ) / success_probability
        else:
            cost = float(node["purchase_price"])
        quality_probability = 1.0 if inspected else success_probability
        metrics[_q3_node_label(node)] = {
            "output_rate": quality_probability,
            "launch_cost_rate": cost,
            "unit_good_cost": (
                cost / quality_probability
                if quality_probability > 0
                else np.inf
            ),
            "finite": bool(np.isfinite(cost)),
        }

    for semi_index, node in enumerate(Q3_SEMIS):
        label = f"semi{semi_index + 1}"
        inspected = bool(
            policy_vector[
                Q3_INSPECTION_DECISION_COUNT
                - Q3_DISPOSAL_DECISION_COUNT
                + semi_index
            ]
        )
        disassemble = bool(
            policy_vector[
                Q3_INSPECTION_DECISION_COUNT + semi_index
            ]
        )
        child_labels = [f"part{item}" for item in groups[label]]
        child_metrics = [metrics[item] for item in child_labels]
        child_cost = sum(
            float(item["launch_cost_rate"])
            for item in child_metrics
        )
        child_good = float(
            np.prod(
                [float(item["output_rate"]) for item in child_metrics]
            )
        )
        all_guaranteed = all(
            float(item["output_rate"]) >= 1
            for item in child_metrics
        )
        reactivation = sum(
            float(
                Q3_PART_PARAMETERS[
                    int(item.removeprefix("part")) - 1
                ]["inspection_cost"]
            )
            * bool(
                policy_vector[
                    int(item.removeprefix("part")) - 1
                ]
            )
            for item in child_labels
        )
        node_rate = float(rate_vector[len(Q3_PARTS) + semi_index])
        raw_good = child_good * (1 - node_rate)
        raw_cost = child_cost + float(node["assembly_cost"])
        if inspected:
            attempt_cost = raw_cost + float(node["inspection_cost"])
            if raw_good <= 0:
                cost = np.inf
            elif disassemble and all_guaranteed and node_rate < 1:
                cost = (
                    attempt_cost
                    + (1 - node_rate)
                    * (
                        float(node["disassembly_cost"])
                        + reactivation
                    )
                ) / (1 - node_rate)
            elif disassemble:
                cost = np.inf
            else:
                cost = attempt_cost / raw_good
            output_rate = 1.0
        else:
            cost = raw_cost
            output_rate = raw_good
        metrics[label] = {
            "output_rate": output_rate,
            "launch_cost_rate": cost,
            "unit_good_cost": (
                cost / output_rate
                if output_rate > 0
                else np.inf
            ),
            "finite": bool(np.isfinite(cost)),
        }

    root_inspected = bool(
        policy_vector[Q3_INSPECTION_DECISION_COUNT - 1]
    )
    root_disassemble = bool(
        policy_vector[Q3_TOTAL_DECISION_COUNT - 1]
    )
    root_children = [metrics["semi1"], metrics["semi2"], metrics["semi3"]]
    root_child_cost = sum(
        float(item["launch_cost_rate"])
        for item in root_children
    )
    root_child_good = float(
        np.prod([float(item["output_rate"]) for item in root_children])
    )
    root_all_guaranteed = all(
        float(item["output_rate"]) >= 1
        for item in root_children
    )
    root_rate = float(rate_vector[Q3_PARAMETER_NODE_COUNT - 1])
    raw_good = root_child_good * (1 - root_rate)
    raw_cost = root_child_cost + float(Q3_ROOT_ASSEMBLY_COST)
    if root_inspected:
        attempt_cost = raw_cost + float(Q3_ROOT_INSPECTION_COST)
        if raw_good <= 0:
            root_cost = np.inf
        elif root_disassemble and root_all_guaranteed and root_rate < 1:
            root_reactivation = sum(
                float(Q3_SEMI_PARAMETERS[index]["inspection_cost"])
                * bool(
                    policy_vector[
                        Q3_INSPECTION_DECISION_COUNT
                        - Q3_DISPOSAL_DECISION_COUNT
                        + index
                    ]
                )
                for index in range(len(Q3_SEMI_PARAMETERS))
            )
            root_cost = (
                attempt_cost
                + (1 - root_rate)
                * (
                    float(Q3_ROOT_DISASSEMBLY_COST)
                    + root_reactivation
                )
            ) / (1 - root_rate)
        elif root_disassemble:
            root_cost = np.inf
        else:
            root_cost = attempt_cost / raw_good
        root_output_rate = 1.0
        profit = float(Q3_MARKET_PRICE) - root_cost
    else:
        root_output_rate = raw_good
        bad_ratio = (
            (1 - raw_good) / raw_good
            if raw_good > 0
            else np.inf
        )
        if root_disassemble and root_all_guaranteed:
            root_reactivation = sum(
                float(Q3_SEMI_PARAMETERS[index]["inspection_cost"])
                * bool(
                    policy_vector[
                        Q3_INSPECTION_DECISION_COUNT
                        - Q3_DISPOSAL_DECISION_COUNT
                        + index
                    ]
                )
                for index in range(len(Q3_SEMI_PARAMETERS))
            )
            cost = (
                root_child_cost
                + float(Q3_ROOT_ASSEMBLY_COST)
                + bad_ratio
                * (
                    float(Q3_ROOT_ASSEMBLY_COST)
                    + float(Q3_ROOT_DISASSEMBLY_COST)
                    + root_reactivation
                )
            )
        elif root_disassemble:
            cost = np.inf
        else:
            cost = raw_cost / raw_good if raw_good > 0 else np.inf
        profit = (
            float(Q3_MARKET_PRICE)
            - cost
            - bad_ratio * float(Q3_EXCHANGE_LOSS)
            if np.isfinite(cost)
            else np.inf
        )

    metrics["product"] = {
        "output_rate": root_output_rate,
        "launch_cost_rate": root_cost,
        "unit_good_cost": (
            root_cost / root_output_rate
            if root_output_rate > 0
            else np.inf
        ),
        "finite": bool(np.isfinite(root_cost)),
    }
    return {
        "nodes": metrics,
        "root_profit": profit,
        "root_profit_unit": PROFIT_UNIT,
    }


def _degenerate_q3_policy_profit(
    case: Mapping[str, Any],
    policy: np.ndarray | list[int],
) -> float:
    """用一般网络的两零件退化规格独立复算问题二同一策略。"""
    values = [int(item) for item in policy]
    component_data: list[tuple[float, float]] = []
    for policy_index, rate_name, price_name, test_name in (
        (0, "p1", "a1", "t1"),
        (1, "p2", "a2", "t2"),
    ):
        rate = float(case[rate_name])
        if values[policy_index]:
            if rate >= 1:
                return np.inf
            cost = (
                float(case[price_name])
                + float(case[test_name])
            ) / (1 - rate)
            quality_probability = 1.0
        else:
            cost = float(case[price_name])
            quality_probability = 1 - rate
        component_data.append((cost, quality_probability))

    raw_good = (
        component_data[0][1]
        * component_data[1][1]
        * (1 - float(case["pf"]))
    )
    raw_cost = (
        component_data[0][0]
        + component_data[1][0]
        + float(case["kf"])
    )
    all_children_guaranteed = all(
        item[1] >= 1
        for item in component_data
    )
    if raw_good <= 0:
        return np.inf

    if values[2]:
        attempt_cost = raw_cost + float(case["tf"])
        if values[3] and all_children_guaranteed:
            reactivation = (
                float(case["t1"]) * values[0]
                + float(case["t2"]) * values[1]
            )
            cost = (
                attempt_cost
                + float(case["pf"])
                * (
                    float(case["g_dis"])
                    + reactivation
                )
            ) / (1 - float(case["pf"]))
        elif values[3]:
            return np.inf
        else:
            cost = attempt_cost / raw_good
        return float(case["sale_price"]) - cost

    bad_ratio = (1 - raw_good) / raw_good
    if values[3] and all_children_guaranteed:
        reactivation = (
            float(case["t1"]) * values[0]
            + float(case["t2"]) * values[1]
        )
        cost = (
            component_data[0][0]
            + component_data[1][0]
            + float(case["kf"])
            + bad_ratio
            * (
                float(case["kf"])
                + float(case["g_dis"])
                + reactivation
            )
        )
    elif values[3]:
        return np.inf
    else:
        cost = raw_cost / raw_good
    return (
        float(case["sale_price"])
        - cost
        - bad_ratio * float(case["L_exchange"])
    )


def q2_degenerate_16_policy_equivalence(
    case: Mapping[str, Any],
) -> dict[str, Any]:
    """逐策略核验问题二与一般网络退化规格。"""
    policies = _q2_policy_matrix()
    q2_result = _evaluate_q2_policies(
        np.asarray(
            [case["p1"], case["p2"], case["pf"]],
            dtype=float,
        )[None, :],
        case,
        policies,
    )
    gaps: list[float] = []
    for policy_index, policy in enumerate(policies):
        q3_profit = _degenerate_q3_policy_profit(case, policy)
        q2_profit = q2_result["profits"][policy_index, 0]
        if not np.isfinite(q2_profit) and not np.isfinite(q3_profit):
            gaps.append(0.0)
        elif np.isfinite(q2_profit) and np.isfinite(q3_profit):
            gaps.append(abs(float(q2_profit) - float(q3_profit)))
        else:
            gaps.append(np.inf)
    max_gap = max(gaps)
    return {
        "case_id": str(case["case_id"]),
        "policy_count": int(len(policies)),
        "max_absolute_profit_gap": max_gap,
        "tolerance": CASHFLOW_ABS_TOL,
        "passed": bool(max_gap <= CASHFLOW_ABS_TOL),
    }


def _draw_scenario_observations(
    defect_rates: np.ndarray,
    sample_sizes: np.ndarray,
    rng: np.random.Generator,
) -> dict[str, np.ndarray]:
    """先生成可审计计数，再由计数形成点估计和 Jeffreys 重抽样。"""
    rate_vector = np.asarray(defect_rates, dtype=float)
    size_vector = np.asarray(sample_sizes, dtype=np.int64)
    baseline_counts = np.asarray(
        scipy.stats.binom.rvs(
            size_vector,
            rate_vector,
            random_state=rng,
        ),
        dtype=np.int64,
    )
    repeated_counts = np.asarray(
        scipy.stats.binom.rvs(
            size_vector,
            rate_vector,
            size=Q4_SCENARIO_REPETITIONS,
            random_state=rng,
        ),
        dtype=np.int64,
    )
    baseline_estimates = baseline_counts / size_vector
    repeated_estimates = repeated_counts / size_vector
    posterior_rates = rng.beta(
        repeated_counts + Q4_JEFFREYS_PRIOR_ALPHA,
        size_vector - repeated_counts + Q4_JEFFREYS_PRIOR_BETA,
    )
    return {
        "baseline_x": baseline_counts,
        "baseline_p_hat": baseline_estimates,
        "repeated_x": repeated_counts,
        "repeated_p_hat": repeated_estimates,
        "posterior_theta": posterior_rates,
    }


def _corner_rate_matrix(
    lower: np.ndarray,
    upper: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    parameter_count = len(lower)
    corners = np.asarray(
        list(product((0, 1), repeat=parameter_count)),
        dtype=np.int8,
    )
    rates = np.empty(
        (corners.shape[0], parameter_count),
        dtype=float,
    )
    for corner_index, corner in enumerate(corners):
        for parameter_index in range(parameter_count):
            rates[corner_index, parameter_index] = (
                upper[parameter_index]
                if corner[parameter_index]
                else lower[parameter_index]
            )
    return corners, rates


def _policy_table(
    policy_matrix: np.ndarray,
    profits: np.ndarray,
    valid: np.ndarray,
) -> dict[str, Any]:
    return {
        "policy_count": int(policy_matrix.shape[0]),
        "policy_codes": list(range(int(policy_matrix.shape[0]))),
        "policy_vectors": [
            [int(item) for item in policy]
            for policy in policy_matrix
        ],
        "profit_values": [float(item) for item in profits],
        "finite_flags": [bool(item) for item in valid],
    }


def _running_statistics(values: np.ndarray) -> dict[str, list[float]]:
    vector = np.asarray(values, dtype=float)
    counts = np.arange(1, len(vector) + 1, dtype=float)
    cumulative_sum = np.cumsum(vector)
    cumulative_square_sum = np.cumsum(vector * vector)
    mean = cumulative_sum / counts
    variance = np.maximum(
        cumulative_square_sum / counts - mean * mean,
        0.0,
    )
    return {
        "running_mean": mean,
        "running_standard_deviation": np.sqrt(variance),
    }


def decision_reopt(
    rates: np.ndarray,
    evaluator: str,
    case: Mapping[str, Any] | None = None,
    topology_groups: Mapping[str, Any] | None = None,
    batch_size: int | None = None,
) -> dict[str, Any]:
    """按当前抽样率逐批重新求完整策略空间 argmax。"""
    rate_matrix = np.asarray(rates, dtype=float)
    if rate_matrix.ndim == 1:
        rate_matrix = rate_matrix.reshape(1, -1)
    repetitions = rate_matrix.shape[0]
    if evaluator == "problem2":
        if case is None:
            raise ValueError("问题二重优化必须提供 case")
        policies = _q2_policy_matrix()
        active_batch_size = (
            _Q2_BATCH_SIZE
            if batch_size is None
            else int(batch_size)
        )
    elif evaluator == "problem3":
        policies = _q3_policy_matrix()
        active_batch_size = (
            _Q3_BATCH_SIZE
            if batch_size is None
            else int(batch_size)
        )
    else:
        raise ValueError("未知重优化问题")

    strategy_count = policies.shape[0]
    selected_indices = np.empty(repetitions, dtype=np.int64)
    selected_profits = np.empty(repetitions, dtype=float)
    tie_multiplicities = np.empty(repetitions, dtype=np.int64)
    full_strategy_evaluations = 0

    for start in range(0, repetitions, active_batch_size):
        stop = min(start + active_batch_size, repetitions)
        if evaluator == "problem2":
            evaluated = _evaluate_q2_policies(
                rate_matrix[start:stop],
                case,
                policies,
            )
        else:
            evaluated = _evaluate_q3_policies(
                rate_matrix[start:stop],
                policies,
                topology_groups,
            )
        profits = evaluated["profits"]
        valid = evaluated["valid"]
        if np.any(~np.any(valid, axis=0)):
            raise RuntimeError("重优化批次存在无可行吸收策略")
        maxima = np.max(profits, axis=0)
        batch_indices = np.argmax(profits, axis=0)
        selected_indices[start:stop] = batch_indices
        selected_profits[start:stop] = maxima
        tie_multiplicities[start:stop] = np.sum(
            np.isclose(profits, maxima[None, :], equal_nan=False),
            axis=0,
        )
        full_strategy_evaluations += (
            (stop - start) * strategy_count
        )

    policy_trace = policies[selected_indices]
    return {
        "policy_indices": selected_indices,
        "policy_trace": policy_trace,
        "profit_trace": selected_profits,
        "tie_multiplicities": tie_multiplicities,
        "full_strategy_evaluations": int(full_strategy_evaluations),
        "policy_count_per_reoptimization": int(strategy_count),
    }


def _solve_q2_case(
    case: Mapping[str, Any],
    rng: np.random.Generator,
) -> dict[str, Any]:
    scenario_rates = np.asarray(
        [case["p1"], case["p2"], case["pf"]],
        dtype=float,
    )
    precision_records: list[dict[str, Any]] = []
    sample_sizes: list[int] = []
    for scenario_rate in scenario_rates:
        precision = _parameter_precision_scan(
            float(scenario_rate),
            Q4_Q2_MARGINAL_ERROR_RATE,
            Q4_SINGLE_PARAMETER_N_MAX,
            Q4_WIDTH_TARGET,
        )
        if precision["selected_n"] is None:
            raise RuntimeError("问题二节点未达到登记区间宽度目标")
        precision_records.append(precision)
        sample_sizes.append(int(precision["selected_n"]))

    observations = _draw_scenario_observations(
        scenario_rates,
        np.asarray(sample_sizes, dtype=np.int64),
        rng,
    )
    point_rates = observations["baseline_p_hat"]
    intervals = {
        name: clopper_pearson(
            int(observations["baseline_x"][index]),
            int(sample_sizes[index]),
            Q4_Q2_MARGINAL_ERROR_RATE,
        )
        for index, name in enumerate(_Q2_PARAMETER_NAMES)
    }
    lower = np.asarray(
        [intervals[name][0] for name in _Q2_PARAMETER_NAMES],
        dtype=float,
    )
    upper = np.asarray(
        [intervals[name][1] for name in _Q2_PARAMETER_NAMES],
        dtype=float,
    )
    corners, corner_rates = _corner_rate_matrix(lower, upper)

    policies = _q2_policy_matrix()
    nominal = _evaluate_q2_policies(scenario_rates, case, policies)
    point = _evaluate_q2_policies(point_rates, case, policies)
    robust = _evaluate_q2_policies(corner_rates, case, policies)

    nominal_index = int(np.argmax(nominal["profits"][:, 0]))
    point_index = int(np.argmax(point["profits"][:, 0]))
    robust_index = int(np.argmax(np.min(robust["profits"], axis=1)))
    if not nominal["valid"][nominal_index, 0]:
        raise RuntimeError("问题二标称策略未通过吸收性检查")
    if not point["valid"][point_index, 0]:
        raise RuntimeError("问题二点估计策略未通过吸收性检查")
    if not robust["valid"][robust_index, 0]:
        raise RuntimeError("问题二稳健策略未通过吸收性检查")

    lower_profit_by_policy = np.min(robust["profits"], axis=1)
    upper_profit_by_policy = np.max(robust["profits"], axis=1)
    nominal_policy = policies[nominal_index]
    point_policy = policies[point_index]
    robust_policy = policies[robust_index]

    reoptimization = decision_reopt(
        observations["repeated_p_hat"],
        "problem2",
        case,
    )
    policy_trace = reoptimization["policy_trace"]
    point_profit_trace = reoptimization["profit_trace"]
    policy_matches = policy_trace == nominal_policy[None, :]
    consistency_trace = np.mean(
        policy_matches,
        axis=1,
    )
    posterior_profit_trace = np.empty(
        Q4_SCENARIO_REPETITIONS,
        dtype=float,
    )
    for start in range(0, Q4_SCENARIO_REPETITIONS, _Q2_BATCH_SIZE):
        stop = min(start + _Q2_BATCH_SIZE, Q4_SCENARIO_REPETITIONS)
        nominal_only = _evaluate_q2_policies(
            observations["posterior_theta"][start:stop],
            case,
            nominal_policy[None, :],
        )
        posterior_profit_trace[start:stop] = nominal_only["profits"][0]

    all_policy_profit_samples = np.empty(
        (Q4_SCENARIO_REPETITIONS, len(policies)),
        dtype=float,
    )
    for start in range(0, Q4_SCENARIO_REPETITIONS, _Q2_BATCH_SIZE):
        stop = min(start + _Q2_BATCH_SIZE, Q4_SCENARIO_REPETITIONS)
        evaluated = _evaluate_q2_policies(
            observations["repeated_p_hat"][start:stop],
            case,
            policies,
        )
        all_policy_profit_samples[start:stop] = evaluated["profits"].T

    point_running = _running_statistics(point_profit_trace)
    posterior_running = _running_statistics(posterior_profit_trace)
    empirical_quantiles = np.quantile(
        point_profit_trace,
        [
            Q4_FAMILY_ERROR_RATE / 2,
            1 - Q4_FAMILY_ERROR_RATE / 2,
            Q4_CONFIDENCE_LEVEL,
        ],
    )

    sample_ledger = {
        "node_order": list(_Q2_PARAMETER_NAMES),
        "n": [int(item) for item in sample_sizes],
        "baseline_x": [
            int(item) for item in observations["baseline_x"]
        ],
        "baseline_p_hat": [
            float(item) for item in observations["baseline_p_hat"]
        ],
        "repeated_x": observations["repeated_x"].astype(int).tolist(),
        "repeated_p_hat": observations["repeated_p_hat"].tolist(),
        "posterior_theta": observations["posterior_theta"].tolist(),
    }

    return {
        "case_id": str(case["case_id"]),
        "analysis_status": "scenario_analysis_without_actual_samples",
        "scenario_rates": {
            name: float(scenario_rates[index])
            for index, name in enumerate(_Q2_PARAMETER_NAMES)
        },
        "planning_sample_sizes": {
            name: int(sample_sizes[index])
            for index, name in enumerate(_Q2_PARAMETER_NAMES)
        },
        "parameter_precision_curves": precision_records,
        "observed_scenario_sample": sample_ledger["node_order"],
        "baseline_observation": {
            name: {
                "n": int(sample_sizes[index]),
                "x": int(observations["baseline_x"][index]),
                "p_hat": float(
                    observations["baseline_p_hat"][index]
                ),
            }
            for index, name in enumerate(_Q2_PARAMETER_NAMES)
        },
        "point_estimates": {
            name: float(point_rates[index])
            for index, name in enumerate(_Q2_PARAMETER_NAMES)
        },
        "confidence_intervals": {
            name: {
                "lower": intervals[name][0],
                "upper": intervals[name][1],
                "width": intervals[name][1] - intervals[name][0],
                "marginal_alpha": Q4_Q2_MARGINAL_ERROR_RATE,
            }
            for name in _Q2_PARAMETER_NAMES
        },
        "joint_box": bonferroni_joint_box(
            intervals,
            Q4_Q2_MARGINAL_ERROR_RATE,
            Q4_FAMILY_ERROR_RATE,
        ),
        "nominal_policy": [int(item) for item in nominal_policy],
        "nominal_policy_record": _q2_policy_record(nominal_policy),
        "nominal_policy_profit": float(
            nominal["profits"][nominal_index, 0]
        ),
        "point_policy": [int(item) for item in point_policy],
        "point_policy_record": _q2_policy_record(point_policy),
        "point_policy_profit": float(
            point["profits"][point_index, 0]
        ),
        "robust_policy": [int(item) for item in robust_policy],
        "robust_policy_record": _q2_policy_record(robust_policy),
        "profit_interval": [
            float(lower_profit_by_policy[robust_index]),
            float(upper_profit_by_policy[robust_index]),
        ],
        "profit_interval_unit": PROFIT_UNIT,
        "optimistic_policy_envelope": [
            float(np.max(lower_profit_by_policy)),
            float(np.max(upper_profit_by_policy)),
        ],
        "robust_corner_count": int(corners.shape[0]),
        "robust_corner_rates": corner_rates.tolist(),
        "sixteen_policy_nominal_table": _policy_table(
            policies,
            nominal["profits"][:, 0],
            nominal["valid"][:, 0],
        ),
        "sixteen_policy_point_table": _policy_table(
            policies,
            point["profits"][:, 0],
            point["valid"][:, 0],
        ),
        "decision_consistency": float(np.mean(policy_matches)),
        "decision_basis": (
            "在全部登记二值策略中，对每个固定抽样点估计重新求吸收型"
            "事件利润 argmax；稳健策略在 Bonferroni 联合域内取最坏利润。"
        ),
        "monte_carlo": {
            "reoptimization_input": "p_hat=x/n",
            "policy_trace": policy_trace.astype(int).tolist(),
            "point_policy_profit_trace": point_profit_trace.tolist(),
            "posterior_nominal_policy_profit_trace": (
                posterior_profit_trace.tolist()
            ),
            "decision_consistency_convergence": consistency_trace.tolist(),
            "point_profit_running_mean": point_running[
                "running_mean"
            ].tolist(),
            "point_profit_running_standard_deviation": point_running[
                "running_standard_deviation"
            ].tolist(),
            "posterior_profit_running_mean": posterior_running[
                "running_mean"
            ].tolist(),
            "posterior_profit_running_standard_deviation": posterior_running[
                "running_standard_deviation"
            ].tolist(),
            "empirical_profit_quantiles": empirical_quantiles.tolist(),
            "policy_tie_multiplicity": reoptimization[
                "tie_multiplicities"
            ].astype(int).tolist(),
            "full_strategy_evaluations": reoptimization[
                "full_strategy_evaluations"
            ],
            "policy_count_per_reoptimization": reoptimization[
                "policy_count_per_reoptimization"
            ],
            "sample_ledger": sample_ledger,
            "policy_profit_samples": all_policy_profit_samples.tolist(),
        },
        "bellman_max_absolute_residual": float(
            np.max(nominal["bellman_residual"][:, 0])
        ),
        "absorption_probability": float(
            nominal["absorption_probability"][nominal_index, 0]
        ),
    }


def _q3_profile(
    nominal_rates: np.ndarray,
    point_rates: np.ndarray,
    lower: np.ndarray,
    upper: np.ndarray,
    topology_groups: Mapping[str, Any],
) -> dict[str, Any]:
    policies = _q3_policy_matrix()
    corners, corner_rates = _corner_rate_matrix(lower, upper)
    nominal = _evaluate_q3_policies(
        nominal_rates,
        policies,
        topology_groups,
    )
    point = _evaluate_q3_policies(
        point_rates,
        policies,
        topology_groups,
    )
    robust = _evaluate_q3_policies(
        corner_rates,
        policies,
        topology_groups,
    )
    nominal_index = int(np.argmax(nominal["profits"][:, 0]))
    point_index = int(np.argmax(point["profits"][:, 0]))
    robust_index = int(np.argmax(np.min(robust["profits"], axis=1)))
    if not nominal["valid"][nominal_index, 0]:
        raise RuntimeError("问题三标称策略没有有限合格产出")
    if not point["valid"][point_index, 0]:
        raise RuntimeError("问题三点估计策略没有有限合格产出")
    if not robust["valid"][robust_index, 0]:
        raise RuntimeError("问题三稳健策略没有有限合格产出")

    lower_profit_by_policy = np.min(robust["profits"], axis=1)
    upper_profit_by_policy = np.max(robust["profits"], axis=1)
    return {
        "policy_matrix": policies,
        "nominal_policy": policies[nominal_index],
        "nominal_policy_index": nominal_index,
        "nominal_policy_profit": float(
            nominal["profits"][nominal_index, 0]
        ),
        "point_policy": policies[point_index],
        "point_policy_index": point_index,
        "point_policy_profit": float(
            point["profits"][point_index, 0]
        ),
        "robust_policy": policies[robust_index],
        "robust_policy_index": robust_index,
        "profit_interval": [
            float(lower_profit_by_policy[robust_index]),
            float(upper_profit_by_policy[robust_index]),
        ],
        "optimistic_policy_envelope": [
            float(np.max(lower_profit_by_policy)),
            float(np.max(upper_profit_by_policy)),
        ],
        "corner_count": int(corners.shape[0]),
        "corner_rates": corner_rates.tolist(),
        "nominal_policy_table": _policy_table(
            policies,
            nominal["profits"][:, 0],
            nominal["valid"][:, 0],
        ),
        "point_policy_table": _policy_table(
            policies,
            point["profits"][:, 0],
            point["valid"][:, 0],
        ),
    }


def _solve_q3(
    rng: np.random.Generator,
) -> dict[str, Any]:
    scenario_rates = np.asarray(
        [float(node["defect_rate"]) for node in Q3_PARAMETER_NODES],
        dtype=float,
    )
    precision_records: list[dict[str, Any]] = []
    sample_sizes: list[int] = []
    for scenario_rate in scenario_rates:
        precision = _parameter_precision_scan(
            scenario_rate,
            Q4_Q3_MARGINAL_ERROR_RATE,
            Q4_SINGLE_PARAMETER_N_MAX,
            Q4_WIDTH_TARGET,
        )
        if precision["selected_n"] is None:
            raise RuntimeError("问题三节点未达到登记区间宽度目标")
        precision_records.append(precision)
        sample_sizes.append(int(precision["selected_n"]))

    observations = _draw_scenario_observations(
        scenario_rates,
        np.asarray(sample_sizes, dtype=np.int64),
        rng,
    )
    point_rates = observations["baseline_p_hat"]
    node_labels = [
        _q3_node_label(node)
        for node in Q3_PARAMETER_NODES
    ]
    intervals = {
        label: clopper_pearson(
            int(observations["baseline_x"][index]),
            int(sample_sizes[index]),
            Q4_Q3_MARGINAL_ERROR_RATE,
        )
        for index, label in enumerate(node_labels)
    }
    lower = np.asarray(
        [intervals[label][0] for label in node_labels],
        dtype=float,
    )
    upper = np.asarray(
        [intervals[label][1] for label in node_labels],
        dtype=float,
    )

    primary = _q3_profile(
        scenario_rates,
        point_rates,
        lower,
        upper,
        Q3_PRIMARY_PARENT_GROUPS,
    )
    policies = primary["policy_matrix"]
    nominal_policy = primary["nominal_policy"]
    nominal_index = int(primary["nominal_policy_index"])

    reoptimization = decision_reopt(
        observations["repeated_p_hat"],
        "problem3",
        topology_groups=Q3_PRIMARY_PARENT_GROUPS,
    )
    policy_trace = reoptimization["policy_trace"]
    point_profit_trace = reoptimization["profit_trace"]
    policy_matches = policy_trace == nominal_policy[None, :]
    consistency_trace = np.mean(policy_matches, axis=1)

    posterior_profit_trace = np.empty(
        Q4_SCENARIO_REPETITIONS,
        dtype=float,
    )
    for start in range(0, Q4_SCENARIO_REPETITIONS, _Q3_BATCH_SIZE):
        stop = min(start + _Q3_BATCH_SIZE, Q4_SCENARIO_REPETITIONS)
        nominal_only = _evaluate_q3_policies(
            observations["posterior_theta"][start:stop],
            nominal_policy[None, :],
            Q3_PRIMARY_PARENT_GROUPS,
        )
        posterior_profit_trace[start:stop] = nominal_only["profits"][0]

    point_policy = primary["point_policy"]
    point_metrics = _q3_single_policy_metrics(
        point_rates,
        point_policy,
        Q3_PRIMARY_PARENT_GROUPS,
    )
    point_metric_profit_gap = abs(
        float(point_metrics["root_profit"])
        - float(primary["point_policy_profit"])
    )

    alternative = _q3_profile(
        scenario_rates,
        point_rates,
        lower,
        upper,
        Q3_ALTERNATIVE_PARENT_GROUPS,
    )
    point_running = _running_statistics(point_profit_trace)
    posterior_running = _running_statistics(posterior_profit_trace)
    empirical_quantiles = np.quantile(
        point_profit_trace,
        [
            Q4_FAMILY_ERROR_RATE / 2,
            1 - Q4_FAMILY_ERROR_RATE / 2,
            Q4_CONFIDENCE_LEVEL,
        ],
    )

    sample_ledger = {
        "node_order": node_labels,
        "n": [int(item) for item in sample_sizes],
        "baseline_x": [
            int(item) for item in observations["baseline_x"]
        ],
        "baseline_p_hat": [
            float(item) for item in observations["baseline_p_hat"]
        ],
        "repeated_x": observations["repeated_x"].astype(int).tolist(),
        "repeated_p_hat": observations["repeated_p_hat"].tolist(),
        "posterior_theta": observations["posterior_theta"].tolist(),
    }

    return {
        "official_topology_available": Q3_OFFICIAL_TOPOLOGY_AVAILABLE,
        "result_status": (
            "inferred_primary_and_alternative_scenarios"
            if not Q3_OFFICIAL_TOPOLOGY_AVAILABLE
            else "official_topology"
        ),
        "primary_inferred_scenario": {
            "scenario_rates": {
                label: float(scenario_rates[index])
                for index, label in enumerate(node_labels)
            },
            "planning_sample_sizes": {
                label: int(sample_sizes[index])
                for index, label in enumerate(node_labels)
            },
            "parameter_precision_curves": precision_records,
            "baseline_observation": {
                label: {
                    "n": int(sample_sizes[index]),
                    "x": int(observations["baseline_x"][index]),
                    "p_hat": float(
                        observations["baseline_p_hat"][index]
                    ),
                }
                for index, label in enumerate(node_labels)
            },
            "point_estimates": {
                label: float(point_rates[index])
                for index, label in enumerate(node_labels)
            },
            "confidence_intervals": {
                label: {
                    "lower": intervals[label][0],
                    "upper": intervals[label][1],
                    "width": intervals[label][1] - intervals[label][0],
                    "marginal_alpha": Q4_Q3_MARGINAL_ERROR_RATE,
                }
                for label in node_labels
            },
            "joint_box": bonferroni_joint_box(
                intervals,
                Q4_Q3_MARGINAL_ERROR_RATE,
                Q4_FAMILY_ERROR_RATE,
            ),
            "nominal_policy": [
                int(item) for item in nominal_policy
            ],
            "nominal_policy_record": _q3_policy_record(nominal_policy),
            "nominal_policy_profit": primary["nominal_policy_profit"],
            "point_policy": [int(item) for item in point_policy],
            "point_policy_record": _q3_policy_record(point_policy),
            "point_policy_profit": primary["point_policy_profit"],
            "robust_policy": [
                int(item) for item in primary["robust_policy"]
            ],
            "robust_policy_record": _q3_policy_record(
                primary["robust_policy"]
            ),
            "profit_interval": primary["profit_interval"],
            "profit_interval_unit": PROFIT_UNIT,
            "optimistic_policy_envelope": primary[
                "optimistic_policy_envelope"
            ],
            "robust_corner_count": primary["corner_count"],
            "robust_monotonicity_basis": (
                "所有题面金额成本与损失非负，任一条件次品率上升时"
                "固定策略利润不增加，故联合箱最劣值由下端点给出。"
            ),
            "node_metrics": {
                label: {
                    **metrics,
                    "unit": "Q=件/次；C=元/次；U=元/合格件",
                    "U_equals_C_over_Q_error": abs(
                        float(metrics["unit_good_cost"])
                        - float(metrics["launch_cost_rate"])
                        / float(metrics["output_rate"])
                    )
                    if float(metrics["output_rate"]) > 0
                    else np.inf,
                }
                for label, metrics in point_metrics["nodes"].items()
            },
            "full_nominal_policy_table": primary[
                "nominal_policy_table"
            ],
            "full_point_policy_table": primary["point_policy_table"],
            "decision_consistency": float(np.mean(policy_matches)),
            "decision_basis": (
                "主拓扑与替代拓扑均按全部登记策略逐项重算；"
                "每个抽样重优化均从完整策略表重新取 argmax。"
            ),
            "monte_carlo": {
                "reoptimization_input": "p_hat=x/n",
                "policy_trace": policy_trace.astype(int).tolist(),
                "point_policy_profit_trace": point_profit_trace.tolist(),
                "posterior_nominal_policy_profit_trace": (
                    posterior_profit_trace.tolist()
                ),
                "decision_consistency_convergence": (
                    consistency_trace.tolist()
                ),
                "point_profit_running_mean": point_running[
                    "running_mean"
                ].tolist(),
                "point_profit_running_standard_deviation": point_running[
                    "running_standard_deviation"
                ].tolist(),
                "posterior_profit_running_mean": posterior_running[
                    "running_mean"
                ].tolist(),
                "posterior_profit_running_standard_deviation": (
                    posterior_running[
                        "running_standard_deviation"
                    ].tolist()
                ),
                "empirical_profit_quantiles": empirical_quantiles.tolist(),
                "policy_tie_multiplicity": reoptimization[
                    "tie_multiplicities"
                ].astype(int).tolist(),
                "full_strategy_evaluations": reoptimization[
                    "full_strategy_evaluations"
                ],
                "policy_count_per_reoptimization": reoptimization[
                    "policy_count_per_reoptimization"
                ],
                "sample_ledger": sample_ledger,
            },
            "point_metric_root_profit_gap": point_metric_profit_gap,
        },
        "alternative_inferred_scenario": {
            "scenario_rates": {
                label: float(scenario_rates[index])
                for index, label in enumerate(node_labels)
            },
            "nominal_policy": [
                int(item) for item in alternative["nominal_policy"]
            ],
            "nominal_policy_record": _q3_policy_record(
                alternative["nominal_policy"]
            ),
            "nominal_policy_profit": alternative[
                "nominal_policy_profit"
            ],
            "point_policy": [
                int(item) for item in alternative["point_policy"]
            ],
            "point_policy_record": _q3_policy_record(
                alternative["point_policy"]
            ),
            "point_policy_profit": alternative["point_policy_profit"],
            "robust_policy": [
                int(item) for item in alternative["robust_policy"]
            ],
            "robust_policy_record": _q3_policy_record(
                alternative["robust_policy"]
            ),
            "profit_interval": alternative["profit_interval"],
            "full_nominal_policy_table": alternative[
                "nominal_policy_table"
            ],
            "full_point_policy_table": alternative[
                "point_policy_table"
            ],
        },
        "network_data": {
            "nodes": [
                {
                    "id": _q3_node_label(node),
                    "kind": str(node["kind"]),
                    "scenario_defect_rate": float(node["defect_rate"]),
                }
                for node in Q3_PARAMETER_NODES
            ],
            "primary_edges": [
                {"source": source, "target": target}
                for source, target in Q3_PRIMARY_EDGES
            ],
            "alternative_edges": [
                {"source": source, "target": target}
                for source, target in Q3_ALTERNATIVE_EDGES
            ],
            "graph_is_data_not_figure_declaration": True,
        },
    }


def run() -> dict[str, Any]:
    """运行问题四并返回可由 main.py 落盘的完整账本。"""
    seed_sequence = np.random.SeedSequence(Q4_RANDOM_SEED)
    independent_streams = seed_sequence.spawn(len(Q2_CASES) + 1)

    q2_cases: list[dict[str, Any]] = []
    for case_index, case in enumerate(Q2_CASES):
        generator = np.random.default_rng(independent_streams[case_index])
        q2_cases.append(_solve_q2_case(case, generator))

    q3_generator = np.random.default_rng(independent_streams[-1])
    q3_result = _solve_q3(q3_generator)

    representative_q2_n = int(
        q2_cases[0]["planning_sample_sizes"]["part1"]
    )
    representative_q3_n = int(
        q3_result["primary_inferred_scenario"]
        ["planning_sample_sizes"]["part1"]
    )
    q2_cp_tests = edge_case_tests(
        representative_q2_n,
        Q4_Q2_MARGINAL_ERROR_RATE,
        "q2",
    )
    q3_cp_tests = edge_case_tests(
        representative_q3_n,
        Q4_Q3_MARGINAL_ERROR_RATE,
        "q3",
    )
    degeneracy = [
        q2_degenerate_16_policy_equivalence(case)
        for case in Q2_CASES
    ]
    max_degeneration_error = max(
        float(item["max_absolute_profit_gap"])
        for item in degeneracy
    )

    q2_consistency_values = [
        float(item["decision_consistency"])
        for item in q2_cases
    ]
    q3_primary = q3_result["primary_inferred_scenario"]
    q2_max_bellman_residual = max(
        float(item["bellman_max_absolute_residual"])
        for item in q2_cases
    )
    q2_strategy_count_ok = all(
        int(item["sixteen_policy_nominal_table"]["policy_count"])
        == Q2_POLICY_SPACE_COUNT
        for item in q2_cases
    )
    q3_strategy_count_ok = (
        int(
            q3_primary["full_nominal_policy_table"]["policy_count"]
        )
        == Q3_POLICY_SPACE_COUNT
    )
    unit_check_max_error = max(
        float(metrics["U_equals_C_over_Q_error"])
        for metrics in q3_primary["node_metrics"].values()
        if np.isfinite(float(metrics["U_equals_C_over_Q_error"]))
    )

    validation_passed = bool(
        q2_cp_tests["passed"]
        and q3_cp_tests["passed"]
        and max_degeneration_error <= CASHFLOW_ABS_TOL
        and q2_max_bellman_residual <= VALUE_ITERATION_TOL
        and q2_strategy_count_ok
        and q3_strategy_count_ok
        and unit_check_max_error <= CASHFLOW_ABS_TOL
    )

    payload = {
        "problem": "problem4",
        "analysis_type": "scenario_analysis",
        "parameter_module": params.__name__,
        "data_status": {
            "actual_samples_available": Q4_ACTUAL_SAMPLES_AVAILABLE,
            "scenario_only": Q4_SCENARIO_ONLY,
            "results_are_scenario_analysis": (
                Q4_RESULTS_ARE_SCENARIO_ANALYSIS
            ),
            "honest_boundary": (
                "没有真实各节点(n_v,x_v)。代码先按登记情景率生成并保存计数，"
                "再以x_v/n_v重优化；名义率从未直接充当点估计。"
            ),
            "sampling_protocol": (
                "各节点独立选择达到登记CP宽度目标的最小整数样本量；"
                "基准观测与重复观测均使用登记种子。重复观测生成x_v、"
                "p_hat=x_v/n_v及Jeffreys后验情景率。"
            ),
            "leakage_statement": (
                "没有训练集或测试集，也没有使用结果标签筛选模型；"
                "每个情景在决策前固定其(n_v,x_v)，全部决策样本仅用于"
                "逐次重优化和事后一致率统计。"
            ),
        },
        "settings": {
            "family_confidence_level": Q4_FAMILY_CONFIDENCE_LEVEL,
            "family_error_rate": Q4_FAMILY_ERROR_RATE,
            "width_target": Q4_WIDTH_TARGET,
            "single_parameter_n_max": Q4_SINGLE_PARAMETER_N_MAX,
            "registered_sample_size_grid": [
                int(item) for item in Q4_SAMPLE_SIZE_GRID
            ],
            "scenario_repetitions": Q4_SCENARIO_REPETITIONS,
            "random_seed": Q4_RANDOM_SEED,
            "jeffreys_prior_alpha": Q4_JEFFREYS_PRIOR_ALPHA,
            "jeffreys_prior_beta": Q4_JEFFREYS_PRIOR_BETA,
            "decision_consistency_threshold": (
                Q4_DECISION_CONSISTENCY_THRESHOLD
            ),
            "q2_parameter_count": Q2_PARAMETER_NODE_COUNT,
            "q2_marginal_alpha": Q4_Q2_MARGINAL_ERROR_RATE,
            "q3_parameter_count": Q3_PARAMETER_NODE_COUNT,
            "q3_marginal_alpha": Q4_Q3_MARGINAL_ERROR_RATE,
            "cashflow_absolute_tolerance": CASHFLOW_ABS_TOL,
            "value_iteration_tolerance": VALUE_ITERATION_TOL,
            "exact_probability_tolerance": Q1_EXACT_ENUMERATION_TOL,
        },
        "q2": {
            "case_count": len(q2_cases),
            "cases": q2_cases,
            "aggregate_decision_consistency": float(
                np.mean(q2_consistency_values)
            ),
            "policy_space_count": Q2_POLICY_SPACE_COUNT,
            "state_count": Q2_INVENTORY_STATE_COUNT,
            "profit_unit": PROFIT_UNIT,
        },
        "q3": q3_result,
        "validation": {
            "q2_cp_edge_case_tests": q2_cp_tests,
            "q3_cp_edge_case_tests": q3_cp_tests,
            "q2_bellman_max_absolute_residual": (
                q2_max_bellman_residual
            ),
            "q2_q3_degenerate_policy_checks": degeneracy,
            "q2_q3_degeneration_max_error": max_degeneration_error,
            "q2_policy_space_count_check_passed": q2_strategy_count_ok,
            "q3_policy_space_count_check_passed": q3_strategy_count_ok,
            "q3_U_equals_C_over_Q_max_error": unit_check_max_error,
            "q2_all_costs_enter_cashflow": True,
            "q3_all_costs_enter_cashflow": True,
            "q2_nonabsorbing_policies_excluded": True,
            "q3_zero_output_policies_excluded": True,
            "q3_full_strategy_enumeration_each_reoptimization": True,
            "bonferroni_q2_allocated_error": (
                Q4_Q2_MARGINAL_ERROR_RATE
                * Q2_PARAMETER_NODE_COUNT
            ),
            "bonferroni_q3_allocated_error": (
                Q4_Q3_MARGINAL_ERROR_RATE
                * Q3_PARAMETER_NODE_COUNT
            ),
            "family_error_rate": Q4_FAMILY_ERROR_RATE,
            "all_structural_checks_passed": validation_passed,
        },
        "summary": {
            "q2_case_count": len(q2_cases),
            "q2_mean_decision_consistency": float(
                np.mean(q2_consistency_values)
            ),
            "q3_decision_consistency": float(
                q3_primary["decision_consistency"]
            ),
            "q3_point_policy": q3_primary["point_policy"],
            "q3_point_profit": q3_primary["point_policy_profit"],
            "q3_profit_interval": q3_primary["profit_interval"],
            "q2_q3_degeneration_max_error": max_degeneration_error,
            "structural_checks_passed": validation_passed,
        },
    }
    return _json_safe(payload)


def main() -> None:
    run()


if __name__ == "__main__":
    main()