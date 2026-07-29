param(
  [string]$NodePath = (Get-Command node).Source,
  [string]$CliPath = (Resolve-Path "$PSScriptRoot\..\src\cli.js").Path,
  [string]$IconPath = "$PSScriptRoot\..\assets\redxai-file-icon.ico"
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path $IconPath)) {
  $encoded = Get-Content "$PSScriptRoot\..\assets\redxai-file-icon.ico.b64" -Raw
  [IO.File]::WriteAllBytes($IconPath, [Convert]::FromBase64String($encoded.Trim()))
}
$IconPath = (Resolve-Path $IconPath).Path
$classes = "HKCU:\Software\Classes"
New-Item -Path "$classes\.RedXai" -Force | Out-Null
Set-ItemProperty -Path "$classes\.RedXai" -Name "(default)" -Value "RedXaiHM.Database"

New-Item -Path "$classes\RedXaiHM.Database" -Force | Out-Null
Set-ItemProperty -Path "$classes\RedXaiHM.Database" -Name "(default)" -Value "RedXaiHM Database"

New-Item -Path "$classes\RedXaiHM.Database\DefaultIcon" -Force | Out-Null
Set-ItemProperty -Path "$classes\RedXaiHM.Database\DefaultIcon" -Name "(default)" -Value $IconPath

New-Item -Path "$classes\RedXaiHM.Database\shell\open\command" -Force | Out-Null
$command = ('"{0}" "{1}" edit "%1"' -f $NodePath, $CliPath)
Set-ItemProperty -Path "$classes\RedXaiHM.Database\shell\open\command" -Name "(default)" -Value $command

Write-Host ".RedXai files are now associated with RedXaiHM Editor."
