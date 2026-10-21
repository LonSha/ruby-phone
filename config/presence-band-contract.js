/* ============================================================
 * config/presence-band-contract.js — [v4.43.0 · 第五期 R5-X3 多人行踪时间带与会面证据]
 *
 * 【本件是纯契约：只做读数与归一，零 DOM 零存储零联网零时钟】
 *   `config/place-roam.js::presenceAt` 已能回答「**此刻**这个地点有谁在场」——
 *   本件要回答的是**另一问**：
 *   **「在某个时间窗里，这几个人各自在哪些片段有据在场？谁和谁可能共处过？」**
 *   而「**可能共处**」与「**已见面**」是**两件事**（验收原文点名的那一条）。
 *
 * 【修前的缺口（读码可复算，不是推演）】
 *   全仓零 `band` / `overlap` / `coPresence` 命中：在场判定只有「某一刻有谁」，
 *   没有任何一格能表达「甲 10:00–12:00 在钟楼、乙 11:00–13:00 也在钟楼」——
 *   于是「两人同一地点但**不同时间**」与「真的碰上过」在界面上**完全同形**。
 *
 * 【四件必须分形】
 *   ① **有据在场**（有出处）与**未知区间**（那一段没读到）处置相反：
 *      未知**不画连续线**（验收原文），否则用户会把「不知道」读成「一直在」；
 *   ② **可能共处**（时间与地点重叠）与**已见面**（有互动证据）处置相反：
 *      前者只能说「可能」，后者必须有证据 —— 本件**不自动认定见面**；
 *   ③ **互斥地点**（同一时段两处都报了）必须标出来：那是数据冲突，不是「同时在两处」；
 *   ④ **同名不同人**：角色按稳定 ID 识别，不按名字合并（与卡内既有口径同规）。
 * ============================================================ */

/** 片段的四态（互不相同：压平任意两态即造出处置相反的处境长得一样）。 */
export const BAND_STATES = Object.freeze({
    PRESENT: 'present',      // 有据在场（有出处）
    UNKNOWN: 'unknown',      // 这一段没读到 ⇒ 判不了（**不画连续线**）
    CONFLICT: 'conflict',    // 同一时段两处都报了 ⇒ 互斥地点（数据冲突）
    ABSENT: 'absent',        // 明确不在（有据说明这一段不在）
});

/** 会面态（三态：可能共处 / 有互动证据 / 判不了）。 */
export const MEET_STATES = Object.freeze({
    POSSIBLE: 'possible',        // 时间与地点重叠，但**没有**互动证据 ⇒ 只能说「可能共处」
    EVIDENCED: 'evidenced',      // 有互动证据 ⇒ 才算见面
    UNKNOWN: 'unknown',          // 有人那一段未知 ⇒ 判不了
    NONE: 'none',                // 无重叠
});

export const BAND_LIMITS = Object.freeze({
    chars: 5,        // 一次最多选几个角色
    segments: 40,    // 一人最多列几个片段
    pairs: 12,       // 最多列几对
});

function str(v) { return String(v == null ? '' : v).trim(); }

/**
 * 归一**一个人的在场片段**（有据 / 未知 / 冲突三态分列）。
 *
 * @param {object} raw `{ id, name, segments: [{from,to,place,ref,conflictWith}] }`
 * @returns {{id:string, name:string, segments:Array, present:number, unknown:number, conflict:number}}
 */
export function normalizeBand(raw) {
    const r = (raw && typeof raw === 'object') ? raw : {};
    const id = str(r.id);
    const name = str(r.name || r.id);
    const list = (Array.isArray(r.segments) ? r.segments : []).slice(0, BAND_LIMITS.segments);
    const segments = list.map(function (s) {
        const e = (s && typeof s === 'object') ? s : {};
        /* ★ 未知必须显式给：`unread === true` 才算「没读到」——
         *   不给就默认 present（有据在场）？**不行**：那会把「没读到」静默读成「在场」。
         *   故这里要求**显式来源**：有 `ref` 才算有据；没有 `ref` 且没标 unread ⇒ unknown。 */
        const ref = str(e.ref);
        const unread = e.unread === true || (!ref && e.absent !== true);
        const conflictWith = str(e.conflictWith);
        let state = BAND_STATES.PRESENT;
        if (conflictWith) state = BAND_STATES.CONFLICT;
        else if (unread) state = BAND_STATES.UNKNOWN;
        else if (e.absent === true) state = BAND_STATES.ABSENT;
        return {
            from: str(e.from), to: str(e.to), place: str(e.place), ref: ref,
            state: state, conflictWith: conflictWith,
            why: state === BAND_STATES.UNKNOWN ? '这一段**没读到**（不是「不在」，也不是「一直在」）'
                : (state === BAND_STATES.CONFLICT ? '同一时段两处都报了（**互斥地点**：这是数据冲突，不是同时在两处）'
                    : (state === BAND_STATES.ABSENT ? '有据说明这一段不在' : '')),
        };
    });
    return {
        id: id, name: name, segments: segments,
        present: segments.filter((x) => x.state === BAND_STATES.PRESENT).length,
        unknown: segments.filter((x) => x.state === BAND_STATES.UNKNOWN).length,
        conflict: segments.filter((x) => x.state === BAND_STATES.CONFLICT).length,
    };
}

