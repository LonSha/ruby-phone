/** R-X7: A structure / A2 purity / B behavior / C real adapters / D mutants / E version. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as BK from '../config/data-backup.js';
import * as PP from '../config/portable-payload.js';
import { BackupdeskView } from '../apps/backupdesk/backupdesk-view.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const IDX = read('index.js');
const APP = read('apps/backupdesk/backupdesk-app.js');
const KERNEL = 'config/data-backup.js';
const MAN = JSON.parse(read('manifest.json'));

const pack = () => BK.buildBackupPack({
    hostVersion: 'x', at: 7, source: 'local', packChatId: 'c1', packBranchKey: 'main',
    entries: [
        { key: 'wechat_data', scope: 'chat', app: 'wechat', chatId: 'c1', branchKey: 'main', sensitive: true, value: { a: 1 } },
        { key: 'sys_shell_scale', scope: 'global', sensitive: false, value: 1 },
    ],
});

function judgeIdem(m) {
    const p = pack();
    const local = p.entries.map((e) => ({ key: e.key, scope: e.scope, value: e.value }));
    const plan = m.planBackupImport(p, local, {});
    if (plan.totals.identical !== 2) return { ok: false, why: '同值重导应全 identical，实际 ' + plan.totals.identical };
    const c = m.commitBackupPlan(plan, {});
    if (c.counts.writes !== 0) return { ok: false, why: '重复导入产生了写入：' + c.counts.writes };
    return { ok: true };
}
function judgeOldRefusedOrMigrated(m) {
    const bad = m.migrateBackupPack({ mark: m.BACKUP_MARK, schemaVersion: null }, 3);
    if (bad.state !== m.BACKUP_MIGRATE_STATES.TOO_OLD) return { ok: false, why: '无版本号的包没被拒：' + bad.state };
    if (bad.pack !== null) return { ok: false, why: '拒了却给了包体' };
    const fut = m.migrateBackupPack({ mark: m.BACKUP_MARK, schemaVersion: 99 }, 3);
    if (fut.state !== m.BACKUP_MIGRATE_STATES.FUTURE) return { ok: false, why: '未来包没被拒：' + fut.state };
    const ok = m.migrateBackupPack({ mark: m.BACKUP_MARK, schemaVersion: 1, entries: [{ key: 'k', value: 1 }] }, 3);
    if (ok.state !== m.BACKUP_MIGRATE_STATES.MIGRATED) return { ok: false, why: 'v1 包没被迁移：' + ok.state };
    return { ok: true };
}
function judgeScopeNoSwap(m) {
    const p = pack();
    const plan = m.planBackupImport(p, [], {});
    const c = m.commitBackupPlan(plan, { targetScope: 'global' });
    if (c.writes.some((w) => w.scope === 'chat')) return { ok: false, why: '目标全局面却写了会话面条目（分面互换）' };
    return { ok: true };
}
function judgeConflictKeepsLocal(m) {
    const p = pack();
    const local = [{ key: 'wechat_data', scope: 'chat', value: { a: 2 } }];
    const plan = m.planBackupImport(p, local, {});
    if (plan.totals.conflict !== 1) return { ok: false, why: '值不同没记冲突：' + plan.totals.conflict };
    const c = m.commitBackupPlan(plan, {});
    if (c.writes.some((w) => w.key === 'wechat_data')) return { ok: false, why: '冲突默认竟写了（应保留本机）' };
    return { ok: true };
}
function judgeBranchBarrier(m) {
    const p = m.buildBackupPack({ packChatId: 'c1', packBranchKey: 'other', entries: [{ key: 'k1', scope: 'chat', branchKey: 'side', value: 1 }] });
    const plan = m.planBackupImport(p, [], {});
    if (plan.totals.rejected !== 1) return { ok: false, why: '分支不符未被拒：' + plan.totals.rejected };
    const mismatch = m.buildBackupPack({ packChatId: 'c1', packBranchKey: 'main', entries: [{ key: 'k2', scope: 'chat', branchKey: 'side', value: 1 }] });
    const optIn = m.planBackupImport(mismatch, [], { allowBranchMismatch: true });
    const c = m.commitBackupPlan(optIn, { targetBranch: 'zzz' });
    if (c.writes.some((w) => w.scope === 'chat' && w.key === 'k2')) return { ok: false, why: '目标分支不符却写了' };
    return { ok: true };
}
function judgeSelectionIntersect(m) {
    if (!m.backupEntrySelected({ app: 'wechat', chatId: 'c1' }, { app: ['wechat', 'weibo'], chat: ['c1'] })) return { ok: false, why: '两维都命中应被选中' };
    if (m.backupEntrySelected({ app: 'weibo', chatId: 'c2' }, { app: ['wechat', 'weibo'], chat: ['c1'] })) return { ok: false, why: '四维必须取交集（并集会把其他会话也带上）' };
    return { ok: true };
}
function judgeUndoOnlyThisRun(m) {
    const c = { writes: [{ key: 'a', scope: 'chat', kind: 'new' }, { key: 'b', scope: 'global', kind: 'conflict-overwrite' }] };
    const u = m.undoBackupPlan(c);
    if (u.count !== 2) return { ok: false, why: '撤销应列 2 项：' + u.count };
    if (u.undo[0].key !== 'b') return { ok: false, why: '撤销必须逆序' };
    if (m.undoBackupPlan({ writes: [] }).count !== 0) return { ok: false, why: '无写入竟有可撤项' };
    return { ok: true };
}
function judgeForeignRefused(m) {
    const r = m.readBackupPack({ mark: 'someone-else-pack', schemaVersion: 1 });
    if (r.accepted !== false) return { ok: false, why: '异类魔标包被收下了' };
    const u = m.readBackupPack({ entries: [] });
    if (u.state !== m.BACKUP_PACK_STATES.UNMARKED) return { ok: false, why: '无魔标应记 unmarked（兼容面）：' + u.state };
    return { ok: true };
}

/* D 组 */
const NEG_SUFFIX = '.__neg__.js';
const madeFiles = [];
function anchorOnce(s, a) {
    assert.equal(s.split(a).length - 1, 1, '负控制锚点字面量必须恰中 1 次：' + JSON.stringify(a.slice(0, 50)));
    return a;
}
let NEG_SEQ = 0;
async function negCopy(rel, mutate) {
    const srcAbs = path.join(ROOT, rel);
    const seq = (NEG_SEQ += 1);
    const dstAbs = path.join(ROOT, rel.replace(/\.js$/, '.' + seq + NEG_SUFFIX));
    const src = fs.readFileSync(srcAbs, 'utf8');
    const next = mutate(src);
    assert.notEqual(next, src, '破坏没有真正发生（锚点未命中）：' + rel);
    fs.writeFileSync(dstAbs, next);
    madeFiles.push(dstAbs);
    const back = fs.readFileSync(dstAbs, 'utf8');
    assert.equal(back, next, '破坏副本必须逐字等于刚写的内容');
    return { mod: await import(pathToFileURL(dstAbs).href + '?neg=' + seq + '-' + Date.now()), file: dstAbs, src: back };
}
process.on('exit', () => {
    for (const f of madeFiles) { try { fs.rmSync(f); } catch (_e) { /* 忽略 */ } }
});
function callJudge(fn, m) {
    try { return fn(m); } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
}
const isRed = (r) => !(r && r.ok === true);

