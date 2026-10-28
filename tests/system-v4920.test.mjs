/* ============================================================
 * tests/system-v4920.test.mjs — v4.92.0 像素 OS 重绘判据档
 * ------------------------------------------------------------
 * 本版把 RubyPhone 从「四套混搭（华为药丸+灵动岛+玻璃拟态+emoji 彩色块）」
 *   重绘为「复古像素 OS」。判据分五面：
 *   A 五源版本同源 + 像素资产在场
 *   B 像素纪律：SVG 全整数坐标 / 无 <circle> / 声明 crispEdges
 *   C 聚合架构：8 核心 + 7 壳 = 桌面 ≤16 格；89 功能全保留
 *   D 单返回键：掌机 B 键视图栈行为 + 各 App 私有返回已隐藏
 *   E 摄像头：灵动岛改像素点，不再压正文
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PX_PALETTE, VIEW_LEVEL, createViewStack, lintPixelSvg, folderIconSvg, folderMiniSwatches, svgToDataUri } from '../phone/pixel-engine.js';
import { CORE_DESKTOP_IDS, APP_CLUSTERS, buildDesktopTiles, isCoreDesktop, clusterByCategory, CLUSTER_ID_PREFIX } from '../config/app-clusters.js';
import { UNIFIED_APP_ICONS, unifiedIconOf, hasUnifiedIcon } from '../config/app-icons.js';
import { APP_LIBRARY_CATEGORIES } from '../config/app-library.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rel = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(rel(p), 'utf8');
const BORN_V = '4.92.0';

/* ══════════════════ A 版本锚与像素资产在场 ══════════════════ */
test('A1: 五源版本同源且都是当版', () => {
  const pkg = JSON.parse(read('package.json')).version;
  const man = JSON.parse(read('manifest.json')).version;
  const log = JSON.parse(read('update-log.json'));
  assert.equal(new Set([pkg, man, log.latest, log.head]).size, 1, '四源必须一致');
  assert.ok([pkg, man, log.latest, log.head].every(v => v === BORN_V), '都该是当版 ' + BORN_V);
});

test('A2: 像素引擎与像素皮肤在场', () => {
  assert.ok(fs.existsSync(rel('phone/pixel-engine.js')), 'pixel-engine.js 必须在场');
  assert.ok(fs.existsSync(rel('phone/pixel-skin.css')), 'pixel-skin.css 必须在场');
  assert.ok(fs.existsSync(rel('phone/wallpaper-pixel.svg')), '像素壁纸必须在场');
  assert.ok(fs.existsSync(rel('config/app-clusters.js')), 'app-clusters.js 必须在场');
  assert.ok(fs.existsSync(rel('config/app-icons.js')), 'app-icons.js 必须在场');
});

