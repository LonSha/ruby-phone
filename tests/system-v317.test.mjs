/**
 * tests/system-v317.test.mjs — 存储代际裁定面 + 迁移账本逐条读取 + 迁移点登记台账 [v3.4.0 · P-4]
 *
 * 背景与**实测纠正**（重要，避免后人照抄错计划）：
 *   TODO 里挂着一条「本仓存储层目前没有 schema 版本号……需要时先加一个 storage_schema_v1 版本戳」。
 *   本版开工前实测发现**该记载已过期**：`STORAGE_SCHEMA_VERSION = 2` 自 v2.89.0 起就在
 *   （`config/storage.js:37`），且已被写进迁移账本（`_writeMigrationLedger` 的 `version` 字段）。
 *   但真缺口仍在，而且更难看见：**版本被写入、从不被裁定** ——
 *   全仓 `grep -rn 'ledger.version'` **零命中**，于是：
 *     · 「这份存档是旧档 / 当档 / 更新版插件写的档」在机制上无从回答，一律静默按当前口径读；
 *     · 读取路径上「版本落后」这件事**没有任何出口**。
 *   这不是「缺一个常量」（常量早就在），而是**缺一个把常量变成结论的地方**。
 *
 * 同族第二处（本轮一并收）：`_readMigrationLedger` 把「账本缺失」「账本损坏」「账本抛错」
 *   压成同一个 `{ version: 0, keys: {} }` —— 又是「三态塌成两态」。两者处置方向相反：
 *   前者是正常旧档，后者是数据事故（后者还暗示「读得到但形状不对」）。
 *
 * 本版口径（与上游 T9「旧档迁移默认不执行」同族）：**裁定不等于迁移**。
 *   schemaFace 只回答「它是哪个时代」；迁移必须由调用方显式发起。
 *   读取路径上顺手做破坏性写操作，是所有「打开一下就改了数据」事故的同一个形状 —— 故立成判据。
 *
 * 覆盖：
 *   A 源码面与三态分面（absent/corrupt 不再塌）
 *   B 行为面（真宿主 + 真源码）：四态 × 八种账本形态矩阵 + 裁定不写 + 逐条读取
 *   C 迁移点登记台账（散点统一登记；登记项存活；未登记即红）
 *   D 负控制（真源码破坏 → 在破坏副本上重跑同款真判据必须转红）
 *   E 版本锚（五源同源）
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { installRuntimeHost, resetHostFlags } from './_runtime_host.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const STORAGE_SRC = read('config/storage.js');
const LEDGER_TSV = 'tests/audit/migration_points.tsv';

/** 真源码加载（去掉 export 前缀后落盘成模块；不手抄） */
async function loadStorage(mutator) {
    let src = STORAGE_SRC.replace(/^export\s+class\s+/m, 'class ') + '\nexport { PhoneStorage };\n';
    if (typeof mutator === 'function') src = mutator(src);
    const dir = mkdtempSync(path.join(os.tmpdir(), 'v317-storage-'));
    const file = path.join(dir, 'storage_mod.mjs');
    writeFileSync(file, src);
    const mod = await import('file://' + file);
    return mod.PhoneStorage;
}

/** 装宿主 + 造实例。ledger === undefined 表示「命名空间里根本没有账本」 */
async function freshStorage(ledger, mutate) {
    resetHostFlags();
    const cm = (ledger === undefined) ? {} : { st_virtual_phone: { __migration_ledger: ledger } };
    installRuntimeHost({ chatMetadata: cm, settings: {} });
    const PS = await (mutate ? loadStorage(mutate) : loadStorage());
    return new PS();
}

/* ══════════════ 共用判据体（A/B 与 D 负控制跑的是**同一份**代码，杜绝判据复制后漂移） ══════════════ */

