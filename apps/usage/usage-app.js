/* ========================================================
 * usage-app.js — [v3.15.0] 洞察 App 控制器（计划 #52 + #53）
 * 照抄 clock-app 规格：取数 → 投影 → 视图；注入走表驱动。
 * ======================================================== */

import {
    defaultInsightSettings, normalizeInsightSettings,
    collectUsage, collectContactInsight, formatDuration
} from './usage-data.js';
import { contactPromptBlock } from '../../config/contact-insight.js';
import { usageSelfCheck } from '../../config/usage-tracker.js';
import { UsageView } from './usage-view.js';

const SETTINGS_KEY = 'usage_settings_v1';

export class UsageApp {
    constructor(phoneShell, storage) {
        this.shell = phoneShell;
        this.storage = storage;
        this.settings = { ...defaultInsightSettings() };
        this._usage = null;      // [v3.15.0] 读数**不缓存跨轮**（onChatChanged 只丢不取）
        this._insight = null;
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
        try { this._insight = collectContactInsight(this._win(), this.settings.staleDays); } catch (_e) { this._insight = null; }
    }

    usage() { return this._usage; }
    insight() { return this._insight; }

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