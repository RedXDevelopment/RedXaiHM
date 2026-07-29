param(
  [string]$NodePath = (Get-Command node).Source,
  [string]$CliPath = (Resolve-Path "$PSScriptRoot\..\src\cli.js").Path,
  [string]$IconPath = "$PSScriptRoot\..\assets\redxai-file-icon.ico"
)

$ErrorActionPreference = "Stop"

function New-RedXIcon([string]$Destination) {
  Add-Type -AssemblyName System.Drawing
  $bitmap = New-Object System.Drawing.Bitmap 256, 256
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Rectangle 0, 0, 256, 256),
    ([System.Drawing.Color]::FromArgb(255, 255, 23, 79)),
    ([System.Drawing.Color]::FromArgb(255, 112, 0, 31)),
    45
  )
  $pen = New-Object System.Drawing.Pen $brush, 48
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $graphics.DrawLine($pen, 48, 48, 208, 208)
  $graphics.DrawLine($pen, 208, 48, 48, 208)
  $iconHandle = $bitmap.GetHicon()
  $icon = [System.Drawing.Icon]::FromHandle($iconHandle).Clone()
  $stream = [IO.File]::Create($Destination)
  try { $icon.Save($stream) } finally {
    $stream.Dispose()
    $icon.Dispose()
    $pen.Dispose()
    $brush.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

if (-not (Test-Path $IconPath)) {
  New-RedXIcon -Destination $IconPath
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
