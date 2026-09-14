/**
 * phone-chat-memory.js — [v2.9.0 原创缝合] 联系人级手机聊天长期记忆摘要引擎
 *
 * 【来源】缝合自葵葵机（向日葵MioRu）的 updatePhoneMemory / getPhoneMemory /
 *   buildPhoneReplyPrompt 三件套——这是 ruby-phone 微信的真空区：
 *   现有 sendToAI 每轮都塞全量（酒馆历史+微信记录），无「联系人级滚动摘要」，
 *   长聊天后上下文爆炸且关键事实（承诺/称呼/关系变化/未解决事项）被稀释。
 *
 * 【原创增强】（非照抄）：
 *   - 摘要存 PhoneStorage（chatMetadata 会话级分层）而非 localStorage 裸 key
 *   - 走 apiManager.callAI 统一通道（自动 generateRaw 兜底），非裸 generateRaw
 *   - 无 API 时的降级拼接（葵葵机同款 fallback：旧摘要+最近一轮，截断 1200 字）
 *   - buildReplyContext：组装「记忆摘要 + 最近手机原文 + 本轮新消息」提示块
 *   - 群聊/单聊双模式 prompt 构建（群聊逐行 `角色名：内容` 解析约定）
 *
 * 纯 ESM export（对齐 drives-engine/jiwen-engine 约定）。
 */

const MEM_KEY = 'wechat_contact_memory_v1';   // chatMetadata 会话级键
const MAX_SUMMARY = 300;    // 摘要目标上限（葵葵机约束）
const FALLBACK_CAP = 1200;  // 无 API 降级拼接的硬截断

/** 读取全部联系人记忆 { [contactId]: summary } */
export function getAllMemories(storage) {
    try {
        const raw = storage?.get?.(MEM_KEY, false);
        if (!raw) return {};
        const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {};
    } catch (_e) { return {}; }
}

/** 读取单个联系人的长期记忆摘要 */
export function getMemory(storage, contactId) {
    return getAllMemories(storage)[contactId] || '';
}

/** 写入单个联系人摘要（空串则删除该键） */
export function setMemory(storage, contactId, summary) {
    try {
        const all = getAllMemories(storage);
        const s = String(summary || '').trim();
        if (s) all[contactId] = s; else delete all[contactId];
        storage?.set?.(MEM_KEY, JSON.stringify(all), false);
        return true;
    } catch (_e) { return false; }
}

/** 格式化一条手机记录为「名字：内容」行 */
function _fmtLogLine(log, userName) {
    if (log.role === 'system') return `系统：${log.content}`;
    const name = log.role === 'send' ? (userName || '用户') : (log.name || '对方');
    return `${name}：${log.content}`;
}

/**
 * 组装最近手机聊天原文（send/recv 行，限 limit 条）。
 * @param {Array} logs wechat 消息记录（含 role/name/content）
 * @param {number} limit 条数上限（默认 50，对齐葵葵机 phoneToStory）
 */
export function recentPhoneHistory(logs, userName, limit = 50) {
    return (Array.isArray(logs) ? logs : [])
        .filter(l => l && (l.role === 'send' || l.role === 'recv'))
        .slice(-limit)
        .map(l => _fmtLogLine(l, userName))
        .join('\n');
}

/**
 * 组装最近正文剧情上下文（剥标签后「说话人：内容」行，供手机回复参考剧情走向）。
 * @param {object|null} ctx SillyTavern context
 * @param {number} n 取最近 n 楼（默认 8，对齐葵葵机 storyToPhone）
 */
export function recentStoryContext(ctx, n = 8) {
    try {
        if (!ctx || !Array.isArray(ctx.chat) || n <= 0) return '';
        const userName = ctx.name1 || '用户';
        return ctx.chat.slice(-n).map(m => {
            const speaker = m.is_user ? userName : (m.name || ctx.name2 || '角色');
            const clean = String(m.mes || m.content || '')
                .replace(/<[^>]*>/g, '')
                .replace(/\[[^\]]*消息[:：][^\]]*\]/gi, '')
                .trim();
            return clean.length > 3 ? `${speaker}：${clean}` : '';
        }).filter(Boolean).join('\n');
    } catch (_e) { return ''; }
}

/**
 * 手机回复 system prompt（葵葵机 getPhoneReplySystemPrompt 直译+微调）。
 * 硬规则：只输出消息文本、短、群聊可多行、不得续写正文叙事。
 */
