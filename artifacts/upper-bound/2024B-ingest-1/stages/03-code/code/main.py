"""阶段 3 编程实现编排入口：按问题顺序执行并汇总 JSON 结果。"""

from __future__ import annotations

import dataclasses
import enum
import inspect
import json
import math
import os
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import params


QUESTION_MODULES = ("problem1", "problem2", "problem3", "problem4")
RESULT_BASENAMES = tuple(f"{name}_results" for name in QUESTION_MODULES)
RESULT_FILENAMES = tuple(f"{name}.json" for name in RESULT_BASENAMES)
CANDIDATE_FUNCTIONS = ("run", "run_problem", "solve", "compute", "main")


def _jsonable(value: Any) -> Any:
    """把常见科学计算对象递归转换为严格 JSON 可接受的对象。"""
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        if math.isnan(value):
            return "NaN"
        if math.isinf(value):
            return "Infinity" if value > 0 else "-Infinity"
        return value
    if isinstance(value, enum.Enum):
        return _jsonable(value.value)
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return _jsonable(dataclasses.asdict(value))
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, Mapping):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (set, frozenset)):
        return [_jsonable(item) for item in sorted(value, key=str)]
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [_jsonable(item) for item in value]
    if hasattr(value, "tolist"):
        return _jsonable(value.tolist())
    if hasattr(value, "item"):
        return _jsonable(value.item())
    converter = getattr(value, "to_dict", None)
    if callable(converter):
        return _jsonable(converter())
    if hasattr(value, "__dict__"):
        public = {
            key: item
            for key, item in vars(value).items()
            if not key.startswith("_")
        }
        if public:
            return _jsonable(public)
    raise TypeError(f"无法将结果对象转换为 JSON：{type(value).__name__}")


def _argument_for(
    parameter: inspect.Parameter,
    module_name: str,
    output_dir: Path,
    context: dict[str, Any],
) -> Any:
    normalized = parameter.name.lower()
    if any(word in normalized for word in ("param", "constant", "config")):
        return params
    if any(word in normalized for word in ("output", "outdir", "out_dir", "directory")):
        return output_dir
    if any(word in normalized for word in ("context", "runtime", "environment")):
        return context
    if "module" in normalized or "problem" in normalized or "question" in normalized:
        return module_name
    if "seed" in normalized:
        return getattr(params, "Q4_RANDOM_SEED")
    return params


def _call_function(function: Any, module_name: str, output_dir: Path) -> Any:
    signature = inspect.signature(function)
    context = {
        "params": params,
        "module_name": module_name,
        "output_dir": output_dir,
    }
    kwargs: dict[str, Any] = {}
    positional: list[Any] = []

    for parameter in signature.parameters.values():
        if parameter.kind in (
            inspect.Parameter.VAR_POSITIONAL,
            inspect.Parameter.VAR_KEYWORD,
        ):
            continue
        if parameter.default is not inspect.Parameter.empty:
            continue
        value = _argument_for(parameter, module_name, output_dir, context)
        if parameter.kind is inspect.Parameter.KEYWORD_ONLY:
            kwargs[parameter.name] = value
        else:
            positional.append(value)

    if positional and kwargs:
        raise TypeError(f"{module_name}.{function.__name__} 的入口签名不受支持")
    if positional:
        return function(*positional)
    return function(**kwargs)


def _load_module_result(module: Any, module_name: str, output_dir: Path) -> Any:
    declared_paths = (
        getattr(module, "RESULT_PATH", None),
        getattr(module, "OUTPUT_PATH", None),
    )
    candidates = [Path(path) for path in declared_paths if path is not None]
    candidates.extend(
        output_dir / filename
        for filename in (
            f"{module_name}_results.json",
            f"{module_name}.json",
            f"results_{module_name}.json",
        )
    )

    existing = [path for path in candidates if path.is_file() and path.stat().st_size]
    if not existing:
        raise RuntimeError(f"{module_name} 未返回结果，也未写出非空 JSON")
    newest = max(existing, key=lambda path: path.stat().st_mtime_ns)
    try:
        return json.loads(newest.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"无法读取 {module_name} 的结果文件：{newest}") from exc


