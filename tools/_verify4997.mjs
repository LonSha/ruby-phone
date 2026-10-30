import fs from 'node:fs';

const R = '/home/user/ruby-phone';
const V = '4.99.7';
const PREV = '4.99.6';
let bad = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (extra === undefined ? '' : ' :: ' + extra));
  if (!cond) bad++;
};
const read = (p) => fs.readFileSync(R + '/' + p, 'utf8');
const jread = (p) => JSON.parse(read(p));

// 1. manifest / package 同版
const man = jread('manifest.json');
const pkg = jread('package.json');
ok('manifest.version', man.version === V, man.version);
ok('package.version', pkg.version === V, pkg.version);

// 2. update-log：latest / head / 首键 / 条目
const ul = jread('update-log.json');
ok('update-log.latest', ul.latest === V, ul.latest);
ok('update-log.head', ul.head === V, ul.head);
const ulV = ul.versions || {};
ok('update-log.firstKey', Object.keys(ulV)[0] === V, Object.keys(ulV)[0]);
ok('update-log.entry', !!ulV[V], ulV[V] ? ulV[V].date : 'missing');
if (ulV[V]) {
  const items = ulV[V].items || [];
  ok('update-log.items==17', items.length === 17, items.length);
  ok('update-log.date', String(ulV[V].date) === '2026-10-30', ulV[V].date);
  ok('update-log.noBracketBug', items.every((s) => !/[\[\]"]/.test(s)), 'scan');
  ok('update-log.boundaryTag', items.some((s) => s.includes('（v4.99.7 复校）')), 'scan');
}

// 3. 状态台账：真源在 tests/audit/（根目录同名文件是未跟踪旧残留，不参与）
const ledPath = 'tests/audit/status-ledger.json';
const led = jread(ledPath);
ok('ledger.version', led.version === V, led.version);
ok('ledger.version_same', led.version_same === true, led.version_same);
const vs = led.version_sources || {};
const vsKeys = Object.keys(vs);
ok('ledger.sources==4', vsKeys.length === 4, vsKeys.join(','));
ok('ledger.sourcesAllV', vsKeys.every((k) => vs[k] === V), JSON.stringify(vs));

// 4. index.js：常量 / 公告块头 / 旧版仅在历史注释里
const idx = read('index.js');
ok('index.ST_PHONE_VERSION', /const ST_PHONE_VERSION = '4\.99\.7';/.test(idx), 'scan');
ok('index.announceHead', idx.includes('【版本升至 4.99.7'), 'scan');
ok('index.blockVersionIsConst', /const ST_PHONE_CURRENT_UPDATE = \{\s*\n\s*version: ST_PHONE_VERSION,/.test(idx), 'scan');
const prevHits = (idx.match(/4\.99\.6/g) || []).length;
const prevCommentHits = (idx.match(/\[v4\.99\.6 · /g) || []).length;
ok('index.prevOnlyInComments', prevHits === prevCommentHits, prevHits + ' vs comments ' + prevCommentHits);

// 5. ITERATION_LOG：迭代段 + 元信息当前版本 + 头部版本数
const log = read('ITERATION_LOG.md');
ok('log.sec231', /## 迭代 231 · v4\.99\.7/.test(log), 'scan');
ok('log.metaVersion', log.includes('- **当前版本**：`4.99.7`'), 'scan');
const cnt = (log.match(/(\d+) 个版本，按版本号索引/) || [])[1];
ok('log.versionCount==345', cnt === '345', cnt);
ok('log.boundaryTag', log.includes('（v4.99.7 复校）'), 'scan');

// 6. 边界文档：当版复校
const doc = read('docs/runtime-verification-boundary.md');
ok('doc.recheck', doc.split('\n')[0].includes('v4.99.7 复校'), doc.split('\n')[0].slice(0, 60));

// 7. 公告切片段
const seg = read('tools/iter231_seg.md');
const itemLines = seg.split('\n').filter((l) => l.trim().startsWith('- '));
ok('seg.items==17', itemLines.length === 17, itemLines.length);
ok('seg.noQuote', itemLines.every((l) => !/["\\]/.test(l)), 'scan');
ok('seg.firstIsVersion', itemLines[0].includes('版本升至 4.99.7'), itemLines[0].slice(0, 30));
// 三处 items 逐字同源
if (ulV[V]) {
  const src = ulV[V].items;
  const idxItems = (idx.match(/【[^】]*】[^"]*\n/g) || []).length;
  ok('sync.updateLogVsSeg', src.length === itemLines.length, src.length + ' vs ' + itemLines.length);
  const miss = src.filter((s) => !idx.includes(JSON.stringify(s).slice(1, -1)));
  ok('sync.indexVsUpdateLog', miss.length === 0, 'missing ' + miss.length);
}

// 8. 代码面仍在位
ok('bridge.exists', fs.existsSync(R + '/config/notice-paradigm-bridge.js'), 'file');
const app = read('apps/notifications/notifications-app.js');
ok('app.importsKernel', app.includes("from '../../config/usage-paradigm.js'"), 'scan');
ok('app.importsBridge', app.includes('mapHubNotification'), 'scan');
ok('app.rowById', /rowById\s*\(/.test(app), 'scan');
const view = read('apps/notifications/notification-center-view.js');
ok('view.noBridgeImport', !/notice-paradigm-bridge/.test(view), 'scan');
ok('view.hiddenNote', view.includes('已按范式隐藏'), 'scan');
ok('view.noSecondJudge', !/urgent_only|thresholdOf/.test(view), 'scan');
const tst = read('tests/system-v4997.test.mjs');
ok('test.cases==27', (tst.match(/^test\(/gm) || []).length === 27, (tst.match(/^test\(/gm) || []).length);

console.log('--- ' + (bad === 0 ? 'ALL OK' : bad + ' FAILED') + ' ---');
process.exit(bad === 0 ? 0 : 1);