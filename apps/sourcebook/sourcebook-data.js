/* ========================================================
 * sourcebook-data.js — [v3.39.0] 时光胶囊 · 封存取回内核
 *
 * 缝合自小鼠机（nuo_sources/nuo3/xiaoshuji.html，6405117 字节 /
 * 112433 行单文件自包含，内联 JS 3111153 字符）的「回忆录 / 时间胶囊」
 * 一族（timeCapsule* 66 个函数 / 419 处命中）。
 *
 * ── 源是什么 ──────────────────────────────────────────
 *   源把「写给未来的信」做成一个完整生命周期：
 *   ① 封存（message + openDate + mood + 收件角色 or 未来的自己）；
 *   ② 跨度分档：按封存日到拆开日的天数分档（2 / 7 / 30 / 90 / 365），
 *      每档一句「心理距离」提示给模型；
 *   ③ 口吻分族：按正文与心情分词判六族（mixed / happy / difficult /
 *      anticipation / tender / daily），每族一句说话指引；
 *   ④ 拆开回信：结构化四段（title / roleMessage / receipt / keywords）；
 *   ⑤ 两条硬约束：不许线下或送礼暗示、不许给用户压力；
 *   ⑥ 折叠导入：兼容 string / {data} / {items} / {capsules} /
 *      {timeCapsules} 五种形态，最多折四层。
 *
 * ── 本件取哪几块（本件是治理层，不是生成层）──────
 *   取 ①②③④⑥ 的**治理面**：跨度分档 / 口吻分族 / 折叠归一 / 回信归一 /
 *   两条硬约束 / 读数与台账。
 *   ⑤ 的**执笔口**不缝（见下）—— 本件只保留两条约束的**校验**面。
 *
 * ── 四块不缝（源里有、本仓明令禁止或有第二个权威的，逐条写后果）──
 *   ① **不自己调模型**：源 getTimeCapsuleApiConfig() 从 localStorage 直读
 *      apiUrl / apiKey / selectedModel（密钥面）并自己拼 chat 请求。
 *      本件**零网络调用、零密钥读**：只产**提示词要求文本**与**回信校验**，
 *      由用户贴回自己惯用的对话端。缝进来就是把第二个模型出口塞进本仓，
 *      与 apps/settings 的模型面争权威。
 *   ② **不碰宿主对象**：源把胶囊写回宿主微信数据（存储键 wechatTimeCapsules）。
 *      本件零宿主写入零宿主读。
 *   ③ **不读别的 App 的表**：源直读 roles 全局与 messages[roleId] 会话数组
 *      （取末 10 条作上下文）。本件自带收件人与正文，零跨 App 读。
 *   ④ **不收外链、不落数据库**：源走 DataStorage（IndexedDB）读写，
 *      头像走 URL。本件零数据库、零 URL，落 PhoneStorage 三条会话键。
 *
 * ── 三条偏离（偏离不是遗漏，逐条写明）──
 *   ① **封存时间取不出来不许假装是「今天封的」**：源
 *      getTimeCapsuleSpanInfo 用 new Date(capsule.createdAt || Date.now())
 *      —— 一条 createdAt 坏掉的记录会被**当成今天封的**，于是「刚刚写的」
 *      与「三年前写的」在跨度上同形，收信口吻直接落错档。
 *      本件给出封存时间的三态（可读 / 缺 / 坏），且**缺与坏不同形**：
 *      缺是「没写」，坏是「写了但不是数」。
 *   ② **心情未填写与填了默认值不许同形**：源
 *      const mood = capsule.mood || 'quiet' —— 「没填心情」与「填了 quiet」
 *      在回信与读数面上完全同形。本件 moodOf() 如实报两种。
 *   ③ **跨度首档与算不出天数不许同形**：源用 days >= 365 / 90 / 30 / 7 / 2
 *      串成链、默认档喰掉所有剩余情形。本件把首档单列，且天数算不出来时
 *      返回 known=false（**不编 0、不当今天**）。
 *
 * ── 本套件守的静默失效形式（都不报错、不崩溃，只是结果不对）──
 *   · 封存时间取不出来不许当成「今天封的」；
 *   · 心情未填写不许与填了默认值同形；
 *   · 跨度六档不许塔成少于六档（塔了 = 收信口吻永远偏档）；
 *   · 口吻六族不许塔成一族（塔了 = 所有回信都是同一种腔）；
 *   · 折叠归一不许把坏输入静默当成空列表；
 *   · 两条硬约束不许只报「有问题」而说不出问题在哪一句。
 *
 * ── 实现纪律（本仓 v3.31/v3.35/v3.36/v3.38 各踩过一次）──
 *   代码里不许出现会骗过状态机的裸引号：本仓判据共用的剥注释器是
 *   字符状态机、不解析正则字面量，正则里的裸引号会让它永久卡住
 *   （卡住之后文件尾注释全被当成代码 ⇒ 通道面判据假红）。
 *   故本件禁用正则字面量：一律用字串比对与 new RegExp 构造。
 * ======================================================== */
