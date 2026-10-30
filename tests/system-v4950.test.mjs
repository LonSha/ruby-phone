/* ============================================================
 * tests/system-v4950.test.mjs — v4.95.0 中枢清账首链判据档（计划 R11-O3）
 * ------------------------------------------------------------
 * 为什么要有这一档：`config/usage-paradigm.js` 整套（切换 / 自定 / 排序 / 通知过滤）
 *   此前只有 orchestrator 与测试在调，**产品端零消费**。这类失效形态本仓叫
 *   「导出有、调用点零」——它是全绿里最难看见的一种：所有门都通过，因为它们
 *   问的是「有没有导出」「有没有人 import」，而没人问过「用户在哪个屏幕上按得到」。
 *
 * 本档守的不是「文件存在」，而是**这条链在用户面真的成立**：
 *   用户切档 → 落盘 → 主屏重排 → 换档看得见差别 → 失败时不改盘。
 * 每一面都配了「破坏即红」的负控制，防止判据自己空转。
 *
 * 判据分六面：
 *   A 键单一真源：App 与主屏读同一个存储键，且与设置键分开
 *   B 切换真的改主屏：三档各自产生不同的桌面序（不是「都返回同一个数组」）
 *   C 只重排不删格：换挡前后格子集合恒等（范式不是禁用）
 *   D 失败不改盘：未知 id / 存储抛错时原状态原样保留，且原因是可读的
 *   E 自定档：另存 → 立刻生效；再另存覆盖而不堆积
 *   F 接线自证：主屏确实 import 了 resolveActiveParadigm（漏一行 import 会被
 *     try/catch 吞掉，症状是「换挡没反应但全绿」—— 本版真踩过）
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HomeScreen } from '../phone/home-screen.js';
import { UsageApp, PARADIGM_KEY } from '../apps/usage/usage-app.js';
import { CORE_DESKTOP_IDS } from '../config/app-clusters.js';
import { PARADIGM_IDS, resolveAppOrder } from '../config/usage-paradigm.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** 造一套「8 核心 + 若干聚合成员」的 App 表；成员刻意都是范式里真写到的 id。 */
const MEMBERS = [
    ['accounting', 'money'], ['focus', 'life'], ['health', 'body'],
    ['reading-studio', 'content'], ['worldbook', 'content'],
    ['multimedia-serial-studio', 'creative'], ['scenario-authoring-desk', 'creative'],
    ['creation-project', 'creative'], ['shop', 'money'], ['traveldesk', 'life'],
];
const buildApps = () => [
    ...CORE_DESKTOP_IDS.map((id) => ({ id, name: id, libraryCategory: null })),
    ...MEMBERS.map(([id, cat]) => ({ id, name: id, libraryCategory: cat })),
];

/** 内存存储（get/set 键值语义与本仓 storage 一致：存字符串）。 */
function makeStorage(init = {}) {
    const map = new Map(Object.entries(init));
    return {
        map,
        get(k) { return map.has(k) ? map.get(k) : null; },
        set(k, v) { map.set(k, v); return true; },
    };
}

/** 主屏实例：只取 buildIconPages 需要的两个成员（不跑真 DOM）。 */
function makeHome(storage) {
    const hs = Object.create(HomeScreen.prototype);
    hs.apps = buildApps();
    hs.getIconPageCapacity = () => 15;
    globalThis.window = { VirtualPhone: { storage } };
    return hs;
}

/** 桌面页 → 扁平化的「格子标签」序列（壳记作 [cat]，核心/成员记 id）。 */
const seq = (pages) => pages.flat().map((t) => (t.isCluster ? '[' + t.clusterOf + ']' : t.id));
/** 格子集合（用于「只重排不删格」判定）。 */
const setOf = (pages) => new Set(seq(pages));

/* ══════════════════════════════════════════════════════════════
 * A 键单一真源
 * ══════════════════════════════════════════════════════════════ */
