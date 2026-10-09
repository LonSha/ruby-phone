/* ========================================================
 *  RubyPhone · 诊断处置面（R-O7）
 * ========================================================
 *
 * 【为什么有这个模块】
 *   诊断页的读数已经很多，但**读数不等于处置**。实测的处境是三种处境同形：
 *     · 「空」（这一项真没有内容）；· 「未知」（读到了，但不足以判断）；
 *     · 「缺席」（这一项根本不在，比如旧版上游没这个字段）。
 *   三者在页面上都是一片灰，用户看到红格后不知道下一步做什么；而真正需要动的
 *   那一类 —— **失败** —— 又只给了一句「读取失败」，不说**哪一段失败、影响什么、
 *   能不能重试、要不要换宿主、要不要用户拍板**。
 *
 *   本模块把「处置」写成数据：
 *     ① 五态互不同形（`empty` / `unknown` / `absent` / `failed` / `partial`）；
 *     ② 每个失败必带五项（阶段 / 影响范围 / 可否重试 / 是否需切宿主 / 是否需确认）；
 *     ③ 统一错误码（按域登记，不许各处自造字符串）；
 *     ④ 一步到处置入口（跳到对应 App 或恢复操作，复用既有 `open-ref` 口径）。
 *
 * 【它**不**做的那件事】
 *   它不猜。读数必须来自**生产 trace 或真实回执**；本模块只做「把已发生的读数
 *   翻译成处置」这一件事 —— 视图不许自行推测（那是本仓点过名的形态）。
 *
 * 【三态互不同形的具体口径】
 *   五态里最容易塌成两格的是 `empty` 与 `absent`：
 *   前者是「上游给了这一面、值是空」（是好读数，处置是「不用动」），
 *   后者是「上游根本没有这一面」（处置是「等升级 / 装齐」）。压成一格，
 *   用户会在「本来就没有」的项上反复排查一个不存在的问题。
 * ============================================================ */

import { numOrNull } from './num-gate.js';

/** 五态。`failed` 与 `partial` 刻意分开：部分成功**不等于**失败 ——
 *  它的处置是「看哪一半成了」，而失败的处置是「重试 / 换路」。 */
export const DIAG_STATES = Object.freeze({
    EMPTY: 'empty',       // 面在、值为空（好读数：本来就没有）
    UNKNOWN: 'unknown',   // 读到了，但不足以判断（缺键 / 旧版无字段）
    ABSENT: 'absent',     // 面根本不在（等升级 / 装齐）
    FAILED: 'failed',     // 明确失败（有回执）
    PARTIAL: 'partial'    // 部分成功（有成功的部分，也有没成的部分）
});

/** 失败的五个必答项。**缺一项即拒判** —— 缺项等于让用户自己去猜。 */
export const FAIL_FIELDS = Object.freeze([
    { id: 'stage', label: '失败阶段', note: '在哪一步断的（取数 / 解析 / 合并 / 写回 / 渲染）' },
    { id: 'scope', label: '影响范围', note: '影响哪些功能或哪几项读数' },
    { id: 'retry', label: '可否重试', note: '能不能原样再来一次' },
    { id: 'hostSwitch', label: '是否需要切宿主', note: '换会话 / 换前端 / 换上游版本' },
    { id: 'needConfirm', label: '是否需要用户确认', note: '这一步会不会动数据' }
]);

/** 域（销号口径）。错误码按域登记，**不许各处自造字符串** ——
 *  自造的后果是同一件事故在不同页面上报成两串不同的码，检索不到一起。 */
export const DIAG_DOMAINS = Object.freeze([
    'resume-handoff', 'finance', 'search', 'storage', 'lifecycle', 'worldbook', 'injection'
]);

const DOMAIN_SET = new Set(DIAG_DOMAINS);

function text(v) {
    return String(v ?? '').trim();
}

/** 错误码：`域.现象` 两段式，现象用稳定小写串。
 *  写成导出的，是为了让套件与负控制对**同一份码面**做断言。 */
export function codeOf(domain, symptom) {
    const d = text(domain);
    const s = text(symptom);
    if (!DOMAIN_SET.has(d)) return '';
    if (!/^[a-z][a-z0-9-]*$/.test(s)) return '';
    return d + '.' + s;
}

/** 把一份「原始处置材料」翻成五态之一。判据顺序**显式写死**（顺序本身就是口径）：
 *  失败 > 部分成功 > 缺席 > 未知 > 空。 */
export function stateOf(input = {}) {
    if (input.failed === true) return DIAG_STATES.FAILED;
    if (input.partial === true) return DIAG_STATES.PARTIAL;
    if (input.present === false) return DIAG_STATES.ABSENT;
    if (input.unknown === true) return DIAG_STATES.UNKNOWN;
    return DIAG_STATES.EMPTY;
}

/**
 * 造一条处置读数。
 *
 * @param {{domain?:string, symptom?:string, stage?:string, scope?:string,
 *          retry?:boolean, hostSwitch?:boolean, needConfirm?:boolean,
 *          failed?:boolean, partial?:boolean, present?:boolean, unknown?:boolean,
 *          action?:{appId?:string, kind?:string, id?:string}, reason?:string}} input
 * @returns {{state:string, code:string, fields:object, action:object, ok:boolean, why:string, line:string}}
 *   失败时 `ok=false` 且 `why` 逐条点名缺项（不静默降级成一条普通读数）。
 */
