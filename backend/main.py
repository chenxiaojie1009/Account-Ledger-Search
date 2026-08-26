"""台账查找 - FastAPI 后端入口（Windows 部署 / PyInstaller 单文件 EXE）"""
import io
import os
import sys

import uvicorn

from backend.app import create_app

app = create_app()

if __name__ == "__main__":
    # 打包为无控制台 EXE 时 sys.stdout/stderr 可能为 None，会导致 uvicorn
    # 配置日志时 None.isatty() 报错，这里用哑字符串流兜底。
    if sys.stdout is None:
        sys.stdout = io.StringIO()
    if sys.stderr is None:
        sys.stderr = io.StringIO()

    PORT_API = int(os.environ.get("PORT_API", 10600))
    print(f"[台账查找] 后端数据服务已启动: http://0.0.0.0:{PORT_API}")
    print(f"[台账查找] APK 登录时后端地址填: http://<电脑IP>:{PORT_API}")
    print("[台账查找] 安全提示: 默认管理员首次登录会被强制要求修改密码；")
    print("[台账查找]            可在环境变量 TZ_ALLOWED_IPS 设置客户端 IP 白名单。")
    uvicorn.run(app, host="0.0.0.0", port=PORT_API, log_level="info", log_config=None)
