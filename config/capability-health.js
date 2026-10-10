/* ============================================================
 * config/capability-health.js — 宿主与能力健康中心（判定内核）[v3.92.0 · 拓展计划 R-X8]
 * ------------------------------------------------------------
 * 【治的欠债（修前实测处境，不是推演）】
 *   本仓有六类能力依赖外部条件：搜索、记忆、图片、语音、通知、恢复交接。
 *   它们的「能不能用」此前散在各自的调用点里，且**三件事共用同一句人话**：
 *     · 「接口在场」（宿主装了对应扩展 / 浏览器有那个 API）
 *     · 「服务可用」（真能跑通一次）
 *     · 「本版根本没这一面」（要升级）
 *   三者处置**相反**（等一轮 / 去开开关 / 去升级 / 换个做法），显示成同一句话时
 *   用户只能靠猜。计划 R-X8 的四态（可用 / 部分可用 / 不可用 / **未验证**）
 *   正是来分开它们的 —— 尤其最后一态：**没测过不等于坏**。
 *
 * 【本模块只做判定，不做检测】
 *   一切观测（宿主版本、桥在场与否、通道自述、浏览器能力探针结果）由调用方注入。
 *   两个理由，与本仓 `config/crossrepo-registry.js` / `config/rollback-preview.js` 同族：
 *     ① 判定内核**零 import、零 IO** ⇒ 结构上不可能自己去 fetch / 调模型 / 写存储；
 *        计划验收「能力检测本身不得触发真实写入或模型调用」在这里是**结构成立**的，
 *        不靠人记得（仍另有判据面剥注释后核对）。
 *     ② 同一件事不会出现第二个观测点（本仓「同一读数的两个来源必然漂移」的根因形态）。
 *
 * 【四态为什么必须不同形（逐条给出处置）】
 *   ok         —— 有观测、且自述为可用：直接用。
 *   partial    —— 有观测、自述为部分可用：能用但要走替代路径（替代操作由本模块给）。
 *   unavailable—— 有观测、明确报不可用：别重试，直接给替代操作。
 *   unverified —— **没有观测**（没测过 / 旧宿主不报 / 面缺席）：说清「没测过」，
 *                 既不报成可用，也不报成坏。
 *   压平任何两态都会造出本仓最贵的那类读数：两种处置相反的处境长得一模一样。
 *
 * 【替代操作（计划验收②：缺能力时给替代操作）】
 *   「不可用」只说结论没用 —— 用户要知道现在能做什么。故每个能力都带 fallback
 *   列表（**顺序即优先级**，本模块不做推荐排序，只如实转述声明的次序）。
 *
 * 【「接口存在」不得报成「服务可用」】
 *   调用方若只拿到「接口在不在」（如 `typeof fetch === 'function'`），
 *   必须走 `probeOf.api` 而不是 `probeOf.service` —— 前者最高只能到 partial。
 *   这条不是约定，是判据（本模块的 `apiOnlyDegrade` 实现 + 自检断言）。
 * ============================================================ */
'use strict';
import { numOrNull } from './num-gate.js';

/* ───────── ① 四态 ───────── */

export const CAP_STATES = Object.freeze({
    OK: 'ok',
    PARTIAL: 'partial',
    UNAVAILABLE: 'unavailable',
    UNVERIFIED: 'unverified',
});

export const CAP_STATE_KEYS = Object.freeze(['ok', 'partial', 'unavailable', 'unverified']);

/* 状态 → 文案（唯一实现；每句都要说清「现在该做什么」） */
export const CAP_STATE_TEXT = Object.freeze({
    ok: '可用',
    partial: '部分可用：能用，但要走替代路径（见替代操作）',
    unavailable: '不可用：别再重试，直接按替代操作来',
    unverified: '未验证：**没测过**，不等于坏 —— 跑一次才知道',
});

/* 观测来源（三事分开：接口 / 服务 / 版本） */
export const CAP_PROBES = Object.freeze({
    SERVICE: 'service',   // 真跑通过（或上游明确自述服务态）
    API: 'api',           // 只知道接口在场
    VERSION: 'version',   // 只知道版本号
    NONE: 'none',         // 什么都没观测到
});

