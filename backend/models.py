"""SQLAlchemy 数据模型（台账查找）"""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime
from backend.database import Base


class User(Base):
    __tablename__ = 'users'
    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(64), unique=True, nullable=False)
    password_hash = Column(Text, nullable=False)
    display_name = Column(String(64), default='')
    role = Column(String(16), nullable=False, default='viewer')  # viewer / editor / admin
    created_at = Column(DateTime, default=datetime.utcnow)


class Cabinet(Base):
    __tablename__ = 'cabinets'
    id = Column(Integer, primary_key=True)
    name = Column(String(64), nullable=False)
    door_type = Column(String(16), nullable=False, default='double')  # double / single
    sort = Column(Integer, nullable=False, default=0)
    # 每层台账颜色（JSON 数组，如 ["#E3C878","#E8EDF3","#6FA0D6"]），可在后台自定义
    shelf_colors = Column(Text, nullable=True)


class Box(Base):
    __tablename__ = 'boxes'
    id = Column(Integer, primary_key=True, autoincrement=True)
    cabinet_id = Column(Integer, nullable=False)
    shelf = Column(Integer, nullable=False)
    slot = Column(Integer, nullable=False)
    name = Column(String(128), nullable=False, default='备用')


class File(Base):
    __tablename__ = 'files'
    id = Column(Integer, primary_key=True, autoincrement=True)
    box_cabinet_id = Column(Integer, nullable=False)
    box_shelf = Column(Integer, nullable=False)
    box_slot = Column(Integer, nullable=False)
    original_name = Column(String(255), nullable=False)
    stored_name = Column(String(255), nullable=False)
    mime = Column(String(128), default='')
    size = Column(Integer, default=0)
    uploaded_by = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
