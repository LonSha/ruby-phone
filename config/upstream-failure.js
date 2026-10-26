/* ========================================================
 * config/upstream-failure.js —— 上游失败码表与错误文本整形
 * --------------------------------------------------------
 * 缝合两件（本仓合并成一件，理由见下）：
 *   · ttx/src/tauri/main/kernel/upstream-failure.js
 *     —— 八类网络失败码表、深 4 嵌套挖掘（details/data/error/cause）、
 *        单键 `UpstreamFailure` 拆包、endpoint 附注；
 *   · ttx/src/scripts/util/command-error-utils.js
 *     —— 七类错误前缀**循环**剥离（剥到稳定为止）、单键 enum 解包、
 *        三种形态（string / Error / object）提取。
 *   两件都只做「把上游给的那坨东西变成一句人话」，正落在同一处，故合并；
 *   合并后在档头写清两半的分工，不混写成一个「错误格式化器」。
 *
 * 【本仓修前是什么样（`config/api-manager.js` 的 `_formatError`）】
 *   它把 name / message / status / JSON / cause 五段用 ` | ` 拼起来。问题是：
 *   ① **没有任何码表** —— `network.timeout` 与 `network.dns_failed` 在界面上
 *      都是一串英文原样，用户看不出「该检查网络还是该换地址」（处置相反）；
 *   ② **不挖嵌套** —— 失败详情常埋在 `error.details.code` 或 `cause.data` 里，
 *      它只看第一层，挖不到就整串丢，于是「有码但显示成 [object Object]」；
 *   ③ **不剥前缀** —— 上游把 `Bad request: 模型不支持该参数` 整串抛上来时，
 *      界面上那句 `Bad request:` 与真正的因同权，用户得自己找后半段。
 *
 * 【纪律】
 *   ① 纯函数：不读 window、不发请求、不看时钟；
 *   ② 不抛：任何畸形（循环引用、null、函数、Symbol）一律降级，绝不因格式化而抛；
 *   ③ 码表只认**已知八码**，未知码走默认句 —— 不编一个像样的理由；
 *   ④ 前缀只剥**七类可枚举的网络/协议前缀**，不剥业务话术（「生成失败：」要留着）。
 * ======================================================== */
'use strict';

/* ── 第一半：失败码表与详情挖掘 ─────────────────────────────────────── */

/** 八类网络失败码 → 一句可执行的说明（每句都指向「该动哪里」）。 */
export const UPSTREAM_FAILURE_FALLBACKS = Object.freeze({
    'network.timeout': '请求在上游响应前超时了',
    'network.connect_failed': '连不上上游服务，检查网络 / 代理 / 地址',
    'network.proxy_failed': '经代理连接上游失败，检查代理配置',
    'network.dns_failed': '解析不到上游地址，域名或 DNS 有问题',
    'network.tls_failed': 'TLS 握手失败，证书或协议不匹配',
    'network.body_interrupted': '响应读到一半被中断',
    'network.redirect_rejected': '上游重定向被拒，改用同源的最终地址重试',
    'network.request_failed': '网络请求失败（未给出更细的码）'
});

/** 未知码的兜底句（不编理由）。 */
export const UPSTREAM_FAILURE_UNKNOWN = '上游请求失败（码不在已知表内）';

const DETAIL_CATEGORY_MIN = 1;
const DETAIL_DEPTH_MAX = 4;

function textOf(value) {
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * 单层识别：`{code, category, message_key|messageKey, endpoint?}` 齐三样才算详情。
 * 缺任一样返回 null（不四舍五入成「有码」）。
 */
export function asUpstreamFailureDetails(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Error) return null;
    const code = textOf(value.code);
    const category = textOf(value.category);
    const messageKey = textOf(value.message_key) || textOf(value.messageKey);
    if (code.length < DETAIL_CATEGORY_MIN || !category || !messageKey) return null;
    const endpoint = textOf(value.endpoint) || null;
    return { code: code, category: category, endpoint: endpoint, messageKey: messageKey };
}

const NESTED_KEYS_ERROR = Object.freeze(['details', 'data', 'error']);
const NESTED_KEYS_OBJECT = Object.freeze(['details', 'error', 'cause', 'data']);

/**
 * 递归挖掘详情。深 4 为止（源值）；`Error` 走固定三键再落 `cause`，
 * 普通对象走四键；单键 `{UpstreamFailure: …}` 是序列化包装，先拆。
 */
