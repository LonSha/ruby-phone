#!/usr/bin/env python3
"""v3.61.0 收口 · 第一批补丁（dead-export 夹具闸 + 公告块同源 + update-log head）

三处独立改动，逐处锚点须恰中 1 次，失配即退出、不写盘。

① **真缺陷**（本批最重要）`scripts/dead-export-check.mjs` 的 O6 新增闸
   `if (LAZY_CLS_SET.size < 60) { ... exit 2 }` **没有夹具通道判断** ——
   合成仓没有 `config/app-lazy-routes.js`，于是 v241~v245 五个套件的
   全部负控制在夹具里拿到 exit 2（拒判），判据全数落空。
   实测：`RP_DEAD_EXPORT_FIXTURE=1 node scripts/dead-export-check.mjs --root /tmp/fx1` ⇒ rc=2。
   同文件既有闸一律写 `if (!FIXTURE_MODE && ...)`（MIN_EXPORTS / 完整性闸 / 结构健康），
   本闸漏了。修法：加 `!FIXTURE_MODE`，与同文件既有纪律对齐。
   ★ 这不是「放水」：夹具有自己的下限锚（MIN_EXPORTS=1），真仓仍走 `< 60` 拒判。

② `index.js` 的 `ST_PHONE_CURRENT_UPDATE.items` 与 `update-log.json` 的
   `3.61.0.items` 有 **3 条不逐字同源**（1 条缺尾注、1 条有 4 处措辞漂移、
   1 条缺数字尾注）。9 个套件锁着「逐字同源」。修法：**以 update-log 为真源**，
   把公告块对应条目改写为逐字同一份文本（公告块是复制品，日志是账本）。

③ `update-log.json` 顶层 `"head": "3.60.0"` 未随抬版推进（现 manifest 3.61.0）。
   套件 system-v3300 的 V1 明判 `log.head === man.version`。

另：①的修法决定了本批不动 index.js 的公告块「O6 回归证据」等历史条目语义，
只做**逐字对齐**，不改内容主张。
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path('/home/user/ruby-phone')


def sub_once(rel, old, new, why):
    p = ROOT / rel
    s = p.read_text(encoding='utf-8')
    n = s.count(old)
    if n != 1:
        sys.exit('[patch] %s 锚点命中 %d 次（要求恰 1 次）：%s\n--- old ---\n%s' % (rel, n, why, old[:400]))
    p.write_text(s.replace(old, new, 1), encoding='utf-8')
    print('[patch] %-42s %s' % (rel, why))


# ── ① dead-export 夹具通道 ──
sub_once(
    'scripts/dead-export-check.mjs',
    "if (LAZY_CLS_SET.size < 60) {",
    "if (!FIXTURE_MODE && LAZY_CLS_SET.size < 60) {",
    'lazy-route 闸补夹具通道（真缺陷：夹具负控制全被拒判）',
)

# ── ② 公告块逐字对齐（以 update-log 为真源） ──
idx_path = ROOT / 'index.js'
src = idx_path.read_text(encoding='utf-8')
log = json.loads((ROOT / 'update-log.json').read_text(encoding='utf-8'))
lit = log['versions']['3.61.0']['items']

m = re.search(r'const ST_PHONE_CURRENT_UPDATE = \{(.*?)\n\};', src, re.S)
if not m:
    sys.exit('[patch] index.js 公告块未找到')
body = m.group(1)
ann_raw = re.findall(r'^\s*"((?:[^"\\]|\\.)*)"', body, re.M)
if len(ann_raw) != len(lit):
    sys.exit('[patch] 公告条数 %d ≠ 日志条数 %d' % (len(ann_raw), len(lit)))


def js_unescape(s):
    out, i = [], 0
    while i < len(s):
        if s[i] == '\\' and i + 1 < len(s):
            out.append({'n': '\n', 't': '\t', 'r': '\r', '"': '"', "'": "'", '\\': '\\'}.get(s[i + 1], '\\' + s[i + 1]))
            i += 2
            continue
        out.append(s[i])
        i += 1
    return ''.join(out)


def js_escape(s):
    return s.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n')


fixed = 0
new_body = body
for i, (raw, want) in enumerate(zip(ann_raw, lit)):
    if js_unescape(raw) == want:
        continue
    new_body = new_body.replace('"' + raw + '"', '"' + js_escape(want) + '"', 1)
    fixed += 1
    print('[patch] index.js 公告第 %d 条 → 与 update-log 逐字同源' % i)
if fixed == 0:
    sys.exit('[patch] 公告块无需对齐（预期 3 处，实测 0 —— 锚点形态可能变了）')
src = src.replace(m.group(0), 'const ST_PHONE_CURRENT_UPDATE = {' + new_body + '\n};', 1)
idx_path.write_text(src, encoding='utf-8')

# ── ③ update-log head ──
log_path = ROOT / 'update-log.json'
s = log_path.read_text(encoding='utf-8')
old_head = '"head": "3.60.0"'
if s.count(old_head) != 1:
    sys.exit('[patch] update-log head 锚点命中 %d 次' % s.count(old_head))
log_path.write_text(s.replace(old_head, '"head": "3.61.0"', 1), encoding='utf-8')
print('[patch] %-42s head 3.60.0 → 3.61.0' % 'update-log.json')

print('\n[patch] 完成')
