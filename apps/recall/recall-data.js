/* ========================================================
 * recall-data.js — [v3.38.0] 记忆宫殿 · 召回治理内核
 *
 * 缝合自 SullyOS 的 memory-palace（assets/memory-palace-CwLWWYyz.js
 * 981566 字节 / 1653 行 minified React chunk）。
 *
 * ── 源是什么 ────────────────────────────────────────────
 *   源是一整套多路召回 + 向量化 + 重排 + 注入的管线：
 *   ① 四路来源：BM25 稀疏（bm25_mode 三档 naive/indexed/dual）、
 *      本地向量（embedding API 现算）、远程向量库（os_remote_vector_config）、
 *      重排（Rerank 独立检索）；
 *   ② 房间三轴权重：rx = {living_room:{similarity:.5,recency:.3,importance:.2}, …}
 *      —— 按房间给相似度 / 新近度 / 重要度三种分数配比；
 *   ③ 高水位线：mp_lastMsgId_${charId} —— 每条记忆处理到哪条消息为止；
 *   ④ 降级链：embedding 批量被 400 拒 → 自动降级为逐条向量化；
 *      向量不完整 → 不写入记忆（原文保留）；
 *      模型变更 → 重建已有向量；
 *   ⑤ 失败口径：一键存入存在失败批次：不写向量、不推进水位线，保留原文供下次重试；
 *   ⑥ 召回 Trace：记忆召回管线 Trace：入口、版本、开关快照、耗时与结果；
 *   ⑦ 注入：记忆系统召回后注入本次请求的内容。
 *
 * ── 本件取哪几块（本件是治理层，不是检索层）──────
 *   取 ①③④⑤⑥⑦ 的治理面：路状态 / 水位线 / 降级与失败 / 回执 / 注入裁决。
 *   ② 的三轴权重取成确定性配比表（房间 → 三轴权重，逐项与源一致）。
 *
 * ── 四处不缝（源里有、本仓明令禁止或有第二个权威的，逐条写后果）──
 *   ① 不自己调 embedding：源有 47 处 apiKey / 56 处 fetch，自己拼请求算向量。
 *      本件零网络调用 —— 只治理已到手的候选（候选由本仓 apps/memory
 *      的 BM25 与 LonSha 桥供给）。缝进来就是把第二个模型出口塞进本仓，
 *      与 apps/settings 的模型面争权威。
 *   ② 不碰宿主对象：源把召回结果注入宿主请求。本件只产回执与裁决，
 *      注入动作由宿主自己决定（本件零宿主写入零宿主读）。
 *   ③ 不读别的 App 的表：源直读 spark_char_handles / 角色卡字段。
 *      本件自带路表与策略表，零跨 App 读。
 *   ④ 不收外链、不落数据库：源走 IndexedDB（DB v48 迁过版）+ 远程向量库
 *      上传。本件零数据库、零上传，落 PhoneStorage 的三条会话键。
 *
 * ── 三条偏离（偏离不是遗漏，逐条写明）──
 *   ① 路状态六态互不同形：源把没配 / 被关掉 / 索引陈旧 / 降级中 / 上次失败
 *      在读数面上塌成同一个不可用（用户只能看到没召回）。
 *      本件把每路收成 channelState() 六态，六态互不同形。
 *   ② 融合必须报贡献：源融合后只给一个结果列表，没有任何一处能回答
 *      这条路贡献了几条。本件融合走确定性 RRF，每路如实报自己
 *      入选几条 / 被融合吃掉几条 / 一条都没进（空路不许静默消失）。
 *   ③ 空召回不许注入：源无条件注入。本件 decideInject() 对空召回
 *      返回 skip（往上下文塞空壳 = 白烧 token 且污染注意力），
 *      且真的没有与四路全坏不许同形。
 *
 * ── 本套件守的静默失效形态（都不报错、不崩溃，只是结果不对）──
 *   · 没配 / 被关掉 / 索引陈旧 / 降级中 / 上次失败 不许同形；
 *   · 失败批次不许推进水位线（推进了 = 那批记忆永久丢失且无人知道）；
 *   · 空候选池的路不许静默消失（要如实标 skipped 并计数）；
 *   · 重排一条都没新增时不许假装重排过；
 *   · 空召回不许报成注入成功。
 *
 * ── 实现纪律（本仓 v3.31/v3.35/v3.36 各踩过一次）──
 *   代码里不许出现会骗过状态机的裸引号：本仓判据共用的剥注释器是
 *   字符状态机、不解析正则字面量，正则里的裸引号会让它永久卡住
 *   （卡住之后文件尾注释全被当成代码 ⇒ 通道面判据假红）。
 *   故本件正则一律 new RegExp 构造、引号用 String.fromCharCode 拼装。
 * ======================================================== */
