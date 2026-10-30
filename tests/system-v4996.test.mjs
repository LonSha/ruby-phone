/* ============================================================
 * tests/system-v4996.test.mjs — R11-X8 验收：拟真读数面（设备三域接出）
 * ------------------------------------------------------------
 * 【这一项为什么单列】
 *   电池动力学 / 蜂窝弱网 / 健康手环三个内核早在 R10 就写好、也被中枢实例化了，
 *   但**产品端零 import**（全仓实测：只有 orchestrator 与 tests/ 提到它们）：
 *     · 状态栏电量读的是 `navigator.getBattery()`（宿主真机那一格），
 *       与虚拟手机自己 tick 出来的电量是**两个真源** ——
 *       剧情里手机放电到 5%，状态栏还显示宿主笔记本的 100%；
 *     · 信号是一个恒定 Wi-Fi 图标，电梯/地下密室把格子打到 0 屏幕上看不出来；
 *     · 手环的 historyLog **从声明至今全库零写入**（且没被 _save 带走），
 *       「心率曲线」在手机里从来没存在过。
 *
 * 【X8 的验收语（计划原文）】
 *   ① 状态栏读数与 battery 实例读数**恒等**；
 *   ② 弱网态**可见**；
 *   ③ 健康 App 曲线 **≥10 个点且可回溯**；
 *   ④ 把中枢实例换成桩 ⇒ 状态栏报「**数据缺失**」而不是显示旧值。
 *   不许：三态同形（读不到 / 没电 / 读取失败 都显示同一个样子）。
 *
 * 【覆盖】
 *   A 桥接层：导出面 / 未知回落 / 三态不同形 / 不写键不 new 实例（房式四条）
 *   B 恒等：状态栏那格画的数**就是**中枢实例 face() 里的数（逐档对拍）
 *   C 弱网可见：0 格 / 1 格 / 正常 三档在 DOM 上真的看得出不同
 *   D 桩面：中枢换成桩 ⇒ 报数据缺失，且**不显示旧值**（本版的核心验收）
 *   E 曲线：≥10 点且可回溯（按时间升序、跨度可算），不足时不画线
 *   F 接线自证：壳只读不反查 / 三处 import 真在 / 采样真被调到（不是「写了没人调」）
 *   G 负控制：真源码破坏 ⇒ 在副本上重跑**同款判据**必须转红（两向断言）
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDomStub } from './_dom_stub.mjs';
import {
  DEVICE_FACE_DOMAINS, DEVICE_DOMAIN_META, DEVICE_FEED_REASONS,
  HEALTH_SERIES_MIN, SIGNAL_BARS_MAX,
  batteryFaceOf, signalFaceOf, bandSeriesOf, deviceLineOf, seedFromHost, deviceFaceOf
} from '../config/device-face-bridge.js';
import { BatteryThermodynamics } from '../config/battery-thermodynamics.js';
import { CellularSignalSim, NETWORK_TYPES } from '../config/cellular-signal-sim.js';
import { SmartBandBiometrics, BAND_HISTORY_MAX } from '../config/smart-band-biometrics.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, '..');
const BRIDGE_REL = 'config/device-face-bridge.js';
const SHELL_REL = 'phone/phone-shell.js';
const BATT_REL = 'config/battery-thermodynamics.js';
const BAND_REL = 'config/smart-band-biometrics.js';
const CELL_REL = 'config/cellular-signal-sim.js';
const HV_REL = 'apps/health/health-view.js';
const SETTINGS_REL = 'apps/settings/settings-app.js';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** 内存 storage（本仓 storage 面只有 get/set）。 */
function memStorage(init = {}) {
  const mem = new Map(Object.entries(init));
  return {
    _mem: mem,
    get: (k, d) => (mem.has(k) ? mem.get(k) : d),
    set: (k, v) => { mem.set(k, v); },
    keys: () => [...mem.keys()]
  };
}

/* ── 真外壳夹具：DOM 桩 + 最小 window，真的 new 出 PhoneShell 并 createInPanel ── */
/** 装一套能让 PhoneShell 真跑起来的宿主（返回句柄，含 restore）。 */
function installShellHost() {
  const stub = installDomStub();
  const listeners = [];
  const prev = { window: globalThis.window, CustomEvent: globalThis.CustomEvent, MutationObserver: globalThis.MutationObserver };
  const win = {
    addEventListener(t, h) { listeners.push({ t, h }); },
    removeEventListener() {},
    dispatchEvent() { return true; },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    innerWidth: 390, innerHeight: 844, devicePixelRatio: 3,
    location: { href: 'http://x/', hash: '', search: '' },
    history: { pushState() {}, replaceState() {}, back() {}, state: null },
    VirtualPhone: { timeManager: null }
  };
  globalThis.window = win;
  globalThis.CustomEvent = class { constructor(t, o) { this.type = t; Object.assign(this, o || {}); } };
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  /* [v4.99.6] 造出来的壳统一登记，restore 时逐个 destroy。
   *   为什么要这个登记表：壳在 createInPanel 里挂了一个 30s 时钟轮询（走登记层），
   *   一旦某条判据在 try 块中间抛错，`shell.destroy()` 就永远走不到 ——
   *   进程被那个 interval 钉住，整套 `node --test` 会**卡到外部超时**（本轮实测踩到一次：
   *   C1 断言失败 ⇒ 套件挂死 300s ⇒ 被 SIGTERM，看起来像「跑不完」而不是「一条红了」）。
   *   判据红不该让门禁挂死，故回收放在夹具的收尾里。 */
  const shells = [];
  return {
    stub, listeners, win,
    track(shell) { shells.push(shell); return shell; },
    restore() {
      for (const s of shells) { try { s.destroy(); } catch (_e) { /* 收尾失败不掩盖原错 */ } }
      shells.length = 0;
      stub.restore();
      globalThis.window = prev.window;
      globalThis.CustomEvent = prev.CustomEvent;
      globalThis.MutationObserver = prev.MutationObserver;
    }
  };
}

