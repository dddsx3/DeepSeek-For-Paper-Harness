@echo off
setlocal
title DeepSeek-For-Paper-Harness

where node >nul 2>nul
if errorlevel 1 (
  echo [!] 未检测到 Node.js。请先运行 setup.bat 或安装 Node.js 22+： https://nodejs.org/
  pause
  exit /b 1
)
if not exist "apps\cli\src\bin.ts" (
  echo [!] 请在本仓库根目录运行 start.bat。
  pause
  exit /b 1
)

echo [*] 启动 Web UI： http://127.0.0.1:3080  （Ctrl+C 停止）
call pnpm dph web %*
pause
