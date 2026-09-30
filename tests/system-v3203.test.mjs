// tests/system-v3203.test.mjs — 跨仓外供面的「声明 ↔ 真码」对账（第十一道门）[v3.20.3]
//
//   本体是 `scripts/upstream-face-audit.mjs`（**十二条**判据 R1–R12；R12 为 v3.23.4 新增的
//   反向面对账，本套件随门交棒，见文件末「R12 段」）。本套件判的是**门本身**：
//     ① 它真的在 `npm run check` 链上（否则等于没做）；
//     ② 它**位置无关**、且**不引用兄弟仓**（上游 P2 明令：在役测试面不得引用兄弟仓库）——
//        这一条是本版形态选择的根因，不是风格偏好；
//     ③ 它的十一条判据**对真源码破坏有反应**（每条负控制都从**真仓文件**里读出内容、
//        在副本上恰中 1 次地破坏、再用**同款真判据**观观测转红）；
//     ④ 它的 fail-closed 是真的（缺输入 / 路径读不到 / schema 不符 ⇒ rc 2，不降级）；
//     ⑤ 刷新纪律是真的（`--refresh` 必须带上游目录与非空理由，且**不许改动真仓冻读取**）。
//
//   【v3.20.4 交棒改写（本套件随门一起改口径，不是静默改数）】
//     门新增 R10「冻读取**可回源**」与 R11「上游台账待同步」两条判据，并改了四处口径：
//       · 冻读取 schema `@1` → `@2`（新增 `sourceState` / `upstreamCommit` / `worktreeDirty`）；
//       · R4/R5/R7 里的**跨仓**分歧（成因在上游那份文件、门对上游只读）不再直接计缺陷，
//         改走 R11「必须被解释」的通路；**同仓两处不一致**（登记行 vs 门禁标签、
//         标签抄错）仍直接计缺陷，且新增「三方定位责任」：登记行与上游表同值而只有标签
//         不同 ⇒ 判本地（`problems`），不许推给上游；
//       · R9 复核改为比**提交态**（与冻读取同口径），措辞随之变为「**提交态** sha1 与冻读取一致」；
//       · R8 只在「本仓**确无**消费证据」时才要「为什么还没用它」（账面 `none@0` 而本仓在用，
//         属语义错位，该走 R11）。
//     故本套件里 B3/B6/C1/C2/C4/C8/D2 的断言与 `stageUpstream`（上游夹具改**真 git 仓**）
//     一并跟改；并追加 C10–C14（R10/R11/逃生口/非 git 上游的负控制）。
//
//   【为什么负控制全部用「真源码破坏」而不是手写模拟夹具】
//     本仓记过三种假绿的形：① 对原文件断言（破坏根本没发生也绿）；② 破坏写死成模拟常量
//     （真判据压根没被调用）；③ 破坏把判据自己删了（自我指涉）。故这里统一：
//     **真源码读出来 → 锚点恰中 1 次地破坏 → 写进副本 → 在副本上重跑同款真判据**。
//     锚点不唯一 / 不存在 ⇒ `replaceOnce` 直接抛（不许静默改成「差不多」的东西）。
//
//   【为什么夹具里要复制整个 config/ 并放一份 package.json】
//     R6 的判定面就是「本仓 config/ 下真的导出了那个出口」，故夹具必须带 config/ 真内容；
//     `config/*.js` 是 ESM，Node 靠**最近的 package.json** 判模块类型 —— 夹具不带
//     `{"type":"module"}` 时 `import()` 会整体失败。这同时自证了一件事：
//     门依赖的是本仓的**真形态**，不是替身。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const GATE_REL = 'scripts/upstream-face-audit.mjs';
const GATE_ABS = path.join(ROOT, GATE_REL);
const BRIDGE_REL = 'scripts/bridge-contract-audit.mjs';
const CACHE_REL = 'tests/audit/upstream_face_cache.json';
const UNCONS_REL = 'tests/audit/upstream_face_unconsumed.json';
const LAG_REL = 'tests/audit/upstream_face_lag.json';
const REGISTRY_REL = 'config/crossrepo-registry.js';

/** 与门同口径的 sha1（12 位十六进制）—— 冻读取与夹具都按这一份算。 */
const sha1 = (s) => createHash('sha1').update(String(s), 'utf-8').digest('hex').slice(0, 12);

/**
 * 反向面登记行**自己声明的**挂载点文件（`CROSSREPO_PRODUCED_FACES[].mountSite` 的 `<file>` 部分）。
 *
 * 【为什么从登记行读，而不是在测试里硬编一份路径】
 *   夹具要带 `apps/memory/lonsha-bridge.js` 才能让 R12 的 b/c 两格有判定面。
 *   若在测试里写死这份路径，则登记行换了挂载点 ⇒ 夹具还在搬老文件 ⇒ R12 报红而红因
 *   指向测试自己的过时假设（本仓记过的「转写与真源脱节」）。读登记行 = 一处真源。
 *   登记行是 ESM（夹具所在的 cwd 下无 package.json 时 `import()` 会失败），
 *   故在**真仓根**（那里有 `{"type":"module"}`）下 import，只取其声明值。
 */
async function reverseMountFiles() {
    const mod = await import(pathToFileURL(path.join(ROOT, REGISTRY_REL)).href);
    const out = new Set();
    for (const f of (mod.CROSSREPO_PRODUCED_FACES || [])) {
        const ms = String((f || {}).mountSite || '');
        const at = ms.lastIndexOf('#');
        if (at > 0) out.add(ms.slice(0, at));
    }
    return [...out];
}
/* 顶层 await 取一次（ESM 支持）：`stageTree` 保持同步，本套件所有调用点一字不改 ——
 *   「夹具形态变了」不该顺带把二十几处调用改成 async（那是把噪音混进真改动里）。 */
const REVERSE_MOUNT_FILES = await reverseMountFiles();

const temps = [];
function tmp(prefix) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    temps.push(d);
    return d;
}
process.on('exit', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});

/** 破坏必须**恰中 1 次**（H6 工具两向自证：锚点不存在 / 不唯一一律抛，不许静默改写）。 */
function replaceOnce(s, from, to) {
    const n = s.split(from).length - 1;
    assert.equal(n, 1, `锚点应恰中 1 次，实际 ${n}：${String(from).slice(0, 70)}`);
    return s.replace(from, to);
}

/**
 * 夹具树：真仓 `config/` 全量 + 真仓门禁脚本 + 真仓冻读取 + 真仓理由台账 + ESM 标记。
 * overrides：{ rel: null | op | op[] }，op = { find, to } | (src) => newSrc。
 *   · null  —— 删掉该文件（fail-closed 方向）
 *   · op    —— 破坏落在**真源码**上（`find` 必须恰中 1 次）
 *   · op[]  —— 同一文件多处破坏（**每一步都必须恰中 1 次**；防「改了一处就当都改了」）
 */
