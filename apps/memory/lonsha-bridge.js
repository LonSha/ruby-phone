/* ========================================================
 *  LonSha 记忆引擎 ↔ RubyPhone 双向数据桥 (LonShaBridge) v2
 *
 *  双向通道:
 *   ① 回填 (LonSha → RubyPhone): LLM 笔录摘要/事件/关系 → 手机记忆库 (pinned 保护)
 *   ② 召回 (RubyPhone → LonSha): BM25 稀疏检索手机记忆 (替代旧 includes 匹配)
 *   ③ 注入协调: 桥健在时 RubyPhone 本地注入自动退位, 由桥把手机记忆注入到最新楼层 (Depth 0)
 *      避免与 LonSha 简报双注入打架
 *   ④ 楼层生命周期: LonSha 每楼提交后盖章 → 删楼/重生成时两端同步回滚
 *
 *  零外部依赖; 实例挂到 window.VirtualPhone.lonshaBridge
 * ======================================================== */

export const LONSHA_BRIDGE_KEY = 'lonsha_bridge_v1';

// ---------------- [RB] 轻量 BM25 (中文 bigram + 英文分词, 与 lonsha 同参) ----------------
class BridgeBM25 {
    constructor() { this.docs = []; this.df = new Map(); this.N = 0; this._tCache = new Map(); }
    static tokenize(text) {
        const out = [];
        const s = String(text || '');
        const en = s.toLowerCase().match(/[a-z0-9]+/g) || [];
        for (const w of en) out.push(w);
        const cn = s.replace(/[^\u4e00-\u9fa5]+/g, ' ');
        for (const chunk of cn.split(/\s+/)) {
            if (!chunk) continue;
            if (chunk.length === 1) { out.push(chunk); continue; }
            for (let i = 0; i < chunk.length - 1; i++) out.push(chunk.slice(i, i + 2));
        }
        return out;
    }
    _tokens(text) {
        const key = String(text || '');
        let t = this._tCache.get(key);
        if (!t) { t = BridgeBM25.tokenize(key); this._tCache.set(key, t); }
        return t;
    }
    rebuild(docs) {
        this.docs = (docs || []).map(d => ({ id: d.id, text: d.text, floor: d.floor ?? null, storyTime: d.storyTime || null, source: d.source || null, tf: new Map(), _dl: 0 }));
        this.df.clear();
        this.N = this.docs.length;
        for (const d of this.docs) {
            const toks = this._tokens(d.text);
            d._dl = toks.length;
            for (const t of toks) d.tf.set(t, (d.tf.get(t) || 0) + 1);
            for (const t of d.tf.keys()) this.df.set(t, (this.df.get(t) || 0) + 1);
        }
    }
    add(doc) {
        if (!doc?.id) return;
        const i = this.docs.findIndex(d => d.id === doc.id);
        if (i >= 0) this.docs.splice(i, 1);
        const d = { id: doc.id, text: doc.text, floor: doc.floor ?? null, storyTime: doc.storyTime || null, source: doc.source || null, tf: new Map(), _dl: 0 };
        const toks = this._tokens(d.text);
        d._dl = toks.length;
        for (const t of toks) d.tf.set(t, (d.tf.get(t) || 0) + 1);
        for (const t of d.tf.keys()) this.df.set(t, (this.df.get(t) || 0) + 1);
        this.docs.push(d);
        this.N = this.docs.length;
    }
    search(query, topK = 5) {
        if (!this.N || !query) return [];
        const k1 = 1.2, b = 0.75;
        const avgdl = this.docs.reduce((a, d) => a + (d._dl || 0), 0) / (this.N || 1);
        const qts = this._tokens(query);
        const seenQ = new Set();
        const scores = [];
        for (const d of this.docs) {
            let s = 0;
            for (const t of qts) {
                if (seenQ.has(t)) continue;
                seenQ.add(t);
                const f = d.tf.get(t);
                if (!f) continue;
                const n = this.df.get(t) || 0;
                const idf = Math.log(1 + (this.N - n + 0.5) / (n + 0.5));
                s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * ((d._dl || 1) / (avgdl || 1))));
            }
            seenQ.clear();
            if (s > 0) scores.push({ id: d.id, text: d.text, floor: d.floor, storyTime: d.storyTime, source: d.source, score: s });
        }
        scores.sort((a, b2) => b2.score - a.score);
        return scores.slice(0, topK);
    }
}