import { numOrNull } from '../../config/num-gate.js';

/* ---------- 真源表 ①：跨度六档（键面与校验白名单共用这一张） ---------- */
export const SPAN_BUCKETS = Object.freeze([
    'same_day', 'few_days', 'few_weeks', 'few_months', 'months', 'years'
]);
/* ★ 键面**必须取真源数组的值**（计算键），不许手写标识符形 —— 本仓 J7 门禁（桥契约）
 *   判的就是这件事：手写键与真源值一旦错位，查不到就静默走兜底，多种处境显示成同一句话。 */
export const SPAN_META = Object.freeze({
    [SPAN_BUCKETS[0]]: { floorDays: 0,   label: '当天或隔天', why: '情绪还热，反应应当直接、近、带余温' },
    [SPAN_BUCKETS[1]]: { floorDays: 2,   label: '几天',       why: '事件余温还在，反应具体、即时' },
    [SPAN_BUCKETS[2]]: { floorDays: 7,   label: '几周',       why: '情绪还认得出来，但已经不那么刺' },
    [SPAN_BUCKETS[3]]: { floorDays: 30,  label: '一个月上下', why: '事情没有完全远去但已经换了光线' },
    [SPAN_BUCKETS[4]]: { floorDays: 90,  label: '几个月',     why: '情绪已经沉下去，更像重新理解当时的自己' },
    [SPAN_BUCKETS[5]]: { floorDays: 365, label: '一年以上',   why: '写信时的自己已经有点陌生，反应有距离感' }
});

/* ---------- 真源表 ②：口吻六族（源按分词判，六族各异其形） ---------- */
export const TONE_TYPES = Object.freeze([
    'mixed', 'happy', 'difficult', 'anticipation', 'tender', 'daily'
]);
export const TONE_META = Object.freeze({
    mixed:        { label: '开心与困难混合',     feel: '又亮又拧巴，最终往亮处带' },
    happy:        { label: '开心 / 成就 / 喜欢', feel: '把快乐继续放大，不许写成遗憾' },
    difficult:    { label: '压力 / 失落 / 困难', feel: '先托起来，再给一点明亮感' },
    anticipation: { label: '期待 / 计划 / 等待', feel: '把等待写得轻快、有盼头' },
    tender:       { label: '柔软 / 想念 / 感谢', feel: '柔软但不悲伤化，留下轻盈的甜味' },
    daily:        { label: '日常 / 普通心情',    feel: '从一个小细节接话，写得轻巧可爱' }
});

/** 跨度取不出来时的人话（**单一份**：数据层拼要求文本、App 层拼读数、视图拼徽章
 *  都用这一句；三处各写一份的话，改动只能改中一处而不报错）。 */
export const SPAN_UNKNOWN_LABEL = '跨度取不出来';

/* ---------- 真源表 ③：心情兜底键（源是 capsule.mood || 'quiet'） ---------- */
export const MOOD_FALLBACK = 'quiet';

/* ---------- 真源表 ④：两条硬约束的分因（视图与校验共用） ---------- */
export const GUARD_REASONS = Object.freeze({
    offline_or_gift: { label: '含线下互动或送礼暗示', why: '源把这类内容判为越界，要求重试生成' },
    pressure:        { label: '给用户带来压力',       why: '源把这类内容判为越界，要求重试生成' }
});
export const GUARD_KEYS = Object.freeze(Object.keys(GUARD_REASONS));

