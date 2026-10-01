/* ========================================================
 * magazine-data.js — [v3.36.0] 杂志 · 纯函数内核
 *
 * 缝合自 Perigee（`js/magazine.js` 1971 行 / 118212 字节、`magazine.css`
 * 20050 字节）。源是一个 **挂在全局 `AppState.data.magazineData` 上、
 * 与放送局 / 论坛 / TTS 三处联动的日文动画杂志仿真**：
 *   ① 十种稿件类型（声优访谈 / 制作组访谈 / 圆桌座谈 / 人气投票 /
 *      角色企划 / 制作专栏 / 读者来函 / 角色对谈 / 关系图 / 月度总结）
 *   ② 列表与阅读面（封面 / 期号 / 类型徽标 / 按类型分发正文渲染）
 *   ③ 十套正文解析器（Q&A / 排行卡 / 角色卡 / 读者信与回信 / 对谈 /
 *      关系图 SVG / 专栏段落 / 总结）
 *   ④ 导出面（单篇 TXT / 全刊 TXT / 全刊可打印 HTML / 长图）
 *   ⑤ 译文折叠块（日语正文 + 中文译文，`<details>` 折叠）
 *   ⑥ 联动面（存到放送局 / 音频剧 / 分享面板）
 *
 * ── 本件取哪几块 ────────────────────────────────────────
 *   取 ①②③④⑤ 六块；⑥ 只取「分享」的最小形态（产可复制文本），
 *   存到放送局与音频剧两条**联动链不缝**（见下）。
 *
 * ── 四块不缝（源里有、本仓明令禁止或有第二个权威的，逐条写后果）──
 *   ① **不直连任何模型**：源有 8 处 `Utils.callChatAPI`（访谈 / 投票 /
 *      企划 / 专栏 / 读者 / 对谈 / 关系图 / 总结各一条），自己拼
 *      systemPrompt、自己发请求、自己解析 `TITLE:` 行。本件一个网络调用
 *      都没有，只产「可复制的要求文本」，由用户贴回自己惯用的对话端；
 *      用户把结果贴回视图文本框，`ingestArticle()` 解析登记。
 *   ② **不碰宿主对象**：源把整块状态经 `Utils.saveData()` 回写
 *      （共 13 处命中）、`Utils.emitEvent('magazine_published')` 往宿主
 *      事件总线抛（8 处）、往 `AppState.data.broadcast.officialNpcs` 读人。
 *      本件零宿主写入、零宿主读，落 PhoneStorage 的**三条会话键**。
 *   ③ **不共用别的 App 的池**：源要 `broadcast.officialNpcs` 当受访者池、
 *      要 `Forum.getWorldContext()` 当世界观、要 `ttsConfig` 当音频出口。
 *      本件自带原创受访者池（`MAGAZINE_BUILT_IN_PEOPLE`，10 位），
 *      零跨 App 读 —— 兄弟 App 的池改了不该让本件静默变样。
 *   ④ **不动态加载外部脚本、不产二进制**：源 `exportImage()` 从
 *      jsdelivr CDN 动态插 `<script>` 拉 html2canvas，再把离屏 DOM 画成
 *      PNG data URL 触发下载。本件一条外链都不收、一张图都不产 ——
 *      导出面只有 TXT 与可打印 HTML 两种纯文本形态。
 *
 * ── 三条偏离（偏离不是遗漏，逐条写明）──
 *   ① **期号收成显式序号，不做数组位置反查**：源 `_getVolNum(article)`
 *      用 `articles.findIndex(...) + 1` 现算 —— 删掉中间一篇后，**后面
 *      所有篇的期号集体前移**（同一篇文章的期号会随删除而变，旧导出的
 *      TXT 与新读到的期号对不上）。本件在登记时就写下 `vol`（只增不减），
 *      期号是**事实**不是位置。
 *   ② **正文解析收成唯一实现，不吃「渲染顺序」**：源把十套解析器写成
 *      十个 `_renderXxxContent(lines)`，各自 `_stripMarkdown` 一遍、各自
 *      决定什么算「说明文」；同一行在不同类型下**归类不同**，且没有任何
 *      一处能回答「这行到底被识别成什么」。本件把「切块」与「渲染」拆开：
 *      `parseArticleBody(type, content)` 只产**结构**（块数组），视图只把
 *      结构画成 HTML，块类型是数据不是渲染副作用。
 *   ③ **译文块走白名单，不走转义器耦合**：源 `_escHtml` 直接转发
 *      `Utils.escapeHtml`，`<details>` 折叠块把整段译文转义后原样塞进
 *      `innerHTML` —— 译文里的任何标签都变成可见字符。本件把译文按
 *      「段落数组」存（`translationParagraphs`），视图逐段建元素，
 *      不拼 HTML 字符串，也不依赖任何转义器的输出形态。
 *
 * ── 本套件守的静默失效形态（都不报错、不崩溃，只是结果不对）──
 *   · 「没有这一篇」与「这一篇是空的」**不许塌成同一个读数**；
 *   · 「解析不出任何块」与「正文本来就是空的」**不许同形**（源在关系图
 *     里做了一次兜底，其余九套解析器**直接输出空 div** —— 页面看起来
 *     是「这篇文章没内容」，真处境是「解析器没认出来」）；
 *   · 「期号是 0 / 坏值」不许被当成「第 1 期」（源 `idx + 1` 一路加下去）；
 *   · 「受访者 id 查不到人」不许静默变成空串（源 `_getNpcNames` 用
 *     `.filter(Boolean)` 把查不到的人**整条抹掉** —— 三人访谈少一人，
 *     读者看不出来）。
 * ======================================================== */
'use strict';
import { numOrNull } from '../../config/num-gate.js';

/* ---------- 常量 ---------- */

/** 源的十种稿件类型。前三种是「访谈系列」（源用 `['seiyuu','staff','roundtable']`
 *  三个字面量在各处重复判断），后七种各自有专属解析器。 */
export const MAGAZINE_TYPES = [
    'seiyuu', 'staff', 'roundtable', 'poll', 'feature',
    'column', 'reader', 'charatalk', 'chart', 'roundup',
];

