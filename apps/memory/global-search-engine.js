/* ========================================================
 * global-search-engine.js — 小手机全局搜索内核 [v2.16.0]
 * --------------------------------------------------------
 * 现状：29 个 App 各自为政，想找「上次那句台词 / 那个联系人 / 那篇日记 /
 *   设过的那个闹钟」只能逐 App 翻。本模块是**跨 App 统一检索内核**。
 *
 * 设计原则：
 *  1) 纯函数内核：所有数据源经 `sources` 注册表注入，不直接读 window/storage，
 *     内核可单测、可移植（对齐 timeweaver-engine / memory-engine 的约定）。
 *  2) 惰性索引：首次 query 时才拉取各源（每个源独立 try/catch，坏源不影响整体）。
 *  3) 评分排序：标题命中 > 正文命中；前缀命中 > 中部命中；越新越靠前。
 *  4) 截断安全：全部字符串化 + 长度上限，避免大对象把面板拖死。
 * ======================================================== */
'use strict';

// [v2.62.0] 补源补名纯函数：cheat/dt 装配清单只存 id，经纯函数补回名字/说明（不读 window，
// 底层 cheatPacks / dirtyTalkModules 顶层纯数据，Node 可测）。
import { getCheatById } from '../cheat/cheat-data.js';
import { getModuleById } from '../dirtytalk/dt-data.js';

const MAX_SNIPPET = 120;
const MAX_SCAN_PER_SOURCE = 600;

/** 归一化：去首尾空白 + 折叠连续空白 + 小写（用于不区分大小写的匹配） */
function norm(s) {
    return String(s ?? '').replace(/\s+/g, ' ').trim();
}

function lower(s) {
    return norm(s).toLowerCase();
}

/**
 * 命中评分。
 * @returns {number} <0 表示未命中
 */
export function scoreHit(title, body, query) {
    const q = lower(query);
    if (!q) return -1;
    const t = lower(title);
    const b = lower(body);
    let score = 0;
    if (t === q) score += 100;
    else if (t.startsWith(q)) score += 80;
    else if (t.includes(q)) score += 60;
    else if (b.includes(q)) score += 30;
    else return -1;
    // 命中越靠前加权
    const pos = b.indexOf(q);
    if (pos >= 0) score += Math.max(0, 12 - Math.floor(pos / 12));
    const tpos = t.indexOf(q);
    if (tpos >= 0) score += Math.max(0, 18 - tpos);
    // 越短越精确（避免长文一段话把短标题压下去）
    score += Math.max(0, 10 - Math.floor(b.length / 200));
    return score;
}

/** 生成带高亮标记的摘要（返回 {text, hit} 便于调用方安全渲染） */
export function makeSnippet(body, query, width = MAX_SNIPPET) {
    const text = norm(body);
    const q = lower(query);
    if (!text) return { text: '', hit: false };
    if (!q) return { text: text.slice(0, width), hit: false };
    const idx = lower(text).indexOf(q);
    if (idx < 0) return { text: text.slice(0, width), hit: false };
    const start = Math.max(0, idx - Math.floor((width - q.length) / 2));
    const end = Math.min(text.length, start + width);
    const prefix = start > 0 ? '…' : '';
    const suffix = end < text.length ? '…' : '';
    return { text: prefix + text.slice(start, end) + suffix, hit: true, index: idx };
}

export class GlobalSearchEngine {
    /**
     * @param {{sources?:Array<object>}} [opts] sources: {id,label,icon,weight?,items:()=>Array}
     */
    constructor(opts = {}) {
        this._sources = [];
        this._index = null;
        this._errors = [];
        if (Array.isArray(opts.sources)) {
            for (const s of opts.sources) this.registerSource(s);
        }
    }

    /**
     * 注册数据源。
     * @param {{id:string,label:string,icon?:string,weight?:number,
     *          items:()=>Array<{title?:string,body?:string,ts?:number,appId?:string,meta?:object}>}} src
     */
    registerSource(src) {
        if (!src || typeof src.items !== 'function') return false;
        const id = String(src.id || '');
        // 幂等：同 id 重复登记会让同一份数据在结果里出现两遍。
        // （旧行为是纯 push，于是「换宿主上下文」只能靠再叠一份来实现。）
        if (id && this._sources.some(s => s.id === id)) return false;
        this._sources.push(this._normalizeSource(src));
        this._index = null;
        return true;
    }
    /**
     * 以同 id 整体换掉一个源（宿主侧数据换了新引用时用）。
     * 找不到同 id 时退化为登记。
     * @returns {boolean} true = 发生了「换」；false = 退化成了新增
     */
    replaceSource(src) {
        if (!src || typeof src.items !== 'function') return false;
        const id = String(src.id || '');
        const i = id ? this._sources.findIndex(s => s.id === id) : -1;
        if (i < 0) { this.registerSource(src); return false; }
        this._sources[i] = this._normalizeSource(src);
        this._index = null;
        return true;
    }
    /**
     * 摘掉一个源（宿主上下文从「有」变「无」，如退出会话）。
     * @returns {boolean} 是否真的摘掉了
     */
    removeSource(id) {
        const key = String(id || '');
        const i = key ? this._sources.findIndex(s => s.id === key) : -1;
        if (i < 0) return false;
        this._sources.splice(i, 1);
        this._index = null;
        return true;
    }
    /** 源描述归一化（登记 / 替换共用同一份口径，避免两份真相） */
    _normalizeSource(src) {
        return {
            id: String(src.id || ''),
            label: String(src.label || src.id || ''),
            icon: String(src.icon || '🔎'),
            weight: Number(src.weight) || 1,
            appId: String(src.appId || src.id || ''),
            items: src.items
        };
    }

