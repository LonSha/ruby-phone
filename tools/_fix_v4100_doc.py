# -*- coding: utf-8 -*-
"""_fix_v4100_doc.py — v4.10.0 收口:边界文档实测数字按现场真跑刷新。

【为什么必须做(判据原文 tests/system-v328.test.mjs C1)】
  文档里写的是「实测」;不跑真门禁就无从区别「实测」与「抄的旧数」。
  本版新增 1 个测试文件(tests/system-v4100.test.mjs)⇒ 语法门 794 → 795。

【数字来源(现场真跑,不手抄)】
  node scripts/syntax-check.mjs         ⇒ 语法门通过:795 个文件
  node scripts/import-resolve-check.mjs ⇒ 扫描 452 个文件 · 静态相对导入 790 条(未变)

【注:同源标志语不在本脚本】
  当版条目的「运行时验证边界」那条(含标志语「看起来没坏但显示不对」)写在
  tools/iter169_seg.md 里,由 tools/bump_v4100.py 同步进 update-log.json 与 index.js ——
  这样两侧同源是**结构成立**的,不靠本脚本再改一遍(改两处必然漂移)。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
NL = chr(10)
DOC = 'docs/runtime-verification-boundary.md'


def rd(rel):
    with io.open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def wr(rel, s):
    with io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(s)


def main():
    lines = rd(DOC).split(NL)
    idxs = [i for i, l in enumerate(lines) if l.strip().startswith('- 语法 794 文件')]
    assert len(idxs) == 1, '[doc syntax] locate exactly 1, got %d' % len(idxs)
    i = idxs[0]
    lines[i] = lines[i].replace('794', '795', 1)
    assert '795' in lines[i]
    print('ok  doc syntax 794 -> 795  (line %d)' % (i + 1))
    if not WRITE:
        print('--- DRY RUN (pass --write to apply) ---')
        return 0
    wr(DOC, NL.join(lines))
    print('written  ' + DOC)
    return 0


if __name__ == '__main__':
    sys.exit(main())