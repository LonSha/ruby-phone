/* ========================================================
 * config/inline-action-ledger.js — [v4.120.0 · 第十四期 R14-O5]
 * 「就地办」的**稳定来源身份 + 幂等提交台账**（纯函数，零副作用）
 * --------------------------------------------------------
 * 【这一刀治的是什么（修前实测处境）】
 *   `config/inline-action-commit.js` 的 `commitAction` 每调一次就 `cal.addMemo(...)` 一次，
 *   而动作条的 `_commit` 只把结果存在实例内存里（`this._done`）。于是：
 *     · **双击** ⇒ 两次 `addMemo` ⇒ 日历里两条一模一样的日程（用户点两下，数据错一次）；
 *     · **刷新 / 重进会话** ⇒ `_done` 清空、按钮重新变成「加入日程」⇒ 再点又是一条；
 *     · **源句被改过**（重新生成 / 编辑消息）⇒ 标题变了，用户以为是同一件事，实际又加一条；
 *     · **撤后重办** ⇒ 撤销后 `_done` 删了，再点确实要新建 —— 这条本身没错，但它与上面三种
 *       在代码里长得一模一样（都是「调 commitAction」），故必须由台账把三者分开。
 *   ⇒ 本件把「这条消息上的这一档动作办过没有」从**实例内存**挪到**会话内的持久台账**，
 *   并给每种重复形态一个可区分的归因词。
 *
 * 【为什么身份只用 `sourceMsgId|kind`，不用标题哈希】
 *   标题是从源句派生的。若把标题算进身份，「源句一改就变成另一件事」—— 那正是本项要
 *   能**看见**的形态（drifted），不能让它悄悄变成新身份。反过来，日期变了也仍属同一件事
 *   （同一句话上的同一档动作），只是「这一次算出来的日子不同」。故：
 *     · **身份**（identity）= `sourceMsgId|kind` —— 稳，跨刷新不变；
 *     · **指纹**（fingerprint）= `title|dateKey|time` —— 回答「这次算出来的内容跟上次一样吗」。
 *
 * 【四种重复形态，处置不同】
 *   new       台账里没有 ⇒ 正常新建；
 *   replayed  同身份、同指纹、已办过 ⇒ **不新建**，把旧回执原样交回（双击只新增一条）；
 *   drifted   同身份、指纹变了（源句或日期变了）⇒ **允许新建**（用户确实改了这件事），
 *             但旧记录标 `superseded` 并把旧回执一并交回，回执文案必须写明「上一条已作废」；
 *   recommit  同身份、上次已撤销 ⇒ 正常新建（撤后重办，这是合法的重办，不是重复）。
 *
 * 【撤销的三条纪律】
 *   ① **只撤这一档动作创建的那一条**：按 `memoId` 删，不按标题找 —— 同标题的日程可能有多条，
 *      按标题找会删掉别人手写的那一条；
 *   ② **条目被人工改过就不静默删**：标题 / 日期 / 时间任一项与创建时不同 ⇒ 报 `modified-since`，
 *      让用户自己看一眼再决定（静默删掉用户改过的内容 = 数据无声消失）；
 *   ③ **条目已经不在** ⇒ 报 `entry-missing`，不报成功（否则回执说「已撤销」，用户去回收站找不到）。
 *
 * 【为什么台账落 storage 而 `_done` 不】
 *   `_done` 的作用是「界面上这一格现在是回执态」，它本来就该跟界面一起消失；
 *   台账的作用是「这件事**办过**」，它必须跨刷新、跨重进会话仍然成立。两者职责不同，
 *   故台账不能复用 `_done`，也不能只留内存。键名走 `ia_` 前缀 —— 命中 `config/storage.js`
 *   的会话隔离族（本仓铁律：会话内的账不落全局，否则换角色能看到上一个角色的回执）。
 * ============================================================ */
'use strict';

/** 台账的落盘键（随会话隔离：`/^ia_/` 需在 storage 的 CHAT_DATA_PATTERNS 里）。 */
export const IA_LEDGER_KEY = 'ia_ledger_v1';
/** 台账上限（超出丢最旧的；回执台账不是审计日志，不需要无限长）。 */
export const IA_LEDGER_LIMIT = 200;
/** 记录状态闭集（**不是布尔**：「办过」与「撤了」处置相反）。 */
export const IA_RECORD_STATUS = Object.freeze({
    committed: 'committed',   /* 办过了，条目应该还在 */
    undone: 'undone',         /* 撤掉了（或用户确认不要了） */
    superseded: 'superseded'  /* 被后来的同身份记录取代（源句/日期变了） */
});
/** 提交台账判定的归因闭集（逐条给人话，不抛）。 */
export const IA_LEDGER_WHY = Object.freeze({
    ok: 'ok',
    new: 'new',
    replayed: 'replayed',
    drifted: 'drifted',
    recommit: 'recommit',
    nothingToUndo: 'nothing-to-undo',
    entryMissing: 'entry-missing',
    modifiedSince: 'modified-since',
    invalid: 'invalid-action'
});

