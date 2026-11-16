/**
 * 剧情周回顾 —— 唯一桥（v4.156.0 · R21-X9）
 *
 * 要解决的问题：一周之后，玩家没有任何「这段时间发生过什么」的入口。
 * 记忆插件那套回声/摘要不在本仓可控范围内，本桥只做**本仓自己能兑现**的那部分：
 * 把各 app 已有的 storyAt 事件汇总成 ≤5 条摘要，每一条都指得回具体的 app 与具体记录。
 *
 * 四条纪律（写在前面，改代码前先读）：
 *   1. 只读不改：本桥不写任何存储，**一个字节都不写**。验收语「取消后不改原数据」
 *      同理适用于回顾——看回顾不许改变任何东西。
 *   2. 不创生数据：没有的事件不生、空周就是空。宁可让玩家看到
 *      「本周没什么特别的事」，也不许编三条凑上去。
 *   3. 每条必须可回源：没有 recordId 的事件**不进摘要**，因为点了没处去。
 *      全是这种人时不是「空周」，是「有但点不回去」——这是两种不同的坏法，不许同形。
 *   4. 不新增孤岛引擎：本桥不 import 任何 app、不碰 story-clock，
 *      周窗算术与判读全部收在这里一处，视图直接吃 `face`。
 *
 * 与 X6（变动摘要）的分工，别搞混：
 *   · X6 回答「我不在的这段里变了什么」（离开→回来两时刻之差）；
 *   · X9 回答「这一周里发生过什么」（固定的 7 天剧情窗，与在不在无关）。
 *   所以 X9 没有「一直待着不动就不出现」这条对照——一周持续在场照样该回顾。
 */

import { numOrNull } from './num-gate.js';

/** 一天有多少毫秒。剧情钟的 storyAt 是毫秒刻度，这里只做算术，不读任何时钟。 */
const DAY_MS = 86400000;

/** 限额闭集。全部可被调用方覆盖，但不许在视图里另定一套。 */
export const WEEKLY_RECAP_LIMITS = Object.freeze({
    days: 7,          /* 剧情周 = 7 个剧情日，不是自然周（自然周的周一/周日在本仓没有意义） */
    maxItems: 5,      /* 验收语「≤5 条摘要」 */
    perAppCap: 2,     /* 单个 app 至多占 2 条：防一个话痨 app 独吞全部五个位置 */
    maxTitleChars: 48 /* 单条标题上限，超了截断加省略号，保证一屏放得下 */
});

/** 四态面。缺席 / 真空 / 有但不可回源 / 有货 —— 四种都不同形，不许合并。 */
export const WEEKLY_RECAP_FACES = Object.freeze({
    UNAVAILABLE: 'unavailable', /* 读不到剧情日期，或事件账根本没接上 */
    EMPTY: 'empty',             /* 真的没什么（空周） */
    UNLINKED: 'unlinked',       /* 有事，但每条都缺 recordId，点了没处去 */
    RECAP: 'recap'              /* 有货 */
});

/** 归因码闭集。面回答「怎么呈现」，归因回答「为什么是这个面」。 */
export const WEEKLY_RECAP_REASONS = Object.freeze({
    NO_CLOCK: 'no_clock',
    CLOCK_REWOUND: 'clock_rewound',
    NO_LEDGER: 'no_ledger',
    NOTHING: 'nothing',
    ALL_UNSOURCED: 'all_unsourced',
    OK: 'ok'
});

/**
 * 事件类型 → 人话。**未登记的 kind 不许现编名字**（给原名并标 registered:false）。
 * noun 是量词短语，直接拼进「N 条消息」这种句子。
 */
export const WEEKLY_RECAP_KINDS = Object.freeze({
    message: { noun: '条消息', verb: '说了话' },
    call: { noun: '通电话', verb: '通了电话' },
    moment: { noun: '条朋友圈', verb: '发了朋友圈' },
    photo_added: { noun: '张照片', verb: '存了照片' },
    diary_written: { noun: '篇日记', verb: '写了日记' },
    calendar_event: { noun: '个日程', verb: '记了日程' },
    order_delivered: { noun: '个订单', verb: '收到了快递' },
    note_edited: { noun: '条笔记', verb: '改了笔记' }
});

function str(v) {
    return typeof v === 'string' ? v.trim() : '';
}

