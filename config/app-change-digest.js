/* ========================================================
 * config/app-change-digest.js
 * RubyPhone v4.156.0 · R21-X6 App 内「你不在时发生了什么」（唯一桥）
 *
 * 【为什么要有这座桥】
 *   计划 R21-X6 的验收语：「离开 2 小时回微信 → 变动条准确说出新消息数，点开可清空；
 *   对照：一直待着不动不出现变动条（防『每次都弹』变噪音）。」
 *
 *   修前的真实处境：每个 App 的账都活着（微信有消息、商城有订单），
 *   但没有任何一处把「**这段时间里**新增了什么」算出来 ——
 *   玩家离开两小时回来，界面跟两秒前回来长得一模一样。
 *   最便宜的补法是最坏的：每次都弹一句「有更新」。它把「真有事」与「没事」压成同一形，
 *   于是玩家第一天就学会无视它 —— 这正是验收语「防每次都弹变噪音」要拦的形态。
 *
 * 【本桥只做三件事，全是纯函数】
 *   ① 判读：把「离开时刻 / 回来时刻 / 这段时间的事件流水」判成三态；
 *   ② 聚合：按 kind 聚成「新增 3 条消息、1 个订单已送达」这样的条目；
 *   ③ 关门：两端锚点缺失、时间倒跳、流水读不到，一律如实归因，不猜。
 *
 * 【账不越界（计划原文纪律）】
 *   「**只读该 app 自己的账**，跨 app 归 R21-O8 的 `entity-link`，本模块不越界。」
 *   故本桥的入参就是**单个 app 的事件流水**，它不看别人的账，也不产出跨 app 的归并。
 *
 * 【零写路径】本桥不落任何存储键：清空（点开可清空）由宿主写自己的游标，
 *   桥只把「这次该显示什么」算出来。
 *
 * 【三态分形（本仓最贵的老账：缺席与空必须不同形）】
 *   · 没离开过（无离开锚点）           ⇒ `nothing` / `never-left`（不是「没事」，是「谈不上有事」）
 *   · 离开与回来同一时刻（一直在）      ⇒ `nothing` / `stayed`（**防噪音**的那一态）
 *   · 离开了，但这段时间确实零新增      ⇒ `nothing` / `quiet-gap`（**真读数**：确实没事）
 *   · 流水读不到                        ⇒ `unavailable`（明说读不到，不画成「没事」）
 *   · 剧情钟读不到 / 回拨              ⇒ `unavailable`（判不出「这段时间」就不判）
 *   · 有新增                            ⇒ `digest{items}`
 *   压平任何两态都会造出处置相反的两种处境长得一模一样的读数。
 * ============================================================ */
'use strict';

import { numOrNull } from './num-gate.js';

/** 三态面（闭集）。键即语义，不许出现第四个。 */
export const DIGEST_FACES = Object.freeze({
    NOTHING: 'nothing',
    DIGEST: 'digest',
    UNAVAILABLE: 'unavailable'
});

/** 归因码（闭集）。每一码对应一种处置。 */
export const DIGEST_REASONS = Object.freeze({
    never_left: '没记录到离开时刻 —— 谈不上「你不在时」',
    stayed: '一直待在这个 App 里 —— 没有「不在时」可言',
    quiet_gap: '离开了，但这段时间确实没有新事',
    no_ledger: '这个 App 的账读不到（不是「没事」）',
    no_clock: '剧情钟读不到 —— 判不出「这段时间」',
    clock_rewound: '剧情钟回拨了 —— 两端不可比，不硬算',
    ok: '有新增'
});

/** 硬上限。超出即截断并在 line 里明说「还有更多」，不假装全装下了。 */
export const DIGEST_LIMITS = Object.freeze({
    maxItems: 6
});