import { numOrNull } from '../../config/num-gate.js';

/* ---------- 真源表 ①：四路来源（视图键面与校验白名单共用这一张） ---------- */
export const RECALL_CHANNELS = Object.freeze([
    'sparse', 'semantic', 'remote', 'rerank'
]);
export const RECALL_CHANNEL_META = Object.freeze({
    sparse: { label: '稀疏检索', why: '中文 bigram 倒排，不依赖模型' },
    semantic: { label: '语义检索', why: '向量近邻，依赖向量是否已算好' },
    remote: { label: '远程向量库', why: '把向量同步到远端再查' },
    rerank: { label: '重排', why: '对已有候选二次排序，可能一条都不新增' }
});

/* ---------- 真源表 ②：路状态六态（severity 由数据层给，视图只上色） ---------- */
export const RECALL_STATES = Object.freeze({
    ready: { severity: 'ok', label: '可用', why: '这一路此刻能出结果' },
    absent: { severity: 'mute', label: '没配', why: '从没配置过这一路（不是坏了）' },
    off: { severity: 'mute', label: '已关', why: '配置过但被关掉了（不是没配）' },
    stale: { severity: 'warn', label: '索引陈旧', why: '向量模型换了，已有索引与当前模型对不上' },
    degraded: { severity: 'warn', label: '降级中', why: '批量被拒后退化成逐条，结果仍出但慢' },
    failed: { severity: 'warn', label: '上次失败', why: '上一轮这一路抛了错，本轮结果不可信' }
});
export const RECALL_STATE_KEYS = Object.freeze(Object.keys(RECALL_STATES));

/* ---------- 真源表 ③：BM25 三档（源 ox() 读 bm25_mode，认不出就落 naive） ---------- */
export const RECALL_BM25_MODES = Object.freeze(['naive', 'indexed', 'dual']);
export const RECALL_BM25_FALLBACK = 'naive';

/* ---------- 真源表 ④：房间三轴权重（逐项与源 rx 一致） ---------- */
export const RECALL_ROOM_WEIGHTS = Object.freeze({
    living_room: { similarity: 0.5, recency: 0.3, importance: 0.2 },
    bedroom: { similarity: 0.6, recency: 0.2, importance: 0.2 },
    study: { similarity: 0.4, recency: 0.2, importance: 0.4 },
    balcony: { similarity: 0.3, recency: 0.5, importance: 0.2 },
    kitchen: { similarity: 0.5, recency: 0.4, importance: 0.1 }
});
export const RECALL_ROOM_FALLBACK = 'living_room';

/* ---------- 真源表 ⑤：不注入的原因（视图键面与校验白名单共用） ---------- */
export const RECALL_SKIP_REASONS = Object.freeze({
    empty: { label: '一条都没召回到', why: '真的没有可召回的内容' },
    all_broken: { label: '四路全坏', why: '不是没有，是这一轮没一路能用' },
    below_floor: { label: '低于门槛', why: '召回到了但都没过最低分' },
    user_off: { label: '用户关掉了注入', why: '策略里明确关了' }
});
export const RECALL_SKIP_KEYS = Object.freeze(Object.keys(RECALL_SKIP_REASONS));

/* ---------- 真源表 ⑥：融合与裁决的上限（只有一处，不许在别处再写一遍） ---------- */
export const RECALL_MAX_CHANNELS = 4;
export const RECALL_MAX_CANDIDATES = 60;
export const RECALL_RRF_K = 60;
export const RECALL_DEFAULT_TOP_N = 15;
export const RECALL_MIN_SCORE = 0.02;

/* ---------- 真源表 ⑦：回执三态（视图键面与校验白名单共用） ---------- */
export const RECALL_FACES = Object.freeze({
    ok: 'ok',
    empty: 'empty',
    storage_absent: 'storage_absent'
});

function toStr(v) {
    return (typeof v === 'string') ? v : '';
}

/** 读一个有限数：非数 / NaN / 空串一律 null（不许塌成 0）。 */
function num(v) {
    return numOrNull(v);
}

