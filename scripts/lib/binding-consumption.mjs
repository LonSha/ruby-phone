/**
 * scripts/lib/binding-consumption.mjs — 绑定级消费解析（计划 R11-O1）
 *
 * 为什么需要这一层（真实现场，2026-10-29 实测）：
 *   `scripts/dead-export-check.mjs` 的跨文件消费判定是**裸词正则**：只要任意别的文件
 *   真代码里出现 `\bNAME\b` 就算「已消费」。于是两类假绿长期潜伏：
 *     ① 同名不同体：`config/diff-review-pipeline.js:21 computeParagraphDiff` 是**真孤儿**
 *        （该文件产品端零 import），但 `config/diff-editor-desk.js:47` 有同名函数被
 *        orchestrator import ⇒ 门判绿。
 *     ② 无关词面巧合：名字恰好是常见词（`render` / `open` / `result`）时，任何文件里
 *        一段无关代码都能把它「消费」掉。
 *   负控制（在 /tmp 副本上实测）：把 desk 版改名 `computeParagraphDiffX`，门立刻报出
 *   **两条**未登记零消费 —— 其中一条正是那个真孤儿。说明「按名字判」可复现地遮蔽死件。
 *
 * 本模块把消费单位从「全仓任何叫 X 的」改成「**模块解析后的绑定**」：
 *   `import { X } from './m.js'`         ⇒ 记 `m.js::X`
 *   `import { A as X } from './m.js'`    ⇒ 记 `m.js::A`（别名消费的是原名绑定）
 *   `import * as NS from './m.js'` + `NS.X` ⇒ 记 `m.js::X`（命名空间成员访问）
 *   `export { X } from './m.js'`（转出）  ⇒ **不算消费**（转出只是再导出，被转出的
 *                                            目标仍需有人在下游真 import 才算）
 *   `require('./m.js').X` / `require('./m.js')` 解构 ⇒ 记 `m.js::X`（CJS 回落）
 *   数据驱动面（`config/app-lazy-routes.js` 的 `cls: 'XxxApp'` 字面量）⇒ 按表驱动口径
 *     单独登记为消费，规矩**只认那一个登记过的表文件**（沿用原门禁 v3.61.0 的边界，
 *     不放开「任何字符串提及都算消费」）。
 *
 * 边界（如实写）：
 *   · 不解析动态 `import(variable)`；仓内实测 0 处（动态 import 全部是字面量 + ?v= 查询串）。
 *   · 不解析 `eval` / `new Function` 里拼出来的名字 —— 那不是可静态对账的面。
 *   · 不做别名再传递（`import {A}; const B = A;` 后别人 import B 不算消费 A）——
 *     本仓无此形态（实测 0 处），刻意不加，避免把判据做成半吊子数据流。
 */

import fs from 'node:fs';
import path from 'node:path';

