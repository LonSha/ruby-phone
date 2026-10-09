# -*- coding: utf-8 -*-
"""patch_v3790_v3130_b2.py — 把 v3130 B2 的「距离窗」代理判据改判为「作用域窗」，并补 D5 负控制.

分工：
  · 三处片段（tools/_seg_b2.txt / _seg_helper.txt / _seg_d5.txt）是**正文**，本脚本只做锚点替换；
  · 每个锚点必须恰中 1 次，否则当场退出（防「以为改的是 A，实际改的是 B」）；
  · 改完打印字节数，供落盘完整性核对。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(ROOT, 'tests', 'system-v3130.test.mjs')
SEG = os.path.join(ROOT, 'tools')


def seg(name):
    with io.open(os.path.join(SEG, '_seg_' + name + '.txt'), encoding='utf-8') as f:
        return f.read()


def main():
    with io.open(P, encoding='utf-8') as f:
        src = f.read()
    before = len(src)

    #  ① B2：距离窗 → 作用域窗
    A = ("    assert.equal(/window\\.VirtualPhone\\s*=[\\s\\S]{0,400}?bootTiming: bootTiming/.test(src), true,\n"
         "        '\u2605 \u5fc5\u987b\u6302\u51fa window.VirtualPhone.bootTiming\uff08\u8bca\u65ad\u9875\u8bfb\u6570\u7684\u552f\u4e00\u51fa\u53e3\uff09');\n")
    n = src.count(A)
    if n != 1:
        raise SystemExit('[patch] 锚点 ① 命中 %d 次（须恰为 1）' % n)
    src = src.replace(A, seg('b2'))

    #  ② 判据函数之后追加作用域取文工具
    B = ("    if (typeof bt.snapshot === 'function') bad.push('\u8bfb\u51fa\u53e3\u4ecd\u53eb snapshot\uff08\u4f1a\u649e J2 \u5224\u636e\uff09');\n"
         "    return { ok: bad.length === 0, why: bad.join(' / ') };\n}\n")
    n = src.count(B)
    if n != 1:
        raise SystemExit('[patch] 锚点 ② 命中 %d 次（须恰为 1）' % n)
    src = src.replace(B, B + seg('helper'))

    #  ③ D5：搬格负控制，落在 E 段之前
    C = "/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 E \u2500\u2500 \u7248\u672c\u951a \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */"
    n = src.count(C)
    if n != 1:
        raise SystemExit('[patch] 锚点 ③ 命中 %d 次（须恰为 1）' % n)
    src = src.replace(C, seg('d5') + '\n' + C)

    with io.open(P, 'w', encoding='utf-8') as f:
        f.write(src)
    print('[patch] %s：%d → %d 字节' % (os.path.relpath(P, ROOT), before, len(src)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