/* ══════════════════ 路状态：六态互不同形 ══════════════════ */
/**
 * channelState(raw) —— 把一路的原始配置收成六态之一。
 * raw: { configured, enabled, modelChanged, degraded, lastError }
 * 判序（先判没配，再判被关，再判陈旧 / 降级 / 失败）——
 * 序本身是口径：把没配与被关塌成一态，就再也分不出该去配还是该去开。
 */
export function channelState(raw) {
    const r = raw || {};
    if (!r.configured) return 'absent';
    if (!r.enabled) return 'off';
    if (r.modelChanged) return 'stale';
    if (r.degraded) return 'degraded';
    if (r.lastError) return 'failed';
    return 'ready';
}

/** 路状态人话（键面取真源表，不另写一份）。 */
export function stateLabel(state) {
    const hit = RECALL_STATES[state];
    return hit ? hit.label : RECALL_STATES.absent.label;
}

/** 路状态严重度（视图只把 severity 映射成色相，不自己判态）。 */
export function stateSeverity(state) {
    const hit = RECALL_STATES[state];
    return hit ? hit.severity : 'mute';
}

/** BM25 档位：源认不出就落 naive，认不出这件事要能被看见。 */
export function bm25Mode(raw) {
    const v = toStr(raw);
    if (RECALL_BM25_MODES.indexOf(v) >= 0) return { mode: v, recognized: true };
    return { mode: RECALL_BM25_FALLBACK, recognized: false, sawRaw: v };
}

/* ══════════════════ 房间三轴权重 ══════════════════ */
/**
 * roomWeights(room) —— 取三轴配比。未知房间如实报 unknown，
 * 不许静默当 living_room（否则用户永远不知道自己填错了房间名）。
 */
export function roomWeights(room) {
    const key = toStr(room);
    const hit = RECALL_ROOM_WEIGHTS[key];
    if (hit) return { room: key, weights: hit, known: true };
    return {
        room: RECALL_ROOM_FALLBACK,
        weights: RECALL_ROOM_WEIGHTS[RECALL_ROOM_FALLBACK],
        known: false,
        sawRoom: key
    };
}

/**
 * scoreCandidate(cand, opts) —— 三轴加权打分（确定性：同一输入必得同一分）。
 * cand: { similarity, recency, importance }（三轴各 0~1，缺项按 0 计并计数）
 */
export function scoreCandidate(cand, opts) {
    const o = opts || {};
    const rw = roomWeights(o.room);
    const c = cand || {};
    const axes = ['similarity', 'recency', 'importance'];
    let sum = 0;
    let missing = 0;
    for (let i = 0; i < axes.length; i += 1) {
        const a = axes[i];
        const v = num(c[a]);
        if (v === null) missing += 1;
        else sum += Math.max(0, Math.min(1, v)) * rw.weights[a];
    }
    return {
        score: Math.round(sum * 1e6) / 1e6,
        room: rw.room,
        roomKnown: rw.known,
        missingAxes: missing
    };
}

/* ══════════════════ 高水位线：失败批次不许推进 ══════════════════ */
/**
 * advanceWatermark(prev, batch) —— 水位线推进裁决。
 * batch: { from, to, ok, failedCount }
 * 源的口径：存在失败批次：不写向量、不推进水位线，保留原文供下次重试。
 * 本件把它提成纯函数并如实报为什么没推进（源只有一行 console）。
 */
export function advanceWatermark(prev, batch) {
    const p = num(prev);
    const b = batch || {};
    const from = num(b.from);
    const to = num(b.to);
    const failed = num(b.failedCount);
    if (to === null || from === null) {
        return { advanced: false, value: (p === null ? null : p), reason: 'no_range' };
    }
    if (to < from) {
        return { advanced: false, value: (p === null ? null : p), reason: 'backwards' };
    }
    if (b.ok === false || (failed !== null && failed > 0)) {
        return {
            advanced: false,
            value: (p === null ? null : p),
            reason: 'failed_batch',
            failedCount: failed || 0
        };
    }
    if (p !== null && to <= p) {
        return { advanced: false, value: p, reason: 'already_ahead' };
    }
    return { advanced: true, value: to, reason: 'ok' };
}

/* ══════════════════ 融合：每路必须报贡献 ══════════════════ */
/**
 * fuseChannels(lists, opts) —— 确定性 RRF 融合。
 * lists: { sparse:[id,…], semantic:[…], remote:[…], rerank:[…] }
 * 关键：每路都要报 { in, merged, skipped } ——
 * 空候选池与这一路不存在不许同形（源两者都不报）。
 */
