// tests/system-v3203.test.mjs — 跨仓外供面的「声明 ↔ 真码」对账（第十一道门）[v3.20.3]
//
//   本体是 `scripts/upstream-face-audit.mjs`（九条判据 R1–R9）。本套件判的是**门本身**：
//     ① 它真的在 `npm run check` 链上（否则等于没做）；
//     ② 它**位置无关**、且**不引用兄弟仓**（上游 P2 明令：在役测试面不得引用兄弟仓库）——
//        这一条是本版形态选择的根因，不是风格偏好；
//     ③ 它的九条判据**对真源码破坏有反应**（每条负控制都从**真仓文件**里读出内容、
//        在副本上恰中 1 次地破坏、再用**同款真判据**观观测转红）；
//     ④ 它的 fail-closed 是真的（缺输入 / 路径读不到 / schema 不符 ⇒ rc 2，不降级）；
//     ⑤ 刷新纪律是真的（`--refresh` 必须带上游目录与非空理由，且**不许改动真仓冻读取**）。
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
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const GATE_REL = 'scripts/upstream-face-audit.mjs';
const GATE_ABS = path.join(ROOT, GATE_REL);
const BRIDGE_REL = 'scripts/bridge-contract-audit.mjs';
const CACHE_REL = 'tests/audit/upstream_face_cache.json';
const UNCONS_REL = 'tests/audit/upstream_face_unconsumed.json';
const REGISTRY_REL = 'config/crossrepo-registry.js';

/** 与门同口径的 sha1（12 位十六进制）—— 冻读取与夹具都按这一份算。 */
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
    for (const rel of [BRIDGE_REL, CACHE_REL, UNCONS_REL]) {
        fs.copyFileSync(path.join(ROOT, rel), path.join(dir, rel));
    }
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

