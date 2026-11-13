/* ============================================================
 * scripts/lib/coverage-debt.mjs — 覆盖率欠账的纯函数面（R21-O4）[v4.145.0]
 * ------------------------------------------------------------
 * 【为什么有它】
 *   本仓 435 个测试文件、20 道门，却**从来没有一个读数回答得了这句话**：
 *   「哪个 app 目录一行测试都没有」。答案不是零，而是**没人问过** ——
 *   于是「新写的 app 顺带补点测试」全靠自觉，而自觉不会在没人看的地方发生。
 *
 * 【口径一：app 级 line% 是**行加权**，不是各文件百分比的平均】
 *   把 12 个文件各自的 67.22 / 92.65 … 直接平均，会让「3 行的空壳 100%」
 *   和「800 行的主体 40%」权重相同 —— 那是把读数做得好看，不是做得对。
 *   行加权需要每个文件的**总行数**。Node 的 spec 覆盖表只给 line% 与未覆盖行清单，
 *   但两者联立就能解出总行数：设覆盖 C、未覆盖 U、百分比 p = C/(C+U)
 *   ⇒ C = p·U/(1−p)。于是 C 与 (C+U) 都可复算，ΣC/Σ(C+U) 就是行加权 line%。
 *   p = 100 时 U = 0，C 未知但**覆盖率必然是 100%**，此时按 U=0、C 记为 0 参与加权
 *   会在「该目录没有任何未覆盖行」时把分母也当 0（NaN）。所以该支显式给 100，
 *   并在 `filesWithUnknownWeight` 里记一笔，不静默。
 *
 * 【口径二：「零测试」= 磁盘上有这个文件、而量出来一行都没覆盖】
 *   只数「覆盖表里 line% 为 0 的行」会漏掉**根本没被加载**的文件 ——
 *   而后者才是「一行测试都没有」的主体（没被 import ⇒ 没有任何一行被执行）。
 *   所以判定必须**结合磁盘清单**：目录里的 .js 文件全集 − 覆盖表里有正覆盖的文件集。
 *   这正是计划里那条负控制要防的「漏算的目录等于 100%」。
 *
 * 【口径三：门禁只做「不许退步」】
 *   新增硬下限会立刻变恒红（本仓实测整体 60.95%），所以门判两件：
 *   ① 任一 app 目录 line% 比基线低超过 `drop_pp`（默认 0.5pp）⇒ 红；
 *   ② 「零测试目录数」比基线多 ⇒ 红。
 *   两条都是**相对退步**，不是绝对高度 —— 这是本仓反复用过的口径（门只拦新增与退步）。
 * ============================================================ */

/** spec 覆盖表里的一行。三种形态：段标题（无数字）/ 目录（无数字）/ 文件（四列数字）。
 *  ★ 缩进必须把 `ℹ` 后面**那一个分隔空格也算进去**：实测 `ℹ apps` 是 1 个空格、
 *    `ℹ  accounting` 2 个、`ℹ   accounting-app.js` 3 个 —— 层级就是空格数。
 *    第一版把分隔空格用 `\s` 吃掉再数剩余空格，于是顶层 `apps` 得 0 被当成无效行跳过，
 *    结果整张表的路径栈建不起来、437 个文件全被算成「零覆盖」。这条是实跑抓到的。 */
const ROW_RE = /^\u2139( *)([^|]+?)\s*\|\s*([\d.]*)\s*\|\s*([\d.]*)\s*\|\s*([\d.]*)\s*\|\s*(.*)$/;

/** 把 "55-56 83-86 101" 这样的未覆盖行清单数成**行数**（不是条目数）。 */
export function countUncovered(spec) {
    const s = String(spec || '').trim();
    if (!s) return 0;
    let n = 0;
    for (const part of s.split(/\s+/)) {
        const m = /^(\d+)(?:-(\d+))?$/.exec(part);
        if (!m) continue;
        const a = Number(m[1]);
        const b = m[2] === undefined ? a : Number(m[2]);
        if (Number.isFinite(a) && Number.isFinite(b) && b >= a) n += b - a + 1;
    }
    return n;
}

/**
 * 解析 spec 报告器的覆盖表。返回文件行（带祖先路径），段标题与目录行只用于建路径。
 * 不用「缩进几格」判层：Node 的缩进是每层一个空格，但它对顶层段与子目录用的是同一套缩进，
 * 真正把两者分开的是**是否有数字列**。所以口径取「有数字 = 文件行」。
 */
