/* ========================================================
 *  记忆唤醒引擎 (Awakening Engine) — RubyPhone 版
 *  移植自 sxiphone DailyAwakening + SleepEngine 情绪结晶:
 *
 *  1. 睡眠期 (sleep): 角色休息时, 从短期记忆生成"昨日感受"(feel)
 *     按情感极性聚合 → 情绪结晶 (crystallize): 同主题多次出现 → 关系认知
 *  2. 唤醒 (awake): 生成【昨日感受 + 记得的片段 + 情绪基调 + 开场】
 *     供 AI 在开场/新一天自然带出
 *  3. 记忆回声 (echo): 随机低概率唤起一段旧记忆, 制造"突然想起"的惊喜
 *  4. 遗忘错记 (misremember): 低概率记错细节, 由玩家纠正后强化正确版本
 *  零外部依赖
 * ======================================================== */

export class AwakeningEngine {
    constructor(core) {
        this.core = core; // MemoryCore 引用
        this.state = {
            lastAwakenAt: null,
            lastSleepAt: null,
            feel: [],            // 昨日感受 (情绪结晶)
            echoUsed: [],        // 已用过的回声记忆 id
            misremembered: [],   // 已错记的条目 (等待纠正)
            misrememberFix: []   // 已被纠正的记录
        };
        this.config = {
            echoChance: 0.03,        // 每次生成 3% 概率触发回声
            echoCooldownMs: 30 * 60 * 1000, // 回声冷却 30 分钟
            misrememberChance: 0.02, // 2% 概率错记
            maxFeel: 8,
            sleepThresholdMs: 4 * 60 * 60 * 1000 // 4 小时视为"睡眠期"
        };
        this._lastEchoAt = 0;
        this._load();
    }

    _load() {
        try {
            const raw = this.core.storage?.get?.('memory_awakening');
            if (raw) {
                const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
                if (d.state) this.state = { ...this.state, ...d.state };
                if (d.config) this.config = { ...this.config, ...d.config };
            }
        } catch (e) { /* 忽略 */ }
    }

    _save() {
        try {
            this.core.storage?.set?.('memory_awakening', JSON.stringify({
                state: this.state,
                config: this.config,
                updatedAt: new Date().toISOString()
            }));
        } catch (e) { /* 忽略 */ }
    }

    updateConfig(patch = {}) {
        Object.assign(this.config, patch);
        this._save();
    }

    /**
     * 睡眠巩固: 从短期记忆生成"昨日感受"(按情感聚合结晶)
     * @returns { feel: [], crystallized: [] }
     */
    sleep() {
        const st = this.core.shortTerm || [];
        if (!st.length) return { feel: [], crystallized: [] };

        const now = Date.now();
        // 1) 情绪聚合: 按情感标签聚类
        const byLabel = {};
        for (const m of st) {
            const label = m.emotion?.label || '中性';
            if (!byLabel[label]) byLabel[label] = [];
            byLabel[label].push(m);
        }

        // 2) 生成感受条目 (每类情感选最高 importance 的 1-2 条)
        const feels = [];
        for (const [label, items] of Object.entries(byLabel)) {
            items.sort((a, b) => (b.importance || 0) - (a.importance || 0));
            const picked = items.slice(0, 2);
            const top = picked[0];
            feels.push({
                label,
                feel: this._buildFeelText(label, top),
                source: top.content.slice(0, 60),
                count: items.length,
                intensity: (top.emotion?.intensity || 0) + Math.min(items.length * 0.5, 2),
                at: new Date(now).toISOString()
            });
        }
        // 按强度排序, 截断
        feels.sort((a, b) => b.intensity - a.intensity);
        const topFeels = feels.slice(0, this.config.maxFeel);

        // 3) 情绪结晶: 同主题出现 >= 2 次的短期记忆 → 关系认知
        const tagCount = {};
        for (const m of st) {
            for (const t of (m.tags || [])) {
                tagCount[t] = (tagCount[t] || 0) + 1;
            }
        }
        const crystallized = Object.entries(tagCount)
            .filter(([t, c]) => c >= 2)
            .map(([t, c]) => {
                const samples = st.filter(m => (m.tags || []).includes(t));
                return {
                    topic: t,
                    count: c,
                    summary: this._crystallizeSummary(t, samples),
                    emotions: [...new Set(samples.map(s => s.emotion?.label || '中性'))],
                    at: new Date(now).toISOString()
                };
            });

        this.state.feel = topFeels;
        this.state.lastSleepAt = new Date(now).toISOString();
        this._save();
        return { feel: topFeels, crystallized };
    }

    _buildFeelText(label, m) {
        const who = m.role === 'user' ? '我' : 'TA';
        const content = (m.content || '').slice(0, 40);
        const labelMap = {
            '兴奋/喜悦': '开心', '满足/平静': '安心', '愤怒/焦虑': '恼火',
            '悲伤/疲惫': '低落', '中性': '平常'
        };
        return `${who}让${labelMap[label] || label}——${content}`;
    }

    _crystallizeSummary(topic, samples) {
        const count = samples.length;
        const topContent = samples.map(s => (s.content || '').slice(0, 30)).join('；');
        return `关于「${topic}」反复出现了 ${count} 次：${topContent}`;
    }

