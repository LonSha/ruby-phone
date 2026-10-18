import io
import json
import os
ROOT = '/home/user/ruby-phone'
NL = chr(10)
DQ = chr(34)


def rd(rel):
    with io.open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def wr(rel, s):
    with io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(s)


seg = rd('tools/iter187_seg.md')
lines = seg.split(NL)
hit = [i for i, l in enumerate(lines) if l.startswith('- ' + chr(0x3010) + '运行时验证边界')]
assert len(hit) == 1, 'runtime-boundary item must hit exactly 1, got %d' % len(hit)
NEW = ('- ' + chr(0x3010) + '运行时验证边界：本版留下的边界形态仍是本仓反复遇到的那一类：'
       '看起来没坏但显示不对 —— 派发出去的凭据在真宿主里落到哪里、有没有人接住，一个字符都不报错；'
       '本版接线为真跑（真契约件 + 真接线件 + 真 App + 假宿主容器走完整旅程，含点击绑定与事件派发），'
       '但真实 SillyTavern 宿主里确认事件 phone:canonAdopt 的**最终落点未跑** —— '
       '落卷与撤回归上游 owner，本卡只派发凭据、不代写；'
       '本版**不能保证**其在真实宿主上的最终效果，待实机复核；'
       '登记入 docs/runtime-verification-boundary.md' + chr(0x3011))
lines[hit[0]] = NEW
seg = NL.join(lines)
assert '\\' not in seg and '[' not in seg and ']' not in seg
wr('tools/iter187_seg.md', seg)
seg = seg.rstrip(NL)

items = []
for line in seg.split(NL):
    line = line.strip()
    if not line.startswith('- '):
        continue
    it = line[2:].strip()
    if it.startswith('**'):
        it = it[2:]
    if it.endswith('**'):
        it = it[:-2]
    items.append(it.strip())
assert len(items) >= 8, len(items)
assert any(it.startswith(chr(0x3010) + '版本升至') for it in items)
MARK = '看起来没坏但显示不对'
assert sum(1 for it in items if MARK in it) == 1, 'exactly one item must carry the marker'
assert any('运行时验证边界' in it and MARK in it for it in items)

ul = json.loads(rd('update-log.json'))
assert ul['latest'] == '4.28.0' and list(ul['versions'])[0] == '4.28.0'
ul['versions']['4.28.0']['items'] = items
wr('update-log.json', json.dumps(ul, ensure_ascii=False, indent=2) + NL)

ij = rd('index.js')
START = 'const ST_PHONE_CURRENT_UPDATE = {'
bi = ij.index(START)
bj = ij.index(NL + '};', bi)
old = ij[bi:bj]
assert len(old) > 0
head = (START + NL + '    version: ST_PHONE_VERSION,' + NL
        + '    date: ' + DQ + '2026-11-13' + DQ + ',' + NL + '    items: [')
out = [head]
for i, it in enumerate(items):
    out.append('        ' + json.dumps(it, ensure_ascii=False) + (',' if i < len(items) - 1 else ''))
out.append('    ]')
ij = ij[:bi] + NL.join(out) + ij[bj:]
assert ij.count(MARK) == 1
wr('index.js', ij)

il = rd('ITERATION_LOG.md')
a = il.index('## 迭代 187 ')
b = il.index('## 迭代 186 ', a)
nil = il[:a] + seg + NL + NL + il[b:]
assert nil.count('## 迭代 187 ') == 1
assert nil.count(MARK) == 1
wr('ITERATION_LOG.md', nil)
print('OK items=%d marker=1' % len(items))
