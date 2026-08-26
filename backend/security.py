"""认证 / 会话 / 文件票据 / 限流 / IP 白名单 / 名称消毒"""
import base64
import hashlib
import hmac
import ipaddress
import json
import os
import re
import secrets
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, Tuple

import bcrypt
import jwt

from backend import config
from backend.models import SessionModel, User

ALGO = 'HS256'
_JTI_CLAIM = 'jti'


def now_utc() -> datetime:
    return datetime.utcnow()


# ---------------- 密码 ----------------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))
    except Exception:
        return False


def password_valid(new_password: str) -> Optional[str]:
    """返回 None 表示通过，否则返回给用户看的错误信息"""
    pw = new_password or ''
    if len(pw) < config.MIN_PASSWORD_LEN:
        return f'密码至少 {config.MIN_PASSWORD_LEN} 位'
    if not re.search(r'[A-Za-z]', pw) or not re.search(r'[0-9]', pw):
        return '密码需同时包含字母和数字'
    if len(pw) > 128:
        return '密码过长'
    return None


# ---------------- 令牌（JWT + 服务端会话） ----------------
def create_token(user_id: int, jti: str, ttl_days: Optional[int] = None) -> str:
    ttl = ttl_days or config.TOKEN_TTL_DAYS
    payload = {
        'sub': str(user_id),
        _JTI_CLAIM: jti,
        'exp': now_utc() + timedelta(days=ttl),
    }
    return jwt.encode(payload, config.SECRET_KEY, algorithm=ALGO)


def decode_token(token: str):
    try:
        return jwt.decode(token, config.SECRET_KEY, algorithms=[ALGO])
    except Exception:
        return None


def create_session(db, user: User, ip: str = '', user_agent: str = '') -> str:
    """创建服务端会话并返回令牌"""
    jti = secrets.token_urlsafe(24)
    exp = now_utc() + timedelta(days=config.TOKEN_TTL_DAYS)
    db.add(SessionModel(
        jti=jti, user_id=user.id, created_at=now_utc(), expires_at=exp,
        ip=(ip or '')[:64], user_agent=(user_agent or '')[:256],
    ))
    db.commit()
    return create_token(user.id, jti)


def get_user_by_token(db, token: Optional[str]) -> Optional[User]:
    if not token:
        return None
    data = decode_token(token)
    if not data:
        return None
    jti = data.get(_JTI_CLAIM)
    try:
        user_id = int(data.get('sub'))
    except (TypeError, ValueError):
        return None
    if not jti or not user_id:
        return None
    sess = db.get(SessionModel, jti)
    if not sess or sess.expires_at < now_utc():
        return None
    return db.get(User, user_id)


def revoke_session(db, token: Optional[str]) -> None:
    if not token:
        return
    data = decode_token(token)
    jti = data.get(_JTI_CLAIM) if data else None
    if jti:
        sess = db.get(SessionModel, jti)
        if sess:
            db.delete(sess)
            db.commit()


def revoke_user_sessions(db, user_id: int, keep_jti: Optional[str] = None) -> None:
    """吊销某用户的全部会话（改密/删号/被管理员重置密码时调用）"""
    q = db.query(SessionModel).filter(SessionModel.user_id == user_id)
    if keep_jti:
        q = q.filter(SessionModel.jti != keep_jti)
    for sess in q.all():
        db.delete(sess)
    db.commit()


