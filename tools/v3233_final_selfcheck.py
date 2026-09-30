#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""终验脚本 `final_v3233.py` 的自证（H6 工具两向自证）。

为什么需要：本版 `final_v3233.py` 自己错了三处 ——（a）组 3 的 measured_at 断言
常量没跟着基线刷新走（PREV → V）；（b）rebuilds 的键带 `v` 前缀而断言用了无前缀
的 V；（c）`base['rebuilds'][V]` 直接下标导致 KeyError 把后面四组全崩掉。
**验证脚本自己也会错**，所以它必须同样被验：
  ① 断言数下限 —— 判据被删掉 / 循环空转时，脚本会「零断言地通过」，须拒判；
  ② 正控制 —— 原版上终验必须绿（否则它就是恒红，等于没有判据）；
  ③ 负控制 ×4 —— 在真仓副本上做**真源码破坏**（锚点恰中 1 次否则整体退出），
     终验必须转红，且红项文本须含预期关键词；
  ④ 还原逐字节 —— 每轮破坏后还原，md5 必须与破坏前一致。

不碰产品逻辑，只证「终验这套判据是活的」。
"""
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, 'tools/v3233_final_verify.py')
BAK = os.path.join(os.environ.get('RPWORK', '/sdcard/rpwork'), 'selfcheck_bak')
OUT = os.path.join(os.environ.get('RPWORK', '/sdcard/rpwork'), 'final_selfcheck_out.txt')
MIN_CHK = 50

TARGETS = [
    'manifest.json',
    'tests/audit/memory_growth_baseline.json',
    'tests/system-v3210.test.mjs',
    'tests/audit/memory_growth_probe.cjs',
]

fails = []


def die(m):
    print(u'✗ ' + m)
    sys.exit(1)


def note(ok, m):
    print((u'  ✓ ' if ok else u'  ✗ ') + m)
    if not ok:
        fails.append(m)


def md5(p):
    return hashlib.md5(io.open(p, 'rb').read()).hexdigest()


def run_final():
    """跑终验，输出落盘（不走 PIPE —— 子进程写管道可能死锁）。"""
    with io.open(OUT, 'w', encoding='utf-8') as fh:
        r = subprocess.run([sys.executable, SCRIPT], stdout=fh,
                           stderr=subprocess.STDOUT)
    return r.returncode, io.open(OUT, encoding='utf-8').read()


def sub1(txt, old, new, tag):
    """锚点恰中 1 次否则退出不写盘。"""
    n = txt.count(old)
    if n != 1:
        die(u'破坏锚点【%s】命中 %d 次（应为 1）—— 拒绝破坏，整体退出' % (tag, n))
    return txt.replace(old, new)


# ---- 破坏器（全部对真源码，锚点恰 1 次）----
def brk_manifest(d):
    p = os.path.join(ROOT, 'manifest.json')
    t = io.open(p, encoding='utf-8').read()
    return p, sub1(t, u'"version": "3.23.3"', u'"version": "3.23.2"', 'manifest.version')


def brk_baseline(d):
    p = os.path.join(ROOT, 'tests/audit/memory_growth_baseline.json')
    obj = json.loads(io.open(p, encoding='utf-8').read())
    if 'v3.23.2' in obj['rebuilds']:
        die(u'基线里已有 v3.23.2 键 —— 破坏前置不成立')
    obj['rebuilds']['v3.23.2'] = json.loads(json.dumps(obj['rebuilds']['v3.23.3']))
    return p, json.dumps(obj, ensure_ascii=False, indent=2) + '\n'


def brk_f5(d):
    p = os.path.join(ROOT, 'tests/system-v3210.test.mjs')
    t = io.open(p, encoding='utf-8').read()
    return p, sub1(t, u"hasGuard: txt.indexOf(NEW_OK) >= 0",
                   u"hasGuard: txt.indexOf('!GC_FORCED') >= 0", 'v3210.F5.hasGuard')


def brk_probe(d):
    p = os.path.join(ROOT, 'tests/audit/memory_growth_probe.cjs')
    t = io.open(p, encoding='utf-8').read()
    # 把弱字段名塞回探针（模拟「展示面回退到 typeof」）
    return p, sub1(t, u'globals_same_obj: RESTORE_KEYS.map',
                   u'globals_after_note: RESTORE_KEYS.map', 'probe.globals') + \
        u'\n// globals_after\n'


CASES = [
    ('A manifest.version 回退', brk_manifest, u'manifest.version == 3.23.3'),
    ('B 基线中间态重复键复活', brk_baseline, u'rebuilds 无中间态重复键 v3.23.2'),
    ('C F5 弱口径复活（判据锚点回退）', brk_f5, u'F5 的 hasGuard 已锚定 NEW_OK'),
    ('D 探针展示面回退', brk_probe, u'展示面同源'),
]


def main():
    if not os.path.isdir(ROOT):
        die(u'仓库不存在：' + ROOT)
    os.makedirs(BAK, exist_ok=True)

    # 备份
    bk = {}
    for rel in TARGETS:
        src = os.path.join(ROOT, rel)
        dst = os.path.join(BAK, rel.replace('/', '__'))
        shutil.copyfile(src, dst)
        bk[rel] = (dst, md5(src))
    print(u'· 已备份 %d 个目标文件 → %s' % (len(TARGETS), BAK))

    # ① 断言数下限（防「零断言地通过」）
    print(u'【① 断言数下限 / 判据纯度】')
    src_script = io.open(SCRIPT, encoding='utf-8').read()
    # 注意：`def chk(cond, msg)` 这一行也含 `chk(`，须减掉定义行 —— 不能裸 count。
    n_chk = src_script.count(u'chk(') - src_script.count(u'def chk(')
    note(n_chk >= MIN_CHK, u'终验脚本 chk( 调用点 %d 处（下限 %d，已排除定义行）' % (n_chk, MIN_CHK))
    rcA, outA = run_final()
    # 终验脚本自己报的实跑断言数（来自它的收口句）—— 与脚本内的 chk 调用点对账。
    mm = re.search(u'实跑断言 (\\d+) 项', outA)
    note(mm is not None, u'终验脚本自报实跑断言数（收口句在场）')
    if mm:
        n_ran = int(mm.group(1))
        note(n_ran >= n_chk,
             u'自报实跑断言 %d >= 调用点 %d（循环内含调用点，故等于或大于）' % (n_ran, n_chk))
        # 展示面与判定面同源：输出里的 ✓/✗ 行数必须等于自报数，不能靠外部文本估算。
        note(outA.count(u'  ✓ ') + outA.count(u'  ✗ ') == n_ran,
             u'输出 ✓+✗ 行数 == 自报断言数（展示面与判定面同源）')
    note(u'sys.exit(1)' in src_script, u'终验脚本失败路径会 sys.exit(1)（不是静默通过）')
    note(u'fails.append' in src_script, u'终验脚本失败会进 fails 汇总')

    # ② 正控制
    print(u'【② 正控制：原版上终验必须绿】')
    rc, out = run_final()
    note(rc == 0, u'原版终验 exit=%d（应 0）' % rc)
    note(u'六组断言' in out, u'原版终验跑到收口句（六组断言）')
    note(u'✗' not in out, u'原版终验输出里零红项')

    # ③ 负控制
    print(u'【③ 负控制：真源码破坏 ⇒ 终验必须转红】')
    for name, fn, expect in CASES:
        p, newtxt = fn(None)
        rel = os.path.relpath(p, ROOT)
        io.open(p, 'w', encoding='utf-8').write(newtxt)
        try:
            rc2, out2 = run_final()
            note(rc2 != 0, u'%s：终验 exit=%d（应非 0）' % (name, rc2))
            note(expect in out2, u'%s：红项含预期文本「%s」' % (name, expect))
        finally:
            dst, h = bk[rel]
            shutil.copyfile(dst, p)
            note(md5(p) == h, u'%s：还原后 md5 与破坏前一致' % name)

    # ④ 还原总检
    print(u'【④ 还原总检 + 复跑正控制】')
    for rel in TARGETS:
        dst, h = bk[rel]
        note(md5(os.path.join(ROOT, rel)) == h, u'%s 已逐字节还原' % rel)
    rc3, out3 = run_final()
    note(rc3 == 0 and u'六组断言' in out3, u'还原后复跑终验仍绿（exit=%d）' % rc3)

    print()
    if fails:
        print(u'✗ 终验脚本自证失败 %d 项：' % len(fails))
        for f in fails:
            print(u'   - ' + f)
        sys.exit(1)
    print(u'✓ 终验脚本自证通过：正控制 1 · 负控制 %d · 还原逐字节一致' % len(CASES))


if __name__ == '__main__':
    main()
