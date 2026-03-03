<#
.SYNOPSIS
    Register Aura auto-start tasks and install the git pre-commit hook.

.DESCRIPTION
    Uses two mechanisms that require no elevation and work from any context:

    1. Startup folder  -- drops aura-daemon.cmd into the user Startup folder.
       Fires health-check -Scope daemon at every Windows login.

    2. Git pre-commit hook -- copies scripts/hooks/pre-commit to .git/hooks/.
       Fires health-check -Scope full before every git commit.

    OPTIONAL (run separately from your own PowerShell if you want the
    30-minute background health check):
       See the note at the bottom of this script.

.EXAMPLE
    .\scriptsegister-scheduler.ps1
#>

$ErrorActionPreference = 'Stop'
$script:ProjectRoot  = Split-Path -Parent $PSScriptRoot
$script:HealthScript = Join-Path $script:ProjectRoot 'scripts\health-check.ps1'
$script:HookSrc      = Join-Path $script:ProjectRoot 'scripts\hooks\pre-commit'
$script:HookDst      = Join-Path $script:ProjectRoot '.git\hooks\pre-commit'

# ─── Helpers ──────────────────────────────────────────────────────────────────

function Write-Step { param([string]$Msg) Write-Host "[REGISTER] $Msg" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Msg) Write-Host "[  OK   ] $Msg" -ForegroundColor Green }
function Write-Fail { param([string]$Msg) Write-Host "[  ERR  ] $Msg" -ForegroundColor Red }
function Write-Note { param([string]$Msg) Write-Host "[  NOTE ] $Msg" -ForegroundColor Yellow }

# ─── Main ─────────────────────────────────────────────────────────────────────

Write-Step "Starting registration..."
Write-Step "Project root: $($script:ProjectRoot)"
Write-Host ""

# ── 1. Startup folder (login trigger) ─────────────────────────────────────────

Write-Step "Installing login trigger via Startup folder..."

$startupDir = [Environment]::GetFolderPath('Startup')
$cmdFile    = Join-Path $startupDir 'aura-daemon.cmd'

$cmdContent = "@echo off`r`n" `
    + 'powershell.exe -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden' `
    + ' -File "' + $script:HealthScript + '" -Scope daemon' `
    + "`r`n"

Set-Content -Path $cmdFile -Value $cmdContent -Encoding ASCII -NoNewline
Write-Ok "Startup script installed: $cmdFile"

# ── 2. Git pre-commit hook ────────────────────────────────────────────────────

Write-Host ""
Write-Step "Installing git pre-commit hook..."

$hooksDir = Join-Path $script:ProjectRoot '.git\hooks'
if (-not (Test-Path $hooksDir)) {
    Write-Fail ".git/hooks not found. Is this a git repository?"
    exit 1
}

if (-not (Test-Path $script:HookSrc)) {
    Write-Fail "Hook source not found: $($script:HookSrc)"
    exit 1
}

Copy-Item -Path $script:HookSrc -Destination $script:HookDst -Force
Write-Ok "Pre-commit hook installed: .git/hooks/pre-commit"

# ── Summary ───────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "  ============================================================" -ForegroundColor Cyan
Write-Host "   AURA AUTO-START REGISTERED" -ForegroundColor Cyan
Write-Host "  ============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "   Login trigger:" -ForegroundColor White
Write-Host "     $cmdFile" -ForegroundColor Gray
Write-Host "     Starts Librarian + Secretary at every Windows login." -ForegroundColor Gray
Write-Host ""
Write-Host "   Git hook:" -ForegroundColor White
Write-Host "     .git/hooks/pre-commit" -ForegroundColor Gray
Write-Host "     Starts all 4 agents before every git commit." -ForegroundColor Gray
Write-Host ""
Write-Note "Optional 30-min health check (run once from your own PowerShell):"
Write-Host "     Register-ScheduledTask -TaskName 'AuraDaemonHealthCheck'" -ForegroundColor DarkGray
Write-Host "       -Action (New-ScheduledTaskAction -Execute powershell.exe" -ForegroundColor DarkGray
Write-Host "         -Argument '-NonInteractive -ExecutionPolicy Bypass" -ForegroundColor DarkGray
Write-Host "           -File ""$($script:HealthScript)"" -Scope daemon')" -ForegroundColor DarkGray
Write-Host "       -Trigger (New-ScheduledTaskTrigger -RepetitionInterval" -ForegroundColor DarkGray
Write-Host "         (New-TimeSpan -Minutes 30) -Once -At (Get-Date))" -ForegroundColor DarkGray
Write-Host "       -Force" -ForegroundColor DarkGray
Write-Host ""
