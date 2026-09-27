"""问题 3：m 工序 n 零配件的节点级一般化决策模型（装配树 DP）。

方向（本轮统一表述）：
  成本 U_u 与合格率 Q_u 自底向上聚合（叶 -> 根）；
  交付需求量自顶向下折算（本模型以每件交付成品为单位化，故折算系数为 1）。

关键公式（DECLARATION EQ-Q3-*）：
  q_v = (1-p_v) Π_{u∈ch(v)} Q_u           （叶节点 q_v = 1-p_v）
  Q_v = Z_v + (1-Z_v) q_v
  叶:  U_v = Z_v (a_v+c_v)/(1-p_v) + (1-Z_v) a_v
  内:  K_f(v) = A_v + Z_v c_v + Σ U_u ;  K_r(v) = K_f(v) - κ_v
       κ_v = Σ_{u∈ch(v)} ( U_u - Z_u c_u )
       h_v = Z_v ∨ 1{v 为成品节点}
       ξ_v = h_v D_v t_v + (1-Z_v) l_v
       g_v = q_v / (1 - h_v D_v (1-q_v))
       R_v = [ K_r(v) + (1-q_v) ξ_v ] / (1 - h_v D_v (1-q_v))
       U_v = [ K_f(v) + (1-q_v)( ξ_v + h_v D_v R_v ) ] / g_v   (Z_v=1)
       U_v = K_f(v)                                           (Z_v=0)
  根:  Π = s - U_f

求解策略：装配树最优子结构 + 自底向上 Pareto 前沿压缩。
"""

import itertools
import params as P


# ------------------------------------------------------------------
def build_node_data():
    data = {}
    for k, v in P.Q3_PARTS.items():
        data[k] = {'kind': 'part', 'p': v['p'], 'a': v['a'], 'c': v['c']}
    for k, v in P.Q3_SEMIS.items():
        data[k] = {'kind': 'semi', 'p': v['p'], 'A': v['A'], 'c': v['c'], 't': v['t']}
    data['F'] = {'kind': 'product', 'p': P.Q3_PRODUCT['p'], 'A': P.Q3_PRODUCT['A'],
                 'c': P.Q3_PRODUCT['c'], 't': P.Q3_PRODUCT['t'],
                 'l': P.Q3_PRICE['l'], 's': P.Q3_PRICE['s']}
    return data


def topology_from_blocks(blocks):
    """由零配件分组构造装配树邻接表 (ch(v))。"""
    tree = {P.Q3_ROOT: ['S1', 'S2', 'S3']}
    tree['S1'] = list(blocks[0])
    tree['S2'] = list(blocks[1])
    tree['S3'] = list(blocks[2])
    return tree


# ------------------------------------------------------------------
def eval_node(v, child_states, Z_v, D_v, data, is_product):
    """节点 v 的等效获取成本 U、交付合格率 Q 与分项成本。"""
    p_v = data[v]['p']

    if not child_states:
        a_v = data[v]['a']
        c_v = data[v]['c']
        if Z_v == 1:
            U = (a_v + c_v) / (1.0 - p_v)
            Q = 1.0
        else:
            U = a_v
            Q = 1.0 - p_v
        return {'id': v, 'U': U, 'Q': Q, 'Z': Z_v, 'D': 0,
                'K_f': U, 'K_r': U, 'kappa': 0.0,
                'q': 1.0 - p_v, 'g': 1.0, 'R': 0.0, 'xi': 0.0}

    Q_prod = 1.0
    for cs in child_states:
        Q_prod *= cs['Q']
    q_v = (1.0 - p_v) * Q_prod

    A_v = data[v].get('A', 0.0)
    c_v = data[v].get('c', 0.0)
    t_v = data[v].get('t', 0.0)
    l_v = data[v].get('l', 0.0)

    K_f_v = A_v + Z_v * c_v + sum(cs['U'] for cs in child_states)
    kappa_v = 0.0
    for cs in child_states:
        cu = data[cs['id']].get('c', 0.0)
        kappa_v += cs['U'] - cs['Z'] * cu
    K_r_v = K_f_v - kappa_v

    h_v = 1 if (Z_v == 1 or is_product) else 0
    xi_v = h_v * D_v * t_v + (1 - Z_v) * l_v

    if Z_v == 1:
        denom = 1.0 - h_v * D_v * (1.0 - q_v)
        if denom <= P.TOL:
            return None
        g_v = q_v / denom
        R_v = (K_r_v + (1.0 - q_v) * xi_v) / denom
        U_v = (K_f_v + (1.0 - q_v) * (xi_v + h_v * D_v * R_v)) / g_v
        Q_v = 1.0
    else:
        g_v = q_v
        R_v = 0.0
        U_v = K_f_v
        Q_v = q_v

    return {'id': v, 'U': U_v, 'Q': Q_v, 'Z': Z_v, 'D': D_v,
            'K_f': K_f_v, 'K_r': K_r_v, 'kappa': kappa_v,
            'q': q_v, 'g': g_v, 'R': R_v, 'xi': xi_v}


