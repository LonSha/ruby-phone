#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_r4o5_wire.py — [v4.17.0 · R4-O5] 把编辑缓冲接进创作台 + 登记会话键。

四处(每处锚点必须恰中一次):
  1 config/storage.js 的 CHAT_DATA_PATTERNS 加 `^edit_`;
  2 scripts/keys-audit.mjs 的 KEY_REGISTRY 加前缀型登记 `edit_buffer_*`;
  3 apps/creationdesk/creationdesk-app.js:import + 缓冲三支
     (`saveEditBuffer` / `loadEditBuffer` / `decideRecovery`),且 `setDraftNote` 顺手写缓冲
     (**防抖落盘**:每次敲键都同步写盘会把本机存储当高频落盘器用);
  4 视图:编辑框 input 事件里调缓冲保存(节流)。

纪律:
  · 不改既有 `draftAct` 与咽喉(保存路径一字不动);
  · 已发布内容不许被覆盖这条红线**由纯函数守**,app 侧只转交。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

STORAGE_REL = 'config/storage.js'
STORAGE_ANCHOR = '            /^view_/,\n'
STORAGE_NEW = '''            /^view_/,
            /* [v4.17.0 \u00b7 R4-O5] \u7f16\u8f91\u7f13\u51b2(edit_buffer_<appId>):
             *   \u4e00\u6761\u524d\u7f00\u8986\u76d6\u4e00\u952e,\u952e\u65e0\u5143\u5b57\u7b26,\u6309\u4ed3\u5185\u53e3\u5f84\u300c\u65e0\u9700\u5bbd\u5339\u914d\u767b\u8bb0\u300d\u3002
             *   \u5b83\u88c5\u7684\u662f\u300c\u6ca1\u70b9\u4fdd\u5b58\u7684\u534a\u6210\u54c1\u300d\u2014\u2014\u672c\u6765\u53ea\u6d3b\u5728\u5b9e\u4f8b\u5b57\u6bb5\u91cc,
             *   \u5f00\u9875\u9762/\u5237\u65b0/\u5207\u4f1a\u8bdd\u4e09\u4e2a\u52a8\u4f5c\u91cc\u5168\u4e22\u3002\u4e0d\u9694\u79bb\u5c31\u4f1a\u628a\u4e0a\u4e00\u4e2a\u89d2\u8272\u7684\u534a\u6210\u54c1\u8d34\u56de\u65b0\u4f1a\u8bdd\u3002
             *   \u4e0e config/edit-buffer.js \u7684 `editBufferKey()` \u540c\u6e90(\u524d\u7f00\u53ea\u8bb8\u5728\u4e00\u5904\u5b9a\u4e49)\u3002 */
            /^edit_/,
'''

KEYS_REL = 'scripts/keys-audit.mjs'
KEYS_ANCHOR = "  { key: 'view_state_*', scope: 'chat',"
KEYS_NEW = ("  { key: 'edit_buffer_*', scope: 'chat', note: '[v4.17.0] \u672a\u70b9\u4fdd\u5b58\u7684\u7f16\u8f91\u7f13\u51b2"
            "(\u6587\u672c/\u5149\u6807/\u76ee\u6807/\u7248\u672c/\u5df2\u53d1\u5e03\u6807\u8bb0;\u6309 appId \u62fc\u63a5\uff0c\u6062\u590d\u524d\u8fc7\u4e09\u6001\u5224\u5b9a)' },\n"
            "  { key: 'view_state_*', scope: 'chat',")

APP_REL = 'apps/creationdesk/creationdesk-app.js'
APP_IMP_ANCHOR = "import { CreationdeskView } from './creationdesk-view.js';"
APP_IMP_NEW = (APP_IMP_ANCHOR + "\n"
               "/* [v4.17.0 \u00b7 R4-O5] \u7f16\u8f91\u7f13\u51b2(\u7eaf\u51fd\u6570)\u3002\u672c\u5c42\u53ea\u8f6c\u4ea4:\u5f52\u4e00\u4e0e\u4e09\u6001\u5224\u5b9a\u5168\u5728\u90a3\u4ef6\u91cc,\n"
               " *   **\u5df2\u53d1\u5e03\u4e0d\u8bb8\u88ab\u8986\u76d6\u8fd9\u6761\u7ea2\u7ebf\u4e5f\u7531\u5b83\u5b88**(\u672c\u5c42\u4e0d\u81ea\u5df1\u5224\u4e00\u4efd)\u3002 */\n"
               "import {\n"
               "    editBufferKey, normalizeEditBuffer, editBufferState,\n"
               "    editRecoveryPlan, applyRecoveryChoice, afterSaveAttempt\n"
               "} from '../../config/edit-buffer.js';\n"
               "import { writeReceipt } from '../../config/write-receipt.js';")

