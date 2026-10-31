/* ============================================================
 * tests/system-v4100.test.mjs — R13-O1 验收套件
 * ------------------------------------------------------------
 * 覆盖：
 *   - A 组：判据不随 App 数漂移（跟随真源 + 真源自身没塌的下限）
 *   - B 组：门接进链（package.json / CONTEXT.md / 逃生口声明）
 *   - C 组：读数台账（真实、可自证、覆盖完整、不判 ok）
 *   - D 组：存量债冻结（逐条可核、只拦新增、到期点名、未执行不透支）
 *   - E 组：负控制（真源码破坏后判据必须转红）
 *
 * 纪律：本套件的每一条都必须能**单点复现**（铁律：36 项做完前不跑全量回归）。
 *
 * 【v4.100.0 本版自己抓到的一处判据缺陷（写在这里防止后来者重犯）】
 *   A1 最初写成「源码里不得出现 `ids.length === <数字>`」，第一次跑就假红 ——
 *   命中的是**注释里的历史说明**（「本行原写死 `ids.length === 83`」）。
 *   教训：文本类判据必须区分「代码」与「注释」，否则要么逼人删掉诚实留档的历史，
 *   要么被迫放宽到连真违法也放过。故本套件统一走 `stripComments()` 后再判。
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const rdJson = (p) => JSON.parse(rd(p));

/** 剥掉 JS 注释（块注释 + 行注释），只留可执行代码。
 *  只做「够用」的剥离：不支持字符串里出现的 `//` 边界情况会被误伤，
 *  因此本函数只用于「判据形态」这类粗判，不用于精确语法分析。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n');
}

const ENUM = 'tests/browser/scenarios/o1-app-enumeration.scen.js';

/* ------------------------------------------------------------
 * A 组：判据不随 App 数漂移
 * ------------------------------------------------------------ */
test('A1: 枚举场景的 enumeration-source 必须跟随真源 APPS.length，不得写死常量', () => {
  const code = stripComments(rd(ENUM));
  assert.ok(
    /ids\.length\s*===\s*APPS\.length/.test(code),
    '判据必须跟随真源 APPS.length（写死数字就会随 App 数漂移）'
  );
  assert.ok(
    !/ids\.length\s*===\s*\d+/.test(code),
    '可执行代码里不得再出现 `ids.length === <数字>` 这种写死形态（注释里的历史说明不算）'
  );
});

test('A2: 判据必须同时守住「真源自身没塌」——APPS_MIN 下限在场且真源长度不低于它', () => {
  const code = stripComments(rd(ENUM));
  const m = code.match(/APPS_MIN\s*=\s*(\d+)/);
  assert.ok(m, '必须有 APPS_MIN 下限常量（只跟随真源不设下限，真源塌成 0 时判据会恒真）');
  const min = Number(m[1]);
  assert.ok(min >= 40 && min <= 200, `APPS_MIN=${min} 不在合理区间（40..200）`);
  assert.ok(
    /ids\.length\s*>=\s*APPS_MIN/.test(code),
    '判据必须把 APPS_MIN 真正用上（只定义不使用等于装饰）'
  );
});

test('A3: 真源 config/apps.js 的 APPS 是数组且长度不低于下限', async () => {
  const mod = await import('../config/apps.js');
  const APPS = mod.APPS || mod.default;
  assert.ok(Array.isArray(APPS), 'config/apps.js 必须导出数组 APPS');
  const min = Number((stripComments(rd(ENUM)).match(/APPS_MIN\s*=\s*(\d+)/) || [])[1]);
  assert.ok(
    APPS.length >= min,
    `真源 APPS.length=${APPS.length} 已低于下限 ${min} ⇒ 真源本身塌了，不是判据问题`
  );
});

/* ------------------------------------------------------------
 * B 组：门接进链
 * ------------------------------------------------------------ */
