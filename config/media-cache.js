/**
 * config/media-cache.js — R24-O5 图片与媒体内存治理（v4.158.0）
 *
 * 【治的欠债】相册 / 头像 / 头像框 / 贴纸 / PV 封面都存在图片，但仓里**没有统一的图片生命周期**：
 *   谁缓存、缓存多少、什么时候释放、缩略怎么算，各 App 各写一套（或干脆不写）。
 *
 * 【三态不塌】`loaded`（在缓存里）/ `failed`（加载失败，带错误码）/ `absent`（**没有这张图**）。
 *   缺图与加载失败在界面上必须不同形 —— 把「没有」画成「坏了」会让用户去重试一张不存在的图。
 *
 * 【LRU + 字节上限】按字节而不是条数淘汰（一张 4MB 的图和一张 8KB 的头像不等价）；
 *   `release()` 挂在会话切换与 `releasePhoneInactiveResources` 上，释放次数与字节数都进读数。
 *
 * 【缩略策略】列表面只取缩略，详情面才取原图；缩略边长 = 显示尺寸 × dpr（登记可复算）。
 */
import { numOrNull } from './num-gate.js';

export const MEDIA_FACES = Object.freeze({
    loaded: '已缓存',
    failed: '加载失败',
    absent: '没有这张图'
});

export const DEFAULT_MAX_BYTES = 24 * 1024 * 1024;
export const DEFAULT_MAX_ENTRIES = 120;
const THUMB_MAX = 1024;

/**
 * @param {{maxBytes?:number, maxEntries?:number}} options
 */
export function createMediaCache(options) {
    const o = options && typeof options === 'object' ? options : {};
    const mb = numOrNull(o.maxBytes);
    const me = numOrNull(o.maxEntries);
    const maxBytes = mb !== null && mb > 0 ? Math.floor(mb) : DEFAULT_MAX_BYTES;
    const maxEntries = me !== null && me > 0 ? Math.floor(me) : DEFAULT_MAX_ENTRIES;

    const store = new Map();
    const failures = new Map();
    const absents = new Set();
    let bytes = 0;
    let hits = 0;
    let misses = 0;
    let evictions = 0;
    let releaseCount = 0;
    let releasedBytes = 0;

    function touch(key) {
        const entry = store.get(key);
        if (!entry) return null;
        store.delete(key);
        store.set(key, entry);
        return entry;
    }

    function evictOne() {
        const oldest = store.keys().next();
        if (oldest.done) return false;
        const key = oldest.value;
        const entry = store.get(key);
        store.delete(key);
        bytes -= entry.bytes;
        evictions += 1;
        return true;
    }

    /** 声明「这张图不存在」——与 failed 分开登记。 */
    function markAbsent(key) {
        absents.add(String(key));
        failures.delete(String(key));
        return { face: 'absent' };
    }

    function putLoaded(key, payload) {
        const k = String(key);
        const p = payload && typeof payload === 'object' ? payload : {};
        const size = numOrNull(p.bytes);
        if (size === null || size < 0) return { ok: false, reason: 'bad-bytes' };
        absents.delete(k);
        failures.delete(k);
        const existing = store.get(k);
        if (existing) { bytes -= existing.bytes; store.delete(k); }
        const entry = { bytes: Math.floor(size), meta: p.meta && typeof p.meta === 'object' ? p.meta : {}, seq: evictions + hits + misses };
        store.set(k, entry);
        bytes += entry.bytes;
        while ((bytes > maxBytes || store.size > maxEntries) && store.size > 1) {
            if (!evictOne()) break;
        }
        if (bytes > maxBytes && store.size === 1) {
            // 单张就超上限：不缓存，如实报 too-large（不许悄悄塞进内存）
            const only = store.get(k);
            store.delete(k);
            bytes -= only.bytes;
            return { ok: false, reason: 'too-large', bytes: entry.bytes, limit: maxBytes };
        }
        return { ok: true, face: 'loaded', bytes: entry.bytes, totalBytes: bytes };
    }

    function putFailed(key, errorCode) {
        const k = String(key);
        failures.set(k, String(errorCode || 'unknown'));
        return { face: 'failed', code: String(errorCode || 'unknown') };
    }

    /** 读：loaded / absent / failed / miss 四形可分辨。 */
    function get(key) {
        const k = String(key);
        if (absents.has(k)) { misses += 1; return { face: 'absent' }; }
        if (failures.has(k)) { misses += 1; return { face: 'failed', code: failures.get(k) }; }
        const entry = touch(k);
        if (!entry) { misses += 1; return { face: 'missing' }; }
        hits += 1;
        return { face: 'loaded', bytes: entry.bytes, meta: entry.meta };
    }

    /** 缩略策略：显示尺寸 × dpr，夹到 [64, 1024] 并取整。 */
    function thumbnail(size) {
        const s = size && typeof size === 'object' ? size : {};
        const w = numOrNull(s.width);
        const dpr = numOrNull(s.dpr);
        const ratio = dpr === null || dpr <= 0 ? 1 : dpr;
        if (w === null || w <= 0) return { face: 'invalid', reason: 'bad-width', side: null };
        const raw = w * ratio;
        const side = Math.max(64, Math.min(THUMB_MAX, Math.round(raw)));
        return { face: 'ok', side, sourceWidth: w, dpr: ratio, clamped: side !== Math.round(raw) };
    }

    function release(reason) {
        const freed = bytes;
        store.clear();
        failures.clear();
        absents.clear();
        bytes = 0;
        releaseCount += 1;
        releasedBytes += freed;
        return { ok: true, freedBytes: freed, reason: String(reason || 'session-changed') };
    }

    function stats() {
        const total = hits + misses;
        return {
            bytes,
            maxBytes,
            entries: store.size,
            maxEntries,
            hits,
            misses,
            hitRate: total === 0 ? null : Math.round((hits / total) * 1000) / 1000,
            evictions,
            releaseCount,
            releasedBytes,
            failures: failures.size,
            absents: absents.size
        };
    }

    return { get, putLoaded, putFailed, markAbsent, thumbnail, release, stats };
}

