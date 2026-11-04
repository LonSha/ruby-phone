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
        /* [v4.121.0 · R14-O2] domain -> Set(fullId)。**倒排表的反向账**：
         *   没有这本账时，删掉/替换一个域只能全表扫 token 的 Set；
         *   更要命的是——此前**根本没有删**这件事（见下方 indexEntities 的注）。 */
        this._domainIds = new Map();
        this.searchHistory = [];
        this.maxHistory = opts.maxHistory || 20;
    }

    /**
     * [v4.121.0 · R14-O2] 清掉一个域的全部索引条目（倒排表与正文表一起清）。
     *
     * 【为什么必须按域清而不是「再灌一遍就覆盖了」】
     *   本类的 `items` / `index` 都是 **Map/Set 累加**结构，同名 key 会被覆盖，
     *   但**这一轮没再出现的 id 会原地留着**。于是发生过这件事（探针实测）：
     *     ① A 会话灌入 `WECHAT:c1（内容「秘密片段」）`；
     *     ② 换到 B 会话，`_spotlightSources()` 按新会话的 `wechat_data` 重新取数，
     *        自然取不到 c1 —— 于是**没有任何一次写入会碰 c1**；
     *     ③ B 会话里搜「秘密片段」仍然命中 c1 ⇒ 上一段会话的片段泄漏到新会话，
     *        不报错、不抛异常，只是「搜得到不该搜到的东西」。
     *   同一根因的第二个面孔：用户删掉一条日记后，它在搜索里**永远搜得到**。
     *   两个面孔都由「按域替换」一次治掉 —— 搜索面本来就是**快照**，不是增量日志。
     *
     * @param {string} domain 要清空的领域；不存在时静默无操作
     * @returns {number} 清掉的条目数
     */
    clearDomain(domain) {
        const dom = String(domain || '');
        const ids = this._domainIds.get(dom);
        if (!ids || !ids.size) { this._domainIds.delete(dom); return 0; }
        for (const fullId of ids) this.items.delete(fullId);
        /* 倒排表逆清理：每个 token 的命中集里摘掉这几个 id，摘空的 token 连键一起删
         *   （留着空 Set 会让「这个词在不在索引里」永远答「在」，白占内存也不再可判）。 */
        for (const [token, bucket] of this.index) {
            for (const fullId of ids) bucket.delete(fullId);
            if (!bucket.size) this.index.delete(token);
        }
        const n = ids.size;
        this._domainIds.delete(dom);
        return n;
    }

    /**
     * [v4.121.0 · R14-O2] 整份清空（换会话的唯一出口）。
     *   连 `searchHistory` 一起清：它是**上一段会话**的用户输入痕迹，
     *   留着不显示时无害，一旦哪天被摆上面板就是同一类泄漏。
     * @returns {number} 清掉的条目数
     */
    reset() {
        const n = this.items.size;
        this.index.clear();
        this.items.clear();
        this._domainIds.clear();
        this.searchHistory = [];
        return n;
    }

    /**
     * 批量导入可搜索实体（**按域整份替换**，不是增量追加）。
     *
     * @param {string} domain 实体领域
     * @param {Array<Object>} entities 待索引列表 [{ id, title, subtitle, content, deepLink }]
     */
    indexEntities(domain, entities = []) {
        const dom = String(domain || '');
        /* [v4.121.0 · R14-O2] 先清这一域的旧条目 —— 本方法是「这一域**现在**长这样」，
         *   不是「再补几条」。旧语义（只增不删）会让上面 clearDomain 注释里
         *   那两张面孔同时成立，而调用点每次都是拿全量重灌，本就期待替换。 */
        this.clearDomain(dom);
        const bucket = new Set();
        for (const ent of entities) {
            if (!ent || !ent.id) continue;
            const fullId = `${dom}:${ent.id}`;
            const searchableText = `${ent.title || ''} ${ent.subtitle || ''} ${ent.content || ''}`.toLowerCase();
            
            const record = {
                id: fullId,
                rawId: ent.id,
                domain: dom,
                title: ent.title,
                subtitle: ent.subtitle || '',
                content: ent.content || '',
                deepLink: ent.deepLink || null
            };
            this.items.set(fullId, record);
            bucket.add(fullId);

            // 建立轻量 bigram + 分词倒排
            const tokens = this._tokenize(searchableText);
            for (const t of tokens) {
                if (!this.index.has(t)) this.index.set(t, new Set());
                this.index.get(t).add(fullId);
            }
        }
        /* 这一域「现在」的条目账（下次 clearDomain 就照它逆清理）。
         *   空域也照落一格空 Set：它是「这一域刚灌过、现在 0 条」的凭据 ——
         *   `clearDomain` 的返回值与「这域从没灌过」在处置上一样（都是 0 条可清），
         *   但对账时这两件事必须分得开。 */
        this._domainIds.set(dom, bucket);
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