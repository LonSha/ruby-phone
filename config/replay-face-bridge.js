/* ============================================================
 * config/replay-face-bridge.js — [v4.99.9 · R11-X9] 回看面：形状态翻译（纯函数）
 * ------------------------------------------------------------
 * 【这一层治的是什么】
 *   三件内核早就写好了、也被 tests/ 逐条消费过，但**产品端零 import**：
 *     · `life-program-replay`     —— 多幕结构 + 同一段经历的多角色视角（本仓独有表达）；
 *     · `replayable-phone-program`—— 手机经历的可复演节目单与「他当时能看到什么」；
 *     · `smart-gallery-vault`     —— 相册保险箱（公开流 / 私密分区 + 解锁冷却）。
 *   用户从来没有「按幕回看一段时间里发生过的事」这个动作，也从来没有「保险箱」这个分区。
 *   X9 就是把这三件接成「回看」——本层是产品面与内核之间**唯一**的形状翻译处。
 *
 * 【为什么必须有一层翻译，而不是 App 直接拼】
 *   ① 三件内核的返回体形状各不相同：
 *      · `getActPerspective` → {actIndex, actTitle, characterId, subjectiveView, publicSnippet}
 *        —— 它**永远**返回一个 view：没有该角色的主观回忆时回落成
 *        「以旁观者的视角注视着<幕名>」。这个回落若被产品面当成「他当时真这么想」，
 *        就是把「没有记录」演成「有记录」。故本层给 `isFallback` 让视图必须说出来。
 *      · `playbackProgramSummary` → {valid, programId, title, totalActs, participants, replayOverview}
 *        —— 不可用时**只给一句** `无可用节目录`，连 title 都没有（形状收缩）。
 *      · `replayProgramStepByPerspective` → {success, canObserveDetails, observedData, missedOpportunities}
 *        —— 「看不到细节」与「这一步不存在」是两种 `success` 不同的失败，压成一句就分不开。
 *      · `queryPhotos` / `SmartGalleryVault` 实例 → 解锁与否决定 `vaultPhotos` 能不能给 url。
 *      视图若各写一遍取值，就是**同一口径三份实现**，改内核时三处都要找一遍。
 *   ② 「三态必须不同形」在回看面尤其要紧：
 *      · 台帐：**读不到** ≠ **还没录过** ≠ **录了 N 段**；
 *      · 视角：**有该角色的回忆** ≠ **没有（回落成旁观）** ≠ **视角名坏掉**；
 *      · 保险箱：**锁着** ≠ **空的** ≠ **保险箱读不到**。
 *      压成一句就是本仓治过多次的「看起来没坏但显示不对」。
 *   ③ 文案只许一处：本层给 `label` / `note`，视图只消费，不自己写字面量。
 *
 * 【本层刻意不做的事】
 *   · **不生成内容**：回看只读已落盘记录（计划原文「不许回看时重新生成内容」）。
 *     本层所有函数都是 (已有数据) => (视图形状)，没有一句会造出新叙事文本。
 *   · **不写存储**：本层是纯函数，没有 storage 句柄，也不 import 存储层。
 *   · **不改入参**：所有返回都是新对象，传入的 program / vault 一字不动。
 *   · **不判权限**：保险箱能不能开由 `SmartGalleryVault.unlockVault` 判；本层只翻译结论。
 *   · **不合并「锁着」与「空的」**：锁着时 `vaultRows` **一条 url 都不给**，
 *     只给条数摘要 —— 否则「锁着」就成了摆设。
 * ============================================================ */
'use strict';
import {
    getActPerspective, playbackProgramSummary, normalizeLifeProgramState, STORAGE_KEY as REPLAY_LEDGER_KEY
} from './life-program-replay.js';
import { replayProgramStepByPerspective, createReplayableProgram } from './replayable-phone-program.js';
import { PHOTO_SECRECY } from './smart-gallery-vault.js';

/* 台账落盘键**不另写字面量**：`lpr_program_replay_v1` 的唯一出处是内核的 `STORAGE_KEY`，
 *   本层只转出（两处写字面量就会有一处先漂）。 */
export { REPLAY_LEDGER_KEY };

/* ══════════ 视角三格 ══════════ */

