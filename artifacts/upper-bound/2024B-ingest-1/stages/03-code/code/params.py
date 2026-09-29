"""Stage 3 parameters transcribed from the upstream problem facts and model declaration.

All monetary values use yuan per item, all defect probabilities are fractions, and
Q4 observations remain unavailable, so Q4 is explicitly a reproducible scenario
analysis rather than a real-batch re-estimation.
"""

from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True)
class Q2Case:
    """Flat, immutable parameter record for one row of problem 2, Table 1."""

    p1: float
    price1: float
    test1: float
    p2: float
    price2: float
    test2: float
    pf: float
    assembly_cost: float
    product_test_cost: float
    market_price: float
    exchange_loss: float
    disassembly_cost: float
    case_id: int = 0

    @property
    def part1_defect(self) -> float:
        return self.p1

    @property
    def part2_defect(self) -> float:
        return self.p2

    @property
    def product_defect(self) -> float:
        return self.pf

    @property
    def a1(self) -> float:
        return self.price1

    @property
    def t1(self) -> float:
        return self.test1

    @property
    def a2(self) -> float:
        return self.price2

    @property
    def t2(self) -> float:
        return self.test2

    @property
    def kf(self) -> float:
        return self.assembly_cost

    @property
    def tf(self) -> float:
        return self.product_test_cost

    @property
    def rmarket(self) -> float:
        return self.market_price

    @property
    def lexchange(self) -> float:
        return self.exchange_loss

    @property
    def gdis(self) -> float:
        return self.disassembly_cost

    @property
    def rate_vector(self) -> tuple[float, float, float]:
        return self.p1, self.p2, self.pf

    def as_nested_dict(self) -> dict[str, dict[str, float]]:
        return {
            "part1": {
                "p": self.p1,
                "price": self.price1,
                "test": self.test1,
            },
            "part2": {
                "p": self.p2,
                "price": self.price2,
                "test": self.test2,
            },
            "product": {
                "p": self.pf,
                "assembly_cost": self.assembly_cost,
                "test_cost": self.product_test_cost,
            },
            "market_price": self.market_price,
            "exchange_loss": self.exchange_loss,
            "disassembly_cost": self.disassembly_cost,
        }

    def __getitem__(self, key: str) -> Any:
        aliases = {
            "p1": "p1",
            "part1_defect": "p1",
            "part1_p": "p1",
            "price1": "price1",
            "a1": "price1",
            "part1_price": "price1",
            "test1": "test1",
            "t1": "test1",
            "part1_test": "test1",
            "p2": "p2",
            "part2_defect": "p2",
            "part2_p": "p2",
            "price2": "price2",
            "a2": "price2",
            "part2_price": "price2",
            "test2": "test2",
            "t2": "test2",
            "part2_test": "test2",
            "pf": "pf",
            "product_defect": "pf",
            "p_final": "pf",
            "assembly_cost": "assembly_cost",
            "kf": "assembly_cost",
            "assembly": "assembly_cost",
            "product_test_cost": "product_test_cost",
            "tf": "product_test_cost",
            "final_test": "product_test_cost",
            "market_price": "market_price",
            "rmarket": "market_price",
            "sale_price": "market_price",
            "exchange_loss": "exchange_loss",
            "lexchange": "exchange_loss",
            "replacement_loss": "exchange_loss",
            "disassembly_cost": "disassembly_cost",
            "gdis": "disassembly_cost",
            "disassembly": "disassembly_cost",
            "case_id": "case_id",
        }
        if key == "part1":
            return {
                "p": self.p1,
                "price": self.price1,
                "test": self.test1,
            }
        if key == "part2":
            return {
                "p": self.p2,
                "price": self.price2,
                "test": self.test2,
            }
        try:
            return getattr(self, aliases[key])
        except KeyError as exc:
            raise KeyError(key) from exc