/** 时刻串归一成**可比的分钟数**（`HH:MM`；认不出 ⇒ null，**不猜**）。 */
function minutesOf(t) {
    const m = /^([0-9]{1,2}):([0-9]{2})$/.exec(str(t));
    if (!m) return null;
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (!Number.isFinite(h) || !Number.isFinite(mi)) return null;
    if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
    return h * 60 + mi;
}

/**
 * 两人在同一时间窗里是否**可能共处**（本件唯一判定点）。
 *
 * 【★ 可能共处 ≠ 已见面】本函数只判「时间与地点都重叠」——
 *   要判「已见面」必须有**互动证据**（`evidenced === true`）。
 *   验收原文：「重叠但无互动证据仅标可能共处」。
 */
export function coPresenceOf(a, b, opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const A = normalizeBand(a);
    const B = normalizeBand(b);
    const out = { state: MEET_STATES.NONE, pairs: [], why: '' };
    for (const x of A.segments) {
        for (const y of B.segments) {
            /* 未知那一段**不参与重叠判定**：拿未知去算重叠等于「把不知道当成在场」。 */
            if (x.state === BAND_STATES.UNKNOWN || y.state === BAND_STATES.UNKNOWN) continue;
            if (x.state !== BAND_STATES.PRESENT || y.state !== BAND_STATES.PRESENT) continue;
            if (!x.place || x.place !== y.place) continue;
            const xf = minutesOf(x.from);
            const xt = minutesOf(x.to);
            const yf = minutesOf(y.from);
            const yt = minutesOf(y.to);
            if (xf === null || xt === null || yf === null || yt === null) continue;
            const from = Math.max(xf, yf);
            const to = Math.min(xt, yt);
            if (to < from) continue;
            out.pairs.push({
                place: x.place, from: from, to: to,
                aRef: x.ref, bRef: y.ref,
                /* 有互动证据才算「已见面」；否则只能说「可能共处」。 */
                evidenced: o.evidenced === true,
            });
        }
    }
    if (!out.pairs.length) {
        /* 双方都读到、但没重叠 ⇒ none；有一方含未知片段 ⇒ unknown（判不了，**不说没见**）。 */
        const hasUnknown = A.unknown > 0 || B.unknown > 0;
        out.state = hasUnknown ? MEET_STATES.UNKNOWN : MEET_STATES.NONE;
        out.why = hasUnknown ? '有片段**没读到** ⇒ 判不了（不是「没见」）' : '时间与地点都没有重叠';
        return out;
    }
    out.state = o.evidenced === true ? MEET_STATES.EVIDENCED : MEET_STATES.POSSIBLE;
    out.why = o.evidenced === true
        ? '有互动证据 ⇒ 才算见面'
        : '时间与地点都重叠，但**没有互动证据** ⇒ 只能说「可能共处」，不认定见面';
    return out;
}

/**
 * 一次取齐整条时间带（本件唯一装配点）。
 *
 * @param {object} input `{ chars, evidenced }` chars = 两到五个角色
 * @returns {{state:string, chars:Array, pairs:Array, line:string, why:string, writesNothing:boolean}}
 */
export function buildPresenceBand(input = {}) {
    const o = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
    const base = { state: 'absent', chars: [], pairs: [], line: '', why: '', writesNothing: true };
    if (o.unreadable === true || o.thrown === true) {
        const face = Object.assign({}, base, { state: 'unreadable', why: '取数失败（已降级）—— 这是「读不到」，**不是**「这几个人没行踪」' });
        face.line = presenceBandLine(face);
        return face;
    }
    const raw = Array.isArray(o.chars) ? o.chars : [];
    if (raw.length < 2) {
        const face = Object.assign({}, base, { state: 'too-few', why: '要选**两个或以上**角色才能找会面（一个角色只有行踪，没有会面）' });
        face.line = presenceBandLine(face);
        return face;
    }
    const chars = raw.slice(0, BAND_LIMITS.chars).map((c) => normalizeBand(c)).filter((c) => c.id);
    const pairs = [];
    for (let i = 0; i < chars.length && pairs.length < BAND_LIMITS.pairs; i += 1) {
        for (let j = i + 1; j < chars.length && pairs.length < BAND_LIMITS.pairs; j += 1) {
            const co = coPresenceOf(chars[i], chars[j], { evidenced: o.evidenced === true });
            pairs.push({ a: chars[i].id, b: chars[j].id, aName: chars[i].name, bName: chars[j].name, state: co.state, pairs: co.pairs, why: co.why });
        }
    }
    const face = Object.assign({}, base, { state: 'ready', chars: chars, pairs: pairs });
    face.line = presenceBandLine(face);
    return face;
}

