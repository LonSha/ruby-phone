/* ========================================================
 * needsim-data.js — [v3.41.0] 需求沙盘 · 纯函数内核
 *
 * 缝合自小鼠机（nuo_sources/nuo3/xiaoshuji.html，6405117 字节 /
 * 112434 行单文件自包含）的「模拟人生需求面板」一族（Sims* 44 个函数 /
 * 源内 981 处命中）。★ 队列纪律：v3.39.0 已把整份内联 JS 抽成骨架
 * （3.05MB / 2117 个函数）并按块分存，本版与同批各件共用那次侦察结论 ——
 * 不再重复解析源文件，只按块取（nuo_sources/nuo3/live/blk_sims.txt）。
 *
 * ── 源是什么 ──────────────────────────────────────────
 *   源把「角色此刻的状态」做成一块六格面板：
 *   ① 六项需求值（hunger / energy / bladder / hygiene / fun / social）；
 *   ② 六个行动按钮（snack / nap / bath / play / chat / focus），每个带固定效果；
 *   ③ 每个行动一份**台词池**（模型一次生成 3 条，点一次取一条）；
 *   ④ 一池随机小事件（10 条，点一次取一条）；
 *   ⑤ 今日小愿望（按最低的那项需求选模板）；
 *   ⑥ 记忆流（每次行动 / 事件落一条，满了 10 条）。
 *
 * ── 本件取哪几块（本件是治理层，不是生成层）────────────
 *   取 ①②③④⑤⑥ 的**治理面**：需求值钳位与可读分报 / 行动效果台账 /
 *   池子的四态与游标轮次 / 愿望的过期与今天 / 记忆流的淘汰与自动落账 /
 *   回信归一与分报 / 读数面。
 *   ★ 立场差：**源是「替模型说话的那个」，本件是「把模型给的那份数据收拾好」**。
 *
 * ── 四处不缝（源里有、本仓明令禁止或有第二个权威的，逐条写后果）──
 *   ① **不自己调模型**：源 refreshSims 从浏览器本地存储直读模型地址 /
 *      密钥 / 模型名（密钥面），自己拼一段五段式 system prompt、
 *      自己发请求、自己从回复里抠 JSON。本件**零网络零密钥**：只产
 *      **可复制的要求文本**（composeRequestText）与**回信归一**（parseReply）。
 *   ② **不落宿主会话记忆**：源把面板挂进宿主消息上下文（产一段
 *      「隐性当日心愿」直接注入会话）。本件只落自己的三条会话键。
 *   ③ **不碰宿主角色表**：源直读全局角色表、当前会话角色与按角色键取的
 *      消息数组（取末 10 条当上下文）。本件自带角色名与需求值，零宿主读。
 *   ④ **不收外链、不落数据库**：源的面板壁纸走浏览器数据库与图片地址、
 *      角色数据走宿主大对象存档。本件零数据库、零 URL。
 *
 * ── 四条偏离（偏离不是遗漏，逐条写明）──
 *   ① **记忆满了不许整本清空**：源在「已达上限」时直接把整本记忆置空，
 *      —— 第 11 条一进来，**前 10 条一次全没**，而且不报错不提示。
 *   ② **需求读不出来不许当成 5**：源对非有限值一律回落成 5 —— 一条坏掉的
 *      需求画出来就是根几乎见底的进度条（5%），于是「读不出来」与
 *      「真的快见底」在界面上完全同形。
 *   ③ **心情的平均值缺项不许落最差档**：源把六项求和除六，少了任何一项都
 *      算出非数，而非数与四档阈值比较全为假 ⇒ 直接落最后那个分支
 *      「非常不开心」。**缺项被判成心情最差**。
 *   ④ **愿望过期不许与「今天没有」同形**：源把过期愿望与没存过愿望
 *      一起归一成「没有」。
 *
 * ── 本套件守的静默失效形式（都不报错、不崩溃，只是结果不对）──
 *   · 需求坏值不许显示成「几乎见底」；
 *   · 心情缺项不许显示成「心情最差」；
 *   · 池子「没生成」与「生成了但一条都用不上」不许同形；
 *   · 游标绕回（第 N 轮重复同一句）不许无痕迹；
 *   · 愿望过期不许与「今天没有愿望」同形；
 *   · 记忆超限不许整本清空；
 *   · 回信读不出来不许只说「解析失败」（哪一步坏的要说出来）。
 *
 * ── 实现纪律（本仓 v3.31 / v3.35 / v3.36 / v3.38 / v3.39 / v3.40 各踩过）──
 *   代码里不许出现会骗过状态机的裸引号与反斜杠：本仓判据共用的剥注释器是
 *   字符状态机、不解析正则字面量。故本件**禁用正则字面量**：一律字串比对、
 *   逐字符扫描与括号配平；反斜杠一律走拼装形（String.fromCharCode）。
 * ======================================================== */
import { numOrNull } from '../../config/num-gate.js';

/* ---------- 真源表 ①：六项需求（键面与标签与初值共用这一张） ---------- */
export const SIMS_NEED_KEYS = Object.freeze(['hunger', 'energy', 'bladder', 'hygiene', 'fun', 'social']);
/* ★ 键面必须取真源数组的值（计算键），不许手写标识符形 ——
 *   本仓 J7 门禁（桥契约）判的就是这件事：手写键与真源值一旦错位，
 *   查不到就静默走兜底，多种处境显示成同一句话。 */
