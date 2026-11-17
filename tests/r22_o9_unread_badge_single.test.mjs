#!/usr/bin/env node
/**
 * tests/r22_o9_unread_badge_single.test.mjs — 未读角标单口径判据（计划 R22-O9）
 * ------------------------------------------------------------
 * 正面：三个曾经自算的站点已全部改走 badgeOf，扫描器 rc=0，桥自检绿。
 * 反面（每条都证明门禁抓得住，而不是「跑通了就算」）：
 *   ① apps/ 下自算 unread 求和 → 必须报；
 *   ② setAppBadge('wechat', X) 不引 badgeOf → 必须报；
 *   ③ setAppBadge('wechat', 0)（清空）不引 → **不许**报（否则等于把清空逻辑逼成假接线）；
 *   ④ 白名单条目理由过短 → 必须判不合格；
 *   ⑤ 白名单条目已不命中 → 必须判过期（防用一张过期白名单永久免检）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scanUnreadBadgeSingle } from './audit/scan_unread_badge_single.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, '..');

let pass = 0;
let fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('✓ ' + name); }
  else { fail++; console.log('✗ ' + name + (extra ? '  → ' + JSON.stringify(extra) : '')); }
}

const whitelist = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/audit/unread_badge_whitelist.json'), 'utf8'));
const real = await scanUnreadBadgeSingle({ rootDir: ROOT });

/* ── 正面 ─────────────────────────────────────────────── */
assert('真仓扫描 rc=0', real.status === 'ok' && real.exitCode === 0, real.violations);
assert('apps/ 下自算 unread 求和 = 0 处', (real.violations.selfCompute || []).length === 0, real.violations.selfCompute);
assert("setAppBadge('wechat') 全部走 badgeOf", (real.violations.badgeWithoutBridge || []).length === 0, real.violations.badgeWithoutBridge);
assert('桥 config/unread-badge.js 自检绿（badgeOf + selfCheck）', real.bridge.ok === true && real.bridge.hasBadgeOf === true, real.bridge);
assert('白名单 1 条（通知中心），且真命中', real.whitelistUsed === 1, { used: real.whitelistUsed });

/* 三个原自算站点：必须引桥、且不再自 reduce */
for (const f of ['apps/wechat/chat-view.js', 'apps/weibo/weibo-data.js', 'apps/games/poker/poker-app.js']) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  assert(`${f} 引入 badgeOf 且无自算求和`,
    /unread-badge\.js/.test(src) && !/reduce\([^\n]*unread/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')),
    { f });
}

/* 桥行为：三态 + 封顶 + NaN 安全（这是「单口径」真能成立的前提） */
const bridgeMod = await import(pathToFileURL(path.join(ROOT, 'config/unread-badge.js')).href);
assert('badgeOf 空列表 → none/0/空标签',
  bridgeMod.badgeOf([]).face === 'none' && bridgeMod.badgeOf([]).total === 0 && bridgeMod.badgeOf([]).label === '');
assert('badgeOf 求和正确（3+2=5）', bridgeMod.badgeOf([{ unread: 3 }, { unread: 2 }]).total === 5);
assert('badgeOf 封顶 99+（60+50）',
  bridgeMod.badgeOf([{ unread: 60 }, { unread: 50 }]).face === 'capped' && bridgeMod.badgeOf([{ unread: 60 }, { unread: 50 }]).label === '99+');
assert('badgeOf 对 null/坏值不抛且不计',
  bridgeMod.badgeOf([{ unread: null }, null, { unread: 'x' }]).face === 'none');
assert('unreadBadgeSelfCheck 自报绿', bridgeMod.unreadBadgeSelfCheck().ok === true, bridgeMod.unreadBadgeSelfCheck());

/* ── 反面控制 ① 自算求和 ────────────────────────────────── */
{
  const src = "const t = list.reduce((s, c) => s + (Number(c.unread) || 0), 0);\nwindow.VirtualPhone.setAppBadge('wechat', t);\nimport { badgeOf } from '../../config/unread-badge.js';\n";
  const r = await scanUnreadBadgeSingle({ rootDir: ROOT, sources: { 'apps/x/x-app.js': src }, whitelist: { entries: [] } });
  assert('负控制①：自算求和 → 报 selfCompute', (r.violations.selfCompute || []).some((v) => v.file === 'apps/x/x-app.js'), r.violations);
}

/* ── 反面控制 ② setAppBadge 未走桥 ─────────────────────── */
{
  const src = "const t = 5;\nwindow.VirtualPhone.setAppBadge('wechat', t);\n";
  const r = await scanUnreadBadgeSingle({ rootDir: ROOT, sources: { 'apps/y/y-app.js': src }, whitelist: { entries: [] } });
  assert('负控制②：未引桥 → 报 badgeWithoutBridge',
    (r.violations.badgeWithoutBridge || []).some((v) => v.file === 'apps/y/y-app.js'), r.violations);
}

/* ── 反面控制 ③ 清空角标属合法例外 ─────────────────────── */
{
  const src = "window.VirtualPhone.setAppBadge('wechat', 0);\n";
  const r = await scanUnreadBadgeSingle({ rootDir: ROOT, sources: { 'apps/z/z-app.js': src }, whitelist: { entries: [] } });
  assert("负控制③：setAppBadge('wechat',0) 不误报", (r.violations.badgeWithoutBridge || []).length === 0, r.violations);
}

/* ── 反面控制 ④ 白名单理由过短 ─────────────────────────── */
{
  const src = "const t = Object.keys(m).reduce((s, k) => s + m[k].unread, 0);\n";
  const r = await scanUnreadBadgeSingle({
    rootDir: ROOT,
    sources: { 'apps/n/n-view.js': src },
    whitelist: { entries: [{ file: 'apps/n/n-view.js', why: '不是' }] },
  });
  assert('负控制④：白名单理由过短 → 判不合格', (r.violations.badWhitelist || []).length === 1, r.violations.badWhitelist);
}

/* ── 反面控制 ⑤ 白名单过期 ─────────────────────────────── */
{
  const r = await scanUnreadBadgeSingle({
    rootDir: ROOT,
    sources: { 'apps/ok/ok.js': 'const a = 1;\n' },
    whitelist: { entries: [{ file: 'apps/gone/gone.js', why: '这条理由足够长但文件里已经没有自算求和的命中了，属于过期条目。' }] },
  });
  assert('负控制⑤：白名单不命中 → 判过期', (r.violations.staleWhitelist || []).some((v) => v.file === 'apps/gone/gone.js'), r.violations.staleWhitelist);
}

/* 白名单文件本身必须逐条带理由（防止把白名单当免检名单用） */
assert('白名单条目全部带理由（≥12 字）', whitelist.entries.every((e) => typeof e.why === 'string' && e.why.trim().length >= 12));

console.log('\n' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);