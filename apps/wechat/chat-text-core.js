/* ================================================================
 * [v4.157.0 · R25-O1] 微信文本解析内核（从 chat-view.js 原段抽出：只搬不改）
 * ----------------------------------------------------------------
 * 抽的就是这一段：chat-view.js 里**零 this、零业务判定**的文本解析族 ——
 *   异常空格清理 / 括号组读取 / 来电标记解析 / 快捷回复载荷拆解 /
 *   微博评论行拆解 / 时间推进命令解析。
 * 为什么它们能“裸搬”（实测，不是感觉）：
 *   抽前逐个方法体扫过，**没有一处** `this`，也没有指向 chat-view.js 模块作用域的
 *   自由标识符；只用到 2 个 import（numOrNull / storyNowWallFallback），
 *   其余全是入参与局部。故以“原型混入”形态回归：chat-view.js 里
 *   `Object.assign(ChatView.prototype, chatTextCore)`，方法里的 this 仍指 ChatView
 *   实例（虽然它们本来就不用），调用点一行未改。
 *
 * 等价证据：tests/r25_o1_chat_text_core.test.mjs 把**搬前**代码的输出录成
 *   tests/audit/chat-text-core.golden.json（43 个用例，含空串/坏输入/未闭合括号/
 *   组呼/无宿主时间解析），搬后逐条对拍；任一条不同即红。
 *
 * 不许做的事：
 *   ★ 搬的时候**顺手改逻辑**（那就不是等价拆分）；
 *   ★ 两边各留一份实现（第二份派生规则是本仓反复治过的病）。
 * ================================================================ */
import { numOrNull } from '../../config/num-gate.js';
import { storyNowWallFallback } from '../../config/time-source.js';

export const chatTextCore = {
    cleanAbnormalSpaces(text) {
        if (!text || typeof text !== 'string') return text;

        // 🔥 模式1：连续的"单字+空格"序列（如"不 过 ， 如 果"）
        // 匹配：中文字符/标点 + 空格 + 中文字符/标点，且这种模式连续出现3次以上
        // 这表示AI在每个字符之间都加了空格

        // 检测是否存在异常空格模式：单个中文字符后跟空格，连续出现
        const abnormalPattern = /([\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef])\s(?=[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef])/g;

        // 计算异常模式出现的次数
        const matches = text.match(abnormalPattern);

        // 如果异常模式出现次数超过3次，说明这是AI的异常输出，需要清理
        if (matches && matches.length >= 3) {
            // 移除中文字符之间的单个空格
            return text.replace(/([\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef])\s+(?=[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef])/g, '$1');
        }

        return text;
    },
    _readBracketGroupAt(value = '', startIndex = 0) {
        const text = String(value || '');
        const opener = text[startIndex];
        if (opener !== '（' && opener !== '(') return null;

        const primaryCloser = opener === '（' ? '）' : ')';
        const alternateCloser = opener === '（' ? ')' : '）';
        let depth = 1;
        for (let index = startIndex + 1; index < text.length; index += 1) {
            const char = text[index];
            if (opener === '(' && char === '(') {
                depth += 1;
                continue;
            }
            if (char !== primaryCloser && char !== alternateCloser) continue;
            depth -= 1;
            if (depth === 0) {
                return {
                    text: text.slice(startIndex + 1, index),
                    endIndex: index + 1
                };
            }
        }
        return null;
    },
    _parseIncomingCallMarker(content) {
        const source = String(content || '');
        if (!source) return null;

        const callMatch = source.match(/(?:\[\s*(?:拨打|发起)\s*(?:微信)?(群)?(语音|视频)(?:通话)?\s*\]|【\s*(?:拨打|发起)\s*(?:微信)?(群)?(语音|视频)(?:通话)?\s*】)/i);
        if (!callMatch) return null;

        const callTypeStr = callMatch[2] || callMatch[4] || '语音';
        const callType = callTypeStr === '视频' ? 'video' : 'voice';
        const isGroupCall = Boolean((callMatch[1] || callMatch[3] || '').trim());

        return {
            callType,
            callTypeStr,
            isGroupCall
        };
    },
    _extractQuickReplyPayload(text = '', key = '') {
        const raw = String(text || '').trim();
        if (!raw) return '';
        const map = {
            image: '图片',
            video: '视频',
            sticker: '表情包',
            'voice-strip': '语音条',
            location: '定位'
        };
        const label = map[key];
        if (label) {
            const match = new RegExp(`^\\[${label}\\]\\s*[（(]\\s*([\\s\\S]*?)\\s*[）)]$`).exec(raw);
            if (match) return String(match[1] || '').trim();
        }
        const timeMatch = /^\[\s*时间推进\s*[：:]\s*([^\]]+?)\s*\]$/.exec(raw);
        if (key === 'time' && timeMatch) return String(timeMatch[1] || '').trim();
        return raw;
    },
    _parseWeiboCommentLine(line) {
        if (!line) return null;
        const cleaned = String(line || '').trim();
        if (!cleaned) return null;

        // 兼容：1. 昵称 (ip[地区])：内容 / 昵称 回复 昵称 (ip[地区])：内容
        const matched = cleaned.match(/^\d+[.、]\s*(.+?)\s*(?:[（(]\s*(?:ip|IP|来自|IP属地)?[：:\s]*\[?([^\]）)]+)\]?\s*[）)])?\s*[：:]\s*([\s\S]+)$/i);
        if (!matched) return null;

        let head = (matched[1] || '').trim();
        const location = String(matched[2] || '').replace(/^(ip|IP|来自|IP属地)[：:\s]*/i, '').trim();
        const text = (matched[3] || '').trim();
        if (!head || !text) return null;

        let replyTo = '';
        const replyMatch = head.match(/^(.+?)\s*回复\s*(.+)$/);
        if (replyMatch) {
            head = replyMatch[1].trim();
            replyTo = replyMatch[2].trim();
        }

        const cleanName = (name) => String(name || '').trim().replace(/^@/, '').replace(/^[\[\(（【]/, '').replace(/[\]\)）】]$/, '').trim();
        const name = cleanName(head) || '网友';
        replyTo = cleanName(replyTo);

        return { name, location, text, replyTo };
    },
    _parseManualTimeAdvanceCommand(text = '') {
        const raw = String(text || '').trim();
        const match = raw.match(/^\[\s*时间推进\s*[：:]\s*([^\]]+?)\s*\]$/);
        if (!match) return null;

        const payload = String(match[1] || '').trim();
        const parsed = window.VirtualPhone?.timeManager?.parseStatusbar?.(payload);
        if (!parsed?.time || !parsed?.date) return null;

        const timestamp = typeof window.VirtualPhone?.timeManager?.parseTimeToTimestamp === 'function'
            ? window.VirtualPhone.timeManager.parseTimeToTimestamp(parsed)
            : (Number(parsed.timestamp) || storyNowWallFallback(window).ms);

        return {
            time: parsed.time,
            date: parsed.date,
            weekday: parsed.weekday || window.VirtualPhone?.timeManager?.calculateWeekday?.(parsed.date) || '星期一',
            timestamp: numOrNull(timestamp) !== null ? numOrNull(timestamp) : storyNowWallFallback(window).ms
        };
    },
};

export default { chatTextCore };
