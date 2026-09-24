/**
 * tests/system-v292.test.mjs — 过期自动备忘批量删除漏回收生活事件 [v2.92.0]
 *
 * 探针实证：领域类型（work/study/travel）的 auto_schedule 备忘过期后，
 * clearExpiredAutoMemos 把备忘从数组里拿掉，但不走 forgetDomainLifeEvent。
 * 时间线仍持有 sourceId = calendar:<id>:<type> 的条目，源头已不存在。
 * deleteMemo 与 syncCommitmentProjection 的移除路径都会回收，只有这条批量路径漏。
 *
 * 覆盖：
 *   A 源码面：删除分支调用 forgetDomainLifeEvent，且仍保留过滤语义
 *   B 行为面：真 PhoneStorage + 真 CalendarData
 *   C 负控制：抽掉回收调用 → 同款判据在副本上转红
 *   D 版本下限
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installRuntimeHost, resetHostFlags } from './_runtime_host.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const CAL_SRC = read('apps/calendar/calendar-data.js');

const urlOf = (root, rel) => pathToFileURL(path.join(root, rel)).href;

function stageTree(files) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'v292-tree-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}
const replaceOnce = (s, from, to) => {
  const n = s.split(from).length - 1;
  assert.equal(n, 1, `锚点应恰好命中 1 次，实际 ${n}：${String(from).slice(0, 70)}`);
  return s.replace(from, to);
};

function bodyOf(src, name) {
  const sig = `    ${name}(`;
  const at = src.indexOf(sig);
  assert.ok(at >= 0, `找不到 ${name}`);
  const nxt = src.indexOf('\n    ', at + sig.length);
  // 取到下一个同级方法前；没有就取尾部一截
  const rest = src.slice(at);
  const m = rest.slice(sig.length).search(/\n    [A-Za-z_][A-Za-z0-9_]*\(/);
  return m < 0 ? rest : rest.slice(0, sig.length + m);
}

/* ============================================================
 * A. 源码面
 * ============================================================ */
test('v292 A. clearExpiredAutoMemos 删除分支走 forgetDomainLifeEvent', () => {
  const body = bodyOf(CAL_SRC, 'clearExpiredAutoMemos');
  assert.match(body, /for \(const memo of dropped\) this\.forgetDomainLifeEvent\(memo\);/,
    '批量删除必须逐条回收生活事件');
  assert.match(body, /\[v2\.92\.0\]/, '修复点须留版本注记');
  // 过滤语义不得被改写：非自动、循环、无日期、未过期都留下
  assert.match(body, /!== 'auto_schedule'/);
  assert.match(body, /isRecurringMemo\(memo\)/);
  assert.match(body, /dateSerial\(memoParts\) >= currentSerial/);
  assert.match(body, /!this\.isReminderEnabled\(\)/);
  assert.match(body, /hasMemoReminderFired/);
  assert.equal(body.split('forgetDomainLifeEvent').length - 1, 1, '回收调用恰一处');
});

/* ============================================================
 * B. 行为面
 * ============================================================ */
async function boot(root) {
  resetHostFlags();
  const host = installRuntimeHost({ chatMetadata: {}, settings: {} });
  const { PhoneStorage } = await import(urlOf(root, 'config/storage.js'));
  const { CalendarData } = await import(urlOf(root, 'apps/calendar/calendar-data.js'));
  const st = new PhoneStorage();
  host.window.VirtualPhone = host.window.VirtualPhone || {};
  host.window.VirtualPhone.storage = st;
  const ns = {};
  host.context.chatMetadata['st_virtual_phone'] = ns;
  return { host, data: new CalendarData(st), ns };
}
const sids = (ns) => (Array.isArray(ns.life_events_v1) ? ns.life_events_v1 : []).map((e) => e.sourceId);

/** 真判据：过期的自动工作备忘被清掉后，时间线不得再持有它的 sourceId。
 *  同时未过期的自动备忘与手动备忘的事件必须还在。
 *  返回 { ghost, kept } 供负控制复用。 */
export async function expiredSweepVerdict(root) {
  const { host, data, ns } = await boot(root);
  try {
    const expired = data.addMemo({ dateKey: '2026-09-20', title: '过期工作备忘', time: '09:00', type: 'work', source: 'auto_schedule' });
    const future = data.addMemo({ dateKey: '2026-09-28', title: '未来工作备忘', time: '09:00', type: 'work', source: 'auto_schedule' });
    const manual = data.addMemo({ dateKey: '2026-09-20', title: '手动工作备忘', time: '09:00', type: 'work', source: 'manual' });
    assert.ok(expired && future && manual, '三条备忘都写入');
    // 过期且提醒已触发，才符合清除条件（提醒开启时，未触发的过期备忘会被留下）
    data.markMemoReminderFired(expired.id, expired.dateKey);
    const n = data.clearExpiredAutoMemos('2026-09-25');
    const left = data.getMemos().map((m) => m.id);
    const ids = sids(ns);
    return {
      removed: n,
      memoGone: !left.includes(expired.id),
      futureKept: left.includes(future.id),
      manualKept: left.includes(manual.id),
      ghost: ids.includes('calendar:' + expired.id + ':work'),
      futureEvent: ids.includes('calendar:' + future.id + ':work'),
      manualEvent: ids.includes('calendar:' + manual.id + ':work'),
    };
  } finally {
    host.uninstall();
  }
}

