/**
 * config/theme-hardcode.js — 私有硬编码色板清零审计 [R26-O8]
 *
 * 立项时的空缺（原文）：R24-O4 让令牌生效，但每 App 的私有色板仍硬编码。
 * 验收口径：换主题后全 App 观感一致；私有硬编码逐条清零。
 *
 * 三层口径：
 *  ① **只认「字面量颜色」**：`#fff` / `#ffffff` / `rgb()/rgba()/hsl()/hsla()`。
 *     走令牌的 `var(--token)` 不算硬编码 —— 那正是我们要的形态。
 *  ② **豁免必须逐条登记**（文件 + 颜色值），且豁免也要数出来；不许用「整个文件豁免」糊过去。
 *  ③ **ok 只在 remaining 为 0 时为真**。真仓现状大概率不为 0，那就如实报「还剩 N 处」，
 *     文案里点名前几处（文件:行号 值），不许只说一个数字。
 */

/** 颜色字面量的三种写法。`var(--x)` 不在其中（它就是令牌）。 */
export const COLOR_PATTERNS = Object.freeze([
  { id: 'hex', re: /#[0-9a-fA-F]{3,8}\b/g },
  { id: 'rgb', re: /\brgba?\(\s*[0-9.,%\s]+\)/g },
  { id: 'hsl', re: /\bhsla?\(\s*[0-9.,%\s]+\)/g },
]);

/**
 * 扫描源码里的颜色字面量。
 * @param {Record<string,string>} sources 形如 { '文件路径': 源码文本 }
 * @returns {{hits: Array<{file:string,line:number,value:string}>, total:number, byFile: Record<string, number>}}
 */
export function scanHardcodedColors(sources) {
  if (!sources || typeof sources !== 'object') throw new TypeError('scanHardcodedColors 需要 {文件: 源码} 对象');
  const hits = [];
  for (const file of Object.keys(sources).sort()) {
    const text = String(sources[file] == null ? '' : sources[file]);
    const lines = text.split('\n');
    lines.forEach((line, idx) => {
      for (const p of COLOR_PATTERNS) {
        p.re.lastIndex = 0;
        const found = line.match(p.re);
        if (!found) continue;
        for (const value of found) hits.push({ file, line: idx + 1, value });
      }
    });
  }
  const byFile = {};
  for (const h of hits) byFile[h.file] = (byFile[h.file] || 0) + 1;
  return { hits, total: hits.length, byFile };
}

/**
 * 与豁免表对拍。
 * @param {ReturnType<typeof scanHardcodedColors>} scan
 * @param {{allowlist?: Array<{file:string, value:string, note?:string}>}} [opts]
 */
export function auditThemeHardcode(scan, opts = {}) {
  if (!scan || !Array.isArray(scan.hits)) throw new TypeError('auditThemeHardcode 需要扫描结果');
  const allowlist = Array.isArray(opts && opts.allowlist) ? opts.allowlist : [];
  for (const a of allowlist) {
    if (!a || typeof a.file !== 'string' || typeof a.value !== 'string') {
      throw new TypeError('豁免项必须逐条写明 file 与 value');
    }
  }
  const key = (file, value) => `${file}::${value.toLowerCase()}`;
  const allowedKeys = new Set(allowlist.map((a) => key(a.file, a.value)));
  const allowed = [];
  const remaining = [];
  for (const h of scan.hits) {
    if (allowedKeys.has(key(h.file, h.value))) allowed.push(h);
    else remaining.push(h);
  }
  const unusedAllowlist = allowlist.filter((a) => !scan.hits.some((h) => key(h.file, h.value) === key(a.file, a.value)));
  return {
    total: scan.hits.length,
    allowed: allowed.length,
    remaining,
    remainingCount: remaining.length,
    unusedAllowlist: unusedAllowlist.map((a) => `${a.file} ${a.value}`),
    ok: remaining.length === 0,
  };
}

export function themeHardcodeText(report) {
  if (!report || typeof report !== 'object') return '主题硬编码：无读数（未审计）';
  const head = `主题硬编码：${report.ok === true ? '已清零' : '仍有残留'}（共 ${report.total} 处 · 豁免 ${report.allowed} · 待清 ${report.remainingCount}）`;
  const lines = [head];
  if (report.remaining.length) {
    lines.push('待清前几处：' + report.remaining.slice(0, 4).map((h) => `${h.file}:${h.line} ${h.value}`).join('；'));
  }
  if (report.unusedAllowlist.length) {
    lines.push(`失效豁免 ${report.unusedAllowlist.length} 条：` + report.unusedAllowlist.slice(0, 3).join('；'));
  }
  return lines.join('\n');
}

export function themeHardcodeSelfCheck() {
  const scan = scanHardcodedColors({
    'apps/a/style.css': 'body { color: #fff; background: var(--bg); }\n.x { border-color: rgba(0,0,0,.2); }\n',
    'apps/b/theme.js': "export const ACCENT = '#FF00AA';\nconst token = 'var(--accent)';\n",
  });
  const pass = auditThemeHardcode(scan, {
    allowlist: [
      { file: 'apps/a/style.css', value: '#fff', note: '白色在明暗两套里都是 #fff' },
      { file: 'apps/a/style.css', value: 'rgba(0,0,0,.2)' },
      { file: 'apps/b/theme.js', value: '#FF00AA' },
    ],
  });
  const fail = auditThemeHardcode(scan, { allowlist: [{ file: 'apps/a/style.css', value: '#fff' }] });
  const ok =
    scan.total === 3 &&
    !scan.hits.some((h) => h.value.includes('var(')) &&
    pass.ok === true &&
    pass.remainingCount === 0 &&
    fail.ok === false &&
    fail.remainingCount === 2 &&
    themeHardcodeText(fail).includes('仍有残留') &&
    themeHardcodeText(pass).includes('已清零') &&
    auditThemeHardcode(scan, { allowlist: [{ file: 'apps/a/style.css', value: '#abc' }] }).unusedAllowlist.length === 1;
  return { ok, bad: fail, sample: themeHardcodeText(fail) };
}