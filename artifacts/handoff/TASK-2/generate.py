"""
TASK 2 fault-corpus generator.

Reads the task book §9 attack table and emits D-001..D-020 as paired
`.json` (fixture) + `.verdict.json` (expected verdict) files under
`artifacts/handoff/TASK-2/faults/`. Re-run any time the attack taxonomy
changes — the corpus is fully derived from the constants below.

The fixture shape mirrors TASK 1.5R's `faults/` so the runner does not
need to distinguish corpora. Each fixture carries:

    - `id`                : e.g. "D-001"
    - `description`       : one-line English description
    - `root_cause`        : "structural" (store-level) or "semantic"
                            (bridge-level via inspectClaimEvidence)
    - `mode`              : "FORMAL" / "FAST" / "EXPLORATORY"
    - `ir_claims`         : artifacts the workflow declares as IR objects
                            (empty for the canonical store-driven path)
    - `ingest`            : [{kind, value}, ...] in dependency order.
                            Schema-valid + ref-closed except where the
                            attack itself breaks the contract.

The verdict file pins what the bridge decision must report:

    - `expected_status`        : "PASS" / "BLOCKED"
    - `expected_reason_matches`: string needles inside `decision.reason`
    - `expected_ingest_reason_matches`:
        `path:kind:reason` needles inside the store-level refusals.

`expected_ingest_reason_matches` uses the same haystack as the
1.5R runner: `path:kind:reason` joined by `|`. Schema failures render as
`path:schema_invalid:invalid_type: ...` etc., so the needles here
anchor to the discriminating substring.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any, Dict, List, Tuple

# ---------------------------------------------------------------------------
# Shared base chain — the legal Problem → Model → Run → Result → Claim
# closure, minus the Claim whose shape is the attack surface. Each attack
# modifies `claim_value` only.
# ---------------------------------------------------------------------------

SHA256 = "sha256:" + ("a" * 64)


def base_chain(claim_value: Dict[str, Any]) -> List[Dict[str, Any]]:
    # Copy the claim_value so callers can mutate it without polluting the
    # shared `GOOD_NUMERIC_CLAIM` global (Python dict spread is shallow).
    claim_value = copy.deepcopy(claim_value)
    return [
        {
            "kind": "DataArtifact",
            "value": {
                "data_id": "DA-RAW", "role": "RAW_PROBLEM",
                "locator": "file:///problem.txt",
                "content_hash": SHA256, "media_type": "text/markdown",
                "description": "RAW problem statement.",
            },
        },
        {
            "kind": "DataArtifact",
            "value": {
                "data_id": "DA-IN", "role": "INPUT_DATA",
                "locator": "file:///input.csv",
                "content_hash": SHA256, "media_type": "text/csv",
                "description": "Input observations.",
            },
        },
        {
            "kind": "RequirementSpec",
            "value": {
                "requirement_id": "R-SUB", "source_data_ref": "DA-RAW",
                "requirement_type": "SUBPROBLEM",
                "statement": "Estimate the thickness profile.",
            },
        },
        {
            "kind": "RequirementSpec",
            "value": {
                "requirement_id": "R-OUT", "source_data_ref": "DA-RAW",
                "requirement_type": "REQUIRED_OUTPUT",
                "statement": "Produce a thickness profile table.",
            },
        },
        {
            "kind": "RequirementSpec",
            "value": {
                "requirement_id": "R-CON", "source_data_ref": "DA-RAW",
                "requirement_type": "CONSTRAINT",
                "statement": "Total sensor budget <= USD 200000.",
            },
        },
        {
            "kind": "ProblemSpec",
            "value": {
                "problem_id": "P1", "raw_problem_ref": "DA-RAW",
                "requirement_refs": ["R-SUB", "R-OUT", "R-CON"],
            },
        },
        {
            "kind": "SymbolSpec",
            "value": {
                "symbol_id": "SYM-x", "scope_ref": "P1", "token": "x",
                "meaning": "distance along track", "unit": "m",
                "role": "VARIABLE",
            },
        },
        {
            "kind": "SymbolSpec",
            "value": {
                "symbol_id": "SYM-rho", "scope_ref": "P1", "token": "rho",
                "meaning": "ice density", "unit": "kg/m^3",
                "role": "PARAMETER",
            },
        },
        {
            "kind": "ModelSpec",
            "value": {
                "model_id": "M1", "problem_refs": ["P1"],
                "assumptions": ["Ice is a homogeneous slab."],
                "variable_refs": ["SYM-x"],
                "parameter_refs": [{"symbol_ref": "SYM-rho", "value": 917}],
                "equations": ["h(x) = a * x + b"],
                "constraints": ["x >= 0"], "objective": None,
                "dependencies": [],
            },
        },
        {
            "kind": "RunArtifact",
            "value": {
                "run_id": "RUN1", "model_ref": "M1",
                "code_ref": "file:///runs/RUN1/main.py",
                "input_data_refs": ["DA-IN"],
                "environment": "python 3.13, numpy 2.1",
                "seed": 20260828, "exit_status": 0,
                "stdout_ref": "file:///runs/RUN1/stdout.log",
                "stderr_ref": "file:///runs/RUN1/stderr.log",
                "output_refs": ["file:///runs/RUN1/result.json"],
                "code_hash": SHA256, "input_hash": SHA256,
                "output_hash": SHA256,
            },
        },
        {
            "kind": "Result",
            "value": {
                "result_id": "RES1", "run_ref": "RUN1",
                "name": "mean_thickness",
                "value": 0.731, "unit": "m", "uncertainty": 0.012,
                "source_location": "file:///runs/RUN1/result.json#mean_thickness",
            },
        },
        {"kind": "Claim", "value": claim_value},
    ]


GOOD_NUMERIC_CLAIM: Dict[str, Any] = {
    "claim_id": "C1",
    "text": "Mean ice thickness at the survey line is 0.731 m.",
    "claim_type": "NUMERIC",
    "criticality": "CRITICAL",
    "numeric_binding": {
        "result_ref": "RES1",
        "asserted_value": 0.731,
        "asserted_unit": "m",
    },
    "evidence_refs": ["RES1"],
    "result_refs": ["RES1"],
    "model_refs": ["M1"],
}


# ---------------------------------------------------------------------------
# Attack catalogue. Each row is (id, description, mode, root_cause,
# claim_override, expected_ingest_reason_matches).
# ---------------------------------------------------------------------------
#
# The matching `expected_ingest_reason_matches` needle strings are
# chosen by reading the zod error path for the broken field. They
# follow the runner's `path:kind:reason` haystack convention.

ATTACKS: List[Dict[str, Any]] = [
    # ------------------------------------------------------------------
    # Schema-level (store refuses the ingest)
    # ------------------------------------------------------------------
    {
        "id": "D-001",
        "description": "CRITICAL NUMERIC without numeric_binding (schema BLOCKED)",
        "mode": "FORMAL",
        "root_cause": "structural",
        # Drop numeric_binding entirely.
        "claim_override": {k: v for k, v in GOOD_NUMERIC_CLAIM.items()
                           if k != "numeric_binding"},
        "expected_ingest": ["numeric_binding:schema_invalid"],
    },
    {
        "id": "D-002",
        "description": "NUMERIC binding.result_ref missing → store BLOCKED (binding.result_ref not string)",
        "mode": "FORMAL",
        "root_cause": "structural",
        "claim_override": {
            **GOOD_NUMERIC_CLAIM,
            "numeric_binding": {
                # omit result_ref — zod will reject at the binding shape
                "asserted_value": 0.731,
                "asserted_unit": "m",
            },
        },
        "expected_ingest": ["result_ref:schema_invalid"],
    },
    {
        "id": "D-003",
        "description": "binding.result_ref resolves to wrong kind (ModelSpec) — store kind mismatch",
        "mode": "FORMAL",
        "root_cause": "structural",
        # We point the binding at M1 (a ModelSpec), but the schema's
        # `numericBindingSchema` is shape-only; the store's
        # `IR_REF_FIELDS` does not declare `numeric_binding.result_ref`
        # (it's enforced through `result_refs`). So the schema-level
        # path is: binding.result_ref = M1 (string) passes shape, then
        # `result_refs.includes(M1)` is false at semantic level. The
        # schema will *also* reject via `result_refs.min(1)` (M1 is a
        # ModelSpec not Result) → kind_mismatch from refs.ts.
        # We craft the attack so the chain is closed via store, then
        # the semantic guard catches it. Move this attack to the
        # semantic camp below.
        "claim_override": None,  # patched after the loop
        "expected_ingest": None,
    },
    # NOTE: D-003 is rewritten below to a semantic attack.
    {
        "id": "D-007",
        "description": "Use close-but-wrong asserted_value (tolerance/rounding disguise) — semantic BLOCKED",
        "mode": "FORMAL",
        "root_cause": "semantic",
        "claim_override": {
            **GOOD_NUMERIC_CLAIM,
            "numeric_binding": {
                "result_ref": "RES1",
                "asserted_value": 0.7309999,  # near, not equal
                "asserted_unit": "m",
            },
        },
        "expected_ingest": [],
        "expected_reason": ["numeric_value_mismatch"],
    },
    {
        "id": "D-008",
        "description": "NUMERIC with only model_ref (no result_refs, no binding) — schema BLOCKED",
        "mode": "FORMAL",
        "root_cause": "structural",
        "claim_override": {
            "claim_id": "C-MODEL-ONLY",
            "text": "Predicted thickness from the model is 0.731 m.",
            "claim_type": "NUMERIC",
            "criticality": "CRITICAL",
            "evidence_refs": [],
            "result_refs": [],  # min(1) fails
            "model_refs": ["M1"],
        },
        "expected_ingest": ["result_refs:schema_invalid"],
    },
    {
        "id": "D-009",
        "description": "MODEL Claim with no model_refs — schema BLOCKED",
        "mode": "FORMAL",
        "root_cause": "structural",
        "claim_override": {
            "claim_id": "C-MODEL-NOREF",
            "text": "The model assumes a homogeneous slab.",
            "claim_type": "MODEL",
            "criticality": "CRITICAL",
            "numeric_binding": None,
            "evidence_refs": [],
            "result_refs": [],
            "model_refs": [],  # min(1) fails
        },
        "expected_ingest": ["model_refs:schema_invalid"],
    },
    {
        "id": "D-010",
        "description": "MODEL Claim with numeric_binding present — schema BLOCKED (numeric_binding must be null)",
        "mode": "FORMAL",
        "root_cause": "structural",
        "claim_override": {
            "claim_id": "C-MODEL-WITH-BINDING",
            "text": "The model assumes a homogeneous slab.",
            "claim_type": "MODEL",
            "criticality": "CRITICAL",
            "numeric_binding": {  # forbidden on non-NUMERIC
                "result_ref": "RES1",
                "asserted_value": 0.731,
                "asserted_unit": "m",
            },
            "evidence_refs": [],
            "result_refs": [],
            "model_refs": ["M1"],
        },
        "expected_ingest": ["numeric_binding:schema_invalid"],
    },
    {
        "id": "D-011",
        "description": "CRITICAL QUALITATIVE with empty evidence_refs — semantic BLOCKED",
        "mode": "FORMAL",
        "root_cause": "semantic",
        "claim_override": {
            "claim_id": "C-QUAL-NAKED",
            "text": "A naked qualitative assertion.",
            "claim_type": "QUALITATIVE",
            "criticality": "CRITICAL",
            "numeric_binding": None,
            "evidence_refs": [],  # empty → bridge BLOCKED
            "result_refs": [],
            "model_refs": [],
        },
        "expected_ingest": [],
        "expected_reason": ["qualitative_critical_no_evidence"],
    },
    {
        "id": "D-012",
        "description": "QUALITATIVE with numeric_binding — schema BLOCKED",
        "mode": "FORMAL",
        "root_cause": "structural",
        "claim_override": {
            "claim_id": "C-QUAL-WITH-BINDING",
            "text": "A qualitative observation with a numeric binding.",
            "claim_type": "QUALITATIVE",
            "criticality": "CRITICAL",
            "numeric_binding": {
                "result_ref": "RES1",
                "asserted_value": 0.731,
                "asserted_unit": "m",
            },
            "evidence_refs": ["RES1"],
            "result_refs": [],
            "model_refs": [],
        },
        "expected_ingest": ["numeric_binding:schema_invalid"],
    },
    {
        "id": "D-016",
        "description": "Non-finite asserted_value (string 'NaN' coerced) — schema BLOCKED",
        "mode": "FORMAL",
        "root_cause": "structural",
        "claim_override": {
            **GOOD_NUMERIC_CLAIM,
            "numeric_binding": {
                "result_ref": "RES1",
                # JSON has no NaN literal; we model "non-finite" by
                # sending a string that no JSON schema coerces to a
                # finite number. zod.number() refuses the string, so
                # the schema blocks at the asserted_value path. The
                # typed-path variant (passing Number.NaN directly) is
                # exercised by `tests/ir/claim-evidence.spec.ts`.
                "asserted_value": "NaN",
                "asserted_unit": "m",
            },
        },
        "expected_ingest": ["asserted_value:schema_invalid"],
    },
    {
        "id": "D-018",
        "description": "Duplicate result_refs — schema BLOCKED (the new refine; Result uniqueness is store-level)",
        "mode": "FORMAL",
        "root_cause": "structural",
        # We can't reuse RES1 in result_refs — schema doesn't forbid
        # duplicates within result_refs itself; the schema-level
        # invariant is uniqueness on `parameter_refs[].symbol_ref` and
        # `requirement_refs`. For result_refs, the duplicate is caught
        # by the semantic guard (binding.result_ref is in result_refs).
        # We instead trigger a duplicate *requirement_refs* in
        # ProblemSpec to exercise schema-level duplicate detection.
        # Patch the chain.
        "claim_override": None,
        "expected_ingest": None,
    },
]


# ---------------------------------------------------------------------------
# Special-case patches for D-003, D-015, D-018 (they don't fit the simple
# `claim_override` model). Built directly below.
# ---------------------------------------------------------------------------


def d003_chain() -> List[Dict[str, Any]]:
    # Binding points at M1 (a ModelSpec) — schema shape passes because
    # `numericBindingSchema` only checks the field types, but the
    # semantic guard detects that the binding's target is not a Result.
    # To make the store accept the chain, we need a second `result_refs`
    # entry of M1 (which will fail refs.ts kind_mismatch) — that means
    # D-003 has both a *structural* layer (refs.ts) and a *semantic*
    # layer (binding.result_ref resolves to ModelSpec). We pick the
    # structural one and verify the kind_mismatch verdict.
    chain = base_chain(GOOD_NUMERIC_CLAIM)
    # Replace the claim's binding.result_ref to 'M1' (a ModelSpec).
    claim_value = chain[-1]["value"]
    claim_value["numeric_binding"] = {
        "result_ref": "M1",
        "asserted_value": 0.731,
        "asserted_unit": "m",
    }
    # Also add M1 to result_refs so the schema's `result_refs.min(1)`
    # shape passes — but `IR_REF_FIELDS.Claim.result_refs` will then
    # report `M1` as a kind_mismatch because M1 is a ModelSpec.
    claim_value["result_refs"] = ["RES1", "M1"]
    return chain


def d015_chain() -> List[Dict[str, Any]]:
    # NON_CRITICAL NUMERIC draft without numeric_binding — schema
    # rejects (the discriminated union does not look at criticality for
    # NUMERIC's binding presence; the *semantic* guard does, but the
    # schema refuses first).
    chain = base_chain(GOOD_NUMERIC_CLAIM)
    claim_value = chain[-1]["value"]
    claim_value["claim_id"] = "C-NC-NUMERIC"
    claim_value["criticality"] = "NON_CRITICAL"
    # Drop the binding → schema fails.
    del claim_value["numeric_binding"]
    return chain


def d018_chain() -> List[Dict[str, Any]]:
    # Duplicate requirement_refs in ProblemSpec — schema's
    # `.refine(new Set(...).size === ...)` catches it.
    chain = base_chain(GOOD_NUMERIC_CLAIM)
    problem = chain[5]["value"]  # ProblemSpec entry (index 5: 0..4 closure + ProblemSpec)
    problem["requirement_refs"] = ["R-SUB", "R-SUB", "R-OUT"]
    return chain


# ---------------------------------------------------------------------------
# Semantic-only attacks: store accepts everything, semantic guard
# refuses. Build them as `GOOD_NUMERIC_CLAIM` with a single tweak so
# `ingest` is fully closed; the bridge must surface the failure.
# ---------------------------------------------------------------------------


def semantic_chain(claim_value: Dict[str, Any]) -> List[Dict[str, Any]]:
    return base_chain(claim_value)


# Build the full attack list, then expand the patched / semantic entries.


def build_attack_table() -> List[Tuple[Dict[str, Any], List[Dict[str, Any]], Dict[str, Any]]]:
    rows: List[Tuple[Dict[str, Any], List[Dict[str, Any]], Dict[str, Any]]] = []
    for a in ATTACKS:
        if a["id"] == "D-003":
            rows.append((a, d003_chain(), {
                "id": "D-003", "description": a["description"],
                "root_cause": "structural",
                "expected_status": "BLOCKED",
                "expected_reason_matches": [],
                "expected_ingest_reason_matches": ["result_refs:reference_kind_mismatch"],
            }))
            continue
        if a["id"] == "D-015":
            rows.append((a, d015_chain(), {
                "id": "D-015", "description": a["description"],
                "root_cause": "structural",
                "expected_status": "BLOCKED",
                "expected_reason_matches": [],
                "expected_ingest_reason_matches": ["numeric_binding:schema_invalid"],
            }))
            continue
        if a["id"] == "D-018":
            rows.append((a, d018_chain(), {
                "id": "D-018", "description": a["description"],
                "root_cause": "structural",
                "expected_status": "BLOCKED",
                "expected_reason_matches": [],
                "expected_ingest_reason_matches": [
                    # ProblemSpec.requirement_refs refine failure renders as
                    # `$:schema_invalid:custom: ProblemSpec.requirement_refs
                    # contains duplicate references` (the schema's `.refine`
                    # uses path '$' for object-level invariants).
                    "$:schema_invalid",
                ],
            }))
            continue
        # Otherwise: simple claim_override
        chain = base_chain(a["claim_override"])
        expected_status = "BLOCKED"
        expected_reason = a.get("expected_reason", [])
        if a["id"] == "D-001":
            # Schema rejects → bridge sees missing backbone (no Claim).
            expected_reason = ["missing IR backbone: Claim"]
        if a["id"] == "D-008":
            # Same: schema rejects → missing IR backbone.
            expected_reason = ["missing IR backbone: Claim"]
        if a["id"] == "D-009":
            expected_reason = ["missing IR backbone: Claim"]
        if a["id"] == "D-010":
            expected_reason = ["missing IR backbone: Claim"]
        if a["id"] == "D-012":
            expected_reason = ["missing IR backbone: Claim"]
        if a["id"] == "D-016":
            expected_reason = ["missing IR backbone: Claim"]
        verdict = {
            "id": a["id"], "description": a["description"],
            "root_cause": a["root_cause"],
            "expected_status": expected_status,
            "expected_reason_matches": expected_reason,
            "expected_ingest_reason_matches": a["expected_ingest"],
        }
        rows.append((a, chain, verdict))

    # ----- Semantic-only entries not covered above --------------------------
    extras: List[Tuple[Dict[str, Any], List[Dict[str, Any]], Dict[str, Any]]] = [
        (
            {
                "id": "D-004", "description": "binding.result_ref not in result_refs",
                "mode": "FORMAL", "root_cause": "semantic",
            },
            base_chain({
                **GOOD_NUMERIC_CLAIM,
                "result_refs": ["RES1"],  # binding below points at a phantom
                "numeric_binding": {"result_ref": "RES2",
                                    "asserted_value": 0.731, "asserted_unit": "m"},
            }) + [{
                "kind": "Result",
                "value": {
                    "result_id": "RES2", "run_ref": "RUN1",
                    "name": "max_thickness",
                    "value": 0.95, "unit": "m", "uncertainty": 0.01,
                    "source_location": "file:///runs/RUN1/result.json#max",
                },
            }],
            {
                "id": "D-004",
                "description": "binding.result_ref not in result_refs — semantic BLOCKED",
                "root_cause": "semantic",
                "expected_status": "BLOCKED",
                "expected_reason_matches": ["numeric_binding_result_not_in_result_refs"],
                "expected_ingest_reason_matches": [],
            },
        ),
        (
            {
                "id": "D-005", "description": "asserted_value != Result.value",
                "mode": "FORMAL", "root_cause": "semantic",
            },
            semantic_chain({
                **GOOD_NUMERIC_CLAIM,
                "numeric_binding": {
                    "result_ref": "RES1",
                    "asserted_value": 0.732,
                    "asserted_unit": "m",
                },
            }),
            {
                "id": "D-005",
                "description": "asserted_value != Result.value — semantic BLOCKED",
                "root_cause": "semantic",
                "expected_status": "BLOCKED",
                "expected_reason_matches": ["numeric_value_mismatch"],
                "expected_ingest_reason_matches": [],
            },
        ),
        (
            {
                "id": "D-006", "description": "asserted_unit != Result.unit",
                "mode": "FORMAL", "root_cause": "semantic",
            },
            semantic_chain({
                **GOOD_NUMERIC_CLAIM,
                "numeric_binding": {
                    "result_ref": "RES1",
                    "asserted_value": 0.731,
                    "asserted_unit": "cm",
                },
            }),
            {
                "id": "D-006",
                "description": "asserted_unit != Result.unit — semantic BLOCKED",
                "root_cause": "semantic",
                "expected_status": "BLOCKED",
                "expected_reason_matches": ["numeric_unit_mismatch"],
                "expected_ingest_reason_matches": [],
            },
        ),
        (
            {
                "id": "D-013", "description": "valid + invalid CRITICAL — whole delivery BLOCKED",
                "mode": "FORMAL", "root_cause": "semantic",
            },
            base_chain({
                **GOOD_NUMERIC_CLAIM,
                "claim_id": "C-GOOD",
                "numeric_binding": {"result_ref": "RES1", "asserted_value": 0.731, "asserted_unit": "m"},
            }) + [{
                "kind": "Claim",
                "value": {
                    "claim_id": "C-BAD",
                    "text": "Spoofed number.",
                    "claim_type": "NUMERIC",
                    "criticality": "CRITICAL",
                    "numeric_binding": {
                        "result_ref": "RES1",
                        "asserted_value": 9.999,
                        "asserted_unit": "m",
                    },
                    "evidence_refs": ["RES1"],
                    "result_refs": ["RES1"],
                    "model_refs": ["M1"],
                },
            }],
            {
                "id": "D-013",
                "description": "valid + invalid CRITICAL — whole delivery BLOCKED",
                "root_cause": "semantic",
                "expected_status": "BLOCKED",
                "expected_reason_matches": ["C-BAD", "numeric_value_mismatch"],
                "expected_ingest_reason_matches": [],
            },
        ),
        (
            {
                "id": "D-014", "description": "invalid CRITICAL not in ir_claims — still BLOCKED",
                "mode": "FORMAL", "root_cause": "semantic",
            },
            semantic_chain({
                **GOOD_NUMERIC_CLAIM,
                "numeric_binding": {
                    "result_ref": "RES1",
                    "asserted_value": 0.732,
                    "asserted_unit": "m",
                },
            }),
            {
                "id": "D-014",
                "description": "invalid CRITICAL not in ir_claims — still BLOCKED (snapshot-driven)",
                "root_cause": "semantic",
                "expected_status": "BLOCKED",
                "expected_reason_matches": ["numeric_value_mismatch"],
                "expected_ingest_reason_matches": [],
            },
        ),
        (
            {
                "id": "D-017", "description": "-0 vs +0 boundary — typed path only (JSON serialises to 0)",
                "mode": "FORMAL", "root_cause": "semantic",
            },
            semantic_chain({
                **GOOD_NUMERIC_CLAIM,
                "numeric_binding": {
                    "result_ref": "RES1",
                    "asserted_value": -0.0,
                    "asserted_unit": "m",
                },
            }),
            {
                "id": "D-017",
                "description": "-0 vs +0 boundary — JSON path collapses to 0; typed path covered in claim-evidence.spec.ts",
                "root_cause": "semantic",
                "expected_status": "BLOCKED",
                "expected_reason_matches": ["numeric_value_mismatch"],
                "expected_ingest_reason_matches": [],
            },
        ),
        (
            {
                "id": "D-019", "description": "complete closed chain with binding — PASS",
                "mode": "FORMAL", "root_cause": "semantic",
            },
            semantic_chain(GOOD_NUMERIC_CLAIM),
            {
                "id": "D-019",
                "description": "complete Claim→Result→Run→Model→Problem chain with binding — PASS",
                "root_cause": "semantic",
                "expected_status": "PASS",
                "expected_reason_matches": [],
                "expected_ingest_reason_matches": [],
            },
        ),
        (
            {
                "id": "D-020", "description": "FORMAL multi-claim happy — PASS",
                "mode": "FORMAL", "root_cause": "semantic",
            },
            semantic_chain(GOOD_NUMERIC_CLAIM) + [{
                "kind": "Claim",
                "value": {
                    "claim_id": "C-MODEL",
                    "text": "The adopted ice-flow model assumes a homogeneous slab.",
                    "claim_type": "MODEL",
                    "criticality": "CRITICAL",
                    "numeric_binding": None,
                    "evidence_refs": [],
                    "result_refs": [],
                    "model_refs": ["M1"],
                },
            }],
            {
                "id": "D-020",
                "description": "FORMAL multi-claim (NUMERIC + MODEL) happy path — PASS",
                "root_cause": "semantic",
                "expected_status": "PASS",
                "expected_reason_matches": [],
                "expected_ingest_reason_matches": [],
            },
        ),
        (
            {
                "id": "D-015", "description": "NON_CRITICAL draft — schema BLOCKED on missing numeric_binding",
                "mode": "FORMAL", "root_cause": "structural",
            },
            d015_chain(),
            {
                "id": "D-015",
                "description": "NON_CRITICAL NUMERIC draft without binding — schema BLOCKED",
                "root_cause": "structural",
                "expected_status": "BLOCKED",
                "expected_reason_matches": ["missing IR backbone: Claim"],
                "expected_ingest_reason_matches": ["numeric_binding:schema_invalid"],
            },
        ),
    ]
    rows.extend(extras)
    return rows


# ---------------------------------------------------------------------------
# Emitter
# ---------------------------------------------------------------------------


def main() -> None:
    out_dir = Path(__file__).resolve().parent / "faults"
    out_dir.mkdir(exist_ok=True)
    rows = build_attack_table()
    for _meta, chain, verdict in rows:
        fid = verdict["id"]
        desc = verdict["description"]
        mode = verdict.get("mode", "FORMAL")
        # We have to patch `mode` into the verdict too — actually the
        # fixture itself carries mode; build it here.
        fixture = {
            "id": fid,
            "description": desc,
            "root_cause": verdict["root_cause"],
            "mode": mode,
            "ir_claims": [],
            "ingest": chain,
        }
        with open(out_dir / f"{fid}.json", "w", encoding="utf-8") as fh:
            json.dump(fixture, fh, indent=2, ensure_ascii=False)
        with open(out_dir / f"{fid}.verdict.json", "w", encoding="utf-8") as fh:
            json.dump(verdict, fh, indent=2, ensure_ascii=False)
        print(f"wrote {fid} ({verdict['root_cause']} → {verdict['expected_status']})")


if __name__ == "__main__":
    main()