function assertClean(v, where) {
  assert.equal(v.removed, 1, where + ' 只清掉过期那一条');
  assert.equal(v.memoGone, true, where + ' 过期备忘已不在列表');
  assert.equal(v.futureKept, true, where + ' 未过期备忘保留');
  assert.equal(v.manualKept, true, where + ' 手动备忘保留');
  assert.equal(v.ghost, false, where + ' 时间线不得留过期备忘的生活事件');
  assert.equal(v.futureEvent, true, where + ' 未过期事件保留');
  assert.equal(v.manualEvent, true, where + ' 手动事件保留');
}

test('v292 B. 过期自动备忘清除后时间线不留幽灵事件', async () => {
  assertClean(await expiredSweepVerdict(ROOT), '真仓库');
});

test('v292 B2. 循环备忘留下，未过期的领域备忘与其事件都留下', async () => {
  const { host, data, ns } = await boot(ROOT);
  try {
    // 循环判定只认 birthday / anniversary，与 globalReminder 无关
    const recur = data.addMemo({ dateKey: '2026-09-20', title: '结婚纪念日', time: '09:00', type: 'anniversary', source: 'auto_schedule' });
    const future = data.addMemo({ dateKey: '2026-09-28', title: '下周出差', time: '09:00', type: 'travel', source: 'auto_schedule' });
    const expired = data.addMemo({ dateKey: '2026-09-20', title: '已过期的学业', time: '09:00', type: 'study', source: 'auto_schedule' });
    const n = data.clearExpiredAutoMemos('2026-09-25');
    const left = data.getMemos().map((m) => m.id);
    assert.equal(n, 1, '只清过期的非循环自动备忘');
    assert.ok(left.includes(recur.id), '循环纪念日保留');
    assert.ok(left.includes(future.id), '未过期出行保留');
    assert.ok(!left.includes(expired.id), '过期学业被清');
    // anniversary 不是领域类型，创建时没有生活事件
    assert.equal(sids(ns).some((id) => id.includes(recur.id)), false, '纪念日不产生领域事件');
    assert.ok(sids(ns).includes('calendar:' + future.id + ':travel'), '未过期事件保留');
    assert.equal(sids(ns).includes('calendar:' + expired.id + ':study'), false, '过期学业的事件被回收');
  } finally {
    host.uninstall();
  }
});

/* ============================================================
 * C. 负控制：抽掉回收调用，同款判据必须转红
 * ============================================================ */
test('v292 C. 负控制：删掉回收调用 → 幽灵事件复现', async () => {
  const anchor = '        for (const memo of dropped) this.forgetDomainLifeEvent(memo);\n';
  assert.equal(CAL_SRC.split(anchor).length - 1, 1, '锚点恰中 1 次');
  const broken = CAL_SRC.replace(anchor, '');
  const dir = stageTree({
    'package.json': JSON.stringify({ type: 'module' }),
    'apps/calendar/calendar-data.js': broken,
    'config/life-events.js': read('config/life-events.js'),
    'config/storage.js': read('config/storage.js'),
  });
  // 副本模块依赖相对路径，三个文件按原相对位置放好即可加载
  const v = await expiredSweepVerdict(dir);
  assert.equal(v.memoGone, true, '破坏后备忘仍被清掉（删除本身没坏）');
  assert.equal(v.ghost, true, '抽掉回收后时间线必须留下幽灵事件（判据转红）');
  assert.equal(v.futureEvent, true, '未过期事件不受影响');
  assert.equal(v.manualEvent, true, '手动事件不受影响');
});

/* ============================================================
 * D. 版本下限
 * ============================================================ */
function vnum(v) {
  return String(v || '').split('.').map((n) => Number.parseInt(n, 10) || 0);
}
function atLeast(v, floor) {
  const a = vnum(v), b = vnum(floor);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return true;
}
test('v292 D. 版本不低于 2.92.0 且五源同源', () => {
  const log = JSON.parse(read('update-log.json'));
  const manifest = JSON.parse(read('manifest.json'));
  const pkg = JSON.parse(read('package.json'));
  const index = read('index.js');
  const m = index.match(/const ST_PHONE_VERSION = '([^']+)'/);
  const ver = m && m[1];
  assert.equal(log.latest, manifest.version);
  assert.equal(manifest.version, pkg.version);
  assert.equal(pkg.version, ver);
  assert.equal(atLeast(log.latest, '2.92.0'), true, `版本 ${log.latest} < 2.92.0`);
  const entry = log.versions[log.latest];
  assert.ok(entry && Array.isArray(entry.items) && entry.items.length > 0, '当前版本节须有条目');
});
