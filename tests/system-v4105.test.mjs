// tests/system-v4105.test.mjs — 撤销能力声明面 + 销毁二次确认（唯一实现）[v4.105.0 · 第十三期 R13-O2]
//
// 本套件守五件事：
//   ① A 面 声明面自洽：89 条声明与 `config/apps.js` 的 APPS **双向**对账（条数 / id 集合 /
//      中文名逐字一致），三档计数 = 11 / 19 / 59，每条 why 非空且不得写「不适用」；
//      未知 appId 必须按最保守口径（irreversible + unknown:true），不伪造一个「可撤销」。
//   ② B 面 声明 ↔ 磁盘事实对账（本套件的核心）：undo 档的 App 目录里**必须**真的出现
//      `recycleBin.registerRestorer(`；confirm 档**必须**真的出现 `confirmDestroy(`；
//      irreversible 档**两者都不许**出现。若只验声明表自洽，那就是同源自述、必然恒绿。
//   ③ C 面 文案同源：`describeDestroy` 的可撤销性**只认声明面** —— 调用方传
//      `undoable:true` 也不许把一个 irreversible 的 App 说成可恢复（调用方只想少弹一个框）。
//      并守降级纪律：拿不到用户意志（无 confirm 宿主 / confirm 自己抛）时一律不放行。
//   ④ D 面 产品面接线：诊断中心真消费声明面与文案面（防「内核写好了、导出挂出来了、
//      产品端零消费」——本仓治过六次的同一形态），且不能只是字样在场。
//   ⑤ E 面 负控制：**真源码破坏 → 落副本 → 在副本上重跑同款真判据**，四向必须转红
//      （保守回退被删 / 文案改口 / 声明档位改错 / 诊断中心停掉出口）。
//      破坏锚点必须恰中 1 次（不唯一即抛）；破坏只落临时副本，真仓全程只读。
//
// 判据纪律（本仓硬纪律）：判据不许恒绿；破坏只落临时副本；真仓全程只读；
//   负控制必须「真源码破坏 → 加载破坏副本 → 在副本上跑同款真判据」，不许把破坏写成常量。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const UNDO_REL = 'config/undo-capability.js';
const CONF_REL = 'config/destructive-confirm.js';
const APPS_REL = 'config/apps.js';
const DIAG_REL = 'apps/diagnose/diagnose-data.js';
const DIAGV_REL = 'apps/diagnose/diagnose-view.js';

const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const UNDO = await import('../config/undo-capability.js');
const CONF = await import('../config/destructive-confirm.js');
const APPS_MOD = await import('../config/apps.js');

const APPS = Array.isArray(APPS_MOD.APPS) ? APPS_MOD.APPS : [];
const APP_IDS = APPS.map((a) => String(a.id || ''));
const APP_NAME = new Map(APPS.map((a) => [String(a.id || ''), String(a.name || '')]));

/** 一个目录承载两件 App 的那一处（目录口径会漏 graph —— system-v3550 首版踩过的坑） */
const DIR_OVERRIDE = { graph: 'memory' };

/** App 目录下的全部 .js（递归一层：apps/<dir>/ 下平铺） */
function appJs(dirId) {
    const dir = path.join(ROOT, 'apps', DIR_OVERRIDE[dirId] || dirId);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => path.join(dir, f));
}

/** 目录里是否出现某个字面（逐文件读，命中即返 —— 只要一处就够） */
function dirHas(dirId, needle) {
    for (const f of appJs(dirId)) {
        if (fs.readFileSync(f, 'utf8').indexOf(needle) >= 0) return true;
    }
    return false;
}

/** 目录里某字面出现的总次数（用于 confirm 档的「至少插了几处」下限判据） */
function dirCount(dirId, needle) {
    let n = 0;
    for (const f of appJs(dirId)) {
        const s = fs.readFileSync(f, 'utf8');
        n += s.split(needle).length - 1;
    }
    return n;
}

/* ============================================================
 * A 面 声明面自洽
 * ============================================================ */

