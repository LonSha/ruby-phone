/* ========================================================
 * config/view-state.js — [v4.15.0 · R4-O3] 页面状态捕获与恢复(纯函数)
 * --------------------------------------------------------
 * 【这一刀治的是什么(修前实测,读码可复算)】
 *   页面栈**早就存在**(`phone/phone-shell.js` 的 `viewHistory` 与 `_applyViewLayerState`),
 *   所以本项**不是**「再建一个返回栈」。真实的缺口在两头:
 *     1 **返回键只回桌面**:`bindBackButton` 的 click 分支写的是
 *        `if (this.isAtHomeScreen()) return; this.goHome();` —— 从搜索跳进微信再按返回,
 *        用户被直接丢回桌面,而不是回到搜索;右滑那条路(SWIPE_BACK)才是逐层退。
 *        两条路给出两个语义,而用户看到的是**同一个「返回」**。
 *     2 **状态没人捕获**:`apps/taskentry/taskentry-app.js::markLeft` 的注释逐字写着
 *        「本件**不做恢复动作**」—— 全仓 `restorePlan` 的唯一消费点是「给恢复读数」,
 *        没有任何一处真的把页签 / 查询 / 锚点 / 滚动**写回**给页面。
 *        读数是「恢复了没有」,而不是「恢复」。
 *
 * 【本件只做两件事(不碰 DOM、不写存储、不新建路由)】
 *   1 **快照归一**:把任意来源的状态收成恒定四格(页签 / 查询 / 锚点 / 滚动);
 *   2 **会话围栏**:恢复前先问「这份快照还是这个会话的吗」——
 *      换会话后把上一段的查询词与滚动位置贴回新会话,是本仓最贵的那族静默错结果。
 *
 * 【为什么会话围栏必须在这里,而不是「由 storage 键前缀保证」】
 *   键前缀(`^view_` 落 chatMetadata)保证的是**存储位置**按会话隔开;
 *   它**不**保证「我手上这份快照是给当前会话的」。两条都要:
 *   用户在 A 会话捕获了一份快照,还没写盘就切到 B —— 此时内存里那份是 A 的。
 *   故本件把 `chatId` 一并写进快照并逐次比对,**不一致即拒绝恢复**。
 * ============================================================ */
'use strict';

/** 快照四格(**登记表**:改这里即口径变化;与既有的 DF_RESTORE_FIELDS 同名同序)。 */
export const VIEW_STATE_KEYS = Object.freeze(['tab', 'query', 'anchor', 'scroll']);

/** 恢复态(**五态互不同形,不许压平**)。 */
export const VIEW_STATE_STATES = Object.freeze({
    OK: 'ok',                       // 有快照、会话一致 ⇒ 可恢复
    NO_SNAPSHOT: 'no-snapshot',     // 从来没捕获过(第一次打开这个 App)—— **不是「丢了」**
    EMPTY: 'empty',                 // 捕获过但四格全空(用户没动过任何东西)—— 也不是「丢了」
    WRONG_SESSION: 'wrong-session', // 快照是**另一个会话**的 ⇒ 拒绝恢复(不是「没有快照」)
    UNREADABLE: 'unreadable'        // 形态读不出(畸形 JSON / 非对象)—— 与「没捕获过」分开
});

/** 存储键前缀(与 `config/storage.js` 的 `^view_` 前缀同源;此处只给拼法,不碰 storage)。 */
export const VIEW_STATE_KEY_PREFIX = 'view_state_';

/**
 * 一个 App 的会话级快照键(`view_state_<appId>`)。
 *   appId 取不到 ⇒ 返回空串(调用方据此**不写不读**,而不是写到 `view_state_` 这个桶里 ——
 *   那会让所有 appId 缺失的调用互相覆盖)。
 */
export function viewStateKey(appId) {
    const id = (typeof appId === 'string') ? appId.trim() : '';
    if (!id) return '';
    return VIEW_STATE_KEY_PREFIX + id;
}

/**
 * 把任意来源的状态收成恒定四格(**不猜**):
 *   · 四格一律存在(缺的写 null),读者不必再判 undefined;
 *   · 字符串化的值做 trim(空白查询等于没查询);
 *   · `scroll` 只认有限数(0 是**合法**滚动位,不得被读成「没给」)。
 * @returns {{tab:string|null, query:string|null, anchor:string|null, scroll:number|null, hasAny:boolean}}
 */
export function normalizeViewSnapshot(raw) {
    const r = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    const str = (v) => {
        if (typeof v !== 'string') return null;
        const t = v.trim();
        return t ? t : null;
    };
    const num = (v) => {
        if (typeof v === 'number') return Number.isFinite(v) ? v : null;
        if (typeof v === 'string' && v.trim()) {
            const n = Number(v);
            return Number.isFinite(n) ? n : null;
        }
        return null;
    };
    const out = {
        tab: str(r.tab),
        query: str(r.query),
        anchor: str(r.anchor),
        scroll: num(r.scroll)
    };
    out.hasAny = VIEW_STATE_KEYS.some((k) => out[k] !== null);
    return out;
}

