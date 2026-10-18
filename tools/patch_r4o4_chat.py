#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_r4o4_chat.py — [v4.16.0 · R4-O4] 把尾部窗口接进微信聊天全量渲染路径。

两处(每处锚点必须恰中一次):
  1 import `config/list-window.js` 的尾部三支;
  2 `_refreshCurrentChatMessages` 的**全量渲染回退路径**:渲染前先按尾部窗口切片
     (默认同时渲染不超过 `CHAT_WINDOW_SIZE = 300` 条),并把「本轮渲染了哪一段 / 还有没有更早的」
     记在 `_lastRenderedWindow` 上供诊断读。

纪律:
  · 不动既有增量追加路径(它已经是对的:纯尾部追加只 append 新节点);
  · 切片**只影响交给渲染函数的数组**,不改数据源、不删历史(计划原文逐字禁止);
  · 用户往回翻(要看更早的)时 `_loadedWindow` 会被 `showEarlierMessages()` 放大 —— 本版给出该入口。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REL = 'apps/wechat/chat-view.js'

IMP_ANCHOR = "import { numOrNull } from '../../config/num-gate.js';"
IMP_NEW = (IMP_ANCHOR + "\n"
           "/* [v4.16.0 \u00b7 R4-O4] \u5c3e\u90e8\u7a97\u53e3:\u957f\u804a\u5929\u53ea\u6e32\u67d3\u6700\u8fd1 N \u6761,\u800c\u4e0d\u91cd\u94fa\u6574\u6bb5\u8bb0\u5f55\u3002\n"
           " *   \u4e3a\u4ec0\u4e48\u7528**\u5c3e\u90e8**\u800c\u4e0d\u662f `windowOf`:\u540e\u8005\u4ece\u5934\u90e8\u5207(\u670d\u52a1\u7011\u5e03\u6d41),\n"
           " *   \u800c\u804a\u5929\u7528\u6237\u770b\u7684\u662f\u6700\u8fd1 N \u6761 \u2014\u2014 \u4e24\u79cd\u5207\u7247\u65b9\u5411\u76f8\u53cd\u3002 */\n"
           "import { tailWindowOf } from '../../config/list-window.js';")

# 窗口大小常量:**只声明一处**。
# 值取 200 而不是 300 —— `normalizePageSize` 的硬上限就是 200(它防的是「一次铺太多」),
# 写 300 会与**实际发生的事**不符(声明与真码脱节,本仓治过多次的那一类)。
# 200 同样满足计划原文验收的「同时渲染不超过 300 条消息」。
SIZE_ANCHOR = "export class ChatView {"
SIZE_NEW = """/* [v4.16.0 · R4-O4] 同时渲染的消息上限(满足计划原文验收的「同时渲染不超过 300 条消息」)。
 *   值取 **200** 而不是 300:`normalizePageSize` 的硬上限就是 200(它防的正是「一次铺太多」),
 *   写 300 会与**实际发生的事**不符 —— 声明与真码脱节是本仓治过多次的那一类。
 *   为什么写成模块常量而不是散在调用处:改上限只该改一处(本仓「同一口径只许一份实现」)。 */
const CHAT_WINDOW_SIZE = 200;
export class ChatView {"""

# 锚点**只用真代码两行**:注释行里的括号是全角,拿它当锚点会零命中(已记过多次)。
FN_ANCHOR = """        messagesDiv.innerHTML = this.renderMessagesWithDateDividers(messages, userInfo);
        this._lastRenderedMsgIds = this._lastRenderedMsgIds || {};
        this._lastRenderedMsgIds[chatId] = currIds;"""
