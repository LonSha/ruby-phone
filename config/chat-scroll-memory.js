/* ============================================================
 * config/chat-scroll-memory.js — [R25-O2] 会话滚动位置记忆（纯函数）
 * ------------------------------------------------------------
 * 【这一刀治的是什么（修前实测，读码可复算）】
 *   消息列表的**滚动位置**在切 App / 关面板 / 重开后一律丢掉：
 *     · `chat-view.js` 有一条 `this._lastScrollTop` 的**读**（万条兜底探针里算切片用），
 *       全仓**没有任何一处写**它 —— 所以那个探针永远读到 0，位置也从来没被记住；
 *     · 重开走 `container.scrollTop = container.scrollHeight`（贴底），于是用户
 *       「刚才翻到一半在找的那句」每次都要重新翻一遍。
 *   草稿那一半已经有人做了（`config/edit-buffer-binding.js`，key = `chat:<id>`），
 *   本件**只补位置这一半，不碰草稿**：一件事只许一个出处。
 *
 * 【本件只做三件事（纯函数：不碰 DOM、不写存储、不看时钟）】
 *   1 归一与解析：把盘上的原文收成恒定形状；读不出（坏 JSON / 类型不对）**如实标
 *     `unreadable` 并**带上原文**，由调用方先隔离再重建 —— 不许把「读不出」当「没记过」。
 *   2 记账：按会话记 `{ top, atBottom, at }`，条数超上限按最近使用淘汰，**淘汰数如实返回**。
 *   3 选择恢复：给出 `exact` / `clamped` / `bottom` / `absent` 四档，调用方据此决定要不要动
 *     scrollTop —— **不猜**：没记过不许假装「位置在顶部」。
 *
 * 【为什么贴底要单独一档】
 *   「在底部」和「顶部 0px」是两件事：贴底时界面默认就贴底，**不需要**写 scrollTop；
 *   而真在顶部 0px 时，若不恢复就会被贴底覆盖。压平成同一个 0，两种意图就混了。
 *
 * 【为什么时钟由参数给】纯函数不得自己看时间，否则「同一输入两次调用同一结果」失效，
 *   而判据正靠这条性质。
 * ============================================================ */
'use strict';

/** 台账键。只此一处，调用方不许再写字面量（同一口径一份实现）。 */
export const CSM_KEY = 'chat_scroll_memory_v1';
/** 读不出时的隔离键后缀：原文先搬到这里，**不直接覆盖**。 */
export const CSM_QUARANTINE_SUFFIX = '.corrupt';
/** 每个会话的记账只留这几样（多余字段一律丢掉，防键面越长越像「设置」）。 */
const CSM_FIELDS = ['top', 'atBottom', 'at'];
/** 记多少会话（超出按最久未用淘汰）。 */
export const CSM_MAX_CHATS = 40;

const isFiniteNum = (v) => (typeof v === 'number' && Number.isFinite(v));

/** 空的台账。 */
export function csmBlank() {
    return { schema: 'chat-scroll-memory@1', chats: {} };
}

function normalizeEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const top = isFiniteNum(raw.top) && raw.top >= 0 ? raw.top : null;
    if (top === null) return null;
    return {
        top: top,
        atBottom: raw.atBottom === true,
        at: isFiniteNum(raw.at) ? raw.at : null
    };
}

/**
 * 解析盘上原文（**不猜**）：
 *   · 没这个键（null / undefined）⇒ `absent`：**从没记过**，不是「记了空」；
 *   · 坏 JSON / 形状不对 ⇒ `unreadable`，带上 `rawText` 供调用方隔离；
 *   · 正常 ⇒ `ok`，逐条归一（坏条目丢弃并计数，不把坏条目当「位置 0」）。
 */
export function csmParse(raw) {
    if (raw === null || raw === undefined || raw === '') {
        return { face: 'absent', state: csmBlank(), reason: 'never-recorded', dropped: 0 };
    }
    let obj = raw;
    if (typeof raw === 'string') {
        try { obj = JSON.parse(raw); } catch (_e) {
            return { face: 'unreadable', state: csmBlank(), reason: 'bad-json', rawText: String(raw).slice(0, 4000), dropped: 0 };
        }
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        return { face: 'unreadable', state: csmBlank(), reason: 'not-an-object', rawText: String(raw).slice(0, 4000), dropped: 0 };
    }
    const src = (obj.chats && typeof obj.chats === 'object' && !Array.isArray(obj.chats)) ? obj.chats : {};
    const chats = {};
    let dropped = 0;
    for (const k of Object.keys(src)) {
        const id = String(k || '').trim();
        const entry = id ? normalizeEntry(src[k]) : null;
        if (entry) chats[id] = entry; else dropped += 1;
    }
    return { face: 'ok', state: { schema: 'chat-scroll-memory@1', chats: chats }, reason: 'ok', dropped: dropped };
}