export function findUpstreamFailureDetails(value, depth = 0) {
    if (depth > DETAIL_DEPTH_MAX || value === null || value === undefined) return null;
    const direct = asUpstreamFailureDetails(value);
    if (direct) return direct;
    if (value instanceof Error) {
        const err = value;
        for (const key of NESTED_KEYS_ERROR) {
            if (Object.prototype.hasOwnProperty.call(err, key)) {
                const hit = findUpstreamFailureDetails(err[key], depth + 1);
                if (hit) return hit;
            }
        }
        return findUpstreamFailureDetails(err.cause, depth + 1);
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            const hit = findUpstreamFailureDetails(item, depth + 1);
            if (hit) return hit;
        }
        return null;
    }
    if (typeof value !== 'object') return null;
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === 'UpstreamFailure') {
        return findUpstreamFailureDetails(value.UpstreamFailure, depth + 1);
    }
    for (const key of NESTED_KEYS_OBJECT) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
            const hit = findUpstreamFailureDetails(value[key], depth + 1);
            if (hit) return hit;
        }
    }
    return null;
}

/** 详情 → 可读文本（已知码给专句 + endpoint 附注；未知码给兜底句）。 */
export function upstreamFailureFallbackText(details) {
    if (!details) return '';
    const message = UPSTREAM_FAILURE_FALLBACKS[details.code] || UPSTREAM_FAILURE_UNKNOWN;
    return details.endpoint ? message + '（' + details.endpoint + '）' : message;
}

/* ── 第二半：错误文本提取与前缀剥离 ─────────────────────────────────── */

/** 七类可剥前缀。**都是协议/框架话术**，不是业务结论。 */
export const ERROR_PREFIX_PATTERNS = Object.freeze([
    /^internal server error:\s*/i,
    /^internal error:\s*/i,
    /^validation error:\s*/i,
    /^bad request:\s*/i,
    /^unauthorized:\s*/i,
    /^permission denied:\s*/i,
    /^not found:\s*/i,
    /^内部错误[:：]\s*/,
    /^参数校验失败[:：]\s*/,
    /^请求无效[:：]\s*/,
    /^未授权[:：]\s*/,
    /^权限不足[:：]\s*/,
    /^未找到[:：]\s*/
]);

/**
 * 三形态提取：string 直取、Error 取 message、单键 enum `{BadRequest: "…"}` 解包。
 * 其余对象取 message（没有就 String()）。
 */
export function extractErrorText(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value.trim();
    if (value instanceof Error) {
        const message = typeof value.message === 'string' ? value.message.trim() : '';
        return message || '';
    }
    if (typeof value === 'object') {
        if (typeof value.message === 'string' && value.message.trim()) return value.message.trim();
        const keys = Object.keys(value);
        if (keys.length === 1) {
            const detail = value[keys[0]];
            if (typeof detail === 'string') return detail.trim();
        }
        return '';
    }
    return String(value).trim();
}

/**
 * 循环剥前缀，剥到**不再变化**为止（一层前缀套一层是上游最常见的形状：
 *   `Internal server error: Bad request: 模型不支持该参数` —— 剥一次还剩一层）。
 */
export function stripErrorPrefixes(message) {
    let out = String(message == null ? '' : message).trim();
    if (!out) return '';
    let previous = '';
    while (out && out !== previous) {
        previous = out;
        for (const pattern of ERROR_PREFIX_PATTERNS) {
            out = out.replace(pattern, '').trim();
        }
    }
    return out;
}

/** 组合入口：提取 → 剥前缀。空结果原样空（不补默认句）。 */
export function readableErrorText(value) {
    return stripErrorPrefixes(extractErrorText(value));
}

/**
 * 一行读数。传 `error` 时报**这一条**的归类结果；不传只报码表规模。
 *   「码表几码」是可验证的事实，「上游现在健不健康」本函数不知道 —— 不混说。
 */
export function upstreamFailureLine(error) {
    if (error === undefined) return '上游失败码表：' + Object.keys(UPSTREAM_FAILURE_FALLBACKS).length + ' 码';
    const details = findUpstreamFailureDetails(error);
    if (!details) return '上游失败码表：未识别出码';
    return '上游失败码表：' + details.code + ' → ' + upstreamFailureFallbackText(details);
}