/* 壳里那三处节点的读数快照（判据只看这个，不碰内部字段）。 */
function faceNodesOf(host_) {
  const c = host_;
  const bt = c.querySelector('.battery-text');
  const bl = c.querySelector('.battery-level');
  const bi = c.querySelector('.battery-icon');
  const sig = c.querySelector('.phone-cell-signal');
  const bars = sig.querySelectorAll('.cell-bar');
  return {
    text: bt ? bt.textContent : null,
    width: bl ? bl.style.width : null,
    status: bi ? bi.getAttribute('data-status') : null,
    signalStatus: sig ? sig.getAttribute('data-status') : null,
    /* 点亮的格数：读 `data-bars`（壳逐拍如实写下的那个数）。
     *   ★ 为什么不去数 `.cell-bar.on`：DOM 替身不解析 HTML —— 五个 <i> 是模板字符串里的
     *     静态片段，替身看不见，`querySelectorAll('.cell-bar')` 只会返回「按 innerHTML
     *     里出现次数」造出来的空壳（X5 的排除面替身也是这个口径：不解析、只记账）。
     *     故判据读的是**壳写下的属性**，而「属性与点亮的格子同源」由壳的那段代码保证。 */
    bars: sig ? Number(sig.getAttribute('data-bars')) : null,
    barCount: bars.length,
    signalLine: sig ? sig.getAttribute('aria-label') : null
  };
}

/* ── A 桥接层（房式四条） ──────────────────────────────────── */
test('A1 桥接层导出面：三域元信息齐 + 归因词表互不相同 + 上限为正整数', () => {
  assert.equal(Object.keys(DEVICE_FACE_DOMAINS).length, 3);
  for (const k of ['BATTERY', 'SIGNAL', 'BAND']) assert.ok(DEVICE_FACE_DOMAINS[k], '缺域：' + k);
  for (const d of ['battery', 'signal', 'band']) {
    const m = DEVICE_DOMAIN_META[d];
    assert.ok(m, '缺域元信息：' + d);
    assert.ok(m.label && m.emptyLine && m.appId, '域元信息不齐：' + d);
  }
  const words = Object.values(DEVICE_FEED_REASONS).filter(Boolean);
  assert.equal(new Set(words).size, words.length, '归因词必须互不相同');
  for (const w of ['no_host', 'no_subsystems', 'no_domain', 'no_method', 'read_threw', 'bad_result']) {
    assert.ok(words.includes(w), '归因词表缺：' + w);
  }
  assert.ok(Number.isInteger(HEALTH_SERIES_MIN) && HEALTH_SERIES_MIN > 0);
  assert.ok(Number.isInteger(SIGNAL_BARS_MAX) && SIGNAL_BARS_MAX > 0);
});