/** id 可能是数字（消息 id 常是毫秒时间戳），数字也要认，不能因类型不同就当成缺。 */
function idOf(v) {
    if (typeof v === 'number' && isFinite(v)) return String(v);
    return str(v);
}

function clip(text, limit) {
    const s = str(text);
    const max = numOrNull(limit);
    if (max === null || max <= 0 || s.length <= max) return s;
    return s.slice(0, Math.max(0, max - 1)) + '…';
}

/**
 * 剧情周窗：`[now - days*DAY_MS, now]`，两端都含。
 * `nowMs` 读不出来 → `{ ok:false }`，**绝不回落墙钟**（回落会把真实世界的这一周
 * 塞进剧情周，玩家会看到还没发生的回顾）。
 */
export function weekWindowOf(nowMs, options = {}) {
    const now = numOrNull(nowMs);
    if (now === null) return { ok: false, startMs: null, endMs: null };
    const optDays = numOrNull(options && options.days);
    const days = optDays === null ? WEEKLY_RECAP_LIMITS.days : Math.max(1, Math.floor(optDays));
    return { ok: true, startMs: now - days * DAY_MS, endMs: now };
}

function recapItemOf(raw, ms, recordId) {
    const appId = str(raw.appId);
    const named = str(raw.appName);
    const kind = str(raw.kind);
    const spec = Object.prototype.hasOwnProperty.call(WEEKLY_RECAP_KINDS, kind)
        ? WEEKLY_RECAP_KINDS[kind]
        : null;
    return {
        appId,
        appName: named || appId,        /* 未登记不编名字：给了原名就原名，没给就空 */
        appNamed: !!named,
        kind,
        kindLabel: spec ? spec.noun : (kind || '未登记事件'),
        registered: !!spec,
        title: clip(raw.title || raw.line || raw.summary, WEEKLY_RECAP_LIMITS.maxTitleChars),
        storyMs: ms,
        /* 回源三元组：视图拿它 openApp(appId) + 定位 recordId。缺一个都不成。 */
        source: { appId, recordId }
    };
}

/**
 * 挑条目：按 app 分桶（桶内时间倒序），再**轮转**抽取，每桶至多 perAppCap 条，
 * 取满 maxItems 为止。最后按剧情时间倒序排一遍给人看。
 *
 * 为什么轮转而不直接取最近 N 条：一个 app 两百条消息会把另外三个 app 的活动全挤掉，
 * 玩家点开回顾只看到「聊天」一件事，周刊就失去跨 app 的意义。
 */
function pickRecapItems(kept, maxItems, perAppCap) {
    const buckets = new Map();
    for (const item of kept) {
        const key = item.appId || '';
        let list = buckets.get(key);
        if (!list) {
            list = [];
            buckets.set(key, list);
        }
        list.push(item);
    }
    const order = [];
    for (const list of buckets.values()) {
        list.sort((a, b) => b.storyMs - a.storyMs);
        order.push(list);
    }
    /* 桶按「最新的那条」先后排，最近有动静的 app 先拿位置 */
    order.sort((a, b) => b[0].storyMs - a[0].storyMs);

    const picked = [];
    for (let round = 0; round < perAppCap; round++) {
        let exhausted = true;
        for (const list of order) {
            if (picked.length >= maxItems) break;
            if (round < list.length) {
                picked.push(list[round]);
                exhausted = false;
            }
        }
        if (picked.length >= maxItems || exhausted) break;
    }
    picked.sort((a, b) => b.storyMs - a.storyMs);
    return { items: picked, dropped: kept.length - picked.length };
}

/**
 * 主入口。纯函数，零 IO，不改入参。
 *
 * @param {{ startMs?:number, endMs?:number, events?:Array, max?:number, perAppCap?:number }} input
 *   `events` 每一项形如 `{ appId, appName?, kind, title?, storyMs, recordId }`。
 *   事件由**调用方**从各 app 的账里抠出来交进来：本桥不 import 任何 app，
 *   也就不会因为某个 app 重构而跟着塌（也不会去替它们编事件）。
 * @returns 面 + 归因 + 条目 + 如实计数 + 一句人话
 */