export function fuseChannels(lists, opts) {
    const o = opts || {};
    const k = (num(o.k) === null) ? RECALL_RRF_K : num(o.k);
    const topN = (num(o.topN) === null) ? RECALL_DEFAULT_TOP_N : num(o.topN);
    const src = lists || {};
    const scores = {};
    const order = [];
    const per = {};
    for (let ci = 0; ci < RECALL_CHANNELS.length; ci += 1) {
        const ch = RECALL_CHANNELS[ci];
        const raw = src[ch];
        const present = Array.isArray(raw);
        const arr = present ? raw : [];
        const seen = {};
        let merged = 0;
        let dupInChannel = 0;
        for (let i = 0; i < arr.length; i += 1) {
            const id = toStr(arr[i]);
            if (!id) continue;
            if (seen[id]) { dupInChannel += 1; continue; }
            seen[id] = true;
            if (scores[id] === undefined) { scores[id] = 0; order.push(id); }
            scores[id] += 1 / (k + i + 1);
            merged += 1;
        }
        per[ch] = {
            present: present,
            skipped: !present || arr.length === 0,
            in: arr.length,
            merged: merged,
            dupInChannel: dupInChannel
        };
    }
    const ranked = order.slice().sort(function (a, b) {
        if (scores[b] !== scores[a]) return scores[b] - scores[a];
        return order.indexOf(a) - order.indexOf(b);
    });
    const cut = ranked.slice(0, Math.max(0, topN));
    const dropped = ranked.length - cut.length;
    const out = [];
    for (let i = 0; i < cut.length; i += 1) {
        out.push({ id: cut[i], score: Math.round(scores[cut[i]] * 1e6) / 1e6, rank: i + 1 });
    }
    let contributed = 0;
    for (let ci = 0; ci < RECALL_CHANNELS.length; ci += 1) {
        if (per[RECALL_CHANNELS[ci]].merged > 0) contributed += 1;
    }
    return {
        hits: out,
        per: per,
        total: ranked.length,
        dropped: dropped,
        contributedChannels: contributed,
        skippedChannels: RECALL_CHANNELS.length - contributed
    };
}

/* ══════════════════ 重排：一条都没新增要如实报 ══════════════════ */
/**
 * rerankCandidates(base, extra, opts) —— 源的 rerank 是独立检索，
 * 候选池为空时跳过（源有 独立检索候选池为空，跳过 rerank 这句）。
 * 本件如实报三种：没跑 / 跑了但一条都没新增 / 新增了。
 */
export function rerankCandidates(base, extra, opts) {
    const o = opts || {};
    const topN = (num(o.topN) === null) ? RECALL_DEFAULT_TOP_N : num(o.topN);
    const b = Array.isArray(base) ? base : [];
    const e = Array.isArray(extra) ? extra : [];
    if (e.length === 0) {
        return { ran: false, reason: 'empty_pool', added: 0, order: b.slice(0, topN), addedIds: [] };
    }
    const have = {};
    for (let i = 0; i < b.length; i += 1) have[toStr(b[i])] = true;
    const addedIds = [];
    for (let i = 0; i < e.length; i += 1) {
        const id = toStr(e[i]);
        if (!id) continue;
        if (!have[id] && addedIds.indexOf(id) < 0) addedIds.push(id);
    }
    return {
        ran: true,
        reason: addedIds.length ? 'added' : 'no_new',
        added: addedIds.length,
        order: b.concat(addedIds).slice(0, topN),
        addedIds: addedIds
    };
}

/* ══════════════════ 注入裁决：空召回不许注入 ══════════════════ */
/**
 * decideInject(fused, opts) —— 决定这次召回要不要注入上下文。
 * ★ 最要紧的一条：真的没有与四路全坏不许同形（源两者都注空）。
 */
export function decideInject(fused, opts) {
    const o = opts || {};
    const f = fused || {};
    if (o.userOff === true) return { inject: false, reason: 'user_off', count: 0 };
    const hits = Array.isArray(f.hits) ? f.hits : [];
    const floor = (num(o.floor) === null) ? RECALL_MIN_SCORE : num(o.floor);
    const above = hits.filter(function (h) { return (num(h && h.score) || 0) >= floor; });
    if (hits.length === 0) {
        const contributed = num(f.contributedChannels);
        if (contributed !== null && contributed === 0) {
            return { inject: false, reason: 'all_broken', count: 0 };
        }
        return { inject: false, reason: 'empty', count: 0 };
    }
    if (above.length === 0) return { inject: false, reason: 'below_floor', count: 0 };
    return {
        inject: true,
        reason: 'ok',
        count: above.length,
        ids: above.map(function (h) { return h.id; })
    };
}

