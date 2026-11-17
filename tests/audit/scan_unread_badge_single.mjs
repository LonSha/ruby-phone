#!/usr/bin/env node
/**
 * tests/audit/scan_unread_badge_single.mjs — 未读角标单口径扫描（计划 R22-O9）
 * ------------------------------------------------------------
 * 为什么需要这一面（R22-O9 真实现场）：
 *   未读判定早已收口到 `apps/wechat/chat-read-cursor.js`（R21-X1），角标**绘制**没收：
 *   `apps/wechat/chat-view.js` / `apps/weibo/weibo-data.js` / `apps/games/poker/poker-app.js`
 *   各自 `reduce((sum,c)=>sum+(Number(c.unread)||0),0)` 数一遍 —— 三份口径，任何一份
 *   漏掉封顶（99+）或漏掉 NaN 安全，桌面红点就和会话列表对不上，且**不报错、只错数字**。
 *
 * 判定规则：
 *   R1 汇总唯一：`apps/` 下不许再出现「对本会话 unread 求和」的 reduce；
 *      唯一允许的实现是 `config/unread-badge.js` 的 `badgeOf`。
 *      （白名单逐条带理由：不是微信会话未读的求和，例如通知中心的按 App 未读汇总。）
 *   R2 写角标必走桥：调用 `setAppBadge('wechat', X)` 的文件必须引入 badgeOf
 *      —— 允许 X 字面量 `0`（清空），那种情况本来就不需要求和。
 *   R3 桥自身自检：`config/unread-badge.js` 必须导出 badgeOf，且 unreadBadgeSelfCheck() 绿。
 *   R4 fail-closed：扫到的文件数低于阈值 / 白名单条目对不上真实命中 ⇒ exit 2（探针失效不许算通过）。
 *
 * 退出码：0 通过 / 1 违规 / 2 结构失效。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.RUBY_AUDIT_ROOT || path.resolve(__dir, '../..');
const MIN_FILES = 400;
const BADGE_BRIDGE = 'config/unread-badge.js';

export function stripComments(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

function collectFiles(dir, base, out) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_e) { return; }
  for (const e of entries) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collectFiles(p, base, out);
    else if (e.name.endsWith('.js')) out.push(path.relative(base, p));
  }
}

const SUM_UNREAD_RE = /reduce\s*\([^\n]*unread/;
const SET_BADGE_RE = /setAppBadge\s*\(\s*['"]wechat['"]\s*,\s*([^)]*)\)/g;

/**
 * 纯函数入口：便于判据注入合成源码做负控制。
 * @param {object} opts
 * @param {Map<string,string>|object} [opts.sources] 相对路径 → 源码（不传则真读盘）
 * @param {object} [opts.whitelist] 白名单对象
 * @param {string} [opts.rootDir]
 */
