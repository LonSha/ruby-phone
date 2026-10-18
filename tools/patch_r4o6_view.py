#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_r4o6_view.py — [v4.18.0 · R4-O6] 阅读视图接**段落邻域窗口** + 精确进度(段落锚点)。

四处(每处锚点必须恰中一次):
  1 import `paraWindowOf` / `anchorOf`;
  2 `_renderReader` 渲染**邻域切片**(默认 ≤250 段),而不是整章 `paras.map`;
  3 进度:保存**段落锚点**(`para`),加载时按它切窗口(首/中/末三处刷新回到同段);
  4 `_bind`:滚到底/顶时扩窗口(`showMoreParas`),并在滚动时记锚点(节流)。

纪律:
  · **不截掉长章**(验收原文逐字禁止「以截掉长章代替分页」):切片是**窗口**,两头都能扩;
  · 摘录仍读**全章**数组(`book.chapters[cur].paragraphs[Number(p.dataset.para)]`),
    切片只影响「交给渲染的段」,不影响段身份;
  · 进度字段沿用既有 `ruby_reading_progress_<bookId>` 键,只**加一格** `para`(不改键名)。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REL = 'apps/reading/reading-view.js'

IMP_ANCHOR = "import { L0_ASSETS } from '../../config/l0-assets.js';"
IMP_NEW = (IMP_ANCHOR + "\n"
           "/* [v4.18.0 \u00b7 R4-O6] \u6bb5\u843d\u90bb\u57df\u7a97\u53e3(\u4e2d\u6bb5\u5207\u7247)\u3002\n"
           " *   \u4e3a\u4ec0\u4e48\u4e0d\u80fd\u7528\u5df2\u6709\u4e24\u652f:`windowOf` \u5934\u90e8\u5207\u3001`tailWindowOf` \u5c3e\u90e8\u5207,\n"
           " *   \u800c\u300c\u8bfb\u8005\u505c\u5728\u7b2c N \u6bb5\u300d\u8981\u770b\u7684\u662f**\u5b83\u524d\u540e\u5404 R \u6bb5** \u2014\u2014 \u4e2d\u6bb5\u3002 */\n"
           "import { paraWindowOf, anchorOf, paraLine } from '../../config/list-window.js';")

# 锚点分两处替换(整行锚点会带上尾部那处**全角括号**,照 ASCII 写必零命中)。
# A:在 `const paras = ...` 之后插入窗口计算;B:把「整章 map」换成「窗口 map」。
RENDER_ANCHOR = "        const paras = ch.paragraphs || [];\n"
RENDER_NEW = ("        const paras = ch.paragraphs || [];\n"
              "        /* [v4.18.0 \u00b7 R4-O6] **\u53ea\u6e32\u67d3\u90bb\u57df**:2 \u4e07\u6bb5\u7684\u5355\u7ae0\u4e00\u6b21\u5168\u94fa\u8fdb DOM \u4f1a\u628a\u9996\u5c4f\u53d8\u6210\u4e00\u6b21\u957f\u4efb\u52a1\u3002\n"
              "         *   \u2605 \u5207\u7247\u662f**\u7a97\u53e3**\u800c\u4e0d\u662f\u622a\u65ad:\u4e24\u5934\u90fd\u80fd\u7528 `showMoreParas()` \u6269(\u9a8c\u6536\u539f\u6587\u7981\u6b62\u300c\u4ee5\u622a\u6389\u957f\u7ae0\u4ee3\u66ff\u5206\u9875\u300d)\u3002\n"
              "         *   \u2605 `data-para` \u4ecd\u662f**\u5168\u7ae0\u4e0b\u6807**,\u6545\u6458\u5f55\u4e0e\u8fdb\u5ea6\u951a\u70b9\u8bfb\u7684\u90fd\u662f\u6bb5\u8eab\u4efd,\u4e0d\u53d7\u5207\u7247\u5f71\u54cd\u3002 */\n"
              "        const win = paraWindowOf(paras, { anchor: this.anchorPara, pageSize: PARA_WINDOW_SIZE });\n"
              "        this._lastParaWindow = win;\n"
              "        const paraNote = (win.ok && (win.hasBefore || win.hasAfter))\n"
              "            ? '<div class=\"rd-para-note\" id=\"rd-para-note\">' + esc(paraLine(win)) + '</div>'\n"
              "            : '';\n")

