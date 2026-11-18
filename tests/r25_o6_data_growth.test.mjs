/* ============================================================
 * tests/r25_o6_data_growth.test.mjs — R25-O6 数据增长治理的判据
 * ------------------------------------------------------------
 * 这一层最容易被做成的两个假交付：
 *   ① **画个饼图**：数字是页面自己算的，内核只被 import 了一下（「模块在盘 ≠ 机制在用」）；
 *   ② **顺手清一清**：占用统计读全量键面，最方便在同一个函数里把「大的删掉」也做了。
 * 所以判据分三块：内核口径（1~12）、只读硬约束（13）、界面真有口子（14）。
 *
 * 另外两条本仓反复治的病，这里各钉一条：
 *   · **读不出画成 0**（`0 字节`会被读成「手机是空的」）；
 *   · **归属不明摊进某个 App**（用户据此删东西就删错了对象）。
 * 后者用真负控制验：把内核里「归属不明单列」那一行破坏掉，判据必须转红。
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
    GROWTH_REASONS, UNMAPPED, UNMAPPED_LABEL, BYTE_BASIS,
    CLEAN_POLICIES, SNAPSHOT_KEEP, KEY_ALIASES,
    bytesOfText, bytesOfValue, familyOf, appOfKey,
    measureOccupancy, growthBetween, previewCleanup, faceTextOf, judgeGrowthApplied
} from '../config/data-growth.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** 剥注释：判据扫源码时必须先剥，否则自己抄进注释的旧代码会骗红（X5-8/X9 的老坑）。 */
function codeOf(text) {
    const noBlock = String(text).replace(/\/\*[\s\S]*?\*\//g, '');
    return noBlock.split('\n').filter((l) => {
        const t = l.trim();
        return t && !t.startsWith('//') && !t.startsWith('*');
    }).join('\n');
}
const KNOWN = ['wechat', 'calendar', 'usage', 'backupdesk'];

/* ---------------- 内核口径 ---------------- */

test('O6-1 策略是闭集，且每条都写了「会失去什么」与「能不能再长回来」', () => {
    assert.ok(Array.isArray(CLEAN_POLICIES) && CLEAN_POLICIES.length >= 2, '清理策略必须是可数的闭集');
    const ids = CLEAN_POLICIES.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length, '策略 id 不许重复');
    for (const p of CLEAN_POLICIES) {
        assert.ok(String(p.label || '').length > 0, p.id + ' 缺人话标签');
        assert.ok(String(p.loss || '').length > 10, p.id + ' 必须写清「删了会失去什么」——没有代价的预览会让人以为清理是免费的');
        assert.equal(typeof p.recoverable, 'boolean', p.id + ' 必须声明能不能再生成');
    }
    /* 快照裁剪这条必须点名「回放不到」：它和时光机是同一批数据。 */
    const prune = CLEAN_POLICIES.find((p) => p.id === 'snapshot-prune');
    assert.ok(/回放不到/.test(prune.loss), '裁旧快照的代价必须说成「那些时刻再也回放不到」');
});

test('O6-2 字节口径是 UTF-8 实际字节，不是 String.length', () => {
    assert.equal(bytesOfText('abc'), 3);
    assert.equal(bytesOfText('中'), 3, '一个汉字 3 字节');
    assert.equal(bytesOfText('中文'), 6);
    assert.notEqual(bytesOfText('中文'), '中文'.length, '口径必须是字节：用 length 会把中文少算三倍');
    assert.equal(bytesOfText('\u{1f600}'), 4, 'emoji 是代理对，4 字节');
    assert.equal(bytesOfText(''), 0);
    assert.equal(bytesOfText(null), 0);
    /* 对象按序列化算：这是它真正落盘的形态。 */
    assert.equal(bytesOfValue(123), 3);
    assert.ok(bytesOfValue({ a: 1 }) === bytesOfText('{"a":1}'));
    assert.equal(bytesOfValue(undefined), 0);
    assert.ok(/UTF-8/.test(BYTE_BASIS) && /不是 String.length/.test(BYTE_BASIS), '口径说明必须摆在明面');
});

test('O6-3 键族与归属：已知 App id 直接命中、登记过的别名可解析、其余一律 unmapped', () => {
    assert.equal(familyOf('wechat_msg_1'), 'wechat');
    assert.equal(familyOf('calendar_memos'), 'calendar');
    assert.equal(familyOf('standalone'), 'standalone', '没有下划线的键用整键做家族名');
    assert.equal(appOfKey('wechat_msg_1', { knownIds: KNOWN }), 'wechat');
    assert.equal(appOfKey('rh_recovery_hub_v1', { knownIds: KNOWN }), 'backupdesk', 'rh_ 家族指向备份台（别名的出处写在头注里）');
    assert.equal(appOfKey('usage_stats_v1', { knownIds: KNOWN }), 'usage');
    assert.equal(appOfKey('weird_thing', { knownIds: KNOWN }), UNMAPPED, '没有登记过的家族必须单列，不许回落成某个 App');
    assert.ok(Object.keys(KEY_ALIASES).length <= 6, '别名表只收能指出出处的，别长成第二份 App 名单');
});