test('A1 声明条数 = APPS 条数，id 集合双向相等，无重复无占位', () => {
    assert.equal(APPS.length, 89, 'APPS 真源应当是 89 件（本版基线；变了就要同步声明表）');
    const decl = UNDO.UNDO_DECLARATIONS;
    assert.equal(decl.length, 89, '★ 声明必须一条一 App（目录 88 ≠ App 89：apps/memory 承载 memory + graph）');
    const ids = decl.map((d) => String(d.appId));
    assert.equal(new Set(ids).size, 89, 'appId 不许重复（重复会让 undoModeCounts 多算一件）');
    const missing = APP_IDS.filter((id) => !ids.includes(id));
    const extra = ids.filter((id) => !APP_IDS.includes(id));
    assert.deepEqual(missing, [], '★ APPS 里有而声明里没有的 App：' + missing.join(' / '));
    assert.deepEqual(extra, [], '★ 声明里有而 APPS 里没有的 id（含占位条）：' + extra.join(' / '));
});

test('A2 中文名与 APPS 逐字一致（声明面不许自造一套名字）', () => {
    for (const d of UNDO.UNDO_DECLARATIONS) {
        assert.equal(String(d.name), APP_NAME.get(String(d.appId)),
            '★ ' + String(d.appId) + ' 的 name 与 APPS 不一致：声明「' + String(d.name)
            + '」vs 真源「' + String(APP_NAME.get(String(d.appId))) + '」');
    }
});

test('A3 每条 why 非空、不得是「不适用」，且档位只能是三档之一', () => {
    const ok = new Set(UNDO.UNDO_MODE_ORDER);
    for (const d of UNDO.UNDO_DECLARATIONS) {
        const why = String(d.why || '').trim();
        assert.ok(why.length >= 8, '★ ' + String(d.appId) + ' 的 why 太短（等于没说）：' + why);
        assert.equal(why.includes('不适用'), false,
            '★ ' + String(d.appId) + ' 的 why 写了「不适用」—— 本档存在的意义就是逐条说清为什么');
        assert.equal(ok.has(String(d.mode)), true, '★ ' + String(d.appId) + ' 的 mode 不在三档内：' + String(d.mode));
    }
});

test('A4 三档计数 = 11 / 19 / 59（读数写死，变动必须是有意识的）', () => {
    const c = UNDO.undoModeCounts();
    assert.equal(c.total, 89);
    assert.equal(c.undo, 11, 'undo 档 = 接了回收站的 11 件');
    assert.equal(c.confirm, 19, 'confirm 档 = 本版补齐二次确认的 19 件');
    assert.equal(c.irreversible, 59, 'irreversible 档 = 如实记账的 59 件（含 4 件「全目录零破坏性入口」）');
    assert.equal(c.undo + c.confirm + c.irreversible, c.total);
});

test('A5 未知 appId 按最保守口径：irreversible + unknown 标记，绝不伪造可撤销', () => {
    const r = UNDO.undoCapabilityOf('no_such_app_xyz');
    assert.equal(r.mode, 'irreversible', '★ 拿不到声明时必须按最保守处理（说它能撤销才是真危险）');
    assert.equal(r.unknown, true, '★ 必须带 unknown 标记，否则 UI 无从区分「声明为不可撤销」与「根本没声明」');
    assert.equal(UNDO.undoDeclarationOf(''), null, '空 id 不返回任何声明');
    assert.equal(UNDO.undoDeclarationOf('no_such_app_xyz'), null);
});

test('A6 一句话总述带三档数字（UI 与判据共用，不许第二份实现）', () => {
    const line = UNDO.undoSummaryLine();
    assert.ok(line.includes('89'), line);
    assert.ok(line.includes('11') && line.includes('19') && line.includes('59'), line);
});

/* ============================================================
 * B 面 声明 ↔ 磁盘事实对账（核心：只验声明表自洽就是同源自述）
 * ============================================================ */

test('B1 undo 档 11 件的目录里必须真的出现 recycleBin.registerRestorer(', () => {
    const claims = UNDO.UNDO_DECLARATIONS.filter((d) => d.mode === 'undo').map((d) => String(d.appId));
    assert.equal(claims.length, 11);
    const bad = claims.filter((id) => !dirHas(id, 'recycleBin.registerRestorer('));
    assert.deepEqual(bad, [], '★ 声明说「删了能回来」但磁盘上没有恢复器：' + bad.join(' / '));
});

test('B2 反过来也要成立：磁盘上有恢复器的 App 必须都声明成 undo（不许漏声明）', () => {
    const onDisk = APP_IDS.filter((id) => dirHas(id, 'recycleBin.registerRestorer('));
    const claimed = UNDO.UNDO_DECLARATIONS.filter((d) => d.mode === 'undo').map((d) => String(d.appId));
    const undeclared = onDisk.filter((id) => !claimed.includes(id));
    assert.deepEqual(undeclared, [], '★ 接了回收站却没声明成 undo：' + undeclared.join(' / ')
        + '（这份声明面就没意义了）');
});

