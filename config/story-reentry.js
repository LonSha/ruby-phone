/* ============================================================
 * config/story-reentry.js — [v4.52.0 · 第六期 R6-O8]
 *   「续玩再入场：从读简报升级为重新进入正在运转的故事」（纯函数）
 * ------------------------------------------------------------
 * 【计划原文（R6-O8）】
 *   「隔几天回来不只是看到一份简报，而是重新进入正在运转的故事：
 *    停在筹展中途重开，可选择补回群消息或继续准备；窄屏也能看清接续旅程。」
 *
 * 【修前实测的缺口】
 *   本仓 `config/resume-brief.js`（v3.20.0）已经能「收五面 → 一份分节简报」，
 *   但它止步于「读数」：告诉你停在哪、有什么未完成，然后**到此为止**。
 *   缺的是「下一步怎么走」的那一层——不是建议行动（计划明文禁止把入口写成祈使句），
 *   而是把「断开 → 重连」这段路本身**结构化**成一条可走的接续旅程：
 *     ① 断开期间发生了什么（离场 → 回来之间有「场外时间」）；
 *     ② 回来时有几条可选路径（补群消息 / 继续准备 / 直接进主线）；
 *     ③ 选了哪条后，给出那条路径的「入口点」（不是结论，是可点开的第一步）。
 *   resume-brief 给的是「上次停在哪」；story-reentry 给的是「从上次停的地方重新走入故事」。
 *
 * 【本模块只做四件事（纯函数，不读存储 / 不碰 DOM / 不读时钟）】
 *   1 **buildReentryPath**：把简报读数 + 离场点 + 场外事件收成一条接续旅程，
 *      每步带 kind（catchup / resume / enter-main）与 entryPoint（可点开的第一步）；
 *   2 **deriveCatchupChoices**：离场期间有群消息 / 社媒动态 / 新约定时，
 *      生成「补回哪一路」的可选项，**每路标明预计条数与涉及的 App**；
 *   3 **buildReentryBrief**：窄屏一句话 + 最先可做的一步，
 *      不给全量简报（窄屏看不下），只给「先做这一步」的入口；
 *   4 **gateReentry**：重连时如果主线已被推进（楼层长了），
 *      接续旅程必须标 stale 并如实报告——绝不把「已经过去了」伪装成「还在等你」。
 *
 * 【口径纪律】
 *   · 离场点（departedAtFloor）必须由调用方给，本模块不读楼层；
 *   · 场外事件全部由调用方取好传入，本模块只收不改；
 *   · 「可选路径」是结构，不是建议——entryPoint 只给 App 名与方向，不写「你应该」；
 *   · 主线已推进时不静默截断，标 stale 并计数。
 * ============================================================ */
'use strict';

/* ───────── 常量 ───────── */
export const REENTRY_VERSION = '4.52.0';
export const REENTRY_STEP_KINDS = Object.freeze({
    catchup: Object.freeze({ label: '补看', note: '离场期间积累的消息/动态，可选择补看或跳过' }),
    resume: Object.freeze({ label: '续做', note: '上次未完成的事，从断开处继续' }),
    'enter-main': Object.freeze({ label: '进主线', note: '回到当前楼层的主线对话' }),
    stale: Object.freeze({ label: '已过时', note: '主线已推进，此接续路径不再可用' }),
});
export const REENTRY_LIMITS = Object.freeze({
    maxSteps: 12,
    maxCatchupRoutes: 5,
    textMax: 200,
});

function _s(x, max) {
    const t = (x === null || x === undefined) ? '' : String(x);
    return max ? t.slice(0, max) : t;
}

/* ───────── ① 接续旅程 ───────── */
/**
 * @param {object} input
 *   · `departedAtFloor`  — 离场时的正文楼层（整数，由调用方给）
 *   · `currentFloor`     — 当前正文楼层（整数，用于判主线是否已推进）
 *   · `brief`            — resumeBrief() 的返回（简报读数）
 *   · `missedGroupMsgs`  — 离场期间群消息条数（整数，0 = 没有）
 *   · `missedSocialPosts`— 离场期间社媒动态条数（整数）
 *   · `pendingCommitments` — 离场期间新增的未完成约定条数
 *   · `at`               — 生成时点（毫秒，由调用方给）
 * @returns {{ ok:boolean, path:Array, catchupRoutes:Array, brief:object, stale:boolean, staleFloors:number, summary:string }}
 */
