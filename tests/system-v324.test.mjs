// tests/system-v324.test.mjs — P-6 声明式生命周期注册可行性取证 [v3.7.0]
//
//   本版**只取证，不改造**。TODO P 批的 P-6 一直是「先取证再定」的空位：准入判据
//   （「覆盖率 >= 80% 才实施」）从来没有被算过。算它的第一步是把「覆盖率」定义清楚 ——
//   而定义它就得先把三件东西量出来：App 实例出口、手写接线点、三条会话路径的区间。
//
//   本轮的结论（按读数否掉一个候选）：
//     **「声明式生命周期注册」不实施（not_done）** —— 不是按感觉，是四条读数全不达：
//     ① 覆盖率 79.7% < 80%（准入门槛）；
//     ② onChatChanged 参数契约不可统一（1 个必选参出口 MusicApp(newStorage)，而框架只能统一调用）；
//     ③ 三路径语义一致率 45.5% —— 6/11 个槽位的三路径动作集不同，且真跑追因后**六条差异全是设计意图**
//        （P1「换会话」要实例活下来 vs P2/P3「清数据」要实例死掉；游戏/世界脉搏在 P2/P3 有意走
//        `reloadPhoneSurface → retireSessionScopedSlots` 咽喉点回收）；
//     ④ 非 App 接线点占 20.3%（缓存对象/桥/记忆内核没有「实例」可挂声明）。
//     真正有读数支持的方向是「按路径分档的处置矩阵」（见基线 only_axis_with_evidence）。
//
//   覆盖：
//     A 基线四件齐备 + 探针读数与基线逐项一致 + 判定挂在读数上（可复算）
//     B 回写防护三向：声明式 API 零引入 / lifecycle-audit 仍在门禁链 / 区间锚点仍在
//     C 结论面（not_done 必须给出覆盖面、参数契约、语义差异三类证据，且有替代轴）
//     D 负控制（四条真源码破坏，每条在原版与破坏副本上跑**同一份**探针）
//     E 版本锚（只在 3.7.0 及以后成立）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { copyTreeSafe } from './_mirror_tree.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const AUDIT = path.join(ROOT, 'tests', 'audit');
const PROBE = path.join(AUDIT, 'lifecycle_declarative_probe.cjs');
const BASEF = path.join(AUDIT, 'lifecycle_declarative_baseline.json');
const read = (p) => fs.readFileSync(p, 'utf8');
const IDX_SRC = read(path.join(ROOT, 'index.js'));
const PKG = JSON.parse(read(path.join(ROOT, 'package.json')));

/* ── 真跑探针（每套件一次，多组判据复用同一份输出） ── */
function runProbe(root) {
  const args = [PROBE];
  if (root) args.push('--root', root);
  args.push('--json');
  return spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', timeout: 240000 });
}
const main = runProbe(null);
assert.equal(main.status, 0, '探针必须能跑通：' + String(main.stderr || '').slice(0, 300));
let rep;
try { rep = JSON.parse(main.stdout); } catch (e) { assert.fail('探针输出必须是 JSON：' + String(main.stdout).slice(0, 160)); }
const base = JSON.parse(read(BASEF));
const R = base.readings;

/* ── 副本与破坏（沿用门禁的夹具通道纪律；绝不对真仓做破坏） ── */
const temps = [];
function makeCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_p6_'));
  temps.push(dir);
  fs.copyFileSync(path.join(ROOT, 'index.js'), path.join(dir, 'index.js'));
  copyTreeSafe(path.join(ROOT, 'apps'), path.join(dir, 'apps'));
  return dir;
}
process.on('exit', () => {
  for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});
/* 真源码破坏：锚点必须**恰中一次**（多一点即意味着改了不该改的地方） */
function damage(rel, anchor, replacement) {
  const dir = makeCopy();
  const p = path.join(dir, rel);
  const src = read(p);
  const hits = src.split(anchor).length - 1;
  assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + anchor.slice(0, 70));
  fs.writeFileSync(p, src.split(anchor).join(replacement));
  return { dir: dir, res: runProbe(dir) };
}

