/* ============================================================
 * tests/system-v4147.test.mjs -- [v4.147.0 · 第二十一期 批次D 第二步 R21-O8 跨 App 实体归并]
 * ============================================================
 * 【规格给的判据号第二次踩了占用号】
 *   规格原文写 `tests/system-v4170.test.mjs`，那一号早在 v4.17.0 就被
 *   「未点保存的编辑内容也能恢复」（R4-O5）占用。与 R21-O7 的 v4160 同一
 *   缺陷形态 —— 号段指纹在规格起草时没查重。本档取第一个空闲号 v4147。
 *
 * 【交付面】
 *   config/entity-link.js：linkEntity(appId, localId, ledgers) 三态归并
 *   （时间窗 + 金额指纹，双向匹配）。真实持久账只有两本记钱的：
 *   shop_orders × accounting_records；规格例子的 apps/delivery 是 lonsha-bridge
 *   内存态无落盘 —— 如实登记不假造第三本账。
 *
 * 判据面（五组）：
 *   A 三态互斥：linked/ambiguous/unlinked 由候选数唯一决定；ambiguous 必须全列候选
 *   B 只读性：调用前后两本账字节级相同；无 storage 依赖
 *   C 确定性：entityId 两次调用同值；时间窗外不算；金额不等不算
 *   D 负控制两向：把匹配改成「取第一个」⇒ 判据必须红；真实现此刻确实全列
 *   E 版本锚：五源同源且 ≥ 4.147.0
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const BORN_V = '4.147.0';

import { linkEntity, LINK_STATUS, ENTITY_LINK_WINDOW_MS } from '../config/entity-link.js';

const now = 1_700_000_000_000;
const shopOrder = (id, cents, t) => ({ id, code: 'ABC123', createdAt: t, rows: [{ productId: 'p1', name: 'x', priceCents: cents, qty: 1 }], totalCents: cents, status: 'pending', pickedAt: 0 });
const acctRec = (id, cents, t) => ({ id, kind: 'expense', amount: cents, category: '购物', accountId: '', note: '', at: t });

/* ═══════════════════════════ A · 三态互斥 ═══════════════════════════ */
test('A1 三态互斥且由候选数唯一决定（0/1/≥2 → unlinked/linked/ambiguous）', () => {
    assert.deepEqual(LINK_STATUS, { linked: 'linked', ambiguous: 'ambiguous', unlinked: 'unlinked' });
    const books = { shop: [shopOrder('so_1', 4200, now)], accounting: [acctRec('rec_1', 4200, now)] };
    assert.equal(linkEntity('shop', 'so_1', books).status, 'linked');
    assert.equal(linkEntity('accounting', 'rec_1', books).status, 'linked');
    assert.equal(linkEntity('shop', 'so_x', books).status, 'unlinked');
    assert.equal(linkEntity('shop', 'so_1', { shop: [shopOrder('so_1', 4200, now)] }).status, 'unlinked');
    assert.equal(linkEntity('music', 'm1', books).status, 'unlinked');
    const books2 = { shop: [shopOrder('so_1', 4200, now), shopOrder('so_2', 4200, now + 60_000)], accounting: [acctRec('rec_1', 4200, now)] };
    const r = linkEntity('accounting', 'rec_1', books2);
    assert.equal(r.status, 'ambiguous');
});

test('A2 ambiguous 必须全列候选（不许挑一个、不许截断）', () => {
    const books = { shop: [shopOrder('so_a', 3000, now - 120_000), shopOrder('so_b', 3000, now), shopOrder('so_c', 3000, now + 200_000)], accounting: [acctRec('rec_1', 3000, now)] };
    const r = linkEntity('accounting', 'rec_1', books);
    assert.equal(r.status, 'ambiguous');
    assert.ok(Array.isArray(r.candidates) && r.candidates.length === 3, '候选必须 3 条全列，实得 ' + (r.candidates || []).length);
    const ids = r.candidates.map((c) => c.id).sort();
    assert.deepEqual(ids, ['so_a', 'so_b', 'so_c'], '候选清单必须含全部同额订单');
    /* 不给 entityId、不给「最佳」—— 挑哪个都是猜。 */
    assert.equal(r.entityId, null, 'ambiguous 态不许给 entityId（给了就是替用户挑了）');
});

