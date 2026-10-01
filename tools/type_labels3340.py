# -*- coding: utf-8 -*-
"""[v3.34.0] 修桥契约门 J7 抓到的一处真缺陷：归因文案表手写了标识符形键。

症状（`node scripts/bridge-contract-audit.mjs` J7 判据报红）：
    视图里 `const TYPE_LABEL = { fan_writer: '写字的人', … }` —— 键是**手写的一套标识符形**，
    而不是取真源常量的值；同一文件另有 `LOFTER_ACTIVE_TYPES.concat(['oc_creator', 'reviewer'])`
    —— 非活跃类型也手写了一遍。

为什么是真缺陷（不是洁癖）：J7 立的判据正来自 clock-view / ledger-view 的实伤 ——
    两张 `*_META` 表的键写成下划线形 `no_clock_face`，而真源 `CLOCK_REASONS` 的值是连字符形
    `no-clock-face` ⇒ 五态里三态查不到、兜底全显示成「桥未连接」，**而当时的判据全绿**。
    本件同一形态：类型清单改一处，人话表不动，就静默错配。

修法（单一真源）：
    数据层加 `LOFTER_IDLE_TYPES`（非活跃两类，与活跃两类同源同位）与
    `LOFTER_TYPE_LABELS`（IIFE，键**按 `LOFTER_ACTIVE_TYPES.concat(LOFTER_IDLE_TYPES)` 顺序现取**）；
    视图删手写表与手写 concat 数组，改 import 真源。
"""
import io
import sys

DATA = 'apps/lofter/lofter-data.js'
VIEW = 'apps/lofter/lofter-view.js'

# ── D1 数据层：LOFTER_IDLE_TYPES + LOFTER_TYPE_LABELS ──────────────────────
D1_OLD = """export const LOFTER_ACTIVE_TYPES = ['fan_writer', 'fan_artist', 'cp_fan', 'info_station'];
"""
D1_NEW = """export const LOFTER_ACTIVE_TYPES = ['fan_writer', 'fan_artist', 'cp_fan', 'info_station'];
/** 源里被**静默过滤**掉的两类作者（原创向 `oc_creator` / 长评人 `reviewer`）。
 *  源只认上面 4 类、其余静默丢弃；本仓不许静默 ⇒ 两位真实存在、由 `isActiveLofterType`
 *  显式滤掉并在读数里如实计数（非活跃 2）。 */
export const LOFTER_IDLE_TYPES = ['oc_creator', 'reviewer'];
/** 作者类型的人话表（4 类活跃 + 2 类非活跃，键**现取真源**）。
 *  ★ 不手写键：手写的代价见桥契约门 J7 判据立据的那两处实伤 —— 键形与真源值差一个连接符，
 *    五态里三态查不到、全兜底成同一句「桥未连接」，而当时判据全绿。
 *    故本表由 IIFE 按 `LOFTER_ACTIVE_TYPES.concat(LOFTER_IDLE_TYPES)` 的**顺序**填，
 *    改类型清单时人话表跟着走，不留第二份清单。 */
export const LOFTER_TYPE_LABELS = (() => {
    const humans = ['写字的人', '画手', '抠糖人', '情报站', '原创向', '长评人'];
    const types = LOFTER_ACTIVE_TYPES.concat(LOFTER_IDLE_TYPES);
    const table = {};
    for (let i = 0; i < types.length; i++) table[types[i]] = humans[i] || types[i];
    return table;
})();
"""

# ── V1 视图：import 面补两个真源 ───────────────────────────────────────────
V1_OLD = """    LOFTER_REASONS, LOFTER_ACTIVE_TYPES, LOFTER_ARTICLE_TYPES,
"""
V1_NEW = """    LOFTER_REASONS, LOFTER_ACTIVE_TYPES, LOFTER_IDLE_TYPES, LOFTER_TYPE_LABELS,
    LOFTER_ARTICLE_TYPES,
"""

# ── V2 视图：删手写人话表 ──────────────────────────────────────────────────
V2_OLD = """/** 作者类型的人话（源的 7 类：4 类活跃 + 3 类会被静默过滤的，本仓都摆出来）。 */
const TYPE_LABEL = {
    fan_writer: '写字的人', fan_artist: '画手', cp_fan: '抠糖人', info_station: '情报站',
    oc_creator: '原创向', reviewer: '长评人',
};
"""
V2_NEW = """/* 作者类型的人话表**不在这里手写**：单一真源是数据层的 `LOFTER_TYPE_LABELS`
 * （键按 `LOFTER_ACTIVE_TYPES.concat(LOFTER_IDLE_TYPES)` 现取）。改类型清单时它跟着走。 */
"""

# ── V3 视图：类型下拉的清单改真源 ──────────────────────────────────────────
V3_OLD = """const AUTHOR_TYPES = LOFTER_ACTIVE_TYPES.concat(['oc_creator', 'reviewer']);
"""
V3_NEW = """const AUTHOR_TYPES = LOFTER_ACTIVE_TYPES.concat(LOFTER_IDLE_TYPES);
"""

# ── V4/V5 视图：两处引用点 ─────────────────────────────────────────────────
V4_OLD = """this._esc(TYPE_LABEL[a.type] || String(a.type))"""
V4_NEW = """this._esc(LOFTER_TYPE_LABELS[a.type] || String(a.type))"""

V5_OLD = """this._esc(TYPE_LABEL[t] || t)"""
V5_NEW = """this._esc(LOFTER_TYPE_LABELS[t] || t)"""


def patch(path, old, new, label):
    with io.open(path, encoding='utf-8') as f:
        text = f.read()
    n = text.count(old)
    if n != 1:
        print('FAIL %s: 锚点命中 %d 次（应为 1）' % (label, n))
        sys.exit(1)
    with io.open(path, 'w', encoding='utf-8') as f:
        f.write(text.replace(old, new, 1))
    print('OK   %s' % label)


patch(DATA, D1_OLD, D1_NEW, 'data: LOFTER_IDLE_TYPES + LOFTER_TYPE_LABELS（单一真源）')
patch(VIEW, V1_OLD, V1_NEW, 'view: import 面补 LOFTER_IDLE_TYPES / LOFTER_TYPE_LABELS')
patch(VIEW, V2_OLD, V2_NEW, 'view: 删手写 TYPE_LABEL 表')
patch(VIEW, V3_OLD, V3_NEW, 'view: AUTHOR_TYPES 改真源')
patch(VIEW, V4_OLD, V4_NEW, 'view: 引用点 1（作者卡）')
patch(VIEW, V5_OLD, V5_NEW, 'view: 引用点 2（类型下拉）')

# 收口自证：手写表已在视图绝迹
with io.open(VIEW, encoding='utf-8') as f:
    v = f.read()
if 'TYPE_LABEL' in v.replace('LOFTER_TYPE_LABELS', ''):
    print('FAIL 视图仍残留裸 TYPE_LABEL')
    sys.exit(1)
if "'oc_creator'" in v:
    print('FAIL 视图仍手写非活跃类型')
    sys.exit(1)
print('OK   自证：视图无裸 TYPE_LABEL、无手写 oc_creator')