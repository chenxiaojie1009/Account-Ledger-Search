# 台账查找系统 v4.0.0

基于 Three.js 的台账位置查找仿真系统，前端连接服务器数据库，支持目录统一维护、文件上传与查看、用户与权限管理。

## 功能

- **三维场景**：根据实拍照片建模，六个柜子（对开 / 对开 / 单开 / 对开 / 对开 / 单开），米灰柜体 + 玻璃门 + 彩色台账盒。
- **搜索定位**：搜索台账名称，自动飞行定位并高亮。
- **详情查看**：点击任一台账，显示所在位置、名称，并查看该台账下统一上传的文件（图片 / PDF / 文本）。
- **后台管理（网页）**：浏览器打开 `http://<服务器IP>:10600/admin` 登录后可管理：
  - 目录：每个柜子每层台账数量最多 **40** 个，名称可改，数量可增删。
  - 导入：下载 CSV 模板（柜号,层号,序号,台账名称），用 Excel 填好名称后上传批量导入。
  - 文件：上传 / 删除台账文件，统一存储在服务器。
  - 用户：管理员可新增 / 修改角色（只读 / 编辑 / 管理员）、重置密码、删除用户。
  - 备份 / 还原：一键下载备份 zip（台账目录 + 上传文件 + 用户账号），导入即可按备份直接还原。
  - APK 只做查看，不做后台管理。

## 角色权限

| 角色 | 目录 | 导入 | 文件 | 用户管理 |
| ---- | ---- | ---- | ---- | -------- |
| 只读 viewer | 查看 | 无 | 查看 | 无 |
| 编辑 editor | 编辑 | 是 | 上传 / 删除 | 无 |
| 管理员 admin | 编辑 | 是 | 上传 / 删除 | 是 |

## 运行

```bash
# 开发后端（数据接口 + 后台管理网页）
python -m backend.main     # 数据接口 http://127.0.0.1:10600，后台管理 http://127.0.0.1:10600/admin
# 或 Node 版（备选，单端口 10600，仅数据接口）
npm start                  # http://127.0.0.1:10600

# APK 三维界面浏览器预览（可选，非 APK 必需；配合后端 10600）
npm run start:web          # http://127.0.0.1:10500

npm run qa                 # 端到端 QA（需先启动后端 10600 与 start:web 10500）
```

默认管理员账号：**admin / 123456**，**首次登录会被强制要求修改初始密码**（修改后才能使用系统；可在「用户」页继续新增账号）。

## 内网安全（v3.0 起，当前 v4.0.0）

针对“防止通过内网偷取资料”，后端做了以下加固（Python 版与 Node 版行为一致）：

- **默认密码强制修改**：admin / 123456 首次登录后必须改成新密码才能使用任何功能；其它接口在改密前一律返回 403。
- **服务端会话**：登录令牌对应服务器会话记录，登出 / 改密 / 删号 / 被重置密码都会立即吊销，不再有“假登出”。令牌默认 7 天过期（`TZ_TOKEN_TTL_DAYS`）。
- **文件短时效票据**：下载/预览 URL 只携带 10 分钟有效的独立票据（`TZ_FILE_TICKET_TTL`），主登录令牌不再出现在网址、浏览器历史或服务器日志中。
- **登录限流与锁定**：同一 IP + 账号连续失败 5 次锁定 15 分钟（`TZ_LOGIN_MAX_FAILS`、`TZ_LOGIN_LOCK_SECONDS`）；普通接口按 IP 限流（`TZ_REQ_RATE_LIMIT`，默认 600 次/分）。
- **只读用户不能下载**：viewer 只允许在线预览，禁止下载原始文件（可设 `TZ_VIEWER_CAN_DOWNLOAD=1` 放开）；图片 / PDF 预览由服务器叠加“内部资料 + 用户名 + 时间”水印。
- **上传消毒**：文件名去路径、扩展名白名单、危险类型（html/js/exe/bat 等）禁止上传，MIME 收敛到安全集合，下载按附件方式下发并加 `nosniff`。
- **操作审计**：登录、登录失败、文件上传 / 预览 / 下载、备份还原、用户管理等全部记入 `data/app.db` 的审计表，后台管理页新增「操作日志」页（仅管理员可见）。
- **IP 白名单（可选）**：设 `TZ_ALLOWED_IPS=192.168.1.0/24,192.168.1.10` 后，仅白名单内设备可访问，直接挡住内网其它人的扫描与抓取。
- **安全响应头 / 受限 CORS**：全站 `nosniff`、禁止被 iframe 嵌入、后台页 CSP、只允许本机 / 局域网 / 配置来源跨域（`TZ_ALLOWED_ORIGINS` 可追加）。
- **随机签名密钥**：首次启动在 `data/secret.key` 生成随机密钥（可设 `TZ_SECRET_KEY` 覆盖），不再使用硬编码密钥。

