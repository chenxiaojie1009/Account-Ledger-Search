"""台账查找 - FastAPI 后端（Windows 部署 / PyInstaller 单文件 EXE）"""
import os
import sys
import io
import json
import time
import base64
import uuid
import zipfile
from datetime import datetime
from pathlib import Path
from urllib.parse import quote
from typing import Optional, List

from fastapi import FastAPI, Depends, Header, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.database import engine, SessionLocal, Base, WWW_DIR, ADMIN_WEB_DIR, UPLOAD_DIR, DATA_DIR, get_db
from backend.models import User, Cabinet, Box, File
from backend.auth import hash_password, verify_password, create_token, token_user_id, role_allowed
from backend.schemas import (
    LoginIn, SetCountIn, RenameIn, UploadIn, RestoreIn, ImportIn,
    UpdateCatalogIn, ConfigIn, ConfigCabinetIn,
    UserCreateIn, UserUpdateIn,
)

CABINET_COUNT = 6
SHELF_COUNT = 3
CABINET_DOORS = ['double', 'double', 'single', 'double', 'double', 'single']
DEFAULT_BOXES_PER_SHELF = 15
MAX_BOXES_PER_SHELF = 40
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
DEFAULT_SHELF_COLORS = ['#E5484D', '#FF8A3D', '#F5C93C']

app = FastAPI(title='台账查找后端', version='1.1')


@app.get('/', include_in_schema=False)
def root():
    # 根地址自动跳到后台管理网页，避免误以为 10600 没有页面
    return RedirectResponse('/admin')

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
    # 旧数据库升级：补齐每层台账颜色列
    try:
        with engine.connect() as conn:
            conn.execute(text('ALTER TABLE cabinets ADD COLUMN shelf_colors TEXT'))
            conn.commit()
    except Exception:
        pass
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


def shelf_colors_of(c: Cabinet):
    if c.shelf_colors:
        try:
            colors = json.loads(c.shelf_colors)
            if isinstance(colors, list) and len(colors) >= SHELF_COUNT:
                return list(colors[:SHELF_COUNT])
        except Exception:
            pass
    return list(DEFAULT_SHELF_COLORS)


def get_catalog(db: Session):
    cabinets = db.query(Cabinet).order_by(Cabinet.sort).all()
    out = []
    for c in cabinets:
        shelves = []
        for s in range(SHELF_COUNT):
            rows = db.query(Box).filter_by(cabinet_id=c.id, shelf=s).order_by(Box.slot).all()
            shelves.append([r.name for r in rows])
        out.append({
            'id': c.id,
            'name': c.name,
            'doorType': c.door_type,
            'shelfColors': shelf_colors_of(c),
            'shelves': shelves,
        })
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


def cabinet_count(db: Session):
    return db.query(Cabinet).count()


def apply_config(db: Session, new_cabs: list):
    """按后台配置同步柜子数量与门型（单开/对开）。

    采用“内存重建”方式：先把旧柜数据（名称、门型、颜色、每层台账名）读入内存，
    再重建 Cabinet 与 Box，保证数量/门型变化后数据不会错乱。
    """
    n = len(new_cabs)
    old = db.query(Cabinet).order_by(Cabinet.sort).all()
    old_count = len(old)
    # 1) 旧柜数据读入内存
    old_data = {}
    for i, cab in enumerate(old):
        shelves = []
        for s in range(SHELF_COUNT):
            rows = db.query(Box).filter_by(cabinet_id=cab.id, shelf=s).order_by(Box.slot).all()
            shelves.append([r.name for r in rows])
        old_data[i] = {
            'name': cab.name,
            'doorType': cab.door_type,
            'shelfColors': cab.shelf_colors,
            'shelves': shelves,
        }
    # 2) 删除多余柜的文件，再清空柜体与台账
    for i in range(n, old_count):
        for f in db.query(File).filter_by(box_cabinet_id=i).all():
            unlink_file(f)
            db.delete(f)
    db.query(Box).delete(synchronize_session=False)
    db.query(Cabinet).delete(synchronize_session=False)
    db.flush()
    # 3) 按新配置重建
    for i in range(n):
        src = new_cabs[i]
        name = (src.get('name') or '').strip() or f'{i + 1}号柜'
        door = 'single' if src.get('doorType') == 'single' else 'double'
        colors = src.get('shelfColors') or None
        if colors and isinstance(colors, list):
            valid = [str(c) for c in colors[:SHELF_COUNT]]
            while len(valid) < SHELF_COUNT:
                valid.append(DEFAULT_SHELF_COLORS[len(valid)])
            colors_json = json.dumps(valid)
        else:
            colors_json = json.dumps(DEFAULT_SHELF_COLORS)
        db.add(Cabinet(id=i, name=name, door_type=door, sort=i, shelf_colors=colors_json))
        old = old_data.get(i)
        for s in range(SHELF_COUNT):
            if old and s < len(old['shelves']) and old['shelves'][s]:
                for b, nm in enumerate(old['shelves'][s]):
                    if b >= MAX_BOXES_PER_SHELF:
                        break
                    db.add(Box(cabinet_id=i, shelf=s, slot=b, name=(nm or '备用')))
            else:
                for b in range(DEFAULT_BOXES_PER_SHELF):
                    db.add(Box(cabinet_id=i, shelf=s, slot=b, name='备用'))
    db.commit()