test('A1: 主屏与洞察 App 读同一个范式键（不许有第二份副本）', () => {
    const st = makeStorage({ [PARADIGM_KEY]: JSON.stringify({ activeId: PARADIGM_IDS.CREATIVE }) });
    const hs = makeHome(st);
    const p = hs._activeParadigm();
    assert.equal(p && p.id, PARADIGM_IDS.CREATIVE, '主屏必须从 ' + PARADIGM_KEY + ' 读到创作档');

    // 负控制：把值写到**别的**键上，主屏必须读不到（证明它没在偷读第二处）
    const st2 = makeStorage({ some_other_key: JSON.stringify({ activeId: PARADIGM_IDS.CREATIVE }) });
    assert.equal(makeHome(st2)._activeParadigm().id, PARADIGM_IDS.LIFE, '别的键不得被当成范式源');
});

test('A2: 范式键与洞察设置键分离（清设置不该顺手重置全局范式）', () => {
    const st = makeStorage();
    const app = new UsageApp({ setContent() {} }, st);
    app.switchTo(PARADIGM_IDS.RESEARCH);
    const savedParadigm = st.get(PARADIGM_KEY);
    assert.ok(savedParadigm, '切换必须落盘');

    // 动设置：saveSettings 只写 usage_settings_v1，绝不能碰到范式键
    app.settings = { ...(app.settings || {}), injectToPrompt: true };
    app.saveSettings();
    assert.equal(st.get(PARADIGM_KEY), savedParadigm, '存设置不得改写范式键');

    // 反向：键名本身必须不同（同名字面量会让上面那条断言变成自我实现）
    assert.notEqual(PARADIGM_KEY, 'usage_settings_v1');
});

/* ══════════════════════════════════════════════════════════════
 * B 切换真的改主屏
 * ══════════════════════════════════════════════════════════════ */
test('B1: 三档各自产生不同的桌面序（换挡必须看得见差别）', () => {
    const st = makeStorage();
    const hs = makeHome(st);
    const app = new UsageApp({ setContent() {} }, st);

    const seen = new Map();
    for (const id of [PARADIGM_IDS.LIFE, PARADIGM_IDS.CREATIVE, PARADIGM_IDS.RESEARCH, PARADIGM_IDS.MINIMAL]) {
        const r = app.switchTo(id);
        assert.equal(r.success, true, '切 ' + id + ' 应当成功');
        seen.set(id, seq(hs.buildIconPages()).join(' '));
    }
    const uniq = new Set(seen.values());
    assert.equal(uniq.size, 4, '四档必须给出四个不同的桌面序，实得 ' + uniq.size
        + '\n' + [...seen.entries()].map(([k, v]) => k + ': ' + v).join('\n'));
    // 逐档点名：创作档的第一格必须是 creative 壳（它装着 creation-project 等优先项）
    assert.ok(seen.get(PARADIGM_IDS.CREATIVE).startsWith('[creative]'),
        '创作档首格应是 creative 壳，实得 ' + seen.get(PARADIGM_IDS.CREATIVE));
    assert.ok(seen.get(PARADIGM_IDS.RESEARCH).startsWith('[content]'),
        '研读档首格应是 content 壳，实得 ' + seen.get(PARADIGM_IDS.RESEARCH));
});

test('B2: 优先项真的被提前（不是碰巧排序）', () => {
    /* 直接对库层结果下断言：这才是「提前」的定义面。主屏只是它的消费者。 */
    const apps = buildApps();
    const life = resolveAppOrder(apps, { priorityApps: ['accounting'], deprioritizedApps: [] });
    const idx = (list, id) => list.findIndex((a) => a && a.id === id);
    assert.equal(idx(life, 'accounting'), 0, 'accounting 在优先清单里就必须站首位');

    // 负控制：换成「不优先 accounting」的另一档，它必须不再站首位
    const other = resolveAppOrder(apps, { priorityApps: ['worldbook'], deprioritizedApps: [] });
    assert.notEqual(idx(other, 'accounting'), 0, '不优先时 accounting 不该还在首位');
    assert.equal(idx(other, 'worldbook'), 0);
});

test('B3: 主屏排序不得因读不到范式而崩（坏键回归）', () => {
    for (const bad of ['{不是JSON', 'null', '"str"', '42', '{"activeId":"no-such"}']) {
        const st = makeStorage({ [PARADIGM_KEY]: bad });
        const hs = makeHome(st);
        const pages = hs.buildIconPages();
        assert.ok(Array.isArray(pages) && pages.length >= 1, '坏键 ' + bad + ' 时主屏必须仍出格子');
        assert.ok(setOf(pages).size >= CORE_DESKTOP_IDS.length, '坏键不得丢核心格');
    }
});

