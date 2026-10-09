/* ========================================================
 *  记忆池 (Memory Pool) — RubyPhone 移植版
 *  移植自 sxiphone MemoryPool: 四层结构 (premise/perception/spatial/temporal)
 *  三级触发: 感官(sensory) → 关键词(keyword) → 文本相关(semantic)
 *  零外部依赖; 持久化由 MemoryData 负责
 * --------------------------------------------------------
 *  [v3.80.0 · 缝入 A4] 关键词层此前是**精确集合匹配**（`itemKw.some(ik => ik === k)`）：
 *  查询切出的 2~4 字片段要在条目关键词里**一字不差**地存在才算命中。中文里
 *  「城西的老槐树」与「老槐树下避雨」共享 4 个字，却在旧口径下**零命中** ——
 *  而语义层要求 `hit >= 2` 才收，于是这类条目直接被丢掉。
 *  本版把打分交给 apps/memory/keyword-overlap.js 的字窗滑窗（2 字权 1 / 3 字权 3 /
 *  4 字权 9），并**保留触发类型判定**：命中为 0 时仍如实回落语义层。
 *  归一化在这里做（overlapScore 只给原始分，见该模块文件头）。
 * ======================================================== */
import { overlapScore } from './keyword-overlap.js';

const SENSE_WEIGHTS = { smell: 1.0, touch: 0.95, sight: 0.7, sound: 0.6, taste: 0.85 };

const SENSE_HINTS = {
    smell: ['香', '味', '气味', '味道', '芳香', '芬芳', '臭', '腥', '汗味', '体香', '咖啡香', '烟草味'],
    touch: ['摸', '触', '碰', '抱', '肌肤', '皮肤', '软', '滑', '湿', '温度', '凉', '烫', '细腻', '粗糙', '颤抖', '指尖', '体温'],
    sight: ['看', '目光', '眼神', '脸', '颜色', '亮', '暗', '轮廓', '表情', '背影', '画面', '影子', '泛红'],
    sound: ['声音', '声', '说', '笑', '哭', '喘', '心跳', '呼吸', '铃声', '脚步', '耳语', '呢喃', '沉默'],
    taste: ['尝', '舔', '味觉', '甜', '苦', '咸', '酸', '唇', '舌尖', '品尝', '入口']
};

export class MemoryPool {
    constructor(options = {}) {
        this.config = {
            perceptionWeight: { ...SENSE_WEIGHTS, ...(options.perceptionWeight || {}) },
            spatialDecayRate: options.spatialDecayRate || 0.1,
            temporalEmotionBoost: options.temporalEmotionBoost || 0.3,
            consolidationThreshold: options.consolidationThreshold || 0.65,
            triggerThreshold: options.triggerThreshold || 0.75,
            maxPoolSize: options.maxPoolSize || 50
        };
        this.pool = { premise: null, perception: [], spatial: [], temporal: [] };
        this.sensoryIndex = new Map();
        this.isInitialized = false;
    }

    initialize() {
        this._buildSensoryIndex();
        this.isInitialized = true;
        return true;
    }

    // ---------- 数据装载 (由 MemoryData 调用) ----------
    loadState(state) {
        if (!state || typeof state !== 'object') return;
        if (state.premise) this.pool.premise = state.premise;
        if (Array.isArray(state.perception)) this.pool.perception = state.perception;
        if (Array.isArray(state.spatial)) this.pool.spatial = state.spatial;
        if (Array.isArray(state.temporal)) this.pool.temporal = state.temporal;
        this._buildSensoryIndex();
    }

    dumpState() {
        return JSON.parse(JSON.stringify(this.pool));
    }

    clear() {
        this.pool = { premise: null, perception: [], spatial: [], temporal: [] };
        this.sensoryIndex.clear();
    }

    // ---------- 写入 ----------
    addPremise(text, options = {}) {
        this.pool.premise = {
            id: 'premise_' + Date.now(),
            text: String(text || '').slice(0, 500),
            tags: options.tags || [],
            updatedAt: new Date().toISOString()
        };
        return this.pool.premise;
    }

