@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js 22 or newer from https://nodejs.org/ then reopen this launcher.
  pause
  exit /b 1
)
echo Open http://127.0.0.1:4173 in your browser after the server starts.
node scripts/serve.mjs
pause
