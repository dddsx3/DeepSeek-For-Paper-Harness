# -*- coding: utf-8 -*-
"""阶段 03 唯一常量容器。

纪律：其它脚本一律 ``from params import *``，不得在函数体内写裸数字。
两类来源：
  1) 题面给定值 —— 逐条对应 01-prob-analysis/PROBLEM_FACTS.json 的 F-* 条目；
  2) 模型常数 —— 逐条对应 02-modeling/DECLARATION.json 的 model_constants 段。
"""

# ---------------------------------------------------------------- 题面给定值

# F-NOMINAL：供应商声称的标称次品率
P_NOMINAL = 0.10
# F-CONF-REJECT：情形(1) 认定超过标称值即拒收的信度
CONF_REJECT = 0.95
# F-CONF-ACCEPT：情形(2) 认定不超过标称值即接收的信度
CONF_ACCEPT = 0.90

# F-APPENDIX-UNIT：购买单价、检测成本、装配成本、市场售价、调换损失、拆解费用单位均为元/件
# F-T1-C1 .. F-T1-C6：表 1 六种情况
TABLE1 = [
    {"case": 1, "p1": 0.10, "a1": 4, "c1": 2, "p2": 0.10, "a2": 18, "c2": 3,
     "p0": 0.10, "A": 6, "c0": 3, "s": 56, "l": 6, "t": 5},
    {"case": 2, "p1": 0.20, "a1": 4, "c1": 2, "p2": 0.20, "a2": 18, "c2": 3,
     "p0": 0.20, "A": 6, "c0": 3, "s": 56, "l": 6, "t": 5},
    {"case": 3, "p1": 0.10, "a1": 4, "c1": 2, "p2": 0.10, "a2": 18, "c2": 3,
     "p0": 0.10, "A": 6, "c0": 3, "s": 56, "l": 30, "t": 5},
    {"case": 4, "p1": 0.20, "a1": 4, "c1": 1, "p2": 0.20, "a2": 18, "c2": 1,
     "p0": 0.20, "A": 6, "c0": 2, "s": 56, "l": 30, "t": 5},
    {"case": 5, "p1": 0.10, "a1": 4, "c1": 8, "p2": 0.20, "a2": 18, "c2": 1,
     "p0": 0.10, "A": 6, "c0": 2, "s": 56, "l": 10, "t": 5},
    {"case": 6, "p1": 0.05, "a1": 4, "c1": 2, "p2": 0.05, "a2": 18, "c2": 3,
     "p0": 0.05, "A": 6, "c0": 3, "s": 56, "l": 10, "t": 40},
]

# F-T2-PART-1 .. F-T2-PART-8：表 2 零配件 1-8
TABLE2_PARTS = [
    {"id": 1, "p": 0.10, "a": 2, "c": 1},
    {"id": 2, "p": 0.10, "a": 8, "c": 1},
    {"id": 3, "p": 0.10, "a": 12, "c": 2},
    {"id": 4, "p": 0.10, "a": 2, "c": 1},
    {"id": 5, "p": 0.10, "a": 8, "c": 1},
    {"id": 6, "p": 0.10, "a": 12, "c": 2},
    {"id": 7, "p": 0.10, "a": 8, "c": 1},
    {"id": 8, "p": 0.10, "a": 12, "c": 2},
]

# F-T2-SEMI：表 2 半成品 1-3（次品率 / 装配成本 / 检测成本 / 拆解费用）
TABLE2_SEMI = [
    {"id": "S1", "p": 0.10, "A": 8, "c": 4, "t": 6},
    {"id": "S2", "p": 0.10, "A": 8, "c": 4, "t": 6},
    {"id": "S3", "p": 0.10, "A": 8, "c": 4, "t": 6},
]

# F-T2-PRODUCT + F-T2-PRICE：表 2 成品
TABLE2_PRODUCT = {"id": "F", "p": 0.10, "A": 8, "c": 6, "t": 10, "s": 200, "l": 40}

# ASM-09：图 1 拓扑假设（图 1 原件未随简报下传，连接关系自表 2 行分组读出）
TOPOLOGY_BASE = {"S1": [1, 2, 3], "S2": [4, 5, 6], "S3": [7, 8], "F": ["S1", "S2", "S3"]}

