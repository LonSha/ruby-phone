/* ============================================================
 * tests/r23_o2_body_slice.test.mjs — R23-O2 方法体内切片的判据（正反两面 + 负控制）
 * ------------------------------------------------------------
 * 本批真切了两段（bindEvents 体内 → apps/wechat/chat-input-bind.js），所以判据分四组：
 *   L1 逐字节：模块里的函数体与台账记的 body_sha256 一致；改一个字符就红。
 *   L2 调用点：源文件里只剩一条 `fn.call(this, query)`、原段文本已不存在（不许留第二份）、
 *             新模块零 import（依赖面为 0）、调用点落在 bindEvents 方法体内。
 *   L3 运行时：bindEvents 的事件挂载序列与切片前基线**逐条相同**（48 条，顺序也比）。
 *   探针自检：读数工具自己的四类假阳性（case 片段 / if 块内 return / 语句外带 / 模板串引用）
 *             每类都有一条单测钉住 —— 这四条都是本批现场踩出来的，不是设想的。
 *
 * 口径（诚实写明）：
 *   · L1 证明的是「切出去的这段没被改」，证明不了「它原来就长这样」—— 后者靠提交里的 diff；
 *   · L3 的产出是「事件挂载序列」，不含回调体行为；回调体由 L1 兜着；
 *   · 快照只覆盖一次 bindEvents 调用，querySelectorAll 返回空列表（遍历分支不在覆盖内）。
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  ROOT,
  LEDGER as CANDIDATES,
  TARGETS,
  findMethod,
  isStatementBlock,
  scanReturnScopes,
  classifyBrace,
  classify,
  analyzeAll,
} from './audit/scan_body_slice_candidates.mjs';
import { captureBindEventsSnapshot } from './_bind_events_snapshot.mjs';

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const VIEW = 'apps/wechat/chat-view.js';
const MODULE = 'apps/wechat/chat-input-bind.js';
const SNAPSHOT = 'tests/audit/bind_events_snapshot.json';
const LEDGER = 'tests/audit/body_slice_ledger.json';

const viewText = read(VIEW);
const moduleText = read(MODULE);
const ledger = JSON.parse(read(LEDGER));
const snap = JSON.parse(read(SNAPSHOT));

const sha = (lines) => createHash('sha256').update(lines.join('\n')).digest('hex');

/** 从模块文本里取一个 export function 的函数体（行数组，不含首尾花括号）。 */
export function bodyOf(text, name) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith('export function ' + name + '('));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && lines[end] !== '}') end++;
  return lines.slice(start + 1, end);
}

const count = (hay, needle) => hay.split(needle).length - 1;

const red = (ok, msg) => assert.equal(ok, false, '本应判红却通过了：' + msg);
const green = (ok, msg) => assert.equal(ok, true, '本应通过却红了：' + msg);

/* ---------------- L1：逐字节 ---------------- */

test('L1 模块里两个函数体与台账 body_sha256 逐字节相同', () => {
  assert.equal(ledger.slices.length, 2, '台账应记 2 段切片');
  for (const s of ledger.slices) {
    const body = bodyOf(moduleText, s.name);
    assert.ok(body && body.length > 0, s.name + ' 在模块里找不到');
    assert.equal(body.length, s.source_lines, s.name + ' 行数与台账不符');
    assert.equal(sha(body), s.body_sha256, s.name + ' body sha 不符（函数体被改过）');
  }
});

test('L1 台账的 body_sha256 与「切片当时源文件该区间」一致（记录值自洽）', () => {
  /* 两段 sha 是切片当时从 chat-view.js 算出来的；这里用台账里的行号区间 + 行数把
     「当时那段」重算不出来（已从源文件删掉），所以只校验记录本身的形状自洽。 */
  for (const s of ledger.slices) {
    assert.match(s.body_sha256, /^[0-9a-f]{64}$/, s.id + ' sha 形态不对');
    assert.equal(s.source_file, VIEW);
    assert.ok(s.source_to > s.source_from, s.id + ' 行号区间反了');
    assert.equal(s.source_to - s.source_from + 1, s.source_lines, s.id + ' 行数区间不自洽');
  }
});

test('L1 负控制①：把台账里的 sha 改一位 → 比对必须红', () => {
  const s = ledger.slices[0];
  const body = bodyOf(moduleText, s.name);
  const tampered = (s.body_sha256[0] === '0' ? '1' : '0') + s.body_sha256.slice(1);
  red(sha(body) === tampered, s.name + ' 篡改 sha 后仍判通过');
});

test('L1 负控制②：把模块里函数体改一个字符 → sha 必须变', () => {
  const s = ledger.slices[0];
  const body = bodyOf(moduleText, s.name);
  const broken = body.map((l, i) => (i === body.length - 1 ? l + ' ' : l));
  red(sha(broken) === s.body_sha256, '函数体加一个空格后 sha 竟然没变');
});

