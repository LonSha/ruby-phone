/* ========================================================
 * undercover-rules-app.js — [v4.190.0] 谁是卧底 · 控制器
 *
 * 职责：把 undercover-rules.js 的纯函数接到「一局怎么开、怎么推进、怎么结算」上。
 * 为什么不动 undercover-data.js 那个 724 行的类：那个类持 this.state 并 _save()，
 *   还自己 Math.random 挑卧底 / 挑弃票 / 挑兜底词对，是**有副作用的编排**。
 *   本件只包无副作用的规则面，随机源由调用方给（同一个 rng 序列 => 同一局）。
 * 落盘：只走 config/write-receipt.js 的 writeReceipt 唯一实现。
 * ======================================================== */
'use strict';
import {
    PLAYER_COUNT, MAX_INVITED_CONTACTS, FALLBACK_WORD_PAIRS, ROLES, UC_REJECT,
    normalizeWordHistory, normalizeWordPair, rememberWordPair, normalizeContactIds,
    pickInvitedContacts, shuffle, seatPlayers, pickUndercoverSeat, buildAiProfiles,
    splitSpeechSegments, nextSpeaker, resolveVotes, voteResultText, isValidGame
} from './undercover-rules.js';
import { writeReceipt } from '../../../config/write-receipt.js';

/** 会话键（会话隔离，见 config/storage.js 的 /^games_uc_/ 与 keys-audit 登记）。 */
const STATE_KEY = 'games_uc_rules_v1';

/** 一座 6 人空桌（试算用）。 */
function emptyTable() {
    const players = [];
    for (let seat = 1; seat <= PLAYER_COUNT; seat += 1) {
        players.push({ seat, role: '', alive: true, isUser: seat === 1, name: seat + '号' });
    }
    return players;
}

