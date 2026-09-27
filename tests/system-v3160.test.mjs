// tests/system-v3160.test.mjs — 撩语 v9.4.1 双人身体互动增量 + 管线缺陷修复 + 新增金手指 ch166 [v3.16.0]
//
//   本版做两件事，都已经取证：
//     ① 把源世界书从 v9.2.7（673 条 / 713353 字）换到 v9.4.1（706 条 / 735557 字）。
//        逐前缀 diff 的结论：唯一增量是 DTX_BODY 族 33 条 / 22522 字
//        （31 个 affordance 子条 + DTX_BODY_CORE_V941 核心 + DTX_BODY_SOURCE_ARCHIVE_V941 源档），
//        其余 673 条全是标点与措辞微调（无一处内容删减）。
//     ② 新增外挂「位移」为 ch166。
//
//   ★ 为什么本版先要修管线：旧 tools/gen-dirtytalk.py 的
//     「if not prefix or MECH_RE.match(prefix): skipped += 1; continue」把 DTX_ 前缀
//     **整族**当机制条丢掉 —— 按今天的管线重跑 v9.4.1，**全部增量会静默蒸发**
//     （skipped 计数涨、三件套字节不变、不报错）。同一条老的判定顺序还藏着第二处：
//     语料前缀 DTX_FRESH_ARCHIVE_FULL（3308 字源档案）同时长得像机制条，
//     自 v9.2.7 起它就一直被丢弃，而语料档里一个字都读不到。
//     两处都改了，并加了「源里出现过的每个语料前缀都必须真的进档」的拒判自证。
//
//   覆盖：
//     A 管线面（白名单 / 语料先行 / 归并位 / 自证存在）
//     B 数据面（三件套同源、body 类就位、语料档含两条 DTX 源档）
//     C 增量面（33 条全部落地，逐条点名）
//     D 金手指面（ch166 同源 / 旧 165 包逐字未变 / id 稳定铁律）
//     E 负控制（真源码破坏 → 同一份真判据必须转红；含阳性对照自证）
//     F 版本锚（下限形）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const GEN = read('tools/gen-dirtytalk.py');
const APPEND = read('scripts/append-cheat.mjs');
const GEN_CHEATS = read('scripts/gen-cheats.mjs');
const SRC_V941 = '.sourcematerial/Adult_Romance_DirtyTalk_WorldInfo_v941.json';

const { dirtyTalkModules } = await import('../data/dirtytalk.js');
const idxMod = await import('../data/dirtytalk-index.js');
const { dirtyTalkIndex, DT_CAT_ORDER, DT_CAT_LABEL, DT_STYLES } = idxMod;
const { dirtyTalkCorpus } = await import('../data/dirtytalk-corpus.js');
const { cheatPacks } = await import('../data/cheats.js');
const { cheatIndex } = await import('../data/cheat-index.js');

const md5 = (s) => crypto.createHash('md5').update(String(s), 'utf8').digest('hex');

/* ══════════ 同一份判据（原件与破坏副本上跑的是它们） ══════════ */

