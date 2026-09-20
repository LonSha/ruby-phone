/* ========================================================
 * plotline-data.js — [v2.49.0] 剧情线 · 大纲与世界推进数据与投影内核（纯函数，零 window 依赖）
 *
 * 【为什么需要这一面 / 修前实测后果】
 *   上游记忆插件把「大纲」（`snapshot.outline`：当前阶段/节点/回合）与
 *   「世界推进」（`snapshot.worldProg`：承诺/认知/支线）外供到了只读快照桥，
 *   而 RubyPhone 侧实测：**全库零消费**——手机端看不到「剧情走到哪一步了」
 *   「有哪些承诺还没兑现」「哪些支线还在推进」，而这些数据**已经在手边了**。
 *
 * 【本模块的职责（把两个面投影成手机可渲染的东西）】
 *   ① 来源归因 `readPlotlineFace()`：五态如实分开，不把「桥没装」与「这个世界还没有大纲」同形；
 *   ② 投影 `projectPlotline()`：当前大纲 / 承诺 / 支线 / 认知四块可读数据；
 *   ③ 一致性块 `plotlinePromptBlock()`：把「当前阶段与未兑现承诺」交给生成侧，
 *      让正文里的剧情节奏与记忆插件推进的世界是同一个（而不是各写各的）。
 *
 * 【为什么归因要分五态（本仓反复治理的「静默降级」）】
 *   与 wallet/profile 同规格：「桥没装」「桥装了但还没产出快照」「快照是旧版没有大纲面」
 *   三种完全不同的处境在界面上必须同形分开，让用户知道该去装/去等/去升级。
 *
 *   纯 ESM export，纯函数无 window 依赖，保证可测。
 * ======================================================== */
'use strict';
/** 归因文案（五态；与 readPlotlineFace 的 reason 一一对应，缺项即 UI 显示原始 reason，不静默） */
export const PLOTLINE_REASONS = Object.freeze({
    'ready': '剧情线就绪',
    'empty': '这个会话还没有大纲或世界推进记录',
    'no-plot-face': '记忆插件在，但这版快照没有大纲/世界推进面（需插件较新版本）',
    'no-snapshot': '桥在，但还没产出过快照',
    'bridge-absent': 'LonSha 记忆插件未安装'
});
/** 承诺状态文案（未知 status 如实透传原值，不吞） */
export const PROMISE_STATUS = Object.freeze({
    'open': '未兑现',
    'done': '已兑现',
    'broken': '已落空'
});
/** 支线状态文案（未知 status 如实透传原值，不吞） */
export const ARC_STATUS = Object.freeze({
    'active': '推进中',
    'closed': '已收束',
    'dormant': '休眠'
});
/** 默认设置（随会话隔离，键须匹配 /^plotline_/） */
export function defaultPlotlineSettings() {
    return {
        // 是否把「当前阶段 + 未兑现承诺 + 推进中支线」交给生成侧
        injectToPrompt: true,
        // 注入块最多几行
        maxInject: 10
    };
}
/** 取数（不抛；非数值如实 null，不编 0） */
function num(v) { return Number.isFinite(Number(v)) ? Number(v) : null; }
/** 纯文本裁剪（防单条无界） */
function clip(v, max = 160) {
    const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max) + '…' : s;
}
/**
 * 来源归因：把「桥在不在 / 有没有快照 / 有没有剧情面 / 空不空」四种处境与「就绪」分开报。
 * 「剧情面」= outline 为对象（含 stage 结构）或 worldProg 为对象（含 promises/plotArcs/knowledge）。
 *
 * @param {{mounted?:boolean, hasSnapshot?:boolean, snapshot?:object|null}} probe
 * @returns {{state:string, reason:string, outline:object|null, worldProg:object|null, text:string}}
 */
export function readPlotlineFace(probe) {
    const p = probe && typeof probe === 'object' ? probe : {};
    const out = { state: 'absent', reason: 'bridge-absent', outline: null, worldProg: null, text: PLOTLINE_REASONS['bridge-absent'] };
    if (!p.mounted) return out;
    if (!p.hasSnapshot) { out.reason = 'no-snapshot'; out.text = PLOTLINE_REASONS['no-snapshot']; return out; }
    const snap = p.snapshot;
    if (!snap || typeof snap !== 'object') { out.reason = 'no-snapshot'; out.text = PLOTLINE_REASONS['no-snapshot']; return out; }
    const outline = (snap.outline && typeof snap.outline === 'object') ? snap.outline : null;
    const worldProg = (snap.worldProg && typeof snap.worldProg === 'object') ? snap.worldProg : null;
    out.outline = outline; out.worldProg = worldProg;
    const hasFace = !!(outline || worldProg);
    if (!hasFace) { out.reason = 'no-plot-face'; out.text = PLOTLINE_REASONS['no-plot-face']; return out; }
    const stage = outline && typeof outline.stage === 'object' ? outline.stage : null;
    const promises = worldProg && Array.isArray(worldProg.promises) ? worldProg.promises : [];
    const arcs = worldProg && Array.isArray(worldProg.plotArcs) ? worldProg.plotArcs : [];
    const knowledge = worldProg && typeof worldProg.knowledge === 'object' ? worldProg.knowledge : null;
    const hasContent = !!(stage && (stage.title || stage.goal || (Array.isArray(stage.nodes) && stage.nodes.length)))
        || promises.length || arcs.length || (knowledge && Object.keys(knowledge).length);
    if (!hasContent) { out.state = 'empty'; out.reason = 'empty'; out.text = PLOTLINE_REASONS['empty']; return out; }
    out.state = 'ready'; out.reason = 'ready'; out.text = PLOTLINE_REASONS['ready'];
    return out;
}
/**
 * 当前大纲投影：阶段标题/目标/节奏 + 节点列表（每节点标题+目标）。
 * 只读、绝不抛；缺失字段如实置空。
 * @param {object|null} outline
 * @returns {{title:string, goal:string, tempo:string, nodes:Array, hasStage:boolean}}
 */
