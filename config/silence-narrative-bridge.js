/* ========================================================
 * config/silence-narrative-bridge.js
 * RubyPhone v4.155.0 · R21-X3 静音与勿扰的剧情内解释（唯一桥）
 *
 * 【为什么要有这座桥】
 *   计划 R21-X3 的验收语：「深夜勿扰收到 3 条消息，次日角色说『昨晚睡了没看到』；
 *   对照：白天静音则不说『睡了』（理由必须与情境匹配，不许一句通用话术打天下）。」
 *
 *   修前的真实处境：`config/system-controls.js` 有 `isDndOn(storage)`（勿扰位真的在盘上），
 *   通知咽喉 `index.js` 第 3070 行真的会因为它**拦下横幅**（只入账不打断）。
 *   于是「静音期间来了 3 条消息」这件事在机器面上是**既成事实**，而在角色嘴里
 *   **一个字都没有** —— 用户看到的是角色凭空忽略了三句话。
 *   而最便宜的补法恰恰是最坏的：写一句万能话术「刚才没看手机」。
 *   它把深夜、上午开会、路边走路三种完全不同的处境压成同一句，
 *   等于让角色每次都用同一个借口 —— 这正是验收语「不许一句通用话术打天下」要拦的形态。
 *
 * 【本桥只做三件事，全是纯函数】
 *   ① 分桶：把剧情时刻（由调用方给，本桥**不读时钟**）切成六个时段桶；
 *   ② 供给选：按桶给出**与时段匹配**的候选句（深夜只说睡、上午只说开会/忙，
 *      跨桶串供由判据钉死）；
 *   ③ 关门：频率门挡掉「刚说过又再说」——理由重复比不解释更伤。
 *
 * 【只产候选，不写记忆（计划原文纪律）】
 *   「由角色当时情境挑一个，**只产出候选，不写记忆**（写入归记忆 owner）」。
 *   故本桥零写路径、零存储键、零 import 存储层：候选句是**素材**，
 *   挑哪一句、要不要说、怎么说，都是角色（模型）的事。
 *   本桥绝不替角色选定一句然后塞进上下文 —— 那等于替他说话。
 *
 * 【勿扰 ≠ 缺席（这条区分是本桥的地基）】
 *   勿扰是「不想被打断」，不是「人不在」。故全部候选句只解释
 *   **为什么没看到 / 为什么没被打扰**，不编造「我出门了」「我不在」——
 *   后一种是造事实，而桥无权造事实。
 *
 * 【三态分形（本仓最贵的老账：缺席与空必须不同形）】
 *   · 勿扰没开                        ⇒ `not-silent`（无事可解释，不是「解释不出来」）
 *   · 开了，但静音期间一条消息都没来    ⇒ `no-arrivals`（**真读数**：确实不需要解释）
 *   · 来了消息，但剧情钟读不到          ⇒ `unavailable`（判不出时段 ⇒ **不猜**，宁可不说）
 *   · 来了消息，时段判得出来，但频率门关着 ⇒ `suppressed`（刚说过，理由重复比不说更伤）
 *   · 来了消息、时段判得出、门也开着    ⇒ `candidates`（给素材）
 *   压平任何两态都会造出处置相反的两种处境长得一模一样的读数。
 * ============================================================ */
'use strict';

import { numOrNull } from './num-gate.js';

/** 六个时段桶（闭集）。键即语义，不许出现第七个。 */
export const SILENCE_BUCKETS = Object.freeze({
    DEEP_NIGHT: 'deep-night',
    EARLY_MORNING: 'early-morning',
    WORK_HOURS: 'work-hours',
    NOON: 'noon',
    AFTERNOON: 'afternoon',
    EVENING: 'evening'
});

/** 五态面（闭集）。 */
export const SILENCE_FACES = Object.freeze({
    NOT_SILENT: 'not-silent',
    NO_ARRIVALS: 'no-arrivals',
    UNAVAILABLE: 'unavailable',
    SUPPRESSED: 'suppressed',
    CANDIDATES: 'candidates'
});

