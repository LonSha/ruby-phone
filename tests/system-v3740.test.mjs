/* ============================================================
 * tests/system-v3740.test.mjs — R-O3「跨会话异步写回统一栅栏」静态门的**负控制**
 * ------------------------------------------------------------
 * 分工（三层，各守一面，互不顶替）：
 *   · `tests/system-v3580.test.mjs` —— 接线面：令牌与栅栏成对在场、域名字符串对账。
 *   · `scripts/session-writeback-audit.mjs` —— 时序面：令牌必须在**第一个 await 之前**
 *     记下、栅栏在其后、拒绝必撤、覆盖面有下限、逐写回口配对（静态门本体）。
 *   · **本套件** —— 上面那道静态门自己的体检：把真源码破坏成「已死但仍在场」的形态，
 *     同款判据必须转红；原版上同款判据必须为真（否则「恒红」也能骗过破坏表）。
 *
 * 为什么负控制必须落在**仓库内**（不是 /tmp 里的一次性脚本）：
 *   一次性脚本随会话消失，下一个人改了静态门就再没人跑得动体检；
 *   静态门一旦退化成「永远说 ✓」，`npm run check` 会一路绿着放行裸奔的写回口。
 *   本仓已有一条硬纪律：**判据必须自带破坏表**（见 system-v3580 的 D 面）。
 *
 * 为什么破坏落**镜像树**（不是真仓就地改）：
 *   真仓全程只读；破坏锚点必须**恰中 1 次**（不唯一即抛，防「改了别的行也照样红」）。
 *   镜像走 `copyTreeSafe`（同类事只留一份实现，见 tests/_mirror_tree.mjs）。
 *
 * 口径纪律：
 *   · 每条破坏两侧都断言：破坏后必须红、原版上同款判据必须真；
 *   · **负控制自己也要防造假**：②里同时测「短路绕过」（文本在场、运行时不执行）
 *     与「真删栅栏」（文本也不在场）—— 只测前者会漏掉「逐函数配对」是否正确工作，
 *     只测后者会漏掉「恒假短路」这一整族。两条都是**实测**出来的形态，非推演。
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { copyTreeSafe } from './_mirror_tree.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const AUDIT_REL = 'scripts/session-writeback-audit.mjs';

/* 镜像面：只要「含写回口的七个文件」+ 栅栏本体 ——
 *   静态门只读文本，不需要 apps/ 下的资源与 UI；
 *   全量镜像 50M+ 会让本套件从毫秒级掉到秒级，且与门禁目的无关。 */
const NEEDED = [
    'apps/calendar/calendar-app.js',
    'apps/diary/diary-data.js',
    'apps/honey/honey-data.js',
    'apps/wechat/chat-view.js',
    'apps/wechat/moments-view.js',
    'apps/weibo/weibo-data.js',
    'apps/weibo/weibo-view.js',
    'config/session-gate.js',
    AUDIT_REL,
];

const temps = [];
process.on('exit', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});

function makeMirror() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ro3-fixture-'));
    temps.push(dir);
    for (const rel of NEEDED) {
        const dst = path.join(dir, rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        copyTreeSafe(path.join(ROOT, rel), dst);
    }
    return dir;
}

/** 跑静态门（指定仓库根）。输出**不落进被扫描的树** ——
 *  本仓挂起事故的老根因是「子进程写管道、父进程 wait」双向死锁（输出超 64KB 管道缓冲）。
 *   这里输出量小（几百字节），但仍统一走内存；诊断留档走 os.tmpdir，避免污染真仓
 *   （第一版曾把 `__audit_out.txt` 写进仓库根，被 `git status` 立刻抓出）。 */
