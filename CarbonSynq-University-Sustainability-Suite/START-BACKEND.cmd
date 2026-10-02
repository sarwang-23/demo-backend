@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. See README.md for the runtime requirements.
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);if(!((a===22&&b>=16)||a>=24)){console.error('Use Node.js 22.16+ in the 22.x line, or 24+.');process.exit(1)}"
if errorlevel 1 (
  pause
  exit /b 1
)
echo Starting CarbonSynq local backend. No npm install is needed.
echo Default address: http://localhost:5050
node server.mjs
pause
