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
        maxQueueSize: MAX_QUEUE
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
export function enqueue(queue, event, maxQueue = MAX_QUEUE) {
    const q = Array.isArray(queue) ? [...queue] : [];
    q.push({
        id: event.id || `wp_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        style: event.style || '都市日常',
        customPrefix: event.customPrefix || '',
        manual: !!event.manual,
        floorCount: Number(event.floorCount) || 0,
        enqueuedAt: Number(event.enqueuedAt) || Date.now()
    });
    const cap = Math.max(1, Number(maxQueue) || MAX_QUEUE);
    while (q.length > cap) q.shift();   // 丢最旧（mobile 仓同款）
    return q;
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