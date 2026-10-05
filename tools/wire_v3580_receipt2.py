#!/usr/bin/env python3
"""wire_v3580_receipt2.py — [v3.58.0 · 计划 O5] 把「无条件报成功」的写回执接进唯一实现（第二批）。

第一批（tools/wire_v3580_receipt.py）只收了 6 件：pvdesk / doujin / archive / cotdesk /
diagdesk / uterus —— 它们是按「apps/<k>/<k>-app.js + _writeJSON(key, value)」这个**形状**
找出来的。本批治的正是那个找法的漏网：

    _writeJSON(key, v) {                       ← 参数名 v（不是 value）、类体缩进 4 空格
        try {
            if (!this.storage || typeof this.storage.set !== 'function') return false;
            this.storage.set(key, JSON.stringify(v));
            return true;                        ← ★ 写调用抛没抛、落没落，全都不看
        } catch (_e) { return false; }
    }

全仓同形态共 16 件：shop / block / weather / widget / taobao / loverspace / date /
lofter / pixiv / magazine / soundkit / recall / sourcebook / kettle / needsim / musicdesk。

【为什么是同一族缺陷】真 PhoneStorage.set 是 async —— 调用**永不抛**（内部 try/catch 自己吞
并打日志）。于是这个 return true 在真环境里是**无条件**的：写盘被拒、宿主抛错、配额满，
界面一律报「已保存」。这与第一批 A 族（把 Promise 当布尔读 ⇒ saved 恒假）方向相反、
后果同一：**「存下了没有」这一格读不出真值**。

【用法】
    python3 tools/wire_v3580_receipt2.py            # dry-run，只列将改哪些件
    python3 tools/wire_v3580_receipt2.py --write    # 落盘
每处替换都断言旧锚点**恰中 1 次**，不唯一即整件跳过并报出。
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAMILY = [
    'shop', 'block', 'weather', 'widget', 'taobao', 'loverspace', 'date', 'lofter',
    'pixiv', 'magazine', 'soundkit', 'recall', 'sourcebook', 'kettle', 'needsim', 'musicdesk',
]
IMPORT_LINE = "import { writeReceipt } from '../../config/write-receipt.js';"
NEW_BODY = (
    "            /* [v3.58.0 · 计划 O5] 写回执走唯一实现：此前这里无条件 return true，\n"
    "             *   写调用失败（真 PhoneStorage 内部吞错）也照报成功。 */\n"
    "            return writeReceipt(this.storage, key, JSON.stringify(v)).saved === true;"
)
OLD_BODY = "            this.storage.set(key, JSON.stringify(v));\n            return true;"


def plan_one(key):
    rel = 'apps/' + key + '/' + key + '-app.js'
    path = os.path.join(ROOT, rel)
    with open(path, encoding='utf-8') as fh:
        src = fh.read()
    out = src
    notes = []
    if IMPORT_LINE in out:
        notes.append('import 已在场')
    else:
        pat = re.compile(r"import \{[^}]*\} from '\./" + re.escape(key) + r"-view\.js';")
        ms = list(pat.finditer(out))
        if len(ms) != 1:
            return None, ['import 锚点命中 %d 次（应 1）' % len(ms)]
        m = ms[0]
        out = out[:m.end()] + '\n' + IMPORT_LINE + out[m.end():]
        notes.append('补 import')
    n = out.count(OLD_BODY)
    if n != 1:
        return None, ['写体锚点命中 %d 次（应 1）' % n]
    out = out.replace(OLD_BODY, NEW_BODY, 1)
    notes.append('换写体')
    return (path, out), notes


def main():
    write = '--write' in sys.argv
    ok = 0
    for key in FAMILY:
        res, notes = plan_one(key)
        if res is None:
            print('SKIP  %-14s %s' % (key, ' | '.join(notes)))
            continue
        if write:
            path, out = res
            with open(path, 'w', encoding='utf-8') as fh:
                fh.write(out)
            print('WRITE %-14s %s' % (key, ' | '.join(notes)))
        else:
            print('DRY   %-14s %s' % (key, ' | '.join(notes)))
        ok += 1
    print('--- %s：%d/%d 件%s' % ('已落盘' if write else '可落盘', ok, len(FAMILY),
                                  '' if write else '（未写入，加 --write 落盘）'))


if __name__ == '__main__':
    main()