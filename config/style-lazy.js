/* ============================================================
 * config/style-lazy.js — 样式懒加载内核 [R25-O4]
 * ------------------------------------------------------------
 * 【治的欠债（先取证，再动手）】
 *   phone.css 曾长期是 22644 行 / 720288 字节的**整包**：89 个 App 里有 76 个的样式
 *   全被塞进这一个文件，桌面首屏就要把它们全部下载并解析完 —— 而你此刻可能只是
 *   在看桌面。本仓另一条路（机制 B）早就存在：album / diary / weibo 在自己的 App 里
 *   注入 <link>。两种投递机制并存了很久，但**它们从不是同一件事**：机制 A 付首屏
 *   代价，机制 B 付打开时代价；而两边都没有「谁占了多少首屏字节」的读数。
 *
 * 【本模块是什么 / 不是什么】
 *   ✅ 是「样式懒加载」的账 + 执行器：哪些 App 的样式已搬出 phone.css、各自搬走了
 *      多少字节、打开该 App 时真加载到了没有（回执 + 三态）。
 *   ❌ 不是「自动把 CSS 拆小」的魔法：搬哪些块由**人**决定（见 STYLE_LAZY 每条 why），
 *      搬之前必须满足两条硬条件，否则宁可不动：
 *      ① 该块与 apps/<id>/<id>.css 逐条等价（只差空白/注释）—— 否则搬定就是偷偷改外观；
 *      ② 块里每条可搬规则的类前缀全属本 App（共享前缀如 .is-* 一律留在 phone.css）——
 *         否则搬定就是拿别的 App 的样式当代价。这两条由 tools/split_phone_css_lazy.mjs
 *         在搬的当场验，验不过就不搬（工具 exit 3，不改文件）。
 *
 * 【三态不塌（本仓老规矩）】
 *   · bundled ：不是懒加载 App（样式在首屏，没打算动）—— 与「懒加载已就绪」不同形；
 *   · loaded  ：真加载到了（ok 只认 === true）；
 *   · degraded：请求失败/超时 —— App **照开**（界面可能裸奔，但样式不能挂住整机），
 *               回执里写明 reason，collect() 单独计数，绝不当成「已加载」；
 *   · unknown ：没等到结果 —— 不等于失败，也不等于成功。
 *
 * 【为什么 doc 要注入，而不是直接摸 document】
 *   本仓纪律「测不到的边界等于没写」：无宿主环境下 document 不存在，把 DOM 写在模块
 *   顶层就会让整个文件在 node 里不可 import（测试里永远测不到它）。故 createStyleLoader
 *   把 doc / 钟 当参数收 —— 测试用假 doc 把「同 id 已存在但没 settle」「错一次就把
 *   promise 永久写死」这些边界真造出来。
 * ============================================================ */

/** 已搬出 phone.css 的样式表（appId → 自带 css 文件）。
 *  bytes 是**从 phone.css 里真搬走的字节数**（由迁移工具算完写入，不是估的）。
 *  prefixes 是该 App 独有的类前缀族：迁出时只有「全部前缀都属于自己」的规则才搬。 */
export const STYLE_LAZY = Object.freeze([
    { appId: 'cotdesk', css: './apps/cotdesk/cotdesk.css', prefixes: ['cd'], bytes: 8817, why: '思维链案头：只有打开才看得到，首屏用不到' },
    { appId: 'doujin', css: './apps/doujin/doujin.css', prefixes: ['djn'], bytes: 12569, why: '同人商店：只有打开才看得到' },
    { appId: 'pvdesk', css: './apps/pvdesk/pvdesk.css', prefixes: ['pvd'], bytes: 9049, why: 'PV 案头：只有打开才看得到' },
    { appId: 'musicdesk', css: './apps/musicdesk/musicdesk.css', prefixes: ['msd'], bytes: 12260, why: '曲库案头：只有打开才看得到' },
    { appId: 'needsim', css: './apps/needsim/needsim.css', prefixes: ['nsm'], bytes: 15594, why: '需求沙盘：只有打开才看得到' },
    { appId: 'kettle', css: './apps/kettle/kettle.css', prefixes: ['ktl'], bytes: 11306, why: '对话水壶：只有打开才看得到' },
    { appId: 'sourcebook', css: './apps/sourcebook/sourcebook.css', prefixes: ['sbr'], bytes: 13719, why: '时光胶囊：只有打开才看得到' },
    { appId: 'soundkit', css: './apps/soundkit/soundkit.css', prefixes: ['snd'], bytes: 9846, why: '音效盒：只有打开才看得到' },
    { appId: 'affairs', css: './apps/affairs/affairs.css', prefixes: ['af'], bytes: 3481, why: '事务台：只有打开才看得到' }
]);

