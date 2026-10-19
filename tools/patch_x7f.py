#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_x7f.py — v4.29.0 收口补丁 F：修取数臂 flag() 的用法与实现不一致。

缺陷形态（本仓记过的那一类：看起来没坏但结果不对）：
  tools/refresh_doc_readings.py 的用法注释与历史抬版脚本注释都写 `--why "..."`
  （**空格形**），而实现 flag() 只认 `--why=<值>`（**等号形**）：
      for a in sys.argv:
          if a.startswith('--why='): ...
  后果：按注释敲 `--why "..." --write` 时 flag() 取不到值 ⇒ 来由段**静默不写**，
  且退出码仍是 0（数字确实一致、复校标记确实在场），没有任何东西会响。
  这正是本仓反复登记的第二类边界「没坏但显示不对」在工具自己身上的同形。

修法（两侧同时收）：
  ① 实现侧：flag() 同时接受 `--why=X` 与 `--why X` 两种形态（等号形优先，
     向后兼容；两个写法都不给时仍返回 default）。
  ② 用法侧：注释改为写等号形（与实现的主推形态一致），并写明空格形也吃。
锚点各恰中 1 次；改完由外层复跑工具自证（等号形与空格形各跑一次干跑，两种写法取到的值必须一致）。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REL = 'tools/refresh_doc_readings.py'
NL = chr(10)
WRITE = '--write' in sys.argv

OLD_FN = (
    'def flag(name, default=None):' + NL
    + '    pre = \'--\' + name + \'=\'' + NL
    + '    for a in sys.argv:' + NL
    + '        if a.startswith(pre):' + NL
    + '            return a[len(pre):]' + NL
    + '    return default' + NL
)

NEW_FN = (
    'def flag(name, default=None):' + NL
    + '    """取 `--name=值` 与 `--name 值` 两种写法（等号形优先）。' + NL
    + NL
    + '    为什么要吃两种：本文件的用法注释与历史抬版脚本注释都写的是空格形' + NL
    + '    `--why "..."`，而初版实现只认等号形 —— 按注释敲时来由段**静默不写**，' + NL
    + '    退出码还是 0（数字一致、复校标记在场），没有任何东西会响。' + NL
    + '    这是「看起来没坏但结果不对」在工具自己身上的同形，故两侧一起收：' + NL
    + '    实现吃两种写法，注释改写等号形（主推形态）。' + NL
    + '    """' + NL
    + '    pre = \'--\' + name + \'=\'' + NL
    + '    for i, a in enumerate(sys.argv):' + NL
    + '        if a.startswith(pre):' + NL
    + '            return a[len(pre):]' + NL
    + '    for i, a in enumerate(sys.argv):' + NL
    + '        if a == \'--\' + name and i + 1 < len(sys.argv):' + NL
    + '            nxt = sys.argv[i + 1]' + NL
    + '            if not nxt.startswith(\'--\'):' + NL
    + '                return nxt' + NL
    + '    return default' + NL
)

OLD_USAGE = '  python3 tools/refresh_doc_readings.py --why "..." --write' + NL
NEW_USAGE = (
    '  python3 tools/refresh_doc_readings.py --why="..." --write   # 等号形（主推）' + NL
    + '  python3 tools/refresh_doc_readings.py --why "..." --write    # 空格形也吃' + NL
)


def main():
    p = os.path.join(ROOT, REL)
    with io.open(p, encoding='utf-8') as f:
        src = f.read()
    n_fn = src.count(OLD_FN)
    n_use = src.count(OLD_USAGE)
    assert n_fn == 1, '[F] flag() anchor must hit exactly 1, got %d' % n_fn
    assert n_use == 1, '[F] usage anchor must hit exactly 1, got %d' % n_use
    new = src.replace(OLD_FN, NEW_FN, 1).replace(OLD_USAGE, NEW_USAGE, 1)
    # 结构自证：新 flag() 必须两种形态都在
    assert new.count("a.startswith(pre)") == 1, '[F] 等号形分支丢失'
    assert "a == '--' + name" in new, '[F] 空格形分支丢失'
    assert new.count('def flag(') == 1, '[F] flag 定义重复'
    if not WRITE:
        print('[F] dry run: flag() 收两种形态 + 用法注释改写等号形')
        print('[F] lines %d -> %d' % (src.count(NL), new.count(NL)))
        return 0
    with io.open(p, 'w', encoding='utf-8') as f:
        f.write(new)
    print('[F] written: %s' % REL)
    return 0


if __name__ == '__main__':
    sys.exit(main())
