/**
 * 手机日常全息操作向 LonSha 记忆心智因果双向反哺闭环 (RubyPhone LonSha Bi-directional Feedback Hub)
 * 实时捕获手机通讯录备注修改、账单支付、相册拍照、暗网委托等日常行为
 * 转化为结构化因果记忆事件，即刻推送到 LonSha 记忆库，驱动角色在接下来的对话中产生即时娇嗔或反应
 */
export class RubyPhoneLonShaBidirectionalFeedbackHub {
    constructor(lonshaBridgeInstance = null) {
        this.bridge = lonshaBridgeInstance;
        this.feedbackEvents = [];
    }

    /**
     * 捕获通讯录角色备注修改事件并反哺记忆
     */
    onContactRemarkChanged(characterName, oldRemark, newRemark) {
        const event = {
            id: 'fb_contact_' + Date.now(),
            sourceApp: 'CONTACTS',
            type: 'REMARK_MUTATION',
            characterName,
            oldRemark,
            newRemark,
            synthesizedFact: `玩家在手机通讯录中将「${characterName}」的备注从「${oldRemark || '无'}」修改为了「${newRemark}」。`,
            emotionalTone: newRemark.includes('笨蛋') || newRemark.includes('猪') ? 'TEASING' : 'INTIMATE',
            timestamp: Date.now()
        };
        this.feedbackEvents.push(event);
        return {
            success: true,
            event,
            lonshaDirectives: `【手机端行为即时因果共鸣】角色感知到玩家刚刚在手机上把自己的备注改成了「${newRemark}」，角色心底泛起微妙的情感涟漪（${event.emotionalTone}），在下句回复中应自然流露出一丝或娇嗔、或窃喜、或佯装薄怒的即时反应。`
        };
    }

    /**
     * 捕获深夜消费或转账事件并反哺记忆
     */
    onFinancialTransfer(recipientName, amount, memo = '') {
        const event = {
            id: 'fb_wallet_' + Date.now(),
            sourceApp: 'WALLET',
            type: 'TRANSFER_OUT',
            recipientName,
            amount,
            memo,
            synthesizedFact: `玩家通过手机钱包给「${recipientName}」转账 ${amount} 元，附言备注「${memo}」。`,
            timestamp: Date.now()
        };
        this.feedbackEvents.push(event);
        return {
            success: true,
            event,
            lonshaDirectives: `【手机端转账实证】角色收到了来自玩家手机转来的 ${amount} 元（备注：${memo}），内心受到触动或产生好奇，可依据人际关系自然提及此笔款项。`
        };
    }

    getEvents() {
        return [...this.feedbackEvents];
    }
}

export default RubyPhoneLonShaBidirectionalFeedbackHub;