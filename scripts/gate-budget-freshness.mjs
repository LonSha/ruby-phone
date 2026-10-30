#!/usr/bin/env node
/* ============================================================
 * scripts/gate-budget-freshness.mjs — 预算基线「时效」判据（R11-O9）[v4.98.0]
 * ------------------------------------------------------------
 * 【为什么有它】
 *   `config/gate-budget.json` 的各门预算全登记、`check-file.mjs` 真读、
 *   判据真测形态 —— 唯独**没人问过「这数还准吗」**。
 *   实况（本版实测）：`measured_at = v3.23.1`，而当版是 v4.97.0 ⇒ 之间隔了
 *   **166 次发布**。后果不是「门坏了」，而是那一整段「预算对账」在每一个版本上
 *   都在拿一百多个版本前的耗时基线比对今天的机器 —— 超预算告警于是只剩两种可能：
 *     · 一直在叫（人人当噪声，等于没叫）；
 *     · 一直在装死（预算宽到永不可能超）。
 *   两种都不是告警该有的样子，而**没有任何机制把它们区分开**。
 *
 * 【本模块的口径：时效是三态，不是两态】
 *   `stale`     —— 落后的发布数超过阈值（默认 20）⇒ **告警**，不改退出码；
 *   `fresh`     —— 落后在阈值内 ⇒ 不告警；
 *   `unmeasured`—— `measured_at` 缺失 / 不是版本号 / 预算文件不在场 ⇒ **说原因**，不猜。
 *   三态**不同形**：`unmeasured` 与 `fresh` 若都输出「无告警」，读的人就分不出
 *   「刚测过」和「根本没测过」—— 那正是本仓反复治理的塌缩形态。
 *
 * 【为什么「落后几版」要数发布条数，而不是做版本号算术】
 *   第一版写成 `(当版末段 − 基线末段)`，实测输出「落后 **3000** 版」——
 *   因为基线是 `v3.23.1` 而当版是 `v4.97.0`，首段之差被乘了大系数。
 *   版本号的段位是**发布批次编号**，不是可加减的量；跨批次时任何算术都只是猜。
 *   所以本模块改用**可复算的真数**：`update-log.json` 的 `versions` 表里有本仓
 *   全部发布记录，数「严格新于基线的条数」就是真实间隔 —— 同一份表既是
 *   版本真源（`latest`）也是发布史，不需要第二份口径。
 *   ★ 与「段位算术」的关键差别：**数出来的数能被任何人复算**，
 *     而 `(4−3)×1000` 那种系数是我拍的，读的人无法验证。
 *
 * 【为什么告警不改退出码（fail-open，与 check-file 的既有纪律一字不差）】
 *   预算陈旧是「该去看一眼」，不是「该拦下来」。与「读不到主读数即 exit 2 拒判」
 *   方向相反：**读不到 → 拒判；读到了但旧 → 只说话**。
 *
 * 用法：node scripts/gate-budget-freshness.mjs [--json]
 * 退出码：恒 0（时长判据不拦发布）。用法错误除外。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');

/** 时效阈值：落后多少次发布算「陈旧」。取 20 —— 一个发布周期内的正常漂移不叫陈旧，
 *  而一百多次发布的漂移必须被看见。 */
export const STALE_RELEASE_GAP = 20;

/** 解析 semver 成整数段数组；不可解析返回 **null**（不是 [0,0,0]）。
 *  「没写」与「写了 0.0.0」必须是两件事 —— 本仓治过的塌缩形态。 */
export function parseSemver(text) {
    const s = String(text == null ? '' : text).trim().replace(/^v/i, '');
    if (!/^\d+(?:\.\d+)*$/.test(s)) return null;
    return s.split('.').map((n) => parseInt(n, 10));
}

/** semver 数值比较（段数不齐按 0 补）：a < b ⇒ -1，a === b ⇒ 0，a > b ⇒ 1。
 *  不可解析 ⇒ **抛**（调用方必须先 parseSemver 判过；静默返回 0 会把坏输入当同版）。 */
export function compareSemver(a, b) {
    const x = parseSemver(a);
    const y = parseSemver(b);
    if (!x || !y) throw new Error('compareSemver: 不可解析的版本号 ' + String(a) + ' / ' + String(b));
    const n = Math.max(x.length, y.length);
    for (let i = 0; i < n; i += 1) {
        const xv = i < x.length ? x[i] : 0;
        const yv = i < y.length ? y[i] : 0;
        if (xv !== yv) return xv < yv ? -1 : 1;
    }
    return 0;
}

