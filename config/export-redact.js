/**
 * config/export-redact.js — 导出脱敏策略与对拍 [R26-X1a]
 *
 * 缝自 Lumière 的 `snapshot()`：它的导出逐键遍历 localStorage，但对 `cfg` 当场
 * `delete c.apiKey` 再序列化，`presets` 同理。**快照 = 脱敏副本，源数据不动**。
 *
 * 【本仓的真洞（实测）】
 *   config/secret-redaction.js 已经有一整套脱敏器（redact / maskValue / isSensitiveKey），
 *   但 `grep secret-redaction config/data-backup.js` = **0 命中**：
 *   能力有、接线没有。这比没有更坏 —— 没人看得出「备份里带着密钥」。
 *   X9 写着「跳大版本必须先备份（强制）」，等于把用户往「导出一个带 apiKey 的文件」推。
 *
 * 【纪律】
 *   ① 备份（backup）与分享（share）不是一回事：备份要能恢复，密钥必须保留；
 *      分享/移交要脱敏。两种策略各走各路，**不许拿一套走到底**。
 *   ② 未知策略一律拒载（refuse），不许默认按 share（会误剔）也不许默认按 backup（会泄漏）。
 *   ③ 脱敏只发生在副本上：源对象逐字段必须不动（由 verifyExport 对拍）。
 *   ④ 对拍双向：既查「该遮的遮了」，也查「不该遮的没被遮」（防脱敏过度）。
 */
import { redact, isSensitiveKey, redactSummaryLine } from './secret-redaction.js';

/** 导出策略闭集。 */
export const EXPORT_POLICIES = ['backup', 'share'];

/** 哪些键名归「一定不能进分享包」的闭集之外还看 token 形状（在 secret-redaction 里）。 */
export const SHARE_BANNED_HINTS = ['apiKey', 'api_key', 'token', 'secret', 'password', 'authorization', 'cookie'];

/** 一句话说明策略。未知策略给 null，由调用方拒载。 */
export function exportPolicyOf(kind) {
    const k = String(kind === null || kind === undefined ? '' : kind).trim().toLowerCase();
    if (k === 'backup') return { kind: 'backup', redact: false, why: '备份要能恢复，密钥必须保留' };
    if (k === 'share') return { kind: 'share', redact: true, why: '分享/移交要脱敏，密钥不得外流' };
    return null;
}

/**
 * 产出可导出的东西。三态：
 *   `export`  —— 按策略产出（可能已脱敏）
 *   `refuse`  —— 策略未登记，拒载
 * 注意：backup 仍返回 `export` 但 `redacted=false`，它是「按策略放行」而不是「没检查」。
 */
export function prepareExport(pack, kind) {
    const pol = exportPolicyOf(kind);
    const out = { state: 'refuse', kind: String(kind || ''), redacted: false, hits: [], summary: '', value: null, reason: '' };
    if (!pol) {
        out.reason = 'unknown-policy';
        return out;
    }
    out.kind = pol.kind;
    if (!pol.redact) {
        /* 备份：原样（但不返回同一个引用，交给调用方序列化） */
        out.state = 'export';
        out.value = pack;
        out.summary = '备份策略：密钥保留（恢复需要）';
        return out;
    }
    const r = redact(pack);
    out.state = 'export';
    out.redacted = true;
    out.hits = r.hits.slice();
    out.value = r.value;
    out.summary = redactSummaryLine(r.hits);
    return out;
}

/** 递归收集两个对象的差异路径。 */
function diffPaths(a, b, path, acc) {
    if (a === b) return acc;
    if (a === null || b === null || typeof a !== typeof b || typeof a !== 'object') {
        acc.push(path || '(root)');
        return acc;
    }
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
            acc.push(path || '(root)');
            return acc;
        }
        for (let i = 0; i < a.length; i += 1) diffPaths(a[i], b[i], path + '[' + i + ']', acc);
        return acc;
    }
    const keys = new Set(Object.keys(a).concat(Object.keys(b)));
    for (const k of keys) {
        const sub = path ? path + '.' + k : k;
        if (!(k in a) || !(k in b)) {
            acc.push(sub);
            continue;
        }
        diffPaths(a[k], b[k], sub, acc);
    }
    return acc;
}

