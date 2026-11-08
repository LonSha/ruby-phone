/* ============================================================
 * smart-reply-predictive-chips.js — 智能直觉回复气泡与输入法心意推荐器
 * [v4.140.0 · 上下文心意预测、温和/调侃/克制三档气泡]
 * ============================================================ */

export class SmartReplyPredictiveChips {
    predictChipsForContext(lastMessageText = "", senderMood = "neutral") {
        const text = String(lastMessageText || "").trim();
        
        // 疑问/征求意见
        if (/\?|？|吗|怎么样|如何|好不好|在不在/.test(text)) {
            return [
                { style: "warm", label: "当然好呀", fullText: "当然好呀，听你的安排就好。" },
                { style: "playful", label: "容我三思~", fullText: "这可得容我认真权衡三秒钟~" },
                { style: "reserved", label: "我先看看时间", fullText: "我稍后看一下手头的事情，晚点答复你。" }
            ];
        }

        // 感谢/客气
        if (/谢谢|谢了|麻烦|辛苦|多谢/.test(text)) {
            return [
                { style: "warm", label: "跟我还客气啥", fullText: "跟我之间还用得着这么客套嘛。" },
                { style: "playful", label: "请我喝奶茶~", fullText: "真想谢我，下次请我喝杯全糖热饮吧~" },
                { style: "calm", label: "举手之劳", fullText: "举手之劳的小事，别放在心上。" }
            ];
        }

        // 难过/受委屈/疲惫
        if (/累|难受|委屈|难过|哭了|头疼|烦/.test(text)) {
            return [
                { style: "warm", label: "摸摸头，我在呢", fullText: "摸摸头，先深呼吸一下，有我在呢。" },
                { style: "gentle", label: "想聊聊吗？", fullText: "要是心里堵得慌，随时跟我倾诉，我听着。" },
                { style: "protective", label: "谁惹你了？", fullText: "到底出什么事了？跟我说说，不许一个人憋着。" }
            ];
        }

        // 默认随性日常
        return [
            { style: "warm", label: "在呢，怎么啦？", fullText: "在呢，怎么忽然找我？" },
            { style: "playful", label: "收到长官指令！", fullText: "滴滴，收到长官指令，随时待命！" },
            { style: "calm", label: "刚忙完，你说", fullText: "刚刚手头有点事，现在闲下来了，你说。" }
        ];
    }
}
if (typeof globalThis !== "undefined") { globalThis.SmartReplyPredictiveChips = SmartReplyPredictiveChips; }
if (typeof window !== "undefined") { window.SmartReplyPredictiveChips = SmartReplyPredictiveChips; }
if (typeof module !== "undefined" && module.exports) { module.exports = SmartReplyPredictiveChips; }
export default SmartReplyPredictiveChips;