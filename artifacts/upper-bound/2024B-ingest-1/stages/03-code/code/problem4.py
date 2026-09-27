"""问题 4：次品率带抽样误差时重做问题 2 与问题 3 + 稳健性校核。

方法（MS-Q4）：
  1) 点估计 p_hat 与 Clopper-Pearson 精确置信区间（Beta 分位数）；
  2) 决策固定下的利润区间传播（不要让“换方案”混进区间）；
  3) 蒙特卡洛重抽样：每次重抽样重解最优决策，统计一致率 ρ。
  覆盖范围：**问题 2 与问题 3 都要做**（题面明确要求“重新完成问题2和问题3”）。
"""

import numpy as np
from scipy.stats import beta as beta_dist

import params as P
import problem1
import problem2
import problem3


# ------------------------------------------------------------------
def clopper_pearson(x, n, level):
    """精确二项置信区间；中心为样本频率 p_hat = x/n，区间由 Beta 分位数给出。"""
    if n <= 0:
        return 0.0, 1.0
    alpha = 1.0 - level
    lo = 0.0 if x == 0 else float(beta_dist.ppf(alpha / 2.0, x, n - x + 1))
    hi = 1.0 if x == n else float(beta_dist.ppf(1.0 - alpha / 2.0, x + 1, n - x))
    if lo > hi:
        lo, hi = hi, lo
    return lo, hi


# ------------------------------------------------------------------
def _q2_ci(case, n_samp, level):
    out = {}
    for key in ('p1', 'p2', 'p0'):
        x = int(round(case[key] * n_samp))
        x = max(0, min(n_samp, x))
        out[key] = clopper_pearson(x, n_samp, level)
    return out


def run_q2(n_samp, rng):
    M = P.Q4_RESAMPLE
    rows = []
    for case in P.CASE_PARAMS:
        ci = _q2_ci(case, n_samp, P.Q4_CI_LEVEL)

        strats = problem2.enumerate_strategies(case)
        best = max(strats, key=lambda r: r['profit'])
        dec0 = (best['Z1'], best['Z2'], best['C'], best['D'])

        # 决策固定下的利润区间：p 取区间端点
        profits = []
        combos = [(ci['p1'][0], ci['p2'][0], ci['p0'][0]),
                  (ci['p1'][1], ci['p2'][1], ci['p0'][1]),
                  (ci['p1'][0], ci['p2'][0], ci['p0'][1]),
                  (ci['p1'][1], ci['p2'][1], ci['p0'][0]),
                  (ci['p1'][0], ci['p2'][1], ci['p0'][1]),
                  (ci['p1'][1], ci['p2'][0], ci['p0'][0])]
        for (a, b, c) in combos:
            cvar = dict(case, p1=a, p2=b, p0=c)
            r = problem2.evaluate(cvar, *dec0)
            if r is not None:
                profits.append(r['profit'])

        # 蒙特卡洛重抽样：每次重新求最优决策
        consistent = 0
        flips = []
        for _ in range(M):
            p1s = rng.binomial(n_samp, case['p1']) / float(n_samp)
            p2s = rng.binomial(n_samp, case['p2']) / float(n_samp)
            p0s = rng.binomial(n_samp, case['p0']) / float(n_samp)
            cs = dict(case, p1=p1s, p2=p2s, p0=p0s)
            bs = max(problem2.enumerate_strategies(cs), key=lambda r: r['profit'])
            d = (bs['Z1'], bs['Z2'], bs['C'], bs['D'])
            if d == dec0:
                consistent += 1
            else:
                flips.append(list(d))
        rho = consistent / float(M)
        rows.append({
            'case_id': case['id'],
            'point_decision': {'Z1': dec0[0], 'Z2': dec0[1], 'C': dec0[2], 'D': dec0[3]},
            'point_profit': best['profit'],
            'ci': {k: [v[0], v[1]] for k, v in ci.items()},
            'profit_range_fixed_decision': [min(profits), max(profits)] if profits else [None, None],
            'consistency_rate': rho,
            'flip_rate': 1.0 - rho,
            'flip_examples': flips[:8],
            'decision_stable': bool(rho >= P.DECISION_CONSISTENCY_THRESH),
        })
    return rows