/** 三个视角（**唯一出处**：视图不写这三个字面量）。 */
export const REPLAY_VIEWERS = Object.freeze({
    SELF: 'self',
    OTHER: 'other',
    BYSTANDER: 'bystander'
});

const VIEWER_LABELS = Object.freeze({
    self: '本人视角',
    other: '对方视角',
    bystander: '旁观视角'
});

/**
 * 视角名的界面文案。坏值如实念，不回落成「本人」（回落 = 把读坏演成正常）。
 * @param {string} kind REPLAY_VIEWERS 之一（或坏值）
 * @returns {string}
 */
export function viewerLabelOf(kind) {
    const k = (typeof kind === 'string') ? kind.trim() : '';
    if (Object.prototype.hasOwnProperty.call(VIEWER_LABELS, k)) return VIEWER_LABELS[k];
    return k ? ('未知视角「' + k + '」') : '视角未选';
}

/** 该视角名是否合法（视图据此决定画不画切换按钮）。 */
export function viewerKnown(kind) {
    const k = (typeof kind === 'string') ? kind.trim() : '';
    return Object.prototype.hasOwnProperty.call(VIEWER_LABELS, k);
}

/* ══════════ 台账三态 ══════════ */

const _safeStr = (v) => String(v == null ? '' : v).trim();

/**
 * 节目台账 → 列表形状。**四态不同形**：
 *   · `missing` —— 台账读不到（storage 抛错 / 句柄没给）：**不是**「还没录过」；
 *   · `empty`   —— 台账在，但一段都没有；
 *   · `ok`      —— 有 N 段（rows 按 createdAt 降序，最近的在最上）；
 *   · `threw`   —— 归一化那一步自己坏了（`why` 带原话）。
 *
 * ★ 为什么 `missing` 与 `empty` 必须分开：前者后端没接好（该报 bug），
 *   后者是正常新会话（该提示「去归档一段」）。处置相反，界面不许同一句话。
 *
 * @param {object|null} state `normalizeLifeProgramState` 的产物（或 null）
 * @param {{rawReadable?:boolean, why?:string}} [opts] rawReadable：调用点是否真读到了盘
 * @returns {{state:string, label:string, rows:Array, count:number, readable:boolean, why:string}}
 */
export function programRowsOf(state, opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const readable = o.rawReadable !== false;
    if (!readable) {
        return {
            state: 'missing', label: '回看台账读不到（不是「还没录过」）',
            rows: [], count: 0, readable: false, why: _safeStr(o.why) || 'read_failed'
        };
    }
    let programs;
    try {
        programs = (state && typeof state === 'object' && state.programs && typeof state.programs === 'object')
            ? state.programs : null;
    } catch (e) {
        return {
            state: 'threw', label: '回看台账读不了（归一化抛错）',
            rows: [], count: 0, readable: false, why: _safeStr(e && e.message) || 'normalize_threw'
        };
    }
    if (!programs) {
        return {
            state: 'empty', label: '还没有回看节目（台账在，一段都没录）',
            rows: [], count: 0, readable: true, why: ''
        };
    }
    const rows = Object.keys(programs).map((id) => {
        const p = programs[id];
        if (!p || typeof p !== 'object') return null;
        const acts = Array.isArray(p.acts) ? p.acts : [];
        const participants = Array.isArray(p.participants) ? p.participants.map(_safeStr).filter(Boolean) : [];
        return {
            id: _safeStr(p.id) || id,
            title: _safeStr(p.title) || '未命名节目',
            occasion: _safeStr(p.occasion) || '日常难忘回忆',
            participants,
            actCount: acts.length,
            createdAt: Number(p.createdAt) || 0,
            /* 一行读数：视图直接用，不自己拼（拼就会有两处文案）。 */
            line: _safeStr(p.title) + ' · ' + String(acts.length) + ' 幕'
                + (participants.length ? (' · ' + participants.join('、')) : '')
        };
    }).filter(Boolean);
    rows.sort((a, b) => (b.createdAt - a.createdAt) || (a.title < b.title ? -1 : 1));
    return {
        state: rows.length ? 'ok' : 'empty',
        label: rows.length
            ? ('回看节目 ' + String(rows.length) + ' 段')
            : '还没有回看节目（台账在，一段都没录）',
        rows,
        count: rows.length,
        readable: true,
        why: ''
    };
}
/* ══════════ 幕次 ══════════ */