# ------------------------------------------------------------------
def _pareto(states, max_keep=10):
    """按 Z 分组的 (U, Q) 非支配前沿保留（U 越小、Q 越大越优）。"""
    if not states:
        return []
    by_z = {}
    for s in states:
        by_z.setdefault(s['Z'], []).append(s)
    kept = []
    for z, group in by_z.items():
        group.sort(key=lambda s: (s['U'], -s['Q']))
        best_q = -1.0
        for s in group:
            if s['Q'] > best_q + 1e-12:
                kept.append(s)
                best_q = s['Q']
    kept.sort(key=lambda s: s['U'])
    return kept[:max_keep]


def _dfs(v, tree, data, root, max_keep=10):
    if v not in tree:
        cands = []
        for Z_v in (0, 1):
            st = eval_node(v, [], Z_v, 0, data, v == root)
            st['dec'] = {v: (Z_v, 0)}
            cands.append(st)
        return _pareto(cands, max_keep)

    child_lists = [_dfs(u, tree, data, root, max_keep) for u in tree[v]]
    if any(not cl for cl in child_lists):
        return []
    cands = []
    for combo in itertools.product(*child_lists):
        for Z_v in (0, 1):
            for D_v in (0, 1):
                st = eval_node(v, combo, Z_v, D_v, data, v == root)
                if st is None:
                    continue
                dec = {}
                for cs in combo:
                    dec.update(cs.get('dec', {}))
                dec[v] = (Z_v, D_v)
                st['dec'] = dec
                cands.append(st)
    return _pareto(cands, max_keep)


def solve_tree(tree, data, root=None, max_keep=10):
    """自底向上 DP，返回根节点上使 U_f 最小的状态（含全树决策）。"""
    root = root or P.Q3_ROOT
    states = _dfs(root, tree, data, root, max_keep)
    if not states:
        return None
    return min(states, key=lambda s: s['U'])


def decision_evaluate(tree, data, root, decision):
    """给定全树决策，返回根节点 U（决策固定下的后序回算）。"""
    def rec(v):
        cs = [rec(u) for u in tree.get(v, [])]
        Z_v, D_v = decision[v]
        return eval_node(v, cs, Z_v, D_v, data, v == root)
    return rec(root)


