/* ========================================================
 * pvdesk-data.js — [v3.43.0] PV 案头 · 纯函数内核
 * --------------------------------------------------------
 * 缝合自 Perigee OS 的「ニコニコ 音乐PV工房」一族（素材缝合路线图第 3 层
 * 第七件）：js/niconico-pv-form.js / -media.js / -storyboard.js /
 * -submit.js / -frames.js / -lyrics.js 六件（4445 行 / 126 方法，
 * 块文件 nuo_sources/nuo3/live/blk_pv.txt）。
 *
 * ── 定位差（本件最本质的一条）──────────────────────────
 *   源是**工房并且是出片的那个人**：自己起 WebAudio 合成与试听、自己
 *   切参考音频（_encodeWav 真写 WAV）、自己把分镜图逐镜喂给生图入口、
 *   自己把成片落 IndexedDB 与 GitHub 备份。本件是**案头**：把分镜脚本
 *   （brief）与作品台账（shelf）收拾好、把逐镜要求文本组出来、把歌词
 *   时间轴算准、把三项上限的余量报准 —— **零音频元件、零网络、零出图、
 *   零成片、零外链**。
 *
 * ── 四条不缝（逐条写进文件头与条目）────────────────────
 *   ① 不合成·不试听（源 createGain / createOscillator + 三段试听按钮）；
 *   ② 不切音频·不出 WAV（源 _encodeWav 自己编码音频文件）；
 *   ③ 不出图·不出片·不拉账号（源调用生图入口与视频生成任务队列）；
 *   ④ 不读宿主界面元素、不收外链、不落数据库（源满篇
 *      document.getElementById 与 IndexedDB 备份）。
 *
 * ── 四条偏离（源静默失效的地方，本件一律升为读数）──────
 *   ① 镜头区间反了不许静默收下 ⇒ rejected（逐条报 saw）；
 *   ② 镜头体为空不许静默收下 ⇒ emptyBodies 逐条报镜头号；
 *   ③ 短文截断不许静默 ⇒ excerptTruncated + keptChars；
 *   ④ 三项上限不许静默（源是硬闸，超了不解释）⇒ 逐项报余量与拒绝原因。
 *
 * ── 静默失效形态（本件守的，都不报错、不崩溃，只是结果不对）──
 *   · 「压根没给风格」与「给了但认不出来」不许同形（absent / unknown）；
 *   · 字幕主行与副行不许同形（副行是切出来的，不是原文）；
 *   · 歌词三态不许压平（timed / untimed / empty）；
 *   · 台账三类不许压平（brief / cut / brief_without_cut）；
 *   · 上限余量取不出来不许画成 0（与真的 0 不同形）。
 *
 * ── 实现纪律 ────────────────────────────────────────────
 *   · 本件不许出现正则字面量（本仓剥注释器是字符状态机、不解析正则）、
 *     不许出现反斜杠，也不许出现反引号；
 *   · 一切字符切分走 indexOf / slice / split 的字串形态。
 * ======================================================== */

/* ---------- 题面：来源说明（唯一出处，视图与条目都读它） ---------- */
export const PV_SOURCE_NOTE = 'Perigee OS · ニコニコ 音乐PV工房（六件合一件）';
export const PV_SOURCE_FILES = Object.freeze([
    'niconico.js',
    'niconico-pv-form.js', 'niconico-pv-media.js', 'niconico-pv-storyboard.js',
    'niconico-pv-submit.js', 'niconico-pv-frames.js', 'niconico-pv-lyrics.js'
]);

/* ---------- 真源表 · 七型演出（源的 _PV_STYLE_CARDS 七卡，逐条对齐） ---------- */
/** 每型三格：persona（源里逐型不同，本件保留这个信息）/ label / lens。
 *  ★ lens 是源里各型实际强调的机位语汇，本件把它单独成格，
 *    因为它决定要求文本里「这一镜按什么机位写」那一行。 */
export const PV_PERSPECTIVES = Object.freeze([
    Object.freeze({
        key: 'op',
        label: 'OP 型',
        persona: '音乐PV演出导演',
        lens: '疾走起跑 / 回眸望镜头 / 依次登场 / 全员拉远 / 副歌前静止蓄势 / 一张定格决胜画',
        note: '按乐曲能量曲线分配镜头密度：主歌铺垫、副歌最高潮'
    }),
    Object.freeze({
        key: 'ed',
        label: 'ED 型',
        persona: '音乐PV演出导演',
        lens: '定机位或缓移长镜头 / 背影·远景·剪影 / 日常余韵小动作 / 沉稳统一色调 / 缓缓拉远',
        note: '镜头数可以偏少（源注明：具体镜数不写死，交给成片侧一体化）'
    }),
    Object.freeze({
        key: 'insert',
        label: '插入歌型',
        persona: '音乐PV演出导演',
        lens: '回忆闪回 / 今昔对比 / 层层推进的蒙太奇 / 让高涨与顶点重合',
        note: '故事改编向：流言·群体压力·抽象威胁可用一个核心象征物代替具体配角'
    }),
    Object.freeze({
        key: 'yokoku',
        label: '预告型',
        persona: '系列构成（宣传担当）',
        lens: '短镜摘要堆叠 / 一两句引人遐想的台词 / 点到为止不亮核心 / 黑场或定格收',
        note: '可基于既有设定暗示下一集，但不得明示重大转折或结局'
    }),
    Object.freeze({
        key: 'highlight',
        label: '总集篇高光型',
        persona: '系列构成（宣传担当）',
        lens: '已播名场面蒙太奇 / 情感起伏排成波 / 斩击轨迹·冲击波·残影·火花·速度感',
        note: '时长偏短时不要怕短镜连堆；可回收开头展示过的要素'
    }),
    Object.freeze({
        key: 'mv',
        label: 'MV 型',
        persona: '音乐MV演出导演',
        lens: '切换卡在歌词行界 / 意识流意象接续 / 象征物特写 / 图形动画转场 / CRT·故障·扫描线',
        note: '文字排版类镜头只出留白底板或抽象几何，画面里绝不出现可读文字'
    }),
    Object.freeze({
        key: 'battle',
        label: '战斗高潮型',
        persona: '音乐PV演出导演',
        lens: '交替切镜 / 决胜画收尾 / 斩击轨迹与冲击波 / 残影瓦砾 / 撞击火花与速度线',
        note: '高潮前可先给一个明显更长更安静的镜头蓄力'
    })
]);

