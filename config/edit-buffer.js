/* ========================================================
 * config/edit-buffer.js — [v4.17.0 · R4-O5] 未点保存的编辑内容也能恢复(纯函数)
 * --------------------------------------------------------
 * 【这一刀治的是什么(修前实测,读码可复算)】
 *   全仓的编辑内容都活在**实例字段**上,且切会话一律清空:
 *     · `apps/creationdesk/creationdesk-app.js::setDraftNote` 只更新 `_draftNote`,
 *       而 input 监听调的就是它;**保存走另一个方法** `draftAct('...')`;
 *     · `config/workflow-designer.js` 的编辑草稿同样是实例态。
 *   于是「打了一半的文案」在三种常见动作里**全丢**:离开页面、刷新、切会话。
 *   仓库里已有的草稿本(**creation-multi-draft** / **workflow 模板**)只保证
 *   **已保存的版本** —— 它们回答的是「我上次存了什么」,而用户问的是
 *   「我刚打的那半句话还在吗」。两件事,必须分开一套账。
 *
 * 【本件只做四件事(纯函数:不碰 DOM、不写存储、不联网、不看时钟)】
 *   1 **缓冲归一**:把半成品收成恒定形状(文本 / 光标 / 目标 / 版本 / 已发布标记);
 *   2 **三态分辨**:`editing`(正在编辑,未保存)/ `saved`(已保存)/ `published`(已发布);
 *      —— 压平任意两态就会造出「我明明存了」与「我刚打的还在吗」同形的读数;
 *   3 **恢复选择**:拿「缓冲」与「已保存版本」比,产**选项**(恢复 / 丢弃 / 采纳旧的),
 *      **不自动覆盖**(验收原文逐字要求:恢复旧缓冲需选择);
 *   4 **守两条红线**:已发布内容不许被恢复缓冲反向覆盖;空缓冲不许把已保存版本顶掉。
 *
 * 【为什么时钟由参数给,不用 Date.now()】纯函数不得自己看时间 —— 那会让
 *   「同一输入两次调用得同一结果」这条性质失效,而判据正靠它。
 * ============================================================ */
'use strict';

/** 缓冲态(**三态互不同形,不许压平**)。 */
export const EB_STATES = Object.freeze({
    EDITING: 'editing',       // 正在编辑(有内容、未保存)—— 用户问的就是这一态
    SAVED: 'saved',           // 已保存(内容与存的一致)
    PUBLISHED: 'published',   // 已发布(内容已出去,**不许被缓冲反向覆盖**)
    EMPTY: 'empty'            // 缓冲是空的(没在编辑)—— 不是「丢了」
});

/** 恢复选项词表(判据按此表逐词核,防随口新词)。 */
export const EB_CHOICES = Object.freeze({
    KEEP_EDITING: 'keep-editing',   // 继续编辑缓冲(默认:不覆盖、不动)
    RESTORE_BUFFER: 'restore-buffer',// 用缓冲恢复(用户显式选)
    DROP_BUFFER: 'drop-buffer',     // 丢掉缓冲,回到已保存版本
    USE_SAVED: 'use-saved'          // 采纳已保存版本(缓冲被放弃)
});

/** 缓冲上限(与既有 CMD_LIMITS.textMax 同口径:2000)。 */
export const EB_TEXT_MAX = 2000;
/** 缓冲键前缀(与 config/storage.js 的 ^edit_ 同源;此处只给拼法,不碰 storage)。 */
export const EB_KEY_PREFIX = 'edit_buffer_';

/**
 * 一个 App 的缓冲键(`edit_buffer_<appId>`)。
 *   appId 不成立 ⇒ **空串**(调用方据此不写不读,而不是写进共享桶互相覆盖)。
 */
export function editBufferKey(appId) {
    const id = (typeof appId === 'string') ? appId.trim() : '';
    if (!id) return '';
    return EB_KEY_PREFIX + id;
}

/**
 * 归一一份编辑缓冲(**不猜**):
 *   · 文本一律字符串化并裁到上限(超长**如实标记** truncated,不静默截断);
 *   · 纯空白文本归 null(没在编辑);
 *   · 光标只认非负整数(0 是**合法**光标位)。
 * @returns {{text:string|null, caret:number|null, target:string|null,
 *            version:number, published:boolean, truncated:boolean, hasText:boolean}}
 */
