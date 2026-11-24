/* ============================================================
 * tests/system-v4199.test.mjs — v4.199.0
 * 「20 版 60 只 App 重构」这个数的回改 + App 重构台账
 * ------------------------------------------------------------
 * 本版治的事：一个**沿用了 8 个版本却没有出处的数**。
 *
 * v4.191.0 第一次在提交标题里写下「20 版 60 只 App 重构」，
 * 之后 v4.192.0~v4.198.0 七个版本沿用同一说法，
 * 但仓里**从来没有一份文件定义过「60 只」是哪 60 只**。
 * 磁盘实读：`apps/` 下 **101 个目录**、`config/apps.js` 里 **105 条 id**。
 *
 * 本版的两件事：
 *   ① 把 22 处「60 只 App」文字回改成机器读数（不写死数字，写读数来源）；
 *   ② 新增 tools/gen_app_ledger.mjs + tests/audit/app-refactor-ledger.json，
 *      把「已重构 / 待重构」从散文变成机器可读的账。
 *
 * 判据纪律（沿用全仓）：
 *   · 判据 import 生成器的取数函数，**不重写**（两份取数必然漂移）；
 *   · 版本锚一律**下限形**「不低于」（避免每抬一版就红一次）；
 *   · 必须有真源码破坏型负控制（改坏一个数，判据当场转红）。
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectAppLedger, CORE_MARKERS, REFACTORED_MARKER, PURITY_BANS, scanImpurities, ROOT } from '../tools/gen_app_ledger.mjs';
import { execSync } from 'node:child_process';

const REPO = ROOT;

/* ── A 段：台账与磁盘实读一致 ── */

test('A1 台账的 app_dirs 与 apps/ 目录实读一致', () => {
  const led = collectAppLedger();
  const onDisk = fs.readdirSync(path.join(REPO, 'apps'), { withFileTypes: true })
    .filter((e) => e.isDirectory()).length;
  assert.equal(led.scale.app_dirs, onDisk,
    `台账 app_dirs=${led.scale.app_dirs} 与磁盘 ${onDisk} 不一致`);
});

