@echo off
echo Starting Holographic 3D...

start "Flask" cmd /k "cd /d D:\Projects\Holographic 3D\flask_app && set HOLO_EDIT_RES=640 && set PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True && python app.py"

timeout /t 3 /nobreak >nul

start "Vite" cmd /k "cd /d D:\Projects\Holographic 3D\holographic-frontend && npm run dev"

timeout /t 4 /nobreak >nul

start "ngrok" cmd /k "ngrok http https://localhost:5173 --host-header=localhost"

echo All services started!
