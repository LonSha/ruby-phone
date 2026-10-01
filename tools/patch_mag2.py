#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_mag2.py — [v3.36.0] 修 dead-exports 门当场抓到的 3 处零消费导出。

门禁读数（不是自述）：
    apps/magazine/magazine-data.js:83   MAGAZINE_NPC_TYPES
    apps/magazine/magazine-data.js:151  MAGAZINE_ARROW_KINDS
    apps/magazine/magazine-data.js:208  MAGAZINE_BLOCK_KINDS

三处处置**逐条不同**（本仓纪律：不许一律塞进冻结账本或加豁免）：
  ① `MAGAZINE_NPC_TYPES` —— 它是 `MAGAZINE_INTERVIEW_TYPES.slice()` 的**同义副本**，
     没有任何存在理由（第二个真源）。**删掉**，App 的 `needsPeople` 直接用
     `MAGAZINE_INTERVIEW_TYPES`。
  ② `MAGAZINE_ARROW_KINDS` —— **真接线**：视图建 `ARROW_MARKERS` 表用它当键面，
     替换原来写死的 `if (arrow === '→') ... else if ('←') ...` 链。
     （写死的链就是「第二个真源」：数据层多认一个箭头、视图静默不画 marker。）
  ③ `MAGAZINE_BLOCK_KINDS` —— **真接线**：`parseArticleBody` 在产出时用它做**白名单校验**，
     任何块 kind 不在表内 ⇒ 如实计进 `unknown`（这正是本件守的那条形态：
     「解析器产出了一个没人认识的块」不许静默通过）。
"""
import io
import sys

EDITS = []

# ── ① 删同义副本 + App 改用真源 ──
DATA = 'apps/magazine/magazine-data.js'
APP = 'apps/magazine/magazine-app.js'

DEL_NPC = """/** 需要「受访者」的型（源只在访谈系列上读 npcIds；其余型登记时一律给空数组）。 */
export const MAGAZINE_NPC_TYPES = MAGAZINE_INTERVIEW_TYPES.slice();

"""
EDITS.append((DATA, DEL_NPC, '', '删 MAGAZINE_NPC_TYPES（同义副本）'))

# ── ③ parseArticleBody 用白名单校验产出 ──
PB_OLD = """    return { blocks, unknown, total: blocks.length };
}"""
PB_NEW = """    /* ★ 白名单校验产出：块 kind 必须在 `MAGAZINE_BLOCK_KINDS` 内 ——
     * 「解析器产出了一个没人认识的块」不许静默通过（源那十套解析器连
     * 「这行算被认出来了吗」都答不出来）。不在表内 ⇒ 如实计进 unknown。 */
    let stray = 0;
    for (const b of blocks) {
        if (!MAGAZINE_BLOCK_KINDS.includes(b.kind)) stray++;
    }
    return { blocks, unknown: unknown + stray, stray, total: blocks.length };
}"""
EDITS.append((DATA, PB_OLD, PB_NEW, 'parseArticleBody 白名单校验'))

# ── ② 视图用 ARROW_KINDS 建 marker 表 ──
VIEW = 'apps/magazine/magazine-view.js'
V_IMP_OLD = """import {
    MAGAZINE_REASONS, MAGAZINE_TYPES, MAGAZINE_TYPE_LABELS, MAGAZINE_TYPE_COLORS,
    MAGAZINE_FEATURE_ICONS, MAGAZINE_POLL_MEDALS, MAGAZINE_INTERVIEW_TYPES,
} from './magazine-data.js';"""
V_IMP_NEW = """import {
    MAGAZINE_REASONS, MAGAZINE_TYPES, MAGAZINE_TYPE_LABELS, MAGAZINE_TYPE_COLORS,
    MAGAZINE_FEATURE_ICONS, MAGAZINE_POLL_MEDALS, MAGAZINE_ARROW_KINDS,
} from './magazine-data.js';

