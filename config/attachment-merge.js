/* ========================================================
 * config/attachment-merge.js — 同目标候选合并（纯函数）[v4.88.0 · 第七批缝入]
 * --------------------------------------------------------
 * 【这一刀治的是什么（本仓实测的真缺口）】
 *   拼上下文时，同一个东西常从好几条路各来一份：笔记本里存过、检索又召回、
 *   摘要块里也带着一小段。它们**指向同一目标**，却带着不同正文与不同来源。
 *   本仓修前两道都没管：
 *     · config/injection-priority.js 只管「额度不够时谁先让位」；
 *     · config/context-compose.js 只管「按时间收集」。
 *   于是同一目标的重复候选**各自占一份额度**，额度被自己挤掉自己。
 *
 * 【源形态（非描述，按源码判定）】
 *   JasonLiu0826/ackem · parts/ackemcode/src/server/agent/attachments/dedupeAndLimit.ts
 *     · 去重不按内容、按**键**：有 path 就按 path（折反斜杠 + 小写），
 *       没 path 退到 `source + label` 组合键；
 *     · 同键保留策略是两段式：**来源优先级小者胜**；优先级相同才比正文长度、长者胜
 *       （「同一份东西里更完整的那个」）；
 *     · 然后才过预算：按来源优先级升序累计，超预算的不丢弃 ——
 *       改成 `omitted:true` 并把 body 换成**一行指路**（有 path 就写「去读这个 path」）；
 *     · 返回前再按优先级排一次，顺序稳定。
 *
 * 【本仓差异与后果（照抄会坏的地方）】
 *   · 源的 `omitted` 会清空 `media`；本仓附件没有 media 字段但有 `ref`，
 *     故这里清的是 `ref`（清了就等于「不占带宽，只留指路」）。
 *   · 源的指路文案是英文；本仓给中文，且**有 ref 时必须把 ref 写进指路句**，
 *     否则被省掉的东西就真找不回来了。
 *   · 源的键含 path 大小写折叠（macOS 习惯）；本仓全虚拟路径，同样折叠 ——
 *     但折叠只用于**比较**，回写的仍是原样 path。
 *
 * 【纪律】
 *   ① 纯函数，不改入参；
 *   ② 不瞎胜：「来源优先级相同 + 正文等长」时保留**先到的**（稳定，不随机）；
 *   ③ 不丢：超预算的只标 omitted，条目仍在（诊断能数出「省了几条」）；
 *   ④ 三态互不同形：kept / omitted / merged（被同键合并掉的条数单独计）。
 * ======================================================== */
'use strict';

/** 来源优先级：数字越小越优先。未登记的来源落 `other`（最后才考虑）。 */
export const SOURCE_PRIORITY = Object.freeze({
    core: 0,      // 人设 / 规则
    fact: 1,      // 事实 / 记忆
    note: 2,      // 用户笔记
    recall: 3,    // 检索召回
    digest: 4,    // 摘要 / 压缩块
    ambient: 5,   // 氛围 / 装饰
    other: 6
});

/** 默认单轮正文上限（字符）。超出的按来源优先级从低到高省掉。 */
export const TURN_CHAR_CAP = 24000;

function normKey(item) {
    const path = typeof item.path === 'string' ? item.path.trim().replace(/\\/g, '/').toLowerCase() : '';
    if (path) return 'p:' + path;
    return 's:' + String(item.source || 'other') + '|' + String(item.label || '');
}

function prioOf(source) {
    const n = SOURCE_PRIORITY[String(source || '')];
    return (typeof n === 'number') ? n : SOURCE_PRIORITY.other;
}

/** 同键去重。返回新数组与被合并掉的条数。 */
export function mergeByTarget(items) {
    const list = Array.isArray(items) ? items : [];
    const byKey = new Map();
    let merged = 0;
    for (const raw of list) {
        const item = (raw && typeof raw === 'object') ? raw : {};
        const key = normKey(item);
        const prev = byKey.get(key);
        if (!prev) { byKey.set(key, item); continue; }
        merged += 1;
        const pi = prioOf(item.source);
        const pp = prioOf(prev.source);
        if (pi < pp) { byKey.set(key, item); continue; }
        if (pi === pp && String(item.body || '').length > String(prev.body || '').length) byKey.set(key, item);
    }
    return { items: Array.from(byKey.values()), merged };
}

/** 一行指路句。有 ref 时把 ref 带进去。 */
export function omissionHint(item) {
    const ref = (item && typeof item.ref === 'string' && item.ref) ? item.ref : '';
    if (ref) return '（本条因额度省略；需要时读 ' + ref + '）';
    return '（本条因额度省略）';
}

/**
 * 合并 + 过预算。
 * @param {Array} items 候选 [{path?, ref?, label?, source?, body?}]
 * @param {{ cap?:number }} [opts]
 * @returns {{ items:Array, merged:number, omitted:number, used:number }}
 */
export function finalizeAttachments(items, opts = {}) {
    const cap = Math.max(1, Number(opts.cap) || TURN_CHAR_CAP);
    const { items: uniq, merged } = mergeByTarget(items);
    const sorted = uniq.slice().sort((a, b) => prioOf(a.source) - prioOf(b.source));
    const out = [];
    let used = 0;
    let omitted = 0;
    for (const item of sorted) {
        if (item.omitted === true) { out.push(item); continue; }
        const len = String(item.body || '').length;
        if (used + len <= cap) { used += len; out.push(item); continue; }
        omitted += 1;
        out.push({
            ...item,
            omitted: true,
            ref: '',
            body: omissionHint(item)
        });
    }
    out.sort((a, b) => prioOf(a.source) - prioOf(b.source));
    return { items: out, merged, omitted, used };
}

/** 一行读数。 */
export function mergeLine(r) {
    const o = (r && typeof r === 'object') ? r : {};
    return '同目标合并 ' + String(o.merged || 0) + ' · 额度省略 ' + String(o.omitted || 0)
        + ' · 占用 ' + String(o.used || 0) + ' 字';
}

/** 自检：同路径合并、高优先级胜、平级取长者、超预算只省略不丢、指路带 ref。 */
export function mergeSelfCheck() {
    const bad = [];
    const m = mergeByTarget([
        { path: '/a.txt', source: 'recall', body: '短' },
        { path: '/a.txt', source: 'core', body: '长一点的正文' }
    ]);
    if (m.merged !== 1 || m.items.length !== 1) bad.push('同路径未合并');
    if (m.items[0].source !== 'core') bad.push('低优先级未被高优先级取代');
    const longer = mergeByTarget([
        { path: '/b.txt', source: 'fact', body: '短' },
        { path: '/b.txt', source: 'fact', body: '更长的正文内容' }
    ]);
    if (longer.items[0].body !== '更长的正文内容') bad.push('平级未取长者');
    const capped = finalizeAttachments([
        { path: '/c.txt', source: 'ambient', body: 'x'.repeat(50) },
        { path: '/d.txt', source: 'core', body: 'x'.repeat(50) }
    ], { cap: 60 });
    if (capped.omitted !== 1) bad.push('超预算未省略');
    if (capped.items.length !== 2) bad.push('省略条目被丢弃');
    const hint = omissionHint({ ref: '/c.txt' });
    if (hint.indexOf('/c.txt') < 0) bad.push('指路句丢了 ref');
    if (finalizeAttachments([{ path: '/e', source: 'fact', body: 'xx', omitted: true }]).omitted !== 0) bad.push('已省略条目被重复计数');
    return { ok: bad.length === 0, bad };
}