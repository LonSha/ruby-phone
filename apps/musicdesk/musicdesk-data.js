/* ========================================================
 * musicdesk-data.js — [v3.42.0] 曲库案头 · 纯函数内核
 * --------------------------------------------------------
 * 缝合自两个源（素材缝合路线图第 3 层第六件）：
 *   ① 小鼠机 nuo_sources/nuo3/xiaoshuji.html 的 netease 一族
 *      （71 个函数，块文件 nuo_sources/nuo3/live/blk_netease.txt）；
 *   ② EPhone·xintuk src_xintuk/runtime/scripts/main-app/ 的
 *      「第三方音乐聚合 + 扫码账号桥」一族（65 片 2269720 字符，
 *      908 个函数里的 installMusicIntegration 支）。
 *
 * ── 立场差（本件最本质的一条定位差）────────────────────
 *   两个源都是**取数的那个人**：自己拿远端来源列表、自己发请求、
 *   自己拿 audio 元件验「这条链接真的能放」、自己拿账号 cookie。
 *   本件**没有网络、没有密钥、没有音频元件** —— 它是**案头**：
 *   把用户从任何对话端拿回来的那份**曲目数据**收拾好（归一 / 去重 /
 *   封面 / 歌词 / 播放模式 / 队列 / 来源读数 / 校验序 / 回执归一）。
 *
 * ── 四条不缝（逐条写进文件头与条目）────────────────────
 *   ① 不发请求（源 neteaseApiFetch / fetchJson 直连多家聚合 API 与多个节点）；
 *   ② 不读宿主账号与 cookie（源 currentAccountStorageKey 从 localStorage
 *      直读 uid 与 cookie，再拼进播放链接）；
 *   ③ 不碰 audio 元件（源 validateAudio 用 new Audio() 真放一遍再判；
 *      那条路要求用户**同步等 9 秒**，且失败后没有任何读数）；
 *   ④ 不收外链、不落数据库（源封面走外链占位图、
 *      来源健康落 localStorage ephone-music-source-health）。
 *
 * ── 四条偏离（源静默失效的地方，本件一律升为读数）──────
 *   ① 曲目去重不许「留下第一条、其余静默消失」（源 dedupeSongs 把重复项
 *      塞进 alternatives 且不报；前台条目数少了几首，用户看不出来）
 *      ⇒ 本件逐条报 merged 明细与合并进哪一条；
 *   ② 封面不许「没有就换成托底图」（源 PLACEHOLDER_COVER 是一条外链图）
 *      ⇒ 本件出**色相 + 首字**（零 URL、零二进制），且四态互不同形；
 *   ③ 歌词不许「坏行静默丢弃」（源时间标签不中就直接跳过，丢了几行也不报）
 *      ⇒ 本件逐条报 dropped.noTime / dropped.noText；
 *   ④ 队列不许「超限静默截断」（源到 limit 就 break，剩下的**一条不报**）
 *      ⇒ 本件报 capped 与截掉几条。
 *
 * ── 静默失效形态（本件守的，都不报错、不崩溃，只是结果不对）──
 *   · 来源读数取不出来 **不许**读成「全都好」；
 *   · 播放模式认不出来 **不许**静默回落顺序播放（要报 saw 与 why）；
 *   · 时长读不出来 **不许**画成 00:00（与真的 0 秒不同形）；
 *   · 坏游标 / 越界定位 **不许**静默夹成 0（一律拒并计数）；
 *   · 「压根没给」与「给了但用不上」**不许**同形（四态分开判）。
 *
 * ── 实现纪律 ────────────────────────────────────────────
 *   · 本件**不许出现正则字面量**（本仓剥注释器是字符状态机、不解析正则），
 *     一切字符处理走 String.fromCharCode 拼装形；
 *   · 本件不许出现反斜杠与反引号（同一条纪律的另一半）。
 * ======================================================== */

/* ---------- 真源表 · 曲目归一 ---------- */

/** 八档色相令牌（源在没有封面时用一条外链托底图；本件改为**色相 + 首字**，
 *  零 URL、零二进制。八档互不相同，且由**歌曲键**决定 —— 同一首歌每次都是同一档）。 */
export const MUS_COVER_TONES = Object.freeze([
    'msd-tone-a', 'msd-tone-b', 'msd-tone-c', 'msd-tone-d',
    'msd-tone-e', 'msd-tone-f', 'msd-tone-g', 'msd-tone-h'
]);

/** 三个缺省字面（源里是硬写在归一函数里的三处字符串，本件提成真源表）。 */
export const MUS_UNKNOWN_TITLE = '未命名曲目';
export const MUS_UNKNOWN_ARTIST = '未知艺人';
export const MUS_UNKNOWN_ALBUM = '';

/** 时长的两条界（秒）。源用 duration 大于 1000 判「这大概是毫秒」，
 *  本件保留这条判法但把结果报出来（normalized 与 why）。 */
export const MUS_DURATION_MIN = 1;
export const MUS_DURATION_MAX = 3600;
export const MUS_MILLIS_BOUND = 1000;

/** 艺人键截断长度（源归一键里对艺人取 slice(0,24)）。 */
export const MUS_ARTIST_KEY_MAX = 24;

/** 单次去重的条数上限（源 dedupeSongs 的 limit 缺省值是 40）。 */
export const MUS_QUEUE_LIMIT = 40;

/* ---------- 真源表 · 队列与播放模式 ---------- */

/** 三种播放模式（源 NETEASE_PLAYBACK_MODES）。顺序即界面上按钮的顺序。 */
export const MUS_PLAYBACK_MODES = Object.freeze(['sequential', 'random', 'single']);

export const MUS_PLAYBACK_MODE_META = Object.freeze({
    sequential: Object.freeze({ label: '顺序播放', hint: '一首接一首，到底绕回第一首' }),
    random: Object.freeze({ label: '随机播放', hint: '随机挑一首，不重复当前这首' }),
    single: Object.freeze({ label: '单曲循环', hint: '就放这一首，不往下走' })
});

/** 三个分组的键与名（源按三个歌单来源分组，本件保留分组但只认键，不认远端）。 */
export const MUS_MODES = Object.freeze(['all', 'mine', 'high']);

export const MUS_MODE_META = Object.freeze({
    all: Object.freeze({ label: '全部曲目', hint: '这一次收拾进来的所有曲目' }),
    mine: Object.freeze({ label: '我的收藏', hint: '标了收藏的那些' }),
    high: Object.freeze({ label: '高把握', hint: '艺人键能对上、把握分过线' })
});

