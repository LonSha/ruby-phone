/* ========================================================
 * usage-app.js — [v3.15.0] 洞察 App 控制器（计划 #52 + #53）
 * 照抄 clock-app 规格：取数 → 投影 → 视图；注入走表驱动。
 * ======================================================== */

import {
    defaultInsightSettings, normalizeInsightSettings,
    collectUsage, collectContactInsight, formatDuration, collectAddressAmbiguity
} from './usage-data.js';
import { contactPromptBlock } from '../../config/contact-insight.js';
import { usageSelfCheck } from '../../config/usage-tracker.js';
import { claimCall, unclaimCall, readCallAttribution } from '../../config/call-attribution.js';
import {
    PARADIGM_IDS, DEFAULT_PARADIGMS, normalizeParadigmState,
    resolveActiveParadigm, switchParadigm, saveCustomParadigm,
} from '../../config/usage-paradigm.js';
import { UsageView } from './usage-view.js';
const SETTINGS_KEY = 'usage_settings_v1';
/* [v4.94.0 · R11-O3] 使用范式的持久键。与 `usage_settings_v1` **分键**：
 *   范式是「主屏怎么排、通知留几条」这类跨 App 的全局选择，清洞察设置不该顺手重置它。
 *   主屏（phone/home-screen.js）读同一个键 —— 这里写入、那里生效，中间没有别的副本。 */
export const PARADIGM_KEY = 'usage_paradigm_v1';

export class UsageApp {
    constructor(phoneShell, storage) {
        this.shell = phoneShell;
        this.storage = storage;
        this.settings = { ...defaultInsightSettings() };
        this._usage = null;      // [v3.15.0] 读数**不缓存跨轮**（onChatChanged 只丢不取）
        this._insight = null;
        this._ambiguity = null;
        this._view = null;
        this._hookBound = false;
        this._loadSettings();
    }

    _win() {
        try { return (typeof window !== 'undefined') ? window : globalThis; } catch (_e) { return globalThis; }
    }

    /** 现取两个读数（每次 render / refresh 都重取，不持副本 —— 防陈旧）。 */
    probe() {
        try { this._usage = collectUsage(this.storage); } catch (_e) { this._usage = null; }
        try { this._insight = collectContactInsight(this._win(), this.settings.staleDays, this.storage); } catch (_e) { this._insight = null; }
        /* [v4.88.0 · voice-familiarity] 歧义读数：与联系人洞察同一次 probe 取，
         *   候选名单走**通讯录真源**（phoneCallData.getContacts，与拨号页同一份），
         *   不另造一份联系人清单。取不到就 null（视图据此说「拿不到」，不报 0 条）。 */
        try {
            const pcd = this._win()?.VirtualPhone?.phoneApp?.phoneCallData;
            const names = (typeof pcd?.getContacts === 'function' ? pcd.getContacts() : [])
                .map(c => String(c?.name || '').trim()).filter(Boolean);
            const phone = { calls: pcd?.getCallHistory?.(), sms: pcd?.getSmsConversations?.() };
            this._ambiguity = names.length ? collectAddressAmbiguity(phone, names) : null;
        } catch (_e) { this._ambiguity = null; }
    }
    usage() { return this._usage; }
    insight() { return this._insight; }
    /** [v4.88.0] 说话人歧义读数（认不下的名字 + 为什么；null = 取不到）。 */
    ambiguity() { return this._ambiguity; }

    /* ---------------- [v4.11.0] 通话人工认领（R3-O1） ---------------- */
    /**
     * 认领账的当前读数（视图回显用）。
     * 返回归一后的 `{ 通话姓名: 联系人ID }`；读不到为空对象，永不抛。
     */
    callAttribution() {
        try { return readCallAttribution(this.storage); } catch (_e) { return {}; }
    }
    /**
     * 把某个通话姓名认领给某个联系人。
     * 空名 / 空 ID 如实拒绝（不猜）；成功后**立即现取**洞察，
     * 认领效果当帧可见（不依赖下一次 render）。
     */
    claimCall(name, contactId) {
        const ok = claimCall(this.storage, name, contactId);
        if (ok) this.probe();
        return ok;
    }
    /**
     * 撤销认领：撤掉后**立即现取**洞察，该姓名恢复未归属（R3-O1 验收原文）。
     * 没认领过 / 写入失败都如实返回 false。
     */
    unclaimCall(name) {
        const ok = unclaimCall(this.storage, name);
        if (ok) this.probe();
        return ok;
    }

