#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_v4000_wechat.py — v4.00.0 · R3-O7：微信生图接入统一任务注册与取消面。

七处改动，每处锚点必须恰中一次。数据层：
  ① 构造函数加在飞中止控制面 _imageAbortControllers；
  ② 生成前注册任务（先 remove 旧任务——重新发起是新任务），并建 AbortController；
  ③ imageManager.generate 传 signal；
  ④ 图片成功分支 upsert playable（运行期已注册则过迁移守卫）；
  ⑤ 失败分支 upsert failed，且**取消导致的失败不写 failed**；
  ⑥ 新增 cancelImageGeneration（走注册板白名单 + abort 传输层）。
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

# ---------- ① 构造函数 ----------
old1 = "        this._imagePromptGenerationLocks = new Set();"
new1 = old1 + """
        /* [v4.00.0 · R3-O7] 在飞生图的中止控制面：任务键 → AbortController。
         *   传输层（NAI 队列等待 / ComfyUI 历史轮询 / fetch）早已接 signal，
         *   只差把用户侧的取消接到同一个 signal 上。 */
        this._imageAbortControllers = new Map();"""
s = once(s, old1, new1, 'ctor')

# ---------- ② 注册任务（在 sessionToken 之后、第一次 await 之前） ----------
old2 = """        const sessionToken = captureSessionToken(storage);
        this.app.wechatData.updateMessageById(chatId, safeMessageId, {
            imageGenStatus: 'loading',"""
new2 = """        const sessionToken = captureSessionToken(storage);
        /* [v4.00.0 · R3-O7] 任务入统一注册板（会话内存）。
         *   先 remove 旧任务：本轮生成是新任务（重新生成/重试是显式意图），
         *   否则 playable → running 会被迁移白名单拒掉、用户的「重新生成」点了没反应。 */
        const mediaTaskKey = `wechat:img:${chatId}:${safeMessageId}`;
        const mediaBoard = window.VirtualPhone?.mediaTasks || null;
        const mediaAbort = (typeof AbortController === 'function') ? new AbortController() : null;
        if (mediaAbort) this._imageAbortControllers.set(mediaTaskKey, mediaAbort);
        if (mediaBoard) {
            mediaBoard.remove(mediaTaskKey);
            mediaBoard.upsert({
                key: mediaTaskKey, app: 'wechat', kind: 'image',
                state: 'waiting', title: (message.mediaType || '图片') + '生成', hasResult: false
            });
        }
        this.app.wechatData.updateMessageById(chatId, safeMessageId, {
            imageGenStatus: 'loading',"""
s = once(s, old2, new2, 'register')

# ---------- ③ generate 传 signal ----------
old3 = """            const result = await imageManager.generate({
                app: 'wechat',
                prompt: generationPrompt,
                novelAIReferences,
                referenceImages: novelAIReferences
            });"""
new3 = """            if (mediaBoard) {
                mediaBoard.upsert({
                    key: mediaTaskKey, app: 'wechat', kind: 'image',
                    state: 'running', title: (message.mediaType || '图片') + '生成', hasResult: false
                });
            }
            const result = await imageManager.generate({
                app: 'wechat',
                prompt: generationPrompt,
                novelAIReferences,
                referenceImages: novelAIReferences,
                /* [v4.00.0 · R3-O7] 中止通道接进传输层：NAI 队列等待收到 abort 会
                 *   leave-queue（不新增扣费请求），fetch 直接中断。 */
                signal: mediaAbort ? mediaAbort.signal : undefined
            });"""
s = once(s, old3, new3, 'signal')

# ---------- ④ 图片成功分支 upsert playable ----------
old4 = """                generatedImageUrl: imageUrl,
                imageGenStatus: 'done',"""
new4 = """                generatedImageUrl: imageUrl,
                imageGenStatus: 'done',"""
s = once(s, old4, new4, 'image-done-anchor')
old4b = """            this._cleanupReplacedWechatGeneratedImage(previousImageUrl, imageUrl);
            this._refreshVisibleChatMessages(chatId);"""
new4b = """            this._cleanupReplacedWechatGeneratedImage(previousImageUrl, imageUrl);
            if (mediaBoard) {
                mediaBoard.upsert({
                    key: mediaTaskKey, app: 'wechat', kind: 'image',
                    state: 'playable', title: (message.mediaType || '图片') + '生成',
                    hasResult: true
                });
            }
            this._cleanupWechatImageAbort(mediaTaskKey);
            this._refreshVisibleChatMessages(chatId);"""
s = once(s, old4b, new4b, 'image-playable')

# ---------- ⑤ 失败分支：取消不写 failed ----------
old5 = """        } catch (error) {
            const rawMessage = String(error?.message || '').trim();"""
