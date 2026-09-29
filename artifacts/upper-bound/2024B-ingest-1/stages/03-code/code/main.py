from __future__ import annotations

import importlib
import inspect
import json
import math
from collections.abc import Mapping
from dataclasses import asdict, is_dataclass
from enum import Enum
from pathlib import Path
from typing import Any

import params
from params import *  # noqa: F401,F403


PROBLEM_MODULES = ("problem1", "problem2", "problem3", "problem4")
PROBLEM_ARTIFACTS = tuple(f"{name}_results.json" for name in PROBLEM_MODULES)
AGGREGATE_ARTIFACT = "outputs.json"
SUMMARY_ARTIFACT = "execution_summary.json"

Q1_REQUIRED_CONSTANTS = (
    "Q1_P0",
    "Q1_ALPHA_REJECT",
    "Q1_CONF_ACCEPT",
    "Q1_DELTA",
    "Q1_BETA",
    "Q1_ALTERNATIVE_DELTA",
    "Q1_POWER_DELTA",
)

Q2_CASE_ALIAS_GROUPS = (
    ("p1", "part1_defect", "part1_p"),
    ("price1", "a1", "part1_price"),
    ("test1", "t1", "part1_test"),
    ("p2", "part2_defect", "part2_p"),
    ("price2", "a2", "part2_price"),
    ("test2", "t2", "part2_test"),
    ("pf", "product_defect", "p_final"),
    ("assembly_cost", "kf", "assembly"),
    ("product_test_cost", "tf", "final_test"),
    ("market_price", "rmarket", "sale_price"),
    ("exchange_loss", "lexchange", "replacement_loss"),
    ("disassembly_cost", "gdis", "disassembly"),
)


def _as_plain_value(value: Any, location: str = "$") -> Any:
    """Convert solver return values to strict, standard JSON values."""
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError(f"非有限数值不能进入严格 JSON：{location}={value!r}")
        return value
    if isinstance(value, Enum):
        return _as_plain_value(value.value, location)
    if is_dataclass(value) and not isinstance(value, type):
        return _as_plain_value(asdict(value), location)
    if isinstance(value, Mapping):
        return {
            str(key): _as_plain_value(item, f"{location}.{key}")
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [
            _as_plain_value(item, f"{location}[{index}]")
            for index, item in enumerate(value)
        ]
    if isinstance(value, (set, frozenset)):
        plain_items = [_as_plain_value(item, f"{location}[]") for item in value]
        try:
            return sorted(plain_items)
        except TypeError:
            return plain_items
    if isinstance(value, Path):
        return str(value)

    item_method = getattr(value, "item", None)
    if callable(item_method) and getattr(value, "shape", None) == ():
        return _as_plain_value(item_method(), location)

    tolist_method = getattr(value, "tolist", None)
    if callable(tolist_method):
        return _as_plain_value(tolist_method(), location)

    raise TypeError(f"不支持的 JSON 返回类型：{location}={type(value).__name__}")


def _write_json(path: Path, payload: Any) -> None:
    plain_payload = _as_plain_value(payload)
    temporary_path = path.with_name(path.name + ".tmp")
    with temporary_path.open("w", encoding="utf-8", newline="\n") as stream:
        json.dump(
            plain_payload,
            stream,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
            allow_nan=False,
        )
        stream.write("\n")
    temporary_path.replace(path)


def _read_json_if_present(path: Path) -> Any | None:
    if not path.is_file() or path.stat().st_size == 0:
        return None
    with path.open("r", encoding="utf-8") as stream:
        return json.load(stream)


def _case_field_map(case: Any) -> dict[str, Any]:
    if isinstance(case, Mapping):
        return dict(case)
    if is_dataclass(case):
        return asdict(case)
    if hasattr(case, "__dict__"):
        return dict(vars(case))
    raise TypeError(f"无法读取问题二案例参数类型：{type(case).__name__}")


def _validate_parameter_contract() -> int:
    missing_constants = [
        name for name in Q1_REQUIRED_CONSTANTS if not hasattr(params, name)
    ]
    if missing_constants:
        raise AttributeError(
            "params.py 缺少问题一登记常数：" + ", ".join(missing_constants)
        )

    raw_cases = getattr(params, "Q2_CASES", None)
    if raw_cases is None:
        raise AttributeError("params.py 缺少 Q2_CASES")
    cases = list(raw_cases)
    if not cases:
        raise ValueError("Q2_CASES 不得为空")

    for case_index, case in enumerate(cases):
        fields = _case_field_map(case)
        for aliases in Q2_CASE_ALIAS_GROUPS:
            if not any(alias in fields for alias in aliases):
                raise KeyError(
                    f"Q2_CASES[{case_index}] 缺少字段组 {aliases}；"
                    "实际字段为 " + ", ".join(sorted(map(str, fields)))
                )
    return len(cases)


def _clear_stale_artifacts(workdir: Path) -> None:
    names = (*PROBLEM_ARTIFACTS, AGGREGATE_ARTIFACT, SUMMARY_ARTIFACT)
    for name in names:
        path = workdir / name
        if path.exists():
            path.unlink()
        temporary_path = path.with_name(path.name + ".tmp")
        if temporary_path.exists():
            temporary_path.unlink()


def _call_runner(runner: Any, module_name: str) -> Any:
    signature = inspect.signature(runner)
    required_parameters = [
        parameter
        for parameter in signature.parameters.values()
        if parameter.default is inspect.Parameter.empty
        and parameter.kind
        in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD)
    ]
    if required_parameters:
        raise TypeError(
            f"{module_name}.run 必须是无参入口，实际必需参数为 "
            + ", ".join(parameter.name for parameter in required_parameters)
        )
    return runner()


