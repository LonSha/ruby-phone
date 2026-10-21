/* ============================================================
 * config/material-board-handoff.js — [v4.45.0 · 第五期 R5-O1]
 *   取材板 → 「创作草稿」/「下一次主聊天」的**交接凭据**（纯契约件）
 * ------------------------------------------------------------
 * 【这一刀治的是什么（读码可复算，不是推演）】
 *   计划原文（R5-O1 现状证据）：
 *     「creationdesk-view.js:316–318 点击只调用 boardHandoff；
 *       creationdesk-app.js:315–318 返回 this._board.handoff()，返回材料没有消费。
 *       owner 字符串不是实际交接。」
 *   实测复核：`boardHandoff()` 端出的是一份**读数**，里面只有一个
 *     `handoff: { composeOwner: 'context-compose', budgetOwner: 'injection-router',
 *                 draftOwner: 'creation-pipeline' }` ——
 *   三个**字符串**。谁都没被调用，一个字节都没落笔；按钮点下去与不点，世界完全一样。
 *   这与本仓反复治过的「看起来没坏但显示不对」同族：不报错、不崩界面，
 *   只是把「什么都没发生」显示成「已经交给既有 owner 了」。
 *
 * 【为什么不能直接把 pick.items 塞进创作草稿（本项的真实难点）】
 *   两边**词表不同**，而且不是笔误：
 *     · 取材板的 `source` 是**记忆事实的来源**（continuity / recall / scene-book /
 *       relation / promise / pov / fated-recall / lore / note / caller）；
 *     · `config/creation-pipeline.js` 的 `CREATION_SOURCES` 是**App 内容的来源**
 *       （musicdesk / stickerdesk / soundkit / pixiv / lofter / magazine / pvdesk / doujin）。
 *   拿前者去 `buildCreationDraft` 必被 `source-not-found` 拒；硬塞进草稿本则会让
 *   「这条素材来自哪个 App」这个问题在同一张表里出现**两套答案**。
 *   ⇒ 本件的回答：**不假装同表**。取材板交出的草稿行如实带 `source: 'material-board'`
 *     与自己的 `refs`，并把「它是记忆事实、不是 App 内容」写进读数。
 *     这既守住了「不新增草稿库」（仍落既有 `cw_drafts` 那一格），
 *     也不让两种来源在同一格上冒充彼此。
 *
 * 【五态（界面文案的唯一出处）】
 *   drafted    —— 已经写进草稿本（**可打开看到来源与内容**）；
 *   replayed   —— 同一份选定、同一个去向已经交过（幂等键命中，**不重复插**）；
 *   pending    —— 已登记为「下一次主聊天要带的材料」（**还没发送**，要用户另行显式确认）；
 *   failed     —— 拒收或落盘失败（带归因词；**选择与内容都留着**，允许重试）；
 *   unreceived —— 没有接收者（入口不在位 / 目标 App 缺席）—— **不许报成功**。
 *
 * 【不做（计划原文三条）】
 *   · 不把返回对象、toast 或自检绿灯当交接（判据锁「真落笔 + 写后回读」）；
 *   · 不自动发布；
 *   · 取材板不自行生成或发消息（主聊天那条只到「已登记、未发送」，发送归 M5-O4/O5 与宿主操作）。
 *
 * 【本件的边界】纯函数：不碰 DOM、不碰存储、不读时钟、不联网。
 *   落笔是 owner 的事（草稿本 owner = 既有 `cwWriteDrafts`；待用键 owner = 两键读写件）。
 * ============================================================ */
'use strict';

import { numOrNull } from './num-gate.js';

/** 两个去向（**穷尽**：本项只交到这两处；不另造第三个 owner 字符串）。 */
export const MBH_TARGETS = Object.freeze({
    DRAFT: 'draft',
    CHAT: 'chat'
});
export const MBH_TARGET_LABEL = Object.freeze({
    draft: '加入创作草稿',
    chat: '用于下一次主聊天'
});
/** 草稿行的来源标识（**与 App 内容来源分开**：记忆事实不是 App 内容）。 */
export const MBH_DRAFT_SOURCE = 'material-board';

/** 交接到了哪一步（五态；界面文案的唯一出处）。 */
export const MBH_STATES = Object.freeze({
    DRAFTED: 'drafted',
    REPLAYED: 'replayed',
    PENDING: 'pending',
    FAILED: 'failed',
    UNRECEIVED: 'unreceived'
});

