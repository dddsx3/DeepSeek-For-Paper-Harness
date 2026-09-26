"""2024 CUMCM B 题 —— 阶段 03 编程实现（编排入口）。

运行方式（工作目录 = code/）：
    python main.py

产物（均写在当前工作目录）：
    results.json       四个问题的全部数值结果（harness 据此铸数）
    chart_specs.json   图表声明：只写 chart_type / data_refs / caption，不渲染任何图像

本阶段不产出任何图像字节（no_render 门禁）。
"""

from __future__ import annotations

import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import problem1  # noqa: E402
import problem2  # noqa: E402
import problem3  # noqa: E402
import problem4  # noqa: E402

RESULTS_FILE = "results.json"
CHART_FILE = "chart_specs.json"


def build_chart_specs() -> dict:
    """只声明图表，不做任何渲染。data_refs 全部指向 results.json 内真实写出的路径。"""
    R = RESULTS_FILE
    charts = [
        {
            "id": "fig_p1_oc_curve_sampling",
            "chart_type": "line",
            "data_refs": [
                {"locator": R, "json_path": "problem1.oc_curve.p_grid"},
                {"locator": R, "json_path": "problem1.oc_curve.case1_accept"},
                {"locator": R, "json_path": "problem1.oc_curve.case2_accept"},
            ],
            "caption": "抽样特性(OC)曲线：横轴批次次品率 p，纵轴接收概率 L(p)；两条曲线分别对应情形(1)与情形(2)的最小样本量方案。",
        },
        {
            "id": "fig_p1_sample_size_vs_error",
            "chart_type": "line",
            "data_refs": [
                {"locator": R, "json_path": "problem1.scan.n_grid"},
                {"locator": R, "json_path": "problem1.scan.case1_reject_at_pnom"},
                {"locator": R, "json_path": "problem1.scan.case1_reject_at_p1"},
                {"locator": R, "json_path": "problem1.scan.case2_accept_at_pnom"},
                {"locator": R, "json_path": "problem1.scan.case2_accept_at_p1"},
            ],
            "caption": "样本量与两类错误关系：横轴样本量 n，纵轴错误概率；展示最小样本量处功效约束恰好被满足。",
        },
        {
            "id": "fig_p1_accept_reject_boundary",
            "chart_type": "heatmap",
            "data_refs": [
                {"locator": R, "json_path": "problem1.boundary.n_grid"},
                {"locator": R, "json_path": "problem1.boundary.c_grid"},
                {"locator": R, "json_path": "problem1.boundary.case1_feasible"},
                {"locator": R, "json_path": "problem1.boundary.case2_feasible"},
            ],
            "caption": "接收/拒收判定边界：横轴 n、纵轴判定数，色标为同时满足信度约束与功效约束的可行域，并标出两情形的最优可行点。",
        },
        {
            "id": "fig_p2_16strategy_expected_profit",
            "chart_type": "bar_grouped",
            "data_refs": [
                {"locator": R, "json_path": "problem2.strategy_codes"},
                {"locator": R, "json_path": "problem2.profit_matrix"},
            ],
            "caption": "问题 2 十六种 0/1 决策组合在六种情况下的期望利润对比（分组柱状图）。",
        },
        {
            "id": "fig_p2_cost_composition_stack",
            "chart_type": "bar_stacked",
            "data_refs": [
                {"locator": R, "json_path": "problem2.cases[0].cost"},
            ],
            "caption": "情况 1 最优策略的成本构成：购买、检测、装配、成品检测、拆解、调换损失分项堆叠。",
        },
        {
            "id": "fig_p2_decision_matrix_heatmap",
            "chart_type": "heatmap",
            "data_refs": [
                {"locator": R, "json_path": "problem2.decision_matrix"},
            ],
            "caption": "六种情况的最优 0/1 决策矩阵热力图（行=情况，列=零配件1检测/零配件2检测/成品检测/拆解）。",
        },
        {
            "id": "fig_p2_case_optimal_profit_bar",
            "chart_type": "bar",
            "data_refs": [
                {"locator": R, "json_path": "problem2.case_profits"},
            ],
            "caption": "六种情况最优期望利润横向对比条形图。",
        },
        {
            "id": "fig_p2_case_decision_grid",
            "chart_type": "matrix_dot",
            "data_refs": [
                {"locator": R, "json_path": "problem2.decision_matrix"},
            ],
            "caption": "六种情况最优策略编码点阵图，0/1 用双色标记。",
        },
        {
            "id": "fig_p2_sensitivity_defect_rate",
            "chart_type": "line",
            "data_refs": [
                {"locator": R, "json_path": "problem2.sensitivity.defect_rate.grid"},
                {"locator": R, "json_path": "problem2.sensitivity.defect_rate.best_profit"},
                {"locator": R, "json_path": "problem2.sensitivity.defect_rate.best_code"},
            ],
            "caption": "次品率灵敏度：利润随次品率变化并标注最优策略翻转点。",
        },
        {
            "id": "fig_p2_sensitivity_inspect_cost",
            "chart_type": "line",
            "data_refs": [
                {"locator": R, "json_path": "problem2.sensitivity.inspect_cost.grid"},
                {"locator": R, "json_path": "problem2.sensitivity.inspect_cost.best_profit"},
                {"locator": R, "json_path": "problem2.sensitivity.inspect_cost.best_code"},
            ],
            "caption": "零配件 1 检测成本灵敏度（情况 2 参数）：标注零配件 1 由检测翻回不检测的阈值。",
        },
        {
            "id": "fig_p2_sensitivity_exchange_loss",
            "chart_type": "line",
            "data_refs": [
                {"locator": R, "json_path": "problem2.sensitivity.exchange_loss.grid"},
                {"locator": R, "json_path": "problem2.sensitivity.exchange_loss.best_profit"},
                {"locator": R, "json_path": "problem2.sensitivity.exchange_loss.best_code"},
            ],
            "caption": "调换损失灵敏度：标注成品检测由 0 翻为 1 的阈值。",
        },
        {
            "id": "fig_p3_strategy_profit_bar",
            "chart_type": "bar",
            "data_refs": [
                {"locator": R, "json_path": "problem3.top_strategies"},
            ],
            "caption": "问题 3 算例候选策略期望利润对比（含最优解与两条朴素基线）。",
        },
        {
            "id": "fig_p3_sensitivity_halfproduct_rate",
            "chart_type": "line",
            "data_refs": [
                {"locator": R, "json_path": "problem3.sensitivity.half_rate.grid"},
                {"locator": R, "json_path": "problem3.sensitivity.half_rate.best_profit"},
            ],
            "caption": "半成品/成品次品率灵敏度：分层装配网络最优利润随次品率的变动。",
        },
        {
            "id": "fig_p4_defect_interval_profit_box",
            "chart_type": "box",
            "data_refs": [
                {"locator": R, "json_path": "problem4.strategy_profit_quantiles"},
                {"locator": R, "json_path": "problem4.strategy_codes"},
            ],
            "caption": "Beta 后验下单件期望利润的分布箱线图（每种候选策略一箱）。",
        },
        {
            "id": "fig_p4_decision_consistency_check",
            "chart_type": "bar",
            "data_refs": [
                {"locator": R, "json_path": "problem4.strategy_codes"},
                {"locator": R, "json_path": "problem4.strategy_keep_rate"},
            ],
            "caption": "抽样不确定性下各决策成为后验最优的频率（决策保持率）。",
        },
        {
            "id": "tikz_flow_p2_decision",
            "chart_type": "tikz_flow",
            "data_refs": [
                {"locator": R, "json_path": "problem2.cases[0].x1"},
            ],
            "caption": "问题 2 决策流程图（零配件检测 → 装配 → 成品检测 → 入市/拆解/报废），供阶段 4 用 TikZ 绘制。",
        },
        {
            "id": "tikz_flow_p3_multistage",
            "chart_type": "tikz_flow",
            "data_refs": [
                {"locator": R, "json_path": "problem3.best.Q"},
            ],
            "caption": "问题 3 多工序装配网络层级图（8 零配件 → 3 半成品 → 成品），供阶段 4 用 TikZ 绘制。",
        },
    ]
    return {
        "stage": "03-code",
        "problem": "2024 CUMCM B 题 生产过程中的决策问题",
        "note": "本文件只声明图，不渲染。harness 依据 chart_type / data_refs / caption 取数渲染。",
        "charts": charts,
    }


