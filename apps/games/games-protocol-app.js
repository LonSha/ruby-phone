/* ========================================================
 * games-protocol-app.js — [v4.192.0] 游戏 AI 协议解析 · 控制器
 * --------------------------------------------------------
 * 把 games-protocol-core.js 的纯函数接到「一段 AI 回包怎么读」上：谁是卧底的
 *   发牌官回包 / 发言 / 投票 / 公开展示日志，狼人杀的匹配 / 发言 / 遗言 /
 *   夜晚行动 / 投票决策 / 三张发言消息 / 补位玩家 / 按天归档。
 * 不碰 games-app.js 那个 3837 行的 GamesApp（它继承 PokerApp、持一票游戏 data
 *   实例与 API 冷却态，全是编排面）。
 * 落盘：只走 writeReceipt 唯一实现。
 * ======================================================== */
'use strict';
import {
    parseUndercoverDealerResult, parseUndercoverSpeech, parseUndercoverVotes, formatUndercoverPublicLog,
    parseWerewolfMatch, parseWerewolfSpeech, parseWerewolfLastWords,
    parseWerewolfNightDecision, parseWerewolfVoteDecision, werewolfNightActors,
    resolveWerewolfVoteTarget, fallbackWerewolfVoteTarget,
    formatWerewolfPublicChatLog, formatWerewolfVoteHistory,
    formatWerewolfPublicStateMessage, formatWerewolfPublicLogMessage, formatWerewolfSpeechTaskMessage,
    buildWerewolfFallbackPlayers, buildWerewolfPublicRecordMessages
} from './games-protocol-core.js';
import { writeReceipt } from '../../config/write-receipt.js';

const STATE_KEY = 'games_protocol_v1';

export class GamesProtocolApp {
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
        this.lastInput = null;
        this.lastOut = null;
        this._view = null;
        const snap = this._readSnapshot();
        if (snap) { this.lastInput = snap.input || null; this.lastOut = snap.out || null; }
    }

    /**
     * [v4.199.0] 换会话：上次回包是**会话数据**（落盘键按会话隔离），
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
            const r = writeReceipt(this.storage, STATE_KEY, JSON.stringify({ input: this.lastInput, out: this.lastOut }));
            return r.saved === true;
        } catch (_e) { return false; }
    }

    _record(kind, value, out) {
        this.lastInput = { kind, value: String(value == null ? '' : value) };
        this.lastOut = out;
        this._saveSnapshot();
        return out;
    }

    dealer(text) { return this._record('dealer', text, parseUndercoverDealerResult(text)); }
    undercoverSpeech(text) { return this._record('undercoverSpeech', text, { text: parseUndercoverSpeech(text) }); }
    undercoverVotes(text) { return this._record('undercoverVotes', text, { votes: parseUndercoverVotes(text) }); }
    undercoverLog(messages) {
        return this._record('undercoverLog', JSON.stringify(messages || []), { lines: formatUndercoverPublicLog(messages) });
    }

    match(text) { return this._record('match', text, { sections: parseWerewolfMatch(text) }); }
    speech(text) { return this._record('speech', text, { text: parseWerewolfSpeech(text) }); }
    lastWords(text) { return this._record('lastWords', text, { text: parseWerewolfLastWords(text) }); }
    night(text, step) { return this._record('night', text, parseWerewolfNightDecision(text, step)); }
    nightActor(step) { return this._record('nightActor', step, { actor: werewolfNightActors(step) }); }
    vote(text) { return this._record('vote', text, parseWerewolfVoteDecision(text)); }

    chatLog(state) {
        return this._record('chatLog', JSON.stringify(state || {}), { lines: formatWerewolfPublicChatLog(state) });
    }
    voteHistory(state) {
        return this._record('voteHistory', JSON.stringify(state || {}), { lines: formatWerewolfVoteHistory(state) });
    }
    records(state) {
        return this._record('records', JSON.stringify(state || {}), { messages: buildWerewolfPublicRecordMessages(state) });
    }
    tally(votes) {
        const targetSeat = resolveWerewolfVoteTarget(votes);
        return this._record('tally', JSON.stringify(votes || []), { targetSeat });
    }
    voteFallback(players, userVote) {
        const targetSeat = fallbackWerewolfVoteTarget(players, userVote);
        return this._record('voteFallback', JSON.stringify({ players, userVote }), { targetSeat });
    }
    stateMessage(context) {
        return this._record('stateMessage', JSON.stringify(context || {}), { text: formatWerewolfPublicStateMessage(context) });
    }
    logMessage(context) {
        return this._record('logMessage', JSON.stringify(context || {}), { text: formatWerewolfPublicLogMessage(context) });
    }
    speechTask(context) {
        return this._record('speechTask', JSON.stringify(context || {}), { text: formatWerewolfSpeechTaskMessage(context) });
    }
    fallbackPlayers(emptySeats, generated) {
        return this._record('fallbackPlayers', JSON.stringify({ emptySeats, generated }), {
            players: buildWerewolfFallbackPlayers(emptySeats, generated)
        });
    }

    destroy() { this._view = null; }
}

export {
    parseUndercoverDealerResult, parseUndercoverSpeech, parseUndercoverVotes, formatUndercoverPublicLog,
    parseWerewolfMatch, parseWerewolfSpeech, parseWerewolfLastWords,
    parseWerewolfNightDecision, parseWerewolfVoteDecision, werewolfNightActors,
    formatWerewolfPublicChatLog, formatWerewolfVoteHistory,
    resolveWerewolfVoteTarget, fallbackWerewolfVoteTarget,
    formatWerewolfPublicStateMessage, formatWerewolfPublicLogMessage, formatWerewolfSpeechTaskMessage,
    buildWerewolfFallbackPlayers, buildWerewolfPublicRecordMessages
};
export default GamesProtocolApp;