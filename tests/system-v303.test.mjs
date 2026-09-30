/**
 * tests/system-v303.test.mjs — R2-E 下游消费侧：接入上游新外供的 `outcome` [v3.0.3]
 *
 * 【跨仓纪律（本套件存在的第一理由）】
 *   上游 lonsha v3.218.0（Gate R2-E）把「被中止 / 正常完成」做成读数的 `outcome`
 *   并加进快照外供面（注入面 9 → 10 键）。按两仓纪律，**下游必须同一轮接上** ——
 *   否则又是一次「上游给了没人读」，即本仓已点名的第七次形态。
 *   故本套件把「下游真读了这一格」变成常驻判据。
 *
 * 【本版治的欠债】
 *   上游修前「被用户 Esc 中止」与「正常完成」在读数上**同形**（`GENERATION_ENDED`
 *   只复位一个标志）。下游能看到「最近一次实际注入」却读不出「这一轮到底有没有出稿」，
 *   而两者处置相反：**被中止 ⇒ 该重发；已完成 ⇒ 该看回复**。
 *   下游这一侧要做的是：把结局面读出来、单独成格、并把「被中止」送进坏消息首行
 *   （「已完成」不进首行 —— 那会把「需要用户做的事」稀释掉）。
 *
 * 【覆盖】
 *   A 结构面：出口在场 + 读出面结构恒定（含 outcome / outcomeAt / faceDrift）
 *   B 行为面：三态可分 + 「未提供」≠「pending」 + 未知结局如实输出原值 + 面漂移对账
 *   C 产品面：诊断坏消息首行（仅 aborted）+ 诊断卡 + 织光机收集器与视图真消费
 *   D 负控制：真源码破坏 → 载入破坏副本 → 重跑**同款判据**
 *   E 版本与文档面
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { copyTreeSafe } from './_mirror_tree.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const at = (rel) => pathToFileURL(path.join(ROOT, rel)).href;

const IC = 'config/injection-contract.js';
const DG_DATA = 'apps/diagnose/diagnose-data.js';
const DG_VIEW = 'apps/diagnose/diagnose-view.js';
const TW_COL = 'apps/timeweaver/timeweaver-collector.js';
const TW_VIEW = 'apps/timeweaver/timeweaver-view.js';
const IDX = 'index.js';

const IC_MOD = await import(at(IC));
const DG_MOD = await import(at(DG_DATA));
const TW_MOD = await import(at(TW_COL));

const vnum = (s) => Number(String(s).split('.').reduce((a, x) => a * 1000 + Number(x), 0));
const CURRENT = '3.0.3';

function codeOf(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
}

/* ───────────────── 夹具：上游 v3.218.0 的 injection 面（10 键） ───────────────── */
function injFace(over) {
    const base = {
        origin: 'generation', outcome: 'pending', round: 3, ts: 1000, tokens: 120, chars: 240,
        html: '[前情摘要]\n一段记忆', total: 1, kept: 1,
        blocks: [{ ref: 'inj_3_0', id: 0, label: '一段记忆', kept: true, chars: 120, reason: 'kept' }]
    };
    const out = Object.assign({}, base, over || {});
    /* 夹具缺陷修正（本套件当场捐到）：`over` 里显式写 `undefined` 时，`Object.assign`
     *   仍会把该键**建出来**（值为 undefined）⇒ `hasOwnProperty` 为真 ⇒
     *   模拟不出「旧版上游根本没这格」。而「没这格」与「这格是空」正是本判据要分的两态，
     *   故这里把显式 undefined 的键**删掉**。 */
    for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
    return out;
}
function hostWin(inj) {
    const snapshot = { meta: { fieldTypes: { injection: { present: true, kind: 'object' } } } };
    if (inj !== undefined) snapshot.injection = inj;
    return { lonsha_memory_bridge_v1: { snapshot } };
}
const readOf = (inj) => IC_MOD.readInjection(hostWin(inj));

/* ───────────────── 判据（纯函数，正负两跑） ───────────────── */