    listSources() {
        return this._sources.map(s => ({ id: s.id, label: s.label, icon: s.icon, weight: s.weight }));
    }

    /** 上次索引期间各源的错误（用于自检面板） */
    lastErrors() {
        return this._errors.slice();
    }

    /** 丢掉缓存，下次 query 重新拉取 */
    invalidate() {
        this._index = null;
    }

    /**
     * 惰性构建索引（每源独立容错）。
     * @returns {Array<object>} 归一化后的条目
     */
    build() {
        if (this._index) return this._index;
        const out = [];
        const errors = [];
        for (const src of this._sources) {
            try {
                const raw = src.items() || [];
                if (!Array.isArray(raw)) continue;
                let n = 0;
                for (const it of raw) {
                    if (n >= MAX_SCAN_PER_SOURCE) break;
                    if (!it || typeof it !== 'object') continue;
                    const title = norm(it.title);
                    const body = norm(it.body);
                    if (!title && !body) continue;
                    out.push({
                        sourceId: src.id,
                        sourceLabel: src.label,
                        icon: String(it.icon || src.icon),
                        appId: String(it.appId || src.appId),
                        title: title.slice(0, 120),
                        body: body.slice(0, 600),
                        ts: Number(it.ts) || 0,
                        meta: (it.meta && typeof it.meta === 'object') ? it.meta : {}
                    });
                    n++;
                }
            } catch (e) {
                errors.push({ sourceId: src.id, error: String(e?.message || e) });
            }
        }
        this._errors = errors;
        this._index = out;
        return out;
    }

    /**
     * 检索。
     * @param {string} query
     * @param {{limit?:number, sourceIds?:string[]}} [opts]
     * @returns {{query:string, results:Array, groups:Array, total:number, scanned:number, errors:Array}}
     */
    query(query, opts = {}) {
        const q = norm(query);
        const limit = Math.max(1, Number(opts.limit) || 60);
        const allow = Array.isArray(opts.sourceIds) && opts.sourceIds.length
            ? new Set(opts.sourceIds.map(String))
            : null;
        const all = this.build();
        if (!q) {
            return { query: '', results: [], groups: [], total: 0, scanned: all.length, errors: this._errors.slice() };
        }
        const weightOf = {};
        for (const s of this._sources) weightOf[s.id] = s.weight;
        const hits = [];
        for (const it of all) {
            if (allow && !allow.has(it.sourceId)) continue;
            const score = scoreHit(it.title, it.body, q);
            if (score < 0) continue;
            const snip = makeSnippet(it.body, q);
            hits.push({
                ...it,
                score: score * (weightOf[it.sourceId] || 1),
                snippet: snip.text,
                snippetHit: !!snip.hit
            });
        }
        hits.sort((a, b) => (b.score - a.score) || (b.ts - a.ts));
        const results = hits.slice(0, limit);
        // 按源分组（保留组内排序），便于面板分区展示
        const groupMap = new Map();
        for (const r of results) {
            if (!groupMap.has(r.sourceId)) {
                groupMap.set(r.sourceId, { sourceId: r.sourceId, label: r.sourceLabel, icon: r.icon, items: [] });
            }
            groupMap.get(r.sourceId).items.push(r);
        }
        const groups = Array.from(groupMap.values()).sort((a, b) => b.items[0].score - a.items[0].score);
        return {
            query: q,
            results,
            groups,
            total: hits.length,
            scanned: all.length,
            errors: this._errors.slice()
        };
    }
}

