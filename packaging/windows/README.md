# Windows portable packaging (SFX)

English | [简体中文](#简体中文)

Build a "double-click" Windows payload of DeepSeek-For-Paper-Harness.

## Prerequisites (build machine)

1. A completed build: `pnpm install && pnpm run build` at the repo root.
2. Optional: portable Node win-x64 zip from nodejs.org (Windows Binary .zip). Bundling it frees end users from an installed Node.
3. Optional: 7-Zip (`7z`) for the final self-extracting exe.

## Assemble

`powershell -ExecutionPolicy Bypass -File packaging\windows\make-portable.ps1 -NodeZip C:\downloads\node-v22-win-x64.zip`

Payload lands in `dist-portable\app`: source + built artifacts + launcher.bat (+ node\ with -NodeZip). End users double-click launcher.bat; the Web UI serves http://127.0.0.1:3080.

Without bundled Node the payload expects one-time setup.bat on the target machine (network). -IncludeNodeModules attempts an offline dependency tree — experimental, validate on a clean VM.

## Wrap into SFX

`powershell -File packaging\windows\make-portable.ps1 -NodeZip ... -MakeSfx -SevenZip "C:\Program Files\7-Zip\7z.exe"`

or manually: `7z a -sfx -y DeepSeek-For-Paper-Harness-portable.exe .\dist-portable\app\*`

`packaging\windows\sfx-config.txt` customizes dialogs (module syntax per 7-Zip docs).

## Acceptance checklist (clean Win10/11 VM)

- [ ] Extract via double-click; launcher.bat starts without "node is not recognized", missing modules, or port conflicts
- [ ] Browser opens http://127.0.0.1:3080 and the page title shows DeepSeek-For-Paper-Harness
- [ ] With .env (DEEPSEEK_API_KEY) a full plan-to-deliver run completes
- [ ] Payload contains no .git, no real .env, no dev leftovers
- [ ] Uninstall = delete folder; zero registry/service residue

---

# 简体中文

构建机完成 `pnpm install && pnpm run build` 后运行：

`powershell -ExecutionPolicy Bypass -File packaging\windows\make-portable.ps1 -NodeZip <便携版node的zip路径>`

产物在 `dist-portable\app`。目标机器双击 `launcher.bat` 启动 Web UI（默认 http://127.0.0.1:3080）。安装 7-Zip 后加 `-MakeSfx` 直接产出自解压 exe，否则按脚本打印的 `7z a -sfx ...` 手动打包。

离线依赖（`-IncludeNodeModules`）为实验特性：pnpm 链接结构不能简单拷贝，脚本会跳过 junction 并在载荷内用便携 Node 执行离线修复——发布前务必在全新虚拟机验证。交付回归清单见上文英文部分。
