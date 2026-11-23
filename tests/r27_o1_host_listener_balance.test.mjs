// R27-O1 宿主级监听收支平衡（判据本体）
// 为什么单独立一条：本批（v4.172 ~ v4.181）修过的缺陷里，一类是「监听挂到活过了重绘
//   的节点上，于是每进一次就多一份」。这类缺陷在源码里看不出错，控制台也不报，
//   只能靠收支账。本判据只审 document / window 两级：元素级监听随重绘换节点
//   （旧元素进 GC），不在这笔账上。
// 纪律：①成对才算平账；②一旦 once 为 true 就自摘，算已还；③真的只能只加不摘的，
//   必须在文件里写明 host-listener 理由（免单不是静默放行）。
// 实现说明：本档不用正则，一律 indexOf（与 r25_o3 同一条纪律：生成链会把反斜杠吃掉）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const NL = String.fromCharCode(10);
const Q = String.fromCharCode(39);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('ok ' + n); } else { fail++; console.log('FAIL ' + n + (extra ? ' — ' + extra : '')); } };

/** 剥注释（手写扫描器）。判据要查的是代码，不是注释里的承诺。 */
function codeOf(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === '/*') { const end = src.indexOf('*/', i + 2); i = end < 0 ? src.length : end + 2; continue; }
    if (two === '//') { const nl = src.indexOf(NL, i + 2); i = nl < 0 ? src.length : nl; continue; }
    out += src[i]; i += 1;
  }
  return out;
}

function has(line, host, kind) {
  return line.indexOf(host + '.' + kind + '(') >= 0;
}

/** 一行一行数：加 / 摘 / 自摘。
 *  ★ 为什么不先剥注释：模板字符串里写着 CSS，里面的块注释记号会让手写扫描器
 *    误判成注释起点，把后面整段代码吞掉（music 的 6 摘 1 加就是这么算错的）。
 *    这里直接数原文：注释里写「谁加了监听」的概率远低于因此算错的风险。
 *  ★ once 认窗口：`{ once: true }` 常写在回调结束那一行，与 addEventListener 不同行，
 *    所以向后再看几行。 */
function audit(text) {
  const lines = text.split(NL);
  let add = 0, rem = 0, once = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    /* 跳过注释行（含块注释的续行）：本仓有不少地方**故意**把修前形态写进注释，
     *  poker-app 第 11 行就是「修前是 window.addEventListener(...)」的原话。 */
    const head = String(line).trim();
    if (head.indexOf('//') === 0 || head.indexOf('*') === 0 || head.indexOf('/*') === 0) continue;
    const isAdd = has(line, 'document', 'addEventListener') || has(line, 'window', 'addEventListener');
    const isRem = has(line, 'document', 'removeEventListener') || has(line, 'window', 'removeEventListener');
    if (isAdd) {
      add += 1;
      const win = lines.slice(i, i + 6).join(NL);
      if (win.indexOf('once: true') >= 0) once += 1;
    }
    if (isRem) rem += 1;
  }
  return { add, rem, once, net: add - once - rem };
}

function walk(dir, out) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) walk(rel, out);
    else if (e.name.endsWith('.js')) out.push(rel);
  }
  return out;
}

// ── 1. 自检：计数器自己会不会红 ──
const twoAdds = 'document.addEventListener(' + Q + 'click' + Q + ', f);' + NL + 'window.addEventListener(' + Q + 'blur' + Q + ', g);';
const paired = 'document.addEventListener(' + Q + 'click' + Q + ', f);' + NL + 'document.removeEventListener(' + Q + 'click' + Q + ', f);';
const oneShot = 'document.addEventListener(' + Q + 'click' + Q + ', f, { once: true });';
ok('自检：两加零摘 net = 2', audit(twoAdds).net === 2, JSON.stringify(audit(twoAdds)));
ok('自检：成对 net = 0', audit(paired).net === 0, JSON.stringify(audit(paired)));
ok('自检：自摘算已还 net = 0', audit(oneShot).net === 0, JSON.stringify(audit(oneShot)));

// ── 2. 全仓 apps 平账 ──
const files = walk('apps', []);
const scanned = [];
const unbalanced = [];
for (const rel of files) {
  const text = read(rel);
  const a = audit(text);
  if (a.add === 0) continue;
  scanned.push(rel);
  if (a.net > 0 && text.indexOf('host-listener') < 0) unbalanced.push(rel + ' net=' + a.net);
}
ok('扫描面非空（至少 15 个文件挂宿主级监听）', scanned.length >= 15, '实际 ' + scanned.length);
ok('宿主级监听全部平账（或写明 host-listener 理由）', unbalanced.length === 0, unbalanced.join(' , '));

// ── 3. 接线锁：本批修过的四个点不许静默回退 ──
const album = read('apps/album/album-view.js');
ok('album：两处 bind 都有根节点去重', album.indexOf('this._boundRoot === root') >= 0 && album.indexOf('this._replayBoundRoot === root') >= 0);
ok('album：从预览删图真走 closePreview', album.indexOf('this.closePreview();' + NL + '        this.render();') >= 0);

const cal = read('apps/calendar/calendar-view.js');
ok('calendar：rAF 绑回调带渲染序号守卫', cal.indexOf('if (_seq !== this._renderSeq) return;') >= 0);

const mem = read('apps/memory/memory-view.js');
ok('memory：容器委派幂等标志记节点身份', mem.indexOf('this._delegatedHost !== this.container') >= 0);
ok('memory：分页条在正文之后', mem.indexOf('this._tabsHtml(),') > mem.indexOf('mem-body'));

const rd = read('apps/reading/reading-view.js');
ok('reading：存在就地改读数的 _paintProgress', rd.indexOf('_paintProgress(which) {') >= 0);
ok('reading：进度回调不再引用不存在的 this.phoneShell', rd.indexOf('if (this.phoneShell?.screen)') < 0);

// ── 4. 范本锁：已有正确实现的两件不许被改坏 ──
for (const rel of ['apps/bilibili/bili-view.js', 'apps/taobao/taobao-view.js']) {
  ok('范本 ' + rel.split('/')[1] + '：仍用 _boundEl 去重', read(rel).indexOf('this._boundEl') >= 0);
}

console.log(pass + ' 通过, ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);
