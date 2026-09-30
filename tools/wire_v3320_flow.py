# -*- coding: utf-8 -*-
"""v3.32.0 编排层：海龟汤 / 你说我猜 的 AI 调用、回合驱动、分享。
   源脚本是「宿主页 + fetch(state.apiConfig)」，这里改为本仓的 apiManager.callAI 通道。"""
import io
import sys

R = '/home/user/ruby-phone/'
APP = R + 'apps/games/games-app.js'

BLOCK = r'''
    // ====================================================================
    // [v3.32.0] 两个「对话型对局」的编排层（海龟汤 / 你说我猜）
    //   源侧形态是宿主页里 fetch(state.apiConfig)，本仓统一走 apiManager.callAI，
    //   与其他游戏同一条通道（可被预设、可被中断、记账口径一致）。
    // ====================================================================

    /** 从模型回复里取第一个平衡的 JSON 对象；取不到就返回 null（不猜、不编） */
    _extractDialogGameJson(text = '') {
        const raw = String(text || '').replace(/```json/gi, '').replace(/```/g, '');
        const start = raw.indexOf('{');
        if (start < 0) return null;
        let depth = 0;
        let inStr = false;
        let escaped = false;
        for (let i = start; i < raw.length; i += 1) {
            const ch = raw[i];
            if (inStr) {
                if (escaped) escaped = false;
                else if (ch === '\\') escaped = true;
                else if (ch === '"') inStr = false;
                continue;
            }
            if (ch === '"') { inStr = true; continue; }
            if (ch === '{') depth += 1;
            else if (ch === '}') {
                depth -= 1;
                if (depth === 0) {
                    try {
                        return JSON.parse(raw.slice(start, i + 1));
                    } catch (_error) {
                        return null;
                    }
                }
            }
        }
        return null;
    }

    async _callDialogGameAi(messages = [], options = {}) {
        const apiManager = window.VirtualPhone?.apiManager;
        if (!apiManager?.callAI) throw new Error('API Manager 未初始化');
        await this._waitDialogGameApiCooldown();
        const result = await apiManager.callAI(messages, {
            ...options,
            appId: options.appId || 'games'
        });
        if (result?.aborted) throw new Error('已中断发送');
        const text = typeof result === 'string' ? result : (result?.text || result?.content || '');
        return String(text || '').trim();
    }

    // ---------------------------------------------------------------- 海龟汤

    getDefaultSeaTurtlePrompt() {
        return [
            '你现在是海龟汤的出题人，正在和一群玩家玩「是/否」问答推理。',
            '铁律：',
            '1. 只从你的角色人设出发说话，不出戏、不解释规则、不用 Emoji。',
            '2. 每轮只输出一个严格的 JSON 对象，不要任何额外文字或代码块标记。'
        ].join('\n');
    }

    async _generateSeaTurtleRiddle(provider, riddleType = '') {
        const typeText = riddleType ? `请出一个【${riddleType}】类型的` : '请出一个';
        const messages = [
            { role: 'system', content: this.getDefaultSeaTurtlePrompt() },
            {
                role: 'user',
                content: [
                    `你扮演的角色是「${provider.name}」，人设：${provider.persona || '（未填写）'}`,
                    `任务：${typeText}经典海龟汤谜题。`,
                    '优先挑选广为人知、逻辑严密的经典题；实在想不出才原创，原创也必须有唯一解。',
                    '谜面要能引发推理，谜底要能解释谜面的每一个反常点。',
                    '输出 JSON：{"riddle":"谜面","answer":"谜底"}'
                ].join('\n')
            }
        ];
        const text = await this._callDialogGameAi(messages);
        const parsed = this._extractDialogGameJson(text);
        if (!parsed?.riddle || !parsed?.answer) return null;
        return { riddle: String(parsed.riddle).trim(), answer: String(parsed.answer).trim() };
    }

    async startSeaTurtleRound({ providerIndex = -1 } = {}) {
        const data = this.seaTurtleData;
        const state = data.getState();
        const provider = state.players?.[providerIndex];
        if (!provider) return;
        if (provider.isUser) return;

        this.seaTurtleView.renderGame();
        try {
            const generated = await this._generateSeaTurtleRiddle(provider, state.riddleType);
            if (!generated) {
                this.phoneShell?.showNotification?.('海龟汤', 'AI 出题失败，可以换个出题人再试', '🐢');
                data.reset();
                this.seaTurtleView.renderSetup();
                return;
            }
            if (!data.startGame({ providerIndex, riddle: generated.riddle, answer: generated.answer })) return;
            this.seaTurtleView.renderGame();
            await this.driveSeaTurtleAiTurns();
        } catch (error) {
            console.warn('[SeaTurtle] 出题失败:', error);
            this.phoneShell?.showNotification?.('海龟汤', 'AI 出题失败，请检查模型设置', '🐢');
            data.reset();
            this.seaTurtleView.renderSetup();
        }
    }

    async _seaTurtleJudge(question = '', askerName = '') {
        const data = this.seaTurtleData;
        const state = data.getState();
        const provider = data.getProvider();
        if (!provider || provider.isUser) return null;
        const recent = data.getRecentQuestions(5);
        const stuck = data.isStuck();
        const messages = [
            { role: 'system', content: this.getDefaultSeaTurtlePrompt() },
            {
                role: 'user',
                content: [
                    `你扮演的角色是「${provider.name}」，人设：${provider.persona || '（未填写）'}`,
                    `谜面：${state.riddle}`,
                    `谜底（只有你知道）：${state.answer}`,
                    '',
                    `玩家「${askerName}」问：${question}`,
                    '',
                    '先给判定，再用一句符合你人设的补充说明。',
                    'judgement 只能取：是 / 否 / 无关 / 部分是。',
                    'remark：以你角色的口吻说话（可以调侃、可以卖关子），不要复述谜底。',
                    stuck ? '注意：最近几问大多是「无关」，玩家可能卡住了 —— 这一句必须给出一个方向性的提示。' : '',
                    '输出 JSON：{"judgement":"","remark":""}'
                ].filter(line => line !== '').join('\n')
            }
        ];
        const text = await this._callDialogGameAi(messages);
        const parsed = this._extractDialogGameJson(text);
        if (!parsed) return { judgement: '无关', remark: '' };
        return {
            judgement: String(parsed.judgement || '无关').trim(),
            remark: String(parsed.remark || '').trim()
        };
    }

    async _seaTurtleEvaluateGuess(guess = '') {
        const data = this.seaTurtleData;
        const state = data.getState();
        const provider = data.getProvider();
        if (!provider || provider.isUser) return false;
        const messages = [
            { role: 'system', content: this.getDefaultSeaTurtlePrompt() },
            {
                role: 'user',
                content: [
                    `谜底：${state.answer}`,
                    `有人猜：${guess}`,
                    '只要核心情节、人物关系、关键道具与结果都一致就算对，不要求逐字相同。',
                    '输出 JSON：{"isCorrect":true} 或 {"isCorrect":false}'
                ].join('\n')
            }
        ];
        const text = await this._callDialogGameAi(messages);
        const parsed = this._extractDialogGameJson(text);
        return parsed?.isCorrect === true;
    }

    async _seaTurtleAiAction(player = null) {
        const data = this.seaTurtleData;
        const state = data.getState();
        const logText = (state.log || [])
            .filter(entry => entry.type !== 'system')
            .slice(-15)
            .map(entry => `${entry.speakerName || '出题人'}: ${entry.text}`)
            .join('\n');
        const messages = [
            { role: 'system', content: this.getDefaultSeaTurtlePrompt() },
            {
                role: 'user',
                content: [
                    `你扮演的角色是「${player?.name || '玩家'}」，人设：${player?.persona || '（未填写）'}`,
                    `你是猜谜的人，不知道谜底。谜面：${state.riddle}`,
                    '',
                    '已知线索：',
                    logText || '（还没有线索）',
                    '',
                    '要求：',
                    '1. 必须基于上面的线索推理，不要重复别人问过的问题。',
                    '2. 发言要符合你的人设口吻，可以带一点思考过程。',
                    '3. 线索够了就大胆直接猜谜底；来回超过 30 条时优先猜谜底。',
                    '4. 不用 Emoji。',
                    '输出 JSON：{"type":"question","content":"要问的问题"} 或 {"type":"guess","content":"你猜的完整故事"}'
                ].filter(line => line !== '').join('\n')
            }
        ];
        const text = await this._callDialogGameAi(messages);
        const parsed = this._extractDialogGameJson(text);
        if (!parsed?.type) return { type: 'question', content: '这个和「人」有关吗？' };
        return {
            type: parsed.type === 'guess' ? 'guess' : 'question',
            content: String(parsed.content || '').trim()
        };
    }

    async driveSeaTurtleAiTurns() {
        if (this._seaTurtleDriving) return;
        const data = this.seaTurtleData;
        if (data.getState().phase !== 'guessing') return;
        this._seaTurtleDriving = true;
        try {
            const guessers = data.getGuessers().filter(player => !player.isUser);
            for (const guesser of guessers) {
                if (data.getState().phase !== 'guessing') break;
                await new Promise(resolve => setTimeout(resolve, SEATURTLE_AI_STEP_DELAY_MS));
                const action = await this._seaTurtleAiAction(guesser);
                if (action.type === 'question') {
                    data.addQuestion({ question: action.content, player: guesser });
                    this.seaTurtleView.renderGame();
                    const provider = data.getProvider();
                    if (provider && !provider.isUser) {
                        await new Promise(resolve => setTimeout(resolve, SEATURTLE_AI_STEP_DELAY_MS));
                        const verdict = await this._seaTurtleJudge(action.content, guesser.name);
                        if (verdict) data.addAnswer({ judgement: verdict.judgement, remark: verdict.remark, player: provider });
                    }
                } else {
                    data.addGuess({ guess: action.content, player: guesser });
                    this.seaTurtleView.renderGame();
                    const provider = data.getProvider();
                    const correct = provider && !provider.isUser
                        ? await this._seaTurtleEvaluateGuess(action.content)
                        : false;
                    if (correct) {
                        data.addVerdict({ correct: true, guesserName: guesser.name });
                        data.reveal();
                        this.seaTurtleView.renderGame();
                        return;
                    }
                    data.addVerdict({ correct: false });
                }
                this.seaTurtleView.renderGame();
            }
        } catch (error) {
            console.warn('[SeaTurtle] AI 回合中断:', error);
        } finally {
            this._seaTurtleDriving = false;
            this.seaTurtleView.renderGame();
        }
    }

    async askSeaTurtle({ question = '' } = {}) {
        const data = this.seaTurtleData;
        if (data.getState().phase !== 'guessing') return;
        const asker = data.getUserPlayer();
        data.addQuestion({ question, player: asker });
        this.seaTurtleView.renderGame();
        const verdict = await this._seaTurtleJudge(question, asker?.name || '我');
        if (verdict) data.addAnswer({ judgement: verdict.judgement, remark: verdict.remark, player: data.getProvider() });
        this.seaTurtleView.renderGame();
        await this.driveSeaTurtleAiTurns();
    }

    async guessSeaTurtle({ guess = '' } = {}) {
        const data = this.seaTurtleData;
        if (data.getState().phase !== 'guessing') return;
        const guesser = data.getUserPlayer();
        data.addGuess({ guess, player: guesser });
        this.seaTurtleView.renderGame();
        const correct = await this._seaTurtleEvaluateGuess(guess);
        if (correct) {
            data.addVerdict({ correct: true, guesserName: guesser?.name || '我' });
            data.reveal();
            this.seaTurtleView.renderGame();
            return;
        }
        data.addVerdict({ correct: false });
        this.seaTurtleView.renderGame();
        await this.driveSeaTurtleAiTurns();
    }

    /** 重 roll：撤掉最后一次用户发言之后的所有 AI 行动，再走一遍 */
    async rerollSeaTurtleTurn() {
        const data = this.seaTurtleData;
        const state = data.getState();
        if (state.phase !== 'guessing') return;
        const log = state.log || [];
        let lastUserIndex = -1;
        for (let i = log.length - 1; i >= 0; i -= 1) {
            const entry = log[i];
            if (entry.type !== 'system' && !entry.speakerId?.startsWith('ai:')) {
                const speaker = (state.players || []).find(player => player.id === entry.speakerId);
                if (speaker?.isUser) { lastUserIndex = i; break; }
            }
        }
        if (lastUserIndex < 0) {
            this.phoneShell?.showNotification?.('海龟汤', '还没有你的发言，没法重来这一轮', '🐢');
            return;
        }
        log.splice(lastUserIndex + 1);
        this.seaTurtleView.renderGame();
        await this.driveSeaTurtleAiTurns();
    }

    stopSeaTurtleFlow() {
        this._seaTurtleDriving = false;
    }

    async shareSeaTurtleSummary(targetIds = []) {
        const data = this.seaTurtleData;
        const summary = data.getSummary();
        const wechatData = this.getWechatData?.();
        if (!wechatData?.addMessage) {
            this.phoneShell?.showNotification?.('海龟汤', '微信数据未就绪，暂时无法分享', '🐢');
            return;
        }
        let sent = 0;
        for (const id of targetIds) {
            const player = (data.getState().players || []).find(item => item.id === id);
            if (!player) continue;
            let chat = (wechatData.getChatList?.() || []).find(item => String(item?.name || '').trim() === player.name);
            if (!chat) chat = wechatData.createChat?.({ name: player.name, type: 'single', avatar: player.avatar || '' });
            if (!chat) continue;
            wechatData.addMessage(chat.id, {
                from: 'me',
                type: 'text',
                content: `【海龟汤复盘】\n${summary}`
            });
            sent += 1;
        }
        wechatData.saveData?.();
        this.phoneShell?.showNotification?.('海龟汤', sent ? `复盘已发给 ${sent} 位` : '没有可发送的对象', '🐢');
    }

    // ---------------------------------------------------------------- 你说我猜

    getDefaultGuessWhatPrompt() {
        return [
            '你在玩「你说我猜」：一方想一个词并给提示，另一方来猜。',
            '铁律：',
            '1. 全程用你的角色人设说话，不出戏、不解释规则、不用 Emoji。',
            '2. 每轮只输出一个严格的 JSON 对象，不要额外文字或代码块标记。'
        ].join('\n');
    }

    async _guessWhatAi(action = '', payload = '') {
        const data = this.guessWhatData;
        const state = data.getState();
        const opponent = state.opponent || {};
        const persona = `你扮演的角色是「${opponent.name || 'Ta'}」，人设：${opponent.persona || '（未填写）'}`;
        const history = (state.log || []).map(entry => {
            if (entry.type === 'system') return `【系统】${entry.text}`;
            if (entry.type === 'user-turn') return `对方：${entry.text}`;
            return `你：${entry.text}`;
        }).join('\n');

        let task = '';
        if (action === 'generate_word') {
            task = [
                '任务：想一个日常好猜的具体名词（不要生僻词、不要专有名词）。',
                '再给一句一开始的提示：要能暗示它，但不能直接说破。',
                '输出 JSON：{"secretWord":"词语","firstHint":"第一句提示"}'
            ].join('\n');
        } else if (action === 'guess_word') {
            task = [
                `对方正在给你提示，让你猜一个词。对方刚说：${payload}`,
                '你可以：继续猜（type=guess），或者要求再给一点提示（type=hint）。',
                '觉得自己猜中了就直接给出那个词。',
                '输出 JSON：{"type":"guess","text":"你猜的词"} 或 {"type":"hint","text":"你想让对方再提示的方向"}'
            ].join('\n');
        } else {
            task = [
                `对方刚猜了：${payload}`,
                '如果你觉得对方猜中了（意思对上即可），判定游戏结束。',
                '否则给下一句提示：比上一句更具体一点，但不能直接说出词语本身。',
                '输出 JSON：{"type":"hint","text":"下一句提示"} 或 {"type":"game_over","winner":"user","reason":"一句收尾"}'
            ].join('\n');
        }

        const messages = [
            { role: 'system', content: this.getDefaultGuessWhatPrompt() },
            {
                role: 'user',
                content: [
                    persona,
                    `玩法：${data.getModeInfo().label}`,
                    payload && action === 'generate_word' ? '' : `答案：${state.secretWord}`,
                    '',
                    '对局记录：',
                    history || '（刚开始）',
                    '',
                    task
                ].filter(line => line !== '').join('\n')
            }
        ];
        const text = await this._callDialogGameAi(messages);
        return this._extractDialogGameJson(text);
    }

    async startGuessWhatGame({ mode = 'ai_guesses', opponent = null, secretWord = '' } = {}) {
        const data = this.guessWhatData;
        if (mode === 'user_guesses') {
            try {
                const generated = await this._guessWhatAi('generate_word');
                if (!generated?.secretWord) {
                    this.phoneShell?.showNotification?.('你说我猜', 'AI 想不出题，稍后再试', '💬');
                    return;
                }
                if (!data.startGame({ mode, opponent, secretWord: generated.secretWord })) return;
                if (generated.firstHint) {
                    data.addAiTurn({ text: `【${opponent?.name || 'Ta'}托着下巴想了想】第一个提示…${generated.firstHint}`, player: opponent, kind: 'hint' });
                }
            } catch (error) {
                console.warn('[GuessWhat] 出题失败:', error);
                this.phoneShell?.showNotification?.('你说我猜', 'AI 出题失败，请检查模型设置', '💬');
                return;
            }
        } else if (!data.startGame({ mode, opponent, secretWord })) {
            return;
        }
        this.currentView = 'guesswhat';
        this.guessWhatView.renderGame();
    }

    async sendGuessWhatTurn(text = '') {
        const data = this.guessWhatData;
        const state = data.getState();
        if (state.phase !== 'playing') return;
        const opponent = state.opponent || {};
        data.addUserTurn({ text, isUser: true });
        this.guessWhatView.renderGame();

        if (data.isRoundLimitReached()) {
            data.endGame({ winner: '', reason: `${GUESS_MAX_ROUNDS} 轮都没猜中` });
            this.guessWhatView.renderGame();
            return;
        }

        try {
            if (data.isAiGuessing()) {
                const response = await this._guessWhatAi('guess_word', text);
                const kind = response?.type === 'hint' ? 'hint' : 'guess';
                const content = String(response?.text || '').trim() || '嗯……再给我一点线索？';
                data.addAiTurn({ text: content, player: opponent, kind });
                this.guessWhatView.renderGame();
                if (kind === 'guess' && isGuessHit(content, state.secretWord)) {
                    data.endGame({ winner: 'ai', reason: `猜到了「${state.secretWord}」` });
                }
            } else {
                if (isGuessHit(text, state.secretWord)) {
                    data.addAiTurn({ text: `对，就是【${state.secretWord}】！`, player: opponent, kind: 'hint' });
                    data.endGame({ winner: 'user', reason: '一次就中' });
                } else {
                    const response = await this._guessWhatAi('give_hint', text);
                    if (response?.type === 'game_over') {
                        data.addAiTurn({ text: String(response.reason || '被你猜到了！'), player: opponent, kind: 'hint' });
                        data.endGame({ winner: 'user', reason: String(response.reason || '') });
                    } else {
                        const hint = String(response?.text || '').trim() || '再想想？它和日常生活有关。';
                        data.addAiTurn({ text: hint, player: opponent, kind: 'hint' });
                    }
                }
            }
        } catch (error) {
            console.warn('[GuessWhat] AI 回合失败:', error);
            data.addSystem('（Ta 好像走神了，再说一次试试）');
        }
        this.guessWhatView.renderGame();
    }

    /** 重 roll：撤回最后一组「用户发言 + AI 回应」，用原话再走一遍 */
    async rerollGuessWhatTurn() {
        const data = this.guessWhatData;
        const original = data.rewindLastAiTurn();
        if (original === null) {
            this.phoneShell?.showNotification?.('你说我猜', '这一轮没法重来', '💬');
            return;
        }
        this.guessWhatView.renderGame();
        const state = data.getState();
        if (state.phase !== 'playing') {
            data.state.phase = 'playing';
            data.state.winner = '';
            data.state.reason = '';
        }
        await this.sendGuessWhatTurn(original);
    }

    stopGuessWhatFlow() {
        this._guessWhatSending = false;
    }

    async shareGuessWhatSummary() {
        const data = this.guessWhatData;
        const opponent = data.getState().opponent || {};
        const summary = data.getSummary();
        const wechatData = this.getWechatData?.();
        if (!wechatData?.addMessage || !opponent.name) {
            this.phoneShell?.showNotification?.('你说我猜', '微信数据未就绪，暂时无法分享', '💬');
            return;
        }
        let chat = (wechatData.getChatList?.() || []).find(item => String(item?.name || '').trim() === opponent.name);
        if (!chat) chat = wechatData.createChat?.({ name: opponent.name, type: 'single', avatar: opponent.avatar || '' });
        if (!chat) {
            this.phoneShell?.showNotification?.('你说我猜', '没找到对应的聊天', '💬');
            return;
        }
        wechatData.addMessage(chat.id, {
            from: 'me',
            type: 'text',
            content: `【你说我猜复盘】\n${summary}`
        });
        wechatData.saveData?.();
        this.phoneShell?.showNotification?.('你说我猜', '复盘已发出', '💬');
    }

'''

s = io.open(APP, encoding='utf-8').read()
anchor = "    handleSwipeBack() {\n"
assert s.count(anchor) == 1, '锚点 handleSwipeBack 命中 %d 次' % s.count(anchor)

# 补两个 import（isGuessHit / GUESS_MAX_ROUNDS）
imp_old = "import { GuessWhatData } from './guesswhat/guesswhat-data.js';\n"
assert s.count(imp_old) == 1
imp_new = "import { GuessWhatData, isGuessHit, GUESS_MAX_ROUNDS } from './guesswhat/guesswhat-data.js';\n"

out = s.replace(imp_old, imp_new).replace(anchor, BLOCK + anchor, 1)
assert out != s

if '--write' in sys.argv:
    io.open(APP, 'w', encoding='utf-8').write(out)
    print('games-app.js written:', len(out), 'bytes')
else:
    print('dry-run ok, +%d bytes' % (len(out) - len(s)))