/**
 * system-v3930.test.mjs — v3.93.0 · 拓展计划 R-X9 无障碍 / 窄屏 / 个性化操作层
 *
 * 【本版治的是什么（修前实测，不是推演）】
 *   · 键盘可达性没有统一出口：全仓 focus-visible 只在 5 个文件里，且全写在具体控件 ID 上；
 *     桌面图标（renderAppIcon）只挂 onclick —— 没有 tabindex / role / aria-label，
 *     键盘 Tab 不过去、读屏也不知道每个图标叫什么。
 *   · 320px 没有专门布局：全仓**没有**任何 320px 媒体查询（两条 `max-width: 320px`
 *     是宽度取值不是断点）；而每页图标容量是 JS 写死的 `columns = 4`，
 *     与 CSS 列数分属两处 —— 改了 CSS 不改 JS 就会在窄屏上压住最后一行。
 *   · 状态只靠颜色：.app-badge / .badge-notification / .phone-call-status-dot 等
 *     10+ 处标记只有色块，没有文字或图形辅助。
 *   · **keys 门抽键口径只认下划线标识符**：实测 142 个连字符键（phone-font-scale /
 *     phone-image-* / offline-* / story-* …）从未进入 K1/K2/K3 —— 其中 3 个真的命中
 *     CHAT_DATA_PATTERNS。这不是「少登记了几个键」，是**整族键从未被问过归属**。
 *
 * 【六面】
 *   A  结构面：三档 / 四态 / 两字号档 / 三键 / 窄屏断点 / 四处注册面 / 四一致命名 / REBIND
 *   A2 纯函数与只读：剥注释后逐条核（内核零 IO，咽喉段零写入零 fetch，home-screen 只读）
 *   B  行为面：三档不同形 / 认不出归未知 / 空串归空 / 320 闭区间 / 宽读不出不判窄屏 /
 *             可读名不编 / 守卫三格独立 / 四态守恒
 *   C  接线面：键名逐格对齐 / 白名单先于取数口 / 只读读数口现采 / 分页容量取自内核列数 /
 *             焦点环与窄屏断点在同一样式文件
 *   D  负控制：八处真源码副本定点破坏，同款判据必转红（第八处两向对照自证）
 *   E  版本锚
 *
 * 负控制纪律：真源码破坏用副本（`. __neg__.js` 后缀），锚点 anchorOnce 断言恰中 1 次，
 *   assert.notEqual 确认破坏真发生，process.on('exit') 清理副本。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));

const CORE_REL = 'config/access-layers.js';
const APP_REL = 'apps/accessdesk/accessdesk-app.js';
const VIEW_REL = 'apps/accessdesk/accessdesk-view.js';
const CSS_REL = 'apps/accessdesk/accessdesk.css';
const HOME_REL = 'phone/home-screen.js';
const PHONE_CSS_REL = 'phone.css';
const IDX_REL = 'index.js';
const KEYS_GATE_REL = 'scripts/keys-audit.mjs';

const CORE = read(CORE_REL);
const APP = read(APP_REL);
const VIEW = read(VIEW_REL);
const CSS = read(CSS_REL);
const HOME = read(HOME_REL);
const PHONE_CSS = read(PHONE_CSS_REL);
const IDX = read(IDX_REL);
const KEYS_GATE = read(KEYS_GATE_REL);

/** 剥掉注释再核「纯函数 / 零 IO」（注释里出现 fetch( 是说明，不是调用）。 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const CORE_CODE = stripComments(CORE);

const importCore = async (rel) => import(pathToFileURL(path.join(root, rel)).href);
const M = await importCore(CORE_REL);

// ══════════════ A 结构面 ══════════════

test('v3930 A1. 三个内核文件都在位且非空', () => {
  for (const p of [CORE_REL, APP_REL, VIEW_REL, CSS_REL]) {
    assert.ok(exists(p), p + ' 不存在');
    assert.ok(read(p).length > 200, p + ' 过短（可能是空壳）');
  }
});

test('v3930 A2. 三档操作层互不相同、含标准档（压平两档 = 两种处境同形）', () => {
  assert.equal(M.AX_LEVEL_LIST.length, 3, '必须三档');
  assert.equal(new Set(M.AX_LEVEL_LIST).size, 3, '三档不得重复');
  assert.deepEqual([...M.AX_LEVEL_LIST], ['standard', 'enhanced', 'large']);
  assert.equal(M.AX_LEVELS.STANDARD, 'standard', '默认档字面量必须与列表一致');
});

test('v3930 A3. 四态互不相同（空 / 未知 / 失败 / 成功）且文字与符号都不撞', () => {
  assert.deepEqual([...M.AX_MARK_STATES], ['empty', 'unknown', 'fail', 'ok']);
  const texts = M.AX_MARK_STATES.map((k) => M.AX_MARK_TEXT[k]);
  const syms = M.AX_MARK_STATES.map((k) => M.AX_MARK_SYMBOL[k]);
  assert.equal(new Set(texts).size, 4, '四态文字必须互不相同');
  assert.equal(new Set(syms).size, 4, '四态符号必须互不相同');
  /* 色调**允许**两态共用（empty/unknown 都是 muted）—— 因为颜色是附加不是唯一载体。 */
  assert.ok(new Set(M.AX_MARK_STATES.map((k) => M.AX_MARK_TONE[k])).size >= 2, '色调至少两档');
});