SEMI_IDS = ["S1", "S2", "S3"]
ROOT_ID = "F"

# ---------------------------------------------------------------- 模型常数
# 逐条对应 02-modeling/DECLARATION.json 的 model_constants
MODEL_CONSTANTS = {
    "数值容差": 1e-06,
    "Q1可识别超标幅度Δ": 0.05,
    "Q1情形1显著性水平α1": 0.05,
    "Q1情形2显著性水平α2": 0.10,
    "Q1功效约束β": 0.10,
    "Q1样本量搜索上界": 1000,
    "蒙特卡洛重复次数": 10000,
    "随机种子": 202409,
    "灵敏度扰动幅度": 20,
    "灵敏度扫描置信水平对照值": 0.99,
    "盈亏平衡等高线格点数": 41,
    "正态近似适用下界": 5,
    "决策一致率判定阈值": 0.95,
    "Q4重抽样次数": 2000,
    "Q4置信区间置信水平": 0.95,
    "问题2策略组合数": 16,
    "问题3半成品数": 3,
    "问题3图1节点总数": 12,
}

TOL = MODEL_CONSTANTS["数值容差"]
Q1_DELTA = MODEL_CONSTANTS["Q1可识别超标幅度Δ"]
Q1_ALPHA1 = MODEL_CONSTANTS["Q1情形1显著性水平α1"]
Q1_ALPHA2 = MODEL_CONSTANTS["Q1情形2显著性水平α2"]
Q1_BETA = MODEL_CONSTANTS["Q1功效约束β"]
Q1_N_MAX = MODEL_CONSTANTS["Q1样本量搜索上界"]
MC_REPS = MODEL_CONSTANTS["蒙特卡洛重复次数"]
RANDOM_SEED = MODEL_CONSTANTS["随机种子"]
SENS_AMPLITUDE = MODEL_CONSTANTS["灵敏度扰动幅度"] / 100.0
SENS_CONF_CONTRAST = MODEL_CONSTANTS["灵敏度扫描置信水平对照值"]
BREAKEVEN_GRID = MODEL_CONSTANTS["盈亏平衡等高线格点数"]
NORMAL_APPROX_MIN = MODEL_CONSTANTS["正态近似适用下界"]
CONSISTENCY_THRESHOLD = MODEL_CONSTANTS["决策一致率判定阈值"]
Q4_RESAMPLE = MODEL_CONSTANTS["Q4重抽样次数"]
Q4_CONF_LEVEL = MODEL_CONSTANTS["Q4置信区间置信水平"]
Q2_N_STRATEGIES = MODEL_CONSTANTS["问题2策略组合数"]
Q3_N_SEMI = MODEL_CONSTANTS["问题3半成品数"]
Q3_N_NODES = MODEL_CONSTANTS["问题3图1节点总数"]

# ---------------------------------------------------------------- 绘图数据分辨率
# 非模型常数，仅为账本里的序列长度（供阶段 5 出图取数）
OC_GRID_POINTS = 101
OC_P_MAX = 0.5
SENS_GRID_STEPS = 9
CONF_SWEEP = [0.80, 0.85, 0.88, 0.90, 0.92, 0.94, 0.95, 0.96, 0.97, 0.98, 0.99]
Q3_MC_REPS = 100
BREAKEVEN_X_RANGE = (2.0, 20.0)
BREAKEVEN_Y_RANGE = (1.0, 20.0)

CONSTANT_NOTES = {
    "已登记已启用": sorted(MODEL_CONSTANTS.keys()),
    "已登记未启用": [
        "蒙特卡洛重复次数（问题 2 的稳健性重抽样按 Q4重抽样次数 执行，本键登记为全局上限，本轮未直接启用）",
        "灵敏度扫描置信水平对照值（登记于 DECLARATION，问题 1 的置信度扫描网格 CONF_SWEEP 覆盖该值，未单独启用）",
        "正态近似适用下界（主方案用精确二项，未启用正态近似筛选）",
    ],
    "题面给定值来源": "01-prob-analysis/PROBLEM_FACTS.json",
    "模型常数来源": "02-modeling/DECLARATION.json/model_constants",
}