export function buildReentryPath(input = {}) {
    const o = (input && typeof input === 'object') ? input : {};
    const departedAt = (typeof o.departedAtFloor === 'number' && Number.isInteger(o.departedAtFloor) && o.departedAtFloor >= 0) ? o.departedAtFloor : null;
    const currentFloor = (typeof o.currentFloor === 'number' && Number.isInteger(o.currentFloor) && o.currentFloor >= 0) ? o.currentFloor : null;
    const staleFloors = (departedAt !== null && currentFloor !== null && currentFloor > departedAt) ? currentFloor - departedAt : 0;
    const isStale = staleFloors > 0;
    const path = [];
    const catchupRoutes = [];

    /* 补看路径：群消息 / 社媒 / 新约定 */
    const missedGroup = (typeof o.missedGroupMsgs === 'number' && o.missedGroupMsgs > 0) ? o.missedGroupMsgs : 0;
    const missedSocial = (typeof o.missedSocialPosts === 'number' && o.missedSocialPosts > 0) ? o.missedSocialPosts : 0;
    const pendingNew = (typeof o.pendingCommitments === 'number' && o.pendingCommitments > 0) ? o.pendingCommitments : 0;

    if (missedGroup > 0) {
        catchupRoutes.push({ route: 'group-msgs', count: missedGroup, app: 'wechat', label: '群消息 ' + missedGroup + ' 条' });
    }
    if (missedSocial > 0) {
        catchupRoutes.push({ route: 'social', count: missedSocial, app: 'weibo', label: '社媒动态 ' + missedSocial + ' 条' });
    }
    if (pendingNew > 0) {
        catchupRoutes.push({ route: 'commitments', count: pendingNew, app: 'calendar', label: '新约定 ' + pendingNew + ' 条' });
    }
    while (catchupRoutes.length > REENTRY_LIMITS.maxCatchupRoutes) catchupRoutes.pop();

    if (catchupRoutes.length > 0) {
        path.push({
            kind: 'catchup',
            label: '离场期间有 ' + catchupRoutes.length + ' 路积累',
            routes: catchupRoutes.map(r => ({ route: r.route, label: r.label, entryPoint: { kind: 'app', app: r.app } })),
            skippable: true,
        });
    }

    /* 续做路径：从简报中取未完成项 */
    const brief = o.brief && typeof o.brief === 'object' ? o.brief : null;
    if (brief && Array.isArray(brief.sections)) {
        const openItems = brief.sections.flatMap(s => (s && Array.isArray(s.rows)) ? s.rows.slice(0, 3) : []);
        if (openItems.length > 0) {
            path.push({
                kind: isStale ? 'stale' : 'resume',
                label: isStale ? '上次未完成的事（主线已推进，可能需要重认上下文）' : '上次未完成的事',
                items: openItems.slice(0, 5).map(r => ({
                    text: _s(r.text, REENTRY_LIMITS.textMax),
                    source: _s(r.source, 80),
                    entryPoint: r.action || { kind: 'app', app: 'timeweaver' },
                })),
                stale: isStale,
            });
        }
    }

    /* 进主线 */
    path.push({
        kind: isStale ? 'stale' : 'enter-main',
        label: isStale ? '回主线（已推进 ' + staleFloors + ' 楼，建议从当前楼层读起）' : '回主线（当前楼层）',
        entryPoint: { kind: 'app', app: 'timeweaver', floor: currentFloor },
        stale: isStale,
    });

    while (path.length > REENTRY_LIMITS.maxSteps) path.pop();

    const summary = '接续旅程：' + path.length + ' 步'
        + (catchupRoutes.length ? ' · 补看 ' + catchupRoutes.length + ' 路' : '')
        + (isStale ? ' · 主线已推进 ' + staleFloors + ' 楼' : '');

    return { ok: true, path, catchupRoutes, brief: brief || null, stale: isStale, staleFloors, summary };
}

/* ───────── ② 补看选项 ───────── */
/**
 * 从 buildReentryPath 的产物中提取可补看的路由列表（含跳过选项）。
 */
export function deriveCatchupChoices(reentry) {
    if (!reentry || !Array.isArray(reentry.catchupRoutes)) return { choices: [], skipAll: true };
    const choices = reentry.catchupRoutes.map(r => ({
        route: r.route,
        label: r.label,
        app: r.app,
        count: r.count,
        action: { kind: 'app', app: r.app },
    }));
    return { choices, skipAll: true };
}

/* ───────── ③ 窄屏一句话 ───────── */
/**
 * 窄屏只给「先做这一步」的入口——不给全量简报。
 */
export function buildReentryBrief(reentry) {
    if (!reentry || !reentry.path || reentry.path.length === 0) {
        return { headline: '没有可续的旅程', firstStep: null };
    }
    const first = reentry.path[0];
    const headline = first.label || '继续';
    const firstStep = first.entryPoint || (first.routes && first.routes[0] && first.routes[0].entryPoint) || { kind: 'app', app: 'timeweaver' };
    return { headline: _s(headline, REENTRY_LIMITS.textMax), firstStep, stale: Boolean(reentry.stale) };
}

/* ───────── ④ 主线推进守卫 ───────── */
/**
 * 判断接续旅程是否因主线推进而过时。
 * 纯函数：只比较两个整数。
 */
export function gateReentry(departedAtFloor, currentFloor) {
    const dep = (typeof departedAtFloor === 'number' && Number.isInteger(departedAtFloor) && departedAtFloor >= 0) ? departedAtFloor : null;
    const cur = (typeof currentFloor === 'number' && Number.isInteger(currentFloor) && currentFloor >= 0) ? currentFloor : null;
    if (dep === null || cur === null) return { stale: false, staleFloors: 0, reason: '楼层信息不足，无法判定' };
    const staleFloors = Math.max(0, cur - dep);
    return {
        stale: staleFloors > 0,
        staleFloors,
        reason: staleFloors > 0 ? '主线已推进 ' + staleFloors + ' 楼' : '主线未推进，可安全接续',
    };
}
