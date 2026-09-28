/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  游戏 AI 通用酒馆上下文注入
 * ======================================================== */
import { readPhoneContextLimit } from '../../../config/context-settings.js';
/* [v3.18.0 · R-O4] 「最近正文」收集循环收敛到单一真源（本文件原本自写一份）。
 *   抽取口径是「零行为漂移」：清洗钩子（cleanStContextText）与条目格式逐字不变，
 *   只把循环/过滤/方向（逆序 + unshift）这三件事交给真源。 */
import { collectRecentChat } from '../../../config/context-compose.js';

function getSillyTavernContext() {
    try {
        if (typeof window.SillyTavern?.getContext === 'function') return window.SillyTavern.getContext();
        if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function') return SillyTavern.getContext();
    } catch (error) {
        console.warn('[GamesAiContext] 获取 SillyTavern 上下文失败:', error);
    }
    return null;
}

function cleanStContextText(text) {
    return String(text || '')
        .replace(/<[^>]*>/g, '')
        .replace(/\*[^*]*\*/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 1200);
}

function buildCharacterMessage(context) {
    const charName = context?.name2 || '角色';
    const char = context?.characterId !== undefined && context?.characters
        ? context.characters[context.characterId]
        : null;
    if (!char) return null;

    const parts = [
        '【角色信息】',
        `角色名: ${char.name || charName}`
    ];
    if (char.description) parts.push(`描述: ${char.description}`);
    if (char.personality) parts.push(`性格: ${char.personality}`);
    if (char.scenario) parts.push(`场景/背景: ${char.scenario}`);
    if (char.first_mes) parts.push(`开场白: ${char.first_mes}`);
    if (char.mes_example) parts.push(`示例对话: ${char.mes_example}`);
    if (char.data?.system_prompt) parts.push(String(char.data.system_prompt));

    return {
        role: 'system',
        content: parts.join('\n').trim(),
        name: 'SYSTEM (角色卡)',
        isPhoneMessage: true
    };
}

function buildPersonaMessage() {
    const personaText = String(document.getElementById('persona_description')?.value || '').trim();
    if (!personaText) return null;
    return {
        role: 'system',
        content: `【用户信息】\n${personaText}`,
        name: 'SYSTEM (用户Persona)',
        isPhoneMessage: true
    };
}

function buildRecentChatMessages(context, storage, limitKey = 'phone-context-limit') {
    const contextLimit = limitKey === 'phone-context-limit'
        ? readPhoneContextLimit(storage)
        : Math.max(0, Math.min(9999, Number.parseInt(storage?.get?.(limitKey), 10) || 0));
    if (contextLimit <= 0 || !Array.isArray(context?.chat) || context.chat.length <= 0) return [];

    /* [v3.18.0 · R-O4] 循环/过滤/方向交真源；清洗与格式逐字保留（零行为漂移） */
    return collectRecentChat(context, {
        limit: contextLimit,
        clean: (raw) => cleanStContextText(raw),
        toEntry: ({ text, isUser, userName, charName }) => ({
            role: isUser ? 'user' : 'assistant',
            content: `${isUser ? userName : charName}: ${text}`,
            isPhoneMessage: true
        })
    }).messages;
}

export async function buildGameSillyTavernContextMessages(appKey, storage, options = {}) {
    const messages = [];
    const context = getSillyTavernContext();
    if (!context) return messages;

    const characterMessage = buildCharacterMessage(context);
    if (characterMessage) messages.push(characterMessage);

    if (options.includeWorldbook !== false) {
        await window.VirtualPhone?.worldbookManager?.appendWorldbookMessages?.(messages, appKey, options.worldbookOptions || {});
    }

    const personaMessage = buildPersonaMessage();
    if (personaMessage) messages.push(personaMessage);

    if (options.includeRecentChat !== false) {
        messages.push(...buildRecentChatMessages(context, storage, options.limitKey || 'phone-context-limit'));
    }
    return messages;
}