Q2_CASES = (
    Q2Case(0.10, 4, 2, 0.10, 18, 3, 0.10, 6, 3, 56, 6, 5, 1),
    Q2Case(0.20, 4, 2, 0.20, 18, 3, 0.20, 6, 3, 56, 6, 5, 2),
    Q2Case(0.10, 4, 2, 0.10, 18, 3, 0.10, 6, 3, 56, 30, 5, 3),
    Q2Case(0.20, 4, 1, 0.20, 18, 1, 0.20, 6, 2, 56, 30, 5, 4),
    Q2Case(0.10, 4, 8, 0.20, 18, 1, 0.10, 6, 2, 56, 10, 5, 5),
    Q2Case(0.05, 4, 2, 0.05, 18, 3, 0.05, 6, 3, 56, 10, 40, 6),
)


@dataclass(frozen=True)
class Q3Part:
    number: int
    p: float
    price: float
    test: float

    @property
    def defect_rate(self) -> float:
        return self.p

    @property
    def purchase_price(self) -> float:
        return self.price

    @property
    def inspection_cost(self) -> float:
        return self.test

    def __getitem__(self, key: str) -> Any:
        aliases = {
            "number": self.number,
            "id": self.number,
            "p": self.p,
            "defect_rate": self.p,
            "price": self.price,
            "purchase_price": self.price,
            "test": self.test,
            "inspection_cost": self.test,
        }
        return aliases[key]


@dataclass(frozen=True)
class Q3AssemblyNode:
    number: int
    p: float
    assembly_cost: float
    test: float
    disassembly_cost: float

    @property
    def defect_rate(self) -> float:
        return self.p

    @property
    def inspection_cost(self) -> float:
        return self.test

    def __getitem__(self, key: str) -> Any:
        aliases = {
            "number": self.number,
            "id": self.number,
            "p": self.p,
            "defect_rate": self.p,
            "assembly_cost": self.assembly_cost,
            "test": self.test,
            "inspection_cost": self.test,
            "disassembly_cost": self.disassembly_cost,
        }
        return aliases[key]


@dataclass(frozen=True)
class Q3Product:
    p: float
    assembly_cost: float
    test: float
    disassembly_cost: float
    market_price: float
    exchange_loss: float

    @property
    def defect_rate(self) -> float:
        return self.p

    @property
    def inspection_cost(self) -> float:
        return self.test

    def __getitem__(self, key: str) -> Any:
        aliases = {
            "p": self.p,
            "defect_rate": self.p,
            "assembly_cost": self.assembly_cost,
            "kf": self.assembly_cost,
            "test": self.test,
            "inspection_cost": self.test,
            "tf": self.test,
            "disassembly_cost": self.disassembly_cost,
            "market_price": self.market_price,
            "rmarket": self.market_price,
            "exchange_loss": self.exchange_loss,
            "lexchange": self.exchange_loss,
        }
        return aliases[key]


# Problem 1: exact binomial design and registered risk parameters.
Q1_P0 = 0.10
Q1_ALPHA_REJECT = 0.05
Q1_REJECT_ALPHA = Q1_ALPHA_REJECT
Q1_REJECT_CONFIDENCE = 0.95
Q1_CONF_ACCEPT = 0.90
Q1_ACCEPT_CONFIDENCE = Q1_CONF_ACCEPT
Q1_ACCEPT_ALPHA = 0.10
Q1_DELTA = 0.05
Q1_BETA = 0.10
Q1_ALTERNATIVE_DELTA = Q1_DELTA
Q1_POWER_DELTA = Q1_DELTA
Q1_DELTA_GRID = (0.02, 0.05, 0.10)
Q1_BETA_GRID = (0.05, 0.10, 0.20)
Q1_NUMERIC_TOL = 1e-12
Q1_PRECISION_TOL = Q1_NUMERIC_TOL
Q1_TOL = Q1_NUMERIC_TOL

