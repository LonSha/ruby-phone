#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""[v4.01.0 · R3-O8] applyCreationdeskAction 加四个只动草稿本的新动作。"""
import io, sys

p = '/home/user/ruby-phone/index.js'
s = io.open(p, encoding='utf-8').read()

OLD = """            if (action === 'refresh') { refreshCreationdesk(); return { ok: true, note: '已刷新读数', kind: 'read' }; }
            const plan = cwPlanPublish("""

NEW = """            if (action === 'refresh') { refreshCreationdesk(); return { ok: true, note: '已刷新读数', kind: 'read' }; }
            /* ══════ [v4.01.0 · R3-O8] 四个只动草稿本的动作 ══════
             *   · 一律**不发布**：这四支里没有任何 owner 调用；
             *   · 落盘一律走 cwWriteDrafts（写后回读核对行数，读不回不算成功）；
             *   · 白名单动作在 refresh / plan / publish 之前分流，别无谓地搅动发布链。 */
            if (action === 'compose' || action === 'edit' || action === 'redo' || action === 'drop') {
                const bookRaw = cwReadDraftsRaw();
                const bookNorm = normalizeDraftBook(bookRaw);
                const ref = cwSplitRef(p.ref || '');
                const refTargets = Array.isArray(p.targets) ? p.targets : (target ? [target] : []);
                if (action === 'compose' || action === 'redo') {
                    if (!ref) return { ok: false, note: '素材引用不合法（应是 source:sourceId）：' + String(p.ref || ''), kind: 'bad-ref' };
                    if (!refTargets.length) return { ok: false, note: '还没选目标（至少一个）', kind: 'no-target' };
                    if (action === 'compose') {
                        const c = composeDrafts(ref.source, ref.materialId, refTargets, { note: String(p.note || ''), tags: p.tags, at: Date.now() });
                        if (!c.ok) {
                            return {
                                ok: false, kind: 'blocked',
                                note: (c.drafts.length ? '' : '没有可编排的目标') + (c.rejected.length ? ('；被拒：' + c.rejected.map(x => x.target + '(' + x.reason + ')').join(' / ')) : ''),
                                rejected: c.rejected,
                            };
                        }
                        let book = bookNorm.drafts;
                        for (const d of c.drafts) book = upsertDraft(book, d).drafts;
                        const w = cwWriteDrafts(book);
                        refreshCreationdesk();
                        return w.ok
                            ? { ok: true, kind: 'composed', note: '已编排 ' + String(c.drafts.length) + ' 份草稿（其余目标各自成稿，编辑互不覆盖）' + (c.rejected.length ? ('；被拒 ' + String(c.rejected.length) + ' 个') : ''), rejected: c.rejected, count: c.drafts.length }
                            : { ok: false, kind: w.reason, note: '草稿落盘失败（不得当作已保留）' };
                    }
                    const rc = recomposeTargets(bookNorm.drafts, refTargets, ref.source, ref.materialId, { note: String(p.note || ''), at: Date.now() });
                    const w = cwWriteDrafts(rc.drafts);
                    refreshCreationdesk();
                    return w.ok
                        ? { ok: true, kind: 'redone', note: '只重做 ' + String(rc.redone.length) + ' 份，其余 ' + String(rc.kept) + ' 份原样保留（文字也留着）', redone: rc.redone.length, kept: rc.kept }
                        : { ok: false, kind: w.reason, note: '草稿落盘失败（不得当作已保留）' };
                }
                /* edit / drop 都按**草稿键**定位那一份。 */
                const key = String(p.key || '').trim();
                if (!key) return { ok: false, note: '要先选一份草稿（缺 key）', kind: 'no-key' };
                const cur = bookNorm.drafts.filter(function (d) { return d.key === key; })[0];
                if (!cur) return { ok: false, note: '草稿本里没有这一份：' + key, kind: 'no-such-draft' };
                if (action === 'drop') {
                    const w = cwWriteDrafts(bookNorm.drafts.filter(function (d) { return d.key !== key; }));
                    refreshCreationdesk();
                    return w.ok ? { ok: true, kind: 'dropped', note: '已丢掉这一份（其余不动）' } : { ok: false, kind: w.reason, note: '草稿落盘失败' };
                }
                /* edit：改这一份的文案。若同时给了新的素材引用，则走「替图不丢文字」。 */
                let next = Object.assign({}, cur, {
                    note: (p.note === undefined ? cur.note : String(p.note || '')),
                    tags: (Array.isArray(p.tags) ? p.tags : cur.tags),
                    state: 'editing',
                    at: Date.now(),
                });
                let previousKey = '';
                if (ref && (ref.source !== cur.source || ref.materialId !== cur.materialId)) {
                    const r = replaceMaterialKeepText(cur, ref.source, ref.materialId);
                    if (!r.ok) return { ok: false, note: '替图失败：' + r.reason, kind: 'replace-failed' };
                    next = Object.assign({}, r.draft, { note: next.note, tags: next.tags, state: 'editing' });
                    previousKey = r.previousKey;
                }
                const w = previousKey ? replaceDraftInBook(bookNorm.drafts, previousKey, next) : upsertDraft(bookNorm.drafts, next);
                const ww = cwWriteDrafts(w.drafts);
                refreshCreationdesk();
                if (!ww.ok) return { ok: false, kind: ww.reason, note: '草稿落盘失败（不得当作已保存）' };
                const dOld = previousKey ? bookNorm.drafts.filter(function (d) { return d.key === previousKey; })[0] : cur;
                const dl = diffLine(diffDrafts(dOld, next));
                return { ok: true, kind: 'edited', note: '已保存这一份：' + dl, diff: dl, key: next.key };
            }
            const plan = cwPlanPublish("""

n = s.count(OLD)
if n != 1:
    print('FAIL 锚点 %d 次' % n); sys.exit(1)
s = s.replace(OLD, NEW)
io.open(p, 'w', encoding='utf-8').write(s)
print('OK actions patched')
