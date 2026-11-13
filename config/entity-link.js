/* ============================================================
 * config/entity-link.js — [v4.147.0 · 第二十一期 批次D 第二步 R21-O8 跨 App 实体归并]
 * 「这 3 条是同一件事」的归一化面（防一物多账）。
 * ------------------------------------------------------------
 * 【现有底座与差距（实勘，不是推演）】
 *   全仓持久账本恰好两本记「钱」的：
 *     · apps/shop      → shop_orders（订单 so_*，totalCents / createdAt，见 shop-data.js checkout）
 *     · apps/accounting → accounting_records（流水 rec_*，正数分 amount / at，见 accounting-data.js normalizeRecord）
 *   规格例子里写的 apps/delivery 并不存在为独立持久账：外卖/跑腿生态
 *   （apps/shop/on-demand-delivery-takeout-ecosystem.js）由 lonsha-bridge 在**内存**里
 *   持 Map，无落盘。本件如实登记：它没有账本，不在归并面 —— 不为了凑「三本账」的
 *   故事假造一本。跨 App 归并 = shop × accounting 两条真实链。
 *
 * 【归并口径】
 *   以「时间窗 + 金额指纹」双向匹配：另一本账里，金额相等（分对分）且
 *   时间差 ≤ ENTITY_LINK_WINDOW_MS 的条目都是候选。
 *   - 0 候选 → unlinked
 *   - 1 候选 → linked（entityId 由两个 {app,id} 排序后确定性派生，两次调用同值）
 *   - ≥2 候选 → ambiguous，candidates **全列**，不许挑一个（挑哪个都是猜）
 *   不做文本指纹：订单 rows 是商品名、流水 note 是自由文本，两者没有构造性
 *   对应关系 —— 拿文本猜等于把「像不像」当成「是不是」。
 *
 * 【只读铁律】本件是纯函数：不 import storage、不写任何键、不 mutate 输入。
 *   写归各 owner（shop 下单、accounting 记账各自落自己的键），这里只读快照做对账。
 * ============================================================ */

/** 三态。互斥：一个结果只能是其中之一，且由候选数唯一决定（见 linkEntity 判定）。 */
export const LINK_STATUS = Object.freeze({
    linked: 'linked',
    ambiguous: 'ambiguous',
    unlinked: 'unlinked',
});

/**
 * 时间窗（毫秒）。下单与记账不是同一瞬间（点单 → 结账），给 10 分钟。
 * 冻结导出：判据要钉住这个口径不许被静默改宽改窄。
 */
export const ENTITY_LINK_WINDOW_MS = 10 * 60 * 1000;

/** 取一侧条目的 (时间, 分) 指纹。字段名随账本不同（shop.createdAt/accounting.at）。 */
function fingerprintOf(appId, rec) {
    if (!rec || typeof rec !== 'object') return null;
    if (appId === 'shop') {
        const cents = Number(rec.totalCents);
        const t = Number(rec.createdAt);
        if (!Number.isFinite(cents) || !Number.isFinite(t)) return null;
        return { t, cents };
    }
    if (appId === 'accounting') {
        const cents = Number(rec.amount);
        const t = Number(rec.at);
        if (!Number.isFinite(cents) || !Number.isFinite(t)) return null;
        return { t, cents };
    }
    return null;
}

/** 从另一本账里找全部候选（金额相等 + 时间窗内）。全列，不截断、不排序挑选。 */
function candidatesAgainst(selfApp, selfFp, otherApp, otherArr) {
    const out = [];
    if (!selfFp || !Array.isArray(otherArr)) return out;
    for (const rec of otherArr) {
        const fp = fingerprintOf(otherApp, rec);
        if (!fp) continue;
        if (fp.cents !== selfFp.cents) continue;
        if (Math.abs(fp.t - selfFp.t) > ENTITY_LINK_WINDOW_MS) continue;
        out.push({ app: otherApp, id: String(rec.id || ''), at: fp.t, cents: fp.cents });
    }
    return out;
}

/** entityId：两个 {app,id} 排序拼接后 FNV-1a 十六进制（确定性，不引入随机）。 */
function deriveEntityId(pairA, pairB) {
    const [a, b] = [pairA, pairB].sort((x, y) =>
        (x.app + '\u0000' + x.id).localeCompare(y.app + '\u0000' + y.id));
    const s = a.app + '\u0000' + a.id + '\u0000' + b.app + '\u0000' + b.id;
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i += 1) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return 'ent_' + h.toString(16).padStart(8, '0');
}

/**
 * 归并主入口。appId ∈ {'shop','accounting'}；ledgers = { shop:[...], accounting:[...] }。
 * 返回三态之一：
 *   { status, entityId, self, sources, candidates, reason? }
 * 边界（未知 app / 找不到自身条目）一律 unlinked 且带 reason，不抛错、不猜。
 */
export function linkEntity(appId, localId, ledgers) {
    const id = String(localId || '');
    const books = (ledgers && typeof ledgers === 'object') ? ledgers : {};
    if (appId !== 'shop' && appId !== 'accounting') {
        return { status: LINK_STATUS.unlinked, entityId: null, self: { app: appId, id },
            sources: [], candidates: [], reason: 'unknown-app' };
    }
    const selfArr = Array.isArray(books[appId]) ? books[appId] : [];
    const selfRec = selfArr.find((r) => r && String(r.id || '') === id);
    const selfFp = fingerprintOf(appId, selfRec);
    if (!selfRec || !selfFp) {
        return { status: LINK_STATUS.unlinked, entityId: null, self: { app: appId, id },
            sources: [], candidates: [], reason: 'self-missing' };
    }
    const otherApp = (appId === 'shop') ? 'accounting' : 'shop';
    const candidates = candidatesAgainst(appId, selfFp, otherApp, books[otherApp]);
    const self = { app: appId, id, at: selfFp.t, cents: selfFp.cents };
    if (candidates.length === 0) {
        return { status: LINK_STATUS.unlinked, entityId: null, self,
            sources: [self], candidates: [] };
    }
    if (candidates.length === 1) {
        const c = candidates[0];
        return { status: LINK_STATUS.linked, entityId: deriveEntityId(self, c),
            self, sources: [self, c], candidates };
    }
    /* ≥2：全列候选。这里故意不给 entityId、不给「最佳」——挑一个就是猜。 */
    return { status: LINK_STATUS.ambiguous, entityId: null, self,
        sources: [self], candidates };
}
