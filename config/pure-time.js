/* ============================================================
 * config/pure-time.js —— 纯整数日历（零 Date / 零时钟 / 零宿主状态）
 * ------------------------------------------------------------
 * 为什么需要它（App 重构台账的现场）：
 *   42 个 App 的 core/-data.js 被判成 core_impure，其中 46 处是 `new Date`。
 *   逐个看过去，多数 `new Date` 并不读时钟 —— 它们是「把一个已知的 epoch 毫秒
 *   换算成年月日」，例如 `new Date(a.createdAt).getFullYear()`。这类用法本身
 *   没有副作用，但它把「本地时区」这件宿主状态偷偷带进了内核：
 *     · 同一个 ts 在不同时区的机器上得出不同的月份键 ⇒ 归档分组不幂等；
 *     · 判据（纯度扫描）只能按文本把 `new Date` 一律算作不纯 ⇒ 分不清
 *       「读了时钟」和「只是换了个算法」。
 *   本文件把换算改成整数运算，时区偏移**由调用方显式传入**（默认 0 = UTC）。
 *   于是 core 侧零全局依赖，行为在 TZ=UTC 的机器上与原实现逐字相同，
 *   非 UTC 机器上由调用方把自己的偏移传进来，仍然可复现。
 *
 * 口径（与本仓既有 `new Date(ts)` + `getFullYear/getMonth/getDate` 等价）：
 *   month 是 1~12（不是 0~11）；偏移与 `Date.prototype.getTimezoneOffset()` 同号
 *   （西半球为正），内部用 `ms - offset*60000` 得到「本地墙上时间」。
 *
 * 算法出处：Howard Hinnant 的 civil_from_days（days 以 1970-01-01 为 0），
 *   全部用整数除法实现，不依赖 Date、不依赖 locale、不受 DST 影响
 *   （DST 的影响已经体现在调用方给的 offset 里）。
 * ============================================================ */

/** 天序号 → 公历年月日（Hinnant civil_from_days，纯整数）。 */
function civilFromDays(z) {
    let n = Math.floor(z) + 719468;
    const era = Math.floor(n / 146097);
    const doe = n - era * 146097;
    const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
    const y = yoe + era * 400;
    const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
    const mp = Math.floor((5 * doy + 2) / 153);
    const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
    const m = mp + (mp < 10 ? 3 : -9);
    return { y: y + (m <= 2 ? 1 : 0), m, d };
}

/**
 * epoch 毫秒 → 年月日时分秒（本地墙上时间）。
 * @param {number|string} ts epoch 毫秒
 * @param {number} [offsetMin=0] 时区偏移分钟，口径同 getTimezoneOffset()（西半球为正）
 * @returns {{y:number,m:number,d:number,h:number,mi:number,s:number}|null} 非法输入返回 null（不猜）
 */
export function partsOf(ts, offsetMin = 0) {
    const n = Number(ts);
    if (!Number.isFinite(n)) return null;
    const raw = Number(offsetMin);
    const off = Number.isFinite(raw) ? raw : 0;
    const ms = Math.floor(n - off * 60000);
    const days = Math.floor(ms / 86400000);
    let rem = ms - days * 86400000;
    const h = Math.floor(rem / 3600000); rem -= h * 3600000;
    const mi = Math.floor(rem / 60000); rem -= mi * 60000;
    const s = Math.floor(rem / 1000);
    const c = civilFromDays(days);
    return { y: c.y, m: c.m, d: c.d, h, mi, s };
}

/** 两位补零。 */
export function pad2(v) {
    const n = Number(v);
    return (n < 10 ? '0' : '') + n;
}

/** epoch 毫秒 → `YYYY-MM`（非法输入返回空串，不编一个月）。 */
export function ymOf(ts, offsetMin = 0) {
    const p = partsOf(ts, offsetMin);
    if (!p) return '';
    return p.y + '-' + pad2(p.m);
}

/** epoch 毫秒 → `YYYY-MM-DD`（非法输入返回空串）。 */
export function dayKeyOf(ts, offsetMin = 0) {
    const p = partsOf(ts, offsetMin);
    if (!p) return '';
    return p.y + '-' + pad2(p.m) + '-' + pad2(p.d);
}

/* 曾经在这里留过一个 tzResolver(fn) 工厂（「让宿主把每条的偏移算好递进来」）。
 * v4.201.0 接线时实测**零消费点**：五个调用方都是「换算一个已知 epoch」，
 * 时区由调用方在 offsetMin 上显式给（当前全仓 TZ=UTC ⇒ 不传即等价）。
 * 按 dead-export 门的第二条修法删掉 —— 预留接口不算接口，等真有按条取偏移的
 * 调用方再加，届时它会有消费点，门也能盯住。 */