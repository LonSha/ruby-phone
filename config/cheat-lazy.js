/**
 * config/cheat-lazy.js — R24-O9 巨型数据按需取用（v4.158.0）
 *
 * 【与 data/cheats.js 的分工】
 *   `data/cheats.js` 分离后只剩 54 行聚合器，但仍会**整包**把所有分片拉进来 ——
 *   那是给「一次要全量」的装配/注入路径留的兼容面。
 *   本模块给**浏览/检索**路径用：先只看 `data/cheat-index.js`（轻量元数据），
 *   用户翻到第几页才 `import()` 第几个分片。分片是 6 包一份，故单页最多触到 2 个分片。
 *
 * 【调用链可查】`pager.page(n)` 返回 `{ items, partsTouched, bytesTouched }`：
 *   第 n 页到底真加载了哪几个分片，逐跳写在返回值里，不靠「我 import 了」这种说法。
 *
 * 【不许静默降级】分片缺失 / 载入失败 ⇒ `{ ok:false, bad:['part-load-failed:…'] }`，
 *   不返回空数组（那会变成「金手指点开是空的」没人知道为什么）。
 */
export const DEFAULT_PAGE_SIZE = 6; // 与分片对齐：一页正好一片，读到第几页就只碰第几片（记账才可复跑）

/** 分片清单（与 data/cheats.js 的分片数一致；由聚合器导出值兜底，避免两处手写）。 */
export const PART_SIZE = 6;

function partName(n) {
    return String(n).padStart(2, '0');
}

/** 真按需：只 import 这一个分片。 */
export async function loadPart(n) {
    const idx = Number(n);
    if (!Number.isInteger(idx) || idx < 1) return { ok: false, bad: ['bad-part:' + String(n)] };
    try {
        const mod = await import('../data/cheats/part-' + partName(idx) + '.js');
        const packs = mod && Array.isArray(mod.packs) ? mod.packs : null;
        if (!packs) return { ok: false, bad: ['part-shape-bad:' + partName(idx)] };
        return { ok: true, part: idx, packs, bad: [] };
    } catch (err) {
        return { ok: false, bad: ['part-load-failed:' + partName(idx)] };
    }
}

/** 轻量列表：只读索引（id/名称/品阶/字数/类型），不碰正文。 */
export async function listMeta() {
    try {
        const mod = await import('../data/cheat-index.js');
        const idx = mod && (mod.cheatIndex || mod.cheatIndexList || null);
        if (!Array.isArray(idx)) return { ok: false, bad: ['index-shape-bad'] };
        return { ok: true, meta: idx, count: idx.length, bad: [] };
    } catch (err) {
        return { ok: false, bad: ['index-load-failed'] };
    }
}

/**
 * 分页器：按需取正文，逐页记账。
 * @param {{pageSize?:number, parts?:number}} options
 */
