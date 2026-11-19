/**
 * config/media-cache-hooks.js — R24-O5 的**边界层**
 *
 * 【为什么单开一个文件，而不是把两行直接写进 index.js】
 * index.js 是匿名 IIFE 入口，**不可 import**。写在里面的调用只能靠「源码里有没有这行字」
 * 来证明 —— 那正是本仓反复付代价的「写了函数没人调」。抽成薄钩子后：
 *   ① 判据能真调它、真断言「释放发生了 / 释放了多少字节 / reason 是什么」；
 *   ② 负控制能真把 release 摘掉，行为断言必须转红（不是读源码）；
 *   ③ 异常安全各自成态（cache 缺失 / release 抛错），不塌成「成功」。
 *
 * 【三态不塌（读数面）】`ok`（读到了 stats）/ `absent`（这台机器上还没有 cache 单例）/
 *   `unknown`（读的时候抛了）。缺 cache **不是**「占用 0 字节」—— 那是把「没量过」
 *   画成「没问题」，本仓最贵的错读数形态。hitRate 为 null 时也如实写「尚无读取」，
 *   不写 0%。
 */
import { numOrNull } from './num-gate.js';
import { createMediaCache } from './media-cache.js';

/** 取/建会话级单例。上限按字节给；读不到就交给内核默认（不编 24MB 这个数进来）。 */
export function mediaCacheEnsure(win, maxBytes) {
    const vp = win && win.VirtualPhone ? win.VirtualPhone : null;
    if (!vp) return null;
    if (vp.mediaCache && typeof vp.mediaCache.release === 'function') return vp.mediaCache;
    const bytes = numOrNull(maxBytes);
    vp.mediaCache = createMediaCache(bytes !== null && bytes > 0 ? { maxBytes: Math.floor(bytes) } : {});
    return vp.mediaCache;
}

function releaseWith(cache, reason) {
    const why = String(reason === undefined || reason === null ? '' : reason).trim() || 'unknown-reason';
    if (!cache || typeof cache.release !== 'function') {
        return { ok: false, reason: 'no-cache', why, freedBytes: 0 };
    }
    let out = null;
    try {
        out = cache.release(why);
    } catch (_e) {
        return { ok: false, reason: 'release-threw', why, freedBytes: 0 };
    }
    const freed = numOrNull(out && out.freedBytes);
    const ok = !!(out && out.ok === true);
    return {
        ok,
        reason: ok ? why : 'release-refused',
        why,
        freedBytes: freed === null ? 0 : freed
    };
}

/** 换会话挂载点：挂 `onChatChanged`。 */
export function mediaCacheOnChatChanged(cache, reason) {
    return releaseWith(cache, reason === undefined ? 'chat-changed' : reason);
}

/** 低内存/切 App 挂载点：挂 `releasePhoneInactiveResources`。 */
export function mediaCacheOnInactive(cache, activeAppId) {
    const out = releaseWith(cache, 'inactive');
    out.activeAppId = activeAppId === undefined || activeAppId === null ? null : String(activeAppId);
    return out;
}

/** 读数面：给「洞察」App 的一张卡。 */
export function mediaCacheFace(win) {
    const vp = win && win.VirtualPhone ? win.VirtualPhone : null;
    const cache = vp && vp.mediaCache ? vp.mediaCache : null;
    if (!cache || typeof cache.stats !== 'function') {
        return { kind: 'absent', reason: 'no-cache', stats: null };
    }
    let st = null;
    try {
        st = cache.stats();
    } catch (e) {
        return { kind: 'unknown', reason: 'stats-threw', stats: null, detail: String((e && e.message) || e) };
    }
    if (!st || typeof st !== 'object') {
        return { kind: 'unknown', reason: 'stats-shape', stats: null };
    }
    const pick = (k) => (numOrNull(st[k]) === null ? null : numOrNull(st[k]));
    return {
        kind: 'ok',
        reason: 'ok',
        stats: {
            bytes: pick('bytes'),
            maxBytes: pick('maxBytes'),
            entries: pick('entries'),
            maxEntries: pick('maxEntries'),
            hits: pick('hits'),
            misses: pick('misses'),
            hitRate: pick('hitRate'),
            evictions: pick('evictions'),
            releaseCount: pick('releaseCount'),
            releasedBytes: pick('releasedBytes')
        }
    };
}

function n(v) { return v === null || v === undefined ? '—' : String(v); }

export function mediaCacheFaceText(face) {
    const f = face && typeof face === 'object' ? face : { kind: 'absent', reason: 'no-face', stats: null };
    if (f.kind === 'absent') {
        return '媒体缓存尚未建立（本机还没打开过含图的界面）—— 不是「占用 0 字节」，是「没量过」';
    }
    if (f.kind !== 'ok') {
        return '媒体缓存读数读取失败：' + n(f.reason) + '（如实标未知，不写 0）';
    }
    const s = f.stats || {};
    const total = (s.hits === null || s.misses === null) ? null : (s.hits + s.misses);
    const rate = s.hitRate === null ? '尚无读取' : (Math.round(s.hitRate * 1000) / 10 + '%');
    return '媒体缓存 ' + n(s.bytes) + ' 字节 / 上限 ' + n(s.maxBytes)
        + '（' + n(s.entries) + '/' + n(s.maxEntries) + ' 张）· 命中 ' + n(s.hits) + '/' + n(total)
        + '（' + rate + '）· 淘汰 ' + n(s.evictions)
        + ' · 会话释放 ' + n(s.releaseCount) + ' 次共 ' + n(s.releasedBytes) + ' 字节';
}

export function mediaCacheRows(face) {
    const f = face && typeof face === 'object' ? face : { kind: 'absent', reason: 'no-face', stats: null };
    if (f.kind !== 'ok') {
        return [{ label: '状态', value: f.kind === 'absent' ? '未建立' : '读取失败' }, { label: '原因', value: n(f.reason) }];
    }
    const s = f.stats || {};
    return [
        { label: '占用 / 上限', value: n(s.bytes) + ' / ' + n(s.maxBytes) + ' 字节' },
        { label: '张数 / 上限', value: n(s.entries) + ' / ' + n(s.maxEntries) },
        { label: '命中 / 未命中', value: n(s.hits) + ' / ' + n(s.misses) },
        { label: '命中率', value: s.hitRate === null ? '尚无读取' : (Math.round(s.hitRate * 1000) / 10 + '%') },
        { label: '淘汰次数', value: n(s.evictions) },
        { label: '会话释放', value: n(s.releaseCount) + ' 次 / ' + n(s.releasedBytes) + ' 字节' }
    ];
}

export default {
    mediaCacheEnsure,
    mediaCacheOnChatChanged,
    mediaCacheOnInactive,
    mediaCacheFace,
    mediaCacheFaceText,
    mediaCacheRows
};
