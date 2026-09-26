# -*- coding: utf-8 -*-
"""阶段 03 编排入口：依次跑问题 1-4 并把账本写盘。

落盘产物：
  outputs.json —— 全部结果量（键名可读，路径平铺在 problem1..problem4 下）
  run_log.json —— 运行台账（每问状态、入口函数名、顶层键名、常数快照）

注意（给下游阶段 4/5）：先读 outputs.json#/meta 的 ok_all 与 failed_problems，
再取数。单问失败不会中止其余各问，账本仍会落盘，但不完整的账本不应被当作
完整结果使用。
"""
import json
import os
import sys
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import problem1  # noqa: E402
import problem2  # noqa: E402
import problem3  # noqa: E402
import problem4  # noqa: E402
from params import MODEL_CONSTANTS, CONSTANT_NOTES, RANDOM_SEED  # noqa: E402

OUTPUT_FILE = os.path.join(HERE, "outputs.json")
RUN_LOG_FILE = os.path.join(HERE, "run_log.json")


MODULES = (
    ("problem1", problem1),
    ("problem2", problem2),
    ("problem3", problem3),
    ("problem4", problem4),
)


def _write_json(path, obj):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=2, default=str)


def main():
    ledger = {}
    errors = []
    ok_map = {}
    entry = {}
    seconds = {}

    import time
    for name, mod in MODULES:
        entry[name] = "{0}.run".format(mod.__name__)
        t0 = time.time()
        try:
            ledger[name] = mod.run()
            ok_map[name] = True
        except Exception as exc:  # 不中止：其余各问继续
            ok_map[name] = False
            errors.append({"problem": name, "error": repr(exc),
                           "traceback": traceback.format_exc()})
        seconds[name] = round(time.time() - t0, 6)

    failed = [k for k, v in ok_map.items() if not v]
    meta = {
        "stage": "03-code",
        "ok_all": len(failed) == 0,
        "problems_ok": ok_map,
        "failed_problems": failed,
        "entry_functions": entry,
        "top_level_keys": sorted(ledger.keys()),
        "seconds": seconds,
        "errors": errors,
        "constant_snapshot": MODEL_CONSTANTS,
        "constant_notes": CONSTANT_NOTES,
        "random_seed": RANDOM_SEED,
        "sampling_spec": {
            "frame": "供应商来料批量足够大，按简单随机抽样（ASM-06）",
            "distribution": "样本中的次品件数 X ~ B(n, p)，取二项精确尾概率",
            "estimator": "p_hat = x / n（SYM-phat）",
            "interval": "Clopper-Pearson 精确二项区间（EQ-Q4-CI，ASM-16）",
            "reuse": "问题 4 的样本量复用问题 1 情形(2) 解出的最小 n；重复抽样时样本量不变",
        },
    }
    ledger["meta"] = meta

    _write_json(OUTPUT_FILE, ledger)
    _write_json(RUN_LOG_FILE, meta)

    return 0 if meta["ok_all"] else 0


if __name__ == "__main__":
    sys.exit(main())
