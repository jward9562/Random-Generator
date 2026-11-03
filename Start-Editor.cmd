@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required, as for Start-Prototype.cmd.
  pause
  exit /b 1
)
echo Open http://127.0.0.1:4174 after the editor starts.
node scripts/edit-database.mjs
pause
