"""问题 2：四元 0-1 决策 (Z1, Z2, C, D) 下的期望利润最大化（全枚举）。

模型（MS-Q2）：
  Q_i = 1 - (1-Z_i) p_i                (i=1,2)
  q   = (1-p_0) Q_1 Q_2
  K_f = A + Σ [ Z_i (a_i+c_i)/(1-p_i) + (1-Z_i) a_i ]
  K_r = A + Σ Z_i c_i                  （免采购只记于此，ASM-12）
  κ   = K_f - K_r
  g   = q / (1 - D(1-q))
  R   = [ K_r + C c_0 + (1-q)( D t + (1-C) l ) ] / (1 - D(1-q))
  U   = [ K_f + C c_0 + (1-q)( D t + (1-C) l + D R ) ] / g
  Π   = s - U
"""

import itertools
import params as P


# ------------------------------------------------------------------
# 解析闭式
# ------------------------------------------------------------------
def evaluate(p, Z1, Z2, C, D):
    """给定参数与四元决策，返回 U / Π 及各中间量。"""
    p1, p2, p0 = p['p1'], p['p2'], p['p0']
    a1, a2 = p['a1'], p['a2']
    c1, c2, c0 = p['c1'], p['c2'], p['c0']
    A, t, l, s = p['A'], p['t'], p['l'], p['s']

    Q1 = 1.0 - (1 - Z1) * p1
    Q2 = 1.0 - (1 - Z2) * p2
    q = (1.0 - p0) * Q1 * Q2

    K_f = (A
           + Z1 * (a1 + c1) / (1.0 - p1) + (1 - Z1) * a1
           + Z2 * (a2 + c2) / (1.0 - p2) + (1 - Z2) * a2)
    K_r = A + Z1 * c1 + Z2 * c2
    kappa = K_f - K_r

    denom = 1.0 - D * (1.0 - q)
    if denom <= P.TOL:
        return None
    g = q / denom
    R = (K_r + C * c0 + (1.0 - q) * (D * t + (1 - C) * l)) / denom
    U = (K_f + C * c0 + (1.0 - q) * (D * t + (1 - C) * l + D * R)) / g
    return {'q': q, 'K_f': K_f, 'K_r': K_r, 'kappa': kappa,
            'g': g, 'R': R, 'U': U, 'profit': s - U}


# ------------------------------------------------------------------
# 逐轮现金流复算（傻瓜版；用于与解析式对账）
# ------------------------------------------------------------------
def cost_breakdown_walk(p, Z1, Z2, C, D, n_rounds=2000):
    """逐轮展开的期望成本分解（每件交付合格成品口径）。

    分解项互不重叠：
      purchase        = 采购（检测件的 1/(1-p_i) 倍数 / 非检测件 1 倍）
      inspect         = 零配件检测（检测件按 1/(1-p_i) 倍数；回收轮按 Z_i c_i）
      assembly        = 装配
      product_inspect = 成品检测
      disassemble     = 拆解
      exchange        = 调换损失
    六项之和应等于解析闭式的 U。
    """
    p1, p2, p0 = p['p1'], p['p2'], p['p0']
    a1, a2 = p['a1'], p['a2']
    c1, c2, c0 = p['c1'], p['c2'], p['c0']
    A, t, l = p['A'], p['t'], p['l']

    Q1 = 1.0 - (1 - Z1) * p1
    Q2 = 1.0 - (1 - Z2) * p2
    q = (1.0 - p0) * Q1 * Q2

    parts = {'purchase': 0.0, 'inspect': 0.0, 'assembly': 0.0,
             'product_inspect': 0.0, 'disassemble': 0.0, 'exchange': 0.0}

    arrive = 1.0
    total_deliver = 0.0
    round_idx = 0
    while arrive > 1e-15 and round_idx < n_rounds:
        if round_idx == 0:
            buy = (Z1 * a1 / (1.0 - p1) + (1 - Z1) * a1
                   + Z2 * a2 / (1.0 - p2) + (1 - Z2) * a2)
            insp = Z1 * c1 / (1.0 - p1) + Z2 * c2 / (1.0 - p2)
        else:
            buy = 0.0
            insp = Z1 * c1 + Z2 * c2
        parts['purchase'] += arrive * buy
        parts['inspect'] += arrive * insp
        parts['assembly'] += arrive * A
        parts['product_inspect'] += arrive * C * c0
        defect = arrive * (1.0 - q)
        parts['disassemble'] += defect * D * t
        parts['exchange'] += defect * (1 - C) * l
        total_deliver += arrive * q
        arrive *= (1.0 - q) * D
        round_idx += 1

    if total_deliver <= P.TOL:
        return None
    for k in parts:
        parts[k] /= total_deliver
    return parts


# ------------------------------------------------------------------
def enumerate_strategies(p):
    """16 种 (Z1, Z2, C, D) 组合逐一求 U 与 Π。"""
    out = []
    for Z1, Z2, C, D in itertools.product((0, 1), repeat=4):
        r = evaluate(p, Z1, Z2, C, D)
        if r is None:
            continue
        row = {'Z1': Z1, 'Z2': Z2, 'C': C, 'D': D}
        row.update(r)
        out.append(row)
    return out


def run():
    cases = []
    identity_max_diff = 0.0
    for case in P.CASE_PARAMS:
        strats = enumerate_strategies(case)
        if not strats:
            raise RuntimeError('情况 %s 无可行策略' % case['id'])
        best = max(strats, key=lambda r: r['profit'])

        # 恒等式守卫：对每一可行组合都核验 分项和 == U
        bd = cost_breakdown_walk(case, best['Z1'], best['Z2'], best['C'], best['D'])
        local_max = 0.0
        for s in strats:
            parts = cost_breakdown_walk(case, s['Z1'], s['Z2'], s['C'], s['D'])
            if parts is None:
                continue
            diff = abs(sum(parts.values()) - s['U'])
            local_max = max(local_max, diff)
        identity_max_diff = max(identity_max_diff, local_max)

        best_out = {
            'Z1': best['Z1'], 'Z2': best['Z2'], 'C': best['C'], 'D': best['D'],
            'U': best['U'], 'profit': best['profit'],
            'q': best['q'], 'K_f': best['K_f'], 'K_r': best['K_r'],
            'kappa': best['kappa'], 'g': best['g'], 'R': best['R'],
            'cost_breakdown': bd,
        }
        cases.append({
            'id': case['id'],
            'params': case,
            'best': best_out,
            'strategies': strats,
        })

    if identity_max_diff > 1e-4:
        raise RuntimeError('问题2 分项恒等式守卫触发：max_diff=%.3e' % identity_max_diff)

    # 全局最优组合（六种情况横向比较）
    global_best = max(cases, key=lambda c: c['best']['profit'])
    return {
        'cases': cases,
        'identity_max_diff': identity_max_diff,
        'global_best_case_id': global_best['id'],
        'strategy_count': P.Q2_STRATEGY_COUNT,
    }


if __name__ == '__main__':
    import json
    print(json.dumps(run(), ensure_ascii=False, indent=2))