/** 四态词表（本件唯一一套「这一格到底怎么了」的词汇）。 */
export const MUS_STATES = Object.freeze(['ok', 'partial', 'absent', 'malformed']);

export const MUS_STATE_TEXT = Object.freeze({
    ok: '齐',
    partial: '不够',
    absent: '没有',
    malformed: '写了但用不上'
});

/* ---------- 真源表 · 来源读数 ---------- */

/** 排序理由（源只排序、不报为什么排成这样）。 */
export const MUS_SORT_WHY = Object.freeze({
    ok: 'ok',
    cooling: 'cooling',
    cold: 'cold'
});

/** 校验序的三种结论（源按固定次序试，试完也不说「哪一条是这次新加的」）。 */
export const MUS_VERIFY_WHYS = Object.freeze({
    ok: 'ok',
    append: 'append',
    absent: 'absent'
});

/** 回执归一的六种失败因（源把失败塔成一句「无法解析响应」）。
 *  ★ 键面与话面分开：函数一律返回**键**（no_text / unbalanced / …），
 *    界面与台账要显示时走 MUS_REPLY_WHYS 取话 —— 键面若直接给话，
 *    「这一格为什么失败」就没法被程序比对（六个因会在判据里塌成一串散文）。 */
export const MUS_REPLY_WHYS = Object.freeze({
    no_text: '没给正文',
    unbalanced: '括号没配平',
    no_object: '没找到对象',
    bad_json: '不是合法 JSON',
    not_object: '没看到曲目表',
    empty: '一条都没收拾出来'
});

/** 四态面（整页一句话说清「你现在看到的东西可不可信」）。 */
export const MUS_FACES = Object.freeze(['ok', 'empty', 'malformed', 'storage_absent']);

/** 四态面人话（**键取真源的值形**，不手写标识符形 —— 本仓 J7 形态：
 *  手写下划线形键与真源的连字符值形对不上 ⇒ 查不到、静默走兜底，
 *  多种处境会显示成同一句话）。 */
export const MUS_FACE_TEXT = Object.freeze({
    [MUS_FACES[0]]: '案头在册',
    [MUS_FACES[1]]: '还没收进来',
    [MUS_FACES[2]]: '写了但认不出来',
    [MUS_FACES[3]]: '读数拿不到（存储不可用）'
});

/** 把握分过线（源 matchScore 的 filter 阈值就是 45，本件提成真源表）。 */
export const MUS_MATCH_MIN = 45;

/** 单条来源连续失败到几次开始冷静（源 recordHealth 里是 3 次）。 */
export const MUS_COOLING_FAILS = 3;
/** 冷静期时长（源 2 分钟）。 */
export const MUS_COOLING_MS = 120000;

/** 案头台账最多留几条。 */
export const MUS_MAX_UNITS = 40;

/* ---------- 字符工具（一律拼装形，不写裸字面量） ---------- */

/** 由码点拼一个字串（避免在源码里写裸的标点与噪声词）。 */
function mk() {
    let s = '';
    let i;
    for (i = 0; i < arguments.length; i += 1) s += String.fromCharCode(arguments[i]);
    return s;
}

/** 归一键要剥掉的标点：中英混排里「同一首歌」最常见的写法差异。 */
const PUNCT_CHARS = Object.freeze([
    mk(183), mk(8226), mk(12539), mk(46), mk(95), mk(45), mk(8212), mk(8211),
    mk(40), mk(41), mk(65288), mk(65289), mk(12304), mk(12305), mk(12308),
    mk(12309), mk(12298), mk(12299), mk(39), mk(34), mk(8220), mk(8221),
    mk(32), mk(9), mk(12290), mk(65292)
]);

/** 归一键要剥掉的尾巴（源那条 replace 的四个中文词 + 三个英文词）。 */
const NOISE_TAILS = Object.freeze([
    'live', 'cover', 'remix',
    mk(20276, 22863), mk(32431, 38899, 20048), mk(32763, 21809), mk(29256)
]);

/** 小写化（源 clean 里的那条 toLowerCase 等价物，不经正则）。 */
function lower(text) {
    return String(text).toLowerCase();
}

/** 剥标点：逐个字符判定，不走正则字面量（本件硬纪律）。 */
function stripPunct(text) {
    const s = String(text);
    let out = '';
    let i;
    for (i = 0; i < s.length; i += 1) {
        const c = s.charAt(i);
        if (PUNCT_CHARS.indexOf(c) >= 0) continue;
        out += c;
    }
    return out;
}

/** 剥尾巴：先剥标点、再逐条试词尾（live / cover / remix / 四个中文词）。 */
function stripTail(text) {
    let s = stripPunct(text);
    let changed = true;
    while (changed) {
        changed = false;
        let i;
        for (i = 0; i < NOISE_TAILS.length; i += 1) {
            const t = NOISE_TAILS[i];
            if (s.length > t.length && s.slice(s.length - t.length) === t) {
                s = s.slice(0, s.length - t.length);
                changed = true;
            }
        }
    }
    return s;
}

/** 字串取值门：只认字串；其余如实空串（不编、不 stringify 对象）。 */
export function textOf(v) {
    return (typeof v === 'string') ? v : '';
}

