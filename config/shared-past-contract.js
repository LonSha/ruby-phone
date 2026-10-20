/* ============================================================
 * config/shared-past-contract.js — [v4.40.0 · 第五期 R5-X5 群聊前的共同往事选择器]
 *
 * 【本件是纯契约：只做读数与归一，零 DOM 零存储零联网零时钟】
 *   `relation-album-contract.js`（关系回忆册）与个人视角卡都已存在，但它们回答的是
 *   「**甲乙之间**发生过什么」；本件要回答的是**另一问**：
 *   **「这一屋子人（≥2 位）里，哪几件旧事是所有人都能拿出来说的？」**
 *
 * 【修前的缺口（读码可复算，不是推演）】
 *   手机侧全仓零「组级共享可见性」实现：`knowledgeCheck`（social-knowledge-bridge）
 *   判的是**单人**视角的可见性（「这条对甲可见吗」）。于是群聊里想提一件旧事时，
 *   只能凭人脑记「丙不知道这件事」—— 而**加一个人就整个结论作废**这件事
 *   在界面上没有任何落点。计划原文点名要治的正是这两句：
 *   「**加入丙后重新预览移除秘密，不能沿旧草稿一键误发**」与
 *   「**无知情数据提示无法判定**」。
 *
 * 【四件必须分形】
 *   ① **可共享**（所有人都知情）与**不可共享**（有人不知情）处置相反；
 *   ② **判不了**（有人根本没有知情数据）必须与「不知情」分形 ——
 *      前者是「我们不知道丙知不知道」，后者是「丙确实不知道」；
 *   ③ **成员变了结论就变**：`membersKey` 一变，旧预览**整块作废**，
 *      不许沿旧草稿一键误发（那是本项验收原文点名的那一格）；
 *   ④ **不从亲密度推定知情**：本件**不产**任何「关系越近越可能知道」的推断
 *      （计划原文「不做：不从亲密度推定群成员知情」）。
 * ============================================================ */

/** 组级共享面态（互不相同：压平任意两态即造出处置相反的处境长得一样）。 */
export const SHARED_STATES = Object.freeze({
    ABSENT: 'absent',          // 没有知情数据源（判不了任何一件）
    EMPTY: 'empty',            // 有数据源，但一件旧事都没有
    READY: 'ready',            // 有可判定的旧事（逐件给四态）
    UNREADABLE: 'unreadable',  // 取数抛了（如实报，不假装没有）
});

/** 单件旧事在**当前这一组**里的四态（这是本件真正的判定粒度）。 */
export const SHARED_ITEM_STATES = Object.freeze({
    SHARED: 'shared',          // 全组都知情 ⇒ 可以拿出来说
    PRIVATE: 'private',        // 有人确实不知情 ⇒ **不许**在群里说
    UNKNOWN: 'unknown',        // 有人没有知情数据 ⇒ **判不了**（不是「不知情」）
    EMPTY_GROUP: 'empty-group', // 组里没有人（选人前）
});

/** 读数里**不得出现**的键名（亲密度 / 分数一族）。 */
export const SHARED_FORBIDDEN_KEYS = Object.freeze([
    'intimacy', 'closeness', 'affinity', 'score', 'percent', 'percentage',
    'confidence', 'weight', 'rank', 'probability',
]);

export const SHARED_LIMITS = Object.freeze({
    items: 40,
    members: 16,
});

function str(v) { return String(v == null ? '' : v).trim(); }
function strList(v, cap) {
    const out = [];
    if (!Array.isArray(v)) return out;
    for (const x of v) { const t = str(x); if (t && out.indexOf(t) < 0) out.push(t); if (out.length >= cap) break; }
    return out;
}

/**
 * 组的**身份键**：成员集合的稳定指纹（**顺序无关**）。
 *   为什么必须有它：验收原文要求「加入丙后重新预览移除秘密」——
 *   而「成员变了」这件事必须能被**判出来**；没有指纹就只能靠人眼看，
 *   于是旧预览会一直挂在屏幕上，用户以为它还是对的。
 */
