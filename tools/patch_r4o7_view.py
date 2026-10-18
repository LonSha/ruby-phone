#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_r4o7_view.py — [v4.19.0 · R4-O7] 通知中心按「事情」收拢 + 静音入口。

四处(每处锚点必须恰中一次):
  1 import `config/notice-digest.js`;
  2 渲染:`_visibleRows` 之后经 `digestOf` 收拢,**按组渲染**(组头 + 代表条 + 条数 + 跨 App 标记),
     组内多于一条时给「展开/收起」;
  3 组头的静音按钮(静音**只影响打断,不删消息**);静音规则存视图实例态(本版不做持久化 ——
     计划原文只要求「静音后历史仍在」与「按 App/联系人静音」,持久化属后续增量,如实留白);
  4 代表条点击直达(`groupRefsOf` 的 leadId)。

纪律:
  · **不重造通知中心**:既有行渲染 `_row` 一字未动,只在其上加一层分组;
  · 点开展开组时仍用 `_row`(行渲染口径只有一份实现);
  · 未读与详情对应:`unread` 按组算,代表条的 read 态决定整组的未读外观。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REL = 'apps/notifications/notification-center-view.js'

IMP_ANCHOR = "'use strict';"
IMP_NEW = ("'use strict';\n"
           "/* [v4.19.0 \u00b7 R4-O7] \u901a\u77e5\u6309\u300c\u4e8b\u60c5\u300d\u6536\u62e2(\u7eaf\u51fd\u6570)\u3002\n"
           " *   \u4e3a\u4ec0\u4e48\u8981\u6709\u8fd9\u4e00\u5c42:\u65e2\u6709\u843d\u8d26\u5c42\u53ea\u6709**\u540c senderKey \u4e14 3 \u5206\u949f\u5185**\u4e00\u9053\u5408\u5e76,\n"
           " *   \u800c\u8ba1\u5212\u539f\u6587\u70b9\u540d\u7684\u7f3a\u53e3\u662f\u300c\u540c\u4e00\u53d1\u9001\u8005\u7684\u4e0d\u540c\u4e8b\u4ef6\u4e0e\u540c\u4e00\u4e8b\u4ef6\u7684\u591a\u6b21\u66f4\u65b0\u7f3a\u5c11\u9762\u5411\u7528\u6237\u7684\u6574\u7406\u65b9\u5f0f\u300d\u3002 */\n"
           "import {\n"
           "    ND_GROUP_STATES, digestOf, digestLine, mutedOf, groupRefsOf, normalizeMuteRule\n"
           "} from '../../config/notice-digest.js';")

# 锚点**避开那行注释里的全角分号**(U+FF1B):只用真代码两行做锚。
CONSTRUCTOR_ANCHOR = """        this._keyword = '';
        this._flash = '';"""
CONSTRUCTOR_NEW = """        this._keyword = '';
        this._flash = '';
        /* [v4.19.0 \u00b7 R4-O7] \u6536\u62e2\u6001:\u5c55\u5f00\u8fc7\u7684\u4e8b\u60c5\u5206\u7ec4(\u952e = \u4e8b\u60c5\u8eab\u4efd);
         *   \u9759\u97f3\u89c4\u5219\u8868(**\u5b9e\u4f8b\u6001**;\u672c\u7248\u4e0d\u505a\u6301\u4e45\u5316 \u2014\u2014 \u5982\u5b9e\u7559\u767d,\u89c1\u6863\u5934)\u3002 */
        this._expanded = new Set();
        this._mutes = [];"""

RENDER_ANCHOR = """            <div class="nc-list">${rows.length ? rows.map(n => this._row(n)).join('') : this._empty()}</div>"""
RENDER_NEW = """            <div class="nc-list">${this._listHtml(rows)}</div>"""

