#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_r4o3_keylit.py — [v4.15.0 · R4-O3] 让键名以**字面量**出现在产品面 + 登记改前缀型。

背景(实测):K3「登记条目存活自证」判的是「真仓库里有没有这个键的**使用点**」,
   而抽取器认的是 `storage.get('<字面量>')` / `const XXX_KEY = '<字面量>'` 两种形态。
   本项第一版把键名写在 `viewStateKey('search')` 里(拼接形),于是抽取器看不见它
   —— K3 当场红灯(fail-closed 拒判,正是它该做的事)。
修法两处:
  1 search-app 把 appId 收成常量字面量 `VIEW_STATE_APP_ID = 'view_state_search'`,
     `viewStateKey(VIEW_STATE_APP_ID)`,键名因此真实出现在产品面上;
  2 keys-audit 的登记改**前缀型** `view_state_*`(与既有的 `ruby_reading_progress_*` 同规),
     一条覆盖全部 `view_state_<appId>`。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = 'apps/search/search-app.js'
KEYS = 'scripts/keys-audit.mjs'

APP_ANCHOR = "import {\n    viewStateKey, captureViewState, restoreViewState, needsRequery\n} from '../../config/view-state.js';"
APP_NEW = (APP_ANCHOR + "\n"
           "/* \u2605 \u952e\u540d\u5fc5\u987b\u4ee5**\u5b57\u9762\u91cf**\u51fa\u73b0\u5728\u4ea7\u54c1\u9762\u4e0a(\u5b9e\u6d4b):\n"
           " *   keys \u95e8\u7684 K3 \u5224\u7684\u662f\u300c\u771f\u4ed3\u5e93\u91cc\u6709\u6ca1\u6709\u8fd9\u4e2a\u952e\u7684\u4f7f\u7528\u70b9\u300d,\u800c\u62bd\u53d6\u5668\u8ba4\u7684\u662f\n"
           " *   `storage.get('\u5b57\u9762\u91cf')` \u4e0e `const XXX_KEY = '\u5b57\u9762\u91cf'` \u4e24\u79cd\u5f62\u6001\u3002\n"
           " *   \u952e\u540d\u53ea\u5199\u5728 `viewStateKey('search')` \u91cc(\u62fc\u63a5\u5f62)\u65f6\u62bd\u53d6\u5668\u770b\u4e0d\u89c1\u5b83 \u2014\u2014\n"
           " *   K3 \u4f1a\u5f53\u573a\u62a5\u300c\u5e7d\u7075\u653e\u884c\u6761\u300d(\u5b83\u672c\u5c31\u8be5\u8fd9\u4e48\u505a:\u767b\u8bb0\u7740\u4e0d\u5b58\u5728\u7684\u4f7f\u7528\u70b9\u5c31\u662f\u63a9\u9970)\u3002\n"
           " *   \u6545\u628a appId \u6536\u6210\u6052\u5b9a\u5b57\u9762\u91cf\u5e38\u91cf\u3002 */\n"
           "export const VIEW_STATE_KEY = 'view_state_search';")

KEYS_ANCHOR = "  { key: 'view_state_search', scope: 'chat', note: '[v4.15.0] \u5168\u5c40\u641c\u7d22\u7684\u9875\u9762\u72b6\u6001\u5feb\u7167"
KEYS_NEW = "  { key: 'view_state_*', scope: 'chat', note: '[v4.15.0] \u5168\u5c40\u641c\u7d22\u7684\u9875\u9762\u72b6\u6001\u5feb\u7167"


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
    patch(APP, [(APP_ANCHOR, APP_NEW)])
    patch(KEYS, [(KEYS_ANCHOR, KEYS_NEW)])
    return 0


if __name__ == '__main__':
    sys.exit(main())