/* ---------- 真源表 · 情绪卡（源的 _PV_MOOD_CARDS 六卡） ---------- */
export const PV_MOOD_CUES = Object.freeze([
    Object.freeze({ key: 'iyashi', label: '治愈', text: '柔和的光·暖色·舒缓运镜，镜头偏长，动作如微风与光尘' }),
    Object.freeze({ key: 'setsunai', label: '揪心', text: '黄昏·雨·逆光·偏蓝，体现错过与距离感的构图，善用留白' }),
    Object.freeze({ key: 'moeru', label: '燃', text: '快切·仰角或倾斜·突进疾驰，对比强烈的色彩' }),
    Object.freeze({ key: 'kibou', label: '希望', text: '朝阳·上升运镜·开阔远景，画面从阴影走向光' }),
    Object.freeze({ key: 'shukufuku', label: '祝福', text: '暖光铺满·稳而长的时间感·群像收拢成一个中心' }),
    Object.freeze({ key: 'seiiku', label: '静寂', text: '低饱和·单一光源·极简构图，声音之外只剩呼吸' })
]);

/* ---------- 真源表 · 画风锚（源的 _PV_ART_STYLES 四锚，逐字） ---------- */
export const PV_STYLE_ANCHORS = Object.freeze([
    Object.freeze({ key: 'cel', label: '赛璐璐', anchor: '日本动画原画・赛璐璐画风：平涂色块、干净线稿、简洁阴影分层，绝对不要2.5D或3D渲染，不要写实材质与体积光' }),
    Object.freeze({ key: 'flat', label: '平涂插画', anchor: '平涂插画画风：单色块着色、极简或无阴影分层、干净的矢量感边缘，不要照片级写实材质，不要精细的笔触肌理' }),
    Object.freeze({ key: 'painterly', label: '厚涂水彩', anchor: '厚涂·水彩画风：可见的笔触与颜料肌理、柔和的色彩过渡，不要赛璐璐式的平涂色块，不要锐利干净的矢量边缘' }),
    Object.freeze({ key: 'realistic', label: '写实 CG', anchor: '写实·3D CG画风：真实材质与体积光、符合物理规律的阴影与反光，不要赛璐璐式的平涂色块，不要2D手绘线稿感' })
]);

/* ---------- 上限与阈值（源是硬闸：本件一律改成「余量 + 拒绝原因」） ---------- */
export const PV_SHOT_MAX = 60;
export const PV_HARD_LIMIT_CHARS = 20000;
export const PV_EXCERPT_THRESHOLD = 400;
export const PV_CAST_MAX = 9;
export const PV_REFS_MAX = 9;
export const PV_REFS_MAX_WIDE = 50;
export const PV_DURATION_MIN = 4;
export const PV_DURATION_MAX = 15;
export const PV_DURATION_DEFAULT = 10;
export const PV_CAPTION_MIN = 4;
export const PV_LRC_LINE_MAX = 400;
export const PV_LEDGER_MAX = 40;

/* ---------- 真源表 · 对话语言与语速（源 _PV_DIALOGUE_LANGS 三语） ---------- */
export const PV_DIALOGUE_LANGS = Object.freeze([
    Object.freeze({ key: 'ja', label: '日语', perSecond: 6.0, unit: '字', pace: '按日语计每秒 6 个字左右' }),
    Object.freeze({ key: 'zh', label: '中文', perSecond: 4.0, unit: '字', pace: '按中文计每秒 4 个字左右' }),
    Object.freeze({ key: 'en', label: '英语', perSecond: 2.5, unit: '词', pace: '按英语计每秒 2 到 3 个单词' })
]);

/* ---------- 真源表 · 分镜头标记与元标签（源口径：图与図都认） ---------- */
export const PV_SHOT_MARK = '镜头';
export const PV_FIG_MARKS = Object.freeze(['图', '図']);
export const PV_BODY_DROP_MARK = '使用的素材';
export const PV_META_TAGS = Object.freeze(['ti', 'ar', 'al', 'by', 'offset', 're', 've', 'length', 'id', 'kana']);

/* ---------- 真源表 · 解析失败因（本件唯一出处：逐字不重复写） ---------- */
export const PV_PARSE_WHYS = Object.freeze(['empty', 'no_header', 'too_many', 'over_limit']);
export const PV_HOLD_WHYS = Object.freeze(['empty_shot', 'too_long', 'figs_over', 'cast_over', 'refs_over', 'no_cut']);

/* ---------- 四态（本件自己的面；视图与读数都从这里取） ---------- */
export const PV_FACES = Object.freeze(['ok', 'empty', 'malformed', 'absent']);

/* ---------- 出处表 · 三项上限的余量 ---------- */
export const PV_GAUGE_KEYS = Object.freeze([
    Object.freeze({ key: 'shots', label: '镜头数', limitKey: 'shots' }),
    Object.freeze({ key: 'chars', label: '正文长度', limitKey: 'chars' }),
    Object.freeze({ key: 'cast', label: '登场角色', limitKey: 'cast' }),
    Object.freeze({ key: 'refs', label: '参考素材', limitKey: 'refs' })
]);