/** kind → 人话单位（闭集；未登记的 kind 如实用 raw 名，不编一个名字）。 */
export const DIGEST_KINDS = Object.freeze({
    message: { noun: '条消息', verb: '新增' },
    order_delivered: { noun: '个订单', verb: '已送达' },
    comment: { noun: '条评论', verb: '新增' },
    like: { noun: '个赞', verb: '收到' },
    friend_request: { noun: '个好友申请', verb: '收到' },
    call_missed: { noun: '个未接来电', verb: '有' },
    diary: { noun: '篇日记', verb: '新增' },
    photo: { noun: '张照片', verb: '新增' },
    task_done: { noun: '个任务', verb: '完成了' }
});

/**
 * 单个事件是否落在「不在时」这段窗口内。
 *
 * 边界取**两端都含**：离开那一刻发生的事也要算（玩家可能正好在切走时没看见）。
 * 时刻读不出来的事件**一律不算**（宁可少报，不能把无关事件算成「你不在时」）。
 * @param {number|null} atMs
 * @param {number} leftMs
 * @param {number} returnMs
 * @returns {boolean}
 */
export function inAbsenceWindow(atMs, leftMs, returnMs) {
    const at = numOrNull(atMs);
    const a = numOrNull(leftMs);
    const b = numOrNull(returnMs);
    if (at === null || a === null || b === null) return false;
    if (b < a) return false;
    return at >= a && at <= b;
}

/**
 * 把落在窗口内的事件按 kind 聚合成条目。
 * 条目按首次出现顺序排（时间序即重要度序：先发生的先报），不按数量重排 ——
 * 数量重排会让「1 个订单已送达」这种稀有事永远排在「20 条消息」后面。
 * @param {Array<object>} events
 * @param {number} leftMs
 * @param {number} returnMs
 * @param {{max?:number}} [options]
 * @returns {{items:Array, hit:number, dropped:number}}
 */
export function digestItems(events, leftMs, returnMs, options = {}) {
    const list = Array.isArray(events) ? events : [];
    const order = [];
    const bag = new Map();
    let hit = 0;
    for (const ev of list) {
        if (!ev || typeof ev !== 'object') continue;
        if (!inAbsenceWindow(ev.storyMs, leftMs, returnMs)) continue;
        const kind = String(ev.kind || 'unknown');
        const id = String(ev.id || '').trim();
        hit += 1;
        if (!bag.has(kind)) {
            bag.set(kind, { kind, count: 0, ids: [] });
            order.push(kind);
        }
        const row = bag.get(kind);
        row.count += 1;
        if (id) row.ids.push(id);
    }
    const maxRaw = numOrNull(options && options.max);
    const limit = (maxRaw !== null && maxRaw > 0) ? Math.floor(maxRaw) : DIGEST_LIMITS.maxItems;
    const all = order.map((k) => {
        const row = bag.get(k);
        const meta = DIGEST_KINDS[k] || null;
        const noun = meta ? meta.noun : ('项 ' + k);
        const verb = meta ? meta.verb : '新增';
        return {
            kind: k,
            count: row.count,
            verb,
            noun,
            registered: !!meta,
            /* 可回源：每个条目带着它包含的原始记录 id（清空 / 定位都靠它）。 */
            sourceIds: row.ids.slice(),
            text: verb + ' ' + row.count + ' ' + noun
        };
    });
    const items = all.slice(0, Math.min(limit, all.length));
    return { items, hit, dropped: Math.max(0, all.length - items.length) };
}

/**
 * 主入口：判这一次回到该 App 时该不该显示变动条，该显示就给条目。
 *
 * @param {object} input
 *   · `appId`     —— 哪个 App（只用于回源与文案，不参与判定）
 *   · `leftAt`    —— 离开时的**剧情毫秒**（没记录到给 null / 省略）
 *   · `returnAt`  —— 现在（回来）的**剧情毫秒**
 *   · `events`    —— 该 App 自己的事件流水（`undefined` ⇒ 读不到；`[]` ⇒ 真读到零条）
 *   · `maxItems`  —— 覆盖条目上限（可选）
 * @returns {{face:string, reason:string, appId:string, items:Array, hit:number,
 *             dropped:number, leftMs:number|null, returnMs:number|null,
 *             line:string, writesNothing:boolean}}
 */
