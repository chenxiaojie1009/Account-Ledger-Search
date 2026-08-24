"""台账查找 - FastAPI 后端（Windows 部署 / PyInstaller 单文件 EXE）"""
import os
import sys
import io
import base64
import uuid
from pathlib import Path
from urllib.parse import quote
from typing import Optional, List

from fastapi import FastAPI, Depends, Header, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from backend.database import engine, SessionLocal, Base, WWW_DIR, ADMIN_WEB_DIR, UPLOAD_DIR, DATA_DIR, get_db
from backend.models import User, Cabinet, Box, File
from backend.auth import hash_password, verify_password, create_token, token_user_id, role_allowed
from backend.schemas import (
    LoginIn, SetCountIn, RenameIn, UploadIn,
    UserCreateIn, UserUpdateIn,
)

CABINET_COUNT = 6
SHELF_COUNT = 3
CABINET_DOORS = ['double', 'double', 'single', 'double', 'double', 'single']
DEFAULT_BOXES_PER_SHELF = 15
MAX_BOXES_PER_SHELF = 40
MAX_UPLOAD_BYTES = 25 * 1024 * 1024

app = FastAPI(title='台账查找后端', version='1.1')

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


# ---------------- 初始化 / 种子 ----------------
def seed():
    with SessionLocal() as db:
        if not db.query(User).filter_by(username='admin').first():
            db.add(User(username='admin', password_hash=hash_password('123456'),
                        display_name='系统管理员', role='admin'))
        if db.query(Cabinet).count() == 0:
            for i in range(CABINET_COUNT):
                db.add(Cabinet(id=i, name=f'{i + 1}号柜', door_type=CABINET_DOORS[i], sort=i))
        if db.query(Box).count() == 0:
            for c in range(CABINET_COUNT):
                for s in range(SHELF_COUNT):
                    for b in range(DEFAULT_BOXES_PER_SHELF):
                        db.add(Box(cabinet_id=c, shelf=s, slot=b, name='备用'))
        db.commit()


@app.on_event('startup')
def on_startup():
    Base.metadata.create_all(bind=engine)
    seed()


# ---------------- 工具 ----------------
def err(status: int, msg: str):
    return JSONResponse(status_code=status, content={'ok': False, 'error': msg})


def public_user(u: User):
    return {'id': u.id, 'username': u.username, 'displayName': u.display_name or u.username, 'role': u.role}


def get_token(authorization: Optional[str] = Header(default=None), token: Optional[str] = Query(default=None)):
    if authorization and authorization.startswith('Bearer '):
        return authorization[7:]
    return token


def require_user(token: str, db: Session):
    uid = token_user_id(token)
    if not uid:
        return None
    user = db.get(User, uid)
    return user


def get_catalog(db: Session):
    cabinets = db.query(Cabinet).order_by(Cabinet.sort).all()
    out = []
    for c in cabinets:
        shelves = []
        for s in range(SHELF_COUNT):
            rows = db.query(Box).filter_by(cabinet_id=c.id, shelf=s).order_by(Box.slot).all()
            shelves.append([r.name for r in rows])
        out.append({'id': c.id, 'name': c.name, 'doorType': c.door_type, 'shelves': shelves})
    return out


def ensure_box(db: Session, cabinet_id: int, shelf: int, slot: int):
    row = db.query(Box).filter_by(cabinet_id=cabinet_id, shelf=shelf, slot=slot).first()
    if not row:
        row = Box(cabinet_id=cabinet_id, shelf=shelf, slot=slot, name='备用')
        db.add(row)
        db.flush()
    return row


def set_shelf_count(db: Session, cabinet_id: int, shelf: int, n: int):
    n = max(1, min(MAX_BOXES_PER_SHELF, int(n if isinstance(n, int) else n or DEFAULT_BOXES_PER_SHELF)))
    for b in range(n):
        ensure_box(db, cabinet_id, shelf, b)
    rows = db.query(Box).filter_by(cabinet_id=cabinet_id, shelf=shelf).filter(Box.slot >= n).all()
    for r in rows:
        # 删除对应文件
        for f in db.query(File).filter_by(box_cabinet_id=cabinet_id, box_shelf=shelf, box_slot=r.slot).all():
            unlink_file(f)
            db.delete(f)
        db.delete(r)
    db.commit()
    return n


def rename_box(db: Session, cabinet_id: int, shelf: int, slot: int, name: str):
    name = (name or '').strip() or '备用'
    ensure_box(db, cabinet_id, shelf, slot)
    row = db.query(Box).filter_by(cabinet_id=cabinet_id, shelf=shelf, slot=slot).first()
    row.name = name
    db.commit()


def unlink_file(f: File):
    try:
        p = UPLOAD_DIR / f.stored_name
        if p.exists():
            p.unlink()
    except Exception:
        pass