/** 「访谈系列」三型（源在渲染 / 音频剧资格 / 类型切换三处各写一遍同一数组）。 */
export const MAGAZINE_INTERVIEW_TYPES = ['seiyuu', 'staff', 'roundtable'];

/** 类型短标签（源 `_TYPE_LABELS` 十键，`I18n.t` 全部去掉 —— 本仓单语言）。 */
export const MAGAZINE_TYPE_LABELS = (() => {
    const raw = [
        ['seiyuu', '声优访谈'],
        ['staff', '制作组访谈'],
        ['roundtable', '圆桌座谈'],
        ['poll', '人气投票'],
        ['feature', '角色企划'],
        ['column', '制作专栏'],
        ['reader', '读者来函'],
        ['charatalk', '角色对谈'],
        ['chart', '关系图'],
        ['roundup', '月度总结'],
    ];
    const out = {};
    for (const pair of raw) out[pair[0]] = pair[1];
    return out;
})();

/** 类型配色（逐字搬源 `_TYPE_COLORS`，十键）。 */
export const MAGAZINE_TYPE_COLORS = (() => {
    const raw = [
        ['seiyuu', '#5856d6'], ['staff', '#ff9500'], ['roundtable', '#34c759'],
        ['poll', '#e0245e'], ['feature', '#1d9bf0'], ['column', '#8b5cf6'],
        ['reader', '#f59e0b'], ['charatalk', '#ec4899'], ['chart', '#06b6d4'],
        ['roundup', '#64748b'],
    ];
    const out = {};
    for (const pair of raw) out[pair[0]] = pair[1];
    return out;
})();

/** 角色企划八款模板（源 `_FEATURE_LABELS` 八键；`stripIcon` 去掉前置 emoji
 *  这一步在本仓不需要 —— 本件从一开始就不带 emoji，故**不手写第二份表**，
 *  直接用中文标签）。 */
export const MAGAZINE_FEATURE_TEMPLATES = (() => {
    const raw = [
        ['bag', '包里有什么'], ['wardrobe', '衣柜诊断'],
        ['camp', '合宿带什么'], ['food', '口味与推饭'],
        ['room', '房间软装妄想'], ['phone', '手机里的东西'],
        ['playlist', '歌单诊断'], ['custom', '自定义'],
    ];
    const out = {};
    for (const pair of raw) out[pair[0]] = pair[1];
    return out;
})();

/** 企划卡的图标（源 `_FEATURE_EMOJIS` 八键；本件换成与源同义的图形字符，
 *  避免 emoji 在不同平台宽度不一导致的排版漂移）。 */
export const MAGAZINE_FEATURE_ICONS = (() => {
    const raw = [
        ['bag', '◆'], ['wardrobe', '◇'], ['camp', '▲'], ['food', '●'],
        ['room', '■'], ['phone', '▣'], ['playlist', '♪'], ['custom', '★'],
    ];
    const out = {};
    for (const pair of raw) out[pair[0]] = pair[1];
    return out;
})();

/** 人气投票前三名的徽标（源 `_POLL_MEDALS`，键是**数字** —— 源写 `{1:'🥇'...}`，
 *  查表时 `parseInt(rank)` 拿数字键。本件保留数字键形态并显式记录这一点：
 *  写成字符串键会让 `medalOf(1)` 永远查不到，且**静默走兜底**（源就是这样
 *  用 `|| ''` 吞掉的）。 */
export const MAGAZINE_POLL_MEDALS = { 1: '金', 2: '银', 3: '铜' };

/** 关系图的箭头符号集（源在解析正则里写死 `⇔|→|←|↔` 四个）。 */
export const MAGAZINE_ARROW_KINDS = ['⇔', '→', '←', '↔'];

/** 关系图节点配色环（逐字搬源 `_CHART_COLORS`，十色）。 */
export const MAGAZINE_CHART_COLORS = [
    '#E91E63', '#2196F3', '#4CAF50', '#FF9800', '#9C27B0',
    '#00BCD4', '#F44336', '#3F51B5', '#009688', '#FF5722',
];

/** 源自己产的「读者来函 / 回信」两个行首标记（源解析器按这两个字符分流）。 */
export const MAGAZINE_LETTER_MARK = '来信';
export const MAGAZINE_REPLY_MARK = '回信';

/** 源自带受访者池（10 位）。源读 `broadcast.officialNpcs` —— 本仓**没有那个权威**，
 *  故自带池。`role` + `name` 两字段是源 `_getNpcNames` 拼显示名的输入。 */
export const MAGAZINE_BUILT_IN_PEOPLE = [
    { id: 'mg-p1', role: '声优', name: '白石 遥' },
    { id: 'mg-p2', role: '声优', name: '小仓 千夏' },
    { id: 'mg-p3', role: '监督', name: '黑川 悟' },
    { id: 'mg-p4', role: '系列构成', name: '野々宫 沙耶' },
    { id: 'mg-p5', role: '角色设计', name: '南 穗乃香' },
    { id: 'mg-p6', role: '音乐', name: '相马 律' },
    { id: 'mg-p7', role: '制片人', name: '大庭 龙之介' },
    { id: 'mg-p8', role: '原画', name: '藤枝 由佳' },
    { id: 'mg-p9', role: '编剧', name: '朝仓 真澄' },
    { id: 'mg-p10', role: '宣传', name: '东云 明里' },
];

/** 杂志名缺省值（源写死 `'Animage'` 共 9 处）。 */
export const MAGAZINE_DEFAULT_NAME = 'Animage';

/** 三态读数（与 pixiv / lofter 同款：认源函数不许用吞异常包装器）。 */
export const MAGAZINE_REASONS = {
    storage_absent: 'storage_absent',
    empty: 'empty',
    ok: 'ok',
};

/** 显式上界。源里这些数**全是无界增长**（文章数组、译文、正文行、受访者选择数
 *  都没有上限），本件一律给上界并在裁剪时如实回报。 */
