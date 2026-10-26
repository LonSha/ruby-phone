/* ========================================================
 *  RubyPhone — SillyTavern 虚拟智能手机 UI
 *  作者 (Author): LonSha
 *
 * 本仓为独立实现（Zero-Database Architecture），不含任何第三方未授权代码。
 * 对外显示名统一为 RubyPhone。
 *
 * 版权 (c) 2026 LonSha。采 MIT 许可。
 * ======================================================== */
import { numOrNull } from '../../config/num-gate.js';
// ========================================
// 通话记录数据层
// ========================================

export function parseSmsMessagesFromText(text = '') {
    const source = String(text || '');
    if (!source) return [];

    const messages = [];
    // 标签必须独占一行，避免把思考区里的“生成 <短信> 标签”误识别为真实内容。
    const tagPattern = /^[ \t]*<\s*短信\s*>[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*<\s*\/\s*短信\s*>[ \t]*$/gim;
    let tagMatch;
    while ((tagMatch = tagPattern.exec(source)) !== null) {
        const sections = String(tagMatch[1] || '').split(/\r?\n[ \t]*(?:-{3,}|—{2,}|–{3,})[ \t]*\r?\n/);
        sections.forEach((section, sectionIndex) => {
            const senderMatch = section.match(/^\s*\[([^\]\r\n]+)\]\s*(?:\r?\n|$)/);
            if (!senderMatch) return;

            const body = section.slice(senderMatch[0].length);
            const contentMatch = body.match(/^\s*([\s\S]*?)\s*(?:\r?\n)+\s*发送时间\s*[:：]\s*(?:(\d{1,6})\s*(?:年|[-/.])\s*(0?[1-9]|1[0-2])\s*(?:月|[-/.])\s*(0?[1-9]|[12]\d|3[01])\s*日?\s*)?([01]?\d|2[0-3])\s*[:：]\s*([0-5]\d)\s*$/);
            const sender = String(senderMatch[1] || '').trim();
            const content = String(contentMatch?.[1] || '')
                .replace(/^\s*内容\s*[:：]\s*/, '')
                .trim();
            if (!sender || !content || !contentMatch) return;

            const year = String(contentMatch[2] || '');
            const date = year
                ? `${year.padStart(4, '0')}年${String(contentMatch[3]).padStart(2, '0')}月${String(contentMatch[4]).padStart(2, '0')}日`
                : '';

            messages.push({
                sender,
                text: content,
                date,
                time: `${contentMatch[5].padStart(2, '0')}:${contentMatch[6]}`,
                sourceIndex: tagMatch.index + sectionIndex
            });
        });
    }
    return messages;
}

export class PhoneCallData {
    constructor(storage) {
        this.storage = storage;
        this._callHistory = null; // Lazy-loaded
        this._contacts = null;
        this._smsConversations = null;
        this._smsProcessedBatches = null;
    }

    // 获取通话记录（lazy load）
    getCallHistory() {
        if (!this._callHistory) {
            const saved = this.storage.get('phone_call_history', null);
            if (saved) {
                try {
                    this._callHistory = typeof saved === 'string' ? JSON.parse(saved) : saved;
                } catch (e) {
                    console.error('[PhoneCallData] 解析通话记录失败:', e);
                    this._callHistory = [];
                }
            } else {
                this._callHistory = [];
            }
        }
        return this._callHistory;
    }

    // 添加通话记录
    // record: { id, caller, time, date, weekday, duration(秒), status('missed'|'answered'|'rejected'), transcript[] }
    addCallRecord(record) {
        const history = this.getCallHistory();
        history.push(record);
        this.saveCallHistory();
    }

    // 删除通话记录
    deleteCallRecord(id) {
        const history = this.getCallHistory();
        const idx = history.findIndex(r => r.id === id);
        if (idx !== -1) {
            history.splice(idx, 1);
            this.saveCallHistory();
            return true;
        }
        return false;
    }
    // 保存通话记录
    saveCallHistory() {
        if (this._callHistory) {
            this.storage.set('phone_call_history', this._callHistory);
        }
    }

