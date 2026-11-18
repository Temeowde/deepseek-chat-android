#!/bin/bash
# DeepSeek Chat 构建脚本（完全自包含，不依赖任何外部 APK）
#
# 依赖：aapt2 / zipalign / apksigner（Android build-tools）、apktool.jar、python3
# 用法：bash assemble.sh
set -e
cd "$(dirname "$0")"

# 路径可用环境变量覆盖
BT="${BT:-$(dirname "$(command -v aapt2)")}"
ANDROID_JAR="${ANDROID_JAR:-$ANDROID_HOME/platforms/android-30/android.jar}"
# apktool：设 APKTOOL_JAR 走 jar，否则用 PATH 里的 apktool 命令
if [ -n "${APKTOOL_JAR:-}" ]; then APKTOOL="java -jar $APKTOOL_JAR"; else APKTOOL="apktool"; fi
KEYSTORE="$(dirname "$0")/release.keystore"
KS_ALIAS=release
KS_PASS="${KS_PASS:?请设置环境变量 KS_PASS}"

OUT=DeepSeek-Chat-2.0.0.apk

# ── 1. 编译 smali → dex ──────────────────────────
echo "[1/5] 编译 dex"
rm -rf .build && mkdir -p .build
cp -r src/smali src/smali_classes2 src/apktool.yml .build/
$APKTOOL b --no-res .build -o .build/dex.apk >/dev/null
mkdir -p .build/dex && unzip -o -q .build/dex.apk "classes*.dex" -d .build/dex

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
  --version-code 20 --version-name 2.0.0 res.zip
cd ..

# ── 4. 组装 ─────────────────────────────────────
echo "[4/5] 组装"
python3 - <<'PY'
import zipfile, os, glob

linked = zipfile.ZipFile('dec2/linked.apk')
icon   = open('wicon/ext/res/drawable/ic_launcher.xml','rb').read()
dexes  = {os.path.basename(p): open(p,'rb').read()
          for p in glob.glob('.build/dex/classes*.dex')}

front = {}
for r,_,fs in os.walk('cb/assets/chat'):
    for f in fs:
        p = os.path.join(r,f)
        front[os.path.relpath(p,'cb').replace('\\','/')] = open(p,'rb').read()

out = 'DeepSeek-Chat-2.0.0-unsigned.apk'
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
rm -f .build/aligned.apk "$OUT"
$BT/zipalign -f -p 4 DeepSeek-Chat-2.0.0-unsigned.apk .build/aligned.apk
$BT/apksigner sign --ks "$KEYSTORE" --ks-key-alias "$KS_ALIAS" \
  --ks-pass pass:$KS_PASS --key-pass pass:$KS_PASS \
  --min-sdk-version 26 --out "$OUT" .build/aligned.apk
$BT/apksigner verify "$OUT" && echo "BUILD_OK"

rm -f DeepSeek-Chat-2.0.0-unsigned.apk
echo
echo "产物: $(pwd)/$OUT"