    /**
     * 采集面自检（「采集这层到底在不在工作」）。
     * 为什么这个读数必须有：展示面读的是**已存下的**统计，而采集面坏掉时它只会显示
     * 「还没有记录」—— 「采集坏了」与「你还没用过」在展示面**同形**，是本仓点名的
     * 最贵形态（不报错、不崩溃、只错结论）。此处把采集键的真实状态直接暴露出来。
     */
    selfCheck() {
        try { return usageSelfCheck(this.storage); } catch (_e) { return null; }
    }

    /** Prompt 注入块（只含联系人疏远度；用统计不注入，理由见 promptBlock）。 */
    summaryLine() {
        if (!this._usage) return '读数不可用';
        const s = this._usage.summary;
        if (s.empty) return '还没有使用记录（本版起开始统计）';
        return s.activeDays + ' 天记录 · 共 ' + formatDuration(s.totalMs) + ' · ' + s.totalCount + ' 次打开';
    }

    /**
     * 生成侧注入块：**只注入联系人疏远度**（计划 #53 的「提醒长期未联系的重要联系人」）。
     * 使用统计（#52）不注入 —— 它是给用户自己看的读数，写进上下文只会白烧 token。
     */
    promptBlock() {
        if (!this.settings.injectToPrompt) return '';
        if (!this._insight) return '';
        return contactPromptBlock(this._insight, 5);
    }

    _initHook() {
        if (this._hookBound) return;
        try {
            const ctx = this._win().SillyTavern?.getContext?.();
            const es = ctx?.eventSource;
            const et = ctx?.event_types;
            if (!es || !et?.GENERATE_BEFORE_COMBINE_PROMPTS) return;
            es.on(et.GENERATE_BEFORE_COMBINE_PROMPTS, (payload) => {
                try {
                    if (!payload || !Array.isArray(payload.prompt)) return;
                    const blk = this.promptBlock();
                    if (blk) payload.prompt.push({ role: 'system', content: blk });
                } catch (_e) { /* 静默失败：生成照常进行 */ }
            });
            this._hookBound = true;
        } catch (_e) { /* 宿主无事件源：不挂钩子 */ }
    }

    /** 换会话：只丢读数，不动设置（设置是会话内的，重建后由视图重取）。 */
    onChatChanged() {
        this._usage = null;
        this._insight = null;
        if (this._view) this._view.refresh();
    }

    render() {
        this.probe();
        this._initHook();
        if (!this._view) {
            this._view = new UsageView(this, this.shell, this.storage);
        }
        this._view.render();
    }

    /* ---------- [v4.94.0 · R11-O3] 使用范式：读写口 ----------
     * 为什么放在洞察 App 里：范式改变的是「主屏排什么、通知留几条」，而本 App 恰是
     *   全仓唯一展示「你在手机上怎么用」的地方。放进 settings App 会让「读使用习惯」
     *   与「改使用范式」分处两地，用户找不到因果关系。
     * ⚠️ 这里只做读写与合法性判定，**排序与过滤本身**在 config/usage-paradigm.js 的
     *   纯函数里、由主屏调用 —— 不在 App 里复制一份排序逻辑（那是最容易两边走岔的形态）。 */
    readParadigmState() {
        try {
            const raw = this.storage ? this.storage.get(PARADIGM_KEY) : null;
            const obj = (typeof raw === 'string') ? JSON.parse(raw) : raw;
            return normalizeParadigmState(obj);
        } catch (_e) { return normalizeParadigmState(null); }
    }

    /** 当前生效的范式定义（含自定）。读不到就退回内置「生活」。 */
    activeParadigm() {
        try { return resolveActiveParadigm(this.readParadigmState()); } catch (_e) { return null; }
    }

    /** 可选项清单：内置三档 + 已存的自定范式，供界面列出。 */
    paradigmOptions() {
        const st = this.readParadigmState();
        const out = Object.values(DEFAULT_PARADIGMS).map((p) => ({ ...p, builtin: true }));
        for (const p of Object.values(st.customParadigms || {})) out.push({ ...p, builtin: false });
        return { activeId: st.activeId, options: out };
    }

