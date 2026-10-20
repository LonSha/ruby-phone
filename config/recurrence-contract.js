/* ============================================================
 * config/recurrence-contract.js — [v4.41.0 · 第五期 R5-X8 周期日程、单次例外与多人空档选择]
 *
 * 【本件是纯契约：只做读数与归一，零 DOM 零存储零联网零时钟】
 *   日历侧的既有底座是 `apps/calendar/calendar-data.js::isRecurringType` ——
 *   而它**只认生日/纪念日**（`normalized === 'birthday' || normalized === 'anniversary'`）。
 *   于是「每周三晚八点的固定时段」在手机里**没有落点**；
 *   更硬的是「四周安排里改第二周、跳过第三周」这件事：
 *   修前只有「全系列一起改」或「整条删掉」两种处置 —— 而那正是本项要治的那半句。
 *
 * 【三件必须分形（本仓最贵的老账）】
 *   ① **整系列**（改规则）与**单次例外**（只动这一次）处置相反：
 *      合成一格就会出现「用户只想改第二周，结果四周全变了」；
 *   ② **跳过**（这次不办，但系列还在）与**取消**（这一条没了）处置相反：
 *      压成一格会让用户以为整个安排被取消了；
 *   ③ **空档里没有日程**（真空闲）与**未知**（没读到那一格）处置相反：
 *      把「未知」当「空闲」会把人约到一个已经排满的时间。
 *
 * 【不做（计划原文）】不接系统日历/闹钟；不后台常驻轮询。
 *   —— 故本件不产任何定时器、不读时钟、不写存储。
 * ============================================================ */

/** 单次例外的三类动作（与「改规则」分列）。 */
export const REC_EXCEPTION = Object.freeze({
    MOVE: 'move',        // 只把这一次改到别的时间
    SKIP: 'skip',        // 只把这一次跳过（系列仍在）
    CANCEL: 'cancel',    // 这一次不办且**不再生成**（与 skip 分形）
});

/** 周期频率（受控词表；不认识的一律归 none 并具名）。 */
export const REC_FREQ = Object.freeze({
    NONE: 'none',
    WEEKLY: 'weekly',
    MONTHLY: 'monthly',
});

export const REC_STATES = Object.freeze({
    ABSENT: 'absent',        // 没有这一条（读不到）
    SINGLE: 'single',        // 非周期（一次性）
    RECURRING: 'recurring',  // 有周期规则
    UNREADABLE: 'unreadable', // 取数抛了
});

/** 空档三态（「空闲」与「未知」必须分形）。 */
export const SLOT_STATES = Object.freeze({
    FREE: 'free',        // 所有人这一格都没有日程 ⇒ 真空闲
    BUSY: 'busy',        // 有人这一格有日程 ⇒ 冲突（逐人给理由）
    UNKNOWN: 'unknown',  // 有人这一格**没读到** ⇒ 判不了（**不是**空闲）
});

