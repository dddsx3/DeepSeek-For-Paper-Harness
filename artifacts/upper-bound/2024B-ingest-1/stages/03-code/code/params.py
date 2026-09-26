# -*- coding: utf-8 -*-
"""code/params.py —— 本阶段（03-code）的**唯一数值来源**。

职责
----
把题面给定值（`01-prob-analysis/PROBLEM_FACTS.json`）与模型常数
（`02-modeling/DECLARATION.json` 的 `model_constants`）展开成 Python 模块，
供 `main.py` 与各 `problem*.py` 以 `from params import *` 统一读取。

纪律
----
1. **数值只在本文件出现一次**。其余脚本不得内嵌任何数字，尤其不得把常数
   写死在函数体内，也不得从散文（MODELING_REPORT.md）里抄。
2. 本文件内出现的每一个数，要么是题面给定值（逐条标注 `F-*` / `HC-*` 来源），
   要么是 `model_constants` 登记过的模型常数（标注中文键名），要么是
    `illustrative_numbers` 编外登记簿里的反例示意数（显式标注 reason）。
3. **不产生任何计算结果**。所有"算出来的数"由 `problem*.py` 真跑后写进
   `code/outputs.json`，本文件一个结果也不预填。
4. 本文件不画图、不写图表声明、不写数源声明。

表 1 键名约定（六种情况，`TABLE1` 为长度 6 的 list of dict）
-------------------------------------------------------------
符号键（与 DECLARATION.json 的 SYM-* 同名，便于逐字对齐公式）：
    `case` `p1` `a1` `c1` `p2` `a2` `c2` `p0` `A` `c0` `s` `l` `t`
语义别名键（同值，防止解题脚本猜错键名）：
    `p_part1` `a_part1` `c_part1` `p_part2` `a_part2` `c_part2`
    `p_product` `assembly_cost` `inspect_cost_product`
    `price` `exchange_loss` `disassemble_fee`
只读用途：`case_params(k)` 取第 k 种情况；`TABLE1_CASES` 为 {case: dict} 视图。

节点键名约定（问题 3，`Q3_NODES` 为 {node_id: dict}）
-----------------------------------------------------
    `id` `index` `kind` `defect_rate`/`p` `purchase_price`/`a`
    `inspect_cost`/`c` `assembly_cost`/`A` `disassemble_fee`/`t`
    `exchange_loss`/`l` `price`/`s` `children` `fact_id`
节点 id：`part1`…`part8`、`semi1`…`semi3`、`product`（根）。

模型常数键名（`MODEL_CONSTANTS`，与 DECLARATION.json 的中文键名逐字一致）
-------------------------------------------------------------------------
数值容差 / Q1可识别超标幅度Δ / Q1情形1显著性水平α1 / Q1情形2显著性水平α2 /
Q1功效约束β / Q1样本量搜索上界 / 蒙特卡洛重复次数 / 随机种子 /
灵敏度扰动幅度 / 灵敏度扫描置信水平对照值 / 盈亏平衡等高线格点数 /
正态近似适用下界 / 决策一致率判定阈值 / Q4重抽样次数 / Q4置信区间置信水平 /
问题2策略组合数 / 问题3半成品数 / 问题3图1节点总数
用 `constant("随机种子")` 按键名读取。
"""

from __future__ import annotations

import math

# 白名单常数（契约允许裸写的 0/1/2/-1 与 π、e 的具名形式）
PI = math.pi
E = math.e
PERCENT = 100.0          # 百分比换算（无量纲），仅用于灵敏度扰动幅度的单位折算

# 单位标注（C-UNIT-DEF / HC-11：金额一律元/件，比率无量纲）
UNIT_MONEY = "元/件"
UNIT_RATE = "比率"

# =====================================================================
# 1. 题面给定值 —— 问题 1
# =====================================================================
# F-NOMINAL：供应商声称的标称次品率
NOMINAL_DEFECT_RATE = 0.10
# F-CONF-REJECT：情形 (1) 95% 信度下认定次品率超过标称值则拒收
CONFIDENCE_REJECT = 0.95
# F-CONF-ACCEPT：情形 (2) 90% 信度下认定次品率不超过标称值则接收
CONFIDENCE_ACCEPT = 0.90