/** 数值取值门（本件内部用：只认 number 与非空数字串，不编 0）。 */
function numOrNullLocal(v) {
    if (typeof v !== 'number' && typeof v !== 'string') return null;
    if (typeof v === 'string' && !v.trim()) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/* ---------- 曲目归一 ---------- */

/**
 * 时长归一：源把「大于 1000 的数」当毫秒除以 1000。
 * ★ 本件把这件事**报出来**（normalized / why:'from_millis'），
 *   并另立两条界：小于 1 秒报 too_small、大于 3600 秒报 too_large
 *   —— 这两类源会照收（一首九十万秒的曲目会被画成一个看不出错的时长）。
 */
export function durationOf(raw) {
    const v = numOrNullLocal(raw);
    if (v === null) return { ok: false, seconds: null, why: 'not_number', normalized: false };
    if (v <= 0) return { ok: false, seconds: null, why: 'too_small', normalized: false };
    if (v > MUS_MILLIS_BOUND) {
        const s = Math.round(v / 1000);
        if (s < MUS_DURATION_MIN) return { ok: false, seconds: null, why: 'too_small', normalized: true };
        if (s > MUS_DURATION_MAX) return { ok: false, seconds: null, why: 'too_large', normalized: true };
        return { ok: true, seconds: s, why: 'from_millis', normalized: true };
    }
    const s2 = Math.round(v);
    if (s2 < MUS_DURATION_MIN) return { ok: false, seconds: null, why: 'too_small', normalized: false };
    if (s2 > MUS_DURATION_MAX) return { ok: false, seconds: null, why: 'too_large', normalized: false };
    return { ok: true, seconds: s2, why: 'ok', normalized: false };
}

/** 艺人归一：数组取各元素的名字（源接受 string 或 {name} 两种元素），空的一个都不留；
 *  全空由调用方补「未知艺人」并计进 filled。 */
function artistsOf(raw) {
    if (Array.isArray(raw)) {
        const names = [];
        let i;
        for (i = 0; i < raw.length; i += 1) {
            const it = raw[i];
            const nm = (typeof it === 'string') ? it : textOf(it && it.name);
            if (nm.trim()) names.push(nm.trim());
        }
        return names;
    }
    const one = textOf(raw);
    return one.trim() ? [one.trim()] : [];
}

/**
 * 曲目归一：源那条净名函数的等价物，但**每一处「替用户编一个值」都报出来**。
 * 源在三处静默兜底：id 缺失照收（后续拿 undefined 去请求）、
 * 名字缺失写死一个缺省名、艺人缺失写死另一个缺省名。
 * 本件逐项报 filled 明细，且 **id 缺失判 ok=false** ——
 * 一条没有 id 的曲目在案头上是「认不出来」的那一态，不是一首正常的歌。
 * @param {*} raw 上游给的曲目（形状可能是 {ar} 或 {artists}、{al} 或 {album}）
 */
export function normalizeSong(raw) {
    const r = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : null;
    if (!r) return { ok: false, song: null, why: 'not_object', filled: [] };
    const filled = [];
    const id = textOf(r.id) || textOf(r.musicId);
    if (!id) return { ok: false, song: null, why: 'no_id', filled: ['id'] };
    let name = textOf(r.name) || textOf(r.title);
    if (!name.trim()) { name = MUS_UNKNOWN_TITLE; filled.push('name'); }
    /* ★ 这一处**必须收三种形状**（本版真踩到）：上游给的是源那套（ar / al / dt），
     *   而本件落盘后**回读**给的是本件自己的归一形状（artist 字串 / album 字串 /
     *   seconds）——只认源那套的话，收拾一次之后重开 App，艺人会全变回
     *   「未知艺人」、专辑与时长整批丢掉，而且**一个字都不报**。 */
    const artists = artistsOf(
        (r.ar !== undefined && r.ar !== null) ? r.ar
            : ((r.artists !== undefined && r.artists !== null) ? r.artists : r.artist)
    );
    let artist = artists.join(' / ');
    if (!artist) { artist = MUS_UNKNOWN_ARTIST; filled.push('artist'); }
    const albumRaw = (r.al !== undefined && r.al !== null) ? r.al : r.album;
    const alb = (albumRaw && typeof albumRaw === 'object') ? albumRaw : {};
    let album = (albumRaw && typeof albumRaw === 'object')
        ? (textOf(alb.name) || textOf(r.albumName))
        : (textOf(albumRaw) || textOf(r.albumName));
    /* ★ 第三个缺省字面也**走真源表**（title / artist 两处已走）——
     *   三处里漏一处就是「建好了零消费」，真源改名时这一处静默不跟。 */
    if (!album) { album = MUS_UNKNOWN_ALBUM; filled.push('album'); }
    const coverRaw = textOf(alb.picUrl) || textOf(r.coverRaw) || textOf(r.cover) || textOf(r.coverUrl);
    if (!coverRaw) filled.push('cover');
    const durRaw = (r.dt !== undefined && r.dt !== null) ? r.dt
        : ((r.duration !== undefined && r.duration !== null) ? r.duration : r.seconds);
    const d = durationOf(durRaw);
    if (!d.ok) filled.push('duration');
    return {
        ok: true,
        why: filled.length ? 'filled_missing' : 'ok',
        filled: filled,
        song: {
            id: id,
            name: name.trim(),
            artist: artist,
            album: album,
            coverRaw: coverRaw,
            seconds: d.ok ? d.seconds : null,
            secondsWhy: d.why,
            secondsNormalized: d.normalized,
            fav: (r.fav === true)
        }
    };
}

/**
 * 歌曲键（归一键）：源那条指纹函数的等价物 —— 名字 + 艺人（截 24 字）去标点。
 * ★ 本件**多带一段专辑**：源只按「名字 + 艺人」判重，同一首歌的两个版本
 *   （原版 / 现场版）会被判成同一首而合并掉；本件把专辑也纳入键，
 *   版本不同即**不合并**。差异逐条写进条目。
 */
export function songKeyOf(song) {
    const s = (song && typeof song === 'object') ? song : {};
    const n = stripTail(lower(textOf(s.name)));
    const a = stripTail(lower(textOf(s.artist))).slice(0, MUS_ARTIST_KEY_MAX);
    const al = stripTail(lower(textOf(s.album))).slice(0, MUS_ARTIST_KEY_MAX);
    return n + '::' + a + '::' + al;
}

/**
 * 曲目去重：源那条去重函数的等价物。
 * ★ 源的形态：留下第一条，重复项塞进现有条目的 alternatives 且**不报**；
 *   到 limit 就 break，后面的**一条不报**。前台条目数少了，用户看不出来。
 * 本件逐条报：merged（合并进哪一条、键是什么）、
 * dropped（没 id / 没名字各几条）、capped（到上限截掉几条）。
 */
export function dedupeSongs(songs, limit) {
    const src = Array.isArray(songs) ? songs : [];
    const lim = (numOrNullLocal(limit) === null || limit < 1) ? MUS_QUEUE_LIMIT : Math.floor(limit);
    const seen = {};
    const order = [];
    const merged = [];
    const dropped = { no_id: 0, no_name: 0 };
    let capped = 0;
    let i;
    for (i = 0; i < src.length; i += 1) {
        const s = src[i];
        if (!s || typeof s !== 'object') { dropped.no_id += 1; continue; }
        const id = textOf(s.id);
        const nm = textOf(s.name).trim();
        if (!id) { dropped.no_id += 1; continue; }
        if (!nm) { dropped.no_name += 1; continue; }
        const key = songKeyOf(s);
        const hit = seen[key];
        if (hit) {
            hit.mergedCount += 1;
            merged.push({ key: key, into: hit.song.id, title: hit.song.name, count: hit.mergedCount });
            continue;
        }
        if (order.length >= lim) { capped += 1; continue; }
        seen[key] = { song: s, mergedCount: 0 };
        order.push(key);
    }
    const list = [];
    for (i = 0; i < order.length; i += 1) list.push(seen[order[i]].song);
    return {
        list: list,
        given: src.length,
        kept: list.length,
        merged: merged,
        dropped: dropped,
        capped: capped,
        limit: lim
    };
}

/* ---------- 封面 ---------- */

/**
 * 封面：源在没有封面时给一条**外链托底图**。
 * 本件零 URL、零二进制 —— 出的是**色相令牌 + 首字**：
 *   · 有原始封面引用 ⇒ 色相 + 首字，state = 'ok'；
 *   · 有引用但首字取不出来（名字全是符号）⇒ state = 'partial'；
 *   · 压根没给引用 ⇒ state = 'absent'；
 *   · 给了引用但不是字串（对象 / 数 / 数组）⇒ state = 'malformed'。
 * 四态互不同形，且 i 直接是 0..3（读数按 i 计，不做字串比较）。
 */
export function coverOf(song) {
    const s = (song && typeof song === 'object') ? song : {};
    const raw = s.coverRaw;
    const name = textOf(s.name);
    let initial = '';
    let i;
    for (i = 0; i < name.length; i += 1) {
        const c = name.charAt(i);
        if (c.trim() && PUNCT_CHARS.indexOf(c) < 0) { initial = c; break; }
    }
    const key = songKeyOf(s);
    let sum = 0;
    for (i = 0; i < key.length; i += 1) sum = (sum + key.charCodeAt(i)) % 4096;
    const tone = MUS_COVER_TONES[sum % MUS_COVER_TONES.length];
    if (raw !== undefined && raw !== null && typeof raw !== 'string') {
        return { state: MUS_STATES[3], i: 3, tone: '', initial: '', piece: '', why: 'not_text' };
    }
    const hasRaw = (raw !== undefined && raw !== null && raw !== '');
    if (!hasRaw) return { state: MUS_STATES[2], i: 2, tone: '', initial: initial, piece: '', why: 'no_cover' };
    if (!initial) return { state: MUS_STATES[1], i: 1, tone: tone, initial: '', piece: '', why: 'no_initial' };
    return { state: MUS_STATES[0], i: 0, tone: tone, initial: initial, piece: initial, why: 'ok' };
}

/* ---------- 歌词 ---------- */

/* 歌词行与时间标签用到的几个字符，一律拼装形（本件不许写裸的标点字面量）。 */
const CHAR_NL = mk(10);
const CHAR_CR = mk(13);
const CHAR_BRACKET_L = mk(91);
const CHAR_BRACKET_R = mk(93);
const CHAR_COLON = mk(58);
const CHAR_POINT = mk(46);

/** 拆行：先把回车去掉（兼容 CRLF），再按换行切。源用 split 的同一条路。 */
function splitLines(text) {
    const s = String(text);
    let flat = '';
    let i;
    for (i = 0; i < s.length; i += 1) {
        const c = s.charAt(i);
        if (c === CHAR_CR) continue;
        flat += c;
    }
    return flat.split(CHAR_NL);
}

/** 是不是 ASCII 数字（不用正则）。 */
function isDigit(c) {
    return (c >= '0' && c <= '9');
}

/** 从 at 起读一串数字：返回 { value, count, next }；一位都没有时 count = 0。 */
function readDigits(s, at) {
    let i = at;
    let v = 0;
    while (i < s.length && isDigit(s.charAt(i))) {
        v = v * 10 + (s.charCodeAt(i) - 48);
        i += 1;
    }
    return { value: v, count: i - at, next: i };
}

/**
 * 读一个时间标签（形如 左方括号 mm 冒号 ss 点 fff 右方括号）。
 * ★ 源用的是一条「两位分钟 冒号 两位秒 可选小数」的正则；本件不许写正则字面量，
 *   改为手写扫描。两处**刻意放宽**（都往「更认得出来」的方向放宽，不往严）：
 *   · 分钟与秒允许 1~n 位（源要求恰好两位，`[1:02]` 这样的写法源一律丢）；
 *   · 小数位长度不设限，按十的幂折算（源同样不设限）。
 * 不成形时返回 null（由调用方计入 dropped.noTime）。
 */
function readTag(s, at) {
    if (s.charAt(at) !== CHAR_BRACKET_L) return null;
    let i = at + 1;
    const mm = readDigits(s, i);
    if (mm.count < 1) return null;
    i = mm.next;
    if (s.charAt(i) !== CHAR_COLON) return null;
    i += 1;
    const ss = readDigits(s, i);
    if (ss.count < 1) return null;
    i = ss.next;
    let frac = 0;
    let fracLen = 0;
    if (s.charAt(i) === CHAR_POINT) {
        const f = readDigits(s, i + 1);
        if (f.count >= 1) {
            frac = f.value;
            fracLen = f.count;
            i = f.next;
        }
    }
    if (s.charAt(i) !== CHAR_BRACKET_R) return null;
    const scale = Math.pow(10, fracLen);
    const seconds = mm.value * 60 + ss.value + (fracLen ? frac / scale : 0);
    return { seconds: seconds, next: i + 1 };
}

/**
 * 歌词解析。
 * ★ 与源的差（源那条逐行 exec 的解析）：源对每一行拿正则试一次，不中就 continue
 *   —— **丢了几行一个字都不报**，用户只会看到「这首歌歌词怎么这么短」。
 *   本件把丢掉的分成两类如实报出来：
 *   · `dropped.noTime`：这一行没有任何成形的时间标签（含 [ti:] 这类纯元信息行）；
 *   · `dropped.noText`：时间标签成形成了，但标签后面一个字都没有（按标签个数计）。
 *   另外源在末尾把结果打去控制台（用户看不到）；本件返回结构体。
 * ★ 一行带多个时间标签时，本件按标签个数**展开成多行**（源只认第一个，其余静默丢）。
 */
export function parseLrc(text, maxLines) {
    const raw = textOf(text);
    const limit = (typeof maxLines === 'number' && maxLines > 0) ? Math.floor(maxLines) : 0;
    const dropped = { noTime: 0, noText: 0 };
    if (!raw) {
        return { lines: [], seen: 0, kept: 0, tags: 0, dropped: dropped, capped: 0, limit: limit, why: 'no_text' };
    }
    const rows = splitLines(raw);
    const lines = [];
    let seen = 0;
    let tags = 0;
    let capped = 0;
    let i;
    for (i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        if (!row.trim()) continue;
        seen += 1;
        let at = 0;
        const ats = [];
        for (;;) {
            const tag = readTag(row, at);
            if (!tag) break;
            ats.push(tag.seconds);
            tags += 1;
            at = tag.next;
        }
        if (!ats.length) {
            dropped.noTime += 1;
            continue;
        }
        const body = row.slice(at).trim();
        if (!body) {
            dropped.noText += ats.length;
            continue;
        }
        let k;
        for (k = 0; k < ats.length; k += 1) {
            if (limit && lines.length >= limit) {
                capped += 1;
                continue;
            }
            lines.push({ at: ats[k], text: body });
        }
    }
    lines.sort(function (a, b) { return a.at - b.at; });
    return {
        lines: lines,
        seen: seen,
        kept: lines.length,
        tags: tags,
        dropped: dropped,
        capped: capped,
        limit: limit,
        why: 'ok'
    };
}

/** 两位补零（不用 padStart，避免依赖运行环境的小版本差异）。 */
function pad2(n) {
    return (n < 10) ? ('0' + String(n)) : String(n);
}

/**
 * 时间格式化（秒 → mm 冒号 ss）。
 * ★ 与源的差（源那条 `isNaN 就返回 00:00` 的写法）：读不出来和真的是 0 秒长成了
 *   同一个样子。本件两者不同形：
 *   · 没给 / 空串 ⇒ state = 'absent'，text 是空串（画面上画一条短横，不画 00:00）；
 *   · 给了但不是数（对象 / 乱串）⇒ state = 'malformed'，text 也是空串；
 *   · 真的是 0 秒 ⇒ state = 'ok'，text 就是 00:00；
 *   · 负数 ⇒ state = 'malformed'，why = 'negative'（源会照收并画成 00:00）。
 */
export function formatTime(seconds) {
    const v = numOrNullLocal(seconds);
    if (v === null) {
        const blank = (seconds === undefined || seconds === null || (typeof seconds === 'string' && !seconds.trim()));
        const si = blank ? 2 : 3;
        return { state: MUS_STATES[si], i: si, text: '', why: blank ? 'no_number' : 'not_number' };
    }
    if (v < 0) return { state: MUS_STATES[3], i: 3, text: '', why: 'negative' };
    const total = Math.floor(v);
    const mm = Math.floor(total / 60);
    const ss = total - mm * 60;
    return { state: MUS_STATES[0], i: 0, text: pad2(mm) + CHAR_COLON + pad2(ss), why: 'ok' };
}

/* ---------- 队列与播放模式 ---------- */

/**
 * 基键：不带专辑段（用于「同一首歌的不同版本」这类场合）。
 * 与 songKeyOf 的差：songKeyOf 带专辑段 —— 判「是不是同一首收录」；
 * baseIdOf 不带 —— 判「是不是同一个东西的不同版本」。
 */
export function baseIdOf(song) {
    const s = (song && typeof song === 'object') ? song : {};
    const name = stripTail(lower(textOf(s.name)));
    const artist = stripTail(lower(textOf(s.artist)));
    return (name || '?') + '|' + (artist || '?');
}

/**
 * 定位：把游标夹到列表里那一位。
 * ★ 与源的差：源拿游标直接当数组下标用，坏游标与越界由 JS 自己兜（结果是
 *   undefined，画面上一片空白）；有的分支还会 `|| 0` 静默夹到第一首。
 *   本件**一律拒**并给出为什么，五个因互不同形：
 *   · 没给列表 / 不是数组 ⇒ no_list；
 *   · 游标不是数 ⇒ not_number；
 *   · 列表空着 ⇒ empty_queue；
 *   · 游标不是整数 ⇒ not_integer；
 *   · 越界 ⇒ out_of_range（带 given 与 size，用户看得出来差了多远）。
 */
export function seekTo(list, cursor) {
    if (!Array.isArray(list)) return { ok: false, index: -1, size: 0, given: cursor, why: 'no_list' };
    if (typeof cursor !== 'number' || !Number.isFinite(cursor)) {
        return { ok: false, index: -1, size: list.length, given: cursor, why: 'not_number' };
    }
    if (!list.length) return { ok: false, index: -1, size: 0, given: cursor, why: 'empty_queue' };
    if (Math.floor(cursor) !== cursor) {
        return { ok: false, index: -1, size: list.length, given: cursor, why: 'not_integer' };
    }
    if (cursor < 0 || cursor >= list.length) {
        return { ok: false, index: -1, size: list.length, given: cursor, why: 'out_of_range' };
    }
    return { ok: true, index: cursor, size: list.length, given: cursor, why: 'ok' };
}

/**
 * 播放模式归一。
 * ★ 与源的差（源 `neteaseSetPlaybackMode`）：源一句
 *   `if (!NETEASE_PLAYBACK_MODES.includes(mode)) return;` —— **静默不动**：
 *   用户点了「随机」，界面上按钮没变、播放也没变，而且一个字都不说。
 *   本件把「没给」「给了但不是字串」「给了字串但不认识」分成三形，并带上 saw。
 */
export function modeOf(mode) {
    if (mode === undefined || mode === null || mode === '') {
        return { state: MUS_STATES[2], i: 2, mode: '', saw: mode, why: 'absent' };
    }
    if (typeof mode !== 'string') {
        return { state: MUS_STATES[3], i: 3, mode: '', saw: mode, why: 'not_text' };
    }
    if (MUS_PLAYBACK_MODES.indexOf(mode) < 0) {
        return { state: MUS_STATES[3], i: 3, mode: '', saw: mode, why: 'unknown_mode' };
    }
    return { state: MUS_STATES[0], i: 0, mode: mode, saw: mode, why: 'ok' };
}

/**
 * 下一个位置。
 * ★ 与源的差：源的顺序取下一首、随机取下一首都**绕回无痕迹**（用户听到的
 *   是「怎么又从头开始了」，但界面上没有任何读数），且 length === 1 时
 *   直接 return 0（也不报）。本件把三件事都报出来：wrapped / only_one / pick。
 * ★ 随机**不做 Math.random**：宿主把 0~1 的一个数（pick）传进来，本件只做
 *   纯函数归一 —— 这样「随机」这件事在测试里可复现，且不许挑到当前这首。
 */
export function nextIndex(mode, index, total, pick) {
    const m = modeOf(mode);
    if (!m.mode) return { ok: false, index: -1, wrapped: false, why: m.why };
    if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0) {
        return { ok: false, index: -1, wrapped: false, why: 'no_total' };
    }
    if (typeof index !== 'number' || !Number.isFinite(index) || index < 0 || index >= total) {
        return { ok: false, index: -1, wrapped: false, why: 'bad_index' };
    }
    if (total === 1) return { ok: true, index: 0, wrapped: false, why: 'only_one' };
    if (m.mode === MUS_PLAYBACK_MODES[2]) {
        return { ok: true, index: index, wrapped: false, why: 'single' };
    }
    if (m.mode === MUS_PLAYBACK_MODES[0]) {
        const next = index + 1;
        if (next >= total) return { ok: true, index: 0, wrapped: true, why: 'wrapped' };
        return { ok: true, index: next, wrapped: false, why: 'ok' };
    }
    const r = (typeof pick === 'number' && Number.isFinite(pick)) ? pick : 0;
    let frac = r - Math.floor(r);
    if (frac < 0) frac = 0;
    if (frac >= 1) frac = 0.999999;
    let picked = Math.floor(frac * (total - 1));
    if (picked >= index) picked += 1;
    if (picked >= total) picked = total - 1;
    return { ok: true, index: picked, wrapped: false, why: 'picked' };
}

