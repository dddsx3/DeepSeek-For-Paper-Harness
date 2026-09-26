"""阶段 03 编排入口。

依次执行问题 1-4 的求解模块，把每一问的数值结果汇总成单一 JSON 账本
``outputs.json``，落在当前工作目录（即本目录 code/）下。

运行方式
--------
    python main.py            # 工作目录 = code/
    python code/main.py       # 工作目录 = code/

纪律
----
* 所有数值常数来自 params.py（由题面给定值展开而成），本文件不写死任何模型常数；
* 本阶段不产生任何图像字节，不做任何绘图调用；量一律落 JSON 文件，不依赖 stdout；
* 某一问失败不终止整体流程，错误原文记入账本对应键，其余问答照常落盘。
"""

import importlib
import json
import os
import sys
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

PROBLEM_MODULES = ("problem1", "problem2", "problem3", "problem4")
LEDGER_FILENAME = "outputs.json"


def to_native(obj):
    """把 numpy 标量 / 数组等递归转成可 JSON 序列化的原生类型。"""
    if isinstance(obj, dict):
        return {str(key): to_native(value) for key, value in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [to_native(item) for item in obj]
    if isinstance(obj, bool):
        return bool(obj)
    if isinstance(obj, int):
        return int(obj)
    if isinstance(obj, float):
        return float(obj)
    if hasattr(obj, "tolist"):
        return to_native(obj.tolist())
    if hasattr(obj, "item"):
        return to_native(obj.item())
    return obj


def echo_constants():
    """回显 params.py 中的标量常数，供阶段 8 复核每一次运行的键名取值。"""
    echo = {}
    try:
        import params
    except Exception:
        return echo
    for name in dir(params):
        if name.startswith("_") or not name.isupper():
            continue
        try:
            value = getattr(params, name)
        except Exception:
            continue
        if isinstance(value, (bool, int, float, str)):
            echo[name] = value
    return echo


def run_problem(modname):
    """导入并执行单个问的 solve()，返回 (ok, payload)。"""
    try:
        module = importlib.import_module(modname)
    except Exception:
        return False, {
            "error": "import %s failed" % modname,
            "traceback": traceback.format_exc(),
        }
    solve = getattr(module, "solve", None)
    if not callable(solve):
        return False, {"error": "%s 未提供可调用的 solve()" % modname}
    try:
        payload = solve()
    except Exception:
        return False, {
            "error": "%s.solve() raised" % modname,
            "traceback": traceback.format_exc(),
        }
    if not isinstance(payload, dict):
        return False, {
            "error": "%s.solve() 未返回 dict" % modname,
            "payload_type": type(payload).__name__,
        }
    return True, to_native(payload)


def main():
    ledger = {}
    status = {}
    for modname in PROBLEM_MODULES:
        ok, payload = run_problem(modname)
        ledger[modname] = payload
        status[modname] = ok
        sys.stdout.write("[%s] %s\n" % (modname, "ok" if ok else "FAILED"))

    ledger["run_status"] = status
    ledger["all_ok"] = all(status.values())
    ledger["constants_echo"] = echo_constants()

    out_path = os.path.join(os.getcwd(), LEDGER_FILENAME)
    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(ledger, handle, ensure_ascii=False, indent=2, default=str)
    sys.stdout.write("账本已写入: %s\n" % out_path)
    return 0 if ledger["all_ok"] else 1


if __name__ == "__main__":
    sys.exit(main())