/* ---------- 拼装形字符（本仓纪律：源码里不许出现反斜杠转义） ---------- */
const CHAR_TAB = String.fromCharCode(9);
const CHAR_NL = String.fromCharCode(10);
const CHAR_CR = String.fromCharCode(13);

/* ---------- 工具 ---------- */
function strOf(v) {
    return (typeof v === 'string') ? v : '';
}

/** 去零宽与行首行尾空白（源用 replace 打一串正则；本件走字串形态）。
 *  ★ 零宽字符一律拼装形（本仓纪律：被审代码里不许出现反斜杠）。 */
const ZERO_WIDTHS = [
    String.fromCharCode(8203),
    String.fromCharCode(8204),
    String.fromCharCode(8205),
    String.fromCharCode(65279)
];
export function clean(v) {
    let s = strOf(v);
    for (let i = 0; i < ZERO_WIDTHS.length; i++) {
        s = s.split(ZERO_WIDTHS[i]).join('');
    }
    return s.trim();
}

/** 正文字符长度（不含行首行尾空白；源上限是**字符**不是行数）。 */
export function charCount(v) {
    return clean(v).length;
}

/** 题面截断（源的 _PV_EXCERPT_THRESHOLD = 400）。 */
/** 超阈值的正文读数（源也截，但**不说**）：视图与取数口都读它。 */
export function briefOf(v, threshold) {
    const s = clean(v);
    const limit = (typeof threshold === 'number' && threshold > 0) ? threshold : PV_EXCERPT_THRESHOLD;
    return { text: s, chars: s.length, limit, truncated: s.length > limit, keptChars: Math.min(s.length, limit) };
}

/** 截断到阈值（逐字裁，不按词裁 —— 源按整段喂进下游，本件明示裁了多少）。 */
export function excerptOf(v, threshold) {
    const b = briefOf(v, threshold);
    return { text: b.truncated ? b.text.slice(0, b.limit) : b.text, chars: b.chars, truncated: b.truncated, keptChars: b.keptChars };
}

/* ---------- 字幕：括注切分（源的 _pvSplitLyricParen） ---------- */
/** 切出主行与副行。源只认「整行以括注收尾」这一形；
 *  ★ 本件把「切不动」与「切出来是空的」分开：两者都回落整串，但报 filled 不同。 */
export function splitParen(v) {
    const s = strOf(v);
    const pairs = [['（', '）'], ['(', ')']];
    for (let i = 0; i < pairs.length; i++) {
        const open = pairs[i][0];
        const close = pairs[i][1];
        if (s.length < 3 || s.slice(-1) !== close) continue;
        const at = s.lastIndexOf(open, s.length - 2);
        if (at <= 0) continue;
        const main = s.slice(0, at).trim();
        const sub = s.slice(at + 1, s.length - 1).trim();
        if (!main || !sub) return { main: s, sub: null, filled: 'paren_empty' };
        return { main, sub, filled: 'split' };
    }
    if (s.indexOf('（') >= 0 || s.indexOf('(') >= 0) return { main: s, sub: null, filled: 'not_tail' };
    return { main: s, sub: null, filled: 'no_paren' };
}

/** 主行过长时按字符切副行（源在成片侧按画布宽度缩字号；本件改成**字幕行切分**，
 *  因为本件不出画布）。12 字以内不切。 */
export function captionCut(main, maxChars) {
    const s = clean(main);
    const cap = (typeof maxChars === 'number' && maxChars > 0) ? maxChars : 12;
    if (s.length <= cap) return { main: s, sub: null, cut: false, cutAt: 0 };
    return { main: s.slice(0, cap), sub: s.slice(cap), cut: true, cutAt: cap };
}

/** 字幕版式（本的 _pvLyricCaptionLayout 的读数面）：不出画布，只报三档版式。 */
export function captionLayout(cues, duration, maxChars) {
    const n = Array.isArray(cues) ? cues.length : 0;
    if (!(duration > 0)) return { mode: 'absent', slots: 0, perSlot: 0, maxChars: 0 };
    if (n === 0) return { mode: 'empty', slots: 0, perSlot: 0, maxChars: maxChars || 12 };
    const cap = (typeof maxChars === 'number' && maxChars > 0) ? maxChars : 12;
    return { mode: 'timed', slots: n, perSlot: Math.round((duration / n) * 100) / 100, maxChars: cap };
}

/* ---------- 说话字数上限（源按节奏表折算「这句台词塞不进这一镜」） ---------- */
/** 源按语言给每秒字/词数（日语 6 / 中文 4 / 英语 2.5）。本件把这条留成**读数**：
 *  返 { ok, why, limit, saw, perSecond, lang }。 */
export function speechLimitCheck(text, seconds, langKey) {
    const s = clean(text);
    if (!s) return { ok: false, why: PV_HOLD_WHYS[0], limit: 0, saw: 0, perSecond: 0, lang: '' };
    if (!(seconds > 0)) return { ok: false, why: 'no_cut', limit: 0, saw: s.length, perSecond: 0, lang: '' };
    let row = null;
    for (let i = 0; i < PV_DIALOGUE_LANGS.length; i++) {
        if (PV_DIALOGUE_LANGS[i].key === langKey) row = PV_DIALOGUE_LANGS[i];
    }
    const use = row || PV_DIALOGUE_LANGS[0];
    const limit = Math.floor(use.perSecond * seconds);
    if (s.length > limit) {
        return { ok: false, why: PV_HOLD_WHYS[1], limit, saw: s.length, perSecond: use.perSecond, lang: use.key };
    }
    return { ok: true, why: '', limit, saw: s.length, perSecond: use.perSecond, lang: use.key };
}