test('B1: package.json 必须有 browser 键，且 check 链末位是 browser', () => {
  const pkg = rdJson('package.json');
  assert.equal(typeof pkg.scripts.browser, 'string', 'package.json 必须有 scripts.browser');
  assert.ok(/browser-gate-run/.test(pkg.scripts.browser), 'browser 键必须指向包装门 scripts/browser-gate-run.mjs');
  const chain = pkg.scripts.check.split('&&').map((s) => s.trim());
  assert.ok(
    chain[chain.length - 1].includes('browser'),
    `check 链末位必须是 browser（末位失败时前面各道已给出定位），实际末位=${chain[chain.length - 1]}`
  );
  assert.equal(chain.length, 19, `check 链应为十九道，实际 ${chain.length} 道`);
});

test('B2: CONTEXT.md 的门数口径必须与 package.json 的 check 链道数一致', () => {
  const cn = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  const num2cn = (n) => {
    if (n <= 10) return cn[n];
    if (n < 20) return '十' + cn[n - 10];
    const t = Math.floor(n / 10);
    const o = n % 10;
    return cn[t] + '十' + (o ? cn[o] : '');
  };
  const chain = rdJson('package.json').scripts.check.split('&&').map((s) => s.trim());
  const want = num2cn(chain.length) + '道';
  const ctx = rd('CONTEXT.md');
  assert.ok(
    ctx.includes(want + '子门') || ctx.includes(want + '门'),
    `CONTEXT.md 必须写成「${want}」（门数口径要与 package.json 的 ${chain.length} 道一致）`
  );
  assert.ok(/browser/.test(ctx), 'CONTEXT.md 的门清单必须列出 browser');
});

test('B3: 逃生口必须显式声明「未执行」——分支内三行声明，缺一行即算回归', () => {
  const src = rd('scripts/browser-gate-run.mjs');
  assert.ok(/SKIP_BROWSER/.test(src), '必须有 SKIP_BROWSER 逃生口');
  /* ★ 口径：逃生口分支内必须有三行 console 声明，且**第一行**必须明写「未执行」。
   *   首发判据要求「三行都含未执行」，但那会让第三行（「要真跑请执行 npm run browser」）
   *   无处安放 —— 判据比真实文案更严，等于逼人写别扭句子。改成「三行声明 + 首行点明」。 */
  const lines = src.split('\n');
  const st = lines.findIndex((l) => /if \(SKIP\) \{/.test(l));
  const en = lines.findIndex((l, i) => i > st && /^}/.test(l));
  assert.ok(st >= 0 && en > st, '必须能定位逃生口分支');
  const body = lines.slice(st, en + 1);
  const decl = body.filter((l) => /console\.(log|error)/.test(l));
  assert.ok(decl.length >= 3, `逃生口分支内必须打印至少三行声明，实际 ${decl.length} 行`);
  assert.ok(/未执行/.test(body[0] === undefined ? '' : body.filter((l) => /console/.test(l))[0]), '第一行声明必须明写「未执行」');
  assert.ok(
    /不是通过/.test(src),
    '逃生口输出必须写明「不是通过，是跳过」——静默跳过正是本仓反复治的假绿'
  );
});

/* ------------------------------------------------------------
 * C 组：读数台账
 * ------------------------------------------------------------ */
test('C1: 读数台账存在且 schema / 版本 / 浏览器 / 自证字段齐全', () => {
  const d = rdJson('tests/audit/browser_readings.json');
  assert.equal(d.schema, 'browser-readings@1');
  for (const k of ['measured_at', 'version', 'browser', 'total_reads', 'fail_reads', 'per_scene', 'failures', 'honest_boundary']) {
    assert.ok(k in d, `台账缺字段 ${k}`);
  }
  assert.ok(/^4\./.test(d.version), `台账版本号须是本仓版本形态，实际 ${d.version}`);
  assert.ok(/chromium|chrome/i.test(d.browser), `台账必须写明真实浏览器来源，实际 ${d.browser}`);
});

