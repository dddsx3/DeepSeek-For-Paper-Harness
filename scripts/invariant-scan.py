#!/usr/bin/env python3
"""
声明式不变量随机扫描（DECLARED-INVARIANT SCAN — Lean 评估中间路径 a/d，
见 docs/LEAN-ASSESSMENT.md §6）。

**它解决什么**：2024B 真实缺陷 F-002（U_v 漏除交付概率 q_v —— 单位/口径错误）与
F-003（根节点删掉调换损失项 —— 守恒/边界错误）的共同形态是：模型声明的公式在
点值上看着对，但在参数域的**随机采样**下站不住。本脚本对声明的每条不变量
（等式/不等式/残差式）在变量声明域上均匀采样 N 个点逐点核对 —— 竞赛精度下
"概率证明"足够，且完全复用现有执行通道。

**SHELL-SIDE HELPER** —— 与 sympy-v7-check.py 同一模式：引擎经 subprocess 喂入
JSON、收回 JSON 报告，`invariant-scan.ts` 包装成 verification finding。

输入（stdin）：JSON
  {
    "variables":  [{"name": "p1", "low": 0, "high": 1, "unit": "probability"}, ...],
    "invariants": [{"id": "INV-A", "expr": "p1 + p2 <= 1", "vars": ["p1", "p2"],
                    "description": "概率和不超过 1"}, ...],
    "samples": 20000,          # 可省，默认 20000，单次上限 200000
    "seed": 0                  # 可省，默认 0 —— 固定种子：同一输入同一判定（可复算）
  }

输出（stdout）：JSON {"ok": bool, "findings": [{"rule", "ok", "detail"}, ...]}

规则：
  INV-000 环境缺依赖：sympy 不可用 —— 通道整体未运行（单条 finding，不崩）。
  INV-001 表达式不可核：解析失败 / 引用未声明符号 / vars 引用未声明变量 /
          依赖非法变量域。F-002 那类"口径对不上"最先在这里现形。
  INV-002 随机扫描判定：逐点核对全部采样。违约率 > 0 即 ok:false，报违约率 +
          一个违约样本（变量值 → 残差）；全部样本未定义/非有限同样 ok:false。
  INV-003 样本数与变量域健全性 + 本次扫描摘要。

判定语义（数值容差表 —— 防浮点假红是本仓库头号纪律）：
  a == b   违约当 |a-b| > 1e-9（等式必须带容差：随机采样下精确相等不可依赖）
  a != b   违约当 |a-b| <= 1e-9
  a <= b   违约当 b-a < -1e-9（边界容差：浮点下 p1+p2 = 1.0000000000000002 不是违约）
  a >= b   违约当 a-b < -1e-9
  a <  b   违约当 b-a <= 0（严格不等不带容差 —— Lt/Le 混写本身就是 F-003 边界缺陷形态）
  a >  b   违约当 a-b <= 0
  裸表达式  违约当 |expr| > 1e-9（守恒式写残差形态用；残差期望为 0）

屏蔽（masking）语义：单个样本上表达式未定义（除零、负数开方、上溢、复数）或
结果非有限 → 不计入违约，但计数并写进 detail（"定义域含奇点"是 F-003 边界错误
的近亲，必须可见）；若**全部**样本未定义 → ok:false（表达式在整个声明域上不可
评估是缺陷信号，不是静默通过）。

它不检查什么（必须说清）：不变量**是不是模型该有的**（漏声明这里看不见 —— 声明
完整性由 modeling_self_check 一类判据把守）；量纲是否自洽（v7/symbolic 通道管）；
随机扫描不是证明 —— 它是"在声明域上找反例"，找不到反例 ≠ 恒成立。固定种子保证
同一输入同一判定（可复算），但换个种子可能翻案 —— 翻案本身就是"边界上的声明"，
应当收紧域而不是调种子。
"""

import json
import math
import random
import sys

TOLERANCE = 1e-9
DEFAULT_SAMPLES = 20_000
MAX_SAMPLES = 200_000
SEED_DEFAULT = 0

