#!/usr/bin/env node
/* ============================================================
 * RubyPhone 桥消费面契约门禁（bridge contract gate）— [v2.97.0] 第九道门
 * ------------------------------------------------------------
 * 为什么存在（本仓反复出现的病，这一次长在「上游桥读取」上）：
 *   上游两个只读世界桥（lonsha_memory_bridge_v1 / worldaxis_bridge_v1）是**同规格接口**，
 *   于是每个消费它的 App 都自己写一遍读取，实测得到三处重复：
 *     ① 桥名字面量 **8 处**（5 个 App 各 1 + world-bridge + 搜索 + 撩语），
 *        每一处的注释都写着「改一处即两边失联」—— 也就是说**没有任何机制**防它；
 *     ② `probeBridge()` **7 份**同构实现（place/wallet/profile/plotline/chars/clock/ledger）；
 *     ③ 归因阶梯 5 份同构。
 *   重复实现的代价在本版当场兑现为**一个真缺陷**：clock / ledger 的两份是照着早期
 *   规格抄的，写了 `bridge.snapshot ? bridge.snapshot() : null` —— 把**推送型**桥的
 *   `snapshot`（对象）当函数调用，必然抛 TypeError 并被 catch 吞掉，
 *   于是 snap 恒为 null、两个 App 永久显示「桥在但没快照」，哪怕桥里躺着完整快照。
 *   这与本仓最贵的缺陷形态（不报错、不崩溃、只错结果）完全同形。
 *
 * 判据（三条契约 + 两条自证）：
 *   J1（单一真源）两个桥的**全局挂载名字面量**只允许出现在 config/world-bridge.js（各 1 次）。
 *      其余产品文件（apps/**、config/**）一律 0 次 —— 要桥名就 import 真源常量。
 *   J2（形态纪律）产品代码里不得出现 `.snapshot(` 调用式读取，真源里的**拉取型**分支除外。
 *      这一条直接钉住本版修掉的那个缺陷形态：推送型桥的 snapshot 是对象，调用它必然抛。
 *      （WorldAxis 的 snapshot 是函数，所以真源里 `typeof b.snapshot === 'function'`
 *        之后那一处调用是合法且必要的，白名单只放行真源文件。）
 *   J3（出口在场 + 真被消费）真源必须导出 readPushProbe，且产品侧调用点不得少于
 *      PUSH_READER_MIN_CONSUMERS。防的是本仓另一族形态「建好不消费」——
 *      把读取面抽出来却没人用，等于抽了个摆设。
 *   J4（自写形态判据绝迹）不得再出现「x.snapshot && typeof x.snapshot === 'object'」
 *      这种自己判形态的写法（真源除外）。它正是 8 处重复的种子。
 *   J5（扫描面下限）扫到的产品文件少于下限即 exit 2 拒判：探测器失效时不许「零命中=全绿」。
 *      RP_BRIDGE_FIXTURE=1 只放宽本条（负控制副本树用），不放宽 J1~J4。
 *
 * 判据边界（本门**不**说的事）：
 *   · 不说「归因阶梯对不对」（那是各 App 套件的活：system-v246/v249/v251/v235~v237）；
 *   · 不说「下游有没有消费上游 sourceState / lastError 归因面」（属功能面，见 TODO）。
 *   · 不扫 tests/** 与 scripts/**（测试与门禁引用桥名是必须的），只扫产品面。
 *
 * 用法：
 *   node scripts/bridge-contract-audit.mjs              # 校验（CI/发布门）
 *   node scripts/bridge-contract-audit.mjs --list       # 列出每个扫描文件的命中明细
 *   node scripts/bridge-contract-audit.mjs --root <dir> # 校验指定目录（负控制测试用）
 * 退出码：0=通过  1=契约漂移  2=门禁账目错（拒判）
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const LIST = args.includes('--list');
const ROOT = (() => {
    const i = args.indexOf('--root');
    if (i >= 0 && args[i + 1]) return path.resolve(args[i + 1]);
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
})();
const FIXTURE = process.env.RP_BRIDGE_FIXTURE === '1';
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* ------------------------------------------------------------
 * 真源与阈值
 * ------------------------------------------------------------ */
const SOURCE_REL = 'config/world-bridge.js';
const BRIDGE_LITERALS = Object.freeze(['lonsha_memory_bridge_v1', 'worldaxis_bridge_v1']);
const PUSH_READER = 'readPushProbe';
/** 产品侧 readPushProbe( 调用点下限（v2.97.0 实测 9）。
 *  写 7 而不是 9：留出「某个 App 被重构掉」的合理空间，但拦住「抽出来只有两三处用」的摆设形态。 */
const PUSH_READER_MIN_CONSUMERS = 7;
/** 扫描面下限（fail-closed）：产品 .js 文件数低于此即视为扫描器失效。 */
const MIN_PRODUCT_FILES = 100;

