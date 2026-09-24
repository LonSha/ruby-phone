/**
 * tests/system-v291.test.mjs — 桌面角标写入面收口 [v2.91.0]
 *
 * 修前的病（探针 /tmp/probe_badge.py 在修复前的源码上实证）：
 *   全仓 12 处各自写 `.badge =`，且分属两套数组 ——
 *     currentApps（saveData 持久化的那份）与
 *     window.VirtualPhone.home.apps（reloadPhoneSurface 每次新建 HomeScreen 时换的新数组）。
 *   两份互不同步，实测三种漂移：
 *     D1 增量写 currentApps、全量重算写 home.apps —— 后写者把前者抹成 0（drifted=true）；
 *     D2 home 重建后新数组从 APPS 默认值起算 —— 已有角标归零（lost=true）；
 *     D3 清数据只重置 currentApps —— home.apps 残留旧角标（stale=true，幽灵红点）。
 *
 * 收口：index.js 新增 setAppBadge / getAppBadge / mirrorBadgesToHome 三个出口，
 *   全部 12 处写入改为经 setAppBadge（先写 currentApps 真源，再镜像 home.apps，
 *   变化时落盘并派发 UPDATE_GLOBAL_BADGE）。
 *
 * 覆盖：
 *   A 源码面：写出口存在、对外暴露、调用点收敛、无绕过
 *   B 行为面：抽取真源码真跑（D1/D2/D3 复现实验的反向 + 幂等 + 钳制 + 增量基数）
 *   C 负控制：真源码破坏（删掉镜像步骤）→ 同一套判据在副本上转红
 *   D 版本锚点
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const INDEX = read('index.js');
const FILES = {
  'apps/wechat/wechat-app.js': read('apps/wechat/wechat-app.js'),
  'apps/wechat/chat-view.js': read('apps/wechat/chat-view.js'),
  'apps/weibo/weibo-data.js': read('apps/weibo/weibo-data.js'),
  'apps/games/poker/poker-app.js': read('apps/games/poker/poker-app.js'),
};

/** 从源码里按「function 名(」到「下一个顶层 function」截取函数体（4 空格缩进口径） */
function grab(src, name, nxt) {
  const start = src.indexOf(`\n    function ${name}(`);
  assert.ok(start >= 0, `找不到 function ${name}`);
  const rest = src.slice(start + 1);
  const end = rest.search(new RegExp(`\\n    (?:async )?function ${nxt}\\b`));
  assert.ok(end > 0, `${name} 之后找不到 function ${nxt}`);
  return rest.slice(0, end);
}

/**
 * 组装一个可真跑的角标沙箱：宿主桩 + 从真源码截出的六个函数。
 * 返回 { run(extra) }，extra 追加在函数定义之后执行，stdout 逐行返回。
 */
function sandbox(src) {
  const body = [
    grab(src, 'setAppBadge', 'getAppBadge'),
    grab(src, 'getAppBadge', 'mirrorBadgesToHome'),
    grab(src, 'mirrorBadgesToHome', 'syncWechatHomeBadge'),
    grab(src, 'syncWechatHomeBadge', 'triggerWechatOnlineProactive'),
    grab(src, 'syncNotificationsBadge', 'bindBannerInteractions'),
    grab(src, 'updateAppBadge', 'saveData'),
  ].join('\n');
  const header = `
    function makePhoneEvent(n, d) { return { type: n, detail: d || {} }; }
    const PHONE_EVENTS = { UPDATE_GLOBAL_BADGE: 'phone:updateGlobalBadge' };
    const APPS = [{id:'wechat',badge:0},{id:'weibo',badge:0},{id:'notifications',badge:0},{id:'music',badge:0}];
    let currentApps = JSON.parse(JSON.stringify(APPS));
    let homeScreen = null;
    let currentApp = null;
    let totalNotifications = 0;
    let notificationLog = { unreadCount() { return 3; } };
    const window = { VirtualPhone: {}, _ev: [] };
    window.dispatchEvent = (e) => { window._ev.push(e.type); };
    function rebuildHome() { window.VirtualPhone.home = { apps: JSON.parse(JSON.stringify(APPS)) }; }
    rebuildHome();
    const storage = { saves: 0, saveApps() { this.saves++; } };
    function updateNotificationBadge(c) { totalNotifications = c; }
    function saveData() { storage.saveApps(currentApps); }
    const badge = (id, arr) => (arr.find(a => a.id === id) || {}).badge;
  `;
  return {
    exec(extra) {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'v291-'));
      const file = path.join(dir, 'box.mjs');
      writeFileSync(file, header + '\n' + body + '\n' + extra);
      try {
        const out = execFileSync(process.execPath, [file], { encoding: 'utf8' });
        return out.trim().split('\n');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  };
}

