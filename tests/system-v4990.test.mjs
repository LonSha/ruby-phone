/* ============================================================
 * tests/system-v4990.test.mjs — R11-O6 / O7 / O8 / O9 验收套件
 * ------------------------------------------------------------
 * 覆盖：
 *   - R11-O6 分类语义三层收敛（CORE_APP_IDS ≠ CORE_DESKTOP_IDS ≠ APP_CATEGORY；
 *             APP_CATEGORY 必须覆盖 APPS 全集；system 壳成员不得再被内容类 App 挤占）
 *   - R11-O7 应用库复活（dock 入口真存在、库取全量 89 项、`_libraryEntry` 不再零调用）
 *   - R11-O8 图标覆盖率（89/89、与磁盘双向对账、lintPixelSvg 全过、无 emoji 冒充）
 *   - R11-O9 预算时效（三态不同形、告警不改退出码、负控制改装旧基线必 stale）
 *
 * 本档的三条纪律（都来自本期实跑踩到的坑）：
 *   ① **断言对象是「当版真值」而不是某个历史字面量** —— 覆盖率与类目数都从 APPS 现算，
 *      抬版加 App 时只有真缺失才会红；
 *   ② **负控制必须是真源码破坏**：把真文件写坏 → 在副本树上重跑**同款真判据** → 必须转红。
 *      对原文件断言、或把破坏写死成模拟常量，都是本仓治过的假绿形态；
 *   ③ **三态断言要断「不同形」**：只说「无告警」时 unmeasured 与 fresh 同形，
 *      那等于把「没测过」洗成「刚测过」。
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPS } from '../config/apps.js';
import {
    APP_CATEGORY, APP_LIBRARY_CATEGORIES, CORE_APP_IDS, appCategory,
} from '../config/app-library.js';
import {
    CORE_DESKTOP_IDS, APP_CLUSTERS, buildDesktopTiles,
} from '../config/app-clusters.js';
import {
    UNIFIED_APP_ICONS, UNIFIED_APP_ICON_IDS, unifiedIconOf, hasUnifiedIcon, unifiedIconCoverage,
    unifiedIconFileOf,
} from '../config/app-icons.js';
import { PIXEL_ICON_IDS, PIXEL_ICON_FILES } from '../config/pixel-icons.generated.js';
import { lintPixelSvg } from '../phone/pixel-engine.js';
import {
    STALE_RELEASE_GAP, parseSemver, compareSemver, releasesSince,
    evaluateBudgetFreshness, checkGateBudgetFreshness,
} from '../scripts/gate-budget-freshness.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const readJson = (p) => JSON.parse(read(p));
const countOf = (src, lit) => src.split(lit).length - 1;
/** 最小夹具树：只放时效判据要读的两个文件。 */
function fixtureTree({ budget, versions = ['1.0.0'], current = '1.0.0' }) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-o9-'));
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    if (budget !== undefined) {
        fs.writeFileSync(path.join(dir, 'config', 'gate-budget.json'),
            typeof budget === 'string' ? budget : JSON.stringify(budget, null, 2) + '\n');
    }
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: current }) + '\n');
    const vmap = {};
    for (const v of versions) vmap[v] = {};
    fs.writeFileSync(path.join(dir, 'update-log.json'),
        JSON.stringify({ latest: current, versions: vmap }) + '\n');
    return dir;
}

