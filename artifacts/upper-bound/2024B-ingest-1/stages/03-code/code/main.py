#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
阶段 03 · 编程实现 —— 编排入口（main.py）

职责（严格限定在本阶段的契约内）：
  1. 依次调用逐问实现模块 problem1 / problem2 / problem3 / problem4 的 run()；
  2. 把每一问返回的、要进论文的量**汇总写盘**到本工作目录下的 outputs.json；
  3. 把本次运行的元信息（时间戳、解释器版本、模型常数快照、异常记录）写进
     outputs.json 的 meta 段，供阶段 8 复核与阶段 4 数源声明读取键名。

纪律：
  * 所有模型常数一律从 params.py（由 PROBLEM_FACTS.json 展开）按键名读取，
    本文件不出现任何裸的题面给定值；
  * 数值结果只以 JSON 落盘，stdout 仅打印状态与文件路径，不作任何数据来源；
  * 本阶段不产生任何图像字节，不调用任何绘图接口；
  * 求解前台同步完成，写盘完成后才返回，避免进程被切断导致产物丢失。
"""

from __future__ import annotations

import importlib
import json
import os
import platform
import sys
import time
import traceback
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import params  # noqa: F401  （常数登记表，必须与本文件同目录且先于各问脚本落地）
from params import *  # noqa: F401,F403

# 落盘文件名：扁平放在 code/ 下，路径不深，便于下一阶段声明 {locator, json_path}
OUTPUT_FILE = os.path.join(HERE, "outputs.json")

# 逐问实现模块清单（模块名, 一句话说明）。顺序即编排顺序。
PROBLEM_MODULES = (
    ("problem1", "问题1：检测次数尽可能少的抽样检测方案（两点设计 + 整数样本量搜索）"),
    ("problem2", "问题2：四元0-1决策 (Z1,Z2,C,D) 下的期望利润最大化（16 组合全枚举）"),
    ("problem3", "问题3：装配树上的节点级等效成本聚合与节点二值决策"),
    ("problem4", "问题4：次品率带抽样误差时的重解与稳健性（区间传播 + 重抽样一致率）"),
)


# --------------------------------------------------------------------------- #
# 工具函数
# --------------------------------------------------------------------------- #
def _kind(value):
    """给账本里的值打一个粗粒度类型标签，便于下游确认数据结构是否满足画图需要。"""
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, dict):
        return "object(%d)" % len(value)
    if isinstance(value, (list, tuple)):
        return "array(%d)" % len(value)
    return type(value).__name__


def _summarize(result):
    """列出某一问结果的顶层键与类型（数组长度也记下来，供电网/矩阵类图核对数据结构）。"""
    out = {}
    for key in sorted(result.keys()):
        if key.startswith("_"):
            continue
        out[key] = _kind(result[key])
    return out


def _param_snapshot():
    """记录本次运行读到的模型常数键名与取值，满足可复现性要求。"""
    snapshot = {}
    for key in dir(params):
        if key.startswith("_"):
            continue
        value = getattr(params, key)
        if isinstance(value, (bool, int, float, str)) or value is None:
            snapshot[key] = value
    return snapshot


def _invoke(module):
    """调用逐问模块的入口：优先 run()，其次 main()。两者皆无则报错。"""
    if hasattr(module, "run") and callable(module.run):
        return module.run()
    if hasattr(module, "main") and callable(module.main):
        return module.main()
    raise AttributeError("模块 %r 既无 run() 也无 main()" % getattr(module, "__name__", module))


def _topology_node_count(result):
    """防御式读取 problem3 的装配树节点数。

    阶段 4 的账本可能以 n_nodes / nodes / groups 任一形态给出拓扑规模；
    这里三种都认，读不到就返回 None，绝不因为一个键名不一致而在写盘之后抛
    KeyError 并把整轮运行拖成非零退出。
    """
    if not isinstance(result, dict):
        return None
    topo = result.get("topology")
    if not isinstance(topo, dict):
        return None
    if isinstance(topo.get("n_nodes"), int):
        return topo["n_nodes"]
    nodes = topo.get("nodes")
    if isinstance(nodes, (list, tuple, dict, set)):
        return len(nodes)
    groups = topo.get("groups")
    if isinstance(groups, dict):
        total = 0
        for value in groups.values():
            if isinstance(value, (list, tuple, set, dict)):
                total += len(value)
            else:
                total += 1
        return total or None
    return None


def _write_json(path, payload):
    """把账本落盘。先写临时文件再原子替换，避免中途失败留下半截产物。"""
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=False)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp, path)
    if not os.path.exists(path) or os.path.getsize(path) <= 0:
        raise IOError("账本写盘后为空：%s" % path)
    return os.path.getsize(path)


# --------------------------------------------------------------------------- #
# 编排主体
# --------------------------------------------------------------------------- #
def run_all():
    """依次跑各问并汇总为一个账本字典，返回 (ledger, errors, 用时秒)。"""
    started = time.time()
    ledger = {}
    errors = {}

    for name, description in PROBLEM_MODULES:
        t0 = time.time()
        result = {}
        try:
            module = importlib.import_module(name)
            produced = _invoke(module)
            if produced is None:
                produced = {}
            elif not isinstance(produced, dict):
                produced = {"value": produced}
            result = dict(produced)
        except Exception as exc:  # noqa: BLE001 —— 单问失败不拖垮整轮，记录后继续
            traceback.print_exc(file=sys.stderr)
            errors[name] = {"type": type(exc).__name__, "message": str(exc)}

        result["_desc"] = description
        result["_seconds"] = round(time.time() - t0, 3)
        result["_ok"] = name not in errors
        ledger[name] = result

    ledger["meta"] = {
        "stage": "03-code",
        "role": "orchestration-entry",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "python_version": platform.python_version(),
        "platform": platform.platform(),
        "working_dir": os.getcwd(),
        "script_dir": HERE,
        "output_file": os.path.basename(OUTPUT_FILE),
        "problem_modules": [name for name, _ in PROBLEM_MODULES],
        "n_problem_modules": len(PROBLEM_MODULES),
        "elapsed_seconds": round(time.time() - started, 3),
        "errors": errors,
        "n_errors": len(errors),
        "summaries": {
            name: _summarize(ledger.get(name, {})) for name, _ in PROBLEM_MODULES
        },
        "model_constants_snapshot": _param_snapshot(),
    }
    return ledger, errors, round(time.time() - started, 3)


def main(argv=None):
    ledger, errors, elapsed = run_all()

    size = _write_json(OUTPUT_FILE, ledger)

    # 写盘后回读一次，确认产物可被下一阶段按 json_path 定位。
    with open(OUTPUT_FILE, "r", encoding="utf-8") as handle:
        reloaded = json.load(handle)
    assert isinstance(reloaded, dict) and "meta" in reloaded, "账本回读自检失败"

    print("[03-code] 编排完成：%s（%d 字节，用时 %.3f s）" % (OUTPUT_FILE, size, elapsed))
    for name, _ in PROBLEM_MODULES:
        status = "FAILED" if name in errors else "ok"
        keys = ledger.get(name, {})
        n_keys = len([k for k in keys if not k.startswith("_")])
        print("  - %s: %s, 顶层结果键 %d 个" % (name, status, n_keys))

    node_count = _topology_node_count(ledger.get("problem3"))
    if node_count is not None:
        print("  - problem3 装配树节点数 = %d" % node_count)

    if errors:
        print(
            "  [warn] 以下问题模块抛出异常，已记录在 outputs.json 的 meta.errors：%s"
            % ", ".join(sorted(errors)),
            file=sys.stderr,
        )

    # 只有全部四问皆失败时才以非零码退出；任何一问有产出即视为本轮非空手。
    return 1 if len(errors) == len(PROBLEM_MODULES) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))