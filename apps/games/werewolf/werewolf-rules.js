/* ============================================================
 * werewolf-rules.js — [v4.189.0] 狼人杀规则判定的纯函数内核
 * ------------------------------------------------------------
 * 从 apps/games/werewolf/werewolf-data.js 那 1100 行类里抽出来的规则部分：
 *   源的 _assignRoles / _advanceNightStep / _resolveNightResult /
 *   _checkWinCondition / _normalizeRoleRevealMode / _isValidState /
 *   _firstAliveSeatFrom / _lastAliveSeat / _isUserSeat 一族
 *   —— 全是「给定状态 -> 给定结论」，不碰 DOM、不碰存储、不碰时间。
 * ------------------------------------------------------------
 * 为什么单独一件：类里其余 60 多个方法都在动 this.state 并 _persist()，
 *   那是有副作用的编排。混在一个文件里，判据只能「跑一遍看不崩」，
 *   钉不住任何一条规则不变式（身份数对不对、夜晚步骤走完没走完、
 *   谁该赢、揭示模式认不认得出）。
 * ------------------------------------------------------------
 * 刻意不做：不持状态、不改入参、不自己取 Math.random（洗身份由调用方传 rng）。
 * ============================================================ */

/** 8 人局身份池（2 狼 + 预言家 + 女巫 + 守卫 + 3 民）。 */
export const ROLE_POOL = Object.freeze(['狼人', '狼人', '预言家', '女巫', '守卫', '村民', '村民', '村民']);

/** 夜晚行动顺序。封闭词表：表外拒答。 */
export const NIGHT_STEPS = Object.freeze(['guard', 'werewolf', 'seer', 'witch']);

/** 夜晚步骤 -> 该谁动。 */
export const NIGHT_STEP_ROLES = Object.freeze({
    guard: '守卫',
    werewolf: '狼人',
    seer: '预言家',
    witch: '女巫'
});

/** 夜晚步骤 -> 界面文案。 */
export const NIGHT_STEP_LABELS = Object.freeze({
    guard: '守卫行动',
    werewolf: '狼人行动',
    seer: '预言家行动',
    witch: '女巫行动'
});

/** 揭示模式封闭词表：认不出就拒，不悄悄兜成默认。 */
export const REVEAL_MODES = Object.freeze(['hidden', 'open', 'self']);

export const WW_REJECT = Object.freeze({
    unknownStep: 'unknown_step',
    unknownMode: 'unknown_mode',
    notEnoughPlayers: 'not_enough_players',
    badState: 'bad_state'
});

/** 身份在池里吗（词表闭合）。 */
export function roleInPool(role) {
    return typeof role === 'string' && ROLE_POOL.indexOf(role) >= 0;
}

/** 夜晚步骤认得吗。 */
export function nightStepOf(step) {
    if (typeof step !== 'string') return null;
    return NIGHT_STEPS.indexOf(step) >= 0 ? step : null;
}

/** 归一揭示模式：认不出返回 null（不兜默认）。 */
export function normalizeRevealMode(mode) {
    if (typeof mode !== 'string') return null;
    return REVEAL_MODES.indexOf(mode) >= 0 ? mode : null;
}

