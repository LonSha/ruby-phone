import io
import os
ROOT = '/home/user/ruby-phone'
NL = chr(10)


def rd(rel):
    with io.open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def wr(rel, s):
    with io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(s)


MARK = '看起来没坏但显示不对'
seg = rd('tools/iter187_seg.md').rstrip(NL)
il = rd('ITERATION_LOG.md')
a = il.index('## 迭代 187 ')
b = il.index('## 迭代 186 ', a)
nil = il[:a] + seg + NL + NL + il[b:]
assert nil.count('## 迭代 187 ') == 1
sec = nil[a:nil.index('## 迭代 186 ', a)]
assert sec.count(MARK) == 1, 'the 187 section must carry the marker exactly once, got %d' % sec.count(MARK)
wr('ITERATION_LOG.md', nil)
print('OK 187-section marker=1 total=%d' % nil.count(MARK))