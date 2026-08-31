"""领域服务：台账目录、柜体配置、备份还原（与 FastAPI 路由解耦）"""
import io
import json
import uuid
import zipfile
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from sqlalchemy.orm import Session

from backend import config
from backend.models import Box, Cabinet, File, User
from backend.security import clean_filename, hash_password, sanitize_extension


# ---------------- 基础工具 ----------------
def unlink_file(f: File):
    try:
        p = config.UPLOAD_DIR / f.stored_name
        if p.exists():
            p.unlink()
    except Exception:
        pass


def validate_position(db: Session, cabinet_id: int, shelf: int, slot: int = 0) -> Optional[str]:
    """校验台账位置；返回 None 表示合法，否则返回错误信息"""
    if not (0 <= cabinet_id < db.query(Cabinet).count()):
        return "柜号无效"
    if not (0 <= shelf < config.SHELF_COUNT):
        return "层号无效"
    if not (0 <= slot < config.MAX_BOXES_PER_SHELF):
        return "序号无效"
    return None


# ---------------- 目录 ----------------
def shelf_colors_of(c: Cabinet) -> list:
    if c.shelf_colors:
        try:
            colors = json.loads(c.shelf_colors)
            if isinstance(colors, list) and len(colors) >= config.SHELF_COUNT:
                return list(colors[:config.SHELF_COUNT])
        except Exception:
            pass
    return list(config.DEFAULT_SHELF_COLORS)


def get_catalog(db: Session) -> list:
    """一次查询全部柜子/台账，避免 N+1"""
    cabinets = db.query(Cabinet).order_by(Cabinet.sort).all()
    boxes = db.query(Box).order_by(Box.cabinet_id, Box.shelf, Box.slot).all()
    by_key: dict = {}
    by_code: dict = {}
    for b in boxes:
        by_key.setdefault((b.cabinet_id, b.shelf), {})[b.slot] = b.name
        by_code.setdefault((b.cabinet_id, b.shelf), {})[b.slot] = b.code or ''
    out = []
    for c in cabinets:
        shelves = []
        codes = []
        for s in range(config.SHELF_COUNT):
            m = by_key.get((c.id, s), {})
            cm = by_code.get((c.id, s), {})
            slots = sorted(m)
            shelves.append([m[i] for i in slots])
            codes.append([cm.get(i, '') for i in slots])
        out.append({
            "id": c.id,
            "name": c.name,
            "doorType": c.door_type,
            "shelfColors": shelf_colors_of(c),
            "shelves": shelves,
            "codes": codes,
        })
    return out


def ensure_box(db: Session, cabinet_id: int, shelf: int, slot: int) -> Box:
    row = db.query(Box).filter_by(cabinet_id=cabinet_id, shelf=shelf, slot=slot).first()
    if not row:
        row = Box(cabinet_id=cabinet_id, shelf=shelf, slot=slot, name="备用")
        db.add(row)
        db.flush()
    return row


def set_shelf_count(db: Session, cabinet_id: int, shelf: int, n: int) -> int:
    n = max(1, min(config.MAX_BOXES_PER_SHELF, int(n)))
    for b in range(n):
        ensure_box(db, cabinet_id, shelf, b)
    rows = db.query(Box).filter_by(cabinet_id=cabinet_id, shelf=shelf).filter(Box.slot >= n).all()
    for r in rows:
        for f in db.query(File).filter_by(box_cabinet_id=cabinet_id, box_shelf=shelf, box_slot=r.slot).all():
            unlink_file(f)
            db.delete(f)
        db.delete(r)
    db.commit()
    return n


def rename_box(db: Session, cabinet_id: int, shelf: int, slot: int, name: str, code: Optional[str] = None) -> None:
    name = (name or "").strip() or "备用"
    name = name[:128]
    ensure_box(db, cabinet_id, shelf, slot)
    row = db.query(Box).filter_by(cabinet_id=cabinet_id, shelf=shelf, slot=slot).first()
    row.name = name
    if code is not None:
        row.code = (code or "").strip()[:64]
    db.commit()


