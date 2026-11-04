/* ============================================================
 * tests/edit-buffer-live.test.mjs — [第十四期 · R14-O4 输入中的文字跨页面保留]
 *   聊天 / 朋友圈 / 日记 / 日程 四类长输入：打了一半的字不再因为「误返回 / 换 App /
 *   保存失败 / 换会话」而消失。
 *
 * 【为什么这批必须单独立套件（不是 v4170 的重复）】
 *   `config/edit-buffer.js`（v4.18.0 · R4-O5）是**纯函数内核**，五口只接在创作台。
 *   全仓实测：`rg -n 'editBufferKey|saveEditBuffer' apps/ config/` 除创作台外零消费者，
 *   其余长输入仍活在**实例字段**上（`chat-view.this.inputText` / `#moment-text-input` /
 *   `#diary-edit-text` / `#yzp-calendar-memo-input`）—— 关页面、换 App、切会话即丢。
 *   故本项补的是「内核 → 真实 DOM」的唯一适配层 `config/edit-buffer-binding.js`
 *   与四个真实接入点；判据必须落在**适配层行为**上，不能只数 import 有几处。
 *
 * 【验收原文（v14 计划 R14-O4）】
 *   写入未提交文本 → 返回 → 重开逐字恢复；保存失败仍留文字；
 *   A 会话草稿不出现在 B，明确发送后才清。
 *
 * 判据面（五组）：
 *   F 适配层契约：只做适配 / 不裁字 / 挂载只读不写 / 幂等
 *   G 行为：输入即留逐字 / 恢复必须用户点 / settle 只退匹配文字 / 会话隔离
 *   H 四接入点：真接线（import + appId + target 槽）与「清空前才退缓冲」的顺序
 *   I 负控制：真源码定点破坏 ⇒ 同款判据必转红（配原版必真的反向对照）
 *   J 版本与键登记：前缀型登记仍在、键由内核函数派生（不另造第二处前缀）
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const KERNEL_REL = 'config/edit-buffer.js';
const BIND_REL = 'config/edit-buffer-binding.js';
const CHAT_REL = 'apps/wechat/chat-view.js';
const MOMENT_REL = 'apps/wechat/moments-view.js';
const DIARY_REL = 'apps/diary/diary-view.js';
const CAL_REL = 'apps/calendar/calendar-view.js';

const bindSrc = read(BIND_REL);
const kernelSrc = read(KERNEL_REL);
const chatSrc = read(CHAT_REL);
const momentSrc = read(MOMENT_REL);
const diarySrc = read(DIARY_REL);
const calSrc = read(CAL_REL);

const { bindEditBuffer } = await import(pathToFileURL(path.join(ROOT, BIND_REL)).href);
const { editBufferKey, EB_KEY_PREFIX } = await import(pathToFileURL(path.join(ROOT, KERNEL_REL)).href);

/* ── 最小 DOM：只做到「够判」为止（与 tests/_dom_stub.mjs 同口径，但本套件不要 document 单例） ── */
function makeDoc() {
  const made = [];
  const doc = {
    createElement(tag) {
      const node = {
        tagName: String(tag).toUpperCase(),
        className: '',
        textContent: '',
        type: '',
        children: [],
        _attrs: new Map(),
        _handlers: new Map(),
        _removed: false,
        setAttribute(k, v) { node._attrs.set(k, String(v)); },
        getAttribute(k) { return node._attrs.has(k) ? node._attrs.get(k) : null; },
        appendChild(c) { node.children.push(c); return c; },
        remove() { node._removed = true; },
        addEventListener(t, h) { node._handlers.set(t, h); },
        click() { const h = node._handlers.get('click'); if (h) h({ type: 'click' }); }
      };
      made.push(node);
      return node;
    },
    /* 恢复按钮 dispatch 的那一个事件类：只带 type，判据只看「有没有派发」。 */
    defaultView: { Event: class FakeEvent { constructor(type) { this.type = String(type); } } },
    _made: made
  };
  return doc;
}
function makeInput(doc, value = '') {
  const input = {
    value,
    selectionStart: value.length,
    ownerDocument: doc,
    _rubyEditBuffer: undefined,
    _handlers: new Map(),
    _inserted: null,
    _insertedPos: '',
    _fires: [],
    addEventListener(t, h) { input._handlers.set(t, h); },
    insertAdjacentElement(pos, node) { input._insertedPos = pos; input._inserted = node; return node; },
    setSelectionRange(a, b) { input.selectionStart = a; input._caretSelection = b; },
    /* 与真 DOM 同形：派发事件同时触发本节点的 input 监听（恢复按钮走的正是这条）。 */
    dispatchEvent(ev) {
      input._fires.push(ev?.type || '');
      const h = input._handlers.get(ev?.type);
      if (h) h(ev);
      return true;
    },
    fire(type) { const h = input._handlers.get(type); return h ? h({ type }) : undefined; }
  };
  return input;
}
/** 内存 storage：`set()` 返回 Promise（与真 PhoneStorage 的 async 契约同形）。 */
function memStorage(id) {
  const mem = new Map();
  const writes = [];
  return {
    currentConversationId: id,
    get: (k, d) => (mem.has(k) ? mem.get(k) : d),
    set(k, v) {
      writes.push([k, v]);
      if (v === null || v === undefined) mem.delete(k);
      else mem.set(k, v);
      return Promise.resolve();
    },
    _mem: mem,
    _writes: writes,
    raw: (k) => mem.get(k) || '',
    book(k) {
      const raw = mem.get(k);
      return raw ? JSON.parse(raw) : null;
    }
  };
}
/** 一次 input 事件的完整等待（capture 是 async，settle 也是）。 */
const flush = () => new Promise((r) => setImmediate(r));

