@echo off
rem Start Schwingt and open it in the default browser.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies, first run only...
  call npm install
)
start "" http://localhost:5173/
call npm run dev
