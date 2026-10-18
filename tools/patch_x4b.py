#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_x4b.py — [v4.28.0 · R4-X4 补丁 B] archive-view 第五页签

存档台第五页签「支线结局」（key=canon）：
  B1  TABS 数组加一格（**页签真源三处同步的第二处**：视图的可见页签）；
  B2  _buildHTML 加一条分派（少这一条 = 点了页签画空白页）；
  B3  新增三个面板方法（支线结局 / 冲突位 / 落卷与撤回），
      一律用 arc-* 既有类名，不新增样式；
  B4  _onAction 加三条动作分支（定这一位 / 清空选位 / 转交上游确认）。

【纪律】
  · 视图里**不写第二份状态判定词与标签表**：判定走 app.canonGate()，
    标签走 app.canonClashLabel/canonDecisionLabel/canonAdoptLabel/…；
  · 视图里不许出现反引号 / 反斜杠 / 正则字面量（H2 字符纪律）；
  · 零写盘：本页签的按钮不落任何字节，「转交确认」只把上游给的凭据派发出去。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
NL = chr(10)
VIEW = 'apps/archive/archive-view.js'


def rd(rel):
    with io.open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def wr(rel, s):
    with io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(s)


def once(s, old, new, tag):
    n = s.count(old)
    assert n == 1, '[%s] anchor must hit exactly 1, got %d' % (tag, n)
    return s.replace(old, new, 1)


# ------------------------------------------------------------------ B1
B1_OLD = u"""    { key: 'reset', label: '重置影响' },
    { key: 'ledger', label: '台账' }
];"""
B1_NEW = u"""    { key: 'reset', label: '重置影响' },
    { key: 'ledger', label: '台账' },
    /* [v4.28.0 · R4-X4] 支线结局：选哪条结果成为后续正史（**只读选择预览**，
     *   落卷与撤回归上游 owner）。 */
    { key: 'canon', label: '支线结局' }
];"""

# ------------------------------------------------------------------ B2
B2_OLD = u"""        else if (tab === 'reset') parts.push(this._resetPanel());
        else parts.push(this._ledgerPanel());"""
B2_NEW = u"""        else if (tab === 'reset') parts.push(this._resetPanel());
        else if (tab === 'canon') parts.push(this._canonPanel());
        else parts.push(this._ledgerPanel());"""

# ------------------------------------------------------------------ B3
B3_OLD = u"""    /* ---------- 台账页签 ---------- */
    _ledgerPanel() {"""
