/**
 * worldpulse-engine.js — [v2.9.0 原创缝合] 世界脉搏引擎（纯函数）
 *
 * 【来源】缝合 yexiaoxiaoye/mobile 的 parallel-events-app 机制：
 *   楼层变化监听 → 队列化(maxQueue) → 阈值触发(threshold) → 风格化 prompt →
 *   AI 生成「与主线相关但不干扰的平行事件」。
 * 【差异化原创】mobile 仓的平行事件只「注回楼层正文」；世界脉搏则落地为
 *   织光机的姊妹——把平行事件写成「手机侧可消费的世界动态」（通知/微博/
 *   头条风格碎片），让背景世界在用户的数字生活里「呼吸」，而非污染正文。
 *
 * 纯 ESM export（对齐 drives-engine/jiwen-engine 约定）。纯函数无 window 依赖，
 * 时间戳/随机由调用方注入，保证可测。
 */

export const WP_STYLES = {
    '都市日常': '贴近都市生活的背景小事：街角咖啡店的偶遇、地铁里的插曲、邻里的动静。',
    '财经头条': '像新闻快讯的商业/财经动态：公司并购、市场波动、新品发布。',
    '娱乐八卦': '娱乐圈/社交平台的瓜：明星绯闻、热搜话题、网红动态。',
    '科幻未来': '近未来的科技/社会事件：新科技突破、太空进展、AI 趣闻。',
    '悬疑异闻': '带点神秘色彩的都市传说/奇闻：失踪案、未解之谜、诡异巧合。',
    '自定义': ''
};

const MAX_QUEUE = 10;         // 事件队列上限（mobile 仓 maxQueueSize 同款）
const DEFAULT_THRESHOLD = 5;  // 每 N 楼触发一次（mobile 仓 threshold 同款）
const MAX_HISTORY = 60;       // 已生成事件历史上限

/** 默认设置 */
export function defaultSettings() {
    return {
        enabled: true,
        style: '都市日常',
        customPrefix: '',
        threshold: DEFAULT_THRESHOLD,
        autoGenerate: true,
        maxQueueSize: MAX_QUEUE,
        // [v2.35.0] 真世界优先：脉冲时**先消费 WorldAxis 的真世界状态**（不调 LLM），
        //   有真事件就陈述真事件；只有在真世界不可用（桥未装/未启用/无快照）时，
        //   才退回原「调 LLM 现编平行事件」的路径。默认开启——凭空发明平行世界
        //   本来就是这套体系最该修的那处「两个世界对不上」。
        useRealWorld: true,
        // 一次脉冲最多落几条真世界条目（封顶靠投影层 maxEntries，与队列容量同一量级）
        realWorldMax: 6
    };
}

/**
 * 楼层变化判定：是否应触发一次平行事件生成。
 * @param {number} lastFloorCount 上次处理时的楼层数
 * @param {number} currentFloorCount 当前楼层数
 * @param {number} threshold 阈值（每 N 楼一次）
 * @returns {boolean}
 */
export function shouldTrigger(lastFloorCount, currentFloorCount, threshold = DEFAULT_THRESHOLD) {
    const th = Math.max(1, Number(threshold) || DEFAULT_THRESHOLD);
    const delta = Math.max(0, Number(currentFloorCount) - Number(lastFloorCount));
    return delta >= th;
}

/**
 * 事件入队（容量上限，满了丢最旧）。返回新队列。
 * @param {Array} queue 现有队列
 * @param {object} event { style, customPrefix, manual, floorCount, id, enqueuedAt }
 * @param {number} maxQueue 容量
 */
/** [v2.85] 平行事件分层。near=近场（同场景可被主线瞥见），far=远场（只作背景呼吸）。缺省 near。 */
export const WP_LAYERS = Object.freeze(['near', 'far']);