/**
 * 台账**原始读数**（storage 里那一坨）→ 列表形状。把「读不到 / 坏 JSON / 真数据」
 * 三件事在**一处**分清，App 侧不再各写一遍 try-catch。
 *
 * ★ 为什么坏 JSON 与「读不到」不同形：前者说明**这份档坏了**（用户该知道自己的
 *   回看记录读不出来，且不该被下一次写入静默覆盖），后者说明**句柄没接好**。
 *
 * @param {string|object|null} raw storage 里读到的原值（字符串 / 已解析对象 / null）
 * @returns {{state:string, label:string, rows:Array, count:number, readable:boolean,
 *            why:string, programs:object}}
 */
export function replayStateOf(raw) {
    let parsed = raw;
    let badJson = false;
    if (typeof raw === 'string') {
        const t = raw.trim();
        if (!t) {
            parsed = null;
        } else {
            try {
                parsed = JSON.parse(t);
            } catch (_e) {
                badJson = true;
                parsed = null;
            }
        }
    }
    if (badJson) {
        const out = programRowsOf(null, { rawReadable: false, why: 'bad_json' });
        return Object.assign(out, {
            label: '回看台账内容坏了（不是「还没录过」）',
            programs: {}
        });
    }
    const state = normalizeLifeProgramState(parsed);
    const rows = programRowsOf(state, { rawReadable: true });
    return Object.assign(rows, { programs: state.programs || {} });
}


/**
 * 一个节目 → 幕次行。空节目与坏节目不同形。
 *
 * @param {object} program
 * @returns {{state:string, label:string, title:string, rows:Array, count:number, why:string}}
 */
export function actRowsOf(program) {
    if (!program || typeof program !== 'object') {
        return { state: 'missing', label: '这个节目读不到（不是「它没有幕」）', title: '', rows: [], count: 0, why: 'no_program' };
    }
    const title = _safeStr(program.title) || '未命名节目';
    let acts;
    try {
        acts = Array.isArray(program.acts) ? program.acts : null;
    } catch (e) {
        return { state: 'threw', label: '幕次读不了（结构抛错）', title, rows: [], count: 0, why: _safeStr(e && e.message) || 'acts_threw' };
    }
    if (!acts) {
        return { state: 'missing', label: '这个节目没有幕次字段（不是「零幕」）', title, rows: [], count: 0, why: 'no_acts_field' };
    }
    const rows = acts.map((a, i) => {
        if (!a || typeof a !== 'object') return null;
        const perspectives = (a.perspectives && typeof a.perspectives === 'object') ? a.perspectives : {};
        const viewpoints = Object.keys(perspectives).filter((k) => _safeStr(perspectives[k]));
        const dialogues = Array.isArray(a.dialogues) ? a.dialogues : [];
        return {
            actIndex: Number(a.actIndex) || (i + 1),
            title: _safeStr(a.title) || ('第 ' + String(i + 1) + ' 幕'),
            location: _safeStr(a.location),
            narrativeSnippet: _safeStr(a.narrativeSnippet),
            dialogueCount: dialogues.length,
            viewpoints,
            /* 「谁在这段经历里有主观回忆」是用户能看见的**有据**信息；
             *   没有视角不等于没人参与，故这一格只报「有几个人的回忆」，不推人数。 */
            line: _safeStr(a.title) + (viewpoints.length ? (' · ' + String(viewpoints.length) + ' 人有回忆') : ' · 没有主观回忆')
        };
    }).filter(Boolean);
    return {
        state: rows.length ? 'ok' : 'empty',
        label: rows.length ? ('共 ' + String(rows.length) + ' 幕') : '这个节目是空的（零幕）',
        title,
        rows,
        count: rows.length,
        why: ''
    };
}

/**
 * 单幕的三视角取数：本人 / 对方 / 旁观。
 *
 * ★ 三格分别是「三种不同来源」，不是同一句话换个标签：
 *   · self / other —— 走 `getActPerspective` 取**该角色的主观回忆**；
 *   · bystander    —— 取 `narrativeSnippet`（公共叙述），**不**调 specificNote
 *                     （旁观者的视角就是公共可见的那部分，本来就没有「内心」）。
 *
 * ★ `isFallback:true` 必须被界面明写：内核在没有该角色回忆时回落成
 *   「以旁观者的视角注视着<幕名>」—— 那句是**兜底句**，不是记录。
 *   把它当记录展示，等于替角色编了一段他没说过的内心。
 *
 * @param {object} program
 * @param {number} actIndex 1 起的幕号
 * @param {string} kind REPLAY_VIEWERS 之一
 * @param {{selfId?:string, otherId?:string}} [opts]
 * @returns {{ok:boolean, kind:string, label:string, characterId:string,
 *            view:string, isFallback:boolean, actTitle:string, why:string}}
 */
