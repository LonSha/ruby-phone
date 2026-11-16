/* ========================================================
 * config/device-physical-narrative.js
 * RubyPhone v4.156.0 · R21-X7 设备物理状态到剧情的可感细节（唯一桥）
 *
 * 【为什么要有这座桥】
 *   计划 R21-X7 的验收语：「电量 5% 时角色提醒充电；**对照：电量 90% 时一句都不提**。
 *   频率受 `presence-arbitration.js` 已有的在场权重约束 —— 不许每次都提。」
 *
 *   修前的真实处境：`config/battery-thermodynamics.js` 有真读数（`face()` 给 level /
 *   temperature / throttling / powerState / criticalAlert，全是 wall 档），
 *   但这些数字**没有一个字进到角色嘴里**。手机发烫、电量告急都是玩家自己盯着状态栏才知道 ——
 *   角色对此一无所知，却能在别的场合说「你手机快没电了」。
 *   最便宜的补法是最坏的：把电量数字直接塞进上下文，让模型每轮自由发挥。
 *   后果是「90% 也说快没电」这种幻觉，以及每次刷新都提一遍变成噪音 ——
 *   验收语的对照半边与「不许每次都提」正是要拦这两个形态。
 *
 * 【本桥只做三件事，全是纯函数】
 *   ① 分档：把电量/温度读数归入闭集的**可感档**（critical / low / hot / normal / unknown）；
 *   ② 供材：按档给出与档位匹配的候选句（只给素材，不替角色选定、不塞上下文）；
 *   ③ 关门：频率门（时间间隔 + 在场权重）+ 「正常档一律不给」的硬门。
 *
 * 【只读设备，不改电量（计划原文纪律）】
 *   「本模块把『手机发烫/电量 5%』翻译成角色能感知的细节，**只读设备、不改电量**。」
 *   故本桥零写路径：不 import `BatteryThermodynamics`、不碰 `battery_thermo_state` 键、
 *   不调任何 tick / consume / drain 方法。它只接受**调用方读好的读数**（`face()` 的返回）。
 *
 * 【正常档必须一句都不给（验收语的对照半边）】
 *   90% 电量、36 度、不烫、在充电 —— 这些是「没什么可感」的常态。
 *   对这些档位返回候选句等于让角色每轮都无话找话。
 *   故 `normal` 档的 `candidates` **恒为空数组**，且自检里用负控制钉死它。
 *
 * 【频率门走已有权重，不新造口径（计划原文纪律）】
 *   「频率受 `presence-arbitration.js` 已有的在场权重约束」。
 *   故本桥**不 import** presence-arbitration（避免接线依赖与循环），
 *   而是接受调用方传入的 `weight`（0~1）与 `lastToldStoryMs`，用同一语义判定：
 *   权重低（角色不在场）⇒ 不许提；间隔不够 ⇒ 不许提。阈值经 `num-gate` 归一，不新造数值口径。
 *
 * 【四态分形（本仓最贵的老账：缺席与空必须不同形）】
 *   · 读数读不到（face.ok !== true）      ⇒ `unavailable`（明说读不到，不当成正常）
 *   · 读数读到了但落在常态档            ⇒ `normal`（**验收语对照半边**：一句都不给）
 *   · 异常档，但频率门关着                ⇒ `suppressed`（刚说过 / 不在场）
 *   · 异常档，门也开着                  ⇒ `candidates`（给素材）
 *   压平 `normal` 与 `unavailable` 会让「没什么可感」和「读不到」长得一样 ——
 *   前者应该安静，后者应该去修取数。
 * ============================================================ */
'use strict';

import { numOrNull } from './num-gate.js';

/** 可感档（闭集）。键即语义，不许出现第六个。 */
export const PHYSICAL_TIERS = Object.freeze({
    CRITICAL: 'critical',
    LOW: 'low',
    HOT: 'hot',
    HOT_CHARGING: 'hot-charging',
    NORMAL: 'normal',
    UNKNOWN: 'unknown'
});

