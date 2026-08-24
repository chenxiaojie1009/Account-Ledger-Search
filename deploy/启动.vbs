Option Explicit
Dim shell, fso, base, exe
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
exe = base & "\TaizhangBackend.exe"
If fso.FileExists(exe) Then
  ' 静默启动后端（10600：数据接口 + 后台管理网页 /admin）
  shell.Run """" & exe & """", 0, False
  WScript.Sleep 2500
  shell.Run "http://127.0.0.1:10600/admin", 1, False
Else
  ' 未打包 Exe 时回退到 Node 版后端（单端口 10600）
  shell.Run "cmd /c cd /d """ & fso.GetParentFolderName(base) & """ && node server.js", 0, False
  WScript.Sleep 2000
  shell.Run "http://127.0.0.1:10600", 1, False
End If