/* ---------- 文本类别（不写正则：按码点区间判，源用三套正则） ---------- */
export function textClassOf(v) {
    const s = strOf(v);
    let kana = 0;
    let hans = 0;
    let latin = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if ((c >= 12352 && c <= 12447) || (c >= 12448 && c <= 12543)) { kana += 1; continue; }
        if (c >= 19968 && c <= 40959) { hans += 1; continue; }
        if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) { latin += 1; }
    }
    if (kana > 0) return { cls: 'kana', kana, hans, latin };
    if (hans > 0) return { cls: 'hans', kana, hans, latin };
    if (latin > 0) return { cls: 'latin', kana, hans, latin };
    return { cls: 'other', kana, hans, latin };
}

/* ========================================================
 * 分镜脚本解析（源的 _pvParseShots + _pvShotFigNums）
 * ======================================================== */
function parseHead(mark, at, tail) {
    let i = at + mark.length;
    while (i < tail.length && isSpace(tail[i])) i++;
    let num = '';
    while (i < tail.length && isDigit(tail[i])) { num += tail[i]; i++; }
    while (i < tail.length && isSpace(tail[i])) i++;
    const openers = ['（', '('];
    if (num === '' || openers.indexOf(tail[i]) < 0) return null;
    i++;
    while (i < tail.length && isSpace(tail[i])) i++;
    let a = '';
    while (i < tail.length && isDigit(tail[i])) { a += tail[i]; i++; }
    if (a === '') return null;
    const seps = ['-', '~', '～', '–', '—', '－'];
    let sepAt = -1;
    for (let k = 0; k < seps.length; k++) {
        if (tail.slice(i, i + seps[k].length) === seps[k]) { sepAt = k; break; }
    }
    if (sepAt < 0) return null;
    i += seps[sepAt].length;
    while (i < tail.length && isSpace(tail[i])) i++;
    let b = '';
    while (i < tail.length && isDigit(tail[i])) { b += tail[i]; i++; }
    if (b === '') return null;
    while (i < tail.length && isSpace(tail[i])) i++;
    if (tail.slice(i, i + 1) !== '秒') return null;
    i++;
    while (i < tail.length && isSpace(tail[i])) i++;
    const closers = ['）', ')'];
    if (closers.indexOf(tail[i]) < 0) return null;
    i++;
    return { n: parseInt(num, 10), a: parseInt(a, 10), b: parseInt(b, 10),
             start: at, end: at + (i - at) };
}

function isSpace(ch) {
    return ch === ' ' || ch === CHAR_TAB;
}

function isDigit(ch) {
    return typeof ch === 'string' && ch >= '0' && ch <= '9';
}

/** 分镜脚本解析。
 *  源：只认「镜头 N（a-b秒）」，其余一律静默；起始下标与结束下标反了照样收下。
 *  本件四处不同：① 起始大于结束的**拒收并逐条报**；② 镜头体为空的**逐条报**；
 *  ③ 超过上限的报 too_many 并裁到上限（源是硬闸，超了不解释）；
 *  ④ 超过硬限字数的报 over_limit 并只解前段（源把整段照喂）。 */
export function parseShots(text, opts) {
    const src = clean(text);
    if (!src) {
        return { ok: false, why: PV_PARSE_WHYS[0], shots: [], rejected: [], emptyBodies: [],
                 bodyCut: [], saw: '', truncated: false };
    }
    const limitChars = (opts && opts.limitChars) || PV_HARD_LIMIT_CHARS;
    const limitShots = (opts && opts.limitShots) || PV_SHOT_MAX;
    const chars = src.length;
    const overLimit = chars > limitChars;
    const work = overLimit ? src.slice(0, limitChars) : src;

    const heads = [];
    let i = work.indexOf(PV_SHOT_MARK);
    while (i >= 0) {
        const h = parseHead(PV_SHOT_MARK, i, work);
        if (h) heads.push(h);
        i = work.indexOf(PV_SHOT_MARK, i + PV_SHOT_MARK.length);
    }
    if (heads.length === 0) {
        return { ok: false, why: PV_PARSE_WHYS[1], shots: [], rejected: [], emptyBodies: [],
                 bodyCut: [], saw: work.slice(0, 60), truncated: overLimit, chars };
    }
    const rejected = [];
    const shots = [];
    const emptyBodies = [];
    const bodyCut = [];
    for (let k = 0; k < heads.length; k++) {
        const h = heads[k];
        if (h.a > h.b) {
            rejected.push({ n: h.n, saw: h.a + '-' + h.b });
            continue;
        }
        if (shots.length >= limitShots) {
            rejected.push({ n: h.n, saw: 'over_limit_shot' });
            continue;
        }
        /* ★ 切到**下一镜表头的起点**：原式（下一表头结束 - 表头字数）落在右括号前两个
         *   字符上，于是每镜正文尾部都多出一截下一镜的表头（实测抓到）。 */
        const segEnd = (k + 1 < heads.length) ? heads[k + 1].start : work.length;
        let raw = work.slice(h.end, segEnd);
        const lines = raw.split(CHAR_NL);
        const kept = [];
        let cut = 0;
        for (let t = 0; t < lines.length; t++) {
            const line = lines[t];
            const trimmed = clean(line);
            if (trimmed.indexOf(PV_BODY_DROP_MARK) === 0) { cut += 1; continue; }
            kept.push(line);
        }
        raw = clean(kept.join(CHAR_NL));
        if (!raw) emptyBodies.push(h.n);
        /* ★ 剔掉的行要**计数**：源静默剔，用户只看到「这一镜怎么这么短」。 */
        if (cut > 0) bodyCut.push({ n: h.n, cut });
        shots.push({ n: h.n, a: h.a, b: h.b, sec: h.b - h.a, body: raw, cut });
    }
    if (shots.length === 0) {
        return { ok: false, why: PV_PARSE_WHYS[0], shots, rejected, emptyBodies, bodyCut,
                 saw: work.slice(0, 60), truncated: overLimit, chars };
    }
    /* ★ 超硬限要**报出来**：源把整段照喂、截了不说。本件截段照解，但 why 落
     *   over_limit 且 truncated / keptChars 都在 —— 视图据此画出「后面多少字没进来」。 */
    return { ok: true, why: overLimit ? PV_PARSE_WHYS[3] : '',
             shots, rejected, emptyBodies, bodyCut, saw: '',
             truncated: overLimit, chars, keptChars: overLimit ? limitChars : chars,
             overShots: overLimit && shots.length >= limitShots };
}

