#!/usr/bin/env python3
"""Generate the 18 R-001..R-018 fault fixtures + verdict files for TASK 1.5R.

The corpus explicitly distinguishes **structural** vs **semantic** root
cause (HANDOVER.md §2.9):

  - R-001..R-013  structural reference attacks  -> store refuses at put()
  - R-014..R-017  semantic attacks (kind legal, role/source wrong) ->
                  store accepts, bridge blocks
  - R-018         full closed Problem Contract + backbone -> PASS

Each structural fixture seeds the dependency chain only up to the attacked
object (mirroring `tests/ir/ref-closure.spec.ts`), so the refusal is
attributable to the attacked field alone and there is no downstream
cascade. The verdict file asserts the store-level root cause via
`expected_ingest_reason_matches` (the store is the boundary that owns
structural closure since PHASE 3) and the bridge-level status + reason
keywords (after PHASE 3 the bridge reports only semantic failures and the
backbone / minimum-contract summary).

Semantic fixtures keep the whole chain closed and vary a role / source
field, so every ingest is accepted and only the bridge blocks.

Ingest order matters because ModelingIr is append-only. The canonical
chain mirrors `tests/ir/fixtures.ts` validChain().
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SHA = "sha256:" + "a" * 64

# Canonical closed chain, dependency-ordered (mirrors fixtures.ts validChain).
BASE = [
    ("DataArtifact", {"data_id": "DA-RAW", "role": "RAW_PROBLEM", "locator": "file:///problem/2026-mcm-a.txt", "content_hash": SHA, "media_type": "text/markdown", "description": "The MCM 2026 problem A statement."}),
    ("DataArtifact", {"data_id": "DA-IN", "role": "INPUT_DATA", "locator": "file:///runs/RUN1/input.csv", "content_hash": SHA, "media_type": "text/csv", "description": "Survey line observations for RUN1."}),
    ("RequirementSpec", {"requirement_id": "R-SUB", "source_data_ref": "DA-RAW", "requirement_type": "SUBPROBLEM", "statement": "Estimate the ice thickness profile."}),
    ("RequirementSpec", {"requirement_id": "R-OUT", "source_data_ref": "DA-RAW", "requirement_type": "REQUIRED_OUTPUT", "statement": "Produce a thickness profile table."}),
    ("RequirementSpec", {"requirement_id": "R-CON", "source_data_ref": "DA-RAW", "requirement_type": "CONSTRAINT", "statement": "Total sensor budget must not exceed USD 200000."}),
    ("ProblemSpec", {"problem_id": "P1", "raw_problem_ref": "DA-RAW", "requirement_refs": ["R-SUB", "R-OUT", "R-CON"]}),
    ("SymbolSpec", {"symbol_id": "SYM-x", "scope_ref": "P1", "token": "x", "meaning": "distance along track", "unit": "m", "role": "VARIABLE"}),
    ("SymbolSpec", {"symbol_id": "SYM-rho", "scope_ref": "P1", "token": "rho", "meaning": "ice density", "unit": "kg/m^3", "role": "PARAMETER"}),
    ("ModelSpec", {"model_id": "M1", "problem_refs": ["P1"], "assumptions": ["Ice is a homogeneous slab."], "variable_refs": ["SYM-x"], "parameter_refs": [{"symbol_ref": "SYM-rho", "value": 917}], "equations": ["h(x) = a * x + b"], "constraints": ["x >= 0"], "objective": None, "dependencies": []}),
    ("RunArtifact", {"run_id": "RUN1", "model_ref": "M1", "code_ref": "file:///runs/RUN1/main.py", "input_data_refs": ["DA-IN"], "environment": "python 3.13, numpy 2.1", "seed": 20260828, "exit_status": 0, "stdout_ref": "file:///runs/RUN1/stdout.log", "stderr_ref": "file:///runs/RUN1/stderr.log", "output_refs": ["file:///runs/RUN1/result.json"], "code_hash": SHA, "input_hash": SHA, "output_hash": SHA}),
    ("Result", {"result_id": "RES1", "run_ref": "RUN1", "name": "mean_thickness", "value": 0.731, "unit": "m", "uncertainty": 0.012, "source_location": "file:///runs/RUN1/result.json#mean_thickness"}),
    ("Claim", {"claim_id": "C1", "text": "Mean ice thickness at the survey line is 0.731 m.", "claim_type": "NUMERIC", "criticality": "CRITICAL", "evidence_refs": ["RES1"], "result_refs": ["RES1"], "model_refs": ["M1"]}),
    ("VerificationResult", {"verification_id": "V1", "target_ref": "RES1", "verifier": "gate.numeric_consistency", "status": "PASS", "evidence_refs": ["RES1"]}),
    ("FigureSpec", {"figure_id": "F1", "data_refs": ["RES1"], "claim_refs": ["C1"]}),
    ("ReviewerFinding", {"finding_id": "RF1", "target_ref": "RES1", "attack_type": "numeric-consistency", "hypothesis": "The paper body may restate RES1 with a different value.", "reason": "The abstract quotes 0.781 while RES1 holds 0.731.", "evidence_refs": ["RES1"], "proposed_check": "Compare the abstract number against result RES1.", "severity": "CRITICAL"}),
]


def base_chain():
    return [(k, dict(v)) for k, v in BASE]


def chain_through(kind):
    """The prefix of the canonical chain ending at the last occurrence of `kind`."""
    kinds = [k for k, _ in BASE]
    last = len(kinds) - 1 - kinds[::-1].index(kind)
    return [(k, dict(v)) for k, v in BASE[:last + 1]]


def chain_with_field(kind, field, value):
    """Full closed chain with the first entry of `kind`'s `field` overridden."""
    out = []
    done = False
    for k, v in base_chain():
        if k == kind and not done:
            vv = dict(v)
            vv[field] = value
            out.append((k, vv))
            done = True
        else:
            out.append((k, v))
    return out


