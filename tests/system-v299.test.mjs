/**
 * tests/system-v299.test.mjs — 返回键守卫 + 源键规则单一真源 + 统一诊断中心 [v2.99.0]
 *
 * 本版要缝的是上游两份插件更新（瑟瑟小手机 V1.059 / 色色灵感状态栏 V3.782），
 * 但只在**本仓真有缺口**的地方缝。逐项对照后的结论：
 *   ① 返回键守卫（缝）：上游 `__ubBackGuard` 治的是「返回键先关浮层、再退视图」，
 *      而本仓实测**全库零 popstate / 零 history.pushState** —— 安卓物理返回键
 *      完全不响应；右滑手势 `PHONE_EVENTS.SWIPE_BACK` 只知道退视图，
 *      打开着的浮层（图片查看器等）不参与。
 *   ② 源键规则（缝）：v2.93.0 用一条真缺陷换来教训「派生库的源键里不放可变状态」，
 *      但当时只落在代码与测试里 —— 没有任何东西能拦住下一例。
 *   ③ 诊断中心（缝）：桥归因只活在 worldpulse 卡片里、字段三态只活在 7 个内核的
 *      reason 里、返回栈与源键规则**根本没有界面出口**。
 *   不缝：上游宿主集成面（`__ubWorldbookProjection` / `__ubImageGenQueue` /
 *      `__ubStorageRelocation` / `ub-cycle-api`）均属 TauriTavern 专用宿主形态，
 *      与本仓（SillyTavern 原生扩展）目标形态不同。
 *
 * 覆盖：
 *   A 结构面：三个模块落地 + 四处接线 + 样式有投递路径 + 消费字段清单逐键对账
 *   B 诊断内核降级与归因：降级契约、有坏消息先说坏消息、未知原因如实输出原值
 *   C 返回键守卫行为：LIFO / 无物可关不压哨兵 / 注销自清 / 封顶如实记数 / 不抛
 *   D 源键规则行为：八类合法、五类违规、畸形不中断
 *   E 职责边界：右滑手势与返回键分工共存、词表单一真源、版本与申明
 *   F 负控制（真源码破坏 → 在镜像树上重跑同款真判据必须转红且指向真因）
 *   G 镜像树自证（未破坏的镜像树五道门全绿；否则 F 组是假绿）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { copyTreeSafe } from './_mirror_tree.mjs';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const at = (rel) => pathToFileURL(path.join(ROOT, rel)).href;

const BG = 'config/back-guard.js';
const SK = 'config/source-key-rules.js';
const DG_DATA = 'apps/diagnose/diagnose-data.js';
const DG_VIEW = 'apps/diagnose/diagnose-view.js';
const DG_APP = 'apps/diagnose/diagnose-app.js';
const SHELL = 'phone/phone-shell.js';

/** 七个「面」内核：文件 + 该面在真源码里调 faceFieldState 的位置 */
const FACES = [
    { file: 'apps/profile/profile-data.js' },
    { file: 'apps/wallet/wallet-data.js' },
    { file: 'apps/chars/chars-data.js' },
    { file: 'apps/place/place-data.js' },
    { file: 'apps/plotline/plotline-data.js' },
    { file: 'apps/clock/clock-data.js' },
    { file: 'apps/ledger/ledger-data.js' },
];

const BG_MOD = await import(at(BG));
const SK_MOD = await import(at(SK));
const DG_MOD = await import(at(DG_DATA));

/* ============================================================
 * A. 结构面
 * ============================================================ */
test('v299 A1. 三个模块落地，且导出面收敛到「真有消费点」的那些', () => {
    for (const f of [BG, SK, DG_DATA, DG_VIEW, DG_APP, 'apps/diagnose/diagnose.css']) {
        assert.ok(fs.existsSync(path.join(ROOT, f)), f + ' 未落地');
    }
    // 导出面：每个 export 必须有产品侧消费点（第九道门 dead-exports 的同一口径，此处钉住命名）
    assert.equal(typeof BG_MOD.registerBackCloser, 'function');
    assert.equal(typeof BG_MOD.installBackGuard, 'function');
    assert.equal(typeof BG_MOD.backGuardReport, 'function');
    assert.equal(typeof SK_MOD.validateSourceKey, 'function');
    assert.equal(typeof SK_MOD.auditSourceKeys, 'function');
    assert.equal(typeof SK_MOD.sourceKeyRulebook, 'function');
});