test('O6-4 读不出 ⇒ unknown + 理由，绝不画「占用 0 字节」', () => {
    const m = measureOccupancy([], { readable: false, why: '宿主未就绪', knownIds: KNOWN });
    assert.equal(m.state, 'unknown');
    assert.equal(m.reason, GROWTH_REASONS.KEY_FACE_UNREADABLE);
    assert.deepEqual(m.rows, []);
    assert.equal(m.totalKeys, 0);
    assert.ok(/不是「手机上没数据」/.test(m.text), '必须说清「没读到 ≠ 没有数据」：这两件事处置相反');
    /* 空但读到了：这是「确实空」，状态仍是 ok。 */
    const e = measureOccupancy([], { readable: true, knownIds: KNOWN });
    assert.equal(e.state, 'ok');
    assert.equal(e.reason, GROWTH_REASONS.NO_KEYS);
    assert.ok(/确实空/.test(e.text));
    /* 面状态是闭集：只有这两个值（不外导出，故直接用字面比）。 */
    assert.equal([m.state, e.state].sort().join(','), 'ok,unknown');
});

test('O6-5 归属不明单独成桶：不计入任何 App，字节一分不摊', () => {
    const entries = [
        { key: 'wechat_msg_1', layer: 'chat', raw: 'x'.repeat(10) },
        { key: 'weird_thing_1', layer: 'chat', raw: 'y'.repeat(100) },
        { key: 'weird_thing_2', layer: 'global', raw: 'z'.repeat(50) }
    ];
    const m = measureOccupancy(entries, { readable: true, knownIds: KNOWN });
    assert.equal(m.state, 'ok');
    assert.equal(m.rows.length, 1, '只有 wechat 一个 App 有归属');
    assert.equal(m.rows[0].id, 'wechat');
    assert.equal(m.rows[0].bytes, 10, 'wechat 只能拿到自己那 10 字节');
    assert.equal(m.unmapped.count, 2);
    assert.equal(m.unmapped.bytes, 150);
    assert.equal(m.unmapped.label, UNMAPPED_LABEL);
    assert.equal(m.totalBytes, 160, '合计包含未归属（否则「一共占多少」会少算）');
    assert.ok(/归属不明（单列，不摊进任何 App）/.test(m.text));
});

test('O6-6 排序：按字节降序，同字节按 id 升序（榜要稳定，不许抖动）', () => {
    const entries = [
        { key: 'wechat_a', layer: 'chat', raw: 'a'.repeat(5) },
        { key: 'calendar_memos', layer: 'global', raw: 'b'.repeat(100) },
        { key: 'usage_stats_v1', layer: 'global', raw: 'c'.repeat(5) }
    ];
    const m = measureOccupancy(entries, { readable: true, knownIds: KNOWN });
    assert.deepEqual(m.rows.map((r) => r.id), ['calendar', 'usage', 'wechat'], 'cal 最大在前；并列时按 id 升序');
    assert.ok(m.rows[0].bytes >= m.rows[1].bytes && m.rows[1].bytes >= m.rows[2].bytes);
});

test('O6-7 读失败的键：计入条数、字节按 0，但必须点名（不许装作空值）', () => {
    const entries = [
        { key: 'wechat_bad', layer: 'chat', failed: true },
        { key: 'wechat_ok', layer: 'chat', raw: 'ok' }
    ];
    const m = measureOccupancy(entries, { readable: true, knownIds: KNOWN });
    assert.equal(m.totalKeys, 2, '读失败的键也是键，条数照记');
    assert.deepEqual(m.unreadableKeys, ['wechat_bad']);
    assert.equal(m.totalBytes, 2);
});

