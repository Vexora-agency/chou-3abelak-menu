@echo off
REM One-port local server: site + API on http://localhost:3000
cd /d "%~dp0"
echo Building the site...
call npm run build
if errorlevel 1 (
  echo Build failed. Fix the errors above and run again.
  pause
  exit /b 1
)
echo.
echo Starting server on http://localhost:3000  (Menu: /  Admin: /#admin)
echo Keep this window open. Press Ctrl+C to stop.
npx wrangler pages dev ./dist --port 3000 --kv MENU_KV --d1 ORDERS_DB
pause
