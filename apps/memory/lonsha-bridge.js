import { captureSessionToken, guardSessionWrite } from '../../config/session-gate.js';
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

/** [v3.3.0] 楼层取值门（删楼回滚族）：只认数字与非空数字字符串，其余如实 null。
 *  与 index.js 的 `stFloorOrNull`、`apps/place/place-data.js` 与 `config/*` 的 `numOrNull`
 *  同因同法 —— 本仓约定「各边界自持同口径门」，不跨层共享（避免 index.js ↔ apps 的循环依赖）。 */
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
    /** [v4.135.0 · V17-R3] 认知边界元数据保真：V16 四桶过滤靠 owner/character/scope 判定，
     *   此前 rebuild→search→recall 三层全丢这些字段 ⇒ 真实 BM25 主通道上防全知恒失效（假绿）。
     *   这里定义唯一提取器，所有索引/检索路径必须调它，不得各写一份。 */
    static cognitionMeta(m) {
        const o = m || {};
        return {
            character: o.character ?? null,
            owner: o.owner ?? null,
            scope: o.scope ?? null,
            knownBy: Array.isArray(o.knownBy) ? o.knownBy.slice() : null,
            knowledge: o.knowledge ?? null,
            origin: o.origin ?? null,
            tags: Array.isArray(o.tags) ? o.tags.slice() : null
        };
    }
    rebuild(docs) {
        this.docs = (docs || []).map(d => Object.assign({ id: d.id, text: d.text, floor: d.floor ?? null, storyTime: d.storyTime || null, source: d.source || null, tf: new Map(), _dl: 0 }, BridgeBM25.cognitionMeta(d)));
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
        const d = Object.assign({ id: doc.id, text: doc.text, floor: doc.floor ?? null, storyTime: doc.storyTime || null, source: doc.source || null, tf: new Map(), _dl: 0 }, BridgeBM25.cognitionMeta(doc));
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
            if (s > 0) scores.push(Object.assign({ id: d.id, text: d.text, floor: d.floor, storyTime: d.storyTime, source: d.source, score: s }, BridgeBM25.cognitionMeta(d)));
        }
        scores.sort((a, b2) => b2.score - a.score);
        return scores.slice(0, topK);
    }
}

