/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  作者 (Author): yuzuki
 * 
 * ⚠️ 版权声明 (Copyright Notice):
 * 1. 禁止商业化：本项目仅供交流学习，严禁任何形式的倒卖、盈利等商业行为。
 * 2. 禁止二改发布：严禁未经授权修改代码后作为独立项目二次发布或分发。
 * 3. 禁止抄袭：严禁盗用本项目的核心逻辑、UI设计与相关原代码。
 * 
 * Copyright (c) yuzuki. All rights reserved.
 * ======================================================== */
// APP配置文件
export const DEFAULT_APP_ICONS = Object.freeze({
    wechat: new URL('../phone/wechat.png', import.meta.url).href,
    weibo: new URL('../phone/weibo.png', import.meta.url).href,
    honey: new URL('../phone/honey.png', import.meta.url).href,
    mofo: new URL('../phone/mofo.png', import.meta.url).href,
    wangxiang: new URL('../phone/wanxiang.png', import.meta.url).href,
    phone: new URL('../phone/phone.png', import.meta.url).href,
    diary: new URL('../phone/diary.png', import.meta.url).href,
    music: new URL('../phone/music.png', import.meta.url).href,
    album: new URL('../phone/album.png', import.meta.url).href,
    calendar: new URL('../phone/calendar.png', import.meta.url).href,
    games: new URL('../phone/games.png', import.meta.url).href,
    settings: new URL('../phone/settings.png', import.meta.url).href,
    memory: new URL('../phone/memory.png', import.meta.url).href,
    graph: new URL('../phone/graph.png', import.meta.url).href,
    mood: new URL('../phone/mood.png', import.meta.url).href,
    tarot: new URL('../phone/tarot.png', import.meta.url).href
});

export const DEFAULT_PHONE_WALLPAPER = new URL('../phone/phone-background.jpg', import.meta.url).href;