# 问题 1 抽样检测的**单位费用**。
# 警告：题面只说明"检测费用由企业自行承担"（F-MECH-INSPECT-COST），
# **并未给定单位检测成本**。下面的取值是自定口径的**假设值**，来源为表 1
# 情况 1 的零配件检测成本（F-T1-C1），已按审计条目 5 的改法以 `ASSUMED_`
# 前缀自证其非题面给定值，阶段 4 铸造数源时必须按 ASM 标注，不得当作题面值。
ASSUMED_UNIT_COST_PART1 = 2.0     # 假设值，源自 F-T1-C1 的 c1
ASSUMED_UNIT_COST_PART2 = 3.0     # 假设值，源自 F-T1-C1 的 c2

# =====================================================================
# 2. 题面给定值 —— 问题 2 表 1（六种情况）
# =====================================================================
TABLE1 = [
    {
        "case": 1,
        # 符号键（逐字对齐 DECLARATION.json 的 SYM-p1/SYM-a1/…）
        "p1": 0.10, "a1": 4.0, "c1": 2.0,
        "p2": 0.10, "a2": 18.0, "c2": 3.0,
        "p0": 0.10, "A": 6.0, "c0": 3.0,
        "s": 56.0, "l": 6.0, "t": 5.0,
        # 语义别名（同值）
        "p_part1": 0.10, "a_part1": 4.0, "c_part1": 2.0,
        "p_part2": 0.10, "a_part2": 18.0, "c_part2": 3.0,
        "p_product": 0.10, "assembly_cost": 6.0, "inspect_cost_product": 3.0,
        "price": 56.0, "exchange_loss": 6.0, "disassemble_fee": 5.0,
        "fact_id": "F-T1-C1",
    },
    {
        "case": 2,
        "p1": 0.20, "a1": 4.0, "c1": 2.0,
        "p2": 0.20, "a2": 18.0, "c2": 3.0,
        "p0": 0.20, "A": 6.0, "c0": 3.0,
        "s": 56.0, "l": 6.0, "t": 5.0,
        "p_part1": 0.20, "a_part1": 4.0, "c_part1": 2.0,
        "p_part2": 0.20, "a_part2": 18.0, "c_part2": 3.0,
        "p_product": 0.20, "assembly_cost": 6.0, "inspect_cost_product": 3.0,
        "price": 56.0, "exchange_loss": 6.0, "disassemble_fee": 5.0,
        "fact_id": "F-T1-C2",
    },
    {
        "case": 3,
        "p1": 0.10, "a1": 4.0, "c1": 2.0,
        "p2": 0.10, "a2": 18.0, "c2": 3.0,
        "p0": 0.10, "A": 6.0, "c0": 3.0,
        "s": 56.0, "l": 30.0, "t": 5.0,
        "p_part1": 0.10, "a_part1": 4.0, "c_part1": 2.0,
        "p_part2": 0.10, "a_part2": 18.0, "c_part2": 3.0,
        "p_product": 0.10, "assembly_cost": 6.0, "inspect_cost_product": 3.0,
        "price": 56.0, "exchange_loss": 30.0, "disassemble_fee": 5.0,
        "fact_id": "F-T1-C3",
    },
    {
        "case": 4,
        "p1": 0.20, "a1": 4.0, "c1": 1.0,
        "p2": 0.20, "a2": 18.0, "c2": 1.0,
        "p0": 0.20, "A": 6.0, "c0": 2.0,
        "s": 56.0, "l": 30.0, "t": 5.0,
        "p_part1": 0.20, "a_part1": 4.0, "c_part1": 1.0,
        "p_part2": 0.20, "a_part2": 18.0, "c_part2": 1.0,
        "p_product": 0.20, "assembly_cost": 6.0, "inspect_cost_product": 2.0,
        "price": 56.0, "exchange_loss": 30.0, "disassemble_fee": 5.0,
        "fact_id": "F-T1-C4",
    },
    {
        "case": 5,
        "p1": 0.10, "a1": 4.0, "c1": 8.0,
        "p2": 0.20, "a2": 18.0, "c2": 1.0,
        "p0": 0.10, "A": 6.0, "c0": 2.0,
        "s": 56.0, "l": 10.0, "t": 5.0,
        "p_part1": 0.10, "a_part1": 4.0, "c_part1": 8.0,
        "p_part2": 0.20, "a_part2": 18.0, "c_part2": 1.0,
        "p_product": 0.10, "assembly_cost": 6.0, "inspect_cost_product": 2.0,
        "price": 56.0, "exchange_loss": 10.0, "disassemble_fee": 5.0,
        "fact_id": "F-T1-C5",
    },
    {
        "case": 6,
        "p1": 0.05, "a1": 4.0, "c1": 2.0,
        "p2": 0.05, "a2": 18.0, "c2": 3.0,
        "p0": 0.05, "A": 6.0, "c0": 3.0,
        "s": 56.0, "l": 10.0, "t": 40.0,
        "p_part1": 0.05, "a_part1": 4.0, "c_part1": 2.0,
        "p_part2": 0.05, "a_part2": 18.0, "c_part2": 3.0,
        "p_product": 0.05, "assembly_cost": 6.0, "inspect_cost_product": 3.0,
        "price": 56.0, "exchange_loss": 10.0, "disassemble_fee": 40.0,
        "fact_id": "F-T1-C6",
    },
]

