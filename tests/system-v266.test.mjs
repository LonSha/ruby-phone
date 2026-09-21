/**
 * system-v266.test.mjs — 注册联动门禁（scripts/registry-audit.mjs）自证
 *
 * 背景：新增 App 要动三处（`config/apps.js` 的 APPS / `index.js` 的懒加载分支 /
 *   `config/storage.js` 的会话键前缀），**没有任何一处能回答「配齐了吗」**。
 *   漏配置的后果与 v2.63.0 / v2.64.0 修的那些同属「不报错、不崩溃、只错数据」形态。
 *   本套件为 v2.66.0 新增的注册门禁做正/负控制。
 *
 * 负控制纪律（三形态假绿必须全部排掉）：
 *   ① 「对原文件断言」→ 破坏没发生也绿；② 把破坏写死成模拟常量 → 真判据没被调用；
 *   ③ 破坏把判据自己删了 → 自我指涉。
 *   统一修法：**真源码破坏（锚点恰中 1 次）→ 在夹具副本上重跑真门禁进程**。
 * 夹具（`RP_REGISTRY_FIXTURE=1`）只放宽最低计数闸，**不放宽 R1/R2 判据**。
 * 绝不复制真仓库文件树做副本（见 system-v265 记录的事故教训）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUDIT = path.join(ROOT, 'scripts', 'registry-audit.mjs');

/* ---------- 夹具仓库 ---------- */
const FIXTURE_APPS = `export const APPS = [
    {
        id: 'alpha',
        name: '甲',
        icon: '🅰'
    },
    {
        id: 'beta',
        name: '乙',
        icon: '🅱'
    }
];
`;

const FIXTURE_INDEX = `const CSS_URL = new URL('./apps/beta/beta.css?v=1', import.meta.url).href;
const openApp = (appId) => {
    if (appId === 'alpha') {
        return 'alpha';
    } else if (appId === 'beta') {
        return 'beta';
    }
};
`;

/** 夹具 storage：三条前缀，其中一条是可登记的宽匹配 */
const FIXTURE_STORAGE = `export class PhoneStorage {
    constructor() {
        this.CHAT_DATA_PATTERNS = [
            /^alpha_/,
            /^beta_/,
            /^pending[_-]contacts$/
        ];
    }
}
`;

/** 夹具样式：
 *   alpha 的 css 走**机制 A**（类前缀族 ≥5 次，且能在 phone.css 里找到同名族）；
 *   beta 的 css 走**机制 B**（phone.css 无该族，但 index.js 按文件名引用了它）。 */
const FIXTURE_PHONE_CSS = '.alpha-box{} .alpha-btn{} .alpha-head{} .alpha-list{} .alpha-foot{}\n';
const FIXTURE_ALPHA_CSS = '.alpha-box{}\n.alpha-btn{}\n.alpha-head{}\n.alpha-list{}\n.alpha-foot{}\n';
const FIXTURE_BETA_CSS = '.beta-card{}\n.beta-head{}\n';

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-reg-fx-'));
  fs.mkdirSync(path.join(dir, 'config'));
  fs.writeFileSync(path.join(dir, 'config', 'apps.js'), FIXTURE_APPS);
  fs.writeFileSync(path.join(dir, 'config', 'storage.js'), FIXTURE_STORAGE);
  fs.writeFileSync(path.join(dir, 'index.js'), FIXTURE_INDEX);
  // 样式投递面：alpha 走 phone.css 打包；beta 由 index.js 按文件名引用（机制 B）
  fs.writeFileSync(path.join(dir, 'phone.css'), FIXTURE_PHONE_CSS);
  fs.mkdirSync(path.join(dir, 'apps', 'alpha'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'apps', 'beta'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'apps', 'alpha', 'alpha.css'), FIXTURE_ALPHA_CSS);
  fs.writeFileSync(path.join(dir, 'apps', 'beta', 'beta.css'), FIXTURE_BETA_CSS);
  return dir;
}