/** A1 判据体：两个入口存在 + 三态不塌 + 兜底形状不变。破坏后必须抛。 */
function assertTriStateNotCollapsed(src) {
    assert.match(src, /schemaFace\s*\(\s*isChatData\s*=\s*false\s*\)/, 'schemaFace 定义');
    assert.match(src, /migrationLedgerFace\s*\(\s*isChatData\s*=\s*false\s*\)/, 'migrationLedgerFace 定义');
    /* 三态分面：三个返回分支必须各自不同形（缺失 / 形状错 / 抛错） */
    assert.match(src, /absent:\s*true,\s*corrupt:\s*false/, '缺失分支如实 absent');
    assert.match(src, /absent:\s*false,\s*corrupt:\s*true/, '损坏分支如实 corrupt');
    /* 旧的两个字段兜底值不得被改动（既有消费者只读它们） */
    assert.match(src, /if\s*\(!raw\)\s*return\s*\{\s*version:\s*0,\s*keys:\s*\{\}/, 'version/keys 兜底形状不变');
}

/** A2 判据体：schemaFace 内不得出现任何写操作。破坏后必须抛。 */
function assertSchemaFaceIsReadOnly(src) {
    const at = src.indexOf('schemaFace(isChatData = false) {');
    assert.ok(at > 0, 'schemaFace 定位');
    const block = src.slice(at, src.indexOf('migrationLedgerFace', at));
    for (const bad of ['_writeMigrationLedger', '_migrateToNewArchitecture', 'store[', '.set(', 'removeItem', 'saveChat', '_queuedSaveExtensionSettings']) {
        assert.equal(block.includes(bad), false, 'schemaFace 不得出现写操作：' + bad);
    }
    assert.match(block, /_readMigrationLedger\s*\(/, '只走读路径');
}

/** B1 判据体：四态 × 八形态矩阵（入参是 MATRIX 的一整行）。破坏后必须抛。 */
function assertMatrix(st, row) {
    const [label, , wantState, wantAbsent, wantCorrupt] = row;
    const f = st.schemaFace(true);
    assert.equal(f.state, wantState, label + ' ⇒ state');
    assert.equal(f.absent, wantAbsent, label + ' ⇒ absent');
    assert.equal(f.corrupt, wantCorrupt, label + ' ⇒ corrupt');
    assert.equal(f.current, 2, label + ' ⇒ current 恒为当版常量');
    /* 非数字 version 一律如实 0，不得拿 NaN 冒充读数 */
    assert.ok(Number.isFinite(f.version), label + ' ⇒ version 必须是有限数');
}

/** B2 判据体：读 N 次后账本逐字节不变。破坏后必须抛。 */
function assertLedgerUntouched(st, times = 10) {
    const before = JSON.stringify(st._getChatMetadataStore());
    for (let i = 0; i < times; i++) { st.schemaFace(true); st.migrationLedgerFace(true); }
    assert.equal(JSON.stringify(st._getChatMetadataStore()), before, '裁定/读取都不得改写账本');
}

/* ══════════════ A 源码面 ══════════════ */
test('v317 A1. ★★ 两个入口存在，且三态不再塌成两态（absent / corrupt 各自成字段）', () => {
    assertTriStateNotCollapsed(STORAGE_SRC);
});

test('v317 A2. ★★★ 裁定不等于迁移：schemaFace 内不得出现任何写操作', () => {
    assertSchemaFaceIsReadOnly(STORAGE_SRC);
});

/* ══════════════ B 行为面（真宿主 + 真源码） ══════════════ */
const MATRIX = [
    ['账本从未写过', undefined, 'unknown', true, false],
    ['version=1（旧档）', { version: 1, keys: {} }, 'legacy', false, false],
    ['version=2（当前代）', { version: 2, keys: {} }, 'current', false, false],
    ['version=99（未来档）', { version: 99, keys: {} }, 'future', false, false],
    ['账本是字符串', 'oops', 'unknown', false, true],
    ['账本是数组', [1, 2], 'unknown', false, true],
    ['version 非数字', { version: 'x', keys: {} }, 'unknown', false, false],
    ['keys 形状错', { version: 2, keys: 'nope' }, 'current', false, true],
];

test('v317 B1. ★★★ 四态 × 八种账本形态矩阵（含 absent / corrupt 细分）', async () => {
    for (const row of MATRIX) {
        const st = await freshStorage(row[1]);
        /* 与 D1 负控制跑的是同一份判据体（不得在此复制一份） */
        assertMatrix(st, row);
        assert.equal(st.schemaFace(true).state, row[2], row[0] + ' ⇒ state（显式复核）');
    }
});

test('v317 B2. ★★★ 裁定不写：读一次与读十次，账本逐字节不变', async () => {
    const st = await freshStorage({ version: 1, keys: { a: '2020-01-01T00:00:00.000Z' } });
    assertLedgerUntouched(st, 10);
});

test('v317 B3. ★★ 逐条读取面：坏时间戳如实计数，不当 0 条也不丢弃', async () => {
    const st = await freshStorage({ version: 2, keys: { b: '2020-01-01T00:00:00.000Z', a: 'not-a-date', c: 123 } });
    const lf = st.migrationLedgerFace(true);
    assert.equal(lf.count, 3, '三条都要在');
    assert.equal(lf.unparsableAt, 2, '两条坏时间戳如实计数');
    assert.deepEqual(lf.entries.map((e) => e.key), ['a', 'b', 'c'], '逐条按 key 稳定排序');
    assert.deepEqual(lf.entries.map((e) => e.atValid), [false, true, false], '逐条判定');
});

test('v317 B4. ★★ 缺账本时逐条面为空且如实说明（不抛）', async () => {
    const st = await freshStorage(undefined);
    const lf = st.migrationLedgerFace(true);
    assert.equal(lf.count, 0);
    assert.equal(lf.absent, true, '如实报「从没写过」');
    assert.deepEqual(lf.entries, []);
});

test('v317 B5. ★★ 全局档与聊天档各自持账（互不串读）', async () => {
    resetHostFlags();
    const host = installRuntimeHost({ chatMetadata: { st_virtual_phone: { __migration_ledger: { version: 1, keys: {} } } } });
    /* 夹具的 extensionSettings 是硬编码最小面（`opts.settings` 不接线到它），
     * 故直接向命名空间注入 —— 这一点本身也值得记下：夹具的 settings 入参是**装饰性**的，
     * 照它写判据会得到「读不到全局账本」的假红（本节首版即栽在这里）。 */
    host.context.extensionSettings.st_virtual_phone.__migration_ledger = { version: 2, keys: {} };
    const PS = await loadStorage();
    const st = new PS();
    assert.equal(st.schemaFace(true).state, 'legacy', '聊天档读聊天账本');
    assert.equal(st.schemaFace(false).state, 'current', '全局档读全局账本');
});

/* ══════════════ C 迁移点登记台账 ══════════════ */
test('v317 C1. ★★★ 散状迁移点必须登记；登记项必须仍存活', () => {
    assert.ok(existsSync(path.join(ROOT, LEDGER_TSV)), '台账必须存在：' + LEDGER_TSV);
    const lines = read(LEDGER_TSV).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    assert.ok(lines.length >= 4, '登记项至少 4 条（本轮实测），实得 ' + lines.length);
    for (const l of lines) {
        const [file, anchor, kind, note] = l.split('\t');
        assert.ok(file && anchor && kind && note, '每条须含 文件/锚点/类型/说明：' + l);
        assert.ok(existsSync(path.join(ROOT, file)), '登记文件必须存在：' + file);
        const src = read(file);
        assert.ok(src.includes(anchor),
            '★ 锚点必须仍存活（迁移点被删/改名后本条即红，防止台账长霉）：' + file + ' :: ' + anchor);
        assert.ok(note.length >= 8, '说明不得是空话：' + l);
    }
});

test('v317 C2. ★★ 本版新增的两个出口自身也必须登记（不许自称「统一台账」却把自己漏掉）', () => {
    const t = read(LEDGER_TSV);
    assert.ok(t.includes('STORAGE_SCHEMA_VERSION'), '须登记统一版本常量（v2.89.0 引入）');
    assert.ok(t.includes('__migration_ledger'), '须登记统一迁移账本键');
    const types = new Set(read(LEDGER_TSV).split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t')[2]));
    assert.ok(types.has('统一'), '须有「统一」类（storage 层两件）');
    assert.ok(types.has('局部'), '须有「局部」类（各 App 自持迁移）');
});

/* ══════════════ D 负控制（真源码破坏 → 破坏副本上重跑**同款真判据**） ══════════════
 * 纪律：负控制不得「自己另写一份简化判据」—— 那样它验证的是简化判据，不是产品判据。
 *   故本节一律调用 A/B 段的判据体（assertTriStateNotCollapsed / assertSchemaFaceIsReadOnly /
 *   assertMatrix / assertLedgerUntouched），并断言抛出的是 **AssertionError**：
 *   若抛的是别的异常（多半是破坏把副本改坏成加载不了），那属于「无效破坏」，不能算负控制成立。
 */
const isAssertionFailure = (e) => e && e.name === 'AssertionError';

test('v317 D1. ★★★ 破坏「四态裁定」（future 并进 current）⇒ B1 同款判据必须转红', async () => {
    const anchor = "        else if (ver > current) state = 'future';";
    assert.equal(STORAGE_SRC.split(anchor).length - 1, 1, '锚点须恰中 1 次');
    const broken = (s) => {
        const out = s.replace(anchor, "        else if (ver > current) state = 'current';");
        assert.notEqual(out, s, '破坏必须真发生');
        return out;
    };
    /* 破坏副本必须仍可加载（否则「红了」不说明判据有效） */
    const st = await freshStorage({ version: 99, keys: {} }, broken);
    assert.equal(st.schemaFace(true).state, 'current', '（先确认破坏已生效：99 被判成了 current）');
    const row = MATRIX.find((r) => r[0].startsWith('version=99'));
    assert.throws(() => assertMatrix(st, row), isAssertionFailure,
        'B1 同款判据在破坏副本上必须抛 AssertionError');
});

test('v317 D2. ★★★ 破坏「三态分面」（corrupt 并入 absent）⇒ A1 同款判据必须转红', async () => {
    const anchor = 'if (!raw) return { version: 0, keys: {}, absent: true, corrupt: false };';
    assert.equal(STORAGE_SRC.split(anchor).length - 1, 1, '锚点须恰中 1 次');
    const bsrc = STORAGE_SRC.replace(anchor,
        'if (!raw) return { version: 0, keys: {}, absent: true, corrupt: true };');
    assert.notEqual(bsrc, STORAGE_SRC, '破坏必须真发生');
    assert.throws(() => assertTriStateNotCollapsed(bsrc), isAssertionFailure,
        'A1 同款判据在破坏源码上必须抛 AssertionError（「缺失」不再能自证不 corrupt）');
});

test('v317 D3. ★★★ 破坏「裁定不写」（让 schemaFace 顺手迁移）⇒ A2 与 B2 同款判据必须转红', async () => {
    const anchor = '    schemaFace(isChatData = false) {\n        const ledger = this._readMigrationLedger(isChatData);';
    assert.equal(STORAGE_SRC.split(anchor).length - 1, 1, '锚点须恰中 1 次');
    const broken = (s) => {
        const out = s.replace(anchor,
            '    schemaFace(isChatData = false) {\n        const ledger = this._readMigrationLedger(isChatData);\n        this._writeMigrationLedger(isChatData, ledger);');
        assert.notEqual(out, s, '破坏必须真发生');
        return out;
    };
    /* A2 同款判据（源码面） */
    assert.throws(() => assertSchemaFaceIsReadOnly(broken(STORAGE_SRC)), isAssertionFailure,
        'A2 同款判据必须抛（写操作已进入 schemaFace）');
    /* B2 同款判据（行为面）：账本被顺手改写 ⇒ 「逐字节不变」必须不成立 */
    const st = await freshStorage({ version: 1, keys: { a: '2020-01-01T00:00:00.000Z' } }, broken);
    assert.throws(() => assertLedgerUntouched(st, 1), isAssertionFailure,
        'B2 同款判据必须抛（破坏后裁定确实写了账本）');
});

/* ══════════════ E 版本锚 ══════════════ */
test('v317 E1. ★ 版本五源同源（入口 / manifest / package / update-log.latest / versions 首键）', () => {
    const idx = read('index.js');
    const ver = (/const ST_PHONE_VERSION = '([^']+)'/.exec(idx) || [])[1];
    assert.ok(ver, '入口版本常量在场');
    assert.equal(JSON.parse(read('manifest.json')).version, ver, 'manifest 同源');
    assert.equal(JSON.parse(read('package.json')).version, ver, 'package 同源');
    const ul = JSON.parse(read('update-log.json'));
    assert.equal(ul.latest, ver, 'update-log.latest 同源');
    assert.equal(Object.keys(ul.versions)[0], ver, '★ versions 首键即当前版本（插首键，不是追加末尾）');
    assert.ok(Object.prototype.hasOwnProperty.call(ul.versions, ver), '当版条目在场');
});