export function perspectiveOf(program, actIndex, kind, opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const k = _safeStr(kind);
    const blank = (why) => ({
        ok: false, kind: k, label: viewerLabelOf(k), characterId: '',
        view: '', isFallback: false, actTitle: '', why
    });
    if (!viewerKnown(k)) return blank('bad_viewer');
    if (!program || typeof program !== 'object' || !Array.isArray(program.acts)) return blank('no_program');
    const idx = Number(actIndex);
    const act = program.acts.find((a) => a && Number(a.actIndex) === idx);
    if (!act) return blank('no_act');

    if (k === REPLAY_VIEWERS.BYSTANDER) {
        const snippet = _safeStr(act.narrativeSnippet);
        return {
            ok: true, kind: k, label: VIEWER_LABELS[k], characterId: '',
            view: snippet, isFallback: !snippet,
            actTitle: _safeStr(act.title), why: snippet ? '' : 'no_public_snippet'
        };
    }

    const selfId = _safeStr(o.selfId) || 'protagonist';
    const perspectives = (act.perspectives && typeof act.perspectives === 'object') ? act.perspectives : {};
    /* 对方 id 的三级来源：调用点指定 → 本幕主观回忆里的第一个非本人 → 节目参与者里的第一个非本人。
     *   刻意不猜名字：三个来源都没有时如实说「没有对方」，不拿「旁白」顶替一个人。 */
    let otherId = _safeStr(o.otherId);
    if (!otherId) {
        otherId = Object.keys(perspectives).find((x) => _safeStr(x) && _safeStr(x) !== selfId) || '';
    }
    if (!otherId) {
        const parts = Array.isArray(program.participants) ? program.participants.map(_safeStr) : [];
        otherId = parts.find((x) => x && x !== selfId) || '';
    }
    const charId = (k === REPLAY_VIEWERS.SELF) ? selfId : otherId;
    if (!charId) return blank('no_character');

    const r = getActPerspective(program, idx, charId);
    if (!r) return blank('no_act');
    const hasNote = Object.prototype.hasOwnProperty.call(perspectives, charId);
    return {
        ok: true,
        kind: k,
        label: VIEWER_LABELS[k],
        characterId: charId,
        view: _safeStr(r.subjectiveView),
        isFallback: !hasNote,
        actTitle: _safeStr(r.actTitle),
        why: hasNote ? '' : 'no_specific_note'
    };
}

/**
 * 节目总述（`playbackProgramSummary` 的形状翻译）。
 *
 * @param {object} program
 * @returns {{ok:boolean, title:string, totalActs:number, participants:string[],
 *            overview:string, label:string, why:string}}
 */
export function programSummaryOf(program) {
    let raw;
    try {
        raw = playbackProgramSummary(program);
    } catch (e) {
        return {
            ok: false, title: '', totalActs: 0, participants: [], overview: '',
            label: '节目总述判不出来（内核抛错）', why: _safeStr(e && e.message) || 'summary_threw'
        };
    }
    if (!raw || raw.valid !== true) {
        return {
            ok: false, title: '', totalActs: 0, participants: [], overview: '',
            label: '无可用节目录', why: 'invalid_program'
        };
    }
    const totalActs = Number(raw.totalActs) || 0;
    const participants = Array.isArray(raw.participants) ? raw.participants.map(_safeStr).filter(Boolean) : [];
    return {
        ok: true,
        title: _safeStr(raw.title),
        totalActs,
        participants,
        overview: _safeStr(raw.replayOverview),
        label: _safeStr(raw.title) + ' · ' + String(totalActs) + ' 幕'
            + (participants.length ? (' · ' + participants.join('、')) : ''),
        why: ''
    };
}

/* ══════════ 可复演节目单（「他当时能看到什么」） ══════════ */

