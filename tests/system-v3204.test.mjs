// tests/system-v3204.test.mjs — 跨仓冻读取的「可回源」与「上游台账待同步」（第十一道门两条新判据）[v3.20.4]
//
//   本版治的是**上一版自己交付的第十一道门自带的一处真缺陷**（不是新功能，是修自己）：
//
//   【缺陷（实测，不是推测）】v3.20.3 首建冻读取时冻的是上游 `open_face_registry.tsv`
//     的**工作树态**（`tableSha1 = f2977b893c27`），而上游 HEAD 提交态是 `1ba1c5f1f49b`
//     —— 两者不同。因为上游那份 worktree 里躺着**未提交**的对账修正。后果两条，都是本仓
//     反复付过代价的形态：
//       ① **不可回源**：换一台干净检出跑 `--upstream` 必报「表已变」，而红的理由
//          （「上游表变了」）与真处境（「我们冻了一份没人能到达的状态」）**答非所问**；
//       ② 更贵的是它**把真分歧洗白**：上游**提交态**里 `checkpointCompare` 那格仍写
//          `none@0` / `v3.237.0` / 「下游尚未接入」，而本仓自 v3.20.2 已接入 ——
//          这是「两处必须一致」判据**本该响**的真分歧，被脏态冻读取一并冻掉，门全绿。
//     （上一版那份「两侧看起来一致」正是**人工核对**出来的：人改了上游工作树、改完没提交。）
//
//   【本版落地】四件：
//     A. 冻读取 schema `upstream-face-cache@1` → `@2`，新增三格**来源读数**：
//        `sourceState`（`commit`|`worktree`）/ `upstreamCommit`（上游 HEAD 短 sha）/
//        `worktreeDirty`（该表在工作树里是否与提交态不同）。**升 schema 而不加可选字段**：
//        旧缓存缺格会与「不是脏态」同形（缺格静默通过），缺陷原样留存。
//     B. 新增 **R10 可回源**：`sourceState` 缺失 / 非 `commit` ⇒ 缺陷；缺 `upstreamCommit`
//        ⇒ 缺陷；`worktreeDirty === true` ⇒ **只作 note**（冻的是提交态故判断不受影响）。
//     C. 新增 **R11 上游台账待同步**：R4/R5/R7 的**跨仓**分歧（成因在上游那份文件、
//        本门对上游只读）不再直接计缺陷，改为必须在一份台账里逐条解释
//        （`tests/audit/upstream_face_lag.json`，`--lag`），按 `face + kind + upSays + ourSays`
//        四元组匹配；**双向闭合**：有分歧无理由 ⇒ 报；有理由无分歧 ⇒ 也报。
//        **同仓两处不一致**仍直接计缺陷，且新增「三方定位责任」（登记行与上游表同值而
//        只有门禁标签不同 ⇒ 判本地）。
//     D. R9 复核改为比对**提交态**（与冻读取同口径），`--from-worktree` 为显式逃生口，
//        其产物被 R10 判缺陷（能取 ≠ 能用）。
//
//   本套件判的仍是**门本身**：新判据对真源码破坏有反应、逃生口两向都真、非 git 上游
//   fail-closed；并逐条核「这一版没有把上一版的判据削弱成看得见却不管」（R8/R5/R11 的分工）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

const sha1 = (s) => createHash('sha1').update(String(s), 'utf-8').digest('hex').slice(0, 12);

const temps = [];
function tmp(prefix) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    temps.push(d);
    return d;
}
process.on('exit', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});

/** 破坏必须**恰中 1 次**（锚点不存在 / 不唯一一律抛，不许静默改写）。 */
function replaceOnce(s, from, to) {
    const n = s.split(from).length - 1;
    assert.equal(n, 1, `锚点应恰中 1 次，实际 ${n}：${String(from).slice(0, 70)}`);
    return s.replace(from, to);
}

/** 夹具树：真仓 config/ + 门禁脚本 + 冻读取 + 未消费台账 + 上游台账 + ESM 标记。 */
function stageTree(overrides = {}) {
    const dir = tmp('rp_v3204_');
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
    for (const [rel, ov] of Object.entries(overrides)) {
        const p = path.join(dir, rel);
        if (ov === null) { fs.rmSync(p, { force: true }); continue; }
        let src;
        try { src = fs.readFileSync(p, 'utf8'); }
        catch (_e) { src = ''; }
        for (const one of (Array.isArray(ov) ? ov : [ov])) {
            src = typeof one === 'function' ? one(src) : replaceOnce(src, one.find, one.to);
        }
        fs.writeFileSync(p, src);
    }
    return dir;
}

