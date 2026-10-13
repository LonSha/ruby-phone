#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""[v4.01.0] 修三处真语义缺口：
 ① recomposeTargets 按**键**留旧行 ⇒ 换素材重做会多出一行同目标草稿（重复行）。
    改为按**目标**替换，文字也按目标继承。
 ② replaceMaterialKeepText 换键后旧行不会消失 ⇒ 返回 previousKey，并补 replaceDraftInBook。
 ③ 自检里的超上限样本用合法目标永远触不到上限（仓内只有 6 个目标），改用含未登记目标的 7 项。
"""
import io, sys

p = '/home/user/ruby-phone/config/creation-multi-draft.js'
s = io.open(p, encoding='utf-8').read()

# ── ① replaceMaterialKeepText：返回 previousKey ──
A_old = """    const nn = normalizeDraft(next);
    return nn.ok
        ? { ok: true, draft: nn.draft, reason: 'ok' }
        : { ok: false, draft: n.draft, reason: nn.reason };
}"""
A_new = """    const nn = normalizeDraft(next);
    /* previousKey 必给：换素材会改键，调用方需要知道该把**旧的哪一行**撤掉，
     * 否则草稿本里会留下一行同目标的旧稿（重复行）。 */
    return nn.ok
        ? { ok: true, draft: nn.draft, previousKey: n.draft.key, reason: 'ok' }
        : { ok: false, draft: n.draft, previousKey: n.draft.key, reason: nn.reason };
}
/**
 * 用一份新草稿替换草稿本里的**指定旧行**（按旧键撤、按新键存）。
 * 替图不丢文字只有这一条路：否则新旧两行会同时在，用户看到两份同一目标的稿。
 */
export function replaceDraftInBook(book, previousKey, draft) {
    const norm = normalizeDraftBook(book);
    const prev = String(previousKey || '');
    const without = prev ? norm.drafts.filter(function (d) { return d.key !== prev; }) : norm.drafts.slice();
    return upsertDraft(without, draft);
}"""

n = s.count(A_old)
if n != 1:
    print('FAIL ① 锚点 %d 次' % n); sys.exit(1)
s = s.replace(A_old, A_new)

# ── ② recomposeTargets：按目标替换 + 按目标继承 ──
B_old = """    const c = composeDrafts(source, materialId, uniq, opts);
    const redoneKeys = c.drafts.map(function (d) { return d.key; });
    const kept = norm.drafts.filter(function (d) { return redoneKeys.indexOf(d.key) < 0; });
    /* 重做的草稿要继承**同名键旧那份的文字**（只重做 = 素材换，不是文字丢）。 */
    const inherited = c.drafts.map(function (d) {
        const old = norm.drafts.filter(function (o) { return o.key === d.key; })[0];
        if (!old) return d;
        return Object.assign({}, d, { note: d.note || old.note, tags: d.tags.length ? d.tags : old.tags, version: old.version + 1 });
    });"""
B_new = """    const c = composeDrafts(source, materialId, uniq, opts);
    /* 按**目标**替换，不按键：换素材会改键，按键留旧行会多出一份同目标的旧稿。
     * 「仅重做所选段」的用户语义就是「这几个目标重来，其它别动」。 */
    const kept = norm.drafts.filter(function (d) { return uniq.indexOf(d.target) < 0; });
    /* 重做的草稿要继承**同目标旧那份的文字**（只重做 = 素材换，不是文字丢）。 */
    const inherited = c.drafts.map(function (d) {
        const old = norm.drafts.filter(function (o) { return o.target === d.target; })[0];
        if (!old) return d;
        return Object.assign({}, d, { note: d.note || old.note, tags: d.tags.length ? d.tags : old.tags, version: old.version + 1 });
    });"""

n = s.count(B_old)
if n != 1:
    print('FAIL ② 锚点 %d 次' % n); sys.exit(1)
s = s.replace(B_old, B_new)

# ── ③ 自检：超上限样本 + 新增两处断言 ──
C_old = "    if (composeDrafts('musicdesk', 't1', ['wechat', 'weibo', 'magazine', 'pixiv', 'doujin', 'lofter', 'weibo'], {}).reason.indexOf('too-many') !== 0) problems.push('超上限应拒（去重后 6 个含 lofter 仍不超；7 个才超）');"
C_new = """    if (composeDrafts('musicdesk', 't1', ['wechat', 'weibo', 'magazine', 'pixiv', 'doujin', 'lofter', 'weibo'], {}).ok !== true) problems.push('去重后 6 个目标（上限内）应可编排');
    if (composeDrafts('musicdesk', 't1', ['wechat', 'weibo', 'magazine', 'pixiv', 'doujin', 'lofter', 'nowhere'], {}).reason.indexOf('too-many') !== 0) problems.push('去重后 7 项（含未登记目标）应超上限被拒');"""

n = s.count(C_old)
if n != 1:
    print('FAIL ③ 锚点 %d 次' % n); sys.exit(1)
s = s.replace(C_old, C_new)

# 替图段加 previousKey / 替换入本断言
D_old = "    if (replaceMaterialKeepText(weibo, '', 'x').ok) problems.push('缺素材不得当作替图成功');"
D_new = """    if (replaceMaterialKeepText(weibo, '', 'x').ok) problems.push('缺素材不得当作替图成功');
    if (sw.ok && sw.previousKey !== weibo.key) problems.push('替图必须给出 previousKey（否则旧行撤不掉）');
    const rbook = replaceDraftInBook(c.drafts, sw.ok ? sw.previousKey : '', sw.ok ? sw.draft : weibo);
    if (rbook.drafts.length !== 2) problems.push('替图后草稿本应仍为 2 行（旧行撤掉、新行存入），实际 ' + String(rbook.drafts.length));
    if (rbook.drafts.filter(function (d) { return d.target === 'weibo'; }).length !== 1) problems.push('同一目标不得留两行（重复行）');"""

n = s.count(D_old)
if n != 1:
    print('FAIL ④ 锚点 %d 次' % n); sys.exit(1)
s = s.replace(D_old, D_new)

# 仅重做段断言更新（按目标替换后 kept=1、total=2，语义未变，但补一条「旧键行不得留下」）
E_old = "    if (rc.drafts.length !== 2) problems.push('重做后总数应仍为 2，实际 ' + String(rc.drafts.length));"
E_new = """    if (rc.drafts.length !== 2) problems.push('重做后总数应仍为 2，实际 ' + String(rc.drafts.length));
    if (rc.drafts.filter(function (d) { return d.target === 'weibo'; }).length !== 1) problems.push('重做后同一目标只得一行（换素材改键不得留旧行）');"""

n = s.count(E_old)
if n != 1:
    print('FAIL ⑤ 锚点 %d 次' % n); sys.exit(1)
s = s.replace(E_old, E_new)

# 导出清单补 replaceDraftInBook
F_old = "    replaceMaterialKeepText,\n    diffDrafts,"
F_new = "    replaceMaterialKeepText,\n    replaceDraftInBook,\n    diffDrafts,"
n = s.count(F_old)
if n != 1:
    print('FAIL ⑥ 锚点 %d 次' % n); sys.exit(1)
s = s.replace(F_old, F_new)

io.open(p, 'w', encoding='utf-8').write(s)
print('OK all six anchors patched')