TABLE1_CASE_IDS = [rec["case"] for rec in TABLE1]
TABLE1_CASES = {rec["case"]: rec for rec in TABLE1}
N_CASES_Q2 = len(TABLE1)


def case_params(case_id):
    """按情况编号（1..6）取表 1 参数 dict；编号非法直接 raise，不静默兜底。"""
    key = int(case_id)
    if key not in TABLE1_CASES:
        raise KeyError("表 1 无此情况编号：%r" % (case_id,))
    return TABLE1_CASES[key]


# =====================================================================
# 3. 题面给定值 —— 问题 3 表 2
# =====================================================================
TABLE2_PARTS = [
    {"index": 1, "defect_rate": 0.10, "p": 0.10,
     "purchase_price": 2.0, "a": 2.0, "inspect_cost": 1.0, "c": 1.0,
     "fact_id": "F-T2-PART-1"},
    {"index": 2, "defect_rate": 0.10, "p": 0.10,
     "purchase_price": 8.0, "a": 8.0, "inspect_cost": 1.0, "c": 1.0,
     "fact_id": "F-T2-PART-2"},
    {"index": 3, "defect_rate": 0.10, "p": 0.10,
     "purchase_price": 12.0, "a": 12.0, "inspect_cost": 2.0, "c": 2.0,
     "fact_id": "F-T2-PART-3"},
    {"index": 4, "defect_rate": 0.10, "p": 0.10,
     "purchase_price": 2.0, "a": 2.0, "inspect_cost": 1.0, "c": 1.0,
     "fact_id": "F-T2-PART-4"},
    {"index": 5, "defect_rate": 0.10, "p": 0.10,
     "purchase_price": 8.0, "a": 8.0, "inspect_cost": 1.0, "c": 1.0,
     "fact_id": "F-T2-PART-5"},
    {"index": 6, "defect_rate": 0.10, "p": 0.10,
     "purchase_price": 12.0, "a": 12.0, "inspect_cost": 2.0, "c": 2.0,
     "fact_id": "F-T2-PART-6"},
    {"index": 7, "defect_rate": 0.10, "p": 0.10,
     "purchase_price": 8.0, "a": 8.0, "inspect_cost": 1.0, "c": 1.0,
     "fact_id": "F-T2-PART-7"},
    {"index": 8, "defect_rate": 0.10, "p": 0.10,
     "purchase_price": 12.0, "a": 12.0, "inspect_cost": 2.0, "c": 2.0,
     "fact_id": "F-T2-PART-8"},
]