# ------------------------------------------------------------------
def run():
    data = build_node_data()
    tree = topology_from_blocks(P.Q3_TOPOLOGY_VARIANTS[0]['blocks'])

    best = solve_tree(tree, data)
    if best is None:
        raise RuntimeError('问题3 基准拓扑无可行解')
    U_root = best['U']
    profit = P.Q3_PRICE['s'] - U_root

    # 各节点分项成本
    full = decision_evaluate(tree, data, P.Q3_ROOT, best['dec'])

    def collect(v, out):
        cs = []
        for u in tree.get(v, []):
            cs.append(collect(u, out))
        Z_v, D_v = best['dec'][v]
        st = eval_node(v, cs, Z_v, D_v, data, v == P.Q3_ROOT)
        out[v] = {'U': st['U'], 'Q': st['Q'], 'Z': Z_v, 'D': D_v,
                  'K_f': st.get('K_f'), 'K_r': st.get('K_r'),
                  'kappa': st.get('kappa'), 'q': st.get('q'),
                  'g': st.get('g'), 'R': st.get('R')}
        return st

    node_cost = {}
    collect(P.Q3_ROOT, node_cost)

    # ---- 退化核验：两零配件一成品结构应与问题2闭式逐项收敛 ----
    import problem2
    deg_params = dict(P.CASE_PARAMS[0])
    deg_tree = {P.Q3_ROOT: ['S1'], 'S1': ['P1', 'P2']}
    deg_data = {
        'P1': {'kind': 'part', 'p': deg_params['p1'], 'a': deg_params['a1'], 'c': deg_params['c1']},
        'P2': {'kind': 'part', 'p': deg_params['p2'], 'a': deg_params['a2'], 'c': deg_params['c2']},
        'S1': {'kind': 'semi', 'p': deg_params['p0'], 'A': deg_params['A'],
               'c': deg_params['c0'], 't': deg_params['t'], 'l': deg_params['l'],
               's': deg_params['s']},
        P.Q3_ROOT: {'kind': 'product', 'p': 0.0, 'A': 0.0, 'c': 0.0, 't': 0.0,
                    'l': 0.0, 's': deg_params['s']},
    }
    deg_best = solve_tree(deg_tree, deg_data, max_keep=12)
    deg_U = deg_best['U']
    deg_profit = deg_params['s'] - deg_U

    # Q2 侧：把退化结构的 (Z1,Z2,C,D) 对应到 Q3 节点决策后比对
    # 树决策 -> (Z1, Z2, C, D)：P1/P2 的 Z、S1 的 Z 对应成品检测 C、S1 的 D 对应 D
    z1 = deg_best['dec']['P1'][0]
    z2 = deg_best['dec']['P2'][0]
    zc = deg_best['dec']['S1'][0]
    zd = deg_best['dec']['S1'][1]
    q2_res = problem2.evaluate(deg_params, z1, z2, zc, zd)
    q2_U = q2_res['U']
    q2_profit = q2_res['profit']
    diff_U = abs(deg_U - q2_U)
    diff_profit = abs(deg_profit - q2_profit)
    deg_pass = diff_U <= 1e-4 * max(1.0, abs(q2_U))

    # ---- 拓扑扰动扫描 ----
    topo_rows = []
    for variant in P.Q3_TOPOLOGY_VARIANTS:
        vt = topology_from_blocks(variant['blocks'])
        st = solve_tree(vt, data)
        if st is None:
            topo_rows.append({'name': variant['name'], 'blocks': variant['blocks'],
                              'feasible': False})
            continue
        topo_rows.append({
            'name': variant['name'],
            'blocks': variant['blocks'],
            'feasible': True,
            'U_root': st['U'],
            'profit': P.Q3_PRICE['s'] - st['U'],
            'decision': {k: {'Z': v[0], 'D': v[1]} for k, v in st['dec'].items()},
        })

    # ---- 成品策略横向对比（固定零配件与半成品最优决策，扫成品 (Z,D)）----
    prod_compare = []
    for Zf in (0, 1):
        for Df in (0, 1):
            dec = dict(best['dec'])
            dec[P.Q3_ROOT] = (Zf, Df)
            st = decision_evaluate(tree, data, P.Q3_ROOT, dec)
            prod_compare.append({'Z': Zf, 'D': Df, 'U_root': st['U'],
                                 'profit': P.Q3_PRICE['s'] - st['U']})

    return {
        'baseline': {
            'topology': {k: list(v) for k, v in tree.items()},
            'best_decision': {k: {'Z': v[0], 'D': v[1]} for k, v in best['dec'].items()},
            'U_root': U_root,
            'profit': profit,
            'node_cost': node_cost,
            'node_count': P.Q3_N_NODES,
            'semi_count': P.Q3_N_SEMI,
        },
        'degenerate_check': {
            'tree_U': deg_U,
            'tree_profit': deg_profit,
            'tree_decision': {k: {'Z': v[0], 'D': v[1]} for k, v in deg_best['dec'].items()},
            'q2_U': q2_U,
            'q2_profit': q2_profit,
            'q2_decision': {'Z1': z1, 'Z2': z2, 'C': zc, 'D': zd},
            'diff_U': diff_U,
            'diff_profit': diff_profit,
            'pass': bool(deg_pass),
        },
        'topology_robustness': topo_rows,
        'product_strategy_compare': prod_compare,
    }


if __name__ == '__main__':
    import json
    print(json.dumps(run(), ensure_ascii=False, indent=2))
