/* ============================================================
 * app-consumption-matrix.js — 80 App × 六条消费面矩阵 [v3.55.0 · 计划 A2]
 * ------------------------------------------------------------
 * 【本面治的欠债（修前实测处境）】
 *   素材缝合第 1~3 层共缝入三十余件 App，每件都做到了「四层齐备 + 六处接线 + 判据带负控制」，
 *   但缝的是**案头 / 数据面**。缝完之后，平台级的六条消费面（生成侧注入 / 全局搜索 / 系统通知 /
 *   微信链路 / 上游读数 / 生命周期重绑）**是否覆盖了这些新 App**，全仓没有任何一处能回答：
 *   要么逐文件读注释（注释不随对面漂移），要么靠人肉 review。
 *   而本仓反复出现的最贵缺陷形态正是这一类：**不报错、不崩溃、只是默默不生效**
 *   （缝进来的 App 打不开全局搜索、发不出通知、换会话后数据还挂在旧角色上）。
 *
 * 【本模块只陈列事实，不做取数】
 *   六个 `faces` 布尔值全部由 `tests/system-v3550.test.mjs` 从**磁盘真源独立复算**并与本表
 *   双向对账；本文件不自己读文件、不自己判形态。两个理由：
 *     ① 声明与事实分开存放 ⇒ 两者不一致时才有判别力（同源自述必然恒绿）；
 *     ② 同一轮里不会出现第二个取数点（本仓「同一读数的两个来源必然漂移」的根因形态）。
 *
 * 【六条消费面的口径（每条都以「真源在哪」定义，不以名字定义）】
 *   · F1_inject        生成侧注入
 *       App 自己在 GENERATE_BEFORE_COMBINE_PROMPTS 主钩子上挂注入块（promptBlock / buildPromptDirective / buildInjectionPrompt）
 *       真源：apps/<dir>/<x>-app.js 内出现 GENERATE_BEFORE_COMBINE_PROMPTS
 *   · F2_search        全局搜索
 *       本 App 的落盘数据被 global-search-engine 的源表索引（跨源检索可命中该 App 的内容）
 *       真源：apps/memory/global-search-engine.js 源表里出现 appId: '<id>'
 *   · F3_notify        系统通知
 *       本 App 被 system-notifications 的落点映射表认领（通知可落到该 App 的角标/入口）
 *       真源：config/system-notifications.js 映射表里出现 '<id>'
 *   · F4_wechatLink    微信链路
 *       在微信会话的独立注入路径（chat-view.js 的 _injectApps 表）里注入生成侧约束 —— 该链路的生成不走主钩子
 *       真源：apps/wechat/chat-view.js 的 _injectApps 表里出现该 App 实例变量
 *   · F5_upstreamRead  上游读数
 *       消费 lonsha / world-axis 契约面的读数出口（投影 / 注入 / 世界钟 / 知识面 / 证据面等）
 *       真源：apps/<dir>/*.js 里 import 了 14 个上游契约面之一
 *   · F6_lifecycle     生命周期
 *       进 ST_PHONE_REBIND_APP_KEYS：换会话/换角色时被统一重绑（否则数据落旧会话）
 *       真源：index.js 的 ST_PHONE_REBIND_APP_KEYS 表里出现该 App 实例变量
 *
 * 【为什么 false 格不逐格写理由】
 *   「不适用」与「漏配」在界面上长得一样（都是 false），但只有后者是缺陷。
 *   逐格写 486 条理由必然退化成放行条（写一次就永久为真，不随磁盘漂移）。
 *   故口径取**收口式**：只有「六面全无」的 App 需要进 `NA` 台账写明理由，
 *   且该台账与磁盘**双向对账**（磁盘上该 App 真六面全无 ⇔ 台账里有它）。
 *   六面里命中至少一面的 App 无需理由 —— 它确实在被消费。
 *
 * 【边界（诚实记账）】
 *   口径是**文本形态**复算（不解析 AST、不追动态拼名）；`graph` 是唯一「id ≠ 目录」的 App
 *   （graph-app.js 落在 apps/memory/ 下，由 v255 dirMap 与 lazy 分支实证）。
 *   ★ **目录 ≠ App**：`apps/memory/` 一个目录承载两件 App（`memory-app.js` / `graph-app.js`）。六面复算
 *     一律按「**该 App 自有文件集**」取数（入口文件 + 同名前缀文件），不能按目录取：按目录取会让 graph 继承
 *     memory 的读数（本版首版即踩中：graph 被误报为命中注入 / 搜索 / 上游三面）。
 *   真宿主实机未验：本表证明的是「消费点在场」，不证明「真机上那处消费真跑对了」，归 R-O3。
 * ============================================================ */
