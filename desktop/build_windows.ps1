# Baut die native Printloom-Windows-App: Frontend -> PyInstaller-Bundle -> Inno-Installer.
#
# Voraussetzungen:
#   * .venv-build (Python 3.12 mit requirements + pyinstaller + pystray + pillow)
#       uv venv --python 3.12 .venv-build
#       uv pip install --python .venv-build/Scripts/python.exe -r backend/requirements.txt pyinstaller pystray pillow
#   * Node/npm (Frontend-Build)
#   * Inno Setup 6 (iscc.exe) — optional, nur für den Installer
#
# Aufruf (aus dem Repo-Root):  powershell -File desktop\build_windows.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot          # Repo-Root (desktop/..)
Set-Location $Root

$Py = Join-Path $Root ".venv-build\Scripts\python.exe"
if (-not (Test-Path $Py)) { throw "Build-venv fehlt: $Py — siehe Kommentar oben." }

$Version = (Get-Content (Join-Path $Root "backend\version.txt") -Raw).Trim()
Write-Host "== Printloom Windows-Build v$Version ==" -ForegroundColor Cyan

# 1) ffmpeg (einmalig; No-op, wenn vorhanden)
Write-Host "-- ffmpeg holen --" -ForegroundColor Yellow
& $Py "desktop\fetch_ffmpeg.py"

# 2) Frontend bauen
Write-Host "-- Frontend bauen --" -ForegroundColor Yellow
Push-Location (Join-Path $Root "frontend")
npm run build
Pop-Location

# 3) PyInstaller-Bundle (One-File → dist\Printloom.exe)
Write-Host "-- PyInstaller-Bundle --" -ForegroundColor Yellow
if (Test-Path "build")  { Remove-Item "build"  -Recurse -Force }
if (Test-Path "dist\Printloom.exe") { Remove-Item "dist\Printloom.exe" -Force }
& $Py -m PyInstaller "desktop\printloom.spec" --noconfirm --distpath dist --workpath build
if (-not (Test-Path "dist\Printloom.exe")) { throw "PyInstaller-Bundle fehlgeschlagen." }

# 4) Inno-Setup-Installer (falls iscc verfügbar)
$Iscc = (Get-Command iscc.exe -ErrorAction SilentlyContinue)
if (-not $Iscc) {
  foreach ($p in @("$env:ProgramFiles(x86)\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe")) {
    if (Test-Path $p) { $Iscc = $p; break }
  }
}
if ($Iscc) {
  Write-Host "-- Installer bauen --" -ForegroundColor Yellow
  $isccPath = if ($Iscc -is [System.Management.Automation.CommandInfo]) { $Iscc.Source } else { $Iscc }
  & $isccPath "/DMyAppVersion=$Version" "desktop\installer.iss"
  Write-Host "Installer: desktop\Output\Printloom-Setup-$Version.exe" -ForegroundColor Green
} else {
  Write-Host "Inno Setup (iscc.exe) nicht gefunden — Installer uebersprungen." -ForegroundColor DarkYellow
  Write-Host "Bundle liegt unter dist\Printloom\ (portabel startbar via Printloom.exe)." -ForegroundColor DarkYellow
}

Write-Host "== Fertig ==" -ForegroundColor Cyan
