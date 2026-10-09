/* ============================================================
 * tools/bump-drill-core.mjs — 抬版演练的**纯判定内核**
 * ------------------------------------------------------------
 * 为什么要把这几件抽出来（不是整洁性偏好）：
 *   `tools/bump-drill.mjs` 是**驱动器**：起镜像、跑 node、落报告 —— 它写的都是副作用，
 *   在判据套件里无法直接测（跑一次 3 分钟、还会真起子进程）。
 *   而它里面最容易写错、且**已经错过好几次**的，恰好是四件**纯函数**：
 *     ① 分组：谁是版本锚组、谁是连带面组（错 → 把该修的当成该改的）；
 *     ② 取数：从 node 的 stdout 里反解失败件（**本工具第二版在这里报过假绿**：
 *        Node 24 批量跑不打文件级 `✖`，只打 `test at …`，于是 exit 1 被读成「红 0」）；
 *     ③ 探针宿主资格：带顶层 `process.exit` 的套件会把注入的判据静默吞掉（真发生过）；
 *     ④ 版本比较：按数字段比（字符串比会让 3.9.10 < 3.10.0）。
 *   抽出来之后，这四件可以**用真样本**在毫秒级内反复验，且负控制（故意写坏的输入）
 *   能直接喂进来 —— 这正是本仓判据建设的一贯做法：把判据与副作用拆开。
 *
 * 本文件**零副作用**：不读盘、不起进程、不写文件。驱动器负责喂数据。
 * ============================================================ */

/* ── ① 分组口径 ──
 *   `VERSION_SOURCE_RE`：读了版本源（四源之一或入口常量）的套件 —— 这些**可能**是版本锚。
 *   `SPAWNS_RE`：自己起子进程的套件排除在批量面之外（与 node 的 worker 调度互扰，
 *     且它们多测的是工具自身，与本演练无关）。
 *   `CARRY_RE`：读了抬版**连带面载体**（迭代日志 / 边界文档 / tests/audit 台账）的套件 ——
 *     这些的红是「抬版动作还没做」，与版本锚缺陷**两类**，分开报才可归因。 */
export const VERSION_SOURCE_RE = /package\.json|manifest\.json|update-log\.json|ST_PHONE_VERSION/;
export const SPAWNS_RE = /child_process|spawnSync|execSync/;
export const CARRY_RE = /ITERATION_LOG\.md|runtime-verification-boundary\.md|tests\/audit\//;
/** 注入宿主的否决条件：顶层 `process.exit` 会在**加载期**结束进程，
 *  此后注入的 `test(...)` 永不注册，而运行器仍报「✔ 通过」—— 静默吞掉 + 伪装全绿。 */
export const TOP_LEVEL_EXIT_RE = /^process\.exit\(/m;
export const USES_TEST_RE = /from\s+'node:test'|require\('node:test'\)/;

/**
 * 把一批 [文件名, 源码] 切成锚组 / 连带面组。
 * @param {Array<[string,string]>} entries 已排序或未排序均可（返回前各自排序）
 * @returns {{anchors: string[], carry: string[]}}
 */
export function classifySources(entries) {
    const anchors = [];
    const carry = [];
    for (const [name, src] of entries) {
        if (!name.endsWith('.test.mjs')) continue;
        if (!VERSION_SOURCE_RE.test(src)) continue;
        if (SPAWNS_RE.test(src)) continue;
        if (CARRY_RE.test(src)) carry.push(name); else anchors.push(name);
    }
    return { anchors: anchors.sort(), carry: carry.sort() };
}

/**
 * 从锚组里挑一个可用的**注入宿主**。
 * 两条硬条件：① 不含顶层 process.exit；② 真的引用 node:test。
 * 一条都满足才算合格；一条都没有 ⇒ 返回 null（调用方拒判，不是「随便挑一个」）。
 * @returns {string|null}
 */
export function pickProbeHost(entries) {
    const { anchors } = classifySources(entries);
    const byName = new Map(entries);
    const usable = anchors.filter((n) => {
        const src = byName.get(n) || '';
        return !TOP_LEVEL_EXIT_RE.test(src) && USES_TEST_RE.test(src);
    });
    return usable.length ? usable[0] : null;
}

/* ── ② 取数口径 ──
 *   两种失败形态都要认（认错就是假绿）：
 *     ① 文件级 `✖ tests/x.test.mjs`（单文件跑 / 旧版本 node 的主形态）；
 *     ② 用例级 `test at tests/x.test.mjs:12:1`（Node 24 批量跑时**不打文件级行**）。
 *   另取 `failCount` 走汇总行 `ℹ fail N`：它与 failed 是**两处独立取数**，
 *   一处写错时另一处还能把它抓出来（本仓的「两处独立取数」纪律）。 */
export function parseFailedFromOutput(out) {
    const failed = [...new Set([
        ...(String(out).match(/^✖ (tests\/[A-Za-z0-9_.-]+\.test\.mjs)/gm) || [])
            .map((s) => s.replace(/^✖ /, '').trim()),
        ...(String(out).match(/^test at (tests\/[A-Za-z0-9_.-]+\.test\.mjs):\d+/gm) || [])
            .map((s) => s.replace(/^test at /, '').replace(/:\d+$/, '').trim()),
    ])].sort();
    const failCount = Number((/^ℹ fail (\d+)$/m.exec(String(out)) || [])[1] || NaN);
    const tests = Number((/^ℹ tests (\d+)$/m.exec(String(out)) || [])[1] || 0);
    return { failed, failCount, tests };
}

/**
 * 「有红但一件都没点名」—— 读数不可归因。
 * 这时**不许报零红**：真正新增的红可能与它并存，只是看不见。
 */
export function isUnattributedRed({ red, failed }) {
    return !!red && (!failed || failed.length === 0);
}

/* ── ③ 版本比较（按数字段，不按字符串）── */
export function cmpVersion(a, b) {
    const x = String(a).split('.').map(Number);
    const y = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        const p = Number.isFinite(x[i]) ? x[i] : 0;
        const q = Number.isFinite(y[i]) ? y[i] : 0;
        if (p !== q) return p < q ? -1 : 1;
    }
    return 0;
}