/* ---------- 真源表 ⑤：回信四段与上限（只有一处，不许在别处再写一遍） ---------- */
export const ECHO_SEGMENTS = Object.freeze(['title', 'roleMessage', 'receipt', 'keywords']);
export const SOURCEBOOK_MAX_TITLE = 80;
export const SOURCEBOOK_MAX_MESSAGE = 1200;
export const SOURCEBOOK_MAX_KEYWORDS = 5;
export const SOURCEBOOK_RECEIPT_WITNESS_MAX = 8;
export const SOURCEBOOK_MAX_RECEIPTS = 60;
export const SOURCEBOOK_MAX_CAPSULES = 50;

/* ---------- 真源表 ⑥：台账三态（视图键面与校验白名单共用） ---------- */
export const SOURCEBOOK_FACES = Object.freeze({
    ok: 'ok',
    empty: 'empty',
    storage_absent: 'storage_absent'
});

/* ---------- 真源表 ⑦：收件人两种（角色 / 未来的自己） ---------- */
export const RECIPIENT_KINDS = Object.freeze({
    self: { label: '未来的自己', why: '没有参与角色时，回信要写出身份连续感' },
    role: { label: '保管的角色', why: '有参与角色时，回信要带关系感与人设' }
});
export const RECIPIENT_KEYS = Object.freeze(Object.keys(RECIPIENT_KINDS));

/* ---------- 真源表 ⑧：封存时间的取值三态 ---------- */
export const CREATED_STATES = Object.freeze({ ok: 'ok', absent: 'absent', malformed: 'malformed' });
export const CREATED_STATE_KEYS = Object.freeze(Object.keys(CREATED_STATES));

function toStr(v) {
    return (typeof v === 'string') ? v : '';
}

/* ══════════════════ 日期：不许把坏日期当成今天 ══════════════════ */
/*
 * 源 parseTimeCapsuleDate() 只处理 YYYY-MM-DD 一种形态，
 * 取不出来就 return null —— 而调用方一律用「|| today」喰掉它。
 * 本件把「取不出来」拆成三种：缺（没写）/ 畸形（不是三段）/ 越界（月日不在范围）。
 */
export function parseOpenDate(value) {
    const s = toStr(value).trim();
    if (!s) return { ok: false, reason: 'absent', date: null, saw: s };
    const parts = s.split('-');
    if (parts.length !== 3) return { ok: false, reason: 'malformed', date: null, saw: s };
    const y = numOrNull(parts[0]);
    const m = numOrNull(parts[1]);
    const d = numOrNull(parts[2]);
    if (y === null || m === null || d === null) {
        return { ok: false, reason: 'malformed', date: null, saw: s };
    }
    if (m < 1 || m > 12 || d < 1 || d > 31) {
        return { ok: false, reason: 'out_of_range', date: null, saw: s };
    }
    return { ok: true, reason: 'ok', date: { y: y, m: m, d: d }, saw: s };
}

/** 把合法日期换成纯日编号（用于天数差，不碰时区）。 */
export function dayNumber(date) {
    if (!date) return null;
    const y = numOrNull(date.y);
    const m = numOrNull(date.m);
    const d = numOrNull(date.d);
    if (y === null || m === null || d === null) return null;
    if (m < 1 || m > 12) return null;
    const monthDays = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    let n = y * 365 + Math.floor(y / 4) + monthDays[m - 1] + d;
    if (m > 2 && (y % 4 === 0)) n += 1;
    return n;
}

/** 两个日编号之间的整天数（不许出负数）。 */
export function daysBetween(fromDate, toDate) {
    const a = dayNumber(fromDate);
    const b = dayNumber(toDate);
    if (a === null || b === null) return null;
    return Math.max(0, b - a);
}

/**
 * spanBucket(days) —— 天数 → 档键（六档，各带自己的天数下限）。
 * 源的链：days>=365?年 : days>=90?几个月 : days>=30 ... : days>=2?几天
 *        : （默认）当天或隔天 —— 默认档把「当天」与「隔天」与
 *        「天数根本算不出来」三种都喰掉了。本件把算不出来单列（known=false）。
 */
export function spanBucket(days) {
    const d = numOrNull(days);
    if (d === null) return { bucket: 'same_day', known: false, sawDays: String(days) };
    const v = Math.max(0, Math.round(d));
    let key = 'same_day';
    if (v >= SPAN_META.years.floorDays) key = 'years';
    else if (v >= SPAN_META.months.floorDays) key = 'months';
    else if (v >= SPAN_META.few_months.floorDays) key = 'few_months';
    else if (v >= SPAN_META.few_weeks.floorDays) key = 'few_weeks';
    else if (v >= SPAN_META.few_days.floorDays) key = 'few_days';
    return { bucket: key, known: true, days: v, label: SPAN_META[key].label };
}