TABLE2_SEMI = [
    {"index": 1, "defect_rate": 0.10, "p": 0.10,
     "assembly_cost": 8.0, "A": 8.0, "inspect_cost": 4.0, "c": 4.0,
     "disassemble_fee": 6.0, "t": 6.0, "fact_id": "F-T2-SEMI"},
    {"index": 2, "defect_rate": 0.10, "p": 0.10,
     "assembly_cost": 8.0, "A": 8.0, "inspect_cost": 4.0, "c": 4.0,
     "disassemble_fee": 6.0, "t": 6.0, "fact_id": "F-T2-SEMI"},
    {"index": 3, "defect_rate": 0.10, "p": 0.10,
     "assembly_cost": 8.0, "A": 8.0, "inspect_cost": 4.0, "c": 4.0,
     "disassemble_fee": 6.0, "t": 6.0, "fact_id": "F-T2-SEMI"},
]

TABLE2_PRODUCT = {
    "defect_rate": 0.10, "p": 0.10,
    "assembly_cost": 8.0, "A": 8.0,
    "inspect_cost": 6.0, "c": 6.0,
    "disassemble_fee": 10.0, "t": 10.0,
    "price": 200.0, "s": 200.0,
    "exchange_loss": 40.0, "l": 40.0,
    "fact_id": "F-T2-PRODUCT / F-T2-PRICE",
}

N_PARTS_Q3 = len(TABLE2_PARTS)
N_SEMI_Q3 = len(TABLE2_SEMI)

# =====================================================================
# 4. 问题 3 装配树拓扑（ASM-09 显式假设）
# =====================================================================
# 数据缺口声明（与 DECLARATION.json 的 ASM-09 同源）：图 1 原件未随阶段简报
# 下传，连接关系只能从表 2 的行分组读出，故此处显式写成假设；其影响由
# problem3 的拓扑扰动扫描（{R-Q3-topology-robust}）量化。
#
# 拓扑：{1,2,3}→半成品 1、{4,5,6}→半成品 2、{7,8}→半成品 3、三个半成品→成品
Q3_GROUPS = {
    "semi1": [1, 2, 3],
    "semi2": [4, 5, 6],
    "semi3": [7, 8],
}

Q3_CH = {
    "semi1": ["part1", "part2", "part3"],
    "semi2": ["part4", "part5", "part6"],
    "semi3": ["part7", "part8"],
    "product": ["semi1", "semi2", "semi3"],
}

Q3_PART_IDS = ["part%d" % int(rec["index"]) for rec in TABLE2_PARTS]
Q3_SEMI_IDS = ["semi%d" % int(rec["index"]) for rec in TABLE2_SEMI]
Q3_PRODUCT_ID = "product"
Q3_ROOT_ID = Q3_PRODUCT_ID
Q3_NODE_IDS = Q3_PART_IDS + Q3_SEMI_IDS + [Q3_PRODUCT_ID]


