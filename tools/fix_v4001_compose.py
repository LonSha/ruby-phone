#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""[v4.01.0] 修 composeDrafts 返包装对象（应为 .draft）—— 真缺陷，自检当场抓到。"""
import io, sys

p = '/home/user/ruby-phone/config/creation-multi-draft.js'
s = io.open(p, encoding='utf-8').read()

OLD = """        if (!r.valid) { rejected.push({ target: t, reason: String(r.reason) }); continue; }
        drafts.push(normalizeDraft({
            key: creationIdemKey(source, materialId, t),
            source: source, materialId: String(materialId || ''), target: t,
            note: String(p.note || o.note || ''),
            tags: Array.isArray(p.tags) ? p.tags : (Array.isArray(o.tags) ? o.tags : []),
            version: 1, state: 'ready', at: (typeof o.at === 'number') ? o.at : 0,
        }));
"""

NEW = """        if (!r.valid) { rejected.push({ target: t, reason: String(r.reason) }); continue; }
        /* 窄口归一；**必须取 .draft** —— 早期版本把包装对象 push 进去，
         * 于是草稿本里躺的是 {ok,reason,draft} 而不是草稿本身（本模块自检当场抓到）。 */
        const nd = normalizeDraft({
            key: creationIdemKey(source, materialId, t),
            source: source, materialId: String(materialId || ''), target: t,
            note: String(p.note || o.note || ''),
            tags: Array.isArray(p.tags) ? p.tags : (Array.isArray(o.tags) ? o.tags : []),
            version: 1, state: 'ready', at: (typeof o.at === 'number') ? o.at : 0,
        });
        if (!nd.ok) { rejected.push({ target: t, reason: 'normalize:' + nd.reason }); continue; }
        drafts.push(nd.draft);
"""

n = s.count(OLD)
if n != 1:
    print('FAIL 锚点命中 %d 次' % n)
    sys.exit(1)
s = s.replace(OLD, NEW)
io.open(p, 'w', encoding='utf-8').write(s)
print('OK composeDrafts fixed')
