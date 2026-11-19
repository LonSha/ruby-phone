/**
 * r26_o4_log_level.test.mjs — R26-O4 日志分级与采样
 *
 * 【咬点（每一条都对应计划书验收口径的一半）】
 *   A1 四级闭集 + 级别门槛：低于门槛的一条都不出现（不是「少一些」）；
 *   A2 **error 永不采样**：两道硬保证都要被咬（配置时拒、运行时也拒）；
 *   A3 采样**确定性**：同序列两闸逐条一致 —— 若实现偷用 Math.random，这里必红；
 *   A4 采样率可调且**单调**：0.3 的保留集必须是 0.5 的子集，0 条 / 全量两个端点也要对；
 *   A5 桥可逆：装桥真接管、undo 逐引用还原（不是「大概恢复了」）；
 *   A6 三态不塌：absent / ok / unknown 各归各位；**无钟不编造丢弃**；
 *   A7 接线在不在：index.js 装桥留痕、诊断页有卡、设置项登记。
 *
 * 【负控制为什么放在本文件里真改源码】
 *   本仓反复付代价的形态是「判据读源码字符串，实现坏了也照样绿」。所以 N1~N3 是
 *   把 `config/log-gate.js` 复制到临时文件、**真打坏**（摘掉 error 硬保证 / 换成 random /
 *   让 undo 变空），再从临时文件 import 断言原判据转红。跑完 finally 删掉临时文件。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    LOG_LEVELS,
    DEFAULT_LEVEL,
    DEFAULT_RATES,
    createLogGate,
    installConsoleBridge,
    logGateFace,
    logGateFaceText,
    logGateRows,
    logGateSelfCheck
} from '../config/log-gate.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'config', 'log-gate.js');

/** 固定钟：判据复跑必须同结果。 */
const FIXED = () => 0;

function keptOf(gate, level, msgs) {
    return msgs.filter((m) => gate.emit(level, m).forwarded);
}

function seqOf(n) {
    return Array.from({ length: n }, (_, i) => 'line-' + i);
}

/** 把模块源码打坏成临时模块并 import（同目录 ⇒ 相对 import 仍成立）。 */
let brokenSeq = 0;
async function loadBroken(mutate) {
    const src = fs.readFileSync(SRC, 'utf8');
    const out = mutate(src);
    assert.notEqual(out, src, '负控制没改到源码：mutator 失配（判据会假绿）');
    brokenSeq += 1;
    const tmp = path.join(root, 'config', '.tmp_r26o4_broken_' + brokenSeq + '.mjs');
    fs.writeFileSync(tmp, out, 'utf8');
    try {
        return await import(pathToFileURL(tmp).href);
    } finally {
        try { fs.unlinkSync(tmp); } catch (_e) { /* 已删 */ }
    }
}

/* ---------------- A1 四级 + 门槛 ---------------- */

test('O4-A1 四级闭集与默认值：级别门槛下低级别一条不出现', () => {
    assert.deepEqual([...LOG_LEVELS], ['debug', 'info', 'warn', 'error']);
    assert.equal(DEFAULT_LEVEL, 'info');
    assert.deepEqual(DEFAULT_RATES, { debug: 1, info: 1, warn: 1, error: 1 });
    const g = createLogGate({ level: 'warn', now: FIXED });
    const msgs = seqOf(30);
    assert.deepEqual(keptOf(g, 'info', msgs), [], 'info 在 warn 门槛下必须一条不出现');
    assert.deepEqual(keptOf(g, 'debug', msgs), []);
    assert.equal(keptOf(g, 'warn', msgs).length, 30);
    assert.equal(keptOf(g, 'error', msgs).length, 30);
    assert.equal(g.stats().levelDropped, 60, '挡下数要如实计（30 debug + 30 info）');
    /* 非法级别被拒，不许静默改级 */
    assert.equal(g.setLevel('verbose').ok, false);
    assert.equal(g.setLevel('debug').ok, true);
    assert.equal(g.stats().level, 'debug');
});

/* ---------------- A2 error 永不采样 ---------------- */

test('O4-A2 error 永不采样：配置面与运行面两道都要拦住', () => {
    /* 配置面：拒 */
    const g = createLogGate({ level: 'debug', rates: { info: 0.01 }, now: FIXED });
    const r = g.setRate('error', 0);
    assert.equal(r.ok, false);
    assert.ok(r.bad.includes('error-never-sampled'));
    assert.equal(g.stats().rates.error, 1, 'error 的采样率必须恒为 1');
    /* 运行面：info 几乎全丢，error 一条不少 */
    const msgs = seqOf(200);
    assert.ok(keptOf(g, 'info', msgs).length < 10, 'info 在 1% 采样下应远少于 10 条');
    assert.equal(keptOf(g, 'error', msgs).length, 200);
    /* 构造时就给 error:0 也要拒并记进 badRate */
    const g2 = createLogGate({ level: 'debug', rates: { error: 0 }, now: FIXED });
    assert.ok(g2.stats().badRate.includes('error-never-sampled'));
    assert.equal(keptOf(g2, 'error', seqOf(20)).length, 20);
});