def reset_catalog(db: Session):
    for f in db.query(File).all():
        unlink_file(f)
        db.delete(f)
    for b in db.query(Box).all():
        db.delete(b)
    for c in db.query(Cabinet).order_by(Cabinet.sort).all():
        for s in range(SHELF_COUNT):
            for b in range(DEFAULT_BOXES_PER_SHELF):
                db.add(Box(cabinet_id=c.id, shelf=s, slot=b, name='备用'))
    db.commit()


def build_backup(db: Session):
    """把台账目录 + 已上传文件 + 用户打包成一个 zip（字节流）"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        manifest = {
            'version': 1,
            'createdAt': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'cabinets': get_catalog(db),
            'files': [],
            'users': [],
        }
        for f in db.query(File).order_by(File.id).all():
            p = UPLOAD_DIR / f.stored_name
            if not p.exists():
                continue
            stored_name = f'files/{f.id}__{f.original_name}'
            try:
                z.write(p, stored_name)
            except Exception:
                continue
            manifest['files'].append({
                'id': f.id,
                'cabinetId': f.box_cabinet_id,
                'shelf': f.box_shelf,
                'slot': f.box_slot,
                'originalName': f.original_name,
                'storedName': stored_name,
                'mime': f.mime,
                'size': f.size,
            })
        for u in db.query(User).order_by(User.id).all():
            manifest['users'].append({
                'id': u.id,
                'username': u.username,
                'passwordHash': u.password_hash,
                'displayName': u.display_name or u.username,
                'role': u.role,
            })
        z.writestr('catalog.json', json.dumps(manifest, ensure_ascii=False, indent=2))
    return buf.getvalue()


def restore_from_backup(db: Session, zf: zipfile.ZipFile, manifest: dict):
    """按备份内容还原：目录、文件、用户"""
    cabinets = manifest.get('cabinets') or []
    # 0) 先按备份同步柜子数量与门型（可组合）
    apply_config(db, [{'doorType': src.get('doorType', 'double'), 'name': src.get('name', '')} for src in cabinets])

    # 1) 清空当前台账与文件
    for f in db.query(File).all():
        unlink_file(f)
        db.delete(f)
    for b in db.query(Box).all():
        db.delete(b)
    db.flush()

    # 2) 还原目录
    for ci in range(len(cabinets)):
        src = cabinets[ci] or {}
        shelves = src.get('shelves') or []
        for si in range(SHELF_COUNT):
            names = shelves[si] if si < len(shelves) else []
            n = max(1, min(MAX_BOXES_PER_SHELF, len(names)))
            for bi in range(n):
                ensure_box(db, ci, si, bi)
                row = db.query(Box).filter_by(cabinet_id=ci, shelf=si, slot=bi).first()
                row.name = (names[bi] if bi < len(names) else '备用') or '备用'
    db.flush()

    # 3) 还原文件
    for fm in (manifest.get('files') or []):
        try:
            content = zf.read(fm['storedName'])
        except KeyError:
            continue
        ext = Path(fm.get('originalName', '')).suffix or '.bin'
        stored = f'{int(time.time() * 1000)}-{uuid.uuid4().hex[:12]}{ext}'
        (UPLOAD_DIR / stored).write_bytes(content)
        db.add(File(
            box_cabinet_id=fm['cabinetId'],
            box_shelf=fm['shelf'],
            box_slot=fm['slot'],
            original_name=fm.get('originalName', 'file'),
            stored_name=stored,
            mime=fm.get('mime', 'application/octet-stream'),
            size=len(content),
            uploaded_by=None,
        ))
    db.flush()

    # 4) 还原用户（尽量保持原 id，避免登录态失效）
    users = manifest.get('users') or []
    if users:
        db.query(User).delete(synchronize_session=False)
        for u in users:
            uid = u.get('id')
            db.add(User(
                id=uid if isinstance(uid, int) else None,
                username=u['username'],
                password_hash=u.get('passwordHash') or hash_password('123456'),
                display_name=u.get('displayName') or u['username'],
                role=u.get('role', 'viewer'),
            ))
        db.flush()  # 先落库，让下面的查询能看到还原的用户

    # 保证至少有一个管理员账号
    if not db.query(User).filter_by(role='admin').first():
        if not db.query(User).filter_by(username='admin').first():
            db.add(User(username='admin', password_hash=hash_password('123456'),
                        display_name='系统管理员', role='admin'))
    db.commit()


def file_url(f: File, token: str, request: Request):
    # 生成绝对地址，保证 APK（跨端口/跨主机）也能直接访问
    base = str(request.base_url).rstrip('/')
    return f"{base}/api/files/{f.id}/download?token={quote(token)}&name={quote(f.original_name)}"


def file_out(f: File, token: str, request: Request):
    return {
        'id': f.id,
        'cabinetId': f.box_cabinet_id,
        'shelf': f.box_shelf,
        'slot': f.box_slot,
        'originalName': f.original_name,
        'mime': f.mime,
        'size': f.size,
        'createdAt': f.created_at.strftime('%Y-%m-%d %H:%M:%S') if f.created_at else '',
        'url': file_url(f, token, request),
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


# ---------------- 文档名称批量导入 ----------------
@app.post('/api/import')
def import_names(body: ImportIn, token: str = Depends(get_token), db: Session = Depends(get_db)):
    user = require_user(token, db)
    if not user:
        return err(401, '未登录')
    if not role_allowed(user.role, 'editor'):
        return err(403, '权限不足')
    imported = 0
    errors = []
    for idx, r in enumerate(body.rows):
        line = idx + 1
        cabinet, layer, slot, name = r.cabinet, r.layer, r.slot, (r.name or '').strip()
        if not (1 <= cabinet <= cabinet_count(db)):
            errors.append(f'第{line}行：柜号应为1-{cabinet_count(db)}')
            continue
        if not (1 <= layer <= SHELF_COUNT):
            errors.append(f'第{line}行：层号应为1-{SHELF_COUNT}')
            continue
        if not (1 <= slot <= MAX_BOXES_PER_SHELF):
            errors.append(f'第{line}行：序号应为1-{MAX_BOXES_PER_SHELF}')
            continue
        if not name:
            errors.append(f'第{line}行：台账名称为空')
            continue
        ci = cabinet - 1
        si = SHELF_COUNT - layer  # 层号1=最上层 -> si=2
        bi = slot - 1
        cur = db.query(Box).filter_by(cabinet_id=ci, shelf=si).count()
        if cur < slot:
            set_shelf_count(db, ci, si, min(MAX_BOXES_PER_SHELF, slot))
        rename_box(db, ci, si, bi, name)
        imported += 1
    return {'ok': True, 'imported': imported, 'failed': len(errors), 'errors': errors, 'cabinets': get_catalog(db)}


# ---------------- 批量保存目录（保存全部） ----------------
@app.post('/api/update-catalog')
def update_catalog(body: UpdateCatalogIn, token: str = Depends(get_token), db: Session = Depends(get_db)):
    user = require_user(token, db)
    if not user:
        return err(401, '未登录')
    if not role_allowed(user.role, 'editor'):
        return err(403, '权限不足')
    ci = body.cabinetId
    if not (0 <= ci < cabinet_count(db)):
        return err(400, '柜号无效')
    for si in range(SHELF_COUNT):
        names = body.shelves[si] if si < len(body.shelves) else []
        cur = db.query(Box).filter_by(cabinet_id=ci, shelf=si).count()
        for bi, name in enumerate(names):
            if bi >= cur:
                break
            rename_box(db, ci, si, bi, name)
    return {'ok': True, 'cabinets': get_catalog(db)}


# ---------------- 柜体配置（数量 + 单开/对开可组合） ----------------
@app.get('/api/config')
def get_config(token: str = Depends(get_token), db: Session = Depends(get_db)):
    user = require_user(token, db)
    if not user:
        return err(401, '未登录')
    return {'ok': True, 'cabinets': get_catalog(db)}


@app.post('/api/config')
def save_config(body: ConfigIn, token: str = Depends(get_token), db: Session = Depends(get_db)):
    user = require_user(token, db)
    if not user:
        return err(401, '未登录')
    if not role_allowed(user.role, 'editor'):
        return err(403, '权限不足')
    cabs = body.cabinets
    if not (1 <= len(cabs) <= 20):
        return err(400, '柜子数量应为 1-20')
    for c in cabs:
        if c.doorType not in ('double', 'single'):
            return err(400, '门型只能为 对开(double) 或 单开(single)')
        if c.shelfColors is not None and (not isinstance(c.shelfColors, list) or len(c.shelfColors) != SHELF_COUNT):
            return err(400, f'每层颜色应为 {SHELF_COUNT} 个')
    apply_config(db, [{'name': c.name, 'doorType': c.doorType, 'shelfColors': c.shelfColors} for c in cabs])
    return {'ok': True, 'cabinets': get_catalog(db)}


# ---------------- 文件 ----------------
@app.get('/api/files')
def list_files(request: Request, cabinetId: int = Query(...), shelf: int = Query(...), slot: int = Query(...),
               token: str = Depends(get_token), db: Session = Depends(get_db)):
    user = require_user(token, db)
    if not user:
        return err(401, '未登录')
    rows = db.query(File).filter_by(box_cabinet_id=cabinetId, box_shelf=shelf, box_slot=slot).order_by(File.id).all()
    return {'ok': True, 'files': [file_out(f, token, request) for f in rows]}


@app.post('/api/files')
def upload_file(request: Request, body: UploadIn, token: str = Depends(get_token), db: Session = Depends(get_db)):
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
    # 上传文件后，目录管理的台账名称也相应同步为文件名（去扩展名）
    stem = Path(body.filename).stem
    if stem:
        row = db.query(Box).filter_by(cabinet_id=body.cabinetId, shelf=body.shelf, slot=body.slot).first()
        if row:
            row.name = stem
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
    return {'ok': True, 'file': file_out(f, token, request)}


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


@app.get('/api/files/{file_id}/preview')
def preview_file(file_id: int, page: int = Query(default=1), token: str = Depends(get_token), db: Session = Depends(get_db)):
    user = require_user(token, db)
    if not user:
        return err(401, '未登录')
    f = db.get(File, file_id)
    if not f:
        return err(404, '文件不存在')
    p = UPLOAD_DIR / f.stored_name
    if not p.exists():
        return err(404, '文件不存在')
    # 仅支持 PDF 转图片预览
    if f.mime != 'application/pdf':
        return err(400, '仅支持 PDF 在线预览')
    try:
        import fitz
        doc = fitz.open(str(p))
        if page < 1:
            page = 1
        if page > doc.page_count:
            page = doc.page_count
        pg = doc.load_page(page - 1)
        pix = pg.get_pixmap(matrix=fitz.Matrix(1.6, 1.6))  # 放大一点保证清晰
        data = pix.tobytes('png')
        doc.close()
        return Response(content=data, media_type='image/png',
                        headers={'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store'})
    except Exception as e:
        return err(500, 'PDF 预览失败：' + str(e))


@app.get('/api/files/{file_id}/pdf-info')
def pdf_info(file_id: int, token: str = Depends(get_token), db: Session = Depends(get_db)):
    user = require_user(token, db)
    if not user:
        return err(401, '未登录')
    f = db.get(File, file_id)
    if not f:
        return err(404, '文件不存在')
    p = UPLOAD_DIR / f.stored_name
    if not p.exists():
        return err(404, '文件不存在')
    if f.mime != 'application/pdf':
        return err(400, '仅支持 PDF')
    try:
        import fitz
        doc = fitz.open(str(p))
        count = doc.page_count
        doc.close()
        return {'ok': True, 'pageCount': count}
    except Exception as e:
        return err(500, 'PDF 读取失败：' + str(e))


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


# ---------------- 备份 / 还原 ----------------
@app.get('/api/backup')
def download_backup(token: str = Depends(get_token), db: Session = Depends(get_db)):
    user = require_user(token, db)
    if not user:
        return err(401, '未登录')
    if not role_allowed(user.role, 'admin'):
        return err(403, '权限不足')
    buf = build_backup(db)
    name = 'taizhang-backup-' + datetime.now().strftime('%Y%m%d-%H%M%S') + '.zip'
    return Response(
        content=buf,
        media_type='application/zip',
        headers={
            'Content-Disposition': "attachment; filename*=UTF-8''" + quote(name),
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store',
        },
    )


@app.post('/api/backup/restore')
def restore_backup(body: RestoreIn, token: str = Depends(get_token), db: Session = Depends(get_db)):
    user = require_user(token, db)
    if not user:
        return err(401, '未登录')
    if not role_allowed(user.role, 'admin'):
        return err(403, '权限不足')
    try:
        data = base64.b64decode(body.dataBase64)
        zf = zipfile.ZipFile(io.BytesIO(data))
        manifest = json.loads(zf.read('catalog.json').decode('utf-8'))
        if not isinstance(manifest.get('cabinets'), list):
            raise ValueError('备份文件缺少目录数据')
    except Exception as e:
        return err(400, '备份文件无效：' + str(e))
    restore_from_backup(db, zf, manifest)
    return {'ok': True, 'cabinets': get_catalog(db)}


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
