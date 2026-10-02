@echo off
setlocal
cd /d "%~dp0scale-api"
node --version
if errorlevel 1 goto failed
docker compose version
if errorlevel 1 goto failed
call npm run setup
if errorlevel 1 goto failed
docker compose up --build -d
if errorlevel 1 goto failed
echo.
echo Open http://localhost:8080/operations
echo Fresh installation only: docker compose run --rm migrate node scripts/provision.mjs
echo Existing installation: preserve credentials and follow docs/operations/UPGRADE.md.
pause
exit /b 0
:failed
echo Startup stopped. Fix the error above. Do not bypass scanner or permission checks.
pause
exit /b 1
