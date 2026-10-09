/* ============================================================
 * tests/system-v3790.test.mjs — R-O6 第二层：非必要动画 / 后台降频 / 有界被动采样 [v3.79.0]
 * ------------------------------------------------------------
 * 本版治的是计划 R-O6 的**第二层**（第一层 v3.76.0 已交付规模探针与媒体指令契约）：
 *   ③ 优先移除非必要动画与粒子；
 *   ④ 后台降频与恢复后重取一起设计，避免恢复瞬间全量重算；
 *   ⑤ 性能读数被动采样、有界保存，守护器自身不得常驻拖累。
 *
 * 修前实测的处境（浏览器层 / Chromium 131 / headless old / 单帧 dump，不是推演）：
 *   · `prefers-reduced-motion` 全仓零命中、`animation-play-state` 全仓零命中；
 *   · 卡片布局首页的黑胶唱片 `yzp-home-vinyl-spin` 是 `Infinity / running`，
 *     把页面标记为隐藏后**仍 running**；
 *   · 宠物 video 在面板关闭与页面隐藏两种状态下都还在播（`paused=false`）；
 *   · 全仓 `PerformanceObserver` / `document.getAnimations` 零命中 ——
 *     已有读数全是**主动调用式**，「用户实际体验到了什么」在两次调用之间是空白。
 *
 * 本套件守五件事（全部在**真源码 / 真进程 / 真磁盘**上成立，不看注释）：
 *   A 结构面：两个新模块、探针与基线、两份浏览器场景、phone.css 段与属性、唯一写入口；
 *   B 对账面：探针读数与基线逐字段相等 / 位置无关 / 两次 spawn 逐字节一致；
 *   C 行为面：六条探针判据全绿 + 四个纯函数的**真功能**断言（档位三源优先级、
 *     四态闸门互不同形、档位属性契约、无宿主降级不抛）；
 *   D 负控制：真源码定点破坏（档位判定 / phone.css 降频规则 / 采样器上界 / 模块缺席）；
 *   F 版本锚（下限形，不锚死当版）。
 *
 * 分工：
 *   · 本套件回答「接线对不对、判据会不会真红」；
 *   · `tests/browser/scenarios/o6-motion-throttle.scen.js` 回答「真浏览器里动画与宠物
 *     到底停没停」（读 playState / paused，不读我们写的属性）；
 *   · `tests/audit/perf_sampler_probe.cjs` 回答「采样器有没有界、是不是真被动」。
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

const MOTION = 'config/motion.js';
const SAMPLER = 'config/perf-sampler.js';
const PROBE = 'tests/audit/perf_sampler_probe.cjs';
const BASEF = 'tests/audit/perf_sampler_baseline.json';
const SCENE_MOTION = 'tests/browser/scenarios/o6-motion-throttle.scen.js';
const SCENE_EXTREME = 'tests/browser/scenarios/o6-longlist-extreme.scen.js';
const CSS = 'phone.css';
const SETTINGS = 'apps/settings/settings-app.js';
const KEYS_AUDIT = 'scripts/keys-audit.mjs';
const V3770 = 'tests/system-v3770.test.mjs';
const SELF_REL = 'tests/system-v3790.test.mjs';

const MOTION_SRC = exists(MOTION) ? read(MOTION) : '';
const SAMPLER_SRC = exists(SAMPLER) ? read(SAMPLER) : '';
const PROBE_SRC = exists(PROBE) ? read(PROBE) : '';
/* D5 用：探针的相对路径（read() 不接受已拼接的绝对路径） */
const PROBE_SRC_REL = PROBE;
const CSS_SRC = read(CSS);

const MOD = await import(pathToFileURL(path.join(ROOT, MOTION)).href).catch(() => null);
const SAMP = await import(pathToFileURL(path.join(ROOT, SAMPLER)).href).catch(() => null);