# 新方法:插在 _row 之前
NEW_FNS = """    /* ================= [v4.19.0 · R4-O7] 按「事情」收拢 ================= */
    /**
     * 列表体:先经 `digestOf` 收拢,再**按组渲染**。
     *   · 组只有一条 ⇒ 直接用它那一行(与既有观感一致,不额外加壳);
     *   · 组多于一条 ⇒ 组头(代表条 + 条数 + 跨 App 标记 + 静音钮)+ 展开后的成员行。
     *   ★ 行渲染口径只有一份:`_row`(本层不重写行)。
     */
    _listHtml(rows) {
        if (!rows.length) return this._empty();
        const d = digestOf(rows);
        if (!d.ok) return this._empty();
        this._lastDigest = d;
        const parts = d.groups.map((g) => {
            if (g.count <= 1) return this._row(g.lead);
            return this._groupHtml(g);
        });
        const line = '<div class="nc-digest-line">' + esc(digestLine(d)) + '</div>';
        return line + parts.join('');
    }
    /** 一个「事情」组:**组头 + (展开时)成员行**。 */
    _groupHtml(g) {
        const lead = g.lead || {};
        const refs = groupRefsOf(g);
        const open = this._expanded.has(g.key);
        const unreadCls = g.unread > 0 ? ' nc-unread' : '';
        const appTag = APP_LABEL[lead.appId] || lead.appId || '系统';
        const why = g.state === ND_GROUP_STATES.EVENT
            ? ('同一件事 ×' + g.count)
            : ('同一来源 ×' + g.count + '(缺事件 ID,按来源兜底)');
        const cross = g.spansApps ? '<span class="nc-apptag nc-cross">跨 App 同一件事</span>' : '';
        const muted = this._isMuted(lead);
        const body = open
            ? '<div class="nc-group-body">' + g.ids.map((id) => {
                const n = this._byId(id);
                return n ? this._row(n) : '';
            }).join('') + '</div>'
            : '';
        return `<div class="nc-group${unreadCls}" data-gkey="${esc(g.key)}">
            <div class="nc-group-head nc-jumpable" data-lead="${esc(refs.leadId)}" data-app="${esc(lead.appId || '')}">
                <div class="nc-group-ico"><i class="fa-solid fa-layer-group"></i></div>
                <div class="nc-group-t1">
                    <span class="nc-name">${esc(lead.title || '')}</span>
                    <span class="nc-count">${esc(why)}</span>
                    ${cross}
                    ${muted ? '<span class="nc-apptag nc-muted">已静音(仅不打扰)</span>' : ''}
                </div>
                <div class="nc-group-t2">${esc(lead.message || '')}</div>
                <button class="nc-ac-btn nc-group-toggle" data-toggle="${esc(g.key)}">${open ? '收起' : '展开 ' + g.count}</button>
                <button class="nc-ac-btn nc-group-mute" data-mute="${esc(lead.appId || '')}">${muted ? '取消静音' : '静音此 App'}</button>
            </div>
            ${body}
        </div>`;
    }
    /** 按 id 取一条(**只读**:从当前可见行里找;找不到如实返回 null,不补空壳)。 */
    _byId(id) {
        const key = String(id || '');
        try {
            return (this.app.log.list() || []).find((n) => String(n.id) === key) || null;
        } catch (_e) { return null; }
    }
    /** 该条是否被静音(**只读**,不改任何东西)。 */
    _isMuted(rec) {
        try { return mutedOf(rec, this._mutes).muted; } catch (_e) { return false; }
    }
    /** 静音 / 取消静音(**只影响打断,不删消息**)。 */
    _toggleMute(appId) {
        const v = String(appId || '').trim();
        if (!v) { this._flash = '这条通知没有来源 App,没法按 App 静音'; return false; }
        const rule = normalizeMuteRule({ appId: v });
        if (!rule.ok) { this._flash = '静音规则不成立(' + rule.reason + ')'; return false; }
        const at = this._mutes.findIndex((r) => r && r.dim === 'appId' && r.value === v);
        if (at >= 0) {
            this._mutes.splice(at, 1);
            this._flash = '已取消静音:' + (APP_LABEL[v] || v) + '(历史一条没少)';
            return true;
        }
        this._mutes.push({ dim: 'appId', value: v });
        this._flash = '已静音:' + (APP_LABEL[v] || v) + '(只是不再打断,历史仍留在这里)';
        return true;
    }
    _row(n) {"""


def patch(rel, pairs):
    p = os.path.join(ROOT, rel)
    s = io.open(p, encoding='utf-8').read()
    for i, (a, b) in enumerate(pairs):
        n = s.count(a)
        assert n == 1, '[%s] anchor %d must hit exactly 1, got %d' % (rel, i, n)
        s = s.replace(a, b, 1)
    io.open(p, 'w', encoding='utf-8').write(s)
    print('patched ' + rel)


# 事件绑定:插在既有 read-all 绑定之后
BIND_ANCHOR = """        root.querySelector('#nc-read-all')?.addEventListener('click', () => {"""
BIND_NEW = """        /* [v4.19.0 · R4-O7] 组头三件事:展开/收起、静音、点代表条直达。 */
        root.querySelectorAll('.nc-group-toggle').forEach((b) => {
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                const k = String(b.dataset.toggle || '');
                if (!k) return;
                if (this._expanded.has(k)) this._expanded.delete(k); else this._expanded.add(k);
                this.render();
            });
        });
        root.querySelectorAll('.nc-group-mute').forEach((b) => {
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this._toggleMute(b.dataset.mute)) this.render();
                else this.render();
            });
        });
        root.querySelector('#nc-read-all')?.addEventListener('click', () => {"""


def main():
    patch(REL, [
        (IMP_ANCHOR, IMP_NEW),
        (CONSTRUCTOR_ANCHOR, CONSTRUCTOR_NEW),
        (RENDER_ANCHOR, RENDER_NEW),
        ("    _row(n) {", NEW_FNS),
        (BIND_ANCHOR, BIND_NEW),
    ])
    return 0


if __name__ == '__main__':
    sys.exit(main())