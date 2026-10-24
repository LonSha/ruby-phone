/**
 * config/interaction-advisor.js - 反极化交互行为解读辅助 (Interaction Advisor)
 * 
 * 机制借鉴与超越：
 * 吸收瑟瑟台账 V1.165 人物性格偏移表的反极化 (Anti-Polarization) 与防过度解读原则。
 * 遵循“行为 = 含义 | 不要理解为 xxx”的防臆测标准，
 * 在手机端为玩家提供角色行为、神态与台词背后的真实心理防御机制分析，
 * 避免用户将角色的暂时沉默理解为冷漠、将关切理解为沦陷、将疏离理解为背叛。
 */

const DEFAULT_INTERPRETATION_RULES = [
    {
        pattern: /沉默|不说话|欲言又止/i,
        meaning: '正在消化关键信息或整理情绪',
        avoid: '冷漠、嫌弃或蓄意隐瞒'
    },
    {
        pattern: /主动找话题|在干嘛|在做什么/i,
        meaning: '希望延长相处时间，感到安心',
        avoid: '过度粘人、失去自我或全面沦陷'
    },
    {
        pattern: /站得较远|保持距离/i,
        meaning: '下意识的习惯性防御机制正在起效',
        avoid: '讨厌、厌恶或排斥接触'
    },
    {
        pattern: /语气生硬|别过头/i,
        meaning: '害羞、别扭或不知所措的掩饰',
        avoid: '恶意攻击或故意找茬'
    }
];

export class InteractionAdvisor {
    constructor(customRules = []) {
        this.rules = [...DEFAULT_INTERPRETATION_RULES, ...customRules];
    }

    /**
     * 针对给定的角色动作或文本片段生成反极化解读建议
     * @param {string} observedBehavior - 观察到的角色行为/文本
     * @returns {Object} { matched: boolean, adviceList: Array }
     */
    analyzeBehavior(observedBehavior = '') {
        if (!observedBehavior || typeof observedBehavior !== 'string') {
            return { matched: false, adviceList: [] };
        }

        const hits = [];
        for (const rule of this.rules) {
            if (rule.pattern.test(observedBehavior)) {
                hits.push({
                    meaning: rule.meaning,
                    avoid: rule.avoid,
                    statement: `【心理建议】该行为倾向于「${rule.meaning}」，切勿片面解读为「${rule.avoid}」。`
                });
            }
        }

        return {
            matched: hits.length > 0,
            adviceList: hits
        };
    }

    /**
     * 构建规范化性格偏移条目
     * @param {string} behavior 
     * @param {string} meaning 
     * @param {string} avoidReadingAs 
     * @returns {string} 符合台账标准规范的单行条目
     */
    formatShiftStatement(behavior, meaning, avoidReadingAs) {
        return `${behavior.trim()} = ${meaning.trim()} | 不要理解为${avoidReadingAs.trim()}`;
    }
}