const strOf = (v) => String(v == null ? '' : v).trim();

/**
 * 稳定来源身份：`sourceMsgId|kind`。
 * 没有 `sourceMsgId` 时返回 ''（**不编一个**：没出处的动作本来就不该被办）。
 * @param {object} action `{kind, sourceMsgId}`
 */
export function identityOf(action) {
    const a = (action && typeof action === 'object') ? action : {};
    const msgId = strOf(a.sourceMsgId);
    const kind = strOf(a.kind);
    if (!msgId || !kind) return '';
    return msgId + '|' + kind;
}

/**
 * 内容指纹：`title|dateKey|time`（回答「这次算出来的内容跟上次一样吗」）。
 * 纯空白按空串收，避免「多一个空格」被判成内容变了。
 */
export function fingerprintOf(action) {
    const a = (action && typeof action === 'object') ? action : {};
    const p = (a.payload && typeof a.payload === 'object') ? a.payload : {};
    return [strOf(a.title), strOf(p.dateKey), strOf(p.time)].join('|');
}

/** 台账记录归一（**坏行直接丢**，不补空壳 —— 一条补出来的记录会让「办过没有」答错）。 */
export function normalizeRecord(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const identity = strOf(raw.identity);
    const msgId = strOf(raw.sourceMsgId);
    const kind = strOf(raw.kind);
    const memoId = strOf(raw.memoId);
    if (!identity || !msgId || !kind || !memoId) return null;
    const status = Object.prototype.hasOwnProperty.call(IA_RECORD_STATUS, strOf(raw.status))
        ? strOf(raw.status) : IA_RECORD_STATUS.committed;
    return {
        identity: identity,
        sourceMsgId: msgId,
        kind: kind,
        memoId: memoId,
        fingerprint: strOf(raw.fingerprint),
        /* 创建时的原样三件（撤销时判「有没有被人工改过」）—— 只读快照，不复用对象引用。 */
        title: strOf(raw.title),
        dateKey: strOf(raw.dateKey),
        time: strOf(raw.time),
        status: status,
        at: Number(raw.at) || 0
    };
}

/** 台账列表归一：去坏行、去重（同 identity 只留最新一条）、截上限。 */
export function normalizeLedger(raw) {
    const list = Array.isArray(raw) ? raw : [];
    const seen = new Map();
    for (const it of list) {
        const r = normalizeRecord(it);
        if (!r) continue;
        const prev = seen.get(r.identity);
        /* 同身份多条：留 `at` 更新的那条（旧版数据 / 异常写入都可能造成多条）。 */
        if (!prev || r.at >= prev.at) seen.set(r.identity, r);
    }
    const out = Array.from(seen.values());
    out.sort((a, b) => b.at - a.at);
    return out.slice(0, IA_LEDGER_LIMIT);
}

/** 读台账（storage 可为 null ⇒ 空台账，不抛）。 */
export function readLedger(storage) {
    try {
        const raw = storage && typeof storage.get === 'function' ? storage.get(IA_LEDGER_KEY, null) : null;
        if (!raw) return [];
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return normalizeLedger(parsed);
    } catch (_e) {
        /* 读坏了当空台账：**不抛**（台账坏了不该让「加入日程」整个不可用），
         *   代价是可能多写一条重复 —— 比「功能直接坏掉」轻。 */
        return [];
    }
}

/** 写台账（失败返回 false，不抛）。 */
export function writeLedger(storage, records) {
    try {
        if (!storage || typeof storage.set !== 'function') return false;
        storage.set(IA_LEDGER_KEY, JSON.stringify(normalizeLedger(records)));
        return true;
    } catch (_e) {
        return false;
    }
}

/**
 * 提交前的台账判定（**纯函数**：不写盘、不调日历）。
 * @param {Array} records 现有台账
 * @param {object} action 内核候选
 * @param {number} [now]
 * @returns {{decision:string, why:string, record:object|null, supersede:object|null, nextRecords:Array}}
 *   · decision: 'new' | 'replayed' | 'drifted' | 'recommit' | 'invalid'
 *   · replayed 时 record 是**旧记录**（调用方据此把旧回执原样交回，不新建）；
 *   · drifted 时 supersede 是被取代的旧记录（调用方在建完之后把旧记录标 superseded）。
 */