/** J-A 结局三态必须落在三个互不相同的值上，且总述文案不同 */
function jOutcomeTriad(mod) {
    const a = mod.readInjection(hostWin(injFace({ outcome: 'completed' })));
    const b = mod.readInjection(hostWin(injFace({ outcome: 'aborted' })));
    const c = mod.readInjection(hostWin(injFace({ outcome: 'pending' })));
    if (a.outcome !== 'completed' || b.outcome !== 'aborted' || c.outcome !== 'pending') {
        return { ok: false, why: '三态未如实照读：' + [a.outcome, b.outcome, c.outcome].join('/') };
    }
    const lines = [mod.injectionLine(a), mod.injectionLine(b), mod.injectionLine(c)];
    if (new Set(lines).size !== 3) return { ok: false, why: '三态总述文案同形：' + lines.join(' || ') };
    if (!/可重发|被中止/.test(lines[1])) return { ok: false, why: '「被中止」的总述未说出「该重发」：' + lines[1] };
    return { ok: true, why: '' };
}
/** J-B 「上游没给这格」≠「给了 pending」 */
function jNotProvidedNotPending(mod) {
    const missing = mod.readInjection(hostWin(injFace({ outcome: undefined })));
    if (missing.outcome !== null) return { ok: false, why: '旧版上游没这格却被读成 ' + missing.outcome };
    if (missing.faceDrift.indexOf('outcome') < 0) return { ok: false, why: '缺格必须计入 faceDrift：' + JSON.stringify(missing.faceDrift) };
    const pending = mod.readInjection(hostWin(injFace({ outcome: 'pending' })));
    if (pending.outcome !== 'pending') return { ok: false, why: '真的给了 pending 却读成 ' + pending.outcome };
    if (pending.faceDrift.length !== 0) return { ok: false, why: '给全了不该报漂移：' + JSON.stringify(pending.faceDrift) };
    if (String(mod.injectionLine(missing)) === String(mod.injectionLine(pending))) {
        return { ok: false, why: '★「上游没这格」与「给了 pending」的总述同形' };
    }
    return { ok: true, why: '' };
}
/** J-C 未知结局如实输出原值，不兜底成 pending */
function jUnknownOutcomeHonest(mod) {
    const r = mod.readInjection(hostWin(injFace({ outcome: 'zombie' })));
    if (r.outcome !== 'zombie') return { ok: false, why: '未知结局被改写：' + r.outcome };
    if (mod.outcomeText('zombie') !== 'zombie') return { ok: false, why: '未知结局文案被兜底：' + mod.outcomeText('zombie') };
    if (mod.outcomeText('') === mod.outcomeText('pending')) return { ok: false, why: '空值与 pending 共用文案（会让「没读出来」伪装成「进行中」）' };
    return { ok: true, why: '' };
}
/** J-D 诊断面：被中止进首行、已完成不进 */
function jDiagnoseBadFirst() {
    const dropped = DG_MOD.collectDiagnose(hostWin(injFace({ outcome: 'aborted' })));
    const sAbort = DG_MOD.summarizeDiagnose(dropped);
    if (!sAbort.startsWith('需注意')) return { ok: false, why: '被中止必须进总述首行：' + sAbort };
    if (!/中止/.test(sAbort)) return { ok: false, why: '首行须点名「中止」：' + sAbort };
    const ok = DG_MOD.collectDiagnose(hostWin(injFace({ outcome: 'completed' })));
    const sOk = DG_MOD.summarizeDiagnose(ok);
    if (/中止/.test(sOk)) return { ok: false, why: '「已完成」不该进坏消息首行（那会稀释需用户做的事）：' + sOk };
    return { ok: true, why: '' };
}
/** J-E 消费面：三处产品面真消费结局面（结构判据） */
function jConsumed(readFn) {
    const take = readFn || read;
    const ic = codeOf(take(IC));
    if (!/outcome:/.test(ic)) return { ok: false, why: '真源未把结局读出面' };
    if (!/export function outcomeText\(/.test(ic)) return { ok: false, why: '真源缺 outcomeText 出口' };
    const dg = codeOf(take(DG_DATA));
    if (!/inj\.outcome === 'aborted'/.test(dg)) return { ok: false, why: '诊断内核未把「被中止」判进坏消息' };
    const dgv = codeOf(take(DG_VIEW));
    if (!/outcomeText\(/.test(dgv)) return { ok: false, why: '诊断视图未渲染结局文案' };
    /* [v3.0.3] 契约快照必须在**产品面**真消费（本套件同轮由 dead-export 门禁当场捐到：
     *   `injectionFaceKeys` 建好、导出、测试也引，但产品端零消费 —— 正是本仓
     *   「建好不消费」的第八次形态）。只有测试引用不算消费，故这条判据锚在视图上。 */
    if (!/injectionFaceKeys\(/.test(dgv)) return { ok: false, why: '契约快照只在测试里被引，产品面零消费' };
    const tw = codeOf(take(TW_COL));
    if (!/outcome: r\.outcome/.test(tw)) return { ok: false, why: '织光机收集器未带出结局' };
    const twv = codeOf(take(TW_VIEW));
    if (!/inj\.outcome/.test(twv)) return { ok: false, why: '织光机视图未渲染结局' };
    return { ok: true, why: '' };
}

/* ============================================================
 * A. 结构面
 * ============================================================ */
test('v303 A1. 读出面结构恒定（含 outcome / outcomeAt / faceDrift），出口齐备', () => {
    const shape = (o) => Object.keys(o).sort().join(',');
    const base = shape(IC_MOD.readInjection({}));
    for (const s of [
        IC_MOD.readInjection({}),
        IC_MOD.readInjection({ lonsha_memory_bridge_v1: {} }),
        IC_MOD.readInjection(hostWin(null)),
        IC_MOD.readInjection(hostWin(injFace())),
        IC_MOD.readInjection(hostWin('畸形'))
    ]) assert.equal(shape(s), base, '结构必须恒定');
    assert.ok(base.includes('outcome') && base.includes('outcomeAt') && base.includes('faceDrift'),
        '结构须含结局面三格：' + base);
    for (const fn of ['outcomeText', 'injectionFaceKeys']) {
        assert.equal(typeof IC_MOD[fn], 'function', '出口缺失：' + fn);
    }
});

test('v303 A2. 跨仓契约快照：上游注入面 10 键（含 outcome）被本仓照读', () => {
    /* 与上游 tests/v3219 组 6 的「外供面带出 outcome」互为两侧：
     *   上游把它加进面，下游把它钉在契约快照里 —— 任一侧改名，两侧各有一处会红。 */
    const keys = IC_MOD.injectionFaceKeys();
    assert.deepEqual(keys.slice().sort(),
        ['blocks', 'chars', 'html', 'kept', 'origin', 'outcome', 'round', 'tokens', 'total', 'ts'].sort(),
        '上游注入面 10 键（v3.218.0 起）');
    const raw = injFace();
    assert.deepEqual(Object.keys(raw).sort(), keys.slice().sort(), '夹具必须与契约快照逐键一致');
    const r = IC_MOD.readInjection(hostWin(raw));
    assert.equal(r.outcome, 'pending', 'outcome 照读');
});

/* ============================================================
 * B. 行为面
 * ============================================================ */
test('v303 B1. 结局三态互不相同，且「被中止」的总述说出「该重发」', () => {
    const r = jOutcomeTriad(IC_MOD);
    assert.equal(r.ok, true, r.why);
});

test('v303 B2. 「上游没给这格」≠「给了 pending」（判据：jNotProvidedNotPending）', () => {
    const r = jNotProvidedNotPending(IC_MOD);
    assert.equal(r.ok, true, r.why);
});

test('v303 B3. 未知结局如实输出原值，不兜底成 pending', () => {
    const r = jUnknownOutcomeHonest(IC_MOD);
    assert.equal(r.ok, true, r.why);
    assert.equal(IC_MOD.outcomeText('completed').includes('已完成'), true);
    assert.equal(IC_MOD.outcomeText('aborted').includes('可重发'), true);
});

test('v303 B4. 诊断面：被中止进坏消息首行，「已完成」不进（判据：jDiagnoseBadFirst）', () => {
    const r = jDiagnoseBadFirst();
    assert.equal(r.ok, true, r.why);
});

test('v303 B5. 织光机：收集器带出结局，视图渲染结局', () => {
    const r = TW_MOD.collectLonshaInjection(hostWin(injFace({ outcome: 'aborted' })));
    assert.ok(r, '有宿主时不得回 null');
    assert.equal(r.outcome, 'aborted', '结局须带出');
    const view = read(TW_VIEW);
    assert.ok(view.includes("inj.outcome === 'aborted'"), '回望页须分辨被中止');
    assert.ok(view.includes('被中止'), '回望页须显示「被中止」字样');
});

test('v303 B6. 消费面判据（jConsumed）：三处产品面真消费、且是结构性接线', () => {
    const r = jConsumed();
    assert.equal(r.ok, true, r.why);
});

/* ============================================================
 * C. 负控制（真源码破坏 → 载入破坏副本 → 同款判据必须转红）
 * ============================================================ */
const ORIG = new Map();
for (const f of [IC, DG_DATA, DG_VIEW, TW_COL, TW_VIEW]) ORIG.set(f, read(f));

function mutateOnce(src, from, to) {
    const n = src.split(from).length - 1;
    assert.equal(n, 1, '锚点应恰好命中 1 次，实际 ' + n + '：' + String(from).slice(0, 80));
    return src.replace(from, to);
}
function mirror(mut) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v303-mir-'));
    copyTreeSafe(ROOT, dir, { filter: (src) => !src.split(path.sep).includes('.git') });
    for (const [rel, fn] of Object.entries(mut)) {
        const body = fn(read(rel));
        assert.notEqual(body, read(rel), '破坏未发生（锚点没命中）：' + rel);
        fs.writeFileSync(path.join(dir, rel), body);
    }
    for (const [g, src] of ORIG) {
        if (Object.prototype.hasOwnProperty.call(mut, g)) continue;
        fs.writeFileSync(path.join(dir, g), src);
    }
    return dir;
}
function withMirror(mut, fn) {
    const dir = mirror(mut);
    try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const loadMirror = (dir, rel) => import(pathToFileURL(path.join(dir, rel)).href + '?m=' + Date.now());
const readerOf = (dir) => (rel) => fs.readFileSync(path.join(dir, rel), 'utf8');

test('v303 C0. 镜像树自证 + 阳性对照：未破坏时全部判据为真（否则 C 组是假绿）', () => {
    for (const j of [jOutcomeTriad, jNotProvidedNotPending, jUnknownOutcomeHonest]) {
        const r = j(IC_MOD);
        assert.equal(r.ok, true, '原版上判据 ' + j.name + ' 必须为真：' + r.why);
    }
    assert.equal(jDiagnoseBadFirst().ok, true, '原版上诊断判据必须为真：' + jDiagnoseBadFirst().why);
    assert.equal(jConsumed().ok, true, '原版上消费面判据必须为真：' + jConsumed().why);
});

test('v303 C1. 破坏：结局三态压成一态 ⇒ 同款判据在副本上转红', async () => {
    await withMirror({
        [IC]: (s) => mutateOnce(s,
            "            outcome: (typeof raw.outcome === 'string' && raw.outcome) ? raw.outcome : null,",
            "            outcome: 'pending',   // 破坏：三态压成一态")
    }, async (dir) => {
        const mod = await loadMirror(dir, IC);
        const r = jOutcomeTriad(mod);
        assert.equal(r.ok, false, '三态被压成一态，判据却没转红');
        assert.ok(/三态未如实照读|同形/.test(r.why), '转红原因须指向真因：' + r.why);
    });
});

test('v303 C2. 破坏：缺格也读成 pending ⇒ 「没给≠给了」判据转红', async () => {
    await withMirror({
        [IC]: (s) => mutateOnce(s,
            "            faceDrift: INJECTION_FACE_KEYS.filter((k) => !Object.prototype.hasOwnProperty.call(raw, k)),",
            "            faceDrift: [],   // 破坏：不做契约对账")
    }, async (dir) => {
        const mod = await loadMirror(dir, IC);
        const r = jNotProvidedNotPending(mod);
        assert.equal(r.ok, false, '契约对账被摘掉，判据却没转红');
        assert.ok(/faceDrift/.test(r.why), '转红原因须指向真因：' + r.why);
    });
});

test('v303 C3. 破坏：未知结局兜底成 pending ⇒ 诚实性判据转红', async () => {
    await withMirror({
        [IC]: (s) => mutateOnce(s, "    return OUTCOME_TEXT[outcome] || String(outcome || '未知');",
            "    return OUTCOME_TEXT[outcome] || 'pending';   // 破坏：未知兜底成进行中")
    }, async (dir) => {
        const mod = await loadMirror(dir, IC);
        const r = jUnknownOutcomeHonest(mod);
        assert.equal(r.ok, false, '未知结局被兜底，判据却没转红');
        assert.ok(/兜底|改写/.test(r.why), '转红原因须指向真因：' + r.why);
    });
});

test('v303 C4. 破坏：诊断面不再把「被中止」判进坏消息 ⇒ 同款判据转红', async () => {
    await withMirror({
        [DG_DATA]: (s) => mutateOnce(s,
            "        if (inj.outcome === 'aborted') bad.push('最近一轮生成被中止：注入已发生但回复未产出（可重发）');",
            "        // 破坏：不再把「被中止」当坏消息")
    }, async (dir) => {
        const r = jConsumed(readerOf(dir));
        assert.equal(r.ok, false, '接线被摘掉，消费面判据却没转红');
        assert.ok(/未把「被中止」判进坏消息/.test(r.why), '转红原因须指向真因：' + r.why);
    });
});

test('v303 C5. 破坏：织光机收集器不再带出结局 ⇒ 同款判据转红', async () => {
    await withMirror({
        [TW_COL]: (s) => mutateOnce(s, '      outcome: r.outcome,\n      outcomeAt: r.outcomeAt,',
            '      // 破坏：不再带出结局')
    }, async (dir) => {
        const r = jConsumed(readerOf(dir));
        assert.equal(r.ok, false, '收集器停带结局，判据却没转红');
        assert.ok(/织光机收集器未带出结局/.test(r.why), '转红原因须指向真因：' + r.why);
    });
});

test('v303 C6. 破坏：诊断视图不再消费契约快照 ⇒ 同款判据转红（本版 dead-export 门禁捐到的形态）', async () => {
    await withMirror({
        [DG_VIEW]: (s) => mutateOnce(s, '                const faceKeys = injectionFaceKeys();',
            '                const faceKeys = [];   // 破坏：产品面不再消费契约快照')
    }, async (dir) => {
        const r = jConsumed(readerOf(dir));
        assert.equal(r.ok, false, '产品面零消费，判据却没转红');
        assert.ok(/产品面零消费/.test(r.why), '转红原因须指向真因：' + r.why);
    });
});

/* ============================================================
 * D. 版本与文档面
 * ============================================================ */
test('v303 D1. 五源同源且不低于 3.0.3', () => {
    const log = JSON.parse(read('update-log.json'));
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const m = read(IDX).match(/const ST_PHONE_VERSION = '([^']+)'/);
    assert.ok(m, 'ST_PHONE_VERSION 必须存在');
    assert.equal(log.latest, man.version, 'update-log.latest 与 manifest 同源');
    assert.equal(man.version, pkg.version, 'package 与 manifest 同源');
    assert.equal(pkg.version, m[1], '入口常量与 manifest 同源');
    assert.equal(Object.keys(log.versions)[0], log.latest, 'versions 首键即当前版本');
    assert.ok(vnum(log.latest) >= vnum(CURRENT), '不低于 ' + CURRENT + '，实得 ' + log.latest);
});

test('v303 D2. 变更说明与实现同域（提结局/中止/跨仓）+ 弹窗逐字同源', () => {
    const log = JSON.parse(read('update-log.json'));
    const entry = log.versions[log.latest];
    assert.ok(entry && Array.isArray(entry.items) && entry.items.length > 0, '当前版本节须有条目');
    /* [v3.1.0] 交棒：原判据拿 `log.latest` 的条目比「结局/中止/上游」三个词，
     *   是**当版精确判定**（本套件出生版本 v3.0.3 的说明自然写这三个词）。
     *   锚 `log.latest` 等于对以后每一版下永久约束 —— v3.1.0 的说明写的是「场所三面」，
     *   本判据随即翻红。改为仓内既定口径（同 v298-E2 / v300-D2 / v301-D2 / v302-E2）：
     *   落地项关键词锚**本套件出生版本**，而「弹窗逐字同源」那半仍锚当版。 */
    const own = log.versions['3.0.3'];
    assert.ok(own && Array.isArray(own.items), 'v3.0.3 条目必须仍在（本判据钉的是历史事实）');
    const all = own.items.join('\n');
    for (const kw of ['结局', '中止', '上游']) {
        assert.ok(all.includes(kw), '变更说明未提到本版落地项：' + kw);
    }
    assert.ok(all.includes(own.version), 'release note 须出现本版版本号');
    assert.ok(/版本升至/.test(all), '须保留「版本升至 X」的收尾条（仓内一贯格式）');
    const blk = read(IDX).match(/const ST_PHONE_CURRENT_UPDATE = \{[\s\S]*?\n\};/);
    assert.ok(blk, 'ST_PHONE_CURRENT_UPDATE 可提取');
    for (const item of entry.items) {
        assert.ok(blk[0].includes(JSON.stringify(item)), '弹窗 items 逐字同源：' + item.slice(0, 24) + '…');
    }
    assert.match(blk[0], new RegExp('date: "' + entry.date + '"'), 'date 同源');
    const iter = read('ITERATION_LOG.md');
    const mm = /- \*\*当前版本\*\*：`([0-9.]+)`/.exec(iter);
    assert.ok(mm, '迭代日志元信息须有「当前版本」一行');
    assert.equal(mm[1], JSON.parse(read('manifest.json')).version, '迭代日志元信息与 manifest 不一致（文档已腐坏）');
    assert.ok(iter.includes('迭代 35'), '本版迭代段未登记');
});