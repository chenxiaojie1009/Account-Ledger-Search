$t = [System.IO.File]::ReadAllText('G:\new2\tools\icons.ps1', [System.Text.Encoding]::UTF8)
$errs = $null
[System.Management.Automation.PSParser]::Tokenize($t, [ref]$errs) | Out-Null
if ($errs) {
  foreach ($e in $errs) { Write-Output ("ERR: " + $e.Message + " @line " + $e.Token.StartLine + " : '" + $e.Token.Content + "'") }
} else {
  Write-Output 'PARSE_OK'
}
