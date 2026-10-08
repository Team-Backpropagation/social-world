# 기록된 PID뿐 아니라 명령도 확인하여 이 점검 서버만 종료합니다.
$ErrorActionPreference = 'Stop'
$stateFile = Join-Path $PSScriptRoot 'runtime/servers.json'
if (-not (Test-Path -LiteralPath $stateFile)) { Write-Output '점검 서버 실행 기록이 없습니다.'; return }
$serverState = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
foreach ($entry in @(@{ id = $serverState.agentPid; marker = 'uvicorn app.main:app --host 127.0.0.1 --port 8005' }, @{ id = $serverState.previewPid; marker = 'preview_server.py' })) {
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($entry.id)"
    if ($processInfo -and $processInfo.CommandLine.Contains($entry.marker)) {
        Stop-Process -Id $entry.id
        Write-Output "점검 서버 종료: $($entry.id)"
    }
}