def chain_with_requirement_source(req_id, value):
    """Full closed chain with one RequirementSpec's source_data_ref overridden."""
    out = []
    for k, v in base_chain():
        if k == "RequirementSpec" and v.get("requirement_id") == req_id:
            vv = dict(v)
            vv["source_data_ref"] = value
            out.append((k, vv))
        else:
            out.append((k, v))
    return out


# ---------------------------------------------------------------------------
# Fixture table:
# (id, description, root_cause, chain, expected_status,
#  expected_reason_matches, expected_ingest_reason_matches)
# ---------------------------------------------------------------------------
STRUCTURAL = "structural"
SEMANTIC = "semantic"

FIXTURES = []

# --- R-001..R-013: structural (store-level refusal) ---

FIXTURES.append((
    "R-001", "ProblemSpec.raw_problem_ref points at an unregistered id",
    STRUCTURAL,
    [("ProblemSpec", {"problem_id": "P1", "raw_problem_ref": "DA-DOES-NOT-EXIST", "requirement_refs": []})],
    "BLOCKED", ["missing IR backbone"],
    ["raw_problem_ref:unresolved_reference"],
))

FIXTURES.append((
    "R-002", "ProblemSpec.requirement_refs contains an unregistered id",
    STRUCTURAL,
    chain_through("DataArtifact") + [("ProblemSpec", {"problem_id": "P1", "raw_problem_ref": "DA-RAW", "requirement_refs": ["R-DOES-NOT-EXIST"]})],
    "BLOCKED", ["missing IR backbone"],
    ["requirement_refs:unresolved_reference"],
))

FIXTURES.append((
    "R-003", "ProblemSpec.requirement_ref points at a DataArtifact (kind mismatch)",
    STRUCTURAL,
    chain_through("DataArtifact") + [("ProblemSpec", {"problem_id": "P1", "raw_problem_ref": "DA-RAW", "requirement_refs": ["DA-RAW"]})],
    "BLOCKED", ["missing IR backbone"],
    ["requirement_refs:reference_kind_mismatch"],
))