/** 一次打开时的样式加载超时（ms）。超时不是「失败」，是「没等到」。 */
export const STYLE_LAZY_TIMEOUT_MS = 4000;

/** 查一条懒加载记账（不在此表 ⇒ null：'没登记' 与 '登记了但没加载' 两种形态不同）。 */
export function styleLazyEntry(appId) {
    const id = String(appId == null ? '' : appId);
    if (!id) return null;
    for (const e of STYLE_LAZY) {
        if (e.appId === id) return e;
    }
    return null;
}

/** 首屏少付了多少字节（只算真搬走的，不把「将搬」算进去）。
 *  空表 ⇒ bytesOut=0 且 count=0（这里是「确实一条都没搬」；若表本身读不到，
 *  调用方应报 unknown 而不是 0 —— 与 num-gate 同族口径）。 */
export function styleLazyBudget(entries) {
    const list = Array.isArray(entries) ? entries : STYLE_LAZY;
    let out = 0;
    const apps = [];
    for (const e of list) {
        if (!e || typeof e.appId !== 'string' || !e.appId) continue;
        const b = Number(e.bytes);
        if (Number.isFinite(b) && b > 0) out += b;
        apps.push(e.appId);
    }
    return { bytesOut: out, count: apps.length, apps: apps };
}

/** 一条注入计划：要插入的 link 的 id / href。bundled 档也给出计划（mode 不同形），
 *  免得调用方自己写 if(entry) 时把两种形态混成一条路。 */
export function stylePlan(appId, baseUrl) {
    const e = styleLazyEntry(appId);
    if (!e) return { mode: 'bundled', appId: String(appId == null ? '' : appId) };
    const base = String(baseUrl == null ? '' : baseUrl);
    return {
        mode: 'lazy',
        appId: e.appId,
        href: base + e.css,
        linkId: 'app-style-' + e.appId,
        bytes: e.bytes
    };
}

/** 回执：ok 只认 === true；face 三态分开（loaded / degraded / unknown / bundled）。
 *  outcome = { loaded?: boolean|null, elapsedMs?: number|null, reason?: string }
 *  loaded 为 null ⇒ 没等到结果（unknown），不等于 false，也不等于 true。 */
export function styleReceipt(plan, outcome) {
    const p = plan && typeof plan === 'object' ? plan : {};
    const o = outcome && typeof outcome === 'object' ? outcome : {};
    if (p.mode !== 'lazy') {
        return { ok: true, face: 'bundled', appId: String(p.appId || ''), href: '', bytes: 0, elapsedMs: null, reason: '样式在首屏（本 App 不做懒加载）' };
    }
    const loaded = o.loaded === true ? true : (o.loaded === false ? false : null);
    const ms = (o.elapsedMs === null || o.elapsedMs === undefined) ? null : (Number.isFinite(Number(o.elapsedMs)) ? Number(o.elapsedMs) : null);
    const face = loaded === true ? 'loaded' : (loaded === false ? 'degraded' : 'unknown');
    return {
        ok: loaded === true,
        face: face,
        appId: String(p.appId || ''),
        href: String(p.href || ''),
        bytes: Number(p.bytes) || 0,
        elapsedMs: ms,
        reason: String(o.reason == null ? '' : o.reason)
    };
}