/** 夹具自含的「上游目录」（**绝不指向真兄弟仓** —— 上游 P2 的同一纪律）。 */
function stageUpstream(parent, tableText, version = '3.255.0') {
    const d = path.join(parent, 'upstream');
    fs.mkdirSync(path.join(d, 'tests', 'audit'), { recursive: true });
    fs.writeFileSync(path.join(d, 'tests', 'audit', 'open_face_registry.tsv'), tableText);
    fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify({ name: 'upstream', version }, null, 2) + '\n');
    return d;
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
    assert.match(r.out, /跨仓外供面「声明 ↔ 真码」对账：5 面 \/ 问题 0/);
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
    assert.match(r.out, /表 sha1 与冻读取一致/, '必须报出复核结论');
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
test('B6 ★★ R8：声明 none@0 的面必须能回答「为什么」——缺台账 / 空理由都转红，补上则不再报', () => {
    const broken = { [CACHE_REL]: { find: '"consumer": "readProjection@4"', to: '"consumer": "none@0"' } };
    const noTable = runGate(stageTree(broken), ['--unconsumed', '/nonexistent/unconsumed.json']);
    assert.equal(noTable.status, 1, '缺理由台账必须转红');
    assert.match(noTable.err, /R8 面 `projectionEnvelope`/, '必须逐面点名 R8');
    assert.match(noTable.err, /没给未消费理由台账/, '必须说清是「没给」而不是「没理由」');
    const empty = stageTree(broken);
    fs.writeFileSync(path.join(empty, UNCONS_REL), JSON.stringify({ _schema: 'upstream-face-unconsumed@1' }, null, 2) + '\n');
    const emptyRun = runGate(empty);
    assert.equal(emptyRun.status, 1, '空表仍须转红');
    assert.match(emptyRun.err, /没有它的非空理由/, '沉默不许存在');
    const ok = stageTree(broken);
    fs.writeFileSync(path.join(ok, UNCONS_REL),
        JSON.stringify({ projectionEnvelope: '夹具：理由非空即可（本面其余判据另测）' }, null, 2) + '\n');
    const okRun = runGate(ok);
    assert.equal(/R8 面 `projectionEnvelope`/.test(okRun.err + okRun.out), false,
        '★ 给了非空理由后 R8 必须不再报（判据不是死的；本面此时仍会因「有标签而声明 none」另报 R5，这是对的）');
    assert.match(okRun.err, /R5 面 `projectionEnvelope`/,
        '对照：把声明改成 none@0 而标签还在 ⇒ R5 必须独立报「表陈旧或标签多余」'
        + '（两条判据各判各的，不许互相顶替）');
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
    assert.match(r.err, /上游表声明 4/, '必须把真源那份读数亮出来（两数并排才能定位分叉）');
    assert.notEqual(r.status, runGate(ROOT).status, '★ 破坏必须可观测地改变行为（两向对照）');
});
test('C2 ★★★ 改真门禁副本的面标签 floor ⇒ R5 转红（钉子被拔掉即响）', () => {
    const dir = stageTree({ [BRIDGE_REL]: { find: '[face: checkpointCompare] [reader: readLonshaCheckpointFace] [floor: 1]', to: '[face: checkpointCompare] [reader: readLonshaCheckpointFace] [floor: 7]' } });
    const r = runGate(dir);
    assert.equal(r.status, 1, '标签下限被改必须转红');
    assert.match(r.err, /R5 面 `checkpointCompare` 的消费点下限不一致/, '必须点名面与 R5');
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
test('C4 ★★★ 改真冻读取副本的一条 producerVersion ⇒ R4 转红（版本口径不一致）', () => {
    const dir = stageTree({ [CACHE_REL]: { find: '"producerVersion": "v3.233.0"', to: '"producerVersion": "v3.999.0"' } });
    const r = runGate(dir);
    assert.equal(r.status, 1, '版本被改必须转红');
    assert.match(r.err, /R4 面 `eventPlatforms` 版本口径不一致/, '必须点名面与 R4');
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
test('C8 ★★★ 把真冻读取副本的 standaloneBehavior 改成「尚未接入」⇒ R7 转红（上游那格陈旧须同步）', () => {
    const dir = stageTree({ [CACHE_REL]: {
        find: '"standaloneBehavior": "快照无此面', to: '"standaloneBehavior": "尚未接入：夹具破坏。快照无此面'
    } });
    const r = runGate(dir);
    assert.equal(r.status, 1, '陈旧那格必须转红');
    assert.match(r.err, /R7 面 `projectionEnvelope`：本仓已有真源出口/, '必须点名面与 R7');
});
test('C9 ★★★ 判据工具自证：锚点不存在 / 不唯一一律抛（不得静默改成「差不多」的东西）', () => {
    assert.throws(() => replaceOnce('abc', 'zzz', 'y'), /锚点应恰中 1 次，实际 0/);
    assert.throws(() => replaceOnce('abcabc', 'abc', 'y'), /锚点应恰中 1 次，实际 2/);
    assert.equal(replaceOnce('abc', 'abc', 'y'), 'y', '对照：恰中 1 次时正常工作');
    /* 真源码锚点必须在场（否则上面每条负控制都是假绿） */
    assert.match(read(REGISTRY_REL), /declaredFloor: 4/, 'C1 的锚点必须在真源码里在场');
    assert.match(read(CACHE_REL), /"producerVersion": "v3\.233\.0"/, 'C4 的锚点必须在真源码里在场');
});

/* ══════════ D ── fail-closed（缺输入一律 rc 2，不许判「通过」） ══════════ */
test('D1 缺冻读取 ⇒ rc 2（须先显式刷新，不许在没读过上游的情况下造一份「读数」）', () => {
    const dir = stageTree({ [CACHE_REL]: null });
    const r = runGate(dir);
    assert.equal(r.status, 2, '缺冻读取必须拒判');
    assert.match(r.err, /冻读取缺失/, '必须说清缺的是哪个输入');
});
test('D2 冻读取 schema 不符 ⇒ rc 2（旧缓存配新判据不许静默错读）', () => {
    const dir = stageTree({ [CACHE_REL]: { find: '"schema": "upstream-face-cache@1"', to: '"schema": "upstream-face-cache@0"' } });
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
    const mine = (log.versions[mv].items.join('\n').match(/tests\/system-v3203\.test\.mjs（(\d+) 条/) || [])[1];
    assert.ok(mine, '当版条目里必须自述本套件的条数（否则这条判据无从核对）');
    const realCount = (read('tests/system-v3203.test.mjs').match(/^test\(/gm) || []).length;
    assert.equal(Number(mine), realCount, '★ 自述条数必须等于真读数：自述 ' + mine + ' / 真 ' + realCount);
});
