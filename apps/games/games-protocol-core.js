/* ========================================================
 * games-protocol-core.js — [v4.192.0] 狼人杀/谁是卧底 AI 协议解析 · 纯函数内核
 * --------------------------------------------------------
 * 为什么抽这一层：games-app.js 3837 行里，狼人杀与谁是卧底的「AI 回包怎么读」
 *   是一整族纯字符串工作 —— 取标签块、按行切、按「标签：值」取字段、按
 *   「N号 -> M号」切票型、拼公开发言日志与投票史。它们不读时钟、不造随机、
 *   不碰 DOM 与 storage，却因为长在 GamesApp 这个继承 PokerApp 的聚合壳里，
 *   每次试算都要 new 一整个游戏大厅。
 * 本文件只做「同一段 AI 文本 => 同一份结构」的解析与拼装，不含任何编排。
 * 纪律：不取 Date.now / Math.random、不建类、不碰 DOM / localStorage / window。
 * ======================================================== */
'use strict';

/** 按「标签：值」取一行字段（行内到行尾，不吃下一行）。 */
export function extractLabeledField(body, label) {
    const escaped = String(label == null ? '' : label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = String(body == null ? '' : body).match(new RegExp(`${escaped}\\s*[:：]\\s*([^\\n\\r]*)`));
    return String(match?.[1] || '').trim();
}

/** 夜里用的字段版：取值到下一个已知标签或结尾（夜里一段里「理由」常是多行）。 */
export function extractNightField(body, label) {
    const escaped = String(label == null ? '' : label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = String(body == null ? '' : body).match(
        new RegExp(`${escaped}\\s*[:：]\\s*([\\s\\S]*?)(?=\\n\\s*(?:姓名|性别|性格及语言风格|讨论|目标|药剂|理由|票型|出局)\\s*[:：]|$)`)
    );
    return String(match?.[1] || '').trim();
}

/** 取第一段数字（认不出给 0）。 */
export function extractFirstNumber(text) {
    const match = String(text == null ? '' : text).match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : 0;
}

/* ---------- 谁是卧底 ---------- */

/** 发牌官回包解析：<玩家生成> 里的「昵称/性格」对 + <游戏身份词> 里的两个词。 */
export function parseUndercoverDealerResult(text) {
    const source = String(text == null ? '' : text).trim();
    const playerBlock = source.match(/<玩家生成>([\s\S]*?)<\/玩家生成>/)?.[1] || '';
    const players = playerBlock
        .split(/\n\s*---\s*\n/)
        .map((section) => ({
            name: String(section.match(/玩家昵称\s*[:：]\s*([^\n]+)/)?.[1] || '').trim(),
            personality: String(section.match(/性格\s*[:：]\s*([\s\S]*?)$/)?.[1] || '').trim()
        }))
        .filter((player) => player.name && player.personality);
    const wordBlock = source.match(/<游戏身份词>([\s\S]*?)<\/游戏身份词>/)?.[1] || '';
    return {
        players,
        wordPair: {
            civilian: String(wordBlock.match(/普通玩家身份词\s*[:：]\s*([^\n]+)/)?.[1] || '').trim(),
            undercover: String(wordBlock.match(/卧底玩家身份词\s*[:：]\s*([^\n]+)/)?.[1] || '').trim()
        }
    };
}

/** 发言回包：只取 <谁是卧底发言> 的内容。 */
export function parseUndercoverSpeech(text) {
    const source = String(text == null ? '' : text).trim();
    return String(source.match(/<谁是卧底发言>([\s\S]*?)<\/谁是卧底发言>/)?.[1] || '').trim();
}

/** 投票回包：票型段里按「N号 -> M号」切，同一投票人去重（只认第一次）。 */
export function parseUndercoverVotes(text) {
    const source = String(text == null ? '' : text).trim();
    const block = source.match(/<谁是卧底投票>([\s\S]*?)<\/谁是卧底投票>/)?.[1] || '';
    const voteText = block.match(/票型\s*[:：]\s*([^\n]+)/)?.[1] || block;
    const votes = [];
    const seen = new Set();
    const pattern = /(\d+)\s*(?:号)?\s*(?:->|→|投给|投)\s*(\d+)\s*(?:号)?/g;
    let match = null;
    while ((match = pattern.exec(voteText)) !== null) {
        const voterSeat = Number(match[1]);
        const targetSeat = Number(match[2]);
        if (seen.has(voterSeat)) continue;
        seen.add(voterSeat);
        votes.push({ voterSeat, targetSeat });
    }
    return votes;
}

/** 公开展示日志：按轮次分段，轮次首行用【第N轮】、换轮用分隔线；系统消息单列。 */
export function formatUndercoverPublicLog(messages, limit = 48) {
    const source = (Array.isArray(messages) ? messages : [])
        .slice(-Math.max(1, Number(limit) || 48))
        .filter((message) => String(message?.content || '').trim());
    const lines = [];
    let currentRound = null;
    source.forEach((message) => {
        const round = Math.max(1, Number(message?.round || 1));
        if (round !== currentRound) {
            lines.push(currentRound === null ? `【第${round}轮】` : `----- 第${round}轮 -----`);
            currentRound = round;
        }
        if (message.source === 'system') {
            lines.push(`系统：${String(message.content || '').trim()}`);
            return;
        }
        lines.push(`${Number(message.senderSeat || 0)}号 ${message.senderName || '玩家'}：${String(message.content || '').trim()}`);
    });
    return lines;
}

/* ---------- 狼人杀 ---------- */

/** 匹配环节：按「【N号】」切段，段内取姓名/性别/性格；只收 1~8 号且三样齐全的。 */
export function parseWerewolfMatch(text) {
    const source = String(text == null ? '' : text).trim();
    const block = source.match(/<狼人杀匹配环节>([\s\S]*?)<\/狼人杀匹配环节>/)?.[1] || source;
    const pattern = /【\s*(\d+)\s*号\s*】([\s\S]*?)(?=---\s*【\s*\d+\s*号\s*】|【\s*\d+\s*号\s*】|$)/g;
    const sections = [];
    let match = null;
    while ((match = pattern.exec(block)) !== null) {
        const body = String(match[2] || '');
        sections.push({
            seat: Number(match[1]),
            name: extractLabeledField(body, '姓名'),
            gender: extractLabeledField(body, '性别'),
            personality: extractLabeledField(body, '性格及语言风格')
        });
    }
    return sections.filter((item) => item.seat >= 1 && item.seat <= 8 && item.name && item.personality);
}

/** 发言回包：只取 <狼人杀发言> 的内容，并剥开头的「发言：」。 */
export function parseWerewolfSpeech(text) {
    const source = String(text == null ? '' : text).trim();
    const tagged = source.match(/<狼人杀发言>([\s\S]*?)<\/狼人杀发言>/)?.[1];
    return String(tagged || source).replace(/^发言\s*[:：]/, '').trim();
}

/** 遗言回包：只取 <狼人杀遗言> 的内容。 */
export function parseWerewolfLastWords(text) {
    const source = String(text == null ? '' : text).trim();
    return String(source.match(/<狼人杀遗言>([\s\S]*?)<\/狼人杀遗言>/)?.[1] || source).trim();
}

/** 夜晚行动回包：取目标/药剂/讨论/理由四段（targetSeat 走数字抽取）。 */
export function parseWerewolfNightDecision(text, step) {
    const source = String(text == null ? '' : text).trim();
    const block = source.match(/<狼人杀夜晚行动>([\s\S]*?)<\/狼人杀夜晚行动>/)?.[1] || source;
    return {
        targetSeat: extractFirstNumber(extractNightField(block, '目标')),
        usePotion: normalizeWerewolfPotion(extractNightField(block, '药剂'), step),
        discussion: extractNightField(block, '讨论'),
        reason: extractNightField(block, '理由')
    };
}

/** 投票决策回包：票型按「N -> M / N 投 M / N 弃票」切（弃票落 0）。 */
export function parseWerewolfVoteDecision(text) {
    const source = String(text == null ? '' : text).trim();
    const block = source.match(/<狼人杀投票>([\s\S]*?)<\/狼人杀投票>/)?.[1] || source;
    const votes = [];
    String(extractNightField(block, '票型') || '')
        .replace(/[，,；;]/g, ' ')
        .split(/\s+/)
        .forEach((part) => {
            const match = part.match(/(\d+)\s*(?:->|→|投|票)\s*(\d+|弃票)/);
            if (match) votes.push({
                voterSeat: Number(match[1]),
                targetSeat: /弃票/.test(match[2]) ? 0 : Number(match[2])
            });
        });
    return {
        targetSeat: extractFirstNumber(extractNightField(block, '出局')),
        votes,
        reason: extractNightField(block, '理由')
    };
}

/** 药剂名归一：只认解药/救/antidote 与毒药/毒/poison，且只在女巫步生效。 */
export function normalizeWerewolfPotion(text, step) {
    if (String(step || '') !== 'witch') return '';
    const value = String(text == null ? '' : text).trim();
    if (/解药|救|antidote/i.test(value)) return 'antidote';
    if (/毒药|毒|poison/i.test(value)) return 'poison';
    return '';
}

/** 夜晚步骤 → 角色名（认不出给空串，调用方据此跳过）。 */
export function werewolfNightActors(step) {
    const roleMap = { guard: '守卫', werewolf: '狼人', seer: '预言家', witch: '女巫' };
    return roleMap[String(step || '')] || '';
}

/** 公开发言日志：seat 0 走系统前缀；有名字的拼「N号 名字：」。 */
export function formatWerewolfPublicChatLog(state) {
    const safeState = state || {};
    const players = Array.isArray(safeState.players) ? safeState.players : [];
    return (Array.isArray(safeState.chat) ? safeState.chat : []).map((item) => {
        const day = Number(item?.day || 0) ? `第${Number(item.day)}天 ` : '';
        if (Number(item?.seat || 0) === 0) return `${day}系统：${item?.text || ''}`;
        const player = players.find((playerItem) => Number(playerItem.seat) === Number(item.seat));
        return `${day}${item.seat}号${player?.name ? ` ${player.name}` : ''}：${item?.text || ''}`;
    });
}

/** 投票史：优先 voteHistory，否则从 replayLog 里滤出公开投票；空文本行丢。 */
export function formatWerewolfVoteHistory(stateOrContext) {
    const source = stateOrContext || {};
    const rawList = Array.isArray(source.voteHistory)
        ? source.voteHistory
        : (Array.isArray(source.replayLog)
            ? source.replayLog.filter((item) => String(item?.type || '') === 'vote' && String(item?.visibility || 'public') === 'public')
            : []);
    return rawList
        .map((item) => {
            const day = Number(item?.day || 0) || 1;
            const text = String(item?.text || '').trim();
            return text ? `第${day}天 ${text}` : '';
        })
        .filter(Boolean);
}

/** 票型归并：最高票唯一才放逐，平票一律 0（不硬挑一个）。 */
export function resolveWerewolfVoteTarget(votes) {
    const counts = new Map();
    (Array.isArray(votes) ? votes : []).forEach((vote) => {
        const targetSeat = Number(vote?.targetSeat || 0);
        if (!targetSeat) return;
        counts.set(targetSeat, (counts.get(targetSeat) || 0) + 1);
    });
    if (!counts.size) return 0;
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const topCount = Number(sorted[0]?.[1] || 0);
    const tied = sorted.filter((item) => Number(item[1]) === topCount);
    return tied.length === 1 ? Number(sorted[0]?.[0] || 0) : 0;
}

/** 投票失败兜底：用户投的目标还在桌上就照投，否则放逐最高号。 */
export function fallbackWerewolfVoteTarget(players, userVote) {
    const live = (Array.isArray(players) ? players : []).filter((player) => !player.empty && player.alive !== false);
    if (!live.length) return 0;
    if (userVote && live.some((player) => Number(player.seat) === Number(userVote.targetSeat))) {
        return Number(userVote.targetSeat);
    }
    const sorted = [...live].sort((a, b) => Number(b.seat) - Number(a.seat));
    return Number(sorted[0]?.seat || live[0].seat || 0);
}

/** 场上公开状态消息（明牌/暗牌给不同的一句规则）。 */
export function formatWerewolfPublicStateMessage(context) {
    const ctx = context || {};
    const playerLines = (ctx.players || [])
        .map((player) => `${player.seat}号 ${player.name}：${player.status}${player.isUser ? '，用户本人' : ''}`)
        .join('\n');
    const isOpenReveal = String(ctx.roleRevealMode || 'open') !== 'hidden';
    return [
        '【场上公开玩家状态】',
        `当前：第 ${ctx.day || 1} 天白天。`,
        `用户座位：${ctx.userSeat || '?'}号。`,
        isOpenReveal
            ? '本局为明牌模式：死亡或被投票放逐的玩家会公开真实身份；场上状态中写明的公开身份就是已公开事实，可以直接作为发言依据。'
            : '本局为暗牌模式：死亡或被投票放逐的玩家不会公开真实身份；除公开发言和系统公告外，不得断言其真实身份。',
        playerLines || '暂无'
    ].join('\n');
}

/** 发言简报与系统公告消息（首日白天额外禁一句「不许凭空说查验」）。 */
export function formatWerewolfPublicLogMessage(context) {
    const ctx = context || {};
    const logLines = (ctx.publicLog || []).length
        ? ctx.publicLog.map((line) => `- ${line}`).join('\n')
        : '- 暂无';
    const voteLines = formatWerewolfVoteHistory(ctx);
    return [
        '【发言简报与系统公告】',
        Number(ctx.day || 1) === 1 ? '当前是首日白天，系统尚未公布任何夜晚技能结果；禁止凭空声称查杀、金水、银水、刀口或验人结果。' : '',
        '系统公告与已公开发言记录：',
        logLines,
        '已公开投票结果：',
        voteLines.length ? voteLines.map((line) => `- ${line}`).join('\n') : '- 暂无'
    ].filter(Boolean).join('\n');
}

/** 当前发言任务消息：狼人列同伴、预言家列查验，其他人只给性格与身份。 */
export function formatWerewolfSpeechTaskMessage(context) {
    const ctx = context || {};
    const players = ctx.players || [];
    const speakerSeat = Number(ctx.speaker?.seat || 0);
    const wolfMates = ctx.speakerPrivateRole === '狼人'
        ? players
            .filter((player) => player.role === '狼人' && player.alive !== false)
            .map((player) => `${player.seat}号 ${player.name}`)
            .join('、')
        : '';
    const seerChecks = ctx.speakerPrivateRole === '预言家' && Array.isArray(ctx.seerChecks)
        ? ctx.seerChecks
            .map((item) => `第 ${Number(item.day || 1)} 夜查验 ${Number(item.targetSeat || 0)}号：${item.resultRole === '狼人' ? '狼人' : '好人'}`)
            .filter(Boolean)
        : [];
    return [
        '【当前发言任务】',
        '以下身份信息只给当前发言玩家用于策略判断。',
        `当前该 ${speakerSeat || '?'}号 ${ctx.speaker?.name || '玩家'} 发言。`,
        `当前发言玩家性格及语言风格：${ctx.speaker?.personality || '普通玩家，自然发言'}。`,
        `当前发言玩家真实身份：${ctx.speakerPrivateRole || '村民'}。`,
        wolfMates ? `狼人同伴：${wolfMates}。` : '',
        seerChecks.length ? `你的预言家查验结果：${seerChecks.join('；')}。` : '',
        '其他玩家真实身份不得在发言中泄露；除非场上公开信息已经说明，否则不要假装知道。',
        '可以基于已公开投票结果分析“谁投了谁、谁跟票、谁弃票、谁票型异常”，并据此提出怀疑或辩解。',
        '禁止描写心理活动、动作、表情或旁白，不要使用括号补充任何非发言内容。',
        '请只输出当前玩家的公开发言。格式：',
        '<狼人杀发言>',
        '发言内容',
        '</狼人杀发言>'
    ].filter(Boolean).join('\n');
}

/** 补位玩家：AI 生成的优先，缺的名走内置名表（同名池，按 index 轮取）。 */
export function buildWerewolfFallbackPlayers(emptySeats, generated) {
    const bySeat = new Map((Array.isArray(generated) ? generated : []).map((player) => [Number(player.seat), player]));
    const names = ['青岚', '夜航', '阿澈', '小满', '林鹿', '北辰', '梨白'];
    return (Array.isArray(emptySeats) ? emptySeats : []).map((seat, index) => {
        const item = bySeat.get(Number(seat));
        if (item?.name) return item;
        return {
            seat,
            id: `ai_${seat}`,
            name: names[index % names.length],
            gender: '',
            personality: '谨慎观察，发言简短但会抓矛盾',
            source: 'ai'
        };
    });
}

/** 按天归档的公开记录消息（每天一条 system 消息，发言与投票分列）。 */
export function buildWerewolfPublicRecordMessages(state) {
    const safeState = state || {};
    const players = Array.isArray(safeState.players) ? safeState.players : [];
    const recordsByDay = new Map();
    const ensureDay = (day) => {
        const safeDay = Number(day || 0) || 1;
        if (!recordsByDay.has(safeDay)) recordsByDay.set(safeDay, { speeches: [], votes: [] });
        return recordsByDay.get(safeDay);
    };

    (Array.isArray(safeState.chat) ? safeState.chat : []).forEach((item) => {
        const day = Number(item?.day || 0) || 1;
        const target = ensureDay(day);
        if (Number(item?.seat || 0) === 0) {
            target.speeches.push(`系统：${item?.text || ''}`);
            return;
        }
        const player = players.find((playerItem) => Number(playerItem.seat) === Number(item.seat));
        target.speeches.push(`${item.seat}号${player?.name ? ` ${player.name}` : ''}：${item?.text || ''}`);
    });

    const voteItems = Array.isArray(safeState.voteHistory)
        ? safeState.voteHistory
        : (Array.isArray(safeState.replayLog)
            ? safeState.replayLog.filter((item) => String(item?.type || '') === 'vote' && String(item?.visibility || 'public') === 'public')
            : []);
    voteItems.forEach((item) => {
        const day = Number(item?.day || 0) || 1;
        const text = String(item?.text || '').trim();
        if (text) ensureDay(day).votes.push(text);
    });

    const currentDay = Number(safeState.day || 1) || 1;
    for (let day = 1; day <= currentDay; day += 1) ensureDay(day);

    return [...recordsByDay.entries()]
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([day, record]) => ({
            role: 'system',
            name: `SYSTEM (狼人杀第${day}天公开记录)`,
            isPhoneMessage: true,
            content: [
                `【第 ${day} 天公开记录】`,
                '公开发言与系统公告：',
                record.speeches.length ? record.speeches.map((line) => `- ${line}`).join('\n') : '- 暂无',
                '当天投票结果：',
                record.votes.length ? record.votes.map((line) => `- ${line}`).join('\n') : '- 暂无'
            ].join('\n')
        }));
}

export default {
    extractLabeledField,
    extractNightField,
    extractFirstNumber,
    parseUndercoverDealerResult,
    parseUndercoverSpeech,
    parseUndercoverVotes,
    formatUndercoverPublicLog,
    parseWerewolfMatch,
    parseWerewolfSpeech,
    parseWerewolfLastWords,
    parseWerewolfNightDecision,
    parseWerewolfVoteDecision,
    normalizeWerewolfPotion,
    werewolfNightActors,
    formatWerewolfPublicChatLog,
    formatWerewolfVoteHistory,
    resolveWerewolfVoteTarget,
    fallbackWerewolfVoteTarget,
    formatWerewolfPublicStateMessage,
    formatWerewolfPublicLogMessage,
    formatWerewolfSpeechTaskMessage,
    buildWerewolfFallbackPlayers,
    buildWerewolfPublicRecordMessages
};