test('C2: 台账覆盖必须完整——磁盘上每个正式场景都被记到，且无虚构场景', () => {
  const d = rdJson('tests/audit/browser_readings.json');
  const onDisk = fs.readdirSync(path.join(ROOT, 'tests/browser/scenarios'))
    .filter((n) => n.endsWith('.scen.js') && !n.startsWith('_')).sort();
  assert.deepEqual(
    d.scene_coverage.missing, [],
    `台账缺场景（「只跑到 4/12」这类半途断档必须被点名）：${d.scene_coverage.missing.join(', ')}`
  );
  assert.deepEqual(d.scene_coverage.extra, [], `台账里有磁盘上不存在的场景：${d.scene_coverage.extra.join(', ')}`);
  assert.equal(d.scene_coverage.complete, true, 'scene_coverage.complete 必须为 true');
  assert.equal(d.scene_coverage.on_disk, onDisk.length);
  assert.equal(d.scene_coverage.measured, onDisk.length);
});

test('C3: 台账读数必须自洽——总数 == 各场景之和，fail 数 == failures 条数，且不低于结构下限', () => {
  const d = rdJson('tests/audit/browser_readings.json');
  const sum = Object.values(d.per_scene).reduce((a, v) => a + v.reads, 0);
  const sumFail = Object.values(d.per_scene).reduce((a, v) => a + v.fail, 0);
  assert.equal(d.total_reads, sum, 'total_reads 必须等于各场景 reads 之和');
  assert.equal(d.fail_reads, sumFail, 'fail_reads 必须等于各场景 fail 之和');
  assert.equal(d.failures.length, d.fail_reads, 'failures 明细条数必须等于 fail_reads');
  assert.ok(d.scenes >= 7, `场景数 ${d.scenes} 低于门的下限 7`);
  assert.equal(d.viewports, 4, `视口必须四档全覆盖，实际 ${d.viewports}`);
  assert.ok(d.min_reads_per_scene >= 2, `每场景读数下限 2，实际最低 ${d.min_reads_per_scene}`);
});

test('C4: 台账工具不得判 ok、不得重算判据（判定权只在 gate.mjs 与场景文件）', () => {
  const src = rd('tools/browser-readings.mjs');
  const code = stripComments(src);
  assert.ok(!/\bassert\b/.test(code), '读数工具不得自带断言');
  /* 它必须明说自己的纪律，否则后来者会顺手往里加判据（注释里也必须写明） */
  assert.ok(/不判 ok|不重算/.test(src), '工具注释必须写明「不判 ok、不重算判据」的纪律');
  assert.ok(
    /未执行.*不落台账|不落台账/.test(src),
    '未执行时不得落台账（写空台账等于制造假证据）'
  );
});

test('C5: 台账口径必须与 gate.mjs 同源——排除 `_` 前缀探针', () => {
  const gate = rd('tests/browser/gate.mjs');
  assert.ok(/startsWith\('_'\)/.test(gate), 'gate.mjs 应排除 `_` 前缀探针场景');
  const tool = stripComments(rd('tools/browser-readings.mjs'));
  assert.ok(
    /startsWith\('_'\)/.test(tool),
    '台账工具的场景清单也必须排除 `_` 前缀，否则会把一次性探针误报成缺失'
  );
});

/* ------------------------------------------------------------
 * D 组：存量债冻结
 * ------------------------------------------------------------ */
