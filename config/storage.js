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
// ========================================
// 存储管理系统 v2.0 - 防弹级持久化架构
// ========================================
// 核心特性：
// 1. 聊天数据 → chatMetadata（随聊天文件保存）
// 2. 全局配置 → extensionSettings（随 settings.json 保存）
// 3. localStorage 仅作为极限兜底
// 4. 自动迁移旧数据到新架构
// ========================================

export class PhoneStorage {
    constructor() {
        // ==================== 命名空间 ====================
        this.NAMESPACE = 'st_virtual_phone';
        this.storageKey = 'virtual_phone'; // 兼容旧版 localStorage 键名

        // ==================== 上下文缓存 ====================
        this.currentCharacterId = null;
        this.currentChatId = null;
        this.currentConversationId = null;

        // ==================== 聊天数据的关键字匹配规则 ====================
        // 匹配这些关键字的 key 会被存入 chatMetadata（聊天专属）
        this.CHAT_DATA_PATTERNS = [
            /^wechat_/,           // 微信数据
            /^weibo_/,            // 微博数据
            /^honey_/,            // 蜜语数据
            /^chat_games_/,        // 按聊天独立的游戏存档
            /^pending[_-]contacts$/, // 待处理联系人
            /^chat_/,             // 聊天相关
            /^message_/,          // 消息相关
            /^contact_/,          // 联系人相关
            /_apps$/,             // APP状态（按聊天存储）
            /^story-/,            // 时间数据（避免频繁触发 settings_updated）
            /^diary_/,            // 日记数据（按聊天独立存储）
            /^calendar_/,         // 日历备忘录（按聊天独立存储）
            /^wangxiang_/,        // 万象任务与订单数据
            /^phone_call_/,       // 通话记录数据
            /^music_/,            // 音乐播放列表数据
            /^memory_/,           // 记忆系统数据（按聊天独立存储, 防串味）
            /^bili_/,             // B站条目
            /^theater_/,          // 小剧场
            /^life_events_/,      // 生活事件时间线
            /^worldpulse_/,       // [v2.9.0] 世界脉搏（设置/历史/队列状态，随会话隔离）
            // [v2.46.0] 地点图景（place_settings_v1：注入开关/行数/诊断显示）。
            //   场所读数本身每次现取（不落库），但设置若落全局会跨会话串味。
            /^place_/,
            // [v2.47.0] 金手指（cheat_state_v1：装配清单 installed[] + 设置）。
            //   外挂正文是内置静态事实源（data/cheats.js，不随会话变），
            //   但「本会话装了哪几个」必须随会话隔离，否则换角色会带着上一个角色的外挂。
            /^cheat_/,
            // [v2.48.0] 撩语（dt_state_v1：装配清单 installed[] + 设置）。
            //   语料正文是内置静态事实源（data/dirtytalk.js，不随会话变），
            //   但「本会话装了哪几个」必须随会话隔离，否则换角色会带着上一个角色的说话方式。
            /^dt_/,
            // [v2.49.0] 钱袋/档案/剧情线（wallet_settings_v1 / profile_settings_v1 /
            //   plotline_settings_v1：注入开关 + 行数）。只读桥消费，设置随会话隔离。
            /^wallet_/,
            /^profile_/,
            /^plotline_/,
            // [v2.51.0] 群像（chars_settings_v1：注入开关 + 角色数）。只读桥消费，设置随会话隔离。
            /^chars_/,
            // [v2.52.0] 时计（clock_settings_v1：注入开关 + 诊断显示）。只读桥消费，设置随会话隔离。
            /^clock_/,
            // [v2.53.0] 世界账本（ledger_settings_v1：注入开关）。只读桥消费。
            /^ledger_/,
            // [v2.61.0] 资产 App：设置走 asset_settings_v1；引擎唯一读写门的聊天变量
            //   是 __la_asset_*（config/ledger/market/extract/snapshots/projection/override）。
            //   两条都要进会话隔离，否则账本会落到全局 extensionSettings 串味。
            /^asset_/,
            /^__la_asset_/,
            /^tw_/,               // [v2.15.0] 织光机（收藏册 tw_letters / 定期织信游标 tw_last_auto，随会话隔离）
            // [v2.19.0] 积温引擎（jiwen_state 五轴状态/上次 tick/消息游标，随会话隔离）。
            //   修复：v2.8.0 移植起该键未匹配任何 pattern，被写入全局 extensionSettings，
            //   换角色/换会话五轴状态跨会话串味（历史误存键由 get 的搬迁逻辑自动迁回）。
            /^jiwen_/,
            // [v2.16.0] 系统层开关与通知落账（sys_notifs 通知历史 / sys_dnd 免打扰 /
            //   sys_shell_scale 显示缩放 / sys_flashlight 手电筒 / sys_wifi）：
            //   全部随会话隔离，避免跨角色/跨会话串味（CONTEXT.md 零数据库铁律 #3）。
            /^sys_/,
            // [v2.8.10 审计修复，v2.69.0 收紧] 新生态 App 的会话状态此前用一条 `/^ruby_/`
            //   **兜底**匹配。兜底能防串味，但代价是**归属不可知**：任何以 `ruby_` 开头的键
            //   都会被静默收纳进会话隔离，于是「这个键属于谁、该不该隔离」没有任何地方能回答，
            //   只能靠人肉 grep。v2.69.0 改为**逐键显式枚举**并配 keys 归属门禁（scripts/keys-audit.mjs）
            //   ——枚举清单一旦与真实键脱钩，门禁直接红灯（双向判定，见该脚本）。
            //
            // 口径：以下 13 个键**全部实测确认**为随会话隔离的运行时状态（CONTEXT.md 零数据库铁律 #3）。
            //   逐键枚举的价值不止于「可核对」：它让「新增一个 `ruby_` 键」必须显式登记，
            //   否则被判定为全局数据落进 extensionSettings——正是 v2.8.10 那轮串味事故的成因。
            /^ruby_gacha_state$/,              // 幸运转盘（cheat / dirtytalk / memory 只读共享背包）
            /^ruby_health_cycle$/,             // 生理周期/妊娠/病症
            /^ruby_health_handoff$/,           // [v2.70.0] 生理状态交接账本（随会话隔离）
            // [v2.72.0] 表格更新锚点（chatMetadata 顶层键）。锚点记的是「哪一楼那一页」，
            //   换角色后旧锚点指向的楼根本不存在，若落全局会让新角色读到「未知」或错数，
            //   故必须随会话隔离。
            /^rubyTableUpdateReviewAnchor$/,   // 表格更新锚点（落后正文几楼的三态读数）
            /^ruby_playbook_state$/,           // 玩法剧本
            /^ruby_tarot_history$/,            // 塔罗抽牌记录
            /^ruby_unlocked_achievements$/,    // 成就解锁表（timeweaver / memory 只读消费）
            /^ruby_xhs_notes$/,                // 小红书笔记
            /^ruby_tieba_posts$/,              // 贴吧帖子
            /^ruby_reading_shelf$/,            // 阅读书架
            /^ruby_reading_books$/,            // 阅读书架（历史键名，与 shelf 同义，读侧回落兼容）
            /^ruby_reading_progress_/,         // 阅读进度（前缀型：reading-view 按 bookId 拼接）
            /^ruby_phone_lyrics_settings$/,    // 歌词/氛围设置（music-ambience）
            // [v2.8.10 审计修复] 游戏存档迁移漏项：catbox/werewolf 已迁到 chat_games_*，
            // 以下牌局/棋盘状态仍留在 games_*。此处精确枚举，
            // 刻意不捕获 games_*_ai_prompt / *_presets_migrated 等提示词模板（属全局配置）。
            /^games_\d+_state$/,                          // 2048
            /^games_sudoku_state$/,
            /^games_board_state$/,                        // 五子棋/象棋/斗兽棋
            /^games_undercover_state$/,                   // 谁是卧底
            /^games_poker_(user_chips|player_count|chips_mode|selected_contact_ids)$/,
        ];

        // ==================== 防抖：saveChat ====================
        // 用于聊天数据的物理写入，防止短时间内频繁调用导致 IO 卡死
        this._saveChatTimer = null;
        this._saveChatDelay = 3000; // 3000ms 防抖延迟
        this._chatSaveQueue = Promise.resolve();

        // ==================== 队列锁：全局配置保存 ====================
        // 使用 Promise 链实现 Mutex，防止并发写入导致数据覆盖
        this._settingsSaveQueue = Promise.resolve();
        this._settingsSaveQueued = false; // 标记是否已有待执行的保存任务

        // ==================== 初始化 ====================
        this._cleanupLegacyData();
    }