/** 成因码（**逐一给人话**：这些码会直接摆到诊断面上，处置各不相同）。 */
export const SILENCE_REASONS = Object.freeze({
    ok: '就绪',
    'dnd-off': '勿扰没开（无事可解释）',
    'no-arrivals-input': '没给静音期间的到货数（**读不到**，不是「零条」）',
    'zero-arrivals': '静音期间确实零条（真读数：不需要解释）',
    'no-story-clock': '剧情钟读不到 —— 判不出时段，故不猜',
    'bad-story-time': '剧情钟在场但时刻文本解析不出（如只有「上午」）',
    'no-bucket': '时段判不出来（时刻不在 0–23 或桶表未覆盖）',
    'gate-closed': '频率门关着：同一段静音里刚说过，重复解释比不解释更伤'
});

/** 显式阈值表（调它即调判据，须同步套件）。 */
export const SILENCE_LIMITS = Object.freeze({
    /* 同一段静音的两次解释之间至少要隔多少**剧情毫秒**（默认 6 小时）。
     * 为什么按剧情钟而不是墙钟：剧情回拨/快进时，墙钟会让「刚说过」变成「很久没说了」，
     * 于是同一夜醒来后每句话都带一次「昨晚睡了」——那正是噪音。 */
    minGapMs: 6 * 60 * 60 * 1000,
    /* 一次最多给几条候选（素材不是清单：给多了等于让角色随便挑一句套上）。 */
    maxCandidates: 2
});

/* ── 时段边界表（低开高闭的左闭右开区间；deep-night 跨零点单独处理） ── */
const BUCKET_STARTS = Object.freeze([
    [SILENCE_BUCKETS.EARLY_MORNING, 5],
    [SILENCE_BUCKETS.WORK_HOURS, 8],
    [SILENCE_BUCKETS.NOON, 12],
    [SILENCE_BUCKETS.AFTERNOON, 14],
    [SILENCE_BUCKETS.EVENING, 18],
    [SILENCE_BUCKETS.DEEP_NIGHT, 23]
]);

/**
 * 候选句表：**每个桶的句子只许活在自己的桶里**。
 *
 * 写这张表的三条纪律（每条都有判据钉住）：
 *   ① **时段匹配不可跨桶**：深夜桶不出现「开会」，工作时段桶不出现「睡了」；
 *   ② **只解释「没看到」，不编造「我不在」**：勿扰是「不想被打断」，不是「人不在」；
 *   ③ **不写通用话术**：表里刻意不保留「刚才没看手机」这类跨桶万金油 ——
 *      它一旦存在，实现侧一定退化成「永远取第一条」。
 */
const CANDIDATE_TABLE = Object.freeze({
    [SILENCE_BUCKETS.DEEP_NIGHT]: Object.freeze([
        Object.freeze({ id: 'asleep', text: '昨晚已经睡了，手机扣在床头没看' }),
        Object.freeze({ id: 'night-silent', text: '夜里把手机调了静音，怕吵到别人' })
    ]),
    [SILENCE_BUCKETS.EARLY_MORNING]: Object.freeze([
        Object.freeze({ id: 'just-woke', text: '早上刚醒，才看到你发的' }),
        Object.freeze({ id: 'washing-up', text: '一大早起来在洗漱，没顾上看手机' })
    ]),
    [SILENCE_BUCKETS.WORK_HOURS]: Object.freeze([
        Object.freeze({ id: 'in-meeting', text: '上午在开会，手机调了静音放抽屉里' }),
        Object.freeze({ id: 'busy-morning', text: '上午一直在忙，没腾出手看手机' })
    ]),
    [SILENCE_BUCKETS.NOON]: Object.freeze([
        Object.freeze({ id: 'lunch', text: '中午吃饭时手机在包里，没听见' }),
        Object.freeze({ id: 'noon-rest', text: '午间在歇一会儿，手机静音放着' })
    ]),
    [SILENCE_BUCKETS.AFTERNOON]: Object.freeze([
        Object.freeze({ id: 'in-bag', text: '下午手机扔包里了，刚翻出来才看到' }),
        Object.freeze({ id: 'busy-afternoon', text: '下午有点忙，一直没顾上看' })
    ]),
    [SILENCE_BUCKETS.EVENING]: Object.freeze([
        Object.freeze({ id: 'on-the-way', text: '傍晚在路上，没顾上看手机' }),
        Object.freeze({ id: 'evening-busy', text: '晚上在处理点事，手机静音放着' })
    ])
});

