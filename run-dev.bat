@echo off
echo Iniciando UFAMA con optimizaciones de memoria...
set NODE_OPTIONS=--max-old-space-size=2048
set NEXT_TELEMETRY_DISABLED=1
npm run dev
pause
