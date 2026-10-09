/* ============================================================
 * tests/system-v3750.test.mjs — R-O2「抬版演练」内核的判据套件
 * ------------------------------------------------------------
 * 本套件测的是 **tools/bump-drill-core.mjs**（纯函数），不是驱动器 ——
 * 驱动器的副作用（起镜像、跑 node、落报告）在单元测试里跑不动；
 * 而本工具**已经错过的那几处**全部落在纯函数里：
 *   · 取数：Node 24 批量跑不打文件级 `✖`，只打 `test at …` ⇒ 旧解析器把 exit 1 读成「红 0」；
 *   · 宿主资格：带顶层 process.exit 的套件会把注入的判据静默吞掉、并伪装成全绿；
 *   · 分组：锚组与连带面组混在一起 ⇒ 该改判据的被当成该补动作；
 *   · 版本比较：字符串比会让 3.9.10 < 3.10.0。
 * 故本套件对每一件做**两向**验证：正控（真样本要给对答案）+ 负控（把判据该抓的错喂进去必须转红）。
 * ============================================================ */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    classifySources, pickProbeHost, parseFailedFromOutput, isUnattributedRed,
    cmpVersion, analyzeDrill, analyzeProbes, CARRY_RE, TOP_LEVEL_EXIT_RE,
    planCarry, CARRY_PLAN, iterMetaAnchor, boundaryAnchor,
} from '../tools/bump-drill-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const manifest = JSON.parse(read('manifest.json'));


/* ── A. 分组口径 ── */
test('v3750 A1. 分组读真仓：锚组与连带面组都非空，且互斥', () => {
    const T = path.join(ROOT, 'tests');
    const names = fs.readdirSync(T).filter((n) => n.endsWith('.test.mjs')).sort();
    const { anchors, carry } = classifySources(names.map((n) => [n, read(path.join('tests', n))]));
    assert.ok(anchors.length >= 20, '锚组必须有足够样本（实得 ' + anchors.length + '）—— 样本不足时「零红」无意义');
    assert.ok(carry.length >= 1, '连带面组不得为空（实得 ' + carry.length + '）');
    const dup = anchors.filter((n) => carry.includes(n));
    assert.deepEqual(dup, [], '同一套件不得同时落两组：' + dup.join(','));
});
test('v3750 A2. 分组是「读内容」而不是「猜文件名」：改了内容就换组', () => {
    const plain = [['x.test.mjs', "import test from 'node:test';\ntest('t', () => {});\n"]];
    assert.deepEqual(classifySources(plain), { anchors: [], carry: [] },
        '不读版本源的套件不该进任何一组（它没资格当锚）');
    const withVer = [['x.test.mjs', "import test from 'node:test';\nconst v = 'ST_PHONE_VERSION';\n"]];
    assert.deepEqual(classifySources(withVer).anchors, ['x.test.mjs']);
    const withCarry = [['x.test.mjs', "import test from 'node:test';\nread('ITERATION_LOG.md');\nconst v='ST_PHONE_VERSION';\n"]];
    assert.deepEqual(classifySources(withCarry), { anchors: [], carry: ['x.test.mjs'] },
        '读了连带面载体的必须归第二组（它的红是动作清单，不是版本锚缺陷）');
});
test('v3750 A3. 起子进程的套件排除在批量面外（它们与 node 的 worker 调度互扰）', () => {
    const spawns = [['x.test.mjs', "import { spawnSync } from 'node:child_process';\nconst v='manifest.json';\n"]];
    assert.deepEqual(classifySources(spawns), { anchors: [], carry: [] });
});
test('v3750 A4. 负控：连带面载体名必须真被 CARRY_RE 认到（三处载体逐条验）', () => {
    for (const probe of ['ITERATION_LOG.md', 'docs/runtime-verification-boundary.md', 'tests/audit/status-ledger.json']) {
        assert.ok(CARRY_RE.test(probe), '连带面载体未被认出（会把它算成版本锚缺陷）：' + probe);
    }
    assert.ok(!CARRY_RE.test('docs/README.md'), 'CARRY_RE 过宽：普通文档也算连带面了');
});

