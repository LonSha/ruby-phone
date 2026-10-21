#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v4.45.0 收尾补丁：判据条数文档失实（写「六组 26 条」，实测 31 条）。

为什么必须修：本仓纪律是「读数零手抄」——版本公告里的条数是一份**可复算的读数**。
写错了就是「不报错、不崩溃、只错结果」的最小形态：套件真跑 31 条，而四处同源面
（迭代段 / ITERATION_LOG / update-log items / index.js 公告块）一致地写着 26 条，
读者据此核对会以为漏了 5 条判据。

口径：一律**按原文替换**（连 update-log.json 也走文本面），不做 JSON 反序列化重写——
重写会连带改动全文件的缩进/键序，把一次单点修正放大成整份文件的 diff。

锚点：`（六组 26 条）当版跑绿` —— 四处各恰中 1 次，失配即 abort（不做静默部分替换）。
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OLD = '（六组 26 条）当版跑绿'
NEW = '（六组 31 条）当版跑绿'
FACES = {
    'tools/iter204_seg.md': 1,
    'ITERATION_LOG.md': 1,
    'index.js': 1,
    'update-log.json': 1,
}


def main() -> int:
    bad = []
    for rel, want in FACES.items():
        p = ROOT / rel
        src = p.read_text(encoding='utf-8')
        got = src.count(OLD)
        if got != want:
            bad.append(f'{rel}: 锚点命中 {got} 次（期望 {want}）')
            continue
        p.write_text(src.replace(OLD, NEW), encoding='utf-8')
        print(f'[ok] {rel}: 替换 {got} 次')

    if bad:
        print('ABORT —— 锚点失配，未做任何静默部分替换：')
        for b in bad:
            print('  -', b)
        return 2

    # 自证：四处同源面旧串 0 残留 / 新串全在场；且 update-log.json 仍是可解析的 JSON
    import json
    for rel in FACES:
        t = (ROOT / rel).read_text(encoding='utf-8')
        assert OLD not in t, f'{rel} 旧串残留'
        assert NEW in t, f'{rel} 新串缺席'
    json.loads((ROOT / 'update-log.json').read_text(encoding='utf-8'))
    print('[self-check] 四处同源面：旧串 0 残留 / 新串全在场；update-log.json 仍可解析')
    return 0


if __name__ == '__main__':
    sys.exit(main())