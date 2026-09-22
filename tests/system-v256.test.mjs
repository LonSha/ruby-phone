/**
 * system-v256.test.mjs — v2.56.0 注入钩子「活性」修复 + 序列化器收敛
 *
 * 背景一（真缺陷）：注入钩子的幂等 guard 与宿主就绪检查顺序写反。
 *   · playbook-app 把 `_boundGenerationHook = true` 放在检查 `SillyTavern context`
 *     **之前**：构造期宿主未就绪时 guard 已被锁死，此后 render() 再调 _initHooks
 *     也会被 `if (guard) return` 挡掉 → 注入**永久静默失效**。
 *   · health-app / peek-app 把 guard 置位放在宿主就绪分支内（正确），但**没有**任何
 *     重试路径：构造期未就绪 → 本次不挂载，且永不重试 → 同样是永久静默失效。
 *   修法：playbook 把置位移到「两条监听都挂载成功之后」；health/peek 在 render()
 *   （App 首次被用户真正打开、宿主必然就绪）重试一次幂等 _initHooks。
 *
 * 背景二（重复实现）：`stringifyState` / `stringifyValue` 三份逐字相同的就地定义
 *   （离线提示词拼装 / 用户态拼装 / 作用域 token 生成），收敛为模块级 stStringifyState。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const idx = read('index.js');
const playbook = read('apps/playbook/playbook-app.js');
const health = read('apps/health/health-app.js');
const peek = read('apps/peek/peek-app.js');

// ---------- A. 注入钩子活性 ----------
test('A1 playbook: guard 置位在宿主就绪检查之后', () => {
  const initAt = playbook.indexOf('_initHooks() {');
  assert.ok(initAt > 0, '_initHooks 未找到');
  const body = playbook.slice(initAt, playbook.indexOf('onChatChanged()', initAt));
  const guardReturn = body.indexOf('if (this._boundGenerationHook) return;');
  const hostCheck = body.indexOf('if (eventSource && event_types)');
  const flagSet = body.indexOf('this._boundGenerationHook = true;');
  assert.ok(guardReturn >= 0, '缺少幂等 return');
  assert.ok(hostCheck > guardReturn, '宿主检查应在 guard 之后');
  assert.ok(flagSet > hostCheck, `guard 置位必须晚于宿主检查（hostCheck=${hostCheck}, flagSet=${flagSet}）`);
});

test('A2 playbook: guard 只被置位一次（放在挂载成功之后）', () => {
  const n = (playbook.match(/this\._boundGenerationHook = true;/g) || []).length;
  assert.equal(n, 1, `置位次数 ${n}，应仅在挂载成功后置位一次`);
});

test('A3 playbook: 置位点位于两条 eventSource.on 之后', () => {
  const initAt = playbook.indexOf('_initHooks() {');
  const body = playbook.slice(initAt, playbook.indexOf('onChatChanged()', initAt));
  const lastOn = body.lastIndexOf('eventSource.on(');
  const flagSet = body.indexOf('this._boundGenerationHook = true;');
  assert.ok(lastOn >= 0 && flagSet > lastOn, 'guard 置位应晚于最后一条监听注册');
});

test('A4 health / peek: render() 内重试 _initHooks（构造期未就绪仍有救）', () => {
  for (const [name, src] of [['health-app', health], ['peek-app', peek]]) {
    const m = src.match(/render\(\) \{([\s\S]*?)\n  \}/);
    assert.ok(m, `${name} render 未找到`);
    assert.match(m[1], /this\._initHooks\(\);/, `${name} render 未重试 _initHooks`);
  }
});

test('A5 health / peek: guard 置位在宿主就绪分支内（原样保持）', () => {
  for (const [name, src] of [['health-app', health], ['peek-app', peek]]) {
    const initAt = src.indexOf('_initHooks() {');
    assert.ok(initAt > 0, `${name} _initHooks 未找到`);
    const body = src.slice(initAt, src.indexOf('render() {', initAt));
    const hostCheck = body.indexOf('if (eventSource && event_types');
    const flagSet = body.indexOf('this._hooked = true;');
    assert.ok(flagSet > hostCheck, `${name} guard 未置于宿主检查之后`);
  }
});

test('A6 三 App 的注入目标仍是 payload.prompt（不写 systemMessages）', () => {
  for (const [name, src] of [['playbook', playbook], ['health', health], ['peek', peek]]) {
    assert.match(src, /payload\.prompt\.push\(/, `${name} 未向 payload.prompt 注入`);
    assert.ok(!/payload\.systemMessages/.test(src), `${name} 仍在写 systemMessages`);
  }
});

// ---------- B. 序列化器单一真源 ----------
test('B1 内联 stringifyState / stringifyValue 定义已清零', () => {
  const inline = (idx.match(/const stringify(?:State|Value) = \(value\) => \{/g) || []).length;
  assert.equal(inline, 0, `仍有 ${inline} 处内联定义`);
});

test('B2 stStringifyState 为唯一模块级实现', () => {
  assert.equal((idx.match(/function stStringifyState\(/g) || []).length, 1);
});

test('B3 三处引用点全部指向 stStringifyState', () => {
  const aliases = (idx.match(/const stringify(?:State|Value) = stStringifyState;/g) || []).length;
  assert.equal(aliases, 3, `引用点数 ${aliases}`);
});

// ---------- C. 版本同源 ----------
test('C1 version 格式（最新版由最新套件锚定）', () => {
  const v = JSON.parse(read('manifest.json')).version;
  assert.match(String(v), /^\d+\.\d+\.\d+$/);
});

test('C2 四源同源', () => {
  const v = JSON.parse(read('manifest.json')).version;
  assert.equal(JSON.parse(read('package.json')).version, v);
  const m = read('index.js').match(/const ST_PHONE_VERSION = '([^']+)'/);
  assert.ok(m, 'ST_PHONE_VERSION 未找到');
  assert.equal(m[1], v);
  const log = JSON.parse(read('update-log.json'));
  assert.equal(log.latest, v);
  assert.ok(Object.prototype.hasOwnProperty.call(log.versions, v), `update-log 缺 ${v}`);
});

test('C3 items 逐字同源（index.js 与 update-log）', () => {
  const v = JSON.parse(read('manifest.json')).version;
  const log = JSON.parse(read('update-log.json'));
  const from = idx.indexOf('ST_PHONE_CURRENT_UPDATE = {');
  const to = idx.indexOf('防重复加载检查', from);
  assert.ok(from > 0 && to > from, 'ST_PHONE_CURRENT_UPDATE 未找到');
  const items = idx.slice(from, to).split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('"') && l.includes('。'))
  // [v2.69.0 修复] 原判据是「逐行剥引号」，隐含假设「串内无转义引号」：
  //   条目里出现 ".get(\"active\")" 这类内容时会剥出残留 \" ⇒ 假红灯（内容其实逐字同源）；
  //   条目跨行时后几条漏比 ⇒ 假绿灯。改为**真解析字符串字面量**，escape 语义由语言保证。
    .map((l) => JSON.parse(l.replace(/,\s*$/, '')));
  assert.ok(items.length > 0, 'index.js items 未解析到');
  assert.deepEqual(log.versions[v].items.slice(0, items.length), items, 'items 未逐字同源');
});

test('C4 本版(2.56.0)条目含本轮变更（锚定自身版本，不随升版漂移）', () => {
  const items = JSON.parse(read('update-log.json')).versions['2.56.0'].items.join('\n');
  assert.match(items, /_initHooks|钩子|幂等/);
});

test('C5 当前版本条目 >= 4 条说明', () => {
  const v = JSON.parse(read('manifest.json')).version;
  const items = JSON.parse(read('update-log.json')).versions[v].items;
  assert.ok(items.length >= 4, `n=${items.length}`);
});
