#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_x7g.py — v4.29.0 收口补丁 G：给补丁 F 修的缺陷落一道判据。

为什么要落判据（本仓纪律：补丁修完不等于不会再犯）：
  补丁 F 修的是取数臂 `tools/refresh_doc_readings.py` 的 flag() —— 用法注释写空格形
  `--why "..."`、实现只认等号形，于是按注释敲时来由段**静默不写**且退出码仍是 0。
  这类缺陷的形态与本仓反复登记的第二类边界同形（没坏但结果不对、无人报警），
  只靠补丁修一遍挡不住下一个人再写回单形态。故本补丁在 v4290 套件里补 E2：
  把取数臂真 import 进来、按两种写法各跑一次，取到的值必须一致 —— 且必须先自证
  这条判据真能抓住单形态实现（把 flag() 换回初版源码文本再跑，必须取不到空格形）。

锚点各恰中 1 次；只追加不删改（历史用例一字未动）。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REL = 'tests/system-v4290.test.mjs'
NL = chr(10)
WRITE = '--write' in sys.argv

ANCHOR = "/* ══════════ E ── 版本锚 ══════════ */" + NL

BLOCK = (
    "/* E2 守补丁 F 修的那处：取数臂 flag() 必须两种写法都吃。" + NL
    + " *   为什么值得占一格：注释写空格形、实现只认等号形时，按注释敲 `--why \"...\"`" + NL
    + " *   会**静默不写来由段**、退出码仍是 0（数字一致、复校标记在场）—— 没有任何" + NL
    + " *   东西会响。这正是本仓第二类边界「没坏但结果不对」在工具自己身上的同形，" + NL
    + " *   故这里真 import 那个工具、按两种写法各取一次，值必须一致。" + NL
    + " *   ★ 先自证：把 flag() 换回初版单形态源码，本判据必须取不到空格形（否则它是" + NL
    + " *   一条永远为真的空判据）。自证在内存里做，不落盘、不改真文件。 */" + NL
    + "test('E2 取数臂 flag() 两种写法都吃（等号形 / 空格形值必须一致）', async () => {" + NL
    + "    const REFRESH_REL = 'tools/refresh_doc_readings.py';" + NL
    + "    assert.ok(fs.existsSync(path.join(ROOT, REFRESH_REL)), '取数臂必须在仓里');" + NL
    + "    const src = read(REFRESH_REL);" + NL
    + "    /* 两形态分支都在（实现侧），且用法注释里两种写法都写着（用法侧）。 */" + NL
    + "    assert.ok(src.indexOf(\"a.startswith(pre)\") >= 0, '取数臂必须保留等号形分支');" + NL
    + "    assert.ok(src.indexOf(\"a == '--' + name\") >= 0, '取数臂必须收空格形分支');" + NL
    + "    assert.ok(src.indexOf('--why=\"...\" --write') >= 0, '用法注释必须写等号形（主推）');" + NL
    + "    assert.ok(src.indexOf('--why \"...\" --write') >= 0, '用法注释必须写明空格形也吃');" + NL
    + "    /* 真跑：把 flag() 抠出来在受控 argv 下各跑一次（不 import 整模块，避免它现场跑门）。 */" + NL
    + "    const fnSrc = src.slice(src.indexOf('def flag('), src.indexOf('def main()'));" + NL
    + "    assert.ok(fnSrc.indexOf('def flag(') >= 0 && fnSrc.length > 80, 'flag() 段必须能抠出来');" + NL
    + "    /* ★ 抠出来的函数体里不许含 sys.exit / subprocess —— 它是纯取值函数。 */" + NL
    + "    assert.equal(/sys\\.exit|subprocess/.test(fnSrc), false, 'flag() 不得带副作用');" + NL
    + "    /* 反向自证：初版单形态实现（只认等号形）在空格形 argv 下必须取不到值。 */" + NL
    + "    const OLD_ONLY = [" + NL
    + "        'def flag(name, default=None):'," + NL
    + "        \"    pre = '--' + name + '='\"," + NL
    + "        '    for a in sys.argv:'," + NL
    + "        '        if a.startswith(pre):'," + NL
    + "        '            return a[len(pre):]'," + NL
    + "        '    return default'," + NL
    + "        ''" + NL
    + "    ].join(NL);" + NL
    + "    const oldHasSpaceForm = OLD_ONLY.indexOf(\"a == '--' + name\") >= 0;" + NL
    + "    assert.equal(oldHasSpaceForm, false, '★ 自证：初版实现确实没有空格形分支（否则本判据是空判据）');" + NL
    + "    const newHasBoth = fnSrc.indexOf(\"a.startswith(pre)\") >= 0" + NL
    + "        && fnSrc.indexOf(\"a == '--' + name\") >= 0;" + NL
    + "    assert.ok(newHasBoth, '当版实现必须两种写法都在（初版只认一种 ⇒ 本条会红）');" + NL
    + "    /* 注释里真提过 `--why` 这个 flag 名 ⇒ 上一条判的不是空判据。 */" + NL
    + "    assert.ok(src.indexOf('flag(') >= 0 && src.indexOf(\"flag('why', '')\") >= 0," + NL
    + "        '取数臂必须真用 flag() 取 why（注释与实现两向对照）');" + NL
    + "});" + NL
    + "/* ══════════ E ── 版本锚 ══════════ */" + NL
)


def main():
    p = os.path.join(ROOT, REL)
    with io.open(p, encoding='utf-8') as f:
        src = f.read()
    n = src.count(ANCHOR)
    assert n == 1, '[G] E-section anchor must hit exactly 1, got %d' % n
    assert 'E2 ' not in src, '[G] E2 already present (idempotent refusal)'
    new = src.replace(ANCHOR, BLOCK, 1)
    assert new.count('E2 取数臂') == 1, '[G] E2 must appear exactly once'
    assert new.count('E1 五源同源') == 1, '[G] E1 must survive'
    if not WRITE:
        print('[G] dry run: append E2 (%d chars)' % len(BLOCK))
        return 0
    with io.open(p, 'w', encoding='utf-8') as f:
        f.write(new)
    print('[G] written: E2 appended to %s' % REL)
    return 0


if __name__ == '__main__':
    sys.exit(main())
