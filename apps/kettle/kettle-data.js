/* ========================================================
 * kettle-data.js — [v3.40.0] 对话水壶 · 纯函数内核
 *
 * 缝合自小鼠机（nuo_sources/nuo3/xiaoshuji.html，6405117 字节 /
 * 112434 行单文件自包含）的「探店 / 约饭」一族（Tandan* 32 个函数 /
 * 源内 754 处命中）。★ 队列纪律：上一版（v3.39.0）已经把整份内联 JS
 * 抽成骨架（3.05MB / 2117 个函数），本版与同批三件共用那次侦察结论 ——
 * 不再重复解析源文件，只按块取。
 *
 * ── 源是什么 ──────────────────────────────────────────
 *   源把「两个人约在店里」做成一条带选择的对话链：
 *   ① 轮次计数（每轮把消息切好，数 assistant 有几条）；
 *   ② 时长分档（按轮次数报「短暂 / 一会儿 / 很久」）；
 *   ③ 选项协议（模型在末行给 `选项: A | B | C`，用户点一个继续）；
 *   ④ 场景标签（模型在首行给 `场景: 地点名`，用来画当前位置）；
 *   ⑤ 单字词（用户点一个单字，做成气泡）；
 *   ⑥ 长对话的破折号泛滥（源自己在旁白里插破折号）。
 *
 * ── 本件取哪几块（本件是治理层，不是生成层）──────────
 *   取 ①②③④⑤⑥ 的**治理面**：轮次分档 / 时长话术 / 选项裁切与去重 /
 *   场景标签 / 单字词登记 / 破折号体检 / 记录封包与读数。
 *   ★ 本件的立场差：**源是「替模型说话的那个」，本件是「把模型已经说的话收拾好」**。
 *
 * ── 四处不缝（源里有、本仓明令禁止或有第二个权威的，逐条写后果）──
 *   ① **不自己调模型**：源 fetchTandanDetailReply 从 localStorage 直读
 *      apiUrl / apiKey / selectedModel（密钥面）并自己拼 system prompt、
 *      自己走 SSE 流。本件**零网络零密钥**：只做「把回信收拾好」这一件事，
 *      生成由宿主出。缝进来就是把第二个模型出口塞进本仓。
 *   ② **不往对话里写楼层**：源 addTandanRecordToChat 直接调宿主
 *      `addMessage(roleId, 'received', record)` 把整段记录塞进会话。
 *      本件只产 `settleRecord()` 的**记录包**，写不写、由谁写归宿主。
 *   ③ **不碰宿主角色表 / 不读别的 App 的表**：源直读全局 `roles`、
 *      `getUserPersona()`、`currentChatRole`。本件自带发话人与参与者。
 *   ④ **不收外链、不落数据库**：源把壁纸走 IndexedDB（DesktopData）与
 *      头像 URL。本件零数据库、零 URL，落 PhoneStorage 三条会话键。
 *
 * ── 四条偏离（偏离不是遗漏，逐条写明）──
 *   ① **轮次算不出来不许与「说了很久」同形**：源
 *      `totalRounds <= 2 ? '短暂' : <= 5 ? '一会儿' : '很久'` ——
 *      rounds 是 NaN 时两个比较都为假、直接落「很久」；而 rounds 是 0
 *      （一条 assistant 都没有）时落「短暂」。于是**「根本没聊」与
 *      「聊了两句」同形**，**「数不出来」与「聊了很久」同形**。两处都反了。
 *      本件三态如实分开，数不出来返回 bucket=null。
 *   ② **单字语气词一律不保留**：源把用户点的单字（嗯 / 哦 / 啊）做成气泡，
 *      在源里 46 处命中。本仓口径是**单字气泡不保留**（审核与维护成本高、
 *      且它在正文里承担不了信息），故本件把它做成**登记读数**而不是保存项。
 *   ③ **选项要裁：不足三个与超过三个都不许当合**：源
 *      `split('|')` 后照单全收 —— 一个选项、八个选项、空选项都照样成条。
 *      本件给出三态（ok / too_few / too_many）并报去重后几条。
 *   ④ **破折号是一种读数，不是风格禁令**：源自己在旁白里插破折号（源内 276 处），
 *      长对话会积成一条线。本件只**体检 + 报最密的一段**，不替用户改写。
 *
 * ── 本套件守的静默失效形式（都不报错、不崩溃，只是结果不对）──
 *   · 轮次算不出来不许当成「聊了很久」；
 *   · 选项不足三个不许当成合格的一组；
 *   · 记录取不出来不许与「还没记过」同形；
 *   · 场景标签缺了不许把上一次的地点留着当这次；
 *   · 单字语气词不许被静默保存；
 *   · 破折号密度不许被静默当成「写得很好」。
 *
 * ── 实现纪律（本仓 v3.31 / v3.35 / v3.36 / v3.38 / v3.39 各踩过一次）──
 *   代码里不许出现会骗过状态机的裸引号：本仓判据共用的剥注释器是
 *   字符状态机、不解析正则字面量，正则里的裸引号会让它永久卡住。
 *   故本件禁用正则字面量：一律字串比对与单字扫描。
 * ======================================================== */