const runProbe = (root) => {
    const args = [path.join(root, PROBE), '--json'];
    if (root !== ROOT) args.push('--root', root);
    const r = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 120000 });
    let parsed = null;
    try { parsed = JSON.parse(String(r.stdout || '')); } catch (_e) { parsed = null; }
    return { status: r.status, parsed, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') };
};
const runProbeAt = (probeAbs, root) => {
    const r = spawnSync(process.execPath, [probeAbs, '--json', '--root', root], { cwd: root, encoding: 'utf8', timeout: 120000 });
    let parsed = null;
    try { parsed = JSON.parse(String(r.stdout || '')); } catch (_e) { parsed = null; }
    return { status: r.status, parsed };
};

/* -------------------- 镜像根（逐文件复制，不用 cp -al） --------------------
 * 本容器以 proot `--link2symlink` 运行：任何硬链接创建都会被模拟成
 * 「源文件改名成 .l2s.* 别名 + 原名处放符号链接」，**反过来改写被复制的源树**。
 * 这条在本仓已被两次实测记录（v2.65.0 的 425 个文件、v3.77.0 的 git clone），
 * 且 v3.78.0 把它做成了第十五段静态门。故此处一律逐文件复制。 */
const MIRROR_FILES = [PROBE, 'manifest.json', SAMPLER];
/* [v3.79.0 收口] 镜像面带上 CSS —— 本套件的对账面里 CSS 不是必需的，但镜像根与真仓
 *   应当同形（缺一整个类别会让「换个根读数就不一样」这类问题更晚才被发现）。
 *   注：L8 的扫描面自本版起是**递归全仓 CSS**（修前只扫 phone.css，
 *   实测漏掉 14 处）。故镜像根必须把全部 .css 一起带上：不铺它 ⇒ L8 在副本上
 *   读到 css=0 而永久转红（判据的**输入面**缺失，不是被测对象坏了 —— 本仓治过的假红形态）。
 *   枚举口径与探针内那份逐字同源（D5 看守）；此处不 import tests/_repo_css.mjs，
 *   理由见该段注释：套件的镜像面不能依赖一个探针在副本根里可能读不到的模块。 */
function allCssUnder(root) {
    const out = [];
    (function walk(dir, depth) {
        if (depth > 6) return;
        let names = [];
        try { names = fs.readdirSync(dir); } catch (_e) { return; }
        for (const nm of names) {
            if (nm === 'node_modules' || nm === '.git') continue;
            const abs = path.join(dir, nm);
            let st = null;
            try { st = fs.statSync(abs); } catch (_e) { continue; }
            if (st.isDirectory()) walk(abs, depth + 1);
            else if (nm.slice(-4) === '.css') out.push(path.relative(root, abs));
        }
    })(root, 0);
    return out.sort();
}
MIRROR_FILES.push(...allCssUnder(ROOT));
let MIRROR = null;
function mirror() {
    if (MIRROR) return MIRROR;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'o6m379-'));
    try {
        for (const rel of MIRROR_FILES) {
            const dst = path.join(dir, rel);
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            fs.copyFileSync(path.join(ROOT, rel), dst);
        }
    } catch (e) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e2) { /* 忽略 */ }
        assert.fail('镜像根建不起来（逐文件复制失败）：' + String((e && e.message) || e).slice(0, 200));
    }
    MIRROR = dir;
    process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } });
    return MIRROR;
}
function breakFile(mirrorRoot, rel, mutator) {
    const abs = path.join(mirrorRoot, rel);
    const src = fs.readFileSync(abs, 'utf8');
    const next = mutator(src);
    if (next === src) assert.fail('破坏没有真正发生（锚点未命中）：' + rel);
    fs.rmSync(abs);
    fs.writeFileSync(abs, next);
    return abs;
}

