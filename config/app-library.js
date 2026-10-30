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
 *   （体检、周期数学、纪念日……）。故一层不动数据，只改**呈现**。
 *
 * 三层语义（[v4.98.0 · R11-O6] 一次说清；三者关系与优先级不许再混 —— v4.92.0 就是混出来的）：
 *   ① `CORE_APP_IDS`（**21** 个）= **预装不可删** —— 只表达「用户侧卸不掉」，不表达呈现；
 *   ② `CORE_DESKTOP_IDS`（**8** 个，定义在 `app-clusters.js`）= **桌面首屏平铺** —— 纯呈现策略；
 *   ③ `APP_CATEGORY`（**89** 键）= **库类目** —— 必须覆盖 `APPS` 全集；聚合壳 / 应用库 /
 *      搜索 / 使用范式全部按它取类目。
 *   优先级：**桌面铺什么看 ②，库怎么分组看 ③，①只说明哪些不能卸**。
 *   ★ 为什么 ③ 必须覆盖 89、而不是「只覆盖进库的那些」：缺登记会静默 fallback `'system'`，
 *     于是 13 个核心 App（微博 / 音乐 / 健康 / 钱袋 / 记忆 / B站 / 贴吧 / 小红书 / 世界脉搏 /
 *     搜索 / 通知 / 魔坊 / 万象）整批躺进「系统与诊断」壳 —— 那正是用户截图里最刺眼的错分。
 *     **核心 App 不进壳 ≠ 不需要类目**。
 *   `tests/system-v4920.test.mjs` 与 `tests/system-v4990.test.mjs` 校验本表覆盖 `APPS` 全集、
 *   壳成员上限与上述三层语义（新增 App 必须显式归类，否则门禁红灯）。
 * ============================================================ */

/** 预装不可删的核心 App（**21** 个）。顺序沿用 v2.x 桌面原序，供库 / 搜索兜底排序。
 *  ★ 它**不是**「桌面上铺几个」的真源 —— 桌面首屏是 `app-clusters.js` 的
 *    `CORE_DESKTOP_IDS`（8 个）；本表只表达「用户侧不可卸载」。
 *  ★ 与 `APP_CATEGORY` 的关系：本表任一 id 都**必须**在类目表里有登记（判据看守）。 */

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
    /* [v4.98.0 · R11-O6] 核心 App 的类目也必须登记（不进壳 ≠ 不需类目）——
     *   缺登记会静默 fallback 'system'，正是本轮 13 处错分的成因。 */
    wechat: 'social',
    honey: 'social',
    phone: 'social',
    wangxiang: 'social',
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
    weibo: 'content',
    album: 'content',
    music: 'content',
    games: 'content',
    xhs: 'content',
    tieba: 'content',
    bilibili: 'content',
    worldpulse: 'content',
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
    diary: 'creative',
    memory: 'creative',
    mofo: 'creative',
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
    calendar: 'life',
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
    wallet: 'money',
    ledger: 'money',
    asset: 'money',
    accounting: 'money',
    piggy: 'money',
    traveldesk: 'money',

    /* —— 身体与亲密 —— */
    health: 'body',
    uterus: 'body',
    periodmath: 'body',
    annidate: 'body',
    caphealth: 'body',
    diagnose: 'body',
    diagdesk: 'body',

    /* —— 系统与诊断 —— */
    /* 真·系统/诊断类只应在此；内容/社交类 App 若有成员被塞进来，一定是类目漏登记。 */
    settings: 'system',
    search: 'system',
    notifications: 'system',
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

/** 该 app 是否属于「预装核心」这一族（`desktop`），其余归 `library`。
 *  ★ [v4.98.0 · R11-O6] 本函数的 `desktop` **不等于**「桌面上铺出来」——
 *    桌面首屏由 `app-clusters.js` 的 `CORE_DESKTOP_IDS` + 聚合壳决定（8+7=15 格，见 buildDesktopTiles）。
 *    本函数现在服务两处：① 应用库（R11-O7 复活后）按 `library` 族给默认排序权重；
 *    ② 兼容 v4.87 的两分法语义，不制造第二套「什么进库」的真源。
 *  ★ 判据 `tests/system-v4990.test.mjs` 看守「凡是 CORE_APP_IDS 必有类目」，防止再次错分。 */
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