/**
 * 队列守卫：先按歌曲键去重，再看超限。
 * ★ 与源的差：源到 limit 就 break，**剩下的曲目一条不报**（用户只看到
 *   歌单短了一截）。本件把 capped 与截掉几条报出来。
 */
export function guardQueue(songs, limit) {
    const cap = (typeof limit === 'number' && limit > 0) ? Math.floor(limit) : MUS_QUEUE_LIMIT;
    const d = dedupeSongs(songs, cap);
    d.limit = cap;
    d.over = (d.given > cap);
    d.why = d.list.length ? 'ok' : (d.given ? 'all_dropped' : 'empty');
    return d;
}

/* ---------- 来源读数 ---------- */

/**
 * 一条来源现在的状态。
 * ★ 与源的差（源 `recordHealth`）：源只记「连续失败到 3 次就开始冷静」，
 *   冷静期过了也不做任何标注，且**读不出来时当作没问题**。本件四形分列：
 *   · failure 与 success 都没给过 ⇒ absent（不是「都好」）；
 *   · 连续失败够数且在冷却窗口内 ⇒ cooling（带剩余毫秒）；
 *   · 连续失败够数但窗口已过 ⇒ cold（冷却已经结束，可以再试了）；
 *   · 其余 ⇒ ok。
 */