export function mediaCacheSelfCheck() {
    const bad = [];
    const cache = createMediaCache({ maxBytes: 1000, maxEntries: 10 });

    if (cache.get('a').face !== 'missing') bad.push('未缓存应是 missing');
    cache.putLoaded('a', { bytes: 400 });
    if (cache.get('a').face !== 'loaded') bad.push('缓存后应 loaded');
    if (cache.stats().hits !== 1) bad.push('命中应计数');

    cache.putLoaded('b', { bytes: 400 });
    cache.putLoaded('c', { bytes: 400 });
    const st = cache.stats();
    if (st.bytes > 1000) bad.push('字节上限必须生效');
    if (st.evictions === 0) bad.push('超上限应淘汰');
    if (cache.get('b').face !== 'loaded') bad.push('LRU 应保留最近写入的 b');
    if (cache.get('a').face !== 'missing') bad.push('LRU 应淘汰最久未用的 a');

    cache.markAbsent('ghost');
    if (cache.get('ghost').face !== 'absent') bad.push('缺图应 absent');
    cache.putFailed('broken', 'HTTP_404');
    const failed = cache.get('broken');
    if (failed.face !== 'failed' || failed.code !== 'HTTP_404') bad.push('失败应带错误码');
    if (cache.get('ghost').face === cache.get('broken').face) bad.push('absent 与 failed 必须不同形');

    const too = createMediaCache({ maxBytes: 100 }).putLoaded('huge', { bytes: 500 });
    if (too.ok || too.reason !== 'too-large') bad.push('单张超上限应拒缓存并报 too-large');

    const thumb = cache.thumbnail({ width: 320, dpr: 2 });
    if (thumb.side !== 640) bad.push('缩略应按 dpr 放大');
    if (cache.thumbnail({ width: 2000, dpr: 3 }).side !== THUMB_MAX) bad.push('缩略应有上限');
    if (cache.thumbnail({}).face !== 'invalid') bad.push('缺宽度应 invalid');

    const before = cache.stats().bytes;
    const rel = cache.release('chat-changed');
    if (!rel.ok || rel.freedBytes !== before) bad.push('释放应清空并报释放字节');
    if (cache.stats().bytes !== 0) bad.push('释放后占用应为 0');
    if (cache.get('a').face !== 'missing') bad.push('释放后不应再有缓存命中');

    return { ok: bad.length === 0, bad, sample: 'evictions=' + st.evictions + ' hitRate=' + st.hitRate };
}

export default {
    MEDIA_FACES,
    DEFAULT_MAX_BYTES,
    DEFAULT_MAX_ENTRIES,
    createMediaCache,
    mediaCacheSelfCheck
};