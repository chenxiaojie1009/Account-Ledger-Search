Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'
$root = 'G:\new2\android\app\src\main\res'

function RoundedRectPath($x, $y, $w, $h, $r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = 2 * $r
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

# 设计空间 1000x1000：三个档案柜 + 放大镜
function Draw-Design($g) {
  $white = [System.Drawing.Color]::FromArgb(255, 255, 255, 255)
  $stripe = [System.Drawing.Color]::FromArgb(255, 213, 228, 248)

  $whiteBrush = New-Object System.Drawing.SolidBrush($white)
  $stripeBrush = New-Object System.Drawing.SolidBrush($stripe)
  $pen = New-Object System.Drawing.Pen($white, 36)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

  # 三个柜子：宽150 高250 圆角20，底边 y=740
  foreach ($cx in @(430, 500, 570)) {
    $x0 = $cx - 75
    $path = RoundedRectPath $x0 490 150 250 20
    $g.FillPath($whiteBrush, $path)
    foreach ($sy in @(550, 605, 660)) {
      $g.FillRectangle($stripeBrush, $x0 + 12, $sy, 126, 8)
    }
  }

  # 放大镜：圆心(500,300) r=85
  $g.DrawEllipse($pen, 415, 215, 170, 170)
  $g.DrawLine($pen, 560, 360, 645, 445)

  $pen.Dispose(); $whiteBrush.Dispose(); $stripeBrush.Dispose()
}

function New-IconFull($size, $file) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

  $bgPath = RoundedRectPath (0.02 * $size) (0.02 * $size) (0.96 * $size) (0.96 * $size) (0.19 * $size)
  $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect,
    [System.Drawing.Color]::FromArgb(255, 121, 169, 245),
    [System.Drawing.Color]::FromArgb(255, 78, 133, 231), 135)
  $g.FillPath($brush, $bgPath)

  $s = $size * 0.90 / 1000.0
  $g.TranslateTransform($size / 2 - $s * 500, $size / 2 - $s * 477.5)
  $g.ScaleTransform($s, $s)
  Draw-Design $g
  $g.ResetTransform()

  $brush.Dispose(); $g.Dispose()
  $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

function New-IconFg($size, $file) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.Clear([System.Drawing.Color]::Transparent)

  # 内容高度适配到画布 52%（自适应图标安全区）
  $s = $size * 0.52 / 525.0
  $g.TranslateTransform($size / 2 - $s * 500, $size / 2 - $s * 477.5)
  $g.ScaleTransform($s, $s)
  Draw-Design $g
  $g.ResetTransform()

  $g.Dispose()
  $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

# 1) 传统图标（带背景圆角）
$fullSizes = @{ 'mipmap-mdpi' = 48; 'mipmap-hdpi' = 72; 'mipmap-xhdpi' = 96; 'mipmap-xxhdpi' = 144; 'mipmap-xxxhdpi' = 192 }
foreach ($dir in $fullSizes.Keys) {
  $sz = $fullSizes[$dir]
  New-IconFull $sz "$root\$dir\ic_launcher.png"
  New-IconFull $sz "$root\$dir\ic_launcher_round.png"
}

# 2) 自适应图标前景
$fgSizes = @{ 'mipmap-mdpi' = 108; 'mipmap-hdpi' = 162; 'mipmap-xhdpi' = 216; 'mipmap-xxhdpi' = 324; 'mipmap-xxxhdpi' = 432 }
foreach ($dir in $fgSizes.Keys) {
  $sz = $fgSizes[$dir]
  New-IconFg $sz "$root\$dir\ic_launcher_foreground.png"
}

# 3) 自适应图标背景色（drawable 矢量 + values 颜色）
Set-Content -Path "$root\drawable\ic_launcher_background.xml" -Encoding UTF8 -Value '<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportHeight="108"
    android:viewportWidth="108">
    <path android:fillColor="#4E85E7" android:pathData="M0,0h108v108h-108z" />
</vector>'
Set-Content -Path "$root\values\ic_launcher_background.xml" -Encoding UTF8 -Value '<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#4E85E7</color>
</resources>'

# 4) 启动页 splash（1280x800 浅色渐变 + 居中图标）
$sp = New-Object System.Drawing.Bitmap(1280, 800)
$sg = [System.Drawing.Graphics]::FromImage($sp)
$sg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$srect = New-Object System.Drawing.Rectangle(0, 0, 1280, 800)
$sbrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($srect,
  [System.Drawing.Color]::FromArgb(255, 234, 242, 251),
  [System.Drawing.Color]::FromArgb(255, 210, 226, 244), 135)
$sg.FillRectangle($sbrush, $srect)
$sg.TranslateTransform(640 - 0.24 * 500, 400 - 0.24 * 477.5)
$sg.ScaleTransform(0.24, 0.24)
Draw-Design $sg
$sg.ResetTransform()
$sbrush.Dispose(); $sg.Dispose()
$sp.Save("$root\drawable\splash.png", [System.Drawing.Imaging.ImageFormat]::Png)
$sp.Dispose()

Write-Output 'ICONS_DONE'
