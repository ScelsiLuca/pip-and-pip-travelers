$ErrorActionPreference = 'Stop'
Write-Host "`n=====================================" -ForegroundColor DarkYellow
Write-Host " SICILY LIVE DASHBOARD" -ForegroundColor Yellow
Write-Host "=====================================" -ForegroundColor DarkYellow
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker non trovato. Installa e avvia Docker Desktop.' }
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { throw 'Avvio Docker non riuscito.' }
$lanIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object {
    $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and
    $_.InterfaceAlias -notmatch 'Loopback|vEthernet|Docker|VMware|VirtualBox|Hyper-V' -and
    $_.InterfaceAlias -match 'Ethernet|Wi-Fi|WLAN'
  } |
  Select-Object -First 1 -ExpandProperty IPAddress
Write-Host "`nSicily Dashboard running`n" -ForegroundColor Green
Write-Host "Local:`nhttp://localhost:8080`n"
if ($lanIp) { Write-Host "LAN:`nhttp://${lanIp}:8080`n" -ForegroundColor Cyan }
else { Write-Warning 'IP LAN non rilevato. Esegui ipconfig.' }