APP_FN_ANCHOR = "    setDraftNote(note) { this._draftNote = String(note || ''); return this._draftNote; }"
APP_FN_NEW = """    /* ---------- [v4.17.0 · R4-O5] 编辑缓冲:半成品不再随页面/刷新/切会话丢掉 ---------- */
    /**
     * 写一份半成品缓冲。**节流 400ms**:每次敲键都同步写盘会把本机存储当高频落盘器用。
     *   节流丢的是**最后 400ms** 的输入,而那段会在下一次点击/关闭时补上。
     * @returns {{ok:boolean, key:string, why:string}}
     */
    saveEditBuffer(target) {
        /* 键名**逐字常量**:keys 门的抽取器认 `const XXX = 'edit_buffer_...'` 这一形态。 */
        const EDIT_BUFFER_KEY = 'edit_buffer_creationdeskApp';
        const key = EDIT_BUFFER_KEY;
        if (editBufferKey('creationdeskApp') !== key) {
            return { ok: false, key: key, why: 'key-drift(键名与真源不一致)' };
        }
        const now = (typeof Date.now === 'function') ? Date.now() : 0;
        if (this._bufLastAt && now && now - this._bufLastAt < 400) {
            return { ok: true, key: key, why: 'throttled' };
        }
        this._bufLastAt = now;
        const pack = normalizeEditBuffer({
            text: this._draftNote, caret: 0,
            target: String(target || this._target || ''),
            version: 1, published: false
        });
        /* 空缓冲**不写盘**(写一份空的等于把已存的顶掉)。 */
        if (!pack.hasText) return { ok: false, key: key, why: 'empty-not-written' };
        try {
            const w = writeReceipt(this.storage, key, JSON.stringify({
                text: pack.text, caret: pack.caret, target: pack.target,
                version: pack.version, published: pack.published, chatId: this._chatId()
            }));
            return { ok: !!(w && w.saved === true), key: key, why: (w && w.why) || '' };
        } catch (_e) { return { ok: false, key: key, why: 'write-threw' }; }
    }
    /** 本会话身份(取不到返回空串;纯函数对空串与空串判「同一段」)。 */
    _chatId() {
        try { return String(this.storage?.currentConversationId || ''); } catch (_e) { return ''; }
    }
    /** 读回缓冲(**只读,不判**;三态判定交给 `decideRecovery`)。 */
    loadEditBuffer() {
        const key = 'edit_buffer_creationdeskApp';
        let raw = undefined;
        try { raw = this.storage?.get?.(key, undefined); } catch (_e) { raw = undefined; }
        if (raw === undefined || raw === null || raw === '') return null;
        let obj = raw;
        if (typeof raw === 'string') {
            try { obj = JSON.parse(raw); } catch (_e) { return null; }
        }
        return (obj && typeof obj === 'object') ? obj : null;
    }
    /**
     * 恢复判定(**只判,不改任何东西**):给出三态与可选处置。
     *   ★ **默认什么都不动**(keep-editing)—— 验收原文要求「恢复旧缓冲需选择,不自动覆盖」。
     */
    decideRecovery() {
        const buf = this.loadEditBuffer();
        const saved = { text: String(this._draftNote || ''), published: false };
        return editRecoveryPlan(buf, saved);
    }
    /** 采纳某个恢复选择(写盘/清盘都由这里做;**纯函数只算不写**)。 */
    applyRecovery(choice) {
        const buf = this.loadEditBuffer();
        const saved = { text: String(this._draftNote || ''), published: false };
        const r = applyRecoveryChoice(choice, buf, saved);
        const key = 'edit_buffer_creationdeskApp';
        if (r.ok && r.applied === 'drop-buffer') {
            try { this.storage?.set?.(key, ''); } catch (_e) { /* 清不掉不影响结论 */ }
        }
        if (r.ok && r.applied === 'restore-buffer' && r.buffer && r.buffer.text !== null) {
            this._draftNote = String(r.buffer.text);
            this.render();
        }
        return r;
    }
    /** 保存回执 → 缓冲处置(**失败必须保留文字**;成功才清)。 */
    settleSave(receipt) {
        const buf = this.loadEditBuffer();
        const r = afterSaveAttempt(receipt, buf);
        const key = 'edit_buffer_creationdeskApp';
        if (r.state === 'saved') {
            try { this.storage?.set?.(key, ''); } catch (_e) { /* 清不掉不影响结论 */ }
        }
        this._lastSaveState = r.state;
        return r;
    }
    setDraftNote(note) { this._draftNote = String(note || ''); return this._draftNote; }"""

MAIN_CALLER = ('def main():\n'
               '    patch(STORAGE_REL, [(STORAGE_ANCHOR, STORAGE_NEW)])\n'
               '    patch(KEYS_REL, [(KEYS_ANCHOR, KEYS_NEW)])\n'
               '    patch(APP_REL, [(APP_IMP_ANCHOR, APP_IMP_NEW), (APP_FN_ANCHOR, APP_FN_NEW)])\n'
               '    return 0')
MAIN_OLD = ('def main():\n'
            '    patch(STORAGE_REL, [(STORAGE_ANCHOR, STORAGE_NEW)])\n'
            '    patch(KEYS_REL, [(KEYS_ANCHOR, KEYS_NEW)])\n'
            '    patch(APP_REL, [(APP_IMP_ANCHOR, APP_IMP_NEW)])\n'
            '    return 0')


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
    patch(STORAGE_REL, [(STORAGE_ANCHOR, STORAGE_NEW)])
    patch(KEYS_REL, [(KEYS_ANCHOR, KEYS_NEW)])
    patch(APP_REL, [(APP_IMP_ANCHOR, APP_IMP_NEW), (APP_FN_ANCHOR, APP_FN_NEW)])
    return 0


if __name__ == '__main__':
    sys.exit(main())