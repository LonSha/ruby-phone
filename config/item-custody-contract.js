/* ============================================================
 * config/item-custody-contract.js — [v4.37.0 · 第五期 R5-X1 随身物品与借还事项的可操作卡片]
 *
 * 【本件是纯契约：只做读数与归一，零 DOM 零存储零联网零时钟】
 *   上游 M5-X1（借用/赠与/归还的物品履约记忆）在**本版尚未实现** —— 本件按计划
 *   原文的「可先做只读卡」先落**手机侧不撒谎的只读面**：手机**不推算**谁持有、
 *   **不自己建物品账**，只把「上游给的关系引用」翻成人能读的那几行，并把
 *   「上游不在场」与「上游在、但这一件没有履约数据」分形。
 *
 * 【修前的缺口（读码可复算，不是推演）】
 *   手机侧全仓零 `custody` / 借还关系引用：微信赠礼只画一条聊天气泡
 *   （`chat-view.js` 的 `case 'gift'` 只读 `msg.giftName`），
 *   于是「这把钥匙为什么在乙手里」在手机上**没有任何落点**；
 *   而用户看到的是一条「我送你一把钥匙」的消息 —— 那不是「实物已转移」。
 *   本项要治的正是这半句：**把一条赠礼聊天当成实物已转移**。
 *
 * 【四态 + 两格「看不了」必须分形】
 *   ABSENT      上游不在场（没有履约面）⇒ 只说「插件不在场」，**不**说「没有借还」
 *   UNSUPPORTED 上游在、但没有这一口（旧版）⇒ 说「等升级」，与「不在场」处置不同
 *   DRAFT_ONLY  只有本地草稿（本版默认态：上游没给数据）⇒ 明说「只可写草稿」
 *   READY       有履约数据 ⇒ 逐条给持有关系
 *   另有 `NO_RECORD`（上游在、这一件**没有**履约数据）—— 与 ABSENT 处置相反：
 *   前者是「这一件没借过」，后者是「问不了」。
 *
 * 【为什么「所有者」与「持有人」必须分列】
 *   借出后所有者不变、持有人变了；合成一格就没法回答「该不该归还」——
 *   而「该不该归还」正是本项的验收原文。
 * ============================================================ */

/** 卡片六态（互不相同：压平任意两态即造出处置相反的处境长得一样）。 */
export const CUSTODY_STATES = Object.freeze({
    ABSENT: 'absent',              // 上游不在场：没有履约面
    UNSUPPORTED: 'unsupported',     // 上游在，但没有履约出口（旧版）
    NO_RECORD: 'no-record',         // 上游在，这一件**没有**履约数据（与「问不了」相反）
    DRAFT_ONLY: 'draft-only',       // 本版默认：只有本地草稿，明说不可写入事实
    READY: 'ready',                 // 有履约数据
    UNREADABLE: 'unreadable',       // 取数抛了（如实报，不假装没有）
});

/** 交接动作（上游事件名的受控词表；不认识的一律归 other 并具名）。 */
export const CUSTODY_ACTIONS = Object.freeze({
    LOAN: 'loan',           // 借出
    HANDOVER: 'handover',   // 转交代保管
    RETURN: 'return',       // 归还（可能部分）
    GIFT: 'gift',           // 赠与（**不产生欠还**）
    LOST: 'lost',           // 遗失
    OTHER: 'other',
});

export const CUSTODY_LIMITS = Object.freeze({
    history: 12,     // 一张卡最多回看几次交接
    items: 24,       // 一次最多列几件
});

function str(v) { return String(v == null ? '' : v).trim(); }
function strList(v, cap) {
    const out = [];
    if (!Array.isArray(v)) return out;
    for (const x of v) { const t = str(x); if (t && out.indexOf(t) < 0) out.push(t); if (out.length >= cap) break; }
    return out;
}

/**
 * 派发相：有履约出口走履约面；只有本地草稿则**如实说只可写草稿**；
 *   两样都没有则如实报无。严格判 true（非 true 一律当「没有」）。
 * @returns {string} CUSTODY_STATES 里的一个
 */
export function planCustodyState(hasCustody, hasDraft) {
    if (hasCustody === true) return CUSTODY_STATES.READY;
    if (hasDraft === true) return CUSTODY_STATES.DRAFT_ONLY;
    return CUSTODY_STATES.ABSENT;
}