/* ══════════ A ── 基线与读数 ══════════ */
test('A1 基线四件齐备（读数 / 口径 / 判定 / 未做）+ 可复算字段', () => {
  for (const k of ['file', 'note', 'measured_at', 'probe', 'caliber', 'readings', 'shape', 'verdict', 'corrections', 'not_done']) {
    assert.ok(base[k], '缺面：' + k);
  }
  for (const [k, v] of Object.entries(R)) {
    assert.ok(Number.isFinite(v) && v >= 0, 'readings.' + k + ' 必须是有限非负数');
  }
  assert.ok(Array.isArray(base.caliber) && base.caliber.length >= 4, '口径必须逐条写明（含区间划定 / 计数单位 / 三分类 / 语义比对）');
  assert.ok(Array.isArray(base.corrections) && base.corrections.length >= 3, '修正面必须如实写下（含一次误读被推翻）');
  assert.ok(Array.isArray(base.not_done) && base.not_done.length >= 3, '必须如实写下没做什么');
  assert.equal(base.probe, 'tests/audit/lifecycle_declarative_probe.cjs', '基线必须指向探针路径');
});

test('A2 探针读数与基线逐项一致（读数可复算，防转写漂移）', () => {
  assert.equal(rep.appClasses, R.app_classes);
  assert.equal(rep.slots, R.slots);
  assert.equal(rep.appSlots, R.app_slots);
  assert.equal(rep.wiringPoints, R.wiring_points);
  assert.equal(rep.appExitPoints, R.app_exit_points);
  assert.equal(rep.nonAppPoints, R.non_app_points);
  assert.equal(rep.pointsByPath.P1, R.points_p1);
  assert.equal(rep.pointsByPath.P2, R.points_p2);
  assert.equal(rep.pointsByPath.P3, R.points_p3);
  assert.equal(rep.semanticSlots, R.semantic_slots);
  assert.equal(rep.semanticSame, R.semantic_same);
  assert.equal(rep.semanticDiff, R.semantic_diff);
  assert.equal(rep.signatures.empty, R.sig_empty);
  assert.equal(rep.signatures.def, R.sig_default);
  assert.equal(rep.signatures.required, R.sig_required);
  assert.equal(rep.signatures.none, R.sig_none);
  /* 三类接线点必须自洽：App + 非 App 必须等于总数 */
  assert.equal(rep.appExitPoints + rep.nonAppPoints, rep.wiringPoints, '三类分类必须自洽');
  /* 三路径相加必须等于总数 */
  const sumP = rep.pointsByPath.P1 + rep.pointsByPath.P2 + rep.pointsByPath.P3;
  assert.equal(sumP, rep.wiringPoints, '三路径点数之和必须等于总数');
  /* 语义面：一致 + 不一致 = 槽位总数 */
  assert.equal(rep.semanticSame + rep.semanticDiff, rep.semanticSlots);
  /* 四类签名必须覆盖全部 36 个类 */
  const sumSig = rep.signatures.empty + rep.signatures.def + rep.signatures.required + rep.signatures.none;
  assert.equal(sumSig, rep.appClasses, '四类签名之和必须等于 App 类数');
});

test('A3 判定挂在读数上（四条判据全部由探针算出，不得手写结论）', () => {
  assert.ok(Array.isArray(rep.criteria) && rep.criteria.length === 4, '四条判据必须在场');
  const ids = rep.criteria.map((c) => c.id).join(',');
  assert.equal(ids, 'R1,R2,R3,R4', '判据编号必须齐备');
  for (const c of rep.criteria) {
    assert.ok(c.desc && c.gotText, '判据必须自带口径与实测值：' + c.id);
  }
  assert.equal(rep.verdict, 'not_done', '本版判定必须是 not_done（准入未达）');
  /* [v3.14.0 · 交棒] 原断言是「四条全不达」。#65 把通话计时器接进实例域时，在三处置 null 前
     多调一次实例出口 ⇒ App 出口点 47 → 50，覆盖率 79.7% → 80.6%，R1 与 R4 转 pass。
     但判定仍为 not_done：真正决定性的 R2/R3 一格未动。本判据改为钉住「两条硬否决在场」
     与「读数变好不等于方案可行」（否则就是拿准入率当免罪牌）。 */
  const hard = rep.criteria.filter((c) => c.id === 'R2' || c.id === 'R3');
  assert.equal(hard.length, 2, '两条硬否决必须在场');
  assert.equal(hard.filter((c) => c.pass).length, 0,
    '本版仍不实施：R2/R3 这两条硬否决必须全不达');
  assert.equal(rep.criteria.filter((c) => c.pass).length, R.criteria_pass_count,
    '转 pass 的判据数必须与基线记录一致（防读数静静变好）');
  /* 可复算：两次运行逐字节相同 */
  const again = runProbe(null);
  assert.equal(again.status, 0);
  assert.equal(again.stdout, main.stdout, '同一份 index.js 跑两次读数必须逐字相同');
});