/**
 * 捕获:把一份状态收成**带会话身份的快照**(供落盘)。
 *
 * 记 `chatId` 是**刻意的**:它让「这份快照属于哪一段」成为结构上的事实,
 *   而不是靠调用方记得在换会话时清干净(那种「靠记得」的纪律在本仓被证明过不可靠)。
 *
 * @param {string} appId
 * @param {object} raw 四格原始值
 * @param {string} chatId 当前会话身份(取不到允许为空串 —— **空串会在恢复时判 wrong-session**,fail-closed)
 * @returns {{appId:string, chatId:string, snapshot:object, hasAny:boolean}|null} appId 不成立时 **null**
 */
export function captureViewState(appId, raw, chatId) {
    const id = (typeof appId === 'string') ? appId.trim() : '';
    if (!id) return null;
    const snap = normalizeViewSnapshot(raw);
    return {
        appId: id,
        chatId: (typeof chatId === 'string') ? chatId : '',
        snapshot: { tab: snap.tab, query: snap.query, anchor: snap.anchor, scroll: snap.scroll },
        hasAny: snap.hasAny
    };
}

/**
 * 恢复判定(**只判,不改任何东西**):这份存档能不能贴回当前会话?
 *
 * 判据顺序刻意固定:
 *   1 形态读不出 ⇒ `unreadable`(**不是**「没捕获过」);
 *   2 存档不在 ⇒ `no-snapshot`;
 *   3 **会话不一致 ⇒ `wrong-session`**(拒绝恢复,不是「没有快照」);
 *   4 四格全空 ⇒ `empty`;
 *   5 其余 ⇒ `ok`。
 *
 * @param {string} appId
 * @param {*} stored 存档(任意值:JSON 解出的对象 / 字符串 / null)
 * @param {string} chatId 当前会话身份
 */
export function restoreViewState(appId, stored, chatId) {
    const id = (typeof appId === 'string') ? appId.trim() : '';
    if (!id) return { ok: false, state: VIEW_STATE_STATES.UNREADABLE, snapshot: null, why: 'app-id-missing' };
    let obj = stored;
    if (typeof obj === 'string') {
        try { obj = JSON.parse(obj); } catch (_e) {
            return { ok: false, state: VIEW_STATE_STATES.UNREADABLE, snapshot: null, why: 'bad-json' };
        }
    }
    if (obj === null || obj === undefined) {
        return { ok: false, state: VIEW_STATE_STATES.NO_SNAPSHOT, snapshot: null, why: 'never-captured' };
    }
    if (typeof obj !== 'object' || Array.isArray(obj)) {
        return { ok: false, state: VIEW_STATE_STATES.UNREADABLE, snapshot: null, why: 'not-object' };
    }
    if (obj.appId !== undefined && String(obj.appId) !== id) {
        return { ok: false, state: VIEW_STATE_STATES.UNREADABLE, snapshot: null, why: 'app-mismatch' };
    }
    const cur = (typeof chatId === 'string') ? chatId : '';
    const saved = (typeof obj.chatId === 'string') ? obj.chatId : '';
    /* ★ 会话围栏:两串必须逐字相等。**空串对空串也算一致** ——
     *   调用方拿不到会话身份时,两侧都是空串,这时按「同一段」处置是**唯一不产生错贴**的选择
     *   (`storage` 键前缀已经把物理位置按会话隔开了,此处承担的是「手上这份是谁的」)。 */
    if (saved !== cur) {
        return { ok: false, state: VIEW_STATE_STATES.WRONG_SESSION, snapshot: null, why: 'chat-mismatch' };
    }
    const snap = normalizeViewSnapshot(obj.snapshot);
    if (!snap.hasAny) {
        return { ok: false, state: VIEW_STATE_STATES.EMPTY, snapshot: { tab: null, query: null, anchor: null, scroll: null }, why: 'all-empty' };
    }
    return {
        ok: true, state: VIEW_STATE_STATES.OK, why: '',
        snapshot: { tab: snap.tab, query: snap.query, anchor: snap.anchor, scroll: snap.scroll }
    };
}

/** 该不该为了恢复而重跑一次取数(查询词在,但结果会随重绘丢)。 */
export function needsRequery(snapshot) {
    const s = normalizeViewSnapshot(snapshot);
    /* 只问一件事:有没有查询词。`tab` 与它无关 —— 首版写成
     *   `s.query && s.tab === null ? true : s.query`,两种分支返回的是**同一个值**,
     *   那个三元只是个迷惑写法(自抓:它让读者以为 tab 参与判定)。 */
    return !!s.query;
}

/** 五态的一句话归因(唯一实现;供视图/诊断念出)。**五态各有各的形**。 */
export function viewStateLine(state) {
    switch (state) {
        case VIEW_STATE_STATES.OK: return '恢复到了离开时的样子';
        case VIEW_STATE_STATES.NO_SNAPSHOT: return '第一次打开这个页面(没有可恢复的旧状态)';
        case VIEW_STATE_STATES.EMPTY: return '上次离开时什么都没设(没必要恢复)';
        case VIEW_STATE_STATES.WRONG_SESSION: return '那份状态属于**另一个会话** —— 已拒绝恢复(不贴错)';
        case VIEW_STATE_STATES.UNREADABLE: return '那份状态读不出(形态坏了)—— 不是「没保存过」';
        default: return '';
    }
}

export default {
    VIEW_STATE_KEYS, VIEW_STATE_STATES, VIEW_STATE_KEY_PREFIX,
    viewStateKey, normalizeViewSnapshot, captureViewState, restoreViewState,
    needsRequery, viewStateLine
};