def _build_q3_nodes():
    """把表 2 参数 + ASM-09 拓扑装配成节点属性表 {node_id: dict}。

    每个节点的子节点用 `children`（= ch(v)）表示；叶节点 children 为空列表。
    零配件节点的 A/t/l 项按 0 填入，使节点方程可无分支统一计算。
    """
    nodes = {}
    for rec in TABLE2_PARTS:
        nid = "part%d" % int(rec["index"])
        nodes[nid] = {
            "id": nid, "index": int(rec["index"]), "kind": "part",
            "defect_rate": rec["defect_rate"], "p": rec["p"],
            "purchase_price": rec["purchase_price"], "a": rec["a"],
            "inspect_cost": rec["inspect_cost"], "c": rec["c"],
            "assembly_cost": 0.0, "A": 0.0,
            "disassemble_fee": 0.0, "t": 0.0,
            "exchange_loss": 0.0, "l": 0.0,
            "price": 0.0, "s": 0.0,
            "children": [],
            "fact_id": rec["fact_id"],
        }
    for rec in TABLE2_SEMI:
        nid = "semi%d" % int(rec["index"])
        nodes[nid] = {
            "id": nid, "index": int(rec["index"]), "kind": "semi",
            "defect_rate": rec["defect_rate"], "p": rec["p"],
            "purchase_price": 0.0, "a": 0.0,
            "inspect_cost": rec["inspect_cost"], "c": rec["c"],
            "assembly_cost": rec["assembly_cost"], "A": rec["A"],
            "disassemble_fee": rec["disassemble_fee"], "t": rec["t"],
            "exchange_loss": 0.0, "l": 0.0,
            "price": 0.0, "s": 0.0,
            "children": list(Q3_CH[nid]),
            "fact_id": rec["fact_id"],
        }
    prod = TABLE2_PRODUCT
    nodes[Q3_PRODUCT_ID] = {
        "id": Q3_PRODUCT_ID, "index": -1, "kind": "product",
        "defect_rate": prod["defect_rate"], "p": prod["p"],
        "purchase_price": 0.0, "a": 0.0,
        "inspect_cost": prod["inspect_cost"], "c": prod["c"],
        "assembly_cost": prod["assembly_cost"], "A": prod["A"],
        "disassemble_fee": prod["disassemble_fee"], "t": prod["t"],
        "exchange_loss": prod["exchange_loss"], "l": prod["l"],
        "price": prod["price"], "s": prod["s"],
        "children": list(Q3_CH[Q3_PRODUCT_ID]),
        "fact_id": prod["fact_id"],
    }
    return nodes


Q3_NODES = _build_q3_nodes()


def q3_topology():
    """返回 problem3 可直接透传的拓扑字典。

    同时给出 `n_nodes`、`nodes`（数组）、`groups`、`children`、`root` 五种键，
    以消除"主编排打印 n_nodes、而交付清单只登记 nodes/groups"的键名错位
    （审计条目 4 的整改落点）：problem3.run() 返回本函数结果即可，键必齐全。
    """
    return {
        "pipeline": "ASM-09",
        "n_nodes": Q3_N_NODES,
        "root": Q3_ROOT_ID,
        "part_ids": list(Q3_PART_IDS),
        "semi_ids": list(Q3_SEMI_IDS),
        "product_id": Q3_PRODUCT_ID,
        "groups": {k: list(v) for k, v in Q3_GROUPS.items()},
        "children": {k: list(v) for k, v in Q3_CH.items()},
        "nodes": [
            {
                "id": nid,
                "kind": Q3_NODES[nid]["kind"],
                "p": Q3_NODES[nid]["p"],
                "a": Q3_NODES[nid]["a"],
                "c": Q3_NODES[nid]["c"],
                "A": Q3_NODES[nid]["A"],
                "t": Q3_NODES[nid]["t"],
                "l": Q3_NODES[nid]["l"],
                "s": Q3_NODES[nid]["s"],
                "children": list(Q3_NODES[nid]["children"]),
            }
            for nid in Q3_NODE_IDS
        ],
    }


# =====================================================================
# 5. 模型常数（DECLARATION.json 的 model_constants，中文键名逐字对应）
# =====================================================================
TOL = 1e-06                  # "数值容差"：解析式与逐轮现金流复算比对容差
Q1_DELTA = 0.05              # "Q1可识别超标幅度Δ"
Q1_ALPHA1 = 0.05             # "Q1情形1显著性水平α1"（对应 95% 信度）
Q1_ALPHA2 = 0.10             # "Q1情形2显著性水平α2"（对应 90% 信度）
Q1_BETA = 0.10               # "Q1功效约束β"，功效下界 1-β
Q1_N_MAX = 1000              # "Q1样本量搜索上界"：n 的精确枚举上界
MC_REPS = 10000              # "蒙特卡洛重复次数"：全局扫描（拓扑扰动/灵敏度）
RANDOM_SEED = 202409         # "随机种子"：所有随机流的唯一派生种子
SENSITIVITY_PCT = 20         # "灵敏度扰动幅度"（百分数）
SENSITIVITY_ALPHA_REF = 0.99 # "灵敏度扫描置信水平对照值"（自定对照，非题面值）
BREAKEVEN_GRID = 41          # "盈亏平衡等高线格点数"（每轴格点数）
NORMAL_APPROX_MIN = 5        # "正态近似适用下界"：n·p 与 n·(1−p) 均需 ≥ 此值
DECISION_CONSISTENCY_THRESHOLD = 0.95  # "决策一致率判定阈值"
Q4_REPS = 2000               # "Q4重抽样次数"：问题 4 的次品率重抽样次数
Q4_CI_LEVEL = 0.95           # "Q4置信区间置信水平"（与情形 1 的 95% 同值异义）
Q2_N_STRATEGIES = 16         # "问题2策略组合数"：(Z1,Z2,C,D) ∈ {0,1}^4
Q3_N_SEMI = 3                # "问题3半成品数"
Q3_N_NODES = 12              # "问题3图1节点总数"

