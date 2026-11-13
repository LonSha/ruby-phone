/* ============================================================
 * tests/system-v4146.test.mjs -- [v4.146.0 · 第二十一期 批次D 第一步 R21-O7 纯转发层清零]
 *   —— 把「FORWARD=2 的两笔」从「一直挂着等确认」收成「两条路都算完成」。
 *
 * 【计划给的名字为什么没用在 v4160 上】
 *   规格原文写的是 `tests/system-v4160.test.mjs`，而那一号早在 v4.16.0 就被
 *   「长篇聊天按窗口呈现」占用了（R4-O4，14711 字节仍在盘上）。同号两用会让
 *   「哪一版对应哪一档」直接失去意义，故本档取 v4.146.0 之后第一个空闲号 v4146。
 *   这是本仓既有的号段纪律：号是**指纹**，不许叠。
 *
 * 【修前实测的缺口（读码可复算，不是推演）】
 *   `apps/games/games-data.js` 与 `apps/games/games-view.js` 全文各只有一行
 *   `export { ... } from './poker/poker-data.js'`，是 poker 拆分时留下的旧路径兼容壳。
 *   全仓（含 tests）零引用 —— 实测源码面没有一个 import 说明符指向它们，
 *   `apps/games/games-app.js` 里 `import(` 出现 0 次、两个文件名出现 0 次。
 *   于是它们既不是「被测试守着」，也不是「被外部路径依赖」，纯粹是两笔悬空的转发。
 *
 * 【本版走的路（规格给了两条，本条选「删」）】
 *   规格原文：先查有无动态构造路径（import( / require( 拼串 / 全局名字符串）；
 *   无 ⇒ 删除并让调用方直连真模块；有 ⇒ 登记理由。实测无动态构造路径 ⇒ 删除。
 *   删后 dead-export 立刻暴露 `poker-data.js::HAND_LABELS` 真零消费，那是**删对了**的
 *   证明（此前它靠那个转发壳冒充「有人用」）；本版按仓内口径冻结并写明理由，
 *   不为了 DEAD=0 好看而假删，也不为了满足审计而凭空加一个消费方。
 *
 * 判据面（五组）：
 *   A 两态互斥：FORWARD 要么为 0（删净），要么每个都在台账里有理由（留存）—— 不许两头占
 *   B 删除已落地：两个文件不在盘上 / 无说明符引用 / 真模块仍在位且被真消费
 *   C 假删防线：删掉的东西不许以别名、转出、动态 import 拼串的形式在别处复活
 *   D 负控制：把被删的名字加回一个 import ⇒ 同款判据必须转红；真仓此刻确实零引用
 *   E 版本锚：五源同源且 ≥ 4.146.0
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const BORN_V = '4.146.0';

/* 本项的两笔（删除前是「纯转发兼容层」）。 */
const FORWARDERS = ['apps/games/games-data.js', 'apps/games/games-view.js'];
const REAL_DATA = 'apps/games/poker/poker-data.js';
const REAL_VIEW = 'apps/games/poker/poker-view.js';

/** 走遍产品源码面（跳过测试与第三方），返回 [{rel, src}]。 */
function walkSources() {
    const out = [];
    const SKIP = new Set(['node_modules', '.git', 'tests', 'assets', 'docs', '.agents']);
    const stack = [ROOT];
    while (stack.length) {
        const dir = stack.pop();
        let ents;
        try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
        for (const e of ents) {
            if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
            const full = path.join(dir, e.name);
            if (e.isDirectory()) { stack.push(full); continue; }
            if (!/\.m?js$/.test(e.name)) continue;
            out.push({ rel: path.relative(ROOT, full).split(path.sep).join('/'), src: fs.readFileSync(full, 'utf8') });
        }
    }
    return out;
}
const SOURCES = walkSources();

/** 去掉注释后的源码：判据只认代码，不认注释里的自述（本仓既有纪律）。
 *  ★ 本版钉住的缺陷形态：简易状态机不认正则字面量 —— 像 /(['"])/ 这种
 *    含引号字符的正则（binding-consumption.mjs 里成排出现）会把状态机
 *    带进字符串态再也出不来，导致该文件后面的**真注释剥不掉**，注释里
 *    的历史示例就被当成活引用，C1/D2 假红。修法：code 态遇 / 时按
 *    「前一个非空白字符」判定它是除号还是正则起点（JS 词法标准启发式），
 *    正则内跳过字符类，直到未转义的收尾 /。 */