/** 时段桶 → 一句人话（诊断面与判据共用，不许各写一份）。 */
const BUCKET_TEXT = Object.freeze({
    [SILENCE_BUCKETS.DEEP_NIGHT]: '深夜（23:00–05:00）',
    [SILENCE_BUCKETS.EARLY_MORNING]: '清晨（05:00–08:00）',
    [SILENCE_BUCKETS.WORK_HOURS]: '上午工作时段（08:00–12:00）',
    [SILENCE_BUCKETS.NOON]: '午间（12:00–14:00）',
    [SILENCE_BUCKETS.AFTERNOON]: '下午（14:00–18:00）',
    [SILENCE_BUCKETS.EVENING]: '傍晚到夜里（18:00–23:00）'
});

/**
 * 小时数 → 时段桶。判不出来一律返回**空串**（不猜一个默认桶）。
 * @param {number|string} hour
 * @returns {string} 桶名或 ''
 */
export function bucketOfHour(hour) {
    const h = numOrNull(hour);
    if (h === null || !Number.isInteger(h) || h < 0 || h > 23) return '';
    /* deep-night 跨零点：23–24 与 0–5 同桶（睡著这件事不因跨零点改名）。 */
    if (h >= 23 || h < 5) return SILENCE_BUCKETS.DEEP_NIGHT;
    for (let i = BUCKET_STARTS.length - 1; i >= 0; i -= 1) {
        const [key, start] = BUCKET_STARTS[i];
        if (key === SILENCE_BUCKETS.DEEP_NIGHT) continue;
        if (h >= start) return key;
    }
    return '';
}

/**
 * 从 `storyNow()` 的返回取时段桶。
 *
 * 三条不猜：`ok !== true` ⇒ ''；`time` 不是 `HH:MM` 形态（如只有「上午」）⇒ ''；
 * 解析出的钟点越界 ⇒ ''。**先返回空串让它落 `unavailable`，绝不补一个默认时段** ——
 * 补默认时段的后果是「上午 10 点收到消息，角色说『昨晚睡了』」。
 * @param {object} story `storyNow()` 的返回
 * @returns {string} 桶名或 ''
 */
export function bucketOfStoryClock(story) {
    if (!story || typeof story !== 'object') return '';
    if (story.ok !== true) return '';
    const time = String(story.time == null ? '' : story.time).trim();
    const m = /^(\d{1,2}):(\d{2})$/.exec(time);
    if (!m) return '';
    return bucketOfHour(m[1]);
}

/** 桶 → 一句人话。未登记的桶如实说「未登记」，不编一个名字。 */
export function bucketTextOf(bucket) {
    const k = String(bucket || '');
    return BUCKET_TEXT[k] || ('未登记时段（' + (k || '空') + '）');
}

/**
 * 取该时段的候选句（**纯读，不改表**）。
 * @param {string} bucket
 * @param {{max?:number}} [options]
 * @returns {Array<{id:string, text:string, bucket:string}>}
 */
export function silenceCandidates(bucket, options = {}) {
    const key = String(bucket || '');
    const rows = CANDIDATE_TABLE[key];
    if (!rows) return [];
    const max = numOrNull(options && options.max);
    const limit = (max !== null && max > 0) ? Math.floor(max) : SILENCE_LIMITS.maxCandidates;
    return rows.slice(0, Math.min(limit, rows.length)).map(row => ({
        id: row.id,
        text: row.text,
        bucket: key
    }));
}

/**
 * 频率门：同一段静音里的两次解释之间至少隔 `minGapMs` **剧情毫秒**。
 *
 * fail-closed 口径：任一时刻读不到 ⇒ `allowed:false`（判不出来就不许说）。
 * 这不是苛刻 —— 反过来（判不出来就放行）会让每次刷新都多冒一句理由出来。
 *
 * @param {number|null} lastToldStoryMs 上次解释时的剧情时刻（从没说过给 null）
 * @param {number|null} nowStoryMs 现在的剧情时刻
 * @param {number} [minGapMs]
 * @returns {{allowed:boolean, why:string, elapsedMs:number|null}}
 */