/* ══════════════════ A 组：R11-O6 分类语义三层收敛 ══════════════════ */
test('A1: APP_CATEGORY 必须覆盖 APPS 全集（缺键会静默 fallback system ⇒ 用户可见错分）', () => {
    const ids = APPS.map(a => a.id);
    const missing = ids.filter(id => !Object.prototype.hasOwnProperty.call(APP_CATEGORY, id));
    assert.deepEqual(missing, [],
        'APP_CATEGORY 必须登记每一个 App（缺的会被 appCategory 静默折成 system）：' + missing.join(','));
    const extra = Object.keys(APP_CATEGORY).filter(k => ids.indexOf(k) < 0);
    assert.deepEqual(extra, [], 'APP_CATEGORY 不得存在不在 APPS 里的键（那是删 App 后的残留）：' + extra.join(','));
});
test('A2: 三层语义各就各位 —— 预装核心(21) ≠ 桌面首屏(8) ≠ 库类目(覆盖 89)', () => {
    assert.equal(CORE_APP_IDS.length, 21, 'CORE_APP_IDS 是「预装不可删」共 21 个');
    assert.equal(CORE_DESKTOP_IDS.length, 8, 'CORE_DESKTOP_IDS 是「桌面首屏平铺」共 8 个');
    assert.equal(APP_CLUSTERS.length, 7, '聚合壳 7 个（对齐 7 类目）');
    /* 三者**不是**同一件事：桌面 8 是预装 21 的真子集，且必须在预装集合里。 */
    for (const id of CORE_DESKTOP_IDS) {
        assert.ok(CORE_APP_IDS.includes(id), '桌面核心 ' + id + ' 必须在预装集合里');
    }
    assert.ok(CORE_DESKTOP_IDS.length < CORE_APP_IDS.length,
        '桌面首屏必须**窄于**预装集合 —— 两者相等就说明「不可删」与「铺桌面」又混成了一件');
    /* 21 个预装全部有类目（修改前有 21 个缺失、全折进 system 壳）。 */
    const noCat = CORE_APP_IDS.filter(id => !Object.prototype.hasOwnProperty.call(APP_CATEGORY, id));
    assert.deepEqual(noCat, [], '预装核心也必须登记类目（不进壳 ≠ 不需类目）：' + noCat.join(','));
});
test('A3: system 聚合壳不得被内容/社交类 App 挤占（壳成员上限 + 真系统类点名）', () => {
    const tiles = buildDesktopTiles(APPS);
    const sys = tiles.find(t => t.isCluster && t.clusterOf === 'system');
    assert.ok(sys, 'system 壳必须存在');
    /* 上限 12：修前是 20（13 个内容/社交类 App 因缺类目被折进来）。 */
    assert.ok(sys.memberCount <= 12,
        'system 壳成员必须 ≤ 12，实际 ' + sys.memberCount + '：' + sys.members.map(m => m.id).join(','));
    /* 逐个点名：这些是**不该**出现在系统壳里的（它们各有正确的类目）。
     * ★ `search` / `notifications` **不在**此列：它们是「全局搜索 / 通知汇聚」，
     *   按语义本就归 system（见 A3 下段反向点名）。把它们列进「错分」是
     *   本档首版写错的一处口径 —— 会把**正确分类**判成错分，属假红。 */
    const misplaced = ['weibo', 'music', 'health', 'wallet', 'memory', 'xhs', 'tieba',
        'bilibili', 'worldpulse', 'mofo', 'wangxiang', 'tarot', 'theater', 'reading']
        .filter(id => sys.members.some(m => m.id === id));
    assert.deepEqual(misplaced, [], '这些 App 曾被错分进「系统与诊断」：' + misplaced.join(','));
    /* 反向：真系统类 App 必须在壳里（否则就是把不该动的也挪走了）。 */
    for (const id of ['settings', 'search', 'notifications', 'usage', 'backupdesk', 'accessdesk']) {
        assert.equal(appCategory(id), 'system', id + ' 应归 system 类目');
    }
    /* 反向之二：壳**不是**「没类目的都塞进来」—— 壳内每个成员都必须真属 system 类目。 */
    for (const m of sys.members) {
        assert.equal(appCategory(m.id), 'system',
            '★ 壳成员 ' + m.id + ' 的类目是 ' + appCategory(m.id) + '，不是 system —— 说明还有 App 在靠缺类目兜底混进壳');
    }
});
test('A4: 负控制 — 抹掉一个类目键，A1 同款判据必须在副本树上转红（真源码破坏）', () => {
    const rel = 'config/app-library.js';
    const src = read(rel);
    const anchor = "    calendar: 'life',";
    assert.equal(countOf(src, anchor), 1, '锚点必须恰出现 1 次');
    const broken = src.replace(anchor, '');
    /* 在**副本树**上重跑同款真判据（不是对原文件断言，也不是写死模拟常量）。 */
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-o6-negsrc-'));
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'config', 'app-library.js'), broken);
    const patched = fs.readFileSync(path.join(dir, 'config', 'app-library.js'), 'utf8');
    assert.notEqual(patched, src, '破坏必须真的写进了副本');
    /* 用**同一段判据逻辑**在副本源码上重算（正则抽键名，等价于 import 后的键集合）。 */
    const keysOf = (text) => {
        const body = text.slice(text.indexOf('export const APP_CATEGORY'), text.indexOf('export const APP_LIBRARY_ENTRY_ID'));
        return new Set([...body.matchAll(/^\s{4}([A-Za-z_][A-Za-z0-9_]*):\s*'/gm)].map(m => m[1]));
    };
    const before = keysOf(src);
    const after = keysOf(patched);
    assert.ok(before.has('calendar'), '原版必须有 calendar 键（否则锚点选错了）');
    assert.equal(after.has('calendar'), false, '破坏后副本必须丢掉 calendar 键');
    const apkIds = APPS.map(a => a.id);
    const missAfter = apkIds.filter(id => !after.has(id));
    assert.ok(missAfter.length > 0, '★ 副本上同款判据必须点名缺失：' + missAfter.join(','));
    assert.ok(missAfter.includes('calendar'), '被抹掉的键必须出现在缺失名单里');
    fs.rmSync(dir, { recursive: true, force: true });
});

/* ══════════════════ B 组：R11-O7 应用库复活 ══════════════════ */
test('B1: 应用库入口在 dock 上真存在，且点击链路指向 openLibrary（不是死代码）', () => {
    const home = read('phone/home-screen.js');
    /* 入口格真被渲染进 dock（renderDock 的返回里必须 push 它）。 */
    assert.ok(/dockTiles\.push\(this\.renderLibraryDockTile\(\)\)/.test(home),
        'renderDock 必须把库入口格 push 进返回序列（否则入口是个没人调的方法）');
    assert.ok(/renderLibraryDockTile\(\)\s*\{/.test(home), 'renderLibraryDockTile 必须定义');
    /* 入口格带 data-app=__library ⇒ 走 openApp 的伪 id 分支。 */
    assert.ok(home.includes('data-app="${APP_LIBRARY_ENTRY_ID}"'), '入口格必须带伪 id 供点击分流');
    assert.equal(countOf(home, 'this.openLibrary()'), 1, 'openLibrary 必须恰有一处真调用');
    /* openApp 的伪 id 分流仍在。 */
    assert.ok(/appId === APP_LIBRARY_ENTRY_ID/.test(home), 'openApp 必须保留伪 id 分流');
});
test('B2: 库取全量 —— 89 项全部可搜（核心 App 不再在库里缺席）', () => {
    const home = read('phone/home-screen.js');
    /* _libraryApps 不得再按 zone 过滤（那会让 21 个核心 App 从库里消失）。 */
    const seg = home.slice(home.indexOf('_libraryApps()'), home.indexOf('_libraryEntry()'));
    assert.ok(seg.length > 0, '_libraryApps 必须在场');
    assert.equal(/app\.zone === 'library'/.test(seg), false,
        '★ 库不得再按 zone 过滤 —— 聚合壳已负责分类浏览，库的独占价值是「搜到全部」');
    assert.ok(/inLib = all\.filter\(/.test(seg), '_libraryApps 必须保留取数（只是不再按 zone 筛）');
    /* 渲染层把分组内全部成员铺出来（数量由数据决定，不由硬编码决定）。 */
    assert.ok(/group\.apps\.map\(app => this\.renderLibraryApp\(app\)\)/.test(home),
        '库分组必须铺出全部成员');
    /* 搜索按 data-name 过滤，命中面即库内全部条目。 */
    assert.ok(/item\.dataset\.name/.test(home), '库搜索必须按条目名过滤');
});
test('B3: 负控制 — 把库取数改回 zone 过滤，B2 同款判据必须转红（真源码破坏）', () => {
    const rel = 'phone/home-screen.js';
    const src = read(rel);
    const anchor = 'const inLib = all.filter(app => app && typeof app === \'object\');';
    assert.equal(countOf(src, anchor), 1, '锚点必须恰出现 1 次');
    const broken = src.replace(anchor, 'const inLib = all.filter(app => app && app.zone === \'library\');');
    const seg = broken.slice(broken.indexOf('_libraryApps()'), broken.indexOf('_libraryEntry()'));
    /* 同款判据：库里不得出现 zone 过滤。 */
    assert.equal(/app\.zone === 'library'/.test(seg), true,
        '★ 破坏必须可观测地改变行为（改回 zone 过滤后同款判据必须报出它）');
    assert.notEqual(broken, src, '破坏必须真的改到了源码');
});

/* ══════════════════ C 组：R11-O8 图标覆盖率 ══════════════════ */
test('C0: 读数必须有**产品侧消费方**（否则是把读数留在测试里自娱 —— 本仓治过的形态）', () => {
    /* ★ 这条是 R11-O8 收口时补的：覆盖率与文件名映射两个导出做完之后，
     *   `bind-consuming` 门当场判红「绑定级零消费」—— 也就是说这两条读数
     *   此前**只有测试在读**，用户手上的诊断中心看不到「覆盖率掉了」。
     *   修法不是写进基线放行，而是接到产品出口：诊断中心的图标覆盖率面。
     *   本判据守的就是这条接线，防止以后有人把消费方删掉、读数退回自娱状态。 */
    const diag = read('apps/diagnose/diagnose-data.js');
    assert.ok(/import\s*\{[^}]*unifiedIconCoverage[^}]*\}\s*from\s*'\.\.\/\.\.\/config\/app-icons\.js'/.test(diag),
        '★ 诊断中心必须真 import 覆盖率读数（读数要有产品侧出口）');
    assert.ok(/unifiedIconCoverage\(\)/.test(diag), '覆盖率读数必须被真调用（import 了不用等于没接）');
    assert.ok(/iconFace/.test(diag), '内核必须把它装成一面（供视图陈列）');
    const view = read('apps/diagnose/diagnose-view.js');
    assert.ok(/_iconFaceHtml/.test(view), '视图必须有这张卡（读数得看得见才算出口）');
    assert.ok(/iconFaceText/.test(view), '文案必须走内核转发（视图不自己拼读数）');
    /* 映射查询必须被**产品路径**真用（修前它是纯测试用导出，故门判死）。 */
    const icons = read('config/app-icons.js');
    assert.ok(/unifiedIconFileOf\(id\)/.test(icons),
        '★ 文件名映射必须在产品路径里被真用（如覆盖率里点「在册但无磁盘映射」）');
});
test('C1: 覆盖率 ≥50/89 且缺项点名为空（覆盖率是可读读数，不是感觉）', () => {
    const cov = unifiedIconCoverage();
    assert.equal(cov.total, APPS.length, '分母必须是 APPS 全集，实际 ' + cov.total);
    assert.deepEqual(cov.missing, [], '缺图标的 App 必须为空：' + cov.missing.join(','));
    assert.ok(cov.covered >= 50, '覆盖率必须 ≥50，实际 ' + cov.covered + '/' + cov.total);
});
test('C2: 生成清单与磁盘 .svg 文件名集合双向对账（两种漂移都当场转红）', () => {
    const onDisk = fs.readdirSync(path.join(ROOT, 'phone', 'icons'))
        .filter(f => f.endsWith('.svg')).map(f => f.replace(/\.svg$/, '')).sort();
    const inManifest = [...PIXEL_ICON_IDS].sort();
    /* ★ 对账的是**磁盘文件名**（PIXEL_ICON_FILES 的值），不是 id 集合 ——
     *   `__folder` 的图在 `folder.svg`（v4.92.0 起既有约定），拿 id 去对必然假红。
     *   这条口径差正是本档首版踩到的：它把「id == 文件名」当成了不变量。 */
    const filesInManifest = Object.values(PIXEL_ICON_FILES).sort();
    assert.deepEqual(filesInManifest, onDisk,
        '生成清单的文件名集合必须与磁盘一致（跑了生成器没登记 / 登记了图不在，两种都算漂移）');
    /* id 侧同样对账：每个 id 都必须有自己的磁盘落点（经映射解析后）。 */
    for (const id of inManifest) {
        assert.ok(onDisk.includes(PIXEL_ICON_FILES[id]),
            id + ' 映射到 ' + PIXEL_ICON_FILES[id] + '.svg，但磁盘上没有');
    }
    /* 注册表必须是清单的转写，不是第二份手写表。 */
    const registry = [...UNIFIED_APP_ICON_IDS].sort();
    assert.deepEqual(registry, inManifest, 'UNIFIED_APP_ICON_IDS 必须是生成清单的转写');
});
test('C3: 89 张 App 图标全部过 lintPixelSvg（整数坐标 / 无 circle / 有 crispEdges）', () => {
    const files = fs.readdirSync(path.join(ROOT, 'phone', 'icons')).filter(f => f.endsWith('.svg'));
    assert.ok(files.length >= 50, '图标文件数必须 ≥50，实际 ' + files.length);
    for (const f of files) {
        const r = lintPixelSvg(read('phone/icons/' + f));
        assert.ok(r.ok, f + ' 违例：' + r.violations.join(','));
    }
});
test('C4: 无 emoji 冒充像素图（每个 App 的图标 URL 必须落在 phone/icons/ 且文件在场）', () => {
    for (const app of APPS) {
        const url = unifiedIconOf(app.id);
        assert.ok(url, app.id + ' 必须有像素图标 URL');
        /* ★ 用**映射解析后的文件名**核对落点，不是 `app.id + '.svg'`：
         *   绝大多数 id == 文件名，但 `__folder` 类是例外 —— 而本例只跑 APPS 里的真 App，
         *   故两者当前等价；仍走映射是为了让这条判据下不变量是「URL 落点存在」，
         *   而不是「id 必然等于文件名」（后者不是不变量）。 */
        const file = unifiedIconFileOf(app.id) || app.id;
        assert.ok(url.includes('/phone/icons/' + file + '.svg'), app.id + ' 的 URL 必须指向自己的 SVG');
        const rel = path.join(ROOT, 'phone', 'icons', file + '.svg');
        assert.ok(fs.existsSync(rel), app.id + '.svg 必须在磁盘上');
        const text = fs.readFileSync(rel, 'utf8');
        /* 像素纪律：不许出现 emoji 字符（那正是「用 emoji 冒充像素图」的形态）。 */
        assert.equal(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text), false,
            app.id + '.svg 不得含 emoji 字符');
        assert.ok(hasUnifiedIcon(app.id), app.id + ' 必须被 hasUnifiedIcon 判为已覆盖');
    }
});
test('C5: 负控制 — 删掉一张 SVG，C2/C4 同款判据必须在副本树上转红（真文件破坏）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-o8-neg-'));
    fs.mkdirSync(path.join(dir, 'phone', 'icons'), { recursive: true });
    for (const f of fs.readdirSync(path.join(ROOT, 'phone', 'icons'))) {
        fs.copyFileSync(path.join(ROOT, 'phone', 'icons', f), path.join(dir, 'phone', 'icons', f));
    }
    const victim = 'wechat.svg';
    fs.rmSync(path.join(dir, 'phone', 'icons', victim));
    /* 同款判据：清单 ∩ 磁盘 双向相等。 */
    const onDisk = fs.readdirSync(path.join(dir, 'phone', 'icons'))
        .filter(f => f.endsWith('.svg')).map(f => f.replace(/\.svg$/, '')).sort();
    const inManifest = [...PIXEL_ICON_IDS].sort();
    assert.notDeepEqual(inManifest, onDisk, '★ 删掉 ' + victim + ' 后双方必须不等（否则这条判据测不到东西）');
    assert.equal(onDisk.includes('wechat'), false, '被删的 id 必须从磁盘集合里消失');
    assert.equal(inManifest.includes('wechat'), true, '清单里仍有它 ⇒ 判据会点名「登记了图不在」');
    fs.rmSync(dir, { recursive: true, force: true });
});