/** J1：管线产物是否把 DTX_BODY 族落地（看三件套里有没有 body 类与该族条目 + 两条源档）。 */
function pipelineJudge(outDir) {
  try {
    const idxTxt = fs.readFileSync(path.join(outDir, 'data/dirtytalk-index.js'), 'utf8');
    const fullTxt = fs.readFileSync(path.join(outDir, 'data/dirtytalk.js'), 'utf8');
    const cor = fs.readFileSync(path.join(outDir, 'data/dirtytalk-corpus.js'), 'utf8');
    if (!idxTxt.includes('"cat":"body"')) return false;
    if (!/DT_CAT_ORDER = \["body"/.test(idxTxt)) return false;
    for (const name of ['双人身体互动核心', '个体身体差异与状态差异', '关系心理材料的剧情条件档案']) {
      if (!idxTxt.includes(name)) return false;
      if (!fullTxt.includes(name)) return false;
    }
    if (!/DTX641_DYADIC_EMBODIMENT_ENGINE/.test(fullTxt)) return false;
    if (!cor.includes('DTX_FRESH_ARCHIVE_FULL')) return false;
    if (!cor.includes('DTX_BODY_SOURCE_ARCHIVE_V941')) return false;
    return true;
  } catch (_e) { return false; }
}

/** J2：当前金手指库相对 v3.15.0 冻结台账是否「只多了一条、且旧的逐字未变」。 */
function appendJudge(fullArr, idxArr, ledger) {
  try {
    if (fullArr.length !== ledger.count + 1) return false;
    if (idxArr.length !== fullArr.length) return false;
    for (const row of ledger.packs) {
      const p = fullArr.find((x) => x.id === row.id);
      if (!p) return false;
      if (p.name !== row.name || p.quality !== row.quality || p.chars !== row.chars) return false;
      if (String(p.sub) !== String(row.sub) || p.type !== row.type || p.desc !== row.desc) return false;
      if (md5(p.content) !== row.contentMd5) return false;
    }
    const last = fullArr[fullArr.length - 1];
    if (last.id !== 'ch166') return false;
    if (last.chars !== last.content.length) return false;
    for (const r of idxArr) {
      const p = fullArr.find((x) => x.id === r.id);
      if (!p) return false;
      for (const k of ['name', 'quality', 'chars', 'sub', 'type', 'desc']) if (r[k] !== p[k]) return false;
    }
    return true;
  } catch (_e) { return false; }
}

/* ══════════ 临时树与破坏 ══════════ */
const temps = [];
function mkTmp(tag) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3160_' + tag + '_'));
  temps.push(d);
  return d;
}
process.on('exit', () => {
  for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});

function stageGen(brokenGen) {
  const dir = mkTmp('gen');
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.sourcematerial'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tools', 'gen-dirtytalk.py'), brokenGen || GEN);
  fs.copyFileSync(path.join(ROOT, SRC_V941), path.join(dir, SRC_V941));
  return dir;
}
function runGen(dir) {
  return spawnSync('python3', ['tools/gen-dirtytalk.py'], { cwd: dir, encoding: 'utf8', timeout: 300000 });
}
/** 真源码破坏：锚点必须恰中一次 */
function damageSrc(src, anchor, replacement) {
  const hits = src.split(anchor).length - 1;
  assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + anchor.slice(0, 70));
  return src.split(anchor).join(replacement);
}

/* ══════════ A ── 管线面 ══════════ */
test('A1 ★★★ 机制条判定不得把 DTX_BODY 族吞掉（白名单在场且归一为 body 类）', () => {
  assert.ok(/BODY_MAP\s*=\s*\{[^}]*'DTX_BODY'/.test(GEN), 'BODY_MAP 必须含 DTX_BODY');
  assert.ok(/BODY_MAP\s*=\s*\{[^}]*'DTX_BODY_CORE_V941'/.test(GEN), 'BODY_MAP 必须含 DTX_BODY_CORE_V941');
  assert.ok(/if prefix in BODY_MAP:\n\s+label, force = BODY_MAP\[prefix\]\n\s+cat = 'body'/.test(GEN),
    'DTX_BODY 族必须归到 body 类（旧版是整族 skipped）');
  assert.ok(/elif MECH_RE\.match\(prefix\):\n\s+dropped_prefixes\[prefix\] \+= 1/.test(GEN),
    '真正的机制条判定必须退到 BODY_MAP 之后，且丢弃要入账（不得静默）');
});

