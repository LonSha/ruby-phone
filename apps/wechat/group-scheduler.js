/**
 * group-scheduler.js — [v3.0.0 缝合] 微信群多角色发言调度引擎（纯函数）
 *
 * 【来源】缝合 Windy-Sora/SillyTavern-GroupWorld 的群聊三 agent 机制：
 *   - director.js：LLM 选出本轮发言者序列（speakers），名字→角色映射、去重保序、cap maxSpeakers
 *   - force-speak.js：单角色强制接管（@某人强制回复），pipeline 四段式
 *   - critique.js：导演/角色表现批评（节奏/焦点/OOC 检测），JSON 输出反馈优化
 *
 * 【工程化重写】（非照抄 3624 行 agent 框架，只取调度算法）：
 *   - 纯函数无 window 依赖：输入群成员 + LLM 原始输出，输出调度决策；可测。
 *   - matchCharacterByName：名字/别名/头像模糊匹配回成员（对齐 groupworld index.js 2298 逻辑重写）。
 *   - parseSpeakers：容错解析 LLM 返回的 speakers（兼容字符串/对象/带 reason/scripts）。
 *   - capSpeakers：maxSpeakers 截断 + validate 过滤非法成员。
 *   - buildForceSpeakPrompt / buildCritiquePrompt：prompt 构造（中英双语模板）。
 *
 * 纯 ESM export（对齐 worldpulse-engine 约定）。时间戳由调用方注入，保证可测。
 */

// ── 名字归一：NFKC + 去空白 + 小写（对齐 ruby-phone 角色名归一约定）──
export function normalizeName(s) {
    return String(s ?? '')
        .normalize('NFKC')
        .replace(/\s+/g, '')
        .toLowerCase()
        .trim();
}

/**
 * 成员匹配：把 LLM 返回的名字字符串映射回群成员对象。
 * 支持：精确名 / 别名 / 归一化匹配 / 包含匹配（名含子串）。
 * @param {string} name LLM 返回的名字
 * @param {Array} members 群成员 [{ id, name, aliases?, avatar? }]
 * @returns {object|null} 匹配到的成员，未匹配返回 null
 */
export function matchMemberByName(name, members = []) {
    const target = normalizeName(name);
    if (!target) return null;
    const list = Array.isArray(members) ? members : [];
    // 1) 精确匹配（name 或 alias 归一后相等）
    for (const m of list) {
        const names = [m?.name, ...(Array.isArray(m?.aliases) ? m.aliases : [])].filter(Boolean);
        if (names.some(n => normalizeName(n) === target)) return m;
    }
    // 2) 包含匹配（target 是某成员名的子串，或反之）——取最短名者优先（防「小明」误中「小明明」）
    let best = null;
    for (const m of list) {
        const names = [m?.name, ...(Array.isArray(m?.aliases) ? m.aliases : [])].filter(Boolean);
        for (const n of names) {
            const nn = normalizeName(n);
            if (nn && (nn.includes(target) || target.includes(nn))) {
                if (!best || nn.length < normalizeName(best.name).length) best = m;
            }
        }
    }
    return best;
}

/**
 * 容错解析 LLM 返回的发言者列表。
 * 兼容：{speakers:[...]} / {speakers:[{name}]} / 裸字符串数组 / 单字符串。
 * @param {*} raw LLM 解析后的对象（已 JSON.parse）或字符串
 * @returns {{ speakers: string[], reason: string, scripts: object|null }}
 */
export function parseSpeakers(raw) {
    const out = { speakers: [], reason: '', scripts: null };
    let obj = raw;
    if (typeof raw === 'string') {
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) {
            try { obj = JSON.parse(m[0]); }
            catch { try { obj = JSON.parse(m[0].replace(/,\s*([}\]])/g, '$1')); } catch { obj = null; } } // 尾逗号容错
        } else obj = null;
    }
    if (!obj || typeof obj !== 'object') {
        // 裸名字字符串
        if (typeof raw === 'string' && raw.trim()) out.speakers = [raw.trim()];
        return out;
    }
    const sp = obj.speakers ?? obj.speaker ?? obj.speaking ?? [];
    const arr = Array.isArray(sp) ? sp : [sp];
    out.speakers = arr.map(s => {
        if (typeof s === 'string') return s.trim();
        if (s && typeof s === 'object') return String(s.name ?? s.character ?? s.id ?? '').trim();
        return '';
    }).filter(Boolean);
    out.reason = String(obj.reason ?? obj.why ?? '').trim();
    out.scripts = (obj.scripts && typeof obj.scripts === 'object') ? obj.scripts : null;
    return out;
}

/**
 * 调度决策：把解析出的名字序列映射回成员、去重保序、过滤非法、cap maxSpeakers。
 * @param {string[]} names 名字数组
 * @param {Array} members 群成员
 * @param {object} opts { maxSpeakers=3 }
 * @returns {{ speakers: object[], names: string[], skipped: string[] }}
 */