export class LonShaBridge {
    constructor(storage, memoryCore) {
        this.storage = storage;
        this.memoryCore = memoryCore;
        this.enabled = true;
        // [RB] 注入协调: true = 由桥接管手机记忆注入, memoryCore.autoInject 自动退位
        this.coordinated = true;
        this.stats = { backfillCount: 0, injectCount: 0, rollbacks: 0, floorsIngested: 0, lastBackfill: null };
        this._bm25 = new BridgeBM25();
        this._bm25Dirty = true;
        this._load();
        this._promoteInjection();
    }
    // ---------------- 配置持久化 (挂 extensionSettings) ----------------
    _load() {
        try {
            const raw = this.storage?.get?.(LONSHA_BRIDGE_KEY);
            if (raw) {
                const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
                if (typeof d.enabled === 'boolean') this.enabled = d.enabled;
                if (typeof d.coordinated === 'boolean') this.coordinated = d.coordinated;
                if (d.stats) this.stats = { ...this.stats, ...d.stats };
            }
        } catch (e) { /* 忽略 */ }
    }
    _save() {
        try {
            this.storage?.set?.(LONSHA_BRIDGE_KEY, { enabled: this.enabled, coordinated: this.coordinated, stats: this.stats, updatedAt: new Date().toISOString() });
        } catch (e) { /* 忽略 */ }
    }
    /** [RB] 协调注入生效时, 让 MemoryCore 本地 prompt 钩子退位 (避免双注入打架) */
    _promoteInjection() {
        try {
            if (this.enabled && this.coordinated && this.memoryCore?.config) {
                if (this.memoryCore.config.autoInject) {
                    this.memoryCore.config.autoInject = false;
                    this.memoryCore._save(true);
                    console.log('[LonShaBridge] ✓ 注入协调: 手机本地注入已让位给桥 (coordinated)');
                }
            }
        } catch (e) { /* 忽略 */ }
    }
    _rebuildIndex() {
        try {
            const docs = [];
            for (const m of (this.memoryCore?.longTerm || [])) {
                if (m?.content) docs.push({ id: m.id, text: m.content, floor: m.floor ?? null, storyTime: m.storyTime || null, source: 'long' });
            }
            for (const m of (this.memoryCore?.shortTerm || [])) {
                if (m?.content) docs.push({ id: m.id, text: m.content, floor: m.floor ?? null, storyTime: m.storyTime || null, source: 'short' });
            }
            const pool = this.memoryCore?.pool?.pool;
            if (pool) {
                for (const key of ['temporal', 'perception', 'spatial']) {
                    let i = 0;
                    for (const m of (pool[key] || [])) {
                        if (m?.content) docs.push({ id: key + '_' + (m.id || (i++)), text: m.content, floor: m?.metadata?.floor ?? null, storyTime: null, source: 'pool:' + key });
                    }
                }
            }
            this._bm25.rebuild(docs);
            this._bm25Dirty = false;
        } catch (e) { /* 索引失败降级为空 */ }
    }
    _ensureIndex() {
        if (this._bm25Dirty) this._rebuildIndex();
    }

