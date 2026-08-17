$ErrorActionPreference = 'Stop'
if (-not (Test-Path (Join-Path $PSScriptRoot 'certs\sicily.pem'))) { throw 'Certificato assente. Esegui prima .\setup-https.ps1' }
docker compose -f docker-compose.yml -f docker-compose.https.yml up -d --build
if ($LASTEXITCODE -ne 0) { throw 'Avvio HTTPS non riuscito.' }
$lanIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.InterfaceAlias -match 'Ethernet|Wi-Fi|WLAN' -and $_.InterfaceAlias -notmatch 'VMware|VirtualBox|vEthernet' -and $_.IPAddress -notmatch '^(127\.|169\.254\.)' } |
  Select-Object -First 1 -ExpandProperty IPAddress
Write-Host "HTTPS: https://${lanIp}:8443" -ForegroundColor Cyan
Write-Host "HTTP fallback: http://${lanIp}:8080"