export function membersKeyOf(members) {
    const list = strList(members, SHARED_LIMITS.members).slice().sort();
    return list.join('|');
}

/**
 * 归一**一件旧事在当前这一组里**的共享态。
 *
 * 【为什么 `unknown` 必须单列】「丙不知情」与「我们不知道丙知不知道」处置相反：
 *   前者是「别提这件事」，后者是「先去问清楚」或「别提，但理由不同」。
 *   压成一格会让用户以为系统知道丙不知情，而其实**根本没数据**。
 *
 * @param {object} item 旧事（含 `knowers` 知情者名单）
 * @param {Array<string>} members 当前组员
 * @returns {{state:string, id:string, label:string, knowers:Array<string>,
 *            missing:Array<string>, why:string}}
 */
export function normalizeSharedItem(item, members) {
    const it = (item && typeof item === 'object') ? item : {};
    const group = strList(members, SHARED_LIMITS.members);
    const knowers = strList(it.knowers, SHARED_LIMITS.members);
    const base = {
        state: SHARED_ITEM_STATES.EMPTY_GROUP, id: str(it.id), label: str(it.label || it.text),
        knowers: knowers, missing: [], why: '组里还没选人（选完人才能判谁能共享）',
    };
    if (!group.length) return base;
    /* 知情名单**根本没给** ⇒ 整件判不了（不按「空名单 = 没人知道」处理 —— 那会把
     *   「没数据」读成「大家都知道不」）。 */
    if (!Array.isArray(it.knowers)) {
        return Object.assign({}, base, {
            state: SHARED_ITEM_STATES.UNKNOWN,
            missing: group.slice(),
            why: '这一件**没有知情名单**（判不了谁能说 —— 不是「没人知道」）',
        });
    }
    const missing = group.filter((m) => knowers.indexOf(m) < 0);
    if (!missing.length) {
        return Object.assign({}, base, {
            state: SHARED_ITEM_STATES.SHARED, missing: [],
            why: '全组 ' + String(group.length) + ' 人都知情 ⇒ 可以拿出来说',
        });
    }
    /* 有知情名单、但**有人不在名单上** ⇒ 分两态：
     *   该成员**在这份数据的可判范围内**（`undecided` 没点名他）⇒ 确实不知情；
     *   该成员被点名 `undecided` ⇒ 判不了。 */
    const undecided = strList(it.undecided, SHARED_LIMITS.members);
    const unsure = missing.filter((m) => undecided.indexOf(m) >= 0);
    if (unsure.length) {
        return Object.assign({}, base, {
            state: SHARED_ITEM_STATES.UNKNOWN, missing: unsure,
            why: '「' + unsure.join('/') + '」**没有知情数据** ⇒ 判不了（不是「他不知情」）',
        });
    }
    return Object.assign({}, base, {
        state: SHARED_ITEM_STATES.PRIVATE, missing: missing,
        why: '「' + missing.join('/') + '」不知情 ⇒ **不许**在群里说这件事',
    });
}

/**
 * 一次取齐**整组**的共享面（本件唯一装配点）。
 *
 * @param {object} input
 *   · `items`   旧事数组（每件含 `knowers` / 可选 `undecided`）
 *   · `members` 当前组员
 *   · `prevKey` 上一次预览的成员指纹（**与本次不同 ⇒ 旧预览整块作废**）
 * @returns {{state:string, members:Array<string>, membersKey:string, stale:boolean,
 *            items:Array, shared:Array, private:Array, unknown:Array,
 *            line:string, why:string, writesNothing:boolean}}
 */
