"""Preflight audit for the inline PROBLEM_FACTS.json registry."""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any

import params
from params import *


REPORT_FILE_NAME = "data_check_report.json"
_REQUIRED_TOP_LEVEL_FIELDS = ("stage", "source_file", "purpose", "facts")
_REQUIRED_FACT_FIELDS = ("id", "scope", "item", "value", "unit", "raw_quote")
_AMOUNT_FIELDS = frozenset(
    {
        "购买单价",
        "检测成本",
        "装配成本",
        "市场售价",
        "调换损失",
        "拆解费用",
    }
)
_EXPECTED_FACT_IDS = frozenset(
    {
        "F-NOMINAL",
        "F-CONF-REJECT",
        "F-CONF-ACCEPT",
        "F-T2-SEMI",
        "F-T2-PRODUCT",
        "F-T2-PRICE",
        "F-FIG1",
        "F-MECH-SYSTEM",
        "F-MECH-QUALIFIED",
        "F-MECH-DISASSEMBLE",
        "F-MECH-EXCHANGE",
        "F-MECH-INSPECT-COST",
        "F-APPENDIX-DEFECT-DEF",
        "F-APPENDIX-EXCHANGE-LOSS",
        "F-APPENDIX-UNIT",
    }
    | {case["fact_id"] for case in Q2_CASES}
    | {
        f"F-T2-PART-{part_number}"
        for part_number in range(1, Q3_PART_COUNT + 1)
    }
)


def _reject_nonstandard_constant(token: str) -> None:
    raise ValueError(f"non-standard JSON numeric constant is forbidden: {token}")


def _resolve_facts_path(supplied: str | Path | None) -> Path:
    if supplied is not None:
        return Path(supplied)
    working_path = Path(SOURCE_FACTS_FILE_NAME)
    if working_path.exists():
        return working_path
    adjacent_path = Path(__file__).resolve().with_name(SOURCE_FACTS_FILE_NAME)
    if adjacent_path.exists():
        return adjacent_path
    return working_path


