/**
 * system-v265.test.mjs — 生命周期接线门禁（scripts/lifecycle-audit.mjs）自证
 *
 * 背景：v2.63.0 / v2.64.0 两轮各修了一类会话生命周期缺陷（方法出口漏接线、槽位只覆盖一条路径），
 *   但**能力本身没留在仓里**——两个探针都在 /tmp 下。本套件为固化后的门禁做正/负控制。
 *
 * 为什么用**夹具仓库**（合成小仓库）而不是复制真仓库做负控制：
 *   ① 真仓库 apps/ 约 46MB，一例一次复制会让测试套件慢到不可接受；
 *   ② **实测事故（本仓 v2.65.0 开发期）**：曾用 `cp -al <真仓库>` 建硬链接副本，
 *      在本环境该操作把 425 个已跟踪文件变成了指向临时 l2s 收容所名字的**悬空符号链接**
 *      （工作区因此被破坏，靠 `git checkout -- .` 才恢复）。
 *      结论：负控制**绝不再触碰真仓库文件树**。
 *   夹具通道与 `scripts/dead-export-check.mjs` 的 `RP_DEAD_EXPORT_FIXTURE` 同款：
 *   环境变量 `RP_LIFECYCLE_FIXTURE=1` 只放宽「最低计数」闸，**不放宽任何结构锚点**。
 *
 * 负控制纪律（三形态假绿必须全部排掉）：
 *   ① 「对原文件断言」→ 破坏没发生也绿；② 把破坏写死成模拟常量 → 真判据没被调用；
 *   ③ 破坏把判据自己删了 → 自我指涉。
 *   统一修法：**真源码破坏（锚点恰中 1 次）→ 在夹具副本上重跑真门禁进程**。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUDIT = path.join(ROOT, 'scripts', 'lifecycle-audit.mjs');
const IDX_REL = 'index.js';

/* ---------- 夹具仓库：一个最小但结构完整的 index.js ---------- */
const FIXTURE_INDEX = `const ST_PHONE_REBIND_APP_KEYS = [
    'alphaApp',
    'deltaApp'
];
function rebindLazyApps() {
    const phone = window.VirtualPhone || {};
    ST_PHONE_REBIND_APP_KEYS.forEach((key) => {
        try { phone[key]?.onChatChanged?.(); } catch (e) { /* 忽略 */ }
    });
}
function onChatChanged() {
    rebindLazyApps();
    window.VirtualPhone.betaApp.clearCache();
}
function getContext() { return null; }
function releasePhoneInactiveResources(activeAppId = null) {
    const phone = window.VirtualPhone || {};
    const appEntries = [
        ['gamma', phone.gammaApp]
    ];
    appEntries.forEach(([appId, appInstance]) => {
        if (appId === activeAppId) return;
        appInstance?.deactivate?.();
    });
}
function retireSessionScopedSlots() {
    const phone = window.VirtualPhone;
    if (phone.betaApp) {
        try { phone.betaApp.deactivate?.(); } catch (e) { /* 忽略 */ }
        phone.betaApp = null;
    }
}
window.addEventListener('phone:clearCurrentData', () => {
    rebindLazyApps();
    window.VirtualPhone.alphaApp?.destroy?.();
});
window.addEventListener('phone:clearAllData', () => {
    rebindLazyApps();
    window.VirtualPhone.alphaApp?.destroy?.();
});
window.VirtualPhone.alphaApp = new module.AlphaApp(a, b);
window.VirtualPhone.betaApp = new module.BetaApp(a, b);
window.VirtualPhone.gammaApp = new module.GammaApp(a, b);
const lazyRoute = APP_LAZY_ROUTE_INDEX.get(appId);
window.VirtualPhone[lazyRoute.key] = new module[lazyRoute.cls](a, b);
`;

/* 表驱动装配面（v3.91.0 补）：真仓库 v3.61.0 起 67 个 App 是这么挂的 ——
 *   槽位名在 index.js 里是**变量**（`VirtualPhone[lazyRoute.key]`），字面反查必然落空。
 *   夹具必须携带这一面，否则它比被测契约**弱**（判据要认两面，夹具只给一面），
 *   新负控制也就无从复现「表驱动 App 漏进 REBIND 表」这个真实形态。 */
const FIXTURE_LAZY = `export const APP_LAZY_ROUTES = [
  { id: "delta", module: "./apps/delta/delta-app.js", key: "deltaApp", cls: "DeltaApp", errTitle: "DeltaApp" },
];
`;

const FIXTURE_APPS = {
  alpha: 'export class AlphaApp {\n    constructor(a, b) {}\n    onChatChanged() {}\n}\n',
  beta: 'export class BetaApp {\n    constructor(a, b) {}\n    onChatChanged() {}\n    clearCache() {}\n}\n',
  gamma: 'export class GammaApp {\n    constructor(a, b) {}\n    deactivate() {}\n}\n',
  delta: 'export class DeltaApp {\n    constructor(a, b) {}\n    onChatChanged() {}\n}\n'
};

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-lc-fx-'));
  fs.writeFileSync(path.join(dir, IDX_REL), FIXTURE_INDEX);
  const cfg = path.join(dir, 'config');
  fs.mkdirSync(cfg);
  fs.writeFileSync(path.join(cfg, 'app-lazy-routes.js'), FIXTURE_LAZY);
  const apps = path.join(dir, 'apps');
  fs.mkdirSync(apps);
  for (const [name, src] of Object.entries(FIXTURE_APPS)) {
    fs.mkdirSync(path.join(apps, name));
    fs.writeFileSync(path.join(apps, name, `${name}-app.js`), src);
  }
  return dir;
}

