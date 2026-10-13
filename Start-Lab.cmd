@echo off
cd /d "%~dp0"
if not exist node_modules (
  call npm.cmd install --cache .npm-cache --no-audit --no-fund
  if errorlevel 1 goto failure
)
call npm.cmd start
:failure
pause
