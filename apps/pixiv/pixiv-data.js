/* ========================================================
 * pixiv-data.js — [v3.35.0] Pixiv · 纯函数内核
 *
 * 缝合自 Perigee（`js/pixiv-illust.js` 1411 行 / 80350 字节、
 * `js/pixiv-novel.js` 3888 行 / 213700 字节、`js/pixiv-comments.js`
 * 563 行 / 30713 字节，三片共 5862 行 / 324763 字节）。源是一个
 * **挂在全局 `AppState.data.pixivData` 上、共用推特粉丝池与 CP 设定**
 * 的日文同人平台（真 pixiv）仿真：
 *   ① 插画面      （AI 生图 → 落 IndexedDB Blob → 网格画廊 → 收藏 / 分享）
 *   ② 小说面      （AI 生成连载 → 阅读器 → 目录 / 档C 心数 / 追更 / 出版）
 *   ③ 评论区      （章节级楼中楼，「コメントを読み込む」伪装成加载动作的按需生成）
 *   ④ 个人面      （收藏 / 追更 / 浏览记录 / 我的作品 / 设置四套子页）
 *   ⑤ 设置面      （文风库 / 语言模式 / 世界书绑定 / 论坛联动）
 *   ⑥ 翻译折叠面  （日语正文 + `<details class="tl">` 中文译文白名单清洗）
 *
 * ── 本件取哪几块 ────────────────────────────────────────
 *   取：②③④⑤⑥ 与 ① —— ① 但**换形态**：源的插画面是「自己调生图 API 拿
 *   Blob 落库」，本仓不许发网络调用，故本件把它缝成**登记面**：登记「我
 *   画了什么」（提示词 / 尺寸 / 张数 / 收藏），不存任何图与地址。
 *
 * ── 四块不缝（源里有、本仓明令禁止或有第二个权威的，逐条写后果）──
 *   ① **不直连任何模型**：源三片共 19 处网络调用（`Utils._fetchWithTimeout`
 *      18 处 + `Utils.callChatAPI` 10 处），自己读 `imageApiConfig.provider`、
 *      自己挑 NovelAI / OpenAI 兼容 / OpenRouter 三条链路、自己拼 systemPrompt
 *      发 POST。本件一个网络调用都没有，只产「可注入的结构」与「可复制的
 *      要求文本」，由宿主生成侧与用户自己完成。
 *   ② **不落 IndexedDB / 不碰宿主对象**：源把插画 Blob 落 IndexedDB
 *      （`IllustGallery`），把小说与评论整块经 `Utils.saveData()` 回写
 *      （`saveData` 共 38 处命中），还把卡片往宿主消息数组里 push。
 *      本件零数据库、零宿主写入，落 PhoneStorage 的**三条会话键**。
 *   ③ **不共用别的 App 的池**：源要 `twitterData.fanFriends` 当作者池
 *      （`_pickWriterWeighted` / `doujin_writer` 过滤）、要 `broadcast.plotProgress`
 *      当题材源、要 `forumData.threads` 当分享出口。本仓**没有这个权威** ——
 *      故本件自带原创作者池（`PIXIV_BUILT_IN_AUTHORS`），零跨 App 读，
 *      分享只产可复制文本。
 *   ④ **一张图都不存、一条外链都不收**：源存生图 URL 与外链封面、
 *      把 Blob 转 base64 data URL 塞进帖子。本件只登记「尺寸 / 张数 /
 *      提示词文本」三个字段，没有任何 URL、没有图片扩展名、没有 data URL。
 *
 * ── 三条偏离（偏离不是遗漏，逐条写明）──
 *   ① **心数模型收成唯一确定性实现**：源 `_rollHeatBase(fc)` 用
 *      `Math.random()` 掷爆点（2% 大爆 / 8% 中爆 / 20% 小爆 / 70% 无加成），
 *      `_rollChapterHearts` 再乘积一次随机 —— 同一作品每次读到的数不一样，
 *      且「最高章心数」缓存 `novel.hearts` 与逐章读数可能不自洽。
 *      本件收成 `deriveHearts(fc, cold)`：同一 `(fc, cold)` 必得同一读数，
 *      `novel.hearts === max(逐章 hearts)` 恒成立。
 *   ② **评论树深度有上限、上溯带访问集**：源 `_buildTree` 靠 `replyToCommentId`
 *      连边、`_topAncestorId` 上溯带 `guard < 50` 计数；数据自指（A 回 B、
 *      B 回 A）时只是在 50 步后停下，且**没有任何一处报告「这条被截了」**。
 *      本件深度有显式上限、上溯带 `seen` 访问集，自指即停并落在根，
 *      且截断条数如实进读数（不静默）。
 *   ③ **译文折叠块走白名单，不走正则还原**：源 `_sanitizeDetailsBlock`
 *      先整体转义再把白名单标签换回来，靠 `[^&]` 匹配属性 —— 该写法
 *      **与转义器耦合**：转义器一旦把 `'` 也转成 `&#39;`，带单引号属性的
 *      白名单标签就不再还原。本件把「白名单 + 属性白名单」写成数据表，
 *      不复用转义器的输出形态，转义器换了也不影响还原结果。
 *
 * ── 本套件守的静默失效形态（都不报错、不崩溃，只是结果不对）──
 *   · 「没有这条键」与「这条键是空数组」**不许塌成同一个读数**；
 *   · 「评论数是 0 条」与「评论还没读出来」**不许同形**（源用
 *     `ch.commentsLoaded` 一个 boolean 兼表两态，本件把它拆成三态面）；
 *   · 「章节号是 0」不许被当成「第 1 章」（源 `chIdx + 1` 一路加下去，
 *     坏值静默变成某一章号；本件一律 `numOrNull` 取，坏值即 null）；
 *   · 「生成中途被重写」不许把评论挂到旧对象上（源自己在注释里记了
 *     这条坑并靠重新 `_getChapter` 兜住，本件把它做成 `chapterIdentityFace` 读数）。
 * ======================================================== */
'use strict';
import { numOrNull } from '../../config/num-gate.js';

/* ---------- 常量 ---------- */

/** 源的 1 类「活跃」作者（`doujin_writer`，即同人写手 / 画手）。 */
export const PIXIV_ACTIVE_TYPES = ['doujin_writer'];
/** 源在 `_pickWriterWeighted` 之外会静默滤掉的三类号（官方 / 营销 / 情报站）。
 *  源只认 doujin_writer、其余**静默丢弃**；本仓不许静默 ⇒ 三类真实存在、
 *  由 `isActivePixivType` 显式滤掉并在读数里如实计数（非活跃 3）。 */
export const PIXIV_IDLE_TYPES = ['official', 'marketing', 'info_station'];
/** 作者类型的人话表（1 类活跃 + 3 类非活跃，键**现取真源**）。
 *  ★ 不手写键：手写的代价见桥契约门 J7 判据立据的那两处实伤 —— 键形与真源
 *    值差一个连接符，五态里三态查不到、全兜底成同一句「桥未连接」，
 *    而当时判据全绿。故本表由 IIFE 按
 *    `PIXIV_ACTIVE_TYPES.concat(PIXIV_IDLE_TYPES)` 的**顺序**填。 */
export const PIXIV_TYPE_LABELS = (() => {
    const humans = ['同人写手', '公式号', '推广号', '情报站'];
    const types = PIXIV_ACTIVE_TYPES.concat(PIXIV_IDLE_TYPES);
    const table = {};
    for (let i = 0; i < types.length; i++) table[types[i]] = humans[i] || types[i];
    return table;
})();

