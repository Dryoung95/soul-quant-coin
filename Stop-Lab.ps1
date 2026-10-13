$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$recordPath = Join-Path $taskRoot 'runtime\process.json'
if (-not (Test-Path -LiteralPath $recordPath)) { Write-Output '实验室尚未启动。'; exit }
$record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
$appProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($record.appPid)"
$chainProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($record.chainPid)"
$expectedChainScript = Join-Path $taskRoot 'node_modules\hardhat\dist\src\cli.js'
$isProjectChain = $chainProcess -and $chainProcess.CommandLine -and $chainProcess.CommandLine.Contains($expectedChainScript) -and $chainProcess.ParentProcessId -eq $record.appPid
$isAppCommand = $appProcess -and $appProcess.CommandLine -and ($appProcess.CommandLine.Contains((Join-Path $taskRoot 'scripts\start.mjs')) -or $appProcess.CommandLine -match '(?:^|\s|")scripts[\\/]start\.mjs(?:\s|"|$)')
$matchesCreation = $true
if ($record.processCreatedAt -and $appProcess) {
    $expectedCreatedAt = [DateTimeOffset]::Parse($record.processCreatedAt).UtcDateTime
    $actualCreatedAt = $appProcess.CreationDate.ToUniversalTime()
    $matchesCreation = [Math]::Abs(($actualCreatedAt - $expectedCreatedAt).TotalSeconds) -lt 3
}
if ($isProjectChain -and $isAppCommand -and $matchesCreation) {
    Stop-Process -Id $record.chainPid -Force -ErrorAction SilentlyContinue
    Stop-Process -Id $record.appPid -Force -ErrorAction SilentlyContinue
    Write-Output '实验室已停止。'
} else { Write-Output '未找到本项目的后台进程，可关闭启动终端停止前台实例。' }