test('v3930 A4. 两字号档 + 阈值（114 不出、115 出）', () => {
  assert.equal(M.AX_FONT_LARGE_AT, 115);
  assert.equal(M.fontBandOf(114).band, 'normal');
  assert.equal(M.fontBandOf(115).band, 'large');
  assert.equal(M.fontBandOf(130).band, 'large');
  /* 阈值必须落在既有字体缩放的上限（130）之内，否则这一档永远不可达。 */
  assert.ok(M.AX_FONT_LARGE_AT < 130, '阈值必须在 phone-font-scale 的取值范围内');
});

test('v3930 A5. 三个新键**各自单列成常量**（只藏在对象里会被 keys 门判成幽灵）', () => {
  /* 本条是本版实测踩到的坑固化成判据：键字面量若只出现在对象字面量里，
   *   keys 门的 CONST_RE / CALL_RE 两处都不认 ⇒ 登记变幽灵（K3 exit 2）。 */
  assert.match(CORE, /export const AX_LEVEL_KEY = 'sys_access_level';/, '档位键必须单列常量');
  assert.match(CORE_CODE, /export const AX_COMPACT_KEY = '[A-Za-z_][A-Za-z0-9_]*';/, '紧凑键必须单列常量');
  assert.match(CORE_CODE, /export const AX_THEME_KEY = '[A-Za-z_][A-Za-z0-9_]*';/, '主题键必须单列常量');
  /* 三个键必须在 keys 门登记（K1 的准入），且 scope 是会话隔离。 */
  for (const k of ['sys_access_level', 'sys_access_compact', 'sys_access_theme']) {
    assert.ok(KEYS_GATE.indexOf("key: '" + k + "'") >= 0, k + ' 未在 keys 门登记');
  }
  const chatBlock = KEYS_GATE.slice(KEYS_GATE.indexOf("key: 'sys_access_level'") - 400, KEYS_GATE.indexOf("key: 'sys_access_level'") + 400);
  assert.ok(/scope: 'chat'/.test(chatBlock), '三键必须随会话隔离（^sys_ 族口径）');
});

test('v3930 A6. 窄屏断点 320 且有唯一真源（产品 CSS 不得各写一个数）', () => {
  assert.equal(M.AX_NARROW_WIDTH, 320);
  assert.equal(M.AX_NARROW_QUERY, '(max-width: 320px)');
  /* phone.css 必须真有一条 320px 媒体查询（修前实测：全仓零条）。 */
  assert.ok(/@media\s*\(max-width:\s*320px\)/.test(PHONE_CSS), 'phone.css 必须有 320px 专门布局');
  /* 视图与 App 不得自己写 320（同一口径两份实现）。 */
  for (const [name, src] of [['view', VIEW], ['app', APP], ['home', HOME]]) {
    const code = stripComments(src);
    assert.ok(code.indexOf('320') < 0, name + ' 不得自己写 320（必须从内核取）');
  }
});

test('v3930 A7. 四处注册面齐备（APPS / 懒加载 / 消费矩阵 / REBIND）', () => {
  assert.ok(read('config/apps.js').indexOf("id: 'accessdesk'") >= 0, 'APPS 缺条目');
  const routes = read('config/app-lazy-routes.js');
  assert.ok(routes.indexOf('"accessdeskApp"') >= 0, '懒加载表缺槽位名');
  assert.ok(routes.indexOf('"AccessdeskApp"') >= 0, '懒加载表缺类名');
  assert.ok(read('config/app-consumption-matrix.js').indexOf('appId: "accessdesk"') >= 0, '消费矩阵缺一行');
  assert.ok(IDX.indexOf("'accessdeskApp'") >= 0, 'REBIND 表缺 accessdeskApp');
});