import { numOrNull } from '../../config/num-gate.js';

/* ---------- 真源表 ①：轮次三档（键面与校验白名单共用这一张） ---------- */
export const KETTLE_ROUND_BUCKETS = Object.freeze(['short', 'eventful', 'long']);
/* ★ 键面必须取真源数组的值（计算键），不许手写标识符形 ——
 *   本仓 J7 门禁（桥契约）判的就是这件事：手写键与真源值一旦错位，
 *   查不到就静默走兜底，多种处境显示成同一句话。 */
export const KETTLE_ROUND_META = Object.freeze({
    [KETTLE_ROUND_BUCKETS[0]]: { max: 2, label: '三言两语', why: '话没铺开，记录里只留关键的一句' },
    [KETTLE_ROUND_BUCKETS[1]]: { max: 5, label: '聊开了一会儿', why: '有来回，摘要要留住转身的那一下' },
    [KETTLE_ROUND_BUCKETS[2]]: { max: null, label: '坐下聊了很久', why: '信息量大，摘要要挑分歧点而不是全抄' }
});

/** 轮次取不出来时的人话（**单一份**：数据层拼读数、App 层拼话术、视图拼徽章都用这一句）。 */
export const KETTLE_ROUND_UNKNOWN = '轮次数不出来';

/* ---------- 真源表 ②：选项协议三态（源里只有「能拆开」和「拆不开」） ---------- */
export const KETTLE_OPTION_FACES = Object.freeze(['ok', 'too_few', 'too_many', 'absent']);
export const KETTLE_OPTION_FACE_TEXT = Object.freeze({
    [KETTLE_OPTION_FACES[0]]: '够三个选项，可以接着往下点',
    [KETTLE_OPTION_FACES[1]]: '不满三个选项，这轮只能干聊',
    [KETTLE_OPTION_FACES[2]]: '选项超过三个，模型没守格式',
    [KETTLE_OPTION_FACES[3]]: '这一轮没给选项'
});
export const KETTLE_OPTIONS_MIN = 3;
export const KETTLE_OPTIONS_MAX = 6;
export const KETTLE_OPTION_MAX_LEN = 24;

/* ---------- 真源表 ③：场景标签 ---------- */
export const KETTLE_SCENE_MAX_LEN = 12;
/** 场景标签的取值门（**不许沿用上一处地点**：源在解析失败时保留旧标签，
 *  于是「换到别处了」与「模型忘了标」在界面上同形）。 */
export const KETTLE_SCENE_STATES = Object.freeze(['ok', 'absent', 'malformed']);

/* ---------- 真源表 ④：单字语气词（本仓口径：登记，不保存） ---------- */
export const KETTLE_SOLO_CHARS = Object.freeze([
    '嗯', '哦', '啊', '欸', '咦', '唉', '唔', '喔', '诶', '哈'
]);
/** 单字语气词为什么不留（**单一份**：App 层记账、视图层说明、条目真源都取这一句）。 */
export const KETTLE_SOLO_WHY = '单字语气词在正文里承担不了信息，留着只会让审核与维护一直要盯着它';