/**
 * 归一一件物品的履约卡。
 *
 * 【所有者与持有人分列】`owner` 是「东西是谁的」，`holder` 是「现在在谁手上」——
 *   借出只改后者。合成一格就答不了「该不该归还」。
 * 【同名物品按来源区分】`sourceKey` 是「哪一条事实说的这件事」（楼号 / 事件键），
 *   两件同名物各带各的 key ⇒ 卡片不串（本仓同名异人同款口径）。
 *
 * @param {object|null} recv 上游回执（或 null）
 * @param {object} [opts] { draft:boolean } 本地草稿是否在场
 * @returns {{state:string, item:string, owner:string, holder:string, sourceKey:string,
 *            dueAt:string, loaned:boolean, partial:boolean, history:Array, why:string,
 *            canConfirm:boolean, writesNothing:boolean}}
 */
export function normalizeCustodyCard(recv, opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const r = (recv && typeof recv === 'object') ? recv : null;
    const base = {
        state: CUSTODY_STATES.ABSENT, item: '', owner: '', holder: '', sourceKey: '',
        dueAt: '', loaned: false, partial: false, history: [], why: '',
        canConfirm: false, writesNothing: true,
    };
    if (!r) {
        /* 空件 = 上游不在场。**不**说「没有借还」—— 那是另一件事（NO_RECORD）。 */
        return Object.assign({}, base, {
            state: o.draft === true ? CUSTODY_STATES.DRAFT_ONLY : CUSTODY_STATES.ABSENT,
            why: o.draft === true
                ? '本版插件没有履约面：这一屏只作**草稿**（写明想借/想还），不会写成事实'
                : '插件不在场：问不了物品在谁手里',
        });
    }
    if (r.unreadable === true || r.thrown === true) {
        return Object.assign({}, base, {
            state: CUSTODY_STATES.UNREADABLE, item: str(r.item),
            why: '取数失败（已降级）—— 这是「读不到」，**不是**「没有借还关系」',
        });
    }
    const item = str(r.item || r.name);
    const owner = str(r.owner);
    const holder = str(r.holder || r.currentHolder);
    const sourceKey = str(r.sourceKey || r.ref);
    const dueAt = str(r.dueAt || r.due);
    /* 履约数据在场与否：**判据是「有没有给出关系」**，不是「回执是不是对象」。 */
    const hasRel = !!(owner || holder || sourceKey || (Array.isArray(r.history) && r.history.length));
    if (!hasRel) {
        return Object.assign({}, base, {
            state: CUSTODY_STATES.NO_RECORD, item: item,
            why: '这一件在上游**没有**履约记录（不是「问不了」—— 上游在场，只是这件没借过）',
        });
    }
    const history = (Array.isArray(r.history) ? r.history : []).slice(-CUSTODY_LIMITS.history).map((h) => {
        const e = (h && typeof h === 'object') ? h : {};
        const rawAct = str(e.action);
        const act = Object.values(CUSTODY_ACTIONS).indexOf(rawAct) >= 0 ? rawAct : CUSTODY_ACTIONS.OTHER;
        return {
            action: act,
            /* 上游给了不认识的动作名 ⇒ 如实留下原名（不静默丢，也不假装是 loan）。 */
            actionRaw: (act === CUSTODY_ACTIONS.OTHER && rawAct && rawAct !== CUSTODY_ACTIONS.OTHER) ? rawAct : '',
            from: str(e.from), to: str(e.to), at: str(e.at || e.floor), note: str(e.note),
        };
    });
    /* 借出 = 有过 loan/handover 且**没有**被 return 抹平（部分归还另记）。 */
    const loans = history.filter((h) => h.action === CUSTODY_ACTIONS.LOAN || h.action === CUSTODY_ACTIONS.HANDOVER);
    const returns = history.filter((h) => h.action === CUSTODY_ACTIONS.RETURN);
    const loaned = loans.length > 0;
    const partial = loaned && returns.length > 0 && holder !== owner;
    return Object.assign({}, base, {
        state: CUSTODY_STATES.READY, item: item, owner: owner, holder: holder,
        sourceKey: sourceKey, dueAt: dueAt, loaned: loaned, partial: partial,
        history: history,
        /* 能否发起归还确认：**只由「借出关系在场」决定** —— 赠与不产生欠还，
         *   故 `loaned` 为假时按钮不该亮（亮一个走不通的按钮比不亮更贵）。 */
        canConfirm: loaned,
        why: '',
    });
}

/**
 * 卡片一行读数（六态各占一格，不把「问不了」压成「没有借还」）。
 */