/** 洗身份：rng 由调用方给。同一 pool + 同一 rng 序列 => 同一分配。 */
export function assignRoles(playerCount, rng) {
    const n = Math.max(0, Math.floor(playerCount) || 0);
    if (n !== ROLE_POOL.length) return { ok: false, reason: WW_REJECT.notEnoughPlayers, roles: [] };
    const pool = ROLE_POOL.slice();
    const next = rng || (() => 0);
    for (let i = pool.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    return { ok: true, reason: null, roles: pool };
}

/** 夜晚该谁动：给定当前步骤，返回角色名；认不出拒答。 */
export function roleForStep(step) {
    const s = nightStepOf(step);
    if (!s) return { ok: false, reason: WW_REJECT.unknownStep, role: null };
    return { ok: true, reason: null, role: NIGHT_STEP_ROLES[s] };
}

/** 夜晚步骤推进：走到下一步；走完了返回 null（调用方据此转白天）。 */
export function advanceNightStep(step) {
    const cur = nightStepOf(step);
    if (!cur) return { ok: false, reason: WW_REJECT.unknownStep, next: null, done: false };
    const i = NIGHT_STEPS.indexOf(cur);
    if (i + 1 >= NIGHT_STEPS.length) return { ok: true, reason: null, next: null, done: true };
    return { ok: true, reason: null, next: NIGHT_STEPS[i + 1], done: false };
}

/** 还活着的玩家（folded/dead 都不算）。 */
export function alivePlayers(players) {
    if (!Array.isArray(players)) return [];
    return players.filter((p) => p && p.alive !== false);
}

/** 活着的狼。 */
export function aliveWolves(players) {
    return alivePlayers(players).filter((p) => p.role === '狼人');
}

/** 活着的非狼（好人与第三方，都算「非狼方」）。 */
export function aliveNonWolves(players) {
    return alivePlayers(players).filter((p) => p.role !== '狼人');
}

/** 胜负判定：狼全灭 -> 好人胜；狼数 >= 非狼数 -> 狼人胜；否则未分。 */
export function checkWinCondition(players) {
    if (!Array.isArray(players) || !players.length) {
        return { ok: false, reason: WW_REJECT.badState, winner: null, wolves: 0, nonWolves: 0 };
    }
    const wolves = aliveWolves(players).length;
    const nonWolves = aliveNonWolves(players).length;
    if (wolves === 0) return { ok: true, reason: null, winner: 'good', wolves, nonWolves };
    if (wolves >= nonWolves) return { ok: true, reason: null, winner: 'wolves', wolves, nonWolves };
    return { ok: true, reason: null, winner: null, wolves, nonWolves };
}

/** 从某个座位起，第一个还活着的座位号（环形找）。 */
export function firstAliveSeatFrom(players, fromSeat) {
    const alive = alivePlayers(players);
    if (!alive.length) return null;
    const from = Number(fromSeat) || 0;
    const seats = alive.map((p) => Number(p.seat)).filter((s) => Number.isFinite(s)).sort((a, b) => a - b);
    for (const s of seats) if (s >= from) return s;
    return seats[0];
}

/** 最后一个活着的座位号。 */
export function lastAliveSeat(players) {
    const seats = alivePlayers(players).map((p) => Number(p.seat)).filter((s) => Number.isFinite(s));
    if (!seats.length) return null;
    return Math.max.apply(null, seats);
}

/** 这个座位是用户吗。 */
export function isUserSeat(players, seat) {
    const s = Number(seat);
    const p = (players || []).filter((x) => x && Number(x.seat) === s)[0];
    return !!p && p.isUser === true;
}

/** 状态自检：玩家里必须有且只有一个用户，且每人身份都在池里。 */
export function isValidState(state) {
    if (!state || typeof state !== 'object' || !Array.isArray(state.players)) {
        return { ok: false, reason: WW_REJECT.badState };
    }
    const users = state.players.filter((p) => p && p.isUser === true);
    if (users.length !== 1) return { ok: false, reason: WW_REJECT.badState };
    for (const p of state.players) {
        if (p.role && !roleInPool(p.role)) return { ok: false, reason: WW_REJECT.badState };
    }
    return { ok: true, reason: null };
}

/** 女巫药水归一：只认 antidote / poison 两个真名，空串 = 不用药。 */
export function normalizePotion(action) {
    const p = (action && typeof action === 'object') ? String(action.usePotion || '').trim() : '';
    if (!p) return { ok: true, reason: null, potion: '' };
    if (p !== 'antidote' && p !== 'poison') return { ok: false, reason: WW_REJECT.unknownStep, potion: '' };
    return { ok: true, reason: null, potion: p };
}
