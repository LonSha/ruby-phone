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
 * 判据（[v2.97.0] J1~J5 四条契约 + 一条自证；[v2.98.0] 追加 J6/J7）：
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
 *   J6（[v2.98.0] 字段三态出口在场 + 真被消费）真源必须导出 readPushField / faceFieldState，
 *      且产品侧调用点不得少于 FACE_READER_MIN_CONSUMERS。上游 v3.174 专门把
 *      「源里没这项」与「有这项、值是空」写进了 snapshot.meta.fieldTypes，
 *      下游若零消费，那份三态等于白做——而实测修前正是零消费。
 *   J7（[v2.98.0] 归因文案表不得手写键）*_META / *_TEXT 这类「状态→文案」表的键
 *      必须取真源常量的值，不得手写一套标识符形。这一条不是洁癖，是刚兑现的真缺陷：
 *      clock-view / ledger-view 的 FACE_META 键写作 no_clock_face（下划线形），
 *      而 CLOCK_REASONS 的值是 no-clock-face（连字符形）⇒ 五态里三态查不到，
 *      兜底又指向 bridge_absent ⇒「快照不可用」「这版没这面」「桥未连接」
 *      一律显示成「桥未连接」。**而当时的判据全绿**——因为没有任何判据看键形。
 *
 * 判据边界（本门**不**说的事）：
 *   · 不说「归因阶梯对不对」（那是各 App 套件的活：system-v246/v249/v251/v235~v237）；
 *   · 不说「下游有没有消费上游 sourceState / lastError 归因面」（属功能面，见 TODO）；
 *   · [v3.0.2] 起 J10 说「下游有没有消费上游**注入读数**面」——
 *     上游 v3.215.0/v3.216.0（Gate R2-A/R2-B）把「AI 这一轮实际看到了什么」外供成
 *     快照 `injection`（9 键 + 逐块 6 键，落地不早于代际确认），而下游实测**全库零消费**。
 *     这是本仓第七次「建好不消费」，故立为常驻判据。
 *     [v2.98.0] 起只保证 **meta.fieldTypes** 这面被消费（J6），另两面同族同待。
 *   · [v3.5.0] 起 J11 说「下游有没有消费上游**事件来源构成**面」——上游 lonsha v3.233.0
 *     （F-2 跨平台事件）把「这条事件是谁记的」折成受控分级四态并外供 `snapshot.eventPlatforms`，
 *     而下游实测**全库零消费**。这是本仓第八次「建好不消费」，故立为常驻判据。
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
/** [v2.98.0] J6：字段三态出口名与产品侧消费点下限（实测 7：五内核 + clock + ledger）。
 *  写 5 而不是 7：留出重构空间，但拦住「出口抽出来只有一两处用」的摆设形态。 */
