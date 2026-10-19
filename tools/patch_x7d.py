# -*- coding: utf-8 -*-
"""patch_x7d.py — v4.29.0 · R4-X7 收口补丁 D：把视图里两份「第二张表」收回内核。

【本仓纪律】同一件事只许一份实现。实测（不是推演）：
  · chat-view.js 的 confirmGroupVote 里手写了一版「拒收理由 -> 通知文案」四格表；
  · chat-view.js 的标签解析里手写了「支持/反对 -> support/oppose」三元式。
两者都与内核的表同义 —— 内核改词或加态那天，这两处会静默漏一格。
修法：内核增两张表，接线件与 App 各增两个转发口，视图只转发。
"""
import io
import os
import sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
NL = chr(10)
K = 'config/group-vote-contract.js'
W = 'apps/wechat/group-vote.js'
A = 'apps/wechat/wechat-app.js'
V = 'apps/wechat/chat-view.js'
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
K_TABLES = (
    "/** \u786e\u8ba4\u88ab\u62d2\u65f6\u7ed9\u7528\u6237\u770b\u7684\u4e00\u53e5\uff08\u4e0e GV_REASONS \u5206\u5de5\uff1a\u90a3\u6761\u8fdb\u4e00\u884c\u8bfb\u6570\uff0c\u8fd9\u6761\u8fdb\u901a\u77e5\uff09\u3002" + NL
    + " *   \u2605 \u7b2c\u4e8c\u5f20\u300c\u7406\u7531\u5230\u6587\u6848\u300d\u8868\u5728\u89c6\u56fe\u91cc\u5199\u8fc7\u4e00\u7248\uff08\u672c\u7248\u5224\u636e A \u7ec4\u5f53\u573a\u8f6c\u7ea2\uff09\uff0c\u5df2\u6536\u56de\u5185\u6838\u3002 */" + NL
    + "export const GV_REASON_HINT = Object.freeze({" + NL
    + "    'no-options': '\u8fd9\u4e00\u8f6e\u8fd8\u6ca1\u6709\u9009\u9879 \u2014\u2014 \u7b49\u7fa4\u91cc\u63d0\u51fa\u65f6\u95f4\u6216\u5730\u70b9\u3002'," + NL
    + "    'no-members': '\u8fd9\u4e2a\u7fa4\u91cc\u8fd8\u6ca1\u6709\u6210\u5458 \u2014\u2014 \u5148\u52a0\u4eba\u518d\u8c08\u6295\u7968\u3002'," + NL
    + "    'no-votes': '\u4e00\u6761\u652f\u6301\u90fd\u6ca1\u6709 \u2014\u2014 \u5148\u7b49\u4eba\u8868\u6001\uff0c\u4e0d\u662f\u300c\u5e73\u7968\u300d\u3002'," + NL
    + "    'option-absent': '\u8fd8\u6ca1\u70b9\u9009\u9879\uff08\u6216\u70b9\u7684\u4e0d\u5728\u672c\u8f6e\u5e76\u5217\u91cc\uff09\u2014\u2014 \u5148\u70b9\u4e00\u4e2a\u518d\u786e\u8ba4\u3002'," + NL
    + "    replayed: '\u8fd9\u4efd\u6d3b\u52a8\u5df2\u7ecf\u751f\u6210\u8fc7\u4e86\uff08\u672a\u91cd\u590d\u751f\u6210\uff09\u3002'" + NL
    + "});" + NL
    + "/** \u4e2d\u6587\u6807\u7b7e\u5230\u8868\u6001 id \u7684\u552f\u4e00\u6620\u5c04\uff08AI \u4fa7\u6807\u7b7e\u89e3\u6790\u4e0e\u754c\u9762\u5171\u7528\uff1b\u89c6\u56fe\u4e0d\u5199\u7b2c\u4e8c\u4efd\u8868\uff09\u3002 */" + NL
    + "export const GV_CHOICE_BY_LABEL = Object.freeze({" + NL
    + "    '\u652f\u6301': 'support'," + NL
    + "    '\u53cd\u5bf9': 'oppose'," + NL
    + "    '\u5f03\u6743': 'abstain'" + NL
    + "});" + NL)