export function healthOf(node, now) {
    const n = (node && typeof node === 'object') ? node : {};
    const fails = numOrNullLocal(n.fails);
    const oks = numOrNullLocal(n.oks);
    if (fails === null && oks === null) {
        return { state: MUS_STATES[2], i: 2, why: MUS_SORT_WHY.ok, left: 0, fails: 0, oks: 0 };
    }
    const f = fails === null ? 0 : fails;
    const o = oks === null ? 0 : oks;
    const t = (typeof now === 'number' && Number.isFinite(now)) ? now : 0;
    const until = numOrNullLocal(n.coolingUntil);
    if (f >= MUS_COOLING_FAILS && until !== null) {
        const left = until - t;
        if (left > 0) return { state: MUS_STATES[1], i: 1, why: MUS_SORT_WHY.cooling, left: left, fails: f, oks: o };
        return { state: MUS_STATES[0], i: 0, why: MUS_SORT_WHY.cold, left: 0, fails: f, oks: o };
    }
    return { state: MUS_STATES[0], i: 0, why: MUS_SORT_WHY.ok, left: 0, fails: f, oks: o };
}

/**
 * 来源排序。
 * ★ 与源的差（源 `sortNodes` / `orderedNcmNodes`）：源认第一项是「用户偏好」，
 *   把它永远排在第一位 —— **哪怕它正在冷却**（用户点下去还是它，失败依旧）。
 *   本件保留「偏好在先」这条设计（那是用户的意思，不该被程序推翻），
 *   但**把偏好项当前的状态一起画出来**（pending = true 且 state 是 cooling）。
 *   其余按「不在冷却的在前、失败少的在前」稳定排。
 *   本件不改写入参：返回新数组。
 */