export function buildDisposal(input = {}) {
    const state = stateOf(input);
    const domain = text(input.domain);
    const code = codeOf(domain, input.symptom);
    const fields = {
        stage: text(input.stage), scope: text(input.scope),
        retry: typeof input.retry === 'boolean' ? input.retry : null,
        hostSwitch: typeof input.hostSwitch === 'boolean' ? input.hostSwitch : null,
        needConfirm: typeof input.needConfirm === 'boolean' ? input.needConfirm : null
    };
    const action = input.action && typeof input.action === 'object'
        ? { appId: text(input.action.appId), kind: text(input.action.kind), id: text(input.action.id) }
        : { appId: '', kind: '', id: '' };
    const problems = [];
    if (!DOMAIN_SET.has(domain)) problems.push('域不在登记表内：' + (domain || '（空）'));
    if (state === DIAG_STATES.FAILED) {
        const missing = [];
        for (const f of FAIL_FIELDS) {
            if (f.id === 'stage' || f.id === 'scope') {
                if (!fields[f.id]) missing.push(f.label);
            } else if (fields[f.id] === null) missing.push(f.label);
        }
        if (missing.length) problems.push('失败读数的五项必答缺：' + missing.join('、'));
    }
    return {
        state: state, code: code, fields: fields, action: action,
        ok: problems.length === 0, why: problems.join(' · '),
        reason: text(input.reason)
    };
}

/** 一行读数。五态**各占一格**（这正是本模块存在的理由：不许塌成灰与红两色）。 */
export function disposalLine(d) {
    if (!d || typeof d !== 'object') return '处置：无读数';
    switch (d.state) {
        case DIAG_STATES.EMPTY: return '处置：面在、值为空（不用动）';
        case DIAG_STATES.UNKNOWN: return '处置：读到但不足以判断' + (d.reason ? '（' + d.reason + '）' : '');
        case DIAG_STATES.ABSENT: return '处置：这一面不在（等升级或装齐）';
        case DIAG_STATES.PARTIAL: return '处置：部分成功 —— 看已成的那一半' + (d.code ? ' · ' + d.code : '');
        default: {
            if (!d.ok) return '处置：失败读数不完整 —— ' + d.why;
            return '处置：失败（' + d.code + ' · ' + d.fields.stage + '）影响 ' + d.fields.scope
                + ' · ' + (d.fields.retry ? '可重试' : '不可重试')
                + (d.fields.hostSwitch ? ' · 需切宿主' : '')
                + (d.fields.needConfirm ? ' · 需确认' : '');
        }
    }
}

/** 可否一步到处置入口：有 action 且（kind 在登记面内 或 appId 非空）。
 *  跳不过去时必须**说清原因**（这是 R-X1 的验收之一，在这里先把判据立起来）。 */
export function canJump(d) {
    if (!d || typeof d !== 'object') return { ok: false, why: '无读数' };
    const a = d.action || {};
    if (a.kind || a.appId) return { ok: true, why: '' };
    return { ok: false, why: '这一项没有可跳的处置入口（无 appId 与 kind）' };
}

/** 域内的错误码面自证：每个域至少有一条稳定码，且码面不重复。
 *  它是「码表不是装饰」的判据 —— 空表必须**说出来**，不许静默当全合规。 */
export function codeTableSelfCheck(table) {
    const src = table && typeof table === 'object' ? table : {};
    const problems = [];
    let count = 0;
    const seen = new Set();
    for (const domain of DIAG_DOMAINS) {
        const list = Array.isArray(src[domain]) ? src[domain] : [];
        if (!list.length) problems.push('域 ' + domain + ' 没有登记任何码面');
        for (const symptom of list) {
            const code = codeOf(domain, symptom);
            if (!code) problems.push('域 ' + domain + ' 的码面不合法：' + String(symptom));
            if (seen.has(code)) problems.push('码面重复：' + code);
            seen.add(code);
            count += 1;
        }
    }
    return { ok: problems.length === 0, count: count, problems: problems };
}

/** 码表（**唯一真源**：域 → 现象串）。各域调用方从这里取，不许就地写字面量。 */
export const CODE_TABLE = Object.freeze({
    'resume-handoff': ['precheck-blocked', 'readback-mismatch', 'epoch-stale'],
    finance: ['source-not-opened', 'ledger-full', 'commit-rejected'],
    search: ['index-aborted', 'source-threw', 'empty-query'],
    storage: ['quota-exceeded', 'key-unregistered', 'write-failed'],
    lifecycle: ['no-exit-wired', 'rebind-stale', 'slot-overlap'],
    worldbook: ['write-failed', 'duplicate-content', 'no-name'],
    injection: ['all-dropped', 'candidates-empty', 'stray-origin']
});

/** 数值化的安全取数（本模块只用它做「这一格有没有数」的判断，不做业务运算）。 */
export function hasNumber(v) {
    return numOrNull(v) !== null;
}

export default {
    DIAG_STATES, FAIL_FIELDS, DIAG_DOMAINS, CODE_TABLE,
    codeOf, stateOf, buildDisposal, disposalLine, canJump, codeTableSelfCheck, hasNumber
};