test('v299 A2. 四处接线：APPS / 懒加载分支 / 重绑表 / 外壳注册浮层', () => {
    const apps = read('config/apps.js');
    assert.ok(apps.includes("id: 'diagnose'"), 'APPS 未登记 diagnose');
    const idx = read('index.js');
    assert.ok(idx.includes("appId === 'diagnose'"), 'index.js 缺懒加载分支');
    assert.ok(idx.includes("import('./apps/diagnose/diagnose-app.js')"), '懒加载分支未指向真文件');
    assert.ok(idx.includes("'diagnoseApp'"), '重绑表未登记 diagnoseApp（换会话会漏重绑）');
    const shell = read(SHELL);
    assert.ok(shell.includes('installBackGuard'), '外壳未压哨兵');
    assert.ok(shell.includes('registerBackCloser'), '外壳未把浮层注册进返回栈');
    assert.ok(shell.includes("'image-viewer'"), '图片查看器未带 tag 注册（诊断页看不见是谁）');
});

test('v299 A3. 样式有投递路径（R3 的教训：没投递 = 界面裸奔且不报错）', () => {
    const v = read(DG_VIEW);
    assert.ok(v.includes('DIAGNOSE_CSS_URL'), '视图未声明样式 URL');
    assert.ok(v.includes('link.href = DIAGNOSE_CSS_URL'), '声明了 URL 但没赋给 link（等于没投递）');
    assert.ok(v.includes('diagnose-css'), '未设幂等 id，同页多次 render 会重复插 <link>');
});

/** 从真源码里抽出 faceFieldState(..., [...]) 的字段名（不用正则，防转义层数手数） */
function callKeys(src) {
    const CALL = 'faceFieldState(';
    const out = [];
    let i = 0;
    for (;;) {
        const at0 = src.indexOf(CALL, i);
        if (at0 < 0) break;
        const open = src.indexOf('[', at0);
        const close = src.indexOf(']', open + 1);
        if (open < 0 || close < 0) break;
        for (const part of src.slice(open + 1, close).split(',')) {
            const q = part.trim();
            if (q.length > 1) out.push(q.slice(1, -1));
        }
        i = close + 1;
    }
    return out;
}

test('v299 A4. 诊断中心的「已消费字段清单」与真源码**逐键**对账', () => {
    /* 这一条是拿真实踩到的缺陷换来的：清单初版写作 `chars`，而真实消费点
     *   （apps/chars/chars-data.js）写的是 `characters`（上游契约里的字段名就是它）；
     *   同时漏了 plotline 的 `worldProg`。后果是诊断页把**一个根本不存在的字段**
     *   显示成「上游明说源里没这项」，而真正的 faces 反而不在清单里。
     *   所以不能只断言「清单非空」—— 必须与调用点逐键比对，多一个少一个都红。 */
    const declared = DG_MOD.CONSUMED_FIELDS.map((f) => f.key);
    const actual = [];
    for (const f of FACES) actual.push(...callKeys(read(f.file)));
    assert.ok(actual.length >= 8, '未抽到 faceFieldState 调用键（抽取逻辑失效，判据会假绿）：' + actual.length);
    const missing = actual.filter((k) => !declared.includes(k));
    const extra = declared.filter((k) => !actual.includes(k));
    assert.deepEqual(missing, [], '清单漏了真源码在消费的字段：' + missing.join(','));
    assert.deepEqual(extra, [], '清单含无人在消费的字段（会显示成假读数）：' + extra.join(','));
});

test('v299 A5. 源键现场清单的锚点在真仓库里确实存在（防清单脱节）', () => {
    assert.ok(DG_MOD.SOURCE_KEY_SITES.length >= 3);
    for (const s of DG_MOD.SOURCE_KEY_SITES) {
        const src = read(s.file);
        assert.ok(src.includes(s.mustContain), s.file + ' 里找不到锚点 ' + s.mustContain);
    }
});

