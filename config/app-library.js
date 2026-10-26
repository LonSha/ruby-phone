/* ============================================================
 * config/app-library.js — 桌面分层与「应用库」分类（唯一真源）
 * ------------------------------------------------------------
 * 为什么存在（真机实测报障，不是整洁性偏好）：
 *   用户装机后第一句反馈是「app 数量很多，但有很多是没什么作用的，该整合的整合」，
 *   并给出截图：桌面 5 页共 **89 个图标**，从「微信/微博」一路排到
 *   「思维链案头 / 诊断案头 / 旅行记账案头 / 结构化记忆案头」——
 *   拟物水蓝图标、白底方图标、原生 emoji 三套视觉混在同一个网格里。
 *
 * 为什么是「分层」而不是「删 App」：
 *   这些案头每一个背后都有真实的运行时、会话存储键与路由分支
 *   （`scripts/registry-audit.mjs` 的 R1 要求 `APPS` 与懒加载分支**互为子集**）。
 *   删 id = 同时删路由 = 用户已落盘的数据变成孤儿；而且其中确实有会被用到的
 *   （体检、周期数学、纪念日……）。故一层不动数据，只改**呈现**：
 *     · `desktop` —— 桌面上直接可见的高频入口（20 个，见 CORE_APP_IDS）；
 *     · `library` —— 收进「应用库」，按类目分组、可搜索，一次点击即可打开。
 *   桌面因此回到 2 页（20 核心 + 1 应用库入口），而功能一个都没少。
 *
 * 判据来源：核心 20 个按「实机反馈里真正在用的那几类」定 —— 社交 / 通话 / 内容 /
 *   影像 / 日程 / 游戏 / 钱包 / 健康 / 记忆 / 设置 / 搜索 / 通知。
 *   `tests/system-v4870.test.mjs` 会校验本表**覆盖 APPS 全集且无孤儿**
 *   （新增 App 必须显式归类，否则门禁红灯 —— 不允许再默默长回 89 个图标）。
 * ============================================================ */

/** 桌面直接可见的核心入口（顺序即桌面图标顺序）。 */
export const CORE_APP_IDS = Object.freeze([
    'wechat', 'weibo', 'honey', 'mofo', 'wangxiang', 'phone',
    'diary', 'album', 'music', 'calendar',
    'games', 'health', 'wallet', 'memory',
    'xhs', 'tieba', 'bilibili', 'worldpulse',
    'search', 'notifications', 'settings'
]);

/** 应用库类目（顺序即展示顺序；描述给用户看，不是给代码看）。 */
export const APP_LIBRARY_CATEGORIES = Object.freeze([
    { id: 'social', name: '社交与形象', hint: '形象、商城、社交边界' },
    { id: 'content', name: '内容与阅读', hint: '读、看、逛' },
    { id: 'creative', name: '创作与记录', hint: '写、存、总结' },
    { id: 'life', name: '生活与时间', hint: '日程、习惯、天气' },
    { id: 'money', name: '财务', hint: '账、资产、存钱' },
    { id: 'body', name: '身体与亲密', hint: '健康、周期、纪念日' },
    { id: 'system', name: '系统与诊断', hint: '体检、备份、治理' }
]);

/** appId → 类目 id。必须覆盖 APPS 全集（门禁校验，不允许默默漏归类）。 */
export const APP_CATEGORY = Object.freeze({
    /* —— 社交与形象 —— */
    cheat: 'social',
    dirtytalk: 'social',
    profile: 'social',
    chars: 'social',
    loverspace: 'social',
    date: 'social',
    avatarframe: 'social',
    shop: 'social',
    taobao: 'social',
    block: 'social',
    socialguard: 'social',
    stickerdesk: 'social',
    peek: 'social',
    comms: 'social',
    affairs: 'social',

    /* —— 内容与阅读 —— */
    theater: 'content',
    reading: 'content',
    lofter: 'content',
    pixiv: 'content',
    magazine: 'content',
    doujin: 'content',
    soundkit: 'content',
    musicdesk: 'content',
    pvdesk: 'content',
    cardtable: 'content',
    gacha: 'content',
    mood: 'content',
    tarot: 'content',

    /* —— 创作与记录 —— */
    playbook: 'creative',
    achievement: 'creative',
    plotline: 'creative',
    cotdesk: 'creative',
    summdesk: 'creative',
    creationdesk: 'creative',
    archive: 'creative',
    sourcebook: 'creative',
    recall: 'creative',
    memtable: 'creative',
    lexiscore: 'creative',
    graph: 'creative',

    /* —— 生活与时间 —— */
    clock: 'life',
    focus: 'life',
    punchcard: 'life',
    weather: 'life',
    place: 'life',
    timeweaver: 'life',
    needsim: 'life',
    kettle: 'life',
    taskentry: 'life',
    workflow: 'life',

    /* —— 财务 —— */
    ledger: 'money',
    asset: 'money',
    accounting: 'money',
    piggy: 'money',
    traveldesk: 'money',

    /* —— 身体与亲密 —— */
    uterus: 'body',
    periodmath: 'body',
    annidate: 'body',
    caphealth: 'body',
    diagnose: 'body',
    diagdesk: 'body',

    /* —— 系统与诊断 —— */
    usage: 'system',
    regexfilter: 'system',
    freehome: 'system',
    widget: 'system',
    backupdesk: 'system',
    sullydesk: 'system',
    accessdesk: 'system'
});

/** 应用库入口的伪 appId（**不**进入 APPS：它没有自己的模块与路由，
 *   由外壳直接渲染，故绝不能出现在注册三件套任一侧，否则 R1 立刻变孤儿）。 */
export const APP_LIBRARY_ENTRY_ID = '__library';

/** 该 app 在桌面还是在应用库。未归类的一律进库（宁可收起来，不占桌面）。 */
export function appZone(appId) {
    const id = String(appId || '');
    return CORE_APP_IDS.includes(id) ? 'desktop' : 'library';
}

/** 该 app 的库类目（核心 App 与未归类返回 system —— 后者会被门禁点名）。 */
export function appCategory(appId) {
    return APP_CATEGORY[String(appId || '')] || 'system';
}

/** 把分类信息挂到 APPS 的每一项上（幂等；apps.js 在数组定义后调用一次）。
 *   为什么不要求每个 App 条目手写 zone/category：89 个条目手写必然漂移，
 *   而「桌面 or 库」「属于哪一类」是全局策略，改策略要能一处改完。 */
export function decorateApps(apps) {
    if (!Array.isArray(apps)) return apps;
    for (const app of apps) {
        if (!app || typeof app !== 'object') continue;
        app.zone = appZone(app.id);
        app.libraryCategory = appCategory(app.id);
    }
    return apps;
}