/* ---------- 真源表 ⑤：破折号体检 ---------- */
export const KETTLE_DASH_CHAR = '—';
export const KETTLE_DASH_MAX_RUN = 2;      /* 一行里最多几个字符算正常（一处双破折号 = 2） */
export const KETTLE_DASH_LONG = 8;         /* 一行里超过这个字符数即「密」（四处双破折号） */
export const KETTLE_ASIDE_MAX_LEN = 6;
/** 去标点用的标点表（lone 判据用）。 */
export const KETTLE_PUNCT = '，。？！、；：—…～·,.?!;:~'     /* 源把括注限在 6 字 */

/* ---------- 真源表 ⑥：记录包与上限 ---------- */
export const KETTLE_MAX_NOTES = 40;
export const KETTLE_MAX_TEXT = 600;
export const KETTLE_MAX_SUMMARY = 120;
export const KETTLE_MAX_SNAPSHOT = 8;
export const KETTLE_SETTLE_REASONS = Object.freeze({
    no_note: { label: '没有一句可留下的正文', why: '源在这种情况下照旧封一条空记录' },
    no_partner: { label: '没有对面的人', why: '源的记录里角色名会是 undefined' },
    bad_rounds: { label: '轮次数不出来', why: '源会把它算成「聊了很久」' }
});

/* ---------- 真源表 ⑦：记录取值三态（源只有「有」与「当空」） ---------- */
export const KETTLE_NOTE_STATES = Object.freeze(['ok', 'absent', 'malformed']);

function toStr(v) {
    return (typeof v === 'string') ? v : '';
}

/** 标签体的取值范围：**到收尾符或本行末，先到者为准**。
 *  ★ 为什么不收到串尾：模型偶尔忘写收尾符，收到串尾会把后面几行正文吞进选项里，
 *    而那种吞并**不报错**（选项看着就是「大段文字」，用户点下去才发现）。 */
function tagBody(rest) {
    const s = toStr(rest);
    const close = s.indexOf(']');
    const eol = s.indexOf(String.fromCharCode(10));
    let end = s.length;
    if (close >= 0 && close < end) end = close;
    if (eol >= 0 && eol < end) end = eol;
    return s.slice(0, end);
}

function clampLen(s, max) {
    const t = toStr(s).trim();
    return t.length > max ? t.slice(0, max) : t;
}

/* ══════════════════ 轮次：不许把「数不出来」当成「聊了很久」 ══════════════════ */
/*
 * 源：totalRounds <= 2 ? 短暂 : totalRounds <= 5 ? 一会儿 : 很久
 *   · rounds = NaN ⇒ 两个比较都假 ⇒ 落「很久」（数不出来被说成聊了很久）
 *   · rounds = 0   ⇒ 落「短暂」（一条 assistant 都没有被说成三言两语）
 * 本件：非整数 / 零 / 负数 / 取不出来一律 not_count，bucket 为 null。
 */
export function roundBucketOf(rounds) {
    const n = numOrNull(rounds);
    if (n === null || !Number.isInteger(n) || n < 1) {
        return { ok: false, reason: 'not_count', bucket: null, rounds: null, label: KETTLE_ROUND_UNKNOWN };
    }
    let bucket = KETTLE_ROUND_BUCKETS[2];
    for (const k of KETTLE_ROUND_BUCKETS) {
        const max = KETTLE_ROUND_META[k].max;
        if (max !== null && n <= max) { bucket = k; break; }
    }
    return { ok: true, reason: 'ok', bucket: bucket, rounds: n, label: KETTLE_ROUND_META[bucket].label };
}

/** 从一条记录里数 assistant 条数（**唯一**的计数口：源在四处各数了一遍）。 */
export function countRounds(messages) {
    if (!Array.isArray(messages)) return null;
    let n = 0;
    for (const m of messages) {
        if (m && typeof m === 'object' && toStr(m.role) === 'assistant') n += 1;
    }
    return n;
}

/* ══════════════════ 选项：不足与超量都不许当合 ══════════════════ */
/*
 * 源：text.match(/[选项: ...]/) ⇒ split('|') ⇒ 照单全收。
 *   一个选项、八个选项、空串选项、重复选项全都能成条 —— 用户点下去才发现
 *   「只有一条路」或「六条里三条一样」。
 * 本件：去空白、去重复、封顶，并按条数给三态。
 */
