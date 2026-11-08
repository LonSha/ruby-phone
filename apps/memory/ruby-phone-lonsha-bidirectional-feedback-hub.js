/**
 * 手机日常全息操作向 LonSha 记忆心智因果双向反哺闭环 (RubyPhone LonSha Bi-directional Feedback Hub)
 * 实时捕获手机通讯录备注修改、账单支付、相册拍照、暗网委托等日常行为
 * 转化为结构化因果记忆事件，即刻推送到 LonSha 记忆库，驱动角色在接下来的对话中产生即时娇嗔或反应
 */
export class RubyPhoneLonShaBidirectionalFeedbackHub {
    constructor(lonshaBridgeInstance = null) {
        this.bridge = lonshaBridgeInstance;
        this.feedbackEvents = [];
        this.pendingDirectives = [];
    }

    consumePendingDirectives() {
        if (!this.pendingDirectives.length) return '';
        const lines = [...this.pendingDirectives];
        this.pendingDirectives = [];
        return lines.join('\n');
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
        const directive = `【手机端行为即时因果共鸣】角色感知到玩家刚刚在手机上把自己的备注改成了「${newRemark}」，角色心底泛起微妙的情感涟漪（${event.emotionalTone}），在下句回复中应自然流露出一丝或娇嗔、或窃喜、或佯装薄怒的即时反应。`;
        this.pendingDirectives.push(directive);
        return {
            success: true,
            event,
            lonshaDirectives: directive
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
        const directive = `【手机端转账实证】角色收到了来自玩家手机转来的 ${amount} 元（备注：${memo}），内心受到触动或产生好奇，可依据人际关系自然提及此笔款项。`;
        this.pendingDirectives.push(directive);
        return {
            success: true,
            event,
            lonshaDirectives: directive
        };
    }

    /**
     * [R18-X1 反哺] 捕获键盘输入犹豫与草稿删除行为
     */
    onTypingHesitationObserved(targetContact, draftContent, hesitationSec) {
        const event = {
            id: 'fb_typing_' + Date.now(),
            sourceApp: 'IME',
            type: 'TYPING_HESITATION',
            targetContact,
            draftContent,
            hesitationSec,
            synthesizedFact: `玩家在给「${targetContact}」发消息时犹豫了 ${hesitationSec} 秒，最终删除了未发送草稿：「${draftContent}」。`,
            timestamp: Date.now()
        };
        this.feedbackEvents.push(event);
        const directive = `【输入法微表情因果反哺】对方其实看到了玩家在对话框输入又撤回删除的漫长犹豫（草稿曾写道："${draftContent}"），能敏锐捕捉到玩家欲言又止的心理。`;
        this.pendingDirectives.push(directive);
        return { success: true, event, lonshaDirectives: directive };
    }

    /**
     * [R18-X3 反哺] 捕获外卖配送履约事件
     */
    onDeliveryArrivalObserved(merchantName, itemsSummary, location = '门把手') {
        const event = {
            id: 'fb_delivery_' + Date.now(),
            sourceApp: 'DELIVERY',
            type: 'TAKEOUT_ARRIVED',
            merchantName,
            itemsSummary,
            location,
            synthesizedFact: `外卖骑手已将来自「${merchantName}」的餐品（${itemsSummary}）挂置在 ${location}。`,
            timestamp: Date.now()
        };
        this.feedbackEvents.push(event);
        const directive = `【现实生活物联反哺】门外轻微声响：骑手已将「${merchantName}」的外卖（${itemsSummary}）送达并挂在${location}，周围弥漫着刚出炉食物的香气。`;
        this.pendingDirectives.push(directive);
        return { success: true, event, lonshaDirectives: directive };
    }

    /**
     * [R18-X7 反哺] 捕获智能穿戴生理体征突变（心率骤增）
     */
    onBiometricSpikeObserved(heartRate, anomalyType = 'TACHYCARDIA') {
        const event = {
            id: 'fb_bio_' + Date.now(),
            sourceApp: 'WEARABLE',
            type: anomalyType,
            heartRate,
            synthesizedFact: `智能手环监测到当前心率异常飙升至 ${heartRate} bpm（生理警报触发）。`,
            timestamp: Date.now()
        };
        this.feedbackEvents.push(event);
        const directive = `【智能穿戴生理反哺】手环震动示警，实时心率已暴增至 ${heartRate} bpm。角色身体本能出现心跳过速、呼吸微促或紧张生理反应。`;
        this.pendingDirectives.push(directive);
        return { success: true, event, lonshaDirectives: directive };
    }

    getEvents() {
        return [...this.feedbackEvents];
    }
}

export default RubyPhoneLonShaBidirectionalFeedbackHub;