    /* ---------- [v4.88.0] 静默升级拨号的静默账 ----------
     * config/callhome-escalation.js 的判据要三格：`lastContactAt` / `lastAutoCallDay` / `dnd`。
     * 前两格必须由本层**如实持有**，缺一格就会退化成「不知道就每次都拨」。
     * 独立键而不是塞进通话记录：记录会被删除（用户清历史），而静默账是**长时事实**；
     * 混在一起的后果是「清一次历史 → 静默归零 → 立刻被拨一次」。
     * 键名 `phone_call_escalation` 命中既有 `/^phone_call_/`（config/storage.js）⇒ 会话隔离。 */
    getEscalationLedger() {
        if (!this._escalationLedger) {
            const saved = this.storage.get('phone_call_escalation', null);
            let parsed = null;
            if (saved) {
                try { parsed = typeof saved === 'string' ? JSON.parse(saved) : saved; } catch (_e) { parsed = null; }
            }
            this._escalationLedger = {
                // 毫秒时间戳或 null（null = 从来没有过联系，不是 0）
                /* 正值才算「有过来往」：0 / 负数与「没给」同读 null（不猜）。 */
                lastContactAt: (() => {
                    const v = numOrNull(parsed && parsed.lastContactAt);
                    return (v !== null && v > 0) ? v : null;
                })(),
                // 本地日字符串 YYYY-MM-DD 或 null（**不是**时间戳，归一在 localDayOf 一处）
                lastAutoCallDay: (parsed && typeof parsed.lastAutoCallDay === 'string' && parsed.lastAutoCallDay)
                    ? parsed.lastAutoCallDay
                    : null,
                autoCalls: Math.max(0, numOrNull(parsed && parsed.autoCalls) ?? 0),
                lastVerdict: (parsed && typeof parsed.lastVerdict === 'string') ? parsed.lastVerdict : ''
            };
        }
        return this._escalationLedger;
    }

    saveEscalationLedger() {
        if (this._escalationLedger) this.storage.set('phone_call_escalation', this._escalationLedger);
    }

    /** 记一次「人和手机之间有过来往」（通话、短信都算）。dnd 不算来往，故不由这里写。 */
    markContactAt(at) {
        const n = Number(at);
        if (!Number.isFinite(n) || n <= 0) return null;
        const led = this.getEscalationLedger();
        led.lastContactAt = n;
        this.saveEscalationLedger();
        return led.lastContactAt;
    }

    /** 记一次自动拨出（只有真的拨了才写，被拦下不写 —— 当日额度不能被拦消耗）。 */
    markAutoCall(dayKey) {
        const day = String(dayKey || '').trim();
        if (!day) return null;
        const led = this.getEscalationLedger();
        led.lastAutoCallDay = day;
        led.autoCalls += 1;
        this.saveEscalationLedger();
        return day;
    }

    /** 只记裁决结果（供诊断面看「最近一次为什么没拨」）。 */
    markEscalationVerdict(reason) {
        const led = this.getEscalationLedger();
        led.lastVerdict = String(reason || '');
        this.saveEscalationLedger();
    }


    getContacts() {
        if (!this._contacts) {
            const saved = this.storage.get('phone_call_contacts', null);
            if (saved) {
                try {
                    this._contacts = typeof saved === 'string' ? JSON.parse(saved) : saved;
                } catch (e) {
                    console.error('[PhoneCallData] 解析通话联系人失败:', e);
                    this._contacts = [];
                }
            } else {
                this._contacts = [];
            }
        }
        return Array.isArray(this._contacts) ? this._contacts : [];
    }

    saveContacts() {
        this.storage.set('phone_call_contacts', this.getContacts());
    }