export const SIMS_NEED_META = Object.freeze({
    [SIMS_NEED_KEYS[0]]: { label: '饥饿', base: 75 },
    [SIMS_NEED_KEYS[1]]: { label: '睡眠', base: 60 },
    [SIMS_NEED_KEYS[2]]: { label: '如厕', base: 85 },
    [SIMS_NEED_KEYS[3]]: { label: '清洁', base: 45 },
    [SIMS_NEED_KEYS[4]]: { label: '娱乐', base: 70 },
    [SIMS_NEED_KEYS[5]]: { label: '社交', base: 30 }
});

/* ---------- 真源表 ②：六个行动与它们的固定效果 ---------- */
export const SIMS_ACTION_IDS = Object.freeze(['snack', 'nap', 'bath', 'play', 'chat', 'focus']);
export const SIMS_ACTION_META = Object.freeze({
    [SIMS_ACTION_IDS[0]]: { label: '点心时间', need: SIMS_NEED_KEYS[0], effects: { [SIMS_NEED_KEYS[0]]: 20, [SIMS_NEED_KEYS[4]]: 5, [SIMS_NEED_KEYS[1]]: -2 } },
    [SIMS_ACTION_IDS[1]]: { label: '窗边小睡', need: SIMS_NEED_KEYS[1], effects: { [SIMS_NEED_KEYS[1]]: 22, [SIMS_NEED_KEYS[0]]: -5, [SIMS_NEED_KEYS[2]]: -4 } },
    [SIMS_ACTION_IDS[2]]: { label: '雾气浴室', need: SIMS_NEED_KEYS[3], effects: { [SIMS_NEED_KEYS[3]]: 24, [SIMS_NEED_KEYS[4]]: 4, [SIMS_NEED_KEYS[1]]: -3 } },
    [SIMS_ACTION_IDS[3]]: { label: '玩乐充电', need: SIMS_NEED_KEYS[4], effects: { [SIMS_NEED_KEYS[4]]: 24, [SIMS_NEED_KEYS[5]]: 3, [SIMS_NEED_KEYS[1]]: -7 } },
    [SIMS_ACTION_IDS[4]]: { label: '轻声聊天', need: SIMS_NEED_KEYS[5], effects: { [SIMS_NEED_KEYS[5]]: 24, [SIMS_NEED_KEYS[4]]: 6, [SIMS_NEED_KEYS[1]]: -3 } },
    [SIMS_ACTION_IDS[5]]: { label: '安静整理', need: SIMS_NEED_KEYS[2], effects: { [SIMS_NEED_KEYS[2]]: 18, [SIMS_NEED_KEYS[3]]: 5, [SIMS_NEED_KEYS[1]]: -4, [SIMS_NEED_KEYS[4]]: 2 } }
});

/* 需求 → 照顾动作（源 simsCareActionByNeed，键面取真源表）。 */
export const SIMS_CARE_OF = Object.freeze({
    [SIMS_NEED_KEYS[0]]: SIMS_ACTION_IDS[0],
    [SIMS_NEED_KEYS[1]]: SIMS_ACTION_IDS[1],
    [SIMS_NEED_KEYS[2]]: SIMS_ACTION_IDS[5],
    [SIMS_NEED_KEYS[3]]: SIMS_ACTION_IDS[2],
    [SIMS_NEED_KEYS[4]]: SIMS_ACTION_IDS[3],
    [SIMS_NEED_KEYS[5]]: SIMS_ACTION_IDS[4]
});
/* 行动 → 图标（源 simsWishIconByAction 的六组，键面取真源表）。 */
export const SIMS_ICON_OF = Object.freeze({
    [SIMS_ACTION_IDS[0]]: '🍵',
    [SIMS_ACTION_IDS[1]]: '🌙',
    [SIMS_ACTION_IDS[2]]: '💧',
    [SIMS_ACTION_IDS[3]]: '🎮',
    [SIMS_ACTION_IDS[4]]: '💗',
    [SIMS_ACTION_IDS[5]]: '🪶'
});
export const SIMS_WISH_TITLE = Object.freeze({
    [SIMS_NEED_KEYS[0]]: '想和你吃点热乎的',
    [SIMS_NEED_KEYS[1]]: '想被你哄去休息',
    [SIMS_NEED_KEYS[2]]: '想在见你前整理好',
    [SIMS_NEED_KEYS[3]]: '想干净清爽地靠近你',
    [SIMS_NEED_KEYS[4]]: '想和你做点好玩的事',
    [SIMS_NEED_KEYS[5]]: '想听见你的声音'
});
export const SIMS_WISH_DESC = Object.freeze({
    [SIMS_NEED_KEYS[0]]: '安排点心，像陪你一起补充一点生活热气。',
    [SIMS_NEED_KEYS[1]]: '安排小睡，让他带着你的温柔补一小觉。',
    [SIMS_NEED_KEYS[2]]: '安排整理，把身体和房间都调回舒服状态。',
    [SIMS_NEED_KEYS[3]]: '安排清洁，让他带着干净气息出现在你面前。',
    [SIMS_NEED_KEYS[4]]: '安排玩乐，让今天多一点只属于你们的小开心。',
    [SIMS_NEED_KEYS[5]]: '安排聊天，让他想对你说的话慢慢说出来。'
});

/* ---------- 真源表 ③：需求档位（源只有一根进度条 + 一个百分比） ---------- */
export const SIMS_LEVELS = Object.freeze(['plenty', 'ok', 'low', 'alert']);
export const SIMS_LEVEL_META = Object.freeze({
    [SIMS_LEVELS[0]]: { min: 70, label: '充足' },
    [SIMS_LEVELS[1]]: { min: 50, label: '尚可' },
    [SIMS_LEVELS[2]]: { min: 30, label: '偏低' },
    [SIMS_LEVELS[3]]: { min: 0, label: '告急' }
});
/** 需求值读不出来时的人话（**单一份**：数据层拼读数、App 层拼话术、视图拼徽章共用）。 */
export const SIMS_NEED_UNREADABLE = '这一项读不出来';