function runAudit(root) {
    const script = path.join(root, AUDIT_REL);
    const r = spawnSync(process.execPath, [script, `--root=${root}`], {
        encoding: 'utf8', timeout: 120000,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = (r.stdout || '') + (r.stderr || '');
    if (process.env.RO3_DEBUG) {
        try { fs.writeFileSync(path.join(os.tmpdir(), 'ro3-audit-last.txt'), out); } catch (_e) { /* 诊断用 */ }
    }
    return { code: r.status, out };
}

/** 真源码破坏：锚点必须恰中 1 次（不唯一即抛 —— 防「破坏没发生也照样红」）。 */
function damage(root, rel, from, to) {
    const p = path.join(root, rel);
    const s = fs.readFileSync(p, 'utf8');
    const n = s.split(from).length - 1;
    assert.equal(n, 1, `破坏锚点必须恰中 1 次（实际 ${n}）：${rel} :: ${from.slice(0, 70)}`);
    fs.writeFileSync(p, s.split(from).join(to));
}

function restore(root, rel) {
    copyTreeSafe(path.join(ROOT, rel), path.join(root, rel));
}

test('R-O3-N0 阳性对照：未破坏的镜像上静态门必须全绿（否则后面每条转红都是空断言）', () => {
    const root = makeMirror();
    const r = runAudit(root);
    assert.equal(r.code, 0, '未破坏应全绿，实际：' + r.out.slice(-800));
    assert.match(r.out, /捕获点 \d+ · 栅栏点 \d+/);
});

test('R-O3-N1 令牌记在首个 await 之后 ⇒ 必须转红', () => {
    const root = makeMirror();
    damage(root, 'apps/weibo/weibo-data.js',
        [
            '            const sessionToken = captureSessionToken(this.storage);',
            '            const contextMessages = await this._collectContextMessages(options);',
        ].join('\n'),
        [
            '            const contextMessages = await this._collectContextMessages(options);',
            '            const sessionToken = captureSessionToken(this.storage);',
        ].join('\n'));
    const r = runAudit(root);
    assert.notEqual(r.code, 0, '令牌记晚必须转红');
    assert.match(r.out, /捕获时机过晚/, '必须报出「记晚了」这一原因，不能只是笼统红');
    restore(root, 'apps/weibo/weibo-data.js');
});

test('R-O3-N2a 短路绕过栅栏（`false &&`：文本在场、运行时不执行）⇒ 必须转红', () => {
    const root = makeMirror();
    damage(root, 'apps/honey/honey-data.js',
        'if (!guardSessionWrite(this.storage, sessionToken, ',
        'if (false && (function(){return false})() && guardSessionWrite(this.storage, sessionToken, ');
    const r = runAudit(root);
    assert.notEqual(r.code, 0, '恒假短路必须转红 —— 否则改一行 `false &&` 就能让门全绿而写回口裸奔');
    assert.match(r.out, /恒假短路/, '必须显式报出「短路绕过」这一形态');
    restore(root, 'apps/honey/honey-data.js');
});

test('R-O3-N2b 真删栅栏调用（文本也不在场）⇒ 必须转红（逐函数配对）', () => {
    const root = makeMirror();
    /* hone 的栅栏是**多行块形态**（`if (!guardSessionWrite(…)` 换行后才收），
       故锚点取调用头那一句 —— 与 N2a 同址但破坏强度不同：
       N2a 让它「文本在场、运行时不执行」，N2b 让它「文本也不在场」。 */
    damage(root, 'apps/honey/honey-data.js',
        "if (!guardSessionWrite(this.storage, sessionToken, 'honey-host-summary'))",
        "if (!__removed(this.storage, sessionToken, 'honey-host-summary'))");
    const r = runAudit(root);
    assert.notEqual(r.code, 0, '摘掉单个写回口的栅栏必须转红（只比总数抓不到这一形态）');
    assert.match(r.out, /裸奔|配对/, '必须报出「该写回口裸奔」这一原因');
    restore(root, 'apps/honey/honey-data.js');
});

test('R-O3-N3 栅栏拒绝后不撤（return 改成赋值）⇒ 必须转红', () => {
    const root = makeMirror();
    damage(root, 'apps/diary/diary-data.js',
        "if (!guardSessionWrite(this.storage, sessionToken, 'diary-photo')) return latest;",
        "if (!guardSessionWrite(this.storage, sessionToken, 'diary-photo')) { latest = null; }");
    const r = runAudit(root);
    assert.notEqual(r.code, 0, '「只判不撤」必须转红');
    assert.match(r.out, /拒绝后无撤离动作/, '必须报出「只判不撤」这一原因');
    restore(root, 'apps/diary/diary-data.js');
});

test('R-O3-N4 覆盖下限：删掉三处写回口 ⇒ 必须转红', () => {
    const root = makeMirror();
    for (const rel of ['apps/honey/honey-data.js', 'apps/wechat/moments-view.js', 'apps/calendar/calendar-app.js']) {
        const p = path.join(root, rel);
        fs.writeFileSync(p, fs.readFileSync(p, 'utf8').split('captureSessionToken(').join('__removed('));
    }
    const r = runAudit(root);
    assert.notEqual(r.code, 0, '写回口被删到不足覆盖面必须转红 —— 判据被掏空等同没测');
    restore(root, 'apps/honey/honey-data.js');
    restore(root, 'apps/wechat/moments-view.js');
    restore(root, 'apps/calendar/calendar-app.js');
});

test('R-O3-N5 剥器纯度：头部塞含引号正则 ⇒ 捕获点计数不得减少（剥器不许静默吞真调用）', () => {
    const root = makeMirror();
    const before = /捕获点 (\d+)/.exec(runAudit(root).out);
    assert.ok(before, '阳性读数必须能取到捕获点计数');
    const p = path.join(root, 'apps/weibo/weibo-view.js');
    fs.writeFileSync(p, "const __probe = /['\"\\/]/;\n" + fs.readFileSync(p, 'utf8'));
    const r = runAudit(root);
    const after = /捕获点 (\d+)/.exec(r.out);
    assert.ok(after, '加正则后仍须能读到捕获点计数');
    assert.equal(Number(after[1]), Number(before[1]),
        '含引号正则不得让捕获点计数减少（剥器状态机错位会静默少报写回口）');
});

test('R-O3-N6 真仓只读自证：本套件跑完，真仓静态门仍全绿且文件摘要未变', () => {
    const before = NEEDED.map((rel) => {
        const s = fs.readFileSync(path.join(ROOT, rel));
        return rel + ':' + s.length;
    }).join('|');
    const r = runAudit(ROOT);
    assert.equal(r.code, 0, '真仓静态门必须全绿：' + r.out.slice(-600));
    const after = NEEDED.map((rel) => {
        const s = fs.readFileSync(path.join(ROOT, rel));
        return rel + ':' + s.length;
    }).join('|');
    assert.equal(after, before, '负控制不得改动真仓（破坏只落镜像树）');
});