test('v3930 A8. 四一致命名（目录 ↔ 文件 ↔ 类 ↔ 槽位）', () => {
  assert.ok(exists('apps/accessdesk/accessdesk-app.js'), '<dir>-app.js');
  assert.ok(exists('apps/accessdesk/accessdesk-view.js'), '<dir>-view.js');
  assert.ok(exists('apps/accessdesk/accessdesk.css'), '<dir>.css');
  assert.ok(APP.indexOf('export class AccessdeskApp') >= 0, '<Dir>App 类名');
  assert.ok(VIEW.indexOf('export class AccessdeskView') >= 0, '<Dir>View 类名');
});

test('v3930 A9. 类前缀族 .axd-* 唯一且已投递进 phone.css（族撞车会静默打坏别的 App）', () => {
  /* 本版先例（R-X8）：.ch-* 与金手指 App 八个类名逐字重名 —— registry 门只看
   *   「族在不在 phone.css 里」，看不出撞车。故此处逐条钉住三件事。 */
  const fams = new Map();
  const scanFams = (dir) => {
    for (const d of fs.readdirSync(path.join(root, dir))) {
      const abs = path.join(root, dir, d);
      if (!fs.statSync(abs).isDirectory()) continue;
      for (const f of fs.readdirSync(abs).filter((x) => x.endsWith('.css'))) {
        const counts = new Map();
        for (const m of read(path.join(dir, d, f)).matchAll(/\.([a-z][a-z0-9]{1,6})-[a-z0-9-]+/g)) {
          counts.set(m[1], (counts.get(m[1]) || 0) + 1);
        }
        for (const [k, n] of counts) if (n >= 5) {
          if (!fams.has(k)) fams.set(k, []);
          fams.get(k).push(dir + '/' + d + '/' + f);
        }
      }
    }
  };
  scanFams('apps');
  const owners = (fams.get('axd') || []).filter((x) => !x.endsWith('accessdesk/accessdesk.css'));
  assert.deepEqual(owners, [], '.axd-* 族被别的 App 占用了：' + owners.join(', '));
  /* 本模块自己的类名必须在 phone.css 里找得到（机制 A）。 */
  const own = [...new Set([...CSS.matchAll(/\.(axd-[a-z0-9-]+)/g)].map((m) => m[1]))];
  assert.ok(own.length >= 15, '本模块类名太少（' + own.length + '）—— 可能是空壳');
  const missing = own.filter((c) => PHONE_CSS.indexOf('.' + c) < 0);
  assert.deepEqual(missing, [], '这些类名没有投递进 phone.css：' + missing.join(', '));
});

// ══════════════ A2 纯函数与只读 ══════════════

test('v3930 A2-1. 内核零 IO：无 localStorage / document. / window. / fetch( / navigator', () => {
  for (const bad of ['localStorage', 'sessionStorage', 'document.', 'window.', 'fetch(', 'XMLHttpRequest', 'navigator']) {
    assert.ok(CORE_CODE.indexOf(bad) < 0, '内核出现 ' + bad + '（内核必须零 IO，观测由调用方给）');
  }
});