/* ------------------------------------------------------------
 * 注释剥离：J1/J2/J4 都要在**去注释**的源码上判。
 *   为什么必须去注释：本仓大量注释逐字提到桥名与旧写法
 *   （place-data.js 开头就写着 lonsha_memory_bridge_v1.snapshot.scene），
 *   不去注释就会把「文档」判成「实现」，产生本仓明令禁止的文本包含式假红。
 *   只处理三种字符串（单引号/双引号/反引号）与两种注释；不做正则字面量识别（产品面用不到）。
 *   字符串内容**保留**（J1 数的就是字面量），只是不再把字符串内部的 // 当注释。
 * ------------------------------------------------------------ */
function stripComments(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    let state = 'code';
    while (i < n) {
        const c = src[i];
        const d = i + 1 < n ? src[i + 1] : '';
        if (state === 'code') {
            if (c === '/' && d === '/') { state = 'line'; i += 2; continue; }
            if (c === '/' && d === '*') { state = 'block'; i += 2; continue; }
            if (c === "'" || c === '"' || c === '`') { state = c; out += c; i++; continue; }
            out += c; i++; continue;
        }
        if (state === 'line') {
            if (c === '\n') { state = 'code'; out += c; }
            i++; continue;
        }
        if (state === 'block') {
            if (c === '*' && d === '/') { state = 'code'; i += 2; } else i++;
            continue;
        }
        if (c === '\\') { out += c + d; i += 2; continue; }
        if (c === state) state = 'code';
        out += c; i++; continue;
    }
    return out;
}

function walk(absDir, out = []) {
    if (!fs.existsSync(absDir)) return out;
    for (const name of fs.readdirSync(absDir)) {
        const abs = path.join(absDir, name);
        if (fs.statSync(abs).isDirectory()) walk(abs, out);
        else if (name.endsWith('.js')) out.push(path.relative(ROOT, abs).split(path.sep).join('/'));
    }
    return out;
}

const countOf = (hay, needle) => hay.split(needle).length - 1;

/* ------------------------------------------------------------
 * 扫描
 * ------------------------------------------------------------ */
const productFiles = [...walk(path.join(ROOT, 'apps')), ...walk(path.join(ROOT, 'config'))].sort();
const stripped = new Map();
for (const rel of productFiles) {
    try { stripped.set(rel, stripComments(read(rel))); } catch (_e) { stripped.set(rel, ''); }
}

