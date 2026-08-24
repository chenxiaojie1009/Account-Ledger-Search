@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist TaizhangBackend.exe (
  start "" TaizhangBackend.exe
  timeout /t 3 >nul
  start "" http://127.0.0.1:10600/admin
) else (
  start "" "..\node" server.js
  timeout /t 2 >nul
  start "" http://127.0.0.1:10600
)