/* ══════════════════ B 像素纪律（机器判据） ══════════════════ */
test('B1: 16 色盘恰为 16 色且全为合法 HEX', () => {
  const colors = Object.values(PX_PALETTE);
  assert.equal(colors.length, 16, '色盘必须恰 16 色');
  for (const c of colors) assert.match(c, /^#[0-9a-fA-F]{6}$/, '色盘只许 6 位 HEX：' + c);
});

test('B2: 全部像素 SVG 过 lintPixelSvg（整数坐标/无 circle/有 crispEdges）', () => {
  const dir = rel('phone/icons');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.svg'));
  assert.ok(files.length >= 9, '像素图标至少 9 个（8 核心 + 1 文件夹），实际 ' + files.length);
  for (const f of files) {
    const r = lintPixelSvg(read('phone/icons/' + f));
    assert.ok(r.ok, f + ' 违例：' + r.violations.join(','));
  }
});

test('B3: 桌面 8 核心全部有像素图标登记', () => {
  for (const id of CORE_DESKTOP_IDS) {
    assert.ok(hasUnifiedIcon(id), '核心 ' + id + ' 必须有像素图标');
    const url = unifiedIconOf(id);
    assert.ok(url.includes('/phone/icons/'), '像素图标须在 phone/icons/ 下');
  }
});

test('B4: folderIconSvg 产出合法像素 SVG', () => {
  const svg = folderIconSvg('#5d7fa6', ['#f77b8f', '#f9a03f']);
  const r = lintPixelSvg(svg);
  assert.ok(r.ok, 'folderIconSvg 违例：' + r.violations.join(','));
  assert.ok(svg.includes('shape-rendering="crispEdges"'));
  assert.ok(svgToDataUri(svg).startsWith('data:image/svg+xml'));
});

/* ══════════════════ C 聚合架构（能力零删除） ══════════════════ */
test('C1: 8 核心 + 7 壳，桌面 ≤16 格', () => {
  assert.equal(CORE_DESKTOP_IDS.length, 8, '核心恰 8 个');
  assert.equal(APP_CLUSTERS.length, 7, '聚合壳恰 7 个（对齐 7 类目）');
  assert.ok(8 + 7 <= 16, '桌面 ≤16 格');
});

test('C2: 聚合壳 id 与类目一一对应，且带伪 id 前缀防路由冲突', () => {
  const catIds = APP_LIBRARY_CATEGORIES.map(c => c.id).sort();
  const cluIds = APP_CLUSTERS.map(c => c.id).sort();
  assert.deepEqual(cluIds, catIds, '壳 id 必须与 7 类目一一对应');
  assert.ok(CLUSTER_ID_PREFIX.startsWith('__'), '聚合壳前缀必须带 __ 防与真 appId 冲突');
});

test('C3: buildDesktopTiles 收敛桌面且保留全部功能', () => {
  /* 模拟 89 个 App：8 核心 + 81 个分散到 7 类目 */
  const mock = [];
  for (const id of CORE_DESKTOP_IDS) mock.push({ id, name: id, libraryCategory: '', zone: 'desktop' });
  const cats = APP_LIBRARY_CATEGORIES.map(c => c.id);
  for (let i = 0; i < 81; i++) {
    mock.push({ id: 'app' + i, name: 'app' + i, libraryCategory: cats[i % 7], zone: 'library' });
  }
  const tiles = buildDesktopTiles(mock);
  const cores = tiles.filter(t => !t.isCluster);
  const shells = tiles.filter(t => t.isCluster);
  assert.equal(cores.length, 8, '桌面核心恰 8');
  assert.equal(shells.length, 7, '桌面壳恰 7');
  assert.equal(tiles.length, 15, '桌面共 15 格');
  /* 能力零删除：壳内成员合计必须 = 81 */
  const totalMembers = shells.reduce((s, sh) => s + sh.memberCount, 0);
  assert.equal(totalMembers, 81, '壳内成员合计必须保留全部非核心功能');
});

test('C4: 核心 App 不进任何壳', () => {
  for (const id of CORE_DESKTOP_IDS) assert.equal(isCoreDesktop(id), true, id + ' 是核心');
  assert.equal(isCoreDesktop('weibo'), false, 'weibo 非核心');
  assert.ok(clusterByCategory('social'), 'social 壳必须存在');
});

/* ══════════════════ D 单返回键（掌机 B 键） ══════════════════ */
test('D1: 视图栈从 desktop 起，back() 逐级出栈', () => {
  const s = createViewStack();
  assert.equal(s.depth(), 1, '初始仅桌面层');
  assert.equal(s.top().level, VIEW_LEVEL.DESKTOP);
  s.push(VIEW_LEVEL.CLUSTER, 'social');
  s.push(VIEW_LEVEL.APP, 'wechat');
  assert.equal(s.depth(), 3);
  const r1 = s.back();
  assert.equal(r1.level, VIEW_LEVEL.CLUSTER, '先退回聚合壳');
  const r2 = s.back();
  assert.equal(r2.level, VIEW_LEVEL.DESKTOP, '再退回桌面');
  const r3 = s.back();
  assert.equal(r3.shook, true, '桌面根层级再退必须 shook');
  assert.equal(s.depth(), 1, '根层级不可再退');
});

test('D2: home-screen 暴露掌机 B 键入口 pressPixelBack', () => {
  const src = read('phone/home-screen.js');
  assert.ok(src.includes('pressPixelBack'), 'home-screen 必须有 pressPixelBack');
  assert.ok(src.includes('openCluster'), 'home-screen 必须有 openCluster');
  assert.ok(src.includes('renderClusterTile'), 'home-screen 必须有 renderClusterTile');
});

test('D3: pixel-skin.css 隐藏各 App 私有返回按钮', () => {
  const css = read('phone/pixel-skin.css');
  for (const sel of ['.wechat-back-btn', '.ach-back-btn', '.tb-back-btn', '.hl-back-btn']) {
    assert.ok(css.includes(sel), 'pixel-skin 必须隐藏 ' + sel);
  }
  assert.ok(/display\s*:\s*none\s*!important/.test(css), '私有返回必须 display:none!important');
});

/* ══════════════════ E 摄像头不压正文 ══════════════════ */
test('E1: 灵动岛改左上像素点，z-index 不再悬浮压正文', () => {
  const css = read('phone/pixel-skin.css');
  assert.ok(/\.phone-punch-hole\{[^}]*left:8px/.test(css.replace(/\n/g,'')), '镜头点须在左上 left:8px');
  assert.ok(/\.phone-punch-hole\{[^}]*width:8px/.test(css.replace(/\n/g,'')), '镜头点须 8px');
  assert.ok(/\.phone-punch-hole\{[^}]*z-index:6/.test(css.replace(/\n/g,'')), '镜头点 z-index 须降到 6（不压正文）');
});

test('E2: 像素壁纸为合法像素 SVG', () => {
  const r = lintPixelSvg(read('phone/wallpaper-pixel.svg'));
  assert.ok(r.ok, '像素壁纸违例：' + r.violations.join(','));
});

/* ══════════════════ F 负控制（真源码破坏两向） ══════════════════ */
test('F1: 破坏像素 SVG（注入 <circle>）→ lintPixelSvg 必红', () => {
  const bad = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" shape-rendering="crispEdges"><circle cx="12" cy="12" r="4"/></svg>';
  const r = lintPixelSvg(bad);
  assert.equal(r.ok, false, '含 circle 必须判红');
  assert.ok(r.violations.includes('no-circle-allowed'));
});

test('F2: 破坏像素 SVG（小数坐标）→ lintPixelSvg 必红', () => {
  const bad = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" shape-rendering="crispEdges"><rect x="1.5" y="2" width="4" height="4"/></svg>';
  const r = lintPixelSvg(bad);
  assert.equal(r.ok, false, '小数坐标必须判红');
});

test('F3: 真实像素 SVG（无破坏）→ lintPixelSvg 必绿', () => {
  const good = read('phone/icons/wechat.svg');
  assert.equal(lintPixelSvg(good).ok, true, '真像素 SVG 必须判绿');
});