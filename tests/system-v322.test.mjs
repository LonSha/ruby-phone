/**
 * tests/system-v322.test.mjs — F-8 存档健康面板（P-4 两个裁定读数的消费侧）[v3.5.1]
 *
 * P-4（v3.4.0）落了两个只读裁定出口（schemaFace / migrationLedgerFace），
 * 但它们**全库只有测试在读**：用户看不到「这份存档属于哪个存储时代」
 * 「一共搬过几条旧键、有没有时间戳坏掉的」。机制做完却没人看，与「建好不消费」同形。
 * 本项只做**呈现**，不做任何判定与迁移。
 *
 * 三条约束与诊断中心头一致：
 *   ① 只读（零写入 —— 由 A4 在真宿主上逐字对账证明）；
 *   ② 不抛（storage 缺失 / 接口缺失 / 抛错一律降级成 ok:false + 归因）；
 *   ③ 不猜（两个**分域**分开报：本会话档 / 全局档是两本不同的账）。
 *
 * 写法约定（实测教训）：本文件**零反斜杠**。
 *   正则字面量里的反斜杠在这个工具链里会被吞掉一层，初稿的去 export 正则
 *   （export 后接空白字符类）被吞成 export 后接字面量 s，于是「替换」静默不发生、
 *   整份套件跑在空壳上还报绿。故一律用 includes / split 计数，
 *   loadStorage 也改成按行首前缀匹配。
 *
 * 覆盖：
 *   A 内核面（结构恒定 / 四态 + 八种账本形态 / 逐条读数 / 零写入 / 文案 / 不抛）
 *   B 接线面（卡片挂进 render / app 层真传 storage）
 *   C 负控制（真源码破坏 → 破坏副本上重跑同款真判据）
 *   D 版本锚
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { installRuntimeHost, resetHostFlags } from './_runtime_host.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const NL = String.fromCharCode(10);
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const DD_SRC = read('apps/diagnose/diagnose-data.js');
const DV_SRC = read('apps/diagnose/diagnose-view.js');
const DA_SRC = read('apps/diagnose/diagnose-app.js');
const STORAGE_SRC = read('config/storage.js');
const DG = await import(pathToFileURL(path.join(ROOT, 'apps', 'diagnose', 'diagnose-data.js')).href);

/** 真源码加载 PhoneStorage（去掉行首 export 前缀后落盘成模块；不手抄、不手改代码） */
let _PS = null;
async function loadStorage() {
    if (_PS) return _PS;
    const lines = STORAGE_SRC.split(NL).map((ln) => ln.startsWith('export class PhoneStorage')
        ? ln.slice('export '.length) : ln);
    const src = lines.join(NL) + NL + 'export { PhoneStorage };' + NL;
    assert.notEqual(src, STORAGE_SRC, '去 export 前缀必须真发生（写错则整份套件静默跑在空壳上）');
    assert.ok(src.includes('class PhoneStorage'), 'PhoneStorage 类声明必须在位');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'v322-storage-'));
    const file = path.join(dir, 'storage_mod.mjs');
    writeFileSync(file, src);
    _PS = (await import('file://' + file)).PhoneStorage;
    assert.equal(typeof _PS, 'function', 'PhoneStorage 必须真加载出来');
    return _PS;
}

/** 装真宿主 + 造实例。where 决定账本写在哪一本账（chatMetadata / extensionSettings） */
async function freshStorage(ledger, where = 'chat') {
    resetHostFlags();
    const host = installRuntimeHost({ chatMetadata: {}, settings: {} });
    const ns = (ledger === undefined) ? {} : { __migration_ledger: ledger };
    /* 真宿主夹具的 extensionSettings 是固定形状（不看 settings 入参），故两本账都显式写入，
     * 不猜夹具行为：只说「账本写在哪一本」和「另一本是空的」。 */
    host.context.chatMetadata.st_virtual_phone = (where === 'chat') ? ns : {};
    host.context.extensionSettings.st_virtual_phone = (where === 'global') ? ns : {};
    const PS = await loadStorage();
    return new PS();
}

const FACE_KEYS = ['ok', 'reason', 'chat', 'global'].sort();