export const MAGAZINE_LIMITS = {
    maxArticles: 60,
    maxPeoplePerArticle: 8,
    maxTitleChars: 120,
    maxBodyChars: 20000,
    maxTranslationChars: 20000,
    maxThemeChars: 200,
    maxBlocks: 400,
    maxChartNodes: 12,
    maxReaderPairs: 24,
    maxPromptChars: 4000,
};

/** 源 2026 硬规则：指令语言 ≠ 正文语言。逐字搬（本件只产要求文本，
 *  故这条规则**必须进文本**，否则中文指令会被原样搬进日语正文）。 */
export const MAGAZINE_PURITY_RULE = '写正文时不要复用指令里的语言：界面语言与指令可能是中文，但正文（标题、问题、回答、评语）一律按上面指定的正文语言书写。';

/** 块类型表（本件把「切块」与「渲染」拆开后，块类型是**数据**不是渲染副作用）。 */
export const MAGAZINE_BLOCK_KINDS = [
    'question',   // Q&A 里的提问行（源按 ―― / —— 行首分流）
    'answer',     // 「名字：回答」行（源用 `^([^：:]+)[：:](.*)$` 拆）
    'prose',      // 无冒号的普通正文行
    'gap',        // 空行（源渲染成 magazine-qa-gap）
    'rank',       // 人气投票的「N位　名字　XX%」行
    'comment',    // 投票卡下的读者评语「…」
    'card',       // 企划卡（源按 ◆ 行首分流）
    'cardline',   // 企划卡内的正文行
    'letter',     // 读者来函正文（源按 📮 行首分流）
    'reply',      // 编辑部回信（源按 📝 行首分流）
    'talk',       // 角色对谈台词（源按 `[名]「词」` 或 `名「词」` 拆）
    'narration',  // 对谈里的旁白
    'relation',   // 关系图的关系行（源按 `◆ A → B：描述` 拆）
    'note',       // 关系图的编者按（源按 ※ 行首分流）
];

/** 时间读数的**单位面**（`timeAgoFace` 的产出键）。视图的人话表必须用这些键
 *  建计算键 —— 手写一份就是第二个真源（数据层多一个单位，视图静默走兜底）。 */
export const MAGAZINE_TIME_UNITS = ['none', 'now', 'minute', 'hour', 'day'];

/* ---------- 基础取数 ---------- */

/** 坏号即 null（本仓纪律：补位置号会撞号、会错配下游按位置取的数据）。 */
export function clampInt(v, lo, hi, fallback) {
    const n = numOrNull(v);
    if (n === null) return fallback;
    const t = Math.trunc(n);
    if (t < lo) return lo;
    if (t > hi) return hi;
    return t;
}

/** 取字符串并按上界截断。返回 `{ text, trimmed }` —— 裁了多少**如实回报**，
 *  不静默吞（源各处 `String(x || '')` 一律静默）。 */
export function takeText(raw, max) {
    const s = typeof raw === 'string' ? raw : (raw === null || raw === undefined ? '' : String(raw));
    if (s.length <= max) return { text: s, trimmed: 0 };
    return { text: s.slice(0, max), trimmed: s.length - max };
}

/* ---------- 设置面 ---------- */

export function defaultMagazineSettings() {
    return {
        magazineName: MAGAZINE_DEFAULT_NAME,
        bodyLanguage: 'jp',       // 正文语言：jp / cn（源把语言混在 I18n 里，本件显式成一格）
        defaultType: 'seiyuu',
        showTranslation: true,
    };
}

export function normalizeMagazineSettings(raw) {
    const d = defaultMagazineSettings();
    if (!raw || typeof raw !== 'object') return d;
    const name = takeText(raw.magazineName, 40);
    const out = {
        magazineName: name.text.trim() || d.magazineName,
        bodyLanguage: raw.bodyLanguage === 'cn' ? 'cn' : 'jp',
        defaultType: MAGAZINE_TYPES.includes(raw.defaultType) ? raw.defaultType : d.defaultType,
        showTranslation: raw.showTranslation !== false,
    };
    return out;
}

/* ---------- 稿件规范化 ---------- */

/** 规范化一位受访者引用：查得到人给 `role・name`，**查不到人如实回报**。
 *  源 `_getNpcNames` 用 `.filter(Boolean)` 把查不到的人整条抹掉 ——
 *  三人访谈少一人，读者看不出来。本件返回 `{ names, missing }`。 */
export function resolvePeople(ids, pool) {
    const list = Array.isArray(ids) ? ids : [];
    const src = Array.isArray(pool) ? pool : [];
    const names = [];
    const missing = [];
    for (const id of list) {
        const hit = src.find((p) => p && p.id === id);
        if (!hit) { missing.push(String(id)); continue; }
        const role = typeof hit.role === 'string' ? hit.role : '';
        const name = typeof hit.name === 'string' ? hit.name : '';
        names.push(name ? (role ? role + '・' + name : name) : role);
    }
    return { names, missing, display: names.join(' × ') };
}

/** 规范化一篇稿件。`vol` 是**登记时写下的序号**（不是数组位置 —— 见文件头偏离①）。 */
export function normalizeArticle(raw, index) {
    const fallbackIdx = clampInt(index, 0, 1e9, 0);
    if (!raw || typeof raw !== 'object') return null;
    const type = MAGAZINE_TYPES.includes(raw.type) ? raw.type : 'seiyuu';
    const title = takeText(raw.title, MAGAZINE_LIMITS.maxTitleChars);
    const theme = takeText(raw.theme, MAGAZINE_LIMITS.maxThemeChars);
    const body = takeText(raw.content, MAGAZINE_LIMITS.maxBodyChars);
    const trans = takeText(raw.translation, MAGAZINE_LIMITS.maxTranslationChars);
    const ids = Array.isArray(raw.peopleIds) ? raw.peopleIds.slice(0, MAGAZINE_LIMITS.maxPeoplePerArticle) : [];
    const vol = clampInt(raw.vol, 1, 1e9, fallbackIdx + 1);
    const featureKey = Object.prototype.hasOwnProperty.call(MAGAZINE_FEATURE_TEMPLATES, raw.featureKey)
        ? raw.featureKey : null;
    const createdAt = numOrNull(raw.createdAt);
    return {
        id: typeof raw.id === 'string' && raw.id ? raw.id : 'mg-' + (fallbackIdx + 1),
        vol,
        type,
        peopleIds: ids,
        theme: theme.text,
        title: title.text || theme.text,
        content: body.text,
        translation: trans.text,
        featureKey,
        featureLabel: featureKey ? MAGAZINE_FEATURE_TEMPLATES[featureKey] : '',
        createdAt: createdAt === null ? 0 : Math.trunc(createdAt),
        trimmed: title.trimmed + theme.trimmed + body.trimmed + trans.trimmed,
    };
}

