# -*- coding: utf-8 -*-
'''问题3：两道工序 8 零配件 3 半成品 1 成品装配网络的检测/拆解决策模型。

网络（ASM-005）：零配件1+2->半成品1，3+4->半成品2，5+6->半成品3；
半成品1/2/3 与零配件7、8 装配成成品。
决策：8 零配件检测 + 3 半成品检测 + 1 成品检测 = 12 个检测决策；
3 半成品拆解 + 1 成品拆解 = 4 个拆解决策；共 2^16 = 65536 策略全枚举（全局最优可证）。

节点递归（拓扑序）：
  叶 i：B_i = x_i*(c_i+d_i)/(1-p_i) + (1-x_i)*c_i；q_i = (1-x_i)*p_i。
  半成品 v：raw_v = 1-(1-q_a)*(1-q_b)*(1-pa)；V_rec_v = (c_a-x_a*d_a)+(c_b-x_b*d_b)。
    x_v=1：q_v=0；y_v=0: B_v=(B_a+B_b+ca+d)/(1-raw_v)；
           y_v=1: B_v=B_a+B_b+(ca+d)/(1-raw_v)+(raw_v/(1-raw_v))*(dd-V_rec_v)。
    x_v=0：q_v=raw_v；B_v=B_a+B_b+ca（无拦截点，y_v 不起作用）。
  成品节点接市场（每件最终售出、补发件不计收入）：
    pi = s - [ sum(B_u) + ca_f + x_f*d_f + (1-x_f)*raw_f*L
               + y_f*raw_f*(dd_f-R_rec) ] / (1-raw_f)
    R_rec = sum(B_semi) + (c7-x7*d7) + (c8-x8*d8)。
'''

LEAF_C = [2.0, 3.0, 3.0, 3.0, 2.0, 2.0, 5.0, 5.0]
LEAF_D = [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 2.0, 2.0]
LEAF_P = [0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.05, 0.05]
SEMI_CA, SEMI_PA, SEMI_D, SEMI_DD = 6.0, 0.10, 3.0, 2.0
SEMI_CHILDREN = [(0, 1), (2, 3), (4, 5)]
FIN_CA, FIN_PA, FIN_D, FIN_DD = 10.0, 0.10, 10.0, 10.0
S_PRICE, L_EXCH = 200.0, 40.0


def evaluate(xd, xs, xf, ys, yf):
    '''返回 (pi, raw_f, sum_B, R_rec)。'''
    B = [0.0] * 8
    q = [0.0] * 8
    for i in range(8):
        if xd[i]:
            B[i] = (LEAF_C[i] + LEAF_D[i]) / (1 - LEAF_P[i])
            q[i] = 0.0
        else:
            B[i] = LEAF_C[i]
            q[i] = LEAF_P[i]
    Bs = []
    qs = []
    for v in range(3):
        a, b = SEMI_CHILDREN[v]
        raw = 1.0 - (1 - q[a]) * (1 - q[b]) * (1 - SEMI_PA)
        vrec = (LEAF_C[a] - xd[a] * LEAF_D[a]) + (LEAF_C[b] - xd[b] * LEAF_D[b])
        if xs[v]:
            qs.append(0.0)
            if ys[v]:
                Bs.append(B[a] + B[b] + (SEMI_CA + SEMI_D) / (1 - raw)
                          + raw / (1 - raw) * (SEMI_DD - vrec))
            else:
                Bs.append((B[a] + B[b] + SEMI_CA + SEMI_D) / (1 - raw))
        else:
            Bs.append(B[a] + B[b] + SEMI_CA)
            qs.append(raw)
    prod = (1 - qs[0]) * (1 - qs[1]) * (1 - qs[2]) * (1 - q[6]) * (1 - q[7])
    rawf = 1.0 - prod * (1 - FIN_PA)
    sum_b = Bs[0] + Bs[1] + Bs[2] + B[6] + B[7]
    rrec = Bs[0] + Bs[1] + Bs[2] \
        + (LEAF_C[6] - xd[6] * LEAF_D[6]) + (LEAF_C[7] - xd[7] * LEAF_D[7])
    num = (sum_b + FIN_CA + xf * FIN_D + (1 - xf) * rawf * L_EXCH
           + yf * rawf * (FIN_DD - rrec))
    pi = S_PRICE - num / (1 - rawf)
    return pi, rawf, sum_b, rrec


def bits(mask, n):
    return [(mask >> i) & 1 for i in range(n)]


def solve():
    best_pi, best_mask = -1e18, 0
    for mask in range(1 << 16):
        pi, _rf, _sb, _rr = evaluate(bits(mask, 8), bits(mask >> 8, 3),
                                     (mask >> 11) & 1, bits(mask >> 12, 3),
                                     (mask >> 15) & 1)
        if pi > best_pi:
            best_pi, best_mask = pi, mask
    xd = bits(best_mask, 8)
    xs = bits(best_mask >> 8, 3)
    xf = (best_mask >> 11) & 1
    ys = bits(best_mask >> 12, 3)
    yf = (best_mask >> 15) & 1
    pi, rawf, sum_b, rrec = evaluate(xd, xs, xf, ys, yf)
    res = {'pi_opt': pi, 'rawf': rawf, 'cost': S_PRICE - pi, 'mask': best_mask}
    # 检测决策边际（翻转该位的利润变化，最优处应全为负）
    for i in range(8):
        xd2 = list(xd)
        xd2[i] = 1 - xd2[i]
        pi2, _r, _s, _t = evaluate(xd2, xs, xf, ys, yf)
        res['dm_x%d' % (i + 1)] = pi2 - pi
    for v in range(3):
        xs2 = list(xs)
        xs2[v] = 1 - xs2[v]
        pi2, _r, _s, _t = evaluate(xd, xs2, xf, ys, yf)
        res['dm_xs%d' % (v + 1)] = pi2 - pi
    pi2, _r, _s, _t = evaluate(xd, xs, 1 - xf, ys, yf)
    res['dm_xf'] = pi2 - pi
    # 拆解决策边际
    for v in range(3):
        ys2 = list(ys)
        ys2[v] = 1 - ys2[v]
        pi2, _r, _s, _t = evaluate(xd, xs, xf, ys2, yf)
        res['dm_ys%d' % (v + 1)] = pi2 - pi
    pi2, _r, _s, _t = evaluate(xd, xs, xf, ys, 1 - yf)
    res['dm_yf'] = pi2 - pi
    # 成本分解（每件售出）
    res['dec_parts'] = sum_b / (1 - rawf)
    res['dec_asm'] = FIN_CA / (1 - rawf)
    res['dec_exch'] = (1 - xf) * rawf * L_EXCH / (1 - rawf)
    res['dec_dis'] = yf * rawf * (FIN_DD - rrec) / (1 - rawf)
    # 售价灵敏度（成本与售价无关，利润随售价平移）
    for m, tag in ((0.8, 's080'), (0.9, 's090'), (1.0, 's100'),
                   (1.1, 's110'), (1.2, 's120')):
        res['sens_s%s' % tag] = m * S_PRICE - (S_PRICE - pi)
    return res


if __name__ == '__main__':
    r = solve()
    for key in sorted(r):
        print(key, r[key])