/* ══════════════════════════════════════════════════════════════
 * C 只重排不删格
 * ══════════════════════════════════════════════════════════════ */
test('C1: 换挡前后格子集合恒等（范式不是禁用）', () => {
    const st = makeStorage();
    const hs = makeHome(st);
    const app = new UsageApp({ setContent() {} }, st);
    const base = setOf(hs.buildIconPages());
    for (const id of [PARADIGM_IDS.CREATIVE, PARADIGM_IDS.RESEARCH,
        PARADIGM_IDS.IMMERSIVE, PARADIGM_IDS.MINIMAL]) {
        app.switchTo(id);
        const now = setOf(hs.buildIconPages());
        assert.equal(now.size, base.size, '切到 ' + id + ' 后格子数必须不变（不许删格）');
        for (const k of base) assert.ok(now.has(k), '切到 ' + id + ' 后丢了格子 ' + k);
    }
});

/* ══════════════════════════════════════════════════════════════
 * D 失败不改盘
 * ══════════════════════════════════════════════════════════════ */
test('D1: 未知 id 不改盘、原因是 unknown-paradigm-id、不静默落回生活档', () => {
    const st = makeStorage();
    const app = new UsageApp({ setContent() {} }, st);
    app.switchTo(PARADIGM_IDS.RESEARCH);
    const before = st.get(PARADIGM_KEY);

    const r = app.switchTo('no-such-paradigm');
    assert.equal(r.success, false);
    assert.equal(r.reason, 'unknown-paradigm-id', '原因必须可读，不能只说 false');
    assert.equal(st.get(PARADIGM_KEY), before, '失败必须不改盘');
    assert.equal(r.activeId, PARADIGM_IDS.RESEARCH, 'activeId 必须还是原来那档');

    // 负控制：真合法 id 必须能改盘（否则上面那条断言会因「谁都不改盘」而自我实现）
    assert.equal(app.switchTo(PARADIGM_IDS.MINIMAL).success, true);
    assert.notEqual(st.get(PARADIGM_KEY), before, '合法切换必须真的改盘');
});

test('D2: 存储 set 抛错 → 如实报 persist-failed，且不谎报成功', () => {
    const st = {
        map: new Map(),
        get(k) { return this.map.has(k) ? this.map.get(k) : null; },
        set() { throw new Error('disk full'); },
    };
    const app = new UsageApp({ setContent() {} }, st);
    const r = app.switchTo(PARADIGM_IDS.CREATIVE);
    assert.equal(r.success, false, '写盘失败不得报成功');
    assert.equal(r.reason, 'persist-failed', '原因必须是 persist-failed，实得 ' + r.reason);
});

test('D3: 无 storage（未挂载）时读写不抛错，读回默认档', () => {
    const app = new UsageApp({ setContent() {} }, null);
    assert.doesNotThrow(() => app.readParadigmState());
    assert.equal(app.activeParadigm().id, PARADIGM_IDS.LIFE, '无挂载时退回生活档');
    assert.doesNotThrow(() => app.switchTo(PARADIGM_IDS.CREATIVE));
});

/* ══════════════════════════════════════════════════════════════
 * E 自定档
 * ══════════════════════════════════════════════════════════════ */
test('E1: 另存为自定档 → 立刻生效，且主屏跟着变', () => {
    const st = makeStorage();
    const hs = makeHome(st);
    const app = new UsageApp({ setContent() {} }, st);

    app.switchTo(PARADIGM_IDS.MINIMAL);
    const beforeSeq = seq(hs.buildIconPages()).join(' ');

    const cp = app.copyToCustomParadigm(PARADIGM_IDS.RESEARCH);
    assert.equal(cp.success, true, '复制应当成功');
    assert.equal(cp.activeId, PARADIGM_IDS.CUSTOM, '复制完必须立刻切过去（用户按的是「复制并改用」）');

    const p = app.activeParadigm();
    assert.equal(p.id, PARADIGM_IDS.CUSTOM);
    assert.ok(p.priorityApps.includes('worldbook'), '自定档应继承研读档的优先项');
    assert.notEqual(seq(hs.buildIconPages()).join(' '), beforeSeq, '自定档生效后桌面序应变化');
});