'use strict';

/** 六条消费面的键（顺序即矩阵列序；判据按此表逐列复算）。 */
export const FACE_KEYS = Object.freeze(["F1_inject", "F2_search", "F3_notify", "F4_wechatLink", "F5_upstreamRead", "F6_lifecycle"]);

/** 每条面的元信息：中文名 / 该面是什么 / 真源在哪。 */
export const FACE_META = Object.freeze({
    F1_inject: Object.freeze({ label: "生成侧注入", what: "App 自己在 GENERATE_BEFORE_COMBINE_PROMPTS 主钩子上挂注入块（promptBlock / buildPromptDirective / buildInjectionPrompt）", source: "apps/<dir>/<x>-app.js 内出现 GENERATE_BEFORE_COMBINE_PROMPTS" }),
    F2_search: Object.freeze({ label: "全局搜索", what: "本 App 的落盘数据被 global-search-engine 的源表索引（跨源检索可命中该 App 的内容）", source: "apps/memory/global-search-engine.js 源表里出现 appId: '<id>'" }),
    F3_notify: Object.freeze({ label: "系统通知", what: "本 App 被 system-notifications 的落点映射表认领（通知可落到该 App 的角标/入口）", source: "config/system-notifications.js 映射表里出现 '<id>'" }),
    F4_wechatLink: Object.freeze({ label: "微信链路", what: "在微信会话的独立注入路径（chat-view.js 的 _injectApps 表）里注入生成侧约束 —— 该链路的生成不走主钩子", source: "apps/wechat/chat-view.js 的 _injectApps 表里出现该 App 实例变量" }),
    F5_upstreamRead: Object.freeze({ label: "上游读数", what: "消费 lonsha / world-axis 契约面的读数出口（投影 / 注入 / 世界钟 / 知识面 / 证据面等）", source: "apps/<dir>/*.js 里 import 了 14 个上游契约面之一" }),
    F6_lifecycle: Object.freeze({ label: "生命周期", what: "进 ST_PHONE_REBIND_APP_KEYS：换会话/换角色时被统一重绑（否则数据落旧会话）", source: "index.js 的 ST_PHONE_REBIND_APP_KEYS 表里出现该 App 实例变量" })
});

