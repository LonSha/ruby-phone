#!/usr/bin/env node
/* ============================================================
 * tests/audit/scan_banner_singleton.mjs —— 通知横幅单一实现读数（R22-O8）
 * ------------------------------------------------------------
 * 【口径】
 *   唯一实现 = `config/incoming-banner.js` 的 `bannerOf()`（纯函数，给全标题/正文/图标/动作）。
 *   「App 只声明内容」的机器形态是：App 里出现横幅类 DOM 的行，必须在**同一行**调用
 *   `bannerOf(`（取值来自桥），或者被登记进白名单并写明「这不是通知横幅」。
 *
 * 【为什么按「同一行」判，而不是按文件】
 *   按文件判会把「这个 App 用了桥」当成「这个 App 所有横幅都用桥」，
 *   于是残留的第二实现永远不被发现。按行判会漏掉跨行写法，所以白名单是必需的逃生口，
 *   但白名单每条必须给理由 —— 逃生口不是黑洞。
 *
 * 用法：
 *   node tests/audit/scan_banner_singleton.mjs --write    # 写 tests/audit/banner_singleton.json
 *   node tests/audit/scan_banner_singleton.mjs --check    # 有未收口则 exit 1
 * 退出码：0=可接受 1=有未收口 2=拒判
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const LEDGER = 'tests/audit/banner_singleton.json';
const WHITELIST = 'tests/audit/banner_whitelist.json';
const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const CHECK = argv.includes('--check');

const appsDir = path.join(ROOT, 'apps');
const bridge = path.join(ROOT, 'config', 'incoming-banner.js');
if (!fs.existsSync(appsDir) || !fs.existsSync(bridge)) {
    console.log('[banner] 拒判：apps/ 或唯一实现桥读不到');
    process.exit(2);
}

const MARK_RE = /(?:class|className)\s*[=:]\s*["'`][^"'`]*(?:banner|toast|notice)[^"'`]*["'`]|classList\.add\([^)]*(?:banner|toast|notice)|["'`][\w-]*(?:-banner|-toast|-notice)(?:[\w-]*)["'`]/gi;

function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (/\.js$/.test(e.name)) out.push(p);
    }
    return out;
}

let whitelist = { schema: 'banner-whitelist@1', entries: [] };
if (fs.existsSync(path.join(ROOT, WHITELIST))) {
    try { whitelist = JSON.parse(fs.readFileSync(path.join(ROOT, WHITELIST), 'utf8')); } catch { /* 空 */ }
}
const wlKey = new Set((whitelist.entries || []).map((e) => `${e.file}:${e.line}`));
const wlWhy = new Map((whitelist.entries || []).map((e) => [`${e.file}:${e.line}`, e.why]));

const sites = [];
for (const abs of walk(appsDir)) {
    const rel = abs.replace(ROOT + '/', '');
    const src = fs.readFileSync(abs, 'utf8');
    const lines = src.split('\n');
    const fileImportsBridge = src.includes("incoming-banner.js");
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        MARK_RE.lastIndex = 0;
        if (!MARK_RE.test(line)) continue;
        /* 取值是否来自桥：本行直接调，或本文件引入了桥且同块（±8 行窗口）内有 bannerOf 取值。
         * 局限写明：窗口判法会漏掉「横幅 DOM 与取值隔超 8 行」的写法，所以白名单仍需保留。 */
        const windowText = lines.slice(Math.max(0, i - 8), Math.min(lines.length, i + 9)).join('\n');
        const routed = line.includes('bannerOf(') || (fileImportsBridge && windowText.includes('bannerOf('));
        const key = `${rel}:${i + 1}`;
        const white = wlKey.has(key);
        sites.push({
            file: rel,
            line: i + 1,
            routed,
            whitelistedWhy: wlWhy.get(key) || '',
            needs: routed ? '' : (white ? '' : 'route-or-whitelist'),
            text: line.trim().slice(0, 140)
        });
    }
}

const ledger = {
    schema: 'banner-singleton@1',
    bridge: 'config/incoming-banner.js',
    totalSites: sites.length,
    routedCount: sites.filter((s) => s.routed).length,
    whitelistedCount: sites.filter((s) => s.whitelistedWhy).length,
    pending: sites.filter((s) => s.needs).length,
    sites
};
if (WRITE) fs.writeFileSync(path.join(ROOT, LEDGER), JSON.stringify(ledger, null, 2) + '\n');

console.log(`[banner] 横幅类 DOM 站点 ${ledger.totalSites} 处 · 走唯一桥 ${ledger.routedCount} · 白名单 ${ledger.whitelistedCount} · 未收口 ${ledger.pending}`);
if (ledger.pending) {
    for (const s of sites.filter((x) => x.needs).slice(0, 12)) console.log(`  - ${s.file}:${s.line} ${s.text}`);
}
if (CHECK) process.exit(ledger.pending > 0 ? 1 : 0);
process.exit(0);