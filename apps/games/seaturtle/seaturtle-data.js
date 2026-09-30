/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  海龟汤 数据层
 * ======================================================== */

import { numOrNull } from '../../../config/num-gate.js';

const STORAGE_KEY = 'chat_games_seaturtle_state';

/** 出题人模式：交给 AI 随机 / 只从 AI 里抽 / 用户在座就轮到用户 */
export const TURTLE_PROVIDER_MODES = [
    { value: 'random', label: '随机抽' },
    { value: 'random_ai', label: '随机 AI' },
    { value: 'user', label: '我来出题' }
];

/** AI 出题时可指定的谜题类型（空串表示不限） */
export const TURTLE_RIDDLE_TYPES = [
    '',
    '本格推理',
    '变格推理',
    '恐怖',
    '温情',
    '悬疑',
    '都市怪谈'
];

/** 出题人对提问的四档判定 */
export const TURTLE_JUDGEMENTS = ['是', '否', '无关', '部分是'];

/** 日志上限，超出后丢最早的（保留首条系统日志） */
const MAX_LOG = 400;

export class SeaTurtleData {
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
            players: [],
            providerId: '',
            riddleType: '',
            providerMode: 'random',
            riddle: '',
            answer: '',
            log: [],
            guessCount: 0,
            questionCount: 0,
            endedAt: 0,
            updatedAt: 0
        };
    }

    _load() {
        const saved = this.storage?.get?.(STORAGE_KEY);
        if (!saved || typeof saved !== 'object') return this._empty();
        const base = this._empty();
        return {
            ...base,
            ...saved,
            players: Array.isArray(saved.players) ? saved.players.map(player => this._normalizePlayer(player)) : [],
            log: Array.isArray(saved.log) ? saved.log.filter(entry => entry && typeof entry === 'object') : [],
            guessCount: numOrNull(saved.guessCount) ?? 0,
            questionCount: numOrNull(saved.questionCount) ?? 0
        };
    }

    _normalizePlayer(player = {}) {
        return {
            id: String(player.id || ''),
            name: String(player.name || '').trim() || '玩家',
            avatar: String(player.avatar || ''),
            persona: String(player.persona || '').trim(),
            isUser: !!player.isUser,
            isProvider: !!player.isProvider
        };
    }

    _save() {
        this.state.updatedAt = Date.now();
        this.storage?.set?.(STORAGE_KEY, this.state);
    }

    // ---------------------------------------------------------------- 设置

    reset() {
        this.state = this._empty();
        this._save();
    }

    setProviderMode(mode = '') {
        const value = String(mode || '').trim();
        this.state.providerMode = TURTLE_PROVIDER_MODES.some(item => item.value === value) ? value : 'random';
        this._save();
    }

    setRiddleType(type = '') {
        this.state.riddleType = String(type || '').trim();
        this._save();
    }

    // ---------------------------------------------------------------- 开局

    /**
     * 组座。invited 里每人是 { id, name, avatar, persona, isUser }。
     * 座位打乱后由上层按 providerMode 指定出题人。
     */
    seatPlayers(players = []) {
        const seated = players.map(player => this._normalizePlayer(player)).filter(player => player.id);
        // 洗牌，让出题人不可预测
        for (let i = seated.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            const tmp = seated[i];
            seated[i] = seated[j];
            seated[j] = tmp;
        }
        this.state.players = seated;
        return seated;
    }

    pickProviderIndex(providerMode = this.state.providerMode) {
        const players = this.state.players || [];
        if (!players.length) return -1;
        const mode = String(providerMode || 'random');
        if (mode === 'user') {
            const idx = players.findIndex(player => player.isUser);
            if (idx >= 0) return idx;
        }
        if (mode === 'random_ai') {
            const aiIndices = players.map((player, index) => (!player.isUser ? index : -1)).filter(index => index >= 0);
            if (aiIndices.length) return aiIndices[Math.floor(Math.random() * aiIndices.length)];
            return -1;
        }
        return Math.floor(Math.random() * players.length);
    }

    startGame({ providerIndex = -1, riddle = '', answer = '' } = {}) {
        const players = this.state.players || [];
        const idx = numOrNull(providerIndex);
        const provider = idx !== null && players[idx] ? players[idx] : null;
        if (!provider) return false;
        if (!String(riddle || '').trim() || !String(answer || '').trim()) return false;

        players.forEach(player => {
            player.isProvider = player.id === provider.id;
        });
        this.state.providerId = provider.id;
        this.state.riddle = String(riddle).trim();
        this.state.answer = String(answer).trim();
        this.state.phase = 'guessing';
        this.state.guessCount = 0;
        this.state.questionCount = 0;
        this.state.endedAt = 0;
        this.state.log = [];

        this.addSystem(`游戏开始！出题人是 ${provider.name}。`);
        this.addSystem(`【谜面】\n${this.state.riddle}`);
        this._save();
        return true;
    }

    // ---------------------------------------------------------------- 日志

    _pushLog(entry = {}) {
        const log = this.state.log;
        log.push({
            type: String(entry.type || 'system'),
            text: String(entry.text || ''),
            speakerId: String(entry.speakerId || ''),
            speakerName: String(entry.speakerName || ''),
            speakerAvatar: String(entry.speakerAvatar || ''),
            at: Date.now()
        });
        if (log.length > MAX_LOG) {
            const overflow = log.length - MAX_LOG;
            log.splice(1, overflow);
        }
    }

    addSystem(text = '') {
        this._pushLog({ type: 'system', text });
        this._save();
    }

    addQuestion({ question = '', player = null } = {}) {
        this.state.questionCount += 1;
        this._pushLog({
            type: 'question',
            text: String(question || ''),
            speakerId: player?.id || '',
            speakerName: player?.name || '',
            speakerAvatar: player?.avatar || ''
        });
        this._save();
    }

    addAnswer({ judgement = '', remark = '', player = null } = {}) {
        const value = TURTLE_JUDGEMENTS.includes(judgement) ? judgement : '无关';
        this._pushLog({
            type: 'answer',
            text: value,
            speakerId: player?.id || '',
            speakerName: player?.name || '',
            speakerAvatar: player?.avatar || ''
        });
        if (String(remark || '').trim()) {
            this._pushLog({
                type: 'remark',
                text: String(remark).trim(),
                speakerId: player?.id || '',
                speakerName: player?.name || '',
                speakerAvatar: player?.avatar || ''
            });
        }
        this._save();
        return value;
    }

    addGuess({ guess = '', player = null } = {}) {
        this.state.guessCount += 1;
        this._pushLog({
            type: 'guess',
            text: String(guess || ''),
            speakerId: player?.id || '',
            speakerName: player?.name || '',
            speakerAvatar: player?.avatar || ''
        });
        this._save();
    }

    addVerdict({ correct = false, guesserName = '' } = {}) {
        this._pushLog({
            type: 'system',
            text: correct ? `${guesserName || '有人'}猜对了，游戏结束。` : '不对哦。'
        });
        this._save();
    }

    reveal() {
        this.state.phase = 'reveal';
        this.state.endedAt = Date.now();
        this._save();
    }

    // ---------------------------------------------------------------- 查询

    getProvider() {
        return (this.state.players || []).find(player => player.isProvider) || null;
    }

    getGuessers() {
        return (this.state.players || []).filter(player => !player.isProvider);
    }

    getUserPlayer() {
        return (this.state.players || []).find(player => player.isUser) || null;
    }

    canUserAsk() {
        return this.state.phase === 'guessing' && !!this.getUserPlayer() && !this.getProvider()?.isUser;
    }

    getRecentQuestions(limit = 5) {
        const bound = numOrNull(limit) ?? 5;
        return (this.state.log || [])
            .filter(entry => entry.type === 'question')
            .slice(-Math.max(0, bound))
            .map(entry => entry.text);
    }

    /** 最近的提问是否大多是「无关」——用来提示出题人该给方向了 */
    isStuck() {
        const answers = (this.state.log || []).filter(entry => entry.type === 'answer').slice(-8).map(entry => entry.text);
        if (answers.length < 5) return false;
        return answers.filter(text => text === '无关').length >= Math.ceil(answers.length * 0.75);
    }

    getSummary() {
        const provider = this.getProvider();
        return [
            '**海龟汤 · 复盘**',
            '',
            `**出题人:** ${provider?.name || '—'}`,
            `**在场:** ${(this.state.players || []).map(player => player.name).join(' / ') || '—'}`,
            `**提问次数:** ${this.state.questionCount} · **猜测次数:** ${this.state.guessCount}`,
            '',
            '**谜面:**',
            this.state.riddle || '—',
            '',
            '**谜底:**',
            this.state.answer || '—'
        ].join('\n');
    }
}
