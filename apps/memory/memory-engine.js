/* ========================================================
 *  记忆引擎内核 (Memory Engine Core)
 *  移植自 sxiphone (siixii00/sxiphone00) 记忆体系纯算法精华:
 *   - 本地情感词典 EmotionTagger (analyzeAuto localFirst 模式)
 *   - Ebbinghaus 衰减评分 (DecayEngine.calculateScore)
 *   - 短期→长期 巩固结晶 (SleepEngine 管线 Phase 2/4)
 *   - 关键词混合检索 (SearchEngine surface 简化)
 *   - 记忆摘要构建 (main.js buildSummaryFromMessages)
 *  零外部依赖: 无 OpenAI / Firebase / localforage / sxStorage
 * ======================================================== */

// ---------------- 情感词典 (中英混合, 本地规则) ----------------
const EMOTION_DICT = {
    positive: {
        highArousal: ['兴奋', '激动', '开心', '快乐', '喜悦', '欢喜', '狂喜', '雀跃', '心花怒放', 'thrilled', 'ecstatic', 'elated', 'excited', 'happy', 'joyful', 'delighted'],
        lowArousal: ['平静', '安详', '满足', '幸福', '舒适', '放松', '安心', '温馨', '甜蜜', '愉快', '踏实', 'calm', 'peaceful', 'content', 'satisfied', 'relaxed', 'serene']
    },
    negative: {
        highArousal: ['愤怒', '生气', '焦虑', '紧张', '恐惧', '害怕', '惊恐', '恐慌', '愤慨', '崩溃', '烦躁', 'angry', 'furious', 'anxious', 'nervous', 'scared', 'terrified', 'panicked'],
        lowArousal: ['难过', '悲伤', '沮丧', '失落', '忧郁', '无聊', '疲倦', '疲惫', '空虚', '孤独', '委屈', 'sad', 'depressed', 'lonely', 'bored', 'tired', 'exhausted', 'melancholy']
    },
    modifiers: {
        intensifiers: ['非常', '很', '极其', '超级', '特别', '十分', '相当', '太', '真的', 'very', 'extremely', 'so'],
        diminishers: ['有点', '稍微', '一些', '一点', '略', 'a bit', 'slightly', 'somewhat']
    }
};

/**
 * EmotionTagger — 本地情感分析 (纯词典规则, 无 API)
 * valence: 0(负面)~1(正面)   arousal: 0(平静)~1(激动)
 */
export class EmotionTagger {
    constructor(options = {}) {
        this.dict = options.dict || EMOTION_DICT;
        this.cache = new Map();
    }

    analyze(text) {
        if (!text || typeof text !== 'string') {
            return { valence: 0.5, arousal: 0.5, confidence: 0, label: '中性' };
        }
        const cacheKey = this._hashText(text);
        if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);

        const lowerText = text.toLowerCase();
        const words = this._tokenize(text);

        let positiveCount = 0, negativeCount = 0;
        let highArousalCount = 0, lowArousalCount = 0;
        let totalEmotionalWords = 0;

        let intensifierMultiplier = 1;
        if (this.dict.modifiers.intensifiers.some(i => lowerText.includes(i))) intensifierMultiplier = 1.3;
        if (this.dict.modifiers.diminishers.some(d => lowerText.includes(d))) intensifierMultiplier = 0.7;

        for (const word of words) {
            const lowerWord = word.toLowerCase();
            if (this.dict.positive.highArousal.some(w => lowerWord.includes(w.replace(/^\s+/, '')) || lowerText.includes(w.replace(/^\s+/, '')))) {
                positiveCount += 1.5 * intensifierMultiplier;
                highArousalCount += 1.5 * intensifierMultiplier;
                totalEmotionalWords++;
            } else if (this.dict.positive.lowArousal.some(w => lowerWord.includes(w) || lowerText.includes(w))) {
                positiveCount += 1 * intensifierMultiplier;
                lowArousalCount += 1 * intensifierMultiplier;
                totalEmotionalWords++;
            } else if (this.dict.negative.highArousal.some(w => lowerWord.includes(w) || lowerText.includes(w))) {
                negativeCount += 1.5 * intensifierMultiplier;
                highArousalCount += 1.5 * intensifierMultiplier;
                totalEmotionalWords++;
            } else if (this.dict.negative.lowArousal.some(w => lowerWord.includes(w) || lowerText.includes(w))) {
                negativeCount += 1 * intensifierMultiplier;
                lowArousalCount += 1 * intensifierMultiplier;
                totalEmotionalWords++;
            }
        }

