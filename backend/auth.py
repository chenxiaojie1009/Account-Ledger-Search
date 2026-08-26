"""认证：JWT + bcrypt 密码哈希"""
import os
import datetime
import bcrypt
import jwt

SECRET_KEY = os.environ.get('TZ_SECRET_KEY', 'taizhang-secret-key-change-me-please-2026-0123456789')
ALGO = 'HS256'
TOKEN_TTL_DAYS = 7


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))
    except Exception:
        return False


def create_token(user_id: int) -> str:
    payload = {
        'sub': str(user_id),
        'exp': datetime.datetime.utcnow() + datetime.timedelta(days=TOKEN_TTL_DAYS),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGO)


def decode_token(token: str):
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGO])
    except Exception:
        return None


def token_user_id(token: str):
    data = decode_token(token)
    if not data:
        return None
    try:
        return int(data.get('sub'))
    except Exception:
        return None


ROLE_ORDER = {'viewer': 1, 'editor': 2, 'admin': 3}


def role_allowed(role: str, min_role: str) -> bool:
    return ROLE_ORDER.get(role, 0) >= ROLE_ORDER.get(min_role, 1)
