#!/usr/bin/env python3
"""
符号一致性检查（上限解放架构 L3 — 符号证据通道的 harness 侧驱动）。

**为什么由 harness 生成检查、而不是让模型手写脚本**：
容器是 JSON，把一段 Python 源码塞进 JSON 字符串里要过两层转义，模型很容易写坏；
而"表达式能不能解析、用到的符号有没有声明、lhs/rhs 与自由符号是否一致"这三件事
**完全可以从 `EquationSpec` 推出来**，不需要模型写一行代码。因此本脚本由 harness
喂入已声明的符号表与方程表，自己做代数检查。

**它检查什么**（全部是**形式一致性**，不是数学正确性）：

  1. `SYM-001` 表达式可解析：`sympy.sympify` 能吃下它。
  2. `SYM-002` 自由符号已声明：表达式里出现的每个符号都能在符号表里找到
     （按 token 或 symbol_id 匹配）。**这是最常见的一类建模错误**——方程里用了
     一个从未声明的量。
  3. `SYM-003` lhs/rhs 与自由符号一致：声明的 `lhs_symbols`/`rhs_symbols` 合起来
     必须覆盖表达式里的自由符号，且不包含表达式里没有的符号。
  4. `SYM-004` 单位非空：每个方程都带非空 `unit`（无量纲写 `dimensionless`）。

**它不检查什么（必须说清）**：方程**对不对**、假设**合不合理**、单位**量纲是否
真的自洽**。这些是语义问题，本脚本不声称能判。因此它产出的证据级别是
`structural_check`——**不能说"证明"**。

输入（stdin）：JSON
  {
    "symbols":  [{"id": "S-T", "token": "T", "unit": "K"}, ...],
    "equations": [{"id": "EQ-1", "expression": "...", "lhs_symbols": ["S-T"],
                   "rhs_symbols": ["S-K"], "unit": "K"}, ...]
  }

输出（stdout）：JSON
  {"claims": [{"claim_id": "SYM-<eq_id>", "statement": "...", "level": "structural_check",
               "passed": true|false, "detail": "..."}], "available": true|false}
"""
import json
import sys

try:
    from sympy import sympify, Symbol
    from sympy.core.sympify import SympifyError
    SYMPY_AVAILABLE = True
except Exception:  # pragma: no cover - environment without sympy
    SYMPY_AVAILABLE = False


def free_symbol_names(expr):
    """Free symbol names of a parsed expression, as plain strings."""
    return {str(s) for s in expr.free_symbols}


def check_equation(eq, declared_tokens, token_of):
    """Return a list of (rule, ok, detail) for one equation."""
    findings = []
    eq_id = eq.get("id", "?")
    expression = eq.get("expression") or ""

    # SYM-004 — a non-empty unit is a schema requirement; check it here too so
    # the symbolic pass is self-contained.
    unit = eq.get("unit") or ""
    findings.append(("SYM-004", len(str(unit).strip()) > 0,
                     f"方程 {eq_id} 单位字段为{'空' if not str(unit).strip() else str(unit)}"))

    # SYM-001 — parseable.
    try:
        parsed = sympify(expression, evaluate=False)
    except (SympifyError, SyntaxError, TypeError, ValueError) as exc:
        findings.append(("SYM-001", False, f"方程 {eq_id} 表达式无法解析：{exc}"))
        return findings
    findings.append(("SYM-001", True, f"方程 {eq_id} 表达式可解析"))

    free = free_symbol_names(parsed)

    # SYM-002 — every free symbol is declared.
    undeclared = sorted(free - declared_tokens)
    findings.append((
        "SYM-002", len(undeclared) == 0,
        f"方程 {eq_id} 自由符号 {sorted(free) or '（无）'}"
        + ("；全部已在符号表中声明" if not undeclared else f"；**未声明**：{undeclared}"),
    ))

    # SYM-003 — declared lhs/rhs cover the free symbols and add nothing.
    declared_side = set()
    for key in ("lhs_symbols", "rhs_symbols"):
        for item in eq.get(key) or []:
            declared_side.add(str(item))
    # lhs/rhs carry symbol_ids; map them back to tokens for comparison.
    mapped = {token_of.get(sid, sid) for sid in declared_side}
    missing = sorted(free - mapped)
    extra = sorted(mapped - free)
    findings.append((
        "SYM-003", len(missing) == 0 and len(extra) == 0,
        f"方程 {eq_id} 声明的符号侧"
        + ("与表达式自由符号一致" if not missing and not extra
           else f"与表达式自由符号不一致（表达式有而声明缺：{missing or '无'}；声明有而表达式无：{extra or '无'}）"),
    ))
    return findings


def main():
    payload = json.load(sys.stdin)
    symbols = payload.get("symbols") or []
    equations = payload.get("equations") or []

    if not SYMPY_AVAILABLE:
        # 未执行 ≠ 通过（C3）。如实报告 unavailable，由调用方落 unverifiable。
        print(json.dumps({"available": False, "claims": [], "reason": "sympy 不可用"}))
        return 0

    # token → symbol_id, and symbol_id → token (both directions are needed:
    # expressions carry tokens, lhs/rhs carry ids).
    token_of = {}
    for sym in symbols:
        sid = str(sym.get("id") or "")
        token = str(sym.get("token") or "")
        if sid:
            token_of[sid] = token
    declared_tokens = {t for t in token_of.values() if t}

    claims = []
    for eq in equations:
        eq_id = str(eq.get("id") or "?")
        findings = check_equation(eq, declared_tokens, token_of)
        failed = [f for f in findings if not f[1]]
        claims.append({
            "claim_id": f"SYM-{eq_id}",
            "statement": f"方程 {eq_id} 的形式一致性（可解析 / 符号已声明 / lhs-rhs 一致 / 单位非空）",
            "level": "structural_check",
            "passed": len(failed) == 0,
            "detail": "；".join(f"[{rule}] {detail}" for rule, _, detail in findings),
        })

    print(json.dumps({"available": True, "claims": claims}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
