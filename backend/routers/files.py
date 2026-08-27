"""文件：列表 / 上传 / 下载（短时效票据） / 加水印预览 / 删除"""
import base64
import io
import uuid
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from sqlalchemy.orm import Session

from backend import config
from backend.audit import audit
from backend.database import get_db
from backend.deps import get_active_context, require_role
from backend.models import File, User
from backend.schemas import UploadIn
from backend.security import (
    can_download_files, clean_filename, client_ip, extension_blocked,
    make_file_ticket, normalize_mime, sanitize_extension, verify_file_ticket,
)
from backend.services import ensure_box, unlink_file, validate_position

router = APIRouter(prefix="/api/files", tags=["files"])

# 允许以内联方式直接展示的 MIME（其余一律附件下载，防存储型 XSS）
_INLINE_MIME = {
    "image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp",
    "application/pdf", "text/plain", "text/csv", "text/markdown", "application/json",
}

_SAFE_MIME = {
    "image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp",
    "application/pdf", "text/plain", "text/csv", "text/markdown", "application/json",
    "application/vnd.ms-excel", "application/msword", "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/zip", "application/x-rar", "application/x-7z-compressed",
    "application/octet-stream",
}


def _is_image(f: File) -> bool:
    return (f.mime or "").startswith("image/") and f.mime != "image/svg+xml"


def _is_pdf(f: File) -> bool:
    return f.mime == "application/pdf" or Path(f.original_name).suffix.lower() == ".pdf"


def _file_urls(f: File, ctx, request: Request) -> dict:
    base = str(request.base_url).rstrip("/")
    ticket = make_file_ticket(ctx.user, ctx.jti, f.id)
    t = quote(ticket, safe="")
    name = quote(f.original_name, safe="")
    dl = f"{base}/api/files/{f.id}/download?ticket={t}&name={name}"
    if _is_image(f) or _is_pdf(f):
        preview = f"{base}/api/files/{f.id}/preview?ticket={t}&page=1"
    else:
        preview = f"{dl}&download=0"
    return {"url": dl, "previewUrl": preview, "downloadable": can_download_files(ctx.user)}


def _file_out(f: File, ctx, request: Request) -> dict:
    urls = _file_urls(f, ctx, request)
    return {
        "id": f.id,
        "cabinetId": f.box_cabinet_id,
        "shelf": f.box_shelf,
        "slot": f.box_slot,
        "originalName": f.original_name,
        "mime": f.mime,
        "size": f.size,
        "createdAt": f.created_at.strftime("%Y-%m-%d %H:%M:%S") if f.created_at else "",
        "url": urls["url"],
        "previewUrl": urls["previewUrl"],
        "downloadable": urls["downloadable"],
    }


@router.get("")
def list_files(request: Request, cabinetId: int = Query(...), shelf: int = Query(...),
               slot: int = Query(...), ctx=Depends(get_active_context), db: Session = Depends(get_db)):
    err = validate_position(db, cabinetId, shelf, slot)
    if err:
        return {"ok": False, "error": err}
    rows = db.query(File).filter_by(box_cabinet_id=cabinetId, box_shelf=shelf, box_slot=slot).order_by(File.id).all()
    return {"ok": True, "files": [_file_out(f, ctx, request) for f in rows]}


