#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_mag3.py — [v3.36.0] 把「时间读数的人话表」键面收成真源常量。

理由（本仓 J7 记过的形态）：视图 `AGO_TEXT` 首版把 `'now' / 'minute' / 'hour' /
'day' / 'none'` 五个键**手写**了一遍，而它们本是数据层 `timeAgoFace()` 的产出 ——
手写键就是**第二个真源**：数据层哪天多一个单位，视图静默走兜底（显示「时间不详」）
而不是报错。修法不是放宽判据，是**把键面提到数据层**（`MAGAZINE_TIME_UNITS`），
视图用计算键建表。

★ 本条与本版 dead-exports 门抓到的三处同族：**常量建好了必须真被消费** ——
  故 `MAGAZINE_TIME_UNITS` 在数据层 `timeAgoFace` 里也被用作**白名单校验**
  （产出单位不在表内 ⇒ 归 `none`，不静默放过）。
"""
import io
import sys

DATA = 'apps/magazine/magazine-data.js'
VIEW = 'apps/magazine/magazine-view.js'

E = []

# ① 数据层：加真源常量（插在块类型表之后）
BLOCK_TAIL = """    'note',       // 关系图的编者按（源按 ※ 行首分流）
];
"""
BLOCK_NEW = BLOCK_TAIL + """
/** 时间读数的**单位面**（`timeAgoFace` 的产出键）。视图的人话表必须用这些键
 *  建计算键 —— 手写一份就是第二个真源（数据层多一个单位，视图静默走兜底）。 */
export const MAGAZINE_TIME_UNITS = ['none', 'now', 'minute', 'hour', 'day'];
"""
E.append((DATA, BLOCK_TAIL, BLOCK_NEW, '数据层加 MAGAZINE_TIME_UNITS'))

# ② 数据层：timeAgoFace 用白名单校验产出
TA_OLD = """export function timeAgoFace(ts, now) {
    const t = numOrNull(ts);
    if (t === null || t <= 0) return { unit: 'none', value: 0 };
    const base = numOrNull(now) === null ? Date.now() : Math.trunc(now);
    const diff = Math.max(0, base - Math.trunc(t));
    const m = Math.floor(diff / 60000);
    const h = Math.floor(diff / 3600000);
    const d = Math.floor(diff / 86400000);
    if (m < 1) return { unit: 'now', value: 0 };
    if (m < 60) return { unit: 'minute', value: m };
    if (h < 24) return { unit: 'hour', value: h };
    return { unit: 'day', value: d };
}"""
TA_NEW = """export function timeAgoFace(ts, now) {
    const t = numOrNull(ts);
    const U = MAGAZINE_TIME_UNITS;
    /** ★ 产出必须落在单位表内（不在表内 ⇒ 归 none 并如实回报，不静默放过）。 */
    const face = (unit, value) => (U.includes(unit) ? { unit, value } : { unit: 'none', value: 0, stray: unit });
    if (t === null || t <= 0) return face('none', 0);
    const base = numOrNull(now) === null ? Date.now() : Math.trunc(now);
    const diff = Math.max(0, base - Math.trunc(t));
    const m = Math.floor(diff / 60000);
    const h = Math.floor(diff / 3600000);
    const d = Math.floor(diff / 86400000);
    if (m < 1) return face('now', 0);
    if (m < 60) return face('minute', m);
    if (h < 24) return face('hour', h);
    return face('day', d);
}"""
E.append((DATA, TA_OLD, TA_NEW, 'timeAgoFace 白名单校验'))

# ③ 视图：AGO_TEXT 改计算键
V_OLD = """import {
    MAGAZINE_REASONS, MAGAZINE_TYPES, MAGAZINE_TYPE_LABELS, MAGAZINE_TYPE_COLORS,
    MAGAZINE_FEATURE_ICONS, MAGAZINE_POLL_MEDALS, MAGAZINE_ARROW_KINDS,
} from './magazine-data.js';"""
V_NEW = """import {
    MAGAZINE_REASONS, MAGAZINE_TYPES, MAGAZINE_TYPE_LABELS, MAGAZINE_TYPE_COLORS,
    MAGAZINE_FEATURE_ICONS, MAGAZINE_POLL_MEDALS, MAGAZINE_ARROW_KINDS,
    MAGAZINE_TIME_UNITS,
} from './magazine-data.js';"""
E.append((VIEW, V_OLD, V_NEW, '视图 import 补单位真源'))

V_AGO_OLD = """/** 时间读数的人话（数据层只给 `{unit, value}` 事实，文案在视图）。 */
const AGO_TEXT = {
    now: () => '刚刚',
    minute: (v) => v + ' 分钟前',
    hour: (v) => v + ' 小时前',
    day: (v) => v + ' 天前',
    none: () => '时间不详',
};"""
V_AGO_NEW = """/** 时间读数的人话（数据层只给 `{unit, value}` 事实，文案在视图）。
 *  ★ 键**取真源常量**（`MAGAZINE_TIME_UNITS`），不手写 —— 手写就是第二个真源。 */
const AGO_TEXT = {
    [MAGAZINE_TIME_UNITS[1]]: () => '刚刚',
    [MAGAZINE_TIME_UNITS[2]]: (v) => v + ' 分钟前',
    [MAGAZINE_TIME_UNITS[3]]: (v) => v + ' 小时前',
    [MAGAZINE_TIME_UNITS[4]]: (v) => v + ' 天前',
    [MAGAZINE_TIME_UNITS[0]]: () => '时间不详',
};"""
E.append((VIEW, V_AGO_OLD, V_AGO_NEW, '视图 AGO_TEXT 改计算键'))


def main(write):
    bad = 0
    for path, old, new, label in E:
        text = io.open(path, encoding='utf-8').read()
        n = text.count(old)
        if n != 1:
            print('FAIL %s: 锚点命中 %d 次（应为 1）' % (label, n))
            bad += 1
            continue
        if write:
            io.open(path, 'w', encoding='utf-8').write(text.replace(old, new, 1))
            print('OK   %s' % label)
        else:
            print('DRY  %s' % label)
    if bad:
        print('失配 %d 处' % bad)
        sys.exit(1)
    print('全部完成' if write else '（dry-run）')


main('--write' in sys.argv)