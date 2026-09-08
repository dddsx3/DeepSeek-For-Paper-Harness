@echo off
chcp 65001 >nul
title Paper Cockpit · 论文实测驾驶舱
echo.
echo   ==============================================
echo    Paper Cockpit  ·  论文实测驾驶舱 (cmd 兜底入口)
echo   ==============================================
echo    若 paper-cockpit.exe 双击无反应(如杀软拦截),用本入口。
echo    正在启动,页面将自动打开…
echo.

rem 优先用仓库旁的便携 runtime,其次 PATH 里的 node
set NODE_EXE=runtime\node.exe
if not exist "%NODE_EXE%" set NODE_EXE=node

cd /d "%~dp0"
start "paper-cockpit-server" /min cmd /c ""%NODE_EXE%" --import tsx/esm apps\cockpit\server.mjs"
timeout /t 6 /nobreak >nul
start "" http://127.0.0.1:3081/
echo    已发出打开页面的请求。若浏览器未自动打开,访问 http://127.0.0.1:3081/
echo    服务窗口已最小化在任务栏;关闭它 = 停止驾驶舱。
echo.
pause
