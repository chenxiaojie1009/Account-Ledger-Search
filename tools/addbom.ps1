$t = [System.IO.File]::ReadAllText('G:\new2\tools\icons.ps1', [System.Text.Encoding]::UTF8)
[System.IO.File]::WriteAllText('G:\new2\tools\icons.ps1', $t, (New-Object System.Text.UTF8Encoding($true)))
Write-Output 'BOM_ADDED'
