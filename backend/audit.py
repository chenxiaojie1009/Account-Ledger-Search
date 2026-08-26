"""操作审计：写入数据库，同时追加到 data/audit.log（便于运维检索）"""
import json
from datetime import datetime

from sqlalchemy.orm import Session

from backend import config
from backend.models import AuditLog

KEEP_MAX = 5000  # 审计表最多保留条数，防止无限膨胀

ACTIONS = ("login", "login_fail", "logout", "change_password",
           "user_create", "user_update", "user_delete",
           "catalog_update", "catalog_reset", "import", "config_update",
           "file_upload", "file_delete", "file_view", "file_download",
           "backup_download", "backup_restore")


def audit(db: Session, user, action: str, detail: str = "", ip: str = ""):
    """记录一条审计日志。user 可为 User 对象或 None（未登录场景）"""
    if action not in ACTIONS:
        action = "other"
    username = (user.username if user is not None else "") or ""
    user_id = user.id if user is not None else None
    now = datetime.utcnow()
    db.add(AuditLog(time=now, user_id=user_id, username=username,
                    action=action, detail=(detail or "")[:2000], ip=(ip or "")[:64]))
    # 超过上限时清理最旧的记录
    try:
        total = db.query(AuditLog).count()
        if total > KEEP_MAX:
            ids = db.query(AuditLog.id).order_by(AuditLog.id).limit(total - KEEP_MAX).all()
            db.query(AuditLog).filter(AuditLog.id.in_([r[0] for r in ids])).delete(synchronize_session=False)
    except Exception:
        pass
    db.commit()
    # 同时追加到日志文件，方便直接用文本工具查看
    try:
        line = {"time": now.strftime("%Y-%m-%d %H:%M:%S"), "user": username,
                "action": action, "detail": detail, "ip": ip}
        with open(config.AUDIT_LOG_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(line, ensure_ascii=False) + "\n")
    except Exception:
        pass