export function weeklyRecap(input = {}) {
    const src = (input && typeof input === 'object') ? input : {};
    const out = {
        face: WEEKLY_RECAP_FACES.UNAVAILABLE,
        reason: WEEKLY_RECAP_REASONS.NO_CLOCK,
        weekStartMs: null,
        weekEndMs: null,
        items: [],
        dropped: 0,
        counts: { inWindow: 0, linked: 0, outside: 0, undated: 0, unsourced: 0 },
        line: ''
    };

    const startMs = numOrNull(src.startMs);
    const endMs = numOrNull(src.endMs);
    if (startMs === null || endMs === null) {
        out.line = weeklyRecapNote(out);
        return out;
    }
    out.weekStartMs = startMs;
    out.weekEndMs = endMs;
    if (endMs < startMs) {
        /* 剧情钟回拨。不许拿一个倒着的窗去比事件——那样每一件都会被判成「窗外」，
         * 玩家会看到「本周没什么特别的事」，而其实有一整周的事。 */
        out.reason = WEEKLY_RECAP_REASONS.CLOCK_REWOUND;
        out.line = weeklyRecapNote(out);
        return out;
    }

    if (!Array.isArray(src.events)) {
        /* `events: undefined`（账没接上）与 `events: []`（账是空的）必须不同因：
         * 前者是坏，后者是真空，文案不能混。 */
        out.reason = WEEKLY_RECAP_REASONS.NO_LEDGER;
        out.line = weeklyRecapNote(out);
        return out;
    }

    const kept = [];
    for (let i = 0; i < src.events.length; i++) {
        const raw = src.events[i];
        if (!raw || typeof raw !== 'object') continue;
        const ms = numOrNull(raw.storyMs);
        if (ms === null) {
            /* 没时间的条目不许猜个位置塞进窗里 —— 单独计数，从摘要里排除。 */
            out.counts.undated++;
            continue;
        }
        if (ms < startMs || ms > endMs) {
            out.counts.outside++;
            continue;
        }
        out.counts.inWindow++;
        const recordId = idOf(raw.recordId) || idOf(raw.sourceId) || idOf(raw.id);
        if (!recordId) {
            /* 点不回去的条目不进摘要。验收语「每条点得回原 app 位置」是硬要求。 */
            out.counts.unsourced++;
            continue;
        }
        out.counts.linked++;
        kept.push(recapItemOf(raw, ms, recordId));
    }

    if (out.counts.inWindow === 0) {
        out.face = WEEKLY_RECAP_FACES.EMPTY;
        out.reason = WEEKLY_RECAP_REASONS.NOTHING;
        out.line = weeklyRecapNote(out);
        return out;
    }
    if (kept.length === 0) {
        out.face = WEEKLY_RECAP_FACES.UNLINKED;
        out.reason = WEEKLY_RECAP_REASONS.ALL_UNSOURCED;
        out.line = weeklyRecapNote(out);
        return out;
    }

    const optMax = numOrNull(src.max);
    const optCap = numOrNull(src.perAppCap);
    const maxItems = optMax === null ? WEEKLY_RECAP_LIMITS.maxItems : Math.max(1, Math.floor(optMax));
    const perAppCap = optCap === null ? WEEKLY_RECAP_LIMITS.perAppCap : Math.max(1, Math.floor(optCap));
    const picked = pickRecapItems(kept, maxItems, perAppCap);

    out.items = picked.items;
    out.dropped = picked.dropped;
    out.face = WEEKLY_RECAP_FACES.RECAP;
    out.reason = WEEKLY_RECAP_REASONS.OK;
    out.line = weeklyRecapNote(out);
    return out;
}

/**
 * 文案的**唯一实现**。视图、诊断面、自检全部走这里，不许各拼一份。
 * 空周那一句是验收语的原文，动它等于动验收。
 */
export function weeklyRecapNote(o) {
    const f = (o && typeof o === 'object') ? o : {};
    if (f.face === WEEKLY_RECAP_FACES.UNAVAILABLE) {
        if (f.reason === WEEKLY_RECAP_REASONS.CLOCK_REWOUND) return '本周回顾暂不可用（剧情日期倒流）';
        if (f.reason === WEEKLY_RECAP_REASONS.NO_LEDGER) return '本周回顾暂不可用（读不到事件账）';
        return '本周回顾暂不可用（读不到剧情日期）';
    }
    if (f.face === WEEKLY_RECAP_FACES.EMPTY) return '本周没什么特别的事';
    if (f.face === WEEKLY_RECAP_FACES.UNLINKED) {
        const unsourced = f.counts ? numOrNull(f.counts.unsourced) : null;
        const n = unsourced === null ? 0 : unsourced;
        return '本周有 ' + n + ' 件事，但都点不回去（缺来源），暂不列出';
    }
    const items = Array.isArray(f.items) ? f.items : [];
    const parts = [];
    for (const item of items) {
        const text = str(item && item.title) || str(item && item.kindLabel) || '（无题）';
        const who = str(item && item.appName);
        parts.push(who ? who + '：' + text : text);
    }
    const dropped = numOrNull(f.dropped);
    const tail = (dropped !== null && dropped > 0) ? '（另有 ' + dropped + ' 件未列出）' : '';
    if (parts.length === 0) return '本周没什么特别的事';
    return '本周回顾：' + parts.join('；') + tail;
}