test('B3 confirm 档 19 件的目录里必须真的出现 confirmDestroy(，且插入点不少于 38 处', () => {
    const claims = UNDO.UNDO_DECLARATIONS.filter((d) => d.mode === 'confirm').map((d) => String(d.appId));
    assert.equal(claims.length, 19);
    const bad = claims.filter((id) => !dirHas(id, 'confirmDestroy('));
    assert.deepEqual(bad, [], '★ 声明说「每个销毁入口都问了」但磁盘上没有守卫：' + bad.join(' / '));
    const total = claims.reduce((n, id) => n + dirCount(id, 'confirmDestroy('), 0);
    /* 用下限而不是等号：后续版本可能给同一 App 加更多入口（那时应当只增不改判据）；
     * 减少则意味着守卫被删掉了 —— 这正是本判据要抓的。 */
    assert.ok(total >= 38, '★ 19 件 App 的守卫总数必须不少于本版插入的 38 处，实测 ' + String(total));
});

test('B4 反过来也要成立：磁盘上有 confirmDestroy( 的 App 必须都声明成 confirm 或 undo', () => {
    const onDisk = APP_IDS.filter((id) => dirHas(id, 'confirmDestroy('));
    const claimed = UNDO.UNDO_DECLARATIONS.filter((d) => d.mode === 'confirm').map((d) => String(d.appId));
    const undeclared = onDisk.filter((id) => !claimed.includes(id));
    assert.deepEqual(undeclared, [], '★ 加了二次确认却没进声明面：' + undeclared.join(' / '));
});

test('B5 irreversible 档两者都不许有（既没恢复器也没守卫 —— 这才是「残留账」的定义）', () => {
    const irr = UNDO.UNDO_DECLARATIONS.filter((d) => d.mode === 'irreversible').map((d) => String(d.appId));
    const wrongRestorer = irr.filter((id) => dirHas(id, 'recycleBin.registerRestorer('));
    const wrongConfirm = irr.filter((id) => dirHas(id, 'confirmDestroy('));
    assert.deepEqual(wrongRestorer, [], '★ 这些 App 接了回收站却声明成不可撤销：' + wrongRestorer.join(' / '));
    assert.deepEqual(wrongConfirm, [], '★ 这些 App 有二次确认却声明成未确认：' + wrongConfirm.join(' / '));
});

test('B6 「无自有销毁入口」的四个 App 必须真的查不出破坏性符号（不是查不出来就算过）', () => {
    /* 这四个是本轮新增的声明（graph / clock / usage / timeweaver）。它们的 why 都写着
     *   「全目录零破坏性入口」—— 这句话必须能被磁盘复算，否则就是自述。 */
    const ids = ['clock', 'usage', 'timeweaver'];
    for (const id of ids) {
        const files = appJs(id);
        assert.ok(files.length > 0, id + ' 目录下必须存在 .js 文件（查不出 ≠ 目录不存在）');
        const hits = files.filter((f) => {
            const s = fs.readFileSync(f, 'utf8');
            return s.indexOf('recycleBin.registerRestorer(') >= 0 || s.indexOf('confirmDestroy(') >= 0;
        });
        assert.deepEqual(hits, [], '★ ' + id + ' 声明为「无入口」，但磁盘上出现了销毁接线：' + hits.join(' / '));
    }
    /* graph 与 memory 共用 apps/memory：graph 自己的三件必须干净（memory 那几件不算 graph 的） */
    const gdir = path.join(ROOT, 'apps', 'memory');
    const gFiles = ['graph-app.js', 'graph-bridge.js', 'graph-view.js'].map((f) => path.join(gdir, f));
    for (const f of gFiles) {
        assert.ok(fs.existsSync(f), '★ graph 的三件必须真的存在：' + f);
        const s = fs.readFileSync(f, 'utf8');
        assert.equal(s.indexOf('recycleBin.registerRestorer('), -1, '★ graph 自己不该有恢复器：' + f);
        assert.equal(s.indexOf('confirmDestroy('), -1, '★ graph 自己不该有守卫：' + f);
    }
});

/* ============================================================
 * C 面 文案同源与降级纪律
 * ============================================================ */

test('C1 undo 档的文案必须指出「设置 → 回收站」（否则用户不知道去哪找回来）', () => {
    const d = CONF.describeDestroy({ appId: 'diary', action: '删除日记', what: '正文与配图' });
    assert.equal(d.recoverable, true);
    assert.ok(String(d.text).includes('回收站'), d.text);
    assert.ok(String(d.text).includes('设置'), d.text);
});