/** 一镜里提到的立绘号（源：图 与 図 都认）。 */
export function shotFigNums(body) {
    const s = strOf(body);
    const out = [];
    for (let i = 0; i < s.length; i++) {
        if (PV_FIG_MARKS.indexOf(s[i]) < 0) continue;
        let j = i + 1;
        let num = '';
        while (j < s.length && isDigit(s[j])) { num += s[j]; j++; }
        if (num === '') continue;
        const n = parseInt(num, 10);
        if (out.indexOf(n) < 0) out.push(n);
    }
    return out;
}

/** 全部镜头合计提到的立绘号（去重，按首次出现序）。 */
export function allFigNums(shots) {
    const out = [];
    const rows = Array.isArray(shots) ? shots : [];
    for (let i = 0; i < rows.length; i++) {
        const nums = shotFigNums(rows[i] && rows[i].body);
        for (let k = 0; k < nums.length; k++) {
            if (out.indexOf(nums[k]) < 0) out.push(nums[k]);
        }
    }
    return out;
}

/* ---------- 出处表 · 图号与镜号映射（源用「连号就写区间」这一形） ---------- */
export function figMapRows(assetCount, frameShots) {
    const lines = [];
    const rows = Array.isArray(frameShots) ? frameShots : [];
    if (rows.length === 0) return lines;
    const k = (assetCount || 0) + 1;
    let consecutive = true;
    for (let i = 0; i < rows.length; i++) {
        if (rows[i] !== i + 1) consecutive = false;
    }
    if (rows.length === 1) {
        lines.push('图' + k + '：镜头' + rows[0] + ' 的分镜参考图，作为该镜头的构图·画面·色调参照');
    } else if (consecutive) {
        lines.push('图' + k + '～图' + (k + rows.length - 1) + '：镜头1～镜头' + rows.length
                   + ' 的分镜参考图，按顺序一一对应，作为各镜头的构图·画面·色调参照');
    } else {
        for (let i = 0; i < rows.length; i++) {
            lines.push('图' + (k + i) + '：镜头' + rows[i] + ' 的分镜参考图，作为该镜头的构图·画面·色调参照');
        }
    }
    return lines;
}

/* ========================================================
 * 逐镜要求文本（源的 _pvBuildFramePrompt + _pvWrapPromptForSubmit）
 * ======================================================== */
/** 风格格取值：先报 filled（absent / unknown / ok），再给 anchor。
 *  ★ 源在这里用 _PV_ART_STYLES[k] 或空串一把兜底 ⇒ 「没给」与「给了但认不出」
 *    在文本里**一模一样**（都少一行画风）。本件把两者分开报。 */
export function stylePick(styleKey) {
    const key = strOf(styleKey);
    if (!key) return { filled: 'absent', saw: '', anchor: '', key: '' };
    for (let i = 0; i < PV_STYLE_ANCHORS.length; i++) {
        if (PV_STYLE_ANCHORS[i].key === key) {
            return { filled: 'ok', saw: key, anchor: PV_STYLE_ANCHORS[i].anchor, key };
        }
    }
    return { filled: 'unknown', saw: key, anchor: '', key: '' };
}

export function perspectiveOf(key) {
    const k = strOf(key);
    for (let i = 0; i < PV_PERSPECTIVES.length; i++) {
        if (PV_PERSPECTIVES[i].key === k) return PV_PERSPECTIVES[i];
    }
    return null;
}

/** 逐镜要求文本。opts: { styleKey, lensKey, moodKey, segs }
 *  返 { lines, text, filled } —— filled 逐格报（style / lens / mood / cast / frame）。 */
export function promptForShot(shot, opts) {
    const o = opts || {};
    const style = stylePick(o.styleKey);
    const lens = perspectiveOf(o.lensKey);
    let mood = null;
    for (let i = 0; i < PV_MOOD_CUES.length; i++) {
        if (PV_MOOD_CUES[i].key === o.moodKey) mood = PV_MOOD_CUES[i];
    }
    const body = clean(shot && shot.body);
    const nums = shotFigNums(body);
    const filled = {
        style: style.filled,
        lens: strOf(o.lensKey) ? (lens ? 'ok' : 'unknown') : 'absent',
        mood: strOf(o.moodKey) ? (mood ? 'ok' : 'unknown') : 'absent',
        figs: nums.length > 0 ? 'ok' : 'none'
    };
    const lines = [];
    if (style.anchor) lines.push(style.anchor);
    lines.push('这一镜按' + (lens ? lens.lens : '自由机位') + '来写');
    if (mood) lines.push(mood.text);
    if (nums.length > 0) {
        const map = [];
        for (let i = 0; i < nums.length; i++) map.push('第' + (i + 1) + '张=图' + nums[i]);
        lines.push('参考图是这位角色的立绘（' + map.join('、') + '），严格保持发型·瞳色·服装细节');
    } else {
        lines.push('按描述画');
    }
    lines.push('镜头内容（取这一镜最具代表性的一瞬）：' + body);
    lines.push('只画这一帧本身：横向画幅，画面铺满整个画布（不要上下黑边或留白边框），'
               + '不要任何文字、字幕、水印、分镜框、多格拼贴；画面干净');
    return { lines, text: lines.join('。') + '。', filled, figs: nums };
}

