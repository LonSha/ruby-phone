/* ========================================================
 * bodycord-bridge.js — [v4.153.0 · R21-X10] Bodycord 档案桥（严格纯读）
 * --------------------------------------------------------
 * 缝的是什么：SillyTavern 扩展 soduiz/SillyTavern-Bodycord（生理 / 孕育状态
 * 面板）落在**聊天 metadata 的 `bodycord_state` 键**里的状态数据。本件把
 * 它读出来，投影给仓内 App（uterus 承载）当「外部档案」看。
 *
 * ── 许可与数据面（本件成立的两个前提）──────────────────
 *   ① 对方是 PolyForm Strict 1.0.0：禁止把它的代码「做进自己的东西里发布」。
 *     故本件**一行对方的代码都不搬**——只读它公开落在聊天文件里的数据键
 *     （键名与字段名是接口事实，不是受版权保护的表达）；要看它怎么写，
 *     现场读它的仓库即可，本件不携带它的任何片段。
 *   ② 数据住 `chat_metadata.bodycord_state`：`targets`（按对象分账，每人
 *     一份档案）＋ `snapshots`（时光机）＋ `ovuJudgments` / `insems`（判定
 *     与流水）。本件只投影**在场事实**（有谁、轻档还是正式档、账面大小、
 *     剧情历名），**不重算**任何生理数值——那是对方插件的事，重算必然算出
 *     第二套互相打架的口径。
 *
 * ── 五态面（读得出与读不出分句，绝不压平）────────────
 *   no-context   宿主链上没有 SillyTavern context（不在酒馆里跑）
 *   no-metadata  context 在场但没有 chat_metadata（没进任何聊天）
 *   absent       metadata 在场但没装 Bodycord（键不存在——这不是缺陷）
 *   malformed    键在但形状不对（targets 不是对象 / order 不是数组）
 *   present      正常读出（哪怕一个对象都没有——空档案也是档案）
 *   后三态的处置完全不同：absent 该静默隐藏入口，malformed 该报「形状不对」，
 *   present 空 targets 该报「零档案」。压成一句「没数据」就把原因丢了。
 *
 * ── 纯读纪律（与 conversation-thread-binder 同规）────
 *   · 零写路径：不调 saveMetadata、不碰任何键、不 prune（对方有自己的
 *     两道保险丝，外件越俎代庖只会帮倒忙）；
 *   · 不持有跨轮副本：每次调用现取（metadata 是会话级活数据）；
 *   · 冻结入参不改写：探针只读，宿主对象序列化前后逐字不变。
 * ======================================================== */
'use strict';

export const BODYCORD_STATE_KEY = 'bodycord_state';
export const BODYCORD_FACES = Object.freeze({
    NO_CONTEXT: 'no-context',
    NO_METADATA: 'no-metadata',
    ABSENT: 'absent',
    MALFORMED: 'malformed',
    PRESENT: 'present'
});

/** ST context 解析链（与 floor-store 同链路：本窗口优先、父窗口兜底）。 */
function contextOf(win) {
    const w = win || (typeof window !== 'undefined' ? window : null);
    if (!w) return null;
    try {
        return w.SillyTavern?.getContext?.()
            || w.parent?.SillyTavern?.getContext?.()
            || null;
    } catch (_e) {
        return null;
    }
}

function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** 单个对象档案的投影：只报在场事实，不解读 profile 内部。 */
function projectTarget(t) {
    const vars = isPlainObject(t.vars) ? t.vars : null;
    return {
        key: String(t.key || ''),
        name: String(t.name || ''),
        isUser: t.isUser === true,
        light: t.light === true,
        present: t.present !== false,
        updatedAt: Number(t.updatedAt) || 0,
        hasProfile: t.profile != null,
        hasPeriod: t.period != null,
        varsCount: vars ? Object.keys(vars).length : null,
        noteLen: String(t.note || '').length,
        rawLen: String(t.raw || '').length
    };
}

/**
 * 读 Bodycord 档案面。严格纯读：零写、零持有、不改写宿主。
 * @param {object} [win] 宿主窗口（测试注入用；缺省走 window）
 * @returns {{ state:string, why:string,
 *             targets:Array, active:string|null, lightCount:number,
 *             dateMode:string, fictionDate:string,
 *             counts:{snapshots:number,insems:number,judgments:number} }}
 */
