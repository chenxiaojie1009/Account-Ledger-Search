"""FastAPI 公共依赖：令牌解析、当前用户、角色校验"""
from types import SimpleNamespace
from typing import Optional

from fastapi import Depends, Header, HTTPException, Query
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import User
from backend.security import decode_token, get_user_by_token, role_allowed


def get_token(authorization: Optional[str] = Header(default=None),
              token: Optional[str] = Query(default=None)) -> Optional[str]:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return (token or "").strip() or None


def get_auth_context(token: str = Depends(get_token), db: Session = Depends(get_db)):
    """解析令牌：返回 (user, session_jti)；未登录或会话已吊销则 401"""
    user = get_user_by_token(db, token)
    if not user:
        raise HTTPException(status_code=401, detail="未登录或登录已过期")
    data = decode_token(token)
    return SimpleNamespace(user=user, jti=(data or {}).get("jti"))


def get_pending_ok_user(ctx=Depends(get_auth_context)) -> User:
    """允许 must_change_password 状态的用户访问（仅 /api/me、改密、登出）"""
    return ctx.user


def get_active_context(ctx=Depends(get_auth_context)):
    """普通接口：强制要求先修改初始密码"""
    if ctx.user.must_change_password:
        raise HTTPException(status_code=403, detail="请先修改初始密码后再操作")
    return ctx


def get_active_user(ctx=Depends(get_active_context)) -> User:
    return ctx.user


def require_role(min_role: str):
    def dep(ctx=Depends(get_active_context)) -> User:
        if not role_allowed(ctx.user.role, min_role):
            raise HTTPException(status_code=403, detail="权限不足")
        return ctx.user
    return dep


def public_user(u: User) -> dict:
    return {
        "id": u.id,
        "username": u.username,
        "displayName": u.display_name or u.username,
        "role": u.role,
        "mustChangePassword": bool(u.must_change_password),
    }