/** 拒收的归因词（判据按此表逐词核，防随口新词）。 */
export const MBH_REASONS = Object.freeze({
    OK: '',
    NOT_OBJECT: 'handoff-not-object',
    NO_TARGET: 'handoff-no-target',
    BAD_TARGET: 'handoff-bad-target',
    NO_PICK: 'handoff-no-pick',
    NO_REF: 'handoff-no-ref'
});
export const MBH_REASON_TEXT = Object.freeze({
    'handoff-not-object': '交接单形态不对（不是对象）',
    'handoff-no-target': '没说交给谁（草稿 / 主聊天二选一）',
    'handoff-bad-target': '不认识这个去向（只有「创作草稿」与「下一次主聊天」两条路）',
    'handoff-no-pick': '一条材料都没选（先在上面勾几条）',
    'handoff-no-ref': '选中的材料里有没有出处的（认不出它是哪一条，不落笔）'
});

/** 上限（唯一出处；视图与宿主都不自己拟一个条数）。 */
export const MBH_LIMITS = Object.freeze({
    /** 一次交接的材料条数（沿取材板包内上限 14，不新造第二套） */
    items: 14,
    /** 单条标题 */
    title: 80,
    /** 草稿正文（沿草稿本 textMax 2000，不新造第二套） */
    note: 2000,
    /** 标签（沿草稿本 tagsMax 12） */
    tags: 12,
    /** 待用材料保留条数（超上限丢最旧） */
    pending: 60,
    /** 幂等键长度上限（草稿本 key 无上限，但键会进存储，收一个硬上限） */
    key: 160
});

/** 存储键的唯一出处（两键读写件照此落盘；本件不读存储）。 */
export const MBH_KEYS = Object.freeze({
    /** 下一次主聊天要带的材料（**已登记、未发送**） */
    pending: 'cw_board_chat_pending'
});

function str(v) { return String(v == null ? '' : v).trim(); }
/** 楼层取值：**纯转发**到全仓唯一数值门 `numOrNull`（不就地再写一份弱口径 —— 本仓
 *  `Number.isFinite(Number(v))` 那一形态会把 `''` / `[]` / `false` 读成 0，
 *  与「没给」塌成同一读数；门禁 `scripts/weak-coercion-audit.mjs` 常驻守卫）。 */
function floorOrNull(v) { const n = numOrNull(v); return n === null ? null : Math.floor(n); }
function arr(v) { return Array.isArray(v) ? v : []; }
function obj(v) { return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null; }
function clip(s, max) {
    const t = str(s);
    const m = Math.max(8, Number(max) || 200);
    return t.length <= m ? t : (t.slice(0, m - 1) + String.fromCharCode(8230));
}
/** 材料的引用（`<来源>:<条目 id>`）——**回源定位格**，不是「已验真」的印章。 */
export function mbhRefOf(item) {
    const o = obj(item) || {};
    const src = str(o.source) || 'unknown';
    const id = str(o.id);
    if (!id) return '';
    return (src + ':' + id).slice(0, 160);
}

/**
 * 把「用户选定的那几条 + 去哪儿」归一成一份可落笔的交接单（**永不抛**）。
 *   ★ 缺去向 / 去向不认识 / 一条都没选 / 选中的认不出出处 —— 一律**拒收并给归因词**：
 *     拿一份认不出的东西去落笔，会在草稿本里留一条**没有出处**的行 ——
 *     那比「没落笔」更难收拾（用户无法回溯它是哪一次取材来的）。
 *   ★ 幂等键由**实际落笔内容**派生（去向 + 任务 + 材料引用集），
 *     与「点了几次」无关：同一份选定重复交 ⇒ 恒同键 ⇒ 第二次报 `replayed`。
 * @returns {{ok,why,target,targetLabel,task,taskLabel,asOf,items[],refs[],key,note,tags[]}}
 */
