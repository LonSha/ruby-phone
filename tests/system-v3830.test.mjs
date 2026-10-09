/* ============================================================
 * tests/system-v3830.test.mjs — 计划 R-O7 诊断处置面 [v3.83.0]
 * ------------------------------------------------------------
 * 本版把诊断从「有读数」推进到「能处置」。修前的实测处境（逐条核对，不是推演）：
 *   · `empty`（面在、值为空）与 `absent`（面根本不在）在页面上**同形**，
 *     用户会在「本来就没有」的项上反复排查一个不存在的问题；
 *   · 「读取失败」只给一句话，不说**哪一段断的、影响什么、能不能重试、
 *     要不要切宿主、要不要用户拍板** —— 而这五项恰恰决定下一步做什么；
 *   · 同一件事故在不同页面上各写各的字符串，检索不到一起；
 *   · 世界书写入的结论**没有回执**留档：诊断无从判断「上一次写成功了没有」。
 *
 * 本套件守五件事：
 *   A 结构面：处置面真源在场、五态常量与失败五项齐备、诊断内核真取这一面；
 *   B 行为面：五态互不同形 / 失败缺项即拒判 / 码面自证 / 一步跳转的判据；
 *   C 接线面：真跑 `collectDiagnose`（处置面必须真被取到）；
 *             真跑 `WorldbookManager.writeMemoryEntries` 并把 **真回执**读回来
 *             （这是「读数必须来自生产 trace 或真实回执」的落地）；
 *   D 负控制：真源码定点破坏 → 破坏副本 → 在副本上重跑同款判据；
 *   E 版本锚（下限形）。
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const mod = async (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const M_ACTION = 'config/diagnose-action.js';
const A_DIAG = 'apps/diagnose/diagnose-data.js';
const A_VIEW = 'apps/diagnose/diagnose-view.js';
const M_WB = 'config/worldbook-manager.js';

const DA = await mod(M_ACTION);
const DIAG = await mod(A_DIAG);
const WB = await mod(M_WB);

/* ══════════════════ 判据函数（负控制必须复用**同一份**） ══════════════════ */

/** R-O7-① 五态互不同形：五种输入必须给出五个不同的读数。 */
function jFiveStates(m) {
    const cases = [
        m.buildDisposal({ domain: 'storage', symptom: 'write-failed' }),                       // empty
        m.buildDisposal({ domain: 'storage', symptom: 'write-failed', unknown: true }),        // unknown
        m.buildDisposal({ domain: 'storage', symptom: 'write-failed', present: false }),       // absent
        m.buildDisposal({
            domain: 'storage', symptom: 'write-failed', failed: true,
            stage: '写回', scope: '本地存储', retry: true, hostSwitch: false, needConfirm: false
        }),                                                                                    // failed
        m.buildDisposal({ domain: 'storage', symptom: 'write-failed', partial: true })          // partial
    ];
    const states = cases.map((c) => c.state);
    if (new Set(states).size !== 5) return { ok: false, why: '五态塌格：' + JSON.stringify(states) };
    const lines = cases.map((c) => m.disposalLine(c));
    if (new Set(lines).size !== 5) return { ok: false, why: '五态的一行读数同形：' + JSON.stringify(lines) };
    return { ok: true, why: '' };
}

/** R-O7-② 判据顺序本身就是口径：`失败` 优先于 `缺席`，`部分成功` 优先于 `缺席`。 */
function jStatePrecedence(m) {
    const a = m.buildDisposal({
        domain: 'finance', symptom: 'commit-rejected', failed: true, present: false,
        stage: '提交', scope: '财务落账', retry: false, hostSwitch: false, needConfirm: true
    });
    if (a.state !== 'failed') return { ok: false, why: '失败与缺席同时给真时没取失败：' + a.state };
    const b = m.buildDisposal({ domain: 'finance', symptom: 'commit-rejected', partial: true, present: false });
    if (b.state !== 'partial') return { ok: false, why: '部分成功与缺席同时给真时没取部分成功：' + b.state };
    return { ok: true, why: '' };
}