function stripComments(src) {
    let out = '';
    let i = 0;
    let state = 'code';
    let quote = '';
    let inClass = false;               // 正则字符类 [ ] 内部
    const prevNonWs = () => {
        for (let k = out.length - 1; k >= 0; k--) {
            const ch = out[k];
            if (!/\s/.test(ch)) return ch;
        }
        return '';
    };
    const KEYWORD_RE = /\b(?:return|typeof|instanceof|in|of|new|delete|void|do|else|yield|await|case|throw)$/;
    while (i < src.length) {
        const c = src[i];
        const d = src[i + 1];
        if (state === 'code') {
            if (c === '/' && d === '*') { state = 'block'; i += 2; continue; }
            if (c === '/' && d === '/') { state = 'line'; i += 2; continue; }
            if (c === '/') {
                /* 除号还是正则起点：看前一个非空白字符（词法标准启发式）。 */
                const p = prevNonWs();
                const isRegexStart = p === '' || '([{,;=:!&|?+-*%~^<>'.includes(p)
                    || (p === '/' && false) || KEYWORD_RE.test(out.replace(/\s+$/, '').replace(/[\w$]*$/, (w) => w));
                if (isRegexStart) {
                    state = 'regex'; inClass = false; i += 1; continue;
                }
                out += c; i += 1; continue;
            }
            if (c === '"' || c === "'" || c === '`') { state = 'str'; quote = c; out += c; i += 1; continue; }
            out += c; i += 1; continue;
        }
        if (state === 'regex') {
            if (c === '\\') { i += 2; continue; }              // 正则内转义：整对丢弃
            if (c === '[') { inClass = true; i += 1; continue; }
            if (c === ']') { inClass = false; i += 1; continue; }
            if (c === '/' && !inClass) { state = 'code'; i += 1; continue; }  // 收尾（旗标字母属 code 态标识符）
            if (c === '\n') { state = 'code'; out += '\n'; i += 1; continue; } // 容错：正则不跨行，误判即止损
            i += 1; continue;
        }
        if (state === 'block') { if (c === '*' && d === '/') { state = 'code'; i += 2; continue; } i += 1; continue; }
        if (state === 'line') { if (c === '\n') { state = 'code'; out += c; } i += 1; continue; }
        if (c === '\\') { out += c + (d || ''); i += 2; continue; }
        if (c === quote) { state = 'code'; out += c; i += 1; continue; }
        out += c; i += 1;
    }
    return out;
}

/** 在给定源码面里找「指向 rel 的活引用」。 */
function refsTo(rel, sources) {
    const base = path.basename(rel);
    return sources
        .filter(({ rel: r, src }) => r !== rel && stripComments(src).includes(base))
        .map((x) => x.rel);
}

/* ═══════════════════════════ A · 两态互斥 ═══════════════════════════ */
test('A1 纯转发层要么删净、要么每个都在台账里有理由 —— 两态互斥，不许两头都占', () => {
    const stillOnDisk = FORWARDERS.filter((f) => exists(f));
    const ledgerRel = 'tests/audit/forward_layer_ledger.json';
    const ledger = exists(ledgerRel) ? readJson(ledgerRel) : null;

    if (stillOnDisk.length === 0) {
        /* 路径一：删净。此时台账若还留着「我保留了它」的理由条目 ⇒ 台账陈旧，也是红。 */
        const stale = ledger && Array.isArray(ledger.retained)
            ? ledger.retained.filter((e) => FORWARDERS.includes(e.file))
            : [];
        assert.deepEqual(stale, [], '★ 文件已删，台账不得仍登记「保留理由」—— 台账与盘面必须同源');
        return;
    }
    /* 路径二：留存。每个还在盘上的转发壳都必须在台账里有一条**带理由**的条目。 */
    assert.ok(ledger, '★ 转发壳仍在盘上（' + stillOnDisk.join(' / ') + '）却没有任何台账 ⇒ 无法解释为何留着');
    const byFile = new Map((ledger.retained || []).map((e) => [e.file, e]));
    for (const f of stillOnDisk) {
        const e = byFile.get(f);
        assert.ok(e, '★ 留存必须登记：' + f + ' 不在 forward_layer_ledger.json 的 retained 里');
        assert.ok(String(e.reason || '').trim().length >= 20, f + ' 的保留理由必须写实（≥ 20 字），不得写「暂留」了事');
    }
});

test('A2 审计清单里不得再出现已删的两个文件（盘面事实，独立复算）', () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'dead-surface-triage.mjs')],
        { cwd: ROOT, encoding: 'utf8', timeout: 180000 });
    const txt = String(r.stdout || '') + String(r.stderr || '');
    assert.ok(txt.length > 0, '审计工具必须能跑出读数（空输出 ⇒ 判据无从判断）');
    for (const f of FORWARDERS) {
        const base = path.basename(f);
        assert.ok(!txt.includes('"' + base + '"'), '★ ' + base + ' 已删除，不该仍出现在审计清单里');
    }
});

/* ═══════════════════════════ B · 删除已落地 ═══════════════════════════ */
test('B1 两个转发壳不在盘上（走了「删」这条路）', () => {
    for (const f of FORWARDERS) {
        assert.ok(!exists(f), '★ ' + f + ' 必须已删除（本版判定无动态构造路径、零消费）');
    }
});

