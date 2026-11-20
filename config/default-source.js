/**
 * config/default-source.js — 默认值单一真源与显示值对拍 [R26-O5]
 *
 * 立项时的空缺（原文）：同一默认值在多处各写一遍，改一处忘一处。
 * 验收口径：默认值只有一处声明；界面显示值与声明值逐项一致。
 *
 * 这里把「只有一处」落成两条可复跑的机器判据：
 *  ① **同名即冲突**：同一个 `DEFAULT_XXX` 名字出现在两个文件里，不管是不是 export，
 *     一律点名两处。名字复用 = 迟早有一处被改漏。
 *  ② **显示值必须等于声明值**：设置面显示的那个数/字符串，必须与声明逐字相同。
 *     字面量才能逐字对拍；`{` / 数组这种多行结构只登记不逐字比（见 `literal: false`），
 *     但**绝不因为比不了就当成一致** —— 它在报告里单独列 `nonLiteral`，读数不冒充。
 *
 * 第三件要说清的事：界面显示了一个**根本没声明过**的默认值，那是「界面自己写了一份」，
 * 单列 `uiOrphan`，与「值不一致」分开报 —— 两种错因，两种修法。
 */

/** 扫描面的两种作用域：导出的默认值（对外契约）与模块私有默认值（内部实现）。 */
export const DEFAULT_SCOPES = Object.freeze(['export', 'private']);

const EXPORT_DECL = /^\s*export\s+const\s+(DEFAULT_[A-Z0-9_]+)\s*=\s*(.*)$/;
const PRIVATE_DECL = /^\s*const\s+(DEFAULT_[A-Z0-9_]+)\s*=\s*(.*)$/;

/** 简单字面量才能逐字对拍：数字 / 字符串 / 布尔 / null。其它一律 `literal:false`。 */
function literalValue(text) {
  const t = String(text == null ? '' : text).replace(/\s*\/\/.*$/, '').trim();
  const bare = t.replace(/[;,]\s*$/, '').trim();
  if (/^-?\d+(?:\.\d+)?$/.test(bare)) return { literal: true, value: String(Number(bare)) };
  if (/^'(?:[^'\\]|\\.)*'$/.test(bare) || /^"(?:[^"\\]|\\.)*"$/.test(bare)) {
    return { literal: true, value: bare.slice(1, -1) };
  }
  if (bare === 'true' || bare === 'false') return { literal: true, value: bare };
  if (bare === 'null') return { literal: true, value: 'null' };
  return { literal: false, value: null };
}

/**
 * 从「文件 → 源码文本」里扫出默认值声明。
 * @param {Record<string,string>} sources
 * @returns {{declarations: Array<{file:string,name:string,scope:string,literal:boolean,value:string|null}>,
 *            byName: Record<string, string[]>, duplicates: Array<{name:string,files:string[]}>}}
 */
export function scanDefaultDeclarations(sources) {
  if (!sources || typeof sources !== 'object') throw new TypeError('scanDefaultDeclarations 需要 {文件: 源码} 对象');
  const declarations = [];
  for (const file of Object.keys(sources).sort()) {
    const text = String(sources[file] == null ? '' : sources[file]);
    for (const line of text.split('\n')) {
      const m = EXPORT_DECL.exec(line) || PRIVATE_DECL.exec(line);
      if (!m) continue;
      const scope = EXPORT_DECL.test(line) ? 'export' : 'private';
      const lit = literalValue(m[2]);
      declarations.push({ file, name: m[1], scope, literal: lit.literal, value: lit.value });
    }
  }
  const byName = {};
  for (const d of declarations) {
    (byName[d.name] = byName[d.name] || []).push(d.file);
  }
  const duplicates = Object.keys(byName)
    .filter((name) => new Set(byName[name]).size > 1)
    .sort()
    .map((name) => ({ name, files: [...new Set(byName[name])].sort() }));
  return { declarations, byName, duplicates };
}

/**
 * 审计：同名冲突 + 显示值与声明值对拍 + 界面自造默认值。
 * @param {ReturnType<typeof scanDefaultDeclarations>} scan
 * @param {{uiValues?: Record<string, string|number|boolean|null>}} [opts]
 */
