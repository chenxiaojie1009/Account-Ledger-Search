"""认证：登录 / 登出 / 当前用户 / 修改密码"""
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from backend.audit import audit
from backend.database import get_db
from backend.deps import get_auth_context, get_pending_ok_user, get_token, public_user
from backend.models import User
from backend.schemas import ChangePasswordIn, LoginIn
from backend.security import (
    client_ip, create_session, get_user_by_token, hash_password,
    login_allowed, login_failed, login_succeeded, now_utc, password_valid,
    revoke_session, revoke_user_sessions, verify_password,
)

router = APIRouter(prefix="/api", tags=["auth"])


@router.post("/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    ip = client_ip(request)
    username = (body.username or "").strip()
    if not login_allowed(username, ip):
        return {"ok": False, "error": "尝试过于频繁，请稍后再试"}
    user = db.query(User).filter_by(username=username).first()
    if not user or not verify_password(body.password or "", user.password_hash):
        login_failed(username, ip)
        audit(db, None, "login_fail", f"用户 {username} 登录失败", ip)
        return {"ok": False, "error": "用户名或密码错误"}
    login_succeeded(username, ip)
    user.last_login_at = now_utc()
    db.commit()
    token = create_session(db, user, ip=ip, user_agent=request.headers.get("user-agent") or "")
    audit(db, user, "login", "登录成功", ip)
    return {"ok": True, "token": token, "user": public_user(user)}


@router.post("/logout")
def logout(request: Request, token: str = Depends(get_token), db: Session = Depends(get_db)):
    u = get_user_by_token(db, token)
    if u:
        audit(db, u, "logout", "退出登录", client_ip(request))
    revoke_session(db, token)
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(get_pending_ok_user)):
    return {"ok": True, "user": public_user(user)}


@router.post("/change-password")
def change_password(body: ChangePasswordIn, request: Request,
                    ctx=Depends(get_auth_context), db: Session = Depends(get_db)):
    user = ctx.user
    if not verify_password(body.oldPassword or "", user.password_hash):
        return {"ok": False, "error": "原密码错误"}
    if body.oldPassword and body.newPassword == body.oldPassword:
        return {"ok": False, "error": "新密码不能与原密码相同"}
    err = password_valid(body.newPassword)
    if err:
        return {"ok": False, "error": err}
    user.password_hash = hash_password(body.newPassword)
    user.must_change_password = 0
    db.commit()
    # 吊销该用户其它设备的会话（保留当前会话；会话 ID 取自鉴权上下文，避免手工解析出错）
    revoke_user_sessions(db, user.id, keep_jti=ctx.jti)
    audit(db, user, "change_password", "修改密码", client_ip(request))
    return {"ok": True}
