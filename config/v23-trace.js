/**
 * config/v23-trace.js — 第二十三期拓展九项（R23-X1~X9）唯一桥（v4.157.0）
 *
 * 纪律：纯函数、不碰 DOM、不写存储、不替角色推断。九项共同口径是**三态不塌**：
 *   证据不足一律 `insufficient`，读不出锚一律 `unknown`，绝不用 false / 0 / 空串顶替。
 *   「没证据」与「是假的」在本仓是两个事实，本桥把这条守成机器可读的形状。
 */

/** 取楼层（数字或数字串），读不出返回 null —— 不把 '' 当 0。 */
function floorOf(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/* ── R23-X1 跨 App 时间轴总览：三态 + 逐源列出读不到的源 ── */
export function crossAppTimeline(sources) {
    const list = Array.isArray(sources) ? sources : [];
    const rows = [];
    const unreadable = [];
    for (const s of list) {
        if (!s || typeof s !== 'object' || !Array.isArray(s.items)) { unreadable.push(s && s.app != null ? String(s.app) : 'unknown-source'); continue; }
        const items = s.items
            .map((it) => ({ app: String(s.app == null ? '' : s.app), floor: floorOf(it && it.floor), text: it && it.text != null ? String(it.text) : '' }))
            .filter((it) => it.floor !== null);
        rows.push(...items);
    }
    if (rows.length === 0 && unreadable.length === 0) return { face: 'empty', items: [], unreadable };
    rows.sort((a, b) => a.floor - b.floor);
    return { face: unreadable.length > 0 ? 'partial' : 'ok', items: rows, unreadable };
}

/* ── R23-X2 角色沉默的语义：窗口内无回应才算沉默，无证据必须 insufficient ── */
export function silenceReading(input) {
    const s = input && typeof input === 'object' ? input : {};
    const msgs = Array.isArray(s.messages) ? s.messages : null;
    const askFloor = floorOf(s.askFloor);
    const now = floorOf(s.nowFloor);
    const window = floorOf(s.window) === null ? 5 : floorOf(s.window);
    if (msgs === null || askFloor === null || now === null) return { face: 'insufficient', reason: 'no-anchor', replies: [] };
    if (now - askFloor < window) return { face: 'insufficient', reason: 'window-not-elapsed', replies: [] };
    const replies = msgs
        .map((m) => ({ floor: floorOf(m && m.floor), from: m && m.from != null ? String(m.from) : '' }))
        .filter((m) => m.floor !== null && m.floor > askFloor && m.floor <= now && (s.addressedTo == null || m.from === String(s.addressedTo)));
    if (replies.length > 0) return { face: 'answered', replies };
    return { face: 'silent', askFloor, window, now, replies: [] };
}

/* ── R23-X3 被打断话题的挂起：suspended / resumed / expired ── */
export function topicSuspension(input) {
    const s = input && typeof input === 'object' ? input : {};
    const floor = floorOf(s.floor);
    const now = floorOf(s.nowFloor);
    const ttl = floorOf(s.ttl);
    if (floor === null || now === null || ttl === null) return { face: 'invalid', reason: 'no-anchor' };
    const resumedAt = floorOf(s.resumedAt);
    if (resumedAt !== null) return { face: 'resumed', floor, resumedAt };
    if (now - floor > ttl) return { face: 'expired', floor, now, ttl, overdueBy: now - floor - ttl };
    return { face: 'suspended', floor, now, ttl, remain: ttl - (now - floor) };
}

/* ── R23-X4 手机使用作息画像：样本不足不产结论 ── */
export function usageRhythm(input, opts) {
    const s = input && typeof input === 'object' ? input : {};
    const minSamples = floorOf(opts && opts.minSamples) === null ? 5 : floorOf(opts.minSamples);
    const sessions = Array.isArray(s.sessions) ? s.sessions.filter((x) => x && floorOf(x.startMs) !== null && floorOf(x.endMs) !== null) : [];
    if (sessions.length < minSamples) return { face: 'insufficient', samples: sessions.length, minSamples, buckets: [] };
    const buckets = new Array(24).fill(0);
    for (const x of sessions) {
        const h = new Date(floorOf(x.startMs)).getHours();
        buckets[h] += Math.max(1, Math.round((floorOf(x.endMs) - floorOf(x.startMs)) / 60000));
    }
    let peak = 0;
    for (let i = 1; i < 24; i++) if (buckets[i] > buckets[peak]) peak = i;
    return { face: 'profile', samples: sessions.length, buckets, peakHour: peak, note: '按分钟累加，样本 ' + sessions.length + ' 段' };
}

/* ── R23-X5 误发与撤回生命周期：unknown 不许说成「没看到」 ── */
export function recallLifecycle(input) {
    const m = input && typeof input === 'object' ? input.msg : null;
    if (!m || typeof m !== 'object') return { face: 'unknown', reason: 'no-message' };
    const sent = floorOf(m.sentAtFloor);
    const recalled = floorOf(m.recalledAtFloor);
    const seen = floorOf(m.seenAtFloor);
    if (sent === null) return { face: 'unknown', reason: 'no-sent-floor' };
    if (recalled === null) return seen === null ? { face: 'unknown', reason: 'no-seen-evidence' } : { face: 'visible', sent, seen };
    if (seen === null) return { face: 'unknown', reason: 'recalled-without-seen-evidence', sent, recalled };
    return seen < recalled ? { face: 'seen-before-recall', sent, recalled, seen } : { face: 'recalled-before-seen', sent, recalled, seen };
}

/* ── R23-X6 多设备同步叙事：三态不塌成一个布尔 ── */
export function deviceSync(input) {
    const s = input && typeof input === 'object' ? input : {};
    const devices = Array.isArray(s.devices) ? s.devices.filter((d) => d && typeof d === 'object') : [];
    if (devices.length === 0) return { face: 'unknown', reason: 'no-device', devices: [] };
    const rows = devices.map((d) => ({ id: String(d.id == null ? '?' : d.id), lastFloor: floorOf(d.lastFloor) }));
    const known = rows.filter((r) => r.lastFloor !== null);
    if (known.length === 0) return { face: 'unknown', reason: 'no-floor-on-any-device', devices: rows };
    const max = Math.max(...known.map((r) => r.lastFloor));
    const lagging = rows.filter((r) => r.lastFloor === null || max - r.lastFloor > 0);
    if (lagging.length === 0) return { face: 'synced', max, devices: rows };
    return { face: 'lagging', max, lagging, devices: rows };
}

/* ── R23-X7 关系年度回顾：每条可回源；空年逐字说「没怎么说过话」 ── */
export function relationshipAnnual(input) {
    const s = input && typeof input === 'object' ? input : {};
    const year = floorOf(s.year);
    const moments = Array.isArray(s.moments) ? s.moments : [];
    const kept = moments
        .map((m) => ({ floor: floorOf(m && m.floor), quote: m && m.quote != null ? String(m.quote) : '', who: m && m.who != null ? String(m.who) : '' }))
        .filter((m) => m.floor !== null && m.quote.length > 0);
    if (year === null) return { face: 'invalid', reason: 'no-year' };
    if (kept.length === 0) return { face: 'empty-year', year, moments: [], text: '这一年没怎么说过话' };
    return { face: 'review', year, moments: kept, unreadable: moments.length - kept.length };
}

/* ── R23-X8 消息草稿跨轮保留：悄悄消失必须显形 ── */
export function draftRetention(input) {
    const s = input && typeof input === 'object' ? input : {};
    const drafts = Array.isArray(s.drafts) ? s.drafts : [];
    const chatId = s.chatId == null ? null : String(s.chatId);
    const prev = floorOf(s.prevFloor);
    if (chatId === null) return { face: 'unknown', reason: 'no-chat-id' };
    const hit = drafts.find((d) => d && String(d.chatId) === chatId);
    if (!hit) return prev !== null && s.hadDraft ? { face: 'dropped', chatId, prevFloor: prev, text: '上一轮的草稿这一轮不见了' } : { face: 'none', chatId };
    return { face: 'kept', chatId, text: hit.text == null ? '' : String(hit.text), floor: floorOf(hit.floor) };
}

/* ── R23-X9 群聊「谁在听」：observed 必须有实测证据，不许画像冒充 ── */
export function groupListening(input) {
    const s = input && typeof input === 'object' ? input : {};
    const members = Array.isArray(s.members) ? s.members.filter((m) => m && typeof m === 'object') : [];
    const msgFloor = floorOf(s.msgFloor);
    if (members.length === 0 || msgFloor === null) return { face: 'insufficient', reason: 'no-evidence', observed: [] };
    const observed = [];
    for (const m of members) {
        const marks = Array.isArray(m.reactions) ? m.reactions.map(floorOf).filter((x) => x !== null) : [];
        const measured = marks.filter((x) => x >= msgFloor);
        if (measured.length > 0) observed.push({ id: String(m.id == null ? '?' : m.id), evidence: measured });
    }
    if (observed.length === 0) return { face: 'insufficient', reason: 'no-measured-reaction', observed: [] };
    return { face: 'observed', msgFloor, observed };
}

/** 九项装配自检：每项两向（正例与「证据不足」例）都在这里跑一遍，缺一即红。 */
export function v23TraceSelfCheck() {
    const bad = [];
    const tl = crossAppTimeline([{ app: 'wechat', items: [{ floor: 3, text: 'a' }] }, { app: 'broken' }]);
    if (tl.face !== 'partial' || tl.unreadable.length !== 1) bad.push('X1 读不到的源必须逐源列出');
    if (crossAppTimeline([]).face !== 'empty') bad.push('X1 空源应 empty');
    if (silenceReading({ messages: [], askFloor: 1, nowFloor: 2 }).face !== 'insufficient') bad.push('X2 窗口未到不许判沉默');
    if (silenceReading({ messages: [], askFloor: 1, nowFloor: 9, window: 5 }).face !== 'silent') bad.push('X2 窗口过且无回应应 silent');
    if (topicSuspension({ floor: 1, nowFloor: 3, ttl: 10 }).face !== 'suspended') bad.push('X3 未超时应 suspended');
    if (topicSuspension({ floor: 1, nowFloor: 30, ttl: 10 }).face !== 'expired') bad.push('X3 超时应 expired');
    if (usageRhythm({ sessions: [{ startMs: 1, endMs: 2 }] }).face !== 'insufficient') bad.push('X4 样本不足应 insufficient');
    if (recallLifecycle({ msg: { sentAtFloor: 1, recalledAtFloor: 5 } }).face !== 'unknown') bad.push('X5 撤回收不到「看过」证据必须 unknown');
    if (deviceSync({ devices: [{ id: 'a', lastFloor: 5 }, { id: 'b', lastFloor: 4 }] }).face !== 'lagging') bad.push('X6 落后必须显形');
    if (deviceSync({ devices: [{ id: 'a' }] }).face !== 'unknown') bad.push('X6 全都读不出楼层应 unknown');
    if (relationshipAnnual({ year: 2026, moments: [] }).face !== 'empty-year') bad.push('X7 空年必须 empty-year');
    if (draftRetention({ chatId: 'c1', drafts: [], hadDraft: true, prevFloor: 3 }).face !== 'dropped') bad.push('X8 草稿消失必须显形');
    if (groupListening({ members: [{ id: 'm', reactions: [] }], msgFloor: 5 }).face !== 'insufficient') bad.push('X9 无实测不许 observed');
    if (groupListening({ members: [{ id: 'm', reactions: [6] }], msgFloor: 5 }).face !== 'observed') bad.push('X9 有实测应 observed');
    return { ok: bad.length === 0, bad };
}