    // ========================================
    // 🔧 内部工具方法
    // ========================================

    /**
     * 清理旧版过大的 localStorage 备份数据
     */
    _cleanupLegacyData() {
        try {
            localStorage.removeItem('virtual_phone_backup');
        } catch (e) {
            // 忽略错误
        }
    }

    /**
     * 判断某个 key 是否属于聊天专属数据
     * @param {string} key - 存储键名
     * @returns {boolean}
     */
    _isChatData(key) {
        return this.CHAT_DATA_PATTERNS.some(pattern => pattern.test(key));
    }

    _buildContextIdentity(context) {
        if (!context) return '';

        const chatId = String(context.chatMetadata?.file_name || context.chatId || 'default_chat').trim();
        const groupId = String(context.groupId ?? context.group?.id ?? '').trim();
        if (groupId) return `group:${groupId}::${chatId}`;

        const characterId = context.characterId;
        const character = (characterId !== undefined && characterId !== null)
            ? context.characters?.[characterId]
            : null;
        const avatar = String(character?.avatar || character?.data?.avatar || '').trim();
        const name = String(character?.name || character?.data?.name || context.name2 || '').trim();
        const characterIdentity = avatar
            ? `avatar:${avatar}`
            : ((characterId !== undefined && characterId !== null && String(characterId).trim())
                ? `id:${String(characterId).trim()}|name:${name || 'character'}`
                : `name:${name || 'default'}`);
        return `${characterIdentity}::${chatId}`;
    }

