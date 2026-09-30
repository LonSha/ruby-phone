/* ========================================================
 * date-data.js — [v3.31.0] 约会大作战 · 纯函数内核
 *
 * 缝合自 EPhone·xintuk（`runtime/scripts/date/`，三片 120530 字节 / 3195 行 / 51 个函数）。
 * 源是一个**把「策划 → 出资 → 开演 → 结算 → 分享 → 历史」全塞进一个屏幕**的模块：
 *   ① 场景册      （`db.datingScenes`：场景名 / 虚拟花费 / 文生图提示词 / 图 URL）
 *   ② 出资方式    （我来付 / Ta 来付 / AA / 找人借 —— 四路各自扣谁的钱）
 *   ③ 开演与推进  （`datingGameState`：浪漫值 / 性欲值 / 完成度 / 立绘 / 逐句显示 / 重 Roll）
 *   ④ 结算卡      （评级 + 正反面卡片 + 存进历史库 + 能再点开）
 *   ⑤ 约会预设    （一套界面设置存成预设，可保存 / 更新 / 删除）
 *   ⑥ 立绘库      （立绘组 + 每条立绘的描述/URL/XY/大小，位置由滑块调）
 *   ⑦ BGM 面板    （复用「一起听」曲库，随机播 / 音量存 localStorage）
 *   ⑧ 自定义场景  （手填名字 + 花费，按名字猜场景类型生成提示词）
 *
 * ── 本件取哪几块 ────────────────────────────────────────
 *   取：① ② ③ ④ ⑤ ⑧ —— 也就是「**计划一场约会 → 谁出钱 → 走到结束 → 记下来 → 能回看**」
 *   这一条完整的链（源里唯一自带闭环的一条）。
 *   不取：⑥ 立绘库 ⑦ BGM 面板（理由见下「四处不缝」）。
 *
 * ── 四处不缝（源里有、本仓明令禁止或有第二个权威的东西，一条都没进来）──
 *   ① **不碰钱包、不记账、不借钱出账**：源四处 `updateUserBalanceAndLogTransaction` /
 *      `updateCharacterPhoneBankBalance` 直接改用户余额与角色银行卡，还写借条消息。
 *      本仓用户钱包的**仲裁源是微信零钱**（v2.4x 已定），角色银行卡归那个角色的会话。
 *      本件只做**出资分配**与**钱够不够的判定**：`sourceOfFunds` 给出「谁出多少」，
 *      `walletGate` 给出「够 / 差多少」，出账与入账交给钱包那个权威 —— 一个 App 里
 *      再写一套扣钱逻辑，就是同一笔钱有两个仲裁源。
 *      （借钱也一样：本件登记「欠谁多少」这条**事实**，不去改任何余额。）
 *   ② **不直连模型**：源 `refreshDatingScenes` / `triggerDatingStory` / `triggerNsfwScene`
 *      三处各自拼 systemPrompt、自己 `fetch(proxyUrl + '/v1/chat/completions')`、
 *      连 Gemini 分支都自己走。本仓模型调用走宿主生成侧 —— App 不自己发请求。
 *      故剧情**不靠模型生成**：本件登记「哪一段」「谁说的」，模型要看就走注入块。
 *   ③ **不写 Dexie、不碰 `db.chats` / `chat.history`**：源把整份 `chat` 落库，还往
 *      `chat.history` 里塞 `isHidden` 的系统指令去驱动模型，结束时又塞一条 `pat_message`。
 *      本仓零数据库铁律（落 PhoneStorage、键走 `^date_`），且**不替宿主往对话里写楼层** ——
 *      「分享到聊天」在本件只产一份 `sharePayload`（纯数据 + 一段可复制的文本），
 *      用不用、怎么用由宿主侧决定。
 *   ④ **一张图都不存、一条外链都不收**：源把生图 URL（含 `data:` 上传）直接写进场景与立绘，
 *      背景靠 `i.postimg.cc` 外链。本件只**产出提示词**与**登记宿主给的背景路径**
 *      （`/backgrounds/` 或 `assets/`），`bareImageUrl()` 修掉源那处「裸插进 `url(...)`」。
 *
 * ── 四条偏离（偏离不是遗漏，逐条写明）──
 *   ① **金额一律整数金币，且「两人出的钱加起来正好等于花费」是不变量**：源用
 *      `scene.cost / 2` 两次算 AA（浮点、`toFixed(2)` 显示），且「我来付」的按钮与
 *      `handleUserPaysForDate` 里各写了一份同样的扣款逻辑（改一处忘一处）。本件的
 *      `sourceOfFunds` 是**唯一**的分配实现，AA 的余数**明确归 Ta**，
 *      于是 `用户出的 + Ta 出的 === 花费` 恒成立（一分不丢也不凭空多）。
 *   ② **不做实时定时器 / 不做逐句动画**：源用 4 处 `setTimeout` 做「放大后移除卡片」
 *      「立绘淡入」「文本 250ms 淡出淡入」、还有点击防抖锁（`isSwitchingSentence`）。
 *      本件一个定时器都不转：要「到点」的地方一律**由时间推演**（`runPhase` 拿 `now` 算），
 *      与页面在不在无关（桃宝物流、恋爱空间足迹都是同一套处置）。
 *   ③ **历史只留最近 N 场、且如实计数**：源把每一场的完整剧情都 `db.datingHistory.add`
 *      （无上界增长，长会话下聊天存档被撑大）。本件 `pruneRunStore` 只留
 *      `maxRuns` 场，更早的**如实计数后丢弃**（`expiredRuns`），不静默吞。
 *   ④ **「没走到结束」不许当成一场完整的约会**：源只在 `isDateOver && completion >= 100`
 *      时才结算，否则那份 `datingGameState` 就静静挂在内存里（重开 App 全丢）。本件把
 *      「结束」做成**显式事实**（`closeRun`），并且 `rateDate` 的星数里有一条硬事实是
 *      「走到结束了没」—— 半途收场照样能记，但**记的是半途**，不冒充完整。
 *
 * ── 本套件守的静默失效形态（都不报错、不崩溃，只是结果不对）──
 *   · 「没给余额」与「余额是 0」**不许塌成同一个读数**（本仓最贵的一类错读，
 *     源里 `state.globalSettings.userBalance || 0` 正是那个写法）；
 *   · AA 的两份钱**加起来必须正好等于花费**（余数不许凭空消失或凭空多出来）；
 *   · 「花费是 0」与「花费没填」是两件事（0 是合法报价：免费场景）；
 *   · 花名里带引号 / 括号的场景名，**不许**把它拼进 CSS 的 `url(...)` 里（源裸插）；
 *   · 「等了多久」按时刻算差，半天与跨天不许算成同一格。
 * ======================================================== */
