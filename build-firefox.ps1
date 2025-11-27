# Firefox Distribution Package Builder
# This script creates a zip file for Firefox Add-ons submission

Write-Host "Building Firefox distribution package..." -ForegroundColor Green

# Define the output directory and filename
$outputDir = "dist"
$zipFileName = "twitter-location-flag-firefox-1.2.0.zip"
$zipPath = Join-Path $outputDir $zipFileName

# Create output directory if it doesn't exist
if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir | Out-Null
    Write-Host "Created output directory: $outputDir" -ForegroundColor Yellow
}

# Remove existing zip if it exists
if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
    Write-Host "Removed existing package: $zipFileName" -ForegroundColor Yellow
}

# Define files to include in the distribution
$filesToInclude = @(
    "manifest.json",
    "content.js",
    "pageScript.js",
    "countryFlags.js",
    "popup.html",
    "popup.js",
    "README.md"
)

Write-Host "`nVerifying all required files exist..." -ForegroundColor Cyan

$allFilesExist = $true
foreach ($file in $filesToInclude) {
    if (Test-Path $file) {
        Write-Host "  ✓ $file" -ForegroundColor Green
    } else {
        Write-Host "  ✗ $file (MISSING)" -ForegroundColor Red
        $allFilesExist = $false
    }
}

if (-not $allFilesExist) {
    Write-Host "`nError: Some required files are missing!" -ForegroundColor Red
    exit 1
}

# Verify manifest.json has Firefox-specific settings
Write-Host "`nVerifying Firefox compatibility in manifest.json..." -ForegroundColor Cyan
$manifestContent = Get-Content "manifest.json" -Raw | ConvertFrom-Json

if ($manifestContent.browser_specific_settings.gecko) {
    Write-Host "  ✓ browser_specific_settings.gecko found" -ForegroundColor Green
    Write-Host "    - ID: $($manifestContent.browser_specific_settings.gecko.id)" -ForegroundColor Gray
    Write-Host "    - Min version: $($manifestContent.browser_specific_settings.gecko.strict_min_version)" -ForegroundColor Gray
} else {
    Write-Host "  ✗ browser_specific_settings.gecko not found" -ForegroundColor Red
    Write-Host "    Firefox requires browser_specific_settings in manifest.json" -ForegroundColor Yellow
    exit 1
}

# Create the zip file
Write-Host "`nCreating zip package..." -ForegroundColor Cyan

try {
    # Create a temporary directory for staging
    $tempDir = Join-Path $env:TEMP "firefox-extension-build"
    if (Test-Path $tempDir) {
        Remove-Item $tempDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $tempDir | Out-Null

    # Copy files to temp directory
    foreach ($file in $filesToInclude) {
        Copy-Item $file -Destination $tempDir
    }

    # Create zip from temp directory
    Compress-Archive -Path "$tempDir\*" -DestinationPath $zipPath -Force

    # Clean up temp directory
    Remove-Item $tempDir -Recurse -Force

    Write-Host "  ✓ Package created successfully: $zipPath" -ForegroundColor Green
    
    # Display package info
    $zipInfo = Get-Item $zipPath
    Write-Host "`nPackage Information:" -ForegroundColor Cyan
    Write-Host "  Location: $($zipInfo.FullName)" -ForegroundColor Gray
    Write-Host "  Size: $([math]::Round($zipInfo.Length / 1KB, 2)) KB" -ForegroundColor Gray
    
    # List contents
    Write-Host "`nPackage Contents:" -ForegroundColor Cyan
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    foreach ($entry in $zip.Entries) {
        Write-Host "  - $($entry.Name)" -ForegroundColor Gray
    }
    $zip.Dispose()

    Write-Host "`n✓ Firefox distribution package ready for submission!" -ForegroundColor Green
    Write-Host "`nNext steps:" -ForegroundColor Yellow
    Write-Host "  1. Test installation in Firefox (see instructions below)" -ForegroundColor Gray
    Write-Host "  2. Submit to Firefox Add-ons: https://addons.mozilla.org/developers/" -ForegroundColor Gray
    Write-Host "`nTo test in Firefox:" -ForegroundColor Yellow
    Write-Host "  1. Open Firefox and navigate to about:debugging" -ForegroundColor Gray
    Write-Host "  2. Click 'This Firefox' in the sidebar" -ForegroundColor Gray
    Write-Host "  3. Click 'Load Temporary Add-on'" -ForegroundColor Gray
    Write-Host "  4. Select the manifest.json file from the extracted zip" -ForegroundColor Gray

} catch {
    Write-Host "`nError creating package: $_" -ForegroundColor Red
    exit 1
}