# ---------------- 文件访问票据（短时效，不把主令牌放进 URL） ----------------
def make_file_ticket(user: User, session_jti: str, file_id: int) -> str:
    payload = {
        'v': 1,
        'uid': user.id,
        'fid': int(file_id),
        'jti': session_jti,
        'exp': int(time.time()) + config.FILE_TICKET_TTL_SECONDS,
    }
    raw = json.dumps(payload, separators=(',', ':'), sort_keys=True).encode('utf-8')
    sig = hmac.new(config.SECRET_KEY, raw, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(raw + b'.' + sig).decode('ascii')


def verify_file_ticket(db, ticket: str) -> Optional[Tuple[User, SessionModel, int]]:
    """校验票据，返回 (user, session, file_id)；任何一步失败都返回 None"""
    try:
        raw = base64.urlsafe_b64decode(ticket.encode('ascii'))
        body, sig = raw.rsplit(b'.', 1)
        expect = hmac.new(config.SECRET_KEY, body, hashlib.sha256).digest()
        if not hmac.compare_digest(expect, sig):
            return None
        payload = json.loads(body.decode('utf-8'))
        if payload.get('v') != 1 or int(payload.get('exp', 0)) < int(time.time()):
            return None
        sess = db.get(SessionModel, payload.get('jti'))
        if not sess or sess.expires_at < now_utc():
            return None
        user = db.get(User, int(payload.get('uid', 0)))
        if not user:
            return None
        return user, sess, int(payload.get('fid', 0))
    except Exception:
        return None


# ---------------- 客户端信息 / IP 白名单 ----------------
def client_ip(request) -> str:
    fwd = request.headers.get('x-forwarded-for')
    if fwd:
        return fwd.split(',')[0].strip()
    if request.client:
        return request.client.host or ''
    return ''


def ip_allowed(ip: str) -> bool:
    if not config.ALLOWED_IPS:
        return True
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    for entry in config.ALLOWED_IPS:
        try:
            if '/' in entry:
                if addr in ipaddress.ip_network(entry, strict=False):
                    return True
            elif addr == ipaddress.ip_address(entry):
                return True
        except ValueError:
            continue
    return False


# ---------------- 登录限流 / 锁定 ----------------
_login_fail: dict = {}
_lock = threading.Lock()


def login_allowed(username: str, ip: str) -> bool:
    key = f'{ip}|{username.strip().lower()}'
    with _lock:
        rec = _login_fail.get(key)
        if rec and rec.get('lock_until', 0) > time.time():
            return False
    return True


def login_failed(username: str, ip: str) -> None:
    key = f'{ip}|{username.strip().lower()}'
    with _lock:
        rec = _login_fail.setdefault(key, {'fails': 0, 'lock_until': 0})
        rec['fails'] += 1
        if rec['fails'] >= config.LOGIN_MAX_FAILS:
            rec['lock_until'] = time.time() + config.LOGIN_LOCK_SECONDS
            rec['fails'] = 0


def login_succeeded(username: str, ip: str) -> None:
    key = f'{ip}|{username.strip().lower()}'
    with _lock:
        _login_fail.pop(key, None)


# ---------------- 普通接口按 IP 限流 ----------------
_req_windows: dict = {}
_req_lock = threading.Lock()
_last_cleanup = [0.0]


def request_allowed(ip: str) -> bool:
    now = time.time()
    with _req_lock:
        # 定期清理过期窗口，避免内存膨胀
        if now - _last_cleanup[0] > 300:
            _last_cleanup[0] = now
            for k in [k for k, ts in _req_windows.items() if ts and now - ts[-1] > 120]:
                _req_windows.pop(k, None)
        lst = _req_windows.setdefault(ip, [])
        lst = [t for t in lst if now - t < 60]
        if len(lst) >= config.REQ_RATE_LIMIT:
            _req_windows[ip] = lst
            return False
        lst.append(now)
        _req_windows[ip] = lst
        return True


# ---------------- 文件名称 / 扩展名 / MIME 消毒 ----------------
def clean_filename(name: str, max_len: int = 180) -> str:
    """只保留文件名（去掉路径），去除控制字符，限制长度"""
    name = (name or '').replace('\\', '/')
    name = os.path.basename(name).strip()
    name = ''.join(ch for ch in name if ord(ch) >= 32 and ch not in '<>:"/\\|?*')
    if len(name) > max_len:
        stem, ext = os.path.splitext(name)
        name = stem[: max_len - len(ext)] + ext
    return name or 'file'


def sanitize_extension(filename: str) -> str:
    """从文件名提取安全扩展名（仅字母数字._-，最长 12 字符）"""
    base = clean_filename(filename)
    ext = Path(base).suffix
    if not ext:
        return '.bin'
    ext = ''.join(ch for ch in ext if ch.isalnum() or ch in '._-')
    if not ext or not re.fullmatch(r'\.[A-Za-z0-9][A-Za-z0-9._-]{0,10}', ext):
        return '.bin'
    return ext.lower()


def normalize_mime(mime: str, filename: str = '') -> str:
    """把客户端上报的 MIME 收敛到白名单内，防存储型 XSS/任意类型伪装"""
    m = (mime or '').split(';')[0].strip().lower()
    if m and any(m.startswith(p) for p in config.ALLOWED_MIME_PREFIXES):
        return m
    ext = Path(filename or '').suffix.lower()
    fallback = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
        '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/plain',
        '.csv': 'text/csv', '.json': 'application/json',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.xls': 'application/vnd.ms-excel', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.doc': 'application/msword', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        '.ppt': 'application/vnd.ms-powerpoint', '.zip': 'application/zip',
    }
    return fallback.get(ext, 'application/octet-stream')


def extension_blocked(filename: str) -> bool:
    ext = Path(filename or '').suffix.lower()
    return ext in config.BLOCKED_EXTENSIONS


# ---------------- 角色 ----------------
ROLE_ORDER = {'viewer': 1, 'editor': 2, 'admin': 3}


def role_allowed(role: str, min_role: str) -> bool:
    return ROLE_ORDER.get(role, 0) >= ROLE_ORDER.get(min_role, 1)


def can_download_files(user: User) -> bool:
    """viewer 默认只能预览不能下载；editor/admin 可下载"""
    return config.VIEWER_CAN_DOWNLOAD or role_allowed(user.role, 'editor')