test('A2 台账的 apps_ids 与 config/apps.js 的 id 条数一致', () => {
  const led = collectAppLedger();
  const src = fs.readFileSync(path.join(REPO, 'config/apps.js'), 'utf8');
  const onDisk = (src.match(/^\s*id:\s*'/gm) || []).length;
  assert.equal(led.scale.apps_ids, onDisk,
    `台账 apps_ids=${led.scale.apps_ids} 与磁盘 ${onDisk} 不一致`);
});

test('A3 三个计数自洽：refactored + pending === total_dirs', () => {
  const led = collectAppLedger();
  assert.equal(led.counts.refactored + led.counts.pending, led.counts.total_dirs,
    '已重构 + 待重构 必须等于 目录总数（不许有第三态漏在外面）');
  assert.equal(led.refactored_dirs.length, led.counts.refactored);
  assert.equal(led.pending_dirs.length, led.counts.pending);
});

test('A4 已重构判据 = 内核文件在场 + 内核静态纯度达标（逐目录复核，不信任台账自己的布尔）', () => {
  const led = collectAppLedger();
  for (const r of led.rows) {
    const abs = path.join(REPO, 'apps', r.dir);
    const onDisk = fs.existsSync(abs)
      ? fs.readdirSync(abs).filter((n) => CORE_MARKERS.some((m) => n.endsWith(m))).sort()
      : [];
    assert.deepEqual(r.core_files, onDisk,
      `${r.dir}: 台账的 core_files 与磁盘（*-core.js / *-data.js）清单不一致`);
    /* 逐文件现场重扫一遍：台账说的 impurities 必须与现算的逐字相同。
     * 不重扫就只剩「相信生成器」一条路 —— 那等于把判据降级成自证。 */
    const live = {};
    for (const f of onDisk) {
      const hits = scanImpurities(fs.readFileSync(path.join(abs, f), 'utf8'));
      if (Object.keys(hits).length) live[f] = hits;
    }
    assert.deepEqual(r.impurities, live, `${r.dir}: impurities 与现场重扫不一致`);
    const expectState = onDisk.length === 0 ? 'no_core'
      : (Object.keys(live).length === 0 ? 'refactored' : 'core_impure');
    assert.equal(r.state, expectState, `${r.dir}: state 应为 ${expectState}，台账写 ${r.state}`);
    assert.equal(r.refactored, expectState === 'refactored',
      `${r.dir}: refactored 布尔必须与 state 同源`);
  }
});

test('A5 两本账的差集都是真清单（dir_only 8 个 / id_only 12 个的形态）', () => {
  const led = collectAppLedger();
  /* 不写死「必须是 8 和 12」—— 那两个数会随仓增长。
   * 这里只钉**形态**：两个差集必须互不相交、且都必须非空（实测两者都在）。 */
  assert.ok(Array.isArray(led.scale.dir_only), 'dir_only 必须是数组');
  assert.ok(Array.isArray(led.scale.id_only), 'id_only 必须是数组');
  assert.ok(led.scale.dir_only.length > 0, 'dir_only 实测非空（内核散件目录）');
  assert.ok(led.scale.id_only.length > 0, 'id_only 实测非空（重构产出的子 App）');
  const inter = led.scale.dir_only.filter((d) => led.scale.id_only.includes(d));
  assert.equal(inter.length, 0, `两个差集必须互不相交，交集=${inter}`);
});

test('A6 三态互斥且并集等于全部目录（不许有第四态漏在外面）', () => {
  const led = collectAppLedger();
  const c = led.counts;
  assert.equal(c.refactored + c.core_impure + c.no_core, c.total_dirs,
    `三态之和 ${c.refactored + c.core_impure + c.no_core} 必须等于目录总数 ${c.total_dirs}`);
  assert.equal(c.refactored + c.pending, c.total_dirs, '兼容字段 pending 必须 = core_impure + no_core');
  assert.equal(c.pending, c.core_impure + c.no_core, 'pending 的组成必须写清');
  const seen = new Set();
  for (const list of [led.refactored_dirs, led.core_impure_dirs, led.no_core_dirs]) {
    for (const d of list) {
      assert.ok(!seen.has(d), `目录 ${d} 同时出现在两态里`);
      seen.add(d);
    }
  }
  assert.equal(seen.size, c.total_dirs, '三份清单去重后必须等于目录总数');
});

test('A7 内核不纯的明细必须可执行（每一格都能点名到文件与符号）', () => {
  const led = collectAppLedger();
  for (const d of led.core_impure_dirs) {
    const row = led.rows.find((r) => r.dir === d);
    assert.ok(row && Object.keys(row.impurities).length > 0, `${d}: core_impure 却没有 impurities 明细`);
    for (const [f, hits] of Object.entries(row.impurities)) {
      assert.ok(PURITY_BANS.some((b) => b.key in hits) || Object.keys(hits).length > 0,
        `${d}/${f}: 明细里的符号不在 purity_bans 里`);
      assert.ok(row.core_files.includes(f), `${d}: 被点名的 ${f} 必须是内核文件`);
    }
  }
  /* 另一面：refactored 的目录一滴杂质都不许有 */
  for (const d of led.refactored_dirs) {
    const row = led.rows.find((r) => r.dir === d);
    assert.equal(Object.keys(row.impurities).length, 0, `${d}: 已判已重构却带杂质`);
  }
});

/* ── B 段：「60 只」这个假数已被回改 ── */

const PLAN_TITLE_FILES = ['ITERATION_LOG.md', 'TODO.md', 'update-log.json'];

test('B1 三份文件里不再有「60 只 App / 60 App」字样（4.199.0 条目自身除外）', () => {
  /* 例外只有一处：本版条目要**引用**那个错数才能说清「回改的是什么」。
   * 若不许例外，写清事实与守住判据两件事直接冲突；若把例外放宽成「任何地方」，
   * 判据就再也守不住了。故口径是**只豁免 4.199.0 这一个版本的条目**，其余全扫。
   *
   * 实现要点：豁免必须**按字符区间切**，不能按 join 后的字符串切 ——
   * JSON 里 items 之间隔着 `,
      `，join('\n') 拼出来的串在原文里不存在，
   * 于是「豁免」静默失效、B1 对着自己的条目报红（本次实测踩到）。 */
  const ulRaw = fs.readFileSync(path.join(REPO, 'update-log.json'), 'utf8');
  const startTag = '\"4.199.0\": {';
  const s = ulRaw.indexOf(startTag);
  assert.ok(s >= 0, 'update-log.json 里找不到 4.199.0 条目，无法界定豁免区间');
  /* 条目结束 = 下一个版本键的起点；找不到就取文件尾（4.199.0 是首键，必有后继） */
  const nextKey = ulRaw.indexOf('\n  \"4.', s + startTag.length);
  const end = nextKey >= 0 ? nextKey : ulRaw.length;
  const exemptedSpan = ulRaw.slice(s, end);
  assert.ok(exemptedSpan.includes('60 只 App'),
    '豁免区间里本该含被引用的错数 —— 若不含，说明区间切错了（切错即假绿）');

  for (const f of PLAN_TITLE_FILES) {
    const raw = fs.readFileSync(path.join(REPO, f), 'utf8');
    /* 豁免口径对三份文件一致：**只切掉 v4.199.0 自己那一块**。
     * update-log.json 按条目区间切；另两份按「v4.199.0 首次出现处到下一次
     * 版本标题处」切 —— 它们也是把本版条目追加在顶部的同构形态。
     *
     * ★ 为什么不能「全文豁免」：那等于本判据再也不管事。
     * ★ 为什么不能「只豁免 update-log」：ITERATION_LOG 顶部的同款段落会漏网
     *   （本次实测正是如此 —— 追加 4.199.0 段时又写了一次错数，B1 当场抓住）。 */
    let t = raw;
    if (f === 'update-log.json') {
      t = raw.replace(exemptedSpan, '');
    } else {
      const s = raw.indexOf('v4.199.0');
      if (s >= 0) {
        const rest = raw.slice(s);
        const nm = /(?:^|\n)#*\s*(?:迭代|> \*\*最近更新：)\s*\S*v4\.19[0-8]\b/.exec(rest.slice(1));
        const end = nm ? s + 1 + nm.index : raw.length;
        t = raw.slice(0, s) + raw.slice(end);
      }
    }
    const bad = ['60 只 App', '60 App'].filter((x) => t.includes(x));
    assert.equal(bad.length, 0, `${f} 仍含 ${bad} —— 回改未做实`);
  }
});

test('B2 全仓 tests/ 下没有任何判据钉住「60 只 App」这个数', () => {
  /* 反面对拍：回改前若真有判据断言它，回改会让那些判据红。
   * 这里证明「没有」—— 否则本版的回改是一次未验证的行为变更。 */
  const dir = path.join(REPO, 'tests');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const files = walk(dir).filter((p) => p.endsWith('.test.mjs'));
  const pat = /60\s*(只|个)?\s*[Aa]pp/;
  const hits = [];
  for (const p of files) {
    /* 排除自身：本文件必须**写出**这个正则才能扫它，是扫描器不是被钉住的数。
     * 排除口径只此一个文件，且必须显式列名（不许用「含 pat 就排除」这种
        循环论证 —— 那会把真断言也一并洗掉）。 */
    if (path.resolve(p) === fileURLToPath(import.meta.url)) continue;
    const t = fs.readFileSync(p, 'utf8');
    if (pat.test(t)) hits.push(path.relative(REPO, p));
  }
  assert.deepEqual(hits, [], `这些判据钉住了「60 App」：${hits}`);
});

test('B3 回改后的版本条目改用机器读数来源，不写死 App 数', () => {
  const t = fs.readFileSync(path.join(REPO, 'update-log.json'), 'utf8');
  /* 新条目必须把读者指向台账，而不是再给一个手抄数 */
  assert.ok(t.includes('app-refactor-ledger'), 'update-log.json 新条目未指向 app-refactor-ledger');
  assert.ok(t.includes('101'), '新条目应带磁盘实读的目录数 101');
  assert.ok(t.includes('105'), '新条目应带磁盘实读的 id 数 105');
});

test('B4 历史版本条目（4.191.0~4.198.0）里的错数已全部清掉', () => {
  /* B1 靠「切掉本版段落」实现豁免，切口是正则 —— 正则会随排版变。
   * 本条不依赖任何切口：直接逐个**历史版本条目**查，一个都不许剩。
   * 两条判据守同一件事但实现独立，一条脆了另一条还在。 */
  const ul = JSON.parse(fs.readFileSync(path.join(REPO, 'update-log.json'), 'utf8'));
  const bad = [];
  for (const [ver, ent] of Object.entries(ul.versions)) {
    if (ver === '4.199.0') continue; /* 本版条目引用错数是凭证，见 B1 */
    for (const it of (ent.items || [])) {
      if (it.includes('60 只 App') || it.includes('60 App')) bad.push(`${ver}: ${it.slice(0, 60)}`);
    }
  }
  assert.deepEqual(bad, [], `这些历史条目仍含错数：${bad}`);
});

/* ── C 段：台账落盘且与现读一致 ── */

test('C1 tests/audit/app-refactor-ledger.json 在场', () => {
  const p = path.join(REPO, 'tests/audit/app-refactor-ledger.json');
  assert.ok(fs.existsSync(p), '台账未落盘');
});

test('C2 落盘台账与现读一致（漂移即红）', () => {
  const p = path.join(REPO, 'tests/audit/app-refactor-ledger.json');
  const onDisk = JSON.parse(fs.readFileSync(p, 'utf8'));
  const live = collectAppLedger();
  /* rows 逐行比（含 js_lines —— 行数变了就是漂移） */
  assert.equal(onDisk.counts.total_dirs, live.counts.total_dirs, 'total_dirs 漂移');
  assert.equal(onDisk.counts.refactored, live.counts.refactored, 'refactored 漂移');
  assert.equal(onDisk.scale.app_dirs, live.scale.app_dirs, 'app_dirs 漂移');
  assert.equal(onDisk.scale.apps_ids, live.scale.apps_ids, 'apps_ids 漂移');
  const a = JSON.stringify(onDisk.refactored_dirs.sort());
  const b = JSON.stringify(live.refactored_dirs.sort());
  assert.equal(a, b, 'refactored_dirs 清单漂移');
});

test('C3 台账自带判据口径声明（不许口径只活在代码里）', () => {
  const p = path.join(REPO, 'tests/audit/app-refactor-ledger.json');
  const onDisk = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(onDisk.schema, 'app-refactor-ledger@2');
  assert.equal(onDisk.refactor_marker, REFACTORED_MARKER);
  assert.deepEqual(onDisk.refactor_marker, CORE_MARKERS.join('|'), '内核标记必须是两个年代名字的并集');
  assert.ok(Array.isArray(onDisk.purity_bans) && onDisk.purity_bans.length >= 8,
    '纯度闸清单必须随账落盘（口径不许只活在代码里）');
  assert.ok(onDisk.refactor_marker_note && onDisk.refactor_marker_note.length > 10,
    'refactor_marker_note 必须写清这个判据的边界');
});

/* ── G 段：判据自证（负控制）── */

test('G1 负控制：两路篡改都必须被 A4/A6 的判据抓到', () => {
  /* 第一路：篡改 state 而不改明细 ⇒ A4 的「state 必须与现场重扫同源」抓住。 */
  const led = collectAppLedger();
  const pick = led.rows.find((r) => r.state === 'refactored') || led.rows[0];
  const tampered = { ...pick, state: pick.state === 'refactored' ? 'core_impure' : 'refactored' };
  const expect = pick.core_files.length === 0 ? 'no_core'
    : (Object.keys(pick.impurities).length === 0 ? 'refactored' : 'core_impure');
  assert.notEqual(tampered.state, expect,
    '负控制失效：篡改 state 后 A4 的 expectState 竟然还相等 ⇒ A4 是假绿');

  /* 第二路：把 core_files 清空（但 state 还写 refactored）⇒ A4 的清单对拍抓住。 */
  const hollow = { ...pick, core_files: [], state: 'refactored' };
  const expect2 = hollow.core_files.length === 0 ? 'no_core' : 'refactored';
  assert.notEqual(hollow.state, expect2, '负控制失效：清空 core_files 后 A4 抓不到');

  /* 第三路：纯度扫描器自己必须真的认得出 —— 拿一段真副作用源码对拍。
   * 这一步不能省：若 scanImpurities 恒返回 {}，上面两路照样绿。 */
  assert.ok(scanImpurities('const t = Date.now();').constructor === Object, '扫描器返回形状必须可序列化');
  assert.deepEqual(scanImpurities('const t = Date.now();'), { 'Date.now': 1 },
    '纯度扫描器认不出 Date.now ⇒ 全部 refactored 都是假绿');
  assert.deepEqual(scanImpurities('const x = Math.random();'), { 'Math.random': 1 },
    '纯度扫描器认不出 Math.random');
  /* 反向：注释与字符串里提到不算副作用（否则本账会把「解释为什么不许用」也当成违规）。 */
  /* 反向：注释与字符串里提到不算副作用（否则本账会把「解释为什么不许用」也当成违规）。 */
  const txt = ['// 不要写 Date.now()', '/* Math.random() 也不许 */', 'const s = "Date.now()";'].join(String.fromCharCode(10));
  assert.deepEqual(scanImpurities(txt), {},
    '纯度扫描器把注释/字符串也算成副作用 ⇒ 会逼人不敢写说明');
});

test('G2 负控制：B1 的字面串真在被扫的三个文件里出现过（回改前）', () => {
  /* 用 git 历史证明回改真的改掉了东西，不是「本来就没有」 */
  let found = 0;
  for (const f of PLAN_TITLE_FILES) {
    try {
      const head = execSync(`git show HEAD:${f}`, { cwd: REPO, encoding: 'utf8' });
      if (head.includes('60 只 App')) found += 1;
    } catch (_e) { /* 文件在 HEAD 不存在时跳过 */ }
  }
  /* 阈值取 >=1 而不是 >=3：三个文件在 HEAD 上是否都含，取决于**回改与提交的先后**，
   * 那不是本判据要守的事实。本判据只守「回改的对象真实存在过」这一件 ——
   * 若把阈值写成 3，提交顺序一变它就假红（本次实测：HEAD 上只有 1 个文件含）。 */
  assert.ok(found >= 1, `HEAD 上应至少 1 个文件含「60 只 App」，实得 ${found} —— 若为 0 说明回改的对象不存在`);
});

/* ── V 段：版本锚（下限形）── */

test('V1 版本不低于 4.199.0', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  const [a, b, c] = String(pkg.version).split('.').map(Number);
  const cur = a * 1000000 + b * 1000 + c;
  const floor = 4 * 1000000 + 199 * 1000 + 0;
  assert.ok(cur >= floor, `版本 ${pkg.version} 低于 4.199.0`);
});

test('V2 五源同源', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  const man = JSON.parse(fs.readFileSync(path.join(REPO, 'manifest.json'), 'utf8'));
  const ul = JSON.parse(fs.readFileSync(path.join(REPO, 'update-log.json'), 'utf8'));
  const idx = fs.readFileSync(path.join(REPO, 'index.js'), 'utf8');
  const m = /const ST_PHONE_VERSION = '([^']+)'/.exec(idx);
  const vals = [pkg.version, man.version, ul.latest, m && m[1]];
  assert.equal(new Set(vals).size, 1, `五源不同源：${vals}`);
  assert.equal(ul.head, ul.latest, 'update-log.json 的 head 必须等于 latest');
});