/* ══════════════════ A 结构面 ══════════════════ */
test('v3790 A1. 两个新模块在场，导出面与契约常量齐备（缺一项即接线未完成）', () => {
    assert.ok(exists(MOTION), '必须落盘：' + MOTION);
    assert.ok(exists(SAMPLER), '必须落盘：' + SAMPLER);
    assert.ok(MOD, 'config/motion.js 必须可被 Node 直接 import');
    for (const k of ['MOTION_LEVELS', 'MOTION_LEVEL_LIST', 'REDUCED_MOTION_QUERY', 'MOTION_ATTR', 'STILL_ATTR', 'BG_ATTR',
        'MOTION_STORAGE_KEY', 'RESUME_EVENT', 'normalizeMotionLevel', 'readReducedMotion', 'resolveMotionLevel',
        'isStillLevel', 'applyMotionLevel', 'applyMotionGate', 'motionGate', 'bindVisibilityGate', 'createResumeScheduler']) {
        assert.ok(k in MOD, 'config/motion.js 缺导出：' + k);
    }
    assert.ok(SAMP, 'config/perf-sampler.js 必须可被 Node 直接 import');
    for (const k of ['createPerfSampler', 'SAMPLER_LIMIT', 'SAMPLER_ENTRY']) {
        assert.ok(k in SAMP, 'config/perf-sampler.js 缺导出：' + k);
    }
    /* 档位取值必须四态互不相同：这是「用户自己选的减动」与「系统帮它省电」不同形的前提。 */
    const lv = MOD.MOTION_LEVEL_LIST;
    assert.equal(new Set(lv).size, 4, '档位必须四态互不相同：' + lv.join('/'));
    assert.equal(MOD.MOTION_LEVEL_LIST.indexOf(MOD.MOTION_LEVELS.AUTO) >= 0, true, 'auto 必须在表内');
});

test('v3790 A2. 采样探针与基线同在，基线冻结在建基线时的当版', () => {
    assert.ok(exists(PROBE), '必须落盘：' + PROBE);
    assert.ok(exists(BASEF), '必须落盘：' + BASEF);
    const base = JSON.parse(read(BASEF));
    assert.equal(base.measured_at, 'v3.78.0', 'measured_at 是建基线时的**冻结历史值**，不随抬版漂移（实得 ' + base.measured_at + '）');
    assert.equal(base.module, SAMPLER, '基线的 module 必须指向被测量的那一份真源');
    assert.ok(Array.isArray(base.criteria) && base.criteria.length >= 6, '基线必须带六条判据（实得 ' + (base.criteria || []).length + '）');
    assert.ok(Array.isArray(base.corrections) && base.corrections.length >= 3, '必须留下被否掉的候选（不写下来 = 下一轮重走一遍）');
    assert.ok(Array.isArray(base.not_done) && base.not_done.length >= 3, '必须留下「没做什么」');
    /* 位置无关 + fail-closed 契约由探针自己带（不靠套件兜底）。 */
    assert.ok(/--root/.test(PROBE_SRC) && /--json/.test(PROBE_SRC), '探针必须支持 --root 与 --json');
    assert.ok(/process\.exit\(2\)/.test(PROBE_SRC) && PROBE_SRC.includes('fail-closed'), '探针必须自带 fail-closed（exit 2）');
    assert.ok(/__dirname/.test(PROBE_SRC) && !PROBE_SRC.includes('/home/'), '根不得写字面量绝对路径（位置无关）');
});

test('v3790 A3. 两份浏览器场景在场且不在取证前缀内（`_` 前缀不进扫描面）', () => {
    for (const rel of [SCENE_MOTION, SCENE_EXTREME]) {
        assert.ok(exists(rel), '必须落盘：' + rel);
        assert.ok(!path.basename(rel).startsWith('_'), '交付场景不得用 `_` 前缀（那是取证探针）：' + rel);
    }
    const m = read(SCENE_MOTION);
    for (const name of ['o6m-level-carrier', 'o6m-decorative-stops', 'o6m-background-throttle', 'o6m-resume-restores', 'o6m-sampler-bounded', 'o6m-not-a-frame-time']) {
        assert.ok(m.includes(name), '动效场景缺读数：' + name);
    }
    /* 关键：判据必须读**浏览器自己的结果**（playState / paused），不是读我们写的属性。 */
    assert.ok(/getAnimations/.test(m), '必须读 document.getAnimations（浏览器结果）');
    assert.ok(/playState/.test(m), '必须读 playState（属性只是请求，playState 才是结果）');
    assert.ok(/\.paused/.test(m), '必须读 video 的 paused（不看我们自己调了什么）');
    assert.ok(/不是\*\*帧率/.test(m), '必须把「本读数不是帧率」写进读数，而不只是注释');
    const x = read(SCENE_EXTREME);
    for (const name of ['o6x-extreme-scale', 'o6x-extreme-media-contract', 'o6x-extreme-reopen-10-ledger-stable', 'o6x-extreme-restore-keeps-live-dom']) {
        assert.ok(x.includes(name), '极端档场景缺读数：' + name);
    }
    assert.ok(/LINES = 4000/.test(x), '极端档必须是 4000 楼（与探针 n4000 同量级，否则两边读数不可并读）');
});