try:
    import sympy
    from sympy import Eq, Ne
    from sympy.core.relational import Relational
    from sympy.logic.boolalg import BooleanFalse, BooleanTrue
    from sympy.parsing.sympy_parser import parse_expr
    SYMPY_IMPORT_ERROR = None
except ImportError as error:  # 环境相关路径；有 sympy 的机器上不会走
    SYMPY_IMPORT_ERROR = str(error)

# kind → 中文标签（detail 里用；kind 语义见 _classify）
KIND_LABEL = {
    'eq': '等式',
    'ne': '不等(≠)',
    'le': '不等(≤)',
    'lt': '不等(<)',
    'ge': '不等(≥)',
    'gt': '不等(>)',
    'residual': '残差',
}


def finding(rule, ok, detail):
    return {"rule": rule, "ok": bool(ok), "detail": detail}


def _rewrite_equality(expr):
    """把顶层 `==`/`!=` 改写成 Eq(...)/Ne(...)。

    **为什么必须**：parse_expr 不转换 `==`/`!=` —— 它们走 Python 运算符，而
    `Expr.__eq__` 返回**原生 bool**（结构相等判定），于是 `(p1+p2)**2 ==
    p1**2+2*p1*p2+p2**2` 会在解析期塌缩成 False（其实只是没展开）—— 直接判
    恒假就是一记假红。改写成 Eq/Ne 让等式活到分类阶段，走残差容差路径。
    只改**括号深度 0** 的那一处；嵌套在括号里的比较不碰（见 bool 塌缩守卫）。
    """
    for op, ctor in (('!=', 'Ne'), ('==', 'Eq')):
        depth = 0
        for idx, ch in enumerate(expr):
            if ch == '(':
                depth += 1
            elif ch == ')':
                depth -= 1
            elif depth == 0 and expr.startswith(op, idx):
                lhs, rhs = expr[:idx], expr[idx + len(op):]
                if lhs.strip() and rhs.strip():
                    return f"{ctor}({lhs}, {rhs})"
    return expr


def _classify(parsed):
    """折算成 (kind, 残差表达式, 违约判定)。

    统一**残差化**：一切关系都折成"一个数值残差 + 违约谓词"，这样等式可以走
    容差（随机采样下 Eq 精确相等不可依赖），严格不等可以保持严格。见模块
    docstring 的容差表。
    """
    if isinstance(parsed, Relational):
        diff = parsed.lhs - parsed.rhs
        op = parsed.rel_op
        if op == '==':
            return 'eq', diff, lambda r: abs(r) > TOLERANCE
        if op == '!=':
            return 'ne', diff, lambda r: abs(r) <= TOLERANCE
        if op == '<=':
            return 'le', parsed.rhs - parsed.lhs, lambda r: r < -TOLERANCE
        if op == '>=':
            return 'ge', diff, lambda r: r < -TOLERANCE
        if op == '<':
            return 'lt', parsed.rhs - parsed.lhs, lambda r: r <= 0.0
        return 'gt', diff, lambda r: r <= 0.0
    return 'residual', parsed, lambda r: abs(r) > TOLERANCE


def _sample_uniform(low, high, n, rng, use_numpy):
    """[low, high] 上的均匀采样。numpy 走 Generator（固定种子流）；退化路径
    random.Random.uniform 判定语义不变，只是流不同（种子都固定）。"""
    if use_numpy:
        return rng.uniform(low, high, n).tolist()
    return [rng.uniform(low, high) for _ in range(n)]