export function enqueue(queue, event, maxQueue = MAX_QUEUE) {
    const q = Array.isArray(queue) ? [...queue] : [];
    const layer = WP_LAYERS.includes(event.layer) ? event.layer : 'near';
    q.push({
        id: event.id || `wp_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        style: event.style || '都市日常',
        customPrefix: event.customPrefix || '',
        manual: !!event.manual,
        layer,
        floorCount: Number(event.floorCount) || 0,
        enqueuedAt: Number(event.enqueuedAt) || Date.now()
    });
    const cap = Math.max(1, Number(maxQueue) || MAX_QUEUE);
    while (q.length > cap) q.shift();   // 丢最旧（mobile 仓同款）
    return q;
}

/**
 * [v2.85] 按层切开队列。未知层并入 near，不另造第三层。
 * 近场可被主线消费；远场只留在背景，不得当成正在发生的事。
 */
export function splitLayers(queue) {
    const near = [];
    const far = [];
    for (const item of (Array.isArray(queue) ? queue : [])) {
        if (!item || typeof item !== 'object') continue;
        if (item.layer === 'far') far.push(item);
        else near.push(item);
    }
    return { near, far };
}

/**
 * 构建平行事件生成 prompt（缝合 mobile 仓 buildEventPrompt + 风格管理器思路）。
 * @param {string} style 风格名（WP_STYLES 键）
 * @param {string} customPrefix 自定义前缀（自定义风格时为完整 prompt）
 * @param {string} storyContext 最近正文剧情上下文（剥标签后的「说话人：内容」行，可空）
 */
export function buildEventPrompt(style, customPrefix = '', storyContext = '') {
    // 自定义风格：前缀即完整指令（mobile 仓同款）
    if (style === '自定义') {
        if (customPrefix && customPrefix.trim()) return customPrefix.trim();
        return `你是一个专业的平行事件生成器。请根据当前对话内容生成一个有趣的平行事件。
要求：
- 事件应该与当前对话相关但不直接干扰主线
- 可以是背景事件、环境变化或相关角色的行动
- 使用第三人称视角描述
- 长度控制在100-200字
- 内容要有趣且符合设定
请直接生成平行事件内容，不要包含其他解释。`;
    }

    const styleHint = WP_STYLES[style] || WP_STYLES['都市日常'];
    const ctxBlock = storyContext
        ? `【最近剧情参考】\n${storyContext}\n\n`
        : '';
    return `${ctxBlock}你是一个「世界脉搏」平行事件生成器。当前主线剧情之外，这个世界仍在运转。请生成一条「${style}」风格的平行事件，作为用户手机里刷到的动态/通知/快讯。

风格基调：${styleHint}

硬性要求：
1. 与当前剧情世界相关（同城市/同时代/同背景），但绝不直接干预主线、绝不点名主角正在做的事。
2. 写成「手机推送/快讯/短动态」的口吻，不是小说正文，不要旁白叙事腔。
3. 长度 60-160 字，一条即可，不要标题党序号、不要 Markdown。
4. 可以出现路人、商家、机构、网络话题等背景元素，让世界显得在呼吸。
5. 只输出事件正文，不要任何解释、引号或前缀。`;
}

/**
 * 清洗 AI 返回的事件正文（剥 think / 引号 / 前缀 / 截断）。
 */
export function sanitizeEvent(raw, maxLen = 200) {
    let t = String(raw || '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/^[\s\S]*?<\/think>/i, '')
        .trim();
    // 剥常见前缀「事件：」「平行事件：」「快讯：」
    t = t.replace(/^(平行事件|事件|快讯|推送|动态|通知)[:：]\s*/i, '');
    // 剥首尾引号
    t = t.replace(/^["'「『]+|["'」』]+$/g, '').trim();
    // 取首段（AI 多段时只留第一条）
    t = t.split(/\n\s*\n/)[0].trim();
    const cap = Math.max(40, Number(maxLen) || 200);
    if (t.length > cap) t = t.slice(0, cap).replace(/[,，、;；\s]+$/, '') + '…';
    return t;
}

/**
 * 历史入册（上限截断）。返回新历史数组。
 * @param {Array} history
 * @param {object} entry { id, style, content, floorCount, createdAt }
 */
export function pushHistory(history, entry) {
    const h = Array.isArray(history) ? [...history] : [];
    if (entry && entry.content) {
        h.push({
            id: entry.id || `wp_${Date.now()}`,
            style: entry.style || '都市日常',
            content: String(entry.content),
            floorCount: Number(entry.floorCount) || 0,
            createdAt: Number(entry.createdAt) || Date.now()
        });
    }
    while (h.length > MAX_HISTORY) h.shift();
    return h;
}

/**
 * 组装最近剧情上下文（供 prompt 参考，剥标签后的「说话人：内容」行）。
 * @param {object|null} ctx SillyTavern context
 * @param {number} n 最近 n 楼
 */
export function recentStoryDigest(ctx, n = 6) {
    try {
        if (!ctx || !Array.isArray(ctx.chat) || n <= 0) return '';
        const userName = ctx.name1 || '用户';
        return ctx.chat.slice(-n).map(m => {
            const speaker = m.is_user ? userName : (m.name || ctx.name2 || '角色');
            const clean = String(m.mes || m.content || '')
                .replace(/<[^>]*>/g, '')
                .replace(/\[[^\]]*消息[:：][^\]]*\]/gi, '')
                .trim();
            return clean.length > 3 ? `${speaker}：${clean.slice(0, 120)}` : '';
        }).filter(Boolean).join('\n');
    } catch (_e) { return ''; }
}

/* ============================================================
 * [v2.35.0] 真世界状态投影面
 * ------------------------------------------------------------
 * 修前实测：本 App 的平行事件**全部由 LLM 现编**（buildEventPrompt → callAI），
 * 而 WorldAxis 已经推演出一个真·世界状态（世界钟 / 权威事实 / 暗流 / 舆情）
 * 却零消费。结果「世界脉搏」报的是一个**凭空发明的平行世界**——它与正文里
 * 真正发生过的世界变化无关，甚至互相矛盾（同一个剧情里两个世界对不上）。
 *
 * 本节把 WorldAxis 快照投影成本 App 的历史条目形态（纯函数、无副作用），
 * 使「世界脉搏」可以**陈述真事件**而不是编事件。语言模型的活留给「风格化改写」，
 * 事实来源换成真推演结果——这是本版的核心转向。
 * ============================================================ */

/** 投影条目种类 → 展示用风格名（view 的 STYLE_ICON 会为未知键兜底为 🌍） */
export const WA_KINDS = {
    fact: '世界事实',
    current: '暗流',
    pulse: '世界压力',
    news: '已核实新闻',
    rumor: '论坛传闻',
    sandbox: '闲逛见闻'
};

/** 条目截断（与 sanitizeEvent 同量级，防止一条超长事实撑爆历史卡片） */
function clip(v, n = 200) {
    const s = String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim();
    return (n && s.length > n) ? (s.slice(0, n).replace(/[,，、;；\s]+$/, '') + '…') : s;
}

/**
 * 把 WorldAxis 快照投影成世界脉搏条目。
 *
 * @param {object|null} snapshot WorldAxis 的只读快照（worldClock/pulse/digest/currents/facts/people/opinion）
 * @param {{maxEntries?:number, maxLen?:number, kindFilter?:string[]|null, existingIds?:string[]}} opts
 * @returns {{ ok:boolean, entries:Array, counts:object, dropped:number }}
 *   entries[].id 带 `wa:` 前缀 —— 与 LLM 生成条目（`wp…`）天然不撞，去重只看历史既有 id。
 *   任何字段缺失/畸形都不抛：缺的就少投一条，counts 如实记数。
 */
export function projectWorldAxis(snapshot, opts = {}) {
    const counts = { fact: 0, current: 0, pulse: 0, news: 0, rumor: 0, sandbox: 0 };
    const out = [];
    if (!snapshot || typeof snapshot !== 'object') return { ok: false, entries: out, counts, dropped: 0 };
    const maxEntries = Math.max(1, Number(opts.maxEntries) || 8);
    const maxLen = Math.max(40, Number(opts.maxLen) || 200);
    const filter = Array.isArray(opts.kindFilter) && opts.kindFilter.length ? new Set(opts.kindFilter) : null;
    const seen = new Set(Array.isArray(opts.existingIds) ? opts.existingIds.map(String) : []);
    const floorCount = Number(snapshot.floor) || 0;
    const at0 = Number(snapshot.exportedAt) || 0;
    const push = (kind, id, content, extra = {}) => {
        if (filter && !filter.has(kind)) return;
        counts[kind] += 1;
        const c = clip(content, maxLen);
        if (!c) return;                       // 空内容不投（与 pushHistory 的空内容不入册同规格）
        const full = String(id || `${kind}`);
        if (seen.has(full)) return;           // 历史里已有 ⇒ 不重复
        seen.add(full);
        out.push({
            id: full,
            style: WA_KINDS[kind] || '世界动态',
            content: c,
            floorCount,
            source: 'worldaxis',
            kind,
            at: at0,
            ...extra
        });
    };

    // ① 权威事实（已结算、不再变——外部引用世界事实时的唯一真源）
    for (const f of (Array.isArray(snapshot.facts) ? snapshot.facts : [])) {
        if (!f || typeof f !== 'object') continue;
        push('fact', `wa:fact:${clip(f.key, 48)}`, f.value, { scope: clip(f.scope, 20) });
    }
    // ② 暗流（进行中、还会变的世界线）
    for (const c of (Array.isArray(snapshot.currents) ? snapshot.currents : [])) {
        if (!c || typeof c !== 'object') continue;
        const title = clip(c.title, 60);
        const summary = clip(c.summary, maxLen - title.length > 10 ? maxLen - title.length - 2 : maxLen);
        push('current', `wa:current:${clip(c.id, 40)}`,
            title && summary ? `${title}——${summary}` : (title || summary),
            { visibility: clip(c.visibility, 16), stage: clip(c.stage, 20) });
    }
    // ③ 世界压力（pulse：地球侧舆情温度/趋势；若宿主没推这一项则缺席）
    if (snapshot.pulse && typeof snapshot.pulse === 'object') {
        const note = clip(snapshot.pulse.note, maxLen);
        const trend = clip(snapshot.pulse.trend, 16);
        if (note || trend) push('pulse', `wa:pulse:${Number(snapshot.pulse.at) || 0}`,
            note || `当前世界压力趋势：${trend}`, { trend });
    }
    // ④ 舆情三源：canon=已核实新闻、forum=论坛传闻、sandbox=NON-CANON 闲逛
    const op = (snapshot.opinion && typeof snapshot.opinion === 'object') ? snapshot.opinion : {};
    for (const o of (Array.isArray(op.canon) ? op.canon : [])) {
        if (!o || typeof o !== 'object') continue;
        const title = clip(o.title, 80);
        const body = clip(o.body, maxLen - title.length > 10 ? maxLen - title.length - 2 : maxLen);
        push('news', `wa:news:${title}:${Number(o.at) || 0}`,
            title && body ? `${title}｜${body}` : (title || body),
            { claim: clip(o.claim, 12) });
    }
    for (const o of (Array.isArray(op.forum) ? op.forum : [])) {
        if (!o || typeof o !== 'object') continue;
        const board = clip(o.board, 40);
        const topic = clip(o.topic, 80);
        // 论坛传闻必须**显式标注其为传闻**——「已核实」与「纯传闻」在读者侧是两种事实强度
        const claim = clip(o.claim, 12);
        const mark = claim ? `（${claim}）` : '（传闻）';
        push('rumor', `wa:rumor:${board}:${topic}:${Number(o.at) || 0}`,
            `【${board || '论坛'}】${topic}${mark}`,
            { claim });
    }
    for (const o of (Array.isArray(op.sandbox) ? op.sandbox : [])) {
        if (!o || typeof o !== 'object') continue;
        const kind = clip(o.kind, 20);
        const text = clip(o.text, maxLen);
        push('sandbox', `wa:sandbox:${kind}:${text}`,
            `（非正史·闲逛）${text}`, { mood: clip(o.mood, 20) });
    }

    // 排序：新的在前（at 降序），条数封顶
    out.sort((a, b) => (b.at || 0) - (a.at || 0));
    const dropped = Math.max(0, out.length - maxEntries);
    return { ok: true, entries: out.slice(0, maxEntries), counts, dropped };
}

/**
 * 把真世界状态压成一段「一致性约束」文本，供 LLM 风格化改写时参考。
 * 目的：LLM 可以润色口吻，但**不得编造与真世界矛盾的事件**。
 * 无可用内容时返回 ''（调用方据此退回纯生成路径）。
 */
export function worldAxisPromptBlock(snapshot, opts = {}) {
    if (!snapshot || typeof snapshot !== 'object') return '';
    const proj = projectWorldAxis(snapshot, {
        maxEntries: Math.max(1, Number(opts.maxEntries) || 6),
        maxLen: Math.max(40, Number(opts.maxLen) || 120)
    });
    if (!proj.entries.length) return '';
    const lines = proj.entries.map(e => `- [${e.style}] ${e.content}`);
    return `【本世界已发生的真实动态（世界轴推演结果，不得与之矛盾、不得改写其事实）】\n${lines.join('\n')}`;
}

/**
 * 把投影条目并入历史（按 id 去重，上限沿用 MAX_HISTORY）。
 * 返回新历史数组；不修改入参。
 */
export function mergeWorldAxisHistory(history, entries) {
    const h = Array.isArray(history) ? history.slice() : [];
    const have = new Set(h.map(e => String(e && e.id)));
    for (const e of (Array.isArray(entries) ? entries : [])) {
        if (!e || !e.content) continue;
        if (have.has(String(e.id))) continue;
        have.add(String(e.id));
        h.push({
            id: String(e.id),
            style: e.style || '世界动态',
            content: String(e.content),
            floorCount: Number(e.floorCount) || 0,
            createdAt: Number(e.createdAt) || Number(e.at) || Date.now(),
            source: e.source || 'worldaxis',
            kind: e.kind || ''
        });
    }
    while (h.length > MAX_HISTORY) h.shift();
    return h;
}