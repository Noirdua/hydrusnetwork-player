#Requires -Version 5.1
#Requires -RunAsAdministrator

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Remove-ProtocolKey {
  param(
    [Parameter(Mandatory = $true)]
    [string]$SchemeName
  )

  $classesRoot = [Microsoft.Win32.Registry]::ClassesRoot
  try {
    $classesRoot.DeleteSubKeyTree($SchemeName, $false)
  } catch {
  }
}

if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
  throw 'This uninstaller is only for Windows.'
}

Remove-ProtocolKey -SchemeName 'mpv'
Remove-ProtocolKey -SchemeName 'mpv-debug'
Remove-ProtocolKey -SchemeName 'mpv-handler'
Remove-ProtocolKey -SchemeName 'mpv-handler-debug'

Write-Host 'Successfully removed mpv-handler protocol registration.' -ForegroundColor Green