/** 四态面（闭集）。 */
export const PHYSICAL_FACES = Object.freeze({
    UNAVAILABLE: 'unavailable',
    NORMAL: 'normal',
    SUPPRESSED: 'suppressed',
    CANDIDATES: 'candidates'
});

/** 归因码（闭集）。 */
export const PHYSICAL_REASONS = Object.freeze({
    no_reading: '设备读数读不到（不是「一切正常」）',
    no_face_ok: '电量面没给 ok:true —— 不把读坏了当成常态',
    normal_band: '电量与温度都在常态区间 —— 没什么可感的细节',
    gate_closed: '频率门关着（刚说过或角色不在场）',
    ok: '有可感细节'
});

/** 阈值与上限（闭集，全部可覆盖但不许新造口径）。 */
export const PHYSICAL_LIMITS = Object.freeze({
    /* 电量档：<=5 急、<=20 低。与 battery-thermodynamics 的 criticalAlert 口径同源。 */
    criticalLevel: 5,
    lowLevel: 20,
    /* 温度档：>=43 烫、>=39 偏热。 */
    hotTemp: 43,
    warmTemp: 39,
    /* 频率门：同一档位两次提起之间至少隔 2 小时剧情毫秒。 */
    minGapMs: 2 * 60 * 60 * 1000,
    /* 在场权重下限：低于它一律不提（角色不在场，提了等于自言自语）。 */
    minWeight: 0.35,
    maxCandidates: 3
});

/** 档 → 一句人话。未登记的档如实说「未登记」，不编一个名字。 */
export const PHYSICAL_TIER_TEXT = Object.freeze({
    [PHYSICAL_TIERS.CRITICAL]: '电量告急',
    [PHYSICAL_TIERS.LOW]: '电量偏低',
    [PHYSICAL_TIERS.HOT]: '机身发烫',
    [PHYSICAL_TIERS.HOT_CHARGING]: '边充边烫',
    [PHYSICAL_TIERS.NORMAL]: '电量与温度正常',
    [PHYSICAL_TIERS.UNKNOWN]: '未登记档'
});

/**
 * 档 → 候选句（**纯读，不改表**）。
 *
 * `normal` 与 `unknown` 恒返回空数组：这两档没有「可感」的细节可说。
 * 这是硬约束，不是默认值 —— 验收语的对照半边就靠它成立。
 */
const TIER_CANDIDATES = Object.freeze({
    [PHYSICAL_TIERS.CRITICAL]: [
        { id: 'critical-charge', text: '手机电量只剩百分之几了，插上充电器吧。' },
        { id: 'critical-die', text: '手机快关机了，你确定不先充一下？' }
    ],
    [PHYSICAL_TIERS.LOW]: [
        { id: 'low-charge', text: '电量不多了，一会儿记得充电。' },
        { id: 'low-saver', text: '要不要省点电？电量看得我有点担心。' }
    ],
    [PHYSICAL_TIERS.HOT]: [
        { id: 'hot-hold', text: '手机烫得厉害，先放下一会儿吧。' },
        { id: 'hot-case', text: '机身这么烫，是不是该让它散热了？' }
    ],
    [PHYSICAL_TIERS.HOT_CHARGING]: [
        { id: 'hotchg-charge', text: '一边充电一边烫成这样，要不拔一会儿？' }
    ]
});

/**
 * 把 `face()` 的返回归入可感档。判不出来一律返回 `unknown`（不猜正常）。
 *
 * 优先级：**电量档压过温度档**。理由：电量告急是不可逆的（会关机），
 * 发烫是可缓解的；同时告急且发烫时说「充电」比说「散热」更要紧，
 * 而边充边烫时说「拔一会儿」会与「充电」自相矛盾 —— 故低电量时只说电量。
 * @param {{ok:boolean, battery?:object}} face
 * @param {object} [limits]
 * @returns {string}
 */
