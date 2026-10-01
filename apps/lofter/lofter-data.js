/* ========================================================
 * lofter-data.js — [v3.34.0] 老福特（LOFTER）· 纯函数内核
 *
 * 缝合自 Perigee（`js/lofter.js`，4445 行 / 267370 字节）。源是一个**挂在全局
 * `AppState.data.lofterData` 上、共用微博粉丝池与 CP 设定**的中文同人圈平台仿真：
 *   ① 短文批量生成   （一次多篇，`---LOF---` 分块、6 种「文章类型」形态）
 *   ② 长篇合集连载   （合集 → 逐章 → 续章 → 完结 / 完结后番外）
 *   ③ 评论楼中楼     （`_buildTree` / `_flattenDescendants` / 作者回复）
 *   ④ 互动与订阅     （心 / 收藏 / 稍后再读 / 足迹 / 关注作者 / 订阅合集与 tag）
 *   ⑤ 阅读面         （网格与列表两态、按月归档、本地搜索、作者主页）
 *   ⑥ 设置面         （文风管理 / 文手管理）
 *
 * ── 本件取哪几块 ────────────────────────────────────────
 *   取：①②③④⑤ —— 「**读什么 → 谁写的 → 一章章追 → 能评论能收藏 → 能回头找**」
 *   这一条完整的链。⑥ 设置面只取**文风库这一块机制**（11 款内置文风与「续章继承」），
 *   不取源那套「文手管理 CRUD 界面」（理由见下「四处不缝」第 ⑤ 条）。
 *
 * ── 四处不缝（源里有、本仓明令禁止或有第二个权威的东西，一条都没进来）──
 *   ① **不直连模型**：源 `_callLLM` 自己读 `weiboData.apiOverride`（apiKey / baseUrl /
 *      model / temperature）再调 `Utils.callChatAPI` —— 也就是**自己发请求**。
 *      本仓模型调用一律走宿主生成侧；本件一个 `fetch` / `apiKey` 都没有，
 *      只负责「把生成要求整理成可注入的结构」与「把宿主给的文本解析成文章」。
 *   ② **不落 Dexie / 不碰 `db.chats` / `chat.history`**：源把整份 `AppState.data`
 *      经 `Utils.saveData()` 整块回写（一次发文把全部平台数据重写一遍）。
 *      本件零数据库，落 PhoneStorage 的**三条会话键**（见下），改一处不整块回写。
 *   ③ **不共用别的 App 的池**：源要求「中文圈 NPC 池」来自 `weiboData.fanFriends`，
 *      空池就报「请先在微博 / 放送局填充 CP 设定」。本仓**没有这个权威** ——
 *      故本件**自带原创作者池**（`LOFTER_BUILT_IN_AUTHORS`），不依赖任何兄弟 App
 *      在场，也不往别人的池里写东西。
 *   ④ **一张图都不存、一条外链都不收**：源把 `imageCount` / 封面色 / 头像色写进文章。
 *      本件只登记**数量与色相**（`coverHue` 整数），没有任何 URL 与图片扩展名。
 *
 * ── 三条偏离（偏离不是遗漏，逐条写明）──
 *   ① **互动计数一律取整且有上界**：源用 `Math.floor(Math.random() * fc * 0.04)`
 *      之类散落各处、`fc` 取自 `npc.followerCount || 1000`（池里没有就默认 1000）。
 *      本件把「某档热度 → 各类计数」收成**唯一**实现 `deriveStats(heat, cold)`，
 *      并保证**心 ≥ 收藏 ≥ 评论**这条序关系恒成立（源三处各自随机、序不保证）。
 *   ② **长篇滑窗是显式常量且可审**：源注释写 `FULL_TEXT_WINDOW = 5`（原 3），
 *      但章节组装时把「最近 N 章给全文、更早给摘要」写成一个 `map` 里的 `i >= fromIdx`。
 *      本件把它提成 `prevChapterContext()` 一个纯函数，`window` 是显式参数，
 *      判据对「第 k 章看到几章全文 / 几章摘要」逐格断言。
 *   ③ **评论树深度有上限、且递归不会自指**：源 `_buildTree` 靠 `replyToCommentId`
 *      连边、`_topAncestorId` 上溯；数据自指（A 回 B、B 回 A）时源会**无限上溯**。
 *      本件上溯带**访问集**（`seen`），自指即停并把该条挂到根 —— 不报错、不死循环。
 *
 * ── 本套件守的静默失效形态（都不报错、不崩溃，只是结果不对）──
 *   · 「没有这条键」与「这条键是空数组」**不许塌成同一个读数**（本仓最贵的一类错读）；
 *   · 「评论数是 0 条」与「评论还没读出来」**不许同形**；
 *   · 「章节号是 0」不许被当成「第一章」—— 源用 `chapterNum || (i + 1)` 兜底，
 *     于是第 0 章与第 1 章显示同一个号（本件一律 `numOrNull` 取，坏值即 null）。
 * ======================================================== */
'use strict';
import { numOrNull } from '../../config/num-gate.js';

/* ---------- 常量 ---------- */

/** 源的 4 类「活跃」作者；另 3 类（路人 / 营销 / 官方号）源里静默过滤，本件沿用。 */
export const LOFTER_ACTIVE_TYPES = ['fan_writer', 'fan_artist', 'cp_fan', 'info_station'];
/** 源里被**静默过滤**掉的两类作者（原创向 `oc_creator` / 长评人 `reviewer`）。
 *  源只认上面 4 类、其余静默丢弃；本仓不许静默 ⇒ 两位真实存在、由 `isActiveLofterType`
 *  显式滤掉并在读数里如实计数（非活跃 2）。 */
export const LOFTER_IDLE_TYPES = ['oc_creator', 'reviewer'];
/** 作者类型的人话表（4 类活跃 + 2 类非活跃，键**现取真源**）。
 *  ★ 不手写键：手写的代价见桥契约门 J7 判据立据的那两处实伤 —— 键形与真源值差一个连接符，
 *    五态里三态查不到、全兜底成同一句「桥未连接」，而当时判据全绿。
 *    故本表由 IIFE 按 `LOFTER_ACTIVE_TYPES.concat(LOFTER_IDLE_TYPES)` 的**顺序**填，
 *    改类型清单时人话表跟着走，不留第二份清单。 */
