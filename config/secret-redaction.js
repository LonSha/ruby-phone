/* ========================================================
 * config/secret-redaction.js — 导出文本的密钥脱敏（纯函数）[v4.88.0 · 第七批缝入]
 * --------------------------------------------------------
 * 【这一刀治的是什么（本仓实测的真缺口）】
 *   诊断中心 / 创建工坊 / 备份导出都会把结构化对象变成可粘贴的文本交出去。
 *   这些对象里混着**真实凭据**：`config/api-manager.js` 的 profile 带 `apiKey`、
 *   模型配置带 `openai_key` / `claude_key` / `openrouter_key` / `custom_key`，
 *   代理设置还会把 key 直接塞进 `proxy_password`。
 *   修前本仓没有任何脱敏层：导出一贴进 issue 就是照着明文抄一遍 ——
 *   而比泄漏更坏的是**泄漏了看不出来**：读者无法区分「这是真 key」与「这是占位」。
 *
 * 【源形态（非描述，按源码判定）】
 *   lioensky/VCPToolBox · modules/toolResultPrivacyGuard.js
 *     · 键名判定用**边界锚定**的敏感词正则（api_key / token / secret / password /
 *       bearer / private_key / client_secret / webhook_secret …），不用 contains；
 *     · 掩码不是全遮：保留前 4 后 4，遮罩串插中间（掩码可配）；
 *     · 三个「不该当秘密」的排除：布尔 / null / 纯数字；
 *     · 另有三组高置信 token 前置正则（sk- / xox?- / ghp_ / github_pat_ / glpat- / AKIA），
 *       命中即遮，**不看键名**（键名会被拼错）；
 *     · `data:` base64 URI 整段跳过（遮了没法显示）；
 *     · maxDepth 20 递归上限，防循环对象。
 *
 * 【本仓差异与后果（照抄会坏的地方）】
 *   · 源的键名是 snake_case；本仓同时存在 camelCase（apiKey / proxyPassword）
 *     与中文包装（`密钥` / `令牌`）。只搬 snake_case 正则会漏掉本仓最要紧的那两个字段。
 *   · 本仓导出对象里很多值本身是 JSON 字符串（storage 直存），
 *     故除了按 key 遮，还要对**字符串值**跑一遍高置信 token 正则。
 *   · 短值全遮会丢信息（`abc` 全遮等于没导出），沿用源的大小判断：
 *     遮罩长度不足前+后+4 就整段换掩码，而不是露出大半。
 *
 * 【纪律】
 *   ① 纯函数，不读配置：enabled 由调用方决定（默认 false ⇒ 未开时逐字节原样返回）；
 *   ② 不抛：循环引用、getter 抛错、深度超限一律给占位串，绝不因脱敏把导出搞崩；
 *   ③ 不猜：数字/布尔/null 不动（版本号、端口、开关一眼要能读）；
 *   ④ 可逆记账：返回被遮的路径列表，视图能说「遮了 3 处」而不是静默变形。
 * ======================================================== */
'use strict';

export const REDACT_MASK = '***';
export const REDACT_MAX_DEPTH = 12;

/** 敏感键名正则集。**边界锚定**，不用 contains（`tokenizer` 不该被遮）。 */
export const SENSITIVE_KEY_RES = Object.freeze([
    /(?:^|[_\-.\s])(?:api[_\-]?key|apikey)(?:$|[_\-.\s])/i,
    /(?:^|[_\-.\s])(?:secret|client[_\-]?secret|webhook[_\-]?secret)(?:$|[_\-.\s])/i,
    /(?:^|[_\-.\s])(?:token|access[_\-]?token|refresh[_\-]?token|auth[_\-]?token|bearer)(?:$|[_\-.\s])/i,
    /(?:^|[_\-.\s])(?:password|passwd|pwd|proxy[_\-]?password)(?:$|[_\-.\s])/i,
    /(?:^|[_\-.\s])(?:credential|credentials|private[_\-]?key)(?:$|[_\-.\s])/i,
    /(?:^|[_\-.\s])(?:密钥|令牌|口令|凭据)(?:$|[_\-.\s])/
]);

/** 高置信 token 前缀。命中即遮，**不看键名**（键名会拼错，前缀不会）。 */
export const HIGH_CONFIDENCE_TOKEN_RES = Object.freeze([
    /\bsk-[A-Za-z0-9_-]{16,}\b/g,
    /\bsk-proj-[A-Za-z0-9_-]{16,}\b/g,
    /\b(?:xoxb|xoxp|xoxa|xoxr)-[A-Za-z0-9-]{16,}\b/g,
    /\bghp_[A-Za-z0-9_]{20,}\b/g,
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    /\bglpat-[A-Za-z0-9_-]{16,}\b/g,
    /\bAKIA[0-9A-Z]{16}\b/g,
    /\bAIza[0-9A-Za-z_-]{30,}\b/g
]);

