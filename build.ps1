# DeepSeek Chat 构建脚本（Windows / PowerShell）
#
# 依赖：JDK 17+、Node.js 22+、Android SDK build-tools 35 + platform 35
# 用法：pwsh -File build.ps1
#
# 可用环境变量覆盖：
#   ANDROID_SDK  Android SDK 根目录（默认读 ANDROID_HOME / ANDROID_SDK_ROOT，最后退回 D:\AndroidToolchain\sdk）
#   KEYSTORE     签名 keystore（默认 ~\.android\debug.keystore）
#   KS_ALIAS / KS_PASS / KEY_PASS
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not $env:ANDROID_SDK) {
  $env:ANDROID_SDK = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { 'D:\AndroidToolchain\sdk' }
}
$bt = Join-Path $env:ANDROID_SDK 'build-tools\35.0.1'
$androidJar = Join-Path $env:ANDROID_SDK 'platforms\android-35\android.jar'
$aapt2 = Join-Path $bt 'aapt2.exe'
$zipalign = Join-Path $bt 'zipalign.exe'
$apksigner = Join-Path $bt 'apksigner.bat'
$d8 = Join-Path $bt 'd8.bat'

foreach ($p in @($aapt2, $zipalign, $apksigner, $d8, $androidJar)) {
  if (-not (Test-Path $p)) { throw "缺少构建工具：$p" }
}

$keystore = if ($env:KEYSTORE) { $env:KEYSTORE } else { Join-Path $env:USERPROFILE '.android\debug.keystore' }
$ksAlias = if ($env:KS_ALIAS) { $env:KS_ALIAS } else { 'androiddebugkey' }
$ksPass = if ($env:KS_PASS) { $env:KS_PASS } else { 'android' }
$keyPass = if ($env:KEY_PASS) { $env:KEY_PASS } else { $ksPass }
if (-not (Test-Path $keystore)) { throw "找不到 keystore：$keystore" }

$toolsDir = Join-Path $PSScriptRoot 'tools'
$libs = (Get-ChildItem (Join-Path $toolsDir 'libs') -Filter *.jar | ForEach-Object { $_.FullName }) -join ';'
$smaliCp = (Join-Path $toolsDir 'smali.jar') + ';' + $libs

$versionName = node -p "require('./web/package.json').version"
$versionCode = node -p "require('./web/package.json').androidVersionCode"
$out = "DeepSeek-Chat-$versionName.apk"
$unsigned = ".build/android/DeepSeek-Chat-$versionName-unsigned.apk"

Write-Host '编译聊天前端'
npm --prefix web ci --ignore-scripts --include=optional --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'npm ci 失败' }
npm --prefix web run build
if ($LASTEXITCODE -ne 0) { throw '前端构建失败' }

Write-Host '[1/5] 编译 dex'
New-Item -ItemType Directory -Force -Path '.build/android/dex' | Out-Null
java -cp $smaliCp org.jf.smali.Main assemble src/smali -o .build/android/dex/classes.dex
if ($LASTEXITCODE -ne 0) { throw 'smali(classes) 失败' }
java -cp $smaliCp org.jf.smali.Main assemble src/smali_classes2 -o .build/android/dex/classes2.dex
if ($LASTEXITCODE -ne 0) { throw 'smali(classes2) 失败' }

New-Item -ItemType Directory -Force -Path '.build/android/java' | Out-Null
New-Item -ItemType Directory -Force -Path '.build/android/picker' | Out-Null
$javaFiles = Get-ChildItem 'src/java/com/temeowde/dschat' -Filter *.java | ForEach-Object { $_.FullName }
javac -encoding UTF-8 -source 8 -target 8 -cp $androidJar -d .build/android/java @javaFiles
if ($LASTEXITCODE -ne 0) { throw 'javac 失败' }
jar cf .build/android/picker.jar -C .build/android/java .
& $d8 --min-api 26 --lib $androidJar --output .build/android/picker .build/android/picker.jar
if ($LASTEXITCODE -ne 0) { throw 'd8 失败' }
Copy-Item '.build/android/picker/classes.dex' '.build/android/dex/classes3.dex' -Force

Write-Host '[2/5] 编译图标'
Push-Location wicon
Remove-Item -Recurse -Force ext -ErrorAction SilentlyContinue
Remove-Item -Force res.zip, out.apk -ErrorAction SilentlyContinue
& $aapt2 compile --dir res -o res.zip
if ($LASTEXITCODE -ne 0) { throw 'aapt2 compile(wicon) 失败' }
& $aapt2 link -o out.apk -I $androidJar --manifest AndroidManifest.xml res.zip --min-sdk-version 26
if ($LASTEXITCODE -ne 0) { throw 'aapt2 link(wicon) 失败' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
Remove-Item -Recurse -Force ext -ErrorAction SilentlyContinue
[System.IO.Compression.ZipFile]::ExtractToDirectory((Join-Path (Get-Location) 'out.apk'), (Join-Path (Get-Location) 'ext'))
Pop-Location

Write-Host '[3/5] 编译资源表'
Push-Location dec2
Copy-Item '..\wicon\res\drawable\ic_launcher.xml' 'res\drawable\ic_launcher.xml' -Force
Remove-Item -Force res.zip, linked.apk -ErrorAction SilentlyContinue
& $aapt2 compile --dir res -o res.zip
if ($LASTEXITCODE -ne 0) { throw 'aapt2 compile(dec2) 失败' }
& $aapt2 link -o linked.apk -I $androidJar --manifest AndroidManifest.xml --stable-ids stable-ids.txt --min-sdk-version 26 --target-sdk-version 35 --version-code $versionCode --version-name $versionName res.zip
if ($LASTEXITCODE -ne 0) { throw 'aapt2 link(dec2) 失败' }
Pop-Location

Write-Host '[4/5] 组装'
node tools/assemble.mjs (Get-Location).Path $unsigned
if ($LASTEXITCODE -ne 0) { throw '组装失败' }

Write-Host '[5/5] 对齐签名'
& $zipalign -f -p 4 $unsigned .build/android/aligned.apk
if ($LASTEXITCODE -ne 0) { throw 'zipalign 失败' }
Remove-Item -Force $out -ErrorAction SilentlyContinue
& $apksigner sign --ks $keystore --ks-key-alias $ksAlias --ks-pass "pass:$ksPass" --key-pass "pass:$keyPass" --min-sdk-version 26 --out $out .build/android/aligned.apk
if ($LASTEXITCODE -ne 0) { throw '签名失败' }
& $apksigner verify $out
if ($LASTEXITCODE -ne 0) { throw '验签失败' }
Remove-Item -Force $unsigned
Write-Host ''
Write-Host "BUILD_OK -> $PSScriptRoot\$out"