    addPerception(content, options = {}) {
        const perception = {
            id: 'perc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            content: String(content || '').slice(0, 300),
            senses: this._detectSenses(content),
            weights: {},
            location: options.location || null,
            emotion: options.emotion || null,
            metadata: options.metadata || {},
            accessCount: 1,
            lastAccessed: new Date().toISOString(),
            createdAt: new Date().toISOString()
        };
        for (const s of Object.keys(perception.senses)) perception.weights[s] = perception.senses[s];
        this.pool.perception.push(perception);
        if (this.pool.perception.length > this.config.maxPoolSize) this.pool.perception.shift();
        this._buildSensoryIndex();
        return perception;
    }

    addSpatial(content, options = {}) {
        const spatial = {
            id: 'space_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            content: String(content || '').slice(0, 300),
            place: options.place || null,
            keywords: this._extractTriggerKeywords(content),
            metadata: options.metadata || {},
            accessCount: 1,
            createdAt: new Date().toISOString()
        };
        this.pool.spatial.push(spatial);
        if (this.pool.spatial.length > this.config.maxPoolSize) this.pool.spatial.shift();
        return spatial;
    }

    addTemporal(content, options = {}) {
        const temporal = {
            id: 'tempo_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            content: String(content || '').slice(0, 300),
            time: this._parseTimeContext(options.timestamp),
            emotion: options.emotion || null,
            linkedSpatial: options.linkedSpatial || [],
            metadata: options.metadata || {},
            accessCount: 1,
            createdAt: new Date().toISOString()
        };
        this.pool.temporal.push(temporal);
        if (this.pool.temporal.length > this.config.maxPoolSize) this.pool.temporal.shift();
        return temporal;
    }

    // ---------- 触发检索 (三级) ----------
    trigger(query, options = {}) {
        const results = { matched: [], triggerType: null, confidence: 0 };
        if (!query) return results;
        const querySenses = this._detectSenses(query);
        const queryKeywords = this._extractTriggerKeywords(query);

        if (Object.keys(querySenses).length > 0) {
            results.triggerType = 'sensory';
            results.matched = this._matchBySenses(querySenses, query);
        }
        if (results.matched.length === 0 && queryKeywords.length > 0) {
            results.triggerType = 'keyword';
            results.matched = this._matchByKeywords(queryKeywords);
        }
        if (results.matched.length === 0) {
            /* [v3.80.0 · 缝入 A4] 第三级由「语义（2 字片段计数）」换成「相关度（字窗滑窗）」：
             *   形态只有一处收口，故旧语义层不再参与触发，只留作诊断对比面。
             *   触发类型名字如实报 relevance —— 报成 semantic 会让诊断页把两套口径混为一谈。 */
            results.triggerType = 'relevance';
            results.matched = this._matchByRelevance(query);
        }
        if (results.matched.length > 0) {
            results.confidence = this._calculateMatchConfidence(results.matched, query);
            results.matched.forEach(m => { m.accessCount = (m.accessCount || 0) + 1; m.lastAccessed = new Date().toISOString(); });
        }
        return results;
    }

    _matchBySenses(querySenses, query) {
        const matches = [];
        for (const perception of this.pool.perception) {
            let matchScore = 0;
            for (const [sense, weight] of Object.entries(querySenses)) {
                if (perception.senses[sense]) {
                    const perceptionWeight = perception.weights[sense] || 0.5;
                    matchScore += Math.min(weight, perceptionWeight) * (this.config.perceptionWeight[sense] || 0.5);
                }
            }
            if (matchScore >= this.config.triggerThreshold * 0.5) {
                matches.push({ ...perception, _score: matchScore, _layer: 'perception' });
            }
        }
        return matches.sort((a, b) => b._score - a._score).slice(0, 8);
    }

