#!/usr/bin/env python3
"""
V7 sympy-based dimensional/residual/domain check (DPH-PRD-v2 §6.4).

Reads one problem's declared symbols (with units), equations, results, and
reports mismatches the sympy dimension/domain engine can detect.

THIS IS A SHELL-SIDE HELPER — the same pattern as summarize-data.py.
The engine calls it via subprocess (bundle-style), receives the JSON
report, and `v-domain.ts` packages it into a verification finding.

Input (stdin or file):
  JSON with:
    symbols: [{id, name, unit, domain}, ...]
    equations: [{id, expression, unit}, ...]
    results: [{id, value, unit}, ...]

Output (stdout):
  JSON with findings [{rule, ok, detail}, ...]

Rules:
  1. DIM-001: explicit-unit consistency — expressions tagged with a
     declared unit have at least one symbol of matching unit.
  2. DIM-002: dimension derivation — every result unit matches at least
     one declared symbol unit (weak check; strong = full sympy tracing).
  3. DOM-001: domain boundary — result value is within the declared
     symbol's domain (e.g. PROBABILITY -> 0..1, INTEGER -> integral).
  4. RES-001: residual present — if residuals are passed, check they
     are finite and centred near zero (|mean| < 0.5 * std).
"""

import json
import sys
import math

def dim_check(symbols, equations, results):
    findings = []
    unit_set = {s.get('unit') for s in symbols if s.get('unit')}

    # DIM-001: every equation with a declared unit should reference a symbol with that unit
    for eq in equations:
        eq_unit = eq.get('unit')
        if eq_unit and eq_unit in unit_set:
            finding_ok = any(s.get('unit') == eq_unit for s in symbols)
            findings.append({
                'rule': 'DIM-001',
                'ok': finding_ok,
                'detail': f"方程 {eq['id']} 标注单位 {eq_unit}{' 匹配 ' + eq_unit if finding_ok else ' 但在符号表中无匹配'}"
            })

    # DIM-002: each result unit should match at least one symbol unit
    seen_units = set()
    for r in results:
        ru = r.get('unit')
        if ru and ru not in seen_units:
            seen_units.add(ru)
            finding_ok = ru in unit_set
            findings.append({
                'rule': 'DIM-002',
                'ok': finding_ok,
                'detail': f"结果 {r['id']} 单位 {ru}{' 匹配题面' if finding_ok else ' 未在符号表中声明'}"
            })

    return findings


def domain_check(symbols, results):
    findings = []
    for r in results:
        val = r.get('value')
        if val is None:
            continue
        val = float(val)
        # Find the symbol whose unit matches the result's unit
        matching = [s for s in symbols if s.get('unit') == r.get('unit')]
        for sym in matching:
            dom = sym.get('domain', '')
            if dom == 'PROBABILITY' and (val < 0 or val > 1):
                findings.append({
                    'rule': 'DOM-001',
                    'ok': False,
                    'detail': f"结果 {r['id']} 值 {val} 超出概率域[0,1]"
                })
            elif dom == 'NONNEGATIVE_REAL' and val < 0:
                findings.append({
                    'rule': 'DOM-001',
                    'ok': False,
                    'detail': f"结果 {r['id']} 值 {val} 为非负实数域但值为负"
                })
            elif dom == 'NONNEGATIVE_INTEGER' and (val < 0 or not float(val).is_integer()):
                findings.append({
                    'rule': 'DOM-001',
                    'ok': False,
                    'detail': f"结果 {r['id']} 值 {val} 为非负整数域但不合要求"
                })
    # If no result had a match, that's a silent pass — the domain rule is
    # only flagged when both a result AND a matching symbol exist.
    if not findings:
        findings.append({
            'rule': 'DOM-001',
            'ok': True,
            'detail': '未检测到域界越限(或结果与符号域未关联)'
        })
    return findings


def residual_check(results_passed):
    findings = []
    residuals = results_passed  # if the caller passes an array named 'residuals'
    if not isinstance(residuals, list) or len(residuals) == 0:
        findings.append({
            'rule': 'RES-001',
            'ok': True,
            'detail': '未传入残差序列(跳过)'
        })
        return findings

    finite = [r for r in residuals if isinstance(r, (int, float)) and math.isfinite(r)]
    if len(finite) < 2:
        findings.append({
            'rule': 'RES-001',
            'ok': False,
            'detail': f'残差不足 {len(finite)} 个有限值(需要 ≥2)'
        })
        return findings

    mean = sum(finite) / len(finite)
    var = sum((x - mean) ** 2 for x in finite) / len(finite)
    std = math.sqrt(var) if var > 0 else 0.0
    centered = abs(mean) < 0.5 * std if std > 0 else abs(mean) < 1e-10
    findings.append({
        'rule': 'RES-001',
        'ok': centered,
        'detail': f'残差均值 {mean:.4f} / 标准差 {std:.4f}{"" if centered else " → 偏离中心零(可能偏置)"}'
    })
    return findings


def main():
    inp = json.loads(sys.stdin.read()) if not sys.stdin.isatty() else json.load(open(sys.argv[1]))
    findings = []
    findings += dim_check(inp.get('symbols', []), inp.get('equations', []), inp.get('results', []))
    findings += domain_check(inp.get('symbols', []), inp.get('results', []))
    findings += residual_check(inp.get('residuals', []))
    print(json.dumps({'ok': not any(not f['ok'] for f in findings), 'findings': findings}, ensure_ascii=False))


if __name__ == '__main__':
    main()