/** 前后对比：首屏 CSS 字节少了多少（百分比，负数=变小）。缺任何一边 / 基线 ≤ 0 ⇒ unknown。 */
export function styleVerdict(beforeBytes, afterBytes, tolerancePct) {
    /* null / undefined 必须当「没读数」：Number(null) 是 0，直接进运算会得出
     * 「-100% ⇒ improved」这种假结论（本仓反复治过的「读不到冒充很快」）。 */
    if (beforeBytes === null || beforeBytes === undefined || afterBytes === null || afterBytes === undefined) {
        return { face: 'unknown', deltaPct: null };
    }
    const b = Number(beforeBytes);
    const a = Number(afterBytes);
    const tol = Number.isFinite(Number(tolerancePct)) ? Math.abs(Number(tolerancePct)) : 1;
    if (!Number.isFinite(b) || !Number.isFinite(a) || b <= 0 || a < 0) return { face: 'unknown', deltaPct: null };
    const deltaPct = Math.round(((a - b) / b) * 1000) / 10;
    const face = Math.abs(deltaPct) <= tol ? 'same' : (deltaPct < 0 ? 'improved' : 'regressed');
    return { face: face, deltaPct: deltaPct };
}

/** 执行器：把 plan 变成一次真注入，并留下回执。
 *  - 同一 appId 只注入一次（并发打开同一 App 不许插两个 link）；
 *  - 已存在同 id 且 href 一致的 link ⇒ 接它的 load/error（不重复插），
 *    已经 dataset.appStyleLoaded === 'true' 的直接算 loaded；
 *  - 失败/超时**不清缓存**：本次已判定 degraded，回执会记下 reason；
 *    下次打开会**重试一次**（清掉旧节点后重建），因为样式是最可重试的东西；
 *  - 全程不抛：任何异常都归成 degraded 回执，绝不向上传。 */
export function createStyleLoader(opts) {
    const o = opts && typeof opts === 'object' ? opts : {};
    const doc = o.doc || (typeof document !== 'undefined' ? document : null);
    const baseUrl = String(o.baseUrl == null ? '' : o.baseUrl);
    const now = (typeof o.now === 'function') ? o.now : null;
    const timeoutMs = Number.isFinite(Number(o.timeoutMs)) ? Number(o.timeoutMs) : STYLE_LAZY_TIMEOUT_MS;
    const setT = (typeof o.setTimeout === 'function') ? o.setTimeout : (typeof setTimeout === 'function' ? setTimeout : null);
    const clearT = (typeof o.clearTimeout === 'function') ? o.clearTimeout : (typeof clearTimeout === 'function' ? clearTimeout : null);
    const receipts = [];
    const inflight = new Map();
    let loadedCount = 0;
    let degradedCount = 0;
    let unknownCount = 0;

    function readNow() {
        if (!now) return null;
        try {
            const n = now();
            return Number.isFinite(n) ? n : null;
        } catch (_e) { return null; }
    }
    function since(t0) {
        if (t0 === null) return null;
        const t1 = readNow();
        return t1 === null ? null : t1 - t0;
    }
    function note(receipt) {
        receipts.push(receipt);
        if (receipt.face === 'loaded') loadedCount += 1;
        else if (receipt.face === 'degraded') degradedCount += 1;
        else if (receipt.face === 'unknown') unknownCount += 1;
        if (receipts.length > 64) receipts.shift();
        return receipt;
    }

    function ensure(appId) {
        const plan = stylePlan(appId, baseUrl);
        if (plan.mode !== 'lazy') return Promise.resolve(styleReceipt(plan, null));
        if (!doc || typeof doc.createElement !== 'function' || !doc.head) {
            return Promise.resolve(note(styleReceipt(plan, { loaded: null, elapsedMs: null, reason: 'no-doc（无宿主：样式未尝试）' })));
        }
        if (inflight.has(plan.appId)) return inflight.get(plan.appId);
        const t0 = readNow();
        const p = new Promise((resolve) => {
            let settled = false;
            let timer = null;
            const settle = (loaded, reason) => {
                if (settled) return;
                settled = true;
                if (timer !== null && clearT) { try { clearT(timer); } catch (_e) {} }
                inflight.delete(plan.appId);
                resolve(note(styleReceipt(plan, { loaded: loaded, elapsedMs: since(t0), reason: reason })));
            };
            try {
                const existing = (typeof doc.getElementById === 'function') ? doc.getElementById(plan.linkId) : null;
                if (existing) {
                    if (String(existing.href || '') === plan.href) {
                        if (existing.dataset && existing.dataset.appStyleLoaded === 'true') { settle(true, 'already-loaded'); return; }
                        existing.addEventListener('load', () => settle(true, 'existing-load'), { once: true });
                        existing.addEventListener('error', () => settle(false, 'existing-error'), { once: true });
                        if (setT) timer = setT(() => settle(null, 'timeout-existing'), timeoutMs);
                        return;
                    }
                    /* href 变了（版本号/路径迁移）：旧节点会让新旧两套规则同时生效 ⇒ 先摘掉。 */
                    try { existing.remove(); } catch (_e) {}
                }
                const link = doc.createElement('link');
                link.id = plan.linkId;
                link.rel = 'stylesheet';
                link.href = plan.href;
                link.addEventListener('load', () => {
                    try { link.dataset.appStyleLoaded = 'true'; } catch (_e) {}
                    settle(true, 'load');
                }, { once: true });
                link.addEventListener('error', () => settle(false, 'error'), { once: true });
                doc.head.appendChild(link);
                if (setT) timer = setT(() => settle(null, 'timeout'), timeoutMs);
            } catch (e) {
                settle(false, 'throw:' + String((e && e.message) || e));
            }
        });
        inflight.set(plan.appId, p);
        return p;
    }

    function collect() {
        const budget = styleLazyBudget();
        return {
            entryCount: budget.count,
            bytesOut: budget.bytesOut,
            loaded: loadedCount,
            degraded: degradedCount,
            unknown: unknownCount,
            receipts: receipts.slice()
        };
    }

    return { ensure: ensure, collect: collect };
}