        const totalSentiment = positiveCount + negativeCount;
        let valence = 0.5;
        if (totalSentiment > 0) valence = positiveCount / totalSentiment;
        const totalArousal = highArousalCount + lowArousalCount;
        let arousal = 0.5;
        if (totalArousal > 0) arousal = 0.5 + (highArousalCount / totalArousal - 0.5) * 0.8;

        const confidence = Math.min(1, totalEmotionalWords / 3);
        const result = {
            valence: Math.max(0, Math.min(1, valence)),
            arousal: Math.max(0, Math.min(1, arousal)),
            confidence,
            label: this.getEmotionLabel(valence, arousal),
            intensity: totalEmotionalWords
        };
        this.cache.set(cacheKey, result);
        return result;
    }

    getEmotionLabel(valence, arousal) {
        if (valence > 0.6 && arousal > 0.6) return '兴奋/喜悦';
        if (valence > 0.6 && arousal <= 0.6) return '满足/平静';
        if (valence <= 0.4 && arousal > 0.6) return '愤怒/焦虑';
        if (valence <= 0.4 && arousal <= 0.6) return '悲伤/疲惫';
        return '中性';
    }

    _tokenize(text) {
        const cjk = text.match(/[\u4e00-\u9fff]{2}/g) || [];
        const latin = text.match(/[a-zA-Z]{3,}/g) || [];
        return [...new Set([...cjk, ...latin])];
    }

    _hashText(text) {
        let hash = 5381;
        for (let i = 0; i < text.length; i++) {
            hash = ((hash << 5) + hash) + text.charCodeAt(i);
        }
        return Math.abs(hash).toString(36);
    }

    clearCache() { this.cache.clear(); }
}

// ---------------- Ebbinghaus 衰减评分 ----------------
/**
 * 移植自 sxiphone DecayEngine.calculateScore
 * 综合: 重要性 × 激活次数^0.3 × e^(-λ·天数) × 情绪权重 × 新鲜度 × 强化保护
 * 特例: pinned=999, permanent>=100, feel>=50, resolved×0.05
 */
export function calculateDecayScore(memory, config = {}) {
    if (!memory) return 0;
    const meta = memory.metadata || {};
    const lambda = config.lambda || 0.03;
    const shortTermDays = config.shortTermDays || 7;
    const freshHalfLife = config.freshHalfLife || 48; // 小时

    const now = Date.now();
    const lastActive = meta.lastActive ? new Date(meta.lastActive).getTime() : now;
    const daysSinceActive = (now - lastActive) / (1000 * 60 * 60 * 24);
    const hoursSinceActive = (now - lastActive) / (1000 * 60 * 1000);

    const importance = meta.importance !== undefined ? meta.importance : (memory.importance || 5);
    const activationCount = meta.activationCount || memory.activationCount || 1;
    const reinforcementCount = meta.reinforcementCount || 0;
    const memoryStrength = meta.memoryStrength || 0.5;

    const reinforcementFactor = 1 + Math.min(reinforcementCount * 0.15, 1.5);
    const strengthFactor = 0.5 + memoryStrength * 0.5;
    const timeWeight = Math.exp(-0.1 * daysSinceActive);
    const arousal = (memory.emotion && memory.emotion.arousal) || 0.5;
    const emotionWeight = 1.0 + arousal * 0.8;

    let combinedWeight;
    if (daysSinceActive <= shortTermDays) combinedWeight = timeWeight * 0.7 + emotionWeight * 0.3;
    else combinedWeight = emotionWeight * 0.7 + timeWeight * 0.3;

    const freshness = 1.0 + Math.exp(-hoursSinceActive / freshHalfLife);

    let score = importance *
        Math.pow(activationCount, 0.3) *
        Math.exp(-lambda * daysSinceActive) *
        combinedWeight *
        freshness *
        reinforcementFactor *
        strengthFactor;

    if (meta.resolved) score *= 0.05;
    if (meta.pinned) score = 999.0;
    if (meta.type === 'feel') score = Math.max(score, 50.0);
    if (meta.type === 'permanent') score = Math.max(score, 100.0);

    return score;
}

// ---------------- 巩固结晶管线 ----------------
/**
 * 移植自 sxiphone SleepEngine: 短期记忆 → 重要性筛选 → 关键词模式检测 → 结晶
 * @returns { consolidated: 巩固后记忆(升强度+打巩固标记), patterns: 结晶模式, archived: 低分归档 }
 */