export const LOFTER_TYPE_LABELS = (() => {
    const humans = ['写字的人', '画手', '抠糖人', '情报站', '原创向', '长评人'];
    const types = LOFTER_ACTIVE_TYPES.concat(LOFTER_IDLE_TYPES);
    const table = {};
    for (let i = 0; i < types.length; i++) table[types[i]] = humans[i] || types[i];
    return table;
})();

/** 源 `LOFTER_ARTICLE_TYPES` 六种形态：随机 + 五种显式形态（每种联动一类作者）。 */
export const LOFTER_ARTICLE_TYPES = [
    { id: 'random', label: '随机', preferType: null, baseType: null },
    { id: 'drabble', label: '同人短打', preferType: 'fan_writer', baseType: 'short' },
    { id: 'analysis', label: '角色分析 / 解读', preferType: 'fan_writer', baseType: 'meta' },
    { id: 'note', label: '创作 note / 碎碎念', preferType: 'fan_writer', baseType: 'meta' },
    { id: 'sugar', label: '抠糖 / 安利', preferType: 'cp_fan', baseType: 'short' },
    { id: 'lore', label: '设定考据 / 情报', preferType: 'info_station', baseType: 'meta' },
];

/** 内置文风（源 5 款 + 月读并入 6 款）。rules 是真正喂进 prompt 的文风指令。 */
export const LOFTER_WRITING_STYLES = [
    { id: 'lof_style_tender', name: '细腻情感流', description: '治愈 / 日常向、慢火细炖', rules: '慢节奏推进、心理描写绵密、善用环境与细节烘托情绪、句子偏长但不拖沓、捕捉微妙的情感流动；少冲突多余韵、把日常写出温度。', enabled: true },
    { id: 'lof_style_knife', name: '刀子暴击', description: '虐 / be 美学、克制堆痛', rules: '情感浓烈但叙述克制、靠对比和留白堆积痛感而非直接煽情、关键处用短句收束、擅长遗憾 / 错位 / 不可挽回；结尾余痛悬置、不强行和解。', enabled: true },
    { id: 'lof_style_banter', name: '嘴炮欢脱', description: '沙雕 / 对话向、节奏明快', rules: '对话驱动剧情、语言活泼有网感、善用吐槽和反差萌、节奏明快多用短句、角色互动鲜活有梗；轻松但不油腻、笑点自然不硬凹。', enabled: true },
    { id: 'lof_style_drama', name: '沉浸正剧', description: '剧情向、情节紧凑', rules: '情节逻辑优先、描写精炼有力、少抒情多推进、对话承担信息量、结构严谨层次分明；张力靠处境和抉择撑起、不靠内心独白注水。', enabled: true },
    { id: 'lof_style_lyric', name: '文艺意识流', description: '诗意向、意象丰富', rules: '意象密集、叙事可跳跃、多用通感与比喻、重视语言韵律和氛围营造、心理与外景交融；情绪先于情节、允许留白和未尽之语。', enabled: true },
    { id: 'lof_style_yq', name: '细腻言情', description: '情绪流、心理与感官描写为主、慢节奏', rules: '以细腻的笔触铺陈人物的内心活动与情感流动，重视心理描写和感官细节。节奏舒缓，给情绪留出呼吸的空间，让关系的推进通过细微的眼神、停顿、欲言又止来体现。', enabled: true },
    { id: 'lof_style_shuang', name: '爽文快节奏', description: '强钩子、推进快、爽点密集', rules: '情节驱动，节奏明快，每一段都往前推进剧情。开篇即抛出钩子，冲突来得快、解决得利落。对话简洁有力，少铺垫多动作。章节结尾留悬念或翻盘。', enabled: true },
    { id: 'lof_style_gufeng', name: '古风正剧', description: '文白相间、群像权谋、克制内敛', rules: '语言文白相间，遣词典雅而不堆砌，符合古代背景的称谓、礼仪与器物。叙事克制内敛，重在群像刻画与局势、权谋的铺陈。', enabled: true },
    { id: 'lof_style_wenyi', name: '文艺向', description: '意象与留白、慢节奏、重氛围', rules: '注重意象、氛围与留白，文字讲究质感与韵律。叙事节奏缓慢，情节淡化，更在意瞬间的感受、记忆的碎片与环境的隐喻。', enabled: true },
    { id: 'lof_style_suspense', name: '悬疑暗黑', description: '压抑氛围、反转、信息控制', rules: '营造压抑、不安的氛围，节奏张弛有度。严格控制信息释放，通过悬念、误导与伏笔牵引读者，关键真相延后揭晓并安排反转。', enabled: true },
    { id: 'lof_style_healing', name: '日常治愈', description: '轻松生活流、低冲突、温暖', rules: '轻松温暖的生活流叙事，低冲突、慢生活。聚焦日常的小确幸——一顿饭、一场雨、一句闲谈——从细节里生出暖意。', enabled: true },
];

/** 长篇每章篇幅三档（源 `_chapterLengthSpec` 的 map 逐字搬，含最小字数）。 */
export const LOFTER_CHAPTER_LENGTHS = {
    short: { id: 'short', label: '约 800–1200 字、紧凑利落、不灌水', min: 800 },
    medium: { id: 'medium', label: '约 1500–2500 字、铺陈与推进兼顾', min: 1500 },
    long: { id: 'long', label: '约 2800–4000 字、充分展开场景、对话与心理描写', min: 2800 },
};

/** 长篇滑窗：最近 N 章给全文、更早给摘要。源注释 v2.171.0 由 3 改 5。 */
export const LOFTER_FULL_TEXT_WINDOW = 5;

/** 上限（皆是本仓新增的显式上界；源里这些数都是无界增长）。 */
export const LOFTER_LIMITS = {
    maxArticles: 120,       // 文章池只留最近 120 篇
    maxCollections: 24,     // 合集只留最近 24 个
    maxCommentsPerArticle: 40,
    maxCommentDepth: 3,     // 楼中楼最多三层
    maxTagsPerArticle: 6,   // 源 `.slice(0, 6)`
    maxImageCount: 9,       // 源 `Math.min(9, imageCount)`
    maxSubscribedTags: 40,
    maxSearchHits: 30,
};