/* ---------- 真源表 ④：心情四档（源按六项平均分档） ---------- */
export const SIMS_MOODS = Object.freeze(['happy', 'ok', 'low', 'bad']);
export const SIMS_MOOD_META = Object.freeze({
    [SIMS_MOODS[0]]: { min: 70, label: '心情愉悦' },
    [SIMS_MOODS[1]]: { min: 50, label: '状态一般' },
    [SIMS_MOODS[2]]: { min: 30, label: '有点不舒服' },
    [SIMS_MOODS[3]]: { min: 0, label: '非常不开心' }
});
/** 心情读不出来时的人话（源在这种情况下落的是「非常不开心」—— 最差档）。 */
export const SIMS_MOOD_UNKNOWN = '心情读不出来';

/* ---------- 真源表 ⑤：数值门槛 ---------- */
export const SIMS_VALUE_MIN = 5;
export const SIMS_VALUE_MAX = 100;
/** 源对非有限值的兜底值（源不报它，本件把它当**读数缺失**报出去）。 */
export const SIMS_VALUE_FALLBACK = 5;
export const SIMS_EFFECT_MIN = -20;
export const SIMS_EFFECT_MAX = 24;
export const SIMS_EFFECT_RANGE_TEXT = '单项变化只能落在 -20 到 24 之间';

/* ---------- 真源表 ⑥：池子与上限 ---------- */
export const SIMS_LINE_LIMIT = 3;          /* 每个行动的台词要几条（源要求刚好 3 条） */
export const SIMS_LINE_USE_LIMIT = 3;      /* 单次生成里每个行动最多收几条 */
export const SIMS_EVENT_LIMIT = 10;        /* 小事件池上限（源要求刚好 10 条） */
export const SIMS_MEMORY_LIMIT = 10;       /* 记忆流上限（源写死 10，满了整本清空） */
export const SIMS_TITLE_MAX = 10;
export const SIMS_TEXT_MAX = 36;
export const SIMS_MEMORY_TITLE_MAX = 24;
export const SIMS_MEMORY_TEXT_MAX = 120;
export const SIMS_DEFAULT_EVENT_TITLE = '小事件';
export const SIMS_MAX_UNITS = 40;          /* 台账最多留最近多少条 */

/* ---------- 真源表 ⑦：池子四态（源只有「拆得开」与「当成空」） ---------- */
export const SIMS_POOL_STATES = Object.freeze(['ok', 'partial', 'absent', 'malformed']);
export const SIMS_POOL_STATE_TEXT = Object.freeze({
    [SIMS_POOL_STATES[0]]: '一个行动三条台词，点一次取一条',
    [SIMS_POOL_STATES[1]]: '台词不满三条，点几次就会绕回开头',
    [SIMS_POOL_STATES[2]]: '这一格还没生成过',
    [SIMS_POOL_STATES[3]]: '这一格写了东西但一条都用不上'
});

/* ---------- 真源表 ⑧：今日愿望四态（源只有「今天有」与「当成没有」） ---------- */
export const SIMS_WISH_STATES = Object.freeze(['ok', 'stale', 'absent', 'malformed']);
export const SIMS_WISH_STATE_TEXT = Object.freeze({
    [SIMS_WISH_STATES[0]]: '今天的愿望在',
    [SIMS_WISH_STATES[1]]: '存着的是过去某天的愿望，今天要用得重新定',
    [SIMS_WISH_STATES[2]]: '今天还没有愿望',
    [SIMS_WISH_STATES[3]]: '存着一条愿望但读不出来'
});

/* ---------- 真源表 ⑨：记忆流三态 ---------- */
export const SIMS_MEMORY_STATES = Object.freeze(['ok', 'absent', 'malformed']);

/* ---------- 真源表 ⑩：取数四态（与第 3 层各件同规格） ---------- */
export const SIMS_FACES = Object.freeze(['ok', 'empty', 'malformed', 'storage_absent']);
export const SIMS_FACE_TEXT = Object.freeze({
    [SIMS_FACES[0]]: '读得到',
    [SIMS_FACES[1]]: '还没记过',
    [SIMS_FACES[2]]: '写了但认不出来',
    [SIMS_FACES[3]]: '读不出来'
});

/* ---------- 真源表 ⑪：回信归一的失败因 ---------- */
export const SIMS_REPLY_WHYS = Object.freeze({
    no_text: { label: '没有可读的回信正文', why: '源把这种情况与「解析失败」塔成同一句提示' },
    unbalanced: { label: '花括号没有配平', why: '源用贪婪匹配取首个对象，截断的回信会一路吞到串尾' },
    no_object: { label: '正文里没有对象', why: '源连花括号都没有时只报「无法解析响应」' },
    bad_json: { label: '看着像对象但读不成 JSON', why: '源在这一步抛异常并吞掉，用户不知道坏在哪' },
    not_object: { label: '读出来不是对象', why: '源直接取字段，取到空也不报' }
});

function toStr(v) {
    return (typeof v === 'string') ? v : '';
}

function clampLenRaw(s, max) {
    const t = toStr(s).trim();
    return t.length > max ? t.slice(0, max) : t;
}

/* ══════════════════ 需求值：读不出来不许当成 5 ══════════════════ */
/*
 * 源：clampSimsNeedValue(value)
 *   · 非有限值 ⇒ 直接回落成最小档（一条坏掉的需求画出来是根 5% 的进度条）
 *   · 否则四舍五入后夹在 5..100
 * 本件：把「回落」这件事**报出去**（ok=false 且给出兜底值），视图据此画
 *   「这一项读不出来」，而不是画一根几乎见底的条。
 */
