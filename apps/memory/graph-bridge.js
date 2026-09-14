/* ========================================================
 *  LonSha 记忆引擎联动桥 (GraphBridge) — RubyPhone 侧
 *  作用: 让手机 App 能读取/检索/写入 LonSha 知识图谱记忆
 *        (LonShaMemory = window.LonShaMemory, 独立插件)
 *
 *  数据源: chatMetadata.extensions.lonsha_memory.data
 *    { graph:{nodes,edges}, summaries, diaries, vectors, povs, timeline, status, ledger }
 *
 *  设计原则:
 *   1. 只读优先 — 不写坏 LonSha 的数据结构, 写入仅走官方 API (engine.*)
 *   2. 软降级 — LonSha 未安装/未初始化时, 桥返回空态, 不影响手机其它功能
 *   3. 双向 — 图谱 → 手机记忆 App; 手机记忆 → 图谱 (可选)
 * ======================================================== */

const LONSHA_STORAGE_KEY = 'lonsha_memory';

export class GraphBridge {
    constructor(storage) {
        this.storage = storage;
        this.available = false;
        this.lastSync = null;
        this._cache = null;
        this._cacheAt = 0;
        this._cacheTTL = 3000; // 3s 缓存, 避免频繁读 chatMetadata
    }

    /** 检测 LonSha 插件是否可用 */
    probe() {
        try {
            const lm = window.LonShaMemory;
            // [v2.8.13] 优先官方门面探测, 降级到旧 engine 直访 (向后兼容旧版记忆插件)
            this.available = !!(lm && (typeof lm.getPublicData === 'function' || lm.engine));
            return this.available;
        } catch (e) {
            this.available = false;
            return false;
        }
    }

    /** 直接读取原始存储数据 (不依赖插件实例, 用于插件已卸载但数据还在的场景) */
    readRaw() {
        try {
            const ctx = window.SillyTavern?.getContext?.();
            const store = ctx?.chatMetadata?.extensions?.[LONSHA_STORAGE_KEY];
            return store?.data || null;
        } catch (e) {
            return null;
        }
    }

    /** 获取数据 (带缓存): 优先取运行时实例(最新), 回退到存储快照 */
    getData(force = false) {
        const now = Date.now();
        if (!force && this._cache && (now - this._cacheAt) < this._cacheTTL) return this._cache;

        let data = null;
        try {
            const lm = window.LonShaMemory;
            // [v2.8.13] 优先官方只读门面 getPublicData() (收敛私有耦合), 降级到旧深层直访
            const pub = (typeof lm?.getPublicData === 'function') ? lm.getPublicData() : null;
            if (pub && pub.graph) {
                data = { source: 'runtime', ...pub };
            } else if (lm?.engine && lm.engine.graph) {
                const engine = lm.engine;
                data = {
                    source: 'runtime',
                    graph: {
                        nodes: Array.from(engine.graph.nodes?.values?.() || []),
                        edges: Array.from(engine.graph.edges?.values?.() || [])
                    },
                    summaries: engine.summary?.summaries || [],
                    diaries: engine.diary?.diaries || engine.diary?.list || [],
                    povs: engine.pov?.povs || [],
                    timeline: engine.timeline?.events || engine.timeline?.list || [],
                    status: engine.status || null,
                    ledger: engine.ledger || null,
                    vectors: engine.vector?.vectors || []
                };
            }
        } catch (e) { /* 降级 */ }

        if (!data) {
            const raw = this.readRaw();
            if (raw) data = { source: 'storage', ...raw };
        }

        this._cache = data;
        this._cacheAt = now;
        return data;
    }

    /** 概览统计 (供 App 顶部展示) */
    getOverview() {
        const d = this.getData();
        if (!d) {
            return { available: false, nodes: 0, edges: 0, summaries: 0, diaries: 0, timelines: 0, povs: 0 };
        }
        const nodes = d.graph?.nodes || [];
        const edges = d.graph?.edges || [];
        // 节点类型分布
        const byType = {};
        for (const n of nodes) {
            const t = n.type || n.kind || 'other';
            byType[t] = (byType[t] || 0) + 1;
        }
        return {
            available: true,
            source: d.source,
            nodes: nodes.length,
            edges: edges.length,
            summaries: (d.summaries || []).length,
            diaries: (d.diaries || []).length,
            timelines: (d.timeline || []).length,
            povs: (d.povs || []).length,
            byType
        };
    }

