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
import { GraphBridge } from './graph-bridge.js';
import { AwakeningEngine } from './awakening-engine.js';

export class MemoryCore {
    constructor(storage) {
        this.storage = storage;
        this.KEY = 'memory_core_v1';

        this.emotion = new EmotionTagger();
        this.pool = new MemoryPool();
        // LonSha 知识图谱联动桥 (软降级: 未装插件时桥可用但返回空态)
        this.graph = new GraphBridge(storage);
        try { this.graph.probe(); } catch (e) { /* 忽略 */ }
        // 记忆唤醒引擎 (昨日感受/情绪结晶/回声/错记)
        this.awakening = new AwakeningEngine(this);

        // 状态
        this.longTerm = [];      // 巩固后的长期记忆
        this.shortTerm = [];     // 短期缓冲 (待巩固)
        this.stats = { consolidated: 0, archived: 0, lastSleep: null };
        this.config = {
            shortTermCapacity: 60,
            autoInject: false,      // 是否自动携带记忆块进入 prompt
            injectTopN: 6,          // 注入前 N 条最相关记忆
            minImportance: 4,       // 采集门槛 (低阈值保证玩家短句也能沉淀)
            sleepEveryMessages: 24, // 每 N 条消息触发一次睡眠巩固
            echoEnabled: false,        // 记忆回声 (需演技, 弱模型默认关)
            misrememberEnabled: false, // 遗忘错记 (需演技, 弱模型默认关)
            llmSummaryEnabled: false   // LLM 增强摘要 (可选, 弱模型保持关闭; 开则调宿主静默生成)
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

    _save() {
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
        this._save();
    }

    // ---------------- 采集 ----------------
    /**
     * 记录一条对话到短期记忆
     * @param role 'user' | 'ai'
     * @param text 消息正文
     * @param context 可选 { place, senses, emotion }
     */
    record(role, text, context = {}) {
        const content = String(text || '').replace(/\s+/g, ' ').trim();
        if (!content) return null;

        const emotion = this.emotion.analyze(content); // 仅作元数据存储 (UI/档案用), 不参与采集评分
        // 重要性启发: 纯规则 (长度 + 角色权重 + 剧情关键词), 不依赖情感判断 —— 弱模型友好
        let importance = 3;
        if (content.length >= 30) importance += 1;
        if (content.length >= 60) importance += 1;
        if (content.length >= 120) importance += 1;
        if (role === 'ai') importance += 1;
        // 剧情关键词加权: 约定/承诺/地点/人物等实义词弥补情感盲区 (平实但重要的推进)
        const PLOT_KEYWORDS = ['约定', '答应', '承诺', '说好', '下次', '以后', '记得', '忘记', '别忘',
          '面馆', '海边', '河边', '学校', '家', '巷子', '车站', '公园', '咖啡馆', '广场',
          '喜欢', '讨厌', '爱', '恨', '想', '愿意', '不肯', '生日', '礼物', '秘密', '发誓',
          '第一次', '最后一次', '永远', '一定', '保证', '守约'];
        for (const kw of PLOT_KEYWORDS) {
            if (content.includes(kw)) { importance += 1; break; }
        }
        // 疑问句中的关键信息 (你/我 + 动词)
        if (content.includes('你') && /(?:会|能|愿意|要|想|去|来|等|答应|记得)/.test(content)) importance += 1;
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
                        metadata: { importance: m.importance, sourceRole: m.role }
                    });
                }
                this.pool.addTemporal(m.content, {
                    timestamp: m.createdAt,
                    emotion: m.emotion,
                    metadata: { importance: m.importance }
                });
                if (m.place) this.pool.addSpatial(m.content, { place: m.place, metadata: { importance: m.importance } });
            }
        }

        this.shortTerm = [];
        this.stats.consolidated += result.consolidated.length;
        this.stats.archived += result.archived.length;
        this.stats.lastSleep = new Date().toISOString();

        // 联动: 睡眠巩固后生成昨日感受 (情绪聚合结晶)
        try { this.awakening.sleep(); } catch (e) { /* 忽略 */ }

        // 低分记忆清理 (防膨胀): 长期记忆上限 400 条, 超限按衰减分淘汰非 pinned/permanent
        const cap = 400;
        if (this.longTerm.length > cap) {
            const scored = this.longTerm.map(m => ({ m, s: calculateDecayScore(m) }));
            scored.sort((a, b) => b.s - a.s);
            this.longTerm = scored.slice(0, cap).map(x => x.m);
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
     * 图谱级召回: 先走本地记忆, 再叠加 LonSha 知识图谱关联记忆
     * @returns { phone: [], graph: [] }
     */
    graphRecall(query, topN = 6) {
        const phone = this.recall(query, topN);
        let graph = [];
        try {
            if (this.graph && this.graph.available) {
                graph = this.graph.search(query, topN);
            }
        } catch (e) { /* 软降级 */ }
        return { phone, graph };
    }

    /**
     * B2: 可选 LLM 增强摘要 (默认关闭)
     * 通过酒馆静默生成获取高质量概括, 失败时静默回退到纯本地摘要
     * @param messages 消息数组 [{role:'user'|'ai', content}]
     * @returns { summary, source: 'llm'|'local' }
     */
    async llmSummarize(messages) {
        const local = buildMemorySummary(messages, {});
        if (!this.config.llmSummaryEnabled) return { summary: local, source: 'local' };
        if (!messages || !messages.length) return { summary: '', source: 'local' };
        try {
            const ctx = window.SillyTavern?.getContext?.();
            const quiet = ctx?.generateQuietPrompt;
            if (typeof quiet !== 'function') return { summary: local, source: 'local' };
            const raw = messages.map(m => (m.role === 'user' ? '我' : '角色') + ':' + String(m.content || '').slice(0, 160)).join('\n');
            const prompt = '用一句话客观概括这段对话发生了什么、关系有何变化（30-60字，只输出摘要本身，禁止照抄原文）：\n' + raw;
            const out = await quiet({ quietPrompt: prompt, quietToLoud: false, skipWIAN: true });
            const text = String(out || '').replace(/^["“「]+/, '').replace(/["”」]+$/, '').trim();
            if (text.length >= 10 && text.length <= 200) return { summary: text, source: 'llm' };
            return { summary: local, source: 'local' };
        } catch (e) {
            return { summary: local, source: 'local' };
        }
    }
    /** 把手机高价值记忆推入 LonSha 图谱 (手动/定时触发) */
    syncToGraph(options = {}) {
        try {
            if (!this.graph || !this.graph.available) return { ok: false, reason: 'lonsha-unavailable' };
            const n = this.graph.pushPhoneMemories(options);
            return { ok: true, pushed: n };
        } catch (e) {
            return { ok: false, reason: e.message };
        }
    }

    /**
     * 生成注入 prompt 的【记忆】块 (纯本地, 无 LLM)
     *  ① 常驻层: pinned / permanent 铁律记忆 (必注入)
     *  ② 相关层: 记忆池 + 长期关键词混合召回
     *  ③ 近期层: 最新沉淀 (时间感锚点)
     *  ④ 图谱层: LonSha 知识图谱关联记忆
     * 回声/错记由 config.echoEnabled / misrememberEnabled 控制, 默认关闭
     * @param recentTexts 最近消息文本 (user/ai 交替), 用于相关性召回
     */
    buildPromptDirective(recentTexts = []) {
        const total = this.longTerm.length + this.shortTerm.length;
        if (total === 0 && !this.pool.getStats().perception) return '';

        const anchor = (recentTexts || []).slice(-4).join(' ');
        const seen = new Set();
        const push = (arr, item, tier) => {
            const key = String(item.content || '').slice(0, 40);
            if (!key || seen.has(key)) return;
            seen.add(key);
            arr.push({ ...item, _tier: tier });
        };

        // ① 常驻层: pinned / permanent (铁律记忆, 必注入)
        const pinned = [];
        for (const m of this.longTerm) {
            const meta = m.metadata || {};
            if (meta.pinned || meta.type === 'permanent') {
                push(pinned, { content: m.content, layer: 'pinned' }, 'pinned');
            }
            if (pinned.length >= 3) break;
        }

        // ② 相关层: 混合召回 (记忆池三级触发 + 长期关键词)
        const relevant = [];
        for (const it of this.recall(anchor, this.config.injectTopN)) push(relevant, it, 'relevant');

        // ④ 近期层: 最新沉淀 (保证近期事件不丢)
        const recent = [];
        const newest = [...this.longTerm].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        for (const m of newest.slice(0, 4)) {
            push(recent, { content: m.content, layer: 'recent' }, 'recent');
        }

        if (!pinned.length && !relevant.length && !recent.length) return '';

        let block = '【角色的长期记忆库 — 以下是角色在此聊天中沉淀的真实经历, 引用时须自然, 不得虚构】';
        const prem = this.pool.pool.premise;
        if (prem && prem.text) block += '\n◆ 背景前提: ' + prem.text;

        if (pinned.length) {
            block += '\n◆ 铁律记忆 (角色绝不会忘记, 可主动提起):';
            for (const it of pinned) block += '\n- ' + String(it.content).replace(/\s+/g, ' ').slice(0, 160);
        }
        if (relevant.length) {
            block += '\n◆ 与当前情境相关的片段:';
            for (const it of relevant.slice(0, this.config.injectTopN)) block += '\n- ' + String(it.content).replace(/\s+/g, ' ').slice(0, 160);
        }
        if (recent.length) {
            block += '\n◆ 最近发生 (时间感锚点):';
            for (const it of recent.slice(0, 3)) block += '\n- ' + String(it.content).replace(/\s+/g, ' ').slice(0, 140);
        }

        // ⑤ 图谱层: LonSha 知识图谱关联记忆 (软降级)
        try {
            if (this.graph && this.graph.available && anchor) {
                const gb = this.graph.buildRecallBlock(anchor, 3);
                if (gb) block += '\n' + gb;
            }
        } catch (e) {}

        block += '\n◆ 使用规则: 记忆与当前剧情冲突时以剧情为准; 铁律记忆可自然提及, 其余按情境择机带出; 不得机械复读原文; 总引用不超过3条, 保持对话自然。';

        // 记忆回声 / 遗忘错记: 需模型有演技, 默认关闭 (config 可开)
        if (this.config.echoEnabled) {
            try {
                const echo = this.awakening.maybeEcho();
                if (echo) block += '\n【记忆回声】角色此刻突然想起，自然带出：\n- ' + String(echo.content).slice(0, 120);
            } catch (e) {}
        }
        if (this.config.misrememberEnabled) {
            try {
                const mis = this.awakening.maybeMisremember();
                if (mis) block += '\n【记忆偏差】细节可能记错：\n- ' + String(mis.distorted).slice(0, 120);
            } catch (e) {}
        }
        return block;
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

    /**
     * 情感史曲线数据: 按时间聚合长期记忆的 valence/arousal
     * @returns [{time, valence, arousal, label, content}]
     */
    getEmotionHistory(limit = 60) {
        return [...(this.longTerm || [])]
            .filter(m => m.emotion && (m.emotion.valence !== undefined || m.emotion.arousal !== undefined))
            .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
            .slice(-limit)
            .map(m => ({
                time: m.createdAt,
                valence: m.emotion.valence ?? 0.5,
                arousal: m.emotion.arousal ?? 0.5,
                label: m.emotion.label || '中性',
                content: String(m.content || '').slice(0, 60)
            }));
    }

    /** 感官回忆归档 (透传记忆池) */
    getSensoryArchive() { return this.pool.getSensoryArchive(); }
    /** 场景标签聚合 (透传记忆池) */
    getSceneTags() { return this.pool.getSceneTags(); }

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
        this.longTerm = [];
        this.shortTerm = [];
        this.pool.clear();
    }
}

export default MemoryCore;