Q1可识别超标幅度 = Q1_DELTA
Q1第二类错误上限 = Q1_BETA
Q1超标幅度灵敏度网格 = Q1_DELTA_GRID
Q1第二类错误灵敏度网格 = Q1_BETA_GRID
Q1精确枚举数值容差 = Q1_NUMERIC_TOL

# Problem 2: strategy-space, reachability, and numerical acceptance constants.
Q2_STRATEGY_SPACE_SIZE = 16
Q2_POLICY_SPACE_SIZE = Q2_STRATEGY_SPACE_SIZE
Q2_PARAMETER_NODE_COUNT = 3
Q2_INVENTORY_STATE_LIMIT = 9
CASHFLOW_ABS_TOL = 1e-6
VALUE_ITERATION_TOL = 1e-10
VALUE_ITERATION_MAX_ITER = 100000
SCRAP_SALVAGE_VALUE = 0.0
Q2_CASHFLOW_ABS_TOL = CASHFLOW_ABS_TOL
Q2_VALUE_TOL = VALUE_ITERATION_TOL
Q2_MAX_ITERATIONS = VALUE_ITERATION_MAX_ITER
Q2_SCRAP_SALVAGE_VALUE = SCRAP_SALVAGE_VALUE
现金流核验绝对容差 = CASHFLOW_ABS_TOL
价值迭代收敛容差 = VALUE_ITERATION_TOL
价值迭代最大轮数 = VALUE_ITERATION_MAX_ITER
报废回收价值 = SCRAP_SALVAGE_VALUE

# Problem 3: Table 2 facts. The official Figure 1 edge list was not supplied.
Q3_PARTS = (
    Q3Part(1, 0.10, 2, 1),
    Q3Part(2, 0.10, 8, 1),
    Q3Part(3, 0.10, 12, 2),
    Q3Part(4, 0.10, 2, 1),
    Q3Part(5, 0.10, 8, 1),
    Q3Part(6, 0.10, 12, 2),
    Q3Part(7, 0.10, 8, 1),
    Q3Part(8, 0.10, 12, 2),
)
Q3_SEMIS = (
    Q3AssemblyNode(1, 0.10, 8, 4, 6),
    Q3AssemblyNode(2, 0.10, 8, 4, 6),
    Q3AssemblyNode(3, 0.10, 8, 4, 6),
)
Q3_PRODUCT_NODE = Q3Product(0.10, 8, 6, 10, 200, 40)
Q3_PRODUCT = Q3_PRODUCT_NODE
Q3_FINAL_PRODUCT = Q3_PRODUCT_NODE
Q3_SEMI_NODES = Q3_SEMIS
Q3_SEMIPRODUCTS = Q3_SEMIS
Q3_PRODUCT_PARAMETERS = asdict(Q3_PRODUCT_NODE)
Q3_PART_PARAMETERS = tuple(asdict(part) for part in Q3_PARTS)
Q3_SEMI_PARAMETERS = tuple(asdict(node) for node in Q3_SEMIS)

