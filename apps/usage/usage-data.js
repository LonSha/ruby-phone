/* ========================================================
 * usage-data.js — [v3.15.0] 洞察 App 的取数胶水层（计划 #52 + #53）
 * --------------------------------------------------------
 * 分工（刻意划清，防「同一口径被抄 N 份」）：
 *   · 纯算法 → config/usage-tracker.js（使用统计）与 config/contact-insight.js（联系人互动）；
 *   · 取数（摸宿主单例）→ **本文件**；
 *   · 渲染 → usage-view.js；编排 → usage-app.js。
 *
 * 三条纪律：
 *   ① 每个源独立 try/catch，坏源只空自己那一格（不连坐整页）；
 *   ② 读不到一律如实 null / 空态，**不补 0 冒充真实读数**；
 *   ③ 本文件不写任何 storage —— 使用统计的写只在 config/usage-tracker.js 的
 *      `trackerNote` / `trackerClose`（采集咽喉点在 index.js）。
 * ======================================================== */

import {
    readUsage, usageSummary, topApps, dailyRows, hourHeat, formatDuration
} from '../../config/usage-tracker.js';
import {
    buildContactInsight, STALE_DAYS_DEFAULT
} from '../../config/contact-insight.js';
import { readCallAttribution } from '../../config/call-attribution.js';
/* [v4.88.0 · voce-familiarity] 说话人歧义边距：内核判定「这个候选集认不认得出」，
 *   本层只把「谁给的分、对不对得上」拼成入参。 */
import { judgeSpeakerMatch, VF_STATES, isRecognized, needsConfirm } from '../../config/voice-familiarity.js';

export const USAGE_APP_ICON = '📊';

export function defaultInsightSettings() {
    return Object.freeze({
        injectToPrompt: true,          // 把「疏远度」注入 Prompt（既定事实语气）
        staleDays: STALE_DAYS_DEFAULT, // 长期未联系阈值（天）
        showDiagnostics: false
    });
}

/** 归一设置（畸形值一律回落默认；数值范围钳制，不静默接受越界）。 */
export function normalizeInsightSettings(raw) {
    const d = defaultInsightSettings();
    const out = { ...d };
    if (!raw || typeof raw !== 'object') return out;
    if (typeof raw.injectToPrompt === 'boolean') out.injectToPrompt = raw.injectToPrompt;
    if (typeof raw.showDiagnostics === 'boolean') out.showDiagnostics = raw.showDiagnostics;
    if (typeof raw.staleDays === 'number' && Number.isFinite(raw.staleDays)) {
        out.staleDays = Math.min(365, Math.max(1, Math.trunc(raw.staleDays)));
    }
    return out;
}

/**
 * 取微信三件读数（会话表 / 分桶正文 / 已加载标记）。
 * 形状与 config/rollback-preview.js 的取数口**同一份**（那里已验证过：
 * fork 出第二份取数就会得到两份会漂移的读数）。此处只取只读内存桶，
 * **绝不调会触发懒加载的按会话取消息出口** —— 打开统计页不该改数据。
 */
export function readWechatStores(win) {
    const w = win || {};
    const vp = w.VirtualPhone || null;
    try {
        const wd = (vp && ((vp.wechatApp && vp.wechatApp.wechatData) || vp.cachedWechatData)) || null;
        if (!wd || !wd.data || typeof wd.data !== 'object') return null;
        const chats = Array.isArray(wd.data.chats) ? wd.data.chats : null;
        if (!chats) return null;
        const buckets = (wd.data.messages && typeof wd.data.messages === 'object') ? wd.data.messages : {};
        const loaded = (wd._messagesLoaded && typeof wd._messagesLoaded === 'object') ? wd._messagesLoaded : {};
        return {
            chats: chats,
            buckets: buckets,
            loadedIds: Object.keys(buckets).filter((id) => loaded[id] === true)
        };
    } catch (_e) { return null; }
}

/** 取短信 / 通话读数（走 phoneCallData 的公开读出口）。 */
export function readPhoneStores(win) {
    const w = win || {};
    const vp = w.VirtualPhone || null;
    const out = { sms: undefined, calls: undefined };
    try {
        const pcd = vp && vp.phoneApp && vp.phoneApp.phoneCallData;
        if (pcd) {
            const sms = (typeof pcd.getSmsConversations === 'function') ? pcd.getSmsConversations() : null;
            out.sms = Array.isArray(sms) ? sms : null;
            const hist = (typeof pcd.getCallHistory === 'function') ? pcd.getCallHistory() : null;
            out.calls = Array.isArray(hist) ? hist : null;
        }
    } catch (_e) { /* 两域各自为 null（读不到），不伪造 */ }
    return out;
}

/** 使用统计读数（计划 #52）。 */
export function collectUsage(storage) {
    const usage = readUsage(storage);
    return {
        summary: usageSummary(usage),
        top: topApps(usage, 5),
        daily: dailyRows(usage, 7),
        hours: hourHeat(usage),
        openApp: usage.open ? usage.open.appId : null
    };
}

