@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在安装依赖...
pip install -r requirements.txt
echo 正在打包 Exe...
pyinstaller --clean --noconfirm Taizhang.spec
echo 打包完成：backend\dist\TaizhangBackend.exe
echo 复制该 Exe 到 deploy 目录即可部署。
pause
