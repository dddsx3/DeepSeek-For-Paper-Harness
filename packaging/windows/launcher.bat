@echo off
setlocal
title DeepSeek-For-Paper-Harness (portable)

rem Portable launcher: prefers the bundled runtime, falls back to PATH.
set "APP_DIR=%~dp0"
set "NODE_DIR=%APP_DIR%node"

if exist "%NODE_DIR%\node.exe" (
  set "PATH=%NODE_DIR%;%PATH%"
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo [!] Node.js was not found. Install Node.js 22+ from https://nodejs.org/
    pause
    exit /b 1
  )
)

cd /d "%APP_DIR%"

if "%DPH_WEB_PORT%"=="" set "DPH_WEB_PORT=3080"

echo [*] Starting Web UI on http://127.0.0.1:%DPH_WEB_PORT%  (Ctrl+C to stop)
if exist "%APP_DIR%apps\cli\src\bin.ts" (
  rem Source checkout: run through the tsx launcher (requires one-time setup.bat).
  call pnpm dph web --no-open --port %DPH_WEB_PORT% %*
) else if exist "%APP_DIR%cli\bin.js" (
  node "%APP_DIR%cli\bin.js" web --no-open --port %DPH_WEB_PORT% %*
) else (
  echo [!] No runnable entry found. Run setup.bat first, or rebuild the package.
  pause
  exit /b 1
)
pause
