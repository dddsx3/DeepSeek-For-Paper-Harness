"""阶段 3 编排入口：按问题顺序执行并汇总全部数值结果。"""

from __future__ import annotations

import importlib
import json
import math
from collections.abc import Mapping, Sequence, Set
from dataclasses import asdict, is_dataclass
from decimal import Decimal
from enum import Enum
from pathlib import Path
from typing import Any

import params
from params import *  # noqa: F401,F403


BASE_DIR = Path(__file__).resolve().parent
OUTPUT_PATH = BASE_DIR / "outputs.json"
PROBLEM_MODULES = ("problem1", "problem2", "problem3", "problem4")


def _json_ready(value: Any, *, location: str = "root") -> Any:
    """将求解器返回值转换为严格 JSON 数据，并阻止 NaN/Infinity 静默落盘。"""
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError(f"非有限数不能写入 JSON: {location}={value!r}")
        return value
    if isinstance(value, Decimal):
        converted = float(value)
        if not math.isfinite(converted):
            raise ValueError(f"非有限 Decimal 不能写入 JSON: {location}")
        return converted
    if isinstance(value, Enum):
        return _json_ready(value.value, location=f"{location}.value")
    if is_dataclass(value) and not isinstance(value, type):
        return _json_ready(asdict(value), location=location)
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, Mapping):
        converted_mapping = {}
        for raw_key, raw_item in value.items():
            key = str(raw_key)
            converted_mapping[key] = _json_ready(
                raw_item, location=f"{location}.{key}"
            )
        return converted_mapping
    if isinstance(value, Set):
        return [
            _json_ready(item, location=f"{location}[]")
            for item in sorted(value, key=str)
        ]
    if isinstance(value, Sequence) and not isinstance(
        value, (str, bytes, bytearray)
    ):
        return [
            _json_ready(item, location=f"{location}[{index}]")
            for index, item in enumerate(value)
        ]

    item_method = getattr(value, "item", None)
    if callable(item_method):
        try:
            return _json_ready(item_method(), location=location)
        except (TypeError, ValueError):
            pass
    tolist_method = getattr(value, "tolist", None)
    if callable(tolist_method):
        try:
            return _json_ready(tolist_method(), location=location)
        except (TypeError, ValueError):
            pass
    raise TypeError(f"不支持的 JSON 输出类型: {location}={type(value).__name__}")


def _atomic_write_json(path: Path, payload: Mapping[str, Any]) -> None:
    """先写临时文件再原子替换，避免中断留下半份 JSON。"""
    serializable = _json_ready(payload, location=path.name)
    text = json.dumps(
        serializable,
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
        allow_nan=False,
    )
    temporary_path = path.with_suffix(path.suffix + ".tmp")
    temporary_path.write_text(text + "\n", encoding="utf-8")
    temporary_path.replace(path)


def _run_problem(module_name: str) -> dict[str, Any]:
    """加载一个逐问模块，并检查其标准 run 入口的返回值。"""
    module = importlib.import_module(module_name)
    runner = getattr(module, "run", None)
    if not callable(runner):
        raise AttributeError(f"{module_name}.py 必须提供可调用的 run()")
    raw_result = runner()
    if not isinstance(raw_result, Mapping):
        raise TypeError(
            f"{module_name}.run() 必须返回映射，实际返回 "
            f"{type(raw_result).__name__}"
        )
    result = dict(raw_result)
    if not result:
        raise ValueError(f"{module_name}.run() 返回了空结果")
    return result


def main() -> None:
    """依次运行四问；每问完成后立即刷新分片文件与总账本。"""
    _ = params
    all_results: dict[str, Any] = {}

    for module_name in PROBLEM_MODULES:
        problem_result = _run_problem(module_name)
        all_results[module_name] = problem_result
        _atomic_write_json(BASE_DIR / f"{module_name}.json", problem_result)
        _atomic_write_json(OUTPUT_PATH, all_results)

    _atomic_write_json(OUTPUT_PATH, all_results)


if __name__ == "__main__":
    main()