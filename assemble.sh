#!/bin/bash
# DeepSeek Chat 2.0.0 构建脚本
# 依赖：aapt2 / zipalign / apksigner（Android build-tools）、python3
# 用法：bash assemble.sh
set -e
cd "$(dirname "$0")"

BT=/usr/lib/android-sdk/build-tools/debian
ANDROID_JAR=/root/sdk/android-11/android.jar
KEYSTORE="$(dirname "$0")/deepseek-demo.keystore"   # 跟着包走，换签名会丢用户数据
KS_ALIAS=deepseekdemo
KS_PASS=deepseekdemo
BASE_APK=DeepSeekChatbot-V1.0.apk      # 原版底包，提供 dex

# ── 1. 编译图标矢量 ──────────────────────────────
echo "[1/5] 编译图标"
cd wicon
rm -f res.zip out.apk && rm -rf ext
$BT/aapt2 compile --dir res -o res.zip
$BT/aapt2 link -o out.apk -I "$ANDROID_JAR" --manifest AndroidManifest.xml res.zip --min-sdk-version 26
unzip -o -q out.apk -d ext
cd ..

# ── 2. 重编资源表（app_name / 主题 / 图标）──────
# dec2 是 apktool 解码出的资源，stable-ids.txt 保证资源 ID 不变
echo "[2/5] 重编资源表"
cd dec2
cp ../wicon/res/drawable/ic_launcher.xml res/drawable/ic_launcher.xml
rm -f res.zip linked.apk
$BT/aapt2 compile --dir res -o res.zip
$BT/aapt2 link -o linked.apk -I "$ANDROID_JAR" \
  --manifest AndroidManifest.xml --stable-ids stable-ids.txt \
  --min-sdk-version 26 --target-sdk-version 35 \
  --version-code 20 --version-name 2.0.0 res.zip
cd ..

# ── 3. 组装 ─────────────────────────────────────
echo "[3/5] 组装 APK"
python3 - <<'PY'
import zipfile, os

src    = zipfile.ZipFile('DeepSeekChatbot-V1.0.apk')   # dex 与其它 assets
linked = zipfile.ZipFile('dec2/linked.apk')            # manifest / res / arsc
icon   = open('wicon/ext/res/drawable/ic_launcher.xml','rb').read()

front = {}
for r,_,fs in os.walk('cb/assets/chat'):
    for f in fs:
        p = os.path.join(r,f)
        front[os.path.relpath(p,'cb').replace('\\','/')] = open(p,'rb').read()

out = 'DeepSeek-Chat-2.0.0-unsigned.apk'
with zipfile.ZipFile(out,'w') as z:
    # 新资源表与清单
    for i in linked.infolist():
        zi = zipfile.ZipInfo(i.filename, date_time=(1981,1,1,1,1,0))
        # resources.arsc 必须 STORED，否则真机 INSTALL_FAILED (-124)
        zi.compress_type = zipfile.ZIP_STORED if i.filename=='resources.arsc' else zipfile.ZIP_DEFLATED
        data = icon if i.filename=='res/drawable/ic_launcher.xml' else linked.read(i.filename)
        z.writestr(zi, data)
    # 原包的 dex 和其余 assets（跳过旧前端、旧资源）
    for i in src.infolist():
        n = i.filename
        if n.startswith(('assets/chat/','res/','META-INF/')): continue
        if n in ('AndroidManifest.xml','resources.arsc'): continue
        zi = zipfile.ZipInfo(n, date_time=(1981,1,1,1,1,0))
        zi.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(zi, src.read(n))
    # 改写后的前端
    for n,d in front.items():
        zi = zipfile.ZipInfo(n, date_time=(1981,1,1,1,1,0))
        zi.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(zi, d)
print(f"  {out}  {os.path.getsize(out)/1e6:.2f} MB")
PY

# ── 4. 对齐 ─────────────────────────────────────
echo "[4/5] zipalign"
rm -f dsc-aligned.apk DeepSeek-Chat-2.0.0.apk
$BT/zipalign -f -p 4 DeepSeek-Chat-2.0.0-unsigned.apk dsc-aligned.apk

# ── 5. 签名 ─────────────────────────────────────
echo "[5/5] 签名"
$BT/apksigner sign --ks "$KEYSTORE" --ks-key-alias "$KS_ALIAS" \
  --ks-pass pass:$KS_PASS --key-pass pass:$KS_PASS \
  --min-sdk-version 26 --out DeepSeek-Chat-2.0.0.apk dsc-aligned.apk
$BT/apksigner verify DeepSeek-Chat-2.0.0.apk && echo "BUILD_OK"

echo
echo "产物: $(pwd)/DeepSeek-Chat-2.0.0.apk"
echo "安装: su -c 'pm install -r -t DeepSeek-Chat-2.0.0.apk'  或  adb install -r -t"
