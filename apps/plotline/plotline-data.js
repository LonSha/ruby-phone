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
import { faceFieldState } from '../../config/world-bridge.js';
/* [v3.10.0 · G-3] 知情网络的**消费侧真源**（上游 v3.219.0 的 `worldProg.knowledge`）。
 *   本文件此前只把它**列出来**（`knowledgeList()`），从不拿它当**约束**用；
 *   于是「谁不知道某件事」在本仓是零消费。本版接上：三档分形（known / unaware / silent）
 *   与匹配方式如实归因全部走 `config/knowledge-contract.js` 这一份实现，本文件不重写。 */
import { knowledgeFace, whoKnows, boundaryOf, unawareBlock, knowledgeLine } from '../../config/knowledge-contract.js';
/** 归因文案（五态；与 readPlotlineFace 的 reason 一一对应，缺项即 UI 显示原始 reason，不静默） */
export const PLOTLINE_REASONS = Object.freeze({
    'ready': '剧情线就绪',
    'empty': '这个会话还没有大纲或世界推进记录',
    'no-plot-face': '记忆插件在，但这版快照没有大纲/世界推进面（需插件较新版本）',
    'upstream-empty': '记忆插件已声明大纲/世界推进面为空（不是没这面，是这次还没记录）',
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
    if (!hasFace) {
        // [v2.98.0] 同 profile：先问上游是否声明过这项。判定只此一份。
        if (faceFieldState(snap, ['outline', 'worldProg']) === 'declared-empty') {
            out.state = 'empty'; out.reason = 'upstream-empty'; out.text = PLOTLINE_REASONS['upstream-empty']; return out;
        }
        out.reason = 'no-plot-face'; out.text = PLOTLINE_REASONS['no-plot-face']; return out;
    }
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
 * 伏笔投影：读记忆插件 worldProg.seedLedger（seed-ledger 的 normalize 形态）。
 * 账本缺失如实返回 []。状态原样透传，不把未知编成 open。
 * @param {object|null} worldProg
 * @returns {Array<{id:string, hook:string, layer:string, status:string}>}
 */
export function seedList(worldProg) {
    const out = [];
    try {
        if (!worldProg || typeof worldProg !== 'object') return out;
        const ledger = worldProg.seedLedger;
        const items = ledger && Array.isArray(ledger.items) ? ledger.items : [];
        for (const item of items) {
            if (!item || typeof item !== 'object') continue;
            const hook = clip(item.hook, 160);
            if (!hook) continue;
            out.push({
                id: clip(item.id, 80),
                hook,
                layer: item.layer === 'far' ? 'far' : 'near',
                status: typeof item.status === 'string' ? item.status : 'open'
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
 * 平行事实投影：读记忆插件 worldProg.parallelLedger（parallel-ledger 的 normalize 形态）。
 * 「别处正在发生的事」：audience 区分 hidden（在场角色不得知晓）/ overheard（已传开）。
 * 账本缺失如实返回 []。状态原样透传，不把未知编成 open。
 * @param {object|null} worldProg
 * @returns {Array<{id:string, title:string, fact:string, place:string, audience:string, status:string}>}
 */
export function parallelList(worldProg) {
    const out = [];
    try {
        if (!worldProg || typeof worldProg !== 'object') return out;
        const ledger = worldProg.parallelLedger;
        const items = ledger && Array.isArray(ledger.items) ? ledger.items : [];
        for (const item of items) {
            if (!item || typeof item !== 'object') continue;
            const title = clip(item.title, 80);
            if (!title) continue;
            out.push({
                id: clip(item.id, 80),
                title,
                fact: clip(item.fact, 160),
                place: clip(item.place, 80),
                audience: item.audience === 'overheard' ? 'overheard' : 'hidden',
                status: typeof item.status === 'string' ? item.status : 'open'
            });
        }
        return out;
    } catch (_e) { return out; }
}
/**
 * 秘密投影：读记忆插件 worldProg.secretLedger（secret-ledger 的 normalize 形态）。
 * 「某角色此刻不该被知晓的事」：keeper 点名持有者。**注意防剧透口径：**
 * 面板层只应显示持有者与推进度，秘密内容本体只进生成侧（见 plotlinePromptBlock）。
 * @param {object|null} worldProg
 * @returns {Array<{id:string, secret:string, keeper:string, progress:number, status:string}>}
 */
export function secretList(worldProg) {
    const out = [];
    try {
        if (!worldProg || typeof worldProg !== 'object') return out;
        const ledger = worldProg.secretLedger;
        const items = ledger && Array.isArray(ledger.items) ? ledger.items : [];
        for (const item of items) {
            if (!item || typeof item !== 'object') continue;
            const secret = clip(item.secret, 160);
            if (!secret) continue;
            const prog = Number(item.progress);
            out.push({
                id: clip(item.id, 80),
                secret,
                keeper: clip(item.keeper, 80),
                progress: Number.isFinite(prog) ? prog : 0,
                status: typeof item.status === 'string' ? item.status : 'sealed'
            });
        }
        return out;
    } catch (_e) { return out; }
}
/**
 * [v2.87] 回扣投影：读记忆插件 worldProg.recallEcho（recall-echo 的 normalize 形态）。
 * 面板层只显示 detail/kind/floor，已回扣/已跳过的不进面板（回扣是生成侧事件）。
 * @param {object|null} worldProg
 * @returns {Array<{id:string, detail:string, kind:string, floor:number}>}
 */
export function recallEchoList(worldProg) {
    const out = [];
    try {
        if (!worldProg || typeof worldProg !== 'object') return out;
        const ledger = worldProg.recallEcho;
        const items = ledger && Array.isArray(ledger.items) ? ledger.items : [];
        for (const item of items) {
            if (!item || typeof item !== 'object') continue;
            if (item.status !== 'pending') continue;
            const detail = clip(item.detail, 120);
            if (!detail) continue;
            out.push({
                id: clip(item.id, 80),
                detail,
                kind: typeof item.kind === 'string' ? item.kind : 'clue',
                floor: Number.isFinite(Number(item.floor)) ? Number(item.floor) : null
            });
        }
        return out;
    } catch (_e) { return out; }
}
/**
 * [v2.87] 回声投影：读记忆插件 worldProg.echoLedger（echo-ledger 的 normalize 形态）。
 * 面板层只显示角色/模式/楼层，fields 与 os 本体只进生成侧（回声是氛围层不是事实层）。
 * @param {object|null} worldProg
 * @returns {Array<{mode:string, char:string, floor:number|null}>}
 */
export function echoLifeList(worldProg) {
    const out = [];
    try {
        if (!worldProg || typeof worldProg !== 'object') return out;
        const ledger = worldProg.echoLedger;
        const items = ledger && Array.isArray(ledger.items) ? ledger.items : [];
        for (const item of items) {
            if (!item || typeof item !== 'object') continue;
            const char = clip(item.char, 40);
            if (!char) continue;
            out.push({
                mode: typeof item.mode === 'string' ? item.mode : 'askbox',
                char,
                floor: Number.isFinite(Number(item.floor)) ? Number(item.floor) : null
            });
        }
        return out;
    } catch (_e) { return out; }
}
/**
 * [v3.10.0 · G-3] 知情网络的**边界面**：三档分形 + 面级五态归因。
 *
 * 与 `knowledgeList()` 的分工：那个函数只把「账里有什么」列出来（渲染用）；
 * 本函数回答「**谁不知道**」以及「这个问题此刻能不能被回答」——
 *   ① 面级三态一律走 `faceFieldState`（本仓唯一真源，本文件不另写形状判据）；
 *   ② `silentCapable === false` 表示账里**一条 unaware 记录都没有**：
 *      此时「谁不知道」在数据上无从回答，UI/生成侧**必须**区分「没记录」与「没入记录的人」。
 *
 * @param {object|null} snapshot 上游快照（与 readPlotlineFace 同一个快照）
 * @returns {{ state:string, line:object, silentCapable:boolean, people:Array }}
 */
export function knowledgeBoundary(snapshot) {
    try {
        const hasFace = !!snapshot;
        const faceState = hasFace ? faceFieldState(snapshot, ['worldProg']) : '';
        const world = (snapshot && typeof snapshot === 'object' && snapshot.worldProg && typeof snapshot.worldProg === 'object')
            ? snapshot.worldProg : null;
        const f = knowledgeFace({ worldProg: world, faceState, hasSnapshot: hasFace });
        return { state: f.state, line: knowledgeLine(f), silentCapable: f.silentCapable === true, people: f.people };
    } catch (_e) {
        const f = knowledgeFace({ mounted: false });
        return { state: f.state, line: knowledgeLine(f), silentCapable: false, people: [] };
    }
}

/**
 * [v3.10.0 · G-3] 「这条事实此刻谁（不）知道」—— 三档分形，**silent 绝不并进 unaware**。
 * 由 `knowledgePromptLines()`（生成侧约束）与 `characterBoundary()` 共同消费。
 *
 * @param {Array} people `knowledgeBoundary().people`
 * @param {string} fact
 * @returns {{ known:Array, unaware:Array, silent:Array, matched:string, unrecorded:number }}
 *   `matched` 是**结论强度**：`exact` 逐字对上 / `substring` 宽泛命中 / `none` 两边都没命中。
 *   调用方必须能看见它 —— 拿宽泛命中当逐字结论，正是本仓 F-4 抓过的假阳性形态。
 */
function whoKnowsFact(people, fact) {
    try { return whoKnows(people, fact); }
    catch (_e) { return { fact: '', known: [], unaware: [], silent: [], matched: 'none', unrecorded: 0 }; }
}

/**
 * [v3.10.0 · G-3] 单角色视角的边界（`boundary` 是**性格面**，不是单条事实的结论）。
 * 由剧情线 App 的 `projection()` 消费，让「这位角色账里到底有没有认知记录」可见。
 */
export function characterBoundary(people, character) {
    try { return boundaryOf(people, character); }
    catch (_e) { return { character: String(character || ''), known: [], unaware: [], recorded: false, knownCount: 0, unawareCount: 0, boundary: 'unrecorded' }; }
}

/**
 * [v3.10.0 · G-3] 把「账里明确记着不知情」的事实收成一组（按事实聚合去重）—— 供
 * `knowledgePromptLines()` 逐条生成约束行。只在两档都有记录时才有意义：
 * 全账零 unaware 时返回 `[]`（**不是**「没人不知道」，是「账里没记，问不出来」；
 * 两条语义的差别由 `knowledgeBoundary().silentCapable` 承担）。
 *
 * @returns {Array<{fact:string, people:string[]}>}
 */
function unawareFacts(people) {
    try {
        const list = Array.isArray(people) ? people : [];
        const map = new Map();
        for (const p of list) {
            if (!p || !p.character) continue;
            for (const fact of (Array.isArray(p.unaware) ? p.unaware : [])) {
                const k = String(fact);
                if (!k) continue;
                if (!map.has(k)) map.set(k, []);
                const arr = map.get(k);
                if (!arr.includes(p.character)) arr.push(p.character);
            }
        }
        return [...map.entries()].map(([fact, ppl]) => ({ fact, people: ppl }));
    } catch (_e) { return []; }
}

/**
 * [v3.10.0 · G-3] 生成侧约束行：把「谁明确不知情」交给模型，让正文不越界。
 * **只列账里有记录的**：silent 与「一条记录都没有的人」一个字都不写 ——
 * 把「没记录」写成约束，模型会把它当事实陈述出去（本仓最贵的那类错读数）。
 * 无可列时返回 `[]`（不产生空块）。
 */
export function knowledgePromptLines(people, opts = {}) {
    try {
        const max = Math.max(1, Number(opts.maxFacts) || 4);
        const rows = unawareFacts(people);
        const out = [];
        for (const r of rows.slice(0, max)) {
            const line = unawareBlock(people, r.fact, { maxChars: 200 });
            if (line) out.push(line);
        }
        return out;
    } catch (_e) { return []; }
}

/**
 * 生成侧一致性块：把「当前阶段 + 未兑现承诺 + 推进中支线」交给生成侧，
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
        const seeds = seedList(face.worldProg).filter((s) => s.status === 'open' || s.status === 'advancing');
        for (const s of seeds.slice(0, 5)) {
            const tag = s.layer === 'far' ? '远场' : (s.status === 'advancing' ? '回收中' : '近场');
            lines.push('- 未回收伏笔〔' + tag + '〕：' + s.hook);
        }
        // [v2.86] 平行事实：已传开的给全量事实，隐藏的只给地点+标题（正文不得让在场角色直接知晓）
        const parallels = parallelList(face.worldProg).filter((p) => p.status === 'open' || p.status === 'touched');
        for (const p of parallels.filter((x) => x.audience === 'overheard').slice(0, 3)) {
            lines.push('- 别处已传开：' + p.title + '（' + p.place + '）' + p.fact);
        }
        for (const p of parallels.filter((x) => x.audience === 'hidden').slice(0, 3)) {
            lines.push('- 别处暗线〔在场角色不得直接知晓，需经传闻/目击自然触及〕：' + p.title + '（' + p.place + '）');
        }
        // [v2.86] 秘密：只给持有者+推进度+内容（正文按 keeper 是否在场决定是否触及，不得无来由泄露）
        const secrets = secretList(face.worldProg).filter((x) => x.status === 'sealed' || x.status === 'advancing');
        for (const x of secrets.slice(0, 3)) {
            lines.push('- 未揭露秘密（持有者：' + x.keeper + '，进度 ' + x.progress + '%，除持有者外无人知晓，不得无来由泄露）：' + x.secret);
        }
        // [v2.87] 回扣候选：给五回合前的细节，正文自然契合才重现（不强行解释为伏笔）
        const echoes = recallEchoList(face.worldProg);
        for (const e of echoes.slice(0, 2)) {
            lines.push('- 前文可回扣〔' + e.kind + '，出现在第' + e.floor + '楼，若与当前情境自然契合才重现，不篡改原意〕：' + e.detail);
        }
        // [v2.87] 角色生活回声：只给模式与角色（fields/os 本体在插件注入面，正文按氛围补全，不改写为既定事实）
        const lifeEchos = echoLifeList(face.worldProg);
        const echoChars = [...new Set(lifeEchos.map((x) => x.char))].slice(0, 3);
        if (echoChars.length) {
            lines.push('- 角色生活回声已有产出（' + echoChars.join('、') + '），可自然化用其氛围，不得改写为剧情既定事实');
        }
        /* [v3.10.0 · G-3] 知情边界约束：把「账里明确记着不知情的人」交给生成侧。
         *   只列**有记录**的那一档；silent（有认知记录但这条事实两边都没记）与
         *   「一条记录都没有的人」**一个字都不写** —— 把「没记录」写成约束，
         *   模型会把它当事实陈述出去（本仓最贵的那类错读数）。
         *   零 unaware 记录时本段为空，块与接线前逐字相同。
         *
         * ★ 位置纪律：本段必须在 `if (!lines.length) return ''` **之前**。
         *   一个世界可能只登记了认知、没有任何承诺/支线/伏笔 —— 若把本段放在早退之后，
         *   「只有认知记录」的世界会因为 `lines` 还空着而被整个丢掉，
         *   于是这一面在最需要它的场合恰好静默失效（首版就是这么写的，已被 B2 判据抓住）。 */
        const kn = (() => {
            try {
                const f = knowledgeFace({ worldProg: face.worldProg, faceState: 'present' });
                return f.state === 'ok' ? knowledgePromptLines(f.people, { maxFacts: 3 }) : [];
            } catch (_e) { return []; }
        })();
        if (kn.length) {
            lines.push('- 知情边界（账里**明确记着**不知情的人，正文不得让他们表现出知情）：');
            for (const l of kn) lines.push('  ' + l);
        }
        if (!lines.length) return '';
        return '【本世界的剧情推进（记忆插件大纲/世界推进，正文节奏不得与之矛盾）】\n' + lines.slice(0, maxLines).join('\n');
    } catch (_e) { return ''; }
}