/** 跑**真门禁**（真脚本进程），夹具模式放宽最低计数闸 */
function runAudit(target) {
  const env = { ...process.env, RP_LIFECYCLE_FIXTURE: '1' };
  try {
    const stdout = execFileSync(process.execPath, [AUDIT, '--root', target],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}

/** 真源码破坏：锚点必须恰中 1 次（防「破坏没发生也绿」） */
function breakOnce(file, anchor, replacement) {
  const s = fs.readFileSync(file, 'utf8');
  const n = s.split(anchor).length - 1;
  assert.equal(n, 1, `破坏锚点须恰中 1 次（实际 ${n} 次）：${JSON.stringify(anchor.slice(0, 60))}`);
  fs.writeFileSync(file, s.replace(anchor, replacement));
}

function withFixture(fn) {
  const dir = makeFixture();
  try { fn(dir, path.join(dir, IDX_REL)); } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
  }
}

// ══════════════ 正控制 ══════════════
test('v265-P1 门禁在真仓库上通过（exit 0，且白名单注明「源码派生」）', () => {
  const r = execFileSync(process.execPath, [AUDIT, '--root', ROOT],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.match(r, /扫描 \d+ 个含生命周期出口的 App 类 \/ \d+ 个实例槽位/);
  assert.match(r, /泛化调用清单 \d+ 项（源码派生）/);
  assert.match(r, /咽喉点清单 \d+ 项（源码派生）/);
  assert.match(r, /✓ /);
});

test('v265-P2 夹具仓库本身通过（负控制的基线必须是绿的）', () => {
  withFixture((dir) => {
    const r = runAudit(dir);
    assert.equal(r.code, 0, '夹具未通过，后续负控制无意义：' + r.out);
    assert.match(r.out, /扫描 4 个含生命周期出口的 App 类 \/ 3 个实例槽位/);
  });
});

// ══════════════ 负控制 ══════════════
test('v265-N1 L1 有效：REBIND 表移除唯一 key → 该 App 被判「无接线路径」并 exit 1', () => {
  withFixture((dir, idxFile) => {
    breakOnce(idxFile, "    'alphaApp',\n", '');
    const r = runAudit(dir);
    assert.equal(r.code, 1, 'L1 未报警：' + r.out);
    assert.match(r.out, /AlphaApp/, '未点名 AlphaApp');
    assert.match(r.out, /L1/);
  });
});

test('v265-N2 L2 有效：删掉咽喉点对某槽位的回收 → 该槽位被判「只覆盖一条路径」并 exit 1', () => {
  withFixture((dir, idxFile) => {
    breakOnce(idxFile,
      '    if (phone.betaApp) {\n'
      + '        try { phone.betaApp.deactivate?.(); } catch (e) { /* 忽略 */ }\n'
      + '        phone.betaApp = null;\n'
      + '    }\n',
      '');
    const r = runAudit(dir);
    assert.equal(r.code, 1, 'L2 未报警：' + r.out);
    assert.match(r.out, /betaApp/, '未点名 betaApp');
    assert.match(r.out, /L2/);
  });
});

test('v265-N3 白名单前提守卫：泛化调用的泛化模式被破坏 → fail-closed exit 2（拒判而非放行）', () => {
  withFixture((dir, idxFile) => {
    breakOnce(idxFile, 'appInstance?.deactivate?.();', '/* 破坏：泛化调用被摘除 */');
    const r = runAudit(dir);
    assert.equal(r.code, 2, '白名单前提消失却仍出判定（应 fail-closed）：' + r.out);
    assert.match(r.out, /fail-closed/);
  });
});

test('v265-N4 白名单前提守卫：咽喉点函数被改名 → fail-closed exit 2', () => {
  withFixture((dir, idxFile) => {
    breakOnce(idxFile, 'function retireSessionScopedSlots() {', 'function retireSessionScopedSlotsX() {');
    const r = runAudit(dir);
    assert.equal(r.code, 2, '咽喉点清单无法派生却仍出判定：' + r.out);
    assert.match(r.out, /fail-closed/);
  });
});

test('v265-N5 三路径锚点守卫：换会话函数被改名 → fail-closed exit 2（夹具模式也不放宽锚点）', () => {
  withFixture((dir, idxFile) => {
    breakOnce(idxFile, 'function onChatChanged() {', 'function onChatChangedX() {');
    const r = runAudit(dir);
    assert.equal(r.code, 2, '三路径锚点缺失却仍出判定：' + r.out);
    assert.match(r.out, /锚点缺失|fail-closed/);
  });
});

test('v265-N6 表驱动面参与 L1：表驱动挂载的 App 未进 REBIND 表 → exit 1 并点名', () => {
  /* 本次（v3.91.0）修复的根因形态：v3.61.0 表驱动装配后，槽位名在 index.js 里是变量
   *   （`VirtualPhone[lazyRoute.key]`），L1 的字面反查必然落空 ⇒ 该 App 静默逃出判据。
   *   实测射程：81 个含出口的类里只有 13 个仍被扫到，68 个（含本次新建的 backupdesk）消失。
   *   本负控制复现的正是「漏登记 + 逃出射程」叠加后的静默放行：破坏前它绿，
   *   而修复后同款破坏必须红 —— 这条判据就是来把那种「全绿放行」钉死的。 */
  withFixture((dir, idxFile) => {
    breakOnce(idxFile, "    'deltaApp'\n", '');
    const r = runAudit(dir);
    assert.equal(r.code, 1, '表驱动 App 漏进 REBIND 表竟未报警（射程退化复发）：' + r.out);
    assert.match(r.out, /DeltaApp/, '未点名 DeltaApp');
    assert.match(r.out, /L1/);
  });
});

test('v265-N7 射程自证：表驱动面读不到 → fail-closed exit 2（而非退回旧射程）', () => {
  /* 为什么这条与 N3/N4 并列：表驱动面是 L1 射程的**一半**。读不到它时，
   *   正确的行为是拒判（exit 2），**不得**退回「只认字面写法」的旧射程 ——
   *   退回去正是「判据看起来在跑、其实不看 68 个 App」的成因。 */
  withFixture((dir) => {
    fs.writeFileSync(path.join(dir, 'config', 'app-lazy-routes.js'), 'export const APP_LAZY_ROUTES = [];\n');
    const r = runAudit(dir);
    assert.equal(r.code, 2, '表驱动面读不到却仍出判定（应 fail-closed）：' + r.out);
    assert.match(r.out, /fail-closed/);
    assert.match(r.out, /app-lazy-routes\.js/, '拒判消息必须点名读不到的那份表');
  });
});

// ══════════════ 判据纯度 / 接线自证 ══════════════
test('v265-S1 负控制纯度：破坏只落在夹具上，且完全不经由文件树复制', () => {
  const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
  // ① 每例负控制只做一次破坏（不叠加，失败责任可归因）。
  //    按**行首**计数，避开自我指涉：本断言里的正则字面量本身也含 `breakOnce(`，
  //    若用全文 match 计数会把断言自己算进去（实测：得 8 而非 7）。
  const defLines = src.split('\n').filter((l) => /^function breakOnce\(/.test(l)).length;
  assert.equal(defLines, 1, 'breakOnce 定义应恰 1 处');
  const callLines = src.split('\n').filter((l) => /^\s*breakOnce\(/.test(l)).length;
  assert.equal(callLines, 7, 'breakOnce 调用行应为 7（N1..N5 五例 + N6 表驱动面 + S1b 先绿后红对照）');
  // ② 每例负控制必须显式断言退出码（防「破坏发生与否都不看结论」的空断言）；
  //    N1..N5 五例各自断言一次；S1b 断的是 `broken.code`（先绿后红两步，故不在此列）。
  assert.equal((src.match(/assert\.equal\(r\.code, [12],/g) || []).length, 7, '退出码断言应为 7 处（N1..N7）');
  // ③ 绝不**调用** cp 复制真仓库文件树（本轮事故根因），也绝不写仓库原件。
  //    注意只拦「真调用」：注释里提到 `cp -al` 是在记录事故原因，不该被自己的守卫误伤
  //    （判据的输入面必须与结论面一致——这里比的是实际调用，不是字面出现）。
  assert.ok(!/execFileSync\(\s*'cp'|spawnSync\(\s*'cp'|'cp',\s*\['/.test(src),
    '出现调用 cp 复制文件树（事故根因）');
  assert.ok(!/writeFileSync\(\s*path\.join\(ROOT/.test(src), '出现对仓库原件的写操作');
  assert.match(src, /fs\.mkdtempSync\(/, '缺少夹具临时目录');
  assert.match(src, /RP_LIFECYCLE_FIXTURE/, '未启用夹具通道');
});

test('v265-S1b 破坏确实可观测：同一夹具上先绿，破坏后真判据改变结论', () => {
  withFixture((dir, idxFile) => {
    assert.equal(runAudit(dir).code, 0, '破坏前夹具应为绿');
    breakOnce(idxFile, "    'alphaApp',\n", '');
    const broken = runAudit(dir);
    assert.equal(broken.code, 1, '破坏后结论未改变（判据未被真正调用）：' + broken.out);
    assert.match(broken.out, /AlphaApp/);
  });
});

test('v265-S2 门禁已串进 npm run check（与 syntax / test / dead-exports 并列）', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['check'], /npm run lifecycle/,
    'check 未串入 lifecycle（新增门禁必须进发布门，否则形同不存在）');
  assert.match(pkg.scripts['lifecycle'] || '', /lifecycle-audit\.mjs/);
});

console.log('\nv265 done');