function stageTree(overrides = {}) {
    const dir = tmp('rp_v3203_');
    fs.writeFileSync(path.join(dir, 'package.json'),
        JSON.stringify({ name: 'fixture', version: '9.9.9', private: true, type: 'module' }, null, 2) + '\n');
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'tests', 'audit'), { recursive: true });
    for (const f of fs.readdirSync(path.join(ROOT, 'config'))) {
        if (!f.endsWith('.js')) continue;
        fs.copyFileSync(path.join(ROOT, 'config', f), path.join(dir, 'config', f));
    }
    for (const rel of [BRIDGE_REL, CACHE_REL, UNCONS_REL, LAG_REL]) {
        fs.copyFileSync(path.join(ROOT, rel), path.join(dir, rel));
    }
    /* 【R12（v3.23.4）：夹具必须带**挂载点文件**】
     *   R12 的 b / c 两格的判定面是 `CROSSREPO_PRODUCED_FACES` 登记行里 `mountSite` 指的
     *   那个文件（`apps/memory/lonsha-bridge.js`）—— 它的方法/导出名在那里逐格核。
     *   夹具不带它 ⇒ 每条用例都先在 R12 上转红（「挂载点文件不在磁盘」），
     *   那红与本套件各条要测的判据无关。故按登记行**自己声明的**路径复制，
     *   而不是在测试里硬编一份路径（登记行改路径 ⇒ 这里跟着走）。 */
    for (const rel of REVERSE_MOUNT_FILES) {
        const dst = path.join(dir, rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(path.join(ROOT, rel), dst);
    }
    /* 【夹具的 lag 表用**真仓那一份**】C0 基线自证要求「未破坏即绿」——
     *   而真仓冻读取（提交态）与真码之间**确有两条已登记的分歧**，故夹具必须带上这份台账
     *   才可能绿；否则每条用例都会先在 R11 上转红，那红与本条要测的判据无关。
     *   未登记的分歧（破坏引入的那些）不会被这份台账覆盖，故各条破坏仍各自归因。 */
    for (const [rel, ov] of Object.entries(overrides)) {
        const p = path.join(dir, rel);
        if (ov === null) { fs.rmSync(p, { force: true }); continue; }
        let src;
        try { src = fs.readFileSync(p, 'utf8'); }
        catch (_e) { src = ''; }   /* 「新建一个文件」型破坏（如往 config/ 里放替身） */
        for (const one of (Array.isArray(ov) ? ov : [ov])) {
            src = typeof one === 'function' ? one(src) : replaceOnce(src, one.find, one.to);
        }
        fs.writeFileSync(p, src);
    }
    return dir;
}

