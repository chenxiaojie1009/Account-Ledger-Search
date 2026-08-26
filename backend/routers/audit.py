"""操作审计查询（仅管理员）"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.deps import require_role
from backend.models import AuditLog, User

router = APIRouter(prefix="/api", tags=["audit"])


@router.get("/audit")
def list_audit(limit: int = Query(default=300, ge=1, le=1000),
               user: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    rows = db.query(AuditLog).order_by(AuditLog.id.desc()).limit(limit).all()
    return {"ok": True, "logs": [
        {
            "id": r.id,
            "time": r.time.strftime("%Y-%m-%d %H:%M:%S") if r.time else "",
            "username": r.username,
            "action": r.action,
            "detail": r.detail,
            "ip": r.ip,
        } for r in rows
    ]}
