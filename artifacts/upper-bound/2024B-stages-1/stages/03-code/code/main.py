# -*- coding: utf-8 -*-
'''编排入口：依次求解问题1-4，汇总写出 results/results.json 并打印摘要。

运行：python code/main.py
所有数值由本管线真跑产出；图表仅声明（见 FIGURE_DECLARATIONS.json），渲染在阶段4。
'''
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import problem1
import problem2
import problem3
import problem4


def main():
    results = {}
    r1 = problem1.solve()
    results.update(r1)
    r2, tabs2 = problem2.solve()
    results.update(r2)
    results.update(problem2.checks(tabs2))
    r3 = problem3.solve()
    results.update(r3)
    r4 = problem4.solve()
    results.update(r4)

    out_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'results')
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, 'results.json')
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(results, fh, ensure_ascii=False, indent=1, sort_keys=True)

    print('已写出 %s（共 %d 条结果）' % (path, len(results)))
    print('问题1 纯约束：拒收 (n,k)=(%d,%d)，接收 (n,k)=(%d,%d)' % (
        r1['n_rej_pure'], r1['k_rej_pure'], r1['n_acc_pure'], r1['k_acc_pure']))
    print('问题1 增强口径：拒收 (n,k)=(%d,%d)，接收 (n,k)=(%d,%d)' % (
        r1['n_rej_enh'], r1['k_rej_enh'], r1['n_acc_enh'], r1['k_acc_enh']))
    print('问题2 最优利润：' + ', '.join(
        '%s=%.4f' % (k, r2['best_%s' % k])
        for k in ('s1', 's2', 's3', 's4', 's5', 's6')))
    print('问题3 最优利润 = %.4f（成品全口径次品率 %.4f）' % (r3['pi_opt'], r3['rawf']))
    print('问题4 CP区间 = [%.4f, %.4f]，带分离最小样本量 = %.0f' % (
        r4['p_lower'], r4['p_upper'], r4['nstar']))
    print('校验：流量平衡差额 = %.1e，单调性通过 = %s' % (
        results['flow_residual'], bool(results['monotone_ok'])))


if __name__ == '__main__':
    main()