FIXTURES.append((
    "R-004", "ModelSpec.variable_refs points at an unregistered SymbolSpec",
    STRUCTURAL,
    chain_through("ProblemSpec") + [("ModelSpec", {"model_id": "M1", "problem_refs": ["P1"], "assumptions": ["Ice is a homogeneous slab."], "variable_refs": ["SYM-DOES-NOT-EXIST"], "parameter_refs": [], "equations": ["h(x) = a * x + b"], "constraints": ["x >= 0"], "objective": None, "dependencies": []})],
    "BLOCKED", ["missing IR backbone"],
    ["variable_refs:unresolved_reference"],
))

FIXTURES.append((
    "R-005", "ModelSpec.variable_refs points at a Result (kind mismatch)",
    STRUCTURAL,
    chain_through("Result") + [("ModelSpec", {"model_id": "M1", "problem_refs": ["P1"], "assumptions": ["Ice is a homogeneous slab."], "variable_refs": ["RES1"], "parameter_refs": [], "equations": ["h(x) = a * x + b"], "constraints": ["x >= 0"], "objective": None, "dependencies": []})],
    "BLOCKED", ["missing IR backbone"],
    ["variable_refs:reference_kind_mismatch"],
))

FIXTURES.append((
    "R-006", "parameter_refs[].symbol_ref points at an unregistered id (nested path)",
    STRUCTURAL,
    chain_through("ProblemSpec") + [("ModelSpec", {"model_id": "M1", "problem_refs": ["P1"], "assumptions": ["Ice is a homogeneous slab."], "variable_refs": [], "parameter_refs": [{"symbol_ref": "SYM-DOES-NOT-EXIST", "value": 917}], "equations": ["h(x) = a * x + b"], "constraints": ["x >= 0"], "objective": None, "dependencies": []})],
    "BLOCKED", ["missing IR backbone"],
    ["parameter_refs.0.symbol_ref:unresolved_reference"],
))

FIXTURES.append((
    "R-007", "parameter_refs[].symbol_ref points at a DataArtifact (kind mismatch)",
    STRUCTURAL,
    chain_through("ProblemSpec") + [("ModelSpec", {"model_id": "M1", "problem_refs": ["P1"], "assumptions": ["Ice is a homogeneous slab."], "variable_refs": [], "parameter_refs": [{"symbol_ref": "DA-RAW", "value": 917}], "equations": ["h(x) = a * x + b"], "constraints": ["x >= 0"], "objective": None, "dependencies": []})],
    "BLOCKED", ["missing IR backbone"],
    ["parameter_refs.0.symbol_ref:reference_kind_mismatch"],
))

FIXTURES.append((
    "R-008", "RunArtifact.input_data_refs points at an unregistered id",
    STRUCTURAL,
    chain_through("ModelSpec") + [("RunArtifact", {"run_id": "RUN1", "model_ref": "M1", "code_ref": "file:///runs/RUN1/main.py", "input_data_refs": ["DA-DOES-NOT-EXIST"], "environment": "python 3.13, numpy 2.1", "seed": 20260828, "exit_status": 0, "stdout_ref": "file:///runs/RUN1/stdout.log", "stderr_ref": "file:///runs/RUN1/stderr.log", "output_refs": ["file:///runs/RUN1/result.json"], "code_hash": SHA, "input_hash": SHA, "output_hash": SHA})],
    "BLOCKED", ["missing IR backbone"],
    ["input_data_refs:unresolved_reference"],
))

FIXTURES.append((
    "R-009", "RunArtifact.input_data_refs points at a Result (kind mismatch)",
    STRUCTURAL,
    chain_through("Result") + [("RunArtifact", {"run_id": "RUN1", "model_ref": "M1", "code_ref": "file:///runs/RUN1/main.py", "input_data_refs": ["RES1"], "environment": "python 3.13, numpy 2.1", "seed": 20260828, "exit_status": 0, "stdout_ref": "file:///runs/RUN1/stdout.log", "stderr_ref": "file:///runs/RUN1/stderr.log", "output_refs": ["file:///runs/RUN1/result.json"], "code_hash": SHA, "input_hash": SHA, "output_hash": SHA})],
    "BLOCKED", ["missing IR backbone"],
    ["input_data_refs:reference_kind_mismatch"],
))