def _run_question(module_name: str, output_dir: Path) -> dict[str, Any]:
    try:
        module = __import__(module_name)
    except Exception as exc:
        raise RuntimeError(f"无法导入 {module_name}") from exc

    selected = None
    for function_name in CANDIDATE_FUNCTIONS:
        candidate = getattr(module, function_name, None)
        if callable(candidate):
            selected = (function_name, candidate)
            break
    if selected is None:
        raise RuntimeError(f"{module_name} 未导出可调用入口")

    function_name, function = selected
    try:
        raw_result = _call_function(function, module_name, output_dir)
    except Exception as exc:
        raise RuntimeError(f"{module_name}.{function_name} 执行失败") from exc

    if raw_result is None:
        raw_result = _load_module_result(module, module_name, output_dir)
    elif isinstance(raw_result, tuple) and raw_result:
        dict_items = [item for item in raw_result if isinstance(item, Mapping)]
        if not dict_items:
            raise RuntimeError(f"{module_name} 返回了无法识别的结果元组")
        raw_result = dict_items[0]
    elif not isinstance(raw_result, (Mapping, list, tuple, str, int, float, bool)):
        raw_result = _jsonable(raw_result)

    result = _jsonable(raw_result)
    if result is None or (isinstance(result, (Mapping, list, tuple, str)) and not result):
        raise RuntimeError(f"{module_name} 返回了空结果")
    if not isinstance(result, dict):
        result = {"value": result}
    result.setdefault("execution", {})
    if isinstance(result["execution"], dict):
        result["execution"].setdefault("module", module_name)
        result["execution"].setdefault("entrypoint", function_name)
    return result


def _remove_stale_outputs(output_dir: Path, output_name: str, summary_name: str) -> None:
    names = {
        output_name,
        summary_name,
        f"{output_name}.tmp",
        f"{summary_name}.tmp",
        *RESULT_FILENAMES,
        *(f"results_{name}.json" for name in QUESTION_MODULES),
    }
    for name in names:
        path = output_dir / name
        try:
            path.unlink()
        except FileNotFoundError:
            pass


def _atomic_json_write(path: Path, payload: Mapping[str, Any]) -> None:
    temporary = path.with_name(f"{path.name}.tmp")
    text = json.dumps(
        _jsonable(payload),
        ensure_ascii=False,
        indent=2,
        allow_nan=False,
        sort_keys=True,
    )
    temporary.write_text(text + "\n", encoding="utf-8")
    os.replace(temporary, path)


def main() -> dict[str, Any]:
    output_dir = Path.cwd()
    output_name = str(getattr(params, "CODE_OUTPUT_FILE", "outputs.json"))
    summary_name = str(getattr(params, "CODE_SUMMARY_FILE", "run_summary.json"))
    if not output_name.endswith(".json") or not summary_name.endswith(".json"):
        raise ValueError("代码输出文件名必须使用 .json 后缀")
    if output_name == summary_name:
        raise ValueError("汇总结果与执行摘要不能使用同一文件名")

    _remove_stale_outputs(output_dir, output_name, summary_name)

    results: dict[str, Any] = {}
    executions: dict[str, Any] = {}
    for module_name in QUESTION_MODULES:
        result = _run_question(module_name, output_dir)
        results[module_name] = result
        executions[module_name] = result.get("execution", {})

    expected = set(QUESTION_MODULES)
    if set(results) != expected or any(results.get(name) is None for name in expected):
        raise AssertionError("四问结果汇总不完整")
    if not all(executions.get(name) for name in expected):
        raise AssertionError("至少一问缺少成功执行记录")

    output_path = output_dir / output_name
    _atomic_json_write(output_path, results)

    reloaded = json.loads(output_path.read_text(encoding="utf-8"))
    if set(reloaded) != expected:
        raise AssertionError("落盘 JSON 未通过四问汇总校验")

    summary = {
        "status": "success",
        "output_file": output_name,
        "questions": list(QUESTION_MODULES),
        "executions": executions,
        "json_roundtrip_verified": True,
    }
    _atomic_json_write(output_dir / summary_name, summary)
    return reloaded


if __name__ == "__main__":
    main()