export function sortSources(nodes, now) {
    const list = Array.isArray(nodes) ? nodes.slice() : [];
    const rows = [];
    let i;
    for (i = 0; i < list.length; i += 1) {
        const n = (list[i] && typeof list[i] === 'object') ? list[i] : {};
        const h = healthOf(n, now);
        rows.push({
            key: textOf(n.key),
            url: textOf(n.url),
            pending: (i === 0 && !!n.preferred),
            state: h.state,
            i: h.i,
            why: h.why,
            left: h.left,
            fails: h.fails,
            oks: h.oks,
            at: i
        });
    }
    rows.sort(function (a, b) {
        if (a.pending !== b.pending) return a.pending ? -1 : 1;
        const ca = (a.state === MUS_STATES[1]) ? 1 : 0;
        const cb = (b.state === MUS_STATES[1]) ? 1 : 0;
        if (ca !== cb) return ca - cb;
        if (a.fails !== b.fails) return a.fails - b.fails;
        return a.at - b.at;
    });
    return rows;
}

/**
 * 第几条来源拿来试。
 * ★ 与源的差（源 `firstPlayable` 之类）：源是「从待试列表里拿第一条」，
 *   待试列表为空时返回 undefined —— **与「拿到了一条但它是空的」不同形，
 *   但调用处一律当空处理**。本件三形分列：absent（一条都没有）/
 *   cooling_only（有，但全在冷却）/ ok。
 */
export function pickSource(nodes, now) {
    const rows = sortSources(nodes, now);
    if (!rows.length) return { ok: false, index: -1, key: '', why: 'absent', cooling: 0 };
    let cooling = 0;
    let i;
    for (i = 0; i < rows.length; i += 1) if (rows[i].state === MUS_STATES[1]) cooling += 1;
    if (cooling === rows.length) return { ok: false, index: -1, key: '', why: 'cooling_only', cooling: cooling };
    return { ok: true, index: rows[0].at, key: rows[0].key, why: 'ok', cooling: cooling };
}

/**
 * 校验序：这一次该把哪一条当「新加的」。
 * ★ 与源的差：源按固定次序试，试完也不说「哪一条是这次新加的」—— 用户看到
 *   列表里多了一条，但看不出是不是刚刚那条。本件分三形：
 *   · 上一次的键还在列表里（且不在末尾）⇒ ok（位置沿用）；
 *   · 上一次的键就是末尾那条 ⇒ append（这是这一轮新加进去的）；
 *   · 上一次的键不在列表里（或没有上一次）⇒ absent。
 */
