/* ========================================================
 * config/haptic-predictive-ime.js
 * RubyPhone R10-O9 · 全键盘触感回馈与多语言输入法联想引擎
 * 
 * 核心机制：
 * 1. 拟真按键触感震动模式 (Haptic Feedback Patterns):
 *    - LIGHT (20ms 轻触 / 字母按键), MEDIUM (40ms 功能键), HEAVY (60ms 退格/长按)
 * 2. 上下文预测与关联候选词 (Contextual Predictive Candidates):
 *    - 依据前缀拼音、前序词与对话语境推荐 3~5 个高频候选词
 *    - 支持网络热词与角色专属昵称优先注入
 * 3. 智能表情包联想匹配 (Emoji & Sticker Auto-Suggestion):
 *    - 检测特定情绪词（开心、难过、生气、爱、吃）自动匹配快捷 emoji
 * ======================================================== */

export const HAPTIC_TYPES = Object.freeze({
    LIGHT: 'LIGHT',
    MEDIUM: 'MEDIUM',
    HEAVY: 'HEAVY',
    NONE: 'NONE'
});

export class HapticPredictiveIme {
    constructor(opts = {}) {
        this.hapticEnabled = opts.hapticEnabled !== false;
        this.lexicon = new Map(); // prefix/token -> Array<string>
        this._initDefaultLexicon();
    }

    _initDefaultLexicon() {
        const base = {
            'ni': ['你', '你好', '你在干嘛', '你们'],
            'wo': ['我', '我们', '我在家', '我觉得'],
            'ta': ['他', '她', '它', '他们'],
            'xi': ['喜欢', '希望', '洗澡', '西瓜'],
            'ai': ['爱', '哎呀', '爱情'],
            'ming': ['明天', '明白', '名字'],
            'wan': ['晚安', '晚上', '玩游戏', '完成了']
        };
        for (const [k, v] of Object.entries(base)) {
            this.lexicon.set(k, v);
        }
    }

    /**
     * 触发按键触感
     * @param {string} key 按键字符
     * @returns {Object} 触感信号载荷
     */
    triggerKeyHaptic(key) {
        if (!this.hapticEnabled) return { type: HAPTIC_TYPES.NONE, durationMs: 0 };

        let type = HAPTIC_TYPES.LIGHT;
        let durationMs = 20;

        if (key === 'BACKSPACE' || key === 'DELETE') {
            type = HAPTIC_TYPES.HEAVY;
            durationMs = 50;
        } else if (key === 'ENTER' || key === 'SPACE' || key === 'SHIFT') {
            type = HAPTIC_TYPES.MEDIUM;
            durationMs = 35;
        }

        return { key, type, durationMs };
    }

    /**
     * 根据当前拼音输入与上下文获取预测联想词
     * @param {string} pinyinInput 
     * @param {string} [contextText] 
     * @returns {Array<string>} 候选词数组
     */
    getPredictions(pinyinInput, contextText = '') {
        const py = String(pinyinInput || '').toLowerCase().trim();
        if (!py) return [];

        const direct = this.lexicon.get(py) || [];
        const results = [...direct];

        // 情绪与表情联想
        const combined = contextText + ' ' + py;
        if (/开心|哈哈|高兴|xi/.test(combined)) results.push('😊', '🎉');
        if (/难过|伤心|哭|累/.test(combined)) results.push('🥺', '💔');
        if (/喜欢|爱|ai/.test(combined)) results.push('❤️', '🥰');
        if (/吃|奶茶|饭/.test(combined)) results.push('🧋', '🍰');

        return Array.from(new Set(results)).slice(0, 6);
    }

    /**
     * 动态学习高频输入新词
     * @param {string} pinyin 
     * @param {string} word 
     */
    learnWord(pinyin, word) {
        const py = String(pinyin).toLowerCase().trim();
        const w = String(word).trim();
        if (!py || !w) return;

        const list = this.lexicon.get(py) || [];
        const idx = list.indexOf(w);
        if (idx >= 0) list.splice(idx, 1);
        list.unshift(w); // 置顶高频
        this.lexicon.set(py, list);
    }
}