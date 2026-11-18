/* ============================================================
 * config/error-readable.js — 错误可读化 [R25-O9]
 * ------------------------------------------------------------
 * 【治的欠账】
 *   R25-O9 原文：「异常目前是控制台原文，用户侧无解释、无建议、无诊断包」。
 *   现在用户看到的要么是 `Cannot read properties of null (reading 'render')`，
 *   要么什么都没有（只有控制台红字）。报障时只能截图。
 *
 * 【本模块的立场（三条，全是刻意）】
 *   ① **人话不是猜测**：只有拿到明确信号才归族（`kind:'load-failed'`、`QuotaExceededError`、
 *      明确的 permission 文案…）。归不进去就是 `unknown`，**如实说「没归类」**，
 *      不为了好看硬编一个原因 —— 编错原因比不给原因更贵（用户会照着错的建议去操作）。
 *   ② **建议可以缺席，但不能假装有**：`actions` 为空就是空，`advice` 仍给「能做的事」；
 *      绝不渲染一个点了没用的「一键修复」。
 *   ③ **诊断包可复算、不含正文**：同样的输入 + 同样的 `at` ⇒ 逐字节相同的文本；
 *      消息只留前 `MAX_PACK_MESSAGE` 字，且链接/超长 token 抹成 `…`。
 *      包是给人贴到 issue 里的，不是把聊天记录搬出去（本仓「导出不含正文」同族纪律）。
 *
 * 用法：
 *   const info = classifyError(err, { kind: 'load-failed', module: '微信' });
 *   phoneNotice(info.human, { advice: info.advice });
 *   const pack = diagnosticPackText({ ...info, version: '4.x', at: 1700000000000, recent: [...] });
 * ============================================================ */

/** 错误族 → 人话 / 建议 / 可选动作。**闭集**：不在表里的一律 unknown。 */
export const ERROR_FAMILIES = Object.freeze({
    'module-load': Object.freeze({
        human: '这个 App 的文件没能加载进来',
        advice: '先回桌面再打开一次；如果同一个 App 每次都在这里失败，那是那个模块本身坏了，不是网络问题',
        actions: Object.freeze([{ id: 'retry-open', label: '重开这个 App' }, { id: 'open-diagnose', label: '看诊断页' }])
    }),
    'network-offline': Object.freeze({
        human: '手机现在连不上网',
        advice: '确认网络开关；离线状态下聊天与查看已存内容是正常的，别再重试联网动作',
        actions: Object.freeze([{ id: 'open-settings-network', label: '看网络设置' }])
    }),
    'network-timeout': Object.freeze({
        human: '请求等太久，超时了',
        advice: '这通常不是「没有数据」：稍后再试一次；连续超时要看是服务端慢还是本机网络差',
        actions: Object.freeze([{ id: 'retry', label: '再试一次' }])
    }),
    'not-allowed': Object.freeze({
        human: '这个操作被权限挡住了',
        advice: '检查该 App 的权限开关；被拒的操作不会「半成功」，可以放心重试',
        actions: Object.freeze([{ id: 'open-app-permissions', label: '看权限' }])
    }),
    'missing-dom': Object.freeze({
        human: '界面元素还没准备好（宿主容器不在）',
        advice: '这是时序问题：退回桌面再进去通常就好；同一 App 反复出现要看是不是渲染顺序被打乱了',
        actions: Object.freeze([])
    }),
    'storage-quota': Object.freeze({
        human: '本地存储写满了',
        advice: '先清理旧数据或导出备份再继续；写失败的那一条不会假装成功',
        actions: Object.freeze([{ id: 'open-data-health', label: '看数据占用' }])
    }),
    'render-crash': Object.freeze({
        human: '这个 App 在画界面时崩了',
        advice: '该 App 已被单独隔开，桌面仍可用；重开它一次，若仍崩请导出诊断包',
        actions: Object.freeze([{ id: 'retry-open', label: '重开这个 App' }, { id: 'open-diagnose', label: '看诊断页' }])
    }),
    'unknown': Object.freeze({
        human: '出现了没有归类的错误',
        advice: '先重试一次；如果反复出现，把诊断包贴出来（里面不含聊天正文）',
        actions: Object.freeze([{ id: 'open-diagnose', label: '看诊断页' }])
    })
});

/** 族名闭集（顺序稳定：诊断包与判据都按它遍历）。 */
export const ERROR_FAMILY_IDS = Object.freeze(Object.keys(ERROR_FAMILIES));

/** 诊断包里消息保留字符数（够定位，不够搬走一段聊天）。 */
export const MAX_PACK_MESSAGE = 80;

/** 最近动作最多带几条（包要短到能贴进 issue）。 */
export const MAX_RECENT = 5;

/** 安全取消息（不抛；null ⇒ 空串，不编「未知错误」）。 */
function messageOf(err) {
    if (err == null) return '';
    if (typeof err === 'string') return err;
    try {
        if (typeof err.message === 'string') return err.message;
        const s = String(err);
        return s === '[object Object]' ? '' : s;
    } catch (_e) { return ''; }
}