/* ---------------- A3 确定性 ---------------- */

test('O4-A3 采样确定性：同序列两闸逐条一致（random 必红）', () => {
    const msgs = seqOf(120);
    const mk = () => createLogGate({ level: 'debug', rates: { info: 0.4 }, now: FIXED });
    const a = keptOf(mk(), 'info', msgs);
    const b = keptOf(mk(), 'info', msgs);
    assert.deepEqual(a, b, '同一序列两次采样必须逐条相同');
    assert.ok(a.length > 0 && a.length < msgs.length, '0.4 采样应部分保留（不是全留也不是全丢）');
    /* 刷屏稀释：同一条消息 100 次，不应全留或全丢 */
    const spam = new Array(100).fill('same-line');
    const keptSpam = keptOf(mk(), 'info', spam).length;
    assert.ok(keptSpam > 5 && keptSpam < 95, '同一条刷屏应被稀释（实测 ' + keptSpam + '/100）');
});

/* ---------------- A4 采样率可调 + 单调 ---------------- */

test('O4-A4 采样率可调：端点正确且低率集合是高率集合的子集', () => {
    const msgs = seqOf(300);
    const mk = (r) => createLogGate({ level: 'debug', rates: { info: r }, now: FIXED });
    assert.equal(keptOf(mk(0), 'info', msgs).length, 0, 'rate 0 必须一条不留');
    assert.equal(keptOf(mk(1), 'info', msgs).length, 300, 'rate 1 必须全留');
    const s30 = keptOf(mk(0.3), 'info', msgs);
    const s50 = keptOf(mk(0.5), 'info', msgs);
    const s100 = keptOf(mk(1), 'info', msgs);
    assert.ok(s30.every((m) => s50.includes(m)), '0.3 的保留集必须是 0.5 的子集（单调）');
    assert.ok(s50.every((m) => s100.includes(m)));
    assert.ok(s30.length < s50.length, '采样率变大保留数应变多');
    /* 运行时可调 */
    const g = mk(1);
    assert.equal(g.setRate('info', 0).ok, true);
    assert.equal(keptOf(g, 'info', seqOf(20)).length, 0);
    assert.equal(g.setRate('info', 'x').ok, false, '非法采样率要拒');
});

/* ---------------- A5 桥可逆 ---------------- */

test('O4-A5 桥可逆：真接管、真转发、undo 逐引用还原', () => {
    const seen = [];
    const fake = {
        log: (...a) => seen.push(['log', ...a]),
        info: (...a) => seen.push(['info', ...a]),
        warn: (...a) => seen.push(['warn', ...a]),
        error: (...a) => seen.push(['error', ...a]),
        debug: (...a) => seen.push(['debug', ...a])
    };
    const orig = { ...fake };
    const br = installConsoleBridge(fake, { level: 'info', now: FIXED });
    assert.equal(br.ok, true);
    assert.notEqual(fake.log, orig.log, '装桥后必须真接管');
    fake.log('hello');
    fake.error('bad');
    fake.debug('dbg');
    assert.deepEqual(seen, [['log', 'hello'], ['error', 'bad']], 'info/error 转发，debug 被门槛挡住');
    assert.equal(br.gate.stats().kept, 2);
    assert.equal(br.gate.stats().levelDropped, 1);
    br.undo();
    for (const k of Object.keys(orig)) assert.equal(fake[k], orig[k], 'undo 必须逐引用还原 ' + k);
    assert.equal(installConsoleBridge(null, {}).ok, false, '无目标必须 fail-closed');
});

/* ---------------- A6 三态 + 无钟 ---------------- */

test('O4-A6 三态不塌：absent/ok/unknown 各归各位，无钟不编造丢弃', () => {
    assert.equal(logGateFace({}).kind, 'absent');
    assert.equal(logGateFace(null).kind, 'absent');
    assert.ok(logGateFaceText(logGateFace({})).includes('没量过'));
    const win = { VirtualPhone: { logGate: createLogGate({ now: FIXED }) } };
    const f = logGateFace(win);
    assert.equal(f.kind, 'ok');
    assert.ok(logGateRows(f).length >= 6);
    win.VirtualPhone.logGate = { stats() { throw new Error('boom'); } };
    assert.equal(logGateFace(win).kind, 'unknown');
    assert.ok(logGateFaceText(logGateFace(win)).includes('读取失败'));
    /* 无钟：采样不可判定 ⇒ 全量放行 + 计数，绝不假装丢了 */
    const noClock = createLogGate({ level: 'debug', rates: { info: 0.01 }, bucketOf: () => null, now: FIXED });
    const msgs = seqOf(50);
    assert.equal(keptOf(noClock, 'info', msgs).length, 50, '无钟时不许按 1% 丢');
    const st = noClock.stats();
    assert.equal(st.undecidable, 50);
    assert.equal(st.sampledDropped, 0);
    assert.ok(logGateFaceText({ kind: 'ok', reason: '', stats: st }).includes('无钟'));
    /* 认不出的级别如实计数，不静默并级 */
    const g = createLogGate({ level: 'info', now: FIXED });
    g.emit('verbose', 'x');
    assert.equal(g.stats().unknownLevel, 1);
    assert.equal(g.emit('verbose', 'x').reason, 'unknown-level');
});