/* ============================================================
 * B. 诊断内核：降级契约 + 归因文案
 * ============================================================ */
test('v299 B1. collectDiagnose 在无宿主环境下不抛，且返回值结构恒定', () => {
    const pkg = DG_MOD.collectDiagnose();
    for (const k of ['at', 'bridges', 'bridgeReport', 'fields', 'backStack', 'sourceKeys', 'rulebook', 'audit']) {
        assert.ok(Object.prototype.hasOwnProperty.call(pkg, k), '缺字段 ' + k + '（消费方要判 undefined）');
    }
    assert.equal(pkg.fields.length, DG_MOD.CONSUMED_FIELDS.length);
    for (const f of pkg.fields) {
        assert.equal(typeof f.key, 'string');
        assert.equal(typeof f.reason, 'string');
        assert.equal(typeof f.faceState, 'string');
    }
    assert.equal(pkg.backStack.mounted, false, '无宿主时应如实报未安装');
    assert.equal(pkg.audit.total, 3);
    assert.equal(pkg.audit.bad.length, 0);
});

test('v299 B2. 归因文案：未知原因如实输出原值，不静默兜底成某个具体结论', () => {
    assert.equal(DG_MOD.fieldReasonText('zzz-unknown'), 'zzz-unknown');
    assert.equal(DG_MOD.bridgeReasonText('zzz-unknown'), 'zzz-unknown');
    assert.equal(DG_MOD.fieldReasonText(''), '未知');
    assert.equal(DG_MOD.fieldReasonText(null), '未知');
    // 六个已知态各有文案，且互不相同（同形即归因失效）
    const ks = ['value', 'declared-null', 'absent', 'legacy-null', 'legacy-value', 'no-snapshot'];
    const txts = ks.map((k) => DG_MOD.fieldReasonText(k));
    assert.equal(new Set(txts).size, ks.length, '有态共用了同一句文案：' + txts.join(' / '));
});

test('v299 B3. 一句话总述：有坏消息先说坏消息', () => {
    const okPkg = { bridgeReport: { consistent: true, anyReadable: true }, backStack: { dropped: 0 }, audit: { bad: [] } };
    assert.ok(DG_MOD.summarizeDiagnose(okPkg).startsWith('正常'), '全好时应报正常');
    const bad1 = { bridgeReport: { consistent: false, anyReadable: true }, backStack: { dropped: 0 }, audit: { bad: [] } };
    assert.ok(DG_MOD.summarizeDiagnose(bad1).startsWith('需注意'), '桥自述不一致必须首行报出来');
    const bad2 = { bridgeReport: { consistent: true, anyReadable: true }, backStack: { dropped: 3 }, audit: { bad: [] } };
    const s2 = DG_MOD.summarizeDiagnose(bad2);
    assert.ok(s2.startsWith('需注意') && s2.includes('3'), '返回栈拒压次数须如实进总述：' + s2);
    const bad3 = { bridgeReport: { consistent: true, anyReadable: true }, backStack: { dropped: 0 }, audit: { bad: [{}, {}] } };
    assert.ok(DG_MOD.summarizeDiagnose(bad3).startsWith('需注意'), '源键违规必须进总述');
    assert.equal(DG_MOD.summarizeDiagnose(null).length > 0, true, '空入参也要给出一句话');
});

/* ============================================================
 * C. 返回键守卫行为（用最小 window 桩，忠实模型 history 栈）
 * ============================================================ */
function mkWin() {
    const L = {};
    const entries = [null];
    let idx = 0;
    return {
        history: {
            get state() { return entries[idx]; },
            pushState(s) { entries.splice(idx + 1); entries.push(s); idx = entries.length - 1; },
            back() {
                if (idx > 0) idx -= 1;
                for (const fn of (L.popstate || []).slice()) fn();
                return entries[idx];
            },
        },
        addEventListener(t, fn) { (L[t] = L[t] || []).push(fn); },
    };
}

