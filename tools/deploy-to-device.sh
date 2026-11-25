#!/usr/bin/env bash
# 部署 ruby-phone 到真机（Tavern 扩展目录）—— 两段式
#
# 【为什么需要这个脚本】
# v4 皮肤长期「写了不生效」，真因是**投递断裂**，不是代码错误：
#   仓库 HEAD = 4.200.0，真机 manifest 停在 4.199.0，
#   且真机 phone/font-scale.js 还是 4.159.0 的旧版 —— 它仍在 fetch(phone.css)
#   把**未分层且带 2008 处 !important** 的原始表注入 <style>，
#   逐条压死所有 @layer 皮肤（CSS 级联里 !important 恒压 @layer 内普通声明）。
#   结果：rp-entry.css 是新的、v4 皮肤文件都在、属性也挂了，但用户看到的仍是旧外观。
#
# 【为什么分两段】
# proot 里访问不到 /storage/emulated/0/Android/data（SELinux），
# 但 /sdcard 可读可写。所以：
#   第一段（proot）：打包 → /sdcard，并生成 Android 侧脚本
#   第二段（Android root）：解包 → 修属主 → 校验
#
# 【用法】
#   bash tools/deploy-to-device.sh pack     # 第一段：proot 里跑
#   su -c "sh /sdcard/rp_deploy_android.sh" # 第二段：Android 侧跑
#   bash tools/deploy-to-device.sh verify   # 只打印仓库侧哈希，用于比对
set -u

REPO="${REPO:-/home/user/_rl6/rp}"
PKG="com.tauritavern.client"
DEV="/storage/emulated/0/Android/data/$PKG/data/default-user/extensions/ruby-phone"
OWNER="10727:1078"
TARBALL="/sdcard/rp_deliver.tar.gz"
ANDROID_SH="/sdcard/rp_deploy_android.sh"

die() { echo "FAIL: $*" >&2; exit 1; }

[ -f "$REPO/manifest.json" ] || die "repo not found: $REPO"
RV=$(grep -m1 '"version"' "$REPO/manifest.json" | sed 's/[^0-9.]//g')

case "${1:-pack}" in

pack)
    echo "[pack] repo version = $RV"
    rm -f "$TARBALL"
    tar czf "$TARBALL" -C "$REPO" \
        --exclude=.git --exclude=node_modules --exclude=.sourcematerial . \
        || die "tar failed"
    echo "  $(wc -c < "$TARBALL") bytes, $(tar tzf "$TARBALL" | wc -l) entries"

    cat > "$ANDROID_SH" <<'ANDROID_EOF'
#!/system/bin/sh
DEV="/storage/emulated/0/Android/data/com.tauritavern.client/data/default-user/extensions/ruby-phone"
OWNER="10727:1078"
TS=$(date +%m%d-%H%M%S)
BK="/sdcard/Download/_bak_ext/rp_before_$TS.gz"

echo "[1/5] backup -> $BK"
tar czf "$BK" -C "$DEV" . 2>/dev/null || { echo "FAIL backup"; exit 1; }

echo "[2/5] extract"
chmod -R u+w "$DEV" 2>/dev/null
tar xzf /sdcard/rp_deliver.tar.gz -C "$DEV" || { echo "FAIL extract"; exit 1; }

echo "[3/5] ownership -> $OWNER"
chown -R $OWNER "$DEV"
chmod -R u+rwX,g+rwX,o-rwx "$DEV"
LEFT=$(find "$DEV" -user root 2>/dev/null | wc -l)
echo "  root-owned leftovers = $LEFT"

echo "[4/5] version"
grep -m1 '"version"' "$DEV/manifest.json"

echo "[5/5] critical checks"
OLD=$(grep -c 'fetch(ST_PHONE_GLOBAL_CSS_URL)' "$DEV/phone/font-scale.js" 2>/dev/null)
echo "  legacy phone.css fetch = ${OLD:-?} (must be 0)"
MISS=0
cd "$DEV/phone/design" || exit 1
for t in $(grep -o 'url("[^"]*")' rp-entry.css | sed 's/url("//;s/")//'); do
    [ -f "$t" ] || { echo "  MISSING $t"; MISS=$((MISS+1)); }
done
echo "  missing @import targets = $MISS (must be 0)"
echo "  legacy-phone.css bytes = $(wc -c < legacy-phone.css)"

if [ "$LEFT" = "0" ] && [ "$OLD" = "0" ] && [ "$MISS" = "0" ]; then
    echo "RESULT: DEPLOYED_OK"
else
    echo "RESULT: DEPLOYED_WITH_ISSUES left=$LEFT old=$OLD miss=$MISS"
fi
ANDROID_EOF

    echo "[pack] wrote $ANDROID_SH"
    echo "[pack] 下一步在 Android 侧执行：su -c \"sh $ANDROID_SH\""
    ;;

verify)
    echo "[verify] repo version = $RV"
    for f in index.js manifest.json phone/font-scale.js phone/design/rp-entry.css \
             phone/design/legacy-phone.css phone/theme-controller.js; do
        printf '  %-34s %s\n' "$f" "$(md5sum "$REPO/$f" | cut -d' ' -f1)"
    done
    echo "[verify] 用 Android 侧比对同名列；不一致即投递断裂。"
    ;;

*)
    echo "usage: $0 [pack|verify]"
    exit 2
    ;;
esac