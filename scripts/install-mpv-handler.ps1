#Requires -Version 5.1
#Requires -RunAsAdministrator

[CmdletBinding()]
param(
  [string]$InstallRoot,
  [string]$IconPath,
  [switch]$KeepExistingProtocolKeys
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-ExistingFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$BasePath,

    [Parameter(Mandatory = $true)]
    [string]$FileName
  )

  $resolvedPath = Join-Path -Path $BasePath -ChildPath $FileName
  if (-not (Test-Path -LiteralPath $resolvedPath -PathType Leaf)) {
    throw "Required file not found: $resolvedPath`nInstallRoot must point at the extracted mpv-handler folder that contains config.toml, mpv-handler.exe, and mpv-handler-debug.exe."
  }

  return (Resolve-Path -LiteralPath $resolvedPath).Path
}

function Get-UsageExample {
  return @"
Example usage:
  powershell -ExecutionPolicy Bypass -File .\scripts\install-mpv-handler.ps1 -InstallRoot 'C:\path\to\mpv-handler'

Or from an elevated PowerShell session:
  & 'C:\Forgejo\API-MediaPlayer\scripts\install-mpv-handler.ps1' -InstallRoot 'C:\path\to\mpv-handler'

If config.toml, mpv-handler.exe, and mpv-handler-debug.exe are in the same folder as this script,
you can run it without -InstallRoot.
"@
}

function Test-InstallRootContents {
  param(
    [string]$CandidatePath
  )

  if (-not $CandidatePath) {
    return $false
  }

  if (-not (Test-Path -LiteralPath $CandidatePath -PathType Container)) {
    return $false
  }

  return (
    (Test-Path -LiteralPath (Join-Path -Path $CandidatePath -ChildPath 'config.toml') -PathType Leaf) -and
    (Test-Path -LiteralPath (Join-Path -Path $CandidatePath -ChildPath 'mpv-handler.exe') -PathType Leaf) -and
    (Test-Path -LiteralPath (Join-Path -Path $CandidatePath -ChildPath 'mpv-handler-debug.exe') -PathType Leaf)
  )
}

function Get-DefaultInstallRoot {
  if (Test-InstallRootContents -CandidatePath $PSScriptRoot) {
    return (Resolve-Path -LiteralPath $PSScriptRoot).Path
  }

  return $null
}

function Assert-InstallRoot {
  param(
    [string]$CandidatePath
  )

  if (-not $CandidatePath) {
    $defaultInstallRoot = Get-DefaultInstallRoot
    if ($defaultInstallRoot) {
      return $defaultInstallRoot
    }

    throw "InstallRoot is required.`n$(Get-UsageExample)"
  }

  if (-not (Test-Path -LiteralPath $CandidatePath -PathType Container)) {
    throw "InstallRoot does not exist or is not a folder: $CandidatePath`n$(Get-UsageExample)"
  }

  $resolved = (Resolve-Path -LiteralPath $CandidatePath).Path

  if (Test-Path -LiteralPath (Join-Path -Path $resolved -ChildPath 'package.json') -PathType Leaf) {
    throw "InstallRoot appears to be this repo, not the extracted mpv-handler folder: $resolved`n$(Get-UsageExample)"
  }

  return $resolved
}

function Get-MpvPathFromConfig {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ConfigPath
  )

  if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    return $null
  }

  $raw = Get-Content -LiteralPath $ConfigPath -Raw
  $match = [regex]::Match($raw, '(?m)^\s*mpv\s*=\s*"(?<path>[^"]+)"\s*$')
  if (-not $match.Success) {
    return $null
  }

  $candidate = $match.Groups['path'].Value.Trim()
  if (-not $candidate) {
    return $null
  }

  if ([System.IO.Path]::IsPathRooted($candidate) -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
    return (Resolve-Path -LiteralPath $candidate).Path
  }

  try {
    $command = Get-Command -Name $candidate -ErrorAction Stop
    return $command.Source
  } catch {
    return $null
  }
}

function Resolve-CommandPath {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Names
  )

  foreach ($name in $Names) {
    try {
      $command = Get-Command -Name $name -ErrorAction Stop
      if ($command.Path) {
        return $command.Path
      }

      if ($command.Source) {
        return $command.Source
      }
    } catch {
    }
  }

  return $null
}

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