/* ── B. 注入宿主资格（本工具真栽过的那一处）── */
test('v3750 B1. 带顶层 process.exit 的文件**不得**当注入宿主（它会把注入的判据静默吞掉）', () => {
    const poisoned = [[
        'poisoned.test.mjs',
        "import fs from 'node:fs';\nimport test from 'node:test';\nprocess.exit(0);\nconst v = 'manifest.json';\n",
    ]];
    assert.equal(pickProbeHost(poisoned), null,
        '顶层 process.exit 的宿主会让注入的 test 永不注册 —— 必须否决（本工具第一版栽在这里）');
});
test('v3750 B2. 不用 node:test 的文件也不得当宿主（注入的 test 不会被运行器收走）', () => {
    const plain = [['plain.test.mjs', "const v = 'manifest.json';\nconsole.log(v);\n"]];
    assert.equal(pickProbeHost(plain), null);
});
test('v3750 B3. 合格宿主：既不含顶层 exit、又真引用 node:test', () => {
    const good = [['good.test.mjs', "import test from 'node:test';\nconst v = 'manifest.json';\n"]];
    assert.equal(pickProbeHost(good), 'good.test.mjs');
});
test('v3750 B4. 真仓上现取宿主：必须是合格件，且真存在于 tests/', () => {
    const T = path.join(ROOT, 'tests');
    const names = fs.readdirSync(T).filter((n) => n.endsWith('.test.mjs')).sort();
    const host = pickProbeHost(names.map((n) => [n, read(path.join('tests', n))]));
    assert.ok(host, '真仓里应至少有一个合格宿主');
    assert.ok(fs.existsSync(path.join(T, host)), '宿主必须真实存在：' + host);
    const src = read(path.join('tests', host));
    assert.ok(!TOP_LEVEL_EXIT_RE.test(src), '宿主不得含顶层 process.exit：' + host);
});
test('v3750 B5. 真实反例留档：tests/audit.test.mjs 正是被否决的那一类', () => {
    const src = read('tests/audit.test.mjs');
    assert.ok(TOP_LEVEL_EXIT_RE.test(src),
        'audit.test.mjs 的顶层 process.exit 是本条判据的**真实来由**：它一旦被改成不含 exit，'
        + '本判据失去反例，应当同步复核「宿主资格」还需要哪一条');
});

/* ── C. 取数口径（假绿真发生过的那一处）── */
test('v3750 C1. 文件级形态 `✖ tests/x.test.mjs` 必须取到（单文件跑的主形态）', () => {
    const out = "✖ tests/system-v280.test.mjs\nℹ tests 1\nℹ fail 1\n";
    assert.deepEqual(parseFailedFromOutput(out).failed, ['tests/system-v280.test.mjs']);
    assert.equal(parseFailedFromOutput(out).failCount, 1);
});
test('v3750 C2. 用例级形态 `test at tests/x.test.mjs:12:1` 必须取到（Node 24 批量跑的主形态）', () => {
    const out = '✖ v280 2. 元信息（文档不得说谎） (1.4ms)\n'
        + '    at TestContext.<anonymous> (file:///tmp/x/tests/system-v280.test.mjs:35:10)\n'
        + 'test at tests/system-v280.test.mjs:32:1\n'
        + '✖ failing tests:\nℹ tests 43\nℹ fail 3\n';
    const got = parseFailedFromOutput(out).failed;
    assert.deepEqual(got, ['tests/system-v280.test.mjs'],
        '这一形态漏读就是**假绿**：exit 1 会被报成「红 0」（本工具第二版真发生过）');
});
test('v3750 C3. 负控：断言行的判定名不得被当失败件（会虚报）', () => {
    const out = "✖ 某条判定名（长得像文件但没路径）\nℹ tests 1\nℹ fail 1\n";
    assert.deepEqual(parseFailedFromOutput(out).failed, [],
        '只认路径形态；把判定名当文件会让「红了几件」虚高到无法读数');
});
test('v3750 C4. 两处独立取数：failed 与 failCount 必须同时给出（一处写错另一处能抓）', () => {
    const out = 'test at tests/a.test.mjs:1:1\nℹ tests 9\nℹ fail 2\n';
    const r = parseFailedFromOutput(out);
    assert.equal(r.failed.length, 1);
    assert.equal(r.failCount, 2, '汇总行与明细条数不等时，读的人应当看见 —— 不许只报一个数');
});
test('v3750 C5. 无汇总行时 failCount 必须是 NaN（未执行不报 0）', () => {
    const r = parseFailedFromOutput('没有任何汇总输出\n');
    assert.ok(Number.isNaN(r.failCount), '取不到汇总行时必须报 NaN —— 报 0 就是「未执行报通过」');
});
test('v3750 C6. 「有红但一件都没点名」必须被判为不可归因（不许据此报零红）', () => {
    assert.equal(isUnattributedRed({ red: true, failed: [] }), true);
    assert.equal(isUnattributedRed({ red: false, failed: [] }), false, '没红时明细为空是正常的');
    assert.equal(isUnattributedRed({ red: true, failed: ['tests/a.test.mjs'] }), false);
});

