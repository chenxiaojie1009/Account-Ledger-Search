# 台账查找系统 v2.3.0

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

默认管理员账号：**admin / 123456**（可在首次登录后于「用户」页自行修改或新增账号）。

## 服务器地址

- 后端数据服务（APK 使用）：`http://<服务器IP>:10600`。
- 后台管理网页：`http://<服务器IP>:10600/admin`（输入 `http://<服务器IP>:10600` 会自动跳转；admin / 123456 登录）。
- APK 三维界面浏览器预览（可选）：`http://<服务器IP>:10500`（需要运行 `npm run start:web`）。
- Android App：登录时「后端地址」填 `http://192.168.1.10:10600`。

## 数据

- 数据库：`data/app.db`（SQLite，Python SQLAlchemy，无需安装数据库）。
- 上传文件：`data/uploads/`。

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