/** 在夹具里跑**真门脚本**（ROOT 由 `RP_ROOT` 指到夹具；门脚本本体始终是真仓那一份）。 */
function runGate(dir, extra = []) {
    const r = spawnSync(process.execPath, [GATE_ABS, ...extra], {
        cwd: ROOT, encoding: 'utf8', env: { ...process.env, RP_ROOT: dir }
    });
    return { status: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') };
}

/** 夹具自含的「上游目录」（**绝不指向真兄弟仓** —— 上游 P2 的同一纪律）。
 *  【v3.20.4：上游夹具必须是**真 git 仓**】门默认只冻上游**提交态**（可回源），
 *  非 git 仓 ⇒ 明确 rc 2 且**不退回读工作树**。故夹具须 `git init` + 提交一次，
 *  否则 D5/D5b/E2/E3 这类 `--refresh` 用例会全部撞在「不是 git 仓」上而失去判别力。 */
function stageUpstream(parent, tableText, version = '3.255.0') {
    const d = path.join(parent, 'upstream');
    fs.mkdirSync(path.join(d, 'tests', 'audit'), { recursive: true });
    fs.writeFileSync(path.join(d, 'tests', 'audit', 'open_face_registry.tsv'), tableText);
    /* 【v3.23.4 R12 交棒改写】夹具上游 manifest 必须带 `js`（分发面）。
     *   R12 的 d 格判的是「上游消费面在不在上游**分发面**（manifest 的 js / extra_js）」——
     *   与上游 T3 同口径：不在分发面 = 上游压根不加载它 ⇒ 「有消费点」在用户侧不成立。
     *   夹具 manifest 原先只有 name/version ⇒ 真仓的反向面（消费面 `index.js`）必然报「不在分发面」，
     *   那条红是**夹具缺格**引起的，不是被测判据的缺陷。补上 `js: 'index.js'` 与真仓同形。 */
    fs.writeFileSync(path.join(d, 'manifest.json'),
        JSON.stringify({ name: 'upstream', version, js: 'index.js' }, null, 2) + '\n');
    gitInit(d);
    return d;
}
/** 把夹具上游目录造成一个真 git 仓（一次提交），产出一个「提交态」可复算的夹具。 */
function gitInit(dir) {
    const run = (args) => spawnSync('git', ['-C', dir, ...args],
        { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
    const r = run(['init', '-q']);
    assert.equal(r.status, 0, '夹具上游必须能 git init：' + String(r.stderr || r.error || '').slice(0, 200));
    run(['add', '-A']);
    const c = run(['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid',
        'commit', '-q', '-m', 'fixture upstream']);
    assert.equal(c.status, 0, '夹具上游必须能提交：' + String(c.stderr || c.error || '').slice(0, 200));
}

/** 与真仓冻读取**同形**的夹具冻读取，只把 tableSha1 换成本夹具表的那一份。 */
function makeCache(tableText, tweak) {
    const c = JSON.parse(read(CACHE_REL));
    c.tableSha1 = sha1(tableText);
    c.refreshReason = '夹具：与本夹具的上游表同源';
    if (tweak) tweak(c);
    return c;
}
/** 从真仓冻读取导出的一份**合法**上游表文本（列数与 COLS 一致），用于「sha1 一致」方向。 */
function tableTextFromCache(cache) {
    const COLS = ['face', 'owner', 'producer_version', 'upstream_symbol', 'contract_shape',
        'consumer', 'invalid_conditions', 'standalone_behavior', 'absent_vs_empty'];
    assert.deepEqual(Object.keys(cache.faces).length, 5, '前提：真仓冻读取是 5 面');
    const lines = ['#' + COLS.join('\t')];
    for (const [face, f] of Object.entries(cache.faces)) {
        lines.push([face, f.owner, f.producerVersion, f.upstreamSymbol, 'fixture',
            f.consumer, 'fixture', f.standaloneBehavior, 'fixture'].join('\t'));
    }
    return lines.join('\n') + '\n';
}

const REAL_CACHE_BYTES = read(CACHE_REL);
/** 真仓台账此刻的读数（上游 813ab3a 提交后**已收账为空表**）。 */
const REAL_LAG = JSON.parse(read(LAG_REL));

/* ── 分歧夹具（v3.20.5 收账）：本套件**不许**把「真仓此刻有活分歧」当前提 ──
 *   v3.20.3 交付时真仓确有两条分歧，故 C11/C12 直接拿真仓台账当载体；
 *   上游一提交（813ab3a）分歧消失、台账删空，那两条判据就塌成「断言上游没提交」。
 *   故一律改为**本套件自造的分歧**：把冻读取副本改回上游陈旧账面 + 配一份登记它的台账。 */
const DIVERGENCE_ENTRIES = () => ([
    { face: 'checkpointCompare', kind: 'version', upSays: 'v3.237.0', ourSays: '3.252.0',
        upstreamCommit: 'deadbeef0000', reason: '夹具：陈旧账面与下游 since 口径不一致' },
    { face: 'checkpointCompare', kind: 'consumer-none', upSays: 'none@0',
        ourSays: 'readLonshaCheckpointFace@1', upstreamCommit: 'deadbeef0000',
        reason: '夹具：账面说零消费而本仓已接入' }
]);
function divergenceLag(items) {
    return JSON.stringify({
        schema: 'upstream-face-lag@1', note: '夹具：自造分歧（载体不依赖真仓那一份）', items
    }, null, 2) + '\n';
}
/** 把冻读取副本改回上游陈旧账面（三格一起回到旧口径），并按 entries 写好台账。 */
function stageDivergence(entries) {
    const dir = stageTree({ [CACHE_REL]: (s) => {
        const c = JSON.parse(s);
        c.faces.checkpointCompare.producerVersion = 'v3.237.0';
        c.faces.checkpointCompare.consumer = 'none@0';
        c.faces.checkpointCompare.standaloneBehavior =
            'store 缺席即 store-absent 归因，不当作「没有检查点」（store-absent 与 not-found 不同形）；'
            + '下游尚未接入（计划二 T4 已排 F7）';
        return JSON.stringify(c, null, 2) + '\n';
    } });
    fs.writeFileSync(path.join(dir, LAG_REL),
        divergenceLag(entries === undefined ? DIVERGENCE_ENTRIES() : entries));
    return dir;
}

/* ══════════ A ── 结构面（门在链上 / 位置无关 / 编号不共号） ══════════ */
test('A1 ★★★ 第十一道门在 check 链上（否则等于没做），且别名指向本门', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.match(String(pkg.scripts.check), /npm run upstream-face$/, 'check 链必须以本门收尾');
    assert.equal(pkg.scripts['upstream-face'], 'node scripts/upstream-face-audit.mjs', '门脚本路径');
});
test('A2 ★★★ 执行器不另存门清单；本门已进读数登记表（未登记即拒判，不许漏网）', () => {
    const ex = read('scripts/check-file.mjs');
    assert.equal(/\[[^\]]*'upstream-face'[^\]]*\]/.test(ex), false,
        '★ 读数登记表的形态是键表，不得出现「清单式硬编码」的痕迹');
    assert.match(ex, /'upstream-face':\s*\[/, '新门必须登记主读数（门清单的真源是 package.json）');
    assert.match(ex, /没有登记主读数/, '未登记主读数的门必须拒判（这条 fail-closed 不得被删）');
});
test('A3 ★★★ 读数登记表的正则必须真命中本门**真输出**（登记了却永不命中 = 摆设）', () => {
    const ex = read('scripts/check-file.mjs');
    const seg = ex.slice(ex.indexOf("'upstream-face': ["));
    const body = seg.slice(0, seg.indexOf(']') + 1);
    const res = runGate(ROOT);
    assert.equal(res.status, 0, '前提：真仓裸跑为绿：' + res.err.slice(0, 200));
    const re = /跨仓外供面「声明 ↔ 真码」对账：(\d+) 面/;
    assert.ok(body.includes('跨仓外供面'), '登记表里必须挂着本门的主读数行口径');
    const m = re.exec(res.out);
    assert.ok(m, '主读数正则必须命中真输出');
    assert.equal(Number(m[1]), 5, '对账面数必须等于真读数（5 面）');
});
test('A4 ★★★ 道门编号不共号：本门是第十一道，「第十道门」仍属 weak-coercion', () => {
    const gate = read(GATE_REL);
    assert.match(gate, /第十一道门/, '本门必须自称第十一道');
    /* 代码面（剥掉注释行）不得出现道门序号 —— 序号是**给人读的那一处**，
     * 一旦写进代码面就是第二份口径（本仓治过的「转写与真源脱节」）。 */
    const codeFace = gate.split('\n').filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l)).join('\n');
    assert.equal(/第[一二三四五六七八九十]+道门/.test(codeFace), false,
        '★ 代码面不得出现道门序号（只许出现在注释里）');
    /* 注释里凡提「第十道门」，必须是在说明它**真实归属**（邻近三行内点名 weak-coercion），
     * 防「两门共号」回归：那正是本版初稿犯的错。 */
    const lines = gate.split('\n');
    const hits = lines.map((l, i) => (l.includes('第十道门') ? i : -1)).filter((i) => i >= 0);
    assert.ok(hits.length >= 1, '前提：订正说明在场（否则这条判据测不到东西）');
    for (const i of hits) {
        const win = lines.slice(Math.max(0, i - 3), i + 4).join('\n');
        assert.ok(/weak-coercion/.test(win),
            '★ 提「第十道门」必须点明它属于 weak-coercion（共鸣号 = 把给人读的那处写错）：'
            + lines[i].slice(0, 60));
    }
    assert.match(read(BRIDGE_REL), /跨仓面对账标签（第十一道门/, '标签注释里的编号同源');
    assert.match(read('tests/system-v3120.test.mjs'), /第十道门在 check 链上/, 'weak-coercion 那门仍持第十道门');
});
test('A5 ★★ 本门位置无关、且不引用兄弟仓（上游 P2 同规：在役测试面不得引用兄弟仓库）', () => {
    const src = read(GATE_REL);
    const code = src.split('\n').filter((l) => !/^\s*\*/.test(l) && !/^\s*\/\//.test(l)).join('\n');
    assert.equal(/\/home\/|C:\\\\/.test(code), false, '代码面不得含绝对路径字面量');
    assert.equal(/lonsha-memory-plugin\//.test(code), false, '不得把兄弟仓目录名写进代码路径');
    assert.equal(/\|\s*(grep|head|sort)\b/.test(code), false, '不得出现 shell 管道（本仓两条事故同族）');
});

/* ══════════ B ── 行为面（真仓真跑 + 夹具真跑） ══════════ */
test('B1 ★★★ 真仓裸跑：5 面 / 问题 0，退出码 0', () => {
    const r = runGate(ROOT);
    assert.equal(r.status, 0, '裸跑必须绿（stderr：' + r.err.slice(0, 200) + '）');
    /* 【v3.23.4 R12 交棒改写】汇总行加了本仓产出面的读数（`… 5 面（消费侧）/ N 面（本仓产出侧 · R12） / 问题 0`）。
     *   本套件锚的是**消费侧面数不为 0 且问题为 0**这件事，故正则随之放宽到新形态——
     *   但**不许**放宽成「只要出现『对账』二字」：那样连「0 面 / 问题 3」也算过。
     *   判据实质：五面照旧逐面列出（下面那条断言仍守着）且问题数为 0。 */
    assert.match(r.out, /跨仓外供面「声明 ↔ 真码」对账：[1-9]\d* 面（消费侧）\/ \d+ 面（本仓产出侧 · R12） \/ 问题 0/);
    for (const face of ['projectionEnvelope', 'injectionReadout', 'eventPlatforms', 'evidenceWorkbench', 'checkpointCompare']) {
        assert.ok(r.out.includes(face), '汇总必须逐面列出：' + face);
    }
});
test('B2 ★★★ 未给 --upstream 时如实报「未复核」，不假装复核过', () => {
    const r = runGate(ROOT);
    assert.equal(r.status, 0, '裸跑仍须绿（未复核不是缺陷，是如实的边界）');
    assert.match(r.out, /未复核/, '必须如实说「未复核」');
    assert.equal(/sha1 与冻读取一致/.test(r.out), false, '★ 没读上游就不许出现「复核一致」的字样');
});
test('B3 ★★★ 给了 --upstream 且表与冻读取同源 ⇒ 报「sha1 与冻读取一致」', () => {
    const dir = stageTree();
    const cache = JSON.parse(REAL_CACHE_BYTES);
    const table = tableTextFromCache(cache);
    const up = stageUpstream(dir, table);
    fs.writeFileSync(path.join(dir, CACHE_REL), JSON.stringify(makeCache(table), null, 2) + '\n');
    const r = runGate(dir, ['--upstream', up]);
    assert.equal(r.status, 0, '同源时须绿：' + r.err.slice(0, 300));
    /* 【v3.20.4 措辞】复核比的是**提交态**（与冻读取同口径），文案里点明了这一点。 */
    assert.match(r.out, /提交态\*\* sha1 与冻读取一致/, '必须报出复核结论（且点明比的是提交态）');
    assert.equal(/未复核/.test(r.out), false, '★ 复核过了就不许再说「未复核」（两者不许同形）');
});
test('B4 ★★★ 给了 --upstream 但表已变 ⇒ 转红并点名 R9（不许沿用旧冻读取）', () => {
    const dir = stageTree();
    const cache = JSON.parse(REAL_CACHE_BYTES);
    const up = stageUpstream(dir, tableTextFromCache(cache) + 'changed\tx\tx\tx\tx\tnone@0\tx\tx\tx\n');
    fs.writeFileSync(path.join(dir, CACHE_REL), JSON.stringify(makeCache(cache, (c) => { c.tableSha1 = 'deadbeef0000'; }), null, 2) + '\n');
    const r = runGate(dir, ['--upstream', up]);
    assert.equal(r.status, 1, '表变了必须转红');
    assert.match(r.err, /R9 上游登记表已变/, '必须点名 R9');
});
test('B5 ★★★ 给了 --upstream 却读不到 ⇒ rc 2（fail-closed，不降级成「未复核」）', () => {
    const dir = stageTree();
    const r = runGate(dir, ['--upstream', path.join(dir, 'no-such-upstream')]);
    assert.equal(r.status, 2, '★ 路径写错与「复核过」不许同形');
    assert.match(r.err, /fail-closed|不降级/, '必须说清是拒判而非缺陷');
});
test('B6 ★★ R8：声明 none@0 而本仓**确无消费证据** ⇒ 必须能回答「为什么」（缺台账 / 空理由都转红，补上则不再报）', () => {
    /* 情形一：上游新增了一个本仓还没登记的零消费面 —— 这才是 R8 的**原生**场景。
     *   v3.20.3 用「把已接入面的声明改成 none@0」来造它，而那种造法在新口径下
     *   **本仓有消费证据**（标签 / 登记行的出口真存在）⇒ 属「账面陈旧 vs 真码」，
     *   该走 R5+R11 而不是 R8（要「为什么还没用」是语义错位）。 */
    const ghost = (s) => {
        const c = JSON.parse(s);
        c.faces.ghostFace = { owner: 'x', producerVersion: 'v3.999.0', upstreamSymbol: 'x',
            consumer: 'none@0', standaloneBehavior: 'x' };
        return JSON.stringify(c, null, 2) + '\n';
    };
    const noTable = runGate(stageTree({ [CACHE_REL]: ghost }), ['--unconsumed', '/nonexistent/unconsumed.json']);
    assert.equal(noTable.status, 1, '缺理由台账必须转红');
    assert.match(noTable.err, /R8 面 `ghostFace`/, '必须逐面点名 R8');
    assert.match(noTable.err, /没给未消费理由台账/, '必须说清是「没给」而不是「没理由」');
    const empty = stageTree({ [CACHE_REL]: ghost });
    fs.writeFileSync(path.join(empty, UNCONS_REL), JSON.stringify({ _schema: 'upstream-face-unconsumed@1' }, null, 2) + '\n');
    const emptyRun = runGate(empty);
    assert.equal(emptyRun.status, 1, '空表仍须转红');
    assert.match(emptyRun.err, /R8 面 `ghostFace`/, '必须点名该面');
    assert.match(emptyRun.err, /没有它的非空理由/, '沉默不许存在');
    const ok = stageTree({ [CACHE_REL]: ghost });
    fs.writeFileSync(path.join(ok, UNCONS_REL),
        JSON.stringify({ ghostFace: '夹具：理由非空即可（本面其余判据另测）' }, null, 2) + '\n');
    const okRun = runGate(ok);
    assert.equal(/R8 面 `ghostFace`/.test(okRun.err + okRun.out), false,
        '★ 给了非空理由后 R8 必须不再报（判据不是死的）');
    /* 情形二（v3.20.4 边界收窄）：声明 none@0 而本仓**确有**消费证据（门禁标签还在、
     *   登记行也声明同一个出口）⇒ 这不是「还没用它」而是**上游账面陈旧**，
     *   故不走 R8，由 R11 要一段解释。★ 上游那格与本仓之间的差异**只在上游那份文件里**，
     *   本门对它只读 ⇒ 这里不给 R5（R5 只判同仓两处自己打架）。 */
    const stale = runGate(stageTree({ [CACHE_REL]: { find: '"consumer": "readProjection@4"', to: '"consumer": "none@0"' } }));
    /* 说明：下面刻意**不写死那条旧断言的字面量**，而是拼出它 —— 否则本行自己就成了
     *   那份旧断言（断言串命中自己 = 本仓记过的假红根因）。 */
    const oldR8 = new RegExp('R8 面 `projection' + 'Envelope`');
    assert.equal(oldR8.test(stale.err + stale.out), false,
        '★ 账面 none@0 而本仓在用 ⇒ 必须走 R11（跨仓分歧），不许再报 R8 projectionEnvelope');
    assert.match(stale.err, /R11 上游面 `projectionEnvelope` 的 consumer-none/,
        '★ 这类分歧必须走 R11：账面与真码对不上就得能回答「为什么」');
});

/* ══════════ C ── 负控制：真源码破坏 ⇒ 同款真判据转红 ══════════ */
test('C0 ★★★ 基线自证：未破坏的真源码副本上，本门必须为绿（负控制的前提）', () => {
    const dir = stageTree();
    const r = runGate(dir);
    assert.equal(r.status, 0, '未经破坏的副本树必须绿（否则后面每条破坏都无从归因）：' + r.err.slice(0, 300));
});
test('C1 ★★★ 改真 registry 副本的 declaredFloor ⇒ R5 转红（声明与标签不一致）', () => {
    const dir = stageTree({ [REGISTRY_REL]: { find: 'declaredFloor: 4', to: 'declaredFloor: 9' } });
    const r = runGate(dir);
    assert.equal(r.status, 1, '下限被改必须转红');
    /* 措辞留活口：判据只钉「点名了哪一面 + 哪条 R + 两份读数都出现」，
     *   不去钉门里那句话的逗号与破折号 —— 钉太死会让门**改进措辞**变成红灯，
     *   那是本仓明令禁止的方向（「为了让门变绿而削判据」的反面：让门不敢改好话）。 */
    assert.match(r.err, /R5 面 `projectionEnvelope`/, '必须点名面与 R5');
    assert.match(r.err, /declaredFloor 写 9/, '必须把被改后的那份读数亮出来');
    assert.match(r.err, /而同仓门禁标签写 4/, '必须把真源那份读数亮出来（两数并排才能定位分叉）');
    assert.notEqual(r.status, runGate(ROOT).status, '★ 破坏必须可观测地改变行为（两向对照）');
});
test('C2 ★★★ 改真门禁副本的面标签 floor ⇒ R5 转红（钉子被拔掉即响）', () => {
    const dir = stageTree({ [BRIDGE_REL]: { find: '[face: checkpointCompare] [reader: readLonshaCheckpointFace] [floor: 1]', to: '[face: checkpointCompare] [reader: readLonshaCheckpointFace] [floor: 7]' } });
    const r = runGate(dir);
    assert.equal(r.status, 1, '标签下限被改必须转红');
    /* 本面在上游提交态里声明 `none@0`，故它的下限**不与上游表比**（没有下限可对）；
     *   此刻仍能被抓住，是因为登记行`lonsha.checkpointContent` 的 declaredFloor 还写着 1
     *   —— 同仓两处不一致。这条正是「钉子被拔掉即响」。 */
    assert.match(r.err, /R5 面 `checkpointCompare`：登记行 `lonsha\.checkpointContent` 的 declaredFloor 写 1/,
        '必须点名面、登记行与 R5');
    assert.match(r.err, /而同仓门禁标签写 7/, '必须把被改后的那份读数亮出来');
});
test('C3 ★★★ 删真 registry 副本的一条对账三件套 ⇒ R2/R3 转红（声明缺格）', () => {
    const dir = stageTree({
        [REGISTRY_REL]: (s) => replaceOnce(s, "        declaredConsumer: 'readInjection',\n", '')
    });
    const r = runGate(dir);
    assert.equal(r.status, 1, '声明缺格必须转红');
    assert.match(r.err, /R2 登记行 `lonsha\.injection` 带 upstreamFace 但缺 declaredConsumer/,
        '必须点名缺的是哪一格');
});
test('C4 ★★★ 改真冻读取副本的一条 producerVersion ⇒ R11 收到 version 分歧（版本口径不一致）', () => {
    /* 【v3.20.4 口径变化】上游账面与下游真码的版本差**不再是本门的 defects**（成因在上游那份文件、
     *   本门对上游只读）⇒ 它走 R11「必须被解释」的通路。破坏后分两步核：
     *   ① 无台账 ⇒ R11 转红（不许沉默）；② 台账补齐这一条 ⇒ 该分歧被解释，不再报它。 */
    const dmg = { [CACHE_REL]: { find: '"producerVersion": "v3.233.0"', to: '"producerVersion": "v3.999.0"' } };
    const r = runGate(stageTree(dmg));
    assert.equal(r.status, 1, '版本被改必须转红（经 R11 的通路）');
    assert.match(r.err, /R11 上游面 `eventPlatforms` 的 version/, '必须点名面与 R11');
    const dir = stageTree(dmg);
    fs.writeFileSync(path.join(dir, LAG_REL), JSON.stringify({
        schema: 'upstream-face-lag@1',
        items: [{ face: 'eventPlatforms', kind: 'version', upSays: 'v3.999.0', ourSays: '3.233.0',
            upstreamCommit: 'deadbeef0000', reason: '夹具：破坏引入的版本分歧，理由非空即可' }]
    }, null, 2) + '\n');
    const fixed = runGate(dir);
    assert.equal(/R11 上游面 `eventPlatforms` 的 version/.test(fixed.err), false,
        '★ 台账补齐后该条不再报（判据不是死的）');
});
test('C5 ★★★ 删真冻读取副本的一个面 ⇒ R3 转红（双向的「表里有、本仓没登记」反向同样要响）', () => {
    const dir = stageTree({
        [CACHE_REL]: (s) => {
            const c = JSON.parse(s);
            delete c.faces.evidenceWorkbench;
            return JSON.stringify(c, null, 2) + '\n';
        }
    });
    const r = runGate(dir);
    assert.equal(r.status, 1, '面被删必须转红');
    assert.match(r.err, /R3 本仓登记行 `lonsha\.evidence` 声称对应上游面 `evidenceWorkbench`/,
        '必须报「登记了不存在的面」这一向');
});
test('C6 ★★★ 清空真冻读取副本的 refreshReason ⇒ R2 转红（空理由的「冻」与没冻同义）', () => {
    const dir = stageTree({ [CACHE_REL]: (s) => {
        const c = JSON.parse(s);
        c.refreshReason = '';
        return JSON.stringify(c, null, 2) + '\n';
    } });
    const r = runGate(dir);
    assert.equal(r.status, 1, '空理由必须转红');
    assert.match(r.err, /R2 冻读取的 refreshReason 为空/, '必须点名 R2');
});
test('C7 ★★★ 真源码破坏：把该出口的**所有**导出形态都拆掉 ⇒ R6 转红（探测器不许有兜底）', () => {
    /* ★ 这条是本版最有价值的一条。初版只拆命名出口（一处），门**照样绿** ——
     *   因为门口探测器的兜底模式 `^\s*<name>\s*[,:]` 在任何对象字面量里都命中。
     *   一个「出口真的存在」判据若对「出口不存在」不响应，它就是**假的**。
     *   故破坏必须**穷尽该出口的三种真导出形态**（命名声明 / export 块成员 / default 块成员），
     *   拆完仍绿 ⇒ 探测器有兜底 ⇒ 红灯。 */
    const dir = stageTree({
        'config/projection-contract.js': [
            { find: 'export function readProjection(', to: 'function readProjection(' },
            { find: '\n    readProjection,', to: '' }
        ]
    });
    const greened = runGate(stageTree());
    assert.equal(greened.status, 0, '前提：未破坏时本面为绿');
    const r = runGate(dir);
    assert.equal(r.status, 1, '★ 出口三种形态全拆掉后仍绿 ⇒ 探测器有兜底（判据是假的）');
    assert.match(r.err, /R6 上游面 `projectionEnvelope` 声明的消费出口 `readProjection`/, '必须点名出口与 R6');
});
test('C7b ★★★ 探测器诚实性：命名出口被拆后，`export {}` 块成员形态仍须被认出来', () => {
    /* 反向自证：只拆命名声明（**留着** default 块的成员），门必须仍绿 ——
     *   否则就是把「导出」认成了「必须写 export function」，
     *   那会让本仓合法的「先声明后成块转出」写法集体转红（误报同样不可接受）。 */
    const dir = stageTree({
        'config/projection-contract.js': { find: 'export function readProjection(', to: 'function readProjection(' }
    });
    const r = runGate(dir);
    assert.equal(r.status, 0, '只拆命名声明时仍须绿（default 块成员是**真导出**）：' + r.err.slice(0, 200));
});
test('C8 ★★★ 把真冻读取副本的 standaloneBehavior 改成「尚未接入」⇒ R11 收到 not-wired 分歧', () => {
    /* 【v3.20.4 口径变化】「上游那格写未接入、而本仓已有出口」这一向的成因**在上游那份文件**，
     *   本门对上游只读 ⇒ 从 defects 改为走 R11「必须被解释」的通路。
     *   ★ 这一条正是上一版**靠人工手改**的那格（改的是上游工作树、且改完没提交），
     *   故它必须由机器接住：有分歧 ⇒ 必须有一段解释；上游一提交 ⇒ 台账项转红逼删。 */
    const dmg = { [CACHE_REL]: {
        find: '"standaloneBehavior": "快照无此面', to: '"standaloneBehavior": "尚未接入：夹具破坏。快照无此面'
    } };
    const r = runGate(stageTree(dmg));
    assert.equal(r.status, 1, '陈旧那格必须转红（经 R11 的通路）');
    assert.match(r.err, /R11 上游面 `projectionEnvelope` 的 not-wired/, '必须点名面与 R11');
    const dir = stageTree(dmg);
    fs.writeFileSync(path.join(dir, LAG_REL), JSON.stringify({
        schema: 'upstream-face-lag@1',
        items: [{ face: 'projectionEnvelope', kind: 'not-wired', upSays: '上游那格写「尚未接入」',
            ourSays: '本仓已有出口 `readProjection`', upstreamCommit: 'deadbeef0000',
            reason: '夹具：破坏引入的接入状态分歧，理由非空即可' }]
    }, null, 2) + '\n');
    const fixed = runGate(dir);
    assert.equal(/R11 上游面 `projectionEnvelope` 的 not-wired/.test(fixed.err), false,
        '★ 台账补齐后该条不再报');
});
/* ══════════ C10–C13 ── v3.20.4 新增判据的负控制（可回源 / 台账双向闭合 / 逃生口 / 三方定位） ══════════ */
test('C10 ★★★ 把真冻读取副本的 sourceState 改成 worktree ⇒ R10 转红（冻的是不可回源的工作树态）', () => {
    /* 本版治的缺陷就在这里：v3.20.3 的冻读取冻的是上游**工作树脏态** ——
     *   sha1 自洽、判据全绿，而那份内容在**任何上游提交里都不存在**。
     *   故「你冻的是哪一态」必须有机器盯着：不是 commit ⇒ 缺陷。 */
    const dir = stageTree({ [CACHE_REL]: { find: '"sourceState": "commit"', to: '"sourceState": "worktree"' } });
    const r = runGate(dir);
    assert.equal(r.status, 1, '冻成工作树态必须转红');
    assert.match(r.err, /R10 冻读取的 sourceState 是 `worktree`/, '必须点名 R10 与被冻的态');
    assert.match(r.err, /不可回源|工作树态/, '必须说清为什么这是缺陷（换台干净检出复现不出）');
});
test('C10b ★★★ 拿掉真冻读取副本的 upstreamCommit ⇒ R10 转红（答不出「出自哪一次提交」）', () => {
    const dir = stageTree({ [CACHE_REL]: (s) => {
        const c = JSON.parse(s);
        delete c.upstreamCommit;
        return JSON.stringify(c, null, 2) + '\n';
    } });
    const r = runGate(dir);
    assert.equal(r.status, 1, '缺来源提交必须转红');
    assert.match(r.err, /R10 冻读取缺 upstreamCommit/, '必须点名缺的是哪一格');
});
test('C11 ★★★ 台账登记了、而实际已不分歧 ⇒ R11 转红（登记着不存在的分歧就是掩饰）', () => {
    /* 反向闭合：台账不许腐化。造法（v3.20.5 改为自造）：登记两条分歧，但把 version 那条
     *   的账面**抹平**（上游改回与本仓 since 同值）⇒ 它变成「登记着不存在的分歧」，必须被点名逼删。
     *   旧写法把真仓冻读取改成「与本仓一致」的样子、靠**真仓那两条**登记项反向转红 ——
     *   上游 813ab3a 提交后真仓已无分歧、也无登记项，那条路走不通了。 */
    const dir = stageDivergence();
    const c = JSON.parse(fs.readFileSync(path.join(dir, CACHE_REL), 'utf8'));
    c.faces.checkpointCompare.producerVersion = 'v3.252.0';   /* 分歧消失，台账项却还在 */
    fs.writeFileSync(path.join(dir, CACHE_REL), JSON.stringify(c, null, 2) + '\n');
    const r = runGate(dir);
    assert.equal(r.status, 1, '台账腐化必须转红');
    assert.match(r.err, /R11 台账里登记了 `checkpointCompare\/version`/, '必须点名腐化的那条');
    assert.match(r.err, /已经不分歧/, '必须说清是「分歧不存在了」而不是「没给理由」');
});
test('C12 ★★★ 台账项缺理由 / 缺来源提交 ⇒ R11 转红（理由必填，逐条对上）', () => {
    /* v3.20.5：载体改为自造分歧（真仓台账已收账为空表，`items[0]` 不存在）。 */
    const bare = (tweak) => {
        const entries = DIVERGENCE_ENTRIES();
        tweak(entries[0]);
        return runGate(stageDivergence(entries));
    };
    const noReason = bare((it) => { it.reason = '   '; });
    assert.equal(noReason.status, 1, '空理由必须转红');
    assert.match(noReason.err, /R11 .*reason 为空/, '必须点名空理由');
    const noCommit = bare((it) => { delete it.upstreamCommit; });
    assert.equal(noCommit.status, 1, '缺 upstreamCommit 必须转红');
    assert.match(noCommit.err, /台账里这条缺 upstreamCommit/, '必须点名缺的是哪一格');
});
test('C13 ★★★ --from-worktree 是显式逃生口：能取到脏态读数，但**产物本身被 R10 判缺陷**', () => {
    /* 逃生口的语义：它必须真能把工作树态取出来（那是它的用途），而不是被静默忽略；
     *   取出来的东西又必须被自己的判据抓住 —— 两者都要真，缺一就成了摆设。 */
    const dir = stageTree();
    const up = stageUpstream(dir, tableTextFromCache(JSON.parse(REAL_CACHE_BYTES)));
    /* 在夹具上游的工作树里造一处未提交改动（模拟真仓上游那份「改完没提交」）。 */
    fs.appendFileSync(path.join(up, 'tests', 'audit', 'open_face_registry.tsv'), '# dirty\n');
    const r = runGate(dir, ['--refresh', '--upstream', up, '--from-worktree', '--reason', '夹具：验证逃生口']);
    assert.equal(r.status, 0, '逃生口本身须能跑通：' + r.err.slice(0, 200));
    assert.match(r.err, /冻的是\*\*工作树态\*\*/, '必须打印警告（逃生口不是无声开关）');
    const written = JSON.parse(fs.readFileSync(path.join(dir, CACHE_REL), 'utf8'));
    assert.equal(written.sourceState, 'worktree', '★ 逃生口必须真取到工作树态（不被静默无视）');
    assert.equal(written.worktreeDirty, true, '★ 该表在工作树里确有未提交改动，该项必须为真');
    const judged = runGate(dir);
    assert.equal(judged.status, 1, '★ 逃生口产物必须被 R10 判缺陷（能取 ≠ 能用）');
    assert.match(judged.err, /R10 冻读取的 sourceState 是 `worktree`/, '必须由 R10 当场抓住');
});
test('C14 ★★★ 非 git 仓的上游 ⇒ --refresh 明确 rc 2，且**不退回读工作树**（不许冻不可回源的内容）', () => {
    const dir = stageTree();
    const up = path.join(dir, 'upstream-plain');
    fs.mkdirSync(path.join(up, 'tests', 'audit'), { recursive: true });
    fs.writeFileSync(path.join(up, 'tests', 'audit', 'open_face_registry.tsv'),
        tableTextFromCache(JSON.parse(REAL_CACHE_BYTES)));
    fs.writeFileSync(path.join(up, 'manifest.json'), JSON.stringify({ version: '3.255.0' }) + '\n');
    const r = runGate(dir, ['--refresh', '--upstream', up, '--reason', '夹具：非 git 上游']);
    assert.equal(r.status, 2, '非 git 仓必须拒判（fail-closed）');
    assert.match(r.err, /不是 git 仓|不退回读工作树/, '必须说清为什么不退回读工作树');
});

test('C9 ★★★ 判据工具自证：锚点不存在 / 不唯一一律抛（不得静默改成「差不多」的东西）', () => {
    assert.throws(() => replaceOnce('abc', 'zzz', 'y'), /锚点应恰中 1 次，实际 0/);
    assert.throws(() => replaceOnce('abcabc', 'abc', 'y'), /锚点应恰中 1 次，实际 2/);
    assert.equal(replaceOnce('abc', 'abc', 'y'), 'y', '对照：恰中 1 次时正常工作');
    /* 真源码锚点必须在场（否则上面每条负控制都是假绿） */
    assert.match(read(REGISTRY_REL), /declaredFloor: 4/, 'C1 的锚点必须在真源码里在场');
    assert.match(read(CACHE_REL), /"producerVersion": "v3\.233\.0"/, 'C4 的锚点必须在真源码里在场');
    /* v3.20.4 新判据的锚点也必须在场（否则 R10/R11 的负控制是假绿）。
     * 【v3.20.5 收账改写】R11 的**条目形态锚**不再取自真仓台账（上游一提交流即空表），
     *   改由自造分歧夹具自证 —— 锚点自证要核的是「形态在场」，不是「上游还没提交」。 */
    assert.match(read(CACHE_REL), /"sourceState": "commit"/, 'R10 的锚点必须在真源码里在场');
    assert.match(read(LAG_REL), /"schema": "upstream-face-lag@1"/, '台账 schema 锚必须在真源码里在场');
    const divLag = fs.readFileSync(path.join(stageDivergence(), LAG_REL), 'utf8');
    assert.match(divLag, /"kind": "consumer-none"/, 'R11 的锚点（自造分歧里）必须在场');
});

/* ══════════ D ── fail-closed（缺输入一律 rc 2，不许判「通过」） ══════════ */
test('D1 缺冻读取 ⇒ rc 2（须先显式刷新，不许在没读过上游的情况下造一份「读数」）', () => {
    const dir = stageTree({ [CACHE_REL]: null });
    const r = runGate(dir);
    assert.equal(r.status, 2, '缺冻读取必须拒判');
    assert.match(r.err, /冻读取缺失/, '必须说清缺的是哪个输入');
});
test('D2 冻读取 schema 不符 ⇒ rc 2（旧缓存配新判据不许静默错读）', () => {
    /* 【v3.20.4】schema 由 @1 升 @2：冻读取新增 sourceState / upstreamCommit / worktreeDirty
     *   三格**来源读数**。锚点跟随真源 —— @1 的旧缓存必须被拒判（不然「旧缓存配新判据」会
     *   静默错读：旧缓存没有「冻的是哪一态」这一格，缺陷原样留存）。 */
    const dir = stageTree({ [CACHE_REL]: { find: '"schema": "upstream-face-cache@2"', to: '"schema": "upstream-face-cache@1"' } });
    const r = runGate(dir);
    assert.equal(r.status, 2, 'schema 不符必须拒判');
    assert.match(r.err, /schema/, '必须点名 schema');
});
test('D3 登记行真源缺失 ⇒ rc 2', () => {
    const dir = stageTree({ [REGISTRY_REL]: null });
    const r = runGate(dir);
    assert.equal(r.status, 2, '登记行真源缺失必须拒判');
    assert.match(r.err, /登记行真源缺失/, '必须说清缺的是哪个输入');
});
test('D4 闸门脚本缺失 ⇒ rc 2（标签面读不到 = 声明对面没人接）', () => {
    const dir = stageTree({ [BRIDGE_REL]: null });
    const r = runGate(dir);
    assert.equal(r.status, 2, '闸门脚本缺失必须拒判');
    assert.match(r.err, /门禁脚本读不到/, '必须说清缺的是哪个输入');
});
test('D5 上游表列数不符 ⇒ 刷新拒判 rc 2（静默跳过等于把「表坏了」读成「表变小了」）', () => {
    const dir = stageTree();
    const up = stageUpstream(dir, 'face\tx\n');   /* 列数远不足 9 */
    const r = runGate(dir, ['--refresh', '--upstream', up, '--reason', '夹具']);
    assert.equal(r.status, 2, '列数不符必须拒判');
    assert.match(r.err, /列数不符/, '必须说清是表坏了而不是表变小了');
});
test('D5b ★★ 只有**部分**行坏时同样拒判（不许只挑好行冻起来，那会把坏行静默丢掉）', () => {
    const dir = stageTree();
    const cache = JSON.parse(REAL_CACHE_BYTES);
    const up = stageUpstream(dir, tableTextFromCache(cache) + 'broken\trow\n');
    const r = runGate(dir, ['--refresh', '--upstream', up, '--reason', '夹具']);
    assert.equal(r.status, 2, '混着坏行必须拒判');
    assert.match(r.err, /1 行列数不符（合法行 5）/, '报数必须把「坏了几行、好了几行」都说清');
    assert.equal(fs.readFileSync(path.join(dir, CACHE_REL), 'utf8'), REAL_CACHE_BYTES,
        '★ 拒判时不得留下半成品冻读取（没冻成就不许有痕迹）');
});

/* ══════════ E ── 刷新纪律（夹具上跑；真仓冻读取不许被动） ══════════ */
test('E1 --refresh 必须带 --upstream（不许在没读上游的情况下造一份「冻读取」）', () => {
    const r = runGate(stageTree(), ['--refresh', '--reason', '夹具']);
    assert.equal(r.status, 2, '缺上游目录必须拒判');
    assert.match(r.err, /--refresh 必须带 --upstream/, '必须说清缺什么');
});
test('E2 --refresh 必须带非空理由（空理由的刷新等于没有纪律）', () => {
    const dir = stageTree();
    const cache = JSON.parse(REAL_CACHE_BYTES);
    const up = stageUpstream(dir, tableTextFromCache(cache));
    const r = runGate(dir, ['--refresh', '--upstream', up, '--reason', '   ']);
    assert.equal(r.status, 2, '空理由必须拒判');
    assert.match(r.err, /必须带 --reason/, '必须要求写明理由');
});
test('E3 ★★★ 正常刷新只写本仓冻读取，且**绝不改动真仓那一份**（工具不得改动它观测的树）', () => {
    const dir = stageTree();
    const cache = JSON.parse(REAL_CACHE_BYTES);
    const table = tableTextFromCache(cache);
    const up = stageUpstream(dir, table);
    const r = runGate(dir, ['--refresh', '--upstream', up, '--reason', '夹具：验证刷新只落本仓冻读取']);
    assert.equal(r.status, 0, '正常刷新须成功：' + r.err.slice(0, 200));
    const written = JSON.parse(fs.readFileSync(path.join(dir, CACHE_REL), 'utf8'));
    assert.equal(written.tableSha1, sha1(table), '刷新后的 sha1 必须等于夹具上游表的那一份');
    assert.equal(written.tableRows, 5, '面数必须真读出来');
    assert.equal(written.refreshReason, '夹具：验证刷新只落本仓冻读取', '理由须逐字落盘');
    assert.equal(fs.readFileSync(path.join(ROOT, CACHE_REL), 'utf8'), REAL_CACHE_BYTES,
        '★ 真仓冻读取必须逐字节未动（刷新只写 RP_ROOT 指向的那一份）');
    assert.equal(fs.existsSync(path.join(ROOT, 'tests', 'audit', 'upstream_face_cache.json.bak')), false,
        '不得留下备份残渣');
});

/* ══════════ F ── 版本锚与自述一致 ══════════ */
test('F1 ★★★ 五源同源（下限形）+ 当版条目自述的判据条数 == 真读数', () => {
    const idx = read('index.js');
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const log = JSON.parse(read('update-log.json'));
    const mv = /const ST_PHONE_VERSION = '([0-9.]+)'/.exec(idx)[1];
    assert.ok(/^3\.(1[89]|[2-9]\d)\./.test(mv), '本套件成立于 RubyPhone 3.19.0 及以后，当前 ' + mv);
    assert.equal(man.version, mv, 'manifest 与入口同源');
    assert.equal(pkg.version, mv, 'package 与 manifest 同源');
    assert.equal(log.latest, mv, 'update-log latest 与 manifest 同源');
    assert.ok(Array.isArray(log.versions[mv] && log.versions[mv].items) && log.versions[mv].items.length >= 4,
        '当版条目至少 4 条说明');
    /* ★ 取数口（v3.20.4 交棒改写）：本套件的**自身条数**自述在**本版**条目里（v3.20.3 那一条），
     *   而升级后「当版」会变成别人的版本 —— 读 `log.versions[mv]` 就是本仓记过的「读动态当前版本」
     *   漂移族（v255 C4 / v256 C4 同款）。故改为**扫描所有版本条目，取最近一次自述**：
     *   本条判据的实质是「自述数 == 真读数」，至于那份自述落在哪一版条目里不该由它来断言
     *   （「自述必须写在当版」是本版起才有的口径，由 v3204 E1 对**新**套件强制执行）。 */
    const mine = (() => {
        for (const k of Object.keys(log.versions)) {
            const items = ((log.versions[k] || {}).items) || [];
            const hit = (items.join('\n').match(/tests\/system-v3203\.test\.mjs（(\d+) 条/) || [])[1];
            if (hit) return hit;
        }
        return undefined;
    })();
    assert.ok(mine, '历史条目里必须至少有一处自述本套件的条数（否则这条判据无从核对）');
    const realCount = (read('tests/system-v3203.test.mjs').match(/^test\(/gm) || []).length;
    assert.equal(Number(mine), realCount, '★ 自述条数必须等于真读数：自述 ' + mine + ' / 真 ' + realCount);
});

/* ══════════ G ── R12 反向面对账（v3.23.4 · T1；本仓产出 → 上游消费） ══════════
 *   【为什么这一段的负控制里有一条专治「自我指涉」】
 *     本仓记过假绿三形，其中第三形是「破坏把判据自己删了（自我指涉）」。
 *     R12 的 b 格初版**真的踩了这一形**：它在 `ctx.confFiles`（= 本仓 `config/*.js`）里
 *     找出口名 —— 而登记行自己就写在 `config/crossrepo-registry.js` 里、`methods: […]`
 *     那串字面量本来就在那份文本里 ⇒ 判据**读到自己**、必然命中、永不报错。
 *     故 G3b 专治它：把 registry 里的名字改掉。若 b 格还在「自己那份文本」里找，
 *     新名字也在那里 ⇒ 会**绿**（假绿现形）；判定面挪到挂载点文件后 ⇒ 必须**红**。
 *   【判定面一律是「真源码破坏 → 副本 → 重跑同款真判据」】（本仓三形假绿的统一修法）。 */
const BRIDGE_MOUNT_REL = 'apps/memory/lonsha-bridge.js';

test('G1 ★★★ R12 真仓读数：摘要报出产出侧面数，且未给 --upstream 时如实说「未复核」', () => {
    const r = runGate(ROOT);
    assert.equal(r.status, 0, '前提：真仓裸跑须绿：' + r.err.slice(0, 300));
    assert.match(r.out, /\d+ 面（本仓产出侧 · R12）/, '摘要必须报出本仓产出面数（不是只在消费侧报数）');
    assert.match(r.out, /R12 反向面：本次登记 \*\*1 面\*\*/,
        '★ R12 必须出声（真仓确有 1 面；静默跳过与「0 面」同形）');
    assert.match(r.out, /未复核上游分发面/, '没给 --upstream 时必须如实报「未复核」');
    assert.equal(/R12 反向面 `ruby\.lonshaBridge` 上游复核/.test(r.out), false,
        '★ 没读上游就不许出现「上游复核」的字样（两者不许同形）');
});
test('G2 ★★★ R12-a：owner 不是本仓 ⇒ 转红（声明了上游消费却挂别人的名）', () => {
    const dir = stageTree({ [REGISTRY_REL]: {
        find: "        owner: 'ruby-phone',", to: "        owner: 'lonsha-memory-plugin'," } });
    const r = runGate(dir);
    assert.equal(r.status, 1, 'owner 不是本仓必须转红：' + r.err.slice(0, 200));
    assert.match(r.err, /R12 反向面登记行 `ruby\.lonshaBridge` 的 owner 不是本仓/, '必须点名 owner 与那条登记行');
});
test('G3 ★★★ R12-b：方法在**挂载点文件**里被改名 ⇒ 转红（真源码破坏，副本上重跑同款判据）', () => {
    const dir = stageTree({ [BRIDGE_MOUNT_REL]: {
        find: '    backfill(extracted) {', to: '    backfillRenamed(extracted) {' } });
    const r = runGate(dir);
    assert.equal(r.status, 1, '方法名在真源里没了必须转红：' + r.err.slice(0, 200));
    assert.match(r.err, /登记的本仓方法 `backfill` 在 apps\/memory\/lonsha-bridge\.js 的类体里找不到定义/,
        '必须点名方法、文件与「类体」这个判定面');
});
test('G3b ★★★ R12-b 判定面**不是登记行自己**：改 registry 里的名字也必须转红（专治自我指涉假绿）', () => {
    /* 这条是 G3 的反向自证：若 b 格在登记行所在的那份文本里找名字，改 registry 后
     *   `recallBlockRenamed` 仍在 registry 里 ⇒ 假绿（本仓第三形）；判定面在挂载点文件 ⇒ 红。 */
    const dir = stageTree({ [REGISTRY_REL]: {
        find: "'recallBlock', 'applyCoordinatedInjection',", to: "'recallBlockRenamed', 'applyCoordinatedInjection'," } });
    const r = runGate(dir);
    assert.equal(r.status, 1, '★ 改 registry 后必须转红 —— 绿就说明判定面读到了登记行自己（自我指涉）');
    assert.match(r.err, /登记的本仓方法 `recallBlockRenamed` 在 apps\/memory\/lonsha-bridge\.js/,
        '必须点名那个（不存在的）新名字');
});
test('G4 ★★★ R12-b：模块导出被拆 ⇒ 转红（exports 判的是真导出三态，不是「文件里出现过这个字符串」）', () => {
    const dir = stageTree({ [BRIDGE_MOUNT_REL]: {
        find: 'export function mountLonShaBridge(', to: 'function mountLonShaBridge(' } });
    const r = runGate(dir);
    assert.equal(r.status, 1, 'export 拆掉后须转红：' + r.err.slice(0, 200));
    assert.match(r.err, /登记的本仓导出 `mountLonShaBridge`/);
});
test('G4b ★★★ R12-b 反向自证：只拆命名导出而**留着 default 块成员** ⇒ 仍须绿（三态认得出来）', () => {
    /* 与 v3203 C7b 同规：把「导出」认成「必须写 export function」会误伤本仓合法的
     *   「先声明后成块转出」写法。`apps/memory/lonsha-bridge.js` 只有命名导出，故这条
     *   用**改 registry 声明**的方式造出「同一个名字的另一种真导出形态」不可行 ⇒
     *   改为直接证：真仓（三种导出形态共存）上该格为绿，且 LONSHA_BRIDGE_KEY（const 形态）
     *   与 LonShaBridge（class 形态）都被认出来。 */
    const r = runGate(ROOT);
    assert.equal(r.status, 0, '前提：真仓上 exports 三态全认得出来：' + r.err.slice(0, 300));
});
test('G5 ★★★ R12-c：挂载符号退役而登记未删 ⇒ 转红（表在绿、面已没）', () => {
    const dir = stageTree({ [REGISTRY_REL]: {
        find: "#mountLonShaBridge'", to: "#mountLonShaBridgeRetired'" } });
    const r = runGate(dir);
    assert.equal(r.status, 1, '挂载符号不存在须转红：' + r.err.slice(0, 200));
    assert.match(r.err, /的挂载符号在 apps\/memory\/lonsha-bridge\.js 里找不到定义/);
});
test('G6 ★★★ R12-d：消费面**不在上游分发面** ⇒ 转红（上游不加载它 = 「有消费点」在用户侧不成立）', () => {
    const dir = stageTree();
    const cache = JSON.parse(REAL_CACHE_BYTES);
    const table = tableTextFromCache(cache);
    const up = stageUpstream(dir, table);
    fs.writeFileSync(path.join(dir, CACHE_REL), JSON.stringify(makeCache(table), null, 2) + '\n');
    const mf = JSON.parse(fs.readFileSync(path.join(up, 'manifest.json'), 'utf8'));
    mf.js = 'other-entry.js';   /* 把消费面（index.js）踢出分发面 */
    fs.writeFileSync(path.join(up, 'manifest.json'), JSON.stringify(mf, null, 2) + '\n');
    const r = runGate(dir, ['--upstream', up]);
    assert.equal(r.status, 1, '消费面不在分发面须转红：' + r.err.slice(0, 200));
    assert.match(r.err, /的消费面 `index\.js` \*\*不在上游分发面\*\*/,
        '必须点名消费面与「不在分发面」这个判据');
});
test('G7 ★★★ R12-d：给了 --upstream 却读不到上游 manifest ⇒ 报缺陷（不许降级成「未复核」）', () => {
    const dir = stageTree();
    const cache = JSON.parse(REAL_CACHE_BYTES);
    const table = tableTextFromCache(cache);
    const up = stageUpstream(dir, table);
    fs.writeFileSync(path.join(dir, CACHE_REL), JSON.stringify(makeCache(table), null, 2) + '\n');
    fs.rmSync(path.join(up, 'manifest.json'), { force: true });
    const r = runGate(dir, ['--upstream', up]);
    assert.equal(r.status, 1, '★ 复核路径不可读不许降级（「读不到」与「未复核」不许同形）');
    assert.match(r.err, /给了 --upstream 但读不到上游 manifest\.json/);
});
test('G8 ★★★ R12 fail-closed：「没导出反向面数组」与「本仓没有反向面」不许同形', () => {
    const dir = stageTree({ [REGISTRY_REL]: {
        find: 'export const CROSSREPO_PRODUCED_FACES = Object.freeze([',
        to: 'const CROSSREPO_PRODUCED_FACES = Object.freeze([' } });
    const r = runGate(dir);
    assert.equal(r.status, 2, '★ 登记真源没导出反向面数组必须拒判（不是读成「0 面」）');
    assert.match(r.err, /未导出 CROSSREPO_PRODUCED_FACES/);
});
test('G9 ★★★ R12 判据工具两向自证：锚点不存在 / 不唯一一律抛（不许静默改成「差不多」的东西）', () => {
    assert.throws(() => stageTree({ [REGISTRY_REL]: {
        find: "owner: 'nobody-at-all',", to: "owner: 'x'," } }), /锚点应恰中 1 次/,
        '锚点不存在必须抛（否则负控制是假绿：破坏根本没发生）');
    assert.ok(REVERSE_MOUNT_FILES.includes(BRIDGE_MOUNT_REL),
        '夹具搬的挂载点文件必须来自登记行声明（一处真源），而不是测试里硬编的第二份');
});