test('A2 桥接层是纯映射：不 import storage、不写键、不 new 实例、不摸 localStorage', () => {
  const code = stripComments(read(BRIDGE_REL));
  assert.ok(!/localStorage/.test(code), '桥接层不得直接摸 localStorage');
  assert.ok(!/\bnew\s+[A-Z]/.test(code), '桥接层不得 new 实例');
  assert.ok(!/\.set\(/.test(code), '桥接层不得写键');
  const imports = [...code.matchAll(/from\s+'([^']+)'/g)].map(m => m[1]);
  assert.deepEqual(imports, ['./num-gate.js'], '桥接层只该依赖 num-gate（取数口径单一实现）');
});

test('A3 三态不同形：读不到 / 读取失败 / 正常，三句话必须互不相同', () => {
  const missing = batteryFaceOf({ ok: false, why: 'no_subsystems' });
  const threw = batteryFaceOf({ ok: false, why: 'read_threw' });
  const ok = batteryFaceOf({ ok: true, why: '', battery: { level: 47 } });
  assert.equal(missing.state, 'missing');
  assert.equal(threw.state, 'threw');
  assert.equal(ok.state, 'ok');
  const lines = [missing.line, threw.line, ok.line];
  assert.equal(new Set(lines).size, 3, '三态文案必须互不相同：' + lines.join(' | '));
  /* 「读数缺失」必须明写「不是没电」——否则用户会以为手机真没电了。 */
  assert.ok(missing.line.includes('不是「没电」'));
  assert.ok(threw.line.includes('不是「没电」'));
});

test('A4 信号：无服务（0 格，读数正常）与读不到（unknown）必须分两句', () => {
  const noSvc = signalFaceOf({ ok: true, why: '', signal: { bars: 0, networkType: NETWORK_TYPES.NO_SERVICE } });
  const unknown = signalFaceOf({ ok: false, why: 'no_subsystems' });
  assert.equal(noSvc.bars, 0);
  assert.equal(noSvc.state, 'weak', '无服务是一种「坏但可读」的态，不是 missing');
  assert.equal(unknown.state, 'missing');
  assert.ok(noSvc.line.includes('无服务'), '无服务要说出「无服务」');
  assert.ok(unknown.line.includes('数据缺失') && unknown.line.includes('不是「无服务」'),
    '读不到不许被说成「无服务」（那是把系统坏了粉饰成你在地下室）');
  assert.notEqual(noSvc.line, unknown.line);
});

/* ── B 恒等：状态栏画的就是中枢读的 ───────────────────────── */
test('B1 恒等（逐档对拍）：状态栏那格显示的，就是 battery 实例 face() 里的数', async () => {
  const host = installShellHost();
  try {
    const { PhoneShell } = await import('../phone/phone-shell.js');
    const shell = host.track(new PhoneShell());
    shell.createInPanel(host.stub.document.createElement('div'));
    const batt = new BatteryThermodynamics({ initialLevel: 63, storage: memStorage() });
    /* 壳只认注入的读数口；这里把「中枢实例的 face()」原样接进去 —— 与 index.js 装配同形。 */
    shell.readDeviceFace = () => ({ battery: batt.face(), signal: { ok: false, why: 'no_subsystems' } });
    shell.refreshDeviceFace();
    let n = faceNodesOf(shell.container);
    assert.equal(n.text, '63', '状态栏数字必须等于实例电量（63）');
    assert.equal(n.width, '63%');
    assert.equal(n.status, 'ok');
    /* 让实例自己 tick 掉一段 —— 状态栏跟着变，且仍然恒等。 */
    batt.setAppLoad('GAME');
    batt.tick(30);
    shell.refreshDeviceFace();
    n = faceNodesOf(shell.container);
    const face = batt.face();
    assert.equal(n.text, String(Math.round(face.battery.level)), 'tick 之后仍必须恒等');
    assert.equal(n.width, Math.round(face.battery.level) + '%');
    shell.destroy();
  } finally { host.restore(); }
});

test('B2 恒等（seedOnce 之后）：一次性种子进来后，状态栏读的仍是实例那一份', async () => {
  const host = installShellHost();
  try {
    const { PhoneShell } = await import('../phone/phone-shell.js');
    const shell = host.track(new PhoneShell());
    shell.createInPanel(host.stub.document.createElement('div'));
    const storage = memStorage();
    const batt = new BatteryThermodynamics({ initialLevel: 85, storage });
    /* 宿主那格（真机 100%）只当一次初值。 */
    const seed = seedFromHost({ ok: true, level: 100, charging: true });
    assert.equal(seed.ok, true);
    const r1 = batt.seedOnce(seed);
    assert.equal(r1.seeded, true, '盘上没状态 ⇒ 首次种子必须被接纳');
    assert.equal(r1.level, 100);
    /* 第二次种子必须被拒 —— 两个真源同时活着正是本版要治的病。 */
    const r2 = batt.seedOnce(seedFromHost({ ok: true, level: 12, charging: false }));
    assert.equal(r2.seeded, false);
    assert.equal(r2.why, 'already_saved', '盘上已有状态 ⇒ 必须拒绝覆盖（不回退用户剧情推进）');
    shell.readDeviceFace = () => ({ battery: batt.face(), signal: { ok: false, why: 'no_subsystems' } });
    shell.refreshDeviceFace();
    const n = faceNodesOf(shell.container);
    assert.equal(n.text, '100', '状态栏必须显示实例那一份，而不是宿主再来一次');
    assert.equal(n.status, 'ok');
    shell.destroy();
  } finally { host.restore(); }
});

/* ── C 弱网可见 ───────────────────────────────────────────── */
test('C1 弱网可见：正常 / 1 格 / 无服务 三档在 DOM 上真的看得出不同', async () => {
  const host = installShellHost();
  try {
    const { PhoneShell } = await import('../phone/phone-shell.js');
    const shell = host.track(new PhoneShell());
    shell.createInPanel(host.stub.document.createElement('div'));
    const cell = new CellularSignalSim({ storage: memStorage() });
    /* ① 正常：4 格。 */
    cell.setSignalBars(4, NETWORK_TYPES.FIVE_G);
    shell.readDeviceFace = () => ({ battery: { ok: false, why: 'no_domain' }, signal: cell.face() });
    shell.refreshDeviceFace();
    const normal = faceNodesOf(shell.container);
    assert.equal(normal.bars, 4, '4 格信号 ⇒ 状态栏必须报 4 格');
    assert.equal(normal.signalStatus, 'ok');
    assert.equal(normal.signalLine, cell.face().signal && signalFaceOf(cell.face()).line, '状态栏那句必须就是桥接层判出来的那句');
    /* ② 剧情打到「只剩一格」—— 屏幕上必须看得出来。 */
    cell.setSignalBars(1, NETWORK_TYPES.THREE_G);
    shell.refreshDeviceFace();
    const weak = faceNodesOf(shell.container);
    assert.equal(weak.bars, 1, '1 格信号 ⇒ 只亮 1 格');
    assert.equal(weak.signalStatus, 'weak', '弱网必须被标成 weak（降透明/变色那一档）');
    assert.notEqual(weak.bars, normal.bars, '弱网与正常必须在屏幕上不同形');
    assert.notEqual(weak.signalLine, normal.signalLine);
    /* ③ 电梯 / 地下密室：0 格。 */
    cell.applyEnvironmentScenario('ELEVATOR');
    shell.refreshDeviceFace();
    const none = faceNodesOf(shell.container);
    assert.equal(none.bars, 0, '无服务 ⇒ 一格都不亮');
    assert.equal(none.signalStatus, 'weak');
    assert.notEqual(none.bars, weak.bars);
    /* ④ 中枢换成桩：读不到时格数回落 0（不是停在 1），且与「无服务」分档。 */
    shell.readDeviceFace = () => ({ battery: { ok: false, why: 'no_domain' }, signal: { ok: false, why: 'no_subsystems' } });
    shell.refreshDeviceFace();
    const unknown = faceNodesOf(shell.container);
    assert.equal(unknown.bars, 0, '读不到 ⇒ 不许沿用上一拍的 1 格');
    assert.equal(unknown.signalStatus, 'missing');
    assert.notEqual(unknown.signalStatus, none.signalStatus, '「读不到」与「无服务」必须分档');
    assert.notEqual(unknown.signalLine, none.signalLine, '两句文案也必须不同（一个说无服务、一个说数据缺失）');
    shell.destroy();
  } finally { host.restore(); }
});

test('C2 弱网可见（源码面）：CSS 里 weak 与 unknown 各有自己的选择器，不是同一档', () => {
  const css = read('phone.css');
  for (const sel of ['.phone-cell-signal', '.cell-bar', '.cell-bar.on', '.cell-weak', '.cell-unknown']) {
    assert.ok(css.includes(sel), 'CSS 缺选择器：' + sel);
  }
  assert.ok(/\[data-status="weak"\]/.test(css) || /\.cell-weak/.test(css), '弱网必须有自己的样式');
  assert.ok(/\[data-status="missing"\]|\[data-status="threw"\]/.test(css), '读不到必须有自己的样式');
  /* 弱网是**变色**（可见），不是降透明到看不见。 */
  assert.ok(/\.cell-weak\s+\.cell-bar\.on/.test(css), '弱网要有单独配色规则');
});

/* ── D 桩面：核心验收（不含旧值） ─────────────────────────── */
test('D1 把中枢换成桩 ⇒ 报「数据缺失」，且**不显示旧值**', async () => {
  const host = installShellHost();
  try {
    const { PhoneShell } = await import('../phone/phone-shell.js');
    const shell = host.track(new PhoneShell());
    shell.createInPanel(host.stub.document.createElement('div'));
    /* ① 先接真读数，屏幕上出现 47%。 */
    shell.readDeviceFace = () => ({ battery: { ok: true, why: '', battery: { level: 47 } }, signal: { ok: true, why: '', signal: { bars: 3, networkType: NETWORK_TYPES.FOUR_G } } });
    shell.refreshDeviceFace();
    assert.equal(faceNodesOf(shell.container).text, '47');
    /* ② 中枢被换成桩（没有 face 能力）⇒ 必须报数据缺失。 */
    shell.readDeviceFace = () => ({ battery: { ok: false, why: 'no_domain' }, signal: { ok: false, why: 'no_domain' } });
    shell.refreshDeviceFace();
    const n = faceNodesOf(shell.container);
    assert.equal(n.text, '--', '★ 必须回到 --，绝不能停在 47（显示旧值冒充当前读数）');
    assert.equal(n.width, '0%', '★ 条宽必须回到 0，不许停在 47%');
    assert.equal(n.status, 'missing');
    assert.notEqual(n.text, '47');
    shell.destroy();
  } finally { host.restore(); }
});

test('D2 读数口本身抛错 ⇒ 报「读取失败」，仍然不显示旧值', async () => {
  const host = installShellHost();
  try {
    const { PhoneShell } = await import('../phone/phone-shell.js');
    const shell = host.track(new PhoneShell());
    shell.createInPanel(host.stub.document.createElement('div'));
    shell.readDeviceFace = () => ({ battery: { ok: true, why: '', battery: { level: 82 } }, signal: { ok: true, why: '', signal: { bars: 5, networkType: NETWORK_TYPES.FIVE_G } } });
    shell.refreshDeviceFace();
    assert.equal(faceNodesOf(shell.container).text, '82');
    /* 读数口抛 —— 壳必须自己接住并标 threw（不许把异常漏到外面、也不许停在 82）。 */
    shell.readDeviceFace = () => { throw new Error('hub exploded'); };
    let threw = false;
    try { shell.refreshDeviceFace(); } catch (_e) { threw = true; }
    assert.equal(threw, false, '读数口抛错不得把状态栏带挂');
    const n = faceNodesOf(shell.container);
    assert.equal(n.text, '--');
    assert.equal(n.status, 'threw');
    assert.notEqual(n.status, 'missing', '「读取失败」与「数据缺失」必须分档');
    shell.destroy();
  } finally { host.restore(); }
});

test('D3 桩面下 batteryLevel 本身也必须回到未知（null），不是留在旧值', async () => {
  const host = installShellHost();
  try {
    const { PhoneShell } = await import('../phone/phone-shell.js');
    const shell = host.track(new PhoneShell());
    shell.createInPanel(host.stub.document.createElement('div'));
    shell.readDeviceFace = () => ({ battery: { ok: true, why: '', battery: { level: 33 } }, signal: { ok: false, why: 'no_domain' } });
    shell.refreshDeviceFace();
    assert.equal(shell.batteryLevel, 33);
    shell.readDeviceFace = () => null;
    shell.refreshDeviceFace();
    assert.equal(shell.batteryLevel, null, '读不到时壳自己的字段也必须是未知（锁屏读的就是它）');
    shell.destroy();
  } finally { host.restore(); }
});

test('D4 锁屏读数与状态栏同源：中枢换成桩后锁屏说的是「数据缺失」而不是编一个数', async () => {
  const shellStub = { _lastDeviceFace: null };
  const { LockScreen } = await import('../phone/lock-screen.js');
  /* ① 读数正常：锁屏那句必须带出真数。 */
  shellStub._lastDeviceFace = { battery: batteryFaceOf({ ok: true, why: '', battery: { level: 47 } }) };
  const ls = new LockScreen(shellStub);
  assert.equal(ls._batteryLine(), '电量 47%');
  /* ② 读数读不到：不许回落一个「看起来正常」的百分比（修前是 78）。 */
  shellStub._lastDeviceFace = { battery: batteryFaceOf({ ok: false, why: 'no_subsystems' }) };
  const line = ls._batteryLine();
  assert.ok(!/\d+%/.test(line), '读不到时锁屏不许出现任何百分比：' + line);
  assert.ok(line.includes('数据缺失'), '锁屏要说清是数据缺失（不是没电）');
  /* ③ 从没画过读数面（字段为 null）也不许编数。 */
  shellStub._lastDeviceFace = null;
  assert.ok(!/\d+%/.test(ls._batteryLine()), '未装配时锁屏同样不许编百分比');
});

/* ── E 曲线：≥10 点且可回溯 ───────────────────────────────── */
test('E1 曲线读数：点数够 / 点位按时间升序 / 跨度可算（可回溯）', () => {
  const log = [];
  /* 故意乱序塞进去：可回溯要求升序，不许照抄数组顺序。 */
  for (const t of [5000, 1000, 3000, 9000, 7000, 2000, 8000, 6000, 4000, 10000, 11000, 12000]) {
    log.push({ t, hr: 70 + (t / 1000) });
  }
  const face = bandSeriesOf({ ok: true, why: '', band: { historyLog: log } });
  assert.equal(face.count, 12);
  assert.equal(face.enough, true, '12 点 ≥ ' + HEALTH_SERIES_MIN + ' 点 ⇒ 够');
  assert.equal(face.state, 'ok');
  for (let i = 1; i < face.points.length; i++) {
    assert.ok(face.points[i].t >= face.points[i - 1].t, '点位必须按时间升序（可回溯）');
  }
  assert.equal(face.spanMs, 11000, '跨度 = 末点 - 首点');
  assert.ok(face.line.includes('12 点'));
});

test('E2 曲线点数不足与一次没采到必须分两句（「刚戴上」不是「手环没在跑」）', () => {
  const thin = bandSeriesOf({ ok: true, why: '', band: { historyLog: [{ t: 1, hr: 70 }, { t: 2, hr: 72 }] } });
  const empty = bandSeriesOf({ ok: true, why: '', band: { historyLog: [] } });
  const missing = bandSeriesOf({ ok: false, why: 'no_domain' });
  assert.equal(thin.state, 'thin');
  assert.equal(empty.state, 'empty');
  assert.equal(missing.state, 'missing');
  assert.equal(new Set([thin.line, empty.line, missing.line]).size, 3, '三句必须互不相同');
  assert.equal(thin.enough, false);
  assert.equal(empty.enough, false);
});

test('E3 健康 App 真的把曲线画出来了（≥10 点 ⇒ 有折线；不足 ⇒ 不画空线）', async () => {
  const prevWin = globalThis.window;
  const store = new Map();
  globalThis.window = {
    VirtualPhone: { subsystems: null },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  };
  try {
    const { HealthView } = await import('../apps/health/health-view.js');
    const v = new HealthView({ data: {}, storage: { get: (k, d) => (store.has(k) ? store.get(k) : d), set: (k, x) => store.set(k, x) } });
    /* ① 12 点 ⇒ 真画折线，且点数与读数一致。 */
    const log = [];
    for (let i = 0; i < 12; i++) log.push({ t: 1000 + i * 60000, hr: 70 + i });
    globalThis.window.VirtualPhone.subsystems = { smartBand: { historyLog: log } };
    const okHtml = v._bandSection();
    assert.ok(okHtml.includes('polyline'), '≥10 点必须真画出折线');
    assert.ok(okHtml.includes('采样 12 点'), '标题必须报出采样点数');
    const pts = (okHtml.match(/points="([^"]*)"/) || [])[1] || '';
    assert.equal(pts.trim().split(/\s+/).length, 12, '折线点数必须等于读数点数');
    /* ② 3 点 ⇒ 不画线（画空线 = 把「读不到」粉饰成「心跳平稳」）。 */
    globalThis.window.VirtualPhone.subsystems = { smartBand: { historyLog: log.slice(0, 3) } };
    const thinHtml = v._bandSection();
    assert.ok(!thinHtml.includes('polyline'), '点数不足时不许画线');
    assert.ok(thinHtml.includes('需 ' + HEALTH_SERIES_MIN + ' 点'), '不足时要说出还差多少');
    /* ③ 读不到 ⇒ 同样不画线，且说出归因。 */
    globalThis.window.VirtualPhone.subsystems = {};
    const missHtml = v._bandSection();
    assert.ok(!missHtml.includes('polyline'));
    assert.ok(missHtml.includes('数据缺失'), '读不到必须明说数据缺失');
  } finally { globalThis.window = prevWin; }
});

test('E4 手环采样：historyLog 有唯一写入口，且随盘走（重载后曲线还在）', () => {
  const storage = memStorage();
  const band = new SmartBandBiometrics({ storage });
  assert.ok(Array.isArray(band.historyLog));
  band.sample(1000);
  band.sample(2000);
  band.sample(3000);
  assert.equal(band.historyLog.length, 3);
  assert.deepEqual(band.historyLog.map(p => p.t), [1000, 2000, 3000]);
  /* 落盘：重载后点数与顺序必须一致（可回溯）。 */
  const again = new SmartBandBiometrics({ storage });
  assert.equal(again.historyLog.length, 3, 'historyLog 必须随盘走（修前它没被 _save 带走）');
  assert.deepEqual(again.historyLog.map(p => p.t), [1000, 2000, 3000]);
  /* 上限：长剧情下不许无界增长。 */
  for (let i = 0; i < BAND_HISTORY_MAX + 50; i++) again.sample(10000 + i);
  assert.equal(again.historyLog.length, BAND_HISTORY_MAX, '超过上限必须裁剪到 BAND_HISTORY_MAX');
  assert.equal(again.historyLog[again.historyLog.length - 1].t, 10000 + BAND_HISTORY_MAX + 49, '裁剪必须留最新的那一段');
});

test('E5 生理变动之后**自动**采样（不靠谁记得手动记一笔）', () => {
  const storage = memStorage();
  const band = new SmartBandBiometrics({ storage });
  band.modulateBiometricsByEvent('PANIC', { at: 111 });
  band.modulateBiometricsByEvent('CALM_REST', { at: 222 });
  assert.equal(band.historyLog.length, 2, '每次生理变动后必须自动采一点');
  assert.deepEqual(band.historyLog.map(p => p.t), [111, 222]);
  assert.equal(band.historyLog[0].hr, band.heartRate >= band.historyLog[0].hr ? band.historyLog[0].hr : band.historyLog[0].hr);
  assert.ok(typeof band.historyLog[0].hr === 'number' && band.historyLog[0].hr >= 55, '每个点都要带可用的 hr');
  assert.ok(typeof band.historyLog[0].stage === 'string', '每个点都要带睡眠阶段（曲线据此分档）');
});

/* ── F 接线自证 ───────────────────────────────────────────── */
test('F1 接线自证：三处 import 真在 + 壳只读不反查中枢 + 无裸 setInterval', () => {
  const shell = stripComments(read(SHELL_REL));
  assert.ok(/from\s+'\.\.\/config\/device-face-bridge\.js'/.test(shell), '壳必须 import 桥接层');
  /* 壳**不反查中枢**（不读 window.VirtualPhone.subsystems）—— 否则它就是第二个真源。 */
  assert.ok(!/VirtualPhone\s*\??\.\s*subsystems/.test(shell), '壳不得反查中枢实例');
  /* 读数口由外部注入，壳自己只调用注入进来的那个。 */
  assert.ok(/this\.readDeviceFace\s*=\s*null/.test(shell), '读数口必须是可注入字段');
  assert.ok(/typeof this\.readDeviceFace === 'function'/.test(shell), '壳必须只在注入后才读数');
  /* 手环采样口真被中枢调到（不是「写了没人调」）。 */
  const orch = stripComments(read('config/subsystem-orchestrator.js'));
  assert.ok(/this\.smartBand\.sample\(/.test(orch), '生活流推进里必须真的调采样（否则曲线永远空着）');
  /* index.js 装配面三件齐。 */
  const idx = stripComments(read('index.js'));
  for (const sym of ['window.VirtualPhone.deviceFace =', 'window.VirtualPhone.seedDeviceBattery =', 'window.VirtualPhone.refreshDeviceFace =']) {
    assert.ok(idx.includes(sym), 'index.js 装配面缺：' + sym);
  }
  assert.ok(/sh\.readDeviceFace = window\.VirtualPhone\.deviceFace/.test(idx), '读数口必须被注入进壳');
  assert.ok(/onTick:\s*\(\)\s*=>\s*\{/.test(idx), '生活流时钟 onTick 必须在场');
  const tickBlock = idx.slice(idx.indexOf('onTick: () => {'), idx.indexOf('onTick: () => {') + 900);
  assert.ok(/refreshDeviceFace\(\)/.test(tickBlock), '推进之后必须重画设备面（否则停在上一拍的读数上）');
});

test('F2 三内核读数口在场且不抛：face() 读坏了如实标 ok:false', () => {
  const batt = new BatteryThermodynamics({ storage: memStorage() });
  const cell = new CellularSignalSim({ storage: memStorage() });
  for (const [inst, name] of [[batt, 'battery'], [cell, 'cellular']]) {
    const f = inst.face();
    assert.equal(f.ok, true, name + '.face() 正常时应 ok');
    assert.equal(f.why, '');
    assert.ok(f[name === 'battery' ? 'battery' : 'signal'], name + ' face() 必须带自己的读数体');
  }
  /* 把实例内部读坏 ⇒ face() 必须标 ok:false 而不是抛。 */
  const broken = new BatteryThermodynamics({ storage: memStorage() });
  Object.defineProperty(broken, 'level', { get() { throw new Error('sensor dead'); } });
  const f2 = broken.face();
  assert.equal(f2.ok, false);
  assert.equal(f2.why, 'read_threw');
  const brokenCell = new CellularSignalSim({ storage: memStorage() });
  Object.defineProperty(brokenCell, 'signalBars', { get() { throw new Error('modem dead'); } });
  const f3 = brokenCell.face();
  assert.equal(f3.ok, false);
  assert.equal(f3.why, 'read_threw');
});

test('F3 三域汇总口：坏一域不牵连另两域，也不携带旧值', () => {
  const all = deviceFaceOf({
    battery: { ok: true, why: '', battery: { level: 50 } },
    signal: { ok: false, why: 'no_domain' },
    band: { ok: true, why: '', band: { historyLog: [] } }
  });
  /* 信号读不到、曲线一次没采到 —— 两域都不是 ok，故 bad 是 2（不是 1）。 */
  assert.equal(all.bad, 2);
  assert.equal(all.total, 3);
  assert.equal(all.battery.state, 'ok');
  assert.equal(all.signal.state, 'missing');
  assert.equal(all.band.state, 'empty');
  assert.ok(all.line.includes('1/3'), '汇总必须报出可读域数：' + all.line);
  /* 一域坏不许把另一域的读数带没（电量仍要如实给 50）。 */
  assert.equal(all.battery.level, 50);
  assert.equal(deviceLineOf(null), '设备读数：数据缺失');
  assert.equal(deviceLineOf(all.battery), all.battery.line);
  /* 三域全坏：不许说成「一切正常」。 */
  const dead = deviceFaceOf({ battery: { ok: false, why: 'no_host' }, signal: { ok: false, why: 'no_host' }, band: { ok: false, why: 'no_host' } });
  assert.equal(dead.bad, 3);
  assert.ok(dead.line.includes('都没读到'));
  assert.ok(dead.line.includes('不是「一切正常」'));
});

test('F4 设置页读数面：三域各一行 / 读不到时归因分档 / 不反查中枢（不当第二个真源）', () => {
  const raw = read(SETTINGS_REL);
  /* 用**真函数体**（不是复制品）：设置页哪天把判定改写回去，这条会跟着红。 */
  const snap = snapshotFnOf(raw);
  /* ① 未装配：三域都得报「数据缺失」，且**一句数字都不许出现**（不编一个看起来正常的读数）。 */
  const off = snap({});
  assert.equal(off.rows.length, 3, '设备读数必须三域各一行');
  assert.deepEqual(off.rows.map((r) => r.domain),
    [DEVICE_FACE_DOMAINS.BATTERY, DEVICE_FACE_DOMAINS.SIGNAL, DEVICE_FACE_DOMAINS.BAND]);
  for (const r of off.rows) {
    assert.equal(r.state, 'missing', r.domain + ' 未装配时必须报读不到：' + r.state);
    assert.ok(r.line.includes('数据缺失'), r.domain + ' 未装配时必须点明数据缺失：' + r.line);
    assert.ok(!/[0-9]/.test(r.line), r.domain + ' 读不到时不许带数字（那是编出来的）：' + r.line);
  }
  assert.ok(off.summary.includes('都没读到'), '三域全读不到时汇总必须说清：' + off.summary);
  assert.ok(off.summary.includes('不是「一切正常」'), '读不到不许粉饰成正常：' + off.summary);

  /* ② 装配且读数就绪：三域都 ok，且数字**原样来自中枢**（47% 不是本页编的）。 */
  const on = snap({
    VirtualPhone: {
      deviceFace: () => ({
        battery: { ok: true, why: '', battery: { level: 47, charging: false, throttling: false, stale: false } },
        signal: { ok: true, why: '', signal: { bars: 3, networkType: '4G' } },
        band: { ok: true, why: '', band: { historyLog: Array.from({ length: 12 }, (_, i) => ({ t: i * 1000, hr: 70 })) } }
      })
    }
  });
  assert.deepEqual(on.rows.map((r) => r.state), ['ok', 'ok', 'ok']);
  assert.ok(on.rows[0].line.includes('47'), '电量必须原样带出中枢读数：' + on.rows[0].line);
  assert.ok(on.rows[1].line.includes('3'), '信号必须带出格数：' + on.rows[1].line);
  assert.ok(on.rows[2].line.includes('12'), '曲线必须带出点数：' + on.rows[2].line);
  assert.ok(on.summary.includes('47'), '三域都可读时汇总必须带上真实读数：' + on.summary);
  assert.ok(on.summary.includes('12'), '汇总必须带上曲线点数：' + on.summary);
  assert.ok(on.summary.includes(String(SIGNAL_BARS_MAX)), '汇总必须用桥接层的格数上限常量，不另写一份');

  /* ③ 读数口抛错 与 未装配 必须**分两句**（都是「读不到」，但归因不同）。 */
  const dead = snap({ VirtualPhone: { deviceFace: () => { throw new Error('host dead'); } } });
  assert.deepEqual(dead.rows.map((r) => r.state), ['missing', 'missing', 'missing']);
  assert.notEqual(dead.rows[0].whyLine, off.rows[0].whyLine, '抛错与未装配不许写成同一句');
  assert.ok(dead.rows[0].whyLine.includes('抛错'), '读数口抛错必须说清是抛错：' + dead.rows[0].whyLine);
  assert.ok(off.rows[0].whyLine.includes('未装配'), '没接线必须说清是未装配：' + off.rows[0].whyLine);
  for (const line of [off.rows[0].whyLine, dead.rows[0].whyLine]) {
    assert.ok(line.includes('不是「没电 / 无服务」'), '归因句必须挡住误解：' + line);
  }

  /* ④ 源码面：设置页**不反查中枢实例**（否则设置页就是第二个真源）+ 三域行的可判面齐。 */
  assert.ok(!/VirtualPhone\s*\??\.\s*subsystems/.test(raw), '设置页不得反查中枢实例');
  assert.ok(/from\s+'\.\.\/\.\.\/config\/device-face-bridge\.js'/.test(raw), '设置页必须真 import 桥接层');
  for (const sym of ['DEVICE_FACE_DOMAINS', 'DEVICE_DOMAIN_META', 'deviceFaceOf', 'deviceLineOf']) {
    assert.ok(raw.includes(sym), '设置页必须真消费桥接层符号：' + sym);
  }
  assert.ok(/data-device-domain="\$\{r\.domain\}"/.test(raw), '三域行必须带 domain 标记（可判面）');
  assert.ok(/data-device-state="\$\{r\.state\}"/.test(raw), '三域行必须带 state 标记（四态色带靠它）');
  assert.ok(/yzp-device-face-line/.test(raw) && /yzp-device-face-why/.test(raw) && /yzp-device-face-sum/.test(raw),
    '读数 / 归因 / 汇总三个可判面必须齐');
});

/* ── G 负控制（真源码破坏 ⇒ 在副本上重跑同款判据必须转红） ── */
/**
 * 纪律（与 X2/X3/X5 同款）：
 *   · 锚点必须恰中 1 次（否则破坏没发生，负控制会假绿）；
 *   · **相对依赖必须一并复制进副本目录**（否则副本载不起来，负控制退化成「夹具坏了」）。
 */
function brokenCopy(rel, pairs, outName) {
  let src = read(rel);
  for (const [from, to] of pairs) {
    const n = src.split(from).length - 1;
    assert.equal(n, 1, '负控制锚点必须恰中一次：' + JSON.stringify(String(from).slice(0, 70)));
    src = src.replace(from, to);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_x8_'));
  const deps = new Set();
  const re = /from\s+'\.\/([^']+)'/g;
  let m;
  while ((m = re.exec(src)) !== null) deps.add(m[1]);
  for (const dep of deps) {
    const from = path.join(ROOT, 'config', dep);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dir, dep));
  }
  const file = path.join(dir, outName);
  fs.writeFileSync(file, src, 'utf8');
  return 'file://' + file;
}

