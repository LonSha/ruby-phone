/* ============================================================
 * config/app-lazy-routes.js — [v3.61.0 · 计划 O6] App 懒加载路由表（单源）
 * ------------------------------------------------------------
 * 为什么存在：index.js 的 phone:openApp 处理器此前对**每个 App** 手写一段
 *   「import → 单例 new → render → catch」五件套（67 段几乎逐字重复，
 *   合计约 48KB）。每新增一个 App 都要复制粘贴一段，漏改 catch 文案、
 *   重复通知（v3.61.0 在 lexiscore 分支抓到 catch 里 showNotification
 *   重复两次的真缺陷——复制粘贴的直接产物）就是这种形态的必然结果。
 * 本表把五件套收敛成数据行；index.js 只留一个通用装配器。
 *   结构相同、文案不同 ⇒ 文案进表字段（errTitle），不进代码分支。
 *
 * 不进表的 14 个分支（见 index.js 内联保留）：settings / wechat / diary /
 *   phone / music / weibo / honey / mofo / wangxiang / games / album /
 *   calendar / lexiscore / graph —— 它们在五件套之外还有**真实差异逻辑**
 *   （构造参数不同、缓存同步、通话界面避让、双 import 兜底、按会话
 *   状态分流等），表驱动会把差异抹掉（把差异代码写进表反而是倒退）。
 *
 * 字段：
 *   id      — APPS 里的 appId（路由键）
 *   module  — 动态 import 说明符（与原五件套逐字一致，含缓存串）
 *   key     — window.VirtualPhone 上的单例键名
 *   cls     — 模块导出的类名
 *   errTitle— 加载失败通知的标题（原 catch 文案逐字保留）
 * 刻意不做的事：不在表里放构造参数、渲染钩子或状态同步 —— 需要那些的
 *   App 留在内联分支（见上）。表只描述「结构上完全同构」的那一族。
 * ============================================================ */