export function clampNeed(v) {
    const n = numOrNull(v);
    if (n === null) {
        return { ok: false, why: 'not_number', value: SIMS_VALUE_FALLBACK, clamped: false };
    }
    const r = Math.round(n);
    if (r < SIMS_VALUE_MIN) return { ok: true, why: 'low', value: SIMS_VALUE_MIN, clamped: r !== SIMS_VALUE_MIN };
    if (r > SIMS_VALUE_MAX) return { ok: true, why: 'high', value: SIMS_VALUE_MAX, clamped: r !== SIMS_VALUE_MAX };
    return { ok: true, why: 'ok', value: r, clamped: false };
}

/** 六项初值（源 getDefaultNeeds，键面取真源表，不手写）。 */
export function needDefaults(base) {
    const src = (base && typeof base === 'object') ? base : null;
    const out = {};
    for (const k of SIMS_NEED_KEYS) {
        const raw = src ? src[k] : undefined;
        const r = (raw === undefined) ? null : clampNeed(raw);
        out[k] = (r && r.ok) ? r.value : SIMS_NEED_META[k].base;
    }
    return out;
}

export function levelKeyOf(value) {
    const r = clampNeed(value);
    if (!r.ok) return '';
    let picked = SIMS_LEVELS[SIMS_LEVELS.length - 1];
    for (const k of SIMS_LEVELS) {
        if (r.value >= SIMS_LEVEL_META[k].min) { picked = k; break; }
    }
    return picked;
}

/** 逐项报可读性：「读得出」与「读了但回落」两态分开（源两态同形）。 */
export function needsReadout(needs) {
    const src = (needs && typeof needs === 'object') ? needs : {};
    const rows = [];
    let unreadable = 0;
    for (const k of SIMS_NEED_KEYS) {
        const r = clampNeed(src[k]);
        if (!r.ok) unreadable += 1;
        rows.push({
            key: k, label: SIMS_NEED_META[k].label,
            value: r.ok ? r.value : null, ok: r.ok, why: r.why,
            level: r.ok ? levelKeyOf(r.value) : '',
            levelLabel: r.ok ? SIMS_LEVEL_META[levelKeyOf(r.value)].label : SIMS_NEED_UNREADABLE
        });
    }
    return { rows: rows, unreadable: unreadable, ok: unreadable === 0 };
}

/* ══════════════════ 心情：缺项不许落最差档 ══════════════════ */
/*
 * 源：把六项求和除六 ⇒ 缺一项即算出非数；非数与四档阈值比较全为假
 *     ⇒ 直接落最后那个分支「非常不开心」。**缺项被判成心情最差**。
 * 本件：任一读不出来即「心情读不出来」，avg 报 null。
 */
export function moodOf(needs) {
    const src = (needs && typeof needs === 'object') ? needs : {};
    let sum = 0;
    for (const k of SIMS_NEED_KEYS) {
        const r = clampNeed(src[k]);
        if (!r.ok) {
            return { ok: false, mood: '', label: SIMS_MOOD_UNKNOWN, avg: null, why: 'need_unreadable' };
        }
        sum += r.value;
    }
    const avg = sum / SIMS_NEED_KEYS.length;
    let picked = SIMS_MOODS[SIMS_MOODS.length - 1];
    for (const k of SIMS_MOODS) {
        if (avg >= SIMS_MOOD_META[k].min) { picked = k; break; }
    }
    return {
        ok: true, mood: picked, label: SIMS_MOOD_META[picked].label,
        avg: Math.round(avg * 10) / 10, why: 'ok'
    };
}

/* ══════════════════ 效果：夹取与跳过都要报出来 ══════════════════ */
/*
 * 源：把不在六项里的键静默丢弃、非有限值静默丢弃、值为 0 静默丢弃、
 *   超范围静默夹到 -20..24 —— 四件事一件也不报。
 * 本件：同样夹取，但把「丢了哪个键、为什么」逐条报出去。
 */
export function sanitizeEffects(effects) {
    const src = (effects && typeof effects === 'object') ? effects : {};
    const kept = {};
    const rejected = [];
    for (const k of Object.keys(src)) {
        if (SIMS_NEED_KEYS.indexOf(k) < 0) {
            rejected.push({ need: k, why: 'unknown_need' });
            continue;
        }
        const n = numOrNull(src[k]);
        if (n === null) {
            rejected.push({ need: k, why: 'not_number' });
            continue;
        }
        const r = Math.round(n);
        if (r === 0) {
            rejected.push({ need: k, why: 'zero' });
            continue;
        }
        let v = r;
        if (v < SIMS_EFFECT_MIN) { v = SIMS_EFFECT_MIN; rejected.push({ need: k, why: 'clamped', from: r, to: v }); }
        else if (v > SIMS_EFFECT_MAX) { v = SIMS_EFFECT_MAX; rejected.push({ need: k, why: 'clamped', from: r, to: v }); }
        kept[k] = v;
    }
    return { effects: kept, rejected: rejected, empty: Object.keys(kept).length === 0 };
}

/**
 * 把一组效果落到六项上。
 *   · 逐项报 from → to 与「这一项到底动没动」；
 *   · 源只报一个布尔（动过 / 没动），把「三项里只动了一项」这件事吞掉；
 *   · 源对读不出来的需求值回落成 5 再参与运算 —— 本件**不参与运算**并报 skipped。
 */