test('异步存储并发写不同槽时不会丢失先前写入', async () => {
  const doc = makeDoc();
  const storage = memStorage('conv-a');
  storage.set = async (key, value) => {
    await new Promise((resolve) => setImmediate(resolve));
    storage._mem.set(key, value);
  };
  const a = makeInput(doc, '标题');
  const b = makeInput(doc, '12:30');
  const first = bindEditBuffer(storage, 'calendarApp', 'title', a);
  const second = bindEditBuffer(storage, 'calendarApp', 'time', b);
  assert.deepEqual(await Promise.all([first.capture(), second.capture()]), [true, true]);
  const entries = storage.book(editBufferKey('calendarApp')).entries;
  assert.equal(entries.title.text, '标题');
  assert.equal(entries.time.text, '12:30');
});

test('时间输入无选区仍可保存，清空只删除当前槽', async () => {
  const doc = makeDoc();
  const storage = memStorage('conv-a');
  const input = makeInput(doc, '');
  Object.defineProperty(input, 'selectionStart', { get() { throw new Error('unsupported'); } });
  const binding = bindEditBuffer(storage, 'calendarApp', 'time', input);
  input.value = '12:30';
  assert.equal(await binding.capture(), true);
  assert.deepEqual(storage.book(editBufferKey('calendarApp')).entries.time, { text: '12:30', caret: null });
  input.value = '';
  assert.equal(await binding.capture(), true);
  assert.equal(Object.hasOwn(storage.book(editBufferKey('calendarApp')).entries, 'time'), false);
});

test('恢复按钮点击前复核草稿，过期按钮不得覆盖新内容', () => {
  const doc = makeDoc();
  const storage = memStorage('conv-a');
  const key = editBufferKey('diaryApp');
  storage._mem.set(key, JSON.stringify({ schema: 2, chatId: 'conv-a',
    entries: { new: { text: '旧草稿', caret: 2 } } }));
  const input = makeInput(doc, '当前正文');
  bindEditBuffer(storage, 'diaryApp', 'new', input);
  const restore = input._inserted.children[0];
  storage._mem.set(key, JSON.stringify({ schema: 2, chatId: 'conv-a', entries: {} }));
  restore.click();
  assert.equal(input.value, '当前正文', '过期草稿不得覆盖当前输入');
  assert.equal(restore._removed, true, '失效恢复按钮应移除');
});