/** 跨度人话（键面取真源表）。 */
export function spanLabel(bucket) {
    const hit = SPAN_META[bucket];
    return hit ? hit.label : SPAN_META.same_day.label;
}
/**
 * spanOf(capsule) —— 一条胶囊的跨度（含封存时间与拆开日期的取值三态）。
 * ★ 与源的差别：源用 createdAt || Date.now()，取不出来就当今天封的。
 *   本件返回 created: ok | absent | malformed，取不出来时 days 为 null
 *   （**不编 0**，也不当今天）。
 */
export function spanOf(capsule) {
    const c = capsule || {};
    const rawCreated = toStr(c.createdAt);
    /* 封存时间两种合法形态：YYYY-MM-DD（源用 new Date(createdAt)）或日序号。*/
    const createdDate = parseOpenDate(rawCreated);
    const createdOrdinal = numOrNull(rawCreated);
    let createdNum = null;
    let createdState = 'ok';
    if (!rawCreated.trim()) createdState = 'absent';
    else if (createdDate.ok) createdNum = dayNumber(createdDate.date);
    else if (createdOrdinal !== null) createdNum = createdOrdinal;
    else createdState = 'malformed';
    const open = parseOpenDate(c.openDate);
    if (createdState !== 'ok') {
        return {
            created: createdState,
            open: open.ok ? 'ok' : open.reason,
            days: null, known: false, bucket: null, label: '',
            sawCreatedAt: rawCreated
        };
    }
    if (!open.ok) {
        return {
            created: 'ok', open: open.reason, days: null, known: false,
            bucket: null, label: '', sawOpenDate: open.saw
        };
    }
    const openNum = dayNumber(open.date);
    const days = (createdNum === null || openNum === null)
        ? null : Math.max(0, Math.round(openNum - createdNum));
    if (days === null) {
        return {
            created: 'ok', open: 'ok', days: null, known: false,
            bucket: null, label: '', sawCreatedAt: rawCreated
        };
    }
    const sb = spanBucket(days);
    return {
        created: 'ok', open: 'ok', days: days, known: true,
        bucket: sb.bucket, label: sb.label
    };
}

/* ══════════════════ 心情：未填写不许与默认值同形 ══════════════════ */
/**
 * moodOf(capsule) —— 心情两态。
 * ★ 与源的差别：源写 const mood = capsule.mood || 'quiet'，
 *   于是「没填」与「填了 quiet」在回信与读数面上完全同形。
 */
export function moodOf(capsule) {
    const c = capsule || {};
    const raw = toStr(c.mood).trim();
    if (!raw) return { key: MOOD_FALLBACK, filled: false, saw: '' };
    return { key: raw, filled: true, saw: raw };
}

/* ══════════════════ 口吻：六族互不同形 ══════════════════ */
const TONE_WORDS = Object.freeze({
    positive: ['开心','快乐','高兴','幸福','喜欢','成功','顺利','赢','棒','好耶','生日','纪念','旅行','甜','可爱','满足','骄傲','激动','兴奋','幸运','收到','笑','漂亮','好吃','好看','舒服'],
    difficult: ['难过','伤心','失恋','崩溃','压力','焦虑','讨厌','生气','委屈','哭','累','痛','不开心','害怕','孤独','烦','糟糕','失败','失望','遗憾','撑不住','好难'],
    anticipation: ['期待','希望','等到','准备','计划','约定','出发','报名','面试','考试','毕业','入职','搬家','旅行','开始','以后','未来'],
    tender: ['想念','舍不得','怀念','谢谢','感谢','抱歉','对不起','喜欢','爱','珍惜','陪','记得','留住']
});

function hitsAny(text, words) {
    for (let i = 0; i < words.length; i += 1) {
        if (text.indexOf(words[i]) >= 0) return true;
    }
    return false;
}

/**
 * toneOf(capsule) —— 口吻六族（确定性：同输入必得同族）。
 * 分词表逐项与源一致（源用四个正则轮番 test 再按优先级出族）。
 * 优先级：混合 > 正 > 难 > 期待 > 柔软 > 日常。
 */
