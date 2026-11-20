/**
 * config/health-board.js — 数据健康看板：占用 / 异常增长 / 损坏项一眼可见 [R26-X6]
 *
 * 与既有 `config/data-health.js`（R24-O7 五类问题体检 + 自愈）分工不同：
 *   体检回答「有哪几处坏」，看板回答「现在整体是什么状态、哪一项要我先进去」。
 *   看板不重新判定损坏细节，只吃各面汇总出来的 `broken` 计数。
 *
 * 口径上最容易糊弄人的三处，这里都钉死：
 *  ① **损坏优先于增长**：一个面既损坏又变大，必须先报 `broken`。损坏是「数据不对」，
 *     增长只是「数据变多」，把后者盖在前面会让用户先去看占用量。
 *  ② **增长要有基线才能判**：没有上一版读数（prevBytes 缺省/≤0）时不判 growing，
 *     也不判 ok —— 单列 `unknown`，明确说「没有基线，判不了」。
 *  ③ **空面不是健康面**：`bytes === 0` 单独一档 `empty`，不许混进 ok 里凑绿。
 */

export const HEALTH_STATES = Object.freeze(['broken', 'growing', 'empty', 'unknown', 'ok']);

/** 默认增长阈值：同比上一版涨 20% 才算异常增长（可配）。 */
export const DEFAULT_GROWTH_RATIO = 1.2;

/**
 * @param {Array<{id:string,label?:string,bytes?:number,prevBytes?:number,broken?:number}>} faces
 * @param {{growthRatio?: number}} [opts]
 */
export function assessHealth(faces, opts = {}) {
  if (!Array.isArray(faces)) throw new TypeError('assessHealth 需要面数组');
  const ratio = Number(opts && opts.growthRatio != null ? opts.growthRatio : DEFAULT_GROWTH_RATIO);
  if (!(ratio > 1)) throw new TypeError(`增长阈值必须大于 1：${opts && opts.growthRatio}`);
  const items = faces.map((f) => {
    if (!f || typeof f.id !== 'string' || !f.id) throw new TypeError('每个面必须有 id');
    const bytes = Number(f.bytes) || 0;
    const prev = f.prevBytes == null ? null : Number(f.prevBytes);
    const broken = Number(f.broken) || 0;
    const label = f.label ? String(f.label) : f.id;
    let state;
    let reason;
    if (broken > 0) {
      state = 'broken';
      reason = `${broken} 项损坏`;
    } else if (bytes === 0) {
      state = 'empty';
      reason = '这个面是空的';
    } else if (prev == null || prev <= 0) {
      state = 'unknown';
      reason = '没有上一版读数，判不了增长';
    } else if (bytes / prev >= ratio) {
      state = 'growing';
      reason = `涨到 ${Math.round((bytes / prev) * 100)}%（阈值 ${Math.round(ratio * 100)}%）`;
    } else {
      state = 'ok';
      reason = '正常';
    }
    return { id: f.id, label, bytes, prevBytes: prev, broken, state, reason };
  });
  const byState = {};
  for (const s of HEALTH_STATES) byState[s] = 0;
  for (const i of items) byState[i.state] += 1;
  const totalBytes = items.reduce((n, i) => n + i.bytes, 0);
  return {
    items,
    byState,
    totalBytes,
    /** 只有「零损坏且零异常增长」才算健康；空面与无基线不算异常，但也不冒充正常。 */
    ok: byState.broken === 0 && byState.growing === 0,
  };
}

export function healthBoardText(report) {
  if (!report || !Array.isArray(report.items)) return '数据健康：无读数（未体检）';
  const s = report.byState || {};
  const head = `数据健康：${report.ok === true ? '没有异常' : '有异常'} · 共 ${(report.totalBytes / 1024 / 1024).toFixed(1)}MB`;
  const parts = [`损坏 ${s.broken || 0}`, `异常增长 ${s.growing || 0}`, `无基线 ${s.unknown || 0}`, `空 ${s.empty || 0}`, `正常 ${s.ok || 0}`];
  const lines = [head + '（' + parts.join(' / ') + '）'];
  const bad = report.items.filter((i) => i.state === 'broken' || i.state === 'growing');
  if (bad.length) {
    lines.push('要先看的：' + bad.slice(0, 4).map((i) => `${i.label}（${i.reason}）`).join('；'));
  }
  return lines.join('\n');
}

export function healthBoardSelfCheck() {
  const rep = assessHealth([
    { id: 'chat', label: '聊天', bytes: 1000, prevBytes: 900 },
    { id: 'media', label: '媒体', bytes: 5000, prevBytes: 1000 },
    { id: 'index', label: '索引', bytes: 10, prevBytes: 10, broken: 2 },
    { id: 'cache', label: '缓存', bytes: 0, prevBytes: 5 },
    { id: 'new', label: '新面', bytes: 10 },
  ]);
  const text = healthBoardText(rep);
  const ok =
    rep.byState.ok === 1 &&
    rep.byState.growing === 1 &&
    rep.byState.broken === 1 &&
    rep.byState.empty === 1 &&
    rep.byState.unknown === 1 &&
    rep.ok === false &&
    rep.items.find((i) => i.id === 'index').state === 'broken' &&
    rep.items.find((i) => i.id === 'new').state === 'unknown' &&
    text.includes('损坏 1') &&
    text.includes('媒体') &&
    healthBoardText(null).includes('无读数');
  return { ok, bad: rep, sample: text };
}