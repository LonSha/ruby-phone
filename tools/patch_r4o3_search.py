#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_r4o3_search.py — [v4.15.0 · R4-O3] 把状态捕获/恢复接进全局搜索(首个消费点)。

四处(每处锚点必须恰中一次):
  1 import:引入 config/view-state.js 的四支;
  2 控制器:新增 captureState / restoreState 两口(只转交纯函数 + storage 读写);
  3 视图 render():打开面板时**先读**快照再画(否则画完再贴会闪);
  4 视图 _bind:输入与来源切换后**捕获**一次(捕获要节流,不能每敲一个字写一次盘)。

纪律:
  · 恢复**不猜**:判定交给 config/view-state.js::restoreViewState(五态互不同形);
  · 换会话必须清掉内存里那份(否则 A 的快照会被当成「给 B 的」);
  · 捕获节流用 storage 的既有键前缀隔离,**不新增会话键**。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = 'apps/search/search-app.js'
VIEW = 'apps/search/search-view.js'

APP_IMP_ANCHOR = "import { facetsOf, applyFacets } from '../../config/search-facets.js';"
APP_IMP_NEW = (APP_IMP_ANCHOR + "\n"
               "/* [v4.15.0 \u00b7 R4-O3] \u9875\u9762\u72b6\u6001\u6355\u83b7\u4e0e\u6062\u590d(\u7eaf\u51fd\u6570)\u3002\n"
               " *   \u672c\u5c42\u53ea\u505a\u4e24\u4ef6\uff1a\u628a\u56db\u683c\u4ea4\u7ed9\u5b83\u5f52\u4e00\uff0c\u4ee5\u53ca\u8bfb\u5199\u90a3\u4e00\u4e2a\u4f1a\u8bdd\u952e\u3002\n"
               " *   **\u4f1a\u8bdd\u56f4\u680f\u7531\u5b83\u8bf4\u8bdd**(appId + chatId \u4e24\u683c\u9010\u6b21\u6bd4\u5bf9)\u2014\u2014\u672c\u5c42\u4e0d\u81ea\u5df1\u5224\u4e00\u4efd\u3002 */\n"
               "import {\n"
               "    viewStateKey, captureViewState, restoreViewState, needsRequery\n"
               "} from '../../config/view-state.js';")

# 锚点避开注释行:那一行里的分号是全角(0xFF1B)、括号是全角(0xFF08/0xFF09),
#   照 ASCII 写就是零命中(本仓因全角标点失配已记过多次)。改成**两行真代码**做锚。
APP_FN_ANCHOR = """        this.view.render();
    }

    css() {"""
APP_FN_NEW = """        this.view.render();
    }

    /* ================= [v4.15.0 \u00b7 R4-O3] \u72b6\u6001\u6355\u83b7 / \u6062\u590d ================= */
    /** \u672c\u4f1a\u8bdd\u8eab\u4efd(\u53ea\u8bfb)\u3002\u53d6\u4e0d\u5230\u8fd4\u56de\u7a7a\u4e32(\u7eaf\u51fd\u6570\u5bf9\u7a7a\u4e32\u4e0e\u7a7a\u4e32\u5224\u300c\u540c\u4e00\u6bb5\u300d)\u3002 */
    _chatId() {
        try { return String(this.storage?.currentConversationId || ''); } catch (_e) { return ''; }
    }
    /**
     * \u628a\u5f53\u524d\u56db\u683c\u5199\u6210\u5feb\u7167(\u843d chatMetadata,\u8ddf\u4f1a\u8bdd\u8d70)\u3002
     *   \u5feb\u7167\u91cc\u5e26 appId \u4e0e chatId **\u4e24\u683c\u8eab\u4efd** \u2014\u2014 \u6062\u590d\u65f6\u9010\u6b21\u6bd4\u5bf9,\u4e0d\u5339\u914d\u5373\u62d2(\u4e0d\u8d34\u9519)\u3002
     * @returns {{ok:boolean, key:string, reason:string}}
     */
    captureState(raw) {
        const key = viewStateKey('search');
        if (!key) return { ok: false, key: '', reason: 'no-key' };
        const pack = captureViewState('search', raw, this._chatId());
        if (!pack) return { ok: false, key: key, reason: 'capture-failed' };
        try {
            this.storage?.set?.(key, JSON.stringify(pack));
            return { ok: true, key: key, reason: '' };
        } catch (_e) { return { ok: false, key: key, reason: 'write-threw' }; }
    }
    /**
     * \u8bfb\u56de\u5feb\u7167\u5e76\u5224\u5b9a**\u80fd\u4e0d\u80fd\u6062\u590d**(\u4e94\u6001\u4e92\u4e0d\u540c\u5f62)\u3002
     *   \u2605 \u672c\u65b9\u6cd5**\u4e0d\u6539\u4efb\u4f55\u4e1c\u897f** \u2014\u2014 \u628a\u5feb\u7167\u4ea4\u56de\u7ed9\u89c6\u56fe,\u7531\u89c6\u56fe\u51b3\u5b9a\u600e\u4e48\u7528\u3002
     *   \u4e3a\u4ec0\u4e48\u8fd9\u4e48\u5206:\u63a7\u5236\u5668\u4e0d\u78b0 DOM(\u672c App \u65e2\u6709\u7eaa\u5f8b)\u3002
     */
    restoreState() {
        const key = viewStateKey('search');
        if (!key) return { ok: false, state: 'unreadable', snapshot: null, why: 'no-key' };
        let raw = undefined;
        try { raw = this.storage?.get?.(key, undefined); } catch (_e) { raw = undefined; }
        return restoreViewState('search', raw, this._chatId());
    }
    /** \u6062\u590d\u540e\u662f\u5426\u9700\u8981\u91cd\u8dd1\u4e00\u6b21\u68c0\u7d22(\u67e5\u8be2\u8bcd\u8fd8\u5728\u4f46\u7ed3\u679c\u5df2\u968f\u91cd\u7ed8\u4e22)\u3002 */
    restoredNeedsRequery(snapshot) { return needsRequery(snapshot); }

    css() {"""