B3_NEW = u"""    /* ---------- [v4.28.0 · R4-X4] 支线结局页签 ----------
     *  【本页唯一的价值：把「读不到」与「没有冲突位」画成两句话】
     *   前者去查宿主装配，后者去聊一楼；合成一句，用户会一直修错的地方。
     *  判定词一律走 app.canonGate()（**视图不比状态字面量**：比了就会在内核
     *  改名那天静默走到「读到了」那一支）。 */
    _canonPanel() {
        const app = this.app;
        const p = app.canonPack();
        const st = p.state || {};
        const c = st.counts || {};
        const gate = app.canonGate(st);
        const parts = [];
        parts.push(this._sec('支线结局与接续',
            '两条互斥结局不许同时进新卷 —— 本件只读选择预览与撤销范围，落卷与撤回归上游'));
        parts.push(this._metricBlock([
            { k: '结局面', v: gate.readable ? '可读' : '读不出' },
            { k: '冲突位', v: String(c.clashes || 0) },
            { k: '待选', v: String(c.blocked || 0) },
            { k: '当前选位', v: p.slot ? p.slot : '（还没选）' }
        ]));
        if (!gate.readable) {
            parts.push('<div class="arc-empty">' + this._esc(gate.hint || '读不出') + '</div>');
            parts.push('<div class="arc-sec-note">' + this._esc(app.canonStateHint(gate.state)) + '</div>');
            parts.push('</div>');
            return parts.join('');
        }
        const lines = p.lines || {};
        parts.push(this._sec('四行读数', '每一态分开说 —— 合并任意两态都会误导「该去做什么」'));
        parts.push('<div class="arc-list">');
        parts.push(this._canonRow('结局', lines.canon));
        parts.push(this._canonRow('选择', lines.plan));
        parts.push(this._canonRow('落卷', lines.adopt));
        parts.push(this._canonRow('撤回', lines.revoke));
        parts.push('</div>');
        parts.push('</div>');
        parts.push(this._canonClashBlock(p));
        parts.push(this._canonAdoptBlock(p));
        parts.push(this._canonRevokeBlock(p));
        parts.push('<div class="arc-btns">');
        parts.push('<button class="arc-btn arc-btn-quiet" data-act="clear_canon_slot">清空选位（没选就不许交接）</button>');
        parts.push('<button class="arc-btn" data-act="canon_confirm">转交上游确认（本件零写盘）</button>');
        parts.push('</div>');
        parts.push('<div class="arc-sec-note">' + this._esc(app.canonNote(p.adopt) || '未选尽不许交接；选中后新卷只读选中结局，其余支线留痕供回看。') + '</div>');
        parts.push('</div>');
        return parts.join('');
    }
    /** 一行读数（键 + 值；值一律转内核给的整句，视图不重拼）。 */
    _canonRow(k, v) {
        return '<div class="arc-list-row"><span class="arc-list-k">' + this._esc(k) + '</span>'
            + '<span class="arc-list-v">' + this._esc(v == null ? DASH : v) + '</span></div>';
    }
    /** 冲突位逐位列举（**只列举，不替用户判定哪条结局更好**）。 */
    _canonClashBlock(p) {
        const app = this.app;
        const st = p.state || {};
        const rows = Array.isArray(st.clash) ? st.clash : [];
        const parts = [];
        parts.push(this._sec('冲突位 ' + String(rows.length) + ' 个',
            '「两条终结声明」与「取值不同」不同形 —— 选中的成为正史，其余留痕'));
        if (!rows.length) {
            parts.push('<div class="arc-empty">这批结局里没有冲突位。</div>');
            parts.push('</div>');
            return parts.join('');
        }
        parts.push('<div class="arc-list">');
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            const on = (p.slot && p.slot === r.key);
            parts.push('<div class="arc-list-row arc-pick' + (on ? ' on' : '') + '">');
            parts.push('<span class="arc-list-k">' + this._esc(r.key) + '</span>');
            parts.push('<span class="arc-list-v">' + this._esc(app.canonClashLabel(r.verdict))
                + '　当前：' + this._esc(app.canonDecisionLabel(r.decision))
                + '　支线 ' + this._esc(String((r.branches || []).length))
                + (r.terminalCount ? '　终结声明 ' + this._esc(String(r.terminalCount)) : '')
                + (r.branch ? '　选中：' + this._esc(r.branch) : '') + '</span>');
            parts.push('<button class="arc-btn' + (on ? ' arc-btn-quiet' : '') + '" data-act="pick_canon_slot" data-key="'
                + this._esc(r.key) + '">' + (on ? '已选这一位' : '定这一位') + '</button>');
            parts.push('</div>');
        }
        parts.push('</div>');
        parts.push('<div class="arc-sec-note">本件不自动判定哪条故事更好；选位只记在内存里，重开会话即清空。</div>');
        parts.push('</div>');
        return parts.join('');
    }
    /** 落卷面（★ 三态**不许压平**：可接 / 待选尽 / 无可接条目）。 */
    _canonAdoptBlock(p) {
        const app = this.app;
        const ad = p.adopt || {};
        const c = ad.counts || {};
        const items = Array.isArray(ad.items) ? ad.items : [];
        const unmapped = Array.isArray(ad.unmapped) ? ad.unmapped : [];
        const bare = Array.isArray(ad.bareOutcomes) ? ad.bareOutcomes : [];
        const parts = [];
        parts.push(this._sec('接续落卷', '「还没选完」与「选了也没条文可接」不同形 —— 前者回去选，后者去补条文'));
        parts.push('<div class="arc-list">');
        parts.push(this._canonRow('落卷口径', app.canonAdoptLabel(ad.verdict)));
        parts.push(this._canonRow('可接条目', String(c.total || 0)));
        parts.push(this._canonRow('幂等键', ad.adoptionId ? ad.adoptionId : '（还没有）'));
        parts.push(this._canonRow('目标卷', ad.volumeId ? ad.volumeId : '（还没定）'));
        parts.push('</div>');
        if (items.length) {
            parts.push('<div class="arc-table">');
            parts.push('<div class="arc-tr arc-th"><span class="arc-td-name">来源</span>'
                + '<span class="arc-td-shape">条目</span><span class="arc-td-rows">楼</span></div>');
            for (let i = 0; i < items.length; i++) {
                const it = items[i];
                parts.push('<div class="arc-tr">');
                parts.push('<span class="arc-td-name">' + this._esc(app.canonProvLabel(it.source)) + '</span>');
                parts.push('<span class="arc-td-shape">' + this._esc(it.face) + '　' + this._esc(it.key)
                    + (it.valueText ? '　' + this._esc(it.valueText) : '') + '</span>');
                parts.push('<span class="arc-td-rows">' + this._esc(this._meter(it.from)) + '</span>');
                parts.push('</div>');
            }
            parts.push('</div>');
        } else {
            parts.push('<div class="arc-empty">这份选择还没有可接条目。</div>');
        }
        if (unmapped.length) {
            parts.push('<div class="arc-sec-note">缺格 ' + String(unmapped.length) + ' 条（三因分列：压成一条就不知道该补哪一格）</div>');
            parts.push('<div class="arc-list">');
            for (let i = 0; i < unmapped.length; i++) {
                const u = unmapped[i];
                parts.push(this._canonRow(u.key, app.canonUnmappedLabel(u.why)
                    + (u.ownerKey ? '　主人 ' + u.ownerKey : '　主人（缺）')
                    + (u.face ? '　面 ' + u.face : '　面（缺）')));
            }
            parts.push('</div>');
        }
        if (bare.length) {
            parts.push('<div class="arc-sec-note">选中结局里没带条文的 ' + String(bare.length) + ' 条（**不是**「还没选完」）</div>');
            parts.push('<div class="arc-list">');
            for (let i = 0; i < bare.length; i++) {
                const b = bare[i];
                parts.push(this._canonRow(b.key, (b.title || '') + '　' + b.why + '　支线 ' + b.branch));
            }
            parts.push('</div>');
        }
        parts.push('</div>');
        return parts.join('');
    }
    /** 撤回面（四张表**逐格报出** + 两条口径写成读数）。 */
    _canonRevokeBlock(p) {
        const app = this.app;
        const rg = p.revoke || {};
        const rv = rg.revoke || {};
        const parts = [];
        parts.push(this._sec('撤回会动到哪些', '四张表分列 —— 只报可撤数，用户就以为撤回会清空这一片'));
        parts.push('<div class="arc-list">');
        parts.push(this._canonRow('本次接续', rv.scope && rv.scope.adoptionId ? rv.scope.adoptionId : '（没有凭据）'));
        const buckets = [
            ['可撤', rv.revocable],
            ['别批（别人接的）', rv.keptForeign],
            ['手工补的（绝不动）', rv.keptManual],
            ['后来加的', rv.keptLater]
        ];
        for (let i = 0; i < buckets.length; i++) {
            const list = Array.isArray(buckets[i][1]) ? buckets[i][1] : [];
            parts.push(this._canonRow(buckets[i][0], String(list.length)));
            for (let j = 0; j < list.length; j++) {
                const it = list[j];
                parts.push(this._canonRow('　' + it.key, it.face + '　' + (it.why || '') + (it.ownerKey ? '　主人 ' + it.ownerKey : '')));
            }
        }
        parts.push('</div>');
        parts.push('<div class="arc-sec-note">手工补的事实' + (rv.deletesManual ? '会被删（异常）' : '绝不删')
            + '；原分支零写 ' + String(rv.branchWrites || 0) + ' —— 撤回只撤本次接续，原分支原文不变。</div>');
        parts.push('</div>');
        return parts.join('');
    }
    /* ---------- 台账页签 ---------- */
    _ledgerPanel() {"""