/** 真源码**文本**破坏（同 brokenCopy 的锚点纪律，用于「抽真函数体」类判据：不必落盘成模块）。 */
function brokenSource(rel, pairs) {
  let src = read(rel);
  for (const [from, to] of pairs) {
    const n = src.split(from).length - 1;
    assert.equal(n, 1, '负控制锚点必须恰中一次：' + JSON.stringify(String(from).slice(0, 70)));
    src = src.replace(from, to);
  }
  return src;
}
/**
 * 从源码文本里抽出 `_deviceFaceSnapshot()` 的**真函数体**（不是复制品）——
 *   ★ 破坏源码即转红：这正是「接线判据」该有的样子（复制品永远绿的假判据本仓治过多次）。
 *   返回 `(fakeWindow) => 快照` 的工厂。
 */
function snapshotFnOf(srcText) {
  const marker = '    _deviceFaceSnapshot() {';
  const at = srcText.indexOf(marker);
  assert.ok(at > 0, '设置页里找不到读数快照方法：' + marker);
  const open = srcText.indexOf('{', at);
  let depth = 0;
  let end = -1;
  for (let i = open; i < srcText.length; i += 1) {
    if (srcText[i] === '{') depth += 1;
    else if (srcText[i] === '}') { depth -= 1; if (depth === 0) { end = i + 1; break; } }
  }
  assert.ok(end > 0, '读数快照方法体没配平（抽取失败）');
  const make = new Function(
    'window', 'DEVICE_FACE_DOMAINS', 'DEVICE_DOMAIN_META', 'DEVICE_FEED_REASONS', 'SIGNAL_BARS_MAX',
    'deviceFaceOf', 'deviceLineOf',
    'function _snap() ' + srcText.slice(open, end) + '\nreturn _snap;'
  );
  return (fakeWindow) => make(
    fakeWindow, DEVICE_FACE_DOMAINS, DEVICE_DOMAIN_META, DEVICE_FEED_REASONS, SIGNAL_BARS_MAX,
    deviceFaceOf, deviceLineOf
  )();
}