new5 = """        } catch (error) {
            /* [v4.00.0 · R3-O7] 用户主动取消不是失败：abort 后传输层会抛错，
             *   而消息状态已由 cancelImageGeneration 收回 idle —— 这里不再写 failed、
             *   也不弹「生图失败」（否则用户点了取消却看到一条失败红字）。 */
            if (mediaAbort && mediaAbort.signal.aborted) {
                this._cleanupWechatImageAbort(mediaTaskKey);
                this._refreshVisibleChatMessages(chatId);
                return;
            }
            const rawMessage = String(error?.message || '').trim();"""
s = once(s, old5, new5, 'cancel-not-failure')

# ---------- ⑤b 失败写入时 upsert failed ----------
old5b = """            this.app.wechatData.updateMessageById(chatId, safeMessageId, {
                imagePrompt: promptText,
                imageDescription: descriptionText,
                imageGenStatus: 'failed',
                imageGenerationRuntimeId: '',
                imageGenError: friendlyMessage
            });
            this._refreshVisibleChatMessages(chatId);
            this.app.phoneShell?.showNotification('生图失败', friendlyMessage, '❌');"""
new5b = """            this.app.wechatData.updateMessageById(chatId, safeMessageId, {
                imagePrompt: promptText,
                imageDescription: descriptionText,
                imageGenStatus: 'failed',
                imageGenerationRuntimeId: '',
                imageGenError: friendlyMessage
            });
            if (mediaBoard) {
                mediaBoard.upsert({
                    key: mediaTaskKey, app: 'wechat', kind: 'image',
                    state: 'failed', title: (message.mediaType || '图片') + '生成', hasResult: false
                });
            }
            this._cleanupWechatImageAbort(mediaTaskKey);
            this._refreshVisibleChatMessages(chatId);
            this.app.phoneShell?.showNotification('生图失败', friendlyMessage, '❌');"""
s = once(s, old5b, new5b, 'fail-upsert')

# ---------- ⑥ cancelImageGeneration + cleanup 助手 ----------
old6 = "    async _persistWechatGeneratedImage(imageUrl, { chatId = '', messageId = '', promptText = '', generationId = '' } = {}) {"
new6 = """    /** 清掉在飞中止记录（终态后不留残管）。 */
    _cleanupWechatImageAbort(key) {
        try { this._imageAbortControllers.delete(String(key || '')); } catch (_e) { /* 静默 */ }
    }
    /**
     * [v4.00.0 · R3-O7] 取消一次在飞的生图。
     *   只有 waiting / running 可取消（白名单在 config/media-task-registry.js）；
     *   取消即 abort 传输层 —— NAI 队列等待会 leave-queue（**不新增扣费请求**）；
     *   消息回 idle（不是 failed —— 用户主动取消不是失败），已有成果保留（重新生成中途取消）。
     * @returns {{ok:boolean, why:string}}
     */
    cancelImageGeneration(messageId) {
        const chatId = String(this.app.currentChat?.id || '').trim();
        const safeMessageId = String(messageId || '').trim();
        if (!chatId || !safeMessageId) return { ok: false, why: '缺少会话或消息 id' };
        const key = `wechat:img:${chatId}:${safeMessageId}`;
        const board = window.VirtualPhone?.mediaTasks || null;
        if (!board) return { ok: false, why: '任务注册板未就绪' };
        const gate = board.cancel(key);
        if (!gate.ok) return { ok: false, why: gate.why || '不可取消' };
        const ac = this._imageAbortControllers.get(key);
        if (ac) {
            try { ac.abort(); } catch (_e) { /* abort 失败也要继续收状态 */ }
            this._imageAbortControllers.delete(key);
        }
        const message = this.app.wechatData.getMessages(chatId)
            .find((item) => String(item?.id || '').trim() === safeMessageId);
        if (!message) return { ok: true, why: '' };
        this.app.wechatData.updateMessageById(chatId, safeMessageId, {
            imageGenStatus: String(message.generatedImageUrl || '').trim() ? 'done' : 'idle',
            imageGenerationId: '',
            imageGenerationRuntimeId: '',
            imageGenError: ''
        });
        this._refreshVisibleChatMessages(chatId);
        this.app.phoneShell?.showNotification('已取消', '已取消这次生成，没有新增扣费请求', '🚫');
        return { ok: true, why: '' };
    }
    async _persistWechatGeneratedImage(imageUrl, { chatId = '', messageId = '', promptText = '', generationId = '' } = {}) {"""
s = once(s, old6, new6, 'cancel-method')

assert s.count('mediaBoard.upsert') == 4, 'four upserts expected, got %d' % s.count('mediaBoard.upsert')
assert s.count('cancelImageGeneration(messageId)') == 1, 'cancel method exactly once'
assert s.count('mediaAbort.signal.aborted') == 1

if WRITE:
    wr('apps/wechat/chat-view.js', s)
    print('chat-view.js written OK')
else:
    print('DRY RUN OK (all anchors hit, no write)')