export function phoneReplySystemPrompt() {
    return `你现在只负责生成"手机聊天窗口"里的即时回复，不是在续写正文剧情。
硬性规则：
1. 只输出手机消息内容本身，不要旁白、动作描写、心理描写、场景描写、Markdown、引号或标签。
2. 不要使用正文预设里的长篇叙事风格，不要续写主聊天正文。
3. 回复要短，像真实聊天软件消息。单人聊天通常 1-3 句；群聊可以多行。
4. 可以依据角色卡、世界书和关系设定保持人设，但表达形式必须是手机聊天。
5. 如果用户连续发了多条消息，要理解为同一轮手机聊天上下文。`;
}

/**
 * 构建手机回复用户提示块（记忆摘要 + 剧情上下文 + 最近手机原文 + 本轮新消息）。
 * @param {object} p
 *   p.storage  PhoneStorage 实例
 *   p.contactId 联系人/群聊 id
 *   p.isGroup   是否群聊
 *   p.groupName 群名（群聊时）
 *   p.groupMembers 群成员名数组（群聊时）
 *   p.logs      最近微信记录（含 role/name/content）
 *   p.userName  用户名
 *   p.newText   本轮用户新消息（连发已合并）
 *   p.storyCtx  最近正文剧情上下文（recentStoryContext 产出，可空）
 */
export function buildReplyPrompt(p) {
    const memory = getMemory(p.storage, p.contactId);
    const recent = recentPhoneHistory(p.logs, p.userName);
    const storyBlock = p.storyCtx ? `【最近正文剧情上下文】\n${p.storyCtx}\n\n` : '';
    const base = `${storyBlock}【长期手机聊天记忆摘要】\n${memory || '暂无'}\n\n【最近手机聊天原文】\n${recent || '暂无'}\n\n【本轮用户新消息】\n${p.newText || ''}`;
    if (p.isGroup) {
        const members = Array.isArray(p.groupMembers) ? p.groupMembers.join(', ') : '';
        return `${base}\n\n用户正在群聊"${p.groupName || '群聊'}"中继续手机聊天。群成员包含：${members}。请扮演群内一个或多个角色进行手机聊天回复。\n输出格式必须严格为每行"角色名：回复内容"。`;
    }
    const name = p.contactName || p.contactId;
    return `${base}\n\n用户正在手机上和 ${name} 继续聊天。请你只扮演 ${name}，生成 ${name} 在手机聊天里会回复的具体文本。\n要求：只输出消息文本；不要写"${name}："；不要旁白、动作、心理、场景描写；不要续写正文。`;
}

/**
 * 滚动更新联系人长期记忆摘要（核心：葵葵机 updatePhoneMemory 工程化）。
 * 优先走 apiManager.callAI 生成；无 API / 失败时降级为「旧摘要 + 最近一轮」拼接截断。
 *
 * @param {object} p
 *   p.storage    PhoneStorage 实例
 *   p.apiManager ApiManager 实例（可空，空则直接降级）
 *   p.contactId  联系人 id
 *   p.logs       最近微信记录（供摘要参考）
 *   p.userName   用户名
 *   p.userText   本轮用户消息
 *   p.replyText  本轮对方回复
 * @returns {Promise<string>} 更新后的摘要
 */
export async function updateMemory(p) {
    const old = getMemory(p.storage, p.contactId);
    const recent = recentPhoneHistory(p.logs, p.userName);

    // 降级路径：无 API 通道 → 拼接截断（葵葵机 fallback 同款）
    const degrade = () => {
        const merged = [old, `最近：${p.userText || ''} / ${p.replyText || ''}`]
            .filter(Boolean).join('\n').slice(-FALLBACK_CAP);
        setMemory(p.storage, p.contactId, merged);
        return merged;
    };

    const am = p.apiManager;
    if (!am || typeof am.callAI !== 'function') return degrade();

    const userInput = `已有手机聊天记忆摘要：\n${old || '暂无'}\n\n最近手机聊天记录：\n${recent}\n\n本轮用户新消息：\n${p.userText || ''}\n\n本轮对方回复：\n${p.replyText || ''}\n\n请更新一份长期记忆摘要，只保留会影响未来手机聊天的事实、关系变化、承诺、称呼、偏好、情绪走向和未解决事项。不要写剧情正文，不要逐字复述。控制在${MAX_SUMMARY}字以内。`;

    try {
        const messages = [
            { role: 'system', content: '你是小手机聊天的长期记忆整理器。只输出摘要正文。' },
            { role: 'user', content: userInput }
        ];
        const result = await am.callAI(messages, { should_silence: true, max_chat_history: 0 });
        // callAI 返回 { success:true, summary } 或 { success:false, error }
        const summary = String(
            (result && typeof result === 'object')
                ? (result.summary ?? result.content ?? result.text ?? '')
                : (result ?? '')
        ).trim();
        if (result?.success !== false && summary) { setMemory(p.storage, p.contactId, summary); return summary; }
        return degrade();
    } catch (_e) {
        return degrade();
    }
}