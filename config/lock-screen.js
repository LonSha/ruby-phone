/**
 * config/lock-screen.js — R24-X9 锁屏与「今天」：手机的门面（v4.158.0）
 *
 * 【治的欠债】本仓有主屏（图标墙）、通知中心、洞察，**没有锁屏**：
 *   用户打开手机直接落到图标墙，跳过了「这台手机今天怎么样」这一层。
 *
 * 【只聚合已有事实】五块读数（剧情钟 / 日期 / 天气 / 未读 / 今日摘要）全部来自
 *   `config/phone-facts.js` 的事实快照，**不新算、不猜**（同一个值不许各算一遍）。
 *   事实为 `unknown` 时显示「未知」而不是 0 或旧值：`unread` 的 0 与「未上报」是两件事。
 *
 * 【空不是零】今日全 0 时显示「今天还没有什么」；全未知时显示「今天的数据还没准备好」。
 *   一句话：**没有数据不许画成 0**。
 *
 * 【可关】`settings.lockScreen === false` 时返回 `disabled` + `bypassTo: 'home'`，
 *   启动路径与 v4.157 一致（不新增一步）。
 *
 * 【点通知直达】`notificationTarget()` 必须解析到 App + 会话/条目锚；
 *   只解析到 App 的算 `unresolved`（点开会话列表 ≠ 直达）。
 */
import { numOrNull } from './num-gate.js';

export const LOCK_SECTIONS = Object.freeze(['clock', 'date', 'weather', 'unread', 'today']);

export const LOCK_FACES = Object.freeze({
    ready: '数据齐全',
    partial: '部分未知',
    disabled: '锁屏已关闭',
    malformed: '入参非法'
});

export const LOCK_UNKNOWN_REASONS = Object.freeze({
    'no-declaration': '这条事实没有发布者登记',
    'never-published': '登记了但从未发布',
    'publisher-off': '发布者未上电',
    'not-provided': '调用方没有提供这条事实'
});

const UNKNOWN_TEXT = {
    clock: '--:--',
    date: '日期未知',
    weather: '天气未知',
    unread: '未读数未知',
    today: '今天的数据还没准备好'
};

function pad2(n) {
    return (n < 10 ? '0' : '') + String(n);
}

function factOf(facts, name) {
    const f = facts && typeof facts === 'object' ? facts[name] : null;
    if (!f || typeof f !== 'object') return { face: 'unknown', reason: 'not-provided', value: null };
    const face = f.face === 'known' || f.face === 'stale' ? f.face : 'unknown';
    if (face === 'unknown') {
        return { face: 'unknown', reason: f.reason || 'never-published', value: null };
    }
    return { face, reason: f.reason || '', value: f.value };
}

/** 剧情钟：只认 { hour, minute }，缺一即 unknown（不拿系统钟顶替）。 */
function clockSection(fact) {
    if (fact.face === 'unknown') return { id: 'clock', face: 'unknown', text: UNKNOWN_TEXT.clock, reason: fact.reason };
    const v = fact.value && typeof fact.value === 'object' ? fact.value : {};
    const h = numOrNull(v.hour);
    const m = numOrNull(v.minute);
    if (h === null || m === null || h < 0 || h > 23 || m < 0 || m > 59) {
        return { id: 'clock', face: 'unknown', text: UNKNOWN_TEXT.clock, reason: 'bad-value' };
    }
    return { id: 'clock', face: fact.face, text: pad2(Math.floor(h)) + ':' + pad2(Math.floor(m)), reason: '' };
}

function dateSection(fact) {
    if (fact.face === 'unknown') return { id: 'date', face: 'unknown', text: UNKNOWN_TEXT.date, reason: fact.reason };
    const v = fact.value && typeof fact.value === 'object' ? fact.value : {};
    const y = numOrNull(v.year);
    const mo = numOrNull(v.month);
    const d = numOrNull(v.day);
    if (y === null || mo === null || d === null) return { id: 'date', face: 'unknown', text: UNKNOWN_TEXT.date, reason: 'bad-value' };
    return { id: 'date', face: fact.face, text: y + ' 年 ' + mo + ' 月 ' + d + ' 日', reason: '' };
}