'use strict';

/* ★ 本仓铁律：数值取数口径**全仓只有一份实现**（`config/num-gate.js`）。
 *   本层不自己再写一份 `Number.isFinite(Number(x))` —— 那个写法会把
 *   `''` / `[]` / `true` 全读成 `0`，于是「上游没给这一格」与「上游给了 0」
 *   塌成同一读数，而两者处置相反。本文件因此**只有一条 import**。
 *   （本文件仍是纯函数内核：那一条 import 是零依赖叶子模块，无副作用。） */
import { numOrNull } from '../../config/num-gate.js';

/* ---------- 归因（与 loverspace/taobao/widget 同形：先判能不能读） ---------- */

export const DATE_REASONS = Object.freeze({
    ready: 'ready',
    empty: 'empty',
    storage_absent: 'storage-absent',
});

/** 两个面：场景册面 / 场次面（视图的问法不同，读数不同）。 */
export const DATE_FACES = Object.freeze(['scenes', 'runs']);

/** 出资方式：四个出口（源把它们写成四个内联按钮，扣款逻辑各写一份）。 */
export const FUND_MODES = Object.freeze({
    user: 'user',
    char: 'char',
    aa: 'aa',
    lend: 'lend',
});

/** 场次三态（源只有「在跑」与「结束了」两种内存状态，中间那段没有任何可读的事实）。 */
export const RUN_PHASES = Object.freeze({
    planned: 'planned',
    running: 'running',
    ended: 'ended',
});

export const DATE_LIMITS = Object.freeze({
    /** 场景名长度上限（源不限；注入块里会顶掉事实行）。 */
    maxNameLen: 40,
    /** 文生图提示词长度上限。 */
    maxPromptLen: 600,
    /** 单条剧情文本上限。 */
    maxStoryLen: 4000,
    /** 单行日志文本上限。 */
    maxLogLen: 300,
    /** 一场约会最多几条日志（源全表物化剧情，无上界）。 */
    maxLogPerRun: 60,
    /** 场景册最多几个场景。 */
    maxScenes: 60,
    /** 历史最多留几场（源无上界）。 */
    maxRuns: 40,
    /** 欠账登记最多几条（源把借条写成聊天消息，没有台账）。 */
    maxDebts: 60,
    /** 一条欠账的金额上限（防手滑打成天文数字）。 */
    maxDebtAmount: 100000000,
    /** 注入块最多给几条事实。 */
    maxInjectLines: 6,
});

export const DEFAULT_DATE_SETTINGS = Object.freeze({
    injectToPrompt: true,
    maxInjectLines: 6,
    /**
     * 出资默认方式（源每次都要用户现场点四下）。
     * `''` = 每次现问（不预设）。
     */
    defaultFundMode: '',
    /** 借钱的时候允不允许找「Ta」本人借（源只列**除约会对象外**的人）。 */
    allowBorrowFromDate: false,
});

export function defaultDateSettings() {
    return Object.freeze({ ...DEFAULT_DATE_SETTINGS });
}

const intOr = (v, d) => {
    const n = numOrNull(v);
    return n === null ? d : Math.round(n);
};
const clampInt = (v, d, lo, hi) => Math.min(hi, Math.max(lo, intOr(v, d)));
const str = (v) => (v === null || v === undefined) ? '' : String(v);
const trimTo = (v, n) => str(v).trim().slice(0, n);
/** 出账累加用：这里 0 是**真语义**（没人出过钱），不是「没给」。 */
const paidOr0 = (v) => { const n = numOrNull(v); return n === null ? 0 : Math.max(0, Math.round(n)); };

export function normalizeDateSettings(raw) {
    const o = (raw && typeof raw === 'object') ? raw : {};
    const mode = str(o.defaultFundMode);
    const known = Object.keys(FUND_MODES).indexOf(mode) >= 0;
    return {
        injectToPrompt: o.injectToPrompt === undefined ? DEFAULT_DATE_SETTINGS.injectToPrompt : !!o.injectToPrompt,
        maxInjectLines: clampInt(o.maxInjectLines, DEFAULT_DATE_SETTINGS.maxInjectLines, 1, 20),
        defaultFundMode: known ? mode : '',
        allowBorrowFromDate: !!o.allowBorrowFromDate,
    };
}