export function silenceFrequencyGate(lastToldStoryMs, nowStoryMs, minGapMs) {
    const last = numOrNull(lastToldStoryMs);
    const now = numOrNull(nowStoryMs);
    const gapRaw = numOrNull(minGapMs);
    const gap = (gapRaw !== null && gapRaw > 0) ? gapRaw : SILENCE_LIMITS.minGapMs;
    /* 从没说过 ⇒ 门开着（这不是「读不到」，是「没有上一次」）。 */
    if (lastToldStoryMs === null || lastToldStoryMs === undefined) {
        return { allowed: true, why: 'never-told', elapsedMs: null };
    }
    if (last === null || now === null) {
        return { allowed: false, why: 'no-clock', elapsedMs: null };
    }
    const elapsed = now - last;
    /* 剧情回拨（elapsed < 0）：这**不是**「隔了很久」，而是「时间线倒回去了」。
     * 放行会让回拨后的每一句都带上理由；挡住并如实归因，由上层决定要不要清游标。 */
    if (elapsed < 0) return { allowed: false, why: 'clock-rewound', elapsedMs: elapsed };
    if (elapsed >= gap) return { allowed: true, why: 'gap-elapsed', elapsedMs: elapsed };
    return { allowed: false, why: 'too-soon', elapsedMs: elapsed };
}

/**
 * 主入口：判这一轮该不该给候选句，该给就给素材。
 *
 * @param {object} input
 *   · `dndOn`       —— 勿扰是否开着（由调用方读 `config/system-controls.js` 的 `isDndOn`）
 *   · `arrivals`    —— 静音期间到货的消息条数（**未给 ⇒ 读不到**，与 0 不同形）
 *   · `story`       —— `storyNow()` 的返回（用于取时段与频率门基准）
 *   · `lastToldAt`  —— 上次解释时的**剧情毫秒**（从没说过给 null / 省略）
 *   · `minGapMs`    —— 覆盖阈值（可选）
 *   · `maxCandidates` —— 覆盖候选条数上限（可选）
 * @returns {{ face:string, reason:string, bucket:string, bucketText:string,
 *             arrivals:number|null, candidates:Array, gate:object,
 *             storyMs:number|null, line:string, writesNothing:boolean }}
 */
export function silenceNarrative(input = {}) {
    const o = (input && typeof input === 'object') ? input : {};
    const story = (o.story && typeof o.story === 'object') ? o.story : null;
    const storyMs = (story && story.ok === true) ? numOrNull(story.ms) : null;
    const out = {
        face: SILENCE_FACES.NOT_SILENT,
        reason: 'dnd-off',
        bucket: '',
        bucketText: '',
        arrivals: null,
        candidates: [],
        gate: { allowed: false, why: 'not-evaluated', elapsedMs: null },
        storyMs,
        line: '',
        writesNothing: true
    };

    /* ① 勿扰没开 ⇒ 无事可解释。注意判的是 `=== true`：
     *    调用方传 undefined（读不到勿扰位）时**不许**当成「开着」——
     *    那会让每一条通知都带一句「刚才没看手机」。 */
    if (o.dndOn !== true) {
        out.face = SILENCE_FACES.NOT_SILENT;
        out.reason = 'dnd-off';
        out.line = silenceNote(out);
        return out;
    }

    /* ② 到货数：`undefined / null` 是**读不到**；给了数字且 <= 0 才是真读数零条。
     *    这两态处置相反（前者去修取数，后者什么都不用做），压平即错读数。 */
    if (o.arrivals === undefined || o.arrivals === null) {
        out.face = SILENCE_FACES.UNAVAILABLE;
        out.reason = 'no-arrivals-input';
        out.line = silenceNote(out);
        return out;
    }
    const arrivals = numOrNull(o.arrivals);
    if (arrivals === null) {
        out.face = SILENCE_FACES.UNAVAILABLE;
        out.reason = 'no-arrivals-input';
        out.line = silenceNote(out);
        return out;
    }
    out.arrivals = arrivals;
    if (arrivals <= 0) {
        out.face = SILENCE_FACES.NO_ARRIVALS;
        out.reason = 'zero-arrivals';
        out.line = silenceNote(out);
        return out;
    }

    /* ③ 时段：判不出来就不猜。
     *    这是本桥最重要的一条——补一个默认时段的后果是「上午 10 点收到消息，角色说昨晚睡了」。 */
    if (!story || story.ok !== true) {
        out.face = SILENCE_FACES.UNAVAILABLE;
        out.reason = 'no-story-clock';
        out.line = silenceNote(out);
        return out;
    }
    const bucket = bucketOfStoryClock(story);
    if (!bucket) {
        out.face = SILENCE_FACES.UNAVAILABLE;
        out.reason = 'bad-story-time';
        out.line = silenceNote(out);
        return out;
    }
    out.bucket = bucket;
    out.bucketText = bucketTextOf(bucket);

    /* ④ 频率门：刚说过就别再说。理由重复比不解释更伤（验收语的反面）。 */
    const gate = silenceFrequencyGate(o.lastToldAt, storyMs, o.minGapMs);
    out.gate = gate;
    if (!gate.allowed) {
        out.face = SILENCE_FACES.SUPPRESSED;
        out.reason = 'gate-closed';
        out.line = silenceNote(out);
        return out;
    }

    /* ⑤ 给素材。注意这里**不选定**哪一句：`candidates` 是让角色挑的列表，
     *    本桥绝不返回「就是这句」——替他选句等于替他说话。 */
    out.face = SILENCE_FACES.CANDIDATES;
    out.reason = 'ok';
    out.candidates = silenceCandidates(bucket, { max: o.maxCandidates });
    out.line = silenceNote(out);
    return out;
}

