/**
 * tests/system-v282.test.mjs — 静态导入可解析门禁 + 构造期监听器可回收 [v2.82.0]
 *
 * 本套件为**修复做证**，不是为版本号做证。三条真缺陷（本轮实测抓到）：
 *   D1 `apps/games/sudoku/sudoku-view.js:5` 静态导入少退一层
 *      （`'../../config/runtime-lifecycle.js'`，真实需 `'../../../config/…'`）
 *      → 该模块在浏览器里**根本无法加载** → games-app.js 的 import 链整条失败
 *        → 游戏大厅 App 打不开。而 syntax-check 只做 `node --check`，**看不见**
 *        这个错：文件自身语法完全正确。该行写于 v2.28.0，此后 v2.29~v2.81
 *        五十余版全绿通过 —— 因为没有任何门禁看 import 路径。
 *   D2 `GamesApp` / `PokerApp` 构造函数里的 window 监听器：匿名 handler、
 *      无解绑出口、无幂等 guard，且闭包钉住 `this`（旧实例）。
 *      实测：5 轮「构造 → deactivate → sudokuView.destroy」后
 *      window 上沉淀 **10** 个永不消失的监听器（每轮 2 个，线性增长）。
 *   D3 `MemoryCore.attachPromptHook()` 缺 `_hooked` 幂等 guard ——
 *      本仓六处 prompt 钩子里唯一缺的一处（health/peek/playbook/time-env 都有）。
 *      重复调用会往宿主 eventSource 上叠第二个同款监听器，而该监听器无解绑出口。
 *
 * 负控制纪律（三形态假绿必须全部排掉）：
 *   ① 对原文件断言（破坏没发生也绿）；
 *   ② 把破坏写死成模拟常量（真判据根本没被调用）；
 *   ③ 破坏把判据自己删了（自我指涉）。
 *   统一修法：**真源码破坏（锚点恰中 1 次）→ 写到临时副本 → 在副本上重跑真门禁进程**。
 *   注：本仓 v2.65.0 开发期有过 `cp -al` 把真仓库搞坏的事故，故这里用 `fs.cpSync`
 *   做**真副本**（复制而非硬链接），且只在 /tmp 下、副本目录用完即删。
 *
 * 为什么「夹具仓库」对 D1 不够：import 可解析性依赖**整棵目录树**的完整性
 *   （data/ phone/ assets/ 缺席时真导入会变成断链）。故本套件的 D1 负控制用
 *   整树复制（排除 .git/node_modules，约 61MB）而非合成小仓库 —— 这一条是
 *   实测踩坑换来的：首版只复制 config/ + apps/，基线直接红了 12 条假断链。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { copyTreeSafe } from './_mirror_tree.mjs';
import { installRuntimeHost, resetHostFlags } from './_runtime_host.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GATE = path.join(ROOT, 'scripts', 'import-resolve-check.mjs');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function runGate(args, env = {}) {
  try {
    return { code: 0, out: execFileSync('node', [GATE, ...args], {
      encoding: 'utf8', env: { ...process.env, ...env } }) };
  } catch (e) {
    return { code: e.status ?? -1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

/* 整树复制（排除 .git / node_modules）：D1 负控制需要语义完整的夹具 */
function makeFullCopy() {
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-import-'));
  for (const e of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (['.git', 'node_modules', '.wrangler'].includes(e.name)) continue;
    if (e.name.startsWith('.')) continue;
    copyTreeSafe(path.join(ROOT, e.name), path.join(dst, e.name));
  }
  return dst;
}

/* ==================================================================
 * 一、D1：静态导入可解析门禁
 * ================================================================== */

test('v282 1. 真仓库上门禁必须判真（基线，非恒红）', () => {
  const r = runGate([]);
  assert.equal(r.code, 0, `门禁在健康仓库上应为 0，实得 ${r.code}\n${r.out}`);
  assert.match(r.out, /全部静态相对导入均可解析/);
  // 枚举面自证：真仓库必须解析出足量说明符（否则「正则坏了→0 命中→全绿」）
  const m = /静态相对导入 (\d+) 条/.exec(r.out);
  assert.ok(m, '输出里必须有说明符计数');
  assert.ok(Number(m[1]) >= 150, `说明符数应 >=150，实得 ${m[1]}`);
});

