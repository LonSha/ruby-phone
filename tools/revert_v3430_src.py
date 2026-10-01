#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""revert_v3430_src.py — 回退 patch_v3430_src.py 第一跑的**部分落盘**。

原因：那一版脚本把每处编辑各自从**原始内容**出发算一遍、最后按文件写盘 ——
同一文件的多处编辑互相覆盖，只剩最后一处生效（本文件正是为此存在的）。
本脚本把三个受污染文件（data / app / view）各回退那一处**已生效**的编辑，
回到本轮开工前的干净基线；css 只列了一处编辑、已正确落盘，故不动。
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
NL = '\n'


def rd(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def back(rel, new, old, tag):
    src = rd(rel)
    n = src.count(new)
    assert n == 1, '[%s] 回退锚点必须恰中 1 次，实得 %d' % (tag, n)
    print('  回退 %-34s %s' % (tag, rel))
    if WRITE:
        with open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
            f.write(src.replace(new, old, 1))


D = 'apps/pvdesk/pvdesk-data.js'
A = 'apps/pvdesk/pvdesk-app.js'
V = 'apps/pvdesk/pvdesk-view.js'

print('== 回退清单 ==')
back(D,
     """    if (!anyStamp) {
        for (let i = 0; i < loose.length; i++) plain.push(loose[i].text);
        return { mode: 'untimed', timed: false, cues: [], dropped, lines: raw.length, plain };
    }
    /* 有标签的行在场 ⇒ 那几行没标签的就是坏行（逐条报，不静默丢）。 */
    for (let i = 0; i < loose.length; i++) {
        dropped.noTime.push({ line: loose[i].line, saw: loose[i].text.slice(0, 24), why: 'no_stamp' });
    }
    entries.sort(function (x, y) { return x.t - y.t; });""",
     """    if (!anyStamp) {
        return { mode: 'untimed', timed: false, cues: [], dropped, lines: raw.length, plain };
    }
    entries.sort(function (x, y) { return x.t - y.t; });""",
     'data.parseLrcText.noStamp')

back(A,
     """    clearBrief() {
        this._clearToDefaults();
        this._recompute();
        const wrote = this._persistBrief();
        this._persistShelf();
        this._receipt('clear', true, '', {});
        return Object.assign(this._savedOk(wrote), { ok: true });
    }""",
     """    clearBrief() {
        this._clearToDefaults();
        const wrote = this._persistBrief();
        this._receipt('clear', true, '', {});
        return Object.assign(this._savedOk(wrote), { ok: true });
    }""",
     'app.clearBrief.recompute')

back(V,
     """    refresh() {
        if (!this._root) return;
        this._root.className = 'pvd-root ' + this._tone(this.app.faceOf());
        this._root.innerHTML = this._buildHTML();""",
     """    refresh() {
        if (!this._root) return;
        this._root.innerHTML = this._buildHTML();""",
     'view.refresh.tone')

if not WRITE:
    print('（dry-run，未回退）')
    sys.exit(0)
print('已回退。')