test('E2: 重复另存不堆积（custom 档只存在一份）', () => {
    const st = makeStorage();
    const app = new UsageApp({ setContent() {} }, st);
    app.copyToCustomParadigm(PARADIGM_IDS.RESEARCH);
    app.copyToCustomParadigm(PARADIGM_IDS.CREATIVE);

    const stt = app.readParadigmState();
    const ids = Object.keys(stt.customParadigms || {});
    assert.equal(ids.length, 1, '自定档只应有一份，实得 ' + ids.length + ' 份：' + ids.join(','));
    assert.equal(ids[0], PARADIGM_IDS.CUSTOM);
    assert.ok((stt.customParadigms[PARADIGM_IDS.CUSTOM].priorityApps || []).includes('creation-project'),
        '第二次另存应覆盖为创作档的优先项');
});

test('E3: 自定档出现在可选清单里，且被标成非内置', () => {
    const st = makeStorage();
    const app = new UsageApp({ setContent() {} }, st);
    app.copyToCustomParadigm(PARADIGM_IDS.RESEARCH);
    const opts = app.paradigmOptions();
    const custom = opts.options.find((o) => o.id === PARADIGM_IDS.CUSTOM);
    assert.ok(custom, '自定档必须出现在清单里，否则用户切不回去');
    assert.equal(custom.builtin, false, '自定档必须标 builtin=false（界面靠它显示「自定」角标）');
    assert.equal(opts.activeId, PARADIGM_IDS.CUSTOM);
    // 内置各档都还在
    for (const id of [PARADIGM_IDS.LIFE, PARADIGM_IDS.CREATIVE, PARADIGM_IDS.RESEARCH,
        PARADIGM_IDS.IMMERSIVE, PARADIGM_IDS.MINIMAL]) {
        assert.ok(opts.options.some((o) => o.id === id), '内置档 ' + id + ' 不得从清单里消失');
    }
});

/* ══════════════════════════════════════════════════════════════
 * F 接线自证
 * ══════════════════════════════════════════════════════════════ */
test('F1: 主屏必须 import resolveActiveParadigm（漏这一行会被 try/catch 吞掉）', () => {
    /* 本版真踩过：`_activeParadigm()` 整段包在 try/catch 里，漏 import 时
     * 「标识符未定义」被 catch 吃掉、兜底那一次同样抛错，于是永久退回生活档。
     * 症状是「换挡没反应但界面全绿」。这条判据直接把 import 面钉住。 */
    const src = read('phone/home-screen.js');
    const imp = src.match(/import\s*\{[^}]*\}\s*from\s*'\.\.\/config\/usage-paradigm\.js'/);
    assert.ok(imp, 'home-screen.js 必须从 config/usage-paradigm.js 具名导入');
    assert.ok(/\bresolveActiveParadigm\b/.test(imp[0]), '导入列表必须含 resolveActiveParadigm');
    assert.ok(/\bresolveAppOrder\b/.test(imp[0]), '导入列表必须含 resolveAppOrder');

    // 负控制：把 import 里的 resolveActiveParadigm 去掉，正则必须判红
    const broken = src.replace(/(import\s*\{)([^}]*resolveActiveParadigm[^}]*)(\}\s*from\s*'\.\.\/config\/usage-paradigm\.js')/,
        (m, a, mid, c) => a + mid.replace(/resolveActiveParadigm\s*,?\s*/, '') + c);
    assert.notEqual(broken, src, '负控制必须真的改到源码（否则本条是自我实现）');
    const bImp = broken.match(/import\s*\{[^}]*\}\s*from\s*'\.\.\/config\/usage-paradigm\.js'/);
    assert.ok(!/\bresolveActiveParadigm\b/.test(bImp[0]), '去掉后判据必须看得见');
});