/**
 * 逐步重放的形状翻译。**三态不同形**：
 *   · `missing`  —— 节目单不是节目单（`invalid_program`）；
 *   · `oob`      —— 节目在，但这一步不存在（`step_out_of_bound`）；
 *   · `ok`       —— 取到了；`canObserveDetails` 决定画不画内容。
 *
 * ★ 「看不到细节」时 `observedData` 由内核给成 `{summary:'未公开的动作'}` ——
 *   本层**原样转发**那句，不替它改写成「无内容」：前者说明「有动作但你看不到」，
 *   后者会被读成「这一步什么也没发生」。两者处置相反。
 *
 * @param {object} program `createReplayableProgram` 的产物
 * @param {number} stepIndex 0 起的步号
 * @param {string} perspectiveActorId 视角角色 id
 * @returns {{state:string, ok:boolean, label:string, canObserveDetails:boolean,
 *            observedText:string, missed:Array, actorId:string, why:string}}
 */
export function stepViewOf(program, stepIndex, perspectiveActorId) {
    let raw;
    try {
        raw = replayProgramStepByPerspective(program, stepIndex, perspectiveActorId);
    } catch (e) {
        return {
            state: 'threw', ok: false, label: '这一步判不出来（内核抛错）',
            canObserveDetails: false, observedText: '', missed: [], actorId: '',
            why: _safeStr(e && e.message) || 'step_threw'
        };
    }
    if (!raw || raw.success !== true) {
        const why = _safeStr(raw && raw.reason) || 'invalid_program';
        return {
            state: why === 'step_out_of_bound' ? 'oob' : 'missing',
            ok: false,
            label: why === 'step_out_of_bound' ? '没有这一步（不是「这一步是空的」）' : '这不是一段可复演的节目单',
            canObserveDetails: false, observedText: '', missed: [], actorId: '',
            why
        };
    }
    const can = raw.canObserveDetails === true;
    const data = raw.observedData;
    let observedText = '';
    if (can) {
        observedText = (data && typeof data === 'object')
            ? _safeStr(data.text || data.summary || JSON.stringify(data))
            : _safeStr(data);
    } else {
        /* 内核在不可看时给的是 `{summary:'未公开的动作'}` —— 原样念出来。 */
        observedText = _safeStr(data && typeof data === 'object' ? data.summary : data) || '未公开的动作';
    }
    const missed = Array.isArray(raw.missedOpportunities) ? raw.missedOpportunities.slice() : [];
    return {
        state: 'ok', ok: true,
        label: can ? '看得到这一步的细节' : '这一段对你不可见（不是「什么都没发生」）',
        canObserveDetails: can,
        observedText,
        missed,
        actorId: _safeStr(raw.actorId),
        why: ''
    };
}

/**
 * 整个节目单的逐步行（一次取齐，避免视图循环里各判一次形状）。
 *
 * @param {object} program
 * @param {string} perspectiveActorId
 * @returns {{state:string, label:string, rows:Array, count:number, visibleCount:number, why:string}}
 */
export function stepRowsOf(program, perspectiveActorId) {
    if (!program || typeof program !== 'object' || !Array.isArray(program.steps)) {
        return {
            state: 'missing', label: '这不是一段可复演的节目单', rows: [],
            count: 0, visibleCount: 0, why: 'invalid_program'
        };
    }
    const rows = [];
    let visibleCount = 0;
    for (let i = 0; i < program.steps.length; i += 1) {
        const v = stepViewOf(program, i, perspectiveActorId);
        rows.push(Object.assign({ stepIndex: i }, v));
        if (v.canObserveDetails) visibleCount += 1;
    }
    return {
        state: rows.length ? 'ok' : 'empty',
        label: rows.length
            ? ('共 ' + String(rows.length) + ' 步 · 你能看到 ' + String(visibleCount) + ' 步')
            : '节目单是空的（零步）',
        rows,
        count: rows.length,
        visibleCount,
        why: ''
    };
}