test('B2 真模块仍在位，且被真的消费（不是把壳删了连真模块一起孤立）', () => {
    assert.ok(exists(REAL_DATA), '真数据模块必须在位：' + REAL_DATA);
    assert.ok(exists(REAL_VIEW), '真视图模块必须在位：' + REAL_VIEW);
    const dataSrc = read(REAL_DATA);
    const cls = (/export\s+class\s+([A-Za-z_$][\w$]*)/.exec(dataSrc) || [])[1];
    assert.ok(cls, REAL_DATA + ' 必须导出类（本仓 App 数据层形态）');
    const users = SOURCES
        .filter(({ rel, src }) => rel !== REAL_DATA && new RegExp('\\b' + cls + '\\b').test(stripComments(src)))
        .map((x) => x.rel);
    assert.ok(users.length >= 1, '★ ' + cls + ' 删壳后必须仍有消费方（否则是把「转发」删成「孤立」），实得 0');
});

test('B3 删掉的名字不许在动态 import 拼串里活着（规格要求先查的那一面）', () => {
    for (const f of FORWARDERS) {
        const base = path.basename(f, '.js');
        for (const { rel, src } of SOURCES) {
            for (const line of stripComments(src).split('\n')) {
                if (!/import\s*\(/.test(line)) continue;
                assert.ok(!line.includes(base), '★ ' + rel + ' 用动态 import 拼出了已删模块名：' + line.trim());
            }
        }
    }
});

/* ═══════════════════════════ C · 假删防线 ═══════════════════════════ */
test('C1 已删文件不许以别名 / 转出形式在别处复活', () => {
    for (const f of FORWARDERS) {
        assert.deepEqual(refsTo(f, SOURCES), [], '★ ' + path.basename(f) + ' 已删除，源码面不得再有说明符引用它');
    }
});

test('C2 「删」这条路必须留下可查的来由（否则下一个人只看到文件没了）', () => {
    const note = readJson('scripts/dead-export-baseline.json');
    const hit = (note.entries || []).find((e) => e.name === 'HAND_LABELS');
    assert.ok(hit, '★ HAND_LABELS 删壳后暴露成真零消费，必须在账本里有带理由的冻结项（不许静默消失）');
    assert.match(String(hit.reason || ''), /R21-O7|转发壳/, 'HAND_LABELS 的冻结理由必须写明它是被 R21-O7 删壳后暴露的');
});

test('C3 删净后 dead-exports 与 bind-consuming 两道门都得通过（删不是目的，门要真绿）', () => {
    for (const gate of ['scripts/dead-export-check.mjs', 'scripts/bind-consumption-audit.mjs']) {
        const r = spawnSync(process.execPath, [path.join(ROOT, gate)], { cwd: ROOT, encoding: 'utf8', timeout: 180000 });
        assert.equal(r.status, 0, '★ ' + gate + ' 必须在删除后通过，输出尾部：' + String(r.stdout || '').slice(-400));
    }
});

/* ═══════════════════════════ D · 负控制 ═══════════════════════════ */
test('D1 负控制：把被删的文件名加回一个 import ⇒ 同款判据必须抓到', () => {
    /* 在内存里造一份「复活」的源码面，跑与 C1 同一套判定函数。 */
    const revived = SOURCES.concat([{ rel: 'apps/games/__probe_revive.js', src: "import './games-data.js';\n" }]);
    const hits = refsTo('apps/games/games-data.js', revived);
    assert.ok(hits.includes('apps/games/__probe_revive.js'),
        '★ 复活的引用必须被同款判据抓到（抓不到说明 C1 是恒绿的假判据），实得 ' + JSON.stringify(hits));
});

test('D2 负控制：真仓此刻确实是「零引用」—— 判据不是靠夹具才绿', () => {
    for (const f of FORWARDERS) {
        assert.deepEqual(refsTo(f, SOURCES), [], '真仓源码面必须零引用 ' + path.basename(f));
    }
});

/* ═══════════════════════════ E · 版本锚 ═══════════════════════════ */
test('E1 五源同源且 ≥ ' + BORN_V, () => {
    const pkg = readJson('package.json');
    const man = readJson('manifest.json');
    const ul = readJson('update-log.json');
    const idx = read('index.js');
    assert.equal(pkg.version, man.version, 'package.json 与 manifest.json 必须同版');
    assert.equal(ul.latest, pkg.version, 'update-log latest 必须同版');
    assert.ok(idx.includes("const ST_PHONE_VERSION = '" + pkg.version + "'"), 'index.js 版本常量必须同版');
    const num = pkg.version.split('.').map((x) => Number(x));
    assert.equal(num.length, 3, '版本必须是三段数字：' + pkg.version);
    assert.ok(num.every((x) => Number.isInteger(x)), '版本三段必须都是整数：' + pkg.version);
    const born = BORN_V.split('.').map((x) => Number(x));
    const ok = num[0] > born[0]
        || (num[0] === born[0] && (num[1] > born[1] || (num[1] === born[1] && num[2] >= born[2])));
    assert.ok(ok, '版本必须 ≥ ' + BORN_V + '（实得 ' + pkg.version + '）');
});