test('C2 ★ 可撤销性只认声明面：调用方传 undoable:true 也不许给不可撤销盖章', () => {
    const d = CONF.describeDestroy({ appId: 'archive', action: '删除存档', what: '整包', undoable: true });
    assert.equal(d.recoverable, false, '★ 调用方只想少弹一个框 —— 声明面才是复算过的事实');
    assert.ok(String(d.text).includes('不可撤回'), d.text);
});

test('C3 count 只有有效正数才拼进文案（0 / 负数 / NaN 一律不出现「共 0 项」）', () => {
    const a = CONF.describeDestroy({ appId: 'annidate', action: '清空', count: 3 });
    assert.ok(String(a.text).includes('共 3 项'), a.text);
    for (const bad of [0, -1, NaN, null, 'x']) {
        const r = CONF.describeDestroy({ appId: 'annidate', action: '清空', count: bad });
        assert.equal(String(r.text).includes('共'), false, 'count=' + String(bad) + ' 不该拼进文案：' + r.text);
    }
});

test('C4 降级纪律：没有 confirm 宿主时一律不放行（assumeConfirm 是测试专用口子）', () => {
    const saved = globalThis.window;
    try {
        delete globalThis.window;
        assert.equal(CONF.hasNativeConfirm(), false);
        assert.equal(CONF.confirmDestroy({ appId: 'diary', action: '删除' }), false,
            '★「确认框弹不出来」不等于「用户同意了」—— 拿不到意志就不执行破坏性动作');
        assert.equal(CONF.confirmDestroy({ appId: 'diary', action: '删除', assumeConfirm: true }), true,
            'assumeConfirm 是测试专用放行口，仅此一处可用');
    } finally {
        if (saved !== undefined) globalThis.window = saved;
    }
});

test('C5 有宿主时按用户意志走；confirm 自己抛 ⇒ 视同没同意（fail-closed）', () => {
    const saved = globalThis.window;
    try {
        globalThis.window = { confirm: () => true };
        assert.equal(CONF.confirmDestroy({ appId: 'archive', action: '删除' }), true);
        globalThis.window = { confirm: () => false };
        assert.equal(CONF.confirmDestroy({ appId: 'archive', action: '删除' }), false);
        globalThis.window = { confirm: () => { throw new Error('boom'); } };
        assert.equal(CONF.confirmDestroy({ appId: 'archive', action: '删除' }), false,
            '★ 确认框自己抛必须当「没拿到同意」，不许当同意');
    } finally {
        if (saved === undefined) delete globalThis.window;
        else globalThis.window = saved;
    }
});

/* ============================================================
 * D 面 产品面接线（防「内核写好了、导出挂出来了、产品端零消费」）
 * ============================================================ */

/** 判据本体（收文本入参，可喂破坏副本 —— 负控制必须对它跑同款判定） */
function judgeDiagWiring(txt) {
    const need = [
        "from '../../config/undo-capability.js'",
        "from '../../config/destructive-confirm.js'",
        'undoModeCounts()',
        'undoSummaryLine()',
        'describeDestroy(',
        'undoFace',
    ];
    const missing = need.filter((n) => txt.indexOf(n) < 0);
    return { ok: missing.length === 0, missing };
}

