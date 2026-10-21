#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_o1_host.py — [v4.45.0 · 第五期 R5-O1] 宿主侧真接收者（取材板交接的落笔方）。

【修前实测处境（读码可复算）】
  `apps/creationdesk/creationdesk-view.js:316-318` 的按钮只调 `self.app.boardHandoff()`；
  `creationdesk-app.js:316-318` 返回 `this._board.handoff()` —— 那份读数里只有一个
  `handoff: { composeOwner: 'context-compose', budgetOwner: 'injection-router',
              draftOwner: 'creation-pipeline' }`，**三个字符串**。
  谁都没被调用，一个字节都没落笔。计划原文点名：「owner 字符串不是实际交接」。

【本补丁做四件事】
  ① 具名导入交接契约件与两键读写件（宿主是**草稿本**与**待用登记**的唯一写口）；
  ② 动作白名单加 `'board'`（**追加在末尾**：v4.01.0 的判据锁「白名单应以 plan 开头」，
     追加不动首项；本仓判据只锁首项与「有白名单判定」，不锁成员个数）；
  ③ `applyCreationdeskAction` 里加 `board` 分支：草稿 → 走既有 `cwWriteDrafts`
     （写后回读核对行数，读不回不算成功）；主聊天 → 走两键读写件登记（**登记 ≠ 已发送**）；
  ④ 读数字段加 `boardPending`（待用登记读数），供界面如实显示「已登记、未发送」。

【不做的三件（计划原文）】不把返回对象当交接（真落笔 + 写后回读）；不自动发布；
取材板不自行生成或发消息（主聊天那条只到「已登记、未发送」）。
用法：python3 tools/patch_o1_host.py [--write]
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
NL = chr(10)

IMPORT_ANCHOR = u"""import {
    TOPIC_KINDS, TOPIC_LIMITS, normalizeTopicEntry, normalizeTopicBook,
    buildTopicPage, reactionFor, markDraftsDebunked, topicSelfCheck as topicSelfCheckOf,
} from './config/topic-echo.js';"""

IMPORT_NEW = IMPORT_ANCHOR + u"""
/* [v4.45.0 · 第五期 R5-O1] 取材板 → 「创作草稿」/「下一次主聊天」的交接。
 *   为什么宿主也要持有这两件：取材板点下去要**真落笔**（草稿本与待用登记两处），
 *   而这两处的写口只有一处该存在（本仓「同一口径只许一份实现」）——
 *   契约件给判定与文案，两键读写件给落盘，宿主只做「把意图交上去 + 读回核对」。
 *   ★ 修前 `boardHandoff()` 端出的只有三个 owner **字符串**：谁都没被调用，
 *     一个字节都没落笔，而界面显示得像交过去了（「看起来没坏但显示不对」同族）。 */
import {
    MBH_STATES, MBH_TARGETS, MBH_DRAFT_SOURCE,
    normalizeHandoff as mbhNormalize, handoffLine as mbhLine,
} from './config/material-board-handoff.js';
import {
    receiveHandoff as mbhReceive, pendingHandoff as mbhPending,
    consumeHandoff as mbhConsume, markSent as mbhMarkSent,
    appliedKeys as mbhAppliedKeys, isApplied as mbhIsApplied,
} from './apps/creationdesk/board-chat-store.js';"""