export function scheduleSpeakers(names, members = [], opts = {}) {
    const maxSpeakers = Math.max(1, Number(opts.maxSpeakers) || 3);
    const seen = new Set();
    const speakers = [];
    const speakerNames = [];
    const skipped = [];
    for (const name of (Array.isArray(names) ? names : [])) {
        const m = matchMemberByName(name, members);
        const key = m ? (m.id ?? m.name) : null;
        if (m && !seen.has(key)) {
            seen.add(key);
            speakers.push(m);
            speakerNames.push(m.name);
        } else if (!m) {
            skipped.push(name); // 未识别名字（groupworld: skipped log）
        }
    }
    return {
        speakers: speakers.slice(0, maxSpeakers),
        names: speakerNames.slice(0, maxSpeakers),
        skipped
    };
}

/**
 * 校验调度结果：过滤已发言/禁用成员（对齐 groupworld director validate）。
 * @param {{speakers,names}} decision
 * @param {Array} enabledMembers 当前可用成员
 * @returns {{speakers,names}|null} 空则返回 null
 */
export function validateSpeakers(decision, enabledMembers = []) {
    if (!decision || !Array.isArray(decision.speakers) || !decision.speakers.length) return null;
    const enabled = new Set((Array.isArray(enabledMembers) ? enabledMembers : []).map(m => m.id ?? m.name));
    const keepIdx = [];
    decision.speakers.forEach((m, i) => {
        if (enabled.has(m.id ?? m.name)) keepIdx.push(i);
    });
    const speakers = keepIdx.map(i => decision.speakers[i]);
    const names = keepIdx.map(i => decision.names[i]);
    if (!speakers.length) return null;
    return { ...decision, speakers, names };
}

// ── Force-speak prompt 构造（缝合 groupworld force-speak 系统指令）──
/**
 * @param {object} char 被强制的角色 { name }
 * @param {object} opts { lang='zh', customPrompt? }
 */
export function buildForceSpeakInstruction(char, opts = {}) {
    const name = char?.name ?? '';
    if (opts.customPrompt) return String(opts.customPrompt).replace(/\{charName\}/g, name);
    return opts.lang === 'en'
        ? `[SYSTEM] Force-speak: ${name} has been manually triggered. You MUST select ONLY ${name}. Do NOT select any other characters. Write a short stage direction for ${name}.`
        : `【系统指令】用户已强制触发 ${name} 发言。请只选择 ${name} 一人作为本轮发言者。忽略其他角色。为 ${name} 生成一段简短的舞台指导。`;
}

// ── Critique prompt 构造（缝合 groupworld critique 批评模板）──
/**
 * @param {object} opts { lang='zh' }
 */
export function buildCritiquePrompt(opts = {}) {
    if (opts.lang === 'en') {
        return `You are an objective, neutral group chat critique system. Review the recent conversation.
IMPORTANT: Only critique AI character performance, NOT the User.
1. Director critique: speaking order reasonable? Any character ignored/over-focused? Pacing ok? Missed topics/conflicts?
2. Character critique (AI only): consistent? Any OOC? Natural interaction? Too passive/dominant?
Output ONLY JSON: { "directorCritique": { "pacing": "...", "spotlight": "...", "suggestions": ["..."] }, "characterCritiques": { "name": { "consistency": "...", "interaction": "...", "suggestions": ["..."] } } }`;
    }
    return `你是一个客观中立的群聊导演批判系统。回顾最近的对话内容进行分析。
重要：只批判AI角色的表现，绝对不要批判或评价User/用户的行为和发言。
1. 导演决策批判：发言顺序是否合理？有没有角色被忽略或过度聚焦？节奏是否恰当？有没有错过关键话题或冲突点？
2. 角色表现批判（仅限AI角色）：角色言行是否一致？有没有OOC？角色互动是否自然、有推进剧情？有没有角色过于被动或过于强势？
请以JSON格式输出，不要包含其他文字：
{ "directorCritique": { "pacing": "节奏评价", "spotlight": "焦点分配评价", "suggestions": ["建议1"] }, "characterCritiques": { "角色名": { "consistency": "一致性评价", "interaction": "互动表现评价", "suggestions": ["建议1"] } } }`;
}

/**
 * 容错解析 critique 输出（剥代码块 + 抓首个 JSON 对象）。
 * @param {string} raw
 * @returns {{ directorCritique: object|null, characterCritiques: object }|null}
 */
export function parseCritique(raw) {
    if (!raw) return null;
    const m = String(raw).match(/\{[\s\S]*\}/);
    if (!m) return null;
    let obj = null;
    try { obj = JSON.parse(m[0]); } catch { try { obj = JSON.parse(m[0].replace(/,\s*([}\]])/g, '$1')); } catch { return null; } }
    if (!obj || typeof obj !== 'object') return null;
    return {
        directorCritique: (obj.directorCritique && typeof obj.directorCritique === 'object') ? obj.directorCritique : null,
        characterCritiques: (obj.characterCritiques && typeof obj.characterCritiques === 'object') ? obj.characterCritiques : {}
    };
}