K_HINT_TAIL = ("    empty: '\u6295\u7968\u5df2\u7ecf\u5efa\u597d\uff0c\u8fd8\u6ca1\u4eba\u8868\u6001 \u2014\u2014 "
    + "\u771f\u5b9e\u6a21\u578b\u6309\u5404\u81ea\u5df2\u77e5\u504f\u597d\u56de\u5e94\u540e\u624d\u4f1a\u6709\u7968'" + NL + "});" + NL)
def main():
    k = rd(K);
    k = once(k, K_HINT_TAIL, K_HINT_TAIL + K_TABLES, 'kernel-tables')
    k = once(k, "    GV_STATE_HINT," + NL + "    GV_CHOICES,",
             "    GV_STATE_HINT," + NL + "    GV_REASON_HINT," + NL
             + "    GV_CHOICE_BY_LABEL," + NL + "    GV_CHOICES,", 'kernel-default')
    w = rd(W)
    w = once(w, "    GV_STATE_HINT," + NL + "    GV_LIMITS" + NL + "} from '../../config/group-vote-contract.js';",
             "    GV_STATE_HINT," + NL + "    GV_REASON_HINT," + NL
             + "    GV_CHOICE_BY_LABEL," + NL + "    GV_LIMITS" + NL
             + "} from '../../config/group-vote-contract.js';", 'wire-import')
    w = once(w, "    stateHint(s) { return GV_STATE_HINT[s] || ''; }",
             "    stateHint(s) { return GV_STATE_HINT[s] || ''; }" + NL
             + "    /** \u88ab\u62d2\u65f6\u7684\u4e00\u53e5\u8bdd\uff08'' = \u6ca1\u6709\u8981\u8bf4\u7684\uff1b\u89c6\u56fe\u4e0d\u5199\u7b2c\u4e8c\u4efd\u7406\u7531\u8868\uff09 */" + NL
             + "    reasonHint(r) { return GV_REASON_HINT[String(r || '')] || ''; }" + NL
             + "    /** \u4e2d\u6587\u6807\u7b7e -> \u8868\u6001 id\uff08'' = \u8ba4\u4e0d\u51fa\uff1b\u89c6\u56fe\u4e0d\u5199\u7b2c\u4e8c\u4efd\u6620\u5c04\uff09 */" + NL
             + "    choiceIdByLabel(t) { return GV_CHOICE_BY_LABEL[String(t == null ? '' : t).trim()] || ''; }", 'wire-methods')
    a = rd(A)
    a = once(a, "    /** \u786e\u8ba4\u4e00\u4efd\u6d3b\u52a8\uff08\u5e42\u7b49\uff09\uff1a\u53ea\u628a\u7ed3\u679c\u8f6c\u4ea4\u7ed9\u7ea6\u5b9a owner\uff0c**\u672c\u5c42\u96f6\u5199\u76d8**\u3002 */",
             "    /** \u88ab\u62d2\u65f6\u7684\u4e00\u53e5\u8bdd\uff08\u5224\u5b9a\u8bcd\u4e0e\u6587\u6848\u53ea\u8bb8\u5185\u6838\u4e00\u4efd\uff0c\u672c\u5c42\u53ea\u8f6c\u53d1\uff09\u3002 */" + NL
             + "    voteReasonHint(r) {" + NL
             + "        try { return this.groupVote.reasonHint(r); } catch (_e) { return ''; }" + NL
             + "    }" + NL
             + "    /** \u4e2d\u6587\u6807\u7b7e -> \u8868\u6001 id\uff08\u552f\u4e00\u6620\u5c04\u5728\u5185\u6838\uff09\u3002 */" + NL
             + "    voteChoiceIdByLabel(t) {" + NL
             + "        try { return this.groupVote.choiceIdByLabel(t); } catch (_e) { return ''; }" + NL
             + "    }" + NL
             + "    /** \u786e\u8ba4\u4e00\u4efd\u6d3b\u52a8\uff08\u5e42\u7b49\uff09\uff1a\u53ea\u628a\u7ed3\u679c\u8f6c\u4ea4\u7ed9\u7ea6\u5b9a owner\uff0c**\u672c\u5c42\u96f6\u5199\u76d8**\u3002 */", 'app-outlets')
    v = rd(V)
    v = once(v, "            const choice = choiceText === '\u652f\u6301' ? 'support' : (choiceText === '\u53cd\u5bf9' ? 'oppose' : 'abstain');",
             "            /* \u4e2d\u6587\u6807\u7b7e\u5230\u8868\u6001 id \u7684\u6620\u5c04\u53ea\u8bb8\u5185\u6838\u4e00\u4efd\uff08\u89c6\u56fe\u4e0d\u5199\u7b2c\u4e8c\u4efd\u8868\uff09\u3002 */" + NL
             + "            const choice = this.app.voteChoiceIdByLabel" + NL
             + "                ? this.app.voteChoiceIdByLabel(choiceText) : '';", 'view-choice')
    v = once(v, "            const why = String(res.reason || '');" + NL
             + "            const map = {" + NL
             + "                'no-options': '\u8fd9\u4e00\u8f6e\u8fd8\u6ca1\u6709\u9009\u9879 \u2014\u2014 \u7b49\u7fa4\u91cc\u63d0\u51fa\u65f6\u95f4\u6216\u5730\u70b9\u3002'," + NL
             + "                'no-members': '\u8fd9\u4e2a\u7fa4\u91cc\u8fd8\u6ca1\u6709\u6210\u5458 \u2014\u2014 \u5148\u52a0\u4eba\u518d\u8c08\u6295\u7968\u3002'," + NL
             + "                'no-votes': '\u4e00\u6761\u652f\u6301\u90fd\u6ca1\u6709 \u2014\u2014 \u5148\u7b49\u4eba\u8868\u6001\uff0c\u4e0d\u662f\u300c\u5e73\u7968\u300d\u3002'," + NL
             + "                'option-absent': '\u8fd8\u6ca1\u70b9\u9009\u9879\uff08\u6216\u70b9\u7684\u4e0d\u5728\u672c\u8f6e\u5e76\u5217\u91cc\uff09\u2014\u2014 \u5148\u70b9\u4e00\u4e2a\u518d\u786e\u8ba4\u3002'" + NL
             + "            };" + NL
             + "            this.app.phoneShell?.showNotification('\u6295\u7968', map[why] || '\u8fd9\u4e00\u4efd\u8fd8\u786e\u8ba4\u4e0d\u4e86\u3002', '\u26a0\ufe0f');",
             "            const why = String(res.reason || '');" + NL
             + "            const hint = this.app.voteReasonHint ? this.app.voteReasonHint(why) : '';" + NL
             + "            this.app.phoneShell?.showNotification('\u6295\u7968', hint || '\u8fd9\u4e00\u4efd\u8fd8\u786e\u8ba4\u4e0d\u4e86\u3002', '\u26a0\ufe0f');", 'view-map')
    v = once(v, "            this.app.phoneShell?.showNotification('\u6295\u7968', '\u8fd9\u4efd\u6d3b\u52a8\u5df2\u7ecf\u751f\u6210\u8fc7\u4e86\uff08\u672a\u91cd\u590d\u751f\u6210\uff09\u3002', '\u2139\ufe0f');",
             "            const rp = this.app.voteReasonHint ? this.app.voteReasonHint('replayed') : '';" + NL
             + "            this.app.phoneShell?.showNotification('\u6295\u7968', rp || '\u8fd9\u4efd\u6d3b\u52a8\u5df2\u7ecf\u751f\u6210\u8fc7\u4e86\u3002', '\u2139\ufe0f');", 'view-replayed')
    for rel, s in [(K, k), (W, w), (A, a), (V, v)]:
        print('  ok ' + rel)
    if not WRITE:
        print('--- DRY RUN (pass --write to apply) ---')
        return 0
    wr(K, k)
    wr(W, w)
    wr(A, a)
    wr(V, v)
    print('--- WRITTEN ---')
    return 0
if __name__ == '__main__':
    sys.exit(main())