test('v3790 A4. phone.css 段与两个属性：段头独立成行、四路降频规则齐备', () => {
    const HDR = '/* ---------- [v3.79.0] 动效档位（全局，非 App 段） ---------- */';
    const cnt = CSS_SRC.split(HDR).length - 1;
    assert.equal(cnt, 1, 'phone.css 必须恰好带一次本段段头（实得 ' + cnt + '）');
    /* 段头必须**独立成行**（本仓踩过粘连坑：语法合法但样式挂错选择器）。 */
    const idx = CSS_SRC.indexOf(HDR);
    const ls = CSS_SRC.lastIndexOf(String.fromCharCode(10), idx) + 1;
    assert.equal(ls, idx, '段头必须从行首开始');
    const at = CSS_SRC.indexOf(HDR);
    const rest = CSS_SRC.slice(at);
    const nxt = rest.indexOf('/* ---------- [', 1);
    assert.ok(nxt === -1 || nxt > 0, '取段口径必须能截到本段');
    /* 四路规则：装饰类（data-still）/ 政策兜底（prefers-reduced-motion 且带 html:not([data-motion])）/ */
    /* 处境类（data-bg）/ 静止档（data-motion="still"）。四路语义不同，缺一路就是一处停不下来的动画。 */
    assert.ok(/html\[data-still="1"\]/.test(CSS_SRC), '必须有一条按 data-still 关装饰类动画的规则（写 0 与移除是两件事：属性存在即生效）');
    assert.ok(/html\[data-bg\]/.test(CSS_SRC), '必须有一条按 data-bg 停动画的规则（后台处境，恢复后属性必须消失）');
    assert.ok(/prefers-reduced-motion/.test(CSS_SRC), '必须有政策兜底块（脚本未跑到时也生效）');
    assert.ok(/html:not\(\[data-motion\]\)/.test(CSS_SRC), '政策兜底段必须让位于 JS 写入的 data-motion（否则用户显式选「全开」也不成立）');
    assert.ok(/html\[data-motion="still"\]/.test(CSS_SRC), '静止档必须有一族「连状态类动画与过渡一起停」的规则');
    const infiniteSites = (CSS_SRC.match(/animation:[^;]*infinite[^;]*;/g) || []).length;
    const stillRefs = (CSS_SRC.match(/data-still="1"\]/g) || []).length;
    assert.ok(infiniteSites > 0, '前提：phone.css 里应当有带 infinite 的动画（否则本判据测不到东西）');
    assert.ok(stillRefs >= infiniteSites, '每处 infinite 都必须被 data-still 规则覆盖：infinite=' + infiniteSites + ' covered=' + stillRefs);
});

