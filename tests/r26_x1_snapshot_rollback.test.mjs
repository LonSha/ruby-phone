/**
 * tests/r26_x1_snapshot_rollback.test.mjs — 整机快照与多版本回滚判据 [R26-X1]
 *
 * A1 取快照后逐字段一致，且取快照不改源数据
 * A2 改过数据后对拍必须给出键级 diff（不是只比键数）
 * A3 回滚后逐字段与快照一致
 * A4 回滚本身可再回滚（pre-rollback 留底可当目标）
 * A5 回滚到不存在的 id 抛错，不许猜「最近那条」
 * A6 超上限淘汰最旧，且回执点名 evicted（不静默消失）
 * A7 标签闭集：auto / manual / pre-rollback，未知前缀落 manual
 * A8 本地快照留钥（与 export-redact 的 share 策略分工，不互相替代）
 * N1 破坏副本：回滚不写留底 ⇒ A4 必红
 * N2 破坏副本：对拍只比键数 ⇒ A2 必红
 * Z 自检为绿
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  SNAPSHOT_KINDS,
  SNAPSHOT_LIMIT,
  SNAPSHOT_FACES,
  createSnapshotStore,
  createStorageSnapshotStore,
  diffFields,
  snapshotFaceText,
  versionSnapshotSelfCheck,
} from '../config/version-snapshot.js';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'config', 'version-snapshot.js'), 'utf8');

const mkStore = (initial, opts = {}) => {
  let data = initial;
  const store = createSnapshotStore({ read: () => data, write: (v) => { data = v; }, now: () => 1000, ...opts });
  return { store, get: () => data, set: (v) => { data = v; } };
};

test('A1 取快照后逐字段一致，且取快照不改源数据', () => {
  const { store, get } = mkStore({ a: 1, b: { c: [1, 2] } });
  const before = JSON.stringify(get());
  const s = store.take('manual:初始');
  assert.equal(s.kind, 'manual');
  assert.equal(s.keys, 2);
  assert.equal(store.verify(s.id).ok, true);
  assert.equal(JSON.stringify(get()), before, '取快照必须只读，不许改源数据');
});

test('A2 改过数据后必须给出键级 diff（不是只比键数）', () => {
  const { store, set } = mkStore({ a: 1, b: { c: [1, 2] } });
  const s = store.take('manual:初始');
  set({ a: 9, b: { c: [1, 2] } });            // 键数不变，值变了
  const r = store.verify(s.id);
  assert.equal(r.ok, false, '值变了却判一致 = 假绿');
  assert.equal(r.diffs.length, 1);
  assert.equal(r.diffs[0].key, 'a');
  assert.equal(r.diffs[0].kind, 'changed');

  set({ a: 1 });                                // 少一个键
  const r2 = store.verify(s.id);
  assert.ok(r2.diffs.some((d) => d.key === 'b' && d.kind === 'added-since-snapshot'));

  set({ a: 1, b: { c: [1, 2] }, extra: true }); // 多一个键
  const r3 = store.verify(s.id);
  assert.ok(r3.diffs.some((d) => d.key === 'extra' && d.kind === 'missing-in-snapshot'));
});

test('A3 回滚后逐字段与快照一致', () => {
  const { store, get, set } = mkStore({ a: 1, b: { c: [1, 2] } });
  const s = store.take('manual:初始');
  set({ a: 9, b: { c: [9, 9, 9] }, junk: 'x' });
  const rep = store.rollback(s.id);
  assert.equal(rep.ok, true);
  assert.deepEqual(get(), { a: 1, b: { c: [1, 2] } });
  assert.equal(store.verify(s.id).ok, true);
});

test('A4 回滚本身可再回滚（留底能当目标）', () => {
  const { store, get, set } = mkStore({ v: 'original' });
  const s = store.take('manual:原始');
  set({ v: 'messed-up' });
  const rep = store.rollback(s.id);
  assert.equal(get().v, 'original');
  assert.ok(rep.guardId, '回滚必须给出留底 id');
  // 再回滚到「回滚前」的状态
  const back = store.rollback(rep.guardId);
  assert.equal(back.ok, true);
  assert.equal(get().v, 'messed-up', '回滚本身必须可回滚');
  // 留底也是闭集里的 kind
  assert.equal(store.list().find((r) => r.id === rep.guardId).kind, 'pre-rollback');
});

test('A5 回滚到不存在的 id 抛错（不许猜最近那条）', () => {
  const { store } = mkStore({ a: 1 });
  store.take('manual:一');
  assert.throws(() => store.rollback('snap-404'), /没有这个快照/);
  assert.throws(() => store.verify('snap-404'), /没有这个快照/);
});

test('A6 超上限淘汰最旧，且回执点名 evicted', () => {
  const { store } = mkStore({ a: 1 }, { limit: 2 });
  const s1 = store.take('manual:一');
  store.take('manual:二');
  const s3 = store.take('auto:三');
  assert.equal(store.list().length, 2);
  assert.ok(s1.id && s3.evicted.some((e) => e.id === s1.id), '被淘汰的那条必须点名');
  assert.equal(SNAPSHOT_LIMIT >= 2, true);
});

test('A7 标签闭集：三个 kind，未知前缀落 manual', () => {
  const { store } = mkStore({ a: 1 });
  assert.equal(store.take('auto:深夜').kind, 'auto');
  assert.equal(store.take('pre-rollback:snap-001').kind, 'pre-rollback');
  assert.equal(store.take('whatever:随便').kind, 'manual');
  assert.deepEqual([...SNAPSHOT_KINDS].sort(), ['auto', 'manual', 'pre-rollback']);
});

test('A8 本地快照留钥（与导出的 share 策略分工，不互相替代）', () => {
  const { store, get } = mkStore({ cfg: { apiKey: 'sk-local', model: 'x' } });
  const s = store.take('manual:带钥');
  assert.equal(store.verify(s.id).ok, true);
  const rep = store.rollback(s.id);
  assert.equal(rep.ok, true);
  assert.equal(get().cfg.apiKey, 'sk-local', '本地恢复必须留钥，否则恢复出来是半条命');
});

test('A8b 文案：未安装 / 还没有 / 分类计数', () => {
  assert.match(snapshotFaceText(null), /未安装/);
  const empty = mkStore({ a: 1 });
  assert.match(snapshotFaceText(empty.store), /还没有/);
  const { store } = mkStore({ a: 1 });
  store.take('manual:一');
  store.take('auto:二');
  assert.match(snapshotFaceText(store), /2 份（手动 1 \/ 自动 1/);
});

test('A9 diffFields 独立可用（键级、排序稳定）', () => {
  const d = diffFields({ b: 2, a: 1 }, { a: 1, b: 3 });
  assert.equal(d.length, 1);
  assert.deepEqual(d[0].key, 'b');
  assert.deepEqual(diffFields({}, {}), []);
});

test('A10 存储接线：只收读得到的面，回滚不新增不存在的面', () => {
  const mem = { settings: 'v1' };            // 只有 settings 这一面存在
  const storage = { get: (k) => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null), set: (k, v) => { mem[k] = v; } };
  const store = createStorageSnapshotStore(storage, { now: () => 7 });
  assert.deepEqual(store.faces, SNAPSHOT_FACES, '面清单必须可读（唯一真源）');
  const s = store.take('manual:快照');
  assert.equal(s.keys, 1, '读不到的面不许进快照（进来了就会在回滚时被清空）');
  mem.settings = 'v2';
  mem.pending = '后来才有的面';
  const rep = store.rollback(s.id);
  assert.equal(rep.ok, true);
  assert.equal(mem.settings, 'v1', '快照里的面必须恢复');
  assert.equal(mem.pending, '后来才有的面', '快照里没有的面，回滚不许动它（不猜）');
  assert.equal(store.verify(s.id).ok, false, '回滚后本机多了面 ⇒ 对拍应给出 diff（不是假绿）');
});

test('A11 产品面接线：index.js 建真 store、挂诊断面、自检进总表', () => {
  const indexSrc = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
  assert.match(indexSrc, /import\s*\{[^}]*createStorageSnapshotStore[^}]*\}\s*from\s*'\.\/config\/version-snapshot\.js'/, 'index.js 必须静态导入');
  assert.ok(indexSrc.includes('createStorageSnapshotStore(storage'), '必须用真 storage 建库（不许只导出不用）');
  assert.ok(/VirtualPhone\.versionSnapshot\s*=/.test(indexSrc), '快照能力必须挂诊断面');
  assert.ok(/['"]_r26X1['"]/.test(indexSrc), '自检必须进启动自检总表 _r26X1');
});

/* ------------------------------ 负控制（确定性破坏） ------------------------------ */