test('D1 诊断中心真消费声明面与文案面（六个消费点，不只是字样在场）', () => {
    const src = readRel(DIAG_REL);
    const v = judgeDiagWiring(src);
    assert.equal(v.ok, true, '★ 诊断内核必须真的调用这些出口（缺：' + v.missing.join(' / ') + '）');
    /* 只是 import 进来不算 —— 必须有 IIFE 面、必须进 collectDiagnose 的返回对象、
     *   必须有 Text 转发并进 export default。三处都在才算「读数真的到了 UI」。 */
    assert.ok(/const undoFace = \(\(\) => \{/.test(src), '② 必须是一张独立的 IIFE 面（单面 try/catch，不拖垮全页）');
    assert.ok(/iconFace, undoFace, openRefFace/.test(src), '② 必须进 collectDiagnose 的返回对象');
    assert.ok(/export function undoFaceText\(face\)/.test(src), '③ 必须有 Text 转发函数（视图不自拼结论）');
    assert.ok(/^\s{4}undoFaceText,?$/m.test(src), '③ 必须进 export default 清单');
    /* 面对象必须带「残留账」与「条数对账」两个读数：只报一个总数等于没说清 */
    assert.ok(/residual: Number\(count\.irreversible \|\| 0\)/.test(src), '② 面里必须单列残留账读数');
    assert.ok(/appsTotal: realApps/.test(src), '② 面里必须带 APPS 真源条数（跨源对账的另一半）');
});

test('D2 视图卡真渲染（有 _undoFaceHtml、有 h.push 卡、有 import 转发）', () => {
    const v = readRel(DIAGV_REL);
    assert.ok(v.indexOf("import { undoFaceText } from './diagnose-data.js';") >= 0, '① 必须 import 转发函数');
    assert.ok(/_undoFaceHtml\(pkg\) \{/.test(v), '② 必须有排版方法');
    assert.ok(/this\._undoFaceHtml\(pkg\)/.test(v), '③ 必须在页面装配处真调用（只写方法不调用 = 零消费）');
    assert.ok(/销毁动作分级（89 件 App 删了能不能回来）/.test(v), '③ 卡片标题必须可辨认');
    assert.ok(/dg-note dg-bad/.test(v), '★ 面缺席时必须是红档（不许画成绿）');
});

test('D3 面自证双向：正向（可恢复文案指回收站）+ 反向（不可撤销传 undoable 也不改口）', () => {
    /* 这两条在 diagnose-data.js 的 undoFace 里也是 problems 的来源 —— 这里在**真模块**上
     *   再跑一遍同款判定，两侧都必须成立。只验一侧 = 给恒真实现留门。 */
    const up = CONF.describeDestroy({ appId: 'diary', action: '删除', what: 'x' });
    assert.equal(up.recoverable, true);
    assert.ok(String(up.text).includes('回收站'));
    const down = CONF.describeDestroy({ appId: 'archive', action: '删除', what: 'x', undoable: true });
    assert.equal(down.recoverable, false);
    assert.ok(String(down.text).includes('不可撤回'));
});

/* ============================================================
 * E 面 负控制：真源码破坏 → 落副本 → 在副本上重跑同款真判据
 * ============================================================ */

/** 把某个 config 模块按替换表破坏后落到临时目录，返回加载进来的模块 */
async function loadDamaged(rel, anchor, replacement, tag) {
    const src = readRel(rel);
    const hits = src.split(anchor).length - 1;
    assert.equal(hits, 1, '[' + tag + '] 破坏锚点必须恰中 1 次（实测 ' + String(hits) + '）—— 中 0 次意味着破坏没发生');
    const damaged = src.split(anchor).join(replacement);
    assert.notEqual(damaged, src, '[' + tag + '] 破坏必须真的改变了文本');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v4105_'));
    /* 被破坏模块若还有同级相对 import（destructive-confirm → ./undo-capability.js），
     *   落副本后该 import 会 404。故把它的**同级依赖原样**复制进同一临时目录 ——
     *   变的是被破坏的那一步，依赖本身逐字节来自真源（不是替身）。 */
    const srcDir = path.dirname(path.join(ROOT, rel));
    const base = path.basename(rel);
    for (const f of fs.readdirSync(srcDir)) {
        if (f === base) continue;
        if (!f.endsWith('.js')) continue;
        const from = path.join(srcDir, f);
        if (!fs.statSync(from).isFile()) continue;
        fs.copyFileSync(from, path.join(dir, f));
    }
    const file = path.join(dir, base);
    fs.writeFileSync(file, damaged, 'utf8');
    return await import(pathToFileURL(file).href);
}

test('E1 负控制：删掉「未知 appId 按最保守口径」的兜底，A5 判据必须转红', async () => {
    const mod = await loadDamaged(
        UNDO_REL,
        "    if (!d) return { appId: String(appId || ''), mode: 'irreversible', why: '', unknown: true };\n",
        "    if (!d) return { appId: String(appId || ''), mode: 'undo', why: '', unknown: false };\n",
        'conservative-fallback'
    );
    const r = mod.undoCapabilityOf('no_such_app_xyz');
    assert.equal(r.mode, 'undo', '★ 破坏后未知 App 被说成可撤销 —— 同款判据必须报红');
    assert.equal(r.unknown, false);
    const real = UNDO.undoCapabilityOf('no_such_app_xyz');
    assert.equal(real.mode, 'irreversible', '① 真模块在同一场景下必须是保守的（三向自证）');
    assert.equal(real.unknown, true);
});

test('E2 负控制：让 describeDestroy 认调用方的 undoable，C2 判据必须转红', async () => {
    const mod = await loadDamaged(
        CONF_REL,
        "    const recoverable = mode === 'undo';\n",
        "    const recoverable = mode === 'undo' || o.undoable === true;\n",
        'obey-caller'
    );
    const d = mod.describeDestroy({ appId: 'archive', action: '删除存档', what: '整包', undoable: true });
    assert.equal(d.recoverable, true, '★ 破坏后调用方一句 undoable 就能把不可撤销说成可恢复 —— 同款判据必须报红');
    assert.equal(CONF.describeDestroy({ appId: 'archive', action: '删除', undoable: true }).recoverable, false,
        '真模块必须不认调用方');
});

test('E3 负控制：把一件 confirm 档改成 irreversible，B3/B5 判据必须转红', async () => {
    const mod = await loadDamaged(
        UNDO_REL,
        "appId: 'annidate', name: '纪念日数学案头', mode: 'confirm'",
        "appId: 'annidate', name: '纪念日数学案头', mode: 'irreversible'",
        'downgrade-mode'
    );
    const claims = mod.UNDO_DECLARATIONS.filter((d) => d.mode === 'confirm').map((d) => String(d.appId));
    assert.equal(claims.length, 18, '★ 破坏后 confirm 档少了一件 —— B3 的「必须 19 件」判据必须报红');
    assert.equal(claims.includes('annidate'), false);
    const irr = mod.UNDO_DECLARATIONS.filter((d) => d.mode === 'irreversible').map((d) => String(d.appId));
    assert.ok(irr.includes('annidate'));
    assert.equal(dirHas('annidate', 'confirmDestroy('), true,
        '★ 磁盘上确实有守卫 ⇒「irreversible 档两者都不许有」判据在这里必然转红');
});

test('E4 负控制：把一件 undo 档改成 confirm，B1/B2 必须转红', async () => {
    const mod = await loadDamaged(
        UNDO_REL,
        "appId: 'diary', name: '日记', mode: 'undo'",
        "appId: 'diary', name: '日记', mode: 'confirm'",
        'upgrade-mode'
    );
    const undoC = mod.UNDO_DECLARATIONS.filter((d) => d.mode === 'undo').map((d) => String(d.appId));
    assert.equal(undoC.length, 10, '★ 破坏后 undo 档少了一件 —— B1 的「必须 11 件」判据必须报红');
    assert.equal(undoC.includes('diary'), false);
    assert.equal(dirHas('diary', 'recycleBin.registerRestorer('), true,
        '★ 磁盘上有恢复器却没声明成 undo ⇒ B2 必红');
});

test('E5 负控制：诊断中心停掉一个出口调用，D1 判据必须转红', () => {
    const src = readRel(DIAG_REL);
    const anchor = 'undoSummaryLine()';
    const hits = src.split(anchor).length - 1;
    assert.ok(hits >= 1, '锚点至少要出现 1 次');
    const damaged = src.split(anchor).join('String()');
    const v = judgeDiagWiring(damaged);
    assert.equal(v.ok, false, '★ 停掉出口调用后接线判据必须转红');
    assert.notDeepEqual(v.missing, []);
    assert.equal(judgeDiagWiring(src).ok, true, '① 真源码上同款判据必须为真（三向自证的第一向）');
});

test('E6 工具两向自证：锚点不存在 / 不唯一都必须抛，破坏必须可观测地改变行为', async () => {
    /* H6：负控制工具本身也要被自证 —— 一个「破坏没生效也照样返回」的工具，
     *   会让 E 组全部变成假绿。 */
    await assert.rejects(
        async () => loadDamaged(UNDO_REL, 'THIS_ANCHOR_DOES_NOT_EXIST_99', 'x', 'no-anchor'),
        /恰中 1 次/
    );
    await assert.rejects(
        async () => loadDamaged(UNDO_REL, '    for (const d of UNDO_DECLARATIONS) {', 'x', 'two-place'),
        /恰中 1 次/
    );
    const mod = await loadDamaged(
        CONF_REL,
        "    const recoverable = mode === 'undo';\n",
        '    const recoverable = true;\n',
        'always-true'
    );
    const t = mod.describeDestroy({ appId: 'archive', action: '删除' });
    const r = CONF.describeDestroy({ appId: 'archive', action: '删除' });
    assert.notEqual(t.recoverable, r.recoverable, '★ 破坏必须真的改变行为（否则 E 组全是假绿）');
});