export function applyEffects(needs, effects) {
    const san = sanitizeEffects(effects);
    const next = needDefaults(needs);
    const applied = [];
    const skipped = [];
    for (const k of SIMS_NEED_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(san.effects, k)) continue;
        const delta = san.effects[k];
        const cur = clampNeed((needs && typeof needs === 'object') ? needs[k] : undefined);
        if (!cur.ok) {
            skipped.push({ need: k, why: 'need_unreadable', delta: delta });
            continue;
        }
        const bumped = clampNeed(cur.value + delta);
        if (bumped.value === cur.value) {
            skipped.push({ need: k, why: 'no_change', delta: delta });
            continue;
        }
        next[k] = bumped.value;
        applied.push({ need: k, delta: delta, from: cur.value, to: bumped.value, capped: bumped.clamped });
    }
    return { needs: next, applied: applied, skipped: skipped, changed: applied.length > 0, rejected: san.rejected };
}

/** 一行可读的效果说明（源把六项按标签拼成一段）。 */
export function effectText(effects) {
    const san = sanitizeEffects(effects);
    const parts = [];
    for (const k of SIMS_NEED_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(san.effects, k)) continue;
        const v = san.effects[k];
        parts.push(SIMS_NEED_META[k].label + ' ' + (v > 0 ? '+' : '') + v);
    }
    return parts.join(' · ');
}

/* ══════════════════ 今日愿望：过期不许与「今天没有」同形 ══════════════════ */
export function todayKeyOf(nowMs) {
    const n = numOrNull(nowMs);
    const d = new Date(n === null ? Date.now() : n);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return String(y) + '-' + m + '-' + day;
}

/**
 * 读一条存着的愿望。四态如实分开：
 *   ok（今天的）/ stale（存着过去某天的）/ absent（没存过）/ malformed（存着但读不出来）。
 *   ★ 源把 stale 与 absent 一起归一成「没有」—— 用户看到「今天还没有愿望」，
 *     不知道其实昨天那条还在，重定一次就把昨天的盖掉了。
 */
export function parseSavedWish(jsonText, today) {
    const t = toStr(jsonText);
    if (!t.trim()) return { state: SIMS_WISH_STATES[2], wish: null, why: 'absent' };
    let parsed = null;
    try { parsed = JSON.parse(t); }
    catch (_e) { return { state: SIMS_WISH_STATES[3], wish: null, why: 'bad_json' }; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { state: SIMS_WISH_STATES[3], wish: null, why: 'not_object' };
    }
    const title = clampLenRaw(parsed.title, SIMS_MEMORY_TITLE_MAX);
    const desc = clampLenRaw(parsed.desc, SIMS_MEMORY_TEXT_MAX);
    if (!title || !desc) {
        return { state: SIMS_WISH_STATES[3], wish: null, why: title ? 'no_desc' : 'no_title' };
    }
    const day = toStr(parsed.date).trim();
    const want = toStr(today).trim();
    if (!day) return { state: SIMS_WISH_STATES[3], wish: null, why: 'no_date' };
    if (want && day !== want) {
        return {
            state: SIMS_WISH_STATES[1], wish: null, why: 'stale',
            savedDate: day, today: want,
            stale: { title: title, desc: desc, date: day }
        };
    }
    const needRaw = toStr(parsed.need).trim();
    const actionRaw = toStr(parsed.actionId).trim() || toStr(parsed.action).trim();
    return {
        state: SIMS_WISH_STATES[0],
        wish: {
            date: day, need: needRaw, actionId: actionRaw,
            title: title, desc: desc, completed: parsed.completed === true,
            at: toStr(parsed.at)
        },
        why: 'ok'
    };
}

/**
 * 按最低的那项需求定今天的愿望（源 buildSimsDailyWish）。
 *   ★ 源用 reduce 在六项里挑最小 —— 只要有一项读不出来（非数），
 *     所有比较都为假 ⇒ **永远挑中第一个键**（饥饿），即「读不出来」
 *     会被悄悄说成「他最饿」。本件先看六项齐不齐，不齐就如实报。
 */
export function buildWish(needs, today) {
    const base = needDefaults(needs);
    let lowest = '';
    let lowestVal = null;
    let unknown = 0;
    for (const k of SIMS_NEED_KEYS) {
        const r = clampNeed((needs && typeof needs === 'object') ? needs[k] : undefined);
        if (!r.ok) { unknown += 1; continue; }
        if (lowestVal === null || r.value < lowestVal) { lowestVal = r.value; lowest = k; }
    }
    if (unknown > 0 || !lowest) {
        return { ok: false, why: 'need_unreadable', wish: null, unknown: unknown, needs: base, lowest: '', lowestValue: null };
    }
    return {
        ok: true, why: 'ok', unknown: 0, needs: base, lowest: lowest, lowestValue: lowestVal,
        wish: {
            date: toStr(today), need: lowest, actionId: SIMS_CARE_OF[lowest] || SIMS_ACTION_IDS[SIMS_ACTION_IDS.length - 1],
            title: SIMS_WISH_TITLE[lowest] || '', desc: SIMS_WISH_DESC[lowest] || '',
            completed: false, at: ''
        }
    };
}

