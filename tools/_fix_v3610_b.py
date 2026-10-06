#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ruby-phone v3.61.0 收口 · 批次 B1（三处真缺陷修复，与 O6 扫描面簇无关）。

为什么这三处是真缺陷而不是判据毛病（逐条取证）：
  ① update-log.json 的 3.61.0 条目**缺 `version` 字段** —— 全 212 个版本条目里，
     除 3.61.0 外**每一个都带 `version`**（实测 3.60.0 keys = ['version','date','items']，
     3.61.0 keys = ['date','items']）。v259 G1 / v298 E1 判的正是「版本节内 version
     须与 latest 同源」，报的是 `undefined !== '3.61.0'`。抬版时漏了字段，不是判据错。
  ② ITERATION_LOG.md 第 5341 行**元信息「当前版本」仍写 3.60.0**（manifest 已 3.61.0）。
     v280-2 / v300-D3 / v301-D3 / v302-E2 / v303-D2 五套件判它与 manifest 同源。
     本仓纪律「文档面不说谎」，这条是文档没跟上抬版。
  ③ config/app-lazy-routes.js 的 67 行 **errTitle 全部带「加载失败」后缀**，而
     index.js 装配器又拼一次：
         console.error('❌ 加载' + errTitle + '失败:', err)
         showNotification('错误', errTitle + '加载失败', '❌')
     ⇒ 实际产出「❌ 加载通知中心加载失败失败」与「通知中心加载失败加载失败」，
     67 个 App 的加载失败提示**全部是重复后缀的病句**（重构前是
     `'❌ 加载通知中心App失败:'` + `'通知中心加载失败'`）。
     这是 O6 表驱动改造里**字段语义定错**的直接产物，属真产品缺陷。
     修法：字段改存**标题基名**（不含「加载失败」后缀），装配器拼接保持不动 ——
     改完 console 文案逐字回归重构前形态，notify 文案与原 errTitle 逐字相等。

口径：三处**定点替换**，每处锚点必须恰中预期次数，失配即退出且不写盘。
先过 ast.parse 自证，再执行；执行前备份。
"""
import ast
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path('/home/user/ruby-phone')
BACKUP = Path('/tmp/rp_v3610b_backup')
BACKUP.mkdir(parents=True, exist_ok=True)

F_TABLE = ROOT / 'config/app-lazy-routes.js'
F_LOG = ROOT / 'update-log.json'
F_ITER = ROOT / 'ITERATION_LOG.md'

# ── 先 ast 自证本脚本 ────────────────────────────────────────────────
ast.parse(Path(__file__).read_text(encoding='utf-8'))
print('[b1] ast 自证通过')

changed = []

# ── ① 表 errTitle 去「加载失败」后缀（67 行）────────────────────────
src = F_TABLE.read_text(encoding='utf-8')
pat = re.compile(r'errTitle: "([^"]*?)加载失败"')
hits = pat.findall(src)
if len(hits) < 60:
    sys.exit('[b1] ① 锚点失配：errTitle 带「加载失败」后缀的行只有 %d 行（期望 >= 60）' % len(hits))
new_src = pat.sub(lambda m: 'errTitle: "%s"' % m.group(1), src)
assert new_src != src, '[b1] ① 替换未发生'
n_left = len(re.findall(r'errTitle: "[^"]*?加载失败"', new_src))
if n_left != 0:
    sys.exit('[b1] ① 替换后仍有 %d 行带后缀' % n_left)
shutil.copy2(F_TABLE, BACKUP / 'app-lazy-routes.js')
F_TABLE.write_text(new_src, encoding='utf-8')
print('[b1] ① 表 errTitle 去后缀：%d 行' % len(hits))

# ── ② update-log.json 的 3.61.0 条目补 version 字段 ────────────────
log = json.loads(F_LOG.read_text(encoding='utf-8'))
cur = log['latest']
if 'version' in log['versions'][cur]:
    print('[b1] ② 当版 %s 已有 version 字段，跳过' % cur)
else:
    raw = F_LOG.read_text(encoding='utf-8')
    # 只在当版条目块的首行 date 之前插入 version：定位 "3.61.0": {\n<indent>"date"
    anchor = '"%s": {\n' % cur
    i = raw.find(anchor)
    if i < 0:
        sys.exit('[b1] ② 找不到当版条目块锚点 %r' % anchor)
    j = i + len(anchor)
    k = raw.find('"date"', j)
    if k < 0:
        sys.exit('[b1] ② 找不到当版 date 字段')
    line_start = raw.rfind('\n', 0, k) + 1
    indent = raw[line_start:k]
    if indent.strip():
        sys.exit('[b1] ② date 行缩进异常：%r' % indent)
    ins = '%s"version": "%s",\n' % (indent, cur)
    new_raw = raw[:line_start] + ins + raw[line_start:]
    shutil.copy2(F_LOG, BACKUP / 'update-log.json')
    F_LOG.write_text(new_raw, encoding='utf-8')
    chk = json.loads(F_LOG.read_text(encoding='utf-8'))
    assert chk['versions'][cur]['version'] == cur, '[b1] ② version 字段写入后不自洽'
    assert chk['versions'][cur]['items'] == log['versions'][cur]['items'], '[b1] ② items 被改动'
    print('[b1] ② update-log %s 补 version 字段' % cur)

# ── ③ ITERATION_LOG 元信息「当前版本」抬到 3.61.0 ─────────────────
man = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
ver = str(man['version'])
iter_src = F_ITER.read_text(encoding='utf-8')
m = re.search(r'^- \*\*当前版本\*\*：`([0-9.]+)`', iter_src, re.M)
if not m:
    sys.exit('[b1] ③ 找不到元信息「当前版本」行')
if m.group(1) == ver:
    print('[b1] ③ 元信息已是 %s，跳过' % ver)
else:
    old_line = m.group(0)
    new_line = '- **当前版本**：`%s`' % ver
    n_hits = iter_src.count(old_line)
    if n_hits != 1:
        sys.exit('[b1] ③ 锚点须恰中 1 次，实测 %d' % n_hits)
    shutil.copy2(F_ITER, BACKUP / 'ITERATION_LOG.md')
    F_ITER.write_text(iter_src.replace(old_line, new_line), encoding='utf-8')
    chk = re.search(r'^- \*\*当前版本\*\*：`([0-9.]+)`', F_ITER.read_text(encoding='utf-8'), re.M)
    assert chk and chk.group(1) == ver, '[b1] ③ 写入后元信息仍不一致'
    print('[b1] ③ 元信息 %s → %s' % (m.group(1), ver))

print('[b1] 完成 · 备份于 %s' % BACKUP)
