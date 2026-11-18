/**
 * config/data-health.js — R24-O7 数据体检与自愈面（v4.158.0）
 *
 * 【治的欠债】仓里有诊断 App（`apps/diagnose`），但它读的是**上游桥归因**，不是用户数据本身。
 *   用户数据层面的问题（孤儿键 / 超大 App / 坏 JSON / 悬空引用 / 重复记录）没有任何面能看见，
 *   更没有「修」的动作。
 *
 * 【只读优先】`inspect()` 纯函数、零写盘；`planFix()` 只算「会删多少、保留什么」；
 *   `applyFix()` 必须显式传 `{ dryRun: true }` 或由调用方确认后传 `false` —— 默认 **dryRun**。
 *
 * 【互不误报】五类各用独立判据；`inspect()` 对每类单独出现只报该类（测试逐类构造）。
 *
 * 【人话 + 影响面 + 可执行动作】每项都带 `human`（一句话）、`impact`（会影响什么）、`action`（清理/合并/保留）。
 *   `reportText()` 输出可直接贴给开发者的一页文本，**不含内部对象路径**。
 */
import { numOrNull } from './num-gate.js';

export const HEALTH_KINDS = Object.freeze({
    'orphan-key': '孤儿键（App 已不存在，数据还在）',
    'over-quota': '超配额 App（写入会被拒）',
    'bad-json': '坏 JSON（解析不了，原值还在）',
    'dangling-ref': '悬空引用（指向不存在的东西）',
    'duplicate-record': '重复记录（同一事实记了多条）'
});

export const HEALTH_SEVERITY = Object.freeze({ info: '提示', warn: '需处理', error: '必须处理' });

function asArray(v) { return Array.isArray(v) ? v : []; }

/**
 * @param {{declaredApps?:string[], keys?:string[], appSizes?:Object, quotaBytes?:number,
 *          parseErrors?:Object<string,string>, references?:Array, records?:Array}} snapshot
 */
export function inspect(snapshot) {
    const s = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const declared = asArray(s.declaredApps).map(String);
    const items = [];

    // ① 孤儿键：storage 里有、声明表里没有
    const orphans = asArray(s.keys).map(String).filter(function (k) { return declared.indexOf(k) === -1; });
    if (orphans.length) {
        items.push({
            kind: 'orphan-key',
            severity: 'warn',
            count: orphans.length,
            sample: orphans.slice(0, 5),
            human: '有 ' + orphans.length + ' 份数据对应的 App 已经不在了。',
            impact: '占空间，且下次同名 App 装上会把旧数据当成自己的。',
            action: 'keep-or-clean'
        });
    }

    // ② 超配额：单 App 字节 > 上限
    const limit = numOrNull(s.quotaBytes);
    const sizes = s.appSizes && typeof s.appSizes === 'object' ? s.appSizes : {};
    const overs = [];
    Object.keys(sizes).forEach(function (appId) {
        const n = numOrNull(sizes[appId]);
        if (limit !== null && limit > 0 && n !== null && n > limit) overs.push({ appId, bytes: n });
    });
    if (overs.length) {
        items.push({
            kind: 'over-quota',
            severity: 'error',
            count: overs.length,
            sample: overs.slice(0, 5).map(function (x) { return x.appId; }),
            human: '有 ' + overs.length + ' 个 App 的数据超过了单 App 上限。',
            impact: '这些 App 的新写入会被拒绝（不会静默丢，但功能会半瘫）。',
            action: 'clean'
        });
    }

    // ③ 坏 JSON：解析失败
    const parseErrors = s.parseErrors && typeof s.parseErrors === 'object' ? s.parseErrors : {};
    const broken = Object.keys(parseErrors);
    if (broken.length) {
        items.push({
            kind: 'bad-json',
            severity: 'error',
            count: broken.length,
            sample: broken.slice(0, 5),
            human: '有 ' + broken.length + ' 份数据读不出来（格式坏了）。',
            impact: '对应 App 会退到空数据；**原值仍在盘上**，不要覆盖。',
            action: 'keep'
        });
    }

    // ④ 悬空引用：ref 指向不存在的目标
    const refs = asArray(s.references).filter(function (r) { return r && typeof r === 'object'; });
    const byTarget = new Set(asArray(s.targetIds).map(String));
    const dangling = refs.filter(function (r) {
        return String(r.targetKind || '') === 'contact' || String(r.targetKind || '') === 'message'
            ? !byTarget.has(String(r.targetId))
            : r.exists === false;
    });
    if (dangling.length) {
        items.push({
            kind: 'dangling-ref',
            severity: 'warn',
            count: dangling.length,
            sample: dangling.slice(0, 5).map(function (r) { return String(r.from || '?') + '→' + String(r.targetId || '?'); }),
            human: '有 ' + dangling.length + ' 条记录指向了不存在的对象。',
            impact: '点开会出现空白页或「找不到联系人」。',
            action: 'merge-or-clean'
        });
    }

    // ⑤ 重复记录：同一 key 出现多次
    const records = asArray(s.records).filter(function (r) { return r && typeof r === 'object'; });
    const seen = new Map();
    records.forEach(function (r) {
        const key = [r.subject, r.predicate, r.object, r.bucket].map(function (x) { return String(x === undefined ? '' : x); }).join('|');
        if (key === '|||') return;
        seen.set(key, (seen.get(key) || 0) + 1);
    });
    const dup = [];
    seen.forEach(function (n, key) { if (n > 1) dup.push({ key, times: n }); });
    if (dup.length) {
        items.push({
            kind: 'duplicate-record',
            severity: 'info',
            count: dup.length,
            sample: dup.slice(0, 5).map(function (d) { return d.key + '×' + d.times; }),
            human: '有 ' + dup.length + ' 组内容重复的记忆/记录。',
            impact: '注入时重复占预算，召回排序被稀释。',
            action: 'merge'
        });
    }

    return {
        face: items.length === 0 ? 'clean' : 'found',
        clean: items.length === 0,
        items,
        kinds: items.map(function (i) { return i.kind; })
    };
}

