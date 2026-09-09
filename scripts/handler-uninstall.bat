@echo OFF
setlocal

set interactive=yes
if /I "%1"=="/u" (
    set interactive=no
    shift
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall-mpv-handler.ps1" %*
if errorlevel 1 (
    echo.
    echo Uninstall failed. Re-run from an elevated PowerShell or Command Prompt.
    if /I "%interactive%"=="yes" pause
    exit /b 1
)

if /I "%interactive%"=="yes" pause
exit /b 0