export function physicalTierOf(face, limits) {
    if (!face || typeof face !== 'object') return PHYSICAL_TIERS.UNKNOWN;
    if (face.ok !== true) return PHYSICAL_TIERS.UNKNOWN;
    const bat = (face.battery && typeof face.battery === 'object') ? face.battery : null;
    if (!bat) return PHYSICAL_TIERS.UNKNOWN;
    const lim = Object.assign({}, PHYSICAL_LIMITS, (limits && typeof limits === 'object') ? limits : {});
    const level = numOrNull(bat.level);
    const temp = numOrNull(bat.temperature);
    const charging = bat.charging === true;

    /* 电量档压过温度档（见上）。level 读不到就不判电量档 —— 不猜。 */
    if (level !== null) {
        if (level <= lim.criticalLevel) return PHYSICAL_TIERS.CRITICAL;
        if (level <= lim.lowLevel) return PHYSICAL_TIERS.LOW;
    }
    if (temp !== null) {
        if (temp >= lim.hotTemp) return charging ? PHYSICAL_TIERS.HOT_CHARGING : PHYSICAL_TIERS.HOT;
        /* 偏热但没到烫：不单独成档（那会让每台正常手机都在 37 度时报「有点热」）。 */
    }
    /* 两档都读不到 ⇒ unknown；读到了但都在常态区间 ⇒ normal。
     * 这条区分是「读坏了」与「一切正常」的分界线。 */
    if (level === null && temp === null) return PHYSICAL_TIERS.UNKNOWN;
    return PHYSICAL_TIERS.NORMAL;
}

/** 档 → 一句人话。 */
export function tierTextOf(tier) {
    const k = String(tier || '');
    return PHYSICAL_TIER_TEXT[k] || ('未登记档（' + (k || '空') + '）');
}

/**
 * 取该档的候选句（纯读）。`normal` / `unknown` 恒空。
 * @param {string} tier
 * @param {{max?:number}} [options]
 * @returns {Array<{id:string, text:string, tier:string}>}
 */
export function physicalCandidates(tier, options = {}) {
    const key = String(tier || '');
    const rows = TIER_CANDIDATES[key];
    if (!rows) return [];
    const max = numOrNull(options && options.max);
    const limit = (max !== null && max > 0) ? Math.floor(max) : PHYSICAL_LIMITS.maxCandidates;
    return rows.slice(0, Math.min(limit, rows.length)).map(row => ({
        id: row.id,
        text: row.text,
        tier: key
    }));
}

/**
 * 频率门：同一档位两次提起之间至少隔 `minGapMs` **剧情毫秒**，且在场权重要够。
 *
 * fail-closed 口径：权重读不到 ⇒ 不许提（角色不在场就别自言自语）。
 * 这与 `silenceFrequencyGate` 同一条纪律：判不出来就不许说。
 * @param {{lastToldStoryMs?:number|null, nowStoryMs?:number|null, weight?:number|null, minGapMs?:number, minWeight?:number}} input
 * @returns {{allowed:boolean, why:string, elapsedMs:number|null, weight:number|null}}
 */