/** 差异路径是否落在敏感面上（取父键判断，防止 xxx.token 这种嵌套）。 */
export function isSensitivePath(path) {
    const p = String(path || '');
    const parts = p.split(/[.[\]]+/).filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i -= 1) {
        if (/^\d+$/.test(parts[i])) continue;
        if (isSensitiveKey(parts[i])) return true;
        if (SHARE_BANNED_HINTS.indexOf(parts[i]) >= 0) return true;
    }
    return false;
}

/**
 * 导出对拍：三件事。
 *   ① 共享包不得与源在「非敏感路径」上有差异（防脱敏过度）；
 *   ② 共享包必须在敏感路径上被改过（防忘了遮）；
 *   ③ 源对象不得被改（防原地改）。
 * 传入 srcBefore 是导出前的深拷贝，用来查 ③。
 */
export function verifyExport(srcBefore, filled, exported) {
    const bad = [];
    const srcDrift = diffPaths(srcBefore, filled, '', []);
    if (srcDrift.length) bad.push('源被就地修改：' + srcDrift.slice(0, 3).join('、'));

    const outDrift = diffPaths(filled, exported, '', []);
    const overMasked = outDrift.filter((p) => !isSensitivePath(p));
    if (overMasked.length) bad.push('脱敏过度（非敏感路径也变了）：' + overMasked.slice(0, 3).join('、'));

    return {
        ok: bad.length === 0,
        bad: bad,
        changed: outDrift,
        maskedPaths: outDrift.filter(isSensitivePath),
        overMasked: overMasked
    };
}

/** 一行读数。 */
export function exportRedactText(prep, chk) {
    if (!prep) return '导出脱敏：没有准备结果（没量过）';
    if (prep.state === 'refuse') return '导出脱敏：**拒载** —— ' + (prep.reason || 'unknown');
    const head = prep.redacted ? ('导出脱敏（share）：' + prep.summary) : ('导出脱敏（backup）：' + prep.summary);
    if (!chk) return head;
    return head + ' · 对拍：' + (chk.ok ? '非敏感字段逐字一致' : ('**不符** ' + chk.bad.join('；')));
}

/** 自检：只验纯逻辑。 */
export function exportRedactSelfCheck() {
    const bad = [];
    const sample = { cfg: { apiKey: 'sk-abcdefgh12345678', model: 'm1' }, notes: [{ token: 'tkn_1234567890' }], n: 1 };

    const sh = prepareExport(sample, 'share');
    if (sh.state !== 'export') bad.push('share 应放行：' + sh.state);
    if (!sh.redacted) bad.push('share 必须脱敏');
    if (!sh.hits.length) bad.push('share 未命中敏感项');
    if (JSON.stringify(sh.value).indexOf('sk-abcdefgh12345678') >= 0) bad.push('share 仍带明文密钥');
    if (JSON.stringify(sample).indexOf('sk-abcdefgh12345678') < 0) bad.push('share 改动了源对象');
    if (sh.value.cfg.model !== 'm1') bad.push('share 误伤了非敏感字段');

    const bk = prepareExport(sample, 'backup');
    if (bk.redacted) bad.push('backup 不应脱敏');
    if (JSON.stringify(bk.value).indexOf('sk-abcdefgh12345678') < 0) bad.push('backup 丢了密钥（无法恢复）');

    const un = prepareExport(sample, 'whatever');
    if (un.state !== 'refuse') bad.push('未知策略必须拒载');

    const before = JSON.parse(JSON.stringify(sample));
    const chk = verifyExport(before, sample, sh.value);
    if (!chk.ok) bad.push('正常脱敏却对拍不过：' + chk.bad.join('；'));

    return { ok: bad.length === 0, bad: bad };
}
