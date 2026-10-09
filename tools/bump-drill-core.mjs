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

/* ── ②b 抬版**连带面动作清单**（R-O2 第 4 条：与 R-O9 联动，让抬版流程不再把它们当噪声）──
 *
 *   为什么这份清单必须**可执行**而不只是「可读」：
 *     演练跑出「连带面组 4 件红」时，归因只到「这些是抬版动作还没做」为止 ——
 *     可这句话**没有证明清单是完整的**。若某天某套件因另一条未登记的连带面转红，
 *     它会混进同一堆红里，读者照旧分不清「照清单补齐即绿」还是「清单本身漏了」。
 *   把动作写成机器可跑的三件套（锚点 / 变换 / 自证），演练就能在镜像里**真做一遍**
 *   并复跑该组：0 红 ⇒ 清单在当版是**充分**的（这一步是证据，不是声明）；
 *   仍有红 ⇒ 剩下那些不是清单里的负债，必须逐条重新归因。
 *
 *   每条动作的纪律（与门禁判据同一族）：
 *     · 锚点必须**恰中 1 次**（0 次 = 已腐坏 / 已被别人做掉；多次 = 会误改历史段落）；
 *     · 锚点用**当版**版本号构造，不写死（写死就会随抬版漂移成 0 命中）；
 *     · 已经做过的（旧锚 0 次 + 新锚恰 1 次）⇒ 报 `noop-already-applied`，不猜、不重复插段。
 */

/** ITERATION_LOG 的元信息行锚点（真仓写法：`- **当前版本**：\`x.y.z\``）。 */
export const iterMetaAnchor = (v) => '- **当前版本**：`' + String(v) + '`';
/** 边界文档头部的当版复校标记锚点（真仓写法：`（v2.82.0 起；**vX.Y.Z 复校**）`）。 */
export const boundaryAnchor = (v) => '（v2.82.0 起；**v' + String(v) + ' 复校**）';

/* 两条**替换**型动作：有「旧串 → 新串」这一对，可做锚点恰中 1 次的自证。 */
export const CARRY_ACTIONS = [
    {
        kind: 'replace',
        id: 'iter-meta-version',
        rel: 'ITERATION_LOG.md',
        why: '元信息「当前版本」行必须与 manifest 同源（v280 2 / v303 D2 点名；判据在文档侧，属抬版动作）',
        oldAnchor: (cur) => iterMetaAnchor(cur),
        newText: (cur, next) => iterMetaAnchor(next),
    },
    {
        kind: 'replace',
        id: 'boundary-recheck',
        rel: 'docs/runtime-verification-boundary.md',
        why: '边界文档必须带**当版**复校标记（v3202 E2 点名；只改头部当版那一处，历史复校行是留档不是待办）',
        oldAnchor: (cur) => boundaryAnchor(cur),
        newText: (cur, next) => boundaryAnchor(next),
    },
];
/* 一条**插入**型动作：没有可换的旧串（详见 planCarry 里那一段为什么合成段就够）。
 *   两类不同形，故分表 —— 把它们塞进同一个循环会让锚点判定长出特例分支，
 *   而本仓最忌「一条判据里两套逻辑」（分支里的那一支永远只有作者自己走过）。 */
export const CARRY_INSERTS = [
    {
        kind: 'insert',
        id: 'iter-segment',
        rel: 'ITERATION_LOG.md',
        why: '迭代日志必须含**当版段**（v3280 点名）。真抬版这一段是人工写的正文，'
            + '演练里插一段**合成段**（标题即显式标注）—— 本条验的是「有没有当版段」这道门槛，不是正文质量',
    },
];
/** 两类动作的**只读视图**（诊断与判据读这份，不必自己拼两张表）。 */
export const CARRY_PLAN = CARRY_ACTIONS.concat(CARRY_INSERTS);

/**
 * 在给定文件集合上**推演**一遍连带面动作（纯函数：不改盘、不抛给调用方之外的地方）。
 * @param {Record<string,string>} files 路径 → 文本（只含清单涉及的文件）
 * @param {string} cur 抬版前版本
 * @param {string} next 抬版后版本
 * @returns {{files:Record<string,string>, applied:string[], noop:string[], problems:string[]}}
 */
export function planCarry(files, cur, next) {
    const out = Object.assign({}, files);
    const applied = [];
    const noop = [];
    const problems = [];
    const countOf = (s, sub) => (sub ? s.split(sub).length - 1 : 0);
    const need = (a) => {
        const src = out[a.rel];
        if (typeof src === 'string') return src;
        problems.push(a.id + '：载体 ' + a.rel + ' 不在场（清单腐坏）');
        return null;
    };

    for (const a of CARRY_ACTIONS) {
        const src = need(a);
        if (src === null) continue;
        const oldA = a.oldAnchor(cur);
        const newA = a.newText(cur, next);
        const nOld = countOf(src, oldA);
        const nNew = countOf(src, newA);
        if (nOld === 1) {
            out[a.rel] = src.split(oldA).join(newA);
            applied.push(a.id);
            continue;
        }
        if (nOld === 0 && nNew >= 1) { noop.push(a.id); continue; }
        problems.push(a.id + '：锚点命中 ' + nOld + ' 次（应恰 1）—— 清单腐坏或已被别人改过，'
            + '本次**不猜**（猜了就会误改历史留档）');
    }

    for (const a of CARRY_INSERTS) {
        const src = need(a);
        if (src === null) continue;
        /* 合成段只做**门槛级**替代：真抬版这一段是人工正文（写什么、写多少都有讲究），
         *   而判据只问「迭代日志里有没有当版段」。故这里插的段标题自带
         *   「【抬版演练合成段】」，让任何读到镜像的人都一眼看出它不是正文 ——
         *   演练产物冒充发布正文，正是本仓最忌的「看起来成功」。 */
        const heading = /^## 迭代 (\d+) — /m.exec(src);
        if (!heading) { problems.push(a.id + '：找不到迭代段标题形态（探测器失效）'); continue; }
        if (src.includes('v' + next + ' · ')) { noop.push(a.id); continue; }
        const seg = '## 迭代 ' + (Number(heading[1]) + 1) + ' — v' + next + ' · 【抬版演练合成段】\n'
            + '- **【本段来由】** 由 `tools/bump-drill.mjs` 在**镜像**里合成：判据只要求'
            + '「迭代日志含当版段」这道门槛（v3280 点名），而真发布时这一段是人工写的正文。'
            + '本段**不是**发布正文，真仓一字未动。\n\n';
        out[a.rel] = seg + src;
        applied.push(a.id);
    }

    return { files: out, applied, noop, problems };
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
