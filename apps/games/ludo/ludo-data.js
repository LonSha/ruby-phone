/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  心动飞行棋 数据层
 * --------------------------------------------------------
 *  源侧（EPhone 游戏大厅）把棋盘、掷骰、问答全塞在一个
 *  `ludoGameState` 里，题库存 Dexie（`db.ludoQuestionBanks` / `db.ludoQuestions`）。
 *  本件只取**棋盘与回合规则**：42 格、起点 50% 出 6、到点必胜、
 *  踩对方踢回起点、掷 6 再行动、踩事件格触发问答。
 *  落本仓 PhoneStorage（键 `chat_games_ludo_state`）。
 * ======================================================== */

import { numOrNull } from '../../../config/num-gate.js';

const STORAGE_KEY = 'chat_games_ludo_state';

/** 棋盘总格数（源侧 `LUDO_BOARD_SIZE = 42`） */
export const LUDO_BOARD_SIZE = 42;

/** 终点格索引（源侧 `LUDO_BOARD_SIZE - 1`） */
export const LUDO_FINAL_INDEX = LUDO_BOARD_SIZE - 1;

/** 未起飞时的位置（源侧用 -1 表示棋子还在起点） */
export const LUDO_START_POSITION = -1;

/** 事件格（踩到就抽一道心心相印题） */
export const LUDO_EVENT_CELLS = [5, 9, 14, 18, 23, 27, 32, 36];

/** 题目两种模式：双方都答 / 一人答一人评 */
export const LUDO_QUESTION_TYPES = [
    { value: 'both_answer', label: '一起回答' },
    { value: 'single_answer', label: '一人答 · 一人评' }
];

/** 问答模式标签（唯一权威就是上面那张表：视图与编排层都来查它，不另写文案） */
export function ludoModeLabel(type = '') {
    const value = String(type || '');
    const hit = LUDO_QUESTION_TYPES.find(item => item.value === value);
    return hit ? hit.label : value;
}
/** AI 反应的事件词（与源侧同名，编排层按词取反应） */
export const LUDO_AI_EVENTS = [
    'roll_6',
    'kick_char',
    'kick_user',
    'char_win',
    'user_win',
    'answer_question',
    'evaluate_answer'
];

/**
 * 内建题库（原创；源侧 21 条在 `migrateDefaultLudoQuestions` 里，按缝合纪律：
 * 源数据一条不搬，本仓自带一份同形同机制的题库）。
 * 字段：type（both_answer / single_answer）/ text
 */
export const LUDO_BUILT_IN_QUESTIONS = [
    { type: 'both_answer', text: '如果明天可以放下一切出门一趟，你最想拉着我去哪儿？' },
    { type: 'both_answer', text: '你觉得两个人待在一起最舒服的状态是什么样子？' },
    { type: 'both_answer', text: '说一件最近因为我而心情变好的小事。' },
    { type: 'both_answer', text: '还记得我们第一次说话时的情形吗？你当时在想什么？' },
    { type: 'both_answer', text: '如果一起学一样新东西，你希望是什么，为什么？' },
    { type: 'both_answer', text: '描绘一个你最想和我一起过的周末。' },
    { type: 'both_answer', text: '你觉得我们之间最有默契的一次是什么时候？' },
    { type: 'both_answer', text: '如果用一种天气来形容我，你会选哪一种？' },
    { type: 'both_answer', text: '接下来一年里，你最想和我一起做成的一件事是什么？' },
    { type: 'both_answer', text: '最近有没有什么作品让你想第一时间推荐给我？' },
    { type: 'both_answer', text: '你最喜欢我说话的哪种语气？' },
    { type: 'single_answer', text: '说一个我最让你觉得意外的地方。' },
    { type: 'single_answer', text: '老实讲，我有没有哪件事让你偷偷不高兴过？' },
    { type: 'single_answer', text: '如果我能多一种本事，你希望是什么？' },
    { type: 'single_answer', text: '给我三个你觉得最合适的形容。' },
    { type: 'single_answer', text: '在你心里，我和你想的那种人多接近？' },
    { type: 'single_answer', text: '说一件我大概还不知道的、关于你的事。' },
    { type: 'single_answer', text: '如果我们的相处是一首歌，你想叫什么名字？' },
    { type: 'single_answer', text: '说一件你觉得我比你更拿手的事。' },
    { type: 'single_answer', text: '如果能回到我们认识的某一天，你会挑哪一天？' },
    { type: 'single_answer', text: '用三个词说说你眼里我们现在的关系。' }
];