/* ══════════ A 内核面 ══════════ */
test('v322 A1. ★★★ 结构恒定：storageFace 面在，两个分域分开报（不合成一个读数）', () => {
    const a = DG.collectDiagnose();
    assert.ok(Object.prototype.hasOwnProperty.call(a, 'storageFace'), '返回值必须带 storageFace 面');
    assert.deepEqual(Object.keys(a.storageFace).sort(), FACE_KEYS, '键面恒定（键面随路径变会让读者去猜）');
    const fake = { schemaFace: () => ({ state: 'current', version: 2, current: 2 }), migrationLedgerFace: () => ({ count: 0, unparsableAt: 0 }) };
    const b = DG.collectDiagnose(null, fake);
    assert.deepEqual(Object.keys(b).sort(), Object.keys(a).sort(), '传 storage 后返回值结构仍恒定');
    assert.deepEqual(Object.keys(b.storageFace).sort(), FACE_KEYS, '有 storage 时面键也恒定');
    assert.equal(b.storageFace.ok, true);
    assert.ok(b.storageFace.chat && b.storageFace.global, '两个分域都要在（合成一个读数就会把矛盾的档抹平）');
    assert.notEqual(b.storageFace.chat, b.storageFace.global, '两个分域是两份读数，不得是同一对象引用');
    assert.ok(DD_SRC.includes('本会话档 / 全局档'), '源码须写明为何分域');
});

test('v322 A2. ★★★ 四态 + 八种账本形态：current / legacy / future / unknown 逐态可达', async () => {
    const rows = [
        [undefined, 'unknown'],                        // 从未写过账本（absent）
        [{ version: 1, keys: {} }, 'legacy'],
        [{ version: 2, keys: {} }, 'current'],
        [{ version: 99, keys: {} }, 'future'],
        [{ keys: {} }, 'unknown'],                     // 无 version 字段
        ['not-an-object', 'unknown'],                  // 账本形状不对（corrupt）
        [{ version: 2, keys: ['a', 'b'] }, 'current'], // keys 坏了：版本仍可读
        [{ version: 0, keys: {} }, 'unknown']
    ];
    for (const [ledger, want] of rows) {
        const st = await freshStorage(ledger);
        const f = DG.collectDiagnose(null, st).storageFace;
        assert.equal(f.ok, true, '真 storage 下必须 ok：' + want);
        assert.equal(f.chat.schema.state, want, '★ 状态判定：' + JSON.stringify(ledger) + ' ⇒ ' + want);
        /* 未知状态必须带归因（absent / corrupt / 无版本），不能只说一句「无从判断」 */
        if (want === 'unknown') {
            const sc = f.chat.schema;
            assert.ok(sc.absent === true || sc.corrupt === true || sc.version === 0,
                'unknown 必须能归因（absent / corrupt / 无版本）');
        }
    }
    /* 缺失与损坏必须分开：两者处置方向相反（前者是正常旧档，后者是数据事故） */
    const fa = DG.collectDiagnose(null, await freshStorage(undefined)).storageFace.chat.schema;
    assert.equal(fa.absent, true, '★ 从未写过账本 ⇒ 如实 absent');
    assert.equal(fa.corrupt, false, '缺席不是损坏');
    const fb = DG.collectDiagnose(null, await freshStorage({ version: 2, keys: 'oops' })).storageFace.chat.schema;
    assert.equal(fb.corrupt, true, '★ 账本形状损坏须如实报 corrupt');
    assert.equal(fb.absent, false, '损坏不是缺席（压成一态就是错读数）');
    const fc = DG.collectDiagnose(null, await freshStorage({ version: 2, keys: {} })).storageFace.chat.schema;
    assert.equal(fc.corrupt, false, '干净账本不得报损坏');
});

