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
 * 【为什么抬的幅度也要能选（--to=）】
 *   版本锚有三种形状，它们**对抬版幅度的敏感度不同**：
 *     · 等值形（`version === '3.72.0'`）—— 任何幅度都会红，patch 抬就能暴露；
 *     · 下限形（`>= 3.0.3`）/ 上限形（`< 4.0.0`）—— **patch 抬永远测不出来**：
 *       3.72.0 → 3.72.1 仍落在同一个区间里。它们只在跨档抬（3.72.1 → 3.73.0 或 4.0.0）
 *       时才可能翻面。只跑 patch 抬的演练，会把这整族如实报成「零红」。
 *   故 `--to=X.Y.Z` 可指定抬到哪一档；矩阵跑法（patch + minor 各一次）见 ITERATION_LOG。
 *
 * 【为什么要「正控制」（先跑真仓看一眼）】
 *   本工具的判据是「版本锚组零红」。而**零红本身不是证据** —— 一个把扫描面写错、
 *   把套件全漏掉的坏分组器，也会给出「零红」。故在真仓（未抬版）上先跑一次同一组：
 *   真仓若有红，报告的 verdict 是 `baseline-dirty`（**拒判**，不是绿也不是红），
 *   因为那时候「抬版后红了几件」这个差值根本算不出来。
 *   ★ 这一条的由来：本仓出过「探针扫错面 → 零红 → 被当成通过」的形态（见 ITERATION_LOG）。
 *
 * 用法：
 *   node tools/bump-drill.mjs                 # 真跑（约 60s），patch +1
 *   node tools/bump-drill.mjs --to=3.73.0     # 抬到指定版本（跨档探下限/上限形）
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
/* 纯判定内核：分组 / 取数 / 宿主资格 / 版本比较 / 读数归因（唯一实现，可单测）。 */
import {
    classifySources, parseFailedFromOutput, isUnattributedRed, cmpVersion,
    analyzeDrill, analyzeProbes, pickProbeHost as corePickHost,
} from './bump-drill-core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const argv = process.argv.slice(2);
const WANT_JSON = argv.includes("--json") || argv.includes("--diag");
const WANT_WRITE = argv.includes('--write');
const KEEP = argv.includes('--keep');
/* 全量面（tests/*.test.mjs 全部）**默认不跑**：本仓的纪律是全量回归留到收口时一次跑，
 *   演练阶段跑它两遍（真仓一次 + 镜像一次）既慢又会把「收口时的读数」提前用掉。
 *   需要时显式 --corpus；未跑时报告里登记 executed:false（未执行不报通过）。 */
const WANT_CORPUS = argv.includes('--corpus');
const TO_ARG = (argv.find((a) => a.startsWith('--to=')) || '').slice(5).trim();
const WANT_MATRIX = argv.includes('--matrix');
/* 注入锚探针：默认**跑**（它是「零红」这件事本身的证据 —— 不跑，零红就与「扫描面写错」不可分）。
 *   代价：多一个镜像 + 多一次锚组运行（约 35s）。要省时间可 --no-probe，但报告会记 executed:false。 */
const WANT_PROBE = !argv.includes('--no-probe');
/* 开发本工具时需要先跑一次再看读数，而那时工作区必然是本工具自己改了 —— 默认仍拒跑，
 *   要跑必须**显式** --allow-dirty，且报告里记 `baseline.clean:false` + 脏文件清单。
 *   「允许」不等于「无声」：读数照出，但读它的人一眼能看到「这一跑不是从干净基线起的」。 */
const ALLOW_DIRTY = argv.includes('--allow-dirty');
/* 全量面的日志落盘路径。默认 `tests/audit/bump-drill-corpus.log` —— 它命中 .gitignore 里的
 *   `*.log`（实测 `git status --porcelain` 不列它），故不会把演练弄成「工作区脏」。 */
const LOG_ARG = (argv.find((a) => a.startsWith('--log=')) || '').slice(6).trim();
const REPORT_REL = 'tests/audit/bump-drill.json';
const CORPUS_LOG_REL = LOG_ARG || 'tests/audit/bump-drill-corpus.log';

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