function runGate(dir, extra = [], env = {}) {
    const r = spawnSync(process.execPath, [GATE_ABS, ...extra], {
        cwd: ROOT, encoding: 'utf8', env: { ...process.env, RP_ROOT: dir, ...env }
    });
    return { status: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') };
}

/** 夹具上游：**真 git 仓**（本版要求 —— 门默认取提交态，非 git 仓 ⇒ rc 2 不退化）。 */
function stageUpstream(parent, tableText, version = '3.255.0') {
    const d = path.join(parent, 'upstream');
    fs.mkdirSync(path.join(d, 'tests', 'audit'), { recursive: true });
    fs.writeFileSync(path.join(d, 'tests', 'audit', 'open_face_registry.tsv'), tableText);
    fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify({ name: 'upstream', version }, null, 2) + '\n');
    const run = (args) => spawnSync('git', ['-C', d, ...args],
        { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
    assert.equal(run(['init', '-q']).status, 0, '夹具上游必须能 git init');
    run(['add', '-A']);
    assert.equal(run(['-c', 'user.name=f', '-c', 'user.email=f@example.invalid',
        'commit', '-q', '-m', 'fixture']).status, 0, '夹具上游必须能提交');
    return d;
}
/** 从真仓冻读取导出的一份合法上游表文本（列数与 COLS 一致）。 */
function tableTextFromCache(cache) {
    const COLS = ['face', 'owner', 'producer_version', 'upstream_symbol', 'contract_shape',
        'consumer', 'invalid_conditions', 'standalone_behavior', 'absent_vs_empty'];
    const lines = ['#' + COLS.join('\t')];
    for (const [face, f] of Object.entries(cache.faces)) {
        lines.push([face, f.owner, f.producerVersion, f.upstreamSymbol, 'fixture',
            f.consumer, 'fixture', f.standaloneBehavior, 'fixture'].join('\t'));
    }
    return lines.join('\n') + '\n';
}

const REAL_CACHE_BYTES = read(CACHE_REL);

/* ══════════ A ── 缺陷在场与形态锚（这一版治的东西必须能被指出来） ══════════ */
test('A1 ★★★ 真仓冻读取是**提交态**：sourceState=commit + upstreamCommit 非空 + schema=@2', () => {
    const c = JSON.parse(REAL_CACHE_BYTES);
    assert.equal(c.schema, 'upstream-face-cache@2', '本版 schema 必须是 @2（@1 缺「冻的是哪一态」这一格）');
    assert.equal(c.sourceState, 'commit', '★ 只许冻提交态（可回源）');
    assert.ok(String(c.upstreamCommit || '').trim(), '必须记明来源提交（答得出「出自哪一次提交」）');
    assert.ok(!/[\r\n]/.test(String(c.upstreamCommit)), '★ 来源提交不许带换行（rev-parse 尾换行的坑）');
    assert.ok(typeof c.worktreeDirty === 'boolean', 'worktreeDirty 必须是真读数（不得缺格）');
});
test('A2 ★★★ 门脚本自带缺陷留档：写明「上一版冻的是工作树脏态」及其两条后果', () => {
    const g = read(GATE_REL);
    assert.match(g, /f2977b893c27|工作树态/, '必须留档上一版冻的是什么');
    assert.match(g, /不可回源/, '必须点名「不可回源」这条后果');
    assert.match(g, /洗白/, '必须点名「把真分歧洗白」这条后果（更贵的那条）');
    assert.match(g, /--from-worktree/, '必须给出显式逃生口');
});
test('A3 ★★★ 十一条判据自述与真读数一致（门说几条就几条，R10/R11 在场）', () => {
    const g = read(GATE_REL);
    assert.match(g, /本门判什么（十一条/, '头部自述必须是十一条');
    assert.match(g, /\n \* {3}R10 /, 'R10 必须逐条登记');
    assert.match(g, /\n \* {3}R11 /, 'R11 必须逐条登记');
    assert.match(g, /R10 冻读取/, 'R10 判据本体必须在场');
    assert.match(g, /R11 /, 'R11 判据本体必须在场');
});
test('A4 ★★★ 台账文件在场且形态是「项数组」（R11 的输入不是可选摆设）', () => {
    const t = JSON.parse(read(LAG_REL));
    assert.equal(t.schema, 'upstream-face-lag@1', '台账自带 schema');
    assert.ok(Array.isArray(t.items), 'items 必须是数组（形态坏掉与空表不许同形）');
    assert.ok(t.items.length >= 1, '★ 真仓此刻**确有**上游账面与真码的分歧（提交态 none@0 vs 本仓已接入）');
    for (const it of t.items) {
        for (const k of ['face', 'kind', 'upSays', 'ourSays', 'upstreamCommit', 'reason']) {
            assert.ok(String(it[k] === undefined ? '' : it[k]).trim(), '台账项缺 ' + k + '：' + JSON.stringify(it).slice(0, 80));
        }
        assert.ok(['version', 'reader', 'floor', 'consumer-none', 'not-wired'].includes(it.kind), 'kind 必须是既定枚举：' + it.kind);
    }
});

/* ══════════ B ── 行为面（真仓真跑 + 夹具真跑） ══════════ */
test('B1 ★★★ 真仓裸跑：5 面 / 问题 0，且摘要里**说清分歧已被解释**（不许悄悄变绿）', () => {
    const r = runGate(ROOT);
    assert.equal(r.status, 0, '裸跑必须绿（stderr：' + r.err.slice(0, 200) + '）');
    assert.match(r.out, /跨仓外供面「声明 ↔ 真码」对账：5 面 \/ 问题 0/);
    assert.match(r.out, /R11 上游台账待同步：\*\*已解释 \d+ 条\*\*/,
        '★ 分歧被解释必须出声：摘要行仍写着上游那份陈旧账面（none@0），不出声就等于用台账把分歧藏起来');
    assert.match(r.out, /R10 上游那张表在工作树里有\*\*未提交改动\*\*/,
        'worktreeDirty 的真读数必须出现在 note 里（如实提示上游账面此刻与提交态不同）');
});
test('B2 ★★★ 给了 --upstream ⇒ 复核的是**提交态**，且如实报「工作树里有未提交改动」', () => {
    const r = runGate(ROOT, ['--upstream', '/home/user/lonsha-memory-plugin']);
    if (fs.existsSync('/home/user/lonsha-memory-plugin')) {
        assert.equal(r.status, 0, '真上游提交态与冻读取同源时须绿：' + r.err.slice(0, 300));
        assert.match(r.out, /R9 上游实时复核：\*\*提交态\*\* sha1 与冻读取一致/,
            '复核口径必须点明是提交态');
    } else {
        assert.equal(r.status, 2, '★ 上游目录不存在（换台机器）⇒ fail-closed rc 2，不许降级成「未复核」');
    }
});
test('B3 ★★ 夹具里 --upstream 同源 ⇒ 绿且报提交态一致（夹具自带 git 仓，不依赖真兄弟仓）', () => {
    const dir = stageTree();
    const cache = JSON.parse(REAL_CACHE_BYTES);
    const table = tableTextFromCache(cache);
    const up = stageUpstream(dir, table);
    const c = JSON.parse(REAL_CACHE_BYTES);
    c.tableSha1 = sha1(table);
    c.worktreeDirty = false;
    fs.writeFileSync(path.join(dir, CACHE_REL), JSON.stringify(c, null, 2) + '\n');
    const r = runGate(dir, ['--upstream', up]);
    assert.equal(r.status, 0, '夹具同源时须绿：' + r.err.slice(0, 400));
    assert.match(r.out, /R9 上游实时复核：\*\*提交态\*\* sha1 与冻读取一致/, '必须报出复核结论');
    assert.equal(/未复核/.test(r.out), false, '复核过了就不许再说「未复核」');
});
test('B4 ★★★ 夹具里改了上游表并提交 ⇒ R9 转红点名「表已变」（提交态口径下仍要响）', () => {
    const dir = stageTree();
    const cache = JSON.parse(REAL_CACHE_BYTES);
    const up = stageUpstream(dir, tableTextFromCache(cache) + 'changed\tx\tx\tx\tx\tnone@0\tx\tx\tx\n');
    const c = JSON.parse(REAL_CACHE_BYTES);
    c.tableSha1 = 'deadbeef0000';
    c.worktreeDirty = false;
    fs.writeFileSync(path.join(dir, CACHE_REL), JSON.stringify(c, null, 2) + '\n');
    const r = runGate(dir, ['--upstream', up]);
    assert.equal(r.status, 1, '表变了必须转红');
    assert.match(r.err, /R9 上游登记表已变/, '必须点名 R9');
});
test('B5 ★★★ 上游**只有工作树脏**（未提交）而提交态未变 ⇒ 复核仍绿，但必须出 note 说明', () => {
    /* 这正是本版的分野：上一版会把「工作树有人改了」读成「上游表变了」（答非所问），
     * 本版按提交态判 ⇒ 绿；但脏这件事不许被吞掉，故必须有 note。 */
    const dir = stageTree();
    const cache = JSON.parse(REAL_CACHE_BYTES);
    const table = tableTextFromCache(cache);
    const up = stageUpstream(dir, table);
    fs.appendFileSync(path.join(up, 'tests', 'audit', 'open_face_registry.tsv'), '# dirty worktree\n');
    const c = JSON.parse(REAL_CACHE_BYTES);
    c.tableSha1 = sha1(table);
    c.worktreeDirty = false;
    fs.writeFileSync(path.join(dir, CACHE_REL), JSON.stringify(c, null, 2) + '\n');
    const r = runGate(dir, ['--upstream', up]);
    assert.equal(r.status, 0, '★ 提交态未变 ⇒ 不许红（上一版在这里报「表已变」，是答非所问）：' + r.err.slice(0, 300));
    assert.match(r.out, /R9 上游该表在工作树里有未提交改动/, '脏这件事必须如实出声（不许静默吞掉）');
    assert.match(r.out, /复核按\*\*提交态\*\*判/, '必须说清判的是什么');
});
test('B6 ★★ R8 与 R11 的分工：账面 none@0 而本仓在用 ⇒ 不给 R8，走 R11 要解释', () => {
    const stale = runGate(stageTree({ [CACHE_REL]: { find: '"consumer": "readProjection@4"', to: '"consumer": "none@0"' } }));
    assert.equal(/R8 面 `projectionEnvelope`/.test(stale.err + stale.out), false,
        '★ 本仓有消费证据（标签还在）时 R8 不再要「为什么还没用」——那是语义错位');
    assert.match(stale.err, /R11 上游面 `projectionEnvelope` 的 consumer-none/,
        '★ 这类分歧必须走 R11：账面与真码对不上就得能回答「为什么」');
});

/* ══════════ C ── 负控制：真源码破坏 ⇒ 同款真判据转红 ══════════ */
test('C0 ★★★ 基线自证：未破坏的真源码副本上，本门必须为绿（负控制的前提）', () => {
    const r = runGate(stageTree());
    assert.equal(r.status, 0, '未经破坏的副本树必须绿（否则后面每条破坏都无从归因）：' + r.err.slice(0, 400));
});
test('C1 ★★★ 冻读取的 sourceState 改成 worktree ⇒ R10 转红（本版治的缺陷形态）', () => {
    const dir = stageTree({ [CACHE_REL]: { find: '"sourceState": "commit"', to: '"sourceState": "worktree"' } });
    const r = runGate(dir);
    assert.equal(r.status, 1, '冻成工作树态必须转红');
    assert.match(r.err, /R10 冻读取的 sourceState 是 `worktree`/, '必须点名 R10 与被冻的态');
    assert.match(r.err, /不可回源|工作树态/, '必须说清为什么是缺陷');
    assert.notEqual(r.status, runGate(ROOT).status, '★ 破坏必须可观测地改变行为（两向对照）');
});
test('C2 ★★★ 拿掉 upstreamCommit ⇒ R10 转红；拿掉 sourceState ⇒ R10 也转红（缺格不许静默通过）', () => {
    const drop = (k) => stageTree({ [CACHE_REL]: (s) => {
        const c = JSON.parse(s);
        delete c[k];
        return JSON.stringify(c, null, 2) + '\n';
    } });
    const noCommit = runGate(drop('upstreamCommit'));
    assert.equal(noCommit.status, 1, '缺来源提交必须转红');
    assert.match(noCommit.err, /R10 冻读取缺 upstreamCommit/, '必须点名缺的是哪一格');
    const noState = runGate(drop('sourceState'));
    assert.equal(noState.status, 1, '缺来源态必须转红');
    assert.match(noState.err, /R10 冻读取缺 sourceState/, '必须点名缺的是哪一格');
});
test('C3 ★★★ worktreeDirty=true 只是 note 而**不是**缺陷（且该读数真在驱动那句 note）', () => {
    /* 真仓此刻 worktreeDirty=true（上游那份表在工作树里有未提交改动），门仍须绿；
     *   反向自证：把这格改成 false，那句 note **必须消失** —— 否则它是写着玩的。 */
    const green = runGate(stageTree());
    assert.equal(green.status, 0, 'worktreeDirty=true 不许转红：' + green.err.slice(0, 300));
    assert.match(green.out, /R10 上游那张表在工作树里有\*\*未提交改动\*\*/, '必须如实出声');
    const quiet = runGate(stageTree({ [CACHE_REL]: { find: '"worktreeDirty": true', to: '"worktreeDirty": false' } }));
    assert.equal(quiet.status, 0, '改成 false 仍须绿');
    assert.equal(/未提交改动/.test(quiet.out), false, '★ 改成 false 后那句 note 必须消失（读数真在驱动它）');
});
test('C4 ★★★ 台账项理由被清空 ⇒ R11 转红（沉默不许存在）', () => {
    const dir = stageTree();
    const t = JSON.parse(read(LAG_REL));
    t.items[0].reason = '   ';
    fs.writeFileSync(path.join(dir, LAG_REL), JSON.stringify(t, null, 2) + '\n');
    const r = runGate(dir);
    assert.equal(r.status, 1, '空理由必须转红');
    assert.match(r.err, /reason 为空/, '必须点名空理由');
});
test('C5 ★★★ 台账项缺 upstreamCommit ⇒ R11 转红（答不出「上游一提交这条还成不成立」）', () => {
    const dir = stageTree();
    const t = JSON.parse(read(LAG_REL));
    delete t.items[0].upstreamCommit;
    fs.writeFileSync(path.join(dir, LAG_REL), JSON.stringify(t, null, 2) + '\n');
    const r = runGate(dir);
    assert.equal(r.status, 1, '缺来源提交必须转红');
    assert.match(r.err, /台账里这条缺 upstreamCommit/, '必须点名缺的是哪一格');
});
test('C6 ★★★ 台账项删掉一条（分歧仍在而无理由）⇒ R11 逐条点名转红', () => {
    const dir = stageTree();
    const t = JSON.parse(read(LAG_REL));
    const dropped = t.items.pop();
    fs.writeFileSync(path.join(dir, LAG_REL), JSON.stringify(t, null, 2) + '\n');
    const r = runGate(dir);
    assert.equal(r.status, 1, '有分歧无理由必须转红');
    assert.match(r.err, new RegExp('R11 .*' + dropped.face), '必须点名被漏掉的那条面：' + dropped.face);
    assert.match(r.err, /台账里没有\*\*这一条\*\*/, '必须说清是「没有这一条」而不是「理由为空」');
});
test('C7 ★★★ 台账腐化（分歧已消失而条目还在）⇒ R11 反向转红（登记着不存在的分歧就是掩饰）', () => {
    const dir = stageTree({ [CACHE_REL]: (s) => {
        const c = JSON.parse(s);
        c.faces.checkpointCompare.consumer = 'readLonshaCheckpointFace@1';
        c.faces.checkpointCompare.standaloneBehavior = '下游已接入（夹具）';
        c.faces.checkpointCompare.producerVersion = 'v3.252.0';
        return JSON.stringify(c, null, 2) + '\n';
    } });
    const r = runGate(dir);
    assert.equal(r.status, 1, '台账腐化必须转红');
    assert.match(r.err, /R11 台账里登记了 `checkpointCompare\/consumer-none`/, '必须点名腐化的那条');
    assert.match(r.err, /已经不分歧/, '必须说清是「分歧不存在了」');
});
test('C8 ★★★ 台账 shape 坏掉（items 不是数组）⇒ R11 报「形态不可信」，不与「空表」同形', () => {
    const dir = stageTree({ [LAG_REL]: { find: '"items": [', to: '"items": {' } });
    const r = runGate(dir);
    assert.equal(r.status, 1, '坏形态必须转红');
    assert.match(r.err, /`items` 不是数组/, '必须说清是形态坏了，而不是「没有分歧」');
});
test('C9 ★★★ 判据工具自证：锚点不存在 / 不唯一一律抛', () => {
    assert.throws(() => replaceOnce('abc', 'zzz', 'y'), /锚点应恰中 1 次，实际 0/);
    assert.throws(() => replaceOnce('abcabc', 'abc', 'y'), /锚点应恰中 1 次，实际 2/);
    assert.equal(replaceOnce('abc', 'abc', 'y'), 'y', '对照：恰中 1 次时正常工作');
    /* 真源码锚点必须在场（否则上面每条负控制都是假绿） */
    assert.match(read(CACHE_REL), /"sourceState": "commit"/, 'C1 的锚点必须在真源码里在场');
    assert.match(read(CACHE_REL), /"worktreeDirty": true/, 'C3 的锚点必须在真源码里在场');
    assert.match(read(LAG_REL), /"reason": "/, 'C4 的锚点必须在真源码里在场');
    assert.match(read(LAG_REL), /"upstreamCommit": "/, 'C5 的锚点必须在真源码里在场');
});
test('C10 ★★★ 逃生口两向都真：能取到工作树态，产物又必须被 R10 判缺陷', () => {
    const dir = stageTree();
    const up = stageUpstream(dir, tableTextFromCache(JSON.parse(REAL_CACHE_BYTES)));
    fs.appendFileSync(path.join(up, 'tests', 'audit', 'open_face_registry.tsv'), '# dirty\n');
    const r = runGate(dir, ['--refresh', '--upstream', up, '--from-worktree', '--reason', '夹具：逃生口']);
    assert.equal(r.status, 0, '逃生口本身须能跑通：' + r.err.slice(0, 200));
    assert.match(r.err, /冻的是\*\*工作树态\*\*/, '必须打印警告（不是无声开关）');
    const written = JSON.parse(fs.readFileSync(path.join(dir, CACHE_REL), 'utf8'));
    assert.equal(written.sourceState, 'worktree', '★ 必须真取到工作树态（不被静默无视）');
    assert.equal(written.worktreeDirty, true, '★ 该表确有未提交改动，该项必须为真');
    const judged = runGate(dir);
    assert.equal(judged.status, 1, '★ 能取 ≠ 能用：产物必须被 R10 判缺陷');
    assert.match(judged.err, /R10 冻读取的 sourceState 是 `worktree`/, '必须当场抓住');
});
test('C11 ★★★ 非 git 仓的上游 ⇒ rc 2 且**不退回读工作树**（fail-closed 不许降级）', () => {
    const dir = stageTree();
    const up = path.join(dir, 'upstream-plain');
    fs.mkdirSync(path.join(up, 'tests', 'audit'), { recursive: true });
    fs.writeFileSync(path.join(up, 'tests', 'audit', 'open_face_registry.tsv'),
        tableTextFromCache(JSON.parse(REAL_CACHE_BYTES)));
    fs.writeFileSync(path.join(up, 'manifest.json'), JSON.stringify({ version: '3.255.0' }) + '\n');
    const r = runGate(dir, ['--refresh', '--upstream', up, '--reason', '夹具：非 git 上游']);
    assert.equal(r.status, 2, '非 git 仓必须拒判');
    assert.match(r.err, /不是 git 仓|不退回读工作树/, '必须说清为什么不退回读工作树');
});
test('C12 ★★★ 「三方定位责任」：登记行与上游表同值而只有门禁标签不同 ⇒ 判本地，不许推给上游', () => {
    /* 这条防的是本版新增通路被滥用：R11 的存在不是让人把**本仓自己抄错**的东西
     *   也推给上游。第三个见证（登记行）与上游表一致 ⇒ 分歧只在本地标签上 ⇒ 直接计缺陷。 */
    const dir = stageTree({ [BRIDGE_REL]: { find: '[face: checkpointCompare] [reader: readLonshaCheckpointFace] [floor: 1]', to: '[face: checkpointCompare] [reader: readLonshaCheckpointFace] [floor: 7]' } });
    const r = runGate(dir);
    assert.equal(r.status, 1, '本地标签被改必须转红');
    assert.match(r.err, /R5 面 `checkpointCompare`：登记行 `lonsha\.checkpointContent` 的 declaredFloor 写 1/,
        '必须点名「登记行与标签不一致」（这是同仓两处打架，不是跨仓分歧）');
    assert.match(r.err, /而同仓门禁标签写 7/, '必须把被改后的读数亮出来');
});
test('C13 ★★ `--lag` 指到别处的台账 ⇒ 生效（路径可换，不许硬编码真仓那一份）', () => {
    /* 夹具里默认指向 RP_ROOT 下那一份；显式给一个**内容不同**的台账，判定必须跟着它走。 */
    const dir = stageTree();
    const t = JSON.parse(read(LAG_REL));
    const alt = path.join(dir, 'alt-lag.json');
    t.items = t.items.filter((x) => x.kind !== 'version');   /* 少一条 ⇒ 该分歧无理由 */
    fs.writeFileSync(alt, JSON.stringify(t, null, 2) + '\n');
    const r = runGate(dir, ['--lag', alt]);
    assert.equal(r.status, 1, '换台账后缺的那条分歧必须转红');
    assert.match(r.err, /checkpointCompare\/version|version 与下游不一致/, '必须点名缺的那条');
    /* 对照：把这条补回去（用一个非真仓路径的台账）⇒ 该条不再报 */
    const t2 = JSON.parse(read(LAG_REL));
    const alt2 = path.join(dir, 'alt-lag2.json');
    fs.writeFileSync(alt2, JSON.stringify(t2, null, 2) + '\n');
    const ok = runGate(dir, ['--lag', alt2]);
    assert.equal(ok.status, 0, '完整台账（非真仓路径）⇒ 绿：' + ok.err.slice(0, 200));
});
test('C14 ★★★ 台账的 upSays 必须与**冻读取提交态**逐字一致（台账不许写别的数来"圆"过去）', () => {
    /* 台账是「解释」，不是「改数」的通道。故逐条核：`version` 那条的 upSays 必须等于
     *   冻读取里该面的 producerVersion；`consumer-none` 那条必须等于该面的 consumer。
     *   若哪天有人把台账里的数改成「好看的值」，这条立刻响 —— 解释权与事实分离。 */
    const c = JSON.parse(REAL_CACHE_BYTES);
    const t = JSON.parse(read(LAG_REL));
    const want = { version: 'producerVersion', 'consumer-none': 'consumer' };
    for (const it of t.items) {
        const field = want[it.kind];
        if (!field) continue;
        assert.ok(c.faces[it.face], '台账项的面必须在冻读取里在场：' + it.face);
        assert.equal(String(it.upSays), String(c.faces[it.face][field]),
            '★ 台账 ' + it.face + '/' + it.kind + ' 的 upSays 必须逐字等于冻读取的 ' + field);
    }
    /* 反向自证：把台账里的数改一个字符 ⇒ 这条判据必须不成立（判据不是死的）。 */
    const broken = t.items.map((x) => Object.assign({}, x));
    broken[0].upSays = String(broken[0].upSays) + 'X';
    const mismatch = broken.some((it) => want[it.kind]
        && String(it.upSays) !== String(c.faces[it.face][want[it.kind]]));
    assert.equal(mismatch, true, '改动 upSays 后必须能观测到不一致（否则上面的断言是空转）');
});

/* ══════════ D ── fail-closed 与刷新纪律（本版新增的入口不许破旧纪律） ══════════ */
test('D1 缺冻读取 ⇒ rc 2（须先显式刷新）', () => {
    const r = runGate(stageTree({ [CACHE_REL]: null }));
    assert.equal(r.status, 2, '缺冻读取必须拒判');
    assert.match(r.err, /冻读取缺失/, '必须说清缺的是什么');
});
test('D2 旧 schema（@1）⇒ rc 2（旧缓存配新判据不许静默错读）', () => {
    const r = runGate(stageTree({ [CACHE_REL]: { find: '"schema": "upstream-face-cache@2"', to: '"schema": "upstream-face-cache@1"' } }));
    assert.equal(r.status, 2, 'schema 不符必须拒判');
    assert.match(r.err, /schema/, '必须点名 schema');
});
test('D3 缺上游台账文件 ⇒ **不降级**（缺文件与「没有分歧」不许同形）', () => {
    /* 本版新入口：`--lag` 缺省指向真仓台账。夹具里删掉它，门仍须按「没给台账」处理
     *   —— 此刻真仓确有分歧 ⇒ 必须转红，而不是被读成「没有分歧」。 */
    const r = runGate(stageTree({ [LAG_REL]: null }));
    assert.equal(r.status, 1, '缺台账而确有分歧必须转红');
    assert.match(r.err, /没给「上游台账待同步」台账/, '必须说清是「没给」而不是「没有分歧」');
});
test('D4 --refresh 必须带非空理由（空理由的刷新等于没有纪律）', () => {
    const dir = stageTree();
    const up = stageUpstream(dir, tableTextFromCache(JSON.parse(REAL_CACHE_BYTES)));
    const r = runGate(dir, ['--refresh', '--upstream', up, '--reason', '   ']);
    assert.equal(r.status, 2, '空理由必须拒判');
    assert.match(r.err, /必须带 --reason/, '必须要求写明理由');
});
test('D5 ★★★ 默认刷新冻的是**提交态**：写出的三格必须自洽，且真仓冻读取逐字节未动', () => {
    const dir = stageTree();
    const table = tableTextFromCache(JSON.parse(REAL_CACHE_BYTES));
    const up = stageUpstream(dir, table);
    fs.appendFileSync(path.join(up, 'tests', 'audit', 'open_face_registry.tsv'), '# dirty\n');
    const r = runGate(dir, ['--refresh', '--upstream', up, '--reason', '夹具：验证默认取提交态']);
    assert.equal(r.status, 0, '正常刷新须成功：' + r.err.slice(0, 200));
    const w = JSON.parse(fs.readFileSync(path.join(dir, CACHE_REL), 'utf8'));
    assert.equal(w.sourceState, 'commit', '★ 默认必须是提交态');
    assert.equal(w.tableSha1, sha1(table), '★ sha1 必须是**提交态**那一份（不是工作树脏态）');
    assert.equal(w.worktreeDirty, true, '工作树脏这件事必须如实记为真');
    assert.ok(String(w.upstreamCommit || '').trim() && !/[\r\n]/.test(w.upstreamCommit), '来源提交非空且无换行');
    assert.equal(fs.readFileSync(path.join(ROOT, CACHE_REL), 'utf8'), REAL_CACHE_BYTES,
        '★ 真仓冻读取必须逐字节未动（刷新只写 RP_ROOT 指向的那一份）');
});

/* ══════════ E ── 交棒改写与版本锚 ══════════ */
test('E1 ★★★ 五源同源 + 当版条目自述的判据条数 == 真读数', () => {
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
    const mine = (log.versions[mv].items.join('\n').match(/tests\/system-v3204\.test\.mjs（(\d+) 条/) || [])[1];
    assert.ok(mine, '当版条目里必须自述本套件的条数（否则这条判据无从核对）');
    const realCount = (read('tests/system-v3204.test.mjs').match(/^test\(/gm) || []).length;
    assert.equal(Number(mine), realCount, '★ 自述条数必须等于真读数：自述 ' + mine + ' / 真 ' + realCount);
});
test('E2 ★★★ 本版治的缺陷必须进当版条目（自述留档：不可回源 + 洗白两条后果）', () => {
    const log = JSON.parse(read('update-log.json'));
    const items = log.versions[log.latest].items.join('\n');
    assert.match(items, /不可回源/, '当版条目必须写明「不可回源」');
    assert.match(items, /洗白/, '当版条目必须写明「把真分歧洗白」');
    assert.match(items, /R10/, '当版条目必须点名新判据 R10');
    assert.match(items, /R11/, '当版条目必须点名新判据 R11');
});
test('E3 ★★ 边界文档带当版复校标记，且写明本版新增的可观测面', () => {
    const doc = read('docs/runtime-verification-boundary.md');
    const pkg = JSON.parse(read('package.json'));
    assert.ok(doc.includes('v' + pkg.version + ' 复校'), '边界文档必须带当版复校标记');
    assert.match(doc, /可回源|工作树态/, '边界文档必须写明本版新增的读数面');
});
test('E4 ★★ 交棒改写是**主动**的：旧套件里那几处失配锚点已同步（口径不留两版）', () => {
    const own = read('tests/system-v3203.test.mjs');
    assert.match(own, /upstream-face-cache@2/, 'D2 的 schema 锚点必须跟随真源升到 @2');
    assert.match(own, /提交态\\*\\* sha1 与冻读取一致|提交态\*\* sha1 与冻读取一致/, 'B3 的措辞必须跟随 R9 新文案');
    assert.match(own, /function gitInit|gitInit\(/, '夹具上游必须是真 git 仓（否则 --refresh 类用例全部撞在「不是 git 仓」上）');
    assert.match(own, /LAG_REL/, '夹具必须带上游台账（R11 的输入）');
    assert.match(own, /ghostFace/, '★ 旧套件里 R8 的用例必须改造成「本仓确无消费证据」的形态');
    assert.match(own, /R11 上游面 `projectionEnvelope` 的 consumer-none/,
        '★ 旧套件必须补上「这一类分歧要走 R11」的断言（口径不留两版）');
    /* 旧套件里那条被**证伪**过的断言不许留着：v3.20.3 曾断言「把已接入面改成 none@0 ⇒ R8 报
     *   projectionEnvelope」，而新口径下那是跨仓分歧（R11 管），R8 只管「本仓确无消费证据」的面。
     *   锚点字面量必须拼接，不让断言串自己命中自己（本仓记过的假红根因）。 */
    const LIT = 'R8 面 `projection' + 'Envelope`';
    assert.equal(own.includes(LIT), false, '★ 旧断言「改成 none@0 ⇒ R8 报 projectionEnvelope」必须被改掉');
});