export class UndercoverRulesApp {
    constructor(shell, storage) {
        this.shell = shell;
        this.storage = storage;
        this.players = emptyTable();
        this.wordPair = { civilian: '', undercover: '' };
        this.undercoverSeat = 0;
        this.round = 1;
        this.phase = 'matching';
        this.currentSpeakerSeat = 1;
        this.roundSpokenSeats = [];
        this.history = [];
        this.lastResult = null;
        this._view = null;
        const snap = this._readSnapshot();
        if (snap && Array.isArray(snap.players) && snap.players.length === PLAYER_COUNT) {
            this.players = snap.players;
            this.wordPair = snap.wordPair || this.wordPair;
            this.undercoverSeat = Number(snap.undercoverSeat) || 0;
            this.round = Math.max(1, Number(snap.round) || 1);
            this.phase = snap.phase || this.phase;
            this.currentSpeakerSeat = Number(snap.currentSpeakerSeat) || 1;
            this.roundSpokenSeats = Array.isArray(snap.roundSpokenSeats) ? snap.roundSpokenSeats : [];
            this.history = Array.isArray(snap.history) ? snap.history : [];
        }
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
            const payload = {
                players: this.players,
                wordPair: this.wordPair,
                undercoverSeat: this.undercoverSeat,
                round: this.round,
                phase: this.phase,
                currentSpeakerSeat: this.currentSpeakerSeat,
                roundSpokenSeats: this.roundSpokenSeats,
                history: this.history
            };
            const r = writeReceipt(this.storage, STATE_KEY, JSON.stringify(payload));
            return r.saved === true;
        } catch (_e) { return false; }
    }

    /** 开一局：rng 由调用方给。人数不对就拒。 */
    deal(rng) {
        if (this.players.length !== PLAYER_COUNT) {
            return { ok: false, reason: UC_REJECT.badState };
        }
        const seats = shuffle(Array.from({ length: PLAYER_COUNT }, (_, i) => i + 1), rng);
        const seated = seatPlayers(this.players, seats);
        this.players = seated.players;
        this.undercoverSeat = pickUndercoverSeat(rng);
        this.players = this.players.map((p) => {
            const isUc = Number(p.seat) === this.undercoverSeat;
            return Object.assign({}, p, {
                role: isUc ? 'undercover' : 'civilian',
                word: isUc ? this.wordPair.undercover : this.wordPair.civilian
            });
        });
        this.round = 1;
        this.phase = 'playing';
        this.roundSpokenSeats = [];
        this.currentSpeakerSeat = 1;
        this._saveSnapshot();
        return { ok: true, reason: null, undercoverSeat: this.undercoverSeat };
    }

    /** 设词对：不合规（空 / 两词相同 / 与最近重复）就落到兜底池。 */
    setWordPair(civilian, undercover) {
        const r = normalizeWordPair({ civilian, undercover }, this.history, null);
        if (!r.ok) return { ok: false, reason: r.reason };
        this.wordPair = { civilian: r.civilian, undercover: r.undercover };
        this.history = rememberWordPair(this.history, this.wordPair);
        this._saveSnapshot();
        return { ok: true, reason: null, wordPair: this.wordPair, fromFallback: r.fromFallback };
    }

    /** 点某个座位的死活（试算用）。 */
    toggleAlive(seat) {
        const s = Number(seat);
        let found = false;
        this.players = this.players.map((p) => {
            if (Number(p.seat) !== s) return p;
            found = true;
            return Object.assign({}, p, { alive: !(p.alive !== false) });
        });
        if (!found) return { ok: false, reason: UC_REJECT.badState };
        this._saveSnapshot();
        return { ok: true, reason: null };
    }

    /** 手动设身份（试算用）：不在词表里就拒。 */
    setRole(seat, role) {
        if (ROLES.indexOf(role) < 0) return { ok: false, reason: UC_REJECT.badState };
        const s = Number(seat);
        let found = false;
        this.players = this.players.map((p) => {
            if (Number(p.seat) !== s) return p;
            found = true;
            return Object.assign({}, p, { role });
        });
        if (!found) return { ok: false, reason: UC_REJECT.badState };
        this._saveSnapshot();
        return { ok: true, reason: null };
    }

    /** 记一次发言，然后推进轮次。 */
    speak(seat, text) {
        const s = Number(seat);
        if (s !== this.currentSpeakerSeat) return { ok: false, reason: UC_REJECT.wrongSeat };
        const body = String(text || '').trim();
        if (!body) return { ok: false, reason: UC_REJECT.emptyText };
        this.roundSpokenSeats = [...new Set([...this.roundSpokenSeats, s])];
        const game = this._game();
        const nx = nextSpeaker(game);
        if (!nx.ok) return { ok: false, reason: nx.reason };
        this.phase = nx.phase;
        this.currentSpeakerSeat = nx.currentSpeakerSeat;
        this._saveSnapshot();
        return { ok: true, reason: null, segments: splitSpeechSegments(body), next: nx };
    }

    /** 结算一轮：aiVotes 由调用方给（AI 自己投的），rng 兜弃票。 */
    vote(aiVotes, rng) {
        const game = this._game();
        game.userVote = null;
        const r = resolveVotes(game, aiVotes, rng);
        if (!r.ok) return { ok: false, reason: r.reason };
        this.players = r.players;
        this.phase = r.phase;
        this.round = r.round;
        this.currentSpeakerSeat = r.currentSpeakerSeat;
        this.roundSpokenSeats = r.phase === 'playing' ? [] : this.roundSpokenSeats;
        this.lastResult = r;
        this._saveSnapshot();
        return { ok: true, reason: null, result: r, text: voteResultText(r) };
    }

    /** 胜负读数。 */
    verdict() {
        const game = this._game();
        const alive = game.players.filter((p) => p.alive !== false);
        const ucAlive = alive.some((p) => p.role === 'undercover');
        if (!ucAlive) return { ok: true, winner: 'civilian', aliveCount: alive.length };
        if (alive.length <= 2) return { ok: true, winner: 'undercover', aliveCount: alive.length };
        return { ok: true, winner: null, aliveCount: alive.length };
    }

    /** 活着的座位号列表。 */
    aliveSeats() {
        return this.players.filter((p) => p.alive !== false).map((p) => Number(p.seat));
    }

    /** 当前状态自检：必须且只有一个用户。 */
    check() { return isValidGame(this._game()); }

    _game() {
        return {
            players: this.players,
            round: this.round,
            currentSpeakerSeat: this.currentSpeakerSeat,
            roundSpokenSeats: this.roundSpokenSeats,
            userVote: null
        };
    }

    destroy() { this._view = null; }
}

export {
    PLAYER_COUNT, MAX_INVITED_CONTACTS, FALLBACK_WORD_PAIRS, ROLES, UC_REJECT,
    normalizeContactIds, pickInvitedContacts, splitSpeechSegments, voteResultText
};
export default UndercoverRulesApp;