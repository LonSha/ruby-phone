// R28-O1 视图资源与焦点纪律（判据本体）
// 为什么单独立一条：v4.182 ~ v4.184 这轮把 18 个千行视图逐件过了一遍，扫了三条轴
//   （宿主级监听 / 元素级重绑 / 媒体与 blob URL / 输入焦点）。结论是这三条轴当时都干净，
//   但「干净」是人工看出来的，没人守着 —— 下次抬版没人会再过一遍。本判据把这三条变成常驻的红线。
// 纪律：
//   ① 输入回调体内不许重建含输入控件的片段：用户正在打字，片段一重建，焦点/光标/选区一起没。
//      要改读数就**就地改**（reading 的 _paintProgress 是范本），别整块重建。
//   ② createObjectURL 必须有配对的 revokeObjectURL：blob URL 不释放，长会话里是实打实的累积。
//      真的管不到释放的，必须在文件里写明 blob-owned 理由（免单不是静默放行）。
//   ③ 注释行不算数：本仓惯例是把「修前形态」写进块注释（poker-app 第 11 行就是原话），
//      数代码时跳过行首为 // * /* 的行。
// 实现说明：本档不用正则，一律 indexOf（与 r25_o3 / r27_o1 同一条纪律：生成链会把反斜杠吃掉）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const NL = String.fromCharCode(10);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('ok ' + n); } else { fail++; console.log('FAIL ' + n + (extra ? '  -  ' + extra : '')); } };

/** 行是不是注释（行首 // * /*）：本仓故意把修前形态写在块注释里。 */
function isCommentLine(line) {
  const t = String(line).trim();
  return t.indexOf('//') === 0 || t.indexOf('*') === 0 || t.indexOf('/*') === 0;
}

/** 一行里「代码部分」：截到行内 // 之前（注释里写源形态的 createObjectURL 不算数）。 */
function codePart(line) {
  const p = line.indexOf('//');
  return p < 0 ? line : line.slice(0, p);
}

/** 从 at 之后的第一个 { 起配平，取回调/函数体。 */
function bodyFrom(src, at) {
  const j = src.indexOf('{', at);
  if (j < 0) return '';
  let d = 0;
  for (let k = j; k < src.length && k < j + 8000; k += 1) {
    const c = src[k];
    if (c === '{') d += 1;
    else if (c === '}') { d -= 1; if (d === 0) return src.slice(j, k + 1); }
  }
  return src.slice(j, j + 8000);
}

/** 轴①：input / keydown 回调体内重建含输入控件的片段。返回违规行号列表。 */
function inputRebuildViolations(src) {
  const needles = [
    'addEventListener(' + String.fromCharCode(39) + 'input' + String.fromCharCode(39),
    'addEventListener(' + String.fromCharCode(34) + 'input' + String.fromCharCode(34),
    'addEventListener(' + String.fromCharCode(39) + 'keydown' + String.fromCharCode(39),
    'addEventListener(' + String.fromCharCode(34) + 'keydown' + String.fromCharCode(34),
  ];
  const bad = [];
  let i = 0;
  for (;;) {
    let best = -1;
    for (const n of needles) {
      const p = src.indexOf(n, i);
      if (p >= 0 && (best < 0 || p < best)) best = p;
    }
    if (best < 0) break;
    const b = bodyFrom(src, best);
    const rebuild = b.indexOf('innerHTML =') >= 0;
    const hasInput = b.indexOf('<input') >= 0 || b.indexOf('<textarea') >= 0;
    if (rebuild && hasInput) bad.push('line ' + src.slice(0, best).split(NL).length);
    i = best + 12;
  }
  return bad;
}

/** 轴②：blob URL 收支。 */
function blobAudit(text) {
  const lines = text.split(NL);
  let made = 0, freed = 0;
  for (const line of lines) {
    if (isCommentLine(line)) continue;
    const code = codePart(line);
    if (code.indexOf('createObjectURL') >= 0) made += 1;
    if (code.indexOf('revokeObjectURL') >= 0) freed += 1;
  }
  return { made, freed, net: made - freed };
}

function walk(dir, out) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) walk(rel, out);
    else if (e.name.endsWith('.js')) out.push(rel);
  }
}

// ── 1. 自检（三条负控制：判据自己不许是永远绿的）──
ok('自检：输入回调内重建含输入控件 → 必须报', inputRebuildViolations(
  'el.addEventListener(' + String.fromCharCode(39) + 'input' + String.fromCharCode(39) + ', () => {' + NL +
  '  box.innerHTML = ' + String.fromCharCode(96) + '<input value=1>' + String.fromCharCode(96) + ';' + NL + '});' + NL).length === 1);
ok('自检：输入回调只改读数 → 不许报', inputRebuildViolations(
  'el.addEventListener(' + String.fromCharCode(39) + 'input' + String.fromCharCode(39) + ', () => {' + NL +
  '  caption.textContent = v;' + NL + '});' + NL).length === 0);
ok('自检：blob 只建不还 → net 必须为 1', blobAudit('const u = URL.createObjectURL(b);' + NL).net === 1);
ok('自检：blob 成对 → net 必须为 0', blobAudit(
  'const u = URL.createObjectURL(b);' + NL + 'URL.revokeObjectURL(u);' + NL).net === 0);

const files = [];
walk('apps', files);
ok('扫描面非空', files.length >= 300, '实际 ' + files.length);

// ── 2. 轴①：输入回调纪律 ──
const rebuildBad = [];
for (const rel of files) {
  const v = inputRebuildViolations(read(rel));
  if (v.length) rebuildBad.push(rel + ' ' + v.join(','));
}
ok('输入回调体内零重建（保住焦点/光标/选区）', rebuildBad.length === 0, rebuildBad.join(' , '));

// ── 3. 轴②：blob URL 收支 ──
const blobBad = [];
const blobSeen = [];
for (const rel of files) {
  const t = read(rel);
  if (t.indexOf('createObjectURL') < 0) continue;
  const a = blobAudit(t);
  if (a.made === 0) continue;
  blobSeen.push(rel);
  if (a.net > 0 && t.indexOf('blob-owned') < 0) blobBad.push(rel + ' net=' + a.net);
}
ok('blob URL 全部平账（或写明 blob-owned 理由）', blobBad.length === 0, blobBad.join(' , '));

// ── 4. 本轮巡检结论锁：五件已确认的安全形态不许被改坏 ──
const uterus = read('apps/uterus/uterus-view.js');
ok('uterus：根容器点击仍按 _boundRoot 去重', uterus.indexOf('this._boundRoot !== root') >= 0);

const chat = read('apps/wechat/chat-view.js');
ok('chat：换窗滚动监听仍有自建去重标记', chat.indexOf('_windowedStreamScrollBound = true') >= 0);

const diary = read('apps/diary/diary-view.js');
ok('diary：封面锁仍用 onclick 覆盖（防叠罗汉）', diary.indexOf('clasp.onclick =') >= 0);

const wolf = read('apps/games/werewolf/werewolf-view.js');
ok('werewolf：发言区日折叠仍按新节点重绑（局部刷新，不累积）', wolf.indexOf('games-werewolf-chat-day-toggle') >= 0);
ok('werewolf：CSS 等待监听仍是 once 自摘', wolf.indexOf('once: true') >= 0);

const poker = read('apps/games/poker/poker-view.js');
ok('poker：绑定全在 _bindXxx 里（随整屏 setContent 换节点）', poker.indexOf('_bindLobbyEvents') >= 0);

console.log(pass + ' 通过, ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);