/** 跳过注入的人话（键面取真源表）。 */
export function skipReasonLabel(reason) {
    const hit = RECALL_SKIP_REASONS[reason];
    return hit ? hit.label : RECALL_SKIP_REASONS.empty.label;
}

/* ══════════════════ 召回回执 ══════════════════ */
/**
 * recallReceipt(input) —— 每次召回留一张回执。
 * 源有 Trace（入口、版本、开关快照、耗时与结果）但散在 console 里，
 * 没有任何一处能回答「上一轮到底哪几路出了力、有没有降级」。
 */
export function recallReceipt(input) {
    const i = input || {};
    const fused = i.fused || {};
    const verdict = i.verdict || decideInject(fused, i.opts || {});
    const states = i.states || {};
    const degraded = [];
    const failed = [];
    for (let ci = 0; ci < RECALL_CHANNELS.length; ci += 1) {
        const ch = RECALL_CHANNELS[ci];
        const st = channelState(states[ch]);
        if (st === 'degraded') degraded.push(ch);
        if (st === 'failed') failed.push(ch);
    }
    const ms = num(i.ms);
    return {
        at: toStr(i.at),
        entry: toStr(i.entry),
        hits: Array.isArray(fused.hits) ? fused.hits.length : 0,
        contributed: num(fused.contributedChannels),
        skipped: num(fused.skippedChannels),
        inject: verdict.inject === true,
        reason: toStr(verdict.reason),
        degraded: degraded,
        failed: failed,
        ms: (ms === null ? null : ms),
        timedOut: (i.timedOut === true)
    };
}

/** 回执面：把回执收成三态（视图据此分三种画法，不许塌成一种）。 */
export function receiptFace(receipt) {
    if (!receipt) return RECALL_FACES.storage_absent;
    if ((num(receipt.hits) || 0) === 0) return RECALL_FACES.empty;
    return RECALL_FACES.ok;
}

/* ══════════════════ 读数面（视图不自己拼统计） ══════════════════ */
/**
 * recallReadings(states, receipts) —— 四路状态分开计数 + 回执与路数分开报。
 * 源没有任何一处能回答「现在四路里有几路是好的」。
 */
export function recallReadings(states, receipts) {
    const src = states || {};
    const counts = {};
    for (let i = 0; i < RECALL_STATE_KEYS.length; i += 1) counts[RECALL_STATE_KEYS[i]] = 0;
    for (let ci = 0; ci < RECALL_CHANNELS.length; ci += 1) {
        const st = channelState(src[RECALL_CHANNELS[ci]]);
        counts[st] += 1;
    }
    const rs = Array.isArray(receipts) ? receipts : [];
    let injected = 0;
    let skipped = 0;
    for (let i = 0; i < rs.length; i += 1) {
        if (rs[i] && rs[i].inject === true) injected += 1;
        else skipped += 1;
    }
    let usable = 0;
    for (let ci = 0; ci < RECALL_CHANNELS.length; ci += 1) {
        if (channelState(src[RECALL_CHANNELS[ci]]) === 'ready') usable += 1;
    }
    return {
        counts: counts,
        usableChannels: usable,
        totalChannels: RECALL_CHANNELS.length,
        receipts: rs.length,
        injected: injected,
        skipped: skipped
    };
}

export default {
    RECALL_CHANNELS, RECALL_CHANNEL_META, RECALL_STATES, RECALL_STATE_KEYS,
    RECALL_BM25_MODES, RECALL_BM25_FALLBACK, RECALL_ROOM_WEIGHTS, RECALL_ROOM_FALLBACK,
    RECALL_SKIP_REASONS, RECALL_SKIP_KEYS, RECALL_FACES,
    RECALL_MAX_CHANNELS, RECALL_MAX_CANDIDATES, RECALL_RRF_K,
    RECALL_DEFAULT_TOP_N, RECALL_MIN_SCORE,
    channelState, stateLabel, stateSeverity, bm25Mode, roomWeights, scoreCandidate,
    advanceWatermark, fuseChannels, rerankCandidates, decideInject, skipReasonLabel,
    recallReceipt, receiptFace, recallReadings
};