def _load_module_result(module: Any, module_name: str, workdir: Path) -> dict[str, Any]:
    runner = getattr(module, "run", None)
    if not callable(runner):
        raise AttributeError(f"{module_name}.py 缺少可调用 run() 入口")
    returned = _call_runner(runner, module_name)

    if isinstance(returned, Mapping):
        payload = dict(returned)
    elif isinstance(returned, (str, Path)):
        payload = _read_json_if_present(Path(returned))
    elif returned is None:
        payload = _read_json_if_present(workdir / f"{module_name}_results.json")
    else:
        payload = returned

    if not isinstance(payload, Mapping) or not payload:
        raise ValueError(f"{module_name}.run() 未返回非空结果映射")

    validator = getattr(module, "validate", None)
    if callable(validator):
        validation = validator(payload)
        if validation is False:
            raise ValueError(f"{module_name}.validate() 拒绝了运行结果")

    self_test = getattr(module, "self_test", None)
    if callable(self_test):
        self_test()

    return _as_plain_value(payload, module_name)


def _validate_aggregate(payloads: dict[str, dict[str, Any]], expected_q2_cases: int) -> None:
    if tuple(payloads) != PROBLEM_MODULES:
        raise AssertionError(
            f"四问执行顺序不完整：expected={PROBLEM_MODULES}, actual={tuple(payloads)}"
        )

    for module_name in PROBLEM_MODULES:
        if not payloads[module_name]:
            raise AssertionError(f"{module_name} 结果为空")

    problem_two = payloads["problem2"]
    case_rows = problem_two.get("cases")
    if not isinstance(case_rows, list) or len(case_rows) != expected_q2_cases:
        actual = "缺失" if case_rows is None else len(case_rows)
        raise AssertionError(
            f"问题二六情形回归检查失败：期望 {expected_q2_cases} 行，实际 {actual}"
        )
    for case_index, row in enumerate(case_rows):
        if not isinstance(row, Mapping) or not row:
            raise AssertionError(f"问题二第 {case_index + 1} 情形结果为空")
        if "policy" not in row or "profit" not in row:
            raise AssertionError(
                f"问题二第 {case_index + 1} 情形缺少 policy 或 profit"
            )

    if payloads["problem4"].get("scenario_only") is not True:
        raise AssertionError("问题四结果未显式标记 scenario_only=true")

    degeneracy = payloads["problem3"].get("degeneration_check")
    if not isinstance(degeneracy, Mapping):
        raise AssertionError("问题三缺少退化模型核验结果")
    if degeneracy.get("passed") is not True:
        raise AssertionError("问题三退化网络未通过逐策略等价检查")


def main() -> None:
    workdir = Path.cwd()
    expected_q2_cases = _validate_parameter_contract()
    _clear_stale_artifacts(workdir)

    payloads: dict[str, dict[str, Any]] = {}
    artifact_paths: dict[str, str] = {}

    for module_name in PROBLEM_MODULES:
        module = importlib.import_module(module_name)
        payload = _load_module_result(module, module_name, workdir)
        payloads[module_name] = payload

        artifact_path = workdir / f"{module_name}_results.json"
        _write_json(artifact_path, payload)
        artifact_paths[module_name] = artifact_path.name

    _validate_aggregate(payloads, expected_q2_cases)

    aggregate = {
        "schema": "2024B-stage3-code-results",
        **payloads,
    }
    aggregate_path = workdir / AGGREGATE_ARTIFACT
    _write_json(aggregate_path, aggregate)

    summary = {
        "status": "ok",
        "executed_in_order": list(PROBLEM_MODULES),
        "artifacts": artifact_paths,
        "aggregate_artifact": aggregate_path.name,
        "q2_case_regression_rows": expected_q2_cases,
        "all_self_tests_passed": True,
        "strict_json": True,
    }
    _write_json(workdir / SUMMARY_ARTIFACT, summary)


if __name__ == "__main__":
    main()