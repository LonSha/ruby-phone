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
        // [v3.29.0] 桃宝：商品目录 → 购物车 → 下单 → **物流时间线推演**（缝合自 EPhone·xintuk taobao 四片）。
        //   源是四合一超级模块（抓娃娃机 + 购物 + 外卖 + 物流），本件取三块。五处不缝：
        //   商品与评价靠模型生成 / 实时物流定时器 / Dexie / 直改用户钱包与角色银行卡 / 外链素材。
        //   物流改**惰性补推**：状态由时间推演决定（源挂 setTimeout 且要回查页面是否 active）。
        //   娃娃机战利品只登记面值不入账（本仓用户钱包的仲裁源是微信零钱）。
        //   会话键走 ^taobao_ 前缀，随会话隔离。
        id: 'taobao',
        name: '桃宝',
        icon: '🛍️',
        color: '#f97316',
        badge: 0,
        data: {}
    },
    {
        // [v3.30.0] 恋爱空间：天数 / 今日足迹 / 心情日记 + 心情罐子 / 情书 / 提问与回答 五块
        //   （缝合自 EPhone·xintuk lovers-space 四片，174001 字节 / 77 函数）。
        //   四处不缝：① 说说·相册·照片·分享 —— 让位本仓 apps/weibo/（同一件事两个权威）；
        //   ② 番茄钟 + 白噪音 —— 让位本仓 apps/focus/，且一个模块里两处计时器是本仓忌的形态；
        //   ③ 直连模型的 fetch（源 handleGenerateDailyActivity 自己拼 systemPrompt 发请求）——
        //     本仓模型调用走宿主生成侧；④ Dexie / db.chats / chat.history 写入
        //     （源把整份 chat 落库、还往 history 塞 isHidden 系统消息驱动模型）——
        //     零数据库铁律，且 App 不替宿主写楼层。另加：12 条外链素材一条不收。
        //   四条偏离：不做实时定时器（源每分钟 setInterval 重画 / 改惰性显形）；
        //   时间一律本地时区（源用 UTC 日期串，东八区凌晨会算到昨天）；足迹封顶 24 条并如实计数；
        //   心情日记空串归一成「没记」（「没记」不等于「记了空」）。
        //   会话键走 ^lover_ 前缀，随会话隔离。
        id: 'loverspace',
        name: '恋爱空间',
        icon: '💞',
        color: '#ec4899',
        badge: 0,
        data: {}
    },
    {
        // [v3.31.0] 约会大作战：场景册 / 出资四路 / 计划到收场 / 结算卡 / 欠账台账 五块
        //   （缝合自 EPhone·xintuk date 三片，120530 字节 / 3195 行 / 51 个函数）。
        //   两块不取：① 立绘库（源靠 x/y/size 滑块把图叠在背景上 —— 那是一套完整的编辑器，
        //   与「约会」不是一件事，本仓也没有立绘权威）；② BGM 面板（源读 window.state.musicState.playlist，
        //   那是「一起听」的曲库 —— 本仓有第二个权威；音量写 projectStorage 是全局键，会跨会话串味）。
        //   四处不缝：① **不碰钱包**（源四处 updateUserBalanceAndLogTransaction /
        //   updateCharacterPhoneBankBalance 直改用户余额与角色银行卡；本仓用户钱包的仲裁源是
        //   **微信零钱**）—— 本件只算「谁出多少」与「够不够」，出账入账交给那个权威；
        //   ② **不直连模型**（源三处自己拼 systemPrompt 直发，连 Gemini 分支都自己走）—— 走宿主生成侧；
        //   ③ **不写 Dexie、不碰 db.chats / chat.history**（源整份 chat 落库、往 history 塞 isHidden
        //   系统消息驱动模型、结束时塞 pat_message）—— 零数据库铁律 + 不替宿主写楼层；
        //   ④ **一张图都不存、一条外链都不收**（源把生图 URL 含 data: 写进场景与立绘、背景靠外链）——
        //   只登记宿主给的路径与用户自填提示词。
        //   四条偏离：金额一律**整数金币**且 `我出的 + Ta 出的 === 花费` 是不变量（源用 cost / 2 浮点
        //   算 AA、toFixed(2) 显示、四路各写一份扣款）；不做实时定时器与逐句动画（源 4 处 setTimeout）；
        //   历史只留最近 40 场并如实计数（源无上界增长）；「没走到结束」不许当成一场完整的约会
        //   （源只在 isDateOver && completion >= 100 时结算，否则状态静静挂内存里、重开全丢）。
        //   会话键走 ^date_ 前缀，随会话隔离。
        id: 'date',
        name: '约会大作战',
        icon: '💖',
        color: '#f43f5e',
        badge: 0,
        data: {}
    },
    {
        // [v3.34.0] 老福特：中文同人圈创作平台（缝合自 Perigee js/lofter.js，4445 行 / 267370 字节）。
        //   源是一个挂在全局 AppState.data.lofterData 上、**共用微博粉丝池与 CP 设定**的仿真。
        //   取五块：① 短文批量 ② 长篇合集（含前文滑窗）③ 评论楼中楼 ④ 关注 / 订阅 / 我的四格
        //   ⑤ 阅读面（首页 / 分月 / tag / 搜索）。设置面取「文风库」这一块机制（11 款内置 + 自建）。
        //   四处不缝：① **不直连模型**（源自己读 apiOverride.apiKey、自己拼 systemPrompt、自己发
        //   POST）—— 生成走两条合法通道：视图摆出可复制的要求文本，用户从对话框拿回结果贴回来；
        //   ② **不落 Dexie、不碰 db.chats / chat.history**（源整块 lofterData 经 Utils.saveData 回写、
        //   把卡片往 history 里 push）；③ **不共用别的 App 的池**（源要 weiboData.fanFriends 与 CP
        //   设定）—— 本件自带原创作者池，零跨 App 读；④ **一张图都不存、一条外链都不收**（源存生图
        //   URL 与外链封面）—— 只登记「有没有图 / 几张」。
        //   三条偏离：统计数收成唯一实现 deriveStats(heat, cold)（源三处各掷一次随机、序关系不保证），
        //   本件同一 (heat, cold) 必得同一读数且「心 >= 收藏 >= 评论」恒成立；前文滑窗提成纯函数
        //   prevChapterContext（最近 5 章全文、更早给摘要）；评论树深度有上限且上溯带访问集防自指
        //   （源 _topAncestorId 无保护，数据自指时无限上溯）。写盘三条键走 ^lofter_ 前缀随会话隔离。
        id: 'lofter',
        name: '老福特',
        icon: '🖋',
        color: '#38bdf8',
        badge: 0,
        data: {}
    },
    {
        // [v3.35.0] Pixiv：日文同人平台（缝合自 Perigee js/pixiv-illust.js 1411 行 +
        //   js/pixiv-novel.js 3888 行 + js/pixiv-comments.js 563 行，共 5862 行 / 324763 字节）。
        //   源是一个挂在全局 AppState.data.pixivData 上（65 处命中）、以 Utils.saveData 整块回写
        //   （38 处命中）的仿真：插画生成 / 小说连载 / 文风库 / 评论楼中楼四块齐备，
        //   且**自带三条生图链路 + 两条正文链路**（NovelAI / OpenAI 兼容 / OpenRouter；
        //   19 处网络调用）、插画 Blob 落 IndexedDB（IllustGallery）、还要 twitterData.fanFriends
        //   当作者池、要 broadcast.plotProgress 当题材源、要 forumData.threads 当分享出口。
        //   取五块：① 作品面（列表 / 分月 / tag / 本地检索）② 阅读器（目录 + 逐章点赞 + 正文渲染）
        //   ③ 续章滑窗（最近 5 章全文、更早给梗概）④ 评论楼中楼 ⑤ 我的四格 + 插画登记面。
        //   设置面取「文风库 + 语言模式（日文正文 / 中文折叠译文）」。
        //   四块不缝：① **不直连任何模型**（源自己读 imageApiConfig.provider 决定走哪条链路）——
        //   本件一个网络调用都没有：生成走两条合法通道，视图摆出可复制的要求文本、结果由用户贴回来；
        //   ② **不落 IndexedDB、不碰宿主对象**（源把插画 Blob 落 IllustGallery、把卡片往宿主消息数组
        //   push）—— 本件零数据库、零宿主写入；③ **不共用别的 App 的池**（源要推特粉丝池 / 广播题材
        //   源 / 论坛分享出口）—— 本件自带 9 位原创写手，零跨 App 读；④ **一张图都不存、一条外链
        //   都不收**（源存生图 URL 与外链封面、把 Blob 转 base64 data URL 塞帖）—— 插画面是
        //   **登记面**，只存「提示词 / 尺寸 / 张数 / 收藏 / 谁画的」，没有任何地址字段，视图不渲染 img。
        //   三条偏离：① 心数模型收成唯一确定性实现 deriveHeatBase / deriveChapterHearts
        //   （源 _rollHeatBase 掷随机、_rollChapterHearts 再乘一次随机，同一作品每次读数不同且
        //   缓存与逐章永久不一致）—— 本件同一 (fc, cold) 必得同一读数、hearts 恒等于逐章最高；
        //   ② 评论树深度有显式上限、上溯带访问集（源 _topAncestorId 只靠 guard < 50 步数上限，
        //   数据自指时停但**不报告**）—— 本件把 truncated / orphans 分开报；
        //   ③ 译文折叠块走**白名单**不走转义器耦合（源 _sanitizeDetailsBlock 靠 [^&] 匹配，
        //   自己注释里写明「勿收编 Utils.escapeHtml」）—— 本件扫字符流逐标签判白名单。
        //   写盘三条键走 ^pixiv_ 前缀随会话隔离。
        id: 'pixiv',
        name: 'Pixiv',
        icon: '🎨',
        color: '#818cf8',
        badge: 0,
        data: {}
    },
    {
        // [v3.36.0] 杂志：动画杂志（缝合自 Perigee js/magazine.js 1971 行 / 118212 字节 + magazine.css 20050 字节）。
        //   源是一个挂在全局 AppState.data.magazineData 上（切角色串味）、以 Utils.saveData 整块回写
        //   （13 处命中）、与放送局 / 论坛 / TTS 三处联动的日文动画杂志仿真：十种稿件类型
        //   （声优访谈 / 制作组访谈 / 圆桌座谈 / 人气投票 / 角色企划 / 制作专栏 / 读者来函 /
        //   角色对谈 / 关系图 / 月度总结）、十套正文解析器、四套导出、译文折叠块。
        //   四处不缝（都写清后果）：
        //     ① 源有 8 处 Utils.callChatAPI 直连模型、自己拼 systemPrompt 自己解析 TITLE: 行
        //        —— 本件一条请求都不发，只产「可复制的要求文本」，结果由用户贴回来登记；
        //     ② 源把整块状态经 Utils.saveData 回写、往宿主事件总线抛 emitEvent、读
        //        broadcast.officialNpcs —— 本件零宿主写入零宿主读，三条会话键各走 PhoneStorage；
        //     ③ 源要别的 App 的池（放送局的官方 NPC 当受访者 / 论坛的世界观当题材 /
        //        ttsConfig 当音频出口）—— 本件自带 10 位原创受访者池，零跨 App 读；
        //     ④ 源 exportImage() 从 jsdelivr CDN 动态插 <script> 拉 html2canvas、把离屏 DOM
        //        画成 PNG data URL —— 本件一条外链都不收、一张图都不产，导出只有 TXT 与可打印结构。
        //   三条偏离：期号收成登记时写下的序号（源用 findIndex+1 反查，删中间一篇后
        //   后面所有篇期号集体前移，旧导出与新读数对不上）；正文解析收成唯一实现
        //   （源十套解析器各写一遍、同一行在不同类型下归类不同且没人能回答「这行算被认出来了吗」）；
        //   译文按段落数组存（源把整段转义后塞 innerHTML，译文里的标签全变可见字符）。
        //   写盘三条键走 ^magazine_ 前缀随会话隔离。
        id: 'magazine',
        name: '杂志',
        icon: '📖',
        color: '#8b6914',
        badge: 0,
        data: {}
    },
    {
        // [v3.37.0] 白盒音效盒：音效是数据，不是音频文件（缝合自 SullyOS 的
        //   WhiteboxSoundEditor 37105 字节 + ttsRouter / voicePlayback / SARSpeechSwitch 三件套）。
        //   源的「白盒」二字指的就是这件事：六条内置音效**不是 mp3**，而是可读可改的合成配方
        //   （每条是若干 oscillator 音符：频率 / 起点 / 时长 / 波形 / 增益），播放时由 WebAudio
        //   现合成。取五块：① 合成配方真源表 ② 播放器机制（8ms 淡入 + 指数淡出）③ 分享码
        //   ④ 语音三件套的**机制**（自动播放受限的人话化 / 原台词与污染台词二态）⑤ CSS 绑定注释编解码。
        //   四块不缝：① **不自己调 TTS 商**（源 ttsRouter 直连 fishaudio / elevenlabs / minimax，
        //   自己拼请求、按语言选模型、粤语还做模型前置校验）—— 本件一个网络调用都没有，
        //   合成只走本机 WebAudio，本仓语音出口的唯一仲裁者是 apps/settings 的语音设置面，本件不与它争；
        //   ② **不碰宿主对象**（源把提示音写回宿主、把绑定注释写进宿主白框）—— 零宿主读零宿主写；
        //   ③ **不读别的 App 的表**（源直接读全局音频元素与角色卡的 voiceProfile 字段）—— 自带配方表；
        //   ④ **不收外链、不产二进制**（源允许 https 直链与 ≤200KB 音频上传转 data URL）——
        //   只收配方，零 URL、零 base64 载荷、零上传，「音效」在本件里永远是**可审计的数字**。
        //   三条偏离：四态互不同形（源把「没绑 / 绑空 / 绑了不存在的 key」塌成一句「点了没响」）；
        //   配方提成可登记可导出且过校验门、坏音符**如实计数**（源把坏值拖到播放期才抛，
        //   而播放期抛异常在宿主里常被吞掉）；音量收成一次取值门（源每处调用点各写一遍
        //   Math.min(1, Math.max(0, ...))，而 Number('') 与 Number(null) 都是 0 ⇒
        //   「没给」被读成「静音」）。
        //   写盘三条键走 ^soundkit_ 前缀随会话隔离。
        id: 'soundkit',
        name: '音效盒',
        icon: '\U0001f50a',
        color: '#35d6b0',
        badge: 0,
        data: {}
    },
    {
        // [v3.38.0] 召回治理台：管理取回的路，不自己取回（缝合自 SullyOS 记忆宫殿
        //   memory-palace-CwLWWYyz.js 845367 字符的多路召回管线）。
        //   源的「记忆宫殿」不是展示面（时间轴 / 节日 / 一起听这些词在源里 0~8 次命中），
        //   实为一整套**召回治理内核**：四路来源（稀疏 BM25 / 本地向量 / 远程向量 / 重排）
        //   + 房间三轴权重（相似 / 新近 / 重要）+ 高水位线 + 降级链 + Trace 注入。
        //   取五块：① 路状态判序（没配 / 已关 / 陈旧 / 降级 / 失败 / 可用）② 房间三轴权重表
        //   ③ BM25 三档与认不出落 naive 的口径 ④ 高水位线（失败批次不推进）⑤ 注入裁决与逐路贡献。
        //   四块不缝：① **不自己调 embedding**（源 47 处 apiKey / 56 处 fetch 自己算向量；本件
        //   零网络，只治理已到手的候选 —— 候选由本仓 apps/memory 的 BM25 与 LonSha 桥供给，
        //   缝进来就是第二个模型出口，与 apps/settings 争权威）；② **不碰宿主对象**（源把召回结果
        //   注入宿主请求；本件只产回执与裁决）；③ **不读别的 App 的表**（源直读 spark_char_handles
        //   与角色卡字段）；④ **不收外链、不落数据库**（源走 IndexedDB 迁版 + 远程向量库上传；
        //   本件零数据库零上传，落 PhoneStorage 三条会话键）。
        //   三条偏离：① **路状态六态互不同形**（源把「没配 / 被关掉 / 索引陈旧 / 降级中 / 上次失败」
        //   在读数面塔成同一个「不可用」，于是用户永远分不出该去配、该去开、还是该重建索引）；
        //   ② **融合必须报贡献**（源融合后只给结果列表，没有任何一处能回答「这条路贡献了几条」；
        //   本件走确定性 RRF 并逐路报进来 / 并入 / 重复 / 跳过）；③ **空召回不许注入**
        //   （源无条件注入；本件分四种跳过因，且「真的没有」与「四路全坏」**不许同形**
        //   —— 前者用户不用管，后者用户得去修路径）。
        //   写盘三条键走 ^recall_ 前缀随会话隔离。
        id: 'recall',
        name: '召回治理台',
        icon: '🏛️',
        color: '#2f6fd0',
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
