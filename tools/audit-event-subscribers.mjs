/* ============================================================
 * tools/audit-event-subscribers.mjs — [v4.148.0 · 第二十一期 批次D 第三步 R21-O9 派发无订阅收口]
 * 事件契约的**反方向**审计：登记了的事件里，有多少是 emit 了却全仓零 on？
 * （与「建好没接」同族、方向相反：发出去了、没人听。）
 * ------------------------------------------------------------
 * 【与 system-v226 的分工】
 *   v226 的双向对账只数「字面量出现次数」——防拼写漂移与死契约，但「出现」
 *   不分方向：一条只 emit 没人 on 的事件在它眼里是「正常使用」。本工具把
 *   方向拆开，且**按仓内真实派发/订阅形态**扫（首版漏了三种，实测修齐）：
 *     emit 形态（命中任一即计一次派发点）：
 *       ① new (win.)CustomEvent('phone:…' …)          字面量构造
 *       ② new CustomEvent(PHONE_EVENTS.KEY …)         契约常量构造
 *       ③ makePhoneEvent(PHONE_EVENTS.KEY / 'phone:…') 落账包装构造
 *       ④ new CustomEvent(RESUME_EVENT …)             外部常量变量
 *         （④靠别名表：先全仓收 const X = 'phone:…' 的变量名，派发点
 *          出现该变量名即算。）
 *     on 形态（订阅方按文件去重）：
 *       ① addEventListener('phone:…' / PHONE_EVENTS.KEY
 *       ② addListener('phone:…' …                     globalRuntime 登记制
 *       ③ on(window, 'phone:…' …                      mount 层包装助手
 *         （on 助手用「非标识符边界 + on(」匹配，防 bonus/once 误命中。）
 *
 * 【扫描面】产品源码（apps/ phone/ config/ workers/ assets/vendor/ index.js），
 *   与 import-resolve 门同面 —— tests 与 docs 不算订阅方（测试监听器是夹具）。
 *
 * 【读数】tests/audit/event_subscribers.json：
 *   { scannedFiles, contractSize, events:[{event, emit, on, onFiles[], emitFiles[]}],
 *     debt:[emit>0 且 on=0], zeroUse:[emit=0 且 on=0] }
 *   fail-closed：扫描面为空 / 契约读不到 ⇒ exit 2 拒判，不输出空读数。
 *
 * 用法：node tools/audit-event-subscribers.mjs [--write]
 * 退出码：0=读数已生成（debt 是否为空不影响退出码，判决归判据）  2=结构漂移
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');

/* 契约真源：直接 import，不复制事件清单（两份清单本身就是一物多账）。 */
const mod = await import('file://' + path.join(ROOT, 'config', 'phone-events.js'));
const PHONE_EVENTS = mod.PHONE_EVENTS;

const SRC_DIRS = ['apps', 'phone', 'config', 'workers', 'assets/vendor'];
const SRC_FILES = ['index.js'];

function walk(dir, out = []) {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of ents) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name === 'node_modules' || e.name === '.git') continue;
            walk(p, out);
        } else if (/\.(js|mjs)$/.test(e.name)) out.push(p);
    }
    return out;
}

const files = [];
for (const d of SRC_DIRS) files.push(...walk(path.join(ROOT, d)));
for (const f of SRC_FILES) {
    const p = path.join(ROOT, f);
    if (fs.existsSync(p)) files.push(p);
}
if (files.length === 0) {
    console.error('[event-sub] 扫描面为空 ⇒ 拒判（结构漂移）');
    process.exit(2);
}