test('v322 A3. ★★★ 迁移账本逐条读数：条数与「时间戳坏了」的计数如实，两本账各读自己的', async () => {
    const st = await freshStorage({ version: 2, keys: { a: '2026-01-01T00:00:00.000Z', b: 'not-a-date', c: 42 } });
    const f = DG.collectDiagnose(null, st).storageFace;
    assert.equal(f.chat.ledger.count, 3, '三条都要计');
    assert.equal(f.chat.ledger.unparsableAt, 2, '★ 时间戳坏掉的两条如实计数（不当 0 条、不丢弃）');
    assert.equal(f.chat.ledger.version, 2, '账本版本原样带出');
    assert.equal(f.chat.ledger.absent, false);
    /* 分域：本会话档的账本写在 chatMetadata，全局档写在 extensionSettings —— 两本不同的账。
     * 同一份账本只写在一侧时，另一侧必须是「空账」：合并成一个读数就分不清是哪本坏了。 */
    const gOnly = DG.collectDiagnose(null, await freshStorage({ version: 2, keys: { g: '2026-01-01T00:00:00.000Z' } }, 'global')).storageFace;
    assert.equal(gOnly.global.ledger.count, 1, '全局档读到写在自己那本的账');
    assert.equal(gOnly.chat.ledger.count, 0, '★ 本会话档读不到全局档的账');
    const cOnly = DG.collectDiagnose(null, await freshStorage({ version: 2, keys: { c: '2026-01-01T00:00:00.000Z' } }, 'chat')).storageFace;
    assert.equal(cOnly.chat.ledger.count, 1, '本会话档读到写在自己那本的账');
    assert.equal(cOnly.global.ledger.count, 0, '★ 全局档读不到本会话档的账');
});

test('v322 A4. ★★★ 零写入：看一眼存档不得改动存档（裁定不等于迁移）', async () => {
    const st = await freshStorage({ version: 1, keys: { old_key: '2026-01-01T00:00:00.000Z' } });
    const snap = () => JSON.stringify(st._getChatMetadataStore()) + JSON.stringify(st._getExtensionSettingsStore());
    const before = snap();
    for (let i = 0; i < 3; i += 1) DG.collectDiagnose(null, st);
    assert.equal(snap(), before, '★ 连续读三次后两个命名空间逐字不变（读路径上做写操作是「打开一下就改了数据」）');
    assert.equal(st._getChatMetadataStore().__corrupt_backup, undefined, '读不得顺手重建命名空间');
    assert.ok(DD_SRC.includes('不做任何判定与迁移'), '内核源码须写明这条纪律（只呈现）');
});

test('v322 A5. ★★ 文案与降级：未知状态原值透传；读不到说读不到，不说「正常」', () => {
    assert.equal(DG.schemaStateText('current'), '当前代');
    assert.equal(DG.schemaStateText('legacy'), '旧档（本方法只上报，不做迁移）');
    assert.equal(DG.schemaStateText('zzz'), 'zzz', '未知取值如实输出原值（不静默兜底成具体结论）');
    assert.equal(DG.schemaStateText(''), '未知');
    /* 读不到：三种归因各成一格，且不得出现「正常」这类绿灯结论 */
    for (const face of [null, { ok: false, reason: 'no-storage' }, { ok: false, reason: 'storage-absent' }]) {
        const line = DG.storageFaceLine(face);
        assert.ok(line.includes('读不到'), '读不到时如实说读不到：' + JSON.stringify(face));
        assert.equal(line.includes('正常'), false, '读不到不得报「正常」');
        assert.equal(line.includes('当前代'), false, '读不到不得报具体档位');
    }
    const okFace = { ok: true,
        chat: { ok: true, schema: { state: 'current', version: 2, current: 2 }, ledger: { count: 2, unparsableAt: 1 } },
        global: { ok: true, schema: { state: 'legacy', version: 1, current: 2 }, ledger: { count: 0, unparsableAt: 0 } } };
    const l = DG.storageFaceLine(okFace);
    assert.ok(l.includes('本会话档：当前代'), '本会话档逐字');
    assert.ok(l.includes('全局档：旧档'), '全局档逐字');
    assert.ok(l.includes('1 条时间戳坏了'), '坏时间戳在行里也可见');
    assert.ok(l.includes('／'), '两分域之间要有分隔');
});

