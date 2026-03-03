<#
.SYNOPSIS
    Aura Squad Boot Script — Operation Watchtower
    The Grunt's reliability mission.

.DESCRIPTION
    1. Compiles TypeScript (tsc)
    2. Starts The Librarian, The Ethnographer, The Secretary,
       The Chronicler, and The Strategist as independent background
       processes with log redirection.
    3. Writes PIDs to data/squad-pids.json for monitoring.
    4. Provides a live status view, auto-restart on crash, and
       Ctrl+C shutdown handler.

.PARAMETER SkipBuild
    Skip TypeScript compilation (use if already built).

.PARAMETER Watch
    Recompile in watch mode while agents run (dev mode).

.EXAMPLE
    .\scripts\start_squad.ps1
    .\scripts\start_squad.ps1 -SkipBuild
    .\scripts\start_squad.ps1 -Watch
#>

param(
    [switch]$SkipBuild,
    [switch]$Watch
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$DataDir     = Join-Path $ProjectRoot "data"
$LogsDir     = Join-Path $DataDir    "logs"
$DistDir     = Join-Path $ProjectRoot "dist"
$PidFile     = Join-Path $DataDir    "squad-pids.json"

# ─── Helpers ──────────────────────────────────────────────────────────────────

function Write-Banner {
    Write-Host ""
    Write-Host "  ============================================" -ForegroundColor Cyan
    Write-Host "   AURA SQUAD BOOT — OPERATION WATCHTOWER" -ForegroundColor Cyan
    Write-Host "   The Grunt reporting. All units deploying." -ForegroundColor Cyan
    Write-Host "  ============================================" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Step {
    param([string]$Msg, [string]$Color = "Yellow")
    Write-Host "[GRUNT] $Msg" -ForegroundColor $Color
}

function Write-Ok   { param([string]$Msg) Write-Host "[  OK ] $Msg" -ForegroundColor Green }
function Write-Fail { param([string]$Msg) Write-Host "[ ERR ] $Msg" -ForegroundColor Red }
function Write-Info { param([string]$Msg) Write-Host "[ INF ] $Msg" -ForegroundColor Gray }

function Ensure-Dir { param([string]$Path)
    if (-not (Test-Path $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
        Write-Info "Created: $Path"
    }
}

# ─── Pre-flight Checks ────────────────────────────────────────────────────────

function Test-Prerequisites {
    Write-Step "Pre-flight checks..."

    # Node.js
    $nodeVer = & node --version 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Node.js not found. Install Node.js >= 20."
        exit 1
    }
    Write-Ok "Node.js: $nodeVer"

    # npm
    $npmVer = & npm --version 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "npm not found."
        exit 1
    }
    Write-Ok "npm: $npmVer"

    # tsc
    $tscPath = Join-Path $ProjectRoot "node_modules\.bin\tsc.cmd"
    if (-not (Test-Path $tscPath)) {
        Write-Fail "TypeScript not installed. Run: npm install"
        exit 1
    }
    Write-Ok "TypeScript compiler: found"

    # node_modules
    if (-not (Test-Path (Join-Path $ProjectRoot "node_modules\chokidar"))) {
        Write-Fail "chokidar not installed. Run: npm install"
        exit 1
    }
    Write-Ok "Dependencies: chokidar found"
}

# ─── Build ────────────────────────────────────────────────────────────────────

function Invoke-Build {
    if ($SkipBuild) {
        Write-Step "Skipping build (-SkipBuild flag set)."
        if (-not (Test-Path $DistDir)) {
            Write-Fail "dist/ not found and -SkipBuild was set. Run without -SkipBuild first."
            exit 1
        }
        return
    }

    Write-Step "Compiling TypeScript..."
    $tsc = Join-Path $ProjectRoot "node_modules\.bin\tsc.cmd"

    if ($Watch) {
        Write-Info "Watch mode enabled — tsc will run in background."
        $job = Start-Job -ScriptBlock {
            param($tsc, $root)
            Set-Location $root
            & $tsc --watch --preserveWatchOutput
        } -ArgumentList $tsc, $ProjectRoot
        Write-Ok "tsc --watch started (Job ID: $($job.Id))"
        Start-Sleep -Seconds 5  # give tsc time for initial compile
    } else {
        & $tsc 2>&1 | Tee-Object -FilePath (Join-Path $LogsDir "tsc-build.log")
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "TypeScript compilation failed. Check data/logs/tsc-build.log"
            exit 1
        }
        Write-Ok "TypeScript compiled successfully → dist/"
    }
}