/**
 * 记一条位置（返回**新**台账，不改入参）：
 *   · chatId 不成立 ⇒ 原样返回（不写进共享桶）；
 *   · 超上限 ⇒ 淘汰最久未用的（用 `at` 比，缺失的排最前），淘汰数如实返回。
 */
export function csmRemember(state, chatId, top, at, atBottom) {
    const id = (typeof chatId === 'string') ? chatId.trim() : '';
    const base = (state && state.chats && typeof state.chats === 'object') ? state : csmBlank();
    if (!id) return { state: base, dropped: 0 };
    const t = isFiniteNum(top) && top >= 0 ? top : 0;
    const chats = Object.assign({}, base.chats);
    chats[id] = { top: t, atBottom: atBottom === true, at: isFiniteNum(at) ? at : null };
    let dropped = 0;
    const ids = Object.keys(chats);
    if (ids.length > CSM_MAX_CHATS) {
        const order = ids.slice().sort((a, b) => {
            const av = isFiniteNum(chats[a].at) ? chats[a].at : -1;
            const bv = isFiniteNum(chats[b].at) ? chats[b].at : -1;
            return av - bv;
        });
        const victim = order[0];
        if (victim && victim !== id) { delete chats[victim]; dropped = 1; }
    }
    return { state: { schema: 'chat-scroll-memory@1', chats: chats }, dropped: dropped };
}

/**
 * 选择如何恢复（**四档，互不同形**）：
 *   · `absent`  —— 这个会话没记过（默认行为当它不存在：贴底，不假装「位置在顶部」）；
 *   · `bottom`  —— 记的是贴底位置（界面本来就会贴底，**不要**再写 scrollTop 去顶它）；
 *   · `exact`   —— 记的位置在当前可滚范围内，照抄；
 *   · `clamped` —— 记的位置超出当前可滚范围（窗口里的消息变少了），**如实**给上限值并标 clamped。
 */
export function csmRestoreOf(state, chatId, maxTop) {
    const id = (typeof chatId === 'string') ? chatId.trim() : '';
    const chats = (state && state.chats && typeof state.chats === 'object') ? state.chats : {};
    const entry = id ? chats[id] : null;
    if (!entry) return { face: 'absent', mode: 'none', top: 0, at: null, reason: 'never-recorded' };
    if (entry.atBottom === true) return { face: 'bottom', mode: 'none', top: 0, at: entry.at, reason: 'was-at-bottom' };
    const limit = isFiniteNum(maxTop) && maxTop > 0 ? maxTop : 0;
    if (entry.top > limit) {
        return { face: 'clamped', mode: 'exact', top: limit, at: entry.at, reason: 'out-of-range', wanted: entry.top };
    }
    return { face: 'exact', mode: 'exact', top: entry.top, at: entry.at, reason: 'ok' };
}

/** 判定「记下的位置」与「回读到的位置」是不是同一处（三态：不是二态）。 */
export function csmVerdict(savedTop, readTop, tolerance) {
    if (!isFiniteNum(savedTop) || !isFiniteNum(readTop)) {
        return { face: 'unknown', reason: 'not-a-number' };
    }
    const tol = isFiniteNum(tolerance) && tolerance >= 0 ? tolerance : 2;
    return Math.abs(savedTop - readTop) <= tol
        ? { face: 'same', reason: 'within-tolerance' }
        : { face: 'mismatch', reason: 'moved', delta: readTop - savedTop };
}

export function chatScrollMemorySelfCheck() {
    const bad = [];
    if (csmParse(null).face !== 'absent') bad.push('没记过应为 absent');
    if (csmParse('{oops').face !== 'unreadable') bad.push('坏 JSON 应为 unreadable');
    if (String(csmParse('{oops').rawText || '').length === 0) bad.push('unreadable 必须带原文');
    const p = csmParse(JSON.stringify({ chats: { a: { top: 120, atBottom: false, at: 5 } } }));
    if (p.face !== 'ok') bad.push('正常应为 ok');
    const r = csmRemember(p.state, 'a', 300, 9, false);
    if (r.state.chats.a.top !== 300) bad.push('记账没生效');
    if (p.state.chats.a.top !== 120) bad.push('记账改了入参');
    if (csmRestoreOf(r.state, 'a', 1000).face !== 'exact') bad.push('范围内应为 exact');
    if (csmRestoreOf(r.state, 'a', 100).face !== 'clamped') bad.push('越界应为 clamped');
    if (csmRestoreOf(csmRemember(p.state, 'b', 10, 1, true).state, 'b', 999).face !== 'bottom') bad.push('贴底应为 bottom');
    if (csmRestoreOf(p.state, 'zz', 999).face !== 'absent') bad.push('没记过的会话应为 absent');
    return { ok: bad.length === 0, bad };
}