/* ══════════════════ 池子：四态与游标轮次 ══════════════════ */
/** 把模型给的一池内容归一到本件的形状（源 normalizeSimsGeneratedLines）。 */
export function normalizePool(data) {
    const src = (data && typeof data === 'object') ? data : null;
    const actions = {};
    const faces = {};
    const rejected = [];
    let lines = 0;
    for (const a of SIMS_ACTION_IDS) {
        const raw = src && src.actions ? src.actions[a] : undefined;
        if (raw === undefined || raw === null) {
            actions[a] = [];
            faces[a] = SIMS_POOL_STATES[2];
            continue;
        }
        if (!Array.isArray(raw)) {
            actions[a] = [];
            faces[a] = SIMS_POOL_STATES[3];
            rejected.push({ where: a, why: 'not_array' });
            continue;
        }
        const kept = [];
        for (const one of raw) {
            if (typeof one !== 'string') {
                rejected.push({ where: a, why: 'not_string' });
                continue;
            }
            const t = one.trim();
            if (!t) {
                rejected.push({ where: a, why: 'empty' });
                continue;
            }
            if (kept.indexOf(t) >= 0) {
                rejected.push({ where: a, why: 'repeat' });
                continue;
            }
            if (kept.length >= SIMS_LINE_USE_LIMIT) {
                rejected.push({ where: a, why: 'over_limit' });
                continue;
            }
            kept.push(t);
        }
        actions[a] = kept;
        lines += kept.length;
        if (!kept.length) faces[a] = SIMS_POOL_STATES[3];
        else if (kept.length < SIMS_LINE_LIMIT) faces[a] = SIMS_POOL_STATES[1];
        else faces[a] = SIMS_POOL_STATES[0];
    }
    /* ---- 小事件池（源把字符串条目当标题缺省、正文取原串） ---- */
    const events = [];
    let eventsState = SIMS_POOL_STATES[2];
    let defaulted = 0;
    const rawEvents = src ? src.events : undefined;
    if (rawEvents === undefined || rawEvents === null) {
        eventsState = SIMS_POOL_STATES[2];
    } else if (!Array.isArray(rawEvents)) {
        eventsState = SIMS_POOL_STATES[3];
        rejected.push({ where: 'events', why: 'not_array' });
    } else {
        for (const one of rawEvents) {
            let title = '';
            let text = '';
            let effects = null;
            if (typeof one === 'string') {
                title = SIMS_DEFAULT_EVENT_TITLE;
                text = one.trim();
                defaulted += 1;
            } else if (one && typeof one === 'object') {
                title = clampLenRaw(one.title, SIMS_TITLE_MAX);
                if (!title) { title = SIMS_DEFAULT_EVENT_TITLE; defaulted += 1; }
                text = clampLenRaw(one.text, SIMS_TEXT_MAX);
                const san = sanitizeEffects(one.effects);
                effects = san.empty ? null : san.effects;
            } else {
                rejected.push({ where: 'events', why: 'bad_item' });
                continue;
            }
            if (!text) {
                rejected.push({ where: 'events', why: 'empty' });
                continue;
            }
            if (events.length >= SIMS_EVENT_LIMIT) {
                rejected.push({ where: 'events', why: 'over_limit' });
                continue;
            }
            events.push({ title: title, text: text, effects: effects });
        }
        if (!events.length) eventsState = SIMS_POOL_STATES[3];
        else if (events.length < SIMS_EVENT_LIMIT) eventsState = SIMS_POOL_STATES[1];
        else eventsState = SIMS_POOL_STATES[0];
    }
    /* ---- 游标（源只认「有限且不小于 0」，坏值静默落 0 = 从头开始） ---- */
    const cursors = {};
    let indexBad = 0;
    const srcIdx = (src && src.indexes && typeof src.indexes === 'object') ? src.indexes : {};
    /* ★ 两形都算坏值：① 给了但不是数；② 给了但为负（负值同样落 0，同样必须报）。
     *   只认第一形会让「-5 被当成从头开始」这件事无痕迹（不报错、只错结果）。 */
    const badCursor = (raw) => (raw !== undefined) && (numOrNull(raw) === null || numOrNull(raw) < 0);
    for (const a of SIMS_ACTION_IDS) {
        const n = numOrNull(srcIdx[a]);
        if (badCursor(srcIdx[a])) { indexBad += 1; cursors[a] = 0; continue; }
        cursors[a] = (n !== null && n >= 0) ? Math.floor(n) : 0;
    }
    const evN = numOrNull(srcIdx.randomEvent);
    if (badCursor(srcIdx.randomEvent)) indexBad += 1;
    cursors.randomEvent = (evN !== null && evN >= 0) ? Math.floor(evN) : 0;
    return {
        actions: actions, events: events, cursors: cursors, generatedAt: toStr(src && src.generatedAt),
        faces: faces, eventsState: eventsState, lines: lines, defaulted: defaulted,
        indexBad: indexBad, rejected: rejected
    };
}

export function emptyPool() {
    return normalizePool(null);
}

/**
 * 取池里的下一条（源「下一条台词」与「下一个小事件」）。
 *   ★ 源按下标取模后把游标加一落盘 —— 池子只有三条时第四次点就回到第一条，
 *     而**绕回这件事没有任何痕迹**；本件报 wrap（这是第几轮）。
 */
export function nextFromPool(list, cursor) {
    const arr = Array.isArray(list) ? list : [];
    const c = numOrNull(cursor);
    const badCursor = (c === null || c < 0);
    const idx = badCursor ? 0 : Math.floor(c);
    if (!arr.length) {
        return { ok: false, why: 'empty_pool', line: '', index: 0, cursor: idx, wrap: 0, wrapped: false, badCursor: badCursor };
    }
    const use = idx % arr.length;
    const wrap = Math.floor(idx / arr.length);
    return {
        ok: true, why: wrap > 0 ? 'wrapped' : 'ok', line: arr[use], index: use,
        cursor: idx + 1, wrap: wrap, wrapped: wrap > 0, badCursor: badCursor, poolSize: arr.length
    };
}