test('O6-8 清理预览只预览：applied 恒 false，裁旧快照保留最近 N 个并算准字节', () => {
    const measured = measureOccupancy([{ key: 'wechat_a', layer: 'chat', raw: 'x' }], { readable: true, knownIds: KNOWN });
    const moments = [];
    for (let i = 0; i < 10; i++) moments.push({ id: 's' + i, at: 1000 - i, bytes: 100 * (i + 1) });
    const pv = previewCleanup(measured, { readable: true, moments, usageBytes: 40 });
    assert.equal(pv.applied, false, '应用状态必须恒为 false —— 本层没有删除的权力');
    assert.equal(pv.dryRun, true);
    const prune = pv.items.find((x) => x.id === 'snapshot-prune');
    assert.equal(prune.available, true);
    assert.equal(prune.count, 10 - SNAPSHOT_KEEP);
    assert.equal(prune.keep, SNAPSHOT_KEEP);
    assert.equal(prune.bytes, 100 * 4 + 100 * 5 + 100 * 6 + 100 * 7 + 100 * 8 + 100 * 9 + 100 * 10);
    assert.ok(/回放不到/.test(prune.loss));
    const usage = pv.items.find((x) => x.id === 'usage-history');
    assert.equal(usage.bytes, 40);
    assert.equal(pv.totalBytes, prune.bytes + 40);
    assert.ok(/只预览，未执行/.test(pv.text));
});

test('O6-9 快照台账读不出 ⇒ 这一项不评，不拿 0 顶替', () => {
    const measured = measureOccupancy([], { readable: true, knownIds: KNOWN });
    const pv = previewCleanup(measured, { readable: false, why: 'bad_json', usageBytes: 10 });
    const prune = pv.items.find((x) => x.id === 'snapshot-prune');
    assert.equal(prune.available, false);
    assert.equal(prune.reason, 'snapshot-ledger-unreadable');
    assert.equal(prune.bytes, 0);
    assert.ok(/不拿 0 顶替/.test(prune.text));
    /* 恢复点没超过保留数：也是「没有可裁的」，而不是「已经清过」。 */
    const pv2 = previewCleanup(measured, { readable: true, moments: [{ id: 'a', at: 1, bytes: 5 }], usageBytes: 0 });
    const prune2 = pv2.items.find((x) => x.id === 'snapshot-prune');
    assert.equal(prune2.count, 0);
    assert.ok(/没有可裁的/.test(prune2.text));
});

test('O6-10 使用统计读不出 ⇒ 同样不评这一项', () => {
    const measured = measureOccupancy([], { readable: true, knownIds: KNOWN });
    const pv = previewCleanup(measured, { readable: true, moments: [], usageBytes: undefined });
    const usage = pv.items.find((x) => x.id === 'usage-history');
    assert.equal(usage.available, false);
    assert.equal(usage.reason, 'usage-stats-unreadable');
    assert.equal(usage.bytes, 0);
    assert.ok(/不拿 0 顶替/.test(usage.text));
});

test('O6-11 增长：没有基线就说没有基线（不拿 0 当基线），有两次就逐 App 报差额', () => {
    const a = measureOccupancy([{ key: 'wechat_a', layer: 'chat', raw: 'x'.repeat(10) }], { readable: true, knownIds: KNOWN });
    const g0 = growthBetween(null, a);
    assert.equal(g0.state, 'unknown');
    assert.equal(g0.reason, GROWTH_REASONS.NO_BASELINE);
    assert.ok(/还没有可比的基线/.test(g0.text));
    const b = measureOccupancy([
        { key: 'wechat_a', layer: 'chat', raw: 'x'.repeat(30) },
        { key: 'calendar_memos', layer: 'global', raw: 'y'.repeat(5) }
    ], { readable: true, knownIds: KNOWN });
    const g1 = growthBetween(a, b);
    assert.equal(g1.state, 'ok');
    const w = g1.rows.find((r) => r.id === 'wechat');
    assert.equal(w.delta, 20);
    const c = g1.rows.find((r) => r.id === 'calendar');
    assert.equal(c.before, null, '上一次没有这一家：before 如实为 null，不写 0');
    assert.equal(c.delta, 5);
    assert.ok(/变动最大的是 微信/.test(g1.text) || /变动最大的是 wechat/.test(g1.text));
});

test('O6-12 读回对拍：unknown ≠ same（没测量 / 没回读都不许说成一致）', () => {
    const m = measureOccupancy([{ key: 'wechat_a', layer: 'chat', raw: 'xx' }], { readable: true, knownIds: KNOWN });
    assert.equal(judgeGrowthApplied(null, { totalBytes: 0, rows: 0 }).state, 'unknown');
    assert.equal(judgeGrowthApplied(m, null).state, 'unknown');
    assert.equal(judgeGrowthApplied(m, { totalBytes: 'x', rows: 1 }).state, 'unknown');
    assert.equal(judgeGrowthApplied(m, { totalBytes: m.totalBytes, rows: m.rows.length }).state, 'same');
    const bad = judgeGrowthApplied(m, { totalBytes: m.totalBytes + 1, rows: m.rows.length });
    assert.equal(bad.state, 'mismatch');
    assert.ok(/不一致/.test(bad.text));
});