FIXTURES.append((
    "R-010", "FigureSpec.data_refs points at a ModelSpec (outside Result|DataArtifact union)",
    STRUCTURAL,
    chain_through("ModelSpec") + [("FigureSpec", {"figure_id": "F1", "data_refs": ["M1"], "claim_refs": []})],
    "BLOCKED", ["missing IR backbone"],
    ["data_refs:reference_kind_mismatch"],
))

FIXTURES.append((
    "R-011", "FigureSpec.data_refs points at an unregistered id",
    STRUCTURAL,
    [("FigureSpec", {"figure_id": "F1", "data_refs": ["DA-DOES-NOT-EXIST"], "claim_refs": []})],
    "BLOCKED", ["missing IR backbone"],
    ["data_refs:unresolved_reference"],
))

FIXTURES.append((
    "R-012", "FigureSpec.data_refs -> Result is a legal union member (PASS)",
    STRUCTURAL,
    base_chain(),
    "PASS", [],
    [],
))

FIXTURES.append((
    "R-013", "FigureSpec.data_refs -> DataArtifact is a legal union member (PASS)",
    STRUCTURAL,
    chain_with_field("FigureSpec", "data_refs", ["DA-RAW"]),
    "PASS", [],
    [],
))

# --- R-014..R-017: semantic (store accepts, bridge blocks) ---

FIXTURES.append((
    "R-014", "raw_problem_ref binds a DataArtifact with role=INPUT_DATA (kind right, role wrong)",
    SEMANTIC,
    chain_with_field("ProblemSpec", "raw_problem_ref", "DA-IN"),
    "BLOCKED", ["Problem Contract failure", "unbound_data_artifact"],
    [],
))

FIXTURES.append((
    "R-015", "RunArtifact.input_data_refs binds a DataArtifact with role=RAW_PROBLEM",
    SEMANTIC,
    chain_with_field("RunArtifact", "input_data_refs", ["DA-RAW"]),
    "BLOCKED", ["Problem Contract failure", "unbound_data_artifact"],
    [],
))

FIXTURES.append((
    "R-016", "variable_refs binds a SymbolSpec with role=PARAMETER (kind right, role wrong)",
    SEMANTIC,
    chain_with_field("ModelSpec", "variable_refs", ["SYM-rho"]),
    "BLOCKED", ["Problem Contract failure", "symbol_role_mismatch"],
    [],
))

FIXTURES.append((
    "R-017", "RequirementSpec source_data_ref disagrees with ProblemSpec.raw_problem_ref",
    SEMANTIC,
    chain_with_requirement_source("R-OUT", "DA-IN"),
    "BLOCKED", ["Problem Contract failure", "cross_source_requirement"],
    [],
))

# --- R-018: full closed Problem Contract + backbone ---

FIXTURES.append((
    "R-018", "complete closed Problem Contract + backbone",
    SEMANTIC,
    base_chain(),
    "PASS", [],
    [],
))


def write_pair(fid, description, root_cause, chain, expected_status, reason_matches, ingest_matches):
    fixture = {
        "id": fid,
        "description": description,
        "root_cause": root_cause,
        "mode": "FORMAL",
        "ir_claims": [],
        "ingest": [{"kind": k, "value": v} for k, v in chain],
    }
    verdict = {
        "id": fid,
        "description": description,
        "root_cause": root_cause,
        "expected_status": expected_status,
        "expected_reason_matches": reason_matches,
        "expected_ingest_reason_matches": ingest_matches,
    }
    (ROOT / f"{fid}.json").write_text(json.dumps(fixture, indent=2, ensure_ascii=False), encoding="utf-8")
    (ROOT / f"{fid}.verdict.json").write_text(json.dumps(verdict, indent=2, ensure_ascii=False), encoding="utf-8")


def main():
    for fid, desc, cause, chain, status, reason, ingest in FIXTURES:
        write_pair(fid, desc, cause, chain, status, reason, ingest)
    print(f"wrote {len(FIXTURES)} fixtures to {ROOT}")


if __name__ == "__main__":
    main()