export function normalizeHandoff(input) {
    const empty = {
        ok: false, why: MBH_REASONS.NOT_OBJECT, target: '', targetLabel: '',
        task: '', taskLabel: '', asOf: null, items: [], refs: [], key: '', note: '', tags: []
    };
    const o = obj(input);
    if (!o) return empty;
    const target = str(o.target);
    if (!target) return Object.assign({}, empty, { why: MBH_REASONS.NO_TARGET });
    if (target !== MBH_TARGETS.DRAFT && target !== MBH_TARGETS.CHAT) {
        return Object.assign({}, empty, { why: MBH_REASONS.BAD_TARGET, target: target });
    }
    const raw = arr(o.items);
    if (!raw.length) {
        return Object.assign({}, empty, { why: MBH_REASONS.NO_PICK, target: target, targetLabel: MBH_TARGET_LABEL[target] });
    }
    /* ★ 逐条认出处：**认不出的如实拒收整单**（不静默丢那一条 —— 丢了它，
     *   用户看到的是「交过去了」，而草稿里少了一条，且没有任何地方说少的是谁）。 */
    const items = [];
    const refs = [];
    const bad = [];
    for (const it of raw) {
        const m = obj(it);
        if (!m) { bad.push('(非对象)'); continue; }
        const ref = mbhRefOf(m);
        if (!ref || ref.indexOf(':') <= 0 || ref.slice(ref.indexOf(':') + 1) === '') {
            bad.push(clip(m.id || m.title || '(无 id)', 40));
            continue;
        }
        if (items.length >= MBH_LIMITS.items) break;
        if (refs.indexOf(ref) >= 0) continue;
        refs.push(ref);
        items.push({
            ref: ref,
            id: str(m.id).slice(0, 120),
            source: str(m.source) || 'unknown',
            facet: str(m.facet),
            facetLabel: str(m.facetLabel) || '未归面',
            title: clip(m.title, MBH_LIMITS.title),
            floor: floorOrNull(m.floor)
        });
    }
    if (bad.length) {
        return Object.assign({}, empty, {
            why: MBH_REASONS.NO_REF, target: target, targetLabel: MBH_TARGET_LABEL[target],
            items: items, refs: refs, unrefused: bad
        });
    }
    if (!items.length) {
        return Object.assign({}, empty, { why: MBH_REASONS.NO_PICK, target: target, targetLabel: MBH_TARGET_LABEL[target] });
    }
    const task = str(o.task);
    const asOf = floorOrNull(o.asOf);
    /* 幂等键：去向 + 任务 + 引用集（**按集合，不按点了几次、也不按勾选顺序**）。
     *   ★ 排序后再拼键：同一份选定（勾选顺序不同）必须恒同键 ——
     *     否则用户换个顺序再交一次就会重复落一份（「连点不重复插入」当场失效）。
     *     正文（note）仍按**用户勾选的顺序**排，顺序对正文有意义，对幂等键没有。 */
    const keyRefs = refs.slice().sort();
    const key = ('mbh:' + target + ':' + (task || '-') + ':' + keyRefs.join(',')).slice(0, MBH_LIMITS.key);
    /* 正文：逐条「标题（出处 · 面 · 楼层）」——**可回源**，不是一句「已取材」。 */
    const lines = [];
    for (const m of items) {
        lines.push('- ' + (m.title || m.id) + '（' + m.source + (m.facetLabel ? ' · ' + m.facetLabel : '')
            + (m.floor === null ? '' : ' · 楼层 ' + String(m.floor)) + '）');
    }
    const note = clip(lines.join('\n'), MBH_LIMITS.note);
    const tags = [];
    if (task) tags.push(task);
    for (const m of items) if (m.facet && tags.indexOf(m.facet) < 0 && tags.length < MBH_LIMITS.tags) tags.push(m.facet);
    return {
        ok: true,
        why: MBH_REASONS.OK,
        target: target,
        targetLabel: MBH_TARGET_LABEL[target],
        task: task,
        taskLabel: str(o.taskLabel),
        asOf: asOf,
        items: items,
        refs: refs,
        key: key,
        note: note,
        tags: tags.slice(0, MBH_LIMITS.tags),
        /** ★ 如实标注：这是**记忆事实**，不是 App 内容（两边词表不同，不冒充）。 */
        sourceKind: 'memory-fact',
        /** ★ 零生成：本件只算凭据，正文由用户与既有 owner 决定。 */
        generatedNothing: true
    };
}