/** 规范化整本杂志（含期号去重：同一 `vol` 只留先出现的那个，冲突如实回报）。 */
export function normalizeMagazine(raw) {
    if (!raw || typeof raw !== 'object') return { name: MAGAZINE_DEFAULT_NAME, articles: [], dropped: 0, volConflicts: [] };
    const name = takeText(raw.magazineName, 40).text.trim() || MAGAZINE_DEFAULT_NAME;
    const arr = Array.isArray(raw.articles) ? raw.articles : [];
    const out = [];
    const seenVol = new Set();
    const volConflicts = [];
    let dropped = 0;
    for (let i = 0; i < arr.length; i++) {
        const a = normalizeArticle(arr[i], i);
        if (!a) { dropped++; continue; }
        if (seenVol.has(a.vol)) { volConflicts.push(a.vol); continue; }
        seenVol.add(a.vol);
        out.push(a);
        if (out.length >= MAGAZINE_LIMITS.maxArticles) break;
    }
    const over = arr.length - out.length - dropped;
    if (over > 0) dropped += over;
    return { name, articles: out, dropped, volConflicts };
}

/** 下一篇的期号：现有最大期号 + 1（**不是长度 + 1** —— 删过中间篇之后
 *  长度 + 1 会与既有期号撞号）。 */
export function nextVol(articles) {
    const arr = Array.isArray(articles) ? articles : [];
    let max = 0;
    for (const a of arr) {
        const v = numOrNull(a && a.vol);
        if (v !== null && v > max) max = Math.trunc(v);
    }
    return max + 1;
}

/** 按 id 取稿。返回 `{ article, found }` —— 「没有这一篇」与「这一篇是空的」
 *  不许塌成同一个读数。 */
export function findArticle(articles, id) {
    const arr = Array.isArray(articles) ? articles : [];
    const hit = arr.find((a) => a && a.id === id) || null;
    return { article: hit, found: !!hit };
}

/* ---------- 正文切块（唯一实现） ---------- */

/** 去 Markdown 格式符（逐字搬源 `_stripMarkdown` 的九条替换；源把这段
 *  写在 App 对象里，本件提到数据层 —— 解析与渲染都要用，只能有一份）。 */
/** ★ 反引号用 `String.fromCharCode(96)` 拼装、正则用 `new RegExp` 构造 ——
 *  **不许在代码里写裸反引号**：本仓判据共用的剥注释器是字符状态机、不解析正则字面量，
 *  一旦正则里出现裸反引号，剥器就把它当成模板串起头、**从那一行往后再也不复位**，
 *  文件尾注释里的词会被当成代码（v3.31.0 在 date-view、v3.35.0 在 pixiv 的 `_esc` 上
 *  各踩过一次）。 */
const BT = String.fromCharCode(96);
const MD_CODE_RE = new RegExp(BT + '([^' + BT + ']+)' + BT, 'g');
export function stripMarkdown(str) {
    return String(str || '')
        .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(MD_CODE_RE, '$1')
        .replace(/(^|\n)\*+\s+/g, '$1')
        .replace(/(^|\n)#{1,6}\s+/g, '$1')
        .replace(/(^|\n)>\s*/g, '$1')
        .replace(/(^|\n)\d+\.\s+/g, '$1');
}

/** 投票行解析：「N位　名字　XX%」（源正则 `^(\d+)位[\s　]+(.+?)[\s　]+(\d+[\.\d]*%)`）。
 *  坏号即 null —— 源用 `parseInt(...)` 拿到 NaN 后 `|| 0` 兜底，于是
 *  「排名读坏了」与「排名真是 0」同形。 */
export function parseRankLine(line) {
    const m = String(line || '').match(/^(\d+)位[\s　]+(.+?)[\s　]+(\d+[\.\d]*%)/);
    if (!m) return null;
    return { rank: numOrNull(m[1]), name: m[2].trim(), pct: m[3] };
}

/** 评语行：「…」（源正则 `^「(.+)」$`）。 */
export function parseCommentLine(line) {
    const m = String(line || '').match(/^「(.+)」$/);
    return m ? m[1] : null;
}

/** 对谈行：`[名]「词」` 或 `名「词」`（源正则
 *  `^(?:\[([^\]]+)\]|([^「]+))「(.+)」?$` —— 注意源写的是「名」部分**可空**，
 *  于是 `「只有台词」` 这种行会命中并给出**空名**；本件把空名判成不命中，
 *  落 narration，如实保住「这是旁白」这个事实）。 */
export function parseTalkLine(line) {
    const m = String(line || '').match(/^(?:\[([^\]]+)\]|([^「]+))「(.+)」?$/);
    if (!m) return null;
    const name = (m[1] || m[2] || '').trim();
    if (!name) return null;
    return { name, dialogue: String(m[3] || '').replace(/」$/, '') };
}

/** 关系行：`◆ A → B：描述`（源正则 `^◆\s*(.+?)\s*(⇔|→|←|↔)\s*(.+?)[：:](.+)$`）。
 *  源在关系图解析里做了一次「认不出来就原文兜底」，其余九套解析器**直接
 *  输出空 div** —— 本件把兜底上收为**所有类型共用**的一条读数（见 parseArticleBody）。 */
export function parseRelationLine(line) {
    const m = String(line || '').match(/^◆\s*(.+?)\s*(⇔|→|←|↔)\s*(.+?)[：:](.+)$/);
    if (!m) return null;
    const a = m[1].trim();
    const b = m[3].trim();
    if (!a || !b) return null;
    return { from: a, to: b, arrow: m[2], desc: m[4].trim() };
}