export function parseOptions(text) {
    const raw = toStr(text);
    const open = '选项:';
    const i = raw.indexOf(open);
    if (i < 0) return { face: KETTLE_OPTION_FACES[3], items: [], dropped: 0, saw: '' };
    const rest = raw.slice(i + open.length);
    /* ★ 取值范围收在**本行内**：原版只看 ']'，而模型偶尔忘写收尾符 ——
     *   那时会把后面几行的正文整块吞成选项（且不报错）。 */
    const body = tagBody(rest).trim();
    if (!body) return { face: KETTLE_OPTION_FACES[3], items: [], dropped: 0, saw: body };
    const seen = [];
    let dropped = 0;
    for (const piece of body.split('|')) {
        const t = piece.trim().slice(0, KETTLE_OPTION_MAX_LEN);
        if (!t) { dropped += 1; continue; }
        if (seen.indexOf(t) >= 0) { dropped += 1; continue; }
        seen.push(t);
    }
    if (!seen.length) return { face: KETTLE_OPTION_FACES[3], items: [], dropped: dropped, saw: body };
    let face = KETTLE_OPTION_FACES[0];
    if (seen.length < KETTLE_OPTIONS_MIN) face = KETTLE_OPTION_FACES[1];
    else if (seen.length > KETTLE_OPTIONS_MAX) {
        face = KETTLE_OPTION_FACES[2];
        while (seen.length > KETTLE_OPTIONS_MAX) { seen.pop(); dropped += 1; }
    }
    return { face: face, items: seen, dropped: dropped, saw: body };
}

/**
 * 把用户贴回来的一整段对话拆成消息面。
 *
 * ★ 源在这里的形态：它假定自己手里已经是一个数组（`tandanDetailMessages`），
 *   于是「拆不出来」这件事在源里根本没有对应的报出方式 —— 分不出说话人的那几行
 *   会被当成对面说的话，轮次数因此虚高。本件把这类行单独报出来（unattributed）。
 *
 * 认法：拼串前缀里的名字与对面的人对上 ⇒ 那一行是对面说的话；对不上或没写前缀
 * ⇒ 归用户。前缀分隔符只认全角冒号与半角冒号（源也是这两种）。
 */
export function splitTranscript(text, partner) {
    const raw = toStr(text);
    const name = toStr(partner).trim();
    const lines = raw.split(String.fromCharCode(10));
    const messages = [];
    let unattributed = 0;
    for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        let cut = t.indexOf('：');
        const half = t.indexOf(':');
        if (cut < 0 || (half >= 0 && half < cut)) cut = half;
        /* 前缀过长就不当说话人（否则一句话里的冒号会把整行切成故事）。 */
        if (cut < 0 || cut > 12) {
            unattributed += 1;
            messages.push({ role: 'user', content: t });
            continue;
        }
        const who = t.slice(0, cut).trim();
        const body = t.slice(cut + 1).trim();
        const isPartner = !!name && (who === name || who.indexOf(name) >= 0);
        if (!isPartner) unattributed += 1;
        messages.push({ role: isPartner ? 'assistant' : 'user', content: body || t });
    }
    return { messages: messages, unattributed: unattributed, sawName: name };
}

/** 把选项段与场景段从正文里摘掉（源两处各写了一份，改一处忘一处）。
 *
 * ★ 两种形态都要处理，且**摘除范围不得超过本行**：
 *   · 方括号形态 `[选项: A | B | C]`（信封产的就是这个）⇒ 连括号整体摘掉；
 *   · 行内形态 `选项: A | B | C`（没收尾符）⇒ 只摘到**本行末**。
 *   原版写成「从标签处一直切到串尾」，于是在没有收尾符时会把后面几行的正文整块切光 ——
 *   而那种切光**不报错**（界面上就是一段正文凭空消失）。这里修掉的就是那一处。
 */
