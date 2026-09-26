// tests/system-v328.test.mjs — 运行时验证边界接入用户说明（TODO P2 ④ 收口）[v3.9.2]
//
//   工程侧一直有 `docs/runtime-verification-boundary.md`（v2.82.0 写），但**用户看不到它**：
//   它不在任何面向用户的出口上。TODO P2 ④ 挂着的就是这件事。
//
//   本版做两件：
//     ① 把边界压成「一句话版本」写进边界文档，并让它出现在 App 内「本版更新」弹窗的条目里；
//     ② 把「两侧必须同源」与「数字必须随门禁复校」变成判据 —— 否则工程写下边界、用户侧另说一套。
//
//   覆盖：
//     A 文档与用户出口齐备（含「一句话版本」节与不可验项仍在）
//     B 同源：用户可见条与文档句子必须共享同一句标志语
//     C 复校纪律：文档的实测数字必须与当前门禁真跑的读数一致（防陈旧漂移）
//     D 负控制三条（删文档段 / 抹掉用户条 / 改错数字 ⇒ 同款真判据转红）
//     E 版本锚
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DOC_REL = 'docs/runtime-verification-boundary.md';
const LOG_REL = 'update-log.json';
const MAN_REL = 'manifest.json';

/* ── 判据本体：只读三个文件，可对「真仓」或「副本」跑（副本用于负控制） ── */
function readAt(root, rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
/** [F1 同源标志语] 用户在弹窗里读到的那句，必须与文档里那句**同一段文字**。 */
const MARK = '看起来没坏但显示不对';

function judge(root) {
  const doc = readAt(root, DOC_REL);
  const log = JSON.parse(readAt(root, LOG_REL));
  const man = JSON.parse(readAt(root, MAN_REL));
  const ver = String(man.version);
  const items = (log.versions[String(log.latest)] || {}).items || [];
  return {
    ver: ver,
    doc_has_unverified: /未验证/.test(doc),
    doc_has_layout: /窄屏|排版/.test(doc),
    doc_has_oneliner: /一句话版本/.test(doc),
    doc_has_entry_note: /面向用户的读者入口|面向用户/.test(doc),
    doc_recert: doc.includes('v' + ver + ' 复校'),
    doc_has_mark: doc.indexOf(MARK) >= 0,
    doc_numbers: {
      syntax_files: (doc.match(/语法 (\d+) 文件/) || [])[1] || null,
      import_files: (doc.match(/导入 (\d+) 文件 (\d+) 条/) || [])[1] || null,
      import_specs: (doc.match(/导入 (\d+) 文件 (\d+) 条/) || [])[2] || null
    },
    user_item_hits: items.filter((it) => /运行时验证边界/.test(String(it))).length,
    user_item_has_mark: items.some((it) => String(it).indexOf(MARK) >= 0),
    user_items_ok: items.length > 0 && items.every((it) => String(it).length > 0)
  };
}

const real = judge(ROOT);

/* ── 副本夹具：判据只需三个文件 ── */
const temps = [];
function clone(tweak) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v328_'));
  temps.push(dir);
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  for (const rel of [DOC_REL, LOG_REL, MAN_REL]) fs.copyFileSync(path.join(ROOT, rel), path.join(dir, rel));
  if (tweak) tweak(dir);
  return dir;
}
process.on('exit', () => {
  for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});
function judgeThrows(dir) {
  try { judge(dir); return null; } catch (e) { return e; }
}

/* ══════════ A ── 文档与用户出口齐备 ══════════ */
test('A1 边界文档仍毕备：不可验项 / 排版项 / 一句话节 / 用户入口说明', () => {
  assert.ok(fs.existsSync(path.join(ROOT, DOC_REL)), '边界文档必须存在');
  assert.equal(real.doc_has_unverified, true, '必须保留「未验证」标注（该文档存在的理由）');
  assert.equal(real.doc_has_layout, true, '必须登记「需要真实排版」的不可验项');
  assert.equal(real.doc_has_oneliner, true, '必须有「一句话版本」节（用户可读入口）');
  assert.equal(real.doc_has_entry_note, true, '必须写明「本文结论会被接进面向用户的说明」');
});

