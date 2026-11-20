/**
 * config/version-snapshot.js — 整机快照与多版本回滚 [R26-X1]
 *
 * 立项时的空缺（原文）：有导出/导入（R24-X4），但没有「先存一份、坏了退回上一份」；
 * 回滚后逐字段与快照一致；**回滚本身可再回滚**。
 *
 * 与 R26-X1a（导出脱敏）的分工，别混：
 *   · 快照是**本地恢复**用的 —— 密钥必须留着，否则恢复出来是半条命；
 *   · 导出/分享走 `config/export-redact.js`，share 策略必须脱敏。
 *   两条策略互不替代：一份带钥快照永远不许直接当分享物发出去（判据 A9 守这条）。
 *
 * 四条纪律（都是判据能验的）：
 *   ① 回滚**先存后改**：动手前自动留一份 `pre-rollback:<id>`，于是回滚本身可再回滚。
 *   ② 逐字段对拍：`verify()` 比较的是键值，不是键数；少一个键、改一个字都算 diff。
 *   ③ 淘汰不静默：超上限丢最旧的，回执里必须点名 `evicted`，不许「悄悄少了一条」。
 *   ④ 认不出就抛：回滚到不存在的快照 id 抛错，不做「回滚到最近一条」这种猜测。
 *
 * 纯逻辑件：读写全注入（`read` / `write`），不 import 任何存储层 —— 这样它能在
 * 合成输入上单独跑，也不会因为宿主存储层 pending 而拖死启动面。
 */

/** 快照保留上限（份）。超了淘汰最旧，淘汰必须进回执。 */
export const SNAPSHOT_LIMIT = 5;

/** 快照标签闭集前缀：`auto:` 自动、`manual:` 手动、`pre-rollback:` 回滚前留底。 */
export const SNAPSHOT_KINDS = ['auto', 'manual', 'pre-rollback'];

/** 稳定序列化：键排序后再 stringify，保证同一份数据两次摘要相同。 */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

/** djb2 摘要（只为「同一份数据两次一致」服务，不做密码学用途）。 */
function digest(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return 'djb2:' + h.toString(16);
}

function kindOfLabel(label) {
  const s = String(label || '');
  const head = s.split(':')[0];
  return SNAPSHOT_KINDS.includes(head) ? head : 'manual';
}

/** 逐字段对拍：返回差异清单（键级），空数组 = 完全一致。 */
export function diffFields(from, to) {
  const diffs = [];
  const keys = new Set([...Object.keys(from || {}), ...Object.keys(to || {})]);
  for (const key of [...keys].sort()) {
    const a = from ? from[key] : undefined;
    const b = to ? to[key] : undefined;
    const sa = stableStringify(a);
    const sb = stableStringify(b);
    if (sa !== sb) {
      diffs.push({
        key,
        from: a === undefined ? null : a,
        to: b === undefined ? null : b,
        kind: a === undefined ? 'missing-in-snapshot' : (b === undefined ? 'added-since-snapshot' : 'changed'),
      });
    }
  }
  return diffs;
}

/**
 * 建快照库。`read()` 返回当前整机数据对象，`write(obj)` 落盘。
 * @param {{read:Function, write:Function, now?:Function, limit?:number}} io
 */
export function createSnapshotStore(io) {
  if (!io || typeof io.read !== 'function' || typeof io.write !== 'function') {
    throw new TypeError('version-snapshot: 必须注入 read / write（本件不直接碰存储层）');
  }
  const limit = Number.isFinite(io.limit) && io.limit > 0 ? io.limit : SNAPSHOT_LIMIT;
  const now = typeof io.now === 'function' ? io.now : Date.now;
  /** 快照本体只活在这个闭包里：不落存储，避免「为了救数据先污染数据」。 */
  const snapshots = [];
  let seq = 0;

  const nextId = () => {
    seq += 1;
    return 'snap-' + String(seq).padStart(3, '0');
  };

  function list() {
    return snapshots.map((s) => ({ id: s.id, label: s.label, kind: s.kind, at: s.at, keys: s.keys, digest: s.digest }));
  }

  function find(id) {
    const hit = snapshots.find((s) => s.id === id);
    if (!hit) throw new RangeError(`version-snapshot: 没有这个快照（${String(id)}），拒绝回滚到「大概那条」`);
    return hit;
  }

  /** 留一份快照（不改源数据，只读一次）。 */
  function take(label) {
    const data = io.read() || {};
    const text = stableStringify(data);
    const entry = {
      id: nextId(),
      label: String(label || 'manual:未命名'),
      kind: kindOfLabel(label),
      at: now(),
      keys: Object.keys(data).length,
      digest: digest(text),
      data: JSON.parse(text),
    };
    snapshots.push(entry);
    const evicted = [];
    while (snapshots.length > limit) {
      const gone = snapshots.shift();
      evicted.push({ id: gone.id, label: gone.label });
    }
    return { id: entry.id, label: entry.label, kind: entry.kind, keys: entry.keys, digest: entry.digest, evicted };
  }

  /** 与某快照逐字段对拍。 */
  function verify(id) {
    const snap = find(id);
    const diffs = diffFields(snap.data, io.read() || {});
    return { ok: diffs.length === 0, id: snap.id, diffs, keys: snap.keys };
  }

  /**
   * 回滚到某快照：**先存后改**。
   * 先把当前状态留成 `pre-rollback:<id>`，再整体写回快照数据；
   * 于是「回滚本身」也能再回滚（拿 pre-rollback 那条再 rollback 一次即可）。
   */
  function rollback(id) {
    const snap = find(id);
    const guard = take(`pre-rollback:${snap.id}`);
    const restored = JSON.parse(stableStringify(snap.data));
    io.write(restored);
    /* 写回后复核**只核快照覆盖过的面**：本机比快照多出来的面（后来才有的数据）不算不一致 ——
     * 那不是这次回滚的责任，也不能因为它就判回滚失败。 */
    const now = io.read() || {};
    const covered = {};
    for (const key of Object.keys(snap.data)) covered[key] = now[key];
    const after = diffFields(snap.data, covered);
    if (after.length) {
      /* 写回后仍不一致 = 存储层没照办，这是缺陷，不许当成功。 */
      throw new Error(`version-snapshot: 回滚后仍有 ${after.length} 个字段不一致（首条：${after[0].key}）`);
    }
    return {
      ok: true,
      id: snap.id,
      restoredKeys: snap.keys,
      guardId: guard.id,
      guardLabel: guard.label,
      evicted: guard.evicted,
    };
  }

  return { take, list, verify, rollback, limit };
}