/** 把 import 说明符解析成仓内相对路径（含 query 串归一）。解析不出（裸包名）返回 null。 */
export function resolveSpecifier(fromRel, spec) {
  if (typeof spec !== 'string' || !spec) return null;
  if (!spec.startsWith('.') && !spec.startsWith('/')) return null;   // 裸包名（node:fs 等）
  const q = spec.search(/[?#]/);
  const clean = q >= 0 ? spec.slice(0, q) : spec;
  const dir = path.posix.dirname(fromRel);
  let rel = path.posix.normalize(path.posix.join(dir, clean));
  if (rel.startsWith('./')) rel = rel.slice(2);
  return rel;
}

/** 从一段（已去注释/字符串的）真代码里取出全部跨模块消费绑定。 */
export function collectBindings(rel, code) {
  const out = { named: [], namespaces: [], cjs: [], starReexports: [] };
  if (typeof code !== 'string') return out;

  // ① `import { A, B as C } from './m.js'`（可跨行）
  //   ⚠️ 说明符**不是**紧跟 `}`：`from` 前面必须是「配对的那个 `}`」。
  //   首版用非贪婪 `\{([\s\S]*?)\}\s*from\s*['"]` 会让内层花括号提前收口，
  //   实测 `apps/uterus/uterus-app.js` 的 27 成员多行 import 被截成 0 条
  //   （`buildFetusGrid, …` 等全判零消费），故必须显式做括号配对。
  for (const m of code.matchAll(/import\s*\{/g)) {
    const openIdx = m.index + m[0].length - 1;
    let depth = 0, j = openIdx;
    for (; j < code.length; j++) {
      if (code[j] === '{') depth++;
      else if (code[j] === '}') { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) continue;
    const body = code.slice(openIdx + 1, j);
    const rest = code.slice(j + 1);
    const fromM = /^\s*from\s*(['"])([^'"]+)\1/.exec(rest);
    if (!fromM) continue;
    const target = resolveSpecifier(rel, fromM[2]);
    if (!target) continue;
    for (const part of body.split(',')) {
      const seg = part.trim();
      if (!seg) continue;
      const as = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(seg);
      if (as) { out.named.push({ target, name: as[1], local: as[2] }); continue; }
      if (/^[A-Za-z_$][\w$]*$/.test(seg)) out.named.push({ target, name: seg, local: seg });
    }
  }

  // ② `import * as NS from './m.js'`
  for (const m of code.matchAll(/import\s*\*\s*as\s*([A-Za-z_$][\w$]*)\s*from\s*(['"])([^'"]+)\2/g)) {
    const target = resolveSpecifier(rel, m[3]);
    if (!target) continue;
    out.namespaces.push({ target, local: m[1] });
  }

  // ③ `export { A } from './m.js'` —— 记下来但不计消费（转出不等于被用）
  for (const m of code.matchAll(/export\s*\{([\s\S]*?)\}\s*from\s*(['"])([^'"]+)\2/g)) {
    const target = resolveSpecifier(rel, m[3]);
    if (!target) continue;
    out.starReexports.push({ target, body: m[1] });
  }
  // `export * from './m.js'` —— 全量转出，目标模块的导出全部「可能被下游用」，无从静态对账
  for (const m of code.matchAll(/export\s*\*\s*from\s*(['"])([^'"]+)\1/g)) {
    const target = resolveSpecifier(rel, m[2]);
    if (!target) continue;
    out.starReexports.push({ target, body: '*' });
  }

  // ④ CJS 回落：`const { A, B } = require('./m.js')` / `require('./m.js').A`
  for (const m of code.matchAll(/const\s*\{([\s\S]*?)\}\s*=\s*require\(\s*(['"])([^'"]+)\2\s*\)/g)) {
    const target = resolveSpecifier(rel, m[3]);
    if (!target) continue;
    for (const part of m[1].split(',')) {
      const seg = part.trim();
      if (!seg) continue;
      const colon = /^([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)$/.exec(seg);
      if (colon) { out.cjs.push({ target, name: colon[1] }); continue; }
      if (/^[A-Za-z_$][\w$]*$/.test(seg)) out.cjs.push({ target, name: seg });
    }
  }
  for (const m of code.matchAll(/require\(\s*(['"])([^'"]+)\1\s*\)\s*\.\s*([A-Za-z_$][\w$]*)/g)) {
    const target = resolveSpecifier(rel, m[2]);
    if (!target) continue;
    out.cjs.push({ target, name: m[3] });
  }

  /* ⑤ 动态 `import()` 面（v4.92.0 实测产品端 15 处）。
   * 为什么必须收：`index.js` 的 14 个内联分支里有 11 处形如
   *   `bootTiming.instrumentImport(import('./apps/x/x-app.js?v=…'), '…')
   *      .then(module => { … new module.XxxApp(…) })`
   *   —— 说明符在 **instrumentImport 的实参里**，`.then` 挂在 instrumentImport 的
   *   返回值上，词面既没有 `import { X }` 也没有 `import * as`。少这一面会把
   *   11 个**真在跑**的 App 类判成零消费（首轮探针实测红出 52~57 条，
   *   AlbumApp / MusicApp / WeiboApp / SettingsApp 等全是这一类误杀）。
   *   故这里按「说明符字面量出现的位置」为锚，向**前**找赋值绑定、向**后**找
   *   `.then(回调参数)`，而不是要求两句紧邻。
   *   记录 pos（绑定位置）供 buildConsumptionIndex 做同名重绑定的区间切分：
   *   同一文件里 `const module = await import(a)` 与 `…import(b)` 并存时，
   *   `module.X` 只属于**它所在区间**的那个模块，否则每个模块都会白拿全部成员名。 */
  const DYN = [
    // A) `const ns = await import('m')`          捕获：1=local 2=quote 3=spec
    { re: /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+import\(\s*(['"`])([^'"`]+)\2/g,
      kind: 'ns', specIdx: 3, localIdx: 1 },
    // B) `const { A, B: C } = await import('m')` 捕获：1=body 2=quote 3=spec
    { re: /(?:const|let|var)\s*\{([\s\S]*?)\}\s*=\s*await\s+import\(\s*(['"`])([^'"`]+)\2/g,
      kind: 'destruct', specIdx: 3 },
    // C) `import('m') … .then(ns => …)`（允许中间夹 instrumentImport / Promise 链）
    //    捕获：1=quote 2=spec 3=local —— 注意索引与 A 不同，首版按 A 的索引取 local
    //    会拿到说明符字符串（实测把 `module` 解成 `./apps/album/album-app.js`，
    //    于是 album 的消费集为空）。索引必须按每条正则单独声明。
    { re: /import\(\s*(['"`])([^'"`]+)\1\s*\)[\s\S]{0,240}?\.then\(\s*\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>/g,
      kind: 'ns', specIdx: 2, localIdx: 3 },
  ];
  for (const d of DYN) {
    for (const m of code.matchAll(d.re)) {
      const target = resolveSpecifier(rel, m[d.specIdx]);
      if (!target) continue;
      const pos = m.index;
      if (d.kind === 'destruct') {
        for (const part of m[1].split(',')) {
          const seg = part.trim();
          if (!seg) continue;
          const as = /^([A-Za-z_$][\w$]*)\s*(?::\s*([A-Za-z_$][\w$]*))?$/.exec(seg);
          if (as) out.named.push({ target, name: as[1], local: as[2] || as[1] });
        }
      } else {
        out.namespaces.push({ target, local: m[d.localIdx], pos, via: 'dynamic-import' });
      }
    }
  }

  /* ⑥ 常量折叠：说明符是标识符时，回溯同文件里的 URL/字符串常量定义。
   * 真实现场（v4.92.0）：`index.js:327/331`
   *   const ST_PHONE_HONEY_MODULE_URL = new URL(`./apps/honey/honey-app.js?v=…`, import.meta.url).href;
   *   _honeyModulePromise = bootTiming.instrumentImport(import(ST_PHONE_HONEY_MODULE_URL), …)
   * 说明符是变量 ⇒ 上面的字面量规则全部抓不到，HoneyApp/GamesApp 被判零消费。
   * 这不是数据流分析，只是**同文件常量折叠**：只认同文件里 `const IDENT = <字面量>`
   * 或 `const IDENT = new URL(<字面量>, …)` 两种形态，取第一个字面量。 */
  const constMap = new Map();
  for (const cm of code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:new\s+URL\(\s*)?(['"`])([^'"`]+)\2/g)) {
    if (!constMap.has(cm[1])) constMap.set(cm[1], cm[3]);
  }
  const foldSpec = (s) => {
    if (typeof s !== 'string') return s;
    const t = s.trim();
    if (/^[A-Za-z_$][\w$]*$/.test(t) && constMap.has(t)) return constMap.get(t);
    return t;
  };
  // 说明符为标识符的动态 import：单独补一轮
  for (const m of code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+import\(\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
    const target = resolveSpecifier(rel, foldSpec(m[2]));
    if (target) out.namespaces.push({ target, local: m[1], pos: m.index, via: 'dynamic-import-const' });
  }
  // `const ns = await instrumentImport(import('./x.js'), '…')`（本仓的 bootTiming 包装形态）
  for (const m of code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+[A-Za-z_$][\w$]*\.instrumentImport\(\s*import\(\s*(['"`])([^'"`]+)\2/g)) {
    const target = resolveSpecifier(rel, foldSpec(m[3]));
    if (target) out.namespaces.push({ target, local: m[1], pos: m.index, via: 'instrument-import' });
  }
  for (const m of code.matchAll(/import\(\s*([A-Za-z_$][\w$]*)\s*\)[\s\S]{0,240}?\.then\(\s*\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>/g)) {
    const target = resolveSpecifier(rel, foldSpec(m[1]));
    if (target) out.namespaces.push({ target, local: m[2], pos: m.index, via: 'dynamic-import-const' });
  }

  /* ⑦ Promise.all 数组解构（v4.92.0 实测 3 处，含启动核心期与两只懒加载 App）。
   * 两种写法，机制相同 —— **按位置一一对应**：
   *   a) `const [a, b, …] = await Promise.all([ import('./x.js'), import('./y.js'), … ])`
   *      实测 index.js:1909-1932 的 loadCoreModules：9 个大脑模块一次读入，
   *      api/time/prompt/tts 四个 Manager 全在这一句里，缺这一面就全判零消费。
   *   b) `Promise.all([cssReady, loadGamesModule()]).then(([, module]) => { new module.GamesApp(…) })`
   *      模块句柄来自具名 helper，`.then` 里按下标取出（honey / games 各一处）。
   * 判法：把两侧都按**顶层逗号**切开，位置 i 的形参只绑定位置 i 的实参里那个 import()。
   * 位置对不上（长度不等）⇒ 整体不认（宁可漏，不误判）。 */
  // helper 表：`function loadXxx() { … import(<唯一说明符>) … }` ⇒ helperName → target
  const helperTarget = new Map();
  for (const hm of code.matchAll(/function\s+(load[A-Za-z0-9_]*)\s*\(\s*\)\s*\{([\s\S]{0,900}?)\n\s{0,12}\}/g)) {
    const specs = [...hm[2].matchAll(/import\(\s*(['"`])([^'"`]+)\1\s*\)/g)]
      .map((x) => resolveSpecifier(rel, foldSpec(x[2])))
      .filter(Boolean);
    const uniq = [...new Set(specs)];
    if (uniq.length === 1) helperTarget.set(hm[1], uniq[0]);
  }
  const splitTopLevel = (text) => {
    const out = [];
    let depth = 0; let cur = '';
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
      if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const specOfItem = (item) => {
    const im = /import\(\s*(['"`])([^'"`]+)\1\s*\)/.exec(item);
    if (im) return resolveSpecifier(rel, foldSpec(im[2]));
    // helper 形态：loadXxx() —— 由 ⑦b 的 helperTarget 解析
    const hm2 = /^([A-Za-z_$][\w$]*)\s*\(\s*\)$/.exec(item);
    if (hm2 && helperTarget.has(hm2[1])) return helperTarget.get(hm2[1]);
    return null;
  };
  // a) `const [p0, p1, …] = await Promise.all([ … ])`
  for (const pm of code.matchAll(/(?:const|let|var)\s*\[([\s\S]{0,600}?)\]\s*=\s*await\s+Promise\.all\(\s*\[([\s\S]{0,3000}?)\]\s*\)/g)) {
    const params = splitTopLevel(pm[1]);
    const items = splitTopLevel(pm[2]);
    if (params.length !== items.length) continue;              // 位置对不上 ⇒ 不认
    for (let i = 0; i < params.length; i++) {
      const local = params[i];
      if (!/^[A-Za-z_$][\w$]*$/.test(local)) continue;
      const target = specOfItem(items[i]);
      if (target) out.namespaces.push({ target, local, pos: pm.index + i, via: 'promise-all' });
    }
  }
  // b) `Promise.all([ … ]).then(([p0, p1, …]) => …)`
  for (const pm of code.matchAll(/Promise\.all\(\s*\[([\s\S]{0,3000}?)\]\s*\)\s*\.then\(\s*\(\s*\[([^\]]*)\]\s*\)\s*=>/g)) {
    const items = splitTopLevel(pm[1]);
    const params = splitTopLevel(pm[2]);
    if (params.length !== items.length) continue;              // 位置对不上 ⇒ 不认
    for (let i = 0; i < params.length; i++) {
      const local = params[i];
      if (!/^[A-Za-z_$][\w$]*$/.test(local)) continue;         // 省略位（空槽）跳过
      const target = specOfItem(items[i]);
      if (target) out.namespaces.push({ target, local, pos: pm.index + i, via: 'promise-all-then' });
    }
  }

  /* ⑧ 赋值别名（v4.92.0 实测 1 处）：
   *   `SettingsApp = module.SettingsApp;` —— 模块成员先被取成模块级变量，
   *   再由回调参数接住（`loadSettingsModule().then(SettingsAppClass => new SettingsAppClass(…))`）。
   *   只做一层：同文件 `NAME = <NS>.<Member>` ⇒ 记 `target(NS)::Member` 已消费。
   *   取成员这个动作本身就是读取，不需要再追 NAME 的去向。 */
  for (const am of code.matchAll(/([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*;/g)) {
    for (const it of out.namespaces) {
      if (it.local === am[2]) out.named.push({ target: it.target, name: am[3], local: am[1] });
    }
  }

  return out;
}

/**
 * 构建「模块 → 被消费的导出名集合」。
 * @param {Map<string,string>} bindTexts  rel → **只去注释、保留字符串**的文本（绑定解析输入面）
 * @param {object} opts
 *   - codeTexts: rel → 去注释去字符串的真代码；用于「命名空间成员是否真被访问」判定。
 *     缺省时退化为 bindTexts（探针可用，门禁内必须传，否则字符串里的 `NS.X` 会被算成访问）。
 *   - lazyRouteRel: 数据驱动表文件（默认 'config/app-lazy-routes.js'）
 *   - rawTexts: rel → 原文（表字段本体是字符串，取字面量需要）
 * @returns {{ consumed: Map<string, Set<string>>, namespaces: Array, starTargets: Set<string>,
 *             stats: object }}
 */
export function buildConsumptionIndex(bindTexts, opts = {}) {
  const lazyRouteRel = opts.lazyRouteRel || 'config/app-lazy-routes.js';
  const nsTexts = opts.codeTexts instanceof Map ? opts.codeTexts : bindTexts;
  const consumed = new Map();        // targetRel → Set(exportName)
  const namespaces = [];             // { target, local, from }
  const starTargets = new Set();     // 被 `export *` 全量转出的目标（无从静态对账，整体豁免）
  const stats = { files: 0, named: 0, ns: 0, cjs: 0, reexport: 0, star: 0, lazyCls: 0 };

  const add = (target, name) => {
    if (!consumed.has(target)) consumed.set(target, new Set());
    consumed.get(target).add(name);
  };

  for (const [rel, code] of bindTexts) {
    if (typeof code !== 'string') continue;
    stats.files += 1;
    const b = collectBindings(rel, code);
    for (const it of b.named) { add(it.target, it.name); stats.named += 1; }
    for (const it of b.cjs) { add(it.target, it.name); stats.cjs += 1; }
    for (const it of b.namespaces) {
      namespaces.push({ target: it.target, local: it.local, from: rel });
      stats.ns += 1;
    }
    for (const it of b.starReexports) {
      stats.reexport += 1;
      if (it.body === '*') { starTargets.add(it.target); stats.star += 1; }
    }
  }

  // ★ 重导出穿透（v4.92.0 实测的最后一块形态缺口）
  //   `apps/games/games-data.js` 全文只有一行：
  //       export { PokerData as GamesData, STREET_LABELS, HAND_LABELS } from './poker/poker-data.js';
  //   它自己**不声明**任何成员，故不在导出枚举面内，`dead-export-check` 看不见它；
  //   但下游若写 `import { HAND_LABELS } from './games-data.js'`，真正被消费的是
  //   `poker/poker-data.js::HAND_LABELS`。只按「import 说明符 → 该文件」记消费，
  //   就会把源模块判成零消费（假红）。故必须沿 `export {...} from` 链把消费**转发**到源模块。
  //   不穿 `export *`（无名字可对账，已由 starTargets 整体豁免）。
  const forward = new Map();   // 转出模块 rel → Map(对外名 → { target, name })
  for (const [rel, code] of bindTexts) {
    if (typeof code !== 'string') continue;
    const b = collectBindings(rel, code);
    for (const it of b.starReexports) {
      if (it.body === '*') continue;
      if (!forward.has(rel)) forward.set(rel, new Map());
      const m = forward.get(rel);
      for (const part of it.body.split(',')) {
        const seg = part.trim();
        if (!seg) continue;
        const as = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(seg);
        if (as) { m.set(as[2], { target: it.target, name: as[1] }); continue; }
        if (/^[A-Za-z_$][\w$]*$/.test(seg)) m.set(seg, { target: it.target, name: seg });
      }
    }
  }
  if (forward.size) {
    // 转发最多走 4 跳（本项目实测最长 1 跳），带环保护
    const chase = (target, name) => {
      let cur = { target, name };
      const seen = new Set();
      for (let hop = 0; hop < 4; hop++) {
        const table = forward.get(cur.target);
        if (!table) break;
        const next = table.get(cur.name);
        if (!next) break;
        const key = `${next.target}::${next.name}`;
        if (seen.has(key)) break;
        seen.add(key);
        cur = next;
      }
      return cur;
    };
    const pending = [];
    for (const [target, names] of consumed) {
      for (const n of names) {
        const end = chase(target, n);
        if (end.target !== target || end.name !== n) pending.push(end);
      }
    }
    for (const p of pending) { add(p.target, p.name); stats.reexport += 1; }
  }

  // 命名空间成员访问：`NS.X`（**真代码面**）。只在「该 NS 的确指向被扫描模块」时才算。
  //   同一 local 名可能在不同文件里指向不同模块 ⇒ 必须按 from 文件分组解析。
  //
  //   ★ 同名重绑定（v4.92.0 实测的真实陷阱）：`index.js` 里 `const module = await import(...)`
  //     出现 11 次、`mod` 7 次 —— 同一个局部名在不同分支里指向**不同模块**。
  //     若按「文件名 + local」匹配 `module.X`，则 11 个模块会**各自白拿** `module.AlbumApp`、
  //     `module.MusicApp` 等全部成员名，判据当场变成「全绿」。
  //     故对有 pos 的动态绑定按位置切区间：一个绑定只管辖
  //     [本绑定 pos, 同文件下一个同名绑定 pos) 这段文本；静态 `import * as` 无 pos，
  //     按传统口径管全文件（本项目实测 26 处，均无重绑定）。
  const byFile = new Map();
  for (const it of namespaces) {
    if (!byFile.has(it.from)) byFile.set(it.from, []);
    byFile.get(it.from).push(it);
  }
  for (const [from, list] of byFile) {
    const code = nsTexts.get(from);
    if (typeof code !== 'string') continue;
    // 同名分组：有 pos 的按位置排序切区间
    const groups = new Map();
    for (const it of list) {
      const k = `${it.local}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(it);
    }
    for (const [, sameName] of groups) {
      const scoped = sameName.filter((x) => typeof x.pos === 'number').sort((a, b) => a.pos - b.pos);
      const unscoped = sameName.filter((x) => typeof x.pos !== 'number');
      for (let si = 0; si < scoped.length; si++) {
        const it = scoped[si];
        const startIdx = it.pos;
        const endIdx = si + 1 < scoped.length ? scoped[si + 1].pos : code.length;
        const seg = code.slice(startIdx, endIdx);
        collectNsMembers(seg, it.local, (name) => add(it.target, name));
      }
      for (const it of unscoped) {
        collectNsMembers(code, it.local, (name) => add(it.target, name));
      }
    }
  }

  // 数据驱动面：只认登记过的那一个表文件（沿用门禁 v3.61.0 边界）。
  //   表里的 cls 指向哪个模块由同一条目的 `path: '...'` 决定 —— 按绑定级口径，
  //   消费必须记在「解析后的模块::cls」上，而不是「全仓任何叫 XxxApp 的」。
  for (const it of collectLazyRoutes(opts.rawTexts, lazyRouteRel)) {
    add(it.target, it.cls);
    stats.lazyCls += 1;
  }

  return { consumed, namespaces, starTargets, stats };
}

/** 从 lazy-route 表原文抽出 `{ id, module: './a/b.js', cls: 'XxxApp' }` 配对。
 *
 *  • 该表的行形态是「一个对象一行」，字段为 `id / module / key / cls / errTitle`
 *    （**不是** `path` —— 首版探针按 `path:` 解析得到 0 条，就是这个坑）。
 *  • 表文件本身也用 `import('...?v=...')` 形态加载模块，解析前必须剔掉 query 串，
 *    否则 `apps/x/x-app.js?v=1` 与磁盘上的 `apps/x/x-app.js` 对不上。
 *  • 同一条目里 cls 与 module 可能跨行（表被格式化过），故按「对象块」而不是按行配对。
 */
export function collectLazyRoutes(rawTexts, lazyRouteRel = 'config/app-lazy-routes.js') {
  const out = [];
  const raw = rawTexts instanceof Map ? rawTexts.get(lazyRouteRel) : null;
  if (typeof raw !== 'string') return out;
  // 按对象块切：每条路由是 `{ ... }`（表中不含嵌套对象）
  for (const m of raw.matchAll(/\{([^{}]*?)\}/g)) {
    const body = m[1];
    const cls = /cls:\s*['"]([^'"]+)['"]/.exec(body);
    const mod = /module:\s*['"]([^'"]+)['"]/.exec(body);
    if (!cls || !mod) continue;
    // ★ 相对基准：表文件在 config/，`module: './apps/x/x-app.js'` 应解析成 `apps/x/x-app.js`
    //    （不是 config/apps/x/x-app.js）。resolveSpecifier 按「传进来的 fromRel 的目录」算，
    //    但 lazy 表的 module 字段是相对**仓库根**的（index.js 侧 import 也这么写），
    //    故这里不能直接复用 resolveSpecifier —— 手动从仓库根拼接。
    const q = mod[1].search(/[?#]/);
    const clean = q >= 0 ? mod[1].slice(0, q) : mod[1];
    const target = clean.replace(/^\.?\//, '');
    if (target) out.push({ target, cls: cls[1] });
  }
  return out;
}

/** 从一段文本里取 `local.Member` 的成员名（去注释、保留字符串面）。 */
function collectNsMembers(text, local, onName) {
  const esc = local.replace(/[$]/g, '\\$&');
  const re = new RegExp(`(?<![\\w$.])${esc}\\s*\\.\\s*([A-Za-z_$][\\w$]*)`, 'g');
  for (const m of text.matchAll(re)) onName(m[1]);
}

/** 便捷入口：给 (moduleRel, exportName) 判「是否有绑定级跨模块消费」。 */
export function hasBindingConsumer(index, moduleRel, exportName) {
  const set = index.consumed.get(moduleRel);
  if (set && set.has(exportName)) return true;
  if (index.starTargets.has(moduleRel)) return true;   // `export *` 全量转出，无从对账
  return false;
}

/** 供探针使用：读一个目录树里的 js/mjs 源码，返回三份视图。
 *   - texts     rel → 原文
 *   - bindTexts rel → 只去注释、**保留字符串**（绑定解析输入面）
 *   - codeTexts rel → 去注释去字符串的真代码（「真调用」判定输入面）
 */
export function loadTree(root, { skipDirs = new Set(['node_modules', '.git', '.wrangler', 'tests']) } = {}) {
  const texts = new Map();
  const bindTexts = new Map();
  const codeTexts = new Map();
  const walk = function* (dir, base) {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of ents) {
      if (skipDirs.has(ent.name) || ent.name.startsWith('.')) continue;
      const rel = base ? `${base}/${ent.name}` : ent.name;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) yield* walk(abs, rel);
      else if (/(\.js|\.mjs)$/.test(ent.name)) yield { abs, rel };
    }
  };
  for (const f of walk(root, '')) {
    try {
      const raw = fs.readFileSync(f.abs, 'utf8');
      texts.set(f.rel, raw);
      bindTexts.set(f.rel, stripCommentsOnly(raw));
      codeTexts.set(f.rel, stripNonCodeShallow(raw));
    } catch { /* 读不到按不存在算 */ }
  }
  return { texts, bindTexts, codeTexts };
}

/**
 * 极简去注释（保留字符串字面量）。
 *
 * 为什么不能复用 stripNonCode：`import { X } from './m.js'` 的说明符与 `export { A }`
 * 的成员名都**在字符串/结构化语法里**，把字符串一律置空会让 binding 解析归零
 * （实测：在 stripNonCode 产物上跑本模块 ⇒ named=0 / ns=0 / cjs=0，全仓 1251 条
 * 「名字级绿」伪装成「绑定级全红」，判据当场失真）。
 * 故绑定解析跑在「只去注释、保留字符串」的文本上；而「哪里算真调用了这个名字」的
 * 判定仍必须用去字符串的 codeTexts —— 两件事的输入面不同，此处如实分开。
 */
export function stripCommentsOnly(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; out += ' '; continue; }
    if (c === '"' || c === "'") {
      const q = c; out += c; i++;
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] || ''); i += 2; continue; }
        out += src[i];
        if (src[i] === q) { i++; break; }
        if (src[i] === '\n') break;
        i++;
      }
      continue;
    }
    if (c === '`') {
      out += c; i++;
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] || ''); i += 2; continue; }
        out += src[i];
        if (src[i] === '`') { i++; break; }
        i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

/**
 * 极简去注释/去字符串（探针用；门禁内部自有 stripNonCode 全量实现）。
 * 保留模板串的 `${...}` 插值（按代码处理），其余字符串内容置空。
 */
export function stripNonCodeShallow(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  const tmplStack = [];
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'") {
      const q = c; i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q) { i++; break; }
        if (src[i] === '\n') break;
        i++;
      }
      out += ' '; continue;
    }
    if (c === '`') {
      i++;
      let buf = ' ';
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '`') { i++; break; }
        if (src[i] === '$' && src[i + 1] === '{') {
          // 插值按代码处理
          let depth = 1, j = i + 2;
          const start = j;
          while (j < n && depth > 0) {
            if (src[j] === '{') depth++;
            else if (src[j] === '}') depth--;
            j++;
          }
          buf += ' ' + stripNonCodeShallow(src.slice(start, j - 1)) + ' ';
          i = j;
          continue;
        }
        i++;
      }
      out += buf; continue;
    }
    out += c; i++;
  }
  void tmplStack;
  return out;
}