export const CAP_PROBE_KEYS = Object.freeze(['service', 'api', 'version', 'none']);

/* ───────── ② 六个能力面 ───────── */

export const CAPABILITY_IDS = Object.freeze(['search', 'memory', 'image', 'voice', 'notify', 'handoff']);

export const CAPABILITY_LABELS = Object.freeze({
    search: '搜索',
    memory: '记忆',
    image: '图片',
    voice: '语音',
    notify: '通知',
    handoff: '恢复交接',
});

/**
 * 替代操作表（每个能力一组，**顺序即优先级**）。
 * 只陈述「还能怎么做」，不替用户排序、不写鼓励语。
 */
export const CAP_FALLBACKS = Object.freeze({
    search: Object.freeze(['用关键词逐个 App 内查找', '缩小到具体 App 再搜', '直接翻该 App 的列表页']),
    memory: Object.freeze(['手动把要点写进备注', '用当轮对话上下文代替长期记忆', '改用结构化记忆案头手工维护']),
    image: Object.freeze(['用文字描述代替图片', '贴上外部图片链接', '用相册里已有图片']),
    voice: Object.freeze(['改用文字输入', '用系统输入法的语音转文字', '把内容贴进输入框']),
    notify: Object.freeze(['在 App 内看通知中心的历史记录', '重要消息留在聊天里回看', '锁屏速览里查看累计未读']),
    handoff: Object.freeze(['手工抄写关键字段到新会话', '先导出备份再在新会话导入', '放弃交接、从当前轮继续']),
});

/* ───────── ③ 判定 ───────── */

function strOf(v) {
    if (typeof v === 'string') return v.trim();
    if (v === null || v === undefined) return '';
    return String(v).trim();
}

/**
 * 归一一条观测。**绝不抛**：观测面永远可能给脏东西，判定面必须照常出读数。
 * @param {object|null} obs 调用方注入的观测
 * @returns {{present:boolean, probe:string, healthy:string, note:string}}
 */
export function normalizeObservation(obs) {
    const o = (obs && typeof obs === 'object') ? obs : null;
    if (!o) return { present: false, probe: CAP_PROBES.NONE, healthy: '', note: '' };
    const probeRaw = strOf(o.probe);
    const probe = CAP_PROBE_KEYS.indexOf(probeRaw) >= 0 ? probeRaw : CAP_PROBES.NONE;
    /* 三态不同形：present=false（面缺席）/ probe=none（在场但没给观测）/ 真观测。
     * 「没给观测」与「观测说不健康」在此分开，后面各自走不同态。 */
    const present = o.present === true;
    const healthyRaw = strOf(o.healthy);
    const healthy = (healthyRaw === 'ok' || healthyRaw === 'partial' || healthyRaw === 'unavailable') ? healthyRaw : '';
    return { present: present, probe: probe, healthy: healthy, note: strOf(o.note) };
}

/**
 * 「只知道接口在场」不得报成「服务可用」：api 观测最高只能到 partial。
 * 为什么单独成函数而不是内联：这是本模块最容易被后人改坏的一条（去掉就退化），
 * 自检直接断言它（见 capHealthSelfCheck）。
 */
export function apiOnlyDegrade(state) {
    return state === CAP_STATES.OK ? CAP_STATES.PARTIAL : state;
}

/**
 * 判定一个能力的状态。纯函数：只吃观测，不读时钟、不读存储。
 * @param {string} id 能力 id
 * @param {object|null} obs 观测
 * @returns {{id:string, label:string, state:string, stateText:string, probe:string,
 *            fallbacks:string[], note:string, why:string}}
 */