export function toneOf(capsule) {
    const c = capsule || {};
    const text = toStr(c.message) + ' ' + toStr(c.mood);
    const hasPositive = hitsAny(text, TONE_WORDS.positive);
    const hasDifficult = hitsAny(text, TONE_WORDS.difficult);
    const hasAnticipatory = hitsAny(text, TONE_WORDS.anticipation);
    const hasTender = hitsAny(text, TONE_WORDS.tender);
    let type = 'daily';
    if (hasPositive && hasDifficult) type = 'mixed';
    else if (hasPositive) type = 'happy';
    else if (hasDifficult) type = 'difficult';
    else if (hasAnticipatory) type = 'anticipation';
    else if (hasTender) type = 'tender';
    return {
        type: type,
        label: TONE_META[type].label,
        feel: TONE_META[type].feel,
        matches: {
            positive: hasPositive, difficult: hasDifficult,
            anticipation: hasAnticipatory, tender: hasTender
        }
    };
}

/** 口吻人话（键面取真源表）。 */
export function toneLabel(type) {
    const hit = TONE_META[type];
    return hit ? hit.label : TONE_META.daily.label;
}
/* ══════════════════ 折叠归一：坏输入不许静默成了空列表 ══════════════════ */
/**
 * foldCapsules(value) —— 源支持 string / {data} / {items} / {capsules} /
 * {timeCapsules} 五种形态，最多折四层。
 * ★ 与源的差别：源 try/catch 后 return []，于是「存储里真的一条都没有」
 *   与「存了一团坏数据」在读数面上同时是空列表。本件把两种分开报。
 */
export function foldCapsules(value) {
    let cur = value;
    let folded = 0;
    const keys = ['data', 'items', 'capsules', 'timeCapsules'];
    for (let i = 0; i < 4; i += 1) {
        if (typeof cur === 'string') {
            const trimmed = cur.trim();
            if (!trimmed) return { ok: true, list: [], shape: 'empty_string', folded: folded };
            try { cur = JSON.parse(trimmed); folded += 1; continue; }
            catch (_e) { return { ok: false, reason: 'bad_json', list: [], folded: folded }; }
        }
        if (cur && typeof cur === 'object' && !Array.isArray(cur)) {
            let moved = false;
            for (let k = 0; k < keys.length; k += 1) {
                if (Object.prototype.hasOwnProperty.call(cur, keys[k])) {
                    cur = cur[keys[k]]; folded += 1; moved = true; break;
                }
            }
            if (moved) continue;
        }
        break;
    }
    if (!Array.isArray(cur)) return { ok: false, reason: 'not_array', list: [], folded: folded };
    return { ok: true, list: cur, shape: 'array', folded: folded };
}

/**
 * normalizeCapsules(value) —— 折叠 + 逐条筛选。
 * 源只收「有 message 且有 openDate」的条目；本件保留该口径，
 * 并额外**如实报出被筛掉几条与为什么**（源静默丢）。
 */
export function normalizeCapsules(value) {
    const r = foldCapsules(value);
    if (!r.ok) return { ok: false, reason: r.reason, list: [], dropped: 0, why: {} };
    const kept = [];
    let dropped = 0;
    const why = { no_message: 0, no_open_date: 0, not_object: 0 };
    for (let i = 0; i < r.list.length; i += 1) {
        const one = r.list[i];
        if (!one || typeof one !== 'object') { dropped += 1; why.not_object += 1; continue; }
        if (!toStr(one.message)) { dropped += 1; why.no_message += 1; continue; }
        if (!toStr(one.openDate)) { dropped += 1; why.no_open_date += 1; continue; }
        kept.push(one);
    }
    return { ok: true, reason: 'ok', list: kept, dropped: dropped, why: why, folded: r.folded };
}