/**
 * 一幕的「当时谁能看到什么」：节目单**完全由已录对白重建**，一句都不生成。
 *
 * 【为什么要把对白重建成节目单】台账只记「有哪几幕」，而 `replayProgramStepByPerspective`
 *   判的是「这一步当时谁能看到细节」。两者的桥就是：把这一幕**已录好的对白**
 *   当成逐步节目单（说话人 = 行动者，正文 = 当时可见材料，`isPrivate` 取录制时写入的标记）。
 *   ★ 录制时没写 `isPrivate` 就按公开叙述处理 —— 那是**录制方的口径**，不是本层猜的。
 *
 * 【四态不同形】没这个节目 / 没这一幕 / 这一幕没对白 / 有 N 句对白 —— 压平任意两态，
 *   「这一幕谁都没说话」与「这一幕根本没录」就会长得一模一样。
 *
 * @param {object} program 台账里的节目
 * @param {number} actIndex 1 起的幕号
 * @param {string} viewerId 视角角色 id
 * @returns {{state:string, label:string, rows:Array, count:number, visibleCount:number, why:string}}
 */
export function actStepsOf(program, actIndex, viewerId) {
    if (!program || typeof program !== 'object' || !Array.isArray(program.acts)) {
        return { state: 'missing', label: '这个节目读不到（不是「它没有对白」）', rows: [], count: 0, visibleCount: 0, why: 'no_program' };
    }
    const act = program.acts.find((a) => a && Number(a.actIndex) === Number(actIndex));
    if (!act) {
        return { state: 'missing', label: '没有这一幕（不是「这一幕没有对白」）', rows: [], count: 0, visibleCount: 0, why: 'no_act' };
    }
    const dialogues = Array.isArray(act.dialogues) ? act.dialogues : [];
    if (!dialogues.length) {
        return { state: 'empty', label: '这一幕没有记录对白（不是「谁都看不到」）', rows: [], count: 0, visibleCount: 0, why: 'no_dialogues' };
    }
    const steps = dialogues.map((d) => ({
        actorId: _safeStr(d && d.speaker) || 'narrator',
        actionDescription: _safeStr(d && d.text),
        visibleData: { text: _safeStr(d && d.text), isPrivate: (d && d.isPrivate) === true },
        chosenOption: null,
        alternativeOptions: []
    }));
    const rp = createReplayableProgram(_safeStr(act.title) || '这一幕', steps);
    return stepRowsOf(rp, _safeStr(viewerId));
}


/* ══════════ 归档：把**已落盘对话**切成节目规格（不生成任何一句） ══════════ */

/** 一句对白里「谁说的」：只认已有字段，不猜。 */
function _speakerOf(msg, selfName) {
    const name = _safeStr(msg && (msg.name || msg.speaker || msg.characterName));
    if (name) return name;
    return (msg && msg.is_user === true) ? selfName : 'narrator';
}

/** 正文：只做「取已落盘的那一份」，不补写、不改写。 */
function _textOf(msg) {
    return _safeStr(msg && (msg.text != null ? msg.text : msg.mes));
}

/**
 * 已落盘对话 → `recordLifeProgram` 用的 `programSpec`。**纯截取，零生成**。
 *
 * 【为什么这一条必须存在】
 *   X9 的硬约束是「回看只读已落盘记录」。但台账（`lpr_program_replay_v1`）本身
 *   从来没有人写 —— 于是「回看页」会永远停在「还没录过」：判据全绿、用户永远看不到东西
 *   （本仓最贵的假绿）。归档这一步就是把**盘上已有的对话**切成幕，写进台账。
 *
 * 【为什么不写 `perspectives`（主观回忆）】
 *   聊天记录里没有「谁当时心里怎么想」这一层。若归档时顺手拿台词当内心，
 *   那就是把「他说过的话」演成「他的回忆」——正是本层反复防的那一格。
 *   故归档只产出公共叙述，主观回忆留空：三视角里 self / other 会如实标兜底，
 *   等角色在剧情里真写下 `perspectives` 才会有「有记录」的那种。
 *
 * 【切幕口径】
 *   `perAct` 条对白一幕（默认 6）。消息少于一条时返回 `empty`（不是「一段 0 幕的节目」）。
 *
 * @param {Array<object>} messages 已落盘消息（`{is_user, name, text|mes}`）
 * @param {{title?:string, occasion?:string, participants?:string[], selfName?:string,
 *          perAct?:number, now?:number, id?:string}} [opts]
 * @returns {{state:string, label:string, spec:object|null, actCount:number,
 *            dialogueCount:number, speakers:string[], why:string}}
 */