def _walk_values(value: Any, path: str = "$"):
    yield path, value
    if isinstance(value, dict):
        for key, child in value.items():
            yield from _walk_values(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from _walk_values(child, f"{path}[{index}]")


def _contains_explicit_topology(value: Any) -> bool:
    topology_keys = {"子节点", "父节点", "children", "parents", "edges", "edge_table"}
    for _, child in _walk_values(value):
        if isinstance(child, dict) and set(child).intersection(topology_keys):
            return True
    return False


def _empty_report(path: Path) -> dict[str, Any]:
    return {
        "status": "failed",
        "source": {
            "path": str(path),
            "mode": "inline_json_fact_registry",
            "parameter_source": PARAMETER_SOURCE,
        },
        "checks": [],
        "errors": [],
        "warnings": [],
        "records": [],
        "profile": {},
    }


def run_data_check(facts_path: str | Path | None = None) -> dict[str, Any]:
    """Audit source facts and return a report without raising on data issues."""
    path = _resolve_facts_path(facts_path)
    report = _empty_report(path)
    checks = report["checks"]
    errors = report["errors"]
    warnings = report["warnings"]

    def add_check(
        name: str,
        passed: bool,
        detail: str,
        severity: str = "error",
    ) -> None:
        row = {
            "name": name,
            "passed": bool(passed),
            "severity": severity,
            "detail": detail,
        }
        checks.append(row)
        if passed:
            return
        message = f"{name}: {detail}"
        if severity == "warning":
            warnings.append(message)
        else:
            errors.append(message)

    try:
        exists = path.is_file()
        add_check("source_file_exists", exists, str(path))
        if not exists:
            return report

        raw_bytes = path.read_bytes()
        actual_sha256 = hashlib.sha256(raw_bytes).hexdigest()
        report["source"]["sha256"] = actual_sha256
        add_check(
            "registered_source_hash",
            actual_sha256 == PROBLEM_FACTS_SHA256,
            "independent SHA-256 equals the hash registered by params.py",
        )

        document = json.loads(
            raw_bytes.decode("utf-8"),
            parse_constant=_reject_nonstandard_constant,
        )
        add_check(
            "top_level_is_object",
            isinstance(document, dict),
            f"observed type={type(document).__name__}",
        )
        if not isinstance(document, dict):
            return report

        missing_top = [key for key in _REQUIRED_TOP_LEVEL_FIELDS if key not in document]
        add_check(
            "top_level_schema",
            not missing_top,
            f"missing fields={missing_top}",
        )
        rows = document.get("facts")
        add_check(
            "facts_array_present",
            isinstance(rows, list),
            f"observed type={type(rows).__name__}",
        )
        if not isinstance(rows, list):
            return report

        malformed = [
            index
            for index, row in enumerate(rows)
            if not isinstance(row, dict)
            or not isinstance(row.get("id"), str)
            or not row.get("id")
        ]
        add_check(
            "fact_record_shape",
            not malformed,
            f"malformed record indexes={malformed}",
        )
        usable_rows = [row for row in rows if isinstance(row, dict)]
        ids = [row.get("id") for row in usable_rows if isinstance(row.get("id"), str)]
        duplicate_ids = sorted({fact_id for fact_id in ids if ids.count(fact_id) > 1})
        add_check(
            "fact_ids_unique",
            not duplicate_ids,
            f"duplicate ids={duplicate_ids}",
        )
        row_by_id = {
            row["id"]: row
            for row in usable_rows
            if isinstance(row.get("id"), str) and row["id"] not in duplicate_ids
        }

        missing_fields = {}
        empty_quotes = []
        missing_values = []
        for fact_id, row in row_by_id.items():
            absent = [field for field in _REQUIRED_FACT_FIELDS if field not in row]
            if absent:
                missing_fields[fact_id] = absent
            quote = row.get("raw_quote")
            if not isinstance(quote, str) or not quote.strip():
                empty_quotes.append(fact_id)
            if row.get("value") is None:
                missing_values.append(fact_id)
        add_check(
            "fact_record_fields",
            not missing_fields,
            f"records with missing fields={missing_fields}",
        )
        add_check(
            "raw_quotes_nonempty",
            not empty_quotes,
            f"records without raw quotes={empty_quotes}",
        )
        add_check(
            "fact_values_present",
            not missing_values,
            f"records with null values={missing_values}",
        )

        actual_ids = set(row_by_id)
        missing_facts = sorted(_EXPECTED_FACT_IDS - actual_ids)
        extra_facts = sorted(actual_ids - _EXPECTED_FACT_IDS)
        add_check(
            "required_fact_coverage",
            not missing_facts,
            f"missing required ids={missing_facts}; informational extra ids={extra_facts}",
        )

        registered_ids = {
            row["id"] for row in FACT_RECORDS if isinstance(row.get("id"), str)
        }
        add_check(
            "params_registry_alignment",
            actual_ids == registered_ids,
            "the independently loaded fact ids equal params.FACT_RECORDS",
        )

        rate_paths = []
        amount_paths = []
        rate_errors = []
        amount_errors = []
        unit_errors = []
        for fact_id, row in row_by_id.items():
            unit = row.get("unit")
            fact_rate_paths = []
            fact_amount_paths = []
            for item_path, item in _walk_values(row.get("value")):
                field_name = item_path.rsplit(".", 1)[-1]
                is_rate_field = (
                    "次品率" in field_name
                    or "信度" in field_name
                    or "标称" in field_name
                )
                is_percentage_string = isinstance(item, str) and item.strip().endswith("%")
                if is_rate_field or is_percentage_string:
                    rate_paths.append((fact_id, item_path))
                    fact_rate_paths.append(item_path)
                    try:
                        params._as_rate(item)
                    except (TypeError, ValueError) as exc:
                        rate_errors.append(f"{fact_id}:{item_path}: {exc}")
                if field_name in _AMOUNT_FIELDS:
                    amount_paths.append((fact_id, item_path))
                    fact_amount_paths.append(item_path)
                    try:
                        params._as_amount(item)
                    except (TypeError, ValueError) as exc:
                        amount_errors.append(f"{fact_id}:{item_path}: {exc}")

            if fact_rate_paths and unit not in {
                "比率",
                "元/件（比率列除外）",
            }:
                unit_errors.append(
                    f"{fact_id}: rate-bearing value has unit={unit!r}"
                )
            if fact_amount_paths and (
                not isinstance(unit, str) or "元/件" not in unit
            ):
                unit_errors.append(
                    f"{fact_id}: monetary value has unit={unit!r}"
                )

        add_check(
            "defect_rate_domains",
            not rate_errors,
            f"invalid rate records={rate_errors}",
        )
        add_check(
            "monetary_amount_domains",
            not amount_errors,
            f"invalid amount records={amount_errors}",
        )
        add_check(
            "fact_units",
            not unit_errors,
            f"unit inconsistencies={unit_errors}",
        )

        q1_alignment = (
            params._as_rate(fact_value("F-NOMINAL"))
            == Q1_NOMINAL_DEFECT_RATE
            and params._as_rate(fact_value("F-CONF-REJECT"))
            == Q1_REJECT_CONFIDENCE
            and params._as_rate(fact_value("F-CONF-ACCEPT"))
            == Q1_ACCEPT_CONFIDENCE
        )
        add_check(
            "q1_fact_parameter_alignment",
            q1_alignment,
            "nominal and confidence values parsed by params.py equal their source facts",
        )

        q2_nested_fields = {
            "零配件1": ("次品率", "购买单价", "检测成本"),
            "零配件2": ("次品率", "购买单价", "检测成本"),
            "成品": ("次品率", "装配成本", "检测成本"),
        }
        q2_top_fields = ("市场售价", "调换损失", "拆解费用")
        q2_case_profiles = []
        q2_schema_errors = []
        q2_alignment_errors = []
        for case in Q2_CASES:
            fact_id = case["fact_id"]
            raw_case = fact_value(fact_id)
            for group, required_fields in q2_nested_fields.items():
                group_value = raw_case.get(group)
                if not isinstance(group_value, dict):
                    q2_schema_errors.append(f"{fact_id}:{group} is not an object")
                    continue
                absent = [field for field in required_fields if field not in group_value]
                if absent:
                    q2_schema_errors.append(
                        f"{fact_id}:{group} missing {absent}"
                    )
            absent_top = [field for field in q2_top_fields if field not in raw_case]
            if absent_top:
                q2_schema_errors.append(f"{fact_id} missing {absent_top}")

            rate_pairs = (
                ("零配件1", "次品率", "p_part1"),
                ("零配件2", "次品率", "p_part2"),
                ("成品", "次品率", "p_finished"),
            )
            for group, field, parameter_name in rate_pairs:
                observed = params._as_rate(raw_case[group][field])
                expected = case[parameter_name]
                if abs(observed - expected) > PROBABILITY_ABS_TOL:
                    q2_alignment_errors.append(
                        f"{fact_id}:{parameter_name}"
                    )
            amount_pairs = (
                ("零配件1", "购买单价", "purchase_part1"),
                ("零配件1", "检测成本", "inspection_part1"),
                ("零配件2", "购买单价", "purchase_part2"),
                ("零配件2", "检测成本", "inspection_part2"),
                ("成品", "装配成本", "assembly_cost"),
                ("成品", "检测成本", "finished_inspection_cost"),
                ("市场售价", "sale_price", None),
                ("调换损失", "exchange_loss", None),
                ("拆解费用", "disassembly_cost", None),
            )
            for group, field, parameter_name in amount_pairs:
                observed = params._as_amount(raw_case[group][field])
                expected = (
                    observed
                    if parameter_name is None
                    else case[parameter_name]
                )
                if observed != expected:
                    q2_alignment_errors.append(
                        f"{fact_id}:{group}.{field}"
                    )
            q2_case_profiles.append(
                {
                    "case_id": case["case_id"],
                    "fact_id": fact_id,
                    "rate_field_count": len(rate_pairs),
                    "monetary_field_count": len(amount_pairs),
                }
            )

        add_check(
            "q2_case_count",
            len(Q2_CASES) == len(q2_case_profiles),
            f"observed case count={len(q2_case_profiles)}",
        )
        add_check(
            "q2_nested_schema",
            not q2_schema_errors,
            f"schema errors={q2_schema_errors}",
        )
        add_check(
            "q2_parameter_alignment",
            not q2_alignment_errors,
            f"alignment errors={q2_alignment_errors}",
        )

        q3_schema_errors = []
        q3_alignment_errors = []
        part_nodes = [
            Q3_NODES[node_id]
            for node_id in Q3_NODE_ORDER
            if Q3_NODES[node_id]["node_type"] == "part"
        ]
        semi_nodes = [
            Q3_NODES[node_id]
            for node_id in Q3_NODE_ORDER
            if Q3_NODES[node_id]["node_type"] == "semi_product"
        ]
        if len(part_nodes) != Q3_PART_COUNT:
            q3_schema_errors.append("part count")
        if len(semi_nodes) != Q3_SEMI_PRODUCT_COUNT_CONDITIONAL:
            q3_schema_errors.append("semi-product count")
        if len(Q3_NODE_ORDER) != Q3_TOTAL_NODE_COUNT_CONDITIONAL:
            q3_schema_errors.append("total node count")

        for node in part_nodes:
            raw_part = fact_value(node["fact_id"])
            for field, parameter_name in (
                ("次品率", "p"),
                ("购买单价", "purchase_cost"),
                ("检测成本", "k"),
            ):
                if field not in raw_part:
                    q3_schema_errors.append(f"{node['fact_id']}:{field}")
                    continue
                observed = (
                    params._as_rate(raw_part[field])
                    if parameter_name == "p"
                    else params._as_amount(raw_part[field])
                )
                if observed != node[parameter_name]:
                    q3_alignment_errors.append(f"{node['node_id']}:{field}")

        raw_semi_products = fact_value("F-T2-SEMI")
        if not isinstance(raw_semi_products, list):
            q3_schema_errors.append("F-T2-SEMI is not an array")
        else:
            if len(raw_semi_products) != len(semi_nodes):
                q3_schema_errors.append("F-T2-SEMI length")
            for node, raw_node in zip(semi_nodes, raw_semi_products):
                for field, parameter_name in (
                    ("次品率", "p"),
                    ("装配成本", "a"),
                    ("检测成本", "k"),
                    ("拆解费用", "h"),
                ):
                    if field not in raw_node:
                        q3_schema_errors.append(
                            f"{node['fact_id']}:{field}"
                        )
                        continue
                    observed = (
                        params._as_rate(raw_node[field])
                        if parameter_name == "p"
                        else params._as_amount(raw_node[field])
                    )
                    if observed != node[parameter_name]:
                        q3_alignment_errors.append(
                            f"{node['node_id']}:{field}"
                        )

        raw_finished = fact_value("F-T2-PRODUCT")
        for field, parameter_name in (
            ("次品率", "p"),
            ("装配成本", "a"),
            ("检测成本", "k"),
            ("拆解费用", "h"),
        ):
            observed = (
                params._as_rate(raw_finished[field])
                if parameter_name == "p"
                else params._as_amount(raw_finished[field])
            )
            if observed != Q3_FINISHED_PRODUCT[parameter_name]:
                q3_alignment_errors.append(f"finished:{field}")
        raw_price = fact_value("F-T2-PRICE")
        if params._as_amount(raw_price["市场售价"]) != Q3_MARKET_PRICE:
            q3_alignment_errors.append("finished:市场售价")
        if params._as_amount(raw_price["调换损失"]) != Q3_EXCHANGE_LOSS:
            q3_alignment_errors.append("finished:调换损失")

        add_check(
            "q3_node_count_and_schema",
            not q3_schema_errors,
            f"schema errors={q3_schema_errors}",
        )
        add_check(
            "q3_parameter_alignment",
            not q3_alignment_errors,
            f"alignment errors={q3_alignment_errors}",
        )

        known_nodes = set(Q3_NODES)
        edge_errors = []
        child_parents = {}
        edge_set = set()
        for child, parent in Q3_H1_EDGES:
            edge = (child, parent)
            if edge in edge_set:
                edge_errors.append(f"duplicate edge {edge}")
            edge_set.add(edge)
            if child not in known_nodes or parent not in known_nodes:
                edge_errors.append(f"unknown endpoint {edge}")
            if child in child_parents:
                edge_errors.append(f"multiple parents for {child}")
            child_parents[child] = parent
        roots = sorted(known_nodes - set(child_parents))
        if roots != [Q3_ROOT_NODE_ID]:
            edge_errors.append(f"unexpected roots={roots}")
        if set(Q3_PARTS) - set(child_parents):
            edge_errors.append("one or more parts lack an H1 parent")
        add_check(
            "conditional_h1_graph_shape",
            not edge_errors,
            f"graph errors={edge_errors}; label={CONDITIONAL_H1_LABEL}",
        )

        original_topology_present = _contains_explicit_topology(
            fact_value("F-FIG1")
        )
        add_check(
            "original_figure_topology_available",
            original_topology_present,
            (
                "F-FIG1 contains explicit parent-child topology"
                if original_topology_present
                else "F-FIG1 contains only process/part counts; H1 remains conditional"
            ),
            severity="warning" if not original_topology_present else "error",
        )

        sample_fact_ids = sorted(
            fact_id
            for fact_id in actual_ids
            if "SAMPLE" in fact_id
            or "OBSERVED" in fact_id
            or "样本观测" in fact_id
        )
        add_check(
            "q4_synthetic_mode_consistent",
            bool(Q4_SYNTHETIC_SCENARIO) and not sample_fact_ids,
            (
                f"synthetic_scenario={Q4_SYNTHETIC_SCENARIO}; "
                f"observed sample facts={sample_fact_ids}"
            ),
            severity="warning" if not sample_fact_ids else "error",
        )

        required_field_presence = {
            field: sum(field in row for row in usable_rows)
            for field in _REQUIRED_FACT_FIELDS
        }
        missing_cell_count = sum(
            required_field_presence[field] < len(usable_rows)
            for field in _REQUIRED_FACT_FIELDS
        )
        missing_ratio = (
            missing_cell_count / len(_REQUIRED_FACT_FIELDS)
            if _REQUIRED_FACT_FIELDS
            else 0.0
        )
        report["profile"] = {
            "storage_mode": "inline_json_fact_registry",
            "sheets": [],
            "fact_record_count": len(usable_rows),
            "required_fact_count": len(_EXPECTED_FACT_IDS),
            "columns": list(_REQUIRED_FACT_FIELDS),
            "required_field_presence": required_field_presence,
            "missing_required_cell_ratio": missing_ratio,
            "rate_value_count": len(rate_paths),
            "monetary_value_count": len(amount_paths),
            "unexpected_fact_ids": extra_facts,
            "q2_cases": q2_case_profiles,
            "q3_node_order": list(Q3_NODE_ORDER),
        }
        report["records"] = [
            {
                "id": row.get("id"),
                "scope": row.get("scope"),
                "item": row.get("item"),
                "unit": row.get("unit"),
                "raw_quote_length": len(row.get("raw_quote", "")),
                "value": row.get("value"),
            }
            for row in usable_rows
        ]

    except Exception as exc:
        add_check(
            "preflight_completed",
            False,
            f"unexpected audit error: {type(exc).__name__}: {exc}",
        )

    report["summary"] = {
        "check_count": len(checks),
        "passed_check_count": sum(row["passed"] for row in checks),
        "error_count": len(errors),
        "warning_count": len(warnings),
        "fact_record_count": len(report["records"]),
    }
    report["status"] = "failed" if errors else "pass"
    return report


def check_data(facts_path: str | Path | None = None) -> dict[str, Any]:
    return run_data_check(facts_path)


def inspect_data(facts_path: str | Path | None = None) -> dict[str, Any]:
    return run_data_check(facts_path)


def main() -> int:
    report = run_data_check()
    try:
        Path(REPORT_FILE_NAME).write_text(
            json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False),
            encoding="utf-8",
        )
        report["report_file"] = REPORT_FILE_NAME
    except Exception as exc:
        report["report_write_error"] = (
            f"{type(exc).__name__}: {exc}"
        )
    print(
        json.dumps(
            {
                "status": report.get("status"),
                "report_file": report.get("report_file"),
                "summary": report.get("summary"),
            },
            ensure_ascii=False,
            allow_nan=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())