/** 取数三态（本仓惯例：缺键 / 空 / 有，不许塌成一态）。 */
export const LOFTER_REASONS = {
    storage_absent: 'storage_absent',
    key_absent: 'key_absent',
    empty: 'empty',
    ok: 'ok',
};

/* ---------- 内置作者池（本件自带，不依赖兄弟 App）---------- */

export const LOFTER_BUILT_IN_AUTHORS = [
    { id: 'lof_a_shenmo', name: '沈墨不写字', handle: 'shenmo_nw', type: 'fan_writer', bio: '只写刀、不写糖。', contentTags: ['宿命', '错过', '群像'], writingStyle: '克制、短句收束', followerCount: 12800 },
    { id: 'lof_a_guqing', name: '顾青梧', handle: 'qingwu_draw', type: 'fan_artist', bio: '画手的笔比嘴诚实。', contentTags: ['构图', '光影', '双人'], followerCount: 24300 },
    { id: 'lof_a_wenning', name: '温宁睡不着', handle: 'wenning_zzz', type: 'cp_fan', bio: '抠糖使我快乐。', contentTags: ['抠糖', '安利', '粮单'], followerCount: 8600 },
    { id: 'lof_a_ayin', name: '阿萦情报站', handle: 'ayin_station', type: 'info_station', bio: '只搬运、不加工。', contentTags: ['考据', '设定', '情报'], followerCount: 31500 },
    { id: 'lof_a_qian', name: '祁岸', handle: 'qian_an', type: 'fan_writer', bio: '正剧控，节奏慢。', contentTags: ['权谋', '群像', '正剧'], writingStyle: '文白相间、留白多', followerCount: 9700 },
    { id: 'lof_a_teng', name: '傅棹', handle: 'fuzhao_', type: 'fan_writer', bio: '写些没头没尾的日常。', contentTags: ['日常', '治愈', '对白'], writingStyle: '对白驱动、短句明快', followerCount: 15200 },
    // ↓ 两位**非活跃类型**：源 `LOFTER_ACTIVE_TYPES` 只认 4 类，`oc_creator`（原创角色）与
    //   `reviewer`（长评）在源里被静默过滤。本仓把它们**留在池里**，由 `isActiveLofterType`
    //   显式滤掉并在读数里如实计数 —— 静默过滤是源的一处脏，本仓不许再有第二个静默。
    //   （它们还让 `isActiveLofterType` 从「永真」变成有判别力的函数。）
    { id: 'lof_a_yanci', name: '砚池', handle: 'yanchi_oc', type: 'oc_creator', bio: '只养自家的孩子。', contentTags: ['原创', '设子', '主创'], followerCount: 4300 },
    { id: 'lof_a_jshen', name: '江慎', handle: 'jshen_review', type: 'reviewer', bio: '读完才说话。', contentTags: ['长评', '拆解', '文评'], followerCount: 6100 },
];

/* ---------- 取数与规范化 ---------- */

/** 源 `LOFTER_ACTIVE_TYPES.includes` 的收口（非 4 类一律视为不活跃）。 */
export function isActiveLofterType(type) {
    return LOFTER_ACTIVE_TYPES.indexOf(String(type || '')) >= 0;
}

/** 三态读数：**不许把「没这条键」与「空数组」读成同一个结果**。 */
export function readLofterFace(raw) {
    if (raw === undefined || raw === null) return LOFTER_REASONS.key_absent;
    if (typeof raw === 'string' && raw.trim() === '') return LOFTER_REASONS.empty;
    if (Array.isArray(raw)) return raw.length === 0 ? LOFTER_REASONS.empty : LOFTER_REASONS.ok;
    if (typeof raw === 'object') return Object.keys(raw).length === 0 ? LOFTER_REASONS.empty : LOFTER_REASONS.ok;
    return LOFTER_REASONS.ok;
}

/** 设置默认值（源 `_defaultLofterData().settings` 逐字对齐）。 */
/**
 * 文风库收口（源 `_ensureWritingStyleDefaults` 的收口）：
 *   · 用户自己的文风**保住**（id 与 name 都在就留）；
 *   · 内置 11 款**缺哪款补哪款**（源逐款查缺补漏）；
 *   · `enabled` 只认**显式 false**（缺键 = 启用，与源 `!== false` 同口径）。
 * 返回新数组，**不原地改**。
 */
export function normalizeWritingStyles(raw) {
    const src = (Array.isArray(raw) ? raw : []).filter((s) => s && typeof s === 'object');
    const out = [];
    const seen = new Set();
    for (const s of src) {
        const id = String(s.id || '').trim();
        const name = String(s.name || '').trim();
        if (!id || !name || seen.has(id)) continue;
        seen.add(id);
        out.push({
            id,
            name,
            description: String(s.description || '').trim(),
            rules: String(s.rules || '').trim(),
            enabled: s.enabled === false ? false : true,
            builtIn: s.builtIn === true,
        });
    }
    for (const b of LOFTER_WRITING_STYLES) {
        if (seen.has(b.id)) continue;
        seen.add(b.id);
        out.push({
            id: b.id, name: b.name, description: b.description,
            rules: b.rules, enabled: b.enabled === false ? false : true, builtIn: true,
        });
    }
    return out;
}

export function defaultLofterSettings() {
    return {
        defaultViewMode: 'grid',
        chapterLength: 'medium',
        autoGenCount: 2,
        showInvalidArticles: true,
        writingStyles: normalizeWritingStyles(LOFTER_WRITING_STYLES),
    };
}

