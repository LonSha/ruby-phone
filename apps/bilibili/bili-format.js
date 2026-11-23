/* ============================================================
 * bili-format.js — [v4.190.0] B站 文本 / 计数 / 时间 / 标识 的纯函数内核
 * ------------------------------------------------------------
 * 从 apps/bilibili/bili-data.js 抽出来的**可纯化部分**：
 *   源的 hash32 / b62 / makeBvid / makeMid / compactText / parseCount /
 *   parseDur / fmtCount / fmtDur / timeAgo / wallStampText / seededInt
 *   —— 全是「给定输入 -> 给定结论」，不碰 DOM、不碰存储。
 *   其中 fmtCount / fmtDur / timeAgo 三个原本已是 export，但它们的私有依赖
 *   （parseCount / parseDur / wallStampText）没有导出，导致「公开的三个能测、
 *   支撑它们的五个测不了」——本件把这一族整体提出来，依赖关系才闭合。
 * ------------------------------------------------------------
 * 为什么单独一件：bili-data.js 里 BiliData 那个类持 this.state 并直写 storage
 *   （用户态 / 硬币 / 关注 / 历史 / 收藏），那是有副作用的编排。混在一个文件里，
 *   判据只能「跑一遍看不崩」，钉不住「12.8万 到底解析成多少」这类不变式。
 * ------------------------------------------------------------
 * 刻意不做：不持状态、不改入参、**不自己取时间**（nowMs 一律由调用方传入，
 *   否则同一输入每次跑出不同文案，判据没法写）、不碰随机源。
 * ============================================================ */

/* ---------- 1. 哈希与标识 ---------- */

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** FNV-1a 32 位：同一字符串永远同一哈希（bvid 因此稳定）。 */
export function hash32(str) {
    const s = String(str == null ? '' : str);
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i += 1) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}

/** 固定长度 base62（确定性：同种子同结果）。 */
export function b62(num, len) {
    let n = Number(num) >>> 0;
    let out = '';
    const k = Math.max(0, Math.floor(len) || 0);
    for (let i = 0; i < k; i += 1) {
        out += B62[n % 62];
        n = (Math.floor(n / 62) + Math.imul(i + 1, 2654435761)) >>> 0;
    }
    return out;
}

/** BV 号：`BV1` + 10 位（与现实同形，便于界面直接展示）。 */
export function makeBvid(seed) {
    return 'BV1' + b62(hash32('a|' + seed), 7) + b62(hash32('b|' + seed), 3);
}

/** UID：现实 B站 UID 是纯数字。 */
export function makeMid(seed) {
    return String(3000000 + (hash32('mid|' + seed) % 96000000));
}

/** 由种子在 [min, max] 里定一个整数（确定性抽签，不碰随机源）。 */
export function seededInt(seed, min, max) {
    const lo = Math.ceil(Number(min) || 0);
    const hi = Math.floor(Number(max) || 0);
    if (hi <= lo) return lo;
    return lo + (hash32(String(seed)) % (hi - lo + 1));
}

/* ---------- 2. 文本 ---------- */

/** 紧凑文本：折叠空白 + 超长截断（加 ...）。max<=0 表示不截断。 */
export function compactText(value, max) {
    const text = String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
    const limit = Number(max) || 0;
    return (limit > 0 && text.length > limit) ? (text.slice(0, limit) + '...') : text;
}

/* ---------- 3. 计数 ---------- */

/** 计数解析：'12.8万' / '1.2亿' / '1832' / 128000 → 数字。读不到归 0。 */
export function parseCount(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
    const s = String(value == null ? '' : value).trim().replace(/,/g, '').replace(/\s+/g, '');
    if (!s) return 0;
    const m = s.match(/^([0-9]+(?:\.[0-9]+)?)\s*(万|亿|w|W)?/);
    if (!m) return 0;
    const base = Number(m[1]);
    if (!Number.isFinite(base)) return 0;
    const unit = m[2];
    if (unit === '万' || unit === 'w' || unit === 'W') return Math.round(base * 10000);
    if (unit === '亿') return Math.round(base * 100000000);
    return Math.round(base);
}