test('A3 边界如实归因（unknown-app / self-missing），不抛错不猜', () => {
    const books = { shop: [shopOrder('so_1', 4200, now)], accounting: [acctRec('rec_1', 4200, now)] };
    assert.equal(linkEntity('music', 'x', books).reason, 'unknown-app');
    assert.equal(linkEntity('shop', 'nope', books).reason, 'self-missing');
    assert.equal(linkEntity('shop', 'so_1', null).status, 'unlinked');
    assert.equal(linkEntity('shop', 'so_1', undefined).status, 'unlinked');
});

/* ═══════════════════════════ B · 只读性 ═══════════════ books ═══════════════ */
test('B1 调用前后两本账**字节级**相同（JSON.stringify 逐字节对账）', () => {
    const books = { shop: [shopOrder('so_1', 4200, now), shopOrder('so_2', 8800, now + 300_000)], accounting: [acctRec('rec_1', 4200, now + 60_000)] };
    const before = JSON.stringify(books);
    linkEntity('shop', 'so_1', books);
    linkEntity('accounting', 'rec_1', books);
    linkEntity('music', 'x', books);
    assert.equal(JSON.stringify(books), before, '调用前后账本必须字节级相同（只读铁律）');
});

test('B2 只读性在源码面成立：不 import storage、不写键（去注释扫真代码）', () => {
    const src = read('config/entity-link.js');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.ok(!/storage\.set|localStorage|PhoneStorage/.test(code), 'entity-link 源码面不得出现任何写存储调用');
    assert.ok(!/import\s/.test(code), 'entity-link 必须是零 import 纯函数内核');
    /* 接线面：accounting-app 只 get 不 set shop_orders。 */
    const appSrc = read('apps/accounting/accounting-app.js');
    const appCode = appSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const setHits = appCode.split('\n').filter((l) => /storage\.set\(/.test(l) && /shop_orders/.test(l));
    assert.deepEqual(setHits, [], 'accounting-app 不许对 shop_orders 有任何写调用（写归 shop owner）');
    assert.ok(appCode.includes("storage.get('shop_orders')"), '关联读数必须现取 shop_orders');
});

/* ═══════════════════════════ B3 双向匹配 ═══════════════ */
test('B3 双向匹配成立（shop 侧发起也能对上 accounting）', () => {
    const books = { shop: [shopOrder('so_1', 4200, now)], accounting: [acctRec('rec_1', 4200, now + 90_000)] };
    const a = linkEntity('shop', 'so_1', books);
    const b = linkEntity('accounting', 'rec_1', books);
    assert.equal(a.status, 'linked');
    assert.equal(b.status, 'linked');
    assert.equal(a.entityId, b.entityId, '同一件事从两侧发起必须派生出同一个 entityId');
    assert.ok(a.sources.length === 2 && b.sources.length === 2);
});

/* ═══════════════════════════ C · 确定性 ═══════════════ */
test('C1 entityId 确定性：两次调用同值；交换输入顺序不变', () => {
    const books = { shop: [shopOrder('so_1', 4200, now)], accounting: [acctRec('rec_1', 4200, now)] };
    assert.equal(linkEntity('shop', 'so_1', books).entityId, linkEntity('shop', 'so_1', books).entityId, '同一输入两次调用必须同 entityId');
    const flipped = { accounting: books.accounting, shop: books.shop };
    assert.equal(linkEntity('shop', 'so_1', books).entityId, linkEntity('shop', 'so_1', flipped).entityId, '账本键顺序不得影响 entityId');
    /* 双侧发起同值已在 B3 钉过，这里钉排序拼接的另一半：不同对必须不同值。 */
    const books2 = { shop: [shopOrder('so_1', 4200, now)], accounting: [acctRec('rec_1', 4200, now), acctRec('rec_9', 4200, now - 400_000)] };
    assert.notEqual(linkEntity('shop', 'so_1', books).entityId, linkEntity('shop', 'so_1', books2).entityId, '不同配对不许撞同一个 entityId');
});

test('C2 时间窗与金额口径：窗外不算、金额不等不算（窗口常数冻结在源码面）', () => {
    const out = now + ENTITY_LINK_WINDOW_MS + 1;
    const books = { shop: [shopOrder('so_far', 4200, out)], accounting: [acctRec('rec_1', 4200, now)] };
    assert.equal(linkEntity('accounting', 'rec_1', books).status, 'unlinked', '窗口外 1ms 也不许算候选');
    const books2 = { shop: [shopOrder('so_1', 4200, now)], accounting: [acctRec('rec_1', 4300, now)] };
    assert.equal(linkEntity('shop', 'so_1', books2).status, 'unlinked', '金额差 100 分不许算候选');
    /* 窗口常数必须由源码导出（不许判据自造口径）。 */
    const src = read('config/entity-link.js');
    assert.ok(/export const ENTITY_LINK_WINDOW_MS\s*=\s*10\s*\*\s*60\s*\*\s*1000/.test(src), '窗口常数必须在源码面冻结为 10 分钟');
});

/* ═══════════════════════════ D · 负控制两向 ═══════════════ */
test('D1 负控制：把匹配改成「取第一个」⇒ 同款判据必须红（两向之一：破坏会红）', () => {
    /* 在内存里复刻「取第一个」的坏实现，跑与 A2 同一套断言函数。 */
    const books = { shop: [shopOrder('so_a', 3000, now - 120_000), shopOrder('so_b', 3000, now), shopOrder('so_c', 3000, now + 200_000)], accounting: [acctRec('rec_1', 3000, now)] };
    const all = books.shop.filter((o) => o.totalCents === 3000 && Math.abs(o.createdAt - now) <= ENTITY_LINK_WINDOW_MS);
    const broken = { status: 'linked', entityId: 'ent_fake', sources: [books.shop[0]], candidates: [all[0]] };  // ← 挑了第一个
    let caught = false;
    try {
        assert.equal(broken.entityId, null, 'ambiguous 态不许给 entityId');
        assert.deepEqual(broken.candidates.map((c) => c.id).sort(), ['so_a', 'so_b', 'so_c'], '候选必须全列');
    } catch (_e) { caught = true; }
    assert.ok(caught, '「取第一个」的坏实现必须被 A2 同款断言抓住（抓不到说明 A2 是恒绿的假判据）');
});

test('D2 负控制：真实现此刻确实全列候选 —— 判据不是靠夹具才绿', () => {
    /* 真实现跑同一输入：必须 ambiguous 且 3 条全列（与 D1 的坏实现同输入对照）。 */
    const books = { shop: [shopOrder('so_a', 3000, now - 120_000), shopOrder('so_b', 3000, now), shopOrder('so_c', 3000, now + 200_000)], accounting: [acctRec('rec_1', 3000, now)] };
    const r = linkEntity('accounting', 'rec_1', books);
    assert.equal(r.status, 'ambiguous', '真实现必须判 ambiguous（不是挑第一个判 linked）');
    assert.deepEqual(r.candidates.map((c) => c.id).sort(), ['so_a', 'so_b', 'so_c'], '真实现必须全列 3 条候选');
    assert.equal(r.entityId, null);
});

/* ═══════════════════════════ E · 版本锚 ═══════════════ */
test('E1 五源同源且 ≥ ' + BORN_V, () => {
    const pkg = JSON.parse(read('package.json'));
    const man = JSON.parse(read('manifest.json'));
    const ul = JSON.parse(read('update-log.json'));
    const idx = read('index.js');
    assert.equal(pkg.version, man.version, 'package.json 与 manifest.json 必须同版');
    assert.equal(ul.latest, pkg.version, 'update-log latest 必须同版');
    assert.ok(idx.includes("const ST_PHONE_VERSION = '" + pkg.version + "'"), 'index.js 版本常量必须同版');
    const num = pkg.version.split('.').map(Number);
    assert.equal(num.length, 3, '版本必须是三段数字：' + pkg.version);
    const born = BORN_V.split('.').map(Number);
    const ok = num[0] > born[0] || (num[0] === born[0] && (num[1] > born[1] || (num[1] === born[1] && num[2] >= born[2])));
    assert.ok(ok, '版本必须 ≥ ' + BORN_V + '（实得 ' + pkg.version + '）');
});