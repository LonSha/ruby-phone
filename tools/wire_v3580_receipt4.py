#!/usr/bin/env python3
"""wire_v3580_receipt4.py — [v3.58.0 · 计划 O5] 把**异步写路径**接上唯一实现的异步出口。

【治的是什么】O5 的唯一实现 `config/write-receipt.js` 有两个出口：同步 `writeReceipt` 与
异步 `writeReceiptAsync`（多一次 `await`，等真 PhoneStorage 落队）。案头一族是同步写，
第二批已接同步出口；而 `apps/settings/image-upload.js` 的 `_saveCache()` 走的是

    await this.storage.set(this.storageKey, JSON.stringify(this.cache));

—— **await 了，但把回执丢了**：写失败只留一行 `console.error`，十个调用点（上传、删除、
迁移、清索引）全都当成功继续走。这与 O5 治的「回执与真实落盘一致」是同一个病：
`saved` 这一格在真实失败时读不出真值。异步出口此前零消费 —— 它是为这条路径存在的。

【改法】`_saveCache()` 改走 `writeReceiptAsync`，并把回执**还给调用方**；失败仍然打日志
（保留原有可观测面），但不再把结果吞掉。写体、键名、`window` 侧同步逻辑一字不动。

【用法】
    python3 tools/wire_v3580_receipt4.py            # dry-run
    python3 tools/wire_v3580_receipt4.py --write    # 落盘
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = 'apps/settings/image-upload.js'

IMPORT_OLD = "import { detectImageMime } from '../../config/image-mime.js';\n"
IMPORT_NEW = ("import { detectImageMime } from '../../config/image-mime.js';\n"
              "import { writeReceiptAsync } from '../../config/write-receipt.js';\n")

BODY_OLD = """    async _saveCache() {
        try {
            await this.storage.set(this.storageKey, JSON.stringify(this.cache));
            // 同步到全局 imageManager，避免设置页实例与主屏实例缓存分叉
            if (window.VirtualPhone?.imageManager && window.VirtualPhone.imageManager !== this) {
                window.VirtualPhone.imageManager.cache = JSON.parse(JSON.stringify(this.cache));
            }
        } catch (e) {
            console.error('[ImageUpload] 保存图片路径失败:', e);
        }
    }
"""

BODY_NEW = """    async _saveCache() {
        try {
            /* [v3.58.0 · 计划 O5] 写回执走唯一实现：此前 `await this.storage.set(...)` 的结果
             *   被当场丢掉 —— 写失败只在控制台留一行，十个调用点（上传 / 删除 / 迁移）照旧
             *   当成功。异步出口正是为这条路径存在的：等落队，并把 `saved` 还给调用方。 */
            const receipt = await writeReceiptAsync(this.storage, this.storageKey, JSON.stringify(this.cache));
            if (!receipt.saved) {
                console.error('[ImageUpload] 保存图片路径失败:', receipt.why);
                return receipt;
            }
            // 同步到全局 imageManager，避免设置页实例与主屏实例缓存分叉
            if (window.VirtualPhone?.imageManager && window.VirtualPhone.imageManager !== this) {
                window.VirtualPhone.imageManager.cache = JSON.parse(JSON.stringify(this.cache));
            }
            return receipt;
        } catch (e) {
            console.error('[ImageUpload] 保存图片路径失败:', e);
            return { saved: false, why: 'save_threw' };
        }
    }
"""


def main():
    write = '--write' in sys.argv
    path = os.path.join(ROOT, TARGET)
    with open(path, encoding='utf-8') as fh:
        src = fh.read()
    bad = []
    for name, old in (('import', IMPORT_OLD), ('_saveCache 写体', BODY_OLD)):
        n = src.count(old)
        if n != 1:
            bad.append('%s 锚点命中 %d 次（应 1）' % (name, n))
    if bad:
        for msg in bad:
            print('BAD   ' + msg)
        sys.exit(1)
    out = src.replace(IMPORT_OLD, IMPORT_NEW, 1).replace(BODY_OLD, BODY_NEW, 1)
    if write:
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(out)
        print('WRITE %s' % TARGET)
    else:
        print('DRY   %s（未写入，加 --write 落盘）' % TARGET)


if __name__ == '__main__':
    main()