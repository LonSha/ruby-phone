#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# wire_v3580_receipt.py — [v3.58.0 · 计划 O5] 把两族「写回执」统一到唯一真源 config/write-receipt.js
#
# 【修的是什么】真 PhoneStorage.set 是 async（返回 Promise）。两族桌面 App 各自对着**错契约**取值：
#   A 族（11 件 *_writeRaw）：`const wrote = this.storage.set(k,v); return { saved: wrote === true }`
#                             —— `Promise === true` 恒假 ⇒ 真环境 saved 恒 false、why 恒 set_false。
#   B 族（6 件 *_writeJSON）：`this.storage.set(k, JSON.stringify(v)); return true;`
#                             —— 压根没摸返回值、无条件报成功 ⇒ 写调用抛错时也照报成功。
#   两族方向相反、后果同一：**「存下了没有」这一格读不出真值**（A 恒假 / B 恒真），
#   而单元夹具里的同步假 storage 让两族都恰好「正确」⇒ 判据全绿、缺陷只活在真机。
#
# 【怎么修】两族都改为调唯一实现 writeReceipt（真 Promise 不当布尔读；明确 false/undefined 报
#   set_false；抛错报 write_threw），并保留各自原有前置门语义。
#   台账（本脚本即修复清单，判据套件按同一份清单对账）：
#     A 族 11 件：memtable socialguard freehome stickerdesk lexiscore periodmath annidate
#                 cardtable summdesk sullydesk traveldesk
#     B 族 6 件：archive cotdesk diagdesk doujin pvdesk uterus
#
# 纪律：逐文件断言锚点恰中 1 次；默认 dry-run，--write 才落盘（落盘前先做完整替换，再统一写）。
import os
import sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NL = chr(10)
WRITE = '--write' in sys.argv
A_FILES = ['memtable', 'socialguard', 'freehome', 'stickerdesk', 'lexiscore', 'periodmath',
           'annidate', 'cardtable', 'summdesk', 'sullydesk', 'traveldesk']
B_FILES = ['archive', 'cotdesk', 'diagdesk', 'doujin', 'pvdesk', 'uterus']
IMPORT_LINE = "import { writeReceipt } from '../../config/write-receipt.js';"
A_NEW_BODY = ("        try {" + NL
              + "            /* [v3.58.0 · 计划 O5] 写回执走唯一实现：真 PhoneStorage.set 是 async，" + NL
              + "             *   把它的返回值当同步布尔读会让 saved 恒假（见 config/write-receipt.js 头注）。 */" + NL
              + "            return writeReceipt(this.storage, key, value);" + NL
              + "        } catch (e) {" + NL
              + "            return { saved: false, why: 'write_threw' };" + NL
              + "        }" + NL
              + "    }")
B_NEW_BODY = ("        try {" + NL
              + "            /* [v3.58.0 · 计划 O5] 写回执走唯一实现：此前这里无条件 return true，" + NL
              + "             *   写调用失败也照报成功（与 A 族方向相反的同一类错）。 */" + NL
              + "            return writeReceipt(this.storage, key, JSON.stringify(value)).saved === true;" + NL
              + "        } catch (e) {" + NL
              + "            return false;" + NL
              + "        }" + NL
              + "    }")


def rd(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def once(s, old, new, tag):
    n = s.count(old)
    assert n == 1, '[%s] 锚点必须恰中 1 次，实得 %d' % (tag, n)
    return s.replace(old, new, 1)


def add_import(src, rel):
    lines = src.split(NL)
    idxs = [i for i, l in enumerate(lines) if l.startswith('import ')]
    assert idxs, rel + ' 找不到静态 import 行'
    last = max(idxs)
    while last < len(lines) and not lines[last].rstrip().endswith(';'):
        last += 1
    assert last < len(lines), rel + ' 找不到 import 的收尾行'
    lines.insert(last + 1, IMPORT_LINE)
    return NL.join(lines)


OLD_A_MULTI = ("        try {" + NL
               + "            const wrote = this.storage.set(key, value);" + NL
               + "            return { saved: wrote === true, why: wrote === true ? '' : 'set_false' };" + NL
               + "        } catch (e) {" + NL
               + "            return { saved: false, why: 'write_threw' };" + NL
               + "        }" + NL
               + "    }")
OLD_A_SINGLE = ("        try {" + NL
                + "            const wrote = this.storage.set(key, value);" + NL
                + "            return { saved: wrote === true, why: wrote === true ? '' : 'set_false' };" + NL
                + "        } catch (e) { return { saved: false, why: 'write_threw' }; }" + NL
                + "    }")
OLD_B_MULTI = ("        try {" + NL
               + "            this.storage.set(key, JSON.stringify(value));" + NL
               + "            return true;" + NL
               + "        } catch (e) {" + NL
               + "            return false;" + NL
               + "        }" + NL
               + "    }")
OLD_B_SINGLE = "        try { this.storage.set(key, JSON.stringify(value)); return true; }"
NEW_B_SINGLE = ("        try {" + NL
                + "            /* [v3.58.0 · 计划 O5] 写回执走唯一实现（此前无条件 return true）。 */" + NL
                + "            return writeReceipt(this.storage, key, JSON.stringify(value)).saved === true;" + NL
                + "        } catch (e) { return false; }")

plan = []
for key in A_FILES:
    rel = 'apps/%s/%s-app.js' % (key, key)
    src = rd(rel)
    assert IMPORT_LINE not in src, rel + ' 已经接过 writeReceipt'
    body = None
    if src.count(OLD_A_MULTI) == 1:
        body = (OLD_A_MULTI, A_NEW_BODY, 'multi')
    elif src.count(OLD_A_SINGLE) == 1:
        body = (OLD_A_SINGLE, A_NEW_BODY, 'single')
    else:
        raise AssertionError(rel + ' A 族写体形态不在册（multi=%d single=%d）'
                             % (src.count(OLD_A_MULTI), src.count(OLD_A_SINGLE)))
    out = add_import(src, rel)
    out = once(out, body[0], body[1], rel + ' _writeRaw/' + body[2])
    plan.append((rel, 'A', body[2], out))

for key in B_FILES:
    rel = 'apps/%s/%s-app.js' % (key, key)
    src = rd(rel)
    assert IMPORT_LINE not in src, rel + ' 已经接过 writeReceipt'
    body = None
    if src.count(OLD_B_MULTI) == 1:
        body = (OLD_B_MULTI, B_NEW_BODY, 'multi')
    elif src.count(OLD_B_SINGLE) == 1:
        body = (OLD_B_SINGLE, NEW_B_SINGLE, 'single')
    else:
        raise AssertionError(rel + ' B 族写体形态不在册（multi=%d single=%d）'
                             % (src.count(OLD_B_MULTI), src.count(OLD_B_SINGLE)))
    out = add_import(src, rel)
    out = once(out, body[0], body[1], rel + ' _writeJSON/' + body[2])
    plan.append((rel, 'B', body[2], out))

print('== 接线清单（%d 件）==' % len(plan))
for rel, fam, shape, out in plan:
    assert IMPORT_LINE in out, rel + ' 缺 import'
    assert 'writeReceipt(this.storage, key' in out, rel + ' 未接到唯一实现'
    assert 'const wrote = this.storage.set(' not in out, rel + ' 旧读数残留'
    print('  %-40s [%s 族 / %s]' % (rel, fam, shape))
if not WRITE:
    print('（dry-run，未落盘）')
    sys.exit(0)
for rel, _fam, _shape, out in plan:
    with open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(out)
print('已落盘 %d 件' % len(plan))