    // ---------------- ① 回填: LonSha 提取结果 → RubyPhone 记忆库 ----------------
    /**
     * 由 LonSha 插件在每轮提取完成后调用。
     * @param {Object} extracted LonSha 提取结果 { characters, events, relationships, summary, ... }
     */
    backfill(extracted) {
        if (!this.enabled || !this.memoryCore || !extracted) return;
        try {
            // 摘要 → 长期记忆 (笔录式, 治"原文切片"的核心); [RA] pinned: 不参与衰减淘汰
            const summary = String(extracted.summary || '').trim();
            if (summary.length >= 15) {
                const meta = { pinned: true };
                try {
                    const stm = window.VirtualPhone?.timeManager?.getCurrentStoryTime?.();
                    if (stm?.date && !stm.isReal) meta.storyTime = String(stm.date);
                } catch (e) {}
                this.memoryCore.record('ai', '[剧情] ' + summary, { tags: this._tags(extracted) }, meta);
            }

            // 事件 → 记忆池时间层
            const events = Array.isArray(extracted.events) ? extracted.events : [];
            for (const ev of events.slice(0, 6)) {
                const desc = typeof ev === 'string' ? ev : (ev.description || ev.type || '');
                if (String(desc).length >= 8) {
                    this.memoryCore.pool.addTemporal('[事件] ' + String(desc), {
                        timestamp: new Date().toISOString(),
                        metadata: { source: 'lonsha', importance: (ev && ev.importance) || 6, pinned: true }
                    });
                }
            }
            // 关系 → 记忆池感知层 (关系是角色的主观感知)
            const rels = Array.isArray(extracted.relationships) ? extracted.relationships : [];
            for (const r of rels.slice(0, 6)) {
                const from = r.from || '', to = r.to || '', type = r.type || '';
                if (from && to) {
                    this.memoryCore.pool.addPerception(`[关系] ${from} ${type} ${to}`, {
                        metadata: { source: 'lonsha', importance: 7, pinned: true }
                    });
                }
            }
            // 角色 → 背景前提 (累积登场角色, 供记忆块引用)
            const chars = Array.isArray(extracted.characters) ? extracted.characters : [];
            if (chars.length) {
                const premise = this.memoryCore.pool.pool.premise;
                const known = premise ? String(premise.text || '') : '';
                const merged = known ? known + '、' + chars.join('、') : chars.join('、');
                const uniq = Array.from(new Set(merged.split(/[、,，]/).map(s => s.trim()).filter(Boolean))).slice(0, 40).join('、');
                this.memoryCore.pool.addPremise('登场角色: ' + uniq);
            }
            this.stats.backfillCount++;
            this.stats.lastBackfill = new Date().toISOString();
            this._bm25Dirty = true;
            this._save();
            if (window.VirtualPhone?._lonshaDebug) {
                console.log('[LonShaBridge] 回填完成', { summary: summary.length, events: events.length, rels: rels.length, chars: chars.length });
            }
        } catch (e) {
            console.warn('[LonShaBridge] 回填失败:', e);
        }
    }
    _tags(extracted) {
        const out = [];
        if (Array.isArray(extracted.characters)) out.push(...extracted.characters.slice(0, 6));
        return out.slice(0, 8);
    }

    // ---------------- ② 召回: RubyPhone 记忆库 → LonSha (BM25 稀疏检索) ----------------
    /**
     * 供 LonSha 插件在生成前召回时调用。[RB] 已升级为 BM25 稀疏检索
     * @returns [{content, score, layer, source:'rubyphone'}]
     */
    recall(queryText, topN = 5) {
        if (!this.enabled || !this.memoryCore) return [];
        try {
            this._ensureIndex();
            let res = null;
            if (this._bm25.N > 0) {
                // BM25 主通道: 分数归一到 0~1 近似区间
                res = this._bm25.search(String(queryText || ''), topN).map(r => ({
                    content: r.text,
                    score: Math.max(0.1, Math.min(1, r.score / 12)),
                    layer: r.source || 'bm25',
                    floor: r.floor
                }));
            }
            // 空结果兜底: 走 MemoryCore 内建混合检索 (池触发 + 关键词)
            if (!res || !res.length) {
                res = (this.memoryCore.recall(String(queryText || ''), topN) || []).map(r => ({
                    content: r.content, score: r._score || 0.5, layer: r.layer, floor: null
                }));
            }
            this.stats.injectCount++;
            return res;
        } catch (e) {
            console.warn('[LonShaBridge] 召回失败:', e);
            return [];
        }
    }

