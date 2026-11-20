/**
 * config/capability-manifest.js — 本机能力清单自生成（含 dormant 与理由）[R26-O9]
 *
 * 立项时的空缺（原文）：101 个 apps/ 目录 + 数百个 config/ 模块，没有任何一处能回答
 * 「本机有哪些能力、谁是 dormant」。R23 的 config/v23-trace.js 是**追踪**不是**清单**。
 * 验收口径：一条命令生成「本机能力清单」，含 dormant 与理由；手抄版删除。
 *
 * 设计上有三条硬约束：
 *  ① **清单从代码生成**：本模块只做分类与裁定，不做 io；引用计数由调用方（判据/工具）喂进来。
 *     谁扫描谁负责，清单本身绝不能存一份「当前有什么」的快照 —— 那就是手抄版复辟。
 *  ② **dormant 必须带理由**，且理由只能是闭集里的三种：无任何引用 / 仅测试引用 / 仅自身引用。
 *     没有理由的 dormant 等于没判。
 *  ③ **只被测试引用 ≠ 死代码**：它是「被测试固定住但产品面没接」，单独一档 `test-only`，
 *     不许并进 `wired`（读数字好看），也不许并进 `dormant`（会诱导删掉仍在守行为的东西）。
 */

export const CAPABILITY_KINDS = Object.freeze(['app', 'config']);

/** 四档：产品面已接 / 仅测试引用 / 仅自身引用 / 无任何引用。 */
export const CAPABILITY_STATES = Object.freeze(['wired', 'test-only', 'self-only', 'dormant']);

/** dormant 类理由只认这三种（闭集，防止「随便写一句理由」）。 */
export const DORMANT_REASONS = Object.freeze({
  'test-only': '仅测试引用',
  'self-only': '仅自身引用',
  dormant: '无任何引用',
});

const kindOf = (kind) => (CAPABILITY_KINDS.includes(kind) ? kind : null);

/** 能力类型只能是闭集里的两种；非法类型直接抛错，绝不悄悄归到某一档。 */
export function resolveKind(kind) {
  const k = kindOf(kind);
  if (!k) throw new TypeError(`未知能力类型：${kind}`);
  return k;
}

/**
 * 生成本机能力清单。
 * @param {{apps?: string[], configModules?: string[],
 *          refs?: Record<string, {product?: number, test?: number, self?: number}>}} input
 * @returns {{entries: Array<{id:string,kind:string,state:string,reason:string|null,product:number,test:number}>,
 *            counts: Record<string, number>, total: number, dormant: string[]}}
 */
export function buildManifest(input = {}) {
  const apps = Array.isArray(input.apps) ? input.apps : [];
  const configs = Array.isArray(input.configModules) ? input.configModules : [];
  const refs = input.refs && typeof input.refs === 'object' ? input.refs : {};
  const entries = [];
  const seen = new Set();
  const push = (id, kind) => {
    if (!id || seen.has(kind + ':' + id)) return;
    const k = resolveKind(kind);
    seen.add(kind + ':' + id);
    const r = refs[id] || {};
    const product = Number(r.product) || 0;
    const test = Number(r.test) || 0;
    const self = Number(r.self) || 0;
    let state;
    if (product > 0) state = 'wired';
    else if (test > 0) state = 'test-only';
    else if (self > 0) state = 'self-only';
    else state = 'dormant';
    entries.push({ id, kind: k, state, reason: DORMANT_REASONS[state] || null, product, test });
  };
  for (const a of apps) push(String(a), 'app');
  for (const c of configs) push(String(c), 'config');
  entries.sort((x, y) => (x.kind === y.kind ? (x.id < y.id ? -1 : x.id > y.id ? 1 : 0) : x.kind < y.kind ? -1 : 1));
  const counts = {};
  for (const s of CAPABILITY_STATES) counts[s] = 0;
  for (const e of entries) counts[e.state] += 1;
  const dormant = entries.filter((e) => e.state !== 'wired').map((e) => e.id);
  return { entries, counts, total: entries.length, dormant };
}

/** 清单文案：先给四档计数，再把非 wired 的前几条点名（理由紧跟在名字后面）。 */
export function manifestText(manifest) {
  if (!manifest || !Array.isArray(manifest.entries)) return '能力清单：无读数（未生成）';
  const c = manifest.counts || {};
  const head = `能力清单：共 ${manifest.total} 项 · 已接 ${c.wired || 0} / 仅测试 ${c['test-only'] || 0} / 仅自身 ${c['self-only'] || 0} / 无引用 ${c.dormant || 0}`;
  const rest = manifest.entries.filter((e) => e.state !== 'wired').slice(0, 5);
  if (!rest.length) return head + '\n没有 dormant 项。';
  return head + '\n未接产品面：' + rest.map((e) => `${e.id}（${e.reason}）`).join('；');
}

/**
 * 引用计数：把「候选 id → 出现在哪些源文本里」这件事算成 {product, test, self}。
 * product = 产品面源文本里出现次数（index.js / apps/ / 其它 config 都不是它自己）；
 * test    = 测试面源文本里出现次数；self = 自己文件里出现次数。
 * 名字按「模块名（去 .js）」匹配，边界用非标识符字符，避免 `boot` 命中 `boot-budget`。
 */
export function collectReferences(input = {}) {
  const ids = Array.isArray(input.ids) ? input.ids : [];
  const productSources = Array.isArray(input.productSources) ? input.productSources : [];
  const testSources = Array.isArray(input.testSources) ? input.testSources : [];
  const selfSources = input.selfSources && typeof input.selfSources === 'object' ? input.selfSources : {};
  /** 一次分词建倒排，再按 id 查表 —— 逐 id 跑正则在大仓里会变成 O(n·m)，判据会慢到没法用。 */
  const tokenCounts = (text) => {
    const map = new Map();
    for (const t of String(text || '').split(/[^A-Za-z0-9_-]+/)) {
      if (!t) continue;
      map.set(t, (map.get(t) || 0) + 1);
    }
    return map;
  };
  const product = tokenCounts(productSources.join('\n'));
  const test = tokenCounts(testSources.join('\n'));
  const out = {};
  for (const id of ids) {
    const key = String(id);
    out[key] = {
      product: product.get(key) || 0,
      test: test.get(key) || 0,
      self: tokenCounts(selfSources[key]).get(key) || 0,
    };
  }
  return out;
}

export function capabilityManifestSelfCheck() {
  const refs = {
    wechat: { product: 3, test: 1 },
    gallery: { test: 2 },
    'boot-budget': { product: 1, test: 2 },
    'fake-progress': {},
  };
  const m = buildManifest({ apps: ['wechat', 'gallery'], configModules: ['boot-budget', 'fake-progress'], refs });
  const text = manifestText(m);
  const ok =
    m.total === 4 &&
    m.counts.wired === 2 &&
    m.counts['test-only'] === 1 &&
    m.counts.dormant === 1 &&
    m.entries.every((e) => (e.state === 'wired' ? e.reason === null : typeof e.reason === 'string')) &&
    m.dormant.join(',') === 'gallery,fake-progress' &&
    text.includes('无任何引用') &&
    manifestText(null).includes('无读数');
  const refs2 = collectReferences({
    ids: ['boot', 'boot-budget'],
    productSources: ['index.js', 'index.js 的装配块里引用了 boot-budget'],
    testSources: ['测试面里引入 boot-budget'],
  });
  const ok2 = refs2['boot-budget'].product === 1 && refs2['boot'].product === 0 && refs2['boot'].test === 0;
  return { ok: ok === true && ok2 === true, bad: { m, refs2 }, sample: text };
}