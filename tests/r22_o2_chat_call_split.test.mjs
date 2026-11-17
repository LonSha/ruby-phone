/* ============================================================
 * tests/r22_o2_chat_call_split.test.mjs — R22-O2 拆分判据（正反两面 + 负控制）
 * ------------------------------------------------------------
 * 判据正的一面：抽出 chat-call-core.js 之后，两个通话方法的**方法体逐字节不变**，
 *   两边各只有一份实现，混入接得上，依赖面是 0，运行时原型真拿到。
 * 判据反的一面（负控制）：把判据自己打坏——改一个字符 / 塞回第二份实现 /
 *   删掉混入 / 混入跑到 class 前面 / 多引一个依赖 / 台账不记真值——**必须逐条翻红**。
 *   只验正面的闸等于「只会说 OK 的闸」，所以每一条都配一个负控制。
 *
 * 口径（诚实写明）：
 *   · 本批**没有**快照：通话界面产出 DOM 与事件绑定，_chat_render_snapshot.mjs
 *     只覆盖纯字符串产出；套用它会把「取不到」记成「等价」，那是假绿。
 *   · R6 证明的是「文本没变」，不是「行为没变」；纯搬迁下两者等价，改写不成立。
 *   · 运行时只验到「原型上有这个方法 + 模块加载不抛错」，没跑真实通话。
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  ROOT,
  CHAT_VIEW,
  CALL_CORE,
  CALL_LEDGER,
  EXTRACTED2,
  CALL_CORE_IMPORTS,
  linesOf,
  countDefs,
  bodyOf,
  sha256,
  checkBodySha,
  checkSingleImplementation2,
  checkMixin2,
  checkCallCoreImports,
} from './audit/scan_chat_render_split.mjs';

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const viewText = read(CHAT_VIEW);
const coreText = read(CALL_CORE);
const callLedger = JSON.parse(read(CALL_LEDGER));
const { ChatView } = await import(path.join(ROOT, CHAT_VIEW));

const red = (r) => assert.equal(r.ok, false, '本应判红却通过了：' + JSON.stringify(r.problems));
const green = (r) => assert.equal(r.ok, true, '本应通过却红了：' + JSON.stringify(r.problems));

/* ---------------- R6：逐字节 ---------------- */

test('R6 抽后两个方法的 body_sha256 与台账（源文件真值）逐个相同', () => {
  const r = checkBodySha(coreText, callLedger);
  green(r);
  assert.equal(EXTRACTED2.length, 2, '本批应恰有 2 个方法');
});

test('R6 台账里两个方法都记了 body_sha256（没记真值就等于没验）', () => {
  for (const name of EXTRACTED2) {
    const rec = callLedger.candidates[name];
    assert.ok(rec, '台账缺 ' + name);
    assert.match(rec.body_sha256, /^[0-9a-f]{64}$/, name + ' 的 body_sha256 不是 64 位 hex');
    assert.match(rec.source_range, /^L\d+-L\d+$/, name + ' 的源行区间格式不对');
  }
});

test('R6 取到的方法体确实是 561 / 544 行（行数也对账）', () => {
  for (const name of EXTRACTED2) {
    const body = bodyOf(coreText, name);
    assert.ok(body, '取不到 ' + name);
    assert.equal(body.split('\n').length, callLedger.candidates[name].body_lines, name + ' 行数不符');
  }
});

test('R6 负控制①：方法体里多一个空格 → 判红（拆不许顺手改逻辑）', () => {
  const broken = coreText.replace('const callStartEpoch', 'const  callStartEpoch');
  assert.notEqual(broken, coreText, '负控制没生效：替换目标不存在');
  red(checkBodySha(broken, callLedger));
});

test('R6 负控制②：台账漏记 body_sha256 → 判红', () => {
  const broken = { candidates: { showVideoCallInterface: {}, showVoiceCallInterface: {} } };
  red(checkBodySha(coreText, broken));
});

test('R6 负控制③：把一个字符换掉（数字 21:30 → 21:31）→ 判红', () => {
  const broken = coreText.replace("'21:30'", "'21:31'");
  assert.notEqual(broken, coreText, '负控制没生效：默认时间串不存在');
  red(checkBodySha(broken, callLedger));
});

/* ---------------- R7：单份实现 ---------------- */

test('R7 两个方法：内核各 1 次 / 视图 0 次', () => {
  green(checkSingleImplementation2(coreText, viewText));
  for (const name of EXTRACTED2) {
    assert.equal(countDefs(coreText, name), 1, name + ' 在内核里不是 1 次');
    assert.equal(countDefs(viewText, name), 0, name + ' 在视图里还有实现');
  }
});