/**
 * 一句读数（'' = 没有要说的）。**唯一实现**：界面与宿主都念这一句。
 *   ★ `drafted` 与 `pending` 必须分开：前者已经落进草稿本（可打开看到），
 *     后者只是**登记了下一次要带**，一个字节都还没进任何一次请求。
 *   ★ `failed` 必须点明「选择与内容都留着」（用户要能重试）。
 *   ★ `unreceived` 明说没有接收者（**不许**读成「交过去了」）。
 */
export function handoffLine(read) {
    const r = obj(read) || {};
    const state = str(r.state);
    const n = Number(r.count) || 0;
    switch (state) {
        case MBH_STATES.DRAFTED:
            return '已加入创作草稿：' + String(n) + ' 条材料（可在创作台打开这一份，来源与内容都带着）';
        case MBH_STATES.REPLAYED:
            return '这份取材**已经交过**了（同一份选定 + 同一个去向只落一次，不重复插）';
        case MBH_STATES.PENDING:
            return '已登记为**下一次主聊天**要带的材料：' + String(n) + ' 条（**还没发送** —— 发送要你在主聊天里另行确认）';
        case MBH_STATES.UNRECEIVED:
            return '**没有接收者**：这一处入口不在位（本板零写盘，不代写）';
        case MBH_STATES.FAILED:
        default: {
            const why = str(r.why);
            const text = MBH_REASON_TEXT[why] || '交不过去（认不出这一单）';
            const extra = (r.writeWhy === 'readback-mismatch')
                ? '（写后回读对不上，**不得当作已保留**）'
                : (r.writeWhy ? '（' + str(r.writeWhy) + '）' : '');
            return '交不过去：' + text + extra + ' —— 你选的与填的都还留着，可以重试';
        }
    }
}

/** 状态 id 列表（界面不写第二份状态表）。 */
export function handoffStateIds() { return Object.values(MBH_STATES).slice(); }
/** 去向 id 列表与标签（界面不写第二份去向表）。 */
export function handoffTargetIds() { return Object.values(MBH_TARGETS).slice(); }
export function handoffTargetLabel(t) { return MBH_TARGET_LABEL[str(t)] || ''; }

/**
 * 自检（判据与体检共用；真跑一遍，不写「已检查」）。
 *   覆盖：合法归一 / 五态互不同形 / 三态拒收（缺去向 / 去向不认识 / 一条没选）/
 *   认不出出处**整单拒收**（不静默丢那一条）/ 引用集幂等键 / 去重限量 /
 *   纯函数不改入参 / 两套词表**不冒充**（草稿来源与 App 内容来源不同字）。
 */
