@echo off
setlocal
chcp >nul 2>&1
title DeepSeek-For-Paper-Harness setup

rem ---- 1. Node.js 预检 ----
where node >nul 2>nul
if errorlevel 1 (
  echo [!] 未检测到 Node.js。请先安装 Node.js 22 LTS 或更高版本：
  echo     https://nodejs.org/  （或执行： winget install OpenJS.NodeJS.LTS ^)
  pause
  exit /b 1
)
for /f "delims=v" %%v in ('node -p process.versions.node') do set NODE_MAJOR=%%v
echo [ok] Node.js %NODE_MAJOR%

rem ---- 2. Corepack / pnpm 预检 ----
where corepack >nul 2>nul
if errorlevel 1 (
  echo [!] 未检测到 corepack。Node.js 22 自带 corepack；请确认安装的是官方 Node.js。
  pause
  exit /b 1
)
echo [*] 启用 corepack（pnpm 包管理器）...
call corepack enable
if errorlevel 1 (
  echo [!] corepack enable 失败。可尝试以管理员身份运行本脚本，或手动执行： npm i -g pnpm@11
  pause
  exit /b 1
)

rem ---- 3. 安装依赖 ----
echo [*] pnpm install ...
call pnpm install
if errorlevel 1 (
  echo [!] pnpm install 失败，请检查网络后重试。
  pause
  exit /b 1
)

rem ---- 4. 构建 ----
echo [*] pnpm run build （首次构建较慢，请耐心等待）...
call pnpm run build
if errorlevel 1 (
  echo [!] 构建失败，请把上方报错反馈给维护者。
  pause
  exit /b 1
)

echo.
echo [ok] 安装与构建完成。接下来：
echo   1) 复制 .env.example 为 .env 并填入 DEEPSEEK_API_KEY
echo   2) 双击 start.bat 启动，浏览器打开 http://127.0.0.1:3080
pause