/* ── ④ 读数归因（报告 → 结论）──
 *   把「一次演练跑出来的几组读数」翻译成三条互不含混的结论：
 *     · anchor_regressions：**因抬版新增**的锚组红（R-O2 点名的那一族）；
 *     · carry_pending     ：连带面组的红（抬版动作清单，补齐即绿）；
 *     · coverage_ok       ：两组都真跑到了东西（少于下限 ⇒ 覆盖面缩水，不是「恰好没红」）。
 *   为什么必须分开：这三类**处置方向相反**，混看会把该改的当成该做的。 */
export const COVERAGE_FLOOR = { anchors: 20, carry: 1 };

export function analyzeDrill(runs, floor = COVERAGE_FLOOR) {
    const anchorRegressions = [];
    const carryPending = [];
    const problems = [];
    let coverageOk = true;
    for (const r of runs || []) {
        const added = (r.anchor_group && r.anchor_group.added_by_bump) || [];
        for (const n of added) anchorRegressions.push(n);
        for (const n of (r.carry_group && r.carry_group.failed) || []) carryPending.push(n);
        const nA = (r.anchor_group && r.anchor_group.suite_files) || 0;
        const nC = (r.carry_group && r.carry_group.suite_files) || 0;
        if (nA < floor.anchors) {
            coverageOk = false;
            problems.push(`锚组只跑到 ${nA} 件（下限 ${floor.anchors}）—— 覆盖面缩水，不是「恰好没红」`);
        }
        if (nC < floor.carry) {
            coverageOk = false;
            problems.push(`连带面组只跑到 ${nC} 件（下限 ${floor.carry}）—— 该组缺席时它的红无从发现`);
        }
        if (r.unattributed_red) {
            coverageOk = false;
            problems.push('有红但失败件明细为空（读数不可归因）—— 不许据此报零红');
        }
        if (r.baseline && r.baseline.failed && r.baseline.failed.length) {
            coverageOk = false;
            problems.push(`基线（未抬版）本就有红 ${r.baseline.failed.length} 件 —— 差值算不出来，拒判`);
        }
    }
    return {
        anchor_regressions: [...new Set(anchorRegressions)].sort(),
        carry_pending: [...new Set(carryPending)].sort(),
        coverage_ok: coverageOk,
        problems,
    };
}

/* ── ⑤ 探针结论（注入锚 → 工具是否有效）──
 *   `token` 是**前置条件**：令牌没红说明注入的判据压根没执行，
 *   此时 `equal` 的「没被抓住」与「注入被静默吞掉」不可分（真发生过）。
 *   故 tool_valid = token_ok && equal 被抓住 —— 两条件缺一不可。 */
export function analyzeProbes(probes) {
    const list = (probes && probes.probes) || [];
    const by = (k) => list.find((p) => p.kind === k);
    const token = list.length ? list.every((p) => p.token_red) : false;
    const equal = by('equal');
    const ceil = by('ceil');
    const floor = by('floor');
    return {
        token_ok: token,
        equal_caught: !!(equal && equal.caught),
        ceil_caught: !!(ceil && ceil.caught),
        /* floor 按原理**不该**翻面；它被抓住反而说明探针注入错了目标（例如注进了别的判据） */
        floor_flipped: !!(floor && floor.caught),
        blind_spot: '下限形锚（version >= X）与「全库无锚」在抬版这件事上读数相同 —— '
            + '本报告只能证明「没有会因抬版翻面的锚」，不能证明「全库没有锚」。',
        tool_valid: list.length > 0 && token && !!(equal && equal.caught),
    };
}