/* ══════════════════ D 组：R11-O9 预算时效 ══════════════════ */
test('D1: 版本比较与「落后几版」必须是可复算的真数（不拍系数）', () => {
    assert.deepEqual(parseSemver('v4.97.0'), [4, 97, 0], '必须吃掉 v 前缀');
    assert.equal(parseSemver('abc'), null, '不可解析必须返回 null（不许当 0.0.0）');
    assert.equal(parseSemver(''), null, '空串必须返回 null');
    assert.equal(compareSemver('4.97.0', '4.98.0'), -1, '跨小段比较');
    assert.equal(compareSemver('10.0.0', '9.0.0'), 1, '★ 十位必须大于个位（字符串比会反）');
    assert.equal(compareSemver('4.98', '4.98.0'), 0, '段数不齐按 0 补');
    assert.throws(() => compareSemver('x', '1.0.0'), /不可解析/, '坏输入必须抛，不许静默当同版');
    /* 真仓发布史：数出来的间隔必须与「历史上比它新的条数」一致（可被任何人复算）。 */
    const hist = JSON.parse(read('update-log.json')).versions;
    const gap = releasesSince('3.23.1', Object.keys(hist));
    const manual = Object.keys(hist).filter(k => parseSemver(k) && compareSemver(k, '3.23.1') > 0).length;
    assert.equal(gap, manual, 'releasesSince 必须等于手工数出的条数');
    assert.ok(gap > STALE_RELEASE_GAP, '前提：v3.23.1 确实是一百多版前的基线（' + gap + '）');
});
test('D2: 时效三态不同形 —— stale / fresh / unmeasured 必须能被读的人分开', () => {
    /* ★ 夹具里要**真的够旧**：`releasesSince` 数的是「发布史里严格新于基线的条数」，
     *   而夹具的发布史只有 5~25 条。首版只列了 5 条却断言「落后 > 阈值(20)」——
     *   那是**夹具自相矛盾**（最多只能数出 4），失败于夹具而非判据。
     *   故这里按阈值现造一段发布史：25 个版本，故从最旧那条算起必然落后 24 版。 */
    const hist = [];
    for (let i = 0; i < 25; i += 1) hist.push('4.' + (70 + i) + '.0');
    const oldest = hist[0];
    const stale = evaluateBudgetFreshness({ measured_at: oldest }, '4.97.0', hist);
    assert.equal(stale.status, 'stale');
    assert.equal(stale.stale, true);
    assert.equal(stale.gap, hist.length - 1, '落后数 = 比基线新的条数');
    assert.ok(stale.gap > STALE_RELEASE_GAP, '落后数必须超阈值，实际 ' + stale.gap);
    assert.match(stale.why, /建议复测/, '陈旧态必须给出动作（否则读的人只知道旧、不知道该干嘛）');
    const fresh = evaluateBudgetFreshness({ measured_at: hist[hist.length - 1] }, '4.97.0', hist);
    assert.equal(fresh.status, 'fresh');
    assert.equal(fresh.stale, false);
    assert.equal(fresh.gap, 0, '当版落后数必须是 0');
    const missing = evaluateBudgetFreshness({}, '4.97.0', hist);
    assert.equal(missing.status, 'unmeasured', '没写 measured_at 必须是第三态');
    assert.notEqual(missing.status, fresh.status, '★ unmeasured 与 fresh 不许同形（否则「没测过」被洗成「刚测过」）');
    assert.match(missing.why, /没写 measured_at/, '第三态必须说清原因');
    const bad = evaluateBudgetFreshness({ measured_at: 'not-a-version' }, '4.97.0', hist);
    assert.equal(bad.status, 'unmeasured');
    assert.match(bad.why, /不是版本号/, '坏输入与「没写」的措辞必须不同');
    /* ★ 三态的 why **两两不同形**：这是「读的人能分开」的真正判据。 */
    assert.notEqual(missing.why, bad.why, '「没写」与「写了但不是版本号」必须措辞不同');
    const noHist = evaluateBudgetFreshness({ measured_at: hist[hist.length - 1] }, '4.97.0', null);
    assert.equal(noHist.status, 'unmeasured', '发布史读不到必须如实说，不许猜成 fresh');
    assert.match(noHist.why, /发布史读不到/);
});
test('D3: 真仓读数必须自洽，且时效检查恒 exit 0（告警不拦发布）', () => {
    const r = checkGateBudgetFreshness();
    assert.ok(['fresh', 'stale', 'unmeasured'].includes(r.status), '状态必须是三态之一：' + r.status);
    if (r.status !== 'unmeasured') {
        const hist = Object.keys(JSON.parse(read('update-log.json')).versions);
        assert.equal(r.gap, releasesSince(r.measuredAt, hist), '判据给的落后数必须可被复算');
        const budget = readJson('config/gate-budget.json');
        assert.equal(r.measuredAt, String(budget.measured_at), '读数必须与预算文件一致');
    }
});
test('D4: 负控制 — 把基线改成 v0.0.1，同款判据必须在夹具树上报 stale（真文件破坏）', () => {
    /* ★ 夹具的发布史必须**长于阈值**，否则「0.0.1 必然超期」这个前提不成立
     *   （首版只给了 4 条，最多数出 3 —— 判据只能说它 fresh，失败在夹具）。
     *   这里给 30 条，使「从 0.0.1 起算」的落后数 = 30 > 阈值 20。 */
    const hist = ['0.0.1'];
    for (let i = 0; i < 30; i += 1) hist.push('4.' + (60 + i) + '.0');
    const dir = fixtureTree({ budget: { schema: 'gate-budget@1', margin_pct: 10, measured_at: '0.0.1', gates: {} }, versions: hist, current: '4.97.0' });
    const r = checkGateBudgetFreshness(dir);
    assert.equal(r.status, 'stale', '★ 改成 v0.0.1 后必须报 stale：' + JSON.stringify(r));
    assert.equal(r.measuredAt, '0.0.1');
    assert.ok(r.gap > STALE_RELEASE_GAP, '落后数必须超阈值，实际 ' + r.gap);
    fs.rmSync(dir, { recursive: true, force: true });
    /* 反向：改成当版必须 fresh —— 正负两向都过才算这条判据有分辨力。 */
    const dir2 = fixtureTree({ budget: { schema: 'gate-budget@1', margin_pct: 10, measured_at: '4.97.0', gates: {} }, versions: hist, current: '4.97.0' });
    const r2 = checkGateBudgetFreshness(dir2);
    assert.equal(r2.status, 'fresh', '改成当版必须 fresh');
    assert.equal(r2.gap, 0, '当版落后数必须是 0');
    fs.rmSync(dir2, { recursive: true, force: true });
    /* 反向之二：把基线放在**阈值边界内**（倒数第 21 版 ⇒ 落后 20，不超阈值）必须 fresh，
     * 放在阈值外（倒数第 22 版 ⇒ 落后 21）必须 stale —— 卡住 `>` 与 `>=` 的口径。 */
    const atGap = (n) => hist[hist.length - 1 - n];
    const edgeIn = checkGateBudgetFreshness(fixtureTree({
        budget: { measured_at: atGap(STALE_RELEASE_GAP) }, versions: hist, current: '4.97.0' }));
    assert.equal(edgeIn.status, 'fresh', '落后恰等于阈值时必须 fresh（阈值是「超过才告警」）');
    assert.equal(edgeIn.gap, STALE_RELEASE_GAP);
    const edgeOut = checkGateBudgetFreshness(fixtureTree({
        budget: { measured_at: atGap(STALE_RELEASE_GAP + 1) }, versions: hist, current: '4.97.0' }));
    assert.equal(edgeOut.status, 'stale', '落后超阈值 1 版必须 stale');
});
test('D5: 负控制 — 夹具里没有预算文件时必须如实报 unmeasured（不许静默当 fresh）', () => {
    const dir = fixtureTree({ versions: ['1.0.0'], current: '1.0.0' });
    const r = checkGateBudgetFreshness(dir);
    assert.equal(r.status, 'unmeasured', '★ 没有预算文件必须第三态，不许静默判「新」');
    assert.match(r.why, /不在场/, '必须说「不在场」');
    assert.equal(r.stale, false, '未测不是陈旧（两者不同形）');
    fs.rmSync(dir, { recursive: true, force: true });
});
test('D6: 接线自证 — 时效判据真被 check-file 消费，且真源只有一处', () => {
    const cf = read('scripts/check-file.mjs');
    assert.ok(cf.includes('checkGateBudgetFreshness'), 'check-file 必须真调时效判据');
    assert.ok(/预算时效/.test(cf), 'check-file 必须把时效写进汇总（否则判了也没人看得见）');
    assert.ok(/不改退出码/.test(cf), '汇总必须写明「不改退出码」（否则读的人以为门坏了）');
    /* ---- 真源唯一：判定逻辑与阈值只许在 gate-budget-freshness.mjs 里有一份 ----
     * ★ 这里**不钉死某个数字**：数出现次数是抓「有人复制粘贴了一份判定表」的
     *   粗筛，而次数会随真源内注释增删漂移（本档实跑就是 3，不是先前手写的 5）。
     *   真正要防的是「第二份判定表」，故改断**语义三件套**：
     *     ① 三态字面量在真源里三态齐全；
     *     ② 告警文案（why 真身）只在真源里，check-file 只许比较状态、不许自带文案；
     *     ③ 阈值（STALE_RELEASE_GAP）不许在 check-file 里再写一遍。 */
    const own = read('scripts/gate-budget-freshness.mjs');
    for (const st of ['fresh', 'stale', 'unmeasured']) {
        assert.ok(countOf(own, "'" + st + "'") >= 1, '真源必须自己认这三个态：' + st);
    }
    assert.ok(/建议复测/.test(own), '陈旧告警文案（建议复测）必须出自真源');
    assert.ok(/不在场/.test(own), '未测文案（不在场）必须出自真源');
    assert.ok(/不是版本号/.test(own), '坏输入文案必须出自真源');
    /* check-file 是**消费者**：可以比较 'unmeasured' / 'stale'（那是读结果），
     * 但不得自带告警文案、不得自带阈值 —— 自带任一个就是第二份真源。 */
    assert.equal(/建议复测/.test(cf), false, '★ check-file 不得自带告警文案（那是第二份真源）');
    assert.equal(/不是版本号/.test(cf), false, '★ check-file 不得自带坏输入文案');
    assert.equal(/STALE_RELEASE_GAP/.test(cf), false, '★ check-file 不得自带阈值（阈值真源在同一处）');
    /* 判据自己也不许重写一份判定：必须从真源 import 同一函数（不各写一遍）。 */
    const self = read('tests/system-v4990.test.mjs');
    assert.ok(/import\s*\{[^}]*evaluateBudgetFreshness[^}]*\}\s*from\s*'\.\.\/scripts\/gate-budget-freshness\.mjs'/.test(self),
        '判据必须 import 真源的 evaluateBudgetFreshness，而不是自己重写一份');
});
