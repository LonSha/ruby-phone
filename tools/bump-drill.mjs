/* ============================================================
 * tools/bump-drill.mjs — R-O2「抬版演练」的执行臂
 * ------------------------------------------------------------
 * 【治的欠债】R-O2 的验收里有一条是**动作**而不是读数：
 *   「新增一个抬版演练：抬版后全量回归不得因**版本锚**而新增红。」
 *   在此之前，「抬版会不会引入红」只能靠真抬一版去试 —— 抬手就污染历史（
 *   真仓的版本号一旦动了，`update-log` 就多一条历史条目，回不去）。
 *
 * 【本工具的做法：在镜像里真抬，在真仓里零改动】
 *   ① 全量镜像工作区到临时目录（含 tests/，因为演练对象就是套件）；
 *   ② 在镜像里把版本抬一格 —— **抬的是四源 + 公告块 + 日志条目**，
 *      与实际发布时那一次改动同形（少了公告块，测出来的是「演练没做全」而不是「版本锚坏」；
 *      本工具第一版就是这样，43 件红里 38 件是这个原因）；
 *   ③ 把「引用版本源的套件」按静态特征切成两组，分开跑、分开报：
 *        · **版本锚组** —— 只读版本源、**不读连带面载体**（ITERATION_LOG 元信息、
 *          边界文档复校标记、tests/audit 台账）的套件。这一组**必须零红**：
 *          它红了就是「版本锚把时点快照当永久约束」那一族真缺陷（R-O2 原文点名）。
 *        · **连带面组** —— 读了上面那三类载体的套件。这一组**预期会有红**：
 *          那些载体是**抬版时要一起改的清单**（ITERATION_LOG 的「当前版本」元信息与当版段、
 *          边界文档的「vX.Y.Z 复校」标记）。工具把它们如实报成 `carry-pending`，
 *          **不**把它们混进「版本锚红」里 —— 混在一起就会把该改的当成该修的。
 *   ④ 结束后删镜像。真仓全程**只读**（工具自己不写任何仓内文件）。
 *
 * 【为什么两组要分开跑，而不是一次跑完全部】
 *   归因成本。一次跑完只得到一个「有几件红」，分不清是哪一类；
 *   而这两类的**处置方向相反**（一类要改判据、一类要补抬版动作）。
 *   「红在一起 = 结论不可用」正是本仓反复付代价的形态。
 *
 * 【为什么批量跑而不是逐个 spawn】
 *   80 件逐个 spawn 实测 127s；一次 `node --test <...80 件>` 实测 26s。
 *   同一次运行内 node 会复用 worker —— 这不是运气，是启动开销被摊掉了。
 *   代价是失败件要靠 stdout 里的 `✖ tests/xxx.test.mjs` 行反解（见 parseFailed）。
 *
 * 用法：
 *   node tools/bump-drill.mjs                 # 真跑（约 60s），打印报告
 *   node tools/bump-drill.mjs --json          # 只打印报告 JSON
 *   node tools/bump-drill.mjs --write         # 顺带把报告落 tests/audit/bump-drill.json
 *   node tools/bump-drill.mjs --keep          # 保留镜像（调试工具自己时用）
 * 退出码：0 = 版本锚组零红；1 = 版本锚组有红（= R-O2 定义的真缺陷）；
 *         2 = 工具自身跑不动（镜像失败 / 抬版后四源仍不同源 / 批量面取不到）。
 * ============================================================ */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const argv = process.argv.slice(2);
const WANT_JSON = argv.includes('--json');
const WANT_WRITE = argv.includes('--write');
const KEEP = argv.includes('--keep');
const REPORT_REL = 'tests/audit/bump-drill.json';

const log = (...a) => { if (!WANT_JSON) console.log(...a); };
const die = (msg) => { console.error('[bump-drill] ✗ ' + msg); process.exit(2); };

/* ── ① 基线纪律：工作区必须干净 ──
 *   演练的价值在「可复现」。工作区脏着跑，镜像里就带着一份别人正在改的半成品，
 *   红了也说不清是谁的。故脏即拒跑 —— 拒跑不是失败，是**拒绝在不可解释的输入上下结论**。 */
function assertClean() {
    const r = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) die('git status 跑不动（本工具的基线纪律依赖 git）');
    const lines = String(r.stdout || '').split('\n').filter(Boolean);
    /* 允许本工具自己刚落下的报告（否则「跑一次 --write」之后再跑就会被自己挡住） */
    const dirty = lines.filter((l) => !l.includes(REPORT_REL));
    if (dirty.length) {
        die('工作区不干净（' + dirty.length + ' 项）—— 演练必须从干净基线起跑，'
            + '否则镜像里带着半成品，红了也说不清是谁的。首行：' + dirty[0]);
    }
}