const FIELD_READER = 'readPushField';
const FACE_STATE_READER = 'faceFieldState';
const FACE_READER_MIN_CONSUMERS = 5;
/** [v2.98.0] J7：归因文案表的命名面（表名后缀）。 */
const META_TABLE_RE = /const\s+([A-Z][A-Z0-9_]*(?:_META|_TEXT|_TABLE|_LABEL|_MAP))\s*=\s*(?:Object\.freeze\()?\s*\{/g;
/** 表内裸标识符形键（下划线形）：*_META 这类表若手写键，几乎一定是这种形状。 */
const BARE_SNAKE_KEY_RE = /^\s+([a-z][A-Za-z0-9]*_[A-Za-z0-9_]+)\s*:/gm;

/* ── [v3.0.1] J8：投影契约的**消费出口**必须真被业务面用起来 ──
 * 【为什么必须有（本仓最贵形态在这里的翻版）】
 *   v3.0.0 把跨仓投影契约的出口做出来了，但只接进**诊断面**：四个业务 App
 *   （place / chars / plotline / clock）仍各自经 `faceFieldState` 读旧面。
 *   若到此为止，「投影」就是第七次「建好不消费」——有读数、有归因、有出口，**没有用户**。
 *   故本门从 v3.0.1 起判「业务面真消费」：`readProjection` 在产品侧（apps/**）的调用点
 *   不得少于下限。注意它**不**要求业务面把投影当数据源（那是错的：投影只外供 6 项窄面，
 *   业务面要的是整面 —— 见上游 README 与 config/projection-contract.js 的 projectionScopeLine
 *   文件头）；本判据要的是「归属面真的接上了」。 */
const PROJECTION_READER = 'readProjection';
/** 产品侧 readProjection( 调用点下限（v3.0.1 实测 5：四个业务 App + 诊断内核）。
 *  写 4 = 实测减一：留一个 App 被重构掉的余量，但拦住「只有诊断面一处」的摆设形态。 */
const PROJECTION_READER_MIN_CONSUMERS = 4;

/* ── [v3.0.1] J9：统一探针的**自述面**（sourceState / lastError）必须真被消费 ──
 * 【为什么必须有】本门文件头自 v2.97.0 起就写着「本门**不**说『下游有没有消费上游
 *   sourceState / lastError 归因面』（属功能面，见 TODO）」——那条挂账从 v2.97 挂到 v3.0.0。
 *   上游 v3.174 专门把「记忆引擎没就位 / 返回空 / 取值抛错」写进桥自己的 sourceState，
 *   并让 lastError 不吞；下游零消费 ⇒ 这三种完全不同的处境在手机端同形（只有一句笼统的
 *   「不可读」），正是本仓反复点名的形态。本判据开判：产品侧必须存在读这两个字段的调用点。 */
const PROBE_SELF_FIELDS = Object.freeze(['sourceState', 'lastError']);
/** J9 的判据是「真读出并落下」：必须有一个**结构化面**把两个字段接住（不是只提一句注释）。 */
const PROBE_SELF_RE = /probe\.(sourceState|lastError)\b/g;
const PROBE_SELF_SITES = Object.freeze([
    { rel: 'apps/diagnose/diagnose-data.js', anchor: 'const probeSelf = {' }
]);
const PROBE_SELF_MIN = 1;

/* ── [v3.0.2] J10：上游**注入读数**（Gate R2-A/R2-B 的外供面）必须真被业务面消费 ──
 * 【为什么必须有】上游 v3.215.0 把「AI 这一轮实际看到了什么」做成读数
 *   （快照 `injection`：origin/round/ts/tokens/chars/html/total/kept/blocks 九键，
 *    逐块 ref/id/label/kept/chars/reason 六键），v3.216.0 又把落地时机收紧到
 *   代际确认之后（轮次号只由提交推进）。而下游实测：`snapshot.injection` **零消费** ——
 *   用户既看不出「AI 到底收到几块」，也看不出「哪几块被预算裁掉了」。
 *   出口做出来没人读，等于没做（本仓六次欠债的同形）。
 * 【本判据不说的事】不说「产品面把读数渲染成什么样」（那是各套件的活），
 *   只保证**消费通道在场**：产品侧必须存在读它的调用点。
 * 【为什么下限是 2】实测两个业务面：诊断内核（读数可见出口）与织光机收集器
 *   （送达侧观测）。写 2 不留余量是刻意的 —— 少一个就意味着「某一面又回到零消费」，
 *   而那正是本判据要拦的形态；若将来某一面被重构掉，应当**显式**来改这里并写明理由。 */
const INJECTION_READER = 'readInjection';
const INJECTION_READER_MIN_CONSUMERS = 2;

/* ── [v3.5.0] J11：上游**事件来源构成**（F-2 跨平台事件的外供面）必须真被业务面消费 ──
 * 【为什么必须有】上游 lonsha v3.233.0 把段来源从 40 字自由文本折成受控分级四态
 *   （extract / platform / other / none）并外供 `snapshot.eventPlatforms`；
 *   分级的全部意义在于**让下游能对照「这条是插件从正文提的、还是手机 App 里发生的」**。
 *   下游若零消费，那份分级就等于白做（本仓「建好不消费」的第八例）。
 * 【判据口径】两条同时判：
 *   ① 真源必须导出 `readLonshaEventPlatforms` / `eventPlatformsLine`；
 *   ② 产品面 apps/** 的调用点不得少于下限（config/ 是出口自身，不计）。
 * 【为什么下限是 1】本版刻意只落一个**独立**消费面（织光机来源侧），
 *   与 J10 的注入面同理：少一个就意味着「那一面又回到零消费」。
 *   若将来再落一面（如世界脉动的事件对照），应当把这里显式抬高并写明理由。 */
const EVENT_PLATFORM_READER = 'readLonshaEventPlatforms';
const EVENT_PLATFORM_LINE_READER = 'eventPlatformsLine';
const EVENT_PLATFORM_MIN_CONSUMERS = 1;

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
/* J7：归因文案表的裸标识符键（只扫产品面；真源自己不受此限） */
const bareKeyHits = [];
for (const [rel, code] of stripped) {
    if (rel === SOURCE_REL) continue;
    META_TABLE_RE.lastIndex = 0;
    let m;
    while ((m = META_TABLE_RE.exec(code)) !== null) {
        const open = code.indexOf('{', m.index);
        let depth = 0, j = open;
        for (; j < code.length; j++) {
            if (code[j] === '{') depth++;
            else if (code[j] === '}') { depth--; if (depth === 0) break; }
        }
        const block = code.slice(open, j + 1);
        BARE_SNAKE_KEY_RE.lastIndex = 0;
        let k;
        const keys = [];
        while ((k = BARE_SNAKE_KEY_RE.exec(block)) !== null) keys.push(k[1]);
        if (keys.length) bareKeyHits.push({ rel, table: m[1], keys });
    }
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
/* J6：两个字段三态出口各自「恰 1 次 export function」 */
const sourceFieldExportOk = new RegExp('export\\s+function\\s+' + FIELD_READER + '\\s*\\(').test(sourceCode);
const sourceFaceExportOk = new RegExp('export\\s+function\\s+' + FACE_STATE_READER + '\\s*\\(').test(sourceCode);
let faceConsumerCount = 0;
const faceConsumerFiles = [];
for (const [rel, code] of stripped) {
    if (rel === SOURCE_REL) continue;
    const c = countOf(code, FACE_STATE_READER + '(');
    if (c > 0) { faceConsumerCount += c; faceConsumerFiles.push(rel); }
}
const sourceCallCount = (sourceCode.match(/.snapshot\s*\(/g) || []).length;

/* ── [v3.0.1] J8：产品侧 readProjection( 消费点（只扫 apps/**，config/ 是出口自身） ── */
let projConsumerCount = 0;
const projConsumerFiles = [];
for (const [rel, code] of stripped) {
    if (!rel.startsWith('apps/')) continue;
    const c = countOf(code, PROJECTION_READER + '(');
    if (c > 0) { projConsumerCount += c; projConsumerFiles.push(rel); }
}
/* ── [v3.0.1] J9：探针自述面（sourceState / lastError）产品侧消费点 ── */
let probeSelfReads = 0;
const probeSelfFiles = [];
for (const [rel, code] of stripped) {
    PROBE_SELF_RE.lastIndex = 0;
    const n = (code.match(PROBE_SELF_RE) || []).length;
    if (n > 0) { probeSelfReads += n; probeSelfFiles.push(rel); }
}
/* 只「读到」不够，必须**落下成面**：每个登记点须有结构化锚点（否则只是顺手读一眼就丢） */
const probeSelfSites = PROBE_SELF_SITES.filter((s) => {
    const code = stripped.get(s.rel);
    return !!code && code.includes(s.anchor);
});

/* ── [v3.0.2] J10：产品侧 readInjection( 消费点（只扫 apps/**，config/ 是出口自身） ── */
let injConsumerCount = 0;
const injConsumerFiles = [];
for (const [rel, code] of stripped) {
    if (!rel.startsWith('apps/')) continue;
    const c = countOf(code, INJECTION_READER + '(');
    if (c > 0) { injConsumerCount += c; injConsumerFiles.push(rel); }
}

/* ── [v3.5.0] J11：事件来源构成面的出口在场 + 产品侧消费点（只扫 apps/**） ── */
const eventPlatformExportOk = new RegExp('export\\s+function\\s+' + EVENT_PLATFORM_READER + '\\s*\\(').test(sourceCode);
const eventPlatformLineExportOk = new RegExp('export\\s+function\\s+' + EVENT_PLATFORM_LINE_READER + '\\s*\\(').test(sourceCode);
let eventPlatformConsumerCount = 0;
const eventPlatformConsumerFiles = [];
for (const [rel, code] of stripped) {
    if (!rel.startsWith('apps/')) continue;
    const c = countOf(code, EVENT_PLATFORM_READER + "(");
    if (c > 0) { eventPlatformConsumerCount += c; eventPlatformConsumerFiles.push(rel); }
}

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
    console.log('\n── J6 ' + FACE_STATE_READER + ' 消费点：' + faceConsumerCount + '（下限 ' + FACE_READER_MIN_CONSUMERS + '）──');
    for (const f of faceConsumerFiles) console.log('  ' + f);
    console.log('\n── J7 归因文案表的手写键（应为 0）──');
    for (const h of bareKeyHits) console.log('  ' + h.rel + '  ' + h.table + '  x' + h.keys.length + '  [' + h.keys.join(', ') + ']');
    if (!bareKeyHits.length) console.log('  （无）');
    console.log('\n── J8 ' + PROJECTION_READER + ' 消费点（只计 apps/**）：' + projConsumerCount + '（下限 ' + PROJECTION_READER_MIN_CONSUMERS + '）──');
    for (const f of projConsumerFiles) console.log('  ' + f);
    if (!projConsumerFiles.length) console.log('  （无 —— 投影出口没人用就是摆设）');
    console.log('\n── J9 探针自述面（sourceState / lastError）消费点：' + probeSelfReads + ' 处 / 结构化面 ' + probeSelfSites.length + ' 个（下限 ' + PROBE_SELF_MIN + '）──');
    for (const f of probeSelfFiles) console.log('  ' + f);
    if (!probeSelfSites.length) console.log('  （无结构化面 —— 只读一眼就丢不算消费）');
    console.log('\n── J10 ' + INJECTION_READER + ' 消费点（只计 apps/**）：' + injConsumerCount + '（下限 ' + INJECTION_READER_MIN_CONSUMERS + '）──');
    console.log('\n── J11 ' + EVENT_PLATFORM_READER + ' 消费点（只计 apps/**）：' + eventPlatformConsumerCount + '（下限 ' + EVENT_PLATFORM_MIN_CONSUMERS + '）──');
    for (const f of injConsumerFiles) console.log('  ' + f);
    if (!injConsumerFiles.length) console.log('  （无 —— 上游注入读数没人读就是白做）');
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

/* ── J6 / J7 [v2.98.0] ── */
if (!sourceFieldExportOk) {
    corrupt = 1;
    console.error('[bridge-contract] x J6 真源缺少 export function ' + FIELD_READER + '( —— 拒判。');
}
if (!sourceFaceExportOk) {
    corrupt = 1;
    console.error('[bridge-contract] x J6 真源缺少 export function ' + FACE_STATE_READER + '( —— 拒判。');
}
if (faceConsumerCount < FACE_READER_MIN_CONSUMERS) {
    fail = 1;
    console.error('[bridge-contract] x J6 ' + FACE_STATE_READER + ' 只有 ' + faceConsumerCount + ' 个产品侧调用点（下限 ' + FACE_READER_MIN_CONSUMERS + '）');
    console.error('  说明：上游 v3.174 把「源里没这项」与「有这项、值是空」写进了 snapshot.meta.fieldTypes，');
    console.error('        下游不读 ⇒ 两种处境同形，文案还会错误地让用户去升级插件。');
    for (const f of faceConsumerFiles) console.error('    ' + f);
}
if (bareKeyHits.length) {
    fail = 1;
    console.error('[bridge-contract] x J7 有 ' + bareKeyHits.length + ' 张归因文案表在**手写键**（应取真源常量的值）：');
    for (const h of bareKeyHits) console.error('    ' + h.rel + '  ' + h.table + '  [' + h.keys.join(', ') + ']');
    console.error('  说明：手写的标识符形键与真源常量的值形（连字符形）不同 ⇒ 查不到、静默走兜底，');
    console.error('        多种处境会显示成同一句话。修法：键写作 [REASONS.xxx]。');
}

/* ── J8 / J9 [v3.0.1] ── */
if (projConsumerCount < PROJECTION_READER_MIN_CONSUMERS) {
    fail = 1;
    console.error('[bridge-contract] x J8 ' + PROJECTION_READER + ' 只有 ' + projConsumerCount + ' 个产品侧消费点（下限 ' + PROJECTION_READER_MIN_CONSUMERS + '）：');
    for (const f of projConsumerFiles) console.error('    ' + f);
    console.error('  说明：投影出口的全部价值是「让每个业务面说清这份读数是哪来的」；');
    console.error('        只有诊断面在读 = 用户永远在业务页看不到来源，只能倒着去诊断页查，等于没做归属面。');
    console.error('  修法：每个业务 App 的 projection() 出口附上 readProjection + projectionScopeLine 的读数。');
}
const missingProbeSites = PROBE_SELF_SITES.filter((s) => !probeSelfSites.includes(s));
if (missingProbeSites.length) {
    fail = 1;
    console.error('[bridge-contract] x J9 探针自述面缺结构化落点（' + missingProbeSites.length + ' 处）：');
    for (const s of missingProbeSites) console.error('    ' + s.rel + '  缺锚点  ' + s.anchor);
    console.error('  说明：只「读到」 ' + PROBE_SELF_FIELDS.join(' / ') + ' 不够，必须落成一个结构化面把两个字段接住。');
}
if (probeSelfReads < PROBE_SELF_MIN) {
    fail = 1;
    console.error('[bridge-contract] x J9 产品侧没有任何 probe.(' + PROBE_SELF_FIELDS.join('|') + ') 读取点（下限 ' + PROBE_SELF_MIN + '）');
    console.error('  说明：上游桥把「引擎未就位 / 引擎在位但返回空 / 取快照抛错」三类自述写在这两个字段上；');
    console.error('        下游不读 ⇒ 「没挂载」与「挂了但引擎坏了」被说成同一句话，用户会朝错方向修。');
}

/* ── J10 [v3.0.2] ── */
if (injConsumerCount < INJECTION_READER_MIN_CONSUMERS) {
    fail = 1;
    console.error('[bridge-contract] x J10 ' + INJECTION_READER + ' 只有 ' + injConsumerCount + ' 个产品侧消费点（下限 ' + INJECTION_READER_MIN_CONSUMERS + '）：');
    for (const f of injConsumerFiles) console.error('    ' + f);
    console.error('  说明：上游 v3.215.0 起把「AI 这一轮实际看到了什么」外供成快照 injection，');
    console.error('        下游不读 ⇒ 用户永远看不到「哪几块真的进了上下文、哪几块被预算裁掉」，');
    console.error('        也看不到「读到 0 块候选」与「候选全被裁」是两件处置方向相反的事。');
    console.error('  修法：产品面接 config/injection-contract.js 的 readInjection。');
}

/* ── J11 [v3.5.0] ── */
if (!eventPlatformExportOk || !eventPlatformLineExportOk) {
    corrupt = 1;
    console.error('[bridge-contract] x J11 真源缺出口：' + EVENT_PLATFORM_READER + ' / ' + EVENT_PLATFORM_LINE_READER);
}
if (eventPlatformConsumerCount < EVENT_PLATFORM_MIN_CONSUMERS) {
    fail = 1;
    console.error('[bridge-contract] x J11 ' + EVENT_PLATFORM_READER + ' 只有 ' + eventPlatformConsumerCount + ' 个产品侧消费点（下限 ' + EVENT_PLATFORM_MIN_CONSUMERS + '）：');
    for (const f of eventPlatformConsumerFiles) console.error('    ' + f);
    console.error('  说明：上游 lonsha v3.233.0 把「这条事件是谁记的」折成受控分级四态并外供 snapshot.eventPlatforms，');
    console.error('        下游不读 ⇒ 用户永远看不到「事件是哪一侧发生的」，跨平台对照在这台设备上无据可查。');
    console.error('  修法：产品面接 config/world-bridge.js 的 readLonshaEventPlatforms / eventPlatformsLine。');
}

if (corrupt) process.exit(2);
if (fail) {
    console.error('[bridge-contract] x 桥消费面契约未通过');
    process.exit(1);
}
console.log('[bridge-contract] 扫描面 apps/** + config/** 共 ' + productFiles.length + ' 个 .js · 桥名自持点 0（真源逐名 1 次）· .snapshot( 调用式 0（真源拉取型分支 ' + sourceCallCount + ' 处）· 自写形态 0');
console.log('[bridge-contract] ' + PUSH_READER + ' 消费点 ' + consumerCount + ' 个（' + consumerFiles.length + ' 文件，下限 ' + PUSH_READER_MIN_CONSUMERS + '）');
console.log('[bridge-contract] ' + FACE_STATE_READER + ' 消费点 ' + faceConsumerCount + ' 个（' + faceConsumerFiles.length + ' 文件，下限 ' + FACE_READER_MIN_CONSUMERS + '）· 归因文案表手写键 ' + bareKeyHits.length + ' 张');
console.log('[bridge-contract] ' + PROJECTION_READER + ' 消费点 ' + projConsumerCount + ' 个（' + projConsumerFiles.length + ' 文件，下限 ' + PROJECTION_READER_MIN_CONSUMERS + '）');
console.log('[bridge-contract] sourceState/lastError 消费点 ' + probeSelfReads + ' 处 · 结构化面 ' + probeSelfSites.length + ' 个（下限 ' + PROBE_SELF_MIN + '）');
console.log('[bridge-contract] ' + EVENT_PLATFORM_READER + ' 消费点 ' + eventPlatformConsumerCount + ' 个（' + eventPlatformConsumerFiles.length + ' 文件，下限 ' + EVENT_PLATFORM_MIN_CONSUMERS + '）');
console.log('[bridge-contract] ' + INJECTION_READER + ' 消费点 ' + injConsumerCount + ' 个（' + injConsumerFiles.length + ' 文件，下限 ' + INJECTION_READER_MIN_CONSUMERS + '）');
console.log('[bridge-contract] v 桥名单一真源 / 调用式绝迹 / 形态判据唯一 / 出口在场且真被消费 / 字段三态被消费 / 文案表键不手写 / 投影归属面被业务面消费 / 探针自述面落下成面 / 注入实际读数被业务面消费 / 事件来源构成被业务面消费');
process.exit(0);
