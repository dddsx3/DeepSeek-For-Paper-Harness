"""Stage 3 orchestration entry point.

The four question solvers are executed in order.  Each solver may either return
its result mapping directly or write a problem-specific JSON file in this
directory.  The returned mappings are consolidated into outputs.json, which
is the machine-readable result ledger consumed by later stages.
"""

from __future__ import annotations

import inspect
import json
import math
from collections.abc import Mapping
from dataclasses import asdict, is_dataclass
from decimal import Decimal
from enum import Enum
from pathlib import Path

import params
import problem1
import problem2
import problem3
import problem4


BASE_DIR = Path(__file__).resolve().parent
OUTPUT_PATH = BASE_DIR / "outputs.json"
FAILURE_PATH = BASE_DIR / "run_failures.json"
PARAMETER_SOURCE = params
SOLVERS = (
    (problem1, "problem1"),
    (problem2, "problem2"),
    (problem3, "problem3"),
    (problem4, "problem4"),
)


def _jsonable(value):
    """Convert solver return values to strict JSON-compatible objects."""
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else str(value)
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, Enum):
        return _jsonable(value.value)
    if is_dataclass(value) and not isinstance(value, type):
        return _jsonable(asdict(value))
    if isinstance(value, Mapping):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    if isinstance(value, (set, frozenset)):
        return [_jsonable(item) for item in sorted(value, key=str)]
    if hasattr(value, "tolist"):
        return _jsonable(value.tolist())
    if hasattr(value, "item"):
        return _jsonable(value.item())
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    raise TypeError(
        f"Cannot serialise {type(value).__name__} returned by a problem solver"
    )


def _load_json(path):
    with Path(path).open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, Mapping):
        raise TypeError(f"Problem result must be a JSON object: {path}")
    return dict(payload)


def _candidate_paths(module_name):
    return (
        BASE_DIR / f"{module_name}.json",
        BASE_DIR / f"{module_name}_results.json",
        BASE_DIR / f"{module_name}_output.json",
    )


def _clear_candidates(module_name):
    for path in _candidate_paths(module_name):
        if path.exists():
            path.unlink()


def _context_value(parameter_name, module_name):
    if parameter_name in {"params", "parameter_source", "constants", "config"}:
        return PARAMETER_SOURCE
    if parameter_name in {"base_dir", "output_dir", "work_dir", "working_dir"}:
        return BASE_DIR
    if parameter_name in {"output_path", "result_path", "json_path"}:
        return BASE_DIR / f"{module_name}.json"
    return inspect.Parameter.empty


def _call_with_context(function, module_name):
    signature = inspect.signature(function)
    args = []
    kwargs = {}
    for parameter in signature.parameters.values():
        if parameter.default is not inspect.Parameter.empty:
            continue
        if parameter.kind in {
            inspect.Parameter.VAR_POSITIONAL,
            inspect.Parameter.VAR_KEYWORD,
        }:
            continue
        value = _context_value(parameter.name, module_name)
        if value is inspect.Parameter.empty:
            raise TypeError(
                f"Unsupported required argument {parameter.name!r} in "
                f"{module_name}.{function.__name__}"
            )
        if parameter.kind == inspect.Parameter.POSITIONAL_ONLY:
            args.append(value)
        else:
            kwargs[parameter.name] = value
    return function(*args, **kwargs)


def _invoke_solver(module, module_name):
    _clear_candidates(module_name)
    candidates = ("run", "solve", "run_all", "solve_all", "main")
    available = [
        getattr(module, name)
        for name in candidates
        if callable(getattr(module, name, None))
    ]
    if not available:
        raise AttributeError(
            f"{module_name} exposes none of the supported solver entry points"
        )

    for function in available:
        try:
            returned = _call_with_context(function, module_name)
        except (TypeError, ValueError):
            continue

        if isinstance(returned, Path):
            returned = _load_json(returned)
        elif isinstance(returned, str) and Path(returned).is_file():
            returned = _load_json(returned)

        if isinstance(returned, Mapping) and returned:
            return _jsonable(returned)

        for path in _candidate_paths(module_name):
            if path.is_file() and path.stat().st_size:
                return _jsonable(_load_json(path))

    raise RuntimeError(
        f"{module_name} did not return a non-empty result mapping or result JSON"
    )


def _write_json(path, payload):
    serialised = _jsonable(payload)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(
            serialised,
            handle,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        )
        handle.write("\n")
    temporary.replace(path)


def main():
    results = {}
    failures = {}

    for module, module_name in SOLVERS:
        try:
            results[module_name] = _invoke_solver(module, module_name)
        except Exception as error:
            failures[module_name] = {
                "error_type": type(error).__name__,
                "message": str(error),
            }

    _write_json(OUTPUT_PATH, results)

    if failures:
        _write_json(FAILURE_PATH, failures)
        summary = "; ".join(
            f"{name}: {failure['error_type']}: {failure['message']}"
            for name, failure in failures.items()
        )
        raise RuntimeError(f"Problem solver failure: {summary}")

    if FAILURE_PATH.exists():
        FAILURE_PATH.unlink()

    print(
        json.dumps(
            {
                "output": str(OUTPUT_PATH),
                "completed": [name for _, name in SOLVERS],
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )
    return results


if __name__ == "__main__":
    main()