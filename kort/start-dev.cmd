@echo off
rem Double-click launcher for the KORT dev servers (API + web, hot reload).
rem Set KORT_OPEN_BROWSER=0 before launching to keep the browser closed.
setlocal EnableExtensions
title KORT dev
cd /d "%~dp0"

echo.
echo   KORT dev launcher
echo   -----------------
echo.

where node.exe >nul 2>nul
if errorlevel 1 goto :missing_node

set "PNPM="
where pnpm.cmd >nul 2>nul && set "PNPM=pnpm.cmd"
if not defined PNPM if exist "%APPDATA%\npm\pnpm.cmd" set "PNPM=%APPDATA%\npm\pnpm.cmd"
if not defined PNPM goto :missing_pnpm

if not exist "..\.venv\Scripts\python.exe" goto :missing_venv

set "NEED_INSTALL="
if not exist "node_modules\.bin\concurrently.cmd" set "NEED_INSTALL=1"
if not exist "apps\web\node_modules\next\package.json" set "NEED_INSTALL=1"
if defined NEED_INSTALL (
  echo [setup] Installing workspace dependencies with pnpm...
  call "%PNPM%" install
  if errorlevel 1 goto :install_failed
)

if not defined KORT_OPEN_BROWSER set "KORT_OPEN_BROWSER=1"

echo [dev] Web  http://127.0.0.1:3000
echo [dev] API  http://127.0.0.1:8000/docs
echo [dev] Starting both servers; the browser opens once the web app answers.
echo [dev] Press Ctrl+C or close this window to stop them.
echo.

call "%PNPM%" run dev
set "EXITCODE=%ERRORLEVEL%"
echo.
if not "%EXITCODE%"=="0" echo [dev] Servers exited with code %EXITCODE%.
pause
exit /b %EXITCODE%

:missing_node
echo [error] Node.js was not found on PATH.
echo         Install Node.js 22 or newer, then run this file again.
goto :fail

:missing_pnpm
echo [error] pnpm was not found on PATH.
echo         Install it with: npm install -g pnpm@10.10.0
goto :fail

:missing_venv
echo [error] The Python virtualenv is missing at ..\.venv
echo         Create it once from this folder:
echo             python -m venv ..\.venv
echo             ..\.venv\Scripts\python.exe -m pip install -e "apps\api[dev]"
goto :fail

:install_failed
echo [error] pnpm install failed. Fix the error above, then run this file again.
goto :fail

:fail
echo.
pause
exit /b 1
