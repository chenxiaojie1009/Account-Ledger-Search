@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 台账查找 - 构建最新 APK

echo ============================================
echo   台账查找 APK 一键构建（需要 Android Studio）
echo ============================================
echo.

rem ---- 自动寻找 JDK（优先本机 DevEco Studio 自带 jbr，其次 Android Studio）----
if not defined JAVA_HOME (
  if exist "D:\DEVECO STUDIO\devecostudio-windows-6.1.1.2801\jbr" set "JAVA_HOME=D:\DEVECO STUDIO\devecostudio-windows-6.1.1.2801\jbr"
)
if not defined JAVA_HOME (
  if exist "C:\Program Files\Android\Android Studio\jbr" set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
)
if not defined JAVA_HOME (
  if exist "%LOCALAPPDATA%\Programs\Android Studio\jbr" set "JAVA_HOME=%LOCALAPPDATA%\Programs\Android Studio\jbr"
)
if not defined JAVA_HOME (
  where java >nul 2>nul
  if errorlevel 1 (
    echo [错误] 没有找到 Java/JDK，请安装 Android Studio 或设置 JAVA_HOME。
    pause
    exit /b 1
  )
)
if defined JAVA_HOME echo 使用 JDK: %JAVA_HOME%

where npm >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有找到 npm/Node.js，请先安装 Node.js。
  pause
  exit /b 1
)

echo.
echo [1/3] 同步最新网页资源到 Android 工程...
call npm run cap:sync
if errorlevel 1 goto :err

echo.
echo [2/3] 构建 Debug APK（--offline 使用本地缓存，首次仍可能较慢）...
cd android
call gradlew.bat assembleDebug --offline
if errorlevel 1 goto :err
cd ..

echo.
echo [3/3] 复制 APK 到 dist 目录...
if not exist dist mkdir dist
copy /Y android\app\build\outputs\apk\debug\app-debug.apk dist\taizhang-v4.1.0-debug.apk >nul

echo.
echo ============================================
echo   构建完成！
echo   APK 位置: dist\taizhang-v4.1.0-debug.apk
echo ============================================
pause
exit /b 0

:err
echo.
echo [失败] 构建出错，请查看上方错误信息（通常是 Android SDK 或网络问题）。
pause
exit /b 1