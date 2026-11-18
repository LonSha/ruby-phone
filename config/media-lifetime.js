/* ============================================================
 * config/media-lifetime.js — 媒体对象的生命周期台账（R25-O3）
 * ------------------------------------------------------------
 * 【治的欠债（先取证，再动手）】
 *   R25-O3 的立项原文：相册原图 / 语音大对象**无显式释放路径**。取证不是靠读文档：
 *   全仓 `grep -rn 'revokeObjectURL|createObjectURL' apps config` **零命中**，
 *   `grep -n 'img.src=|removeAttribute(.src.)'` 在相册视图里也只有「设上去」，没有「摘下来」。
 *   于是连开 20 张原图之后，解码后的位图只能等 GC 顺手 —— 用户侧看到的就是「越看越卡」。
 *
 * 【本模块是什么 / 不是什么（边界写死）】
 *   ✅ 是**决策与记账层**：谁还活着、该不该释放、按什么动作释放、释放完的回执长什么样、
 *      「释放前 / 释放后」两次数值对不对得上（mlVerdict）。零 DOM、零存储、零计时器，
 *      时钟由参数给 ⇒ 可在 node 里逐条判。
 *   ❌ **不碰 DOM**：真正把 `src` 摘掉、把 video pause 掉的是视图层（album-view），
 *      它拿到 mlReleasePlan 的 steps 去执行，再把结果交回 mlReceipt。
 *   ❌ 不是内存 profiler：浏览器给不给 heap 读数不由我们决定（performance.memory 只有
 *      Chromium 家族有），给不到就如实 unknown —— **不许把「读不到」写成「已回落」**。
 *
 * 【三态不压平（本仓最贵的一类错误）】
 *   · 活着的句柄：live `{id, kind, src, at}`
 *   · 该释放但**说不清怎么释放**的：sweep 的 `unknown` 桶（kind 不在三类 / src 不是字符串）
 *     —— 它们是「要人来判」，不是「已释放」。压进 released 就等于把未知当完成。
 *   · 内存对拍：same / mismatch / **unknown**（缺读数、或者基线非正数）。
 *     mlVerdict(0, 0) 必须是 unknown 而不是 same：0 字节基线没有意义。
 *
 * 【动作按类型不同形（image ≠ video ≠ audio）】
 *   image → detach-src（摘 src，让解码位图可回收）
 *   video → pause-and-detach（先 pause 再摘 src，否则会继续解码下一帧）
 *   audio → pause-and-detach（同上：不 pause 就还在播，摘了 src 反而留一个错误态）
 *   把三者写成同一个动作，就是把「停」和「丢」混为一谈。
 * ============================================================ */

/** 同时存活的预览媒体上限：超过就按 FIFO 丢最旧的（预览界面本来只该有一个）。 */
export const ML_MAX_LIVE = 2;
/** 判「内存回落」的默认容差（百分比）。验收原文就是 ±10%。 */
export const ML_MEMORY_TOLERANCE_PCT = 10;
/** 回执最多留多少条（防止台账自己变成泄漏源）。 */
export const ML_RECEIPT_LIMIT = 64;
const KINDS = ['image', 'video', 'audio'];

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** data: URL 的近似解码字节数；非字符串一律 null（**不编 0**）。 */
export function mlBytesOfSrc(src) {
    if (typeof src !== 'string' || !src) return null;
    const comma = src.indexOf(',');
    if (src.startsWith('data:') && comma > 0) {
        const head = src.slice(0, comma);
        const body = src.slice(comma + 1);
        /* base64 的 4 字符 → 3 字节；非 base64（纯文本 data URL）按字符长度算。 */
        return /;base64/i.test(head) ? Math.floor((body.length * 3) / 4) : body.length;
    }
    /* 普通 URL：拿不到内容长度，返回 null（读不出≠0 字节）。 */
    return null;
}

/**
 * 登记一个活着的媒体句柄。
 * @returns {{state: Map, dropped: string[], rejected: string}} rejected 三态：
 *   ''           已登记
 *   'no-id'      没 id（拒登，不猜一个 id 出来）
 *   'bad-kind'   kind 不在 image/video/audio（拒登；调用方要自己决定怎么处置）
 */
export function mlTrack(live, rec, maxLive = ML_MAX_LIVE) {
    const state = new Map(live instanceof Map ? live : []);
    const out = { state, dropped: [], rejected: '' };
    const id = rec && typeof rec.id === 'string' ? rec.id.trim() : '';
    if (!id) { out.rejected = 'no-id'; return out; }
    const kind = rec && rec.kind;
    if (!KINDS.includes(kind)) { out.rejected = 'bad-kind'; return out; }
    state.set(id, { id, kind, src: rec.src, at: isFiniteNum(rec.at) ? rec.at : null });
    const limit = isFiniteNum(maxLive) && maxLive > 0 ? Math.floor(maxLive) : ML_MAX_LIVE;
    while (state.size > limit) {
        const oldest = state.keys().next();
        if (oldest.done) break;
        out.dropped.push(oldest.value);
        state.delete(oldest.value);
    }
    return out;
}

/**
 * 给一个句柄出释放方案。steps 是**给视图层照着做**的动作清单，本层不执行。
 * 说不清 kind ⇒ action='unknown' + why（不许硬套一个动作）。
 */
