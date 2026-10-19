#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_x7h.py — v4.29.0 收口补丁 H：把 E2 改成真跑，并修掉补丁 G 写重的段标记。

自查发现两处（同族：说了没做 / 做重了）：
  ① 补丁 G 写下的 E2，注释写着「真 import 那个工具、按两种写法各取一次，值必须一致」，
     实现却只对源码文本做 indexOf —— 没真取过值。这是「看起来有判据但没真判」的空判据
     形态，而它偏偏是为守「注释与实现不符」而写的，自相矛盾。
  ② 补丁 G 的 BLOCK 自带一个 `E ── 版本锚` 段标记，插入后与原标记相邻 ⇒ 全文件两个。
     后果不是报错，是「段标记不再唯一」—— 后来者按它定位会切错段。

修法：把 E2 整段换成真跑版（复制取数臂到临时目录，子进程按三种 argv 各加载一次副本
并真调 flag()，取回值逐项比对；再拿初版单形态实现做反向自证），同时把重复的段标记收成一个。
★ 只动 E2 段与那处重复标记；E1 / 其余各组一字未动。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REL = 'tests/system-v4290.test.mjs'
NL = chr(10)
WRITE = '--write' in sys.argv

IMP_OLD = "import { copyTreeSafe } from './_mirror_tree.mjs';" + NL
IMP_NEW = IMP_OLD + "import { execFileSync } from 'node:child_process';" + NL

START = "test('E2 取数臂 flag() 两种写法都吃"
END = "/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 E \u2500\u2500 \u7248\u672c\u951a \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */" + NL

NEW_E2 = (
    "test('E2 取数臂 flag() 两种写法都吃（等号形 / 空格形真跑取值必须一致）', () => {" + NL
    + "    const REFRESH_REL = 'tools/refresh_doc_readings.py';" + NL
    + "    assert.ok(fs.existsSync(path.join(ROOT, REFRESH_REL)), '取数臂必须在仓里');" + NL
    + "    const src = read(REFRESH_REL);" + NL
    + "    /* 用法侧：注释里两种写法都写着（等号形主推 + 空格形也吃）。 */" + NL
    + "    assert.ok(src.indexOf('--why=\"...\" --write') >= 0, '用法注释必须写等号形（主推）');" + NL
    + "    assert.ok(src.indexOf('--why \"...\" --write') >= 0, '用法注释必须写明空格形也吃');" + NL
    + "    /* ★ 真跑：把取数臂复制到临时目录，用子进程按三种 argv 各加载一次副本、" + NL
    + "     *   真调 flag()，取回值逐项比对 —— 不 import 原模块（避免它现场跑两道门）。 */" + NL
    + "    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v4290_flag_'));" + NL
    + "    temps.push(dir);" + NL
    + "    const toolCopy = path.join(dir, 'refresh_doc_readings.py');" + NL
    + "    fs.copyFileSync(path.join(ROOT, REFRESH_REL), toolCopy);" + NL
    + "    const drive = path.join(dir, 'drive.py');" + NL
    + "    fs.writeFileSync(drive, [" + NL
    + "        'import importlib.util, json, sys'," + NL
    + "        'p = sys.argv[1]'," + NL
    + "        'cases = [[\"x\", \"--why=AAA\", \"--write\"], [\"x\", \"--why\", \"AAA\", \"--write\"], [\"x\", \"--write\"]]'," + NL
    + "        'out = []'," + NL
    + "        'for i, argv in enumerate(cases):'," + NL
    + "        '    sys.argv = argv'," + NL
    + "        '    spec = importlib.util.spec_from_file_location(\"rdr_\" + str(i), p)'," + NL
    + "        '    m = importlib.util.module_from_spec(spec)'," + NL
    + "        '    spec.loader.exec_module(m)'," + NL
    + "        '    out.append(m.flag(\"why\", \"\"))'," + NL
    + "        'print(json.dumps(out))'," + NL
    + "        ''" + NL
    + "    ].join(NL), 'utf8');" + NL
    + "    const raw = execFileSync('python3', [drive, toolCopy], { encoding: 'utf8' });" + NL
    + "    const got = JSON.parse(raw.trim());" + NL
    + "    assert.equal(got[0], 'AAA', '等号形必须取到值（实得 ' + JSON.stringify(got[0]) + '）');" + NL
    + "    assert.equal(got[1], 'AAA', '空格形必须取到值（实得 ' + JSON.stringify(got[1]) + '）');" + NL
    + "    assert.equal(got[2], '', '两个写法都不给时必须回落 default（实得 ' + JSON.stringify(got[2]) + '）');" + NL
    + "    assert.equal(got[0], got[1], '两种写法取到的值必须一致');" + NL
    + "    /* ★ 反向自证（真跑）：把初版单形态实现（只认等号形）写进另一副本，同款驱动跑，" + NL
    + "     *   空格形必须取不到 —— 否则本判据是一条永远为真的空判据。 */" + NL
    + "    const oldCopy = path.join(dir, 'old_flag.py');" + NL
    + "    fs.writeFileSync(oldCopy, [" + NL
    + "        'import sys'," + NL
    + "        'def flag(name, default=None):'," + NL
    + "        \"    pre = '--' + name + '='\"," + NL
    + "        '    for a in sys.argv:'," + NL
    + "        '        if a.startswith(pre):'," + NL
    + "        '            return a[len(pre):]'," + NL
    + "        '    return default'," + NL
    + "        ''" + NL
    + "    ].join(NL), 'utf8');" + NL
    + "    const rawOld = execFileSync('python3', [drive, oldCopy], { encoding: 'utf8' });" + NL
    + "    const gotOld = JSON.parse(rawOld.trim());" + NL
    + "    assert.equal(gotOld[0], 'AAA', '自证前置：初版等号形仍应取到值');" + NL
    + "    assert.equal(gotOld[1], '', '★ 自证：初版单形态实现必须取不到空格形（否则本判据是空判据）');" + NL
    + "});" + NL
)


def main():
    p = os.path.join(ROOT, REL)
    with io.open(p, encoding='utf-8') as f:
        src = f.read()
    assert src.count(IMP_OLD) == 1, '[H] import anchor must hit exactly 1'
    assert src.count(START) == 1, '[H] E2 start anchor must hit exactly 1'
    n_end = src.count(END)
    assert n_end == 2, '[H] expected the duplicated section marker (got %d)' % n_end
    a = src.index(START)
    b = src.index(END, a)
    old_e2 = src[a:b]
    assert 'execFileSync' not in old_e2, '[H] already real-run (idempotent refusal)'
    new = src[:a] + NEW_E2 + src[b + len(END):]
    new = new.replace(IMP_OLD, IMP_NEW, 1)
    assert new.count(END) == 1, '[H] section marker must be unique after fix (got %d)' % new.count(END)
    assert new.count('E2 取数臂') == 1, '[H] E2 must appear exactly once'
    assert new.count('E1 五源同源') == 1, '[H] E1 must survive'
    assert new.count('execFileSync') >= 3, '[H] real-run calls must be present'
    if not WRITE:
        print('[H] dry run: E2 -> real run (%d -> %d chars), marker %d -> 1' % (len(old_e2), len(NEW_E2), n_end))
        return 0
    with io.open(p, 'w', encoding='utf-8') as f:
        f.write(new)
    print('[H] written: E2 is now a real run; section marker deduped')
    return 0


if __name__ == '__main__':
    sys.exit(main())