test('v3790 A5. 写入口唯一 + 键已登记 + 运行时挂在唯一出口上', () => {
    /* 设置页是这条键的唯一写入口（读侧在 config/motion.js 与 index.js 的运行时）。 */
    const settings = read(SETTINGS);
    const writes = settings.split("set('sys_motion_level'").length - 1;
    assert.equal(writes, 1, '设置页必须恰有一处写本键（实得 ' + writes + '）');
    assert.ok(settings.includes('phone-motion-level'), '设置页必须有本档的下拉控件');
    assert.ok(read(KEYS_AUDIT).includes("key: 'sys_motion_level'"), 'keys-audit 必须登记本键（未登记即 K1 红灯）');
    const idx = read('index.js');
    assert.ok(idx.includes('initMotionRuntime()'), 'index.js 必须真起运行时');
    assert.ok(idx.includes('motion: motionRuntime'), '运行时必须挂到 VirtualPhone 这个唯一出口');
    assert.ok(idx.includes('applyMotionGate(document'), '闸门结果必须真的写到 documentElement 上');
    /* 后台降频的两个消费方（宠物 / 锁屏时钟）必须真接上闸门。 */
    assert.ok(read('phone/pet-controller.js').includes('setActive('), '宠物控制器必须提供 setActive（降频口）');
    assert.ok(read('phone/floating-entry.js').includes('applyMotionGate()'), '悬浮层必须在宠物创建点绑可见性闸');
    assert.ok(read('phone/lock-screen.js').includes('document.hidden === true'), '锁屏时钟必须在隐藏期不重算');
});

/* ══════════════════ B 对账面 ══════════════════ */
test('v3790 B1. 真仓跑探针：六条判据读数与基线逐字段相等', () => {
    const base = JSON.parse(read(BASEF));
    const r = runProbe(ROOT);
    assert.equal(r.status, 0, '探针必须正常退出（stderr：' + r.stderr.slice(0, 300) + '）');
    assert.ok(r.parsed, '探针必须吐出 JSON');
    assert.deepEqual(r.parsed.readings, base.readings, '读数与基线必须逐字段相等（环境相关的量不得混进读数）');
});

test('v3790 B2. 位置无关：镜像根上跑出同一份读数', () => {
    const base = JSON.parse(read(BASEF));
    const m = mirror();
    const r = runProbeAt(path.join(m, PROBE), m);
    assert.equal(r.status, 0, '镜像根上必须同样能跑：' + String(r.stderr || '').slice(0, 300));
    assert.ok(r.parsed);
    assert.deepEqual(r.parsed.readings, base.readings, '换个根就换读数 ⇒ 必是路径依赖，不是位置无关');
});

test('v3790 B3. 读数在两次独立 spawn 之间逐字节一致（可复算）', () => {
    const a = runProbe(ROOT);
    const b = runProbe(ROOT);
    assert.ok(a.parsed && b.parsed);
    assert.equal(JSON.stringify(a.parsed.readings), JSON.stringify(b.parsed.readings),
        '同一输入两次读数不一致 ⇒ 读数里混进了环境相关的量');
});

/* ══════════════════ C 行为面 ══════════════════ */
test('v3790 C1. 探针六条判据全绿（有界 / 读序 / 三态 / 被动 / 幂等 / 可复算）', () => {
    const r = runProbe(ROOT);
    assert.ok(r.parsed);
    assert.ok(Array.isArray(r.parsed.criteria) && r.parsed.criteria.length >= 6, '判据数不足（实得 ' + (r.parsed.criteria || []).length + '）');
    const failed = r.parsed.criteria.filter((c) => !c.pass).map((c) => c.id);
    assert.deepEqual(failed, [], '未通过：' + failed.join(','));
});

test('v3790 C2. 闸门四态互不同形（面板 / 页面两轴的四种组合各有自己的名字）', () => {
    const g = MOD.motionGate;
    const cases = [
        [true, true, 'foreground'],
        [false, true, 'panel-hidden'],
        [true, false, 'doc-hidden'],
        [false, false, 'both-hidden'],
    ];
    const names = new Set();
    for (const [p, d, want] of cases) {
        const r = g(p, d);
        assert.equal(r.reason, want, 'panel=' + p + ' doc=' + d + ' 应为 ' + want + '，实得 ' + r.reason);
        names.add(r.reason);
    }
    assert.equal(names.size, 4, '四种处境的名字必须互不相同（塌成两态就无法回答「为什么它是静止的」）');
    assert.equal(g(true, true).active, true, '只有「面板可见 + 页面可见」才 active');
    for (const [p, d] of [[false, true], [true, false], [false, false]]) {
        assert.equal(g(p, d).active, false, 'panel=' + p + ' doc=' + d + ' 必须不活跃');
    }
    /* 非布尔入参不得被当成 true：缺席不是「可见」。 */
    assert.equal(g(undefined, undefined).active, false, '缺席不得当成可见');
    assert.equal(g(1, 1).active, false, '真值强转不得被当成可见（只认 === true）');
});