Q3_OFFICIAL_EDGE_LIST = None
Q3_OFFICIAL_GRAPH = None
Q3_GRAPH_AVAILABLE = False
Q3_SCENARIO_ONLY = True
Q3_PRIMARY_EDGE_LIST = {
    "半成品1": [1, 2, 3],
    "半成品2": [4, 5, 6],
    "半成品3": [7, 8],
    "成品": ["半成品1", "半成品2", "半成品3"],
}
Q3_ALTERNATIVE_EDGE_LIST = {
    "半成品1": [1, 2],
    "半成品2": [3, 4],
    "半成品3": [5, 6, 7, 8],
    "成品": ["半成品1", "半成品2", "半成品3"],
}
Q3_INFERRED_PRIMARY_EDGE_LIST = Q3_PRIMARY_EDGE_LIST
Q3_PRIMARY_TOPOLOGY = Q3_PRIMARY_EDGE_LIST
Q3_ALTERNATIVE_TOPOLOGY = Q3_ALTERNATIVE_EDGE_LIST
Q3_PRIMARY_PARENT_MAP = {
    "semi1": [1, 2, 3],
    "semi2": [4, 5, 6],
    "semi3": [7, 8],
    "product": ["semi1", "semi2", "semi3"],
}
Q3_ALTERNATIVE_PARENT_MAP = {
    "semi1": [1, 2],
    "semi2": [3, 4],
    "semi3": [5, 6, 7, 8],
    "product": ["semi1", "semi2", "semi3"],
}
Q3_PARAMETER_NODE_COUNT = 12
Q3_EFFECTIVE_STRATEGY_COUNT = 65536
Q3_POLICY_SPACE_SIZE = Q3_EFFECTIVE_STRATEGY_COUNT
Q3_REACHABLE_STATE_LIMIT = 531441
Q3_INVENTORY_STATE_LIMIT = Q3_REACHABLE_STATE_LIMIT
Q3_NETWORK_STATE_LIMIT = Q3_REACHABLE_STATE_LIMIT
Q3_MARKET_PRICE = Q3_PRODUCT_NODE.market_price
Q3_EXCHANGE_LOSS = Q3_PRODUCT_NODE.exchange_loss
Q3_ROOT_ASSEMBLY_COST = Q3_PRODUCT_NODE.assembly_cost
Q3_ROOT_INSPECTION_COST = Q3_PRODUCT_NODE.test
Q3_ROOT_DISASSEMBLY_COST = Q3_PRODUCT_NODE.disassembly_cost

# Problem 4: no real (n_v, x_v) observations are available.
Q4_ACTUAL_SAMPLES_AVAILABLE = False
Q4_SCENARIO_ONLY = True
Q4_ACTUAL_SAMPLES_Q2 = None
Q4_ACTUAL_SAMPLES_Q3 = None
Q4_OBSERVED_SAMPLES_Q2 = None
Q4_OBSERVED_SAMPLES_Q3 = None

Q4_JOINT_CONFIDENCE = 0.95
Q4_CONFIDENCE_LEVEL = Q4_JOINT_CONFIDENCE
Q4_FAMILY_ALPHA = 0.05
Q4_ALPHA_FAMILY = Q4_FAMILY_ALPHA
Q4_ALPHA_JOINT = 0.00416666666666667
Q4_Q3_MARGINAL_ALPHA = Q4_ALPHA_JOINT
Q4_Q2_MARGINAL_ALPHA = 0.0166666666666667
Q4_MARGINAL_ALPHA_Q2 = Q4_Q2_MARGINAL_ALPHA
Q4_MARGINAL_ALPHA_Q3 = Q4_Q3_MARGINAL_ALPHA
Q4_WIDTH_TARGET = 0.10
Q4_CI_WIDTH_TARGET = Q4_WIDTH_TARGET
Q4_N_MAX = 1000
Q4_SINGLE_PARAMETER_N_MAX = Q4_N_MAX
Q4_N_GRID = (50, 100, 200, 400, 800)
Q4_SAMPLE_SIZE_GRID = Q4_N_GRID
Q4_REPLICATES = 10000
Q4_MC_REPETITIONS = Q4_REPLICATES
Q4_SCENARIO_REPETITIONS = Q4_REPLICATES
Q4_RANDOM_SEED = 202409
Q4_SEED = Q4_RANDOM_SEED
Q4_JEFFREYS_ALPHA = 0.50
Q4_JEFFREYS_BETA = 0.50
Q4_JEFFREYS_A = Q4_JEFFREYS_ALPHA
Q4_JEFFREYS_B = Q4_JEFFREYS_BETA
Q4_CONSISTENCY_THRESHOLD = 0.90

