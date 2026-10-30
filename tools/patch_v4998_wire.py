#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_v4998_wire.py — v4.99.8 收尾补丁：把两处「只定义不接线」的方法接进产品面。

现场（method-consumption-audit 在 v4.99.8 上实测 rc=1）：
    BackupdeskApp.previewShare   —— 公开方法名在全仓除声明行外零出现
    BackupdeskApp.markShareRead  —— 同上
两条都不是「可以删的存量债」，而是本版**自己做漏的接线**：
  · `_shareVm` 里另写了一遍 `sharePreviewOf(picked, viewer, Date.now())`，
    与 `previewShare` 是同一件事的两份实现（本仓最忌的「第二套口径」）；
  · `markShareRead`（记一次已读）**没有任何界面入口**，
    于是「撤回前已读 N 人」这句留痕在界面上永远是 0 人 —— 判据 F1 只走 App 直调，
    界面这条链一直没通，属「判据绿了但功能不在产品面上」。
本补丁两件事：
  ① `_shareVm` 改调 `this.previewShare(...)`，删掉 inline 的那份实现（顺手治重复口径）；
  ② 视图在收件人视角那一行给出「记他读过了」入口，并接 `markShareRead`。
"""
import io
import sys

ROOT = '/home/user/ruby-phone'
NL = chr(10)


def rd(p):
    with io.open(p, encoding='utf-8') as f:
        return f.read()


def wr(p, s):
    with io.open(p, 'w', encoding='utf-8') as f:
        f.write(s)


def once(src, old, new, tag):
    n = src.count(old)
    assert n == 1, ('anchor must hit exactly once: ' + tag, n)
    return src.replace(old, new, 1)


def main():
    APP = ROOT + '/apps/backupdesk/backupdesk-app.js'
    VIEW = ROOT + '/apps/backupdesk/backupdesk-view.js'
    app = rd(APP)
    view = rd(VIEW)

    # ── ① _shareVm 改调 previewShare（去掉 inline 的第二份实现） ──
    old_vm = (
        "        let preview = null;" + NL +
        "        if (picked && viewer) {" + NL +
        "            const p = sharePreviewOf(picked, viewer, Date.now());" + NL +
        "            preview = {" + NL +
        "                label: p.label," + NL +
        "                readable: p.readable," + NL +
        "                content: p.content," + NL +
        "                masked: p.masked," + NL +
        "                why: p.why," + NL +
        "                viewer: viewer," + NL +
        "            };" + NL
    )
    new_vm = (
        "        /* ★ 收件人视角只算一遍：走 `previewShare`（本 App 上那件事的唯一实现），" + NL +
        "         *   不在这里再调一遍 `sharePreviewOf` —— 那样「他会看到什么」就有两份口径，" + NL +
        "         *   且 `previewShare` 变成一条只给判据用的死方法。" + NL +
        "         */" + NL +
        "        let preview = null;" + NL +
        "        if (picked && viewer) {" + NL +
        "            const r = this.previewShare(picked.id, viewer);" + NL +
        "            const p = (r.preview) || {};" + NL +
        "            preview = {" + NL +
        "                label: r.ok ? p.label : (r.note || '')," + NL +
        "                readable: p.readable === true," + NL +
        "                content: p.content," + NL +
        "                masked: p.masked === true," + NL +
        "                why: p.why," + NL +
        "                viewer: viewer," + NL +
        "            };" + NL
    )
    app = once(app, old_vm, new_vm, '_shareVm inline preview')

    # ── previewShare 不再自己重绘：它是「算一份视角」，画由 _shareVm 负责 ──
    old_pv = (
        "    /** 收件人视角预览：**纯读**，不写盘、不记「已读」（读的是「他会看到什么」，不是「他读过了」）。 */" + NL
    )
    new_pv = (
        "    /**" + NL +
        "     * 收件人视角预览：**纯读**，不写盘、不记「已读」（读的是「他会看到什么」，不是「他读过了」）。" + NL +
        "     * 【它是这件事的唯一实现】`_shareVm` 画那一行时也从这里取 —— 若那边另调一次" + NL +
        "     *   `sharePreviewOf`，同一句话就有两份口径，改内核时要找两处。故本件**不自己重绘**：" + NL +
        "     *   只算数，画由调用点决定（`_shareVm` 里是渲染，视图动作里是回执）。" + NL +
        "     */" + NL
    )
    app = once(app, old_pv, new_pv, 'previewShare doc')

    app = once(app,
               "        const p = sharePreviewOf(draft, viewerId || this._shareViewer, Date.now());" + NL +
               "        this.render();" + NL +
               "        return { ok: p.ok, note: p.label, preview: p };",
               "        const p = sharePreviewOf(draft, viewerId || this._shareViewer, Date.now());" + NL +
               "        return { ok: p.ok, note: p.label, preview: p };",
               'previewShare drop render')

    # ── ② 视图：收件人视角那一行给出「记他读过了」入口 ──
    old_hear = (
        "            if (s.preview.readable) {" + NL +
        "                h += '<div class=\"bk-row bk-row-hear\"><span class=\"bk-row-k\">他会看到</span><span class=\"bk-row-v\">' + esc(s.preview.content || '') + '</span></div>';" + NL +
        "            }" + NL
    )
    new_hear = (
        "            if (s.preview.readable) {" + NL +
        "                h += '<div class=\"bk-row bk-row-hear\"><span class=\"bk-row-k\">他会看到</span><span class=\"bk-row-v\">' + esc(s.preview.content || '') + '</span></div>';" + NL +
        "                /* [v4.99.8 · R11-X4] 「记他读过了」是真写盘的一步（与预览分开）：" + NL +
        "                 *   没有这个入口，「撤回前已读 N 人」这句留痕在界面上永远是 0 人。" + NL +
        "                 */" + NL +
        "                h += '<button class=\"bk-chip\" data-bk-shareact=\"read\" data-bk-reader=\"' + esc(s.preview.viewer || '') + '\">记他读过了</button>';" + NL +
        "            }" + NL
    )
    view = once(view, old_hear, new_hear, 'view read button')

    old_act = (
        "                else if (act === 'revoke') self.app.revokeShare(id, '');" + NL
    )
    new_act = (
        "                else if (act === 'revoke') self.app.revokeShare(id, '');" + NL +
        "                else if (act === 'read') {" + NL +
        "                    /* 记一次已读：与「预览」是两步 —— 预览不替对方记账，这一步才记。 */" + NL +
        "                    self.app.markShareRead(id, b.getAttribute('data-bk-reader'));" + NL +
        "                }" + NL
    )
    view = once(view, old_act, new_act, 'view read action')

    wr(APP, app)
    wr(VIEW, view)
    print('[patch] app lines = %d / view lines = %d' % (len(app.split(NL)), len(view.split(NL))))
    print('[patch] previewShare 调用点: %d 处（含声明）' % app.count('previewShare'))
    print('[patch] markShareRead 调用点: %d 处（含声明）' % app.count('markShareRead'))
    print('[patch] 视图 markShareRead: %d 处' % view.count('markShareRead'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