export const APPS = [
    // 第一行
    {
        id: 'wechat',
        name: '微信',
        icon: '💬',
        defaultIcon: DEFAULT_APP_ICONS.wechat,
        color: '#07c160',
        badge: 0,
        data: {
            contacts: [],
            messages: [],
            moments: []
        }
    },
    {
        id: 'weibo',
        name: '微博',
        icon: '👁️‍🗨️',
        defaultIcon: DEFAULT_APP_ICONS.weibo,
        color: '#ff8200',
        badge: 0,
        data: {
            hotSearches: [],
            recommends: [],
            cacheTopic: null // 用于记录当前打开的热搜词
        }
    },
    {
        id: 'honey',
        name: '蜜语',
        icon: '💕',
        defaultIcon: DEFAULT_APP_ICONS.honey,
        color: '#ff6b9d',
        badge: 0,
        data: {
            messages: []
        }
    },
    {
        id: 'mofo',
        name: '魔坊',
        icon: '🪄',
        defaultIcon: DEFAULT_APP_ICONS.mofo,
        color: '#1677ff',
        data: {
            scenes: [],
            presets: []
        }
    },
    {
        id: 'wangxiang',
        name: '万象',
        icon: '🧿',
        defaultIcon: DEFAULT_APP_ICONS.wangxiang,
        color: '#315c50',
        data: {}
    },
    // 第二行
    {
        id: 'phone',
        name: '通话',
        icon: '📞',
        defaultIcon: DEFAULT_APP_ICONS.phone,
        color: '#52c41a',
        data: {
            contacts: [],
            callHistory: []
        }
    },
    {
        id: 'diary',
        name: '日记',
        icon: '📔',
        defaultIcon: DEFAULT_APP_ICONS.diary,
        color: '#faad14',
        data: {
            entries: []
        }
    },
    {
        id: 'music',
        name: '音乐',
        icon: '🎵',
        defaultIcon: DEFAULT_APP_ICONS.music,
        color: '#eb2f96',
        data: {
            playlists: [],
            nowPlaying: null
        }
    },
    {
        id: 'album',
        name: '相册',
        icon: '🖼️',
        defaultIcon: DEFAULT_APP_ICONS.album,
        color: '#4096ff',
        data: {
            images: []
        }
    },
    {
        id: 'calendar',
        name: '日历',
        icon: '📅',
        defaultIcon: DEFAULT_APP_ICONS.calendar,
        color: '#5d83a8',
        data: {
            memos: []
        }
    },
    {
        id: 'games',
        name: '游戏',
        icon: '🎮',
        defaultIcon: DEFAULT_APP_ICONS.games,
        color: '#722ed1',
        data: {
            installed: ['2048', '贪吃蛇', '俄罗斯方块']
        }
    },
    // 第三行
    {
        id: 'settings',
        name: '设置',
        icon: '⚙️',
        defaultIcon: DEFAULT_APP_ICONS.settings,
        color: '#8c8c8c',
        data: { }
    },
    // 第四行：新增整合扩展生态 (灵感工坊/成就簿/小红书/贴吧)
    {
        id: 'playbook',
        name: '灵感工坊',
        icon: '🔮',
        color: '#9333ea',
        badge: 0,
        data: {}
    },
    {
        id: 'achievement',
        name: '成就簿',
        icon: '🏆',
        color: '#f59e0b',
        badge: 0,
        data: {}
    },
    {
        id: 'xhs',
        name: '小红书',
        icon: '📕',
        color: '#ff2442',
        badge: 0,
        data: {}
    },
    {
        id: 'tieba',
        name: '贴吧',
        icon: '📌',
        color: '#2563eb',
        badge: 0,
        data: {}
    },
    {
        id: 'health',
        name: '健康',
        icon: '💗',
        color: '#f43f5e',
        badge: 0,
        data: {}
    },
    {
        id: 'memory',
        name: '记忆',
        icon: '🧠',
        color: '#6366f1',
        badge: 0,
        data: {}
    },
    {
        id: 'graph',
        name: '图谱',
        icon: '🕸️',
        color: '#8b5cf6',
        badge: 0,
        data: {}
    },
    {
        id: 'peek',
        name: '查手机',
        icon: '🔍',
        color: '#8b6914',
        badge: 0,
        data: {}
    },
    {
        id: 'bilibili',
        name: 'B站',
        icon: '📺',
        color: '#00aeec',
        badge: 0,
        data: {}
    },
    {
        id: 'theater',
        name: '小剧场',
        icon: '🎭',
        color: '#7c3aed',
        badge: 0,
        data: {}
    },
    {
        id: 'mood',
        name: '心境',
        icon: '🌈',
        color: '#6366f1',
        badge: 0,
        data: {}
    },
    {
        id: 'tarot',
        name: '塔罗',
        icon: '🃏',
        color: '#8b5cf6',
        badge: 0,
        data: {}
    },
    {
        id: 'reading',
        name: '阅读',
        icon: '📖',
        color: '#b08968',
        badge: 0,
        data: {}
    },
    {
        id: 'gacha',
        name: '幸运转盘',
        icon: '🎰',
        color: '#f59e0b',
        badge: 0,
        data: {}
    },
    {
        id: 'timeweaver',
        name: '织光机',
        icon: '🕰️',
        color: '#e8a33d',
        badge: 0,
        data: {}
    },
    {
        id: 'worldpulse',
        name: '世界脉搏',
        icon: '🌍',
        color: '#1f6feb',
        badge: 0,
        data: {}
    },
    // [v2.46.0] 地点图景：消费记忆插件的场所面（人在哪儿/谁在这个地方/到访与覆盖）
    {
        id: 'place',
        name: '地点图景',
        icon: '🗺️',
        color: '#14b8a6',
        badge: 0,
        data: {}
    },
    // [v2.47.0] 金手指：万界武库外挂库（抽出即入包，装配即生效）
    {
        id: 'cheat',
        name: '金手指',
        icon: '⚡',
        color: '#d4af37',
        badge: 0,
        data: {}
    },
    // [v2.48.0] 撩语：聊骚语料词库（抽出即入包，装配即生效）
    {
        id: 'dirtytalk',
        name: '撩语',
        icon: '💋',
        color: '#e879f9',
        badge: 0,
        data: {}
    },
    {
        id: 'wallet',
        name: '钱袋',
        icon: '💰',
        color: '#eab308',
        badge: 0,
        data: {}
    },
    {
        id: 'profile',
        name: '档案',
        icon: '🪪',
        color: '#818cf8',
        badge: 0,
        data: {}
    },
    {
        id: 'plotline',
        name: '剧情线',
        icon: '📜',
        color: '#b08d57',
        badge: 0,
        data: {}
    },
    {
        id: 'chars',
        name: '群像',
        icon: '👥',
        color: '#38bdf8',
        badge: 0,
        data: {}
    },
    {
        id: 'clock',
        name: '时计',
        icon: '🕓️',
        color: '#60a5fa',
        badge: 0,
        data: {}
    },
    {
        id: 'ledger',
        name: '账本',
        icon: '🧾',
        color: '#c084fc',
        badge: 0,
        data: {}
    },
    {
        id: 'asset',
        name: '资产',
        icon: '🏦',
        color: '#34d399',
        badge: 0,
        data: {}
    },
    {
        id: 'search',
        name: '全局搜索',
        icon: '🔎',
        color: '#4c8bf5',
        badge: 0,
        data: {}
    },
    {
        id: 'notifications',
        name: '通知中心',
        icon: '🔔',
        color: '#6c5ce7',
        badge: 0,
        data: {}
    },
    {
        // [v3.15.0 · 计划 #52 + #53] 洞察：使用统计（次数/时长/时段）+ 联系人互动分析。
        //   两件事合成一个 App（一次注册接线，两分页）—— 它们共用「读本机已有痕迹」这一形态，
        //   拆成两个 App 会多一整套注册点（桌面条目 / 懒加载分支 / 键前缀 / 样式投递）。
        //   ★ 采集点在 `phone:openApp` 咽喉点（index.js），不在本 App 内：
        //     统计必须在用户**不开洞察页**的时候也照记，否则「用了什么」的样本自带选择偏差。
        id: 'usage',
        name: '洞察',
        icon: '📊',
        color: '#f472b6',
        badge: 0,
        data: {}
    },
    {
        // [v2.99.0] 诊断中心：上游桥归因 / 字段三态 / 返回栈 / 源键规则，
        //   全部现取，不持久化任何状态（故无 storage 键、无需会话隔离登记）。
        id: 'diagnose',
        name: '诊断',
        icon: '🩺',
        color: '#0ea5a4',
        badge: 0,
        data: {}
    },
    {
        // [v3.21.0] 番茄钟：专注计时 + 时长统计 + 事实注入（缝合自 EPhone·xINOVO pomodoro）。
        //   只记时长，不替用户发消息；会话键走 ^focus_ 前缀，随会话隔离。
        id: 'focus',
        name: '番茄钟',
        icon: '⏱️',
        color: '#3b82f6',
        badge: 0,
        data: {}
    },
    {
        // [v3.22.0] 记账：账户树 + 余额 + 收支流水 + 月度投影（缝合自 EPhone·xintuk tukey-accounting）。
        //   只缝本地账本那一半；源里那个「AI 群聊记账」本仓无对应结构。会话键走 ^accounting_ 前缀。
        id: 'accounting',
        name: '记账',
        icon: '📒',
        color: '#10b981',
        badge: 0,
        data: {}
    },
    {
        // [v3.25.0] 存钱罐：余额 / 收支流水 / 亲属卡额度周期（缝合自 EPhone·xINOVO piggy_bank）。
        //   只缝本地储值那一半；源里那套商品下单结算与角色家人卡事件流不缝
        //   （消息归微信/日记/剧场，用户钱包的仲裁源是微信零钱）。会话键走 ^piggy_ 前缀。
        id: 'piggy',
        name: '存钱罐',
        icon: '🐷',
        color: '#ea580c',
        badge: 0,
        data: {}
    },
    {
        // [v3.26.0] 正则过滤器：自定规则 → 预览改写结果 / 导出为 ST 正则脚本（缝合自 EPhone·xINOVO regex_filter）。
        //   只缝「规则引擎 + 外壳保护 + 导出语义」；本 App 不改写任何消息正文
        //   （正文改写的仲裁者是 config/tag-filter.js，同一块文本放两个改写者＝本仓最贵的形态）。
        //   会话键走 ^regexfilter_ 前缀，随会话隔离。
        id: 'regexfilter',
        name: '正则过滤',
        icon: '🪄',
        color: '#6366f1',
        badge: 0,
        data: {}
    },
    {
        // [v3.26.0] 打卡：作息清单 → 勾选 / 逐项备注 / 连续天数（缝合自 MyPhone punchcard）。
        //   只缝「主叫侧的账」；源自建 IndexedDB 与「调模型生成角色作息表」两块不缝
        //   （前者违零数据库铁律，后者是生成侧的活——本 App 只把聚合事实交给生成侧）。
        //   会话键走 ^punchcard_ 前缀，随会话隔离。
        id: 'punchcard',
        name: '打卡',
        icon: '🗓️',
        color: '#0891b2',
        badge: 0,
        data: {}
    },
    {
        // [v3.27.0] 头像框：框清单 → 两个挂载点（我 / 本会话角色）挂什么（缝合自 EPhone·xintuk）。
        //   源那 364 条框全是 postimg 外链、自定义框进 Dexie、六个挂载点一锅端 —— 三块都不缝
        //   （外链违零外部请求审计，Dexie 违零数据库铁律，六挂载点在本仓没有对应对象）。
        //   挂载点走**草稿 + 显式保存**，把源「角色设置暂存、主屏/微博即时写」的两套语义收成一套。
        //   会话键走 ^avatarframe_ 前缀，随会话隔离。
        id: 'avatarframe',
        name: '头像框',
        icon: '🖼️',
        color: '#0ea5e9',
        badge: 0,
        data: {}
    },
    {
        // [v3.27.0] 商城：商品目录 → 购物车 → 下单签发口令 → 自提核销（缝合自 EPhone·xINOVO shop）。
        //   源「商品靠模型现生成、口令从聊天正文正则抓、设置直写 Dexie」三块都不缝
        //   （前者是生成侧的活，后者正文归属在聊天层，Dexie 违零数据库铁律）。
        //   金额一律**整数分**：源用浮点算总价，0.1+0.2 会让车与订单差一分。
        //   会话键走 ^shop_ 前缀，随会话隔离。
        id: 'shop',
        name: '商城',
        icon: '🛒',
        color: '#f97316',
        badge: 0,
        data: {}
    },
    {
        // [v3.27.0] 拉黑：双向两本账（你拉黑它 / 它拉黑你）+ 各自的申请流（缝合自 EPhone·xINOVO block_system）。
        //   源「拉黑标记写在宿主角色对象上、自己拼 prompt 调模型、60 秒轮询」三块都不缝
        //   （角色对象归宿主，模型调用归生成侧，本仓不转常驻定时器 —— 冷却改走**读数**）。
        //   会话键走 ^block_ 前缀，随会话隔离。
        id: 'block',
        name: '拉黑',
        icon: '🚫',
        color: '#e11d48',
        badge: 0,
        data: {}
    },
    {
        // [v3.27.0] 天气：两份观测（角色所在地 / 你所在地）→ 码翻人话 → 带时效注入
        //   （缝合自 EPhone·xINOVO WeatherService 的结构 + MyPhone 的 WMO 码表）。
        //   源两路都自己发 fetch、自己拿定位、还读别的 App 的 indexedDB —— 三块都不缝
        //   （新增模块零外部请求审计，定位归权限面，一个 App 不读另一个 App 的表）。
        //   本件不请求天气：事实由用户（或宿主读到之后）填进来，只负责翻译与时效读数。
        //   会话键走 ^weather_ 前缀，随会话隔离。
        id: 'weather',
        name: '天气',
        icon: '🌤️',
        color: '#0d9488',
        badge: 0,
        data: {}
    },
    {
        // [v3.28.0] 自定义组件：登记 / 对账 / 产描述 / 导出设计稿（缝合自 EPhone·xINOVO custom-widgets + uwu widget_market）。
        //   源四块都不缝：① 源把用户写的 js 用 new Function 直接跑 —— 本件一行用户代码都不执行，
        //   宿主想渲染就取 toHostPayload；② 源自建 iframe + postMessage 桥（整块不搬）；
        //   ③ 源用 sessionStorage 存编辑草稿 —— 本仓走 PhoneStorage 的 widget_draft 键；
        //   ④ 源导出走 Blob 下载 —— 本仓收敛成纯字符串 toExportText / fromImportText。
        //   源 js 段在本件改名 notes：避免造成「写进去就会跑」的误解。
        //   会话键走 ^widget_ 前缀，随会话隔离。
        id: 'widget',
        name: '自定义组件',
        icon: '🧱',
        color: '#8b5cf6',
        badge: 0,
        data: {}
    },
];
// 手机配置
export const PHONE_CONFIG = {
    brand: 'iPhone',
    model: 'iPhone 14 Pro',
    theme: 'light',
    wallpaper: DEFAULT_PHONE_WALLPAPER,
    defaultWallpaper: DEFAULT_PHONE_WALLPAPER,
    position: 'right',
    size: 'medium'
};
