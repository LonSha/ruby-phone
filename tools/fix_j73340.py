# -*- coding: utf-8 -*-
"""[v3.34.0] 修桥契约门 J7 抓到的一处真缺陷：归因文案表手写了标识符形键。

症状（桥契约门 `bridge-contract-audit.mjs` J7 判据报红）：
  视图里 `const TYPE_LABEL = { fan_writer: '写字的人', … }` —— 键是**手写的一套标识符形**，
  而不是取真源常量（`LOFTER_ACTIVE_TYPES`）的**值**。
  这正是 J7 立在案上的那个真缺陷形态（clock-view / ledger-view 的 FACE_META 键写成
  `no_clock_face` 而下划线形查不到连字符形的真源值 ⇒ 五态里三态静默走兜底、全显示成同一句话）。

本件的修法不是改键形（键值本来就与真源同形），而是**把真源提到单一来源**：
  在数据层加导出 `LOFTER_TYPE_LABELS`，其键**直接取自** `LOFTER_ACTIVE_TYPES` 的值 +
  两个非活跃类型（同一个 `all` 数组），视图只 import 不再自己写一套。
  这样以后谁改类型清单，人话表跟着走，不会两边漂移。
"""
import sys

DATA = 'apps/lofter/lofter-data.js'
VIEW = 'apps/lofter/lofter-view.js'


def patch(path, old, new, tag):
    with open(path, encoding='utf-8') as f:
        text = f.read()
    n = text.count(old)
    if n != 1:
        print('FAIL[%s]: 锚点命中 %d 次' % (tag, n))
        sys.exit(1)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text.replace(old, new, 1))
    print('OK  %s' % tag)


# ---------- 数据层：加单一真源的人话表 ----------
D_OLD = """export const LOFTER_ACTIVE_TYPES = ['fan_writer', 'fan_artist', 'cp_fan', 'info_station'];"""
D_NEW = """export const LOFTER_ACTIVE_TYPES = ['fan_writer', 'fan_artist', 'cp_fan', 'info_station'];
/** 非活跃类型（源静默过滤掉的 3 类里的 2 类；本仓把它们留在池里、显式滤掉、并在读数里计数）。 */
export const LOFTER_IDLE_TYPES = ['oc_creator', 'reviewer'];
/**
 * 类型的人话表。**键直接取自上面两个真源数组的值**，不手写一套标识符形 ——
 * 桥契约门 J7 就是为这件事立的：手写键与真源值形状不一致时会静默走兜底，
 * 多种处境显示成同一句话（clock-view / ledger-view 的 FACE_META 当年就栽在这里）。
 * 这里不写成对象字面量，而是按数组顺序填 —— 改类型清单时人话表跟着走。
 */
export const LOFTER_TYPE_LABELS = (() => {
    const out = {};
    const all = LOFTER_ACTIVE_TYPES.concat(LOFTER_IDLE_TYPES);
    const names = ['写字的人', '画手', '抠糖人', '情报站', '原创向', '长评人'];
    for (let i = 0; i < all.length; i++) out[all[i]] = names[i];
    return out;
})();"""
patch(DATA, D_OLD, D_NEW, 'data: LOFTER_TYPE_LABELS')

# ---------- 视图：改成 import 真源 ----------
V1_OLD = """import {
    LOFTER_REASONS, LOFTER_ACTIVE_TYPES, LOFTER_ARTICLE_TYPES,
    LOFTER_CHAPTER_LENGTHS, LOFTER_FULL_TEXT_WINDOW, formatCount, commentCountFace,
} from './lofter-data.js';"""
V1_NEW = """import {
    LOFTER_REASONS, LOFTER_ACTIVE_TYPES, LOFTER_IDLE_TYPES, LOFTER_TYPE_LABELS,
    LOFTER_ARTICLE_TYPES, LOFTER_CHAPTER_LENGTHS, LOFTER_FULL_TEXT_WINDOW,
    formatCount, commentCountFace,
} from './lofter-data.js';"""
patch(VIEW, V1_OLD, V1_NEW, 'view: import')

V2_OLD = """/** 作者类型的人话（源的 7 类：4 类活跃 + 3 类会被静默过滤的，本仓都摆出来）。 */
const TYPE_LABEL = {
    fan_writer: '写字的人', fan_artist: '画手', cp_fan: '抠糖人', info_station: '情报站',
    oc_creator: '原创向', reviewer: '长评人',
};"""
V2_NEW = """/** 类型下拉用（活跃 4 类 + 非活跃 2 类 —— 源静默过滤，本仓摆明）。
 *  人话表 `LOFTER_TYPE_LABELS` 与类型清单同在数据层（**单一真源**），视图不再自己写一套。 */
const AUTHOR_TYPES = LOFTER_ACTIVE_TYPES.concat(LOFTER_IDLE_TYPES);"""
patch(VIEW, V2_OLD, V2_NEW, 'view: 删手写表')

V3_OLD = """const AUTHOR_TYPES = LOFTER_ACTIVE_TYPES.concat(['oc_creator', 'reviewer']);
export class LofterView {"""
V3_NEW = """export class LofterView {"""
patch(VIEW, V3_OLD, V3_NEW, 'view: 删旧 AUTHOR_TYPES')

# 三处 TYPE_LABEL 引用改成真源
for old, new, tag in [
    ("this._esc(TYPE_LABEL[a.type] || String(a.type))", "this._esc(LOFTER_TYPE_LABELS[a.type] || String(a.type))", 'view: 作者池引用'),
    ("+ '>' + this._esc(TYPE_LABEL[t] || t) + '</option>');", "+ '>' + this._esc(LOFTER_TYPE_LABELS[t] || t) + '</option>');", 'view: 下拉引用'),
]:
    patch(VIEW, old, new, tag)

print('\nJ7 修复完成。')