export function capStateOf(id, obs) {
    const key = strOf(id);
    const label = CAPABILITY_LABELS[key] || key || '未知能力';
    const fallbacks = (CAP_FALLBACKS[key] || []).slice();
    const n = normalizeObservation(obs);

    let state;
    let why;
    if (!n.present) {
        /* 面缺席：**未验证**，不是「不可用」。面缺席可能只是宿主没装那个扩展，
         *   而我们并没有观测到「服务坏了」。把它报成坏会造成一批假故障。 */
        state = CAP_STATES.UNVERIFIED;
        why = n.note || '没有观测到这一面（宿主未提供或本版未接）—— 未验证不是坏';
    } else if (n.probe === CAP_PROBES.NONE || !n.healthy) {
        /* 面在场、有接口，但没有任何可用性自述 ⇒ 未验证。 */
        state = CAP_STATES.UNVERIFIED;
        why = n.note || '面在场但没有可用性自述 —— 未验证不是坏';
    } else if (n.healthy === 'unavailable') {
        state = CAP_STATES.UNAVAILABLE;
        why = n.note || '观测明确报不可用';
    } else if (n.healthy === 'partial') {
        state = CAP_STATES.PARTIAL;
        why = n.note || '观测报部分可用';
    } else {
        /* healthy === 'ok'：还要看观测是**服务级**还是**仅接口级**。 */
        state = CAP_STATES.OK;
        why = n.note || '观测报可用';
        if (n.probe === CAP_PROBES.API) {
            state = apiOnlyDegrade(state);
            why = '只知道接口在场（未跑通服务）—— 最高只能到部分可用';
        } else if (n.probe === CAP_PROBES.VERSION) {
            state = CAP_STATES.UNVERIFIED;
            why = '只知道版本号，没有任何可用性自述 —— 未验证不是坏';
        }
    }

    return {
        id: key, label: label, state: state,
        stateText: CAP_STATE_TEXT[state],
        probe: n.probe, fallbacks: fallbacks, note: n.note, why: why,
    };
}

/* ───────── ④ 汇总面 ───────── */

export function emptyCapCounts() {
    return { ok: 0, partial: 0, unavailable: 0, unverified: 0 };
}

/**
 * 汇总六个能力。缺失的观测（调用方没给）记 **unverified**，不是 ok。
 * @param {object|null} observations id → 观测
 */
export function capHealthSummary(observations) {
    const src = (observations && typeof observations === 'object') ? observations : {};
    const rows = CAPABILITY_IDS.map(function (id) {
        const given = Object.prototype.hasOwnProperty.call(src, id);
        return capStateOf(id, given ? src[id] : null);
    });
    const counts = emptyCapCounts();
    for (const r of rows) counts[r.state] += 1;
    const attention = rows.filter(function (r) {
        return r.state === CAP_STATES.UNAVAILABLE || r.state === CAP_STATES.PARTIAL;
    });
    return {
        rows: rows,
        counts: counts,
        total: rows.length,
        attention: attention,
        /* 「还有什么不能直接做」一行话：只列要动手的，未验证不在此列（它不需要动手）。 */
        line: capSummaryLine(counts, attention.length),
    };
}

export function capSummaryLine(counts, attentionCount) {
    const c = counts || emptyCapCounts();
    const parts = ['可用 ' + String(c.ok) + '/' + String(CAPABILITY_IDS.length)];
    if (c.partial) parts.push('部分可用 ' + String(c.partial));
    if (c.unavailable) parts.push('不可用 ' + String(c.unavailable));
    if (c.unverified) parts.push('未验证 ' + String(c.unverified) + '（没测过，不等于坏）');
    if (attentionCount) parts.push('需处置 ' + String(attentionCount) + ' 项（见替代操作）');
    return parts.join(' · ');
}

/**
 * 跨仓版本联动提示（计划 R-X8 ④：双项目版本不匹配时给出明确联动提示）。
 * 只比对**调用方给的**两个版本号 + 登记面的就绪条数，不自己读文件、不自己判上游版本。
 * @param {{phone:string, upstreams:Array<{id:string,version:string|null}>|null,
 *          readyFaces:number, totalFaces:number, minUpstream:string}} input
 */