/** 跑**真门禁**（真脚本进程），夹具模式放宽最低计数闸 */
function runAudit(target) {
  const env = { ...process.env, RP_REGISTRY_FIXTURE: '1' };
  try {
    const stdout = execFileSync(process.execPath, [AUDIT, '--root', target],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}

function breakOnce(file, anchor, replacement) {
  const s = fs.readFileSync(file, 'utf8');
  const n = s.split(anchor).length - 1;
  assert.equal(n, 1, `破坏锚点须恰中 1 次（实际 ${n} 次）：${JSON.stringify(anchor.slice(0, 60))}`);
  fs.writeFileSync(file, s.replace(anchor, replacement));
}

function withFixture(fn) {
  const dir = makeFixture();
  try { fn(dir); } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
  }
}

// ══════════════ 正控制 ══════════════
test('v266-P1 门禁在真仓库上通过（40 App ↔ 40 分支，宽匹配全登记）', () => {
  const r = execFileSync(process.execPath, [AUDIT, '--root', ROOT],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.match(r, /APPS id 40 · 懒加载分支 40 · 会话键前缀 39/);
  assert.match(r, /✓ 注册三方对账无孤儿/);
});

test('v266-P2 夹具仓库本身通过（负控制基线必须绿；宽匹配已登记）', () => {
  withFixture((dir) => {
    const r = runAudit(dir);
    assert.equal(r.code, 0, '夹具未通过：' + r.out);
    assert.match(r.out, /APPS id 2 · 懒加载分支 2/);
  });
});

// ══════════════ 负控制 ══════════════
test('v266-N1 R1 有效：删掉某个懒加载分支 → 该 App 被判「有图标却点不动」并 exit 1', () => {
  withFixture((dir) => {
    breakOnce(path.join(dir, 'index.js'),
      "    } else if (appId === 'beta') {\n        return 'beta';\n    }\n",
      '    }\n');
    const r = runAudit(dir);
    assert.equal(r.code, 1, 'R1 未报警：' + r.out);
    assert.match(r.out, /beta/, '未点名 beta');
  });
});

test('v266-N2 R1 有效（反方向）：删掉某个 APPS 条目 → 该分支被判「孤儿/改名漏改」并 exit 1', () => {
  withFixture((dir) => {
    breakOnce(path.join(dir, 'config', 'apps.js'),
      "    {\n        id: 'beta',\n        name: '乙',\n        icon: '🅱'\n    }\n",
      '');
    const r = runAudit(dir);
    assert.equal(r.code, 1, 'R1 反方向未报警：' + r.out);
    assert.match(r.out, /beta/);
  });
});

test('v266-N3 R2 有效：新增一条未登记的宽匹配前缀 → exit 1 并点名', () => {
  withFixture((dir) => {
    breakOnce(path.join(dir, 'config', 'storage.js'),
      '            /^beta_/,\n',
      "            /^beta_/,\n            /^games_(a|b)_state$/\n");
    const r = runAudit(dir);
    assert.equal(r.code, 1, 'R2 未报警：' + r.out);
    assert.match(r.out, /games_\(a\|b\)_state/, '未点名新增的宽匹配');
  });
});

test('v266-N4 结构守卫：APPS 数组锚点被破坏 → fail-closed exit 2（拒判而非放行）', () => {
  withFixture((dir) => {
    breakOnce(path.join(dir, 'config', 'apps.js'), 'export const APPS = [', 'const APPS_RENAMED = [');
    const r = runAudit(dir);
    assert.equal(r.code, 2, '锚点缺失却仍出判定：' + r.out);
    assert.match(r.out, /fail-closed/);
  });
});

test('v266-N6 R3 有效：某 App 的样式从未被投递 → exit 1 并点名', () => {
  withFixture((dir) => {
    // 让 beta 的两种投递机制同时失效：phone.css 里本就没有 beta，再删掉 index.js 的引用
    breakOnce(path.join(dir, 'index.js'), 'beta.css', 'beta-renamed.css');
    const r = runAudit(dir);
    assert.equal(r.code, 1, 'R3 未报警：' + r.out);
    assert.match(r.out, /apps\/beta\/beta\.css/, '未点名未投递的样式');
  });
});

test('v266-N5 结构守卫：会话键前缀数组被改名 → fail-closed exit 2', () => {
  withFixture((dir) => {
    breakOnce(path.join(dir, 'config', 'storage.js'), 'this.CHAT_DATA_PATTERNS = [', 'this.CHAT_PATTERNS_RENAMED = [');
    const r = runAudit(dir);
    assert.equal(r.code, 2, '前缀数组锚点缺失却仍出判定：' + r.out);
    assert.match(r.out, /fail-closed/);
  });
});

// ══════════════ 判据纯度 / 接线自证 ══════════════
test('v266-S1 负控制纯度：破坏只落在夹具上，且不经由真仓库文件树复制', () => {
  const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const defLines = src.split('\n').filter((l) => /^function breakOnce\(/.test(l)).length;
  assert.equal(defLines, 1, 'breakOnce 定义应恰 1 处');
  const callLines = src.split('\n').filter((l) => /^\s*breakOnce\(/.test(l)).length;
  assert.equal(callLines, 7, 'breakOnce 调用行应为 7（N1..N6 六例 + S1b 先绿后红对照）');
  assert.equal((src.match(/assert\.equal\(r\.code, [12],/g) || []).length, 6, '退出码断言应为 6 处');
  assert.ok(!/execFileSync\(\s*'cp'|spawnSync\(\s*'cp'|'cp',\s*\['/.test(src), '出现调用 cp 复制文件树');
  assert.ok(!/writeFileSync\(\s*path\.join\(ROOT/.test(src), '出现对仓库原件的写操作');
  assert.match(src, /fs\.mkdtempSync\(/, '缺少夹具临时目录');
  assert.match(src, /RP_REGISTRY_FIXTURE/, '未启用夹具通道');
});

test('v266-S1b 破坏确实可观测：同一夹具先绿，破坏后真判据改变结论', () => {
  withFixture((dir) => {
    assert.equal(runAudit(dir).code, 0, '破坏前夹具应为绿');
    breakOnce(path.join(dir, 'index.js'), 'appId === \'alpha\'', 'appId === \'alphaX\'');
    const broken = runAudit(dir);
    assert.equal(broken.code, 1, '破坏后结论未改变（判据未被真正调用）：' + broken.out);
  });
});

test('v266-S2 门禁已串进 npm run check（与既有四道门并列）', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['check'], /npm run registry/, 'check 未串入 registry');
  assert.match(pkg.scripts['registry'] || '', /registry-audit\.mjs/);
});

console.log('\nv266 done');