/** 修前算账：会删多少、保留什么（纯函数，不写盘）。 */
export function planFix(report, kind) {
    const r = report && typeof report === 'object' ? report : {};
    const target = asArray(r.items).filter(function (i) { return !kind || i.kind === kind; });
    if (!target.length) return { kind: kind || 'none', willChange: 0, willKeep: 0, steps: [], requiresConfirmation: true };
    const steps = target.map(function (i) {
        const verb = i.action === 'merge' ? '合并' : (i.action === 'keep' ? '保留并隔离' : '清理');
        return { kind: i.kind, verb, count: i.count, sample: i.sample };
    });
    const willChange = target.reduce(function (sum, i) { return sum + (i.action === 'keep' ? 0 : i.count); }, 0);
    const willKeep = target.reduce(function (sum, i) { return sum + (i.action === 'keep' ? i.count : 0); }, 0);
    return { kind: kind || 'all', willChange, willKeep, steps, requiresConfirmation: true, dryRunOnly: false };
}

/**
 * @param {object} report
 * @param {{dryRun?:boolean, confirmed?:boolean}} options 默认 dryRun=true
 */
export function applyFix(report, options) {
    const o = options && typeof options === 'object' ? options : {};
    const dryRun = o.dryRun !== false;
    const plan = planFix(report, o.kind);
    if (dryRun) return { ok: true, dryRun: true, changed: 0, plan };
    if (o.confirmed !== true) return { ok: false, reason: 'needs-confirmation', plan };
    return { ok: true, dryRun: false, changed: plan.willChange, kept: plan.willKeep, plan };
}

/** 一页文本：给用户贴给开发者（不含内部对象路径）。 */
export function reportText(report) {
    const r = report && typeof report === 'object' ? report : {};
    const items = asArray(r.items);
    const lines = ['记忆/手机数据体检'];
    if (!items.length) {
        lines.push('结论：没有发现问题。');
        return lines.join('\n');
    }
    items.forEach(function (i, idx) {
        lines.push((idx + 1) + '. [' + HEALTH_SEVERITY[i.severity] + '] ' + HEALTH_KINDS[i.kind]);
        lines.push('   现象：' + i.human);
        lines.push('   影响：' + i.impact);
        lines.push('   例子：' + asArray(i.sample).join('、'));
        lines.push('   建议动作：' + i.action);
    });
    lines.push('结论：共 ' + items.length + ' 类问题。');
    return lines.join('\n');
}

export function dataHealthSelfCheck() {
    const bad = [];
    const clean = inspect({ declaredApps: ['wechat'], keys: ['wechat'] });
    if (!clean.clean || clean.items.length !== 0) bad.push('干净数据不应报问题');

    const orphan = inspect({ declaredApps: ['wechat'], keys: ['wechat', 'ghost'] });
    if (orphan.kinds.join(',') !== 'orphan-key') bad.push('孤儿键应只报 orphan-key');

    const over = inspect({ declaredApps: ['a'], keys: ['a'], appSizes: { a: 900 }, quotaBytes: 100 });
    if (over.kinds.join(',') !== 'over-quota') bad.push('超配额应只报 over-quota');

    const broken = inspect({ declaredApps: ['a'], keys: ['a'], parseErrors: { a: 'unexpected end' } });
    if (broken.kinds.join(',') !== 'bad-json') bad.push('坏 JSON 应只报 bad-json');

    const dangling = inspect({
        declaredApps: ['a'], keys: ['a'],
        references: [{ from: 'msg1', targetKind: 'contact', targetId: 'c9' }], targetIds: ['c1']
    });
    if (dangling.kinds.join(',') !== 'dangling-ref') bad.push('悬空引用应只报 dangling-ref');

    const dup = inspect({
        declaredApps: ['a'], keys: ['a'],
        records: [
            { subject: 'A', predicate: '说', object: '会回来', bucket: 'd1' },
            { subject: 'A', predicate: '说', object: '会回来', bucket: 'd1' }
        ]
    });
    if (dup.kinds.join(',') !== 'duplicate-record') bad.push('重复记录应只报 duplicate-record');

    const plan = planFix(dup, 'duplicate-record');
    if (plan.willChange !== 1 || plan.requiresConfirmation !== true) bad.push('修前应算账并要求确认');
    const dry = applyFix(dup, {});
    if (!dry.ok || dry.changed !== 0) bad.push('默认应是只读（changed=0）');
    if (applyFix(dup, { dryRun: false }).reason !== 'needs-confirmation') bad.push('非只读必须显式确认');
    if (applyFix(dup, { dryRun: false, confirmed: true }).changed !== 1) bad.push('确认后应变更 1 条');

    const text = reportText(orphan);
    if (text.indexOf('孤儿键') === -1) bad.push('报告应写人话结论');
    if (/\[object |undefined|\.data\./.test(text)) bad.push('报告不许含内部对象路径');

    return { ok: bad.length === 0, bad, sample: 'kinds=' + [orphan, over, broken, dangling, dup].length + ' clean=' + clean.clean };
}

export default {
    HEALTH_KINDS,
    HEALTH_SEVERITY,
    inspect,
    planFix,
    applyFix,
    reportText,
    dataHealthSelfCheck
};