test('输入变化后旧恢复按钮不能覆盖等待写入的文字', async () => {
  const doc = makeDoc();
  const storage = memStorage('conv-a');
  const key = editBufferKey('diaryApp');
  storage._mem.set(key, JSON.stringify({ schema: 2, chatId: 'conv-a',
    entries: { new: { text: '旧草稿', caret: 2 } } }));
  const input = makeInput(doc, '');
  bindEditBuffer(storage, 'diaryApp', 'new', input);
  const restore = input._inserted.children[0];
  input.value = '新的输入';
  const pending = input.fire('input');
  restore.click();
  assert.equal(input.value, '新的输入');
  await pending;
  assert.equal(storage.book(key).entries.new.text, '新的输入');
});
test('静默写入失败时不声称草稿已写入', async () => {
  const doc = makeDoc();
  const storage = memStorage('conv-a');
  storage.set = async () => {};
  const input = makeInput(doc, '');
  const binding = bindEditBuffer(storage, 'diaryApp', 'new', input);
  input.value = '未保存的文字';
  assert.equal(await binding.capture(), false);
  assert.equal(input.value, '未保存的文字');
  assert.match(input._inserted.textContent, /未确认/);
});

/* ══════════════════ F. 适配层契约 ══════════════════ */
test('F1 适配层只做适配：消费真源三件，不自造前缀、不带定时器/全局监听', () => {
  assert.ok(bindSrc.includes("from './edit-buffer.js'"), '键必须由内核 editBufferKey 派生');
  assert.ok(bindSrc.includes('editBufferKey('), '不得另写一份前缀拼接');
  assert.equal(bindSrc.includes("'/edit_buffer_'") || bindSrc.includes("'edit_buffer_'"), false,
    '前缀只许在内核一处定义');
  assert.ok(bindSrc.includes("from './session-gate.js'"), '会话栅栏必须复用既有栅栏');
  assert.ok(bindSrc.includes('captureSessionToken'), '出发时记令牌');
  assert.ok(bindSrc.includes('guardSessionWrite'), '回信前裁决');
  assert.ok(bindSrc.includes("from './write-receipt.js'"), '落盘必须走唯一写回执');
  assert.ok(bindSrc.includes('writeReceiptAsync('), '落盘走既有的异步回执口');
  /* 零定时器 / 零全局监听：适配层不许自己开计时器或往 window/document 上挂东西。 */
  assert.equal(/setTimeout|setInterval|requestAnimationFrame/.test(bindSrc), false, '不得带定时器');
  assert.equal(/globalThis|window\./.test(bindSrc), false, '不得挂全局监听');
  assert.equal(/document\./.test(bindSrc), false, '只许用 input.ownerDocument，不许取全局 document');
  /* 旧内核的 2000 字上限**不搬到**长输入上（聊天/日记正文远超它）：不许裁。 */
  assert.equal(/EB_TEXT_MAX/.test(bindSrc), false, 'live 输入不套 2000 字上限（正文会超）');
  assert.ok(kernelSrc.includes('export const EB_TEXT_MAX'), '内核仍持有该上限（未删契约）');
  assert.ok(bindSrc.includes('storage.get(key, null) === value'), '必须回读确认当前存储视图');
  assert.ok(bindSrc.includes('持久保存尚未确认'), '不得把内存/回读确认冒充持久落盘');
});

