@echo off
setlocal
cd /d "%~dp0scale-api"
where node >nul 2>nul || (echo Install Node.js before continuing. & pause & exit /b 1)
where docker >nul 2>nul || (echo Install and start Docker with Compose before continuing. & pause & exit /b 1)
call npm run setup
if errorlevel 1 goto failed
docker compose up --build -d
if errorlevel 1 goto failed
echo.
echo Open http://localhost:8080/university after the services are ready.
echo For a NEW university only, run:
echo docker compose run --rm migrate node scripts/provision.mjs
echo Existing installations: do not create a duplicate tenant. Read docs/university/UPGRADE.md.
echo Keep printed credentials private. No default password is provided.
pause
exit /b 0
:failed
echo Setup did not complete. Read the error above and docs/university/UPGRADE.md.
pause
exit /b 1
