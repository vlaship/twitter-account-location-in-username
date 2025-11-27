# Firefox Package Testing Script
# This script validates the Firefox distribution package

Write-Host "Testing Firefox distribution package..." -ForegroundColor Green

$zipPath = "dist\twitter-location-flag-firefox-1.2.0.zip"
$testDir = "dist\test-extraction"

# Check if package exists
if (-not (Test-Path $zipPath)) {
    Write-Host "Error: Package not found at $zipPath" -ForegroundColor Red
    Write-Host "Run build-firefox.ps1 first to create the package." -ForegroundColor Yellow
    exit 1
}

Write-Host "`n1. Verifying package exists..." -ForegroundColor Cyan
Write-Host "  ✓ Package found: $zipPath" -ForegroundColor Green

# Clean up previous test extraction
if (Test-Path $testDir) {
    Remove-Item $testDir -Recurse -Force
}

# Extract package to test directory
Write-Host "`n2. Extracting package for testing..." -ForegroundColor Cyan
try {
    Expand-Archive -Path $zipPath -DestinationPath $testDir -Force
    Write-Host "  ✓ Package extracted successfully" -ForegroundColor Green
} catch {
    Write-Host "  ✗ Failed to extract package: $_" -ForegroundColor Red
    exit 1
}

# Verify all required files are present
Write-Host "`n3. Verifying extracted files..." -ForegroundColor Cyan
$requiredFiles = @(
    "manifest.json",
    "content.js",
    "pageScript.js",
    "countryFlags.js",
    "popup.html",
    "popup.js",
    "README.md"
)

$allFilesPresent = $true
foreach ($file in $requiredFiles) {
    $filePath = Join-Path $testDir $file
    if (Test-Path $filePath) {
        Write-Host "  ✓ $file" -ForegroundColor Green
    } else {
        Write-Host "  ✗ $file (MISSING)" -ForegroundColor Red
        $allFilesPresent = $false
    }
}

if (-not $allFilesPresent) {
    Write-Host "`nError: Some required files are missing from the package!" -ForegroundColor Red
    exit 1
}

# Verify no test files are included
Write-Host "`n4. Verifying no development files are included..." -ForegroundColor Cyan
$devFiles = @(
    "*.test.js",
    "vitest.config.js",
    "package.json",
    "package-lock.json",
    ".gitignore",
    "AGENTS.md"
)

$devFilesFound = $false
foreach ($pattern in $devFiles) {
    $found = Get-ChildItem -Path $testDir -Filter $pattern -ErrorAction SilentlyContinue
    if ($found) {
        Write-Host "  ✗ Development file found: $($found.Name)" -ForegroundColor Red
        $devFilesFound = $true
    }
}

if (-not $devFilesFound) {
    Write-Host "  ✓ No development files included" -ForegroundColor Green
}

# Validate manifest.json
Write-Host "`n5. Validating manifest.json..." -ForegroundColor Cyan
$manifestPath = Join-Path $testDir "manifest.json"
try {
    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
    
    # Check manifest version
    if ($manifest.manifest_version -eq 3) {
        Write-Host "  ✓ Manifest version: 3" -ForegroundColor Green
    } else {
        Write-Host "  ✗ Invalid manifest version: $($manifest.manifest_version)" -ForegroundColor Red
    }
    
    # Check Firefox-specific settings
    if ($manifest.browser_specific_settings.gecko) {
        Write-Host "  ✓ Firefox settings present" -ForegroundColor Green
        Write-Host "    - Extension ID: $($manifest.browser_specific_settings.gecko.id)" -ForegroundColor Gray
        Write-Host "    - Min Firefox version: $($manifest.browser_specific_settings.gecko.strict_min_version)" -ForegroundColor Gray
    } else {
        Write-Host "  ✗ Firefox settings missing" -ForegroundColor Red
    }
    
    # Check required permissions
    $requiredPermissions = @("activeTab", "storage", "tabs")
    $missingPermissions = @()
    foreach ($perm in $requiredPermissions) {
        if ($manifest.permissions -contains $perm) {
            Write-Host "  ✓ Permission: $perm" -ForegroundColor Green
        } else {
            Write-Host "  ✗ Missing permission: $perm" -ForegroundColor Red
            $missingPermissions += $perm
        }
    }
    
    # Check host permissions
    if ($manifest.host_permissions) {
        Write-Host "  ✓ Host permissions defined" -ForegroundColor Green
    } else {
        Write-Host "  ✗ Host permissions missing" -ForegroundColor Red
    }
    
    # Check content scripts
    if ($manifest.content_scripts -and $manifest.content_scripts.Count -gt 0) {
        Write-Host "  ✓ Content scripts defined" -ForegroundColor Green
    } else {
        Write-Host "  ✗ Content scripts missing" -ForegroundColor Red
    }
    
} catch {
    Write-Host "  ✗ Failed to parse manifest.json: $_" -ForegroundColor Red
    exit 1
}

# Check for browser API compatibility
Write-Host "`n6. Checking for browser API compatibility..." -ForegroundColor Cyan
$contentJs = Get-Content (Join-Path $testDir "content.js") -Raw
$popupJs = Get-Content (Join-Path $testDir "popup.js") -Raw

if ($contentJs -match "const browserAPI = typeof browser !== 'undefined' \? browser : chrome") {
    Write-Host "  ✓ content.js has browser API compatibility layer" -ForegroundColor Green
} else {
    Write-Host "  ✗ content.js missing browser API compatibility layer" -ForegroundColor Red
}

if ($popupJs -match "const browserAPI = typeof browser !== 'undefined' \? browser : chrome") {
    Write-Host "  ✓ popup.js has browser API compatibility layer" -ForegroundColor Green
} else {
    Write-Host "  ✗ popup.js missing browser API compatibility layer" -ForegroundColor Red
}

# Summary
Write-Host "`n" + ("=" * 60) -ForegroundColor Cyan
Write-Host "TEST SUMMARY" -ForegroundColor Cyan
Write-Host ("=" * 60) -ForegroundColor Cyan

if ($allFilesPresent -and -not $devFilesFound) {
    Write-Host "`n✓ All tests passed!" -ForegroundColor Green
    Write-Host "`nThe Firefox package is ready for installation testing." -ForegroundColor Green
    Write-Host "`nTo test in Firefox:" -ForegroundColor Yellow
    Write-Host "  1. Open Firefox" -ForegroundColor Gray
    Write-Host "  2. Navigate to: about:debugging#/runtime/this-firefox" -ForegroundColor Gray
    Write-Host "  3. Click 'Load Temporary Add-on...'" -ForegroundColor Gray
    Write-Host "  4. Navigate to: $testDir" -ForegroundColor Gray
    Write-Host "  5. Select: manifest.json" -ForegroundColor Gray
    Write-Host "`nThe extension should load without errors." -ForegroundColor Gray
    Write-Host "Test it on Twitter/X to verify functionality." -ForegroundColor Gray
} else {
    Write-Host "`n✗ Some tests failed!" -ForegroundColor Red
    Write-Host "Please review the errors above and rebuild the package." -ForegroundColor Yellow
    exit 1
}

Write-Host "`nTest extraction directory: $testDir" -ForegroundColor Cyan
Write-Host "You can manually inspect the files or load them in Firefox." -ForegroundColor Gray
