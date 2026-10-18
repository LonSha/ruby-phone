#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_r4o3_shell.py — [v4.15.0 · R4-O3] 宿主:返回键走「逐层退」(与右滑同一条路)。

改动两处(每处锚点必须恰中一次):
  1 新增 `backOneLayer()`:`_dispatchSwipeBackWithFallback` 是**既有**的返回语义真源
     (它负责压栈/弹栈 + 250/550ms 兜底),本方法只把它包成一个可回报的入口 ——
     **不重写返回逻辑**(第二真源必然漂移,本仓治过多次)。
  2 `bindBackButton` 的 click:先逐层退;退不动(已在第二层)才回桌面。

为什么必须这么改(修前实测):click 分支写的是 `if (this.isAtHomeScreen()) return; this.goHome();`
—— 从搜索跳进某个 App 再按返回,用户被**直接丢回桌面**,而不是回到搜索;
而右滑那条路是逐层退。两条路给出两个语义,用户看到的是**同一个「返回」**。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REL = 'phone/phone-shell.js'

CLICK_ANCHOR = """        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (this.isAtHomeScreen()) return;
            this.goHome();
        });
    }"""

CLICK_NEW = """        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (this.isAtHomeScreen()) return;
            /* [v4.15.0 \u00b7 R4-O3] \u9010\u5c42\u9000\u4f18\u5148:\u4e0e\u53f3\u6ed1\u540c\u4e00\u6761\u8def\u3002
             *   \u4fee\u524d\u8fd9\u91cc\u76f4\u63a5 `goHome()` \u2014\u2014 \u4ece\u641c\u7d22\u8df3\u8fdb\u67d0\u4e2a App \u518d\u6309\u8fd4\u56de,
             *   \u7528\u6237\u88ab**\u4e22\u56de\u684c\u9762**\u800c\u4e0d\u662f\u56de\u5230\u641c\u7d22;\u800c\u53f3\u6ed1\u90a3\u6761\u8def\u662f\u9010\u5c42\u9000\u3002
             *   \u4e24\u6761\u8def\u7ed9\u51fa\u4e24\u4e2a\u8bed\u4e49,\u7528\u6237\u770b\u5230\u7684\u5374\u662f**\u540c\u4e00\u4e2a\u300c\u8fd4\u56de\u300d**\u3002
             *   \u9000\u4e0d\u52a8(\u5df2\u5728\u7b2c\u4e8c\u5c42 / \u65e0\u5f53\u524d\u5c42)\u624d\u56de\u684c\u9762 \u2014\u2014 \u56de\u684c\u9762\u4ecd\u662f\u6700\u540e\u4e00\u6863,\u4e0d\u53d6\u6d88\u3002 */
            const back = this.backOneLayer();
            if (!back || back.ok !== true) this.goHome();
        });
    }
    /* ============================================================
     * [v4.15.0 \u00b7 R4-O3] \u9010\u5c42\u9000\u4e00\u5c42(\u53ef\u56de\u62a5)\u3002
     * ------------------------------------------------------------
     * \u3010\u4e3a\u4ec0\u4e48\u662f\u5305\u4e00\u5c42\u800c\u4e0d\u662f\u91cd\u5199\u3011\u53f3\u6ed1\u8fd4\u56de(SWIPE_BACK)\u5df2\u7ecf\u662f\u672c\u4ed3\u7684
     *   **\u8fd4\u56de\u8bed\u4e49\u771f\u6e90**\uff1a\u5b83\u8d1f\u8d23\u538b\u6808\u4e0e\u5f39\u6808\u3001\u5e76\u5e26 250ms \u6d3e\u53d1 \u2192 550ms
     *   \u68c0\u67e5\u5c42\u662f\u5426\u771f\u7684\u79fb\u52a8(\u6ca1\u52a8\u5c31\u56de\u5f39\u5e76\u628a\u5c42\u63a8\u56de\u5386\u53f2\u6808)\u3002
     *   \u518d\u5199\u4e00\u4efd\u5fc5\u7136\u6f02\u79fb\uff08\u672c\u4ed3\u300c\u540c\u4e00\u53e3\u5f84\u53ea\u8bb8\u4e00\u4efd\u5b9e\u73b0\u300d\uff09\u3002
     *
     * \u3010\u56de\u62a5\u91cc\u6ca1\u6709\u4e00\u79cd\u53eb\u300c\u70b9\u4e86\u4f46\u6ca1\u9000\u300d\u3011\u8fd9\u91cc\u53ea\u56de\u62a5**\u80fd\u4e0d\u80fd\u53d1\u8d77**\uff1a
     *   `at-home`\uff08\u5df2\u5728\u4e3b\u5c4f\uff09/ `last-layer`\uff08\u5df2\u5728\u7b2c\u4e8c\u5c42\uff0c\u518d\u9000\u5c31\u662f\u684c\u9762\uff09/
     *   `no-current-layer`\uff08\u53d6\u4e0d\u5230\u5f53\u524d\u5c42\uff0c\u65e0\u6cd5\u6ed1\uff09/ `ok`\u3002
     *   \u53d1\u8d77\u4e4b\u540e\u771f\u6b63\u9000\u4e0d\u9000\u5f97\u52a8\u7531\u5e94\u7528\u81ea\u5df1\u7684 handleSwipeBack \u8bf4\u8bdd\uff0c
     *   \u4e14\u5e95\u5c42\u8fd8\u6709 `_dispatchSwipeBackWithFallback` \u7684\u56de\u5f39\u4fdd\u62a4 \u2014\u2014 \u6545\u6b64\u5904\u4e0d\u5047\u62a5\u300c\u5df2\u9000\u6210\u300d\u3002
     * ============================================================ */
    backOneLayer() {
        if (this.isAtHomeScreen()) return { ok: false, reason: 'at-home' };
        if (!Array.isArray(this.viewHistory) || this.viewHistory.length <= 1) {
            return { ok: false, reason: 'last-layer' };
        }
        const target = this.container?.querySelector?.('.phone-view-current');
        if (!target) return { ok: false, reason: 'no-current-layer' };
        try {
            this._dispatchSwipeBackWithFallback(target);
        } catch (_e) {
            return { ok: false, reason: 'dispatch-threw' };
        }
        return { ok: true, reason: '', layers: this.viewHistory.length };
    }"""


def main():
    p = os.path.join(ROOT, REL)
    s = io.open(p, encoding='utf-8').read()
    n = s.count(CLICK_ANCHOR)
    assert n == 1, 'click anchor must hit exactly 1, got %d' % n
    assert 'backOneLayer' not in s, 'already patched'
    s = s.replace(CLICK_ANCHOR, CLICK_NEW, 1)
    assert s.count('backOneLayer') == 2
    io.open(p, 'w', encoding='utf-8').write(s)
    print('patched ' + REL)
    return 0


if __name__ == '__main__':
    sys.exit(main())