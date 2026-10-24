<#
.SYNOPSIS
Run a reviewed JSX drawing script in a newly created Illustrator document.
.DESCRIPTION
This runner is not a sandbox: trusted JSX still has access to app and the file system.
It refuses nonempty output directories, injects original layout helpers, and supplies
SCI_DOCUMENT, SCI_OUTPUT_ROOT and SCI_RESULT. The drawing script saves/exports only
to SCI_OUTPUT_ROOT. The runner does not automatically save or close any document.
On failure the new document is left available for inspection; mutations are not retried.
#>
param(
    [Parameter(Mandatory = $true)][string]$JsxPath,
    [Parameter(Mandatory = $true)][string]$OutputRoot,
    [ValidateRange(1, 16383)][double]$CanvasWidth = 1080,
    [ValidateRange(1, 16383)][double]$CanvasHeight = 600
)
$ErrorActionPreference = 'Stop'
$resolvedSource = (Resolve-Path -LiteralPath $JsxPath).Path
if (-not [IO.File]::Exists($resolvedSource)) { throw 'JsxPath must identify a file.' }
$resolvedOutput = [IO.Path]::GetFullPath($OutputRoot)
if ([IO.File]::Exists($resolvedOutput)) { throw 'OutputRoot must identify a directory.' }
if ([IO.Directory]::Exists($resolvedOutput) -and @([IO.Directory]::EnumerateFileSystemEntries($resolvedOutput)).Count -gt 0) {
    throw 'OutputRoot must be empty. Choose a new version directory.'
}
$source = [IO.File]::ReadAllText($resolvedSource, [Text.Encoding]::UTF8)
# A target directive inside the wrapper is not valid. Illustrator is selected by COM.
$source = $source -replace '(?m)^\s*#target[^\r\n]*', ''
$helper = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'native-layout.jsx'), [Text.Encoding]::UTF8)
[IO.Directory]::CreateDirectory($resolvedOutput) | Out-Null
$outputLiteral = ConvertTo-Json -InputObject ($resolvedOutput -replace '\\', '/') -Compress
$widthLiteral = $CanvasWidth.ToString([Globalization.CultureInfo]::InvariantCulture)
$heightLiteral = $CanvasHeight.ToString([Globalization.CultureInfo]::InvariantCulture)
$program = @"
(function () {
    var priorInteraction = app.userInteractionLevel;
    var priorCoordinates = app.coordinateSystem;
    var priorDocument = app.documents.length ? app.activeDocument : null;
    var SCI_DOCUMENT = null;
    var SCI_OUTPUT_ROOT = $outputLiteral;
    var SCI_RESULT;
    try {
        app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;
        app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
        SCI_DOCUMENT = app.documents.add(DocumentColorSpace.RGB, $widthLiteral, $heightLiteral);
        SCI_DOCUMENT.artboards[0].artboardRect = [0, $heightLiteral, $widthLiteral, 0];
        $helper
        $source
        return typeof SCI_RESULT === 'undefined' ? 'Script completed; save/export was controlled by the reviewed drawing script.' : String(SCI_RESULT);
    } finally {
        app.userInteractionLevel = priorInteraction;
        app.coordinateSystem = priorCoordinates;
        if (priorDocument) { try { priorDocument.activate(); } catch (activationError) {} }
    }
}());
"@
$sessionDirectory = Join-Path ([IO.Path]::GetTempPath()) 'scientific-illustrator-workbench'
[IO.Directory]::CreateDirectory($sessionDirectory) | Out-Null
$sessionLockPath = Join-Path $sessionDirectory 'illustrator.lock'
$lockNonce = [Guid]::NewGuid().ToString()
$lockHandle = $null
try {
    try {
        $lockHandle = [IO.File]::Open($sessionLockPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
        $lockData = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -Compress -InputObject @{pid=$PID;nonce=$lockNonce}))
        $lockHandle.Write($lockData, 0, $lockData.Length)
        $lockHandle.Flush()
    } catch {
        throw "Another Workbench session or retained lock exists: $sessionLockPath. Inspect its owner before recovery."
    }
    $illustrator = New-Object -ComObject Illustrator.Application
    $result = $illustrator.DoJavaScript($program)
    if ($null -ne $result) { Write-Output $result }
} catch {
    throw "Illustrator execution failed. The new document may contain partial artwork; inspect it before retrying. $($_.Exception.Message)"
} finally {
    if ($null -ne $lockHandle) {
        $lockHandle.Dispose()
        $record = ConvertFrom-Json ([IO.File]::ReadAllText($sessionLockPath, [Text.Encoding]::UTF8))
        if ($record.nonce -eq $lockNonce) { Remove-Item -LiteralPath $sessionLockPath }
    }
}
