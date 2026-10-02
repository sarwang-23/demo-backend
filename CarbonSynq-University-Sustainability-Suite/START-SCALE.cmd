@echo off
cd /d "%~dp0scale-api"
node scripts\setup-env.mjs
if errorlevel 1 goto failure
docker compose up --build -d
if errorlevel 1 goto failure
echo.
echo Scale services requested. Check: docker compose ps
echo Create your first tenant: docker compose run --rm migrate node scripts/provision.mjs
echo Then open http://localhost:8080 using the printed tenant ID and credentials.
echo This local stack is not a public production deployment.
pause
exit /b 0
:failure
echo Setup failed. Check Node, Docker Desktop, network access and the messages above.
pause
exit /b 1