test('F2 挂载只读不写：bind 不落一次盘，且同 input 同 target 幂等', () => {
  const doc = makeDoc();
  const storage = memStorage('conv-a');
  const input = makeInput(doc, '');
  const b = bindEditBuffer(storage, 'chatApp', 'chat:c1', input);
  assert.ok(b, '必须返回句柄');
  assert.equal(storage._writes.length, 0, '挂载这一刻一个字都不许写');
  assert.equal(b.key, editBufferKey('chatApp'), '键来自内核函数');
  assert.equal(b.target, 'chat:c1');
  assert.equal(typeof b.capture, 'function');
  assert.equal(typeof b.settle, 'function');
  assert.ok(input._inserted, '必须在输入框后面挂一个状态位（用户要看得到「留没留住」）');
  assert.equal(input._insertedPos, 'afterend');
  /* 重复挂载（重画后同一节点复绑）不得叠加第二个状态位。 */
  const again = bindEditBuffer(storage, 'chatApp', 'chat:c1', input);
  assert.equal(again, b, '同会话同 target 必须复用同一句柄');
  assert.equal(doc._made.length, 1, '不得重复造状态位节点');
  /* 空 target / 没身份 ⇒ 如实不接（不是接一个不落盘的假句柄）。 */
  assert.equal(bindEditBuffer(storage, 'chatApp', '', input), null, '空槽不接');
  assert.equal(bindEditBuffer(storage, 'chatApp', 'chat:c1', null), null, '没节点不接');
  const anonymous = memStorage('');
  assert.equal(bindEditBuffer(anonymous, 'chatApp', 'chat:c1', makeInput(doc, '')), null,
    '拿不到会话身份必须 fail-closed（不接一个会串会话的缓冲）');
});

/* ══════════════════ G. 行为（验收三条旅程） ══════════════════ */
test('G1 输入即保留：逐字落盘、光标同存、超长不截', async () => {
  const doc = makeDoc();
  const storage = memStorage('conv-a');
  const long = '长'.repeat(2500) + '\n第二段';
  const input = makeInput(doc, '');
  bindEditBuffer(storage, 'diaryApp', 'new', input);
  input.value = long;
  input.selectionStart = 7;
  await input.fire('input');
  await flush();
  const book = storage.book(editBufferKey('diaryApp'));
  assert.ok(book, '必须真落盘');
  assert.equal(book.schema, 2, '结构版本必须显式（旧值不可当新值读）');
  assert.equal(book.chatId, 'conv-a', '落盘必须带会话身份');
  const entry = book.entries.new;
  assert.equal(entry.text, long, '2500 字必须逐字保留（不裁）');
  assert.equal(entry.caret, 7, '光标位置同存');
  assert.equal(storage._writes.length, 1, '一次输入一次落盘（未做节流是刻意：长输入按键入落盘，量小）');
});

test('G2 重开必须用户点：不自动覆盖，点后逐字恢复并还原光标', async () => {
  const doc = makeDoc();
  const storage = memStorage('conv-a');
  const key = editBufferKey('diaryApp');
  storage._mem.set(key, JSON.stringify({
    schema: 2,
    chatId: 'conv-a',
    entries: { 'edit:e1': { text: '半截图：她还没说完', caret: 4 } }
  }));
  const input = makeInput(doc, '模板正文');
  bindEditBuffer(storage, 'diaryApp', 'edit:e1', input);
  /* 红线一：装页面**不许**动输入框里的字。 */
  assert.equal(input.value, '模板正文', '恢复不许自动覆盖当前内容');
  assert.equal(storage._writes.length, 0, '装页面也不许写盘');
  const status = input._inserted;
  const restore = status.children.find((n) => n.textContent === '恢复未提交文字');
  assert.ok(restore, '必须给出可见的「恢复未提交文字」入口');
  assert.equal(restore.type, 'button', '必须是真按钮（可点、可聚焦）');
  /* 点它 ⇒ 逐字恢复 + 光标复原 + 派发 input（让视图自己的状态跟上）。 */
  restore.click();
  assert.equal(input.value, '半截图：她还没说完', '逐字恢复');
  assert.equal(input.selectionStart, 4, '光标复原');
  assert.deepEqual(input._fires, ['input'], '恢复后必须派一次 input 让视图侧同步');
  assert.equal(restore._removed, true, '用过的恢复入口必须撤掉（不许点第二次装成新动作）');
});