/** 一行读数（**唯一出处**）。三态分句 + 未知/冲突分开报。 */
export function presenceBandLine(face) {
    const f = (face && typeof face === 'object') ? face : null;
    if (!f) return '行踪带：读不到';
    if (f.state === 'unreadable') return '行踪带：取数失败（读不到 ≠ 这几个人没行踪）';
    if (f.state === 'too-few') return '行踪带：要选**两个或以上**角色（一个角色只有行踪，没有会面）';
    if (f.state === 'absent') return '行踪带：还没选角色';
    const bits = ['选了 ' + String(f.chars.length) + ' 人'];
    const unk = (f.chars || []).reduce((n, c) => n + c.unknown, 0);
    const cfl = (f.chars || []).reduce((n, c) => n + c.conflict, 0);
    if (unk) bits.push('**未知片段 ' + String(unk) + ' 段**（不画连续线）');
    if (cfl) bits.push('**互斥地点 ' + String(cfl) + ' 段**（数据冲突）');
    const poss = (f.pairs || []).filter((p) => p.state === MEET_STATES.POSSIBLE).length;
    const ev = (f.pairs || []).filter((p) => p.state === MEET_STATES.EVIDENCED).length;
    const pk = (f.pairs || []).filter((p) => p.state === MEET_STATES.UNKNOWN).length;
    if (poss) bits.push('可能共处 ' + String(poss) + ' 对（**没有互动证据**）');
    if (ev) bits.push('有互动证据 ' + String(ev) + ' 对');
    if (pk) bits.push('**判不了 ' + String(pk) + ' 对**（有人那一段没读到）');
    if (!poss && !ev && !pk) bits.push('没有会面');
    return '行踪带：' + bits.join(' · ');
}