RENDER2_ANCHOR = "paras.map((p, i) => `<p data-para=\"${i}\">${esc(p)}</p>`).join('')"
RENDER2_NEW = "win.items.map((p, k) => `<p data-para=\"${win.start + k}\">${esc(p)}</p>`).join('')"

USAGE_ANCHOR = """            <div class="rd-content">${content}</div>"""
USAGE_NEW = """            <div class="rd-content">${content}</div>
            ${paraNote}
            <div class="rd-para-more">
                <button class="rd-mini" id="rd-more-before" ${(!win.ok || !win.hasBefore) ? 'disabled style="opacity:.4"' : ''}>‹ 往上看</button>
                <button class="rd-mini" id="rd-more-after" ${(!win.ok || !win.hasAfter) ? 'disabled style="opacity:.4"' : ''}>往下看 ›</button>
            </div>"""

BIND_ANCHOR = """            q('#rd-theme')?.addEventListener('click', () => {
                const order = READING_THEMES;
                const at = order.indexOf(this.theme);
                this.theme = order[(at < 0 ? 0 : at + 1) % order.length];
                this._saveProgress();
                this.render();
            });"""
BIND_NEW = """            q('#rd-theme')?.addEventListener('click', () => {
                const order = READING_THEMES;
                const at = order.indexOf(this.theme);
                this.theme = order[(at < 0 ? 0 : at + 1) % order.length];
                this._saveProgress();
                this.render();
            });
            /* [v4.18.0 · R4-O6] 扩窗口(往上看 / 往下看)。**只动画口,不删任何段**。 */
            q('#rd-more-before')?.addEventListener('click', () => this.showMoreParas(-1));
            q('#rd-more-after')?.addEventListener('click', () => this.showMoreParas(1));
            /* 滚动时记段落锚点(节流 400ms):离开页面/改字号/摘录回跳都靠它回到同段。 */
            q('.rd-content')?.addEventListener('scroll', () => this._captureParaAnchorThrottled());"""

CAPTURE_ANCHOR = """    _saveProgress() {
        try {
            if (!this.currentBook) return;"""
CAPTURE_NEW = """    /* ================= [v4.18.0 · R4-O6] 段落锚点:精确进度 ================= */
    /** 当前滚动位置最靠近顶部的那一段(读不出 ⇒ 保持原锚点,**不补 0**)。 */
    _topVisiblePara() {
        const root = this.app.phoneShell?.screen;
        if (!root) return null;
        const box = root.querySelector('.rd-content');
        if (!box) return null;
        const top = box.getBoundingClientRect().top;
        const ps = Array.from(box.querySelectorAll('p[data-para]'));
        for (const p of ps) {
            if (p.getBoundingClientRect().bottom >= top) {
                const v = anchorOf([], p.dataset.para);
                if (v !== null) return v;
            }
        }
        return null;
    }
    /** 记锚点(**节流 400ms**;滚动事件每帧都来,不能每帧都写字段)。 */
    _captureParaAnchorThrottled() {
        const now = (typeof Date.now === 'function') ? Date.now() : 0;
        if (this._anchorAt && now && now - this._anchorAt < 400) return false;
        this._anchorAt = now;
        const v = this._topVisiblePara();
        if (v === null) return false;
        this.anchorPara = v;
        this._saveProgress();
        return true;
    }
    /**
     * 扩窗口(delta = -1 往上看 / +1 往下看):把锚点往那一头挪 `PARA_WINDOW_SIZE` 段并重绘。
     *   ★ **不删任何段**:窗口外仍在章数组里,只是这一帧不渲染。
     *   ★ 到边界如实返回 ok:false(不假装扩了)。
     * @returns {{ok:boolean, anchor:number, hasMore:boolean}}
     */
    showMoreParas(delta) {
        const book = this.currentBook;
        if (!book) return { ok: false, anchor: 0, hasMore: false };
        const ch = book.chapters[this.curChapter] || { paragraphs: [] };
        const total = (ch.paragraphs || []).length;
        if (!total) return { ok: false, anchor: 0, hasMore: false };
        const w = this._lastParaWindow || paraWindowOf(ch.paragraphs || [], { anchor: this.anchorPara, pageSize: PARA_WINDOW_SIZE });
        const cur = (w.anchor === null) ? 0 : w.anchor;
        const step = Math.max(1, Math.floor(PARA_WINDOW_SIZE / 2));
        let next = cur + (delta < 0 ? -step : step);
        if (next < 0) next = 0;
        if (next > total - 1) next = total - 1;
        const changed = next !== cur;
        this.anchorPara = next;
        this._saveProgress();
        if (changed) this.render();
        return { ok: changed, anchor: next, hasMore: (next > 0 && next < total - 1) };
    }
    _saveProgress() {
        try {
            if (!this.currentBook) return;"""