export async function scanUnreadBadgeSingle(opts = {}) {
  const rootDir = opts.rootDir || ROOT;

  const whitelist = opts.whitelist !== undefined
    ? opts.whitelist
    : (() => {
        try {
          return JSON.parse(fs.readFileSync(path.join(rootDir, 'tests/audit/unread_badge_whitelist.json'), 'utf8'));
        } catch (_e) { return null; }
      })();
  if (!whitelist || !Array.isArray(whitelist.entries)) {
    return { status: 'fail_closed', exitCode: 2, error: '读不到 tests/audit/unread_badge_whitelist.json（或其 entries 不是数组）' };
  }

  let sources;
  if (opts.sources) {
    sources = opts.sources instanceof Map ? opts.sources : new Map(Object.entries(opts.sources));
  } else {
    const files = [];
    collectFiles(path.join(rootDir, 'apps'), rootDir, files);
    collectFiles(path.join(rootDir, 'config'), rootDir, files);
    sources = new Map();
    for (const f of files) {
      try { sources.set(f, fs.readFileSync(path.join(rootDir, f), 'utf8')); } catch (_e) { /* 读不到就不扫 */ }
    }
  }

  if (!opts.sources && sources.size < MIN_FILES) {
    return { status: 'fail_closed', exitCode: 2, error: `扫到的 .js 文件数 ${sources.size} < ${MIN_FILES}，探针失效 fail-closed` };
  }

  const allowed = new Map();
  const badWhitelist = [];
  for (const e of whitelist.entries) {
    if (!e || typeof e.file !== 'string' || !e.file) { badWhitelist.push({ why: '条目缺 file' }); continue; }
    if (typeof e.why !== 'string' || e.why.trim().length < 12) {
      badWhitelist.push({ file: e.file, why: '白名单条目必须写清「为什么这不是微信会话未读求和」（≥12 字）' });
      continue;
    }
    allowed.set(e.file, e.why);
  }

  const selfCompute = [];
  const badgeWithoutBridge = [];
  const staleWhitelist = [];
  const whitelistHit = new Set();

  for (const [file, raw] of sources.entries()) {
    if (file === BADGE_BRIDGE) continue;              // 桥自身就是求和实现
    const src = stripComments(raw);

    if (SUM_UNREAD_RE.test(src)) {
      if (allowed.has(file)) whitelistHit.add(file);
      else selfCompute.push({ file, why: 'apps/ 下自算未读求和（应走 config/unread-badge.js 的 badgeOf）' });
    }

    SET_BADGE_RE.lastIndex = 0;
    let m;
    let needsBridge = false;
    while ((m = SET_BADGE_RE.exec(src)) !== null) {
      const arg = String(m[1] || '').trim();
      if (arg === '0') continue;                       // 清空角标不需要求和
      needsBridge = true;
    }
    if (needsBridge && !/from\s+['"][^'"]*unread-badge\.js/.test(src)) {
      badgeWithoutBridge.push({ file, why: "调用 setAppBadge('wechat', X) 却未引入 badgeOf（角标值来源不可追）" });
    }
  }

  for (const f of allowed.keys()) if (!whitelistHit.has(f)) staleWhitelist.push({ file: f, why: '白名单条目已不命中（过期条目）' });

  /* R3 桥自检：真 import 一次 config/unread-badge.js，跑它的 selfCheck */
  let bridge = { ok: false, note: '未检查' };
  if (!opts.sources) {
    try {
      const mod = await import(pathToFileURL(path.join(rootDir, BADGE_BRIDGE)).href);
      const hasBadgeOf = typeof mod.badgeOf === 'function';
      const sc = typeof mod.unreadBadgeSelfCheck === 'function' ? mod.unreadBadgeSelfCheck() : { ok: false, bad: ['缺 selfCheck'] };
      bridge = { ok: hasBadgeOf && sc.ok === true, hasBadgeOf, selfCheck: sc };
    } catch (e) {
      bridge = { ok: false, note: String((e && e.message) || e).slice(0, 200) };
    }
  } else {
    bridge = { ok: true, note: 'synthetic 模式不检查桥' };
  }

  const violations = { selfCompute, badgeWithoutBridge, badWhitelist, staleWhitelist };
  const bad = selfCompute.length + badgeWithoutBridge.length + badWhitelist.length + staleWhitelist.length + (bridge.ok ? 0 : 1);
  return {
    status: bad > 0 ? 'defect' : 'ok',
    exitCode: bad > 0 ? 1 : 0,
    scanned: sources.size,
    whitelistUsed: whitelistHit.size,
    bridge,
    violations,
    totalViolations: bad,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const res = await scanUnreadBadgeSingle({});
  if (res.status === 'fail_closed') {
    console.error(`[unread-badge] FAIL-CLOSED (exit 2): ${res.error}`);
    process.exit(2);
  }
  for (const [k, label] of Object.entries({
    selfCompute: 'apps/ 下自算未读求和',
    badgeWithoutBridge: "setAppBadge('wechat') 未走 badgeOf",
    badWhitelist: '白名单条目不合格',
    staleWhitelist: '白名单条目过期',
  })) {
    const arr = res.violations[k] || [];
    if (!arr.length) continue;
    console.error(`[unread-badge] ${label}（${arr.length}）：`);
    for (const v of arr) console.error('  - ' + JSON.stringify(v));
  }
  if (!res.bridge.ok) console.error('[unread-badge] 桥自检未过：' + JSON.stringify(res.bridge));
  if (res.exitCode !== 0) process.exit(res.exitCode === 1 ? 1 : 2);
  console.log(`[unread-badge] 检查通过：扫 ${res.scanned} 文件，自算未读求和 0 处`
    + `（白名单 ${res.whitelistUsed} 条，均带理由），setAppBadge('wechat') 全部走 badgeOf。`);
  process.exit(0);
}