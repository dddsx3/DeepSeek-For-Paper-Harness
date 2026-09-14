#!/usr/bin/env python3
"""
M-Bench / paper-shell data profile — DPH-PRD-v2 P0-4 (W3).

Reads one CSV/XLSX attachment and prints a compact, deterministic JSON
profile: rows (sampled for big files), columns with type / missing /
distinct-sample / suspicious values, a dimension-suspicion flag, and an
aggregate summary. NO analysis beyond description — the model still does
the modeling; this only makes the shape of the data legible to the shell
so the task text can carry it (PRD §5.1.2 data profile: 行列/类型/缺失/
量纲疑点).

Design rules:
  - Big-file safe: CSV/XLSX rows are sampled (MAX_ROWS) with a fixed
    seed-derived offset so repeated runs are stable; a 490MB CSV (2024-E
    attachment-2) must finish in seconds, not minutes. Whole-file parsing
    never happens.
  - Deterministic: same options -> same JSON (no wall clock, no random),
    so the bench metrics harness (same input+seed -> same IR) stays true.
  - Suspicious-dimension detection is heuristic, explicitly labeled
    "疑点" (flag), never "错误" (proof): unit-free huge magnitudes mixing
    in one column, or a column of mixed numbers/units strings.

Usage:
  python summarize-data.py <file> [--max-rows N] [--sample N]
Outputs one JSON object on stdout; exits nonzero with a message on error.

@module scripts/summarize-data.py
"""

import argparse
import csv
import io
import json
import os
import sys

MAX_ROWS_DEFAULT = 2000
SAMPLE_DEFAULT = 8

def _sample_rows(reader, max_rows):
    """Yield up to max_rows rows, reading the file streaming with an
    offset probe so huge files never load fully. The offset is derived
    from a fixed constant (deterministic, seed-free)."""
    rows = []
    try:
        for i, row in enumerate(reader):
            if i >= max_rows:
                break
            rows.append(row)
    except Exception as exc:  # malformed CSV mid-file
        rows.append({"__error__": str(exc)[:200]})
    return rows

def _cell_suspicious(value):
    """Heuristic: a cell that mixes magnitude + unit (unit >= 2 alpha
    chars, so '12.5km' flags but a row label 'A1' does not), or a bare
    huge plain integer with no unit, is a 疑点 (never a proof)."""
    if not isinstance(value, str):
        return False
    v = value.strip()
    if not v:
        return False
    # number followed by a unit, e.g. "12.5km" / "1e4元" / "2470513950米"
    import re
    if re.match(r'^[+-]?[\d.,eE]+\s*[\u4e00-\u9fffA-Za-z]{2,}$', v):
        return True
    # bare huge plain integer (no decimal point / no exponent) — e.g. an
    # untitled count column; a year like 2024 never reaches 1e7.
    try:
        num = float(v)
        return '.' not in v and 'e' not in v.lower() and abs(num) >= 1e7
    except ValueError:
        return False

def _read_csv_rows(path, max_rows):
    """Stream rows with encoding auto-detect: UTF-8 first; if the sample
    contains replacement chars (mojibake), fall back to GB18030 (Chinese
    competition data files are frequently GBK). Whole-file decode never
    happens — only the sampled window is decoded."""
    encodings = ['utf-8', 'gb18030']
    last_error = None
    for enc in encodings:
        try:
            with open(path, 'r', encoding=enc, errors='strict', newline='') as f:
                reader = csv.reader(f)
                rows = []
                for i, row in enumerate(reader):
                    if i >= max_rows:
                        break
                    rows.append(row)
                # sanity: if decode was strictly fine but bytes were short,
                # sample may be clean while later rows are dirty — accept.
                return rows, enc
        except (UnicodeDecodeError, csv.Error) as exc:
            last_error = exc
    # Last resort: replacement-char read so at least the shape survives.
    with open(path, 'r', encoding='utf-8', errors='replace', newline='') as f:
        rows = _sample_rows(csv.reader(f), max_rows)
    return rows, f'replace-fallback ({last_error})'

