# PW Teacher Studio - Native Android APK Compiler
$ErrorActionPreference = "Stop"

Write-Host "========================================================================" -ForegroundColor Magenta
Write-Host "  PW Teacher Studio - Native Android Faculty APK Compiler" -ForegroundColor Magenta
Write-Host "========================================================================" -ForegroundColor Magenta

$baseDir = $PSScriptRoot
$sdk = "C:\Users\vivek\android-sdk"
$buildTools = "$sdk\build-tools\34.0.0"
$aapt2 = "$buildTools\aapt2.exe"
$d8 = "$buildTools\d8.bat"
$zipalign = "$buildTools\zipalign.exe"
$apksigner = "$buildTools\apksigner.bat"
$androidJar = "$sdk\platforms\android-34\android.jar"

$buildDir = "$baseDir\build-teacher"
if (Test-Path $buildDir) {
    Remove-Item $buildDir -Recurse -Force | Out-Null
}
New-Item -ItemType Directory -Path "$buildDir\gen" -Force | Out-Null
New-Item -ItemType Directory -Path "$buildDir\classes" -Force | Out-Null
New-Item -ItemType Directory -Path "$buildDir\dex" -Force | Out-Null

Write-Host "[1/6] Compiling Teacher Android Resources with AAPT2..." -ForegroundColor Yellow
& $aapt2 compile --dir "$baseDir\android-teacher\res" -o "$buildDir\resources.zip"
if ($LASTEXITCODE -ne 0) { throw "AAPT2 compile failed" }

Write-Host "[2/6] Linking Android Package & Bundling Web Assets..." -ForegroundColor Yellow
& $aapt2 link -I $androidJar `
    --manifest "$baseDir\android-teacher\AndroidManifest.xml" `
    -A "$baseDir\public" `
    -o "$buildDir\app-unsigned.apk" `
    --java "$buildDir\gen" `
    --auto-add-overlay `
    "$buildDir\resources.zip"
if ($LASTEXITCODE -ne 0) { throw "AAPT2 link failed" }

Write-Host "[3/6] Compiling Java Sources..." -ForegroundColor Yellow
$javaSources = @(
    "$buildDir\gen\com\pw\teacherstudio\R.java",
    "$baseDir\android-teacher\src\com\pw\teacherstudio\MainActivity.java"
)

& javac -encoding UTF-8 -bootclasspath $androidJar -source 8 -target 8 -d "$buildDir\classes" $javaSources
if ($LASTEXITCODE -ne 0) { throw "Java compilation failed" }

Write-Host "[4/6] Transpiling to Dalvik Executable (classes.dex) with D8..." -ForegroundColor Yellow
$classFiles = (Get-ChildItem -Path "$buildDir\classes" -Filter "*.class" -Recurse | Select-Object -ExpandProperty FullName)
& $d8 --lib $androidJar --output "$buildDir\dex" $classFiles
if ($LASTEXITCODE -ne 0) { throw "D8 dex compilation failed" }

# Add classes.dex into app-unsigned.apk
& jar.exe uf "$buildDir\app-unsigned.apk" -C "$buildDir\dex" classes.dex
if ($LASTEXITCODE -ne 0) { throw "Failed to package classes.dex into APK" }

Write-Host "[5/6] Zip-Aligning APK..." -ForegroundColor Yellow
& $zipalign -f -p 4 "$buildDir\app-unsigned.apk" "$buildDir\app-aligned.apk"
if ($LASTEXITCODE -ne 0) { throw "Zipalign failed" }

Write-Host "[6/6] Signing APK..." -ForegroundColor Yellow
$keystorePath = "$baseDir\build\debug.keystore"
if (-not (Test-Path $keystorePath)) {
    $keystorePath = "$buildDir\debug.keystore"
    & keytool.exe -genkeypair -validity 10000 `
        -dname "CN=PWTeacherStudio,O=PhysicsWallah,C=IN" `
        -keystore $keystorePath `
        -storepass android `
        -keypass android `
        -alias pwshield `
        -keyalg RSA `
        -keysize 2048
}

$outputApk = "$baseDir\PW-Teacher-Studio.apk"
& $apksigner sign --ks $keystorePath --ks-pass pass:android --ks-key-alias pwshield --out $outputApk "$buildDir\app-aligned.apk"
if ($LASTEXITCODE -ne 0) { throw "Apksigner failed" }

# Verify signature
& $apksigner verify $outputApk
if ($LASTEXITCODE -ne 0) { throw "APK verification failed" }

$apkSizeMB = [math]::Round(((Get-Item $outputApk).Length / 1MB), 2)
Write-Host ""
Write-Host "========================================================================" -ForegroundColor Green
Write-Host "  TEACHER APK BUILD SUCCESSFUL!" -ForegroundColor Green
Write-Host "  Output APK: $outputApk ($apkSizeMB MB)" -ForegroundColor Green
Write-Host "========================================================================" -ForegroundColor Green

# Copy to PC Downloads
$downloadsApk = "C:\Users\vivek\Downloads\PW-Teacher-Studio.apk"
Copy-Item $outputApk $downloadsApk -Force
Write-Host "[+] Copied to PC Downloads: $downloadsApk" -ForegroundColor Cyan

# Copy to Vivek's S25 Phone
$phoneDownloadDir = "C:\Users\vivek\CrossDevice\Vivek's S25\storage\Download"
if (Test-Path $phoneDownloadDir) {
    Copy-Item $outputApk "$phoneDownloadDir\PW-Teacher-Studio.apk" -Force
    Write-Host "[+] Copied to Vivek's S25 Phone: $phoneDownloadDir\PW-Teacher-Studio.apk" -ForegroundColor Green
}