/* ---------------- A7 接线 ---------------- */

test('O4-A7 接线在不在：装桥留痕 / 诊断卡 / 设置项登记', () => {
    const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
    const idx = read('index.js');
    assert.ok(idx.includes('log-gate.js'), 'index.js 必须 import 日志闸');
    /* 两条分开看：只 import 不调用 / 调用了但没挂成读数面，都要红。 */
    assert.ok(/installConsoleBridge\(/.test(idx), 'index.js 必须真调用 installConsoleBridge');
    assert.ok(/window\.VirtualPhone\.logGate\s*=/.test(idx), 'index.js 必须把闸挂到 VirtualPhone.logGate');
    assert.ok(idx.includes('logGateSelfCheck'), '启动自检要留痕');
    const data = read('apps/diagnose/diagnose-data.js');
    assert.ok(data.includes('logGateFace'), '诊断数据层要取一面');
    const view = read('apps/diagnose/diagnose-view.js');
    assert.ok(view.includes('_logGateHtml'), '诊断视图要有卡片');
    const reg = read('config/settings-registry.js');
    assert.ok(reg.includes("performance.logLevel"), '设置中心要登记日志级别（可调的一处入口）');
    /* 自检本身必须绿 */
    const sc = logGateSelfCheck();
    assert.equal(sc.ok, true, JSON.stringify(sc.bad));
});

/* ---------------- 负控制：真打坏实现 ---------------- */

test('O4-N1 摘掉 error 硬保证 ⇒ A2 必红', async () => {
    /* error 永不采样在本仓是**三道**：构造期配率、setRate、emit。
     * 只打坏两道仍漏不出来（实测：第一版负控制就因此没转红）—— 三道全打掉才可能采到 error。 */
    const m = await loadBroken((s) => s.replace(
        "const rate = lv === 'error' ? 1 : state.rates[lv];",
        "const rate = state.rates[lv];"
    ).replace(
        "if (lv === 'error') return { ok: false, bad: ['error-never-sampled'], rate: 1 };",
        "if (lv === 'error') { state.rates.error = r; return { ok: true, bad: [], rate: r }; }"
    ).replace(
        "if (lv === 'error' && r < 1) { state.badRate.push('error-never-sampled'); return; }",
        "if (false) { /* 打坏：构造期不再拒 */ }"
    ).replace(
        "state.rates[lv] = lv === 'error' ? 1 : r;",
        "state.rates[lv] = r;"
    ));
    const g = m.createLogGate({ level: 'debug', rates: { error: 0 }, now: FIXED });
    const kept = seqOf(20).filter((x) => g.emit('error', x).forwarded);
    assert.equal(kept.length, 0, '打坏后 error 被采掉（若仍全留说明负控制没生效）');
    assert.equal(m.createLogGate({ now: FIXED }).setRate('error', 0).ok, true, '打坏后配置面也放行了');
});

test('O4-N2 采样换成 Math.random ⇒ A3 必红', async () => {
    const m = await loadBroken((s) => s.replace(
        'const h = fnv1a(sig + \'|\' + n);',
        'const h = Math.floor(Math.random() * 10000);'
    ));
    const msgs = seqOf(120);
    const mk = () => m.createLogGate({ level: 'debug', rates: { info: 0.4 }, now: FIXED });
    const a = msgs.filter((x) => mk().emit('info', x).forwarded);
    const b = msgs.filter((x) => mk().emit('info', x).forwarded);
    assert.notDeepEqual(a, b, '随机采样下两次结果必须不同（这正是 A3 要咬的）');
});

test('O4-N3 undo 变空函数 ⇒ A5 必红', async () => {
    const m = await loadBroken((s) => s.replace(
        'Object.keys(orig).forEach(function (k) { t[k] = orig[k]; });',
        '/* 打坏：不还原 */'
    ));
    const fake = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
    const orig = { ...fake };
    const br = m.installConsoleBridge(fake, { level: 'info', now: FIXED });
    br.undo();
    assert.notEqual(fake.log, orig.log, '打坏后 undo 不还原（若相等说明负控制没生效）');
});
