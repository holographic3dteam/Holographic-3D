@echo off
title Holographic 3D - Launcher
echo ================================
echo  Holographic 3D - Launching...
echo ================================
echo.
echo Starting Backend (Flask)...
start "Holographic 3D - Backend" cmd /k "cd /d "D:\Projects\Holographic 3D\flask_app" && C:\Users\rog\AppData\Local\Programs\Python\Python311\python.exe app.py"

echo Waiting for backend to load...
timeout /t 5 /nobreak >nul

echo Starting Frontend (Vite)...
start "Holographic 3D - Frontend" cmd /k "cd /d "D:\Projects\Holographic 3D\holographic-frontend" && npm run dev"

echo.
echo ================================
echo  Both services started!
echo  Backend:  http://localhost:5000
echo  Frontend: http://localhost:5173
echo ================================
echo.
echo Opening browser in 10 seconds...
timeout /t 10 /nobreak >nul
start http://localhost:5173

echo Done! You can close this window.
pause