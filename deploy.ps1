[CmdletBinding()]
param(
    [switch]$Check,
    [string]$Config = "$env:LOCALAPPDATA\DynamicEventMap\deploy.json"
)

$ErrorActionPreference = 'Stop'
$launcher = Get-Command python -ErrorAction SilentlyContinue
if (-not $launcher) { throw 'Install Python 3.11+ and add python to PATH.' }
$arguments = @("$PSScriptRoot\infra\scripts\local_release.py", '--config', $Config)
if ($Check) { $arguments += '--check' }
& $launcher.Source @arguments
exit $LASTEXITCODE