export function appChangeDigest(input = {}) {
    const o = (input && typeof input === 'object') ? input : {};
    const out = {
        face: DIGEST_FACES.NOTHING,
        reason: 'never_left',
        appId: String(o.appId || ''),
        items: [],
        hit: 0,
        dropped: 0,
        leftMs: null,
        returnMs: null,
        line: '',
        writesNothing: true
    };

    /* ① 离开锚点缺失 ⇒ 谈不上「你不在时」。
     *    注意判 `undefined / null` 而不是 `!leftAt`：
     *    剧情毫秒可以是 0（纪元起点），用 `!` 判会把 0 当成没离开过。 */
    if (o.leftAt === undefined || o.leftAt === null) {
        out.face = DIGEST_FACES.NOTHING;
        out.reason = 'never_left';
        out.line = digestNote(out);
        return out;
    }
    const leftMs = numOrNull(o.leftAt);
    const returnMs = numOrNull(o.returnAt);
    out.leftMs = leftMs;
    out.returnMs = returnMs;

    /* ② 两端任一读不到 ⇒ 判不出窗口，不硬算（落 unavailable，不落 nothing）。 */
    if (leftMs === null || returnMs === null) {
        out.face = DIGEST_FACES.UNAVAILABLE;
        out.reason = 'no_clock';
        out.line = digestNote(out);
        return out;
    }

    /* ③ 回拨：return 早于 left。这**不是**「离开了很久」，而是时间线倒回去了。
     *    硬算会得到空窗口 ⇒ 假装「没事」，而真相是「不可比」。 */
    if (returnMs < leftMs) {
        out.face = DIGEST_FACES.UNAVAILABLE;
        out.reason = 'clock_rewound';
        out.line = digestNote(out);
        return out;
    }

    /* ④ 一直在（离开与回来同一时刻）⇒ **防噪音**的那一态。
     *    这一条是验收语的「对照」半边：一直待着不动不许弹条。 */
    if (returnMs === leftMs) {
        out.face = DIGEST_FACES.NOTHING;
        out.reason = 'stayed';
        out.line = digestNote(out);
        return out;
    }

    /* ⑤ 流水读不到 ⇒ 明说读不到。**不许**当成零条（那会把「账坏了」画成「没事」）。 */
    if (o.events === undefined || o.events === null) {
        out.face = DIGEST_FACES.UNAVAILABLE;
        out.reason = 'no_ledger';
        out.line = digestNote(out);
        return out;
    }
    if (!Array.isArray(o.events)) {
        out.face = DIGEST_FACES.UNAVAILABLE;
        out.reason = 'no_ledger';
        out.line = digestNote(out);
        return out;
    }

    /* ⑥ 真算。窗口内零条 ⇒ `nothing / quiet-gap`（**真读数**，与读不到不同形）。 */
    const got = digestItems(o.events, leftMs, returnMs, { max: o.maxItems });
    out.hit = got.hit;
    out.dropped = got.dropped;
    if (got.items.length === 0) {
        out.face = DIGEST_FACES.NOTHING;
        out.reason = 'quiet_gap';
        out.line = digestNote(out);
        return out;
    }
    out.face = DIGEST_FACES.DIGEST;
    out.reason = 'ok';
    out.items = got.items;
    out.line = digestNote(out);
    return out;
}

/**
 * 一行文案（**唯一实现**：变动条、诊断面、日志都走这里，不许各拼一份）。
 * 「没事」与「读不到」必须不同形 —— 两者的处置相反。
 * @param {object} r `appChangeDigest` 的返回
 * @returns {string}
 */