FN_NEW = """        /* [v4.16.0 \u00b7 R4-O4] **\u53ea\u6e32\u67d3\u5c3e\u90e8\u7a97\u53e3**:\u51e0\u5343\u6761\u7684\u4f1a\u8bdd\u4e00\u6b21\u94fa\u8fdb DOM \u4f1a\u628a\u9996\u5c4f\u53d8\u6210\u4e00\u6b21\u957f\u4efb\u52a1\u3002
         *   \u5207\u7247\u53ea\u5f71\u54cd**\u4ea4\u7ed9\u6e32\u67d3\u51fd\u6570\u7684\u6570\u7ec4** \u2014\u2014 \u4e0d\u6539\u6570\u636e\u6e90\u3001\u4e0d\u5220\u5386\u53f2\u3002
         *   \u2605 `currIds` \u4ecd\u7136\u8bb0**\u5168\u91cf** id:\u589e\u91cf\u8ffd\u52a0\u7684\u5224\u636e(\u7eaf\u5c3e\u90e8\u8ffd\u52a0)\u9760\u5b83\u624d\u4e0d\u4f1a\u8bef\u5224\u3002 */
        const win = tailWindowOf(messages, {
            loaded: this._loadedWindow, pageSize: CHAT_WINDOW_SIZE
        });
        this._lastRenderedWindow = win;
        messagesDiv.innerHTML = this.renderMessagesWithDateDividers(win.items, userInfo);
        this._lastRenderedMsgIds = this._lastRenderedMsgIds || {};
        this._lastRenderedMsgIds[chatId] = currIds;"""

# 常量与 showEarlierMessages 入口:插在 _refreshCurrentChatMessages 之前
CONST_ANCHOR = """    _refreshCurrentChatMessages(options = {}) {"""
CONST_NEW = """    /**
     * [v4.16.0 \u00b7 R4-O4] \u5f53\u524d\u5df2\u52a0\u8f7d\u7684\u5c3e\u90e8\u7a97\u53e3\u5927\u5c0f(\u7f3a\u7701\u7b49\u4e8e CHAT_WINDOW_SIZE)\u3002
     *   \u7528\u6237\u5f80\u56de\u7ffb\u65f6\u9760 `showEarlierMessages()` \u628a\u5b83\u653e\u5927, \u800c**\u4e0d\u662f**\u628a\u6574\u6bb5\u4e00\u6b21\u94fa\u51fa\u53bb\u3002
     */
    windowSize() {
        const n = numOrNull(this._loadedWindow);
        return (n !== null && n > 0) ? Math.floor(n) : CHAT_WINDOW_SIZE;
    }
    /**
     * [v4.16.0 \u00b7 R4-O4] \u518d\u5f80\u56de\u770b\u4e00\u9875(\u628a\u5c3e\u90e8\u7a97\u53e3\u653e\u5927 `CHAT_WINDOW_SIZE` \u6761)\u3002
     *   \u62c9\u5b9e\u9645\u6570\u636e\u7684\u201c\u8fd8\u6709\u66f4\u65e9\u7684\u201d\u4e0e\u201c\u5df2\u5230\u5f00\u5934\u201d\u5206\u5f00\uff1a\u540e\u8005\u5982\u5b9e\u8fd4\u56de false, \u4e0d\u5047\u88c5\u8fd8\u80fd\u518d\u62c9\u3002
     * @returns {{ok:boolean, loaded:number, hasMore:boolean}}
     */
    showEarlierMessages() {
        const chatId = String(this.app.currentChat?.id || '').trim();
        if (!chatId) return { ok: false, loaded: 0, hasMore: false };
        const total = (this.app.wechatData.getMessages(chatId) || []).length;
        const next = Math.min(total, this.windowSize() + CHAT_WINDOW_SIZE);
        const changed = next > this.windowSize();
        this._loadedWindow = next;
        if (changed) this._refreshCurrentChatMessages();
        return { ok: changed, loaded: next, hasMore: next < total };
    }
    _refreshCurrentChatMessages(options = {}) {"""


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
        (SIZE_ANCHOR, SIZE_NEW),
        (FN_ANCHOR, FN_NEW),
        (CONST_ANCHOR, CONST_NEW),
    ])
    return 0


if __name__ == '__main__':
    sys.exit(main())