# -*- coding: utf-8 -*-
'''问题2：2 零配件 + 单工序检测/拆解期望利润决策模型（16 策略精确枚举）。

决策 x=(x1,x2,x3,x4)：零配件1/2检测、成品检测、不合格成品拆解；
用户退回品按同一拆解规则处理（不新增变量）。
质量传播（条件口径 HC-12/S21）：q_i=(1-x_i)*p_i；p_f=1-(1-q_1)(1-q_2)*(1-p_a)。
稳态期望利润（元/件，每件最终售出、补发件不计收入）：
    pi = s - [ (A1+A2) + ca + x3*d3 + (1-x3)*p_f*L + x4*p_f*(dd-V_rec) ] / (1-p_f)
    A_i = x_i*(c_i+d_i)/(1-p_i) + (1-x_i)*c_i；V_rec = c1+c2-x1*d1-x2*d2（ASM-003）。
该口径下 pi 对 p_f 严格单调减（d pi/d p_f = -(C0+M')/(1-p_f)^2 < 0，checks 中数值校验），
供问题4区间端点传播；建模报告 5.2 角点式的补发计收入口径偏乐观且破坏单调性，未采用。
'''

SITUATIONS = [
    dict(key='s1', p=[0.10, 0.10], pa=0.10, L=6.0, dd=5.0),
    dict(key='s2', p=[0.10, 0.10], pa=0.10, L=30.0, dd=5.0),
    dict(key='s3', p=[0.20, 0.20], pa=0.20, L=6.0, dd=5.0),
    dict(key='s4', p=[0.20, 0.20], pa=0.20, L=30.0, dd=5.0),
    dict(key='s5', p=[0.10, 0.10], pa=0.10, L=6.0, dd=40.0),
    dict(key='s6', p=[0.10, 0.10], pa=0.10, L=30.0, dd=40.0),
]
C = [4.0, 18.0]
D = [2.0, 3.0]
CA = 6.0
D3 = 3.0
S = 56.0
STRATEGIES = [(x1, x2, x3, x4) for x1 in (0, 1) for x2 in (0, 1)
              for x3 in (0, 1) for x4 in (0, 1)]


def pf_of(x, p, pa):
    q1 = (1 - x[0]) * p[0]
    q2 = (1 - x[1]) * p[1]
    return 1.0 - (1 - q1) * (1 - q2) * (1 - pa)


def profit(x, p, pa, L, dd):
    x1, x2, x3, x4 = x
    A1 = x1 * (C[0] + D[0]) / (1 - p[0]) + (1 - x1) * C[0]
    A2 = x2 * (C[1] + D[1]) / (1 - p[1]) + (1 - x2) * C[1]
    pf = pf_of(x, p, pa)
    Vrec = C[0] + C[1] - x1 * D[0] - x2 * D[1]
    num = (A1 + A2) + CA + x3 * D3 + (1 - x3) * pf * L + x4 * pf * (dd - Vrec)
    return S - num / (1 - pf)


def enumerate_all(p, pa, L, dd):
    return {x: profit(x, p, pa, L, dd) for x in STRATEGIES}


def monotone_ok(p, pa, L, dd, step=0.005):
    '''数值校验：每个策略的 pi 对 p_f 单调减。'''
    for x in STRATEGIES:
        base = profit(x, p, pa, L, dd)
        hi = profit(x, [p[0] + step, p[1] + step], pa + step, L, dd)
        lo = profit(x, [max(p[0] - step, 1e-9), max(p[1] - step, 1e-9)],
                    max(pa - step, 1e-9), L, dd)
        if hi > base + 1e-9 or base > lo + 1e-9:
            return False
    return True