test('v322 A6. ★★ 绝不外抛：storage 缺失 / 接口缺失 / 抛错一律降级', () => {
    let threw = false;
    try {
        DG.collectDiagnose(null, null);
        DG.collectDiagnose(null, {});
        DG.collectDiagnose(null, []);
        DG.collectDiagnose(null, { schemaFace: () => { throw new Error('boom'); } });
        DG.collectDiagnose(null, { schemaFace: () => ({ state: 'current' }), migrationLedgerFace: () => { throw new Error('boom'); } });
        DG.collectDiagnose(null, 'not-a-storage');
        DG.collectDiagnose(null, 42);
    } catch (_e) { threw = true; }
    assert.equal(threw, false, '垃圾 storage 不得让整页诊断失败（一个面坏不拖其余）');
    const f = DG.collectDiagnose(null, { schemaFace: () => { throw new Error('x'); }, migrationLedgerFace: () => ({ count: 0 }) }).storageFace;
    assert.equal(f.chat.ok, false, '★ 子面读不出时如实 ok:false（不是「空读数」）');
    assert.equal(typeof f.chat.reason, 'string');
    assert.ok('global' in f, '另一本账仍在面里（各自归因）');
});

/* ══════════ B 接线面 ══════════ */
test('v322 B1. ★★★ 卡片挂进 render：两个分域都列出，且读不到时不报正常', () => {
    assert.ok(DV_SRC.includes('_storageHtml(pkg) {'), '卡片方法在场');
    assert.ok(DV_SRC.includes('<h3>存档健康</h3>'), '卡片标题在 render 里');
    assert.ok(DV_SRC.includes('本会话档'), '本会话档一行');
    assert.ok(DV_SRC.includes('全局档'), '全局档一行');
    assert.ok(DV_SRC.includes('裁定不等于迁移'), '卡片上如实声明纪律');
    assert.ok(DV_SRC.includes('不代表存档有问题'), '读不到时不得让用户以为存档坏了');
    assert.ok(DV_SRC.includes('this._storageHtml(pkg)'), '须真接进 render');
    assert.ok(DV_SRC.includes('collectDiagnose(null, this.app && this.app.storage)'), '视图把 storage 传下去');
    /* 卡片只用既有 dg-* 类（无需新 CSS） */
    const css = read('apps/diagnose/diagnose.css');
    for (const cls of ['dg-row', 'dg-chip', 'dg-table', 'dg-sub', 'dg-note', 'dg-name', 'dg-bad']) {
        assert.ok(css.includes('.' + cls), '卡片用的类必须真在样式表里：' + cls);
    }
});

test('v322 B2. ★★★ 控制器两条路径都真传 storage（否则「宿主直接调 collect()」这条路永远读不到）', () => {
    const n = DA_SRC.split('collectDiagnose(null, this.storage)').length - 1;
    assert.ok(n >= 2, '★ 两条路径都要传（少传的那条会静默退化成「读不到」）；当前 ' + n + ' 处');
    assert.equal(DA_SRC.includes('collectDiagnose()'), false, '不得再有无参调用（会绕过 storage）');
    assert.ok(DA_SRC.includes('return collectDiagnose(null, this.storage)'), 'collect 那条路径');
    assert.ok(DA_SRC.includes('pkg || collectDiagnose(null, this.storage)'), 'silenceAlerts 那条路径');
});

/* ══════════ C 负控制（真源码破坏 → 破坏副本上重跑同款真判据） ══════════ */
const isAssertionFailure = (e) => e && e.name === 'AssertionError';

function withBrokenData(anchor, replacement, fn) {
    assert.equal(DD_SRC.split(anchor).length - 1, 1, '锚点须恰中 1 次：' + anchor.slice(0, 44));
    const dir = mkdtempSync(path.join(os.tmpdir(), 'v322-neg-'));
    (function copy(src, dst) {
        for (const e of readdirSync(src, { withFileTypes: true })) {
            if (['.git', 'node_modules', 'tests', 'assets'].includes(e.name)) continue;
            const sp = path.join(src, e.name), dp = path.join(dst, e.name);
            if (e.isDirectory()) { mkdirSync(dp, { recursive: true }); copy(sp, dp); }
            else if (e.name.endsWith('.js')) { try { writeFileSync(dp, readFileSync(sp, 'utf8')); } catch (_e) { /* 跳过读不出的文件 */ } }
        }
    })(ROOT, dir);
    const broken = DD_SRC.replace(anchor, replacement);
    assert.notEqual(broken, DD_SRC, '破坏必须真发生');
    writeFileSync(path.join(dir, 'apps', 'diagnose', 'diagnose-data.js'), broken);
    return import(pathToFileURL(path.join(dir, 'apps', 'diagnose', 'diagnose-data.js')).href + '?brk=' + Date.now()).then(fn);
}

