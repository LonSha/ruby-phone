/* ========================================================
 *  记忆池 (Memory Pool) — RubyPhone 移植版
 *  移植自 sxiphone MemoryPool: 四层结构 (premise/perception/spatial/temporal)
 *  三级触发: 感官(sensory) → 关键词(keyword) → 文本相关(semantic)
 *  零外部依赖; 持久化由 MemoryData 负责
 * ======================================================== */

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
            results.triggerType = 'semantic';
            results.matched = this._matchBySemantic(query);
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

    _matchByKeywords(keywords) {
        const matches = [];
        const kset = new Set(keywords.map(k => k.toLowerCase()));
        for (const item of this.pool.spatial.concat(this.pool.temporal)) {
            const itemKw = (item.keywords || []).map(k => String(k).toLowerCase());
            const text = String(item.content || '').toLowerCase();
            let hit = 0;
            for (const k of kset) {
                if (itemKw.some(ik => ik === k) || text.includes(k)) hit++;
            }
            if (hit > 0) matches.push({ ...item, _score: hit / Math.sqrt(kset.size || 1), _layer: item._layer || (item.place ? 'spatial' : 'temporal') });
        }
        return matches.sort((a, b) => b._score - a._score).slice(0, 8);
    }

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
