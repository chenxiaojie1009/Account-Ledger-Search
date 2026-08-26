Set-Location 'G:\Account-Ledger-Search-main'
if (-not (Test-Path '.git')) { git init 2>&1 | Out-Null }
git config user.name "chenxiaojie"
git config user.email "chenxiaojie@users.noreply.github.com"
git add -A 2>$null
git -c core.quotepath=false commit -m "v2.3.0: 主页点击直接恢复视图避免卡顿、目录自动检测轮询改为20分钟、移除柜门把手与悬浮名称标签、上传文件不再覆盖台账名称、登录信息记忆、后台层色对应修复、admin权限锁定、数据库重置为初始状态" 2>&1 | Select-Object -Last 6
Write-Output '--- git log ---'
git log --oneline -3 2>&1
Write-Output '--- tracked files ---'
(git ls-files | Measure-Object -Line).Lines
Write-Output '--- status ---'
git status --short 2>&1 | Select-Object -First 10