    addContact(name) {
        const safeName = String(name || '').trim();
        if (!safeName) return null;
        const contacts = this.getContacts();
        const exists = contacts.find(item => String(item?.name || '').trim() === safeName);
        if (exists) return exists;

        const contact = {
            id: `phone_contact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: safeName,
            createdAt: Date.now()
        };
        contacts.push(contact);
        this.saveContacts();
        return contact;
    }

    deleteContact(id) {
        const safeId = String(id || '').trim();
        if (!safeId) return false;
        const contacts = this.getContacts();
        const idx = contacts.findIndex(item => String(item?.id || '').trim() === safeId);
        if (idx < 0) return false;
        contacts.splice(idx, 1);
        this.saveContacts();
        return true;
    }

    getSmsConversations() {
        if (!this._smsConversations) {
            const saved = this.storage.get('phone_call_sms_conversations', null);
            if (saved) {
                try {
                    this._smsConversations = typeof saved === 'string' ? JSON.parse(saved) : saved;
                } catch (e) {
                    console.error('[PhoneCallData] 解析短信会话失败:', e);
                    this._smsConversations = [];
                }
            } else {
                this._smsConversations = [];
            }
        }
        return Array.isArray(this._smsConversations) ? this._smsConversations : [];
    }

    saveSmsConversations() {
        this.storage.set('phone_call_sms_conversations', this.getSmsConversations());
    }

    getSmsProcessedBatches() {
        if (!this._smsProcessedBatches) {
            const saved = this.storage.get('phone_call_sms_processed_batches', null);
            if (saved) {
                try {
                    this._smsProcessedBatches = typeof saved === 'string' ? JSON.parse(saved) : saved;
                } catch (e) {
                    console.error('[PhoneCallData] 解析短信批次记录失败:', e);
                    this._smsProcessedBatches = [];
                }
            } else {
                this._smsProcessedBatches = [];
            }
        }
        return Array.isArray(this._smsProcessedBatches) ? this._smsProcessedBatches : [];
    }

    hasProcessedSmsBatch(batchId, parserVersion) {
        const safeBatchId = String(batchId || '').trim();
        const safeVersion = String(parserVersion || '').trim();
        if (!safeBatchId || !safeVersion) return false;
        return this.getSmsProcessedBatches().some(record =>
            record?.batchId === safeBatchId && record?.parserVersion === safeVersion
        );
    }

    markSmsBatchProcessed(batchId, tavernMessageIndex, parserVersion) {
        const safeBatchId = String(batchId || '').trim();
        const safeVersion = String(parserVersion || '').trim();
        if (!safeBatchId || !safeVersion) return;

        const records = this.getSmsProcessedBatches();
        const floor = Number.isInteger(tavernMessageIndex) ? tavernMessageIndex : null;
        const existing = records.find(record => record?.batchId === safeBatchId);
        if (existing) {
            existing.tavernMessageIndex = floor;
            existing.parserVersion = safeVersion;
        } else {
            records.push({ batchId: safeBatchId, tavernMessageIndex: floor, parserVersion: safeVersion });
        }
        if (records.length > 500) records.splice(0, records.length - 500);
        this.storage.set('phone_call_sms_processed_batches', records);
    }

    _removeSmsProcessedBatches(predicate) {
        const records = this.getSmsProcessedBatches();
        const retained = records.filter(record => !predicate(record));
        if (retained.length === records.length) return false;
        this._smsProcessedBatches = retained;
        this.storage.set('phone_call_sms_processed_batches', retained);
        return true;
    }

    getSmsConversationByName(name) {
        const normalizedName = String(name || '').trim().toLocaleLowerCase('zh-CN');
        if (!normalizedName) return null;
        return this.getSmsConversations().find(conversation =>
            String(conversation?.name || '').trim().toLocaleLowerCase('zh-CN') === normalizedName
        ) || null;
    }

    addSmsMessage(contactName, text, timeInfo = {}, options = {}) {
        const safeName = String(contactName || '').trim();
        const safeText = String(text || '').trim();
        if (!safeName || !safeText) return null;

        const conversations = this.getSmsConversations();
        let conversation = this.getSmsConversationByName(safeName);
        const createdAt = Date.now();
        if (!conversation) {
            conversation = {
                id: `phone_sms_${createdAt}_${Math.random().toString(36).slice(2, 8)}`,
                name: safeName,
                messages: [],
                createdAt,
                updatedAt: createdAt
            };
            conversations.push(conversation);
        }
        if (!Array.isArray(conversation.messages)) conversation.messages = [];

        const message = {
            id: `phone_sms_message_${createdAt}_${Math.random().toString(36).slice(2, 8)}`,
            direction: String(options?.direction || 'outgoing'),
            from: String(options?.from || 'me'),
            text: safeText,
            date: String(timeInfo?.date || ''),
            time: String(timeInfo?.time || ''),
            weekday: String(timeInfo?.weekday || ''),
            createdAt,
            batchId: String(options?.batchId || ''),
            fromMainChatTag: options?.fromMainChatTag === true,
            sourceIndex: Number.isInteger(options?.sourceIndex) ? options.sourceIndex : null,
            tavernMessageIndex: Number.isInteger(options?.tavernMessageIndex)
                ? options.tavernMessageIndex
                : null
        };
        conversation.messages.push(message);
        conversation.updatedAt = createdAt;
        this.saveSmsConversations();
        return { conversation, message };
    }

    addIncomingSmsMessage(senderName, text, timeInfo = {}, metadata = {}) {
        const safeSender = String(senderName || '').trim();
        return this.addSmsMessage(safeSender, text, timeInfo, {
            direction: 'incoming',
            from: safeSender,
            batchId: metadata?.batchId,
            fromMainChatTag: metadata?.fromMainChatTag === true,
            sourceIndex: metadata?.sourceIndex,
            tavernMessageIndex: metadata?.tavernMessageIndex
        });
    }

    _removeSmsMessages(predicate) {
        const conversations = this.getSmsConversations();
        let changed = false;

        for (let index = conversations.length - 1; index >= 0; index -= 1) {
            const conversation = conversations[index];
            const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
            const retained = messages.filter(message => !predicate(message));
            if (retained.length === messages.length) continue;

            changed = true;
            if (retained.length === 0) {
                conversations.splice(index, 1);
                continue;
            }

            conversation.messages = retained;
            const latestMessage = retained[retained.length - 1];
            conversation.updatedAt = Number(latestMessage?.createdAt || conversation.updatedAt || Date.now());
        }

        if (changed) this.saveSmsConversations();
        return changed;
    }

    removeMainChatSmsAtFloor(tavernMessageIndex) {
        /* [v3.12.0] 与本类另一个「本楼及之后」回滚入口同族同险：`Number('')` / `Number([])` 是 0 且通过
         *  `Number.isFinite` 校验 ⇒「没给楼层」退化成「第 0 楼」，把第 0 楼那批短信全删。
         *  本入口语义同样是「没给 ⇒ 什么都不删」。 */
        const floor = numOrNull(tavernMessageIndex);
        if (floor === null) return false;
        const messagesChanged = this._removeSmsMessages(message =>
            message?.fromMainChatTag === true
            && numOrNull(message?.tavernMessageIndex) === floor
        );
        const batchesChanged = this._removeSmsProcessedBatches(record =>
            numOrNull(record?.tavernMessageIndex) === floor
        );
        return messagesChanged || batchesChanged;
    }

    rollbackSmsToFloor(tavernMessageIndex) {
        const floor = Number(tavernMessageIndex);
        if (!Number.isFinite(floor)) return false;
        const messagesChanged = this._removeSmsMessages(message =>
            message?.fromMainChatTag === true
            && numOrNull(message?.tavernMessageIndex) !== null
            && numOrNull(message.tavernMessageIndex) >= floor
        );
        const batchesChanged = this._removeSmsProcessedBatches(record =>
            numOrNull(record?.tavernMessageIndex) !== null
            && numOrNull(record.tavernMessageIndex) >= floor
        );
        return messagesChanged || batchesChanged;
    }

    deleteSmsMessage(contactName, messageId) {
        const safeMessageId = String(messageId || '').trim();
        const normalizedName = String(contactName || '').trim().toLocaleLowerCase('zh-CN');
        if (!safeMessageId || !normalizedName) return null;

        const conversations = this.getSmsConversations();
        const conversationIndex = conversations.findIndex(conversation =>
            String(conversation?.name || '').trim().toLocaleLowerCase('zh-CN') === normalizedName
        );
        if (conversationIndex < 0) return null;

        const conversation = conversations[conversationIndex];
        if (!Array.isArray(conversation.messages)) return null;
        const messageIndex = conversation.messages.findIndex(message =>
            String(message?.id || '').trim() === safeMessageId
        );
        if (messageIndex < 0) return null;

        const [message] = conversation.messages.splice(messageIndex, 1);
        const conversationRemoved = conversation.messages.length === 0;
        if (conversationRemoved) {
            conversations.splice(conversationIndex, 1);
        } else {
            const latestMessage = conversation.messages[conversation.messages.length - 1];
            conversation.updatedAt = Number(latestMessage?.createdAt || conversation.updatedAt || Date.now());
        }
        this.saveSmsConversations();
        return { message, conversation, conversationRemoved };
    }

    deleteSmsConversation(contactName) {
        const normalizedName = String(contactName || '').trim().toLocaleLowerCase('zh-CN');
        if (!normalizedName) return null;

        const conversations = this.getSmsConversations();
        const conversationIndex = conversations.findIndex(conversation =>
            String(conversation?.name || '').trim().toLocaleLowerCase('zh-CN') === normalizedName
        );
        if (conversationIndex < 0) return null;

        const [conversation] = conversations.splice(conversationIndex, 1);
        this.saveSmsConversations();
        return conversation || null;
    }

    // 清空缓存（切换聊天时调用）
    clearCache() {
        this._callHistory = null;
        this._contacts = null;
        this._smsConversations = null;
        this._smsProcessedBatches = null;
        /* [v4.88.0] 静默账也要丢：它随会话隔离（/^phone_call_/），换会话留着就是陈旧读数。 */
        this._escalationLedger = null;
    }
}
