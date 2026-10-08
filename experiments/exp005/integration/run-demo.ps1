# 사용자 확인용 로컬 서버 두 개를 숨김 창으로 시작합니다. 실제 모델·운영 DB는 사용하지 않습니다.
$ErrorActionPreference = 'Stop'
$expPath = Split-Path -Parent $PSScriptRoot
$projectPath = Split-Path -Parent (Split-Path -Parent $expPath)
$pythonPath = (Get-Command python -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath (Join-Path $expPath 'frontend/dist/index.html'))) {
    throw 'frontend에서 npm ci 및 npm run build -- --base=/agent/를 먼저 실행하세요.'
}
foreach ($port in @(8005, 8015)) {
    if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
        throw "포트 $port 가 이미 사용 중입니다. 기존 서버를 확인하고 실행하세요."
    }
}
$logPath = Join-Path $PSScriptRoot 'runtime'
New-Item -ItemType Directory -Path $logPath -Force | Out-Null
$env:IEUM_MODE = 'demo'
$env:PYTHONDONTWRITEBYTECODE = '1'
$agentProcess = Start-Process -FilePath $pythonPath -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8005', '--no-access-log') -WorkingDirectory (Join-Path $expPath 'backend') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logPath 'agent.stdout.log') -RedirectStandardError (Join-Path $logPath 'agent.stderr.log')
$previewProcess = Start-Process -FilePath $pythonPath -ArgumentList @((Join-Path $PSScriptRoot 'preview_server.py'), '--port', '8015', '--backend-port', '8005') -WorkingDirectory $projectPath -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logPath 'world.stdout.log') -RedirectStandardError (Join-Path $logPath 'world.stderr.log')
@{ agentPid = $agentProcess.Id; previewPid = $previewProcess.Id; project = $projectPath; url = 'http://127.0.0.1:8015/world/app/' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $logPath 'servers.json') -Encoding UTF8
Write-Output "에이전트 PID: $($agentProcess.Id), 마을 점검 PID: $($previewProcess.Id)"
Write-Output '점검 화면: http://127.0.0.1:8015/world/app/'
