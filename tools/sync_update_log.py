"""把 index.js 当版公告块同步进 update-log.json（五源同源的第五源），
并顺手维护一类**会腐坏的派生文本**：条目里自述的「本套件 N 条判据」。

★ 三条踩过的坑（实测到，勿回退）：
  ① 用「行内正则 `"(.*)",`」取条目会**漏掉最后一条**（数组末项没有逗号）——
     真源里条目是 JS 字符串字面量，正确做法是**逐行 JSON 解析**（与 tests/system-v253.test.mjs
     的 D4 同一口径：那条判据早就用 JSON.parse 逐行取值，正是为了绕开同一个坑）。
  ② 正则取出的原文**未做反转义**，条目里写 `\\n` 时两份会差一个反斜杠 ⇒ 逐字同源判据假红。
     JSON 解析顺手解决这一点。
  ③ 条目里「本套件 N 条判据」是**手抄的派生文本**，而判据文件会涨 —— v3.20.4 实测：
     v3.20.3 条目里那两处仍写 32，真读数已是 38；同一件事在套件侧以「当版条目自述条数取不到」
     的形式炸出来（v3203 F1 / v3204 E1 报 `mine === undefined`）。人抄的派生数必须由**机器回写**：
     本脚本对每个版本，按「条目里出现的 `tests/system-v<该版数字>.test.mjs`（N 条」与真读数比对，
     不一致就把两份（index.js 与 update-log.json）一起改到真读数 —— 单向（以文件真读数为准）。
  ④ 回写**必须由捕获组 span 定位**，不许「老片段→新片段」整串替换：老片段里同时含版本号数字与
     条数数字，`32` 会先命中 `v3203` 的 `32`，把别的套件名改成 `v3803`（实测污染过两份文件，
     已回改并留档）。「字符串替换当结构化改写」是本仓反复付代价的那一族。

用法：python3 tools/sync_update_log.py
"""
import json
import os
import re
import sys

ROOT = '/home/user/ruby-phone'
IDX_REL = 'index.js'
LOG_REL = 'update-log.json'

src = open(os.path.join(ROOT, IDX_REL), encoding='utf-8').read()

idx = re.search(r"const ST_PHONE_VERSION = '([0-9.]+)'", src).group(1)
block = re.search(r'const ST_PHONE_CURRENT_UPDATE = \{([\s\S]*?)\n\};', src).group(1)
date = re.search(r'date:\s*"([^"]+)"', block).group(1)

items = []
for line in block.split('\n'):
    s = line.strip()
    if not s.startswith('"'):
        continue
    items.append(json.loads(s.rstrip().rstrip(',')))
assert items, '公告块里一条条目都没解析出来（形态变了，脚本须同步）'
print('版本', idx, '· 日期', date, '· 条目', len(items))

log = json.load(open(os.path.join(ROOT, LOG_REL), encoding='utf-8'))
versions = {idx: {'version': idx, 'date': date, 'items': items}}
for k, v in log['versions'].items():
    if k != idx:
        versions[k] = v

# ── ③ 自述条数的单向维护：凡条目自述**任一在役套件**的条数，必须等于真读数 ──
# ★ 覆盖范围必须与判据同宽（v3.20.4 的旧口径按「版本号 → 套件名」一一匹配，
#   于是「别的版本条目里自述本套件条数」的位置全落在盲区：抬版 v3.23.4 后 v3203 涨到 49，
#   而 3.20.5 条目那处 `tests/system-v3203.test.mjs（38 条` 未被回写 ⇒ 由 v3203 F1 报红）。
#   派生数的**回写范围本身也会漏** —— 判据问的是「历史条目里自述本套件条数 == 真读数」，
#   那就不该限定那份自述落在哪一版条目里。
suite_names = set()
for entry in versions.values():
    for it in entry.get('items') or []:
        suite_names.update(re.findall(r'tests/system-v[0-9]+\.test\.mjs', str(it)))
suite_names.add('tests/system-v%s.test.mjs' % idx.replace('.', ''))

changed_idx = 0
changed_log_only = 0
log_hits = {}
for suite_rel in sorted(suite_names):
    suite_abs = os.path.join(ROOT, suite_rel)
    if not os.path.exists(suite_abs):
        continue
    real = len(re.findall(r'^test\(', open(suite_abs, encoding='utf-8').read(), re.M))
    # 形态：<path>（N 条 —— 路径与左括号之间只允许一个反引号与空白（跟人的合法书写，不是宽松匹配）
    pat = re.compile(re.escape(suite_rel) + r'`?\s*（(\d+) 条')

    # ★ 两个替换**都必须锚定捕获组的 span**：早先写成 `s.replace(old_all, new_all)`（老片段→新片段
    #   整串替），而老片段里同时含**版本号数字**与**条数数字** —— 「32」先命中了 `v3203` 的
    #   `32`，于是把条目里另一个套件的名字改成了 `v3803`（污染两份文件）。这正是本仓记过的
    #   「字符串替换当结构化改写」同族缺陷：**要改的是哪一段，必须由捕获组坐标说了算**。
    def swap(s, m):
        a, b = m.span(1)
        return s[:a] + str(real) + s[b:]

    # ① update-log.json 侧：**所有版本**的所有条目（不限当版、不限同名套件）
    for ver_key, entry in versions.items():
        for i, it in enumerate(entry.get('items') or []):
            m = pat.search(str(it))
            if not m:
                continue
            log_hits[suite_rel] = log_hits.get(suite_rel, 0) + 1
            if int(m.group(1)) == real:
                continue
            entry['items'][i] = swap(str(it), m)
            if ver_key != idx:
                changed_log_only += 1
            print('  自述条数回写 %s[%d] %s：%s → %s' % (ver_key, i, suite_rel, m.group(1), real))

    # ② index.js 侧：全文扫（index.js 只带**当版**公告块 ⇒ 非当版套件 0 命中不是错，
    #    历史条目只存在于 update-log.json，这不是「半套改写」而是两份事实的载体本就不同）。
    hits = list(pat.finditer(src))
    if log_hits.get(suite_rel) and not hits and suite_rel.endswith('v%s.test.mjs' % idx.replace('.', '')):
        print('  !! 当版条目自述了 %s 的条数，但 index.js 里该形态一处都找不到' % suite_rel)
        sys.exit(2)
    for m in reversed(hits):   # 逆序替，前面的 span 才不会被后面的长度变化扰动
        if int(m.group(1)) == real:
            continue
        src = swap(src, m)
        changed_idx += 1
        print('  自述条数回写（index.js）%s：%s → %s' % (suite_rel, m.group(1), real))


log['latest'] = idx
log['versions'] = versions
log['head'] = idx
with open(os.path.join(ROOT, LOG_REL), 'w', encoding='utf-8') as f:
    json.dump(log, f, ensure_ascii=False, indent=2)
    f.write('\n')
if changed_idx:
    with open(os.path.join(ROOT, IDX_REL), 'w', encoding='utf-8') as f:
        f.write(src)
    print('index.js 同步回写 %d 处自述条数（另有 %d 处只在 update-log.json 里）' % (changed_idx, changed_log_only))
else:
    print('自述条数无需回写（当版 0 处 / 历史 %d 处）' % changed_log_only)
print('写入完成：latest =', log['latest'], '· 首位 =', list(log['versions'].keys())[0])