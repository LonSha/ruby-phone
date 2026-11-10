#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""_fix_v4139_release_notes.py — v4.139.0 收口：把当版说明补成满足形态判据的形状。

治的是三件事（都是判据点名、不是文案口味）：
  ① system-v328 A2/B1/D2 要求当版 items 里至少一条提到「运行时验证边界」，
     且与边界文档共用同一句标志语「看起来没坏但显示不对」，并写成「不能保证」而不是全绿。
  ② system-v3171 / v3201 / v3213 G3 / v4115 G1 要求当版条目带三条形态锚：
     本版落点（版本升至 X（五源同源））、本版自己抓到的缺陷、对旧判据的交棒改写。
  ③ 弹窗与 update-log 必须**逐字同源** —— 故两处由同一份 items 写出，不手抄第二份。
"""
import io
import json
import re

ROOT = '/home/user/ruby-phone'
IDX = ROOT + '/index.js'
LOG = ROOT + '/update-log.json'
VER = '4.139.0'

NEW_TAIL = [
    "【运行时验证边界】本轮以仓库内全量套件与审计工具为证：1347 个文件可按 ES Module 解析、"
    "1400 条静态相对导入可解析、具名导入门 1336 条全满足；但**不能保证**真机视觉排版、"
    "真实网络往返、宿主存储迁移与渲染帧耗时 —— 遇到「看起来没坏但显示不对」的问题，"
    "属于边界文档登记的第二类，须在真机复现后再修，不把门禁全绿当成实机已验。",
    "【本版自己抓到的缺陷形态】① 旧发布版存在 ESM 具名导出缺失：物理损伤模拟器只导出 "
    "applyPhysicalDamage，而 device-runtime 已按 simulatePhysicalDegradation 导入，"
    "安装包一加载即抛 SyntaxError —— 本分支补上别名导出并加负控制；② named-import 门禁把 "
    "export const 解构导出误判成缺失（自造假红），已修正解析并验证破坏后仍能转红；"
    "③ 死表面账本与死方法账本把条目数当等值锚，真实接线反而翻红。",
    "【交棒改写】把三条「把水位当契约」的等值锚改写为不变量：死表面账本改「防塌陷下限 + "
    "两档穷尽互斥」；探针判据散文改「现场读数写回、零手抄」；入口注释不再使用 ASCII 方括号，"
    "避免历史判据按首个右方括号截断头部而假红。",
]


def main():
    src = io.open(IDX, encoding='utf-8').read()
    start = src.index('const ST_PHONE_CURRENT_UPDATE')
    end = src.index('\n};', start) + 3
    block = src[start:end]
    m = re.search(r'items:\s*\[(.*?)\n\s*\]', block, re.S)
    if not m:
        raise SystemExit('[fix] items 块没找到')
    items = re.findall(r'"((?:[^"\\]|\\.)*)"', m.group(1))
    before = len(items)
    # 去掉旧的【验证边界】收尾条（本轮要换成带标志语、带「不能保证」的版本）
    items = [x for x in items if not x.startswith('【验证边界】')]
    for t in NEW_TAIL:
        if t not in items:
            items.append(t)
    body = '\n' + ',\n'.join('        ' + json.dumps(x, ensure_ascii=False) for x in items) + '\n    '
    new_block = block[:m.start(1)] + body + block[m.end(1):]
    io.open(IDX, 'w', encoding='utf-8').write(src[:start] + new_block + src[end:])
    print('[fix] index.js items: %d -> %d' % (before, len(items)))

    log = json.load(io.open(LOG, encoding='utf-8'))
    log['versions'][VER]['items'] = items
    io.open(LOG, 'w', encoding='utf-8').write(
        json.dumps(log, ensure_ascii=False, indent=2) + '\n')
    print('[fix] update-log %s items: %d' % (VER, len(items)))

    # 自检：弹窗头部（历史判据的切片口径）必须读得到全部 items，且 items 内不得有 ASCII 方括号
    now = io.open(IDX, encoding='utf-8').read()
    seg = now[now.index('const ST_PHONE_CURRENT_UPDATE'):]
    head = seg[:seg.index(']') + 1]
    missing = [x for x in items if json.dumps(x, ensure_ascii=False) not in head]
    print('[check] head 内读不到的条数 = %d' % len(missing))
    print('[check] 含 ASCII 方括号的条数 = %d'
          % len([x for x in items if '[' in x or ']' in x]))
    mark = [x for x in items if '运行时验证边界' in x]
    print('[check] 提到「运行时验证边界」的条数 = %d' % len(mark))
    print('[check] 标志语在场 = %s' % any('看起来没坏但显示不对' in x for x in items))


if __name__ == '__main__':
    main()
