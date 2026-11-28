/* ============================================================
 * tests/_style_split.mjs — O4 之后「样式唯一真源 + 投递路径」的共用判据
 * ------------------------------------------------------------
 * 背景（R25-O4）：9 个 App 的独占规则已由 tools/split_phone_css_lazy.mjs
 *   从 phone.css 摘出，各自 apps/<id>/<id>.css 成为**唯一真源**，
 *   由 config/style-lazy.js 的 STYLE_LAZY 账在打开 App 时懒加载。
 *
 * 于是老判据查的位置不存在了。改写不是放宽，而是换成更强的一条：
 *   · 本 App 的样式必须在自己那份 css 里（唯一真源在盘）；
 *   · 账本必须把 appId 指向本份 css（指错了 = 投递到别人家）；
 *   · 账本申报的字节数**只作参考、不作判据**（搬迁时记的是「搬走的规则字节」，
 *     不等于整份文件字节 —— 9 条实测全部不等，拿它当断言必红且是错的判据）；
 *   · phone.css 里**不得再残留**本 App 的独占前缀规则（否则又变两处，正是老判据要防的）。
 *
 * 只读三个文件、不做断言 —— 判定仍留在各个 v3xxx 套件里（纪律：判据自带判定）。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';

export function prefixAuditFiles(root, self) {
  const files = [];
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      if (dir === root && e.name === '.sourcematerial') continue; // Private import inputs, not implementation.
      const full = path.join(dir, e.name);
      if (full === self) continue;
      if (e.isDirectory()) walk(full);
      else if (/\.(js|css|mjs|json|html)$/.test(e.name)) files.push(full);
    }
  }
  walk(root);
  return files;
}

const readOr = (root, rel) => {
  try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch (_e) { return null; }
};

/* 剥掉块注释再数残留：本仓纪律「**注释里的提及不算消费**」。
 * ★ 为什么必须剥：phone.css 里有说明性注释写着「前缀族 `.cm-*`（与 affairs 的 `.af-*` 不重合）」，
 *   那是**说明**不是**规则**；不剥就会把说明当成残留副本，判据自己说谎。
 * ★ 本剥器只处理块注释（样式文件里不存在行注释），不做别的解析。 */
const stripCssComments = (text) => String(text).replace(/\/\*[\s\S]*?\*\//g, '');

/** 段头行是否「行首块注释起头、行尾块注释收尾、且行内只有一个注释对」。 */
export function headerLineFacts(cssText, mark) {
  if (!cssText) return { found: false, reason: 'css 不存在或读不到' };
  const at = cssText.indexOf(mark);
  if (at < 0) return { found: false, reason: '段头标记不在文件里：' + mark };
  const NL = '\n';
  const lineStart = cssText.lastIndexOf(NL, at) + 1;
  const lineEnd = cssText.indexOf(NL, at);
  const line = cssText.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
  return {
    found: true,
    line: line,
    atLineStart: lineStart === 0 || cssText[lineStart - 1] === NL,
    startsWithBlock: line.startsWith('/*'),
    endsWithBlock: line.trimEnd().endsWith('*/'),
    commentPairs: line.split('/*').length - 1,
  };
}

/**
 * @param {string} root 仓库根
 * @param {{appId:string, cssRel:string, headerMark:string, prefixes:string[]}} spec
 */
export function styleSplitFacts(root, spec) {
  const appId = String(spec.appId);
  const cssRel = spec.cssRel;
  const prefixes = spec.prefixes || [];
  const css = readOr(root, cssRel);
  const bundle = readOr(root, 'phone.css');
  const lazySrc = readOr(root, 'config/style-lazy.js') || '';
  const cssBytes = css === null ? null : Buffer.byteLength(css, 'utf8');

  /* 账本条：`{ appId: 'sourcebook', css: './apps/sourcebook/sourcebook.css', … bytes: 13719 … }` */
  const entryRe = new RegExp(
    "appId:\\s*'" + appId + "'[\\s\\S]{0,400}?css:\\s*'([^']+)'([\\s\\S]{0,400}?)bytes:\\s*(\\d+)"
  );
  const m = lazySrc.match(entryRe);
  const ledger = m
    ? { present: true, css: m[1], bytes: Number(m[3]) }
    : { present: false, css: null, bytes: null };

  /* phone.css 残留：按「独占类前缀后接类名字符」计数（先剥注释：只认选择器形态，不认注释散字）。 */
  let residual = 0;
  if (bundle) {
    const bundleRules = stripCssComments(bundle);
    for (const p of prefixes) {
      const re = new RegExp('\\.' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[A-Za-z0-9_-]*', 'g');
      const hits = bundleRules.match(re);
      if (hits) residual += hits.length;
    }
  }

  const header = headerLineFacts(css, spec.headerMark);
  return {
    appId,
    cssRel,
    cssExists: css !== null,
    cssBytes,
    cssEmpty: !css || !css.trim(),
    header,
    ledger,
    /* 账把 appId 指向本份 css（允许 './' 前缀差异） */
    ledgerPointsHere: !!ledger.present && String(ledger.css).replace(/^\.\//, '') === cssRel,
    /* 账本字节必须等于真文件（账本说谎 = 投递计划按错的量算） */
    ledgerBytesAccurate: ledger.present && ledger.bytes === cssBytes,
    bundleResidual: residual,
  };
}