/* ══════════════════════════════════════════════════════════════════
 * 自检：正反两面都要验（有货 / 空周 / 有但不可回源 / 读不到），
 * 外加「周窗边界四向」「计数不被上限污染」「纯读扫描」。
 * ══════════════════════════════════════════════════════════════════ */
export function weeklyRecapSelfCheck() {
    const bad = [];
    const S = 1000 * DAY_MS;
    const E = S + WEEKLY_RECAP_LIMITS.days * DAY_MS;
    const ev = (patch) => Object.assign({
        appId: 'wechat',
        appName: '微信',
        kind: 'message',
        title: '聊了几句',
        storyMs: S + DAY_MS,
        recordId: 'm-1'
    }, patch || {});

    /* 1. 四态齐全 */
    const faces = Object.keys(WEEKLY_RECAP_FACES).length;
    if (faces !== 4) bad.push('面闭集应有 4 态，实得 ' + faces);

    /* 2. 验收语反面：空周如实说，且不许编条目 */
    const empty = weeklyRecap({ startMs: S, endMs: E, events: [] });
    if (empty.face !== WEEKLY_RECAP_FACES.EMPTY) bad.push('空周应为 empty，实得 ' + empty.face);
    if (empty.reason !== WEEKLY_RECAP_REASONS.NOTHING) bad.push('空周归因应为 nothing，实得 ' + empty.reason);
    if (empty.items.length !== 0) bad.push('空周不许有条目，实得 ' + empty.items.length);
    if (!/本周没什么特别的事/.test(empty.line)) bad.push('空周文案必须逐字含「本周没什么特别的事」：' + empty.line);

    /* 3. 账没接上 vs 账是空的：必须不同因 */
    const noLedger = weeklyRecap({ startMs: S, endMs: E });
    if (noLedger.reason !== WEEKLY_RECAP_REASONS.NO_LEDGER) bad.push('events 缺失应为 no_ledger，实得 ' + noLedger.reason);
    if (noLedger.reason === empty.reason) bad.push('「账没接上」与「空周」不许同因');
    if (noLedger.line === empty.line) bad.push('「账没接上」与「空周」不许同文案');

    /* 4. 读不到剧情日期：不回落墙钟 */
    const noClock = weeklyRecap({ events: [ev()] });
    if (noClock.face !== WEEKLY_RECAP_FACES.UNAVAILABLE) bad.push('无周窗应为 unavailable，实得 ' + noClock.face);
    if (noClock.reason !== WEEKLY_RECAP_REASONS.NO_CLOCK) bad.push('无周窗应为 no_clock，实得 ' + noClock.reason);

    /* 5. 剧情钟回拨不许被当成「没什么事」 */
    const rewound = weeklyRecap({ startMs: E, endMs: S, events: [ev()] });
    if (rewound.reason !== WEEKLY_RECAP_REASONS.CLOCK_REWOUND) bad.push('倒流窗应为 clock_rewound，实得 ' + rewound.reason);
    if (rewound.line === empty.line) bad.push('倒流不许说成「本周没什么特别的事」');

    /* 6. 验收语正面：有货且每条可回源 */
    const got = weeklyRecap({
        startMs: S,
        endMs: E,
        events: [
            ev({ appId: 'wechat', appName: '微信', kind: 'message', title: '和她说晚安', storyMs: S + DAY_MS, recordId: 101 }),
            ev({ appId: 'diary', appName: '日记', kind: 'diary_written', title: '写了三行', storyMs: S + 2 * DAY_MS, recordId: 'd-1' }),
            ev({ appId: 'album', appName: '相册', kind: 'photo_added', title: '存了一张照片', storyMs: S + 3 * DAY_MS, recordId: 'a-1' })
        ]
    });
    if (got.face !== WEEKLY_RECAP_FACES.RECAP) bad.push('有货应为 recap，实得 ' + got.face);
    if (got.items.length !== 3) bad.push('三条事件应得三条摘要，实得 ' + got.items.length);
    for (const item of got.items) {
        if (!item.source || !item.source.recordId) bad.push('每条摘要必须可回源，破了：' + JSON.stringify(item));
        if (!item.source || !item.source.appId) bad.push('每条摘要必须带 appId，破了：' + JSON.stringify(item));
    }
    /* 数字 id 不许因为不是字符串就被丢掉 */
    if (!got.items.some((x) => x.source.recordId === '101')) bad.push('数字型 recordId 被丢了（应归一成字符串 101）');

    /* 7. 时间倒序：最近的在前 */
    if (!(got.items.length >= 2 && got.items[0].storyMs >= got.items[1].storyMs)) bad.push('摘要应按剧情时间倒序');

    /* 8. 周窗边界四向：两端都含，外一拍都算窗外 */
    const edge = weeklyRecap({
        startMs: S,
        endMs: E,
        events: [
            ev({ storyMs: S, recordId: 'in-a' }),
            ev({ storyMs: E, recordId: 'in-b' }),
            ev({ storyMs: S - 1, recordId: 'out-a' }),
            ev({ storyMs: E + 1, recordId: 'out-b' })
        ]
    });
    if (edge.counts.inWindow !== 2) bad.push('周窗两端都含，应为 2 条，实得 ' + edge.counts.inWindow);
    if (edge.counts.outside !== 2) bad.push('窗外应为 2 条，实得 ' + edge.counts.outside);

    /* 9. storyMs === 0 是合法时刻，不许被当成「没时间」 */
    const zero = weeklyRecap({ startMs: 0, endMs: DAY_MS, events: [ev({ storyMs: 0, recordId: 'z-1' })] });
    if (zero.counts.undated !== 0) bad.push('storyMs=0 不是缺失，却被记成 undated');
    if (zero.items.length !== 1) bad.push('storyMs=0 的条目应进摘要，实得 ' + zero.items.length);

    /* 10. 没时间的条目不猜位置 */
    const undated = weeklyRecap({ startMs: S, endMs: E, events: [ev({ storyMs: undefined, recordId: 'u-1' })] });
    if (undated.counts.undated !== 1) bad.push('缺 storyMs 应记 undated，实得 ' + undated.counts.undated);
    if (undated.items.length !== 0) bad.push('缺 storyMs 的条目不许进摘要');

    /* 11. 有但都点不回去：是 unlinked，不是「没什么事」 */
    const unlinked = weeklyRecap({
        startMs: S,
        endMs: E,
        events: [ev({ recordId: '' }), ev({ recordId: undefined, id: undefined, storyMs: S + 2 * DAY_MS })]
    });
    if (unlinked.face !== WEEKLY_RECAP_FACES.UNLINKED) bad.push('全无来源应为 unlinked，实得 ' + unlinked.face);
    if (unlinked.reason !== WEEKLY_RECAP_REASONS.ALL_UNSOURCED) bad.push('全无来源应为 all_unsourced，实得 ' + unlinked.reason);
    if (unlinked.line === empty.line) bad.push('「有事但点不回去」与「没什么事」不许同形');
    if (!/点不回去/.test(unlinked.line)) bad.push('不可回源文案要点明原因：' + unlinked.line);

    /* 12. 上限：不许超过 5 条，超出部分如实记 dropped。
     * 事件必须摊在 ≥5 个不同 app 上——perAppCap=2 意味着单 app 至多贡献 2 条，
     * 若只给 2 个 app 就永远凑不满 5 条（那是上限语义在工作，不是缺陷）。 */
    const many = [];
    for (let i = 0; i < 7; i++) {
        many.push(ev({ appId: 'app' + i, appName: '应用' + i, storyMs: S + (i + 1) * 3600000, recordId: 'r-' + i }));
    }
    const capped = weeklyRecap({ startMs: S, endMs: E, events: many });
    if (capped.items.length !== WEEKLY_RECAP_LIMITS.maxItems) bad.push('上限应为 5 条，实得 ' + capped.items.length);
    if (capped.dropped !== 7 - WEEKLY_RECAP_LIMITS.maxItems) bad.push('dropped 应如实记 2，实得 ' + capped.dropped);
    if (!/另有 2 件未列出/.test(capped.line)) bad.push('截断要如实告知：' + capped.line);
    /* 上限语义反面：两个 app 各 4 条时只取 4 条，不许为凑 5 条突破 perAppCap */
    const twoApps = [];
    for (let i = 0; i < 8; i++) {
        twoApps.push(ev({ appId: 'app' + (i % 2), appName: '应用' + (i % 2), storyMs: S + (i + 1) * 3600000, recordId: 't-' + i }));
    }
    const cappedTwo = weeklyRecap({ startMs: S, endMs: E, events: twoApps });
    if (cappedTwo.items.length !== 4) bad.push('2 个 app × perAppCap=2 应得 4 条（不许破 cap 凑满 5），实得 ' + cappedTwo.items.length);
    if (cappedTwo.dropped !== 4) bad.push('dropped 应如实记 4，实得 ' + cappedTwo.dropped);

    /* 13. 一个话痨 app 不许独吞：轮转保证多 app 都在 */
    const noisy = [];
    for (let i = 0; i < 10; i++) noisy.push(ev({ appId: 'wechat', appName: '微信', storyMs: S + (i + 1) * 60000, recordId: 'w-' + i }));
    noisy.push(ev({ appId: 'diary', appName: '日记', storyMs: S + 7200000, recordId: 'd-9' }));
    const mix = weeklyRecap({ startMs: S, endMs: E, events: noisy });
    const apps = new Set(mix.items.map((x) => x.appId));
    if (apps.size < 2) bad.push('单 app 独吞了全部摘要（' + mix.items.length + ' 条里只有 ' + apps.size + ' 个 app）');
    const wechatCount = mix.items.filter((x) => x.appId === 'wechat').length;
    if (wechatCount > WEEKLY_RECAP_LIMITS.perAppCap) bad.push('单 app 超出每 app 上限：' + wechatCount);

    /* 14. 未登记 kind 不编名字 */
    const odd = weeklyRecap({ startMs: S, endMs: E, events: [ev({ kind: 'quantum_teleport', title: '发生了什么', recordId: 'q-1' })] });
    if (odd.items.length !== 1) bad.push('未登记 kind 仍应进摘要');
    else {
        if (odd.items[0].registered !== false) bad.push('未登记 kind 应标 registered:false');
        if (odd.items[0].kindLabel !== 'quantum_teleport') bad.push('未登记 kind 应如实给原名，实得 ' + odd.items[0].kindLabel);
    }

    /* 15. 未登记 app 不编名字 */
    const noName = weeklyRecap({ startMs: S, endMs: E, events: [ev({ appId: 'mystery', appName: undefined, recordId: 'x-1' })] });
    if (noName.items.length === 1 && noName.items[0].appNamed !== false) bad.push('没给 appName 不许编名字');

    /* 16. weekWindowOf 算术：7 天窗，两端都含 */
    const win = weekWindowOf(S + 10 * DAY_MS);
    if (win.ok !== true) bad.push('weekWindowOf 读得到时刻时 ok 应为 true');
    else {
        if (win.endMs !== S + 10 * DAY_MS) bad.push('周窗末端应等于当前时刻');
        if (win.endMs - win.startMs !== WEEKLY_RECAP_LIMITS.days * DAY_MS) bad.push('周窗长度应为 7 天');
    }
    const winBad = weekWindowOf(undefined);
    if (winBad.ok !== false) bad.push('读不到时刻时 weekWindowOf 必须 ok:false（不回落墙钟）');

    /* 17. 纯读扫描：本桥一个字节都不写 */
    const own = [weeklyRecap, weeklyRecapNote, weekWindowOf, pickRecapItems].map((f) => String(f)).join('\n');
    if (/storage\.set|localStorage|sessionStorage|writeFile|restoreSnapshot/.test(own)) {
        bad.push('本桥出现了写路径，违反「只读不改」');
    }

    return {
        ok: bad.length === 0,
        bad,
        faces: Object.keys(WEEKLY_RECAP_FACES).map((k) => WEEKLY_RECAP_FACES[k]),
        sample: got.line,
        emptySample: empty.line,
        unlinkedSample: unlinked.line
    };
}
