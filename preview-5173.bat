@echo off
REM Quick visual preview (site + admin UI, no login) on http://localhost:5173
REM Uses the bundled seed menu. Admin saving needs the backend — use
REM serve-local.bat for that. Nothing here touches production.
REM Admin (no login): http://localhost:5173/?dev-admin#admin
cd /d "%~dp0"
echo Preview at http://localhost:5173/  (Admin, no login: http://localhost:5173/?dev-admin#admin)
echo Keep this window open. Press Ctrl+C to stop.
npx vite --port 5173 --host 127.0.0.1
pause