/** 把正文切块。返回 `{ blocks, unknown }` —— `unknown` 是**非空但一个块都
 *  没产出的行数**。这是本件对源最贵那处形态的正面处置：源在关系图上兜了底、
 *  其余九套解析器直接输出空 div，于是「解析器没认出来」与「这篇文章没内容」
 *  在界面上**长得一模一样**。本件把 unknown 如实计数并给兜底块。 */
export function parseArticleBody(type, content) {
    const lines = String(content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const blocks = [];
    let unknown = 0;
    let currentCard = null;
    let currentRank = null;
    let mode = '';
    const push = (kind, payload) => {
        if (blocks.length >= MAGAZINE_LIMITS.maxBlocks) return false;
        blocks.push(Object.assign({ kind }, payload));
        return true;
    };
    for (const raw of lines) {
        const trimmed = stripMarkdown(raw.trim());
        if (!trimmed) { push('gap', {}); continue; }
        if (type === 'poll') {
            const r = parseRankLine(trimmed);
            if (r) { currentRank = r; push('rank', r); continue; }
            const c = parseCommentLine(trimmed);
            if (c && currentRank) { push('comment', { text: c, rank: currentRank.rank }); continue; }
            if (!currentRank) { push('prose', { text: trimmed }); continue; }
            unknown++;
            push('prose', { text: trimmed, unparsed: true });
            continue;
        }
        if (type === 'feature') {
            if (trimmed.startsWith('◆')) {
                currentCard = trimmed.replace(/^◆\s*/, '').trim();
                push('card', { name: currentCard });
                continue;
            }
            if (currentCard) { push('cardline', { text: trimmed }); continue; }
            push('prose', { text: trimmed });
            continue;
        }
        if (type === 'reader') {
            if (trimmed.startsWith(MAGAZINE_LETTER_MARK)) {
                mode = 'letter';
                push('letter', { text: trimmed, header: true });
                continue;
            }
            if (trimmed.startsWith(MAGAZINE_REPLY_MARK)) {
                mode = 'reply';
                push('reply', { text: trimmed, header: true });
                continue;
            }
            if (mode === 'letter') { push('letter', { text: trimmed }); continue; }
            if (mode === 'reply') { push('reply', { text: trimmed }); continue; }
            push('prose', { text: trimmed });
            continue;
        }
        if (type === 'charatalk') {
            const t = parseTalkLine(trimmed);
            if (t) { push('talk', t); continue; }
            push('narration', { text: trimmed });
            continue;
        }
        if (type === 'chart') {
            if (trimmed.startsWith('◆')) {
                const r = parseRelationLine(trimmed);
                if (r) { push('relation', r); continue; }
                unknown++;
                push('prose', { text: trimmed, unparsed: true });
                continue;
            }
            if (trimmed.startsWith('※')) { push('note', { text: trimmed }); continue; }
            push('prose', { text: trimmed });
            continue;
        }
        if (type === 'column' || type === 'roundup') {
            push('prose', { text: trimmed });
            continue;
        }
        // 访谈系列（seiyuu / staff / roundtable）：Q&A
        if (trimmed.startsWith('――') || trimmed.startsWith('——')) {
            push('question', { text: trimmed });
            continue;
        }
        const m = trimmed.match(/^([^：:]+)[：:](.*)$/);
        if (m) {
            push('answer', { name: m[1].trim(), text: m[2].trim() });
            continue;
        }
        push('prose', { text: trimmed });
    }
    /* ★ 白名单校验产出：块 kind 必须在 `MAGAZINE_BLOCK_KINDS` 内 ——
     * 「解析器产出了一个没人认识的块」不许静默通过（源那十套解析器连
     * 「这行算被认出来了吗」都答不出来）。不在表内 ⇒ 如实计进 unknown。 */
    let stray = 0;
    for (const b of blocks) {
        if (!MAGAZINE_BLOCK_KINDS.includes(b.kind)) stray++;
    }
    return { blocks, unknown: unknown + stray, stray, total: blocks.length };
}

/** 结构 → 纯文本（导出面与「可复制文本」共用一份；不经过 HTML）。 */
export function blocksToText(blocks) {
    const arr = Array.isArray(blocks) ? blocks : [];
    const out = [];
    for (const b of arr) {
        if (!b || typeof b !== 'object') continue;
        switch (b.kind) {
            case 'gap': out.push(''); break;
            case 'question': out.push(b.text); break;
            case 'answer': out.push(b.name + '：' + b.text); break;
            case 'rank': out.push(b.rank + '位　' + b.name + '　' + b.pct); break;
            case 'comment': out.push('「' + b.text + '」'); break;
            case 'card': out.push('◆ ' + b.name); break;
            case 'cardline': out.push(b.text); break;
            case 'letter': out.push((b.header ? '' : '') + b.text); break;
            case 'reply': out.push((b.header ? '' : '') + b.text); break;
            case 'talk': out.push(b.name + '「' + b.dialogue + '」'); break;
            case 'narration': out.push(b.text); break;
            case 'relation': out.push('◆ ' + b.from + ' ' + b.arrow + ' ' + b.to + '：' + b.desc); break;
            case 'note': out.push(b.text); break;
            default: out.push(b.text || ''); break;
        }
    }
    return out.join('\n');
}

/* ---------- 关系图布局（纯函数：给结构，视图只画） ---------- */

/** 收集关系图的节点与边。源在渲染里顺手建 `charColorMap` 与
 *  `relationships` 两个局部变量 —— 于是「有几个节点」这个事实**只存在于
 *  渲染过程中**，测试拿不到、导出也拿不到。本件提成纯函数。 */
export function chartGraph(blocks, maxNodes) {
    const arr = Array.isArray(blocks) ? blocks : [];
    const limit = clampInt(maxNodes, 1, 1e6, MAGAZINE_LIMITS.maxChartNodes);
    const nodes = [];
    const edges = [];
    const notes = [];
    const plain = [];
    for (const b of arr) {
        if (!b || typeof b !== 'object') continue;
        if (b.kind === 'relation') {
            if (!nodes.includes(b.from)) nodes.push(b.from);
            if (!nodes.includes(b.to)) nodes.push(b.to);
            edges.push({ from: b.from, to: b.to, arrow: b.arrow, desc: b.desc });
        } else if (b.kind === 'note') {
            notes.push(b.text);
        } else if (b.kind !== 'gap') {
            plain.push(b.text || '');
        }
    }
    const over = Math.max(0, nodes.length - limit);
    const kept = nodes.slice(0, limit);
    const keptEdges = edges.filter((e) => kept.includes(e.from) && kept.includes(e.to));
    const droppedEdges = edges.length - keptEdges.length;
    const colors = {};
    kept.forEach((n, i) => { colors[n] = MAGAZINE_CHART_COLORS[i % MAGAZINE_CHART_COLORS.length]; });
    return { nodes: kept, colors, edges: keptEdges, notes, plain, droppedNodes: over, droppedEdges };
}

/** 环形布局坐标（源在渲染里现算 `cx + radius * cos(angle)`；本件提出来
 *  是为了让「节点落在画布内」这件事可判 —— 源没做任何越界检查）。 */
export function chartPositions(nodes, width, height) {
    const arr = Array.isArray(nodes) ? nodes : [];
    const w = clampInt(width, 1, 1e6, 360);
    const h = clampInt(height, 1, 1e6, 300);
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) * 0.35;
    const out = {};
    arr.forEach((name, i) => {
        const angle = (2 * Math.PI * i / Math.max(1, arr.length)) - Math.PI / 2;
        out[name] = {
            x: Math.round((cx + radius * Math.cos(angle)) * 100) / 100,
            y: Math.round((cy + radius * Math.sin(angle)) * 100) / 100,
        };
    });
    return { positions: out, cx, cy, radius, width: w, height: h };
}

