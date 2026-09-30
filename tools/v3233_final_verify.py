#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v3.23.3 交付终验（六组断言）。
失败即 die；每项独立 group，便于定位。
"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
V = '3.23.3'
PREV = '3.23.2'
PROBE = 'tests/audit/memory_growth_probe.cjs'
BASE = 'tests/audit/memory_growth_baseline.json'
V3210 = 'tests/system-v3210.test.mjs'
DOC = 'docs/runtime-verification-boundary.md'

fails = []
n_ran = [0]  # 实跑断言计数（自报 —— 外部靠文本统计是弱口径）


def chk(cond, msg):
    n_ran[0] += 1
    if cond:
        print('  ✓ ' + msg)
    else:
        print('  ✗ ' + msg)
        fails.append(msg)


def rd(rel):
    return io.open(os.path.join(ROOT, rel), encoding='utf-8').read()


def main():
    print('【组 1】六源同源 = %s' % V)
    man = json.loads(rd('manifest.json'))
    pk = json.loads(rd('package.json'))
    lg = json.loads(rd('update-log.json'))
    idx = rd('index.js')
    itr = rd('ITERATION_LOG.md')
    chk(man['version'] == V, 'manifest.version == %s' % V)
    chk(pk['version'] == V, 'package.version == %s' % V)
    chk(str(lg['latest']) == V, 'update-log.latest == %s' % V)
    chk(list(lg['versions'].keys())[0] == V, 'update-log 首键 == %s' % V)
    chk(("const ST_PHONE_VERSION = '%s';" % V) in idx, 'index.js 常量 == %s' % V)
    chk(('- **当前版本**：`%s`' % V) in itr, 'ITERATION_LOG 当前版本行 == %s' % V)

    print('【组 2】当版条目（9 条 · date · 四处硬锚 · 无方括号）')
    cur = lg['versions'][V]
    items = cur['items']
    chk(len(items) == 9, '当版条目 9 条（实测 %d）' % len(items))
    chk(cur['date'] == '2026-09-30', 'date == 2026-09-30')
    chk(any(('版本升至 %s（五源同源）' % V) in it for it in items), '落点条：版本升至 %s（五源同源）' % V)
    chk(any(re.search(u'自己抓到的缺陷|本版自己抓到|缺陷形态', it) for it in items), '缺陷形态条（自己抓到的缺陷）')
    chk(any(re.search(u'交棒改写|主动改写|下限形', it) for it in items), '交棒改写条')
    chk(any(u'运行时验证边界' in it for it in items), '运行时验证边界条（v328 A2）')
    chk(any('看起来没坏但显示不对' in it for it in items), '标志语条（v328 A2 / B1）')
    chk(any(re.search(u'判据|门禁', it) for it in items), '判据 / 门禁面条（G3）')
    chk(all(('[' not in it and ']' not in it) for it in items), '条目逐条不含方括号（v324 A4）')
    chk(lg['versions'][PREV]['items'].__len__() > 0, '上一版条目保留（追加式）')

    print('【组 3】探针 / 基线（B2 迁移落地）')
    probe = rd(PROBE)
    base = json.loads(rd(BASE))
    chk('③b 宿主注入对象' in probe, '探针含 ③b 段')
    chk('globals_same_obj' in probe and 'globals_after' not in probe, '展示面同源（globals_same_obj，无弱字段 globals_after）')
    chk('globals-not-restored' in probe, '探针含 globals-not-restored 拒判分支')
    chk(len(base['unmeasurable']) == 3, 'unmeasurable 4 → 3（实测 %d）' % len(base['unmeasurable']))
    chk(not any(u'宿主（SillyTavern）注入对象' in x['item'] for x in base['unmeasurable']),
        '宿主注入对象已从 unmeasurable 迁出')
    chk(len(base['approx_measurable']) == 1, 'approx_measurable 恰 1 条')
    am = base['approx_measurable'][0]
    chk(isinstance(am['readings'].get('host_roundtrip_per_round_kb'), (int, float)), '迁移条目带真读数')
    chk('真宿主' in am.get('still_unmeasurable', ''), '迁移条目写明残余边界（真宿主仍不可测）')
    chk(base['measured_at'] == 'v' + V, '基线 measured_at == v%s（由探针现场决定）' % V)
    chk(('v' + V) in base['rebuilds'], 'rebuilds 含 v%s 键' % V)
    _rb = base['rebuilds'].get('v' + V) or {}
    chk('host_roundtrip_per_round_kb' in json.dumps(_rb, ensure_ascii=False),
        'rebuilds 新键登记了迁移读数')
    chk(('v' + PREV) not in base['rebuilds'], 'rebuilds 无中间态重复键 v%s' % PREV)
    chk(sum(1 for c in base['corrections'] if u'B2 迁移（unmeasurable 4 → 3）' in c) == 1,
        'corrections 里 B2 迁移只记一条（中间态已清）')
    chk('globals_after' not in json.dumps(base, ensure_ascii=False), '基线无弱口径字段残留')
    chk(base['verdict']['host_injection'] == 'linear-acceptable', 'verdict.host_injection == linear-acceptable')

    print('【组 4】判据套件 v3210（段 I 三条 + F5 弱口径已修）')
    t = rd(V3210)
    for k in ['I1 探针导出', 'I2 迁移读数与探针', 'I3★ 负控制：破坏夹具的还原']:
        chk(k in t, '含判据：' + k)
    chk("hasGuard: txt.indexOf(NEW_OK) >= 0" in t, 'F5 的 hasGuard 已锚定 NEW_OK（弱口径已修）')
    chk("txt.indexOf('!GC_FORCED')" not in t, '旧弱口径写法已不存在')
    chk(t.count("const NEW_OK = ") == 1 and t.count("const ANCHOR_OLD = ") == 1, '锚点常量各声明恰一次（H5 纯度）')
    chk('stripVol' in t, 'I2 按确定性面 / 浮点面分开比（stripVol）')

    print('【组 5】边界文档 + PLAN')
    doc = rd(DOC)
    chk(('v%s 复校' % V) in doc, '含 v%s 复校段' % V)
    chk('看起来没坏但显示不对' in doc, '复校段含标志语')
    chk('不能保证' in doc, '复校段含「不能保证」')
    chk(not re.search(u'已完整验证|已完全验证|全部验证通过', doc.split('v%s 复校' % V)[1].split('\n- **')[0] if ('v%s 复校' % V) in doc else ''),
        '复校段无「已完整验证」类全绿话术')
    seg = doc.split('v%s 复校' % V)[1].split('\n- **')[0] if ('v%s 复校' % V) in doc else ''
    chk('归 **R-O3**' in seg, '复校段点名残余项归 R-O3')
    chk(('v%s 复校' % PREV) in doc, 'v%s 旧复校段保留' % PREV)
    chk(re.search(r'^- 语法 460 文件$', doc, re.M) is not None, '机器可读行仍是「- 语法 460 文件」')
    chk(re.search(r'^- 导入 260 文件 405 条$', doc, re.M) is not None, '机器可读行仍是「- 导入 260 文件 405 条」')
    plan = rd('PLAN.md')
    chk(u'- **验收**：`unmeasurable` 计数下降，迁移条目转为有读数的断言。' in plan, 'B2 验收原文保留')
    chk(u'已交付 v%s（第 1 批迁移）' % V in plan, 'B2 追加第 1 批交付记录')
    chk(u'已交付 v3.20.6（首段）' in plan and u'已交付 v3.23.2（下段）' in plan, 'B3 历史两条保留')

    print('【组 6】ITERATION_LOG / 仓库卫生')
    nums = [int(x) for x in re.findall(u'^## 迭代 (\\d+) —', itr, flags=re.M)]
    chk(nums[0] == 79, '迭代 79 在段列表最前')
    chk(nums.count(79) == 1, '迭代 79 编号唯一')
    chk(u'- **门禁基线**（**v%s 实测**' % V in itr, '门禁基线段已刷到 v%s' % V)
    chk(u'- **门禁基线**（v3.23.2 实测，留档对照）' in itr, 'v3.23.2 留档对照段在场')
    main_seg = itr[itr.index(u'- **门禁基线**（**v%s 实测**' % V):itr.index(u'- **门禁基线**（v3.23.2 实测，留档对照）')]
    chk('1572 条 · 1572 pass · 0 fail' in main_seg, '主基线段含本版读数')
    chk('1569 条' not in main_seg, '主基线段不含旧读数')
    # index.js 公告块逐字同源 + 落点句在场
    m = re.search(r'const ST_PHONE_CURRENT_UPDATE = \{[\s\S]*?\n\};', idx)
    chk(m is not None, 'index.js 公告块在场')
    blk = m.group(0) if m else ''
    chk(all(json.dumps(it, ensure_ascii=False) in blk for it in items), '公告块 9 条逐字同源')
    chk(('版本升至 %s（五源同源）' % V) in blk, '公告块含落点句')
    chk(json.loads(rd(BASE))['file'] == PROBE, '基线 file 指向探针')

    print()
    if fails:
        print('✗ 终验失败 %d 项：' % len(fails))
        for f in fails:
            print('   - ' + f)
        sys.exit(1)
    print('✓ v%s 交付终验全部通过（六组断言 · 实跑断言 %d 项）' % (V, n_ran[0]))


if __name__ == '__main__':
    main()