export function parseCoverageSpec(text) {
    const out = [];
    /* 缩进即深度：`ℹ apps` 1 格、`ℹ  accounting` 2 格、`ℹ   accounting-app.js` 3 格。
     * 栈按深度落位（stack[depth] = 该深度的名字），子行取 0..depth-1 作祖先。 */
    const stack = [];
    for (const line of String(text || '').split('\n')) {
        const m = ROW_RE.exec(line);
        if (!m) continue;
        const depth = m[1].length;
        const name = m[2].trim();
        const linePct = m[3];
        if (!name) continue;
        if (depth < 1) continue;
        if (linePct === '') {
            /* 段标题 / 目录行：落位到该深度，并截断更深的残留（同级换名不该继承旧子项）。 */
            stack.length = depth;
            stack[depth - 1] = name;
            continue;
        }
        const pct = Number(linePct);
        if (!Number.isFinite(pct)) continue;
        const path = stack.slice(0, depth - 1).concat([name]);
        out.push({
            path,
            file: name,
            linePct: pct,
            uncovered: countUncovered(m[6])
        });
    }
    return out;
}

/** 由 line% 与未覆盖行数解出行数（见头部口径一）。返回 { covered, total, unknownWeight }。 */
export function lineWeightOf(row) {
    const p = Number(row.linePct);
    const u = Number(row.uncovered) || 0;
    if (!Number.isFinite(p)) return { covered: 0, total: 0, unknownWeight: true };
    /* p = 100 且无未覆盖行 ⇒ 这个文件的覆盖率必然是 100%，但它**没有权重可算**
     * （U=0 时 C 解不出来）。记成 unknownWeight 让上层知道「这一格没算进加权」，
     * 而不是假装它权重为 0 悄悄消失。 */
    if (p >= 100) return { covered: 0, total: 0, unknownWeight: true };
    if (p <= 0) return { covered: 0, total: u, unknownWeight: false };
    const covered = (p * u) / (100 - p);
    return { covered, total: covered + u, unknownWeight: false };
}

/** 把覆盖表的文件行聚成「每个 app 目录」的三列读数。diskFiles 给的是 apps/<dir> 下的 .js 全集。 */
export function buildAppStats({ rows, diskFilesByApp, appDirs }) {
    const coveredByApp = new Map();
    for (const row of rows) {
        /* rows 的 path 形如 ['apps','accounting','accounting-app.js']；只认 apps 下两级。 */
        if (row.path.length < 3) continue;
        if (row.path[0] !== 'apps') continue;
        const app = row.path[1];
        if (!coveredByApp.has(app)) coveredByApp.set(app, []);
        coveredByApp.get(app).push(row);
    }
    const dirs = {};
    for (const app of appDirs) {
        const disk = (diskFilesByApp.get(app) || []).slice().sort();
        const coveredRows = coveredByApp.get(app) || [];
        const coveredNames = new Set(coveredRows.filter((r) => r.linePct > 0).map((r) => r.file));
        let covered = 0;
        let total = 0;
        let unknownWeight = 0;
        for (const r of coveredRows) {
            const w = lineWeightOf(r);
            if (w.unknownWeight) unknownWeight += 1;
            covered += w.covered;
            total += w.total;
        }
        const zeroTest = disk.filter((f) => !coveredNames.has(f));
        dirs[app] = {
            line_pct: total > 0 ? Number(((covered / total) * 100).toFixed(2)) : (coveredRows.length > 0 ? 100 : 0),
            files_on_disk: disk.length,
            files_with_test: disk.length - zeroTest.length,
            zero_test_files: zeroTest.length,
            zero_test_names: zeroTest,
            files_unloaded: disk.filter((f) => !coveredRows.some((r) => r.file === f)).length,
            unknown_weight_files: unknownWeight
        };
    }
    return dirs;
}

/** 汇总视角：零测试目录（该目录下一个文件都没被正覆盖）。 */
export function zeroTestDirs(dirs) {
    return Object.keys(dirs).filter((d) => dirs[d].files_with_test === 0).sort();
}

/**
 * 「不许退步」判决。insufficient 视为拒判（不是红、也不是绿）：
 * 现场漏了某个目录，等于「漏算的目录算 100%」—— 那种情况下说「没退步」是假话。
 */