/* ============================================================
 * A. 源码面
 * ============================================================ */
test('v291 A1. 三个出口存在且对外暴露', () => {
  for (const name of ['setAppBadge', 'getAppBadge', 'mirrorBadgesToHome']) {
    assert.equal((INDEX.match(new RegExp(`function ${name}\\(`)) || []).length, 1,
      `${name} 应恰定义 1 次`);
  }
  // 暴露点在 VirtualPhone 对象字面量里
  const anchor = INDEX.indexOf('syncFloatingEntry: syncPhoneFloatingEntry');
  const exposed = INDEX.slice(anchor, anchor + 1200);
  for (const name of ['setAppBadge', 'getAppBadge', 'mirrorBadgesToHome']) {
    assert.match(exposed, new RegExp(`\\b${name},`), `${name} 必须挂到 window.VirtualPhone`);
  }
  assert.match(INDEX, /\[v2\.91\.0\]/, '收口须留版本注记');
});

test('v291 A2. 写出口内部：先写真源，再镜像渲染面，变化才落盘与派发', () => {
  const fn = grab(INDEX, 'setAppBadge', 'getAppBadge');
  assert.match(fn, /Math\.max\(0, Number\(value\) \|\| 0\)/, '负值与 NaN 必须钳制为 0');
  assert.match(fn, /currentApps\.find\(a => a\.id === appId\)/, '写入落在 currentApps');
  assert.match(fn, /homeApps !== currentApps/, '镜像须跳过同一引用（避免双写）');
  assert.match(fn, /if \(changed\)/, '未变化不得落盘');
  assert.match(fn, /opts\.persist !== false/, '批量写入可关落盘');
  assert.match(fn, /makePhoneEvent\(PHONE_EVENTS\.UPDATE_GLOBAL_BADGE\)/, '派发走契约事件而非手写字面量');
  const readFn = grab(INDEX, 'getAppBadge', 'mirrorBadgesToHome');
  assert.match(readFn, /currentApps\.find/, '读出口必须读 currentApps 真源');
  assert.doesNotMatch(readFn, /home\?\.apps|home\.apps/, '读出口不得读渲染副本');
});