export function mlReleasePlan(rec) {
    const id = rec && typeof rec.id === 'string' ? rec.id : '';
    const kind = rec && rec.kind;
    if (!id) return { id: '', action: 'unknown', steps: [], why: 'no-id' };
    if (kind === 'image') return { id, action: 'detach-src', steps: ['detach-src'], why: '解码位图随 src 摘除可回收' };
    if (kind === 'video' || kind === 'audio') {
        return { id, action: 'pause-and-detach', steps: ['pause', 'detach-src'], why: '不先 pause 会继续解码下一帧/继续出声' };
    }
    return { id, action: 'unknown', steps: [], why: 'bad-kind' };
}

/**
 * 扫一遍：超龄就释放。
 * @returns {{release: object[], keep: string[], unknown: object[]}}
 *   unknown 里是「该释放但说不清动作」的句柄（kind 不明 / src 非字符串 / at 缺失），
 *   它们**不**出现在 release 里 —— 未知不等于已释放。
 */
export function mlSweep(live, now, opts = {}) {
    const maxAgeMs = isFiniteNum(opts.maxAgeMs) && opts.maxAgeMs >= 0 ? opts.maxAgeMs : 30000;
    const release = [];
    const keep = [];
    const unknown = [];
    const entries = live instanceof Map ? [...live.entries()] : [];
    for (const [id, rec] of entries) {
        const at = rec && rec.at;
        if (!isFiniteNum(at) || !isFiniteNum(now)) { unknown.push({ id, why: 'no-clock' }); continue; }
        if (now - at < maxAgeMs) { keep.push(id); continue; }
        const plan = mlReleasePlan(rec);
        if (plan.action === 'unknown') { unknown.push({ id, why: plan.why }); continue; }
        if (typeof rec.src !== 'string' || !rec.src) { unknown.push({ id, why: 'no-src' }); continue; }
        release.push(plan);
    }
    return { release, keep, unknown };
}

/** 回执：释放动作做没做成，一律留痕（ok=false 不得被写成 true）。 */
export function mlReceipt(rec, plan, ok, at, receipts = []) {
    const list = Array.isArray(receipts) ? receipts.slice() : [];
    const r = {
        id: (rec && rec.id) || (plan && plan.id) || '',
        kind: (rec && rec.kind) || '',
        action: (plan && plan.action) || 'unknown',
        ok: ok === true,
        at: isFiniteNum(at) ? at : null,
        why: (plan && plan.why) || ''
    };
    list.push(r);
    while (list.length > ML_RECEIPT_LIMIT) list.shift();
    return { receipt: r, receipts: list };
}

/**
 * 「释放前 / 释放后」对拍。
 * 缺读数、基线非正数 ⇒ unknown（不把读不到写成已回落）。
 */
export function mlVerdict(beforeBytes, afterBytes, tolerancePct = ML_MEMORY_TOLERANCE_PCT) {
    const tol = isFiniteNum(tolerancePct) && tolerancePct >= 0 ? tolerancePct : ML_MEMORY_TOLERANCE_PCT;
    if (!isFiniteNum(beforeBytes) || !isFiniteNum(afterBytes) || beforeBytes <= 0) {
        return { face: 'unknown', deltaPct: null, why: 'no-reading' };
    }
    const deltaPct = ((afterBytes - beforeBytes) / beforeBytes) * 100;
    if (Math.abs(deltaPct) <= tol) return { face: 'same', deltaPct, why: 'within-tolerance' };
    return { face: 'mismatch', deltaPct, why: deltaPct > 0 ? 'still-growing' : 'dropped-below-baseline' };
}

/** 内核自检：三条最容易写塌的边界，各造一个真样例。 */
export function mediaLifetimeSelfCheck() {
    const items = [];
    const t = 1000;
    let live = new Map();
    live = mlTrack(live, { id: 'a', kind: 'image', src: 'data:image/png;base64,AAAA', at: t }).state;
    live = mlTrack(live, { id: 'b', kind: 'video', src: 'data:video/mp4;base64,AAAA', at: t }).state;
    const over = mlTrack(live, { id: 'c', kind: 'image', src: 'data:image/png;base64,AAAA', at: t + 1 }, 2);
    items.push(['上限真的丢最旧', over.dropped.length === 1 && over.dropped[0] === 'a']);
    const badKind = mlTrack(new Map(), { id: 'x', kind: 'pdf', src: 'u', at: t });
    items.push(['不明 kind 拒登（不猜动作）', badKind.rejected === 'bad-kind']);
    const sweep = mlSweep(new Map([['k', { id: 'k', kind: 'pdf', src: 'u', at: 0 }]]), 999999, { maxAgeMs: 1 });
    items.push(['扫到不明 kind 进 unknown 桶', sweep.unknown.length === 1 && sweep.release.length === 0]);
    items.push(['缺读数判 unknown，不判 same', mlVerdict(null, 5).face === 'unknown' && mlVerdict(0, 0).face === 'unknown']);
    items.push(['超容差判 mismatch', mlVerdict(100, 150).face === 'mismatch']);
    const p1 = mlReleasePlan({ id: 'i', kind: 'image' }).action;
    const p2 = mlReleasePlan({ id: 'v', kind: 'video' }).action;
    items.push(['image 与 video 动作不同形', p1 === 'detach-src' && p2 === 'pause-and-detach']);
    return { ok: items.every((i) => i[1]), items: items.map((i) => ({ name: i[0], ok: i[1] })) };
}