export function normalizeEditBuffer(raw) {
    const r = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    const rawText = (typeof r.text === 'string') ? r.text : '';
    const over = rawText.length > EB_TEXT_MAX;
    const text = over ? rawText.slice(0, EB_TEXT_MAX) : rawText;
    const trimmed = text.trim();
    const caretRaw = r.caret;
    let caret = null;
    if (typeof caretRaw === 'number' && Number.isFinite(caretRaw)) {
        const n = Math.floor(caretRaw);
        if (n >= 0) caret = n;
    }
    const target = (typeof r.target === 'string' && r.target.trim()) ? r.target.trim() : null;
    const vRaw = r.version;
    const version = (typeof vRaw === 'number' && Number.isFinite(vRaw) && vRaw > 0) ? Math.floor(vRaw) : 1;
    const published = r.published === true;
    return {
        text: trimmed ? text : null,
        caret,
        target,
        version,
        published,
        truncated: over,
        hasText: !!trimmed
    };
}

/**
 * 判三态(+ 空态):拿缓冲与「已保存版本」比。
 *
 * 判据顺序刻意固定(顺序本身是口径):
 *   1 **已发布**优先 —— 内容已经出去了,不管缓冲里是什么,这一态都不许被顶;
 *   2 缓冲空 ⇒ `empty`(没在编辑,**不是**「丢了」);
 *   3 文本与已保存一致 ⇒ `saved`(已经在库里了,不需要恢复);
 *   4 其余 ⇒ `editing`(**这就是用户问的那一态**)。
 *
 * @param {object} buffer normalizeEditBuffer 的结果或任意值
 * @param {{text?:string, version?:number, published?:boolean}} [saved] 已保存版本
 */
export function editBufferState(buffer, saved) {
    const b = normalizeEditBuffer(buffer);
    const s = (saved && typeof saved === 'object') ? saved : null;
    const savedText = (s && typeof s.text === 'string') ? s.text : '';
    if (b.published === true || (s && s.published === true)) return EB_STATES.PUBLISHED;
    if (!b.hasText) return EB_STATES.EMPTY;
    if (savedText && savedText === b.text) return EB_STATES.SAVED;
    return EB_STATES.EDITING;
}

/**
 * 恢复选择:**只产出选项,不改任何东西**(验收原文:恢复旧缓冲需选择,不自动覆盖新版本)。
 *
 * 【两条红线写在这里,不靠调用方记得】
 *   1 已发布 ⇒ 只给 `KEEP_EDITING`(缓冲留着可见,但**不许**拿它覆盖已发布的内容);
 *   2 缓冲为空 ⇒ 只给 `USE_SAVED`(没有可恢复的东西,不假装能恢复)。
 *
 * @returns {{ok:boolean, state:string, defaultChoice:string, choices:Array<{choice:string, why:string}>, blockReason:string}}
 */
export function editRecoveryPlan(buffer, saved) {
    const b = normalizeEditBuffer(buffer);
    const st = editBufferState(b, saved);
    const out = { ok: true, state: st, defaultChoice: EB_CHOICES.KEEP_EDITING, choices: [], blockReason: '' };
    if (st === EB_STATES.PUBLISHED) {
        out.defaultChoice = EB_CHOICES.KEEP_EDITING;
        out.blockReason = 'published-not-overwritable(已发布的内容不许被编辑缓冲反向覆盖)';
        out.choices = [{ choice: EB_CHOICES.KEEP_EDITING, why: '缓冲留着,但不会覆盖已发布的内容' }];
        return out;
    }
    if (st === EB_STATES.EMPTY) {
        out.defaultChoice = EB_CHOICES.USE_SAVED;
        out.choices = [{ choice: EB_CHOICES.USE_SAVED, why: '没有半成品可恢复(不是「丢了」)' }];
        return out;
    }
    if (st === EB_STATES.SAVED) {
        out.defaultChoice = EB_CHOICES.USE_SAVED;
        out.choices = [
            { choice: EB_CHOICES.USE_SAVED, why: '缓冲与已保存的一致,用它即可' },
            { choice: EB_CHOICES.DROP_BUFFER, why: '清掉缓冲(内容已在库里)' }
        ];
        return out;
    }
    /* editing:三个选项都在,**默认 keep-editing**(什么都不动是最安全的一档)。 */
    out.choices = [
        { choice: EB_CHOICES.KEEP_EDITING, why: '继续编辑这段半成品(不动任何已保存内容)' },
        { choice: EB_CHOICES.RESTORE_BUFFER, why: '用这段半成品恢复(会替换当前编辑框里的内容)' },
        { choice: EB_CHOICES.DROP_BUFFER, why: '丢掉这段半成品,回到已保存版本' }
    ];
    return out;
}