def _scan_one(inv, declared, arrays, units, broken):
    """扫一条不变量，返回一条 finding（INV-001 或 INV-002）。"""
    inv_id = str(inv.get('id', '(未命名)'))
    desc = f"不变量 {inv_id}"
    if inv.get('description'):
        desc += f"({str(inv['description'])[:40]})"

    expr = inv.get('expr')
    if not isinstance(expr, str) or not expr.strip():
        return finding('INV-001', False, f"{desc} 的 expr 缺失或不是字符串 —— 没有可核的表达式")

    local = {name: sympy.Symbol(name) for name in declared}
    try:
        parsed = parse_expr(_rewrite_equality(expr), local_dict=local)
    except Exception as error:  # sympy 解析错误形态太多，统一按 INV-001 如实转述
        return finding('INV-001', False, f"{desc} 表达式解析失败: {str(error)[:120]} —— 修 expr 本身")

    # 恒真/恒假守卫。恒真（含 Eq 结构化简与解析期塌缩出的 True）与采样无关，视为通过；
    # 塌缩出的 **False 不可信**（sympy 的结构比较没展开，见 _rewrite_equality），
    # 按 INV-001 要求改写 —— 既不假红也不假绿。
    if parsed is True or isinstance(parsed, BooleanTrue):
        return finding('INV-002', True, f"{desc} 恒真(解析即化简为 True) —— 视为通过;若本意非恒真,检查是否写重了")
    if isinstance(parsed, BooleanFalse):
        return finding('INV-002', False, f"{desc} 恒假(解析即化简为 False) —— 声明的约束自相矛盾")
    if parsed is False:
        return finding('INV-001', False,
                       f"{desc} 在解析期塌缩为原生 bool False —— 结构比较未展开,不能据此判恒假;"
                       "把嵌套的 `==` 改写成 Eq(lhs, rhs) 或手动展开两侧")

    free = {str(s) for s in parsed.free_symbols}
    unknown = sorted(free - declared)
    if unknown:
        return finding('INV-001', False,
                       f"{desc} 引用了未声明的符号 {', '.join(unknown)} —— 表达式与符号表口径对不上(F-002 形态)")

    # vars 是声明方给的变量清单：只做"引用的都是声明过的"这一道一致性检查;
    # 实际采样/求值一律以表达式自由符号为准（避免 vars 漏写导致 NameError 逃逸）。
    requested = inv.get('vars')
    names_req = [str(v) for v in requested] if isinstance(requested, list) and requested else []
    missing = sorted(set(names_req) - declared)
    if missing:
        return finding('INV-001', False, f"{desc} 的 vars 引用了未声明的变量 {', '.join(missing)}")

    broken_ref = sorted((set(names_req) | free) & broken)
    if broken_ref:
        return finding('INV-001', False, f"{desc} 依赖非法变量域 {', '.join(broken_ref)} —— 先修变量声明再扫")

    arg_names = sorted(free | set(names_req))
    kind, residual, violates = _classify(parsed)
    try:
        f = sympy.lambdify(arg_names, residual, modules='math')
    except Exception as error:
        return finding('INV-001', False, f"{desc} 无法编译为可采样函数: {str(error)[:120]}")

    n = len(arrays[arg_names[0]]) if arg_names else 1
    tol_note = f"(容差 {TOLERANCE:g})" if kind in ('eq', 'ne', 'residual', 'le', 'ge') else "(严格不等,无容差)"

    violations = 0
    first_violation = None
    undefined = 0
    for i in range(n):
        args = [arrays[v][i] for v in arg_names]
        try:
            r = f(*args)
        except (ArithmeticError, NameError, TypeError, ValueError):
            undefined += 1
            continue
        if isinstance(r, bool) or not isinstance(r, (int, float)):
            try:
                r = float(r)
            except (TypeError, ValueError):
                undefined += 1
                continue
        if not math.isfinite(r):
            undefined += 1
            continue
        if violates(r):
            violations += 1
            if first_violation is None:
                first_violation = (i, float(r))

    def fmt(name, idx):
        unit = units.get(name, '')
        return f"{name}={arrays[name][idx]:.6g}" + (f"[{unit}]" if unit else '')

    if n > 0 and undefined >= n:
        return finding('INV-002', False,
                       f"{desc} 全部 {n} 个样本未定义/非有限 —— 表达式在整个声明域上不可评估(检查定义域奇点与表达式)")

    if first_violation is not None:
        i0, r0 = first_violation
        sample = ', '.join(fmt(v, i0) for v in arg_names) if arg_names else '(常数表达式)'
        detail = f"{desc} 违约率 {violations / n:.2%} ({violations}/{n}) — 例: {sample} → 残差 {r0:.6g} {tol_note}"
        if undefined:
            detail += f"; {undefined} 个样本未定义/非有限已屏蔽"
        return finding('INV-002', False, detail)

    detail = f"{desc} 0/{n} 样本违约[{KIND_LABEL[kind]}] {tol_note}"
    if undefined:
        detail += f"; {undefined} 个样本未定义/非有限已屏蔽"
    return finding('INV-002', True, detail)