Q4_Q2_NODE_NAMES = ("p1", "p2", "pf")
Q4_Q3_NODE_NAMES = (
    "part1",
    "part2",
    "part3",
    "part4",
    "part5",
    "part6",
    "part7",
    "part8",
    "semi1",
    "semi2",
    "semi3",
    "product",
)
Q3_SCENARIO_NODE_NAMES = Q4_Q3_NODE_NAMES
Q3_SCENARIO_RATES = {
    "part1": 0.10,
    "part2": 0.10,
    "part3": 0.10,
    "part4": 0.10,
    "part5": 0.10,
    "part6": 0.10,
    "part7": 0.10,
    "part8": 0.10,
    "semi1": 0.10,
    "semi2": 0.10,
    "semi3": 0.10,
    "product": 0.10,
}
Q4_Q3_SCENARIO_RATES = Q3_SCENARIO_RATES
Q4_SAMPLING_DESCRIPTION = (
    "各参数节点按Clopper-Pearson区间总宽度目标独立选择样本量；"
    "无真实观测时，以登记情景率为生成中心独立抽取二项计数x_v，"
    "点估计为x_v/n_v；重抽样从Beta(x_v+0.5,n_v-x_v+0.5)后验独立抽取参数，"
    "并在每次抽样后重新优化策略。所有结果均标记为scenario_only。"
)

RELATIVE_SENSITIVITY_GRID = (-0.20, -0.10, 0.0, 0.10, 0.20)
Q2_SENSITIVITY_GRID = RELATIVE_SENSITIVITY_GRID
Q3_SENSITIVITY_GRID = RELATIVE_SENSITIVITY_GRID

REGISTERED_MODEL_CONSTANTS = {
    "Q1标称次品率": Q1_P0,
    "Q1拒收第一类错误上限": Q1_ALPHA_REJECT,
    "Q1接收置信水平": Q1_CONF_ACCEPT,
    "Q1可识别超标幅度": Q1_DELTA,
    "Q1第二类错误上限": Q1_BETA,
    "Q1超标幅度灵敏度网格": Q1_DELTA_GRID,
    "Q1第二类错误灵敏度网格": Q1_BETA_GRID,
    "Q1精确枚举数值容差": Q1_NUMERIC_TOL,
    "报废回收价值": SCRAP_SALVAGE_VALUE,
    "Q2策略空间规模": Q2_STRATEGY_SPACE_SIZE,
    "Q2库存状态上限": Q2_INVENTORY_STATE_LIMIT,
    "现金流核验绝对容差": CASHFLOW_ABS_TOL,
    "价值迭代收敛容差": VALUE_ITERATION_TOL,
    "价值迭代最大轮数": VALUE_ITERATION_MAX_ITER,
    "Q3主情景有效策略数": Q3_EFFECTIVE_STRATEGY_COUNT,
    "Q3可达库存状态上限": Q3_REACHABLE_STATE_LIMIT,
    "Q4联合置信水平": Q4_JOINT_CONFIDENCE,
    "Q4联合族错误率": Q4_FAMILY_ALPHA,
    "Q2参数节点数": Q2_PARAMETER_NODE_COUNT,
    "Q3参数节点数": Q3_PARAMETER_NODE_COUNT,
    "Q4-Q2 Bonferroni边际错误率": Q4_Q2_MARGINAL_ALPHA,
    "Q4-Q3 Bonferroni边际错误率": Q4_Q3_MARGINAL_ALPHA,
    "Q4区间总宽度目标": Q4_WIDTH_TARGET,
    "Q4单参数样本量上限": Q4_N_MAX,
    "Q4样本量扫描网格": Q4_N_GRID,
    "Q4情景蒙特卡洛重复次数": Q4_REPLICATES,
    "Q4随机种子": Q4_RANDOM_SEED,
    "Q4 Jeffreys先验α": Q4_JEFFREYS_ALPHA,
    "Q4 Jeffreys先验β": Q4_JEFFREYS_BETA,
    "Q4决策一致率门槛": Q4_CONSISTENCY_THRESHOLD,
    "相对灵敏度扫描网格": RELATIVE_SENSITIVITY_GRID,
}