param(
    [int]$Runs = 3,
    [string[]]$Scenarios = @('baseline-transfers', 'hot-account', 'idempotency-storm', 'mixed-workload'),
    [string]$BaseUrl = 'http://localhost:3000/v1',
    [string]$Container = 'ledgercore-postgres'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$outDir = Join-Path $root "docs\benchmarks\$stamp"
New-Item -ItemType Directory -Force $outDir | Out-Null

function Invoke-Sql([string]$sql) {
    $result = docker exec $Container psql -U ledger -d ledgercore -tAc $sql
    if ($LASTEXITCODE -ne 0) { throw "psql failed: $sql" }
    return ($result | Select-Object -First 1)
}

function Get-Deadlocks {
    return [int](Invoke-Sql "SELECT deadlocks FROM pg_stat_database WHERE datname = 'ledgercore'").Trim()
}

function Get-Metric($metrics, [string]$name, [string]$field) {
    if ($metrics.PSObject.Properties.Name -contains $name) {
        $value = $metrics.$name.$field
        if ($null -ne $value) { return [double]$value }
    }
    return $null
}

function Get-Count($metrics, [string]$name) {
    $value = Get-Metric $metrics $name 'count'
    if ($null -eq $value) { return 0 }
    return [int]$value
}

function Get-Checks($group) {
    $found = @()
    if ($null -eq $group) { return $found }
    $checks = $group.checks
    if ($checks -is [System.Array]) {
        $found += $checks
    } elseif ($null -ne $checks) {
        foreach ($p in $checks.PSObject.Properties) { $found += $p.Value }
    }
    $groups = $group.groups
    if ($groups -is [System.Array]) {
        foreach ($g in $groups) { $found += Get-Checks $g }
    } elseif ($null -ne $groups) {
        foreach ($p in $groups.PSObject.Properties) { $found += Get-Checks $p.Value }
    }
    return $found
}

function Get-CheckResult($checks, [string]$name) {
    $match = @($checks | Where-Object { $_.name -eq $name })
    if ($match.Count -eq 0) { return '' }
    $fails = ($match | Measure-Object -Property fails -Sum).Sum
    if ($fails -eq 0) { return 'pass' }
    return 'FAIL'
}

function Get-Median([object[]]$values) {
    $sorted = @($values | Where-Object { $null -ne $_ } | ForEach-Object { [double]$_ } | Sort-Object)
    $n = $sorted.Count
    if ($n -eq 0) { return $null }
    if ($n % 2 -eq 1) { return $sorted[[int][math]::Floor($n / 2)] }
    return ($sorted[$n / 2 - 1] + $sorted[$n / 2]) / 2
}

function Round([object]$value, [int]$digits = 1) {
    if ($null -eq $value) { return $null }
    return [math]::Round([double]$value, $digits)
}

try {
    $ready = Invoke-RestMethod "$BaseUrl/health/ready" -TimeoutSec 5
    if ($ready.status -ne 'ready') { throw 'not ready' }
} catch {
    Write-Host "API is not ready at $BaseUrl/health/ready. Start it first." -ForegroundColor Red
    exit 1
}

$cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name
$ram = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
@(
    "date: $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
    "cpu: $cpu"
    "ram_gb: $ram"
    "k6: $((& k6 version | Select-Object -First 1))"
    "node: $(node -v)"
    "postgres: $(Invoke-Sql 'SHOW server_version')"
    "postgres_logging_during_run: log_statement=none, log_min_duration_statement=500ms (prod settings)"
    "runs_per_scenario: $Runs (+1 warm-up run of idempotency-storm, discarded)"
    "base_url: $BaseUrl"
) | Set-Content (Join-Path $outDir 'environment.txt') -Encoding UTF8

$rows = @()
$trendStats = 'avg,med,p(95),p(99),max'

try {
    Invoke-Sql "ALTER SYSTEM SET log_statement = 'none'" | Out-Null
    Invoke-Sql "ALTER SYSTEM SET log_min_duration_statement = '500ms'" | Out-Null
    Invoke-Sql 'SELECT pg_reload_conf()' | Out-Null

    Write-Host '[warm-up] idempotency-storm'
    & k6 run --quiet --log-output=none -e "BASE_URL=$BaseUrl" 'load-tests/idempotency-storm.js' | Out-Null

    foreach ($s in $Scenarios) {
        for ($i = 1; $i -le $Runs; $i++) {
            Write-Host "[$s] run $i/$Runs"
            Invoke-Sql 'SELECT pg_stat_statements_reset()' | Out-Null
            $deadlocksBefore = Get-Deadlocks

            $json = Join-Path $outDir "k6-$s-run$i.json"
            & k6 run --quiet --log-output=none --summary-trend-stats $trendStats --summary-export $json -e "BASE_URL=$BaseUrl" "load-tests/$s.js" | Out-Null
            $exitCode = $LASTEXITCODE

            $deadlocks = (Get-Deadlocks) - $deadlocksBefore

            docker exec $Container psql -U ledger -d ledgercore -c "SELECT calls, round(total_exec_time::numeric, 1) AS total_ms, round(mean_exec_time::numeric, 2) AS mean_ms, left(regexp_replace(query, '\s+', ' ', 'g'), 100) AS query FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10" |
                Set-Content (Join-Path $outDir "slow-$s-run$i.txt") -Encoding UTF8

            $summary = Get-Content $json -Raw | ConvertFrom-Json
            $m = $summary.metrics
            $checks = Get-Checks $summary.root_group

            $faults = Get-Count $m 'ledger_faults'
            $balanced = Get-CheckResult $checks 'ledger still balances after load'
            $movedOnce = Get-CheckResult $checks 'money moved once per key, not once per request'
            $valid = ($faults -eq 0) -and ($balanced -ne 'FAIL') -and ($movedOnce -ne 'FAIL')

            $rows += [pscustomobject]@{
                scenario          = $s
                run               = $i
                valid             = $valid
                k6_exit           = $exitCode
                rps               = Round (Get-Metric $m 'http_reqs' 'rate')
                transfer_avg_ms   = Round (Get-Metric $m 'ledger_transfer_duration' 'avg')
                transfer_p95_ms   = Round (Get-Metric $m 'ledger_transfer_duration' 'p(95)')
                transfer_p99_ms   = Round (Get-Metric $m 'ledger_transfer_duration' 'p(99)')
                balance_p95_ms    = Round (Get-Metric $m 'http_req_duration{operation:balance}' 'p(95)')
                history_p95_ms    = Round (Get-Metric $m 'http_req_duration{operation:history}' 'p(95)')
                succeeded         = Get-Count $m 'ledger_succeeded'
                rejected_business = Get-Count $m 'ledger_rejected_business'
                contention        = Get-Count $m 'ledger_contention'
                faults            = $faults
                deadlocks         = $deadlocks
                idem_originals    = Get-Count $m 'idempotent_originals'
                idem_replays      = Get-Count $m 'idempotent_replays'
                money_moved_once  = $movedOnce
                ledger_balanced   = $balanced
            }

            if (-not $valid) {
                Write-Host "  invalid run: faults=$faults balanced=$balanced moved_once=$movedOnce" -ForegroundColor Yellow
            }
        }
    }
} finally {
    Invoke-Sql 'ALTER SYSTEM RESET log_statement' | Out-Null
    Invoke-Sql 'ALTER SYSTEM RESET log_min_duration_statement' | Out-Null
    Invoke-Sql 'SELECT pg_reload_conf()' | Out-Null
}

$rows | Export-Csv (Join-Path $outDir 'results.csv') -NoTypeInformation -Encoding UTF8

$summaryRows = foreach ($s in $Scenarios) {
    $all = @($rows | Where-Object { $_.scenario -eq $s })
    $r = @($all | Where-Object { $_.valid })
    [pscustomobject]@{
        scenario           = $s
        valid_runs         = "$($r.Count)/$($all.Count)"
        median_rps         = Get-Median ($r | ForEach-Object { $_.rps })
        median_p95_ms      = Get-Median ($r | ForEach-Object { $_.transfer_p95_ms })
        median_p99_ms      = Get-Median ($r | ForEach-Object { $_.transfer_p99_ms })
        median_balance_p95 = Get-Median ($r | ForEach-Object { $_.balance_p95_ms })
        median_history_p95 = Get-Median ($r | ForEach-Object { $_.history_p95_ms })
        faults_total       = ($all | Measure-Object -Property faults -Sum).Sum
        deadlocks_total    = ($all | Measure-Object -Property deadlocks -Sum).Sum
        contention_total   = ($all | Measure-Object -Property contention -Sum).Sum
        ledger_balanced    = ((($all | ForEach-Object { $_.ledger_balanced }) | Select-Object -Unique) -join '/')
    }
}

$summaryRows | Export-Csv (Join-Path $outDir 'summary.csv') -NoTypeInformation -Encoding UTF8

$rows | Format-Table scenario, run, valid, rps, transfer_p95_ms, transfer_p99_ms, succeeded, rejected_business, contention, faults, deadlocks, ledger_balanced -AutoSize
$summaryRows | Format-Table -AutoSize
Write-Host "Saved to $outDir"
