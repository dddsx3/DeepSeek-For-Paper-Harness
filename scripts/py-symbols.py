#!/usr/bin/env python3
"""
Python 符号表（AST）—— `claim_code_check` 的"符号级"判据。

**它解决什么**：门禁原来只用 `safeSearch` 在源码文本里找 `METHOD_CLAIMS_MACHINE`
的 must 签名。2024B 实跑里建模阶段声明 `beta_posterior` / `clopper_pearson_interval`
等名字，代码却实现成 `_beta_params` / `_posterior` —— 文本判据永远找不到，连续
多轮硬失败。判据层次错了：用"字符串是否出现"代理"方法是否实现"，两者只在模型
恰好同名时重合。

本脚本用标准库 `ast` 建符号表：所有 `def` / `async def` / `class`（含私有、方法、
嵌套）的 `name` / `qualname` / 函数体行数 / 非空非注释行数 / docstring。门禁据此
判断"符号是否存在"与"函数是不是空壳"，模型再在 `DELIVERABLES.json` 的
`impl_map` 里声明"声称 id → 实际函数名"。

**SHELL-SIDE HELPER** —— 与 invariant-scan.py / sympy-v7-check.py 同一模式：
引擎经 subprocess 喂入 JSON、收回 JSON。

输入（stdin）：JSON
  {"files": {"code/main.py": "<source>", "code/problem1.py": "<source>"}}

输出（stdout）：JSON
  {
    "ok": true,
    "defs": [{"name", "file", "qualname", "body_lines", "non_doc_lines", "docstring"}],
    "classes": [{"name", "file"}],
    "errors": [{"file", "error"}]
  }

判定口径：
  - `body_lines`：函数体（去掉 docstring 后的语句）覆盖的物理行数，含语句之间的
    空行与注释行；只有 docstring 的函数为 0。
  - `non_doc_lines`：同一段行范围里**非空且非整行注释**的行数。
  - `stub`：**AST 级空壳判定**——函数体（去 docstring）只由 `pass` / `...` /
    `raise NotImplementedError(...)` 组成即为空壳。不用行数阈值：实测
    `_oc_accept` 是一行真实实现（一行列表推导），行数判据会误杀"写得短"。
  - `docstring`：`ast.get_docstring()` 的结果（无 docstring 为 null）。门禁只把
    它当**软证据**：映射函数的 docstring 没引用 claim id 时提示，不判失败。

容错：单个文件解析失败（SyntaxError 等）只记进 `errors` 并继续处理其它文件；
输入本身坏掉时也输出 JSON（`ok: false`），**任何情况都不抛 traceback**。stdout
只允许 JSON —— 不打印日志。
"""

import ast
import json
import sys


def _is_docstring_statement(stmt):
    """判断函数体首条语句是否是 docstring（与 `ast.get_docstring` 的口径一致）。"""
    return (
        isinstance(stmt, ast.Expr)
        and isinstance(stmt.value, ast.Constant)
        and isinstance(stmt.value.value, str)
    )


def _is_stub_body(body):
    """空壳判定（AST 级，不是行数）：函数体（去 docstring 后）只由
    `pass` / `...`（Ellipsis） / `raise NotImplementedError(...)` 组成 → True。

    为什么不用行数阈值（2026-10-27 实测教训）：`_oc_accept` 是**一行真实实现**
    （`return [round(float(binom.cdf(c, n, p)), 10) for p in ps]`），`non_doc_lines
    >= 2` 的行数判据把它误判成空壳。"空壳"的语义是**没有实现**，不是"写得短"。
    """
    if not body:
        return True
    for stmt in body:
        if isinstance(stmt, ast.Pass):
            continue
        if isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Constant) and stmt.value.value is Ellipsis:
            continue
        if isinstance(stmt, ast.Raise):
            exc = stmt.exc
            named = isinstance(exc, ast.Name) and exc.id in {'NotImplementedError', 'NotImplemented'}
            called = isinstance(exc, ast.Call) and isinstance(exc.func, ast.Name) and exc.func.id == 'NotImplementedError'
            if named or called:
                continue
        return False
    return True


