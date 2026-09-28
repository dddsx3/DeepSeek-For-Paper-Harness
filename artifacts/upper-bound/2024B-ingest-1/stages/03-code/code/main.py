from __future__ import annotations

import importlib
import json
import math
import os
from dataclasses import asdict, is_dataclass
from enum import Enum
from pathlib import Path
from typing import Any

import params


BASE_DIR = Path(__file__).resolve().parent
PROBLEM_MODULES = ("problem1", "problem2", "problem3", "problem4")
AGGREGATE_OUTPUT = "outputs.json"
ERROR_OUTPUT = "run_error.json"


def _json_safe(value: Any) -> Any:
    """Convert solver-specific containers into strict JSON-compatible values."""
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        if math.isfinite(value):
            return value
        if math.isnan(value):
            return "NaN"
        return "Infinity" if value > 0 else "-Infinity"
    if isinstance(value, Enum):
        return _json_safe(value.value)
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if is_dataclass(value) and not isinstance(value, type):
        return _json_safe(asdict(value))
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [_json_safe(item) for item in value]
    if hasattr(value, "tolist"):
        return _json_safe(value.tolist())
    if hasattr(value, "item"):
        return _json_safe(value.item())
    if hasattr(value, "__dict__"):
        return _json_safe(vars(value))
    raise TypeError(f"无法写入 JSON 的结果类型：{type(value).__name__}")


def _write_json_atomic(filename: str, payload: Any) -> Path:
    destination = BASE_DIR / filename
    temporary = destination.with_name(destination.name + ".tmp")
    encoded = json.dumps(
        _json_safe(payload),
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
        allow_nan=False,
    )
    temporary.write_text(encoded + "\n", encoding="utf-8")
    os.replace(temporary, destination)
    return destination


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _call_problem(module_name: str) -> dict[str, Any]:
    module = importlib.import_module(module_name)
    candidates = ("run", "solve", "run_problem", "main")
    for entry_name in candidates:
        entry = getattr(module, entry_name, None)
        if not callable(entry):
            continue
        result = entry()
        if result is None:
            conventional_output = BASE_DIR / f"{module_name}.json"
            if conventional_output.exists():
                result = _load_json(conventional_output)
        if not isinstance(result, dict):
            raise TypeError(
                f"{module_name}.{entry_name} 必须返回非空 dict，实际为 "
                f"{type(result).__name__}"
            )
        if not result:
            raise ValueError(f"{module_name}.{entry_name} 返回了空结果")
        safe_result = _json_safe(result)
        if not isinstance(safe_result, dict) or not safe_result:
            raise ValueError(f"{module_name} 的 JSON 化结果为空")
        return safe_result
    raise AttributeError(
        f"{module_name} 未提供 run、solve、run_problem 或 main 入口"
    )


def _verify_written_outputs(results: dict[str, dict[str, Any]]) -> None:
    aggregate = _load_json(BASE_DIR / AGGREGATE_OUTPUT)
    for module_name, expected in results.items():
        question_output = _load_json(BASE_DIR / f"{module_name}.json")
        if question_output != expected:
            raise RuntimeError(f"{module_name}.json 落盘回读不一致")
        if aggregate.get(module_name) != expected:
            raise RuntimeError(f"outputs.json 缺少或篡改 {module_name} 结果")
    if not aggregate.get("run_summary", {}).get("all_success"):
        raise RuntimeError("四问汇总未标记成功")


def main() -> int:
    validator = getattr(params, "validate", None)
    if callable(validator):
        validator()

    results: dict[str, dict[str, Any]] = {}
    try:
        for module_name in PROBLEM_MODULES:
            result = _call_problem(module_name)
            results[module_name] = result
            _write_json_atomic(f"{module_name}.json", result)

        expected_modules = set(PROBLEM_MODULES)
        if set(results) != expected_modules:
            missing = sorted(expected_modules.difference(results))
            raise RuntimeError(f"并非四问均成功，缺少模块：{missing}")

        aggregate: dict[str, Any] = dict(results)
        aggregate["run_summary"] = {
            "all_success": True,
            "completed_questions": list(PROBLEM_MODULES),
            "question_outputs": [
                f"{module_name}.json" for module_name in PROBLEM_MODULES
            ],
            "aggregate_output": AGGREGATE_OUTPUT,
        }
        _write_json_atomic(AGGREGATE_OUTPUT, aggregate)
        _verify_written_outputs(results)
        return 0
    except Exception as error:
        _write_json_atomic(
            ERROR_OUTPUT,
            {
                "all_success": False,
                "completed_questions": list(results),
                "error_type": type(error).__name__,
                "error_message": str(error),
            },
        )
        raise


if __name__ == "__main__":
    raise SystemExit(main())