/* ══════════════════ 记忆流：超限不许整本清空 ══════════════════ */
export function normalizeMemories(data) {
    if (data === undefined || data === null) {
        return { state: SIMS_MEMORY_STATES[1], memories: [], rejected: [], why: 'absent' };
    }
    if (!Array.isArray(data)) {
        return { state: SIMS_MEMORY_STATES[2], memories: [], rejected: [{ why: 'not_array' }], why: 'not_array' };
    }
    const kept = [];
    const rejected = [];
    for (const one of data) {
        if (!one || typeof one !== 'object') {
            rejected.push({ why: 'bad_item' });
            continue;
        }
        const title = clampLenRaw(one.title, SIMS_MEMORY_TITLE_MAX);
        const text = clampLenRaw(one.text, SIMS_MEMORY_TEXT_MAX);
        if (!title && !text) {
            rejected.push({ why: 'empty' });
            continue;
        }
        if (kept.length >= SIMS_MEMORY_LIMIT) {
            rejected.push({ why: 'over_limit' });
            continue;
        }
        kept.push({
            title: title || SIMS_DEFAULT_EVENT_TITLE, text: text,
            effects: effectText(one.effects),
            auto: one.auto === true, at: numOrNull(one.at)
        });
    }
    return {
        state: kept.length ? SIMS_MEMORY_STATES[0] : SIMS_MEMORY_STATES[1],
        memories: kept, rejected: rejected, why: kept.length ? 'ok' : 'empty'
    };
}

/**
 * 往记忆流里落一条。
 *   ★ 源：**满了就把整本记忆置空**再从头压入 —— 第 11 条进来时前 10 条一次全没
 *     （不报错、不提示，用户只会觉得「之前记的那些不知道什么时候没了」）。
 *   本件落最旧一条并如实报 evicted。
 */
export function addMemory(list, entry, limit) {
    const arr = Array.isArray(list) ? list.slice(0) : [];
    const n = numOrNull(limit);
    const lim = (n === null || !Number.isInteger(n) || n < 1) ? SIMS_MEMORY_LIMIT : n;
    const one = (entry && typeof entry === 'object') ? entry : {};
    const title = clampLenRaw(one.title, SIMS_MEMORY_TITLE_MAX) || SIMS_DEFAULT_EVENT_TITLE;
    const text = clampLenRaw(one.text, SIMS_MEMORY_TEXT_MAX);
    const at = numOrNull(one.at);
    arr.unshift({
        title: title, text: text, effects: effectText(one.effects),
        auto: one.auto === true, at: at === null ? null : Math.floor(at)
    });
    let evicted = 0;
    while (arr.length > lim) { arr.pop(); evicted += 1; }
    return { list: arr, evicted: evicted, over: evicted > 0, limit: lim };
}

/**
 * 记忆时间读数（源「相对时间」）。
 *   ★ 源把「现在减时间戳」先夹到不小于 0 —— 一条**未来时间**的记录
 *     会被夹成 0 ⇒ 显示「刚刚」。本件把未来时间如实报出来。
 */
export function memoryAgeOf(stamp, nowMs) {
    const n = numOrNull(stamp);
    const now = numOrNull(nowMs);
    const base = (now === null) ? Date.now() : now;
    if (n === null) return { ok: false, why: 'not_number', label: '时间读不出来', minutes: null };
    const diff = base - n;
    if (diff < 0) return { ok: false, why: 'future', label: '时间戳在未来', minutes: null };
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return { ok: true, why: 'ok', label: '刚刚', minutes: 0 };
    if (minutes < 60) return { ok: true, why: 'ok', label: String(minutes) + '分钟前', minutes: minutes };
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return { ok: true, why: 'ok', label: String(hours) + '小时前', minutes: minutes };
    return { ok: true, why: 'ok', label: String(Math.floor(hours / 24)) + '天前', minutes: minutes };
}

/* ══════════════════ 回信归一：哪一步坏的要说出来 ══════════════════ */
/**
 * 从回信正文里抠出**第一个配平的对象**。
 *   ★ 源用贪心字串匹配取「从第一个左花括号到最后一个右花括号」：回信里
 *     JSON 之后若还有一段带花括号的说明（模型很爱这么写），会把它们一并吞进来
 *     ⇒ 读 JSON 抛错 ⇒ 用户只看到一句「无法解析响应」，既不知道是格式问题、
 *     也不知道坏在哪一段。
 *   本件逐字符配平（认字符串与转义），并区分五种失败因。
 *   ★ 反斜杠与引号一律走拼装形：本仓剥注释器是字符状态机。
 */
const BS = String.fromCharCode(92);
const DQ = String.fromCharCode(34);

export function extractObject(text) {
    const s = toStr(text);
    if (!s.trim()) return { ok: false, why: 'no_text', json: '', start: -1, end: -1, truncated: false };
    const start = s.indexOf('{');
    if (start < 0) return { ok: false, why: 'no_object', json: '', start: -1, end: -1, truncated: false };
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < s.length; i += 1) {
        const ch = s.charAt(i);
        if (inStr) {
            if (esc) { esc = false; continue; }
            if (ch === BS) { esc = true; continue; }
            if (ch === DQ) { inStr = false; }
            continue;
        }
        if (ch === DQ) { inStr = true; continue; }
        if (ch === '{') { depth += 1; continue; }
        if (ch === '}') {
            depth -= 1;
            if (depth === 0) {
                return { ok: true, why: 'ok', json: s.slice(start, i + 1), start: start, end: i, truncated: false };
            }
            if (depth < 0) break;
        }
    }
    return { ok: false, why: 'unbalanced', json: s.slice(start), start: start, end: -1, truncated: true };
}