test('D1: 冻结账本存在且逐条可核——每条都有场景/视口/读数名/状态', () => {
  const d = rdJson('scripts/browser-known-failures.json');
  assert.equal(d.schema, 'browser-known-failures@1');
  assert.ok(typeof d.expires_at === 'string' && d.expires_at.length > 0, '账本必须有到期版本（不许无限期挂着）');
  const allowed = new Set(['open', 'fixed', 'wontfix']);
  let n = 0;
  for (const [scene, list] of Object.entries(d.scenes)) {
    assert.ok(Array.isArray(list) && list.length > 0, `场景 ${scene} 的条目必须是非空数组`);
    for (const it of list) {
      n += 1;
      assert.ok(it.viewport && /^\d+x\d+$/.test(it.viewport), `${scene} 条目缺合法 viewport`);
      assert.ok(it.name && it.name.length > 0, `${scene} 条目缺读数名`);
      assert.ok(allowed.has(it.status), `${scene}/${it.name} 的 status=${it.status} 不在三档内`);
      if (it.status === 'wontfix') {
        assert.ok(it.reason && it.reason.length > 0, `wontfix 必须写理由（${scene}/${it.name}）`);
      }
    }
  }
  assert.ok(n > 0, '账本不得为空（空账本等于声称零红点）');
});

test('D2: 账本条目必须与真实台账对得上——不许记不存在于读数里的红点', () => {
  const known = rdJson('scripts/browser-known-failures.json');
  const readings = rdJson('tests/audit/browser_readings.json');
  const realKey = new Set(readings.failures.map((f) => `${f.scene}|${f.viewport}|${f.name}`));
  const ghosts = [];
  for (const [scene, list] of Object.entries(known.scenes)) {
    for (const it of list) {
      if (it.status === 'fixed') continue; /* 已修为「曾经红过」，允许留档 */
      const k = `${scene}|${it.viewport}|${it.name}`;
      if (!realKey.has(k)) ghosts.push(k);
    }
  }
  assert.deepEqual(ghosts, [], `账本记了读数里不存在的红点（幽灵条目）：${ghosts.slice(0, 8).join('; ')}`);
});

test('D3: 包装门必须有「只拦新增」与「到期点名」两条判据，且未执行不透支', () => {
  const src = rd('scripts/browser-gate-run.mjs');
  const code = stripComments(src);
  assert.ok(/isKnown|fresh/.test(code), '必须有「账本外新增」的判据');
  assert.ok(/expires_at/.test(code) && /expired/.test(code), '必须有到期点名判据');
  /* 未执行必须原样透传 2，不能被账本盖成 0 */
  assert.ok(
    /code\s*===\s*2/.test(code) && /exit\(2\)/.test(code),
    '未执行/覆盖不足必须原样 exit 2（不许用账本把它们盖成通过）'
  );
  /* 必须打印「已知红 / 新增红」，否则读者会把它读成「通过了」 */
  assert.ok(/已知红/.test(code) && /新增红/.test(code), '报告里必须同时打印「已知红 / 新增红」');
  assert.ok(/不是「浏览器层通过了」|带着已知缺陷在跑/.test(code), '必须明写这是「带着缺陷在跑」而不是通过');
});

test('D4: 冻结账本不得成为「存量免罪」——账本里的红点数必须如实可数', () => {
  const known = rdJson('scripts/browser-known-failures.json');
  const readings = rdJson('tests/audit/browser_readings.json');
  const n = Object.values(known.scenes).reduce((a, v) => a + v.length, 0);
  assert.equal(known.total, readings.fail_reads, `账本 total=${known.total} 必须等于当期台账 fail_reads=${readings.fail_reads}`);
  assert.ok(n <= known.total, '去重后条目数不得超过总条数');
});

/* ------------------------------------------------------------
 * E 组：负控制（真源码破坏 → 判据必须转红）
 * ------------------------------------------------------------ */