/** 设置规范化：坏值回默认，数字走 numOrNull 再夹紧（**不许 `|| 默认`**）。 */
export function normalizeLofterSettings(raw) {
    const d = defaultLofterSettings();
    const src = (raw && typeof raw === 'object') ? raw : {};
    const mode = (src.defaultViewMode === 'list' || src.defaultViewMode === 'grid') ? src.defaultViewMode : d.defaultViewMode;
    const len = Object.prototype.hasOwnProperty.call(LOFTER_CHAPTER_LENGTHS, String(src.chapterLength))
        ? String(src.chapterLength) : d.chapterLength;
    const n = numOrNull(src.autoGenCount);
    const count = (n === null) ? d.autoGenCount : Math.max(1, Math.min(5, Math.trunc(n)));
    return {
        defaultViewMode: mode,
        chapterLength: len,
        autoGenCount: count,
        showInvalidArticles: src.showInvalidArticles === false ? false : true,
        // 文风库：**坏值不许回默认**（回默认 = 用户自己加的文风被静默抹掉），
        // 缺键才补内置。`normalizeWritingStyles(null)` 会得到完整 11 款内置。
        writingStyles: normalizeWritingStyles(src.writingStyles),
    };
}

/** 文章规范化：逐字段收口（编号走 numOrNull，坏值即 null —— 不许兜成 1）。 */
export function normalizeArticle(raw) {
    const a = (raw && typeof raw === 'object') ? raw : {};
    const type = (a.type === 'meta' || a.type === 'long') ? a.type : 'short';
    const tags = Array.isArray(a.tags)
        ? a.tags.map((t) => String(t || '').replace(/^#/, '').trim()).filter(Boolean).slice(0, LOFTER_LIMITS.maxTagsPerArticle)
        : [];
    const heartN = numOrNull(a && a.stats ? a.stats.hearts : null);
    const favN = numOrNull(a && a.stats ? a.stats.favorites : null);
    const cmtN = numOrNull(a && a.stats ? a.stats.comments : null);
    // ★ 评论数组必须**在这里保住**：`probe()` 每次读盘都过本函数，
    //   此前返回对象里没有 `comments` 键 ⇒ 每次重取所有评论静默消失，
    //   而 `stats.comments` 是个数还在（视图显示「3 条」点进去 0 条，自洽地错）。
    const comments = Array.isArray(a.comments) ? a.comments.slice(0, LOFTER_LIMITS.maxCommentsPerArticle).map((c, i) => ({
        id: String((c && c.id) || ('c' + (i + 1))),
        author: String((c && c.author) || '').trim(),
        content: String((c && c.content) || '').trim(),
        replyToCommentId: (c && c.replyToCommentId) ? String(c.replyToCommentId) : null,
        likes: Math.max(0, numOrNull(c && c.likes) === null ? 0 : Math.trunc(numOrNull(c && c.likes))),
        isOpReply: (c && c.isOpReply) === true,
        createdAt: numOrNull(c && c.createdAt) === null ? 0 : Math.trunc(numOrNull(c && c.createdAt)),
    })) : [];
    return {
        id: String(a.id || ''),
        type,
        title: String(a.title || '').trim(),
        summary: String(a.summary || '').trim(),
        content: String(a.content || '').trim(),
        paragraphCount: Array.isArray(a.paragraphs) ? a.paragraphs.length : 0,
        authorId: String(a.authorId || ''),
        authorName: String(a.authorName || '').trim(),
        collectionId: a.collectionId ? String(a.collectionId) : null,
        chapterNum: a.chapterNum === undefined || a.chapterNum === null ? null : numOrNull(a.chapterNum),
        tags,
        hasImages: a.hasImages === true,
        imageCount: Math.max(0, Math.min(LOFTER_LIMITS.maxImageCount, numOrNull(a.imageCount) === null ? 0 : Math.trunc(numOrNull(a.imageCount)))),
        coverHue: clampHue(a.coverHue),
        comments,
        stats: {
            hearts: heartN === null ? 0 : Math.max(0, Math.trunc(heartN)),
            favorites: favN === null ? 0 : Math.max(0, Math.trunc(favN)),
            comments: cmtN === null ? 0 : Math.max(0, Math.trunc(cmtN)),
        },
        createdAt: numOrNull(a.createdAt) === null ? 0 : Math.trunc(numOrNull(a.createdAt)),
        editedAgoDisplay: String(a.editedAgoDisplay || '').trim(),
    };
}

/** 色相夹紧到 0..359（源用随机 RGB 串；本件只存一个整数色相）。 */
export function clampHue(v) {
    const n = numOrNull(v);
    if (n === null) return 0;
    let h = Math.trunc(n) % 360;
    if (h < 0) h += 360;
    return h;
}

/** 合集规范化。 */
export function normalizeCollection(raw) {
    const c = (raw && typeof raw === 'object') ? raw : {};
    const status = (c.status === 'finished') ? 'finished' : 'ongoing';
    return {
        id: String(c.id || ''),
        name: String(c.name || '').trim(),
        description: String(c.description || '').trim(),
        authorId: String(c.authorId || ''),
        authorName: String(c.authorName || '').trim(),
        styleId: c.styleId ? String(c.styleId) : null,
        status,
        chapterCount: Math.max(0, numOrNull(c.chapterCount) === null ? 0 : Math.trunc(numOrNull(c.chapterCount))),
        coverHue: clampHue(c.coverHue),
        createdAt: numOrNull(c.createdAt) === null ? 0 : Math.trunc(numOrNull(c.createdAt)),
    };
}

/* ---------- 上界与裁剪（如实计数，不静默吞） ---------- */

/**
 * 按上界裁剪列表；**更早的如实计数后丢弃**（本仓惯例：裁剪必须回报条数）。
 * 入参是「新在前」的数组（源用 `unshift`）。
 */
export function pruneList(list, max) {
    const arr = Array.isArray(list) ? list : [];
    const lim = Math.max(0, Math.trunc(numOrNull(max) === null ? 0 : numOrNull(max)));
    if (arr.length <= lim) return { kept: arr.slice(), expired: 0, total: arr.length };
    return { kept: arr.slice(0, lim), expired: arr.length - lim, total: arr.length };
}

/**
 * 源 `_formatNumber` 的收口：万 / 亿两档，1 万以下给整数。
 * **负数与坏值一律返回 '0'**（源没判负）。
 */
export function formatCount(v) {
    const n = numOrNull(v);
    if (n === null || n <= 0) return '0';
    if (n >= 1e8) return trimZero(n / 1e8) + '亿';
    if (n >= 1e4) return trimZero(n / 1e4) + '万';
    return String(Math.trunc(n));
}

function trimZero(x) {
    const s = x.toFixed(1);
    return s.endsWith('.0') ? s.slice(0, -2) : s;
}

/* ---------- 热度 → 统计（唯一实现，且序关系恒成立） ---------- */

/**
 * 源散落三处的随机计数收成**唯一**实现，并保证 `心 ≥ 收藏 ≥ 评论` 恒成立。
 * `heat` 是作者热度（粉丝数），`cold` 是「冷门系数」0..100（越大越冷，用于确定性测试）。
 * 同一 `(heat, cold)` 必得同一读数（纯函数，无随机）。
 */
export function deriveStats(heat, cold = 30) {
    const h = numOrNull(heat);
    const base = (h === null || h <= 0) ? 1000 : Math.trunc(h);
    const c = Math.max(0, Math.min(100, numOrNull(cold) === null ? 30 : Math.trunc(numOrNull(cold))));
    const f = (100 - c) / 100;
    const hearts = Math.max(0, Math.floor(base * 0.04 * f));
    const favorites = Math.max(0, Math.floor(hearts * 0.375));
    // 评论三档轮换（0..3 条），**上界不超过收藏**（保证序关系）
    const comments = Math.min(favorites, Math.floor(base / 4000));
    return { hearts, favorites, comments: Math.max(0, comments) };
}

/* ---------- 评论树（楼中楼） ---------- */

/**
 * 上溯到顶层评论 id。**带访问集**：数据自指（A 回 B、B 回 A）时立即停下并返回自身，
 * 不死循环（源 `_topAncestorId` 无此保护）。
 */
export function topAncestorId(comments, id, maxDepth = 32) {
    const arr = Array.isArray(comments) ? comments : [];
    const byId = new Map();
    for (const c of arr) {
        const cid = String((c && c.id) || '');
        if (cid) byId.set(cid, c);
    }
    let cur = String(id || '');
    const seen = new Set();
    let hops = 0;
    while (cur && !seen.has(cur) && hops < maxDepth) {
        seen.add(cur);
        const node = byId.get(cur);
        if (!node) break;
        const parent = node.replyToCommentId ? String(node.replyToCommentId) : '';
        if (!parent || !byId.has(parent)) return cur;
        cur = parent;
        hops += 1;
    }
    return cur || String(id || '');
}

/** 建树：返回根节点数组（每项带 `children`）。孤儿（父不在场）挂到根。 */
export function buildCommentTree(comments) {
    const arr = Array.isArray(comments) ? comments : [];
    const nodes = arr.map((c, i) => ({
        id: String((c && c.id) || ('anon_' + i)),
        author: String((c && c.author) || '').trim(),
        content: String((c && c.content) || '').trim(),
        parentId: (c && c.replyToCommentId) ? String(c.replyToCommentId) : '',
        likes: Math.max(0, numOrNull(c && c.likes) === null ? 0 : Math.trunc(numOrNull(c.likes))),
        isOpReply: (c && c.isOpReply) === true,
        createdAt: numOrNull(c && c.createdAt) === null ? 0 : Math.trunc(numOrNull(c && c.createdAt)),
        children: [],
        depth: 0,
    }));
    const byId = new Map();
    for (const n of nodes) byId.set(n.id, n);
    const roots = [];
    for (const n of nodes) {
        const p = n.parentId && byId.get(n.parentId);
        if (!p || p === n) { roots.push(n); continue; }
        p.children.push(n);
    }
    // 深度赋值（带深度上限与访问集：防御环）
    const seen = new Set();
    const walk = (list, depth) => {
        for (const n of list) {
            if (seen.has(n.id)) continue;
            seen.add(n.id);
            n.depth = depth;
            if (depth < LOFTER_LIMITS.maxCommentDepth) walk(n.children, depth + 1);
            else n.children = [];
        }
    };
    walk(roots, 1);
    return roots;
}

/** 拍平（先序）：视图按行渲染用。 */
export function flattenComments(roots) {
    const out = [];
    const seen = new Set();
    const walk = (list) => {
        for (const n of (Array.isArray(list) ? list : [])) {
            if (seen.has(n.id)) continue;
            seen.add(n.id);
            out.push(n);
            walk(n.children);
        }
    };
    walk(roots);
    return out;
}

/** 评论计数：**「0 条」与「还没读出来」不许同形**（`null` 表示未读）。 */
export function commentCountFace(rawComments) {
    if (rawComments === undefined || rawComments === null) return { count: null, face: LOFTER_REASONS.key_absent };
    if (!Array.isArray(rawComments)) return { count: null, face: LOFTER_REASONS.key_absent };
    return { count: rawComments.length, face: rawComments.length === 0 ? LOFTER_REASONS.empty : LOFTER_REASONS.ok };
}

/* ---------- 作者挑取（多样性） ---------- */

/**
 * 按类型多样轮转挑作者（源 `_pickLofterNpcs` 的口径）。
 * `rng` 可注入（测试走确定性序列）；`preferType` 有货优先、没货回退全池。
 */
export function pickDiverseAuthors(pool, count, preferType = null, rng = Math.random) {
    const arr = (Array.isArray(pool) ? pool : []).filter((a) => a && isActiveLofterType(a.type));
    const want = Math.max(0, Math.trunc(numOrNull(count) === null ? 0 : numOrNull(count)));
    if (want === 0 || arr.length === 0) return [];
    let cand = arr;
    if (preferType) {
        const preferred = arr.filter((a) => a.type === preferType);
        if (preferred.length > 0) cand = preferred;
    }
    const byType = new Map();
    for (const a of cand) {
        if (!byType.has(a.type)) byType.set(a.type, []);
        byType.get(a.type).push(a);
    }
    const types = [...byType.keys()].sort(() => (rng() < 0.5 ? -1 : 1));
    const picked = [];
    while (picked.length < want && types.some((t) => byType.get(t).length > 0)) {
        for (const t of types) {
            if (picked.length >= want) break;
            const p = byType.get(t);
            if (p.length === 0) continue;
            const idx = Math.floor(rng() * p.length);
            picked.push(p.splice(idx, 1)[0]);
        }
    }
    return picked.slice(0, want);
}

/** 文风解析：'random' / 找不到 / 全禁用 → 随机一个 enabled；字典空 → null。 */
export function resolveWritingStyle(styles, choice, rng = Math.random) {
    const list = (Array.isArray(styles) ? styles : []).filter((s) => s && s.enabled !== false);
    if (list.length === 0) return null;
    if (choice && choice !== 'random') {
        const found = list.find((s) => s.id === choice);
        if (found) return found;
    }
    return list[Math.floor(rng() * list.length)] || null;
}

/** 篇幅取数（坏值回 medium，**不许塌成 short**）。 */
export function chapterLengthSpec(key) {
    const k = String(key || '');
    return Object.prototype.hasOwnProperty.call(LOFTER_CHAPTER_LENGTHS, k)
        ? LOFTER_CHAPTER_LENGTHS[k] : LOFTER_CHAPTER_LENGTHS.medium;
}

/* ---------- 长篇滑窗 ---------- */

/**
 * 前序章节上下文：**最近 window 章给全文、更早给摘要**。
 * 返回 `{ blocks, fullCount, digestCount }` —— 计数显式回报（判据逐格断言）。
 */
export function prevChapterContext(chapters, currentChapterNum, window = LOFTER_FULL_TEXT_WINDOW) {
    const arr = (Array.isArray(chapters) ? chapters : [])
        .map((c) => normalizeArticle(c))
        .filter((c) => c.chapterNum !== null && c.chapterNum >= 1)
        .sort((a, b) => a.chapterNum - b.chapterNum);
    const cur = numOrNull(currentChapterNum);
    const before = (cur === null) ? arr : arr.filter((c) => c.chapterNum < cur);
    const w = Math.max(1, Math.trunc(numOrNull(window) === null ? LOFTER_FULL_TEXT_WINDOW : numOrNull(window)));
    const fromIdx = Math.max(0, before.length - w);
    const blocks = before.map((c, i) => {
        if (i >= fromIdx) {
            return { num: c.chapterNum, mode: 'full', title: c.title, text: c.content };
        }
        const synopsis = c.summary || (c.content || '').replace(/\s+/g, ' ').slice(0, 200) + '…';
        return { num: c.chapterNum, mode: 'digest', title: c.title, text: synopsis };
    });
    const digestCount = blocks.filter((b) => b.mode === 'digest').length;
    return { blocks, fullCount: blocks.length - digestCount, digestCount };
}

/** 下一章号：`现有最大章号 + 1`（空合集 → 1）。**不许被 chapterNum=0 带偏**。 */
export function nextChapterNum(articles, collectionId) {
    const cid = collectionId ? String(collectionId) : null;
    if (!cid) return 1;
    let max = 0;
    for (const a of (Array.isArray(articles) ? articles : [])) {
        if (!a || String(a.collectionId || '') !== cid) continue;
        const n = numOrNull(a.chapterNum);
        if (n !== null && n > max) max = Math.trunc(n);
    }
    return max + 1;
}

/** 章节定位：`isEnding` 由调用方显式给；`alreadyFinished` 决定「番外」口径。 */
export function chapterPositionFace(collection, chapterNum, isEnding) {
    const finished = collection && collection.status === 'finished';
    const n = numOrNull(chapterNum);
    let kind;
    if (isEnding === true) kind = 'ending';
    else if (n === null || n <= 1) kind = 'opening';
    else if (finished) kind = 'extra';
    else kind = 'ongoing';
    return { kind, num: n === null ? 1 : Math.trunc(n), alreadyFinished: finished };
}

/* ---------- 批量解析（---LOF---） ---------- */

const LOF_BLOCK_SEP = /---\s*LOF\s*---/i;

/**
 * 解析宿主机给的批量文本（源 `_parseLofterBatch` 的收口）。
 * 每块认 `TAG: [N1]` / `TYPE:` / `TITLE:` / `SUMMARY:` / `TAGS:` / `CONTENT:` /
 * `HAS_IMAGES:` / `IMAGE_COUNT:` / `COMMENT_N:`；**取不到归属作者即丢弃该块**。
 */
export function parseLofterBatch(raw, authors) {
    const text = String(raw || '');
    if (!text.trim()) return [];
    const pool = Array.isArray(authors) ? authors : [];
    const blocks = text.split(LOF_BLOCK_SEP).map((s) => s.trim()).filter(Boolean);
    const out = [];
    for (const block of blocks) {
        const tag = block.match(/TAG:\s*\[?N(\d+)\]?/i);
        if (!tag) continue;
        const idx = parseInt(tag[1], 10) - 1;
        const author = pool[idx];
        if (!author) continue;
        const typeRaw = (block.match(/^TYPE:\s*(short|meta|long)/im) || [])[1];
        const type = (typeRaw && typeRaw.toLowerCase() === 'meta') ? 'meta' : 'short';
        const title = (block.match(/^TITLE:\s*(.+)$/m) || [])[1];
        const summary = (block.match(/^SUMMARY:\s*([\s\S]*?)(?=\n[A-Z_]+:)/m) || [])[1];
        const tagsRaw = (block.match(/^TAGS:\s*(.+)$/m) || [])[1] || '';
        const tags = tagsRaw.split(/\s+/).map((t) => t.replace(/^#/, '').trim()).filter(Boolean).slice(0, LOFTER_LIMITS.maxTagsPerArticle);
        const contentMatch = block.match(/CONTENT:\s*([\s\S]*?)(?=\nHAS_IMAGES:|\nCOMMENT_\d|\nIMAGE_COUNT:|$)/i);
        const content = contentMatch ? commentFreeTail(contentMatch[1]) : '';
        if (!content || content.trim().length < 5) continue;
        const hasRaw = (block.match(/^HAS_IMAGES:\s*(true|false)/im) || [])[1];
        const hasImages = (String(hasRaw || '').toLowerCase() === 'true') || author.type === 'fan_artist';
        const imgRaw = (block.match(/^IMAGE_COUNT:\s*(\d+)/im) || [])[1];
        const imgN = numOrNull(imgRaw);
        const imageCount = Math.max(0, Math.min(LOFTER_LIMITS.maxImageCount, imgN === null ? (hasImages ? 1 : 0) : Math.trunc(imgN)));
        const comments = [];
        const re = /^COMMENT_\d+:\s*(.+?)\|(.+)$/mg;
        let m;
        while ((m = re.exec(block)) !== null) {
            const au = m[1].trim();
            const tx = m[2].trim();
            if (au && tx) comments.push({ author: au, content: tx });
        }
        out.push({
            author, type,
            title: title ? title.trim() : null,
            summary: summary ? summary.trim() : null,
            tags, content: content.trim(),
            hasImages, imageCount,
            comments: comments.slice(0, 8),
        });
    }
    return out;
}

/** 内容尾部若粘上了 `COMMENT_n:` 行，切掉（源靠前瞻，这里再兜一次）。 */
function commentFreeTail(s) {
    const idx = String(s || '').search(/^\s*COMMENT_\d+:/m);
    return idx >= 0 ? String(s).slice(0, idx) : String(s || '');
}

/** 把解析块拼成文章对象（**编号由调用方给**，本函数不掷随机）。 */
export function buildArticleFromBlock(parsed, opts = {}) {
    const p = parsed || {};
    const author = p.author || {};
    const id = String(opts.id || '');
    const now = numOrNull(opts.now) === null ? 0 : Math.trunc(opts.now);
    const cold = numOrNull(opts.cold) === null ? 30 : Math.trunc(opts.cold);
    const stats = deriveStats(author.followerCount, cold);
    const list = (Array.isArray(p.comments) ? p.comments : []).slice(0, 8).map((c, i) => ({
        id: id + '_c' + (i + 1),
        author: String(c.author || '').trim(),
        content: String(c.content || '').trim(),
        replyToCommentId: null,
        likes: Math.max(0, Math.floor(stats.hearts / 20)),
        isOpReply: false,
        createdAt: now + i * 800,
    }));
    return normalizeArticle({
        id,
        type: p.type === 'meta' ? 'meta' : 'short',
        title: p.title || '',
        summary: p.summary || '',
        content: p.content || '',
        authorId: String(author.id || ''),
        authorName: String(author.name || ''),
        collectionId: opts.collectionId || null,
        chapterNum: opts.chapterNum === undefined ? null : opts.chapterNum,
        tags: p.tags || [],
        hasImages: p.hasImages === true,
        imageCount: p.imageCount || 0,
        coverHue: opts.coverHue,
        stats: { hearts: stats.hearts, favorites: stats.favorites, comments: list.length },
        // ★ 组装好的评论必须**真的喂给规范器**：此前这里没传 `comments`，
        //   宿主给的 COMMENT_n 在 `normalizeArticle` 里被兜成空数组 ⇒ 收下的文章
        //   评论永远是 0 条，而 `stats.comments` 记的却是 `list.length`（自洽地错）。
        //   这与「规范器返回对象漏了 comments 键」是**同一形态的上下游两处**。
        comments: list,
        createdAt: now,
        editedAgoDisplay: String(opts.editedAgo || '刚刚'),
    });
}

/* ---------- 阅读面：过滤与搜索 ---------- */

/** 可见文章（`showInvalidArticles === false` 时滤掉标记失效的）。 */
export function visibleArticles(articles, settings) {
    const st = normalizeLofterSettings(settings);
    const arr = (Array.isArray(articles) ? articles : []).map((a) => normalizeArticle(a));
    const kept = st.showInvalidArticles ? arr : arr.filter((a) => a.content.length > 0);
    return kept.slice().sort((a, b) => b.createdAt - a.createdAt);
}

/** 按 tag 过滤（tag 前 `#` 已被规范化剥掉）。 */
export function articlesOfTag(articles, tag) {
    const t = String(tag || '').replace(/^#/, '').trim();
    if (!t) return [];
    return (Array.isArray(articles) ? articles : [])
        .map((a) => normalizeArticle(a))
        .filter((a) => a.tags.indexOf(t) >= 0);
}

/** 按月归档（本地月，返回 `[{ month, list }]` 倒序）。 */
export function groupByMonth(articles) {
    const arr = (Array.isArray(articles) ? articles : []).map((a) => normalizeArticle(a));
    const map = new Map();
    for (const a of arr) {
        const d = new Date(a.createdAt || 0);
        const key = (a.createdAt ? (d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')) : '未标注');
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(a);
    }
    return [...map.keys()].sort((x, y) => (x < y ? 1 : -1)).map((k) => ({ month: k, list: map.get(k) }));
}

/** 本地搜索：标题 / 摘要 / 正文 / tag 四处命中，**结果数有上界**。 */
export function searchArticles(articles, query, limit = LOFTER_LIMITS.maxSearchHits) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    const lim = Math.max(1, Math.trunc(numOrNull(limit) === null ? LOFTER_LIMITS.maxSearchHits : numOrNull(limit)));
    const hits = [];
    for (const a of (Array.isArray(articles) ? articles : [])) {
        const na = normalizeArticle(a);
        const hay = (na.title + '\n' + na.summary + '\n' + na.content + '\n' + na.tags.join(' ')).toLowerCase();
        const at = hay.indexOf(q);
        if (at < 0) continue;
        hits.push({ article: na, at, snippet: snippetOf(na, q) });
        if (hits.length >= lim) break;
    }
    return hits;
}

/** 命中片段（前后各 20 字）。 */
export function snippetOf(article, query) {
    const a = article || {};
    const q = String(query || '').toLowerCase();
    const hay = a.title + ' ' + a.content;
    const at = hay.toLowerCase().indexOf(q);
    if (at < 0) return String(a.content || '').slice(0, 40);
    const from = Math.max(0, at - 20);
    return (from > 0 ? '…' : '') + hay.slice(from, at + q.length + 20) + '…';
}

/* ---------- 订阅 / 互动 ---------- */

/** 在数组里切换某值（关注 / 订阅 / 收藏 三者共用）。返回新数组，**不原地改**。 */
export function toggleInList(list, value) {
    const v = String(value || '');
    const arr = (Array.isArray(list) ? list : []).map((x) => String(x || '')).filter(Boolean);
    if (!v) return arr.slice();
    return arr.indexOf(v) >= 0 ? arr.filter((x) => x !== v) : arr.concat([v]);
}

/** 订阅 tag 上界（源无上界；超限丢弃**最早的**并如实回报）。 */
export function addSubscribedTag(list, tag) {
    const t = String(tag || '').replace(/^#/, '').trim();
    const arr = (Array.isArray(list) ? list : []).map((x) => String(x || '').replace(/^#/, '').trim()).filter(Boolean);
    if (!t) return { list: arr, added: false, dropped: 0 };
    if (arr.indexOf(t) >= 0) return { list: arr, added: false, dropped: 0 };
    const next = arr.concat([t]);
    const lim = LOFTER_LIMITS.maxSubscribedTags;
    if (next.length <= lim) return { list: next, added: true, dropped: 0 };
    return { list: next.slice(next.length - lim), added: true, dropped: next.length - lim };
}

/** 一篇文章的「我」的状态（四态各自独立，**不许合并成一个 boolean**）。 */
export function myArticleFlags(store, articleId) {
    const s = (store && typeof store === 'object') ? store : {};
    const id = String(articleId || '');
    return {
        liked: toStrArr(s.myLikedArticleIds).indexOf(id) >= 0,
        favorited: toStrArr(s.myFavoritedArticleIds).indexOf(id) >= 0,
        footprint: toStrArr(s.myFootprintArticleIds).indexOf(id) >= 0,
        readLater: toStrArr(s.myReadLaterArticleIds).indexOf(id) >= 0,
    };
}

function toStrArr(v) {
    return Array.isArray(v) ? v.map((x) => String(x || '')) : [];
}

/** 足迹记录：只留最近 N 条（源的足迹无上界）。 */
export function recordFootprint(list, articleId, max = 60) {
    const id = String(articleId || '');
    const arr = toStrArr(list).filter((x) => x !== id);
    if (!id) return { list: arr, dropped: 0 };
    const next = [id].concat(arr);
    if (next.length <= max) return { list: next, dropped: 0 };
    return { list: next.slice(0, max), dropped: next.length - max };
}

/* ---------- 注入块（模型要看的那一段） ---------- */

/**
 * 产出给宿主生成侧的结构化要求（**不是请求**：本件不发任何网络调用）。
 * `mode` 三值：short（短文批量）/ chapter（长篇单章）/ comment（评论回复）。
 */
export function lofterPromptBlock(mode, payload = {}) {
    const m = String(mode || 'short');
    if (m === 'chapter') {
        const spec = chapterLengthSpec(payload.chapterLength);
        const pos = chapterPositionFace(payload.collection, payload.chapterNum, payload.isEnding);
        const ctx = prevChapterContext(payload.chapters || [], payload.chapterNum, payload.window);
        return {
            mode: 'chapter',
            authorName: String(payload.authorName || ''),
            collectionName: String((payload.collection && payload.collection.name) || ''),
            chapterNum: pos.num,
            position: pos.kind,
            lengthLabel: spec.label,
            lengthMin: spec.min,
            fullCount: ctx.fullCount,
            digestCount: ctx.digestCount,
            prevBlocks: ctx.blocks,
            styleRules: String(payload.styleRules || ''),
        };
    }
    if (m === 'comment') {
        return {
            mode: 'comment',
            articleTitle: String(payload.articleTitle || ''),
            articleAuthor: String(payload.articleAuthor || ''),
            readerName: String(payload.readerName || ''),
            readerText: String(payload.readerText || ''),
            wantsOpReply: payload.wantsOpReply === true,
        };
    }
    const types = Array.isArray(payload.types) ? payload.types : [];
    return {
        mode: 'short',
        authors: (Array.isArray(payload.authors) ? payload.authors : []).map((a) => ({
            name: String(a.name || ''), type: String(a.type || ''),
            style: String(a.writingStyle || ''), tags: toStrArr(a.contentTags).slice(0, 3),
        })),
        articleTypes: types.map((t) => ({ id: String(t.id || ''), label: String(t.label || '') })),
        userDirection: String(payload.userDirection || ''),
        count: Math.max(1, Math.min(5, numOrNull(payload.count) === null ? 2 : Math.trunc(numOrNull(payload.count)))),
    };
}

/* ---------- 投影（视图唯一的数据入口） ---------- */

/**
 * 现算投影：`render` 每次重取，不持跨轮副本（防陈旧）。
 * `dropped` / `expired` 如实回报（裁剪不许静默）。
 */
export function projectLofter(input = {}) {
    const settings = normalizeLofterSettings(input.settings);
    const authorsRaw = Array.isArray(input.authors) ? input.authors : [];
    const articlePrune = pruneList(input.articles, LOFTER_LIMITS.maxArticles);
    const colPrune = pruneList(input.collections, LOFTER_LIMITS.maxCollections);
    const articles = visibleArticles(articlePrune.kept, settings);
    const collections = colPrune.kept.map((c) => normalizeCollection(c));
    const store = (input.store && typeof input.store === 'object') ? input.store : {};
    const tagCounts = new Map();
    for (const a of articles) for (const t of a.tags) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
    const hotTags = [...tagCounts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 12)
        .map(([tag, n]) => ({ tag, count: n }));
    return {
        settings,
        authors: authorsRaw,
        articles,
        collections,
        hotTags,
        library: ['home', 'follow', 'me'],
        store: {
            followedAuthorIds: toStrArr(store.followedAuthorIds),
            subscribedTags: toStrArr(store.subscribedTags),
            subscribedCollectionIds: toStrArr(store.subscribedCollectionIds),
            myLikedArticleIds: toStrArr(store.myLikedArticleIds),
            myFavoritedArticleIds: toStrArr(store.myFavoritedArticleIds),
            myFootprintArticleIds: toStrArr(store.myFootprintArticleIds),
            myReadLaterArticleIds: toStrArr(store.myReadLaterArticleIds),
        },
        dropped: articlePrune.expired + colPrune.expired,
        totalArticles: articlePrune.total,
        totalCollections: colPrune.total,
        emptyAuthors: authorsRaw.length === 0,
    };
}