test('A2 ★★★ 语料判定必须先于机制条判定（否则源档会被静默丢弃）', () => {
  const iCorpus = GEN.indexOf('if prefix in CORPUS_PREFIXES:');
  const iMech = GEN.indexOf('elif MECH_RE.match(prefix):');
  assert.ok(iCorpus > 0 && iMech > 0, '两处判定都必须在场');
  assert.ok(iCorpus < iMech, '★ 语料判定必须在机制条判定之前（旧顺序把 DTX_FRESH_ARCHIVE_FULL 丢了）');
  assert.ok(/CORPUS_PREFIXES[\s\S]{0,400}'DTX_BODY_SOURCE_ARCHIVE_V941'/.test(GEN),
    '源档必须显式列进语料前缀（它同时长得像机制条）');
});

test('A3 ★★ 生成器自证：源里出现过的每个语料前缀都必须真的进档（不静默）', () => {
  assert.ok(/missing = sorted\(k for k in all_prefixes if k in CORPUS_PREFIXES/.test(GEN),
    '必须逐前缀核对「出现在源里」与「真的进档」两件事');
  assert.ok(/assert not missing/.test(GEN), '核对不过必须拒判（而不是只打印一行）');
  assert.ok(/dropped-by-prefix/.test(GEN), '丢弃必须留下账本（可回答「静默丢了什么」）');
});

/* ══════════ B ── 数据面 ══════════ */
test('B1 ★★★ 三件套同源：索引与正文逐条一致、chars 忠实', () => {
  assert.equal(dirtyTalkIndex.length, dirtyTalkModules.length, '索引与正文条数一致');
  const byId = new Map(dirtyTalkModules.map((p) => [p.id, p]));
  assert.equal(byId.size, dirtyTalkModules.length, 'id 唯一');
  for (const r of dirtyTalkIndex) {
    const p = byId.get(r.id);
    assert.ok(p, '索引 id 必须在正文里：' + r.id);
    for (const k of ['name', 'cat', 'label', 'chars', 'sub', 'tier', 'desc', 'force']) {
      assert.equal(r[k], p[k], r.id + '.' + k + ' 必须逐条一致');
    }
  }
  for (const p of dirtyTalkModules) {
    assert.equal(Number(p.chars), String(p.content || '').length, p.id + ' chars 必须等于正文字符数');
    assert.ok(String(p.content || '').trim().length > 0, p.id + ' 正文不得为空');
  }
});

test('B2 ★★ body 类就位且排在类别表首位（视图分组的第一组）', () => {
  const body = dirtyTalkModules.filter((p) => p.cat === 'body');
  assert.equal(body.length, 32, 'body 模块数（31 个 affordance + 1 个核心）实测 ' + body.length);
  assert.equal(DT_CAT_ORDER[0], 'body', 'body 必须在类别表首位');
  assert.equal(DT_CAT_LABEL.body, '双人身体互动', 'body 必须有中文标签');
  assert.equal(body.filter((p) => String(p.label) === '双人身体互动').length, 31,
    '31 个 affordance 必须挂「双人身体互动」标签');
  const core = body.filter((p) => String(p.label) === '双人身体互动核心');
  assert.equal(core.length, 1, '核心必须单独挂「双人身体互动核心」标签（它是路由，不是第 32 个 affordance）');
  assert.equal(core[0].name, '双人身体互动核心');
  for (const p of body) assert.equal(p.sub, 1, p.id + ' 每个 body 条目各成单模块');
  assert.equal(DT_STYLES.length, 8, '8 风格不得被管线改动');
  for (const s of DT_STYLES) assert.ok(dirtyTalkModules.some((p) => p.cat === 'style' && p.name === s), '风格缺 ' + s);
});

test('B3 ★★★ 语料档必须真的收进两条 DTX 源档（旧版一条都读不到）', () => {
  const fresh = dirtyTalkCorpus.find((c) => c.prefix === 'DTX_FRESH_ARCHIVE_FULL');
  assert.ok(fresh, '★ DTX_FRESH_ARCHIVE_FULL 必须在语料档里（它在 v9.2.7 时代被静默丢弃）');
  assert.equal(fresh.chars, 3308, '源档案字数必须忠实（不虚报）');
  const arch = dirtyTalkCorpus.find((c) => c.prefix === 'DTX_BODY_SOURCE_ARCHIVE_V941');
  assert.ok(arch, '★ v9.4.1 的源档必须在语料档里');
  assert.equal(arch.chars, 1814, 'v9.4.1 源档字数必须忠实');
  assert.ok(dirtyTalkCorpus.some((c) => String(c.name).includes('Source Archive')), '源档名称必须可辨认');
  assert.equal(dirtyTalkCorpus.length, 82, '语料档条数（v9.2.7 时代是 80，本版 +2）');
});

/* ══════════ C ── 增量面 ══════════ */
test('C1 ★★★ v9.4.1 的 31 个 affordance 全部落地（逐条点名，不靠条数概括）', () => {
  const src = JSON.parse(read(SRC_V941));
  const want = Object.values(src.entries)
    .map((e) => String((e.key || [''])[0] || '').trim())
    .filter((k) => k.startsWith('[DTX_BODY:'))
    .map((k) => k.slice('[DTX_BODY:'.length, -1));
  assert.equal(want.length, 31, '源档里应有 31 个 affordance，实测 ' + want.length);
  const t = JSON.stringify(dirtyTalkModules.map((p) => p.content));
  const missing = want.filter((n) => !t.includes('【' + n + '｜'));
  assert.equal(missing.length, 0, '★ 未落地的 affordance：' + missing.join(', '));
  const core = dirtyTalkModules.find((p) => p.name === '双人身体互动核心');
  assert.ok(core, '核心模块必须在场');
  assert.ok(core.content.includes('DTX641_DYADIC_EMBODIMENT_ENGINE'), '核心模块必须含引擎头');
  assert.ok(core.content.includes('move_bridge=NOTICE|ASK|TEASE'), '核心必须保留 move_bridge 路由表（不是摘要）');
});

test('C2 ★★ 新条目不是被截断的（核心与各 affordance 都保留完整段落）', () => {
  const core = dirtyTalkModules.find((p) => p.name === '双人身体互动核心');
  assert.equal(core.chars, 1847, '核心字数必须与源一致');
  assert.ok(core.content.includes('【DTX641_DYADIC_EMBODIMENT_ENGINE_END】'), '核心必须有结束标记');
  const body = dirtyTalkModules.filter((p) => p.cat === 'body');
  assert.equal(Math.max(...body.map((p) => p.chars)), 1847, 'body 类里最长的是核心');
  assert.ok(Math.min(...body.map((p) => p.chars)) >= 500, '每个 affordance 至少 500 字（不是被截断的标题）');
  const arch = dirtyTalkCorpus.find((c) => c.prefix === 'DTX_BODY_SOURCE_ARCHIVE_V941');
  assert.ok(arch.content.includes('KNOWLEDGE_COVERAGE=COMPLETE'), '源档必须保留完整覆盖声明');
});

test('C3 ★★ 管线增量可复算（231 模块 / 282949 字；较上一版 +32 / +20338）', () => {
  const chars = dirtyTalkModules.reduce((s, p) => s + Number(p.chars || 0), 0);
  assert.equal(dirtyTalkModules.length, 231, '模块总数实测 ' + dirtyTalkModules.length);
  assert.equal(chars, 282949, '模块总字数实测 ' + chars);
  assert.equal(chars - 262611, 20338, '较 v9.2.7 时代的 199 模块 / 262611 字，本版 +32 模块 / +20338 字');
});

/* ══════════ D ── 金手指面 ══════════ */
test('D1 ★★★ ch166 位移：两份文件同源、品阶按字数分档、正文逐字保留', () => {
  const p = cheatPacks.find((x) => x.id === 'ch166');
  assert.ok(p, 'ch166 必须在场');
  assert.equal(p.name, '位移');
  assert.equal(p.chars, 3323, '字数实测 ' + p.chars);
  assert.equal(p.chars, p.content.length, 'chars 必须等于正文字符数');
  assert.equal(p.quality, '稀有', '按文件头声明的分档规则（>=2600 稀有）实测 ' + p.quality);
  assert.equal(p.type, '个人型', '主收益轴必须被理解为个人型');
  assert.equal(p.sub, 1);
  assert.ok(p.desc.length > 0 && p.desc.length <= 61, 'desc 必须从简介首句抽（不空、不超长），实测 ' + p.desc.length);
  for (const seg of ['<简介>', '<本质>', '<主收益轴>', '<触发源>', '<能力>', '<状态栏>', '<结算与回执>', '<WJWK-settle>', '<必要边界>', '<终极指向>']) {
    assert.ok(p.content.includes(seg), '正文必须保留段：' + seg);
  }
  assert.ok(p.content.startsWith('<位移>') && p.content.endsWith('</位移>'), '正文首尾标签必须完整');
  const r = cheatIndex.find((x) => x.id === 'ch166');
  assert.ok(r, '索引必须有 ch166');
  for (const k of ['name', 'quality', 'chars', 'sub', 'type', 'desc']) assert.equal(r[k], p[k], '同源字段 ' + k);
});

test('D2 ★★★ id 稳定性铁律：旧 165 包一字未动（逐包内容 md5 对冻结台账）', () => {
  const ledger = JSON.parse(read('tests/audit/cheat-packs-before-v3160.json'));
  assert.equal(ledger.count, 165, '冻结台账记的是 v3.15.0 时的 165 包');
  assert.equal(cheatPacks.length, 166, '库规模实测 ' + cheatPacks.length);
  for (let i = 0; i < 165; i++) {
    assert.equal(cheatPacks[i].id, 'ch' + String(i + 1).padStart(3, '0'), '前 165 包的 id 次序必须不变');
  }
  assert.equal(cheatPacks[165].id, 'ch166', '新包必须在末尾（不重排）');
  const drifted = [];
  for (const row of ledger.packs) {
    const p = cheatPacks.find((x) => x.id === row.id);
    if (!p) { drifted.push(row.id + ':missing'); continue; }
    for (const k of ['name', 'quality', 'chars', 'sub', 'type', 'desc']) {
      if (p[k] !== row[k]) drifted.push(row.id + '.' + k);
    }
    if (md5(p.content) !== row.contentMd5) drifted.push(row.id + '.content');
  }
  assert.equal(drifted.length, 0, '★ 旧包发生漂移：' + drifted.slice(0, 8).join(', '));
  assert.equal(new Set(cheatPacks.map((p) => p.id)).size, cheatPacks.length, 'id 唯一');
  for (const p of cheatPacks) assert.equal(p.chars, String(p.content || '').length, p.id + ' chars 忠实');
});

test('D3 ★★ 追加式更新有脚本可复现（不靠手改两份文件）', () => {
  assert.ok(/--id/.test(APPEND) && /--name/.test(APPEND) && /--src/.test(APPEND), '脚本必须接参数');
  assert.ok(/原地覆盖/.test(APPEND) && /追加/.test(APPEND), '必须区分「覆盖」与「追加」（幂等）');
  assert.ok(/const escTpl = \(s\)/.test(APPEND) && /const escTpl = \(s\)/.test(GEN_CHEATS),
    '转义函数与 gen-cheats.mjs 同名同规（否则两份文件转义会漂移）');
  assert.ok(/回读自证/.test(APPEND), '必须回读自证（写完再读一遍逐字段比）');
  assert.ok(/const BANDS/.test(APPEND) && /6000, '神话'/.test(APPEND), '品阶分档规则必须脚本化（不手填）');
});

/* ══════════ E ── 负控制（真源码破坏 → 同一份真判据必须转红） ══════════ */
test('E0 ★★★ 阳性对照：未破坏时判据必须为真（否则 E 组是假绿）', () => {
  const dir = stageGen(null);
  const r = runGen(dir);
  assert.equal(r.status, 0, '生成器必须能跑通：' + String(r.stderr || '').slice(0, 300));
  assert.equal(pipelineJudge(dir), true, 'J1 在原件上必须为真');
  const ledger = JSON.parse(read('tests/audit/cheat-packs-before-v3160.json'));
  assert.equal(appendJudge(cheatPacks, cheatIndex, ledger), true, 'J2 在原件上必须为真');
});

test('E1 ★★★ 破坏：DTX_BODY 重新变回机制条 → 管线判据必须转红', () => {
  const broken = damageSrc(GEN, 'if prefix in BODY_MAP:', 'if False and prefix in BODY_MAP:');
  const dir = stageGen(broken);
  const r = runGen(dir);
  const produced = fs.existsSync(path.join(dir, 'data/dirtytalk-index.js'));
  if (produced) assert.equal(pipelineJudge(dir), false, '★ J1 在破坏副本上必须为 false');
  else assert.notEqual(r.status, 0, '★ 破坏后生成器必须报错（实测 exit ' + r.status + '）');
  const ok = stageGen(null);
  assert.equal(runGen(ok).status, 0);
  assert.equal(pipelineJudge(ok), true, '对照：原件上仍为真');
});

test('E2 ★★★ 破坏：语料判定挪回机制条判定之后 → 源档再次被静默丢弃，生成器必须拒判', () => {
  const broken = damageSrc(GEN,
    '        if prefix in CORPUS_PREFIXES:\n            corpus_seen[prefix] += 1',
    '        if MECH_RE.match(prefix):\n            dropped_prefixes[prefix] += 1\n            skipped += 1\n            continue\n        if prefix in CORPUS_PREFIXES:\n            corpus_seen[prefix] += 1');
  const dir = stageGen(broken);
  const r = runGen(dir);
  assert.notEqual(r.status, 0, '★ 旧顺序必须被自证拒判（这正是它当年能静默通过的原因）');
  const all = String(r.stderr || '') + String(r.stdout || '');
  assert.ok(/拒判/.test(all), '必须报「拒判：语料前缀被丢弃」：' + all.slice(0, 240));
  assert.ok(/DTX_FRESH_ARCHIVE_FULL/.test(all), '必须点名被丢的前缀');
});

test('E3 ★★ 破坏：追加脚本的转义函数变恒等 → 含反引号/插值的正文会被写坏（可观测）', () => {
  const anchor = "const escTpl = (s) => String(s).replace(/\\\\/g, '\\\\\\\\').replace(/`/g, '\\\\`').replace(/\\$\\{/g, '\\\\${');";
  const broken = damageSrc(APPEND, anchor, 'const escTpl = (s) => String(s);');
  assert.ok(/const escTpl = \(s\) => String\(s\);/.test(broken), '破坏必须真的生效');
  const fixture = '<夹具>\n\n<简介>\n带 ` 反引号与 ${插值} 的正文。\n';
  function runAppend(src, tag) {
    const dir = mkTmp(tag);
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'scripts', 'append-cheat.mjs'), src);
    fs.copyFileSync(path.join(ROOT, 'data', 'cheats.js'), path.join(dir, 'data', 'cheats.js'));
    fs.copyFileSync(path.join(ROOT, 'data', 'cheat-index.js'), path.join(dir, 'data', 'cheat-index.js'));
    fs.writeFileSync(path.join(dir, 'body.txt'), fixture);
    const r = spawnSync('node', ['scripts/append-cheat.mjs', '--id', 'ch199', '--name', '夹具', '--src', 'body.txt'],
      { cwd: dir, encoding: 'utf8', timeout: 120000 });
    const txt = fs.readFileSync(path.join(dir, 'data', 'cheats.js'), 'utf8');
    return { r: r, txt: txt };
  }
  /* ★ 断言必须只取 content 模板串本体：desc 字段走 JSON.stringify（双引号串），
   *   反引号在那里**本来就合法**——直接对条目整段做正则会把 desc 当成漏转义。 */
  function contentSlice(txt) {
    const at = txt.indexOf('"id": "ch199"');
    if (at < 0) return null;
    const cAt = txt.indexOf('"content": `', at);
    if (cAt < 0) return null;
    const head = '"content": `'.length;
    const end = txt.indexOf(String.fromCharCode(96) + '  }', cAt);
    return txt.slice(cAt + head, end < 0 ? undefined : end);
  }
  const b = runAppend(broken, 'appendbad');
  const bc = contentSlice(b.txt);
  assert.ok(bc !== null, '夹具条目必须在产物里（写入本身要成功）');
  assert.ok(bc.includes('带 ` 反引号'), '★ 破坏后正文出现裸反引号（转义失效可观测）');
  const o = runAppend(APPEND, 'appendok');
  assert.equal(o.r.status, 0, '原件上必须跑通：' + String(o.r.stderr).slice(0, 200));
  const oc = contentSlice(o.txt);
  assert.ok(oc !== null, '原件上夹具条目必须在场');
  assert.ok(oc.includes('\\`'), '★ 原件上反引号必须被反斜杠转义');
  assert.ok(!oc.includes('带 ` 反引号'), '原作上不得出现裸反引号');
  assert.ok(oc.includes('\\${'), '插值也必须被转义');
  assert.ok(oc.includes('带 ') && oc.includes(' 反引号与 '), '对照：转义不得把正文吃掉（内容仍在）');
});