test('v3790 C3. 档位解析三源优先级：用户显式 > 系统政策 > 既有默认', () => {
    const R = MOD.resolveMotionLevel;
    /* ① 用户显式选择优先于政策（用户说「全开」时，系统说 reduce 也不改）。 */
    assert.deepEqual(R('full', { reducedMotion: true }), { level: 'full', source: 'user', reducedMotion: true });
    assert.deepEqual(R('still', { reducedMotion: false }), { level: 'still', source: 'user', reducedMotion: false });
    /* ② auto 听政策。 */
    assert.deepEqual(R('auto', { reducedMotion: true }), { level: 'reduced', source: 'policy', reducedMotion: true });
    assert.deepEqual(R('auto', { reducedMotion: false }), { level: 'full', source: 'policy', reducedMotion: false });
    /* ③ 问不到政策 ⇒ 沿用既有默认（full），**不得**替用户减动。 */
    assert.deepEqual(R('auto', {}), { level: 'full', source: 'default', reducedMotion: null });
    assert.deepEqual(R(undefined, undefined), { level: 'full', source: 'default', reducedMotion: null });
    /* ④ 未知档位回落 auto（不猜用户想要什么），再走政策。 */
    assert.equal(MOD.normalizeMotionLevel('ULTRA'), 'auto');
    assert.equal(MOD.normalizeMotionLevel(''), 'auto');
    assert.equal(R('ULTRA', { reducedMotion: true }).level, 'reduced');
    /* ⑤ 「问不到」与「明确说不用减动」必须不同形（读的是 reducedMotion 字段，不是 level）。 */
    assert.equal(R('auto', {}).reducedMotion, null, '问不到必须是 null');
    assert.equal(R('auto', { reducedMotion: false }).reducedMotion, false, '明确 false 不得被塌成 null');
});

test('v3790 C4. 档位属性契约：无宿主不抛；full 档必须**移除** data-still 而不是写 0', () => {
    const fakeDoc = (attrs = {}) => {
        const store = { ...attrs };
        return {
            documentElement: {
                setAttribute: (k, v) => { store[k] = String(v); },
                removeAttribute: (k) => { delete store[k]; },
                getAttribute: (k) => (k in store ? store[k] : null),
            },
            _store: () => store,
        };
    };
    /* 无宿主：必须返回 ok=false 且不抛（Node / 老宿主下安全降级）。 */
    const bad = MOD.applyMotionLevel(null, 'full');
    assert.equal(bad.ok, false, '无 documentElement 时必须 ok=false');
    assert.ok(String(bad.reason).length > 0, '必须给出可读原因（不是静默 false）');

    const rd = fakeDoc({ 'data-still': '1' });   // 先有旧值，验证移除语义
    const out = MOD.applyMotionLevel(rd, 'full', { reducedMotion: false });
    assert.equal(out.ok, true);
    assert.equal(out.level, 'full');
    assert.equal(out.still, false);
    assert.equal(rd._store()['data-motion'], 'full', 'data-motion 必须写**解析后**的档（不是原始 auto）');
    assert.equal('data-still' in rd._store(), false, 'full 档必须**移除** data-still（写 0 仍会被 [data-still] 命中）');

    const rs = fakeDoc({});
    MOD.applyMotionLevel(rs, 'reduced', { reducedMotion: true });
    assert.equal(rs._store()['data-still'], '1', 'reduced 档必须写 data-still=1');

    /* 闸门属性：后台写成因、前台**移除**（不是写空值）。 */
    const g = fakeDoc({});
    MOD.applyMotionGate(g, false, 'doc-hidden');
    assert.equal(g._store()['data-bg'], 'doc-hidden', '后台必须写成因');
    MOD.applyMotionGate(g, true, 'foreground');
    assert.equal('data-bg' in g._store(), false, '恢复后必须移除 data-bg');
    assert.equal(MOD.applyMotionGate(null, false, 'x').ok, false, '无宿主下闸门同样不抛');
});

