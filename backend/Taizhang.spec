# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller 打包配置：生成单文件 TaizhangBackend.exe"""
from pathlib import Path
from PyInstaller.utils.hooks import collect_submodules, collect_data_files

repo_root = Path(SPECPATH).resolve().parent  # SPECPATH = backend 目录，其父目录为项目根
admin_web_dir = Path(SPECPATH).resolve() / 'admin_web'
datas = collect_data_files('fastapi') + [(str(admin_web_dir), 'admin_web')]
hiddenimports = (
    collect_submodules('uvicorn')
    + collect_submodules('fastapi')
    + collect_submodules('sqlalchemy')
    + collect_submodules('bcrypt')
    + ['jwt', 'email_validator', 'fitz', 'pymupdf']
)

a = Analysis(
    ['main.py'],
    pathex=[str(repo_root)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='TaizhangBackend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,          # 无黑框，配合 启动.vbs 静默运行
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
