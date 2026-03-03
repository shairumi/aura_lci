<#
.SYNOPSIS
    Aura - Cultural Scan Script
    Agent: The Ethnographer | Operation: First Contact

.DESCRIPTION
    Harvests local signals from the Windows environment:
    - System culture / locale (PSCulture)
    - Timezone
    - Recent file activity in ~/Documents (name + extension pattern analysis)
    - Tone inference from filename vocabulary
    All output is LOCAL. No data is transmitted externally.

.OUTPUTS
    Writes JSON to: data/signals/cultural-scan.json
    Appends log to: data/logs/ethnographer.log
#>

param(
    [string]$OutputDir = "data\signals",
    [string]$LogDir    = "data\logs",
    [int]$RecentFileCount = 10
)

$ErrorActionPreference = "Stop"
$ScanStart = Get-Date
$Crystal = [char]::ConvertFromUtf32(0x1F52E)  # crystal ball emoji, safe

# ---- Ensure output dirs exist ------------------------------------------------
@($OutputDir, $LogDir) | ForEach-Object {
    if (-not (Test-Path $_)) { New-Item -ItemType Directory -Path $_ -Force | Out-Null }
}

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $ts = (Get-Date).ToUniversalTime().ToString("o")
    $entry = "[$ts] [ethnographer] [$Level] $Message"
    Add-Content -Path (Join-Path $LogDir "ethnographer.log") -Value $entry -Encoding UTF8
    Write-Host $entry
}

Write-Log "=== Operation First Contact: Cultural Scan BEGIN ==="

# ---- 1. CULTURE & LOCALE -----------------------------------------------------
Write-Log "Harvesting PSCulture and locale signals..."

$culture         = $PSCulture
$uiCulture       = $PSUICulture
$timezone        = (Get-TimeZone).Id
$tzOffset        = (Get-TimeZone).BaseUtcOffset.ToString()
$tzDisplayName   = (Get-TimeZone).DisplayName
$lcid            = [System.Globalization.CultureInfo]::CurrentCulture.LCID
$dateFormat      = [System.Globalization.CultureInfo]::CurrentCulture.DateTimeFormat.ShortDatePattern
$timeFormat      = [System.Globalization.CultureInfo]::CurrentCulture.DateTimeFormat.ShortTimePattern
$numberSep       = [System.Globalization.CultureInfo]::CurrentCulture.NumberFormat.NumberDecimalSeparator
$thousandSep     = [System.Globalization.CultureInfo]::CurrentCulture.NumberFormat.NumberGroupSeparator
$currency        = [System.Globalization.CultureInfo]::CurrentCulture.NumberFormat.CurrencySymbol
$calendarType    = [System.Globalization.CultureInfo]::CurrentCulture.Calendar.GetType().Name
$firstDayOfWeek  = [System.Globalization.CultureInfo]::CurrentCulture.DateTimeFormat.FirstDayOfWeek.ToString()

$osTheme = try {
    $regVal = Get-ItemProperty `
        -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize" `
        -Name "AppsUseLightTheme" -ErrorAction SilentlyContinue
    if ($null -ne $regVal -and $regVal.AppsUseLightTheme -eq 0) { "dark" } else { "light" }
} catch { "unknown" }

Write-Log "Culture: $culture | TZ: $timezone | Theme: $osTheme"

# ---- 2. RECENT FILES IN ~/Documents ------------------------------------------
Write-Log "Scanning ~/Documents for recent file activity..."

$docsPath    = [Environment]::GetFolderPath("MyDocuments")
$recentFiles = @()

if (Test-Path $docsPath) {
    $recentFiles = Get-ChildItem -Path $docsPath -File -Recurse -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First $RecentFileCount |
        ForEach-Object {
            [PSCustomObject]@{
                name         = $_.Name
                ext          = $_.Extension.ToLower()
                sizeBytes    = $_.Length
                lastModified = $_.LastWriteTime.ToUniversalTime().ToString("o")
                basename     = $_.BaseName
            }
        }
    Write-Log "Found $($recentFiles.Count) recent files in Documents"
} else {
    Write-Log "~/Documents not found - skipping file scan" "WARN"
}

# ---- 3. TONE INFERENCE -------------------------------------------------------
Write-Log "Analyzing filename vocabulary for tone..."

$toneLexicon = @{
    "Academic/Professional" = @(
        "research","report","thesis","study","analysis","paper","review","proposal",
        "presentation","meeting","budget","invoice","contract","memo","draft","notes",
        "project","lci","roadmap","spec","requirements","technical","documentation",
        "whitepaper","summary","brief","agenda","minutes","quarterly","annual","plan"
    )
    "Creative/Hacker" = @(
        "logo","design","sketch","concept","brand","vibe","prototype","hack","build",
        "experiment","idea","mood","palette","font","art","portfolio","creative",
        "draft","v1","v2","v3","final","test","demo","proof","poc","cool","awesome",
        "dope","wild","wave","splash","glitch","pixel","render","composite","ui","ux"
    )
    "Personal/Life" = @(
        "recipe","photo","family","vacation","travel","birthday","wedding","health",
        "fitness","journal","diary","memories","scan","tax","insurance","medical",
        "home","house","car","pet","shopping","list","todo","personal","private"
    )
    "Developer/Technical" = @(
        "config","setup","install","script","code","module","api","sdk","cli","log",
        "debug","error","output","data","json","csv","xml","yaml","readme","env",
        "deploy","build","dist","src","lib","bin","util","helper","schema","model"
    )
}