/** R-O7-③ 失败五项缺一即拒判（缺项等于让用户自己去猜）。 */
function jFailNeedsFiveFields(m) {
    const full = m.buildDisposal({
        domain: 'search', symptom: 'index-aborted', failed: true,
        stage: '索引', scope: '全局搜索', retry: true, hostSwitch: false, needConfirm: false
    });
    if (!full.ok) return { ok: false, why: '五项齐全却被判不完整：' + full.why };
    const missing = m.buildDisposal({
        domain: 'search', symptom: 'index-aborted', failed: true,
        stage: '索引', scope: '全局搜索', retry: true
    });
    if (missing.ok) return { ok: false, why: '缺两项仍被判完整' };
    if (!/失败读数的五项必答缺/.test(missing.why)) return { ok: false, why: '缺项没逐条点名：' + missing.why };
    if (!/失败读数不完整/.test(m.disposalLine(missing))) {
        return { ok: false, why: '一行读数没把「不完整」说出来：' + m.disposalLine(missing) };
    }
    return { ok: true, why: '' };
}

/** R-O7-④ 域与码面：域外即拒；码面是 `域.现象` 两段式且不接受自造串。 */
function jDomainAndCode(m) {
    const out = m.buildDisposal({ domain: '随口一个域', symptom: 'anything' });
    if (out.ok) return { ok: false, why: '域不在登记表内却判为 ok' };
    if (out.code) return { ok: false, why: '域外却给出了码：' + out.code };
    if (m.codeOf('storage', 'Write Failed')) return { ok: false, why: '非法现象串（含大写与空格）却给出了码' };
    if (m.codeOf('storage', 'write-failed') !== 'storage.write-failed') {
        return { ok: false, why: '合法码面没生成两段式码' };
    }
    const self = m.codeTableSelfCheck(m.CODE_TABLE);
    if (!self.ok) return { ok: false, why: '码表自证报问题：' + self.problems.join('；') };
    if (self.count < m.DIAG_DOMAINS.length) return { ok: false, why: '码面数少于域数（有域是空表）' };
    /* 空表必须**说出来**，不许静默当全合规 */
    const empty = m.codeTableSelfCheck({});
    if (empty.ok) return { ok: false, why: '空码表被判合规（「没登记」与「全合规」同形）' };
    if (empty.problems.length < m.DIAG_DOMAINS.length) return { ok: false, why: '空码表没逐域点名' };
    return { ok: true, why: '' };
}

/** R-O7-⑤ 一步到处置入口：有入口即可跳；没有必须说清原因。 */
function jJumpable(m) {
    const withAction = m.buildDisposal({
        domain: 'injection', symptom: 'all-dropped', failed: true,
        stage: '预算裁剪', scope: '注入上下文', retry: true, hostSwitch: false, needConfirm: false,
        action: { appId: 'settings' }
    });
    const j1 = m.canJump(withAction);
    if (!j1.ok) return { ok: false, why: '有 appId 却说跳不过去：' + j1.why };
    const noAction = m.buildDisposal({ domain: 'storage', symptom: 'write-failed' });
    const j2 = m.canJump(noAction);
    if (j2.ok) return { ok: false, why: '没有入口却说能跳' };
    if (!j2.why) return { ok: false, why: '跳不过去却没给原因（用户会以为是按钮坏了）' };
    return { ok: true, why: '' };
}

/* ══════════════════ A 结构面 ══════════════════ */