test('G3 settle 只退「本次提交的那一段文字」，失败/不匹配一律留着', async () => {
  const doc = makeDoc();
  const storage = memStorage('conv-a');
  const key = editBufferKey('wechatApp');
  storage._mem.set(key, JSON.stringify({
    schema: 2,
    chatId: 'conv-a',
    entries: {
      'moment:new': { text: '另一槽不该被动', caret: 0 },
      'chat:c1': { text: '发出去的这一句', caret: 0 }
    }
  }));
  const input = makeInput(doc, '发出去的这一句');
  const b = bindEditBuffer(storage, 'wechatApp', 'chat:c1', input);
  /* ① 保存失败 ⇒ 不许清。 */
  assert.equal(await b.settle({ saved: false, why: 'quota' }, '发出去的这一句'), false, '失败不许清缓冲');
  assert.equal(storage.book(key).entries['chat:c1'].text, '发出去的这一句', '失败必须留着');
  /* ② 回执读不出 ⇒ 也不许清（宁可留着）。 */
  assert.equal(await b.settle(null, '发出去的这一句'), false);
  assert.equal(await b.settle({ saved: 'yes' }, '发出去的这一句'), false);
  assert.ok(storage.book(key).entries['chat:c1'], '回执不明必须留着');
  /* ③ 文字不匹配（编辑器里已被改过）⇒ 不许清：清掉就等于删了别人的新字。 */
  assert.equal(await b.settle({ saved: true }, '发出去的这一句（改过）'), false);
  assert.ok(storage.book(key).entries['chat:c1'], '不匹配必须留着');
  /* ④ 成功且逐字匹配 ⇒ 只退这一槽。 */
  assert.equal(await b.settle({ saved: true }, '发出去的这一句'), true);
  const after = storage.book(key).entries;
  assert.equal(Object.hasOwn(after, 'chat:c1'), false, '本槽必须退掉');
  assert.equal(after['moment:new'].text, '另一槽不该被动', '别的槽一格不许动');
});

test('G4 会话隔离：A 的草稿不出现在 B，且切走后旧回信不落盘', async () => {
  const doc = makeDoc();
  const a = memStorage('conv-a');
  const inputA = makeInput(doc, '');
  bindEditBuffer(a, 'wechatApp', 'chat:c1', inputA);
  inputA.value = 'A 会话里的半句';
  await inputA.fire('input');
  await flush();
  /* B 会话：同一 App、同一 target —— 草稿**不许**跟过来。 */
  const b = memStorage('conv-b');
  const inputB = makeInput(doc, '');
  bindEditBuffer(b, 'wechatApp', 'chat:c1', inputB);
  assert.equal(inputB.value, '', 'B 会话不许带着 A 的草稿开页');
  assert.equal(inputB._inserted.children.length, 0, 'B 会话不许出现「恢复 A 的草稿」入口');
  /* 宿主原地换会话（没重画）：旧句柄此后既不写也不退。 */
  a.currentConversationId = 'conv-b';
  const writesBefore = a._writes.length;
  assert.equal(await inputA.fire('input'), false, '换会话后键入不许再落盘');
  assert.equal(a._writes.length, writesBefore, '换会话后一格都不许写');
  assert.equal(await inputA._rubyEditBuffer.settle({ saved: true }, 'A 会话里的半句'), false,
    '换会话后旧缓冲不许被清（那是 A 的数据）');
  /* 落盘仍停在 A 名下，未被改写。 */
  assert.equal(a.book(editBufferKey('wechatApp')).chatId, 'conv-a', 'A 的存档不许被换成 B 的身份');
});

/* ══════════════════ H. 四接入点真接线 ══════════════════ */
test('H1 聊天：绑定 #chat-input，先退缓冲再清输入框', () => {
  assert.ok(chatSrc.includes("from '../../config/edit-buffer-binding.js'"), '必须消费适配层');
  assert.ok(chatSrc.includes("bindEditBuffer(this.app.storage, 'wechatApp', 'chat:' + this.app.currentChat?.id, input)"),
    '绑定必须用「会话 + 聊天」二级槽');
  /* 顺序：settle 必须在 `input.value = ''` **之前** —— 反了就拿着空串去比对，永远退不掉。 */
  const settleAt = chatSrc.indexOf("input._rubyEditBuffer?.settle(receipt, submittedText);");
  assert.ok(settleAt > 0, '发送成功路径必须退缓冲');
  const clearAt = chatSrc.indexOf("input.value = '';", settleAt);
  assert.ok(clearAt > settleAt, '必须先退缓冲、再清输入框');
  assert.ok(chatSrc.includes('_inputBufferScope'), '实例态必须按会话+聊天分槽（跨聊天不许串味）');
});

