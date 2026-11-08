/* ============================================================
 * smart-reply-chips-engine.js — [v4.126.0 · 第十六期手机生活引擎]
 * 微信直觉回复气泡与自然心意引擎 (Smart Reply Chips Engine)
 * ------------------------------------------------------------
 * 【核心设计与痛点解决】
 * 玩家在手机微信交互中，经常遇到“不知道回什么好”或“想随性回一句生活化俏皮话”的情况：
 *   - 传统输入需要玩家全手工打字，打断了掌机沉浸感；
 *   - 本引擎根据最新接收到的角色消息语境，瞬间推导出 3 种不同情绪倾向的自然直觉气泡：
 *     ① 亲近温和回应 (Warm)
 *     ② 俏皮逗趣互动 (Playful)
 *     ③ 关心探问关怀 (Inquisitive)
 *   - 点击即可秒速填入输入框或直接发出，极大提升手机社交真实度与互动黏性。
 *
 * 挂载：RubySmartReplyChips / CJS / AMD
 * ============================================================ */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.RubySmartReplyChips = factory();
        root.SmartReplyChipsEngine = root.RubySmartReplyChips;
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const VERSION = '4.126.0';

    /**
     * 根据对面的消息分析并推导快捷气泡
     */
    function generateReplyChips(incomingMessage = '', context = {}) {
        const text = String(incomingMessage || '').trim();
        const chips = [];

        if (!text) {
            return [
                { type: 'warm', text: '在干嘛呢？' },
                { type: 'playful', text: '抓住一只发呆的小家伙！' },
                { type: 'inquisitive', text: '今天忙不忙呀？' }
            ];
        }

        // 识别问句
        const isQuestion = /[？?]/.test(text) || /呢|吗|在不在|好不好|怎么样/.test(text);
        const isTired = /累|困|忙|晚安|头疼|睡觉/.test(text);
        const isHappy = /开心|好吃|买|送你|哈哈|好棒/.test(text);
        const isSad = /难过|伤心|对不起|抱歉|烦/.test(text);

        if (isQuestion) {
            chips.push({ type: 'warm', text: '都在听你的，你定就好~' });
            chips.push({ type: 'playful', text: '让我先猜猜你想怎么说！' });
            chips.push({ type: 'inquisitive', text: '刚刚还在想这件事呢。' });
        } else if (isTired) {
            chips.push({ type: 'warm', text: '辛苦啦，快靠着休息一会儿。' });
            chips.push({ type: 'warm', text: '温水喝了没？别太硬撑哦。' });
            chips.push({ type: 'playful', text: '抱抱你，把电量瞬间充满！' });
        } else if (isHappy) {
            chips.push({ type: 'playful', text: '看把你高兴的，笑得眉眼弯弯了吧？' });
            chips.push({ type: 'warm', text: '太好啦，听你开心我也跟着开心！' });
            chips.push({ type: 'inquisitive', text: '快跟我详细讲讲怎么回事~' });
        } else if (isSad) {
            chips.push({ type: 'warm', text: '没事有我在呢，心里难受就跟我说说。' });
            chips.push({ type: 'warm', text: '摸摸头，谁惹你不高兴啦？' });
            chips.push({ type: 'inquisitive', text: '要不要出来透透气，我陪你散散心。' });
        } else {
            // 通用日常对话
            chips.push({ type: 'warm', text: '嗯嗯，我都记在心上啦。' });
            chips.push({ type: 'playful', text: '怎么突然这么正经啦？' });
            chips.push({ type: 'inquisitive', text: '然后呢？后来怎么样了？' });
        }

        return chips.slice(0, 3);
    }

    return {
        VERSION,
        generateReplyChips
    };
}));
export default (typeof RubySmartReplyChips !== "undefined" ? RubySmartReplyChips : (typeof RubyMomentsNetwork !== "undefined" ? RubyMomentsNetwork : (typeof RubyAmbientLockscreen !== "undefined" ? RubyAmbientLockscreen : {})));