TAKE_FN = u"""
    /**
     * [v4.45.0 · R5-O1] **主聊天侧取用口**（登记 → 取用 → 真发出去之后留痕）。
     *   为什么要有这一口：计划原文「发送主聊天必须另行显式确认，取材板不自行生成或发消息」——
     *   取材板只**登记**（`board` 动作的 chat 去向），取用与留痕归主聊天侧。
     *   ★ 取用**不等于已发送**：`consume` 只把登记交给调用方；只有调用方在**真发出去之后**
     *     调 `markSent` 才留痕。把这两步并成一步，就会把「带上了」显示成「发出去了」。
     * @returns {{ok:boolean, kind:string, note:string, pending:object|null}}
     */
    function boardChatTake() {
        try {
            const h = mbhConsume(storage);
            if (!h) return { ok: false, kind: 'no-pending', note: '没有登记过「下一次主聊天要带的材料」（不是「取用失败」）', pending: null };
            return {
                ok: true, kind: 'taken',
                note: '已取出 ' + String(h.count) + ' 条材料（**还没发送** —— 发送由你在主聊天里确认）',
                pending: h,
            };
        } catch (e) {
            return { ok: false, kind: 'take-threw', note: '取用失败：' + String((e && e.message) || e), pending: null };
        }
    }
    /** 真发出去之后如实留痕（**本函数不判断「发没发」**，由调用方给事实）。 */
    function boardChatMarkSent(key) {
        try { return { ok: mbhMarkSent(storage, key) === true }; }
        catch (_e) { return { ok: false }; }
    }
    /** 取材板交接的台账读数（已登记过的幂等键 + 某键在不在册）—— 只读，供诊断面用。 */
    function boardChatLedger(key) {
        try {
            const keys = mbhAppliedKeys(storage);
            return { keys: keys, count: keys.length, has: mbhIsApplied(storage, String(key || '')) };
        } catch (_e) { return { keys: [], count: 0, has: false }; }
    }
"""
# 草稿行归一：既有 `creation-multi-draft` 的 `normalizeDraft`（**不另写一份校验**）。
#   该模块此前只导出了 `normalizeDraftBook`，本版把单行归一也具名引进来。
CMD_IMPORT_OLD = u"    previewOf, diffDrafts, diffLine, cmdSelfCheck as cmdSelfCheckOf,"
CMD_IMPORT_NEW = u"    previewOf, diffDrafts, diffLine, cmdSelfCheck as cmdSelfCheckOf, normalizeDraft,"

MOUNT_ANCHOR = u"                applyCreationdeskAction: applyCreationdeskAction,"
MOUNT_NEW = u"""                applyCreationdeskAction: applyCreationdeskAction,
                /* [v4.45.0 · R5-O1] 取材板交接的**主聊天侧**三个口（取用 / 留痕 / 台账读数）。
                 *   与 `board` 动作成对：动作口负责登记，这三个口负责取用与留痕。 */
                boardChatTake: boardChatTake,
                boardChatMarkSent: boardChatMarkSent,
                boardChatLedger: boardChatLedger,"""

WHITELIST_OLD = u"    const CW_ACTION_KEYS = ['plan', 'publish', 'refresh', 'compose', 'edit', 'redo', 'drop', 'topic'];"
WHITELIST_NEW = u"""    /* [v4.45.0 · R5-O1] 末位追加 `board`：取材板交接的**真落笔**入口。
     *   ★ 追加不动首项（v4.01.0 的判据锁「白名单应以 plan 开头」）；
     *     本仓判据只锁首项与「有白名单判定」，不锁成员个数。 */
    const CW_ACTION_KEYS = ['plan', 'publish', 'refresh', 'compose', 'edit', 'redo', 'drop', 'topic', 'board'];"""

BRANCH_ANCHOR = u"""            if (action === 'compose' || action === 'edit' || action === 'redo' || action === 'drop') {"""