export function programSpecFromChat(messages, opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const list = Array.isArray(messages) ? messages : null;
    if (!list) {
        return { state: 'missing', label: '这段对话读不到（不是「这里面没内容」）', spec: null, actCount: 0, dialogueCount: 0, speakers: [], why: 'no_messages' };
    }
    const selfName = _safeStr(o.selfName) || '我';
    const rows = [];
    for (const m of list) {
        if (!m || typeof m !== 'object') continue;
        if (m.is_system === true) continue;                 // 系统楼层不是对白
        const text = _textOf(m);
        if (!text) continue;                                // 空正文不进节目单
        rows.push({ speaker: _speakerOf(m, selfName), text });
    }
    if (!rows.length) {
        return { state: 'empty', label: '这段对话里没有可取的对白（不是「读不到」）', spec: null, actCount: 0, dialogueCount: 0, speakers: [], why: 'no_dialogues' };
    }
    const perAct = Math.max(1, Number(o.perAct) || 6);
    const speakers = [];
    for (const r of rows) if (!speakers.includes(r.speaker)) speakers.push(r.speaker);
    const acts = [];
    for (let i = 0; i < rows.length; i += perAct) {
        const chunk = rows.slice(i, i + perAct);
        const idx = acts.length + 1;
        acts.push({
            title: '第 ' + String(idx) + ' 幕',
            location: '',
            /* 公共叙述取这一段的**第一句原文**（截取，不是概述）。
             *   它答的是「这一段是从哪句话开始的」，不替用户总结发生过什么。 */
            narrativeSnippet: chunk[0].text,
            dialogues: chunk.map((c) => ({ speaker: c.speaker, text: c.text, isPrivate: false })),
            /* ★ 留空：归档不代写任何人的内心（见函数头注释）。 */
            perspectives: {}
        });
    }
    const title = _safeStr(o.title) || ('存档对话 · ' + String(rows.length) + ' 句');
    return {
        state: 'ok',
        label: '可归档 ' + String(acts.length) + ' 幕 · ' + String(rows.length) + ' 句',
        spec: {
            id: _safeStr(o.id),
            title,
            occasion: _safeStr(o.occasion) || '日常难忘回忆',
            participants: Array.isArray(o.participants) ? o.participants.map(_safeStr).filter(Boolean) : speakers,
            acts
        },
        actCount: acts.length,
        dialogueCount: rows.length,
        speakers,
        why: ''
    };
}

/* ══════════ 保险箱分区 ══════════ */

const SECRECY_LABELS = Object.freeze({
    PUBLIC: '公开',
    INTIMATE: '私密',
    TOP_SECRET: '绝密'
});

/** 密级文案（唯一出处）。坏值如实念，不回落成「公开」（回落 = 把绝密显示成公开）。 */
export function secrecyLabelOf(secrecy) {
    const s = _safeStr(secrecy);
    if (Object.prototype.hasOwnProperty.call(SECRECY_LABELS, s)) return SECRECY_LABELS[s];
    return s ? ('未知密级「' + s + '」') : '密级未标';
}

/** 一条照片 → 视图行（公开面用：带 url）。 */
function _photoRow(p) {
    const id = _safeStr(p && p.id);
    if (!id) return null;
    const actors = Array.isArray(p.actors) ? p.actors.map(_safeStr).filter(Boolean) : [];
    return {
        id,
        url: _safeStr(p.url),
        title: _safeStr(p.title) || '无标题照片',
        scene: _safeStr(p.scene) || '日常',
        secrecy: _safeStr(p.secrecy) || PHOTO_SECRECY.PUBLIC,
        secrecyLabel: secrecyLabelOf(p.secrecy),
        actors,
        timestamp: Number(p.timestamp) || 0,
        tags: Array.isArray(p.tags) ? p.tags.map(_safeStr).filter(Boolean) : []
    };
}

/**
 * 锁着时的行：**一条 url 都不给**，只给足以让用户认出「里面有几张」的摘要。
 *
 * ★ 这是本层对「保险箱」的唯一承诺：锁着 = 拿不到画面。若这里把 url 带出去，
 *   那么「锁着」只是 CSS 上的一层遮挡，任何一次 DOM 检查都能绕过。
 */