test('v3790 C5. 恢复重取合成器：同 key 覆盖 / 有界丢弃 / flush 前清空（防自噬）', () => {
    const S = MOD.createResumeScheduler({ maxTasks: 3 });
    let ran = [];
    assert.equal(S.request('a', () => ran.push('a1')), true);
    assert.equal(S.request('a', () => ran.push('a2')), true, '同 key 覆盖必须被接受');
    assert.equal(S.request('b', () => ran.push('b')), true);
    assert.equal(S.request('c', () => ran.push('c')), true);
    assert.equal(S.request('d', () => ran.push('d')), false, '超过上限必须**如实拒绝**（不静默替换）');
    assert.equal(S.stats().dropped, 1, '被丢弃的必须计数');
    assert.equal(S.request('', () => {}), false, '空 key 必须被拒');
    assert.equal(S.request('e', null), false, '非函数必须被拒');
    /* flush：先清空台账再执行 —— 任务内再登记不得造成自噬循环。 */
    const r = S.flush('resume');
    assert.equal(r.ran, 3);
    assert.equal(r.failed, 0);
    assert.deepEqual(ran.sort(), ['a2', 'b', 'c'], '同 key 只跑最新那次（a2 而不是 a1）');
    assert.equal(S.stats().pending, 0, 'flush 后必须清空');
    assert.equal(S.stats().flushes, 1);
    /* 空台账 flush 不得虚报。 */
    assert.deepEqual(S.flush('resume'), { ran: 0, failed: 0, reason: 'resume' });
    assert.equal(S.stats().flushes, 1, '空 flush 不得计入次数');
    /* 抛错的任务必须被记账而不是让整批中断。 */
    const S2 = MOD.createResumeScheduler({ maxTasks: 2 });
    S2.request('bad', () => { throw new Error('boom'); });
    S2.request('good', () => {});
    const r2 = S2.flush('resume');
    assert.equal(r2.ran, 1);
    assert.equal(r2.failed, 1);
});

/* ══════════════════ D 真源码定点破坏（负控制） ══════════════════ */
let cachedMirror = null;
const mirrorFor = () => { cachedMirror = cachedMirror || mirror(); return cachedMirror; };

test('v3790 D1. 拆掉计数上界（count 不再停在 limit）⇒ 探针 P1（有界）必须转红', () => {
    const m = mirrorFor();
    breakFile(m, SAMPLER, (s) => {
        /* [v3.79.0 收口] 初版破坏写成 `Number.MAX_SAFE_INTEGER` —— 那仍是**有限数**，
     *   P1 照旧通过（实测：探针 exit 0、断言「实得 0」）。这不是判据弱，是**破坏不
     *   可观测**（本仓治过的形态：破坏一处产品从不走到的分支 = 装饰破坏）。
     *   改成「拆掉计数上界」—— count 不再停在 limit，而探针仍能正常吐 JSON。 */
    const anchor = '        if (count < limit) count += 1;';
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, '        count += 1;');
    });
    const r = runProbeAt(path.join(m, PROBE), m);
    assert.equal(r.status, 1, '有界性被破坏后探针必须以 1 收场（实得 ' + r.status + '）');
    const failed = r.parsed.criteria.filter((c) => !c.pass).map((c) => c.id);
    assert.ok(failed.includes('P1'), '必须点名 P1，实得：' + failed.join(','));
    assert.ok(!failed.includes('P3') && !failed.includes('P5'), '定点性：三态与幂等判据不得被这处破坏带红，实得：' + failed.join(','));
});