export function crossRepoNotice(input) {
    const i = (input && typeof input === 'object') ? input : {};
    const upstreams = Array.isArray(i.upstreams) ? i.upstreams : [];
    const missing = [];
    const outdated = [];
    for (const u of upstreams) {
        const obj = (u && typeof u === 'object') ? u : {};
        const id = strOf(obj.id) || '未知上游';
        const ver = strOf(obj.version);
        if (!ver) { missing.push(id + '（版本读不到 —— 这是「读不出」，不是「没装」）'); continue; }
        /* 门限**逐上游**可给（每个上游面数不同，门限不该一刀切）；
         *   没给就用调用方的缺省门限。都拿不到 ⇒ **不判版本偏低**（不拿假门限比）。 */
        const min = strOf(obj.min) || strOf(i.minUpstream);
        if (min && semverLess(ver, min)) outdated.push(id + ' v' + ver + ' < 需 v' + min);
    }
    const total = numOrNull(i.totalFaces);
    const ready = numOrNull(i.readyFaces);
    /* 【为什么这句不能写成「登记面可能未加载」】本轮未取数（咽喉不取面级判定）与
     *   「登记面加载了但零面就绪」是两件事 —— 后者是好读数、前者是无读数。
     *   压成同一句就是本仓最贵的那类读数：两种处置相反的处境长得一模一样。 */
    const faces = (total === null || total <= 0)
        ? '面级契约：本轮未取数（**不是「零面就绪」**）'
        : ('面级契约：就绪 ' + String(ready === null ? 0 : ready) + '/' + String(total));
    const notes = [];
    /* 功能点 ①（展示宿主版本与插件版本）：压在**同一段**里，不是分散三处 ——
     *   读者一眼看到的应该是一份「这台机器上，本机 / 宿主 / 上游各是什么版本」的账。
     *   「宿主版本读不出」与「没有宿主」是两件事（前者是读数缺席，后者不可能成立）：
     *   宿主版本取不到时只写「读不出」，不写「无宿主」。 */
    /* 身份段单独成一条（idLine）：读者在两处要看它——能力首屏（「这台机器是什么版本」）与跨仓卡
     *   （「这个版本配不配」）。文案仍只有本函数一份：调用方不得自己拼一句「宿主版本读不出」。 */
    const idParts = [];
    if (i.phone) idParts.push('本机 v' + strOf(i.phone));
    const hostTxt = strOf(i.hostVersion) || '**读不出** —— 这是「读不出」，不是「宿主不支持」';
    idParts.push('宿主 ' + hostTxt);
    const idLine = idParts.join(' · ');
    notes.push('本机 v' + strOf(i.phone));
    notes.push('宿主 ' + hostTxt);
    notes.push(faces);
    if (missing.length) notes.push('上游版本读不出：' + missing.join('、'));
    if (outdated.length) notes.push('上游版本偏低：' + outdated.join('、'));
    return {
        phone: strOf(i.phone),
        faces: (total === null || total <= 0) ? null : { ready: (ready === null ? 0 : ready), total: total },
        missing: missing, outdated: outdated,
        stale: (missing.length + outdated.length) > 0,
        /* idLine —— 只说身份（本机 / 宿主）；line —— 身份 + 面级契约 + 上游。
         *   两者共用上面同一份文案变量（不是两句各写一遍），读者不会看到两种说法。 */
        idLine: idLine,
        line: notes.join(' · '),
    };
}

/* 插件级「最低版本」**从登记面真源派生**，不在这里写常数。
 *   为什么必须有这个函数而不是在调用点取 max：取 max 是判定（哪一版够用），
 *   判定写进调用点就是「同一口径的第二份实现」——本仓治过多次。
 *   口径：该 owner 名下**所有带 since 的面**中最大的 since（since 说自己从哪一版开始产出）；
 *   带 null since 的面（登记面里如实不立版本判据的那种）**不参与**版本比对。
 *   无可判面 ⇒ 返回 ''，上层据此**不判版本偏低**（如实少一条判据，好过拿假门限比）。
 * @param {Array} features 登记面（config/crossrepo-registry.js 的 CROSSREPO_FEATURES）
 * @param {string} owner 归属仓
 * @returns {string}
 */