test('H2 朋友圈：#moment-text-input 用独立槽，发布成功才退', () => {
  assert.ok(momentSrc.includes("from '../../config/edit-buffer-binding.js'"));
  assert.ok(momentSrc.includes("bindEditBuffer(this.app.storage, 'wechatApp', 'moment:new', document.getElementById('moment-text-input'))"),
    '发布页必须绑定 #moment-text-input');
  /* settle 必须在 addMoment 之后（真落库了才退）。 */
  const addAt = momentSrc.indexOf('this.app.wechatData.addMoment(moment);');
  const settleAt = momentSrc.indexOf("textInput?._rubyEditBuffer?.settle(receipt, submittedText);");
  assert.ok(addAt > 0 && settleAt > addAt, '必须先真发布、再退缓冲');
});

test('H3 日记：编辑槽按条目分、新建槽独立；保存失败弹明话且**留在页面**', () => {
  assert.ok(diarySrc.includes("from '../../config/edit-buffer-binding.js'"));
  assert.ok(diarySrc.includes("bindEditBuffer(this.app.storage, 'diaryApp', 'edit:' + this._editingEntryId, editor)"),
    '编辑态必须按条目 id 分槽（否则 A 篇的半截会贴到 B 篇）');
  assert.ok(diarySrc.includes("bindEditBuffer(this.app.storage, 'diaryApp', 'new', document.getElementById('diary-new-text'))"),
    '新建态独立槽');
  /* 保存失败：必须 `saved !== true` 判、必须有可读提示、必须 return（不许走 closeEditor 把页面关掉）。 */
  const saveBody = diarySrc.slice(diarySrc.indexOf('if (saveBtn) saveBtn.onclick'), diarySrc.indexOf('_bindNewEntryEvents()'));
  assert.ok(saveBody.includes('const saved = this.app.diaryData.updateEntryContent('), '必须读真写口回执');
  assert.ok(saveBody.includes("if (saved !== true) { alert('保存失败，文字仍保留'); return; }"),
    '失败必须给明话并留在页面（关掉页面 = 文字没了）');
  assert.equal(saveBody.indexOf('closeEditor();') > saveBody.indexOf('if (saved !== true)'), true,
    'closeEditor 只许落在成功之后');
  /* 新建：没拿到 id 就是没落库，不许 settle。 */
  assert.ok(diarySrc.includes("if (!entry?.id) throw new Error('未收到保存回执');"), '新建必须校验回执');
});

test('H4 日程：四槽（新建/编辑 × 标题/时间）各自独立，保存成功才退', () => {
  assert.ok(calSrc.includes("from '../../config/edit-buffer-binding.js'"));
  for (const slot of ["'new:' + this.toDateKey(this.selectedDate) + ':title'",
    "'new:' + this.toDateKey(this.selectedDate) + ':time'",
    "'edit:' + this.detailMemoId + ':title'",
    "'edit:' + this.detailMemoId + ':time'"]) {
    assert.ok(calSrc.includes(slot), '必须有槽：' + slot);
  }
  assert.ok(calSrc.includes("bindEditBuffer(this.app.storage, 'calendarApp', target, input)"), '循环绑定必须真调适配层');
  const settles = calSrc.split("?.settle(receipt").length - 1;
  assert.equal(settles, 4, '四条成功路径各退一次（新建 2 + 编辑 2），实测 ' + settles);
});

/* ══════════════════ I. 负控制（真源码破坏 ⇒ 同款判据必转红） ══════════════════ */
function breakOnce(src, anchor, replacement, tag) {
  const hits = src.split(anchor).length - 1;
  assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + tag);
  return src.replace(anchor, replacement);
}

