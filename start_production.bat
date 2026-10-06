@echo off
echo ==========================================
echo    Starting Tender Scraper Production
echo ==========================================
echo.
echo Make sure PostgreSQL is running locally!
echo.

echo Starting Backend...
start "Tender Scraper - Backend" cmd /k "cd backend && set NODE_ENV=production && npm start"

echo Starting Frontend...
start "Tender Scraper - Frontend" cmd /k "cd frontend && npm start"

echo.
echo Servers are booting up...
echo.
echo Access your dashboard at: http://localhost:3000
echo.
pause