test('A2 用户在弹窗里真的读得到边界（本版不再只把边界写在工程文档里）', () => {
  assert.ok(real.user_items_ok, '当前版本条目必须非空');
  assert.ok(real.user_item_hits >= 1,
    '当前版本条目必须至少有 1 条提到「运行时验证边界」，实测 ' + real.user_item_hits);
  assert.equal(real.user_item_has_mark, true,
    '用户可见条必须包含与文档同源的标志语（防两侧各说一套）');
});

/* ══════════ B ── 同源 ══════════ */
test('B1 两侧同源：文档句子与用户可见条共用同一句标志语', () => {
  assert.equal(real.doc_has_mark, true, '文档的「一句话版本」必须包含标志语：' + MARK);
  assert.equal(real.user_item_has_mark, true, '用户可见条必须包含同一标志语');
  /* 不能只是两个词各自出现：必须能定位到**完整句** */
  const doc = readAt(ROOT, DOC_REL);
  const log = JSON.parse(readAt(ROOT, LOG_REL));
  const items = log.versions[String(log.latest)].items.map(String);
  /* ★ 取句口径：标志语所在**整段**（含相邻行）—— 文档里「不能保证」可能落在标志语的上一行，
   *   只取单行会把合法文本判成不合规（本套件第一版即踩此坑）。用户条是单条字符串，整条取。 */
  const docLines = doc.split('\n');
  const hitIdx = docLines.findIndex((l) => l.indexOf(MARK) >= 0);
  assert.ok(hitIdx >= 0, '文档必须含标志语');
  const docPara = docLines.slice(Math.max(0, hitIdx - 2), hitIdx + 3).join(' ');
  const itLine = items.find((l) => l.indexOf(MARK) >= 0) || '';
  assert.ok(docPara.length > 20 && itLine.length > 20, '两侧都必须给出完整句而非孤立词');
  /* 语义必须一致：都以「真机上做不到/不保证」为否定面。允许等价表达，
   *   但**不允许**只说好话（「已完整验证」这类必须被挡住）。
   *   ★ 判据必须匹配**真实书写**：文档里写成 `它**不能**保证…`（markdown 加粗把词切开），
   *   所以先剥强调标记再判 —— 否则合法文本会被判成不合规（本套件第二次踩的坑）。 */
  const plain = (s) => String(s).split('**').join('').split('`').join('');
  for (const [tag, s] of [['文档', plain(docPara)], ['用户条', plain(itLine)]]) {
    assert.ok(/不能保证|仍不能验|不可测|不能验/.test(s), tag + '必须把边界说成「不能保证」而非「已验」');
    assert.equal(/已完整验证|已完全验证|全部验证通过/.test(s), false, tag + '不得把边界说成全绿');
  }
});

test('B2 复校纪律：文档的复校版本必须等于当前版本（否则抬版即陈旧）', () => {
  assert.equal(real.doc_recert, true,
    '文档必须带当前版本复校标记（v' + real.ver + ' 复校）—— 抬版时必须复校一次');
});

/* ══════════ C ── 数字与真门禁一致（防陈旧漂移） ══════════ */
test('C1 文档里的实测数字必须与当前门禁真跑的一致', () => {
  /* ★ 凭什么要跑真门禁：文档里写的是「实测」；不跑就无从区别「实测」与「抄的旧数」。 */
  const syn = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'syntax-check.mjs')],
    { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  assert.equal(syn.status, 0, '语法门必须能跑通：' + String(syn.stderr || '').slice(0, 200));
  const m = /语法门通过：(\d+) 个文件/.exec(syn.stdout || '');
  assert.ok(m, '语法门必须报出文件数（口径不得静默变更）');
  const live = Number(m[1]);
  assert.ok(real.doc_numbers.syntax_files, '文档必须写明语法门文件数');
  assert.equal(Number(real.doc_numbers.syntax_files), live,
    '文档写的语法门文件数（' + real.doc_numbers.syntax_files + '）必须等于真跑读数（' + live + '）');
  /* 导入面同理：文件数与条数都要对得上 */
  const imp = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'import-resolve-check.mjs')],
    { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  assert.equal(imp.status, 0, '导入门必须能跑通：' + String(imp.stderr || '').slice(0, 200));
  const mi = /扫描 (\d+) 个文件 · 静态相对导入 (\d+) 条/.exec(imp.stdout || '');
  assert.ok(mi, '导入门必须报出扫描面与条数');
  assert.equal(Number(real.doc_numbers.import_files), Number(mi[1]),
    '文档写的导入文件数必须等于真跑读数');
  assert.equal(Number(real.doc_numbers.import_specs), Number(mi[2]),
    '文档写的导入条数必须等于真跑读数');
});