/** 内核自检：五条边界各有真样例（自己坏了要先发现，而不是拿它下结论）。 */
export function styleLazySelfCheck() {
    const items = [];
    const push = (name, ok, detail) => items.push({ name: name, ok: !!ok, detail: detail });
    const budget = styleLazyBudget();
    push('搬出字节合计必须与逐条相加一致', budget.bytesOut === STYLE_LAZY.reduce((s, e) => s + (Number(e.bytes) || 0), 0) && budget.count === STYLE_LAZY.length, String(budget.bytesOut) + 'B / ' + budget.count + ' 个 App');
    const a = stylePlan('needsim', 'https://x/');
    push('懒加载 App 的计划必须带 link id 与 href', a.mode === 'lazy' && a.linkId === 'app-style-needsim' && a.href === 'https://x/./apps/needsim/needsim.css', JSON.stringify(a));
    const b = stylePlan('wechat', 'https://x/');
    push('未登记的 App ⇒ bundled（不是 lazy 的空壳）', b.mode === 'bundled' && b.appId === 'wechat', JSON.stringify(b));
    const okR = styleReceipt(a, { loaded: true, elapsedMs: 12 });
    const badR = styleReceipt(a, { loaded: false, elapsedMs: 30, reason: 'error' });
    const noR = styleReceipt(a, { loaded: null, elapsedMs: null, reason: 'timeout' });
    push('回执三态不同形：loaded ok=true / degraded ok=false / unknown ok=false 且 face 不同', okR.ok === true && okR.face === 'loaded' && badR.ok === false && badR.face === 'degraded' && noR.ok === false && noR.face === 'unknown', okR.face + ' / ' + badR.face + ' / ' + noR.face);
    const v1 = styleVerdict(720288, 627692, 1);
    const v2 = styleVerdict(720288, null, 1);
    push('前后对比：真变小 ⇒ improved；缺一边 ⇒ unknown（不拿 0 冒充）', v1.face === 'improved' && v1.deltaPct < 0 && v2.face === 'unknown' && v2.deltaPct === null, JSON.stringify(v1) + ' / ' + JSON.stringify(v2));
    return { ok: items.every((i) => i.ok), items: items };
}