function weatherSection(fact) {
    if (fact.face === 'unknown') return { id: 'weather', face: 'unknown', text: UNKNOWN_TEXT.weather, reason: fact.reason };
    const v = fact.value && typeof fact.value === 'object' ? fact.value : {};
    const temp = numOrNull(v.temp);
    const desc = typeof v.desc === 'string' ? v.desc : '';
    if (temp === null && desc === '') return { id: 'weather', face: 'unknown', text: UNKNOWN_TEXT.weather, reason: 'bad-value' };
    return {
        id: 'weather',
        face: fact.face,
        text: (desc || '天气') + (temp === null ? '' : ' ' + temp + '°'),
        reason: ''
    };
}

function unreadSection(fact) {
    if (fact.face === 'unknown') return { id: 'unread', face: 'unknown', text: UNKNOWN_TEXT.unread, reason: fact.reason, value: null };
    const n = numOrNull(fact.value);
    if (n === null || n < 0) return { id: 'unread', face: 'unknown', text: UNKNOWN_TEXT.unread, reason: 'bad-value', value: null };
    return { id: 'unread', face: fact.face, text: n === 0 ? '没有未读' : n + ' 条未读', reason: '', value: n };
}

/** 今日摘要：三项分别取事实，全未知 ≠ 全 0。 */
function todaySection(input) {
    const raw = input && typeof input === 'object' ? input : {};
    const msgs = raw.msgs && typeof raw.msgs === 'object' ? raw.msgs : null;
    const diary = raw.diary && typeof raw.diary === 'object' ? raw.diary : null;
    const schedule = raw.schedule && typeof raw.schedule === 'object' ? raw.schedule : null;
    const pick = (f) => {
        if (!f) return { face: 'unknown', value: null };
        if (f.face !== 'known' && f.face !== 'stale') return { face: 'unknown', value: null };
        const n = numOrNull(f.value);
        return n === null ? { face: 'unknown', value: null } : { face: f.face, value: n };
    };
    const m = pick(msgs); const d = pick(diary); const s = pick(schedule);
    const known = [m, d, s].filter((x) => x.face !== 'unknown').length;
    if (known === 0) {
        return { id: 'today', face: 'unknown', text: UNKNOWN_TEXT.today, reason: 'all-unknown', counts: null, known };
    }
    const nums = { msgs: m.value, diary: d.value, schedule: s.value };
    const allZero = (nums.msgs || 0) === 0 && (nums.diary || 0) === 0 && (nums.schedule || 0) === 0;
    const parts = [];
    if (nums.msgs !== null) parts.push('消息 ' + nums.msgs);
    if (nums.diary !== null) parts.push('日记 ' + nums.diary);
    if (nums.schedule !== null) parts.push('日程 ' + nums.schedule);
    return {
        id: 'today',
        face: known === 3 ? 'known' : 'stale',
        text: allZero ? '今天还没有什么' : parts.join(' · '),
        reason: allZero ? 'all-zero' : '',
        counts: nums,
        known
    };
}

/**
 * @param {{facts?:object, settings?:{lockScreen?:boolean}, today?:object}} input
 */
export function buildLockFace(input) {
    const src = input && typeof input === 'object' ? input : null;
    if (!src) return { face: 'malformed', reason: 'no-input', sections: [], bypassTo: null };
    const settings = src.settings && typeof src.settings === 'object' ? src.settings : {};
    if (settings.lockScreen === false) {
        return { face: 'disabled', reason: 'user-disabled', sections: [], bypassTo: 'home', missing: [] };
    }
    const facts = src.facts && typeof src.facts === 'object' ? src.facts : {};
    const sections = [
        clockSection(factOf(facts, 'storyClock')),
        dateSection(factOf(facts, 'storyDate')),
        weatherSection(factOf(facts, 'weather')),
        unreadSection(factOf(facts, 'unread')),
        todaySection(src.today)
    ];
    const missing = sections.filter((s) => s.face === 'unknown').map((s) => s.id);
    return {
        face: missing.length === 0 ? 'ready' : 'partial',
        reason: missing.length === 0 ? 'all-known' : 'has-unknown',
        sections,
        missing,
        bypassTo: null
    };
}

