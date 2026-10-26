/* ========================================================
 * config/write-guard.js — 写目标守卫（纯函数）[v4.88.0 · 第七批缝入]
 * --------------------------------------------------------
 * 【这一刀治的是什么（本仓实测的真缺口）】
 *   config/virtual-file-system.js 的 writeFile() 只有两道检查：
 *     ① 父目录必须在 files 表里（`throw new Error('Directory ... does not exist')`）；
 *     ② 别的一律照写 —— **同名即静默覆盖**。
 *   于是三类事故都没有闸：
 *     · `/Documents/system/*`（系统壳）被子 App 覆盖 ⇒ 外壳读出来的就是半截；
 *     · `create` 语义（「新建」）写到一个已存在的路径 ⇒ 用户以为新建，实际是覆盖；
 *     · `append` 语义（「追加」）写到不存在的路径 ⇒ 新生成了个只有尾巴的文件；
 *     · 单次写入几十万字、或反复 append 把文件撑到几十兆 ⇒ 客户端卡在序列化。
 *
 * 【源形态（非描述，按源码判定）】
 *   hanamorix/companion-emergence · brain/files/write_guard.py
 *     · 先 expanduser/expandvars + resolve 成真路径，再做全部判断（逃逸防护）；
 *     · 硬拒绝前缀分三组：家目录敏感项（.ssh / .aws / .netrc / LaunchAgents…）、
 *       绝对系统根（/etc /usr /bin /System…）、**她自己的 persona 目录**；
 *     · op 语义互斥：create 目标已存在即拒（「create won't overwrite」）、
 *       append 目标必须已存在且是文件；
 *     · 两道字节帽：单次写入 1 MB、append 结果文件 25 MB；
 *     · 在 **propose 与 commit 两处都跑**（TOCTOU），不是只在提交时跑一次。
 *
 * 【本仓差异与后果（照抄会坏的地方）】
 *   · 本仓工作区是**虚拟路径**（/Documents /Downloads /Pictures /Audio），
 *     没有 $HOME 与真实文件系统 ⇒ 源那套 realpath / normcase 折叠必须换成
 *     「虚拟路径归一 + 大小写不敏感比较」，否则 macOS 之外的分支永远不命中。
 *   · 源拒绝 `/etc` 这类绝对根；本仓对应的是 `/Documents/system` 与
 *     `/Documents/config` 两个由外壳拥有、子 App 不该直写的目录（见 DENY_PREFIXES）。
 *   · 源的 1 MB / 25 MB 是按「笔记」定的；本仓 VFS 里还存相册与音频，
 *     故上限按 mimeType 分支：文本严、媒体松（见 BYTE_CAPS）。
 *
 * 【纪律】
 *   ① 纯函数：不读 storage、不写文件；目标是否存在由调用方以 existsOf 传入；
 *   ② 不抛：一切畸形入参返回 ok:false + 原因，永不 throw（VFS 现有 throw 另算，见接线）；
 *   ③ 只拒不说教：拒绝句带**解析后的真路径**与原因码，前端能直接显示；
 *   ④ 原因码互不同形：denied / exists / missing / too-large / ceiling / bad-path / unknown-op。
 * ======================================================== */
'use strict';

/** 外壳拥有、子 App 不该直写的虚拟目录前缀（末尾带 `/`，命中即拒）。 */
export const DENY_PREFIXES = Object.freeze([
    '/Documents/system/',
    '/Documents/config/',
    '/Pictures/system/'
]);

/** 允许的写入语义。create 不许覆盖、append 不许新建、overwrite 才是「照写」。 */
export const WRITE_OPS = Object.freeze(['create', 'append', 'overwrite']);

/** 字节帽：文本紧、媒体松。第二档是结果文件天花板（只对 append 生效）。 */
export const BYTE_CAPS = Object.freeze({
    text: { write: 1 * 1024 * 1024, ceiling: 8 * 1024 * 1024 },
    media: { write: 24 * 1024 * 1024, ceiling: 64 * 1024 * 1024 }
});

export const WRITE_REJECT_REASONS = Object.freeze({
    BAD_PATH: 'bad-path',
    DENIED: 'denied',
    EXISTS: 'exists',
    MISSING: 'missing',
    NOT_A_FILE: 'not-a-file',
    TOO_LARGE: 'too-large',
    CEILING: 'ceiling',
    UNKNOWN_OP: 'unknown-op'
});

const MEDIA_MIME_RE = /^(?:image|audio|video)\//i;

/**
 * 归一虚拟路径：折反斜杠、折重复斜杠、去尾部斜杠、去 `.` 段。
 * **不做 `..` 折叠的省略** —— `..` 段原地解析，越出根即截断到根。
 */
export function normalizeVirtualPath(rawPath) {
    const s = (typeof rawPath === 'string') ? rawPath.trim().replace(/\\/g, '/') : '';
    if (!s) return '';
    const abs = s.startsWith('/');
    const stack = [];
    for (const seg of s.split('/')) {
        if (!seg || seg === '.') continue;
        if (seg === '..') { if (stack.length) stack.pop(); continue; }
        stack.push(seg);
    }
    if (!stack.length) return abs ? '/' : '';
    return '/' + stack.join('/');
}

/** 大小写不敏感比较（源的 normcase 语义；本仓 VFS 也按不敏感处理同名冲突）。 */
export function sameVirtualPath(a, b) {
    return normalizeVirtualPath(a).toLowerCase() === normalizeVirtualPath(b).toLowerCase();
}