export function minUpstreamOf(features, owner) {
    const list = Array.isArray(features) ? features : [];
    const who = strOf(owner);
    let best = '';
    if (!who) return '';
    for (const f of list) {
        const o = (f && typeof f === 'object') ? f : {};
        if (strOf(o.owner) !== who) continue;
        const since = strOf(o.since);
        if (!since) continue;
        if (!best || semverLess(best, since)) best = since;
    }
    return best;
}

/* semver 三比：只用于「提示版本偏低」，不参与任何门禁判定。
 *   刻意不做预发布号语义（本仓两个上游用不着），也不要引外部实现。 */
export function semverLess(a, b) {
    const pa = parseSemver(a), pb = parseSemver(b);
    for (let i = 0; i < 3; i++) {
        if (pa[i] !== pb[i]) return pa[i] < pb[i];
    }
    return false;
}

function parseSemver(v) {
    const parts = strOf(v).replace(/^v/i, '').split('.');
    const out = [];
    for (let i = 0; i < 3; i++) {
        const n = numOrNull(String(parts[i] === undefined ? '' : parts[i]).replace(/[^0-9].*$/, ''));
        out.push(n === null ? 0 : Math.max(0, Math.trunc(n)));
    }
    return out;
}

/* 诊断报告文本（计划 R-X8 ③：复制诊断报告）。
 *   只拼已判定的读数，不现取任何东西 —— 「复制」这个动作本身不得触发检测。 */
export function capHealthReport(summary, notice) {
    const s = summary || capHealthSummary(null);
    const lines = [];
    lines.push('【能力健康】' + s.line);
    for (const r of s.rows) {
        lines.push('- ' + r.label + '：' + r.stateText + (r.why ? '（' + r.why + '）' : ''));
        if (r.state === CAP_STATES.UNAVAILABLE || r.state === CAP_STATES.PARTIAL) {
            lines.push('  替代操作：' + r.fallbacks.join(' → '));
        }
    }
    if (notice && notice.line) lines.push('【跨仓】' + notice.line);
    return lines.join('\n');
}

/* ───────── ⑤ 自检 ───────── */