/**
 * **同款真判据**（纯谓词）：接收任意一版桥接层模块，返回「这一版行为正确」。
 * 负控制必须「同一份判据在原版上真、在破坏副本上假」——
 *   只断言「破坏后应等于正确值」是把判据写成了**对破坏结果的期待**，
 *   破坏没发生时反而会绿（X5 首跑踩到的形态）。
 */
const faceCriterion = {
  /* 读不到 ⇒ 一律不带数（level 为 null），绝不沿用旧值。 */
  neverStale(B) {
    const f = B.batteryFaceOf({ ok: false, why: 'no_subsystems' });
    return f.state === 'missing' && f.level === null && f.line.includes('不是「没电」');
  },
  /* 无服务与读不到必须分两句（把后者说成前者 = 把「系统坏了」粉饰成「你在地下室」）。 */
  noServiceSpoken(B) {
    const a = B.signalFaceOf({ ok: true, why: '', signal: { bars: 0, networkType: 'NO_SERVICE' } });
    const b = B.signalFaceOf({ ok: false, why: 'no_subsystems' });
    return a.bars === 0 && a.state === 'weak' && b.state === 'missing' && a.line !== b.line;
  },
  /* 读不到那一档的**文案本身**必须点明「不是无服务」——
   *   只断言「两句不同」是不够的：把「读取失败」与「数据缺失」也合并成同一句时，
   *   两句仍然不同，但用户已经分不清「没信号」与「系统坏了」了。 */
  unknownNotBlamedOnSignal(B) {
    const b = B.signalFaceOf({ ok: false, why: 'no_subsystems' });
    return b.state === 'missing' && b.line.includes('数据缺失') && b.line.includes('不是「无服务」');
  },
  /* 曲线按时间升序且够 10 点才算 ok。 */
  seriesSorted(B) {
    const log = [];
    for (const t of [5000, 1000, 3000, 9000, 7000, 2000, 8000, 6000, 4000, 10000, 11000, 12000]) log.push({ t, hr: 70 });
    const f = B.bandSeriesOf({ ok: true, why: '', band: { historyLog: log } });
    if (!(f.count === 12 && f.enough === true && f.state === 'ok')) return false;
    for (let i = 1; i < f.points.length; i++) if (f.points[i].t < f.points[i - 1].t) return false;
    return f.spanMs === 11000;
  }
};