test('F2: 洞察 App 与 View 都真的用到范式接口（界面不是摆设）', () => {
    const appSrc = read('apps/usage/usage-app.js');
    for (const m of ['readParadigmState', 'activeParadigm', 'paradigmOptions', 'switchTo',
        'saveParadigm', 'copyToCustomParadigm', 'paradigmIds']) {
        assert.ok(new RegExp('\\b' + m + '\\s*\\(').test(appSrc), 'App 必须定义 ' + m);
    }
    const viewSrc = read('apps/usage/usage-view.js');
    for (const m of ['paradigmOptions', 'activeParadigm', 'switchTo', 'copyToCustomParadigm', 'paradigmIds']) {
        assert.ok(new RegExp('this\\.app\\.' + m + '\\s*\\(').test(viewSrc),
            'View 必须真的调 app.' + m + '（否则 App 侧接口又成了零消费）');
    }
    assert.ok(/_paradigmHTML\s*\(/.test(viewSrc), 'View 必须有范式区块渲染');
    assert.ok(/\.uq-pg-btn/.test(viewSrc), 'View 必须给切换按钮挂事件');
});

test('F3: 主屏排序对「壳」取壳内最靠前成员的名次（否则范式对聚合成员全无效果）', () => {
    /* 这条是设计判据：范式里的优先项多为聚合壳成员。若主屏只按 15 个桌面格子排序，
     * 生活档里真正会动的只有 wechat / calendar —— 用户换挡看不到区别。 */
    const apps = buildApps();
    const st = makeStorage();
    const hs = makeHome(st);
    hs.apps = apps;
    const seqMinimal = seq(hs.buildIconPages());
    // 极简档的优先项是 wechat / focus；focus 在 life 壳里，
    // 因此 life 壳必须排在 money/body/content/creative 之前（它们只有降权项或中性项）。
    const pos = (label) => seqMinimal.indexOf(label);
    assert.ok(pos('[life]') >= 0, 'life 壳必须在桌面上');
    assert.ok(pos('[life]') < pos('[content]') || pos('[content]') === -1,
        'life 壳（装着 focus）应排在 content 壳前，实得 ' + seqMinimal.join(' '));
});

test('F4: 模块入度账本已把 config/usage-paradigm.js 摘除（升档后必须清账）', () => {
    /* ★ 这条判据本身踩过一次坑，如实记下：首版写成
     *   `e.module || e.file`，而账本条目的字段叫 **`rel`** —— 于是 hit 恒为 false，
     *   判据在「账本里明明还有这条」的情况下照样绿。这正是本仓最贵的形态：
     *   判据空了转，却给出「已验证」的读数。修法不是改断言，是先把**字段名**钉住：
     *   A1 先证明账本条目真的有 rel 字段且能被读到，A2 才敢用它下结论。
     * 为什么本版必须清这条账：该模块从 orchestrator-only 升进 product 面
     *   （主屏 + 洞察 App 都真 import 了），留着旧条目等于账本在说谎。 */
    const base = JSON.parse(read('scripts/dead-module-baseline.json'));
    const list = base.entries;
    assert.ok(Array.isArray(list) && list.length > 0, '账本必须可读且有条目（空账本会让下面全部空转）');

    // A1 字段名自证：每条都必须有 rel（否则下面的比对永远找不到东西 = 假绿）
    const noRel = list.filter((e) => !e || typeof e.rel !== 'string');
    assert.equal(noRel.length, 0, '账本条目必须都有 rel 字段，实得 ' + noRel.length + ' 条没有：'
        + JSON.stringify(noRel.slice(0, 2)));

    // A2 真结论
    const hit = list.filter((e) => e.rel === 'config/usage-paradigm.js');
    assert.equal(hit.length, 0,
        'config/usage-paradigm.js 已进产品面，不得再留在模块账本里（实得 ' + JSON.stringify(hit) + '）');

    // A3 负控制：把条目塞回去，同款判据必须看得见（证明 A2 不是自我实现）
    const planted = [...list, { rel: 'config/usage-paradigm.js', tier: 'orchestrator-only', importers: [] }];
    assert.equal(planted.filter((e) => e.rel === 'config/usage-paradigm.js').length, 1,
        '负控制必须真的能命中（若这里也是 0，说明判据写法又错了）');
});