export function custodyLineOf(card) {
    const c = (card && typeof card === 'object') ? card : null;
    if (!c) return '物品卡读不到';
    if (c.state === CUSTODY_STATES.ABSENT) return '物品：插件不在场（问不了在谁手里）';
    if (c.state === CUSTODY_STATES.UNSUPPORTED) return '物品：本插件没有履约出口（等升级；不是「没有借还」）';
    if (c.state === CUSTODY_STATES.UNREADABLE) return '物品：取数失败（读不到 ≠ 没有借还关系）';
    if (c.state === CUSTODY_STATES.DRAFT_ONLY) return '物品：只有草稿（写明想借/想还，不写成事实）';
    if (c.state === CUSTODY_STATES.NO_RECORD) {
        return '物品「' + (c.item || '未命名') + '」：上游没有履约记录（这件没借过）';
    }
    const bits = [];
    if (c.item) bits.push('「' + c.item + '」');
    if (c.owner) bits.push('所有者 ' + c.owner);
    if (c.holder) bits.push('现在在 ' + c.holder + ' 手里');
    if (c.loaned) bits.push(c.partial ? '借出中（部分归还）' : '借出中');
    if (c.dueAt) bits.push('应还 ' + c.dueAt);
    if (!c.owner && !c.holder) bits.push('关系未给全');
    return '物品：' + (bits.length ? bits.join(' · ') : '有履约数据但关系为空');
}

/**
 * 「该不该归还」那一句（本项验收原文点名的那一问）。
 *   三态必须分句：**该还** / **不该还（赠与）** / **判不了**。
 */
export function shouldReturnLine(card) {
    const c = (card && typeof card === 'object') ? card : null;
    if (!c) return '判不了（没有卡片）';
    if (c.state !== CUSTODY_STATES.READY) return '判不了（' + custodyLineOf(c) + '）';
    if (!c.loaned) return '不该还：没有借出关系（赠与不产生欠还）';
    if (c.holder === c.owner) return '不必还：已经在所有者手上';
    if (!c.holder || !c.owner) return '判不了：所有者或持有人缺一格（不猜）';
    return '该还：' + c.owner + ' 的东西现在在 ' + c.holder + ' 手里' + (c.dueAt ? '（应还 ' + c.dueAt + '）' : '');
}

/**
 * 交接历史 → 可点的一行行（不排序出「最近一次就是答案」的错觉）。
 */
export function handoverRowsOf(card) {
    const c = (card && typeof card === 'object') ? card : null;
    const list = (c && Array.isArray(c.history)) ? c.history : [];
    const LABEL = {
        loan: '借出', handover: '转交代保管', return: '归还', gift: '赠与', lost: '遗失', other: '其他交接',
    };
    return list.map(function (h, i) {
        const who = (h.from || '?') + ' → ' + (h.to || '?');
        const label = LABEL[h.action] || '其他交接';
        return {
            action: h.action,
            line: '第 ' + String(i + 1) + ' 次 · ' + label + ' · ' + who
                + (h.at ? ' · ' + h.at : '')
                + (h.actionRaw ? '（上游动作名「' + h.actionRaw + '」不认识，按「其他」列出）' : '')
                + (h.note ? ' · ' + h.note : ''),
        };
    });
}