/** 判据自证（十项）。 */
export function presenceBandSelfCheck() {
    const problems = [];
    const st = Object.values(BAND_STATES);
    if (new Set(st).size !== st.length) problems.push('片段各态必须互不相同');
    if (BAND_STATES.UNKNOWN === BAND_STATES.PRESENT) problems.push('「未知」与「有据在场」必须不同形');
    const ms = Object.values(MEET_STATES);
    if (new Set(ms).size !== ms.length) problems.push('会面各态必须互不相同');
    if (MEET_STATES.POSSIBLE === MEET_STATES.EVIDENCED) problems.push('★★「可能共处」与「有互动证据」必须不同形');

    const seg = (from, to, place, ref, extra) => Object.assign({ from: from, to: to, place: place, ref: ref }, extra || {});

    /* 一 ★ 两人同一地点但**不同时间** ⇒ 不算已见面。 */
    const a1 = { id: 'a', name: '甲', segments: [seg('10:00', '12:00', '钟楼', 'f:10')] };
    const b1 = { id: 'b', name: '乙', segments: [seg('13:00', '15:00', '钟楼', 'f:20')] };
    const co1 = coPresenceOf(a1, b1);
    if (co1.state !== MEET_STATES.NONE) problems.push('★ 同一地点不同时间 ⇒ 不算见面，实测 ' + co1.state);
    if (co1.pairs.length !== 0) problems.push('不重叠就不该有重叠对');

    /* 二 ★★ 重叠但无互动证据 ⇒ **只能标可能共处**（不认定见面）。 */
    const b2 = { id: 'b', name: '乙', segments: [seg('11:00', '13:00', '钟楼', 'f:21')] };
    const co2 = coPresenceOf(a1, b2);
    if (co2.state !== MEET_STATES.POSSIBLE) problems.push('★★ 重叠无证据 ⇒ possible，实测 ' + co2.state);
    if (co2.why.indexOf('没有互动证据') < 0) problems.push('必须说清没有互动证据：' + co2.why);
    if (co2.pairs[0].evidenced !== false) problems.push('无证据时 evidenced 必须为 false');
    /* 有证据 ⇒ 才算见面。 */
    const co2e = coPresenceOf(a1, b2, { evidenced: true });
    if (co2e.state !== MEET_STATES.EVIDENCED) problems.push('有证据 ⇒ evidenced');
    if (co2e.state === co2.state) problems.push('★ 两态必须不同形');

    /* 三 ★★ 未知区间**不参与重叠判定**（把不知道当在场是最贵的错读数）。 */
    const b3 = { id: 'b', name: '乙', segments: [{ from: '11:00', to: '13:00', place: '钟楼' }] };
    const nb = normalizeBand(b3);
    if (nb.segments[0].state !== BAND_STATES.UNKNOWN) problems.push('★ 没 ref 又没标 absent ⇒ 判未知');
    const co3 = coPresenceOf(a1, b3);
    if (co3.state !== MEET_STATES.UNKNOWN) problems.push('★★ 有人未知 ⇒ 判不了（不是「没见」），实测 ' + co3.state);
    if (co3.pairs.length !== 0) problems.push('★★ 未知片段不得参与重叠判定');
    if (co3.why.indexOf('不是「没见」') < 0) problems.push('必须说清不是「没见」：' + co3.why);

    /* 四 ★ 互斥地点必须单列（不是「同时在两处」）。 */
    const cfl = normalizeBand({ id: 'c', name: '丙', segments: [seg('09:00', '10:00', '钟楼', 'f:1', { conflictWith: 'f:2' })] });
    if (cfl.segments[0].state !== BAND_STATES.CONFLICT) problems.push('★ 两处都报了 ⇒ conflict');
    if (cfl.segments[0].why.indexOf('互斥地点') < 0) problems.push('必须说清是互斥地点：' + cfl.segments[0].why);
    if (cfl.segments[0].state === BAND_STATES.PRESENT) problems.push('★ 冲突不得读成普通在场');

    /* 五 明确不在（有据）与未知不同形。 */
    const ab = normalizeBand({ id: 'd', segments: [{ from: '1:00', to: '2:00', place: 'x', absent: true, ref: 'f:9' }] });
    if (ab.segments[0].state !== BAND_STATES.ABSENT) problems.push('有据不在 ⇒ absent');
    if (ab.segments[0].state === BAND_STATES.UNKNOWN) problems.push('「不在」与「未知」必须不同形');

    /* 六 一个角色 ⇒ 只有行踪没有会面。 */
    const one = buildPresenceBand({ chars: [a1] });
    if (one.state !== 'too-few') problems.push('一个角色 ⇒ too-few');
    if (one.line.indexOf('两个或以上') < 0) problems.push('必须说清要选两个或以上：' + one.line);

    /* 七 两人都有据且重叠 ⇒ 带出重叠对与出处。 */
    const two = buildPresenceBand({ chars: [a1, b2] });
    if (two.state !== 'ready') problems.push('两人 ⇒ ready');
    if (two.pairs.length !== 1) problems.push('应给一对');
    if (two.pairs[0].pairs[0].aRef !== 'f:10' || two.pairs[0].pairs[0].bRef !== 'f:21') problems.push('★ 重叠对必须带**各自**的出处');
    if (two.pairs[0].pairs[0].from !== 660) problems.push('重叠区间起点应是 11:00(=660)，实测 ' + two.pairs[0].pairs[0].from);

    /* 八 读不到与没选人分形。 */
    const bad = buildPresenceBand({ thrown: true });
    const none = buildPresenceBand({});
    if (bad.state !== 'unreadable') problems.push('取数失败 ⇒ unreadable');
    if (none.state !== 'too-few') problems.push('没选人 ⇒ too-few');
    if (bad.line === none.line) problems.push('★「读不到」与「没选人」必须不同句');

    /* 九 不认的时刻串不猜（拿不到分钟数就不判重叠）。 */
    const badTime = coPresenceOf(a1, { id: 'e', segments: [seg('上午', '中午', '钟楼', 'f:5')] });
    if (badTime.pairs.length !== 0) problems.push('★ 时刻串认不出 ⇒ 不判重叠（不猜）');

    /* 十 只读面 + 空件不抛。 */
    if (two.writesNothing !== true) problems.push('本件恒为只读面');
    if (presenceBandLine(null) !== '行踪带：读不到') problems.push('空面读数必须如实');
    if (coPresenceOf(null, null).state !== MEET_STATES.NONE) problems.push('空件不抛且判 none');

    return { problems: problems, bandStates: st.length, meetStates: ms.length };
}

export default {
    BAND_STATES,
    MEET_STATES,
    BAND_LIMITS,
    normalizeBand,
    coPresenceOf,
    buildPresenceBand,
    presenceBandLine,
    presenceBandSelfCheck,
};