    /** 列出角色节点 (name 索引) */
    getCharacterNodes() {
        const d = this.getData();
        if (!d?.graph?.nodes) return [];
        return d.graph.nodes.filter(n => n.type === 'character' || n.type === '角色' || n.name);
    }

    /** 图谱检索: 关键词命中节点 + 一跳邻居 + 相关边 */
    search(query, limit = 12) {
        const d = this.getData();
        if (!d?.graph || !query) return [];
        const q = String(query).toLowerCase().trim();
        const nodes = d.graph.nodes || [];
        const edges = d.graph.edges || [];

        // 1) 节点命中 (name / content / tags)
        const hit = [];
        for (const n of nodes) {
            const hay = [n.name, n.content, n.summary, (n.tags || []).join(' ')].filter(Boolean).join(' ').toLowerCase();
            if (hay && hay.includes(q)) {
                let score = 1;
                if ((n.name || '').toLowerCase().includes(q)) score += 1.2;
                if ((n.content || '').toLowerCase().includes(q)) score += 0.4;
                hit.push({ ...n, _score: score, _kind: 'node' });
            }
        }
        hit.sort((a, b) => b._score - a._score);
        const top = hit.slice(0, limit);

        // 2) 一跳邻居 (关系扩散)
        const idset = new Set(top.map(n => n.id));
        const neighbors = [];
        for (const e of edges) {
            if (idset.has(e.from) || idset.has(e.to)) {
                const otherId = idset.has(e.from) ? e.to : e.from;
                if (!idset.has(otherId)) {
                    const nb = nodes.find(n => n.id === otherId);
                    if (nb) { neighbors.push({ ...nb, _score: 0.5, _kind: 'neighbor', _via: e.label || 'related' }); idset.add(otherId); }
                }
            }
        }
        return top.concat(neighbors.slice(0, Math.max(0, limit - top.length)));
    }

    /** 取节点的关系列表 (用于展示 "A —认识→ B") */
    getRelations(nodeId) {
        const d = this.getData();
        if (!d?.graph) return [];
        const edges = d.graph.edges || [];
        const nodes = d.graph.nodes || [];
        const nameOf = (id) => (nodes.find(n => n.id === id) || {}).name || id;
        return edges
            .filter(e => e.from === nodeId || e.to === nodeId)
            .map(e => ({
                id: e.id,
                label: e.label || 'related',
                from: nameOf(e.from),
                to: nameOf(e.to),
                weight: e.weight || 1,
                direction: e.from === nodeId ? 'out' : 'in'
            }));
    }