const DEVICE_HOLOGRAPHIC_EVENTS_KEY = 'device_holographic_events_v1';
export class LonShaBridge {
    constructor(storage, memoryCore) {
        this.storage = storage;
        this.memoryCore = memoryCore;
        this.enabled = true;
        // [RB] 注入协调: true = 由桥接管手机记忆注入, memoryCore.autoInject 自动退位
        this.coordinated = true;
        this.stats = { backfillCount: 0, injectCount: 0, rollbacks: 0, floorsIngested: 0, lastBackfill: null };
        // [v4.135.0 · V17-R1] 记忆访问热表：被真正注入的手机记忆升温，下轮 BM25 名次前移（跨会话持久化）。
        this._resonanceHeat = {};
        // [v4.136.0 · V18-R1] 演化去重边表（跨会话持久化）：记录已被更高版本演化替代的旧记忆。
        this._pyramidEvolutionLinks = [];
        // [v4.137.0 · V20-R1] 全息双向共生总线消息通道与自主离线事件队列
        this._holographicBusEvents = [];
        this._bm25 = new BridgeBM25();
        this._bm25Dirty = true;
        // [RB] 懒检测基线: 追踪 memoryCore 数据版本戳与记忆池条目数, 捕获桥外写入路径
        this._seenVersion = -1;
        this._seenPoolCount = -1;
        this._load();
        this._holographicBusEvents = this._readHolographicEvents();
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
                if (d.resonanceHeat && typeof d.resonanceHeat === 'object') this._resonanceHeat = d.resonanceHeat;
                if (Array.isArray(d.pyramidEvolutionLinks)) this._pyramidEvolutionLinks = d.pyramidEvolutionLinks;
                // Legacy global events have no trustworthy chat identity; never import them into a chat.
            }
        } catch (e) { /* 忽略 */ }
    }
    _save() {
        try {
            this.storage?.set?.(LONSHA_BRIDGE_KEY, { enabled: this.enabled, coordinated: this.coordinated, stats: this.stats, resonanceHeat: this._resonanceHeat, pyramidEvolutionLinks: this._pyramidEvolutionLinks || [], updatedAt: new Date().toISOString() });
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
                if (m?.content) docs.push(Object.assign({ id: m.id, text: m.content, floor: m.floor ?? null, storyTime: m.storyTime || null, source: 'long' }, BridgeBM25.cognitionMeta(m)));
            }
            for (const m of (this.memoryCore?.shortTerm || [])) {
                if (m?.content) docs.push(Object.assign({ id: m.id, text: m.content, floor: m.floor ?? null, storyTime: m.storyTime || null, source: 'short' }, BridgeBM25.cognitionMeta(m)));
            }
            const pool = this.memoryCore?.pool?.pool;
            if (pool) {
                for (const key of ['temporal', 'perception', 'spatial']) {
                    let i = 0;
                    for (const m of (pool[key] || [])) {
                        if (m?.content) docs.push(Object.assign({ id: key + '_' + (m.id || (i++)), text: m.content, floor: m?.metadata?.floor ?? null, storyTime: null, source: 'pool:' + key }, BridgeBM25.cognitionMeta(m)));
                    }
                }
            }
            this._bm25.rebuild(docs);
            this._bm25Dirty = false;
            this._seenVersion = this.memoryCore?.dataVersion ?? -1;
            this._seenPoolCount = this._poolEntryCount();
        } catch (e) { /* 索引失败降级为空 */ }
    }
    /** [RB] 记忆池 temporal/perception/spatial 三层条目总数 (懒检测池内 add* 内存级变更) */
    _poolEntryCount() {
        try {
            const pool = this.memoryCore?.pool?.pool;
            if (!pool) return -1;
            let n = 0;
            for (const key of ['temporal', 'perception', 'spatial']) n += (pool[key] || []).length;
            return n;
        } catch (e) { return -1; }
    }
    _ensureIndex() {
        // 桥外写入路径(memoryCore.record/sleep/clear/reload 或 pool.add*)不经桥置 _bm25Dirty,
        // 通过版本戳 + 池条目数双信号懒检测, 任一漂移即重建, 保证 BM25 索引不陈旧。
        const ver = this.memoryCore?.dataVersion ?? -1;
        const poolCount = this._poolEntryCount();
        if (this._bm25Dirty || ver !== this._seenVersion || poolCount !== this._seenPoolCount) {
            this._rebuildIndex();
        }
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

    /** [v4.135.0 · V17-R] 访问热键唯一真源：召回加权与注入回写必须调同一个函数。
     *   优先用 recall 已挂好的 _heatKey；缺席时按 floor + 内容前 40 字确定性派生。 */
    _heatKeyOf(rec) {
        return String((rec && (rec.id || rec._heatKey)) || ('fl:' + ((rec && rec.floor) ?? '') + '|' + String((rec && (rec.content || rec.text)) || '').slice(0, 40)));
    }

    /** [v4.136.0 · V18-R1] 记录演化边：旧记忆指向换代新记忆（跨会话持久化） */
    recordEvolutionLink(fromId, toId, type = 'evolution') {
        if (!fromId || !toId) return;
        if (!Array.isArray(this._pyramidEvolutionLinks)) this._pyramidEvolutionLinks = [];
        const existing = this._pyramidEvolutionLinks.find(e => e.fromId === fromId && e.toId === toId);
        if (existing) {
            existing.type = type;
        } else {
            this._pyramidEvolutionLinks.push({ fromId, toId, type, timestamp: Date.now() });
        }
        this._save();
    }

    /** [v4.136.0 · V18-R1] 查询条目是否已被演化替代 */
    hasSupersedingEvolution(key) {
        if (!key || !Array.isArray(this._pyramidEvolutionLinks)) return false;
        return this._pyramidEvolutionLinks.some(e => e.fromId === key && e.type === 'evolution');
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
                res = this._bm25.search(String(queryText || ''), topN).map(r => Object.assign({
                    id: r.id,
                    content: r.text,
                    score: Math.max(0.1, Math.min(1, r.score / 12)),
                    layer: r.source || 'bm25',
                    floor: r.floor
                }, BridgeBM25.cognitionMeta(r)));
            }
            // 空结果兜底: 走 MemoryCore 内建混合检索 (池触发 + 关键词)
            if (!res || !res.length) {
                res = (this.memoryCore.recall(String(queryText || ''), topN) || []).map(r => Object.assign({
                    id: r.id,
                    content: r.content, score: r._score || 0.5, layer: r.layer, floor: null
                }, BridgeBM25.cognitionMeta(r)));
            }
            /* [v4.135.0 · V17-R1] 真实召回侧消费：历史被注入越多的记忆，BM25 名次越靠前。
             *   有界加权（≤ +30%），只动名次边界、不改原始 score 语义；热表缺席时逐字节等同旧行为。 */
            try {
                const heat = this._resonanceHeat || {};
                res = res.map(r => {
                    const hk = this._heatKeyOf(r);
                    const h = Number(heat[hk]) || 0;
                    return Object.assign({}, r, {
                        score: r.score * (1 + Math.min(0.3, Math.log1p(h) * 0.1)),
                        _heatKey: hk
                    });
                }).sort((a, b) => (b.score || 0) - (a.score || 0));
                this.stats.heatRerankCount = (this.stats.heatRerankCount || 0) + 1;
            } catch (_) { /* 热表缺席/异常一律退回原序，不影响召回 */ }

            /* [v4.136.0 · V18-R1] 演化去重抑制过滤：若条目已被更高版本的演化节点换代，自动压制不优先呈现 */
            try {
                const evoLinks = (this._pyramidEvolutionLinks && Array.isArray(this._pyramidEvolutionLinks)) ? this._pyramidEvolutionLinks : [];
                if (evoLinks.length) {
                    const supersededFrom = new Set(evoLinks.filter(e => e.type === 'evolution').map(e => e.fromId));
                    const origLen = res.length;
                    res = res.filter(r => {
                        const k = this._heatKeyOf(r);
                        return !supersededFrom.has(k);
                    });
                    if (origLen > res.length) {
                        this.stats.evolutionFiltered = (this.stats.evolutionFiltered || 0) + (origLen - res.length);
                    }
                }
            } catch (_) { /* 演化过滤失败降级放行 */ }
            this.stats.injectCount++;
            return res;
        } catch (e) {
            console.warn('[LonShaBridge] 召回失败:', e);
            return [];
        }
    }

    // ---------------- ②b [v2.15.0] 召回 + 格式化（单一真源）----------------
    /**
     * 召回并把结果格式化为可直接 push 进 messages 的 system 文本块。
     *  微信单聊 / 微信群聊 / 蜜语直播三处共用同一格式与去重裁剪，杜绝格式漂移；
     *  也避免「同一个注入块在三处各写一遍、改一处漏两处」。
     * @param {string} queryText 召回查询（角色名 / 群成员 / 主播名 + 用户输入）
     * @param {{topN?:number,label?:string,userName?:string,actors?:string|string[],strictActors?:boolean}} [opts]
     * @returns {string} 已格式化的 system 块；无可召回记忆时返回 ''（调用方据此跳过 push）
     */
    recallBlock(queryText, opts = {}) {
        try {
            const topN = Math.max(1, Math.min(5, Number(opts.topN) || 3));
            let mems = this.recall(queryText, topN) || [];
            if (!mems.length) return '';
            // [v4.134.0 · R16-O1] 针对当前发言角色/互动角色的认知视界净化
            const activeSpeaker = String(opts.label || opts.activeSpeaker || '').trim();
            if (activeSpeaker && typeof this.filterContextForCognitiveHorizon === 'function') {
                mems = this.filterContextForCognitiveHorizon(mems, activeSpeaker);
            }
            if (!mems.length) return '';
            const actors = Array.isArray(opts.actors)
                ? opts.actors.filter(Boolean).map(a => String(a).trim()).filter(Boolean)
                : String(opts.actors || '').split(/[\u3001,\uff0c]/).map(s => s.trim()).filter(Boolean);
            /* [第三期 R3-O2] 三条口径修正（探针可复现的三处有损行为）：
             *   ① 去重不得按「前 24 字」—— 同一次出行/同一段剧情里，
             *      两条往事的记述常常开头一模一样（「这是两人上周一起去旧书店之后…」），
             *      按前缀去重会把「第二件事是还钱」整条丢掉。实测：输入 2 条、输出 1 条。
             *      改为「证据身份优先、完整内容兜底」：只有**同一条证据**才算重复。
             *   ② 单条不得硬截到 80 字 —— 金额、否定、约定时间常落在句尾，
             *      一句切一半 = 把「没答应」读成「答应」。改为在预算内**收束到完整句**，
             *      必要时向后扩到 hard 上限（无句读的长文本仍退回预算长度，行为可测）。
             *   ③ 整块不再一律写成「共同经历的」—— 带来源标记（听说/传闻/推测）的条目
             *      分档标出并改尾注，避免把「听别人说的」渲染成亲历。 */
            const maxLines = Math.max(1, Math.min(5, Number(opts.maxLines) || 3));
            const maxChars = Math.max(40, Math.min(200, Number(opts.maxChars) || 80));
            const hardChars = Math.max(maxChars, Math.min(240, Number(opts.hardChars) || 120));
            const SENT = '。！？；…\n';
            /** 预算内收束到完整句：优先取 [预算, hard] 区间内**最后一个**句读位置；
             *  区间内没有句读（如无标点长文）则退回预算长度（与旧行为同形，便于对照）。 */
            const trimToSentence = (s, budget, hard) => {
                if (s.length <= budget) return s;
                let cut = -1;
                const limit = Math.min(s.length, hard);
                for (let i = 0; i < limit; i++) {
                    if (SENT.indexOf(s[i]) >= 0) cut = i + 1;
                }
                if (cut >= budget) return s.slice(0, cut);
                return s.slice(0, budget);
            };
            /** 证据身份：同一条证据的多份呈现才算重复；无身份字段时用完整内容兜底。 */
            const evidenceKey = (m, raw) => {
                const idc = String((m && (m.id || m.evidenceId || m.sourceRef || m.ref)) || '').trim();
                if (idc) return 'id:' + idc;
                const f = (m && m.floor !== undefined && m.floor !== null) ? String(m.floor) : '';
                const l = (m && m.layer) ? String(m.layer) : '';
                if (f || l) return 'fl:' + f + '|' + l + '|' + raw;
                return 'c:' + raw;
            };
            /** 可知范围分档：lived（亲历，默认）/ hearsay（听说·传闻）/ inferred（推测）。 */
            const originOf = (m) => {
                if (!m || typeof m !== 'object') return 'lived';
                const tags = Array.isArray(m.tags) ? m.tags : [];
                const s = [m.knowledge, m.origin, m.via, m.kind, m.type, m.source]
                    .concat(tags)
                    .filter(x => typeof x === 'string')
                    .join(' ')
                    .toLowerCase();
                if (/hearsay|rumou?r|听说|传闻|转述/.test(s)) return 'hearsay';
                if (/infer|guess|推测|猜想|怀疑/.test(s)) return 'inferred';
                return 'lived';
            };
            const lived = [];
            const other = [];
            const seen = new Set();
            const injectedKeys = [];   // [v4.135.0 · V17-R2] 真正进入 system 块的证据身份
            for (const m of mems) {
                const raw = String((m && (m.content || m.text)) || '').replace(/\s+/g, ' ').trim();
                if (!raw) continue;
                // 严格模式（群聊用）：只保留确实提到在场人物的记忆，防把 A 的往事灌给 B
                if (opts.strictActors && actors.length && !actors.some(a => raw.includes(a))) continue;
                const key = evidenceKey(m, raw);
                if (seen.has(key)) continue;
                seen.add(key);
                injectedKeys.push(m);   // 保留原记录引用，回写侧用同一 _heatKeyOf 派生
                const body = trimToSentence(raw, maxChars, hardChars);
                const kind = originOf(m);
                if (kind === 'hearsay') other.push(`- ${body}（听说，非亲历）`);
                else if (kind === 'inferred') other.push(`- ${body}（推测，未经证实）`);
                else lived.push(`- ${body}`);
                if (lived.length + other.length >= maxLines) break;
            }
            const lines = lived.concat(other);
            if (!lines.length) return '';
            /* [v4.135.0 · V17-R2] 真实注入侧回写：只有进了最终 system 块的记忆才升温。
             *   与 LonSha 端 reinforceOnAccess 同构 —— 召回→注入→强化→下轮更易召回 的闭环。 */
            try {
                if (!this._resonanceHeat || typeof this._resonanceHeat !== 'object') this._resonanceHeat = {};
                for (const rec of injectedKeys) {
                    const hk = this._heatKeyOf(rec);
                    this._resonanceHeat[hk] = (Number(this._resonanceHeat[hk]) || 0) + 1;
                }
                this.stats.heatReinforced = (this.stats.heatReinforced || 0) + injectedKeys.length;
                this._save();
            } catch (_) { /* 升温失败不阻断注入 */ }
            const label = String(opts.label || '').trim() || actors[0] || '角色';
            const userName = String(opts.userName || '').trim() || '你';
            const head = `【角色记忆 · 来自剧情】${label}记得这些往事：`;
            /* 无「听说/推测」条目时保持原文案（三处注入点的既有契约不变）；
             * 有则明说哪些不是亲历，别当成共同经历复述。 */
            const tail = other.length
                ? `（标「听说/推测」的不是 ${label} 亲历，不得当作共同经历；其余是 ${label} 和 ${userName} 在剧情里共同经历的，自然带入，不要生硬复述）`
                : `（这些是 ${label} 和 ${userName} 在剧情里共同经历的，自然带入，不要生硬复述）`;
            return `${head}\n${lines.join('\n')}\n${tail}`;
        } catch (e) { return ''; }   // lonsha 记忆注入静默失败，不影响发送
    }

    // ---------------- ②c [v4.125.0] 具身现场感知与防偷窥拦截 ----------------
    /**
     * 接收并应用来自 LonSha 的即时现场状态 (L0 Scene State)
     * @param {Object} sceneState { location, time, action, tension, inSceneCharacters }
     */
    applyScenePresenceState(sceneState) {
        if (!sceneState || typeof sceneState !== 'object') return false;
        try {
            this._lastSceneState = {
                location: String(sceneState.location || '').trim(),
                time: String(sceneState.time || '').trim(),
                action: String(sceneState.action || '').trim(),
                tension: String(sceneState.tension || '').trim(),
                inSceneCharacters: Array.isArray(sceneState.inSceneCharacters) ? sceneState.inSceneCharacters.slice() : sceneState.inSceneCharacters,
                updatedAt: Date.now()
            };
            this.stats.sceneSyncCount = (this.stats.sceneSyncCount || 0) + 1;
            return true;
        } catch (e) { return false; }
    }

    /**
     * 读取当前手机缓存的现场快照
     */
    getScenePresenceState() {
        return this._lastSceneState || null;
    }
    /**
     * [v4.137.0 · V20-R1] 全息双向共生总线：手机端向 LonSha 发射事件
     * @param {string} type 事件类型 (如 'IM_MESSAGE', 'BILL_TRANSFER', 'NOTE_MEMO', 'APP_STATE_MUTATION')
     * @param {Object} payload 载荷详情
     */
    _readHolographicEvents() {
        try {
            const raw = this.storage?.get?.(DEVICE_HOLOGRAPHIC_EVENTS_KEY, []);
            const rows = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return Array.isArray(rows) ? JSON.parse(JSON.stringify(rows.slice(-50))) : [];
        } catch (_e) { return []; }
    }
    emitHolographicEvent(type, payload = {}) {
        const event = {
            id: `holo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            type: String(type || 'GENERIC'),
            payload: { ...payload },
            timestamp: Date.now()
        };
        this._holographicBusEvents = this._readHolographicEvents();
        this._holographicBusEvents.push(event);
        if (this._holographicBusEvents.length > 50) this._holographicBusEvents.shift();
        if (this.storage?.set?.(DEVICE_HOLOGRAPHIC_EVENTS_KEY, this._holographicBusEvents) === false) throw new Error('全息队列未保存');

        // 若 LonSha 记忆插件挂载在同一 window，双向即时穿透
        try {
            const win = typeof window !== 'undefined' ? window : null;
            if (win?.LonShaMemoryPlugin?.engine?.onRubyPhoneHolographicEvent) {
                win.LonShaMemoryPlugin.engine.onRubyPhoneHolographicEvent(event);
            }
        } catch (_e) {}
        return event;
    }
    /**
     * [v4.137.0 · V20-R1] 全息双向共生总线：消费并排队待同步的事件
     */
    /** Non-destructive batch: acknowledge only after the receiver persists it. */
    peekHolographicEvents() {
        const token = captureSessionToken(this.storage);
        const events = this._readHolographicEvents();
        const conversationId = String(this.storage?.currentConversationId || '');
        return { conversationId, events, acknowledge: () => {
            if (!guardSessionWrite(this.storage, token, 'holographic-ack')) return false;
            const ids = new Set(events.map(e => e.id));
            const remaining = this._readHolographicEvents().filter(e => !ids.has(e.id));
            if (this.storage?.set?.(DEVICE_HOLOGRAPHIC_EVENTS_KEY, remaining) === false) return false;
            this._holographicBusEvents = remaining;
            return true;
        } };
    }
    acknowledgeHolographicEvents(batch) {
        if (!batch?.conversationId || batch.conversationId !== String(this.storage?.currentConversationId || '')) return false;
        return typeof batch.acknowledge === 'function' && batch.acknowledge();
    }
    drainHolographicEvents() {
        const evts = this._readHolographicEvents();
        if (this.storage?.set?.(DEVICE_HOLOGRAPHIC_EVENTS_KEY, []) === false) throw new Error('全息队列未排空');
        this._holographicBusEvents = [];
        return evts;
    }

    /**
     * 生成手机端 HUD 状态条文案
     */
    getSceneHudLine() {
        const sc = this._lastSceneState;
        if (!sc) return '📍当前现场 · 离线感知';
        const loc = sc.location || '当前现场';
        const cast = sc.inSceneCharacters === undefined
            ? ''
            : (sc.inSceneCharacters.length === 0 ? ' · 现场无人' : ' · 在场: ' + sc.inSceneCharacters.join('、'));
        return `📍${loc}${cast}`;
    }

    /**
     * 裁决当前针对某角色的通信行为是否应当被现场面对面拦截
     * @param {'CHAT_MESSAGE'|'CALL_LOG'} actionType 行为类型
     * @param {string} targetCharacter 目标角色名
     * @returns {{intercepted:boolean, suggestedAction?:string, reason?:string, notice?:string}}
     */
    checkPresenceInterception(actionType, targetCharacter) {
        const sc = this._lastSceneState;
        if (!sc || !Array.isArray(sc.inSceneCharacters)) return { intercepted: false };
        const target = String(targetCharacter || '').trim();
        if (sc.inSceneCharacters.includes(target)) {
            return {
                intercepted: true,
                suggestedAction: 'FACE_TO_FACE',
                reason: 'co-present-in-scene',
                notice: `角色「${target}」就在物理现场，转为面对面交流与现场防窥模式。`
            };
        }
        return { intercepted: false };
    }

    // ---------------- ②d [v4.126.0 · R15-O9 / R15-X1] 防偷窥隐私模式与 NFC 近场通信 ----------------
    /**
     * 判断当前是否处于同室防偷窥隐私伪装模式
     * 规则：只要现场明确有其他活跃在场角色（非空数组且包含其他角色），或者用户主动锁定了防窥开关
     */
    isPrivacyAntiPeekActive() {
        if (this._manualAntiPeekLocked === true) return true;
        const sc = this._lastSceneState;
        if (!sc || !Array.isArray(sc.inSceneCharacters)) return false;
        return sc.inSceneCharacters.length > 0;
    }

    /**
     * 设置手动防偷窥伪装模式开关
     */
    setManualAntiPeek(on) {
        this._manualAntiPeekLocked = !!on;
        return this._manualAntiPeekLocked;
    }

    /**
     * 对通知或预览正文实施防窥模糊伪装过滤
     * @param {string} rawText 原始文本
     * @param {string} [category] 分类（如 'message', 'secret', 'album'）
     * @returns {string} 伪装文本
     */
    maskTextForAntiPeek(rawText, category = 'message') {
        if (!this.isPrivacyAntiPeekActive()) return String(rawText || '');
        if (category === 'album') return '【🔒 照片内容已按防偷窥规则隐藏】';
        if (category === 'secret') return '【🔒 核心绝密内容已掩盖】';
        return '收到一条新消息（防窥模式已隐藏正文）';
    }

    /**
     * [v4.134.0 · R16-O1] 针对酒馆角色上下文认知视界的防全知信息净化
     * 过滤掉不在场角色的私有隐私，避免手机通知或本地备忘录沦为全知泄漏通道
     */
    filterContextForCognitiveHorizon(records, activeSpeaker) {
        if (!Array.isArray(records)) return [];
        const speaker = String(activeSpeaker || '').trim();
        const sc = this._lastSceneState;
        const inScene = sc && Array.isArray(sc.inSceneCharacters) ? sc.inSceneCharacters : [];

        return records.filter(rec => {
            if (!rec || typeof rec !== 'object') return false;
            // 若记录带有私密所有者标记且非公共条目
            const owner = String(rec.owner || rec.character || '').trim();
            if (owner && speaker && owner !== speaker && !inScene.includes(owner)) {
                // 不在场角色的专属记录直接拦截，严防宿主全知剧透
                return false;
            }
            return true;
        });
    }

    /**
     * [R15-X1] 近场通信雷达：探测同场物理活跃角色
     * @returns {{available:boolean, activeCharacters:string[], radarStatus:string}}
     */
    scanNearFieldRadar() {
        const sc = this._lastSceneState;
        if (!sc || !Array.isArray(sc.inSceneCharacters) || sc.inSceneCharacters.length === 0) {
            return {
                available: false,
                activeCharacters: [],
                radarStatus: 'no-nearby-targets',
                summaryLine: '雷达未探测到同场面对面角色（需处于同室物理场景）'
            };
        }
        const targets = sc.inSceneCharacters.slice();
        return {
            available: true,
            activeCharacters: targets,
            radarStatus: 'targets-detected',
            summaryLine: `📡 近场雷达已锁定 ${targets.length} 位同室角色：${targets.join('、')}`
        };
    }

    /**
     * [R15-X1] 发起面对面 NFC 快传（交换名片/随身照片）
     * @param {string} targetCharacter 接收方角色
     * @param {'CARD'|'PHOTO'} shareType 分享类型
     * @param {Object} [payload] 随附数据
     */
    transmitNearFieldItem(targetCharacter, shareType, payload = {}) {
        const radar = this.scanNearFieldRadar();
        const target = String(targetCharacter || '').trim();
        if (!radar.available || !radar.activeCharacters.includes(target)) {
            return {
                ok: false,
                reason: 'target-not-in-near-field',
                message: `目标「${target}」未处于近场雷达可达范围，快传取消。`
            };
        }
        const txId = 'nfc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        const item = {
            txId,
            target,
            shareType: String(shareType || 'CARD').toUpperCase(),
            payload: { ...payload },
            timestamp: Date.now(),
            receiptSound: 'nfc_chime.wav',
            dialogueCard: `【NFC 碰一碰】已成功向 ${target} 面对面直传「${shareType === 'PHOTO' ? '相册照片' : '个人电子名片'}」！`
        };
        if (!this._nfcTransmissionHistory) this._nfcTransmissionHistory = [];
        this._nfcTransmissionHistory.push(item);
        if (this._nfcTransmissionHistory.length > 20) this._nfcTransmissionHistory.shift();
        return {
            ok: true,
            item,
            message: item.dialogueCard
        };
    }

    /**
     * 获取近场传输记录
     */
    getNearFieldHistory() {
        return (this._nfcTransmissionHistory || []).slice();
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
        this._holographicBusEvents = this._readHolographicEvents();
        this._bm25Dirty = true;
    }
    onFloorCommitted(floor) {
        try {
            /* [v3.57.0·O3] 取值门与 `onFloorRollback` **同口径**（本文件 `floorOrNull`）。
             *   此前这里是 `const f = Number(floor)`：`Number(null)` / `Number('')` /
             *   `Number('  ')` / `Number([])` / `Number(false)` **全是 0** —— 于是「**没给**楼层」
             *   被读成「第 0 楼」并 `invalidateFloorAt(1)`，把第 1 楼之后的记忆误失效；
             *   而 0 是**合法楼层**（第 0 楼之后才该清）。两处口径不一致正是本轮要修的病灶。 */
            const f = floorOrNull(floor);
            if (f === null) return;
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
            // [v3.3.0] 取值门：`Number(floor)` 让「没给楼层」被读成第 0 楼（`Number('') === 0`、
            //   `Number([]) === 0`），而 0 是合法楼层 —— 与上游 `ledger-replay.js` 的
            //   `floorOrNull`、本仓 `config/projection-contract.js` 的 `numOrNull` 同因同法。
            const f0 = floorOrNull(floor);
            if (f0 === null) return;
            const n = this.memoryCore?.invalidateFloorAt?.(f0);
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