/* ── D. 版本比较 ── */
test('v3750 D1. 按数字段比较（字符串比会把 3.9.10 判小于 3.10.0）', () => {
    assert.equal(cmpVersion('3.72.0', '3.72.1'), -1);
    assert.equal(cmpVersion('3.9.10', '3.10.0'), -1, '字符串比较会在这里给出相反答案');
    assert.equal(cmpVersion('3.72.0', '3.72.0'), 0);
    assert.equal(cmpVersion('4.0.0', '3.99.99'), 1);
});
test('v3750 D2. 形状不完整时按缺位补 0（不因 "3.72" 崩掉或误判）', () => {
    assert.equal(cmpVersion('3.72', '3.72.0'), 0);
    assert.equal(cmpVersion('3.72', '3.72.1'), -1);
});

/* ── E. 读数归因（三类结论必须分开）── */
test('v3750 E1. 锚组新增红 → anchor_regressions；连带面红 → carry_pending（两类不许混）', () => {
    const runs = [{
        unattributed_red: false,
        baseline: { failed: [] },
        anchor_group: { suite_files: 80, added_by_bump: ['tests/system-v100.test.mjs'] },
        carry_group: { suite_files: 10, failed: ['tests/system-v280.test.mjs'] },
    }];
    const a = analyzeDrill(runs);
    assert.deepEqual(a.anchor_regressions, ['tests/system-v100.test.mjs']);
    assert.deepEqual(a.carry_pending, ['tests/system-v280.test.mjs']);
    assert.equal(a.coverage_ok, true);
});
test('v3750 E2. 覆盖面缩水必须让 coverage_ok 转假（跑少了不等于没问题）', () => {
    const thin = [{
        unattributed_red: false, baseline: { failed: [] },
        anchor_group: { suite_files: 3, added_by_bump: [] },
        carry_group: { suite_files: 10, failed: [] },
    }];
    const a = analyzeDrill(thin);
    assert.equal(a.coverage_ok, false);
    assert.ok(a.problems.some((p) => p.includes('覆盖面缩水')),
        '锚组只跑 3 件时必须拒判 —— 否则「分组器坏掉」与「零红」不可分');
});
test('v3750 E3. 连带面组缺席同样是缩水（它的红就无从发现）', () => {
    const a = analyzeDrill([{
        unattributed_red: false, baseline: { failed: [] },
        anchor_group: { suite_files: 80, added_by_bump: [] },
        carry_group: { suite_files: 0, failed: [] },
    }]);
    assert.equal(a.coverage_ok, false);
});
test('v3750 E4. 基线本就有红 ⇒ 拒判（差值算不出来）', () => {
    const a = analyzeDrill([{
        unattributed_red: false,
        baseline: { failed: ['tests/system-v999.test.mjs'] },
        anchor_group: { suite_files: 80, added_by_bump: [] },
        carry_group: { suite_files: 10, failed: [] },
    }]);
    assert.equal(a.coverage_ok, false);
    assert.ok(a.problems.some((p) => p.includes('拒判')));
});
test('v3750 E5. 不可归因的红也必须让结论不可用', () => {
    const a = analyzeDrill([{
        unattributed_red: true, baseline: { failed: [] },
        anchor_group: { suite_files: 80, added_by_bump: [] },
        carry_group: { suite_files: 10, failed: [] },
    }]);
    assert.equal(a.coverage_ok, false);
});
test('v3750 E6. 真仓读数回放：本次演练的四件连带面红与零锚红', () => {
    const rep = path.join(ROOT, 'tests/audit/bump-drill.json');
    if (!fs.existsSync(rep)) {
        assert.ok(true, '报告不在场（未跑过演练）—— 本判据跳过，不虚报');
        return;
    }
    const j = JSON.parse(fs.readFileSync(rep, 'utf8'));
    assert.ok(Array.isArray(j.runs) && j.runs.length >= 1, '报告必须含至少一次演练读数');
    for (const r of j.runs) {
        assert.deepEqual(r.anchor_group.added_by_bump || [], [],
            '版本锚组不得因抬版新增红（R-O2 的验收原文）：' + (r.label || ''));
    }
    /* 报告的 verdict/analysis 必须与内核现算一致 —— 防「报告是旧版口径写的」 */
    const recomputed = analyzeDrill(j.runs);
    assert.equal(j.analysis.coverage_ok, recomputed.coverage_ok, 'report 与内核现算不一致（口径漂移）');
    assert.deepEqual(j.analysis.anchor_regressions, recomputed.anchor_regressions);
    /* ⑥d 清单读数回放：报告里必须能读出「照清单之后还剩几件红」。
     *   旧 schema（只有 carry_group.failed 一个数）在本判据下必然红 —— 那正是本条要防的：
     *   读者只剩「这些红都是动作没做」这一句声明可依，无从复核。 */
    for (const r of j.runs) {
        const cp = r.carry_plan;
        assert.ok(cp, '报告缺 carry_plan 面（R-O2 第 4 条的读数没落盘）:' + (r.label || ''));
        assert.ok(Array.isArray(cp.actions) && cp.actions.length >= 1, '清单动作表不得为空');
        assert.ok(Array.isArray(cp.applied) || Array.isArray(cp.problems), '清单执行读数缺失');
        assert.ok(cp.recheck && typeof cp.recheck === 'object', '复跑读数缺失');
        if (cp.recheck.executed) {
            assert.equal(cp.sufficient, (cp.recheck.failed || []).length === 0,
                'sufficient 必须由复跑余红现算（不许手写结论）');
            const before = (r.carry_group && r.carry_group.failed) || [];
            const after = cp.recheck.failed || [];
            assert.ok(after.length <= before.length,
                '照清单之后红反而变多（前 ' + before.length + ' → 后 ' + after.length + '）—— '
                + '说明清单动作本身引入了新红，比不做更坏');
        } else {
            assert.equal(cp.sufficient, null, '没跑复跑面时不得给「充分」结论（未执行不报通过）');
            assert.ok(cp.recheck.note, '未执行必须写明缘由');
        }
    }
});

