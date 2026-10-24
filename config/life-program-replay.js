/* ========================================================
 * config/life-program-replay.js — [R8-X7 · 第八期规划] 可复演的生活节目录（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么】
 *   复杂经历（庆典、远行、长夜促膝）需要可供反复重温但绝不污染正史：
 *     ① 多幕结构记录：保存幕次（acts）、核心对话、关键信物与情绪标记；
 *     ② 多角色分支回看：同一幕可切换不同角色的第一视角回忆；
 *     ③ 严格正史隔离：重放仅产出叙事预览，绝不篡改底层聊天或全局日历；
 *     ④ 会话隔离，严格纯函数。
 * ======================================================== */

export const DEFAULT_LIFE_PROGRAM_STATE = Object.freeze({
    programs: {}, // id -> lifeProgram
    updatedAt: 0
});

export const STORAGE_KEY = 'lpr_program_replay_v1';

function safeStr(v) { return String(v == null ? '' : v).trim(); }
function safeArr(v) { return Array.isArray(v) ? v : []; }

export function normalizeLifeProgramState(raw) {
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_LIFE_PROGRAM_STATE };
    return {
        programs: (raw.programs && typeof raw.programs === 'object') ? { ...raw.programs } : {},
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now()
    };
}

/**
 * 录制/保存一段生活经历为复演节目录
 */
export function recordLifeProgram(state, programSpec, now = Date.now()) {
    const s = normalizeLifeProgramState(state);
    const spec = (programSpec && typeof programSpec === 'object') ? programSpec : {};
    const id = safeStr(spec.id) || `prog_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const title = safeStr(spec.title);

    if (!title) {
        return { success: false, reason: 'title-required', state: s };
    }

    const acts = safeArr(spec.acts).map((act, idx) => ({
        actIndex: idx + 1,
        title: safeStr(act.title) || `第 ${idx + 1} 幕`,
        location: safeStr(act.location),
        narrativeSnippet: safeStr(act.narrativeSnippet),
        dialogues: safeArr(act.dialogues), // [{ speaker, text }]
        perspectives: (act.perspectives && typeof act.perspectives === 'object') ? { ...act.perspectives } : {} // charId -> subjectiveNote
    }));

    const program = {
        id,
        title,
        occasion: safeStr(spec.occasion) || '日常难忘回忆',
        participants: safeArr(spec.participants),
        acts,
        createdAt: now,
        updatedAt: now
    };

    return {
        success: true,
        program,
        state: {
            ...s,
            programs: { ...s.programs, [id]: program },
            updatedAt: now
        }
    };
}

/**
 * 获取指定角色在某一幕的主观视角回忆
 */
export function getActPerspective(program, actIndex, characterId) {
    if (!program || !Array.isArray(program.acts)) return null;
    const act = program.acts.find(a => a.actIndex === Number(actIndex));
    if (!act) return null;

    const charId = safeStr(characterId);
    const specificNote = act.perspectives[charId];

    return {
        actIndex: act.actIndex,
        actTitle: act.title,
        characterId: charId,
        subjectiveView: specificNote || `以旁观者的视角注视着${act.title}`,
        publicSnippet: act.narrativeSnippet
    };
}

/**
 * 启动沙箱重演（纯只读，绝不污染系统真实账本）
 */
export function playbackProgramSummary(program) {
    if (!program || !Array.isArray(program.acts)) {
        return { valid: false, replayOverview: '无可用节目录' };
    }

    const actSummaries = program.acts.map(a => `【第${a.actIndex}幕 · ${a.title}】(${a.location}): ${a.narrativeSnippet}`);
    return {
        valid: true,
        programId: program.id,
        title: program.title,
        totalActs: program.acts.length,
        participants: program.participants,
        replayOverview: actSummaries.join('\n')
    };
}