    /** 条目检索文本：关键词与正文**一起**看（旧口径也是两者 or，不缩面）。 */
    _entrySearchText(item) {
        const kw = (item && Array.isArray(item.keywords)) ? item.keywords.join(' ') : '';
        return kw + ' ' + String((item && item.content) || '');
    }

    _matchByKeywords(keywords) {
        const query = Array.isArray(keywords) ? keywords.join(' ') : String(keywords || '');
        return this._rankByOverlap(query, this.pool.spatial.concat(this.pool.temporal), 8);
    }

    /** [v3.80.0 · 缝入 A4] 懒建的字窗索引。持久结构与 `sensoryIndex` 同款（Map），
     *  不落盘、不改变 `dumpState` 的形状（落盘形状一改，读旧档那条路就要迁移）。 */
    _overlapIndex() {
        if (!this._overlapCache) this._overlapCache = new Map();
        return this._overlapCache;
    }

    /** 归一化：把原始加权分压进 0–1。
     *  分母与 keyword-overlap.overlapRatio 同源（3 字窗权重），**不另立一套** ——
     *  同一件事两份归一化正是本仓反复点名的分叉种子。 */
    _normalizeOverlap(raw) {
        return Math.min(1, Math.max(0, Number(raw) || 0) / 9);
    }

    _rankByOverlap(query, items, topN) {
        const q = String(query || '');
        if (!q.trim()) return [];
        const idx = this._overlapIndex();
        const out = [];
        for (const item of items) {
            /* 缓存键**必须含 query**：同一条目对不同查询的得分不同，
             *  只按条目 id 建键会让下一次查询读到上一次的分
             *  （实测形态：无关查询命中同一条目 —— 本套件 C2 当场抓到）。 */
            const key = q + '\u0000' + String(item && item.id || '') + '@' + String((item && item.createdAt) || '');
            let scored = idx.get(key);
            if (!scored) {
                scored = overlapScore(q, this._entrySearchText(item));
                idx.set(key, scored);
                if (idx.size > 4000) {
                    /* 有界：索引是缓存不是账本，超限即整体丢（丢缓存只损失一次重算，
                     *   而无限长大的 Map 会跟着会话活到用户卸载那天）。 */
                    idx.clear();
                    idx.set(key, scored);
                }
            }
            if (scored.score <= 0) continue;
            out.push({
                ...item,
                _score: this._normalizeOverlap(scored.score),
                _rawScore: scored.score,
                _overlap: { hits: scored.hits, phrases: scored.phrases, truncated: scored.truncated },
                _layer: item._layer || (item.place ? 'spatial' : 'temporal')
            });
        }
        return out.sort((a, b) => b._score - a._score).slice(0, topN || 8);
    }

    /** [v3.80.0 · 缝入 A4] 相关度触发面：旧语义层要求「至少 2 个 2 字片段命中」——
     *  那是一个与文本长度无关的**绝对**门槛，长句天然占优、短条目天然吃亏。
     *  这里改用同一份字窗打分按 layer 收敛（三层都过、各有自己的 topN）。 */
    _matchByRelevance(query) {
        const bags = [
            ['spatial', this.pool.spatial, 8],
            ['temporal', this.pool.temporal, 8],
            ['perception', this.pool.perception, 6]
        ];
        const out = [];
        for (const bag of bags) {
            for (const m of this._rankByOverlap(query, bag[1], bag[2])) {
                out.push({ ...m, _layer: m._layer || bag[0] });
            }
        }
        return out.sort((a, b) => b._score - a._score).slice(0, 8);
    }

    /** 旧语义层（**保留可回退**）：修前它是唯一兜底，v3800 之后由 `_matchByRelevance`
     *  接管触发路径，但函数本身留着 —— 诊断页要能对比两套口径的召回差异。 */
    _matchBySemantic(query) {
        const q = String(query || '').toLowerCase();
        const cjk = q.match(/[一-鿿]{2}/g) || [];
        const matches = [];
        for (const layer of ['perception', 'spatial', 'temporal']) {
            for (const item of this.pool[layer]) {
                const text = String(item.content || '').toLowerCase();
                let hit = 0;
                for (const w of cjk) if (text.includes(w)) hit++;
                if (hit >= 2) matches.push({ ...item, _score: hit / cjk.length, _layer: layer });
            }
        }
        return matches.sort((a, b) => b._score - a._score).slice(0, 6);
    }