export function consolidateMemories(memories, options = {}) {
    const patternThreshold = options.patternThreshold || 3;
    const decayThreshold = options.decayThreshold || 0.3;
    const now = Date.now();

    // Phase A: 提取所有标签/关键词做模式计数
    const tagCount = {};
    for (const m of memories) {
        const meta = m.metadata || {};
        const tags = (m.tags || []).concat(meta.keywords || []);
        for (const t of tags) {
            if (!t) continue;
            const k = String(t).toLowerCase();
            tagCount[k] = (tagCount[k] || 0) + 1;
        }
    }
    const patterns = Object.keys(tagCount)
        .filter(k => tagCount[k] >= patternThreshold)
        .map(k => ({ tag: k, occurrences: tagCount[k] }));

    // Phase B: 逐条评估巩固
    const consolidated = [];
    const archived = [];
    for (const m of memories) {
        const meta = m.metadata || {};
        if (meta.consolidated) continue; // 已巩固过
        const score = calculateDecayScore(m, options);
        const strength = meta.memoryStrength || 0.5;
        const reinf = meta.reinforcementCount || 0;
        const newStrength = Math.min(1, strength + 0.1 + reinf * 0.05);
        const upgraded = {
            ...m,
            metadata: {
                ...meta,
                consolidated: true,
                consolidatedAt: new Date(now).toISOString(),
                memoryStrength: newStrength,
                lastActive: new Date(now).toISOString(),
                activationCount: meta.activationCount || 1
            }
        };
        consolidated.push(upgraded);
        if (score < decayThreshold && meta.type !== 'permanent' && !meta.pinned) {
            upgraded.metadata.archived = true;
            archived.push(upgraded);
        }
    }

    return { consolidated, patterns, archived };
}

// ---------------- 关键词混合检索 ----------------
/**
 * 移植自 sxiphone SearchEngine.surface 的评分思路:
 * 关键词重叠(0.6) + 时间接近度(0.25) + 重要性(0.15)
 * @returns 按相关度降序的记忆数组 (含 _score)
 */
export function searchMemories(memories, query, options = {}) {
    if (!query || !memories || !memories.length) return [];
    const q = String(query).toLowerCase().trim();
    const qWords = new Set();
    (q.match(/[\u4e00-\u9fff]{2}/g) || []).forEach(w => qWords.add(w));
    (q.match(/[a-zA-Z]{3,}/g) || []).forEach(w => qWords.add(w));
    (q.match(/[\u4e00-\u9fff]/g) || []).forEach(w => qWords.add(w));
    if (qWords.size === 0) return [];

    const timeHalfLifeHours = options.timeHalfLifeHours || 72;
    const now = Date.now();

    const scored = memories.map(m => {
        const text = (m.content || '').toLowerCase();
        const tags = (m.tags || []).map(t => String(t).toLowerCase());
        let hits = 0;
        for (const w of qWords) {
            if (text.includes(w) || tags.some(t => t.includes(w))) hits++;
        }
        if (hits === 0) return null;
        const overlap = hits / Math.sqrt(qWords.size);
        const lastActive = (m.metadata && m.metadata.lastActive) ? new Date(m.metadata.lastActive).getTime() : now;
        const ageHours = Math.max(0, (now - lastActive) / (1000 * 60 * 60));
        const timeProximity = Math.exp(-ageHours / timeHalfLifeHours);
        const importance = (m.metadata && m.metadata.importance) || m.importance || 5;
        const _score = overlap * 0.6 + timeProximity * 0.25 + (importance / 10) * 0.15;
        return { ...m, _score };
    }).filter(Boolean);

    scored.sort((a, b) => b._score - a._score);
    return scored;
}

// ---------------- 记忆摘要构建 ----------------
/**
 * 移植自 sxiphone main.js buildSummaryFromMessages:
 * 从聊天消息序列构建 120~200 字纯本地摘要 (role:content；role:content)
 */
export function buildMemorySummary(messages, options = {}) {
    const MIN_LEN = options.minLen || 120;
    const MAX_LEN = options.maxLen || 200;
    const MAX_MESSAGES = options.maxMessages || 20;
    const list = Array.isArray(messages) ? messages : [];
    const parts = [];
    for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i];
        const content = String((m && (m.mes !== undefined ? m.mes : m.content)) || '')
            .replace(/[\r\n]+/g, ' ' )
            .replace(/\s+/g, ' ')
            .trim();
        if (!content) continue;
        const role = m.role === 'system' ? '系统' : (m.role === 'user' ? '我' : '角色');
        parts.unshift(role + ':' + content);
        const joined = parts.join('；');
        if (joined.length >= MIN_LEN || parts.length >= MAX_MESSAGES) break;
    }
    let summary = parts.join('；');
    if (summary.length > MAX_LEN) summary = summary.slice(0, MAX_LEN);
    return summary.trim();
}

export default { EmotionTagger, calculateDecayScore, consolidateMemories, searchMemories, buildMemorySummary };