/* ── F. 探针结论 ── */
test('v3750 F1. token 没红 ⇒ tool_valid 必为假（注入根本没过 ⇒ 锚的读数不可信）', () => {
    const p = { probes: [
        { kind: 'equal', caught: false, token_red: false },
        { kind: 'ceil', caught: false, token_red: false },
        { kind: 'floor', caught: false, token_red: false },
    ] };
    const a = analyzeProbes(p);
    assert.equal(a.token_ok, false);
    assert.equal(a.tool_valid, false,
        '「注入被静默吞掉」与「探针没被抓住」在读数上同形 —— 必须以 token 为前置条件');
});
test('v3750 F2. token 真、equal 被抓 ⇒ tool_valid 为真', () => {
    const a = analyzeProbes({ probes: [
        { kind: 'equal', caught: true, token_red: true },
        { kind: 'ceil', caught: true, token_red: true },
        { kind: 'floor', caught: false, token_red: true },
    ] });
    assert.equal(a.tool_valid, true);
    assert.equal(a.equal_caught, true);
    assert.equal(a.floor_flipped, false);
});
test('v3750 F3. 盲区必须随结论一起输出（下限形锚与「全库无锚」读数同形）', () => {
    const a = analyzeProbes({ probes: [{ kind: 'equal', caught: true, token_red: true }] });
    assert.match(a.blind_spot, /下限形锚/);
    assert.match(a.blind_spot, /不能证明/);
});
test('v3750 F4. 负控：floor 被抓住 = 探针注错了目标（不是「更安全」）', () => {
    const a = analyzeProbes({ probes: [
        { kind: 'equal', caught: true, token_red: true },
        { kind: 'floor', caught: true, token_red: true },
    ] });
    assert.equal(a.floor_flipped, true, '下限形锚按原理不该因抬版翻面 —— 翻了说明注入了别的判据');
});

