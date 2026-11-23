@echo off
rem Actualiza Tiempos desde el DWH. Programarlo en el Programador de tareas (cada hora).
cd /d "%~dp0\.."
python worker\actualizar_tiempos.py >> worker\actualizar_tiempos.log 2>&1
