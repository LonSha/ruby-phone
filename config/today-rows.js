/* ========================================================
 * config/today-rows.js — [v4.112.0 · R13-X1] 单条事件行的归一（纯函数，不含聚合）
 * --------------------------------------------------------
 * 【为什么拆出来】主件 `today-timeline.js` 只该回答「怎么排」，不该回答「一条长什么样」。
 *   两者混在一件里，实测 9708 字节，超了 X1 给的 8K 预算；而这次拆分**不损伤任何调用面**：
 *   改「什么算一条可用的事件」（例如将来要收没有 id 的条目）不必碰排序，
 *   改排序也不必读行归一的判断链。
 *
 * 【它守的三条】
 *   ① `at` 读不出来就**不收**（不给 0 充数：0 会被排到 1970，等于替用户编了一个时刻）；
 *   ② 没有 id 就**不收**（点不回去的条目放进时间轴，就是让用户点一个死链）；
 *   ③ 标题超长要**截断并加省略号**（不静默截 —— 静默截会让「读了半句」看起来像「完整的一句」）。
 * ============================================================ */
'use strict';
import { numOrNull } from './num-gate.js';
import { TODAY_SOURCES, TODAY_SOURCE_LABEL, TODAY_LIMITS } from './today-terms.js';

/** 只收非空字符串（id 一律按字符串比：本仓 id 有数字形与字符串形两种）。 */
export function idOf(v) {
    if (typeof v === 'string' && v.trim()) return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    return '';
}

/** 行上靶心的归一（只留 {appId, kind, id} 三字段的纯对象）。
 *  ★ 不 import `config/open-ref.js` —— 那是协议件（会拖进 kind 登记表），
 *   而本件是叶子（与 today-terms 同一纪律：口径件不牵算法）。
 * 形状滤在此，归一判在消费侧：两道都得有 —— 本件防「把坏值当靶心画在按钮上」，
 *   open-ref 防「投到没人认的 kind」。
 */
export function refOf(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const appId = (typeof v.appId === 'string') ? v.appId.trim() : '';
    const kind = (typeof v.kind === 'string') ? v.kind.trim() : '';
    const id = idOf(v.id);
    if (!appId || !kind || !id) return null;
    return { appId: appId, kind: kind, id: id };
}
/** 标题收尾：纯空白 ⇒ 空串（视图自己决定说什么），超长截断加省略号。 */
export function titleOf(v) {
    const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    if (!s) return '';
    if (s.length <= TODAY_LIMITS.titleMaxChars) return s;
    return s.slice(0, TODAY_LIMITS.titleMaxChars) + '…';
}

/**
 * 把某个源交来的原始串收成**结构恒定**的事件行，并按今天的半开区间过滤。
 *
 * @param {string} source 源名（`TODAY_SOURCES` 之一；未登记 ⇒ 整源不收）
 * @param {Array} raw 该源的原始条目（非数组 ⇒ 当作「这个源没接上来」，不是「今天没事」）
 * @param {number} start 今天起点（含）
 * @param {number} end 今天终点（不含）
 * @returns {{rows:Array, dropped:number, outOfRange:number, mounted:boolean}}
 *   · `mounted:false` 表示这个源**没有接上来**（调用方据此报 absent，不许说成「今天没事」）；
 *   · `dropped` 是「有这条、但它进不了时间轴」的条数（时刻坏 / 没 id / 不是对象）；
 *   · `outOfRange` 是「时刻是对的，但不在今天」的条数（这**不算丢弃**，它是正常过滤）。
 */
export function collectSource(source, raw, start, end) {
    const src = TODAY_SOURCES.indexOf(String(source)) >= 0 ? String(source) : '';
    if (!src) return { rows: [], dropped: 0, outOfRange: 0, mounted: false };
    if (!Array.isArray(raw)) return { rows: [], dropped: 0, outOfRange: 0, mounted: false };
    const rows = [];
    let dropped = 0;
    let outOfRange = 0;
    for (let i = 0; i < raw.length; i += 1) {
        const it = raw[i];
        if (!it || typeof it !== 'object') { dropped += 1; continue; }
        const at = numOrNull(it.at);
        if (at === null || at <= 0) { dropped += 1; continue; }
        /* 先做区间过滤再做 id 判定：不在今天的条目**本来就不该**被算成「丢弃」，
         *   否则一个正常的历史列表会把 dropped 顶到很大，界面报出一堆假警报。 */
        if (at < start || at >= end) { outOfRange += 1; continue; }
        const id = idOf(it.id);
        if (!id) { dropped += 1; continue; }
        rows.push({
            at: at,
            source: src,
            sourceLabel: TODAY_SOURCE_LABEL[src] || src,
            id: id,
            kind: String(it.kind == null ? '' : it.kind),
            title: titleOf(it.title),
            /* [v4.119.0 · R14-O3] 行上带靶心（可空）。两道筛子：
             *   本件只筛形状（三个字段都是非空串），归一是否成立由消费侧 applyOpenRef 再判一次；
             *   坏值静默降为 null 的后果是按钮只写「打开 X」（诚实），
             *   而不是写「打开这一条」却落不到（那是做不到的承诺）。 */
            ref: refOf(it.ref),
            seq: i
        });
    }
    return { rows: rows, dropped: dropped, outOfRange: outOfRange, mounted: true };
}