export function physicalFrequencyGate(input = {}) {
    const o = (input && typeof input === 'object') ? input : {};
    const gapRaw = numOrNull(o.minGapMs);
    const gap = (gapRaw !== null && gapRaw > 0) ? gapRaw : PHYSICAL_LIMITS.minGapMs;
    const wRaw = numOrNull(o.minWeight);
    const minW = (wRaw !== null && wRaw >= 0) ? wRaw : PHYSICAL_LIMITS.minWeight;
    const weight = numOrNull(o.weight);

    /* ① 在场权重：读不到 ⇒ 不许提。角色不在场时提手机烫是自言自语。 */
    if (weight === null) {
        return { allowed: false, why: 'no-weight', elapsedMs: null, weight: null };
    }
    if (weight < minW) {
        return { allowed: false, why: 'absent', elapsedMs: null, weight };
    }

    /* ② 时间间隔。从没说过 ⇒ 门开着（这不是「读不到」，是「没有上一次」）。 */
    const lastRaw = o.lastToldStoryMs;
    if (lastRaw === undefined || lastRaw === null) {
        return { allowed: true, why: 'never-told', elapsedMs: null, weight };
    }
    const last = numOrNull(lastRaw);
    const now = numOrNull(o.nowStoryMs);
    if (last === null || now === null) {
        return { allowed: false, why: 'no-clock', elapsedMs: null, weight };
    }
    const elapsed = now - last;
    /* 剧情回拨：不是「隔了很久」，是「时间线倒回去了」。放行会让回拨后每句都提。 */
    if (elapsed < 0) return { allowed: false, why: 'clock-rewound', elapsedMs: elapsed, weight };
    if (elapsed >= gap) return { allowed: true, why: 'gap-elapsed', elapsedMs: elapsed, weight };
    return { allowed: false, why: 'too-soon', elapsedMs: elapsed, weight };
}

/**
 * 主入口：判这一轮该不该给「设备可感细节」，该给就给素材。
 *
 * @param {object} input
 *   · `face`           —— `BatteryThermodynamics.face()` 的返回（**调用方读好传进来**）
 *   · `lastToldStoryMs`—— 上次提起的**剧情毫秒**（从没提过给 null / 省略）
 *   · `nowStoryMs`     —— 现在的**剧情毫秒**
 *   · `weight`         —— 在场权重 0~1（由 `presence-arbitration` 算好传进来，本桥不 import 它）
 *   · `limits`         —— 覆盖阈值（可选）
 *   · `maxCandidates`  —— 覆盖候选条数上限（可选）
 * @returns {{face:string, reason:string, tier:string, tierText:string,
 *             candidates:Array, gate:object, reading:object|null,
 *             line:string, writesNothing:boolean}}
 */