def main() -> None:
    t0 = time.time()
    res = {
        "meta": {
            "problem": "2024 CUMCM B 题 生产过程中的决策问题",
            "stage": "03-code",
            "unit": "元/件",
            "note": "全部数值由本目录脚本真实运行产生；本阶段未渲染任何图像。",
        }
    }
    res["problem1"] = problem1.run()
    res["problem2"] = problem2.run()
    res["problem3"] = problem3.run()
    res["problem4"] = problem4.run(res["problem2"], res["problem3"])
    res["meta"]["runtime_seconds"] = round(time.time() - t0, 3)

    with open(RESULTS_FILE, "w", encoding="utf-8") as fh:
        json.dump(res, fh, ensure_ascii=False, indent=2)

    with open(CHART_FILE, "w", encoding="utf-8") as fh:
        json.dump(build_chart_specs(), fh, ensure_ascii=False, indent=2)

    print("[03-code] wrote %s (%d bytes) and %s" % (RESULTS_FILE, os.path.getsize(RESULTS_FILE), CHART_FILE))
    print("[03-code] q1 n1=%s c1=%s | n2=%s k2=%s" % (
        res["problem1"]["case1"]["n"], res["problem1"]["case1"]["c"],
        res["problem1"]["case2"]["n"], res["problem1"]["case2"]["k"]))
    print("[03-code] q2 profits=%s" % [round(c["profit"], 4) for c in res["problem2"]["cases"]])
    print("[03-code] q3 profit=%.4f | q4 keep_rate=%.4f" % (
        res["problem3"]["best"]["profit"], res["problem4"]["keep_rate"]))


if __name__ == "__main__":
    main()
