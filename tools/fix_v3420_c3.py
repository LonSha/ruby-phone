#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""fix_v3420_c3.py — [v3.43.0] 上一版判据面自身的错：C3 的段序断言写成绝对形。

动机（本仓判据纪律：「上一版的判据不许给下一版埋必红的坑」）：
  tests/system-v3420.test.mjs 的 C3 写了
      assert.ok(heads[0].indexOf('[v3.42.0]') > 0, '本版段必须排在最前');
  —— 这是**绝对形**：只要下一版在 phone.css 里插新段，它就必红，
  而它想守的其实是「本版段在**上一版**段之前」（仓内 v3390 / v3400 两版用的都是这个相对形）。
  本脚本把它改成相对形（只声明 v3.42.0 相对 v3.41.0 的顺序），
  并把「最新版在最前」这条**约定本身**留给各版自己的 C3（新版的 C3 用相对形对着上一版）。

纪律：锚点必须恰中 1 次；默认 dry-run，--write 才落盘。
"""
import sys

REL = 'tests/system-v3420.test.mjs'
OLD = """    /* 段序：最新版在最前。 */
    const heads = [];
    let i = phone.indexOf('/* ' + String.fromCharCode(9552) + String.fromCharCode(9552));
    while (i >= 0) {
        heads.push(phone.slice(i, i + 40));
        i = phone.indexOf('/* ' + String.fromCharCode(9552) + String.fromCharCode(9552), i + 1);
    }
    assert.ok(heads.length >= 2);
    assert.ok(heads[0].indexOf('[v3.42.0]') > 0, '本版段必须排在最前');
"""
NEW = """    /* 段序：本版段必须排在**上一版**段之前（最新版在最前）。
     * ★ 原写的是绝对形「heads[0] 必须是本版」—— 那等于给下一版埋一条必红的断言：
     *   下一版一插新段它就红，而它想守的其实只是「本版在上一版之前」。
     *   仓内 v3390 / v3400 两版用的都是这个相对形，这里统一过来。 */
    assert.ok(phone.indexOf(mark) < phone.indexOf('[v3.41.0]'),
        '本版段必须在 v3.41.0 段之前（最新版在最前）');
"""
BS = chr(92)
BT = chr(96)


def main(write):
    src = open(REL, encoding='utf-8').read()
    n = src.count(OLD)
    if n != 1:
        print('ABORT: 锚点必须恰中 1 次（实得 %d）' % n)
        return 1
    out = src.replace(OLD, NEW)
    print('%s  反斜杠 %d -> %d   反引号 %d -> %d   行 %d -> %d' % (
        REL, src.count(BS), out.count(BS), src.count(BT), out.count(BT),
        src.count(chr(10)) + 1, out.count(chr(10)) + 1))
    if write:
        open(REL, 'w', encoding='utf-8').write(out)
        print('WROTE')
    else:
        print('DRY-RUN OK（未落盘）')
    return 0


if __name__ == '__main__':
    sys.exit(main('--write' in sys.argv))