test('R7 负控制①：把方法定义塞回 chat-view.js → 判红（第二份实现复活）', () => {
  const broken = viewText + '\n    showVideoCallInterface(contact, aiFirstMessage) {\n    }\n';
  red(checkSingleImplementation2(coreText, broken));
});

test('R7 负控制②：内核里多塞一个未登记的方法 → 判红', () => {
  const broken = coreText.replace('export const chatCallCore = {', 'export const chatCallCore = {\n    sneakyCopy(msg) {\n    },');
  assert.notEqual(broken, coreText, '负控制没生效：找不到对象字面量起始');
  red(checkSingleImplementation2(broken, viewText));
});

/* ---------------- R8：混入接得上 ---------------- */

test('R8 import + 末尾 assign + 两处指针注释都在位', () => {
  green(checkMixin2(viewText));
});

test('R8 负控制①：删掉 Object.assign 语句 → 判红', () => {
  const broken = viewText.replace('Object.assign(ChatView.prototype, chatCallCore);', '');
  assert.notEqual(broken, viewText, '负控制没生效：assign 语句不存在');
  red(checkMixin2(broken));
});

test('R8 负控制②：assign 挪到 class 声明之前 → 判红（此时 ChatView 还不存在）', () => {
  const stmt = 'Object.assign(ChatView.prototype, chatCallCore);';
  const moved = stmt + '\n' + viewText.replace(stmt, '');
  red(checkMixin2(moved));
});

test('R8 负控制③：assign 出现 3 处（重复一行）→ 判红', () => {
  const stmt = 'Object.assign(ChatView.prototype, chatCallCore);';
  const doubled = viewText.replace(stmt, stmt + '\n' + stmt);
  red(checkMixin2(doubled));
});

test('R8 负控制④：删掉 import 行 → 判红', () => {
  const broken = viewText
    .split('\n')
    .filter((l) => !l.startsWith("import { chatCallCore }"))
    .join('\n');
  red(checkMixin2(broken));
});

test('R8 负控制⑤：删掉一处指针注释 → 判红（视图里会剩一个空段，没人知道方法去哪了）', () => {
  const broken = viewText.replace('已抽到 ./chat-call-core.js', '已抽到别处');
  red(checkMixin2(broken));
});

/* ---------------- R9：依赖面必须是 0 ---------------- */

test('R9 通话内核的 import 数为 0', () => {
  green(checkCallCoreImports(coreText));
  assert.deepEqual(CALL_CORE_IMPORTS, [], '台账口径应写明「恰好 0 个」');
});

test('R9 负控制①：多引一个依赖 → 判红（说明有人把判定搬进只摆界面的模块）', () => {
  const broken = "import { something } from './x.js';\n" + coreText;
  red(checkCallCoreImports(broken));
});

test('R9 负控制②：出现 require( → 判红', () => {
  const broken = coreText + '\nconst x = require("fs");\n';
  red(checkCallCoreImports(broken));
});

/* ---------------- R4b2：运行时 ---------------- */

test('R4b2 运行时原型上真有这两个通话方法（assign 真跑了，this 仍绑 ChatView）', () => {
  const own = Object.getOwnPropertyNames(ChatView.prototype);
  for (const name of EXTRACTED2) {
    assert.ok(own.includes(name), '原型缺 ' + name);
    assert.equal(typeof ChatView.prototype[name], 'function', name + ' 不是函数');
  }
  assert.ok(!Object.prototype.hasOwnProperty.call(ChatView.prototype, 'chatCallCore'), '不该把内核对象挂到原型上');
});

/* ---------------- 整体：闸进程 rc=0 ---------------- */

test('闸进程整体 rc=0（11 条判据全绿）', () => {
  const r = spawnSync(process.execPath, ['tests/audit/scan_chat_render_split.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  });
  assert.equal(r.status, 0, '闸未通过：\n' + r.stdout + r.stderr);
  assert.ok(!/FAIL/.test(r.stdout), '闸输出里出现 FAIL：\n' + r.stdout);
  assert.match(r.stdout, /通话内核 113[0-9] 行/, '闸输出里应报告通话内核行数');
});

/* ---------------- 行数读数（不设阈值，只防「台账写的行数与实际不符」） ---------------- */

test('行数读数与台账一致（18532 / 1137 口径：文件行数，非 linesOf 口径）', () => {
  const viewFileLines = read(CHAT_VIEW).split('\n').length;
  const coreFileLines = read(CALL_CORE).split('\n').length;
  assert.equal(linesOf(viewText) + 1, viewFileLines, 'linesOf 口径应比文件行数少 1（末尾换行）');
  assert.ok(viewFileLines <= callLedger.view_lines_max + 1, 'chat-view.js 行数超过台账天花板');
  assert.equal(coreFileLines, callLedger.core_lines, '通话内核行数与台账不符');
});
