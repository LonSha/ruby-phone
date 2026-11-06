/* ========================================================
 * phone/ime-draft-guardian.js
 * [v4.130.0 · R15-O4] 拟真虚拟输入法角色口癖联想与长草稿防护中枢
 * ======================================================== */
export class ImeDraftGuardian {
    constructor() {
        this.drafts = new Map(); // appId -> draftText
        this.catchphrases = {
            tsundere: ['……才不是特意写给你的！', '哼，别多想。', '勉为其难回复一下。'],
            devoted: ['只要你需要，我随时都在。', '请一定要注意安全……', '一直在想你。'],
            cynical: ['利益互换而已。', '把话说清楚比较好。', '保持怀疑。'],
            detached: ['已收到。', '按计划执行即可。', '收到，无异议。']
        };
    }

    /**
     * 保存草稿
     */
    saveDraft(appId, content) {
        if (!appId) return false;
        const text = String(content || '').trim();
        if (!text) {
            this.drafts.delete(appId);
            return false;
        }
        this.drafts.set(appId, {
            text,
            length: text.length,
            savedAt: Date.now()
        });
        return true;
    }

    /**
     * 获取草稿
     */
    getDraft(appId) {
        return this.drafts.get(appId) || null;
    }

    /**
     * 清除草稿
     */
    clearDraft(appId) {
        return this.drafts.delete(appId);
    }

    /**
     * 联想口癖补全候选
     */
    suggestCatchphrases(personaTrait = 'detached', inputPrefix = '') {
        const pool = this.catchphrases[personaTrait] || this.catchphrases.detached;
        if (!inputPrefix) return pool.slice(0, 3);
        const matched = pool.filter(p => p.includes(inputPrefix));
        return matched.length ? matched : pool.slice(0, 3);
    }
}