# ─── Agent Launcher ───────────────────────────────────────────────────────────

function Start-Agent {
    param(
        [string]$Name,
        [string]$ScriptPath,
        [string]$StdoutLog,
        [string]$StderrLog
    )

    if (-not (Test-Path $ScriptPath)) {
        Write-Fail "Agent script not found: $ScriptPath"
        return $null
    }

    $proc = Start-Process `
        -FilePath "node" `
        -ArgumentList $ScriptPath `
        -WorkingDirectory $ProjectRoot `
        -RedirectStandardOutput $StdoutLog `
        -RedirectStandardError  $StderrLog `
        -WindowStyle Hidden `
        -PassThru

    if ($null -eq $proc -or $proc.HasExited) {
        Write-Fail "$Name failed to start."
        return $null
    }

    Write-Ok "$Name started | PID=$($proc.Id) | log=$StdoutLog"
    return $proc
}

function Kill-SquadFromPidFile {
    if (-not (Test-Path $PidFile)) { return }
    $pids = Get-Content $PidFile | ConvertFrom-Json
    foreach ($entry in $pids) {
        try {
            $p = Get-Process -Id $entry.pid -ErrorAction SilentlyContinue
            if ($null -ne $p) {
                $p | Stop-Process -Force
                Write-Info "Stopped $($entry.name) (PID $($entry.pid))"
            }
        } catch { }
    }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

# ─── Status Monitor ───────────────────────────────────────────────────────────

function Show-SquadStatus {
    param([hashtable]$Procs)
    Write-Host ""
    Write-Host "  SQUAD STATUS" -ForegroundColor Cyan
    Write-Host "  ─────────────────────────────────────" -ForegroundColor DarkGray
    foreach ($name in $Procs.Keys) {
        $p = $Procs[$name]
        if ($null -eq $p) {
            Write-Host "  $($name.PadRight(14)) FAILED TO START" -ForegroundColor Red
        } elseif ($p.HasExited) {
            Write-Host "  $($name.PadRight(14)) EXITED (code=$($p.ExitCode))" -ForegroundColor Red
        } else {
            Write-Host "  $($name.PadRight(14)) RUNNING  PID=$($p.Id)" -ForegroundColor Green
        }
    }
    Write-Host "  ─────────────────────────────────────" -ForegroundColor DarkGray
    Write-Host ""
}

# ─── Main ─────────────────────────────────────────────────────────────────────

Set-Location $ProjectRoot
Write-Banner

Ensure-Dir $DataDir
Ensure-Dir $LogsDir

# Kill any previous squad
Kill-SquadFromPidFile

Test-Prerequisites
Invoke-Build

Write-Step "Deploying squad agents..."

$agents = @{
    "The Librarian"    = @{
        script  = Join-Path $DistDir "agents\librarian.js"
        stdout  = Join-Path $LogsDir "librarian-stdout.log"
        stderr  = Join-Path $LogsDir "librarian-stderr.log"
        restart = $true
    }
    "The Ethnographer" = @{
        script  = Join-Path $DistDir "agents\ethnographer.js"
        stdout  = Join-Path $LogsDir "ethnographer-stdout.log"
        stderr  = Join-Path $LogsDir "ethnographer-stderr.log"
        restart = $false   # single-shot scan; exit is expected
    }
    "The Secretary"    = @{
        script  = Join-Path $DistDir "agents\secretary.js"
        stdout  = Join-Path $LogsDir "secretary-stdout.log"
        stderr  = Join-Path $LogsDir "secretary-stderr.log"
        restart = $true
    }
    "The Chronicler"   = @{
        script  = Join-Path $DistDir "agents\chronicler.js"
        stdout  = Join-Path $LogsDir "chronicler-stdout.log"
        stderr  = Join-Path $LogsDir "chronicler-stderr.log"
        restart = $true
    }
    "The Strategist"   = @{
        script  = Join-Path $DistDir "agents\strategist.js"
        stdout  = Join-Path $LogsDir "strategist-stdout.log"
        stderr  = Join-Path $LogsDir "strategist-stderr.log"
        restart = $true
    }
}

$procs   = @{}
$pidData = @()

foreach ($name in $agents.Keys) {
    $cfg  = $agents[$name]
    $proc = Start-Agent -Name $name -ScriptPath $cfg.script `
                        -StdoutLog $cfg.stdout -StderrLog $cfg.stderr
    $procs[$name] = $proc
    if ($null -ne $proc) {
        $pidData += [PSCustomObject]@{ name = $name; pid = $proc.Id }
    }
    Start-Sleep -Milliseconds 300  # stagger agent startup
}

