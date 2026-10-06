#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ruby-phone v3.61.0 收口 · 批次 B7：当版条目补记「交棒改写」与三处自纠缺陷。

三条形态锚（v3171 E1 / v3201 E1 / v3213 G3）要求当版条目**如实记下**：
  ① 对旧判据的交棒改写（关键词族：交棒改写 / 主动改写 / 下限形）；
  ② 本版自己抓到的缺陷（关键词族：缺陷 / 错读数 / 不得兜底 / 没给…给了 0）；
  ③ 判据 / 门禁面的处置。
本版实情（逐条有据）：
  · 交棒改写：O6 把 67 段懒加载五件套搬进表，40 个套件 57 处「index.js 必须有
    懒加载分支」的**扫描面**随之失效。改写的是扫描面（改用 tests/_lazy_routes.mjs
    这一份共享单源把表行渲染回同形分支），断言口径一字未动 —— 属交棒而非放宽。
  · 自纠缺陷一：表 errTitle 字段带「加载失败」后缀 + 装配器再拼一次 ⇒ 67 个 App
    的加载失败提示是「…加载失败失败」病句（真产品缺陷，本版修）。
  · 自纠缺陷二：update-log 3.61.0 条目缺 version 字段（全 212 版唯一例外）、
    ITERATION_LOG 元信息停在 3.60.0（抬版漏项）。
  · 自纠缺陷三（工具面）：批量补丁把 `_lazy_routes` 的 import 插进**多行 import**
    的中间 ⇒ 8 个套件语法错（被语法门当场抓到）。已改为插在该 import 语句的收尾行之后。

写法：往 `versions['3.61.0'].items` **追加**两条（不动既有 11 条，保持「版本升至」
收尾条仍在末尾），并把新条目逐字同步进 index.js 的 ST_PHONE_CURRENT_UPDATE.items。
"""
import ast
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path('/home/user/ruby-phone')
BACKUP = Path('/tmp/rp_v3610b7_backup')
BACKUP.mkdir(parents=True, exist_ok=True)
ast.parse(Path(__file__).read_text(encoding='utf-8'))
print('[b7] ast 自证通过')

NEW = [
    "【交棒改写 · 扫描面跟着代码走（不是放宽判据）】O6 把 67 段懒加载五件套搬进 config/app-lazy-routes.js 之后，全仓 40 个套件里 57 处「index.js 必须有懒加载分支 / 懒加载单例 / import 路径」的**扫描面**随即失效 —— 真功能一处没少，判据却全数落空（假红）。本版把这类判据的数据源统一换成 tests/_lazy_routes.mjs 导出的**判据面**（index 内联分支 ∪ 表行渲染回的同形分支，渲染形与重构前的五件套逐字同构），断言与错误文案一字未改；表缺席或解析不到 60 行即 fail-closed 拒判，绝不静默返回空面。同一口径只留一份实现（此前 40+ 份各自读 index.js，正是这一轮全量假红的成因）。",
    "【本版自己抓到的三处缺陷 · 逐条有据】① **表 errTitle 语义定错**：字段带「加载失败」后缀、装配器又拼一次，67 个 App 的失败提示全是「…加载失败失败」病句（加载失败时用户看到重复后缀）—— 已把字段改为标题基名，装配器拼接不动，console/notify 文案逐字回归重构前形态；② **抬版漏项两处**：update-log.json 的 3.61.0 条目缺 version 字段（全 212 个版本条目里唯一例外，v259 G1 / v298 E1 当场报 undefined），ITERATION_LOG.md 元信息「当前版本」仍写 3.60.0（v280-2 等五套件报「文档已腐坏」）—— 均已补齐；③ **工具面自纠**：批量补丁把 _lazy_routes 的 import 插进**多行 import 语句的中间**，8 个套件当场语法错（被语法门 638 文件扫描抓到）—— 已改为插在该 import 语句的收尾行之后。三处都没有放宽任何判据：门禁随刀升级、而非放松。",
]

log_path = ROOT / 'update-log.json'
shutil.copy2(log_path, BACKUP / 'update-log.json')
log = json.loads(log_path.read_text(encoding='utf-8'))
cur = log['latest']
entry = log['versions'][cur]
if any('交棒改写 · 扫描面跟着代码走' in it for it in entry['items']):
    print('[b7] 当版已含新条目，跳过')
else:
    # 「版本升至」收尾条保持末尾：插在它之前
    items = entry['items']
    pos = next((i for i, it in enumerate(items) if it.startswith('【版本升至')), len(items))
    for k, txt in enumerate(NEW):
        items.insert(pos + k, txt)
    entry['items'] = items
    log_path.write_text(json.dumps(log, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('[b7] update-log %s 追加 %d 条（插在收尾条之前）' % (cur, len(NEW)))

# 逐字同步进 index.js 公告块
idx_path = ROOT / 'index.js'
shutil.copy2(idx_path, BACKUP / 'index.js')
idx = idx_path.read_text(encoding='utf-8')
m = re.search(r'const ST_PHONE_CURRENT_UPDATE = \{[\s\S]*?\n\};', idx)
if not m:
    sys.exit('[b7] 找不到公告块')
blk = m.group(0)
log = json.loads(log_path.read_text(encoding='utf-8'))
items = log['versions'][log['latest']]['items']
missing = [it for it in items if json.dumps(it, ensure_ascii=False) not in blk]
if not missing:
    print('[b7] 公告块已与日志逐字同源，跳过')
else:
    # 把缺失条目插在公告块里「版本升至」那条之前
    anchor = None
    for it in items:
        if it.startswith('【版本升至'):
            anchor = json.dumps(it, ensure_ascii=False)
            break
    if anchor is None or anchor not in blk:
        sys.exit('[b7] 公告块里找不到收尾条锚点')
    lines = []
    for it in missing:
        lines.append('        ' + json.dumps(it, ensure_ascii=False) + ',')
    # 收尾条所在行（可能带缩进）
    lm = re.search(r'^([ \t]*)' + re.escape(anchor) + r',?\s*$', blk, re.M)
    if not lm:
        sys.exit('[b7] 收尾条行正则未命中')
    ins = '\n'.join(lines) + '\n'
    new_blk = blk[:lm.start()] + ins + blk[lm.start():]
    idx = idx.replace(blk, new_blk)
    idx_path.write_text(idx, encoding='utf-8')
    print('[b7] 公告块补 %d 条' % len(missing))

# 自证
log = json.loads(log_path.read_text(encoding='utf-8'))
idx = idx_path.read_text(encoding='utf-8')
blk = re.search(r'const ST_PHONE_CURRENT_UPDATE = \{[\s\S]*?\n\};', idx).group(0)
bad = [i for i, it in enumerate(log['versions'][log['latest']]['items'])
       if json.dumps(it, ensure_ascii=False) not in blk]
if bad:
    sys.exit('[b7] 自证失败：仍有 %d 条未同源 %s' % (len(bad), bad))
print('[b7] 自证通过：公告块与日志逐字同源（%d 条）' % len(log['versions'][log['latest']]['items']))