/** 关系图兜底面：**没有任何节点**时，原文按纯文本行给回去（源在关系图上
 *  做了这件事、其余九套没做 —— 本件把兜底上收成所有类型的共同出口）。 */
export function chartFallback(blocks) {
    const arr = Array.isArray(blocks) ? blocks : [];
    const lines = [];
    for (const b of arr) {
        if (!b || typeof b !== 'object') continue;
        if (b.kind === 'gap') continue;
        if (b.kind === 'relation') lines.push('◆ ' + b.from + ' ' + b.arrow + ' ' + b.to + '：' + b.desc);
        else if (b.text) lines.push(b.text);
    }
    return lines;
}

/* ---------- 封面 / 期号 ---------- */

/** 封面读数（源 `_generateCoverHtml` 现拼 HTML 字符串，里面同时算期号、
 *  取类型标签、取配色 —— 本件只给**读数**，视图自己画）。 */
export function coverFace(article, magazineName) {
    if (!article || typeof article !== 'object') return null;
    const type = MAGAZINE_TYPES.includes(article.type) ? article.type : 'seiyuu';
    const vol = clampInt(article.vol, 1, 1e9, 1);
    return {
        magazineName: takeText(magazineName, 40).text.trim() || MAGAZINE_DEFAULT_NAME,
        vol,
        volLabel: 'VOL.' + vol,
        typeLabel: MAGAZINE_TYPE_LABELS[type],
        typeColor: MAGAZINE_TYPE_COLORS[type],
    };
}

/* ---------- 检索与分组 ---------- */

/** 四路命中：标题 / 主题 / 正文 / 类型标签。命中数有上界。
 *  源**没有检索面**（列表只能一篇篇翻），本件是本仓新增的机制。 */
export function searchArticles(articles, query, limit) {
    const arr = Array.isArray(articles) ? articles : [];
    const q = String(query || '').trim().toLowerCase();
    const lim = clampInt(limit, 1, 1e6, 30);
    if (!q) return { hits: [], total: 0, capped: false };
    const all = [];
    for (const a of arr) {
        if (!a || typeof a !== 'object') continue;
        const fields = [];
        const title = String(a.title || '').toLowerCase();
        const theme = String(a.theme || '').toLowerCase();
        const body = String(a.content || '').toLowerCase();
        const label = String(MAGAZINE_TYPE_LABELS[a.type] || '').toLowerCase();
        if (title.includes(q)) fields.push('title');
        if (theme.includes(q)) fields.push('theme');
        if (body.includes(q)) fields.push('body');
        if (label.includes(q)) fields.push('type');
        if (fields.length) all.push({ id: a.id, vol: a.vol, type: a.type, fields });
    }
    return { hits: all.slice(0, lim), total: all.length, capped: all.length > lim };
}

/** 命中的上下文片段（源无此面；本件给的是**只含原文**的片段，
 *  前后各 12 字，找不到就返回空串而不是补一个「…」）。 */
export function snippetOf(article, query, span) {
    if (!article || typeof article !== 'object') return '';
    const q = String(query || '');
    if (!q) return '';
    const s = span === undefined ? 12 : clampInt(span, 0, 200, 12);
    const body = String(article.content || '');
    const idx = body.toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return '';
    const lo = Math.max(0, idx - s);
    const hi = Math.min(body.length, idx + q.length + s);
    return body.slice(lo, hi).replace(/\n/g, ' ');
}

/** 按类型分组（源列表页只有一个「最新在前」的顺序；本件新增分组读数）。 */
export function groupByType(articles) {
    const arr = Array.isArray(articles) ? articles : [];
    const out = {};
    for (const t of MAGAZINE_TYPES) out[t] = 0;
    for (const a of arr) {
        const t = a && MAGAZINE_TYPES.includes(a.type) ? a.type : 'seiyuu';
        out[t] += 1;
    }
    return out;
}

/** 时间读数（源 `_timeAgo` 返回本地化文案；本件只给**事实**，
 *  文案由视图决定 —— 数据层不产界面语言）。 */
