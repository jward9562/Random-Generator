@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required, as for Start-Prototype.cmd.
  pause
  exit /b 1
)
node scripts/validate-data.mjs database/real
pause