test('v322 N1. ★★★ 破坏「storage 缺失 ⇒ ok:false」⇒ A1/A6 同款判据必须转红', async () => {
    await withBrokenData("        if (!storage) return { ok: false, reason: 'no-storage', chat: null, global: null };",
        "        if (!storage) return { ok: true, reason: 'ok', chat: null, global: null };", async (M) => {
        const f = M.collectDiagnose(null, null).storageFace;
        assert.throws(() => assert.equal(f.ok, false, '没 storage 必须如实 ok:false'), isAssertionFailure,
            'A1/A6 同款判据在破坏副本上必须抛');
        assert.equal(f.ok, true, '（破坏已生效：读不到被伪装成「读到了」）');
        assert.ok(M.storageFaceLine(f).includes('读不到'), '（行文案仍说读不到 —— 但对象面已经在说谎了）');
    });
});

test('v322 N2. ★★★ 破坏「时间戳坏了如实计数」⇒ A3 同款判据必须转红', async () => {
    await withBrokenData('                    unparsableAt: Number(l.unparsableAt) || 0,',
        '                    unparsableAt: 0,', async (M) => {
        const st = await freshStorage({ version: 2, keys: { a: 'not-a-date', b: 'also-bad' } });
        const f = M.collectDiagnose(null, st).storageFace;
        assert.throws(() => assert.equal(f.chat.ledger.unparsableAt, 2, '坏时间戳如实计数'), isAssertionFailure,
            'A3 同款判据在破坏副本上必须抛');
        assert.equal(f.chat.ledger.unparsableAt, 0, '（破坏已生效：坏条目被报成「没有坏的」）');
    });
});

test('v322 N3. ★★★ 破坏「两分域分开」⇒ A3 同款判据必须转红', async () => {
    await withBrokenData("        return { ok: true, reason: 'ok', chat: one(true), global: one(false) };",
        "        return { ok: true, reason: 'ok', chat: one(true), global: one(true) };", async (M) => {
        const st = await freshStorage({ version: 2, keys: { g: '2026-01-01T00:00:00.000Z' } }, 'global');
        const f = M.collectDiagnose(null, st).storageFace;
        /* 账本摆在全局档：真源下全局档读得到（count 1）、本会话档读不到（count 0）。
         * 破坏后 global 被改成 one(true)（读本会话档那本空账）⇒ 全局档读数消失。 */
        assert.throws(() => assert.equal(f.global.ledger.count, 1, '全局档读到写在自己那本的账'), isAssertionFailure,
            'A3 同款判据在破坏副本上必须抛');
        assert.equal(f.global.ledger.count, 0, '（破坏已生效：两本账被合并成一读数，全局档读到了空账）');
        assert.equal(f.chat.ledger.count, 0, '（两侧读数一致 —— 分域已消失）');
    });
});

/* ══════════ D 版本锚 ══════════ */
test('v322 D1. ★ 本套件只在 3.5.1 及以后成立', () => {
    const idx = read('index.js');
    const line = idx.split(NL).find((x) => x.startsWith('const ST_PHONE_VERSION')) || '';
    const ver = line.split(String.fromCharCode(39))[1];
    assert.ok(ver, '入口版本常量在场');
    const [maj, min, pat] = ver.split('.').map(Number);
    assert.ok(maj > 3 || (maj === 3 && (min > 5 || (min === 5 && pat >= 1))), '本套件只在 3.5.1 及以后成立；当前 ' + ver);
    assert.equal(JSON.parse(read('manifest.json')).version, ver, 'manifest 同源');
    assert.equal(JSON.parse(read('update-log.json')).latest, ver, 'update-log.latest 同源');
});