/* ══════════════════ 两条硬约束：如实报问题在哪一句 ══════════════════ */
/* 源的两个正则逐项同款；本件用字串比对（禁正则字面量，见文件头纪律）。*/
const OFFLINE_WORDS = Object.freeze([
    '送你','送给你','给你送','送到你','寄给你','给你寄','买给你','给你买',
    '请你喝','请你吃','请你看','请你去','请你','请喝','请吃','请客',
    '送礼','送花','送奶茶','送外卖','送礼物','见面','线下','当面',
    '抱抱','抱住','摸头','牵手','陪你去','来找你','去找你','楼下等你','门口等你'
]);
const PRESSURE_WORDS = Object.freeze([
    '继续加油','你一定可以','以后也要','必须','答应我','别辜负',
    '坚持下去','做到','完成这个','打卡'
]);
/* 源用的是 /不要让.*失望/，本件提成前后两端分词两段判（不许用正则字面量）。*/
const PRESSURE_PAIR_A = '不要让';
const PRESSURE_PAIR_B = '失望';
export const GUARD_FIELDS = Object.freeze(['roleMessage', 'quest', 'chatMessage', 'receiptNote', 'note']);

function pairHit(text, a, b) {
    const i = text.indexOf(a);
    if (i < 0) return false;
    return text.indexOf(b, i + a.length) >= 0;
}

/**
 * guardEcho(echo) —— 源的两条硬约束（不许线下 / 送礼；不许压力）。
 * ★ 与源的差别：源抛 new Error（调用方常吞掉），本件返回**分因结果**，
 *   每条命中都带**命中的那一句（字段）与那个词**（用户能知道改哪一句）。
 */
export function guardEcho(echo) {
    const e = echo || {};
    const hits = [];
    for (let i = 0; i < GUARD_FIELDS.length; i += 1) {
        const f = GUARD_FIELDS[i];
        const text = toStr(e[f]);
        if (!text) continue;
        for (let w = 0; w < OFFLINE_WORDS.length; w += 1) {
            if (text.indexOf(OFFLINE_WORDS[w]) >= 0) {
                hits.push({ reason: 'offline_or_gift', field: f, word: OFFLINE_WORDS[w] });
                break;
            }
        }
        for (let w = 0; w < PRESSURE_WORDS.length; w += 1) {
            if (text.indexOf(PRESSURE_WORDS[w]) >= 0) {
                hits.push({ reason: 'pressure', field: f, word: PRESSURE_WORDS[w] });
                break;
            }
        }
        if (pairHit(text, PRESSURE_PAIR_A, PRESSURE_PAIR_B)) {
            hits.push({ reason: 'pressure', field: f, word: PRESSURE_PAIR_A + '...' + PRESSURE_PAIR_B });
        }
    }
    const reasons = {};
    for (let i = 0; i < GUARD_KEYS.length; i += 1) reasons[GUARD_KEYS[i]] = 0;
    for (let i = 0; i < hits.length; i += 1) reasons[hits[i].reason] += 1;
    return { ok: hits.length === 0, hits: hits, reasons: reasons };
}

/** 词库规模（要求文本与视图里不许手抄这两个数字：词库一改，手抄值就过期）。
 *  pressure 一栏含那条前后两段判（「不要让…失望」）—— 它也是压力约束的一种命中形。 */
export function guardVocab() {
    return {
        offline: OFFLINE_WORDS.length,
        pressure: PRESSURE_WORDS.length + 1,
        fields: GUARD_FIELDS.length
    };
}

/** 分因人话（键面取真源表）。 */
export function guardLabel(reason) {
    const hit = GUARD_REASONS[reason];
    return hit ? hit.label : '';
}
/* ══════════════════ 文本清理与截断 ══════════════════ */
/** 去 CR、折叠连续空行（源 cleanTimeCapsuleGeneratedText 同款口径）。 */
export function cleanText(value) {
    const t = toStr(value).split(String.fromCharCode(13)).join('');
    const runs = t.split(String.fromCharCode(10));
    const out = [];
    let blank = 0;
    for (let i = 0; i < runs.length; i += 1) {
        if (!runs[i].trim()) { blank += 1; if (blank > 1) continue; }
        else blank = 0;
        out.push(runs[i]);
    }
    return out.join(String.fromCharCode(10)).trim();
}

/** 折成单行（源 cleanTimeCapsuleInlineText 同款口径）。 */
export function inlineText(value) {
    const t = cleanText(value);
    const parts = t.split(String.fromCharCode(9)).join(' ').split(' ');
    const kept = [];
    for (let i = 0; i < parts.length; i += 1) {
        if (!parts[i]) continue;
        kept.push(parts[i]);
    }
    return kept.join(' ');
}

