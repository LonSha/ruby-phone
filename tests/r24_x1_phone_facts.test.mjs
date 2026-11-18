// tests/r24_x1_phone_facts.test.mjs — R24-X1「手机事实通道」判据
// 纪律：三态不塌。`known` / `stale` / `unknown` 三者不同形；`unknown` 的三种理由
// （no-declaration / never-published / publisher-off）也必须逐条不同形 ——
// 它们的处置相反：一个是「没这个事实」，一个是「还没发布」，一个是「发布者关了」。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const M = await import(pathToFileURL(path.join(ROOT, 'config/phone-facts.js')));

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('✓ ' + n); } else { fail++; console.log('✗ ' + n); } };
const R = M.FACT_STATES;
const U = M.FACT_UNKNOWN_REASONS;

/* ── 单发布者铁律：双发布者必须拒判，且先到者保留 ── */
const g = M.createFactRegistry({ ttlMs: 1000 });
const d1 = g.declarePublisher('clock', 'story-clock', { ttlMs: 1000 });
ok('首位登记 → declared', d1.ok === true && d1.face === 'declared');
const d2 = g.declarePublisher('clock', 'wallet');
ok('第二位登记同一事实 → conflict 并点名先到者', d2.ok === false && d2.face === 'conflict' && d2.conflictWith === 'story-clock');
ok('冲突后先到者仍是唯一发布者', g.publish('clock', 'story-clock', 480, 0).ok === true);
ok('冲突后再由后到者发布 → not-publisher（fail-closed）', (() => { const p = g.publish('clock', 'wallet', 1, 10); return p.ok === false && p.face === 'not-publisher'; })());
ok('重复登记同一发布者 → idempotent（不是冲突）', g.declarePublisher('clock', 'story-clock').face === 'idempotent');

/* ── 未登记事实：拒收，不是「默认收下」 ── */
ok('未登记事实发布 → undeclared', (() => { const p = g.publish('wallet.balance', 'wallet', 100, 0); return p.ok === false && p.face === 'undeclared'; })());

/* ── 三态：known / stale / unknown ── */
g.publish('clock', 'story-clock', 480, 0);
const k = g.read('clock', 500);
ok('未过期 → known 且带 value', k.face === R.KNOWN && k.value === 480 && k.ageMs === 500);
const s = g.read('clock', 5000);
ok('过期 → stale 且**仍带 value**（旧但可显示）', s.face === R.STALE && s.value === 480 && s.ageMs === 5000);
const nd = g.read('not-declared-fact', 500);
ok('没登记过的事实 → unknown + no-declaration', nd.face === R.UNKNOWN && nd.reason === U.NO_DECLARATION);
g.declarePublisher('presence', 'contact');
const np = g.read('presence', 500);
ok('登记了但没发布过 → unknown + never-published', np.face === R.UNKNOWN && np.reason === U.NEVER_PUBLISHED);

/* ── 发布者断电：unknown + publisher-off，且旧值不许冒充现状 ── */
g.setPublisherPower('story-clock', false);
const po = g.read('clock', 800);
ok('断电 → unknown + publisher-off', po.face === R.UNKNOWN && po.reason === U.PUBLISHER_OFF);
ok('断电后 value 必须是 null（不许拿旧值当现在）', po.value === null);
ok('断电后发布被拒', g.publish('clock', 'story-clock', 481, 900).ok === false);
ok('三种 unknown 理由互不相同（压平即返工）',
    new Set([U.NO_DECLARATION, U.NEVER_PUBLISHED, U.PUBLISHER_OFF]).size === 3
    && nd.reason !== np.reason && np.reason !== po.reason);

/* ── 订阅：只拿快照，能退订，订阅方出错不影响发布方 ── */
const g2 = M.createFactRegistry({ ttlMs: 10000 });
g2.declarePublisher('unread', 'notice', { ttlMs: 10000 });
let hits = 0, last = null;
const off = g2.subscribe('unread', (snap) => { hits++; last = snap; });
g2.publish('unread', 'notice', 3, 100);
ok('订阅收到一次且带 fact/face/value', hits === 1 && last.fact === 'unread' && last.face === R.KNOWN && last.value === 3);
last.value = 999;
ok('订阅拿的是快照副本（改它不影响真实值）', g2.read('unread', 100).value === 3);
const off2 = g2.subscribe('unread', () => { throw new Error('订阅方自己的错'); });
let safe = true;
try { g2.publish('unread', 'notice', 4, 200); } catch (_e) { safe = false; }
ok('订阅方抛错不许炸到发布方', safe === true && g2.read('unread', 200).value === 4);
off2();
off();
g2.publish('unread', 'notice', 5, 300);
ok('退订后不再收到（publish4 时计数已到 2，此后再不增长）', hits === 2);

/* ── 快照与回执台账 ── */
const snap = g2.snapshot(300);
ok('snapshot 逐事实给面 + 三态计数', snap.total === 1 && snap.counts.known === 1 && snap.faces.unread.value === 5);
const g3 = M.createFactRegistry({ ttlMs: 1000, receiptCap: 3 });
g3.declarePublisher('a', 'p', { ttlMs: 1000 });
for (let i = 0; i < 5; i++) g3.publish('a', 'p', i, i);
ok('回执台账是环形且按 cap 裁剪', g3.receiptLog().length === 3);
ok('describe 报出发布者与时效（诊断面不用猜）', (() => { const d = g3.describe(); return d.count === 1 && d.rows[0].publisher === 'p' && d.rows[0].ttlMs === 1000; })());

/* ── 负控制：把三态压平的实现必须能被判据分出来 ── */
const cheatFlat = (slot) => ({ face: R.KNOWN, value: slot ? slot.value : null });
ok('负控制：把 stale 读成 known 会改判', cheatFlat({ value: 480 }).face !== s.face);
const cheatOff = (slot) => ({ face: R.STALE, value: slot ? slot.value : null });
ok('负控制：把 publisher-off 读成 stale 会改判（且会拿旧值冒充现状）',
    cheatOff({ value: 480 }).face !== po.face && po.value === null);

/* ── 装配点：index.js 必须真引入并真跑自检（不是只登记个名字） ── */
const idx = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
ok('接线：index.js 引入 phoneFactsSelfCheck', idx.includes("from './config/phone-facts.js'"));
ok('接线：自检进了 _bridgeChecks 装配表', /\[\s*'_r24X1'\s*,\s*phoneFactsSelfCheck\s*\]/.test(idx));
ok('自检本体绿', M.phoneFactsSelfCheck().ok === true);

console.log(pass + ' 通过, ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);