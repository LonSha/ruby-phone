/**
 * wechat-intuition-reply-chips.js - RubyPhone 第十七期拓展 (R17-X1)
 * 微信直觉回复气泡与潜台词心意提示 (WeChat Intuition Reply Chips Engine)
 *
 * 核心设计：
 * 根据对方最新发言的情感倾向、疲惫度、提问状态以及互动氛围，
 * 实时推导并推荐三档候选心意气泡（贴心关怀、幽默互动、克制理性），
 * 供玩家一键填入输入框发送。
 */

export class WeChatIntuitionReplyChips {
    /**
     * 根据上下文消息推导直觉回复气泡
     * @param {string} incomingMessage 对方发来的消息
     * @param {Object} [options] 额外上下文 (如对方名字、关系等级等)
     * @returns {Array<{ id: string, text: string, type: string, tone: string }>}
     */
    static generateIntuitionChips(incomingMessage = '', options = {}) {
        const text = String(incomingMessage || '').trim();
        if (!text) {
            return [
                { id: 'chip_default_1', text: '在干嘛呢？', type: 'greeting', tone: 'warm' },
                { id: 'chip_default_2', text: '刚刚有点忙~', type: 'reply', tone: 'neutral' },
                { id: 'chip_default_3', text: '忙完找你！', type: 'promise', tone: 'playful' }
            ];
        }

        const lower = text.toLowerCase();

        // 1. 疲惫/抱怨场景
        if (/累|加班|好困|头疼|疲惫|撑不住|想睡|难受/.test(lower)) {
            return [
                { id: 'chip_tired_1', text: '今天辛苦啦，快泡个热水澡早点休息！', type: 'comfort', tone: 'warm' },
                { id: 'chip_tired_2', text: '摸摸头，今晚什么都别想，好好睡一觉。', type: 'care', tone: 'intimate' },
                { id: 'chip_tired_3', text: '收到！特许你立即开启休眠模式~', type: 'humor', tone: 'playful' }
            ];
        }

        // 2. 开心/庆祝场景
        if (/太棒了|哈哈|开心|搞定|通过|赢了|庆祝|顺利/.test(lower)) {
            return [
                { id: 'chip_happy_1', text: '哇！我就知道你一定可以的，太棒啦！🎉', type: 'praise', tone: 'warm' },
                { id: 'chip_happy_2', text: '恭喜恭喜！必须宰你一顿大餐庆祝一下~', type: 'tease', tone: 'playful' },
                { id: 'chip_happy_3', text: '为你骄傲！这段时间的努力总算没白费。', type: 'acknowledge', tone: 'gentle' }
            ];
        }

        // 3. 询问约饭/见面场景
        if (/吃饭|下班|老地方|碰面|约|几点|有空|出来/.test(lower)) {
            return [
                { id: 'chip_meet_1', text: '好啊！我收拾一下，半小时后老地方见。', type: 'accept', tone: 'enthusiastic' },
                { id: 'chip_meet_2', text: '今天手头有点紧，改天我请你呀！', type: 'decline_soft', tone: 'polite' },
                { id: 'chip_meet_3', text: '你想吃什么？听你安排~', type: 'inquire', tone: 'sweet' }
            ];
        }

        // 4. 委屈/难过场景
        if (/难过|伤心|哭|委屈|被骂|不开心|烦/.test(lower)) {
            return [
                { id: 'chip_sad_1', text: '别难过，我在呢，想聊聊发生了什么吗？', type: 'listen', tone: 'tender' },
                { id: 'chip_sad_2', text: '谁惹我们家大宝贝生气了？看我怎么收拾他！', type: 'stand_by', tone: 'protective' },
                { id: 'chip_sad_3', text: '不管怎样，我永远站在你这边。', type: 'reassure', tone: 'firm' }
            ];
        }

        // 5. 默认智能推进
        return [
            { id: 'chip_gen_1', text: '嗯嗯，然后呢？', type: 'followup', tone: 'curious' },
            { id: 'chip_gen_2', text: '哈哈确实是这样！', type: 'agree', tone: 'friendly' },
            { id: 'chip_gen_3', text: '我也正想跟你说这个呢~', type: 'echo', tone: 'warm' }
        ];
    }
}

export default WeChatIntuitionReplyChips;