/** 按上限截断（上限只从真源表取）。 */
export function clampText(value, max) {
    const t = toStr(value);
    const m = numOrNull(max);
    if (m === null || m <= 0) return t;
    return (t.length > m) ? t.slice(0, m) : t;
}

/* ══════════════════ 回信归一：四段与段的存在性 ══════════════════ */
/**
 * normalizeEcho(raw, capsule) —— 把模型回的那一大段收成四段。
 * ★ 与源的差别：源缺字段就走默认文案（defaultTitle / defaultWitness），
 *   于是「模型真的写了一句」与「模型什么都没给」在读数面上同形。
 *   本件逐段报 provided（真给了）还是 fellBack（落了兜底）。
 */
export function normalizeEcho(raw, capsule) {
    if (!raw || typeof raw !== 'object') {
        return { ok: false, reason: 'not_object', segments: {} };
    }
    const guard = guardEcho(raw);
    if (!guard.ok) return { ok: false, reason: 'guard', guard: guard, segments: {} };
    const c = capsule || {};
    const mood = moodOf(c);
    const span = spanOf(c);
    const tone = toneOf(c);
    const isRole = toStr(c.roleId) !== '';
    const defaultTitle = isRole ? '保管的角色拆开了这封小信' : '未来的自己拆开了这封小信';
    const rawReceipt = inlineText(toStr(raw.receiptNote) || toStr(raw.note) || '');
    const receiptNote = clampText(rawReceipt, SOURCEBOOK_RECEIPT_WITNESS_MAX) || '好好收下';
    const titleGiven = inlineText(toStr(raw.title) || '');
    const bodyGiven = cleanText(toStr(raw.roleMessage) || toStr(raw.message) || '');
    const kws = [];
    if (Array.isArray(raw.keywords)) {
        for (let i = 0; i < raw.keywords.length; i += 1) {
            if (kws.length >= SOURCEBOOK_MAX_KEYWORDS) break;
            const k = inlineText(toStr(raw.keywords[i]));
            if (k) kws.push(k);
        }
    }
    const seg = {
        title: clampText(titleGiven, SOURCEBOOK_MAX_TITLE),
        roleMessage: clampText(bodyGiven, SOURCEBOOK_MAX_MESSAGE),
        receipt: [
            'CAPSULE  ' + (toStr(c.openDate) || '--'),
            'SPAN     ' + (span.known ? span.label : SPAN_UNKNOWN_LABEL),
            'MOOD     ' + clampText(mood.filled ? mood.key : '', 12),
            'WITNESS  ' + receiptNote
        ].join(String.fromCharCode(10)),
        keywords: kws
    };
    const provided = {
        title: seg.title.length > 0,
        roleMessage: seg.roleMessage.length > 0,
        keywords: seg.keywords.length > 0,
        receiptNote: receiptNote !== '好好收下'
    };
    if (!provided.title) seg.title = defaultTitle;
    if (!provided.keywords) seg.keywords = [mood.key, '未来回声'];
    return {
        ok: true, reason: 'ok', segments: seg, provided: provided,
        fellBack: {
            title: !provided.title,
            keywords: !provided.keywords,
            witness: !provided.receiptNote
        },
        mood: mood, span: span, tone: tone,
        kind: isRole ? 'role' : 'self',
        source: toStr(raw.source) || 'pasted'
    };
}
/* ══════════════════ 提不调模型：本件只产「要求文本」 ══════════════════ */
/**
 * composeRequest(capsule) —— 拼一段可复制的「要模型产什么」文本。
 * 本件对源「自己调模型」那一块的替代：不替你发请求，
 * 只把**要求写清楚**（口径全部来自上面的真源表，不另写一套）。
 */