/** 箭头 → SVG marker 属性。★ 键**取真源常量**（`MAGAZINE_ARROW_KINDS` 里那四个），
 *  不手写第二份 —— 数据层多认一个箭头而视图静默不画 marker，就是「手写键 = 第二个真源」
 *  那个形态（本仓 J7 记过）。`⇔` 与 `↔` 语义相同（双向），故两者共用一个键位。 */
const ARROW_MARKERS = {
    [MAGAZINE_ARROW_KINDS[1]]: ' marker-end="url(#mgz-arrow-end)"',
    [MAGAZINE_ARROW_KINDS[2]]: ' marker-start="url(#mgz-arrow-start)"',
    [MAGAZINE_ARROW_KINDS[0]]: ' marker-start="url(#mgz-arrow-start)" marker-end="url(#mgz-arrow-end)"',
    [MAGAZINE_ARROW_KINDS[3]]: ' marker-start="url(#mgz-arrow-start)" marker-end="url(#mgz-arrow-end)"',
};"""
EDITS.append((VIEW, V_IMP_OLD, V_IMP_NEW, '视图 import 换真源 + marker 表'))

V_USE_OLD = """            let marker = '';
            if (e.arrow === '→') marker = ' marker-end="url(#mgz-arrow-end)"';
            else if (e.arrow === '←') marker = ' marker-start="url(#mgz-arrow-start)"';
            else if (e.arrow === '⇔' || e.arrow === '↔') marker = ' marker-start="url(#mgz-arrow-start)" marker-end="url(#mgz-arrow-end)"';
"""
V_USE_NEW = """            const marker = ARROW_MARKERS[e.arrow] || '';
"""
EDITS.append((VIEW, V_USE_OLD, V_USE_NEW, '视图 marker 改查表'))

# ── ① App 的 needsPeople 改用 INTERVIEW_TYPES ──
A_OLD = """import {
    MAGAZINE_REASONS, MAGAZINE_LIMITS, MAGAZINE_TYPES, MAGAZINE_TYPE_LABELS,
    MAGAZINE_FEATURE_TEMPLATES, MAGAZINE_BUILT_IN_PEOPLE, MAGAZINE_DEFAULT_NAME,
    MAGAZINE_INTERVIEW_TYPES,"""
A_NEW = """import {
    MAGAZINE_REASONS, MAGAZINE_LIMITS, MAGAZINE_TYPES, MAGAZINE_TYPE_LABELS,
    MAGAZINE_FEATURE_TEMPLATES, MAGAZINE_BUILT_IN_PEOPLE, MAGAZINE_DEFAULT_NAME,
    MAGAZINE_INTERVIEW_TYPES,"""
# App 的 import 已含 INTERVIEW_TYPES，只需确保 needsPeople 用它（已是）。
A_USE_OLD = """    needsPeople(type) { return MAGAZINE_INTERVIEW_TYPES.includes(type); }"""
A_USE_NEW = """    needsPeople(type) { return MAGAZINE_INTERVIEW_TYPES.includes(type); }"""
# 无需改动（原本就用 INTERVIEW_TYPES）；保留断言以证明这一点。


def main(write):
    bad = 0
    for path, old, new, label in EDITS:
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
    # 自证：App 里 needsPeople 用的是 INTERVIEW_TYPES（不是被删掉的 NPC_TYPES）
    app = io.open(APP, encoding='utf-8').read()
    assert 'MAGAZINE_NPC_TYPES' not in app, 'App 里还在引用已删掉的 MAGAZINE_NPC_TYPES'
    assert A_USE_OLD in app, 'App 的 needsPeople 形态变了，请复核'
    print('自证：App 零引用 NPC_TYPES · needsPeople 走 INTERVIEW_TYPES')
    if bad:
        print('失配 %d 处' % bad)
        sys.exit(1)
    print('全部完成' if write else '（dry-run）')


main('--write' in sys.argv)