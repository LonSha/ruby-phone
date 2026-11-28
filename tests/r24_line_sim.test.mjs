/**
 * tests/r24_line_sim.test.mjs — LINE 仿真（第 2/3 层最后一件）数据面 + 接线面判据 [v4.159.0]
 *
 * 为什么这一件单独有判据：第 2/3 层清单里其余七件（桃宝 / 恋爱空间 / 约会 / 游戏厅 /
 *   老福特 / Pixiv / 杂志）都已落地并有各自判据，**只剩 LINE**；而 LINE 的四条机制
 *   （三态房间 / 环形上限 / 读游标式已读 / 静态贴图表）恰好每一条都有「做成假的很省事」的写法，
 *   所以每条都要有可观测读数，而不是「模块在盘就算交付」。
 *
 * A1  归一：坏行丢掉且 dropped 留痕；每房间环形裁到上限
 * A2  上限是读数：LINE_LIMITS 的五个数被真判据钉住（改小改大都要改本档）
 * A3  三态不塌：storage_absent / empty / ready 三个值是三个不同的稳定串
 * A4  未读走读游标：游标推到末条后为 0；**游标不在列表里（被环形裁掉）⇒ 如实算全未读**
 * A5  官方号默认不算未读，开关打开后照算（两个读数互不相同）
 * A6  撤回是留痕不是删除：条目还在、recalled=true、重复撤回被拒
 * A7  正文超上限截断且留 truncated 痕（不静默切）
 * A8  会话数到上限后拒建，且**带人话原因**（不是返回空）
 * A9  时间线只出**引用**：行里没有 text / sticker 正文字段
 * A10 注入块：开关关掉就是空串；打开时只出事实（房间名 + 说话人 + 多久之前）
 * A11 产品面接线六处齐：APPS / 懒加载路由 / 存储前缀 / 键登记两键 / REBIND 表 / v3 皮肤登记
 * A12 纪律面：line-*.js 零网络、零定时器、零数据库、零宿主角色对象
 * N1  破坏副本：游标找不到时返回 0 ⇒ 「消息被裁掉」被装成「都读过了」
 * N2  破坏副本：撤回改成 splice 删除 ⇒ 「撤回过」这件事查不到了
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  LINE_REASONS, LINE_LIMITS, LINE_KINDS,
  emptyLineState, normalizeLineState, hasAny, readLineFace,
  upsertRoom, appendMessage, recallMessage, markRead, removeRoom,
  unreadOf, unreadTotal, timelineOf, projectLine, linePromptBlock,
  defaultLineSettings, normalizeLineSettings, describeKind, stickerById,
} from '../apps/line/line-data.js';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const DATA_SRC = read('apps/line/line-data.js');

const mkMsg = (id, from, text, ts) => ({ id, from, text, ts });
function withRoom(room, msgs) {
  const r = upsertRoom(emptyLineState(), room);
  assert.equal(r.ok, true, '建房间必须成功：' + JSON.stringify(r));
  let st = r.state;
  for (const m of msgs) {
    const a = appendMessage(st, room.id, m);
    assert.equal(a.ok, true, '追加必须成功：' + JSON.stringify(a));
    st = a.state;
  }
  return st;
}

test('A1 归一：坏行丢掉且 dropped 留痕；环形裁到上限', () => {
  const raw = {
    rooms: [
      {
        id: 'dm-aki', name: '秋', kind: 'dm', messages: [
          mkMsg('m1', '秋', '在吗', 1000),
          { id: '', from: '秋', text: '没有 id' },
          { id: 'm2', from: '', text: '没有署名' },
          { id: 'm3', from: '秋', text: '', sticker: '' },
          mkMsg('m4', '秋', '你好', 2000),
        ],
      },
      { id: '', name: '没有 id 的房间' },
      { id: 'dm-aki', name: '重复 id' },
    ],
  };
  const st = normalizeLineState(raw);
  assert.equal(st.rooms.length, 1, '重复 id 与空 id 的房间要丢掉');
  assert.deepEqual(st.rooms[0].messages.map((m) => m.id), ['m1', 'm4']);
  const many = [];
  for (let i = 0; i < LINE_LIMITS.messages + 5; i += 1) many.push(mkMsg('x' + i, '秋', 'r' + i, i));
  const st2 = normalizeLineState({ rooms: [{ id: 'r', kind: 'dm', messages: many }] });
  assert.equal(st2.rooms[0].messages.length, LINE_LIMITS.messages);
  assert.equal(st2.rooms[0].dropped, 5, '被裁掉的条数必须留痕');
  assert.equal(st2.rooms[0].messages[st2.rooms[0].messages.length - 1].id, 'x' + (LINE_LIMITS.messages + 4), '环形裁的是最早的');
});

test('A2 上限是读数（五个数都被钉住）', () => {
  assert.deepEqual({ ...LINE_LIMITS }, { rooms: 24, messages: 200, text: 1000, members: 12, timeline: 10 });
  assert.deepEqual([...LINE_KINDS], ['dm', 'group', 'official']);
});

test('A3 三态不塌：三个值是三个不同的稳定串', () => {
  const a = readLineFace({ storageOk: false, hasAny: true });
  const b = readLineFace({ storageOk: true, hasAny: false });
  const c = readLineFace({ storageOk: true, hasAny: true });
  assert.equal(a, LINE_REASONS.storage_absent);
  assert.equal(b, LINE_REASONS.empty);
  assert.equal(c, LINE_REASONS.ready);
  assert.equal(new Set([a, b, c]).size, 3, '三态文案不许塌成同一个');
  assert.equal(hasAny(emptyLineState()), false);
  assert.equal(hasAny({ rooms: [{ id: 'x' }] }), true);
  assert.equal(describeKind('nope'), '未知类型', '未知类型不猜');
});

test('A4 未读走读游标：推到末条为 0；游标不在列表里 ⇒ 全算未读', () => {
  let st = withRoom({ id: 'dm-aki', name: '秋', kind: 'dm' }, [
    mkMsg('m1', '秋', '在吗', 1000),
    mkMsg('m2', '秋', '在吗？', 2000),
    mkMsg('m3', '秋', '喂', 3000),
  ]);
  const s = defaultLineSettings();
  assert.equal(unreadOf(st, st.rooms[0], s), 3, '没读过 ⇒ 全未读');
  const mr = markRead(st, 'dm-aki');
  assert.equal(mr.ok, true);
  st = mr.state;
  assert.equal(unreadOf(st, st.rooms[0], s), 0, '推到末条 ⇒ 0');
  assert.equal(markRead(st, 'dm-aki').ok, false, '没有新消息时再标已读要被拒（不是静默成功）');
  const ap = appendMessage(st, 'dm-aki', mkMsg('m4', '秋', '走了', 4000));
  st = ap.state;
  assert.equal(unreadOf(st, st.rooms[0], s), 1, '只算游标之后那一条');
  /* 游标被环形裁掉：把 readUpTo 指向一条不在列表里的 id */
  const ghost = normalizeLineState({
    rooms: [{ id: 'g', kind: 'dm', readUpTo: 'gone', messages: [mkMsg('g1', '秋', 'a', 1), mkMsg('g2', '秋', 'b', 2)] }],
  });
  assert.equal(unreadOf(ghost, ghost.rooms[0], s), 2, '游标找不到 ⇒ 如实算全未读（不装作已读）');
});

