<#
.SYNOPSIS
    Aura Health-Check -- verify agents are alive, start dead ones.

.DESCRIPTION
    Called by: Task Scheduler (daemon scope) and git pre-commit hook (full scope).
    Detects running node agents via Get-CimInstance Win32_Process.
    Starts any agent that is not currently running.

.PARAMETER Scope
    daemon  -- Librarian + Secretary only (Task Scheduler).
    full    -- All four persistent agents (git pre-commit hook).

.EXAMPLE
    .\scripts\health-check.ps1 -Scope daemon
    .\scripts\health-check.ps1 -Scope full
#>

param(
    [ValidateSet('daemon', 'full')]
    [string]$Scope = 'daemon'
)

$ErrorActionPreference = 'Stop'
$script:ProjectRoot    = Split-Path -Parent $PSScriptRoot
$script:DistDir        = Join-Path $script:ProjectRoot 'dist'
$script:LogsDir        = Join-Path $script:ProjectRoot 'data\logs'

# ─── Ensure data/logs exists ──────────────────────────────────────────────────

if (-not (Test-Path $script:LogsDir)) {
    New-Item -ItemType Directory -Path $script:LogsDir -Force | Out-Null
}

# ─── Agent registry ───────────────────────────────────────────────────────────

# Always = true  → included in both daemon and full scope
# Always = false → only included in full scope

$script:AgentRegistry = @(
    [PSCustomObject]@{
        Name   = 'librarian'
        Script = Join-Path $script:DistDir 'agents\librarian.js'
        Always = $true
    }
    [PSCustomObject]@{
        Name   = 'secretary'
        Script = Join-Path $script:DistDir 'agents\secretary.js'
        Always = $true
    }
    [PSCustomObject]@{
        Name   = 'chronicler'
        Script = Join-Path $script:DistDir 'agents\chronicler.js'
        Always = $false
    }
    [PSCustomObject]@{
        Name   = 'strategist'
        Script = Join-Path $script:DistDir 'agents\strategist.js'
        Always = $false
    }
)

# ─── Helpers ──────────────────────────────────────────────────────────────────

function Get-RunningAgents {
    $running = @{}
    try {
        Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | ForEach-Object {
            $cmd = $_.CommandLine
            if ($null -ne $cmd -and $cmd -match 'agents[/\\](\w+)\.js') {
                $running[$Matches[1]] = $_.ProcessId
            }
        }
    } catch {
        Write-Host "[HEALTH] Warning: could not query Win32_Process: $_" -ForegroundColor Yellow
    }
    return $running
}

function Start-AgentProcess {
    param([string]$Name, [string]$ScriptPath)

    $stdout = Join-Path $script:LogsDir ($Name + '-stdout.log')
    $stderr = Join-Path $script:LogsDir ($Name + '-stderr.log')

    try {
        $proc = Start-Process `
            -FilePath 'node' `
            -ArgumentList $ScriptPath `
            -WorkingDirectory $script:ProjectRoot `
            -RedirectStandardOutput $stdout `
            -RedirectStandardError  $stderr `
            -WindowStyle Hidden `
            -PassThru

        if ($null -ne $proc -and -not $proc.HasExited) {
            Write-Host "[HEALTH] Started $Name (PID=$($proc.Id))" -ForegroundColor Green
            return $true
        } else {
            Write-Host "[HEALTH] $Name launched but exited immediately." -ForegroundColor Red
            return $false
        }
    } catch {
        Write-Host "[HEALTH] Error starting ${Name}: $_" -ForegroundColor Red
        return $false
    }
}

# ─── Main ─────────────────────────────────────────────────────────────────────

$toCheck = if ($Scope -eq 'full') {
    $script:AgentRegistry
} else {
    $script:AgentRegistry | Where-Object { $_.Always }
}

$running = Get-RunningAgents
$started = 0

foreach ($agent in $toCheck) {
    $name = $agent.Name

    if ($running.ContainsKey($name)) {
        Write-Host "[HEALTH] $name is alive (PID=$($running[$name]))" -ForegroundColor DarkGray
    } else {
        if (Test-Path $agent.Script) {
            $ok = Start-AgentProcess -Name $name -ScriptPath $agent.Script
            if ($ok) { $started++ }
        } else {
            Write-Host "[HEALTH] ${name}: dist script not found -- run npm run build first." -ForegroundColor Yellow
        }
    }
}

if ($started -gt 0) {
    Write-Host "[HEALTH] $started agent(s) started. Waiting 2s for init..." -ForegroundColor Cyan
    Start-Sleep -Seconds 2
} else {
    Write-Host "[HEALTH] All agents nominal. Scope=$Scope" -ForegroundColor DarkGray
}