/** 时间解析：优先毫秒时间戳，其次 'HH:MM'（按今日折算），最后字符串日期 */
function tsOf(...vals) {
    for (const v of vals) {
        const n = Number(v);
        if (Number.isFinite(n) && n > 1000000000) return n;
    }
    for (const v of vals) {
        const str = String(v || '').trim();
        if (!str) continue;
        const m = str.match(/^(\d{1,2}):(\d{2})$/);
        if (m) {
            const d = new Date();
            d.setHours(Number(m[1]) || 0, Number(m[2]) || 0, 0, 0);
            return d.getTime();
        }
        const p = Date.parse(str);
        if (Number.isFinite(p)) return p;
    }
    return 0;
}
/**
 * 酒馆正文源：每次调用都现取宿主上下文里的 chat 数组。
 * 之所以做成导出工厂而不是在 buildDefaultSources 里内联一次：
 *   内联版只认「调用那一刻」的数组引用，而搜索 App 是单例、索引源表只在
 *   构造时建一次 —— 宿主上下文晚于构造就绪会永久少这个源，
 *   换会话（数组换成新实例）后又会一直读旧会话。
 * @param {{chat?:Array}} [ctx] 宿主上下文（无宿主 / 结构不符 → null）
 * @returns {{id:string,label:string,icon:string,appId:string,weight:number,items:Function}|null}
 */
export function makeTavernSource(ctx) {
    if (!Array.isArray(ctx?.chat)) return null;
    return {
        id: 'tavern', label: '酒馆正文', icon: '📜', appId: '', weight: 1.0,
        items: () => ctx.chat.map((m, i) => ({
            title: (m?.is_user ? '我' : (m?.name || 'AI')) + ` · 第 ${i + 1} 楼`,
            body: norm(m?.mes || m?.content || ''),
            ts: tsOf(m?.send_date ? Date.parse(m.send_date) : 0),
            icon: '📜', appId: '', meta: { floor: i }
        }))
    };
}
/**
 * 从 RubyPhone 各 App 已落盘数据构建默认源注册表。
 *   每个源的 items() 都是惰性 + 独立 try/catch，任一 App 数据损坏不影响其他。
 * @param {object} storage PhoneStorage（可为 null → 返回空源，便于单测）
 * @param {{chatContext?:object}} [deps]
 */