/** 日志上限，超出后丢最早的（保留首条系统日志） */
const MAX_LOG = 300;

/** 该格是不是事件格 */
export function isLudoEventCell(index) {
    const value = numOrNull(index);
    if (value === null) return false;
    return LUDO_EVENT_CELLS.includes(value);
}

/**
 * 掷骰子（纯函数，rng 可注入以便判据钉住边界）。
 * 起点：50% 直接出 6（源侧口径，避免迟迟飞不起来），否则 1~5；
 * 起飞后：公平的 1~6。
 *
 * ★ 起点分支必须**取两次样**（源侧 `rollTheDice`：`if (Math.random() < 0.5) return 6;`
 *   然后 `Math.floor(Math.random() * 5) + 1`）。写成「一次取样两处复用」会让
 *   `Math.floor(draw * 5) + 1` 在 `draw >= 0.5` 时恒 ≥ 3 —— **1 与 2 永远掷不出来**，
 *   而且看不出错（骰子照转、只是点数范围窄了）。
 */
export function rollLudoDice(fromStart = false, rng = Math.random) {
    if (fromStart && Number(rng()) < 0.5) return 6;
    return Math.floor(Number(rng()) * (fromStart ? 5 : 6)) + 1;
}

/** 题库轮转器：从打乱后的顺序里依次取，取空再洗一轮（避免连续重复） */
export class LudoQuestionDeck {
    constructor(questions = LUDO_BUILT_IN_QUESTIONS, rng = Math.random) {
        this.questions = questions.map(item => ({
            type: String(item?.type || 'both_answer'),
            text: String(item?.text || '')
        })).filter(item => item.text);
        this.rng = rng;
        this._order = [];
        this._cursor = 0;
    }

    _reshuffle() {
        const order = this.questions.map((_, index) => index);
        for (let i = order.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Number(this.rng()) * (i + 1));
            const tmp = order[i];
            order[i] = order[j];
            order[j] = tmp;
        }
        this._order = order;
        this._cursor = 0;
    }

    next() {
        if (!this.questions.length) return null;
        if (this._cursor >= this._order.length) this._reshuffle();
        const index = this._order[this._cursor];
        this._cursor += 1;
        return this.questions[index] || null;
    }
}

export class LudoData {
    constructor(storage) {
        this.storage = storage;
        this.state = this._load();
        this.deck = new LudoQuestionDeck(LUDO_BUILT_IN_QUESTIONS);
    }

    getState() {
        return this.state;
    }

    _empty() {
        return {
            phase: 'setup',
            players: [],
            currentTurnIndex: 0,
            positions: {},
            log: [],
            questionCount: 0,
            pendingQuestion: null,
            winnerId: '',
            winnerName: '',
            startedAt: 0,
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
            positions: (saved.positions && typeof saved.positions === 'object') ? { ...saved.positions } : {},
            log: Array.isArray(saved.log) ? saved.log.filter(entry => entry && typeof entry === 'object') : [],
            questionCount: numOrNull(saved.questionCount) ?? 0,
            currentTurnIndex: numOrNull(saved.currentTurnIndex) ?? 0
        };
    }

    _normalizePlayer(player = {}) {
        return {
            id: String(player.id || ''),
            name: String(player.name || '').trim() || '玩家',
            avatar: String(player.avatar || ''),
            persona: String(player.persona || '').trim(),
            isUser: !!player.isUser
        };
    }

    _save() {
        this.state.updatedAt = Date.now();
        this.storage?.set?.(STORAGE_KEY, this.state);
    }

    // ---------------------------------------------------------------- 开局

    reset() {
        this.state = this._empty();
        this.deck = new LudoQuestionDeck(LUDO_BUILT_IN_QUESTIONS);
        this._save();
    }