export function planCommit(records, action, now = Date.now()) {
    const list = normalizeLedger(records);
    const identity = identityOf(action);
    if (!identity) {
        return { decision: 'invalid', why: IA_LEDGER_WHY.invalid, record: null, supersede: null, nextRecords: list };
    }
    const fp = fingerprintOf(action);
    const msgId = strOf(action.sourceMsgId);
    const kind = strOf(action.kind);
    const prev = list.find((r) => r.identity === identity) || null;
    if (!prev) {
        return { decision: 'new', why: IA_LEDGER_WHY.new, record: null, supersede: null, nextRecords: list };
    }
    if (prev.status === IA_RECORD_STATUS.undone) {
        /* 撤后重办：合法，与「重复点击」处置相反，故必须单独一态。 */
        return { decision: 'recommit', why: IA_LEDGER_WHY.recommit, record: prev, supersede: null, nextRecords: list };
    }
    if (prev.fingerprint === fp) {
        /* 真正的一次重复：不新建，把旧回执原样交回（**不刷新时间戳** —— 回执写的是「什么时候办的」）。 */
        return { decision: 'replayed', why: IA_LEDGER_WHY.replayed, record: prev, supersede: null, nextRecords: list };
    }
    /* 同身份但内容变了：允许新建（用户确实改了这件事），旧记录留痕作废。 */
    return { decision: 'drifted', why: IA_LEDGER_WHY.drifted, record: prev, supersede: prev, nextRecords: list };
}

/**
 * 建完之后落账（把新记录放进台账，必要时把旧记录标 superseded）。
 * @param {Array} records
 * @param {object} entry `{identity, sourceMsgId, kind, memoId, fingerprint, title, dateKey, time, at}`
 * @param {object|null} supersede 被取代的旧记录
 */
export function appendRecord(records, entry, supersede) {
    const list = normalizeLedger(records).filter((r) => r.identity !== strOf(entry && entry.identity));
    const rec = normalizeRecord(entry);
    if (!rec) return list;
    /* 旧记录降级为 superseded 后**仍留在台账里**：它是「上一条回执已作废」这句话的唯一依据。
     *   但同 identity 只能有一条，故旧记录换个身份键存（`identity + '#superseded@at'`）。 */
    const out = [];
    if (supersede && strOf(supersede.identity)) {
        const oldOne = normalizeRecord(Object.assign({}, supersede, {
            identity: strOf(supersede.identity) + '#superseded@' + strOf(supersede.at),
            status: IA_RECORD_STATUS.superseded
        }));
        if (oldOne) out.push(oldOne);
    }
    out.push(rec);
    for (const r of list) out.push(r);
    return normalizeLedger(out);
}

/**
 * 撤销前的判定（**纯函数**：只读台账与当前条目快照，不删任何东西）。
 * @param {Array} records 台账
 * @param {string} identity 动作身份（或直接给 memoId）
 * @param {object|null} memoNow 目标条目**现在**的样子（来自 `calendarData.getMemos()`）
 * @returns {{ok:boolean, why:string, record:object|null, nextRecords:Array}}
 */
export function planUndo(records, identity, memoNow) {
    const list = normalizeLedger(records);
    const key = strOf(identity);
    const rec = list.find((r) => r.identity === key && r.status !== IA_RECORD_STATUS.superseded) || null;
    if (!rec) {
        return { ok: false, why: IA_LEDGER_WHY.nothingToUndo, record: null, nextRecords: list };
    }
    if (rec.status === IA_RECORD_STATUS.undone) {
        return { ok: false, why: IA_LEDGER_WHY.nothingToUndo, record: rec, nextRecords: list };
    }
    const m = (memoNow && typeof memoNow === 'object') ? memoNow : null;
    const id = strOf(m && m.id);
    if (!m || id !== rec.memoId) {
        /* 条目已经不在（被删 / 被换掉）：报「不存在」而不是成功。 */
        return { ok: false, why: IA_LEDGER_WHY.entryMissing, record: rec, nextRecords: list };
    }
    /* 人工修改检测：三项**任一**变动都算（只比创建时那三项，不跟后续自动字段比）。 */
    const changed = strOf(m.title) !== rec.title
        || strOf(m.dateKey) !== rec.dateKey
        || strOf(m.time) !== rec.time;
    if (changed) {
        return { ok: false, why: IA_LEDGER_WHY.modifiedSince, record: rec, nextRecords: list };
    }
    const next = list.map((r) => (r.identity === rec.identity
        ? normalizeRecord(Object.assign({}, r, { status: IA_RECORD_STATUS.undone, at: Math.max(r.at, Date.now()) }))
        : r)).filter(Boolean);
    return { ok: true, why: IA_LEDGER_WHY.ok, record: rec, nextRecords: normalizeLedger(next) };
}

/** 台账自检（供门禁调用；不读磁盘）。 */
export function iaLedgerSelfCheck() {
    const problems = [];
    if (!strOf(IA_LEDGER_KEY)) problems.push('台账键为空');
    if (!(Number(IA_LEDGER_LIMIT) > 0)) problems.push('台账上限必须为正');
    for (const [k, v] of Object.entries(IA_RECORD_STATUS)) {
        if (!v) problems.push('状态 ' + k + ' 为空');
    }
    /* 四种判定必须互不同名（判据要靠它分处置）。 */
    const decisions = ['new', 'replayed', 'drifted', 'recommit', 'invalid'];
    if (new Set(decisions).size !== decisions.length) problems.push('判定名重复');
    return { problems: problems };
}
