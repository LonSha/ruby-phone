#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""[v4.01.0] creationdesk app 层接线（行定位版，锚点歧义时用唯一行号定位）。"""
import io, sys

p = '/home/user/ruby-phone/apps/creationdesk/creationdesk-app.js'
lines = io.open(p, encoding='utf-8').read().split('\n')

ctor = [k for k, L in enumerate(lines) if L.strip() == 'this._sensitive = false;' and k < 40]
if len(ctor) != 1:
    print('FAIL ctor %r' % ctor); sys.exit(1)
i = ctor[0]
if lines[i + 1].strip() != "this._note = '';":
    print('FAIL ctor ctx %r' % lines[i + 1]); sys.exit(1)
lines.insert(i + 2, "        this._draftKey = '';\n        this._draftNote = '';\n        this._multiTargets = [];")

sn = [k for k, L in enumerate(lines) if L.strip() == 'setNote(note) { this._note = String(note || \'\'); return this._note; }']
if len(sn) != 1:
    print('FAIL setNote %r' % sn); sys.exit(1)
j = sn[0]
newapi = '''    /* ---------- [v4.01.0 · R3-O8] 草稿本交互 ---------- */
    /** 选中一份草稿：同时把它的文案装进编辑框（用户看到的就是这一份的文字）。 */
    setDraft(key) {
        this._draftKey = String(key || '');
        const d = this._draftOf(this._draftKey);
        this._draftNote = d ? d.note : '';
        this.render();
        return this._draftKey;
    }
    setDraftNote(note) { this._draftNote = String(note || ''); return this._draftNote; }
    /** 多目标勾选：一个目标一份稿，勾几个就编排几份（**不互覆盖**）。 */
    toggleMultiTarget(t) {
        const v = String(t || '').trim();
        if (!v) return this._multiTargets.slice();
        const i = this._multiTargets.indexOf(v);
        if (i >= 0) this._multiTargets.splice(i, 1);
        else this._multiTargets.push(v);
        this.render();
        return this._multiTargets.slice();
    }
    _draftOf(key) {
        const host = this.host();
        const items = (host && host.drafts && host.drafts.items) || [];
        for (const d of items) if (d.key === String(key || '')) return d;
        return null;
    }
    /** 四个草稿动作统一入口（视图只调这个，不直连咽喉）。 */
    async draftAct(action) {
        const vp = (typeof window !== 'undefined') ? window.VirtualPhone : null;
        if (!vp || typeof vp.applyCreationdeskAction !== 'function') {
            this._flash = '创作工作台入口不在位（咽喉未就绪）';
            this._flashBad = true;
            this.render();
            return { ok: false, note: this._flash };
        }
        const face = this._displayedFace;
        const payload = {
            action: action,
            ref: this._pickRef,
            target: this._target,
            targets: this._multiTargets.slice(),
            key: this._draftKey,
            note: this._draftNote,
            scope: face && face.scope,
            token: face && face.token,
        };
        let r;
        try { r = await vp.applyCreationdeskAction(payload); }
        catch (e) { r = { ok: false, note: '执行失败：' + String(e.message || e) }; }
        const now = this.host();
        if (now && (now.token !== payload.token)) return r;
        this._flash = String((r && r.note) || '');
        this._flashBad = !(r && r.ok === true);
        if (r && r.ok === true && r.key) this._draftKey = String(r.key);
        this.render();
        return r;
    }'''
lines.insert(j + 1, newapi)

vm = [k for k, L in enumerate(lines) if L.strip() == 'selfCheck: self,']
if len(vm) != 1:
    print('FAIL vm %r' % vm); sys.exit(1)
lines.insert(vm[0] + 1, '''            drafts: (host && host.drafts) || { readable: false, items: [], dropped: 0, limit: 0 },
            draftsText: (host && host.draftsText) || '草稿本**读不到**（不是「没草稿」）',
            multiSelfCheck: (host && host.multiSelfCheck) || null,
            draftKey: this._draftKey,
            draftNote: this._draftNote,
            multiTargets: this._multiTargets.slice(),''')

oc = [k for k, L in enumerate(lines) if L.strip() == "this._note = '';" and k > 100]
if len(oc) != 1:
    print('FAIL onchat %r' % oc); sys.exit(1)
lines.insert(oc[0] + 1, "        this._draftKey = '';\n        this._draftNote = '';\n        this._multiTargets = [];")

io.open(p, 'w', encoding='utf-8').write('\n'.join(lines))
print('OK desk app patched')
