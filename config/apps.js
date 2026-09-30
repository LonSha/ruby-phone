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
