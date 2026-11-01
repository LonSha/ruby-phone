/* ========================================================
 * config/errand-store.js — [v4.114.0 · R13-X7] 清单的唯一一组存储口 + 本月行
 * --------------------------------------------------------
 * 【为何单独一件】存储读写口全仓的纪律是「一处采、一处写、判定是纯函数」（与
 *   `affair-state.js` / `task-entry.js` 同规）。这里收掉的另一件事是**本月行**：
 *   「这个月要处理的」是本项唯一的产品面，它的排序与过滤如果散在视图里，
 *   换一个视图就会排出另一个顺序（本仓治过的「两份口径必然漂移」）。
 *
 * 【两条边界】
 *   ① 读不出就是 []，**不抛**：清单读不出来时界面该说「读不出来」，不��把捕获到
 *      的异常吞掉后当「这个月没事」（那是本仓最贵的错读数形态）；
 *   ② 本月行按到期日升序，同刻按 id —— 两次跑逐字相同。已豁免的**不在本月行里**：
 *      用户说不管了，就不该再出现在这张催人清单上。
 * ============================================================ */
'use strict';
import { ERRAND_STATES, ERRAND_LIMITS, ERRAND_KEY } from './errand-terms.js';
import { normalizeErrands } from './errand-lifecycle.js';

const str = (v) => String(v == null ? '' : v).trim();
/** 本月的行（`YYYY-MM` 同月且未豁免；已办与过期都算「本月要处理的」）。 */
export function monthRows(list, monthKey) {
    const mk = str(monthKey).slice(0, 7);
    const src = normalizeErrands(list);
    const out = src.filter((e) => e.state !== ERRAND_STATES.waived && e.dueAt.slice(0, 7) === mk);
    out.sort((a, b) => (a.dueAt === b.dueAt ? a.id.localeCompare(b.id) : a.dueAt.localeCompare(b.dueAt)));
    return out.slice(0, ERRAND_LIMITS.monthRows);
}

/** 读（不存在的键返回 []，不抛）。 */
export function readErrands(storage) {
    try {
        const raw = storage && typeof storage.get === 'function' ? storage.get(ERRAND_KEY, false) : null;
        if (!raw) return [];
        return normalizeErrands(typeof raw === 'string' ? JSON.parse(raw) : raw);
    } catch (_e) { return []; }
}

/** 写（fail-safe：写不进返回 false，不抛）。 */
export function writeErrands(storage, list) {
    try {
        if (!storage || typeof storage.set !== 'function') return false;
        storage.set(ERRAND_KEY, JSON.stringify(normalizeErrands(list)), false);
        return true;
    } catch (_e) { return false; }
}