test('v299 C1. 无物可关时不压哨兵（否则用户按返回只会弹掉哨兵，什么都没关）', () => {
    const w = mkWin();
    assert.equal(BG_MOD.installBackGuard({ win: w }), false);
    assert.equal(BG_MOD.backGuardReport(w).armed, false);
    assert.equal(BG_MOD.backGuardReport(w).sentinelTop, false);
    const rel = BG_MOD.registerBackCloser(() => true, { tag: 'x', win: w });
    assert.equal(BG_MOD.backGuardReport(w).armed, true, '有东西可关时应压上');
    assert.equal(BG_MOD.backGuardReport(w).sentinelTop, true);
    rel();
});

test('v299 C2. 连续按返回可逐层关（LIFO，后开的先关）', () => {
    /* 真实契约：浮层关掉时**自己注销自己**（测试里即 closer 内部调 rel）。
     *   上一版写法是“关了但不注销”，于是第二次返回又命中同一层（[b,b]）——
     *   那是测试自己漏注销，不是实现缺陷；缺陷在于上一版把它当成了行为预期。 */
    const w = mkWin();
    const closed = [];
    const rels = {};
    const mk = (name) => {
        const rel = BG_MOD.registerBackCloser(() => { closed.push(name); rels[name](); return true; }, { tag: name, win: w });
        rels[name] = rel;
    };
    mk('a');
    mk('b');
    assert.equal(BG_MOD.backGuardReport(w).tags.join(','), 'a,b');
    w.history.back();
    assert.deepEqual(closed, ['b'], '应先关最后注册的那个');
    assert.equal(BG_MOD.backGuardReport(w).armed, true, '还有一层没关，哨兵应重新压上（否则下一次返回不被拦）');
    w.history.back();
    assert.deepEqual(closed, ['b', 'a'], '再按一次就能关下一层（**不需要按两次**，这正是本版修掉的缺陷）');
    assert.equal(BG_MOD.backGuardReport(w).armed, false, '关完不应留悬挂哨兵');
    assert.equal(BG_MOD.backGuardReport(w).closers, 0, '关过的层应从栈里移除');
});

test('v299 C3. 返回 falsy = 「不是我的」，继续往下一层找', () => {
    const w = mkWin();
    const c2 = [];
    BG_MOD.registerBackCloser(() => { c2.push('x'); return false; }, { tag: 'x', win: w });
    BG_MOD.registerBackCloser(() => { c2.push('y'); return true; }, { tag: 'y', win: w });
    w.history.back();
    assert.deepEqual(c2, ['y'], 'y 关了即停，不应再调 x');
    assert.equal(BG_MOD.backGuardReport(w).lastClose, 'y');
});

test('v299 C4. 浮层被点 X 关掉后，注销函数必须自清悬挂哨兵（否则下次返回被白吃）', () => {
    const w = mkWin();
    const rel = BG_MOD.registerBackCloser(() => true, { tag: 'ov', win: w });
    assert.equal(BG_MOD.backGuardReport(w).armed, true);
    rel();
    const rep = BG_MOD.backGuardReport(w);
    assert.equal(rep.closers, 0);
    assert.equal(rep.armed, false, '已无物可关，armed 必须归假');
    assert.equal(rep.sentinelTop, false, '哨兵层必须弹回去（否则用户按返回会被静默吃掉一次）');
});

test('v299 C5. 注销幂等；畸形入参一律降级不抛', () => {
    const w = mkWin();
    const rel = BG_MOD.registerBackCloser(() => true, { tag: 't', win: w });
    rel();
    rel();
    assert.equal(BG_MOD.backGuardReport(w).closers, 0);
    assert.equal(BG_MOD.registerBackCloser(null, { win: w })(), undefined);
    assert.equal(BG_MOD.registerBackCloser(1, { win: w })(), undefined);
    assert.equal(BG_MOD.installBackGuard({ win: {} }), false);
    const r0 = BG_MOD.backGuardReport(null);
    assert.equal(r0.mounted, false);
    assert.equal(r0.closers, 0);
});

test('v299 C6. 关闭器数量封顶，且超限如实记数（不静默拒绝）', () => {
    const w = mkWin();
    for (let i = 0; i < 40; i += 1) BG_MOD.registerBackCloser(() => false, { tag: 't' + i, win: w });
    const rep = BG_MOD.backGuardReport(w);
    assert.equal(rep.closers, 30, '上限 30');
    assert.equal(rep.dropped, 10, '被拒绝的层数必须如实记进 dropped（诊断页可见）');
});

