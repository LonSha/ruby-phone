/* ============================================================
 * RubyPhone v2.42.0 —— 零消费导出门禁 E6：消费判定必须基于真代码
 *
 * 本版问题：v2.41.0 建起的零消费导出门禁（scripts/dead-export-check.mjs）判定
 *   「是否被消费」用的是**裸词正则扫全文**——于是注释里的 TODO、JSDoc 的
 *   @param、字符串里的 key 名、模板串的文本部分，统统算「已消费」。
 *   后果：真死导出能被一句 `// TODO: eventually call X` 掩盖，门禁静默放过。
 *   本仓反复强调「漏报比误报更伤」，而这是**探测器自己**在漏报。
 *
 * 本版一件事：给门禁加 E6 —— 剔除注释与字符串字面量后再做词匹配。
 *   难点在口径（第一版踩过坑）：模板串的 `${...}` 插值必须按真代码处理，
 *   否则本仓大量「模板串拼 HTML + `${fn()}` 里真调用」的写法会被误抹，
 *   把真消费判成死导出（假阳性）。故本测试同时锁「不该漏」与「不该误」两侧。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`\u2713 ${name}`); }
    else { fail++; console.log(`\u2717 ${name} ${detail}`); }
};
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const GATE = path.join(root, 'scripts/dead-export-check.mjs');
const runGate = (args, env = {}) => spawnSync(process.execPath, [GATE, ...args],
    { encoding: 'utf8', env: { ...process.env, ...env } });
const FIX = { RP_DEAD_EXPORT_FIXTURE: '1' };
const mkFixture = (files) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dex242-'));
    fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'scripts/dead-export-baseline.json'),
        JSON.stringify({ note: '', entries: [] }));
    for (const [rel, body] of Object.entries(files)) {
        const p = path.join(tmp, rel);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, body);
    }
    return tmp;
};
/** 解析 --list 输出中某个文件的零消费导出名 */
const deadNames = (out, fileRel) => out.split('\n')
    .map(l => new RegExp(`${fileRel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+)\\s+(\\S+)`).exec(l))
    .filter(Boolean).map(m => m[2]);