export function devicePhysicalNarrative(input = {}) {
    const o = (input && typeof input === 'object') ? input : {};
    const out = {
        face: PHYSICAL_FACES.UNAVAILABLE,
        reason: 'no_reading',
        tier: PHYSICAL_TIERS.UNKNOWN,
        tierText: '',
        candidates: [],
        gate: { allowed: false, why: 'not-evaluated', elapsedMs: null, weight: null },
        reading: null,
        line: '',
        writesNothing: true
    };

    /* ① 读数缺失 ⇒ unavailable。**不许**当成正常（那会让真坏了永远静默）。
     *    判 `undefined / null`：`face` 是对象，假的读数也是对象。 */
    if (o.face === undefined || o.face === null) {
        out.face = PHYSICAL_FACES.UNAVAILABLE;
        out.reason = 'no_reading';
        out.line = physicalNote(out);
        return out;
    }
    if (typeof o.face !== 'object') {
        out.face = PHYSICAL_FACES.UNAVAILABLE;
        out.reason = 'no_reading';
        out.line = physicalNote(out);
        return out;
    }
    /* ② `ok !== true` ⇒ 读坏了，明说读不到。不当成 normal。 */
    if (o.face.ok !== true) {
        out.face = PHYSICAL_FACES.UNAVAILABLE;
        out.reason = 'no_face_ok';
        out.line = physicalNote(out);
        return out;
    }

    /* ③ 投一份只读读数快照（诊断面与人话都用同一份，不各算一次）。 */
    const bat = (o.face.battery && typeof o.face.battery === 'object') ? o.face.battery : {};
    out.reading = {
        level: numOrNull(bat.level),
        temperature: numOrNull(bat.temperature),
        charging: bat.charging === true,
        throttling: bat.throttling === true,
        powerState: String(bat.powerState || '')
    };

    const tier = physicalTierOf(o.face, o.limits);
    out.tier = tier;
    out.tierText = tierTextOf(tier);

    /* ④ 常态档 ⇒ 一句都不给（**验收语对照半边**）。
     *    这一条在最前面判：常态不该被后面的频率门「挡」成 suppressed ——
     *    它不是「被挡掉了」，而是「本来就没什么可说」。两种理由处置不同。 */
    if (tier === PHYSICAL_TIERS.NORMAL) {
        out.face = PHYSICAL_FACES.NORMAL;
        out.reason = 'normal_band';
        out.line = physicalNote(out);
        return out;
    }
    /* 档都判不出来（两路读数全缺）⇒ unavailable，不猜。 */
    if (tier === PHYSICAL_TIERS.UNKNOWN) {
        out.face = PHYSICAL_FACES.UNAVAILABLE;
        out.reason = 'no_reading';
        out.line = physicalNote(out);
        return out;
    }

    /* ⑤ 频率门：刚提过 / 角色不在场都不许提（验收语「不许每次都提」）。 */
    const gate = physicalFrequencyGate({
        lastToldStoryMs: o.lastToldStoryMs,
        nowStoryMs: o.nowStoryMs,
        weight: o.weight,
        minGapMs: o.limits && o.limits.minGapMs,
        minWeight: o.limits && o.limits.minWeight
    });
    out.gate = gate;
    if (!gate.allowed) {
        out.face = PHYSICAL_FACES.SUPPRESSED;
        out.reason = 'gate_closed';
        out.line = physicalNote(out);
        return out;
    }

    /* ⑥ 给素材。**不选定哪一句**：候选是让角色挑的列表，本桥不替他说话。 */
    out.face = PHYSICAL_FACES.CANDIDATES;
    out.reason = 'ok';
    out.candidates = physicalCandidates(tier, { max: o.maxCandidates });
    out.line = physicalNote(out);
    return out;
}

/**
 * 一行文案（**唯一实现**：诊断面、视图、日志都走这里）。
 * 「常态」「被挡」「读不到」必须三种不同形。
 * @param {object} r `devicePhysicalNarrative` 的返回
 * @returns {string}
 */
export function physicalNote(r) {
    const o = (r && typeof r === 'object') ? r : {};
    const rd = (o.reading && typeof o.reading === 'object') ? o.reading : null;
    const readText = rd
        ? ('电量 ' + (rd.level === null ? '—' : rd.level + '%')
            + ' · ' + (rd.temperature === null ? '—' : rd.temperature + '℃')
            + (rd.charging ? ' · 充电中' : ''))
        : '';
    switch (o.face) {
        case PHYSICAL_FACES.CANDIDATES:
            return '设备可感（' + String(o.tierText || '') + '）：' + readText
                + ' · 候选 ' + (Array.isArray(o.candidates) ? o.candidates.length : 0)
                + ' 句（由角色挑，本桥不选）';
        case PHYSICAL_FACES.SUPPRESSED:
            return '设备可感已挡下：' + String(PHYSICAL_REASONS['gate_closed'])
                + '（门因 ' + String((o.gate && o.gate.why) || '未知') + '）';
        case PHYSICAL_FACES.NORMAL:
            return '设备读数在常态区间' + (readText ? '（' + readText + '）' : '') + ' —— 一句都不提';
        case PHYSICAL_FACES.UNAVAILABLE:
        default:
            return '设备可感判不出：' + String(PHYSICAL_REASONS[String(o.reason || '')] || o.reason || '未知原因');
    }
}

/**
 * 结构自检：档表闭集、四态分形、**常态零候选**、电量压过温度、频率门、纯读。
 * 零依赖可独立跑。
 * @returns {{ok:boolean, bad:string[], tiers:string[], sample:string}}
 */