/* ============================================================
 * D. 源键规则
 * ============================================================ */
test('v299 D1. 合法源键：类型已登记 + 其余段均为稳定身份', () => {
    for (const k of ['calendar:m17:work', 'calendar:m17:study', 'commitment:c_9x', 'task:t1:0', 'order:o1', 'source:abc', 'media:m1:text', 'memo:2026-09-25']) {
        const r = SK_MOD.validateSourceKey(k);
        assert.equal(r.ok, true, k + ' 应合规，实报 ' + r.reason);
        assert.equal(r.reason, 'ok');
    }
});

test('v299 D2. 真源键的尾段白名单：领域类型不是状态（允许），状态词不是分类（违规）', () => {
    // 领域类型尾段：来自 ALLOWED_TAIL，不算漂移
    assert.equal(SK_MOD.validateSourceKey('calendar:m17:work').ok, true);
    // 状态词尾段：v2.93 那条真缺陷的形态
    assert.equal(SK_MOD.validateSourceKey('commitment:c_9x:proposed').reason, 'volatile-segment');
    assert.equal(SK_MOD.validateSourceKey('calendar:m17:done').reason, 'volatile-segment');
    assert.equal(SK_MOD.validateSourceKey('task:t1:completed').reason, 'volatile-segment');
    assert.equal(SK_MOD.validateSourceKey('order:o1:phase').reason, 'volatile-segment');
});

test('v299 D3. 五类违规各有专属 reason（不压成一个 invalid）', () => {
    assert.equal(SK_MOD.validateSourceKey('').reason, 'empty');
    assert.equal(SK_MOD.validateSourceKey('   ').reason, 'empty');
    assert.equal(SK_MOD.validateSourceKey(null).reason, 'empty');
    assert.equal(SK_MOD.validateSourceKey('mystery:x').reason, 'unknown-type');
    assert.equal(SK_MOD.validateSourceKey('calendar::work').reason, 'malformed-segment');
    assert.equal(SK_MOD.validateSourceKey('calendar:m 17:work').reason, 'malformed-segment');
});

test('v299 D4. 批量校验：畸形键不中断其它键，且给出可用读数', () => {
    const r = SK_MOD.auditSourceKeys(['calendar:m1:work', '', 'mystery:x', 'task:t1:0', 'order:o1:done']);
    assert.equal(r.total, 5);
    assert.equal(r.ok, 2);
    assert.equal(r.bad.length, 3);
    assert.equal(r.reasons.ok, 2);
    assert.equal(r.reasons.empty, 1);
    assert.equal(r.reasons['unknown-type'], 1);
    assert.equal(r.reasons['volatile-segment'], 1);
    const r2 = SK_MOD.auditSourceKeys(null);
    assert.equal(r2.total, 0);
    assert.equal(r2.ok, 0);
});

test('v299 D5. 词表快照是副本（消费方改了不污染真源）', () => {
    const a = SK_MOD.sourceKeyRulebook();
    assert.ok(a.knownTypes.length >= 8);
    assert.ok(a.volatileSegments.length >= 10);
    assert.ok(a.allowedTail.length >= 6);
    a.knownTypes.push('__hacked');
    assert.equal(SK_MOD.sourceKeyRulebook().knownTypes.includes('__hacked'), false, '词表必须只读');
});

/* ============================================================
 * E. 职责边界与版本
 * ============================================================ */
test('v299 E1. 右滑手势与返回键分工共存（返回键不替换物理手势底座）', () => {
    const shell = read(SHELL);
    assert.ok(shell.includes("'phone:swipeBack'"), '右滑手势派发点消失了（那是 yuzuki-phone 缝入面，不该被本版拿走）');
    assert.ok(shell.includes('installBackGuard'), '返回键守卫未接入（那物理返回键仍不响应）');
    const pe = read('config/phone-events.js');
    assert.ok(pe.includes('SWIPE_BACK'), '事件常量被删');
});