export function mbhSelfCheck() {
    const problems = [];
    const good = {
        target: 'draft', task: 'reunion', asOf: 120, taskLabel: '重逢',
        items: [
            { id: 'f1', source: 'continuity', facet: 'sharedPast', facetLabel: '共同往事', title: '雨夜那次', floor: 88 },
            { id: 'f2', source: 'promise', facet: 'promise', facetLabel: '未闭承诺', title: '答应过的那件事', floor: 91 },
            { id: 'f2', source: 'promise', facet: 'promise', facetLabel: '未闭承诺', title: '答应过的那件事', floor: 91 }
        ]
    };
    const n = normalizeHandoff(good);
    if (!n.ok) problems.push('合法交接单被拒收：' + n.why);
    if (n.refs.length !== 2) problems.push('引用必须去重（实得 ' + n.refs.length + '）');
    if (n.refs[0] !== 'continuity:f1') problems.push('引用必须形如 <来源>:<id>');
    if (n.items[0].floor !== 88) problems.push('楼层没搬对');
    if (!n.key || n.key.indexOf('mbh:draft:') !== 0) problems.push('幂等键必须由去向 + 任务 + 引用集派生');
    /* ★ 同一份选定（**勾选顺序不同**）必须恒同键 —— 否则换个顺序再交一次就重复落一份。 */
    const swapped = normalizeHandoff({
        target: 'draft', task: 'reunion',
        items: [
            { id: 'f2', source: 'promise', facet: 'promise', title: '答应过的那件事' },
            { id: 'f1', source: 'continuity', facet: 'sharedPast', title: '雨夜那次' }
        ]
    });
    if (swapped.key !== n.key) problems.push('同一份选定（顺序不同）必须恒同键（否则重复插入）');
    if (n.note.indexOf('continuity') < 0) problems.push('正文必须可回源（带出处）');
    if (good.items.length !== 3) problems.push('归一改了入参（纯函数被破坏）');
    /* ★ 两套词表不冒充：草稿来源标识必须与「App 内容来源」那一族不同字。 */
    const appSources = ['musicdesk', 'stickerdesk', 'soundkit', 'pixiv', 'lofter', 'magazine', 'pvdesk', 'doujin'];
    if (appSources.indexOf(MBH_DRAFT_SOURCE) >= 0) problems.push('草稿来源标识不得冒用 App 内容来源（两套词表不同）');

    /* 三态拒收各带归因词（互不同形） */
    if (normalizeHandoff(null).why !== MBH_REASONS.NOT_OBJECT) problems.push('非对象未按 NOT_OBJECT 拒收');
    if (normalizeHandoff({ target: '', items: good.items }).why !== MBH_REASONS.NO_TARGET) problems.push('缺去向未拒收');
    if (normalizeHandoff({ target: 'publish', items: good.items }).why !== MBH_REASONS.BAD_TARGET) problems.push('去向不认识未拒收');
    if (normalizeHandoff({ target: 'draft', items: [] }).why !== MBH_REASONS.NO_PICK) problems.push('一条没选未拒收');
    const reasons = [MBH_REASONS.NOT_OBJECT, MBH_REASONS.NO_TARGET, MBH_REASONS.BAD_TARGET, MBH_REASONS.NO_PICK, MBH_REASONS.NO_REF];
    if (new Set(reasons).size !== reasons.length) problems.push('归因词必须互不同形');
    /* ★ 认不出出处的**整单拒收**（不许静默丢那一条，也不许只交剩下的）。 */
    const mixed = normalizeHandoff({
        target: 'draft',
        items: [{ id: 'ok1', source: 'lore', title: '好的那条' }, { id: '', source: 'lore', title: '没有 id 的那条' }]
    });
    if (mixed.ok) problems.push('选中里有没有出处的必须**整单拒收**（不许静默丢那一条）');
    if (mixed.why !== MBH_REASONS.NO_REF) problems.push('认不出出处必须给 NO_REF');
    if (!mixed.unrefused || !mixed.unrefused.length) problems.push('被拒的那一条要**具名**（不许只报「有坏的」）');

    /* 五态读数互不同形 */
    const lines = [
        handoffLine({ state: MBH_STATES.DRAFTED, count: 2 }),
        handoffLine({ state: MBH_STATES.REPLAYED }),
        handoffLine({ state: MBH_STATES.PENDING, count: 2 }),
        handoffLine({ state: MBH_STATES.FAILED, why: MBH_REASONS.NO_PICK }),
        handoffLine({ state: MBH_STATES.UNRECEIVED })
    ];
    if (lines.some((s) => !String(s || '').length)) problems.push('五态里有一态没有读数');
    if (new Set(lines).size !== lines.length) problems.push('五态读数有同形的（读数分不出状态）');
    if (lines[0].indexOf('已加入创作草稿') < 0) problems.push('drafted 必须明说已加入草稿');
    if (lines[2].indexOf('还没发送') < 0) problems.push('pending 必须明说**还没发送**（登记 ≠ 已发）');
    if (lines[4].indexOf('没有接收者') < 0) problems.push('unreceived 必须明说没有接收者');
    if (lines[3].indexOf('留着') < 0) problems.push('failed 必须点明选择与内容都留着（可重试）');
    if (handoffStateIds().length !== 5) problems.push('五态必须在场');
    if (handoffTargetIds().length !== 2) problems.push('两个去向必须在场');
    return {
        problems: problems,
        states: handoffStateIds().length,
        targets: handoffTargetIds().length,
        reasons: Object.keys(MBH_REASONS).length,
        limits: Object.keys(MBH_LIMITS).length
    };
}

export default {
    MBH_TARGETS,
    MBH_TARGET_LABEL,
    MBH_DRAFT_SOURCE,
    MBH_STATES,
    MBH_REASONS,
    MBH_REASON_TEXT,
    MBH_LIMITS,
    MBH_KEYS,
    mbhRefOf,
    normalizeHandoff,
    handoffLine,
    handoffStateIds,
    handoffTargetIds,
    handoffTargetLabel,
    mbhSelfCheck
};