/**
 * 联系人互动读数（计划 #53）。
 * [v4.11.0] 通话同名歧义的人工认领账随取数一并读出并传入
 * buildContactInsight（R3-O1：旧记录可人工认领、撤销认领后恢复未归属）。
 * 认领账读不到时传 `{}`（没有任何显式认领），**不隐藏问题**：
 * 未归属通话仍如实出现在 insight.unattributedCalls。
 */
export function collectContactInsight(win, staleDays, storage) {
    const wechat = readWechatStores(win);
    const phone = readPhoneStores(win);
    const callAttribution = storage ? readCallAttribution(storage) : {};
    return buildContactInsight(
        { wechat: wechat, sms: phone.sms, calls: phone.calls },
        { staleDays: staleDays, callAttribution: callAttribution }
    );
}

/** 时长可读化再导出（视图与注入共用同一实现，避免第二份）。 */
export { formatDuration };

/* ============================================================
 * [v4.88.0 · voice-familiarity] 说话人文集歧义读数（计划外补缝）
 * ------------------------------------------------------------
 * 落点选择的理由：本仓没有声纹特征提取器，**能立刻用上的只有「一对已经算好的分数」**。
 * 通话记录里的 `caller` 与通讯录是现成的候选比对面（同名/近名就是天然的歧义源），
 * 故这里按「名字像不像 + 该名字在通讯录里的重数」构造候选分，
 * 交给内核判「能不能一句话认下来」。分数是**近似**（不是声纹相似度），
 * 但判据要的正是「贴太近就别硬选」这件事本身。
 * ============================================================ */

/** 归一名字用于比对：去空白、去标点、小写。 */
function nameKeyOf(v) {
    return String(v ?? '').replace(/[\s·・,，.。()（）]/g, '').toLowerCase();
}

/**
 * 简易相似度（0..1）：前缀命中权重最高，长度差越大越低。
 * ⚠ 这是**名字**相似度，不是声纹相似度 —— 命名里写明，防后人误读成声纹分。
 */
export function nameSimilarity(a, b) {
    const x = nameKeyOf(a);
    const y = nameKeyOf(b);
    if (!x || !y) return 0;
    if (x === y) return 1;
    const short = x.length <= y.length ? x : y;
    const long = x.length <= y.length ? y : x;
    if (!long.startsWith(short)) return 0;
    return Math.max(0.3, short.length / long.length);
}

/**
 * 判定一次「这个名字能指向谁」。
 * @param {string} spokenName 记录里的名字（通话 caller / 短信对象）
 * @param {string[]} candidateNames 通讯录里的名字
 * @param {object} opts {genuineFloor, margin}
 * @returns {{state:string, decided:boolean, pickedName:string|null, ...}}
 */
export function judgeContactAddress(spokenName, candidateNames, opts = {}) {
    const names = (Array.isArray(candidateNames) ? candidateNames : [])
        .map(n => String(n || '').trim())
        .filter(Boolean);
    const candidates = names.map((name, i) => ({
        id: name + '\u001f' + i,
        score: nameSimilarity(spokenName, name)
    })).filter(c => c.score > 0);
    const verdict = judgeSpeakerMatch(candidates, opts);
    const idx = verdict.pickedId ? Number(String(verdict.pickedId).split('\u001f').pop()) : -1;
    return {
        ...verdict,
        spokenName: String(spokenName || '').trim(),
        /* decided 与 needConfirm 由内核的同一对判据给出：malformed 谁都不算，
         *   界面据此能把「认下了」「要问一句」「判不了」三态分开。 */
        decided: isRecognized(verdict.state),
        needConfirm: needsConfirm(verdict.state),
        pickedName: Number.isInteger(idx) && idx >= 0 ? names[idx] : null,
        // 歧义时**两个候选都报**，界面才能问「A 还是 B」而不是只说「不确定」
        options: verdict.state === VF_STATES.AMBIGUOUS
            ? names.filter((n, i) => {
                const id = n + '\u001f' + i;
                return id === verdict.bestId || id === verdict.runnerUpId;
            })
            : []
    };
}

/**
 * 收一页歧义读数：哪些记录的名字认不下、为什么。
 * 只用现有两类读数（通话 caller / 短信会话对象），不改任何数据。
 */
export function collectAddressAmbiguity(phoneStores, contactNames, opts = {}) {
    const calls = Array.isArray(phoneStores?.calls) ? phoneStores.calls : [];
    const sms = Array.isArray(phoneStores?.sms) ? phoneStores.sms : [];
    const names = [];   // 待判名字（去重、保序）
    for (const c of calls) {
        const n = String(c?.caller || '').trim();
        if (n && !names.includes(n)) names.push(n);
    }
    for (const s of sms) {
        const n = String(s?.name || s?.contactName || '').trim();
        if (n && !names.includes(n)) names.push(n);
    }
    const rows = names.map(n => judgeContactAddress(n, contactNames, opts));
    return {
        judged: rows.length,
        ambiguous: rows.filter(r => r.state === VF_STATES.AMBIGUOUS),
        belowFloor: rows.filter(r => r.state === VF_STATES.BELOW_FLOOR),
        matched: rows.filter(r => r.state === VF_STATES.MATCH),
        rows
    };
}