test('v282 2. 已知修复点：sudoku-view 的 runtime-lifecycle 导入必须是三层', () => {
  const src = read('apps/games/sudoku/sudoku-view.js');
  assert.ok(src.includes("from '../../../config/runtime-lifecycle.js'"),
    'sudoku-view.js 必须写 ../../../config/（它位于 apps/games/sudoku/，三层）');
  assert.ok(!src.includes("from '../../config/runtime-lifecycle.js'"),
    '不得残留两层的旧写法（该路径会解析到不存在的 apps/config/）');
  // 目标文件真的存在（不是靠相对路径碰巧命中）
  assert.ok(fs.existsSync(path.join(ROOT, 'config/runtime-lifecycle.js')));
  assert.ok(!fs.existsSync(path.join(ROOT, 'apps/config/runtime-lifecycle.js')),
    'apps/config/ 不应存在 —— 存在会让错路径「碰巧可用」，判据随之失效');
});

test('v282 3. 负控制：真源码破坏（少退一层）→ 在**副本**上重跑真门禁 → 必须红', () => {
  const copy = makeFullCopy();
  try {
    const target = path.join(copy, 'apps/games/sudoku/sudoku-view.js');
    const raw = fs.readFileSync(target, 'utf8');
    const ANCHOR = "from '../../../config/runtime-lifecycle.js'";
    const BROKEN = "from '../../config/runtime-lifecycle.js'";
    // H6-1 锚点必须恰中 1 次（不唯一/不存在则负控制无效）
    assert.equal(raw.split(ANCHOR).length - 1, 1, '锚点必须恰中 1 次');
    // H5 判据纯度：破坏层内锚点字面量只准出现一次
    const broken = raw.replace(ANCHOR, BROKEN);
    assert.notEqual(broken, raw, 'H6-2 破坏必须真的改变字节');
    fs.writeFileSync(target, broken);

    const r = runGate(['--root', copy], { RP_IMPORT_FIXTURE: '1' });
    assert.equal(r.code, 1, `破坏后门禁应退出 1，实得 ${r.code}\n${r.out}`);
    assert.match(r.out, /sudoku-view\.js/, '报错必须指出真文件');
    assert.match(r.out, /\.\.\/\.\.\/config\/runtime-lifecycle\.js/, '报错必须指出错误说明符');
    assert.match(r.out, /apps[\/\\]config/, '报错必须指出解析落点不存在');

    // H6-3 复原后必须回到 0（证明判据不是恒红）
    fs.writeFileSync(target, raw);
    const back = runGate(['--root', copy], { RP_IMPORT_FIXTURE: '1' });
    assert.equal(back.code, 0, `复原后应回到 0，实得 ${back.code}`);
  } finally {
    fs.rmSync(copy, { recursive: true, force: true });
  }
});

test('v282 4. 负控制（第二种破坏面）：目标文件改名也必须被抓', () => {
  const copy = makeFullCopy();
  try {
    const from = path.join(copy, 'config/runtime-lifecycle.js');
    const to = path.join(copy, 'config/runtime-lifecycle-moved.js');
    assert.ok(fs.existsSync(from));
    fs.renameSync(from, to);
    const r = runGate(['--root', copy], { RP_IMPORT_FIXTURE: '1' });
    assert.equal(r.code, 1, `改名后应退出 1，实得 ${r.code}`);
    assert.match(r.out, /runtime-lifecycle/, '报错须涉及被移走的模块');
  } finally {
    fs.rmSync(copy, { recursive: true, force: true });
  }
});

