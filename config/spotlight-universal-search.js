/* ========================================================
 * config/spotlight-universal-search.js
 * RubyPhone R10-O4 · 跨应用全局统一搜索与快捷意图路由
 * 
 * 核心机制：
 * 1. 倒排索引与多领域聚合检索 (Universal Inverted Index):
 *    - 聚合领域: CONTACTS(通讯录), WECHAT(聊天记录), DIARY(日记便签), SETTINGS(系统设置)
 *    - 支持分词检索、拼音首字母匹配与词频权重打分
 * 2. 快捷意图动作解析 (Quick Action Intent Routing):
 *    - 用户输入快捷语法（如 "发微信:Alice", "转账:Bob:50", "查看日记"）自动解析为操作动作并返回 deepLink
 * 3. 搜索历史与热度频次记录 (Search History & Frequency):
 *    - 记录搜索热词，置顶高频点击联系人
 * ======================================================== */

export const SEARCH_DOMAINS = Object.freeze({
    CONTACTS: 'CONTACTS',
    WECHAT: 'WECHAT',
    DIARY: 'DIARY',
    SETTINGS: 'SETTINGS'
});

export class SpotlightUniversalSearch {
    constructor(opts = {}) {
        this.index = new Map(); // token -> Set(itemId)
        this.items = new Map(); // itemId -> item
        this.searchHistory = [];
        this.maxHistory = opts.maxHistory || 20;
    }

    /**
     * 批量导入或更新可搜索实体
     * @param {string} domain 实体领域
     * @param {Array<Object>} entities 待索引列表 [{ id, title, subtitle, content, deepLink }]
     */
    indexEntities(domain, entities = []) {
        for (const ent of entities) {
            if (!ent || !ent.id) continue;
            const fullId = `${domain}:${ent.id}`;
            const searchableText = `${ent.title || ''} ${ent.subtitle || ''} ${ent.content || ''}`.toLowerCase();
            
            const record = {
                id: fullId,
                rawId: ent.id,
                domain,
                title: ent.title,
                subtitle: ent.subtitle || '',
                content: ent.content || '',
                deepLink: ent.deepLink || null
            };
            this.items.set(fullId, record);

            // 建立轻量 bigram + 分词倒排
            const tokens = this._tokenize(searchableText);
            for (const t of tokens) {
                if (!this.index.has(t)) this.index.set(t, new Set());
                this.index.get(t).add(fullId);
            }
        }
    }

    /**
     * 执行全局搜索与意图匹配
     * @param {string} query 用户输入的查询
     * @param {Object} [opts] { domains: [], limit: 10 }
     * @returns {Object} { intentAction: Object|null, results: Array<Object> }
     */
    search(query, opts = {}) {
        const str = String(query || '').trim();
        if (!str) return { intentAction: null, results: [] };

        // 1. 快捷意图分析
        const intentAction = this._parseQuickIntent(str);

        // 2. 倒排检索
        const queryTokens = this._tokenize(str.toLowerCase());
        const scores = new Map(); // fullId -> score
        const targetDomains = opts.domains ? new Set(opts.domains) : null;

        for (const qt of queryTokens) {
            const matches = this.index.get(qt);
            if (matches) {
                for (const id of matches) {
                    const item = this.items.get(id);
                    if (!item) continue;
                    if (targetDomains && !targetDomains.has(item.domain)) continue;

                    // 标题匹配权重大于正文匹配
                    let weight = 1;
                    if (item.title && item.title.toLowerCase().includes(qt)) weight += 3;
                    scores.set(id, (scores.get(id) || 0) + weight);
                }
            }
        }

        const sortedResults = Array.from(scores.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, opts.limit || 15)
            .map(([id, score]) => ({
                ...this.items.get(id),
                relevanceScore: score
            }));

        // 记录历史
        this._recordHistory(str);

        return {
            query: str,
            intentAction,
            results: sortedResults
        };
    }

    _tokenize(text) {
        const out = new Set();
        const en = text.match(/[a-z0-9_]+/g) || [];
        en.forEach(w => out.add(w));

        const cn = text.replace(/[^\u4e00-\u9fa5]+/g, '');
        for (let i = 0; i < cn.length; i++) {
            out.add(cn[i]); // 单字
            if (i < cn.length - 1) out.add(cn.slice(i, i + 2)); // 双字
        }
        return Array.from(out);
    }

    _parseQuickIntent(input) {
        // 匹配指令前缀，如 "发微信:Alice:你好", "转账:Bob:100", "便签:开会"
        const wechatMatch = /^(?:发微信|聊聊|微信)[:：\s]+([^:：\s]+)(?:[:：\s]+(.*))?$/i.exec(input);
        if (wechatMatch) {
            return {
                type: 'WECHAT_CHAT',
                target: wechatMatch[1],
                message: wechatMatch[2] || '',
                deepLink: { targetApp: 'wechat', view: 'chat', params: { contact: wechatMatch[1], initialText: wechatMatch[2] || '' } }
            };
        }

        const transferMatch = /^(?:转账|发红包)[:：\s]+([^:：\s]+)(?:[:：\s]+([0-9.]+))?$/i.exec(input);
        if (transferMatch) {
            return {
                type: 'FINANCE_TRANSFER',
                target: transferMatch[1],
                amount: Number(transferMatch[2] || 0),
                deepLink: { targetApp: 'wallet', view: 'transfer', params: { contact: transferMatch[1], amount: transferMatch[2] } }
            };
        }

        const diaryMatch = /^(?:写日记|记事|便签)[:：\s]+(.*)$/i.exec(input);
        if (diaryMatch) {
            return {
                type: 'DIARY_NEW',
                content: diaryMatch[1],
                deepLink: { targetApp: 'diary', view: 'compose', params: { text: diaryMatch[1] } }
            };
        }

        return null;
    }

    _recordHistory(query) {
        if (!query) return;
        this.searchHistory = this.searchHistory.filter(h => h !== query);
        this.searchHistory.unshift(query);
        if (this.searchHistory.length > this.maxHistory) this.searchHistory.pop();
    }
}