/** 读当版版本号（package.json 是唯一入口真源）。 */
export function currentVersion(root = ROOT) {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
        return typeof pkg.version === 'string' ? pkg.version : null;
    } catch (_e) {
        return null;
    }
}

/** 读发布史（`update-log.json` 的 `versions` 键集合）。
 *  返回 null 表示读不到 —— **不当空数组**（空数组会让「落后 0 版」变成一个假读数）。 */
export function releaseHistory(root = ROOT) {
    try {
        const ul = JSON.parse(fs.readFileSync(path.join(root, 'update-log.json'), 'utf8'));
        const keys = Object.keys(ul && ul.versions ? ul.versions : {});
        return keys.length ? keys : null;
    } catch (_e) {
        return null;
    }
}

/** 数「严格新于 base」的发布条数（真实间隔，可被任何人复算）。
 *  返回 null 表示输入不可用（历史读不到 / base 不是版本号 / 表里没有可解析的键）。 */
export function releasesSince(base, history) {
    if (!Array.isArray(history) || history.length === 0) return null;
    if (parseSemver(base) === null) return null;
    let n = 0;
    let seen = 0;
    for (const k of history) {
        if (parseSemver(k) === null) continue;
        seen += 1;
        if (compareSemver(k, base) > 0) n += 1;
    }
    return seen ? n : null;
}

/** 校验一份预算对象的时效（纯函数，执行器与判据共用同一份 —— 不各写一遍）。
 *  返回 {status, stale, gap, measuredAt, current, why}，status ∈ fresh | stale | unmeasured。
 *  ★ status 与 stale **两个字段都给**：只说 stale 时 `unmeasured` 与 `fresh` 同形。 */
export function evaluateBudgetFreshness(budget, current, history, threshold = STALE_RELEASE_GAP) {
    const cur = current == null ? null : String(current);
    const base = { status: 'unmeasured', stale: false, gap: null,
        measuredAt: null, current: cur, threshold };
    if (!budget || typeof budget !== 'object') {
        return Object.assign({}, base, { why: '预算对象不在场（读不到文件 / 解析失败）' });
    }
    const raw = budget.measured_at;
    if (raw == null || String(raw).trim() === '') {
        return Object.assign({}, base, { why: '预算文件没写 measured_at —— 无法判断基线新旧（不猜成「新」）' });
    }
    if (parseSemver(raw) === null) {
        return Object.assign({}, base, { measuredAt: String(raw),
            why: 'measured_at 不是版本号（' + String(raw) + '）—— 按未测处理，不当作 0' });
    }
    const gap = releasesSince(raw, history);
    if (gap === null) {
        return Object.assign({}, base, { measuredAt: String(raw),
            why: '发布史读不到（update-log.json 的 versions）—— 无从数出真实间隔，不猜' });
    }
    const at = String(raw);
    if (gap > threshold) {
        return { status: 'stale', stale: true, gap, measuredAt: at, current: cur, threshold,
            why: '预算基线 ' + at + '，此后已发布 ' + gap + ' 版（阈值 ' + threshold + '）—— 建议复测' };
    }
    return { status: 'fresh', stale: false, gap, measuredAt: at, current: cur, threshold,
        why: '预算基线 ' + at + '，此后发布 ' + gap + ' 版（阈值内）' };
}

/** 从磁盘取数并判定（执行器与判据都走这里）。 */
export function checkGateBudgetFreshness(root = ROOT, threshold = STALE_RELEASE_GAP) {
    const bp = path.join(root, 'config', 'gate-budget.json');
    let budget = null;
    let readWhy = '';
    if (fs.existsSync(bp)) {
        try { budget = JSON.parse(fs.readFileSync(bp, 'utf8')); }
        catch (e) { readWhy = '预算文件解析失败：' + String(e && e.message); }
    } else {
        readWhy = '预算文件不在场（' + bp + '）';
    }
    const res = evaluateBudgetFreshness(budget, currentVersion(root), releaseHistory(root), threshold);
    if (readWhy && res.status === 'unmeasured') {
        return Object.assign({}, res, { why: readWhy });
    }
    return res;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    const r = checkGateBudgetFreshness();
    if (process.argv.includes('--json')) {
        process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    } else {
        const tag = r.status === 'stale' ? '‼' : (r.status === 'unmeasured' ? '?' : '✓');
        console.log('[gate-budget-freshness] ' + tag + ' ' + r.status + ' —— ' + r.why);
    }
    /* ★ 告警不改退出码：恒 exit 0。
     *   「该去看一眼」不是「该拦下来」——与 check-file 的预算段纪律一致。 */
    process.exit(0);
}