/* ---------------- L2：调用点 + 单一实现 ---------------- */

test('L2 源文件里每个切片只剩一条 `fn.call(this, query)`', () => {
  for (const s of ledger.slices) {
    const needle = s.name + '.call(this, query)';
    assert.equal(count(viewText, needle), 1, s.name + ' 调用点应恰好 1 处');
    assert.equal(s.this_via, '.call(this, query)', '台账 this 传法应与代码一致');
  }
});

test('L2 源文件里已不存在被搬走的原段（不许留第二份实现）', () => {
  const needles = [
    "const voiceInputBtn = query('#voice-input-btn')",
    "const quickReplySendBtn = query('.quick-reply-send')",
    "const quickReplyCancelBtn = query('.quick-reply-cancel')",
  ];
  for (const n of needles) {
    assert.equal(count(viewText, n), 0, '源文件里还有：' + n);
    assert.equal(count(moduleText, n), 1, '模块里应恰好 1 处：' + n);
  }
});

test('L2 新模块零 import（依赖面为 0，不许把判定搬进来）', () => {
  const importLines = moduleText.split('\n').filter((l) => /^\s*import\s/.test(l));
  assert.deepEqual(importLines, [], '新模块出现 import：' + JSON.stringify(importLines));
});

test('L2 调用点落在 bindEvents 方法体内（不是挂在别的函数里）', () => {
  const range = findMethod(viewText.split('\n'), 'bindEvents');
  assert.ok(range, '找不到 bindEvents');
  const lines = viewText.split('\n');
  for (const s of ledger.slices) {
    const at = lines.findIndex((l) => l.includes(s.name + '.call(this, query)'));
    assert.ok(at >= range.start && at <= range.end, s.name + ' 的调用点跑出 bindEvents 了');
  }
});

test('L2 负控制：把原段塞回 chat-view.js（模拟第二份实现）→ 判红', () => {
  const injected = viewText + "\n        const quickReplySendBtn = query('.quick-reply-send');\n";
  red(count(injected, "const quickReplySendBtn = query('.quick-reply-send')") === 0, '塞回第二份后仍判没有');
});

test('L2 负控制：新模块加一行 import → 判红', () => {
  const dirty = "import { x } from './y.js';\n" + moduleText;
  const importLines = dirty.split('\n').filter((l) => /^\s*import\s/.test(l));
  red(importLines.length === 0, '加了 import 还判零依赖');
});

/* ---------------- L3：运行时产出 ---------------- */

const { ChatView } = await import(path.join(ROOT, VIEW));
const nowSeq = captureBindEventsSnapshot(ChatView);

test('L3 切片后 bindEvents 的事件挂载序列与基线逐条相同（含顺序）', () => {
  assert.equal(nowSeq.length, snap.count, '挂载条数与基线不同');
  const diffs = [];
  for (let i = 0; i < Math.max(nowSeq.length, snap.listeners.length); i++) {
    if (nowSeq[i] !== snap.listeners[i]) diffs.push(i + ': ' + snap.listeners[i] + ' -> ' + nowSeq[i]);
  }
  assert.deepEqual(diffs, [], '挂载序列有差异：\n' + diffs.join('\n'));
  assert.equal(snap.count, 48, '基线应为 48 条（本批读数）');
});

test('L3 基线里不许出现 __error 形态，且条数不是 0（空快照不算通过）', () => {
  assert.ok(snap.count >= 40, '基线条数过少，采集器可能没跑起来：' + snap.count);
  const bad = snap.listeners.filter((s) => s.includes('__error'));
  assert.deepEqual(bad, []);
});

test('L3 关键挂载点真的在序列里（快照不能是「什么都没挂」）', () => {
  for (const needle of [
    '#voice-input-btn::click',
    '.quick-reply-send::click',
    '.quick-reply-cancel::click',
    '#send-btn::click',
  ]) {
    assert.ok(
      snap.listeners.some((s) => s.endsWith(needle)),
      '基线里没有 ' + needle
    );
  }
});

test('L3 负控制①：篡改基线一条 → 比对必须红', () => {
  const tampered = snap.listeners.map((s, i) => (i === 3 ? s + '-tampered' : s));
  const same = tampered.every((v, i) => v === nowSeq[i]) && tampered.length === nowSeq.length;
  red(same, '篡改一条后仍判相同');
});

test('L3 负控制②：少一条 → 判红', () => {
  const short = snap.listeners.slice(0, -1);
  const same = short.every((v, i) => v === nowSeq[i]) && short.length === nowSeq.length;
  red(same, '少一条后仍判相同');
});

/* ---------------- 探针自检：四类假阳性各一条 ---------------- */

const clean = (arr) => arr;

test('探针·F1：switch 里的 case 片段不是合法语句块', () => {
  const lines = [
    'function m() {',
    "    case 'gathering_card': {",
    "        messageBody = this.render();",
    '        break;',
    '    }',
    '}',
  ];
  const block = { from: 1, to: 4 };
  red(isStatementBlock(lines, block, 1), 'case 片段被当成语句块放行');
});