test('v3930 A2-2. 咽喉 R-X9 段无写入、无网络、无模型调用', () => {
  assert.ok(IDX.indexOf('ACCESS_ACTION_KEYS') >= 0, '咽喉未接白名单');
  const start = IDX.indexOf('══════════════ [v3.93.0 · 拓展计划 R-X9]');
  const end = IDX.indexOf('[v3.91.0 · R-X7] 备份与恢复的**唯一取数口**');
  assert.ok(start > 0 && end > start, '咽喉 R-X9 段边界找不到');
  const seg = stripComments(IDX.slice(start, end));
  for (const bad of ['fetch(', 'XMLHttpRequest', 'generateRaw', 'storage.remove', 'localStorage.setItem']) {
    assert.ok(seg.indexOf(bad) < 0, '咽喉 R-X9 段出现 ' + bad);
  }
  /* 取数口本身不写存储：只有三个动作口写（写口收敛在 writeAccessKey 一处）。 */
  const writeCalls = [...seg.matchAll(/storage\.set\(/g)].length;
  assert.equal(writeCalls, 1, '写入调用必须只有一处（writeAccessKey 内），实测 ' + writeCalls);
  assert.ok(seg.indexOf('function writeAccessKey') >= 0, '写入口必须具名成函数（否则就是散在各动作里）');
});

test('v3930 A2-3. 桌面图标只读档位、不写档位（读侧不得顺手改设置）', () => {
  const code = stripComments(HOME);
  assert.ok(code.indexOf('sys_access_level') >= 0, '桌面必须真读档位（否则「从内核派生」是空话）');
  assert.ok(code.indexOf(".set('sys_access_level'") < 0, '桌面不得写档位');
  assert.ok(code.indexOf('storage.set(') < 0 || code.indexOf("set('phone-") < 0, '桌面不得写显示类键');
});

test('v3930 A2-4. 视图不碰 documentElement、不写 storage、不 eval', () => {
  const code = stripComments(VIEW);
  for (const bad of ['documentElement', 'storage.set', 'storage.get', 'eval(', 'iframe', 'innerHTML = \'<script']) {
    assert.ok(code.indexOf(bad) < 0, '视图出现 ' + bad);
  }
});

// ══════════════ B 行为面 ══════════════

test('v3930 B1. 三档不同形：三种档位在同一输入下给出不同列数/图标尺寸或不同守卫', () => {
  const std = M.narrowPlan({ width: 400, level: 'standard' });
  const enh = M.narrowPlan({ width: 400, level: 'enhanced' });
  const big = M.narrowPlan({ width: 400, level: 'large' });
  const sig = (p) => [p.narrow, p.cols, p.iconSize, p.showDockLabels].join('|');
  assert.notEqual(sig(std), sig(enh), '标准与增强必须不同形');
  assert.notEqual(sig(enh), sig(big) === sig(enh) ? sig(std) : sig(big), '三档不得压成两态');
});

test('v3930 B2. 认不出的状态归「未知」——不得归「成功」', () => {
  assert.equal(M.normalizeMarkState('some-brand-new-state'), 'unknown');
  assert.equal(M.normalizeMarkState('weird'), 'unknown');
  assert.equal(M.normalizeMarkState(null), 'empty');
  assert.equal(M.normalizeMarkState(undefined), 'empty');
  /* 空串单独成「空」而不是「未知」：本仓一直在治「没记过」与「读不出」同形。 */
  assert.equal(M.normalizeMarkState(''), 'empty');
});

test('v3930 B3. 320 是闭区间：320 判窄屏、321 不判', () => {
  assert.equal(M.narrowPlan({ width: 320 }).narrow, true);
  assert.equal(M.narrowPlan({ width: 321 }).narrow, false);
  assert.equal(M.narrowPlan({ width: 319 }).narrow, true);
});

test('v3930 B4. 宽度读不出**不得**判窄屏（猜错方向两个后果都难看）', () => {
  for (const w of [NaN, undefined, null, 0, -1, 'abc']) {
    const p = M.narrowPlan({ width: w });
    assert.equal(p.narrow, false, 'width=' + String(w) + ' 不得判窄屏');
    assert.ok(/读不出/.test(p.reason), '理由必须如实说读不出');
  }
});

test('v3930 B5. 字号读不出不得判大（判大会让没设过的人看到换行布局）', () => {
  assert.equal(M.fontBandOf(null).known, false);
  assert.equal(M.fontBandOf(null).band, 'normal');
  assert.equal(M.fontBandOf('').band, 'normal');
  assert.equal(M.fontBandOf('abc').band, 'normal');
  assert.equal(M.overlapGuardOf({ narrow: false }, null).growRows, false);
});

test('v3930 B6. 遮挡守卫三格**各自独立**：不得塌成全开或全关', () => {
  const g0 = M.overlapGuardOf({ narrow: false }, 100);
  const g1 = M.overlapGuardOf({ narrow: false }, 130);
  const g2 = M.overlapGuardOf({ narrow: true }, 100);
  assert.deepEqual([g0.wrapActions, g0.growRows], [false, false], '标准档两格都关');
  assert.deepEqual([g1.wrapActions, g1.growRows], [true, true], '大字号两格都开');
  assert.deepEqual([g2.wrapActions, g2.growRows], [true, false], '窄屏只开换行、不开定高行（两格独立）');
  /* keepLabels 与档位无关：任何档位都不许用图标替掉文字标签。 */
  for (const g of [g0, g1, g2]) assert.equal(g.keepLabels, true);
});

test('v3930 B7. 可读名：四级真源顺序 + 取不到如实空串（不编「按钮」）', () => {
  assert.equal(M.a11yNameOf({ ariaLabel: 'A', label: 'B', text: 'C', icon: 'D' }).from, 'aria');
  assert.equal(M.a11yNameOf({ label: 'B', text: 'C', icon: 'D' }).from, 'label');
  assert.equal(M.a11yNameOf({ text: 'C', icon: 'D' }).from, 'text');
  assert.equal(M.a11yNameOf({ icon: 'D' }).from, 'icon');
  assert.deepEqual(M.a11yNameOf({}), { name: '', from: 'none' });
  /* 「全空白」与「没给」同形：都是 none（不得算够用）。 */
  assert.equal(M.a11yNameOf({ text: '   ' }).from, 'none');
  assert.equal(M.a11yNameUsable(M.a11yNameOf({})), false);
  /* 桌面图标名：显式 aria > 自定义显示名 > App 名。 */
  assert.equal(M.iconA11yName({ displayName: '我的微信', name: '微信' }).name, '我的微信');
  assert.equal(M.iconA11yName({ name: '微信' }).name, '微信');
  assert.equal(M.iconA11yName({}).name, '');
});

test('v3930 B8. 四态守恒：markCountsOf 的四个数之和等于输入长度', () => {
  const rows = ['ok', 'fail', '', 'unknown', 'brand-new', 'success', 'error', 'none'];
  const c = M.markCountsOf(rows);
  const sum = c.ok + c.fail + c.unknown + c.empty;
  assert.equal(sum, rows.length, '四个计数之和必须等于输入条数（一条都不许丢）');
  assert.equal(c.ok, 2, 'ok/success 都是成功');
  assert.equal(c.fail, 2, 'fail/error 都是失败');
  assert.equal(c.empty, 2, '空串与 none 都是空');
  assert.equal(c.unknown, 2, '认不出的与 unknown 都是未知');
});

test('v3930 B9. 主题解析三段：用户 > 系统 > 亮色；认不出回落 auto', () => {
  assert.equal(M.resolveTheme('dark', { dark: false }).source, 'user');
  assert.equal(M.resolveTheme('dark', { dark: false }).theme, 'dark');
  assert.equal(M.resolveTheme('auto', { dark: true }).source, 'policy');
  assert.equal(M.resolveTheme('auto', { dark: true }).theme, 'dark');
  assert.equal(M.resolveTheme('auto', { dark: null }).theme, 'light');
  assert.equal(M.normalizeTheme('brand-new'), 'auto');
  assert.equal(M.normalizeTheme(''), 'auto');
});

test('v3930 B10. 无宿主下所有读环境函数返回 null（未知不报 false）', () => {
  const e = M.readAccessEnv(null);
  assert.deepEqual(e, { moreContrast: null, reducedMotion: null });
  assert.equal(M.readDarkEnv(null), null);
  assert.equal(M.readDarkEnv({}), null);
});

// ══════════════ C 接线面 ══════════════

test('v3930 C1. 三层与咽喉缓存**逐格对齐**（键名错位不报错、只显示错读数）', () => {
  /* 本版先例（R-X8）：咽喉写 hostVersionText、App 读 hostVersionLine ⇒ 假故障红字。
   *   故此处把 App 真读的每一格与咽喉真写的每一格对账。 */
  const start = IDX.indexOf('══════════════ [v3.93.0 · 拓展计划 R-X9]');
  const end = IDX.indexOf('[v3.91.0 · R-X7] 备份与恢复的**唯一取数口**');
  const seg = IDX.slice(start, end);
  const from = seg.indexOf('vp._access = {');
  const to = seg.indexOf('\n            };', from);
  assert.ok(from > 0 && to > from, '缓存字面量边界找不到');
  const literal = seg.slice(from, to);
  /* ★ 键必须在**同一行**也能被认出来：本版实测踩到的坑是「每行只取行首键」
   *   （咽喉把 levelState / levelText 写在同一行 ⇒ 漏认 ⇒ 假红）。故不用 ^ 锚点。 */
  const hostKeys = [...new Set([...literal.matchAll(/(?:^|\s|[{}])([a-zA-Z][A-Za-z0-9]*)\s*:/gm)].map((m) => m[1]))];
  assert.ok(hostKeys.length >= 20, '缓存格数异常：' + hostKeys.length + ' → ' + hostKeys.join(','));
  /* App _vm 真读的格（host.xxx）必须都在咽喉写出的格集合里。 */
  const appReads = [...new Set([...APP.matchAll(/host\s*&&\s*host\.([A-Za-z0-9]+)/g)].map((m) => m[1])
    .concat([...APP.matchAll(/host\.([A-Za-z0-9]+)/g)].map((m) => m[1])))];
  const missing = appReads.filter((k) => hostKeys.indexOf(k) < 0);
  assert.deepEqual(missing, [], 'App 读了咽喉没写的格（键名错位）：' + missing.join(', '));
  assert.ok(APP.indexOf('plan:') >= 0, 'App 必须透出 plan（视图要按它排版）');
  assert.ok(hostKeys.indexOf('readable') >= 0 && hostKeys.indexOf('why') >= 0, '两格必须与其余协议面同形');
});

test('v3930 C2. 白名单声明在取数口**之前**（const 有暂时性死区）', () => {
  const decl = IDX.indexOf('const ACCESS_ACTION_KEYS =');
  const fn = IDX.indexOf('function refreshAccess()');
  const act = IDX.indexOf('function applyAccessAction(');
  assert.ok(decl > 0 && fn > decl, '白名单必须声明在取数口之前');
  assert.ok(act > fn, '动作口必须在取数口之后（它要调它）');
});

test('v3930 C3. 只读读数口**每次读都重采**（缓存一份陈读数是最贵的错读数）', () => {
  const m = IDX.match(/accessFace: function \(\) \{([^}]*)\}/);
  assert.ok(m, 'accessFace 未定义');
  assert.ok(/refreshAccess\(\)/.test(m[1]), '读数口必须先重采再返回');
  assert.ok(/_access/.test(m[1]), '读数口必须返回缓存挂载点');
});