export function composeRequest(capsule) {
    const c = capsule || {};
    const span = spanOf(c);
    const tone = toneOf(c);
    const mood = moodOf(c);
    const kind = toStr(c.roleId) ? 'role' : 'self';
    const spanLine = span.known
        ? (span.label + '（' + span.days + '天）')
        : (SPAN_UNKNOWN_LABEL + '，不要猜（' + toStr(span.created) + ' / ' + toStr(span.open) + '）');
    const lines = [
        '请以下面的封存内容为基础，写一段拆信回信。',
        '',
        '【封存正文】' + (toStr(c.message) || '（缺）'),
        '【拆开日期】' + (toStr(c.openDate) || '（缺）'),
        '【跨度】' + spanLine,
        '【封存心情】' + (mood.filled ? mood.key : '未填写（不要当成填了默认值）'),
        '【口吻族】' + tone.label + ' —— ' + tone.feel,
        '【收信人】' + RECIPIENT_KINDS[kind].label + ' —— ' + RECIPIENT_KINDS[kind].why,
        '',
        '两条硬约束（违反即判不合格）：',
        '  1. 不许出现线下互动或送礼暗示（见面 / 送东西 / 请你吃喝之类一律不许）；',
        '  2. 不许给用户压力（必须 / 答应我 / 坚持下去 / 不要让…失望之类一律不许）。',
        '',
        '要四段：' + ECHO_SEGMENTS.join(' / ') + '。',
        'keywords 至多 ' + SOURCEBOOK_MAX_KEYWORDS + ' 个词。'
    ];
    return lines.join(String.fromCharCode(10));
}

/* ══════════════════ 读数面（视图不自己拼统计） ══════════════════ */
/**
 * sourcebookReadings(capsules, ledger) —— 跨度档分布 + 口吻族分布 +
 * 心情填写数 + 台账计数。源没有任何一处能回答
 * 「现在我存的信都在哪几档、都是什么腔」。
 */
export function sourcebookReadings(capsules, ledger) {
    const list = Array.isArray(capsules) ? capsules : [];
    const spanCounts = {};
    for (let i = 0; i < SPAN_BUCKETS.length; i += 1) spanCounts[SPAN_BUCKETS[i]] = 0;
    const toneCounts = {};
    for (let i = 0; i < TONE_TYPES.length; i += 1) toneCounts[TONE_TYPES[i]] = 0;
    let moodFilled = 0;
    let spanUnknown = 0;
    let createdMissing = 0;
    for (let i = 0; i < list.length; i += 1) {
        const c = list[i] || {};
        const sp = spanOf(c);
        if (sp.known) spanCounts[sp.bucket] += 1;
        else spanUnknown += 1;
        if (sp.created !== 'ok') createdMissing += 1;
        toneCounts[toneOf(c).type] += 1;
        if (moodOf(c).filled) moodFilled += 1;
    }
    const l = ledger || {};
    const receipts = Array.isArray(l.receipts) ? l.receipts : [];
    return {
        total: list.length,
        spanCounts: spanCounts,
        toneCounts: toneCounts,
        moodFilled: moodFilled,
        moodMissing: list.length - moodFilled,
        spanUnknown: spanUnknown,
        createdMissing: createdMissing,
        receipts: receipts.length,
        maxCapsules: SOURCEBOOK_MAX_CAPSULES,
        maxReceipts: SOURCEBOOK_MAX_RECEIPTS
    };
}

/** 台账面：把台账收成三态（视图据此分三种画法，不许塔成一种）。 */
export function ledgerFace(ledger) {
    if (!ledger) return SOURCEBOOK_FACES.storage_absent;
    const receipts = Array.isArray(ledger.receipts) ? ledger.receipts : [];
    if (receipts.length === 0) return SOURCEBOOK_FACES.empty;
    return SOURCEBOOK_FACES.ok;
}

export default {
    SPAN_BUCKETS, SPAN_META, TONE_TYPES, TONE_META, MOOD_FALLBACK,
    GUARD_REASONS, GUARD_KEYS, GUARD_FIELDS, ECHO_SEGMENTS, SPAN_UNKNOWN_LABEL,
    RECIPIENT_KINDS, RECIPIENT_KEYS, CREATED_STATES, CREATED_STATE_KEYS,
    SOURCEBOOK_FACES, SOURCEBOOK_MAX_CAPSULES, SOURCEBOOK_MAX_TITLE,
    SOURCEBOOK_MAX_MESSAGE, SOURCEBOOK_MAX_KEYWORDS,
    SOURCEBOOK_RECEIPT_WITNESS_MAX, SOURCEBOOK_MAX_RECEIPTS,
    parseOpenDate, dayNumber, daysBetween, spanBucket, spanLabel, spanOf,
    moodOf, toneOf, toneLabel, foldCapsules, normalizeCapsules,
    guardEcho, guardLabel, guardVocab, cleanText, inlineText, clampText,
    normalizeEcho, composeRequest, sourcebookReadings, ledgerFace
};