环境变量速查（均可选）：

| 变量 | 默认 | 说明 |
| ---- | ---- | ---- |
| `TZ_ALLOWED_IPS` | 空 | 客户端 IP 白名单，逗号分隔，支持 CIDR |
| `TZ_VIEWER_CAN_DOWNLOAD` | 0 | 设为 1 允许只读用户下载原始文件 |
| `TZ_TOKEN_TTL_DAYS` | 7 | 登录令牌有效期（天） |
| `TZ_FILE_TICKET_TTL` | 600 | 文件票据有效期（秒） |
| `TZ_LOGIN_MAX_FAILS` | 5 | 登录失败锁定阈值 |
| `TZ_LOGIN_LOCK_SECONDS` | 900 | 锁定时间（秒） |
| `TZ_MIN_PASSWORD_LEN` | 8 | 最短密码长度（同时要求含字母和数字） |
| `TZ_FORCE_DEFAULT_PWD_CHANGE` | 1 | 设为 0 可跳过“默认密码强制修改” |
| `TZ_SECRET_KEY` | 随机生成 | 签名密钥，部署多实例时需保持一致 |
| `TZ_ALLOWED_ORIGINS` | 本机/局域网 | 额外允许的跨域来源 |

> 注意：Node 备选后端（`npm start`）不包含 PDF 加水印预览能力（图片预览可用），生产环境建议使用 Python 版 `TaizhangBackend.exe`。

## 服务器地址

- 后端数据服务（APK 使用）：`http://<服务器IP>:10600`。
- 后台管理网页：`http://<服务器IP>:10600/admin`（输入 `http://<服务器IP>:10600` 会自动跳转；admin / 123456 登录）。
- APK 三维界面浏览器预览（可选）：`http://<服务器IP>:10500`（需要运行 `npm run start:web`）。
- Android App：登录时「后端地址」填 `http://192.168.1.10:10600`。

## 数据

- 数据库：`data/app.db`（SQLite，Python SQLAlchemy，无需安装数据库）。
- 上传文件：`data/uploads/`。
- 签名密钥：`data/secret.key`（自动生成，请勿删除；删除后所有登录态与文件票据失效）。
- 操作审计：`data/app.db` 审计表 + `data/audit.log`（文本行，便于运维检索）。

## 构建 Android

```bash
npm run cap:sync
npm run build:apk
```

> 注意：Android 已开启 `cleartext`，允许通过 HTTP 连接局域网服务器。

## 构建 iOS / iPad

> iOS 构建必须在 **macOS + Xcode** 环境下进行（Windows 无法编译 iOS）。

```bash
# 1. 同步前端资源到 iOS 工程
npm run cap:sync:ios

# 2. 用 Xcode 打开工程
npm run cap:open:ios
# 或手动打开 ios/App/App.xcworkspace

# 3. 在 Xcode 中：
#    - 选择签名团队（Signing & Capabilities → Team）
#    - 选择目标设备（iPad 模拟器或真机）
#    - 点击 Run 运行，或 Product → Archive 打包
```

配置说明：
- Bundle ID：`com.taizhang.sim`
- 最低系统：iOS 13.0
- 设备支持：iPhone + iPad（`TARGETED_DEVICE_FAMILY = 1,2`）
- 已开启 ATS 明文访问（`NSAllowsArbitraryLoads`），可连接局域网 HTTP 后端
- 首次在 Mac 上打开后需执行 `pod install`（Capacitor sync 会自动执行）

## Windows 部署（平板 + 电脑局域网）

```text
后端（Windows 电脑，免安装 Python/Node）：
  1. 在 backend 目录双击 build_backend.bat 生成 TaizhangBackend.exe。
  2. 把 TaizhangBackend.exe 与 deploy 文件夹拷贝到 Windows 电脑。
  3. 双击 deploy\启动.vbs（静默启动后端，自动打开后台管理网页 http://127.0.0.1:10600/admin）。
  4. 后台管理登录：admin / 123456（可新增 editor / viewer 用户）。

平板（Android APK）：
  1. 安装 dist 目录的 APK（或 android 重新打包）。
  2. 平板与电脑连同一局域网。
  3. 电脑 ipconfig 查看 IP（如 192.168.1.5）。
  4. 打开 App，登录界面「后端地址」填 http://192.168.1.5:10600。
  5. 登录后即可查看三维柜子、搜索台账、查看文件（只读，后台管理请用网页 /admin）。
```

