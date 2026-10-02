@echo off
setlocal
cd /d "%~dp0scale-api"
node --version
if errorlevel 1 goto failed
echo Use only a fresh demo branch or an approved existing installation.
echo First enter the ROTATED owner connection string in scale-api\.env.
echo Startup runs database migrations. It does not migrate the old backend's records.
call npm run env:prepare
if errorlevel 1 goto failed
call npm run env:check
if errorlevel 1 goto failed
docker compose version
if errorlevel 1 goto failed
call npm run neon:up
if errorlevel 1 goto failed
call npm run neon:status
echo.
echo Open the localhost PORT configured in .env, default http://localhost:5000/university
echo Fresh tenant only: cd scale-api then npm run neon:provision
echo Read README-ENV-FIRST.md. Do not run the older startup launchers for this profile.
pause
exit /b 0
:failed
echo Setup stopped. No credential values should be posted in screenshots or chat.
echo Read README-ENV-FIRST.md. Do not bypass scanner or runtime-role checks.
pause
exit /b 1