export function auditDefaultSource(scan, opts = {}) {
  if (!scan || !Array.isArray(scan.declarations)) throw new TypeError('auditDefaultSource 需要 scanDefaultDeclarations 的结果');
  const uiValues = (opts && opts.uiValues) || {};
  /** 同名声明取**第一条**作为「声明值」，但冲突本身已经由 duplicates 点名，这里不掩盖。 */
  const declared = new Map();
  for (const d of scan.declarations) {
    if (!declared.has(d.name)) declared.set(d.name, d);
  }
  const uiMismatch = [];
  const uiOrphan = [];
  const nonLiteral = [];
  for (const name of Object.keys(uiValues).sort()) {
    const shown = uiValues[name];
    const decl = declared.get(name);
    if (!decl) {
      uiOrphan.push({ name, displayed: shown });
      continue;
    }
    if (decl.literal !== true) {
      nonLiteral.push({ name, file: decl.file, displayed: shown });
      continue;
    }
    const a = String(shown == null ? '' : shown);
    const b = String(decl.value == null ? '' : decl.value);
    if (a !== b) uiMismatch.push({ name, file: decl.file, declared: b, displayed: a });
  }
  const exported = scan.declarations.filter((d) => d.scope === 'export');
  const privates = scan.declarations.filter((d) => d.scope === 'private');
  const ok = scan.duplicates.length === 0 && uiMismatch.length === 0 && uiOrphan.length === 0;
  return {
    ok,
    total: scan.declarations.length,
    exported: exported.length,
    privateCount: privates.length,
    duplicates: scan.duplicates,
    uiMismatch,
    uiOrphan,
    nonLiteral,
    checkedUi: uiMismatch.length + uiOrphan.length + nonLiteral.length,
  };
}

/** 裁定文案：冲突与漂移都要能一眼定位到「哪个名字、哪个文件」。 */
export function defaultSourceText(report) {
  if (!report || typeof report !== 'object') return '默认值真源：无读数（未审计）';
  const lines = [];
  const head = report.ok === true ? '默认值真源：一致' : '默认值真源：不一致';
  lines.push(`${head}（声明 ${report.total} 条 · 导出 ${report.exported} · 私有 ${report.privateCount}）`);
  if (report.duplicates.length) {
    lines.push(`同名冲突 ${report.duplicates.length} 处：` + report.duplicates.slice(0, 3).map((d) => `${d.name}（${d.files.join(' / ')}）`).join('；'));
  }
  if (report.uiMismatch.length) {
    lines.push(`显示值与声明值不符 ${report.uiMismatch.length} 处：` + report.uiMismatch.slice(0, 3).map((d) => `${d.name} 声明 ${d.declared} / 显示 ${d.displayed}`).join('；'));
  }
  if (report.uiOrphan.length) {
    lines.push(`界面自造默认值 ${report.uiOrphan.length} 处：` + report.uiOrphan.slice(0, 3).map((d) => d.name).join('；'));
  }
  if (report.nonLiteral.length) {
    lines.push(`多行结构未逐字对拍 ${report.nonLiteral.length} 处：` + report.nonLiteral.slice(0, 3).map((d) => d.name).join('；') + '（只登记不比字面量，不当成一致）');
  }
  return lines.join('\n');
}

export function defaultSourceSelfCheck() {
  const sources = {
    'a.js': "export const DEFAULT_PAGE_SIZE = 6;\n",
    'b.js': "const DEFAULT_PAGE_SIZE = 12;\n",
    'c.js': "export const DEFAULT_LIMIT = { n: 1 };\n",
  };
  const scan = scanDefaultDeclarations(sources);
  const one = auditDefaultSource(scan, { uiValues: { DEFAULT_PAGE_SIZE: '6' } });
  const bad = auditDefaultSource(scan, { uiValues: { DEFAULT_PAGE_SIZE: '7', DEFAULT_NOT_DECLARED: '1' } });
  const okGreen =
    scan.declarations.length === 3 &&
    scan.duplicates.length === 1 &&
    scan.duplicates[0].name === 'DEFAULT_PAGE_SIZE' &&
    scan.duplicates[0].files.join(',') === 'a.js,b.js' &&
    one.ok === false &&
    bad.uiMismatch.length === 1 &&
    bad.uiOrphan.length === 1 &&
    bad.nonLiteral.length === 0;
  return { ok: okGreen === true, bad, sample: defaultSourceText(one) };
}