def solve():
    res = {}
    tabs = {}
    for sit in SITUATIONS:
        tab = enumerate_all(sit['p'], sit['pa'], sit['L'], sit['dd'])
        tabs[sit['key']] = tab
        for x, v in tab.items():
            res['pi_%s_x%s' % (sit['key'], ''.join(str(b) for b in x))] = v
        bx = max(tab, key=lambda k: tab[k])
        res['best_%s' % sit['key']] = tab[bx]
        res['mktdef_%s' % sit['key']] = (1 - bx[2]) * pf_of(bx, sit['p'], sit['pa'])
        res['reuse_%s' % sit['key']] = bx[3] * pf_of(bx, sit['p'], sit['pa'])
        res['cost_%s' % sit['key']] = S - tab[bx]
    res['monotone_ok'] = 1.0 if all(
        monotone_ok(s['p'], s['pa'], s['L'], s['dd']) for s in SITUATIONS) else 0.0
    # 灵敏度一：调换损失倍数扫描（情形一参数，16 策略重优化）
    base = SITUATIONS[0]
    for m, tag in ((0.0, 'm000'), (0.5, 'm050'), (1.0, 'm100'),
                   (1.5, 'm150'), (2.0, 'm200')):
        res['sens_L_%s' % tag] = max(
            enumerate_all(base['p'], base['pa'], base['L'] * m, base['dd']).values())
    # 策略切换临界 L*：(0,0,0,1) 与 (0,0,1,1) 利润相等处
    pf = pf_of((0, 0, 0, 1), base['p'], base['pa'])
    v_fix = profit((0, 0, 1, 1), base['p'], base['pa'], base['L'], base['dd'])
    res['switch_L'] = ((1 - pf) * (S - v_fix) - (C[0] + C[1] + CA)) / pf \
        + (C[0] + C[1]) - base['dd']
    # 灵敏度二：三个次品率各正负 20% 扰动（情形一，重优化）
    res['sens_base'] = max(
        enumerate_all(base['p'], base['pa'], base['L'], base['dd']).values())
    for i, tag in ((0, 'p1'), (1, 'p2')):
        for d, dt in ((-0.02, 'lo'), (0.02, 'hi')):
            p2 = list(base['p'])
            p2[i] = base['p'][i] + d
            res['sens_%s_%s' % (tag, dt)] = max(
                enumerate_all(p2, base['pa'], base['L'], base['dd']).values())
    for d, dt in ((-0.02, 'lo'), (0.02, 'hi')):
        res['sens_pa_%s' % dt] = max(
            enumerate_all(base['p'], base['pa'] + d, base['L'], base['dd']).values())
    # 灵敏度三：拆解回用轮数截断（情形一最优策略 (0,0,0,1)，几何级数）
    x = (0, 0, 0, 1)
    pf = pf_of(x, base['p'], base['pa'])
    Vrec = C[0] + C[1]
    per_round = (C[0] + C[1]) + CA + pf * (base['L'] + base['dd'] - Vrec)
    for K, tag in ((1, 'k1'), (2, 'k2'), (3, 'k3'), (4, 'k4'), (5, 'k5'), (10, 'k10')):
        res['reuse_K%s' % tag] = S - per_round * (1 - pf ** K) / (1 - pf)
    res['rho'] = pf
    # 成本分解（情形一最优策略，每件售出）
    res['dec_parts'] = (C[0] + C[1]) / (1 - pf)
    res['dec_asm'] = CA / (1 - pf)
    res['dec_exch'] = pf * base['L'] / (1 - pf)
    res['dec_dis'] = pf * (base['dd'] - Vrec) / (1 - pf)
    return res, tabs


def checks(tabs):
    '''流量守恒与蒙特卡洛标准误（情形一最优策略 (0,0,0,1) 的补发链）。'''
    res = {}
    sit = SITUATIONS[0]
    x = (0, 0, 0, 1)
    pf = pf_of(x, sit['p'], sit['pa'])
    res['flow_buy'] = 1.0 - pf
    res['flow_reuse'] = pf
    res['flow_out'] = 1.0
    res['flow_residual'] = abs((1.0 - pf) + pf - 1.0)
    # 每条补发链利润 = s-(A1+A2) - N*ca - (N-1)*(L+dd)，N ~ 几何(1-pf)
    slope = CA + sit['L'] + sit['dd']
    res['mc_mean'] = S - (C[0] + C[1]) - CA / (1 - pf) \
        - (sit['L'] + sit['dd']) * pf / (1 - pf)
    var = slope ** 2 * (1 - pf) / (1 - pf) ** 2
    res['mc_sigma'] = var ** 0.5
    for n_sim, tag in ((1000, '1e3'), (10000, '1e4'),
                       (100000, '1e5'), (1000000, '1e6')):
        res['mc_se_%s' % tag] = res['mc_sigma'] / n_sim ** 0.5
    return res


if __name__ == '__main__':
    r, t = solve()
    for key in sorted(r):
        print(key, r[key])