def reset_catalog(db: Session):
    for f in db.query(File).all():
        unlink_file(f)
        db.delete(f)
    for b in db.query(Box).all():
        db.delete(b)
    for c in range(CABINET_COUNT):
        for s in range(SHELF_COUNT):
            for b in range(DEFAULT_BOXES_PER_SHELF):
                db.add(Box(cabinet_id=c, shelf=s, slot=b, name='备用'))
    db.commit()


def file_url(f: File, token: str):
    return f"/api/files/{f.id}/download?token={quote(token)}&name={quote(f.original_name)}"


def file_out(f: File, token: str):
    return {
        'id': f.id,
        'cabinetId': f.box_cabinet_id,
        'shelf': f.box_shelf,
        'slot': f.box_slot,
        'originalName': f.original_name,
        'mime': f.mime,
        'size': f.size,
        'createdAt': f.created_at.strftime('%Y-%m-%d %H:%M:%S') if f.created_at else '',
        'url': file_url(f, token),
    }


# ---------------- 认证 ----------------
@app.post('/api/login')
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.query(User).filter_by(username=body.username.strip()).first()
    if not user or not verify_password(body.password, user.password_hash):
        return err(401, '用户名或密码错误')
    token = create_token(user.id)
    return {'ok': True, 'token': token, 'user': public_user(user)}


@app.post('/api/logout')
def logout():
    return {'ok': True}


@app.get('/api/me')
def me(token: str = Depends(get_token), db: Session = Depends(get_db)):
    user = require_user(token, db)
    if not user:
        return err(401, '未登录')
    return {'ok': True, 'user': public_user(user)}


# ---------------- 目录 ----------------
@app.get('/api/catalog')
def catalog(token: str = Depends(get_token), db: Session = Depends(get_db)):
    user = require_user(token, db)
    if not user:
        return err(401, '未登录')
    return {'ok': True, 'cabinets': get_catalog(db)}


@app.post('/api/set-count')
def set_count(body: SetCountIn, token: str = Depends(get_token), db: Session = Depends(get_db)):
    user = require_user(token, db)
    if not user:
        return err(401, '未登录')
    if not role_allowed(user.role, 'editor'):
        return err(403, '权限不足')
    n = set_shelf_count(db, body.cabinetId, body.shelf, body.count)
    return {'ok': True, 'count': n, 'cabinets': get_catalog(db)}


@app.post('/api/rename')
def rename(body: RenameIn, token: str = Depends(get_token), db: Session = Depends(get_db)):
    user = require_user(token, db)
    if not user:
        return err(401, '未登录')
    if not role_allowed(user.role, 'editor'):
        return err(403, '权限不足')
    rename_box(db, body.cabinetId, body.shelf, body.slot, body.name)
    return {'ok': True, 'cabinets': get_catalog(db)}


@app.post('/api/reset')
def reset(token: str = Depends(get_token), db: Session = Depends(get_db)):
    user = require_user(token, db)
    if not user:
        return err(401, '未登录')
    if not role_allowed(user.role, 'admin'):
        return err(403, '权限不足')
    reset_catalog(db)
    return {'ok': True, 'cabinets': get_catalog(db)}


# ---------------- 文件 ----------------
@app.get('/api/files')
def list_files(cabinetId: int = Query(...), shelf: int = Query(...), slot: int = Query(...),
               token: str = Depends(get_token), db: Session = Depends(get_db)):
    user = require_user(token, db)
    if not user:
        return err(401, '未登录')
    rows = db.query(File).filter_by(box_cabinet_id=cabinetId, box_shelf=shelf, box_slot=slot).order_by(File.id).all()
    return {'ok': True, 'files': [file_out(f, token) for f in rows]}


@app.post('/api/files')
def upload_file(body: UploadIn, token: str = Depends(get_token), db: Session = Depends(get_db)):
    user = require_user(token, db)
    if not user:
        return err(401, '未登录')
    if not role_allowed(user.role, 'editor'):
        return err(403, '权限不足')
    try:
        data = base64.b64decode(body.dataBase64)
    except Exception:
        return err(400, '文件内容解码失败')
    if len(data) > MAX_UPLOAD_BYTES:
        return err(413, '文件过大')
    ensure_box(db, body.cabinetId, body.shelf, body.slot)
    ext = Path(body.filename).suffix or '.bin'
    stored = f'{int(__import__("time").time() * 1000)}-{uuid.uuid4().hex[:12]}{ext}'
    (UPLOAD_DIR / stored).write_bytes(data)
    f = File(
        box_cabinet_id=body.cabinetId,
        box_shelf=body.shelf,
        box_slot=body.slot,
        original_name=body.filename,
        stored_name=stored,
        mime=body.mime or 'application/octet-stream',
        size=len(data),
        uploaded_by=user.id,
    )
    db.add(f)
    db.commit()
    return {'ok': True, 'file': file_out(f, token)}


