/* ============================================================
 * tools/ab-desk-core.mjs — R25-X8 整机 A/B 对照台的**纯比对内核**
 * ------------------------------------------------------------
 * 它回答的只有一个问题：同一段操作序列在两个版本上跑出来的读数，哪些不一样？
 * 纪律（与仓内其他内核同一条）：
 *   · 零 IO、零浏览器、零时钟 —— 输入两组读数，输出差异表；
 *   · 「一边有、一边没」不许压成「相同」：缺读数单独一档 only-a / only-b；
 *     两边都零读数 ⇒ verdict=unknown（不拿「0 条差异」冒充「两版一致」）；
 *   · 它不是门禁：不判「通过/失败」，只报差异条数与明细。判不判、判多严由用的人定。
 * ============================================================ */

/** 四档差异面。只有 same 是真一样；only-* 是一边没这条读数。 */
export const AB_FACES = ['same', 'diff', 'only-a', 'only-b'];

function nameOf(rec) {
  return String((rec && rec.name) || '');
}

function okState(rec) {
  if (!rec) return 'missing';
  return rec.ok ? 'ok' : 'FAIL';
}

function detailOf(rec) {
  return String((rec && rec.detail) || '');
}

/** 把两组读数按「读数名」对齐成差异表（同名重复只取首条，不靠行号对齐）。 */
export function diffReadings(aList, bList) {
  const a = Array.isArray(aList) ? aList : [];
  const b = Array.isArray(bList) ? bList : [];
  const bIndex = new Map();
  b.forEach((rec) => {
    const k = nameOf(rec);
    if (k && !bIndex.has(k)) bIndex.set(k, rec);
  });
  const seen = new Set();
  const rows = [];
  a.forEach((rec) => {
    const k = nameOf(rec);
    if (!k || seen.has(k)) return;
    seen.add(k);
    const other = bIndex.get(k);
    let face;
    if (!other) face = 'only-a';
    else {
      const sameOk = okState(rec) === okState(other);
      const sameDetail = detailOf(rec) === detailOf(other);
      face = (sameOk && sameDetail) ? 'same' : 'diff';
    }
    rows.push({
      name: k,
      face,
      a: { ok: okState(rec), detail: detailOf(rec) },
      b: { ok: okState(other), detail: detailOf(other) },
    });
  });
  b.forEach((rec) => {
    const k = nameOf(rec);
    if (!k || seen.has(k)) return;
    seen.add(k);
    rows.push({ name: k, face: 'only-b', a: { ok: 'missing', detail: '' }, b: { ok: okState(rec), detail: detailOf(rec) } });
  });
  const counts = { same: 0, diff: 0, 'only-a': 0, 'only-b': 0 };
  rows.forEach((r) => { counts[r.face] += 1; });
  const total = rows.length;
  const changed = counts.diff + counts['only-a'] + counts['only-b'];
  /* 两边都零读数：不是「一致」，是「没测到」。这是本内核唯一会拒判的形态。 */
  const verdict = total === 0 ? 'unknown' : (changed === 0 ? 'identical' : 'changed');
  return { rows, counts, total, changed, verdict };
}

/** 人看的那张表（Markdown）。不判好坏，只把差异列出来。 */
export function formatMarkdown(result, meta = {}) {
  const out = [];
  out.push('# A/B 对照表');
  out.push('');
  Object.keys(meta).forEach((k) => { out.push('- ' + k + '：' + String(meta[k])); });
  out.push('');
  const c = result.counts;
  /* 四档一律从 AB_FACES 迭代 ⇒ 新增一档只改常量，报表不会漏报。 */
  const tally = AB_FACES.map((f) => f + ' ' + Number(c[f] || 0)).join(' / ');
  out.push('读数 ' + result.total + ' 条：' + tally + ' ⇒ ' + result.verdict);
  out.push('');
  out.push('| 读数 | 差异面 | A | B |');
  out.push('|---|---|---|---|');
  result.rows.forEach((r) => {
    if (r.face === 'same') return;
    const cell = (x) => (x.ok === 'missing' ? '（没有这条读数）' : x.ok + ' · ' + String(x.detail).split(String.fromCharCode(10)).join(' ').split('|').join('/').slice(0, 90));
    out.push('| ' + r.name + ' | ' + r.face + ' | ' + cell(r.a) + ' | ' + cell(r.b) + ' |');
  });
  out.push('');
  return out.join(String.fromCharCode(10));
}

/** 内核自检：五条边界各有真样例（台自己坏了要先发现，而不是拿它去下结论）。 */
export function abDeskSelfCheck() {
  const items = [];
  const push = (name, ok, detail) => items.push({ name, ok: !!ok, detail });
  const A = [{ name: 'x', ok: true, detail: '1' }, { name: 'y', ok: true, detail: '2' }];
  const same = diffReadings(A, [{ name: 'x', ok: true, detail: '1' }, { name: 'y', ok: true, detail: '2' }]);
  push('同源对照必须全 same', same.counts.same === 2 && same.changed === 0 && same.verdict === 'identical', JSON.stringify(same.counts));
  const flip = diffReadings([{ name: 'x', ok: true, detail: '1' }], [{ name: 'x', ok: false, detail: '1' }]);
  push('ok 翻转必须 diff（不许只看 detail）', flip.counts.diff === 1, JSON.stringify(flip.counts));
  const det = diffReadings([{ name: 'p', ok: true, detail: '10ms' }], [{ name: 'p', ok: true, detail: '12ms' }]);
  push('detail 变了也算 diff（读数不同就是不同）', det.counts.diff === 1, JSON.stringify(det.counts));
  const onlyA = diffReadings([{ name: 'z', ok: true, detail: '' }], []);
  push('一边没有不许当相同（only-a 单列）', onlyA.counts['only-a'] === 1 && onlyA.counts.same === 0, JSON.stringify(onlyA.counts));
  const empty = diffReadings([], []);
  push('两边零读数 ⇒ unknown（不拿 0 条差异冒充一致）', empty.verdict === 'unknown', empty.verdict);
  return { ok: items.every((i) => i.ok), items };
}