/* ══════════ D ── 负控制（真判据对破坏有反应） ══════════ */
test('D1 把「一句话版本」节从文档删掉 ⇒ B1 同款判据必须转红', () => {
  const dir = clone((d) => {
    const p = path.join(d, DOC_REL);
    const src = fs.readFileSync(p, 'utf8');
    const at = src.indexOf('### 三·附');
    assert.ok(at > 0, '锚点必须存在（删段前先自证）');
    fs.writeFileSync(p, src.slice(0, at));
  });
  const j = judge(dir);
  assert.equal(j.doc_has_mark, false, '删掉句子后文档标志语必须消失（判据不是死的）');
  assert.equal(j.doc_has_oneliner, false, '一句话节必须随之消失');
  assert.equal(real.doc_has_mark, true, '对照：真文档仍为真');
});

test('D2 把用户可见条里的边界说明抹掉 ⇒ A2/B1 同款判据必须转红', () => {
  const dir = clone((d) => {
    const p = path.join(d, LOG_REL);
    const log = JSON.parse(fs.readFileSync(p, 'utf8'));
    const cur = log.versions[String(log.latest)];
    cur.items = cur.items.map((it) => String(it).split(MARK).join('已由门禁完整验证'));
    fs.writeFileSync(p, JSON.stringify(log, null, 2) + '\n');
  });
  const j = judge(dir);
  assert.equal(j.user_item_has_mark, false, '抹掉标志语后用户条必须不再命中');
  assert.equal(j.user_item_hits >= 1, true, '对照：边界条目仍在（本破坏只动了标志语）');
  assert.equal(real.user_item_has_mark, true, '对照：真用户条仍为真');
});

test('D3 文档数字写错（与门禁不符）⇒ C1 同款判据必须转红', () => {
  const dir = clone((d) => {
    const p = path.join(d, DOC_REL);
    let src = fs.readFileSync(p, 'utf8');
    const before = src;
    src = src.replace(/语法 (\d+) 文件/, '语法 999 文件');
    assert.notEqual(src, before, '数字锚点必须存在（改错前先自证）');
    fs.writeFileSync(p, src);
  });
  const j = judge(dir);
  assert.equal(Number(j.doc_numbers.syntax_files), 999, '破坏后的读数必须是 999');
  assert.notEqual(Number(j.doc_numbers.syntax_files), Number(real.doc_numbers.syntax_files),
    '与真读数不同 ⇒ C1 的等号判据会翻红');
  /* 同时自证这不是把判据删了：真文档的读数仍在合法区间 */
  assert.ok(Number(real.doc_numbers.syntax_files) >= 170,
    '真文档读数必须 ≥ 170（否则可能是判据面掉底）');
});

test('D4 判据工具自证：缺文件必须抛（不得静默通过）', () => {
  const dir = clone(null);
  fs.rmSync(path.join(dir, DOC_REL));
  assert.ok(judgeThrows(dir), '缺边界文档时判据必须抛，而不是静默返回');
  const dir2 = clone(null);
  fs.writeFileSync(path.join(dir2, LOG_REL), '{ not json');
  assert.ok(judgeThrows(dir2), '更新说明损坏时判据必须抛');
});

/* ══════════ E ── 版本锚 ══════════ */
test('E1 版本锚（下限形）+ 三源同源', () => {
  const manV = JSON.parse(readAt(ROOT, MAN_REL)).version;
  const pkgV = JSON.parse(readAt(ROOT, 'package.json')).version;
  const src = readAt(ROOT, 'index.js');
  const parts = manV.split('.').map(Number);
  assert.ok(parts[0] > 3 || (parts[0] === 3 && parts[1] >= 9),
    '本套件成立于 RubyPhone 3.9.0 及以后，当前 ' + manV);
  assert.equal(pkgV, manV, 'package.json 必须与 manifest 同版');
  assert.ok(src.indexOf("const ST_PHONE_VERSION = '" + manV + "';") >= 0,
    '入口版本常量必须与 manifest 同版');
  assert.equal(real.doc_recert, true, '文档与当前版本同源');
});