/** 内置作者池（源要宿主推特池；本件自带 9 位原创写手，零跨 App 读）。 */
export const PIXIV_BUILT_IN_AUTHORS = [
    { id: 'pxv_a_yukimura', name: '雪村いつき', type: 'doujin_writer', writingStyle: 'pixiv_style_lit', contentTags: ['オリジナル', '純愛', '日常'], bio: 'オリジナルの短編を中心に書いています。', builtIn: true },
    { id: 'pxv_a_amagase', name: '天ヶ瀬るい', type: 'doujin_writer', writingStyle: 'pixiv_style_knife', contentTags: ['切ない', 'BADEND', '再会'], bio: '切ない話ばかり書いてます。', builtIn: true },
    { id: 'pxv_a_kuroba', name: '黒羽みなと', type: 'doujin_writer', writingStyle: 'pixiv_style_comedy', contentTags: ['ギャグ', '会話劇', '学園'], bio: '会話劇が好きです。', builtIn: true },
    { id: 'pxv_a_shirakawa', name: '白川のぞみ', type: 'doujin_writer', writingStyle: 'pixiv_style_serious', contentTags: ['シリアス', '群像', '長編'], bio: '長編をのんびり更新しています。', builtIn: true },
    { id: 'pxv_a_tsukishiro', name: '月城かなで', type: 'doujin_writer', writingStyle: 'pixiv_style_poetic', contentTags: ['詩的', '幻想', '喩え'], bio: '言葉の音を大事にしています。', builtIn: true },
    { id: 'pxv_a_hoshino', name: '星野ゆめ', type: 'doujin_writer', writingStyle: 'pixiv_style_lit', contentTags: ['ほのぼの', '家族', '季節'], bio: '季節の話を書くのが好きです。', builtIn: true },
    { id: 'pxv_a_minase', name: '水瀬あおい', type: 'doujin_writer', writingStyle: 'pixiv_style_poetic', contentTags: ['SF', '静謐', '記憶'], bio: '静かな話を書いています。', builtIn: true },
    { id: 'pxv_a_fujimiya', name: '藤宮れん', type: 'doujin_writer', writingStyle: 'pixiv_style_serious', contentTags: ['ミステリ', '伏線', '現代'], bio: '伏線を張るのが趣味です。', builtIn: true },
    { id: 'pxv_a_official', name: 'pixiv公式', type: 'official', writingStyle: '', contentTags: [], bio: 'お知らせ用アカウントです。', builtIn: true },
];

/** 文风库（源 `getDefaultWritingStyles` 五款，rules 是真正喂进 prompt 的文风指令）。 */
export const PIXIV_WRITING_STYLES = [
    { id: 'pixiv_style_lit', name: '清新治愈系', description: '温暖细腻，注重情感流动', enabled: true, rules: '使用温柔的语气，细腻的心理描写，多用环境渲染情绪，句子偏长但不拖沓，善于捕捉细节和微妙情感' },
    { id: 'pixiv_style_knife', name: '刀子文学', description: '虐文风格，情感浓烈', enabled: true, rules: '善用对比和反转，情感描写浓烈，擅长刻画痛苦和遗憾，短句营造紧张感，多用情感冲击强烈的场景' },
    { id: 'pixiv_style_comedy', name: '轻松搞笑', description: '幽默诙谐，对话灵动', enabled: true, rules: '对话为主，语言活泼，善用网络梗和吐槽，节奏明快，多用短句，角色互动有趣生动' },
    { id: 'pixiv_style_serious', name: '正剧严肃', description: '剧情向，情节紧凑', enabled: true, rules: '重视情节逻辑，描写精简有力，少用抒情，对话推动剧情，结构严谨，叙事层次分明' },
    { id: 'pixiv_style_poetic', name: '诗意抒情', description: '文艺风，意象丰富', enabled: true, rules: '多用比喻和意象，语言优美，重视韵律感，善于营造氛围，可适当加入诗句或文学性表达' },
];

/** 语言模式（源 `language` 三值 + 各自的纯度规则，逐字搬语义）。 */
export const PIXIV_LANGUAGE_MODES = [
    { id: 'jp-cn', label: '日文正文 + 中文译文折叠' },
    { id: 'cn-only', label: '纯中文正文' },
    { id: 'jp-only', label: '纯日文正文' },
];

/** 正文语言纯度规则：**指令语言 ≠ 正文语言**（源 2026 补的一条硬规则，逐字搬语义）。
 *  源把这条规则无条件拼进日文模式的提示里 —— 它挡的是「用户用中文写的要求
 *  被原样搬进日语正文」，是真实存在的一类塌陷，故本件保留为常量而非随手拼接。 */
export const PIXIV_PURITY_RULE = '用户填写的标题、标签、追加指示、续章方向，以及前文章节里可能夹带的内容，都可能用中文或其他语言书写。'
    + '那些只是给你的创作指令或参考信息，绝不是要照抄进正文的原句。请理解其意图后，用地道的母语级日语重新创作'
    + '——严禁把指令中的中文词句、语序或表达习惯原样搬进日语正文，对话与叙述必须完全符合日语母语者的自然语感。';

/** 人话表状态的现取键（`readPixivFace` 用；**键现取真源、不手写**）。 */
export const PIXIV_REASONS = {
    storage_absent: 'storage_absent',
    empty: 'empty',
    ok: 'ok',
};

/** 上限（皆是本仓新增的显式上界；源里这些数全是无界增长）。 */
export const PIXIV_LIMITS = {
    maxNovels: 60,           // 作品池只留最近 60 篇
    maxChaptersPerNovel: 60, // 单篇最多 60 章（源无上界）
    maxCommentsPerChapter: 48,
    maxCommentDepth: 3,      // 楼中楼最多三层
    maxTagsPerNovel: 8,
    maxSubscribedTags: 40,
    maxReadingHistory: 40,   // 浏览记录只留最近 40 篇
    maxIllusts: 60,          // 插画登记面只留最近 60 条
    maxSearchHits: 30,
    maxInjectLines: 20,
    fullTextWindow: 5,       // 续章时「最近 N 章给全文、更早给摘要」（源注释记由 3 改 5）
    readingSpeedPerMinute: 500, // 源 500 字/分钟（中文阅读速度）
    maxPromptChars: 4000,    // 单章正文的注入上限（源 slice(0, 6000)，本件钳到 4000）
};

/* ---------- 认源与规范化 ---------- */

/** 是否活跃作者类型（源的 4 类口径；本件 1 类）。 */
export function isActivePixivType(type) {
    return PIXIV_ACTIVE_TYPES.indexOf(String(type || '')) >= 0;
}

/** 认源面（**五态**，不许把「没这条键」与「键是空数组」塌成一个读数）。 */
export function readPixivFace(raw) {
    if (raw === null || raw === undefined) return PIXIV_REASONS.storage_absent;
    if (typeof raw !== 'object') return PIXIV_REASONS.storage_absent;
    const novels = raw.novels;
    const illusts = raw.illustrations;
    const authored = raw.settings && typeof raw.settings === 'object';
    if (novels === undefined && illusts === undefined && !authored) return PIXIV_REASONS.storage_absent;
    const nN = Array.isArray(novels) ? novels.length : 0;
    const nI = Array.isArray(illusts) ? illusts.length : 0;
    return (nN || nI) ? PIXIV_REASONS.ok : PIXIV_REASONS.empty;
}

/** 文风库规范化：id 必填、name 必填、rules 截长、enabled 按真值收。 */
export function normalizeWritingStyles(raw) {
    const arr = Array.isArray(raw) ? raw : [];
    const out = [];
    for (let i = 0; i < arr.length; i++) {
        const s = (arr[i] && typeof arr[i] === 'object') ? arr[i] : {};
        const id = String(s.id || '').trim();
        const name = String(s.name || '').trim();
        if (!id || !name) continue;
        out.push({
            id,
            name,
            description: String(s.description || '').trim().slice(0, 60),
            rules: String(s.rules || '').trim().slice(0, 600),
            enabled: s.enabled !== false,
        });
        if (out.length >= 24) break;
    }
    return out;
}