/** 安全取名。 */
function nameOf(err) {
    try {
        if (err && typeof err.name === 'string' && err.name) return err.name;
    } catch (_e) { /* 落到 NonError */ }
    return 'NonError';
}

/** 抹掉链接与超长 token（诊断包不外带 URL / base64 / 长 id）。 */
function sanitize(text) {
    return String(text == null ? '' : text)
        .replace(/https?:\/\/[^\s"'<>]+/g, '…')
        .replace(/[A-Za-z0-9+/=_-]{48,}/g, '…');
}

/**
 * 归类一条错误。**不抛**，且在没信号时如实 unknown。
 *
 * @param {*} err
 * @param {{kind?:string, module?:string}} [ctx] `kind` 来自崩溃边界（load-failed 等）
 * @returns {{family:string, code:string, human:string, advice:string, name:string,
 *            message:string, actions:Array<{id:string,label:string}>, module:string}}
 */
export function classifyError(err, ctx) {
    const c = (ctx && typeof ctx === 'object') ? ctx : {};
    const name = nameOf(err);
    const raw = messageOf(err);
    const kind = (typeof c.kind === 'string') ? c.kind : '';
    let family = 'unknown';

    if (kind === 'load-failed') {
        family = 'module-load';
    } else if (name === 'QuotaExceededError' || /quota/i.test(raw)) {
        family = 'storage-quota';
    } else if (/not allowed|permission|denied|blocked by policy/i.test(raw)) {
        family = 'not-allowed';
    } else if (/timed?\s*out|timeout/i.test(raw)) {
        family = 'network-timeout';
    } else if (/offline|failed to fetch|networkerror|network error/i.test(raw)) {
        family = 'network-offline';
    } else if (name === 'TypeError' && /cannot read|of (undefined|null)|is not a function/i.test(raw)) {
        /* 「读不到某个属性」在本仓最常见的成因是宿主容器还没建好（时序），
         * 而不是数据算错 —— 归 missing-dom 并给出「退回桌面再进」这种能真解决的建议。 */
        family = 'missing-dom';
    } else if (kind === 'render-threw') {
        family = 'render-crash';
    }

    const face = ERROR_FAMILIES[family] || ERROR_FAMILIES.unknown;
    return {
        family: family,
        code: 'err:' + family,
        human: face.human,
        advice: face.advice,
        name: name,
        message: raw,
        actions: face.actions.map((a) => ({ id: a.id, label: a.label })),
        module: (typeof c.module === 'string') ? c.module : ''
    };
}

/** 一行错误文案（toast / 卡片共用；必须包含人话，且在人话之外点名模块）。 */
export function errorLine(info) {
    const i = (info && typeof info === 'object') ? info : null;
    if (!i) return '出错：无归因';
    const who = i.module ? ('「' + i.module + '」') : '';
    return '出错' + who + '：' + (i.human || ERROR_FAMILIES.unknown.human) + '。' + (i.advice || '');
}

/**
 * 诊断包文本：**可复算**（同输入同输出）、**不含正文**、带版本与最近动作。
 *
 * @param {{family?:string, code?:string, human?:string, name?:string, message?:string,
 *          module?:string, version?:string, at?:(number|null),
 *          recent?:Array<string>}} info
 */
export function diagnosticPackText(info) {
    const i = (info && typeof info === 'object') ? info : {};
    const family = ERROR_FAMILY_IDS.indexOf(i.family) >= 0 ? i.family : 'unknown';
    const face = ERROR_FAMILIES[family];
    const msg = sanitize(messageOf(i.message)).slice(0, MAX_PACK_MESSAGE);
    const recent = Array.isArray(i.recent)
        ? i.recent.filter((x) => typeof x === 'string' && x).slice(0, MAX_RECENT).map((x) => sanitize(x).slice(0, 60))
        : [];
    const at = (typeof i.at === 'number' && Number.isFinite(i.at)) ? String(Math.floor(i.at)) : 'unknown';
    const lines = [
        '【RubyPhone 诊断包】',
        '版本：' + (typeof i.version === 'string' && i.version ? i.version : 'unknown'),
        '模块：' + (typeof i.module === 'string' && i.module ? i.module : 'unknown'),
        '错误族：' + family + '（' + face.human + '）',
        '归类码：' + (typeof i.code === 'string' && i.code ? i.code : ('err:' + family)),
        '错误名：' + (typeof i.name === 'string' && i.name ? i.name : 'NonError'),
        '消息摘要：' + (msg || '（空）'),
        '时刻：' + at,
        '最近动作：' + (recent.length ? recent.join(' → ') : '（无记录）'),
        '说明：本包不含聊天正文；同一输入重算结果逐字节一致。'
    ];
    return lines.join('\n');
}