export function devicePhysicalNarrativeSelfCheck() {
    const bad = [];
    const tiers = Object.values(PHYSICAL_TIERS);
    const faces = Object.values(PHYSICAL_FACES);

    if (new Set(tiers).size !== tiers.length) bad.push('档表有重复项');
    if (new Set(faces).size !== faces.length) bad.push('面表有重复项');
    if (faces.length !== 4) bad.push('面表不是四态（实际 ' + faces.length + '）');

    const NOW = 1731600000000;
    const mkFace = (level, temp, charging) => ({
        ok: true,
        why: '',
        battery: { level, temperature: temp, charging: !!charging, throttling: false, powerState: '', criticalAlert: null }
    });

    /* ① **验收语对照半边**：电量 90% 时一句都不提 */
    const healthy = devicePhysicalNarrative({ face: mkFace(90, 36.5, false), nowStoryMs: NOW, weight: 1 });
    if (healthy.face !== PHYSICAL_FACES.NORMAL) bad.push('90% 电量未归 normal（实际 ' + healthy.face + '）');
    if (healthy.candidates.length !== 0) bad.push('90% 电量竟给了候选句 —— 验收语对照半边破了');
    if (!/一句都不提/.test(healthy.line)) bad.push('常态文案未明说「一句都不提」：' + healthy.line);

    /* ② **验收语正半边**：电量 5% 时角色提醒充电 */
    const critical = devicePhysicalNarrative({ face: mkFace(5, 36.5, false), nowStoryMs: NOW, weight: 1 });
    if (critical.face !== PHYSICAL_FACES.CANDIDATES) bad.push('5% 电量未归 candidates（实际 ' + critical.face + '）');
    if (critical.tier !== PHYSICAL_TIERS.CRITICAL) bad.push('5% 未归 critical（实际 ' + critical.tier + '）');
    if (critical.candidates.length === 0) bad.push('5% 竟一句都没给');
    const criticalText = critical.candidates.map((c) => c.text).join(' ');
    if (!/充/.test(criticalText)) bad.push('电量告急的候选句竟不含「充」：' + criticalText);

    /* ③ 档表闭集：异常档都要有候选，常态/未登记必须零候选 */
    for (const t of tiers) {
        const rows = physicalCandidates(t, { max: 99 });
        if (t === PHYSICAL_TIERS.NORMAL || t === PHYSICAL_TIERS.UNKNOWN) {
            if (rows.length !== 0) bad.push('常态/未登记档竟有候选：' + t);
        } else if (rows.length === 0) {
            bad.push('异常档 ' + t + ' 无候选句');
        }
        for (const row of rows) {
            if (row.tier !== t) bad.push('档 ' + t + ' 的候选挂错了档：' + row.id);
        }
    }

    /* ④ 电量压过温度：又低又烫时只说电量（避免「充电」与「拔一会儿」自相矛盾） */
    const both = devicePhysicalNarrative({ face: mkFace(8, 45, true), nowStoryMs: NOW, weight: 1 });
    if (both.tier !== PHYSICAL_TIERS.LOW) bad.push('又低又烫时未让电量档优先（实际 ' + both.tier + '）');
    const bothText = both.candidates.map((c) => c.text).join(' ');
    if (/拔/.test(bothText)) bad.push('低电量时给了「拔一会儿」—— 与充电建议自相矛盾：' + bothText);

    /* ⑤ 发烫分两档：边充边烫的候选只对充电态给 */
    const hot = devicePhysicalNarrative({ face: mkFace(60, 45, false), nowStoryMs: NOW, weight: 1 });
    if (hot.tier !== PHYSICAL_TIERS.HOT) bad.push('不充电发烫未归 hot（实际 ' + hot.tier + '）');
    const hotChg = devicePhysicalNarrative({ face: mkFace(60, 45, true), nowStoryMs: NOW, weight: 1 });
    if (hotChg.tier !== PHYSICAL_TIERS.HOT_CHARGING) bad.push('边充边烫未归 hot-charging（实际 ' + hotChg.tier + '）');

    /* ⑥ 四态分形：normal 与 unavailable 不许同形（前者该安静，后者该去修取数） */
    const noReading = devicePhysicalNarrative({ face: null, nowStoryMs: NOW, weight: 1 });
    if (noReading.face !== PHYSICAL_FACES.UNAVAILABLE) bad.push('读数缺失未归 unavailable');
    const broken = devicePhysicalNarrative({ face: { ok: false, why: 'read_threw' }, nowStoryMs: NOW, weight: 1 });
    if (broken.face !== PHYSICAL_FACES.UNAVAILABLE) bad.push('读坏了未归 unavailable（被当成常态了）');
    if (broken.face === healthy.face) bad.push('读坏了与常态同形 —— 两种处置被压平了');

    /* ⑦ 频率门：刚说过不许再说（验收语「不许每次都提」） */
    const tooSoon = devicePhysicalNarrative({ face: mkFace(5, 36.5, false), nowStoryMs: NOW, lastToldStoryMs: NOW - 60000, weight: 1 });
    if (tooSoon.face !== PHYSICAL_FACES.SUPPRESSED) bad.push('刚说过 1 分钟竟又给候选');
    if (tooSoon.reason !== 'gate_closed') bad.push('刚说过的归因不对：' + tooSoon.reason);
    const gapOk = devicePhysicalNarrative({ face: mkFace(5, 36.5, false), nowStoryMs: NOW, lastToldStoryMs: NOW - 3 * 3600 * 1000, weight: 1 });
    if (gapOk.face !== PHYSICAL_FACES.CANDIDATES) bad.push('隔了 3 小时竟还被挡');

    /* ⑧ 在场权重：不在场（权重低/读不到）一律不许提 */
    const absent = devicePhysicalNarrative({ face: mkFace(5, 36.5, false), nowStoryMs: NOW, weight: 0 });
    if (absent.face !== PHYSICAL_FACES.SUPPRESSED) bad.push('权重 0 竟给了候选');
    if (String(absent.gate.why).indexOf('absent') < 0) bad.push('权重 0 的归因不对：' + absent.gate.why);
    const noWeight = devicePhysicalNarrative({ face: mkFace(5, 36.5, false), nowStoryMs: NOW });
    if (noWeight.face !== PHYSICAL_FACES.SUPPRESSED) bad.push('权重读不到竟给了候选（fail-closed 破了）');
    if (String(noWeight.gate.why).indexOf('no-weight') < 0) bad.push('权重读不到的归因不对：' + noWeight.gate.why);

    /* ⑨ 回拨：不把时间线倒退算成「隔了很久」 */
    const rewound = devicePhysicalNarrative({ face: mkFace(5, 36.5, false), nowStoryMs: NOW - 10000, lastToldStoryMs: NOW, weight: 1 });
    if (rewound.face !== PHYSICAL_FACES.SUPPRESSED) bad.push('回拨竟放行了');
    if (String(rewound.gate.why).indexOf('rewound') < 0) bad.push('回拨归因不对：' + rewound.gate.why);

    /* ⑩ 纯读：不许出现写电量/写存储路径（计划纪律：只读设备、不改电量） */
    const src = String(devicePhysicalNarrative.toString()) + String(physicalTierOf.toString())
        + String(physicalFrequencyGate.toString()) + String(physicalNote.toString());
    if (/storage\s*\.\s*set|localStorage|sessionStorage/.test(src)) bad.push('本桥出现了写存储路径');
    if (/\.level\s*=(?!=)|consume|drain|tick\s*\(/.test(src)) bad.push('本桥出现了改电量/推进仿真路径');
    if (critical.writesNothing !== true) bad.push('writesNothing 未标 true');

    return {
        ok: bad.length === 0,
        bad,
        tiers,
        sample: physicalNote(critical)
    };
}