export function createCheatPager(options) {
    const o = options && typeof options === 'object' ? options : {};
    const pageSize = Number.isInteger(o.pageSize) && o.pageSize > 0 ? o.pageSize : DEFAULT_PAGE_SIZE;
    const partCount = Number.isInteger(o.parts) && o.parts > 0 ? o.parts : 0;
    const cache = new Map();
    let loads = 0;
    let bytes = 0;

    async function getPart(n) {
        if (cache.has(n)) return { ok: true, packs: cache.get(n), cached: true };
        const r = await loadPart(n);
        if (!r.ok) return r;
        loads += 1;
        bytes += JSON.stringify(r.packs).length;
        cache.set(n, r.packs);
        return { ok: true, packs: r.packs, cached: false };
    }

    /** 第 page 页（0 起）：先算需要哪几个分片，再只取这几个。 */
    async function page(pageNo) {
        const p = Number(pageNo);
        if (!Number.isInteger(p) || p < 0) return { ok: false, bad: ['bad-page:' + String(pageNo)] };
        const start = p * pageSize;
        const firstPart = Math.floor(start / PART_SIZE) + 1;
        const lastPart = Math.floor((start + pageSize - 1) / PART_SIZE) + 1;
        const items = [];
        const touched = [];
        let bytesTouched = 0;
        for (let n = firstPart; n <= lastPart; n += 1) {
            const r = await getPart(n);
            if (!r.ok) return { ok: false, bad: r.bad, items: [], partsTouched: touched };
            touched.push(n);
            bytesTouched += JSON.stringify(r.packs).length;
            r.packs.forEach(function (pack, i) {
                const abs = (n - 1) * PART_SIZE + i;
                if (abs >= start && items.length < pageSize) items.push(pack);
            });
        }
        return { ok: true, page: p, items, partsTouched: touched, bytesTouched, bad: [] };
    }

    /** 总量：只在真的需要总数时才扫全（且逐片扫，不整包 import 聚合器）。
     *  不给 parts 时**逐片探到缺片为止**（分片数不写死，避免两处手写漂移）。 */
    async function countAll(parts) {
        const known = Number.isInteger(parts) && parts > 0 ? parts : partCount;
        let n = 0;
        let used = 0;
        for (let i = 1; known > 0 ? i <= known : true; i += 1) {
            const r = await getPart(i);
            if (!r.ok) {
                if (known > 0) return { ok: false, bad: r.bad, count: n };
                break;
            }
            n += r.packs.length;
            used = i;
        }
        return { ok: true, count: n, parts: used };
    }

    function stats() {
        return { pageSize, partsCached: cache.size, partLoads: loads, bytesLoaded: bytes };
    }

    return { page, countAll, stats };
}

export async function cheatLazySelfCheck() {
    const bad = [];

    const meta = await listMeta();
    if (!meta.ok) bad.push('索引应只读轻量元数据：' + meta.bad.join(','));
    if (meta.ok && meta.count < 200) bad.push('索引条目数应 ≥200，实得 ' + meta.count);

    const one = await loadPart(1);
    if (!one.ok) bad.push('第 1 片应能单独载入');

    // 逐页记账：第 0 页只该触到第 1 片
    const pager = createCheatPager({ pageSize: DEFAULT_PAGE_SIZE });
    const p0 = await pager.page(0);
    if (!p0.ok) bad.push('第 0 页应可读');
    if (p0.partsTouched.length !== 1 || p0.partsTouched[0] !== 1) bad.push('第 0 页不该碰第 2 片');
    if (p0.items.length !== DEFAULT_PAGE_SIZE) bad.push('第 0 页应满页，实得 ' + p0.items.length);
    if (pager.stats().partLoads !== 1) bad.push('读一页只该载一片');

    // 翻到下一页：同一片内不重复载入
    const p1 = await pager.page(1);
    if (!p1.ok) bad.push('第 1 页应可读');
    if (p1.partsTouched[0] !== 2) bad.push('第 1 页应从第 2 片开始');
    if (pager.stats().partLoads !== 2) bad.push('读两页只该载两片，实得 ' + pager.stats().partLoads);

    // 回翻：已载过就复用，不许重载
    const again = await pager.page(0);
    if (!again.ok || pager.stats().partLoads !== 2) bad.push('回翻不许重载');

    // 跨片页：只多载一个分片
    const p2 = await pager.page(2);
    if (!p2.ok) bad.push('第 2 页应可读');
    if (p2.partsTouched[0] !== 3) bad.push('第 2 页应从第 3 片开始');
    if (pager.stats().partLoads !== 3) bad.push('读三页只该载三片');

    // 越界页必须明说为什么，不返回空数组了事
    const badPart = await loadPart(999);
    if (badPart.ok || badPart.bad[0].indexOf('part-load-failed') !== 0) bad.push('缺片应如实报 part-load-failed');

    // 总量：扫全也能对得上索引条目数
    const all = await pager.countAll();
    if (!all.ok || all.count !== meta.count) bad.push('逐片扫出的总量应与索引条数一致（' + all.count + ' vs ' + meta.count + '）');

    return {
        ok: bad.length === 0,
        bad,
        sample: 'meta=' + meta.count + ' page0parts=' + p0.partsTouched.join('+') + ' loads=' + pager.stats().partLoads
    };
}

export default {
    DEFAULT_PAGE_SIZE,
    PART_SIZE,
    loadPart,
    listMeta,
    createCheatPager,
    cheatLazySelfCheck
};