export function timeAgoFace(ts, now) {
    const t = numOrNull(ts);
    const U = MAGAZINE_TIME_UNITS;
    /** ★ 产出必须落在单位表内（不在表内 ⇒ 归 none 并如实回报，不静默放过）。 */
    const face = (unit, value) => (U.includes(unit) ? { unit, value } : { unit: 'none', value: 0, stray: unit });
    if (t === null || t <= 0) return face('none', 0);
    const base = numOrNull(now) === null ? Date.now() : Math.trunc(now);
    const diff = Math.max(0, base - Math.trunc(t));
    const m = Math.floor(diff / 60000);
    const h = Math.floor(diff / 3600000);
    const d = Math.floor(diff / 86400000);
    if (m < 1) return face('now', 0);
    if (m < 60) return face('minute', m);
    if (h < 24) return face('hour', h);
    return face('day', d);
}

/* ---------- 要求文本（替代源那八条直连链路） ---------- */

/** 产「可复制的要求文本」。源把同样的规则写在八条 `_generateXxx` 的
 *  systemPrompt 里（每条各写一遍、措辞还不一样）。本件收成唯一实现：
 *  同一份要求文本，用户粘到哪一端都成立。
 *  返回 `{ text, chars, capped }` —— 超上限如实回报（不静默截）。 */
export function magazinePromptBlock(type, payload) {
    const p = payload && typeof payload === 'object' ? payload : {};
    const t = MAGAZINE_TYPES.includes(type) ? type : 'seiyuu';
    const lines = [];
    lines.push('你是动画杂志「' + (takeText(p.magazineName, 40).text.trim() || MAGAZINE_DEFAULT_NAME) + '」的专职撰稿人。');
    lines.push('稿件类型：' + MAGAZINE_TYPE_LABELS[t]);
    if (p.theme) lines.push('主题：' + takeText(p.theme, MAGAZINE_LIMITS.maxThemeChars).text);
    if (Array.isArray(p.peopleNames) && p.peopleNames.length) {
        lines.push('受访者名单：');
        for (const n of p.peopleNames) lines.push('- ' + takeText(n, 60).text);
        lines.push('回答必须使用上列名单里的准确名字，不要另造人名。');
    }
    if (p.featureKey) {
        lines.push('企划模板：' + (MAGAZINE_FEATURE_TEMPLATES[p.featureKey] || p.featureKey));
    }
    const bodyLang = p.bodyLanguage === 'cn' ? '中文' : '日文';
    lines.push('正文语言：' + bodyLang + '。' + MAGAZINE_PURITY_RULE);
    lines.push('格式规则：');
    if (t === 'poll') {
        lines.push('- 每名一行：「N位　名字　XX%」（N 是名次、XX% 是得票率）');
        lines.push('- 名次行下面可以跟若干条读者评语，每条一行，用「」包起来');
    } else if (t === 'feature') {
        lines.push('- 每个角色一节，节首一行以 ◆ 开头，写角色名');
        lines.push('- 节内 2~4 句，贴合该角色的性格与口癖');
    } else if (t === 'reader') {
        lines.push('- 读者来函以「' + MAGAZINE_LETTER_MARK + '」开头一行，正文另起行');
        lines.push('- 编辑部回信以「' + MAGAZINE_REPLY_MARK + '」开头一行，正文另起行');
    } else if (t === 'charatalk') {
        lines.push('- 台词行写成「角色名「台词」」，旁白行直接写');
    } else if (t === 'chart') {
        lines.push('- 每段关系一行：「◆ A → B：关系描述」（箭头可用 ⇔ → ← ↔）');
        lines.push('- 需要说明的地方以 ※ 开头单独一行');
    } else if (t === 'column' || t === 'roundup') {
        lines.push('- 按自然段书写，段落之间空一行');
    } else {
        lines.push('- 记者的提问以 ―― 开头单独一行');
        lines.push('- 回答写成「名字：回答」，名字用上列名单里的准确名字');
        lines.push('- 合计 6~10 组问答（圆桌座谈最多 12 组）');
    }
    lines.push('- 纯文本，不要使用任何 Markdown 记号（不要 **、*、_、#、也不要行首列表符）');
    lines.push('不要编造世界观里没有的剧情走向、角色变化或结局；不要剧透后续。');
    lines.push('输出第一行写成 TITLE: [稿件标题]，随后直接写正文。');
    const text = lines.join('\n');
    const cap = MAGAZINE_LIMITS.maxPromptChars;
    if (text.length <= cap) return { text, chars: text.length, capped: false };
    return { text: text.slice(0, cap), chars: cap, capped: true };
}

/* ---------- 落地解析（用户把生成结果贴回来） ---------- */

/** 从模型输出里拆出 `TITLE:` 行与正文（源用同一对正则处理全部八条链路；
 *  本件收成唯一实现）。 */