export function verifyOrder(prevKey, keys) {
    const list = Array.isArray(keys) ? keys.slice() : [];
    if (!list.length) return { state: MUS_STATES[2], i: 2, at: -1, why: MUS_VERIFY_WHYS.absent };
    const k = textOf(prevKey);
    if (!k) return { state: MUS_STATES[2], i: 2, at: -1, why: MUS_VERIFY_WHYS.absent };
    const at = list.indexOf(k);
    if (at < 0) return { state: MUS_STATES[2], i: 2, at: -1, why: MUS_VERIFY_WHYS.absent };
    if (at === list.length - 1) return { state: MUS_STATES[0], i: 0, at: at, why: MUS_VERIFY_WHYS.append };
    return { state: MUS_STATES[0], i: 0, at: at, why: MUS_VERIFY_WHYS.ok };
}

/* ---------- 把握分 ---------- */

/**
 * 两个曲目记录像不像同一首（0~100）。
 * ★ 源的写法（源 `matchScore`）：曲名**全等给 70**、包含给 45、其余 0；
 *   艺人全等 +30、包含 +18；调用处再 filter 掉 45 分以下的。
 *   本件逐条对齐这套分值（阈值提成真源表 MUS_MATCH_MIN），但**把「为什么给这个分」
 *   一并返回**（why：same_name / name_in / none）—— 源只返回一个数，用户看到
 *   一条被判「不像」，却说不出是名字对不上还是艺人没写。
 */
export function matchScore(a, b) {
    const A = (a && typeof a === 'object') ? a : {};
    const B = (b && typeof b === 'object') ? b : {};
    const na = stripTail(lower(textOf(A.name)));
    const nb = stripTail(lower(textOf(B.name)));
    const aa = stripTail(lower(textOf(A.artist)));
    const ab = stripTail(lower(textOf(B.artist)));
    let score = 0;
    let why = 'none';
    if (na && nb) {
        if (na === nb) { score += 70; why = 'same_name'; }
        else if (na.indexOf(nb) >= 0 || nb.indexOf(na) >= 0) { score += 45; why = 'name_in'; }
    }
    if (aa && ab) {
        if (aa === ab) score += 30;
        else if (aa.indexOf(ab) >= 0 || ab.indexOf(aa) >= 0) score += 18;
    }
    return { score: score, pass: (score >= MUS_MATCH_MIN), why: why };
}

/* ---------- 回执归一 ---------- */

const CHAR_BRACE_L = mk(123);
const CHAR_BRACE_R = mk(125);

/**
 * 从一段自由文本里取第一个**配平**的 JSON 对象/数组。
 * ★ 与源的差（源一句 JSON.parse 包在 try 里，失败就塔成「无法解析响应」）：
 *   本件把失败按「根本没给正文 / 括号没配平 / 一个对象都没找到」分形，
 *   并带回配平深度（depth）—— 用户看得出来是回执被截断了，还是回执里
 *   压根没有花括号块（比如对话端回了一句「好的我看看」）。
 */
export function extractObject(text) {
    const raw = textOf(text);
    if (!raw) return { ok: false, text: '', start: -1, depth: 0, why: 'no_text' };
    let start = -1;
    let depth = 0;
    let open = '';
    let close = '';
    let i;
    for (i = 0; i < raw.length; i += 1) {
        const c = raw.charAt(i);
        /* ★ 花括号与方括号**都要认**（本版真踩到）：本函数原本只找花括号，
         *   而 parseReply 里明写着「拿到的是数组也能用」—— 两个口径互相打架，
         *   于是一份**裸数组**的回信（对话端很可能就这么回）会被判成
         *   「没找到对象」，用户手里的整张曲目表一条都收不进来且不报。
         *   开了哪一种括号，就只数那一种（另一种无论怎么嵌套都不影响配平）。 */
        if (depth === 0) {
            if (c === CHAR_BRACE_L) { start = i; open = c; close = CHAR_BRACE_R; depth = 1; continue; }
            if (c === CHAR_BRACKET_L) { start = i; open = c; close = CHAR_BRACKET_R; depth = 1; continue; }
            continue;
        }
        if (c === open) { depth += 1; continue; }
        if (c === close) {
            depth -= 1;
            if (depth === 0 && start >= 0) {
                return { ok: true, text: raw.slice(start, i + 1), start: start, depth: 0, why: 'ok' };
            }
        }
    }
    if (depth !== 0) {
        return { ok: false, text: '', start: start, depth: depth, why: 'unbalanced' };
    }
    return { ok: false, text: '', start: -1, depth: 0, why: 'no_object' };
}

/**
 * 把对话端拿回来的一段文本收拾成曲目列表。
 * ★ 与源的差：源把「响应没法解析」塔成一句；本件六因分列（MUS_REPLY_WHYS）。
 *   六因互不同形：没给正文 / 括号没配平 / 没找到对象 / 不是合法 JSON /
 *   拿到的是个数或数组但里面没有曲目表 / 有一个空表。
 */
export function parseReply(text, limit) {
    const obj = extractObject(text);
    if (!obj.ok) return { ok: false, list: null, count: 0, why: obj.why, detail: null };
    let data = null;
    try {
        data = JSON.parse(obj.text);
    } catch (e) {
        return { ok: false, list: null, count: 0, why: 'bad_json', detail: null };
    }
    let arr = null;
    if (Array.isArray(data)) arr = data;
    else if (data && typeof data === 'object' && Array.isArray(data.songs)) arr = data.songs;
    if (!arr) return { ok: false, list: null, count: 0, why: 'not_object', detail: null };
    if (!arr.length) return { ok: false, list: [], count: 0, why: 'empty', detail: null };
    const q = guardQueue(arr, limit);
    const lrc = (data && typeof data === 'object' && !Array.isArray(data)) ? data.lrc : undefined;
    return { ok: true, list: q.list, count: q.list.length, why: 'ok', lrc: lrc, detail: q };
}

/**
 * 要用户从对话端问回来的那句话（本件唯一一处「写出去的字」）。
 * ★ 立场差落在这句话上：本件不发请求，所以数据得由用户从任何对话端拿回来；
 *   这句话把「要什么形状」说清楚，省得回一份人话回来。
 * ★ 不许出现反引号与反斜杠（本件硬纪律）。
 */