test('A5 官方号默认不算未读，开关打开后照算', () => {
  const st = withRoom({ id: 'of-ln', name: 'LINE 官方', kind: 'official' }, [mkMsg('o1', '官方', '活动', 1000)]);
  const off = normalizeLineSettings({ officialUnread: false });
  const on = normalizeLineSettings({ officialUnread: true });
  assert.equal(unreadOf(st, st.rooms[0], off), 0);
  assert.equal(unreadOf(st, st.rooms[0], on), 1, '开关必须真的改读数');
  assert.notEqual(unreadOf(st, st.rooms[0], off), unreadOf(st, st.rooms[0], on));
});

test('A6 撤回是留痕不是删除', () => {
  let st = withRoom({ id: 'dm-aki', name: '秋', kind: 'dm' }, [mkMsg('m1', '秋', '说错话了', 1000)]);
  const rc = recallMessage(st, 'dm-aki', 'm1');
  assert.equal(rc.ok, true);
  st = rc.state;
  assert.equal(st.rooms[0].messages.length, 1, '条目必须还在（删了就没有「撤回」可读）');
  assert.equal(st.rooms[0].messages[0].recalled, true);
  assert.equal(recallMessage(st, 'dm-aki', 'm1').ok, false, '重复撤回要被拒');
  assert.equal(recallMessage(st, 'dm-aki', 'nope').ok, false, '没有这条要被拒');
});