ONCHAT_ANCHOR = """    onChatChanged() {
        this.invalidateAll();
        this._syncHostSources();
    }"""
ONCHAT_NEW = """    onChatChanged() {
        this.invalidateAll();
        this._syncHostSources();
        /* [v4.15.0 \u00b7 R4-O3] \u6362\u4f1a\u8bdd\u5fc5\u987b\u628a\u89c6\u56fe\u91cc\u90a3\u4efd\u5185\u5b58\u5feb\u7167\u4e5f\u4e22\u6389\u3002
         *   \u4e3a\u4ec0\u4e48\uff1a\u952e\u524d\u7f00\u53ea\u4fdd\u8bc1**\u5b58\u50a8\u4f4d\u7f6e**\u6309\u4f1a\u8bdd\u9694\u5f00\uff0c
         *   \u4e0d\u4fdd\u8bc1\u300c\u624b\u4e0a\u8fd9\u4efd\u662f\u7ed9\u8c01\u7684\u300d\u2014\u2014\u4e0d\u4e22\u5c31\u4f1a\u628a\u4e0a\u4e00\u6bb5\u7684\u641c\u7d22\u8bcd\u8d34\u56de\u65b0\u4f1a\u8bdd\u3002 */
        try { if (this.view) this.view._restored = null; } catch (_e) { /* \u89c6\u56fe\u4e0d\u5728\u4e5f\u6ca1\u4ec0\u4e48\u53ef\u4e22 */ }
    }"""

# 视图:render 里先读快照再画
VIEW_RENDER_ANCHOR = """    render() {
        const shell = this.app?.phoneShell;
        if (!shell?.setContent) return;"""
VIEW_RENDER_NEW = """    render() {
        const shell = this.app?.phoneShell;
        if (!shell?.setContent) return;
        /* [v4.15.0 \u00b7 R4-O3] **\u5148\u8bfb\u5feb\u7167\u518d\u753b**\uff1a\u5feb\u7167\u91cc\u6709\u4e0a\u6b21\u79bb\u5f00\u65f6\u7684
         *   \u9875\u7b7e(\u6765\u6e90\u7b5b\u9009)\u4e0e\u67e5\u8be2\u8bcd\u3002\u753b\u5b8c\u518d\u8d34\u4f1a\u5148\u95ea\u4e00\u4e0b\u7a7a\u9762\u3002
         *   \u2605 \u540c\u4e00\u4f1a\u8bdd\u5185\u7684\u91cd\u7ed8\u4e0d\u91cd\u8bfb(\u5426\u5219\u4f1a\u628a\u7528\u6237\u521a\u6539\u7684\u641c\u7d22\u8bcd\u9876\u6389)\u3002 */
        if (this._restored === null || this._restored === undefined) {
            let res = null;
            try { res = this.app.restoreState?.() || null; } catch (_e) { res = null; }
            this._restored = (res && res.ok === true) ? res : { ok: false, state: (res && res.state) || 'unreadable', snapshot: null };
            if (this._restored.ok === true) {
                const s = this._restored.snapshot;
                if (s.tab !== null) this._scope = s.tab;
                if (s.query !== null) this._keyword = s.query;
            }
        }"""

# 视图:_bind 里捕获
VIEW_BIND_ANCHOR = """        root.querySelectorAll('.gs-chip').forEach(btn => {
            btn.addEventListener('click', () => {
                this._qtoken();
                this._scope = String(btn.dataset.scope || '');
                this._result = null;
                this.render();
            });
        });"""