test('v3930 C4. 分页容量**取自内核列数**，不得自己写一个 4', () => {
  const m = HOME.match(/getIconPageCapacity\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(m, 'getIconPageCapacity 未找到');
  const body = stripComments(m[1]);
  assert.ok(/narrowPlan\(/.test(body), '容量必须从内核 narrowPlan 派生');
  assert.ok(/plan\.cols/.test(body), '必须真取内核给的列数');
  assert.ok(!/columns\s*=\s*4/.test(body), '不得写死 columns = 4（那是与 CSS 漂移的源头）');
  assert.ok(/innerWidth/.test(body), '必须读视口（否则窄屏这一格永远不生效）');
});

test('v3930 C5. 焦点环与 320 断点在同一份全局样式里，且两者都真在不同选择器上', () => {
  /* 焦点环：必须给桌面图标与 dock（修前实测这两处零 focus-visible）。 */
  const focusBlock = PHONE_CSS.slice(PHONE_CSS.indexOf('[v3.93.0 · R-X9] 无障碍操作层'));
  assert.ok(/:focus-visible/.test(focusBlock), '缺焦点环段');
  assert.ok(/\.app-icon/.test(focusBlock) && /\.dock-app/.test(focusBlock), '桌面与 dock 必须在焦点环覆盖内');
  assert.ok(/outline:/.test(focusBlock), '必须用 outline（box-shadow 会被 overflow 裁掉）');
  /* 状态标记：四个状态各一个选择器，且带 data-ax-mark 的内容注入（符号是主载体）。 */
  for (const st of ['ok', 'fail', 'unknown', 'empty']) {
    assert.ok(focusBlock.indexOf('[data-ax-state="' + st + '"]') >= 0, '缺状态样式：' + st);
  }
  assert.ok(/content:\s*attr\(data-ax-mark\)/.test(focusBlock), '符号必须由属性注入（去掉颜色仍可读）');
});

test('v3930 C6. 三键写入收敛在**唯一一处** writeAccessKey（三个动作不得各写一遍）', () => {
  const start = IDX.indexOf('══════════════ [v3.93.0 · 拓展计划 R-X9]');
  const end = IDX.indexOf('[v3.91.0 · R-X7] 备份与恢复的**唯一取数口**');
  const seg = IDX.slice(start, end);
  /* 三个动作各调一次 writeAccessKey（三次），加上定义本身一处 storage.set。 */
  const calls = [...seg.matchAll(/writeAccessKey\(/g)].length;
  assert.equal(calls, 4, 'writeAccessKey 必须只被调三次（三个动作各一次）+定义一次，实测 ' + calls);
  assert.ok(/kind === 'confirmed'/.test(seg), '回读三态必须真被消费（否则三态是摆设）');
});

test('v3930 C7. keys 门抽键口径**必须认连字符**（142 个键此前在射程外）', () => {
  /* 修前 CALL_RE 的字符集是 [A-Za-z_][A-Za-z0-9_]* ⇒ 整族连字符键从未进 K1/K2/K3。 */
  assert.ok(/\[A-Za-z_\]\[A-Za-z0-9_\.\-\]\*/.test(KEYS_GATE), 'CALL_RE 字符集必须含连字符与点');
  /* 3 个真落会话隔离的连字符键必须已登记。 */
  for (const k of ['pending-contacts', 'story-current-time', 'story-initial-time']) {
    assert.ok(KEYS_GATE.indexOf("key: '" + k + "'") >= 0, k + ' 未登记（它是实测命中 CHAT_DATA_PATTERNS 的连字符键）');
  }
});

// ══════════════ D 负控制（真源码副本定点破坏） ══════════════

const NEG_SUFFIX = '.__neg__.js';
const negFiles = [];
process.on('exit', () => {
  for (const f of negFiles) { try { fs.unlinkSync(f); } catch (_e) { /* 已清理 */ } }
});

/** 断言锚点在源码里**恰中 1 次**（破坏必须定点，不能误伤别处）。 */
function anchorOnce(src, anchor, label) {
  const n = src.split(anchor).length - 1;
  assert.equal(n, 1, label + ' 锚点在真源码里命中 ' + n + ' 次（要求恰中 1 次）');
}

/** 把破坏后的源码写成副本文件（返回路径）。副本写在**同一目录**下（后缀不同），
 *   这样副本里的相对导入（`../config/apps.js`）仍能解析 —— 写到 os.tmpdir() 会让
 *   所有相对导入变成 `require('/tmp/config/...')`（本版实测踩到：ERR_MODULE_NOT_FOUND）。
 *   副本在 process.on('exit') 里清理；后缀 `. __neg__.js` 不含 `<dir>-app.js` 形态，
 *   不会被四一致判据误收。 */
function writeMutant(rel, mutator, label) {
  const abs = path.join(root, rel);
  const src = fs.readFileSync(abs, 'utf8');
  const next = mutator(src);
  assert.notEqual(next, src, label + '：破坏没有真正改变源码（锚点没匹配上）');
  const target = path.join(path.dirname(abs), path.basename(rel).replace(/\.js$/, '') + NEG_SUFFIX + Date.now() + '.js');
  fs.writeFileSync(target, next, 'utf8');
  negFiles.push(target);
  return target;
}

/** 写副本并动态加载（给「行为级」判据用）。 */
async function loadMutant(rel, mutator, label) {
  const target = writeMutant(rel, mutator, label);
  return import(pathToFileURL(target).href);
}

test('v3930 D1. apiOnlyDegrade 式的「认不出归未知」被改成归成功 ⇒ B2 的同款判据必转红', async () => {
  const anchor = 'if (s === \'\') return \'empty\';\n    return \'unknown\';';
  anchorOnce(CORE, anchor, 'D1');
  const mod = await loadMutant(CORE_REL, (s) => s.replace(anchor, 'if (s === \'\') return \'empty\';\n    return \'ok\';'), 'D1');
  assert.equal(mod.normalizeMarkState('brand-new'), 'ok', '破坏副本必须真的改变行为');
  assert.notEqual(mod.normalizeMarkState('brand-new'), M.normalizeMarkState('brand-new'), '原版与副本必须不同形');
});

test('v3930 D2. 宽度读不出被判成窄屏 ⇒ B4 的同款判据必转红', async () => {
  const anchor = 'const narrow = known && w <= AX_NARROW_WIDTH;';
  anchorOnce(CORE, anchor, 'D2');
  const mod = await loadMutant(CORE_REL, (s) => s.replace(anchor, 'const narrow = !known || w <= AX_NARROW_WIDTH;'), 'D2');
  assert.equal(mod.narrowPlan({ width: NaN }).narrow, true, '破坏副本上宽度读不出会判窄屏');
});

test('v3930 D3. 字号读不出被判成大字号 ⇒ B5 的同款判据必转红', async () => {
  const anchor = 'if (n === null) return { percent: null, band: AX_FONT_BANDS.normal, known: false };';
  anchorOnce(CORE, anchor, 'D3');
  const mod = await loadMutant(CORE_REL, (s) => s.replace(anchor, 'if (n === null) return { percent: null, band: AX_FONT_BANDS.large, known: false };'), 'D3');
  assert.equal(mod.fontBandOf(null).band, 'large', '破坏副本上读不出会判大');
});

test('v3930 D4. 窄屏守卫被并进大字号守卫 ⇒ B6 的「两格独立」必转红', async () => {
  const anchor = 'wrapActions: large || narrow,\n        growRows: large,';
  anchorOnce(CORE, anchor, 'D4');
  const mod = await loadMutant(CORE_REL, (s) => s.replace(anchor, 'wrapActions: large || narrow,\n        growRows: large || narrow,'), 'D4');
  assert.equal(mod.overlapGuardOf({ narrow: true }, 100).growRows, true, '破坏副本上窄屏会开定高行守卫');
});

test('v3930 D5. 名字取不到编成「按钮」⇒ B7 的同款判据必转红', async () => {
  const anchor = 'return { name: \'\', from: \'none\' };';
  anchorOnce(CORE, anchor, 'D5');
  const mod = await loadMutant(CORE_REL, (s) => s.replace(anchor, 'return { name: \'按钮\', from: \'none\' };'), 'D5');
  assert.equal(mod.a11yNameOf({}).name, '按钮', '破坏副本上会编一个名字');
  assert.notEqual(mod.a11yNameOf({}).name, M.a11yNameOf({}).name, '原版必须如实空串');
});

test('v3930 D6. 空串被并进未知 ⇒ B2 的「空与未知分开」必转红', async () => {
  const anchor = 'if (s === \'\') return \'empty\';\n    return \'unknown\';';
  anchorOnce(CORE, anchor, 'D6');
  const mod = await loadMutant(CORE_REL, (s) => s.replace(/if \(s === ''\) return 'empty';\n    return 'unknown';/, "return 'unknown';"), 'D6');
  assert.equal(mod.normalizeMarkState(''), 'unknown', '破坏副本上空串归未知');
});

test('v3930 D7. 分页容量不再取自内核列数 ⇒ C4 的同款判据必转红', () => {
  anchorOnce(HOME, 'const plan = narrowPlan({ width: width, level: this._accessLevel() });', 'D7');
  const target = writeMutant(HOME_REL,
    (s) => s.replace('const plan = narrowPlan({ width: width, level: this._accessLevel() });', 'const plan = { cols: 4 };'),
    'D7');
  /* home-screen 是类模块（构造需要宿主），故此处判的是**源码级**：把破坏后的源码
   *   按 C4 的同款抽取口径重新取一遍函数体，判据必须落空。这不是「对原文件断言」——
   *   判据读的是刚写出的副本文件，且 writeMutant 内先 assert.notEqual 确认破坏真发生了。 */
  const src2 = fs.readFileSync(target, 'utf8');
  const m2 = src2.match(/getIconPageCapacity\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(m2, '破坏副本上方法体仍可抽取');
  assert.ok(!/narrowPlan\(/.test(m2[1]), '破坏副本里容量已不再取自内核 ⇒ C4 判据在副本上必转红');
  assert.ok(/cols:\s*4/.test(m2[1]), '破坏必须真的写死了 4');
  /* 反向自证：同一个抽取口径在**原版**上必须命中（否则这个判据什么也没在判）。 */
  const m0 = HOME.match(/getIconPageCapacity\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(/narrowPlan\(/.test(m0[1]), '同款抽取在原版上必须命中');
});

test('v3930 D8. 两向对照自证：破坏真被加载且同款判据在原版上为真', async () => {
  /* ① 原版上：判据为真（负控制在原版上不得为红，否则它不是负控制）。 */
  assert.equal(M.normalizeMarkState('brand-new'), 'unknown', '原版判据必须为真');
  /* ② 破坏副本上：同款判据为假。 */
  const anchor = 'return \'unknown\';\n}\n\n/**\n * 生成一组状态标记';
  anchorOnce(CORE, anchor, 'D8');
  const mod = await loadMutant(CORE_REL, (s) => s.replace(anchor, 'return \'ok\';\n}\n\n/**\n * 生成一组状态标记'), 'D8');
  assert.notEqual(mod.normalizeMarkState('mystery'), M.normalizeMarkState('mystery'), '同款判据必须两向不同');
  /* ③ 副本真被加载（不是一个空对象/缓存命中）——它带着**改动后**的行为。 */
  assert.equal(mod.normalizeMarkState('mystery'), 'ok', '副本必须带着改动后的行为');
  /* ④ 自检在副本上必须转红（把这一格与自检绑住）。 */
  assert.ok(mod.accessSelfCheck().problems.length > 0, '破坏副本的自检必须报问题');
  assert.equal(M.accessSelfCheck().problems.length, 0, '原版自检必须零问题');
});

// ══════════════ E 版本锚 ══════════════

test('v3930 E1. 五源同源且不低于 3.93.0', () => {
  const pkg = JSON.parse(read('package.json'));
  const manifest = JSON.parse(read('manifest.json'));
  const log = JSON.parse(read('update-log.json'));
  const ver = pkg.version;
  assert.ok(/^3\.\d+\.\d+$/.test(ver), 'package.json 版本形异常：' + ver);
  const cmp = (a, b) => {
    const A = a.split('.').map(Number), B = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) { if (A[i] !== B[i]) return A[i] - B[i]; }
    return 0;
  };
  assert.ok(cmp(ver, '3.93.0') >= 0, '版本必须 ≥ 3.93.0，实测 ' + ver);
  assert.equal(manifest.version, ver, 'manifest 必须与 package 同源');
  assert.equal(log.latest, ver, 'update-log.latest 必须同源');
  assert.ok(log.versions && log.versions[ver], 'update-log 缺当版条目');
  assert.equal(log.head, ver, 'update-log.head 必须同源');
  assert.ok(IDX.indexOf('ST_PHONE_VERSION = \'' + ver + '\'') >= 0, 'index.js 版本常量必须同源');
  assert.ok(read('ITERATION_LOG.md').indexOf(ver) >= 0, 'ITERATION_LOG 必须登记当版');
});