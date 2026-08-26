"""备份 / 还原（仅管理员）"""
import base64
import io
import json
import zipfile
from datetime import datetime
from urllib.parse import quote

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from backend import config
from backend.audit import audit
from backend.database import get_db
from backend.deps import require_role
from backend.models import User
from backend.schemas import RestoreIn
from backend.security import client_ip
from backend.services import build_backup, restore_from_backup

router = APIRouter(prefix="/api", tags=["backup"])


@router.get("/backup")
def download_backup(request: Request, user: User = Depends(require_role("admin")),
                    db: Session = Depends(get_db)):
    buf = build_backup(db)
    name = "taizhang-backup-" + datetime.now().strftime("%Y%m%d-%H%M%S") + ".zip"
    audit(db, user, "backup_download", "下载全量备份", client_ip(request))
    return Response(
        content=buf,
        media_type="application/zip",
        headers={
            "Content-Disposition": "attachment; filename*=UTF-8''" + quote(name),
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post("/backup/restore")
def restore_backup(body: RestoreIn, request: Request, user: User = Depends(require_role("admin")),
                   db: Session = Depends(get_db)):
    try:
        data = base64.b64decode(body.dataBase64)
    except Exception:
        return {"ok": False, "error": "备份文件解码失败"}
    if len(data) > config.MAX_BACKUP_BYTES:
        return {"ok": False, "error": "备份文件过大"}
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
        # 防 zip 炸弹：限制内部条目数量与总大小
        infos = zf.infolist()
        if len(infos) > config.MAX_RESTORE_FILES + 10:
            return {"ok": False, "error": "备份文件条目异常"}
        if sum(i.file_size for i in infos) > config.MAX_BACKUP_BYTES:
            return {"ok": False, "error": "备份文件过大"}
        manifest = json.loads(zf.read("catalog.json").decode("utf-8"))
        if not isinstance(manifest.get("cabinets"), list):
            raise ValueError("备份文件缺少目录数据")
    except Exception as e:
        return {"ok": False, "error": "备份文件无效：" + str(e)}
    try:
        restore_from_backup(db, zf, manifest)
    except ValueError as e:
        return {"ok": False, "error": "还原失败：" + str(e)}
    audit(db, user, "backup_restore", "从备份还原数据", client_ip(request))
    from backend.services import get_catalog
    return {"ok": True, "cabinets": get_catalog(db)}