export function digestNote(r) {
    const o = (r && typeof r === 'object') ? r : {};
    switch (o.face) {
        case DIGEST_FACES.DIGEST: {
            const parts = (Array.isArray(o.items) ? o.items : []).map((it) => String(it.text || ''));
            const more = (o.dropped > 0) ? ('（另有 ' + o.dropped + ' 类未显示）') : '';
            return '你不在时：' + parts.join('、') + more;
        }
        case DIGEST_FACES.NOTHING:
            return '你不在时' + String(DIGEST_REASONS[String(o.reason || '')] || '没有新事');
        case DIGEST_FACES.UNAVAILABLE:
        default:
            return '变动摘要判不出：' + String(DIGEST_REASONS[String(o.reason || '')] || o.reason || '未知原因');
    }
}

/**
 * 结构自检：面表闭集、三态分形、窗口边界、防噪音、可回源、纯读。
 * 零依赖可独立跑。
 * @returns {{ok:boolean, bad:string[], faces:string[], sample:string}}
 */
export function appChangeDigestSelfCheck() {
    const bad = [];
    const faces = Object.values(DIGEST_FACES);

    /* ① 面表闭集：三态必须各不相同 */
    if (new Set(faces).size !== faces.length) bad.push('面表有重复项');
    if (faces.length !== 3) bad.push('面表不是三态（实际 ' + faces.length + '）');

    const LEFT = 1731600000000;
    const RET = LEFT + 2 * 3600 * 1000;
    const ev = (id, kind, dMs) => ({ id, kind, storyMs: LEFT + dMs });

    /* ② 一直待着不动 ⇒ 必须 nothing/stayed（验收语的防噪音半边） */
    const stayed = appChangeDigest({ appId: 'wechat', leftAt: LEFT, returnAt: LEFT, events: [ev('m1', 'message', 0)] });
    if (stayed.face !== DIGEST_FACES.NOTHING) bad.push('一直在却未归 nothing');
    if (stayed.reason !== 'stayed') bad.push('一直在却未归 stayed（实际 ' + stayed.reason + '）');
    if (stayed.items.length !== 0) bad.push('一直在却给了条目');

    /* ③ 离开但零新增 ⇒ nothing/quiet-gap（真读数，不是读不到） */
    const quiet = appChangeDigest({ appId: 'wechat', leftAt: LEFT, returnAt: RET, events: [ev('before', 'message', -5000)] });
    if (quiet.face !== DIGEST_FACES.NOTHING) bad.push('离开但零新增未归 nothing');
    if (quiet.reason !== 'quiet_gap') bad.push('离开但零新增未归 quiet_gap（实际 ' + quiet.reason + '）');

    /* ④ 流水读不到 ⇒ unavailable，**且不许与 quiet-gap 同形** */
    const noLedger = appChangeDigest({ appId: 'wechat', leftAt: LEFT, returnAt: RET });
    if (noLedger.face !== DIGEST_FACES.UNAVAILABLE) bad.push('流水读不到未归 unavailable（被读成没事了）');
    if (noLedger.reason === quiet.reason) bad.push('读不到与干净窗口同形 —— 两种处置被压平了');

    /* ⑤ 没离开过 ⇒ nothing/never-left，且与 stayed 不同因 */
    const never = appChangeDigest({ appId: 'wechat', returnAt: RET, events: [] });
    if (never.face !== DIGEST_FACES.NOTHING) bad.push('没离开过未归 nothing');
    if (never.reason !== 'never_left') bad.push('没离开过未归 never_left');
    /* 剧情毫秒可以是 0：不能被 `!leftAt` 判成没离开过 */
    const zeroLeft = appChangeDigest({ appId: 'wechat', leftAt: 0, returnAt: RET, events: [] });
    if (zeroLeft.reason === 'never_left') bad.push('leftAt=0 被当成没离开过（用了 falsy 判定）');

    /* ⑥ 回拨 ⇒ unavailable，不硬算成空窗口 */
    const rewound = appChangeDigest({ appId: 'wechat', leftAt: RET, returnAt: LEFT, events: [ev('m1', 'message', 1000)] });
    if (rewound.face !== DIGEST_FACES.UNAVAILABLE) bad.push('回拨未归 unavailable');
    if (rewound.reason !== 'clock_rewound') bad.push('回拨未归 clock_rewound');

    /* ⑦ 真有事 ⇒ digest，且按 kind 聚合、可回源 */
    const digest = appChangeDigest({
        appId: 'wechat',
        leftAt: LEFT,
        returnAt: RET,
        events: [ev('m1', 'message', 1000), ev('m2', 'message', 2000), ev('m3', 'message', 3000),
            { id: 'o1', kind: 'order_delivered', storyMs: LEFT + 4000 }]
    });
    if (digest.face !== DIGEST_FACES.DIGEST) bad.push('真有事未归 digest');
    if (digest.items.length !== 2) bad.push('未按 kind 聚合成 2 类（实际 ' + digest.items.length + '）');
    const msg = digest.items.find((x) => x.kind === 'message');
    if (!msg) bad.push('缺 message 类条目');
    else {
        if (msg.count !== 3) bad.push('message 计数不对：' + msg.count);
        if (msg.sourceIds.length !== 3) bad.push('message 条目不可回源（sourceIds 不全）');
        if (!/3/.test(msg.text)) bad.push('message 文案未含数量：' + msg.text);
    }
    if (!/你不在时/.test(digest.line)) bad.push('文案缺「你不在时」前缀：' + digest.line);

    /* ⑧ 窗口边界：离开那一刻与回来那一刻都算在内 */
    if (!inAbsenceWindow(LEFT, LEFT, RET)) bad.push('离开那一刻被排除在窗口外');
    if (!inAbsenceWindow(RET, LEFT, RET)) bad.push('回来那一刻被排除在窗口外');
    if (inAbsenceWindow(LEFT - 1, LEFT, RET)) bad.push('离开前一毫秒竟被算进窗口');
    if (inAbsenceWindow(RET + 1, LEFT, RET)) bad.push('回来后半毫秒竟被算进窗口');
    if (inAbsenceWindow(null, LEFT, RET)) bad.push('时刻读不出来的事件竟被算进窗口');

    /* ⑨ 未登记 kind 如实标 registered:false，不许冒充已登记 */
    const weird = appChangeDigest({ appId: 'x', leftAt: LEFT, returnAt: RET, events: [ev('w1', 'sky_fell', 1000)] });
    if (weird.face !== DIGEST_FACES.DIGEST) bad.push('未登记 kind 的有事窗口未归 digest');
    else if (weird.items[0].registered !== false) bad.push('未登记 kind 竟标成已登记');

    /* ⑩ 上限：超出即截断并如实记 dropped */
    const many = [];
    for (let i = 0; i < 10; i += 1) many.push(ev('e' + i, 'k' + i, 1000 + i));
    const capped = appChangeDigest({ appId: 'x', leftAt: LEFT, returnAt: RET, events: many, maxItems: 3 });
    if (capped.items.length !== 3) bad.push('上限未生效（实际 ' + capped.items.length + '）');
    if (capped.dropped !== 7) bad.push('dropped 记错：' + capped.dropped);

    /* ⑪ 纯读：本桥不许写任何存储 */
    const src = String(appChangeDigest.toString()) + String(digestItems.toString()) + String(digestNote.toString());
    if (/storage\s*\.\s*set|localStorage|sessionStorage/.test(src)) bad.push('本桥出现了写存储路径');
    if (digest.writesNothing !== true) bad.push('writesNothing 未标 true');

    return {
        ok: bad.length === 0,
        bad,
        faces,
        sample: digestNote(digest)
    };
}