def _parse_samples(raw):
    """samples 的宽容解析：整数直接用，整值浮点收编，其余一律 None（不合法）。"""
    if isinstance(raw, bool):
        return None
    if isinstance(raw, int):
        return raw
    if isinstance(raw, float) and raw.is_integer():
        return int(raw)
    return None


def main():
    if SYMPY_IMPORT_ERROR is not None:
        _emit([finding('INV-000', False,
                       f"sympy 不可用({SYMPY_IMPORT_ERROR}) —— 不变量扫描通道整体未运行;"
                       "这是环境问题,不是模型问题;安装 sympy 后重试")])
        return
    inp = json.loads(sys.stdin.read()) if not sys.stdin.isatty() else json.load(open(sys.argv[1]))

    # 采样数健全性：不合法回退默认（照扫，但 INV-003 如实记一笔）。
    raw_samples = _parse_samples(inp.get('samples', DEFAULT_SAMPLES))
    sanity = []
    sanity_ok = True
    if raw_samples is None or raw_samples <= 0:
        samples_eff = DEFAULT_SAMPLES
        sanity_ok = False
        sanity.append(f"samples={inp.get('samples')!r} 不是正整数,回退默认 {DEFAULT_SAMPLES}")
    elif raw_samples > MAX_SAMPLES:
        samples_eff = MAX_SAMPLES
        sanity.append(f"samples={raw_samples} 超过单次扫描上限,已截为 {MAX_SAMPLES}")
    else:
        samples_eff = raw_samples

    seed = inp.get('seed', SEED_DEFAULT)
    if isinstance(seed, bool) or not isinstance(seed, int):
        seed = SEED_DEFAULT

    # numpy 是首选采样器；缺了就退化为纯 Python（判定语义不变，如实记一笔）。
    try:
        import numpy
        rng = numpy.random.default_rng(seed)
        use_numpy = True
    except ImportError:
        rng = random.Random(seed)
        use_numpy = False
        sanity.append('numpy 不可用,已退化为纯 Python 采样(判定语义不变)')

    # 变量表：只收形态合法的条目；域非法的记 broken，引用它们的不变量按 INV-001 报。
    declared = set()
    arrays = {}
    units = {}
    broken = set()
    for v in inp.get('variables') or []:
        if not isinstance(v, dict):
            continue
        name = str(v.get('name', '')).strip()
        if not name:
            continue
        declared.add(name)
        units[name] = str(v['unit']) if v.get('unit') else ''
        try:
            low, high = float(v.get('low')), float(v.get('high'))
        except (TypeError, ValueError):
            broken.add(name)
            continue
        if not (math.isfinite(low) and math.isfinite(high)) or low > high:
            broken.add(name)
            continue
        arrays[name] = _sample_uniform(low, high, samples_eff, rng, use_numpy)
    if broken:
        sanity_ok = False
        sanity.append(f"变量域非法(low>high 或非数值): {', '.join(sorted(broken))} —— 引用它们的不变量按 INV-001 报告")

    invariants = [i for i in (inp.get('invariants') or []) if isinstance(i, dict)]
    findings = [_scan_one(inv, declared, arrays, units, broken) for inv in invariants]

    if not invariants:
        summary = '未声明不变量(跳过) —— 通道无事可做;声明完整性由 modeling_self_check 一类判据把守'
    else:
        summary = f"本次扫描 {len(invariants)} 条不变量 × {samples_eff} 样本/条 (seed={seed},固定种子可复算)"
    if sanity:
        summary += ' — ' + '; '.join(sanity)
    findings.append(finding('INV-003', sanity_ok, summary))
    _emit(findings)


def _emit(findings):
    print(json.dumps({'ok': not any(not f['ok'] for f in findings), 'findings': findings}, ensure_ascii=False))


if __name__ == '__main__':
    main()
