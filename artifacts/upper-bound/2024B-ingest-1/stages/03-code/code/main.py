"""阶段 3 编排入口：按问题顺序执行求解器并汇总 JSON 结果。"""

from __future__ import annotations

import dataclasses
import importlib
import json
import math
from collections.abc import Mapping, Sequence, Set
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from pathlib import Path
from typing import Any

import params


BASE_DIR = Path(__file__).resolve().parent
PROBLEM_MODULES = ("problem1", "problem2", "problem3", "problem4")
ENTRYPOINT_NAMES = ("solve", "run", "main")
PARAMETER_NAMESPACE = dict(vars(params))


class Stage3ExecutionError(RuntimeError):
    """Raised when a problem solver does not produce a usable result."""


def _jsonable(value: Any) -> Any:
    """Convert numerical-library objects to strict JSON-compatible values."""
    if value is None or isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, float):
        if math.isnan(value):
            return "NaN"
        if math.isinf(value):
            return "Infinity" if value > 0 else "-Infinity"
        return value
    if isinstance(value, Decimal):
        return _jsonable(float(value))
    if isinstance(value, Enum):
        return _jsonable(value.value)
    if isinstance(value, (Path, date, datetime)):
        return str(value)
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return _jsonable(dataclasses.asdict(value))
    if isinstance(value, Mapping):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if hasattr(value, "to_dict") and callable(value.to_dict):
        return _jsonable(value.to_dict())
    if hasattr(value, "tolist") and callable(value.tolist):
        return _jsonable(value.tolist())
    if hasattr(value, "item") and callable(value.item):
        return _jsonable(value.item())
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [_jsonable(item) for item in value]
    if isinstance(value, Set):
        return [_jsonable(item) for item in sorted(value, key=repr)]
    if hasattr(value, "__dict__"):
        return {
            str(key): _jsonable(item)
            for key, item in vars(value).items()
            if not str(key).startswith("_")
        }
    return str(value)


def _read_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise Stage3ExecutionError(f"Cannot read solver output {path.name}: {exc}") from exc
    if not isinstance(payload, Mapping):
        raise Stage3ExecutionError(f"Solver output {path.name} is not a JSON object")
    result = dict(payload)
    if set(result) == {"outputs"} and isinstance(result["outputs"], Mapping):
        result = dict(result["outputs"])
    return result


def _fallback_result_path(stem: str) -> Path | None:
    filenames = (
        f"{stem}_outputs.json",
        f"{stem}_output.json",
        f"{stem}_results.json",
        f"outputs_{stem}.json",
        f"{stem}.json",
    )
    for filename in filenames:
        candidate = BASE_DIR / filename
        if candidate.is_file() and candidate.stat().st_size:
            return candidate
    return None


def _normalise_solver_output(stem: str, result: Any) -> dict[str, Any]:
    if isinstance(result, (str, Path)):
        path = Path(result)
        if not path.is_absolute():
            path = BASE_DIR / path
        return _read_json(path)
    if result is None:
        path = _fallback_result_path(stem)
        if path is not None:
            return _read_json(path)
        raise Stage3ExecutionError(
            f"{stem} returned no mapping and wrote no recognized JSON result"
        )
    if isinstance(result, Mapping):
        output = dict(result)
        if set(output) == {"outputs"} and isinstance(output["outputs"], Mapping):
            output = dict(output["outputs"])
        if not output:
            raise Stage3ExecutionError(f"{stem} returned an empty result")
        return output
    raise Stage3ExecutionError(
        f"{stem} returned unsupported result type {type(result).__name__}"
    )


def _invoke_problem(stem: str) -> dict[str, Any]:
    module = importlib.import_module(stem)
    entrypoint = None
    for name in ENTRYPOINT_NAMES:
        candidate = getattr(module, name, None)
        if callable(candidate):
            entrypoint = candidate
            break
    if entrypoint is None:
        available = ", ".join(ENTRYPOINT_NAMES)
        raise Stage3ExecutionError(f"{stem} exposes none of: {available}")
    return _normalise_solver_output(stem, entrypoint())


def _write_outputs(path: Path, payload: Mapping[str, Any]) -> None:
    serialised = json.dumps(
        _jsonable(payload),
        ensure_ascii=False,
        indent=2,
        allow_nan=False,
    )
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(serialised + "\n", encoding="utf-8")
    temporary.replace(path)


def run_all(output_name: str = "outputs.json") -> Path:
    """Run all four problem solvers synchronously and persist their results."""
    if not PARAMETER_NAMESPACE:
        raise Stage3ExecutionError("params.py exposes no registered parameters")

    aggregated: dict[str, Any] = {}
    for stem in PROBLEM_MODULES:
        aggregated[stem] = _invoke_problem(stem)

    expected = set(PROBLEM_MODULES)
    actual = set(aggregated)
    if actual != expected:
        missing = ", ".join(sorted(expected - actual)) or "none"
        extra = ", ".join(sorted(actual - expected)) or "none"
        raise Stage3ExecutionError(f"Question parity failed; missing={missing}; extra={extra}")

    output_path = BASE_DIR / output_name
    _write_outputs(output_path, aggregated)
    return output_path


def main() -> None:
    output_path = run_all()
    print(f"Stage 3 results written to {output_path.name}")


if __name__ == "__main__":
    main()