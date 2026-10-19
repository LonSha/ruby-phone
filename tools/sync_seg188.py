import io
import json
import os
ROOT = '/home/user/ruby-phone'
NL = chr(10)
DQ = chr(34)
BS = chr(92)
LQ = chr(0x3010)
RQ = chr(0x3011)
def rd(rel):
    with io.open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()
def wr(rel, s):
    with io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(s)
NEW_A = (LQ + '本版自己抓到的缺陷形态：取数臂 tools/refresh_doc_readings.py 的 flag() '
         '**注释与实现不一致** —— 用法注释与历史抬版脚本注释都写的是空格形（--why 加值），'
         '而初版实现只认等号形（--why=值）；按注释敲时来由段**静默不写**、'
         '退出码仍是 0（数字确实一致、复校标记确实在场），没有任何东西会响。'
         '这正是本仓反复登记的第二类边界「没坏但结果不对」在工具自己身上的同形。'
         '修法两侧同时收：实现吃两种写法（等号形优先）、注释改写等号形（主推）；'
         '并在本版判据里补 E2 真跑（把取数臂复制到临时目录、子进程按三种 argv '
         '各加载一次副本真调 flag()，取回值逐项比对，再拿初版单形态实现做反向自证）' + RQ)
NEW_B = (LQ + '本版自己抓到的缺陷形态：E2 的第一版是**空判据** —— 注释里写着「真 import '
         '那个工具、按两种写法各取一次、值必须一致」，实现却只对源码文本做 indexOf，'
         '没真取过值；它偏偏是为守「注释与实现不符」而写的，自相矛盾。'
         '同批还发现插入块自带一个 E 段标记，插入后与原标记相邻 ⇒ 全文件两个，'
         '后果不是报错而是「段标记不再唯一」，后来者按它定位会切错段。'
         '修法：E2 改成真跑（临时目录复制取数臂 + 子进程三形态取值比对 + 初版反向自证），'
         '段标记去重收成一个' + RQ)
seg = rd('tools/iter188_seg.md').rstrip(NL)
lines = seg.split(NL)
hit = [i for i, l in enumerate(lines) if l.startswith('- ' + LQ + '本版新增判据')]
assert len(hit) == 1, 'insert anchor must hit exactly 1, got %d' % len(hit)
lines[hit[0]:hit[0]] = ['- ' + NEW_A, '- ' + NEW_B]
seg = NL.join(lines)
assert BS not in seg and '[' not in seg and ']' not in seg and DQ not in seg
wr('tools/iter188_seg.md', seg + NL)
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
assert any(it.startswith(LQ + '版本升至') for it in items)
MARK = '\u770b\u8d77\u6765\u6ca1\u574f\u4f46\u663e\u793a\u4e0d\u5bf9'
assert sum(1 for it in items if MARK in it) == 1, 'exactly one item must carry the marker'
ul = json.loads(rd('update-log.json'))
assert ul['latest'] == '4.29.0' and list(ul['versions'])[0] == '4.29.0'
ul['versions']['4.29.0']['items'] = items
wr('update-log.json', json.dumps(ul, ensure_ascii=False, indent=2) + NL)
ij = rd('index.js')
START = 'const ST_PHONE_CURRENT_UPDATE = {'
bi = ij.index(START)
bj = ij.index(NL + '};', bi)
assert bj > bi
head = (START + NL + '    version: ST_PHONE_VERSION,' + NL
        + '    date: ' + DQ + '2026-11-14' + DQ + ',' + NL + '    items: [')
out = [head]
for i, it in enumerate(items):
    out.append('        ' + json.dumps(it, ensure_ascii=False) + (',' if i < len(items) - 1 else ''))
out.append('    ]')
ij = ij[:bi] + NL.join(out) + ij[bj:]
assert ij.count('R4-X7') >= 1
for it in items:
    assert json.dumps(it, ensure_ascii=False) in ij, 'index.js missing item: ' + it[:30]
wr('index.js', ij)
il = rd('ITERATION_LOG.md')
a = il.index('## 迭代 188 ')
b = il.index('## 迭代 187 ', a)
nil = il[:a] + seg + NL + NL + il[b:]
assert nil.count('## 迭代 188 ') == 1
sec = nil[a:nil.index('## 迭代 187 ', a)]
assert sec.count(MARK) == 1, sec.count(MARK)
wr('ITERATION_LOG.md', nil)
print('OK items=%d marker=1' % len(items))
