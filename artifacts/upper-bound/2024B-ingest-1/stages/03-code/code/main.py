# -*- coding: utf-8 -*-
"""阶段 3 编排入口：依次跑问题 1~4 与灵敏度扫描，把全部结果写进 outputs.json。

运行：python code/main.py（工作目录任意，输出落在本文件同目录的 outputs.json）。
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import problem1  # noqa: E402
import problem2  # noqa: E402
import problem3  # noqa: E402
import problem4  # noqa: E402
import sensitivity  # noqa: E402
from constants import MODEL_CONSTANTS, IMPLEMENTATION_PARAMS  # noqa: E402

OUT_PATH = os.path.join(HERE, "outputs.json")


def main():
    tol = MODEL_CONSTANTS["数值容差"]
    out = {}

    # ------------------------------------------------ 问题 1
    q1 = problem1.solve()
    out["q1"] = q1

    # ------------------------------------------------ 问题 2
    q2 = problem2.solve()
    out["q2"] = q2

    # ------------------------------------------------ 问题 3
    q3 = problem3.solve()
    q3["topology_robust"] = problem3.topology_robustness()
    out["q3"] = q3

    # ------------------------------------------------ 问题 4
    out["q4"] = problem4.solve()

    # ------------------------------------------------ 灵敏度
    out["sensitivity"] = sensitivity.solve()

    # ------------------------------------------------ 自检（不进论文数字，只做一致性证据）
    checks = {}
    checks["q1_case1_constraint_ok"] = q1["case1_reject"]["constraint_ok"]
    checks["q1_case2_constraint_ok"] = q1["case2_accept"]["constraint_ok"]
    checks["q2_max_breakdown_residual"] = q2["max_breakdown_residual"]
    checks["q2_breakdown_ok"] = bool(q2["max_breakdown_residual"] <= tol)
    checks["q2_strategy_count_ok"] = bool(q2["strategy_count"] == MODEL_CONSTANTS["问题2策略组合数"])
    checks["q3_node_count_ok"] = bool(q3["node_count"] == MODEL_CONSTANTS["问题3图1节点总数"])
    checks["q3_semi_count_ok"] = bool(
        MODEL_CONSTANTS["问题3半成品数"]
        == sum(1 for d in q3["decision_table"] if d["kind"] == "semi")
    )
    checks["q4_covers_all_q2_cases"] = bool(
        [c["case"] for c in out["q4"]["q2"]["cases"]] == [c["case"] for c in q2["cases"]]
    )
    checks["q4_ci_brackets_point"] = all(
        c["ci"][j][0] <= c["p_hat"][j] <= c["ci"][j][1]
        for c in out["q4"]["q2"]["cases"] for j in range(3)
    )
    checks["q4_profit_range_ordered"] = all(
        c["profit_range"][0] is not None and c["profit_range"][0] <= c["profit_range"][1] + tol
        for c in out["q4"]["q2"]["cases"]
    )
    checks["normal_approx_threshold_used"] = q1["normal_approx"]["threshold"]
    checks["implementation_params"] = IMPLEMENTATION_PARAMS
    out["verification"] = checks

    # 锚点索引：把 MODELING_REPORT 登记的结果锚点名映射到 outputs.json 的键路径
    out["anchor_index"] = {
        "R-Q1-n-case95": "q1.case1_reject.n_star",
        "R-Q1-c-case95": "q1.case1_reject.c_star",
        "R-Q1-n-case90": "q1.case2_accept.n_star",
        "R-Q1-c-case90": "q1.case2_accept.c_star",
        "R-Q1-sampling-cost": "q1.sampling_cost.case1_cost",
        "R-Q2-best-combo": "q2.best_combo",
        "R-Q3-profit": "q3.profit",
        "R-Q3-decision-table": "q3.decision_table",
        "R-Q3-node-cost": "q3.node_cost",
        "R-Q3-topology-robust": "q3.topology_robust",
        "R-Q4-ci-part1": "q4.q2.cases[0].ci",
        "R-Q4-profit-range": "q4.q2.cases[0].profit_range",
        "R-Q4-consistency-rate": "q4.q2.cases[0].consistency_rate",
        "R-Q4-decision-diff": "q4.decision_diff",
        "R-OUT-profit-def": "q2.cases[0].best.unit_cost",
    }

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print("wrote %s (%d bytes)" % (OUT_PATH, os.path.getsize(OUT_PATH)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
