/* ========================================================
 * sullydesk-data.js — [v3.53.0] SullyOS 治理案头 · 纯函数内核
 *
 * 源是 SullyOS 的三个治理小件（合并缝入）：
 * ① exportGuard（2310 字节）：导出前的凭据扫描面 —— 字段名疑似凭据表
 *    （api_key / secret / token / password 等十三词干）、值面特征三形（sk- 开头 /
 *    Bearer 令牌 / JWT 三段式）与长密钥兜底（32+ 位）、白名单字段跳过、
 *    dataURL 剥离（css 文件不扫外观）、打码显示（首 4 + 尾 3）、三态判定
 *    （safe / contains-secret / unexpected-secret）；
 * ② CharacterGroupFilter（1326 字节）：分组过滤三档（全部 / 具体组 / 未分组）、
 *    未分组兜底档（groupId 空或组不存在）、计数随档联动、order→createdAt 回退排序；
 * ③ contentFavorites 指纹面（7707 字节非存储部分）：FNV 双哈希 36 进制指纹、
 *    引用去重（幂等键 chat:charId:messageId 等三形）、收藏条目快照归一。
 *
 * 立场差：源们是 React 组件与宿主存储的胶水面（vendor 依赖 / window.confirm），
 * 本件零依赖零 DOM 零 confirm，只做「这份导出安不安全、这批条目怎么分组、
 * 这个收藏的指纹是什么」的判定与读数；会话键走 ^sd2_ 前缀随会话隔离。
 * ======================================================== */
'use strict';

/* ---------- 真源常量 ---------- */
export const EG_CRED_NAME_WORDS = Object.freeze(['api_key', 'apikey', 'secret', 'token', 'authorization', 'auth', 'bearer', 'password', 'passwd', 'pwd', 'access_key', 'private_key', 'anon_key', 'credential']);
export const EG_SAFE_FIELDS = Object.freeze(['id', 'voiceId', 'fishReferenceId', 'systemPrompt', 'description', 'worldview', 'content', 'summary', 'memoryText', 'impression', 'avatar', 'src', 'prompt', 'notes', 'bio', 'title', 'label', 'text', 'lyrics']);
export const CG_FILTER_ALL = 'all';
export const CG_FILTER_UNGROUPED = '__ungrouped__';
export const SD2_LEDGER_MAX = 120;