async function loadMutant(replacements, tag) {
  let text = SOURCE;
  for (const [from, to] of replacements) {
    assert.ok(text.includes(from), `负控制锚点失效（源变了要同步改判据）：${from}`);
    text = text.split(from).join(to);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rp_x1_${tag}_`));
  const file = path.join(dir, 'version-snapshot.js');
  fs.writeFileSync(file, text, 'utf8');
  return import(pathToFileURL(file).href + `?t=${Date.now()}`);
}

test('N1 破坏：回滚不留前底 ⇒ 回滚无法再回滚', async () => {
  const broken = await loadMutant(
    [['const guard = take(`pre-rollback:${snap.id}`);', 'const guard = { id: "", label: "", evicted: [] };']],
    'nohguard'
  );
  let data = { v: 'original' };
  const store = broken.createSnapshotStore({ read: () => data, write: (v) => { data = v; }, now: () => 1 });
  const s = store.take('manual:原始');
  data = { v: 'bad' };
  const rep = store.rollback(s.id);
  assert.equal(store.list().filter((r) => r.kind === 'pre-rollback').length, 0, '破坏后不该有留底（否则破坏没生效）');
  assert.throws(() => store.rollback(rep.guardId), /没有这个快照/, '没有留底时「回滚的回滚」必须失败');
});

test('N2 破坏：对拍只比键数 ⇒ 改值不再被发现', async () => {
  const broken = await loadMutant(
    [['const diffs = diffFields(snap.data, io.read() || {});', 'const diffs = Object.keys(snap.data).length === Object.keys(io.read() || {}).length ? [] : [{ key: "count", kind: "changed", from: 1, to: 0 }];']],
    'keycountonly'
  );
  let data = { a: 1 };
  const store = broken.createSnapshotStore({ read: () => data, write: (v) => { data = v; }, now: () => 1 });
  const s = store.take('manual:x');
  data = { a: 2 };
  assert.equal(store.verify(s.id).ok, true, '破坏后只比键数 ⇒ 改值判一致（正说明真判据靠逐字段）');
});

test('Z 自检为绿', () => {
  const r = versionSnapshotSelfCheck();
  assert.deepEqual(r.bad, [], JSON.stringify(r.bad));
  assert.equal(r.ok, true);
});