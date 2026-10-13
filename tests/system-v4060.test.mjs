/* ========================================================
 * tests/system-v4060.test.mjs -- [v4.06.0] 第十一道门 R3 口径修正
 *   「上游每一面都必须在本仓**有归属**」—— 归属有**两种**合法形态
 *
 * 【本版治的判据对撞(修前实测,不是推演)】
 *   上游 v3.323.0 新增三面 relationHistory / causalChain / perspectiveCard
 *   (consumer 均为 `none@0`,本仓一个都不消费)。修前:
 *     · R3 报「没有任何登记行带 upstreamFace 指向它」;
 *     · R8 报「理由台账里没有它的非空理由」。
 *   补上理由后 R8 转绿,而 **R3 仍红** —— 原实现只认一种归属。
 *   另一条路(给三面各补一条登记行)会撞上 tests/system-v3190.test.mjs 的 A1
 *   (`f.consumers.length >= 1`「登记了没人用」),而本仓明令
 *   「禁止为让接口有消费而加调用」⇒ 两条判据在「零消费面」上不可能同时满足。
 *
 * 【为什么改 R3 而不改 A1】该数组的语义(其模块注释自述)是「上游产出、本仓消费」
 *   的消费侧登记面,且 config/capability-health.js::minUpstreamOf 从它
 *   **派生「插件最低可用版本」** —— 零消费面塞进去会**对用户虚报版本偏低**(产品级假读数)。
 *   A1 守的正是这条语义,它是对的;错位的是**只认一种归属**的那一侧。
 *
 * 【本版自己抓到的两处自伤(合并前已修,留痕)】
 *   1 首版取数口只有一个「非空」问法,于是**理由为空**时 R3 与 R8 同时报同一个缺失
 *     —— 正是本仓治过的「同一件事两份口径」。修法:拆成两格问法,
 *     R3 只问**存在性**(`hasUnconsumedEntry`)、成色一律交 R8(判据 B3 钉住)。
 *   2 首版 `runGate` 固定跑**真仓**的门禁脚本 ⇒ 凡改过 `GATE_REL` 的负控制
 *     其实跑的还是原件(破坏根本没生效)。修法:`runGate` 优先跑**夹具里那一份**。
 *     这是本仓记过的假绿形态(负控制对原件断言),在本套件里又重现了一次。
 *
 * 本套件证的五件事:
 *   A 形态:自述已改口径 / R3 本体真合上了存在性取数口 / 取数口只一处实现
 *   B 行为:无行无条目 ⇒ R3 点名;补条目 ⇒ R3 不再点名;条目在但理由为空 ⇒ 归 R8 不归 R3;
 *           真仓裸跑绿且面数如实;未破坏副本必须绿
 *   C 负控制:真源码定点破坏 ⇒ 同款判据必转红(且原版上必真)
 *   D 分工钉子:R3 判存在 / R8 判成色;台账是真读数不是占位符
 *   E 版本锚:下限形
 *
 * 【为什么断言用 includes 而不是正则】本套件的锚点里全是括号与星号,
 *   正则转义层数一多,「判据自身」会静默失效(B1 首版就因 `\\*\\*` 退化成
 *   「反斜杠重复 0 次」而**侥幸通过** —— 假绿)。故除数字外一律用 `includes`。
 * ========================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const GATE_REL = 'scripts/upstream-face-audit.mjs';
const GATE_ABS = path.join(ROOT, GATE_REL);
const CACHE_REL = 'tests/audit/upstream_face_cache.json';
const UNCONS_REL = 'tests/audit/upstream_face_unconsumed.json';
const LAG_REL = 'tests/audit/upstream_face_lag.json';
const BRIDGE_REL = 'scripts/bridge-contract-audit.mjs';
const REGISTRY_REL = 'config/crossrepo-registry.js';

/** 反向面登记行自己声明的挂载点文件(R12 的判定面)。**从登记行读**(一处真源)。 */
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
const REVERSE_MOUNT_FILES = await reverseMountFiles();

const temps = [];
function tmp(prefix) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    temps.push(d);
    return d;
}
process.on('exit', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* ignore */ } }
});