@router.post("")
def upload_file(request: Request, body: UploadIn, user: User = Depends(require_role("editor")),
                ctx=Depends(get_active_context), db: Session = Depends(get_db)):
    err = validate_position(db, body.cabinetId, body.shelf, body.slot)
    if err:
        return {"ok": False, "error": err}
    try:
        data = base64.b64decode(body.dataBase64)
    except Exception:
        return {"ok": False, "error": "文件内容解码失败"}
    if len(data) > config.MAX_UPLOAD_BYTES:
        return {"ok": False, "error": "文件过大"}
    if len(data) == 0:
        return {"ok": False, "error": "文件为空"}
    clean = clean_filename(body.filename)
    if extension_blocked(clean):
        return {"ok": False, "error": "该文件类型禁止上传（防脚本/网页等危险文件）"}
    ext = sanitize_extension(clean)
    stored = f"{int(__import__('time').time() * 1000)}-{uuid.uuid4().hex[:12]}{ext}"
    (config.UPLOAD_DIR / stored).write_bytes(data)
    ensure_box(db, body.cabinetId, body.shelf, body.slot)
    f = File(
        box_cabinet_id=body.cabinetId,
        box_shelf=body.shelf,
        box_slot=body.slot,
        original_name=clean,
        stored_name=stored,
        mime=normalize_mime(body.mime, clean),
        size=len(data),
        uploaded_by=user.id,
    )
    db.add(f)
    db.commit()
    audit(db, user, "file_upload", f"上传 {clean}（{len(data)} 字节）到 {body.cabinetId + 1}号柜", client_ip(request))
    return {"ok": True, "file": _file_out(f, ctx, request)}


def _resolve_file(db: Session, ticket: str):
    """校验票据并返回 (user, file)；失败返回错误响应"""
    if not ticket:
        return None, {"ok": False, "error": "缺少访问票据"}
    got = verify_file_ticket(db, ticket)
    if not got:
        return None, {"ok": False, "error": "访问票据无效或已过期，请刷新后重试"}
    user, _sess, file_id = got
    f = db.get(File, file_id)
    if not f:
        return None, {"ok": False, "error": "文件不存在"}
    return (user, f), None


@router.get("/{file_id}/download")
def download_file(request: Request, file_id: int, ticket: str = Query(default=""),
                  download: str = Query(default="1"), db: Session = Depends(get_db)):
    resolved, err_resp = _resolve_file(db, ticket)
    if err_resp:
        return err_resp
    user, f = resolved
    mode = "preview" if download == "0" else "download"
    if mode == "download" and not can_download_files(user):
        return {"ok": False, "error": "只读用户仅可预览，不能下载原始文件"}
    p = config.UPLOAD_DIR / f.stored_name
    if not p.exists():
        return {"ok": False, "error": "文件不存在"}
    ip = client_ip(request)
    if mode == "preview":
        audit(db, user, "file_view", f"预览 {f.original_name}（{f.id}）", ip)
        disposition = "inline"
        media_type = f.mime if f.mime in _INLINE_MIME else "application/octet-stream"
    else:
        audit(db, user, "file_download", f"下载 {f.original_name}（{f.id}）", ip)
        disposition = "attachment"
        media_type = f.mime if f.mime in _SAFE_MIME else "application/octet-stream"
    headers = {
        "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(f.original_name)}",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    }
    return FileResponse(p, media_type=media_type, headers=headers)