export function buildDefaultSources(storage, deps = {}) {
    const get = (key, dflt = null) => {
        try { return storage?.get?.(key, dflt) ?? dflt; } catch (_e) { return dflt; }
    };
    const asArray = (v) => {
        if (Array.isArray(v)) return v;
        if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch (_e) { return []; } }
        return [];
    };
    const asObj = (v) => {
        if (v && typeof v === 'object' && !Array.isArray(v)) return v;
        if (typeof v === 'string') { try { const p = JSON.parse(v); return (p && typeof p === 'object') ? p : {}; } catch (_e) { return {}; } }
        return {};
    };

    /**
     * [v2.62.0] 现取记忆插件只读快照（lonsha_memory_bridge_v1）。
     * 与 chars/wallet/place/profile 等 App 的 probeBridge 同规格：先读推型 snapshot，
     * 缺失再调 refresh()。**不复制副本到手机键**（防双份真相），不写上游，只读。
     * 无桥 / 无快照 / 宿主未注入 window 时一律安全返回 null（不抛）。
     */
    const bridgeSnapshot = () => {
        try {
            const w = (typeof window !== 'undefined') ? window : null;
            const b = w && w['lonsha_memory_bridge_v1'];
            if (!b || typeof b !== 'object') return null;
            let snap = null;
            try { snap = (b.snapshot && typeof b.snapshot === 'object') ? b.snapshot : null; } catch (_e) { snap = null; }
            if (!snap && typeof b.refresh === 'function') { try { snap = b.refresh(); } catch (_e) { snap = null; } }
            return (snap && typeof snap === 'object') ? snap : null;
        } catch (_e) { return null; }
    };

    const sources = [];

    // ---- 微信：联系人 / 会话（含消息尾巴）----
    sources.push({
        id: 'wechat-chat', label: '微信会话', icon: '💬', appId: 'wechat', weight: 1.5,
        items: () => {
            const d = asObj(get('wechat_data', {}));
            const out = [];
            // 联系人：正文只有备注/关系/来源这类短字段（签名等长字段实际不存在，不留死代码）
            for (const c of asArray(d.contacts)) {
                if (!c) continue;
                out.push({
                    title: String(c.name || c.nickname || c.remark || '未命名联系人'),
                    body: norm([c.remark, c.relation, c.sourceLabel].filter(Boolean).join(' · ')),
                    ts: tsOf(c.updatedAt, c.lastTime),
                    icon: '👤', appId: 'wechat'
                });
            }
            // 会话：消息正文不在 chats[] 里，而在独立分片键 wechat_msg_<chatId>（大厅模式为
            //   phone_wechat_msg_lobby_<chatId>），此处读分片取最近数条做尾巴（读不到则仅索引会话名）。
            for (const ch of asArray(d.chats || d.conversations)) {
                if (!ch) continue;
                const chatId = String(ch.id || '').trim();
                let msgs = asArray(ch.messages);
                if (!msgs.length && chatId) {
                    msgs = asArray(get(`wechat_msg_${chatId}`));
                    if (!msgs.length) msgs = asArray(get(`phone_wechat_msg_lobby_${chatId}`));
                }
                const tail = msgs.slice(-8)
                    .map(m => norm(m?.content || m?.text || m?.specialMessage?.content || ''))
                    .filter(Boolean).join(' ');
                out.push({
                    title: String(ch.name || ch.title || '未命名会话'),
                    body: tail,
                    ts: tsOf(ch.timestamp, ch.updatedAt, ch.lastTime),
                    icon: ch.type === 'group' ? '👥' : '💬', appId: 'wechat'
                });
            }
            return out;
        }
    });

    // ---- 朋友圈（字段实证：name / text / commentList[{name,text}] / timestamp）----
    sources.push({
        id: 'wechat-moments', label: '朋友圈', icon: '🖼️', appId: 'wechat', weight: 1.2,
        items: () => {
            const d = asObj(get('wechat_data', {}));
            return asArray(d.moments).map(m => ({
                title: String(m?.name || '') + (m?.isUserPost ? '（我）' : ''),
                body: norm([
                    m?.text,
                    ...asArray(m?.commentList).map(c => [c?.name, c?.text].filter(Boolean).join('：'))
                ].filter(Boolean).join(' ')),
                ts: tsOf(m?.timestamp),
                icon: '🖼️', appId: 'wechat'
            }));
        }
    });

    // ---- 日记（字段实证：title / date / content / author / createdAt）----
    sources.push({
        id: 'diary', label: '日记', icon: '📔', appId: 'diary', weight: 1.4,
        items: () => asArray(get('diary_entries')).map(e => ({
            title: String(e?.title || e?.date || '一篇日记'),
            body: norm([e?.author, e?.content || e?.body].filter(Boolean).join(' · ')),
            ts: tsOf(e?.createdAt, e?.ts),
            icon: '📔', appId: 'diary'
        }))
    });

    // ---- 短信（会话里 messages[].text；会话无 lastTime，用 messages 尾部时间兜底）----
    sources.push({
        id: 'phone-sms', label: '短信', icon: '📩', appId: 'phone', weight: 1.3,
        items: () => asArray(get('phone_call_sms_conversations')).map(c => {
            if (!c) return null;
            const msgs = asArray(c.messages);
            return {
                title: String(c.name || c.contact || c.number || '短信会话'),
                body: msgs.map(m => norm(m?.text || m?.content || '')).filter(Boolean).join(' '),
                ts: tsOf(c.updatedAt, c.createdAt, msgs[msgs.length - 1]?.createdAt),
                icon: '📩', appId: 'phone'
            };
        }).filter(Boolean)
    });

    // ---- 通话记录（字段实证：caller / time / date / status / transcript）----
    sources.push({
        id: 'phone-call', label: '通话记录', icon: '📞', appId: 'phone', weight: 1.1,
        items: () => asArray(get('phone_call_history')).map(h => ({
            title: String(h?.caller || h?.name || h?.number || '通话'),
            body: norm([
                h?.status,
                Array.isArray(h?.transcript) ? h.transcript.map(t => t?.content || t?.text || '').join(' ') : ''
            ].filter(Boolean).join(' · ')),
            ts: tsOf(h?.ts, h?.timestamp, h?.date),
            icon: '📞', appId: 'phone'
        }))
    });

    // ---- 织光机收藏册（字段实证：title / paragraphs[] / ts / savedAt）----
    sources.push({
        id: 'timeweaver', label: '织光机', icon: '🕰️', appId: 'timeweaver', weight: 1.3,
        items: () => asArray(get('tw_letters')).map(l => ({
            title: String(l?.title || '一段被织起的时光'),
            body: norm(asArray(l?.paragraphs).join(' ')),
            ts: tsOf(l?.ts, l?.savedAt),
            icon: '🕰️', appId: 'timeweaver'
        }))
    });

    // ---- 日历备忘（字段实证：title / dateKey / time / createdAt；无 content 字段）----
    sources.push({
        id: 'calendar', label: '日历备忘', icon: '📅', appId: 'calendar', weight: 1.2,
        items: () => asArray(get('calendar_memos')).map(m => ({
            title: String(m?.title || '备忘'),
            body: norm([m?.dateKey, m?.time, m?.source].filter(Boolean).join(' · ')),
            ts: tsOf(m?.createdAt),
            icon: '📅', appId: 'calendar'
        }))
    });

    // ---- 音乐歌单（字段实证：name / artist；无 addedAt）----
    sources.push({
        id: 'music', label: '音乐', icon: '🎵', appId: 'music', weight: 1.0,
        items: () => asArray(get('music_playlist')).map(s => ({
            title: String(s?.name || s?.title || '歌曲'),
            body: norm([s?.artist, s?.album].filter(Boolean).join(' · ')),
            ts: tsOf(s?.addedAt),
            icon: '🎵', appId: 'music'
        }))
    });

    // ---- 世界脉搏历史：key 为 worldpulse_history_v1，元素 {style,content,floorCount,createdAt} ----
    sources.push({
        id: 'worldpulse', label: '世界脉搏', icon: '🌍', appId: 'worldpulse', weight: 1.2,
        items: () => asArray(get('worldpulse_history_v1')).map(e => ({
            title: String(e?.style || '世界事件') + (e?.floorCount ? ` · 第 ${e.floorCount} 楼` : ''),
            body: norm(e?.content || e?.text || e?.summary || ''),
            ts: tsOf(e?.createdAt, e?.ts),
            icon: '🌍', appId: 'worldpulse'
        }))
    });

    // ---- 微博（热搜 title / 推荐帖 blogger + content）----
    sources.push({
        id: 'weibo', label: '微博', icon: '👁️‍🗨️', appId: 'weibo', weight: 1.1,
        items: () => {
            const hs = asArray(get('weibo_hot_searches')).map(h => ({
                title: String(h?.title || h?.word || h || '热搜'),
                body: String(h?.tag || ''),
                ts: 0, icon: '🔥', appId: 'weibo'
            }));
            const posts = asArray(get('weibo_recommend_posts')).map(p => ({
                title: String(p?.blogger || p?.author || p?.user || '微博'),
                body: norm(p?.content || p?.text || ''),
                ts: tsOf(p?.ts),
                icon: '👁️‍🗨️', appId: 'weibo'
            }));
            return [...posts, ...hs];
        }
    });

    // ---- 记忆系统（longTerm 元素：content / role / floor / metadata）----
    sources.push({
        id: 'memory', label: '记忆', icon: '🧠', appId: 'memory', weight: 1.2,
        items: () => {
            const core = asObj(get('memory_core_v1')) || asObj(get('memory_core'));
            return asArray(core.longTerm || core.memories).map(m => ({
                title: String(m?.title || m?.place || (m?.role === 'user' ? '关于我' : '关于她') || '记忆条目'),
                body: norm(m?.content || m?.text || ''),
                ts: tsOf(m?.ts, m?.createdAt, Date.parse(String(m?.metadata?.lastActive || '')) || 0),
                icon: '🧠', appId: 'memory'
            }));
        }
    });

    // ---- 阅读书架（key 为 ruby_reading_shelf；字段 title / author / addedAt / chapterCount）----
    sources.push({
        id: 'reading', label: '阅读', icon: '📖', appId: 'reading', weight: 1.0,
        items: () => asArray(get('ruby_reading_shelf') ?? get('ruby_reading_books')).map(b => ({
            title: String(b?.title || b?.name || '书籍'),
            body: norm([b?.author, b?.fileName, b?.chapterCount ? `${b.chapterCount} 章` : ''].filter(Boolean).join(' · ')),
            ts: tsOf(b?.addedAt, b?.updatedAt),
            icon: '📖', appId: 'reading'
        }))
    });

    // ---- 成就（ruby_unlocked_achievements 是 {成就id: 解锁时间戳} 映射，
    //      成就名/说明在 data/achievements.json 目录里，运行时经 achievementApp 取目录）----
    sources.push({
        id: 'achievement', label: '成就', icon: '🏆', appId: 'achievement', weight: 1.0,
        items: () => {
            const map = asObj(get('ruby_unlocked_achievements'));
            const catalog = _achievementCatalog();
            return Object.keys(map).map(id => {
                const meta = catalog.get(id) || null;
                return {
                    title: String(meta?.name || id),
                    body: norm([meta?.cat, meta?.intro].filter(Boolean).join(' · ')),
                    ts: tsOf(map[id]),
                    icon: '🏆', appId: 'achievement',
                    meta: { achievementId: id }
                };
            });
        }
    });

    // ---- 小红书（title / content / author）----
    sources.push({
        id: 'xhs', label: '小红书', icon: '📕', appId: 'xhs', weight: 1.1,
        items: () => asArray(get('ruby_xhs_notes')).map(n => ({
            title: String(n?.title || '笔记'),
            body: norm([n?.author, n?.content || n?.text].filter(Boolean).join(' · ')),
            ts: tsOf(n?.ts),
            icon: '📕', appId: 'xhs'
        }))
    });

    // ---- 贴吧（title / content / author）----
    sources.push({
        id: 'tieba', label: '贴吧', icon: '💬', appId: 'tieba', weight: 1.1,
        items: () => asArray(get('ruby_tieba_posts')).map(p => ({
            title: String(p?.title || '帖子'),
            body: norm([p?.author, p?.content || p?.text].filter(Boolean).join(' · ')),
            ts: tsOf(p?.ts),
            icon: '💬', appId: 'tieba'
        }))
    });

    // ---- 通知中心（sys_notifs，含全部历史通知）----
    sources.push({
        id: 'notifications', label: '通知', icon: '🔔', appId: 'notifications', weight: 1.0,
        items: () => asArray(get('sys_notifs')).map(n => ({
            title: String(n?.title || '通知'),
            body: norm([n?.meta?.name, n?.message].filter(Boolean).join(' · ')),
            ts: tsOf(n?.ts),
            icon: '🔔', appId: 'notifications'
        }))
    });

    // ---- 酒馆正文楼层（若注入 chatContext）----
    const tavernSrc = makeTavernSource(deps.chatContext);
    if (tavernSrc) sources.push(tavernSrc);

    // ============ [v2.62.0] 补源：此前 29 个 App 中以下 12 个各自为政、全库零搜索接入 ============
    // 纪律：本地键源走 storage.get（容错），桥面源走 bridgeSnapshot() 现取（不复制副本到手机键，
    //   不写上游，无桥/无快照/无宿主 window 一律安全返回 []，坏数据不拖垮整体）。

    // ---- 万界武库：装配清单（cheat_state_v1.installed[]，id 经纯函数补名）----
    sources.push({
        id: 'cheat', label: '武库', icon: '🗡️', appId: 'cheat', weight: 1.0,
        items: () => {
            const state = asObj(get('cheat_state_v1'));
            const ids = asArray(state.installed).map(x => String(x)).filter(Boolean);
            const out = [];
            for (const id of ids) {
                const p = getCheatById(id);
                if (!p) continue; // 未知 id 如实丢弃（与 cheat-app 的 sanitize 口径一致）
                out.push({ title: String(p.name || id), body: norm([p.type, p.quality, p.desc].filter(Boolean).join(' · ')), icon: '🗡️', appId: 'cheat', meta: { id } });
            }
            return out;
        }
    });

    // ---- 撩语：装配清单（dt_state_v1.installed[]，id 经纯函数补名）----
    sources.push({
        id: 'dirtytalk', label: '撩语', icon: '💋', appId: 'dirtytalk', weight: 1.0,
        items: () => {
            const state = asObj(get('dt_state_v1'));
            const ids = asArray(state.installed).map(x => String(x)).filter(Boolean);
            const out = [];
            for (const id of ids) {
                const m = getModuleById(id);
                if (!m) continue;
                out.push({ title: String(m.name || id), body: norm([m.cat, m.label, m.tier, m.desc].filter(Boolean).join(' · ')), icon: '💋', appId: 'dirtytalk', meta: { id } });
            }
            return out;
        }
    });

    // ---- 幸运转盘：抽卡记录（ruby_gacha_state.history[]，带道具名/品质/花费/时间）----
    sources.push({
        id: 'gacha', label: '幸运转盘', icon: '🎰', appId: 'gacha', weight: 0.9,
        items: () => {
            const d = asObj(get('ruby_gacha_state'));
            const hist = Array.isArray(d.history) ? d.history : [];
            const out = [];
            for (const h of hist.slice(-20)) {
                if (!h || typeof h !== 'object') continue;
                const got = asArray(h.got).map(g => g && [g.name, g.quality].filter(Boolean).join(':')).filter(Boolean).join('、');
                out.push({
                    title: got ? ('抽卡：' + got.slice(0, 30)) : '抽卡记录',
                    body: norm([h.poolId, h.cost ? '花费 ' + h.cost : ''].filter(Boolean).join(' · ')),
                    ts: tsOf(h.at), icon: '🎰', appId: 'gacha'
                });
            }
            return out;
        }
    });

    // ---- 生理：周期/妊娠/病症/胎儿（ruby_health_cycle，独立会话键，对象形态）----
    sources.push({
        id: 'health', label: '生理', icon: '🩺', appId: 'health', weight: 1.0,
        items: () => {
            const d = asObj(get('ruby_health_cycle'));
            if (!Object.keys(d).length) return [];
            const out = [];
            const parts = [];
            if (d.stage) parts.push('阶段 ' + d.stage);
            if (Number.isFinite(d.cycleDay)) parts.push('周期第 ' + d.cycleDay + ' 天');
            if (d.isPregnant) parts.push('妊娠' + (d.pregnantDays != null ? ' 第 ' + d.pregnantDays + ' 天' : ''));
            if (d.race) parts.push(d.race);
            if (parts.length) out.push({ title: '生理状态', body: norm(parts.join(' · ')), icon: '🩺', appId: 'health' });
            for (const c of asArray(d.conditions)) {
                if (c && typeof c === 'object' && c.name) out.push({ title: '病症：' + norm(c.name), body: norm([c.severity, c.desc].filter(Boolean).join(' · ')), icon: '🤒', appId: 'health' });
            }
            for (const f of asArray(d.fetuses)) {
                if (f && typeof f === 'object') out.push({ title: '胎儿', body: norm([f.race, f.name].filter(Boolean).join(' · ')), icon: '👶', appId: 'health' });
            }
            return out;
        }
    });

    // ---- 相册：本地上传索引（phone_album_upload_index，数组 {path,prefix,createdAt}）----
    sources.push({
        id: 'album', label: '相册', icon: '🖼️', appId: 'album', weight: 0.9,
        items: () => {
            const list = asArray(get('phone_album_upload_index'));
            const out = [];
            for (const item of list) {
                const path = typeof item === 'string' ? item : (item && item.path) || '';
                if (!path) continue;
                const fname = String(path).split('/').pop() || '媒体';
                const prefix = (typeof item === 'object' && item.prefix) ? item.prefix : '';
                out.push({ title: fname, body: norm(prefix), ts: tsOf(typeof item === 'object' ? item.createdAt : 0), icon: '🖼️', appId: 'album' });
            }
            return out;
        }
    });

    // ---- 档案：主角档案 + 生活小档案（桥 snapshot.protagonist / lifeDetails）----
    sources.push({
        id: 'profile', label: '档案', icon: '🪪', appId: 'profile', weight: 1.2,
        items: () => {
            const snap = bridgeSnapshot();
            if (!snap) return [];
            const out = [];
            const prot = (snap.protagonist && typeof snap.protagonist === 'object') ? snap.protagonist : null;
            if (prot && Object.keys(prot).length) {
                const kv = Object.entries(prot).filter(([k, v]) => v != null && v !== '' && typeof v !== 'object').map(([k, v]) => k + ': ' + v).join(' · ');
                if (kv) out.push({ title: '主角档案', body: norm(kv), icon: '🪪', appId: 'profile' });
            }
            for (const d of asArray(snap.lifeDetails)) {
                if (!d || typeof d !== 'object') continue;
                out.push({ title: norm(d.text).slice(0, 30) || '生活细节', body: norm([d.tier, (d.topics || []).join('、')].filter(Boolean).join(' · ')), ts: tsOf(d.until), icon: '🪪', appId: 'profile' });
            }
            return out;
        }
    });

    // ---- 剧情线：大纲阶段 + 承诺 + 支线（桥 snapshot.outline / worldProg）----
    sources.push({
        id: 'plotline', label: '剧情线', icon: '🎬', appId: 'plotline', weight: 1.2,
        items: () => {
            const snap = bridgeSnapshot();
            if (!snap) return [];
            const out = [];
            const outline = (snap.outline && typeof snap.outline === 'object') ? snap.outline : null;
            const stage = (outline && outline.stage && typeof outline.stage === 'object') ? outline.stage : null;
            if (stage && (stage.title || stage.goal)) {
                out.push({ title: norm(stage.title) || '当前阶段', body: norm([stage.goal, stage.tempo].filter(Boolean).join(' · ')), icon: '🎬', appId: 'plotline' });
                for (const n of asArray(stage.nodes)) {
                    if (n && typeof n === 'object' && (n.title || n.goal)) out.push({ title: norm(n.title) || '节点', body: norm(n.goal), icon: '🎬', appId: 'plotline' });
                }
            }
            const wp = (snap.worldProg && typeof snap.worldProg === 'object') ? snap.worldProg : null;
            if (wp) {
                for (const p of asArray(wp.promises)) {
                    if (p && typeof p === 'object') out.push({ title: '承诺：' + (norm(p.content).slice(0, 26) || '—'), body: norm([p.character, p.status, p.deadlineFloor ? '第 ' + p.deadlineFloor + ' 楼' : ''].filter(Boolean).join(' · ')), icon: '🤝', appId: 'plotline' });
                }
                for (const a of asArray(wp.plotArcs)) {
                    if (a && typeof a === 'object' && (a.title || a.clue)) out.push({ title: norm(a.title) || '支线', body: norm([a.clue, a.status].filter(Boolean).join(' · ')), icon: '🧵', appId: 'plotline' });
                }
            }
            return out;
        }
    });

    // ---- 群像：被追踪角色状态表（桥 snapshot.characters）----
    sources.push({
        id: 'chars', label: '群像', icon: '🎭', appId: 'chars', weight: 1.1,
        items: () => {
            const snap = bridgeSnapshot();
            if (!snap || !snap.characters || typeof snap.characters !== 'object') return [];
            const out = [];
            for (const [name, raw] of Object.entries(snap.characters)) {
                const e = raw && typeof raw === 'object' ? raw : {};
                const fields = (e.fields && typeof e.fields === 'object') ? Object.entries(e.fields).map(([k, v]) => v == null ? '' : k + ':' + v).filter(Boolean).join(' · ') : '';
                const todos = asArray(e.todos).map(t => t && t.text).filter(Boolean).join('、');
                out.push({ title: String(name), body: norm([fields, todos ? '待办:' + todos : ''].filter(Boolean).join(' · ')), ts: tsOf(e.updatedAt), icon: '🎭', appId: 'chars', meta: { floor: e.floor } });
            }
            return out;
        }
    });

    // ---- 时计：剧情时间 + 闪回（桥 snapshot.clock）----
    sources.push({
        id: 'clock', label: '时计', icon: '⏰', appId: 'clock', weight: 1.0,
        items: () => {
            const snap = bridgeSnapshot();
            if (!snap || !snap.clock || typeof snap.clock !== 'object') return [];
            const c = snap.clock;
            const out = [];
            if (c.date || c.label) out.push({ title: norm(c.date) || '剧情时间', body: norm([c.label, c.precision, c.turn ? '第 ' + c.turn + ' 层' : ''].filter(Boolean).join(' · ')), icon: '⏰', appId: 'clock' });
            if (c.lastFlashback && c.lastFlashback.date) out.push({ title: '闪回：' + norm(c.lastFlashback.date), body: norm([c.lastFlashback.label, c.lastFlashback.floor ? '第 ' + c.lastFlashback.floor + ' 楼' : ''].filter(Boolean).join(' · ')), icon: '↩️', appId: 'clock' });
            return out;
        }
    });

    // ---- 世界账本：账本读数（桥 snapshot.worldLedgerRead）----
    sources.push({
        id: 'ledger', label: '世界账本', icon: '📚', appId: 'ledger', weight: 1.0,
        items: () => {
            const snap = bridgeSnapshot();
            if (!snap || !snap.worldLedgerRead || typeof snap.worldLedgerRead !== 'object') return [];
            const w = snap.worldLedgerRead;
            if (!w.ok) return [];
            const counts = (w.counts && typeof w.counts === 'object') ? ('暗流 ' + (w.counts.currents || 0) + ' / 事实 ' + (w.counts.facts || 0) + ' / 人物 ' + (w.counts.people || 0)) : '';
            return [{ title: '世界账本', body: norm([w.describe, counts].filter(Boolean).join(' · ')), ts: tsOf(w.at), icon: '📚', appId: 'ledger' }];
        }
    });

    // ---- 钱袋：账户余额 + 流水（桥 snapshot.moneyLedger）----
    sources.push({
        id: 'wallet', label: '钱袋', icon: '💰', appId: 'wallet', weight: 1.1,
        items: () => {
            const snap = bridgeSnapshot();
            if (!snap || !snap.moneyLedger || typeof snap.moneyLedger !== 'object') return [];
            const ml = snap.moneyLedger;
            const out = [];
            const money = (ml.money && typeof ml.money === 'object') ? ml.money : {};
            for (const [k, a] of Object.entries(money)) {
                const acc = a && typeof a === 'object' ? a : {};
                out.push({ title: String(acc.name || k), body: norm([acc.amount != null ? acc.amount + ' 元' : '', acc.floor ? '第 ' + acc.floor + ' 楼记账' : ''].filter(Boolean).join(' · ')), icon: '💰', appId: 'wallet' });
            }
            const log = Array.isArray(ml.moneyLog) ? ml.moneyLog : [];
            for (const x of log.slice(-20)) {
                if (!x || typeof x !== 'object') continue;
                out.push({ title: String(x.name || x.key || '流水'), body: norm([x.desc, x.delta != null ? (x.delta >= 0 ? '+' : '') + x.delta + ' 元' : '', x.floor ? '第 ' + x.floor + ' 楼' : ''].filter(Boolean).join(' · ')), ts: tsOf(x.timestamp), icon: '💰', appId: 'wallet' });
            }
            return out;
        }
    });

    // ---- 地点：位置链 + 在场（桥 snapshot.scene）----
    sources.push({
        id: 'place', label: '地点', icon: '📍', appId: 'place', weight: 1.1,
        items: () => {
            const snap = bridgeSnapshot();
            if (!snap || !snap.scene || typeof snap.scene !== 'object') return [];
            const sc = snap.scene;
            if (sc.empty === true || sc.absent === true) return [];
            const out = [];
            const chain = (typeof sc.currentLine === 'string' ? sc.currentLine : (typeof sc.current === 'string' ? sc.current : ''));
            if (chain) out.push({ title: '当前位置', body: norm(chain), icon: '📍', appId: 'place' });
            for (const rec of asArray(sc.presence)) {
                if (!rec || typeof rec !== 'object') continue;
                out.push({ title: String(rec.name || '在场'), body: norm([rec.key, rec.atFloor ? '第 ' + rec.atFloor + ' 楼' : ''].filter(Boolean).join(' · ')), icon: '📍', appId: 'place' });
            }
            return out;
        }
    });

    return sources;
}

/** 成就目录（id → 名称/分类/说明）；运行时由成就 App 提供，缺失则只索引 id */
function _achievementCatalog() {
    try {
        const app = (typeof window !== 'undefined') ? window.VirtualPhone?.achievementApp : null;
        const data = app?.data || app?.achievementData || app || null;
        const list = Array.isArray(data?.achievementsCatalog) ? data.achievementsCatalog : [];
        const map = new Map();
        for (const a of list) {
            if (a && a.id) map.set(String(a.id), a);
        }
        return map;
    } catch (_e) { return new Map(); }
}

export default GlobalSearchEngine;