/** 「六面全无」台账：只有这些 App 需要理由，且与磁盘双向对账（见判据套件 B 组）。 */
export const NA = Object.freeze({
    mofo: "魔坊空壳占位（mofo-app.js 头注自述「空壳占位」）：只有模板导入导出与运行态迁移，无生成侧接入面；通知走 phoneShell.showNotification 即时提示、不经落点映射表。",
    games: "游戏厅：内建八款游戏各自的 AI 提示词构造器（getDefault*Prompt）只喂给本 App 自己的牌局生成，不属平台级注入面；战绩落盘是本会话私有库、不被全局搜索索引，也不进通知落点表。",
    settings: "设置 App：纯配置读写与界面装配，本身不产出可搜索内容、不产通知、不向生成侧注入约束（它是被其它 App 读取的设置真源）。",
    mood: "心境 App：源文件头注自述「只读聚合，不直接写引擎状态」——它读 drives/jiwen/记忆三处引擎读数做可视化，不落盘自有数据、因此无搜索/通知/注入/生命周期四面。"
    /* ★ [v3.58.0 · 计划 O4] 本版把 search 从这台账里**移出**：它原本是「六面全无」，
     *   本版给它接上了 F6_lifecycle（进 ST_PHONE_REBIND_APP_KEYS）——
     *   此前它不在表里（入口只在「点开搜索」时懒加载），换会话后 `_scanGen` 不推进、
     *   上一段会话那轮**还在跑**的全历史扫描仍算当前代际，跑完把旧会话的命中写进面板
     *   （不报错、只错结果）。它仍无其余五面，其中 F2 属**不适用**而非漏配
     *   （它是那一条消费面的宿主、把 28 个 App 的数据接成索引源，不是被索引方），
     *   该口径写在矩阵那一行的行内注释里 —— 本台账的准入条件是「六面全无」，
     *   收口式口径不许留放行条（留一条就会双向对账报红，这是判据在守它）。 */
});