BRANCH_NEW = u"""            /* ══════ [v4.45.0 · 第五期 R5-O1] 取材板交接：**真落笔** ══════
             *   两条去向各自落到它该落的地方，且都**写后回读**：
             *     · draft → 既有草稿本（`cwWriteDrafts`：读不回不算成功）；
             *     · chat  → 两键读写件的待用登记（**登记 ≠ 已发送**）。
             *   ★ 不发布、不生成、不发消息：本分支没有任何 owner 调用与请求构造。
             *   ★ 记忆事实与 App 内容是**两套来源词表**，故草稿行如实带
             *     `source: MBH_DRAFT_SOURCE`（`material-board`）与自己的 refs ——
             *     拿记忆来源名去冒充 App 内容来源，会让「这条素材来自哪个 App」出现两套答案。 */
            if (action === 'board') {
                const input = (p.handoff && typeof p.handoff === 'object') ? p.handoff : p;
                const norm = mbhNormalize({
                    target: input.target, task: input.task, taskLabel: input.taskLabel,
                    asOf: input.asOf, items: input.items,
                });
                if (!norm.ok) {
                    const read = { ok: false, state: MBH_STATES.FAILED, why: norm.why, count: 0 };
                    return { ok: false, kind: norm.why, note: mbhLine(read), state: MBH_STATES.FAILED, why: norm.why };
                }
                if (norm.target === MBH_TARGETS.DRAFT) {
                    /* 落既有草稿本：**幂等键就是 norm.key**（同一份选定 + 同一去向只落一行）。 */
                    const bookNorm = normalizeDraftBook(cwReadDraftsRaw());
                    const exists = bookNorm.drafts.some(function (d) { return d.key === norm.key; });
                    if (exists) {
                        const read = { ok: true, state: MBH_STATES.REPLAYED, count: norm.items.length };
                        refreshCreationdesk();
                        return { ok: true, kind: 'board-replayed', note: mbhLine(read), state: MBH_STATES.REPLAYED, key: norm.key };
                    }
                    const nd = normalizeDraft({
                        key: norm.key,
                        source: MBH_DRAFT_SOURCE,
                        materialId: norm.refs.join(','),
                        target: 'draft',
                        note: norm.note,
                        tags: norm.tags,
                        version: 1,
                        state: 'editing',
                        at: Date.now(),
                    });
                    if (!nd.ok) {
                        const read = { ok: false, state: MBH_STATES.FAILED, why: 'handoff-no-ref', writeWhy: 'normalize:' + nd.reason, count: norm.items.length };
                        return { ok: false, kind: 'board-normalize', note: mbhLine(read), state: MBH_STATES.FAILED };
                    }
                    const book = upsertDraft(bookNorm.drafts, nd.draft);
                    const w = cwWriteDrafts(book.drafts);
                    refreshCreationdesk();
                    if (!w.ok) {
                        const read = { ok: false, state: MBH_STATES.FAILED, why: '', writeWhy: w.reason, count: norm.items.length };
                        return { ok: false, kind: w.reason, note: mbhLine(read), state: MBH_STATES.FAILED };
                    }
                    const read = { ok: true, state: MBH_STATES.DRAFTED, count: norm.items.length };
                    return { ok: true, kind: 'board-drafted', note: mbhLine(read), state: MBH_STATES.DRAFTED, key: norm.key, count: norm.items.length };
                }
                /* chat：登记「下一次要带的材料」（**登记 ≠ 已发送**）。 */
                const rec = mbhReceive(storage, {
                    target: norm.target, task: norm.task, taskLabel: norm.taskLabel,
                    asOf: norm.asOf, items: norm.items,
                });
                refreshCreationdesk();
                return {
                    ok: rec.state === MBH_STATES.PENDING,
                    kind: 'board-' + rec.state,
                    note: rec.line,
                    state: rec.state,
                    why: rec.why,
                    key: norm.key,
                    count: norm.items.length,
                };
            }
""" + BRANCH_ANCHOR

FACE_ANCHOR = u"""                drafts: drafts,"""
FACE_NEW = u"""                drafts: drafts,
                /* [v4.45.0 · R5-O1] 取材板交接的两处落点读数（**如实分列**）：
                 *   · pending —— 已登记、**未发送**的下一次主聊天材料（没有 ⇒ null，不拟一份）；
                 *   · drafted —— 草稿本里由取材板落下的那几行（按来源标识认，不猜）。
                 *   把「登记了」读成「已发送」是本项最该防的那件事，故两者**分开报**。 */
                boardPending: (function () {
                    try {
                        const h = mbhPending(storage);
                        if (!h) return null;
                        return {
                            key: h.key, target: h.target, task: h.task,
                            count: h.count, sent: h.sent, refs: h.refs.slice(),
                        };
                    } catch (_e) { return null; }
                })(),
                boardDraftedCount: (function () {
                    try {
                        const nb = normalizeDraftBook(cwReadDraftsRaw());
                        return nb.drafts.filter(function (d) { return d.source === MBH_DRAFT_SOURCE; }).length;
                    } catch (_e) { return 0; }
                })(),"""


def main():
    p = os.path.join(ROOT, 'index.js')
    with io.open(p, encoding='utf-8') as f:
        src = f.read()
    pairs = [
        (IMPORT_ANCHOR, IMPORT_NEW, 'import'),
        (WHITELIST_OLD, WHITELIST_NEW, 'whitelist'),
        (BRANCH_ANCHOR, BRANCH_NEW, 'board-branch'),
        (FACE_ANCHOR, FACE_NEW, 'face'),
        (CMD_IMPORT_OLD, CMD_IMPORT_NEW, 'cmd-import'),
        (MOUNT_ANCHOR, MOUNT_NEW, 'mount'),
        (BRANCH_ANCHOR, TAKE_FN + BRANCH_ANCHOR, 'take-fns'),
    ]
    for old, new, tag in pairs:
        n = src.count(old)
        assert n == 1, '[%s] anchor must hit exactly 1, got %d' % (tag, n)
        src = src.replace(old, new, 1)
        print('  %s ok' % tag)
    if not WRITE:
        print('--- DRY RUN (pass --write) ---')
        return 0
    with io.open(p, 'w', encoding='utf-8') as f:
        f.write(src)
    print('--- WRITTEN ---')
    return 0


if __name__ == '__main__':
    sys.exit(main())