# Write PID file for monitoring / shutdown
$pidData | ConvertTo-Json | Set-Content -Path $PidFile -Encoding UTF8
Write-Info "PIDs written to: $PidFile"

Show-SquadStatus -Procs $procs

Write-Host " Operation Watchtower is LIVE." -ForegroundColor Cyan
Write-Host " Drop a file in ~/Downloads to trigger the full pipeline." -ForegroundColor White
Write-Host ""
Write-Host " Logs:" -ForegroundColor DarkGray
Write-Host "   Librarian    -> data/logs/librarian-stdout.log" -ForegroundColor DarkGray
Write-Host "   Ethnographer -> data/logs/ethnographer-stdout.log" -ForegroundColor DarkGray
Write-Host "   Secretary    -> data/logs/secretary-stdout.log" -ForegroundColor DarkGray
Write-Host "   Chronicler   -> data/logs/chronicler-stdout.log" -ForegroundColor DarkGray
Write-Host "   Strategist   -> data/logs/strategist-stdout.log" -ForegroundColor DarkGray
Write-Host ""
Write-Host " Press Ctrl+C to shut down the squad." -ForegroundColor DarkGray
Write-Host ""

# ─── Keep alive + monitor ─────────────────────────────────────────────────────

try {
    while ($true) {
        Start-Sleep -Seconds 30

        foreach ($name in ($procs.Keys | Sort-Object)) {
            $p   = $procs[$name]
            $cfg = $agents[$name]

            if ($null -ne $p -and $p.HasExited) {
                if ($cfg.restart) {
                    Write-Host "[GRUNT] $name exited (code=$($p.ExitCode)) — restarting..." -ForegroundColor Yellow
                    $newProc = Start-Agent -Name $name -ScriptPath $cfg.script `
                                           -StdoutLog $cfg.stdout -StderrLog $cfg.stderr
                    $procs[$name] = $newProc
                    if ($null -ne $newProc) {
                        # Update PID file
                        $pidData = @()
                        foreach ($n2 in $procs.Keys) {
                            $p2 = $procs[$n2]
                            if ($null -ne $p2 -and -not $p2.HasExited) {
                                $pidData += [PSCustomObject]@{ name = $n2; pid = $p2.Id }
                            }
                        }
                        $pidData | ConvertTo-Json | Set-Content -Path $PidFile -Encoding UTF8
                    }
                } else {
                    Write-Info "$name has exited (expected — single-shot agent)."
                }
            }
        }
    }
} finally {
    Write-Host ""
    Write-Step "Shutdown signal received. Terminating squad..."
    Kill-SquadFromPidFile
    foreach ($name in $procs.Keys) {
        $p = $procs[$name]
        if ($null -ne $p -and -not $p.HasExited) {
            $p | Stop-Process -Force -ErrorAction SilentlyContinue
            Write-Ok "Stopped $name"
        }
    }
    Write-Host "[GRUNT] Squad offline. Operation Watchtower closed." -ForegroundColor Cyan
}
