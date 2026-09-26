"""阶段 03 编程实现 —— 编排入口。

依次执行四个问题模块，外加灵敏度与盈亏平衡扫描模块，
把全部数值结果汇总写入脚本同目录下的 outputs.json。
stdout 只承载进度日志，账本一律走 JSON 文件（stdout 不被采集）。

运行方式（harness 约定）：工作目录 = code/，即
    cd code && python main.py
"""
import json
import os
import sys
import time

# 账本与模块都锚定在脚本所在目录，避免 cwd 变化把产物写歪
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import params  # noqa: E402  题面给定值与模型常数的唯一落点

import problem1  # noqa: E402
import problem2  # noqa: E402
import problem3  # noqa: E402
import problem4  # noqa: E402
import sensitivity  # noqa: E402


LEDGER_FILENAME = "outputs.json"

# 编排顺序：四问在前，灵敏度扫描在后（灵敏度依赖问题 2 的模型函数）
PROBLEM_MODULES = (
    ("problem1", problem1),
    ("problem2", problem2),
    ("problem3", problem3),
    ("problem4", problem4),
    ("sensitivity", sensitivity),
)


def _collect():
    """逐个执行问题模块的 run()，返回 {模块名: 结果字典}。

    每个模块的 run() 必须返回 dict；结果原样并入顶层账本，
    下游阶段按 outputs.json:<模块名>.<字段> 的路径取数。
    任何模块抛异常都不静默吞掉：直接向上传播，避免交出半截账本。
    """
    outputs = {}
    for name, module in PROBLEM_MODULES:
        if not hasattr(module, "run"):
            raise AttributeError("模块 {} 缺少 run() 入口".format(name))
        t_start = time.time()
        block = module.run()
        if not isinstance(block, dict):
            raise TypeError(
                "{}.run() 必须返回 dict，实际为 {}".format(name, type(block).__name__)
            )
        outputs[name] = block
        print("[main] {} done, top-level keys={}".format(name, len(block)))
    return outputs


def _build_meta():
    """顶层 meta 段：指标口径、成本项清单与可复现信息。

    下游阶段 4/5 会按 outputs.json:meta.profit_definition 与
    outputs.json:meta.unit_note 两个路径回填论文正文的口径说明。
    """
    return {
        "profit_definition": (
            "Pi = s - U：每件合格成品的期望利润。问题 2 用 U，"
            "问题 3 用根节点 U_f，两者同源——"
            "均为采购、检测、装配、拆解、调换损失五类期望成本之和。"
        ),
        "unit_note": (
            "金额列单位 元/件；比率列无量纲（取值于 0 到 1）；"
            "问题 1 的检测次数单位为件；"
            "问题 2 的决策空间为四元 0-1 组合，共 16 种。"
        ),
        "cost_terms_landed": [
            "购买单价",
            "检测成本",
            "装配成本",
            "拆解费用",
            "调换损失",
            "市场售价",
        ],
        "pipeline": [name for name, _ in PROBLEM_MODULES],
        "random_seed": getattr(params, "SEED", None),
    }


def main():
    """跑完全部问题模块，汇总并落盘账本，返回账本字典。"""
    t0 = time.time()
    outputs = _collect()
    outputs["meta"] = _build_meta()

    out_path = os.path.join(HERE, LEDGER_FILENAME)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(outputs, fh, ensure_ascii=False, indent=2)

    print(
        "[main] ledger -> {} ({} bytes, {:.2f} s)".format(
            out_path, os.path.getsize(out_path), time.time() - t0
        )
    )
    return outputs


if __name__ == "__main__":
    main()