@router.get("/{file_id}/preview")
def preview_file(request: Request, file_id: int, page: int = Query(default=1),
                 ticket: str = Query(default=""), db: Session = Depends(get_db)):
    resolved, err_resp = _resolve_file(db, ticket)
    if err_resp:
        return err_resp
    user, f = resolved
    p = config.UPLOAD_DIR / f.stored_name
    if not p.exists():
        return {"ok": False, "error": "文件不存在"}
    if not (_is_image(f) or _is_pdf(f)):
        return {"ok": False, "error": "仅支持图片 / PDF 在线预览"}
    try:
        import fitz
    except Exception:
        return {"ok": False, "error": "服务器缺少预览组件"}
    try:
        data = _watermark_render(f, p, page, user)
    except Exception:
        return {"ok": False, "error": "预览渲染失败"}
    audit(db, user, "file_view", f"预览 {f.original_name}（{f.id}）第{page}页", client_ip(request))
    return Response(content=data, media_type="image/png",
                    headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


def _watermark_render(f: File, p: Path, page: int, user: User) -> bytes:
    import fitz
    who = (user.display_name or user.username) or "未知用户"
    stamp = f"内部资料 · {who} · {datetime.now().strftime('%Y-%m-%d %H:%M')}"
    if _is_pdf(f):
        doc = fitz.open(str(p))
        if page < 1:
            page = 1
        if page > doc.page_count:
            page = doc.page_count
        pg = doc.load_page(page - 1)
        _stamp_page(pg, stamp)
        pix = pg.get_pixmap(matrix=fitz.Matrix(1.5, 1.5))
        data = pix.tobytes("png")
        doc.close()
        return data
    # 图片：转成 PDF 页后统一加水印
    pix0 = fitz.Pixmap(str(p))
    doc = fitz.open()
    pg = doc.new_page(width=pix0.width, height=pix0.height)
    pg.insert_image(pg.rect, filename=str(p))
    _stamp_page(pg, stamp)
    pix = pg.get_pixmap(matrix=fitz.Matrix(1.0, 1.0))
    data = pix.tobytes("png")
    doc.close()
    return data


def _stamp_page(pg, stamp: str):
    """在页面底部与中央斜向压上“内部资料”水印"""
    import math
    rect = pg.rect
    try:
        pg.insert_text((36, rect.height - 36), stamp, fontsize=14,
                       color=(0.62, 0.62, 0.62), fontname="china-s")
        # 中央斜向水印：PyMuPDF 的 insert_text 的 rotate 参数只接受 0/90/180/270，
        # 传 45 会抛 ValueError('bad rotate value')，导致整段水印退化为英文；
        # 改用 morph（旋转矩阵）实现真正的 45° 斜向压印。
        rad = math.radians(45)
        rot = fitz.Matrix(math.cos(rad), math.sin(rad), -math.sin(rad), math.cos(rad), 0, 0)
        pg.insert_text((rect.width / 2 - 180, rect.height / 2), stamp, fontsize=18,
                       color=(0.75, 0.75, 0.75), fontname="china-s",
                       morph=(fitz.Point(rect.width / 2, rect.height / 2), rot))
    except Exception:
        # 兜底（如极旧版 PyMuPDF 或打包环境不支持 morph 时）：
        # 底部仍压中文水印，并在页面中部叠一行横向中文水印，保证“内部资料”可见。
        try:
            pg.insert_text((36, rect.height - 36), stamp, fontsize=14,
                           color=(0.62, 0.62, 0.62), fontname="china-s")
            pg.insert_text((rect.width / 2 - 150, rect.height / 2), stamp, fontsize=16,
                           color=(0.75, 0.75, 0.75), fontname="china-s")
        except Exception:
            pg.insert_text((36, rect.height - 36), "INTERNAL USE ONLY", fontsize=14, color=(0.62, 0.62, 0.62))


@router.get("/{file_id}/pdf-info")
def pdf_info(file_id: int, ticket: str = Query(default=""), db: Session = Depends(get_db)):
    resolved, err_resp = _resolve_file(db, ticket)
    if err_resp:
        return err_resp
    _user, f = resolved
    if not _is_pdf(f):
        return {"ok": False, "error": "仅支持 PDF"}
    p = config.UPLOAD_DIR / f.stored_name
    if not p.exists():
        return {"ok": False, "error": "文件不存在"}
    try:
        import fitz
        doc = fitz.open(str(p))
        count = doc.page_count
        doc.close()
        return {"ok": True, "pageCount": count}
    except Exception:
        return {"ok": False, "error": "PDF 读取失败"}


@router.delete("/{file_id}")
def delete_file(file_id: int, request: Request, user: User = Depends(require_role("editor")),
                db: Session = Depends(get_db)):
    f = db.get(File, file_id)
    if not f:
        return {"ok": False, "error": "文件不存在"}
    name = f.original_name
    unlink_file(f)
    db.delete(f)
    db.commit()
    audit(db, user, "file_delete", f"删除 {name}（{file_id}）", client_ip(request))
    return {"ok": True}