/* A */

test('v3910 A1 structure: four dims, two scopes, migration table, key registry and registration', () => {
    assert.equal(BK.BACKUP_DIM_KEYS.length, 4, '范围必须四维');
    assert.equal(BK.BACKUP_SCOPE_KEYS.length, 2, '分面必须两个');
    assert.ok(BK.BACKUP_MIGRATIONS.length >= 2, '迁移表至少两步');
    assert.deepEqual(BK.backupSelfCheck().problems, [], '内核自检必须为空');
    assert.ok(/\^backup_/.test(read('config/storage.js')), 'backup_ 前缀必须进会话数据域');
    assert.ok(read('scripts/keys-audit.mjs').indexOf("key: 'backup_ledger'") >= 0, '台账键必须登记');
    assert.ok(read('config/apps.js').indexOf("id: 'backupdesk'") >= 0, 'APPS 必须登记');
    assert.ok(read('config/app-lazy-routes.js').indexOf('backupdeskApp') >= 0, '懒加载路由必须登记');
    assert.ok(read('config/app-consumption-matrix.js').indexOf('"backupdesk"') >= 0, '消费矩阵必须登记');
    assert.ok(read('config/storage.js').indexOf('enumerateKeys()') >= 0, '存储层必须有只读键枚举口');
    assert.ok(IDX.indexOf('refreshBackup') >= 0 && IDX.indexOf('applyBackupAction') >= 0, '咽喉必须有取数口与动作口');
    assert.ok(read('apps/diagnose/diagnose-data.js').indexOf('backupFace') >= 0, '诊断面必须有消费口');
    /* ★ 目录 / 文件名 / 类名 / 槽位名四一致（全仓约定：apps/<dir>/<dir>-{app,view}.js + <Dir>App + <dir>App）。
     *   修前形态（本版全量 npm test 首跑暴露，与 R-X6 同族）：本 App 用了别名文件名
     *   （backup-app.js / BackupApp / backupApp），audit.test.mjs 的通用约定当场判红。
     *   这条不是「命名洁癖」：约定被打破时，凡按 <dir>-app.js 派生路径的判据（v3270/v3550/
     *   v3590/v3650 与 audit 通用面）都会**静默漏过**这个 App —— 它从判据的枚举面里消失，
     *   而没有任何一处报错。 */
    for (const rel of ['apps/backupdesk/backupdesk-app.js', 'apps/backupdesk/backupdesk-view.js']) {
        assert.ok(fs.existsSync(path.join(ROOT, rel)), '四一致：' + rel + ' 必须存在');
    }
    assert.ok(!fs.existsSync(path.join(ROOT, 'apps/backupdesk/backup-app.js')), '别名文件不得留下');
    assert.ok(APP.indexOf('export class BackupdeskApp') >= 0, '类名必须由目录名派生（<Dir>App）');
    assert.ok(read('config/app-lazy-routes.js').indexOf('key: "backupdeskApp"') >= 0, '槽位名必须由目录名派生');
    /* ★ 进 REBIND 表。同族缺陷有先例（v3.48.0 补登记）：App 实现了 onChatChanged、
     *   v255 的 dirMap 也登记了，**唯独没进 ST_PHONE_REBIND_APP_KEYS** ⇒ 换会话只换 storage，
     *   实例态（四维勾选）原样留着 —— 不报错、只错结果。 */
    const tbl = (IDX.match(/ST_PHONE_REBIND_APP_KEYS = \[([\s\S]*?)\];/) || [])[1] || '';
    assert.ok(tbl.indexOf("'backupdeskApp'") >= 0, '备份恢复必须进 REBIND 表（换会话丢实例态）');
    assert.ok(/\n\s*onChatChanged\s*\(/.test(APP), 'App 必须实现 onChatChanged');
});

test('v3910 A2 pure kernel, no network, and a data-only view with four actions', () => {
    /* 剥注释后判（注释里提一嘴「没有 fetch」不算出现）—— 本仓旧病：注释里的名字被当成代码。 */
    const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    const src = strip(read(KERNEL));
    for (const bad of ['localStorage', 'sessionStorage', 'document.', 'setTimeout', 'setInterval', 'new Date(', 'window.', 'VirtualPhone', 'fetch(', 'XMLHttpRequest']) {
        assert.equal(src.indexOf(bad) >= 0, false, '纯内核不得出现 ' + bad);
    }
    const view = read('apps/backupdesk/backupdesk-view.js');
    for (const bad of ['storage.', 'localStorage', 'eval(', 'new Function', 'srcdoc', 'iframe', 'fetch(']) {
        assert.equal(view.indexOf(bad) >= 0, false, '视图不得出现 ' + bad);
    }
    const acts = [];
    const re = /data-bk-act="?(\w+)"?/g;
    let m;
    while ((m = re.exec(view)) !== null) acts.push(m[1]);
    assert.deepEqual(Array.from(new Set(acts)).sort(), ['commit', 'export', 'preview', 'undo'], '动作白名单必须恰好四个');
});

/* B */

test('v3910 B1 pack identity: mark, schema, host version, chat and branch range, per-key sensitivity', () => {
    const p = pack();
    assert.equal(p.mark, BK.BACKUP_MARK);
    assert.equal(p.schemaVersion, BK.BACKUP_SCHEMA_VERSION);
    assert.equal(p.hostVersion, 'x', '宿主版本必须进包体身份');
    assert.equal(p.packChatId, 'c1');
    assert.equal(p.packBranchKey, 'main');
    assert.equal(p.counts.chat, 1);
    assert.equal(p.counts.global, 1);
    assert.equal(p.counts.sensitive, 1, '敏感键必须逐键标记并计数');
    assert.ok(BK.backupPackLine(p).indexOf('不上传云端') >= 0, '一行读数必须写明不上传云端');
});

test('v3910 B2 five pack states and five entry states are distinct', () => {
    assert.equal(BK.readBackupPack(null).state, BK.BACKUP_PACK_STATES.EMPTY);
    assert.equal(BK.readBackupPack([]).state, BK.BACKUP_PACK_STATES.NOT_OBJECT);
    assert.equal(BK.readBackupPack({ entries: [] }).state, BK.BACKUP_PACK_STATES.UNMARKED);
    assert.equal(BK.readBackupPack({ mark: 'x' }).state, BK.BACKUP_PACK_STATES.FOREIGN);
    assert.equal(BK.readBackupPack({ mark: BK.BACKUP_MARK, schemaVersion: 99 }).state, BK.BACKUP_PACK_STATES.FUTURE);
    assert.equal(BK.readBackupPack(pack()).state, BK.BACKUP_PACK_STATES.OK);
    const states = Object.keys(BK.BACKUP_ENTRY_STATES).map((k) => BK.BACKUP_ENTRY_STATES[k]);
    assert.equal(new Set(states).size, states.length, '五态必须互不同值');
    const plan = BK.planBackupImport(pack(), [], { tombstones: ['chat' + String.fromCharCode(0) + 'wechat_data'] });
    assert.equal(plan.totals.restore, 1, '墓碑命中必须记 restore（与 new 分开）');
    assert.equal(plan.totals.new, 1);
});

test('v3910 B3 four blocker judges: idempotence, migration, scope, conflict', () => {
    const cases = [['idem', judgeIdem], ['migrate', judgeOldRefusedOrMigrated], ['scope', judgeScopeNoSwap], ['conflict', judgeConflictKeepsLocal]];
    for (const pair of cases) {
        const r = pair[1](BK);
        assert.equal(r.ok, true, pair[0] + '：' + r.why);
    }
});

test('v3910 B4 branch barrier and range intersection', () => {
    const r1 = judgeBranchBarrier(BK); assert.equal(r1.ok, true, r1.why);
    const r2 = judgeSelectionIntersect(BK); assert.equal(r2.ok, true, r2.why);
    const r3 = judgeForeignRefused(BK); assert.equal(r3.ok, true, r3.why);
});

test('v3910 B5 undo lists only this run writes, in reverse order', () => {
    const r = judgeUndoOnlyThisRun(BK); assert.equal(r.ok, true, r.why);
    const p = pack();
    const plan = BK.planBackupImport(p, [], {});
    const c = BK.commitBackupPlan(plan, {});
    const u = BK.undoBackupPlan(c);
    assert.equal(u.count, c.counts.writes, '撤销项数必须等于本次写入数');
    assert.equal(u.undo[0].key, c.writes[c.writes.length - 1].key, '必须逆序');
});

test('v3910 B6 import never touches existing data before commit', () => {
    const p = pack();
    const local = [{ key: 'wechat_data', scope: 'chat', value: { a: 2 } }, { key: 'sys_shell_scale', scope: 'global', value: 1 }];
    const snapshot = JSON.stringify(local);
    BK.planBackupImport(p, local, {});
    assert.equal(JSON.stringify(local), snapshot, '产计划不得改动存量（连对象都不许碰）');
});

test('v3910 B7 identical entries are neither written nor skipped', () => {
    const p = pack();
    const local = p.entries.map((e) => ({ key: e.key, scope: e.scope, value: e.value }));
    const c = BK.commitBackupPlan(BK.planBackupImport(p, local, {}), {});
    assert.equal(c.counts.writes, 0);
    assert.equal(c.counts.skipped, 0, '逐字相同既不是写也不是跳');
    assert.equal(c.counts.untouched, 2);
});

test('v3910 B8 unmarked packs are accepted but must migrate with a reason per hop', () => {
    const r = BK.readBackupPack({ schemaVersion: 1, entries: [{ key: 'k', value: 1 }] });
    assert.equal(r.accepted, true, '无魔标的旧包按兼容面收下');
    const mig = BK.migrateBackupPack(r.pack, BK.BACKUP_SCHEMA_VERSION);
    assert.equal(mig.state, BK.BACKUP_MIGRATE_STATES.MIGRATED);
    assert.ok(mig.steps.length >= 1);
    assert.ok(mig.steps.every((s) => !!s.why), '每一跳必须带为什么');
});

/* C */

test('v3910 C1 backup compares strictly while the existing portable payload normalizes', () => {
    assert.equal(typeof PP.canonicalKeyOf, 'function');
    const a = { name: 'A', id: '1' };
    const b = { name: 'a', id: '2' };
    assert.equal(PP.canonicalKeyOf(a), PP.canonicalKeyOf(b), '既有指纹忽略 id 并对字符串归一');
    assert.equal(BK.backupValueKey(a) === BK.backupValueKey(b), false, '备份值指纹不做归一（比一模一样）');
});

test('v3910 C2 host action gate order: scope, epoch, whitelist; storage written only at the throat', () => {
    const i = IDX.indexOf('function applyBackupAction');
    const seg = IDX.slice(i, i + 6000);
    assert.ok(seg.indexOf('wfSameScope') >= 0 && seg.indexOf('stale-scope') >= 0, '必须先判会话');
    assert.ok(seg.indexOf('handoffEpoch') >= 0 && seg.indexOf('stale-epoch') >= 0, '必须判世代');
    assert.ok(seg.indexOf('BACKUP_ACTION_KEYS.indexOf(action)') >= 0, '必须判动作白名单');
    assert.equal(APP.indexOf('storage.set'), -1, 'App 不得自己写存储（写入只在咽喉）');
    assert.ok(IDX.indexOf('storage.set(String(w.key), w.value)') >= 0, '咽喉必须在 commit 分支逐条写');
    assert.ok(seg.indexOf('回读不一致') >= 0, '必须做写后回读');
});

/* D */

test('v3910 D1. identical entries become writes => idem judge must go red', async () => {
    const n = await negCopy(KERNEL, (s) => s.replace(
        anchorOnce(s, "        if (r.state === BACKUP_ENTRY_STATES.NEW || r.state === BACKUP_ENTRY_STATES.RESTORE) {"),
        "        if (r.state === BACKUP_ENTRY_STATES.NEW || r.state === BACKUP_ENTRY_STATES.RESTORE || r.state === BACKUP_ENTRY_STATES.IDENTICAL) {"));
    assert.equal(isRed(callJudge(judgeIdem, n.mod)), true, '破坏后同款判据必须转红');
});

test('v3910 D2. an unversioned pack is handed back with a body => migration judge must go red', async () => {
    const n = await negCopy(KERNEL, (s) => s.replace(
        anchorOnce(s, "pack: null, steps: steps, why: '无 schema 版本（不属于任何一代）—— 明确拒，不猜' };"),
        "pack: pack, steps: steps, why: '无 schema 版本（不属于任何一代）—— 明确拒，不猜' };"));
    assert.equal(isRed(callJudge(judgeOldRefusedOrMigrated, n.mod)), true, '破坏后同款判据必须转红');
});
test('v3910 D5. the branch barrier is switched off => branch-barrier judge must go red', async () => {
    const n = await negCopy(KERNEL, (s) => s.replace(
        anchorOnce(s, "} else if (!allowBranchMismatch && pack && pack.packBranchKey"),
        "} else if (false && pack && pack.packBranchKey"));
    assert.equal(isRed(callJudge(judgeBranchBarrier, n.mod)), true, '破坏后同款判据必须转红');
});
test('v3910 D6. selection becomes union => intersection judge must go red', async () => {
    const n = await negCopy(KERNEL, (s) => s.replace(
        anchorOnce(s, "    return one('app', entry.app) && one('chat', entry.chatId)"),
        "    return one('app', entry.app) || one('chat', entry.chatId)"));
    assert.equal(isRed(callJudge(judgeSelectionIntersect, n.mod)), true, '破坏后同款判据必须转红');
});

test('v3910 D7. undo runs in write order => reverse-undo judge must go red', async () => {
    const n = await negCopy(KERNEL, (s) => s.replace(
        anchorOnce(s, "    const undo = w.slice().reverse().map(function (x) {"),
        "    const undo = w.slice().map(function (x) {"));
    assert.equal(isRed(callJudge(judgeUndoOnlyThisRun, n.mod)), true, '破坏后同款判据必须转红');
});

test('v3910 D8. self-proof: the mutant is really loaded and the break really changes behaviour', async () => {
    const n = await negCopy(KERNEL, (s) => s.replace(
        anchorOnce(s, "        return { state: BACKUP_PACK_STATES.UNMARKED, accepted: true, mark: '', schemaVersion: ver, pack: raw,"),
        "        return { state: BACKUP_PACK_STATES.FOREIGN, accepted: false, mark: '', schemaVersion: ver, pack: null,"));
    assert.ok(typeof n.mod.backupSelfCheck === 'function', '破坏副本必须真被加载');
    assert.ok(String(n.file).indexOf(NEG_SUFFIX) >= 0);
    assert.ok(n.src.indexOf('BACKUP_PACK_STATES.FOREIGN, accepted: false') >= 0, '破坏点必须真的写进了副本');
    assert.deepEqual(BK.backupSelfCheck().problems, [], '原版自检必须为空');
    assert.equal(BK.readBackupPack({ entries: [] }).accepted, true, '原版必须收下无魔标旧包（兼容面）');
    assert.equal(n.mod.readBackupPack({ entries: [] }).accepted, false, '破坏副本必须不再收下（行为真的变了）');
});

/* E */

test('v3910 E1 version anchor: five sources agree and not below 3.91.0', () => {
    const ver = String(MAN.version);
    const parts = ver.split('.').map(Number);
    assert.ok(parts[0] === 3 && parts[1] >= 91, '版本必须不低于 3.91.0，实际 ' + ver);
    assert.ok(IDX.indexOf("const ST_PHONE_VERSION = '" + ver + "'") >= 0);
    assert.equal(JSON.parse(read('package.json')).version, ver);
    const log = JSON.parse(read('update-log.json'));
    assert.ok(log.versions && log.versions[ver]);
    assert.equal(log.latest, ver);
    assert.ok(read('ITERATION_LOG.md').indexOf(ver) >= 0);
});