export function stripTags(text) {
    let s = toStr(text);
    for (const key of ['选项:', '场景:']) {
        let guard = 0;
        while (guard < 8) {
            guard += 1;
            const i = s.indexOf(key);
            if (i < 0) break;
            const open = s.lastIndexOf('[', i);
            const close = s.indexOf(']', i);
            const eol = s.indexOf(String.fromCharCode(10), i);
            const bracketForm = open >= 0 && s.slice(open + 1, i).trim() === ''
                && close >= 0 && (eol < 0 || close < eol);
            if (bracketForm) { s = s.slice(0, open) + s.slice(close + 1); continue; }
            const end = eol < 0 ? s.length : eol;
            s = s.slice(0, i) + s.slice(end);
        }
    }
    return s.trim();
}

/* ══════════════════ 场景：不许沿用上一次的地点 ══════════════════ */
export function parseScene(text) {
    const raw = toStr(text);
    const open = '场景:';
    const i = raw.indexOf(open);
    if (i < 0) return { state: KETTLE_SCENE_STATES[1], scene: '', saw: '' };
    const rest = raw.slice(i + open.length);
    /* 两种合法形态都接：方括号形 [场景: 汤铺] 与行内形「场景: 汤铺」。
     * 取值范围一律到收尾符或本行末（见 tagBody）。 */
    const body = tagBody(rest).trim();
    if (!body) return { state: KETTLE_SCENE_STATES[2], scene: '', saw: body };
    if (body.length > KETTLE_SCENE_MAX_LEN) {
        return { state: KETTLE_SCENE_STATES[2], scene: '', saw: body };
    }
    return { state: KETTLE_SCENE_STATES[0], scene: body, saw: body };
}

/* ══════════════════ 单字语气词：登记，不保存 ══════════════════ */
/*
 * 本仓口径（用户既定）：单字语气词气泡**不保留**。
 * 本函数把它变成一条**读数**：回信里出现几个、分别是哪几个，
 * 于是「模型这轮只回了一个字」这件事在台账面上看得见，而正文里不留它。
 */
export function soloRegister(text) {
    const s = toStr(text);
    const hits = [];
    for (let i = 0; i < s.length; i += 1) {
        const ch = s.charAt(i);
        if (KETTLE_SOLO_CHARS.indexOf(ch) >= 0) hits.push({ char: ch, at: i });
    }
    /* lone = 「这一句去掉空白与标点之后，只剩一个语气词」。
     * ★ 不能用「两侧有空格」来判：中文里本来就不写空格，那样判出来的永远是 0
     *   （正是本仓反复抓的「守卫写了但到不了位」那一族）。 */
    let bare = '';
    for (let k = 0; k < s.length; k += 1) {
        const w = s.charAt(k);
        if (w === ' ' || w === String.fromCharCode(10) || w === String.fromCharCode(9) || w === String.fromCharCode(13)) continue;
        bare += w;
    }
    let stripped = '';
    for (let k = 0; k < bare.length; k += 1) {
        if (KETTLE_PUNCT.indexOf(bare.charAt(k)) < 0) stripped += bare.charAt(k);
    }
    const lone = (stripped.length === 1 && KETTLE_SOLO_CHARS.indexOf(stripped) >= 0) ? 1 : 0;
    return { hits: hits.length, chars: hits.map((h) => h.char), lone: lone, canKeep: false };
}

/* ══════════════════ 破折号体检：是读数不是禁令 ══════════════════ */
export function dashAudit(text) {
    const raw = toStr(text);
    const lines = raw.split(String.fromCharCode(10));
    let total = 0;
    let worstRun = 0;
    let worstAt = -1;
    let longLines = 0;
    const runs = [];
    for (let i = 0; i < lines.length; i += 1) {
        let c = 0;
        for (let j = 0; j < lines[i].length; j += 1) {
            if (lines[i].charAt(j) === KETTLE_DASH_CHAR) c += 1;
        }
        if (c > 0) { runs.push({ line: i, count: c, len: lines[i].length }); total += c; }
        if (c > KETTLE_DASH_MAX_RUN) longLines += 1;
        if (c > worstRun) { worstRun = c; worstAt = i; }
    }
    const dense = worstRun > KETTLE_DASH_LONG;
    return {
        total: total,
        lines: runs.length,
        longLines: longLines,
        worstRun: worstRun,
        worstAt: worstAt,
        dense: dense,
        why: dense
            ? '有一段里破折号太密，读起来会像一直在插入话外音'
            : '破折号的密度在可读范围内'
    };
}