test('v299 E2. 源键词表单一真源（全仓只许一处定义）', () => {
    const hits = [];
    for (const base of ['apps', 'config', 'phone']) {
        const walk = (d) => {
            for (const name of fs.readdirSync(d)) {
                const abs = path.join(d, name);
                const st = fs.statSync(abs);
                if (st.isDirectory()) { if (name !== 'node_modules') walk(abs); }
                else if (name.endsWith('.js') && fs.readFileSync(abs, 'utf8').includes('KNOWN_SOURCE_TYPES')) hits.push(path.relative(ROOT, abs));
            }
        };
        walk(path.join(ROOT, base));
    }
    assert.deepEqual(hits, [SK], '词表被抄了第二份：' + hits.join(','));
});

test('v299 E3. 版本不低于 2.99.0 且五源同源（[v3.0.0] 交棒：硬结构断言改下限锚点）', () => {
    const log = JSON.parse(read('update-log.json'));
    const manifest = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const m = read('index.js').match(/const ST_PHONE_VERSION = '([^']+)'/);
    assert.ok(m, 'ST_PHONE_VERSION 必须存在');
    assert.equal(log.latest, manifest.version);
    assert.equal(manifest.version, pkg.version);
    assert.equal(pkg.version, m[1]);
    const num = (v) => String(v).split('.').map((n) => Number.parseInt(n, 10) || 0);
    const a = num(log.latest);
    const b = num('2.99.0');
    let ge = false;
    for (let i = 0; i < 3; i += 1) { if (a[i] !== b[i]) { ge = a[i] > b[i]; break; } }
    // [v3.0.0] 交棒：原判据写作 a[0]===b[0] && a[1]===b[1] && a[2]>=b[2] —— 那是**硬结构断言**，
    //   主版本从 2 跳到 3 时必红（3 ≠ 2），而它想表达的只是「不低于 2.99.0」。
    //   按仓内交棒惯例改成纯下限锚点；当版精确判定（主次版本为 3.0）由
    //   tests/system-v300.test.mjs 的 D1 接管。
    assert.ok(ge || (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]), '版本 ' + log.latest + ' < 2.99.0');
});

test('v299 E4. 变更日志与实现同域（不是只改了版本号）', () => {
    /* [v3.0.0] 交棒：原判据用**当前版本**条目去查 v2.99 特有的关键词（返回/源键/诊断），
     *   于是**每发一版必翻红**（新版本的条目本来就不会提 v2.99 的落地项）。
     *   本仓已有五处同类交棒先例（system-v230/v232/v233/v234/v235 的 D5/G7 段都改钉
     *   自己的历史条目）。此处改钉 v2.99.0 条目本身 —— 它要表达的正是
     *   「v2.99 的变更说明与 v2.99 的实现同域」，与「当前版本是谁」无关。 */
    const log = JSON.parse(read('update-log.json'));
    const entry = log.versions['2.99.0'];
    assert.ok(entry && Array.isArray(entry.items) && entry.items.length > 0, 'v2.99.0 条目须在（历史条目不得被删）');
    assert.equal(entry.version, '2.99.0');
    const all = entry.items.join('\n');
    for (const kw of ['返回', '源键', '诊断']) {
        assert.ok(all.includes(kw), '变更说明未提到本版落地项：' + kw);
    }
});

/* ============================================================
 * F/G. 负控制（真源码破坏 → 镜像树上重跑同款真判据）
 *
 * 为什么用**全量镜像树**而不是手写文件清单：本仓历史负控制两次因「副本树缺文件」
 *   而红（v2.98 的 STAGE_FILES 只放了内核与视图、没放消费方），那种红是**假绿**——
 *   判据没测到机制，只是没找到文件。本仓零依赖（无 package.json 依赖、无 node_modules），
 *   整仓 59MB，cpSync 约 2 秒，用全量镜像从根上消掉这一类假绿。
 * ============================================================ */
const GATES = [
    'scripts/registry-audit.mjs',
    'scripts/keys-audit.mjs',
    'scripts/lifecycle-audit.mjs',
    'scripts/bridge-contract-audit.mjs',
    'scripts/dead-export-check.mjs',
];
const ORIG = new Map();
for (const g of GATES) ORIG.set(g, read(g));

