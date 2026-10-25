/* ========================================================
 * config/mimic-comm-engine.js
 * RubyPhone R10-O1 · 微信多通道拟真通信引擎
 * 
 * 核心机制：
 * 1. 拟真打字生命周期状态机 (Typing Lifecycle):
 *    - IDLE -> TYPING_START -> TYPING_PAUSE -> COMPOSING -> SENT
 *    - 依据文本长度、情绪激动度自动计算拟真打字耗时（30~120ms/字）与顿挫停顿
 * 2. 真实语音条能量波形与时长拟真 (Waveform Voice Simulation):
 *    - 语音时长严格由字数推演为 1~60 秒
 *    - 生成 16~32 档归一化振幅数组 (0.1 ~ 1.0)，供前端 SVG/Canvas 渲染动态波形
 * 3. 拟真撤回与反悔剧情留痕 (Recall Traces & Regret Nuance):
 *    - 撤回动作并非粗暴删除，而是将原消息转变为带情绪痕迹的系统留痕
 *    - 支持推演撤回意图标签（CONFESSION_REGRET / SECRET_RETRACT / EMOTIONAL_OUTBURST）
 * ======================================================== */

export const TYPING_STATES = Object.freeze({
    IDLE: 'IDLE',
    TYPING_START: 'TYPING_START',
    TYPING_PAUSE: 'TYPING_PAUSE',
    COMPOSING: 'COMPOSING',
    SENT: 'SENT'
});

export const RECALL_NUANCES = Object.freeze({
    CONFESSION_REGRET: 'CONFESSION_REGRET',     // 告白反悔
    SECRET_RETRACT: 'SECRET_RETRACT',           // 涉密撤回
    EMOTIONAL_OUTBURST: 'EMOTIONAL_OUTBURST',   // 冲动撤回
    TYPO_CORRECTION: 'TYPO_CORRECTION'          // 错别字重发
});

export class MimicCommEngine {
    constructor(opts = {}) {
        this.baseWpm = opts.baseWpm || 60; // 每分钟字数
        this.jitterRatio = opts.jitterRatio || 0.25; // 拟真抖动系数
    }

    /**
     * 计算拟真打字耗时与状态序列
     * @param {string} text 待发送文本
     * @param {Object} [meta] 语气或情绪偏好
     * @returns {Object} 调度参数
     */
    planTypingSchedule(text, meta = {}) {
        const str = String(text || '').trim();
        const charCount = str.length;
        if (charCount === 0) {
            return { totalDurationMs: 0, steps: [{ state: TYPING_STATES.IDLE, durationMs: 0 }] };
        }

        // 基础打字耗时：单字约 60000 / (baseWpm * 2) ms
        const msPerChar = Math.max(30, Math.min(200, Math.round(60000 / (this.baseWpm * 2.5))));
        let totalMs = charCount * msPerChar;

        // 激动或犹豫调整
        if (meta.hesitant) totalMs *= 1.6;
        if (meta.agitated) totalMs *= 0.7;

        // 停顿断句（句号/感叹号处插入停顿）
        const pauseCount = (str.match(/[，。！？…\n]/g) || []).length;
        const pauseDurationMs = pauseCount * 450;
        const totalDurationMs = Math.round(totalMs + pauseDurationMs);

        const steps = [
            { state: TYPING_STATES.TYPING_START, durationMs: Math.round(totalMs * 0.4) },
            { state: pauseCount > 0 ? TYPING_STATES.TYPING_PAUSE : TYPING_STATES.COMPOSING, durationMs: pauseDurationMs },
            { state: TYPING_STATES.COMPOSING, durationMs: Math.round(totalMs * 0.6) },
            { state: TYPING_STATES.SENT, durationMs: 0 }
        ];

        return {
            charCount,
            totalDurationMs,
            steps,
            hasPause: pauseCount > 0
        };
    }

    /**
     * 合成拟真语音条波形与时长
     * @param {string} text 语音对应文本
     * @param {number} [targetDurationSec] 强制指定秒数
     * @returns {Object} 语音载荷
     */
    synthesizeVoiceWaveform(text, targetDurationSec = null) {
        const str = String(text || '').trim();
        const charCount = str.length;
        // 汉语正常语速约 3.5~4.5 字/秒
        let durationSec = targetDurationSec;
        if (typeof durationSec !== 'number' || durationSec <= 0) {
            durationSec = Math.max(1, Math.min(60, Math.round(charCount / 3.8)));
        }

        // 生成 24 个振幅柱 (0.1 ~ 1.0)
        const barCount = 24;
        const waveform = [];
        let seed = 0;
        for (let i = 0; i < str.length; i++) seed += str.charCodeAt(i);

        for (let i = 0; i < barCount; i++) {
            // 首尾稍低，中间波形起伏，带有伪随机伪规律
            const x = i / (barCount - 1);
            const envelope = Math.sin(Math.PI * x); // 包络曲线
            const pseudoNoise = ((Math.sin(seed * (i + 1) * 9301 + 49297) + 1) / 2) * 0.4 + 0.6;
            const amp = Math.max(0.12, Math.min(1.0, Number((envelope * pseudoNoise).toFixed(2))));
            waveform.push(amp);
        }

        return {
            type: 'VOICE_MESSAGE',
            durationSec,
            waveform,
            textLength: charCount,
            label: `${durationSec}"`
        };
    }

    /**
     * 拟真撤回与剧情反悔意图分析
     * @param {Object} message 原始消息
     * @param {string} actorName 角色名称
     * @returns {Object} 撤回留痕记录
     */
    generateRecallTrace(message, actorName = '对方') {
        const text = String(message?.text || message?.content || '').trim();
        let nuance = RECALL_NUANCES.TYPO_CORRECTION;
        let hint = `${actorName} 撤回了一条消息`;

        if (/喜欢|爱|在一起|抱|想你|亲/.test(text)) {
            nuance = RECALL_NUANCES.CONFESSION_REGRET;
            hint = `${actorName} 匆忙撤回了一条疑似告白的消息`;
        } else if (/秘密|密码|不要告诉|不能说|证据|计划/.test(text)) {
            nuance = RECALL_NUANCES.SECRET_RETRACT;
            hint = `${actorName} 警觉地撤回了一条涉密内容`;
        } else if (/滚|讨厌|烦死了|受够了|凭什么|疯了/.test(text)) {
            nuance = RECALL_NUANCES.EMOTIONAL_OUTBURST;
            hint = `${actorName} 情绪失控后撤回了一条冲动言论`;
        }

        return {
            id: 'recall_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            originalMessageId: message?.id || null,
            actorName,
            nuance,
            hint,
            recalledAt: Date.now(),
            censoredPreview: text.length > 2 ? text[0] + '***' + text[text.length - 1] : '***'
        };
    }
}