/**
 * 一行文案（**唯一实现**：诊断面、日志、视图都走这里，不许各拼一份）。
 * 「零条」与「读不到」必须不同形 —— 两者的处置相反。
 * @param {object} r `silenceNarrative` 的返回
 * @returns {string}
 */
export function silenceNote(r) {
    const o = (r && typeof r === 'object') ? r : {};
    switch (o.face) {
        case SILENCE_FACES.CANDIDATES:
            return '静音期间 ' + String(o.arrivals) + ' 条消息未打断 · ' + String(o.bucketText || '')
                + ' · 候选 ' + (Array.isArray(o.candidates) ? o.candidates.length : 0) + ' 句（由角色挑，本桥不选）';
        case SILENCE_FACES.SUPPRESSED:
            return '静音解释已挡下：' + String(SILENCE_REASONS['gate-closed']);
        case SILENCE_FACES.NO_ARRIVALS:
            return '静音期间零条消息未打断 —— 真读数，不需要任何解释';
        case SILENCE_FACES.UNAVAILABLE:
            return '静音解释判不出：' + String(SILENCE_REASONS[String(o.reason || '')] || o.reason || '未知原因');
        case SILENCE_FACES.NOT_SILENT:
        default:
            return '勿扰没开 —— 通知本来就会打断，无事可解释';
    }
}

/**
 * 结构自检：桶表闭集、跨桶不串供、三态分形、频率门、纯读。
 * 零依赖可独立跑（装配点与诊断面都用它确认「桥在、判据同源」）。
 * @returns {{ok:boolean, bad:string[], buckets:string[], sample:string}}
 */
