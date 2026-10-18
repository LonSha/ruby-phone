#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_r4o2_css.py — [v4.14.0 · R4-O2] 取消按钮与运行态行的样式(两侧投递)。

为什么两侧都写:本仓既定规是「源文件保留 + phone.css 打包」(与 bilibili / theater /
place / cheat 同规),`scripts/registry-audit.mjs` 的 R3 会逐文件核对投递面。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BLOCK = """
/* [v4.14.0 \u00b7 R4-O2] \u95ee\u5f80\u4e8b\u7684\u8fd0\u884c\u6001:\u53d6\u6d88\u6309\u94ae\u4e0e\u72b6\u6001\u884c\u3002
   \u4e3a\u4ec0\u4e48\u8981\u6709:\u5927\u5e93\u4e0a\u95ee\u4e00\u53e5\u8981\u626b\u4e5d\u8d26\u5168\u91cf,\u6ca1\u6709\u8fd9\u4e24\u4e2a\u5143\u7d20\u5c31\u53ea\u80fd\u76ef\u7740\u4e0d\u52a8\u7684\u754c\u9762\u731c
   \u300c\u5230\u5e95\u5728\u8dd1\u8fd8\u662f\u6b7b\u4e86\u300d\u3002\u53d6\u6d88\u6309\u94ae\u540c\u8272\u7cfb\u4f46\u66f4\u8f7b,\u4e0d\u4e0e\u300c\u95ee\u300d\u62a2\u4e3b\u89d2\u3002 */
.mem-ask-cancel {
    margin-left: 6px;
    padding: 0 10px;
    height: 30px;
    border: 1px solid #d8dae8;
    border-radius: 10px;
    background: #fbfbfe;
    color: #6b6b85;
    font-size: 12px;
    cursor: pointer;
}
.mem-ask-cancel:hover { background: #f0f1f8; }
.mem-ask-cancel:active { transform: scale(0.95); }
.mem-ask-runline { margin: 6px 0 2px; color: #6366f1; }
.mem-ask-canceled {
    color: #b45309 !important;
    background: #fff7ed;
    border-radius: 8px;
    padding: 8px 10px !important;
}
"""


def append(rel, text):
    p = os.path.join(ROOT, rel)
    s = io.open(p, encoding='utf-8').read()
    assert '.mem-ask-cancel' not in s, '[%s] already patched' % rel
    io.open(p, 'w', encoding='utf-8').write(s + text)
    print('appended ' + rel)


def main():
    append('phone.css', BLOCK)
    append('apps/memory/memory.css', BLOCK)
    return 0


if __name__ == '__main__':
    sys.exit(main())