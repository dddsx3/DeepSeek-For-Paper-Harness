# Run 1 invalid — harness-side bug (D-P2-A.1 偏差声明)

本目录是 P2-A 第一次执行的数据,**无效**,不得引用:

- T3 arm 的 runT3Arm 把 call() 的响应信封对象({text,usage})直接传给 admitTemplateFill
  而不是 .text —— JSON.parse 收到 "[object Object]",所有 24 个 T3 首试全部
  假性 t3_schema_violation;
- usage 记录未归一(保留 provider 的 prompt_tokens/completion_tokens),统计段读
  input_tokens/output_tokens 得 0;
- T3.5 arm 部分不受第一个 bug 影响,但同样受 usage bug 影响。

修正为 harness 侧 adapter bug 修复(执行器脚本),不是统计口径变更;预注册的
McNemar 口径(case-bank/README.md)一字未动(禁 P2-A #2 不适用:没有跑完后再挑
统计,是数据本身无效后重跑)。run2 = 修复后的完整重跑。

## Run 2 补充(run2 也部分无效)

run2 的 T3 arm 12 对数据有效(closed 12/12 过、expansion 12/12 semantic_mismatch 拒),但
T3.5 arm 又暴露两个执行器设计 bug(同属 harness 侧,非模型判决、非统计口径变更):

1. 双 slot 在同一 session 里要求两次 SELECT,违反机器单选合同(任一 SELECT 即
   committed)——run3 改为两 slot 顺序各一 session(P1-D 探针同构);
2. expansionPrompt 不带题面,模型无法知道 required 值(albedo-peak 案例提出
   data.user.name 即证据)——run3 修正为带题面与 required 值;
3. trail 的 usage 字段名读错(prompt_tokens vs 归一后 input_tokens)——修正。

run3 = 只重跑 T3.5 arm(24 个),T3 arm 的 run2 数据原样保留。