function Register-Protocol {
  param(
    [Parameter(Mandatory = $true)]
    [string]$SchemeName,

    [Parameter(Mandatory = $true)]
    [string]$Description,

    [Parameter(Mandatory = $true)]
    [string]$ContentType,

    [Parameter(Mandatory = $true)]
    [string]$HandlerExecutable,

    [Parameter(Mandatory = $true)]
    [string]$EffectiveIconPath
  )

  $classesRoot = [Microsoft.Win32.Registry]::ClassesRoot
  $schemeKey = $classesRoot.CreateSubKey($SchemeName)
  if (-not $schemeKey) {
    throw "Failed to create registry key for $SchemeName"
  }

  try {
    $schemeKey.SetValue('', $Description, [Microsoft.Win32.RegistryValueKind]::String)
    $schemeKey.SetValue('Content Type', $ContentType, [Microsoft.Win32.RegistryValueKind]::String)
    $schemeKey.SetValue('URL Protocol', '', [Microsoft.Win32.RegistryValueKind]::String)

    $defaultIconKey = $schemeKey.CreateSubKey('DefaultIcon')
    try {
      $defaultIconKey.SetValue('', ('"{0}",1' -f $EffectiveIconPath), [Microsoft.Win32.RegistryValueKind]::String)
    } finally {
      $defaultIconKey.Dispose()
    }

    $commandKey = $schemeKey.CreateSubKey('shell\open\command')
    try {
      $commandKey.SetValue('', ('"{0}" "%1"' -f $HandlerExecutable), [Microsoft.Win32.RegistryValueKind]::String)
    } finally {
      $commandKey.Dispose()
    }
  } finally {
    $schemeKey.Dispose()
  }
}

if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
  throw 'This installer is only for Windows.'
}

$installRootPath = Assert-InstallRoot -CandidatePath $InstallRoot
$configPath = Resolve-ExistingFile -BasePath $installRootPath -FileName 'config.toml'
$handlerPath = Resolve-ExistingFile -BasePath $installRootPath -FileName 'mpv-handler.exe'
$handlerDebugPath = Resolve-ExistingFile -BasePath $installRootPath -FileName 'mpv-handler-debug.exe'

$effectiveIconPath = if ($IconPath) {
  if (-not (Test-Path -LiteralPath $IconPath -PathType Leaf)) {
    throw "IconPath does not exist: $IconPath"
  }
  (Resolve-Path -LiteralPath $IconPath).Path
} else {
  $configuredPath = Get-MpvPathFromConfig -ConfigPath $configPath
  if ($configuredPath) {
    $configuredPath
  } else {
    Resolve-CommandPath -Names @('mpv.com', 'mpv.exe', 'mpv')
  }
}

if (-not $effectiveIconPath) {
  $effectiveIconPath = $handlerPath
}

if (-not $KeepExistingProtocolKeys) {
  Remove-ProtocolKey -SchemeName 'mpv'
  Remove-ProtocolKey -SchemeName 'mpv-debug'
  Remove-ProtocolKey -SchemeName 'mpv-handler'
  Remove-ProtocolKey -SchemeName 'mpv-handler-debug'
}

Register-Protocol -SchemeName 'mpv-handler' -Description 'URL:MPV Handler' -ContentType 'application/x-mpv-handler' -HandlerExecutable $handlerPath -EffectiveIconPath $effectiveIconPath
Register-Protocol -SchemeName 'mpv-handler-debug' -Description 'URL:MPV Handler Debug' -ContentType 'application/x-mpv-handler-debug' -HandlerExecutable $handlerDebugPath -EffectiveIconPath $effectiveIconPath

Write-Host 'Successfully installed mpv-handler protocol registration.' -ForegroundColor Green
Write-Host ('InstallRoot: {0}' -f $installRootPath)
Write-Host ('Handler: {0}' -f $handlerPath)
Write-Host ('Debug Handler: {0}' -f $handlerDebugPath)
Write-Host ('Icon: {0}' -f $effectiveIconPath)
Write-Host 'You can now test an mpv-handler:// URL from the browser.'