const literalHits = [];
for (const [rel, code] of stripped) {
    for (const lit of BRIDGE_LITERALS) {
        const c = countOf(code, lit);
        if (c > 0) literalHits.push({ rel, literal: lit, count: c });
    }
}
const callStyleHits = [];
for (const [rel, code] of stripped) {
    const c = (code.match(/\.snapshot\s*\(/g) || []).length;
    if (c > 0) callStyleHits.push({ rel, count: c });
}
const selfProbeHits = [];
for (const [rel, code] of stripped) {
    const c = (code.match(/\bsnapshot\s*&&\s*typeof\s+[\w$.]+\.snapshot\s*===\s*'object'/g) || []).length;
    if (c > 0) selfProbeHits.push({ rel, count: c });
}
const sourceCode = stripped.get(SOURCE_REL) || '';
const sourceHasExport = new RegExp('export\\s+function\\s+' + PUSH_READER + '\\s*\\(').test(sourceCode);
let consumerCount = 0;
const consumerFiles = [];
for (const [rel, code] of stripped) {
    if (rel === SOURCE_REL) continue;
    const c = countOf(code, PUSH_READER + '(');
    if (c > 0) { consumerCount += c; consumerFiles.push(rel); }
}
const sourceLiteralOk = BRIDGE_LITERALS.every((lit) => countOf(sourceCode, lit) === 1);
const sourceCallCount = (sourceCode.match(/.snapshot\s*\(/g) || []).length;

/* ------------------------------------------------------------
 * 开关：--list 只报告不判定
 * ------------------------------------------------------------ */
if (LIST) {
    console.log('[bridge-contract] 扫描面：apps/** + config/** 共 ' + productFiles.length + ' 个 .js');
    console.log('[bridge-contract] 真源：' + SOURCE_REL + '（每个桥名各恰好 1 次字面量：' + (sourceLiteralOk ? '是' : '否') + '）');
    console.log('\n── J1 桥名自持点（真源外应为 0）──');
    for (const h of literalHits) console.log('  ' + h.rel + '  ' + h.literal + '  x' + h.count);
    if (!literalHits.length) console.log('  （无）');
    console.log('\n── J2 .snapshot( 调用式（只允许真源）──');
    for (const h of callStyleHits) console.log('  ' + h.rel + '  x' + h.count + (h.rel === SOURCE_REL ? '（真源·拉取型分支，合法）' : ''));
    if (!callStyleHits.length) console.log('  （无）');
    console.log('\n── J4 自写形态判据（真源外应为 0）──');
    for (const h of selfProbeHits) console.log('  ' + h.rel + '  x' + h.count);
    if (!selfProbeHits.length) console.log('  （无）');
    console.log('\n── J3 ' + PUSH_READER + ' 消费点：' + consumerCount + '（下限 ' + PUSH_READER_MIN_CONSUMERS + '）──');
    for (const f of consumerFiles) console.log('  ' + f);
    process.exit(0);
}

/* ------------------------------------------------------------
 * 判定
 * ------------------------------------------------------------ */
let fail = 0;
let corrupt = 0;

if (!FIXTURE && productFiles.length < MIN_PRODUCT_FILES) {
    corrupt = 1;
    console.error('[bridge-contract] x J5 扫描面只命中 ' + productFiles.length + ' 个产品 .js（下限 ' + MIN_PRODUCT_FILES + '）—— 探测器失效，拒判。');
    console.error('  修法：核对 --root 与 apps/**、config/** 是否真的存在；副本树场景请设 RP_BRIDGE_FIXTURE=1。');
}
const offendingLiterals = literalHits.filter((h) => h.rel !== SOURCE_REL);
if (offendingLiterals.length) {
    fail = 1;
    console.error('[bridge-contract] x J1 有 ' + offendingLiterals.length + ' 处产品文件自持桥名（应 import 真源常量）：');
    for (const h of offendingLiterals) console.error('    ' + h.rel + '  x' + h.count);
    console.error('  修法：删掉本地字面量/BRIDGE_ID，改 import { LONSHA_BRIDGE_ID } from config/world-bridge.js。');
}
if (!sourceLiteralOk) {
    corrupt = 1;
    console.error('[bridge-contract] x J1 真源 ' + SOURCE_REL + ' 的桥名常量不是「每个恰好 1 次」—— 拒判。');
}
const offendingCalls = callStyleHits.filter((h) => h.rel !== SOURCE_REL);
if (offendingCalls.length) {
    fail = 1;
    console.error('[bridge-contract] x J2 有 ' + offendingCalls.length + ' 个产品文件仍在用 .snapshot( 调用式读桥：');
    for (const h of offendingCalls) console.error('    ' + h.rel + '  x' + h.count);
    console.error('  说明：lonsha 桥是推送型（snapshot 是对象），调用它必然抛 TypeError；WorldAxis 桥才是拉取型（snapshot 是函数）。');
    console.error('  修法：推型一律走 ' + SOURCE_REL + ' 的 ' + PUSH_READER + '()（或 readLonshaSnapshot()）。');
}
const offendingSelf = selfProbeHits.filter((h) => h.rel !== SOURCE_REL);
if (offendingSelf.length) {
    fail = 1;
    console.error('[bridge-contract] x J4 有 ' + offendingSelf.length + ' 个产品文件又在自写「snapshot 形态判据」：');
    for (const h of offendingSelf) console.error('    ' + h.rel + '  x' + h.count);
    console.error('  修法：形态判定只许有一份，在 ' + SOURCE_REL + '；消费方只读它的返回值。');
}
if (!sourceHasExport) {
    corrupt = 1;
    console.error('[bridge-contract] x J3 真源缺少 export function ' + PUSH_READER + '( 出口 —— 拒判（消费方会全数失联）。');
}
if (consumerCount < PUSH_READER_MIN_CONSUMERS) {
    fail = 1;
    console.error('[bridge-contract] x J3 ' + PUSH_READER + ' 只有 ' + consumerCount + ' 个产品侧调用点（下限 ' + PUSH_READER_MIN_CONSUMERS + '）—— 「抽出来没人用」= 摆设出口：');
    for (const f of consumerFiles) console.error('    ' + f);
}

if (corrupt) process.exit(2);
if (fail) {
    console.error('[bridge-contract] x 桥消费面契约未通过');
    process.exit(1);
}
console.log('[bridge-contract] 扫描面 apps/** + config/** 共 ' + productFiles.length + ' 个 .js · 桥名自持点 0（真源逐名 1 次）· .snapshot( 调用式 0（真源拉取型分支 ' + sourceCallCount + ' 处）· 自写形态 0');
console.log('[bridge-contract] ' + PUSH_READER + ' 消费点 ' + consumerCount + ' 个（' + consumerFiles.length + ' 文件，下限 ' + PUSH_READER_MIN_CONSUMERS + '）');
console.log('[bridge-contract] v 桥名单一真源 / 调用式绝迹 / 形态判据唯一 / 出口在场且真被消费');
process.exit(0);