VIEW_BIND_NEW = """        root.querySelectorAll('.gs-chip').forEach(btn => {
            btn.addEventListener('click', () => {
                this._qtoken();
                this._scope = String(btn.dataset.scope || '');
                this._result = null;
                this._capture();
                this.render();
            });
        });"""

INPUT_ANCHOR = """            this._qtoken();
            this._paint();
            // 清空按钮随输入显现/消失"""
INPUT_NEW = """            this._qtoken();
            this._paint();
            /* [v4.15.0 \u00b7 R4-O3] \u8f93\u5165\u540e\u6355\u83b7\u4e00\u6b21(\u8282\u6d41:\u4e0d\u80fd\u6bcf\u6572\u4e00\u4e2a\u5b57\u5199\u4e00\u6b21\u76d8)\u3002 */
            this._capture();
            // 清空按钮随输入显现/消失"""


def patch(rel, pairs):
    p = os.path.join(ROOT, rel)
    s = io.open(p, encoding='utf-8').read()
    for i, (a, b) in enumerate(pairs):
        if b and b in s and a not in s:
            print('  [%s] anchor %d already applied, skip' % (rel, i))
            continue
        n = s.count(a)
        assert n == 1, '[%s] anchor %d must hit exactly 1, got %d' % (rel, i, n)
        s = s.replace(a, b, 1)
    io.open(p, 'w', encoding='utf-8').write(s)
    print('patched ' + rel)


CAPTURE_FN = '''
    /* ================= [v4.15.0 \u00b7 R4-O3] \u72b6\u6001\u6355\u83b7 ================= */
    /**
     * \u6355\u83b7\u4e00\u6b21\u56db\u683c\u3002**\u8282\u6d41 400ms**:\u8f93\u5165\u8fc7\u7a0b\u91cc\u6bcf\u6572\u4e00\u4e2a\u5b57\u5199\u4e00\u6b21\u76d8
     *   \u4f1a\u628a\u672c\u673a\u5b58\u50a8\u5f53\u6210\u9ad8\u9891\u843d\u76d8\u5668\u7528\u3002\u8282\u6d41\u4e22\u7684\u662f**\u6700\u540e 400ms**\u7684\u8f93\u5165,
     *   \u800c\u90a3\u4e00\u6bb5\u4f1a\u5728\u4e0b\u4e00\u6b21\u70b9\u51fb/\u5173\u95ed\u65f6\u8865\u4e0a \u2014\u2014 \u4ee3\u4ef7\u662f\u300c\u6ede\u540e\u51e0\u767e\u6beb\u79d2\u300d,
     *   \u800c\u4e0d\u8282\u6d41\u7684\u4ee3\u4ef7\u662f\u300c\u6bcf\u4e00\u4e2a\u5b57\u90fd\u8981\u7b49\u4e00\u6b21\u540c\u6b65\u5199\u300d\u3002
     *   \u2605 \u4e0d\u4f7f\u7528 setTimeout:view \u4e0d\u6301\u5b9a\u65f6\u5668(reg lifecycle \u4f1a\u5224\u5b9a\u672a\u767b\u8bb0\u7684\u5b9a\u65f6\u5668)\u3002
     *   \u6539\u7528\u300c\u4e0a\u6b21\u5199\u7684\u65f6\u523b\u300d\u505a\u65f6\u95f4\u95f8\u95e8 \u2014\u2014 \u540c\u6837\u80fd\u63a7\u4f4f\u9891\u7387,\u4e14\u65e0\u5b9a\u65f6\u5668\u3002
     */
    _capture() {
        const now = Date.now();
        if (this._lastCaptureAt && now - this._lastCaptureAt < 400) return false;
        this._lastCaptureAt = now;
        let r = null;
        try {
            r = this.app.captureState?.({
                tab: this._scope, query: this._keyword, anchor: '', scroll: 0
            }) || null;
        } catch (_e) { r = null; }
        return !!(r && r.ok === true);
    }
'''

CAPTURE_ANCHOR = """    _progress(p) {"""


def main():
    patch(APP, [
        (APP_IMP_ANCHOR, APP_IMP_NEW),
        (APP_FN_ANCHOR, APP_FN_NEW),
        (ONCHAT_ANCHOR, ONCHAT_NEW),
    ])
    patch(VIEW, [
        (VIEW_RENDER_ANCHOR, VIEW_RENDER_NEW),
        (INPUT_ANCHOR, INPUT_NEW),
        (VIEW_BIND_ANCHOR, VIEW_BIND_NEW),
        (CAPTURE_ANCHOR, CAPTURE_FN + CAPTURE_ANCHOR),
    ])
    return 0


if __name__ == '__main__':
    sys.exit(main())