def _body_metrics(node, source_lines):
    """返回 (body_lines, non_doc_lines, is_stub)，口径见模块 docstring。"""
    body = list(node.body)
    if body and _is_docstring_statement(body[0]):
        body = body[1:]
    if not body:
        return 0, 0, True
    start = min(getattr(stmt, 'lineno', 0) for stmt in body)
    end = max(getattr(stmt, 'end_lineno', None) or getattr(stmt, 'lineno', 0) for stmt in body)
    if start <= 0 or end < start:
        return 0, 0, True
    body_lines = end - start + 1
    non_doc = 0
    for lineno in range(start, min(end, len(source_lines)) + 1):
        line = source_lines[lineno - 1].strip()
        if line and not line.startswith('#'):
            non_doc += 1
    return body_lines, non_doc, _is_stub_body(body)


def _qualname(prefix, name):
    """模块/类用 `.` 连接；函数内部的嵌套符号按 Python `__qualname__` 的 `<locals>` 形态。"""
    return f'{prefix}{name}' if prefix else name


def _collect(node, file_name, prefix, defs, classes, source_lines):
    """递归收集 `node` 下所有 def / class（含嵌套），并递归进入函数与类体。"""
    for child in ast.iter_child_nodes(node):
        if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
            qual = _qualname(prefix, child.name)
            body_lines, non_doc_lines, is_stub = _body_metrics(child, source_lines)
            defs.append({
                'name': child.name,
                'file': file_name,
                'qualname': qual,
                'body_lines': body_lines,
                'non_doc_lines': non_doc_lines,
                'stub': is_stub,
                'docstring': ast.get_docstring(child),
            })
            _collect(child, file_name, f'{qual}.<locals>.', defs, classes, source_lines)
        elif isinstance(child, ast.ClassDef):
            qual = _qualname(prefix, child.name)
            classes.append({'name': child.name, 'file': file_name})
            _collect(child, file_name, f'{qual}.', defs, classes, source_lines)
        else:
            _collect(child, file_name, prefix, defs, classes, source_lines)


def _symbols_of(file_name, source, defs, classes):
    """解析一个文件；失败时抛异常，由调用方记进 errors。"""
    if not isinstance(source, str):
        raise TypeError(f'source 必须是字符串，实际是 {type(source).__name__}')
    tree = ast.parse(source, filename=file_name)
    _collect(tree, file_name, '', defs, classes, source.splitlines())


def _write(payload):
    """只向 stdout 写 JSON（UTF-8 字节，绕开 Windows 控制台代码页）。"""
    sys.stdout.buffer.write((json.dumps(payload, ensure_ascii=False) + '\n').encode('utf-8'))
    sys.stdout.buffer.flush()


def main():
    try:
        payload = json.loads(sys.stdin.buffer.read().decode('utf-8'))
        files = payload.get('files') if isinstance(payload, dict) else None
        if not isinstance(files, dict):
            raise TypeError('输入缺少 {"files": {...}} 对象')
    except Exception as error:  # 输入坏掉也要输出 JSON，绝不抛 traceback
        _write({
            'ok': False,
            'defs': [],
            'classes': [],
            'errors': [{'file': '<input>', 'error': f'{type(error).__name__}: {error}'}],
        })
        return

    defs = []
    classes = []
    errors = []
    for file_name, source in files.items():
        try:
            _symbols_of(str(file_name), source, defs, classes)
        except Exception as error:  # 单文件失败不拖垮其它文件
            errors.append({'file': str(file_name), 'error': f'{type(error).__name__}: {error}'[:400]})
    _write({'ok': True, 'defs': defs, 'classes': classes, 'errors': errors})


if __name__ == '__main__':
    main()