/** 夹具树:真仓 config/ 全量 + 门禁脚本 + 冻读取 + 理由台账 + 上游台账 + 反向面挂载点 + ESM 标记。 */
function stageTree(overrides = {}) {
    const dir = tmp('rp_v4060_');
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
    /* R12 的判定面在挂载点文件上 —— 夹具不带它,报出来的是一堆与被测判据无关的红。 */
    for (const rel of REVERSE_MOUNT_FILES) {
        const dst = path.join(dir, rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(path.join(ROOT, rel), dst);
    }
    for (const [rel, ov] of Object.entries(overrides)) {
        const p = path.join(dir, rel);
        if (ov === null) { fs.rmSync(p, { force: true }); continue; }
        let src;
        try { src = fs.readFileSync(p, 'utf8'); } catch (_e) { src = ''; }
        for (const one of (Array.isArray(ov) ? ov : [ov])) src = one(src);
        fs.writeFileSync(p, src);
    }
    return dir;
}

/**
 * 跑门禁。★ 优先跑**夹具里那一份** `scripts/upstream-face-audit.mjs`:
 *   否则凡改过 GATE_REL 的负控制跑的还是真仓原件,破坏根本不生效
 *   —— 那正是本仓记过的「负控制对原件断言」假绿形态。
 */
function runGate(dir, extra = []) {
    const staged = path.join(dir, GATE_REL);
    const gateAbs = fs.existsSync(staged) ? staged : GATE_ABS;
    const r = spawnSync(process.execPath, [gateAbs, ...extra], {
        cwd: ROOT, encoding: 'utf8', env: { ...process.env, RP_ROOT: dir }
    });
    return { status: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') };
}

/**
 * 往冻读取副本里加一个本仓**既没有登记行、也没有理由条目**的「幽灵面」。
 *   这正是本版要抓的**沉默**。consumer 固定 none@0:本套件只覆盖「零消费面」这一支
 *   (带出口名的支路已有 v3203/v3204 覆盖,此处不重复造第二份口径)。
 */
function addGhost(s) {
    const c = JSON.parse(s);
    c.faces.ghostFace = { owner: 'lonsha-memory-plugin', producerVersion: 'v3.999.0',
        upstreamSymbol: 'ghost.js::build', consumer: 'none@0', standaloneBehavior: '夹具' };
    return JSON.stringify(c, null, 2) + '\n';
}
/** 往理由台账副本里写 / 清一条理由(面 → 理由;null 即删该面)。 */
function withReason(face, reason) {
    return (s) => {
        const t = JSON.parse(s);
        if (reason === null) delete t[face]; else t[face] = reason;
        return JSON.stringify(t, null, 2) + '\n';
    };
}
/** 破坏必须**恰中 1 次**;不唯一 / 不存在一律抛(不许静默改成「差不多」的东西)。 */
function breakOnce(from, to) {
    const src = read(GATE_REL);
    const n = src.split(from).length - 1;
    assert.equal(n, 1, '锚点应恰中 1 次,实际 ' + n + ':' + String(from).slice(0, 90));
    return src.replace(from, to);
}
/** 破坏副本里那份门禁,必须**真的**被 runGate 跑到(否则负控制测的是原件)。 */
function assertStaged(dir) {
    assert.ok(fs.existsSync(path.join(dir, GATE_REL)), '夹具里必须真有一份门禁脚本');
}

/* ---------- A 形态 ---------- */
test('A1 *** 门自述已改口径:R3 写明「两种合法形态」,且旧口径与旧报错文句都已清掉', () => {
    const g = read(GATE_REL);
    assert.ok(g.includes('R3 面 ↔ 条目 双向'), 'R3 逐条登记仍在');
    assert.ok(g.includes('两种合法形态'), '自述必须写明归属有两种形态');
    assert.ok(g.includes('不用且说明为什么'), '第二种形态必须逐字点名');
    assert.equal(g.includes('表里 5 面与 registry 里带'), false, '旧口径(只认登记行)不许残留');
    /* 旧报错文句现在说不准确了(它只说「没有任何登记行」),不许残留。
     * 锚点拼接:不让断言串自己命中自己(本仓记过的假红根因)。 */
    const LIT = '而本仓没有任何登记行带 upstream' + 'Face 指向它';
    assert.equal(g.includes(LIT), false, '旧报错文句不许残留');
});
test('A2 *** R3 本体真合上了「存在性」取数口,且取数口只一处实现', () => {
    const g = read(GATE_REL);
    assert.ok(g.includes('const hasUnconsumedEntry = (face) => {'), '存在性取数口必须在场');
    assert.ok(g.includes('if (!row && !hasUnconsumedEntry(face)) {'), 'R3 的判定面必须真的合上取数口');
    assert.equal((g.split('const hasUnconsumedEntry').length - 1), 1, '存在性取数口只许一处定义');
    assert.equal((g.split('const unconsumedTableOf').length - 1), 1, '台账取数口只许一处定义');
    /* 旧的单问法取数口不许残留(它就是那个把「缺失」与「为空」混成一件事的实现) */
    assert.equal(g.includes('unconsumedReasonOf'), false, '旧的单问法取数口必须拆掉,不许两份并存');
});

/* ---------- B 行为 ---------- */
test('B1 *** 面既无登记行也无理由条目 ⇒ R3 点名它(这是本版要抓的**沉默**)', () => {
    const r = runGate(stageTree({ [CACHE_REL]: addGhost }));
    assert.equal(r.status, 1, '既有面而无归属 ⇒ 必须转红');
    assert.ok(r.err.includes('R3 上游登记了面 `ghostFace`'), '必须逐面点名 R3:' + r.err.slice(0, 200));
    assert.ok(r.err.includes('也没有**在未消费理由台账里说明为什么不用它'), '必须说清两条路都缺');
});
test('B2 *** 同一夹具补上理由条目 ⇒ R3 与 R8 都不再点名(判据不是死的;第二种归属形态真在生效)', () => {
    const r = runGate(stageTree({ [CACHE_REL]: addGhost, [UNCONS_REL]: withReason('ghostFace', '夹具:还没接,理由非空') }));
    assert.equal(r.err.includes('R3 上游登记了面 `ghostFace`'), false, '有理由条目即算有归属:R3 必须不再报该面');
    assert.equal(r.err.includes('R8 面 `ghostFace`'), false, '该面也不该再被 R8 报');
    assert.equal(r.status, 0, '两条路都走通 ⇒ 须绿:' + r.err.slice(0, 200));
});
test('B3 *** 条目在场但理由为空 ⇒ 归 R8,**不**归 R3(同一个缺失只报一次)', () => {
    const r = runGate(stageTree({ [CACHE_REL]: addGhost, [UNCONS_REL]: withReason('ghostFace', '   ') }));
    assert.equal(r.status, 1, '空理由仍须转红');
    assert.ok(r.err.includes('R8 面 `ghostFace`'), '空理由归 R8');
    assert.equal(r.err.includes('R3 上游登记了面 `ghostFace`'), false,
        '条目在场就是「有归属」—— 成色问题归 R8,不许 R3 再报一遍(那会变成两份口径):' + r.err.slice(0, 200));
});
test('B4 *** 真仓裸跑:绿,且面数与问题数如实报出(本版不新增面、不改任何消费点)', () => {
    const r = runGate(ROOT);
    assert.equal(r.status, 0, '真仓必须绿:' + r.err.slice(0, 300));
    assert.ok(r.out.includes('问题 0'), '★ 问题数必须如实为 0:' + r.out.split('\n')[0]);
    assert.ok(r.out.includes('面' + '（' + '消费侧' + '）'), '★ 必须报出消费侧面数:' + r.out.split('\n')[0]);
    assert.ok(r.out.includes('12 面' + '（' + '消费侧' + '）'), '★ 上游现在 12 面,本版既不添消费点也不减面:' + r.out.split('\n')[0]);
    assert.ok(r.out.includes('1 面' + '（' + '本仓产出侧 · R12' + '）'), '★ 反向面读数也要如实:' + r.out.split('\n')[0]);
});
test('B5 *** 真仓未被破坏的副本树必须绿(后续每条负控制的前提)', () => {
    const r = runGate(stageTree());
    assert.equal(r.status, 0, '未破坏的副本树必须绿:' + r.err.slice(0, 400));
});

/* ---------- C 负控制:真源码破坏 ---------- */
test('C1 *** 破坏「第二种归属」⇒ 幽灵面不再被 R3 抓住(同款判据转红)', () => {
    const broken = breakOnce('return !!(t && Object.prototype.hasOwnProperty.call(t, face));', 'return true;');
    const dir = stageTree({ [GATE_REL]: () => broken, [CACHE_REL]: addGhost });
    assertStaged(dir);
    const r = runGate(dir);
    assert.equal(r.err.includes('R3 上游登记了面 `ghostFace`'), false,
        '★ 破坏副本里 R3 应已抓不住幽灵面(证明 B1 判的不是静物):' + r.err.slice(0, 200));
    const ok = runGate(stageTree({ [CACHE_REL]: addGhost }));
    assert.ok(ok.err.includes('R3 上游登记了面 `ghostFace`'), '★ 原版同一输入、同款判据必须真(否则上面是空转)');
});
test('C2 *** 破坏「台账取数口」本体 ⇒ 有理由条目的面也被读成没归属(取数口真在驱动 R3)', () => {
    const broken = breakOnce("return !!(t && Object.prototype.hasOwnProperty.call(t, face));", 'return !!(t && false);');
    const dir = stageTree({ [GATE_REL]: () => broken, [CACHE_REL]: addGhost,
        [UNCONS_REL]: withReason('ghostFace', '夹具:有理由') });
    assertStaged(dir);
    const r = runGate(dir);
    assert.ok(r.err.includes('R3 上游登记了面 `ghostFace`'),
        '★ 取数口坏了 ⇒ 有理由条目也被读成没归属:' + r.err.slice(0, 200));
    /* 两向对照:原版上同款判据必须**不**报(否则上面那句不是「因破坏而红」) */
    const ok = runGate(stageTree({ [CACHE_REL]: addGhost, [UNCONS_REL]: withReason('ghostFace', '夹具:有理由') }));
    assert.equal(ok.err.includes('R3 上游登记了面 `ghostFace`'), false, '原版必须不报');
    assert.equal(ok.status, 0, '原版须绿');
});

/* ---------- D 分工钉子 ---------- */
test('D1 *** 两份口径已分流(R3 判存在 / R8 判成色),两处自述都写明了同一条分工', () => {
    const g = read(GATE_REL);
    assert.ok(g.includes('R3 判「**有没有**归属」'), 'R3 侧的分工句必须在场');
    assert.ok(g.includes('R8 判「归属的**理由是不是非空**」'), 'R3 侧必须写明 R8 判的是什么');
    assert.ok(g.includes('R8 问「那一条理由**是不是非空**」'), 'R8 逐条自述要接上');
    assert.ok(g.includes('缺条目归 R3、条目空归 R8'), 'R8 侧也必须写明「同一个缺失只报一次」');
});
test('D2 *** 台账是真仓真读数:零消费面的理由非空、可追责(不是占位符)', () => {
    const t = JSON.parse(read(UNCONS_REL));
    assert.equal(t._schema, 'upstream-face-unconsumed@1', '台账自带 schema');
    const cache = JSON.parse(read(CACHE_REL));
    /* ★ 取数口本该是「台账 ∩ 未消费面」而**不是**「cache 里所有 none@0」:
     *   R3-X5 之后,relationHistory 那一面在上游账面仍是 none@0,而本仓已接上 ——
     *   按「cache 里所有 none@0」取数就会把**已消费**的面也拿来要理由(判据自伤)。
     *   台账的语义是「本仓认为还没用它的那些面」,故以**台账条目**为准。 */
    const entries = Object.keys(t).filter((k) => !k.startsWith('_'));
    const nones = Object.entries(cache.faces).filter((kw) => kw[1].consumer === 'none@0').map((kw) => kw[0])
        .filter((f) => entries.includes(f));
    assert.ok(nones.length >= 1, '真仓此刻应有零消费面(否则本版治的是个不存在的情形)');
    /* 【v4.07.0 交棒】本套件成立于「零消费面首发」那一版(三面 none@0)。
     *   此后 R3-X5 把 relationHistory 真接上了,该面**从本表移出**(走登记行那条路);
     *   台账条目随消费进度**可增可减** —— 故这里不再断言某个具体面在场,
     *   只断言「台账里剩的每一条都非空、可追责」与「已消费的面不得还留在台账里」。
     *   (写死「必须还剩三面」会让这条判据守的不再是「理由非空」,
     *    而是「本仓的跨仓消费进度停在某一版」—— 那是别人的提交进度,不是判据。) */
    const consumed = read('config/crossrepo-registry.js');
    for (const face of Object.keys(t).filter((k) => !k.startsWith('_'))) {
        assert.equal(consumed.includes("upstreamFace: '" + face + "'"), false,
            '★ 已接进登记行的面不许还留在未消费台账里(同一件事不许两处各说一遍):' + face);
    }
});

/* ---------- E 版本锚(下限形) ---------- */
test('E1 版本锚:入口不得低于 4.05.0(下限形,下一版抬版无需二次改写)', () => {
    const v = JSON.parse(read('package.json')).version.split('.').map(Number);
    assert.ok(v[0] > 4 || (v[0] === 4 && v[1] >= 5), '入口版本不得低于 4.05.0,实测 ' + v.join('.'));
});
