/**
 * tests/r26_x7_clipboard_dnd.test.mjs — 剪贴板与拖放类型契约判据 [R26-X7]
 *
 * A1 白名单内的组合可以放（五种载荷 × 各自落点）
 * A2 类型不符必须拒，且理由里写清「这里只收什么、你拖的是什么」
 * A3 未登记的落点直接拒（不是默认全收）
 * A4 空载荷拒（拖空白等于清空目标）
 * A5 未知载荷类型抛错（不许当成 text 混过去）
 * A6 剪贴板识别：消息引用 / 纯文本 / 空
 * A7 文案：accept 与 reject 都要能读
 * A8 自检为绿
 * A9 产品面接线：index.js 挂载 + 自检进总表
 * N1 破坏副本：类型不符也放行 ⇒ 拒因消失
 * N2 破坏副本：空载荷不判空 ⇒ 空文本被当成有内容
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DROP_TARGETS,
  TRANSFER_KINDS,
  clipboardDndSelfCheck,
  dropText,
  planDrop,
  sniffClipboard,
} from '../config/clipboard-dnd.js';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'config', 'clipboard-dnd.js'), 'utf8');

test('A1 白名单内的组合可以放', () => {
  assert.deepEqual([...TRANSFER_KINDS], ['text', 'rich-text', 'image', 'files', 'message-ref']);
  assert.ok(planDrop({ kind: 'text', payload: 'hi', target: 'chat-input' }).ok);
  assert.ok(planDrop({ kind: 'files', payload: [{ name: 'a' }], target: 'file-manager' }).ok);
  assert.ok(planDrop({ kind: 'message-ref', payload: { messageId: 'm1' }, target: 'chat-input' }).ok);
  assert.ok(planDrop({ kind: 'image', payload: 'data:image/png;base64,xx', target: 'notes' }).ok);
  assert.deepEqual(DROP_TARGETS.calendar, ['text'], '日历只收纯文本');
});

test('A2 类型不符必须拒且理由可读', () => {
  const r = planDrop({ kind: 'files', payload: [{ name: 'a' }], target: 'calendar' });
  assert.equal(r.ok, false);
  assert.equal(r.action, 'reject');
  assert.ok(r.reason.includes('这里只收'), r.reason);
  assert.ok(r.reason.includes('一段文字'), '要说清这里收什么');
  assert.ok(r.reason.includes('文件'), '要说清你拖的是什么');
});

test('A3 未登记的落点直接拒', () => {
  const r = planDrop({ kind: 'text', payload: 'hi', target: 'nowhere' });
  assert.equal(r.ok, false);
  assert.ok(r.reason.includes('不能放东西'));
  const missing = planDrop({ kind: 'text', payload: 'hi' });
  assert.ok(missing.reason.includes('未知位置'));
});

test('A4 空载荷拒', () => {
  assert.equal(planDrop({ kind: 'text', payload: '   ', target: 'notes' }).ok, false);
  assert.equal(planDrop({ kind: 'files', payload: [], target: 'file-manager' }).ok, false);
  assert.equal(planDrop({ kind: 'message-ref', payload: {}, target: 'chat-input' }).ok, false);
  assert.ok(planDrop({ kind: 'text', payload: '', target: 'notes' }).reason.includes('空的'));
});

test('A5 未知载荷类型抛错', () => {
  assert.throws(() => planDrop({ kind: 'video', payload: 'x', target: 'notes' }), /未知载荷类型/);
});

test('A6 剪贴板识别', () => {
  const ref = sniffClipboard('{"messageId":"m1","text":"早"}');
  assert.equal(ref.kind, 'message-ref');
  assert.equal(ref.payload.messageId, 'm1');
  const plain = sniffClipboard('  早安  ');
  assert.equal(plain.kind, 'text');
  assert.equal(plain.payload, '  早安  ', '原文不许被 trim 掉');
  const broken = sniffClipboard('{"not":"json"');
  assert.equal(broken.kind, 'text', '坏 JSON 按文本走，不许丢');
  assert.equal(sniffClipboard('').kind, null);
  assert.ok(sniffClipboard('').reason.includes('空'));
});

test('A7 文案 accept / reject 都能读', () => {
  assert.ok(dropText(planDrop({ kind: 'text', payload: 'hi', target: 'notes' })).includes('可以放下'));
  const rejected = dropText(planDrop({ kind: 'files', payload: [{ n: 1 }], target: 'notes' }));
  assert.ok(rejected.includes('放不下'));
  assert.ok(rejected.includes('只收'));
  assert.equal(dropText(null), '拖放：没有裁定结果');
});

test('A8 自检为绿', () => {
  const r = clipboardDndSelfCheck();
  assert.equal(r.ok, true, r.sample);
});

test('A9 产品面接线：index.js 挂载 + 自检进总表', () => {
  const indexSrc = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
  assert.match(indexSrc, /import\s*\{[^}]*planDrop[^}]*\}\s*from\s*'\.\/config\/clipboard-dnd\.js'/);
  assert.ok(/VirtualPhone\.clipboardDnd\s*=/.test(indexSrc), '拖放契约必须挂诊断面');
  assert.ok(/['"]_r26X7['"]/.test(indexSrc), '自检必须进启动自检总表 _r26X7');
});

/* ------------------------------ 负控制（确定性破坏） ------------------------------ */

async function loadMutant(replacements, tag) {
  let text = SOURCE;
  for (const [from, to] of replacements) {
    assert.ok(text.includes(from), `负控制锚点失效（源变了要同步改判据）：${from}`);
    text = text.split(from).join(to);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rp_x7_${tag}_`));
  const file = path.join(dir, 'clipboard-dnd.js');
  fs.writeFileSync(file, text, 'utf8');
  return import(pathToFileURL(file).href + `?t=${Date.now()}`);
}

test('N1 破坏：类型不符也放行 ⇒ 拒因消失', async () => {
  const broken = await loadMutant(
    [["if (!accepts.includes(kind)) {", 'if (false) {']],
    'acceptall'
  );
  const r = broken.planDrop({ kind: 'files', payload: [{ name: 'a' }], target: 'calendar' });
  assert.equal(r.ok, true, '破坏后什么都能放进日历（正说明真实现按白名单拒）');
});

test('N2 破坏：空载荷不判空 ⇒ 空文本被当成有内容', async () => {
  const broken = await loadMutant(
    [["if (kind === 'text' || kind === 'rich-text') return String(payload).trim() === '';", "if (kind === 'text' || kind === 'rich-text') return false;"]],
    'emptyascontent'
  );
  const r = broken.planDrop({ kind: 'text', payload: '   ', target: 'notes' });
  assert.equal(r.ok, true, '破坏后空白文本也能放（正说明真实现判空）');
});