// tests/system-v3230.test.mjs — 镜像树的瞬态竞态：把「同族被写了四次、三次忘了」收成唯一实现 [v3.23.0]
//
//   本版修的是 v3.23.0 全量门禁首跑的唯一一条红：
//     ✖ C0 镜像自身在破坏前全绿（否则负控制是假绿）
//       Error: ENOENT: no such file or directory, lstat
//              '/home/user/ruby-phone/tests/audit/.tmp_v315_probe_1790708298427.js'
//         at getStats (node:internal/fs/cp/cp-sync:64:19)
//         at copyDir (node:internal/fs/cp/cp-sync:176:9)
//
//   **根因不是环境抖动，是一次真·竞态**（TOCTOU）：`fs.cpSync` 对每个条目
//   「先 readdir 拿到名字 → 再 lstat → 再 copyDir」。`tests/system-v315.test.mjs` 的
//   N1 负控制**必须**往被快照的树里写一个探针文件再删掉（它观测的就是「快照比对能抓到
//   新增文件」—— 搬出被快照的树，那条判据就不成立了），于是并行的镜像类套件在
//   「拿到名字」与「lstat」之间撞上 unlink ⇒ ENOENT。
//
//   ★ 最重的一条教训（写进判据，防止再犯）：**同一件事在本仓被写了四次，其中三次忘了**。
//     · v314 `cpWithRetry` —— 唯一带防护的；
//     · v323 手写 `copyTree` —— 看着像防过了，其实 catch 的是 `readFileSync`，
//       而竞态抛在更早的 **lstat** 上（readFileSync 根本没走到）；
//     · v3171 裸 `cpSync` —— 本轮报错的落点；
//     · v299~v313 一整批裸 `cpSync`。
//     第四次忘记的那个，就是这次转红的那个。故上收为 `tests/_mirror_tree.mjs` 的
//     `copyTreeSafe`（唯一实现），16 个镜像点全部引用它，并由 A1 常驻守着
//     **tests/ 下不得再出现裸 `cpSync` 调用**。
//
//   本套件须自证两件事，否则「修好了」只是叙事：
//     ① **复现器真能复现**（F1）：裸 `cpSync` 在「复制途中源文件消失」时必须抛 ENOENT。
//        filter 回调在 lstat **之前**被调用，所以「在 filter 里删掉源文件」是**确定性**
//        的复现手段（不是靠并发赌概率）—— 实测 node v24 输出 `threw code=ENOENT`。
//     ② **共享实现真能容忍**（F2）：同一夹具下不抛，且副本**完整**（不是「什么都没拷」）。
//     两向都过之后，F3 才用**真源码破坏**（摘掉 ENOENT 容忍分支）证明 F2 不是假绿。
//
//   写法约定（沿用 v321/v322/v323 实测教训）：本文件**零反斜杠** —— 正则字面量里的
//   反斜杠在这个工具链里会被吞掉一层，导致替换静默不发生。故用 includes / split / endsWith。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const NL = String.fromCharCode(10);
/** 本套件自己 = 这条门禁的**驻场自证者**：F1 的对照组必须真裸调一次 `fs.cpSync`
 *  （不裸调就没有「复现器真能复现」的对照组），F3 的破坏源也是 `cpSync` 字符串。
 *  故 A1/A4 的扫描**显式豁免**本文件 —— 豁免范围与理由写在判据里，不靠文件名前缀碰运气。 */
const SELF = 'system-v3230.test.mjs';
/** F 段起点标记：本文件的裸调**只准出现在 F 段之后**（A 段扫描逻辑里一次也不许有）。
 *  [实测踩坑] 第一版用 `══════════ F 负控制` 当标记 —— 因框线字符个数与正文不符而**未匹配**，
 *  豁免静默失效（A1 转红）。教训同「锚点必须逐字节核对」：标记只留**汉字部分**。 */
