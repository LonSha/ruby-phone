/* ============================================================
 * config/privacy-redactor.js — 敏感信息遮蔽 [R25-X3]
 * ------------------------------------------------------------
 * 【治的欠账】
 *   R25-X3 原文：「截图与分享是全量原文，手机号、金额、指定联系人一律裸露」。
 *   验收口径里最硬的一条是：**遮蔽处与原值不同形（不是打码后仍可搜）**。
 *   所以这里不做 `138****8000` 这种「保留首尾」的遮法 —— 保留的那几位仍然可搜、
 *   仍然可被拼回去。本模块一律替换成**不含任何原字符**的占位符（`‹电话›` 等）。
 *
 * 【三条纪律】
 *   ① 只认明确形状：手机号 11 位且前后不接数字；金额必须带 ¥/￥；证件 18 位；
 *      邮箱要有 @ 与点。**宁可不遮，也不误伤**（把年份、消息序号遮掉会让截图失真）。
 *   ② 幂等：已遮过的文本再遮一遍逐字节不变（占位符里没有数字/字母）。
 *   ③ 纯函数、零依赖、不碰 DOM：DOM 遍历由调用方（chat-snapshot）做，
 *      本模块只负责「一段文本 → 一段文本」。这样 Node 里能真跑判据。
 *
 * 用法：
 *   const r = redact('打 13800138000 转 ¥1,234.50 给张三');
 *   // r.text === '打 ‹电话› 转 ‹金额› 给张三'
 *   // r.hits  === [{ rule: 'phone', count: 1 }, { rule: 'amount', count: 1 }]
 *   redact(text, { names: ['张三'] });   // 规则可编辑：指定联系人名单
 * ============================================================ */

/** 规则闭集（改这里就是改规则：表驱动，不许在调用点现拼正则）。 */
export const REDACT_RULES = Object.freeze([
    Object.freeze({ id: 'phone', label: '电话', token: '‹电话›', pattern: /(^|[^\d])1[3-9]\d{9}(?!\d)/g, replace: '$1‹电话›' }),
    Object.freeze({ id: 'idcard', label: '证件', token: '‹证件›', pattern: /(^|[^\d])\d{17}[\dXx](?!\d)/g, replace: '$1‹证件›' }),
    Object.freeze({ id: 'amount', label: '金额', token: '‹金额›', pattern: /[¥￥]\s?\d[\d,]*(?:\.\d{1,2})?/g, replace: '‹金额›' }),
    Object.freeze({ id: 'email', label: '邮箱', token: '‹邮箱›', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, replace: '‹邮箱›' })
]);

/** 规则 id 闭集。 */
export const REDACT_RULE_IDS = Object.freeze(REDACT_RULES.map((r) => r.id));

/** 占位符统一以 ‹› 包裹：与正文里的任何常见字符都不同形。 */
export const NAME_TOKEN = '‹联系人›';

/**
 * 对一段文本做遮蔽。**不抛**；非字符串按空串处理（并如实返回 total=0）。
 *
 * @param {string} text
 * @param {{rules?:string[], names?:string[], all?:boolean}} [opts]
 *        rules：只跑这些规则（默认全跑）；names：指定联系人名单（命中即遮）；
 *        all: true 时把「所有规则都关掉」的名字也遮（保持接口稳定，不做隐式开关）。
 * @returns {{text:string, hits:Array<{rule:string,count:number}>, total:number, rules:string[]}}
 */
export function redact(text, opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const src = (typeof text === 'string') ? text : '';
    const wanted = Array.isArray(o.rules) && o.rules.length
        ? o.rules.filter((x) => REDACT_RULE_IDS.indexOf(x) >= 0)
        : REDACT_RULE_IDS.slice();
    const hits = [];
    let out = src;
    let total = 0;

    for (const rule of REDACT_RULES) {
        if (wanted.indexOf(rule.id) < 0) continue;
        const before = out;
        out = out.replace(rule.pattern, rule.replace);
        if (out !== before) {
            /* 计数按「替换掉了多少段」算：用同一个 pattern 在 before 上数命中。 */
            const m = before.match(rule.pattern);
            const n = m ? m.length : 1;
            hits.push({ rule: rule.id, count: n });
            total += n;
        }
    }

    /* 指定联系人：名单是用户**明确点名**的，命中即整串替换（遮多了比漏了安全）。
     *  两个刻意的取舍：
     *   ① **最长优先**：名单里同时有「张三」与「张三丰」时，先遮长的，否则短的会先把长的咬掉一半；
     *   ② **子串也算命中**：正文里的「张三丰」会被遮成「‹联系人›丰」—— 这是已知代价，
     *      写在这里而不是藏起来：宁可多遮一个字，也不要让真名漏在截图里。
     *  名单长度按 UTF-16 长度降序（稳定排序：同长保持用户给的顺序）。 */
    const names = Array.isArray(o.names)
        ? o.names.filter((n) => typeof n === 'string' && n.length >= 2).slice()
            .sort((a, b) => b.length - a.length)
        : [];
    for (const name of names) {
        if (!out.includes(name)) continue;
        const parts = out.split(name);
        const n = parts.length - 1;
        out = parts.join(NAME_TOKEN);
        hits.push({ rule: 'contact', count: n });
        total += n;
    }

    return { text: out, hits: hits, total: total, rules: wanted };
}

/** 一行回执（截图/分享后给用户的说明；必须说清「遮了几处、哪几类」）。 */
export function redactReceipt(result) {
    const r = (result && typeof result === 'object') ? result : null;
    if (!r) return '脱敏：无回执';
    if (!r.total) return '脱敏：本次没有命中敏感内容（规则 ' + ((r.rules || []).length) + ' 条）';
    const parts = (r.hits || []).map((h) => {
        const label = h.rule === 'contact' ? '联系人'
            : (REDACT_RULES.find((x) => x.id === h.rule) || { label: h.rule }).label;
        return label + ' ' + h.count + ' 处';
    });
    return '脱敏：共 ' + r.total + ' 处（' + parts.join(' · ') + '）—— 遮蔽后不可反查原值';
}