test('I0 ★★★ 阳性对照：未破坏时五条签名必须全为真（否则 I 组是假绿）', () => {
  assert.ok(bindSrc.includes('|| entries[target]?.text !== submittedText'), 'settle 必须比对文字');
  assert.ok(bindSrc.includes('if (!current()) return false;'), 'capture/settle 必须先过会话栅栏');
  assert.ok(bindSrc.includes("if (book?.schema !== 2 || book.chatId !== token.id"), '读侧必须核会话身份');
  assert.ok(diarySrc.includes("alert('保存失败，文字仍保留')"), '日记失败必须留明话');
  assert.ok(chatSrc.includes('if (this._inputBufferScope !== scope)'), '聊天实例态必须分槽');
});

test('I1 ★★★ 破坏「settle 只退匹配文字」⇒ 同款判据必转红（会把别人的新字删掉）', () => {
  const broken = breakOnce(bindSrc, '|| entries[target]?.text !== submittedText', '|| false', 'i1');
  assert.equal(broken.includes('entries[target]?.text !== submittedText'), false, '破坏副本：已不比对文字');
  assert.ok(bindSrc.includes('entries[target]?.text !== submittedText'), '原版必须比对');
});

test('I2 ★★★ 破坏「会话栅栏」⇒ 同款判据必转红（A 的字会写进 B 的桶）', () => {
  const broken = breakOnce(bindSrc, '        if (!current()) return false;\n        const rev = ++revision;',
    '        const rev = ++revision;', 'i2');
  assert.equal(broken.includes('if (!current()) return false;\n        const rev = ++revision;'), false,
    '破坏副本：capture 已不过栅栏');
  assert.equal(/if \(!current\(\)\) return false;/.test(broken), true, 'settle 那道还在（单点破坏）');
  assert.ok(bindSrc.includes('if (!current()) return false;\n        const rev = ++revision;'), '原版必须过栅栏');
});

test('I3 ★★★ 破坏「读侧核会话身份」⇒ 同款判据必转红（B 会话读到 A 的草稿）', () => {
  const broken = breakOnce(bindSrc, 'book.chatId !== token.id', 'false', 'i3');
  assert.equal(broken.includes('book.chatId !== token.id'), false, '破坏副本：已不核会话');
  assert.ok(bindSrc.includes('book.chatId !== token.id'), '原版必须核');
});

test('I4 ★★★ 破坏「日记保存失败留明话」⇒ 同款判据必转红（静默关页=文字没了）', () => {
  const broken = breakOnce(diarySrc, "if (saved !== true) { alert('保存失败，文字仍保留'); return; }",
    "if (saved !== true) { }", 'i4');
  assert.equal(broken.includes("alert('保存失败，文字仍保留')"), false, '破坏副本：已不留明话');
  assert.ok(diarySrc.includes("alert('保存失败，文字仍保留')"), '原版必须留');
});

test('I5 聊天仅在确认后清理且按提交快照匹配', () => {
  const confirmAt = chatSrc.indexOf('await confirmEditOwner(', chatSrc.indexOf('async handleSendClick'));
  const settleAt = chatSrc.indexOf('settle(receipt, submittedText)', confirmAt);
  const clearAt = chatSrc.indexOf("input.value = '';", settleAt);
  assert.ok(confirmAt > 0 && settleAt > confirmAt && clearAt > settleAt);
  assert.ok(chatSrc.slice(confirmAt, settleAt).includes('if (!receipt.saved)'));
});
/* ══════════════════ J. 键与登记 ══════════════════ */
test('J1 键登记：前缀型仍在，且四个 appId 都从内核派生出真键', () => {
  const keysSrc = read('scripts/keys-audit.mjs');
  assert.ok(keysSrc.includes("{ key: 'edit_buffer_*', scope: 'chat'"), '登记必须是前缀型');
  for (const appId of ['wechatApp', 'diaryApp', 'calendarApp', 'creationdeskApp']) {
    const k = editBufferKey(appId);
    assert.equal(k, EB_KEY_PREFIX + appId, appId + ' 的键必须由前缀派生');
    assert.ok(k.startsWith('edit_buffer_'), '必须撞上已登记的 /^edit_/ 会话前缀');
  }
  assert.equal(editBufferKey('  '), '', '空 appId 不许造键（否则会出现 edit_buffer_ 这种公共桶）');
});