export function capHealthSelfCheck() {
    const problems = [];

    if (CAP_STATE_KEYS.length !== 4) problems.push('四态必须四个，实际 ' + CAP_STATE_KEYS.length);
    if (CAPABILITY_IDS.length !== 6) problems.push('能力面必须六个，实际 ' + CAPABILITY_IDS.length);
    /* 四态文案必须互不相同（同形即压平）。 */
    const texts = CAP_STATE_KEYS.map(function (k) { return CAP_STATE_TEXT[k]; });
    if (new Set(texts).size !== 4) problems.push('四态文案出现重复（压平了两态）');

    /* 每个能力都要有 label 与非空替代操作；替代操作顺序必须稳定（原样转述声明次序）。 */
    for (const id of CAPABILITY_IDS) {
        if (!CAPABILITY_LABELS[id]) problems.push(id + ' 缺 label');
        const fb = CAP_FALLBACKS[id];
        if (!fb || fb.length === 0) problems.push(id + ' 缺替代操作（计划验收②要求缺能力时给替代操作）');
    }

    /* ① 四态不同形：四种输入必须得到四个不同的 state。 */
    const a = capStateOf('search', { present: true, probe: 'service', healthy: 'ok' });
    const b = capStateOf('search', { present: true, probe: 'service', healthy: 'partial' });
    const c = capStateOf('search', { present: true, probe: 'service', healthy: 'unavailable' });
    const d = capStateOf('search', null);
    if (a.state !== CAP_STATES.OK) problems.push('服务级可用应判 ok，实际 ' + a.state);
    if (b.state !== CAP_STATES.PARTIAL) problems.push('部分可用应判 partial，实际 ' + b.state);
    if (c.state !== CAP_STATES.UNAVAILABLE) problems.push('报不可用应判 unavailable，实际 ' + c.state);
    if (d.state !== CAP_STATES.UNVERIFIED) problems.push('无观测应判 unverified（不是坏），实际 ' + d.state);
    if (new Set([a.state, b.state, c.state, d.state]).size !== 4) problems.push('四态未做到不同形');

    /* ② 「接口存在」不得报成「服务可用」。 */
    const apiOnly = capStateOf('memory', { present: true, probe: 'api', healthy: 'ok' });
    if (apiOnly.state === CAP_STATES.OK) problems.push('仅接口在场被判成可用（计划验收②禁止）');
    if (apiOnly.state !== CAP_STATES.PARTIAL) problems.push('仅接口在场应降为 partial，实际 ' + apiOnly.state);
    if (apiOnlyDegrade(CAP_STATES.OK) !== CAP_STATES.PARTIAL) problems.push('apiOnlyDegrade 未把 ok 降为 partial');

    /* ③ 只有版本号 ⇒ 未验证（版本号不是可用性）。 */
    const verOnly = capStateOf('image', { present: true, probe: 'version', healthy: 'ok' });
    if (verOnly.state !== CAP_STATES.UNVERIFIED) problems.push('只有版本号应判 unverified，实际 ' + verOnly.state);

    /* ④ 面缺席 ⇒ 未验证（不是不可用）。 */
    const absent = capStateOf('notify', { present: false, probe: 'service', healthy: 'unavailable' });
    if (absent.state !== CAP_STATES.UNVERIFIED) problems.push('面缺席应判 unverified（不是坏），实际 ' + absent.state);

    /* ⑤ 汇总：没给观测的能力记 unverified，不得记 ok。 */
    const sum = capHealthSummary({ search: { present: true, probe: 'service', healthy: 'ok' } });
    if (sum.counts.ok !== 1) problems.push('汇总应 1 项可用，实际 ' + sum.counts.ok);
    if (sum.counts.unverified !== 5) problems.push('其余五项应记未验证，实际 ' + sum.counts.unverified);
    if (sum.counts.ok + sum.counts.partial + sum.counts.unavailable + sum.counts.unverified !== sum.total) {
        problems.push('四态计数之和应等于总数（有态的读数漏了）');
    }

    /* ⑥ 替代操作必须真能取到（不可用/部分可用项）。 */
    if (sum.attention.some(function (r) { return !r.fallbacks.length; })) {
        problems.push('需处置的项缺替代操作');
    }

    /* ⑦ 跨仓提示：版本读不出与版本偏低必须分开，且两者都不得静默。 */
    const n1 = crossRepoNotice({ phone: '3.92.0', upstreams: [{ id: 'lonsha-memory-plugin', version: '' }], minUpstream: '3.170.0' });
    if (n1.missing.length !== 1) problems.push('版本读不出应单独记 missing，实际 ' + n1.missing.length);
    if (n1.outdated.length !== 0) problems.push('版本读不出不得记成 outdated（两事处置相反）');
    const n2 = crossRepoNotice({ phone: '3.92.0', upstreams: [{ id: 'lonsha-memory-plugin', version: '3.1.0' }], minUpstream: '3.170.0' });
    if (n2.outdated.length !== 1) problems.push('版本偏低应记 outdated，实际 ' + n2.outdated.length);
    if (n2.missing.length !== 0) problems.push('版本偏低不得记成 missing（两事处置相反）');
    if (!semverLess('3.1.0', '3.170.0')) problems.push('semverLess 判错（3.1.0 < 3.170.0）');
    if (semverLess('3.170.0', '3.170.0')) problems.push('semverLess 对相等应判 false');
    if (!semverLess('3.9.0', '3.10.0')) problems.push('semverLess 必须逐段比（3.9.0 < 3.10.0）');
    const n5 = crossRepoNotice({ phone: '3.92.0', hostVersion: '1.12.6', upstreams: [], totalFaces: 0 });
    if (n5.line.indexOf('宿主 1.12.6') < 0) problems.push('宿主版本必须进跨仓段（功能点 ①）');
    const n6 = crossRepoNotice({ phone: '3.92.0', upstreams: [], totalFaces: 0 });
    if (n6.line.indexOf('宿主') < 0) problems.push('读不出宿主版本也必须说（不能静默）');
    if (n6.line.indexOf('读不出') < 0) problems.push('宿主版本缺席时必须明说是「读不出」');
    if (n6.line.indexOf('不支持') < 0) problems.push('读不出不得写成「宿主不支持」（两事处置相反）');
    if (n5.line.indexOf('读不出') >= 0) problems.push('宿主版本读得到时不得再说「读不出」');
    const rep1 = capHealthReport(capHealthSummary(null), n5);
    if (rep1.indexOf('宿主 1.12.6') < 0) problems.push('报告必须带上宿主版本（读的人拿到的是完整账）');
    /* 身份行：两个读数（本机 / 宿主）不得在读不出时静默；也不得把面级与上游塞进身份行（两处用途不同）。 */
    if (n5.idLine.indexOf('宿主 1.12.6') < 0) problems.push('身份行必须带宿主版本');
    if (n5.idLine.indexOf('面级契约') >= 0) problems.push('身份行不得塞面级契约（两处用途不同）');
    if (n6.idLine.indexOf('读不出') < 0) problems.push('身份行在宿主版本缺席时也必须明说');
    if (n6.idLine.indexOf('不支持') < 0) problems.push('身份行不得把「读不出」写成「不支持」');

    const n3 = crossRepoNotice({ phone: '3.92.0', upstreams: [{ id: 'a', version: '3.1.0', min: '3.2.0' }], minUpstream: '' });
    if (n3.outdated.length !== 1) problems.push('逐上游门限必须生效（a 自带 min）');
    const n4 = crossRepoNotice({ phone: '3.92.0', upstreams: [{ id: 'a', version: '3.1.0' }], minUpstream: '' });
    if (n4.outdated.length !== 0) problems.push('没有门限不得判版本偏低（不拿假门限比）');
    /* ⑨ 插件级最低版本必须从登记面真源派生（且 null since 不参与版本比对）。 */
    const feats = [
        { owner: 'lonsha', since: '3.100.0' },
        { owner: 'lonsha', since: '3.181.0' },
        { owner: 'lonsha', since: null },
        { owner: 'worldaxis', since: '3.9.0' },
    ];
    if (minUpstreamOf(feats, 'lonsha') !== '3.181.0') problems.push('最低版本应取该 owner 名下最大的 since');
    if (minUpstreamOf(feats, 'nobody') !== '') problems.push('无该 owner 的面应返回空串（不造假门限）');
    if (minUpstreamOf([{ owner: 'lonsha', since: null }], 'lonsha') !== '') problems.push('null since 不得参与版本比对');
    if (minUpstreamOf(null, 'lonsha') !== '') problems.push('登记面缺席应返回空串（不抛）');

    /* ⑧ 报告面：需处置的项必须带替代操作行。 */
    const rep = capHealthReport(sum, n1);
    if (rep.indexOf('替代操作') < 0 && sum.attention.length > 0) problems.push('报告里需处置项缺替代操作行');
    if (rep.indexOf('【跨仓】') < 0) problems.push('报告缺跨仓段');

    return { problems: problems, states: 4, capabilities: CAPABILITY_IDS.length, fallbacks: Object.keys(CAP_FALLBACKS).length };
}

export default {
    CAP_STATES,
    CAP_STATE_KEYS,
    CAP_STATE_TEXT,
    CAP_PROBES,
    CAP_PROBE_KEYS,
    CAPABILITY_IDS,
    CAPABILITY_LABELS,
    CAP_FALLBACKS,
    normalizeObservation,
    apiOnlyDegrade,
    capStateOf,
    emptyCapCounts,
    capHealthSummary,
    capSummaryLine,
    crossRepoNotice,
    semverLess,
    minUpstreamOf,
    capHealthReport,
    capHealthSelfCheck,
};
