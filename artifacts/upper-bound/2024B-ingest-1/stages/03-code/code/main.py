"""编排问题一至问题四，并将真实执行结果写入 JSON。"""

from __future__ import annotations

import importlib
import inspect
import json
from collections.abc import Mapping
from pathlib import Path
from types import ModuleType
from typing import Any

import params
import problem1
import problem2
import problem3
import problem4


_PROBLEM_MODULES = (
    problem1,
    problem2,
    problem3,
    problem4,
)
_RUNNER_NAMES = ("run", "run_problem", "solve", "solve_problem", "main")
_OUTPUT_DIRECTORY = Path(__file__).resolve().parent


def _json_default(value: Any) -> Any:
    """Convert common scientific-Python scalar containers to JSON values."""
    if isinstance(value, Path):
        return str(value)
    if hasattr(value, "tolist"):
        return value.tolist()
    if hasattr(value, "item"):
        return value.item()
    if hasattr(value, "_asdict"):
        return value._asdict()
    if hasattr(value, "__dict__"):
        return value.__dict__
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def _write_json(path: Path, payload: Any) -> None:
    """Atomically write one machine-readable JSON artifact."""
    serialized = json.dumps(
        payload,
        ensure_ascii=False,
        allow_nan=False,
        default=_json_default,
    )
    temporary_path = path.with_suffix(path.suffix + ".tmp")
    temporary_path.write_text(serialized + "\n", encoding="utf-8")
    temporary_path.replace(path)


def _resolve_runner(module: ModuleType) -> Any:
    """Resolve the standard no-argument runner exported by a problem module."""
    for runner_name in _RUNNER_NAMES:
        candidate = getattr(module, runner_name, None)
        if callable(candidate):
            return candidate
    raise AttributeError(
        f"Module {module.__name__!r} exports none of the supported runners: "
        + ", ".join(_RUNNER_NAMES)
    )


def _invoke(module: ModuleType) -> Mapping[str, Any]:
    runner = _resolve_runner(module)
    signature = inspect.signature(runner)
    required_parameters = [
        parameter
        for parameter in signature.parameters.values()
        if parameter.default is inspect.Parameter.empty
        and parameter.kind
        in (
            inspect.Parameter.POSITIONAL_ONLY,
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
        )
    ]
    if required_parameters:
        raise TypeError(
            f"Runner for {module.__name__} must be callable without arguments; "
            f"required parameters were {[item.name for item in required_parameters]}"
        )
    result = runner()
    if not isinstance(result, Mapping):
        raise TypeError(
            f"Runner for {module.__name__} must return a mapping, "
            f"but returned {type(result).__name__}"
        )
    return result


def _problem_artifact_name(module: ModuleType) -> str:
    suffix = module.__name__.rsplit(".", maxsplit=1)[-1]
    return f"{suffix}.json"


def _run_problem(module: ModuleType) -> dict[str, Any]:
    payload = dict(_invoke(module))
    artifact_name = _problem_artifact_name(module)
    _write_json(_OUTPUT_DIRECTORY / artifact_name, payload)
    return payload


def run_all() -> dict[str, Any]:
    """Run every question in order and create the aggregate results ledger."""
    problem_results: dict[str, Any] = {}
    completed_modules: list[str] = []
    artifact_files: dict[str, str] = {}

    try:
        for module in _PROBLEM_MODULES:
            module_name = module.__name__.rsplit(".", maxsplit=1)[-1]
            problem_results[module_name] = _run_problem(module)
            completed_modules.append(module_name)
            artifact_files[module_name] = _problem_artifact_name(module)
    except Exception as error:
        _write_json(
            _OUTPUT_DIRECTORY / "run_error.json",
            {
                "status": "failed",
                "completed_modules": completed_modules,
                "error_type": type(error).__name__,
                "error_message": str(error),
            },
        )
        raise

    aggregate = {
        "status": "completed",
        "parameters_module": params.__name__,
        "execution_order": completed_modules,
        "problem_artifacts": artifact_files,
        "problems": problem_results,
    }
    _write_json(_OUTPUT_DIRECTORY / "outputs.json", aggregate)
    return aggregate


def main() -> None:
    run_all()


if __name__ == "__main__":
    main()