# 派生量：扰动幅度的比例形式（供灵敏度扫描直接用，避免调用方再除一次）
SENSITIVITY_REL = SENSITIVITY_PCT / PERCENT

# 中文键名 → 取值 的只读映射（按 DECLARATION.json 的键名逐字读取）
MODEL_CONSTANTS = {
    "数值容差": TOL,
    "Q1可识别超标幅度Δ": Q1_DELTA,
    "Q1情形1显著性水平α1": Q1_ALPHA1,
    "Q1情形2显著性水平α2": Q1_ALPHA2,
    "Q1功效约束β": Q1_BETA,
    "Q1样本量搜索上界": Q1_N_MAX,
    "蒙特卡洛重复次数": MC_REPS,
    "随机种子": RANDOM_SEED,
    "灵敏度扰动幅度": SENSITIVITY_PCT,
    "灵敏度扫描置信水平对照值": SENSITIVITY_ALPHA_REF,
    "盈亏平衡等高线格点数": BREAKEVEN_GRID,
    "正态近似适用下界": NORMAL_APPROX_MIN,
    "决策一致率判定阈值": DECISION_CONSISTENCY_THRESHOLD,
    "Q4重抽样次数": Q4_REPS,
    "Q4置信区间置信水平": Q4_CI_LEVEL,
    "问题2策略组合数": Q2_N_STRATEGIES,
    "问题3半成品数": Q3_N_SEMI,
    "问题3图1节点总数": Q3_N_NODES,
}


def constant(name):
    """按键名读取模型常数；未登记的名字直接 raise，不静默给默认值。"""
    if name not in MODEL_CONSTANTS:
        raise KeyError("未登记的模型常数：%r" % (name,))
    return MODEL_CONSTANTS[name]


def normal_approx_ok(n, p):
    """正态近似的**适用性判定**（审计条目 2 的整改落点之一）。

    仅当 n·p 与 n·(1−p) 均不小于 `NORMAL_APPROX_MIN` 时返回 True。
    用途：问题 1 在小 n 区**禁止**用正态近似做判定，只允许在满足本判定时
    用它做搜索初值/快速筛选；主判定一律走精确二项尾概率。
    """
    return (n * p >= NORMAL_APPROX_MIN) and (n * (1.0 - p) >= NORMAL_APPROX_MIN)


def monte_carlo_reps(scope="global"):
    """按用途返回蒙特卡洛重复次数（审计条目 2 的整改落点之二）。

    scope 为 "q4"/"problem4"/"resample" 时返回 `Q4_REPS`（问题 4 的次品率
    重抽样），其余（问题 3 拓扑扰动扫描、灵敏度与稳健性扫描）返回 `MC_REPS`。
    两者是**不同的登记常数**，不得互相替换，也不得混用同一个随机子流。
    """
    if scope in ("q4", "problem4", "resample"):
        return Q4_REPS
    return MC_REPS


