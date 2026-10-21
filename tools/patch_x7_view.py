#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""[v4.47.0 · R5-X7] 创作台视图补丁：假设试写双栏段 + 事件绑定。

三处改动（锚点必须恰中 1 次）：
  ① 在 `_board(vm)` 段之前插 `_hypo(vm)`（两栏并列 + 基线 + 逐栏决定）；
  ② `_html` 里把 `_hypo` 排在 `_board` 之后；
  ③ `_bind` 里加试写区的事件（种类按钮 / 输入框 / run / keep / adopt / discard / 选栏）。

用法：
    python3 tools/patch_x7_view.py            # dry-run
    python3 tools/patch_x7_view.py --write    # 落盘
"""
import sys
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = os.path.join(ROOT, "apps", "creationdesk", "creationdesk-view.js")

METHOD_ANCHOR = """    /** [v4.30.0 · R4-X9] 取材板段：选目标 → 预览取材集合 → 选定交给既有 owner。
     *   读不出时不摆条目行、也不画交接按钮（**不拿空板冒充**）。 */
    _board(vm) {
"""
METHOD_ADD = """    /** [v4.47.0 · R5-X7] 假设试写段：两栏并列 → 显式试写 → 逐栏决定（采纳 / 保留 / 丢弃）。
     *   ★ 界面**不写第二份文案表**：态与行文案全来自 App 出口（判据全在契约件）。
     *   ★ 两栏基线不同时，段头如实点出来 —— 「同基线才叫同一场景的两条岔路」。
     *   ★ 读不到时不画「采纳」按钮（**不拿空的两栏冒充可采纳**）。 */
    _hypo(vm) {
        const a = this.app;
        let h = '<div class="cwb-box cwb-hy"><h3>假设场景双栏试写（预演可丢弃 —— **不是既成结局**）</h3>';
        h += '<div class="cwb-note cwb-hy-line">' + esc(vm.hyLine || '') + '</div>';
        /* 基线：两栏都从哪一刻起。空值即清空，**不默认挑一个**。 */
        h += '<div class="cwb-acts">';
        h += '<input class="cwb-inp" data-cw-hy-baseline type="number" placeholder="基线时点(楼层号，留空=没给)" value="' + esc(vm.hyBaseline || '') + '">';
        h += '</div>';
        h += '<div class="cwb-note">基线是**两栏共同的起点**：同基线 ⇒ 差异来自假设本身；基线不同 ⇒ 差异里混着基线差</div>';
        const lanes = vm.hyLanes || {};
        for (const id of ['a', 'b']) {
            const l = lanes[id] || {};
            const on = (vm.hyPicked === id);
            h += '<div class="cwb-hy-lane' + (on ? ' cwb-hy-lane-on' : '') + '">';
            h += '<div class="cwb-hy-head"><span class="cwb-hy-name">' + esc(l.label || id) + '</span>'
                + '<span class="cwb-hy-state cwb-hy-st-' + esc(l.state || '') + '">'
                + esc(a.hyLaneStateLabel(l.state)) + '</span></div>';
            /* 假设种类：三种（接受 / 拒绝 / 自定义），**空值即清空，不回落成「接受」**。 */
            h += '<div class="cwb-acts">';
            for (const k of a.hyAssumeIds()) {
                const kon = (l.assume && l.assume.kind) === k;
                h += '<button class="cwb-tgt' + (kon ? ' cwb-tgt-on' : '') + '" data-cw-hy-kind="' + esc(k)
                    + '" data-cw-hy-lane="' + esc(id) + '">' + esc(a.hyAssumeLabel(k)) + '</button>';
            }
            h += '</div>';
            h += '<input class="cwb-inp" data-cw-hy-assume="' + esc(id) + '" type="text" placeholder="这一栏的假设（一句话）" value="'
                + esc((l.assume && l.assume.text) || '') + '">';
            h += '<textarea class="cwb-note-area" data-cw-hy-written="' + esc(id) + '" rows="4" placeholder="这一栏的试写文本（你写，或把既有生成通道的产出贴进来）">'
                + esc((l.assume && l.assume.written) || '') + '</textarea>';
            h += '<div class="cwb-note cwb-hy-row">' + esc(l.line || '') + '</div>';
            h += '<div class="cwb-acts">';
            h += '<button class="cwb-btn' + (on ? ' cwb-btn-on' : '') + '" data-cw-hy-pick="' + esc(id) + '">'
                + (on ? '已选中这一栏' : '选中这一栏') + '</button>';
            h += '</div></div>';
        }
        h += '<div class="cwb-note cwb-hy-cmp">可比性：' + esc(vm.hyCompareLabel || '') + '</div>';
        h += '<div class="cwb-acts">';
        h += '<button class="cwb-btn" data-cw-hy-act="run">显式试写（只落本机试写区）</button>';
        h += '<button class="cwb-btn" data-cw-hy-act="keep">把选中栏保留为草稿</button>';
        h += '<button class="cwb-btn" data-cw-hy-act="discard">丢弃这次预演（清临时选择）</button>';
        h += '</div>';
        /* ★ 采纳按钮**只在两栏齐备且选中了某栏时才画**：亮一个走不通的按钮比不亮更贵。 */
        const cmpOk = (vm.hyCompareLabel || '').indexOf('同基线') >= 0;
        if (vm.hyPicked && cmpOk) {
            h += '<div class="cwb-acts"><button class="cwb-btn cwb-btn-warn" data-cw-hy-act="adopt">'
                + esc(a.hyDecisionLabel('adopt')) + '（转交上游接续确认，本机不落卷）</button></div>';
        } else {
            h += '<div class="cwb-note">采纳按钮先不画：要**两栏同基线**且选中一栏（预演不是既成结局，采纳才建分支）</div>';
        }
        if (vm.hyFlash) {
            h += '<div class="cwb-flash' + (vm.hyFlashBad ? ' cwb-flash-bad' : '') + '">' + esc(vm.hyFlash) + '</div>';
        }
        h += '</div>';
        return h;
    }
    /** [v4.30.0 · R4-X9] 取材板段：选目标 → 预览取材集合 → 选定交给既有 owner。
     *   读不出时不摆条目行、也不画交接按钮（**不拿空板冒充**）。 */
    _board(vm) {
"""

HTML_ANCHOR = """        h += this._board(vm);
"""
HTML_ADD = """        h += this._board(vm);
        h += this._hypo(vm);
"""

BIND_ANCHOR = """        el.querySelectorAll('[data-cw-draft]').forEach(function (b) {
"""
BIND_ADD = """        /* [v4.47.0 · R5-X7] 假设试写区绑定：动作全转 app（视图不自己记、不落正史）。 */
        el.querySelectorAll('[data-cw-hy-kind]').forEach(function (b) {
            b.addEventListener('click', function () {
                const lane = b.getAttribute('data-cw-hy-lane');
                const kind = b.getAttribute('data-cw-hy-kind');
                /* 再点一次同一个 = 取消（**不回落成「接受」**）。 */
                const cur = self.app._hy && self.app._hy[lane] ? self.app._hy[lane].kind : '';
                self.app.hySetAssumeKind(lane, cur === kind ? '' : kind);
            });
        });
        el.querySelectorAll('[data-cw-hy-assume]').forEach(function (n) {
            n.addEventListener('input', function () { self.app.hySetAssumeText(n.getAttribute('data-cw-hy-assume'), n.value); });
        });
        el.querySelectorAll('[data-cw-hy-written]').forEach(function (n) {
            n.addEventListener('input', function () { self.app.hySetWritten(n.getAttribute('data-cw-hy-written'), n.value); });
        });
        const hyBase = el.querySelector('[data-cw-hy-baseline]');
        if (hyBase) hyBase.addEventListener('change', function () { self.app.hySetBaseline(hyBase.value); });
        el.querySelectorAll('[data-cw-hy-pick]').forEach(function (b) {
            b.addEventListener('click', function () { self.app.hyPick(b.getAttribute('data-cw-hy-pick')); });
        });
        el.querySelectorAll('[data-cw-hy-act]').forEach(function (b) {
            b.addEventListener('click', function () {
                const sub = b.getAttribute('data-cw-hy-act') || '';
                /* 丢弃与采纳各要一次显式确认（丢弃清临时选择、采纳要转上游）。 */
                if (sub === 'discard' && typeof window !== 'undefined' && typeof window.confirm === 'function') {
                    const ok = window.confirm('丢弃这次预演？\\n（只清本机的临时选择，正史一个字节都不会动）');
                    if (!ok) return;
                }
                Promise.resolve(self.app.hyAct(sub)).catch(function () { /* 回执在 app 层已如实落到 flash */ });
            });
        });
        el.querySelectorAll('[data-cw-draft]').forEach(function (b) {
"""

PATCHES = [
    ("methods", METHOD_ANCHOR, METHOD_ADD),
    ("html", HTML_ANCHOR, HTML_ADD),
    ("bind", BIND_ANCHOR, BIND_ADD),
]


def main():
    write = "--write" in sys.argv[1:]
    with open(TARGET, encoding="utf-8") as fh:
        src = fh.read()
    out = src
    for name, anchor, add in PATCHES:
        hits = out.count(anchor)
        if hits != 1:
            print("[FAIL] %s 锚点命中 %d 次（必须恰 1 次）" % (name, hits))
            return 1
        out = out.replace(anchor, add)
        print("[OK] %s 已应用" % name)
    if not write:
        print("dry-run：改动 %d 字节（加 --write 落盘）" % (len(out) - len(src)))
        return 0
    with open(TARGET, "w", encoding="utf-8") as fh:
        fh.write(out)
    print("已落盘：+%d 字节" % (len(out) - len(src)))
    return 0


if __name__ == "__main__":
    sys.exit(main())