/** 提交用要求文本（源的 _pvWrapPromptForSubmit 三块：素材指代 / 画风行 / 负向控制）。 */
export function wrapPromptForSubmit(prompt, opts) {
    const o = opts || {};
    const paintCount = (typeof o.assetCount === 'number') ? o.assetCount : 0;
    const frameShots = Array.isArray(o.frameShots) ? o.frameShots : [];
    const segs = (typeof o.segCount === 'number' && o.segCount > 0) ? o.segCount : 0;
    const lines = [];
    const hasMaterial = paintCount > 0 || segs > 0 || frameShots.length > 0;
    if (hasMaterial) {
        lines.push('【素材指代】');
        if (paintCount > 0) lines.push('图1～图' + paintCount + '：登场角色立绘（外貌参照）');
        const mapRows = figMapRows(paintCount, frameShots);
        for (let i = 0; i < mapRows.length; i++) lines.push(mapRows[i]);
        if (segs > 0) lines.push('音频1：参考音乐（约' + segs + '秒）');
    }
    lines.push(clean(prompt));
    lines.push('【负向控制】不要字幕、不要额外的画面文字');
    const text = lines.join(CHAR_NL);
    return { text, chars: text.length, hasMaterial, blocks: hasMaterial ? 3 : 2 };
}

/** 画风锚追加（源的 _pvApplyArtStyle：先看有没有同一锚的前 8 字，有就不重复加）。 */
export function applyStyleAnchor(prompt, styleKey) {
    const pick = stylePick(styleKey);
    if (!pick.anchor) return { text: clean(prompt), applied: false, filled: pick.filled };
    const base = clean(prompt);
    const marker = pick.anchor.slice(0, 8);
    if (base.indexOf(marker) >= 0) return { text: base, applied: false, filled: 'already' };
    return { text: base + (base ? CHAR_NL : '') + '画风：' + pick.anchor, applied: true, filled: pick.filled };
}

/* ========================================================
 * 歌词（源的 _pvParseLyricCues / _pvLyricsPlainText / _pvFindCueAt）
 * ======================================================== */
function isMetaLine(line) {
    const s = line.trim();
    if (s.length < 4 || s[0] !== '[' || s[s.length - 1] !== ']') return false;
    const inner = s.slice(1, s.length - 1);
    const at = inner.indexOf(':');
    if (at <= 0) return false;
    const tag = inner.slice(0, at).trim().toLowerCase();
    for (let i = 0; i < PV_META_TAGS.length; i++) {
        if (PV_META_TAGS[i] === tag) return true;
    }
    return false;
}

function readTimes(line) {
    const out = [];
    let i = 0;
    while (i < line.length) {
        if (line[i] !== '[') { i++; continue; }
        let j = i + 1;
        let mm = '';
        while (j < line.length && isDigit(line[j])) { mm += line[j]; j++; }
        if (mm === '' || mm.length > 2 || line[j] !== ':') { i++; continue; }
        j++;
        let ss = '';
        while (j < line.length && isDigit(line[j])) { ss += line[j]; j++; }
        if (ss.length !== 2) { i++; continue; }
        let frac = '';
        if (line[j] === '.' || line[j] === ':') {
            let k = j + 1;
            let f = '';
            while (k < line.length && isDigit(line[k])) { f += line[k]; k++; }
            if (f.length >= 1 && f.length <= 3) { frac = f; j = k; }
        }
        if (line[j] !== ']') { i++; continue; }
        const sec = parseInt(mm, 10) * 60 + parseInt(ss, 10) + (frac ? parseInt(frac, 10) / Math.pow(10, frac.length) : 0);
        out.push({ t: sec, start: i, end: j + 1 });
        i = j + 1;
    }
    return out;
}

function stripTags(line, spans) {
    if (spans.length === 0) return clean(line);
    /* ★ 切的是**标签区间 [start, end)**：原式拿「结束位置」当终点，
     *   于是 slice(end, end) 恒为空串、slice(0, end) 又把标签本身加了回去 ——
     *   实测正文是「[00:01.00]第一行」（标签没剥掉，本版自己抓到）。 */
    let out = '';
    let cursor = 0;
    for (let i = 0; i < spans.length; i++) {
        const at = spans[i].start;
        if (at > cursor) out += line.slice(cursor, at);
        cursor = spans[i].end;
    }
    out += line.slice(cursor);
    return clean(out);
}

/** LRC 解析三态：
 *  · empty   —— 没给、给的是空白、或时长不可用；
 *  · untimed —— 一行时间标签都没有（源按字数平均分配，本件明示 mode）；
 *  · timed   —— 至少有一行带标签。
 *  源对坏行一律 continue（丢了几行一个字都不报）；本件逐类报 dropped。 */