test('v3830 A1. 处置面真源在场：五态 / 失败五项 / 域 / 码表 / 五个出口齐备', () => {
    assert.ok(fs.existsSync(path.join(ROOT, M_ACTION)), '真源必须在场：' + M_ACTION);
    const src = read(M_ACTION);
    for (const name of ['DIAG_STATES', 'FAIL_FIELDS', 'DIAG_DOMAINS', 'CODE_TABLE',
        'codeOf', 'stateOf', 'buildDisposal', 'disposalLine', 'canJump', 'codeTableSelfCheck']) {
        assert.match(src, new RegExp('export (function |const )?' + name + '\\b'), M_ACTION + ' 缺导出：' + name);
    }
    assert.equal(DA.DIAG_STATES.EMPTY, 'empty');
    assert.equal(DA.DIAG_STATES.UNKNOWN, 'unknown');
    assert.equal(DA.DIAG_STATES.ABSENT, 'absent');
    assert.equal(DA.DIAG_STATES.FAILED, 'failed');
    assert.equal(DA.DIAG_STATES.PARTIAL, 'partial');
    assert.equal(DA.FAIL_FIELDS.length, 5, '失败必答项必须恰五项（计划原文点名）');
    for (const id of ['stage', 'scope', 'retry', 'hostSwitch', 'needConfirm']) {
        assert.ok(DA.FAIL_FIELDS.some((f) => f.id === id), '失败必答项缺：' + id);
    }
});

