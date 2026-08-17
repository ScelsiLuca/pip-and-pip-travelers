$ErrorActionPreference = 'Stop'
docker compose down
if ($LASTEXITCODE -eq 0) { Write-Host 'Pip & Pip Travelers arrestata.' -ForegroundColor Green }