test('A7 正文超上限截断且留痕', () => {
  const long = 'x'.repeat(LINE_LIMITS.text + 7);
  const st = withRoom({ id: 'dm-aki', name: '秋', kind: 'dm' }, [mkMsg('m1', '秋', long, 1000)]);
  const m = st.rooms[0].messages[0];
  assert.equal(m.text.length, LINE_LIMITS.text);
  assert.equal(m.truncated, true, '截断必须留痕，不许静默切');
});

test('A8 会话数到上限拒建且带人话原因', () => {
  let st = emptyLineState();
  for (let i = 0; i < LINE_LIMITS.rooms; i += 1) {
    const r = upsertRoom(st, { id: 'r' + i, name: 'r' + i, kind: 'dm' });
    assert.equal(r.ok, true);
    st = r.state;
  }
  const over = upsertRoom(st, { id: 'r-over', name: 'over', kind: 'dm' });
  assert.equal(over.ok, false);
  assert.ok(typeof over.error === 'string' && over.error.includes(String(LINE_LIMITS.rooms)), '原因要点明上限：' + over.error);
  const bad = upsertRoom(st, { name: '没有 id' });
  assert.equal(bad.ok, false);
  assert.ok(bad.error && bad.error.length > 0, '坏入参也要有人话原因');
  /* 改已有会话不受上限影响 */
  const edit = upsertRoom(st, { id: 'r0', name: '改名了' });
  assert.equal(edit.ok, true, '改已存在的会话不该被上限挡住');
  const rm = removeRoom(st, 'r0');
  assert.equal(rm.removed, true);
  assert.equal(removeRoom(st, 'nope').removed, false, '本来就没有不算错');
});

test('A9 时间线只出引用（不带正文字段）', () => {
  const st = withRoom({ id: 'dm-aki', name: '秋', kind: 'dm' }, [mkMsg('m1', '秋', 'secret body', 1000)]);
  const rows = timelineOf(st, 10);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].roomId, 'dm-aki');
  assert.equal(rows[0].msgId, 'm1');
  assert.equal(rows[0].text, undefined, '时间线不许复制正文');
  assert.equal(rows[0].sticker, undefined);
  const proj = projectLine(st, defaultLineSettings(), 5000);
  assert.equal(proj.timeline.length, 1);
  assert.equal(proj.timeline[0].text, undefined);
  assert.equal(proj.rooms[0].last.text, 'secret body', '正文只在房间里出现一次');
});

test('A10 注入块：关掉是空串，打开只出事实', () => {
  const st = withRoom({ id: 'dm-aki', name: '秋', kind: 'dm' }, [mkMsg('m1', '秋', '今晚见', Date.now())]);
  const proj = projectLine(st, defaultLineSettings(), Date.now());
  assert.equal(linePromptBlock(proj, normalizeLineSettings({ injectToPrompt: false })), '');
  const blk = linePromptBlock(proj, normalizeLineSettings({ injectToPrompt: true }));
  assert.ok(blk.includes('秋'), '要写出会话名');
  assert.ok(blk.includes('今晚见'), '要写出真实说过的内容');
  assert.ok(blk.includes('LINE 会话近况'), '要有块头');
  assert.equal(linePromptBlock(projectLine(emptyLineState(), defaultLineSettings(), 1), defaultLineSettings()), '', '没有会话就不注入');
});

