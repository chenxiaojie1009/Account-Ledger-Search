"""目录（台账）与柜体配置"""
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from backend import config
from backend.audit import audit
from backend.database import get_db
from backend.deps import get_active_user, require_role
from backend.models import User
from backend.schemas import ConfigIn, ImportIn, RenameIn, SetCountIn, UpdateCatalogIn
from backend.security import client_ip
from backend.services import (
    apply_config, get_catalog, import_rows, rename_box, reset_catalog,
    set_shelf_count, update_catalog_shelf, validate_position,
)

router = APIRouter(prefix="/api", tags=["catalog"])


def _catalog_resp(db: Session):
    return {"ok": True, "cabinets": get_catalog(db)}


@router.get("/catalog")
def catalog(user: User = Depends(get_active_user), db: Session = Depends(get_db)):
    return _catalog_resp(db)


@router.get("/config")
def get_config(user: User = Depends(get_active_user), db: Session = Depends(get_db)):
    return _catalog_resp(db)


@router.post("/set-count")
def set_count(body: SetCountIn, request: Request, user: User = Depends(require_role("editor")),
              db: Session = Depends(get_db)):
    err = validate_position(db, body.cabinetId, body.shelf)
    if err:
        return {"ok": False, "error": err}
    n = set_shelf_count(db, body.cabinetId, body.shelf, body.count)
    audit(db, user, "catalog_update",
          f"柜{body.cabinetId + 1} 第{config.SHELF_COUNT - body.shelf}层 数量调整为{n}", client_ip(request))
    return {"ok": True, "count": n, "cabinets": get_catalog(db)}


@router.post("/rename")
def rename(body: RenameIn, request: Request, user: User = Depends(require_role("editor")),
           db: Session = Depends(get_db)):
    err = validate_position(db, body.cabinetId, body.shelf, body.slot)
    if err:
        return {"ok": False, "error": err}
    rename_box(db, body.cabinetId, body.shelf, body.slot, body.name, body.code)
    audit(db, user, "catalog_update",
          f"柜{body.cabinetId + 1} 第{config.SHELF_COUNT - body.shelf}层 第{body.slot + 1}个 重命名",
          client_ip(request))
    return _catalog_resp(db)


@router.post("/update-catalog")
def update_catalog(body: UpdateCatalogIn, request: Request, user: User = Depends(require_role("editor")),
                   db: Session = Depends(get_db)):
    err = validate_position(db, body.cabinetId, 0)
    if err:
        return {"ok": False, "error": err}
    update_catalog_shelf(db, body.cabinetId, body.shelves, body.codes)
    audit(db, user, "catalog_update", f"柜{body.cabinetId + 1} 批量保存名称", client_ip(request))
    return _catalog_resp(db)


@router.post("/reset")
def reset(request: Request, user: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    reset_catalog(db)
    audit(db, user, "catalog_reset", "恢复默认目录", client_ip(request))
    return _catalog_resp(db)


@router.post("/import")
def import_names(body: ImportIn, request: Request, user: User = Depends(require_role("editor")),
                 db: Session = Depends(get_db)):
    if len(body.rows) > 20000:
        return {"ok": False, "error": "单次导入行数过多"}
    r = import_rows(db, body.rows)
    audit(db, user, "import", f"导入 {r['imported']} 条，失败 {r['failed']} 条", client_ip(request))
    return {"ok": True, "imported": r["imported"], "failed": r["failed"],
            "errors": r["errors"], "cabinets": get_catalog(db)}


@router.post("/config")
def save_config(body: ConfigIn, request: Request, user: User = Depends(require_role("editor")),
                db: Session = Depends(get_db)):
    cabs = body.cabinets
    if not (1 <= len(cabs) <= config.MAX_CABINETS):
        return {"ok": False, "error": f"柜子数量应为 1-{config.MAX_CABINETS}"}
    for c in cabs:
        if c.doorType not in ("double", "single"):
            return {"ok": False, "error": "门型只能为 对开(double) 或 单开(single)"}
        if c.shelfColors is not None and (not isinstance(c.shelfColors, list) or len(c.shelfColors) != config.SHELF_COUNT):
            return {"ok": False, "error": f"每层颜色应为 {config.SHELF_COUNT} 个"}
    apply_config(db, [{"name": c.name, "doorType": c.doorType, "shelfColors": c.shelfColors} for c in cabs])
    audit(db, user, "config_update", f"柜体配置更新（{len(cabs)} 个柜）", client_ip(request))
    return _catalog_resp(db)