    startGame({ userPlayer = null, opponent = null } = {}) {
        const user = this._normalizePlayer({ ...(userPlayer || {}), id: 'user', isUser: true });
        const other = this._normalizePlayer({ ...(opponent || {}), isUser: false });
        if (!other.id) return false;

        // 先手随机（源侧：`if (Math.random() > 0.5)`）
        const players = Math.random() > 0.5 ? [user, other] : [other, user];
        this.state.players = players;
        this.state.currentTurnIndex = 0;
        this.state.positions = {};
        players.forEach(player => {
            this.state.positions[player.id] = LUDO_START_POSITION;
        });
        this.state.log = [];
        this.state.questionCount = 0;
        this.state.pendingQuestion = null;
        this.state.winnerId = '';
        this.state.winnerName = '';
        this.state.phase = 'playing';
        this.state.startedAt = Date.now();
        this.state.endedAt = 0;

        this.addSystem(`游戏开始！先手是 ${players[0].name}。`);
        this.addSystem('掷出 6 点才能起飞，之后掷出 6 点可以再走一次。');
        this._save();
        return true;
    }

    // ---------------------------------------------------------------- 棋子

    positionOf(playerId = '') {
        const key = String(playerId || '');
        const value = numOrNull(this.state.positions[key]);
        return value ?? LUDO_START_POSITION;
    }

    isOnBoard(playerId = '') {
        return this.positionOf(playerId) >= 0;
    }

    getPlayerById(playerId = '') {
        const key = String(playerId || '');
        return (this.state.players || []).find(player => player.id === key) || null;
    }

    getOpponentOf(playerId = '') {
        const key = String(playerId || '');
        return (this.state.players || []).find(player => player.id !== key) || null;
    }

    getCurrentPlayer() {
        const players = this.state.players || [];
        if (!players.length) return null;
        const index = numOrNull(this.state.currentTurnIndex) ?? 0;
        return players[((index % players.length) + players.length) % players.length] || null;
    }

    getUserPlayer() {
        return (this.state.players || []).find(player => player.isUser) || null;
    }

    getAiPlayer() {
        return (this.state.players || []).find(player => !player.isUser) || null;
    }

    advanceTurn() {
        const count = (this.state.players || []).length;
        if (!count) return null;
        const index = numOrNull(this.state.currentTurnIndex) ?? 0;
        this.state.currentTurnIndex = (index + 1) % count;
        this._save();
        return this.getCurrentPlayer();
    }

    // ---------------------------------------------------------------- 移动

    /**
     * 应用一次掷骰结果（纯规则，不含随机）。
     * 返回 { type, dice, from, to, kicked, winner } —— type 取值：
     *   takeoff  掷到 6，从起点起飞到 0 格（可再行动一次）
     *   blocked  还在起点且没掷到 6，本回合作废
     *   win      新位置 >= 终点，直接停到终点格
     *   move     正常前进
     */
    applyRoll(playerId = '', dice = 0) {
        const key = String(playerId || '');
        const value = numOrNull(dice);
        if (!key || value === null || value < 1 || value > 6) return null;
        const from = this.positionOf(key);

        if (from === LUDO_START_POSITION) {
            if (value !== 6) return { type: 'blocked', dice: value, from, to: from, kicked: null, winner: null };
            this.state.positions[key] = 0;
            this._save();
            return { type: 'takeoff', dice: value, from, to: 0, kicked: null, winner: null };
        }

        const next = from + value;
        if (next >= LUDO_FINAL_INDEX) {
            this.state.positions[key] = LUDO_FINAL_INDEX;
            this.state.phase = 'ended';
            this.state.endedAt = Date.now();
            const player = this.getPlayerById(key);
            this.state.winnerId = key;
            this.state.winnerName = player?.name || '玩家';
            this._save();
            return {
                type: 'win',
                dice: value,
                from,
                to: LUDO_FINAL_INDEX,
                kicked: null,
                winner: this.state.winnerId
            };
        }

        this.state.positions[key] = next;
        // 踩到对方棋子：把对方送回起点
        const opponent = this.getOpponentOf(key);
        let kicked = null;
        if (opponent && this.positionOf(opponent.id) === next) {
            this.state.positions[opponent.id] = LUDO_START_POSITION;
            kicked = opponent.id;
        }
        this._save();
        return { type: 'move', dice: value, from, to: next, kicked, winner: null };
    }

