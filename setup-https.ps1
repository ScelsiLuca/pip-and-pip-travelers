$ErrorActionPreference = 'Stop'
if (-not (Get-Command mkcert -ErrorAction SilentlyContinue)) {
  throw 'mkcert non trovato. Installalo con: winget install FiloSottile.mkcert (oppure Chocolatey/Scoop), poi riesegui lo script.'
}
$lanIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object {
    $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and
    $_.InterfaceAlias -notmatch 'Loopback|vEthernet|Docker|VMware|VirtualBox|Hyper-V' -and
    $_.InterfaceAlias -match 'Ethernet|Wi-Fi|WLAN'
  } | Select-Object -First 1 -ExpandProperty IPAddress
if (-not $lanIp) { throw 'IP LAN non rilevato.' }
New-Item -ItemType Directory -Force -Path (Join-Path $PSScriptRoot 'certs') | Out-Null
mkcert -install
mkcert -cert-file (Join-Path $PSScriptRoot 'certs\sicily.pem') -key-file (Join-Path $PSScriptRoot 'certs\sicily-key.pem') localhost 127.0.0.1 $lanIp
$caRoot = mkcert -CAROOT
Copy-Item -LiteralPath (Join-Path $caRoot 'rootCA.pem') -Destination (Join-Path $PSScriptRoot 'certs\rootCA.pem') -Force
Write-Host "Certificato creato per https://${lanIp}:8443" -ForegroundColor Green
Write-Warning 'Installa SOLO certs\rootCA.pem sull’iPhone. Non condividere mai rootCA-key.pem o sicily-key.pem.'

