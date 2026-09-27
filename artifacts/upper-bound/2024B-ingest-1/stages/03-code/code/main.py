"""阶段 03 编排入口：依次跑问题 1/2/3/4，把每个要用的量写成 JSON 文件。

运行：在 code/ 目录下执行 `python main.py`。
产物：problem1.json / problem2.json / problem3.json / problem4.json /
      outputs.json（汇总）/ run_log.json
"""

import json
import os
import time
import traceback

import params as P
import problem1
import problem2
import problem3
import problem4

WORK_DIR = os.path.dirname(os.path.abspath(__file__))


def _save(name, obj):
    path = os.path.join(WORK_DIR, name)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    return path


def _to_jsonable(o):
    if isinstance(o, dict):
        return {str(k): _to_jsonable(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_to_jsonable(v) for v in o]
    if hasattr(o, 'item'):
        try:
            return o.item()
        except Exception:
            pass
    return o


def main():
    t0 = time.time()
    log = {'stage': '03-code', 'steps': []}

    def step(name, fn):
        s = time.time()
        try:
            res = fn()
            log['steps'].append({'name': name, 'ok': True,
                                 'elapsed_sec': round(time.time() - s, 3)})
            return res
        except Exception as exc:
            log['steps'].append({'name': name, 'ok': False,
                                 'error': repr(exc),
                                 'trace': traceback.format_exc(),
                                 'elapsed_sec': round(time.time() - s, 3)})
            raise

    p1 = step('problem1', problem1.run)
    _save('problem1.json', _to_jsonable(p1))

    p2 = step('problem2', problem2.run)
    _save('problem2.json', _to_jsonable(p2))

    p3 = step('problem3', problem3.run)
    _save('problem3.json', _to_jsonable(p3))

    p4 = step('problem4', lambda: problem4.run(p1, p2, p3))
    _save('problem4.json', _to_jsonable(p4))

    outputs = {
        'meta': {
            'stage': '03-code',
            'ok_all': True,
            'elapsed_sec': round(time.time() - t0, 3),
            'seed': P.RANDOM_SEED,
            'files': ['problem1.json', 'problem2.json',
                      'problem3.json', 'problem4.json'],
            'sampling_unit_cost_note': P.SAMPLING_UNIT_COST_NOTE,
        },
        'problem1': _to_jsonable(p1),
        'problem2': _to_jsonable(p2),
        'problem3': _to_jsonable(p3),
        'problem4': _to_jsonable(p4),
    }
    _save('outputs.json', outputs)

    log['ok_all'] = True
    log['elapsed_sec'] = round(time.time() - t0, 3)
    _save('run_log.json', log)

    print(json.dumps({'ok_all': True, 'elapsed_sec': log['elapsed_sec'],
                      'files': outputs['meta']['files']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
