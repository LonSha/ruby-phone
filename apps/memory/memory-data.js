/* ========================================================
 *  记忆数据层 (MemoryCore) — RubyPhone 记忆系统中枢
 *  职责:
 *   1. 存储适配: 记忆/短期/池状态 挂 PhoneStorage (chatMetadata, 按聊天隔离防串味)
 *   2. 编排: EmotionTagger(情感) + MemoryPool(感知触发) + Decay评分 + 巩固结晶
 *   3. 采集: 对话消息 → 短期记忆 → 巩固 → 长期记忆 + 记忆池分层
 *   4. 注入: buildPromptDirective() 生成【记忆】块供 GENERATE_BEFORE_COMBINE_PROMPTS 携带
 *  移植自 sxiphone 记忆体系, 零外部 API 依赖
 * ======================================================== */
import { EmotionTagger, calculateDecayScore, consolidateMemories, searchMemories, buildMemorySummary } from './memory-engine.js';
import { MemoryPool } from './memory-pool.js';
import { cleanFloorForSummary } from '../../config/message-clean.js';
import { decorateRecall, pruneByLifecycle, RECALL_PERMISSION } from '../../config/recall-filter.js';
import { scanSupersede, reviveSuperseded, SUPERSEDE_STATUS } from '../../config/supersede-engine.js';
/* [v3.80.0 · 缝入 A3] 结构化记忆块：模型在正文里**显式声明**要记的事。
 *   修前记忆全靠被动采集（正文丢桶、后续检索捞回来），于是「共同经历」这类
 *   需要主动声明的东西，从来没被声明过 —— 它只是恰好躺在某句话里，检索到了算运气。 */
import { parseMemoryBlock, memoryBlockLine } from '../../config/memory-block.js';
/* [v3.80.0 · 缝入 A2] 三级记忆：world（跨卡共同）/ shared:<角色>（跨卡角色）/ save（本档）。
 *   存储只加**一个**全局键（键面成本：每加一键就要在 keys-audit 回答归属、在
 *   CHAT_DATA_PATTERNS 与机制对齐）；`/^memory_/` 全判会话隔离的口径不变，
 *   故该键刻意走 `phone_` 前缀并登记 scope:'global'（见 scripts/keys-audit.mjs）。 */
import {
    SHARED_MEMORY_KEY, LEVELS as SHARED_LEVELS, emptyStore, normalizeStore,
    remember as sharedRemember, recall as sharedRecall, sharedMemoryLine as sharedMemoryLineOf
} from '../../config/shared-memory.js';

/** [v3.3.0] 楼层取值门（删楼回滚族）：只认数字与非空数字字符串，其余如实 null。
 *  与 `config/projection-contract.js` / `config/injection-contract.js` 的 `numOrNull`、
 *  `apps/place/place-data.js` 的同名函数同因同法（本仓约定各边界自持同口径门）。 */
