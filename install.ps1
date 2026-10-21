#Requires -Version 5.1
# SPDX-License-Identifier: GPL-3.0-only
[CmdletBinding()]
param(
    [ValidateSet("dark", "light", "system")]
    [string]$Mode = "dark",

    [switch]$NoActivate
)

$Mode = $Mode.ToLowerInvariant()
$ErrorActionPreference = "Stop"

try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
} catch {
    # La consola actual no admite cambiar la codificación; no es un error.
}

function Backup-File {
    param([string]$Path)

    if (Test-Path -LiteralPath $Path) {
        $stamp = Get-Date -Format "yyyyMMdd-HHmmss-fff"
        $backup = "$Path.bak-$stamp"
        $counter = 1
        while (Test-Path -LiteralPath $backup) {
            $backup = "$Path.bak-$stamp-$counter"
            $counter += 1
        }
        Copy-Item -LiteralPath $Path -Destination $backup
        Write-Host "  Backup: $backup"
    }
}

try {
    $source = Join-Path $PSScriptRoot "themes\claude.json"
    if (-not (Test-Path -LiteralPath $source)) {
        throw "No se encontró el tema en $source"
    }

    try {
        Get-Content -LiteralPath $source -Raw -Encoding UTF8 | ConvertFrom-Json | Out-Null
    } catch {
        throw "El archivo del tema no es JSON válido: $($_.Exception.Message)"
    }

    $configRoot = if ([string]::IsNullOrWhiteSpace($env:XDG_CONFIG_HOME)) {
        Join-Path $env:USERPROFILE ".config\opencode"
    } else {
        Join-Path $env:XDG_CONFIG_HOME "opencode"
    }

    $themesDir = Join-Path $configRoot "themes"
    $destination = Join-Path $themesDir "claude.json"
    $cliPath = Join-Path $configRoot "cli.json"

    New-Item -ItemType Directory -Force -Path $themesDir | Out-Null

    Backup-File -Path $destination
    Copy-Item -LiteralPath $source -Destination $destination -Force

    $activated = $false
    if (-not $NoActivate) {
        $themeConfig = [pscustomobject]@{
            name = "claude"
            mode = $Mode
        }

        if (Test-Path -LiteralPath $cliPath) {
            try {
                $config = Get-Content -LiteralPath $cliPath -Raw -Encoding UTF8 | ConvertFrom-Json
            } catch {
                throw "No se pudo leer cli.json. Si contiene comentarios JSONC, añade el bloque theme manualmente. Detalle: $($_.Exception.Message)"
            }

            if ($config -isnot [System.Management.Automation.PSCustomObject]) {
                throw "cli.json debe contener un objeto JSON en la raíz."
            }

            Backup-File -Path $cliPath
            $config | Add-Member -MemberType NoteProperty -Name theme -Value $themeConfig -Force
        } else {
            $config = [pscustomobject][ordered]@{
                '$schema' = "https://opencode.ai/v2/cli.json"
                theme = $themeConfig
                animations = $true
            }
        }

        $json = $config | ConvertTo-Json -Depth 100
        $utf8 = New-Object System.Text.UTF8Encoding($false)
        $temporary = Join-Path $configRoot (".cli.json.tmp-" + [guid]::NewGuid().ToString("N"))
        try {
            [System.IO.File]::WriteAllText($temporary, $json + [Environment]::NewLine, $utf8)
            if (Test-Path -LiteralPath $cliPath) {
                [System.IO.File]::Replace($temporary, $cliPath, [System.Management.Automation.Language.NullString]::Value)
            } else {
                [System.IO.File]::Move($temporary, $cliPath)
            }
        } finally {
            if (Test-Path -LiteralPath $temporary) {
                Remove-Item -LiteralPath $temporary -Force
            }
        }
        $activated = $true
    }

    Write-Host ""
    Write-Host "Tema instalado:" -ForegroundColor Green
    Write-Host "  $destination"
    if ($activated) {
        Write-Host "Tema activado en modo '$Mode':" -ForegroundColor Green
        Write-Host "  $cliPath"
    } else {
        Write-Host "Activación omitida (-NoActivate)."
        Write-Host "Selecciona 'claude' con /themes o añade el bloque theme a cli.json."
    }
    Write-Host ""
    Write-Host "Reinicia OpenCode para cargar el tema."
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