/** 默认设置（源的 `settings` 结构，去掉所有绑外部的字段）。 */
export function defaultPixivSettings() {
    return {
        language: 'jp-cn',
        injectToPrompt: true,
        maxInjectLines: 8,
        styleId: '',
        novelRules: '',
        customPrompt: '',
        writingStyles: PIXIV_WRITING_STYLES.map((s) => Object.assign({}, s)),
        showInvalidNovels: false,
        fontSize: 16,
    };
}

/** 设置规范化：未知字段不进、语言按白名单收、条数钳住、文风库过一遍规范化。 */
export function normalizePixivSettings(raw) {
    const d = defaultPixivSettings();
    const s = (raw && typeof raw === 'object') ? raw : {};
    const langs = PIXIV_LANGUAGE_MODES.map((m) => m.id);
    const language = langs.indexOf(String(s.language || '')) >= 0 ? String(s.language) : d.language;
    const styleId = String(s.styleId || '').trim();
    const rawStyles = Array.isArray(s.writingStyles) ? s.writingStyles : d.writingStyles;
    let styles = normalizeWritingStyles(rawStyles);
    if (!styles.length) styles = normalizeWritingStyles(d.writingStyles);
    const fs = numOrNull(s.fontSize);
    return {
        language,
        injectToPrompt: s.injectToPrompt !== false,
        maxInjectLines: clampInt(numOrNull(s.maxInjectLines), 1, PIXIV_LIMITS.maxInjectLines, d.maxInjectLines),
        styleId: styles.some((x) => x.id === styleId) ? styleId : '',
        novelRules: String(s.novelRules || '').trim().slice(0, 800),
        customPrompt: String(s.customPrompt || '').trim().slice(0, 2000),
        writingStyles: styles,
        showInvalidNovels: s.showInvalidNovels === true,
        fontSize: clampInt(fs, 12, 24, d.fontSize),
    };
}

/** 整数夹紧（坏值取默认，不塌成 0）。 */
export function clampInt(v, lo, hi, fallback) {
    if (v === null) return fallback;
    const n = Math.trunc(v);
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
}

/** 单条评论规范化（`replyToCommentId` 空串即 null，**不许塌成 ''**）。 */
export function normalizeComment(raw, index) {
    const c = (raw && typeof raw === 'object') ? raw : {};
    const id = String(c.id || ('c' + (index + 1)));
    const liked = numOrNull(c.likes);
    return {
        id,
        author: String(c.author || '').trim(),
        content: String(c.content || '').trim(),
        replyToCommentId: c.replyToCommentId ? String(c.replyToCommentId) : null,
        likes: liked === null ? 0 : Math.max(0, Math.trunc(liked)),
        isOpReply: c.isOpReply === true,
        from: (c.from === 'me') ? 'me' : null,
        createdAt: numOrNull(c.createdAt) === null ? 0 : Math.trunc(numOrNull(c.createdAt)),
    };
}

/** 单章规范化。★ 章的三个状态位**各自独立**，不许合并成一个 boolean。 */
export function normalizeChapter(raw, index) {
    const c = (raw && typeof raw === 'object') ? raw : {};
    const big = numOrNull(c.hearts);
    const boost = numOrNull(c.likeBoost);
    const list = Array.isArray(c.commentsList) ? c.commentsList : [];
    const commentsList = list.slice(0, PIXIV_LIMITS.maxCommentsPerChapter)
        .map((x, i) => normalizeComment(x, i));
    return {
        // ★ 坏号与「没给」都是 null —— **不许静默补成位置号**：补号会与相邻章撞号
        //   （目录两格同号、按号查找只找得到第一条 ⇒ 点一格进另一条），且与纪律区
        //   的「坏值即 null」自相矛盾。条数不受影响：`normalizeNovel` 不滤坏号章。
        // ★ 下界是 **0 不是 1**：0 是合法章号（序章 / 第 0 話）。首版写 `Math.max(1, ...)`
        //   把「显式给的 0」抬成 1 —— 篡改给定数据，且会与既有 num=1 的章撞号。
        num: numOrNull(c.num) === null ? null : Math.max(0, Math.trunc(numOrNull(c.num))),
        title: String(c.title || '').trim(),
        content: String(c.content || ''),
        synopsis: String(c.synopsis || '').trim().slice(0, 300),
        wordCount: numOrNull(c.wordCount) === null ? 0 : Math.max(0, Math.trunc(numOrNull(c.wordCount))),
        hearts: big === null ? 0 : Math.max(0, Math.trunc(big)),
        likeBoost: boost === null ? 0 : Math.max(0, Math.trunc(boost)),
        isLiked: c.isLiked === true,
        commentsList,
        // ★ 三态分开：源用一个 boolean `commentsLoaded` 兼表
        //   「没读过」「读出来了是空的」「读过且有条」——本件留三个位。
        commentsLoaded: c.commentsLoaded === true,
        commentsAttempted: c.commentsAttempted === true,
        commentsFailed: c.commentsFailed === true,
        createdAt: numOrNull(c.createdAt) === null ? 0 : Math.trunc(numOrNull(c.createdAt)),
        language: String(c.language || '').trim(),
    };
}

/** 作品（小说）规范化。
 *  ★ `chapters` 必须**在这里保住**：源在 `renderNovelList` 之外多处直接读
 *    `novel.chapters`，任何一次「规范化时丢掉引用型字段」都会让重取后
 *    目录与正文整块消失，而 `novel.hearts` 缓存还在（视图显示「♡ 123」点进去空白，
 *    自洽地错）。这与老福特 `normalizeArticle` 丢 `comments` 是同一形态。 */