    /** 剧情时间线 (合并 LonSha timeline 与 手机记忆池 temporal) */
    getTimeline(limit = 40) {
        const d = this.getData();
        const out = [];
        if (d?.timeline) {
            for (const ev of d.timeline) {
                out.push({
                    source: 'lonsha',
                    time: ev.timestamp || ev.time || ev.date,
                    text: ev.text || ev.content || ev.summary || ev.title || '',
                    type: ev.type || 'event'
                });
            }
        }
        // 手机侧记忆池 temporal
        try {
            const core = window.VirtualPhone?.memoryCore;
            const pool = core?.pool?.pool;
            if (pool?.temporal) {
                for (const t of pool.temporal) {
                    out.push({ source: 'phone', time: t.createdAt, text: t.content, type: 'phone-temporal' });
                }
            }
        } catch (e) { /* 忽略 */ }
        return out
            .filter(x => x.text)
            .sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0))
            .slice(0, limit);
    }

    /** 角色日记 */
    getDiaries() {
        const d = this.getData();
        if (!d?.diaries) return [];
        return Array.isArray(d.diaries) ? d.diaries : Object.values(d.diaries);
    }

    /**
     * 反向联动: 把手机侧的高价值记忆写入 LonSha 图谱
     * 只在 LonSha 可用 + 用户开启时调用, 走官方 addNode/addEdge
     * @returns 写入节点数
     */
    pushPhoneMemories(options = {}) {
        const lm = window.LonShaMemory;
        // [v2.8.13] 优先官方写入门面 getGraphWriter(), 降级到旧 engine.graph 直访
        const graph = (typeof lm?.getGraphWriter === 'function' ? lm.getGraphWriter() : null) || lm?.engine?.graph;
        if (!graph) return 0;
        const core = window.VirtualPhone?.memoryCore;
        if (!core) return 0;
        let count = 0;
        try {
            const items = (core.longTerm || []).filter(m => (m.importance || 0) >= (options.minImportance || 7));
            const existing = new Set(
                Array.from(graph.nodes?.values?.() || []).map(n => n.content)
            );
            // 已图谱节点池 (供连边)
            const nodes = Array.from(graph.nodes?.values?.() || []);
            const charNodes = nodes.filter(n => n.type === 'character' || n.type === '角色');
            const placeNodes = nodes.filter(n => n.type === 'place' || n.type === '地点' || n.type === 'location');
            const tagIndex = {};
            for (const n of nodes) {
                for (const tg of (n.tags || [])) {
                    if (!tagIndex[String(tg).toLowerCase()]) tagIndex[String(tg).toLowerCase()] = [];
                    tagIndex[String(tg).toLowerCase()].push(n);
                }
            }

            for (const m of items) {
                if (existing.has(m.content)) continue;
                const newNodeId = graph.addNode({
                    type: 'phone-memory',
                    name: (m.tags && m.tags[0]) || '手机记忆',
                    content: m.content,
                    tags: m.tags || [],
                    metadata: { importance: m.importance, emotion: m.emotion, createdAt: m.createdAt }
                });
                count++;

                // --- B1: 自动连边 ---
                const text = String(m.content || '');
                // 1) 角色锚点: 文本包含已知角色名 → 连 (角色 -经历→ 手机记忆)
                for (const cn of charNodes) {
                    if (cn.name && text.includes(cn.name)) {
                        graph.addEdge({ from: newNodeId, to: cn.id, label: '相关经历' });
                        graph.addEdge({ from: cn.id, to: newNodeId, label: '记得' });
                    }
                }
                // 2) 地点锚点: 文本包含已知地点名 → 连 (手机记忆 -发生在→ 地点)
                for (const pn of placeNodes) {
                    if (pn.name && text.includes(pn.name)) {
                        graph.addEdge({ from: newNodeId, to: pn.id, label: '发生在' });
                    }
                }
                // 3) 同标签连边: 与已有同标签节点互联 (软关联)
                const mTags = (m.tags || []).map(x => String(x).toLowerCase());
                for (const tg of mTags) {
                    const others = (tagIndex[tg] || []).filter(n => n.id !== newNodeId).slice(0, 3);
                    for (const on of others) {
                        graph.addEdge({ from: newNodeId, to: on.id, label: '同主题' });
                    }
                }
                // 4) 时间邻近: 与同一天内写入的手机记忆互连
                if (m.createdAt) {
                    const t0 = new Date(m.createdAt).getTime();
                    for (const n of nodes) {
                        if (n.type !== 'phone-memory' || n.id === newNodeId) continue;
                        const nt = n.metadata?.createdAt ? new Date(n.metadata.createdAt).getTime() : 0;
                        if (nt && Math.abs(nt - t0) < 6 * 60 * 60 * 1000) { // 6 小时窗口
                            graph.addEdge({ from: newNodeId, to: n.id, label: '同一时段' });
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('[GraphBridge] 反向写入失败:', e);
        }
        return count;
    }

    /** 供 prompt 注入: 汇总 LonSha 召回摘要 (若手机侧需要二次注入) */
    buildRecallBlock(query, limit = 5) {
        const hits = this.search(query, limit);
        if (!hits.length) return '';
        let out = '【知识图谱关联记忆】';
        for (const h of hits.slice(0, limit)) {
            const label = h.name ? `${h.name}: ` : '';
            out += '\n- ' + label + String(h.content || h.summary || '').slice(0, 140);
        }
        return out;
    }

    invalidate() { this._cache = null; this._cacheAt = 0; }
}

export default GraphBridge;