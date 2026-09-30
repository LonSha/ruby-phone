/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  你说我猜 数据层
 * ======================================================== */

import { numOrNull } from '../../../config/num-gate.js';

const STORAGE_KEY = 'chat_games_guesswhat_state';

/** ai_guesses：我出题、AI 猜；user_guesses：AI 出题、我猜 */
export const GUESS_MODES = [
    {
        value: 'ai_guesses',
        label: '我出题',
        desc: '你心里想一个词，给提示，让 Ta 猜',
        placeholder: '给出你的第一个提示…'
    },
    {
        value: 'user_guesses',
        label: 'Ta 出题',
        desc: 'Ta 想一个词，你看提示来猜',
        placeholder: '根据提示写下你的猜测…'
    }
];

/** 单局提示/猜测轮次上限：到顶判平局，避免无限来回 */
export const GUESS_MAX_ROUNDS = 20;

const MAX_LOG = 200;

export class GuessWhatData {
    constructor(storage) {
        this.storage = storage;
        this.state = this._load();
    }

    getState() {
        return this.state;
    }

    _empty() {
        return {
            phase: 'setup',
            mode: 'ai_guesses',
            opponent: null,
            secretWord: '',
            log: [],
            round: 0,
            winner: '',
            reason: '',
            endedAt: 0,
            updatedAt: 0
        };
    }

    _load() {
        const saved = this.storage?.get?.(STORAGE_KEY);
        if (!saved || typeof saved !== 'object') return this._empty();
        const base = this._empty();
        const mode = GUESS_MODES.some(item => item.value === saved.mode) ? saved.mode : 'ai_guesses';
        return {
            ...base,
            ...saved,
            mode,
            opponent: saved.opponent && typeof saved.opponent === 'object' ? { ...saved.opponent } : null,
            log: Array.isArray(saved.log) ? saved.log.filter(entry => entry && typeof entry === 'object') : [],
            round: numOrNull(saved.round) ?? 0
        };
    }

    _save() {
        this.state.updatedAt = Date.now();
        this.storage?.set?.(STORAGE_KEY, this.state);
    }

    reset() {
        this.state = this._empty();
        this._save();
    }

    setMode(mode = '') {
        const value = String(mode || '').trim();
        this.state.mode = GUESS_MODES.some(item => item.value === value) ? value : 'ai_guesses';
        this._save();
    }

    // ---------------------------------------------------------------- 开局

    startGame({ mode = 'ai_guesses', opponent = null, secretWord = '' } = {}) {
        const value = GUESS_MODES.some(item => item.value === mode) ? mode : 'ai_guesses';
        const word = String(secretWord || '').trim();
        /* ★ 先校验、再改状态：原写法先把 state 换成 playing 再判空返回 false ——
         *   失败却留下半截状态，下一帧渲染出来就是「已开局但没有答案」。
         *   （校验用入参而不是 state，避免为了判断先污染。） */
        if (!word) return false;
        this.state = this._empty();
        this.state.mode = value;
        this.state.opponent = opponent
            ? {
                id: String(opponent.id || ''),
                name: String(opponent.name || '').trim() || 'Ta',
                avatar: String(opponent.avatar || ''),
                persona: String(opponent.persona || '').trim()
            }
            : null;
        this.state.secretWord = word;
        this.state.phase = 'playing';
        this.state.log = [];

        if (value === 'ai_guesses') {
            this.addSystem('游戏开始！你来出题，给出第一个提示吧。');
        } else {
            this.addSystem(`游戏开始！${this.state.opponent?.name || 'Ta'} 已经想好了一个词。`);
        }
        this._save();
        return true;
    }

    // ---------------------------------------------------------------- 日志

    _pushLog(entry = {}) {
        const log = this.state.log;
        log.push({
            type: String(entry.type || 'system'),
            text: String(entry.text || ''),
            playerId: String(entry.playerId || ''),
            playerName: String(entry.playerName || ''),
            playerAvatar: String(entry.playerAvatar || ''),
            isUser: !!entry.isUser,
            at: Date.now()
        });
        if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG);
    }

    addSystem(text = '') {
        this._pushLog({ type: 'system', text });
        this._save();
    }

    addUserTurn({ text = '', isUser = true, player = null } = {}) {
        this._pushLog({
            type: 'user-turn',
            text: String(text || ''),
            isUser,
            playerId: player?.id || (isUser ? 'user' : ''),
            playerName: player?.name || (isUser ? '我' : ''),
            playerAvatar: player?.avatar || ''
        });
        this._save();
    }

    addAiTurn({ text = '', player = null, kind = 'hint' } = {}) {
        this.state.round += 1;
        this._pushLog({
            type: 'ai-turn',
            text: String(text || ''),
            kind,
            playerId: player?.id || '',
            playerName: player?.name || '',
            playerAvatar: player?.avatar || ''
        });
        this._save();
    }

    /** 撤回最后一个「用户回合 + 随之的 AI 回合」，返回被撤回的用户输入 */
    rewindLastAiTurn() {
        const log = this.state.log;
        let aiIndex = -1;
        for (let i = log.length - 1; i >= 0; i -= 1) {
            if (log[i].type === 'ai-turn') {
                aiIndex = i;
                break;
            }
        }
        if (aiIndex < 1) return null;
        const userIndex = aiIndex - 1;
        if (log[userIndex]?.type !== 'user-turn') return null;
        const original = log[userIndex].text;
        log.splice(userIndex, 2);
        this.state.round = Math.max(0, this.state.round - 1);
        this._save();
        return original;
    }

    endGame({ winner = '', reason = '' } = {}) {
        this.state.phase = 'ended';
        this.state.winner = String(winner || '');
        this.state.reason = String(reason || '');
        this.state.endedAt = Date.now();
        this._save();
    }

    // ---------------------------------------------------------------- 查询

    isAiGuessing() {
        return this.state.mode === 'ai_guesses';
    }

    isPlaying() {
        return this.state.phase === 'playing';
    }

    isRoundLimitReached() {
        return this.state.round >= GUESS_MAX_ROUNDS;
    }

    getUserTurnLabel() {
        return this.isAiGuessing() ? '你的提示' : '你的猜测';
    }

    getModeInfo() {
        const value = this.state.mode;
        return GUESS_MODES.find(item => item.value === value) || GUESS_MODES[0];
    }

    getSummary() {
        const opponent = this.state.opponent || {};
        const winnerText = this.state.winner === 'user'
            ? '你赢了'
            : (this.state.winner === 'ai' ? `${opponent.name || 'Ta'} 赢了` : '平局');
        return [
            '**你说我猜 · 复盘**',
            '',
            `**对手:** ${opponent.name || '—'}`,
            `**玩法:** ${this.getModeInfo().label}`,
            `**答案:** ${this.state.secretWord || '—'}`,
            `**结果:** ${winnerText}`,
            this.state.reason ? `**收尾:** ${this.state.reason}` : '',
            `**来回轮次:** ${this.state.round}`
        ].filter(line => line !== '').join('\n');
    }
}

/** 宽松匹配：忽略大小写与空白，互为子串即算中（对标源里的 isGuessCorrect） */
export function isGuessHit(guess = '', answer = '') {
    const a = String(guess || '').toLowerCase().replace(/\s+/g, '');
    const b = String(answer || '').toLowerCase().replace(/\s+/g, '');
    if (!a || !b) return false;
    return a.includes(b) || b.includes(a);
}