/** @type {ReadonlyArray<{id:string,module:string,key:string,cls:string,errTitle:string}>} */
export const APP_LAZY_ROUTES = [
    { id: "notifications", module: "./apps/notifications/notifications-app.js", key: "notificationsApp", cls: "NotificationCenterApp", errTitle: "通知中心" },
    { id: "search", module: "./apps/search/search-app.js", key: "searchApp", cls: "SearchApp", errTitle: "全局搜索" },
    { id: "playbook", module: "./apps/playbook/playbook-app.js", key: "playbookApp", cls: "PlaybookApp", errTitle: "灵感工坊" },
    { id: "achievement", module: "./apps/achievement/achievement-app.js", key: "achievementApp", cls: "AchievementApp", errTitle: "成就簿" },
    { id: "xhs", module: "./apps/xhs/xhs-app.js", key: "xhsApp", cls: "XhsApp", errTitle: "小红书" },
    { id: "tieba", module: "./apps/tieba/tieba-app.js", key: "tiebaApp", cls: "TiebaApp", errTitle: "贴吧" },
    { id: "health", module: "./apps/health/health-app.js", key: "healthApp", cls: "HealthApp", errTitle: "健康App" },
    { id: "memory", module: "./apps/memory/memory-app.js", key: "memoryApp", cls: "MemoryApp", errTitle: "记忆App" },
    { id: "mood", module: "./apps/mood/mood-app.js", key: "moodApp", cls: "MoodApp", errTitle: "心境App" },
    { id: "tarot", module: "./apps/tarot/tarot-app.js", key: "tarotApp", cls: "TarotApp", errTitle: "塔罗App" },
    { id: "reading", module: "./apps/reading/reading-app.js", key: "readingApp", cls: "ReadingApp", errTitle: "阅读App" },
    { id: "gacha", module: "./apps/gacha/gacha-app.js", key: "gachaApp", cls: "GachaApp", errTitle: "幸运转盘App" },
    { id: "timeweaver", module: "./apps/timeweaver/timeweaver-app.js", key: "timeweaverApp", cls: "TimeweaverApp", errTitle: "织光机App" },
    { id: "worldpulse", module: "./apps/worldpulse/worldpulse-app.js", key: "worldpulseApp", cls: "WorldpulseApp", errTitle: "世界脉搏App" },
    { id: "place", module: "./apps/place/place-app.js", key: "placeApp", cls: "PlaceApp", errTitle: "地点图景App" },
    { id: "diagnose", module: "./apps/diagnose/diagnose-app.js", key: "diagnoseApp", cls: "DiagnoseApp", errTitle: "诊断中心App" },
    { id: "focus", module: "./apps/focus/focus-app.js", key: "focusApp", cls: "FocusApp", errTitle: "番茄钟App" },
    { id: "accounting", module: "./apps/accounting/accounting-app.js", key: "accountingApp", cls: "AccountingApp", errTitle: "记账App" },
    { id: "piggy", module: "./apps/piggy/piggy-app.js", key: "piggyApp", cls: "PiggyApp", errTitle: "存钱罐App" },
    { id: "regexfilter", module: "./apps/regexfilter/regexfilter-app.js", key: "regexFilterApp", cls: "RegexFilterApp", errTitle: "正则过滤器App" },
    { id: "punchcard", module: "./apps/punchcard/punchcard-app.js", key: "punchcardApp", cls: "PunchcardApp", errTitle: "打卡App" },
    { id: "avatarframe", module: "./apps/avatarframe/avatarframe-app.js", key: "avatarFrameApp", cls: "AvatarFrameApp", errTitle: "头像框App" },
    { id: "shop", module: "./apps/shop/shop-app.js", key: "shopApp", cls: "ShopApp", errTitle: "商城App" },
    { id: "block", module: "./apps/block/block-app.js", key: "blockApp", cls: "BlockApp", errTitle: "拉黑App" },
    { id: "weather", module: "./apps/weather/weather-app.js", key: "weatherApp", cls: "WeatherApp", errTitle: "天气App" },
    { id: "taobao", module: "./apps/taobao/taobao-app.js", key: "taobaoApp", cls: "TaobaoApp", errTitle: "桃宝App" },
    { id: "loverspace", module: "./apps/loverspace/loverspace-app.js", key: "loverApp", cls: "LoverSpaceApp", errTitle: "恋爱空间App" },
    { id: "date", module: "./apps/date/date-app.js", key: "dateApp", cls: "DateApp", errTitle: "约会大作战App" },
    { id: "lofter", module: "./apps/lofter/lofter-app.js", key: "lofterApp", cls: "LofterApp", errTitle: "老福特App" },
    { id: "pixiv", module: "./apps/pixiv/pixiv-app.js", key: "pixivApp", cls: "PixivApp", errTitle: "PixivApp" },
    { id: "magazine", module: "./apps/magazine/magazine-app.js", key: "magazineApp", cls: "MagazineApp", errTitle: "MagazineApp" },
    { id: "soundkit", module: "./apps/soundkit/soundkit-app.js", key: "soundkitApp", cls: "SoundkitApp", errTitle: "音效盒App" },
    { id: "recall", module: "./apps/recall/recall-app.js", key: "recallApp", cls: "RecallApp", errTitle: "召回治理台App" },
    { id: "sourcebook", module: "./apps/sourcebook/sourcebook-app.js", key: "sourcebookApp", cls: "SourcebookApp", errTitle: "时光胶囊App" },
    { id: "pvdesk", module: "./apps/pvdesk/pvdesk-app.js", key: "pvdeskApp", cls: "PvdeskApp", errTitle: "PV案头App" },
    { id: "doujin", module: "./apps/doujin/doujin-app.js", key: "doujinApp", cls: "DoujinApp", errTitle: "同人商店App" },
    { id: "archive", module: "./apps/archive/archive-app.js", key: "archiveApp", cls: "ArchiveApp", errTitle: "存档台App" },
    { id: "cotdesk", module: "./apps/cotdesk/cotdesk-app.js", key: "cotdeskApp", cls: "CotdeskApp", errTitle: "思维链案头App" },
    { id: "diagdesk", module: "./apps/diagdesk/diagdesk-app.js", key: "diagdeskApp", cls: "DiagdeskApp", errTitle: "诊断案头App" },
    { id: "uterus", module: "./apps/uterus/uterus-app.js", key: "uterusApp", cls: "UterusApp", errTitle: "子宫画板App" },
    { id: "musicdesk", module: "./apps/musicdesk/musicdesk-app.js", key: "musicdeskApp", cls: "MusicdeskApp", errTitle: "曲库案头App" },
    { id: "memtable", module: "./apps/memtable/memtable-app.js", key: "memtableApp", cls: "MemtableApp", errTitle: "结构化记忆案头App" },
    { id: "socialguard", module: "./apps/socialguard/socialguard-app.js", key: "socialguardApp", cls: "SocialguardApp", errTitle: "熟人可见性案头App" },
    { id: "freehome", module: "./apps/freehome/freehome-app.js", key: "freehomeApp", cls: "FreehomeApp", errTitle: "自由桌面布局案头App" },
    { id: "stickerdesk", module: "./apps/stickerdesk/stickerdesk-app.js", key: "stickerdeskApp", cls: "StickerdeskApp", errTitle: "表情包册案头App" },
    { id: "periodmath", module: "./apps/periodmath/periodmath-app.js", key: "periodmathApp", cls: "PeriodmathApp", errTitle: "周期数学案头App" },
    { id: "annidate", module: "./apps/annidate/annidate-app.js", key: "annidateApp", cls: "AnnidateApp", errTitle: "纪念日数学案头App" },
    { id: "cardtable", module: "./apps/cardtable/cardtable-app.js", key: "cardtableApp", cls: "CardtableApp", errTitle: "牌桌案头App" },
    { id: "summdesk", module: "./apps/summdesk/summdesk-app.js", key: "summdeskApp", cls: "SummdeskApp", errTitle: "总结案头App" },
    { id: "sullydesk", module: "./apps/sullydesk/sullydesk-app.js", key: "sullydeskApp", cls: "SullydeskApp", errTitle: "SullyOS治理案头App" },
    { id: "traveldesk", module: "./apps/traveldesk/traveldesk-app.js", key: "traveldeskApp", cls: "TraveldeskApp", errTitle: "旅行记账案头App" },
    { id: "taskentry", module: "./apps/taskentry/taskentry-app.js", key: "taskentryApp", cls: "TaskentryApp", errTitle: "任务入口App" },
    { id: "workflow", module: "./apps/workflow/workflow-app.js", key: "workflowApp", cls: "WorkflowApp", errTitle: "工作流App" },
    { id: "creationdesk", module: "./apps/creationdesk/creation-workbench-app.js", key: "creationWorkbenchApp", cls: "CreationWorkbenchApp", errTitle: "创作台App" },
    { id: "needsim", module: "./apps/needsim/needsim-app.js", key: "needsimApp", cls: "NeedsimApp", errTitle: "需求沙盘App" },
    { id: "kettle", module: "./apps/kettle/kettle-app.js", key: "kettleApp", cls: "KettleApp", errTitle: "对话水壶App" },
    { id: "widget", module: "./apps/widget/widget-app.js", key: "widgetApp", cls: "WidgetApp", errTitle: "自定义组件App" },
    { id: "cheat", module: "./apps/cheat/cheat-app.js", key: "cheatApp", cls: "CheatApp", errTitle: "金手指App" },
    { id: "dirtytalk", module: "./apps/dirtytalk/dirtytalk-app.js", key: "dtApp", cls: "DtApp", errTitle: "撩语App" },
    { id: "wallet", module: "./apps/wallet/wallet-app.js", key: "walletApp", cls: "WalletApp", errTitle: "钱袋App" },
    { id: "profile", module: "./apps/profile/profile-app.js", key: "profileApp", cls: "ProfileApp", errTitle: "档案App" },
    { id: "plotline", module: "./apps/plotline/plotline-app.js", key: "plotlineApp", cls: "PlotlineApp", errTitle: "剧情线App" },
    { id: "chars", module: "./apps/chars/chars-app.js", key: "charsApp", cls: "CharsApp", errTitle: "群像App" },
    { id: "usage", module: "./apps/usage/usage-app.js", key: "usageApp", cls: "UsageApp", errTitle: "洞察App" },
    { id: "clock", module: "./apps/clock/clock-app.js", key: "clockApp", cls: "ClockApp", errTitle: "时计App" },
    { id: "ledger", module: "./apps/ledger/ledger-app.js", key: "ledgerApp", cls: "LedgerApp", errTitle: "世界账本App" },
    { id: "asset", module: "./apps/asset/asset-app.js", key: "assetApp", cls: "AssetApp", errTitle: "资产App" },
    { id: "peek", module: "./apps/peek/peek-app.js", key: "peekApp", cls: "PeekApp", errTitle: "查手机App" },
    { id: "bilibili", module: "./apps/bilibili/bili-app.js", key: "bilibiliApp", cls: "BiliApp", errTitle: "B站App" },
    { id: "theater", module: "./apps/theater/theater-app.js", key: "theaterApp", cls: "TheaterApp", errTitle: "小剧场App" },

];

/* 索引（appId → 行）：装配器查表用，一次建好避免每次 openApp 线性扫。 */
export const APP_LAZY_ROUTE_INDEX = new Map(APP_LAZY_ROUTES.map((r) => [r.id, r]));