export function buildSharedPast(input = {}) {
    const o = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
    const base = {
        state: SHARED_STATES.ABSENT, members: [], membersKey: '', stale: false,
        items: [], shared: [], private: [], unknown: [],
        line: '', why: '', writesNothing: true,
    };
    if (o.unreadable === true || o.thrown === true) {
        return Object.assign({}, base, {
            state: SHARED_STATES.UNREADABLE,
            why: '取数失败（已降级）—— 这是「读不到」，**不是**「没有可共享的旧事」',
        });
    }
    const members = strList(o.members, SHARED_LIMITS.members);
    const membersKey = membersKeyOf(members);
    const rawItems = Array.isArray(o.items) ? o.items : [];
    /* ★ 成员指纹与上一次不同 ⇒ 旧预览**整块作废**（验收原文点名的那一格）：
     *   不作废的话，用户会拿「甲乙两人时挑出来的秘密」直接发给「甲乙丙三个人」——
     *   而那正是本项要防的误发。 */
    const prevKey = str(o.prevKey);
    const stale = !!prevKey && prevKey !== membersKey;
    if (!rawItems.length) {
        return Object.assign({}, base, {
            state: SHARED_STATES.EMPTY, members: members, membersKey: membersKey, stale: stale,
            why: '这一组还没有可用的旧事（**不是**「读不到」）',
        });
    }
    const items = rawItems.slice(0, SHARED_LIMITS.items).map((it) => normalizeSharedItem(it, members));
    const shared = items.filter((x) => x.state === SHARED_ITEM_STATES.SHARED);
    const priv = items.filter((x) => x.state === SHARED_ITEM_STATES.PRIVATE);
    const unknown = items.filter((x) => x.state === SHARED_ITEM_STATES.UNKNOWN);
    const face = Object.assign({}, base, {
        state: SHARED_STATES.READY, members: members, membersKey: membersKey, stale: stale,
        items: items, shared: shared, private: priv, unknown: unknown,
    });
    face.line = sharedPastLine(face);
    return face;
}

/**
 * 一行读数（**唯一出处**）。四态分句 + 成员变更时的**作废警告**。
 */
export function sharedPastLine(face) {
    const f = (face && typeof face === 'object') ? face : null;
    if (!f) return '共同往事：读不到';
    if (f.state === SHARED_STATES.UNREADABLE) return '共同往事：取数失败（读不到 ≠ 没有可共享的旧事）';
    if (f.state === SHARED_STATES.ABSENT) return '共同往事：没有知情数据源（判不了任何一件）';
    if (!f.members.length) return '共同往事：还没选人（选完人才能判谁能共享）';
    if (f.state === SHARED_STATES.EMPTY) {
        return '共同往事：这一组还没有可用的旧事' + (f.stale ? ' · **成员已变，旧预览已作废**' : '');
    }
    const bits = [
        '全组 ' + String(f.members.length) + ' 人',
        '可共享 ' + String(f.shared.length) + ' 件',
    ];
    if (f.private.length) bits.push('**不许说** ' + String(f.private.length) + ' 件（有人不知情）');
    if (f.unknown.length) bits.push('判不了 ' + String(f.unknown.length) + ' 件（有人没有知情数据）');
    if (f.stale) bits.push('· **成员已变，旧预览已作废 —— 不能沿旧草稿一键误发**');
    return '共同往事：' + bits.join(' · ');
}

/**
 * 一件旧事 → 可点的一行（**不许说**与**判不了**必须不同句）。
 */
export function sharedItemRows(face) {
    const f = (face && typeof face === 'object') ? face : null;
    const list = (f && Array.isArray(f.items)) ? f.items : [];
    const TAG = {
        shared: '可共享', private: '不许说', unknown: '判不了', 'empty-group': '还没选人',
    };
    return list.map(function (x) {
        return {
            id: x.id, state: x.state,
            line: '【' + (TAG[x.state] || x.state) + '】' + (x.label || x.id || '(未具名)') + ' · ' + x.why,
        };
    });
}