/* ── ③ 抬版（与真实发布那一次同形）──
 *   target 传 null ⇒ patch +1（默认）；传 "X.Y.Z" ⇒ 抬到那一档（跨档探下限/上限形）。 */
function bump(dir, target = null) {
    const readJson = (p) => JSON.parse(fs.readFileSync(path.join(dir, p), 'utf8'));
    const writeJson = (p, o) => fs.writeFileSync(path.join(dir, p), JSON.stringify(o, null, 2) + '\n');

    const idxP = path.join(dir, 'index.js');
    let idxSrc = fs.readFileSync(idxP, 'utf8');
    const cur = /const ST_PHONE_VERSION = '([\d.]+)'/.exec(idxSrc)?.[1];
    if (!cur) die('取不到入口版本常量（index.js 形态变了）');
    const next = target || (() => {
        const parts = cur.split('.').map(Number);
        return [parts[0], parts[1], parts[2] + 1].join('.');
    })();
    if (!/^\d+\.\d+\.\d+$/.test(next)) die('--to 必须是 X.Y.Z 形态：' + JSON.stringify(next));
    if (next === cur) die('--to 与当前版本相同（那就不叫抬版了）：' + next);

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

/* ── ④ 分组：静态特征切分（唯一实现在 tools/bump-drill-core.mjs，本文件只负责读盘）──
 *   抽出去的理由见那个文件的头部：分组/取数/宿主资格/版本比较这四件是**纯函数**，
 *   判据套件（tests/system-v3750.test.mjs）要对它们做正反两向验证；
 *   留两份实现必然漂移（本仓的老账）。 */
function classify(dir) {
    const T = path.join(dir, 'tests');
    const names = fs.readdirSync(T).filter((x) => x.endsWith('.test.mjs')).sort();
    return classifySources(names.map((n) => [n, fs.readFileSync(path.join(T, n), 'utf8')]));
}

/* ── ⑤ 跑 ── */
function runSuite(dir, list) {
    if (!list.length) return { ms: 0, failed: [], tests: 0 };
    const t0 = Date.now();
    const r = spawnSync(process.execPath, ['--test', ...list.map((n) => path.join('tests', n))], {
        cwd: dir, encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024,
    });
    const out = (r.stdout || '') + (r.stderr || '');
    /* 失败件反解走内核的唯一实现（两种形态都认 —— 认错就是假绿，本工具真栽过一次）。 */
    const { failed, failCount, tests } = parseFailedFromOutput(out);
    return { ms: Date.now() - t0, failed, tests, failCount, exit: r.status,
        bytes: out.length, signal: r.signal || null, out,
        /* exit=null 通常意味着「被信号杀」或「超时」—— 那时**没有任何读数可信**，
         *   必须与「跑完且红」区分开，否则会把它算成红。 */
        red: (r.status !== 0) || (Number.isFinite(failCount) && failCount > 0) };
}

/* ── ⑤b 全量面（`tests/*.test.mjs` 全部）──
 *   与 runSuite 的区别不只是「跑得多」：本组**不能**靠 stdout 反解失败件 ——
 *   200+ 件一起跑，`✖ tests/xxx.test.mjs` 这类行会被 Node 以「按文件分组」的形态输出，
 *   形状随版本变（实测：单文件与批量两种形状不同，靠正则反解会漏）。
 *   故这一组让 node 自己把完整输出**落盘**（`--test-reporter=tap` 之外还有 spec，
 *   但 spec 的输出被 Node 截断为「前 N 件详情 + 汇总」）。取数改为：
 *     · `failed` 走汇总行 `# fail N`（Node 稳定输出）；
 *     · 明细落 .log，人工/后续核数用。
 *   `log` 字段随报告落盘 ——「未执行不报通过」与「读数必须可复核」是同一件事的两面。 */
function corpusRun(dir) {
    const t0 = Date.now();
    const abs = path.join(dir, CORPUS_LOG_REL);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const fd = fs.openSync(abs, 'w');
    const r = spawnSync('/bin/sh', ['-c',
        `${JSON.stringify(process.execPath)} --test tests/*.test.mjs > ${JSON.stringify(abs)} 2>&1`],
        { cwd: dir, encoding: 'utf8', timeout: 1800000 });
    fs.closeSync(fd);
    const out = fs.readFileSync(abs, 'utf8');
    const failedAll = Number((/^# fail (\d+)$/m.exec(out) || [])[1] || NaN);
    const tests = Number((/^# tests (\d+)$/m.exec(out) || [])[1] || 0);
    /* 明细：`not ok N - <file>` 是 TAP 的形态；本仓用 spec，故另取 `✖ ` 行里带 .test.mjs 的。
     * 取不到明细不影响判据（判据是 fail 数），但要在报告里如实标 `detail_available`。 */
    const detail = [...new Set((out.match(/^✖ (.+\.test\.mjs)/gm) || [])
        .map((s) => s.replace(/^✖ /, '').trim()))].sort();
    return {
        ms: Date.now() - t0, tests, failed_count: failedAll,
        failed: detail, detail_available: detail.length > 0 || failedAll === 0,
        exit: r.status, log: path.relative(dir, abs),
    };
}

/* ── ⑥ 正控制（基线）：在真仓上先跑一遍同一组 ──
 *   「零红」只有在**同一组套件在未抬版时也是零红**的前提下才是证据。
 *   真仓此刻若有红，那说明这棵树上本来就有别的红（与抬版无关）——
 *   那时候「抬版后红了几件」这个差值算不出来，正确动作是**拒判**而不是报绿。 */
function isCleanWorktree() {
    const r = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) return null;
    const lines = String(r.stdout || '').split('\n').filter(Boolean);
    return lines.filter((l) => !l.includes(REPORT_REL));
}

/* ── ⑥b 注入锚（本工具自己的负控制）──
 *   「版本锚组零红」有两类假绿：① 真没有锚；② **扫描面根本没扫到那些套件**
 *   （分组器写错、文件被漏读、正则不匹配）。两类在读数上长得一模一样。
 *   故本工具内置一组探针：往锚组里**真注入**人造判据，再看它们会不会被抓住。
 *     · token（令牌，恒失败）—— 证明「注入进去的测试**真会跑**」；
 *     · equal（等值形 `version === 'CUR'`）—— 抬版后必须转红；
 *     · ceil （上限形 `version <= 'CUR'`）—— 抬版后必然翻面（3.72.0 → 3.72.1 越界）；
 *     · floor（下限形 `version >= 'CUR'`）—— **抬版后不翻面**（3.72.0 → 3.73.0 仍 ≥）。
 *       这一条是**如实暴露盲区**：它证明「零红」不等于「没有锚」，只等于
 *       「没有会因抬版翻面的锚」。工具不许把 floor 探针算作「工具坏了」，也不许算作「安全」。
 *
 *   ★ 【注入宿主的资格】第一版把探针注入 `audit.test.mjs`，读数报「没被抓住」，
 *     差点把工具自己判成失效。手工复现（/tmp/probe_repro.mjs）看到真因：
 *     该文件是**顶层脚本**，末尾 `process.exit(fail > 0 ? 1 : 0)` ——
 *     在 Node 测试运行器**加载**它的那一刻进程就退了（exit 0），
 *     注入的 `test(...)` 根本没注册，而运行器把整个文件报成「✔ 1 个通过」。
 *     即：**带顶层 process.exit 的文件不能当注入宿主**，它会把注入的判据静默吞掉、
 *     并伪装成全绿。故宿主必须同时满足两条：① 不含顶层 process.exit；
 *     ② 真的 `import ... from 'node:test'`（否则注入的 test 不会被运行器收走）。
 *     再用 token 探针做**运行期**自证：token 都没红 ⇒ 探针读数无效 ⇒ exit 2（不是「工具坏」）。
 *   探针注入的是**镜像**，真仓零改动。 */
function pickProbeHost(dir) {
    const T = path.join(dir, 'tests');
    const names = fs.readdirSync(T).filter((x) => x.endsWith('.test.mjs')).sort();
    const host = corePickHost(names.map((n) => [n, fs.readFileSync(path.join(T, n), 'utf8')]));
    if (!host) {
        die('找不到可用的注入宿主（锚组里每个套件要么含顶层 process.exit，要么不用 node:test）'
            + '—— 探针无处注入，结论不可用');
    }
    /* 现取而不是写死文件名：写死会在改名/改分组后静默注入到 carry 组
     *   （读数仍绿，因为 carry 的红不算 verdict），那正是一个假绿。 */
    return host;
}
function injectProbe(dir, kind, cur) {
    const T = path.join(dir, 'tests');
    const host = pickProbeHost(dir);
    /* 探针里的版本比较**直接 import 内核那一份实现**，不在这里抄第二份 ——
     *   抄一份必然漂移（本仓的老账），而漂移的表现是「探针说抓不住，其实是我比较写错了」。
     *   镜像里有 tools/，故这条 import 在镜像内可解析（驱动器不校验镜像的导入面；
     *   若哪天 moved，注入后跑不起来会由 token 探针当场转红）。 */
    const cmp = '__bdCmp';
    const MARK = (k) => '__BD_PROBE_' + k.toUpperCase() + '__';
    const body = {
        equal: `__bdAssert.equal(__bdVersion, '${cur}')`,
        ceil: `__bdAssert.ok(${cmp}(__bdVersion, '${cur}') <= 0, '上限形：版本不得超过 ${cur}')`,
        floor: `__bdAssert.ok(${cmp}(__bdVersion, '${cur}') >= 0, '下限形：版本不得低于 ${cur}')`,
    }[kind];
    if (!body) die('未知探针形态：' + kind + '（可选 equal / ceil / floor）');
    /* 标题里带 marker：判「有没有被抓住」按**测试名**取数，不按退出码 ——
     *   同一进程里还有恒失败的令牌探针，退出码对两者是同一个数，无法归因。 */
    const snippet = [
        '',
        '/* ★ 本节由 tools/bump-drill.mjs 的注入探针写入（仅在镜像里；真仓永不含这段）。 */',
        "import { readFileSync as __bdRead } from 'node:fs';",
        "import { test as __bdTest } from 'node:test';",
        "import __bdAssert from 'node:assert/strict';",
        "import { cmpVersion as __bdCmp } from '../tools/bump-drill-core.mjs';",
        "const __bdVersion = JSON.parse(__bdRead(new URL('../manifest.json', import.meta.url), 'utf8')).version;",
        `__bdTest('${MARK('token')} 令牌（恒失败，证明注入的判据真会跑）', () => { __bdAssert.ok(false, '令牌'); });`,
        `__bdTest('${MARK(kind)} 注入锚（${kind}）', () => { ${body}; });`,
    ].join('\n') + '\n';
    fs.appendFileSync(path.join(T, host), snippet);
    return { kind, suite: host, mark: MARK(kind), token_mark: MARK('token'),
        expect: kind === 'floor' ? 'not-flipped' : 'detected', cur };
}

/* ── 主流程 ── */
const dirty = isCleanWorktree();
if (dirty === null) die('git status 跑不动（本工具的基线纪律依赖 git）');
if (dirty.length && !ALLOW_DIRTY) {
    die('工作区不干净（' + dirty.length + ' 项）—— 演练必须从干净基线起跑，'
        + '否则镜像里带着半成品，红了也说不清是谁的。首行：' + dirty[0]
        + '（开发本工具时可用 --allow-dirty，读数里会如实标 baseline.clean=false）');
}
if (dirty.length) {
    log(`[bump-drill] ⚠ --allow-dirty：工作区有 ${dirty.length} 项改动，`
        + '本次读数**不是**从干净基线起的（报告记 baseline.clean=false）。'
        + '正式演练必须去掉这个开关。');
}

/* 演练矩阵：默认只跑 patch（快）；--matrix 跑 patch + minor 两档。
 *   上限/下限形版本锚只在跨档抬时才有机会翻面（见头部注释），故跨档那一次不是可选装饰。 */
const TARGETS = (() => {
    if (WANT_MATRIX || !TO_ARG) {
        const perTarget = (t) => ({ label: t || 'patch+1', to: t || null });
        return WANT_MATRIX ? [perTarget(null), perTarget('minor')] : [perTarget(null)];
    }
    return [{ label: TO_ARG, to: TO_ARG }];
})();

/* 同一进程里抬 patch 与 minor：minor 档把中间位 +1、末位归零。
 *   形态由 bump() 现取当前版决定，故这里只传「意图」。 */
function targetOf(kind, cur) {
    if (!kind) return null;
    if (kind === 'minor') {
        const p = cur.split('.').map(Number);
        return [p[0], p[1] + 1, 0].join('.');
    }
    return kind;
}

/* ── ⑥c 探针的执行：三个形态各起一个镜像，注入 → 抬版 → 只跑注入了探针的那一件 ──
 *   为什么每形态单独一个镜像：探针会被写进套件文件，混在一个镜像里三种锚互相覆盖
 *   （后写的那条决定结果），读数就无法归因到形态。 */
function runProbes(curVersion) {
    if (!WANT_PROBE) {
        return { executed: false, note: '未跑（--no-probe）—— 此时「零红」与「扫描面写错」不可分，'
            + '本读数不构成 R-O2 验收证据。' };
    }
    const out = { executed: true, probes: [], note:
        '三者都不是「产品缺陷」也不是「工具坏了」，而是**度量**：token 证明注入的判据真会跑，'
        + 'equal / ceil 证明工具真能抓住锚，floor 如实暴露最大的盲区 —— '
        + '抬版这件事本身无法证伪「下限形锚」是否与真版本一致。' };
    for (const kind of ['equal', 'ceil', 'floor']) {
        const dir = mirror();
        try {
            const meta = injectProbe(dir, kind, curVersion);
            const bumped = bump(dir, null);
            /* 只跑注入了探针的那一件 —— 这一跑量的不是「全仓有几红」，
             *   而是「这个人造锚会不会被抬版翻面」。 */
            const r = runSuite(dir, [meta.suite]);
            /* 按**标题里的 marker**归因（令牌与锚在同一进程里，退出码对两者是同一个数）。 */
            const tokenRed = new RegExp('✖ ' + meta.token_mark).test(r.out);
            const anchorRed = new RegExp('✖ ' + meta.mark).test(r.out);
            const caught = anchorRed;
            const ok = meta.expect === 'detected' ? caught : !caught;
            /* 令牌没红 ⇒ 这一跑里注入的判据压根没执行 ⇒ 锚的红/绿都不可信。 */
            if (!tokenRed) out.token_proof = out.token_proof || [];
            if (!tokenRed) out.token_proof.push(kind);
            out.probes.push({
                kind, suite: meta.suite, expect: meta.expect,
                bumped_to: bumped.to, fail_count: r.failCount,
                exit: r.exit, signal: r.signal, ms: r.ms, bytes: r.bytes,
                token_red: tokenRed, anchor_red: anchorRed,
                caught, as_expected: ok,
            });
            log(`[bump-drill] 注入锚 ${kind}：抬到 ${bumped.to} ⇒ ${caught ? '被抓住' : '未翻面'}`
                + `（期望：${meta.expect === 'detected' ? '必须被抓住' : '按原理不该翻面'}`
                + `；令牌自证 ${tokenRed ? '真会跑' : '✗ 未执行'}）`
                + (ok ? '' : ' ✗ 与期望不符'));
        } finally {
            try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ }
        }
    }
    /* 判「工具自身是否有效」用**令牌**（不是 equal）：令牌红说明注入的判据真会跑，
     *   这一步不成立时，equal 的「没被抓住」与「注入被静默吞掉」不可分 ——
     *   第一版正是被后者骗到（宿主文件顶层 process.exit，注入的 test 从未注册）。 */
    out.token_ok = !out.token_proof;
    const equal = out.probes.find((p) => p.kind === 'equal');
    out.tool_valid = out.token_ok && !!(equal && equal.caught);
    return out;
}

const runs = [];
for (const t of TARGETS) {
    const dir = mirror();
    try {
        const cur = /const ST_PHONE_VERSION = '([\d.]+)'/.exec(
            fs.readFileSync(path.join(dir, 'index.js'), 'utf8'))?.[1];
        const to = targetOf(t.to, cur);
        const bumped = bump(dir, to);
        const groups = classify(dir);
        log(`[bump-drill] 抬版 ${bumped.from} → ${bumped.to}（${t.label}，镜像 ${dir}）`);
        log(`[bump-drill] 版本锚组 ${groups.anchors.length} 件 · 连带面组 ${groups.carry.length} 件`);

        /* 正控制：抬版前 + 抬版后各跑一次同一组。
         *   为什么要两次（而不是只跑抬版后）：套件里既有「读真源」也有「读磁盘现况」两类，
         *   抬版后那一跑只能给出**总量**；而 R-O2 要的是**增量**（因版本锚而**新增**的红）。
         *   故「抬版前的红」是差值算法的减数 —— 缺了它，本仓既有的红会被记成抬版的账。 */
        const before = runSuite(dir, groups.anchors, { bumpTo: null });
        if (before.failed.length) {
            log(`[bump-drill] ⚠ 正控制失败：抬版前版本锚组已有 ${before.failed.length} 件红（与抬版无关，本仓既有）：`
                + before.failed.join(', '));
        }
        const a = runSuite(dir, groups.anchors, { bumpTo: bumped.to });
        const c = runSuite(dir, groups.carry, { bumpTo: bumped.to });
        const added = a.failed.filter((n) => !before.failed.includes(n));
        /* 「有红但一件都没点名」= 读数不可归因（明细正则没匹配上，或失败来自套件之外）。
         *   这种时候**不许报零红**：它可能与真正新增的红并存，只是我们看不见。 */
        const unattributed = isUnattributedRed(a) || isUnattributedRed(c) || isUnattributedRed(before);
        if (unattributed) {
            log('[bump-drill] ⚠ 有红但失败件明细为空（读数不可归因）—— 本次不计「零红」，'
                + '见报告 unattributed_red。');
        }
        log(`[bump-drill] 正控制（未抬版）${before.ms} ms · 红 ${before.failed.length}`);
        log(`[bump-drill] 版本锚组 ${a.ms} ms · 断言 ${a.tests} · 红 ${a.failed.length}` +
            (a.failed.length ? '：' + a.failed.join(', ') : ''));
        log(`[bump-drill] 连带面组 ${c.ms} ms · 断言 ${c.tests} · 红 ${c.failed.length}` +
            (c.failed.length ? '：' + c.failed.join(', ') : ''));

        runs.push({
            label: t.label,
            from: bumped.from,
            to: bumped.to,
            unattributed_red: unattributed,
            baseline: {
                tests: before.tests, failed: before.failed,
                red: before.red, exit: before.exit, ms: before.ms,
            },
            anchor_group: {
                suite_files: groups.anchors.length,
                suite_list: groups.anchors,
                tests: a.tests,
                failed: a.failed,
                red: a.red, exit: a.exit,
                added_by_bump: added,
                ms: a.ms,
            },
            carry_group: {
                suite_files: groups.carry.length,
                suite_list: groups.carry,
                tests: c.tests,
                failed: c.failed,
                red: c.red, exit: c.exit,
                ms: c.ms,
                /* 连带面载体是**抬版动作清单**，不是判据缺陷 —— 这句话必须随读数一起落盘，
                   否则下一个读者会把 `failed` 当成「版本锚坏了」。 */
                note: '这一组读了抬版连带面载体（ITERATION_LOG 元信息与当版段 / 边界文档复校标记 / '
                    + 'tests/audit 台账）。它们的红是「抬版动作还没做」，与版本锚缺陷是**两类**：'
                    + '前者照清单补齐即绿，后者要改判据。混看会把该改的当成该修的。',
            },
        });
    } finally {
        if (!KEEP) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
    }
}

/* 全量面（本仓另一组「断言真实版本」的套件，含下限形/上限形与「必须含当前版本段」）——
 *   默认不跑（收口纪律）。跑法：一次 node --test tests/*.test.mjs。 */
let corpus = { executed: false, note: '未跑（默认；全量面留到收口时一次跑，演练阶段不重复跑）。'
    + '需要时用 --corpus，或按 .github/workflows 的同名命令手动跑。' };
if (WANT_CORPUS) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-bump-corpus-'));
    try {
        spawnSync('/bin/sh', ['-c',
            `tar cf - --exclude=.git . | (cd ${JSON.stringify(dir)} && tar xf -)`],
            { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
        const cur = /const ST_PHONE_VERSION = '([\d.]+)'/.exec(
            fs.readFileSync(path.join(dir, 'index.js'), 'utf8'))?.[1];
        const bumped = bump(dir, targetOf(TARGETS[0].to, cur));
        const out = corpusRun(dir);
        log(`[bump-drill] 全量面 ${bumped.to}：${out.tests} 用例 · 红 ${out.failed_count}`
            + (Number.isFinite(out.failed_count) ? '' : '（汇总行取不到 ⇒ 如实报 NaN，不报 0）')
            + (out.failed.length ? '：' + out.failed.slice(0, 12).join(', ') : ''));
        corpus = {
            executed: true, to: bumped.to, tests: out.tests,
            failed_count: out.failed_count, failed: out.failed,
            detail_available: out.detail_available, ms: out.ms, log: out.log,
            note: '本组读的是「必须含当前版本段」这一类下限形/全文形断言：抬版后 ITERATION_LOG 未补'
                + '当版段 ⇒ 红。这是抬版动作清单，不是版本锚缺陷；`.log` 是每次运行的日志'
                + '（命中 .gitignore 的 *.log，不进版本库），外部读者可据它核数。',
        };
    } finally {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ }
    }
}

/* 探针用「真仓当前版」作锚值：抬到任何别处都该翻面（floor 那条按原理例外）。 */
const probes = runProbes(
    /const ST_PHONE_VERSION = '([\d.]+)'/.exec(
        fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8'))?.[1] || '');

const drills = analyzeDrill(runs);
const probeVerdict = probes.executed ? analyzeProbes(probes) : { tool_valid: null, token_ok: null };
const verdict = (probes.executed && !probeVerdict.tool_valid) ? 'tool-invalid'
    : !drills.coverage_ok ? 'baseline-dirty'
    : drills.anchor_regressions.length ? 'anchor-regression'
    : 'anchor-ok';
const result = {
    schema: 'bump-drill@2',
    at: new Date().toISOString(),
    baseline: {
        clean: dirty.length === 0,
        dirty_count: dirty.length,
        dirty_files: dirty.slice(0, 20),
        note: '干净基线是演练可解释性的前提。clean=false 时读数是「带着未提交改动的镜像」跑出来的，'
            + '只可用于调试本工具，不可作为 R-O2 的验收证据。',
    },
    corpus,
    probes,
    probe_verdict: probeVerdict,
    runs,
    /* 归因口径的唯一实现在内核（tools/bump-drill-core.mjs 的 analyzeDrill）——
       报告里落一份，读的人不必再去执行一遍判据。 */
    analysis: drills,
    verdict,
};
if (WANT_JSON) console.log(JSON.stringify(result, null, 2));
if (WANT_WRITE) {
    fs.writeFileSync(path.join(ROOT, REPORT_REL), JSON.stringify(result, null, 2) + '\n');
    log(`[bump-drill] 报告已写入 ${REPORT_REL}（真仓唯一被本工具触碰的文件）`);
}
if (verdict === 'tool-invalid') {
    console.error('[bump-drill] ✗ **工具自身失效**：注入的等值形锚没被抓住 ⇒ 本工具的「零红」'
        + '与「扫描面写错」不可分，本次读数一律不可用（exit 2）。');
    process.exit(2);
}
if (verdict === 'baseline-dirty') {
    console.error('[bump-drill] ✗ 正控制失败：未抬版的真仓上版本锚组已有红 ⇒ 本次**拒判**'
        + '（「零红」失去了参照，差值算不出来）。先把那几件红修掉再跑演练。');
} else if (verdict === 'anchor-ok') {
    log('[bump-drill] ✓ 版本锚组零红（基线零红 + 抬版后零红）—— 抬版不会因版本锚新增红');
    log('[bump-drill] ★ 但「零红」的适用范围到此为止：下限形锚（`version >= X`）与「全库无锚」'
        + '在抬版这件事上**读数相同**，不能凭本报告说「全库没有锚」。见 probes.floor。');
} else {
    log('[bump-drill] ✗ 版本锚组因抬版新增红 —— 这就是 R-O2 要消的那一族（判据把时点快照当永久约束）');
}
process.exit(verdict === 'anchor-ok' ? 0 : verdict === 'anchor-regression' ? 1 : 2);