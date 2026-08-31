#!/usr/bin/env python3
"""Generate the 18 C-001..C-018 fault fixtures and their verdict files.

Ingest order matters because ModelingIr is append-only: a ref to id X can
only resolve if X was already ingested. The dependency order is

    DataArtifact (RAW_PROBLEM) -> DataArtifact (INPUT_DATA) ->
    RequirementSpec (SUBPROBLEM) -> RequirementSpec (REQUIRED_OUTPUT) ->
    ProblemSpec -> SymbolSpec (VARIABLE) -> SymbolSpec (PARAMETER) ->
    ModelSpec -> RunArtifact -> Result -> Claim -> VerificationResult ->
    FigureSpec -> ReviewerFinding

SymbolSpec.scope_ref is a ProblemSpec ref, so ProblemSpec comes first.
ModelSpec.variable_refs / parameter_refs[].symbol_ref must point at
SymbolSpecs already registered. RequirementSpec.source_data_ref points at
the RAW_PROBLEM DataArtifact, so the DataArtifact is first.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SHA = "sha256:" + "a" * 64


def chain_with_attack(attack_kind, attack_value, mode='replace'):
    """Return the canonical dependency-ordered chain with the attack applied.

    `mode='replace'`: replace the first entry whose kind matches `attack_kind`
    with the attack value (default — used for shape changes that the schema
    should refuse, or for changing the role of an existing object).

    `mode='append'`: keep the entire canonical chain, then append the attack
    value at the end (used for duplicates — the canonical record stays
    intact so ModelSpec refs still resolve, and the duplicate triggers the
    same-scope check).
    """
    base = [
        ("DataArtifact", {"data_id": "DA-RAW", "role": "RAW_PROBLEM", "locator": "file:///problem/2026-mcm-a.txt", "content_hash": SHA, "media_type": "text/markdown", "description": "The MCM 2026 problem A statement."}),
        ("DataArtifact", {"data_id": "DA-IN", "role": "INPUT_DATA", "locator": "file:///runs/RUN1/input.csv", "content_hash": SHA, "media_type": "text/csv", "description": "Survey line observations for RUN1."}),
        ("RequirementSpec", {"requirement_id": "R-SUB", "source_data_ref": "DA-RAW", "requirement_type": "SUBPROBLEM", "statement": "Estimate the ice thickness profile."}),
        ("RequirementSpec", {"requirement_id": "R-OUT", "source_data_ref": "DA-RAW", "requirement_type": "REQUIRED_OUTPUT", "statement": "Produce a thickness profile table."}),
        ("ProblemSpec", {"problem_id": "P1", "raw_problem_ref": "DA-RAW", "requirement_refs": ["R-SUB", "R-OUT"]}),
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
    if mode == 'append':
        return base + [(attack_kind, attack_value)]
    out = []
    replaced = False
    for k, v in base:
        if k == attack_kind and not replaced:
            out.append((k, attack_value))
            replaced = True
        else:
            out.append((k, v))
    if not replaced:
        out.append((attack_kind, attack_value))
    return out


def emit(fixture_id, mode, attack_kind, attack_value, expected_status="BLOCKED", expected_reason_matches=None, description="", attack_mode='replace', expected_ingest_reason_matches=None):
    chain = chain_with_attack(attack_kind, attack_value, mode=attack_mode)
    fix = {
        "id": fixture_id,
        "description": description,
        "mode": mode,
        "ir_claims": [],
        "ingest": [{"kind": k, "value": v} for k, v in chain],
    }
    ver = {"id": fixture_id, "expected_status": expected_status, "expected_reason_matches": expected_reason_matches, "description": description}
    # Root-cause pinning. The bridge reason reports the downstream symptom
    # ("DA-RAW is not a registered DataArtifact"); the ingest log reports why
    # the object was refused in the first place. A fixture that asserts only
    # the symptom would also pass for an unrelated breakage, so schema-rejected
    # attacks additionally pin the ingest-level cause.
    if expected_ingest_reason_matches:
        ver["expected_ingest_reason_matches"] = expected_ingest_reason_matches
    (ROOT / f"{fixture_id}.json").write_text(json.dumps(fix, indent=2, ensure_ascii=False))
    (ROOT / f"{fixture_id}.verdict.json").write_text(json.dumps(ver, indent=2, ensure_ascii=False))


# C-001: legacy nested subproblems/required_outputs on ProblemSpec. Schema-invalid.
emit("C-001", "FORMAL", "ProblemSpec",
     {"problem_id": "P1", "raw_problem_ref": "DA-RAW", "subproblems": [{"subproblem_id": "S1", "statement": "x"}], "required_outputs": [{"output_id": "O1", "description": "y"}], "constraints": [], "requirement_refs": ["R-SUB", "R-OUT"]},
     description="legacy nested subproblems/required_outputs on ProblemSpec (schema_invalid)",
     expected_reason_matches=["Problem Contract", "RAW_PROBLEM"])

# C-002: ProblemSpec.requirement_refs points at nonexistent id.
emit("C-002", "FORMAL", "ProblemSpec",
     {"problem_id": "P1", "raw_problem_ref": "DA-RAW", "requirement_refs": ["R-DOES-NOT-EXIST"]},
     description="requirement_ref points at unregistered id",
     expected_reason_matches=["requirement_refs.R-DOES-NOT-EXIST", "unresolved_reference"])

# C-003: requirement_ref points at a Claim.
emit("C-003", "FORMAL", "ProblemSpec",
     {"problem_id": "P1", "raw_problem_ref": "DA-RAW", "requirement_refs": ["C1"]},
     description="requirement_ref resolves to a Claim (kind mismatch)",
     expected_reason_matches=["requirement_refs.C1", "reference_kind_mismatch"])

# C-004: RequirementSpec.source_data_ref points at INPUT_DATA, ProblemSpec at RAW_PROBLEM
emit("C-004", "FORMAL", "RequirementSpec",
     {"requirement_id": "R-SUB", "source_data_ref": "DA-IN", "requirement_type": "SUBPROBLEM", "statement": "x"},
     description="RequirementSpec source_data_ref points at INPUT_DATA (cross-source)",
     expected_reason_matches=["requirement_refs.R-SUB", "cross_source_requirement"])

# C-005: ProblemSpec.raw_problem_ref is a file:// string.
emit("C-005", "FORMAL", "ProblemSpec",
     {"problem_id": "P1", "raw_problem_ref": "file:///problem/2026-mcm-a.txt", "requirement_refs": ["R-SUB", "R-OUT"]},
     description="ProblemSpec.raw_problem_ref is a file:// locator instead of DataArtifact id",
     expected_reason_matches=["raw_problem_ref", "unresolved_reference"])

# C-006: DataArtifact with no content_hash.
emit("C-006", "FORMAL", "DataArtifact",
     {"data_id": "DA-RAW", "role": "RAW_PROBLEM", "locator": "file:///problem/x.txt", "media_type": "text/markdown", "description": "missing hash"},
     description="DataArtifact missing content_hash (schema_invalid)",
     expected_reason_matches=["unresolved_reference", "minimum Problem Contract not satisfied", "RAW_PROBLEM"],
     expected_ingest_reason_matches=["content_hash"])

# C-007: content_hash with truncated hex.
emit("C-007", "FORMAL", "DataArtifact",
     {"data_id": "DA-RAW", "role": "RAW_PROBLEM", "locator": "file:///problem/x.txt", "content_hash": "sha256:1234", "media_type": "text/markdown", "description": "bad hash"},
     description="DataArtifact content_hash='sha256:1234' (truncated)",
     expected_reason_matches=["unresolved_reference", "minimum Problem Contract not satisfied", "RAW_PROBLEM"],
     expected_ingest_reason_matches=["content_hash"])

# C-008: RAW_PROBLEM DataArtifact used as RunArtifact input_data_ref.
emit("C-008", "FORMAL", "RunArtifact",
     {"run_id": "RUN1", "model_ref": "M1", "code_ref": "file:///runs/RUN1/main.py", "input_data_refs": ["DA-RAW"], "environment": "python 3.13", "seed": 1, "exit_status": 0, "stdout_ref": "file:///stdout", "stderr_ref": "file:///stderr", "output_refs": [], "code_hash": SHA, "input_hash": SHA, "output_hash": SHA},
     description="RAW_PROBLEM DataArtifact reused as RunArtifact input_data_ref",
     expected_reason_matches=["input_data_refs.DA-RAW", "reference_kind_mismatch"])

# C-009: RunArtifact uses legacy input_refs field.
emit("C-009", "FORMAL", "RunArtifact",
     {"run_id": "RUN1", "model_ref": "M1", "code_ref": "file:///runs/RUN1/main.py", "input_refs": ["file:///x.csv"], "input_data_refs": ["DA-IN"], "environment": "python 3.13", "seed": 1, "exit_status": 0, "stdout_ref": "file:///stdout", "stderr_ref": "file:///stderr", "output_refs": [], "code_hash": SHA, "input_hash": SHA, "output_hash": SHA},
     description="RunArtifact with legacy input_refs field (schema_invalid)",
     expected_reason_matches=["missing IR backbone", "RunArtifact"])

# C-010: same token, different meanings in same scope.
emit("C-010", "FORMAL", "SymbolSpec",
     {"symbol_id": "SYM-x2", "scope_ref": "P1", "token": "x", "meaning": "thickness along track", "unit": "m", "role": "VARIABLE"},
     description="two SymbolSpec records share token 'x' with different meanings in same scope",
     expected_reason_matches=["duplicate_symbol_token", "P1/x"],
     attack_mode='append')

# C-011: same token, different units.
emit("C-011", "FORMAL", "SymbolSpec",
     {"symbol_id": "SYM-x-m", "scope_ref": "P1", "token": "x", "meaning": "distance along track", "unit": "s", "role": "VARIABLE"},
     description="two SymbolSpec records share token 'x' with different units",
     expected_reason_matches=["duplicate_symbol_token", "P1/x"],
     attack_mode='append')

# C-012: ModelSpec.variable_refs points at a PARAMETER SymbolSpec.
emit("C-012", "FORMAL", "ModelSpec",
     {"model_id": "M1", "problem_refs": ["P1"], "assumptions": ["Ice is a homogeneous slab."], "variable_refs": ["SYM-rho"], "parameter_refs": [{"symbol_ref": "SYM-rho", "value": 917}], "equations": ["h(x) = a * x + b"], "constraints": ["x >= 0"], "objective": None, "dependencies": []},
     description="ModelSpec.variable_refs points at PARAMETER SymbolSpec (role mismatch)",
     expected_reason_matches=["variable_refs.SYM-rho", "symbol_role_mismatch"])

# C-013: ModelSpec.parameter_refs[].symbol_ref points at a VARIABLE SymbolSpec.
emit("C-013", "FORMAL", "ModelSpec",
     {"model_id": "M1", "problem_refs": ["P1"], "assumptions": ["Ice is a homogeneous slab."], "variable_refs": ["SYM-x"], "parameter_refs": [{"symbol_ref": "SYM-x", "value": 1.0}], "equations": ["h(x) = a * x + b"], "constraints": ["x >= 0"], "objective": None, "dependencies": []},
     description="ModelSpec.parameter_refs points at VARIABLE SymbolSpec (role mismatch)",
     expected_reason_matches=["parameter_role_mismatch", "parameter_refs.SYM-x"])

# C-014: ModelSpec re-embeds variables with meaning/unit (legacy).
emit("C-014", "FORMAL", "ModelSpec",
     {"model_id": "M1", "problem_refs": ["P1"], "assumptions": ["Ice is a homogeneous slab."], "variable_refs": ["SYM-x"], "parameter_refs": [{"symbol_ref": "SYM-rho", "value": 917}], "variables": [{"symbol": "x", "meaning": "distance", "unit": "m"}], "equations": ["h(x) = a * x + b"], "constraints": ["x >= 0"], "objective": None, "dependencies": []},
     description="ModelSpec re-embeds variables with meaning/unit (legacy)",
     expected_reason_matches=["missing IR backbone", "ModelSpec"])

# C-015: FigureSpec.data_refs points at a ModelSpec.
emit("C-015", "FORMAL", "FigureSpec",
     {"figure_id": "F1", "data_refs": ["M1"], "claim_refs": ["C1"]},
     description="FigureSpec.data_refs points at a ModelSpec (one-of mismatch)",
     expected_reason_matches=["figure_target_not_union", "data_refs.M1"])

# C-016: FORMAL, only 5-kind backbone.
backbone = [
    ("ProblemSpec", {"problem_id": "P1", "raw_problem_ref": "file:///x", "requirement_refs": []}),
    ("ModelSpec", {"model_id": "M1", "problem_refs": ["P1"], "assumptions": [], "variable_refs": [], "parameter_refs": [], "equations": [], "constraints": [], "objective": None, "dependencies": []}),
    ("RunArtifact", {"run_id": "RUN1", "model_ref": "M1", "code_ref": "file:///runs/RUN1/main.py", "input_data_refs": [], "environment": "python 3.13", "seed": 1, "exit_status": 0, "stdout_ref": "file:///stdout", "stderr_ref": "file:///stderr", "output_refs": [], "code_hash": SHA, "input_hash": SHA, "output_hash": SHA}),
    ("Result", {"result_id": "RES1", "run_ref": "RUN1", "name": "x", "value": 1.0, "unit": "m", "uncertainty": None, "source_location": "file:///x"}),
    ("Claim", {"claim_id": "C1", "text": "x", "claim_type": "NUMERIC", "criticality": "CRITICAL", "evidence_refs": ["RES1"], "result_refs": ["RES1"], "model_refs": ["M1"]}),
]
for fid, mode, desc in [
    ("C-016", "FORMAL", "FORMAL with old 5-kind backbone but no Requirement/Data/Symbol"),
    ("C-017", "fast", "FAST (case-insensitive) with old 5-kind backbone but no Requirement/Data/Symbol"),
]:
    fix = {"id": fid, "description": desc, "mode": mode, "ir_claims": [], "ingest": [{"kind": k, "value": v} for k, v in backbone]}
    ver = {"id": fid, "expected_status": "BLOCKED", "expected_reason_matches": ["Problem Contract", "RAW_PROBLEM"], "description": desc}
    (ROOT / f"{fid}.json").write_text(json.dumps(fix, indent=2, ensure_ascii=False))
    (ROOT / f"{fid}.verdict.json").write_text(json.dumps(ver, indent=2, ensure_ascii=False))

# C-018: PASS — full contract + backbone.
base = [
    ("DataArtifact", {"data_id": "DA-RAW", "role": "RAW_PROBLEM", "locator": "file:///problem/2026-mcm-a.txt", "content_hash": SHA, "media_type": "text/markdown", "description": "The MCM 2026 problem A statement."}),
    ("DataArtifact", {"data_id": "DA-IN", "role": "INPUT_DATA", "locator": "file:///runs/RUN1/input.csv", "content_hash": SHA, "media_type": "text/csv", "description": "Survey line observations for RUN1."}),
    ("RequirementSpec", {"requirement_id": "R-SUB", "source_data_ref": "DA-RAW", "requirement_type": "SUBPROBLEM", "statement": "Estimate the ice thickness profile."}),
    ("RequirementSpec", {"requirement_id": "R-OUT", "source_data_ref": "DA-RAW", "requirement_type": "REQUIRED_OUTPUT", "statement": "Produce a thickness profile table."}),
    ("ProblemSpec", {"problem_id": "P1", "raw_problem_ref": "DA-RAW", "requirement_refs": ["R-SUB", "R-OUT"]}),
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
fix = {"id": "C-018", "description": "happy path: full TASK 1.5 Problem Contract + backbone", "mode": "FORMAL", "ir_claims": [], "ingest": [{"kind": k, "value": v} for k, v in base]}
ver = {"id": "C-018", "expected_status": "PASS", "expected_reason_matches": [], "description": "happy path"}
(ROOT / "C-018.json").write_text(json.dumps(fix, indent=2, ensure_ascii=False))
(ROOT / "C-018.verdict.json").write_text(json.dumps(ver, indent=2, ensure_ascii=False))

print("Generated 18 fixtures + 18 verdicts under", ROOT)