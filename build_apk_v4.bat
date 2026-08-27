@echo off
setlocal
chcp 65001 >nul
cd /d G:\Account-Ledger-Search-main
call npm run cap:sync || exit /b 1
cd android
call gradlew.bat assembleDebug --offline || exit /b 1
cd ..
if not exist dist mkdir dist
copy /Y android\app\build\outputs\apk\debug\app-debug.apk dist\taizhang-v4.0.0-debug.apk >nul || exit /b 1
echo APK_DONE