export function outlineStage(outline) {
    const out = { title: '', goal: '', tempo: '', nodes: [], hasStage: false };
    try {
        if (!outline || typeof outline !== 'object') return out;
        const st = outline.stage && typeof outline.stage === 'object' ? outline.stage : null;
        if (!st) return out;
        out.hasStage = true;
        out.title = clip(st.title, 60);
        out.goal = clip(st.goal, 160);
        out.tempo = clip(st.tempo, 40);
        out.nodes = (Array.isArray(st.nodes) ? st.nodes : []).filter((n) => n && typeof n === 'object').map((n) => ({
            title: clip(n.title, 60), goal: clip(n.goal, 120)
        }));
        return out;
    } catch (_e) { return out; }
}
/**
 * 承诺投影：逐条列出（角色/内容/期限/状态）。
 * 状态未知时如实透传原值（不编成 open/done 之一）。
 * @param {object|null} worldProg
 * @returns {Array<{character:string, content:string, deadline:string, status:string}>}
 */
export function promiseList(worldProg) {
    const out = [];
    try {
        if (!worldProg || typeof worldProg !== 'object') return out;
        const list = Array.isArray(worldProg.promises) ? worldProg.promises : [];
        for (const p of list) {
            if (!p || typeof p !== 'object') continue;
            out.push({
                character: clip(p.character, 40),
                content: clip(p.content, 160),
                deadline: p.deadlineFloor !== null && p.deadlineFloor !== undefined ? '第' + p.deadlineFloor + '楼' : '',
                status: typeof p.status === 'string' ? p.status : 'open'
            });
        }
        return out;
    } catch (_e) { return out; }
}
/**
 * 支线投影：逐条列出（标题/线索/状态）。
 * @param {object|null} worldProg
 * @returns {Array<{title:string, clue:string, status:string}>}
 */
export function arcList(worldProg) {
    const out = [];
    try {
        if (!worldProg || typeof worldProg !== 'object') return out;
        const list = Array.isArray(worldProg.plotArcs) ? worldProg.plotArcs : [];
        for (const a of list) {
            if (!a || typeof a !== 'object') continue;
            out.push({
                title: clip(a.title, 80),
                clue: clip(a.clue, 160),
                status: typeof a.status === 'string' ? a.status : 'active'
            });
        }
        return out;
    } catch (_e) { return out; }
}
/**
 * 认知投影：逐角色列出「已知 / 尚未意识到」两栏。
 * 只读、绝不抛；knowledge 缺失如实返回 []。
 * @param {object|null} worldProg
 * @returns {Array<{character:string, known:string[], unaware:string[]}>}
 */
export function knowledgeList(worldProg) {
    const out = [];
    try {
        if (!worldProg || typeof worldProg !== 'object') return out;
        const k = worldProg.knowledge;
        if (!k || typeof k !== 'object') return out;
        for (const [char, v] of Object.entries(k)) {
            if (!v || typeof v !== 'object') continue;
            out.push({
                character: clip(char, 40),
                known: (Array.isArray(v.known) ? v.known : []).map((x) => clip(x, 120)).filter(Boolean),
                unaware: (Array.isArray(v.unaware) ? v.unaware : []).map((x) => clip(x, 120)).filter(Boolean)
            });
        }
        return out;
    } catch (_e) { return out; }
}
/**
 * 一致性块：把「当前阶段 + 未兑现承诺 + 推进中支线」交给生成侧，
 * 让正文里的剧情节奏与记忆插件推进的世界**是同一个**（无内容返回 ''，不产生空块）。
 * @param {{outline?:object|null, worldProg?:object|null}} face
 * @param {{maxLines?:number}} [opts]
 */
export function plotlinePromptBlock(face, opts = {}) {
    try {
        const maxLines = Math.max(1, Number(opts.maxLines) || 10);
        if (!face || typeof face !== 'object') return '';
        const stage = outlineStage(face.outline);
        const promises = promiseList(face.worldProg).filter((p) => p.status === 'open');
        const arcs = arcList(face.worldProg).filter((a) => a.status === 'active');
        const lines = [];
        if (stage.hasStage) {
            lines.push('- 当前阶段：' + (stage.title || '未命名') + (stage.goal ? '（目标：' + stage.goal + '）' : ''));
        }
        for (const p of promises.slice(0, 6)) {
            lines.push('- 未兑现承诺：' + (p.character ? p.character + ' 对 ' : '') + p.content
                + (p.deadline ? '（期限：' + p.deadline + '）' : ''));
        }
        for (const a of arcs.slice(0, 4)) {
            lines.push('- 推进中支线：' + a.title + (a.clue ? '（线索：' + a.clue + '）' : ''));
        }
        if (!lines.length) return '';
        return '【本世界的剧情推进（记忆插件大纲/世界推进，正文节奏不得与之矛盾）】\n' + lines.slice(0, maxLines).join('\n');
    } catch (_e) { return ''; }
}