/* F2 的破坏锚点写在本文件内（自足）：若拿门禁里的注释当锚点，后人改一句话就会让负控制静默失效。 */
const TOUCHED = ['scripts/keys-audit.mjs', 'scripts/registry-audit.mjs', 'config/apps.js', 'phone/phone-shell.js'];
const NON_KEY_ANCHOR = "const NON_KEY_LITERALS = new Set([";
const NON_KEY_BROKEN = "const NON_KEY_LITERALS = new Set(['__never__']); const _dead = new Set([";
const F6_ANCHOR = "if (reads.every((r) => r.reason === 'declared-null')) return 'declared-empty';";
const F6_BROKEN = "if (false) return 'declared-empty';";

function mutateOnce(src, from, to) {
    const n = src.split(from).length - 1;
    assert.equal(n, 1, '锚点应恰好命中 1 次，实际 ' + n + '：' + String(from).slice(0, 70));
    return src.replace(from, to);
}

/** 造一个全量镜像树（排除 .git）；mut 里的文件以「读完原版→变形」的方式覆盖 */
function mirror(mut) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v299-mir-'));
    copyTreeSafe(ROOT, dir, {
        filter: (src) => !src.split(path.sep).includes('.git'),
    });
    for (const [rel, fn] of Object.entries(mut)) {
        const body = fn(read(rel));
        assert.notEqual(body, read(rel), '破坏未发生（锚点没命中）：' + rel);
        fs.writeFileSync(path.join(dir, rel), body);
    }
    /* 门禁自身若被破坏，跑副本时用原版门禁；否则负控制的观测被自己的破坏污染。
     *   **但 mut 里明确要改的门禁必须排除**（实测踩到：F2 的极性就是改门禁自己，若在此无条件还原，
     *   那次破坏就被静默撤销—— 负控制会得出「门禁仍然全绿」的假结论，比不做负控制更坏）。 */
    for (const [g, src] of ORIG) {
        if (Object.prototype.hasOwnProperty.call(mut, g)) continue;
        fs.writeFileSync(path.join(dir, g), src);
    }
    return dir;
}

function runGate(dir, rel) {
    if (!ORIG.has(rel)) fs.writeFileSync(path.join(dir, rel), read(rel));
    try {
        const out = execFileSync('node', [rel], { cwd: dir, encoding: 'utf8' });
        return { ok: true, out };
    } catch (e) {
        return { ok: false, out: String(e.stdout || '') + String(e.stderr || '') };
    }
}