# ------------------------------------------------------------------ B4
B4_OLD = u"""        } else if (a === 'clear_ledger') {
            const r = app.clearLedger();
            this._flash = '清掉 ' + String(r.cleared) + ' 条（本件自己的台账）。';
        }"""
B4_NEW = u"""        } else if (a === 'clear_ledger') {
            const r = app.clearLedger();
            this._flash = '清掉 ' + String(r.cleared) + ' 条（本件自己的台账）。';
        } else if (a === 'pick_canon_slot') {
            /* [v4.28.0 · R4-X4] 选位只记在内存里（**不落盘**）—— 故播报不许说「已保存」。 */
            const key = app.setCanonSlot(el.getAttribute('data-key'));
            this._flash = key ? ('已选冲突位：' + key + ' —— 还没定，定完才谈交接。') : '选位没记上。';
        } else if (a === 'clear_canon_slot') {
            app.setCanonSlot('');
            this._flash = '已清空选位 —— 没选就不许交接（不拿半份选择去接续）。';
        } else if (a === 'canon_confirm') {
            /* ★ 落卷与撤回归上游 owner：本件只把上游给的凭据**原样**派发出去，
             *   自己一个字节都不写。凭据没定就不派发（不拿「空范围」去确认）。 */
            const ad = app.canonPack().adoption || {};
            const aid = ad.adoptionId || '';
            if (!aid) {
                this._flash = '还没有落卷凭据 —— 先把冲突位选尽。';
            } else {
                const win = (() => {
                    try { return (typeof window !== 'undefined') ? window : globalThis; }
                    catch (_e) { return globalThis; }
                })();
                try {
                    win.dispatchEvent(new win.CustomEvent('phone:canonAdopt', {
                        detail: { adoptionId: aid, packId: ad.packId || null, volumeId: ad.volumeId || null }
                    }));
                    this._flash = '已转交上游确认：' + aid + '（本件零写盘，重复确认不会重复接续）。';
                } catch (_e) {
                    this._flash = '宿主没接确认口 —— 凭据：' + aid + '（本件不代写）。';
                }
            }
        }"""


def main():
    s = rd(VIEW)
    s = once(s, B1_OLD, B1_NEW, 'TABS')
    s = once(s, B2_OLD, B2_NEW, 'buildHTML')
    s = once(s, B3_OLD, B3_NEW, 'canonPanel')
    s = once(s, B4_OLD, B4_NEW, 'onAction')
    if not WRITE:
        print('--- DRY RUN (pass --write) ---')
        return 0
    wr(VIEW, s)
    print('--- WRITTEN B ---')
    return 0


if __name__ == '__main__':
    sys.exit(main())
