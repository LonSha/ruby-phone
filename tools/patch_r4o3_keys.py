#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_r4o3_keys.py — [v4.15.0 · R4-O3] 登记 `view_state_` 会话键前缀 + 键。

两处(每处锚点必须恰中一次):
  1 config/storage.js 的 CHAT_DATA_PATTERNS:加 `^view_`(一条前缀覆盖一键,无元字符);
  2 scripts/keys-audit.mjs 的 KEY_REGISTRY:加 `view_state_search` 登记项。

为什么必须逐键登记而不是只加前缀:K2 会把「登记声明的 scope」与
「CHAT_DATA_PATTERNS 的实际匹配结果」逐条对账 —— 只加前缀不登记会直接红灯。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

STORAGE_REL = 'config/storage.js'
STORAGE_ANCHOR = '            /^te_/,\n'
STORAGE_NEW = '''            /^te_/,
            /* [v4.15.0 \u00b7 R4-O3] \u9875\u9762\u72b6\u6001\u5feb\u7167(view_state_<appId>):
             *   \u4e00\u6761\u524d\u7f00\u8986\u76d6\u4e00\u952e,\u952e\u65e0\u5143\u5b57\u7b26,\u6309\u4ed3\u5185\u53e3\u5f84\u300c\u65e0\u9700\u5bbd\u5339\u914d\u767b\u8bb0\u300d\u3002
             *   \u4e3a\u4ec0\u4e48\u5fc5\u987b\u9694\u79bb:\u5feb\u7167\u91cc\u88c5\u7684\u662f\u300c\u8fd9\u4e2a\u89d2\u8272\u8fd9\u6bb5\u5bf9\u8bdd\u91cc\u6700\u540e\u505c\u5728\u54ea\u4e2a\u9875\u7b7e/\u641c\u4e86\u4ec0\u4e48\u8bcd/\u6eda\u5230\u54ea\u300d\u2014\u2014
             *   \u4e0d\u9694\u79bb\u5c31\u4f1a\u628a\u4e0a\u4e00\u4e2a\u89d2\u8272\u7684\u641c\u7d22\u8bcd\u4e0e\u6eda\u52a8\u4f4d\u7f6e\u8d34\u56de\u65b0\u4f1a\u8bdd(\u672c\u4ed3\u6700\u8d35\u7684\u90a3\u65cf\u9759\u9ed8\u9519\u7ed3\u679c)\u3002
             *   \u4e0e config/view-state.js \u7684 `viewStateKey()` \u540c\u6e90\uff08\u524d\u7f00\u53ea\u8bb8\u5728\u4e00\u5904\u5b9a\u4e49\uff09\u3002 */
            /^view_/,
'''

KEYS_REL = 'scripts/keys-audit.mjs'
KEYS_ANCHOR = "  { key: 'te_ledger', scope: 'chat',"
KEYS_NEW = ("  { key: 'view_state_search', scope: 'chat', note: '[v4.15.0] \u5168\u5c40\u641c\u7d22\u7684\u9875\u9762\u72b6\u6001\u5feb\u7167"
            "(\u9875\u7b7e/\u67e5\u8be2\u8bcd/\u5b9a\u4f4d\u951a\u70b9/\u6eda\u52a8\u4f4d;\u542b appId \u4e0e chatId \u4e24\u683c\u8eab\u4efd,\u6062\u590d\u524d\u9010\u6b21\u6bd4\u5bf9)' },\n"
            "  { key: 'te_ledger', scope: 'chat',")


def patch(rel, anchor, new, tag):
    p = os.path.join(ROOT, rel)
    s = io.open(p, encoding='utf-8').read()
    n = s.count(anchor)
    assert n == 1, '[%s/%s] anchor must hit exactly 1, got %d' % (rel, tag, n)
    assert '/^view_/' not in s and 'view_state_search' not in s, '[%s] already patched' % rel
    s = s.replace(anchor, new, 1)
    io.open(p, 'w', encoding='utf-8').write(s)
    print('patched ' + rel)


def main():
    patch(STORAGE_REL, STORAGE_ANCHOR, STORAGE_NEW, 'patterns')
    patch(KEYS_REL, KEYS_ANCHOR, KEYS_NEW, 'registry')
    return 0


if __name__ == '__main__':
    sys.exit(main())