function floorOrNull(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string') {
        const t = v.trim();
        if (!t) return null;
        const n = Number(t);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

export class MemoryCore {
    constructor(storage) {
        this.storage = storage;
        this.KEY = 'memory_core_v1';

        this.emotion = new EmotionTagger();
        this.pool = new MemoryPool();
        // [RB] 数据版本戳: 任何落盘的记忆变更递增, 供 LonShaBridge 懒检测 BM25 索引失效
        this._dataVersion = 0;
        /* [v3.80.0 · 缝入 A3] 最近一次解析到的记忆块（诊断页读它，不重解析）。
         *   刻意**不落盘**：块是「这一轮回复说了什么」，不是账本。 */
        this.pendingMemoryBlock = null;
        this._sharedLoaded = false;
        this._sharedStore = emptyStore();
        this._sharedWriteCount = 0;
        // [v2.82.0] prompt 钩子单次挂载标记（见 attachPromptHook 注释）
        this._hooked = false;

        // 状态
        this.longTerm = [];      // 巩固后的长期记忆
        this.shortTerm = [];     // 短期缓冲 (待巩固)
        this.stats = { consolidated: 0, archived: 0, lastSleep: null };
        this.config = {
            shortTermCapacity: 60,
            autoInject: false,      // 是否自动携带记忆块进入 prompt
            injectTopN: 6,          // 注入前 N 条最相关记忆
            minImportance: 5,       // 采集门槛
            sleepEveryMessages: 24  // 每 N 条消息触发一次睡眠巩固
        };

        this._load();
        this.pool.initialize();
    }

    // ---------------- 持久化 ----------------
    _load() {
        try {
            const raw = this.storage?.get?.(this.KEY);
            if (!raw) return;
            const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (Array.isArray(d.longTerm)) this.longTerm = d.longTerm;
            if (Array.isArray(d.shortTerm)) this.shortTerm = d.shortTerm;
            if (d.stats) this.stats = { ...this.stats, ...d.stats };
            if (d.config) this.config = { ...this.config, ...d.config };
            if (d.pool) this.pool.loadState(d.pool);
        } catch (e) {
            console.warn('[MemoryCore] 加载记忆失败:', e);
        }
    }

    // [RA] 防抖写盘: 高频 record 场景下 800ms 内合并为一次全量序列化; immediate=true 立即落盘
    _save(immediate = false) {
        if (immediate) {
            if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
            this._saveNow();
            return;
        }
        if (this._saveTimer) return;
        this._saveTimer = setTimeout(() => { this._saveTimer = null; this._saveNow(); }, 800);
    }
    _saveNow() {
        this._dataVersion = (this._dataVersion || 0) + 1;
        try {
            this.storage?.set?.(this.KEY, JSON.stringify({
                longTerm: this.longTerm,
                shortTerm: this.shortTerm,
                stats: this.stats,
                config: this.config,
                pool: this.pool.dumpState(),
                updatedAt: new Date().toISOString()
            }));
        } catch (e) {
            console.warn('[MemoryCore] 保存记忆失败:', e);
        }
    }

    /** [RB] 记忆数据版本戳 (record/sleep/clear/reload/invalidate 等落盘变更单调递增) */
    get dataVersion() { return this._dataVersion || 0; }
    updateConfig(patch = {}) {
        Object.assign(this.config, patch);
        this._save(true);
    }

    // ---------------- 采集 ----------------
    /**
     * 记录一条对话到短期记忆
     * @param role 'user' | 'ai'
     * @param text 消息正文
     * @param context 可选 { place, senses, emotion }
     */
    record(role, text, context = {}, meta = {}) {
        /* [v3.80.0 · 缝入 A3] 结构化记忆块解析 —— **必须在清洗之前**。
         *   修后实测（本套件 C3/C4 当场抓到）：`cleanFloorForSummary` 会把成对块
         *   整段剔除，先清洗再解析等于把模型写的块当噪声删掉 —— 解析永远读不到块。
         *   它剔除的是**系统注入**的状态块，而我们这里要读的正是模型自己写的块，
         *   两者形状相近但归属相反，故顺序不可调换。 */
        let block = null;
        try { block = parseMemoryBlock(String(text || '')); } catch (_e) { block = null; }
        this.pendingMemoryBlock = (block && block.present) ? block : null;

        let content = String(text || '');
        // [芋圆] 采集前清洗: 剔除 horae 等插件注入的状态块/HTML/成对块/裸K=V行, 避免把系统状态当记忆采进去
        try { content = cleanFloorForSummary(content); } catch (e) { /* 清洗失败保留原文 */ }
        content = content.replace(/\s+/g, ' ').trim();

        /* 吸块必须在「正文为空」那道门**之前**：整楼只有记忆块的回复，清洗后正文确实为空 ——
         *   若先过门再吸块，这种回复会早退，块永远进不了桶
         *   （实测量到：只写块的那一楼 record 返回 null，pendingMemoryBlock 有读数而桶是空的）。 */
        if (block && block.present && !block.empty && block.items.length) {
            try { this._absorbMemoryBlock(block, role, meta); } catch (_e) { /* 解析出的块坏了不阻断采集 */ }
        }
        if (!content) return null;

        const emotion = this.emotion.analyze(content);
        // 重要性启发: 长度 + 情感强度 + 角色权重 (AI 角色台词权重更高)
        let importance = 3;
        if (content.length >= 40) importance += 2;
        if (content.length >= 120) importance += 1;
        const arousal = emotion.arousal || 0.5;
        if (arousal > 0.7) importance += 2;
        if (arousal < 0.35) importance += 1; // 平静时刻反而珍贵
        if (role === 'ai') importance += 1;
        importance = Math.max(1, Math.min(10, importance));
        // [RA] 置顶/剧情/显式重要度保护: 避免 LonSha 回填的简报被启发式评分误杀
        if (meta && meta.importance !== undefined && meta.importance !== null) {
            importance = Math.max(1, Math.min(10, Number(meta.importance)));
        } else if (meta && meta.pinned) {
            importance = Math.max(importance, 7);
        }

        if (!meta?.pinned && importance < this.config.minImportance) return null; // 低价值普通消息不采集

        const entry = {
            id: 'stm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            role,
            content: content.slice(0, 500),
            importance,
            emotion,
            tags: context.tags || this._extractTags(content),
            place: context.place || null,
            // [RA] 结构化锚点: 楼层号/swipe页码/故事内时间 (供删楼回滚与时间感知)
            floor: (meta && meta.floor !== undefined && meta.floor !== null) ? Number(meta.floor) : null,
            swipe: (meta && meta.swipe !== undefined && meta.swipe !== null) ? Number(meta.swipe) : null,
            storyTime: (context && context.storyTime) || (meta && meta.storyTime) || null,
            pinned: !!(meta && meta.pinned),
            createdAt: new Date().toISOString()
        };
        this.shortTerm.push(entry);
        if (this.shortTerm.length > this.config.shortTermCapacity) this.shortTerm.shift();
        this._save();

        // 每 N 条自动触发一次睡眠巩固
        if (this.shortTerm.length >= this.config.sleepEveryMessages) this.sleep();
        return entry;
    }

    /* ---------------- [v3.80.0 · 缝入 A2/A3] 跨卡记忆与结构化块 ---------------- */

    /** 全局桶读入（懒加载 + 每次写回都回写内存副本）。
     *  刻意**不**进 `_load()`：`reload()` 是换会话路径，把跨卡桶挂在那儿
     *  等于换会话就把跨卡层丢掉 —— 那正是本功能要治的病。 */
    _sharedStoreNow() {
        if (this._sharedLoaded) return this._sharedStore;
        let raw = null;
        try { raw = this.storage?.get?.(SHARED_MEMORY_KEY); } catch (_e) { raw = null; }
        this._sharedStore = normalizeStore(raw);
        this._sharedLoaded = true;
        return this._sharedStore;
    }

    _persistShared(store) {
        this._sharedStore = store;
        this._sharedLoaded = true;
        this._sharedWriteCount += 1;
        try { this.storage?.set?.(SHARED_MEMORY_KEY, JSON.stringify(store)); } catch (_e) { /* 全局桶写失败不阻断本会话记忆 */ }
    }

    /** 结构化块 → 跨卡桶。层级由调用方经 `meta.sharedLevel` 指定，默认 world：
     *  「共同经历」需要知道**是谁**的经历，而块里只有文本 —— 名字得由调用方给。 */
    _absorbMemoryBlock(block, role, meta) {
        const level = (meta && meta.sharedLevel === SHARED_LEVELS.SHARED) ? SHARED_LEVELS.SHARED : SHARED_LEVELS.WORLD;
        const cardId = String((meta && meta.cardId) || '');
        const chatId = String((meta && meta.chatId) || '');
        const name = String((meta && meta.character) || '');
        let store = this._sharedStoreNow();
        let added = 0;
        for (const item of block.items) {
            const res = sharedRemember(store, level, item.text, {
                kind: item.kind, cardId: cardId, chatId: chatId, name: name, source: 'memory-block'
            });
            store = res.store;
            if (res.added) added += 1;
        }
        this._lastSharedWrite = { added: added, skipped: block.items.length - added, level: level, bucket: level === SHARED_LEVELS.SHARED ? ('shared:' + name) : 'world' };
        if (added > 0) this._persistShared(store);
        return this._lastSharedWrite;
    }

    /** 三级检索：跨卡两档 + 本档。**逐档标注来源**（诊断页必须能回答
     *  「这条是跨卡层来的还是本会话来的」，揉成一列后两张卡的同名角色就分不开了）。 */
    recallShared(query = {}, limit = 8) {
        const q = (typeof query === 'string') ? { text: query } : (query || {});
        const saveRecords = this.longTerm.map(function (m) { return { text: m.content, at: m.createdAt || '' }; });
        const score = function (a, b) {
            const needle = String(a || '').trim();
            const hay = String(b || '');
            if (!needle || !hay) return 0;
            let hit = 0;
            for (let i = 0; i + 2 <= needle.length; i += 1) {
                if (hay.indexOf(needle.slice(i, i + 2)) >= 0) hit += 1;
            }
            return hit;
        };
        return sharedRecall(this._sharedStoreNow(), saveRecords, Object.assign({}, q, { limit: limit, score: score }));
    }

    /** 一行读数（诊断页用）：三档分列 + 结构化块的当轮读数。 */
    sharedMemoryLine() {
        const res = this.recallShared({}, 0);
        return sharedMemoryLineOf(res);
    }

    /** 记忆块一行读数（当轮）。无块时如实说「本回复无」，不报失败。 */
    memoryBlockLineNow() {
        return memoryBlockLine(this.pendingMemoryBlock || { present: false });
    }

    /** 跨卡桶清空（用户必须能清掉全局桶，否则它是一块看不见也删不掉的污渍）。 */
    clearShared() {
        this._persistShared(emptyStore());
        return true;
    }

    _extractTags(text) {
        const out = new Set();
        (String(text || '').match(/[一-鿿]{2,4}/g) || []).forEach(w => out.add(w));
        return [...out].slice(0, 12);
    }

    // ---------------- 睡眠巩固 (Sleep 管线) ----------------
    /**
     * 将短期记忆巩固为长期记忆, 同时填充记忆池感知/时间层
     */
    sleep() {
        if (!this.shortTerm.length) return { consolidated: 0 };
        const batch = [...this.shortTerm];
        const result = consolidateMemories(batch, {
            patternThreshold: 2,
            decayThreshold: 0.5
        });

        for (const m of result.consolidated) {
            // 去重: 内容 hash 相同则强化而非重复入库
            const exist = this.longTerm.find(x => x.content === m.content);
            if (exist) {
                exist.metadata = { ...(exist.metadata || {}), reinforcementCount: (exist.metadata?.reinforcementCount || 0) + 1, lastActive: new Date().toISOString(), activationCount: (exist.metadata?.activationCount || 1) };
                if (m.place) exist.place = m.place;
            } else {
                m._newThisSleep = true; // [Paramecium] 标记本次新入, 供换代扫描识别
                this.longTerm.push(m);
            }
            // 填充记忆池
            if (m.content && m.content.length >= 20) {
                if (m.role === 'ai' || (m.emotion && m.emotion.intensity > 0)) {
                    this.pool.addPerception(m.content, {
                        location: m.place,
                        emotion: m.emotion,
                        metadata: { importance: m.importance, sourceRole: m.role, floor: m.floor ?? null }
                    });
                }
                this.pool.addTemporal(m.content, {
                    timestamp: m.createdAt,
                    emotion: m.emotion,
                    metadata: { importance: m.importance, floor: m.floor ?? null }
                });
                if (m.place) this.pool.addSpatial(m.content, { place: m.place, metadata: { importance: m.importance, floor: m.floor ?? null } });
            }
        }

        this.shortTerm = [];
        this.stats.consolidated += result.consolidated.length;
        this.stats.archived += result.archived.length;
        this.stats.lastSleep = new Date().toISOString();

        // 低分记忆清理 (防膨胀): 长期记忆上限 400 条, 超限按衰减分淘汰
        // [RA] pinned/永久/手动收藏/剧情回填条目不参与淘汰 (重要剧情不能被衰减分挤掉)
        const cap = 400;
        if (this.longTerm.length > cap) {
            const isProtected = (m) => !!(m.pinned || m.pinnedBy || m.metadata?.pinned || m.metadata?.type === 'permanent' || (m.content || '').startsWith('[剧情]'));
            const protectedMem = this.longTerm.filter(isProtected);
            const pool = this.longTerm.filter(m => !isProtected(m));
            const scored = pool.map(m => ({ m, s: calculateDecayScore(m) }));
            scored.sort((a, b) => b.s - a.s);
            const keep = scored.slice(0, Math.max(0, cap - protectedMem.length)).map(x => x.m);
            this.longTerm = protectedMem.concat(keep);
        }
        // 记忆换代 (Paramecium「原文是唯一真相」移植): 本次新入条目与既有长期记忆做高置信冲突检测,
        // 冲突且新条目重要性足够 → 旧条目标 superseded 退出排名(不删原文, 可逆复活)
        // 注: 须在 lifecycle prune 之前执行 —— prune 会重建对象导致 _newThisSleep 丢失
        {
            const newly = this.longTerm.filter(m => m._newThisSleep);
            // 压制池 = 既有条目 (排除本次新入, 避免新条目互相误判换代)
            const existingPool = this.longTerm.filter(m => !m._newThisSleep);
            // 先清临时标记
            this.longTerm.forEach(m => { delete m._newThisSleep; });
            if (newly.length) {
                const sc = scanSupersede(newly, existingPool);
                if (sc.superseded.length) {
                    this.stats.superseded = (this.stats.superseded || 0) + sc.superseded.length;
                }
                // 重建 longTerm: existingPool 已被 scan 原地标记换代 (元素被新对象替换), 必须用它重建
                this.longTerm = [...existingPool, ...newly];
                // 复活检查: 压制方被换代/消失时, 旧条目恢复参与排名
                this.longTerm = reviveSuperseded(this.longTerm);
            }
        }
        // 生命周期冷却 (MemoryConstellations 移植): 打 active/cooling/frozen 标签, 墓碑化超期且非保护条目
        // 不破坏历史数据: 仅打 _lifecycle 标 + 墓碑化清空超期非保护条目的正文
        {
            const lc = pruneByLifecycle(this.longTerm);
            this.longTerm = [...lc.active, ...lc.cooling, ...lc.frozen];
            if (lc.tombstoned.length) {
                this.stats.tombstoned = (this.stats.tombstoned || 0) + lc.tombstoned.length;
            }
        }
        this._save();
        return { consolidated: result.consolidated.length, patterns: result.patterns.length };
    }

    // ---------------- 检索与注入 ----------------
    /**
     * 混合检索: 记忆池三级触发 + 长期记忆关键词检索
     * 召回结果经过 decorateRecall: 分段衰减排序 + 回忆权限分级(可引用/需谨慎/仅联想)
     * @returns [{layer, content, _score, _permission, permissionLabel, meta}]
     */
    recall(query, topN = 6) {
        const out = [];
        // 1) 记忆池触发 (感知优先)
        const poolRes = this.pool.trigger(query);
        poolRes.matched.forEach(m => out.push({ layer: m._layer || 'pool', content: m.content, _score: m._score, emotion: m.emotion || null, metadata: m.metadata || {}, createdAt: m.createdAt }));
        // 2) 长期记忆关键词
        const longRes = searchMemories(this.longTerm, query, {});
        longRes.forEach(m => out.push({ layer: 'long-term', content: m.content, _score: m._score, importance: m.importance, emotion: m.emotion || null, metadata: m.metadata || {}, createdAt: m.createdAt }));
        // 去重
        const seen = new Set();
        const uniq = out.filter(x => { if (!x.content || seen.has(x.content)) return false; seen.add(x.content); return true; });
        // [Paramecium] superseded 条目排出主动召回: 被换代压制时退出排名
        // 仅当 revive 后(metadata._superseded 清除)才恢复参与
        // 注: 记忆池(pool)里的副本不携带 metadata, 用 content 集合兜底过滤
        const supersededContents = new Set(
            this.longTerm
                .filter(m => m.metadata && m.metadata._superseded === SUPERSEDE_STATUS.SUPERSEDED)
                .map(m => m.content)
                .filter(Boolean)
        );
        const rankedOut = uniq.filter(x => {
            if (x.metadata && x.metadata._superseded === SUPERSEDE_STATUS.SUPERSEDED) return false;
            if (x.content && supersededContents.has(x.content)) return false;
            return true;
        });
        // 权限分级 + 分段衰减排序 + 截断
        return decorateRecall(rankedOut, { topN });
    }

    /**
     * 挂载酒馆生成前钩子: autoInject 开启时自动携带【记忆】块
     * 在 core 创建后调用一次, 后台持续生效 (无需打开记忆 App)
     */
    attachPromptHook() {
        // [v2.82.0] 幂等 guard（本仓六处 prompt 钩子里唯一缺的一处）。
        //   实测口径：health / peek / playbook / time-env 四处都是
        //   `if (this._hooked) return ...` 先判后挂，唯独 MemoryCore 没有 ——
        //   重复调用会往 eventSource 上叠第二个一模一样的 GENERATE_BEFORE_COMBINE_PROMPTS
        //   监听器，而 eventSource 是宿主级长期对象、这些监听器**没有解绑出口**，
        //   叠上去就永久留着 → 每次生成会把同一份【记忆】块注入两次。
        //   当前调用点唯一（index.js loadCoreModules 内，且该函数有 modulesLoaded
        //   早返回），故属**潜伏**形态而非现行故障 —— 但守卫的缺失本身就是
        //   与另四处的不一致，且 v2.54/v2.56 两轮修的正是「guard 位置/缺失」这一类。
        //   语义与 time-env 对齐：已挂过则直接返回 true（幂等）。
        if (this._hooked) return true;
        try {
            const context = window.SillyTavern?.getContext?.();
            const eventSource = context?.eventSource;
            const event_types = context?.event_types;
            if (!eventSource || !event_types || !event_types.GENERATE_BEFORE_COMBINE_PROMPTS) return false;
            eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, (payload) => {
                try {
                    // [RB] 桥协调注入生效时本地注入让位 (防双注入打架)
            try { if (window.VirtualPhone?.lonshaBridge?.isCoordinated) return; } catch (e) {}
            if (!this.config.autoInject || !payload || !Array.isArray(payload.prompt)) return;
                    const directive = this.buildPromptDirective(this._recentTexts(4));
                    if (directive) payload.prompt.push({ role: 'system', content: directive });
                } catch (e) { /* 静默 */ }
            });
            this._hooked = true;   // 仅在真的挂上之后置位（先置位会让失败静默且不可重试）
            return true;
        } catch (e) {
            console.warn('[MemoryCore] prompt 钩子挂载失败:', e);
            return false;
        }
    }

    _recentTexts(n) {
        try {
            const ctx = this.storage?.getContext?.();
            const chat = ctx?.chat;
            if (!Array.isArray(chat)) return [];
            return chat.slice(-n * 2).map(m => String(m?.mes ?? m?.content ?? '')).filter(Boolean);
        } catch (e) { return []; }
    }

    /**
     * 生成注入 prompt 的【记忆】块 (纯本地, 无 LLM)
     * @param recentTexts 最近消息文本 (user/ai 交替), 用于相关性召回
     */
    buildPromptDirective(recentTexts = []) {
        const total = this.longTerm.length + this.shortTerm.length;
        if (total === 0 && !this.pool.getStats().perception) return '';

        // 用最近上下文做召回锚点
        const anchor = (recentTexts || []).slice(-4).join(' ');
        let items = this.recall(anchor, this.config.injectTopN);
        // 召回不足时补最新记忆 (保证近期事件不丢)
        if (items.length < 3) {
            const newest = [...this.longTerm].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 3)
                .map(m => ({ layer: 'long-term', content: m.content, _score: 0.3, importance: m.importance }));
            const have = new Set(items.map(x => x.content));
            items = items.concat(newest.filter(n => !have.has(n.content)));
        }
        if (!items.length) return '';

        // 注入过滤: 仅联想(associate-only)级别不注入给模型陈述, 只作内部参考
        const injectItems = items.filter(it => it._permission !== RECALL_PERMISSION.ASSOCIATE);
        if (!injectItems.length) return '';

        let block = '【角色的长期记忆库 — 以下是角色在此聊天中沉淀的真实经历, 引用时须自然, 不得虚构】';
        const prem = this.pool.pool.premise;
        if (prem && prem.text) block += '\n◆ 背景前提: ' + prem.text;
        block += '\n◆ 相关记忆片段:';
        for (const it of injectItems.slice(0, this.config.injectTopN)) {
            const permTag = it._permission === RECALL_PERMISSION.CITE ? '' : (it._permission === RECALL_PERMISSION.CAUTIOUS ? ' ~' : '');
            block += '\n- ' + it.content.replace(/\s+/g, ' ').slice(0, 160) + permTag;
        }
        block += '\n◆ 使用规则: 记忆与当前剧情冲突时以剧情为准; 记忆片段可触发角色的情绪反应, 但不得机械复读原文; 总引用不超过3条, 保持对话自然; 带 ~ 标记的记忆若要引用须用「好像记得…」等留有余地口吻。';
        return block;
    }

    // ---------------- [RA] 楼层失效 (重写/swipe/回填覆盖时调用) ----------------
    /**
     * 把 >= floor 的记忆条目按楼层锚点整批失效:
     *  - longTerm/shortTerm 中 entry.floor >= floor 的条目删除 (编辑中间楼层 → 后续楼层记忆一并失效, 同 baibai pruneBrokenComps 语义)
     *  - 记忆池 temporal/perception/spatial 中 metadata.floor >= floor 的同步删除
     * @returns {number} 删除条数
     */
    invalidateFloorAt(floor, swipe = null) {
        try {
            // [v3.3.0] 先过取值门（同族收口）。修前 `Number(floor)` 把「没给」读成第 0 楼，
            //   而 `Number(f) >= 0` **恒真** ⇒ 一次误调用清空**整份**记忆
            //   （实测：6 条全被清掉，只剩 floor=null 那条）。0 是合法楼层，判开是双向的。
            const d0 = floorOrNull(floor);
            if (d0 === null) return 0;
            let n = 0;
            const hit = (f) => { const f0 = floorOrNull(f); return f0 !== null && f0 >= d0; };
            this.longTerm = this.longTerm.filter(m => { if (hit(m.floor)) { n++; return false; } return true; });
            this.shortTerm = this.shortTerm.filter(m => { if (hit(m.floor)) { n++; return false; } return true; });
            const pool = this.pool?.pool;
            if (pool) {
                for (const key of ['temporal', 'perception', 'spatial']) {
                    const arr = pool[key];
                    if (Array.isArray(arr)) {
                        const before = arr.length;
                        pool[key] = arr.filter(m => !(m?.metadata && hit(m.metadata.floor)));
                        n += before - pool[key].length;
                    }
                }
            }
            if (n > 0) this._save(true);
            return n;
        } catch (e) { return 0; }
    }

    // ---------------- [RA] 手动收藏 ----------------
    /** 收藏/取消收藏一条长期记忆: pinned 条目永不参与衰减淘汰, 且注入时优先 */
    pin(memoryId, on = true) {
        const m = this.longTerm.find(x => x.id === memoryId);
        if (!m) return false;
        if (on) { m.pinned = true; m.pinnedBy = 'user'; }
        else { delete m.pinned; delete m.pinnedBy; }
        this._save(true);
        return true;
    }

    // ---------------- 统计 ----------------
    getStats() {
        const longStats = this.longTerm.map(m => calculateDecayScore(m)).reduce((a, b) => a + b, 0);
        return {
            longTerm: this.longTerm.length,
            shortTerm: this.shortTerm.length,
            pool: this.pool.getStats(),
            avgDecayScore: this.longTerm.length ? +(longStats / this.longTerm.length).toFixed(2) : 0,
            stats: { ...this.stats },
            config: { ...this.config }
        };
    }

    /** 时间线视图: 长期记忆按时间倒序 */
    getTimeline(limit = 60) {
        return [...this.longTerm]
            .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
            .slice(0, limit);
    }

    clear() {
        this.longTerm = [];
        this.shortTerm = [];
        this.pool.clear();
        this.stats = { consolidated: 0, archived: 0, lastSleep: null };
        this.pendingMemoryBlock = null;
        /* [v3.80.0 · 缝入 A2] 「清全部数据」连跨卡桶一起清：它与 storage.clearAllData()
         *   同一语义（连全局设置都清），留着跨卡桶会让用户以为清干净了。
         *   「清当前数据」走 clearCurrentChat()，那里**不动**跨卡桶 —— 跨卡层正是
         *   为了不被会话边界切碎才存在的。两者处置相反，故不共用一条实现。 */
        this.clearShared();
        this._save();
    }

    /** 切换会话时重载记忆数据，防止跨聊天串味 */
    reload() {
        if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
        this.longTerm = [];
        this.shortTerm = [];
        this.stats = { consolidated: 0, archived: 0, lastSleep: null };
        this.pool = new MemoryPool();
        this.pool.initialize();
        this._load();
        this._dataVersion = (this._dataVersion || 0) + 1;
    }

    clearCurrentChat() {
        try { this.storage?.remove?.(this.KEY); } catch (e) {}
        if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
        this.longTerm = [];
        this.shortTerm = [];
        this.pool.clear();
        this._dataVersion = (this._dataVersion || 0) + 1;
    }
}

export default MemoryCore;