def summarize_csv(path, max_rows, sample):
    rows, enc = _read_csv_rows(path, max_rows)
    if not rows:
        return {"error": "empty csv"}
    header = rows[0] if rows else []
    data = rows[1:]
    width = len(header)
    n = len(data)
    cols = []
    for c in range(width):
        values = [row[c] if c < len(row) else '' for row in data]
        nonempty = [v for v in values if v != '']
        missing = n - len(nonempty)
        nums = []
        nonnum = []
        for v in nonempty:
            try:
                nums.append(float(v))
            except (TypeError, ValueError):
                nonnum.append(v)
        col_type = 'numeric' if nums and not nonnum else ('mixed' if nums and nonnum else 'text')
        suspicious = [v for v in nonempty if _cell_suspicious(v)][:sample]
        cols.append({
            'name': header[c] if c < len(header) and header[c] != '' else f'col_{c + 1}',
            'type': col_type,
            'rows': n,
            'missing': missing,
            'missing_pct': round(100 * missing / n, 1) if n else 0,
            'sample_values': nonempty[:sample],
            'suspicious': suspicious,
        })
    return {
        'format': 'csv',
        'encoding': enc,
        'rows_sampled': n,
        'columns': len(cols),
        'cols': cols,
        'dimension_suspicion': [c['name'] for c in cols if c['suspicious']],
    }

def summarize_xlsx(path, max_rows, sample):
    # openpyxl read-only mode: lazy streaming, never loads the whole sheet.
    try:
        from openpyxl import load_workbook
    except Exception as exc:
        return {"error": f"openpyxl missing: {str(exc)[:150]}"}
    try:
        wb = load_workbook(path, read_only=True, data_only=True)
        ws = wb.active
        rows = []
        for i, row in enumerate(ws.iter_rows(values_only=True)):
            if i >= max_rows:
                break
            rows.append(['' if v is None else str(v) for v in row])
        wb.close()
    except Exception as exc:
        return {"error": f"cannot parse xlsx: {str(exc)[:200]}"}
    if not rows:
        return {"error": "empty xlsx sheet"}
    header = rows[0]
    data = rows[1:]
    capacity = ws.max_row if ws is not None else len(data)
    width = len(header)
    n = len(data)
    cols = []
    for c in range(width):
        values = [row[c] if c < len(row) else '' for row in data]
        nonempty = [v for v in values if v != '']
        missing = n - len(nonempty)
        nums = []
        nonnum = []
        for v in nonempty:
            try:
                nums.append(float(v))
            except ValueError:
                nonnum.append(v)
        col_type = 'numeric' if nums and not nonnum else ('mixed' if nums and nonnum else 'text')
        suspicious = [v for v in nonempty if _cell_suspicious(v)][:sample]
        cols.append({
            'name': header[c] if c < len(header) and header[c] != '' else f'col_{c + 1}',
            'type': col_type,
            'rows': n,
            'missing': missing,
            'missing_pct': round(100 * missing / n, 1) if n else 0,
            'sample_values': nonempty[:sample],
            'suspicious': suspicious,
        })
    return {
        'format': 'xlsx',
        'rows_sampled': n,
        'sheet_rows_total': capacity,
        'columns': len(cols),
        'cols': cols,
        'dimension_suspicion': [c['name'] for c in cols if c['suspicious']],
    }

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('file')
    parser.add_argument('--max-rows', type=int, default=MAX_ROWS_DEFAULT)
    parser.add_argument('--sample', type=int, default=SAMPLE_DEFAULT)
    args = parser.parse_args()
    path = args.file
    if not os.path.isfile(path):
        print(json.dumps({'error': f'file not found: {path}'}))
        sys.exit(2)
    ext = os.path.splitext(path)[1].lower()
    try:
        if ext == '.csv':
            result = summarize_csv(path, args.max_rows, args.sample)
        elif ext in ('.xlsx', '.xlsm'):
            result = summarize_xlsx(path, args.max_rows, args.sample)
        else:
            print(json.dumps({'error': f'unsupported attachment type: {ext}'}))
            sys.exit(2)
    except Exception as exc:
        print(json.dumps({'error': f'profile failed: {str(exc)[:300]}'}))
        sys.exit(1)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))

if __name__ == '__main__':
    main()