function _lockedRow(p) {
    const id = _safeStr(p && p.id);
    if (!id) return null;
    return {
        id,
        url: '',
        title: '（已加密）',
        scene: _safeStr(p.scene) || '日常',
        secrecy: _safeStr(p.secrecy) || PHOTO_SECRECY.INTIMATE,
        secrecyLabel: secrecyLabelOf(p.secrecy),
        actors: [],
        timestamp: Number(p.timestamp) || 0,
        tags: []
    };
}

/**
 * 保险箱分区：公开流 / 私密分区。**四态不同形**：
 *   · `missing`  —— 保险箱读不到（中枢缺席）：**不是**「保险箱是空的」；
 *   · `locked`   —— 保险箱在且锁着（`vaultRows` 只有摘要，无 url）；
 *   · `open`     —— 已解锁（`vaultRows` 带 url）；
 *   · `empty`    —— 保险箱在、也解锁了，但里面一张都没有。
 *
 * @param {object|null} vault `SmartGalleryVault` 实例（可缺席）
 * @returns {{state:string, label:string, locked:boolean, readable:boolean,
 *            publicRows:Array, vaultRows:Array, publicCount:number, vaultCount:number,
 *            publicPaths:string[], excludedPaths:string[], why:string}}
 */
export function vaultPartitionOf(vault) {
    if (!vault || typeof vault !== 'object') {
        return {
            state: 'missing', label: '保险箱读不到（不是「保险箱是空的」）',
            locked: true, readable: false, publicRows: [], vaultRows: [],
            publicCount: 0, vaultCount: 0, publicPaths: [], excludedPaths: [], why: 'no_vault'
        };
    }
    let pub;
    let vau;
    try {
        pub = Array.isArray(vault.photos) ? vault.photos : [];
        vau = Array.isArray(vault.vaultPhotos) ? vault.vaultPhotos : [];
    } catch (e) {
        return {
            state: 'missing', label: '保险箱读不了（字段抛错）',
            locked: true, readable: false, publicRows: [], vaultRows: [],
            publicCount: 0, vaultCount: 0, publicPaths: [], excludedPaths: [], why: _safeStr(e && e.message) || 'vault_threw'
        };
    }
    const unlocked = vault.isUnlocked === true;
    const publicRows = pub.map(_photoRow).filter(Boolean);
    const vaultRows = vau.map(unlocked ? _photoRow : _lockedRow).filter(Boolean);
    /* `excludedPaths`：**保险箱里所有照片的路径**，供相册主列表把已入箱的影像剔掉
     *   （验收：「保险箱内容不出现在普通相册列表」）。
     *   ★ 这一项**只用于过滤**，任何视图都不得直接渲染它 —— 它存在的原因是
     *     「过滤要准确」必须知道全集，而「锁着不泄露」约束的是**给用户看**的那一层。
     *     视图侧拿它做一次 Set 查表，不写进 DOM。 */
    const norm = (u) => String(u || '').split('?')[0].split('#')[0];
    const excludedPaths = vau.map((p) => norm(p && p.url)).filter(Boolean);
    /* `publicPaths`：这一格才是「能安全画出来的路径集合」——
     *   锁着时只含公开流，解锁后才并入私密分区。 */
    const publicPaths = (unlocked ? publicRows.concat(vaultRows) : publicRows)
        .map((r) => norm(r.url))
        .filter(Boolean);
    let state;
    let label;
    if (!unlocked) {
        state = 'locked';
        label = vau.length
            ? ('保险箱已锁 · ' + String(vau.length) + ' 项（解锁后才显示画面）')
            : '保险箱已锁（里面现在是空的，解锁后才会显示）';
    } else if (vau.length) {
        state = 'open';
        label = '保险箱已解锁 · ' + String(vau.length) + ' 项';
    } else {
        state = 'empty';
        label = '保险箱是空的（已解锁，0 项）';
    }
    return {
        state, label, locked: !unlocked, readable: true,
        publicRows, vaultRows,
        publicCount: publicRows.length, vaultCount: vaultRows.length,
        publicPaths, excludedPaths,
        why: ''
    };
}

/**
 * 密级可选值（视图画选择器用；**唯一出处**，不在视图里手抄三个字面量）。
 * @returns {Array<{value:string,label:string}>}
 */
export function secrecyOptions() {
    return Object.keys(PHOTO_SECRECY).map((k) => ({ value: PHOTO_SECRECY[k], label: secrecyLabelOf(PHOTO_SECRECY[k]) }));
}