    // ---------------- ③ 注入协调: 桥接管手机记忆的注入位 ----------------
    /**
     * 生成前由 RubyPhone 调用 (替代 memoryCore.attachPromptHook 的本地注入)。
     * 把手机记忆注入到最新楼层 (Depth 0), 贴近正文, 与 LonSha 简报 (Depth 4) 分层。
     * @returns {boolean} 是否实际注入
     */
    applyCoordinatedInjection() {
        if (!this.enabled || !this.coordinated || !this.memoryCore) return false;
        try {
            const ctx = window.SillyTavern?.getContext?.();
            if (!ctx?.setExtensionPrompt) return false;
            // 复用 MemoryCore 的指令块构建 (含背景前提/相关记忆/使用规则)
            const directive = this.memoryCore.buildPromptDirective(
                this.memoryCore._recentTexts ? this.memoryCore._recentTexts(4) : []
            );
            if (!directive) {
                try { ctx.setExtensionPrompt('rubyphone_memory_coord', '', 1, 0); } catch (e) {}
                return false;
            }
            ctx.setExtensionPrompt('rubyphone_memory_coord', directive, 1, 0);
            this.stats.injectCount++;
            return true;
        } catch (e) {
            return false;
        }
    }
    /** 手机记忆是否由桥协调注入 (供设置面板显示状态) */
    get isCoordinated() { return !!(this.enabled && this.coordinated); }

    // ---------------- ④ 楼层生命周期: 两端同步回滚 ----------------
    /**
     * LonSha 每楼提取提交后调用: 盖章记录该楼已被两端共同消费。
     * 同时清掉 > floor 的残留记忆 (保险丝: 正常情况下 RA 采集点已即时失效)。
     */
    onChatChanged() {
        this._bm25Dirty = true;
    }
    onFloorCommitted(floor) {
        try {
            const f = Number(floor);
            if (!Number.isFinite(f)) return;
            try { this.memoryCore?.invalidateFloorAt?.(f + 1); } catch (e) {}
            this.stats.floorsIngested++;
            if ((this.stats.floorsIngested & 7) === 0) this._save();   // 每 8 楼落一次盘
        } catch (e) { /* 忽略 */ }
    }
    /**
     * 删楼/回滚时由 RubyPhone MESSAGE_DELETED 或 LonSha rollbackFloor 调用。
     * 两端都调是幂等的: 各自只清自己属于该楼(及之后)的记忆。
     */
    onFloorRollback(floor) {
        try {
            const n = this.memoryCore?.invalidateFloorAt?.(Number(floor));
            if (n > 0) {
                this.stats.rollbacks++;
                this._bm25Dirty = true;
                this._save();
                if (window.VirtualPhone?._lonshaDebug) console.log(`[LonShaBridge] 楼层 ${floor} 回滚: 清除 ${n} 条手机记忆`);
            }
        } catch (e) { /* 忽略 */ }
    }

    // ---------------- 状态 ----------------
    getStats() {
        return {
            ...this.stats,
            enabled: this.enabled,
            coordinated: this.coordinated,
            bm25Docs: this._bm25.N,
            longTerm: this.memoryCore?.longTerm?.length || 0
        };
    }
    setEnabled(on) {
        this.enabled = !!on;
        this._save();
        if (this.enabled) {
            this._promoteInjection();
        } else if (this.memoryCore?.config) {
            // 关闭桥时把注入权还给本地引擎
            this.memoryCore.config.autoInject = true;
            this.memoryCore._save(true);
        }
    }
    setCoordinated(on) {
        this.coordinated = !!on;
        this._save();
        if (this.coordinated) {
            this._promoteInjection();
        } else if (this.memoryCore?.config) {
            this.memoryCore.config.autoInject = true;
            this.memoryCore._save(true);
        }
    }
}
/** 幂等挂载: RubyPhone 初始化完成后创建单例 */
export function mountLonShaBridge(storage, memoryCore) {
    if (!window.VirtualPhone) window.VirtualPhone = {};
    if (window.VirtualPhone.lonshaBridge) return window.VirtualPhone.lonshaBridge;
    window.VirtualPhone.lonshaBridge = new LonShaBridge(storage, memoryCore);
    console.log('[LonShaBridge] ✓ 已挂载 v2 (双向桥 + BM25 + 注入协调 + 楼层回滚)');
    return window.VirtualPhone.lonshaBridge;
}