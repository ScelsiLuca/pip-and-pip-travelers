$ErrorActionPreference = 'Stop'
docker compose down
if ($LASTEXITCODE -eq 0) { Write-Host 'Sicily Live Dashboard arrestata.' -ForegroundColor Green }