/* ── 自检 ────────────────────────────────────────────────────────────── */
export function upstreamFailureSelfCheck() {
    const problems = [];
    const push = (ok, label) => { if (!ok) problems.push(label); };
    /* ① 八码齐备且每句非空 */
    const codes = Object.keys(UPSTREAM_FAILURE_FALLBACKS);
    push(codes.length === 8, '码表必须恰八码，实得 ' + codes.length);
    for (const c of codes) push(!!UPSTREAM_FAILURE_FALLBACKS[c], '码表句子为空: ' + c);
    /* ② 详情识别三样齐备才算 */
    push(asUpstreamFailureDetails({ code: 'network.timeout', category: 'network', message_key: 'k' }) !== null, '三样齐备必须识别');
    push(asUpstreamFailureDetails({ code: 'network.timeout', category: 'network' }) === null, '缺 messageKey 必须不识别');
    push(asUpstreamFailureDetails({ code: '', category: 'network', messageKey: 'k' }) === null, '空码必须不识别');
    push(asUpstreamFailureDetails('network.timeout') === null, '字符串不算详情');
    /* ③ 深挖：details → data → cause 三路都能挖到 */
    const target = { code: 'network.dns_failed', category: 'network', messageKey: 'k' };
    push(findUpstreamFailureDetails({ details: target }) !== null, 'details 一路挖不到');
    push(findUpstreamFailureDetails({ data: { error: target } }) !== null, 'data.error 两跳挖不到');
    const withCause = new Error('boom');
    withCause.cause = { data: target };
    push(findUpstreamFailureDetails(withCause) !== null, 'Error.cause.data 挖不到');
    /* ④ 单键 UpstreamFailure 拆包 */
    push(findUpstreamFailureDetails({ UpstreamFailure: target }) !== null, '单键包装未拆');
    /* ⑤ 深度上限 4：第 5 层挖不到，第 4 层挖得到 */
    let deep4 = target;
    for (let i = 0; i < 3; i += 1) deep4 = { details: deep4 };
    push(findUpstreamFailureDetails(deep4) !== null, '第 4 层必须还挖得到');
    let deep6 = target;
    for (let i = 0; i < 6; i += 1) deep6 = { details: deep6 };
    /* 深度上限是真上限：源用 `depth > 4` 就停，故第 5 层起挖不到 —— 这条不能被写成
     * 「反正挖得到」的软断言，否则上限被改坏也没人知道。 */
    push(findUpstreamFailureDetails(deep6) === null, '深 6 层必须被上限截断');
    /* ⑥ 文本：已知码给专句，未知码给兜底句，endpoint 附注上屏 */
    push(upstreamFailureFallbackText({ code: 'network.timeout' }).indexOf('超时') >= 0, '已知码必须给专句');
    push(upstreamFailureFallbackText({ code: 'network.nope' }) === UPSTREAM_FAILURE_UNKNOWN, '未知码必须给兜底句');
    push(upstreamFailureFallbackText({ code: 'network.timeout', endpoint: 'https://x' }).indexOf('https://x') > 0, 'endpoint 必须附注');
    push(upstreamFailureFallbackText(null) === '', '空详情必须空串');
    /* ⑦ 前缀循环剥离：两层前缀一层不剩 */
    push(readableErrorText('Internal server error: Bad request: 模型不支持该参数') === '模型不支持该参数', '两层前缀未剥干净');
    push(readableErrorText('permission denied: 缺 scope') === '缺 scope', '单层前缀未剥');
    push(readableErrorText('内部错误：读不到文件') === '读不到文件', '中文前缀未剥');
    /* ⑧ 业务话术必须保留（不是协议前缀就不剥） */
    push(readableErrorText('生成失败：额度用完') === '生成失败：额度用完', '业务前缀被误剥');
    /* ⑨ 三形态提取 */
    push(extractErrorText('  原样  ') === '原样', 'string 必须直取并 trim');
    push(extractErrorText(new Error('E1')) === 'E1', 'Error 必须取 message');
    push(extractErrorText({ BadRequest: '缺参数' }) === '缺参数', '单键 enum 必须解包');
    push(extractErrorText([1, 2]) === '', '数组无 message 必须空串');
    /* ⑩ 不抛：null / undefined / 函数 / 数字 */
    let threw = false;
    try {
        readableErrorText(null);
        readableErrorText(undefined);
        readableErrorText(() => 1);
        readableErrorText(42);
        findUpstreamFailureDetails(null);
        findUpstreamFailureDetails([]);
    } catch (_e) { threw = true; }
    push(!threw, '畸形输入不得抛');
    push(readableErrorText(null) === '', 'null 必须空串');
    return { ok: problems.length === 0, problems: problems };
}

export default {
    UPSTREAM_FAILURE_FALLBACKS, UPSTREAM_FAILURE_UNKNOWN, ERROR_PREFIX_PATTERNS,
    asUpstreamFailureDetails, findUpstreamFailureDetails, upstreamFailureFallbackText,
    extractErrorText, stripErrorPrefixes, readableErrorText, upstreamFailureLine, upstreamFailureSelfCheck
};