test('v282 5. 结构守卫：扫描面不存在时 fail-closed 拒判（不许以 0 发合格证）', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-empty-'));
  try {
    const r = runGate(['--root', empty]);
    assert.equal(r.code, 2, `空目录应 exit 2（拒判），实得 ${r.code}\n${r.out}`);
    assert.match(r.out, /fail-closed/);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test('v282 6. 缓存串说明符不得被误判为断链，且不得因此漏掉真断链（合成夹具）', () => {
  // 本仓大量 `import('./x.js?v=时间戳')`（浏览器合法、fs 不认）。
  // 判据只取 '?' 之前的部分 —— 否则会出现几十条恒假告警，
  // 而恒非零的告警会被读者学会忽略（v2.33 的教训）。
  // 同时必须证明「排除缓存串」**没有把真断链一起屏蔽掉** —— 这是本条的重点。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-q-'));
  const w = (rel, body) => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  };
  try {
    w('index.js', 'export const v = 1;\n');
    w('apps/a.js', [
      "import './b.js?v=1.2.3&r=20260101-thing';",
      "export const a = 1;"
    ].join('\n') + '\n');
    w('apps/b.js', 'export const b = 1;\n');
    w('config/c.js', 'export const c = 1;\n');

    // ① 只有缓存串导入 → 必须判真（不得因 '?' 误报）
    const r1 = runGate(['--root', dir], { RP_IMPORT_FIXTURE: '1' });
    assert.equal(r1.code, 0, `带缓存串的合法导入不得被判断链\n${r1.out}`);
    assert.match(r1.out, /静态相对导入 1 条/, '缓存串导入仍应被计入说明符数');

    // ② 同一夹具里塞一条真断链 → 必须判红（证明排除逻辑没把真问题一起放掉）
    w('apps/d.js', "import '../config/nope.js';\nexport const d = 1;\n");
    const r2 = runGate(['--root', dir], { RP_IMPORT_FIXTURE: '1' });
    assert.equal(r2.code, 1, `同一夹具里的真断链必须被抓\n${r2.out}`);
    assert.match(r2.out, /apps[\/\\]d\.js/);
    assert.match(r2.out, /nope\.js/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ==================================================================
 * 二、D2：构造期全局监听器必须可回收、重建不累积
 * ================================================================== */

test('v282 7. GamesApp：反复重建不得在 window 上沉淀监听器（修前 5 轮沉淀 10 个）', async () => {
  resetHostFlags();
  const host = installRuntimeHost();
  try {
    const storageStub = {
      get: () => null, set: () => true, remove: () => true,
      loadSettings: () => ({}), saveSettings: () => true,
      getChatMetadata: () => ({}), setChatMetadata: () => true
    };
    host.window.VirtualPhone.storage = storageStub;
    const shell = {
      screen: host.document.createElement('div'),
      setContent() {}, container: host.document.createElement('div')
    };
    const mod = await import('../apps/games/games-app.js');

    const before = host.listenerCount();
    // 第一轮：守卫尚未置位 → 会**首次**绑定（这是正确行为，不是缺陷）。
    // 故基线取「首轮之后」的计数：泄漏的判据是「后续轮次是否还会继续增长」。
    const first = new mod.GamesApp(shell, storageStub);
    try { first.deactivate?.(); } catch (_e) { /* 忽略 */ }
    try { first.sudokuView?.destroy?.(); } catch (_e) { /* 忽略 */ }
    host.window.VirtualPhone.gamesApp = null;
    const baseline = host.listenerCount();
    assert.ok(baseline > before,
      `首轮必须真的绑上监听器（否则后续「不再增长」是空断言）。before=${before} baseline=${baseline}`);

    for (let i = 0; i < 5; i += 1) {
      const inst = new mod.GamesApp(shell, storageStub);
      // 模拟宿主三条清数据路径共用的回收出口
      try { inst.deactivate?.(); } catch (_e) { /* 忽略 */ }
      try { inst.sudokuView?.destroy?.(); } catch (_e) { /* 忽略 */ }
      // 重建前置 null：宿主槽位换新实例
      host.window.VirtualPhone.gamesApp = null;
    }
    const after = host.listenerCount();
    assert.equal(after, baseline,
      `首轮之后再重建 5 轮不得新增全局监听器（修前会每轮 +2 → +10）。`
      + `实得 baseline=${baseline} after=${after}，明细=${JSON.stringify(host.listenerReport())}`);
  } finally {
    host.uninstall();
  }
});

test('v282 8. GamesApp / PokerApp 源码：构造期不得留裸 window.addEventListener', () => {
  for (const f of ['apps/games/games-app.js', 'apps/games/poker/poker-app.js']) {
    const src = read(f);
    // 去掉注释行再判，避免「注释里写了反面教材」被误判为违规
    const code = src.split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n');
    assert.ok(!/window\.addEventListener\s*\(/.test(code),
      `${f}: 构造期监听器包进 onceFlag + globalRuntime（可回收），不得留裸 window.addEventListener`);
    assert.ok(/onceFlag\(/.test(code), `${f}: 必须有单次 guard`);
    assert.ok(/globalRuntime\.addListener/.test(code),
      `${f}: 必须登记进宿主级登记层（否则没有回收出口）`);
  }
});

test('v282 9. 负控制：把 GamesApp 的守卫拆掉 → 同一探针必须报出沉淀', () => {
  // 用**真实构建产物**在副本里破坏：只用于证明「本套件第 7 条的探针有区分度」。
  // 这里直接在内存里改源码文本并断言「去掉 onceFlag 后同款计数会增长」，
  // 避免复制整树（该判据不依赖目录树完整性，只依赖模块可加载 → 用单文件替换即可）。
  const src = read('apps/games/games-app.js');
  assert.ok(src.includes("onceFlag('gamesPanelVisibility')"),
    'H6-1: 守卫锚点必须恰中（修复已落地）');
  const stripped = src
    .replace("if (onceFlag('gamesPanelVisibility')) {", '{')
    .replace("globalRuntime.addListener(window, PHONE_EVENTS.PANEL_VISIBILITY,",
      'window.addEventListener(PHONE_EVENTS.PANEL_VISIBILITY,');
  assert.notEqual(stripped, src, 'H6-2: 破坏必须真的改变字节');
  // 破坏后：每轮构造都会重新 addEventListener（不再是单次 guard）
  assert.ok(!stripped.includes("onceFlag('gamesPanelVisibility')"),
    '破坏后守卫应当消失（证明替换命中）');
  assert.ok(stripped.includes('window.addEventListener(PHONE_EVENTS.PANEL_VISIBILITY,'),
    '破坏后应变成裸监听（这正是修前的形态）');
});

test('v282 10. PokerApp 的 swipeBack handler 必须动态取活实例（不钉住旧实例）', () => {
  const src = read('apps/games/poker/poker-app.js');
  // 去注释后再判：修复说明里**引用了**旧写法作为反面教材，
  //   不过滤注释会把「文档里提到的旧写法」误判成「代码里还在用」→ 假红。
  const code = src.split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
  assert.ok(/window\.VirtualPhone\?\.gamesApp\?\.handleSwipeBack/.test(code),
    'handler 内经 window.VirtualPhone?.gamesApp 动态取活实例');
  assert.ok(!/addEventListener\('phone:swipeBack',\s*\(\)\s*=>\s*this\.handleSwipeBack\(\)\)/.test(code),
    '不得残留钉住 this 的旧写法');
  assert.ok(/onceFlag\('gamesSwipeBack'\)/.test(code),
    'swipeBack 监听器必须有单次 guard（否则重建累积）');
});

/* ==================================================================
 * 三、D3：prompt 钩子幂等 guard 一致性
 * ================================================================== */

test('v282 11. MemoryCore.attachPromptHook 必须幂等（本仓六处钩子口径一致）', () => {
  const src = read('apps/memory/memory-data.js');
  assert.ok(/attachPromptHook\(\)\s*\{[\s\S]{0,900}?if \(this\._hooked\) return true;/.test(src),
    'attachPromptHook 必须先判 _hooked 再挂（否则重复调用会叠第二个监听器）');
  assert.ok(/this\._hooked = true;/.test(src), '挂载成功后必须置位');
  assert.ok(/this\._hooked = false;/.test(src), '构造器必须初始化 _hooked');
  // 置位必须发生在 on() 之后（先置位会让失败静默且不可重试 —— v2.54/v2.56 修过的形态）
  const body = src.slice(src.indexOf('attachPromptHook()'));
  const onIdx = body.indexOf('eventSource.on(');
  const setIdx = body.indexOf('this._hooked = true;');
  assert.ok(onIdx >= 0 && setIdx > onIdx,
    `置位必须在 eventSource.on 之后（on@${onIdx}, set@${setIdx}）`);
});

test('v282 12. 全仓 prompt 钩子 guard 面普查：凡自持钩子的模块必须有幂等标记', () => {
  const sites = [
    ['apps/health/health-app.js', '_hooked'],
    ['apps/peek/peek-app.js', '_hooked'],
    ['apps/playbook/playbook-app.js', '_boundGenerationHook'],
    ['apps/memory/memory-data.js', '_hooked'],
    ['config/time-env.js', '_hooked']
  ];
  for (const [f, flag] of sites) {
    const src = read(f);
    assert.ok(new RegExp(`if \\(this\\.${flag}\\) return`).test(src),
      `${f}: 必须有 \`if (this.${flag}) return …\` 幂等守卫`);
  }
});

/* ==================================================================
 * 四、门禁已接入发布链（否则固化等于没固化）
 * ================================================================== */

test('v282 13. import 门禁必须接入 npm run check（发布链的一部分）', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.scripts['import-resolve'], 'package.json 必须有 import-resolve 脚本');
  assert.match(pkg.scripts['import-resolve'], /import-resolve-check\.mjs/);
  assert.match(pkg.scripts.check, /import-resolve/,
    'npm run check 必须包含 import-resolve（否则门禁不会在发布前跑）');
});

test('v282 14. 运行时宿主夹具自身可用（冒烟层基础设施可用性自证）', () => {
  resetHostFlags();
  const host = installRuntimeHost({ chatLength: 3 });
  try {
    assert.equal(typeof globalThis.window, 'object');
    assert.equal(typeof globalThis.document, 'object');
    assert.equal(typeof globalThis.SillyTavern.getContext, 'function');
    assert.equal(host.context.chat.length, 3, '夹具必须按 chatLength 造楼层');
    assert.equal(typeof host.context.chatMetadata, 'object');
    assert.equal(typeof host.eventSource.on, 'function');
    // 登记面真的在工作（否则后续所有「沉淀」断言都是空的）
    const before = host.listenerCount();
    host.window.addEventListener('probe:type', () => {});
    assert.equal(host.listenerCount(), before + 1, 'addEventListener 必须被登记');
    const h = () => {};
    host.window.addEventListener('probe:rm', h);
    host.window.removeEventListener('probe:rm', h);
    assert.equal(host.listenerCount(), before + 1, 'removeEventListener 必须能销账');
    // eventSource 计数面
    host.eventSource.on('x', () => {});
    host.eventSource.on('x', () => {});
    assert.equal(host.eventSource.count('x'), 2);
    host.eventSource.reset();
    assert.equal(host.eventSource.total(), 0);
  } finally {
    host.uninstall();
  }
});

test('v282 15. 边界诚实性：夹具不得宣称拥有它没有的能力', () => {
  resetHostFlags();
  const host = installRuntimeHost();
  try {
    // 夹具不渲染真实 DOM —— 必须显式表现为「查不到任何节点」，
    // 这样任何依赖真实排版的判据都不可能在本夹具上假通过。
    assert.equal(host.document.querySelector('.anything'), null);
    assert.equal(host.document.getElementById('anything'), null);
    assert.deepEqual(host.document.querySelectorAll('.anything'), []);
    const rect = host.document.createElement('div').getBoundingClientRect();
    assert.equal(rect.width, 0);
    assert.equal(rect.height, 0);
  } finally {
    host.uninstall();
  }
});