    _calculateMatchConfidence(matched, query) {
        if (!matched.length) return 0;
        const top = matched[0]._score || 0;
        return Math.min(1, Math.max(0, top) * 0.8 + Math.min(0.2, matched.length * 0.05));
    }

    // ---------- 感官检测 ----------
    _detectSenses(text) {
        const out = {};
        if (!text) return out;
        const lower = String(text).toLowerCase();
        for (const [sense, hints] of Object.entries(SENSE_HINTS)) {
            let hit = 0;
            for (const h of hints) if (lower.includes(h)) hit++;
            if (hit > 0) out[sense] = Math.min(1, 0.4 + hit * 0.25);
        }
        return out;
    }

    _extractTriggerKeywords(text) {
        const out = new Set();
        const cjk = String(text || '').match(/[一-鿿]{2,4}/g) || [];
        cjk.forEach(w => out.add(w));
        (String(text || '').match(/[a-zA-Z]{3,}/g) || []).forEach(w => out.add(w.toLowerCase()));
        return [...out].slice(0, 24);
    }

    _parseTimeContext(timestamp) {
        if (!timestamp) return { period: 'unknown', label: '未知时间' };
        const date = new Date(timestamp);
        const hour = date.getHours();
        let period, label;
        if (hour >= 5 && hour < 9) { period = 'early-morning'; label = '清晨'; }
        else if (hour >= 9 && hour < 12) { period = 'morning'; label = '上午'; }
        else if (hour >= 12 && hour < 14) { period = 'noon'; label = '正午'; }
        else if (hour >= 14 && hour < 18) { period = 'afternoon'; label = '下午'; }
        else if (hour >= 18 && hour < 22) { period = 'evening'; label = '夜晚'; }
        else { period = 'late-night'; label = '深夜'; }
        return { period, label, iso: date.toISOString() };
    }

    _buildSensoryIndex() {
        this.sensoryIndex.clear();
        for (const p of this.pool.perception) {
            for (const s of Object.keys(p.senses || {})) {
                if (!this.sensoryIndex.has(s)) this.sensoryIndex.set(s, []);
                this.sensoryIndex.get(s).push(p.id);
            }
        }
    }

    /**
     * 感官分类归档: 按五感维度统计感知记忆
     * @returns { smell: [...], touch: [...], sight: [...], sound: [...], taste: [...] }
     */
    getSensoryArchive() {
        const out = { smell: [], touch: [], sight: [], sound: [], taste: [] };
        for (const p of this.pool.perception || []) {
            for (const sense of Object.keys(p.senses || {})) {
                if (out[sense]) out[sense].push(p);
            }
        }
        for (const k of Object.keys(out)) out[k].sort((a, b) => (b.weights?.[k] || 0) - (a.weights?.[k] || 0));
        return out;
    }

    /**
     * 场景标签聚合: 按 location 聚合感知/空间记忆
     * @returns [{ place, items: [], senses: {} }]
     */
    getSceneTags() {
        const map = {};
        const all = (this.pool.perception || []).concat(this.pool.spatial || []);
        for (const item of all) {
            const place = item.place || item.location || '未知地点';
            if (!map[place]) map[place] = { place, items: [], senses: {} };
            map[place].items.push(item);
            const senses = item.senses || (item._sensesDetected ? item._sensesDetected : null);
            if (senses) for (const s of Object.keys(senses)) map[place].senses[s] = (map[place].senses[s] || 0) + 1;
        }
        return Object.values(map);
    }

    getStats() {
        return {
            premise: !!this.pool.premise,
            perception: this.pool.perception.length,
            spatial: this.pool.spatial.length,
            temporal: this.pool.temporal.length
        };
    }
}

export default MemoryPool;