test('O6-13 负控制 · 把「归属不明单列」破坏掉 ⇒ O6-5 的判据必须转红', async () => {
    /* 破坏形态选「最像真 bug 的那一种」：为了让榜看起来更完整，把没登记的键塞给
     *   第一个已知 App（听起来像「顺手归类」，实际是让别人多背了一份占用）。 */
    const src = read('config/data-growth.js');
    const from = '        if (app === UNMAPPED) {';
    const n = src.split(from).length - 1;
    assert.equal(n, 1, '负控制锚点必须恰中一次');
    const broken = src.replace(from, '        if (false) {');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_x6_'));
    const file = path.join(dir, 'data-growth.broken.js');
    fs.writeFileSync(file, broken, 'utf8');
    const K2 = await import('file://' + file);
    const entries = [
        { key: 'wechat_a', layer: 'chat', raw: 'x'.repeat(10) },
        { key: 'weird_thing_1', layer: 'chat', raw: 'y'.repeat(100) }
    ];
    const good = measureOccupancy(entries, { readable: true, knownIds: KNOWN });
    const bad = K2.measureOccupancy(entries, { readable: true, knownIds: KNOWN });
    assert.equal(good.rows[0].bytes, 10);
    assert.equal(good.unmapped.count, 1);
    assert.notEqual(bad.rows[0].bytes, 10, '破坏后 wechat 被算上了别人的字节 ⇒ 正是要防的错算');
    assert.equal(bad.unmapped.count, 0, '破坏后未归属桶空了 ⇒ O6-5 判据转红');
});

/* ---------------- 只读硬约束 + 界面真有口子 ---------------- */

test('O6-14 只读是硬约束：内核不 import 存储、不写盘；measureGrowth 方法体零写入', () => {
    const kern = codeOf(read('config/data-growth.js'));
    for (const bad of ['setItem', 'writeReceipt', 'storage.set', "from './storage.js'", "from '../config/storage.js'"]) {
        assert.equal(kern.indexOf(bad), -1, '内核里不许出现 ' + bad);
    }
    assert.equal(/^\s*import\s/m.test(kern), false, '内核是纯函数叶子：一个 import 都不该有');
    const app = codeOf(read('apps/backupdesk/backupdesk-app.js'));
    const i = app.indexOf('measureGrowth()');
    assert.ok(i >= 0, 'measureGrowth 必须存在');
    const body = app.slice(i, app.indexOf('\n    setGrowthObserved', i));
    for (const bad of ['setItem', 'writeReceipt', '.remove(', '.delete(']) {
        assert.equal(body.indexOf(bad), -1, 'measureGrowth 里不许出现 ' + bad + '（这一层只算不删）');
    }
});

test('O6-15 界面真有口子：卡片进渲染、有按钮、有读回、vm 里真有 growth', () => {
    const view = codeOf(read('apps/backupdesk/backupdesk-view.js'));
    assert.ok(/h \+= this\._growth\(vm\);/.test(view), '占用卡必须进 _html 渲染链');
    assert.ok(/_growth\(vm\)\s*\{/.test(view), '_growth 必须画出来');
    assert.ok(/data-bk-grow="measure"/.test(view), '必须有一个「测一次」的按钮（否则用户没有触发口）');
    assert.ok(/data-bk-grow-total/.test(view), '合计字节必须上屏（读回要读它）');
    assert.ok(/data-bk-grow-row/.test(view), '榜行必须上屏（读回要数它）');
    assert.ok(/setGrowthObserved\(/.test(view) && /growthVerdict\(/.test(view), '读回对拍必须真接');
    assert.ok(/applied=/.test(view), '预览必须把 applied 摆在明面上');
    assert.ok(/会失去：/.test(view), '每条清理项必须写「会失去什么」');

    const app = codeOf(read('apps/backupdesk/backupdesk-app.js'));
    assert.ok(/growth:\s*this\._growthVm\(\)/.test(app), 'vm 里必须有 growth（视图只渲染，不算数）');
    assert.ok(/this\._growth = null;/.test(app), '换会话必须丢占用读数（上一段的占用不是本段的）');
});

test('O6-16 面级一句话：unknown 面自己成句，不与 ok 混写', () => {
    const m = measureOccupancy([], { readable: false, why: 'no-host', knownIds: KNOWN });
    const line = faceTextOf(m, null, null);
    assert.ok(/不是「手机上没数据」/.test(line));
    assert.equal(line.indexOf('共 0 条键'), -1, 'unknown 面不许出现「共 0 条键」这种看着像真读数的说法');
    const ok = measureOccupancy([{ key: 'wechat_a', layer: 'chat', raw: 'x' }], { readable: true, knownIds: KNOWN });
    assert.ok(/共 1 条键/.test(faceTextOf(ok, null, null)));
});
