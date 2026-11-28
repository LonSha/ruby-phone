/* ========================================================
 * werewolf-rules-app.js — [v4.189.0] 狼人杀规则 · 控制器
 * 把 werewolf-rules.js 的纯函数接到「身份分配 / 夜晚推进 / 胜负」三件事上。
 * 不碰 werewolf-data.js 那个 1100 行的类（它持 state 且 _persist，是编排面）。
 * 零网络 / 零定时器；快照落盘只走 writeReceipt（唯一写入口）。
 * ======================================================== */
'use strict';
import {
    ROLE_POOL, NIGHT_STEPS, NIGHT_STEP_LABELS, NIGHT_STEP_ROLES, REVEAL_MODES, WW_REJECT,
    roleInPool, nightStepOf, normalizeRevealMode, assignRoles, roleForStep,
    advanceNightStep, alivePlayers, aliveWolves, aliveNonWolves, checkWinCondition,
    firstAliveSeatFrom, lastAliveSeat, isUserSeat, isValidState, normalizePotion,
} from './werewolf-rules.js';
import { writeReceipt } from '../../../config/write-receipt.js';

/** 一座 8 人局的空桌子（供试算；不落盘）。 */
const STATE_KEY = 'games_ww_rules_v1';

function emptyTable() {
    const players = [];
    for (let seat = 1; seat <= ROLE_POOL.length; seat += 1) {
        players.push({ seat, role: '', alive: true, isUser: seat === 1 });
    }
    return players;
}

import { WerewolfRulesView } from './werewolf-rules-view.js';
export class WerewolfRulesApp {
    render() {
        this._view ??= new WerewolfRulesView(this, this.shell);
        this._view.render();
    }
    constructor(shell, storage) {
        this.shell = shell;
        this.storage = storage;
        this._initFromStorage();
    }

    /**
     * 构造与换会话共用同一条重取路径（v4.199.0 从构造函数抽出，只为让 onChatChanged 不抄一份）。
     * 读的是**本会话**的存储快照，所以换会话 = 回构造态再读一次。
     */
    _initFromStorage() {
        this.players = emptyTable();
        this.revealMode = 'hidden';
        this.nightStep = NIGHT_STEPS[0];
        this.lastRoles = [];
        this._view = null;
        const snap = this._readSnapshot();
        if (snap) { this.players = snap.players || this.players; this.revealMode = snap.revealMode || this.revealMode; }
    }

    /**
     * [v4.199.0] 换会话：牌局与步骤是**会话数据**（落盘键按会话隔离），
     * 不重取的话，上一会话的读数会原样出现在新会话里（v255 的 A5 盯的就是这个口）。
     */
    onChatChanged() {
        this._initFromStorage();
    }


    _readSnapshot() {
        try {
            const raw = this.storage ? this.storage.get(STATE_KEY) : null;
            if (typeof raw !== 'string') return null;
            const parsed = JSON.parse(raw);
            return (parsed && typeof parsed === 'object') ? parsed : null;
        } catch (_e) { return null; }
    }

    _saveSnapshot() {
        try {
            if (!this.storage) return false;
            const r = writeReceipt(this.storage, STATE_KEY, JSON.stringify({ players: this.players, revealMode: this.revealMode }));
            return r.saved === true;
        } catch (_e) { return false; }

    }

    /** 发身份：8 人才发得动，人数不对就拒。rng 由调用方给。 */
    deal(rng) {
        const r = assignRoles(this.players.length, rng);
        if (!r.ok) return r;
        this.players = this.players.map((p, i) => Object.assign({}, p, { role: r.roles[i] || '' }));
        this.lastRoles = r.roles.slice();
        this._saveSnapshot();
        return { ok: true, reason: null, roles: r.roles };
    }

    /** 挪一个身份（试算用）：不在池里就拒。 */
    setRole(seat, role) {
        const s = Number(seat);
        if (!roleInPool(role)) return { ok: false, reason: WW_REJECT.badState };
        this.players = this.players.map((p) => (Number(p.seat) === s ? Object.assign({}, p, { role }) : p));
        this._saveSnapshot();
        return { ok: true, reason: null };
    }

    toggleAlive(seat) {
        const s = Number(seat);
        this.players = this.players.map((p) => (Number(p.seat) === s ? Object.assign({}, p, { alive: !(p.alive !== false) }) : p));
        this._saveSnapshot();
        return { ok: true, reason: null };
    }

    /** 揭示模式：认不出就拒。 */
    setRevealMode(mode) {
        const m = normalizeRevealMode(mode);
        if (!m) return { ok: false, reason: WW_REJECT.unknownMode };
        this.revealMode = m;
        this._saveSnapshot();
        return { ok: true, reason: null, mode: m };
    }

    /** 夜晚推到下一步；走完返回 done=true。 */
    nextStep() {
        const r = advanceNightStep(this.nightStep);
        if (!r.ok) return r;
        if (r.done) return { ok: true, reason: null, done: true, next: null };
        this.nightStep = r.next;
        return { ok: true, reason: null, done: false, next: r.next };
    }

    resetStep() { this.nightStep = NIGHT_STEPS[0]; return { ok: true }; }

    /** 当前该谁动。 */
    currentRole() { return roleForStep(this.nightStep); }

    /** 胜负读数。 */
    verdict() { return checkWinCondition(this.players); }

    /** 活着的人数。 */
    aliveCount() { return alivePlayers(this.players).length; }

    destroy() { this._view = null; }
}

export { ROLE_POOL, NIGHT_STEPS, NIGHT_STEP_LABELS, REVEAL_MODES };
export default WerewolfRulesApp;
