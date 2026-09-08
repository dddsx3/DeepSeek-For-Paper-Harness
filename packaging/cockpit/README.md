# paper-cockpit v0.1-pilot — 便携包打包装配说明(操作者手册)

## 给学生的一页话

双击仓库根的 **paper-cockpit.exe**(或 `启动驾驶舱.cmd` 兜底),浏览器会自动
打开操作页面——拖题目、点开始、下载报告,全程不碰命令行。关闭那个黑窗口 =
停止驾驶舱。

## 打包(操作者,一次性)

exe 是 Node SEA 单文件启动器(launcher.cjs),但引擎代码仍在仓库目录里——
便携包 = 以下清单整体拷贝(或 zip),学生解压后双击 exe:

```
paper-cockpit.exe                    ← SEA 启动器(构建见下)
启动驾驶舱.cmd                        ← 杀软拦截 exe 时的兜底入口
apps/cockpit/server.mjs              ← 投影层
apps/cockpit/public/                 ← 驾驶舱页面(index.html + app.js)
apps/paper-shell/src/                ← shell(cli.ts/invoke.ts/study-manifest.ts;
                                        cockpit 生成物持久化在其 src/ 下)
packages/paper/paper-foundation/     ← 引擎 lib(lib/ 构建产物 + package.json)
packages/*/…                         ← workspace 依赖的 lib/ 产物
node_modules/                        ← 依赖(或按 release 清单裁剪)
artifacts/handoff/TASK-M1/samples/   ← 一键演示题
artifacts/handoff/TASK-P2/           ← study-manifest 模板 + 定价表
runtime/node.exe                     ← 可选便携 Node(目标机无 Node 时必需)
```

> 简化路径:整仓 zip(.git 除外;node_modules 可用 `pnpm install --prod` 重装)
> + runtime/node.exe + paper-cockpit.exe。

## exe 构建(升级 launcher 后)

```bash
node --experimental-sea-config sea-config.json     # sea-config.json 在仓库根
cp "$(which node)" paper-cockpit.exe
npx postject paper-cockpit.exe NODE_SEA_BLOB sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 --overwrite
```

注意:重打包前必须结束所有 paper-cockpit.exe 实例(文件句柄占用会报
Couldn't write)。exe 是未签名构建 —— 杀软若拦,走 启动驾驶舱.cmd 兜底,
或在系统里加一次信任(发布签名属后续 release 流程)。

## 装机自检(等价 G9)

双击 exe → 页面自动打开 → 点"一键演示" → 约 30 秒后进度时间线走完且交付区
出现报告 → 完成(无需 key)。