export const REC_LIMITS = Object.freeze({
    occurrences: 52,   // 一次最多展开多少期
    slots: 48,         // 空档最多列多少格
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
 * 归一一条日程的**周期规则**。
 *   `freq` 不认识 ⇒ 归 `none` 并**如实留下原名**（不静默当作「一次性」）。
 */
export function normalizeRule(raw) {
    const r = (raw && typeof raw === 'object') ? raw : {};
    const rawFreq = str(r.freq || r.repeat);
    const known = Object.values(REC_FREQ).indexOf(rawFreq) >= 0;
    const freq = known ? rawFreq : (rawFreq ? REC_FREQ.NONE : REC_FREQ.NONE);
    const byWeekday = (() => {
        const n = Number(r.weekday);
        return Number.isInteger(n) && n >= 0 && n <= 6 ? n : null;
    })();
    const byMonthDay = (() => {
        const n = Number(r.monthDay);
        return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null;
    })();
    return {
        freq: freq,
        freqRaw: (!known && rawFreq) ? rawFreq : '',
        weekday: byWeekday,
        monthDay: byMonthDay,
        durationMin: (() => {
            const n = Number(r.durationMin);
            return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
        })(),
        /* 系列身份：同一系列的各期共用它；单次例外按 `occurrenceKey` 挂上去。 */
        seriesKey: str(r.seriesKey || r.id),
    };
}

/**
 * 把一条周期日程展开成**若干期**（本件唯一展开点）。
 *
 * 【为什么按周/按月各写一条而不是通用 cron】本项只做计划原文点名的
 *   「每周/每月重复时段」两档；通用 cron 会引入一份自己的语法解析器
 *   （本仓「同一口径只许一份实现」的反面）。
 *
 * @param {object} raw 日程（含 `rule` 或 `freq` 等）
 * @param {number} count 展开几期
 * @returns {{state:string, freq:string, freqRaw:string, occurrences:Array, why:string}}
 */
export function expandOccurrences(raw, count) {
    /* ★ 空件判定必须用**原始入参**：先归一成 `{}` 再判 `!r` 会**恒假**
     *   （`{}` 是真值）—— 于是「没有这一条」永远走不到，`absent` 那一态成为死码。
     *   本仓明令：判据/分支要落在**真的会到达**的路径上。 */
    const isAbsent = !raw || typeof raw !== 'object' || Array.isArray(raw);
    const r = isAbsent ? {} : raw;
    const rule = normalizeRule(r.rule || r);
    const n = (() => {
        const x = Number(count);
        return Number.isFinite(x) && x > 0 ? Math.min(Math.floor(x), REC_LIMITS.occurrences) : 0;
    })();
    const base = { state: REC_STATES.ABSENT, freq: rule.freq, freqRaw: rule.freqRaw, occurrences: [], why: '' };
    if (isAbsent) {
        return Object.assign({}, base, { why: '没有这一条（读不到）' });
    }
    if (r.unreadable === true || r.thrown === true) {
        return Object.assign({}, base, { state: REC_STATES.UNREADABLE, why: '取数失败（读不到 ≠ 没有这一条）' });
    }
    if (rule.freq === REC_FREQ.NONE) {
        /* 不认识的名字：**如实说清**它没被当作周期（不静默降级）。 */
        return Object.assign({}, base, {
            state: REC_STATES.SINGLE,
            occurrences: [{ index: 0, key: rule.seriesKey || 'o0' }],
            why: rule.freqRaw
                ? '周期名「' + rule.freqRaw + '」不认识 ⇒ 按**一次性**处理（不是「每周/每月」）'
                : '这一条不是周期日程（一次性）',
        });
    }
    const out = [];
    for (let i = 0; i < n; i += 1) {
        out.push({ index: i, key: (rule.seriesKey || 's') + '#' + String(i) });
    }
    return Object.assign({}, base, { state: REC_STATES.RECURRING, occurrences: out });
}

/**
 * 把**单次例外**应用到展开出来的某一期上（本件唯一例外装配点）。
 *
 * 【★ 整系列 vs 单次：这是本项最容易写坏的一处】
 *   验收原文：「四周安排中**改第二周、跳过第三周不改全系列**」——
 *   故例外只作用于**点名的那一期**，其余各期**逐字不变**。
 *   且 `SKIP`（这次不办，系列还在）与 `CANCEL`（这一条没了）**不同形**。
 *
 * @param {object} face `expandOccurrences` 的返回
 * @param {Array} exceptions 例外数组（每条含 `index` + `action`）
 * @returns {{occurrences:Array, moved:number, skipped:number, cancelled:number, why:string}}
 */
export function applyExceptions(face, exceptions) {
    const f = (face && typeof face === 'object') ? face : {};
    const list = Array.isArray(f.occurrences) ? f.occurrences.slice() : [];
    const ex = Array.isArray(exceptions) ? exceptions : [];
    let moved = 0;
    let skipped = 0;
    let cancelled = 0;
    const out = list.map(function (o) {
        const hit = ex.filter((e) => e && Number(e.index) === Number(o.index))[0] || null;
        if (!hit) return Object.assign({}, o, { action: '', at: '', durationMin: null });
        const action = str(hit.action);
        if (action === REC_EXCEPTION.SKIP) { skipped += 1; return Object.assign({}, o, { action: 'skip', at: '', durationMin: null, why: '这一次跳过（**系列仍在**，下一期照旧）' }); }
        if (action === REC_EXCEPTION.CANCEL) { cancelled += 1; return Object.assign({}, o, { action: 'cancel', at: '', durationMin: null, why: '这一次不办且**不再生成**（与「跳过」不同）' }); }
        if (action === REC_EXCEPTION.MOVE) {
            moved += 1;
            const dur = Number(hit.durationMin);
            return Object.assign({}, o, {
                action: 'move', at: str(hit.at),
                durationMin: (Number.isFinite(dur) && dur > 0) ? Math.floor(dur) : null,
                why: '只把**这一次**改到「' + str(hit.at) + '」（其余各期逐字不变）',
            });
        }
        /* 不认识的动作名 ⇒ **如实具名**，不当成「没改」（那是两件事）。 */
        return Object.assign({}, o, { action: 'unknown', at: '', durationMin: null, why: '例外动作「' + action + '」不认识 ⇒ 这一次**没被改动**' });
    });
    return {
        occurrences: out, moved: moved, skipped: skipped, cancelled: cancelled,
        why: (moved || skipped || cancelled) ? '' : '没有例外作用于任何一期（逐字不变）',
    };
}

/**
 * 多人空档：逐格判**所有人**这一格是否都空闲。
 *
 * 【★「空闲」与「未知」必须分形】有人这一格**没读到**时判 `unknown` ——
 *   把它当空闲会把人约到一个已经排满的时间（本项最贵的那类错读数）。
 *
 * @param {Array} slots 候选时段（每格含 `key`）
 * @param {Array} busyByMember 逐人的忙时表 `[{ name, busy: [key...], unread:boolean }]`
 * @returns {{state:string, slots:Array, free:Array, busy:Array, unknown:Array, line:string}}
 */
export function findCommonSlots(slots, busyByMember) {
    const list = Array.isArray(slots) ? slots.slice(0, REC_LIMITS.slots) : [];
    const people = (Array.isArray(busyByMember) ? busyByMember : []).slice(0, REC_LIMITS.members)
        .map((p) => ({
            name: str((p && p.name) || ''),
            busy: strList(p && p.busy, REC_LIMITS.slots),
            unread: !!(p && p.unread === true),
        })).filter((p) => p.name);
    const out = list.map(function (s) {
        const key = str((s && s.key) || s);
        const conflict = people.filter((p) => p.busy.indexOf(key) >= 0).map((p) => p.name);
        const unknown = people.filter((p) => p.unread === true).map((p) => p.name);
        if (conflict.length) {
            return { key: key, state: SLOT_STATES.BUSY, who: conflict, why: '「' + conflict.join('/') + '」这一格已有日程' };
        }
        if (unknown.length) {
            return { key: key, state: SLOT_STATES.UNKNOWN, who: unknown, why: '「' + unknown.join('/') + '」的日程**没读到** ⇒ 判不了（不是「空闲」）' };
        }
        return { key: key, state: SLOT_STATES.FREE, who: [], why: '所有人都空' };
    });
    const free = out.filter((x) => x.state === SLOT_STATES.FREE);
    const busy = out.filter((x) => x.state === SLOT_STATES.BUSY);
    const unknown = out.filter((x) => x.state === SLOT_STATES.UNKNOWN);
    const state = (!people.length) ? REC_STATES.ABSENT
        : (free.length ? SLOT_STATES.FREE : (unknown.length ? SLOT_STATES.UNKNOWN : SLOT_STATES.BUSY));
    return {
        state: state, slots: out, free: free, busy: busy, unknown: unknown,
        line: commonSlotLine({ free: free, busy: busy, unknown: unknown, people: people.length }),
    };
}

/** 空档一行读数（**唯一出处**）。三态分句。 */
export function commonSlotLine(face) {
    const f = (face && typeof face === 'object') ? face : {};
    const people = Number(f.people) || 0;
    if (!people) return '共同空档：还没选人（选完人才能找共同空档）';
    const bits = [String(people) + ' 人'];
    bits.push('可约 ' + String((f.free || []).length) + ' 格');
    if ((f.busy || []).length) bits.push('有冲突 ' + String(f.busy.length) + ' 格');
    if ((f.unknown || []).length) bits.push('**判不了** ' + String(f.unknown.length) + ' 格（有人日程没读到）');
    if (!(f.free || []).length && (f.unknown || []).length) bits.push('⇒ 一个都没法确定（未知**不算**空闲）');
    return '共同空档：' + bits.join(' · ');
}

/** 判据自证（十项）。 */
export function recurrenceSelfCheck() {
    const problems = [];
    const ex = Object.values(REC_EXCEPTION);
    if (new Set(ex).size !== ex.length) problems.push('例外动作必须互不相同');
    if (REC_EXCEPTION.SKIP === REC_EXCEPTION.CANCEL) problems.push('「跳过」与「取消」必须不同形');
    const slotStates = Object.values(SLOT_STATES);
    if (new Set(slotStates).size !== slotStates.length) problems.push('空档各态必须互不相同');
    if (SLOT_STATES.FREE === SLOT_STATES.UNKNOWN) problems.push('「空闲」与「未知」必须不同形');

    /* 一 每周/每月展开。 */
    const w = expandOccurrences({ freq: 'weekly', weekday: 3, seriesKey: 'w1' }, 4);
    if (w.state !== REC_STATES.RECURRING) problems.push('weekly 应记 recurring');
    if (w.occurrences.length !== 4) problems.push('四周应展开四期，实测 ' + w.occurrences.length);
    const m = expandOccurrences({ freq: 'monthly', monthDay: 15 }, 3);
    if (m.occurrences.length !== 3) problems.push('按月应展开三期');

    /* 二 ★ 单次例外只动那一期（四周里改第二周，其余逐字不变）。 */
    const applied = applyExceptions(w, [{ index: 1, action: 'move', at: '周五 20:00' }]);
    if (applied.moved !== 1) problems.push('应记 1 次改期，实测 ' + applied.moved);
    if (applied.occurrences[1].action !== 'move') problems.push('第二期应被改');
    if (applied.occurrences[0].action || applied.occurrences[2].action || applied.occurrences[3].action) {
        problems.push('★ 其余各期**逐字不变**（改第二周不得动全系列）');
    }
    if (applied.occurrences[1].at !== '周五 20:00') problems.push('改到的时间必须在场');

    /* 三 ★ 跳过与取消不同形。 */
    const skipped = applyExceptions(w, [{ index: 2, action: 'skip' }]);
    if (skipped.skipped !== 1) problems.push('应记 1 次跳过');
    if (skipped.occurrences[2].why.indexOf('系列仍在') < 0) problems.push('跳过必须说清「系列仍在」：' + skipped.occurrences[2].why);
    const cancelled = applyExceptions(w, [{ index: 2, action: 'cancel' }]);
    if (cancelled.cancelled !== 1) problems.push('应记 1 次取消');
    if (cancelled.occurrences[2].why === skipped.occurrences[2].why) problems.push('★「跳过」与「取消」的读数必须不同句');
    if (cancelled.occurrences[2].why.indexOf('不再生成') < 0) problems.push('取消必须说清「不再生成」');

    /* 四 没有例外 ⇒ 逐字不变。 */
    const none = applyExceptions(w, []);
    if (none.occurrences.some((o) => o.action)) problems.push('没有例外时不得改动任何一期');

    /* 五 不认识的周期名 / 例外动作名都要如实具名。 */
    const weird = expandOccurrences({ freq: 'biweekly' }, 2);
    if (weird.state !== REC_STATES.SINGLE) problems.push('不认识的周期名 ⇒ 按一次性处理');
    if (weird.why.indexOf('biweekly') < 0) problems.push('必须点名那个不认识的周期名：' + weird.why);
    if (weird.why.indexOf('不认识') < 0) problems.push('必须说清「不认识」');
    const weirdEx = applyExceptions(w, [{ index: 0, action: 'mystery' }]);
    if (weirdEx.occurrences[0].action !== 'unknown') problems.push('不认识的例外动作 ⇒ 记 unknown');
    if (weirdEx.occurrences[0].why.indexOf('mystery') < 0) problems.push('必须点名那个不认识的动作：' + weirdEx.occurrences[0].why);
    if (weirdEx.occurrences[0].why.indexOf('没被改动') < 0) problems.push('必须说清这一次**没被改动**');

    /* 六 ★ 空档：冲突逐人给理由。 */
    const slots = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
    const people = [
        { name: '甲', busy: ['a'] },
        { name: '乙', busy: [] },
    ];
    const found = findCommonSlots(slots, people);
    if (found.busy.length !== 1) problems.push('「a」应有冲突');
    if (found.busy[0].who[0] !== '甲') problems.push('冲突必须点名是谁：' + JSON.stringify(found.busy[0].who));
    if (found.free.length !== 2) problems.push('其余两格应空闲，实测 ' + found.free.length);

    /* 七 ★★ 未知 ≠ 空闲（本项最贵的那一类错读数）。 */
    const withUnread = findCommonSlots(slots, [{ name: '甲', busy: [], unread: true }]);
    if (withUnread.unknown.length !== 3) problems.push('没读到的那些人 ⇒ 三格全判不了');
    if (withUnread.free.length !== 0) problems.push('★★ 未知**不得**读成空闲（否则会把人约到已排满的时间）');
    if (withUnread.line.indexOf('未知**不算**空闲') < 0) problems.push('读数必须说清「未知不算空闲」：' + withUnread.line);
    if (withUnread.unknown[0].why.indexOf('不是「空闲」') < 0) problems.push('逐格理由也必须说清：' + withUnread.unknown[0].why);

    /* 八 没选人 ⇒ 如实说（不是「都空闲」）。 */
    const noPeople = findCommonSlots(slots, []);
    if (noPeople.state !== REC_STATES.ABSENT) problems.push('没选人 ⇒ absent');
    if (noPeople.line.indexOf('还没选人') < 0) problems.push('必须说清还没选人：' + noPeople.line);

    /* 九 读不到与没有这一条分形。 */
    const bad = expandOccurrences({ thrown: true }, 1);
    const absent = expandOccurrences(null, 1);
    if (bad.state !== REC_STATES.UNREADABLE) problems.push('取数失败 ⇒ unreadable');
    if (absent.state !== REC_STATES.ABSENT) problems.push('空件 ⇒ absent');
    if (bad.state === absent.state) problems.push('★「读不到」与「没有这一条」必须不同形');

    /* 十 只读面（不产定时器 / 不读时钟）。 */
    const single = expandOccurrences({ freq: 'none' }, 1);
    if (single.state !== REC_STATES.SINGLE) problems.push('非周期 ⇒ single');
    if (w.occurrences.length > REC_LIMITS.occurrences) problems.push('展开期数必须受限');

    return { problems: problems, exceptionActions: ex.length, slotStates: slotStates.length };
}

export default {
    REC_EXCEPTION,
    REC_FREQ,
    REC_STATES,
    SLOT_STATES,
    REC_LIMITS,
    normalizeRule,
    expandOccurrences,
    applyExceptions,
    findCommonSlots,
    commonSlotLine,
    recurrenceSelfCheck,
};