    /**
     * 获取酒馆上下文
     * @returns {Object|null}
     */
    getContext() {
        try {
            const context = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext)
                ? SillyTavern.getContext()
                : null;

            if (context) {
                this.currentCharacterId = context.characterId || context.name2 || 'default';
                this.currentChatId = context.chatMetadata?.file_name || context.chatId || 'default_chat';
                this.currentConversationId = this._buildContextIdentity(context);
            }

            return context;
        } catch (e) {
            console.warn('[PhoneStorage] 获取上下文失败:', e);
            return null;
        }
    }

    // ========================================
    // 🛡️ [v2.8.11] 聊天存档防膨胀熔断
    // ========================================
    // 说明：仓库任何版本此前都不存在写入侧熔断
    // （git log -S'_sanitizeChatData' 全历史为空），而 AI 可持续生成
    // 小红书笔记/贴吧帖子，这些顶层裸数组会无节制写入 chatMetadata，
    // 直接撑大聊天 jsonl 并拖慢保存。此处只做「最后防线」式限长，
    // 常规裁剪仍由各 App 自己负责（如 gacha 30 条、tarot 50 条）。
    //
    // 重要：键表只登记「实测确为顶层数组」的键。
    // 多数 App 以 JSON.stringify 字符串或对象存储（如 weibo_user_posts、
    // bili_entries_v1、theater_stories_v1、memory_core_v1），数组分支对它们
    // 永不生效——登记进去只会造成「看似有防护实为零引用」的假接线。
    // 若后续某 App 改为裸数组写入，再在此登记并补方向断言测试。

    // 新条目在头部的顶层数组键（unshift 语义）：必须保留「前 N 条」，
    // 若统一按 slice(-N) 保留尾部，会把最新笔记/帖子整批删掉。
    //   ruby_xhs_notes  <- xhs-data.js:93   this.notes.unshift(newNote)
    //   ruby_tieba_posts<- tieba-data.js:103 this.posts.unshift(newPost)
    static NEWEST_FIRST_KEYS = [
        /^ruby_xhs_notes$/,
        /^ruby_tieba_posts$/,
    ];

    // 顶层数组硬上限（超出才介入，正常玩法量不会触及）
    static ARRAY_CEILING = 300;
    // 单值 Base64 图片硬上限（100KB）：正常路径应已落盘为 /backgrounds 路径，
    // 走到这里说明上传失败或外部直接塞了 data URL，拒写以防击穿存档。
    static BASE64_IMAGE_CEILING = 102400;

    _isArrayNewestFirst(key) {
        return PhoneStorage.NEWEST_FIRST_KEYS.some(rx => rx.test(key));
    }

    /**
     * 清洗并裁剪写入 chatMetadata 的数据
     * @returns {*} 处理后的值
     */
    _sanitizeChatData(key, value) {
        try {
            if (value === null || value === undefined) return value;

            // 1. 顶层数组限长（方向感知）
            if (Array.isArray(value) && value.length > PhoneStorage.ARRAY_CEILING) {
                const ceiling = PhoneStorage.ARRAY_CEILING;
                const newestFirst = this._isArrayNewestFirst(key);
                const kept = newestFirst ? value.slice(0, ceiling) : value.slice(-ceiling);
                console.warn(`[PhoneStorage] 【${key}】数组超出上限(${value.length} > ${ceiling})，按${newestFirst ? '保留最新(头部)' : '保留最新(尾部)'}裁剪为 ${kept.length} 条`);
                return kept;
            }

            // 2. 超大 Base64 图片拒写
            if (typeof value === 'string'
                && value.length > PhoneStorage.BASE64_IMAGE_CEILING
                && /^data:image\//i.test(value)) {
                console.error(`[PhoneStorage] 拒绝将超大图片 Base64 (${Math.round(value.length / 1024)}KB) 写入 chatMetadata【${key}】，应使用 /backgrounds 路径`);
                return '[BLOCKED_LARGE_BASE64_IMAGE]';
            }
        } catch (e) {
            // 熔断本身不得阻断正常写入
            console.warn(`[PhoneStorage] 【${key}】清洗异常，跳过清洗:`, e);
        }
        return value;
    }

    /**
     * 生成存储键名（兼容旧版）
     * @param {string} dataType - 数据类型
     * @returns {string}
     */
    getStorageKey(dataType = 'apps') {
        this.getContext();
        return `${this.currentCharacterId}_${this.currentChatId}_${dataType}`;
    }

    // ========================================
    // 📦 chatMetadata 操作（聊天专属数据）
    // ========================================

    /**
     * 获取 chatMetadata 中的命名空间对象
     * @returns {Object|null}
     */
    /**
     * [v2.83.0] 命名空间守卫：确保拿到的是**可承载键值存储的普通对象**。
     *
     * 为什么不能只判 `!x`（原实现）：
     *   `!x` 只挡 undefined/null/''/0/false。而以下三种值「非空但不可用」，
     *   全部会被放行 —— 其中**数组最危险**：字符串键能挂上、能读回（本会话正常），
     *   但 `JSON.stringify` 不序列化数组的字符串属性，**一落盘就全丢**，
     *   下次打开会话读到空。表现为「不崩溃、不报错，只是数据错」。
     *
     * 实测矩阵（探针 probe_storage_corrupt.mjs，六个场景）：
     *   {} → 正常；'str' → set 报错+写不进；42 → set 报错+写不进；
     *   [1,2,3] → **set 不报错、内存读得到、落盘丢失**（最危险）；
     *   null / 缺失 → 被旧 `!x` 接住，正常。
     *
     * 处置：原值**备份**到命名空间内 `__corrupt_backup`（绝不静默丢用户数据），
     * 再重建空对象。只在本方法内改动，不动调用方。
     * @param {object} container 宿主容器（chatMetadata / extensionSettings）
     * @param {string} label 诊断用名称
     * @returns {object|null}
     */
    _ensureNamespaceStore(container, label) {
        try {
            if (!container || typeof container !== 'object') return null;
            const cur = container[this.NAMESPACE];
            const usable = cur !== null
                && typeof cur === 'object'
                && !Array.isArray(cur);
            if (usable) return cur;
            // 区分「缺席/空」与「在场但类型错」：
            //   前者（undefined / null）是正常初值，静默建空对象即可 ——
            //   对它也报 warn 会制造恒非零噪声，而恒非零的告警会被读者学会忽略（v2.33 教训）。
            //   后者（字符串/数字/布尔/数组）才是真损坏，必须留档并出声。
            const fresh = {};
            if (cur !== undefined && cur !== null) {
                const kind = Array.isArray(cur) ? 'array' : typeof cur;
                // 数组是最危险的一种：写入不报错、内存读得回、落盘全丢（见方法头注释）
                //
                // 备份放在**重建后的命名空间内部**（键名 __corrupt_backup），不是宿主容器顶层。
                // 取舍理由：① 顶层会污染宿主 chatMetadata，并与 keys-audit 的「键归属」门冲突；
                //   ② 放在命名空间内则随命名空间一起持久化、路径可预期，且只影响本插件自己的命名空间。
                try { fresh.__corrupt_backup = cur; } catch (_e) { /* 忽略 */ }
                console.warn(`[PhoneStorage] ${label} 命名空间【${this.NAMESPACE}】不是普通对象` +
                    `（${kind}），已备份至命名空间内 __corrupt_backup 并重建空对象` +
                    (kind === 'array' ? '（数组：写入不报错但落盘会丢，属静默数据损失）' : ''));
            }
            container[this.NAMESPACE] = fresh;
            return fresh;
        } catch (e) {
            console.warn(`[PhoneStorage] 准备 ${label} 命名空间失败:`, e);
            return null;
        }
    }
    _getChatMetadataStore() {
        try {
            const context = this.getContext();
            if (!context || !context.chatMetadata) return null;

            // 确保命名空间存在
            // [v2.83.0] 命名空间守卫（必须是普通对象，见 _ensureNamespaceStore）
            return this._ensureNamespaceStore(context.chatMetadata, 'chatMetadata');
        } catch (e) {
            console.warn('[PhoneStorage] 获取 chatMetadata 失败:', e);
            return null;
        }
    }

    /**
     * 防抖保存聊天数据到后端
     * 延迟执行，期间的多次调用会被合并
     */
    _debouncedSaveChat(immediate = false) {
        // 清除之前的定时器
        if (this._saveChatTimer) {
            clearTimeout(this._saveChatTimer);
        }

        // 使用稳定的联合会话标识，防止跨角色或同名聊天文件的延迟保存串写。
        const queuedConversationId = this.currentConversationId;

        // 设置新的定时器
        // [v2.8.13] 落盘体抽为具名 async 函数，供「防抖」与「立即」两条路径共用，
        // 避免同一套重试/串行逻辑出现两份实现而漂移。以下函数体本身未改动。
        const _runSaveChat = async () => {
            this._saveChatTimer = null;
            try {
                const context = this.getContext();
                // 如果聊天已切换或上下文丢失，禁止保存
                if (!context || this.currentConversationId !== queuedConversationId) return;

                if (typeof window.saveChatDebounced === 'function') {
                    window.saveChatDebounced();
                } else if (typeof context.saveChatDebounced === 'function') {
                    context.saveChatDebounced();
                } else if (typeof context.saveChat === 'function') {
                    // Windows 下多个保存请求同时替换同一 jsonl 会触发 EPERM rename。
                    // 将插件自己的直连保存串行化，并对短暂文件占用做有限退避重试。
                    this._chatSaveQueue = this._chatSaveQueue
                        .catch(() => undefined)
                        .then(async () => {
                            const retryDelays = [0, 350, 900, 1800];
                            let lastError = null;
                            for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
                                if (retryDelays[attempt] > 0) {
                                    await new Promise(resolve => setTimeout(resolve, retryDelays[attempt]));
                                }
                                const latestContext = this.getContext();
                                if (!latestContext || this.currentConversationId !== queuedConversationId) return;
                                try {
                                    await latestContext.saveChat();
                                    return;
                                } catch (error) {
                                    lastError = error;
                                    if (attempt < retryDelays.length - 1) {
                                        console.warn(`[PhoneStorage] saveChat 暂时失败，准备第 ${attempt + 1} 次重试:`, error);
                                    }
                                }
                            }
                            throw lastError || new Error('saveChat failed');
                        });
                    await this._chatSaveQueue;
                }
            } catch (e) {
                console.error('[PhoneStorage] saveChat 失败:', e);
            }
        };

        // [v2.8.13] immediate=true：绕过 _saveChatDelay 防抖，立即落盘，
        // 返回可 await 的 Promise（历史上第三参数被 set() 签名丢弃，从未生效）。
        if (immediate === true) {
            return _runSaveChat();
        }
        // 设置新的定时器
        this._saveChatTimer = setTimeout(() => { _runSaveChat(); }, this._saveChatDelay);
    }

    // ========================================
    // ⚙️ extensionSettings 操作（全局配置）
    // ========================================

    /**
     * 获取 extensionSettings 中的命名空间对象
     * @returns {Object|null}
     */
    _getExtensionSettingsStore() {
        try {
            const context = this.getContext();
            if (!context || !context.extensionSettings) return null;

            // 确保命名空间存在
            // [v2.83.0] 命名空间守卫（与 chatMetadata 同款，见 _ensureNamespaceStore）
            return this._ensureNamespaceStore(context.extensionSettings, 'extensionSettings');
        } catch (e) {
            console.warn('[PhoneStorage] 获取 extensionSettings 失败:', e);
            return null;
        }
    }

    /**
     * 兼容旧版：获取扩展设置对象（保持向后兼容）
     * @returns {Object|null}
     */
    getExtensionSettings() {
        return this._getExtensionSettingsStore();
    }

    /**
     * 队列锁保存全局配置
     * 使用 Promise 链实现 Mutex，确保"获取->合并->保存"的原子性
     */
    _queuedSaveExtensionSettings(immediate = false) {
        // [v2.8.13] immediate=true：不入队列、不等防抖，直接落盘全局配置。
        // 优先使用酒馆自带的非防抖 saveSettings（自行处理 CSRF 与并发），
        // 不可用时才退到手动 API 写入。
        if (immediate === true) {
            return (async () => {
                try {
                    const context = this.getContext();
                    if (!context) return;
                    if (typeof saveSettings === 'function') { await saveSettings(); return; }
                    if (typeof context.saveSettings === 'function') { await context.saveSettings(); return; }
                    await this._manualSaveSettings(context);
                } catch (e) {
                    console.error('[PhoneStorage] 立即保存全局配置失败:', e);
                }
            })();
        }

        // 如果已有待执行的保存任务，直接返回（合并请求）
        if (this._settingsSaveQueued) {
            return;
        }

        this._settingsSaveQueued = true;

        // 将保存任务推入队列
        this._settingsSaveQueue = this._settingsSaveQueue.then(async () => {
            this._settingsSaveQueued = false;

            try {
                const context = this.getContext();
                if (!context) return;

                // ==================== 方式1：使用酒馆内置的保存函数 ====================
                // 优先使用酒馆自带的防抖保存，它会自动处理 CSRF 和并发问题
                if (typeof context.saveSettingsDebounced === 'function') {
                    context.saveSettingsDebounced();
                    return;
                }

                // 备用：全局 saveSettingsDebounced
                if (typeof saveSettingsDebounced === 'function') {
                    saveSettingsDebounced();
                    return;
                }

                // 备用：全局 saveSettings
                if (typeof saveSettings === 'function') {
                    saveSettings();
                    return;
                }

                // ==================== 方式2：手动调用 API（带队列锁保护） ====================
                // 只有在酒馆内置函数不可用时才使用
                await this._manualSaveSettings(context);

            } catch (e) {
                console.error('[PhoneStorage] 保存全局配置失败:', e);
            }
        }).catch(err => {
            console.error('[PhoneStorage] 队列保存异常:', err);
            this._settingsSaveQueued = false;
        });
    }

    /**
     * 手动保存设置到服务器（带完整的读取-合并-写入流程）
     * 只有在酒馆内置函数不可用时才调用
     * @param {Object} context - 酒馆上下文
     */
    async _manualSaveSettings(context) {
        try {
            // 1️⃣ 获取最新的服务器 settings
            const getResponse = await fetch('/api/settings/get', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });

            if (!getResponse.ok) {
                console.warn('[PhoneStorage] 获取服务器设置失败');
                return;
            }

            const serverSettings = await getResponse.json();

            // 2️⃣ 合并当前的 extensionSettings
            if (!serverSettings.extension_settings) {
                serverSettings.extension_settings = {};
            }
            serverSettings.extension_settings[this.NAMESPACE] =
                context.extensionSettings[this.NAMESPACE] || {};

            // 3️⃣ 写回服务器
            const saveResponse = await fetch('/api/settings/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(serverSettings)
            });

            if (!saveResponse.ok) {
                console.error('[PhoneStorage] 保存到服务器失败');
            }

        } catch (e) {
            console.error('[PhoneStorage] 手动保存设置异常:', e);
        }
    }

    /**
     * 兼容旧版：保存扩展设置
     */
    async saveExtensionSettings() {
        this._queuedSaveExtensionSettings();
    }

    // ========================================
    // 🔑 核心公共 API：get / set
    // ========================================

    /**
     * 通用读取方法
     * 优先级：内存 → localStorage旧数据（自动迁移） → defaultValue
     *
     * @param {string} key - 存储键名
     * @param {*} defaultValue - 默认值（可选，默认为 null）
     * @returns {*} 存储的值
     */
    get(key, defaultValue = null) {
        try {
            const isChatData = this._isChatData(key);

            // ==================== 第1优先级：从酒馆内存读取 ====================
            let value = null;

            if (isChatData) {
                // 聊天专属数据 → chatMetadata
                const chatStore = this._getChatMetadataStore();
                if (chatStore && chatStore[key] !== undefined) {
                    value = chatStore[key];
                }
            } else {
                // 全局配置数据 → extensionSettings
                const extStore = this._getExtensionSettingsStore();
                if (extStore && extStore[key] !== undefined) {
                    value = extStore[key];
                }
            }

            if (value !== null && value !== undefined) {
                return value;
            }

            // ==================== 第1.5优先级：修正历史误存 ====================
            // [v2.8.10 审计修复] 会话键若此前因 pattern 缺失被写入 extensionSettings，
            // 这里做一次性搬迁：搬回 chatMetadata 并从全局配置移除，避免继续跨会话串味。
            if (isChatData && (value === null || value === undefined)) {
                const strayStore = this._getExtensionSettingsStore();
                if (strayStore && strayStore[key] !== undefined) {
                    const strayValue = strayStore[key];
                    delete strayStore[key];
                    const chatStoreForMigrate = this._getChatMetadataStore();
                    if (chatStoreForMigrate) {
                        chatStoreForMigrate[key] = strayValue;
                        this._debouncedSaveChat();
                        this._queuedSaveExtensionSettings();
                        console.info(`[PhoneStorage] 已将会话键【${key}】从全局配置迁移回当前会话`);
                    }
                    return strayValue;
                }
            }

            // ==================== 第2优先级：从 localStorage 读取旧数据并自动迁移 ====================
            // 仅全局设置允许走 localStorage 兜底，聊天专属数据禁止（防止亡灵复活）
            if (!isChatData) {
                const legacyKey = this._getLegacyLocalStorageKey(key, isChatData);
                const legacyValue = this._getFromLocalStorage(legacyKey);

                if (legacyValue !== null && legacyValue !== undefined) {
                    // 🔥 自动迁移：将旧数据写入新架构
                    this._migrateToNewArchitecture(key, legacyValue, isChatData);
                    return legacyValue;
                }
            }

            // ==================== 第3优先级：返回默认值 ====================
            return defaultValue;

        } catch (e) {
            console.warn(`[PhoneStorage] 读取 ${key} 失败:`, e);
            return defaultValue;
        }
    }

    /**
     * 通用写入方法
     * 根据 key 自动判断存入 chatMetadata 或 extensionSettings
     * 同时写入 localStorage 作为极限兜底
     *
     * @param {string} key - 存储键名
     * @param {*} value - 要存储的值
     * @param {boolean} [immediate=false] - [v2.8.13] true=立即落盘，绕过防抖/队列。
     *        注意：本参数**不改变**数据写入 chatMetadata 还是 extensionSettings，
     *        那始终由 CHAT_DATA_PATTERNS（_isChatData）决定。
     *        历史上它是被 set(key, value) 签名静默丢弃的死参数（全仓库 18 处调用点）。
     */
    async set(key, value, immediate = false) {
        try {
            const isChatData = this._isChatData(key);

            // ==================== 写入酒馆内存 ====================
            if (isChatData) {
                // 聊天专属数据 → chatMetadata
                // [v2.8.11] 写入前过防膨胀熔断（方向感知限长 + 超大 Base64 拒写）
                value = this._sanitizeChatData(key, value);
                const chatStore = this._getChatMetadataStore();
                if (chatStore) {
                    chatStore[key] = value;
                    // 🔥 防抖保存到后端；immediate 时绕过防抖并等待落盘完成
                    if (immediate === true) {
                        await this._debouncedSaveChat(true);
                    } else {
                        this._debouncedSaveChat();
                    }
                }
            } else {
                // 全局配置数据 → extensionSettings
                const extStore = this._getExtensionSettingsStore();
                if (extStore) {
                    extStore[key] = value;
                    // 🔥 队列锁保存到后端；immediate 时绕过队列直接落盘
                    if (immediate === true) {
                        await this._queuedSaveExtensionSettings(true);
                    } else {
                        this._queuedSaveExtensionSettings();
                    }
                }
            }

            // ==================== 同步写入 localStorage 作为兜底 ====================
            // 仅全局设置写入 localStorage，聊天专属数据禁止（防止数据回档）
            if (!isChatData) {
                this._setToLocalStorage(key, value, isChatData);
            }

        } catch (e) {
            console.error(`[PhoneStorage] 保存 ${key} 失败:`, e);
        }
    }

    /**
     * 🔥 删除指定 key 的数据
     * @param {string} key - 存储键名
     * @param {boolean} [immediate=false] - 同 set()：true=立即落盘
     */
    async remove(key, immediate = false) {
        try {
            const isChatData = this._isChatData(key);

            // ==================== 从酒馆内存删除 ====================
            if (isChatData) {
                const chatStore = this._getChatMetadataStore();
                if (chatStore && chatStore[key] !== undefined) {
                    delete chatStore[key];
                    // [v2.8.13] 与 set() 对齐
                    if (immediate === true) {
                        await this._debouncedSaveChat(true);
                    } else {
                        this._debouncedSaveChat();
                    }
                }
            } else {
                const extStore = this._getExtensionSettingsStore();
                if (extStore && extStore[key] !== undefined) {
                    delete extStore[key];
                    // [v2.8.13] 与 set() 对齐
                    if (immediate === true) {
                        await this._queuedSaveExtensionSettings(true);
                    } else {
                        this._queuedSaveExtensionSettings();
                    }
                }
            }

            // ==================== 从 localStorage 删除 ====================
            const fullKey = this._getLegacyLocalStorageKey(key, isChatData);
            try {
                localStorage.removeItem(fullKey);
            } catch (e) {
                // 忽略 localStorage 错误
            }

        } catch (e) {
            console.error(`[PhoneStorage] 删除 ${key} 失败:`, e);
        }
    }

    // ========================================
    // 🗄️ localStorage 兜底操作
    // ========================================

    /**
     * 获取旧版 localStorage 键名
     */
    _getLegacyLocalStorageKey(key, isChatData) {
        if (isChatData) {
            return `${this.storageKey}_${this.getStorageKey(key)}`;
        } else {
            return `${this.storageKey}_global_${key}`;
        }
    }

    /**
     * 从 localStorage 读取
     */
    _getFromLocalStorage(fullKey) {
        try {
            return localStorage.getItem(fullKey);
        } catch (e) {
            return null;
        }
    }

    /**
     * 写入 localStorage（忽略 QuotaExceededError）
     */
    _setToLocalStorage(key, value, isChatData) {
        try {
            const fullKey = this._getLegacyLocalStorageKey(key, isChatData);
            const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
            localStorage.setItem(fullKey, stringValue);
        } catch (e) {
            // 🔥 忽略 QuotaExceededError，localStorage 只是兜底
            if (e.name === 'QuotaExceededError' || e.code === 22) {
                console.warn('[PhoneStorage] localStorage 配额已满，跳过兜底存储');
            }
        }
    }

    /**
     * 自动迁移旧数据到新架构
     */
    _migrateToNewArchitecture(key, value, isChatData) {
        try {
            if (isChatData) {
                const chatStore = this._getChatMetadataStore();
                if (chatStore) {
                    chatStore[key] = value;
                    this._debouncedSaveChat();
                }
            } else {
                const extStore = this._getExtensionSettingsStore();
                if (extStore) {
                    extStore[key] = value;
                    this._queuedSaveExtensionSettings();
                }
            }
        } catch (e) {
            console.warn('[PhoneStorage] 自动迁移失败:', e);
        }
    }

    // ========================================
    // 📱 APP 数据操作（保持向后兼容）
    // ========================================

    /**
     * 保存 APP 数据
     * @param {Array} apps - APP 列表
     */
    async saveApps(apps) {
        try {
            const key = this.getStorageKey('apps');
            const data = JSON.stringify(apps);

            // 存入 chatMetadata（因为 APP 状态是聊天专属的）
            const chatStore = this._getChatMetadataStore();
            if (chatStore) {
                chatStore[key] = data;
                this._debouncedSaveChat();
            }

            // 兜底写入 localStorage
            this._setToLocalStorage(key, data, true);

        } catch (e) {
            console.error('[PhoneStorage] 保存 Apps 失败:', e);
        }
    }

    /**
     * 加载 APP 数据
     * @param {Array} defaultApps - 默认 APP 列表
     * @returns {Array}
     */
    loadApps(defaultApps) {
        try {
            const key = this.getStorageKey('apps');
            let saved = null;

            // 1️⃣ 优先从 chatMetadata 读取
            const chatStore = this._getChatMetadataStore();
            if (chatStore && chatStore[key]) {
                saved = chatStore[key];
            }

            // 2️⃣ 兼容：从旧版 extensionSettings 读取
            if (!saved) {
                const extStore = this._getExtensionSettingsStore();
                if (extStore && extStore[key]) {
                    saved = extStore[key];
                    // 迁移到 chatMetadata
                    if (chatStore) {
                        chatStore[key] = saved;
                        this._debouncedSaveChat();
                    }
                }
            }

            // 3️⃣ 兜底：从 localStorage 读取
            if (!saved) {
                saved = localStorage.getItem(`${this.storageKey}_${key}`);
                if (saved && chatStore) {
                    // 自动迁移
                    chatStore[key] = saved;
                    this._debouncedSaveChat();
                }
            }

            // 解析并合并
            if (saved && typeof saved === 'string' && saved.trim() !== '') {
                try {
                    const savedApps = JSON.parse(saved);

                    // 🔥 始终使用最新的应用列表配置，只恢复用户数据
                    return defaultApps.map(defaultApp => {
                        const savedApp = savedApps.find(s => s.id === defaultApp.id);
                        if (savedApp) {
                            return {
                                ...defaultApp,
                                badge: savedApp.badge || 0,
                                data: savedApp.data || defaultApp.data
                            };
                        }
                        return defaultApp;
                    });
                } catch (parseError) {
                    console.error('[PhoneStorage] Apps JSON 解析失败:', parseError.message);
                    // 清空损坏数据
                    if (chatStore) delete chatStore[key];
                    localStorage.removeItem(`${this.storageKey}_${key}`);
                }
            }
        } catch (e) {
            console.warn('[PhoneStorage] 加载 Apps 失败:', e);
        }

        return defaultApps;
    }

    // ========================================
    // ⚙️ 设置操作（保持向后兼容）
    // ========================================

    /**
     * 保存设置（全局配置）
     * @param {Object} settings - 设置对象
     */
    async saveSettings(settings) {
        try {
            const data = JSON.stringify(settings);

            // 存入 extensionSettings
            const extStore = this._getExtensionSettingsStore();
            if (extStore) {
                extStore['global_settings'] = data;
                this._queuedSaveExtensionSettings();
            }

            // 兜底写入 localStorage
            this._setToLocalStorage('global_settings', data, false);

        } catch (e) {
            console.error('[PhoneStorage] 保存设置失败:', e);
        }
    }

    /**
     * 加载设置
     * @returns {Object}
     */
    loadSettings() {
        const defaultSettings = {
            enabled: true,
            soundEnabled: true,
            vibrationEnabled: true,
            onlineMode: false,
            promptTemplate: null
        };

        try {
            let saved = null;

            // 1️⃣ 从 extensionSettings 读取
            const extStore = this._getExtensionSettingsStore();
            if (extStore && extStore['global_settings']) {
                saved = extStore['global_settings'];
            }

            // 2️⃣ 兜底：从 localStorage 读取
            if (!saved) {
                saved = localStorage.getItem(`${this.storageKey}_global_settings`);
                if (saved && extStore) {
                    // 自动迁移
                    extStore['global_settings'] = saved;
                    this._queuedSaveExtensionSettings();
                }
            }

            // 解析
            if (saved && typeof saved === 'string' && saved.trim() !== '') {
                try {
                    return JSON.parse(saved);
                } catch (parseError) {
                    console.error('[PhoneStorage] Settings JSON 解析失败:', parseError.message);
                    localStorage.removeItem(`${this.storageKey}_global_settings`);
                }
            }
        } catch (e) {
            console.warn('[PhoneStorage] 加载设置失败:', e);
        }

        return defaultSettings;
    }

    // ========================================
    // 🗑️ 数据清理
    // ========================================

    /**
     * 清空当前聊天的数据（保留全局个性化装扮）
     */
    async clearCurrentData() {
        try {
            this.getContext();
            const prefix = `${this.currentCharacterId}_${this.currentChatId}_`;

            // 1️⃣ 清理 chatMetadata（当前会话的全部数据）
            const chatStore = this._getChatMetadataStore();
            if (chatStore) {
                Object.keys(chatStore).forEach(k => {
                    delete chatStore[k];
                });
                // 立即保存（不防抖，确保清理生效）
                const context = this.getContext();
                if (context && typeof context.saveChat === 'function') {
                    await context.saveChat();
                }
            }

            // 2️⃣ 清理 localStorage 中的相关数据（带角色前缀的）
            const keys = Object.keys(localStorage);
            keys.forEach(k => {
                if (k.includes(prefix)) {
                    localStorage.removeItem(k);
                }
            });

            console.log('[PhoneStorage] 当前聊天数据已清空（全局装扮已保留）');

        } catch (e) {
            console.error('[PhoneStorage] 清空当前数据失败:', e);
        }
    }

    /**
     * 清空所有数据（恢复出厂设置：所有角色数据 + 全局装扮 + 缓存）
     */
    async clearAllData() {
        try {
            // 1️⃣ 清理当前聊天的 chatMetadata
            const chatStore = this._getChatMetadataStore();
            if (chatStore) {
                Object.keys(chatStore).forEach(k => delete chatStore[k]);
                const context = this.getContext();
                if (context && typeof context.saveChat === 'function') {
                    await context.saveChat();
                }
            }

            // 2️⃣ 清理 extensionSettings（全局装扮、提示词、图片等全部删除）
            const context2 = this.getContext();
            if (context2 && context2.extensionSettings) {
                // 彻底删除整个命名空间
                delete context2.extensionSettings[this.NAMESPACE];
                // 重新创建空命名空间（防止后续代码报错）
                context2.extensionSettings[this.NAMESPACE] = {};

                // 保存到服务器
                if (typeof context2.saveSettingsDebounced === 'function') {
                    context2.saveSettingsDebounced();
                } else if (typeof saveSettingsDebounced === 'function') {
                    saveSettingsDebounced();
                } else {
                    this._queuedSaveExtensionSettings();
                }
            }

            // 3️⃣ 清理 localStorage（所有带插件命名空间的键）
            const keys = Object.keys(localStorage);
            keys.forEach(k => {
                if (k.startsWith(this.storageKey) ||
                    k.startsWith(this.NAMESPACE) ||
                    k.includes('virtual_phone') ||
                    k.includes('st_virtual_phone')) {
                    localStorage.removeItem(k);
                }
            });

            console.log('[PhoneStorage] 恢复出厂设置完成：所有数据已清空');

        } catch (e) {
            console.error('[PhoneStorage] 清空所有数据失败:', e);
        }
    }
}
