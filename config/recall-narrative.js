/* ========================================================
 * config/recall-narrative.js — [v4.111.0 · R13-X8] 复述内核
 * --------------------------------------------------------
 * 【这一件回答什么】「我们之前聊过搬家的事吗」——给出一段**带出处**的复述：
 *   哪几条消息、哪一天、当时结论是什么，每条都能点回原位置。
 *
 * 【它治的处境（修前实测）】本仓的聊天史只能靠翻。全局搜索的 `scoreHit` 是
 *   连续同序包含，「聊过搬家的事」这种说法在真聊天里基本搜不出东西；
 *   即便搜出来了，结果是一堆散条，用户拿不到「那是哪一次、当时说到哪了」。
 *   这不是检索不够，是**没有把散条收成一次对话**。
 *
 * 【本件守的唯一铁律：复述不许编】
 *   每个 episode 的 `msgs` 里每一项都必须是**从传入的聊天数组里真取到的 id**。
 *   故本件**不接受外部给的 id**，只在自己扫过的行上取；取不到 id 的行
 *   **整条丢弃**（不是给个空串充数），并记一条 `bad-id` gap。
 *   这条比「归并得好不好」重要得多 —— 归并质量计划书明写不保证，但引用必须真。
 *
 * 【为什么不用模型总结】会幻觉出不存在的消息 id。模型总结只作为可选的**上层**，
 *   不在本件内；本件是那条「宁可复述得笨，不许复述得假」的落地形式。
 *
 * 【纯读面】本件零写盘、零网络、零持久化。
 * ============================================================ */
'use strict';
import { numOrNull } from './num-gate.js';
import {
    RECALL_NARRATIVE_STATES, RECALL_NARRATIVE_GAPS, RECALL_STOPWORDS, RECALL_LIMITS, RECALL_ORDER
} from './recall-narrative-terms.js';

/** 只收非空字符串（id 一律按字符串比：本仓 id 有数字形与字符串形两种）。 */
export function idOf(v) {
    if (typeof v === 'string' && v.trim()) return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    return '';
}

/**
 * 主题词抽取：去掉停用词后，按 longest-first 切出至少 `minTopicLen` 长的片段。
 * 不做词干化、不做同义扩展 —— 那两件事都会让「命中」变成猜测。
 * @returns {string[]} 主题词（可能为空 ⇒ 调用方要报 no-topic）
 */
