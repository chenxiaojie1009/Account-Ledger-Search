"""全局配置：路径、密钥、安全策略与可调参数。

所有“内网安全”相关阈值都可通过环境变量调整，方便不同部署环境
（例如 TZ_ALLOWED_IPS 只放行指定的平板/电脑 IP）。
"""
import os
import secrets
import sys
from pathlib import Path


def _data_dir() -> Path:
    # 打包为 EXE 时数据放在 EXE 同级的 data 目录；开发时放在项目根 data 目录
    if getattr(sys, 'frozen', False):
        return Path(sys.executable).parent / 'data'
    return Path(__file__).resolve().parent.parent / 'data'


DATA_DIR = _data_dir()
UPLOAD_DIR = DATA_DIR / 'uploads'
DB_FILE = DATA_DIR / 'app.db'
SECRET_FILE = DATA_DIR / 'secret.key'
AUDIT_LOG_FILE = DATA_DIR / 'audit.log'

DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def _load_or_create_secret() -> bytes:
    """签名密钥：优先环境变量，否则在 data/secret.key 持久化一个随机密钥。

    每次部署应使用独立密钥，禁止使用硬编码默认值（防止伪造会话/票据）。
    """
    env = os.environ.get('TZ_SECRET_KEY')
    if env:
        return env.encode('utf-8')
    if SECRET_FILE.exists():
        try:
            return SECRET_FILE.read_bytes().strip()
        except OSError:
            pass
    key = secrets.token_bytes(32)
    try:
        SECRET_FILE.write_bytes(key)
        try:
            os.chmod(SECRET_FILE, 0o600)
        except OSError:
            pass
    except OSError:
        pass  # 目录不可写时退化为进程内随机密钥（进程重启后会话失效）
    return key


SECRET_KEY = _load_or_create_secret()

# ---- 认证 / 会话 ----
TOKEN_TTL_DAYS = int(os.environ.get('TZ_TOKEN_TTL_DAYS', '7'))
# 文件访问票据有效期（秒）。票据只用于“临时取文件”，过期自动失效
FILE_TICKET_TTL_SECONDS = int(os.environ.get('TZ_FILE_TICKET_TTL', '600'))

# ---- 密码策略 ----
MIN_PASSWORD_LEN = int(os.environ.get('TZ_MIN_PASSWORD_LEN', '8'))

# ---- 登录限流 / 锁定 ----
LOGIN_MAX_FAILS = int(os.environ.get('TZ_LOGIN_MAX_FAILS', '5'))
LOGIN_LOCK_SECONDS = int(os.environ.get('TZ_LOGIN_LOCK_SECONDS', '900'))
# 普通接口按 IP 的每分钟请求上限（防脚本批量抓取材料）
REQ_RATE_LIMIT = int(os.environ.get('TZ_REQ_RATE_LIMIT', '600'))

# ---- 上传 / 备份 ----
MAX_UPLOAD_BYTES = int(os.environ.get('TZ_MAX_UPLOAD_MB', '25')) * 1024 * 1024
MAX_BACKUP_BYTES = int(os.environ.get('TZ_MAX_BACKUP_MB', '200')) * 1024 * 1024
MAX_RESTORE_FILES = int(os.environ.get('TZ_MAX_RESTORE_FILES', '2000'))

# ---- 访问控制 ----
# 只读用户（viewer）默认只允许预览，不允许下载原始文件；设 TZ_VIEWER_CAN_DOWNLOAD=1 可放开
VIEWER_CAN_DOWNLOAD = os.environ.get('TZ_VIEWER_CAN_DOWNLOAD', '0') == '1'
# 可选的客户端 IP 白名单（逗号分隔，支持单个 IP 与 CIDR，如 192.168.1.0/24）。
# 留空 = 不限制（仅依赖账号体系）；设置后仅白名单内可访问，直接阻止内网其他人扫描/抓取
ALLOWED_IPS = [s.strip() for s in os.environ.get('TZ_ALLOWED_IPS', '').split(',') if s.strip()]
# 可选 CORS 来源白名单（逗号分隔）。默认只允许同源与 localhost 的 WebView/预览页
ALLOWED_ORIGINS = [s.strip() for s in os.environ.get('TZ_ALLOWED_ORIGINS', '').split(',') if s.strip()]

# ---- 上传文件类型限制 ----
# 危险扩展名默认禁止上传（防止上传可执行脚本/网页后被内网其他人当钓鱼入口）
BLOCKED_EXTENSIONS = {
    '.html', '.htm', '.xhtml', '.shtml', '.svg', '.xml', '.xsd', '.xsl', '.xslt',
    '.js', '.mjs', '.cjs', '.jsonp', '.css',
    '.exe', '.dll', '.com', '.msi', '.bat', '.cmd', '.ps1', '.vbs', '.vbe', '.jsx', '.wsf',
    '.sh', '.bash', '.py', '.pl', '.rb', '.php', '.php3', '.php4', '.php5', '.phtml',
    '.asp', '.aspx', '.ashx', '.jsp', '.jspx', '.jar', '.war', '.apk', '.app',
    '.scr', '.pif', '.lnk', '.reg', '.hta', '.msc', '.tmp', '.url',
}

# 上传时只接受这些 MIME 类型（其余一律按 octet-stream 存储，且只能以附件方式下载）
ALLOWED_MIME_PREFIXES = (
    'image/', 'text/', 'application/pdf',
    'application/vnd.ms-', 'application/vnd.openxmlformats-',
    'application/msword', 'application/x-ms', 'application/zip',
    'application/x-rar', 'application/x-7z-compressed', 'application/octet-stream',
)

CABINET_COUNT = 6
SHELF_COUNT = 3
CABINET_DOORS = ['double', 'double', 'single', 'double', 'double', 'single']
DEFAULT_BOXES_PER_SHELF = 15
MAX_BOXES_PER_SHELF = 40
DEFAULT_SHELF_COLORS = ['#E5484D', '#FF8A3D', '#F5C93C']
MAX_CABINETS = 20