test('v3830 A2. 诊断内核真取这一面，且有一行读数出口（视图不自拼）', () => {
    const diag = read(A_DIAG);
    assert.match(diag, /import \{ DIAG_STATES, DIAG_DOMAINS, CODE_TABLE, buildDisposal, disposalLine, canJump, codeTableSelfCheck \} from '\.\.\/\.\.\/config\/diagnose-action\.js'/,
        '诊断内核必须引用处置面真源');
    assert.match(diag, /const disposalFace = \(\(\) => \{/, '诊断内核必须真取这一面');
    assert.match(diag, /export function disposalFaceText\(/, '必须有一行读数出口');
    const view = read(A_VIEW);
    assert.match(view, /_disposalHtml\(pkg\)/, '视图必须真排版这一面');
    assert.match(view, /disposalFaceText\(face\)/, '视图的文案必须来自内核转发（不自拼结论）');
});

/* ══════════════════ B 行为面 ══════════════════ */

test('v3830 B1. 五态互不同形 + 判据顺序 + 失败五项拒判', () => {
    for (const [name, fn] of [['五态', jFiveStates], ['顺序', jStatePrecedence],
        ['失败五项', jFailNeedsFiveFields], ['域与码面', jDomainAndCode], ['一步跳转', jJumpable]]) {
        const r = fn(DA);
        assert.equal(r.ok, true, 'R-O7 判据「' + name + '」不成立：' + r.why);
    }
});

test('v3830 B2. 计划原文点名的三种情形文案不同形（无数据 / 读取失败 / 模块不存在）', () => {
    const empty = DA.buildDisposal({ domain: 'search', symptom: 'empty-query' });
    const absent = DA.buildDisposal({ domain: 'search', symptom: 'empty-query', present: false });
    const failed = DA.buildDisposal({
        domain: 'search', symptom: 'source-threw', failed: true,
        stage: '取数', scope: '搜索来源', retry: true, hostSwitch: true, needConfirm: false
    });
    const lines = [DA.disposalLine(empty), DA.disposalLine(absent), DA.disposalLine(failed)];
    assert.equal(new Set(lines).size, 3, '三种情形文案同形：' + JSON.stringify(lines));
    assert.match(lines[0], /值为空/, '「没有数据」必须说清是「面在、值为空」');
    assert.match(lines[1], /这一面不在/, '「模块不存在」必须说清是「这一面不在」');
    assert.match(lines[2], /失败/, '「读取失败」必须说失败');
    assert.match(lines[2], /可重试/, '失败必须给出可否重试');
    assert.match(lines[2], /需切宿主/, '失败必须给出是否需切宿主');
});

/* ══════════════════ C 接线面（真跑产品路径） ══════════════════ */

test('v3830 C1. 真跑 collectDiagnose：处置面必须真被取到且五态齐备', () => {
    const ctx = DIAG.collectDiagnose({}, { get: () => null, set: () => {} });
    const face = ctx && ctx.disposalFace;
    assert.ok(face, 'disposalFace 必须真的被取到（null 即接线断了）');
    assert.equal(face.ok, true, '处置面自检必须通过：' + JSON.stringify(face.problems));
    assert.equal(face.domains, DA.DIAG_DOMAINS.length, '域数必须与真源一致');
    assert.ok(face.codes >= DA.DIAG_DOMAINS.length, '码面数必须不少于域数：' + face.codes);
    for (const s of Object.values(DA.DIAG_STATES)) {
        assert.equal(typeof face.counts[s], 'number', '五态计数缺一态：' + s);
    }
    assert.ok(Array.isArray(face.items) && face.items.length >= 5, '处置项至少覆盖五个域：' + (face.items || []).length);
    const text = DIAG.disposalFaceText(face);
    assert.match(text, /需要动的/, '一行读数必须说出「需要动」的项数：' + text);
    assert.match(DIAG.disposalFaceText(null), /读不到/, '面缺席必须说读不到');
    assert.notEqual(DIAG.disposalFaceText(null), text, '缺席态与就绪态不许同形');
});

test('v3830 C2. 世界书写入的真回执：诊断读到的必须是**真发生过**的那一次', async () => {
    const wm = new WB.WorldbookManager({ get: () => null, set: () => {} });
    assert.equal(wm._lastWriteReceipt, undefined, '前提：还没有人写过就没有回执');
    /* 真跑一次成功写入（桩宿主） */
    const existing = { entries: { 0: { uid: 0, comment: '用户手写', content: '用户自己写的设定' } } };
    wm._loadWorldInfoViaFrontendModule = async () => existing;
    let saved = null;
    wm._saveWorldInfo = async (name, data) => { saved = { name, data }; return true; };
    wm._refreshWorldInfoCache = async () => true;
    const ok = await wm.writeMemoryEntries('测试世界书', [{ comment: '新事', content: '这一轮写下的事' }]);
    assert.equal(ok.ok, true, '写入应成功：' + JSON.stringify(ok));
    const receipt = wm._lastWriteReceipt;
    assert.ok(receipt && typeof receipt === 'object', '成功写入必须留下真回执');
    assert.equal(receipt.ok, true, '回执必须如实报成功');
    assert.equal(receipt.reason, 'ok', '回执必须带原因');
    assert.ok(Number.isFinite(receipt.at), '回执必须带时刻（否则「上一次」无从谈）');
    /* 真跑一次失败写入：回执必须翻转 */
    wm._saveWorldInfo = async () => false;
    const bad = await wm.writeMemoryEntries('测试世界书', [{ comment: 'x', content: '另一条全新的内容' }]);
    assert.equal(bad.ok, false, '写盘失败必须如实报失败');
    assert.equal(wm._lastWriteReceipt.ok, false, '回执没有跟着翻转（诊断会读到旧的成功）');
    assert.equal(wm._lastWriteReceipt.reason, 'write-failed', '回执的原因必须分得开：' + wm._lastWriteReceipt.reason);
});

/* ══════════════════ D 负控制（真源码破坏 → 破坏副本 → 同款判据） ══════════════════ */
const NEG_SUFFIX = '.__neg__.js';
const madeFiles = [];
function negCopy(rel, mutate) {
    const srcAbs = path.join(ROOT, rel);
    const dstRel = rel.replace(/\.js$/, NEG_SUFFIX);
    const dstAbs = path.join(ROOT, dstRel);
    const src = fs.readFileSync(srcAbs, 'utf8');
    const next = mutate(src);
    assert.notEqual(next, src, '破坏没有真正发生（锚点未命中）：' + rel);
    fs.writeFileSync(dstAbs, next);
    madeFiles.push(dstAbs);
    return import(pathToFileURL(dstAbs).href + '?neg=' + Date.now());
}
process.on('exit', () => {
    for (const f of madeFiles) { try { fs.rmSync(f); } catch (_e) { /* 忽略 */ } }
});

test('v3830 D1. 把「面不在」并进「值为空」（absent 塌成 empty）⇒ 五态判据必须转红', async () => {
    const neg = await negCopy(M_ACTION, (s) => {
        const anchor = "    if (input.present === false) return DIAG_STATES.ABSENT;";
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, '    if (false) return DIAG_STATES.ABSENT;');
    });
    const good = jFiveStates(DA);
    assert.equal(good.ok, true, '原版必须真过：' + good.why);
    const broke = jFiveStates(neg);
    assert.equal(broke.ok, false, '缺席塌成空之后五态判据必须转红');
});

test('v3830 D2. 失败五项不再必答（缺项也判 ok）⇒ 拒判判据必须转红', async () => {
    const neg = await negCopy(M_ACTION, (s) => {
        const anchor = '        if (missing.length) problems.push(';
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, '        if (false) problems.push(');
    });
    const good = jFailNeedsFiveFields(DA);
    assert.equal(good.ok, true, '原版必须真过：' + good.why);
    const broke = jFailNeedsFiveFields(neg);
    assert.equal(broke.ok, false, '缺项被纵容之后判据必须转红');
});

test('v3830 D3. 码面不再校验（域外也给码）⇒ 域与码面判据必须转红', async () => {
    const neg = await negCopy(M_ACTION, (s) => {
        const anchor = "    if (!DOMAIN_SET.has(d)) return '';";
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, "    if (false) return '';");
    });
    const good = jDomainAndCode(DA);
    assert.equal(good.ok, true, '原版必须真过：' + good.why);
    const broke = jDomainAndCode(neg);
    assert.equal(broke.ok, false, '域外也给码之后判据必须转红');
});

