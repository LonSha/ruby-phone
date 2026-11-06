/* ========================================================
 * phone/share-sheet.js
 * RubyPhone R15-O3 · 跨 App 媒体与富文本分享中枢 (ShareSheet)
 * ======================================================== */
export class ShareSheet {
    constructor(opts = {}) {
        this.phone = opts.phone || null;
        this.registeredHandlers = new Map();
        this._initDefaultHandlers();
    }

    _initDefaultHandlers() {
        // 默认内置分发目标：微信会话、朋友圈、备忘录
        this.registerTarget('wechat_chat', {
            name: '发送给朋友',
            icon: 'chat',
            handle: async (payload) => {
                const text = payload.text || '';
                const media = payload.mediaUrl || (Array.isArray(payload.mediaUrls) ? payload.mediaUrls[0] : null);
                return {
                    success: true,
                    target: 'wechat_chat',
                    dispatchedPayload: { text, media, contactId: payload.targetContactId || 'default' }
                };
            }
        });

        this.registerTarget('moments', {
            name: '分享到朋友圈',
            icon: 'moments',
            handle: async (payload) => {
                const text = payload.text || '';
                const mediaUrls = Array.isArray(payload.mediaUrls) ? payload.mediaUrls : (payload.mediaUrl ? [payload.mediaUrl] : []);
                return {
                    success: true,
                    target: 'moments',
                    dispatchedPayload: { text, mediaUrls, visibility: payload.visibility || 'PUBLIC' }
                };
            }
        });

        this.registerTarget('notes', {
            name: '保存到备忘录',
            icon: 'notes',
            handle: async (payload) => {
                return {
                    success: true,
                    target: 'notes',
                    dispatchedPayload: { title: payload.title || '分享笔记', content: payload.text || '', mediaUrls: payload.mediaUrls || [] }
                };
            }
        });
    }

    /**
     * 注册分享目标通道
     * @param {string} id 
     * @param {Object} def { name, icon, handle: Function }
     */
    registerTarget(id, def) {
        if (!id || !def || typeof def.handle !== 'function') {
            throw new Error('Invalid share target definition');
        }
        this.registeredHandlers.set(id, def);
    }

    /**
     * 获取所有可用的分享目标清单
     * @returns {Array<Object>} [{ id, name, icon }]
     */
    getAvailableTargets() {
        const list = [];
        this.registeredHandlers.forEach((val, key) => {
            list.push({ id: key, name: val.name, icon: val.icon });
        });
        return list;
    }

    /**
     * 调起跨 App 分发分享数据包
     * @param {string} targetId 
     * @param {Object} payload { text, mediaUrl, mediaUrls, title, targetContactId, visibility }
     * @returns {Promise<Object>}
     */
    async shareTo(targetId, payload) {
        if (!this.registeredHandlers.has(targetId)) {
            throw new Error(`Share target not registered: ${targetId}`);
        }
        const handler = this.registeredHandlers.get(targetId);
        return await handler.handle(payload || {});
    }
}