for (const [name, pairs, crit] of [
  ['G1 读不到时沿用旧值（level 不再为 null）',
    [['            level: null,\n            charging: false,\n            throttling: false,\n            stale: false,',
      '            level: 78,\n            charging: false,\n            throttling: false,\n            stale: true,']],
    'neverStale'],
  ['G2 读不到被说成「无服务」（把系统坏了粉饰成你在地下室）',
    [["            line: threw ? '信号：读取失败（不是「无服务」）' : '信号：数据缺失（不是「无服务」）'",
      "            line: '信号：无服务'"]],
    'unknownNotBlamedOnSignal'],
  ['G3 曲线不再按时间排（照抄数组顺序）',
    [["    points.sort((a, c) => (a.t === null ? -1 : a.t) - (c.t === null ? -1 : c.t));",
      '    /* broken: 不再按时间排 */']],
    'seriesSorted'],
]) {
  test('负控制 · ' + name, async () => {
    /* ① 同款判据在**原版**上必须为真（否则「副本上假」可能是判据本身假）。 */
    const B0 = await import('../config/device-face-bridge.js');
    assert.equal(faceCriterion[crit](B0), true, '同款判据在原版上必须为真');
    /* ② 同款判据在**破坏副本**上必须为假。 */
    const B = await import(brokenCopy(BRIDGE_REL, pairs, 'device-face-bridge.broken.js'));
    assert.equal(faceCriterion[crit](B), false, '破坏后同款判据必须转红');
  });
}

