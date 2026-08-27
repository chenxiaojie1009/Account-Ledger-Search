@echo off
setlocal
chcp 65001 >nul
cd /d G:\Account-Ledger-Search-main\backend
pyinstaller --clean --noconfirm Taizhang.spec || exit /b 1
cd ..
copy /Y backend\dist\TaizhangBackend.exe deploy\TaizhangBackend.exe >nul || exit /b 1
echo EXE_DONE