/** 矩阵本体：每个 App 一行（faces 为磁盘真读数，由判据复算对账）。 */
export const MATRIX = Object.freeze([
    Object.freeze({ appId: "wechat", name: "微信", dir: "wechat", faces: Object.freeze({ F1_inject: true, F2_search: true, F3_notify: true, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: false }) }),
    Object.freeze({ appId: "weibo", name: "微博", dir: "weibo", faces: Object.freeze({ F1_inject: false, F2_search: true, F3_notify: true, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: false }) }),
    Object.freeze({ appId: "honey", name: "蜜语", dir: "honey", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: true, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: false }) }),
    Object.freeze({ appId: "mofo", name: "魔坊", dir: "mofo", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: false }) }),
    Object.freeze({ appId: "wangxiang", name: "万象", dir: "wangxiang", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "phone", name: "通话", dir: "phone", faces: Object.freeze({ F1_inject: false, F2_search: true, F3_notify: true, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: false }) }),
    Object.freeze({ appId: "diary", name: "日记", dir: "diary", faces: Object.freeze({ F1_inject: false, F2_search: true, F3_notify: true, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: false }) }),
    Object.freeze({ appId: "music", name: "音乐", dir: "music", faces: Object.freeze({ F1_inject: false, F2_search: true, F3_notify: true, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: false }) }),
    Object.freeze({ appId: "album", name: "相册", dir: "album", faces: Object.freeze({ F1_inject: false, F2_search: true, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: false }) }),
    Object.freeze({ appId: "calendar", name: "日历", dir: "calendar", faces: Object.freeze({ F1_inject: false, F2_search: true, F3_notify: true, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: false }) }),
    Object.freeze({ appId: "games", name: "游戏", dir: "games", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: false }) }),
    Object.freeze({ appId: "settings", name: "设置", dir: "settings", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: false }) }),
    Object.freeze({ appId: "playbook", name: "灵感工坊", dir: "playbook", faces: Object.freeze({ F1_inject: true, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "achievement", name: "成就簿", dir: "achievement", faces: Object.freeze({ F1_inject: false, F2_search: true, F3_notify: true, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "xhs", name: "小红书", dir: "xhs", faces: Object.freeze({ F1_inject: false, F2_search: true, F3_notify: true, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "tieba", name: "贴吧", dir: "tieba", faces: Object.freeze({ F1_inject: false, F2_search: true, F3_notify: true, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "health", name: "健康", dir: "health", faces: Object.freeze({ F1_inject: true, F2_search: true, F3_notify: true, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "memory", name: "记忆", dir: "memory", faces: Object.freeze({ F1_inject: true, F2_search: true, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: true, F6_lifecycle: true }) }),
    Object.freeze({ appId: "graph", name: "图谱", dir: "memory", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "peek", name: "查手机", dir: "peek", faces: Object.freeze({ F1_inject: true, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: false }) }),
    Object.freeze({ appId: "bilibili", name: "B站", dir: "bilibili", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "theater", name: "小剧场", dir: "theater", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "mood", name: "心境", dir: "mood", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: false }) }),
    Object.freeze({ appId: "tarot", name: "塔罗", dir: "tarot", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "reading", name: "阅读", dir: "reading", faces: Object.freeze({ F1_inject: false, F2_search: true, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "gacha", name: "幸运转盘", dir: "gacha", faces: Object.freeze({ F1_inject: false, F2_search: true, F3_notify: true, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "timeweaver", name: "织光机", dir: "timeweaver", faces: Object.freeze({ F1_inject: false, F2_search: true, F3_notify: true, F4_wechatLink: false, F5_upstreamRead: true, F6_lifecycle: true }) }),
    Object.freeze({ appId: "worldpulse", name: "世界脉搏", dir: "worldpulse", faces: Object.freeze({ F1_inject: false, F2_search: true, F3_notify: true, F4_wechatLink: false, F5_upstreamRead: true, F6_lifecycle: false }) }),
    Object.freeze({ appId: "place", name: "地点图景", dir: "place", faces: Object.freeze({ F1_inject: true, F2_search: true, F3_notify: false, F4_wechatLink: true, F5_upstreamRead: true, F6_lifecycle: true }) }),
    Object.freeze({ appId: "cheat", name: "金手指", dir: "cheat", faces: Object.freeze({ F1_inject: true, F2_search: true, F3_notify: false, F4_wechatLink: true, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "dirtytalk", name: "撩语", dir: "dirtytalk", faces: Object.freeze({ F1_inject: true, F2_search: true, F3_notify: false, F4_wechatLink: true, F5_upstreamRead: true, F6_lifecycle: true }) }),
    Object.freeze({ appId: "wallet", name: "钱袋", dir: "wallet", faces: Object.freeze({ F1_inject: true, F2_search: true, F3_notify: false, F4_wechatLink: true, F5_upstreamRead: true, F6_lifecycle: true }) }),
    Object.freeze({ appId: "profile", name: "档案", dir: "profile", faces: Object.freeze({ F1_inject: true, F2_search: true, F3_notify: false, F4_wechatLink: true, F5_upstreamRead: true, F6_lifecycle: true }) }),
    Object.freeze({ appId: "plotline", name: "剧情线", dir: "plotline", faces: Object.freeze({ F1_inject: true, F2_search: true, F3_notify: false, F4_wechatLink: true, F5_upstreamRead: true, F6_lifecycle: true }) }),
    Object.freeze({ appId: "chars", name: "群像", dir: "chars", faces: Object.freeze({ F1_inject: true, F2_search: true, F3_notify: false, F4_wechatLink: true, F5_upstreamRead: true, F6_lifecycle: true }) }),
    Object.freeze({ appId: "clock", name: "时计", dir: "clock", faces: Object.freeze({ F1_inject: true, F2_search: true, F3_notify: false, F4_wechatLink: true, F5_upstreamRead: true, F6_lifecycle: true }) }),
    Object.freeze({ appId: "ledger", name: "账本", dir: "ledger", faces: Object.freeze({ F1_inject: true, F2_search: true, F3_notify: false, F4_wechatLink: true, F5_upstreamRead: true, F6_lifecycle: true }) }),
    Object.freeze({ appId: "asset", name: "资产", dir: "asset", faces: Object.freeze({ F1_inject: true, F2_search: false, F3_notify: false, F4_wechatLink: true, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "search", name: "全局搜索", dir: "search", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "notifications", name: "通知中心", dir: "notifications", faces: Object.freeze({ F1_inject: false, F2_search: true, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: false }) }),
    Object.freeze({ appId: "usage", name: "洞察", dir: "usage", faces: Object.freeze({ F1_inject: true, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "diagnose", name: "诊断", dir: "diagnose", faces: Object.freeze({ F1_inject: false, F2_search: true, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: true, F6_lifecycle: true }) }),
    Object.freeze({ appId: "focus", name: "番茄钟", dir: "focus", faces: Object.freeze({ F1_inject: true, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "accounting", name: "记账", dir: "accounting", faces: Object.freeze({ F1_inject: true, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "piggy", name: "存钱罐", dir: "piggy", faces: Object.freeze({ F1_inject: true, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "regexfilter", name: "正则过滤", dir: "regexfilter", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "punchcard", name: "打卡", dir: "punchcard", faces: Object.freeze({ F1_inject: true, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "avatarframe", name: "头像框", dir: "avatarframe", faces: Object.freeze({ F1_inject: true, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "shop", name: "商城", dir: "shop", faces: Object.freeze({ F1_inject: true, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "block", name: "拉黑", dir: "block", faces: Object.freeze({ F1_inject: true, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "weather", name: "天气", dir: "weather", faces: Object.freeze({ F1_inject: true, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "taobao", name: "桃宝", dir: "taobao", faces: Object.freeze({ F1_inject: true, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "loverspace", name: "恋爱空间", dir: "loverspace", faces: Object.freeze({ F1_inject: true, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "date", name: "约会大作战", dir: "date", faces: Object.freeze({ F1_inject: true, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "lofter", name: "老福特", dir: "lofter", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "pixiv", name: "Pixiv", dir: "pixiv", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "magazine", name: "杂志", dir: "magazine", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "soundkit", name: "音效盒", dir: "soundkit", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "recall", name: "召回治理台", dir: "recall", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "sourcebook", name: "时光胶囊", dir: "sourcebook", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "widget", name: "自定义组件", dir: "widget", faces: Object.freeze({ F1_inject: true, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "kettle", name: "对话水壶", dir: "kettle", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "needsim", name: "需求沙盘", dir: "needsim", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "musicdesk", name: "曲库案头", dir: "musicdesk", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "pvdesk", name: "PV 案头", dir: "pvdesk", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "doujin", name: "同人商店", dir: "doujin", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "archive", name: "存档台", dir: "archive", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "cotdesk", name: "思维链案头", dir: "cotdesk", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "diagdesk", name: "诊断案头", dir: "diagdesk", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "uterus", name: "子宫画板", dir: "uterus", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "memtable", name: "结构化记忆案头", dir: "memtable", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "socialguard", name: "熟人可见性案头", dir: "socialguard", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "freehome", name: "自由桌面布局案头", dir: "freehome", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "stickerdesk", name: "表情包册案头", dir: "stickerdesk", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "lexiscore", name: "词法评分案头", dir: "lexiscore", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "periodmath", name: "周期数学案头", dir: "periodmath", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "annidate", name: "纪念日数学案头", dir: "annidate", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "cardtable", name: "牌桌案头", dir: "cardtable", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "summdesk", name: "总结案头", dir: "summdesk", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "sullydesk", name: "SullyOS 治理案头", dir: "sullydesk", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "traveldesk", name: "旅行记账案头", dir: "traveldesk", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
    Object.freeze({ appId: "taskentry", name: "任务入口", dir: "taskentry", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),
]);

/** 便捷取用口：逐面统计命中数（诊断面与判据共用；不自持第二份数据）。
 *  ★ 本模块**刻意不设**「按 appId 取一行」的出口：诊断面渲染的是**整表**，消费方没有
 *    任何一处需要单点查询；凭空留一个「将来可能有人用」的取用口，正是本仓第一道门
 *    （dead-export）点名的那类欠债。要单点判定就在消费方自己 find。 */
/** 便捷取用口：逐面统计命中数（诊断面与判据共用；不自持第二份数据）。 */
export function faceCounts(matrix) {
    const out = {};
    for (const k of FACE_KEYS) out[k] = 0;
    for (const r of (matrix || [])) {
        if (!r || !r.faces) continue;
        for (const k of FACE_KEYS) if (r.faces[k] === true) out[k] += 1;
    }
    return out;
}
