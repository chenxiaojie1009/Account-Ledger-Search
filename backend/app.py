"""FastAPI 应用装配：中间件、启动初始化、路由挂载"""
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from backend import config
from backend.database import ADMIN_WEB_DIR, WWW_DIR, Base, SessionLocal, engine
from backend.models import Box, Cabinet, User
from backend.routers import audit as audit_router
from backend.routers import auth as auth_router
from backend.routers import backup as backup_router
from backend.routers import catalog as catalog_router
from backend.routers import files as files_router
from backend.routers import users as users_router
from backend.security import client_ip, hash_password, ip_allowed, request_allowed, verify_password

VERSION = "4.1.0"

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cache-Control": "no-store",
}
ADMIN_CSP = (
    "default-src 'self'; "
    "script-src 'self' 'unsafe-inline'; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; "
    "font-src 'self' data:; "
    "connect-src 'self'; "
    "object-src 'none'; "
    "frame-ancestors 'none'; "
    "base-uri 'self'; "
    "form-action 'self'"
)

# 默认允许的来源：本机 WebView / 预览页 / 局域网访问 / 鸿蒙本地资源页(null)（可在 TZ_ALLOWED_ORIGINS 追加）
_DEFAULT_ORIGIN_REGEX = r"(https?://.*|null)"


def _cors_origins() -> list:
    origins = list(config.ALLOWED_ORIGINS)
    return origins


def _init_db():
    Base.metadata.create_all(bind=engine)
    # 旧库升级：补齐新列
    with engine.connect() as conn:
        for stmt in (
            "ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0",
            "ALTER TABLE users ADD COLUMN last_login_at DATETIME",
            "ALTER TABLE boxes ADD COLUMN code VARCHAR(64) DEFAULT ''",
        ):
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                pass
    _seed()


def _seed():
    with SessionLocal() as db:
        force = os.environ.get("TZ_FORCE_DEFAULT_PWD_CHANGE", "1") == "1"
        admin = db.query(User).filter_by(username="admin").first()
        if not admin:
            admin = User(username="admin", password_hash=hash_password("123456"),
                         display_name="系统管理员", role="admin", must_change_password=1)
            db.add(admin)
        elif force and verify_password("123456", admin.password_hash):
            admin.must_change_password = 1  # 仍在使用默认密码 → 强制修改
        db.flush()  # autoflush=False，先落库再查“是否还有管理员”
        if db.query(Cabinet).count() == 0:
            for i in range(config.CABINET_COUNT):
                db.add(Cabinet(id=i, name=f"{i + 1}号柜",
                               door_type=config.CABINET_DOORS[i], sort=i))
        if db.query(Box).count() == 0:
            for c in range(config.CABINET_COUNT):
                for s in range(config.SHELF_COUNT):
                    for b in range(config.DEFAULT_BOXES_PER_SHELF):
                        db.add(Box(cabinet_id=c, shelf=s, slot=b, name="备用"))
        # 保证至少存在一个管理员
        if not db.query(User).filter_by(role="admin").first():
            db.add(User(username="admin", password_hash=hash_password("123456"),
                        display_name="系统管理员", role="admin", must_change_password=1))
        db.commit()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _init_db()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="台账查找后端", version=VERSION, lifespan=lifespan)

    # 自定义安全中间件（先注册，CORS 最后注册使其处于最外层）
    @app.middleware("http")
    async def security_guard(request: Request, call_next):
        ip = client_ip(request)
        if not ip_allowed(ip):
            return JSONResponse({"ok": False, "error": "当前设备不在允许访问的 IP 白名单内"},
                                status_code=403, headers=dict(SECURITY_HEADERS))
        if not request_allowed(ip):
            return JSONResponse({"ok": False, "error": "请求过于频繁，请稍后再试"},
                                status_code=429, headers=dict(SECURITY_HEADERS))
        response = await call_next(request)
        for k, v in SECURITY_HEADERS.items():
            response.headers.setdefault(k, v)
        if request.url.path.startswith("/admin"):
            response.headers.setdefault("Content-Security-Policy", ADMIN_CSP)
        return response

    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins(),
        allow_origin_regex=_DEFAULT_ORIGIN_REGEX,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization"],
        expose_headers=["Content-Disposition"],
    )

    @app.get("/", include_in_schema=False)
    def root():
        # 根地址自动跳到后台管理网页，避免误以为 10600 没有页面
        return RedirectResponse("/admin")

    app.include_router(auth_router.router)
    app.include_router(catalog_router.router)
    app.include_router(files_router.router)
    app.include_router(backup_router.router)
    app.include_router(users_router.router)
    app.include_router(audit_router.router)

    if ADMIN_WEB_DIR.exists():
        app.mount("/admin", StaticFiles(directory=str(ADMIN_WEB_DIR), html=True), name="admin")

    # 三维定位前端（www）：鸿蒙/浏览器同源加载入口，避免跨域
    if WWW_DIR.exists():
        app.mount("/www", StaticFiles(directory=str(WWW_DIR), html=True), name="www")

    return app