SAVE_ANCHOR = "JSON.stringify({ chapter: this.curChapter, fontPx: this.fontPx, theme: this.theme }));"
SAVE_NEW = "JSON.stringify({ chapter: this.curChapter, fontPx: this.fontPx, theme: this.theme, para: (this.anchorPara === null ? undefined : this.anchorPara) }));"

LOAD_ANCHOR = """                if (READING_THEMES.includes(p.theme)) this.theme = p.theme;"""
LOAD_NEW = """                if (READING_THEMES.includes(p.theme)) this.theme = p.theme;
                /* [v4.18.0 · R4-O6] 段落锚点:读不出保持 null(⇒ 从首段起),**不补 0**
                 *   —— 0 是合法首段,与「没记过锚点」在同一读数上处置相同、但语义不同,
                 *   故这里只做「有就贴、没有就不设」。 */
                const pa = anchorOf([], p.para);
                this.anchorPara = (pa === null) ? null : pa;"""

CONST_ANCHOR = "export class ReadingView {"
CONST_NEW = """/* [v4.18.0 · R4-O6] 段落窗口大小:满足计划原文验收的「可视邻域不超过 250 段」。
 *   与既有两个窗口函数同源(list-window 的 normalizePageSize 硬上限 200 是**页长**口径,
 *   而段落邻域的 `pageSize` 走同一支归一,故这里取 250 会被它夹到 200 —— 见下)。
 *   ★ 实际值:250 会被 normalizePageSize 夹到 200;而邻域默认半径取 (size-1)/2,
 *     得 99 ⇒ 窗口 = 199 段,**仍然满足「不超过 250 段」**。 */
const PARA_WINDOW_SIZE = 250;
export class ReadingView {"""


def patch(rel, pairs):
    p = os.path.join(ROOT, rel)
    s = io.open(p, encoding='utf-8').read()
    for i, (a, b) in enumerate(pairs):
        n = s.count(a)
        assert n == 1, '[%s] anchor %d must hit exactly 1, got %d' % (rel, i, n)
        s = s.replace(a, b, 1)
    io.open(p, 'w', encoding='utf-8').write(s)
    print('patched ' + rel)


def main():
    patch(REL, [
        (IMP_ANCHOR, IMP_NEW),
        (RENDER_ANCHOR, RENDER_NEW),
        (RENDER2_ANCHOR, RENDER2_NEW),
        (USAGE_ANCHOR, USAGE_NEW),
        (BIND_ANCHOR, BIND_NEW),
        (CAPTURE_ANCHOR, CAPTURE_NEW),
        (SAVE_ANCHOR, SAVE_NEW),
        (LOAD_ANCHOR, LOAD_NEW),
        (CONST_ANCHOR, CONST_NEW),
    ])
    return 0


if __name__ == '__main__':
    sys.exit(main())