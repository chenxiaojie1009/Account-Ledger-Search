"""SQLite 数据库配置（FastAPI 版台账查找后端）"""
import sys
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

from backend import config


def _base_dir():
    if getattr(sys, 'frozen', False):
        return Path(getattr(sys, '_MEIPASS', Path(sys.executable).parent))
    return Path(__file__).resolve().parent.parent


def _admin_web_dir():
    # 后台管理网页：开发时位于 backend/admin_web，打包后位于 EXE 内部 _MEIPASS/admin_web
    if getattr(sys, 'frozen', False):
        return Path(getattr(sys, '_MEIPASS', Path(sys.executable).parent)) / 'admin_web'
    return Path(__file__).resolve().parent / 'admin_web'


WWW_DIR = _base_dir() / 'www'
ADMIN_WEB_DIR = _admin_web_dir()
DATA_DIR = config.DATA_DIR
UPLOAD_DIR = config.UPLOAD_DIR
DB_FILE = config.DB_FILE

DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

engine = create_engine(
    f'sqlite:///{DB_FILE}',
    connect_args={'check_same_thread': False},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