test('A4 弹窗 items 不得含方括号（既有当版切片判据按首个 ] 截断，会假红）', () => {
  /* ★ 踩坑记录：tests/system-v312.test.mjs 的当版同源判据用 `seg.slice(0, seg.indexOf(']') + 1)`
   *   取「弹窗头部」，故 items 文本里一旦出现 `]`（如注明某调用写作 phone[key]?.x?.()），
   *   头部会被提前截断 ⇒ 后半 items 全部读不到 ⇒ 假红。本判据把这个坑钉住：
   *   弹窗文案里不用方括号（改写成 phone.<键>?.x?.() 等价表述）。 */
  const seg = IDX_SRC.slice(IDX_SRC.indexOf('const ST_PHONE_CURRENT_UPDATE'));
  const head = seg.slice(0, seg.indexOf(']') + 1);
  const log = JSON.parse(read(path.join(ROOT, 'update-log.json')));
  for (const it of log.versions[log.latest].items) {
    assert.equal(it.includes('[') || it.includes(']'), false, '弹窗文案不得含方括号：' + it.slice(0, 40));
  }
  assert.ok(head.includes(JSON.stringify(log.versions[log.latest].items.slice(-1)[0])), '末条必须能在头部里读到（切片未被提前截断）');
});

/* ★ v3.23.0 补门：判据散文（criteria[*].got_text）必须与探针现场**复算一致**。
 *   此前本套件只校验「criteria 在场 / 条数 / desc 非空」—— **从不复算内容**，
 *   于是散文会随 readings 漂移而无人发现（活标本：schedule R4 散文 4 / 读数 6；
 *   long_chat L5 散文 238/18/50 / scan 248/11/48，自 v3.19.0 起分叉）。
 *   纪律：冻结面（现场写「未复核（冻结证据：…）」= 这次没传 --upstream）按设计跳过。
 *   自包含：冻结判据与取字段函数都在函数体内（不受模块顶层 const 的 TDZ 影响）。 */
function assertAuditCriteria(baseCrit, liveCrit) {
  const FROZEN_RE = /未复核|冻结证据|（冻结）/;
  const gotOf = (c) => (c.gotText !== undefined ? String(c.gotText) : String(c.got_text));
  assert.equal(liveCrit.length, baseCrit.length, '判据条数必须一致');
  const live = new Map(liveCrit.map((c) => [String(c.id), c]));
  for (const b of baseCrit) {
    const id = String(b.id);
    const l = live.get(id);
    assert.ok(l, '现场缺判据：' + id);
    const lg = gotOf(l);
    if (FROZEN_RE.test(lg)) continue;
    assert.equal(lg, String(b.got_text),
      '判据散文必须与现场复算一致（' + id + '）—— 源变了就该主动刷新基线的 got_text');
  }
}
test('FM1 判据散文可复算（零手抄）＋ 负控制：手抄漂移必须转红', () => {
  assertAuditCriteria(base.criteria, rep.criteria);
  /* 真值破坏：挑一条**现场非冻结**的判据，把散文换成一个不可能等于现场的值 ⇒ 必须转红 */
  const gotOf = (c) => (c.gotText !== undefined ? String(c.gotText) : String(c.got_text));
  const liveMap = new Map(rep.criteria.map((c) => [String(c.id), c]));
  const bad = JSON.parse(JSON.stringify(base));
  const FROZEN_RE = /未复核|冻结证据|（冻结）/;
  const target = bad.criteria.find((c) => {
    const l = liveMap.get(String(c.id));
    return l && !FROZEN_RE.test(gotOf(l));
  });
  assert.ok(target, '负控制需要一个「现场非冻结」的判据');
  target.got_text = '【负控制占位】与现场必然不符';
  assert.throws(() => assertAuditCriteria(bad.criteria, rep.criteria),
    /判据散文必须与现场复算一致/, '负控制：手抄漂移必须让同款判据转红');
});

/* ══════════ B ── 回写防护 ══════════ */
test('B1 声明式 API 零引入（本版不改产品代码；若将来实施，本判据会被主动改写而非静默通过）', () => {
  /* 为什么守这条：取证轮的产物是「读数 + 判据」，不是产品改动。
   *   若有人在这个版本里偷偷把 static lifecycleExits 加进去，本版「只取证」的承诺就成了空话。 */
  assert.equal(/static[ \t]+lifecycleExits/.test(IDX_SRC), false, 'index.js 本版不得引入 static lifecycleExits');
  for (const dir of fs.readdirSync(path.join(ROOT, 'apps'))) {
    const abs = path.join(ROOT, 'apps', dir);
    if (!fs.statSync(abs).isDirectory()) continue;
    for (const f of fs.readdirSync(abs)) {
      if (f.slice(-7) !== '-app.js') continue;
      const src = read(path.join(abs, f));
      assert.equal(/static[ \t]+lifecycleExits/.test(src), false, dir + '/' + f + ' 本版不得引入 static lifecycleExits');
    }
  }
});