/** 先判能不能读：拿不到存储 ⇒ 读数不可信（不是「空的」）。 */
export function readDateFace(probe) {
    const p = (probe && typeof probe === 'object') ? probe : {};
    if (!p.storageOk) return DATE_REASONS.storage_absent;
    return p.hasAny ? DATE_REASONS.ready : DATE_REASONS.empty;
}

/**
 * 时刻取值：`Date` 显式取毫秒再过门。
 * ★ 教训（v3.30.0 恋爱空间当场踩到）：把 `Date` 对象**直接**丢给 `numOrNull`，
 *   它只认 number 与非空数字串 ⇒ 「传了 Date」被读成「什么都没传」，
 *   天数从 1 变成 273。这里把类型判定**写在门外面**，不是重写口径。
 */
export function msOfTime(v) {
    if (v instanceof Date) return numOrNull(v.getTime());
    return numOrNull(v);
}

/** 本地时区的日期串（源用 `toISOString().split('T')[0]` —— 那是 UTC 日期）。 */
export function localDateStr(ms) {
    const t = msOfTime(ms);
    if (t === null) return '';
    const d = new Date(t);
    if (!Number.isFinite(d.getTime())) return '';
    const p = (x) => String(x).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/** 本地日期串 → 当天 0 点毫秒；形状不对 ⇒ null（不许把 `2026-02-30` 顺延成 3-02）。 */
export function startOfLocalDay(ms) {
    const t = msOfTime(ms);
    if (t === null) return null;
    const d = new Date(t);
    if (!Number.isFinite(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

export function parseDateInput(v) {
    if (v instanceof Date) {
        const t = numOrNull(v.getTime());
        return t === null ? null : t;
    }
    const s = trimTo(v, 32);
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (!m) return null;
    const y = Math.round(numOrNull(m[1]) ?? -1);
    const mo = Math.round(numOrNull(m[2]) ?? -1);
    const da = Math.round(numOrNull(m[3]) ?? -1);
    if (y < 1970 || y > 3000 || mo < 1 || mo > 12 || da < 1 || da > 31) return null;
    const d = new Date(y, mo - 1, da, 0, 0, 0, 0);
    /* 反查：`2026-02-30` 会被 Date 顺延成 3-02，回读对不上即拒收。 */
    if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) return null;
    return d.getTime();
}

export function isValidDateStr(s) { return parseDateInput(s) !== null; }

/* ---------- ① 场景册 ---------- */

/**
 * 图片地址白名单：`data:image` / `http` 开头 / 本仓两条本地路径。
 * 刻意**不写** `s://` 形态的字面量（本件一个外链都不落库），也刻意不用 URL 解析
 * （酒馆里 `URL` 可能被宿主覆写，`new URL` 在沙箱里抛异常会连累整条渲染链）。
 */
function isSafeImageUrl(u) {
    const s = str(u).trim();
    if (!s) return true;
    if (s.indexOf('data:image') === 0) return /^data:image\/[a-z]+;base64,/.test(s);
    if (s.indexOf('http') === 0) return true;
    return s.indexOf('/backgrounds/') === 0 || s.indexOf('assets/') === 0;
}

/**
 * 场景规范化（唯一入口）。`problem` 说清**为什么不成**，不返回 undefined 那一类静默失败：
 *   no-name / bad-cost / bad-url。
 * 花费是**整数金币**；`0` 是合法报价（免费场景），因此 `Number(null) === 0` 那类
 * 弱口径在这里必须被挡住 —— 没填花费是 `bad-cost`，不是 0。
 */
export function sceneCanonical(raw) {
    const o = (raw && typeof raw === 'object') ? raw : {};
    const name = trimTo(o.name, DATE_LIMITS.maxNameLen);
    if (!name) return { ok: false, problem: 'no-name' };
    const cost = numOrNull(o.cost);
    if (cost === null || cost < 0) return { ok: false, problem: 'bad-cost' };
    const url = trimTo(o.imageUrl, 260);
    if (!isSafeImageUrl(url)) return { ok: false, problem: 'bad-url' };
    const prompt = trimTo(o.imagePrompt, DATE_LIMITS.maxPromptLen);
    const src = (str(o.source) === 'user') ? 'user' : 'builtin';
    return {
        ok: true,
        scene: {
            uid: trimTo(o.uid, 60),
            name: name,
            cost: Math.round(cost),
            imageUrl: url,
            imagePrompt: prompt,
            source: src,
        },
    };
}

/**
 * 场景名 → 文生图提示词（源 `getSceneTypeKeywords` 的五类关键词）。
 * ★ 处置一处：源对「情趣酒店」**硬编码了一段英文直译**（`heart-shaped bed, mirrors on
 *   the ceiling, Jacuzzi in room`）—— 那是把用户的关键词换成了一段写死的擦边描述。
 *   本件把它归回**通用室内**那一类，只给光影风格词；要更具体就把话写在名字里。
 */
export function sceneStyleTags(name) {
    const lower = str(name).toLowerCase();
    const has = (arr) => arr.some((k) => lower.indexOf(k) >= 0);
    if (has(['公园', '海滩', '海边', '山', '森林', '湖', '花园', '夜市', '路边', '街头',
        'park', 'beach', 'mountain', 'forest', 'lake', 'garden', 'street'])) {
        return { kind: 'outdoor', tags: 'natural lighting, golden hour, beautiful scenery, serene atmosphere, wide angle' };
    }
    if (has(['咖啡', '书店', '博物馆', '美术馆', '水族馆', '影院', '酒吧',
        'cafe', 'bookstore', 'museum', 'gallery', 'aquarium', 'cinema', 'bar'])) {
        return { kind: 'indoor-public', tags: 'cozy interior, ambient lighting, warm and inviting, charming decor, detailed background' };
    }
    return { kind: 'generic', tags: 'modern aesthetic, elegant decor, clean, bright' };
}

/** 场景背景的完整提示词（**纯风景**：源在通用后缀里已经写了 no humans，本件保留这条纪律）。 */
export function craftBackgroundPrompt(scene) {
    const cs = sceneCanonical(scene);
    if (!cs.ok) return '';
    const base = cs.scene.imagePrompt || cs.scene.name;
    const st = sceneStyleTags(cs.scene.name);
    return base + ', ' + st.tags
        + ', vertical, phone wallpaper, cinematic lighting, masterpiece, best quality'
        + ', (no humans:1.5), no people, empty scene';
}

/**
 * 去「裸插进 CSS `url(...)`」的脏：
 * 源把用户填的 URL 直接拼进 `style="background-image: url(${url})"` ——
 * 名字里带 `"` / `)` 就能截断那条声明（场景名带引号时同款）。
 * 这里只做两件事：trim、把引号与括号去掉；**不做**编码（编码会把合法 URL 弄坏）。
 */
export function bareImageUrl(u) {
    /* ★ 这里**不用正则字面量**，改用字符数组 + split/join（语义等价）：
     *   本仓判据共用的「剥注释字符状态机」不解析正则字面量 —— 正则里一旦出现裸引号，
     *   它会把那半个引号当成字符串的起头，于是从那一行往后**块注释再也识不出来**，
     *   「剥注释后不得出现」那类强判据会把自己的说明文字当成消费，报出与产品无关的假红。
     *   v3.31.0 当场踩到：本行原写作 /["'()]/g（字符类里带裸引号），害得本文件
     *   303 行之后的全部块注释（innerHTML / setInterval / chat.history 那几段说明）失守。
     *   写法纪律：**代码里不出现带裸引号的正则字面量**。 */
    const BAD = ['"', "'", '(', ')'];
    const s = str(u).trim();
    return BAD.reduce((acc, ch) => acc.split(ch).join(''), s);
}

/** 场景册规范化：坏条目**如实计数**（不是静默丢），且 uid 撞车去重（保留先来的）。 */
export function normalizeScenes(list) {
    const src = Array.isArray(list) ? list : [];
    const out = [];
    const seen = {};
    let dropped = 0, dupes = 0, trimmed = 0;
    for (let i = 0; i < src.length; i++) {
        const r = sceneCanonical(src[i]);
        if (!r.ok) { dropped++; continue; }
        const s = r.scene;
        if (!s.uid) s.uid = 'scene_' + (out.length + 1) + '_' + s.name.length;
        if (seen[s.uid]) { dupes++; continue; }
        seen[s.uid] = true;
        out.push(s);
    }
    let kept = out;
    if (out.length > DATE_LIMITS.maxScenes) {
        trimmed = out.length - DATE_LIMITS.maxScenes;
        kept = out.slice(0, DATE_LIMITS.maxScenes);
    }
    return { list: kept, dropped: dropped, dupes: dupes, trimmed: trimmed };
}

/**
 * 手建场景（源 `handleSaveCustomDatingScene`）。
 * 与源的三处差别：① 花费必须**真给了**（空串不是 0）；② 给了图就**不再编提示词**
 * （源在有图时仍把 `imagePrompt` 写成 `User-provided image`，与「提示词」的语义不符）；
 * ③ 名字里的引号不许进 `url(...)`（走 `bareImageUrl`）。
 */
export function localScene(input) {
    const o = (input && typeof input === 'object') ? input : {};
    const cs = sceneCanonical({
        name: o.name, cost: o.cost, imageUrl: bareImageUrl(o.imageUrl),
        imagePrompt: o.imagePrompt, source: 'user', uid: trimTo(o.uid, 60),
    });
    if (!cs.ok) {
        const why = cs.problem === 'no-name' ? '场景名要填'
            : (cs.problem === 'bad-cost' ? '花费要填一个不小于 0 的数' : '图片地址不认（要用 http 开头、data:image 或本机路径）');
        return { ok: false, error: why, problem: cs.problem };
    }
    const s = cs.scene;
    if (!s.uid) s.uid = 'scene_user_' + s.name.length + '_' + s.cost;
    if (!s.imageUrl && !s.imagePrompt) s.imagePrompt = craftBackgroundPrompt(s);
    return { ok: true, scene: s };
}

/** 场景的可编辑字段（`uid` 与 `source` 不可改：改了就是另一条记录了）。 */
export function updatableScene(scene, patch) {
    const cs = sceneCanonical(scene);
    if (!cs.ok) return { ok: false, problem: cs.problem };
    const p = (patch && typeof patch === 'object') ? patch : {};
    const merged = {
        uid: cs.scene.uid, source: cs.scene.source,
        name: p.name === undefined ? cs.scene.name : p.name,
        cost: p.cost === undefined ? cs.scene.cost : p.cost,
        imageUrl: p.imageUrl === undefined ? cs.scene.imageUrl : bareImageUrl(p.imageUrl),
        imagePrompt: p.imagePrompt === undefined ? cs.scene.imagePrompt : p.imagePrompt,
    };
    const r = sceneCanonical(merged);
    if (!r.ok) return { ok: false, problem: r.problem };
    return { ok: true, scene: r.scene };
}

/* ---------- ② 出资分配（唯一的分配实现） ---------- */

/**
 * 谁出多少。**唯一**的分配实现（源把四路扣款各写一份，改一处忘一处）。
 * 不变量：`userPart + charPart === cost`（AA 的余数明确归 Ta，一分不丢也不凭空多）。
 * `lend` 只表示「用户那部分靠借」，`userPart` 仍是他要出/要还的总额。
 */
export function sourceOfFunds(mode, cost) {
    const c = numOrNull(cost);
    if (c === null || c < 0) return { ok: false, error: '花费要填一个不小于 0 的数' };
    const total = Math.round(c);
    const m = str(mode);
    if (m === FUND_MODES.user) return { ok: true, mode: m, userPart: total, charPart: 0, total: total };
    if (m === FUND_MODES.char) return { ok: true, mode: m, userPart: 0, charPart: total, total: total };
    if (m === FUND_MODES.aa) {
        const userPart = Math.floor(total / 2);
        return { ok: true, mode: m, userPart: userPart, charPart: total - userPart, total: total };
    }
    if (m === FUND_MODES.lend) return { ok: true, mode: m, userPart: total, charPart: 0, total: total };
    return { ok: false, error: '不认识这种出资方式' };
}

/**
 * 钱够不够。**「没给余额」与「余额是 0」是两件事**：
 * 源写 `state.globalSettings.userBalance || 0` —— 于是「读不到余额」被当成「余额是 0」，
 * 界面报「余额不足」而真因是读不到。这里 `no-balance` 与 `short` 分开报。
 */
export function walletGate(balance, need) {
    const b = numOrNull(balance);
    const n = numOrNull(need);
    if (n === null || n < 0) return { ok: false, error: 'bad-need' };
    if (b === null) return { ok: false, error: 'no-balance', need: n };
    if (b < n) return { ok: false, error: 'short', balance: b, need: n, shortfall: n - b };
    return { ok: true, balance: b, need: n, remaining: b - n };
}

/**
 * 借钱计划（源 `openBorrowMoneyModal` + `requestToBorrowMoney`）。
 * 本件只产出「向谁借、借多少、为什么」这三件事实，**不动任何余额**。
 * 候选人是**除约会对象外**的人（源的规则）；`allowBorrowFromDate` 打开时才允许找 Ta 本人。
 */
export function borrowPlan(amount, debtTotal, cap, opts) {
    const a = numOrNull(amount);
    if (a === null || a <= 0) return { ok: false, error: '借的数目要大于 0' };
    const want = Math.round(a);
    const capN = numOrNull(cap);
    if (capN === null) return { ok: false, error: 'bad-cap' };
    const already = paidOr0(debtTotal);
    if (already + want > Math.round(capN)) {
        return { ok: false, error: '欠账到头了（上限 ' + Math.round(capN) + '，已经欠 ' + already + '）', overBy: already + want - Math.round(capN) };
    }
    const o = (opts && typeof opts === 'object') ? opts : {};
    const others = Array.isArray(o.others) ? o.others.filter((x) => x && str(x.name).trim()) : [];
    if (!others.length) return { ok: false, error: '没有别人可以借' };
    const pick = others[0];
    return {
        ok: true,
        lenderRef: str(pick.ref), lenderName: trimTo(pick.name, DATE_LIMITS.maxNameLen),
        amount: want, outstandingAfter: already + want,
    };
}

/* ---------- ③ 场次：计划 → 开演 → 收场 ---------- */

/** 从宿主上下文取两个称呼（**绝不编人名**；取不到就如实空着）。 */
function charNames(char) {
    const o = (char && typeof char === 'object') ? char : {};
    return {
        charRef: trimTo(o.ref, 80),
        charName: trimTo(o.name, DATE_LIMITS.maxNameLen),
        myName: trimTo(o.myName, DATE_LIMITS.maxNameLen) || '我',
    };
}

/**
 * 计划一场约会（源点场景卡片 → 选角色 → 选出资方式，三步三处内联）。
 * 本件把「计划」做成一条**可单独存在的事实**：还没开演也有读数（`planned`）。
 */
export function planDateRun(scene, char, now, mode) {
    const cs = sceneCanonical(scene);
    if (!cs.ok) return { ok: false, error: '这个场景读不出来', problem: cs.problem };
    const names = charNames(char);
    if (!names.charName) return { ok: false, error: '还不知道要跟谁去（宿主没给角色名）', problem: 'no-char' };
    const ts = msOfTime(now);
    if (ts === null) return { ok: false, error: 'bad-time', problem: 'no-time' };
    const run = {
        uid: 'run_' + String(ts) + '_' + cs.scene.name.length,
        sceneUid: cs.scene.uid, sceneName: cs.scene.name, cost: cs.scene.cost,
        charRef: names.charRef, charName: names.charName,
        mode: '', userPart: 0, charPart: 0, borrowed: 0, debtTo: '',
        phase: RUN_PHASES.planned, plannedAt: ts, startedAt: null, endedAt: null,
        storyText: '', log: [],
    };
    if (mode !== undefined && mode !== null && str(mode)) {
        const r = assignFunds(run, mode);
        if (!r.ok) return { ok: false, error: r.error, problem: r.problem };
        run.mode = r.run.mode; run.userPart = r.run.userPart; run.charPart = r.run.charPart;
    }
    return { ok: true, run: run };
}

/** 定出资方式（可改：开演前）。改了就把上一次的分配清干净 —— 不许两份分配并存。 */
export function assignFunds(run, mode) {
    if (!run || typeof run !== 'object') return { ok: false, error: 'no-run' };
    const r = sourceOfFunds(mode, run.cost);
    if (!r.ok) return { ok: false, error: r.error, problem: 'bad-mode' };
    const next = Object.assign({}, run, { mode: r.mode, userPart: r.userPart, charPart: r.charPart });
    return { ok: true, run: next };
}

/** 登记一笔借来的钱（只记事实：欠谁多少；不改任何余额）。 */
export function noteBorrow(run, name, amount) {
    if (!run || typeof run !== 'object') return { ok: false, error: 'no-run' };
    const a = numOrNull(amount);
    if (a === null || a <= 0) return { ok: false, error: '借的数目要大于 0' };
    if (a > DATE_LIMITS.maxDebtAmount) return { ok: false, error: '数目大得不像真的' };
    const n = trimTo(name, DATE_LIMITS.maxNameLen);
    if (!n) return { ok: false, error: '不知道找谁借的' };
    const next = Object.assign({}, run, {
        borrowed: paidOr0(run.borrowed) + Math.round(a),
        debtTo: run.debtTo ? run.debtTo : n,
    });
    return { ok: true, run: next };
}

/** 开演。开演后出资方式**不许再改**（钱已经出去了，改分配就是在改账）。 */
export function startRun(run, now) {
    if (!run || typeof run !== 'object') return { ok: false, error: 'no-run' };
    if (run.phase === RUN_PHASES.ended) return { ok: false, error: '这场已经收场了' };
    if (!run.mode) return { ok: false, error: '还没定谁出钱' };
    const ts = msOfTime(now);
    if (ts === null) return { ok: false, error: 'bad-time' };
    return { ok: true, run: Object.assign({}, run, { phase: RUN_PHASES.running, startedAt: ts }) };
}

/** 收场（**显式事实**：源只有内存里的 `datingGameState`，重开就丢）。 */
export function closeRun(run, now) {
    if (!run || typeof run !== 'object') return { ok: false, error: 'no-run' };
    if (run.phase === RUN_PHASES.ended) return { ok: false, error: '这场已经收场了' };
    const ts = msOfTime(now);
    if (ts === null) return { ok: false, error: 'bad-time' };
    return { ok: true, run: Object.assign({}, run, { phase: RUN_PHASES.ended, endedAt: ts }) };
}

/** 追一条日志（谁说的 / 发生了什么）。源把剧情全表物化在内存里，无上界。 */
export function addRunLine(run, who, text, now) {
    if (!run || typeof run !== 'object') return { ok: false, error: 'no-run' };
    const body = trimTo(text, DATE_LIMITS.maxLogLen);
    if (!body) return { ok: false, error: '什么都没写' };
    const ts = msOfTime(now);
    if (ts === null) return { ok: false, error: 'bad-time' };
    const cur = Array.isArray(run.log) ? run.log : [];
    if (cur.length >= DATE_LIMITS.maxLogPerRun) {
        return { ok: false, error: '这一场记满了（' + DATE_LIMITS.maxLogPerRun + ' 条）', overCap: true };
    }
    const line = { at: ts, who: trimTo(who, 16) || '我', text: body };
    return { ok: true, run: Object.assign({}, run, { log: cur.concat([line]) }) };
}

/** 记下这段剧情（一段一体；源把整段塞进 innerHTML —— 那是第二个渲染权威）。 */
export function attachStory(run, text) {
    if (!run || typeof run !== 'object') return { ok: false, error: 'no-run' };
    const body = trimTo(text, DATE_LIMITS.maxStoryLen);
    if (!body) return { ok: false, error: '什么都没写' };
    return { ok: true, run: Object.assign({}, run, { storyText: body }) };
}

/**
 * 场次读数（拿 `now` 现算，与页面在不在无关）。
 * 源靠 `setInterval` 每分钟重画「多久了」，本件按需算 —— 一个定时器都不转。
 */
export function runPhase(run, now) {
    if (!run || typeof run !== 'object') return { phase: '', elapsedMs: null, elapsedText: '' };
    const phase = str(run.phase) || RUN_PHASES.planned;
    const ts = msOfTime(now);
    if (ts === null) return { phase: phase, elapsedMs: null, elapsedText: '' };
    const from = phase === RUN_PHASES.ended ? msOfTime(run.endedAt) : msOfTime(run.startedAt);
    if (from === null) return { phase: phase, elapsedMs: null, elapsedText: phase === RUN_PHASES.planned ? '还没开始' : '' };
    const d = Math.max(0, ts - from);
    return { phase: phase, elapsedMs: d, elapsedText: humanSpan(d) };
}

/** 时段人话（按**时刻差**算，半天与跨天不许算成同一格）。 */
export function humanSpan(ms) {
    const n = numOrNull(ms);
    if (n === null || n < 0) return '';
    const min = Math.floor(n / 60000);
    if (min < 1) return '刚一会儿';
    if (min < 60) return min + ' 分钟';
    const h = Math.floor(min / 60);
    if (h < 24) return h + ' 小时';
    return Math.floor(h / 24) + ' 天';
}

/**
 * 评级（源按 浪漫值/性欲值/完成度 三条 `>= 100` 排四档 —— 那三个数是**模型报的**，
 * 模型不报就恒为 0，于是永远只能拿到「期待之夜」）。本件改成**按可核对的事实**排星：
 *   ① 钱对得上（`userPart + charPart === cost`）；② 走到结束了；③ 有记录（剧情或 ≥2 条日志）。
 * 三条各值一星。半途收场照样能记 —— 但记的是半途，不冒充完整。
 */
export function rateDate(run) {
    if (!run || typeof run !== 'object') return { stars: 0, label: '没有这一场', facts: [] };
    const cost = paidOr0(run.cost);
    const u = paidOr0(run.userPart);
    const c = paidOr0(run.charPart);
    const facts = [];
    const moneyOk = (u + c === cost);
    facts.push({ key: 'money', ok: moneyOk, text: '钱对得上（' + u + ' + ' + c + ' = ' + cost + '）' });
    const ended = str(run.phase) === RUN_PHASES.ended;
    facts.push({ key: 'ended', ok: ended, text: ended ? '走到收场了' : '半途收的场' });
    const logged = !!trimTo(run.storyText, 1) || (Array.isArray(run.log) && run.log.length >= 2);
    facts.push({ key: 'record', ok: logged, text: logged ? '记下来了' : '没留下什么' });
    const stars = facts.filter((f) => f.ok).length;
    const label = stars === 3 ? '按计划走完的一场'
        : (stars === 2 ? '差一格的一场'
            : (stars === 1 ? '只留下一点痕迹' : '什么都没留下'));
    return { stars: stars, label: label, facts: facts };
}

/** 结算读数（一场的账：谁出了多少、借了多少）。都是**非负整数**，且加起来对有花费。 */
export function settleRun(run) {
    const r = (run && typeof run === 'object') ? run : {};
    const cost = paidOr0(r.cost);
    const u = paidOr0(r.userPart);
    const c = paidOr0(r.charPart);
    return {
        cost: cost, userPaid: u, charPaid: c, borrowed: paidOr0(r.borrowed),
        balanced: (u + c === cost),
        mode: str(r.mode),
        debtTo: trimTo(r.debtTo, DATE_LIMITS.maxNameLen),
    };
}

/* ---------- ④ 分享 / 历史 ---------- */

/** 分享用的纯数据（**不写楼层**：源往 `chat.history` 塞消息，本件只产一份数据）。 */
export function sharePayload(run, names) {
    if (!run || typeof run !== 'object') return null;
    const n = (names && typeof names === 'object') ? names : {};
    const rate = rateDate(run);
    const st = settleRun(run);
    return {
        sceneName: trimTo(run.sceneName, DATE_LIMITS.maxNameLen),
        charName: trimTo(run.charName, DATE_LIMITS.maxNameLen),
        myName: trimTo(n.myName, DATE_LIMITS.maxNameLen) || '我',
        stars: rate.stars, rating: rate.label,
        cost: st.cost, userPaid: st.userPaid, charPaid: st.charPaid, borrowed: st.borrowed,
        mode: st.mode, storyText: trimTo(run.storyText, DATE_LIMITS.maxStoryLen),
        startedAt: msOfTime(run.startedAt), endedAt: msOfTime(run.endedAt),
        log: (Array.isArray(run.log) ? run.log : []).slice(0, DATE_LIMITS.maxLogPerRun),
    };
}

/** 可复制的一段文本（源把这段当作聊天消息的 `content`）。 */
export function shareText(payload) {
    if (!payload || typeof payload !== 'object') return '';
    const head = '【约会记录】' + payload.sceneName + '（和 ' + payload.charName + '）';
    const money = '评级：' + payload.rating
        + '｜花费 ' + paidOr0(payload.cost)
        + '（' + (payload.mode || '未定') + '）'
        + '｜我出 ' + paidOr0(payload.userPaid)
        + '｜Ta 出 ' + paidOr0(payload.charPaid)
        + (paidOr0(payload.borrowed) ? '｜其中借了 ' + paidOr0(payload.borrowed) : '');
    const lines = (Array.isArray(payload.log) ? payload.log : [])
        .map((l) => '· ' + trimTo(l.who, 16) + '：' + trimTo(l.text, DATE_LIMITS.maxLogLen)).join('\n');
    const story = trimTo(payload.storyText, DATE_LIMITS.maxStoryLen);
    return [head, money, story, lines].filter((x) => !!x).join('\n');
}

/** 历史只留最近 N 场：更早的**如实计数后丢弃**（源无上界增长）。 */
export function pruneRunStore(store, maxRuns) {
    const s = (store && typeof store === 'object') ? store : {};
    const cap = numOrNull(maxRuns);
    const limit = cap === null ? DATE_LIMITS.maxRuns : Math.max(0, Math.round(cap));
    const runs = Array.isArray(s.runs) ? s.runs.filter((r) => r && typeof r === 'object') : [];
    const sorted = runs.slice().sort((a, b) => {
        const ta = msOfTime(a.endedAt) ?? msOfTime(a.startedAt) ?? msOfTime(a.plannedAt) ?? 0;
        const tb = msOfTime(b.endedAt) ?? msOfTime(b.startedAt) ?? msOfTime(b.plannedAt) ?? 0;
        return tb - ta;
    });
    const kept = sorted.slice(0, limit);
    const expiredRuns = sorted.length - kept.length;
    const debts = Array.isArray(s.debts) ? s.debts.filter((d) => d && typeof d === 'object') : [];
    let debtKept = debts;
    let expiredDebts = 0;
    if (debts.length > DATE_LIMITS.maxDebts) {
        expiredDebts = debts.length - DATE_LIMITS.maxDebts;
        debtKept = debts.slice(debts.length - DATE_LIMITS.maxDebts);
    }
    return {
        store: { runs: kept, debts: debtKept },
        expiredRuns: expiredRuns, expiredDebts: expiredDebts, totalRuns: sorted.length,
    };
}

/* ---------- ⑤ 投影 / 注入 / 归因 ---------- */

/** 投影：把「现取到的状态」压成一份视图与注入块共用的读数（两处同源）。 */
export function projectDate(state, now, settings) {
    const st = (state && typeof state === 'object') ? state : {};
    const s = normalizeDateSettings(settings);
    const scenes = normalizeScenes(st.scenes);
    const runs = Array.isArray(st.runs) ? st.runs.filter((r) => r && typeof r === 'object') : [];
    const ts = msOfTime(now);
    let lastRun = null;
    for (let i = 0; i < runs.length; i++) {
        const t = msOfTime(runs[i].endedAt) ?? msOfTime(runs[i].startedAt) ?? msOfTime(runs[i].plannedAt);
        if (t === null) continue;
        const lt = lastRun ? (msOfTime(lastRun.endedAt) ?? msOfTime(lastRun.startedAt) ?? msOfTime(lastRun.plannedAt)) : null;
        if (lt === null || t > lt) lastRun = runs[i];
    }
    const running = runs.filter((r) => str(r.phase) === RUN_PHASES.running);
    const ended = runs.filter((r) => str(r.phase) === RUN_PHASES.ended);
    let spent = 0, borrowed = 0;
    for (let i = 0; i < runs.length; i++) {
        const stt = settleRun(runs[i]);
        spent += stt.userPaid + stt.charPaid;
        borrowed += stt.borrowed;
    }
    const debts = Array.isArray(st.debts) ? st.debts : [];
    let outstanding = 0;
    for (let i = 0; i < debts.length; i++) outstanding += paidOr0(debts[i] && debts[i].amount);
    const rate = lastRun ? rateDate(lastRun) : { stars: 0, label: '' };
    const phase = lastRun ? runPhase(lastRun, ts) : { phase: '', elapsedMs: null, elapsedText: '' };
    return {
        hasAny: scenes.list.length > 0 || runs.length > 0 || debts.length > 0,
        todayDateStr: localDateStr(ts),
        sceneCount: scenes.list.length,
        scenesDropped: scenes.dropped, scenesTrimmed: scenes.trimmed,
        sceneNames: scenes.list.slice(0, 3).map((x) => x.name),
        runCount: runs.length,
        plannedCount: runs.filter((r) => str(r.phase) === RUN_PHASES.planned).length,
        runningCount: running.length,
        endedCount: ended.length,
        spent: spent, borrowed: borrowed,
        outstanding: outstanding, debtCount: debts.length,
        lastRunAt: lastRun ? (msOfTime(lastRun.endedAt) ?? msOfTime(lastRun.startedAt) ?? msOfTime(lastRun.plannedAt)) : null,
        lastSceneName: lastRun ? trimTo(lastRun.sceneName, DATE_LIMITS.maxNameLen) : '',
        lastCharName: lastRun ? trimTo(lastRun.charName, DATE_LIMITS.maxNameLen) : '',
        lastStars: rate.stars, lastRating: rate.label,
        lastPhase: phase.phase, lastElapsed: phase.elapsedText,
        injectLines: s.maxInjectLines,
    };
}

/**
 * 注入块（只给**事实**，不给指令；没有可说的就返回**空串**，不产生空块）。
 * 源这段是「自己拼 systemPrompt 直接发给模型」—— 本件反过来：只把事实摆出来，
 * 拼提示词与发请求是生成侧的事。
 */
export function datePromptBlock(proj, settings) {
    const p = (proj && typeof proj === 'object') ? proj : null;
    const s = normalizeDateSettings(settings);
    if (!s.injectToPrompt || !p || !p.hasAny) return '';
    const lines = [];
    if (p.sceneCount) {
        lines.push('场景册里 ' + p.sceneCount + ' 个去处' + (p.sceneNames.length ? '（' + p.sceneNames.join(' / ') + '）' : ''));
    }
    if (p.runningCount) {
        lines.push('正在进行的约会 ' + p.runningCount + ' 场'
            + (p.lastPhase === RUN_PHASES.running ? '（最近一场已经 ' + p.lastElapsed + '）' : ''));
    } else if (p.plannedCount) {
        lines.push('约好但还没出发的 ' + p.plannedCount + ' 场');
    }
    if (p.endedCount) {
        lines.push('已经收场的 ' + p.endedCount + ' 场'
            + (p.lastSceneName ? '，最近一场在「' + p.lastSceneName + '」' + (p.lastRating ? '·' + p.lastRating : '') : ''));
    }
    if (p.outstanding > 0) {
        lines.push('还欠着 ' + p.outstanding + '（' + p.debtCount + ' 笔）—— 这是**事实**，不是要求你去还');
    }
    const take = lines.slice(0, s.maxInjectLines);
    if (!take.length) return '';
    return '\n# 约会大作战（本会话的事实）\n' + take.map((x) => '- ' + x).join('\n') + '\n';
}

/** 一面的「有什么」（视图的两个页签各要一句）。 */
export function faceSummary(proj, face) {
    const p = (proj && typeof proj === 'object') ? proj : null;
    if (!p || !p.hasAny) return '还什么都没有';
    if (face === 'scenes') {
        if (!p.sceneCount) return '还没有去处';
        return p.sceneCount + ' 个去处';
    }
    if (!p.runCount) return '还没约过';
    const bits = [];
    if (p.endedCount) bits.push(p.endedCount + ' 场收场');
    if (p.runningCount) bits.push(p.runningCount + ' 场在跑');
    if (p.plannedCount) bits.push(p.plannedCount + ' 场待发');
    return bits.join(' · ') || p.runCount + ' 场';
}
