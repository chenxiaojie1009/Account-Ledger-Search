"""用户管理（仅管理员）"""
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from backend.audit import audit
from backend.database import get_db
from backend.deps import public_user, require_role
from backend.models import User
from backend.schemas import UserCreateIn, UserUpdateIn
from backend.security import (
    client_ip, hash_password, password_valid, revoke_user_sessions,
)

router = APIRouter(prefix="/api", tags=["users"])

ROLES = ("admin", "editor", "viewer")


@router.get("/users")
def list_users(user: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    rows = db.query(User).order_by(User.id).all()
    return {"ok": True, "users": [public_user(u) for u in rows]}


@router.post("/users")
def create_user(body: UserCreateIn, request: Request, user: User = Depends(require_role("admin")),
                db: Session = Depends(get_db)):
    username = (body.username or "").strip()
    if not username or len(username) > 64:
        return {"ok": False, "error": "用户名不能为空且不超过 64 字符"}
    if db.query(User).filter_by(username=username).first():
        return {"ok": False, "error": "用户名已存在"}
    role = body.role if body.role in ROLES else "viewer"
    pw = body.password or ""
    if not pw:
        return {"ok": False, "error": "请设置初始密码（不再使用固定默认密码）"}
    err = password_valid(pw)
    if err:
        return {"ok": False, "error": err}
    u = User(username=username, password_hash=hash_password(pw),
             display_name=(body.displayName or username)[:64], role=role)
    db.add(u)
    db.commit()
    audit(db, user, "user_create", f"新增用户 {username}（{role}）", client_ip(request))
    return {"ok": True, "user": public_user(u)}


@router.put("/users/{user_id}")
def update_user(user_id: int, body: UserUpdateIn, request: Request,
                user: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if not u:
        return {"ok": False, "error": "用户不存在"}
    # 内置管理员账号角色不可修改，防止误操作导致无法管理
    if u.username == "admin" and body.role and body.role != "admin":
        return {"ok": False, "error": "内置管理员账号角色不可修改"}
    changed = []
    if body.role and body.role in ROLES:
        u.role = body.role
        changed.append(f"角色->{body.role}")
    if body.displayName is not None:
        u.display_name = (body.displayName or "")[:64]
        changed.append("显示名")
    if body.password:
        err = password_valid(body.password)
        if err:
            return {"ok": False, "error": err}
        u.password_hash = hash_password(body.password)
        changed.append("重置密码")
        # 被重置密码后吊销该用户全部会话，强制重新登录
        revoke_user_sessions(db, u.id)
    db.commit()
    audit(db, user, "user_update", f"更新用户 {u.username}：{'，'.join(changed)}", client_ip(request))
    return {"ok": True, "user": public_user(u)}


@router.delete("/users/{user_id}")
def delete_user(user_id: int, request: Request, user: User = Depends(require_role("admin")),
                db: Session = Depends(get_db)):
    if user_id == user.id:
        return {"ok": False, "error": "不能删除当前登录账号"}
    u = db.get(User, user_id)
    if not u:
        return {"ok": False, "error": "用户不存在"}
    if u.username == "admin":
        return {"ok": False, "error": "内置管理员账号不可删除"}
    revoke_user_sessions(db, u.id)
    db.delete(u)
    db.commit()
    audit(db, user, "user_delete", f"删除用户 {u.username}", client_ip(request))
    return {"ok": True}