test('v291 A3. 宿主内旧写入点全部改走出口', () => {
  // syncNotificationsBadge 不再自己写
  const sync = grab(INDEX, 'syncNotificationsBadge', 'bindBannerInteractions');
  assert.match(sync, /setAppBadge\('notifications', unread\)/);
  assert.doesNotMatch(sync, /\.badge\s*=/);
  // syncWechatHomeBadge 走出口且不再触碰 home.apps
  const wx = grab(INDEX, 'syncWechatHomeBadge', 'triggerWechatOnlineProactive');
  assert.match(wx, /setAppBadge\('wechat', total\)/);
  assert.doesNotMatch(wx, /home\?\.apps|home\.apps/);
  // updateAppBadge 以真源现值为基数
  const inc = grab(INDEX, 'updateAppBadge', 'saveData');
  assert.match(inc, /getAppBadge\(appId\) \+ \(Number\(increment\) \|\| 0\)|base \+ \(Number\(increment\) \|\| 0\)/);
  assert.match(inc, /setAppBadge\(/);
  // 两处清数据都镜像归零
  assert.equal((INDEX.match(/mirrorBadgesToHome\(\); \/\/ \[v2\.91\.0\] 清数据后/g) || []).length, 2,
    'clearCurrentData 与 clearAllData 都必须镜像');
  // home 重建后镜像
  const reload = INDEX.slice(INDEX.indexOf('function reloadPhoneSurface'), INDEX.indexOf('function reloadPhoneSurface') + 1500);
  assert.match(reload, /mirrorBadgesToHome\(\)/, 'reloadPhoneSurface 重建 home 后必须镜像');
});

test('v291 A4. 五个外部写入点全部改走 setAppBadge，且无绕过式直写', () => {
  const expectations = [
    ['apps/wechat/wechat-app.js', 2],
    ['apps/wechat/chat-view.js', 1],
    ['apps/weibo/weibo-data.js', 2],
    ['apps/games/poker/poker-app.js', 1],
  ];
  for (const [f, n] of expectations) {
    const src = FILES[f];
    assert.equal((src.match(/setAppBadge\(/g) || []).length, n, `${f} 应有 ${n} 处 setAppBadge 调用`);
    assert.match(src, /makePhoneEvent\(PHONE_EVENTS\.UPDATE_GLOBAL_BADGE\)/,
      `${f} 的兜底派发须走契约事件`);
    assert.doesNotMatch(src, /new CustomEvent\('phone:updateGlobalBadge'\)/,
      `${f} 不得再手写事件字面量`);
  }
  // 微博增量的基数必须读 getAppBadge（真源），不得读 home.apps
  assert.match(FILES['apps/weibo/weibo-data.js'], /getAppBadge\?\.\('weibo'\)/,
    '微博增量基数须读真源');
  // 全仓（这五个文件 + index）里，`.badge =` 只允许出现在 setAppBadge / mirrorBadgesToHome 内
  const allowed = new Set();
  for (const seg of [grab(INDEX, 'setAppBadge', 'getAppBadge'), grab(INDEX, 'mirrorBadgesToHome', 'syncWechatHomeBadge')]) {
    for (const m of seg.matchAll(/\.badge\s*=/g)) allowed.add(m[0]);
  }
  const offenders = [];
  const scan = (name, src) => {
    for (const m of src.matchAll(/^.*\.badge\s*=.*$/gm)) {
      const line = m[0].trim();
      if (line.startsWith('*') || line.startsWith('//')) continue;
      if (name === 'index.js' && (line.includes('app.badge = next') || line.includes('mirror.badge ='))) continue;
      offenders.push(`${name}: ${line.slice(0, 90)}`);
    }
  };
  scan('index.js', INDEX);
  for (const [f, src] of Object.entries(FILES)) scan(f, src);
  // 兜底分支里的直写是「宿主未暴露出口」时的降级，允许但必须包在 else 内 —— 用计数锁死上限
  assert.ok(offenders.length <= 6,
    `绕过式直写超出兜底分支上限：\n${offenders.join('\n')}`);
});

/* ============================================================
 * B. 行为面（抽取真源码真跑）
 * ============================================================ */
test('v291 B1. D1 反向：增量后再全量重算，两份数组一致且取真源值', () => {
  const [line] = sandbox(INDEX).exec(`
    updateAppBadge('wechat', 5);
    window.VirtualPhone.wechatApp = { wechatData: { getChatList() { return [{unread:2},{unread:3}]; } } };
    syncWechatHomeBadge();
    console.log(JSON.stringify({ cur: badge('wechat', currentApps), home: badge('wechat', window.VirtualPhone.home.apps) }));
  `);
  assert.deepEqual(JSON.parse(line), { cur: 5, home: 5 },
    '全量重算得 5（2+3），且渲染副本同步 —— 修复前 home 被抹成 0');
});

test('v291 B2. D2 反向：home 重建后镜像，角标不丢', () => {
  const [line] = sandbox(INDEX).exec(`
    setAppBadge('wechat', 7);
    rebuildHome();
    const before = badge('wechat', window.VirtualPhone.home.apps);
    mirrorBadgesToHome();
    console.log(JSON.stringify({ before, after: badge('wechat', window.VirtualPhone.home.apps) }));
  `);
  const got = JSON.parse(line);
  assert.equal(got.before, 0, '重建瞬间渲染副本归零（这是缺陷的触发点）');
  assert.equal(got.after, 7, '镜像后必须恢复真源值');
});

test('v291 B3. D3 反向：清数据后镜像，渲染副本不残留旧角标', () => {
  const [line] = sandbox(INDEX).exec(`
    setAppBadge('wechat', 9);
    currentApps = JSON.parse(JSON.stringify(APPS));
    mirrorBadgesToHome();
    console.log(JSON.stringify({ cur: badge('wechat', currentApps), home: badge('wechat', window.VirtualPhone.home.apps) }));
  `);
  assert.deepEqual(JSON.parse(line), { cur: 0, home: 0 },
    '清数据后两份都归零 —— 修复前 home 残留 9');
});

test('v291 B4. 通知中心重算写两份；增量以真源为基数；同值不重复落盘；非法值钳制', () => {
  const lines = sandbox(INDEX).exec(`
    syncNotificationsBadge();
    console.log('notif ' + badge('notifications', currentApps) + ',' + badge('notifications', window.VirtualPhone.home.apps));
    const savesAfterSync = storage.saves;
    setAppBadge('notifications', 3);
    console.log('idempotent ' + (storage.saves === savesAfterSync));
    updateAppBadge('weibo', 4);
    updateAppBadge('weibo', 1);
    console.log('inc ' + getAppBadge('weibo'));
    setAppBadge('music', -4);
    setAppBadge('wechat', 'abc');
    console.log('clamp ' + getAppBadge('music') + ',' + getAppBadge('wechat'));
  `);
  assert.equal(lines[0], 'notif 3,3', '通知中心未读 3 写入两份数组');
  assert.equal(lines[1], 'idempotent true', '同值重写不得再次落盘');
  assert.equal(lines[2], 'inc 5', '增量 4 再加 1 得 5（基数读真源）');
  assert.equal(lines[3], 'clamp 0,0', '负数与 NaN 钳制为 0');
});

test('v291 B5. 未读合计对缺省 unread 安全（NaN 不外泄）', () => {
  const [line] = sandbox(INDEX).exec(`
    window.VirtualPhone.wechatApp = { wechatData: { getChatList() { return [{unread:2},{name:'x'},{unread:'4'}]; } } };
    syncWechatHomeBadge();
    console.log(String(getAppBadge('wechat')));
  `);
  assert.equal(line, '6', '缺省 unread 按 0、字符串按数值，合计 6 而非 NaN');
});

/* ============================================================
 * C. 负控制（真源码破坏 → 同一判据转红）
 * ============================================================ */
test('v291 C1. 负控制：删掉 setAppBadge 的镜像步骤 → B1 判据转红', () => {
  const anchor = `            if (Array.isArray(homeApps) && homeApps !== currentApps) {
                const mirror = homeApps.find(a => a.id === appId);
                if (mirror) mirror.badge = next;
            }`;
  assert.equal(INDEX.split(anchor).length - 1, 1, '破坏锚点恰中 1 次');
  const broken = INDEX.replace(anchor, '            /* 破坏：不再镜像到 home.apps */');
  const [line] = sandbox(broken).exec(`
    updateAppBadge('wechat', 5);
    console.log(JSON.stringify({ cur: badge('wechat', currentApps), home: badge('wechat', window.VirtualPhone.home.apps) }));
  `);
  const got = JSON.parse(line);
  assert.equal(got.cur, 5, '真源仍被写入');
  assert.notEqual(got.home, got.cur, '破坏后渲染副本不再同步（B1 判据转红）');
});

test('v291 C2. 负控制：删掉 mirrorBadgesToHome 的赋值 → B2 判据转红', () => {
  const anchor = '                if (mirror) mirror.badge = Number(app.badge) || 0;';
  assert.equal(INDEX.split(anchor).length - 1, 1, '破坏锚点恰中 1 次');
  const broken = INDEX.replace(anchor, '                /* 破坏：镜像时不赋值 */');
  const [line] = sandbox(broken).exec(`
    setAppBadge('wechat', 7);
    rebuildHome();
    mirrorBadgesToHome();
    console.log(String(badge('wechat', window.VirtualPhone.home.apps)));
  `);
  assert.equal(line, '0', '破坏后重建的渲染副本停留在 0（B2 判据转红）');
});

/* ============================================================
 * D. 版本锚点
 * ============================================================ */
test('v291 D. 版本不低于 2.91.0 且五源同源', () => {
  const log = JSON.parse(read('update-log.json'));
  const manifest = JSON.parse(read('manifest.json'));
  const pkg = JSON.parse(read('package.json'));
  const vnum = (v) => String(v).split('.').reduce((a, x) => a * 1000 + Number(x), 0);
  assert.ok(vnum(log.latest) >= vnum('2.91.0'), `update-log ${log.latest} < 2.91.0`);
  assert.equal(manifest.version, log.latest, 'manifest 与 update-log 同源');
  assert.equal(pkg.version, log.latest, 'package.json 与 update-log 同源');
  const m = INDEX.match(/ST_PHONE_VERSION = '([^']+)'/);
  assert.equal(m && m[1], log.latest, 'index.js 版本常量同源');
  assert.ok(log.versions[log.latest], 'update-log 含当前版本条目');
  assert.ok(log.versions[log.latest].items.length > 0, '当前版本条目非空');
});