export function parseLrcText(text, opts) {
    const o = opts || {};
    const duration = o.duration;
    const str = strOf(text);
    const dropped = { noTime: [], noText: 0, meta: 0 };
    if (!str.trim()) return { mode: 'empty', timed: false, cues: [], dropped, lines: 0 };
    const raw = str.split(CHAR_NL);
    const entries = [];
    let anyStamp = false;
    const plain = [];
    const loose = [];
    for (let i = 0; i < raw.length; i++) {
        const line = raw[i].split(CHAR_CR).join('');
        if (line.length > PV_LRC_LINE_MAX) {
            dropped.noTime.push({ line: i + 1, saw: line.slice(0, 24), why: 'too_long' });
            continue;
        }
        if (isMetaLine(line)) { dropped.meta += 1; continue; }
        const spans = readTimes(line);
        if (spans.length === 0) {
            /* ★ 没时间标签的行先收着 —— 它是**哪一种**要等全篇看完才知道：
             *   · 通篇一行标签都没有 ⇒ 这是 untimed 模式的正文（按字数排）；
             *   · 别处有标签、就这几行没有 ⇒ 这是**坏行**，逐条报 no_stamp。
             *   源对两种情形一律 continue，于是「这首歌本来就没时间戳」与
             *   「刚才那段被截断了」在用户眼里同形。 */
            const body = stripTags(line, []);
            if (body) loose.push({ line: i + 1, text: body });
            continue;
        }
        anyStamp = true;
        const body = stripTags(line, spans);
        for (let k = 0; k < spans.length; k++) {
            entries.push({ t: spans[k].t, text: body });
        }
    }
    if (!anyStamp) {
        for (let i = 0; i < loose.length; i++) plain.push(loose[i].text);
        return { mode: 'untimed', timed: false, cues: [], dropped, lines: raw.length, plain };
    }
    /* 有标签的行在场 ⇒ 那几行没标签的就是坏行（逐条报，不静默丢）。 */
    for (let i = 0; i < loose.length; i++) {
        dropped.noTime.push({ line: loose[i].line, saw: loose[i].text.slice(0, 24), why: 'no_stamp' });
    }
    entries.sort(function (x, y) { return x.t - y.t; });
    const offset = (typeof o.offset === 'number' && isFinite(o.offset)) ? o.offset : 0;
    const cues = [];
    for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (!e.text) { dropped.noText += 1; continue; }
        const next = entries[i + 1];
        let end = next ? next.t : (duration > 0 ? duration : e.t + PV_CAPTION_MIN);
        const t = e.t + offset;
        const e2 = end + offset;
        if (e2 <= t) end = e.t + PVC_LINE_FALLBACK;
        cues.push({ t, end: (e2 <= t) ? t + PVC_LINE_FALLBACK : e2, text: e.text, main: '', sub: null });
    }
    for (let i = 0; i < cues.length; i++) {
        const sp = splitParen(cues[i].text);
        const cut = captionCut(sp.main, o.maxChars);
        cues[i].main = cut.main;
        cues[i].sub = sp.sub ? sp.sub : cut.sub;
    }
    return { mode: 'timed', timed: true, cues, dropped, lines: raw.length, plain };
}

const PVC_LINE_FALLBACK = 2;

/** 无时间戳歌词的正文行（源的 _pvLyricsPlainText）。 */
export function lyricsPlainText(text) {
    const str = strOf(text);
    const out = [];
    const raw = str.split(CHAR_NL);
    for (let i = 0; i < raw.length; i++) {
        const line = raw[i].split(CHAR_CR).join('');
        if (isMetaLine(line)) continue;
        const spans = readTimes(line);
        const body = stripTags(line, spans);
        if (body) out.push(body);
    }
    return out;
}

/** 按时刻找当前这一句（源的 _pvFindCueAt：区间左闭右开）。 */
export function findCueAt(cues, time) {
    const rows = Array.isArray(cues) ? cues : [];
    const t = (typeof time === 'number' && isFinite(time)) ? time : null;
    if (t === null) return { found: false, why: 'no_time', cue: null, index: -1 };
    if (rows.length === 0) return { found: false, why: 'empty', cue: null, index: -1 };
    for (let i = 0; i < rows.length; i++) {
        if (t >= rows[i].t && t < rows[i].end) return { found: true, why: '', cue: rows[i], index: i };
    }
    return { found: false, why: 'out_of_range', cue: null, index: -1 };
}

/** 秒表（视图不写格式化，统一走这里；源散布在多处）。 */
export function formatClock(sec) {
    const n = (typeof sec === 'number' && isFinite(sec) && sec >= 0) ? sec : null;
    if (n === null) return { text: '', ok: false };
    const total = Math.round(n * 10) / 10;
    const mm = Math.floor(total / 60);
    const ss = total - mm * 60;
    const ssText = ss < 10 ? '0' + ss : String(ss);
    return { text: (mm < 10 ? ('0' + mm) : String(mm)) + ':' + ssText, ok: true };
}

/** 时长档（源的 _pvDurationOptionsHtml：4 到 15 连续档，默认 10）。 */
export function durationOptions(min, max, selected) {
    const lo = (typeof min === 'number' && min > 0) ? min : PV_DURATION_MIN;
    const hi = (typeof max === 'number' && max > lo) ? max : PV_DURATION_MAX;
    const sel = (typeof selected === 'number') ? selected : PV_DURATION_DEFAULT;
    const out = [];
    for (let s = lo; s <= hi; s++) {
        out.push({ n: s, label: s + '秒', selected: s === sel });
    }
    return out;
}

/* ---------- 参考素材上限（源按渠道与模型分档） ---------- */
export function refsLimitOf(kind, wide) {
    const k = strOf(kind);
    if (k === 'audio') return wide ? 30 : 15;
    if (k === 'paint') return wide ? PV_REFS_MAX_WIDE : PV_REFS_MAX;
    return 0;
}

/* ---------- 收工检查（源是硬闸三处：镜头数 / 正文长度 / 素材件数） ---------- */
export function holdCheck(input) {
    const i = input || {};
    const shots = Array.isArray(i.shots) ? i.shots.length : 0;
    const chars = charCount(i.text);
    const figs = allFigNums(i.shots);
    const cast = Array.isArray(i.cast) ? i.cast.length : 0;
    const refs = Array.isArray(i.refs) ? i.refs.length : 0;
    const wide = i.wide === true;
    const rows = [];
    if (shots === 0) rows.push({ key: 'shots', ok: false, why: PV_HOLD_WHYS[5], saw: 0, limit: PV_SHOT_MAX });
    else if (shots > PV_SHOT_MAX) rows.push({ key: 'shots', ok: false, why: 'too_many', saw: shots, limit: PV_SHOT_MAX });
    else rows.push({ key: 'shots', ok: true, why: '', saw: shots, limit: PV_SHOT_MAX });
    if (chars > PV_HARD_LIMIT_CHARS) rows.push({ key: 'chars', ok: false, why: 'over_limit', saw: chars, limit: PV_HARD_LIMIT_CHARS });
    else rows.push({ key: 'chars', ok: true, why: '', saw: chars, limit: PV_HARD_LIMIT_CHARS });
    if (cast > PV_CAST_MAX) rows.push({ key: 'cast', ok: false, why: PV_HOLD_WHYS[3], saw: cast, limit: PV_CAST_MAX });
    else rows.push({ key: 'cast', ok: true, why: '', saw: cast, limit: PV_CAST_MAX });
    const refLimit = refsLimitOf('paint', wide);
    if (refs > refLimit) rows.push({ key: 'refs', ok: false, why: PV_HOLD_WHYS[4], saw: refs, limit: refLimit });
    else rows.push({ key: 'refs', ok: true, why: '', saw: refs, limit: refLimit });
    const fails = rows.filter(function (r) { return !r.ok; });
    return { rows, ok: fails.length === 0, fails: fails.length, figs, figures: figs.length };
}