function isUnderDenied(norm) {
    const low = norm.toLowerCase() + (norm.endsWith('/') ? '' : '/');
    return DENY_PREFIXES.some((p) => low.startsWith(p.toLowerCase()));
}

function capsOf(mimeType) {
    return MEDIA_MIME_RE.test(String(mimeType || '')) ? BYTE_CAPS.media : BYTE_CAPS.text;
}

/**
 * 判一次写入是否可放行。**propose 与 commit 都要调**（两次之间别的地方可能改过盘）。
 * @param {object} input
 * @param {string} input.path 目标虚拟路径
 * @param {string} input.op   create / append / overwrite
 * @param {number} [input.bytes] 本次写入字节数（按 UTF-8 计，调用方算好）
 * @param {number} [input.existingBytes] 目标当前字节数（append 用；不存在传 0）
 * @param {string} [input.mimeType]
 * @param {Function} [input.existsOf] 目标是否存在：(normPath)=>boolean；缺省退回 existingBytes>0
 * @param {Function} [input.isFileOf] 目标是否文件：(normPath)=>boolean
 * @returns {{ok:boolean, path:string, reason:string, detail:string}}
 */
export function checkWriteTarget(input) {
    const o = (input && typeof input === 'object') ? input : {};
    const norm = normalizeVirtualPath(o.path);
    const fail = (reason, detail) => ({ ok: false, path: norm, reason, detail });
    if (!norm || norm === '/') return fail(WRITE_REJECT_REASONS.BAD_PATH, '空路径或只有根');
    if (norm.split('/').length < 3) return fail(WRITE_REJECT_REASONS.BAD_PATH, '必须落在二级目录下: ' + norm);
    if (isUnderDenied(norm)) return fail(WRITE_REJECT_REASONS.DENIED, norm + ' 在外壳保留目录内');

    const op = String(o.op || '');
    if (WRITE_OPS.indexOf(op) < 0) return fail(WRITE_REJECT_REASONS.UNKNOWN_OP, '未知写入语义: ' + (op || '(空)'));
    if (op !== 'overwrite' && op !== 'create' && op !== 'append') return fail(WRITE_REJECT_REASONS.UNKNOWN_OP, op);

    const exists = (typeof o.existsOf === 'function')
        ? o.existsOf(norm) === true
        : (Number(o.existingBytes) || 0) > 0;
    if (op === 'create' && exists) return fail(WRITE_REJECT_REASONS.EXISTS, '新建目标已存在: ' + norm);
    if (op === 'append') {
        if (!exists) return fail(WRITE_REJECT_REASONS.MISSING, '追加目标不存在: ' + norm);
        if (typeof o.isFileOf === 'function' && o.isFileOf(norm) !== true) {
            return fail(WRITE_REJECT_REASONS.NOT_A_FILE, '追加目标不是文件: ' + norm);
        }
    }

    const caps = capsOf(o.mimeType);
    const bytes = Number(o.bytes) || 0;
    if (bytes > caps.write) {
        return fail(WRITE_REJECT_REASONS.TOO_LARGE, bytes + ' > ' + caps.write + ' 单次上限');
    }
    if (op === 'append') {
        const existing = Number(o.existingBytes) || 0;
        if (existing + bytes > caps.ceiling) {
            return fail(WRITE_REJECT_REASONS.CEILING, (existing + bytes) + ' > ' + caps.ceiling + ' 文件天花板');
        }
    }
    return { ok: true, path: norm, reason: '', detail: '' };
}

/** UTF-8 字节数（不引 TextEncoder：纯函数要保持可在无宿主环境跑）。 */
export function utf8Bytes(text) {
    const s = (typeof text === 'string') ? text : String(text == null ? '' : text);
    let n = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s.codePointAt(i);
        if (c === undefined) continue;
        if (c > 0xFFFF) { n += 4; i++; }
        else if (c > 0x7FF) n += 3;
        else if (c > 0x7F) n += 2;
        else n += 1;
    }
    return n;
}

/** 一行拒绝文案（视图直接用；原因码不翻译，便于诊断页归因）。 */
export function writeRejectLine(r) {
    const o = (r && typeof r === 'object') ? r : {};
    if (o.ok === true) return '可写: ' + String(o.path || '');
    return '写不了(' + String(o.reason || 'unknown') + '): ' + String(o.detail || '');
}

/** 自检：三个拒绝分支都真拒、一个放行分支真放。 */
export function writeGuardSelfCheck() {
    const bad = [];
    if (normalizeVirtualPath('/Documents//a/../b.txt') !== '/Documents/b.txt') bad.push('归一不折 .. 与重复斜杠');
    if (checkWriteTarget({ path: '/Documents/system/x.json', op: 'overwrite' }).ok) bad.push('外壳保留目录未拒');
    if (checkWriteTarget({ path: '/Documents/a.txt', op: 'create', existsOf: () => true }).ok) bad.push('create 覆盖未拒');
    if (checkWriteTarget({ path: '/Documents/a.txt', op: 'append', existsOf: () => false }).ok) bad.push('append 新建未拒');
    if (checkWriteTarget({ path: '/Documents/a.txt', op: 'overwrite', bytes: BYTE_CAPS.text.write + 1 }).ok) bad.push('超单次上限未拒');
    if (!checkWriteTarget({ path: '/Documents/a.txt', op: 'overwrite', bytes: 10 }).ok) bad.push('正常写入被拒');
    if (!checkWriteTarget({ path: '/Audio/a.mp3', op: 'overwrite', bytes: BYTE_CAPS.text.write * 3, mimeType: 'audio/mpeg' }).ok) bad.push('媒体上限未分支');
    return { ok: bad.length === 0, bad };
}