/* ── G. 驱动器自身的门（不许再有第二份实现 / 不许无声降级）── */
test('v3750 G1. 内核是唯一实现：取数与分组不在驱动器里再来一份', () => {
    const drv = read('tools/bump-drill.mjs');
    assert.match(drv, /from '\.\/bump-drill-core\.mjs'/, '驱动器必须 import 内核');
    assert.ok(!/^test at /.test(drv) || !drv.includes('test at (tests/'),
        '驱动器不得自带第二份取数正则（两份实现必然漂移）');
    assert.ok(!/const VERSION_SOURCE_RE =/.test(drv), '驱动器不得自带第二份分组正则');
});
test('v3750 G2. 工作区不干净时默认拒跑（--allow-dirty 是显式开关，且读数里留痕）', () => {
    const drv = read('tools/bump-drill.mjs');
    assert.match(drv, /ALLOW_DIRTY/, '必须有显式开关');
    assert.match(drv, /baseline: \{[^}]*clean:/s, '报告里必须记 baseline.clean');
    assert.ok(drv.indexOf('ALLOW_DIRTY') < drv.indexOf('const TARGETS'),
        '拒跑判定必须发生在起镜像之前（否则脏树已经被镜像进去了）');
});
test('v3750 G3. 自扫：本套件自己**不得**含「当版等值锚」（R-O2 的功课写进判据）', () => {
    /* ★ 这一条本身就是 R-O2 的功课。本仓最常见的坏判据是
     *   `assert.equal(manifest.version, '3.72.0')` —— 把「本套件写于哪一版」
     *   写成「当版必须永远等于那一版」，于是**每一次正确的抬版都会误报红**，
     *   而修它的人多半会去改判据（对）或干脆删判据（错）。
     *   v3750 不写版本常量，改为**自扫**：本文件里不许出现对活版本的等值断言。
     *   这样它既不随抬版漂移，也不依赖「文件名 ↔ 版本」的命名约定（那条约定在本仓
     *   其实做不到：同一个版本会有多个套件，例如 v3.73.0 已有一个 v3730）。 */
    const self = path.basename(fileURLToPath(import.meta.url));
    const src = read(path.join('tests', self));
    /* 扫的是**代码**：注释里为了讲清楚坏写法而举的例子不算（否则本判据会自己撞自己）。
     * 用等长空白替换注释正文，行号因此不变。 */
    const code = src
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
    const ANCHOR_RE = /version\s*,\s*'3\.\d+\.\d+'/;
    const lines = code.split('\n');
    const bad = new Set();
    for (let i = 0; i < lines.length; i++) {
        if (!/assert\s*\.\s*(equal|strictEqual)\s*\(/.test(lines[i])) continue;
        const win = lines.slice(i, i + 12).join('\n');
        if (ANCHOR_RE.test(win)) bad.add(i + 1);
        if (/(manifest|pkg|packageJson)\s*\.\s*version\s*,\s*'[\d.]+'/.test(win)) bad.add(i + 1);
    }
    const rows = [...bad].sort((a, b) => a - b);
    assert.deepEqual(rows, [],
        '第 ' + rows.join(',') + ' 行含「当版等值锚」—— 它会随抬版误报红，请改成不变量'
        + '（下限形 / 子序列同序 / 不变量自证）');
    /* 反向自证：本判据自己得真能抓到那种写法（否则它是一条永远为真的空判据）。
     * 样本由片段拼出 —— 否则它本身就成了「本文件里的等值锚」，又撞自己。 */
    const sample = ['assert.equal(manifest.version', "'3.72.0');"].join(', ');
    assert.ok(ANCHOR_RE.test(sample), '本判据的正则必须能抓住样本写法');
    /* 反向自证之二：注释剔除器得真能剔掉注释。 */
    const stripped = '/* X */'.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    assert.ok(!/X/.test(stripped), '注释剔除器失效 —— 自扫会把自己的注释当坏判据');
});

/* ── H. 连带面**动作清单自证**（R-O2 第 4 条：抬版流程不再把这些红当噪声）──
 *   这一族要证的不是「有清单」，而是**清单是不是充分的**：
 *   把清单在镜像里真跑一遍、再复跑该组 —— 0 红才算清单在当版说得过去。
 *   故本段对 planCarry 同样做两向：正控（真仓上真能推演出三条动作）+ 负控（锚点对不上必须拒改）。
 *   本段不写任何版本常量：`next` 由真仓当版**现推**，与 G3 的自扫纪律同源。 */
const CUR = manifest.version;
const NEXT = CUR.replace(/(\d+)$/, (d) => String(Number(d) + 1));
const carryFiles = () => {
    const files = {};
    for (const a of CARRY_PLAN) if (!(a.rel in files)) files[a.rel] = read(a.rel);
    return files;
};

test('v3750 H1. planCarry 正控（读真仓）：三条动作全应用、零问题，且产物真变了', () => {
    const files = carryFiles();
    const r = planCarry(files, CUR, NEXT);
    assert.deepEqual(r.problems, [], '真仓上不该有清单腐坏：' + r.problems.join('；'));
    assert.deepEqual(r.applied.slice().sort(), CARRY_PLAN.map((a) => a.id).sort(),
        '三条动作都该被应用（实得 ' + r.applied.join(',') + '）—— 少一条说明锚点随抬版漂了');
    const log = r.files['ITERATION_LOG.md'];
    assert.ok(log.includes(iterMetaAnchor(NEXT)), '产物里元信息必须已换成抬版后的版本');
    assert.ok(!log.includes(iterMetaAnchor(CUR)), '产物里旧元信息必须已消失（否则 v280 判据照旧红）');
    const bnd = r.files['docs/runtime-verification-boundary.md'];
    assert.ok(bnd.includes(boundaryAnchor(NEXT)), '边界文档须换成当版复校标记');
    assert.ok(!bnd.includes(boundaryAnchor(CUR)), '旧复校标记须已消失');
    /* 历史复校行是**留档**不是待办：替换型动作只能动头部那一处（锚点恰中 1 次这条纪律的来由）。 */
    assert.ok(bnd.includes('v3.63.0 复校'), '历史复校行不得被顺手改掉（那是留档）');
});

test('v3750 H2. 幂等：清单已做过时一律报 noop，不猜、不重复插段', () => {
    const once = planCarry(carryFiles(), CUR, NEXT).files;
    const twice = planCarry(once, CUR, NEXT);
    assert.deepEqual(twice.applied, [], '已做过的不许再应用一遍（第二次跑会插出两个合成段）');
    assert.deepEqual(twice.problems, [], '「已做过」是正常态，不得记成腐坏');
    assert.equal(twice.noop.length, CARRY_PLAN.length, '每条都该报 noop：' + twice.noop.join(','));
    const segs = twice.files['ITERATION_LOG.md'].split('【抬版演练合成段】').length - 1;
    assert.equal(segs, 1, '合成段只许有一段（实得 ' + segs + ' —— 幂等失效）');
});

test('v3750 H3. 负控：锚点对不上必须拒改（fail-closed，不猜）', () => {
    const r = planCarry(carryFiles(), '2.0.0', '2.0.1');
    const appliedReplace = r.applied.filter((id) =>
        CARRY_PLAN.some((a) => a.id === id && a.kind === 'replace'));
    assert.deepEqual(appliedReplace, [],
        '锚点 0 命中时不许改写型动作（猜了就会误改历史留档）');
    assert.ok(r.problems.length >= 2, '两条替换型都该记 problems（实得 ' + r.problems.length + '）');
    assert.ok(r.problems.every((p) => p.includes('恰 1')), '问题文案要能指认「应恰 1 次」这条纪律');
    /* 插入型与替换型在这一点上**不同形**（它没有可对不上的旧串）：
     *   插入型只看「有没有当版段」这个客观事实 —— 用一个不存在的版本号问它，
     *   它当然该插。若哪天插入型也开始因「锚点对不上」拒做，那说明有人把两类混成一类了。 */
    assert.ok(r.applied.includes('iter-segment'), '插入型不随替换型的锚点腐坏而失效（两者不同形）');
    /* 载体不在场也要记问题 —— 否则「清单腐坏」与「这条不用做」会被混为一谈。 */
    const r2 = planCarry({}, CUR, NEXT);
    assert.equal(r2.applied.length, 0);
    assert.ok(r2.problems.length >= 2, '载体全缺时必须逐条记 problems');
});

test('v3750 H4. planCarry 是纯函数：入参一字不改（落盘只能在驱动器里）', () => {
    const files = carryFiles();
    const before = files['ITERATION_LOG.md'];
    planCarry(files, CUR, NEXT);
    assert.equal(files['ITERATION_LOG.md'], before, '入参被改动了 —— 那真仓就有被误写的路');
    assert.ok(!files['ITERATION_LOG.md'].includes(iterMetaAnchor(NEXT)));
});

test('v3750 H5. 清单纪律：载体必须落在 CARRY_RE 认得的范围里，两类动作字段各自齐备', () => {
    for (const a of CARRY_PLAN) {
        assert.ok(a.id && a.rel && a.why, '每条动作都得有 id/rel/why（清单是给人读的）：' + a.id);
        assert.ok(CARRY_RE.test(a.rel),
            '清单载体不在分组认得的三处之内：' + a.rel + ' —— 两套载体名单会各自漂移，'
            + '于是清单「充分」也只对另一拨套件成立');
        if (a.kind === 'replace') {
            assert.equal(typeof a.oldAnchor, 'function', '替换型必须能现推旧锚（写死会随抬版漂）');
            assert.equal(typeof a.newText, 'function', '替换型必须能现推新串');
        } else {
            assert.equal(a.oldAnchor, undefined, '插入型没有「旧串」，别给它留一个用得上的口子');
        }
    }
    /* 替换型**不许**把自己写成等值锚：斜体/反引号形态由构造器决定，清单里只放函数。 */
    const raw = read('tools/bump-drill-core.mjs');
    assert.ok(!/oldAnchor:\s*['"]/.test(raw), '替换型锚点不得写成字面量（会随抬版漂成 0 命中）');
});

test('v3750 H6. 防冒充：合成段自带显式标注，且真仓永不被它写过', () => {
    const seg = planCarry(carryFiles(), CUR, NEXT).files['ITERATION_LOG.md'];
    assert.ok(seg.includes('【抬版演练合成段】'), '合成段标题必须自曝身份（演练产物冒充发布正文最忌）');
    assert.ok(/## 迭代 \d+ — v[\d.]+ · 【抬版演练合成段】/.test(seg),
        '合成段要接在真段的形态与编号上（否则判据只认得到「有段」，认不出是哪版）');
    assert.ok(!read('ITERATION_LOG.md').includes('【抬版演练合成段】'),
        '真仓的迭代日志里出现了演练合成段 —— 说明有某条路径把演练产物写进了真仓');
});

test('v3750 H7. 驱动器接线：清单读数进报告，且只向镜像写', () => {
    const drv = read('tools/bump-drill.mjs');
    assert.match(drv, /carry_plan:\s*carry/, '清单读数必须随演练一起落盘（否则「充分」只是口头声明）');
    assert.match(drv, /function runCarryPlan\(dir,/, '驱动器必须有清单执行面');
    assert.match(drv, /runCarryPlan\(dir,/, '执行面必须吃镜像路径');
    /* 真仓唯一被写的文件是**报告**（读数，不是产物；且它是「跑一次 --write」之后再跑
     *   不被自己挡住的那个例外）。这份名单必须**恰好**如此 —— 多出任何一项，
     *   都意味着抬版产物有可能落到真仓里，那是本工具最不该有的写法。
     *   注意全量面日志走的是镜像（`path.join(dir, CORPUS_LOG_REL)`），它不该在这张单上。 */
    const rootWrites = (drv.match(/writeFileSync\(path\.join\(ROOT,\s*([A-Z_][A-Z_0-9]*)/g) || [])
        .map((s) => s.slice(s.lastIndexOf(',') + 1).trim());
    assert.deepEqual(rootWrites, ['REPORT_REL'],
        '真仓写入面漂了（实得 ' + rootWrites.join(' | ') + '）—— 产物的落点只能是镜像');
    assert.ok(!/writeFileSync\(path\.join\(dir,\s*CORPUS_LOG_REL/.test(drv)
        || /path\.join\(dir,\s*CORPUS_LOG_REL\)/.test(drv),
        '全量面日志应落镜像（它会长成几十 MB，落真仓就是把演练痕迹留在发布树上）');
    /* 推演只许有一处调用点：散成几处之后，「清单有没有被真执行过」就又要靠人读代码判断。 */
    const calls = (drv.match(/planCarry\(/g) || []).length;
    assert.equal(calls, 1, '驱动器的 planCarry 调用点必须是 1 处（实得 ' + calls + ' 处）——'
        + '多处调用会让「清单已执行」与「清单被跳过了」再次不可分');
    const body = drv.slice(drv.indexOf('function runCarryPlan'), drv.indexOf('/* ── 主流程 ──'));
    assert.match(body, /planCarry\(/, '那一处调用必须在 runCarryPlan 里（它才拿得到镜像路径）');
    assert.match(body, /sufficient/, '执行面必须给出「清单是否充分」这个读数（它是本条的验收原文）');
    assert.match(body, /problems\.length[\s\S]{0,200}executed: false/,
        '清单自身有问题时必须 fail-closed（不跑复跑面）—— 不可信的清单跑出来的绿解释不了任何事');
});
