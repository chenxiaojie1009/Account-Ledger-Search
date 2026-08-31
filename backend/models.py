"""SQLAlchemy 数据模型（台账查找）"""
from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String, Text

from backend.database import Base


class User(Base):
    __tablename__ = 'users'
    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(64), unique=True, nullable=False)
    password_hash = Column(Text, nullable=False)
    display_name = Column(String(64), default='')
    role = Column(String(16), nullable=False, default='viewer')  # viewer / editor / admin
    # 1 = 下次登录必须修改密码（默认管理员强制改密）
    must_change_password = Column(Integer, nullable=False, default=0)
    last_login_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class SessionModel(Base):
    """服务端会话：真正的登出/改密/删号都能立即吊销令牌"""
    __tablename__ = 'sessions'
    jti = Column(String(64), primary_key=True)
    user_id = Column(Integer, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    expires_at = Column(DateTime, nullable=False)
    ip = Column(String(64), default='')
    user_agent = Column(String(256), default='')


class AuditLog(Base):
    """操作审计：记录登录、文件上传/下载/预览、备份、用户管理等关键操作"""
    __tablename__ = 'audit_logs'
    id = Column(Integer, primary_key=True, autoincrement=True)
    time = Column(DateTime, default=datetime.utcnow, index=True)
    user_id = Column(Integer, nullable=True)
    username = Column(String(64), default='')
    action = Column(String(64), nullable=False, index=True)
    detail = Column(Text, default='')
    ip = Column(String(64), default='')


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
    cabinet_id = Column(Integer, nullable=False, index=True)
    shelf = Column(Integer, nullable=False)
    slot = Column(Integer, nullable=False)
    name = Column(String(128), nullable=False, default='备用')
    # 文档编号（双重名称：编号 + 名称）；为空时三维场景按“序号”兜底显示
    code = Column(String(64), nullable=False, default='')


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