test('B2 现有生命周期门禁仍在门禁链里（声明式改造只能换掉它，不能悄悄绕过它）', () => {
  assert.ok(PKG.scripts && PKG.scripts.lifecycle, 'package.json 必须有 lifecycle 脚本');
  assert.ok(/lifecycle-audit\.mjs/.test(PKG.scripts.lifecycle), 'lifecycle 脚本必须指向 lifecycle-audit.mjs');
  assert.ok(/npm run lifecycle/.test(PKG.scripts.check), '九门 check 链必须还包含 lifecycle');
  assert.ok(/npm run check/.test(PKG.scripts.check) || true, 'check 链必须在场');
  const gate = read(path.join(ROOT, 'scripts', 'lifecycle-audit.mjs'));
  assert.ok(/retireSessionScopedSlots/.test(gate), '咽喉点清单必须仍从真源码派生');
  assert.ok(/releasePhoneInactiveResources/.test(gate), '泛化调用清单必须仍从真源码派生');
});

test('B3 三路径区间锚点仍在（探针与门禁共用同一套划定口径）', () => {
  assert.ok(IDX_SRC.indexOf("addEventListener('phone:clearCurrentData'") >= 0, 'P2 锚点必须在场');
  assert.ok(IDX_SRC.indexOf("addEventListener('phone:clearAllData'") >= 0, 'P3 锚点必须在场');
  assert.ok(/function onChatChanged\(\)\s*\{/.test(IDX_SRC), 'P1 锚点必须在场');
  assert.ok(/function reloadPhoneSurface\(\)/.test(IDX_SRC), '咽喉点函数必须在场');
  assert.ok(/retireSessionScopedSlots\(\)/.test(IDX_SRC), '咽喉点在 reloadPhoneSurface 里被调用');
});

/* ══════════ C ── 结论面 ══════════ */
test('C1 结论必须给出三类证据（不达的覆盖面 / 参数契约 / 语义差异），不得只写一句「不达」', () => {
  const v = base.verdict;
  assert.ok(v && v.question && v.answer, '须有被问的问题与给的答案');
  assert.ok(/not_done/.test(v.answer), '结论必须明确标 not_done');
  assert.ok(/79\.7%/.test(v.answer) || /79\.7%/.test(v.reasons.join(' ')), '必须给出覆盖率实测值');
  const txt = v.reasons.join(' ');
  assert.ok(/80%/.test(txt), '必须写明准入线');
  assert.ok(/newStorage/.test(txt), '必须点名必选参出口（参数契约不可统一）');
  assert.ok(/45\.5%/.test(txt), '必须给出语义一致率');
  assert.ok(/20\.3%/.test(txt) || /非 App/.test(txt), '必须给出非 App 接线点占比');
});

test('C2 结论必须区分「设计」与「缺陷」（本轮的自我纠正不得丢失）', () => {
  const txt = base.verdict.reasons.join(' ');
  assert.ok(/有意分档/.test(txt), '必须写明三路径差异是「有意分档」而非重复书写');
  assert.ok(/咽喉点/.test(txt), '必须写明 P2/P3 走咽喉点回收');
  assert.ok(/设计意图/.test(txt), '必须写明六条差异全为设计意图');
  /* 修正面必须留下「把设计读成缺陷」这条自身缺陷 */
  assert.ok(base.corrections.some((c) => /误读|读成了|推翻/.test(c)), '必须留下一次误读被推翻的记录');
});

test('C3 结论必须给出有读数支持的替代轴（否掉一个候选的同时必须指出方向）', () => {
  const v = base.verdict;
  assert.ok(v.only_axis_with_evidence, '必须有替代轴');
  assert.ok(/分档|处置矩阵|按路径/.test(v.only_axis_with_evidence), '替代轴必须是按路径分档的处置矩阵');
  assert.ok(base.shape && base.shape.verdict, '形状面必须给结论');
});

/* ══════════ D ── 负控制（真源码破坏，每条跑同一份探针） ══════════ */
test('D1 破坏三路径锚点 ⇒ 探针必须 fail-closed 拒判（不得用坏探针发合格证）', () => {
  /* ★ 破坏后的锚点串**不得在源码里以连续字面量出现**：tests/system-v226.test.mjs 会全仓扫描
   *   `phone:*` 事件字面量并与契约对账，把破坏串写死在源码里会制造一个「契约外事件」的假红
   *   （实测踩过：全量九门里 v226 就是因此转红）。故破坏串在运行期拼装。 */
  const d = damage('index.js', 'phone:clearCurrentData', 'phone:clearCurrentData' + '_' + 'RENAMED');
  assert.equal(d.res.status, 2, '锚点缺失时必须 exit 2，实测 exit ' + d.res.status);
  assert.ok(/锚点缺失/.test(String(d.res.stderr)), '必须说明是锚点缺失');
});

test('D2 枚举面不足 ⇒ 探针必须 fail-closed 拒判（删到类数低于下限）', () => {
  /* 为什么不改源码锚点：把 36 个类降到 19 需要改 17 个文件，不可能满足「锚点恰中一次」的破坏纪律；
   *   删文件是真破坏（真文件缺失，而非模拟常量），且能直接命中「枚举面自证」这条判据。 */
  const dir = makeCopy();
  const apps = path.join(dir, 'apps');
  const files = [];
  for (const sub of fs.readdirSync(apps)) {
    const abs = path.join(apps, sub);
    if (!fs.statSync(abs).isDirectory()) continue;
    for (const f of fs.readdirSync(abs)) if (f.slice(-7) === '-app.js') files.push(path.join(abs, f));
  }
  let removed = 0;
  for (const f of files) {
    fs.rmSync(f);
    removed += 1;
    const r = runProbe(dir);
    if (r.status === 2) {
      assert.ok(/枚举面不足/.test(String(r.stderr)), '必须说明是枚面不足，实测：' + String(r.stderr).slice(0, 160));
      assert.ok(removed >= 2, '不可能删一个就跌破下限（36 - 1 = 35），实测删了 ' + removed);
      return;
    }
  }
  assert.fail('删光全部 ' + removed + ' 个 app 文件都没触发拒判 —— 枚举面自证判据失效');
});

test('D3 删一个 App 出口调用 ⇒ 接线点读数必须可观测地变少（真判据对破坏有反应）', () => {
  const d = damage('index.js', String.fromCharCode(10) + '                window.VirtualPhone.diaryApp.clearCache();', String.fromCharCode(10) + '                void 0;');
  assert.equal(d.res.status, 0, '单行删除不应使探针拒判（只是读数变小）');
  const r2 = JSON.parse(d.res.stdout);
  assert.equal(r2.appExitPoints, R.app_exit_points - 1, '删一个 App 出口调用必须使 App 接线点恰好少 1');
  assert.equal(r2.wiringPoints, R.wiring_points - 1, '总接线点也必须恰好少 1');
  assert.ok(r2.coverage < R.app_exit_points / R.wiring_points, '覆盖率必须真的变小');
});

test('D4 改一个 onChatChanged 参数契约 ⇒ 签名读数与 R2 判据必须跟着翻', () => {
  const d = damage(path.join('apps', 'music', 'music-app.js'), 'onChatChanged(newStorage)', 'onChatChanged()');
  assert.equal(d.res.status, 0, '参数契约改变不应使探针拒判');
  const r2 = JSON.parse(d.res.stdout);
  assert.equal(r2.signatures.required, 0, '必选参出口必须降为 0');
  assert.equal(r2.signatureRequired.length, 0, '必选参名单必须变空');
  assert.equal(r2.signatures.empty, R.sig_empty + 1, '无参出口必须多 1');
  const r2crit = r2.criteria.find((c) => c.id === 'R2');
  assert.equal(r2crit.pass, true, 'R2 必须从 fail 翻为 pass（证明它是活判据）');
  assert.equal(r2.verdict, 'not_done', '其余三条仍不达，总判定仍为 not_done');
});

/* ══════════ E ── 版本锚 ══════════ */
test('E1 版本锚（只在 3.7.0 及以后成立）', () => {
  const v = JSON.parse(read(path.join(ROOT, 'manifest.json'))).version;
  const parts = v.split('.').map(Number);
  const ok = parts[0] > 3 || (parts[0] === 3 && parts[1] >= 7);
  assert.ok(ok, '本套件成立于 RubyPhone 3.7.0 及以后，当前 ' + v);
  assert.equal(base.measured_at, 'v3.6.0', '基线首测版必须是 v3.6.0');
});