export function topicWordsOf(topic) {
    let rest = (typeof topic === 'string' ? topic : '').trim();
    if (!rest) return [];
    /* 停用词按**长度倒序**剥离：先剥「那时候」再剥「时候」，否则长词被切碎。
     * 表本身已排序（recall-narrative-terms.js 的 .sort），此处不重排 —— 两处排序必然分歧。 */
    for (const w of RECALL_STOPWORDS) {
        if (!w) continue;
        while (rest.indexOf(w) >= 0) rest = rest.split(w).join(' ');
    }
    const out = [];
    const seen = new Set();
    for (const seg of rest.split(/[\s，,。.!！?？、；;：:“”"'‘’（）()\[\]【】…—-]+/)) {
        const s = seg.trim();
        if (s.length < RECALL_LIMITS.minTopicLen) continue;
        if (seen.has(s)) continue;
        seen.add(s);
        out.push(s);
    }
    return out;
}

/** 时间戳解析：毫秒时间戳 / Date 可解析串 / HH:MM（按今日折算，与引擎同口径）。
 *  取不到就返回 0 —— **0 是「不知道」，不是「很久以前」**，排序时要单独处理。 */
export function tsOfMsg(m) {
    const n = numOrNull(m && (m.timestamp ?? m.ts ?? m.time));
    if (n !== null && n > 1e9) return n;
    const raw = (m && (m.send_date ?? m.date ?? m.createdAt));
    if (typeof raw === 'string' && raw.trim()) {
        const p = Date.parse(raw);
        if (Number.isFinite(p)) return p;
        const mm = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
        if (mm) {
            const d = new Date();
            d.setHours(Number(mm[1]) || 0, Number(mm[2]) || 0, 0, 0);
            return d.getTime();
        }
    }
    return 0;
}

/** 消息正文（酒馆用 mes，微信/其他用 content / text）。 */
export function bodyOfMsg(m) {
    return String((m && (m.mes ?? m.content ?? m.text ?? '')) || '');
}

/**
 * 扫一遍聊天，把沾主题的行挑出来。
 * ★ 只认**主题词整个出现**（`indexOf`），不做模糊：本件宁可漏，不许自己造出「大概有关」。
 * @returns {{hits:Array, gaps:Array, scanned:number}}
 */
export function scanRows(chat, words) {
    const gaps = [];
    if (!Array.isArray(chat)) {
        gaps.push(RECALL_NARRATIVE_GAPS.NO_CHAT);
        return { hits: [], gaps: gaps, scanned: 0 };
    }
    if (!words.length) {
        gaps.push(RECALL_NARRATIVE_GAPS.NO_TOPIC);
        return { hits: [], gaps: gaps, scanned: 0 };
    }
    const hits = [];
    for (let i = 0; i < chat.length; i += 1) {
        const m = chat[i];
        if (!m || typeof m !== 'object') continue;
        const body = bodyOfMsg(m);
        if (!body) continue;
        const matched = words.filter((w) => body.indexOf(w) >= 0);
        if (!matched.length) continue;
        const id = idOf(m.id);
        /* ★ 没有真实 id 的行**当场丢弃**并记账 —— 交出去就是「复述编了」。
         *   宁可少一段，不许点不回去。 */
        if (!id) { gaps.push(RECALL_NARRATIVE_GAPS.BAD_ID); continue; }
        hits.push({ floor: i, id: id, ts: tsOfMsg(m), body: body, matched: matched, who: String((m && (m.name || (m.is_user ? '我' : ''))) || '') });
    }
    if (!hits.length) gaps.push(RECALL_NARRATIVE_GAPS.NO_MATCH);
    return { hits: hits, gaps: gaps, scanned: chat.length };
}

/**
 * 把散条收成 episode。归并规则**只有两条**（都写在 terms 里可调）：
 *   ① 楼层间隔 < mergeGapFloors；② 相邻时间差 < mergeGapMs（任一方 ts 为 0 时只看楼层）。
 * ★ 不做语义聚类：那需要模型，而模型会编。本件只做「隔得近算一段」这一条。
 */
export function mergeHits(hits, gaps) {
    const segs = [];
    let cur = null;
    for (const h of hits) {
        if (!cur) { cur = [h]; continue; }
        const prev = cur[cur.length - 1];
        const gapFloors = h.floor - prev.floor;
        const dt = (h.ts > 0 && prev.ts > 0) ? (h.ts - prev.ts) : null;
        const sameSeg = gapFloors < RECALL_LIMITS.mergeGapFloors
            && (dt === null || dt < RECALL_LIMITS.mergeGapMs);
        if (sameSeg && cur.length < RECALL_LIMITS.maxMsgs) { cur.push(h); continue; }
        segs.push(cur);
        cur = [h];
    }
    if (cur) segs.push(cur);
    if (segs.length > hits.length && hits.length > 1) gaps.push(RECALL_NARRATIVE_GAPS.NO_MERGE);
    return segs;
}

/** 结论句：**截取**该段最后一条命中里的一句话，不生成新句子。
 *  截不到就如实交空串（空 conclusion 是允许的：不知结论 ≠ 没有这段回忆）。 */
export function conclusionOf(seg) {
    if (!Array.isArray(seg) || !seg.length) return '';
    const last = seg[seg.length - 1];
    const raw = String(last.body || '').replace(/\s+/g, ' ').trim();
    if (!raw) return '';
    if (raw.length <= RECALL_LIMITS.conclusionMaxChars) return raw;
    return raw.slice(0, RECALL_LIMITS.conclusionMaxChars) + '…';
}

/**
 * 主出口：主题 → `{ state, episodes, gaps, scanned, words }`。
 *
 * `episodes[i]` 的形状固定四格：
 *   · `at`        —— 该段首条的时间**毫秒**（0 = 时间不可知，界面要说「某天」而不是编一个日期）
 *   · `msgs`      —— **真实 id 数组**（本件保证：每一项都来自 chat 里真有 id 的行）
 *   · `conclusion`—— 截取的最后一句（可为空串）
 *   · `floors`    —— 楼层号（给跳转用；与 msgs 一一对应）
 */
export function narrate(topic, chat) {
    const words = topicWordsOf(topic);
    const scan = scanRows(chat, words);
    const gaps = scan.gaps.slice();
    if (!scan.hits.length) {
        return { state: RECALL_NARRATIVE_STATES.empty, episodes: [], gaps: gaps, scanned: scan.scanned, words: words };
    }
    const segs = mergeHits(scan.hits, gaps);
    const episodes = [];
    for (const seg of segs) {
        if (seg.length < RECALL_LIMITS.minMsgs) continue;
        episodes.push({
            at: seg[0].ts,
            msgs: seg.map((h) => h.id),
            conclusion: conclusionOf(seg),
            floors: seg.map((h) => h.floor),
            matched: [...new Set(seg.reduce((a, h) => a.concat(h.matched), []))]
        });
    }
    /* 排序确定性兜底：时间倒序 → 首条楼层升序。时间不可知（0）的**排在后面**：
     * 把「不知道什么时候」混进时间序里，等于替用户编了一个日期。
     * ★ 顺逆由 `RECALL_ORDER.byRecentFirst` 决定，不在本地写死一个方向 ——
     *   否则「口径写在数据里」只是句注释，改数据不会改行为（本仓治过同形的静默失配）。 */
    const desc = RECALL_ORDER.byRecentFirst !== false;
    episodes.sort((a, b) => {
        const ta = a.at > 0 ? a.at : -1;
        const tb = b.at > 0 ? b.at : -1;
        if (ta !== tb) return desc ? (tb - ta) : (ta - tb);
        /* 同一时刻按首条楼层升序兜底：无论正逆都升序，保证确定性。 */
        return a.floors[0] - b.floors[0];
    });
    const state = episodes.length ? RECALL_NARRATIVE_STATES.ok : RECALL_NARRATIVE_STATES.empty;
    return { state: state, episodes: episodes, gaps: gaps, scanned: scan.scanned, words: words };
}

/**
 * 引用核对（**这一项的核心判据在代码侧的落地形式**）：
 *   把 episodes 里每一条 id 拿去和真聊天比对，任何一条不存在即 `ok:false`。
 * 为什么自带而不只在判据里写：界面在**渲染前**也要过这一关 ——
 *   渲染出一条点不回去的复述，比不渲染它更糟。
 * @returns {{ok:boolean, checked:number, bad:string[]}}
 */
export function auditCitations(episodes, chat) {
    const live = new Set();
    if (Array.isArray(chat)) {
        for (const m of chat) {
            const id = idOf(m && m.id);
            if (id) live.add(id);
        }
    }
    const bad = [];
    let checked = 0;
    for (const ep of (Array.isArray(episodes) ? episodes : [])) {
        for (const id of (Array.isArray(ep && ep.msgs) ? ep.msgs : [])) {
            checked += 1;
            if (!live.has(id)) bad.push(String(id));
        }
    }
    return { ok: bad.length === 0, checked: checked, bad: bad };
}

/** 一句话摘要（界面标题行用；不生成新句子，只报条数）。 */
export function narrativeLine(res) {
    const r = res || {};
    const n = Array.isArray(r.episodes) ? r.episodes.length : 0;
    const scanned = Number(r.scanned) || 0;
    if (r.state === RECALL_NARRATIVE_STATES.unreadable) return '聊天读不出来 —— 这不等于没有聊过';
    if (r.state === RECALL_NARRATIVE_STATES.empty) return '翻过 ' + scanned + ' 条，没找到提到这件事的地方';
    const msgs = (r.episodes || []).reduce((a, e) => a + ((e && e.msgs && e.msgs.length) || 0), 0);
    return '翻过 ' + scanned + ' 条，收成 ' + n + ' 段，共 ' + msgs + ' 条原话';
}
