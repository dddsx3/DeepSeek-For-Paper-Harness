"""问题 4：Beta 后验下的利润区间与决策稳健性。

- 次品率由抽样检测得到：用问题 1 的方案抽样，取无信息先验 Beta(1,1)，
  后验为 Beta(X+1, n-X+1)。
- 蒙特卡洛：对 (p1, p2, p0) 联合后验采样，重算问题 2 的 16 种策略利润，
  统计期望利润分布（2.5%/97.5% 分位数）、决策保持率与期望后悔值。
- 问题 3 的稳健性：对候选最优策略做同样处理（抽样口径见下方 n_samples 与 n_draw）。
"""

from __future__ import annotations

import numpy as np
from scipy.stats import beta as beta_dist

import problem2
import problem3

POST_N = 110          # 问题 1 情形(1) 的样本量口径
POST_X = 11           # 样本次品率恰为标称值 0.10
N_SAMPLES = 10000     # 问题 2 的后验抽样次数
N_DRAW_P3 = 1000      # 问题 3 稳健性检验的后验抽样次数
SEED = 20240914


def _vector_profit(prm: dict, P: np.ndarray, combo) -> np.ndarray:
    x1, x2, y, z = combo
    p1 = P[:, 0]
    p2 = P[:, 1]
    p0 = P[:, 2]
    a1 = np.where(x1, (prm["c1"] + prm["d1"]) / (1.0 - p1), prm["c1"])
    pi1 = np.where(x1, 1.0, 1.0 - p1)
    a2 = np.where(x2, (prm["c2"] + prm["d2"]) / (1.0 - p2), prm["c2"])
    pi2 = np.where(x2, 1.0, 1.0 - p2)
    Q = pi1 * pi2 * (1.0 - p0)
    Q = np.maximum(Q, 1e-9)
    B_new = a1 + a2 + prm["g0"] + y * prm["d0"]
    B_rec = x1 * prm["d1"] + x2 * prm["d2"] + prm["g0"] + y * prm["d0"]
    fail = (1 - y) * prm["w"]
    if z:
        K_rec = (B_rec + (1.0 - Q) * (fail + prm["s"])) / Q
        K_new = B_new + (1.0 - Q) * (fail + prm["s"] + K_rec)
    else:
        K_new = (B_new + (1.0 - Q) * fail) / Q
    return prm["S"] - K_new


def run(p2_res: dict, p3_res: dict) -> dict:
    rng = np.random.default_rng(SEED)

    a_post = POST_X + 1
    b_post = POST_N - POST_X + 1
    post_mean = a_post / (a_post + b_post)
    ci_low = float(beta_dist.ppf(0.025, a_post, b_post))
    ci_high = float(beta_dist.ppf(0.975, a_post, b_post))

    P = rng.beta(a_post, b_post, size=(N_SAMPLES, 3))
    prm = problem2.CASE_PARAMS[0]
    strategies = problem2.STRATEGIES
    profits = np.empty((N_SAMPLES, len(strategies)))
    for k, combo in enumerate(strategies):
        profits[:, k] = _vector_profit(prm, P, combo)

    point_profits = np.array([problem2.evaluate(prm, *c)["profit"] for c in strategies])
    point_best = int(np.argmax(point_profits))
    point_best_combo = list(strategies[point_best])

    arg_best = np.argmax(profits, axis=1)
    keep_counts = np.bincount(arg_best, minlength=len(strategies))
    keep_rate = float(keep_counts[point_best] / N_SAMPLES)
    chosen = profits[:, point_best]
    maxes = profits.max(axis=1)
    regret = maxes - chosen

    quantiles = {
        "low": float(np.percentile(chosen, 2.5)),
        "median": float(np.percentile(chosen, 50)),
        "high": float(np.percentile(chosen, 97.5)),
        "mean": float(np.mean(chosen)),
        "std": float(np.std(chosen)),
    }

    strategy_quantiles = []
    for k in range(len(strategies)):
        strategy_quantiles.append({
            "code": problem2.code_of(strategies[k]),
            "low": float(np.percentile(profits[:, k], 2.5)),
            "median": float(np.percentile(profits[:, k], 50)),
            "high": float(np.percentile(profits[:, k], 97.5)),
            "mean": float(np.mean(profits[:, k])),
        })

    # ---- 问题 3 的决策稳健性 ----
    cand = p3_res["top_strategies"][:5]
    Pp = rng.beta(a_post, b_post, size=(N_DRAW_P3, 11))
    profits3 = np.empty((N_DRAW_P3, len(cand)))
    for j, s in enumerate(cand):
        xp = tuple(s["x_parts"])
        hopt = tuple((h[0], h[1]) for h in s["half_opts"])
        fopt = (s["final_opt"][0], s["final_opt"][1])
        for i in range(N_DRAW_P3):
            r = problem3.evaluate(xp, hopt, fopt,
                                  p_parts=Pp[i, 0:8], p_halfs=Pp[i, 8:11], p_final=Pp[i, 11])
            profits3[i, j] = r["profit"]
    arg3 = np.argmax(profits3, axis=1)
    p3_keep = float(np.mean(arg3 == 0))
    p3_regret = float(np.mean(profits3.max(axis=1) - profits3[:, 0]))

    return {
        "posterior": {
            "alpha": a_post,
            "beta": b_post,
            "mean": post_mean,
            "ci_low": ci_low,
            "ci_high": ci_high,
            "n_samples_q1": POST_N,
            "x_observed": POST_X,
        },
        "n_samples": N_SAMPLES,
        "seed": SEED,
        "strategy_codes": [problem2.code_of(c) for c in strategies],
        "point_best_code": problem2.code_of(tuple(point_best_combo)),
        "point_best_strategy": point_best_combo,
        "keep_rate": keep_rate,
        "expected_regret": float(np.mean(regret)),
        "regret_p95": float(np.percentile(regret, 95)),
        "profit_quantiles": quantiles,
        "strategy_keep_rate": [float(v / N_SAMPLES) for v in keep_counts],
        "strategy_profit_mean": [float(v) for v in profits.mean(axis=0)],
        "strategy_profit_quantiles": strategy_quantiles,
        "problem3_robustness": {
            "n_candidates": len(cand),
            "n_samples": N_DRAW_P3,
            "keep_rate": p3_keep,
            "mean_regret": p3_regret,
            "best_candidate_profit_point": cand[0]["profit"],
        },
        "leakage_note": "保持率不是分类器性能指标，而是后验样本中某策略成为最优策略的频率；参数由 Beta 后验独立采样生成，不存在训练/验证/测试划分，也无特征泄漏路径。",
    }


if __name__ == "__main__":
    import json
    import problem1
    p2 = problem2.run()
    p3 = problem3.run()
    print(json.dumps(run(p2, p3), ensure_ascii=False, indent=2))
