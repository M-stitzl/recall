<#
.SYNOPSIS
  Sichert die Recall-Datenbank (alle Daten inklusive Benutzerkonto) nach backups/.

.DESCRIPTION
  Standard: lokale Supabase-Instanz.  -Linked: das verknüpfte Cloud-Projekt (`supabase link`).
  Behält die letzten 30 Sicherungen. Für das tägliche Backup als Aufgabe einplanen:

    schtasks /Create /SC DAILY /ST 21:00 /TN "Recall Backup" `
      /TR "powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\<du>\recall\scripts\backup.ps1 -Linked"

  Wiederherstellen (lokal testen!):
    pnpm exec supabase db reset --no-seed
    Get-Content backups\recall-<datum>.sql | docker exec -i supabase_db_recall psql -U postgres -v ON_ERROR_STOP=1
#>
param(
  [switch]$Linked,
  [int]$Keep = 30
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$backupDir = Join-Path $root "backups"
New-Item -ItemType Directory -Force $backupDir | Out-Null

$stamp = Get-Date -Format "yyyy-MM-dd_HHmm"
$scope = if ($Linked) { "cloud" } else { "lokal" }
$file = Join-Path $backupDir "recall-$scope-$stamp.sql"

Push-Location $root
try {
  $target = if ($Linked) { "--linked" } else { "--local" }
  pnpm exec supabase db dump $target --data-only -f $file
  if ($LASTEXITCODE -ne 0) { throw "supabase db dump ist fehlgeschlagen (Exit-Code $LASTEXITCODE)." }
}
finally {
  Pop-Location
}

$size = (Get-Item $file).Length
if ($size -lt 200) { throw "Backup ist verdächtig klein ($size Bytes): $file" }

Get-ChildItem $backupDir -Filter "recall-$scope-*.sql" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -Skip $Keep |
  Remove-Item -Confirm:$false

Write-Output "Backup geschrieben: $file ($([math]::Round($size / 1KB, 1)) KB)"