test('E1: 负控制 — 把代码里的判据改回写死常量，A1 必须转红', () => {
  /* ★ 首发版这条负控制自己就是假绿：String.replace 不带 g 只换**第一处**，
   *   而第一处恰好是注释里的历史说明（「本行原写死 ids.length === 83」一带），
   *   于是「破坏」落在注释上、真判据毫发无损，双向断言却都在说谎。
   *   修法不是加 g（那会连同注释一起改写，等于把留档的历史抹掉），
   *   而是**只在代码区破坏**：先剥注释，在剥好的代码上换，再回判。 */
  const src = rd(ENUM);
  const codeOnly = stripComments(src);
  const brokenCode = codeOnly.replace(/ids\.length\s*===\s*APPS\.length/, 'ids.length === 89');
  assert.notEqual(brokenCode, codeOnly, '破坏锚点必须命中代码区（命中注疏等于没破坏）');
  const followSource = /ids\.length\s*===\s*APPS\.length/.test(brokenCode);
  const hardcoded = /ids\.length\s*===\s*\d+/.test(brokenCode);
  assert.equal(followSource, false, '破坏后不再跟随真源 ⇒ A1 的前半判据判红');
  assert.equal(hardcoded, true, '破坏后出现写死形态 ⇒ A1 的后半判据判红');
  /* 并证明**原文件**在同样判据下是绿的（否则这条负控制没有对照组） */
  assert.ok(/ids\.length\s*===\s*APPS\.length/.test(stripComments(src)));
});

test('E2: 负控制 — APPS_MIN 只定义不使用（装饰形态）必须被判红', () => {
  const src = rd(ENUM);
  const broken = src.replace(/ids\.length\s*>=\s*APPS_MIN/g, 'true');
  assert.notEqual(broken, src, '破坏锚点必须命中');
  assert.equal(
    /ids\.length\s*>=\s*APPS_MIN/.test(stripComments(broken)), false,
    '破坏后 APPS_MIN 不再被使用 ⇒ A2 的「必须真用上」判据在这里判红'
  );
});

test('E3: 负控制 — 台账场景清单不排除 `_` 前缀，C5 必须判红', () => {
  const tool = rd('tools/browser-readings.mjs');
  const broken = tool.replace(
    /n\.endsWith\('\.scen\.js'\)\s*&&\s*!n\.startsWith\('_'\)/,
    "n.endsWith('.scen.js')"
  );
  assert.notEqual(broken, tool, '破坏锚点必须命中（台账工具的场景筛选）');
  assert.equal(
    /startsWith\('_'\)/.test(stripComments(broken)), false,
    '破坏后排除规则消失 ⇒ C5 在这里判红'
  );
  /* 并证明这条排除规则在真磁盘上确实有意义（存在 `_` 前缀探针才会被影响） */
  const dir = path.join(ROOT, 'tests/browser/scenarios');
  const all = fs.readdirSync(dir).filter((n) => n.endsWith('.scen.js'));
  const formal = all.filter((n) => !n.startsWith('_'));
  assert.ok(all.length > formal.length, '磁盘上应存在 `_` 前缀探针，负控制才有意义');
});

test('E4: 负控制 — 逃生口少打一行「未执行」，B3 必须判红', () => {
  /* ★ 判定面必须限定在**逃生口分支内部**：文件里其它位置（如证据截断守卫的
   *   「未执行 / 证据不全 ≠ 通过」）也含「未执行」二字，若整文件数行，
   *   删掉逃生口一行后总数仍够三行 ⇒ 负控制假绿（本版实测踩过）。 */
  const src = rd('scripts/browser-gate-run.mjs');
  const lines = src.split('\n');
  const start = lines.findIndex((l) => /if \(SKIP\) \{/.test(l));
  assert.ok(start >= 0, '必须能定位逃生口分支起点（if (SKIP) {）');
  const end = lines.findIndex((l, i) => i > start && /^}/.test(l));
  assert.ok(end > start, '必须能定位逃生口分支终点');
  const inGuard = (l) => /console\.(log|error)/.test(l);
  const before = lines.slice(start, end + 1).filter(inGuard);
  assert.ok(before.length >= 3, `逃生口分支内必须至少三行「未执行」声明，实际 ${before.length}`);
  /* 删掉分支内第一条声明，分支内计数必须掉到 3 以下 ⇒ B3 在同一判定面上判红 */
  let removed = false;
  const broken = lines.filter((l, i) => {
    if (!removed && i > start && i <= end && inGuard(l)) { removed = true; return false; }
    return true;
  });
  assert.ok(removed, '必须真删掉一行（否则负控制没有破坏）');
  const s2 = broken.findIndex((l) => /if \(SKIP\) \{/.test(l));
  const e2 = broken.findIndex((l, i) => i > s2 && /^}/.test(l));
  const after = broken.slice(s2, e2 + 1).filter(inGuard);
  assert.ok(after.length < 3, `删掉一行后分支内声明应少于三行，实际 ${after.length} ⇒ B3 判红`);
});