/* ══════════════════ 记录取值三态 ══════════════════ */
/*
 * 源：const allMessages = tandanDetailMessages.map(...)（假定一定拿到数组）
 *   · 一条记录都没有 ⇒ filter 出 0 ⇒ 「没聊」与「坏了」同形
 *   · 字段是坏 JSON ⇒ catch 后当空
 * 本件：可读 / 没写 / 写了但认不出来，三态各异其形。
 */
export function noteStateOf(value) {
    if (value === null || value === undefined || value === '') {
        return { state: KETTLE_NOTE_STATES[1], notes: [], saw: '' };
    }
    if (typeof value === 'string') {
        const t = value.trim();
        if (!t) return { state: KETTLE_NOTE_STATES[1], notes: [], saw: '' };
        try {
            const parsed = JSON.parse(t);
            /* ★ 本件落盘写的是**壳形** { notes: [...] }，故两种形态都要认：
             *   只认裸数组的话，每次落盘后重取都会被判成「认不出来」
             *   （这是本件首跑当场抳到的真缺陷：写得进去、读不出来，而且不报错）。 */
            const list = Array.isArray(parsed)
                ? parsed
                : ((parsed && typeof parsed === 'object' && Array.isArray(parsed.notes)) ? parsed.notes : null);
            if (!list) return { state: KETTLE_NOTE_STATES[2], notes: [], saw: t.slice(0, 40) };
            return { state: KETTLE_NOTE_STATES[0], notes: list, saw: '' };
        } catch (_e) {
            return { state: KETTLE_NOTE_STATES[2], notes: [], saw: t.slice(0, 40) };
        }
    }
    if (Array.isArray(value)) return { state: KETTLE_NOTE_STATES[0], notes: value, saw: '' };
    return { state: KETTLE_NOTE_STATES[2], notes: [], saw: String(value).slice(0, 40) };
}

/* ══════════════════ 封包：四因分野，不许塔成一个「有问题」 ══════════════════ */
/*
 * 源 addTandanRecordToChat 的封包口：
 *   · 一句正文都没有（tandanDetailMessages.length === 0）⇒ 直接 return（静默不封）
 *   · 有 message 但没 partner ⇒ roleName 落成 undefined，写进记录
 *   · rounds 数不出来 ⇒ 落「很久」
 * 本件把三种处境**各自报出**，并给出可读快照。
 */
export function settleRecord(record) {
    const r = (record && typeof record === 'object') ? record : {};
    const messages = Array.isArray(r.messages) ? r.messages : null;
    const reasons = [];
    if (!messages || !messages.length) reasons.push('no_note');
    const partner = clampLen(r.partner, 40);
    if (!partner) reasons.push('no_partner');
    /* ★ 「没有正文」与「有正文但轮次数不出来」是两件事，不许塔成一个：
     *   前者是「没东西可封」，后者是「有东西但读不懂」。源把两者都静默落一条残缺记录。 */
    const rounds = messages && messages.length ? countRounds(messages) : null;
    const bucket = roundBucketOf(rounds);
    if (messages && messages.length && !bucket.ok) reasons.push('bad_rounds');
    const firstLine = messages && messages.length
        ? clampLen(stripTags(toStr(messages[0] && messages[0].content)), KETTLE_MAX_SUMMARY)
        : '';
    return {
        ok: reasons.length === 0,
        reasons: reasons,
        labels: reasons.map((k) => KETTLE_SETTLE_REASONS[k].label),
        rounds: rounds,
        bucket: bucket.bucket,
        bucketLabel: bucket.label,
        partner: partner,
        shop: clampLen(r.shop, 40),
        firstLine: firstLine,
        snapshot: (messages || []).slice(0, KETTLE_MAX_SNAPSHOT).map((m) => ({
            role: clampLen(m && m.role, 12),
            text: clampLen(stripTags(toStr(m && m.content)), KETTLE_MAX_TEXT)
        }))
    };
}

/* ══════════════════ 交给生成侧的信封（**不是**在调模型） ══════════════════ */
/*
 * 源 buildTandanDetailSystemPrompt 直接把「场景 / 用户信息 / 文风 / 选项机制 /
 * 场景标签」五段拼成 system prompt 并自己发请求。
 * 本件只产一段**可复制的要求文本**：贴到用户自己惯用的对话端，
 * 由那边的模型回；回来再用 parseOptions / parseScene 收拾。
 */