const F_MARK = 'F 负控制';
const TEMPS = [];
const mkTmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'v3230-')); TEMPS.push(d); return d; };
process.on('exit', () => {
    for (const d of TEMPS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});

/* ══════════ A 唯一实现与口径 ══════════ */
test('v3230 A1. ★★★★ 唯一实现：镜像点全部引用共享实现，tests/ 下零裸 cpSync 调用', () => {
    const files = fs.readdirSync(path.join(ROOT, 'tests')).filter((f) => f.endsWith('.mjs'));
    const needle = 'cpSync' + '(';   /* 针脚拼接：A1 的判据段自身不得含该整串（本仓已记过两次自我指涉假红） */
    const naked = [];
    let users = 0;
    for (const f of files) {
        if (f === '_mirror_tree.mjs') continue;   /* 实现本体：里面恰好一次 cpSync */
        const raw = read(path.join('tests', f));
        if (raw.includes('copyTreeSafe')) users += 1;
        /* 本套件自己：豁免面**有界** —— 只豁免 F 段（F_MARK 之后）。F1 的对照组必须真裸调一次，
         *  没有它就没有「复现器真能复现」的对照组。A 段（标记之前）里的裸调照样算裸调。 */
        const body = f === SELF ? raw.substring(0, raw.indexOf(F_MARK)) : raw;
        for (const ln of body.split(NL)) {
            if (!ln.includes(needle)) continue;
            const t = ln.trim();
            /* 留档/注释里的提及不算调用（本仓多处注释引用了那次事故的栈） */
            if (t.startsWith('*') || t.startsWith('//')) continue;
            naked.push(f + ' :: ' + t.slice(0, 72));
        }
    }
    assert.deepEqual(naked, [], '镜像点必须走共享实现，不得裸调 cpSync：' + naked.join(' | '));
    assert.ok(users >= 18, '引用共享实现的文件数应不少于 18，实际 ' + users);
});
test('v3230 A2. ★★★ 实现口径：只容忍 ENOENT · 重试有界 · 耗尽仍抛（不吞错）', () => {
    const src = read('tests/_mirror_tree.mjs');
    assert.ok(src.includes('export function copyTree' + 'Safe'), '唯一实现的导出面必须在场');
    assert.ok(src.includes("e.code !== 'ENOENT'"), '必须只容忍 ENOENT —— 其它错误码立即抛');
    assert.ok(src.includes('attempt <= 4'), '重试必须有界（有限次），不得无限重试');
    assert.ok(src.includes('throw lastErr'), '重试耗尽必须抛出（真·持续失败要看得见）');
    assert.ok(src.includes('opts.filter'), '必须把 filter 透传给 cpSync（排除面不得被实现吃掉）');
});
test('v3230 A3. ★★★ 边界文档登记：为什么容忍 + 「不能保证」什么（不得只写「已修」）', () => {
    const doc = read('docs/runtime-verification-boundary.md');
    assert.ok(doc.includes('v3.23.0 复校'), '边界文档必须带当版复校标记');
    assert.ok(doc.includes('瞬态'), '必须写清缺陷形态（瞬态竞态），而不是「偶发抖动」');
    assert.ok(doc.includes('镜像'), '必须写到镜像这一面');
    assert.ok(doc.includes('不能保证'), '必须如实写「不能保证」，而不是「已完全验证」');
});
test('v3230 A4. ★★ 同族覆盖面可复核：引用面清单与实现只有一处（防止再被抄成第二份）', () => {
    const files = fs.readdirSync(path.join(ROOT, 'tests')).filter((f) => f.endsWith('.mjs'));
    /* [实测踩坑] 判据段自身若含目标字面量，会把自己扫进来 ⇒ **自我指涉假红**（本仓已记过两次）。
     *   故针脚拼接构造、并显式豁免本文件（理由与 A1 同：本套件是驻场自证者）。 */
    const needle = 'function copy' + 'TreeSafe';
    const defs = files.filter((f) => f !== SELF && read(path.join('tests', f)).includes(needle));
    assert.deepEqual(defs, ['_mirror_tree.mjs'], '实现必须只有一处，实际 ' + JSON.stringify(defs));
});

/* ══════════ F 负控制：复现器自证 → 未破坏须容忍 → 真破坏须转红 ══════════ */
/** 造「复制途中源文件消失」的夹具：`filter` 回调在 lstat **之前**被调用，
 *  故在 filter 里删掉 victim.txt ⇒ 下一次 lstat 必抛 ENOENT（确定性，不赌并发）。
 *  opts 只放 filter —— recursive 由被测函数自己加（避免「夹具替被测对象补上了前提」）。 */
function raceSetup() {
    const base = mkTmp();
    const src = path.join(base, 'src');
    fs.mkdirSync(path.join(src, 'a'), { recursive: true });
    fs.writeFileSync(path.join(src, 'a', 'keep.txt'), 'k');
    fs.writeFileSync(path.join(src, 'a', 'victim.txt'), 'v');
    return {
        src,
        dest: path.join(base, 'dest'),
        opts: { filter: (p) => { if (p.endsWith('victim.txt')) fs.unlinkSync(p); return true; } },
    };
}
function runRace(fn) {
    const f = raceSetup();
    try {
        fn(f.src, f.dest, f.opts);
        return { threw: false, copied: fs.existsSync(path.join(f.dest, 'a', 'keep.txt')) };
    } catch (e) {
        return { threw: true, code: e && e.code };
    }
}
test('v3230 F1. ★★★★ 复现器自证：裸 cpSync 在「复制途中源文件消失」时必须抛 ENOENT', () => {
    const r = runRace((s, d, o) => fs.cpSync(s, d, Object.assign({ recursive: true }, o)));
    assert.equal(r.threw, true, '复现器必须真能复现该竞态（否则 F2/F3 都是空跑）');
    assert.equal(r.code, 'ENOENT', '抛的必须是 ENOENT —— 与本仓实测栈同形，实际 ' + r.code);
});

const loadSafe = async (suffix) => {
    const mod = await import(pathToFileURL(path.join(ROOT, 'tests', '_mirror_tree.mjs')).href + '?' + suffix + '=' + Date.now());
    return mod.copyTreeSafe;
};
test('v3230 F2. ★★★★ 未破坏的共享实现：必须容忍该竞态，且副本完整', async () => {
    const safe = await loadSafe('r');
    const r = runRace((s, d, o) => safe(s, d, o));
    assert.equal(r.threw, false, '共享实现不得因一条瞬态竞态转红（那是把测量误差当成测量结果）');
    assert.equal(r.copied, true, '容忍之后副本必须真的完整（不是「什么都没拷」）');
});

test('v3230 F3. ★★★★ 真源码破坏：摘掉瞬态容忍（直接 cpSync 一次、不重试）⇒ F2 同款判据必须转红', async () => {
    /* [实测踩坑 · 记一笔] 本判据第一版破坏的是「只容忍 ENOENT」那一行：
     *   摘掉 `|| e.code !== 'ENOENT'` 之后**行为没变**（ENOENT 仍被容忍）⇒ 破坏后判据仍是绿的
     *   ⇒ 报「破坏后同款判据必须转红」失败。教训：**破坏必须写在决定行为的那个锚点上**；
     *   只是 `from` 锚点恰中 1 次**不等于**它一动行为就变。真正的防护是**重试**，
     *   故改为把实现体换成「裸调一次 cpSync，无重试」。 */
    const srcFile = path.join(ROOT, 'tests', '_mirror_tree.mjs');
    const orig = fs.readFileSync(srcFile, 'utf8');
    const anchor = "    let lastErr = null;";
    assert.equal(orig.split(anchor).length - 1, 1, '破坏锚点应恰中 1 次');
    const broken = orig.replace(anchor, "    return fs.cpSync(src, dest, cpOpts);" + NL + "    let lastErr = null;");
    const brokenFile = path.join(mkTmp(), 'mirror_broken.mjs');
    fs.writeFileSync(brokenFile, broken);
    assert.notEqual(fs.readFileSync(brokenFile, 'utf8'), orig, '破坏必须真改变源码');
    const mod = await import(pathToFileURL(brokenFile).href + '?brk=' + Date.now());
    const r = runRace((s, d, o) => mod.copyTreeSafe(s, d, o));
    assert.equal(r.threw, true, '破坏后同款判据必须转红（否则 F2 是假绿）');
    assert.equal(r.code, 'ENOENT', '红的原因必须就是那条 ENOENT，实际 ' + r.code);
});

/* ══════════ D 版本锚 ══════════ */
test('v3230 D1. ★ 本套件只在 3.23.0 及以后成立', () => {
    const man = JSON.parse(read('manifest.json'));
    const parts = man.version.split('.').map(Number);
    const ok = parts[0] > 3 || (parts[0] === 3 && (parts[1] > 23 || (parts[1] === 23 && parts[2] >= 0)));
    assert.ok(ok, '本套件成立于 RubyPhone 3.23.0 及以后，当前 ' + man.version);
    assert.equal(JSON.parse(read('update-log.json')).latest, man.version, 'update-log.latest 同源');
    const codeVer = (/const ST_PHONE_VERSION = '([^']+)'/.exec(read('index.js')) || [])[1];
    assert.equal(codeVer, man.version, '入口版本常量同源');
});