/* ========== A. 门禁结构：E6 已落地 ========== */
{
    const src = read('scripts/dead-export-check.mjs');
    ok('A1 新增 stripNonCode 剥离器', /function stripNonCode\s*\(/.test(src));
    ok('A2 建立真代码文本表（与原文分开存）',
        /const codeTexts = new Map\(\)/.test(src) && /codeTexts\.set\(f\.rel, stripNonCode\(raw\)\)/.test(src));
    // v2.44.0（E8）刷新：`|| src` 的静默回退已被移除（剥离器失效现为 fail-closed），
    //   故此处断言改读**纯真代码**取行——比旧式「回退原文」更强，不是放宽。
    ok('A3 内部消费判定改读真代码行', /const codeLines = codeTexts\.get\(f\.rel\)\.split\('\\n'\)/.test(src));
    ok('A4 跨文件消费判定改读真代码', /const t = codeTexts\.get\(g\.rel\)/.test(src));
    ok('A5 模板串插值按代码递归处理（防「整串清空」误抹真消费）',
        /scan\(i, true\)/.test(src) && /stopAtBrace/.test(src));
    ok('A6 正则字面量起始识别关键词（return /re/、typeof /re/、case /re/）',
        /REGEX_KW/.test(src) && /return\|typeof\|case/.test(src));
    ok('A7 文档头登记了 E6 及其动机（注释/字符串提及不算消费）',
        /E6/.test(src) && /剔除注释/.test(src));
    // 反向：不得退回「裸词扫全文」
    ok('A8 内部消费不再用原文行做匹配', !/if \(re\.test\(lines\[i\]\)\) internal\+\+/.test(src));
    ok('A9 跨文件消费不再用原文整文做匹配', !/const t = texts\.get\(g\.rel\)/.test(src));
}

/* ========== B. 假阴性负控制：注释 / 字符串 / 模板文本「提及」不算消费 ========== */
{
    const LIB = [
        'export function used() { return 1; }',          // 真调用（跨文件）
        'export function cmtOnly() { return 2; }',       // 只在注释里被提及
        'export function strOnly() { return 3; }',       // 只在字符串里被提及
        'export function tagOnly() { return 4; }',       // 只在模板串**文本**里被提及
        'export function viaTemplate() { return 5; }',   // 在模板串 ${...} 插值里**真调用**
        'export function sameFile() { return 6; }',      // 同文件内被真调用
        'export function caller() { return sameFile(); }',
        'export function deadOne() { return 7; }',       // 无人提及，真死
    ].join('\n') + '\n';
    const USER = [
        "import { used, viaTemplate, caller } from './m/lib.js';",
        '// TODO: eventually call cmtOnly',
        "const k = 'strOnly';",
        'const tpl = `tagOnly`;',
        'const html = `<div>${viaTemplate()}</div>`;',
        'console.log(used(), caller(), html, k, tpl);',
    ].join('\n') + '\n';
    const tmp = mkFixture({ 'm/lib.js': LIB, 'main.js': USER });
    const r = runGate(['--list', '--root', tmp], FIX);
    const out = r.stdout + r.stderr;
    const dead = deadNames(out, 'm/lib.js');

    ok('B1 注释提及不算消费（cmtOnly 判死）', dead.includes('cmtOnly'), out.split('\n')[0]);
    ok('B2 字符串提及不算消费（strOnly 判死）', dead.includes('strOnly'));
    ok('B3 模板文本提及不算消费（tagOnly 判死）', dead.includes('tagOnly'));
    ok('B4 无人提及判死（deadOne）', dead.includes('deadOne'));
    ok('B5 真调用算消费（used 不判死）', !dead.includes('used'));
    ok('B6 模板串 ${} 插值里的真调用算消费（viaTemplate 不判死）——第一版踩坑回归',
        !dead.includes('viaTemplate'));
    ok('B7 同文件真调用算消费（sameFile 不判死）', !dead.includes('sameFile'));
    ok('B8 跨文件真调用的 caller 不判死', !dead.includes('caller'));
    ok('B9 零消费恰好 4 个（不多不少，口径无漂移）', dead.length === 4, `dead=${dead.join(',')}`);
    // 注：--list 按设计恒 exit 0（它只是查询面），红灯须走普通判定模式
    const rJudge = runGate(['--root', tmp], FIX);
    ok('B10 有未登记零消费时红灯 exit 1', rJudge.status === 1, `status=${rJudge.status}`);
    ok('B11 红灯时报出具体符号名（可定位，不是只报数）',
        /cmtOnly/.test(rJudge.stdout + rJudge.stderr) && /strOnly/.test(rJudge.stdout + rJudge.stderr));
    fs.rmSync(tmp, { recursive: true, force: true });
}

/* ========== C. 真源码破坏 → 判据行为改变（双向自证） ========== */
{
    const t1 = mkFixture({
        'a/x.js': 'export const alpha = 1;\n',
        'a/y.js': 'export const beta = 1;\n// alpha();\n',
    });
    const r1 = runGate(['--list', '--root', t1], FIX);
    ok('C1 破坏：唯一消费点降为注释提及 → alpha 判为零消费',
        deadNames(r1.stdout + r1.stderr, 'a/x.js').includes('alpha'),
        (r1.stdout + r1.stderr).split('\n')[0]);
    const t2 = mkFixture({
        'a/x.js': 'export const alpha = 1;\n',
        'a/y.js': "import { alpha } from './x.js';\nalpha();\n",
    });
    const r2 = runGate(['--list', '--root', t2], FIX);
    const o2 = r2.stdout + r2.stderr;
    ok('C2 恢复：改回真调用 → alpha 不再判死（判据真在跑，非写死）',
        deadNames(o2, 'a/x.js').length === 0 && /零消费 0/.test(o2), o2.split('\n')[1]);
    fs.rmSync(t1, { recursive: true, force: true });
    fs.rmSync(t2, { recursive: true, force: true });
}

/* ========== D. 冻结账本：3 条新登记的零消费导出必须写明理由 ========== */
{
    const raw = JSON.parse(read('scripts/dead-export-baseline.json'));
    const key = e => `${e.file}::${e.name}`;
    const map = new Map(raw.entries.map(e => [key(e), e]));
    ok('D1 账本结构齐备', typeof raw.note === 'string' && Array.isArray(raw.entries));
    for (const [k, tag] of [
        ['config/phone-chat-memory.js::recentStoryContext', 'D2'],
        ['config/runtime-lifecycle.js::childRuntimeCount', 'D3'],
        ['config/runtime-lifecycle.js::rebindGlobal', 'D4'],
    ]) {
        ok(`${tag} 本版新登记且在账本内：${k}`, map.has(k));
    }
    ok('D5 新增 3 条理由均为实质说明（非 TODO 占位）',
        ['config/phone-chat-memory.js::recentStoryContext',
            'config/runtime-lifecycle.js::childRuntimeCount',
            'config/runtime-lifecycle.js::rebindGlobal']
            .every(k => map.has(k) && !/^TODO/.test(map.get(k).reason) && map.get(k).reason.length > 30));
    ok('D6 全账本无 TODO 占位残留',
        raw.entries.every(e => typeof e.reason === 'string' && !/^TODO/.test(e.reason)));
    ok('D7 条目键唯一', new Set(raw.entries.map(key)).size === raw.entries.length);
}

/* ========== E. 真实仓库：门禁通过 + 分类完备 + 注释自陈零消费的项被判死 ========== */
{
    const liveRun = runGate([]);            // 普通判定模式：带汇总行 + 真实退出码
    const sum = liveRun.stdout + liveRun.stderr;
    const listed = runGate(['--list']);     // 查询模式：列出每个零消费符号
    const out = listed.stdout + listed.stderr;
    const m = /扫描 (\d+) 个文件 \/ (\d+) 个 export 声明（内部消费 (\d+) · 跨文件消费 (\d+) · 零消费 (\d+)）/.exec(sum);
    ok('E1 真实仓库扫描面可解析', !!m, sum.split('\n')[0]);
    if (m) {
        const [, files, total, internal, cross, dead] = m.map(Number);
        ok('E2 三类消费口径完备（内部 + 跨文件 + 零消费 = 声明总数，无落桶外）',
            internal + cross + dead === total, `${internal}+${cross}+${dead} vs ${total}`);
        ok('E3 扫描面 ≥ 170 文件（防遍历退化）', files >= 170, `${files}`);
        ok('E4 零消费数 ≥ 22（不低于 E6 修复前基线，防「改回宽松口径」）', dead >= 22, `${dead}`);
    }
    ok('E5 真实仓库在门禁下通过（exit 0）', liveRun.status === 0, `status=${liveRun.status}`);
    // 这三条正是 E6 修复后才现形的：文件内的注释自陈「零消费」也算零消费
    ok('E6 真实仓库：rebindGlobal 判为零消费（注释提及救不活它）',
        deadNames(out, 'config/runtime-lifecycle.js').includes('rebindGlobal'));
    ok('E7 真实仓库：recentStoryContext 判为零消费',
        deadNames(out, 'config/phone-chat-memory.js').includes('recentStoryContext'));
    ok('E8 真实仓库：childRuntimeCount 判为零消费',
        deadNames(out, 'config/runtime-lifecycle.js').includes('childRuntimeCount'));
}

console.log(`\n\u7ed3\u679c: ${pass} \u901a\u8fc7, ${fail} \u5931\u8d25`);
process.exit(fail > 0 ? 1 : 0);