def run_q3(n_samp, rng):
    M = P.Q4_RESAMPLE
    data0 = problem3.build_node_data()
    tree = problem3.topology_from_blocks(P.Q3_TOPOLOGY_VARIANTS[0]['blocks'])

    base = problem3.solve_tree(tree, data0)
    if base is None:
        return {'feasible': False}
    base_dec = dict(base['dec'])
    U0 = base['U']

    # 各节点 p 的 Clopper-Pearson 区间
    ci = {}
    for node, d in data0.items():
        p_hat = d['p']
        x = int(round(p_hat * n_samp))
        x = max(0, min(n_samp, x))
        ci[node] = clopper_pearson(x, n_samp, P.Q4_CI_LEVEL)

    # 决策固定下的利润区间：分别把所有 p 置为该节点区间下/上端点
    profits = []
    for direction in ('lo', 'hi'):
        data_v = {k: dict(v) for k, v in data0.items()}
        for node, (lo, hi) in ci.items():
            data_v[node]['p'] = lo if direction == 'lo' else hi
        st = problem3.decision_evaluate(tree, data_v, P.Q3_ROOT, base_dec)
        if st is not None:
            profits.append(P.Q3_PRICE['s'] - st['U'])

    # 蒙特卡洛重抽样：每个节点的次品率独立重抽，重解整棵树
    consistent = 0
    flip_examples = []
    for _ in range(M):
        data_s = {k: dict(v) for k, v in data0.items()}
        for node, d in data0.items():
            ps = rng.binomial(n_samp, d['p']) / float(n_samp)
            data_s[node]['p'] = ps
        st = problem3.solve_tree(tree, data_s)
        if st is None:
            continue
        if st['dec'] == base_dec:
            consistent += 1
        else:
            if len(flip_examples) < 8:
                flip_examples.append({k: [v[0], v[1]] for k, v in st['dec'].items()})
    rho = consistent / float(M)

    return {
        'feasible': True,
        'point_decision': {k: {'Z': v[0], 'D': v[1]} for k, v in base_dec.items()},
        'point_profit': P.Q3_PRICE['s'] - U0,
        'ci': {k: [v[0], v[1]] for k, v in ci.items()},
        'profit_range_fixed_decision': [min(profits), max(profits)] if profits else [None, None],
        'consistency_rate': rho,
        'flip_rate': 1.0 - rho,
        'flip_examples': flip_examples,
        'decision_stable': bool(rho >= P.DECISION_CONSISTENCY_THRESH),
    }


def run(p1_out=None, p2_out=None, p3_out=None):
    if p1_out is None:
        p1_out = problem1.run()
    n_samp = int(p1_out['case95']['n']) if p1_out['case95']['n'] else P.Q1_NMAX

    rng = np.random.default_rng(P.RANDOM_SEED)
    q2_rows = run_q2(n_samp, rng)
    q3_row = run_q3(n_samp, rng)

    # 决策差异表：问题4 决策 vs 点估计决策
    diff_rows = []
    for r in q2_rows:
        diff_rows.append({
            'scope': 'Q2-case%d' % r['case_id'],
            'point_decision': r['point_decision'],
            'consistency_rate': r['consistency_rate'],
            'flip': bool(r['consistency_rate'] < 1.0),
        })
    if q3_row.get('feasible'):
        diff_rows.append({
            'scope': 'Q3-instance',
            'point_decision': q3_row['point_decision'],
            'consistency_rate': q3_row['consistency_rate'],
            'flip': bool(q3_row['consistency_rate'] < 1.0),
        })

    return {
        'sample_size_used': n_samp,
        'ci_level': P.Q4_CI_LEVEL,
        'resample_count': P.Q4_RESAMPLE,
        'seed': P.RANDOM_SEED,
        'q2': q2_rows,
        'q3': q3_row,
        'decision_diff': diff_rows,
    }


if __name__ == '__main__':
    import json
    print(json.dumps(run(), ensure_ascii=False, indent=2))
