@echo off
rem Actualiza Tiempos desde el DWH. Programarlo en el Programador de tareas (cada hora).
cd /d "%~dp0\.."
python worker\actualizar_tiempos.py >> worker\actualizar_tiempos.log 2>&1
rem Estado de la última corrida para revisarlo rápido (OK o FALLO con la fecha)
if errorlevel 1 (echo FALLO %date% %time%> worker\estado_ultima_carga.txt) else (echo OK %date% %time%> worker\estado_ultima_carga.txt)