/* ========================================================
 * 回信归一（源的题面由对话端给回；本件只认两种回信）
 * ======================================================== */
/** 题面回信：{ brief, title, duration, style, lens, mood } —— 认不出来的格一律报。 */
export function parseBriefReply(text) {
    const out = { brief: '', title: '', duration: null, style: '', lens: '', mood: '',
                  filled: {}, taken: [], extra: [], why: '', sawKeys: 0 };
    const src = clean(text);
    if (!src) { out.why = PV_PARSE_WHYS[0]; return out; }
    const lines = src.split(CHAR_NL);
    let saw = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = clean(lines[i]);
        if (!line) continue;
        const at = line.indexOf('：');
        const at2 = at >= 0 ? at : line.indexOf(':');
        if (at2 <= 0) { out.brief = out.brief ? out.brief + CHAR_NL + line : line; continue; }
        const key = line.slice(0, at2).trim();
        const val = line.slice(at2 + 1).trim();
        if (key === '时长' || key === 'duration') {
            const n = parseInt(val, 10);
            if (isFinite(n) && n >= PV_DURATION_MIN && n <= PV_DURATION_MAX) { out.duration = n; saw++; }
            else out.filled.duration = 'malformed';
            continue;
        }
        if (key === '标题' || key === 'title') { out.title = val; saw++; out.taken.push('title'); continue; }
        if (key === '风格' || key === 'style') { out.style = val; saw++; out.taken.push('style'); continue; }
        if (key === '镜头' || key === 'lens') { out.lens = val; saw++; out.taken.push('lens'); continue; }
        if (key === '情绪' || key === 'mood') { out.mood = val; saw++; out.taken.push('mood'); continue; }
        /* ★ 认不出的键**要留痕**：源把这行当正文收走，用户以为设置生效了。 */
        out.extra.push(key);
        out.brief = out.brief ? out.brief + CHAR_NL + line : line;
    }
    if (!out.brief) { out.why = PV_PARSE_WHYS[0]; return out; }
    out.brief = clean(out.brief);
    out.sawKeys = saw;
    if (chars(out.brief) === 0) out.why = PV_PARSE_WHYS[0];
    return out;
}

function chars(s) {
    return strOf(s).length;
}

/* ========================================================
 * 读数面（源把计数散在多处、且取不出来时报 0 个）
 * ======================================================== */
export const PV_READ_KEYS = Object.freeze(['shots', 'chars', 'cast', 'refs', 'cues', 'dropped']);

/** 空面（storage 不可用、或这本账压根没写过时读它）：
 *  ★ 六格一律 null —— **不许**给 0（源的 0 与「取不出来」同形）。 */
export function blankCover(reason) {
    const rows = {};
    for (let i = 0; i < PV_READ_KEYS.length; i++) rows[PV_READ_KEYS[i]] = null;
    return { ok: false, why: strOf(reason), rows, face: PV_FACES[3] };
}

/** 读数。src: { brief, shots, cast, refs, cues, dropped }
 *  每一格都返 { value, of, pct }；取不出来的为 null（视图画横线）。 */
export function readingsOf(src) {
    const s = src || {};
    const rows = {};
    const briefChars = charCount(s.brief);
    const shotRows = Array.isArray(s.shots) ? s.shots : [];
    const cueRows = Array.isArray(s.cues) ? s.cues : [];
    const castRows = Array.isArray(s.cast) ? s.cast : [];
    const refRows = Array.isArray(s.refs) ? s.refs : [];
    const wide = s.wide === true;
    rows.shots = gauge(shotRows.length, PV_SHOT_MAX);
    rows.chars = gauge(briefChars, PV_HARD_LIMIT_CHARS);
    rows.cast = { value: castRows.length, of: PV_CAST_MAX, pct: pct(castRows.length, PV_CAST_MAX) };
    const refLimit = refsLimitOf('paint', wide);
    rows.refs = { value: refRows.length, of: refLimit, pct: pct(refRows.length, refLimit) };
    rows.cues = gauge(cueRows.length, 0);
    const dropped = s.dropped || {};
    const noTime = Array.isArray(dropped.noTime) ? dropped.noTime.length : 0;
    const noText = (typeof dropped.noText === 'number') ? dropped.noText : 0;
    rows.dropped = gauge(noTime + noText, 0);
    const empty = !s.brief && shotRows.length === 0;
    const malformed = !empty && (s.malformed === true);
    let face = PV_FACES[0];
    if (empty) face = PV_FACES[1];
    else if (malformed) face = PV_FACES[2];
    return { ok: true, why: '', rows, face, wide };
}

function gauge(value, of) {
    return { value, of, pct: of > 0 ? pct(value, of) : null };
}

function pct(value, of) {
    if (!(of > 0)) return null;
    return Math.round((value / of) * 1000) / 10;
}