test('A11 产品面接线六处齐', () => {
  const apps = read('config/apps.js');
  assert.ok(/id: 'line',/.test(apps), 'APPS 要有 line 图标');
  const lazy = read('config/app-lazy-routes.js');
  assert.ok(/id: "line", module: "\.\/apps\/line\/line-app\.js", key: "lineApp", cls: "LineApp"/.test(lazy), '懒加载路由要在表里');
  const stor = read('config/storage.js');
  assert.ok(/\/\^line_\//.test(stor), '会话键前缀 /^line_/ 要在 CHAT_DATA_PATTERNS 里');
  const keys = read('scripts/keys-audit.mjs');
  assert.ok(/key: 'line_settings'/.test(keys) && /key: 'line_state'/.test(keys), '两个会话键都要登记');
  const idx = read('index.js');
  assert.ok(/'lineApp'/.test(idx), 'REBIND 表要有 lineApp（换会话必须重取）');
  const skin = read('config/style-skin-v3.js');
  assert.ok(/appId: "line", css: "\.\/apps\/line\/line\.v3\.css"/.test(skin), 'v3 皮肤要登记');
  const phoneCss = read('phone.css');
  assert.ok(/\.ln-root/.test(phoneCss), '默认皮肤要被打包进 phone.css（否则列表裸奔）');
  const lib = read('config/app-library.js');
  assert.ok(/line: 'social'/.test(lib), '库类目要登记（缺登记会静默 fallback system）');
});

test('A12 纪律面：零网络 / 零定时器 / 零数据库 / 零宿主角色对象', () => {
  for (const f of ['apps/line/line-data.js', 'apps/line/line-app.js', 'apps/line/line-view.js']) {
    const src = read(f);
    for (const bad of ['fetch(', 'XMLHttpRequest', 'setTimeout', 'setInterval', 'requestAnimationFrame',
      'querySql', 'executeSql', 'indexedDB', 'characters[', 'characters.']) {
      assert.equal(src.includes(bad), false, f + ' 不许出现 ' + bad);
    }
    assert.equal(/(^|[^a-z])http:\/\//.test(src), false, f + ' 不许出现 http 资源地址');
  }
});

/* ---------- 负控制：破坏副本必须让上面的判据变红 ---------- */
function loadMutant(replacements, tag) {
  let src = DATA_SRC;
  for (const [from, to] of replacements) {
    assert.ok(src.includes(from), '负控制锚点不存在（判据与本档脱钩）：' + from);
    src = src.replace(from, to);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_line_' + tag + '_'));
  /* 落点必须与真仓同相对深度：line-data.js 在 apps/line/ 下，import '../../config/num-gate.js'
   *   才会解析到本夹具的 config/（直接放在 dir 根上会解析成 /config/num-gate.js —— 实测踩到
   *   ERR_MODULE_NOT_FOUND，负控制变成「加载失败」而不是「判据变红」）。 */
  const appDir = path.join(dir, 'apps', 'line');
  fs.mkdirSync(appDir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  const file = path.join(appDir, 'line-data.js');
  fs.writeFileSync(file, src, 'utf8');
  fs.copyFileSync(path.join(ROOT, 'config', 'num-gate.js'), path.join(dir, 'config', 'num-gate.js'));
  fs.copyFileSync(path.join(ROOT, 'config', 'local-calendar.js'), path.join(dir, 'config', 'local-calendar.js'));
  return import(pathToFileURL(file).href + `?t=${Date.now()}`);
}

test('N1 破坏：游标找不到时返回 0 ⇒ 把「消息被裁掉」装成「都读过了」', async () => {
  const broken = await loadMutant([['    if (at < 0) return msgs.length;', '    if (at < 0) return 0;']], 'ghost');
  const ghost = broken.normalizeLineState({
    rooms: [{ id: 'g', kind: 'dm', readUpTo: 'gone', messages: [mkMsg('g1', '秋', 'a', 1), mkMsg('g2', '秋', 'b', 2)] }],
  });
  const s = broken.normalizeLineSettings({});
  assert.equal(broken.unreadOf(ghost, ghost.rooms[0], s), 0, '破坏后谎报已读（正说明真实现如实算全未读）');
});

test('N2 破坏：撤回改成删除 ⇒ 「撤回过」这件事查不到了', async () => {
  const broken = await loadMutant([[ 'messages[mi] = Object.assign({}, messages[mi], { recalled: true });', 'messages.splice(mi, 1);' ]], 'splice');
  let st = broken.upsertRoom(broken.emptyLineState(), { id: 'dm-aki', name: '秋', kind: 'dm' }).state;
  st = broken.appendMessage(st, 'dm-aki', mkMsg('m1', '秋', '说错话了', 1000)).state;
  const rc = broken.recallMessage(st, 'dm-aki', 'm1');
  assert.equal(rc.ok, true);
  assert.equal(rc.state.rooms[0].messages.length, 0, '破坏后条目消失（正说明真实现只标记不删）');
});