function withMirror(mut, fn) {
    const dir = mirror(mut);
    try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('v299 G0. 镜像树自证：未破坏时五道门全绿（否则 F 组是假绿）', () => {
    withMirror({}, (dir) => {
        for (const g of GATES) {
            const r = runGate(dir, g);
            assert.equal(r.ok, true, '未破坏的镜像树上 ' + g + ' 必须通过：' + r.out.slice(0, 400));
        }
    });
});

test('v299 F1. 负控制：诊断视图的样式投递路径被抹掉 ⇒ registry R3 红灯并点名该文件', () => {
    withMirror({
        [DG_VIEW]: (s) => mutateOnce(
            mutateOnce(s, "const DIAGNOSE_CSS_URL = new URL('./diagnose.css?v=1.0.0', import.meta.url).href;", "const DIAGNOSE_CSS_URL = '';"),
            'link.href = DIAGNOSE_CSS_URL;', "link.href = '';"),
    }, (dir) => {
        const r = runGate(dir, 'scripts/registry-audit.mjs');
        assert.equal(r.ok, false, '未投递的样式必须红灯');
        assert.ok(r.out.includes('R3'), '红灯须指向 R3 判据：' + r.out.slice(0, 300));
        assert.ok(r.out.includes('diagnose.css'), '红灯须点名该文件：' + r.out.slice(0, 300));
    });
});

test('v299 F2. 负控制：状态槽名被当 storage 键登记 ⇒ keys K1 红灯（理由注释也拦得住）', () => {
    withMirror({
        [TOUCHED[0]]: (s) => mutateOnce(s, NON_KEY_ANCHOR, NON_KEY_BROKEN),
    }, (dir) => {
        const r = runGate(dir, 'scripts/keys-audit.mjs');
        assert.equal(r.ok, false, '未登记必须红灯');
        assert.ok(r.out.includes('K1'), '红灯须指向 K1：' + r.out.slice(0, 300));
        assert.ok(r.out.includes('__ubBackGuard'), '红灯须点名该槽名：' + r.out.slice(0, 300));
    });
});

test('v299 F3. 负控制：重绑表删掉 diagnoseApp ⇒ lifecycle L1 红灯（槽位漏接线）', () => {
    withMirror({
        /* [v3.22.0 交棒] 锈点跟随表项格式：表尾项为了能继续追加，
         *   给 'diagnoseApp' 补了尾逗号，旧锈点（后直接跟注释）从此 0 命中。
         *   判据本身不变：真源码破坏 ⇒ 副本上重跑真判据 ⇒ 必须红灯。 */
        'index.js': (s) => mutateOnce(s, "    'diagnoseApp',   // [v2.99.0] ", "    '__x',   // [v2.99.0] "),
    }, (dir) => {
        const r = runGate(dir, 'scripts/lifecycle-audit.mjs');
        assert.equal(r.ok, false, '槽位漏接线必须红灯');
        assert.ok(r.out.includes('L1'), '红灯须指向 L1：' + r.out.slice(0, 400));
        assert.ok(r.out.includes('diagnose'), '红灯须点名该 App：' + r.out.slice(0, 400));
    });
});

test('v299 F4. 负控制：方法名改回 snapshot ⇒ bridge-contract J2 红灯', () => {
    withMirror({
        [DG_APP]: (s) => mutateOnce(
            mutateOnce(s, '    collect() {', '    snapshot() {'),
            'this.collect()', 'this.snapshot()'),
    }, (dir) => {
        const r = runGate(dir, 'scripts/bridge-contract-audit.mjs');
        assert.equal(r.ok, false, '调用式读桥形态必须红灯');
        assert.ok(r.out.includes('J2'), '红灯须指向 J2：' + r.out.slice(0, 300));
        assert.ok(r.out.includes('diagnose-app.js'), '红灯须点名该文件：' + r.out.slice(0, 300));
    });
});

test('v299 F5. 负控制：新增一个零消费导出 ⇒ dead-exports 红灯并点名', () => {
    withMirror({
        [SK]: (s) => mutateOnce(s, 'export default {', 'export function __probeZeroConsumer(x) { return x; }\nexport default {'),
    }, (dir) => {
        const r = runGate(dir, 'scripts/dead-export-check.mjs');
        assert.equal(r.ok, false, '零消费导出必须红灯');
        assert.ok(r.out.includes('__probeZeroConsumer'), '红灯须点名该导出：' + r.out.slice(0, 400));
    });
});

test('v299 F6. 负控制：三态判定被写成常量 ⇒ A4 的同款真判据在副本上转红', async () => {
    /* 判据与 A4 同族但更直接：真源 faceFieldState 被改成永远返回 legacy-unknown，
     *   于是「上游声明了值为空」与「旧版读不出」重新同形 —— 正是 v2.98 修掉的那个形态。 */
    const ft = { roundTrip: { present: true, kind: 'null' } };
    const snap = { roundTrip: null, meta: { fieldTypes: ft } };
    assert.equal(SK_MOD.sourceKeyRulebook().knownTypes.length > 0, true);
    const origState = (await import(at('config/world-bridge.js'))).faceFieldState(snap, ['roundTrip']);
    assert.equal(origState, 'declared-empty', '原版必须能把「声明了、值为空」认出来');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v299-d4-'));
    try {
        copyTreeSafe(path.join(ROOT, 'config'), path.join(dir, 'config'));
        const rel = 'config/world-bridge.js';
        const broken = mutateOnce(read(rel), F6_ANCHOR, F6_BROKEN);
        fs.writeFileSync(path.join(dir, rel), broken);
        const mod = await import(pathToFileURL(path.join(dir, rel)).href + '?brk=' + Date.now());
        assert.equal(mod.faceFieldState(snap, ['roundTrip']), 'legacy-unknown',
            '破坏后副本必须退回旧行为（两种处境重新同形）');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