/** 点通知直达：必须带锚（会话/条目），只有 App 的算 unresolved。 */
export function notificationTarget(notification) {
    const n = notification && typeof notification === 'object' ? notification : null;
    if (!n) return { face: 'unresolved', reason: 'no-notification' };
    const appId = typeof n.appId === 'string' ? n.appId.trim() : '';
    if (appId === '') return { face: 'unresolved', reason: 'no-app' };
    const conversationId = typeof n.conversationId === 'string' && n.conversationId !== '' ? n.conversationId : null;
    const entryId = typeof n.entryId === 'string' && n.entryId !== '' ? n.entryId : null;
    if (!conversationId && !entryId) return { face: 'unresolved', reason: 'no-anchor', appId };
    return { face: 'resolved', appId, conversationId, entryId };
}

/** 锁屏读数与各 App 内读数是否同源：同一事实 name 取值必须相等（不许各算一遍）。 */
export function sameSource(left, right, name) {
    const a = factOf(left, name);
    const b = factOf(right, name);
    if (a.face !== b.face) return { same: false, reason: 'face-differs', left: a.face, right: b.face };
    return { same: JSON.stringify(a.value) === JSON.stringify(b.value), reason: 'value-differs', left: a.value, right: b.value };
}

export function lockScreenSelfCheck() {
    const bad = [];
    const full = {
        facts: {
            storyClock: { face: 'known', value: { hour: 9, minute: 5 } },
            storyDate: { face: 'known', value: { year: 2026, month: 11, day: 18 } },
            weather: { face: 'known', value: { temp: 12, desc: '阴' } },
            unread: { face: 'known', value: 3 }
        },
        today: { msgs: { face: 'known', value: 12 }, diary: { face: 'known', value: 0 }, schedule: { face: 'known', value: 2 } },
        settings: { lockScreen: true }
    };
    const ready = buildLockFace(full);
    if (ready.face !== 'ready') bad.push('齐全时应 ready');
    if (ready.sections.length !== 5) bad.push('五块读数应齐');
    if (ready.sections[0].text !== '09:05') bad.push('剧情钟应补零');
    if (ready.sections[3].value !== 3) bad.push('未读数应为 3');

    const noUnread = buildLockFace(Object.assign({}, full, { facts: Object.assign({}, full.facts, { unread: { face: 'known', value: 0 } }) }));
    if (noUnread.sections[3].text !== '没有未读') bad.push('已知 0 应显示「没有未读」');

    const off = buildLockFace(Object.assign({}, full, { facts: Object.assign({}, full.facts, { unread: { face: 'unknown', reason: 'publisher-off' } }) }));
    if (off.sections[3].face !== 'unknown') bad.push('未上报应 unknown（不许当 0）');
    if (off.sections[3].text === '没有未读') bad.push('unknown 与 0 必须不同形');
    if (off.face !== 'partial') bad.push('缺一块应 partial');
    if (off.missing[0] !== 'unread') bad.push('missing 应列出缺的块');

    const emptyToday = buildLockFace(Object.assign({}, full, {
        today: { msgs: { face: 'known', value: 0 }, diary: { face: 'known', value: 0 }, schedule: { face: 'known', value: 0 } }
    }));
    if (emptyToday.sections[4].text !== '今天还没有什么') bad.push('全 0 应说「今天还没有什么」');

    const unknownToday = buildLockFace(Object.assign({}, full, { today: {} }));
    if (unknownToday.sections[4].text !== '今天的数据还没准备好') bad.push('全未知应与全 0 不同形');

    const disabled = buildLockFace({ settings: { lockScreen: false } });
    if (disabled.face !== 'disabled' || disabled.bypassTo !== 'home') bad.push('关掉锁屏应直达桌面');

    if (notificationTarget({ appId: 'wechat' }).face !== 'unresolved') bad.push('无锚通知不许算直达');
    const t = notificationTarget({ appId: 'wechat', conversationId: 'c1', entryId: 'm7' });
    if (t.face !== 'resolved' || t.conversationId !== 'c1' || t.entryId !== 'm7') bad.push('带锚通知应解析到会话');

    const same = sameSource(full.facts, full.facts, 'unread');
    if (!same.same) bad.push('同源事实应相等');
    const diff = sameSource(full.facts, { unread: { face: 'unknown' } }, 'unread');
    if (diff.same) bad.push('一边 unknown 不许判同源');

    return { ok: bad.length === 0, bad, sample: 'sections=' + ready.sections.length + ' missing=' + off.missing.join(',') };
}

export default {
    LOCK_SECTIONS,
    LOCK_FACES,
    LOCK_UNKNOWN_REASONS,
    buildLockFace,
    notificationTarget,
    sameSource,
    lockScreenSelfCheck
};