export function normalizeNovel(raw) {
    const n = (raw && typeof raw === 'object') ? raw : {};
    const tags = Array.isArray(n.tags)
        ? n.tags.map((t) => String(t || '').replace(/^#/, '').trim()).filter(Boolean).slice(0, PIXIV_LIMITS.maxTagsPerNovel)
        : [];
    const chRaw = Array.isArray(n.chapters) ? n.chapters : [];
    // ★ 原始章数组**原样带出**（`rawChapters`）：下游要靠它判「这一章给过心数没」，
    //   只能按下标配对 —— 按号配在下游、按号取会错配。
    const chKept = chRaw.slice(0, PIXIV_LIMITS.maxChaptersPerNovel);
    const chapters = chKept.map((c, i) => normalizeChapter(c, i));
    const heartN = numOrNull(n.hearts);
    const maxCh = chapters.reduce((mx, c) => Math.max(mx, c.hearts || 0), 0);
    return {
        id: String(n.id || ''),
        title: String(n.title || '').trim(),
        authorId: String(n.authorId || ''),
        authorName: String(n.authorName || '').trim(),
        synopsis: String(n.synopsis || '').trim().slice(0, 600),
        tags,
        isSerial: n.isSerial === true,
        completed: n.completed === true,
        isUserCreated: n.isUserCreated === true,
        chapters,
        // ★ 缓存值**必须与逐章读数一致**：源 `_recalcNovelHearts` 只在创建 /
        //   迁移时算一次，之后重写单章会让缓存与逐章永久不一致。
        //   本件在这里一律**以逐章为准**（有章就不看存量值）—— 首版写成
        //   `Math.max(maxCh, 存量)`，于是「比逐章大的存量值」照样留着：
        //   视图显示缓存那个大数、逐章最高却是小数，正是本件要挡的那类自洽错。
        // ★ 有**可数章**（num 非 null）就以逐章最高为准；全是坏号章时才退回存量值
        //   （否则一条坏号章会把整个作品的缓存心数拉成 0）。
        hearts: chapters.some((c) => c.num !== null) ? maxCh
            : (chapters.length ? ((heartN === null || heartN < maxCh) ? maxCh : Math.trunc(heartN))
                : (heartN === null ? 0 : Math.max(0, Math.trunc(heartN)))),
        styleId: String(n.styleId || ''),
        createdAt: numOrNull(n.createdAt) === null ? 0 : Math.trunc(numOrNull(n.createdAt)),
        updatedAt: numOrNull(n.updatedAt) === null ? 0 : Math.trunc(numOrNull(n.updatedAt)),
        lastReadAt: numOrNull(n.lastReadAt) === null ? 0 : Math.trunc(numOrNull(n.lastReadAt)),
    };
}

/** 插画登记条规范化（**没有 URL、没有 data URL、没有图片扩展名**）。 */
export function normalizeIllust(raw, index) {
    const i = (raw && typeof raw === 'object') ? raw : {};
    const cnt = numOrNull(i.count);
    return {
        id: String(i.id || ('i' + (index + 1))),
        prompt: String(i.prompt || '').trim().slice(0, 600),
        negativePrompt: String(i.negativePrompt || '').trim().slice(0, 300),
        size: String(i.size || '').trim().slice(0, 16),
        count: clampInt(cnt, 0, 9, 0),
        isFavorite: i.isFavorite === true,
        // ★ 源在这里存的是 `provider`（哪条生图链路出的图）——本件**不存**：
        //   没有链路，存一个恒为空的 provider 字段就是造假读数。改为记「谁画的」。
        drawnBy: String(i.drawnBy || '').trim(),
        createdAt: numOrNull(i.createdAt) === null ? 0 : Math.trunc(numOrNull(i.createdAt)),
    };
}

/* ---------- 档C 心数模型（确定性） ---------- */

/** 作品 id 派生「冷门系数」（确定性、可复算）。
 *  源用随机数掷爆点与逐章心数；本件把它换成 id 派生 —— 同一作品读数恒定。 */
export function coldOfNovelId(id) {
    const s = String(id || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1000003;
    return 2000 + (h % 18001);   // 2,000〜20,000（源 virtualFc 3,000〜20,000 的下界放宽一档）
}

/** 档C 热度基数：`fc × (0.01 + 冷门系数档位) × 爆点倍率`，上界 30000。
 *  源的爆点分布（2% 大爆 / 8% 中爆 / 20% 小爆 / 70% 无）保留为**档位表**，
 *  但档位由 `cold` 决定、不掷随机 ⇒ 同一 `(fc, cold)` 必得同一读数。 */
export function deriveHeatBase(fc, cold) {
    const f = numOrNull(fc);
    const c = numOrNull(cold);
    const base = f === null ? 0 : Math.max(0, Math.trunc(f));
    const band = c === null ? 0 : Math.abs(Math.trunc(c)) % 100;
    let mult = 1;
    if (band >= 98) mult = 8 + (band - 98) / 2;        // 2% 档：×8〜9
    else if (band >= 90) mult = 4 + (band - 90) / 3;   // 8% 档：×4〜7
    else if (band >= 70) mult = 1.8 + (band - 70) / 25; // 20% 档：×1.8〜3
    const factor = 0.01 + ((band % 3) / 100);          // 0.01〜0.03（源同一段的随机项）
    return Math.min(30000, Math.round(base * factor * mult));
}

/** 档C 逐章心数：`max(3, round(heatBase × 0.75〜1.25))`。
 *  `chapterNum` 决定落在 0.75〜1.25 的哪一格 ⇒ 逐章读数确定且**首章不恒最大**。 */
export function deriveChapterHearts(heatBase, chapterNum) {
    const hb = numOrNull(heatBase);
    const num = numOrNull(chapterNum);
    const base = hb === null ? 0 : Math.max(0, Math.trunc(hb));
    // ★ 下界 0：章号 0 合法（序章），若按 1 夹，0 与 1 会算出**同一个散列步长**、
    //   两章读数恒同 —— 与「逐章心数不许同值」相冲。
    const n = num === null ? 1 : Math.max(0, Math.trunc(num));
    const step = ((n * 7) % 51) / 100;   // 0.00〜0.50，按章号散开
    return Math.max(3, Math.round(base * (0.75 + step)));
}

/** 一站式初始化：给一篇作品补齐所有缺的心数（幂等）。
 *  `hearts` 缓存由 `normalizeNovel` 按逐章重算，这里只填逐章。 */
export function initNovelPopularity(novel, cold) {
    const n = normalizeNovel(novel);
    const heatBase = deriveHeatBase(novel && novel.followerCount, cold === undefined ? coldOfNovelId(n.id) : cold);
    // ★ 按下标取原始章（`c.num - 1` 在坏号/补号时会错配到别人的心数）；
    //   「给过心数」判 `>= 0` —— 0 是**合法读数**，`!== null` 会把 0 当没给过而覆盖。
    // ★ 原始章从**入参**取（`probe()` 传进来的就是盘上裸对象，下标一一对应）；
    //   不许从规范化结果上取 —— 那个键若挂上去会随写盘把每章的正文副本翻倍。
    const rawArr = (novel && Array.isArray(novel.chapters)) ? novel.chapters : [];
    const chapters = n.chapters.map((c, pos) => {
        const rawCh = rawArr[pos] || null;
        const had = rawCh ? (numOrNull(rawCh.hearts) !== null && numOrNull(rawCh.hearts) >= 0) : false;
        const chNum = c.num === null ? (pos + 1) : c.num;
        return Object.assign({}, c, { hearts: had ? c.hearts : deriveChapterHearts(heatBase, chNum) });
    });
    return normalizeNovel(Object.assign({}, novel, { chapters, heatBase }));
}

/** 读数面：一篇作品的心数三面（缓存 / 逐章最高 / 逐章合计，**三者分开报**）。 */
export function heartsFace(novel) {
    const n = normalizeNovel(novel);
    const maxCh = n.chapters.reduce((mx, c) => Math.max(mx, c.hearts || 0), 0);
    const sum = n.chapters.reduce((s, c) => s + (c.hearts || 0), 0);
    const boost = n.chapters.reduce((s, c) => s + (c.likeBoost || 0), 0);
    return {
        cached: n.hearts,
        maxChapter: maxCh,
        sumChapters: sum,
        likeBoost: boost,
        consistent: n.hearts === maxCh,
    };
}

/* ---------- 评论树 ---------- */

/** 上溯顶层祖先 id：带**访问集**，自指即停并落在根（源只靠 `guard < 50` 步数上限）。 */
export function topAncestorId(comments, id, maxDepth) {
    const arr = Array.isArray(comments) ? comments : [];
    const lim = clampInt(numOrNull(maxDepth), 1, 64, 32);
    const byId = new Map();
    for (const c of arr) byId.set(String(c && c.id), c);
    const seen = new Set();
    let cur = byId.get(String(id || ''));
    if (!cur) return String(id || '');
    seen.add(String(cur.id));
    for (let step = 0; step < lim; step++) {
        const pid = cur.replyToCommentId ? String(cur.replyToCommentId) : '';
        if (!pid) break;
        if (seen.has(pid)) break;           // ★ 自指：停在这里，不死循环
        const parent = byId.get(pid);
        if (!parent) break;
        seen.add(pid);
        cur = parent;
    }
    return String(cur.id || '');
}

/**
 * 评论树：顶层新→旧（真 pixiv 序），子孙拍平后旧→新（对话序）。
 * ★ 深度有显式上限：超过上限的子孙**不进 children**，改为挂在阈值那一层、
 *   并把 `truncated` 计数如实回报（源没有上限，深链会一路展开）。
 * 返回 `{ roots, truncated, orphans }` —— 三个读数分开，不塌成一个。
 */
export function buildCommentTree(comments, maxDepth) {
    const arr = (Array.isArray(comments) ? comments : []).map((c, i) => normalizeComment(c, i));
    const lim = clampInt(numOrNull(maxDepth), 1, 12, PIXIV_LIMITS.maxCommentDepth);
    const byId = new Map();
    const nodes = arr.map((c) => {
        const node = Object.assign({}, c, { children: [], depth: 1 });
        byId.set(c.id, node);
        return node;
    });
    const roots = [];
    let truncated = 0;
    let orphans = 0;
    // ★ 环内节点（A 回 B、B 回 A，或自指）：既不是根、也不在任何人的子树里
    //   ⇒ 必须**各自当根**，否则整块评论从树上消失（视图拿到空数组、评论区全白）。
    //   源靠 `guard < 50` 步数上限停下，同样丢块；本件如实计数。
    let cycleRoots = 0;
    const inCycle = new Set();
    // 先按父指针算深度（带访问集，防自指）
    const depthOf = (node) => {
        const seen = new Set([node.id]);
        let cur = node;
        let d = 1;
        while (cur && cur.replyToCommentId) {
            const pid = String(cur.replyToCommentId);
            if (seen.has(pid)) { inCycle.add(node.id); break; }
            seen.add(pid);
            const parent = byId.get(pid);
            if (!parent) break;
            cur = parent;
            d += 1;
            if (d > 64) break;
        }
        return d;
    };
    for (const node of nodes) {
        const d = depthOf(node);
        const pid = node.replyToCommentId ? String(node.replyToCommentId) : '';
        if (inCycle.has(node.id)) {
            cycleRoots += 1;
            roots.push(node);
            node.depth = 1;
        } else if (pid && byId.has(pid) && d <= lim) {
            const parent = byId.get(pid);
            parent.children.push(node);
            node.depth = d;
        } else if (pid && byId.has(pid) && d > lim) {
            // 超过深度上限：挂到根（不丢），并计数
            truncated += 1;
            roots.push(node);
            node.depth = 1;
        } else {
            if (pid && !byId.has(pid)) orphans += 1;   // 父指针指向不存在的评论
            roots.push(node);
            node.depth = 1;
        }
    }
    roots.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return { roots, truncated, orphans, cycleRoots };
}

/** 子孙拍平（旧→新对话序）；带访问集防自指。 */
export function flattenComments(node) {
    const out = [];
    const seen = new Set();
    const walk = (n) => {
        for (const c of (n.children || [])) {
            if (seen.has(c.id)) continue;
            seen.add(c.id);
            out.push(c);
            walk(c);
        }
    };
    walk(node || {});
    out.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    return out;
}

/** 评论四态的面名（**真源**）。视图的文案表必须用这些**计算键**，不许手写。
 *  ★ 本仓 J7 的教训：clock-view 的 FACE_META 手写 `no_clock_face`（下划线形），
 *    而真源的值是 `no-clock-face`（连字符形）⇒ 五态里三态查不到、兜底全显示成
 *    同一句话，**而当时判据全绿**。手写键 = 第二个真源。 */
export const PIXIV_COMMENT_FACES = {
    not_read: 'not_read',
    partial: 'partial',
    read: 'read',
    failed: 'failed',
};
/** 评论数三态面（**「0 条」与「还没读」不许同形**）。 */
export function commentCountFace(chapter) {
    const ch = (chapter && typeof chapter === 'object') ? chapter : {};
    const list = Array.isArray(ch.commentsList) ? ch.commentsList : [];
    // ★ 顺序即语义：失败**不是**「没读过」（一个是「还没试」、一个是「试了没成」），
    //   故失败态必须排在 not_read 之前 —— 首版把它排在后面，失败被静默吞成「没读过」。
    const F = PIXIV_COMMENT_FACES;
    const face = ch.commentsFailed ? F.failed
        : ((!ch.commentsLoaded && !ch.commentsAttempted && !list.length) ? F.not_read
            : (ch.commentsLoaded ? F.read : F.partial));
    return { face, count: list.length, loaded: ch.commentsLoaded === true, failed: ch.commentsFailed === true };
}

/** 章的「身份面」：生成中途章节被重写时，占位评论必须能识别出「已不在原对象上」。
 *  源靠 `indexOf(loadingReply) === -1` 兜住（自己注释里记了这条坑），本件把它做
 *  成一个显式读数：`sameObject` 为假即说明期间换过对象。 */
export function chapterIdentityFace(nowChapter, prevChapter) {
    const a = nowChapter && typeof nowChapter === 'object' ? nowChapter : null;
    const b = prevChapter && typeof prevChapter === 'object' ? prevChapter : null;
    if (!a || !b) return { comparable: false, sameObject: false, sameNum: false };
    return {
        comparable: true,
        sameObject: a === b,
        sameNum: numOrNull(a.num) === numOrNull(b.num),
    };
}

/* ---------- 阅读面 ---------- */

/** 字数（逐章合计；源 `renderNovelCard` 的口径）。 */
export function totalWords(novel) {
    const n = normalizeNovel(novel);
    return n.chapters.reduce((s, c) => s + (c.wordCount || 0), 0);
}

/** 预计阅读时长（源：500 字/分钟，向上取整、下限 1 分钟）。 */
export function readingMinutes(words) {
    const w = numOrNull(words);
    const n = w === null ? 0 : Math.max(0, Math.trunc(w));
    return Math.max(1, Math.ceil(n / PIXIV_LIMITS.readingSpeedPerMinute));
}

/** 可见作品（`showInvalidNovels === false` 时滤掉没有任何章的）。
 *  ★ 用户自建的（`isUserCreated`）**一律可见**：刚建好还没写正文的草稿若被滤掉，
 *    建完就「看不见」—— 视图建完立刻 `openNovel`，而列表里没有它，用户点不回去。
 *    源是「建了就往数组里 push、列表不重建」，故不会遇到；本件每次 `probe()`
 *    重建可见集，不写这条就会把草稿吞掉（且不报错，静默）。 */
export function visibleNovels(novels, settings) {
    const st = normalizePixivSettings(settings);
    const arr = (Array.isArray(novels) ? novels : []).map((n) => normalizeNovel(n));
    const kept = st.showInvalidNovels ? arr : arr.filter((n) => n.chapters.length > 0 || n.isUserCreated);
    return kept.slice().sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
}

/** 按 tag 过滤（tag 前 `#` 已被规范化剥掉）。 */
export function novelsOfTag(novels, tag) {
    const t = String(tag || '').replace(/^#/, '').trim();
    if (!t) return [];
    return (Array.isArray(novels) ? novels : [])
        .map((n) => normalizeNovel(n))
        .filter((n) => n.tags.indexOf(t) >= 0);
}

/** 按月归档（本地月，返回 `[{ month, list }]` 倒序）。 */
export function groupByMonth(novels) {
    const arr = (Array.isArray(novels) ? novels : []).map((n) => normalizeNovel(n));
    const map = new Map();
    for (const n of arr) {
        const ts = n.updatedAt || n.createdAt || 0;
        const d = new Date(ts);
        const key = ts ? (d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')) : '未标注';
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(n);
    }
    return [...map.keys()].sort((x, y) => (x < y ? 1 : -1)).map((k) => ({ month: k, list: map.get(k) }));
}

/** 本地搜索：标题 / 作者 / 摘要 / tag 四处命中，结果数有上界。 */
export function searchNovels(novels, query, limit) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    const lim = clampInt(numOrNull(limit), 1, 200, PIXIV_LIMITS.maxSearchHits);
    const hits = [];
    for (const raw of (Array.isArray(novels) ? novels : [])) {
        const n = normalizeNovel(raw);
        const hay = (n.title + '\n' + n.authorName + '\n' + n.synopsis + '\n' + n.tags.join(' ')).toLowerCase();
        const at = hay.indexOf(q);
        if (at < 0) continue;
        hits.push({ novel: n, at, snippet: snippetOf(n, q) });
        if (hits.length >= lim) break;
    }
    return hits;
}

/** 命中片段（前后各 20 字）。 */
export function snippetOf(novel, query) {
    const n = novel || {};
    const q = String(query || '').toLowerCase();
    const hay = (n.title || '') + ' ' + (n.synopsis || '');
    const at = hay.toLowerCase().indexOf(q);
    if (at < 0) return String(n.synopsis || '').slice(0, 40);
    const from = Math.max(0, at - 20);
    return (from > 0 ? '…' : '') + hay.slice(from, at + q.length + 20) + '…';
}

/* ---------- 续章上下文（长篇滑窗提成纯函数） ---------- */

/**
 * 续章时喂给生成侧的前文上下文：**最近 `window` 章给全文、更早给摘要**。
 * 源把这段写在一个 `map` 里的 `i >= fromIdx` 条件上（注释写 `FULL_TEXT_WINDOW = 5`）；
 * 本件提成纯函数，`window` 是显式参数，判据对「第 k 章看到几章全文 / 几章摘要」逐格断言。
 */
export function prevChapterContext(chapters, currentChapterNum, window) {
    // ★ 本函数只拿章号**排序与筛选**（不做按号展示），故坏号按位置补一个号；
    //   但补出来的号**不许与已有号撞**（撞就顺延），否则排序结果会自相矛盾。
    const arr = (() => {
        const list = (Array.isArray(chapters) ? chapters : []).map((c, i) => normalizeChapter(c, i));
        const used = new Set(list.map((c) => c.num).filter((x) => x !== null));
        for (let i = 0; i < list.length; i++) {
            if (list[i].num !== null) continue;
            let cand = i + 1;
            while (used.has(cand)) cand += 1;
            used.add(cand);
            list[i] = Object.assign({}, list[i], { num: cand });
        }
        return list;
    })();
    const win = clampInt(numOrNull(window), 1, 60, PIXIV_LIMITS.fullTextWindow);
    const cur = numOrNull(currentChapterNum);
    const upto = (cur === null ? 0 : Math.max(0, Math.trunc(cur) - 1));
    const prev = arr.filter((c) => c.num <= upto).sort((a, b) => a.num - b.num);
    const fromIdx = Math.max(0, prev.length - win);
    const blocks = prev.map((c, i) => {
        const full = i >= fromIdx;
        return {
            num: c.num,
            title: c.title,
            mode: full ? 'full' : 'digest',
            text: full ? c.content.slice(0, PIXIV_LIMITS.maxPromptChars) : (c.synopsis || c.content.slice(0, 120)),
        };
    });
    return {
        window: win,
        fullCount: blocks.filter((b) => b.mode === 'full').length,
        digestCount: blocks.filter((b) => b.mode === 'digest').length,
        blocks,
    };
}

/** 下一章号（源 `chapters.length + 1` 的口径；空集即 1）。 */
export function nextChapterNum(novel) {
    const n = normalizeNovel(novel);
    if (!n.chapters.length) return 1;
    return Math.max(...n.chapters.map((c) => c.num)) + 1;
}

/** 章节位置面（开篇 / 连载中 / 收尾 / 番外）—— 源 `chapterEndCard` 的四种形态。 */
export function chapterPositionFace(novel, chapterNum, isEnding) {
    const n = normalizeNovel(novel);
    const num = numOrNull(chapterNum) === null ? 1 : Math.max(1, Math.trunc(numOrNull(chapterNum)));
    const total = n.chapters.length;
    if (isEnding === true) return { num, kind: 'ending', label: '收尾' };
    if (num === 1) return { num, kind: 'opening', label: '开篇' };
    if (!n.isSerial) return { num, kind: 'ongoing', label: '连载中' };
    if (num > total && total > 0) return { num, kind: 'extra', label: '番外' };
    return { num, kind: 'ongoing', label: '连载中' };
}

/* ---------- 译文折叠块（白名单，不走转义器耦合） ---------- */

/** 译文折叠块的白名单标签。 */
export const PIXIV_ALLOWED_TAGS = ['details', 'summary', 'span', 'br'];
/** 白名单标签允许的属性（只认 `class="tl"` 这一个钩子）。 */
export const PIXIV_ALLOWED_ATTRS = { details: ['class'] };

/**
 * 正文 HTML 净化：**先把全部标签转义，再只把白名单标签放回来**。
 * ★ 与源写法的差别：源用 `[^&]` 匹配已转义标签的属性段 —— 该写法**依赖
 *   转义器不转义单引号**（源自己在注释里写明「勿收编 Utils.escapeHtml」）。
 *   本件不复用任何转义器的输出形态：自己扫字符流、逐标签判白名单，
 *   转义器换了也不影响还原结果。
 * 返回 `{ html, droppedTags, droppedAttrs }` —— 被挡下的标签与属性**如实计数**。
 */
/** 实体**拼装**：源码里不写实体字面量 —— 编辑器 / 传输链会把 `"` 这类
 *  字面量解码成真字符，于是「转义引号」这一格会**静默失效**（不报错、只不转义）。
 *  用 `String.fromCharCode(38)` 拼出 `&` 再拼名字，链路上没有可解码的东西。 */
const AMP = String.fromCharCode(38);
function ent(name) { return AMP + name + ';'; }
/** 文本位置需要转义的四个字符（`<` 走标签分支，这里一并列出以便复用）。 */
const TEXT_ESCAPES = { '&': ent('amp'), '>': ent('gt'), '<': ent('lt'), '"': ent('quot') };

export function sanitizeBody(html) {
    const src = String(html || '');
    const out = [];
    let droppedTags = 0;
    let droppedAttrs = 0;
    let i = 0;
    while (i < src.length) {
        const ch = src.charAt(i);
        if (ch !== '<') {
            // 普通文本：转义危险字符（表驱动，不写字面量）
            out.push(TEXT_ESCAPES[ch] || ch);
            i += 1;
            continue;
        }
        const close = src.indexOf('>', i);
        if (close < 0) { out.push(ent('lt')); i += 1; continue; }
        const inner = src.slice(i + 1, close);
        const isClose = inner.charAt(0) === '/';
        const body = isClose ? inner.slice(1) : inner;
        const m = body.match(/^([a-zA-Z][a-zA-Z0-9]*)\s*([\s\S]*)$/);
        if (!m) { out.push(ent('lt')); i += 1; continue; }
        const name = m[1].toLowerCase();
        const attrText = m[2] || '';
        if (PIXIV_ALLOWED_TAGS.indexOf(name) < 0) {
            droppedTags += 1;
            out.push(ent('lt') + escapeAttrText(inner) + ent('gt'));
            i = close + 1;
            continue;
        }
        if (isClose) { out.push('</' + name + '>'); i = close + 1; continue; }
        const allowed = PIXIV_ALLOWED_ATTRS[name];
        let kept = '';
        let handled = false;   // ★ 同一个属性不许进两个格子：兜底只在「一个都没处理过」时触发
        if (attrText.trim()) {
            if (allowed && allowed.length) {
                for (const an of allowed) {
                    handled = true;
                    const re = new RegExp(an + '\\s*=\\s*([\'"]?)([^\'">\\s]*)\\1', 'i');
                    const am = attrText.match(re);
                    if (!am) continue;
                    const val = am[2];
                    // 只认折叠钩子这一种值；其余值算「属性在但值不合规」
                    if (an === 'class' && val !== 'tl') { droppedAttrs += 1; continue; }
                    kept += ' ' + an + '="' + val + '"';
                }
            }
            if (!handled) droppedAttrs += 1;
        }
        out.push('<' + name + kept + '>');
        i = close + 1;
    }
    return { html: out.join(''), droppedTags, droppedAttrs };
}

/** 属性文本转义（原样显示被挡下的标签时用）。 */
function escapeAttrText(s) {
    return String(s || '').split('&').join(ent('amp')).split('<').join(ent('lt')).split('>').join(ent('gt'));
}

/**
 * 正文 → 显示用段落。
 * 源流程：把 `<details>` 块内的**真实换行**转成字面 `\n`（防 AI 多行输出把
 * 段落分隔拆碎），再把字面 `\n` 转成 `<br>`，最后按空行 / 换行切段。
 * 本件把这三步提成一个纯函数，**且先净化后切段**（源是切完段再净化）。
 */
export function toDisplayParagraphs(rawContent) {
    const text = String(rawContent || '');
    const normalized = text.replace(/<details[\s\S]*?<\/details>/gi, (m) => m.replace(/\n/g, '\\n'));
    const displayText = normalized.replace(/\\n/g, '<br>');
    const paras = displayText.split(/\n\n|\n/).filter((p) => p.trim());
    return paras.map((p) => sanitizeBody(p));
}

/* ---------- 订阅 / 互动 ---------- */

/** 在数组里切换某值（关注 / 订阅 / 收藏 三者共用）。返回新数组，不原地改。 */
export function toggleInList(list, value) {
    const v = String(value || '');
    const arr = (Array.isArray(list) ? list : []).map((x) => String(x || '')).filter(Boolean);
    if (!v) return arr.slice();
    return arr.indexOf(v) >= 0 ? arr.filter((x) => x !== v) : arr.concat([v]);
}

/** 订阅 tag 上界（超限丢弃最早的并如实回报）。 */
export function addSubscribedTag(list, tag) {
    const t = String(tag || '').replace(/^#/, '').trim();
    const arr = (Array.isArray(list) ? list : []).map((x) => String(x || '').replace(/^#/, '').trim()).filter(Boolean);
    if (!t) return { list: arr, added: false, dropped: 0 };
    if (arr.indexOf(t) >= 0) return { list: arr, added: false, dropped: 0 };
    const next = arr.concat([t]);
    const lim = PIXIV_LIMITS.maxSubscribedTags;
    if (next.length <= lim) return { list: next, added: true, dropped: 0 };
    return { list: next.slice(next.length - lim), added: true, dropped: next.length - lim };
}

/** 浏览记录：只留最近 N 条（源的浏览记录无上界）。 */
export function recordReadHistory(list, novelId, max) {
    const id = String(novelId || '');
    const lim = clampInt(numOrNull(max), 1, 500, PIXIV_LIMITS.maxReadingHistory);
    const arr = (Array.isArray(list) ? list : []).map((x) => String(x || '')).filter(Boolean).filter((x) => x !== id);
    if (!id) return { list: arr, dropped: 0 };
    const next = [id].concat(arr);
    if (next.length <= lim) return { list: next, dropped: 0 };
    return { list: next.slice(0, lim), dropped: next.length - lim };
}

/** 一篇作品的「我」的四个状态位（**各自独立，不许合并**）。 */
export function myNovelFlags(store, novelId) {
    const s = (store && typeof store === 'object') ? store : {};
    const id = String(novelId || '');
    return {
        favorited: toStrArr(s.favoritedNovelIds).indexOf(id) >= 0,
        following: toStrArr(s.followingNovelIds).indexOf(id) >= 0,
        inHistory: toStrArr(s.readHistoryNovelIds).indexOf(id) >= 0,
        likedAnyChapter: false,   // 由调用方按逐章填（本函数不吃章节）
    };
}

/** 我关注的作者的 id 集合（作者关注与作品追更是两本账）。 */
export function followedAuthorsOf(store) {
    const s = (store && typeof store === 'object') ? store : {};
    return toStrArr(s.followedAuthorIds);
}

function toStrArr(v) {
    return Array.isArray(v) ? v.map((x) => String(x || '')) : [];
}

/** 列表裁剪（保最近 N 条；`expired` 如实回报）。 */
export function pruneList(list, max) {
    const arr = Array.isArray(list) ? list : [];
    const lim = clampInt(numOrNull(max), 1, 10000, arr.length || 1);
    if (arr.length <= lim) return { kept: arr.slice(), expired: 0, total: arr.length };
    return { kept: arr.slice(arr.length - lim), expired: arr.length - lim, total: arr.length };
}

/** 数字显示（1.2万 / 12.3万；源 `formatCount` 的口径）。 */
export function formatCount(v) {
    const n = numOrNull(v);
    if (n === null) return '—';
    const x = Math.max(0, Math.trunc(n));
    if (x < 10000) return String(x);
    const w = x / 10000;
    return (w >= 100 ? Math.round(w) : Math.round(w * 10) / 10) + '万';
}

/** 从一组候选里挑：命中文风 tag 的优先、最近用过的降权。**不掷随机**（源 `_pickWriterWeighted` 掷）。
 *  `seed` 决定同权重之间的先后（确定性、可复算）。 */
export function pickDiverseAuthors(pool, count, preferTag, seed) {
    const arr = (Array.isArray(pool) ? pool : []).filter((a) => a && isActivePixivType(a.type));
    const want = clampInt(numOrNull(count), 1, 12, 1);
    const tag = String(preferTag || '').trim();
    const sd = numOrNull(seed) === null ? 0 : Math.trunc(numOrNull(seed));
    const scored = arr.map((a, i) => {
        const hit = tag && toStrArr(a.contentTags).some((t) => t.indexOf(tag) >= 0 || tag.indexOf(t) >= 0) ? 1 : 0;
        return { a, hit, tie: (sd + i * 7) % 97 };
    });
    scored.sort((x, y) => (y.hit - x.hit) || (x.tie - y.tie));
    const picked = scored.slice(0, want).map((x) => x.a);
    return { picked, considered: arr.length, matched: scored.filter((x) => x.hit).length };
}

/** 解析文风选择（`random` 时按 seed 取一款启用的；无启用则回落 novelRules）。 */
export function resolveWritingStyle(styles, choice, seed) {
    const arr = normalizeWritingStyles(styles).filter((s) => s.enabled);
    const c = String(choice || 'random');
    if (c && c !== 'random') {
        const hit = arr.filter((s) => s.id === c)[0];
        if (hit) return { style: hit, mode: 'explicit' };
        return { style: null, mode: 'missing' };
    }
    if (!arr.length) return { style: null, mode: 'none_enabled' };
    const sd = numOrNull(seed) === null ? 0 : Math.abs(Math.trunc(numOrNull(seed)));
    return { style: arr[sd % arr.length], mode: 'random' };
}

/* ---------- 注入块（模型要看的那一段） ---------- */

/**
 * 产出给宿主生成侧的结构化要求（**不是请求**：本件不发任何网络调用）。
 * `mode` 四值：novel（新建作品）/ chapter（续章 / 重写）/ comment（评论回复）/ illust（插画要求）。
 */
export function pixivPromptBlock(mode, payload) {
    const p = payload || {};
    const m = String(mode || 'novel');
    if (m === 'chapter') {
        const novel = normalizeNovel(p.novel);
        const pos = chapterPositionFace(novel, p.chapterNum, p.isEnding);
        const ctx = prevChapterContext(novel.chapters, pos.num, p.window);
        const style = resolveWritingStyle(p.writingStyles, p.styleId, p.seed);
        return {
            mode: 'chapter',
            title: novel.title,
            authorName: novel.authorName,
            chapterNum: pos.num,
            position: pos.kind,
            positionLabel: pos.label,
            lengthLabel: String(p.lengthLabel || ''),
            lengthMin: clampInt(numOrNull(p.lengthMin), 0, 20000, 0),
            tagLine: novel.tags.join('・'),
            fullCount: ctx.fullCount,
            digestCount: ctx.digestCount,
            prevBlocks: ctx.blocks,
            styleName: style.style ? style.style.name : '',
            styleRules: style.style ? style.style.rules : String(p.novelRules || ''),
            styleMode: style.mode,
            language: String(p.language || 'jp-cn'),
            purityRule: String(p.language || 'jp-cn') === 'cn-only' ? '' : PIXIV_PURITY_RULE,
            userDirection: String(p.userDirection || '').slice(0, 500),
        };
    }
    if (m === 'comment') {
        return {
            mode: 'comment',
            novelTitle: String(p.novelTitle || ''),
            novelAuthor: String(p.novelAuthor || ''),
            chapterNum: clampInt(numOrNull(p.chapterNum), 1, 1000, 1),
            chapterTitle: String(p.chapterTitle || ''),
            readerName: String(p.readerName || ''),
            readerText: String(p.readerText || '').slice(0, 300),
            wantsOpReply: p.wantsOpReply === true,
            isReply: p.isReply === true,
            language: String(p.language || 'jp-cn'),
        };
    }
    if (m === 'illust') {
        return {
            mode: 'illust',
            prompt: String(p.prompt || '').trim().slice(0, 600),
            negativePrompt: String(p.negativePrompt || '').trim().slice(0, 300),
            size: String(p.size || '').trim().slice(0, 16),
            count: clampInt(numOrNull(p.count), 1, 9, 1),
            drawnBy: String(p.drawnBy || '').trim(),
        };
    }
    const style = resolveWritingStyle(p.writingStyles, p.styleId, p.seed);
    const langs = PIXIV_LANGUAGE_MODES.map((x) => x.id);
    const language = langs.indexOf(String(p.language || '')) >= 0 ? String(p.language) : 'jp-cn';
    return {
        mode: 'novel',
        title: String(p.title || '').trim().slice(0, 120),
        tagLine: toStrArr(p.tags).slice(0, PIXIV_LIMITS.maxTagsPerNovel).join('・'),
        isSerial: p.isSerial === true,
        authorName: String(p.authorName || '').trim(),
        styleName: style.style ? style.style.name : '',
        styleRules: style.style ? style.style.rules : '',
        styleMode: style.mode,
        language,
        purityRule: language === 'cn-only' ? '' : PIXIV_PURITY_RULE,
        customPrompt: String(p.customPrompt || '').slice(0, 2000),
        userDirection: String(p.userDirection || '').slice(0, 500),
        minWords: clampInt(numOrNull(p.minWords), 0, 20000, 0),
    };
}

/* ---------- 投影（视图唯一的数据入口） ---------- */

/**
 * 现算投影：`render` 每次重取，不持跨轮副本（防陈旧）。
 * `dropped` / `trimmed` 如实回报（裁剪不许静默）。
 */
export function projectPixiv(input) {
    const src = input || {};
    const settings = normalizePixivSettings(src.settings);
    const authorsRaw = Array.isArray(src.authors) ? src.authors : [];
    const novelPrune = pruneList(src.novels, PIXIV_LIMITS.maxNovels);
    const illPrune = pruneList(src.illustrations, PIXIV_LIMITS.maxIllusts);
    const novels = visibleNovels(novelPrune.kept, settings);
    const illustrations = illPrune.kept.map((i, idx) => normalizeIllust(i, idx))
        .sort((a, b) => b.createdAt - a.createdAt);
    const store = (src.store && typeof src.store === 'object') ? src.store : {};
    const tagCounts = new Map();
    for (const n of novels) for (const t of n.tags) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
    const hotTags = [...tagCounts.entries()].sort((x, y) => (y[1] - x[1]) || (x[0] < y[0] ? -1 : 1))
        .slice(0, 12).map(([tag, count]) => ({ tag, count }));
    const followedAuthorIds = toStrArr(store.followedAuthorIds);
    return {
        settings,
        authors: authorsRaw,
        activeAuthors: authorsRaw.filter((a) => a && isActivePixivType(a.type)),
        inactiveAuthors: authorsRaw.filter((a) => a && !isActivePixivType(a.type)),
        novels,
        illustrations,
        hotTags,
        library: ['illust', 'novel', 'me'],
        storyTabs: ['all', 'serial'],
        meTabs: ['favorites', 'following', 'history', 'works', 'settings'],
        store: {
            followedAuthorIds,
            subscribedTags: toStrArr(store.subscribedTags),
            favoritedNovelIds: toStrArr(store.favoritedNovelIds),
            followingNovelIds: toStrArr(store.followingNovelIds),
            readHistoryNovelIds: toStrArr(store.readHistoryNovelIds),
        },
        dropped: novelPrune.expired + illPrune.expired,
        totalNovels: novelPrune.total,
        totalIllusts: illPrune.total,
        emptyAuthors: authorsRaw.length === 0,
    };
}

/* ---------- 宿主回填：评论分隔块 ---------- */

/** 评论块分隔符（照源 `_parseComments` 的 `---COMMENT---` 口径）。 */
export const PIXIV_COMMENT_DELIM = '---COMMENT---';

/**
 * 解析宿主贴回来的评论块。协议（本件定，写在视图的输入框提示里）：
 *   `---COMMENT---` 分块；块内首行可选 `AUTHOR: 名字`、次行可选 `REPLY: 序号`，
 *   其余行拼成正文。`REPLY` 里的序号是**本次列表内**的 1 基序号（指向前面某条）。
 *
 * ★ 为什么要有「解析」这一步：源把解析与登记揉在一个网络回调里（`loadComments`），
 *   本件没有网络，于是「解析」必须自己成为一条**纯函数**通道，否则 `ingestComments`
 *   永远没有入口（导出了、有实现、零调用 = 功能级失效）。
 * ★ 回报 `skipped`：正文为空的块**如实计数**，不许静默丢。
 */
export function parseCommentsBlock(text) {
    const raw = String(text || '');
    const chunks = raw.split(PIXIV_COMMENT_DELIM);
    const items = [];
    let skipped = 0;
    for (const chunk of chunks) {
        const body = chunk.replace(/^\s*\n/, '').replace(/\s+$/, '');
        if (!body.trim()) continue;
        const lines = body.split('\n');
        let author = '';
        let replyTo = null;
        let i = 0;
        for (; i < lines.length; i++) {
            const m = lines[i].match(/^\s*(AUTHOR|REPLY)\s*[:：]\s*(.*)$/i);
            if (!m) break;
            if (m[1].toUpperCase() === 'AUTHOR') author = m[2].trim();
            else {
                const idx = numOrNull(m[2].trim());
                replyTo = (idx === null || Math.trunc(idx) < 1) ? null : (items[Math.trunc(idx) - 1] ? items[Math.trunc(idx) - 1].id : null);
            }
        }
        const content = lines.slice(i).join('\n').trim();
        if (!content) { skipped += 1; continue; }
        items.push({ id: 'hc' + (items.length + 1), author: author || '匿名', content, replyToCommentId: replyTo });
    }
    return { items, skipped, blocks: chunks.length - 1 };
}

/** 我的四个子面（各自独立，**不许合并**）。 */
export function myCollections(novels, store, kind) {
    const arr = (Array.isArray(novels) ? novels : []).map((n) => normalizeNovel(n));
    const byId = new Map();
    for (const n of arr) byId.set(n.id, n);
    const s = (store && typeof store === 'object') ? store : {};
    const map = {
        favorites: toStrArr(s.favoritedNovelIds),
        following: toStrArr(s.followingNovelIds),
        history: toStrArr(s.readHistoryNovelIds),
        works: [],
    };
    const k = String(kind || '');
    if (k === 'works') return arr.filter((n) => n.isUserCreated);
    const ids = map[k];
    if (!ids) return [];
    return ids.map((id) => byId.get(id)).filter(Boolean);
}