test('D5: 包装门必须把 gate 输出落文件而不是靠管道收集（本版实测：管道只收到 27/138 条）', () => {
  /* ★ 这条是本版**自己抓到的第二处缺陷**的判据：
   *   首发版用 stdio pipe 边跑边收，实测只解析到 27 条 FAIL（真实 138 条）、
   *   连 gate 自己的摘要行都没拿到，然后安静地算出「新增红 0 条」并 exit 0。
   *   **丢数据不算最坏，丢得静默才是** —— 一份被截断的证据被读成了通过。
   */
  const src = rd('scripts/browser-gate-run.mjs');
  const code = stripComments(src);
  assert.ok(/openSync\(LOG_PATH/.test(code), 'gate 输出必须落文件（落盘原子、可事后复核），不靠管道累积');
  assert.ok(/readFileSync\(LOG_PATH/.test(code), '包装层必须从落盘文件读回完整输出');
  assert.ok(!/stdio: \['ignore', 'pipe', 'pipe'\]/.test(code), '不得再用 ignore+pipe+pipe 边跑边收（正是它会静默截断）');
});

test('D6: 证据截断守卫——读数行远少于账本存量时必须拒判，不得读成「红点变少」', () => {
  const code = stripComments(rd('scripts/browser-gate-run.mjs'));
  assert.ok(/readLineCount/.test(code), '必须有读数行计数');
  assert.ok(
    /readLineCount < knownTotal \/ 2|knownTotal \/ 2/.test(code),
    '必须有「读数行 < 账本存量一半 ⇒ 证据截断」的守卫'
  );
  assert.ok(/证据疑似被截断，拒判|证据全无，拒判/.test(code), '拒判必须明说原因（不得静默 exit）');
  assert.ok(
    /readLineCount === 0[\s\S]{0,200}?exit\(2\)/.test(code),
    '一条读数都没解析到时必须 exit 2，不得当成零红点'
  );
});

test('E5: 负控制 — 账本读不到时包装门必须拒判，不得默认放行', () => {
  const code = stripComments(rd('scripts/browser-gate-run.mjs'));
  assert.ok(/readKnown/.test(code), '必须有读账本的入口');
  assert.ok(
    /读不到存量红点账本[\s\S]{0,400}?exit\(1\)/.test(code),
    '读不到账本必须 exit 1 拒判（默认放行等于把「说不清基线」当成「零红点」）'
  );
});

/* ------------------------------------------------------------
 * D7：flaky 分档必须收敛（本版实测逼出来的第二道口子）
 * ------------------------------------------------------------
 * 背景：`icons-paged` 与 `o6m-background-throttle` 两条读数的失败条件是
 *   **视口相关竞态**，下次真跑可能换一组视口红。不动账本则门每次报「新增红」，
 *   人只能反复 --update-known —— 那是噪声门；可一放宽，就等于在说
 *   「这两条读数从此不再看守」。
 *
 * 所以采取三分口径，本组逐条钉死：
 *   ① 放宽面只对**账本里显式写了 flaky: true** 的读数生效（没写的一律最严）；
 *   ② 精确档必须先判（三格全等），fllaky 档只能作为**未命中后的兜底**；
 *   ③ 报告必须**把 flaky 档条数单独打出来**——否则「已知红 133」会让人
 *     误以为全量都是穩定已知缺陷，而实际有一半是「尚未定相」。
 * 没有这三条，flaky 分档本身就是下一个静默漏洞。
 */
function flakyTier(code) {
  const exactIdx = code.indexOf('if (exact) return true;');
  const flakyIdx = code.indexOf('flakyKey.has(f.scene');
  return {
    hasSet: /flakyKey\.add\(scene \+ '\|' \+ x\.name\)/.test(code),
    gated: /x\.flaky && x\.status !== 'fixed'/.test(code),
    exactFirst: exactIdx >= 0 && flakyIdx > exactIdx,
    reported: /其中 flaky 档 \$\{flakyHit\} 条/.test(code),
  };
}

test('D7: flaky 分档必须收敛——只对账本显式标记者生效、精确档在先、报告单独计数', () => {
  const code = stripComments(rd('scripts/browser-gate-run.mjs'));
  const t = flakyTier(code);
  assert.equal(t.hasSet, true, '必须有 flaky 名单集合（放宽面要能被计数与枚举）');
  assert.equal(t.gated, true, 'flaky 名单只许收录显式 flaky:true 且未 fixed 的条目');
  assert.equal(t.exactFirst, true, '精确档（场景+视口+读数名）必须先判，flaky 档只能兜底');
  assert.equal(t.reported, true, '报告必须单独打印 flaky 档条数（不得并进「已知红」一笔带过）');
});

test('D7b: flaky 声明必须可核——账本里每条 flaky 都要有 why，且不得出现“未标 flaky 却在名单里”', () => {
  const kb = rdJson('scripts/browser-known-failures.json');
  const noted = new Set((kb.flaky_reads || []).map((x) => x.scene + '|' + x.name));
  assert.ok(noted.size > 0, '账本必须留下 flaky_reads 说明（不得只在条目里写个 true 了事）');
  for (const [scene, list] of Object.entries(kb.scenes || {})) {
    for (const x of list) {
      if (x.flaky) {
        assert.ok(noted.has(scene + '|' + x.name), `flaky 条目 ${scene} / ${x.name} 必须有 why 说明`);
      }
    }
  }
  /* 反向：说明里点名的读数必须在账本内真的被标了 flaky，否则说明本身就是幽灵 */
  for (const k of noted) {
    const [scene, name] = k.split('|');
    const list = (kb.scenes || {})[scene] || [];
    assert.ok(list.some((x) => x.name === name && x.flaky), `flaky_reads 里的 ${k} 必须在账本内被标记`);
  }
  /* 反向二：flaky 不得成为“免罪牌”——标了 flaky 的条目仍然必须带 status */
  for (const list of Object.values(kb.scenes || {})) {
    for (const x of list) assert.ok(['open', 'fixed', 'wontfix'].includes(x.status), `${x.name} 缺 status`);
  }
});

test('E6: 负控制 — 把 flaky 分档放宽成“两格全放行”，D7 必须转红', () => {
  /* 两种典型的错误放宽都必须被拓住：
   *   ① 名单不再要求 flaky:true（所有读数都能进 flaky 档）；
   *   ② 精确档被删（先按两格放行，视口维度彻底失守）。
   * 本测试**真的在源码上做破坏，再用同一套判据回判**。 */
  const src = rd('scripts/browser-gate-run.mjs');
  const code = stripComments(src);
  assert.equal(flakyTier(code).gated, true, '对照组：原文件必须是绿的');

  const broken1 = code.replace(/x\.flaky && x\.status !== 'fixed'/, 'true');
  assert.notEqual(broken1, code, '破坏锛点①必须命中代码区');
  assert.equal(flakyTier(broken1).gated, false, '名单不再要求 flaky:true ⇒ D7 判红');

  const broken2 = code.replace(
    /if \(exact\) return true;\s*\n\s*return flakyKey\.has\(f\.scene \+ '\|' \+ f\.name\);/,
    "return list.some((x) => x.name === f.name);"
  );
  assert.notEqual(broken2, code, '破坏锛点②必须命中代码区');
  assert.equal(flakyTier(broken2).exactFirst, false, '精确档被删、统一两格放行 ⇒ D7 判红');
});