export function judgeNoRegression(baselineDirs, liveDirs, opts = {}) {
    const dropPp = Number.isFinite(opts.dropPp) ? opts.dropPp : 0.5;
    const reasons = [];
    const missing = [];
    const dropped = [];
    for (const app of Object.keys(baselineDirs || {})) {
        if (!(app in (liveDirs || {}))) { missing.push(app); continue; }
        const b = Number(baselineDirs[app].line_pct);
        const l = Number(liveDirs[app].line_pct);
        if (!Number.isFinite(b) || !Number.isFinite(l)) continue;
        const d = b - l;
        if (d > dropPp) dropped.push({ app, from: b, to: l, drop: Number(d.toFixed(2)) });
    }
    const baseZero = zeroTestDirs(baselineDirs || {});
    const liveZero = zeroTestDirs(liveDirs || {});
    const addedZero = liveZero.filter((d) => !baseZero.includes(d));
    if (missing.length) reasons.push('现场读数缺 ' + missing.length + ' 个目录（' + missing.join('、') + '）—— 漏算的目录不许当成没退步');
    for (const d of dropped) reasons.push('目录 ' + d.app + ' 覆盖率退步 ' + d.drop + 'pp（基线 ' + d.from + ' → 现场 ' + d.to + '，阈值 ' + dropPp + 'pp）');
    if (addedZero.length) reasons.push('零测试目录增加 ' + addedZero.length + ' 个（' + addedZero.join('、') + '；基线 ' + baseZero.length + ' → 现场 ' + liveZero.length + '）');
    const verdict = missing.length ? 'refuse' : (dropped.length || addedZero.length ? 'fail' : 'pass');
    return {
        verdict,
        reasons,
        missing,
        dropped,
        addedZero,
        dropPp,
        baseZeroCount: baseZero.length,
        liveZeroCount: liveZero.length
    };
}

export const DEBT_BEGIN = '<!-- coverage-debt:begin（本段由 scripts/coverage-report.mjs --write 生成，勿手改） -->';
export const DEBT_END = '<!-- coverage-debt:end -->';

/** 生成 TODO.md 的「覆盖率欠账清单」段。**由读数派生**，不手抄。 */
export function renderDebtSection(dirs, meta = {}) {
    const apps = Object.keys(dirs).sort();
    const zero = zeroTestDirs(dirs);
    const zeroFileTotal = apps.reduce((a, d) => a + (dirs[d].zero_test_files || 0), 0);
    const fileTotal = apps.reduce((a, d) => a + (dirs[d].files_on_disk || 0), 0);
    const lines = [];
    lines.push(DEBT_BEGIN);
    lines.push('### 覆盖率欠账清单（v' + (meta.version || '?') + ' 机器读数，勿手改）');
    lines.push('');
    lines.push('- app 目录 ' + apps.length + ' 个 · 盘上文件 ' + fileTotal + ' 个 · 一行都没覆盖 ' + zeroFileTotal + ' 个');
    lines.push('- **零测试目录 ' + zero.length + ' 个**：' + (zero.length ? zero.join('、') : '（无）'));
    lines.push('- 口径：`line%` 是**行加权**（不是各文件百分比的平均）；「零测试」= 磁盘上有这个文件、量出来一行都没覆盖，含**从未被 import**的那些。');
    lines.push('- 重算：`node scripts/coverage-report.mjs --write`（真跑一次全量覆盖，约 11 分钟）。');
    lines.push('');
    lines.push('| app 目录 | line% | 有测试的文件 | 零测试的文件 |');
    lines.push('|---|---|---|---|');
    const sorted = apps.slice().sort((a, b) => (dirs[a].line_pct - dirs[b].line_pct) || (b_zero(dirs, b) - b_zero(dirs, a)));
    for (const d of sorted) {
        const x = dirs[d];
        lines.push('| `' + d + '` | ' + Number(x.line_pct).toFixed(2) + ' | ' + x.files_with_test + ' | ' + x.zero_test_files + ' |');
    }
    lines.push(DEBT_END);
    return lines.join('\n');
}

function b_zero(dirs, d) {
    return dirs[d].zero_test_files || 0;
}

/** 把 TODO.md 里的段替换掉（幂等）。段不在场就追加到文末。 */
export function spliceDebtSection(todoText, section) {
    const text = String(todoText || '');
    const i = text.indexOf(DEBT_BEGIN);
    const j = text.indexOf(DEBT_END);
    if (i >= 0 && j > i) {
        return text.slice(0, i) + section + text.slice(j + DEBT_END.length);
    }
    const tail = text.endsWith('\n') ? '' : '\n';
    return text + tail + '\n' + section + '\n';
}