def reset_catalog(db: Session) -> None:
    for f in db.query(File).all():
        unlink_file(f)
        db.delete(f)
    for c in db.query(Cabinet).order_by(Cabinet.sort).all():
        for s in range(config.SHELF_COUNT):
            for b in range(config.DEFAULT_BOXES_PER_SHELF):
                ensure_box(db, c.id, s, b)
    for b in db.query(Box).filter(Box.name != "备用").all():
        b.name = "备用"
        b.code = ""
    db.commit()


def apply_config(db: Session, new_cabs: list) -> None:
    """按后台配置同步柜子数量与门型（单开/对开）。

    采用“内存重建”方式：先把旧柜数据读入内存，再重建 Cabinet 与 Box，
    保证数量/门型变化后数据不会错乱。
    """
    n = len(new_cabs)
    old = db.query(Cabinet).order_by(Cabinet.sort).all()
    old_count = len(old)
    # 1) 旧柜数据读入内存
    old_data = {}
    for i, cab in enumerate(old):
        shelves = []
        codes = []
        for s in range(config.SHELF_COUNT):
            rows = db.query(Box).filter_by(cabinet_id=cab.id, shelf=s).order_by(Box.slot).all()
            shelves.append([r.name for r in rows])
            codes.append([r.code or '' for r in rows])
        old_data[i] = {
            "name": cab.name,
            "doorType": cab.door_type,
            "shelfColors": cab.shelf_colors,
            "shelves": shelves,
            "codes": codes,
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
        name = (src.get("name") or "").strip() or f"{i + 1}号柜"
        door = "single" if src.get("doorType") == "single" else "double"
        colors = src.get("shelfColors") or None
        if colors and isinstance(colors, list):
            valid = [str(c)[:24] for c in colors[:config.SHELF_COUNT]]
            while len(valid) < config.SHELF_COUNT:
                valid.append(config.DEFAULT_SHELF_COLORS[len(valid)])
            colors_json = json.dumps(valid)
        else:
            colors_json = json.dumps(config.DEFAULT_SHELF_COLORS)
        db.add(Cabinet(id=i, name=name[:64], door_type=door, sort=i, shelf_colors=colors_json))
        old = old_data.get(i)
        for s in range(config.SHELF_COUNT):
            if old and s < len(old["shelves"]) and old["shelves"][s]:
                old_codes = old.get("codes") or []
                for b, nm in enumerate(old["shelves"][s]):
                    if b >= config.MAX_BOXES_PER_SHELF:
                        break
                    code = ''
                    if s < len(old_codes) and b < len(old_codes[s]):
                        code = (old_codes[s][b] or '')[:64]
                    db.add(Box(cabinet_id=i, shelf=s, slot=b, name=(nm or "备用")[:128], code=code))
            else:
                for b in range(config.DEFAULT_BOXES_PER_SHELF):
                    db.add(Box(cabinet_id=i, shelf=s, slot=b, name="备用"))
    db.commit()


def import_rows(db: Session, rows: list) -> dict:
    """批量导入：单事务处理，减少逐行提交"""
    imported = 0
    errors = []
    cab_count = db.query(Cabinet).count()
    for idx, r in enumerate(rows):
        line = idx + 1
        cabinet, layer, slot, name = r.cabinet, r.layer, r.slot, (r.name or "").strip()
        code = (getattr(r, "code", None) or "").strip()[:64]
        if not (1 <= cabinet <= cab_count):
            errors.append(f"第{line}行：柜号应为1-{cab_count}")
            continue
        if not (1 <= layer <= config.SHELF_COUNT):
            errors.append(f"第{line}行：层号应为1-{config.SHELF_COUNT}")
            continue
        if not (1 <= slot <= config.MAX_BOXES_PER_SHELF):
            errors.append(f"第{line}行：序号应为1-{config.MAX_BOXES_PER_SHELF}")
            continue
        if not name:
            errors.append(f"第{line}行：台账名称为空")
            continue
        ci = cabinet - 1
        si = config.SHELF_COUNT - layer  # 层号1=最上层 -> si=2
        bi = slot - 1
        cur = db.query(Box).filter_by(cabinet_id=ci, shelf=si).count()
        if cur < slot:
            set_shelf_count(db, ci, si, min(config.MAX_BOXES_PER_SHELF, slot))
        row = ensure_box(db, ci, si, bi)
        row.name = name[:128]
        row.code = code
        imported += 1
    db.commit()
    return {"imported": imported, "failed": len(errors), "errors": errors}


def update_catalog_shelf(db: Session, ci: int, names: List[str], codes: Optional[list] = None) -> None:
    """保存某柜全部名称（数量不变）"""
    for si in range(config.SHELF_COUNT):
        shelf_names = names[si] if si < len(names) else []
        cur = db.query(Box).filter_by(cabinet_id=ci, shelf=si).count()
        for bi, name in enumerate(shelf_names[:cur]):
            row = ensure_box(db, ci, si, bi)
            row.name = (name or "").strip()[:128] or "备用"
            if codes and si < len(codes) and bi < len(codes[si]):
                row.code = (codes[si][bi] or "").strip()[:64]
    db.commit()


# ---------------- 备份 / 还原 ----------------
def build_backup(db: Session) -> bytes:
    """把台账目录 + 已上传文件 + 用户打包成一个 zip（字节流）"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        manifest = {
            "version": 3,
            "createdAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "cabinets": get_catalog(db),
            "files": [],
            "users": [],
        }
        for f in db.query(File).order_by(File.id).all():
            p = config.UPLOAD_DIR / f.stored_name
            if not p.exists():
                continue
            safe_name = clean_filename(f.original_name)
            stored_name = f"files/{f.id}__{safe_name}"
            try:
                z.write(p, stored_name)
            except Exception:
                continue
            manifest["files"].append({
                "id": f.id,
                "cabinetId": f.box_cabinet_id,
                "shelf": f.box_shelf,
                "slot": f.box_slot,
                "originalName": safe_name,
                "storedName": stored_name,
                "mime": f.mime,
                "size": f.size,
            })
        for u in db.query(User).order_by(User.id).all():
            manifest["users"].append({
                "id": u.id,
                "username": u.username,
                "passwordHash": u.password_hash,
                "displayName": u.display_name or u.username,
                "role": u.role,
                "mustChangePassword": bool(u.must_change_password),
            })
        z.writestr("catalog.json", json.dumps(manifest, ensure_ascii=False, indent=2))
    return buf.getvalue()


def _validate_backup_manifest(manifest: dict) -> Optional[str]:
    if not isinstance(manifest, dict):
        return "备份文件无效"
    cabinets = manifest.get("cabinets")
    if not isinstance(cabinets, list) or not (1 <= len(cabinets) <= config.MAX_CABINETS):
        return "备份缺少有效的柜体配置"
    if not isinstance(manifest.get("files"), list) or len(manifest["files"]) > config.MAX_RESTORE_FILES:
        return "备份文件数量异常"
    users = manifest.get("users")
    if not isinstance(users, list) or len(users) > 500:
        return "备份用户数据异常"
    # 文件条目必须引用 zip 内 files/ 前缀的安全路径
    for fm in manifest["files"]:
        sn = fm.get("storedName", "")
        if not (isinstance(sn, str) and sn.startswith("files/")
                and ".." not in sn and not sn.startswith("/") and not sn.startswith("\\")):
            return "备份含非法文件路径"
    return None


def restore_from_backup(db: Session, zf: zipfile.ZipFile, manifest: dict) -> None:
    """按备份内容还原：目录、文件、用户（带安全校验）"""
    err = _validate_backup_manifest(manifest)
    if err:
        raise ValueError(err)
    cabinets = manifest.get("cabinets") or []
    # 0) 先按备份同步柜子数量、门型、名称、颜色
    apply_config(db, [{
        "doorType": src.get("doorType", "double"),
        "name": src.get("name", ""),
        "shelfColors": src.get("shelfColors"),
    } for src in cabinets])

    # 建立备份 cabinetId -> 当前柜序号的映射
    cab_id_map = {}
    for idx, src in enumerate(cabinets):
        cid = src.get("id", idx)
        cab_id_map[cid] = idx

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
        shelves = src.get("shelves") or []
        codes = src.get("codes") or []
        for si in range(config.SHELF_COUNT):
            names = shelves[si] if si < len(shelves) else []
            n = max(1, min(config.MAX_BOXES_PER_SHELF, len(names)))
            for bi in range(n):
                row = ensure_box(db, ci, si, bi)
                row.name = (names[bi] if bi < len(names) else "备用") or "备用"
                if si < len(codes) and bi < len(codes[si]):
                    row.code = (codes[si][bi] or "")[:64]
    db.flush()

    # 3) 还原文件（限制总解压大小，防 zip 炸弹）
    total_bytes = 0
    for fm in (manifest.get("files") or []):
        try:
            info = zf.getinfo(fm["storedName"])
            if info.file_size > config.MAX_UPLOAD_BYTES:
                continue
            total_bytes += info.file_size
            if total_bytes > config.MAX_BACKUP_BYTES:
                raise ValueError("备份文件过大")
            content = zf.read(info)
        except (KeyError, ValueError) as e:
            if isinstance(e, ValueError):
                raise
            continue
        raw_cid = fm.get("cabinetId", 0)
        mapped_ci = cab_id_map.get(raw_cid, raw_cid)
        if not (0 <= mapped_ci < len(cabinets)):
            continue
        f_shelf = fm.get("shelf", 0)
        f_slot = fm.get("slot", 0)
        if not (0 <= f_shelf < config.SHELF_COUNT and 0 <= f_slot < config.MAX_BOXES_PER_SHELF):
            continue
        ensure_box(db, mapped_ci, f_shelf, f_slot)
        ext = sanitize_extension(fm.get("originalName", ""))
        stored = f"{int(__import__('time').time() * 1000)}-{uuid.uuid4().hex[:12]}{ext}"
        (config.UPLOAD_DIR / stored).write_bytes(content)
        db.add(File(
            box_cabinet_id=mapped_ci,
            box_shelf=f_shelf,
            box_slot=f_slot,
            original_name=clean_filename(fm.get("originalName", "file")),
            stored_name=stored,
            mime=fm.get("mime") or "application/octet-stream",
            size=len(content),
            uploaded_by=None,
        ))
    db.flush()

    # 4) 还原用户（内置管理员始终为最高权限，不可被降级）
    users = manifest.get("users") or []
    if users:
        # 先把当前会话中的对象全部脱离，避免“身份映射已存在同 id 对象”告警
        db.expunge_all()
        db.query(User).delete(synchronize_session=False)
        for u in users:
            uid = u.get("id")
            username = (u.get("username") or "").strip()[:64]
            role = u.get("role", "viewer")
            if username == "admin":
                role = "admin"
            if role not in ("viewer", "editor", "admin"):
                role = "viewer"
            ph = u.get("passwordHash") or ""
            # 只接受合法 bcrypt 哈希，避免注入非法密码数据
            if not (isinstance(ph, str) and ph.startswith("$2")):
                continue
            db.add(User(
                id=uid if isinstance(uid, int) else None,
                username=username,
                password_hash=ph,
                display_name=(u.get("displayName") or username)[:64],
                role=role,
                must_change_password=1 if u.get("mustChangePassword") else 0,
            ))
        db.flush()

    # 保证至少有一个管理员账号；内置 admin 必须保持 admin 权限
    admin_user = db.query(User).filter_by(username="admin").first()
    if admin_user:
        if admin_user.role != "admin":
            admin_user.role = "admin"
    elif not db.query(User).filter_by(role="admin").first():
        db.add(User(username="admin", password_hash=hash_password("123456"),
                    display_name="系统管理员", role="admin", must_change_password=1))
    db.commit()