/** 判据自证（十项）。 */
export function custodySelfCheck() {
    const problems = [];
    const states = Object.values(CUSTODY_STATES);
    if (new Set(states).size !== states.length) problems.push('物品卡各态必须互不相同');
    if (CUSTODY_STATES.ABSENT === CUSTODY_STATES.NO_RECORD) problems.push('「问不了」与「这件没借过」必须不同形');
    if (CUSTODY_STATES.UNSUPPORTED === CUSTODY_STATES.ABSENT) problems.push('「没有履约出口」与「插件不在场」必须不同形');

    /* 一 派发相：三种组合三种结果，且严格判 true。 */
    if (planCustodyState(true, true) !== CUSTODY_STATES.READY) problems.push('有履约出口必须优先走履约面');
    if (planCustodyState(false, true) !== CUSTODY_STATES.DRAFT_ONLY) problems.push('没有履约出口但有草稿 ⇒ 只可写草稿');
    if (planCustodyState(false, false) !== CUSTODY_STATES.ABSENT) problems.push('两样都没有 ⇒ 如实报不在场');
    for (const bad of [undefined, null, 0, 1, 'yes', {}]) {
        if (planCustodyState(bad, false) !== CUSTODY_STATES.ABSENT) problems.push('派发相必须严格判 true：' + String(bad));
    }

    /* 二 所有者与持有人分列：借出后所有者不变、持有人变了。 */
    const loaned = normalizeCustodyCard({
        item: '钥匙', owner: '甲', holder: '乙', sourceKey: 'floor:12',
        dueAt: '周五', history: [{ action: 'loan', from: '甲', to: '乙', at: '12楼' }],
    });
    if (loaned.state !== CUSTODY_STATES.READY) problems.push('有关系的卡必须记 ready');
    if (loaned.owner !== '甲' || loaned.holder !== '乙') problems.push('所有者与持有人必须分列（借出只改持有人）');
    if (shouldReturnLine(loaned).indexOf('该还') !== 0) problems.push('借出中必须明说「该还」：' + shouldReturnLine(loaned));

    /* 三 赠与不产生欠还。 */
    const gift = normalizeCustodyCard({
        item: '书', owner: '甲', holder: '乙', history: [{ action: 'gift', from: '甲', to: '乙' }],
    });
    if (gift.loaned !== false) problems.push('赠与不得算作借出');
    if (shouldReturnLine(gift).indexOf('不该还') !== 0) problems.push('赠与必须明说「不该还」：' + shouldReturnLine(gift));
    if (gift.canConfirm !== false) problems.push('★ 赠与不得给「发起归还确认」按钮（亮一个走不通的按钮比不亮更贵）');

    /* 四 部分归还与「已在所有者手上」分形。 */
    const partial = normalizeCustodyCard({
        item: '钥匙', owner: '甲', holder: '乙',
        history: [{ action: 'loan', from: '甲', to: '乙' }, { action: 'return', from: '乙', to: '甲' }],
    });
    if (partial.partial !== true) problems.push('有借有还但持有人仍非所有者 ⇒ 部分归还');
    const back = normalizeCustodyCard({
        item: '钥匙', owner: '甲', holder: '甲',
        history: [{ action: 'loan', from: '甲', to: '乙' }, { action: 'return', from: '乙', to: '甲' }],
    });
    if (shouldReturnLine(back).indexOf('不必还') !== 0) problems.push('已回所有者手上必须说「不必还」：' + shouldReturnLine(back));

    /* 五 缺一格不猜。 */
    const half = normalizeCustodyCard({ item: '伞', holder: '乙', history: [{ action: 'loan' }] });
    if (shouldReturnLine(half).indexOf('判不了') !== 0) problems.push('所有者缺格时必须说「判不了」（不猜）');

    /* 六 NO_RECORD 与 ABSENT 分形。 */
    const noRec = normalizeCustodyCard({ item: '伞' });
    if (noRec.state !== CUSTODY_STATES.NO_RECORD) problems.push('上游在、这件没借过 ⇒ no-record');
    if (noRec.state === normalizeCustodyCard(null).state) problems.push('★「这件没借过」与「插件不在场」必须不同形');
    if (custodyLineOf(noRec) === custodyLineOf(normalizeCustodyCard(null))) problems.push('两者的读数行也必须不同句');

    /* 七 取数失败 ≠ 没有关系。 */
    const bad = normalizeCustodyCard({ thrown: true, item: '伞' });
    if (bad.state !== CUSTODY_STATES.UNREADABLE) problems.push('取数失败必须记 unreadable');
    if (custodyLineOf(bad).indexOf('读不到') < 0) problems.push('取数失败必须说「读不到 ≠ 没有关系」');

    /* 八 不认识的动作名如实列出。 */
    const weird = normalizeCustodyCard({
        item: '钥匙', owner: '甲', holder: '乙', history: [{ action: 'mystery-act', from: '甲', to: '乙' }],
    });
    if (weird.history[0].action !== CUSTODY_ACTIONS.OTHER) problems.push('不认识的动作名归 other');
    if (weird.history[0].actionRaw !== 'mystery-act') problems.push('不认识的动作名必须如实留下原名（不静默丢）');
    if (handoverRowsOf(weird)[0].line.indexOf('mystery-act') < 0) problems.push('读数行必须点名那个不认识的动作');

    /* 九 同名物品按来源区分。 */
    const a = normalizeCustodyCard({ item: '钥匙', owner: '甲', holder: '乙', sourceKey: 'floor:12' });
    const b = normalizeCustodyCard({ item: '钥匙', owner: '丙', holder: '丁', sourceKey: 'floor:40' });
    if (a.sourceKey === b.sourceKey) problems.push('同名物品必须按来源区分（否则两件串成一件）');

    /* 十 空件与异常不抛；草稿态如实说只可写草稿。 */
    if (normalizeCustodyCard(undefined, { draft: true }).state !== CUSTODY_STATES.DRAFT_ONLY) problems.push('有草稿时无履约面 ⇒ draft-only');
    if (custodyLineOf(null) !== '物品卡读不到') problems.push('空卡读数必须如实');
    if (normalizeCustodyCard(undefined).writesNothing !== true) problems.push('本件恒为只读面');

    return { problems: problems, states: states.length, actions: Object.keys(CUSTODY_ACTIONS).length };
}

export default {
    CUSTODY_STATES,
    CUSTODY_ACTIONS,
    CUSTODY_LIMITS,
    planCustodyState,
    normalizeCustodyCard,
    custodyLineOf,
    shouldReturnLine,
    handoverRowsOf,
    custodySelfCheck,
};