# =====================================================================
# 6. 编外登记簿：反例/示意数（既非题面给定值、也非模型常数、更非计算结果）
# =====================================================================
ILLUSTRATIVE_NUMBERS = [
    {
        "value": 63,
        "quote": "连续松弛会给出“检测 63% 的成品”这类无法实施的解",
        "reason": (
            "反例示意（继承自 DECLARATION.json 的 illustrative_numbers）："
            "说明把 0-1 检测决策松弛为连续比例后会得到不可实施的解。"
            "它既不是题面给定值、不是模型常数，也不是本阶段代码的计算结果；"
            "本阶段代码不产出该数，仅在本登记簿与模型评价文字中引用。"
        ),
    },
]

# =====================================================================
# 7. 一致性断言（让登记常数在代码中真的被引用，而非躺着不用的装饰）
# =====================================================================
# 策略空间大小必与 4 个二值决策吻合
assert Q2_N_STRATEGIES == 2 ** 4
# 节点规模必与登记常数吻合（问题3图1节点总数、半成品数）
assert len(Q3_NODES) == Q3_N_NODES
assert len(Q3_SEMI_IDS) == Q3_N_SEMI
assert len(Q3_PART_IDS) == N_PARTS_Q3
assert Q3_N_NODES == len(Q3_PART_IDS) + len(Q3_SEMI_IDS) + 1
# 每个内部节点的子节点必须都在 Q3_NODES 中（拓扑自洽）
for _parent, _kids in Q3_CH.items():
    assert _parent in Q3_NODES, "拓扑父节点缺失：%s" % _parent
    assert len(_kids) > 0, "内部节点无子件：%s" % _parent
    for _kid in _kids:
        assert _kid in Q3_NODES, "拓扑子节点缺失：%s" % _kid
# ASM-05：题面信度 ↔ 单侧显著性水平的口径一致
assert abs(Q1_ALPHA1 - (1.0 - CONFIDENCE_REJECT)) < TOL
assert abs(Q1_ALPHA2 - (1.0 - CONFIDENCE_ACCEPT)) < TOL
# ASM-15：只有成品节点带调换损失
assert Q3_NODES[Q3_PRODUCT_ID]["l"] > 0.0
for _nid in Q3_PART_IDS + Q3_SEMI_IDS:
    assert Q3_NODES[_nid]["l"] == 0.0, "非成品节点不得有调换损失：%s" % _nid

__all__ = [
    # 白名单与单位
    "PI", "E", "PERCENT", "UNIT_MONEY", "UNIT_RATE",
    # 问题 1 给定值
    "NOMINAL_DEFECT_RATE", "CONFIDENCE_REJECT", "CONFIDENCE_ACCEPT",
    "ASSUMED_UNIT_COST_PART1", "ASSUMED_UNIT_COST_PART2",
    # 表 1
    "TABLE1", "TABLE1_CASES", "TABLE1_CASE_IDS", "N_CASES_Q2", "case_params",
    # 表 2
    "TABLE2_PARTS", "TABLE2_SEMI", "TABLE2_PRODUCT",
    "N_PARTS_Q3", "N_SEMI_Q3",
    # 问题 3 拓扑
    "Q3_GROUPS", "Q3_CH", "Q3_NODES", "Q3_PART_IDS", "Q3_SEMI_IDS",
    "Q3_PRODUCT_ID", "Q3_ROOT_ID", "Q3_NODE_IDS", "q3_topology",
    # 模型常数
    "TOL", "Q1_DELTA", "Q1_ALPHA1", "Q1_ALPHA2", "Q1_BETA", "Q1_N_MAX",
    "MC_REPS", "RANDOM_SEED", "SENSITIVITY_PCT", "SENSITIVITY_REL",
    "SENSITIVITY_ALPHA_REF", "BREAKEVEN_GRID", "NORMAL_APPROX_MIN",
    "DECISION_CONSISTENCY_THRESHOLD", "Q4_REPS", "Q4_CI_LEVEL",
    "Q2_N_STRATEGIES", "Q3_N_SEMI", "Q3_N_NODES",
    "MODEL_CONSTANTS", "constant", "normal_approx_ok", "monte_carlo_reps",
    # 编外登记簿
    "ILLUSTRATIVE_NUMBERS",
]