/* ══════════ F ── 版本锚 ══════════ */
const VNUM = (s) => Number(String(s).split('.').reduce((a, x) => a * 1000 + Number(x), 0));
test('F1 ★ 版本锚（下限形）+ 当版条目非空 + 弹窗文案不含方括号', () => {
  const man = JSON.parse(read('manifest.json'));
  const pkg = JSON.parse(read('package.json'));
  const log = JSON.parse(read('update-log.json'));
  const codeVer = (/const ST_PHONE_VERSION = '([^']+)'/.exec(read('index.js')) || [])[1];
  assert.ok(codeVer, '入口版本常量在场');
  assert.equal(codeVer, man.version, '入口 == manifest');
  assert.equal(pkg.version, man.version, 'package == manifest');
  assert.equal(log.latest, man.version, 'update-log.latest == manifest');
  assert.ok(VNUM(man.version) >= VNUM('3.16.0'), '本套件自 3.16.0 起成立；当前 ' + man.version);
  const items = log.versions[log.latest].items;
  assert.ok(Array.isArray(items) && items.length >= 4, '当版条目不得为空（实测 ' + items.length + '）');
  for (const it of items) {
    assert.equal(it.includes('[') || it.includes(']'), false, '弹窗文案不得含方括号（当版切片判据按首个 ] 截断）');
  }
  /* [v3.17.0 交棒] 内容面关键词锚**本套件出生版本**（3.16.0）的条目，不锚 log.latest：
   *   原判据把「双人身体互动 / DTX_BODY / 位移」打在当版条目上，是对以后每一版下永久约束
   *   （抬版即红）。按仓内既定口径（同 v298-E2 / v300-D2 / v301-D2 / v302-E2 / v303-D2）：
   *   落地项关键词锚出生版本（它钉的是历史事实），而弹窗逐字同源那半仍锚当版。 */
  const own = log.versions['3.16.0'];
  assert.ok(own && Array.isArray(own.items), 'v3.16.0 条目必须仍在（本判据钉的是历史事实）');
  const body = own.items.join(' ');
  assert.ok(/双人身体互动|DTX_BODY/.test(body), '当版条目必须点出本版主线（双人身体互动增量）');
  assert.ok(/静默|蒸发|丢弃/.test(body), '当版条目必须记下管线缺陷这件事（不得只写「新增了内容」）');
  assert.ok(/位移/.test(body), '当版条目必须点出新增金手指');
});