    shouldRollAgain(dice = 0) {
        return numOrNull(dice) === 6 && this.state.phase === 'playing';
    }

    // ---------------------------------------------------------------- 问答

    /** 抽一道题（从题库轮转；落进 pendingQuestion 等双方答完） */
    drawQuestion() {
        const question = this.deck.next();
        if (!question) return null;
        this.state.pendingQuestion = { type: question.type, text: question.text, answers: [], awaiting: '', kind: 'answer' };
        this.state.questionCount += 1;
        this._save();
        return this.state.pendingQuestion;
    }

    clearQuestion() {
        this.state.pendingQuestion = null;
        this._save();
    }

    /** 就地把当前题目改成「带作答记录」的形态（抽题时补 answers/awaiting/kind） */
    updateQuestion(patch = {}) {
        const question = this.state.pendingQuestion;
        if (!question || typeof question !== 'object') return null;
        Object.keys(patch || {}).forEach(key => {
            question[key] = patch[key];
        });
        this._save();
        return question;
    }

    /** 追加一条作答记录（谁答的 / 答了什么 / 是回答还是评价） */
    pushQuestionAnswer(entry = {}) {
        const question = this.state.pendingQuestion;
        if (!question || typeof question !== 'object') return false;
        if (!Array.isArray(question.answers)) question.answers = [];
        question.answers.push({
            speakerId: String(entry.speakerId || ''),
            speaker: String(entry.speaker || ''),
            text: String(entry.text || ''),
            kind: String(entry.kind || 'answer')
        });
        this._save();
        return true;
    }

    /** 当前题目的作答进度（视图用它决定「该你答了」还是「等 Ta」） */
    questionAwaitingUser() {
        const question = this.state.pendingQuestion;
        return !!question && question.awaiting === 'user';
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

    addRoll(player = null, dice = 0) {
        this._pushLog({
            type: 'roll',
            text: `${player?.name || '玩家'} 掷出了 ${numOrNull(dice) ?? 0} 点`,
            speakerId: player?.id || '',
            speakerName: player?.name || '',
            speakerAvatar: player?.avatar || ''
        });
        this._save();
    }

    addSpeech(player = null, text = '', kind = 'answer') {
        this._pushLog({
            type: kind === 'evaluate' ? 'evaluate' : 'answer',
            text: String(text || ''),
            speakerId: player?.id || '',
            speakerName: player?.name || '',
            speakerAvatar: player?.avatar || ''
        });
        this._save();
    }

    // ---------------------------------------------------------------- 复盘

    /** 从日志里抽出「题目 + 每人回答」，供结算面板用 */
    collectInterview() {
        const groups = [];
        let current = null;
        (this.state.log || []).forEach(entry => {
            const text = String(entry.text || '');
            if (entry.type === 'system' && text.includes('抽到的问题是')) {
                const match = text.match(/“(.+?)”/);
                current = { question: match ? match[1] : '', answers: [] };
                groups.push(current);
                return;
            }
            if (!current) return;
            if (entry.type === 'answer' || entry.type === 'evaluate') {
                current.answers.push({
                    speaker: entry.speakerName || '',
                    text,
                    kind: entry.type
                });
            }
        });
        return groups;
    }

    getSummary(winnerName = '') {
        const user = this.getUserPlayer();
        const opponent = this.getAiPlayer();
        const winner = winnerName || this.state.winnerName || '—';
        return [
            '**心动飞行棋 · 复盘**',
            '',
            `**你:** ${user?.name || '我'} · 走了 ${Math.max(0, this.positionOf(user?.id || ''))} 步`,
            `**对方:** ${opponent?.name || '—'} · 走了 ${Math.max(0, this.positionOf(opponent?.id || ''))} 步`,
            `**胜者:** ${winner}`,
            `**抽到的问题:** ${this.state.questionCount} 道`
        ].join('\n');
    }
}