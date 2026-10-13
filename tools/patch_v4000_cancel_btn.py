#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_v4000_cancel_btn.py — v4.00.0 · R3-O7：loading 气泡的取消入口（用户侧真实按钮）。

两处改动：
  ① 视图：generationStatus === 'loading' 时渲染「取消」按钮（其它态不渲染）；
  ② 事件绑定：接在 message-image-prompt-generate 绑定之前，调 cancelImageGeneration。
"""
import io
import os
import sys

ROOT = '/home/user/ruby-phone'
WRITE = '--write' in sys.argv


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


s = rd('apps/wechat/chat-view.js')

# ---------- ① 视图：loading 态加取消按钮 ----------
old1 = """                            <div style="font-size:12px; line-height:1.35; color:rgba(156,156,166,0.95); text-align:center; font-weight:600; text-shadow:0 1px 2px rgba(0,0,0,0.18);">${statusText}</div>
                        </div>"""
new1 = """                            <div style="font-size:12px; line-height:1.35; color:rgba(156,156,166,0.95); text-align:center; font-weight:600; text-shadow:0 1px 2px rgba(0,0,0,0.18);">${statusText}</div>
                            ${generationStatus === 'loading' ? `<div class="message-image-prompt-cancel" data-message-id="${cardId}" title="取消这次生成（不新增扣费请求）" style="
                                position:absolute; right:6px; top:6px; background:rgba(0,0,0,0.55); color:#fff;
                                border-radius:999px; padding:4px 8px; font-size:10px; line-height:1; cursor:pointer;
                                box-shadow:0 2px 8px rgba(0,0,0,0.18);">取消</div>` : ''}
                        </div>"""
s = once(s, old1, new1, 'view-cancel-btn')

# ---------- ② 事件绑定 ----------
old2 = "        currentView.querySelectorAll('.message-image-prompt-generate').forEach(card => {"
new2 = """        currentView.querySelectorAll('.message-image-prompt-cancel').forEach(btn => {
            btn.addEventListener('click', (e) => {
                if (this._isMessageSelectionActiveForCurrentChat()) return;
                e.preventDefault();
                e.stopPropagation();
                const messageId = e.currentTarget.dataset.messageId;
                if (messageId) this.cancelImageGeneration(messageId);
            });
        });
        currentView.querySelectorAll('.message-image-prompt-generate').forEach(card => {"""
s = once(s, old2, new2, 'bind-cancel')

assert s.count('message-image-prompt-cancel') == 2, 'view class + bind selector, got %d' % s.count('message-image-prompt-cancel')

if WRITE:
    wr('apps/wechat/chat-view.js', s)
    print('chat-view.js written OK')
else:
    print('DRY RUN OK (anchors hit, no write)')