/**
 * 交给聊天草稿的**预检**（验收原文「不能沿旧草稿一键误发」的那道闸）。
 *   三态分句：可以交接 / **必须重挑**（成员变了）/ 一件都不能交。
 */
export function handoffGate(face) {
    const f = (face && typeof face === 'object') ? face : null;
    if (!f) return { ok: false, reason: 'no-face', line: '判不了（没有这一面）' };
    if (f.state === SHARED_STATES.UNREADABLE) {
        return { ok: false, reason: 'unreadable', line: '不能交接：取数失败（读不到 ≠ 没有可共享的旧事）' };
    }
    if (f.state === SHARED_STATES.ABSENT) {
        return { ok: false, reason: 'absent', line: '不能交接：没有知情数据源' };
    }
    if (f.stale) {
        return { ok: false, reason: 'stale', line: '**必须重挑**：成员已经变了，旧预览作废（不能沿旧草稿一键误发）' };
    }
    if (!f.shared.length) {
        return { ok: false, reason: 'nothing-shared', line: '不能交接：这一组里没有一件是所有人都能说的' };
    }
    return { ok: true, reason: '', line: '可以交接：' + String(f.shared.length) + ' 件全组都能说' };
}

/** 判据自证（十项）。 */
export function sharedPastSelfCheck() {
    const problems = [];
    const states = Object.values(SHARED_STATES);
    if (new Set(states).size !== states.length) problems.push('组级面各态必须互不相同');
    const itemStates = Object.values(SHARED_ITEM_STATES);
    if (new Set(itemStates).size !== itemStates.length) problems.push('单件各态必须互不相同');
    if (SHARED_ITEM_STATES.PRIVATE === SHARED_ITEM_STATES.UNKNOWN) problems.push('「不知情」与「判不了」必须不同形');

    /* 一 全组都知情 ⇒ 可共享。 */
    const all = normalizeSharedItem({ id: 'a', label: '那晚下雨', knowers: ['甲', '乙'] }, ['甲', '乙']);
    if (all.state !== SHARED_ITEM_STATES.SHARED) problems.push('全组都知情 ⇒ shared');

    /* 二 ★ 有人确实不知情 ⇒ private（不许说）。 */
    const priv = normalizeSharedItem({ id: 'b', label: '秘密', knowers: ['甲'] }, ['甲', '乙']);
    if (priv.state !== SHARED_ITEM_STATES.PRIVATE) problems.push('★ 有人不知情 ⇒ private');
    if (priv.missing[0] !== '乙') problems.push('必须点名谁不知情，实测 ' + JSON.stringify(priv.missing));

    /* 三 ★ 有人没有知情数据 ⇒ unknown（判不了，**不是**不知情）。 */
    const unk = normalizeSharedItem({ id: 'c', label: '?', knowers: ['甲'], undecided: ['丙'] }, ['甲', '丙']);
    if (unk.state !== SHARED_ITEM_STATES.UNKNOWN) problems.push('★ 有人没有知情数据 ⇒ unknown');
    if (unk.state === priv.state) problems.push('★「判不了」与「不知情」必须不同形');
    if (unk.why.indexOf('不是「他不知情」') < 0) problems.push('判不了必须说清不是「他不知情」：' + unk.why);

    /* 四 知情名单**根本没给** ⇒ 整件判不了（不读成「没人知道」）。 */
    const noList = normalizeSharedItem({ id: 'd', label: 'x' }, ['甲', '乙']);
    if (noList.state !== SHARED_ITEM_STATES.UNKNOWN) problems.push('没给知情名单 ⇒ 判不了（不读成「没人知道」）');
    if (noList.why.indexOf('不是「没人知道」') < 0) problems.push('必须说清不是「没人知道」：' + noList.why);

    /* 五 没选人 ⇒ empty-group（与「判不了」不同形）。 */
    const empty = normalizeSharedItem({ id: 'e', knowers: ['甲'] }, []);
    if (empty.state !== SHARED_ITEM_STATES.EMPTY_GROUP) problems.push('没选人 ⇒ empty-group');
    if (empty.state === unk.state) problems.push('「还没选人」与「判不了」必须不同形');

    /* 六 ★ 成员指纹：顺序无关。 */
    if (membersKeyOf(['乙', '甲']) !== membersKeyOf(['甲', '乙'])) problems.push('★ 成员指纹必须顺序无关');
    if (membersKeyOf(['甲']) === membersKeyOf(['甲', '乙'])) problems.push('★ 成员集合不同 ⇒ 指纹必须不同');

    /* 七 ★ 成员变了 ⇒ 旧预览整块作废（验收原文那一格）。 */
    const face1 = buildSharedPast({
        members: ['甲', '乙'], items: [{ id: 's', label: '共同秘密', knowers: ['甲', '乙'] }],
    });
    if (face1.shared.length !== 1) problems.push('两人组里那件秘密应可共享');
    if (face1.stale !== false) problems.push('没有上一次指纹时不该报作废');
    const face2 = buildSharedPast({
        members: ['甲', '乙', '丙'], prevKey: face1.membersKey,
        items: [{ id: 's', label: '共同秘密', knowers: ['甲', '乙'] }],
    });
    if (face2.stale !== true) problems.push('★ 加入丙后必须报「旧预览作废」');
    if (face2.shared.length !== 0) problems.push('★ 加入丙后那件秘密不再可共享（丙不知情）');
    if (face2.private.length !== 1) problems.push('它应落进「不许说」');
    const gate = handoffGate(face2);
    if (gate.ok !== false || gate.reason !== 'stale') problems.push('★ 成员变了必须**拦住交接**（不能沿旧草稿一键误发）');
    if (gate.line.indexOf('必须重挑') < 0) problems.push('拦下时必须说清「必须重挑」：' + gate.line);

    /* 八 没有可共享的 ⇒ 也不许交接（但理由与「作废」不同形）。 */
    const noneShared = buildSharedPast({
        members: ['甲', '乙'], items: [{ id: 'p', knowers: ['甲'] }],
    });
    const g2 = handoffGate(noneShared);
    if (g2.ok !== false) problems.push('没有可共享的 ⇒ 不许交接');
    if (g2.reason === 'stale') problems.push('★「没有可共享的」与「作废」必须不同形');
    if (g2.line === gate.line) problems.push('两者的话也必须不同句');

    /* 九 读不到 / 没有源 分形。 */
    const bad = buildSharedPast({ thrown: true });
    const absent = buildSharedPast({});
    if (bad.state !== SHARED_STATES.UNREADABLE) problems.push('取数失败 ⇒ unreadable');
    if (absent.state !== SHARED_STATES.EMPTY) problems.push('没有旧事 ⇒ empty（不是 unreadable）');
    if (bad.state === absent.state) problems.push('★「读不到」与「确实没有」必须不同形');

    /* 十 不产任何亲密度 / 分数（计划原文「不从亲密度推定群成员知情」）。 */
    const sample = JSON.stringify({ a: all, b: priv, c: unk, d: face1, e: face2, g: gate });
    for (const k of SHARED_FORBIDDEN_KEYS) {
        if (sample.indexOf('"' + k + '"') >= 0) problems.push('读数里不得出现亲密度/分数键：' + k);
    }
    if (face1.writesNothing !== true) problems.push('本件恒为只读面');

    return { problems: problems, states: states.length, itemStates: itemStates.length };
}

export default {
    SHARED_STATES,
    SHARED_ITEM_STATES,
    SHARED_FORBIDDEN_KEYS,
    SHARED_LIMITS,
    membersKeyOf,
    normalizeSharedItem,
    buildSharedPast,
    sharedPastLine,
    sharedItemRows,
    handoffGate,
    sharedPastSelfCheck,
};