#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_v4998_wire2.py — v4.99.8 收尾补丁（第二段）。

第一段（tools/patch_v4998_wire.py 落盘前的那次等价操作）已完成：
  · `previewShare` 的注释改成「它是这件事的唯一实现」；
  · `previewShare` 不再自己 `this.render()`。
本段做剩下两件（method-consumption-audit 在 v4.99.8 上点名的那两条）：
  ① `_shareVm` 改调 `this.previewShare(...)` —— 此前那里另写了一遍
     `sharePreviewOf(picked, viewer, Date.now())`，与 `previewShare` 是同一件事的两份实现；
     `previewShare` 因此变成「只有判据在调」的死方法（门禁 rc=1）。
  ② 视图在「他会看到」那一行给出「记他读过了」入口 → `markShareRead`。
     此前 `markShareRead` 产品面零调用，于是「撤回前已读 N 人」永远是 0 人。
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
        "        /* ★ 收件人视角只算一遍：走 `previewShare`（本 App 上那件事的唯一实现）。" + NL +
        "         *   这里若再调一次 `sharePreviewOf`，「他会看到什么」就有两份口径，" + NL +
        "         *   且 `previewShare` 退化成只给判据用的死方法（method-audit 会点名）。" + NL +
        "         */" + NL +
        "        let preview = null;" + NL +
        "        if (picked && viewer) {" + NL +
        "            const r = this.previewShare(picked.id, viewer);" + NL +
        "            const p = r.preview || {};" + NL +
        "            preview = {" + NL +
        "                label: r.ok ? p.label : String(r.note || '')," + NL +
        "                readable: p.readable === true," + NL +
        "                content: p.content," + NL +
        "                masked: p.masked === true," + NL +
        "                why: p.why," + NL +
        "                viewer: viewer," + NL +
        "            };" + NL
    )
    app = once(app, old_vm, new_vm, '_shareVm inline preview')

    old_hear = (
        "            if (s.preview.readable) {" + NL +
        "                h += '<div class=\"bk-row bk-row-hear\"><span class=\"bk-row-k\">他会看到</span><span class=\"bk-row-v\">' + esc(s.preview.content || '') + '</span></div>';" + NL +
        "            }" + NL
    )
    new_hear = (
        "            if (s.preview.readable) {" + NL +
        "                h += '<div class=\"bk-row bk-row-hear\"><span class=\"bk-row-k\">他会看到</span><span class=\"bk-row-v\">' + esc(s.preview.content || '') + '</span></div>';" + NL +
        "                /* [v4.99.8 · R11-X4] 「记他读过了」是真写盘的一步，与「看他会看到什么」分开：" + NL +
        "                 *   没有这个入口，「撤回前已读 N 人」这句留痕在界面上永远是 0 人。" + NL +
        "                 */" + NL +
        "                h += '<button class=\"bk-chip\" data-bk-shareact=\"read\" data-bk-share=\"' + esc(s.pick || '') + '\" data-bk-reader=\"' + esc(s.preview.viewer || '') + '\">记他读过了</button>';" + NL +
        "            }" + NL
    )
    view = once(view, old_hear, new_hear, 'view read button')

    old_act = (
        "                else if (act === 'revoke') self.app.revokeShare(id, '');" + NL
    )
    new_act = (
        "                else if (act === 'revoke') self.app.revokeShare(id, '');" + NL +
        "                else if (act === 'read') {" + NL +
        "                    /* 记一次已读：预览不替对方记账，这一步才记（会写盘）。 */" + NL +
        "                    self.app.markShareRead(id, b.getAttribute('data-bk-reader'));" + NL +
        "                }" + NL
    )
    view = once(view, old_act, new_act, 'view read action')

    wr(APP, app)
    wr(VIEW, view)
    print('[patch2] app lines = %d / view lines = %d' % (len(app.split(NL)), len(view.split(NL))))
    print('[patch2] app: previewShare 出现 %d / markShareRead 出现 %d'
          % (app.count('previewShare'), app.count('markShareRead')))
    print('[patch2] view: markShareRead 出现 %d / sharePreviewOf 出现 %d'
          % (view.count('markShareRead'), view.count('sharePreviewOf')))
    return 0


if __name__ == '__main__':
    sys.exit(main())