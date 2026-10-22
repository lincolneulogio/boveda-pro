$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  throw 'Instala Node.js 20.9 o posterior y pnpm antes de continuar.'
}
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  throw 'Instala Rust estable con el objetivo MSVC: https://v2.tauri.app/start/prerequisites/'
}

Push-Location $ProjectRoot
try {
  pnpm install --frozen-lockfile
  pnpm desktop:build
  Write-Host ''
  Write-Host 'Instaladores generados:'
  Get-ChildItem 'src-tauri/target/release/bundle' -Recurse -Include '*.exe','*.msi' -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty FullName
} finally {
  Pop-Location
}