export function silenceNarrativeSelfCheck() {
    const bad = [];
    const buckets = Object.values(SILENCE_BUCKETS);

    /* ① 桶表闭集：每个桶都要有候选，且候选只能活在自己桶里 */
    for (const b of buckets) {
        const rows = silenceCandidates(b, { max: 99 });
        if (rows.length === 0) bad.push('桶 ' + b + ' 无候选句');
        for (const row of rows) {
            if (row.bucket !== b) bad.push('桶 ' + b + ' 的候选挂错了桶：' + row.id);
        }
    }

    /* ② 跨桶不串供（验收语原文：「白天静音则不说『睡了』」） */
    const nightTexts = silenceCandidates(SILENCE_BUCKETS.DEEP_NIGHT, { max: 99 }).map(r => r.text).join(' ');
    const workTexts = silenceCandidates(SILENCE_BUCKETS.WORK_HOURS, { max: 99 }).map(r => r.text).join(' ');
    if (!/睡/.test(nightTexts)) bad.push('深夜桶竟然没有「睡」类候选');
    if (/睡/.test(workTexts)) bad.push('工作时段桶里出现了「睡」—— 跨桶串供（白天不许说睡了）');
    if (/开会/.test(nightTexts)) bad.push('深夜桶里出现了「开会」—— 跨桶串供');
    const noonTexts = silenceCandidates(SILENCE_BUCKETS.NOON, { max: 99 }).map(r => r.text).join(' ');
    if (/开会|睡/.test(noonTexts)) bad.push('午间桶串了开会/睡');

    const story = { ok: true, ms: 1731600000000, date: '2026-11-15', time: '03:20', weekday: '', source: 'chat', reason: 'ok', degraded: false };

    /* ③ 三态分形：勿扰没开 / 零条 / 读不到，三者不许同形 */
    const notSilent = silenceNarrative({ dndOn: false, arrivals: 3, story });
    if (notSilent.face !== SILENCE_FACES.NOT_SILENT) bad.push('勿扰没开未归 not-silent');
    const zero = silenceNarrative({ dndOn: true, arrivals: 0, story });
    if (zero.face !== SILENCE_FACES.NO_ARRIVALS) bad.push('零条未归 no-arrivals');
    const noInput = silenceNarrative({ dndOn: true, story });
    if (noInput.face !== SILENCE_FACES.UNAVAILABLE) bad.push('未给到货数未归 unavailable（被读成零条了）');
    if (noInput.arrivals !== null) bad.push('未给到货数时 arrivals 竟不是 null');
    const noClock = silenceNarrative({ dndOn: true, arrivals: 3, story: { ok: false, ms: null, time: '' } });
    if (noClock.face !== SILENCE_FACES.UNAVAILABLE) bad.push('剧情钟读不到未归 unavailable（猜时段了）');
    if (noClock.candidates.length !== 0) bad.push('剧情钟读不到竟给了候选句');

    /* ④ 深夜与上午的候选必须来自不同桶（情境匹配是硬要求） */
    const night = silenceNarrative({ dndOn: true, arrivals: 3, story });
    const morningStory = Object.assign({}, story, { time: '10:15' });
    const morning = silenceNarrative({ dndOn: true, arrivals: 3, story: morningStory });
    if (night.bucket !== SILENCE_BUCKETS.DEEP_NIGHT) bad.push('03:20 未归 deep-night');
    if (morning.bucket !== SILENCE_BUCKETS.WORK_HOURS) bad.push('10:15 未归 work-hours');
    if (night.bucket === morning.bucket) bad.push('深夜与上午判成了同一个桶');

    /* ⑤ 频率门：刚说过 ⇒ 门关；隔够 ⇒ 门开；时刻读不到 ⇒ fail-closed */
    const gateSoon = silenceFrequencyGate(story.ms - 1000, story.ms);
    if (gateSoon.allowed !== false || gateSoon.why !== 'too-soon') bad.push('刚说过竟未挡下');
    const gateLate = silenceFrequencyGate(story.ms - SILENCE_LIMITS.minGapMs, story.ms);
    if (gateLate.allowed !== true) bad.push('隔够时长竟仍挡下');
    const gateNoClock = silenceFrequencyGate(story.ms, null);
    if (gateNoClock.allowed !== false) bad.push('时刻读不到竟放行（fail-closed 破了）');
    const gateNever = silenceFrequencyGate(null, story.ms);
    if (gateNever.allowed !== true) bad.push('从未说过竟不放行');
    const rewound = silenceFrequencyGate(story.ms, story.ms - 60000);
    if (rewound.allowed !== false || rewound.why !== 'clock-rewound') bad.push('剧情回拨未挡下');

    /* ⑥ 频率门关着时主入口必须落 suppressed（不许绕过门直接给候选） */
    const suppressed = silenceNarrative({ dndOn: true, arrivals: 3, story, lastToldAt: story.ms });
    if (suppressed.face !== SILENCE_FACES.SUPPRESSED) bad.push('门关着竟仍给候选');
    if (suppressed.candidates.length !== 0) bad.push('门关着竟仍产出候选句');

    /* ⑦ 纯读：入参冻结不许被改 */
    const frozenInput = Object.freeze({ dndOn: true, arrivals: 3, story: Object.freeze(Object.assign({}, story)) });
    const before = JSON.stringify(frozenInput);
    const pure = silenceNarrative(frozenInput);
    if (JSON.stringify(frozenInput) !== before) bad.push('入参被改（不是纯读）');
    if (pure.writesNothing !== true) bad.push('返回值未声明零写');

    return {
        ok: bad.length === 0,
        bad,
        buckets: buckets.slice(),
        sample: (night.candidates[0] && night.candidates[0].text) || ''
    };
}

export default {
    SILENCE_BUCKETS,
    SILENCE_FACES,
    SILENCE_REASONS,
    SILENCE_LIMITS,
    bucketOfHour,
    bucketOfStoryClock,
    bucketTextOf,
    silenceCandidates,
    silenceFrequencyGate,
    silenceNarrative,
    silenceNote,
    silenceNarrativeSelfCheck
};