/** 计数显示：B站 口径（1.2万 / 123.4万 / 1.2亿）。 */
export function fmtCount(value) {
    const v = parseCount(value);
    if (v <= 0) return '0';
    if (v < 10000) return String(v);
    if (v < 100000000) {
        const w = v / 10000;
        return (w >= 100 ? w.toFixed(0) : w.toFixed(1)).replace(/\.0$/, '') + '万';
    }
    const y = v / 100000000;
    return (y >= 100 ? y.toFixed(0) : y.toFixed(1)).replace(/\.0$/, '') + '亿';
}

/* ---------- 4. 时长 ---------- */

/** 秒 → '12:34' / '1:02:33'。 */
export function fmtDur(seconds) {
    const s = Math.max(0, Math.round(Number(seconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    const p = (x) => String(x).padStart(2, '0');
    return h > 0 ? (h + ':' + p(m) + ':' + p(ss)) : (m + ':' + p(ss));
}

/** '12:34' / '1:02:33' / 754 → 秒。读不到归 0。 */
export function parseDur(value) {
    if (typeof value === 'number') return Math.max(0, Math.round(value));
    const s = String(value == null ? '' : value).trim();
    if (!s) return 0;
    const parts = s.split(':').map((x) => Number(x));
    if (parts.some((x) => !Number.isFinite(x))) return 0;
    if (parts.length === 2) return Math.max(0, Math.round(parts[0] * 60 + parts[1]));
    if (parts.length === 3) return Math.max(0, Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2]));
    return Math.max(0, Math.round(parts[0] || 0));
}

/* ---------- 5. 时间文案（nowMs 由调用方给） ---------- */

/**
 * 相对时间文案：以**调用方给的 nowMs** 为基准。
 * 用户读的是剧情时间，不是本机时间 —— 所以这里绝不自己读系统时钟。
 */
export function timeAgo(ts, nowMs) {
    const t = Number(ts);
    const n = Number(nowMs);
    if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(n) || n <= 0) return '';
    const diff = n - t;
    if (diff < 0) return '刚刚';
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return '刚刚';
    const min = Math.floor(sec / 60);
    if (min < 60) return min + '分钟前';
    const hour = Math.floor(min / 60);
    if (hour < 24) return hour + '小时前';
    const day = Math.floor(hour / 24);
    if (day === 1) return '昨天';
    if (day < 30) return day + '天前';
    const d = new Date(t);
    const nd = new Date(n);
    if (d.getFullYear() === nd.getFullYear()) return (d.getMonth() + 1) + '-' + d.getDate();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

/** 墙钟时刻 → 「今天 12:30」/「昨天 21:04」/「11-20 09:12」。nowMs 由调用方给。 */
export function wallStampText(atMs, nowMs) {
    const t = Number(atMs);
    const n = Number(nowMs);
    if (!Number.isFinite(t) || t <= 0) return '';
    const d = new Date(t);
    const p = (x) => String(x).padStart(2, '0');
    const hm = p(d.getHours()) + ':' + p(d.getMinutes());
    if (!Number.isFinite(n) || n <= 0) return hm;
    const dayDiff = Math.floor((n - t) / 86400000);
    if (dayDiff <= 0) return '今天 ' + hm;
    if (dayDiff === 1) return '昨天 ' + hm;
    return (d.getMonth() + 1) + '-' + d.getDate() + ' ' + hm;
}

/* ---------- 6. 地址 ---------- */

/** 本地模拟地址（现实域名的条目见 bili-data.js 的 isBilibiliEntryUrl）。 */
export function makeLocalBilibiliUrl(seed, index) {
    const slug = encodeURIComponent(String(seed || 'bilibili').trim().replace(/\s+/g, '-') || 'bilibili');
    return 'phone://bilibili/' + slug + '-' + ((Number(index) || 0) + 1);
}

/** 是否是 B站 域 / 本地模拟地址。 */
export function isBilibiliEntryUrl(url) {
    const raw = String(url == null ? '' : url).trim();
    if (!raw) return false;
    if (raw.startsWith('phone://bilibili/')) return true;
    try {
        const parsed = new URL(raw);
        const host = parsed.hostname;
        return host === 'www.bilibili.com' || host === 'bilibili.com'
            || host === 'm.bilibili.com' || host === 'search.bilibili.com'
            || host === 'space.bilibili.com' || host === 'live.bilibili.com';
    } catch (_e) {
        return false;
    }
}

export default {
    hash32, b62, makeBvid, makeMid, seededInt, compactText,
    parseCount, fmtCount, fmtDur, parseDur, timeAgo, wallStampText,
    makeLocalBilibiliUrl, isBilibiliEntryUrl
};