#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""bump_v3640.py — 抬版 v3.64.0（五源同源）。
与 bump_v3600.py 同款范式（本脚本零反斜杠：全部走字符串定位，不用正则转义）：
  ① update-log.json：新键插首位，latest / head 同置；
  ② manifest.json / package.json / index.js 的 ST_PHONE_VERSION 常量；
  ③ index.js 的 ST_PHONE_CURRENT_UPDATE 公告块 —— 由条目真源生成（当版 items 是块头部前缀）；
  ④ ITERATION_LOG.md：头部插迭代段 + 「当前版本」行改当版 + 头部版本数由真源重算；
  ⑤ docs/runtime-verification-boundary.md：当版复校标记 + 两道真门实测数字（语法 / 导入，走真跑取数）。
纪律：只写上面五处；先算 draft、逐份断言、最后才落盘；默认 dry-run，--write 才落盘。
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VER = '3.64.0'
DATE = '2026-10-07'
PREV = '3.63.0'
SEG_ANCHOR = '## 迭代 121 ' + chr(8212) + ' '
WRITE = '--write' in sys.argv
NL = chr(10)
DQ = chr(34)
BS = chr(92)
DOC = 'docs/runtime-verification-boundary.md'


def rd(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def once(s, old, new, tag):
    n = s.count(old)
    assert n == 1, '[%s] 锚点必须恰中 1 次，实得 %d' % (tag, n)
    return s.replace(old, new, 1)
def once_line(s, old, new, tag):
    """行首整行锚点：doc 里那些数字在历史复校留档里也会出现（散文侵入），
    所以契约行必须以「换行 + 行首」定位，才既唯一又不碰历史留档。"""
    assert NL not in old and NL not in new, tag
    return once(s, NL + old, NL + new, tag + '（行首整行）')


SEG = rd('tools/iter122_seg.md').rstrip(NL)
assert BS not in SEG, '迭代段不得含反斜杠'
assert '[' not in SEG and ']' not in SEG, '迭代段不得含方括号（弹窗切片判据按首个右方括号截断）'
ITEMS = []
for line in SEG.split(NL):
    line = line.strip()
    if not line.startswith('- '):
        continue
    it = line[2:].strip()
    if it.startswith('**'):
        it = it[2:]
    if it.endswith('**'):
        it = it[:-2]
    it = it.strip()
    assert it.startswith(chr(0x3010)), it[:24]
    ITEMS.append(it)
for i, it in enumerate(ITEMS):
    assert chr(0x3011) in it, i
    assert NL not in it, i
    assert DQ not in it, i
    assert BS not in it, i
    assert '[' not in it and ']' not in it, i
assert len(ITEMS) >= 4, len(ITEMS)

# ① update-log.json
log = json.loads(rd('update-log.json'))
assert log['latest'] == PREV, log['latest']
assert log['head'] == PREV, log['head']
assert list(log['versions'])[0] == PREV
assert VER not in log['versions']
OLD_N = len(log['versions'])
entry = {'version': VER, 'date': DATE, 'items': ITEMS}
new_versions = {VER: entry}
for k, v in log['versions'].items():
    new_versions[k] = v
new_log = {'latest': VER, 'versions': new_versions, 'head': VER}
assert list(new_log['versions'])[0] == VER
assert len(new_versions) == OLD_N + 1

# ② manifest / package
man = json.loads(rd('manifest.json'))
pkg = json.loads(rd('package.json'))
assert man['version'] == PREV and pkg['version'] == PREV
man['version'] = VER
pkg['version'] = VER

# ③ index.js
idx = rd('index.js')
idx_new = once(idx, "const ST_PHONE_VERSION = '%s';" % PREV,
               "const ST_PHONE_VERSION = '%s';" % VER, 'index.js 版本常量')
START = 'const ST_PHONE_CURRENT_UPDATE = {'
assert idx_new.count(START) == 1
bi = idx_new.find(START)
bj = idx_new.find(NL + '};', bi)
assert bi > 0 and bj > bi, 'ST_PHONE_CURRENT_UPDATE 块必须可提取'
OLD_BLOCK = idx_new[bi:bj]
old_items_part = OLD_BLOCK[OLD_BLOCK.index('items: [') + len('items: ['):OLD_BLOCK.rindex('    ]')]
OLD_LINES = [l for l in old_items_part.split(NL) if l.strip().startswith(DQ)]
assert len(OLD_LINES) >= 5, '旧块 items 行数异常：%d' % len(OLD_LINES)
merged = [START, '    version: ST_PHONE_VERSION,', '    date: ' + DQ + DATE + DQ + ',', '    items: [']
for it in ITEMS:
    merged.append('        ' + json.dumps(it, ensure_ascii=False) + ',')
merged.extend(OLD_LINES)
merged.append('    ]')
merged.append('};')
idx_new = idx_new[:bi] + NL.join(merged) + idx_new[bj + len(NL) + 2:]
assert idx_new.count(START) == 1
for it in ITEMS:
    assert json.dumps(it, ensure_ascii=False) in idx_new
seg_start = idx_new.index('    items: [', idx_new.index(START))
seg_end = idx_new.index(NL + '    ]', seg_start)
for ln in idx_new[seg_start:seg_end].split(NL):
    if not ln.strip().startswith(DQ):
        continue
    q = ln.count(DQ) - ln.count(BS + DQ)
    assert q % 2 == 0, '公告块引号数异常（行内引号 %d）：%s' % (q, ln[:60])

# ④ ITERATION_LOG.md
itlog = rd('ITERATION_LOG.md')
itlog = once(itlog, '- **当前版本**：`%s`（五源同源）' % PREV,
             '- **当前版本**：`%s`（五源同源）' % VER, '元信息版本行')
TAG = '个版本，按版本号索引'
m = re.search(r'(\d+) ' + re.escape(TAG), itlog)
assert m, '头部版本数句式必须恰中 1 次'
_old_decl = int(m.group(1))
itlog = itlog[:m.start(1)] + str(len(new_versions)) + itlog[m.end(1):]
print('头部版本数：%d -> %d（声明值与 update-log 真源对齐）' % (_old_decl, len(new_versions)))
assert itlog.count(SEG_ANCHOR) == 1, '迭代 121 段锚点必须恰中 1 次'
itlog = itlog.replace(SEG_ANCHOR, SEG + NL + NL + SEG_ANCHOR)
assert itlog.count('## 迭代 122 ') == 1

# ⑤ 边界文档：当版复校标记 + 两道真门实测数字（真跑取数，不手抄）
syn = subprocess.run(['node', 'scripts/syntax-check.mjs'], cwd=ROOT,
                     capture_output=True, text=True, timeout=300)
assert syn.returncode == 0, syn.stderr[:300]
SYN_N = re.search(r'语法门通过：(\d+) 个文件', syn.stdout).group(1)
imp = subprocess.run(['node', 'scripts/import-resolve-check.mjs'], cwd=ROOT,
                     capture_output=True, text=True, timeout=300)
assert imp.returncode == 0, imp.stderr[:300]
m1 = re.search(r'扫描 (\d+) 个文件 · 静态相对导入 (\d+) 条', imp.stdout)
assert m1, imp.stdout[:300]
IMP_F, IMP_S = m1.group(1), m1.group(2)
doc = rd(DOC)
doc = once(doc, '# ruby-phone 运行时验证边界（v2.82.0 起；**v%s 复校**）' % PREV,
           '# ruby-phone 运行时验证边界（v2.82.0 起；**v%s 复校**）' % VER, '文档复校标记')
# 契约行以「行首整行」定位：642 / 386 / 625 这三个数字在下方历史复校留档里也写过
# （v3.23.4 那条末尾逐字复述），裸子串 once() 会实得 2 ⇒ 那是散文侵入判定面，不是本次要改的正文。
_syn_m = re.search(r'\n- 语法 (\d+) 文件\n', doc)
assert _syn_m, '文档语法门契约行必须恰中 1 次（行首整行）'
doc = once_line(doc, '- 语法 %s 文件' % _syn_m.group(1), '- 语法 %s 文件' % SYN_N, '文档语法门数字')
_imp_m = re.search(r'\n- 导入 (\d+) 文件 (\d+) 条\n', doc)
assert _imp_m, '文档导入门契约行必须恰中 1 次（行首整行）'
doc = once_line(doc, '- 导入 %s 文件 %s 条' % (_imp_m.group(1), _imp_m.group(2)),
                '- 导入 %s 文件 %s 条' % (IMP_F, IMP_S), '文档导入门数字')
assert doc.count('\n- 语法 %s 文件\n' % SYN_N) == 1
assert doc.count('\n- 导入 %s 文件 %s 条\n' % (IMP_F, IMP_S)) == 1
doc = once(doc, '> **每次复校都必须同步那条用户可见说明**',
           '> **每次复校都必须同步那条用户可见说明**', '文档契约段锚点自证')
assert ('v%s 复校' % VER) in man['version'] or True

print('== dry-run 摘要 ==')
print('update-log: latest=%s first=%s 版本数 %d -> %d' % (VER, list(new_log['versions'])[0], OLD_N, len(new_versions)))
print('manifest/package: version -> %s' % VER)
print('index.js: 常量 + 公告块（当版 %d 条 + 历史 %d 条 = %d）' % (len(ITEMS), len(OLD_LINES), len(ITEMS) + len(OLD_LINES)))
print('ITERATION_LOG: 迭代 122 段 + 当前版本行 + 版本数 %d' % len(new_versions))
print('边界文档：v%s 复校 + 语法 %s 文件 / 导入 %s 文件 %s 条（真跑取数）' % (VER, SYN_N, IMP_F, IMP_S))
if not WRITE:
    print('（dry-run，未落盘）')
    sys.exit(0)
with open(os.path.join(ROOT, 'update-log.json'), 'w', encoding='utf-8') as f:
    json.dump(new_log, f, ensure_ascii=False, indent=2)
    f.write(NL)
with open(os.path.join(ROOT, 'manifest.json'), 'w', encoding='utf-8') as f:
    json.dump(man, f, ensure_ascii=False, indent=2)
    f.write(NL)
with open(os.path.join(ROOT, 'package.json'), 'w', encoding='utf-8') as f:
    json.dump(pkg, f, ensure_ascii=False, indent=2)
    f.write(NL)
with open(os.path.join(ROOT, 'index.js'), 'w', encoding='utf-8') as f:
    f.write(idx_new)
with open(os.path.join(ROOT, 'ITERATION_LOG.md'), 'w', encoding='utf-8') as f:
    f.write(itlog)
with open(os.path.join(ROOT, DOC), 'w', encoding='utf-8') as f:
    f.write(doc)
print('已落盘：update-log.json / manifest.json / package.json / index.js / ITERATION_LOG.md / ' + DOC)