export function readBodycordFace(win) {
    const noTargets = { targets: [], active: null, lightCount: 0, dateMode: '', fictionDate: '',
        counts: { snapshots: 0, insems: 0, judgments: 0 } };
    const ctx = contextOf(win);
    if (!ctx) return Object.assign({ state: BODYCORD_FACES.NO_CONTEXT, why: 'no-st-context' }, noTargets);
    /* chat_metadata 可能是会抛的 getter（对方插件环境千奇百怪）——
     *   读不到就如实归 no-metadata，绝不外抛（与 v297 B4 的降级纪律同款）。 */
    let meta = null;
    try { meta = ctx.chat_metadata; } catch (_e) { meta = null; }
    if (!isPlainObject(meta)) {
        return Object.assign({ state: BODYCORD_FACES.NO_METADATA, why: 'no-chat-metadata' }, noTargets);
    }
    let present = false;
    try { present = BODYCORD_STATE_KEY in meta; } catch (_e) { present = false; }
    if (!present) {
        return Object.assign({ state: BODYCORD_FACES.ABSENT, why: 'bodycord-not-installed' }, noTargets);
    }
    let st = null;
    try { st = meta[BODYCORD_STATE_KEY]; } catch (_e) { st = null; }
    if (!isPlainObject(st) || !isPlainObject(st.targets) || !Array.isArray(st.order)) {
        return Object.assign({ state: BODYCORD_FACES.MALFORMED, why: 'state-shape' }, noTargets);
    }
    const targets = [];
    let lightCount = 0;
    for (const k of st.order) {
        const t = st.targets[k];
        if (!isPlainObject(t)) continue;
        const p = projectTarget(t);
        if (p.light) lightCount += 1;
        targets.push(p);
    }
    const num = (v) => (Array.isArray(v) ? v.length : 0);
    return {
        state: BODYCORD_FACES.PRESENT,
        why: 'ok',
        targets: targets,
        active: typeof st.active === 'string' ? st.active : null,
        lightCount: lightCount,
        dateMode: String(st.dateMode || ''),
        fictionDate: String(st.fictionDate || ''),
        counts: {
            snapshots: num(st.snapshots),
            insems: num(st.insems),
            judgments: num(st.ovuJudgments)
        }
    };
}

/**
 * 内核自检（纯函数面，零宿主依赖；判据与产品侧共用一份）。
 * 正控：合成五态各一，断言分形与投影口径。
 */
export function bodycordBridgeSelfCheck() {
    const problems = [];
    const mk = (ctx) => ({ SillyTavern: { getContext: () => ctx } });
    const a = readBodycordFace(mk(null));
    if (a.state !== BODYCORD_FACES.NO_CONTEXT) problems.push('无宿主应归 no-context');
    const b = readBodycordFace(mk({}));
    if (b.state !== BODYCORD_FACES.NO_METADATA) problems.push('无 metadata 应归 no-metadata');
    const c = readBodycordFace(mk({ chat_metadata: {} }));
    if (c.state !== BODYCORD_FACES.ABSENT) problems.push('未安装应归 absent');
    const d = readBodycordFace(mk({ chat_metadata: { bodycord_state: 'oops' } }));
    if (d.state !== BODYCORD_FACES.MALFORMED) problems.push('形状不对应归 malformed');
    const st = {
        schema: 1, order: ['user', '甲'], active: '甲',
        dateMode: 'fiction', fictionDate: '1年01月01日',
        targets: {
            user: { key: 'user', name: '{{user}}', isUser: true, light: false, profile: null, period: null, vars: {}, note: '', raw: '' },
            '甲': { key: '甲', name: '甲', isUser: false, light: true, profile: { x: 1 }, period: {}, vars: { a: 1 }, note: 'n', raw: 'r' }
        },
        snapshots: [1, 2], insems: [], ovuJudgments: [{ roll: 1 }]
    };
    const before = JSON.stringify(st);
    const e = readBodycordFace(mk({ chat_metadata: { bodycord_state: st } }));
    if (e.state !== BODYCORD_FACES.PRESENT) problems.push('正常态应归 present');
    if (e.targets.length !== 2) problems.push('对象应全列不丢');
    if (e.lightCount !== 1) problems.push('轻档应如实计数');
    if (e.active !== '甲' || e.fictionDate !== '1年01月01日') problems.push('活跃对象与剧情历应原样带出');
    if (e.counts.snapshots !== 2 || e.counts.judgments !== 1) problems.push('三本账计数应如实');
    if (JSON.stringify(st) !== before) problems.push('宿主对象被改写（纯读违约）');
    return { ok: problems.length === 0, problems: problems };
}