/** 归一回信：抠对象 → 读 JSON → 分报六项需求 / 池 / 愿望 / 想法条数。 */
export function parseReply(text, opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const today = toStr(o.today) || todayKeyOf();
    const ex = extractObject(text);
    if (!ex.ok) {
        return { ok: false, why: ex.why, needs: null, missing: [], pool: null, wish: null, thoughts: 0, rejected: [], truncated: ex.truncated };
    }
    let parsed = null;
    try { parsed = JSON.parse(ex.json); }
    catch (_e) {
        return { ok: false, why: 'bad_json', needs: null, missing: [], pool: null, wish: null, thoughts: 0, rejected: [], truncated: false };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, why: 'not_object', needs: null, missing: [], pool: null, wish: null, thoughts: 0, rejected: [], truncated: false };
    }
    /* 六项需求：**只认给了的**，缺的如实报 */
    const givenNeeds = {};
    const missing = [];
    const needsSrc = (parsed.needs && typeof parsed.needs === 'object') ? parsed.needs : {};
    for (const k of SIMS_NEED_KEYS) {
        const r = clampNeed(needsSrc[k]);
        if (needsSrc[k] === undefined || !r.ok) missing.push(k);
        else givenNeeds[k] = r.value;
    }
    const pool = normalizePool({ actions: parsed.actionLines, events: parsed.randomEvents, indexes: null });
    const dw = (parsed.dailyWish && typeof parsed.dailyWish === 'object') ? parsed.dailyWish : null;
    const wish = dw
        ? {
            title: clampLenRaw(dw.title, SIMS_MEMORY_TITLE_MAX),
            desc: clampLenRaw(dw.desc, SIMS_MEMORY_TEXT_MAX),
            actionId: toStr(dw.action || dw.actionId).trim(),
            need: toStr(dw.need).trim(),
            date: today, completed: false, at: ''
        }
        : null;
    const thoughts = Array.isArray(parsed.thoughts) ? parsed.thoughts.length : 0;
    return {
        ok: true, why: 'ok', needs: givenNeeds, missing: missing, pool: pool,
        wish: wish, thoughts: thoughts, rejected: pool.rejected, truncated: false
    };
}

/**
 * 产一段**可复制的要求文本**（源那段五段式 system prompt 的治理面）。
 *   ★ 本件不自己发请求、不碰密钥：只把「要模型按什么格式给什么」写成一段人话。
 */
export function composeRequestText(form) {
    const f = (form && typeof form === 'object') ? form : {};
    const role = clampLenRaw(f.role, 24) || '这个角色';
    const lines = [];
    lines.push('请按下面的格式给 ' + role + ' 生成一份状态数据，只回一个 JSON 对象，不要写别的话。');
    lines.push('');
    lines.push('要给的内容：');
    lines.push('1. needs：六项需求值，键名固定为 ' + SIMS_NEED_KEYS.join(' / ') + '，每项 ' + SIMS_VALUE_MIN + ' 到 ' + SIMS_VALUE_MAX + ' 的整数；');
    lines.push('2. actionLines：六个行动各 ' + SIMS_LINE_LIMIT + ' 条台词，键名固定为 ' + SIMS_ACTION_IDS.join(' / ') + '，每条一句生活碎片，不要解释数值；');
    lines.push('3. randomEvents：刚好 ' + SIMS_EVENT_LIMIT + ' 条小事件，每条含 title（' + SIMS_TITLE_MAX + ' 字内）、text（' + SIMS_TEXT_MAX + ' 字内）与 effects（' + SIMS_EFFECT_RANGE_TEXT + '）；');
    lines.push('4. dailyWish：一条今日愿望，含 title 与 desc 与 action（' + SIMS_ACTION_IDS.join(' / ') + '）与 need（' + SIMS_NEED_KEYS.join(' / ') + '）；');
    lines.push('5. thoughts：六条想法，与六项需求一一对应。');
    lines.push('');
    lines.push('两条禁令：');
    lines.push('- 不许用表情符号；');
    lines.push('- 不许在 JSON 之后另写说明文字（读取口只认第一个完整对象，后面的内容会被丢掉）。');
    return lines.join(String.fromCharCode(10));
}

/* ══════════════════ 读数面 ══════════════════ */
export function readingsOf(memories, pool, wishState, opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const ms = Array.isArray(memories) ? memories : [];
    let auto = 0;
    for (const m of ms) if (m && m.auto === true) auto += 1;
    const faces = (pool && pool.faces) ? pool.faces : {};
    let okCount = 0;
    let partial = 0;
    let absent = 0;
    let malformed = 0;
    for (const a of SIMS_ACTION_IDS) {
        const st = faces[a];
        if (st === SIMS_POOL_STATES[0]) okCount += 1;
        else if (st === SIMS_POOL_STATES[1]) partial += 1;
        else if (st === SIMS_POOL_STATES[2]) absent += 1;
        else malformed += 1;
    }
    const rec = numOrNull(o.receipts);
    return {
        memories: ms.length,
        auto: auto,
        manual: ms.length - auto,
        poolOk: okCount,
        poolPartial: partial,
        poolAbsent: absent,
        poolMalformed: malformed,
        events: pool && Array.isArray(pool.events) ? pool.events.length : 0,
        eventsState: pool ? pool.eventsState : '',
        lines: pool ? pool.lines : 0,
        wishState: toStr(wishState),
        receipts: rec === null ? 0 : Math.floor(rec)
    };
}

/** 取数面四态里的「这一格」判词（源把后三种都画成空）。 */
export function faceOf(present, usable, bad) {
    if (present !== true) return SIMS_FACES[3];
    if (bad === true) return SIMS_FACES[2];
    return (usable === true) ? SIMS_FACES[0] : SIMS_FACES[1];
}