test('v3790 D2. 把「零定时器」破坏掉（采样器内起一个轮询）⇒ 探针 P4 必须转红', () => {
    const m = mirrorFor();
    breakFile(m, SAMPLER, (s) => {
        /* [v3.79.0 收口] 初版锚点写成 8 空格缩进，而真源码是 4 空格 ⇒ 恰中 0 次
         *   （实测：锚点必须恰中 1 次 / 0 !== 1），拦的是**判据自己**而不是产品。 */
        const anchor = '    const probe = () => {';
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, '    const probe = () => { setInterval(() => {}, 250);');
    });
    const r = runProbeAt(path.join(m, PROBE), m);
    const failed = r.parsed.criteria.filter((c) => !c.pass).map((c) => c.id);
    assert.ok(failed.includes('P4'), '守护器自己起了轮询 ⇒ P4（零定时器）必须转红，实得：' + failed.join(','));
});

test('v3790 D3. 删掉 config/perf-sampler.js ⇒ 探针必须 fail-closed（exit 2，不得发合格证）', () => {
    const m = mirrorFor();
    fs.rmSync(path.join(m, SAMPLER));
    const r = runProbeAt(path.join(m, PROBE), m);
    assert.equal(r.status, 2, '模块缺席必须 exit 2（实得 ' + r.status + '）');
    assert.equal(r.parsed, null, 'fail-closed 时不得吐出任何「合格」读数');
});

/* [v3.79.0 收口] 动效面（探针 L8）的**镜像面与负控制不在这里**，归 tests/system-v3770.test.mjs：
 *   本套件的镜像根只铺 [长列表前的采样面]，而 L8 属长列表探针、要读 chat-view 的输入闭包 ——
 *   在本镜像里跑它只会 fail-closed exit 2（那证明的是「输入面缺失」，不是「判据会响」）。
 *   本仓纪律：负控制必须在**它真正运行的那个环境**里做。 */

/* ══════════════════ E 交棒改写（判据面，不是放宽） ══════════════════ */
test('v3790 E1. v3770 的断言对象已按本版扩面改写，且改写理由留在文件里', () => {
    const s = read(V3770);
    /* 本版给长列表探针加了极端档判据 L7（同一媒体契约、第二个夹具），
     * 于是 v3770 D1 的「只红 L1/L2」不再是正确断言 —— 改写的是**断言的对象**
     * （要钉的是「这处缺陷会被读到」，不是「只被两条判据读到」），不是放宽。 */
    assert.ok(s.includes('L7'), 'v3770 必须已把 L7 纳入射程');
    assert.ok(s.includes('交棒改写'), '必须留下改写理由（否则后人会以为是漏改）');
    assert.ok(s.includes('定点性'), '必须保留定点性判据（L3~L6 不得被这处破坏带红）');
    assert.ok(s.includes("'phone.css'"), '镜像根清单必须含 phone.css（L8 的输入面）');
});

test('v3790 E2. 取段纪律：本段之外不得出现第二份同名段头（追加式产物的口径守卫）', () => {
    const HDR = '/* ---------- [v3.79.0] 动效档位（全局，非 App 段） ---------- */';
    const n = read(CSS).split(HDR).length - 1;
    assert.equal(n, 1, '段头必须恰好一次（实得 ' + n + '）—— 重复即说明有两份降频规则在互相覆盖');
});

/* ══════════════════ F 版本锚（下限形） ══════════════════ */
test('v3790 F1. 版本锚（下限形）：三处同源且不低于 3.79.0', () => {
    const VNUM = (v) => String(v).split('.').map(Number).reduce((a, x) => a * 1000 + x, 0);
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const log = JSON.parse(read('update-log.json'));
    assert.equal(man.version, pkg.version, 'manifest / package 必须同源');
    assert.equal(log.latest, man.version, 'update-log.latest 必须与 manifest 同源');
    assert.ok(VNUM(man.version) >= VNUM('3.79.0'), '本套件自 3.79.0 起成立；当前 ' + man.version);
});

console.log('\nv3790 done');