$toneScores   = @{}
$matchedWords = @{}
$allTokens    = @()

foreach ($file in $recentFiles) {
    $raw    = $file.basename
    $tokens = $raw -split '[_\-\.\s\d]+' |
              Where-Object { $_.Length -gt 2 } |
              ForEach-Object { $_.ToLower() }
    $allTokens += $tokens

    foreach ($tone in $toneLexicon.Keys) {
        foreach ($keyword in $toneLexicon[$tone]) {
            if ($tokens -contains $keyword) {
                if (-not $toneScores.ContainsKey($tone))   { $toneScores[$tone]   = 0 }
                if (-not $matchedWords.ContainsKey($tone)) { $matchedWords[$tone] = @() }
                $toneScores[$tone]++
                $matchedWords[$tone] += "$keyword (from: $($file.name))"
            }
        }
    }
}

$sortedTones   = $toneScores.GetEnumerator() | Sort-Object Value -Descending
$primaryTone   = "Unknown/Insufficient Data $Crystal"
$secondaryTone = $null
$toneConfidence = 0

if ($sortedTones.Count -ge 1) {
    $top   = @($sortedTones)[0]
    $total = ($toneScores.Values | Measure-Object -Sum).Sum
    $primaryTone    = $top.Key
    $toneConfidence = [Math]::Round(($top.Value / [Math]::Max($total, 1)) * 100)
    if ($sortedTones.Count -ge 2) {
        $secondaryTone = (@($sortedTones)[1]).Key
    }
}

if ($recentFiles.Count -eq 0) {
    $primaryTone    = "Unknown/Insufficient Data $Crystal"
    $toneConfidence = 0
    Write-Log "No files found - tone is best-guess only" "WARN"
}

Write-Log "Primary tone: $primaryTone (confidence: $toneConfidence%)"

# ---- 4. ENVIRONMENT SIGNALS --------------------------------------------------
$username  = $env:USERNAME
$hostname  = $env:COMPUTERNAME
$osVersion = (Get-CimInstance Win32_OperatingSystem).Caption
$activeHour = (Get-Date).Hour

$activityWindow = if ($activeHour -ge 5  -and $activeHour -lt 12) { "Morning (05-12)" }
             elseif ($activeHour -ge 12 -and $activeHour -lt 18) { "Afternoon (12-18)" }
             elseif ($activeHour -ge 18 -and $activeHour -lt 23) { "Evening (18-23)" }
             else                                                  { "Night Owl (23-05)" }

# ---- 5. HEMISPHERE INFERENCE -------------------------------------------------
$hemisphere = "Northern (inferred $Crystal)"
$southernKeywords = @("Australia","New_Zealand","Brazil","Argentina","Chile",
                      "Johannesburg","Auckland","Sydney","Melbourne","Perth",
                      "Buenos_Aires","Santiago","Lima","Bogota")
foreach ($kw in $southernKeywords) {
    if ($timezone -like "*$kw*") {
        $hemisphere = "Southern"
        break
    }
}

# ---- 6. BUILD OUTPUT ---------------------------------------------------------
$scanDuration = [Math]::Round(((Get-Date) - $ScanStart).TotalMilliseconds)

$output = [ordered]@{
    meta = [ordered]@{
        agent      = "ethnographer"
        operation  = "first-contact"
        ts         = (Get-Date).ToUniversalTime().ToString("o")
        durationMs = $scanDuration
    }
    locale = [ordered]@{
        psCulture       = $culture
        psUICulture     = $uiCulture
        lcid            = $lcid
        dateFormat      = $dateFormat
        timeFormat      = $timeFormat
        numberDecimal   = $numberSep
        numberThousands = $thousandSep
        currency        = $currency
        calendarType    = $calendarType
        firstDayOfWeek  = $firstDayOfWeek
    }
    timezone = [ordered]@{
        id          = $timezone
        displayName = $tzDisplayName
        utcOffset   = $tzOffset
        hemisphere  = $hemisphere
    }
    environment = [ordered]@{
        username       = $username
        hostname       = $hostname
        osVersion      = $osVersion
        osTheme        = $osTheme
        currentHour    = $activeHour
        activityWindow = $activityWindow
    }
    recentFiles  = $recentFiles
    toneAnalysis = [ordered]@{
        primaryTone     = $primaryTone
        secondaryTone   = $secondaryTone
        confidence      = $toneConfidence
        toneScores      = $toneScores
        matchedKeywords = $matchedWords
        tokensSampled   = ($allTokens | Select-Object -Unique)
    }
}

# ---- 7. WRITE OUTPUT ---------------------------------------------------------
$jsonPath = Join-Path $OutputDir "cultural-scan.json"
$output | ConvertTo-Json -Depth 10 | Set-Content -Path $jsonPath -Encoding UTF8
Write-Log "Scan written to: $jsonPath"
Write-Log "=== Cultural Scan COMPLETE | duration=$($scanDuration)ms ==="

Write-Output $jsonPath