const DATA_URI_RE = /^data:[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+(?:;[^,]*)?;base64,/;
const QUOTE_WRAP_RE = /^(\s*["'`]?)([\s\S]*?)(["'`]?\s*)$/;

export function isSensitiveKey(key) {
    const k = (typeof key === 'string') ? key : '';
    if (!k) return false;
    return SENSITIVE_KEY_RES.some((re) => re.test(k));
}

/** 值是否该被遮：排除空 / 布尔 / null / 短值 / 数字 / data URI。 */
export function shouldMaskValue(value, minLen = 8) {
    if (value === null || typeof value === 'undefined') return false;
    if (typeof value === 'boolean') return false;
    const v = String(value).trim();
    if (v.length < Math.max(1, Number(minLen) || 8)) return false;
    if (/^(?:true|false|null|undefined)$/i.test(v)) return false;
    if (/^-?\d+(?:\.\d+)?$/.test(v)) return false;
    if (DATA_URI_RE.test(v)) return false;
    return true;
}

/** 掩码一个值：保留前 pre 后 suf，其余换掩码；太短整段遮。 */
export function maskValue(value, opts = {}) {
    const mask = (typeof opts.mask === 'string' && opts.mask) ? opts.mask : REDACT_MASK;
    const pre = Math.max(0, Number(opts.preservePrefix) || 4);
    const suf = Math.max(0, Number(opts.preserveSuffix) || 4);
    const text = String(value);
    const m = text.match(QUOTE_WRAP_RE);
    const openQ = m ? m[1] : '';
    const core = m ? m[2] : text;
    const closeQ = m ? m[3] : '';
    if (!core || core.length <= pre + suf + 4) return openQ + mask + closeQ;
    return openQ + core.slice(0, pre) + mask + core.slice(core.length - suf) + closeQ;
}

/** 对任意字符串跑高置信 token 正则（值本身可能就是一段 JSON 文本）。 */
export function scrubTokenShapes(text, opts = {}) {
    let out = String(text == null ? '' : text);
    for (const re of HIGH_CONFIDENCE_TOKEN_RES) {
        out = out.replace(re, (hit) => maskValue(hit, opts));
    }
    return out;
}

/**
 * 脱敏一个对象/数组/标量。
 * @returns {{value:any, hits:string[]}} hits 是被遮的路径（用于「遮了几处」）
 */
export function redact(input, opts = {}) {
    const hits = [];
    const mask = (typeof opts.mask === 'string' && opts.mask) ? opts.mask : REDACT_MASK;
    const minLen = Number(opts.minSecretLength) || 8;
    const maxDepth = Number(opts.maxDepth) || REDACT_MAX_DEPTH;
    const seen = new WeakSet();

    const walk = (node, path, depth) => {
        if (node === null || typeof node === 'undefined') return node;
        if (typeof node === 'string') {
            if (path && isSensitiveKey(path.split('.').pop()) && shouldMaskValue(node, minLen)) {
                hits.push(path);
                return maskValue(node, { mask });
            }
            return scrubTokenShapes(node, { mask });
        }
        if (typeof node !== 'object') return node;
        if (depth >= maxDepth) return '[depth-limit]';
        if (seen.has(node)) return '[circular]';
        seen.add(node);
        if (Array.isArray(node)) return node.map((v, i) => walk(v, path + '[' + i + ']', depth + 1));
        const out = {};
        for (const key of Object.keys(node)) {
            const sub = path ? path + '.' + key : key;
            let v;
            try { v = node[key]; } catch (_e) { out[key] = '[getter-threw]'; continue; }
            if (isSensitiveKey(key) && shouldMaskValue(v, minLen) && typeof v !== 'object') {
                hits.push(sub);
                out[key] = maskValue(v, { mask });
                continue;
            }
            out[key] = walk(v, sub, depth + 1);
        }
        return out;
    };

    return { value: walk(input, '', 0), hits };
}

/** 一行总述。无命中时给「未遮」而不是空串，免得读者以为是漏了。 */
export function redactSummaryLine(hits) {
    const arr = Array.isArray(hits) ? hits : [];
    if (!arr.length) return '未遮（无敏感字段）';
    const head = arr.slice(0, 3).join(' · ');
    return '已遮 ' + String(arr.length) + ' 处：' + head + (arr.length > 3 ? ' …' : '');
}

/** 自检：敏感键遮、非敏感键不遮、数字不动、前缀 token 不看键名也遮、循环不炸。 */
export function redactionSelfCheck() {
    const bad = [];
    const r = redact({ apiKey: 'sk-abcdefghijklmnopqrstuvwx', port: 8080, name: 'RubyPhone', proxy_password: 'hunter2hunter2' });
    if (r.value.apiKey.indexOf(REDACT_MASK) < 0) bad.push('apiKey 未遮');
    if (r.value.proxy_password.indexOf(REDACT_MASK) < 0) bad.push('proxy_password 未遮');
    if (r.value.port !== 8080) bad.push('数字被改');
    if (r.value.name !== 'RubyPhone') bad.push('非敏感键被改');
    const t = redact({ note: '见 ghp_abcdefghijklmnopqrstuvwxyz0123 这条' });
    if (t.value.note.indexOf(REDACT_MASK) < 0) bad.push('前缀 token 未遮');
    const cyc = { a: 1 }; cyc.self = cyc;
    const c = redact(cyc);
    if (c.value.self !== '[circular]') bad.push('循环未挡');
    if (redact({ tokenizer: 'sentencepiece' }).hits.length !== 0) bad.push('tokenizer 被误当敏感键');
    return { ok: bad.length === 0, bad };
}