export function splitTitleAndBody(response) {
    const s = String(response || '');
    const m = s.match(/^[\*\#\s]*TITLE:[\*\#\s]*(.+)/im);
    /* ★ 先剥**尾部孤立的星号**再走 stripMarkdown：源那条正则的 `[\*\#\s]*` 会吃掉
     *  `**TITLE:**` 的**前导** `**`，捕获组于是只剩尾部的 `**`（`加粗标题**`）——
     *  而 stripMarkdown 的成对记号剥不掉单个尾部记号，会原样渲染出来。
     *  这是本件相对源的一处**改进**（源那八条链路一直带着这个尾巴）。 */
    const title = m ? stripMarkdown(m[1].trim().replace(/\*+$/, '').trim()) : '';
    const body = s.replace(/^[\*\#\s]*TITLE:[\*\#\s]*.+\n?/im, '').trim();
    return { title, body };
}

/** 登记一篇稿件（用户贴回结果 → 结构 → 落库）。`existing` 是现有稿件数组。
 *  返回 `{ articles, article, dropped, volConflict }`。
 *  ★ 这里**不做任何生成**：源在这一步发请求、本件只解析用户贴回来的文本。 */
export function ingestArticle(input, existing) {
    const arr = Array.isArray(existing) ? existing : [];
    const p = input && typeof input === 'object' ? input : {};
    const split = p.response ? splitTitleAndBody(p.response) : { title: '', body: '' };
    const type = MAGAZINE_TYPES.includes(p.type) ? p.type : 'seiyuu';
    const vol = nextVol(arr);
    const raw = {
        id: typeof p.id === 'string' && p.id ? p.id : 'mg-' + vol,
        vol,
        type,
        peopleIds: p.peopleIds,
        theme: p.theme,
        title: p.title || split.title || p.theme || '',
        content: p.content || split.body || '',
        translation: p.translation || '',
        featureKey: p.featureKey,
        createdAt: numOrNull(p.createdAt) === null ? Date.now() : Math.trunc(p.createdAt),
    };
    const a = normalizeArticle(raw, arr.length);
    if (!a) return { articles: arr.slice(), article: null, dropped: 1, volConflict: false, reason: 'bad_input' };
    const conflict = arr.some((x) => x && x.vol === a.vol);
    const next = arr.slice();
    next.push(a);
    let dropped = 0;
    while (next.length > MAGAZINE_LIMITS.maxArticles) { next.shift(); dropped++; }
    return { articles: next, article: a, dropped, volConflict: conflict, reason: 'ok' };
}

/** 译文段落数组（源把整段译文转义后塞进 innerHTML —— 见文件头偏离③）。
 *  本件按空行切段，视图逐段建元素。 */
export function translationParagraphs(text) {
    const s = String(text || '');
    if (!s) return [];
    return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean);
}

/* ---------- 导出（纯文本形态，不产二进制、不加载外部脚本） ---------- */

/** 单篇 TXT（源 `exportTxt` 逐行 push，本件走 blocksToText 的同一份实现 ——
 *  导出与屏幕必须同源，否则「屏幕上有的导出后没了」）。 */
export function articleToText(article, magazineName, peoplePool) {
    if (!article || typeof article !== 'object') return '';
    const people = resolvePeople(article.peopleIds, peoplePool);
    const parsed = parseArticleBody(article.type, article.content);
    const lines = [];
    lines.push('【' + (takeText(magazineName, 40).text.trim() || MAGAZINE_DEFAULT_NAME) + '】' + (article.title || article.theme || ''));
    lines.push('期号：VOL.' + clampInt(article.vol, 1, 1e9, 1));
    lines.push('类型：' + (MAGAZINE_TYPE_LABELS[article.type] || article.type));
    lines.push('受访者：' + (people.display || '—'));
    if (people.missing.length) lines.push('（有 ' + people.missing.length + ' 位受访者查不到人，已如实留空）');
    lines.push('');
    lines.push('─'.repeat(30));
    lines.push('');
    lines.push(blocksToText(parsed.blocks));
    if (article.translation) {
        lines.push('');
        lines.push('─'.repeat(30));
        lines.push('【中文译文】');
        lines.push('');
        lines.push(stripMarkdown(article.translation));
    }
    return lines.join('\n');
}

/** 全刊 TXT（源 `exportAllTxt`）。 */
export function magazineToText(magazine, peoplePool) {
    const m = magazine && typeof magazine === 'object' ? magazine : { name: MAGAZINE_DEFAULT_NAME, articles: [] };
    const arr = Array.isArray(m.articles) ? m.articles : [];
    const name = takeText(m.name, 40).text.trim() || MAGAZINE_DEFAULT_NAME;
    const lines = ['《' + name + '》合订本', '共 ' + arr.length + ' 篇'];
    for (const a of arr) {
        lines.push('');
        lines.push('='.repeat(30));
        lines.push('');
        lines.push(articleToText(a, name, peoplePool));
    }
    return lines.join('\n');
}

/** 可打印 HTML 的**结构**（源 `_buildPrintableArticleHtml` 现拼整页 HTML
 *  字符串，含 `<div class="p-pagenum">` 等；本件只给结构，视图建元素）。
 *  返回的行对象里**只有纯文本**，不含任何 HTML 片段。 */
export function printableArticle(article, magazineName, peoplePool) {
    if (!article || typeof article !== 'object') return null;
    const people = resolvePeople(article.peopleIds, peoplePool);
    const parsed = parseArticleBody(article.type, article.content);
    const rows = [];
    for (const b of parsed.blocks) {
        if (!b || typeof b !== 'object') continue;
        if (b.kind === 'gap') { rows.push({ cls: 'gap', text: '' }); continue; }
        if (b.kind === 'question') { rows.push({ cls: 'q', text: b.text }); continue; }
        if (b.kind === 'answer') { rows.push({ cls: 'a', text: b.name + '：' + b.text }); continue; }
        if (b.kind === 'card') { rows.push({ cls: 'card', text: '◆ ' + b.name }); continue; }
        if (b.kind === 'relation') { rows.push({ cls: 'rel', text: '◆ ' + b.from + ' ' + b.arrow + ' ' + b.to + '：' + b.desc }); continue; }
        if (b.text) rows.push({ cls: 'a', text: b.text });
    }
    return {
        magazineName: takeText(magazineName, 40).text.trim() || MAGAZINE_DEFAULT_NAME,
        volLabel: 'VOL.' + clampInt(article.vol, 1, 1e9, 1),
        title: article.title || article.theme || '',
        typeLabel: MAGAZINE_TYPE_LABELS[article.type] || article.type,
        peopleLine: people.display,
        rows,
        unknownBlocks: parsed.unknown,
    };
}

/* ---------- 落盘投影 ---------- */

/** 投影（源没有这一层：它直接把 `AppState.data.magazineData` 整个丢给
 *  `Utils.saveData()`）。本件把「存什么」显式化，且**只存纯数据**。 */
export function projectMagazine(input) {
    const s = normalizeMagazineSettings(input && input.settings);
    const m = normalizeMagazine(input && input.content);
    return {
        settings: s,
        content: { name: m.name, articles: m.articles },
        dropped: m.dropped,
        volConflicts: m.volConflicts,
    };
}

/** 空态读数（「还没有稿件」与「读不出来」不许同形）。 */
export function emptyFace(reason) {
    const r = Object.prototype.hasOwnProperty.call(MAGAZINE_REASONS, reason) ? reason : MAGAZINE_REASONS.empty;
    return {
        reason: r,
        canWrite: r === MAGAZINE_REASONS.ok || r === MAGAZINE_REASONS.empty,
        articles: 0,
    };
}
