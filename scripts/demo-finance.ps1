# demo-finance.ps1
# Aura — Financial Demo Automation
# Drives a 2-3 minute demo of the local-first financial intelligence pipeline.
# Run: .\scripts\demo-finance.ps1

[CmdletBinding()]
param()

$script:ProjectRoot = Split-Path -Parent $PSScriptRoot

Write-Host "[demo] Starting Aura Financial Intelligence Demo" -ForegroundColor Cyan
Write-Host "[demo] Project root: $script:ProjectRoot" -ForegroundColor DarkCyan
Write-Host "" 

# Step 1: Open monitor in new terminal window
Write-Host "[demo] Step 1: Opening monitor dashboard..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit -Command "" -WorkingDirectory $script:ProjectRoot
Start-Sleep -Seconds 3

# Step 2 (Wi-Fi ON): Drop bank statement
Write-Host "[demo] Step 2 (Wi-Fi ON): Dropping JPMC bank statement..." -ForegroundColor Yellow
$src1 = Join-Path $script:ProjectRoot 'scripts\demo-assets\JPMC_Statement_Feb2026.pdf'
$dst1 = Join-Path $env:USERPROFILE 'Downloads\JPMC_Statement_Feb2026.pdf'
Copy-Item -Path $src1 -Destination $dst1 -Force
Write-Host "[demo] JPMC_Statement_Feb2026.pdf dropped -> watch the chain fire" -ForegroundColor Green
Start-Sleep -Seconds 5

# Step 3 (Wi-Fi ON): Drop tax document
Write-Host "[demo] Step 3 (Wi-Fi ON): Dropping 1040 tax return..." -ForegroundColor Yellow
$src2 = Join-Path $script:ProjectRoot 'scripts\demo-assets\TaxReturn_1040_2025.pdf'
$dst2 = Join-Path $env:USERPROFILE 'Downloads\TaxReturn_1040_2025.pdf'
Copy-Item -Path $src2 -Destination $dst2 -Force
Write-Host "[demo] TaxReturn_1040_2025.pdf dropped" -ForegroundColor Green
Start-Sleep -Seconds 3

Write-Host "" 
Write-Host "[demo] >>> ACTION REQUIRED <<<" -ForegroundColor Red
Write-Host "[demo] NOW: toggle Wi-Fi OFF in Windows taskbar (bottom-right)" -ForegroundColor Red
Write-Host "[demo] Then press Enter to continue the demo..." -ForegroundColor Red
Read-Host

# Step 4 (Wi-Fi OFF - money shot): Drop investment summary
Write-Host "[demo] Step 4 (Wi-Fi OFF - money shot): Dropping investment summary..." -ForegroundColor Yellow
$src3 = Join-Path $script:ProjectRoot 'scripts\demo-assets\Investment_Summary_Q1_2026.pdf'
$dst3 = Join-Path $env:USERPROFILE 'Downloads\Investment_Summary_Q1_2026.pdf'
Copy-Item -Path $src3 -Destination $dst3 -Force
Write-Host "[demo] Investment_Summary_Q1_2026.pdf dropped" -ForegroundColor Green
Write-Host "[demo] Watch monitor process offline - Wi-Fi indicator should show OFF" -ForegroundColor Cyan
Write-Host "[demo] Wealth Action Plan will still be generated. Toast will still fire." -ForegroundColor Cyan
Start-Sleep -Seconds 5

Write-Host "" 
Write-Host "[demo] Demo sequence complete. Check:" -ForegroundColor Green
Write-Host "  1. agents/secretary/strategy-vault/finance/ for Wealth Action Plans" -ForegroundColor White
Write-Host "  2. data/logs/financial-advisor.log for processing log" -ForegroundColor White
Write-Host "  3. data/signals/wealth-action-plan.json for last signal" -ForegroundColor White
Write-Host "  4. data/logs/*.log for NO network errors" -ForegroundColor White