/* ── ② 镜像 ──
 *   用 tar 而不是 fs.cpSync：本仓有大量非 .js 资源（素材 / 世界书 json），
 *   而 cpSync 的 filter 回调在本仓被瞬态文件坑过（见 tests/_mirror_tree.mjs 的来历）。
 *   tar 一次性拿整棵树，且实测 81M / 2s。 */
function mirror() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-bump-drill-'));
    const r = spawnSync('/bin/sh', ['-c',
        `tar cf - --exclude=.git . | (cd ${JSON.stringify(dir)} && tar xf -)`],
        { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    if (r.status !== 0) die('镜像失败：' + (r.stderr || '').slice(0, 300));
    return dir;
}

/* ── ③ 抬版（与真实发布那一次同形）── */
function bump(dir) {
    const readJson = (p) => JSON.parse(fs.readFileSync(path.join(dir, p), 'utf8'));
    const writeJson = (p, o) => fs.writeFileSync(path.join(dir, p), JSON.stringify(o, null, 2) + '\n');

    const idxP = path.join(dir, 'index.js');
    let idxSrc = fs.readFileSync(idxP, 'utf8');
    const cur = /const ST_PHONE_VERSION = '([\d.]+)'/.exec(idxSrc)?.[1];
    if (!cur) die('取不到入口版本常量（index.js 形态变了）');
    const parts = cur.split('.').map(Number);
    const next = [parts[0], parts[1], parts[2] + 1].join('.');

    const pkg = readJson('package.json');
    const man = readJson('manifest.json');
    const ul = readJson('update-log.json');
    const curEntry = ul.versions[cur];
    if (!curEntry) die('当前版在 update-log 里没有条目（版本源不同源，先修源再演练）');

    /* 公告块：日期与版本自述一并跟随（`version: ST_PHONE_VERSION` 是常量引用，不用改； */
    /* 块里其余位置出现的版本号是散文自述，必须一起抬 —— 少抬一处，v231/v236 的 */
    /* 「公告与头部日志逐字同源」就会红，而那是**演练没做全**，不是版本锚坏）。 */
    const at = idxSrc.indexOf('const ST_PHONE_CURRENT_UPDATE = {');
    if (at < 0) die('找不到公告块（ST_PHONE_CURRENT_UPDATE）');
    const endRel = idxSrc.indexOf('\n};', at);
    const block = idxSrc.slice(at, endRel + 3);
    const newBlock = block
        .replace(/date:\s*"\d{4}-\d{2}-\d{2}"/, `date: "${new Date().toISOString().slice(0, 10)}"`)
        .replaceAll(cur, next);
    idxSrc = idxSrc.replace(block, newBlock)
        .replace(`const ST_PHONE_VERSION = '${cur}'`, `const ST_PHONE_VERSION = '${next}'`);
    fs.writeFileSync(idxP, idxSrc);

    pkg.version = next; man.version = next;
    writeJson('package.json', pkg);
    writeJson('manifest.json', man);

    /* 日志：把当版条目复制成新版（**items 不缩水** —— 缩水了测的是「样本不足」不是「版本锚」） */
    const items = (curEntry.items || []).map((s) => String(s).replaceAll(cur, next));
    const versions = { [next]: { version: next, date: new Date().toISOString().slice(0, 10), items } };
    for (const [k, v] of Object.entries(ul.versions)) versions[k] = v;
    ul.versions = versions; ul.latest = next; ul.head = next;
    writeJson('update-log.json', ul);

    /* 抬版后自证四源同源 —— 演练的前提塌了就别往下跑（那时候结论不可解释） */
    const p2 = readJson('package.json'); const m2 = readJson('manifest.json');
    const u2 = readJson('update-log.json');
    const i2 = /const ST_PHONE_VERSION = '([\d.]+)'/.exec(fs.readFileSync(idxP, 'utf8'))?.[1];
    if (!(p2.version === next && m2.version === next && u2.latest === next && i2 === next
        && Object.keys(u2.versions)[0] === next)) {
        die(`抬版后四源仍不同源：pkg=${p2.version} man=${m2.version} log=${u2.latest} idx=${i2}`);
    }
    return { from: cur, to: next };
}

/* ── ④ 分组：静态特征切分（不按文件名猜，读文件内容）── */
const VERSION_SOURCE_RE = /package\.json|manifest\.json|update-log\.json|ST_PHONE_VERSION/;
/* 带外部进程的套件排除在**批量面**之外：它们自己会 spawn 子进程，
 *   批量跑时与 node 的 worker 调度互扰（且它们多测的是工具自身，与本演练无关）。 */
const SPAWNS_RE = /child_process|spawnSync|execSync/;
/* 连带面载体：抬版时要一起改的东西。读了它们的套件预期会有红，归第二组。 */
const CARRY_RE = /ITERATION_LOG\.md|runtime-verification-boundary\.md|tests\/audit\//;

function classify(dir) {
    const T = path.join(dir, 'tests');
    const anchors = [];
    const carry = [];
    for (const n of fs.readdirSync(T).filter((x) => x.endsWith('.test.mjs')).sort()) {
        const src = fs.readFileSync(path.join(T, n), 'utf8');
        if (!VERSION_SOURCE_RE.test(src)) continue;
        if (SPAWNS_RE.test(src)) continue;
        if (CARRY_RE.test(src)) carry.push(n); else anchors.push(n);
    }
    return { anchors, carry };
}

/* ── ⑤ 跑 ── */
function runSuite(dir, list) {
    if (!list.length) return { ms: 0, failed: [], tests: 0 };
    const t0 = Date.now();
    const r = spawnSync(process.execPath, ['--test', ...list.map((n) => path.join('tests', n))], {
        cwd: dir, encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024,
    });
    const out = (r.stdout || '') + (r.stderr || '');
    /* 失败件反解：`--test` 批量失败时逐件打印 `✖ tests/xxx.test.mjs`。
     *   ★ 这里必须要求**路径形态**（含 `/`），否则断言行的 `✖ 某条判定名` 也会被收进来。 */
    const failed = [...new Set((out.match(/^✖ tests\/[A-Za-z0-9_.-]+\.test\.mjs/gm) || [])
        .map((s) => s.replace(/^✖ tests\//, '').trim()))];
    const tests = Number((/^ℹ tests (\d+)$/m.exec(out) || [])[1] || 0);
    return { ms: Date.now() - t0, failed, tests, exit: r.status };
}

/* ── 主流程 ── */
assertClean();
const dir = mirror();
let result;
try {
    const bumped = bump(dir);
    const groups = classify(dir);
    log(`[bump-drill] 抬版 ${bumped.from} → ${bumped.to}（镜像 ${dir}）`);
    log(`[bump-drill] 版本锚组 ${groups.anchors.length} 件 · 连带面组 ${groups.carry.length} 件`);

    const a = runSuite(dir, groups.anchors);
    const c = runSuite(dir, groups.carry);
    log(`[bump-drill] 版本锚组 ${a.ms} ms · 断言 ${a.tests} · 红 ${a.failed.length}` +
        (a.failed.length ? '：' + a.failed.join(', ') : ''));
    log(`[bump-drill] 连带面组 ${c.ms} ms · 断言 ${c.tests} · 红 ${c.failed.length}` +
        (c.failed.length ? '：' + c.failed.join(', ') : ''));

    result = {
        schema: 'bump-drill@1',
        at: new Date().toISOString(),
        from: bumped.from,
        to: bumped.to,
        anchor_group: {
            suite_files: groups.anchors.length,
            suite_list: groups.anchors,
            tests: a.tests,
            failed: a.failed,
            ms: a.ms,
        },
        carry_group: {
            suite_files: groups.carry.length,
            suite_list: groups.carry,
            tests: c.tests,
            failed: c.failed,
            ms: c.ms,
            /* 连带面载体是**抬版动作清单**，不是判据缺陷 —— 这句话必须随读数一起落盘，
               否则下一个读者会把 `failed` 当成「版本锚坏了」。 */
            note: '这一组读了抬版连带面载体（ITERATION_LOG 元信息与当版段 / 边界文档复校标记 / '
                + 'tests/audit 台账）。它们的红是「抬版动作还没做」，与版本锚缺陷是**两类**：'
                + '前者照清单补齐即绿，后者要改判据。混看会把该改的当成该修的。',
        },
        verdict: a.failed.length === 0 ? 'anchor-ok' : 'anchor-regression',
    };
    if (WANT_JSON) console.log(JSON.stringify(result, null, 2));
    if (WANT_WRITE) {
        fs.writeFileSync(path.join(ROOT, REPORT_REL), JSON.stringify(result, null, 2) + '\n');
        log(`[bump-drill] 报告已写入 ${REPORT_REL}（真仓唯一被本工具触碰的文件）`);
    }
} finally {
    if (!KEEP) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
}
log(result.verdict === 'anchor-ok'
    ? '[bump-drill] ✓ 版本锚组零红 —— 抬版不会因版本锚新增红'
    : '[bump-drill] ✗ 版本锚组有红 —— 这就是 R-O2 要消的那一族（判据把时点快照当永久约束）');
process.exit(result.verdict === 'anchor-ok' ? 0 : 1);