export function isPlain(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
export function listOf(v) { return Array.isArray(v) ? v : []; }
export function toStr(v) { return (typeof v === 'string') ? v : ''; }
export function numOrNull(v) { const n = (typeof v === 'number') ? v : Number(v); return Number.isFinite(n) ? n : null; }
export function trimRows(list, cap) {
    const arr = listOf(list);
    const c = (typeof cap === 'number' && cap > 0) ? Math.floor(cap) : arr.length;
    if (arr.length <= c) return { rows: arr.slice(), dropped: 0 };
    return { rows: arr.slice(0, c), dropped: arr.length - c };
}
/* ---------- ① 导出凭据扫描（源 exportGuard 逐支对齐）---------- */
/* 字段名是否疑似凭据（词干包含，源 credentialPattern i 口径；下划线/连字符/无分隔等价）。 */
export function fieldNameLooksCredential(name) {
    const n = toStr(name).toLowerCase().replace(/[-]/g, '_');
    for (const w of EG_CRED_NAME_WORDS) {
        const wn = w.replace(/[-]/g, '_');
        if (n === wn || n.indexOf(wn) >= 0) return true;
    }
    return false;
}

/* 白名单字段（源 SAFE_FIELDS i 口径：全字匹配，大小写不敏感）。 */
export function isSafeField(name) {
    const n = toStr(name).toLowerCase();
    for (const f of EG_SAFE_FIELDS) if (f.toLowerCase() === n) return true;
    return false;
}

/* 值面特征判定（源 matchSecretSigns 的逐字符实现）：
 *   sk 前缀：sk- 开头且后随 ≥12 位；Bearer：'bearer ' 开头且后随 ≥12 位；
 *   JWT：三段式（两处点，各段 ≥10/10/6 位、字符集受限）；
 *   长密钥兜底：≥32 位连续字母数字（css 字段可关 allowOpaque）。 */
function isAlnumDash(ch) {
    const c = ch.charCodeAt(0);
    return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 45 || c === 95;
}
function hasRun(s, minLen) {
    let run = 0;
    for (let i = 0; i < s.length; i++) {
        if (isAlnumDash(s.charAt(i))) { run++; if (run >= minLen) return true; }
        else run = 0;
    }
    return false;
}
export function valueSecretSign(value, opts) {
    const o = isPlain(opts) ? opts : {};
    const s = toStr(value);
    if (s.length < 12) return '';
    if (s.indexOf('data:') === 0) return '';
    const lower = s.toLowerCase();
    const hasKeyParam = (lower.indexOf('?key=') >= 0 || lower.indexOf('&key=') >= 0 || lower.indexOf('?token=') >= 0 || lower.indexOf('&token=') >= 0 || lower.indexOf('?secret=') >= 0 || lower.indexOf('&secret=') >= 0);
    const isUrl = lower.indexOf('http://') === 0 || lower.indexOf('https://') === 0;
    if (isUrl && !hasKeyParam) return '';
    if (lower.indexOf('sk-') === 0 && hasRun(s.slice(3), 12)) return 'sk_prefix';
    if (lower.indexOf('bearer ') === 0 && hasRun(s.slice(7), 12)) return 'bearer';
    /* JWT：三段 base64url */
    const parts = s.split('.');
    if (parts.length === 3 && hasRun(parts[0], 10) && hasRun(parts[1], 10) && hasRun(parts[2], 6) && parts[0].indexOf('eyJ') === 0) return 'jwt';
    if (o.allowOpaque !== false && hasRun(s, 32)) return 'long_opaque';
    return '';
}

/* 打码显示（源 maskValue）：≤8 位全打码；否则首 4 + 尾 3。 */
export function maskValue(value) {
    const s = toStr(value);
    const B = String.fromCharCode(0x2022);
    if (s.length <= 8) return new Array(s.length + 1).join(B) || B;
    return s.slice(0, 4) + B + B + B + B + B + B + s.slice(-3) + ' (' + String(s.length) + '字)';
}

/* 递归扫描（源 scanForSecrets）：字段名命中优先，值面特征次之；白名单字段跳过值扫描。 */
export function scanSecrets(obj, opts) {
    const o = isPlain(opts) ? opts : {};
    const hits = [];
    const walk = function (node, path, seen) {
        if (node === null || typeof node !== 'object' || seen.has(node)) return;
        seen.add(node);
        for (const key of Object.keys(node)) {
            const p = path ? path + '.' + key : key;
            const v = node[key];
            if (v !== null && v !== undefined && typeof v !== 'object' && fieldNameLooksCredential(key)) {
                hits.push({ path: p, masked: maskValue(String(v)), why: 'cred_name' });
            } else if (typeof v === 'string' && !isSafeField(key)) {
                const sign = valueSecretSign(v, { allowOpaque: o.allowOpaque !== false });
                if (sign) hits.push({ path: p, masked: maskValue(v), why: sign });
            }
            if (v && typeof v === 'object') walk(v, p, seen);
        }
    };
    walk(isPlain(obj) ? obj : {}, '', new Set());
    return hits;
}

/* 三态判定（源 auditExport）：safe / contains-secret（数据本该带密钥如配置备份）/ unexpected-secret。 */
export function auditExport(obj, opts) {
    const o = isPlain(opts) ? opts : {};
    const hits = scanSecrets(obj, o);
    if (hits.length === 0) return { level: 'safe', message: '该导出内容安全，可以用于分享', hits: hits };
    if (o.expectSecrets) return { level: 'contains-secret', message: '该导出数据包含了明文密钥，请不要发送给任何人', hits: hits };
    const paths = hits.map(function (h) { return '· ' + h.path; }).join(String.fromCharCode(10));
    return { level: 'unexpected-secret', message: '该导出数据包含了明文密钥（不应出现）。' + String.fromCharCode(10) + paths, hits: hits };
}
/* ---------- ② 分组过滤（源 CharacterGroupFilter 逐支对齐）---------- */
/* 排序：order ?? createdAt ?? 0（缺栏位回退链，不许读成 0 前先看有没有 order）。 */
export function sortGrouped(list) {
    return listOf(list).slice().sort(function (a, b) {
        const av = (a && (numOrNull(a.order) !== null)) ? a.order : (numOrNull(a && a.createdAt) || 0);
        const bv = (b && (numOrNull(b.order) !== null)) ? b.order : (numOrNull(b && b.createdAt) || 0);
        return av - bv;
    });
}

/* 过滤三档：all 全部 / 具体组 groupId 匹配 / 未分组（无组或组已不在册）。 */
export function filterByGroup(items, groups, filterId) {
    const arr = listOf(items);
    if (filterId === CG_FILTER_ALL) return arr;
    const groupIds = {};
    for (const g of listOf(groups)) if (g && g.id) groupIds[g.id] = true;
    if (filterId === CG_FILTER_UNGROUPED) {
        return arr.filter(function (it) { return !it || !it.groupId || !groupIds[it.groupId]; });
    }
    return arr.filter(function (it) { return it && it.groupId === filterId; });
}

/* 档位表（源 chips 构建）：全部 + 各组（计数）+ 未分组（>0 才出现）。 */
export function buildChips(items, groups) {
    const arr = listOf(items);
    const chips = [{ id: CG_FILTER_ALL, label: '全部', count: arr.length }];
    for (const g of sortGrouped(groups)) {
        chips.push({ id: g.id, label: toStr(g.name), count: arr.filter(function (it) { return it && it.groupId === g.id; }).length });
    }
    const ungrouped = arr.filter(function (it) {
        const ids = {};
        for (const g of listOf(groups)) if (g && g.id) ids[g.id] = true;
        return !it || !it.groupId || !ids[it.groupId];
    }).length;
    if (ungrouped > 0) chips.push({ id: CG_FILTER_UNGROUPED, label: '未分组', count: ungrouped });
    return chips;
}

/* ---------- ③ 收藏指纹（源 contentFavorites 指纹与引用面）---------- */
/* FNV 双哈希 36 进制（源 h()：FNV-1a 两路不同种子）。 */
export function fingerprintOf(s) {
    const str = toStr(s);
    let h1 = 2166136261, h2 = 2654435769;
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 16777619);
        h2 = Math.imul(h2 ^ c, 2246822507);
    }
    return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

/* 引用幂等键三形（源 p()）：chat:角色:消息 / gallery:角色:图 / asset:id。 */
export function refKey(ref) {
    const r = isPlain(ref) ? ref : {};
    if (r.source === 'chat') return 'chat:' + toStr(r.charId) + ':' + String(numOrNull(r.messageId));
    if (r.source === 'gallery') return 'gallery:' + toStr(r.charId) + ':' + toStr(r.galleryImageId);
    if (r.source === 'favorite_asset') return 'favorite_asset:' + toStr(r.assetId);
    return '';
}

/* 引用去重（源 references map+Set）：键重复的引用剔除，坏引用剔除。 */
export function dedupeReferences(refs) {
    const seen = {};
    const out = [];
    let dropped = 0;
    for (const r of listOf(refs)) {
        const k = refKey(r);
        if (!k) { dropped++; continue; }
        if (seen[k]) { dropped++; continue; }
        seen[k] = true;
        out.push(r);
    }
    return { references: out, dropped: dropped };
}