export function composeEnvelope(role, opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const r = (role && typeof role === 'object') ? role : {};
    const name = clampLen(r.name, 40) || '对面的人';
    const persona = clampLen(r.persona, KETTLE_MAX_TEXT);
    const shop = clampLen(o.shop, 40) || '一家店';
    const style = clampLen(o.style, 120) || '日常白描，不堆形容词';
    const dialogueLimit = numOrNull(o.dialogueLimit);
    const lim = (dialogueLimit === null || dialogueLimit < 1) ? 500 : Math.min(Math.round(dialogueLimit), 2000);
    const parts = [];
    parts.push('接下来的对话发生在「' + shop + '」，你们是面对面，不是隔着屏幕。');
    if (persona) parts.push('关于' + name + '：' + persona);
    parts.push('文风：' + style + '。单段对白不超过 ' + lim + ' 字，动作与表情写在圆括号里（括注不超过 ' + KETTLE_ASIDE_MAX_LEN + ' 字）。');
    parts.push('旁白用第三人称，用「' + name + '」称呼自己，不要在旁白里写「我」。');
    parts.push('每次回信末行给三个走向不同的选项，独占一行，写成：[选项: A | B | C]');
    parts.push('每次回信首行给当前所在地点，写成：[场景: 地点]（二到四个字，换地方就改）。');
    parts.push('不要使用单字语气词当整句回信；不要堆破折号。');
    return parts.join(String.fromCharCode(10));
}

/* ══════════════════ 读数面（视图不自己拼统计） ══════════════════ */
export function kettleReadings(notes, opts) {
    const arr = Array.isArray(notes) ? notes : [];
    const perBucket = {};
    for (const k of KETTLE_ROUND_BUCKETS) perBucket[k] = 0;
    let unknown = 0;
    let solo = 0;
    let dashy = 0;
    for (const n of arr) {
        const b = roundBucketOf(n && n.rounds);
        if (!b.ok) unknown += 1;
        else perBucket[b.bucket] += 1;
        if (numOrNull(n && n.soloHits) !== null && numOrNull(n && n.soloHits) > 0) solo += 1;
        if (n && n.dashDense === true) dashy += 1;
    }
    const o = (opts && typeof opts === 'object') ? opts : {};
    return {
        total: arr.length,
        perBucket: perBucket,
        unknownRounds: unknown,
        withSolo: solo,
        withDenseDash: dashy,
        cap: numOrNull(o.cap) === null ? KETTLE_MAX_NOTES : numOrNull(o.cap),
        trimmed: arr.length > KETTLE_MAX_NOTES
    };
}

/* ---------- 真源表 ⑧：取数四态（视图键面与校验白名单共用） ----------
 * ★ 四态而不是三态，是因为本件守的那条里有一格是**源画不出来的**：
 *   「这一格写了内容、但内容认不出来」（坏 JSON / 不是对象）与「这一格没写过」
 *   在源里都落成空列表 ⇒ 用户看着空界面，不知道该去补写、还是该去修那格坏数据。
 *   第四态就是为这条存在的（noteStateOf 判它，face 面如实报出）。
 */
export const KETTLE_FACES = Object.freeze(['ok', 'empty', 'malformed', 'storage_absent']);
export const KETTLE_FACE_TEXT = Object.freeze({
    [KETTLE_FACES[0]]: '记录读得到',
    [KETTLE_FACES[1]]: '还没有记过一条',
    [KETTLE_FACES[2]]: '这一格写了东西但认不出来（不是「还没记过」）',
    [KETTLE_FACES[3]]: '存储读不出来（不是「还没记过」）'
});

/** 取数归因：**「一条都没有」/「写了但认不出来」/「取不出来」三态不许同形**。
 *  源这三者在界面上全是空列表。 */
export function ledgerFace(total, storageOk, malformed) {
    if (!storageOk) return KETTLE_FACES[3];
    if (malformed) return KETTLE_FACES[2];
    if (!total) return KETTLE_FACES[1];
    return KETTLE_FACES[0];
}
