#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_v4000_cancel_tag.py — v4.00.0 · R3-O7：TAG 阶段的取消也算取消，不是失败。

真缺口（本版定向套件 C3 抓出）：生图链有两段可失败——① 英文 TAG 生成（LLM 调用）
② 真生图。取消只接了后者的 catch；在 TAG 阶段点取消，abort 信号已置位而 TAG 请求
抛错时会走 TAG 的 catch，把消息写成 failed 并弹「英文 TAG 生成失败」——
用户点了取消却看到一条失败红字，正是本版要治的形态。

修法：TAG 的 catch 开头加同一道 abort 判断（取消 ⇒ 收尾走人，不写 failed、不弹错）。
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

old = """        } catch (error) {
            const promptError = String(error?.message || '英文 TAG 生成失败').trim();"""
new = """        } catch (error) {
            /* [v4.00.0 · R3-O7] TAG 阶段的取消也是取消：abort 后 TAG 请求会抛错，
             *   若不拦就写成 failed 并弹「英文 TAG 生成失败」——用户点了取消却看到失败红字。 */
            if (mediaAbort && mediaAbort.signal.aborted) {
                this._cleanupWechatImageAbort(mediaTaskKey);
                this._refreshVisibleChatMessages(chatId);
                this._imagePromptGenerationLocks.delete(generationLockKey);
                return;
            }
            const promptError = String(error?.message || '英文 TAG 生成失败').trim();"""
s = once(s, old, new, 'tag-cancel')

assert s.count('mediaAbort.signal.aborted') == 2, 'both catches must guard, got %d' % s.count('mediaAbort.signal.aborted')

if WRITE:
    wr('apps/wechat/chat-view.js', s)
    print('chat-view.js written OK')
else:
    print('DRY RUN OK (anchor hit, no write)')