test('G4 负控制 · 手环采样不再落盘 ⇒ 重载后曲线消失（真源码破坏 + 真判据）', async () => {
  const storage = memStorage();
  const band = new SmartBandBiometrics({ storage });
  const criterion = (Cls) => {
    const s = memStorage();
    const b = new Cls({ storage: s });
    b.sample(1000);
    const again = new Cls({ storage: s });
    return again.historyLog.length === 1;
  };
  assert.equal(criterion(SmartBandBiometrics), true, '同款判据在原版上必须为真');
  const url = brokenCopy(BAND_REL, [['                historyLog: this.historyLog.slice(-BAND_HISTORY_MAX),', '                /* broken: 曲线不再随盘走 */']], 'smart-band-biometrics.broken.js');
  const M = await import(url);
  assert.equal(criterion(M.SmartBandBiometrics), false, '破坏后同款判据必须转红');
});

test('G5 负控制自证：锚点不存在 / 不唯一时必须抛（防止假绿）', () => {
  assert.throws(() => brokenCopy(BRIDGE_REL, [['这段代码在桥接层里根本不存在', 'x']], 'x.js'), /恰中一次/);
});

/* 设置页读数面的同款判据（纯谓词）：**两向断言** —— 原版上真、破坏副本上假。 */
const settingsCriterion = {
  whyDistinguishesThrew(S) {
    const off = S({});
    const dead = S({ VirtualPhone: { deviceFace: () => { throw new Error('host dead'); } } });
    const a = off.rows[0].whyLine;
    const b = dead.rows[0].whyLine;
    return a.includes('未装配') && b.includes('抛错') && a !== b;
  }
};
test('G6 负控制 · 归因句把「抛错」与「未装配」合并（读不到就一句「没读数」糊过去）', () => {
  /* ① 同款判据在原版上必须为真。 */
  assert.equal(settingsCriterion.whyDistinguishesThrew(snapshotFnOf(read(SETTINGS_REL))), true,
    '同款判据在原版上必须为真');
  /* ② 真源码破坏：三档归因合并成一句 ⇒ 同款判据必须为假。 */
  const broken = brokenSource(SETTINGS_REL, [[
    "                return readWhy === 'read_threw'\n" +
    "                    ? '读数口抛错（不是「没电 / 无服务」）'\n" +
    "                    : '读数口未装配（不是「没电 / 无服务」）';",
    "                return '读数口没读数（不是「没电 / 无服务」）';"
  ]]);
  assert.equal(settingsCriterion.whyDistinguishesThrew(snapshotFnOf(broken)), false,
    '破坏后同款判据必须转红');
});