    /**
     * 切换范式并落盘。
     * @returns {{success:boolean, reason?:string, activeId:string, paradigm:object|null}}
     *   失败**不改盘**：未知 id 时原样返回当前状态（不静默落到生活档 —— 那会让用户以为切成功了）。
     */
    switchTo(targetId, reason = 'user-switch') {
        const before = this.readParadigmState();
        let res = null;
        try { res = switchParadigm(before, targetId, { reason }); } catch (_e) { res = null; }
        if (!res || !res.success) {
            return {
                success: false,
                reason: (res && res.reason) || 'switch-threw',
                activeId: before.activeId,
                paradigm: this.activeParadigm(),
            };
        }
        try {
            if (this.storage) this.storage.set(PARADIGM_KEY, JSON.stringify(res.state));
        } catch (_e) { /* 写盘失败：状态没落下去，如实说没切成功 */ return { success: false, reason: 'persist-failed', activeId: before.activeId, paradigm: this.activeParadigm() }; }
        return { success: true, noop: !!res.noop, activeId: res.state.activeId, paradigm: this.activeParadigm() };
    }

    /** 保存自定义范式（同名 id 覆盖）。返回落盘后的状态。 */
    saveParadigm(customSpec) {
        const before = this.readParadigmState();
        let res = null;
        try { res = saveCustomParadigm(before, customSpec); } catch (_e) { res = null; }
        if (!res || !res.success) return { success: false, reason: (res && res.reason) || 'save-threw', activeId: before.activeId };
        try {
            if (this.storage) this.storage.set(PARADIGM_KEY, JSON.stringify(res.state));
        } catch (_e) { return { success: false, reason: 'persist-failed', activeId: before.activeId }; }
        return { success: true, paradigm: res.paradigm, activeId: before.activeId };
    }

    /** 范式 id 常量转出：界面按钮表用它，避免把 id 字符串散在各处。 */
    paradigmIds() { return { ...PARADIGM_IDS }; }

    /**
     * 把某一档复制成「自定」档并切过去。
     * ★ 为什么不是「让用户填一张表单」（本版选择不做，理由如实写下）：
     *   表单要 id / 名字 / 优先清单 / 阈值四组输入，而 `priorityApps` 的合法值
     *   是 App id 的闭集 —— 让用户在输入框里手打 `wechat`，打错就是「静默不生效」，
     *   打对了也没什么可惊喜的。故本版只给「以某一档为底复制一份」这一个动作：
     *   用户拿到一个可改的起点（落进 customParadigms，后续版本再做编辑器即可），
     *   而不是一张打错就白填的表。
     * ★ 为什么固定 id 用 `custom`：本版只支持一份自定档。重复使用即覆盖 ——
     *   这比悄悄堆积 `custom-1`/`custom-2` 好：不会让范式列表无限变长，
     *   也不会让用户看见一堆自己没起过名字的档。
     * @returns {{success:boolean, reason?:string, activeId:string}}
     */
    copyToCustomParadigm(baseId) {
        const before = this.readParadigmState();
        const base = resolveActiveParadigm({ ...before, activeId: baseId || before.activeId });
        if (!base) return { success: false, reason: 'no-base', activeId: before.activeId };
        const saved = this.saveParadigm({
            id: PARADIGM_IDS.CUSTOM,
            name: (base.name || '当前档') + '（自定）',
            badge: base.badge || '自定',
            description: '由「' + (base.name || base.id) + '」复制而来，可自行调整',
            priorityApps: base.priorityApps,
            deprioritizedApps: base.deprioritizedApps,
            noticeThreshold: base.noticeThreshold,
            quickActions: base.quickActions
        });
        if (!saved || !saved.success) {
            return { success: false, reason: (saved && saved.reason) || 'save-failed', activeId: before.activeId };
        }
        // 复制完立刻切过去：用户按的是「复制并改用」，不是「存一份以后再说」。
        return this.switchTo(PARADIGM_IDS.CUSTOM, 'user-copy');
    }

    _loadSettings() {
        try {
            const raw = this.storage ? this.storage.get(SETTINGS_KEY) : null;
            const obj = (typeof raw === 'string') ? JSON.parse(raw) : raw;
            this.settings = normalizeInsightSettings(obj);
        } catch (_e) { this.settings = { ...defaultInsightSettings() }; }
    }

    saveSettings() {
        try {
            if (this.storage) this.storage.set(SETTINGS_KEY, JSON.stringify(this.settings));
        } catch (_e) { /* silent */ }
    }
}