/* 去注释保留字符串（与 import-resolve 门同口径）。模板串整段丢（无静态事件名）。 */
function stripCommentsKeepStrings(src) {
    const out = [];
    let i = 0;
    const n = src.length;
    while (i < n) {
        const two = src.slice(i, i + 2);
        if (two === '//') { while (i < n && src[i] !== '\n') i++; continue; }
        if (two === '/*') { i += 2; while (i < n && src.slice(i, i + 2) !== '*/') i++; i += 2; continue; }
        const ch = src[i];
        if (ch === "'" || ch === '"') {
            const q = ch; out.push(ch); i++;
            while (i < n) {
                if (src[i] === '\\') { out.push(src[i] + (src[i + 1] || '')); i += 2; continue; }
                out.push(src[i]);
                if (src[i] === q) { i++; break; }
                i++;
            }
            continue;
        }
        if (ch === '`') {
            i++; let depth = 1;
            while (i < n && depth > 0) {
                if (src[i] === '\\') { i += 2; continue; }
                if (src[i] === '`') { depth--; i++; continue; }
                i++;
            }
            out.push('`T`');
            continue;
        }
        out.push(ch); i++;
    }
    return out.join('');
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const events = Object.values(PHONE_EVENTS);
const KEY_OF = new Map(Object.entries(PHONE_EVENTS).map(([k, v]) => [v, k]));

/* 读产品源码面（去注释版），并按事件建别名表（const X = 'phone:…'）。 */
const parsed = files.map((f) => {
    let raw = '';
    try { raw = fs.readFileSync(f, 'utf8'); } catch { return null; }
    return { f, rel: path.relative(ROOT, f), code: stripCommentsKeepStrings(raw) };
}).filter(Boolean);
const allCode = parsed.map((p) => p.code).join('\n');

/* 别名令牌：事件值本身 + PHONE_EVENTS.KEY + 全仓 const X = '事件值' 的变量名。 */
const aliases = new Map(events.map((ev) => [ev, new Set([esc(ev), 'PHONE_EVENTS\\.' + (KEY_OF.get(ev) || '')])]));
for (const ev of events) {
    const re = new RegExp('(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*[\'"]' + esc(ev) + '[\'"]', 'g');
    let m;
    while ((m = re.exec(allCode))) {
        aliases.get(ev).add(esc(m[1]));
    }
}

const rows = events.map((ev) => ({ event: ev, emit: 0, on: 0, onFiles: [], emitFiles: [] }));
const byName = new Map(rows.map((r) => [r.event, r]));

for (const { rel, code } of parsed) {
    for (const ev of events) {
        const row = byName.get(ev);
    for (const t of aliases.get(ev)) {
        /* emit：CustomEvent / makePhoneEvent 构造调用，事件令牌必须在**实参位置**——
         *   窗内不许跨右括号/右花括号（v4.148.0 实测修：松窗把
         *   「addEventListener('click', () => { …dispatchEvent('phone:goHome')… })」
         *   回调体里的派发也吞进来，on 读数虚高、debt 少报）。 */
        const emitRe = new RegExp('(?:new\\s+)?(?:win\\.)?(?:CustomEvent|makePhoneEvent)\\s*\\(\\s*[^)]{0,100}?' + t);
            if (emitRe.test(code)) {
                if (!row.emitFiles.includes(rel)) row.emitFiles.push(rel);
            }
            /* on：addEventListener / addListener / on( 助手（非标识符边界防 bonus 误命中）。
             *   同一纪律：令牌必须落在**事件实参位**——窗内不许跨 `)`（调用已闭合）、
             *   `{` / `}`（已进函数体）或 `=>`（已进回调），否则回调体内的
             *   dispatchEvent 会被误计成订阅（asset-view 误报实锤）。 */
            const onRe = new RegExp('(?:addEventListener|addListener)\\s*\\(\\s*[^){}=>]{0,80}?' + t
                + '|[^\\w$.]on\\s*\\(\\s*[^){}=>]{0,60}?' + t);
            if (onRe.test(code)) {
                if (!row.onFiles.includes(rel)) row.onFiles.push(rel);
            }
        }
    }
}

/* 读数以文件级去重为准（同文件同事件多形态命中只计一）。 */
for (const row of rows) {
    row.emit = row.emitFiles.length;
    row.on = row.onFiles.length;
}

const debt = rows.filter((r) => r.emit > 0 && r.on === 0).map((r) => r.event);

/* 欠账台账 [v4.148.0 · R21-O9]：每条「派发无订阅」必须在此给出**经实证的**
 *   存续理由，缺一条本工具 exit 2 拒判（判决依据进真代码，不靠注释自述）。
 *   逐条实证记录（2026-11-14 审计）：
 *   · pet-statechange：消费由**非事件通道**承接——PetController 构造器回调
 *     onPhoneReady + root.dataset.petState 状态镜像（pet-controller.js:158），
 *     事件只是对外遥测镜像，仓内再走 addEventListener 属重复通道。
 *   · motionResume：仓内重取由 createResumeScheduler 合成器承接（index.js:743
 *     scheduler.flush），事件是 config/motion.js 显式 export 的 RESUME_EVENT
 *     对外 API 面；契约注释宣称的消费方（「后台降频的消费方」）从未落仓。
 *   · viewBack：v4.148.0 已修真缺陷——phone-shell._forceLayerBack 现在自己
 *     setCurrentApp 同步（谁动图层谁同步），宿主无需订阅；事件降级为对外遥测。
 *   · canonAdopt：archive→上游的**跨仓转交**凭据（本件零写盘），owner 在仓外。
 *   · causalSource：plotline 回源凭证**对外遥测**（仓内兜底走 toastr 直读）。 */
const DEBT_LEDGER = Object.freeze({
    'phone:pet-statechange': '消费由构造器回调 onPhoneReady + dataset.petState 镜像承接，事件为对外遥测',
    'phone:motionResume': '仓内重取由 resume 合成器承接，RESUME_EVENT 是 config/motion.js 显式对外 API',
    'phone:viewBack': 'v4.148.0 外壳已自同步 currentApp（谁动图层谁同步），事件降级为对外遥测',
    'phone:canonAdopt': '跨仓转交凭据：owner 在仓外，本仓零写盘只播报',
    'phone:causalSource': '回源凭证对外遥测，仓内兜底为 toastr 直读',
});
for (const d of debt) {
    if (!DEBT_LEDGER[d]) {
        console.error('[event-sub] 欠账 ' + d + ' 无台账理由 ⇒ 拒判：先实证再落账，不许静默放行');
        process.exit(2);
    }
}
const reading = {
    version: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version,
    scannedFiles: files.length,
    contractSize: events.length,
    events: rows,
    debt,
    debtLedger: { ...DEBT_LEDGER },
    zeroUse: rows.filter((r) => r.emit === 0 && r.on === 0).map((r) => r.event),
};

const OUT = path.join(ROOT, 'tests', 'audit', 'event_subscribers.json');

/* 只在实际执行时落盘/打印/退出 —— 被 import 时一律不做。
 *   [v4.148.0 实测修] 本文件曾被判据 A1 用 await import() 当「第二证人」调用，
 *   而结尾的 process.exit(0) 会**直接终止调用方进程**：测试运行器把整个文件报成
 *   1 例 ✔（实为 13 例只跑了 1 例就退出），是一次真正的假绿。工具是被别人调用的
 *   东西，不许替调用方决定生命周期。 */
const IS_MAIN = (() => {
    try { return path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url); }
    catch { return false; }
})();
const JSON_OUT = process.argv.includes('--json');
if (IS_MAIN && JSON_OUT) {
    /* 只打读数不落盘：判据用它取「现场第二份独立读数」与盘上台账对账。 */
    process.stdout.write(JSON.stringify(reading));
    process.exit(0);
}
if (IS_MAIN) {
    if (WRITE) {
        fs.writeFileSync(OUT, JSON.stringify(reading, null, 2) + '\n');
    }
    console.log('[event-sub] 扫描 ' + files.length + ' 文件 · 契约 ' + events.length + ' 事件 · emit>0 且 on=0 的欠账 ' + debt.length + ' 条' + (debt.length ? '：' + debt.join(', ') : ''));
    if (reading.zeroUse.length) console.log('[event-sub] emit 与 on 双零（契约面读数）' + reading.zeroUse.length + ' 条：' + reading.zeroUse.join(', '));
    process.exit(0);
}