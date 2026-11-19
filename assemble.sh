#!/bin/bash
# DeepSeek Chat 构建脚本（完全自包含，不依赖任何外部 APK）
#
# 依赖：aapt2 / zipalign / apksigner（Android build-tools）、apktool.jar、python3、Node.js 22.12+、npm
# 用法：bash assemble.sh
set -e
cd "$(dirname "$0")"

# 路径可用环境变量覆盖
BT="${BT:-$(dirname "$(command -v aapt2)")}"
ANDROID_JAR="${ANDROID_JAR:-$ANDROID_HOME/platforms/android-35/android.jar}"
# apktool：设 APKTOOL_JAR 走 jar，否则用 PATH 里的 apktool 命令
if [ -n "${APKTOOL_JAR:-}" ]; then APKTOOL="java -jar $APKTOOL_JAR"; else APKTOOL="apktool"; fi
KEYSTORE="${KEYSTORE:-release.keystore}"
KS_ALIAS="${KS_ALIAS:-release}"
export KS_PASS="${KS_PASS:?请设置环境变量 KS_PASS}"

VERSION_NAME="$(node -p "require('./web/package.json').version")"
VERSION_CODE="$(node -p "require('./web/package.json').androidVersionCode")"
OUT="DeepSeek-Chat-${VERSION_NAME}.apk"
UNSIGNED=".build/android/DeepSeek-Chat-${VERSION_NAME}-unsigned.apk"

echo "编译聊天前端"
npm --prefix web ci --ignore-scripts --include=optional --no-audit --no-fund
npm --prefix web run build

# ── 1. 编译 smali → dex ──────────────────────────
echo "[1/5] 编译 dex"
mkdir -p .build/android
cp -r src/smali src/smali_classes2 src/apktool.yml .build/android/
$APKTOOL b --no-res .build/android -o .build/android/dex.apk >/dev/null
mkdir -p .build/android/dex && unzip -o -q .build/android/dex.apk "classes*.dex" -d .build/android/dex
mkdir -p .build/android/java .build/android/picker
javac -encoding UTF-8 -source 8 -target 8 -cp "$ANDROID_JAR" -d .build/android/java src/java/com/temeowde/dschat/*.java
jar cf .build/android/picker.jar -C .build/android/java .
"$BT/d8" --min-api 26 --lib "$ANDROID_JAR" --output .build/android/picker .build/android/picker.jar
cp .build/android/picker/classes.dex .build/android/dex/classes3.dex

# ── 2. 编译图标 ─────────────────────────────────
echo "[2/5] 编译图标"
cd wicon
rm -f res.zip out.apk && rm -rf ext
$BT/aapt2 compile --dir res -o res.zip
$BT/aapt2 link -o out.apk -I "$ANDROID_JAR" --manifest AndroidManifest.xml res.zip --min-sdk-version 26
unzip -o -q out.apk -d ext
cd ..

# ── 3. 编译资源表 ───────────────────────────────
echo "[3/5] 编译资源表"
cd dec2
cp ../wicon/res/drawable/ic_launcher.xml res/drawable/ic_launcher.xml
rm -f res.zip linked.apk
$BT/aapt2 compile --dir res -o res.zip
$BT/aapt2 link -o linked.apk -I "$ANDROID_JAR" \
  --manifest AndroidManifest.xml --stable-ids stable-ids.txt \
  --min-sdk-version 26 --target-sdk-version 35 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" res.zip
cd ..

# ── 4. 组装 ─────────────────────────────────────
echo "[4/5] 组装"
python3 - "$UNSIGNED" <<'PY'
import zipfile, os, glob, sys

linked = zipfile.ZipFile('dec2/linked.apk')
icon   = open('wicon/ext/res/drawable/ic_launcher.xml','rb').read()
dexes  = {os.path.basename(p): open(p,'rb').read()
          for p in glob.glob('.build/android/dex/classes*.dex')}

front = {}
for r,_,fs in os.walk('web/dist'):
    for f in fs:
        p = os.path.join(r,f)
        front['assets/chat/' + os.path.relpath(p, 'web/dist').replace('\\', '/')] = open(p,'rb').read()

out = sys.argv[1]
with zipfile.ZipFile(out,'w') as z:
    # 资源表与清单
    for i in linked.infolist():
        zi = zipfile.ZipInfo(i.filename, date_time=(1981,1,1,1,1,0))
        # resources.arsc 必须 STORED，压缩会 INSTALL_FAILED (-124)
        zi.compress_type = zipfile.ZIP_STORED if i.filename=='resources.arsc' else zipfile.ZIP_DEFLATED
        data = icon if i.filename=='res/drawable/ic_launcher.xml' else linked.read(i.filename)
        z.writestr(zi, data)
    # dex
    for name, data in sorted(dexes.items()):
        zi = zipfile.ZipInfo(name, date_time=(1981,1,1,1,1,0))
        zi.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(zi, data)
    # 前端
    for n,d in front.items():
        zi = zipfile.ZipInfo(n, date_time=(1981,1,1,1,1,0))
        zi.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(zi, d)
print(f"  {out}  {os.path.getsize(out)/1e6:.2f} MB  ({len(dexes)} 个 dex)")
PY

# ── 5. 对齐签名 ─────────────────────────────────
echo "[5/5] 对齐签名"
rm -f .build/android/aligned.apk "$OUT"
"$BT/zipalign" -f -p 4 "$UNSIGNED" .build/android/aligned.apk
"$BT/apksigner" sign --ks "$KEYSTORE" --ks-key-alias "$KS_ALIAS" \
  --ks-pass env:KS_PASS --key-pass env:KS_PASS \
  --min-sdk-version 26 --out "$OUT" .build/android/aligned.apk
$BT/apksigner verify "$OUT" && echo "BUILD_OK"

rm -f "$UNSIGNED"
echo
echo "产物: $(pwd)/$OUT"