test('v3830 D4. 空码表被判合规（`没登记`塌成`全合规`）⇒ 自证判据必须转红', async () => {
    const neg = await negCopy(M_ACTION, (s) => {
        const anchor = "        if (!list.length) problems.push('域 ' + domain + ' 没有登记任何码面');";
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, '        if (false) problems.push(String(domain));');
    });
    const good = jDomainAndCode(DA);
    assert.equal(good.ok, true, '原版必须真过：' + good.why);
    const broke = jDomainAndCode(neg);
    assert.equal(broke.ok, false, '空码表被当合规之后判据必须转红');
});

test('v3830 D5. 写回回执不再留档 ⇒ 「真回执」判据必须转红', async () => {
    const neg = await negCopy(M_WB, (s) => {
        const anchor = '            this._lastWriteReceipt = Object.assign({ at: Date.now() }, result);';
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, '            void result;');
    });
    const negWB = await import(pathToFileURL(path.join(ROOT, M_WB.replace(/\.js$/, NEG_SUFFIX))).href + '?neg=' + Date.now());
    const wm = new negWB.WorldbookManager({ get: () => null, set: () => {} });
    wm._loadWorldInfoViaFrontendModule = async () => ({ entries: {} });
    wm._saveWorldInfo = async () => true;
    wm._refreshWorldInfoCache = async () => true;
    await wm.writeMemoryEntries('测试世界书', [{ comment: '新事', content: '这一轮写下的事' }]);
    assert.equal(wm._lastWriteReceipt, undefined,
        '回执不再留档之后，同款判据必须能观察到「没有回执」（否则它测的不是这件事）');
});

/* ══════════════════ E 版本锚（下限形） ══════════════════ */

test('v3830 E1. 版本锚（下限形）：五源同源且不低于 3.83.0', () => {
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const idx = read('index.js');
    const log = JSON.parse(read('update-log.json'));
    const m = /const ST_PHONE_VERSION = '([0-9.]+)'/.exec(idx);
    assert.ok(m, 'index.js 必须仍有版本常量');
    const nums = [man.version, pkg.version, m[1], log.latest, log.head].map(String);
    assert.equal(new Set(nums).size, 1, '五源版本必须同源：' + nums.join(' / '));
    const cmp = (a, b) => {
        const x = String(a).split('.').map(Number);
        const y = String(b).split('.').map(Number);
        for (let i = 0; i < 3; i += 1) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); }
        return 0;
    };
    assert.ok(cmp(nums[0], '3.83.0') >= 0, '版本不得低于 3.83.0（本版是它的落地版）：' + nums[0]);
    const entry = log.versions && log.versions[log.latest];
    assert.ok(entry, '当版条目必须在 update-log 里');
});