    /**
     * 生成唤醒提示词 (供 AI 新一天开场)
     * @returns { context: {...}, prompt: string }
     */
    awake() {
        const now = Date.now();
        const result = {
            context: {
                feels: this.state.feel || [],
                emotionalTone: this._dominantTone(),
                greeting: ''
            },
            prompt: ''
        };

        const feels = (this.state.feel || []).slice(0, 5);
        if (!feels.length) {
            result.prompt = '';
            return result;
        }
        result.context.greeting = `还记得昨天的事吗？${feels[0].feel}。`;

        let prompt = '【今日唤醒】\n';
        prompt += `醒来时的情绪基调：${result.context.emotionalTone}\n\n`;
        if (feels.length) {
            prompt += '【记得的片段】\n';
            for (const f of feels) prompt += `- ${f.feel}\n`;
            prompt += '\n';
        }
        prompt += `【开场】\n${result.context.greeting}`;

        this.state.lastAwakenAt = new Date(now).toISOString();
        this._save();
        result.prompt = prompt;
        return result;
    }

    _dominantTone() {
        const feels = this.state.feel || [];
        if (!feels.length) return '平静';
        const labels = {};
        for (const f of feels) labels[f.label] = (labels[f.label] || 0) + f.intensity;
        const top = Object.entries(labels).sort((a, b) => b[1] - a[1])[0];
        return top ? top[0] : '平静';
    }

    /**
     * 记忆回声: 低概率唤起一段旧记忆
     * @returns { content: string } | null
     */
    maybeEcho() {
        const now = Date.now();
        if (now - (this._lastEchoAt || 0) < this.config.echoCooldownMs) return null;
        if (Math.random() > this.config.echoChance) return null;

        const pool = (this.core.longTerm || []).filter(m => !this.state.echoUsed.includes(m.id));
        if (!pool.length) return null;

        // 加权随机: 高 importance + 高情感强度 优先
        const scored = pool.map(m => ({
            m,
            w: (m.importance || 5) * 0.6 + (m.emotion?.intensity || 0) * 0.4
        }));
        scored.sort((a, b) => b.w - a.w);
        const topPool = scored.slice(0, Math.min(10, scored.length));
        const pick = topPool[Math.floor(Math.random() * topPool.length)].m;

        this.state.echoUsed.push(pick.id);
        if (this.state.echoUsed.length > 50) this.state.echoUsed.shift();
        this._lastEchoAt = now;
        this._save();
        return { id: pick.id, content: pick.content };
    }

    /**
     * 遗忘错记: 低概率在注入中插入一条"记忆细节偏差"
     * 由 AI 以自然方式说出(如把"巷子口"说成"街尾"), 玩家纠正后调用 fixMisremember
     * @returns { original, distorted, hint } | null
     */
    maybeMisremember() {
        if (Math.random() > this.config.misrememberChance) return null;
        const pool = (this.core.longTerm || []).filter(m =>
            !this.state.misremembered.includes(m.id) && (m.content || '').length >= 15
        );
        if (!pool.length) return null;
        const m = pool[Math.floor(Math.random() * pool.length)];
        const dist = this._distort(m.content);
        if (!dist) return null;
        this.state.misremembered.push(m.id);
        this._save();
        return { id: m.id, original: m.content, distorted: dist.distorted, hint: dist.hint };
    }

    /** 制造细节偏差: 数字±、地点词替换、时间偏移 */
    _distort(text) {
        const rules = [
            { re: /(\d{1,2})点/, fn: (m) => (parseInt(m[1]) + (Math.random() > 0.5 ? 1 : -1)) + '点' },
            { re: /第?(\d{1,2})天/, fn: (m) => '第' + (parseInt(m[1]) + (Math.random() > 0.5 ? 1 : -1)) + '天' },
            { re: /(昨天|前天|上周|上个月)/, fn: (m) => (m[1] === '昨天' ? '前天' : m[1] === '前天' ? '上周' : '前几天') }
        ];
        for (const rule of rules) {
            const mm = text.match(rule.re);
            if (mm) {
                const distorted = text.replace(rule.re, rule.fn);
                return { distorted, hint: mm[0] };
            }
        }
        return null;
    }

    /**
     * 纠正错记: 玩家指出正确版本后, 强化正确记忆, 衰减错误关联
     * @param originalId 错记的记忆 id
     * @param correction 玩家的纠正文本
     */
    fixMisremember(originalId, correction) {
        const core = this.core;
        const mem = (core.longTerm || []).find(x => x.id === originalId);
        if (!mem) return { ok: false, reason: 'memory-not-found' };

        // 强化原记忆
        mem.metadata = {
            ...(mem.metadata || {}),
            reinforcementCount: (mem.metadata?.reinforcementCount || 0) + 2,
            lastActive: new Date().toISOString(),
            correctedAt: new Date().toISOString()
        };
        // 记录纠正历史
        this.state.misrememberFix.push({
            id: originalId,
            original: mem.content,
            correction,
            at: new Date().toISOString()
        });
        if (this.state.misrememberFix.length > 30) this.state.misrememberFix.shift();
        this._save();
        return { ok: true };
    }

    getStatus() {
        return {
            lastAwakenAt: this.state.lastAwakenAt,
            lastSleepAt: this.state.lastSleepAt,
            feelCount: (this.state.feel || []).length,
            echoUsed: this.state.echoUsed.length,
            misremembered: this.state.misremembered.length,
            fixed: this.state.misrememberFix.length,
            config: { ...this.config }
        };
    }
}

export default AwakeningEngine;