/**
 * 快照面闭集（本件快照覆盖的真存储键）。
 * 口径：**读不到的面不进快照，回滚也不动它** —— 快照里没有那个键，就等于「这一面我不猜」。
 * 加面是一行的事，但每加一面都要问：回滚时把这一面整体覆盖回去，是不是真的安全。
 */
export const SNAPSHOT_FACES = ['settings', 'offline', 'wechat_data', 'pending'];

/**
 * 把快照库接到真存储上（宿主只调这一个口，判据用假 storage 就能验）。
 * @param {{get:Function,set:Function}} storage
 * @param {{faces?:string[], now?:Function, limit?:number}} opts
 */
export function createStorageSnapshotStore(storage, opts = {}) {
  if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function') {
    throw new TypeError('version-snapshot: 需要 storage.get / storage.set');
  }
  const faces = Array.isArray(opts.faces) && opts.faces.length ? opts.faces.slice() : SNAPSHOT_FACES.slice();
  const read = () => {
    const out = {};
    for (const face of faces) {
      let raw;
      try {
        raw = storage.get(face);
      } catch (_e) {
        raw = undefined;
      }
      /* null/undefined = 这一面本机没有 ⇒ 不进快照（回滚时也就不动它）。 */
      if (raw !== null && raw !== undefined) out[face] = raw;
    }
    return out;
  };
  const write = (obj) => {
    for (const face of Object.keys(obj || {})) {
      storage.set(face, obj[face]);
    }
  };
  const store = createSnapshotStore({ read, write, now: opts.now, limit: opts.limit });
  return { ...store, faces };
}

/** 一行裁定文案（诊断与日志共用）。 */
export function snapshotFaceText(store) {
  if (!store || typeof store.list !== 'function') return '版本快照：未安装';
  const rows = store.list();
  if (!rows.length) return '版本快照：还没有（可手动存一份）';
  const manual = rows.filter((r) => r.kind === 'manual').length;
  const auto = rows.filter((r) => r.kind === 'auto').length;
  const guard = rows.filter((r) => r.kind === 'pre-rollback').length;
  return `版本快照：${rows.length} 份（手动 ${manual} / 自动 ${auto} / 回滚前留底 ${guard}）`;
}

/** 自检：只验纪律，不碰宿主。 */
export function versionSnapshotSelfCheck() {
  const bad = [];
  let data = { a: 1, b: { c: [1, 2] } };
  const store = createSnapshotStore({ read: () => data, write: (v) => { data = v; }, now: () => 1720000000000 });

  // 1. 取快照后再验证：逐字段一致
  const s = store.take('manual:初始');
  if (!store.verify(s.id).ok) bad.push('刚取完的快照对拍应为一致');

  // 2. 改数据 → 回滚 → 逐字段恢复
  data = { a: 9, b: { c: [9] } };
  if (store.verify(s.id).ok) bad.push('改过数据后对拍必须出现 diff（否则 verify 是空过）');
  store.rollback(s.id);
  if (diffFields({ a: 1, b: { c: [1, 2] } }, data).length) bad.push('回滚后数据必须与快照逐字段一致');

  // 3. 回滚本身可再回滚：pre-rollback 留底必须存在
  const guards = store.list().filter((r) => r.kind === 'pre-rollback');
  if (!guards.length) bad.push('回滚没有留下 pre-rollback 底 —— 回滚本身无法回滚');

  // 4. 未知 id 必须抛
  let threw = false;
  try {
    store.rollback('snap-999');
  } catch (_e) {
    threw = true;
  }
  if (!threw) bad.push('回滚到不存在的 id 未抛错（不许猜）');

  return { ok: bad.length === 0, bad, sample: snapshotFaceText(store) };
}