@app.get('/api/files/{file_id}/download')
def download_file(file_id: int, token: str = Query(default=''), download: str = Query(default=''),
                  db: Session = Depends(get_db)):
    user = require_user(token, db)
    if not user:
        return err(401, '未登录')
    f = db.get(File, file_id)
    if not f:
        return err(404, '文件不存在')
    p = UPLOAD_DIR / f.stored_name
    if not p.exists():
        return err(404, '文件不存在')
    disp = 'attachment' if download == '1' else 'inline'
    headers = {
        'Content-Disposition': f"{disp}; filename*=UTF-8''{quote(f.original_name)}",
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
    }
    return FileResponse(p, media_type=f.mime or 'application/octet-stream', headers=headers)


@app.delete('/api/files/{file_id}')
def delete_file(file_id: int, token: str = Depends(get_token), db: Session = Depends(get_db)):
    user = require_user(token, db)
    if not user:
        return err(401, '未登录')
    if not role_allowed(user.role, 'editor'):
        return err(403, '权限不足')
    f = db.get(File, file_id)
    if not f:
        return err(404, '文件不存在')
    unlink_file(f)
    db.delete(f)
    db.commit()
    return {'ok': True}


# ---------------- 用户 ----------------
@app.get('/api/users')
def list_users(token: str = Depends(get_token), db: Session = Depends(get_db)):
    user = require_user(token, db)
    if not user:
        return err(401, '未登录')
    if not role_allowed(user.role, 'admin'):
        return err(403, '权限不足')
    rows = db.query(User).order_by(User.id).all()
    return {'ok': True, 'users': [public_user(u) for u in rows]}


@app.post('/api/users')
def create_user(body: UserCreateIn, token: str = Depends(get_token), db: Session = Depends(get_db)):
    user = require_user(token, db)
    if not user:
        return err(401, '未登录')
    if not role_allowed(user.role, 'admin'):
        return err(403, '权限不足')
    username = (body.username or '').strip()
    if not username:
        return err(400, '用户名不能为空')
    if db.query(User).filter_by(username=username).first():
        return err(409, '用户名已存在')
    role = body.role if body.role in ('admin', 'editor', 'viewer') else 'viewer'
    u = User(username=username, password_hash=hash_password(body.password or '123456'),
             display_name=body.displayName or username, role=role)
    db.add(u)
    db.commit()
    return {'ok': True, 'user': public_user(u)}


@app.put('/api/users/{user_id}')
def update_user(user_id: int, body: UserUpdateIn, token: str = Depends(get_token), db: Session = Depends(get_db)):
    user = require_user(token, db)
    if not user:
        return err(401, '未登录')
    if not role_allowed(user.role, 'admin'):
        return err(403, '权限不足')
    u = db.get(User, user_id)
    if not u:
        return err(404, '用户不存在')
    if body.role and body.role in ('admin', 'editor', 'viewer'):
        u.role = body.role
    if body.displayName is not None:
        u.display_name = body.displayName
    if body.password:
        u.password_hash = hash_password(body.password)
    db.commit()
    return {'ok': True, 'user': public_user(u)}


@app.delete('/api/users/{user_id}')
def delete_user(user_id: int, token: str = Depends(get_token), db: Session = Depends(get_db)):
    user = require_user(token, db)
    if not user:
        return err(401, '未登录')
    if not role_allowed(user.role, 'admin'):
        return err(403, '权限不足')
    if user_id == user.id:
        return err(400, '不能删除当前登录账号')
    u = db.get(User, user_id)
    if not u:
        return err(404, '用户不存在')
    db.delete(u)
    db.commit()
    return {'ok': True}


# ---------------- 后台管理网页（http://IP:10600/admin） ----------------
# 后台管理独立成网页，APK 只做查看。
if ADMIN_WEB_DIR.exists():
    app.mount('/admin', StaticFiles(directory=str(ADMIN_WEB_DIR), html=True), name='admin')


# ---------------- 启动（仅后端数据服务，10600） ----------------
# 前端是 APK（App 自带全部界面与动画），后端只提供数据接口。
if __name__ == '__main__':
    import io
    import sys
    import uvicorn

    # 打包为无控制台 EXE 时 sys.stdout/stderr 可能为 None，会导致 uvicorn
    # 配置日志时 None.isatty() 报错，这里用一个哑字符串流兜底。
    if sys.stdout is None:
        sys.stdout = io.StringIO()
    if sys.stderr is None:
        sys.stderr = io.StringIO()

    PORT_API = int(os.environ.get('PORT_API', 10600))
    print(f'[台账查找] 后端数据服务已启动: http://0.0.0.0:{PORT_API}')
    print(f'[台账查找] APK 登录时后端地址填: http://<电脑IP>:{PORT_API}')
    uvicorn.run(app, host='0.0.0.0', port=PORT_API, log_level='info', log_config=None)
