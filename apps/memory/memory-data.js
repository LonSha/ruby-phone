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

export class MemoryCore {
    constructor(storage) {
        this.storage = storage;
        this.KEY = 'memory_core_v1';

        this.emotion = new EmotionTagger();
        this.pool = new MemoryPool();

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
        let content = String(text || '');
        // [芋圆] 采集前清洗: 剔除 horae 等插件注入的状态块/HTML/成对块/裸K=V行, 避免把系统状态当记忆采进去
        try { content = cleanFloorForSummary(content); } catch (e) { /* 清洗失败保留原文 */ }
        content = content.replace(/\s+/g, ' ').trim();
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

        if (importance < this.config.minImportance) return null; // 低价值消息不采集

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
        this._save();
        return { consolidated: result.consolidated.length, patterns: result.patterns.length };
    }

    // ---------------- 检索与注入 ----------------
    /**
     * 混合检索: 记忆池三级触发 + 长期记忆关键词检索
     * @returns [{layer, content, _score, meta}]
     */
    recall(query, topN = 6) {
        const out = [];
        // 1) 记忆池触发 (感知优先)
        const poolRes = this.pool.trigger(query);
        poolRes.matched.forEach(m => out.push({ layer: m._layer || 'pool', content: m.content, _score: m._score, emotion: m.emotion || null }));
        // 2) 长期记忆关键词
        const longRes = searchMemories(this.longTerm, query, {});
        longRes.forEach(m => out.push({ layer: 'long-term', content: m.content, _score: m._score, importance: m.importance, emotion: m.emotion || null }));
        // 去重 + 排序 + 截断
        const seen = new Set();
        const uniq = out.filter(x => { if (!x.content || seen.has(x.content)) return false; seen.add(x.content); return true; });
        uniq.sort((a, b) => (b._score || 0) - (a._score || 0));
        return uniq.slice(0, topN);
    }

    /**
     * 挂载酒馆生成前钩子: autoInject 开启时自动携带【记忆】块
     * 在 core 创建后调用一次, 后台持续生效 (无需打开记忆 App)
     */
    attachPromptHook() {
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

        let block = '【角色的长期记忆库 — 以下是角色在此聊天中沉淀的真实经历, 引用时须自然, 不得虚构】';
        const prem = this.pool.pool.premise;
        if (prem && prem.text) block += '\n◆ 背景前提: ' + prem.text;
        block += '\n◆ 相关记忆片段:';
        for (const it of items.slice(0, this.config.injectTopN)) {
            block += '\n- ' + it.content.replace(/\s+/g, ' ').slice(0, 160);
        }
        block += '\n◆ 使用规则: 记忆与当前剧情冲突时以剧情为准; 记忆片段可触发角色的情绪反应, 但不得机械复读原文; 总引用不超过3条, 保持对话自然。';
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
            let n = 0;
            const hit = (f) => f !== null && f !== undefined && Number(f) >= Number(floor);
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
        this._save();
    }

    clearCurrentChat() {
        try { this.storage?.remove?.(this.KEY); } catch (e) {}
        if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
        this.longTerm = [];
        this.shortTerm = [];
        this.pool.clear();
    }
}

export default MemoryCore;
