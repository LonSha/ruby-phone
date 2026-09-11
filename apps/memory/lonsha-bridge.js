/* ========================================================
 *  LonSha 记忆引擎 ↔ RubyPhone 双向数据桥 (LonShaBridge)
 *
 *  解决两个系统各自的短板:
 *  1. RubyPhone 自带记忆 (MemoryCore) 采集的是"原文楼层切片", 粗糙;
 *     LonSha 记忆引擎产出 LLM 笔录式摘要(角色/事件/关系), 质量高但无手机 UI。
 *  2. 本桥打通双向:
 *     ① 回填 (LonSha → RubyPhone 手机记忆App):
 *        每轮 LonSha 提取完成后, 把 LLM 摘要/关系/事件回填进 MemoryCore,
 *        手机"记忆"App 里看到的就是精炼的笔录式记忆, 而非原文切片。
 *     ② 注入 (RubyPhone → LonSha 召回):
 *        RubyPhone 记忆库(纯本地, 含感官/空间/时间池)作为 LonSha 的一路召回源,
 *        角色真实生活细节/地点/感官刺激也能进入 LonSha 的注入简报。
 *
 *  零外部依赖; 实例挂到 window.VirtualPhone.lonshaBridge
 * ======================================================== */

export const LONSHA_BRIDGE_KEY = 'lonsha_bridge_v1';

export class LonShaBridge {
    constructor(storage, memoryCore) {
        this.storage = storage;
        this.memoryCore = memoryCore;
        this.enabled = true;
        this.stats = { backfillCount: 0, injectCount: 0, lastBackfill: null };
        this._load();
    }

    // ---------------- 配置持久化 (挂 extensionSettings) ----------------
    _load() {
        try {
            const raw = this.storage?.get?.(LONSHA_BRIDGE_KEY);
            if (raw) {
                const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
                if (typeof d.enabled === 'boolean') this.enabled = d.enabled;
                if (d.stats) this.stats = { ...this.stats, ...d.stats };
            }
        } catch (e) { /* 忽略 */ }
    }

    _save() {
        try {
            this.storage?.set?.(LONSHA_BRIDGE_KEY, { enabled: this.enabled, stats: this.stats, updatedAt: new Date().toISOString() });
        } catch (e) { /* 忽略 */ }
    }

    // ---------------- ① 回填: LonSha 提取结果 → RubyPhone 记忆库 ----------------
    /**
     * 由 LonSha 插件在每轮提取完成后调用。
     * @param {Object} extracted LonSha 提取结果 { characters, events, relationships, summary }
     */
    backfill(extracted) {
        if (!this.enabled || !this.memoryCore || !extracted) return;
        try {
            // 摘要 → 长期记忆 (笔录式, 治"原文切片"的核心)
            const summary = String(extracted.summary || '').trim();
            if (summary.length >= 15) {
                this.memoryCore.record('ai', '[剧情] ' + summary, { tags: this._tags(extracted) });
            }

            // 事件 → 记忆池时间层
            const events = Array.isArray(extracted.events) ? extracted.events : [];
            for (const ev of events.slice(0, 6)) {
                const desc = typeof ev === 'string' ? ev : (ev.description || ev.type || '');
                if (String(desc).length >= 8) {
                    this.memoryCore.pool.addTemporal('[事件] ' + String(desc), {
                        timestamp: new Date().toISOString(),
                        metadata: { source: 'lonsha', importance: (ev && ev.importance) || 6 }
                    });
                }
            }

            // 关系 → 记忆池感知层 (关系是角色的主观感知)
            const rels = Array.isArray(extracted.relationships) ? extracted.relationships : [];
            for (const r of rels.slice(0, 6)) {
                const from = r.from || '', to = r.to || '', type = r.type || '';
                if (from && to) {
                    this.memoryCore.pool.addPerception(`[关系] ${from} ${type} ${to}`, {
                        metadata: { source: 'lonsha', importance: 7 }
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

    // ---------------- ② 注入: RubyPhone 记忆库 → LonSha 召回源 ----------------
    /**
     * 供 LonSha 插件在生成前召回时调用。
     * @returns [{content, score, layer, source:'rubyphone'}]
     */
    recall(queryText, topN = 5) {
        if (!this.enabled || !this.memoryCore) return [];
        try {
            const res = this.memoryCore.recall(String(queryText || ''), topN);
            this.stats.injectCount++;
            return res.map(r => ({
                content: r.content,
                score: r._score || 0.5,
                layer: r.layer,
                source: 'rubyphone'
            }));
        } catch (e) {
            console.warn('[LonShaBridge] 召回失败:', e);
            return [];
        }
    }

    // ---------------- 状态 ----------------
    getStats() {
        return { ...this.stats, enabled: this.enabled, longTerm: this.memoryCore?.longTerm?.length || 0 };
    }

    setEnabled(on) {
        this.enabled = !!on;
        this._save();
    }
}

/** 幂等挂载: RubyPhone 初始化完成后创建单例 */
export function mountLonShaBridge(storage, memoryCore) {
    if (!window.VirtualPhone) window.VirtualPhone = {};
    if (window.VirtualPhone.lonshaBridge) return window.VirtualPhone.lonshaBridge;
    window.VirtualPhone.lonshaBridge = new LonShaBridge(storage, memoryCore);
    console.log('[LonShaBridge] ✓ 已挂载 (LonSha记忆引擎 ↔ RubyPhone 双向桥)');
    return window.VirtualPhone.lonshaBridge;
}

export default LonShaBridge;