test('探针·F2：if 块里的 return 会外流，箭头回调里的不会', () => {
  const ifBlock = clean([
    "        if (msg.type === 'system') {",
    '            const c = 1;',
    '            return c;',
    '        }',
  ]);
  const r1 = scanReturnScopes(ifBlock, { from: 0, to: ifBlock.length - 1 });
  assert.deepEqual(r1.own, [3], 'if 块里的 return 应记为外流');
  assert.deepEqual(r1.nested, [], 'if 块里的 return 不该被算成嵌套');

  const arrow = clean([
    '        const html = list.map((v) => {',
    '            return v;',
    "        }).join('');",
  ]);
  const r2 = scanReturnScopes(arrow, { from: 0, to: arrow.length - 1 });
  assert.deepEqual(r2.own, [], '箭头回调里的 return 不该算外流');
  assert.deepEqual(r2.nested, [2], '箭头回调里的 return 应记为嵌套');
});

test('探针·F2b：classifyBrace 分得清 if 头 / 箭头头 / function 头', () => {
  assert.equal(classifyBrace(' if (a && b) '), 'block');
  assert.equal(classifyBrace(' list.map((v) => '), 'fn');
  assert.equal(classifyBrace(' list.map(function (v) '), 'fn');
  assert.equal(classifyBrace(' try '), 'block');
});

test('探针·F3/F4：段内声明外带 / 外流 return 都不许判 READY', () => {
  const base = { lines: 30, outerReads: ['query'], outerWrites: [], usesThis: true, hasDynamic: false };
  assert.equal(classify({ ...base, escapes: [], hasReturn: false }).level, 'READY');
  assert.equal(classify({ ...base, escapes: ['executeSend'], hasReturn: false }).level, 'TUPLE');
  assert.equal(classify({ ...base, escapes: ['a', 'b', 'c', 'd'], hasReturn: false }).level, 'NOT_YET');
  assert.equal(classify({ ...base, escapes: [], hasReturn: true }).level, 'NOT_YET');
});

test('探针·进程级：读数工具 rc=0，且 bindEvents 已无 READY 候选（两段已被消费）', () => {
  const r = spawnSync('node', [path.join(ROOT, 'tests/audit/scan_body_slice_candidates.mjs'), '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  });
  assert.equal(r.status, 0, '探针进程 rc 非 0：' + (r.stderr || '').slice(0, 300));
  const doc = JSON.parse(r.stdout);
  const bind = doc.results.find((x) => x.method === 'bindEvents');
  assert.ok(bind && bind.found, 'bindEvents 没被分析到');
  const ready = bind.blocks.filter((b) => b.level === 'READY');
  assert.deepEqual(ready, [], 'bindEvents 又出现 READY 候选（说明台账该更新了）');
});

test('探针·读数文件覆盖所有 TARGETS，且每段都带定级理由', () => {
  const doc = JSON.parse(read(CANDIDATES));
  assert.equal(doc.methods.length, TARGETS.length, '读数覆盖的方法数与 TARGETS 不符');
  for (const m of doc.methods) {
    assert.ok(m.found, m.method + ' 没被找到');
    for (const b of m.blocks) {
      assert.ok(b.why && b.level, b.method + ' L' + b.from + ' 缺定级理由');
      assert.ok(Array.isArray(b.own_depth_returns), '缺 own_depth_returns 字段');
    }
  }
});

/* ---------------- 台账方向性 ---------------- */

test('台账记录的是「切完更小」：源文件与方法行数都下降', () => {
  const r = ledger.readings;
  assert.ok(r.chat_view_lines_after < r.chat_view_lines_before,
    `chat-view.js 应下降：${r.chat_view_lines_before} -> ${r.chat_view_lines_after}`);
  assert.ok(r.bind_events_lines_after < r.bind_events_lines_before,
    `bindEvents 应下降：${r.bind_events_lines_before} -> ${r.bind_events_lines_after}`);
  assert.equal(r.new_module_imports, 0);
  const actual = readFileSync(path.join(ROOT, VIEW), 'utf8').split('\n').length - 1;
  assert.ok(actual <= r.chat_view_lines_after, `chat-view.js 现在 ${actual} 行，比台账记的 ${r.chat_view_lines_after} 还大`);
});

test('台账把「没切的」也写清楚：TUPLE/NOT_YET 各有理由，不许只说结论', () => {
  assert.ok(ledger.not_sliced.length >= 5, '未切清单过少');
  for (const n of ledger.not_sliced) {
    assert.ok(n.why && n.why.length > 10, n.method + ' 没写清为什么不动');
    assert.ok(['TUPLE', 'NOT_YET'].includes(n.level), n.method + ' 等级不在 TUPLE/NOT_YET 里');
  }
  assert.ok(ledger.next_batch_hint.length > 20, '缺下一批的手段提示');
});