/**
 * 采纳某个选择(**纯**:返回新状态,不改入参)。
 *   · 选 `RESTORE_BUFFER` 时,**已发布的内容仍不许被覆盖** —— 此时返回 blocked 并如实说明;
 *   · 选 `DROP_BUFFER` ⇒ 缓冲清空;
 *   · 其余 ⇒ 缓冲原样留着。
 *
 * @returns {{ok:boolean, blocked:boolean, reason:string, buffer:object, applied:string}}
 */
export function applyRecoveryChoice(choice, buffer, saved) {
    const b = normalizeEditBuffer(buffer);
    const st = editBufferState(b, saved);
    const c = (typeof choice === 'string') ? choice : '';
    const empty = { text: null, caret: null, target: b.target, version: b.version, published: b.published };
    if (st === EB_STATES.PUBLISHED && c === EB_CHOICES.RESTORE_BUFFER) {
        return { ok: false, blocked: true, reason: 'published-not-overwritable', buffer: b, applied: '' };
    }
    if (c === EB_CHOICES.DROP_BUFFER) {
        return { ok: true, blocked: false, reason: '', buffer: empty, applied: c };
    }
    if (c === EB_CHOICES.RESTORE_BUFFER) {
        return { ok: true, blocked: false, reason: '', buffer: b, applied: c };
    }
    if (c === EB_CHOICES.USE_SAVED || c === EB_CHOICES.KEEP_EDITING) {
        return { ok: true, blocked: false, reason: '', buffer: b, applied: c };
    }
    /* 未登记的选择词 ⇒ 如实拒绝,**不猜**(不把它当成某一个选项)。 */
    return { ok: false, blocked: false, reason: 'unknown-choice:' + c, buffer: b, applied: '' };
}

/**
 * 保存回执 → 缓冲该变成什么(**保存失败必须保留文字**)。
 *
 * 验收原文:「保存失败显示未保存并保留文字」—— 故这条判据是
 *   **失败时缓冲一字不能丢**,且如实报 `state:'unsaved'` 与原因。
 *
 * @param {{saved:boolean, why?:string}} receipt 保存回执(调用方据实给)
 * @param {object} buffer 原缓冲
 * @returns {{ok:boolean, state:string, buffer:object, reason:string}}
 *   state 三态:`saved`(已落库 ⇒ 缓冲可清)/ `unsaved`(失败 ⇒ **文字保留**)/ `unknown`(回执读不出 ⇒ 也保留文字)
 */
export function afterSaveAttempt(receipt, buffer) {
    const b = normalizeEditBuffer(buffer);
    const r = (receipt && typeof receipt === 'object') ? receipt : null;
    if (!r || typeof r.saved !== 'boolean') {
        return { ok: false, state: 'unknown', buffer: b, reason: 'receipt-unreadable(读不出 ⇒ 宁可留着文字)' };
    }
    if (r.saved === true) {
        return { ok: true, state: 'saved', buffer: { text: null, caret: null, target: b.target, version: b.version, published: b.published }, reason: '' };
    }
    return { ok: false, state: 'unsaved', buffer: b, reason: String(r.why || 'save-failed') };
}

/** 三态(+空态)的一句话归因(唯一实现;**四态各有各的形**)。 */
export function editBufferLine(state) {
    switch (state) {
        case EB_STATES.EDITING: return '有未保存的编辑(离开也能恢复)';
        case EB_STATES.SAVED: return '这段内容已经保存了';
        case EB_STATES.PUBLISHED: return '这段内容**已发布** —— 编辑缓冲不会覆盖它';
        case EB_STATES.EMPTY: return '没有未保存的编辑(不是「丢了」)';
        default: return '';
    }
}

export default {
    EB_STATES, EB_CHOICES, EB_TEXT_MAX, EB_KEY_PREFIX,
    editBufferKey, normalizeEditBuffer, editBufferState,
    editRecoveryPlan, applyRecoveryChoice, afterSaveAttempt, editBufferLine
};