export function composeRequestText(hint) {
    const extra = textOf(hint).replace(CHAR_CR, ' ').replace(CHAR_NL, ' ').trim();
    const rows = [
        '把这次要收进案头的曲目给我。只要下面这一份，别的解释一个字都不用写：',
        CHAR_BRACE_L,
        '  "songs": [',
        '    ' + CHAR_BRACE_L + ' "id": "稳定编号", "name": "曲名", "artist": "艺人", "album": "专辑（可省）", "cover": "封面地址（可省）", "duration": 秒数 ' + CHAR_BRACE_R,
        '  ],',
        '  "lrc": "其中第一首的歌词原文（可省）"',
        CHAR_BRACE_R,
        '',
        '三条要求：',
        '1. 曲目表原样给，别替我删重复的，去重我来做；',
        '2. 时长给秒数就行，别给毫秒；',
        '3. 歌词原文整段贴，坏行不用修，我这边会统计。'
    ];
    if (extra) rows.push('', '另外：' + extra);
    return { text: rows.join(CHAR_NL), prompt: '把要收进案头的曲目按约定形状给我' };
}

/* ---------- 读数面 ---------- */

/**
 * 整页读数（视图层只读这里，不自己数）。
 * ★ 一律「没给就是 null」，**不编 0**：一个空曲库的封面「齐 0 首」和
 *   「压根没读到曲库」在界面上必须是两句话。
 * ★ covers 整格也是 null（不是四个零）—— 本版真踩到过：读数取不出来时
 *   四个计数全给 0，于是视图把「读数拿不到」画成「四种封面各 0 首」，
 *   用户看到的是「你有曲库，只是封面都没有」，而真相是一条都读不到。
 * bundle 的形状（由 App 层给）：
 *   { songs, lrc, sources, queue, now, storage }
 */
export function readingsOf(bundle) {
    const b = (bundle && typeof bundle === 'object') ? bundle : {};
    const songs = Array.isArray(b.songs) ? b.songs : null;
    let covers = null;
    let i;
    if (songs) {
        covers = { ok: 0, partial: 0, absent: 0, malformed: 0 };
        for (i = 0; i < songs.length; i += 1) {
            const c = coverOf(songs[i]);
            if (c.i === 0) covers.ok += 1;
            else if (c.i === 1) covers.partial += 1;
            else if (c.i === 2) covers.absent += 1;
            else covers.malformed += 1;
        }
    }
    const lrcRaw = b.lrc;
    let lrc = null;
    if (lrcRaw && typeof lrcRaw === 'object') {
        const d = (lrcRaw.dropped && typeof lrcRaw.dropped === 'object') ? lrcRaw.dropped : {};
        lrc = {
            kept: numOrNullLocal(lrcRaw.kept),
            tags: numOrNullLocal(lrcRaw.tags),
            noTime: numOrNullLocal(d.noTime),
            noText: numOrNullLocal(d.noText),
            capped: numOrNullLocal(lrcRaw.capped)
        };
    }
    const nodes = Array.isArray(b.sources) ? b.sources : null;
    let src = null;
    if (nodes) {
        const rows = sortSources(nodes, b.now);
        let cooling = 0;
        let unknown = 0;
        for (i = 0; i < rows.length; i += 1) {
            if (rows[i].state === MUS_STATES[1]) cooling += 1;
            if (rows[i].state === MUS_STATES[2]) unknown += 1;
        }
        src = { count: rows.length, cooling: cooling, unknown: unknown, pick: pickSource(nodes, b.now).why };
    }
    const q = (b.queue && typeof b.queue === 'object') ? b.queue : null;
    const queue = q ? {
        kept: numOrNullLocal(q.kept),
        given: numOrNullLocal(q.given),
        merged: numOrNullLocal(q.merged),
        capped: numOrNullLocal(q.capped),
        over: !!q.over
    } : null;
    return { songs: songs ? songs.length : null, covers: covers, lrc: lrc, sources: src, queue: queue };
}

/**
 * 整页一句话（四态面）。
 * ★ 与源的差：源整页没有「这一屏可不可信」这一句 —— 数据取不出来时页面
 *   就是空的，用户以为「今天这歌单就是空」。本件四种面互不同形：
 *   · 存储读不到（bundle.storage === false）⇒ storage_absent；
 *   · 曲库压根不是一个表（null / 对象 / 数）⇒ malformed（写了但认不出来）；
 *   · 是表但是空的 ⇒ empty（还没收进来）；
 *   · 表里有东西 ⇒ ok。
 */
export function faceOf(bundle) {
    const b = (bundle && typeof bundle === 'object') ? bundle : {};
    /* ★ 取法一律走**真源的值形**：MUS_FACES 里是 'ok' / 'empty' / 'malformed' /
     *   'storage_absent' —— 键写作 [MUS_FACES[3]] 而不是 .storage_absent，
     *   这样真源改名时这里跟着走，不会静默查不到、回落成同一句话。 */
    if (b.storage === false) {
        return { face: MUS_FACES[3], i: 3, text: MUS_FACE_TEXT[MUS_FACES[3]], why: 'storage_absent' };
    }
    const songs = b.songs;
    /* 「压根没给」与「给了但不是表」在本件是**同一态**（写了但认不出来）；
     *  两处各写一遍真源键面就是 J7 形态（真源增删一态会静默漏一处），并成一处判。 */
    if (songs === null || songs === undefined || !Array.isArray(songs)) {
        return { face: MUS_FACES[2], i: 2, text: MUS_FACE_TEXT[MUS_FACES[2]], why: 'not_list' };
    }
    if (!songs.length) return { face: MUS_FACES[1], i: 1, text: MUS_FACE_TEXT[MUS_FACES[1]], why: 'empty' };
    return { face: MUS_FACES[0], i: 0, text: MUS_FACE_TEXT[MUS_FACES[0]], why: 'ok' };
}

/* ---------- 日期 ---------- */

/**
 * 日子键（落台账回执用）。
 * ★ 与第 3 层各件同款：只此一处口径，视图不许自己取时钟。
 * ★ 不用 padStart，逐位补零（避免依赖运行环境的小版本差异）。
 */
export function todayKeyOf(nowMs) {
    const n = numOrNullLocal(nowMs);
    const d = new Date(n === null ? Date.now() : n);
    const m = d.getMonth() + 1;
    const day = d.getDate();
    return String(d.getFullYear()) + '-'
        + (m < 10 ? '0' : '') + String(m) + '-'
        + (day < 10 ? '0' : '') + String(day);
}
